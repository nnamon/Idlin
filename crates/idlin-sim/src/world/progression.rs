//! Experience, leveling (character and gem), and the derived-stat engine
//! that folds tree grants, gear affixes, and attribute conversions into a
//! character's effective combat stats.

use super::{
    BASE_SPEED_CPS, SimEvent, UNARMED_RANGE_CU, UNARMED_USE_TICKS, World, base_accuracy,
    base_evasion, base_life, base_mana, base_unarmed_damage, fx_from_cu, speed_from_cps,
};
use crate::entity::{DMG_COUNT, GEM_LEVEL_CAP, Item, RES_COUNT, gem_xp_to_next};
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
        // Active buffs are grants with a clock; they re-derive on apply and
        // on expiry, so folding them here keeps one evaluation path.
        for ef in &e.effects {
            if let crate::entity::ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    sheet.apply(g);
                }
            }
        }
        let mut weapon: Option<&Item> = None;
        let mut armour_base = 0i64;
        let mut evasion_base = base_evasion(level);
        let mut block_base = 0i64;
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
                block_base += def.block_bp;
            }
        }

        // Attribute conversions (PoE-classic, user-locked; ratios flagged
        // for redline). Each point of:
        //   Strength:     +0.5 life,     +0.2% increased MELEE phys
        //   Dexterity:    +2 accuracy,   +0.2% increased evasion
        //   Intelligence: +0.5 mana,     +0.2% increased energy shield
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
                stat: Stat::MeleePhys,
                layer: crate::stats::Layer::Increased,
                value: strength * 20,
            },
            Grant {
                stat: Stat::Accuracy,
                layer: crate::stats::Layer::Added,
                value: dexterity * 2,
            },
            Grant {
                stat: Stat::Evasion,
                layer: crate::stats::Layer::Increased,
                value: dexterity * 20,
            },
            Grant {
                stat: Stat::Mana,
                layer: crate::stats::Layer::Added,
                value: intelligence / 2,
            },
            Grant {
                stat: Stat::EnergyShield,
                layer: crate::stats::Layer::Increased,
                value: intelligence * 20,
            },
        ] {
            if grant.value != 0 {
                sheet.apply(&grant);
            }
        }

        let (dmg_base, range, use_base, projectile) = match weapon {
            Some(item) => {
                let def = &self.content.items[item.base_idx as usize];
                (
                    [
                        def.damage_phys,
                        def.damage_fire,
                        def.damage_cold,
                        def.damage_lightning,
                        def.damage_chaos,
                    ],
                    fx_from_cu(def.range_cu),
                    def.use_ticks,
                    def.projectile,
                )
            }
            None => (
                [base_unarmed_damage(level), 0, 0, 0, 0],
                fx_from_cu(UNARMED_RANGE_CU),
                UNARMED_USE_TICKS,
                false,
            ),
        };

        // The STR bucket applies only to melee weapons (and bare fists).
        if !projectile {
            sheet.fold(Stat::MeleePhys, Stat::DamagePhys);
        }

        let life_max = sheet.value(Stat::Life, base_life(level)).max(1);
        const DMG_STATS: [Stat; DMG_COUNT] = [
            Stat::DamagePhys,
            Stat::DamageFire,
            Stat::DamageCold,
            Stat::DamageLightning,
            Stat::DamageChaos,
        ];
        let mut damage = [0i64; DMG_COUNT];
        for i in 0..DMG_COUNT {
            damage[i] = sheet.value(DMG_STATS[i], dmg_base[i]);
        }
        let accuracy = sheet.value(Stat::Accuracy, base_accuracy(level));
        let evasion = sheet.value(Stat::Evasion, evasion_base);
        let armour = sheet.value(Stat::Armour, armour_base);
        const RES_STATS: [Stat; RES_COUNT] = [
            Stat::ResistFire,
            Stat::ResistCold,
            Stat::ResistLightning,
            Stat::ResistChaos,
        ];
        let mut resists = [0i64; RES_COUNT];
        for i in 0..RES_COUNT {
            resists[i] = sheet.value(RES_STATS[i], 0);
        }
        let attack_factor = sheet.value(Stat::AttackSpeed, 10000).max(1000);
        let use_ticks = ((use_base as i64 * 10000 / attack_factor).max(2)) as u32;
        let move_factor = sheet.value(Stat::MoveSpeed, 10000).max(1000);
        let mana_max = sheet.value(Stat::Mana, base_mana(level)).max(0);
        let es_max = sheet.value(Stat::EnergyShield, 0);
        let life_regen = sheet.value(Stat::LifeRegen, 0);
        let mana_regen = sheet.value(Stat::ManaRegen, 0);
        let leech_life = sheet.value(Stat::LeechLife, 0);
        let leech_mana = sheet.value(Stat::LeechMana, 0);
        let block = sheet.value(Stat::Block, block_base).min(7500);
        let crit_inc = sheet.value(Stat::CritChance, 10000).max(0);
        let crit_multi = (15000 + sheet.value(Stat::CritMulti, 0)).max(10000);
        let cast_speed = sheet.value(Stat::CastSpeed, 10000).max(1000);
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
            let mana_delta = mana_max - c.mana_max;
            c.mana_max = mana_max;
            c.mana = (c.mana + mana_delta.max(0)).clamp(0, mana_max);
            let es_delta = es_max - c.es_max;
            c.es_max = es_max;
            c.es = (c.es + es_delta.max(0)).clamp(0, es_max);
            c.life_regen = life_regen;
            c.mana_regen = mana_regen;
            c.leech_life = leech_life;
            c.leech_mana = leech_mana;
            c.block = block;
            c.crit_inc = crit_inc;
            c.crit_multi = crit_multi;
            c.cast_speed = cast_speed;
            c.damage = damage;
            c.accuracy = accuracy;
            c.evasion = evasion;
            c.armour = armour;
            c.resists = resists;
            c.range = range;
            c.use_ticks = use_ticks;
            c.speed_per_tick = speed;
            c.projectile = projectile;
        }
    }
}
