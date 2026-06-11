//! What the outside world sees: flat per-entity views for replication, and
//! the canonical FNV-1a state hash that pins replays, snapshots, and CI.

use super::{EntityView, World};
use crate::entity::{Item, LootPayload};
use crate::hash::Fnv1a64;
use idlin_content::GearSlot;

/// Inspection snapshot of one character (the server maps this onto the
/// protocol's CharacterSheet for the focus panel).
pub struct CharacterSheetView {
    pub id: u32,
    pub name: String,
    pub level: u32,
    pub xp: i64,
    pub xp_next: i64,
    pub life: i64,
    pub life_max: i64,
    pub mana: i64,
    pub mana_max: i64,
    pub es: i64,
    pub es_max: i64,
    pub block: i64,
    pub kills: u64,
    pub damage: [i64; crate::entity::DMG_COUNT],
    pub accuracy: i64,
    pub evasion: i64,
    pub armour: i64,
    pub resists: [i64; crate::entity::RES_COUNT],
    /// (slot name, Some((item name, rarity)) or None when empty).
    pub equipment: Vec<(&'static str, Option<(String, u8)>)>,
    /// (name, rarity, x, y, w, h) per bag item.
    pub inventory: Vec<(String, u8, u8, u8, u8, u8)>,
    /// (name, level, is_support) — supports follow their skill.
    pub gems: Vec<(String, u32, bool)>,
    pub passive_allocated: u32,
    pub passive_unspent: u32,
    pub build_len: u32,
}

impl World {
    /// Inspect one character by net id (None for monsters/loot/unknown).
    pub fn character_sheet(&self, net_id: u32) -> Option<CharacterSheetView> {
        const SLOT_NAMES: [&str; 5] = ["Weapon", "Offhand", "Helm", "Chest", "Boots"];
        let e = self.zone.get_net(net_id)?;
        let ch = e.character.as_ref()?;
        let c = e.combat.as_ref()?;
        let equipment = ch
            .equipment
            .iter()
            .enumerate()
            .map(|(i, s)| {
                (
                    SLOT_NAMES[i],
                    s.as_ref().map(|item| {
                        (
                            self.content.items[item.base_idx as usize].name.clone(),
                            item.rarity as u8,
                        )
                    }),
                )
            })
            .collect();
        let inventory = ch
            .inventory
            .iter()
            .map(|p| {
                let def = &self.content.items[p.item.base_idx as usize];
                (
                    def.name.clone(),
                    p.item.rarity as u8,
                    p.x,
                    p.y,
                    def.w,
                    def.h,
                )
            })
            .collect();
        let mut gems = Vec::new();
        for sg in ch.sockets.values() {
            gems.push((
                self.content.gems[sg.gem.gem_idx as usize].name.clone(),
                sg.gem.level,
                false,
            ));
            for sup in &sg.supports {
                gems.push((
                    self.content.gems[sup.gem_idx as usize].name.clone(),
                    sup.level,
                    true,
                ));
            }
        }
        Some(CharacterSheetView {
            id: e.net_id,
            name: ch.name.clone(),
            level: ch.level,
            xp: ch.xp,
            xp_next: super::progression::xp_to_next(ch.level),
            life: c.life,
            life_max: c.life_max,
            mana: c.mana,
            mana_max: c.mana_max,
            es: c.es,
            es_max: c.es_max,
            block: c.block,
            kills: ch.kills,
            damage: c.damage,
            accuracy: c.accuracy,
            evasion: c.evasion,
            armour: c.armour,
            resists: c.resists,
            equipment,
            inventory,
            gems,
            passive_allocated: ch.allocated.len() as u32,
            passive_unspent: ch.passive_points(),
            build_len: ch.build_plan.len() as u32,
        })
    }

    /// The generated obstacle layout as raw Q16.16 (x, y, radius, kind),
    /// for the snapshot — constant for the zone's lifetime.
    pub fn obstacle_views(&self) -> Vec<(i32, i32, i32, u8)> {
        self.zone
            .obstacles
            .iter()
            .map(|o| (o.pos.x.raw(), o.pos.y.raw(), o.radius.raw(), o.kind))
            .collect()
    }

    /// Flat per-entity views for replication.
    pub fn views(&self) -> Vec<EntityView> {
        self.zone
            .iter()
            .map(|(_, e)| {
                let combat = e.combat.as_ref();
                let (name, model, weapon, gear, level, rarity, dead, kills, items) =
                    if let Some(ch) = &e.character {
                        // The equipped weapon's visual key, for the client's
                        // hand-attachment mesh ("" = unarmed).
                        let weapon = ch.equipment[GearSlot::Weapon.idx()]
                            .as_ref()
                            .map(|item| self.content.items[item.base_idx as usize].model.clone())
                            .unwrap_or_default();
                        // Armor visual part keys in gear-slot order: the
                        // client's paper-doll composes the model from these.
                        let gear: Vec<String> = ch
                            .equipment
                            .iter()
                            .enumerate()
                            .filter(|(i, _)| *i != GearSlot::Weapon.idx())
                            .filter_map(|(_, slot)| slot.as_ref())
                            .map(|item| self.content.items[item.base_idx as usize].model.clone())
                            .filter(|m| !m.is_empty())
                            .collect();
                        (
                            ch.name.clone(),
                            "idler".to_string(),
                            weapon,
                            gear,
                            ch.level,
                            0,
                            !e.alive(),
                            ch.kills,
                            ch.items,
                        )
                    } else if let Some(m) = &e.monster {
                        let def = self.monster_def(m.def_idx);
                        (
                            def.name.clone(),
                            def.model.clone(),
                            String::new(),
                            Vec::new(),
                            def.level,
                            0,
                            !e.alive(),
                            0,
                            0,
                        )
                    } else {
                        let l = e.loot.as_ref().unwrap();
                        // Drops render as their actual item when the def
                        // names a model; gems and plain bases fall back to
                        // generic pickups.
                        let model = match &l.payload {
                            LootPayload::Gear(item) => {
                                let m = &self.content.items[item.base_idx as usize].model;
                                if m.is_empty() {
                                    "loot".to_string()
                                } else {
                                    m.clone()
                                }
                            }
                            LootPayload::Gem(_) => "gem".to_string(),
                        };
                        (
                            String::new(),
                            model,
                            String::new(),
                            Vec::new(),
                            0,
                            l.rarity as u8,
                            false,
                            0,
                            0,
                        )
                    };
                EntityView {
                    id: e.net_id,
                    kind: e.kind_code() as u8,
                    x_raw: e.pos.x.raw(),
                    y_raw: e.pos.y.raw(),
                    life_pct: combat.map(|c| c.life_pct()).unwrap_or(0),
                    level,
                    name,
                    model,
                    weapon,
                    gear,
                    rarity,
                    dead,
                    kills,
                    items,
                }
            })
            .collect()
    }

    /// Canonical state hash for determinism checks (replays, snapshots, CI).
    pub fn state_hash(&self) -> u64 {
        let mut h = Fnv1a64::new();
        h.write_u64(self.seed);
        h.write_u64(self.content_hash);
        h.write_u64(self.tick);
        h.write_u32(self.next_net_id);
        for rng in [&self.rng_ai, &self.rng_combat, &self.rng_loot] {
            let (state, inc) = rng.state();
            h.write_u64(state);
            h.write_u64(inc);
        }
        let fold_item = |h: &mut Fnv1a64, item: &Item| {
            h.write_u32(item.base_idx);
            h.write_u8(item.rarity as u8);
            h.write_u32(item.item_level);
            h.write_u64(item.affixes.len() as u64);
            for ra in &item.affixes {
                h.write_u32(ra.affix_idx);
                h.write_i64(ra.value);
            }
        };
        for (slot, e) in self.zone.iter() {
            h.write_u64(slot as u64);
            h.write_u32(e.net_id);
            h.write_i32(e.pos.x.raw());
            h.write_i32(e.pos.y.raw());
            h.write_u32(e.bot.map(|b| b + 1).unwrap_or(0));
            if let Some(c) = &e.combat {
                h.write_i64(c.life);
                h.write_i64(c.life_max);
                for d in c.damage {
                    h.write_i64(d);
                }
                h.write_i64(c.accuracy);
                h.write_i64(c.evasion);
                h.write_i64(c.armour);
                for r in c.resists {
                    h.write_i64(r);
                }
                h.write_i64(c.mana);
                h.write_i64(c.mana_max);
                h.write_i64(c.es);
                h.write_i64(c.es_max);
                h.write_u64(c.es_recharge_at);
                h.write_i64(c.block);
                h.write_i64(c.crit_inc);
                h.write_i64(c.crit_multi);
                h.write_i64(c.cast_speed);
                h.write_u64(c.busy_until);
                h.write_u64(c.last_combat_tick);
                h.write_i32(c.radius.raw());
            }
            if let Some(ch) = &e.character {
                h.write_bytes(ch.name.as_bytes());
                h.write_u32(ch.level);
                h.write_i64(ch.xp);
                h.write_u64(ch.respawn_at.unwrap_or(0));
                h.write_u64(ch.kills);
                h.write_u64(ch.items);
                h.write_u64(ch.inventory.len() as u64);
                for placed in &ch.inventory {
                    h.write_u8(placed.x);
                    h.write_u8(placed.y);
                    fold_item(&mut h, &placed.item);
                }
                for slot_item in &ch.equipment {
                    match slot_item {
                        Some(item) => {
                            h.write_u8(1);
                            fold_item(&mut h, item);
                        }
                        None => h.write_u8(0),
                    }
                }
                h.write_u64(ch.allocated.len() as u64);
                for &n in &ch.allocated {
                    h.write_u32(n);
                }
                h.write_u64(ch.pouch.len() as u64);
                for gem in &ch.pouch {
                    h.write_u32(gem.gem_idx);
                    h.write_u32(gem.level);
                    h.write_i64(gem.xp);
                }
                for (node, sg) in &ch.sockets {
                    h.write_u32(*node);
                    h.write_u32(sg.gem.gem_idx);
                    h.write_u32(sg.gem.level);
                    h.write_i64(sg.gem.xp);
                    h.write_u32(sg.cooldown_left);
                    h.write_u64(sg.supports.len() as u64);
                    for sup in &sg.supports {
                        h.write_u32(sup.gem_idx);
                        h.write_u32(sup.level);
                        h.write_i64(sup.xp);
                    }
                }
            }
            h.write_u64(e.effects.len() as u64);
            for ef in &e.effects {
                match ef {
                    crate::entity::ActiveEffect::Dot {
                        dtype,
                        per_second,
                        ticks_left,
                        source,
                        skill,
                    } => {
                        h.write_u8(1);
                        h.write_u8(*dtype);
                        h.write_i64(*per_second);
                        h.write_u32(*ticks_left);
                        h.write_u32(*source);
                        h.write_u32(*skill);
                    }
                    crate::entity::ActiveEffect::Buff { grants, ticks_left } => {
                        h.write_u8(2);
                        h.write_u64(grants.len() as u64);
                        h.write_u32(*ticks_left);
                    }
                }
            }
            if let Some(m) = &e.monster {
                h.write_u32(m.def_idx);
                h.write_u8(m.hostile as u8);
                h.write_i32(m.anchor.x.raw());
                h.write_i32(m.anchor.y.raw());
                h.write_u64(m.decay_at.unwrap_or(0));
            }
            if let Some(l) = &e.loot {
                h.write_u8(l.rarity as u8);
                h.write_u32(l.owner);
                h.write_u64(l.despawn_at);
                match &l.payload {
                    LootPayload::Gear(item) => {
                        h.write_u8(1);
                        fold_item(&mut h, item);
                    }
                    LootPayload::Gem(gem) => {
                        h.write_u8(2);
                        h.write_u32(gem.gem_idx);
                        h.write_u32(gem.level);
                        h.write_i64(gem.xp);
                    }
                }
            }
        }
        for pack in &self.zone.packs {
            h.write_u32(pack.alive);
            h.write_u32(pack.respawn_timer);
        }
        for p in &self.zone.projectiles {
            h.write_i32(p.pos.x.raw());
            h.write_i32(p.pos.y.raw());
            h.write_i32(p.vel.x.raw());
            h.write_i32(p.vel.y.raw());
            h.write_i32(p.remaining.raw());
            h.write_u32(p.source);
            h.write_u32(p.pierce);
        }
        for ob in &self.zone.obstacles {
            h.write_i32(ob.pos.x.raw());
            h.write_i32(ob.pos.y.raw());
            h.write_i32(ob.radius.raw());
            h.write_u8(ob.kind);
        }
        for (idx, bot) in self.bots.iter() {
            h.write_u64(idx as u64);
            for b in bot.vm.state_bytes() {
                h.write_u8(b);
            }
            let (state, inc) = bot.rng.state();
            h.write_u64(state);
            h.write_u64(inc);
            h.write_bytes(&bot.params);
            h.write_u64(bot.program_hash);
            h.write_u32(bot.version);
        }
        h.finish()
    }
}
