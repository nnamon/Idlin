//! Loot generation: what drops, what it rolls into (base, rarity, affixes
//! tiered by item level), and ground-loot entity spawning.

use super::{LOOT_DESPAWN_TICKS, World};
use crate::entity::{Entity, GemInstance, Item, LootPayload, LootState, Rarity, RolledAffix};
use crate::fixed::FxV2;

impl World {
    pub(super) fn payload_display(&self, payload: &LootPayload) -> (Rarity, String) {
        match payload {
            LootPayload::Gear(item) => (
                item.rarity,
                self.content.items[item.base_idx as usize].name.clone(),
            ),
            LootPayload::Gem(gem) => (
                Rarity::Normal,
                self.content.gems[gem.gem_idx as usize].name.clone(),
            ),
        }
    }

    pub(super) fn spawn_loot(&mut self, pos: FxV2, payload: LootPayload, owner: u32) {
        let net_id = self.alloc_net();
        let (rarity, _) = self.payload_display(&payload);
        self.zone.insert(Entity {
            net_id,
            pos,
            intents: Default::default(),
            effects: Vec::new(),
            bot: None,
            combat: None,
            character: None,
            monster: None,
            loot: Some(LootState {
                payload,
                rarity,
                owner,
                despawn_at: self.tick + LOOT_DESPAWN_TICKS,
            }),
        });
    }

    /// What falls out of a monster: usually gear, sometimes a gem.
    pub(super) fn roll_drop(&mut self, monster_level: u32) -> Option<LootPayload> {
        if !self.content.gems.is_empty() && self.rng_loot.next_range(100) < 12 {
            let total: u32 = self.content.gems.iter().map(|g| g.weight).sum();
            if total > 0 {
                let mut roll = self.rng_loot.next_range(total);
                let mut gem_idx = 0u32;
                for (i, def) in self.content.gems.iter().enumerate() {
                    if roll < def.weight {
                        gem_idx = i as u32;
                        break;
                    }
                    roll -= def.weight;
                }
                return Some(LootPayload::Gem(GemInstance {
                    gem_idx,
                    level: 1,
                    xp: 0,
                }));
            }
        }
        self.roll_item(monster_level).map(LootPayload::Gear)
    }

    /// Roll a concrete item: weighted base pick, rarity, then affixes from
    /// the slot's pool with tiers gated by item level.
    fn roll_item(&mut self, monster_level: u32) -> Option<Item> {
        let total: u32 = self.content.items.iter().map(|i| i.weight).sum();
        if total == 0 {
            return None;
        }
        let mut roll = self.rng_loot.next_range(total);
        let mut base_idx = 0u32;
        for (i, def) in self.content.items.iter().enumerate() {
            if roll < def.weight {
                base_idx = i as u32;
                break;
            }
            roll -= def.weight;
        }
        let r = self.rng_loot.next_range(1000);
        let rarity = if r < 700 {
            Rarity::Normal
        } else if r < 950 {
            Rarity::Magic
        } else if r < 995 {
            Rarity::Rare
        } else {
            Rarity::Unique
        };
        let affix_count = match rarity {
            Rarity::Normal => 0,
            Rarity::Magic => 1 + self.rng_loot.next_range(2),
            Rarity::Rare => 3 + self.rng_loot.next_range(3),
            Rarity::Unique => 4 + self.rng_loot.next_range(2),
        };
        let slot = self.content.items[base_idx as usize].slot;
        let mut pool: Vec<u32> = self
            .content
            .affixes
            .iter()
            .enumerate()
            .filter(|(_, a)| a.slots.contains(&slot))
            .map(|(i, _)| i as u32)
            .collect();
        let mut affixes = Vec::new();
        for _ in 0..affix_count {
            if pool.is_empty() {
                break;
            }
            let weights: u32 = pool
                .iter()
                .map(|&i| self.content.affixes[i as usize].weight)
                .sum();
            if weights == 0 {
                break;
            }
            let mut pick = self.rng_loot.next_range(weights);
            let mut chosen = 0usize;
            for (pi, &ai) in pool.iter().enumerate() {
                let w = self.content.affixes[ai as usize].weight;
                if pick < w {
                    chosen = pi;
                    break;
                }
                pick -= w;
            }
            let affix_idx = pool.remove(chosen);
            let affix = &self.content.affixes[affix_idx as usize];
            // Highest tier the item level allows.
            let Some(tier) = affix.tiers.iter().rev().find(|t| t.ilvl <= monster_level) else {
                continue;
            };
            let span = (tier.max - tier.min).max(0) as u32 + 1;
            let value = tier.min + self.rng_loot.next_range(span) as i64;
            affixes.push(RolledAffix { affix_idx, value });
        }
        Some(Item {
            base_idx,
            rarity,
            item_level: monster_level,
            affixes,
        })
    }
}
