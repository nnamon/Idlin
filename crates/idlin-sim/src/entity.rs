//! Entity model. Entities live in slot storage inside a zone; every external
//! reference (protocol, syscalls, AI targets) uses the `net_id` — a monotonic
//! never-reused u32 — so slot reuse can never alias a stale reference.
//!
//! Characters are classless: identity comes from gear, the passive tree, and
//! (later) gems — all expressed as affix grants over universal bases.

use crate::fixed::{Fx, FxV2};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default)]
#[repr(u8)]
pub enum Rarity {
    #[default]
    Normal = 0,
    Magic = 1,
    Rare = 2,
    Unique = 3,
}

/// The rarity ladder's display names and colors — the single owner,
/// generated into `web/src/gen/constants.ts` so client and sim never
/// drift. Indexed by `Rarity as usize`.
pub const RARITY_NAMES: [&str; 4] = ["common", "magic", "rare", "UNIQUE"];
pub const RARITY_COLORS: [&str; 4] = ["#bfbfbf", "#5a8aff", "#ffd75a", "#ff9a3c"];

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
    /// Factor on skills' base crit chance (10000 = unchanged).
    pub crit_inc: i64,
    /// Total crit damage multiplier in basis points (15000 = ×1.5).
    pub crit_multi: i64,
    /// Factor on spell cast time (10000 = unchanged; higher = faster).
    pub cast_speed: i64,
    /// Per-type attack damage: phys, fire, cold, lightning, chaos.
    pub damage: [i64; DMG_COUNT],
    pub accuracy: i64,
    pub evasion: i64,
    /// Attenuates physical damage taken.
    pub armour: i64,
    /// Typed resistances in basis points (capped at use); see RES_*.
    pub resists: [i64; RES_COUNT],
    pub range: Fx,
    /// Hit reactions: basis points easier to stun victims / harder to be
    /// stunned, and flat knockback (centi-units) shoved on every hit.
    pub stagger: i64,
    pub poise: i64,
    pub knockback_cu: i64,
    /// Ailment levers (#88), attacker-side: PER-ELEMENT basis-point chance to
    /// inflict on a matching-element hit (no blanket all-ailments lever), the
    /// "crits cannot cause ailments" flag, the Shock/Chill magnitude caps (bp), and
    /// a duration scale (bp) applied to ailments this entity inflicts.
    pub ignite_chance: i64,
    pub shock_chance: i64,
    pub chill_chance: i64,
    pub crits_no_ailment: bool,
    pub shock_max: i64,
    pub chill_max: i64,
    pub ailment_duration: i64,
    /// Ticks one use of the basic weapon occupies (speed-scaled).
    pub use_ticks: u32,
    /// Occupied until this tick: no moving, no acting (use-time commitment).
    pub busy_until: u64,
    pub speed_per_tick: Fx,
    /// Body radius for collision/separation.
    pub radius: Fx,
    pub projectile: bool,
    /// Find factors (base 10000): the KILLER's values scale its drops.
    pub item_rarity: i64,
    pub item_quantity: i64,
    /// Last tick this entity dealt or took damage (drives out-of-combat regen).
    pub last_combat_tick: u64,
    /// Tick of this entity's most recent kill (#109 RecentlyKilled). 0 = never
    /// killed (the sentinel; a kill can't land at tick 0). Drives the post-kill
    /// momentum window for strike-time conditional affixes.
    pub last_kill_tick: u64,
    /// Derived cache (#109): does any of this entity's power sources carry a
    /// STRIKE-TIME condition (life %, …)? Set at derive (those grants are NOT
    /// folded into the cached fields here — they vary mid-combat); when true the
    /// hit path re-derives an effective sheet per strike. Pure function of hashed
    /// inputs, but hashed like the rest of CombatStats (whole-struct rule).
    pub has_strike_conditions: bool,
    /// Derived cache (#109 B2b): the entity's TARGET-DEPENDENT conditional grants
    /// (e.g. "more damage vs ignited"), collected at derive. These can't fold into
    /// the cached fields NOR the per-use effective sheet — they read the VICTIM's
    /// state, so `World::strike` folds them per-victim against `target_ailments`.
    /// Usually empty; hashed like the rest of CombatStats (whole-struct rule).
    pub target_grants: Vec<crate::stats::Grant>,
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

    /// Energy-shield fill for display: `-1` when the entity has no ES at all
    /// (the client then draws no shield band), otherwise `es/es_max` as `0..=100`
    /// (a depleted-but-present shield reads as `0`, so the empty track still
    /// shows that this entity carries a shield).
    pub fn es_pct(&self) -> i32 {
        if self.es_max <= 0 {
            return -1;
        }
        (self.es.clamp(0, self.es_max) * 100 / self.es_max) as i32
    }
}

/// How a skill use is aimed; which forms are legal is the gem's
/// target_mode (content).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SkillTarget {
    Entity(u32),
    Point(FxV2),
    Direction(FxV2),
}

/// An attack intent: aim plus what fires. `skill: None` is the basic
/// weapon attack; `Some(node)` names the tree socket whose gem fires.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AttackIntent {
    pub target: SkillTarget,
    pub skill: Option<u32>,
}

/// A first-class ailment kind (#88) — defined in `idlin-content` (the leaf) so a
/// `Condition` can read it (#109 B2b `TargetHasAilment`); re-exported here, where
/// `ActiveEffect::Ailment` carries it.
pub use idlin_content::stats::AilmentKind;

/// A timed effect on an entity: skill-applied damage over time, a temporary stat
/// buff (folded into refresh_derived_stats while active), or a first-class
/// ailment (#88).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ActiveEffect {
    Dot {
        /// DMG_* index.
        dtype: u8,
        /// Damage applied once per second while active.
        per_second: i64,
        ticks_left: u32,
        /// Attacker net id (XP/credit on death-by-dot goes here if alive).
        source: u32,
        /// Gem index (one dot per source+skill; reapply refreshes).
        skill: u32,
    },
    Buff {
        grants: Vec<crate::stats::Grant>,
        ticks_left: u32,
    },
    /// A named ailment (#88). Strongest-magnitude replaces; reapply refreshes
    /// `ticks_left`. One entry per `kind` per entity.
    Ailment {
        kind: AilmentKind,
        /// Ignite: burn per second. Shock: +% damage taken (basis points).
        /// Chill: +% action/move slow (basis points).
        magnitude: i64,
        ticks_left: u32,
        /// Attacker net id (credit on death-by-ignite goes here).
        source: u32,
    },
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

/// Speech-bubble rate limit (ticks between says).
pub const SAY_COOLDOWN_CHAR: u64 = 100;
pub const SAY_COOLDOWN_MONSTER: u64 = 50;

/// One rolled affix on a concrete item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RolledAffix {
    /// Index into ContentDb::affixes.
    pub affix_idx: u32,
    /// One rolled value per affix effect, positional (flat units or basis points
    /// per each effect's layer). A plain affix has one; a hybrid (#86) has several.
    pub values: Vec<i64>,
    /// Which tier rolled (index into AffixDef::tiers) — names and rerolls
    /// are tier-aware.
    #[serde(default)]
    pub tier: u32,
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
    /// Rolled display name: base for normal, affix-composed for magic
    /// ("Heavy Driftwood Bow of Haste"), generated for rare/unique
    /// ("Vile Thorns"). Empty = fall back to the base name.
    #[serde(default)]
    pub name: String,
    /// Flasks only: charges currently held (capped by the base's
    /// flask_charges; kills refill while equipped).
    #[serde(default)]
    pub charges: u32,
    /// A SIGNATURE UNIQUE (#136 T5): index into ContentDb::uniques. The
    /// def's fixed mods fold at the gear chokepoint; `affixes` stays empty.
    /// Serialized (snapshot v17) and hashed — identity is state.
    #[serde(default)]
    pub unique_idx: Option<u32>,
}

/// What occupies a bag cell: gear, or — since #54 PR2b — a 1×1 gem. Gems
/// left the old separate pouch and now compete for grid space like everything
/// else. A bot tells them apart by the tagged num's category (`num >> 23`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BagItem {
    Gear(Item),
    Gem(GemInstance),
}

impl BagItem {
    /// Bag footprint: gear from its base def, gems are always 1×1.
    pub fn footprint(&self, content: &idlin_content::ContentDb) -> (u8, u8) {
        match self {
            BagItem::Gear(it) => {
                let d = &content.items[it.base_idx as usize];
                (d.w, d.h)
            }
            BagItem::Gem(_) => (1, 1),
        }
    }

    pub fn as_gear(&self) -> Option<&Item> {
        match self {
            BagItem::Gear(it) => Some(it),
            BagItem::Gem(_) => None,
        }
    }

    pub fn as_gem(&self) -> Option<&GemInstance> {
        match self {
            BagItem::Gem(g) => Some(g),
            BagItem::Gear(_) => None,
        }
    }
}

/// An entry sitting in the bag grid at (x, y); footprint comes from `item`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlacedItem {
    pub item: BagItem,
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
/// support gems (capacity grows with the skill gem's level — see
/// [`support_slots`]).
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
    /// One obol (index into ContentDb::currency) — picked up as a count.
    Currency(u32),
}

pub const GEM_LEVEL_CAP: u32 = 20;

pub fn gem_xp_to_next(level: u32) -> i64 {
    let l = level as i64;
    60 + 30 * l * l
}

/// Support capacity of a SKILL gem, by its level: 1 slot at first, a
/// second at 7, a third at 14 (the level-20 cap never reaches four).
pub fn support_slots(level: u32) -> usize {
    1 + (level / 7) as usize
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
    /// Obol counts, indexed like ContentDb::currency (resized on demand).
    #[serde(default)]
    pub currency: Vec<u64>,
    /// Gems socketed into allocated tree socket nodes (keyed by node index;
    /// BTreeMap for deterministic iteration).
    pub sockets: std::collections::BTreeMap<u32, SocketedGem>,
    /// Fog of war (#129): cells this character has DISCOVERED in the current
    /// zone — a row-major bitset (`bit = y*w + x`, `ceil(w*h/64)` words),
    /// stamped as a `FOG_SIGHT_CELLS` disc every tick it is alive. The
    /// deterministic source for the wire's visibility filter (masked tiles /
    /// reveal deltas). Survives death (knowledge isn't amnesia); RESET on
    /// zone entry (a new zone starts undiscovered). Hashed + serialized.
    #[serde(default)]
    pub explored: Vec<u64>,
    /// Campaign progress (#136): bit N-1 set = act N complete. Set by killing
    /// the act boss; read by story-sealed exits and by bots via SelfStatus
    /// (SS_FLAGS bit1 = act 1). Travels with the bundle — progress survives
    /// zone transfers. Hashed + serialized. (The charts gate, #136 T4, reads
    /// it next.)
    #[serde(default)]
    pub story_acts: u32,
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
    /// Spawn rarity — the SAME enum items use, end to end.
    #[serde(default)]
    pub rarity: Rarity,
    /// EFFECTIVE level: area level (+1 magic, +2 rare); authored
    /// uniques keep their def level. 0 = legacy (fall back to the def).
    #[serde(default)]
    pub level: u32,
    /// Rolled affixes (magic/rare spawns) — the same RolledAffix items
    /// carry, applied through the same Grant machinery.
    #[serde(default)]
    pub affixes: Vec<RolledAffix>,
    /// Magic spawns compose tier names; rares draw from the naming
    /// pools. Empty = the def's plain name.
    #[serde(default)]
    pub display_name: String,
    /// The def's gem kit, resolved at spawn — the SAME structure characters
    /// socket, so the executor and syscalls treat both alike (UseSkill
    /// slot 1..N indexes this list; monster gems never gain XP).
    #[serde(default)]
    pub skills: Vec<SocketedGem>,
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
    /// Timed effects (dots, buffs); swept by the effects pass.
    #[serde(default)]
    pub effects: Vec<ActiveEffect>,
    /// Last tick this entity spoke (speech-bubble rate limit).
    #[serde(default)]
    pub last_say_tick: u64,
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

    /// Magnitude of an active ailment of `kind` on this entity (0 if absent) —
    /// the read-side for Shock (incoming-damage amp) and Chill (action slow), #88.
    pub fn ailment(&self, kind: AilmentKind) -> i64 {
        self.effects
            .iter()
            .find_map(|e| match e {
                ActiveEffect::Ailment {
                    kind: k, magnitude, ..
                } if *k == kind => Some(*magnitude),
                _ => None,
            })
            .unwrap_or(0)
    }

    /// Active-ailment bitmask — an OR of `AilmentKind::bit()` for every ailment
    /// currently on this entity (ignite=1, shock=2, chill=4). Drives the nameplate
    /// display and the #109-B2b `TargetHasAilment` strike condition (one builder so
    /// the two can't disagree on the bit layout).
    pub fn ailment_bits(&self) -> u8 {
        let mut b = 0u8;
        for kind in [AilmentKind::Ignite, AilmentKind::Shock, AilmentKind::Chill] {
            if self.ailment(kind) > 0 {
                b |= kind.bit();
            }
        }
        b
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hybrid_rolled_affix_survives_a_postcard_round_trip() {
        // The snapshot serializer is postcard (non-self-describing), so the
        // multi-value layout must round-trip byte-exactly (#86 Phase A). A hybrid
        // affix carries several values; a single-effect one carries a vec of one.
        // Mutation: revert RolledAffix.values → a scalar `value` and this won't
        // compile; a layout drift makes the decoded item != the original.
        let item = Item {
            base_idx: 3,
            rarity: Rarity::Magic,
            item_level: 12,
            affixes: vec![
                RolledAffix {
                    affix_idx: 7,
                    values: vec![9, 700],
                    tier: 1,
                }, // hybrid
                RolledAffix {
                    affix_idx: 2,
                    values: vec![15],
                    tier: 0,
                }, // plain
            ],
            name: "Test".into(),
            charges: 0,
            unique_idx: None,
        };
        let bytes = postcard::to_allocvec(&item).expect("serialize");
        let back: Item = postcard::from_bytes(&bytes).expect("deserialize");
        assert_eq!(back.affixes.len(), 2);
        assert_eq!(
            back.affixes[0].values,
            vec![9, 700],
            "hybrid values preserved"
        );
        assert_eq!(back.affixes[1].values, vec![15], "plain value preserved");
        assert_eq!(back.affixes[0].tier, 1);
    }
}
