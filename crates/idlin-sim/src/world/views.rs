//! What the outside world sees: flat per-entity views for replication, and
//! the canonical FNV-1a state hash that pins replays, snapshots, and CI.

use super::{EntityView, World};
use crate::entity::{Item, LootPayload};
use crate::hash::Fnv1a64;

impl World {
    /// Flat per-entity views for replication.
    pub fn views(&self) -> Vec<EntityView> {
        self.zone
            .iter()
            .map(|(_, e)| {
                let combat = e.combat.as_ref();
                let (name, model, level, rarity, dead, kills, items) =
                    if let Some(ch) = &e.character {
                        (
                            ch.name.clone(),
                            "hero".to_string(),
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
                            def.level,
                            0,
                            false,
                            0,
                            0,
                        )
                    } else {
                        let l = e.loot.as_ref().unwrap();
                        (
                            String::new(),
                            "loot".to_string(),
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
                h.write_i64(c.resist_ele);
                h.write_i64(c.resist_chaos);
                h.write_u32(c.cooldown_left);
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
            if let Some(m) = &e.monster {
                h.write_u32(m.def_idx);
                h.write_u8(m.hostile as u8);
                h.write_i32(m.anchor.x.raw());
                h.write_i32(m.anchor.y.raw());
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
