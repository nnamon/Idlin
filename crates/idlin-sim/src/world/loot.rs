//! Loot generation: what drops, what it rolls into (base, rarity, affixes
//! tiered by item level), and ground-loot entity spawning.

use super::{LOOT_DESPAWN_TICKS, World};
use crate::entity::{Entity, GemInstance, Item, LootPayload, LootState, Rarity, RolledAffix};
use crate::fixed::FxV2;
use idlin_content::AffixKind;

impl World {
    pub(super) fn payload_display(&self, payload: &LootPayload) -> (Rarity, String) {
        match payload {
            LootPayload::Gear(item) => (item.rarity, self.item_display(item)),
            LootPayload::Gem(gem) => (
                Rarity::Normal,
                self.content.gems[gem.gem_idx as usize].name.clone(),
            ),
        }
    }

    /// One display string per item. Magic names already carry the base
    /// ("Heavy Driftwood Bow of the Wind"); generated rare/unique names
    /// show it in parentheses so the base type stays readable.
    pub(crate) fn item_display(&self, item: &Item) -> String {
        let base = &self.content.items[item.base_idx as usize].name;
        if item.name.is_empty() {
            base.clone()
        } else if matches!(item.rarity, Rarity::Rare | Rarity::Unique) {
            format!("{} ({})", item.name, base)
        } else {
            item.name.clone()
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
        // PoE-style prefix/suffix budgets: magic carries at most one of
        // each; rare and unique up to three of each.
        let (affix_count, kind_cap) = match rarity {
            Rarity::Normal => (0, 0),
            Rarity::Magic => (1 + self.rng_loot.next_range(2), 1),
            Rarity::Rare => (3 + self.rng_loot.next_range(3), 3),
            Rarity::Unique => (4 + self.rng_loot.next_range(2), 3),
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
        let (mut prefixes, mut suffixes) = (0u32, 0u32);
        for _ in 0..affix_count {
            pool.retain(|&i| {
                let k = self.content.affixes[i as usize].kind;
                match k {
                    AffixKind::Prefix => prefixes < kind_cap,
                    AffixKind::Suffix => suffixes < kind_cap,
                }
            });
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
            match affix.kind {
                AffixKind::Prefix => prefixes += 1,
                AffixKind::Suffix => suffixes += 1,
            }
            let span = (tier.max - tier.min).max(0) as u32 + 1;
            let value = tier.min + self.rng_loot.next_range(span) as i64;
            affixes.push(RolledAffix { affix_idx, value });
        }
        let name = self.roll_name(rarity, base_idx, &affixes);
        Some(Item {
            base_idx,
            rarity,
            item_level: monster_level,
            affixes,
            name,
        })
    }

    /// Item display names, the PoE way. Normal = the base. Magic = the
    /// rolled affix names around the base ("Heavy Driftwood Bow of the
    /// Wind"). Rare and unique draw a two-word name from the content word
    /// pools ("Vile Thorns") — uniques keep rolled names until real unique
    /// defs exist.
    fn roll_name(&mut self, rarity: Rarity, base_idx: u32, affixes: &[RolledAffix]) -> String {
        let base = &self.content.items[base_idx as usize].name;
        match rarity {
            Rarity::Normal => base.clone(),
            Rarity::Magic => {
                let (mut prefix, mut suffix) = (None, None);
                for ra in affixes {
                    let a = &self.content.affixes[ra.affix_idx as usize];
                    match a.kind {
                        AffixKind::Prefix => prefix = Some(a.name.as_str()),
                        AffixKind::Suffix => suffix = Some(a.name.as_str()),
                    }
                }
                let mut s = String::new();
                if let Some(p) = prefix {
                    s.push_str(p);
                    s.push(' ');
                }
                s.push_str(base);
                if let Some(suf) = suffix {
                    s.push(' ');
                    s.push_str(suf);
                }
                s
            }
            Rarity::Rare | Rarity::Unique => {
                let pools = &self.content.naming;
                if pools.first.is_empty() || pools.second.is_empty() {
                    return base.clone();
                }
                let f = self.rng_loot.next_range(pools.first.len() as u32) as usize;
                let s = self.rng_loot.next_range(pools.second.len() as u32) as usize;
                format!("{} {}", pools.first[f], pools.second[s])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::World;
    use crate::entity::{LootPayload, Rarity};
    use idlin_content::{AffixKind, ContentDb};
    use std::path::Path;

    /// Roll a pile of real-content gear and hold every item to the naming
    /// and prefix/suffix budget rules at once.
    #[test]
    fn names_and_affix_budgets_follow_the_poe_rules() {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut world = World::new(0xD1CE, &content);
        let mut seen = [0usize; 4];
        for _ in 0..4000 {
            let Some(LootPayload::Gear(item)) = world.roll_drop(5) else {
                continue;
            };
            seen[item.rarity as usize] += 1;
            let base = &content.items[item.base_idx as usize].name;
            let (mut prefixes, mut suffixes) = (0, 0);
            for ra in &item.affixes {
                match content.affixes[ra.affix_idx as usize].kind {
                    AffixKind::Prefix => prefixes += 1,
                    AffixKind::Suffix => suffixes += 1,
                }
            }
            match item.rarity {
                Rarity::Normal => {
                    assert_eq!(item.affixes.len(), 0);
                    assert_eq!(&item.name, base, "normal items are just the base");
                }
                Rarity::Magic => {
                    assert!(
                        prefixes <= 1 && suffixes <= 1,
                        "magic: 1 prefix + 1 suffix max"
                    );
                    assert!(
                        item.name.contains(base.as_str()),
                        "magic names wrap the base: {} vs {}",
                        item.name,
                        base
                    );
                }
                Rarity::Rare | Rarity::Unique => {
                    assert!(prefixes <= 3 && suffixes <= 3);
                    assert!(
                        !item.name.contains(base.as_str()),
                        "rare names are generated, not base-derived: {}",
                        item.name
                    );
                    assert_eq!(
                        item.name.split(' ').count(),
                        2,
                        "two-word generated name: {}",
                        item.name
                    );
                }
            }
        }
        // The sample must actually cover the tiers we assert about.
        assert!(seen[0] > 100 && seen[1] > 50 && seen[2] > 10, "{seen:?}");
    }
}
