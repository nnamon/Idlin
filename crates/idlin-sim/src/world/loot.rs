//! Loot generation: what drops, what it rolls into (base, rarity, affixes
//! tiered by item level), and ground-loot entity spawning.

use super::{LOOT_DESPAWN_TICKS, SimEvent, World};
use crate::entity::{Entity, GemInstance, Item, LootPayload, LootState, Rarity, RolledAffix};
use crate::fixed::FxV2;
use crate::rng::Pcg32;
use idlin_content::{AffixKind, ContentDb, CurrencyOp};

impl World {
    pub(super) fn payload_display(&self, payload: &LootPayload) -> (Rarity, String) {
        match payload {
            LootPayload::Gear(item) => (item.rarity, self.item_display(item)),
            LootPayload::Gem(gem) => (
                Rarity::Normal,
                self.content.gems[gem.gem_idx as usize].name.clone(),
            ),
            LootPayload::Currency(idx) => {
                let def = &self.content.currency[*idx as usize];
                // Display tier doubles as the pillar color.
                let rarity = match def.tier {
                    0 => Rarity::Normal,
                    1 => Rarity::Magic,
                    2 => Rarity::Rare,
                    _ => Rarity::Unique,
                };
                (rarity, def.name.clone())
            }
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
            last_say_tick: 0,
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

    /// One kill's full drop set, the PoE way: QUANTITY first (the killer's
    /// factor scales the number of drop rolls; whole overflow = guaranteed
    /// extra drops), then each roll picks its class and — for gear — its
    /// rarity under the killer's RARITY factor. Excess normal-rarity gear
    /// (beyond the first per kill) compacts into a low-tier obol instead
    /// of littering the shore.
    pub(super) fn roll_kill_drops(
        &mut self,
        monster_level: u32,
        killer_slot: Option<usize>,
    ) -> Vec<LootPayload> {
        let (quantity, rarity) = killer_slot
            .and_then(|s| self.zone.get(s))
            .and_then(|e| e.combat.as_ref())
            .map(|c| (c.item_quantity.max(0), c.item_rarity.max(0)))
            .unwrap_or((10000, 10000));
        // Base 35% chance per kill, scaled: 10000 bp of "expected" per
        // guaranteed drop, the remainder as one more bernoulli roll.
        let expected = 3500i64 * quantity / 10000;
        let mut rolls = (expected / 10000) as u32;
        if (self.rng_loot.next_range(10000) as i64) < expected % 10000 {
            rolls += 1;
        }
        let mut drops = Vec::new();
        let mut normals = 0u32;
        for _ in 0..rolls {
            let Some(payload) = self.roll_drop(monster_level, rarity) else {
                continue;
            };
            if let LootPayload::Gear(item) = &payload
                && item.rarity == Rarity::Normal
            {
                normals += 1;
                if normals > 1 {
                    // Trash compaction: the shore stays readable and the
                    // kill still pays something.
                    if let Some(obol) = self.roll_trash_obol() {
                        drops.push(LootPayload::Currency(obol));
                        continue;
                    }
                }
            }
            drops.push(payload);
        }
        drops
    }

    /// A weighted low-tier obol (tier ≤ 1) for trash compaction.
    fn roll_trash_obol(&mut self) -> Option<u32> {
        let total: u32 = self
            .content
            .currency
            .iter()
            .filter(|c| c.tier <= 1)
            .map(|c| c.weight)
            .sum();
        if total == 0 {
            return None;
        }
        let mut roll = self.rng_loot.next_range(total);
        for (i, def) in self.content.currency.iter().enumerate() {
            if def.tier > 1 {
                continue;
            }
            if roll < def.weight {
                return Some(i as u32);
            }
            roll -= def.weight;
        }
        None
    }

    /// One drop roll: usually gear, sometimes a gem or an obol of crafting
    /// currency. `rarity_bp` (killer's factor) scales the magic/rare/unique
    /// weights of gear; the normal weight never moves.
    pub(super) fn roll_drop(&mut self, monster_level: u32, rarity_bp: i64) -> Option<LootPayload> {
        if !self.content.currency.is_empty() && self.rng_loot.next_range(100) < 10 {
            let total: u32 = self.content.currency.iter().map(|c| c.weight).sum();
            if total > 0 {
                let mut roll = self.rng_loot.next_range(total);
                for (i, def) in self.content.currency.iter().enumerate() {
                    if roll < def.weight {
                        return Some(LootPayload::Currency(i as u32));
                    }
                    roll -= def.weight;
                }
            }
        }
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
        self.roll_item(monster_level, rarity_bp)
            .map(LootPayload::Gear)
    }

    /// A scripted roll at a forced rarity (zone-brain DropLoot): weighted
    /// base pick, then the standard affix/budget/naming machinery.
    pub(super) fn roll_item_forced(&mut self, item_level: u32, rarity: Rarity) -> Option<Item> {
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
        let (affix_count, kind_cap) = match rarity {
            Rarity::Normal => (0, 0),
            Rarity::Magic => (1 + self.rng_loot.next_range(2), 1),
            Rarity::Rare => (3 + self.rng_loot.next_range(3), 3),
            Rarity::Unique => (4 + self.rng_loot.next_range(2), 3),
        };
        let mut item = Item {
            base_idx,
            rarity,
            item_level,
            affixes: Vec::new(),
            name: String::new(),
        };
        roll_affixes(
            &self.content,
            &mut self.rng_loot,
            &mut item,
            affix_count,
            kind_cap,
        );
        item.name = compose_name(&self.content, &mut self.rng_loot, &item);
        Some(item)
    }

    /// Roll a concrete item: weighted base pick, rarity, then affixes from
    /// the slot's pool with tiers gated by item level.
    fn roll_item(&mut self, monster_level: u32, rarity_bp: i64) -> Option<Item> {
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
        // PoE-shaped rarity: normal's weight is fixed; the others scale
        // with the killer's increased-rarity factor.
        let w_normal = 700i64;
        let w_magic = 250 * rarity_bp / 10000;
        let w_rare = 45 * rarity_bp / 10000;
        let w_unique = 5 * rarity_bp / 10000;
        let total = (w_normal + w_magic + w_rare + w_unique).max(1) as u32;
        let r = self.rng_loot.next_range(total) as i64;
        let rarity = if r < w_normal {
            Rarity::Normal
        } else if r < w_normal + w_magic {
            Rarity::Magic
        } else if r < w_normal + w_magic + w_rare {
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
        let mut item = Item {
            base_idx,
            rarity,
            item_level: monster_level,
            affixes: Vec::new(),
            name: String::new(),
        };
        roll_affixes(
            &self.content,
            &mut self.rng_loot,
            &mut item,
            affix_count,
            kind_cap,
        );
        item.name = compose_name(&self.content, &mut self.rng_loot, &item);
        Some(item)
    }

    /// Spend one obol on a bag item. Returns 0, −1 (bad indices / no
    /// stock / no item), or −2 (the verb doesn't apply to this item).
    pub(crate) fn use_currency(
        &mut self,
        slot: usize,
        currency_sel: i32,
        inv_sel: i32,
        events: &mut Vec<SimEvent>,
    ) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let (net_id, owner) = (e.net_id, ch.name.clone());
        if currency_sel < 0 || currency_sel as usize >= self.content.currency.len() {
            return -1;
        }
        let cidx = currency_sel as usize;
        if ch.currency.get(cidx).copied().unwrap_or(0) == 0 {
            return -1;
        }
        if inv_sel < 0 || inv_sel as usize >= ch.inventory.len() {
            return -1;
        }
        let inv = inv_sel as usize;
        let mut item = ch.inventory[inv].item.clone();
        let op = self.content.currency[cidx].op;
        if !apply_currency_op(&self.content, &mut self.rng_craft, op, &mut item) {
            return -2;
        }
        let currency_name = self.content.currency[cidx].name.clone();
        let item_name = self.item_display(&item);
        let me = self.zone.get_mut(slot).unwrap();
        let ch = me.character.as_mut().unwrap();
        ch.currency[cidx] -= 1;
        ch.inventory[inv].item = item;
        events.push(SimEvent::CurrencyUsed {
            id: net_id,
            owner,
            currency: currency_name,
            item: item_name,
        });
        0
    }
}

/// Roll `add` fresh affixes onto an item: pool = the slot's affixes minus
/// ones already present, prefix/suffix budgets shared with what's there,
/// tiers gated by the item's level.
fn roll_affixes(content: &ContentDb, rng: &mut Pcg32, item: &mut Item, add: u32, kind_cap: u32) {
    let pools = &content.items[item.base_idx as usize].affix_pools;
    let (mut prefixes, mut suffixes) = (0u32, 0u32);
    for ra in &item.affixes {
        match content.affixes[ra.affix_idx as usize].kind {
            AffixKind::Prefix => prefixes += 1,
            AffixKind::Suffix => suffixes += 1,
        }
    }
    let mut pool: Vec<u32> = content
        .affixes
        .iter()
        .enumerate()
        .filter(|(i, a)| {
            pools.contains(&a.pool) && !item.affixes.iter().any(|ra| ra.affix_idx == *i as u32)
        })
        .map(|(i, _)| i as u32)
        .collect();
    for _ in 0..add {
        pool.retain(|&i| match content.affixes[i as usize].kind {
            AffixKind::Prefix => prefixes < kind_cap,
            AffixKind::Suffix => suffixes < kind_cap,
        });
        if pool.is_empty() {
            break;
        }
        let weights: u32 = pool
            .iter()
            .map(|&i| content.affixes[i as usize].weight)
            .sum();
        if weights == 0 {
            break;
        }
        let mut pick = rng.next_range(weights);
        let mut chosen = 0usize;
        for (pi, &ai) in pool.iter().enumerate() {
            let w = content.affixes[ai as usize].weight;
            if pick < w {
                chosen = pi;
                break;
            }
            pick -= w;
        }
        let affix_idx = pool.remove(chosen);
        let affix = &content.affixes[affix_idx as usize];
        // Weighted pick among the tiers the item level allows — higher
        // tiers author lower weights, so T1 stays a chase roll.
        let eligible: Vec<usize> = affix
            .tiers
            .iter()
            .enumerate()
            .filter(|(_, t)| t.ilvl <= item.item_level && t.weight > 0)
            .map(|(ti, _)| ti)
            .collect();
        let tier_total: u32 = eligible.iter().map(|&ti| affix.tiers[ti].weight).sum();
        if tier_total == 0 {
            continue;
        }
        let mut tpick = rng.next_range(tier_total);
        let mut tier_idx = eligible[0];
        for &ti in &eligible {
            let w = affix.tiers[ti].weight;
            if tpick < w {
                tier_idx = ti;
                break;
            }
            tpick -= w;
        }
        let tier = &affix.tiers[tier_idx];
        match affix.kind {
            AffixKind::Prefix => prefixes += 1,
            AffixKind::Suffix => suffixes += 1,
        }
        let span = (tier.max - tier.min).max(0) as u32 + 1;
        let value = tier.min + rng.next_range(span) as i64;
        item.affixes.push(RolledAffix {
            affix_idx,
            value,
            tier: tier_idx as u32,
        });
    }
}

/// Item display names, the PoE way. Normal = the base. Magic = the rolled
/// affix names around the base ("Heavy Driftwood Bow of the Wind"). Rare
/// and unique draw a two-word name from the content pools ("Vile Thorns")
/// — uniques keep rolled names until real unique defs exist.
fn compose_name(content: &ContentDb, rng: &mut Pcg32, item: &Item) -> String {
    let base = &content.items[item.base_idx as usize].name;
    match item.rarity {
        Rarity::Normal => base.clone(),
        Rarity::Magic => {
            let (mut prefix, mut suffix) = (None, None);
            for ra in &item.affixes {
                let a = &content.affixes[ra.affix_idx as usize];
                // The rolled TIER names the item; family name is fallback.
                let n = a
                    .tiers
                    .get(ra.tier as usize)
                    .filter(|t| !t.name.is_empty())
                    .map_or(a.name.as_str(), |t| t.name.as_str());
                match a.kind {
                    AffixKind::Prefix => prefix = Some(n),
                    AffixKind::Suffix => suffix = Some(n),
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
            let pools = &content.naming;
            if pools.first.is_empty() || pools.second.is_empty() {
                return base.clone();
            }
            let f = rng.next_range(pools.first.len() as u32) as usize;
            let s = rng.next_range(pools.second.len() as u32) as usize;
            format!("{} {}", pools.first[f], pools.second[s])
        }
    }
}

/// Apply one obol verb to an item. False = the verb doesn't fit (wrong
/// rarity, or nothing it could change).
fn apply_currency_op(
    content: &ContentDb,
    rng: &mut Pcg32,
    op: CurrencyOp,
    item: &mut Item,
) -> bool {
    use CurrencyOp::*;
    let renamed = |content: &ContentDb, rng: &mut Pcg32, item: &mut Item| {
        item.name = compose_name(content, rng, item);
    };
    match op {
        ToMagic => {
            if item.rarity != Rarity::Normal {
                return false;
            }
            item.rarity = Rarity::Magic;
            let n = 1 + rng.next_range(2);
            roll_affixes(content, rng, item, n, 1);
            renamed(content, rng, item);
            true
        }
        AddAffixMagic => {
            if item.rarity != Rarity::Magic || item.affixes.len() >= 2 {
                return false;
            }
            let before = item.affixes.len();
            roll_affixes(content, rng, item, 1, 1);
            if item.affixes.len() == before {
                return false; // budget full or pool dry: don't burn the obol
            }
            renamed(content, rng, item);
            true
        }
        RerollMagic => {
            if item.rarity != Rarity::Magic {
                return false;
            }
            item.affixes.clear();
            let n = 1 + rng.next_range(2);
            roll_affixes(content, rng, item, n, 1);
            renamed(content, rng, item);
            true
        }
        ToRare => {
            if item.rarity != Rarity::Magic {
                return false;
            }
            item.rarity = Rarity::Rare;
            roll_affixes(content, rng, item, 1, 3);
            renamed(content, rng, item);
            true
        }
        NormalToRare => {
            if item.rarity != Rarity::Normal {
                return false;
            }
            item.rarity = Rarity::Rare;
            let n = 3 + rng.next_range(3);
            roll_affixes(content, rng, item, n, 3);
            renamed(content, rng, item);
            true
        }
        RerollRare => {
            if item.rarity != Rarity::Rare {
                return false;
            }
            item.affixes.clear();
            let n = 3 + rng.next_range(3);
            roll_affixes(content, rng, item, n, 3);
            renamed(content, rng, item);
            true
        }
        AddAffixRare => {
            if item.rarity != Rarity::Rare || item.affixes.len() >= 6 {
                return false;
            }
            let before = item.affixes.len();
            roll_affixes(content, rng, item, 1, 3);
            item.affixes.len() > before // Exalted keeps the name
        }
        ToNormal => {
            if !matches!(item.rarity, Rarity::Magic | Rarity::Rare) {
                return false;
            }
            item.rarity = Rarity::Normal;
            item.affixes.clear();
            renamed(content, rng, item);
            true
        }
        RerollValues => {
            if item.affixes.is_empty() {
                return false;
            }
            for ra in item.affixes.iter_mut() {
                let affix = &content.affixes[ra.affix_idx as usize];
                if let Some(tier) = affix.tiers.iter().rev().find(|t| t.ilvl <= item.item_level) {
                    let span = (tier.max - tier.min).max(0) as u32 + 1;
                    ra.value = tier.min + rng.next_range(span) as i64;
                }
            }
            true // Divine keeps the name
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
            let Some(LootPayload::Gear(item)) = world.roll_drop(5, 10000) else {
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

#[cfg(test)]
mod craft_tests {
    use super::*;
    use crate::rng::{Domain, Pcg32};
    use idlin_content::AffixKind;
    use std::path::Path;

    fn setup() -> (ContentDb, Pcg32, Item) {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let rng = Pcg32::stream(0xC4AF7, Domain::Craft, 0);
        let base_idx = content
            .items
            .iter()
            .position(|i| i.id == "driftwood_bow")
            .unwrap() as u32;
        let item = Item {
            base_idx,
            rarity: Rarity::Normal,
            item_level: 5,
            affixes: Vec::new(),
            name: content.items[base_idx as usize].name.clone(),
        };
        (content, rng, item)
    }

    fn kinds(content: &ContentDb, item: &Item) -> (usize, usize) {
        let mut p = 0;
        let mut s = 0;
        for ra in &item.affixes {
            match content.affixes[ra.affix_idx as usize].kind {
                AffixKind::Prefix => p += 1,
                AffixKind::Suffix => s += 1,
            }
        }
        (p, s)
    }

    #[test]
    fn the_obol_verbs_respect_rarity_budgets_and_names() {
        let (content, mut rng, mut item) = setup();
        use CurrencyOp::*;

        // Wrong-rarity verbs refuse without burning anything.
        assert!(!apply_currency_op(
            &content, &mut rng, RerollRare, &mut item
        ));
        assert!(!apply_currency_op(&content, &mut rng, ToRare, &mut item));

        // Transmute: normal → magic, ≤1 prefix + ≤1 suffix, composed name.
        assert!(apply_currency_op(&content, &mut rng, ToMagic, &mut item));
        assert_eq!(item.rarity, Rarity::Magic);
        let (p, s) = kinds(&content, &item);
        assert!(p <= 1 && s <= 1 && !item.affixes.is_empty());
        assert!(item.name.contains("Driftwood Bow"), "{}", item.name);

        // Augment until full (≤2 affixes), then it refuses.
        while item.affixes.len() < 2 {
            if !apply_currency_op(&content, &mut rng, AddAffixMagic, &mut item) {
                break; // pool can run dry for a slot; that's legal
            }
        }
        if item.affixes.len() >= 2 {
            assert!(!apply_currency_op(
                &content,
                &mut rng,
                AddAffixMagic,
                &mut item
            ));
        }

        // Regal: magic → rare, generated name with the base in parens
        // handled at display time (the stored name drops the base).
        assert!(apply_currency_op(&content, &mut rng, ToRare, &mut item));
        assert_eq!(item.rarity, Rarity::Rare);
        assert_eq!(item.name.split(' ').count(), 2, "{}", item.name);

        // Chaotic rerolls affixes AND the name deterministically.
        let before_name = item.name.clone();
        let before_affixes = item.affixes.clone();
        assert!(apply_currency_op(&content, &mut rng, RerollRare, &mut item));
        let (p, s) = kinds(&content, &item);
        assert!(p <= 3 && s <= 3 && item.affixes.len() >= 3);
        assert!(
            item.name != before_name || item.affixes != before_affixes,
            "a reroll must change something"
        );

        // Exalted adds without renaming, capped at 6.
        let name_before_exalt = item.name.clone();
        while item.affixes.len() < 6 {
            if !apply_currency_op(&content, &mut rng, AddAffixRare, &mut item) {
                break;
            }
        }
        assert_eq!(item.name, name_before_exalt);
        assert!(
            !apply_currency_op(&content, &mut rng, AddAffixRare, &mut item)
                || item.affixes.len() < 6
        );

        // Divine rerolls values within their tiers only.
        let ids_before: Vec<u32> = item.affixes.iter().map(|a| a.affix_idx).collect();
        assert!(apply_currency_op(
            &content,
            &mut rng,
            RerollValues,
            &mut item
        ));
        let ids_after: Vec<u32> = item.affixes.iter().map(|a| a.affix_idx).collect();
        assert_eq!(ids_before, ids_after, "divine keeps the affixes");
        for ra in &item.affixes {
            let affix = &content.affixes[ra.affix_idx as usize];
            let tier = affix.tiers.iter().rev().find(|t| t.ilvl <= 5).unwrap();
            assert!(ra.value >= tier.min && ra.value <= tier.max);
        }

        // Scouring strips it all back to the base.
        assert!(apply_currency_op(&content, &mut rng, ToNormal, &mut item));
        assert_eq!(item.rarity, Rarity::Normal);
        assert!(item.affixes.is_empty());
        assert_eq!(item.name, "Driftwood Bow");
    }
}

#[cfg(test)]
mod find_tests {
    use super::*;
    use crate::World;
    use idlin_content::ContentDb;
    use std::path::Path;

    fn world() -> World {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        World::new(0xF1AD, &content)
    }

    #[test]
    fn rarity_factor_shifts_the_tier_distribution() {
        let mut base = world();
        let mut juiced = world();
        let (mut base_magic_plus, mut juiced_magic_plus) = (0, 0);
        for _ in 0..4000 {
            if let Some(LootPayload::Gear(i)) = base.roll_drop(5, 10000)
                && i.rarity != Rarity::Normal
            {
                base_magic_plus += 1;
            }
            if let Some(LootPayload::Gear(i)) = juiced.roll_drop(5, 30000)
                && i.rarity != Rarity::Normal
            {
                juiced_magic_plus += 1;
            }
        }
        // +200% rarity roughly doubles-plus the magic+ rate (700 fixed vs
        // 300 -> 900 scaled weight); demand a decisive separation.
        assert!(
            juiced_magic_plus as f64 > base_magic_plus as f64 * 1.6,
            "rarity factor must bite: {juiced_magic_plus} vs {base_magic_plus}"
        );
    }

    #[test]
    fn quantity_overflow_guarantees_drops_and_normals_compact() {
        let mut w = world();
        // 600% quantity = 3500bp×6 = 21000bp ⇒ at least 2 drops per kill.
        let killer = killer_with_factors(&mut w, 60000, 10000);
        let mut total = 0;
        let mut normals = 0;
        let mut obols = 0;
        for _ in 0..300 {
            let drops = w.roll_kill_drops(5, killer);
            assert!(drops.len() >= 2, "overflow guarantees drops");
            let mut kill_normals = 0;
            for d in &drops {
                total += 1;
                match d {
                    LootPayload::Gear(i) if i.rarity == Rarity::Normal => {
                        kill_normals += 1;
                        normals += 1;
                    }
                    LootPayload::Currency(_) => obols += 1,
                    _ => {}
                }
            }
            assert!(kill_normals <= 1, "at most one normal per kill");
        }
        assert!(total >= 600);
        assert!(normals > 0, "the first normal still drops");
        assert!(obols > 0, "excess normals became obols");
    }

    /// Test helper: a throwaway character slot with chosen find factors.
    fn killer_with_factors(w: &mut World, quantity: i64, rarity: i64) -> Option<usize> {
        let program = idlin_botc::assemble("halt\n").unwrap();
        w.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Finder".into(),
                program,
            }],
        });
        let slot = (0..w.zone.slot_count())
            .find(|&s| w.zone.get(s).is_some_and(|e| e.character.is_some()))?;
        let c = w.zone.get_mut(slot)?.combat.as_mut()?;
        c.item_quantity = quantity;
        c.item_rarity = rarity;
        Some(slot)
    }
}
