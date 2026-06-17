//! Game content loaded from `content/`: zones/monsters/items/affixes/gems/
//! tree as RON, NPC brains as `.bot` programs (or assembly).
//! The engine just runs this content — behavior, stats, and layout all live
//! here, not in Rust. The sim receives a validated `ContentDb` by value and
//! never touches the filesystem itself.
//!
//! Brains (`content/brains/*.bot`, or `.asm`) are compiled to versioned VM
//! bytecode at load time, so a content error surfaces at server start,
//! never mid-game.
//!
//! Distances/speeds use integer centi-units (250 = 2.5 world units) so the
//! files stay human-editable without floats; the sim converts to Q16.16.
//!
//! Every load computes a content hash embedded in snapshots and replays: a
//! replay is only meaningful against the exact content it was recorded with.

pub mod ids;
pub mod stats;

use serde::{Deserialize, Serialize};
use stats::{Grant, Layer, Stat};
use std::fs;
use std::path::{Path, PathBuf};

/// FNV-1a 64-bit basis constants — the single owner shared by every
/// FNV hash in the workspace (content_hash here, the sim's `Fnv1a64`, the
/// server's per-instance seed / snapshot-dir hash). content is the lowest
/// crate they all depend on.
pub const FNV1A_OFFSET: u64 = 0xcbf29ce484222325;
pub const FNV1A_PRIME: u64 = 0x100000001b3;

#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    #[error("io error reading content: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error in {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: Box<ron::error::SpannedError>,
    },
    #[error("brain {path} failed to build: {msg}")]
    Brain { path: String, msg: String },
    #[error("{path}: zone `{zone}` references unknown monster `{monster}`")]
    UnknownMonster {
        path: String,
        zone: String,
        monster: String,
    },
    #[error("monster `{monster}` references unknown brain `{brain}`")]
    UnknownBrain { monster: String, brain: String },
    #[error("monster `{monster}` skill kit is invalid: {msg}")]
    BadMonsterSkills { monster: String, msg: String },
    #[error("item `{item}` subscribes to affix pool `{pool}` which no affix belongs to")]
    UnknownAffixPool { item: String, pool: String },
    #[error("tree node `{node}` links to unknown node `{link}`")]
    UnknownTreeNode { node: String, link: String },
    #[error("the passive tree has nodes but no `start` node")]
    NoStartNode,
    #[error("duplicate id `{id}` in {path}")]
    DuplicateId { path: String, id: String },
    #[error("affix `{affix}`: {msg}")]
    BadAffixTiers { affix: String, msg: String },
    #[error("tile map for `{zone}`: {msg}")]
    BadMap { zone: String, msg: String },
    #[error("tileset `{tileset}`: {msg}")]
    BadTileset { tileset: String, msg: String },
    #[error("the committed id registry `ids.ron` is malformed: {msg}")]
    BadRegistry { msg: String },
}

/// An NPC brain: a `.bot` (or assembly) program compiled to versioned VM
/// bytecode. NPCs run the exact same VM and syscalls as player bots —
/// behavior is content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainDef {
    /// File stem of the source file.
    pub id: String,
    /// Assembled, versioned bytecode container.
    pub program: Vec<u8>,
}

fn default_monster_pools() -> Vec<String> {
    vec!["monster".into()]
}

/// A gem reference in a monster def: name + fixed level (monster gems
/// don't earn XP — the def IS the build).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonsterGemRef {
    pub gem: String,
    pub level: u32,
}

/// One skill in a monster's kit, with its socketed supports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonsterSkillDef {
    pub gem: String,
    pub level: u32,
    #[serde(default)]
    pub supports: Vec<MonsterGemRef>,
}

/// A monster archetype. `model` picks the client-side visual; `brain` picks
/// the bot program that drives it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonsterDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    pub name: String,
    pub model: String,
    /// BrainDef id driving this NPC.
    pub brain: String,
    /// Hostile NPCs fight players; non-hostile ones are scenery/services.
    pub hostile: bool,
    /// Affix pools magic/rare spawns roll from — the same pool
    /// subscription model items use.
    #[serde(default = "default_monster_pools")]
    pub affix_pools: Vec<String>,
    /// Authored uniques (bosses): fixed identity, no random affixes,
    /// a boss bar on screen.
    #[serde(default)]
    pub unique: bool,
    pub level: u32,
    pub life: i64,
    /// Physical attack damage.
    pub damage: i64,
    /// Typed attack damage components.
    #[serde(default)]
    pub damage_fire: i64,
    #[serde(default)]
    pub damage_cold: i64,
    #[serde(default)]
    pub damage_lightning: i64,
    #[serde(default)]
    pub damage_chaos: i64,
    /// Defenses. Accuracy 0 means "derive from level" (60 + 15·level).
    #[serde(default)]
    pub armour: i64,
    #[serde(default)]
    pub evasion: i64,
    #[serde(default)]
    pub accuracy: i64,
    /// Typed resistances in basis points.
    #[serde(default)]
    pub resist_fire: i64,
    #[serde(default)]
    pub resist_cold: i64,
    #[serde(default)]
    pub resist_lightning: i64,
    #[serde(default)]
    pub resist_chaos: i64,
    /// Movement speed in centi-units per second.
    pub speed_cps: i32,
    /// Body radius in centi-units (collision/separation).
    #[serde(default = "default_radius_cu")]
    pub radius_cu: i32,
    /// Attack range in centi-units.
    pub range_cu: i32,
    /// Ticks one attack occupies (the base attack time).
    pub use_ticks: u32,
    /// Aggro radius in centi-units.
    pub aggro_radius_cu: i32,
    /// XP granted to the killer.
    pub xp: i64,
    /// Ranged attack (client renders a projectile tracer).
    pub projectile: bool,
    /// Mana pool (skills spend it; 2%/s inherent regen like characters).
    #[serde(default)]
    pub mana: i64,
    /// Things this monster may SAY (speech bubbles) — story in the mouths
    /// of the dead. The brain picks by index (host wraps modulo).
    #[serde(default)]
    pub lines: Vec<String>,
    /// The monster's gem kit — same gem pool as characters, fixed levels,
    /// cast through the same syscalls (UseSkill slot 1..N in list order).
    #[serde(default)]
    pub skills: Vec<MonsterSkillDef>,
}

fn default_radius_cu() -> i32 {
    45
}

/// What kind of weapon a base is — attack skills gate on this (a bow
/// skill refuses to fire off a cleaver). Spells don't care.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeaponClass {
    Melee,
    Bow,
    Wand,
}

/// What kind of place a zone is — drives death rules (story zones
/// respawn you at the entrance; maps will return you to the town portal).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ZoneKind {
    #[default]
    Story,
    Map,
    Town,
}

/// Where a piece of gear goes. Weapon stats define the normal attack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GearSlot {
    Weapon,
    /// Shields (block) and, later, other off-hand items.
    Offhand,
    Helm,
    Chest,
    Boots,
    /// Utility slot: flasks (charges, drink on demand). PoE-style.
    Flask,
}

impl GearSlot {
    pub const COUNT: usize = 7;

    pub fn idx(self) -> usize {
        match self {
            GearSlot::Weapon => 0,
            GearSlot::Offhand => 1,
            GearSlot::Helm => 2,
            GearSlot::Chest => 3,
            GearSlot::Boots => 4,
            GearSlot::Flask => 5,
        }
    }

    /// Equipment indices that accept flask items (two belt loops).
    pub const FLASK_SLOTS: [usize; 2] = [5, 6];
}

/// An item base type. Rolled affixes provide everything beyond these bases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    pub name: String,
    pub slot: GearSlot,
    /// Requirements: a character must MEET these to equip — and to KEEP —
    /// the item. Re-validated on every event that can lower attributes
    /// (tree respec, gear loss, buff expiry); an item that fails is shed
    /// to the bag (or the ground). An item's own affixes never satisfy
    /// its own requirements.
    #[serde(default)]
    pub req_level: u32,
    #[serde(default)]
    pub req_str: i64,
    #[serde(default)]
    pub req_dex: i64,
    #[serde(default)]
    pub req_int: i64,
    /// Flasks: instant life restored per drink.
    #[serde(default)]
    pub flask_heal: i64,
    /// Flasks: instant mana restored per drink.
    #[serde(default)]
    pub flask_mana: i64,
    /// Flasks: maximum charges held.
    #[serde(default)]
    pub flask_charges: u32,
    /// Flasks: charges consumed per drink.
    #[serde(default)]
    pub flask_cost: u32,
    /// Flasks: charges gained per kill while equipped.
    #[serde(default)]
    pub flask_gain: u32,
    /// Bag footprint (the inventory is a grid).
    #[serde(default = "default_dim")]
    pub w: u8,
    #[serde(default = "default_dim")]
    pub h: u8,
    /// Weapon: base attack damage by type (replaces unarmed).
    #[serde(default)]
    pub damage_phys: i64,
    #[serde(default)]
    pub damage_fire: i64,
    #[serde(default)]
    pub damage_cold: i64,
    #[serde(default)]
    pub damage_lightning: i64,
    #[serde(default)]
    pub damage_chaos: i64,
    /// Weapon: attack range in centi-units.
    #[serde(default)]
    pub range_cu: i32,
    /// Weapon: ticks one swing occupies (the base attack time).
    #[serde(default)]
    pub use_ticks: u32,
    /// Offhand: basis points chance to block a hit.
    #[serde(default)]
    pub block_bp: i64,
    /// Weapon: ranged attack.
    #[serde(default)]
    pub projectile: bool,
    /// Weapon: its class, for skill eligibility (None on non-weapons).
    #[serde(default)]
    pub weapon_class: Option<WeaponClass>,
    /// Weapon: occupies BOTH hands — no offhand may be worn alongside it.
    /// Bows, staves, and two-handed swords/axes/maces are two-handed; wands,
    /// daggers, and one-handed melee are not. NOT derivable from `weapon_class`
    /// (a melee base can be 1H or 2H), so it's authored per base. Default 1H.
    #[serde(default)]
    pub two_handed: bool,
    /// Affix pools this base draws from when rolling (the subscription
    /// model: the item declares its pools, affixes declare membership).
    #[serde(default)]
    pub affix_pools: Vec<String>,
    /// Armor: base mitigation/avoidance (armour attenuates physical damage;
    /// evasion makes hits miss).
    #[serde(default)]
    pub armour: i64,
    #[serde(default)]
    pub evasion: i64,
    /// Relative drop weight.
    #[serde(default = "default_weight")]
    pub weight: u32,
    /// Client-side visual key for the equipped mesh (weapons; "" = none).
    #[serde(default)]
    pub model: String,
}

fn default_weight() -> u32 {
    100
}

fn default_dim() -> u8 {
    1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AffixKind {
    Prefix,
    Suffix,
}

/// One rollable tier: eligible from `ilvl`, value rolled in `min..=max`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffixTier {
    pub ilvl: u32,
    pub min: i64,
    pub max: i64,
    /// THIS tier's display name — magic-item names are built from the
    /// rolled tier ("Heavy" vs "Brutal"), PoE-style. Empty = fall back
    /// to the affix family name.
    #[serde(default)]
    pub name: String,
    /// Spawn weight among the item-level-eligible tiers of this affix
    /// (higher tiers author lower weights). 0 = never rolls.
    #[serde(default = "default_tier_weight")]
    pub weight: u32,
}

fn default_tier_weight() -> u32 {
    100
}

/// What a currency item does to gear when used (the orb verbs, mapped
/// onto the affix engine).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CurrencyOp {
    /// Normal → magic with fresh affixes (Transmute).
    ToMagic,
    /// +1 affix on a magic item with room (Augment).
    AddAffixMagic,
    /// Reroll a magic item's affixes (Alter).
    RerollMagic,
    /// Magic → rare, +1 affix, new name (Regal).
    ToRare,
    /// Normal → rare outright (Alchemy).
    NormalToRare,
    /// Reroll a rare item's affixes and name (Chaotic).
    RerollRare,
    /// +1 affix on a rare item with room (Exalted).
    AddAffixRare,
    /// Strip to normal (Scouring).
    ToNormal,
    /// Reroll every affix VALUE within its tier (Divine).
    RerollValues,
    /// Not a crafting op: consumed by SetBuild to RESPEC the passive
    /// tree (the Regret Obol). Using it on an item is always a no-op.
    Respec,
}

/// A currency item: stored as a plain count, spent on gear in the bag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrencyDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    pub name: String,
    pub op: CurrencyOp,
    /// Relative drop weight within the currency pool.
    #[serde(default = "default_weight")]
    pub weight: u32,
    /// Display tier 0..3 — pillar/ticker color (rarer verbs glow louder).
    #[serde(default)]
    pub tier: u8,
}

/// The fixed set of things player bots may SAY (speech bubbles) — bots
/// pick by index, so user programs can never inject arbitrary text.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SpeechDef {
    #[serde(default)]
    pub lines: Vec<String>,
}

/// Word pools for generated rare/unique item names ("Vile Thorns").
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NamingDef {
    #[serde(default)]
    pub first: Vec<String>,
    #[serde(default)]
    pub second: Vec<String>,
}

/// A rollable item affix: a (stat, layer) grant whose value comes from the
/// highest tier the item level allows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffixDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    /// Display: prefixes prepend ("Heavy ..."), suffixes append ("... of X").
    pub name: String,
    pub kind: AffixKind,
    /// The ONE named pool this affix lives in; base items subscribe to
    /// pools (`ItemDef::affix_pools`), so an item file fully answers
    /// "what can roll on me".
    pub pool: String,
    #[serde(default = "default_weight")]
    pub weight: u32,
    pub stat: Stat,
    pub layer: Layer,
    /// Must be sorted by ilvl ascending.
    pub tiers: Vec<AffixTier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GemKind {
    Skill,
    Support,
}

/// Attacks scale the weapon and roll accuracy; spells carry their own
/// per-level base damage and never miss via accuracy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillKind {
    #[default]
    Attack,
    Spell,
}

/// How the bot aims this skill (UseSkill / UseSkillAt / UseSkillDir).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetMode {
    #[default]
    Entity,
    Point,
    Direction,
}

/// Skill/support tags: gem identity, and (Phase 4) support compatibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GemTag {
    Attack,
    Spell,
    Melee,
    Projectile,
    Aoe,
    Duration,
    Fire,
    Cold,
    Lightning,
    Chaos,
    Physical,
}

/// Damage types for skill payloads (indices match the sim's DMG_*).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DmgType {
    Phys,
    Fire,
    Cold,
    Lightning,
    Chaos,
}

impl DmgType {
    pub fn idx(self) -> usize {
        self as usize
    }
}

/// Gem-level scaling: value(level) = base + per_level × (level − 1).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Formula {
    #[serde(default)]
    pub base: i64,
    #[serde(default)]
    pub per_level: i64,
}

impl Formula {
    pub fn at(&self, level: u32) -> i64 {
        self.base + self.per_level * (level as i64 - 1)
    }
}

/// A skill-applied damage-over-time payload.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct DotDef {
    pub dtype: DmgType,
    /// Damage per second while active.
    pub per_second: Formula,
    pub duration_ticks: u32,
}

/// A skill-applied timed stat effect (self-buff for now).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuffDef {
    pub grants: Vec<Grant>,
    pub duration_ticks: u32,
}

/// What a support gem does to the skill it's socketed into. Behavior and
/// numbers both live here; tags gate which skills accept the support.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportEffect {
    /// Multiplicative damage (negative bp = less). None = all types.
    MoreDamage {
        dtype: Option<DmgType>,
        bp: i64,
    },
    /// Flat typed damage added to the skill, scaling with SUPPORT level.
    AddedDamage {
        dtype: DmgType,
        amount: Formula,
    },
    IncAttackSpeed {
        bp: i64,
    },
    IncCastSpeed {
        bp: i64,
    },
    /// Fires this many additional projectiles in a fan.
    ExtraProjectiles {
        count: u32,
    },
    /// Additional bodies a projectile passes through.
    Pierce {
        count: u32,
    },
    /// Scales the skill's radius/width (basis points of increase).
    AoeInc {
        bp: i64,
    },
    /// Scales the skill's dot duration.
    DotDurationInc {
        bp: i64,
    },
    /// Scales the skill's mana cost (e.g. 4000 = 40% more mana).
    ManaMult {
        bp: i64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillShape {
    /// Single-target strike at the chosen enemy.
    Target,
    /// Hits everything hostile around the user (radius_cu).
    Nova,
    /// A directional sector from the user (range_cu + cone_cos_bp).
    Cone,
    /// A directional corridor from the user (range_cu + width_cu).
    Line,
    /// Hits everything hostile around a target point (radius_cu).
    PointAoe,
    /// A real traveling projectile (proj_speed_cps, pierce); collides with
    /// the first enemy or wall in its path.
    Projectile,
}

fn shape_target() -> SkillShape {
    SkillShape::Target
}

fn default_max_targets() -> u32 {
    1
}

/// A gem: a skill (an active attack the bot can use) or a support (affix
/// grants applied to the skill socketed in its tree cluster). Gems gain XP
/// from kills; levels scale their numbers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GemDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    pub name: String,
    pub kind: GemKind,
    #[serde(default = "default_weight")]
    pub weight: u32,
    // -- skill identity --
    #[serde(default)]
    pub skill_kind: SkillKind,
    #[serde(default)]
    pub target_mode: TargetMode,
    #[serde(default)]
    pub tags: Vec<GemTag>,
    #[serde(default = "shape_target")]
    pub shape: SkillShape,
    // -- damage --
    /// Attacks: percent of weapon damage (basis points). Spells ignore it.
    #[serde(default)]
    pub coeff_bp: i64,
    /// Flat typed damage from the gem itself, scaling with gem level.
    /// (Spells: this IS the damage. Attacks: added on top of the weapon.)
    #[serde(default)]
    pub added_phys: Formula,
    #[serde(default)]
    pub added_fire: Formula,
    #[serde(default)]
    pub added_cold: Formula,
    #[serde(default)]
    pub added_lightning: Formula,
    #[serde(default)]
    pub added_chaos: Formula,
    /// Base critical chance in basis points (global crit stats scale it).
    #[serde(default)]
    pub crit_bp: i64,
    // -- costs & timing --
    /// Mana drawn per use, scaling with gem level.
    #[serde(default)]
    pub mana_cost: Formula,
    /// Spells: base cast time (cast speed divides it). Attacks use the
    /// weapon's use_ticks instead.
    #[serde(default)]
    pub cast_ticks: u32,
    /// Specials only: extra per-gem cooldown on top of the use time.
    #[serde(default)]
    pub cooldown_ticks: u32,
    // -- geometry --
    /// 0 = use the weapon's range (entity/point modes; projectile launch).
    #[serde(default)]
    pub range_cu: i32,
    /// Nova / PointAoe radius; projectile body radius.
    #[serde(default)]
    pub radius_cu: i32,
    /// Cone width as cos(half-angle) in basis points (7000 ≈ 90° total).
    #[serde(default = "default_cone_cos")]
    pub cone_cos_bp: i64,
    /// Line corridor width.
    #[serde(default)]
    pub width_cu: i32,
    /// Projectile flight speed (centi-units/sec).
    #[serde(default)]
    pub proj_speed_cps: i32,
    /// Enemies a projectile passes through before stopping.
    #[serde(default)]
    pub pierce: u32,
    #[serde(default = "default_max_targets")]
    pub max_targets: u32,
    // -- riders --
    #[serde(default)]
    pub dot: Option<DotDef>,
    #[serde(default)]
    pub buff: Option<BuffDef>,
    /// On-hit rider applied to VICTIMS: timed stat grants through the same
    /// effects system as self-buffs (negative values = debuff — chill,
    /// blind, exposure). Strongest-equal-grants reapply refreshes.
    #[serde(default)]
    pub debuff: Option<BuffDef>,
    /// Attack skills: weapon classes this skill fires with (empty = any,
    /// and spells never care). Wielding anything else — or nothing — is
    /// use error −9.
    #[serde(default)]
    pub weapon_classes: Vec<WeaponClass>,
    // -- support fields --
    /// Tags this support fits: the skill must share at least one.
    #[serde(default)]
    pub requires_tags: Vec<GemTag>,
    /// What socketing this support does to its skill.
    #[serde(default)]
    pub effects: Vec<SupportEffect>,
    /// Legacy stat grants (tree-node style); still applied if present.
    #[serde(default)]
    pub grants: Vec<Grant>,
}

fn default_cone_cos() -> i64 {
    7000
}

impl GemDef {
    /// Whether this SUPPORT gem fits `skill`: a support declares the tags it
    /// works with, and the skill must share at least one. A support with no
    /// required tags fits anything.
    pub fn fits_skill(&self, skill: &GemDef) -> bool {
        self.requires_tags.is_empty() || self.requires_tags.iter().any(|t| skill.tags.contains(t))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Travel,
    Notable,
    Keystone,
    /// A gem socket: holds one skill gem, which brings its own support
    /// slots (PoE2-style — support capacity lives on the gem, not the tree).
    Socket,
}

/// A passive tree node: grants affixes exactly like gear does.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    /// Stable numeric reference (u16) used by compiled bots. Unique,
    /// author-assigned, NEVER reused for a different node.
    pub num: u16,
    pub name: String,
    /// Layout position for the client (abstract units).
    pub pos: (i32, i32),
    /// Undirected edges (either side may declare them).
    #[serde(default)]
    pub links: Vec<String>,
    pub kind: NodeKind,
    #[serde(default)]
    pub grants: Vec<Grant>,
}

/// A tree file: nodes merge across files into one graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeDef {
    pub nodes: Vec<NodeDef>,
}

/// A zone exit: a PLACE a character bot must walk to and take with the
/// UseExit syscall — there are no forced transfers. Brains gate `open`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitDef {
    pub x_u: i32,
    pub y_u: i32,
    /// Destination ZoneDef id (self-loops are legal — the test range
    /// cycles characters through its own exit).
    pub dest: String,
    /// Usable from boot? Closed exits open via the zone brain's set_exit.
    #[serde(default)]
    pub open: bool,
}

/// A brain-togglable barrier: a rect of cells that block movement while
/// the gate is shut. Tutorials are built from these (set_gate syscall).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateDef {
    /// Name brains address the gate by (`gate "start"`); "" for gates no
    /// script touches.
    #[serde(default)]
    pub id: String,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    /// Open from boot? Brains lift them as lessons complete.
    #[serde(default)]
    pub open: bool,
}

/// One authored narration line: brains fire it BY NAME (`line "welcome"`),
/// never by position — inserting a line can't scramble the story.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineDef {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPack {
    /// MonsterDef id.
    pub monster: String,
    pub count: u32,
    /// Pack anchor, in whole units.
    pub x_u: i32,
    pub y_u: i32,
    /// Spawn jitter radius around the anchor, whole units.
    pub radius_u: i32,
    /// Ticks after a wipe before the pack respawns.
    pub respawn_ticks: u32,
    /// Basis-point chance, rolled ONCE per pack refill, for the pack to
    /// come up MAGIC (whole pack, one shared affix set) / RARE (a single
    /// rare leading an otherwise-normal pack). Packs never roll Unique —
    /// uniques are authored on the monster def. Defaults 0: tutorial
    /// packs stay plain; zones author their juice.
    #[serde(default)]
    pub magic_bp: u32,
    #[serde(default)]
    pub rare_bp: u32,
}

fn default_zone_level() -> u32 {
    1
}

/// One glyph in a tileset's palette: the authoring unit of map.txt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileDef {
    /// The map.txt character this tile is authored as.
    pub glyph: char,
    pub id: String,
    pub walkable: bool,
    /// Walls and tall props block sight; water doesn't.
    #[serde(default)]
    pub blocks_los: bool,
    /// Ground finish painted under this tile (palette key).
    pub ground: String,
    /// What stands on the tile (client visual recipe); None = bare ground.
    #[serde(default)]
    pub prop: Option<String>,
    /// Terrain LEVEL (0 = base). Pure look: the client raises these cells
    /// into terraces/bluffs; collision stays the flat walk grid, so level
    /// edges must be authored with non-walkable cliff tiles (ramps are
    /// simply gaps in the cliff line where the slope shows).
    #[serde(default)]
    pub elevation: u8,
}

/// A look-and-feel variant: the same structural kit under a different
/// palette — PoE's few-tilesets-many-feels trick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TilesetVariant {
    pub id: String,
    /// Ground id → "#rrggbb" overrides of the base palette.
    #[serde(default)]
    pub palette: Vec<(String, String)>,
}

/// A themed tile family — the shore, the town — reused by many zones.
/// Owns its glyph palette, ground colors, variants, and its natural
/// monster ecology (what belongs here by default; zones still stage
/// specials like bosses on top).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TilesetDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    pub tiles: Vec<TileDef>,
    /// Base ground palette: ground id → "#rrggbb".
    pub palette: Vec<(String, String)>,
    #[serde(default)]
    pub variants: Vec<TilesetVariant>,
    /// MonsterDef ids native to this tileset (random packs later; the
    /// wiki and authoring sanity now).
    #[serde(default)]
    pub natural_monsters: Vec<String>,
    /// OPT-IN cosmetic features the renderer builds for zones of this
    /// family ("sea", "bluffs_west", "edge_hills", "stars",
    /// "fringe_scatter"). Nothing renders unless the tileset asks.
    #[serde(default)]
    pub features: Vec<String>,
}

impl TilesetDef {
    pub fn tile_by_glyph(&self, glyph: char) -> Option<u8> {
        self.tiles
            .iter()
            .position(|t| t.glyph == glyph)
            .map(|i| i as u8)
    }
}

/// An authored tile map: row-major cells indexing the tileset's palette.
/// One cell = one sim unit.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TileGrid {
    pub width: i32,
    pub height: i32,
    pub cells: Vec<u8>,
}

impl TileGrid {
    /// Parse a map.txt against a tileset: rows must be uniform, every
    /// glyph known. Width/height come from the text itself.
    pub fn from_text(text: &str, tileset: &TilesetDef) -> Result<TileGrid, String> {
        let rows: Vec<&str> = text
            .lines()
            .map(|l| l.trim_end_matches('\r'))
            .filter(|l| !l.is_empty())
            .collect();
        if rows.is_empty() {
            return Err("map is empty".into());
        }
        let width = rows[0].chars().count();
        let mut cells = Vec::with_capacity(width * rows.len());
        for (y, row) in rows.iter().enumerate() {
            let n = row.chars().count();
            if n != width {
                return Err(format!("row {} is {n} wide; row 0 is {width}", y));
            }
            for (x, g) in row.chars().enumerate() {
                match tileset.tile_by_glyph(g) {
                    Some(i) => cells.push(i),
                    None => {
                        return Err(format!(
                            "unknown glyph '{g}' at {x},{y} (tileset `{}`)",
                            tileset.id
                        ));
                    }
                }
            }
        }
        Ok(TileGrid {
            width: width as i32,
            height: rows.len() as i32,
            cells,
        })
    }

    pub fn cell(&self, x: i32, y: i32) -> Option<u8> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height {
            return None;
        }
        Some(self.cells[(y * self.width + x) as usize])
    }
}

/// One set-piece placement from an area's props.ron — pure visuals; the
/// tiles underneath own collision.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropPlacement {
    /// Client manifest model key.
    pub model: String,
    pub x_u: i32,
    pub y_u: i32,
    #[serde(default)]
    pub rot_deg: i32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PropsDef {
    pub props: Vec<PropPlacement>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneDef {
    pub id: String,
    /// Exposed in the generated consts + docs (the bot-facing contract)
    /// only when true; private (the default) defs get an internal num only.
    #[serde(default)]
    pub public: bool,
    pub name: String,
    /// AREA LEVEL: normal monsters spawn at this level (magic +1,
    /// rare +2; authored uniques keep their own). Effective level
    /// scales mob life/damage/xp from the def's authored baseline and
    /// drives drop item levels. Default 1.
    #[serde(default = "default_zone_level")]
    pub level: u32,
    /// Zone extent in whole units (logical 2D plane). Zones with an
    /// authored map.txt derive these from the map and may omit them.
    #[serde(default)]
    pub width_u: i32,
    #[serde(default)]
    pub height_u: i32,
    /// Character spawn/respawn point, whole units.
    pub spawn_x_u: i32,
    pub spawn_y_u: i32,
    /// Spawn scatter radius in whole units (0 = exact point).
    #[serde(default)]
    pub spawn_radius_u: i32,
    /// Sanctuary radius around the spawn camp: monsters never acquire
    /// characters inside it (0 = no sanctuary).
    #[serde(default)]
    pub camp_radius_u: i32,
    #[serde(default)]
    pub kind: ZoneKind,
    /// The zone's BRAIN: a bot program (content/brains) that runs once per
    /// tick with zone-scoped syscalls — scripted encounters, narration,
    /// drops. The dungeon master is a bot too.
    #[serde(default)]
    pub brain: Option<String>,
    /// Authored narration lines the brain fires by index (Narrate syscall).
    /// Text is content; WHEN it fires is script (brains address lines by
    /// their `id`, never by position).
    #[serde(default)]
    pub lines: Vec<LineDef>,
    pub packs: Vec<SpawnPack>,
    /// Walk-up exits to other zones (bots confirm with UseExit).
    #[serde(default)]
    pub exits: Vec<ExitDef>,
    /// Brain-togglable barriers (tutorial gates).
    #[serde(default)]
    pub gates: Vec<GateDef>,
    /// Maximum characters simultaneously in one world of this zone
    /// (0 = unlimited). The host opens fresh instances past the cap —
    /// capacity is CONTENT, never server hardcode.
    #[serde(default)]
    pub max_players: u32,
    /// The tileset family this zone is authored in (zones with map.txt).
    #[serde(default)]
    pub tileset: Option<String>,
    /// Look-and-feel variant within that tileset.
    #[serde(default)]
    pub tileset_variant: Option<String>,
    /// The authored grid (areas/<id>/map.txt), attached by the loader.
    #[serde(skip)]
    pub tiles: Option<TileGrid>,
    /// Set-piece placements (areas/<id>/props.ron), attached by the loader.
    #[serde(skip)]
    pub props: Vec<PropPlacement>,
}

#[derive(Debug, Clone, Default)]
pub struct ContentDb {
    /// FNV-1a 64 over every content file (relative path + bytes), sorted by path.
    pub content_hash: u64,
    /// Sorted by id — indices into this vec are stable for a given content set.
    pub monsters: Vec<MonsterDef>,
    /// Sorted by id.
    pub zones: Vec<ZoneDef>,
    /// Sorted by id.
    pub brains: Vec<BrainDef>,
    /// Sorted by id.
    pub items: Vec<ItemDef>,
    /// Sorted by id.
    pub affixes: Vec<AffixDef>,
    /// Name word pools for rare/unique items.
    pub naming: NamingDef,
    /// Sorted by id. Currency is COUNTED, not bag-stored.
    pub currency: Vec<CurrencyDef>,
    /// Player-sayable speech lines (speech.ron).
    pub speech: SpeechDef,
    /// Sorted by id.
    pub gems: Vec<GemDef>,
    /// Sorted by id. The few themed families every authored map builds from.
    pub tilesets: Vec<TilesetDef>,
    /// Passive tree, sorted by id. Adjacency in `tree_adj` (same indices).
    pub tree: Vec<NodeDef>,
    pub tree_adj: Vec<Vec<u32>>,
    /// Stable 16-bit name-hash ref per node (same indices); collision-checked.
    pub tree_refs: Vec<u16>,
    /// Index of the shared "start" node everyone begins at.
    pub tree_start: u32,
    /// The stable id registry (content/ids.ron): string id ⇄ tagged num — the
    /// bot↔engine contract (reads emit nums; syscall inputs take nums).
    pub id_registry: ids::Registry,
    /// Reverse of the registry: tagged num → (category, array index). Built at
    /// load so a bot's num translates back to an internal index in O(1).
    pub num_to_idx: std::collections::HashMap<i32, (ids::Category, u32)>,
}

impl ContentDb {
    /// An empty database (tests, headless tools).
    pub fn empty() -> ContentDb {
        ContentDb::default()
    }

    /// The string id of the def at `idx` in `cat`'s sorted vec.
    fn def_id(&self, cat: ids::Category, idx: usize) -> Option<&str> {
        use ids::Category::*;
        match cat {
            Gem => self.gems.get(idx).map(|d| d.id.as_str()),
            Item => self.items.get(idx).map(|d| d.id.as_str()),
            Affix => self.affixes.get(idx).map(|d| d.id.as_str()),
            Monster => self.monsters.get(idx).map(|d| d.id.as_str()),
            Node => self.tree.get(idx).map(|d| d.id.as_str()),
            Zone => self.zones.get(idx).map(|d| d.id.as_str()),
            Currency => self.currency.get(idx).map(|d| d.id.as_str()),
            Tileset => self.tilesets.get(idx).map(|d| d.id.as_str()),
        }
    }

    /// The stable tagged num for the def at `idx` in `cat` — the forward id map
    /// reads emit. `None` if the def or its registry entry is missing.
    pub fn content_num(&self, cat: ids::Category, idx: usize) -> Option<i32> {
        self.id_registry.num(cat, self.def_id(cat, idx)?)
    }

    /// The (category, array index) a bot's tagged num refers to — the reverse
    /// map syscall inputs translate through.
    pub fn content_idx(&self, num: i32) -> Option<(ids::Category, u32)> {
        self.num_to_idx.get(&num).copied()
    }

    /// Every bot-referenceable collection → (string id, optional seed) for the
    /// id registry. Only nodes seed a sequence (their author-assigned `num`);
    /// everything else is tool-assigned next-free. Covers ALL defs regardless
    /// of `public`. Shared by the generator (`gen` bin) and the load-time
    /// registry fallback so the two can never disagree on what gets numbered.
    pub fn present_ids(&self) -> Vec<ids::CategoryIds> {
        use ids::Category;
        vec![
            (
                Category::Gem,
                self.gems.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
            (
                Category::Item,
                self.items.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
            (
                Category::Affix,
                self.affixes.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
            (
                Category::Monster,
                self.monsters.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
            (
                Category::Node,
                self.tree
                    .iter()
                    .map(|d| (d.id.clone(), Some(d.num as i32)))
                    .collect(),
            ),
            (
                Category::Zone,
                self.zones.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
            (
                Category::Currency,
                self.currency.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
            (
                Category::Tileset,
                self.tilesets.iter().map(|d| (d.id.clone(), None)).collect(),
            ),
        ]
    }

    /// The bot/player content reference (RFC #54): every PUBLIC def's full
    /// definitional surface, keyed by category, identified by its stable tagged
    /// `num`. Reads carry only identity + live state on the promise the rest
    /// lives HERE — so this emits the whole serialized def (slot/stats, gem
    /// `{base, per_level}` formulas, affix tier roll ranges + weights, monster
    /// kits, …), `public` stripped (always true here) and `num` injected.
    /// `ZoneDef`'s tile grid/props are `#[serde(skip)]`, so zones carry meta +
    /// packs + exits without the map blob. Takes the registry explicitly so the
    /// generator can pass the freshly-regenerated one (which may differ from the
    /// committed `self.id_registry` mid-regeneration). Output is deterministic
    /// (serde_json sorts map keys) — the CI gate diffs it.
    pub fn content_docs(&self, reg: &ids::Registry) -> serde_json::Value {
        use ids::Category;
        /// One entry: the def's serialized surface, `public` dropped, `num` in.
        fn entry<T: serde::Serialize>(num: i32, def: &T) -> serde_json::Value {
            let mut v = serde_json::to_value(def).expect("def serializes to JSON");
            if let serde_json::Value::Object(map) = &mut v {
                map.remove("public");
                map.insert("num".to_string(), serde_json::json!(num));
            }
            v
        }
        let mut cats = serde_json::Map::new();
        // A public def absent from `reg` is SKIPPED, not a panic: the generator
        // passes the freshly-regenerated registry (covers every def), but a
        // caller passing a committed `ids.ron` that lags content shouldn't crash
        // — it just under-reports until the next `gen`.
        macro_rules! cat {
            ($cat:expr, $coll:expr) => {{
                let arr: Vec<serde_json::Value> = $coll
                    .iter()
                    .filter(|d| d.public)
                    .filter_map(|d| reg.num($cat, &d.id).map(|num| entry(num, d)))
                    .collect();
                cats.insert($cat.key().to_string(), serde_json::Value::Array(arr));
            }};
        }
        cat!(Category::Gem, self.gems);
        cat!(Category::Item, self.items);
        cat!(Category::Affix, self.affixes);
        cat!(Category::Monster, self.monsters);
        cat!(Category::Zone, self.zones);
        cat!(Category::Currency, self.currency);
        cat!(Category::Tileset, self.tilesets);
        // Nodes carry their own `num` field — the u16 build-table ref. Keep it
        // as `build_ref` and inject the registry tagged num as `num`, so a node
        // reads consistently with every other category and its NODE_* const.
        let nodes: Vec<serde_json::Value> = self
            .tree
            .iter()
            .filter(|d| d.public)
            .filter_map(|d| {
                let num = reg.num(Category::Node, &d.id)?;
                let mut v = serde_json::to_value(d).expect("node serializes");
                if let serde_json::Value::Object(map) = &mut v {
                    map.remove("public");
                    if let Some(raw) = map.remove("num") {
                        map.insert("build_ref".to_string(), raw);
                    }
                    map.insert("num".to_string(), serde_json::json!(num));
                }
                Some(v)
            })
            .collect();
        cats.insert(
            Category::Node.key().to_string(),
            serde_json::Value::Array(nodes),
        );
        serde_json::json!({
            "note": "AUTO-GENERATED by `cargo run -p idlin-content --bin gen` — do not edit. \
                     Bot/player content reference (RFC #54): every public def's full \
                     definitional surface, keyed by category, identified by `num`.",
            "fingerprint": reg.fingerprint,
            "seq_bits": ids::SEQ_BITS,
            "categories": cats,
        })
    }

    pub fn monster_idx(&self, id: &str) -> Option<usize> {
        self.monsters
            .binary_search_by(|m| m.id.as_str().cmp(id))
            .ok()
    }

    pub fn brain_idx(&self, id: &str) -> Option<usize> {
        self.brains.binary_search_by(|b| b.id.as_str().cmp(id)).ok()
    }

    pub fn item_idx(&self, id: &str) -> Option<usize> {
        self.items.binary_search_by(|i| i.id.as_str().cmp(id)).ok()
    }

    pub fn tree_node_idx(&self, id: &str) -> Option<usize> {
        self.tree.binary_search_by(|n| n.id.as_str().cmp(id)).ok()
    }

    pub fn zone(&self, id: &str) -> Option<&ZoneDef> {
        self.zones
            .binary_search_by(|z| z.id.as_str().cmp(id))
            .ok()
            .map(|i| &self.zones[i])
    }

    pub fn tileset(&self, id: &str) -> Option<&TilesetDef> {
        self.tilesets
            .binary_search_by(|t| t.id.as_str().cmp(id))
            .ok()
            .map(|i| &self.tilesets[i])
    }

    /// Validate tilesets and bind authored maps/props to their zones.
    /// Runs after sorting: zones, tilesets, and monsters are all findable.
    fn attach_maps(
        &mut self,
        maps: Vec<(String, String)>,
        props: Vec<(String, PropsDef)>,
    ) -> Result<(), ContentError> {
        for ts in &self.tilesets {
            let bad = |msg: String| ContentError::BadTileset {
                tileset: ts.id.clone(),
                msg,
            };
            let mut glyphs: Vec<char> = ts.tiles.iter().map(|t| t.glyph).collect();
            glyphs.sort_unstable();
            for w in glyphs.windows(2) {
                if w[0] == w[1] {
                    return Err(bad(format!("glyph '{}' is defined twice", w[0])));
                }
            }
            if ts.tiles.len() > 256 {
                return Err(bad("more than 256 tiles (cells are u8)".into()));
            }
            for t in &ts.tiles {
                if !ts.palette.iter().any(|(g, _)| g == &t.ground) {
                    return Err(bad(format!(
                        "tile `{}` paints unknown ground `{}`",
                        t.id, t.ground
                    )));
                }
            }
            for v in &ts.variants {
                for (g, _) in &v.palette {
                    if !ts.palette.iter().any(|(base, _)| base == g) {
                        return Err(bad(format!(
                            "variant `{}` recolors unknown ground `{g}`",
                            v.id
                        )));
                    }
                }
            }
            for m in &ts.natural_monsters {
                if self.monster_idx(m).is_none() {
                    return Err(bad(format!("natural monster `{m}` does not exist")));
                }
            }
        }
        for w in self.tilesets.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "tilesets/".into(),
                    id: w[0].id.clone(),
                });
            }
        }

        for (area, text) in maps {
            let bad = |msg: String| ContentError::BadMap {
                zone: area.clone(),
                msg,
            };
            let Ok(zi) = self.zones.binary_search_by(|z| z.id.as_str().cmp(&area)) else {
                return Err(bad("map.txt has no zone.ron with the area's id".into()));
            };
            let Some(ts_id) = self.zones[zi].tileset.clone() else {
                return Err(bad("zone has a map.txt but declares no tileset".into()));
            };
            let Some(ts) = self.tileset(&ts_id) else {
                return Err(bad(format!("unknown tileset `{ts_id}`")));
            };
            if let Some(v) = &self.zones[zi].tileset_variant
                && !ts.variants.iter().any(|var| &var.id == v)
            {
                return Err(bad(format!("unknown variant `{v}` of tileset `{ts_id}`")));
            }
            let grid = TileGrid::from_text(&text, ts).map_err(&bad)?;
            let walkable_at = |x: i32, y: i32| -> bool {
                grid.cell(x, y)
                    .is_some_and(|c| ts.tiles[c as usize].walkable)
            };
            let zone = &self.zones[zi];
            if zone.width_u != 0 && (zone.width_u, zone.height_u) != (grid.width, grid.height) {
                return Err(bad(format!(
                    "zone.ron declares {}x{} but the map is {}x{}",
                    zone.width_u, zone.height_u, grid.width, grid.height
                )));
            }
            if !walkable_at(zone.spawn_x_u, zone.spawn_y_u) {
                return Err(bad(format!(
                    "spawn {}x{} is not walkable",
                    zone.spawn_x_u, zone.spawn_y_u
                )));
            }
            for pack in &zone.packs {
                if !walkable_at(pack.x_u, pack.y_u) {
                    return Err(bad(format!(
                        "pack anchor {}x{} ({}) is not walkable",
                        pack.x_u, pack.y_u, pack.monster
                    )));
                }
            }
            for exit in &zone.exits {
                if !walkable_at(exit.x_u, exit.y_u) {
                    return Err(bad(format!(
                        "exit {}x{} (to {}) is not walkable",
                        exit.x_u, exit.y_u, exit.dest
                    )));
                }
            }
            // REACHABILITY: walkable isn't enough — a pack anchor or exit
            // behind an unbroken rock line bricks the zone (it happened:
            // the Tidewarden got walled in). Flood-fill from spawn;
            // everything that matters must CONNECT.
            let mut seen = vec![false; (grid.width * grid.height) as usize];
            let mut queue = std::collections::VecDeque::new();
            seen[(zone.spawn_y_u * grid.width + zone.spawn_x_u) as usize] = true;
            queue.push_back((zone.spawn_x_u, zone.spawn_y_u));
            while let Some((x, y)) = queue.pop_front() {
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height {
                        continue;
                    }
                    let i = (ny * grid.width + nx) as usize;
                    if !seen[i] && walkable_at(nx, ny) {
                        seen[i] = true;
                        queue.push_back((nx, ny));
                    }
                }
            }
            let reachable = |x: i32, y: i32| seen[(y * grid.width + x) as usize];
            for pack in &zone.packs {
                if !reachable(pack.x_u, pack.y_u) {
                    return Err(bad(format!(
                        "pack anchor {}x{} ({}) is walkable but UNREACHABLE from spawn",
                        pack.x_u, pack.y_u, pack.monster
                    )));
                }
            }
            for exit in &zone.exits {
                if !reachable(exit.x_u, exit.y_u) {
                    return Err(bad(format!(
                        "exit {}x{} (to {}) is walkable but UNREACHABLE from spawn",
                        exit.x_u, exit.y_u, exit.dest
                    )));
                }
            }
            let zone = &mut self.zones[zi];
            zone.width_u = grid.width;
            zone.height_u = grid.height;
            zone.tiles = Some(grid);
        }
        for zone in &self.zones {
            if zone.tileset.is_some() && zone.tiles.is_none() {
                return Err(ContentError::BadMap {
                    zone: zone.id.clone(),
                    msg: "declares a tileset but has no map.txt".into(),
                });
            }
        }

        for (area, def) in props {
            let Ok(zi) = self.zones.binary_search_by(|z| z.id.as_str().cmp(&area)) else {
                return Err(ContentError::BadMap {
                    zone: area.clone(),
                    msg: "props.ron has no zone.ron with the area's id".into(),
                });
            };
            self.zones[zi].props = def.props;
        }
        Ok(())
    }

    pub fn load(dir: &Path) -> Result<ContentDb, ContentError> {
        let mut files = Vec::new();
        collect_ron_files(dir, &mut files)?;
        files.sort();

        let mut hash = FNV1A_OFFSET;
        let write = |hash: &mut u64, bytes: &[u8]| {
            for &b in bytes {
                *hash ^= b as u64;
                *hash = hash.wrapping_mul(FNV1A_PRIME);
            }
        };

        let mut db = ContentDb::default();
        // Area maps/props arrive before their zone.ron in sort order; they
        // attach to zones (by area directory name == zone id) after the loop.
        let mut pending_maps: Vec<(String, String)> = Vec::new();
        let mut pending_props: Vec<(String, PropsDef)> = Vec::new();
        // (brain id, file path, source — includes expanded, is_asm).
        // Brains compile at the END of the load so content refs resolve
        // against the fully sorted database.
        type PendingBrain = (String, String, String, bool);
        let mut pending_brains: Vec<PendingBrain> = Vec::new();
        for path in &files {
            let rel = path.strip_prefix(dir).unwrap_or(path);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let bytes = fs::read(path)?;
            write(&mut hash, rel_str.as_bytes());
            write(&mut hash, &bytes);

            let text = String::from_utf8_lossy(&bytes);
            let parse_err = |source| ContentError::Parse {
                path: rel_str.clone(),
                source: Box::new(source),
            };
            if rel_str.starts_with("monsters/") {
                db.monsters
                    .push(ron::from_str::<MonsterDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("zones/") {
                db.zones
                    .push(ron::from_str::<ZoneDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("items/") {
                db.items
                    .push(ron::from_str::<ItemDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("affixes/") {
                db.affixes
                    .push(ron::from_str::<AffixDef>(&text).map_err(parse_err)?);
            } else if rel_str == "naming.ron" {
                db.naming = ron::from_str::<NamingDef>(&text).map_err(parse_err)?;
            } else if rel_str == "speech.ron" {
                db.speech = ron::from_str::<SpeechDef>(&text).map_err(parse_err)?;
            } else if rel_str.starts_with("currency/") {
                db.currency
                    .push(ron::from_str::<CurrencyDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("tilesets/") {
                db.tilesets
                    .push(ron::from_str::<TilesetDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("gems/") {
                db.gems
                    .push(ron::from_str::<GemDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("tree/") {
                let tree = ron::from_str::<TreeDef>(&text).map_err(parse_err)?;
                db.tree.extend(tree.nodes);
            } else if rel_str.starts_with("areas/") {
                // Area bundles: everything one area needs, packaged
                // together — areas/<name>/zone.ron + brain.bot +
                // monsters/*.ron. The brain's id is the area's directory
                // name, so `brain: Some("<name>")` in zone.ron just works.
                let parts: Vec<&str> = rel_str.split('/').collect();
                if rel_str.ends_with("/zone.ron") {
                    db.zones
                        .push(ron::from_str::<ZoneDef>(&text).map_err(parse_err)?);
                } else if rel_str.ends_with("/map.txt") {
                    pending_maps.push((parts[1].to_string(), text.into_owned()));
                } else if rel_str.ends_with("/props.ron") {
                    pending_props.push((
                        parts[1].to_string(),
                        ron::from_str::<PropsDef>(&text).map_err(parse_err)?,
                    ));
                } else if parts.len() >= 4 && parts[2] == "monsters" {
                    db.monsters
                        .push(ron::from_str::<MonsterDef>(&text).map_err(parse_err)?);
                } else if rel_str.ends_with("/brain.bot") {
                    let id = parts[1].to_string();
                    let expanded =
                        expand_includes(dir, &text, 0).map_err(|msg| ContentError::Brain {
                            path: rel_str.clone(),
                            msg,
                        })?;
                    // Compilation is DEFERRED to the end of the load:
                    // content refs (`item "x"`) resolve against the
                    // sorted database.
                    pending_brains.push((id, rel_str.clone(), expanded, false));
                }
                // Anything else under areas/ is the author's business.
            } else if rel_str.starts_with("lib/") {
                // Shared script libraries (`include "..."`): include-able, never
                // brains themselves (no main()); hashed like everything else.
            } else if rel_str.starts_with("templates/") {
                // Copy-me skeletons: hashed but never loaded as content.
            } else if rel_str.starts_with("brains/") {
                let id = Path::new(&rel_str)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if rel_str.ends_with(".bot") {
                    let expanded =
                        expand_includes(dir, &text, 0).map_err(|msg| ContentError::Brain {
                            path: rel_str.clone(),
                            msg,
                        })?;
                    pending_brains.push((id, rel_str.clone(), expanded, false));
                } else if rel_str.ends_with(".asm") {
                    pending_brains.push((id, rel_str.clone(), text.into_owned(), true));
                }
            }
            // Other directories (items/, skills/, ...) come with later phases;
            // they still feed the hash so changes are never invisible.
        }
        db.content_hash = hash;

        db.monsters.sort_by(|a, b| a.id.cmp(&b.id));
        db.zones.sort_by(|a, b| a.id.cmp(&b.id));
        db.items.sort_by(|a, b| a.id.cmp(&b.id));
        db.currency.sort_by(|a, b| a.id.cmp(&b.id));
        db.tilesets.sort_by(|a, b| a.id.cmp(&b.id));
        db.attach_maps(pending_maps, pending_props)?;
        for w in db.items.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "items/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        db.affixes.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.affixes.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "affixes/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        // The loot roller picks "highest tier with ilvl <= item level" by
        // scanning from the back, so tier order is load-bearing — reject
        // violations here instead of rolling wrong values at runtime.
        for affix in &db.affixes {
            if affix.tiers.is_empty() {
                return Err(ContentError::BadAffixTiers {
                    affix: affix.id.clone(),
                    msg: "has no tiers (dead affix)".into(),
                });
            }
            for w in affix.tiers.windows(2) {
                if w[0].ilvl >= w[1].ilvl {
                    return Err(ContentError::BadAffixTiers {
                        affix: affix.id.clone(),
                        msg: format!(
                            "tiers must be sorted by ilvl strictly ascending \
                             (found ilvl {} followed by {})",
                            w[0].ilvl, w[1].ilvl
                        ),
                    });
                }
            }
        }
        db.gems.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.gems.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "gems/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        db.build_tree()?;

        // Stable-id map (#54): parse the committed registry, then invert it to
        // (tagged num → array index) per category. The content-ref resolver
        // below returns tagged nums; reads emit them; syscall inputs translate
        // back via `content_idx`.
        db.id_registry = match fs::read_to_string(dir.join("ids.ron")) {
            // A committed registry MUST parse: a present-but-corrupt `ids.ron`
            // is a hard error, never silently replaced — booting on a derived
            // registry would hand out nums that disagree with the committed
            // contract bots compiled against.
            Ok(text) => ron::from_str::<ids::Registry>(&text)
                .map_err(|e| ContentError::BadRegistry { msg: e.to_string() })?,
            // No committed registry (synthetic test dirs, fresh content):
            // derive one from the present defs so content refs still resolve to
            // stable nums. Real content commits `ids.ron` (the locked,
            // append-only registry) and the CI gate keeps it in sync — this
            // branch never runs for it.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => ids::Registry::default()
                .regenerate(&db.present_ids())
                .map(|(next, _)| next)
                .unwrap_or_default(),
            // Present but UNREADABLE (a directory in its place, a permission or
            // symlink error): a broken content tree, NOT an absent registry. Fail
            // closed exactly like a parse error — never silently derive over it.
            Err(e) => {
                return Err(ContentError::BadRegistry {
                    msg: format!("ids.ron present but unreadable: {e}"),
                });
            }
        };
        let mut num_to_idx = std::collections::HashMap::new();
        macro_rules! invert {
            ($cat:expr, $coll:expr) => {
                for (idx, d) in $coll.iter().enumerate() {
                    if let Some(n) = db.id_registry.num($cat, &d.id) {
                        num_to_idx.insert(n, ($cat, idx as u32));
                    }
                }
            };
        }
        invert!(ids::Category::Gem, db.gems);
        invert!(ids::Category::Item, db.items);
        invert!(ids::Category::Affix, db.affixes);
        invert!(ids::Category::Monster, db.monsters);
        invert!(ids::Category::Node, db.tree);
        invert!(ids::Category::Zone, db.zones);
        invert!(ids::Category::Currency, db.currency);
        invert!(ids::Category::Tileset, db.tilesets);
        db.num_to_idx = num_to_idx;

        // Brains compile LAST, with the whole sorted database in hand:
        // content refs (`item "x"`, `gem "arc"`) become stable tagged NUMS here
        // (zone-scoped line/exit/gate stay indices), so adding content can never
        // silently shift what a script means — an unknown id refuses to load.
        let mut brains = Vec::new();
        for (id, path, source, is_asm) in &pending_brains {
            let brain_err = |msg: String| ContentError::Brain {
                path: path.clone(),
                msg,
            };
            let program = if *is_asm {
                idlin_botc::assemble(source).map_err(|e| brain_err(e.to_string()))?
            } else {
                // Zone-scoped refs (line/exit/gate) resolve against the
                // one zone that names this brain.
                let owners: Vec<&ZoneDef> = db
                    .zones
                    .iter()
                    .filter(|z| z.brain.as_deref() == Some(id.as_str()))
                    .collect();
                let resolver = |kind: &str, rid: &str| -> Result<i32, String> {
                    let found = |what: &str, idx: Option<usize>| {
                        idx.ok_or_else(|| format!("unknown {what} `{rid}`"))
                    };
                    // Content categories resolve to STABLE TAGGED NUMS (the
                    // bot↔engine id); zone-scoped line/exit/gate stay zone-local
                    // indices (not registry categories).
                    let as_num = |cat: ids::Category, what: &str, idx: Option<usize>| {
                        let i = found(what, idx)?;
                        db.content_num(cat, i)
                            .ok_or_else(|| format!("{what} `{rid}` has no registry num"))
                    };
                    match kind {
                        "item" => as_num(
                            ids::Category::Item,
                            "item",
                            db.items.iter().position(|d| d.id == rid),
                        ),
                        "gem" => as_num(
                            ids::Category::Gem,
                            "gem",
                            db.gems.iter().position(|d| d.id == rid),
                        ),
                        "monster" => as_num(
                            ids::Category::Monster,
                            "monster",
                            db.monsters.iter().position(|d| d.id == rid),
                        ),
                        "zone" => as_num(
                            ids::Category::Zone,
                            "zone",
                            db.zones.iter().position(|d| d.id == rid),
                        ),
                        "currency" => as_num(
                            ids::Category::Currency,
                            "currency",
                            db.currency.iter().position(|d| d.id == rid),
                        ),
                        "line" | "exit" | "gate" => {
                            let zone = match owners.as_slice() {
                                [one] => one,
                                [] => {
                                    return Err(format!(
                                        "`{kind} \"{rid}\"` is zone-scoped, but no zone \
                                         names this brain"
                                    ));
                                }
                                many => {
                                    return Err(format!(
                                        "`{kind} \"{rid}\"` is ambiguous: {} zones share \
                                         this brain",
                                        many.len()
                                    ));
                                }
                            };
                            let idx = match kind {
                                "line" => found(
                                    "narration line",
                                    zone.lines.iter().position(|l| l.id == rid),
                                ),
                                "exit" => found(
                                    "exit (by dest)",
                                    zone.exits.iter().position(|e| e.dest == rid),
                                ),
                                _ => found("gate", zone.gates.iter().position(|g| g.id == rid)),
                            }?;
                            Ok(idx as i32)
                        }
                        other => Err(format!("unknown ref kind `{other}`")),
                    }
                };
                idlin_botc::compile_with(source, &resolver).map_err(|e| brain_err(e.to_string()))?
            };
            brains.push(BrainDef {
                id: id.clone(),
                program,
            });
        }
        db.brains = brains;
        db.brains.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.monsters.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "monsters/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        for w in db.zones.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "zones/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        for zone in &db.zones {
            for pack in &zone.packs {
                if db.monster_idx(&pack.monster).is_none() {
                    return Err(ContentError::UnknownMonster {
                        path: format!("zones/{}.ron", zone.id),
                        zone: zone.id.clone(),
                        monster: pack.monster.clone(),
                    });
                }
            }
            for exit in &zone.exits {
                if db.zone(&exit.dest).is_none() {
                    return Err(ContentError::BadMap {
                        zone: zone.id.clone(),
                        msg: format!("exit leads to unknown zone `{}`", exit.dest),
                    });
                }
            }
            // Brains address lines and gates by id — duplicates would
            // resolve to whichever comes first, silently.
            let mut seen = std::collections::BTreeSet::new();
            for l in &zone.lines {
                if !seen.insert(&l.id) {
                    return Err(ContentError::BadMap {
                        zone: zone.id.clone(),
                        msg: format!("duplicate narration line id `{}`", l.id),
                    });
                }
            }
            let mut seen = std::collections::BTreeSet::new();
            for g in &zone.gates {
                if !g.id.is_empty() && !seen.insert(&g.id) {
                    return Err(ContentError::BadMap {
                        zone: zone.id.clone(),
                        msg: format!("duplicate gate id `{}`", g.id),
                    });
                }
            }
        }
        for item in &db.items {
            for pool in &item.affix_pools {
                if !db.affixes.iter().any(|a| &a.pool == pool) {
                    return Err(ContentError::UnknownAffixPool {
                        item: item.id.clone(),
                        pool: pool.clone(),
                    });
                }
            }
        }
        for m in &db.monsters {
            for pool in &m.affix_pools {
                if !db.affixes.iter().any(|a| &a.pool == pool) {
                    return Err(ContentError::UnknownAffixPool {
                        item: format!("monster {}", m.id),
                        pool: pool.clone(),
                    });
                }
            }
        }
        for zone in &db.zones {
            if let Some(brain) = &zone.brain
                && db.brain_idx(brain).is_none()
            {
                return Err(ContentError::UnknownBrain {
                    monster: format!("zone {}", zone.id),
                    brain: brain.clone(),
                });
            }
        }
        for monster in &db.monsters {
            if db.brain_idx(&monster.brain).is_none() {
                return Err(ContentError::UnknownBrain {
                    monster: monster.id.clone(),
                    brain: monster.brain.clone(),
                });
            }
            // The skill kit obeys the same rules a character faces: real
            // gems, right kinds, tag-fitting supports, no duplicates.
            let bad = |msg: String| ContentError::BadMonsterSkills {
                monster: monster.id.clone(),
                msg,
            };
            for ms in &monster.skills {
                let Some(skill) = db.gems.iter().find(|g| g.id == ms.gem) else {
                    return Err(bad(format!("unknown gem `{}`", ms.gem)));
                };
                if skill.kind != GemKind::Skill {
                    return Err(bad(format!("`{}` is not a skill gem", ms.gem)));
                }
                let mut seen: Vec<&str> = Vec::new();
                for sup_ref in &ms.supports {
                    let Some(sup) = db.gems.iter().find(|g| g.id == sup_ref.gem) else {
                        return Err(bad(format!("unknown support `{}`", sup_ref.gem)));
                    };
                    if sup.kind != GemKind::Support {
                        return Err(bad(format!("`{}` is not a support gem", sup_ref.gem)));
                    }
                    if !sup.fits_skill(skill) {
                        return Err(bad(format!(
                            "support `{}` doesn't fit `{}` (tags)",
                            sup_ref.gem, ms.gem
                        )));
                    }
                    if seen.contains(&sup_ref.gem.as_str()) {
                        return Err(bad(format!("duplicate support `{}`", sup_ref.gem)));
                    }
                    seen.push(&sup_ref.gem);
                }
            }
        }
        Ok(db)
    }

    /// Sort nodes, resolve links into a symmetric adjacency list, find start.
    fn build_tree(&mut self) -> Result<(), ContentError> {
        self.tree.sort_by(|a, b| a.id.cmp(&b.id));
        for w in self.tree.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "tree/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        let mut adj: Vec<Vec<u32>> = vec![Vec::new(); self.tree.len()];
        for (i, node) in self.tree.iter().enumerate() {
            for link in &node.links {
                let Some(j) = self.tree_node_idx(link) else {
                    return Err(ContentError::UnknownTreeNode {
                        node: node.id.clone(),
                        link: link.clone(),
                    });
                };
                // Undirected: either side may declare the edge.
                if !adj[i].contains(&(j as u32)) {
                    adj[i].push(j as u32);
                }
                if !adj[j].contains(&(i as u32)) {
                    adj[j].push(i as u32);
                }
            }
        }
        for edges in &mut adj {
            edges.sort_unstable();
        }
        self.tree_adj = adj;
        self.tree_refs = self.tree.iter().map(|n| n.num).collect();
        let mut seen = std::collections::BTreeMap::new();
        for (i, &r) in self.tree_refs.iter().enumerate() {
            if let Some(prev) = seen.insert(r, i) {
                return Err(ContentError::DuplicateId {
                    path: format!(
                        "tree/ (num {r} used by both `{}` and `{}`)",
                        self.tree[prev].id, self.tree[i].id
                    ),
                    id: self.tree[i].id.clone(),
                });
            }
        }
        self.tree_start = match self.tree_node_idx("start") {
            Some(i) => i as u32,
            None if self.tree.is_empty() => 0,
            None => return Err(ContentError::NoStartNode),
        };
        Ok(())
    }
}

/// Expand `include "path";` lines in a .bot source — paths resolve under
/// `content/lib/` (the shared-library home). Textual splice, depth-capped;
/// included files feed the content hash as themselves, so a library edit
/// always changes the world's content identity.
fn expand_includes(content_root: &Path, src: &str, depth: u32) -> Result<String, String> {
    if depth > 8 {
        return Err("include depth exceeded (cycle?)".into());
    }
    let mut out = String::with_capacity(src.len());
    for line in src.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("include ") {
            let rel = rest.trim().trim_end_matches(';').trim_matches('"');
            if rel.contains("..") {
                return Err(format!("include escapes content/: {rel}"));
            }
            let path = content_root.join("lib").join(rel);
            let text = fs::read_to_string(&path).map_err(|e| format!("include {rel}: {e}"))?;
            out.push_str(&expand_includes(content_root, &text, depth + 1)?);
            out.push('\n');
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    Ok(out)
}

fn collect_ron_files(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if !dir.exists() {
        // `exists()` follows symlinks, so a TRULY-absent path and a DANGLING
        // symlink both land here. They are not the same: a missing dir is the
        // wrong-CWD / fresh case (empty content is fine), but a dangling
        // `content` link is present-but-broken and must fail closed (#63), or it
        // would silently boot an empty, divergent world. `symlink_metadata`
        // (lstat, no follow) succeeds for the dangling link and errors for the
        // truly-absent path.
        return match dir.symlink_metadata() {
            Ok(_) => Err(std::io::Error::other(format!(
                "{} exists but its target is missing (broken symlink)",
                dir.display()
            ))),
            Err(_) => Ok(()),
        };
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_ron_files(&path, out)?;
        } else if path
            .extension()
            .is_some_and(|e| e == "ron" || e == "asm" || e == "bot" || e == "txt")
        {
            out.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_dir_is_empty_content() {
        let db = ContentDb::load(Path::new("/nonexistent/idlin-content")).unwrap();
        assert_eq!(db.content_hash, 0xcbf29ce484222325); // FNV offset, nothing hashed
        assert!(db.monsters.is_empty());
    }

    #[test]
    fn loads_the_real_content_dir() {
        // The workspace content/ directory must always parse and validate.
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        assert!(!db.zones.is_empty(), "expected at least one zone");
        assert!(!db.monsters.is_empty(), "expected at least one monster");
        let zone = db
            .zone("withered_shore")
            .expect("withered_shore must exist");
        assert!(!zone.packs.is_empty());
    }

    #[test]
    fn content_id_map_round_trips() {
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        // A known gem resolves to a tagged num and back to its array index.
        let idx = db.gems.iter().position(|g| g.id == "power_shot").unwrap();
        let num = db.content_num(ids::Category::Gem, idx).expect("gem num");
        assert_eq!(ids::category_code(num), ids::Category::Gem.code());
        assert_eq!(db.content_idx(num), Some((ids::Category::Gem, idx as u32)));
        // The map is populated and every num decodes to its own category.
        assert!(db.num_to_idx.len() >= db.gems.len() + db.items.len());
        for (&num, &(cat, idx)) in &db.num_to_idx {
            assert_eq!(ids::category_code(num), cat.code());
            assert_eq!(db.content_num(cat, idx as usize), Some(num));
        }
    }

    #[test]
    fn support_tag_gating_on_real_content() {
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        let gem = |id: &str| db.gems.iter().find(|g| g.id == id).expect(id);
        let (cleave, ember, shot) = (gem("cleave"), gem("ember_bolt"), gem("power_shot"));
        // Melee-only fits the melee sweep, not the spell or the arrow.
        let heavier = gem("heavier_blows");
        assert!(heavier.fits_skill(cleave));
        assert!(!heavier.fits_skill(ember));
        assert!(!heavier.fits_skill(shot));
        // Projectile-only fits both projectiles, not the sweep.
        let split = gem("split_quiver");
        assert!(!split.fits_skill(cleave));
        assert!(split.fits_skill(ember));
        assert!(split.fits_skill(shot));
        // Attack-or-spell fits everything in the current roster.
        let embers = gem("added_embers");
        assert!(embers.fits_skill(cleave));
        assert!(embers.fits_skill(ember));
        assert!(embers.fits_skill(shot));
        // AoE-only fits the sweep alone.
        let widening = gem("widening");
        assert!(widening.fits_skill(cleave));
        assert!(!widening.fits_skill(ember));
        assert!(!widening.fits_skill(shot));
    }

    #[test]
    fn affix_pool_subscriptions_resolve() {
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        // Every gear base draws from at least one real pool, and every
        // affix's pool has at least one subscriber (no orphans).
        for item in &db.items {
            assert!(
                !item.affix_pools.is_empty(),
                "{} subscribes to no pools",
                item.id
            );
        }
        for affix in &db.affixes {
            assert!(
                db.items.iter().any(|i| i.affix_pools.contains(&affix.pool))
                    || db
                        .monsters
                        .iter()
                        .any(|m| m.affix_pools.contains(&affix.pool)),
                "affix {} sits in pool `{}` with no subscribers",
                affix.id,
                affix.pool
            );
        }
    }

    #[test]
    fn unknown_affix_pool_subscriptions_are_rejected() {
        let tc = TempContent::new(
            "badpool",
            &[
                ("affixes/a.ron", AFFIX_OK),
                (
                    "items/sword.ron",
                    r#"ItemDef(
                        id: "sword", name: "Sword", slot: weapon,
                        affix_pools: ["weapon"],
                    )"#,
                ),
            ],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::UnknownAffixPool { item, pool }) => {
                assert_eq!(item, "sword");
                assert_eq!(pool, "weapon");
            }
            other => panic!("expected UnknownAffixPool, got {other:?}"),
        }
    }

    /// Content refs in brains resolve by NAME at load — and unknown ids
    /// refuse to load. The index-pinning test this replaces ("UPDATE THE
    /// SCRIPT AND THIS TEST TOGETHER") is dead: position is the engine's
    /// business now.
    #[test]
    fn brain_content_refs_resolve_and_unknowns_fail() {
        let zone = r#"ZoneDef(
            id: "z", name: "Z", width_u: 20, height_u: 20,
            spawn_x_u: 5, spawn_y_u: 5,
            brain: Some("z"),
            lines: [(id: "welcome", text: "hi")],
            gates: [(id: "start", x0: 1, y0: 1, x1: 2, y1: 2)],
            exits: [(x_u: 9, y_u: 9, dest: "z", open: true)],
            packs: [],
        )"#;
        let brain_ok = r#"
            const L = line "welcome";
            const G = gate "start";
            const E = exit "z";
            const Z = zone "z";
            fn main() { narrate(L, 0); set_gate(G, 1); set_exit(E, 1); }
        "#;
        let tc = TempContent::new(
            "refs-ok",
            &[("areas/z/zone.ron", zone), ("areas/z/brain.bot", brain_ok)],
        );
        let db = ContentDb::load(&tc.0).expect("refs resolve");
        assert_eq!(db.brains.len(), 1);

        let brain_bad = r#"
            const L = line "nope";
            fn main() { narrate(L, 0); }
        "#;
        let tc = TempContent::new(
            "refs-bad",
            &[("areas/z/zone.ron", zone), ("areas/z/brain.bot", brain_bad)],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::Brain { msg, .. }) => {
                assert!(msg.contains("nope"), "error names the bad id: {msg}");
            }
            other => panic!("expected Brain error, got {other:?}"),
        }
    }

    /// A committed `ids.ron` that exists but won't parse is a HARD error — never
    /// silently replaced by a derived registry (which would hand out nums that
    /// disagree with the contract bots compiled against). An ABSENT registry is
    /// fine: synthetic dirs derive one. Both halves verified here.
    #[test]
    fn malformed_committed_registry_is_rejected() {
        let zone = r#"ZoneDef(
            id: "z", name: "Z", width_u: 20, height_u: 20,
            spawn_x_u: 5, spawn_y_u: 5,
            lines: [], gates: [], exits: [], packs: [],
        )"#;
        // Absent ids.ron: loads, deriving a registry from the defs.
        let tc = TempContent::new("reg-absent", &[("areas/z/zone.ron", zone)]);
        let db = ContentDb::load(&tc.0).expect("absent registry derives cleanly");
        assert!(
            db.content_num(ids::Category::Zone, 0).is_some(),
            "derived registry numbers the zone"
        );
        // Present-but-garbage ids.ron: hard BadRegistry, not a silent derive.
        let tc = TempContent::new(
            "reg-malformed",
            &[
                ("areas/z/zone.ron", zone),
                ("ids.ron", "this is not ron {{{"),
            ],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::BadRegistry { .. }) => {}
            other => panic!("expected BadRegistry, got {other:?}"),
        }
        // Present-but-UNREADABLE ids.ron (a directory in its place): a broken
        // tree, also a hard error — distinct from the absent case above, which
        // is the only one allowed to derive a registry (#63 fail-closed).
        let tc = TempContent::new("reg-unreadable", &[("areas/z/zone.ron", zone)]);
        fs::create_dir_all(tc.0.join("ids.ron")).unwrap();
        match ContentDb::load(&tc.0) {
            Err(ContentError::BadRegistry { .. }) => {}
            other => panic!("expected BadRegistry for an unreadable registry, got {other:?}"),
        }
    }

    /// A MISSING content dir is fine (empty content, the wrong-CWD case), but a
    /// DANGLING `content` symlink is present-but-broken and must fail closed —
    /// otherwise the server would silently boot an empty, divergent world (#63).
    #[cfg(unix)]
    #[test]
    fn a_dangling_content_symlink_fails_closed() {
        let base =
            std::env::temp_dir().join(format!("idlin-content-dangling-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        let link = base.join("content");
        std::os::unix::fs::symlink(base.join("no-such-target"), &link).unwrap();
        match ContentDb::load(&link) {
            Err(ContentError::Io(_)) => {}
            other => panic!("expected an Io error for a dangling content link, got {other:?}"),
        }
        // Sanity: a plainly-absent path still loads as empty content.
        let absent = base.join("not-there");
        assert!(ContentDb::load(&absent).is_ok_and(|db| db.zones.is_empty()));
        let _ = fs::remove_dir_all(&base);
    }

    /// The docs are the bot/player reference manual (#54): reads strip the
    /// definitional fields on the promise they live HERE. Guard that the docs
    /// carry the FULL surface — formulas, tier ranges, node grants, zone packs —
    /// not the old id-only stub.
    #[test]
    fn content_docs_carry_the_full_definitional_surface() {
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        let docs = db.content_docs(&db.id_registry);
        let cats = docs["categories"].as_object().expect("categories object");

        // Gems expose skill metadata and {base, per_level} formulas, with the
        // tagged num injected and the redundant `public` flag stripped.
        let gem = &cats["gem"].as_array().unwrap()[0];
        assert!(gem.get("num").is_some(), "every entry carries its num");
        assert!(
            gem.get("public").is_none(),
            "redundant public flag stripped"
        );
        for field in ["skill_kind", "target_mode", "tags", "mana_cost", "crit_bp"] {
            assert!(gem.get(field).is_some(), "gem docs expose `{field}`");
        }
        assert!(
            gem["mana_cost"].get("base").is_some() && gem["mana_cost"].get("per_level").is_some(),
            "formulas serialize as base/per_level"
        );

        // Affix tiers carry roll ranges + weights (crafting bots need them).
        let tier = &cats["affix"].as_array().unwrap()[0]["tiers"]
            .as_array()
            .unwrap()[0];
        assert!(
            tier.get("min").is_some() && tier.get("max").is_some() && tier.get("weight").is_some()
        );

        // Nodes expose BOTH the tagged num and the u16 build_ref, plus grants.
        let node = &cats["node"].as_array().unwrap()[0];
        assert!(node.get("build_ref").is_some() && node.get("grants").is_some());
        assert_ne!(
            node["num"].as_i64(),
            node["build_ref"].as_i64(),
            "num is the tagged id; build_ref is the raw u16"
        );

        // Zones are PRIVATE: they still get an internal registry num (SelfStatus
        // emits it for change-detection), but their authored surface — narration
        // prose, gate choreography, spawn packs — never reaches the public docs.
        assert!(
            cats["zone"].as_array().unwrap().is_empty(),
            "private zones publish nothing to the docs"
        );
    }

    /// Build a throwaway content dir from (relative path, contents) pairs.
    struct TempContent(PathBuf);
    impl TempContent {
        fn new(name: &str, files: &[(&str, &str)]) -> TempContent {
            let dir = std::env::temp_dir()
                .join(format!("idlin-content-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            for (rel, body) in files {
                let path = dir.join(rel);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, body).unwrap();
            }
            TempContent(dir)
        }
    }
    impl Drop for TempContent {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const AFFIX_OK: &str = r#"AffixDef(
        id: "hale", name: "Hale", kind: prefix, pool: "armour",
        stat: life, layer: added,
        tiers: [(ilvl: 1, min: 8, max: 15), (ilvl: 3, min: 16, max: 28)],
    )"#;

    const TILESET_OK: &str = r##"TilesetDef(
        id: "cave",
        tiles: [
            (glyph: '.', id: "floor", walkable: true,  blocks_los: false, ground: "stone"),
            (glyph: '#', id: "wall",  walkable: false, blocks_los: true,  ground: "stone", prop: Some("wall")),
            (glyph: '~', id: "pool",  walkable: false, blocks_los: false, ground: "water"),
        ],
        palette: [("stone", "#333333"), ("water", "#112233")],
    )"##;

    const TILE_ZONE_OK: &str = r#"ZoneDef(
        id: "den", name: "The Den",
        spawn_x_u: 1, spawn_y_u: 1,
        tileset: Some("cave"),
        packs: [],
    )"#;

    #[test]
    fn area_map_binds_to_its_zone_and_derives_dims() {
        let tc = TempContent::new(
            "tilemap",
            &[
                ("tilesets/cave.ron", TILESET_OK),
                ("areas/den/zone.ron", TILE_ZONE_OK),
                ("areas/den/map.txt", "#####\n#...#\n#.~.#\n#####\n"),
            ],
        );
        let db = ContentDb::load(&tc.0).unwrap();
        let zone = db.zone("den").unwrap();
        assert_eq!(
            (zone.width_u, zone.height_u),
            (5, 4),
            "dims come from the map"
        );
        let grid = zone.tiles.as_ref().expect("grid attached");
        let ts = db.tileset("cave").unwrap();
        let tile = |x, y| &ts.tiles[grid.cell(x, y).unwrap() as usize];
        assert!(
            !tile(0, 0).walkable && tile(0, 0).blocks_los,
            "corner is wall"
        );
        assert!(tile(1, 1).walkable, "interior floor walks");
        assert!(
            !tile(2, 2).walkable && !tile(2, 2).blocks_los,
            "pool blocks feet, not sight"
        );
    }

    #[test]
    fn ragged_or_unknown_glyph_maps_are_rejected() {
        for (name, map) in [("ragged", "###\n##\n"), ("glyph", "###\n#X#\n###\n")] {
            let tc = TempContent::new(
                name,
                &[
                    ("tilesets/cave.ron", TILESET_OK),
                    ("areas/den/zone.ron", TILE_ZONE_OK),
                    ("areas/den/map.txt", map),
                ],
            );
            match ContentDb::load(&tc.0) {
                Err(ContentError::BadMap { zone, .. }) => assert_eq!(zone, "den"),
                other => panic!("{name}: expected BadMap, got {other:?}"),
            }
        }
    }

    #[test]
    fn unwalkable_spawn_is_rejected() {
        let tc = TempContent::new(
            "wallspawn",
            &[
                ("tilesets/cave.ron", TILESET_OK),
                ("areas/den/zone.ron", TILE_ZONE_OK),
                // Spawn (1,1) is a wall in this map.
                ("areas/den/map.txt", "###\n###\n###\n"),
            ],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::BadMap { zone, msg }) => {
                assert_eq!(zone, "den");
                assert!(msg.contains("spawn"), "{msg}");
            }
            other => panic!("expected BadMap, got {other:?}"),
        }
    }

    #[test]
    fn tileset_validation_catches_bad_palettes_and_ecology() {
        let dup_glyph = TILESET_OK.replace("glyph: '~'", "glyph: '#'");
        let bad_ground = TILESET_OK.replace("ground: \"water\")", "ground: \"lava\")");
        let ghost_mob = TILESET_OK.replace("palette:", "natural_monsters: [\"kraken\"], palette:");
        for (name, body) in [
            ("dupglyph", &dup_glyph),
            ("ground", &bad_ground),
            ("mob", &ghost_mob),
        ] {
            let tc = TempContent::new(name, &[("tilesets/cave.ron", body.as_str())]);
            match ContentDb::load(&tc.0) {
                Err(ContentError::BadTileset { tileset, .. }) => assert_eq!(tileset, "cave"),
                other => panic!("{name}: expected BadTileset, got {other:?}"),
            }
        }
    }

    #[test]
    fn real_tilesets_load_and_name_real_monsters() {
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        assert!(db.tileset("shore").is_some() && db.tileset("town").is_some());
        for m in &db.tileset("shore").unwrap().natural_monsters {
            assert!(db.monster_idx(m).is_some(), "shore ecology lists {m}");
        }
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let tc = TempContent::new(
            "dup",
            &[("affixes/a.ron", AFFIX_OK), ("affixes/b.ron", AFFIX_OK)],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::DuplicateId { id, .. }) => assert_eq!(id, "hale"),
            other => panic!("expected DuplicateId, got {other:?}"),
        }
    }

    #[test]
    fn unsorted_affix_tiers_are_rejected() {
        let tc = TempContent::new(
            "tiers",
            &[(
                "affixes/bad.ron",
                r#"AffixDef(
                    id: "bad", name: "Bad", kind: prefix, pool: "armour",
                    stat: life, layer: added,
                    tiers: [(ilvl: 5, min: 1, max: 2), (ilvl: 2, min: 3, max: 4)],
                )"#,
            )],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::BadAffixTiers { affix, .. }) => assert_eq!(affix, "bad"),
            other => panic!("expected BadAffixTiers, got {other:?}"),
        }
    }

    #[test]
    fn tierless_affixes_are_rejected() {
        let tc = TempContent::new(
            "notiers",
            &[(
                "affixes/empty.ron",
                r#"AffixDef(
                    id: "empty", name: "Empty", kind: prefix, pool: "armour",
                    stat: life, layer: added, tiers: [],
                )"#,
            )],
        );
        assert!(matches!(
            ContentDb::load(&tc.0),
            Err(ContentError::BadAffixTiers { .. })
        ));
    }

    #[test]
    fn zone_referencing_unknown_monster_is_rejected() {
        let tc = TempContent::new(
            "zoneref",
            &[(
                "zones/test.ron",
                r#"ZoneDef(
                    id: "test", name: "Test", width_u: 10, height_u: 10,
                    spawn_x_u: 5, spawn_y_u: 5,
                    packs: [(monster: "no_such_monster", count: 1,
                             x_u: 2, y_u: 2, radius_u: 1, respawn_ticks: 10)],
                )"#,
            )],
        );
        assert!(matches!(
            ContentDb::load(&tc.0),
            Err(ContentError::UnknownMonster { .. })
        ));
    }

    #[test]
    fn tree_link_to_unknown_node_is_rejected() {
        let tc = TempContent::new(
            "treelink",
            &[(
                "tree/core.ron",
                r#"TreeDef(nodes: [
                    NodeDef(id: "start", num: 1, name: "Start", pos: (0, 0),
                            kind: socket, links: ["nowhere"], grants: []),
                ])"#,
            )],
        );
        assert!(matches!(
            ContentDb::load(&tc.0),
            Err(ContentError::UnknownTreeNode { .. })
        ));
    }
}
