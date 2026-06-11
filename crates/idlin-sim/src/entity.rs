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
pub const DMG_FIRE: usize = 1;
pub const DMG_COLD: usize = 2;
pub const DMG_LIGHTNING: usize = 3;
pub const DMG_CHAOS: usize = 4;
pub const DMG_COUNT: usize = 5;
/// Resistance indices into `CombatStats::resists` (no phys: armour's job).
pub const RES_FIRE: usize = 0;
pub const RES_COLD: usize = 1;
pub const RES_LIGHTNING: usize = 2;
pub const RES_CHAOS: usize = 3;
pub const RES_COUNT: usize = 4;

/// Derived combat numbers, cached on the entity. For characters these are
/// recomputed from (level, gear, tree) by the stat engine; for monsters they
/// come straight from content. All integer/fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatStats {
    pub life: i64,
    pub life_max: i64,
    /// Spent by skills (costs land with the skill executor); regenerates.
    pub mana: i64,
    pub mana_max: i64,
    /// Depletes before life; recharges after a delay untouched.
    pub es: i64,
    pub es_max: i64,
    /// Tick at which ES may begin recharging (pushed on any damage taken).
    pub es_recharge_at: u64,
    /// Flat life/mana per second from stats (regen pass applies per second).
    pub life_regen: i64,
    pub mana_regen: i64,
    /// Basis points of damage dealt leeched to life/mana (per-strike cap).
    pub leech_life: i64,
    pub leech_mana: i64,
    /// Basis points chance to negate an incoming hit (shield-granted).
    pub block: i64,
    /// Per-type attack damage: phys, fire, cold, lightning, chaos.
    pub damage: [i64; DMG_COUNT],
    pub accuracy: i64,
    pub evasion: i64,
    /// Attenuates physical damage taken.
    pub armour: i64,
    /// Typed resistances in basis points (capped at use); see RES_*.
    pub resists: [i64; RES_COUNT],
    pub range: Fx,
    /// Ticks one use of the basic weapon occupies (speed-scaled).
    pub use_ticks: u32,
    /// Occupied until this tick: no moving, no acting (use-time commitment).
    pub busy_until: u64,
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

/// An attack intent: which enemy, with what. `skill: None` is the basic
/// weapon attack; `Some(node)` names the tree socket whose gem fires.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AttackIntent {
    pub target: u32,
    pub skill: Option<u32>,
}

/// Per-tick action intents. `attack`/`pickup` are cleared every tick (bots
/// and AI re-issue); `move_to` persists until arrival so a budget-starved
/// bot keeps walking.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Intents {
    pub move_to: Option<FxV2>,
    pub attack: Option<AttackIntent>,
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

/// A concrete gem. Gems gain XP from their owner's kills; level scales
/// their numbers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GemInstance {
    /// Index into ContentDb::gems.
    pub gem_idx: u32,
    pub level: u32,
    pub xp: i64,
}

/// A skill gem sitting in an allocated tree socket node, carrying its own
/// support gems (capacity = the gem's support_slots).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocketedGem {
    pub gem: GemInstance,
    pub cooldown_left: u32,
    #[serde(default)]
    pub supports: Vec<GemInstance>,
}

/// What a piece of ground loot actually is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LootPayload {
    Gear(Item),
    Gem(GemInstance),
}

/// Gems live in a small pouch, not the bag grid (they're small).
pub const POUCH_CAP: usize = 12;
pub const GEM_LEVEL_CAP: u32 = 20;

/// Gem level scaling: +4% to the gem's numbers per level.
pub fn gem_scale_bp(level: u32) -> i64 {
    10000 + 400 * (level as i64 - 1)
}

pub fn gem_xp_to_next(level: u32) -> i64 {
    let l = level as i64;
    60 + 30 * l * l
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
    /// The declared build: node indices in allocation order. Set once at
    /// bot initialization (SetBuild); auto-allocated as levels arrive.
    /// Append-only by construction — changing plans means redeploying.
    pub build_plan: Vec<u32>,
    /// Unsocketed gems.
    pub pouch: Vec<GemInstance>,
    /// Gems socketed into allocated tree socket nodes (keyed by node index;
    /// BTreeMap for deterministic iteration).
    pub sockets: std::collections::BTreeMap<u32, SocketedGem>,
}

/// Total passive points earned by a level: 2 per level-up, with every
/// 10th level granting 5 instead (so travels stay affordable).
pub fn total_passive_points(level: u32) -> u32 {
    2 * (level - 1) + 3 * (level / 10)
}

impl CharacterState {
    /// Unspent passive points.
    pub fn passive_points(&self) -> u32 {
        total_passive_points(self.level).saturating_sub(self.allocated.len() as u32)
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
    /// Set at death: the corpse lies where it fell until this tick.
    pub decay_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootState {
    /// The actual dropped thing (gear or gem).
    pub payload: LootPayload,
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
            KIND_CHARACTER as i32
        } else if self.monster.is_some() {
            KIND_MONSTER as i32
        } else {
            KIND_LOOT as i32
        }
    }
}

/// Entity kind codes, shared by `EntityView.kind`, the wire protocol, and
/// the ReadEntities syscall. The protocol crate mirrors these as the
/// `EntityKind` enum — keep them in sync.
pub const KIND_CHARACTER: u8 = 1;
pub const KIND_MONSTER: u8 = 2;
pub const KIND_LOOT: u8 = 3;
