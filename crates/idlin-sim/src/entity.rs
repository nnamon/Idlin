//! Entity model. Entities live in slot storage inside a zone; every external
//! reference (protocol, syscalls, AI targets) uses the `net_id` — a monotonic
//! never-reused u32 — so slot reuse can never alias a stale reference.
//!
//! Characters are classless: identity comes from gear, the passive tree, and
//! (later) gems — all expressed as affix grants over universal bases.

use crate::fixed::{Fx, FxV2};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum Rarity {
    Normal = 0,
    Magic = 1,
    Rare = 2,
    Unique = 3,
}

/// Who fights whom. Attacks are only legal across the Player↔Hostile pair;
/// Neutral entities (service NPCs, tavern-dwellers) can neither hit nor be hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Faction {
    Player,
    Hostile,
    Neutral,
}

impl Faction {
    pub fn is_enemy_of(self, other: Faction) -> bool {
        matches!(
            (self, other),
            (Faction::Player, Faction::Hostile) | (Faction::Hostile, Faction::Player)
        )
    }
}

/// Damage type indices into `CombatStats::damage`.
pub const DMG_PHYS: usize = 0;
pub const DMG_ELE: usize = 1;
pub const DMG_CHAOS: usize = 2;

/// Derived combat numbers, cached on the entity. For characters these are
/// recomputed from (level, gear, tree) by the stat engine; for monsters they
/// come straight from content. All integer/fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatStats {
    pub life: i64,
    pub life_max: i64,
    /// Per-type attack damage: phys, elemental, chaos.
    pub damage: [i64; 3],
    pub accuracy: i64,
    pub evasion: i64,
    /// Attenuates physical damage taken.
    pub armour: i64,
    /// Resistances in basis points (capped at use).
    pub resist_ele: i64,
    pub resist_chaos: i64,
    pub range: Fx,
    pub cooldown_ticks: u32,
    pub cooldown_left: u32,
    pub speed_per_tick: Fx,
    /// Body radius for collision/separation.
    pub radius: Fx,
    pub projectile: bool,
    /// Last tick this entity dealt or took damage (drives out-of-combat regen).
    pub last_combat_tick: u64,
}

impl CombatStats {
    pub fn alive(&self) -> bool {
        self.life > 0
    }

    pub fn life_pct(&self) -> u8 {
        if self.life_max <= 0 {
            return 0;
        }
        (self.life.clamp(0, self.life_max) * 100 / self.life_max) as u8
    }
}

/// Per-tick action intents. `attack`/`pickup` are cleared every tick (bots
/// and AI re-issue); `move_to` persists until arrival so a budget-starved
/// bot keeps walking.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Intents {
    pub move_to: Option<FxV2>,
    pub attack: Option<u32>,
    pub pickup: Option<u32>,
}

/// One rolled affix on a concrete item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolledAffix {
    /// Index into ContentDb::affixes.
    pub affix_idx: u32,
    /// The rolled value (flat units or basis points per the affix layer).
    pub value: i64,
}

/// A concrete item instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    /// Index into ContentDb::items.
    pub base_idx: u32,
    pub rarity: Rarity,
    /// Monster level at drop time; gates affix tiers.
    pub item_level: u32,
    pub affixes: Vec<RolledAffix>,
}

/// An item sitting in the bag grid at (x, y); footprint comes from its base.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacedItem {
    pub item: Item,
    pub x: u8,
    pub y: u8,
}

/// Bag grid dimensions (PoE proportions; item footprints are content).
pub const BAG_W: u8 = 12;
pub const BAG_H: u8 = 5;
pub const GEAR_SLOTS: usize = idlin_content::GearSlot::COUNT;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterState {
    pub name: String,
    pub level: u32,
    pub xp: i64,
    /// Set while dead; tick at which the character respawns.
    pub respawn_at: Option<u64>,
    pub kills: u64,
    /// Lifetime pickups (display stat); the bag is `inventory`.
    pub items: u64,
    /// Grid-placed bag contents.
    pub inventory: Vec<PlacedItem>,
    /// Indexed by GearSlot::idx().
    pub equipment: [Option<Item>; GEAR_SLOTS],
    /// Allocated passive tree node indices (sorted). The start node is
    /// implicit and free.
    pub allocated: Vec<u32>,
}

impl CharacterState {
    /// Unspent passive points: one per level past 1, minus allocations.
    pub fn passive_points(&self) -> u32 {
        (self.level - 1).saturating_sub(self.allocated.len() as u32)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonsterState {
    /// Index into ContentDb::monsters.
    pub def_idx: u32,
    /// Index into Zone::packs.
    pub pack_idx: u32,
    /// Home position; the brain reads it via SelfStatus for leashing.
    pub anchor: FxV2,
    /// Copied from the def at spawn so faction checks never need content.
    pub hostile: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootState {
    /// The actual dropped item.
    pub item: Item,
    pub rarity: Rarity,
    /// Personal loot: only this character's net_id can see or take it.
    pub owner: u32,
    pub despawn_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub net_id: u32,
    pub pos: FxV2,
    pub intents: Intents,
    /// Index into the bot arena — characters AND monsters both think in the
    /// same VM; an entity without a bot (loot) just doesn't act.
    pub bot: Option<u32>,
    pub combat: Option<CombatStats>,
    pub character: Option<CharacterState>,
    pub monster: Option<MonsterState>,
    pub loot: Option<LootState>,
}

impl Entity {
    pub fn alive(&self) -> bool {
        self.combat.as_ref().is_some_and(|c| c.alive())
    }

    pub fn faction(&self) -> Faction {
        if self.character.is_some() {
            Faction::Player
        } else if let Some(m) = &self.monster {
            if m.hostile {
                Faction::Hostile
            } else {
                Faction::Neutral
            }
        } else {
            Faction::Neutral
        }
    }

    /// Wire/syscall kind code: 1 = character, 2 = monster, 3 = loot.
    pub fn kind_code(&self) -> i32 {
        if self.character.is_some() {
            1
        } else if self.monster.is_some() {
            2
        } else {
            3
        }
    }
}
