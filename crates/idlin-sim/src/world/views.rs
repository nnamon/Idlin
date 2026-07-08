//! What the outside world sees: flat per-entity views for replication, and
//! the canonical FNV-1a state hash that pins replays, snapshots, and CI.

use super::{EntityView, World};
use crate::entity::{Item, LootPayload};
use crate::hash::Fnv1a64;
use idlin_content::GearSlot;

/// Tooltip-grade detail for one item on the inspect sheet (#87): the rolled
/// display name + rarity, the base def num (client resolves base type +
/// requirements from content-docs), the item level, and the rolled affixes as
/// (affix_num, tier, values). Gems shown in the bag use `base_num = -1`, no mods.
#[derive(Debug, Clone)]
pub struct ItemRow {
    pub name: String,
    pub rarity: u8,
    pub base_num: i32,
    pub item_level: u32,
    pub mods: Vec<(i32, u32, Vec<i64>)>,
}

/// One inspect-sheet equipment slot: (slot name, the item or None when empty,
/// dimmed). A two-handed weapon mirrors (dimmed) into the offhand slot.
pub type GearSlotRow = (&'static str, Option<ItemRow>, bool);

/// Computed readout for one socketed SKILL gem — produced by the sim's own
/// resolution pipeline (`skill_stat_view`), so the panel can never disagree
/// with what the executor charges and deals. `dps` leads for damage skills;
/// the dot / buff / debuff durations carry the pertinent number for skills
/// that deal no direct hit (a DoT, an aura, an on-hit debuff).
pub struct SkillStatView {
    pub name: String,
    pub level: u32,
    /// Gem XP into the current level, and the amount for the next (0 at cap).
    pub xp: i64,
    pub xp_next: i64,
    pub is_spell: bool,
    pub shape: &'static str,
    /// Per-hit typed damage, post-support, pre-crit.
    pub damage: [i64; crate::entity::DMG_COUNT],
    /// Σdamage × average-crit factor × hits/sec; 0 when no direct hit.
    pub dps: i64,
    pub crit_chance_bp: i64,
    pub crit_multi_bp: i64,
    pub use_ticks: u32,
    pub cooldown_ticks: u32,
    pub mana_cost: i64,
    /// Life paid per use (0 for most skills). Ungated — can self-kill.
    pub life_cost: i64,
    /// Effective footprint in content units (weapon range / AoE mods folded).
    pub range_cu: i32,
    pub radius_cu: i32,
    /// Line/corridor width in content units (0 for non-line skills).
    pub width_cu: i32,
    pub projectiles: u32,
    pub pierce: u32,
    pub dot_per_sec: i64,
    pub dot_duration_ticks: u32,
    pub buff_duration_ticks: u32,
    pub debuff_duration_ticks: u32,
    /// (name, level, xp, xp_to_next: 0 at cap) per support socketed with the skill.
    pub supports: Vec<(String, u32, i64, i64)>,
}

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
    /// Campaign progress (#136 T7): bit N-1 = act N complete. The client's
    /// act tracker reads this; the chart panel unlocks on bit 0.
    pub story_acts: u32,
    pub damage: [i64; crate::entity::DMG_COUNT],
    pub accuracy: i64,
    pub evasion: i64,
    pub armour: i64,
    pub resists: [i64; crate::entity::RES_COUNT],
    /// Find factors (base 10000).
    pub item_rarity: i64,
    pub item_quantity: i64,
    /// Equipment slots; a two-handed weapon mirrors (dimmed) into the offhand.
    pub equipment: Vec<GearSlotRow>,
    /// (item, x, y, w, h) per bag item.
    pub inventory: Vec<(ItemRow, u8, u8, u8, u8)>,
    /// (name, level, xp, xp_to_next: 0 at cap, is_support) — supports
    /// follow their skill.
    pub gems: Vec<(String, u32, i64, i64, bool)>,
    /// Computed per-socketed-skill readout (DPS / DoT / buff / footprint).
    pub skills: Vec<SkillStatView>,
    /// (name, count, tier) per owned obol kind (nonzero only).
    pub currency: Vec<(String, u64, u8)>,
    pub passive_allocated: u32,
    pub passive_unspent: u32,
    pub build_len: u32,
    /// Per-stat source breakdown (#87): (stat_key, source, layer u8, value) for
    /// every ACTIVE grant contribution (gear affix / passive node / buff).
    pub stat_sources: Vec<(String, String, u8, i64)>,
}

impl World {
    /// Tooltip-grade detail for one item (#87): display name, rarity, base def
    /// num, item level, and the rolled affixes as (affix_num, tier, values).
    pub(crate) fn item_row(&self, it: &Item) -> ItemRow {
        let mods = it
            .affixes
            .iter()
            .map(|ra| {
                (
                    self.content_num(idlin_content::ids::Category::Affix, ra.affix_idx as usize),
                    ra.tier,
                    ra.values.clone(),
                )
            })
            .collect();
        ItemRow {
            name: self.item_display(it),
            rarity: it.rarity as u8,
            base_num: self.content_num(idlin_content::ids::Category::Item, it.base_idx as usize),
            item_level: it.item_level,
            mods,
        }
    }

    /// Inspect one character by net id (None for monsters/loot/unknown).
    pub fn character_sheet(&self, net_id: u32) -> Option<CharacterSheetView> {
        const SLOT_NAMES: [&str; 12] = [
            "Weapon", "Offhand", "Helm", "Chest", "Boots", "Flask", "Flask 2", "Ring", "Ring 2",
            "Belt", "Amulet", "Gloves",
        ];
        let e = self.zone.get_net(net_id)?;
        let ch = e.character.as_ref()?;
        let c = e.combat.as_ref()?;
        let mut equipment: Vec<GearSlotRow> = ch
            .equipment
            .iter()
            .enumerate()
            .map(|(i, s)| {
                (
                    SLOT_NAMES[i],
                    s.as_ref().map(|item| self.item_row(item)),
                    false,
                )
            })
            .collect();
        // A two-handed weapon mirrors into the offhand slot, dimmed — the UI
        // convention that signals it occupies both hands.
        let wpn = GearSlot::Weapon.idx();
        let off = GearSlot::Offhand.idx();
        if ch.equipment[wpn]
            .as_ref()
            .is_some_and(|it| self.content.items[it.base_idx as usize].two_handed)
        {
            equipment[off] = (SLOT_NAMES[off], equipment[wpn].1.clone(), true);
        }
        let inventory = ch
            .inventory
            .iter()
            .map(|p| match &p.item {
                crate::entity::BagItem::Gear(it) => {
                    let def = &self.content.items[it.base_idx as usize];
                    (self.item_row(it), p.x, p.y, def.w, def.h)
                }
                // Gems show as 1×1, Normal-rarity entries named by their gem def,
                // with no base/mods (the tooltip falls back to the bare name).
                crate::entity::BagItem::Gem(g) => (
                    ItemRow {
                        name: self.content.gems[g.gem_idx as usize].name.clone(),
                        rarity: crate::entity::Rarity::Normal as u8,
                        base_num: -1,
                        item_level: 0,
                        mods: Vec::new(),
                    },
                    p.x,
                    p.y,
                    1,
                    1,
                ),
            })
            .collect();
        let gem_row = |gem: &crate::entity::GemInstance, support: bool| {
            let next = if gem.level >= crate::entity::GEM_LEVEL_CAP {
                0
            } else {
                crate::entity::gem_xp_to_next(gem.level)
            };
            (
                self.content.gems[gem.gem_idx as usize].name.clone(),
                gem.level,
                gem.xp,
                next,
                support,
            )
        };
        let mut gems = Vec::new();
        for sg in ch.sockets.values() {
            gems.push(gem_row(&sg.gem, false));
            for sup in &sg.supports {
                gems.push(gem_row(sup, true));
            }
        }
        // Per-skill computed readout (#19), straight from the executor's own
        // resolution helpers. Keys collected first so the per-skill borrow
        // doesn't overlap the `self` reads inside `skill_stat_view`.
        let slot = self.zone.slot_of(net_id)?;
        let socket_keys: Vec<u32> = ch.sockets.keys().copied().collect();
        let skills: Vec<SkillStatView> = socket_keys
            .iter()
            .filter_map(|k| self.skill_stat_view(slot, *k))
            .collect();
        let currency = ch
            .currency
            .iter()
            .enumerate()
            .filter(|(_, c)| **c > 0)
            .map(|(i, c)| {
                let def = &self.content.currency[i];
                (def.name.clone(), *c, def.tier)
            })
            .collect();
        // Per-stat source breakdown (#87): every ACTIVE grant's contribution from
        // gear / tree / buffs, the same grants `refresh_character_stats` folds,
        // filtered to those whose condition currently holds. View-only (not hashed).
        let weapon_class = ch.equipment[GearSlot::Weapon.idx()]
            .as_ref()
            .and_then(|it| self.content.items[it.base_idx as usize].weapon_class);
        // Derive-phase ctx: the breakdown mirrors the CACHED stats, which omit
        // strike-time conditions (#109) — so the filter below skips them too,
        // rather than showing a situational mod as always-on.
        let ctx = crate::stats::EvalContext {
            weapon_class,
            ..Default::default()
        };
        let mut stat_sources: Vec<(String, String, u8, i64)> = Vec::new();
        for it in ch.equipment.iter().flatten() {
            let name = self.item_display(it);
            for ra in &it.affixes {
                let a = &self.content.affixes[ra.affix_idx as usize];
                for g in a.grants(&ra.values) {
                    if g.condition
                        .is_none_or(|c| !c.is_strike_time() && c.holds(&ctx))
                    {
                        stat_sources.push((
                            g.stat.doc().key.to_string(),
                            name.clone(),
                            g.layer as u8,
                            g.value,
                        ));
                    }
                }
            }
            // Unique fixed mods (#136 T5) surface under the item's name too.
            if let Some(u) = it.unique_idx {
                for g in &self.content.uniques[u as usize].mods {
                    if g.condition
                        .is_none_or(|c| !c.is_strike_time() && c.holds(&ctx))
                    {
                        stat_sources.push((
                            g.stat.doc().key.to_string(),
                            name.clone(),
                            g.layer as u8,
                            g.value,
                        ));
                    }
                }
            }
        }
        for &node_idx in &ch.allocated {
            if let Some(node) = self.content.tree.get(node_idx as usize) {
                for g in &node.grants {
                    if g.condition
                        .is_none_or(|c| !c.is_strike_time() && c.holds(&ctx))
                    {
                        stat_sources.push((
                            g.stat.doc().key.to_string(),
                            node.name.clone(),
                            g.layer as u8,
                            g.value,
                        ));
                    }
                }
            }
        }
        for ef in &e.effects {
            if let crate::entity::ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    if g.condition
                        .is_none_or(|c| !c.is_strike_time() && c.holds(&ctx))
                    {
                        stat_sources.push((
                            g.stat.doc().key.to_string(),
                            "Buff".to_string(),
                            g.layer as u8,
                            g.value,
                        ));
                    }
                }
            }
        }
        Some(CharacterSheetView {
            id: e.net_id,
            name: ch.name.clone(),
            level: ch.level,
            xp: ch.xp,
            // 0 at the cap (parity with gem rows) — there is no next level.
            xp_next: if ch.level >= 100 {
                0
            } else {
                super::progression::xp_to_next(ch.level)
            },
            life: c.life,
            life_max: c.life_max,
            mana: c.mana,
            mana_max: c.mana_max,
            es: c.es,
            es_max: c.es_max,
            block: c.block,
            kills: ch.kills,
            story_acts: ch.story_acts,
            damage: c.damage,
            accuracy: c.accuracy,
            evasion: c.evasion,
            armour: c.armour,
            resists: c.resists,
            item_rarity: c.item_rarity,
            item_quantity: c.item_quantity,
            equipment,
            inventory,
            gems,
            skills,
            currency,
            passive_allocated: ch.allocated.len() as u32,
            passive_unspent: ch.passive_points(),
            build_len: ch.build_plan.len() as u32,
            stat_sources,
        })
    }

    /// TEST HARNESS ONLY: overwrite an entity's life and flat phys damage
    /// so journey tests finish in test time (e.g. a 1-life harmless boss).
    /// Nothing in the engine calls it.
    pub fn test_set_combat(&mut self, net_id: u32, life: i64, phys: i64) {
        if let Some(slot) = self.zone.slot_of(net_id)
            && let Some(c) = self.zone.get_mut(slot).and_then(|e| e.combat.as_mut())
        {
            c.life_max = life.max(1);
            c.life = life.max(1);
            c.damage[0] = phys;
        }
    }

    /// The zone's gates as cell rects (x0, y0, x1, y1, open).
    pub fn gate_views(&self) -> Vec<(i32, i32, i32, i32, bool)> {
        self.zone
            .gates
            .iter()
            .map(|g| (g.x0, g.y0, g.x1, g.y1, g.open))
            .collect()
    }

    /// The zone's exits as raw Q16.16 (x, y, open) for replication.
    pub fn exit_views(&self) -> Vec<(i32, i32, bool)> {
        self.zone
            .exits
            .iter()
            .map(|e| (e.pos.x.raw(), e.pos.y.raw(), e.open))
            .collect()
    }

    /// TEST HARNESS ONLY: line-of-sight between two unit coordinates.
    pub fn test_los_clear(&self, ax: i16, ay: i16, bx: i16, by: i16) -> bool {
        !self.los_blocked(
            crate::fixed::FxV2::new(
                crate::fixed::Fx::from_int(ax),
                crate::fixed::Fx::from_int(ay),
            ),
            crate::fixed::FxV2::new(
                crate::fixed::Fx::from_int(bx),
                crate::fixed::Fx::from_int(by),
            ),
        )
    }

    /// TEST HARNESS ONLY: is this entity's center on standable ground?
    /// Zones without a grid always say yes.
    pub fn test_on_walkable(&self, net_id: u32) -> Option<bool> {
        let e = self.zone.get_net(net_id)?;
        Some(
            self.zone
                .grid
                .as_ref()
                .is_none_or(|g| g.walkable_pos(e.pos)),
        )
    }

    /// TEST SEAM (#148 A1): wear a PLAIN ilvl-6 helm and bag a MAGIC ilvl-5
    /// one (an of_warding roll) — the fixture for the template's
    /// rarity-first upgrade rule.
    pub fn test_wear_and_bag_helms(&mut self, net_id: u32, helm_idx: u32, affix_idx: u32) {
        let Some(slot) = self.zone.slot_of(net_id) else {
            return;
        };
        let Some(ch) = self.zone.get_mut(slot).and_then(|e| e.character.as_mut()) else {
            return;
        };
        // Past the base's req_level so the swap is legal for the template.
        ch.level = ch.level.max(5);
        ch.equipment[idlin_content::GearSlot::Helm.idx()] = Some(crate::entity::Item {
            base_idx: helm_idx,
            rarity: crate::entity::Rarity::Normal,
            item_level: 6,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
            unique_idx: None,
        });
        ch.inventory.push(crate::entity::PlacedItem {
            item: crate::entity::BagItem::Gear(crate::entity::Item {
                base_idx: helm_idx,
                rarity: crate::entity::Rarity::Magic,
                item_level: 5,
                affixes: vec![crate::entity::RolledAffix {
                    affix_idx,
                    values: vec![1100],
                    tier: 0,
                }],
                name: String::new(),
                charges: 0,
                unique_idx: None,
            }),
            x: 6,
            y: 0,
        });
    }

    /// TEST SEAM (#148 A1): the worn helm's (rarity, item_level), if any.
    pub fn test_worn_helm(&self, net_id: u32) -> Option<(u8, u32)> {
        let e = self.zone.get_net(net_id)?;
        e.character.as_ref()?.equipment[idlin_content::GearSlot::Helm.idx()]
            .as_ref()
            .map(|it| (it.rarity as u8, it.item_level))
    }

    /// TEST HARNESS ONLY: teleport an entity (whole units).
    /// TEST SEAM (#148 A3): read one word of a character's bot VM memory —
    /// how integration tests observe a syscall's stored return code.
    pub fn test_vm_word(&mut self, net_id: u32, addr: u16) -> Option<i32> {
        let slot = self.zone.slot_of(net_id)?;
        let idx = self.zone.get(slot)?.bot?;
        Some(self.bots.get_mut(idx)?.vm.load_i32(addr))
    }

    pub fn test_teleport(&mut self, net_id: u32, x_u: i16, y_u: i16) {
        if let Some(slot) = self.zone.slot_of(net_id)
            && let Some(e) = self.zone.get_mut(slot)
        {
            e.pos = crate::fixed::FxV2::new(
                crate::fixed::Fx::from_int(x_u),
                crate::fixed::Fx::from_int(y_u),
            );
        }
    }

    /// Flat per-entity views for replication.
    pub fn views(&self) -> Vec<EntityView> {
        self.zone
            .iter()
            .map(|(_, e)| {
                let combat = e.combat.as_ref();
                #[allow(clippy::type_complexity)]
                let (
                    name,
                    model,
                    weapon,
                    weapon_rarity,
                    gear,
                    gear_rarity,
                    level,
                    rarity,
                    dead,
                    kills,
                    items,
                ): (
                    String,
                    String,
                    String,
                    u8,
                    Vec<String>,
                    Vec<u8>,
                    u32,
                    u8,
                    bool,
                    u64,
                    u64,
                ) = if let Some(ch) = &e.character {
                    // The equipped weapon's visual key, for the client's
                    // hand-attachment mesh ("" = unarmed), plus its rarity
                    // for the worn-tier glow.
                    let wslot = ch.equipment[GearSlot::Weapon.idx()].as_ref();
                    let weapon = wslot
                        .map(|item| self.content.items[item.base_idx as usize].model.clone())
                        .unwrap_or_default();
                    let weapon_rarity = wslot.map(|item| item.rarity as u8).unwrap_or(0);
                    // Armor visual part keys in gear-slot order (rarity
                    // aligned): the client's paper-doll composes from these.
                    let mut gear: Vec<String> = Vec::new();
                    let mut gear_rarity: Vec<u8> = Vec::new();
                    for (i, slot) in ch.equipment.iter().enumerate() {
                        if i == GearSlot::Weapon.idx() {
                            continue;
                        }
                        let Some(item) = slot.as_ref() else { continue };
                        let model = &self.content.items[item.base_idx as usize].model;
                        if model.is_empty() {
                            continue;
                        }
                        gear.push(model.clone());
                        gear_rarity.push(item.rarity as u8);
                    }
                    (
                        ch.name.clone(),
                        "idler".to_string(),
                        weapon,
                        weapon_rarity,
                        gear,
                        gear_rarity,
                        ch.level,
                        0,
                        !e.alive(),
                        ch.kills,
                        ch.items,
                    )
                } else if let Some(m) = &e.monster {
                    let def = self.monster_def(m.def_idx);
                    let name = if m.display_name.is_empty() {
                        def.name.clone()
                    } else {
                        m.display_name.clone()
                    };
                    (
                        name,
                        def.model.clone(),
                        String::new(),
                        0,
                        Vec::new(),
                        Vec::new(),
                        if m.level > 0 { m.level } else { def.level },
                        m.rarity as u8,
                        !e.alive(),
                        0,
                        0,
                    )
                } else {
                    let l = e.loot.as_ref().unwrap();
                    // Drops are pillar + marker only: the client just needs
                    // gem vs gear.
                    let model = match &l.payload {
                        LootPayload::Gear(_) => "loot".to_string(),
                        LootPayload::Gem(_) => "gem".to_string(),
                        LootPayload::Currency(_) => "currency".to_string(),
                    };
                    (
                        String::new(),
                        model,
                        String::new(),
                        0,
                        Vec::new(),
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
                    es_pct: combat.map(|c| c.es_pct()).unwrap_or(-1),
                    level,
                    name,
                    model,
                    weapon,
                    weapon_rarity,
                    gear,
                    gear_rarity,
                    rarity,
                    dead,
                    kills,
                    items,
                    ailments: e.ailment_bits(),
                }
            })
            .collect()
    }

    /// Canonical state hash for determinism checks (replays, snapshots, CI).
    pub fn state_hash(&self) -> u64 {
        // Canonical fingerprint of all REPLAY-RELEVANT world state: enough that two
        // worlds with the same hash compute the same future under the same inputs.
        // Deliberate exclusions, each sound:
        //  - Content-loaded constants (zone geometry/grid, gem/affix defs, the
        //    zone-brain program) are immutable at runtime and already folded into
        //    `content_hash`.
        //  - The slot/bot allocator free-lists (`Zone::free`, `BotArena::free`)
        //    are excluded: their ONLY observable effect is WHERE the next
        //    entity/bot lands, and the slot/idx index is hashed per entity/bot
        //    below — so any allocation divergence surfaces immediately as a
        //    changed slot at the next spawn. They roundtrip via postcard, so
        //    snapshot resume is exact. (`Zone::by_net` is NOT serialized at all —
        //    it is a derived index rebuilt from `slots` on resume, so it can never
        //    drift from the hashed slots it mirrors.)
        //  - `intents.attack`/`pickup` are wiped by `clear_transient_intents` at the
        //    top of every tick before any read, so their tick-boundary value cannot
        //    affect the resumed sim.
        //  - Server-level ferry state (pending arrivals) lives outside `World`; the
        //    server snapshot's integrity is handled at that layer.
        let mut h = Fnv1a64::new();
        h.write_u64(self.seed);
        h.write_u64(self.content_hash);
        h.write_u64(self.tick);
        h.write_u32(self.next_net_id);
        // Which zone this world runs (bots read it via SelfStatus), its level, and
        // the zone's authored speech — all serialized World state.
        h.write_u32(self.zone_idx);
        h.write_u32(self.zone_level);
        h.write_u64(self.zone_lines.len() as u64);
        for line in &self.zone_lines {
            h.write_bytes(line.as_bytes());
        }
        for rng in [
            &self.rng_ai,
            &self.rng_combat,
            &self.rng_loot,
            &self.rng_craft,
        ] {
            let (state, inc) = rng.state();
            h.write_u64(state);
            h.write_u64(inc);
        }
        // Windups are state: a committed strike must replay identically.
        h.write_u64(self.pending_uses.len() as u64);
        for p in &self.pending_uses {
            h.write_u32(p.attacker);
            h.write_u64(p.resolve_at);
            h.write_u32(p.skill.map(|n| n + 1).unwrap_or(0));
            match p.target {
                crate::entity::SkillTarget::Entity(id) => {
                    h.write_u8(0);
                    h.write_u32(id);
                }
                crate::entity::SkillTarget::Point(v) => {
                    h.write_u8(1);
                    h.write_i32(v.x.raw());
                    h.write_i32(v.y.raw());
                }
                crate::entity::SkillTarget::Direction(v) => {
                    h.write_u8(2);
                    h.write_i32(v.x.raw());
                    h.write_i32(v.y.raw());
                }
            }
        }
        let fold_item = |h: &mut Fnv1a64, item: &Item| {
            h.write_u32(item.base_idx);
            h.write_u8(item.rarity as u8);
            h.write_u32(item.item_level);
            h.write_bytes(item.name.as_bytes());
            // Flask charges are mutable runtime state (spent on drink, gained on
            // kill); the rolled tier feeds equip requirements and bot-visible
            // ReadItemMods. Both steer future behavior, so both are hashed.
            h.write_u32(item.charges);
            h.write_u32(item.unique_idx.map_or(u32::MAX, |u| u + 1));
            h.write_u64(item.affixes.len() as u64);
            for ra in &item.affixes {
                h.write_u32(ra.affix_idx);
                h.write_u32(ra.tier);
                h.write_u64(ra.values.len() as u64);
                for &v in &ra.values {
                    h.write_i64(v);
                }
            }
        };
        // One grant-hashing routine for every site a `Grant` enters the canonical
        // hash (#86): a grant is condition-capable, so its stat/layer/value AND
        // condition are all future-relevant state. Used by both the active-buff
        // arm and the projectile debuff payload so no carrier can drop a field.
        let fold_grant = |h: &mut Fnv1a64, g: &crate::stats::Grant| {
            h.write_u8(g.stat.idx() as u8);
            h.write_u8(g.layer as u8);
            h.write_i64(g.value);
            match g.condition {
                None => h.write_u8(0),
                Some(crate::stats::Condition::WieldingWeaponClass(wc)) => {
                    h.write_u8(1);
                    h.write_u8(wc as u8);
                }
                // Strike-time conditions (#109): distinct tags + the threshold bp.
                Some(crate::stats::Condition::BelowLifePct(bp)) => {
                    h.write_u8(2);
                    h.write_i64(bp);
                }
                Some(crate::stats::Condition::AboveLifePct(bp)) => {
                    h.write_u8(3);
                    h.write_i64(bp);
                }
                Some(crate::stats::Condition::FullLife) => h.write_u8(4),
                Some(crate::stats::Condition::RecentlyKilled(window)) => {
                    h.write_u8(5);
                    h.write_i64(window);
                }
                // Target-dependent (#109 B2b): distinct tag + the ailment bit.
                Some(crate::stats::Condition::TargetHasAilment(kind)) => {
                    h.write_u8(6);
                    h.write_u8(kind.bit());
                }
            }
        };
        for (slot, e) in self.zone.iter() {
            h.write_u64(slot as u64);
            h.write_u32(e.net_id);
            h.write_i32(e.pos.x.raw());
            h.write_i32(e.pos.y.raw());
            h.write_u32(e.bot.map(|b| b + 1).unwrap_or(0));
            // `move_to` persists across ticks (cleared only on arrival) and steers
            // the next movement pass, so it is independent future state. `attack`/
            // `pickup` are NOT hashed: `clear_transient_intents` wipes them at the
            // top of every tick before they're read, so their tick-boundary value
            // can never affect the resumed simulation.
            match e.intents.move_to {
                None => h.write_u8(0),
                Some(v) => {
                    h.write_u8(1);
                    h.write_i32(v.x.raw());
                    h.write_i32(v.y.raw());
                }
            }
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
                h.write_u64(c.last_kill_tick);
                h.write_i32(c.radius.raw());
                // The remaining combat fields are derived for characters (refresh
                // recomputes them from hashed inputs) but spawn-set for monsters
                // (e.g. stagger/poise/knockback from rolled affixes), so the
                // derived-vs-independent line is fragile — hash the WHOLE struct so
                // no field can be omitted or argued.
                h.write_i64(c.life_regen);
                h.write_i64(c.mana_regen);
                h.write_i64(c.leech_life);
                h.write_i64(c.leech_mana);
                h.write_i32(c.range.raw());
                h.write_i64(c.stagger);
                h.write_i64(c.poise);
                h.write_i64(c.knockback_cu);
                h.write_u32(c.use_ticks);
                h.write_i32(c.speed_per_tick.raw());
                h.write_u8(c.projectile as u8);
                h.write_i64(c.item_rarity);
                h.write_i64(c.item_quantity);
                // Ailments (#88): spawn-set for monsters from rolled affixes, so
                // hash them too (per the whole-struct rule above).
                h.write_i64(c.ignite_chance);
                h.write_i64(c.shock_chance);
                h.write_i64(c.chill_chance);
                h.write_u8(c.crits_no_ailment as u8);
                h.write_i64(c.shock_max);
                h.write_i64(c.chill_max);
                h.write_i64(c.ailment_duration);
                // Derived strike-condition cache (#109) — hashed with the rest of
                // the struct (whole-struct rule), though it's a pure function of
                // the already-hashed affixes/tree/buffs.
                h.write_u8(c.has_strike_conditions as u8);
                // Derived target-dependent grants (#109 B2b) — same whole-struct
                // rule; pure function of the hashed sources, folded via the shared
                // grant routine so no condition field can silently drop.
                h.write_u64(c.target_grants.len() as u64);
                for g in &c.target_grants {
                    fold_grant(&mut h, g);
                }
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
                    // Tag gear vs gem so the two fold distinctly (#54 PR2b: the
                    // bag holds both now; gems left the separate pouch).
                    match &placed.item {
                        crate::entity::BagItem::Gear(it) => {
                            h.write_u8(0);
                            fold_item(&mut h, it);
                        }
                        crate::entity::BagItem::Gem(g) => {
                            h.write_u8(1);
                            h.write_u32(g.gem_idx);
                            h.write_u32(g.level);
                            h.write_i64(g.xp);
                        }
                    }
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
                // The declared build drives future auto-allocation as levels
                // arrive, so it is independent future state, not derivable from
                // `allocated` alone (two builds can share an allocation prefix).
                h.write_u64(ch.build_plan.len() as u64);
                for &n in &ch.build_plan {
                    h.write_u32(n);
                }
                for count in &ch.currency {
                    h.write_u64(*count);
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
                // Fog of war (#129): the explored bitset is replayed state (it
                // drives the wire's visibility filter), hashed by CONTENT so
                // two same-length bitsets with different discoveries differ.
                h.write_u64(ch.explored.len() as u64);
                for &word in &ch.explored {
                    h.write_u64(word);
                }
                // Campaign progress (#136): gates exits/charts — future state.
                h.write_u32(ch.story_acts);
            }
            h.write_u64(e.last_say_tick);
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
                        for g in grants {
                            fold_grant(&mut h, g);
                        }
                    }
                    // Ailment (#88): replay-relevant (shock changes damage taken,
                    // chill changes timing, ignite burns) → folds into the hash.
                    crate::entity::ActiveEffect::Ailment {
                        kind,
                        magnitude,
                        ticks_left,
                        source,
                    } => {
                        h.write_u8(3);
                        h.write_u8(*kind as u8);
                        h.write_i64(*magnitude);
                        h.write_u32(*ticks_left);
                        h.write_u32(*source);
                    }
                }
            }
            if let Some(m) = &e.monster {
                h.write_u32(m.def_idx);
                h.write_u32(m.pack_idx);
                h.write_u8(m.rarity as u8);
                h.write_u32(m.level);
                h.write_u8(m.hostile as u8);
                h.write_i32(m.anchor.x.raw());
                h.write_i32(m.anchor.y.raw());
                h.write_u64(m.decay_at.unwrap_or(0));
                h.write_bytes(m.display_name.as_bytes());
                // Rolled spawn mods are independent persisted state (their EFFECT
                // shows in the derived combat stats above, but their identity does
                // not), just like the affixes on a character's items.
                h.write_u64(m.affixes.len() as u64);
                for ra in &m.affixes {
                    h.write_u32(ra.affix_idx);
                    h.write_u32(ra.tier);
                    h.write_u64(ra.values.len() as u64);
                    for &v in &ra.values {
                        h.write_i64(v);
                    }
                }
                for sg in &m.skills {
                    h.write_u32(sg.gem.gem_idx);
                    h.write_u32(sg.gem.level);
                    h.write_u32(sg.cooldown_left);
                    h.write_u64(sg.supports.len() as u64);
                    for sup in &sg.supports {
                        h.write_u32(sup.gem_idx);
                        h.write_u32(sup.level);
                    }
                }
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
                    LootPayload::Currency(idx) => {
                        h.write_u8(3);
                        h.write_u32(*idx);
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
            h.write_i32(p.radius.raw());
            h.write_u32(p.source);
            h.write_bytes(p.source_name.as_bytes());
            h.write_u8(p.source_is_char as u8);
            h.write_u8(p.hostile_to_players as u8);
            h.write_u8(p.spell as u8);
            h.write_i64(p.accuracy);
            for d in p.damage {
                h.write_i64(d);
            }
            h.write_i64(p.crit_bp);
            h.write_i64(p.crit_multi);
            h.write_u32(p.pierce);
            // Pierce state: which targets this projectile already passed through —
            // it changes whether the next overlap connects, so it is future state.
            h.write_u64(p.already_hit.len() as u64);
            for id in &p.already_hit {
                h.write_u32(*id);
            }
            // On-impact payload: a DoT and a debuff (condition-capable grants,
            // #86) are applied when the projectile lands, so two otherwise
            // identical in-flight projectiles with different payloads are
            // different future state and must hash apart.
            match &p.dot {
                None => h.write_u8(0),
                Some((dtype, per_second, ticks, skill)) => {
                    h.write_u8(1);
                    h.write_u8(*dtype);
                    h.write_i64(*per_second);
                    h.write_u32(*ticks);
                    h.write_u32(*skill);
                }
            }
            match &p.debuff {
                None => h.write_u8(0),
                Some((grants, duration)) => {
                    h.write_u8(1);
                    h.write_u64(grants.len() as u64);
                    h.write_u32(*duration);
                    for g in grants {
                        fold_grant(&mut h, g);
                    }
                }
            }
            h.write_i64(p.stagger);
            h.write_i64(p.knockback_cu);
            // On-impact ailment chance (#88): two otherwise identical in-flight
            // projectiles with different ailment_chance proc differently when they
            // land, so it is future state and must hash apart.
            h.write_i64(p.ailment_chance);
        }
        for ex in &self.zone.exits {
            h.write_i32(ex.pos.x.raw());
            h.write_i32(ex.pos.y.raw());
            h.write_u8(ex.open as u8);
            // The story seal (#136) gates who may depart — future state.
            h.write_u32(ex.requires_act);
        }
        for g in &self.zone.gates {
            h.write_u8(g.open as u8);
        }
        if let Some(b) = &self.zone_brain {
            for byte in b.vm.state_bytes() {
                h.write_u8(byte);
            }
            let (state, inc) = b.rng.state();
            h.write_u64(state);
            h.write_u64(inc);
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
