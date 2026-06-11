//! Experience, leveling (character and gem), and the derived-stat engine
//! that folds tree grants, gear affixes, and attribute conversions into a
//! character's effective combat stats.

use super::{
    BASE_SPEED_CPS, SimEvent, UNARMED_COOLDOWN, UNARMED_RANGE_CU, World, base_accuracy,
    base_evasion, base_life, base_unarmed_damage, fx_from_cu, speed_from_cps,
};
use crate::entity::{DMG_CHAOS, DMG_ELE, DMG_PHYS, GEM_LEVEL_CAP, Item, gem_xp_to_next};
use crate::fixed::Fx;
use crate::stats::{Grant, Stat, StatSheet};
use idlin_content::GearSlot;

pub(super) fn xp_to_next(level: u32) -> i64 {
    let l = level as i64;
    80 + 40 * l * l
}

impl World {
    pub(super) fn grant_xp(
        &mut self,
        slot: usize,
        xp: i64,
        credit_kill: bool,
        events: &mut Vec<SimEvent>,
    ) {
        let Some(e) = self.zone.get_mut(slot) else {
            return;
        };
        let net_id = e.net_id;
        let Some(ch) = e.character.as_mut() else {
            return;
        };
        if credit_kill {
            ch.kills += 1;
        }
        ch.xp += xp;
        let mut leveled = false;
        while ch.level < 100 && ch.xp >= xp_to_next(ch.level) {
            ch.xp -= xp_to_next(ch.level);
            ch.level += 1;
            leveled = true;
        }
        // Socketed gems learn from kills too (half share, each).
        let mut gem_levelups: Vec<(u32, u32)> = Vec::new();
        for sg in ch.sockets.values_mut() {
            for gem in std::iter::once(&mut sg.gem).chain(sg.supports.iter_mut()) {
                gem.xp += xp / 2;
                while gem.level < GEM_LEVEL_CAP && gem.xp >= gem_xp_to_next(gem.level) {
                    gem.xp -= gem_xp_to_next(gem.level);
                    gem.level += 1;
                    gem_levelups.push((gem.gem_idx, gem.level));
                }
            }
        }
        let owner_name = ch.name.clone();
        for (gem_idx, glevel) in gem_levelups {
            events.push(SimEvent::GemLevelUp {
                id: net_id,
                owner: owner_name.clone(),
                gem: self.content.gems[gem_idx as usize].name.clone(),
                level: glevel,
            });
        }

        if leveled {
            let name = owner_name;
            let level = {
                let e = self.zone.get(slot).unwrap();
                e.character.as_ref().unwrap().level
            };
            self.refresh_derived_stats(slot);
            if let Some(me) = self.zone.get_mut(slot)
                && let Some(c) = me.combat.as_mut()
            {
                c.life = c.life_max; // level-up: full heal
            }
            events.push(SimEvent::LevelUp {
                id: net_id,
                name,
                level,
            });
            // New points walk the declared build.
            self.allocate_from_plan(slot, events);
        }
    }

    /// Build the full stat sheet for a character: tree grants + gear affixes,
    /// evaluated over universal bases and gear base stats. The weapon defines
    /// the normal attack; armour/evasion bases sum across gear.
    pub(super) fn refresh_derived_stats(&mut self, slot: usize) {
        let Some(e) = self.zone.get(slot) else { return };
        let Some(ch) = &e.character else { return };
        let level = ch.level;

        let mut sheet = StatSheet::new();
        for &node_idx in &ch.allocated {
            if let Some(node) = self.content.tree.get(node_idx as usize) {
                for g in &node.grants {
                    sheet.apply(g);
                }
            }
        }
        let mut weapon: Option<&Item> = None;
        let mut armour_base = 0i64;
        let mut evasion_base = base_evasion(level);
        for (i, slot_item) in ch.equipment.iter().enumerate() {
            let Some(item) = slot_item else { continue };
            let def = &self.content.items[item.base_idx as usize];
            for ra in &item.affixes {
                let a = &self.content.affixes[ra.affix_idx as usize];
                sheet.apply(&Grant {
                    stat: a.stat,
                    layer: a.layer,
                    value: ra.value,
                });
            }
            if i == GearSlot::Weapon.idx() {
                weapon = Some(item);
            } else {
                armour_base += def.armour;
                evasion_base += def.evasion;
            }
        }

        // Attribute conversions (PoE-flavored, integer): each point of
        //   Strength:     +1/2 life,      +0.1% increased physical damage
        //   Dexterity:    +2 accuracy,    +1/2 evasion
        //   Intelligence: +0.1% increased elemental AND chaos damage
        let strength = sheet.value(Stat::Strength, 0);
        let dexterity = sheet.value(Stat::Dexterity, 0);
        let intelligence = sheet.value(Stat::Intelligence, 0);
        for grant in [
            Grant {
                stat: Stat::Life,
                layer: crate::stats::Layer::Added,
                value: strength / 2,
            },
            Grant {
                stat: Stat::DamagePhys,
                layer: crate::stats::Layer::Increased,
                value: strength * 10,
            },
            Grant {
                stat: Stat::Accuracy,
                layer: crate::stats::Layer::Added,
                value: dexterity * 2,
            },
            Grant {
                stat: Stat::Evasion,
                layer: crate::stats::Layer::Added,
                value: dexterity / 2,
            },
            Grant {
                stat: Stat::DamageEle,
                layer: crate::stats::Layer::Increased,
                value: intelligence * 10,
            },
            Grant {
                stat: Stat::DamageChaos,
                layer: crate::stats::Layer::Increased,
                value: intelligence * 10,
            },
        ] {
            if grant.value != 0 {
                sheet.apply(&grant);
            }
        }

        let (dmg_base, range, cooldown_base, projectile) = match weapon {
            Some(item) => {
                let def = &self.content.items[item.base_idx as usize];
                (
                    [def.damage_phys, def.damage_ele, def.damage_chaos],
                    fx_from_cu(def.range_cu),
                    def.cooldown_ticks,
                    def.projectile,
                )
            }
            None => (
                [base_unarmed_damage(level), 0, 0],
                fx_from_cu(UNARMED_RANGE_CU),
                UNARMED_COOLDOWN,
                false,
            ),
        };

        let life_max = sheet.value(Stat::Life, base_life(level)).max(1);
        let damage = [
            sheet.value(Stat::DamagePhys, dmg_base[DMG_PHYS]),
            sheet.value(Stat::DamageEle, dmg_base[DMG_ELE]),
            sheet.value(Stat::DamageChaos, dmg_base[DMG_CHAOS]),
        ];
        let accuracy = sheet.value(Stat::Accuracy, base_accuracy(level));
        let evasion = sheet.value(Stat::Evasion, evasion_base);
        let armour = sheet.value(Stat::Armour, armour_base);
        let resist_ele = sheet.value(Stat::ResistEle, 0);
        let resist_chaos = sheet.value(Stat::ResistChaos, 0);
        let attack_factor = sheet.value(Stat::AttackSpeed, 10000).max(1000);
        let cooldown = ((cooldown_base as i64 * 10000 / attack_factor).max(2)) as u32;
        let move_factor = sheet.value(Stat::MoveSpeed, 10000).max(1000);
        let speed = Fx::from_raw(
            ((speed_from_cps(BASE_SPEED_CPS).raw() as i64) * move_factor / 10000) as i32,
        );

        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.combat.as_mut()
        {
            let delta = life_max - c.life_max;
            c.life_max = life_max;
            if c.life > 0 {
                c.life = (c.life + delta.max(0)).min(life_max);
            }
            c.damage = damage;
            c.accuracy = accuracy;
            c.evasion = evasion;
            c.armour = armour;
            c.resist_ele = resist_ele;
            c.resist_chaos = resist_chaos;
            c.range = range;
            c.cooldown_ticks = cooldown;
            c.speed_per_tick = speed;
            c.projectile = projectile;
        }
    }
}
