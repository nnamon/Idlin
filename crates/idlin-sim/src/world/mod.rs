//! The world: one zone (Phase 1), its entities, and the bots driving every
//! acting thing in it — player characters and NPCs alike. The engine runs
//! content; behavior lives in brain programs, stats and layout and power in
//! RON. The fixed-order tick pipeline must be bit-exact for identical
//! (seed, content, input history) on every platform.
//!
//! This module owns the world's shape and the tick pipeline; the subsystems
//! live in submodules, each an `impl World` block over the same state:
//! `combat`, `loot`, `inventory`, `progression`, `tree`, `gems`, `views`.

mod combat;
mod gems;
mod inventory;
mod loot;
mod progression;
mod tree;
mod views;
mod zone_brain;

pub use views::{CharacterSheetView, RosterRow, SkillStatView};

use crate::bots::{Bot, BotArena, program_hash};
use crate::entity::{CharacterState, CombatStats, Entity, MonsterState, Rarity};
use crate::fixed::{Fx, FxV2};
use crate::rng::{Domain, Pcg32};
use crate::zone::{PackState, Zone};
use idlin_content::{ContentDb, ItemDef, MonsterDef};
use idlin_vm::Vm;
use serde::{Deserialize, Serialize};

/// Sim ticks per second. The protocol never assumes this; it ships tick
/// numbers, so the rate can change without breaking clients.
pub const TICK_HZ: u32 = 10;
/// Ticks a dead character waits before respawning.
pub const RESPAWN_TICKS: u64 = 50;
/// Ground loot lifetime.
pub const LOOT_DESPAWN_TICKS: u64 = 600;
/// Fog-of-war sight radius in CELLS (#129): the disc a living character
/// reveals around itself each tick — the deterministic record of what it has
/// discovered (`CharacterState.explored`), and the wire filter's unit of
/// knowledge. THE single owner: the client's fog renderer imports this via
/// the generated constants (export_constants), so sim and view can't drift.
/// Sized to the follow camera's whole screen (see web FogOfWar.ts derivation)
/// — the fog exists to stop route precomputation, not to shrink the view.
pub const FOG_SIGHT_CELLS: i32 = 28;
/// How close a character must be to grab loot.
pub const PICKUP_RANGE: Fx = Fx::from_raw(0x2_8000); // 2.5 u
/// Ticks out of combat before regeneration kicks in.
pub const REGEN_DELAY_TICKS: u64 = 50;
/// Allies within this range of a kill receive a half XP share.
pub const XP_SHARE_RADIUS: Fx = Fx::from_int(10);
/// Ticks a monster corpse lies where it fell before decaying away.
pub const CORPSE_TICKS: u64 = 300;
/// Untouched ticks before energy shield begins recharging.
pub const ES_RECHARGE_DELAY_TICKS: u64 = 40;
/// `map_ends_at` after the clock rang (#178): distinct from 0 ("never
/// armed" — the operator's ruling: a clockless map never ends on its
/// own), so a post-fire world resumes as ENDED, never re-armed.
pub const MAP_CLOCK_FIRED: u64 = u64::MAX;

/// Inputs applied at the start of a tick. Everything entering the world goes
/// through here — never by mutating state directly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TickInputs {
    pub joins: Vec<JoinRequest>,
    /// Characters arriving from ANOTHER world (zone transfers). The host
    /// ferries departures from one world into arrivals of the next —
    /// cross-world traffic is plain I/O, like joins always were.
    #[serde(default)]
    pub arrivals: Vec<CharacterBundle>,
    /// KILL SWITCH (#148 A6): character names to remove this tick — the
    /// entity despawns, its bot stops, nothing transfers. The operator's
    /// answer to a runaway deployed brain.
    #[serde(default)]
    pub removals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinRequest {
    pub name: String,
    /// Assembled, versioned VM bytecode (a template for chat players).
    pub program: Vec<u8>,
}

/// Everything a character IS, portable across worlds: progression and
/// possessions, plus the bot — its program and its persist block (the
/// VM's working memory resets on transfer, exactly like a redeploy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterBundle {
    pub character: crate::entity::CharacterState,
    pub program: Vec<u8>,
    pub persist: Vec<u8>,
    pub params: Vec<u8>,
    pub bot_version: u32,
    /// Maps (#136 T4): set when this departure was an OpenMap — the host
    /// creates a fresh map instance from it instead of routing to a booted
    /// world. Consumed by the ferry; never survives into the next departure.
    #[serde(default)]
    pub map: Option<MapTicket>,
}

/// A consumed map, as instance parameters (#136 T4): the tier drives the
/// instance's area level; the juice bps (from the map's rolled affixes)
/// drive spawn rarity and drop quantity inside. Deterministic: rolled once
/// on the item, carried whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MapTicket {
    pub tier: u32,
    /// The instance's rarity juice (B4): folded into every pack's
    /// spawn-rarity ROLL at read time (magic += juice, rare += juice/3).
    /// Pack defs are never mutated.
    pub rarity_bp: i64,
    /// Folded into every kill's drop quantity in the instance.
    pub quantity_bp: i64,
    /// RULE (#148 A4): basis points of extra monster damage in the map.
    #[serde(default)]
    pub fury_bp: i64,
    /// RULE: the map's clock in ticks (0 = none) — expiry ferries
    /// everyone home; what you carried out, you keep.
    #[serde(default)]
    pub clock: i64,
    /// RULE: the far end holds a TIER BOSS (the Unwritten).
    #[serde(default)]
    pub boss: bool,
}

/// Things that happened during a tick that the outside world may care about
/// (replication, the auto-director, chat announcements, persistence).
#[derive(Debug, Clone, Serialize)]
pub enum SimEvent {
    CharacterJoined {
        id: u32,
        name: String,
    },
    /// A join was refused (e.g. outdated bytecode format). The server should
    /// surface the reason to the player.
    JoinRejected {
        name: String,
        reason: String,
    },
    /// KILL SWITCH (#148 A6): a deployed brain was recalled by the operator.
    CharacterRemoved {
        net_id: u32,
        name: String,
    },
    CharacterDied {
        id: u32,
        name: String,
        killer: String,
    },
    CharacterRespawned {
        id: u32,
    },
    /// A tutorial gate opened or shut (zone brain's set_gate). Cell rect.
    GateChanged {
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
        open: bool,
    },
    /// An exit opened or closed (zone brain's set_exit). Raw Q16.16 coords.
    ExitChanged {
        x: i32,
        y: i32,
        open: bool,
    },
    /// A character completed an ACT (#136): they killed its act boss. The
    /// broadcast's biggest story beat.
    ActCompleted {
        id: u32,
        name: String,
        act: u32,
    },
    LevelUp {
        id: u32,
        name: String,
        level: u32,
    },
    MonsterKilled {
        killer_id: u32,
        killer: String,
        monster: String,
        /// The victim's rank (#148 A7): the director cuts to boss kills;
        /// same live-rarity source the entity record uses (the A2.5 lesson:
        /// loot-state rarity is 0 for everything alive).
        rarity: Rarity,
        /// Index into ContentDb::monsters. The zone brain does NOT see this
        /// directly — `run_zone_brain` translates it to the monster's stable
        /// tagged num (#54) before the kill event reaches the script.
        def_idx: u32,
        level: u32,
    },
    LootDropped {
        owner_id: u32,
        owner: String,
        rarity: Rarity,
        item: String,
    },
    ItemPickedUp {
        owner_id: u32,
        owner: String,
        rarity: Rarity,
        item: String,
    },
    ItemEquipped {
        id: u32,
        owner: String,
        rarity: Rarity,
        item: String,
    },
    PassiveAllocated {
        id: u32,
        owner: String,
        node: String,
    },
    BuildDeclared {
        id: u32,
        owner: String,
        nodes: u32,
    },
    BuildRejected {
        id: u32,
        owner: String,
        reason: String,
    },
    /// A respec went through (allocated nodes re-walked the new plan;
    /// one Regret Obol consumed).
    TreeRespecced {
        id: u32,
        owner: String,
    },
    /// Equipped gear stopped meeting its requirements and was shed to
    /// the bag (or the ground).
    GearShed {
        id: u32,
        owner: String,
        item: String,
    },
    GemSocketed {
        id: u32,
        owner: String,
        gem: String,
    },
    /// A support gem refused a skill at socket time (tag mismatch).
    GemRejected {
        id: u32,
        owner: String,
        gem: String,
        skill: String,
    },
    GemLevelUp {
        id: u32,
        owner: String,
        gem: String,
        level: u32,
    },
    /// An obol spent on a bag item (the item name is post-craft).
    CurrencyUsed {
        id: u32,
        owner: String,
        currency: String,
        item: String,
    },
    Hit {
        attacker: u32,
        target: u32,
        amount: i64,
        /// Dominant damage component: 0 phys, 1 fire, 2 cold, 3 lightning,
        /// 4 chaos.
        dmg_type: u8,
        /// The hit staggered its victim (windup interrupted, briefly
        /// locked); a stunning cold hit reads as FROZEN instead.
        stun: bool,
        freeze: bool,
        crit: bool,
        /// True for damage-over-time burns (steady, once per second).
        dot: bool,
        projectile: bool,
        killed: bool,
    },
    /// A projectile took flight; the client animates it (hits arrive as
    /// authoritative Hit events when the sim resolves them).
    ProjectileSpawned {
        /// Caster, so the client can play the launch animation.
        attacker: u32,
        spell: bool,
        /// Q16.16 raw launch position and per-tick velocity.
        x: i32,
        y: i32,
        vx: i32,
        vy: i32,
        /// Q16.16 raw travel budget.
        range: i32,
        dmg_type: u8,
    },
    /// A non-projectile skill went off: the client plays the cast/swing
    /// animation and draws the shape (ring, cone, line) where it happened.
    /// A use BEGAN: the windup the client animates. The strike itself
    /// resolves `contact_ticks` later (HitFx/SkillFx land there).
    UseStarted {
        id: u32,
        spell: bool,
        /// Aim point, raw Q16.16 (facing).
        x: i32,
        y: i32,
        use_ticks: u32,
        contact_ticks: u32,
    },
    SkillFx {
        attacker: u32,
        spell: bool,
        /// 0 strike, 1 nova, 2 cone, 3 line, 4 point-AoE.
        shape: u8,
        /// Q16.16 raw: the shape's anchor (the caster, except point-AoE
        /// which anchors at the blast point) and aim direction (normalized).
        x: i32,
        y: i32,
        dx: i32,
        dy: i32,
        /// Q16.16 raw: shape footprint (radius for rings, reach for sweeps).
        radius: i32,
        range: i32,
        dmg_type: u8,
    },
    BotDebug {
        id: u32,
        values: Vec<i32>,
    },
    /// Authored zone narration (target 0 = everyone).
    Narration {
        target: u32,
        text: String,
    },
    /// An entity speaks (speech bubble). Text comes from content tables
    /// only — bots pick by index, never inject strings.
    Speech {
        id: u32,
        text: String,
    },
    /// A character left this world for another zone (the host ferries the
    /// bundle; see World::take_departures).
    CharacterDeparted {
        id: u32,
        name: String,
        dest: String,
    },
    /// The map scoreboard (#148 A7): what a runner did in a map
    /// instance, tallied at departure (either exit: walked out or the
    /// clock rang). The broadcast cuts to it; the UI cards it.
    MapTally {
        id: u32,
        name: String,
        kills: u64,
        deaths: u64,
        items: u64,
        ticks: u64,
    },
}

/// Flat renderable view of an entity, exported to the server each tick.
#[derive(Debug, Clone)]
pub struct EntityView {
    pub id: u32,
    /// 1 = character, 2 = monster, 3 = loot.
    pub kind: u8,
    /// Faction hostility (broadcast readability): the client embers
    /// HOSTILE monsters only — a villager NPC must not glow.
    pub hostile: bool,
    pub x_raw: i32,
    pub y_raw: i32,
    pub life_pct: u8,
    /// Energy-shield fill for the overhead bar: -1 = no ES, else 0..=100.
    pub es_pct: i32,
    pub level: u32,
    pub name: String,
    /// Client-side visual key (monster archetype model; characters: "idler").
    pub model: String,
    /// Equipped weapon visual key (characters; "" when unarmed).
    pub weapon: String,
    /// Weapon rarity (0 normal..3 unique) for the worn-tier glow.
    pub weapon_rarity: u8,
    /// Visual part keys from equipped armor (characters), gear-slot order.
    pub gear: Vec<String>,
    /// Rarity per gear entry (aligned with `gear`).
    pub gear_rarity: Vec<u8>,
    pub rarity: u8,
    pub dead: bool,
    pub kills: u64,
    pub items: u64,
    /// Active-ailment bitmask for the overhead nameplate (#88): bit0 Ignite,
    /// bit1 Shock, bit2 Chill.
    pub ailments: u8,
}

#[derive(Serialize, Deserialize)]
pub struct World {
    seed: u64,
    tick: u64,
    content_hash: u64,
    #[serde(skip)]
    content: ContentDb,
    pub(crate) zone: Zone,
    /// Index of this zone in ContentDb::zones (sorted ids — the same
    /// stable indices bot programs hardcode). Bots read it via SelfStatus.
    pub(crate) zone_idx: u32,
    /// AREA LEVEL (ZoneDef.level): normal mobs spawn at
    /// max(def level, area level); magic +1, rare +2; uniques authored.
    #[serde(default = "default_zone_level")]
    pub(crate) zone_level: u32,
    /// Map juice (#136 T4): extra drop quantity in this world (bp; 0 =
    /// none). Set at map-instance creation; folded into every kill's
    /// drop roll. Serialized + hashed — it steers future loot.
    #[serde(default)]
    pub(crate) loot_quantity_bp: i64,
    /// MAP RULE (#148 A4; B4 rework): the instance's rolled rarity juice,
    /// folded into pack-rarity rolls at spawn time. An instance property —
    /// pack defs are never mutated.
    #[serde(default)]
    pub(crate) spawn_rarity_bp: i64,
    /// The Map Device's cell, from the ZoneDef (#136 T4). None = no device.
    #[serde(default)]
    pub(crate) map_device: Option<(i32, i32)>,
    /// The town's vendor + stash cells (#148 A5), from the ZoneDef.
    #[serde(default)]
    pub(crate) vendor: Option<(i32, i32)>,
    #[serde(default)]
    pub(crate) stash_cell: Option<(i32, i32)>,
    /// True in a map instance (#136 T4): maps keep dropping here (the
    /// loop sustains itself), and the host retires the world when it empties.
    #[serde(default)]
    pub(crate) is_map_instance: bool,
    /// MAP RULE (#148 A4): extra monster damage in this map (bp).
    /// Hashed + serialized — it steers every fight here.
    #[serde(default)]
    pub(crate) monster_fury_bp: i64,
    /// MAP RULE: the tick this map ends (0 = no clock). At expiry the
    /// current ferries every character home to Lanternfall.
    #[serde(default)]
    pub(crate) map_ends_at: u64,
    /// Map tallies (#148 A7): per-runner (kills, deaths, items, tick)
    /// marks at ARRIVAL into a map instance; the departure delta is the
    /// scoreboard. BTreeMap for hash order; empty outside map worlds.
    #[serde(default)]
    pub(crate) map_marks: std::collections::BTreeMap<u32, (u64, u64, u64, u64)>,
    pub(crate) bots: BotArena,
    next_net_id: u32,
    rng_ai: Pcg32,
    rng_combat: Pcg32,
    rng_loot: Pcg32,
    rng_craft: Pcg32,
    /// The zone's scripting brain (the dungeon master is a bot too).
    zone_brain: Option<crate::bots::Bot>,
    /// Authored narration lines the brain fires by index.
    zone_lines: Vec<String>,
    /// This tick's event records staged for the brain (transient).
    #[serde(skip)]
    zone_brain_inbox: Vec<[i32; 4]>,
    /// Characters whose bundles detached this tick (UseExit), awaiting the
    /// host's ferry (drained right after tick; transient).
    #[serde(skip)]
    pending_departures: Vec<(CharacterBundle, String)>,
    /// UseExit calls staged during bot execution; detached in slot-call
    /// order after bots finish (an entity can't vanish mid-arena-walk).
    #[serde(skip)]
    pub(crate) pending_exits: Vec<(u32, String, Option<MapTicket>)>,
    /// Committed uses winding up toward their contact tick.
    #[serde(default)]
    pub(crate) pending_uses: Vec<crate::world::combat::PendingUse>,
}

// ---- universal (classless) character bases ----

/// The movement-trace target (#185 diagnostics): IDLIN_TRACE_MOVE=<name>.
/// Debug builds only, env read ONCE — the pure-sim boundary keeps host
/// environment reads and stderr out of release cores entirely.
#[cfg(debug_assertions)]
fn trace_move_wanted() -> Option<&'static String> {
    use std::sync::OnceLock;
    static WANT: OnceLock<Option<String>> = OnceLock::new();
    WANT.get_or_init(|| std::env::var("IDLIN_TRACE_MOVE").ok())
        .as_ref()
}

fn default_zone_level() -> u32 {
    1
}

fn base_life(level: u32) -> i64 {
    100 + 14 * (level as i64 - 1)
}

fn base_unarmed_damage(level: u32) -> i64 {
    6 + level as i64 / 3
}

fn base_accuracy(level: u32) -> i64 {
    90 + 12 * (level as i64 - 1)
}

fn base_evasion(level: u32) -> i64 {
    20 + 6 * (level as i64 - 1)
}

const BASE_SPEED_CPS: i32 = 330;
const BASE_RADIUS_CU: i32 = 45;
const UNARMED_RANGE_CU: i32 = 160;
const UNARMED_USE_TICKS: u32 = 8;

/// Base mana at level 1; +4 per level (compact numbers).
fn base_mana(level: u32) -> i64 {
    35 + 4 * (level as i64 - 1)
}

/// Unarmed, ungeared stats at a given level — what everyone spawns with.
/// A monster's stats straight from its def — the base that spawning uses
/// and that debuff re-derivation rebuilds from.
pub(crate) fn monster_base_stats(def: &idlin_content::MonsterDef) -> CombatStats {
    let accuracy = if def.accuracy > 0 {
        def.accuracy
    } else {
        60 + 15 * def.level as i64
    };
    CombatStats {
        life: def.life,
        life_max: def.life,
        mana: def.mana,
        mana_max: def.mana,
        es: 0,
        grace_until: 0,
        es_max: 0,
        es_recharge_at: 0,
        life_regen: 0,
        mana_regen: 0,
        leech_life: 0,
        leech_mana: 0,
        block: 0,
        crit_inc: 10000,
        crit_multi: 15000,
        cast_speed: 10000,
        spell_damage_bp: 10000,
        damage: [
            def.damage,
            def.damage_fire,
            def.damage_cold,
            def.damage_lightning,
            def.damage_chaos,
        ],
        accuracy,
        evasion: def.evasion,
        armour: def.armour,
        resists: [
            def.resist_fire,
            def.resist_cold,
            def.resist_lightning,
            def.resist_chaos,
        ],
        range: fx_from_cu(def.range_cu),
        stagger: 0,
        poise: 0,
        knockback_cu: 0,
        // Ailment levers (#88): no per-element chance by default; default
        // Shock/Chill caps (40% / 30%) — characters re-derive these in refresh.
        ignite_chance: 0,
        shock_chance: 0,
        chill_chance: 0,
        crits_no_ailment: false,
        shock_max: 4000,
        chill_max: 3000,
        ailment_duration: 0,
        use_ticks: def.use_ticks,
        busy_until: 0,
        speed_per_tick: speed_from_cps(def.speed_cps),
        radius: fx_from_cu(def.radius_cu),
        projectile: def.projectile,
        item_rarity: 10000,
        item_quantity: 10000,
        last_combat_tick: 0,
        last_kill_tick: 0,
        has_strike_conditions: false,
        target_grants: Vec::new(),
    }
}

/// Resolve a monster def's gem kit into the socketed structure characters
/// use (names → indices; unknowns are impossible — content validates).
pub(crate) fn resolve_monster_skills(
    content: &idlin_content::ContentDb,
    def: &idlin_content::MonsterDef,
) -> Vec<crate::entity::SocketedGem> {
    let gem_idx = |id: &str| content.gems.iter().position(|g| g.id == id).unwrap() as u32;
    def.skills
        .iter()
        .map(|ms| crate::entity::SocketedGem {
            gem: crate::entity::GemInstance {
                gem_idx: gem_idx(&ms.gem),
                level: ms.level,
                xp: 0,
            },
            cooldown_left: 0,
            supports: ms
                .supports
                .iter()
                .map(|s| crate::entity::GemInstance {
                    gem_idx: gem_idx(&s.gem),
                    level: s.level,
                    xp: 0,
                })
                .collect(),
        })
        .collect()
}

pub fn universal_stats(level: u32) -> CombatStats {
    CombatStats {
        life: base_life(level),
        life_max: base_life(level),
        mana: base_mana(level),
        mana_max: base_mana(level),
        es: 0,
        grace_until: 0,
        es_max: 0,
        es_recharge_at: 0,
        life_regen: 0,
        mana_regen: 0,
        leech_life: 0,
        leech_mana: 0,
        block: 0,
        crit_inc: 10000,
        crit_multi: 15000,
        cast_speed: 10000,
        spell_damage_bp: 10000,
        damage: [base_unarmed_damage(level), 0, 0, 0, 0],
        accuracy: base_accuracy(level),
        evasion: base_evasion(level),
        armour: 0,
        resists: [0; crate::entity::RES_COUNT],
        range: fx_from_cu(UNARMED_RANGE_CU),
        stagger: 0,
        poise: 0,
        knockback_cu: 0,
        // Ailment levers (#88): no per-element chance by default; default
        // Shock/Chill caps (40% / 30%) — characters re-derive these in refresh.
        ignite_chance: 0,
        shock_chance: 0,
        chill_chance: 0,
        crits_no_ailment: false,
        shock_max: 4000,
        chill_max: 3000,
        ailment_duration: 0,
        use_ticks: UNARMED_USE_TICKS,
        busy_until: 0,
        speed_per_tick: speed_from_cps(BASE_SPEED_CPS),
        radius: fx_from_cu(BASE_RADIUS_CU),
        projectile: false,
        item_rarity: 10000,
        item_quantity: 10000,
        last_combat_tick: 0,
        last_kill_tick: 0,
        has_strike_conditions: false,
        target_grants: Vec::new(),
    }
}

pub(crate) fn fx_from_cu(cu: i32) -> Fx {
    Fx::from_raw(((cu as i64) * 65536 / 100) as i32)
}

fn speed_from_cps(cps: i32) -> Fx {
    // centi-units/sec → units/tick at TICK_HZ.
    Fx::from_raw(((cps as i64) * 65536 / 100 / TICK_HZ as i64) as i32)
}

/// Supercover walk a→b over sight-blocking cells: integer-only
/// Amanatides–Woo with cross-multiplied boundary comparisons (raw coords
/// < 2^23, distances < 2^17 raw per axis step — every product fits i64).
/// Exact corner crossings check both side cells, so a diagonal wall seam
/// never leaks sight. SHUT GATES block sight too: the barrier is a wall
/// while it stands, so bots (and monsters) don't strain at — or shoot
/// through — a lesson they haven't earned.
fn grid_sight_blocked(
    grid: &crate::zone::SimGrid,
    gates: &[crate::zone::GateState],
    a: FxV2,
    b: FxV2,
) -> bool {
    let sight = |cx: i64, cy: i64| {
        grid.sight_cell(cx, cy) || gates.iter().any(|g| !g.open && g.covers(cx, cy))
    };
    grid_ray_blocked(grid, a, b, sight)
}

/// The WALK-line twin (#185 stall fix): can a straight walk traverse every
/// cell from `a` to `b`? Water/chasms block FEET but not SIGHT — using the
/// sight test for movement walked characters into unwalkable pockets and
/// froze them (the slide gets zero progress and the "clear" line never
/// re-plans).
fn grid_walk_blocked(
    grid: &crate::zone::SimGrid,
    gates: &[crate::zone::GateState],
    a: FxV2,
    b: FxV2,
) -> bool {
    let solid = |cx: i64, cy: i64| {
        grid.walk_blocked_cell(cx, cy) || gates.iter().any(|g| !g.open && g.covers(cx, cy))
    };
    grid_ray_blocked(grid, a, b, solid)
}

fn grid_ray_blocked(
    grid: &crate::zone::SimGrid,
    a: FxV2,
    b: FxV2,
    sight: impl Fn(i64, i64) -> bool,
) -> bool {
    const CELL: i64 = 65536;
    let (ax, ay) = (a.x.raw() as i64, a.y.raw() as i64);
    let (bx, by) = (b.x.raw() as i64, b.y.raw() as i64);
    let (mut cx, mut cy) = (ax.div_euclid(CELL), ay.div_euclid(CELL));
    let (ex, ey) = (bx.div_euclid(CELL), by.div_euclid(CELL));
    if sight(cx, cy) {
        return true;
    }
    let (dx, dy) = (bx - ax, by - ay);
    let (sx, sy): (i64, i64) = (if dx >= 0 { 1 } else { -1 }, if dy >= 0 { 1 } else { -1 });
    // Raw distance from `a` to the next x/y cell boundary along the ray.
    let mut to_bx = if dx >= 0 {
        (cx + 1) * CELL - ax
    } else {
        ax - cx * CELL
    };
    let mut to_by = if dy >= 0 {
        (cy + 1) * CELL - ay
    } else {
        ay - cy * CELL
    };
    let (adx, ady) = (dx.abs(), dy.abs());
    let mut steps = (grid.width + grid.height) as i64 + 4;
    while (cx, cy) != (ex, ey) && steps > 0 {
        steps -= 1;
        let tx = to_bx * ady; // time-to-boundary, cross-multiplied
        let ty = to_by * adx;
        if adx != 0 && (ady == 0 || tx < ty) {
            cx += sx;
            to_bx += CELL;
        } else if ady != 0 && (adx == 0 || ty < tx) {
            cy += sy;
            to_by += CELL;
        } else {
            // The ray passes exactly through a cell corner: a wall on
            // either side of the diagonal seals it.
            if sight(cx + sx, cy) || sight(cx, cy + sy) {
                return true;
            }
            cx += sx;
            cy += sy;
            to_bx += CELL;
            to_by += CELL;
        }
        if sight(cx, cy) {
            return true;
        }
    }
    false
}

impl World {
    pub fn new(seed: u64, content: &ContentDb) -> World {
        World::new_for_zone(seed, content, "withered_shore")
    }

    /// A world simulating one specific zone — the multi-world server runs
    /// the shared town and per-idler instances as separate Worlds.
    pub fn new_for_zone(seed: u64, content: &ContentDb, zone_id: &str) -> World {
        let mut zone_brain: Option<crate::bots::Bot> = None;
        let mut zone_lines: Vec<String> = Vec::new();
        let zone_idx = content
            .zones
            .binary_search_by(|z| z.id.as_str().cmp(zone_id))
            .unwrap_or(0) as u32;
        let zone = match content.zone(zone_id).or_else(|| content.zones.first()) {
            Some(def) => {
                // The zone's scripting brain, if the def names one.
                zone_lines = def.lines.iter().map(|l| l.text.clone()).collect();
                let camp = Fx::from_int(def.camp_radius_u as i16);
                if let Some(brain) = &def.brain
                    && let Some(i) = content.brain_idx(brain)
                {
                    let program = &content.brains[i].program;
                    zone_brain = Vm::new(program).ok().map(|vm| crate::bots::Bot {
                        vm,
                        rng: Pcg32::stream(seed, Domain::ZoneBrain, 0),
                        params: vec![0; idlin_vm::PARAM_BLOCK_LEN],
                        program: program.clone(),
                        program_hash: crate::bots::program_hash(program),
                        version: 1,
                    });
                }
                let mut zone = Zone::new(
                    def.name.clone(),
                    Fx::from_int(def.width_u as i16),
                    Fx::from_int(def.height_u as i16),
                    FxV2::new(
                        Fx::from_int(def.spawn_x_u as i16),
                        Fx::from_int(def.spawn_y_u as i16),
                    ),
                    Fx::from_int(def.spawn_radius_u as i16),
                );
                zone.camp_radius = camp;
                for pack in &def.packs {
                    let monster_idx = content
                        .monster_idx(&pack.monster)
                        .expect("content validated at load")
                        as u32;
                    zone.packs.push(PackState {
                        def: pack.clone(),
                        monster_idx,
                        alive: 0,
                        risen: false,
                    });
                }
                for gate in &def.gates {
                    zone.gates.push(crate::zone::GateState {
                        x0: gate.x0,
                        y0: gate.y0,
                        x1: gate.x1,
                        y1: gate.y1,
                        open: gate.open,
                    });
                }
                for exit in &def.exits {
                    // Exit coords name a CELL; the portal stands at its
                    // center (corner placement put the ring inside the
                    // neighboring wall).
                    const HALF: Fx = Fx::from_raw(0x8000);
                    zone.exits.push(crate::zone::ExitState {
                        pos: FxV2::new(
                            Fx::from_int(exit.x_u as i16) + HALF,
                            Fx::from_int(exit.y_u as i16) + HALF,
                        ),
                        dest: exit.dest.clone(),
                        open: exit.open,
                        requires_act: exit.requires_act,
                    });
                }
                // Authored zones: collision IS the map. Tileset presence
                // was validated at load. Zones without a tile map (test/
                // placeholder) simply have no grid and no collision.
                if let (Some(tiles), Some(ts_id)) = (&def.tiles, &def.tileset) {
                    let ts = content.tileset(ts_id).expect("content validated at load");
                    let mut walk = Vec::with_capacity(tiles.cells.len());
                    let mut los = Vec::with_capacity(tiles.cells.len());
                    for &c in &tiles.cells {
                        walk.push(ts.tiles[c as usize].walkable);
                        los.push(ts.tiles[c as usize].blocks_los);
                    }
                    zone.grid = Some(crate::zone::SimGrid {
                        width: tiles.width,
                        height: tiles.height,
                        walk,
                        los,
                    });
                }
                zone
            }
            None => Zone::new(
                "The Void".into(),
                Fx::from_int(60),
                Fx::from_int(60),
                FxV2::new(Fx::from_int(30), Fx::from_int(30)),
                Fx::ZERO,
            ),
        };
        World {
            seed,
            tick: 0,
            content_hash: content.content_hash,
            content: content.clone(),
            zone,
            zone_idx,
            bots: BotArena::default(),
            next_net_id: 1,
            rng_ai: Pcg32::stream(seed, Domain::ZoneAi, 0),
            rng_combat: Pcg32::stream(seed, Domain::Combat, 0),
            rng_loot: Pcg32::stream(seed, Domain::Loot, 0),
            rng_craft: Pcg32::stream(seed, Domain::Craft, 0),
            zone_brain,
            zone_lines,
            zone_brain_inbox: Vec::new(),
            pending_departures: Vec::new(),
            pending_exits: Vec::new(),
            pending_uses: Vec::new(),
            zone_level: content.zone(zone_id).map_or(1, |z| z.level),
            loot_quantity_bp: 0,
            spawn_rarity_bp: 0,
            map_device: content.zone(zone_id).and_then(|z| z.map_device),
            vendor: content.zone(zone_id).and_then(|z| z.vendor),
            stash_cell: content.zone(zone_id).and_then(|z| z.stash),
            is_map_instance: false,
            monster_fury_bp: 0,
            map_ends_at: 0,
            map_marks: std::collections::BTreeMap::new(),
        }
    }

    /// Re-attach content after deserializing a snapshot. Fails (with a human
    /// reason) on a content-hash mismatch — a snapshot is only meaningful against
    /// its exact content — OR on a malformed rolled affix. The hash gate already
    /// guarantees affix shapes match for an honestly-rolled snapshot; the affix
    /// check is the fail-closed backstop against a corrupt/foreign one, so
    /// `AffixDef::grants` can never silently drop a hybrid's effect (#86).
    pub fn attach_content(&mut self, content: &ContentDb) -> Result<(), String> {
        if content.content_hash != self.content_hash {
            return Err(format!(
                "content hash {:016x} != loaded content {:016x}",
                self.content_hash, content.content_hash
            ));
        }
        self.content = content.clone();
        // `Zone::by_net` is `#[serde(skip)]`, so a freshly deserialized world has
        // an empty lookup index — rebuild it from the restored slots before any
        // get_net/slot_of (inspect, syscalls) runs against this world.
        self.zone.rebuild_net_index();
        if let Some(why) = self.first_malformed_affix() {
            return Err(format!("malformed snapshot: {why}"));
        }
        Ok(())
    }

    /// First malformed rolled affix on ONE item (bad index or values/effects
    /// count mismatch), as a human reason. The leaf shared by every walk below.
    fn first_malformed_item_affix(
        content: &ContentDb,
        item: &crate::entity::Item,
    ) -> Option<String> {
        // A unique_idx must index content.uniques (#136 T5) — the same
        // fail-closed defense rolled affixes get. content_hash gating makes
        // an out-of-range index near-impossible (any content change refuses
        // the snapshot), but a fold panic is not an acceptable failure mode.
        if let Some(u) = item.unique_idx
            && u as usize >= content.uniques.len()
        {
            return Some(format!(
                "unique_idx {u} out of range ({} uniques)",
                content.uniques.len()
            ));
        }
        item.affixes.iter().find_map(|ra| {
            content
                .check_rolled_affix(ra.affix_idx, ra.values.len(), ra.tier)
                .err()
        })
    }

    /// First malformed rolled affix on a character's items (worn + bagged gear),
    /// as a human reason. Shared by live entities AND pending arrivals (the ferry
    /// payload), so a malformed snapshot character can never reach `grants`.
    pub fn first_malformed_character_affix(
        content: &ContentDb,
        ch: &crate::entity::CharacterState,
    ) -> Option<String> {
        for it in ch.equipment.iter().flatten() {
            if let Some(why) = Self::first_malformed_item_affix(content, it) {
                return Some(why);
            }
        }
        for pi in &ch.inventory {
            if let Some(it) = pi.item.as_gear()
                && let Some(why) = Self::first_malformed_item_affix(content, it)
            {
                return Some(why);
            }
        }
        None
    }

    /// First malformed rolled affix anywhere in this world (characters, monster
    /// rolls, gear loot), as a human reason. `None` when every item is well-formed.
    fn first_malformed_affix(&self) -> Option<String> {
        for (_, e) in self.zone.iter() {
            if let Some(ch) = &e.character
                && let Some(why) = Self::first_malformed_character_affix(&self.content, ch)
            {
                return Some(why);
            }
            if let Some(m) = &e.monster {
                for ra in &m.affixes {
                    if let Err(why) =
                        self.content
                            .check_rolled_affix(ra.affix_idx, ra.values.len(), ra.tier)
                    {
                        return Some(why);
                    }
                }
            }
            if let Some(l) = &e.loot
                && let crate::entity::LootPayload::Gear(it) = &l.payload
                && let Some(why) = Self::first_malformed_item_affix(&self.content, it)
            {
                return Some(why);
            }
        }
        None
    }

    pub(crate) fn content_monsters(&self) -> &[MonsterDef] {
        &self.content.monsters
    }

    pub(crate) fn content_items(&self) -> &[ItemDef] {
        &self.content.items
    }

    #[cfg(test)]
    pub(crate) fn content_monsters_id(&self, def_idx: u32) -> &str {
        &self.content.monsters[def_idx as usize].id
    }

    pub(crate) fn content_currency_len(&self) -> usize {
        self.content.currency.len()
    }

    pub(crate) fn content_gems(&self) -> &[idlin_content::GemDef] {
        &self.content.gems
    }

    /// The stable tagged num a read should emit for `cat`'s def at `idx`
    /// (the bot↔engine id, #54). -1 if unmapped — bots treat negative as unknown.
    /// A zone's stable tagged num by id, or -1 (#136 T6: ReadExits dest).
    pub(crate) fn zone_num_by_id(&self, id: &str) -> i32 {
        self.content
            .zones
            .binary_search_by(|z| z.id.as_str().cmp(id))
            .ok()
            .map_or(-1, |zi| {
                self.content_num(idlin_content::ids::Category::Zone, zi)
            })
    }

    pub(crate) fn content_num(&self, cat: idlin_content::ids::Category, idx: usize) -> i32 {
        self.content.content_num(cat, idx).unwrap_or(-1)
    }

    /// Translate a bot's tagged num back to its (category, array index).
    pub(crate) fn content_idx(&self, num: i32) -> Option<(idlin_content::ids::Category, u32)> {
        self.content.content_idx(num)
    }

    pub fn tick_count(&self) -> u64 {
        self.tick
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn content_hash(&self) -> u64 {
        self.content_hash
    }

    /// The AREA LEVEL (ZoneDef.level) — shown on the HUD plaque.
    pub fn zone_level(&self) -> u32 {
        self.zone_level
    }

    /// True for map instances (#136 T4) — the host retires these when empty.
    pub fn is_map_instance(&self) -> bool {
        self.is_map_instance
    }

    /// This world's zone, as an index into `ContentDb::zones` (#136 T4):
    /// lets the host recover a resumed map's zone id (its key file names
    /// the world; the zone comes from the state itself).
    pub fn zone_index(&self) -> u32 {
        self.zone_idx
    }

    /// A MAP INSTANCE of a map zone (#136 T4): the ticket's tier sets the
    /// area level (12 + tier — maps begin where Act 1 ends) and its juice
    /// boosts every pack's rarity rolls and the world's drop quantity. Must
    /// run before the first tick — packs spawn then, at the lifted level.
    pub fn new_map_instance(
        seed: u64,
        content: &ContentDb,
        zone_id: &str,
        ticket: MapTicket,
    ) -> World {
        let mut w = Self::new_for_zone(seed, content, zone_id);
        w.is_map_instance = true;
        w.zone_level = 12 + ticket.tier;
        w.loot_quantity_bp = ticket.quantity_bp.max(0);
        // Rarity juice is an INSTANCE PROPERTY read at spawn-roll time —
        // exactly like the quantity bonus (operator ruling on #185, B4).
        // The old code mutated pack.def.magic_bp/rare_bp per instance:
        // per-world vandalism of content definitions, which then needed
        // its own state-hash patch to stay sound.
        w.spawn_rarity_bp = ticket.rarity_bp.max(0);
        // THE RULES (#148 A4) — applied at the one instance chokepoint.
        w.monster_fury_bp = ticket.fury_bp.clamp(0, 10000);
        // The clock is OPT-IN (operator ruling, #185: "every map ends" is
        // nonsense while the idler is in there — with no respawns a map
        // ends by being CLEARED). Only a rolled Deluge clock arms one.
        if ticket.clock > 0 {
            w.map_ends_at = ticket.clock as u64; // relative to tick 0
        }
        if ticket.boss
            && let Some(bi) = w.content.monster_idx("the_unwritten")
        {
            // The far end, the strand's north. Uniques keep their AUTHORED
            // level (20) regardless of tier — the fury/juice dials carry
            // the tier's difficulty, not the boss's level.
            w.spawn_monster_rolled(
                bi as u32,
                0,
                FxV2::new(Fx::from_int(24), Fx::from_int(6)),
                Rarity::Unique,
                vec![],
                "The Unwritten".into(),
            );
        }
        w
    }

    pub fn zone_name(&self) -> &str {
        &self.zone.name
    }

    pub fn zone_size_raw(&self) -> (i32, i32) {
        (self.zone.width.raw(), self.zone.height.raw())
    }

    pub fn character_count(&self) -> usize {
        self.zone
            .iter()
            .filter(|(_, e)| e.character.is_some())
            .count()
    }

    /// Advance the world by exactly one tick.
    /// MAP RULE (#148 A4): when the map clock expires, the current
    /// takes the strand back — every character is staged home to
    /// Lanternfall as an ordinary departure (loot in the bag comes along;
    /// the ferry lands them; the empty map retires).
    /// KILL SWITCH (#148 A6): remove named characters — despawn the
    /// entity, drop its bot, narrate the removal. Idempotent on unknown
    /// names (the host may race a transfer; the miss is harmless).
    fn process_removals(&mut self, removals: &[String], events: &mut Vec<SimEvent>) {
        for name in removals {
            let Some((slot, net, bot_idx)) = self
                .zone
                .iter()
                .find(|(_, e)| e.character.as_ref().is_some_and(|c| &c.name == name))
                .map(|(s, e)| (s, e.net_id, e.bot))
            else {
                continue;
            };
            if let Some(bi) = bot_idx {
                self.bots.remove(bi);
            }
            self.zone.remove(slot);
            self.map_marks.remove(&net);
            events.push(SimEvent::Narration {
                target: 0,
                text: format!("{name} is recalled — the brain is switched off."),
            });
            events.push(SimEvent::CharacterRemoved {
                net_id: net,
                name: name.clone(),
            });
        }
    }

    fn map_clock(&mut self, events: &mut Vec<SimEvent>) {
        if self.map_ends_at == 0
            || self.map_ends_at == MAP_CLOCK_FIRED
            || self.tick < self.map_ends_at
        {
            return;
        }
        // Fire once. The sentinel (not 0) keeps "already rang" distinct
        // from "never armed" (clockless maps never end on their own) — a
        // post-fire world must resume bit-identical, not with a new clock.
        self.map_ends_at = MAP_CLOCK_FIRED;
        let nets: Vec<u32> = self
            .zone
            .iter()
            .filter(|(_, e)| e.character.is_some())
            .map(|(_, e)| e.net_id)
            .collect();
        for net in nets {
            if !self.pending_exits.iter().any(|(n, ..)| *n == net) {
                self.pending_exits.push((net, "lanternfall".into(), None));
            }
            events.push(SimEvent::Narration {
                target: net,
                text: "The map unravels. The portal takes you home.".into(),
            });
        }
    }

    pub fn tick(&mut self, inputs: &TickInputs) -> Vec<SimEvent> {
        self.tick += 1;
        let mut events = Vec::new();
        self.clear_transient_intents();
        self.apply_joins(inputs, &mut events);
        self.run_bots(&mut events);
        self.process_removals(&inputs.removals, &mut events);
        self.map_clock(&mut events);
        self.process_exits(&mut events);
        self.movement();
        self.separation();
        self.obstacle_pushout();
        self.step_projectiles(&mut events);
        self.attacks(&mut events);
        self.effects_tick(&mut events);
        self.pickups(&mut events);
        self.explore();
        self.regen();
        self.respawns(&mut events);
        self.run_zone_brain(&mut events);
        events
    }

    /// Fog of war (#129): stamp every LIVING character's sight disc into its
    /// `explored` bitset — the deterministic record of what it has discovered
    /// in this zone. ONE pass, after every position mutation of the tick
    /// (movement, separation, knockback, obstacle pushout), so no mutation
    /// site can be missed; runs unconditionally (~2.5k bit-ORs per character
    /// per tick — cheaper than tracking a last-stamped cell, and joins and
    /// arrivals get their first disc the same tick they land). Self-healing
    /// sizing: a bitset whose length doesn't match this zone (a fresh join,
    /// or a stale bundle that slipped past the arrival reset) is re-allocated
    /// here, so the chokepoint also enforces the reset-on-zone-entry rule.
    fn explore(&mut self) {
        let w = self.zone.width.floor().max(0) as i64;
        let h = self.zone.height.floor().max(0) as i64;
        let words = ((w * h + 63) / 64) as usize;
        if words == 0 {
            return;
        }
        const R: i64 = FOG_SIGHT_CELLS as i64;
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if e.character.is_none() || !e.alive() {
                continue;
            }
            let (cx, cy) = (e.pos.x.floor() as i64, e.pos.y.floor() as i64);
            let Some(ch) = self.zone.get_mut(slot).and_then(|e| e.character.as_mut()) else {
                continue;
            };
            if ch.explored.len() != words {
                ch.explored = vec![0; words];
            }
            // OR-in the disc, clipped to the zone (integer distance check —
            // deterministic, no floats).
            let (y0, y1) = ((cy - R).max(0), (cy + R).min(h - 1));
            let (x0, x1) = ((cx - R).max(0), (cx + R).min(w - 1));
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let (dx, dy) = (x - cx, y - cy);
                    if dx * dx + dy * dy <= R * R {
                        let bit = (y * w + x) as usize;
                        ch.explored[bit / 64] |= 1 << (bit % 64);
                    }
                }
            }
        }
    }

    /// Fog of war (#129): the union of every resident character's explored
    /// bitset — what this world's residents collectively know. Replication
    /// masks tiles/props/exits/gates against this per tick (a per-idler grind
    /// instance has one resident, so union ≡ that idler's own knowledge).
    pub fn union_explored(&self) -> Vec<u64> {
        let zw = self.zone.width.floor().max(0) as i64;
        let zh = self.zone.height.floor().max(0) as i64;
        let words = ((zw * zh + 63) / 64) as usize;
        let mut out = vec![0u64; words];
        for (_, e) in self.zone.iter() {
            if let Some(ch) = &e.character {
                for (o, word) in out.iter_mut().zip(ch.explored.iter()) {
                    *o |= *word;
                }
            }
        }
        out
    }

    fn alloc_net(&mut self) -> u32 {
        let id = self.next_net_id;
        self.next_net_id += 1;
        id
    }

    /// Detach the characters who took an exit this tick: entity + bot
    /// become a portable bundle for the host to ferry — the sim owns
    /// exactly one zone. The persist block travels; working VM memory
    /// resets, like a redeploy.
    fn process_exits(&mut self, events: &mut Vec<SimEvent>) {
        for (net, dest, map) in std::mem::take(&mut self.pending_exits) {
            let Some(slot) = self.zone.slot_of(net) else {
                continue; // died and was removed in the same tick
            };
            if self.zone.get(slot).is_none_or(|e| e.character.is_none()) {
                continue;
            }
            let Some(mut entity) = self.zone.remove(slot) else {
                continue;
            };
            let character = entity.character.take().unwrap();
            let name = character.name.clone();
            let Some(b) = entity.bot.and_then(|idx| self.bots.remove(idx)) else {
                continue; // a characterless husk would be a bug
            };
            self.pending_departures.push((
                CharacterBundle {
                    character,
                    persist: b.vm.read_persist_block(),
                    program: b.program,
                    params: b.params,
                    bot_version: b.version,
                    map,
                },
                dest.clone(),
            ));
            // The map scoreboard (#148 A7): departing a map instance
            // settles the tally against the arrival marks — either exit
            // path (walked out, or the clock staged the same departure).
            if self.is_map_instance
                && let Some((k0, d0, i0, t0)) = self.map_marks.remove(&net)
            {
                let ch = &self.pending_departures.last().unwrap().0.character;
                events.push(SimEvent::MapTally {
                    id: net,
                    name: name.clone(),
                    kills: ch.kills.saturating_sub(k0),
                    deaths: ch.deaths.saturating_sub(d0),
                    items: ch.items.saturating_sub(i0),
                    ticks: self.tick.saturating_sub(t0),
                });
            }
            events.push(SimEvent::CharacterDeparted {
                id: net,
                name,
                dest,
            });
        }
    }

    /// A spawn position scattered inside the zone's spawn area, so idlers
    /// don't stack on one point at joins and respawns.
    fn spawn_pos(&mut self) -> FxV2 {
        let r = self.zone.spawn_radius.raw();
        if r <= 0 {
            return self.zone.spawn;
        }
        let r = r as u32;
        // Authored zones reject draws that land in walls/water (a handful
        // of retries, then the exact spawn point — which load validation
        // guarantees walkable). Generated zones keep their single draw.
        let attempts = if self.zone.grid.is_some() { 8 } else { 1 };
        for _ in 0..attempts {
            let dx = Fx::from_raw(self.rng_ai.next_range(r * 2) as i32 - r as i32);
            let dy = Fx::from_raw(self.rng_ai.next_range(r * 2) as i32 - r as i32);
            let spawn = self.zone.spawn;
            let pos = self.zone.clamp_pos(FxV2::new(spawn.x + dx, spawn.y + dy));
            match &self.zone.grid {
                Some(grid) if !grid.walkable_pos(pos) => continue,
                _ => return pos,
            }
        }
        self.zone.spawn
    }

    /// Speech bubbles from content tables only (monsters: their def's
    /// lines; characters: the global speech set), index wrapped,
    /// rate-limited per entity. 0 ok, −1 no lines/voice, −2 cooldown.
    pub(crate) fn try_say(&mut self, slot: usize, line: i32, events: &mut Vec<SimEvent>) -> i32 {
        let line = line.max(0) as usize;
        let now = self.tick;
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let (cooldown, lines): (u64, &[String]) = if let Some(m) = &e.monster {
            (
                crate::entity::SAY_COOLDOWN_MONSTER,
                &self.content.monsters[m.def_idx as usize].lines,
            )
        } else if e.character.is_some() {
            (crate::entity::SAY_COOLDOWN_CHAR, &self.content.speech.lines)
        } else {
            return -1;
        };
        if lines.is_empty() {
            return -1;
        }
        if e.last_say_tick != 0 && now < e.last_say_tick + cooldown {
            return -2; // still catching its breath
        }
        let id = e.net_id;
        let text = lines[line % lines.len()].clone();
        if let Some(e) = self.zone.get_mut(slot) {
            e.last_say_tick = now;
        }
        events.push(SimEvent::Speech { id, text });
        0
    }

    fn clear_transient_intents(&mut self) {
        for slot in 0..self.zone.slot_count() {
            if let Some(e) = self.zone.get_mut(slot) {
                e.intents.attack = None;
                e.intents.pickup = None;
            }
        }
    }

    fn apply_joins(&mut self, inputs: &TickInputs, events: &mut Vec<SimEvent>) {
        for join in &inputs.joins {
            // The versioned container is checked here: outdated bots are
            // rejected at the door, with the reason surfaced as an event.
            let vm = match Vm::new(&join.program) {
                Ok(vm) => vm,
                Err(e) => {
                    events.push(SimEvent::JoinRejected {
                        name: join.name.clone(),
                        reason: e.to_string(),
                    });
                    continue;
                }
            };
            let net_id = self.alloc_net();
            let bot_idx = self.bots.insert(Bot {
                vm,
                rng: Pcg32::stream(self.seed, Domain::Bot, net_id as u64),
                params: vec![0; idlin_vm::PARAM_BLOCK_LEN],
                program: join.program.clone(),
                program_hash: program_hash(&join.program),
                version: 1,
            });
            let pos = self.spawn_pos();
            self.zone.insert(Entity {
                net_id,
                pos,
                intents: Default::default(),
                last_say_tick: 0,
                effects: Vec::new(),
                bot: Some(bot_idx),
                combat: Some(universal_stats(1)),
                character: Some(CharacterState {
                    name: join.name.clone(),
                    level: 1,
                    xp: 0,
                    respawn_at: None,
                    kills: 0,
                    deaths: 0,
                    items: 0,
                    inventory: Vec::new(),
                    equipment: Default::default(),
                    allocated: Vec::new(),
                    build_plan: Vec::new(),
                    currency: vec![0; self.content.currency.len()],
                    stash: Vec::new(),
                    sockets: std::collections::BTreeMap::new(),
                    // Sized + stamped by this tick's explore() pass (#129).
                    explored: Vec::new(),
                    story_acts: 0,
                }),
                monster: None,
                loot: None,
            });
            events.push(SimEvent::CharacterJoined {
                id: net_id,
                name: join.name.clone(),
            });
        }
        for bundle in &inputs.arrivals {
            // A transfer is a redeploy that walked: fresh VM, persist block
            // restored, the character exactly as it left.
            let mut vm = match Vm::new(&bundle.program) {
                Ok(vm) => vm,
                Err(e) => {
                    events.push(SimEvent::JoinRejected {
                        name: bundle.character.name.clone(),
                        reason: e.to_string(),
                    });
                    continue;
                }
            };
            vm.write_persist_block(&bundle.persist);
            let net_id = self.alloc_net();
            let bot_idx = self.bots.insert(Bot {
                vm,
                rng: Pcg32::stream(self.seed, Domain::Bot, net_id as u64),
                params: bundle.params.clone(),
                program: bundle.program.clone(),
                program_hash: program_hash(&bundle.program),
                version: bundle.bot_version,
            });
            let mut character = bundle.character.clone();
            character.respawn_at = None;
            // Fog of war (#129): a NEW zone starts undiscovered — the bundle's
            // bitset is the OLD zone's knowledge, and a same-sized destination
            // would otherwise inherit it wholesale (explore()'s size check
            // can't catch that case). The first explore() this tick re-sizes
            // and stamps the arrival's spawn disc.
            character.explored = Vec::new();
            if character.currency.len() < self.content.currency.len() {
                character.currency.resize(self.content.currency.len(), 0);
            }
            let name = character.name.clone();
            let level = character.level;
            // Map tally marks (#148 A7): stamp what the runner arrives
            // with; the departure delta is the scoreboard.
            if self.is_map_instance {
                self.map_marks.insert(
                    net_id,
                    (
                        character.kills,
                        character.deaths,
                        character.items,
                        self.tick,
                    ),
                );
            }
            let pos = self.spawn_pos();
            let slot = self.zone.insert(Entity {
                net_id,
                pos,
                intents: Default::default(),
                last_say_tick: 0,
                effects: Vec::new(),
                bot: Some(bot_idx),
                combat: Some(universal_stats(level)),
                character: Some(character),
                monster: None,
                loot: None,
            });
            // Re-derive from gear/tree, then arrive rested: full pools.
            self.refresh_derived_stats(slot);
            if let Some(c) = self.zone.get_mut(slot).and_then(|e| e.combat.as_mut()) {
                c.life = c.life_max;
                c.mana = c.mana_max;
                c.es = c.es_max;
            }
            events.push(SimEvent::CharacterJoined { id: net_id, name });
        }
    }

    /// Sell a bag item at the town vendor (#148 A5). Pays ONE obol keyed to
    /// what the item was — normal→transmute, magic→alter, rare→alchemy,
    /// unique→regal; gems and maps sell as transmutes. Returns the paid
    /// obol's NUM (positive), or -1 bad selection / -2 not at a vendor /
    /// -4 no character.
    pub(crate) fn sell(&mut self, slot: usize, inv_sel: i32, events: &mut Vec<SimEvent>) -> i32 {
        const VENDOR_REACH: i64 = 3; // cells, same reach as the Map Device
        let Some(e) = self.zone.get(slot) else {
            return -4;
        };
        let Some(ch) = e.character.as_ref() else {
            return -4;
        };
        let Some((vx, vy)) = self.vendor else {
            return -2;
        };
        let (cx, cy) = (e.pos.x.floor() as i64, e.pos.y.floor() as i64);
        let (dx, dy) = (cx - vx as i64, cy - vy as i64);
        if dx * dx + dy * dy > VENDOR_REACH * VENDOR_REACH {
            return -2;
        }
        let idx = inv_sel as usize;
        if inv_sel < 0 || idx >= ch.inventory.len() {
            return -1;
        }
        let net = e.net_id;
        let obol_id = match &ch.inventory[idx].item {
            crate::entity::BagItem::Gear(it) => match it.rarity {
                Rarity::Normal => "transmute_obol",
                Rarity::Magic => "alter_obol",
                Rarity::Rare => "alchemy_obol",
                Rarity::Unique => "regal_obol",
            },
            crate::entity::BagItem::Gem(_) => "transmute_obol",
        };
        let Some(cidx) = self.content.currency.iter().position(|c| c.id == obol_id) else {
            return -1; // the obol vocabulary is loader-guaranteed; belt+braces
        };
        let name = match &self
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory[idx]
            .item
        {
            crate::entity::BagItem::Gear(it) => it.name.clone(),
            crate::entity::BagItem::Gem(g) => self.content.gems[g.gem_idx as usize].name.clone(),
        };
        let ch = self.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
        ch.inventory.remove(idx);
        ch.currency[cidx] += 1;
        events.push(SimEvent::Narration {
            target: net,
            text: format!("Sold {name} — one {}.", self.content.currency[cidx].name),
        });
        self.content_num(idlin_content::ids::Category::Currency, cidx)
    }

    /// Move an item between bag and stash at the town chest (#148 A5).
    /// op 0 = deposit inventory[sel]; op 1 = withdraw stash[sel] (first-fit
    /// back into the bag). Returns 1, or -1 bad selection / -2 not at the
    /// stash / -3 no room / -4 no character.
    pub(crate) fn stash_op(&mut self, slot: usize, op: i32, sel: i32) -> i32 {
        const STASH_REACH: i64 = 3;
        let Some(e) = self.zone.get(slot) else {
            return -4;
        };
        if e.character.is_none() {
            return -4;
        }
        let Some((sx, sy)) = self.stash_cell else {
            return -2;
        };
        let (cx, cy) = (e.pos.x.floor() as i64, e.pos.y.floor() as i64);
        let (dx, dy) = (cx - sx as i64, cy - sy as i64);
        if dx * dx + dy * dy > STASH_REACH * STASH_REACH {
            return -2;
        }
        let idx = sel as usize;
        match op {
            0 => {
                let ch = self.zone.get(slot).unwrap().character.as_ref().unwrap();
                if sel < 0 || idx >= ch.inventory.len() {
                    return -1;
                }
                if ch.stash.len() >= crate::entity::STASH_CAP {
                    return -3;
                }
                let ch = self.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
                let placed = ch.inventory.remove(idx);
                ch.stash.push(placed.item);
                1
            }
            1 => {
                let ch = self.zone.get(slot).unwrap().character.as_ref().unwrap();
                if sel < 0 || idx >= ch.stash.len() {
                    return -1;
                }
                let (w, h) = match &ch.stash[idx] {
                    crate::entity::BagItem::Gear(it) => {
                        let def = &self.content.items[it.base_idx as usize];
                        (def.w, def.h)
                    }
                    crate::entity::BagItem::Gem(_) => (1, 1),
                };
                let Some((x, y)) = self.first_fit(ch, w, h) else {
                    return -3;
                };
                let ch = self.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
                let item = ch.stash.remove(idx);
                ch.inventory.push(crate::entity::PlacedItem { item, x, y });
                1
            }
            _ => -1,
        }
    }

    /// OpenMap (#136 T4): validate, consume, and stage the run. The map's
    /// effective tier is its base tier lifted by the roll's item_level over
    /// the act's end (ilvl 13 = tier+1, 14 = tier+2…); the ticket's juice
    /// comes from the map's rolled quantity/rarity affix values, so the
    /// obols craft BETTER MAPS with the machinery they already have.
    pub(crate) fn open_map(&mut self, slot: usize, inv_sel: i32) -> i32 {
        const TABLE_REACH: i64 = 3; // cells
        let Some(e) = self.zone.get(slot) else {
            return -4;
        };
        let Some(ch) = e.character.as_ref() else {
            return -4;
        };
        // The WHOLE campaign gates the sea (#148 retrospective): the brains
        // already waited for the final act (the device-gate discipline), but
        // the ENGINE still accepted act-1-only runners — a player brain
        // could skip Act 2 entirely. The bound is content-derived: adding
        // Act 3 moves it with zero engine edits.
        let final_act = self.content.final_act.max(1);
        if ch.story_acts & (1u32 << (final_act - 1)) == 0 {
            return -3; // the sea is sealed until the campaign falls
        }
        let Some((tx, ty)) = self.map_device else {
            return -2; // no device in this zone
        };
        let (cx, cy) = (e.pos.x.floor() as i64, e.pos.y.floor() as i64);
        let (dx, dy) = (cx - tx as i64, cy - ty as i64);
        if dx * dx + dy * dy > TABLE_REACH * TABLE_REACH {
            return -2;
        }
        let net = e.net_id;
        let idx = inv_sel as usize;
        if inv_sel < 0 || idx >= ch.inventory.len() {
            return -1;
        }
        let crate::entity::BagItem::Gear(item) = &ch.inventory[idx].item else {
            return -1; // gems are not maps
        };
        let def = &self.content.items[item.base_idx as usize];
        let Some(base_tier) = def.map_tier else {
            return -1; // not a map
        };
        // Effective tier: base + how far past the act's end this roll dropped.
        let tier = base_tier + item.item_level.saturating_sub(12);
        // Juice from the map's OWN rolled affixes (quantity/rarity stats).
        let mut quantity_bp = 0i64;
        let mut rarity_bp = 0i64;
        let mut fury_bp = 0i64;
        let mut clock = 0i64;
        let mut boss = false;
        for ra in &item.affixes {
            let a = &self.content.affixes[ra.affix_idx as usize];
            for g in a.grants(&ra.values) {
                match g.stat {
                    crate::stats::Stat::ItemQuantity => quantity_bp += g.value,
                    crate::stats::Stat::ItemRarity => rarity_bp += g.value,
                    // THE RULES (#148 A4): risk crafted with the same obols.
                    crate::stats::Stat::MonsterFury => fury_bp += g.value,
                    crate::stats::Stat::MapClock => clock = g.value,
                    crate::stats::Stat::SovereignsMark => boss = g.value > 0,
                    _ => {}
                }
            }
        }
        // A departure is already staged this tick (an exit, or an earlier
        // map): refuse WITHOUT consuming — the critic's same-tick trap
        // (#136 T4 review): consume-before-guard destroyed the map and
        // reported success while the bot departed somewhere else entirely.
        if self.pending_exits.iter().any(|(n, ..)| *n == net) {
            return -5;
        }
        // Stage the depart, then spend the map — both or neither.
        self.pending_exits.push((
            net,
            "charted_shallows".into(),
            Some(MapTicket {
                // Tier capped at 16: the ladder ends where the maps do,
                // not where an overflow would.
                tier: tier.clamp(1, 16),
                rarity_bp,
                quantity_bp,
                fury_bp,
                clock,
                boss,
            }),
        ));
        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.character.as_mut()
        {
            c.inventory.remove(idx);
        }
        0
    }

    /// Drain the characters that left this world this tick (the host
    /// ferries each bundle into its destination world's arrivals).
    pub fn take_departures(&mut self) -> Vec<(CharacterBundle, String)> {
        std::mem::take(&mut self.pending_departures)
    }

    fn monster_def(&self, idx: u32) -> &MonsterDef {
        &self.content.monsters[idx as usize]
    }

    fn movement(&mut self) {
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if !e.alive() {
                continue;
            }
            let Some(target) = e.intents.move_to else {
                continue;
            };
            let Some(combat) = &e.combat else { continue };
            if self.tick < combat.busy_until {
                continue; // committed to a swing/cast — no moving mid-use
            }
            let (pos, mut speed, range) = (e.pos, combat.speed_per_tick, combat.range);
            // #88: Chill slows movement proportionally to its magnitude.
            let chill_bp = e.ailment(crate::entity::AilmentKind::Chill);
            if chill_bp > 0 {
                speed = crate::fixed::Fx::from_raw(
                    (speed.raw() as i64 * (10000 - chill_bp.clamp(0, 10000)) / 10000) as i32,
                );
            }

            // Stop to fight: if the attack target is already in range, hold.
            if let Some(att) = e.intents.attack
                && let crate::entity::SkillTarget::Entity(tid) = att.target
                && let Some(t) = self.zone.get_net(tid)
                && t.alive()
                && pos.dist(t.pos) <= range
            {
                continue;
            }

            // PATHFOLLOW (#148 A2.5): when the straight line to the intent
            // is LoS-blocked by terrain, walk a deterministic A* path
            // instead (computed once, cached on the intent, re-planned when
            // the target moves a cell or a hop goes stale). The straight
            // walk remains the common case — open-ground behavior (and its
            // replays) is untouched.
            let step_target = {
                let e = self.zone.get(slot).unwrap();
                let blocked = self
                    .zone
                    .grid
                    .as_ref()
                    .is_some_and(|_| self.walk_line_blocked(pos, target));
                // DIAGNOSTICS (#185, operator): IDLIN_TRACE_MOVE=<name> prints
                // the movement decision for that character every tick —
                // pos, goal, LOS, path length, next hop. DEBUG BUILDS ONLY:
                // the pure-sim boundary means release binaries carry no env
                // reads or stderr in the core; the env is read once.
                #[cfg(debug_assertions)]
                let trace = trace_move_wanted()
                    .is_some_and(|want| e.character.as_ref().is_some_and(|c| c.name == *want));
                #[cfg(not(debug_assertions))]
                let trace = false;
                if !blocked {
                    if trace {
                        eprintln!(
                            "MOVE t={} pos={},{} goal={},{} LOS-clear: straight",
                            self.tick,
                            pos.x.floor(),
                            pos.y.floor(),
                            target.x.floor(),
                            target.y.floor()
                        );
                    }
                    if !e.intents.path.is_empty()
                        && let Some(me) = self.zone.get_mut(slot)
                    {
                        me.intents.path.clear();
                    }
                    target
                } else {
                    // Follow (or build) the waypoint path. Shut gates veto
                    // cells at PLAN time, and a hop that a gate has since
                    // shut on is STALE — re-plan (the documented contract;
                    // the review found the first draft soft-pinning on a
                    // closed lesson gate its plan walked through).
                    let gate_blocked = |cx: i64, cy: i64| {
                        self.zone.gates.iter().any(|g| !g.open && g.covers(cx, cy))
                    };
                    let hop_stale = e.intents.path.first().is_some_and(|w| {
                        let (cx, cy) = (
                            (w.x.raw() as i64).div_euclid(65536),
                            (w.y.raw() as i64).div_euclid(65536),
                        );
                        gate_blocked(cx, cy)
                    });
                    let mut next = e.intents.path.first().copied();
                    let goal_moved = e
                        .intents
                        .path
                        .last()
                        .is_some_and(|w| w.dist(target) > Fx::from_int(1));
                    if next.is_none() || goal_moved || hop_stale {
                        let path = self
                            .zone
                            .grid
                            .as_ref()
                            .and_then(|g| g.find_path(pos, target, gate_blocked))
                            .unwrap_or_default();
                        next = path.first().copied();
                        if let Some(me) = self.zone.get_mut(slot) {
                            me.intents.path = path;
                        }
                    }
                    if trace {
                        eprintln!(
                            "MOVE t={} pos={},{} goal={},{} next={:?} stale={} goal_moved={}",
                            self.tick,
                            pos.x.floor(),
                            pos.y.floor(),
                            target.x.floor(),
                            target.y.floor(),
                            next.map(|w| (w.x.floor(), w.y.floor())),
                            hop_stale,
                            goal_moved
                        );
                    }
                    match next {
                        Some(w) => {
                            if pos.dist(w) <= speed
                                && let Some(me) = self.zone.get_mut(slot)
                            {
                                me.intents.path.remove(0);
                            }
                            w
                        }
                        None => {
                            if trace {
                                eprintln!(
                                    "MOVE t={} UNREACHABLE goal — straight fallback",
                                    self.tick
                                );
                            }
                            target // unreachable: fall back to straight
                        }
                    }
                }
            };
            let delta = step_target - pos;
            let dist_step = pos.dist(step_target);
            let dist = pos.dist(target);
            let new_pos = if dist_step <= speed {
                step_target
            } else {
                let factor = speed / dist_step;
                FxV2::new(pos.x + delta.x * factor, pos.y + delta.y * factor)
            };
            let new_pos = self.zone.clamp_pos(new_pos);
            // WALL SLIDE (#148 A2.5): a blocked diagonal keeps its free
            // axis instead of stalling — the classic steering slide, at the
            // ONE movement chokepoint. Before this, a bot walking at a wall
            // parked forever against it (the terrace pins, the court-wall
            // pins — a whole class of template escape hacks fought this);
            // now it slides along the wall to the gap. Deterministic: the
            // axis order is fixed (x first), the checks are grid reads.
            let new_pos = match &self.zone.grid {
                Some(grid) if !grid.walkable_pos(new_pos) => {
                    let x_only = self.zone.clamp_pos(FxV2::new(new_pos.x, pos.y));
                    let y_only = self.zone.clamp_pos(FxV2::new(pos.x, new_pos.y));
                    if grid.walkable_pos(x_only) {
                        x_only
                    } else if grid.walkable_pos(y_only) {
                        y_only
                    } else {
                        pos
                    }
                }
                _ => new_pos,
            };
            if let Some(me) = self.zone.get_mut(slot) {
                me.pos = new_pos;
                if dist <= speed {
                    me.intents.move_to = None;
                }
            }
        }
    }

    /// Collision as separation, resolved pairwise in ascending slot order.
    /// Same-faction (and neutral) pairs pass through with a very soft nudge;
    /// opposing factions push hard enough to dominate movement speed —
    /// effective body-blocking without a pathfinding-aware solver.
    fn separation(&mut self) {
        /// Max push per tick between allies: a drift, never a wall.
        const SOFT_PUSH: Fx = Fx::from_raw(0x0CCC); // 0.05 u
        /// Max push per tick between enemies: outruns any move speed.
        const FIRM_PUSH: Fx = Fx::from_raw(0x6666); // 0.4 u

        let n = self.zone.slot_count();
        for a in 0..n {
            for b in (a + 1)..n {
                // Positions are re-read per pair: earlier pairs may have
                // already pushed either party this tick.
                let Some(ea) = self.zone.get(a) else { break };
                if !ea.alive() {
                    break;
                }
                let Some(ca) = &ea.combat else { break };
                let (pos_a, r_a, fac_a, net_a) = (ea.pos, ca.radius, ea.faction(), ea.net_id);
                let Some(eb) = self.zone.get(b) else { continue };
                if !eb.alive() {
                    continue;
                }
                let Some(cb) = &eb.combat else { continue };
                let (pos_b, r_b, fac_b) = (eb.pos, cb.radius, eb.faction());

                let min_dist = r_a + r_b;
                let dist = pos_a.dist(pos_b);
                if dist >= min_dist {
                    continue;
                }
                let cap = if fac_a.is_enemy_of(fac_b) {
                    FIRM_PUSH
                } else {
                    SOFT_PUSH
                };
                let push = ((min_dist - dist) / Fx::from_int(2)).min(cap);
                // Direction b←a; for exact overlap, derive a deterministic
                // pseudo-direction from the pair's net ids.
                let dir = if dist > Fx::from_raw(0x100) {
                    let d = pos_b - pos_a;
                    let f = Fx::ONE / dist;
                    FxV2::new(d.x * f, d.y * f)
                } else {
                    match (net_a ^ eb.net_id) & 3 {
                        0 => FxV2::new(Fx::ONE, Fx::ZERO),
                        1 => FxV2::new(-Fx::ONE, Fx::ZERO),
                        2 => FxV2::new(Fx::ZERO, Fx::ONE),
                        _ => FxV2::new(Fx::ZERO, -Fx::ONE),
                    }
                };
                let shift = FxV2::new(dir.x * push, dir.y * push);
                let new_a = self.zone.clamp_pos(pos_a - shift);
                let new_b = self.zone.clamp_pos(pos_b + shift);
                if let Some(ma) = self.zone.get_mut(a) {
                    ma.pos = new_a;
                }
                if let Some(mb) = self.zone.get_mut(b) {
                    mb.pos = new_b;
                }
            }
        }
    }

    /// Walls are non-walkable: anything alive overlapping a solid tile is
    /// pushed out. Authored zones push out of the tile grid; wall sliding
    /// falls out of the axis-aligned correction naturally. Zones without a
    /// grid (test/placeholder) have no walls, so nothing to do.
    fn obstacle_pushout(&mut self) {
        /// Max correction per tick: firm enough to beat any move speed.
        const MAX_PUSH: Fx = Fx::from_raw(0x8000); // 0.5 u
        if self.zone.grid.is_some() {
            self.grid_pushout(MAX_PUSH);
        }
    }

    /// Tile-grid pushout: the entity circle vs the solid cells of the 3×3
    /// neighborhood, via closest-point-on-AABB. Cells iterate in a fixed
    /// order and corrections accumulate — deterministic like the disc path.
    fn grid_pushout(&mut self, max_push: Fx) {
        const CELL: i64 = 65536;
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if !e.alive() {
                continue;
            }
            let Some(c) = &e.combat else { continue };
            let (pos, radius) = (e.pos, c.radius);
            let grid = self.zone.grid.as_ref().expect("checked by caller");
            let (ccx, ccy) = (
                (pos.x.raw() as i64).div_euclid(CELL),
                (pos.y.raw() as i64).div_euclid(CELL),
            );
            let mut push_x = Fx::ZERO;
            let mut push_y = Fx::ZERO;
            for oy in -1..=1i64 {
                for ox in -1..=1i64 {
                    let (cx, cy) = (ccx + ox, ccy + oy);
                    let solid = grid.solid_cell(cx, cy)
                        || self.zone.gates.iter().any(|g| !g.open && g.covers(cx, cy));
                    if !solid {
                        continue;
                    }
                    // Closest point on the cell's AABB to the entity.
                    let nearest = FxV2::new(
                        Fx::from_raw((pos.x.raw() as i64).clamp(cx * CELL, (cx + 1) * CELL) as i32),
                        Fx::from_raw((pos.y.raw() as i64).clamp(cy * CELL, (cy + 1) * CELL) as i32),
                    );
                    let dist = pos.dist(nearest);
                    if dist >= radius {
                        continue;
                    }
                    if dist > Fx::from_raw(0x100) {
                        let need = (radius - dist).min(max_push);
                        let f = Fx::ONE / dist;
                        let dirx = (pos.x - nearest.x) * f;
                        let diry = (pos.y - nearest.y) * f;
                        // Tangential bias (same trick as the old disc
                        // pushout): a head-on shove also nudges sideways,
                        // so an entity steering straight at cover SLIDES
                        // around it instead of pinning against the face.
                        let side = need / Fx::from_int(2);
                        push_x += dirx * need - diry * side;
                        push_y += diry * need + dirx * side;
                    } else {
                        // On or inside the solid cell: escape along the
                        // dominant axis away from the cell center
                        // (deterministic; dead-center ties go +x).
                        let half = CELL / 2;
                        let dcx = pos.x.raw() as i64 - (cx * CELL + half);
                        let dcy = pos.y.raw() as i64 - (cy * CELL + half);
                        if dcx.abs() >= dcy.abs() {
                            push_x += if dcx >= 0 { max_push } else { -max_push };
                        } else {
                            push_y += if dcy >= 0 { max_push } else { -max_push };
                        }
                    }
                }
            }
            if push_x.raw() != 0 || push_y.raw() != 0 {
                let new_pos = self
                    .zone
                    .clamp_pos(FxV2::new(pos.x + push_x, pos.y + push_y));
                if let Some(me) = self.zone.get_mut(slot) {
                    me.pos = new_pos;
                }
            }
        }
    }

    /// Walls: does the straight line a→b cross solid terrain? Answered from
    /// the authored tile grid (closed gates block too). Zones without a
    /// grid (test/placeholder) never block sight.
    pub(crate) fn los_blocked(&self, a: FxV2, b: FxV2) -> bool {
        match &self.zone.grid {
            Some(grid) => grid_sight_blocked(grid, &self.zone.gates, a, b),
            None => false,
        }
    }

    /// Can a straight WALK traverse `a`→`b`? (#185 stall fix — movement's
    /// twin of los_blocked; feet care about water, eyes don't.)
    pub(crate) fn walk_line_blocked(&self, a: FxV2, b: FxV2) -> bool {
        match &self.zone.grid {
            Some(grid) => grid_walk_blocked(grid, &self.zone.gates, a, b),
            None => false,
        }
    }

    /// Recovery. Once per second (tick % 10): life/mana regen stats apply
    /// and energy shield recharges if untouched past its delay; mana also
    /// trickles 2%/s inherently. The out-of-combat burst heal (2%/tick
    /// after 50 quiet ticks) stays — idle play remains forgiving.
    fn regen(&mut self) {
        let now = self.tick;
        let second_edge = now.is_multiple_of(10);
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get_mut(slot) else {
                continue;
            };
            let is_char = e.character.is_some();
            let Some(c) = e.combat.as_mut() else { continue };
            if c.life <= 0 {
                continue;
            }
            if second_edge {
                if c.life < c.life_max && c.life_regen > 0 {
                    c.life = (c.life + c.life_regen).min(c.life_max);
                }
                if c.mana < c.mana_max {
                    let rate = (c.mana_max * 200 / 10000).max(1) + c.mana_regen;
                    c.mana = (c.mana + rate).min(c.mana_max);
                }
                if c.es < c.es_max && now >= c.es_recharge_at {
                    let rate = (c.es_max * 1000 / 10000).max(1);
                    c.es = (c.es + rate).min(c.es_max);
                }
            }
            // CHARACTERS ONLY (#185 tuning): the burst heal is a player
            // convenience — on monsters it fully reset any boss whose
            // attacker kited for 5s, making ranged archetypes' fights
            // unwinnable wars against a self-refilling bar (measured:
            // the Mother cycling 19%→78% against the caster forever).
            // Monsters regen through their life_regen stat alone.
            if is_char
                && c.life < c.life_max
                && now.saturating_sub(c.last_combat_tick) >= REGEN_DELAY_TICKS
            {
                c.life = (c.life + (c.life_max / 50).max(1)).min(c.life_max);
            }
        }
    }

    fn respawns(&mut self, events: &mut Vec<SimEvent>) {
        // Characters.
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            let Some(ch) = &e.character else { continue };
            let Some(at) = ch.respawn_at else { continue };
            if at > self.tick {
                continue;
            }
            let spawn = self.spawn_pos();
            if let Some(me) = self.zone.get_mut(slot) {
                let id = me.net_id;
                me.pos = spawn;
                me.character.as_mut().unwrap().respawn_at = None;
                let c = me.combat.as_mut().unwrap();
                c.life = c.life_max;
                c.mana = c.mana_max;
                c.es = c.es_max;
                c.busy_until = 0;
                // Five seconds of respawn grace (or until the first strike
                // they throw) — spawn camping is not a fight.
                c.grace_until = self.tick + 50;
                events.push(SimEvent::CharacterRespawned { id });
            }
        }

        // A pack rises EXACTLY ONCE (operator ruling: monsters never
        // resurrect — anywhere). This loop is the SPAWNER, not a respawner:
        // it raises each authored pack on its first eligible tick and never
        // again. A cleared zone stays cleared; a cleared map is done.
        for pack_idx in 0..self.zone.packs.len() {
            let pack = &self.zone.packs[pack_idx];
            if pack.alive > 0 || pack.risen {
                continue;
            }
            let (missing, monster_idx, count) = (
                pack.def.count - pack.alive,
                pack.monster_idx,
                pack.def.count,
            );
            let anchor = FxV2::new(
                Fx::from_int(pack.def.x_u as i16),
                Fx::from_int(pack.def.y_u as i16),
            );
            let jitter_r = Fx::from_int(pack.def.radius_u as i16).raw() as u32;
            // Rarity is rolled ONCE per pack, PoE-style: a magic roll
            // raises the WHOLE pack as magic sharing one affix set; a
            // rare roll raises a single rare leading an otherwise-normal
            // pack. Map packs never roll Unique — uniques are authored
            // on the def and spawn Unique regardless.
            let (magic_bp, rare_bp) = {
                let d = &self.zone.packs[pack_idx].def;
                // The instance's rarity juice folds at READ time (B4):
                // defs stay immutable content.
                let juice = self.spawn_rarity_bp.max(0) as u32;
                (d.magic_bp + juice, d.rare_bp + juice / 3)
            };
            let roll = self.rng_ai.next_range(10000);
            let pack_rarity = if self.content.monsters[monster_idx as usize].unique {
                Rarity::Unique
            } else if roll < rare_bp {
                Rarity::Rare
            } else if roll < rare_bp + magic_bp {
                Rarity::Magic
            } else {
                Rarity::Normal
            };
            let shared = if pack_rarity == Rarity::Magic {
                Some(self.roll_monster_affixes(monster_idx, Rarity::Magic))
            } else {
                None
            };
            for member in 0..missing {
                // Radius 0 = staked exactly on the anchor (tutorial prey,
                // bosses). Authored zones retry draws that land in walls,
                // falling back to the anchor (validated walkable at load).
                let attempts = if self.zone.grid.is_some() { 8 } else { 1 };
                let mut pos = self.zone.clamp_pos(anchor);
                for _ in 0..attempts {
                    let (dx, dy) = if jitter_r == 0 {
                        (Fx::ZERO, Fx::ZERO)
                    } else {
                        (
                            Fx::from_raw(
                                self.rng_ai.next_range(jitter_r * 2) as i32 - jitter_r as i32,
                            ),
                            Fx::from_raw(
                                self.rng_ai.next_range(jitter_r * 2) as i32 - jitter_r as i32,
                            ),
                        )
                    };
                    let candidate = self.zone.clamp_pos(FxV2::new(anchor.x + dx, anchor.y + dy));
                    match &self.zone.grid {
                        Some(grid) if !grid.walkable_pos(candidate) => continue,
                        _ => {
                            pos = candidate;
                            break;
                        }
                    }
                }
                match (&shared, pack_rarity) {
                    // Every member of a magic pack wears the SAME affixes.
                    (Some((affixes, name)), _) => {
                        self.spawn_monster_rolled(
                            monster_idx,
                            pack_idx as u32,
                            pos,
                            Rarity::Magic,
                            affixes.clone(),
                            name.clone(),
                        );
                    }
                    // The rare leads the pack; the rest rise normal.
                    (None, Rarity::Rare) => {
                        let r = if member == 0 {
                            Rarity::Rare
                        } else {
                            Rarity::Normal
                        };
                        self.spawn_monster_with(monster_idx, pack_idx as u32, pos, r);
                    }
                    (None, r) => {
                        self.spawn_monster_with(monster_idx, pack_idx as u32, pos, r);
                    }
                }
            }
            self.zone.packs[pack_idx].alive = count;
            self.zone.packs[pack_idx].risen = true;
        }

        // Loot despawn and corpse decay.
        let mut stale: Vec<usize> = Vec::new();
        for (slot, e) in self.zone.iter() {
            if let Some(l) = &e.loot
                && l.despawn_at <= self.tick
            {
                stale.push(slot);
            }
            if let Some(m) = &e.monster
                && m.decay_at.is_some_and(|d| d <= self.tick)
            {
                stale.push(slot);
            }
        }
        for slot in stale {
            self.zone.remove(slot);
        }
    }

    /// Spawn one monster: same entity shape as a character, with a brain
    /// program from content driving it and stats straight from its def.
    fn spawn_monster(&mut self, monster_idx: u32, pack_idx: u32, pos: FxV2) {
        // Authored uniques always spawn Unique; everything else Normal
        // unless the caller rolled better.
        let rarity = if self.content.monsters[monster_idx as usize].unique {
            Rarity::Unique
        } else {
            Rarity::Normal
        };
        self.spawn_monster_with(monster_idx, pack_idx, pos, rarity);
    }

    /// Spawn at an explicit rarity, rolling fresh affixes for this one
    /// monster. Brain-summoned elites and lone rares come through here.
    pub(crate) fn spawn_monster_with(
        &mut self,
        monster_idx: u32,
        pack_idx: u32,
        pos: FxV2,
        rarity: Rarity,
    ) {
        let (affixes, display_name) = self.roll_monster_affixes(monster_idx, rarity);
        self.spawn_monster_rolled(monster_idx, pack_idx, pos, rarity, affixes, display_name);
    }

    /// Roll a monster's affix set + display name for a rarity. Magic/rare
    /// draw from the monster's subscribed pools with the SAME roller items
    /// use, and name themselves the same way (tier names for magic, the
    /// naming pools for rares). Separated from spawning so a magic PACK
    /// can roll once and share the set across every member.
    fn roll_monster_affixes(
        &mut self,
        monster_idx: u32,
        rarity: Rarity,
    ) -> (Vec<crate::entity::RolledAffix>, String) {
        let mut affixes: Vec<crate::entity::RolledAffix> = Vec::new();
        if !matches!(rarity, Rarity::Magic | Rarity::Rare) {
            return (affixes, String::new());
        }
        let def = &self.content.monsters[monster_idx as usize];
        let (add, cap) = match rarity {
            Rarity::Magic => (1 + self.rng_ai.next_range(2), 1),
            _ => (3 + self.rng_ai.next_range(2), 3),
        };
        let pools = def.affix_pools.clone();
        let level = self.effective_monster_level(monster_idx, rarity);
        crate::world::loot::roll_affixes_into(
            &self.content,
            &mut self.rng_ai,
            &pools,
            level,
            &mut affixes,
            add,
            cap,
        );
        let def = &self.content.monsters[monster_idx as usize];
        // Names: magic composes its rolled tier names; rares draw a
        // name from the same pools rare ITEMS use.
        let display_name = match rarity {
            Rarity::Magic => {
                let (mut pre, mut suf) = (None, None);
                for ra in &affixes {
                    let a = &self.content.affixes[ra.affix_idx as usize];
                    let n = a
                        .tiers
                        .get(ra.tier as usize)
                        .filter(|t| !t.name.is_empty())
                        .map_or(a.name.as_str(), |t| t.name.as_str());
                    match a.kind {
                        idlin_content::AffixKind::Prefix => pre = Some(n),
                        idlin_content::AffixKind::Suffix => suf = Some(n),
                    }
                }
                let mut out = String::new();
                if let Some(p2) = pre {
                    out.push_str(p2);
                    out.push(' ');
                }
                out.push_str(&def.name);
                if let Some(sx) = suf {
                    out.push(' ');
                    out.push_str(sx);
                }
                out
            }
            _ => {
                let pools2 = &self.content.naming;
                if pools2.first.is_empty() || pools2.second.is_empty() {
                    def.name.clone()
                } else {
                    let f = self.rng_ai.next_range(pools2.first.len() as u32) as usize;
                    let s2 = self.rng_ai.next_range(pools2.second.len() as u32) as usize;
                    format!("{} {}", pools2.first[f], pools2.second[s2])
                }
            }
        };
        (affixes, display_name)
    }

    /// The level a spawn actually fights at: area level lifts normal
    /// mobs to max(def, area) — the hand-designed shore keeps its
    /// authored ramp — with +1 for magic, +2 for rare. Authored uniques
    /// keep their own level (they are their own design).
    fn effective_monster_level(&self, monster_idx: u32, rarity: Rarity) -> u32 {
        let def = &self.content.monsters[monster_idx as usize];
        if def.unique || rarity == Rarity::Unique {
            return def.level;
        }
        let bump = match rarity {
            Rarity::Magic => 1,
            Rarity::Rare => 2,
            _ => 0,
        };
        def.level.max(self.zone_level) + bump
    }

    /// Spawn with a pre-rolled affix set, applying it through the same
    /// Grant machinery items use plus the inherent elite bulk.
    fn spawn_monster_rolled(
        &mut self,
        monster_idx: u32,
        pack_idx: u32,
        pos: FxV2,
        rarity: Rarity,
        affixes: Vec<crate::entity::RolledAffix>,
        display_name: String,
    ) {
        let eff_level = self.effective_monster_level(monster_idx, rarity);
        // Base stats only (radius + runtime defaults). The full derive — level/rarity
        // scaling (monster_scaled_base), rolled affixes, and the def's passive set —
        // runs in refresh_derived_stats AFTER insert (#125), so spawn and every later
        // refresh agree: a chill can no longer drop a rare's scaling/affixes.
        let stats = monster_base_stats(&self.content.monsters[monster_idx as usize]);
        let def = &self.content.monsters[monster_idx as usize];
        let skills = resolve_monster_skills(&self.content, def);
        let hostile = def.hostile;
        let program = self
            .content
            .brain_idx(&def.brain)
            .map(|i| self.content.brains[i].program.clone())
            .unwrap_or_default();
        // Brains are validated at content load; a failure here means empty
        // content (tests) — spawn a brainless (inert) monster rather than die.
        let vm = Vm::new(&program).ok();
        let net_id = self.alloc_net();
        let bot = vm.map(|vm| {
            self.bots.insert(Bot {
                vm,
                rng: Pcg32::stream(self.seed, Domain::Bot, net_id as u64),
                params: vec![0; idlin_vm::PARAM_BLOCK_LEN],
                program: program.clone(),
                program_hash: program_hash(&program),
                version: 1,
            })
        });
        let slot = self.zone.insert(Entity {
            net_id,
            pos,
            intents: Default::default(),
            last_say_tick: 0,
            effects: Vec::new(),
            bot,
            combat: Some(stats),
            character: None,
            monster: Some(MonsterState {
                def_idx: monster_idx,
                pack_idx,
                anchor: pos,
                hostile,
                decay_at: None,
                rarity,
                level: eff_level,
                affixes,
                display_name,
                skills,
            }),
            loot: None,
        });
        // Now that the MonsterState (affixes/level/rarity) is in place, run the full
        // derive — scaling + affixes + passives fold in (#125) — and spawn at full life.
        self.refresh_derived_stats(slot);
        if let Some(c) = self.zone.get_mut(slot).and_then(|e| e.combat.as_mut()) {
            c.life = c.life_max;
        }
    }
}

#[cfg(test)]
mod pack_rarity_tests {
    use super::*;
    use crate::entity::MonsterState;
    use idlin_content::ContentDb;
    use std::path::Path;

    fn content() -> ContentDb {
        ContentDb::load(Path::new("../../content")).expect("workspace content must load")
    }

    #[test]
    fn conditional_monster_affixes_are_gated_at_spawn() {
        use crate::stats::{Condition, Layer, Stat, WeaponClass};
        use idlin_content::{AffixDef, AffixEffect, AffixKind, AffixTier, RollRange};
        // A monster wields no weapon (unarmed → melee), so a melee-conditional
        // +life affix applies but a bow-conditional one does not. Mutation: fold
        // monster affixes via face-value grants() again → both apply → equal life.
        let cond_life = |id: &str, cond: Condition| AffixDef {
            id: id.into(),
            public: false,
            name: id.into(),
            kind: AffixKind::Suffix,
            weight: 100,
            effects: vec![AffixEffect {
                stat: Stat::Life,
                layer: Layer::Increased,
                condition: Some(cond),
            }],
            tiers: vec![AffixTier {
                ilvl: 1,
                rolls: vec![RollRange {
                    min: 5000,
                    max: 5000,
                }], // +50%, fixed
                name: String::new(),
                weight: 100,
            }],
        };
        let mut content = content();
        let melee_idx = content.affixes.len() as u32;
        content.affixes.push(cond_life(
            "cond_melee",
            Condition::WieldingWeaponClass(WeaponClass::Melee),
        ));
        let bow_idx = content.affixes.len() as u32;
        content.affixes.push(cond_life(
            "cond_bow",
            Condition::WieldingWeaponClass(WeaponClass::Bow),
        ));

        let mut w = World::new(7, &content);
        let rolled = |idx: u32| {
            vec![crate::entity::RolledAffix {
                affix_idx: idx,
                values: vec![5000],
                tier: 0,
            }]
        };
        let life_of = |w: &mut World, idx: u32, name: &str| -> i64 {
            w.spawn_monster_rolled(
                0,
                0,
                FxV2::new(Fx::from_int(5), Fx::from_int(5)),
                Rarity::Magic,
                rolled(idx),
                name.into(),
            );
            w.zone
                .iter()
                .find(|(_, e)| e.monster.as_ref().map(|m| m.display_name.as_str()) == Some(name))
                .and_then(|(_, e)| e.combat.as_ref().map(|c| c.life_max))
                .expect("spawned monster present")
        };
        let life_melee = life_of(&mut w, melee_idx, "MeleeMob");
        let life_bow = life_of(&mut w, bow_idx, "BowMob");
        assert!(
            life_melee > life_bow,
            "melee condition applies the +life to an (unarmed) monster, bow does not \
             ({life_melee} vs {life_bow})"
        );
    }

    // Spawn one monster def by index at Normal rarity and return its CombatStats.
    fn spawn_one(w: &mut World, idx: u32, name: &str) -> crate::entity::CombatStats {
        w.spawn_monster_rolled(
            idx,
            0,
            FxV2::new(Fx::from_int(5), Fx::from_int(5)),
            Rarity::Normal,
            vec![],
            name.into(),
        );
        w.zone
            .iter()
            .find(|(_, e)| e.monster.as_ref().map(|m| m.display_name.as_str()) == Some(name))
            .and_then(|(_, e)| e.combat.clone())
            .expect("spawned monster present")
    }

    #[test]
    fn monster_passives_fold_the_previously_hardcoded_fields() {
        use crate::stats::{Grant, Layer, Stat};
        // #125 parity: a monster's passive set folds into the fields the old monster
        // derive HARDCODED (crit/leech/regen/block) — proving monsters now run the
        // same derive. Mutation: revert refresh_monster_stats to the def-base/buffs-only
        // form → these read their hardcoded defaults (10000/0/0/0) and the asserts fail.
        let mut content = content();
        let mut kit = content
            .monsters
            .iter()
            .find(|m| m.id == "tide_husk")
            .cloned()
            .expect("tide_husk");
        kit.id = "kit_test".into();
        kit.passives = vec![
            Grant::new(Stat::CritChance, Layer::Added, 1500), // +15% crit
            Grant::new(Stat::LeechLife, Layer::Added, 500),   // +5% life leech
            Grant::new(Stat::LifeRegen, Layer::Added, 7),     // +7 life/s
            Grant::new(Stat::Block, Layer::Added, 2000),      // +20% block
        ];
        let idx = content.monsters.len() as u32;
        content.monsters.push(kit);
        let mut w = World::new(7, &content);
        let c = spawn_one(&mut w, idx, "Kitted");
        assert_eq!(c.crit_inc, 11500, "crit chance folds (was hardcoded 10000)");
        assert_eq!(c.leech_life, 500, "life leech folds (was hardcoded 0)");
        assert_eq!(c.life_regen, 7, "life regen folds (was hardcoded 0)");
        assert_eq!(c.block, 2000, "block folds (was hardcoded 0)");
    }

    #[test]
    fn monster_affix_survives_a_refresh() {
        use crate::stats::{Condition, Layer, Stat, WeaponClass};
        use idlin_content::{AffixDef, AffixEffect, AffixKind, AffixTier, RollRange};
        // Regression (#125): the old monster refresh rebuilt from the RAW def + buffs,
        // so a rare's rolled affix (and the level scaling) were DROPPED on any refresh
        // (e.g. when chilled). Now the derive re-folds affixes every refresh, so a
        // re-derive leaves life unchanged. Mutation: restore the raw-def rebuild → the
        // affix bonus vanishes on refresh and life_max drops → assert fails.
        let mut content = content();
        let aidx = content.affixes.len() as u32;
        content.affixes.push(AffixDef {
            id: "mob_vigor".into(),
            public: false,
            name: "mob_vigor".into(),
            kind: AffixKind::Suffix,
            weight: 100,
            effects: vec![AffixEffect {
                stat: Stat::Life,
                layer: Layer::Increased,
                condition: Some(Condition::WieldingWeaponClass(WeaponClass::Melee)),
            }],
            tiers: vec![AffixTier {
                ilvl: 1,
                rolls: vec![RollRange {
                    min: 8000,
                    max: 8000,
                }],
                name: String::new(),
                weight: 100,
            }],
        });
        let mut w = World::new(7, &content);
        w.spawn_monster_rolled(
            0,
            0,
            FxV2::new(Fx::from_int(5), Fx::from_int(5)),
            Rarity::Rare,
            vec![crate::entity::RolledAffix {
                affix_idx: aidx,
                values: vec![8000],
                tier: 0,
            }],
            "Vigorous".into(),
        );
        let slot = w
            .zone
            .iter()
            .find(|(_, e)| e.monster.as_ref().map(|m| m.display_name.as_str()) == Some("Vigorous"))
            .map(|(s, _)| s)
            .expect("spawned");
        let before = w.zone.get(slot).unwrap().combat.as_ref().unwrap().life_max;
        w.refresh_derived_stats(slot);
        let after = w.zone.get(slot).unwrap().combat.as_ref().unwrap().life_max;
        assert_eq!(before, after, "a rare's affix life survives a refresh");
        // And it's genuinely affixed (the +80% lifted it well above the bare base 90).
        assert!(
            before > 90,
            "the +life affix is actually applied ({before})"
        );
    }

    #[test]
    fn monster_strike_condition_enrages_below_life() {
        // #125: tide_husk carries a strike-time passive (+20% phys below half life).
        // Monsters now re-derive per strike (the attacker_is_char gate is gone), so the
        // enrage folds when wounded and is inert at full life. Mutation: restore the
        // gate → effective_offense returns the cached (un-enraged) damage → assert fails.
        let content = content();
        let idx = content
            .monsters
            .iter()
            .position(|m| m.id == "tide_husk")
            .expect("tide_husk") as u32;
        let mut w = World::new(7, &content);
        w.spawn_monster_rolled(
            idx,
            0,
            FxV2::new(Fx::from_int(5), Fx::from_int(5)),
            Rarity::Normal,
            vec![],
            "Husk".into(),
        );
        let slot = w
            .zone
            .iter()
            .find(|(_, e)| e.monster.as_ref().map(|m| m.display_name.as_str()) == Some("Husk"))
            .map(|(s, _)| s)
            .expect("spawned");
        assert!(
            w.zone
                .get(slot)
                .unwrap()
                .combat
                .as_ref()
                .unwrap()
                .has_strike_conditions,
            "the strike-time passive sets has_strike_conditions"
        );
        let full = w.effective_offense(slot).unwrap().damage[crate::entity::DMG_PHYS];
        // Drop to 40% life and re-read: the enrage folds.
        {
            let c = w.zone.get_mut(slot).unwrap().combat.as_mut().unwrap();
            c.life = c.life_max * 4 / 10;
        }
        let wounded = w.effective_offense(slot).unwrap().damage[crate::entity::DMG_PHYS];
        assert!(
            wounded > full,
            "below half life the husk enrages ({wounded} > {full})"
        );
    }

    #[test]
    fn elite_bulk_multiplies_life_not_damage() {
        // #125 regression guard (critic R3): elite bulk (magic/rare) multiplies LIFE
        // ONLY — magic/rare are bulkier, not harder-hitting. Damage scales with level
        // (dmg_bp) but NOT bulk (pre-#125 behavior). Mutation: apply bulk to damage in
        // monster_scaled_base → elite phys inflates 1.6x/2.6x → the damage assert fails.
        let content = content();
        let idx = content
            .monsters
            .iter()
            .position(|m| m.id == "bone_stalker")
            .expect("bone_stalker") as u32;
        let def = content.monsters[idx as usize].clone();
        assert!(
            def.passives.is_empty() && def.damage > 0,
            "bone_stalker is a bare base for this pin"
        );
        let mut w = World::new(7, &content);
        // No rolled affixes → combat stats are the scaled base alone.
        w.spawn_monster_rolled(
            idx,
            0,
            FxV2::new(Fx::from_int(5), Fx::from_int(5)),
            Rarity::Rare,
            vec![],
            "Elite".into(),
        );
        let (eff_level, c) = w
            .zone
            .iter()
            .find(|(_, e)| e.monster.as_ref().map(|m| m.display_name.as_str()) == Some("Elite"))
            .map(|(_, e)| (e.monster.as_ref().unwrap().level, e.combat.clone().unwrap()))
            .expect("spawned");
        let delta = eff_level as i64 - def.level as i64;
        let dmg_bp = (10000 + delta * 1000).max(2500);
        let life_bp = (10000 + delta * 1200).max(2500);
        let bulk = 26000; // rare
        assert_eq!(
            c.damage[crate::entity::DMG_PHYS],
            def.damage * dmg_bp / 10000,
            "elite phys damage scales by level, NOT by bulk"
        );
        assert_eq!(
            c.life_max,
            def.life * life_bp / 10000 * bulk / 10000,
            "elite life IS bulk-scaled"
        );
    }

    /// A fresh shore world with ONE multi-member non-unique pack forced
    /// to the given rarity chances (every other pack stays plain), ticked
    /// once so the pack's single spawn runs. Returns the forced pack's index.
    fn world_with_forced_pack(magic_bp: u32, rare_bp: u32) -> (World, u32) {
        let content = content();
        let mut w = World::new(7, &content);
        let pack_idx = (0..w.zone.packs.len())
            .find(|&i| {
                let p = &w.zone.packs[i];
                p.def.count >= 3 && !w.content.monsters[p.monster_idx as usize].unique
            })
            .expect("a multi-member non-unique pack exists") as u32;
        for (i, p) in w.zone.packs.iter_mut().enumerate() {
            let force = i as u32 == pack_idx;
            p.def.magic_bp = if force { magic_bp } else { 0 };
            p.def.rare_bp = if force { rare_bp } else { 0 };
        }
        w.tick(&TickInputs {
            joins: Vec::new(),
            arrivals: Vec::new(),
            removals: Vec::new(),
        });
        (w, pack_idx)
    }

    fn pack_members(w: &World, pack_idx: u32) -> Vec<&MonsterState> {
        w.zone
            .iter()
            .filter_map(|(_, e)| e.monster.as_ref())
            .filter(|m| m.pack_idx == pack_idx)
            .collect()
    }

    /// A magic roll raises the WHOLE pack magic, every member wearing the
    /// SAME affix set and name — packs roll as a group, not per member.
    #[test]
    fn magic_pack_rises_as_a_unit_with_shared_affixes() {
        let (w, pack_idx) = world_with_forced_pack(10000, 0);
        let members = pack_members(&w, pack_idx);
        assert!(members.len() >= 3, "pack should have spawned in full");
        let lead = members[0];
        assert_eq!(lead.rarity, Rarity::Magic);
        assert!(!lead.affixes.is_empty(), "magic members carry affixes");
        assert!(!lead.display_name.is_empty());
        for m in &members {
            assert_eq!(m.rarity, Rarity::Magic);
            assert_eq!(m.affixes, lead.affixes, "one shared roll per pack");
            assert_eq!(m.display_name, lead.display_name);
        }
    }

    /// A rare roll yields exactly ONE rare alongside an otherwise-normal
    /// pack — and a pack roll can never come up Unique.
    #[test]
    fn rare_roll_spawns_a_single_rare_leading_normals() {
        let (w, pack_idx) = world_with_forced_pack(0, 10000);
        let members = pack_members(&w, pack_idx);
        assert!(members.len() >= 3, "pack should have spawned in full");
        let rares = members.iter().filter(|m| m.rarity == Rarity::Rare).count();
        let normals = members
            .iter()
            .filter(|m| m.rarity == Rarity::Normal)
            .count();
        assert_eq!(rares, 1, "exactly one rare per rare pack");
        assert_eq!(normals, members.len() - 1, "the rest rise normal");
        let rare = members.iter().find(|m| m.rarity == Rarity::Rare).unwrap();
        assert!(rare.affixes.len() >= 3, "rares roll at least three affixes");
        assert!(!rare.display_name.is_empty(), "rares take a rolled name");
    }
}

#[cfg(test)]
mod area_level_tests {
    use super::*;
    use idlin_content::ContentDb;
    use std::path::Path;

    /// The coast is a level-4 area: normal mobs fight at 4 (their def
    /// baselines scale up), magic at 5, rare at 6 — and a mob's drops
    /// carry its EFFECTIVE level. The hand-designed shore (level 1)
    /// keeps every def's authored level via the max() rule.
    #[test]
    fn area_level_lifts_mobs_and_their_drops() {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut coast = World::new_for_zone(0xA12A, &content, "coast");
        coast.tick(&TickInputs::default());
        let shambler_def = content.monster_idx("drowned_shambler").unwrap();
        let base_life = content.monsters[shambler_def].life;
        let mut saw_normal = false;
        for (_, e) in coast.zone.iter() {
            let Some(m) = &e.monster else { continue };
            let def = &content.monsters[m.def_idx as usize];
            match m.rarity {
                Rarity::Normal => {
                    assert_eq!(m.level, 4, "{}: normal = area level", def.id);
                    if m.def_idx as usize == shambler_def {
                        saw_normal = true;
                        let c = e.combat.as_ref().unwrap();
                        // def level 1 -> 4: +12%/level = +36% life.
                        assert_eq!(c.life_max, base_life * 13600 / 10000);
                    }
                }
                Rarity::Magic => assert_eq!(m.level, 5, "{}: magic = area +1", def.id),
                Rarity::Rare => assert_eq!(m.level, 6, "{}: rare = area +2", def.id),
                Rarity::Unique => assert_eq!(m.level, def.level, "uniques stay authored"),
            }
        }
        assert!(saw_normal, "a normal shambler spawned");

        let mut shore = World::new_for_zone(0xA12B, &content, "withered_shore");
        shore.tick(&TickInputs::default());
        for (_, e) in shore.zone.iter() {
            let Some(m) = &e.monster else { continue };
            let def = &content.monsters[m.def_idx as usize];
            if m.rarity == Rarity::Normal {
                assert_eq!(
                    m.level, def.level,
                    "shore (area 1) keeps {}'s authored level",
                    def.id
                );
            }
        }
    }

    /// Join one halt-bot character and return its slot.
    fn join_one(w: &mut World, name: &str) -> usize {
        w.tick(&TickInputs {
            arrivals: Vec::new(),
            removals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: name.into(),
                program: idlin_botc::assemble("halt\n").unwrap(),
            }],
        });
        (0..w.zone.slot_count())
            .find(|&s| {
                w.zone
                    .get(s)
                    .is_some_and(|e| e.character.as_ref().is_some_and(|c| c.name == name))
            })
            .expect("joined character present")
    }

    fn explored_bit(w: &World, slot: usize, x: i64, y: i64) -> bool {
        let zw = w.zone.width.floor() as i64;
        let ch = w.zone.get(slot).unwrap().character.as_ref().unwrap();
        let bit = (y * zw + x) as usize;
        ch.explored[bit / 64] & (1 << (bit % 64)) != 0
    }

    #[test]
    fn explored_stamps_a_sight_disc_moves_with_the_character_and_survives_death() {
        // #129: the explore() pass stamps a FOG_SIGHT_CELLS disc around a living
        // character every tick, into a bitset sized to the zone; the stamp
        // follows position changes, and knowledge SURVIVES death. Mutations:
        // drop the explore() call from tick() → the spawn-cell assert fails;
        // stamp only at join → the moved-corner assert fails; clear explored on
        // death/respawn → the survives-death assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF06, &content);
        let slot = join_one(&mut w, "Scout");
        let (zw, zh) = (w.zone.width.floor() as i64, w.zone.height.floor() as i64);
        let e = w.zone.get(slot).unwrap();
        let (cx, cy) = (e.pos.x.floor() as i64, e.pos.y.floor() as i64);
        assert!(explored_bit(&w, slot, cx, cy), "the spawn cell is explored");
        // The farthest corner sits beyond any r=28 disc on the 60×40 shore
        // (worst case: a center spawn is 36 cells from it).
        let fx = if cx < zw / 2 { zw - 1 } else { 0 };
        let fy = if cy < zh / 2 { zh - 1 } else { 0 };
        assert!(
            !explored_bit(&w, slot, fx, fy),
            "the far corner starts unexplored"
        );
        // Teleport to the far corner; the next tick's pass stamps it.
        w.zone.get_mut(slot).unwrap().pos =
            FxV2::new(Fx::from_int(fx as i16), Fx::from_int(fy as i16));
        w.tick(&TickInputs::default());
        assert!(
            explored_bit(&w, slot, fx, fy),
            "the stamp follows the character's position"
        );
        // Death is not amnesia: kill, wait out the respawn, knowledge remains.
        w.zone.get_mut(slot).unwrap().combat.as_mut().unwrap().life = 0;
        for _ in 0..(RESPAWN_TICKS + 2) {
            w.tick(&TickInputs::default());
        }
        let slot = (0..w.zone.slot_count())
            .find(|&s| {
                w.zone
                    .get(s)
                    .is_some_and(|e| e.character.as_ref().is_some_and(|c| c.name == "Scout"))
            })
            .expect("respawned character present");
        assert!(
            explored_bit(&w, slot, fx, fy),
            "explored knowledge survives death and respawn"
        );
    }

    #[test]
    fn explored_resets_on_zone_transfer() {
        // #129: an ARRIVING character starts the new zone undiscovered — the
        // bundle's bitset is the OLD zone's knowledge and must not carry over
        // (a same-sized destination would inherit it wholesale). Mutation: drop
        // the reset in the arrival admit → the far corner reads explored.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF07, &content);
        let (zw, zh) = (w.zone.width.floor() as i64, w.zone.height.floor() as i64);
        let words = ((zw * zh + 63) / 64) as usize;
        let bundle = CharacterBundle {
            character: crate::entity::CharacterState {
                name: "Traveler".into(),
                level: 3,
                xp: 0,
                respawn_at: None,
                kills: 0,
                deaths: 0,
                items: 0,
                inventory: Vec::new(),
                equipment: Default::default(),
                allocated: Vec::new(),
                build_plan: Vec::new(),
                currency: Vec::new(),
                stash: Vec::new(),
                sockets: std::collections::BTreeMap::new(),
                // The old zone's knowledge: everything explored, same size as
                // the destination — the case the size check alone can't catch.
                explored: vec![u64::MAX; words],
                story_acts: 0,
            },
            persist: Vec::new(),
            program: idlin_botc::assemble("halt\n").unwrap(),
            params: Vec::new(),
            bot_version: 1,
            map: None,
        };
        w.tick(&TickInputs {
            joins: Vec::new(),
            arrivals: vec![bundle],
            removals: Vec::new(),
        });
        let slot = (0..w.zone.slot_count())
            .find(|&s| {
                w.zone
                    .get(s)
                    .is_some_and(|e| e.character.as_ref().is_some_and(|c| c.name == "Traveler"))
            })
            .expect("arrived character present");
        let e = w.zone.get(slot).unwrap();
        let (cx, cy) = (e.pos.x.floor() as i64, e.pos.y.floor() as i64);
        let fx = if cx < zw / 2 { zw - 1 } else { 0 };
        let fy = if cy < zh / 2 { zh - 1 } else { 0 };
        assert!(
            explored_bit(&w, slot, cx, cy),
            "the arrival's spawn disc is stamped in the new zone"
        );
        assert!(
            !explored_bit(&w, slot, fx, fy),
            "the old zone's knowledge did NOT carry over"
        );
    }

    #[test]
    fn a_story_sealed_exit_refuses_until_the_act_is_complete() {
        // #136: an exit with `requires_act: 1` returns -3 (stays put) for a
        // fresh character and works normally once story_acts bit 0 is set —
        // through the REAL UseExit syscall path. Mutations: drop the seal
        // check in bots.rs → the fresh character departs on the first tick;
        // read the wrong bit → the post-completion tick strands them.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0x5EA1, &content);
        // A bot that takes any exit underfoot, every tick.
        let slot = {
            w.tick(&TickInputs {
                arrivals: Vec::new(),
                removals: Vec::new(),
                joins: vec![crate::JoinRequest {
                    name: "Walker".into(),
                    program: idlin_botc::assemble(
                        "loop:\nsys 28 0\npush 0xF200\nstore\njmp loop\n",
                    )
                    .unwrap(),
                }],
            });
            (0..w.zone.slot_count())
                .find(|&s| {
                    w.zone
                        .get(s)
                        .is_some_and(|e| e.character.as_ref().is_some_and(|c| c.name == "Walker"))
                })
                .expect("walker joined")
        };
        // A sealed, open exit right underfoot.
        let pos = w.zone.get(slot).unwrap().pos;
        w.zone.exits.push(crate::zone::ExitState {
            pos,
            dest: "saltmere".into(),
            open: true,
            requires_act: 1,
        });
        w.tick(&TickInputs::default());
        assert!(
            w.take_departures().is_empty(),
            "the seal held: no departure without act 1"
        );
        assert!(
            w.zone.get(slot).is_some_and(|e| e.character.is_some()),
            "the walker is still here"
        );
        // The ABI itself: the walker parked UseExit's last result at 0xF200 —
        // a SEALED exit reads -3, distinctly from -2 closed / -1 none.
        let bot_idx = w.zone.get(slot).unwrap().bot.expect("walker has a bot");
        assert_eq!(
            w.bots.get_mut(bot_idx).unwrap().vm.load_i32(0xF200),
            -3,
            "a story-sealed exit returns -3 on the wire ABI"
        );
        // Complete the act; the same exit now works.
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 1;
        w.tick(&TickInputs::default());
        let departed = w.take_departures();
        assert_eq!(departed.len(), 1, "the seal lifted with the act");
        assert_eq!(departed[0].0.character.name, "Walker");
        assert_eq!(
            departed[0].0.character.story_acts, 1,
            "progress travels in the bundle"
        );
    }

    #[test]
    fn an_open_unsealed_exit_wins_over_a_sealed_neighbor() {
        // #136: with BOTH a sealed exit and an open unsealed one in reach, the
        // bot departs — success outranks -3 (the loop keeps scanning past a
        // sealed exit instead of bailing). Mutation: break on the sealed exit
        // (or fold sealed into closed) → no departure here.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0x5EA2, &content);
        w.tick(&TickInputs {
            arrivals: Vec::new(),
            removals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Walker".into(),
                program: idlin_botc::assemble("loop:\nsys 28 0\npush 0xF200\nstore\njmp loop\n")
                    .unwrap(),
            }],
        });
        let slot = (0..w.zone.slot_count())
            .find(|&s| w.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let pos = w.zone.get(slot).unwrap().pos;
        w.zone.exits.push(crate::zone::ExitState {
            pos,
            dest: "saltmere".into(),
            open: true,
            requires_act: 1, // sealed for a fresh character
        });
        w.zone.exits.push(crate::zone::ExitState {
            pos,
            dest: "saltmere".into(),
            open: true,
            requires_act: 0, // free
        });
        w.tick(&TickInputs::default());
        assert_eq!(
            w.take_departures().len(),
            1,
            "the free exit wins over its sealed neighbor"
        );
    }

    #[test]
    fn base_energy_shield_folds_from_worn_gear() {
        // #148 A2.5: the first ES bases — a worn 30-ES circlet gives exactly
        // es_max 30 to a no-INT character (attribute conversion multiplies
        // ON TOP). Mutation: drop the es_base accumulation or the
        // sheet.value(EnergyShield, base.es) seed → es_max 0.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xE5F0, &content, "saltmere");
        let slot = join_one(&mut w, "Warded");
        let circlet = content
            .items
            .iter()
            .position(|i| i.id == "tideglass_circlet")
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.level = 5;
            ch.equipment[idlin_content::GearSlot::Helm.idx()] = Some(crate::entity::Item {
                base_idx: circlet,
                rarity: Rarity::Normal,
                item_level: 5,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
                unique_idx: None,
            });
        }
        w.refresh_derived_stats(slot);
        let es = w.zone.get(slot).unwrap().combat.as_ref().unwrap().es_max;
        assert!(es >= 30, "a 30-ES base must fold into es_max; got {es}");
    }

    #[test]
    fn a_signature_unique_folds_its_fixed_mods() {
        // #136 T5: wearing Tideclaw moves the sheet exactly like gear affixes
        // — cold on the swing, faster swings — through the SAME chokepoint.
        // Mutation: drop the unique fold in progression.rs → both deltas
        // vanish and this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0x517E, &content, "saltmere");
        let slot = join_one(&mut w, "Bearer");
        let cold_before = w.effective_offense(slot).unwrap().damage[crate::entity::DMG_COLD];
        let ui = content
            .uniques
            .iter()
            .position(|u| u.id == "tideclaw")
            .unwrap() as u32;
        let tideclaw = match w.mint_unique(ui, 8) {
            crate::entity::LootPayload::Gear(item) => item,
            other => panic!("a unique mints as gear: {other:?}"),
        };
        assert_eq!(tideclaw.name, "Tideclaw");
        assert_eq!(tideclaw.rarity, Rarity::Unique);
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] = Some(tideclaw);
        }
        w.refresh_derived_stats(slot);
        let cold_after = w.effective_offense(slot).unwrap().damage[crate::entity::DMG_COLD];
        assert!(
            cold_after >= cold_before + 8,
            "the claw's cold folds ({cold_after} vs {cold_before})"
        );
        // And the sheet surfaces every fixed mod under the unique's name —
        // the inspect panel's data path (#87 stat_sources).
        let net = w.zone.get(slot).unwrap().net_id;
        let sheet = w.character_sheet(net).unwrap();
        let claw_mods: Vec<&str> = sheet
            .stat_sources
            .iter()
            .filter(|(_, src, ..)| src.starts_with("Tideclaw"))
            .map(|(stat, ..)| stat.as_str())
            .collect();
        assert!(
            claw_mods.contains(&"attack_speed") && claw_mods.contains(&"chill_chance"),
            "the claw's mods surface by name; got {claw_mods:?}"
        );
    }

    #[test]
    fn a_boss_pays_their_signature_when_the_roll_hits() {
        // #136 T5: the drop hook, end to end, with the chance forced certain
        // (drop_bp -> 10000 on the loaded db — a content probe, not a code
        // fork). Mutation: drop the unique arm in handle_kill → no unique in
        // the loot and this fails.
        let mut content = ContentDb::load(Path::new("../../content")).expect("content loads");
        for u in &mut content.uniques {
            if u.id == "tideclaw" {
                u.drop_bp = 10000;
            }
        }
        let mut w = World::new(0xD809, &content);
        let slot = join_one(&mut w, "Slayer");
        let anet = w.zone.get(slot).unwrap().net_id;
        let warden = content.monster_idx("tidewarden").unwrap() as u32;
        w.spawn_monster_rolled(
            warden,
            0,
            FxV2::new(Fx::from_int(20), Fx::from_int(20)),
            Rarity::Unique,
            vec![],
            "The Tidewarden".into(),
        );
        let mslot = w
            .zone
            .iter()
            .find(|(_, e)| {
                e.monster
                    .as_ref()
                    .is_some_and(|m| m.def_idx == warden && e.alive())
            })
            .map(|(s, _)| s)
            .unwrap();
        let mut damage = [0i64; crate::entity::DMG_COUNT];
        damage[crate::entity::DMG_PHYS] = 100_000_000;
        let spec = combat::StrikeSpec {
            attacker_slot: Some(slot),
            attacker_net: anet,
            attacker_name: "Slayer".into(),
            attacker_is_char: true,
            is_spell: true,
            is_dot: true,
            accuracy: 0,
            damage,
            crit_bp: 0,
            crit_multi: 10000,
            projectile: false,
            dot: None,
            debuff: None,
            stagger: 0,
            knockback_cu: 0,
            ailment_chance: 0,
            inherent_ailment_kind: None,
        };
        let (mut ev, mut dead, mut loot) = (Vec::new(), Vec::new(), Vec::new());
        let now = w.tick;
        w.strike(spec, mslot, now, &mut ev, &mut dead, &mut loot);
        assert!(
            loot.iter().any(|(_, payload, ..)| matches!(
                payload,
                crate::entity::LootPayload::Gear(item)
                    if item.unique_idx.is_some() && item.name == "Tideclaw"
            )),
            "the warden must pay Tideclaw at 100%"
        );
    }

    #[test]
    fn a_unique_outscores_its_bare_base() {
        // #136 T5 review (B2): item_score must SEE a unique's fixed mods —
        // without the fold, a unique scored as its bare base and equip_best
        // replaced signatures with any magic item (dead content for bots).
        // Mutation: drop the unique arm in item_score → equal scores, fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let w = World::new_for_zone(0x5C03, &content, "saltmere");
        let ui = content
            .uniques
            .iter()
            .position(|u| u.id == "tideclaw")
            .unwrap() as u32;
        let claw = match w.mint_unique(ui, 8) {
            crate::entity::LootPayload::Gear(item) => item,
            _ => unreachable!(),
        };
        let mut bare = claw.clone();
        bare.unique_idx = None;
        bare.rarity = Rarity::Normal;
        assert!(
            w.item_score(&claw) > w.item_score(&bare),
            "the claw's mods must count ({} vs {})",
            w.item_score(&claw),
            w.item_score(&bare)
        );
    }

    #[test]
    fn state_hash_fingerprints_unique_identity() {
        // #136 T5: two otherwise-identical worn items differing only in
        // unique_idx must hash apart — identity is state. Mutation: drop the
        // unique_idx write in views.rs → identical digests.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xF1D0, &content, "saltmere");
        let slot = join_one(&mut w, "Twin");
        let ui = content
            .uniques
            .iter()
            .position(|u| u.id == "tideclaw")
            .unwrap() as u32;
        let item = match w.mint_unique(ui, 8) {
            crate::entity::LootPayload::Gear(item) => item,
            _ => unreachable!(),
        };
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] = Some(item);
        }
        let h1 = w.state_hash();
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .equipment[idlin_content::GearSlot::Weapon.idx()]
        .as_mut()
        .unwrap()
        .unique_idx = None;
        assert_ne!(h1, w.state_hash(), "unique identity must move the digest");
    }

    #[test]
    fn hostility_reaches_the_view_faithfully() {
        // PROTO 45 (codex round 2): the ember gates on the wire's hostile
        // flag — a villager must arrive false, a shambler true. Mutation:
        // hardcode EntityView.hostile (either way) → one side fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0x4057, &content, "saltmere");
        w.tick(&TickInputs::default());
        let vs = w.views();
        let villager = vs
            .iter()
            .find(|v| v.kind == 2 && v.name.contains("Survivor"))
            .expect("saltmere has villagers");
        assert!(!villager.hostile, "a villager NPC must not read hostile");
        let mut shore = World::new_for_zone(0x4058, &content, "withered_shore");
        shore.tick(&TickInputs::default());
        let hostile = shore.views().iter().any(|v| v.kind == 2 && v.hostile);
        assert!(hostile, "the shore's monsters read hostile");
    }

    #[test]
    fn a_combat_death_counts_on_the_ledger() {
        // #148 A6 review (B1): the leaderboard's honesty column must be
        // mutation-proof — kill a character through the REAL strike path
        // and read deaths back. Mutation: revert the handle-kill
        // `ch.deaths += 1` → this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xDEAD, &content);
        let slot = join_one(&mut w, "Ledger");
        let mut damage = [0i64; crate::entity::DMG_COUNT];
        damage[crate::entity::DMG_PHYS] = 1_000_000;
        let spec = combat::StrikeSpec {
            attacker_slot: None,
            attacker_net: 0,
            attacker_name: "The Test".into(),
            attacker_is_char: false,
            is_spell: false,
            is_dot: true, // skip accuracy/crit rng — a guaranteed lethal hit
            accuracy: 0,
            damage,
            crit_bp: 0,
            crit_multi: 10000,
            projectile: false,
            dot: None,
            debuff: None,
            stagger: 0,
            knockback_cu: 0,
            ailment_chance: 0,
            inherent_ailment_kind: None,
        };
        let (mut ev, mut dd, mut ll) = (Vec::new(), Vec::new(), Vec::new());
        let now = w.tick;
        w.strike(spec, slot, now, &mut ev, &mut dd, &mut ll);
        let ch = w.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.deaths, 1, "the combat death must be counted");
    }

    #[test]
    fn a_life_cost_death_counts_on_the_ledger() {
        // The OTHER death site (#148 A6 review B1): a skill's life cost
        // can self-kill through pay_life_cost. Mutation: revert its
        // `ch.deaths += 1` → this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xDEAE, &content);
        let slot = join_one(&mut w, "Spent");
        let life = w.zone.get(slot).unwrap().combat.as_ref().unwrap().life;
        let mut ev = Vec::new();
        let now = w.tick;
        w.pay_life_cost(slot, life + 1, now, &mut ev);
        let ch = w.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.deaths, 1, "the life-cost death must be counted");
    }

    #[test]
    fn a_wand_implicit_scales_spell_damage() {
        // Quality pass: spells never read weapon damage, so the wand ladder
        // fed the caster NOTHING until the implicit existed. A worn wand
        // with spell_damage_bp must lift a resolved spell hit by exactly
        // its factor. Mutation: drop the is_spell scaling in resolve_skill
        // (or the implicit fold in the derive) → equal damage, this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0x57E1, &content);
        let slot = join_one(&mut w, "Wanded");
        let nova = content
            .gems
            .iter()
            .position(|g| g.id == "frost_nova")
            .unwrap() as u32;
        let wand = content
            .items
            .iter()
            .position(|i| i.id == "sovereign_scepter")
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.level = 10;
            ch.allocated = vec![0];
            ch.sockets.insert(
                0,
                crate::entity::SocketedGem {
                    gem: crate::entity::GemInstance {
                        gem_idx: nova,
                        level: 5,
                        xp: 0,
                    },
                    supports: Vec::new(),
                    cooldown_left: 0,
                },
            );
        }
        w.refresh_derived_stats(slot);
        let bare = w
            .resolve_skill(slot, 0)
            .expect("nova resolves")
            .spec_template
            .damage;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] = Some(crate::entity::Item {
                base_idx: wand,
                rarity: Rarity::Normal,
                item_level: 10,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
                unique_idx: None,
            });
        }
        w.refresh_derived_stats(slot);
        let armed = w
            .resolve_skill(slot, 0)
            .expect("nova resolves")
            .spec_template
            .damage;
        let (b, a) = (
            bare[crate::entity::DMG_COLD],
            armed[crate::entity::DMG_COLD],
        );
        assert_eq!(
            a,
            b * 23000 / 10000,
            "the scepter's +130% implicit must scale the nova ({b} -> {a})"
        );
    }

    #[test]
    fn query_monsters_contract_records_caps_and_refusals() {
        // #162 review: the syscall's own contract, not just its use in the
        // Sovereign's stage direction. A probe brain calls it three ways:
        //   0xE800: max 16 → count + first record's fields
        //   0xE980: max 2  → the cap holds
        //   0xE9C0: max -5 → clamps to 0, writes nothing, returns 0
        //   0xEC00: max 64 → MORE than 16 records land (the density-tuned
        //           saltworks holds 39 monsters; revert the engine clamp to
        //           16 and this reads exactly 16 — the raised cap is pinned)
        // Mutation: swap the MON_X/MON_Y writes, drop the clamp, or break
        // record layout → the field asserts fail.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0x9E57, &content, "saltworks");
        let probe = idlin_botc::compile_deployed(
            "fn main() {\n\
             mem[0xEA00] = query_monsters(0xE800, 16);\n\
             mem[0xEA04] = query_monsters(0xE980, 2);\n\
             mem[0xEA08] = query_monsters(0xE9C0, 0 - 5);\n\
             mem[0xEA0C] = query_monsters(0xEC00, 64);\n\
             }\n",
        )
        .unwrap();
        w.test_install_zone_brain(probe);
        w.tick(&TickInputs::default());
        let n = w.test_zone_brain_word(0xEA00).unwrap();
        assert!(n > 0 && n <= 16, "live monsters reported: {n}");
        let capped = w.test_zone_brain_word(0xEA04).unwrap();
        assert_eq!(capped, 2, "the max cap holds");
        assert_eq!(
            w.test_zone_brain_word(0xEA08).unwrap(),
            0,
            "negative max clamps to zero"
        );
        let wide = w.test_zone_brain_word(0xEA0C).unwrap();
        assert!(
            wide > 16 && wide <= 64,
            "a max-64 query reports past the old 16 cap (density blinded boss \
             brains): {wide}"
        );
        // First record: a real monster num, sane life, in-bounds position.
        let num = w.test_zone_brain_word(0xE800 + 4).unwrap();
        assert!(
            w.content_idx(num).is_some(),
            "record num resolves in the registry: {num}"
        );
        let life = w.test_zone_brain_word(0xE800 + 8).unwrap();
        assert!((1..=100).contains(&life), "life_pct sane: {life}");
        let x = w.test_zone_brain_word(0xE800 + 12).unwrap();
        let y = w.test_zone_brain_word(0xE800 + 16).unwrap();
        assert!(x > 0 && y > 0, "position is Q16.16 in-bounds ({x},{y})");
        let rarity = w.test_zone_brain_word(0xE800 + 20).unwrap();
        assert!((0..=3).contains(&rarity), "rarity in the ladder: {rarity}");
        // ENTITY bots must NOT get this syscall (zone-brain only): the
        // dispatch in bots.rs has no arm for 109 → unknown syscall.
        let mut w2 = World::new(0x9E58, &content);
        let bot = idlin_botc::compile_deployed(
            "fn main() {\n mem[0xEA00] = query_monsters(0xE800, 16);\n }\n",
        );
        // The builtin exists language-wide; the ENTITY dispatch refuses it.
        let program = bot.unwrap();
        let slot = {
            let ev = w2.tick(&TickInputs {
                joins: vec![JoinRequest {
                    name: "Probe".into(),
                    program,
                }],
                arrivals: Vec::new(),
                removals: Vec::new(),
            });
            let _ = ev;
            0
        };
        let _ = slot;
        w2.tick(&TickInputs::default());
        let refused = w2
            .zone
            .iter()
            .find(|(_, e)| e.character.is_some())
            .and_then(|(_, e)| e.bot)
            .and_then(|bi| w2.bots.get(bi))
            .map(|b| b.vm.load_i32(0xEA00));
        assert_eq!(
            refused,
            Some(-1),
            "an entity bot's query_monsters must refuse (-1), not see the zone"
        );
    }

    #[test]
    fn the_kill_switch_removes_a_character_cleanly() {
        // #148 A6: a removal despawns the entity + its bot and announces
        // it; unknown names are harmless. Mutation: drop process_removals
        // from tick → the character survives and this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xA6, &content);
        let _ = join_one(&mut w, "Runaway");
        let inputs = TickInputs {
            joins: Vec::new(),
            arrivals: Vec::new(),
            removals: vec!["Runaway".into(), "Nobody".into()],
        };
        let events = w.tick(&inputs);
        assert!(
            events
                .iter()
                .any(|e| matches!(e, SimEvent::CharacterRemoved { name, .. } if name == "Runaway")),
            "the removal announces itself"
        );
        assert!(
            !w.views().iter().any(|v| v.kind == 1),
            "the character is gone"
        );
        // The next tick is business as usual — no dangling bot panics.
        w.tick(&TickInputs::default());
    }

    #[test]
    fn the_vendor_pays_the_right_obol_and_guards_its_reach() {
        // #148 A5: sell contract — rarity keys the obol; reach and bad
        // selections refuse without consuming. Mutation: drop the reach
        // check → the far-away sell succeeds; drop the rarity match → the
        // wrong obol pays.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xA5, &content, "saltmere");
        let slot = join_one(&mut w, "Seller");
        let cleaver = content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(crate::entity::Item {
                    base_idx: cleaver,
                    rarity: Rarity::Rare,
                    item_level: 5,
                    affixes: Vec::new(),
                    name: "Doomcleaver".into(),
                    charges: 0,
                    unique_idx: None,
                }),
                x: 0,
                y: 0,
            });
        }
        let mut ev = Vec::new();
        // Far from the vendor: refused, nothing consumed.
        assert_eq!(w.sell(slot, 0, &mut ev), -2, "reach guards the vendor");
        let n_before = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len();
        assert_eq!(n_before, 1, "refusal consumes nothing");
        // At the vendor: a RARE pays exactly one alchemy obol.
        let (vx, vy) = w.vendor.unwrap();
        w.test_teleport(w.zone.get(slot).unwrap().net_id, vx as i16, vy as i16);
        let paid = w.sell(slot, 0, &mut ev);
        let alch = content
            .currency
            .iter()
            .position(|c| c.id == "alchemy_obol")
            .unwrap();
        assert_eq!(
            paid,
            w.content_num(idlin_content::ids::Category::Currency, alch),
            "a rare pays alchemy"
        );
        let ch = w.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.inventory.len(), 0, "the item is gone");
        assert_eq!(ch.currency[alch], 1, "the obol landed");
        // Bad selection on the emptied bag.
        assert_eq!(w.sell(slot, 0, &mut ev), -1);
        assert_eq!(w.sell(slot, -7, &mut ev), -1);
    }

    #[test]
    fn the_stash_roundtrips_an_affixed_item_intact() {
        // #148 A5: deposit → withdraw returns the SAME item — affixes,
        // rarity, name. Mutation: drop the stash push or the withdraw
        // remove → the roundtrip loses the item.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xA5A, &content, "saltmere");
        let slot = join_one(&mut w, "Keeper");
        let cleaver = content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(crate::entity::Item {
                    base_idx: cleaver,
                    rarity: Rarity::Magic,
                    item_level: 7,
                    affixes: vec![crate::entity::RolledAffix {
                        affix_idx: 0,
                        tier: 0,
                        values: vec![7],
                    }],
                    name: "Keepsake".into(),
                    charges: 0,
                    unique_idx: None,
                }),
                x: 0,
                y: 0,
            });
        }
        let (sx, sy) = w.stash_cell.unwrap();
        w.test_teleport(w.zone.get(slot).unwrap().net_id, sx as i16, sy as i16);
        assert_eq!(w.stash_op(slot, 0, 0), 1, "deposit lands");
        {
            let ch = w.zone.get(slot).unwrap().character.as_ref().unwrap();
            assert_eq!(ch.inventory.len(), 0);
            assert_eq!(ch.stash.len(), 1);
        }
        assert_eq!(w.stash_op(slot, 1, 0), 1, "withdraw lands");
        let ch = w.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.stash.len(), 0);
        let crate::entity::BagItem::Gear(it) = &ch.inventory[0].item else {
            panic!("gear came back");
        };
        assert_eq!(it.name, "Keepsake");
        assert_eq!(it.rarity, Rarity::Magic);
        assert_eq!(it.affixes.len(), 1, "the affix survived the chest");
        assert_eq!(it.affixes[0].values, vec![7]);
        // Bad ops refuse cleanly.
        assert_eq!(w.stash_op(slot, 2, 0), -1, "unknown op");
        assert_eq!(w.stash_op(slot, 1, 5), -1, "empty chest withdraw");
    }

    #[test]
    fn open_map_gates_consumes_and_stages_the_run() {
        // #136 T4: the full syscall contract at Saltmere's real device —
        // -3 mid-campaign, -2 away from the device, -1 for a non-map,
        // 0 = the map is consumed and the ticket (tier from ilvl, juice
        // from the ROLLED affixes) rides pending_exits. Mutations: drop the
        // act gate, the reach check, the consume, or the juice mapping →
        // the matching assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xC4A7, &content, "saltmere");
        let slot = join_one(&mut w, "Runner");
        let map_base = content
            .items
            .iter()
            .position(|d| d.map_tier.is_some())
            .expect("a map base ships") as u32;
        let plenty = content
            .affixes
            .iter()
            .position(|a| a.id == "of_plenty")
            .unwrap() as u32;
        let shoals = content
            .affixes
            .iter()
            .position(|a| a.id == "of_shoals")
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(crate::entity::Item {
                    base_idx: map_base,
                    rarity: Rarity::Magic,
                    item_level: 14, // base tier 1 + 2 over the act's end = 3
                    affixes: vec![
                        crate::entity::RolledAffix {
                            affix_idx: plenty,
                            values: vec![2000],
                            tier: 0,
                        },
                        crate::entity::RolledAffix {
                            affix_idx: shoals,
                            values: vec![1800],
                            tier: 0,
                        },
                    ],
                    name: "Test Map".into(),
                    charges: 0,
                    unique_idx: None,
                }),
                x: 0,
                y: 0,
            });
        }
        let inv_idx = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len() as i32
            - 1;
        // Mid-campaign: the sea is sealed.
        assert_eq!(w.open_map(slot, inv_idx), -3);
        // Act 1 alone no longer buys the sea (#148 retro): the gate is the
        // content-derived FINAL act. Mutation: revert open_map to the
        // `story_acts & 1` check → this -3 becomes a depart and fails.
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 1;
        assert_eq!(w.open_map(slot, inv_idx), -3);
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 3; // the WHOLE campaign (final_act-derived gate, #148 retro)
        // Away from the device (the spawn is out of reach of (26,46)).
        assert_eq!(w.open_map(slot, inv_idx), -2);
        let table = w.map_device.expect("saltmere has the device");
        w.zone.get_mut(slot).unwrap().pos =
            FxV2::new(Fx::from_int(table.0 as i16), Fx::from_int(table.1 as i16));
        // A non-map index refuses.
        assert_eq!(w.open_map(slot, 999), -1);
        // The map.
        let bag_before = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len();
        assert_eq!(w.open_map(slot, inv_idx), 0);
        let bag_after = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len();
        assert_eq!(bag_after, bag_before - 1, "the map is spent");
        let (_, dest, ticket) = w.pending_exits.last().expect("the depart is staged");
        assert_eq!(dest, "charted_shallows");
        let t = ticket.expect("a map depart carries its ticket");
        assert_eq!(t.tier, 3, "tier 1 base + ilvl 14 - 12");
        assert_eq!(t.quantity_bp, 2000, "of_plenty's roll pays quantity");
        assert_eq!(t.rarity_bp, 1800, "of_shoals' roll pays rarity");
    }

    #[test]
    fn a_rolled_deluge_clock_rides_the_ticket() {
        // #178 (codex): the MapClock arm in open_map was the ONLY
        // untested juice mapping — mutate it to a no-op and every clock
        // test still passed (the direct-ticket tests bypass open_map).
        // Before the operator killed the default clock, a real Deluge map
        // would have silently departed on the then-6000 default instead
        // of its rolled duration. Mutation: drop the MapClock match arm →
        // the clock assert sees 0, fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xDE1, &content, "saltmere");
        let slot = join_one(&mut w, "Belled");
        let map_base = content
            .items
            .iter()
            .position(|d| d.map_tier.is_some())
            .expect("a map base ships") as u32;
        let deluge = content
            .affixes
            .iter()
            .position(|a| a.id == "of_the_deluge")
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.story_acts = 3; // the WHOLE campaign
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(crate::entity::Item {
                    base_idx: map_base,
                    rarity: Rarity::Magic,
                    item_level: 14,
                    affixes: vec![crate::entity::RolledAffix {
                        affix_idx: deluge,
                        values: vec![7500],
                        tier: 0,
                    }],
                    name: "Deluge Map".into(),
                    charges: 0,
                    unique_idx: None,
                }),
                x: 0,
                y: 0,
            });
        }
        let table = w.map_device.expect("saltmere has the device");
        w.zone.get_mut(slot).unwrap().pos =
            FxV2::new(Fx::from_int(table.0 as i16), Fx::from_int(table.1 as i16));
        let inv_idx = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len() as i32
            - 1;
        assert_eq!(w.open_map(slot, inv_idx), 0);
        let (_, _, ticket) = w.pending_exits.last().expect("the depart is staged");
        let t = ticket.expect("a map depart carries its ticket");
        assert_eq!(t.clock, 7500, "the rolled Deluge duration rides the ticket");
        // And the minted world honors the ROLL, not the default.
        let minted = World::new_map_instance(0xDE1, &content, "charted_shallows", t);
        assert_eq!(minted.map_ends_at, 7500, "the roll beats the default");
    }

    #[test]
    fn a_staged_departure_never_eats_the_map() {
        // #136 T4 (critic's same-tick trap): with ANY departure already
        // pending — an exit taken earlier this tick, or a previous map —
        // OpenMap must refuse (-5) WITHOUT consuming. The original code
        // consumed first and guarded second: the map vanished, no map,
        // return said success. Mutation: reorder consume before the guard →
        // the bag_after assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xEA7, &content, "saltmere");
        let slot = join_one(&mut w, "Hasty");
        let map_base = content
            .items
            .iter()
            .position(|d| d.map_tier.is_some())
            .unwrap() as u32;
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.story_acts = 3; // the WHOLE campaign (final_act-derived gate, #148 retro)
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(crate::entity::Item {
                    base_idx: map_base,
                    rarity: Rarity::Normal,
                    item_level: 13,
                    affixes: Vec::new(),
                    name: String::new(),
                    charges: 0,
                    unique_idx: None,
                }),
                x: 0,
                y: 0,
            });
        }
        let table = w.map_device.unwrap();
        let net = w.zone.get(slot).unwrap().net_id;
        w.zone.get_mut(slot).unwrap().pos =
            FxV2::new(Fx::from_int(table.0 as i16), Fx::from_int(table.1 as i16));
        // An exit is already staged this tick (as if UseExit ran first).
        w.pending_exits.push((net, "coast".into(), None));
        let inv_idx = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len() as i32
            - 1;
        let bag_before = inv_idx + 1;
        assert_eq!(w.open_map(slot, inv_idx), -5, "refuse, don't lie");
        let bag_after = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len() as i32;
        assert_eq!(bag_after, bag_before, "the map survives the refusal");
        assert_eq!(w.pending_exits.len(), 1, "no second departure was staged");
    }

    #[test]
    fn map_rules_ride_the_ticket_and_shape_the_run() {
        // #148 A4: the three RULES — fury folds into every monster's damage,
        // the clock arms the expiry, the mark spawns the Unwritten at the
        // far end at Unique rarity. Mutation: drop any application in
        // new_map_instance (or the fury fold in the monster derive) →
        // its assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let plain = World::new_map_instance(
            0x41,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 4,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 0,
                clock: 0,
                boss: false,
            },
        );
        let mut ruled = World::new_map_instance(
            0x41,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 4,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 3000,
                clock: 6000,
                boss: true,
            },
        );
        assert_eq!(ruled.map_ends_at, 6000, "the clock arms");
        assert_eq!(ruled.monster_fury_bp, 3000, "the fury dial sets");
        let empty = TickInputs::default();
        ruled.tick(&empty);
        let vs = ruled.views();
        let boss: Vec<_> = vs
            .iter()
            .filter(|v| v.rarity == 3 && v.name == "The Unwritten")
            .collect();
        assert_eq!(boss.len(), 1, "the mark spawns the tier boss");
        // Fury scales at the STRIKE chokepoint (spells included — the boss's
        // own kit was fury-blind when the fold lived in the derive tail):
        // the SAME synthetic hit from a monster lands harder in the ruled
        // map. Mutation: drop the strike() fold → equal damage, fails.
        let mut plain = plain;
        plain.tick(&empty);
        let hit_for = |w: &mut World| {
            let victim = join_one(w, "Struck");
            let mslot = w
                .zone
                .iter()
                .find(|(_, e)| e.monster.is_some() && e.alive())
                .map(|(s, _)| s)
                .unwrap();
            let before = w.zone.get(victim).unwrap().combat.as_ref().unwrap().life;
            let mut damage = [0i64; crate::entity::DMG_COUNT];
            damage[crate::entity::DMG_PHYS] = 40;
            let spec = combat::StrikeSpec {
                attacker_slot: Some(mslot),
                attacker_net: w.zone.get(mslot).unwrap().net_id,
                attacker_name: "Wight".into(),
                attacker_is_char: false,
                is_spell: true,
                is_dot: true, // dots skip accuracy/crit rng: a pure fury delta
                accuracy: 0,
                damage,
                crit_bp: 0,
                crit_multi: 10000,
                projectile: false,
                dot: None,
                debuff: None,
                stagger: 0,
                knockback_cu: 0,
                ailment_chance: 0,
                inherent_ailment_kind: None,
            };
            let (mut ev, mut dd, mut ll) = (Vec::new(), Vec::new(), Vec::new());
            let now = w.tick;
            w.strike(spec, victim, now, &mut ev, &mut dd, &mut ll);
            before - w.zone.get(victim).unwrap().combat.as_ref().unwrap().life
        };
        let base = hit_for(&mut plain);
        let furied = hit_for(&mut ruled);
        assert!(
            furied > base,
            "fury must lift the SAME hit ({furied} vs {base})"
        );
    }

    #[test]
    fn state_hash_fingerprints_the_map_rules() {
        // #178: by state_hash's own bar (same hash => same future), the
        // map rules are replay-relevant — two worlds differing only in
        // the map clock ferry everyone home at different ticks; fury
        // steers every strike. Mutation: drop the #178 folds → identical
        // hashes, fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF0B, &content);
        let h1 = w.state_hash();
        w.map_ends_at = 4242;
        let h2 = w.state_hash();
        assert_ne!(h1, h2, "the map clock must move the digest");
        w.monster_fury_bp = 2500;
        assert_ne!(h2, w.state_hash(), "the fury dial must move the digest");
        // The rarity juice is a WORLD SCALAR (B4): spawn_rarity_bp folds
        // into the digest, so two same-seed maps differing only in
        // rarity_bp hash apart. Mutation: drop the spawn_rarity_bp fold
        // from state_hash → equal digests, fails.
        let ticket = |rarity_bp: i64| MapTicket {
            tier: 2,
            rarity_bp,
            quantity_bp: 0,
            fury_bp: 0,
            clock: 0,
            boss: false,
        };
        let plain = World::new_map_instance(0xF0C, &content, "charted_shallows", ticket(0));
        let juiced = World::new_map_instance(0xF0C, &content, "charted_shallows", ticket(1500));
        assert_ne!(
            plain.state_hash(),
            juiced.state_hash(),
            "the instance rarity juice (spawn_rarity_bp, B4) must move the digest"
        );
    }

    #[test]
    fn the_dead_stay_dead() {
        // Operator ruling: monsters NEVER resurrect — anywhere. Finite
        // content IS the progression pressure: a cleared zone stays
        // cleared, a cleared map is DONE (that is what ends a run), and
        // camping one spot pays nothing. Mutation: restore the respawn
        // arm (risen=false on wipe, or spawn when risen) → the pack
        // refills after its old timer and the zero assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xDEAD, &content);
        let empty = TickInputs::default();
        w.tick(&empty); // packs rise once
        let before: u32 = w.zone.packs.iter().map(|p| p.alive).sum();
        assert!(before > 0, "the packs rose");
        // Kill every monster outright (test seam: massive dot strikes).
        let mut damage = [0i64; crate::entity::DMG_COUNT];
        damage[crate::entity::DMG_PHYS] = 50_000_000;
        let slots: Vec<usize> = w
            .zone
            .iter()
            .filter(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(s, _)| s)
            .collect();
        for slot in slots {
            let spec = combat::StrikeSpec {
                attacker_slot: None,
                attacker_net: 0,
                attacker_name: "TheEnd".into(),
                attacker_is_char: true,
                is_spell: false,
                is_dot: true,
                accuracy: 0,
                damage,
                crit_bp: 0,
                crit_multi: 10000,
                projectile: false,
                dot: None,
                debuff: None,
                stagger: 0,
                knockback_cu: 0,
                ailment_chance: 0,
                inherent_ailment_kind: None,
            };
            let (mut ev, mut dd, mut ll) = (Vec::new(), Vec::new(), Vec::new());
            let now = w.tick;
            w.strike(spec, slot, now, &mut ev, &mut dd, &mut ll);
        }
        assert_eq!(
            w.zone.packs.iter().map(|p| p.alive).sum::<u32>(),
            0,
            "the cull landed"
        );
        // Tick FAR past any historical respawn timer: nothing rises.
        for _ in 0..2_000 {
            w.tick(&empty);
        }
        let living = w
            .zone
            .iter()
            .filter(|(_, e)| e.monster.is_some() && e.alive())
            .count();
        assert_eq!(living, 0, "the dead stay dead — no respawns, anywhere");
    }

    #[test]
    fn a_clockless_map_never_ends_on_its_own() {
        // Operator ruling (#185): with no respawns a map ends by being
        // CLEARED — no timer may boot a working idler. Only a rolled
        // Deluge clock arms map_ends_at. Mutation: restore the default
        // arm → nonzero, fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let w = World::new_map_instance(
            0x185,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 1,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 0,
                clock: 0,
                boss: false,
            },
        );
        assert_eq!(w.map_ends_at, 0, "no rolled clock = no clock, ever");
    }

    #[test]
    fn the_rarity_juice_reaches_the_spawn_roll() {
        // B4's decisive consumption test (codex: storing + hashing the
        // property proves nothing about the ROLL). With juice 9999 the
        // roll window (0..10000) is fully covered by magic+rare bounds —
        // EVERY non-unique pack must spawn magic-or-better; the plain
        // twin at base bps must keep at least one normal pack. Mutation:
        // drop the juice fold at the roll site → the juiced world spawns
        // normals and the zero assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let ticket = |rarity_bp: i64| MapTicket {
            tier: 2,
            rarity_bp,
            quantity_bp: 0,
            fury_bp: 0,
            clock: 0,
            boss: false,
        };
        let empty = TickInputs::default();
        // The roll is PER PACK: a rare roll = one rare LEADING normals, so
        // the census must judge packs, not members.
        let spawn_census = |rarity_bp: i64| {
            let mut w =
                World::new_map_instance(0xB4, &content, "charted_shallows", ticket(rarity_bp));
            w.tick(&empty); // packs spawn on the first tick
            let n_packs = w.zone.packs.len();
            let mut pack_hit = vec![false; n_packs];
            for (_, e) in w.zone.iter() {
                if let Some(m) = &e.monster
                    && m.rarity != Rarity::Normal
                {
                    pack_hit[m.pack_idx as usize] = true;
                }
            }
            let juiced_packs = pack_hit.iter().filter(|h| **h).count();
            (juiced_packs, n_packs, w)
        };
        let (plain_juiced, n_packs, _) = spawn_census(0);
        assert!(plain_juiced < n_packs, "base bps leave fully-normal packs");
        let (all_juiced, n2, w) = spawn_census(9999);
        assert_eq!(
            all_juiced, n2,
            "juice 9999 covers the whole roll window: every pack magic-or-better"
        );
        // And the defs behind those rolls are still pristine content.
        let base = World::new_for_zone(0xB4, &content, "charted_shallows");
        for (j, b) in w.zone.packs.iter().zip(base.zone.packs.iter()) {
            assert_eq!(j.def.magic_bp, b.def.magic_bp, "defs are immutable");
            assert_eq!(j.def.rare_bp, b.def.rare_bp, "defs are immutable");
        }
    }

    #[test]
    fn the_map_tally_settles_on_departure() {
        // #148 A7: the scoreboard is the DELTA between arrival marks and
        // departure state — kills earned inside the map count, the
        // career total doesn't leak in. Mutation: drop the arrival stamp
        // or the departure emit → no tally / wrong kills, this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_map_instance(
            0xA7,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 1,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 0,
                clock: 30,
                boss: false,
            },
        );
        let slot = join_one(&mut w, "Talleyrand");
        {
            // A career behind them: 100 kills BEFORE the map.
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.kills = 100;
        }
        // This test drives the DEPARTURE/delta half through a manual stamp
        // (join_one lands via joins); the ARRIVAL stamp — the production
        // path — is pinned by the arrivals-path test below.
        let net = w.zone.get(slot).unwrap().net_id;
        w.map_marks.insert(net, (100, 0, 0, w.tick));
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.kills = 102;
        }
        let empty = TickInputs::default();
        let mut tally = None;
        for _ in 0..60 {
            for ev in w.tick(&empty) {
                if let SimEvent::MapTally { kills, name, .. } = ev {
                    tally = Some((name, kills));
                }
            }
            let _ = w.take_departures();
        }
        let (name, kills) = tally.expect("the clock departure settles a tally");
        assert_eq!(name, "Talleyrand");
        assert_eq!(kills, 2, "only the map's kills count");
    }

    #[test]
    fn a_real_arrival_stamps_the_map_marks() {
        // #148 A7 review (B2): the ARRIVAL stamp is the only wiring between
        // the tally and real gameplay (transfers land via arrivals) — the
        // critic proved it was untested by reverting it under a green
        // suite. Mutation: drop the stamp block in apply_joins → no mark,
        // no tally, this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut source = World::new(0xA7B, &content);
        let slot = join_one(&mut source, "Ferried");
        {
            let ch = source
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.kills = 50;
        }
        let net = source.zone.get(slot).unwrap().net_id;
        source
            .pending_exits
            .push((net, "charted_shallows".into(), None));
        let mut ev = Vec::new();
        source.process_exits(&mut ev);
        let (bundle, _dest) = source.take_departures().pop().expect("departed");

        let mut map = World::new_map_instance(
            0xA7C,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 1,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 0,
                clock: 0,
                boss: false,
            },
        );
        let inputs = TickInputs {
            joins: Vec::new(),
            arrivals: vec![bundle],
            removals: Vec::new(),
        };
        map.tick(&inputs);
        let vnet = map
            .views()
            .iter()
            .find(|v| v.kind == 1)
            .map(|v| v.id)
            .unwrap();
        let mark = map.map_marks.get(&vnet).copied();
        assert_eq!(
            mark.map(|(k, ..)| k),
            Some(50),
            "the arrival stamps the career kills as the map baseline"
        );
    }

    #[test]
    fn the_map_clock_ferries_everyone_home() {
        // #148 A4: at expiry every character departs to Lanternfall as an
        // ordinary bundle — nothing carried is lost. Mutation: drop the
        // map_clock call from tick → no departure, this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_map_instance(
            0x42,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 1,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 0,
                clock: 20,
                boss: false,
            },
        );
        let _ = join_one(&mut w, "Timed");
        let empty = TickInputs::default();
        let mut departed = Vec::new();
        for _ in 0..40 {
            w.tick(&empty);
            departed.extend(w.take_departures());
        }
        assert_eq!(departed.len(), 1, "the clock ferries the runner out");
        let (bundle, dest) = &departed[0];
        assert_eq!(dest, "lanternfall");
        assert_eq!(bundle.character.name, "Timed");
    }

    #[test]
    fn a_map_instance_lifts_level_and_juice() {
        // #136 T4: the ticket becomes a world — area level 12 + tier, pack
        // rarity juiced, drop quantity juiced, and the instance marked
        // ephemeral. Mutation: drop any application in new_map_instance →
        // the matching assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let plain = World::new_for_zone(0x11, &content, "charted_shallows");
        let w = World::new_map_instance(
            0x11,
            &content,
            "charted_shallows",
            MapTicket {
                tier: 3,
                rarity_bp: 2100,
                quantity_bp: 1500,
                fury_bp: 0,
                clock: 0,
                boss: false,
            },
        );
        assert_eq!(w.zone_level(), 15);
        assert!(w.is_map_instance() && !plain.is_map_instance());
        assert_eq!(w.loot_quantity_bp, 1500);
        // B4: the juice is an instance property; defs stay UNTOUCHED.
        assert_eq!(w.spawn_rarity_bp, 2100);
        for (juiced, base) in w.zone.packs.iter().zip(plain.zone.packs.iter()) {
            assert_eq!(juiced.def.magic_bp, base.def.magic_bp, "defs are immutable");
            assert_eq!(juiced.def.rare_bp, base.def.rare_bp, "defs are immutable");
        }
    }

    #[test]
    fn maps_are_cargo_not_gear() {
        // #136 T4: a map can never be worn — the manual path refuses and
        // the auto path scores it below any real item. Mutation: drop either
        // guard in inventory.rs → the matching assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new_for_zone(0xCA60, &content, "saltmere");
        let slot = join_one(&mut w, "Porter");
        let map_base = content
            .items
            .iter()
            .position(|d| d.map_tier.is_some())
            .unwrap() as u32;
        let map = crate::entity::Item {
            base_idx: map_base,
            rarity: Rarity::Normal,
            item_level: 13,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
            unique_idx: None,
        };
        assert_eq!(w.item_score(&map), 0, "autos skip cargo");
        {
            let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(map),
                x: 4,
                y: 0,
            });
        }
        let idx = w
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len() as i32
            - 1;
        let mut ev = Vec::new();
        assert_eq!(w.equip(slot, idx, &mut ev), -1, "manual equip refuses");
    }

    #[test]
    fn the_mothers_fall_completes_act_1_with_real_content() {
        // #136 T3: the ACTUAL act boss — spawned from her shipped def — sets
        // the killer's act bit through the real kill path. Mutation: strip
        // act_boss from mother_of_the_drowned.ron (or point it at another
        // monster) → this fails. (Once-only/trash rules are pinned in
        // combat.rs with a synthetic boss; this pins the CONTENT.)
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xAC71, &content);
        let slot = join_one(&mut w, "Breaker");
        let anet = w.zone.get(slot).unwrap().net_id;
        let mother = content.monster_idx("mother_of_the_drowned").unwrap() as u32;
        w.spawn_monster_rolled(
            mother,
            0,
            FxV2::new(Fx::from_int(20), Fx::from_int(20)),
            Rarity::Unique,
            vec![],
            "Mother of the Drowned".into(),
        );
        let mslot = w
            .zone
            .iter()
            .find(|(_, e)| {
                e.monster
                    .as_ref()
                    .is_some_and(|m| m.def_idx == mother && e.alive())
            })
            .map(|(s, _)| s)
            .unwrap();
        // A deterministic, certain kill through the real strike path (a DoT
        // spec rolls no accuracy/crit/variance RNG).
        let mut damage = [0i64; crate::entity::DMG_COUNT];
        damage[crate::entity::DMG_PHYS] = 100_000_000;
        let spec = combat::StrikeSpec {
            attacker_slot: Some(slot),
            attacker_net: anet,
            attacker_name: "Breaker".into(),
            attacker_is_char: true,
            is_spell: true,
            is_dot: true,
            accuracy: 0,
            damage,
            crit_bp: 0,
            crit_multi: 10000,
            projectile: false,
            dot: None,
            debuff: None,
            stagger: 0,
            knockback_cu: 0,
            ailment_chance: 0,
            inherent_ailment_kind: None,
        };
        let (mut ev, mut dead, mut loot) = (Vec::new(), Vec::new(), Vec::new());
        let now = w.tick;
        w.strike(spec, mslot, now, &mut ev, &mut dead, &mut loot);
        assert!(
            ev.iter()
                .any(|e| matches!(e, SimEvent::ActCompleted { act: 1, .. })),
            "the Mother's fall fires the act beat"
        );
        assert_eq!(
            w.zone
                .get(slot)
                .unwrap()
                .character
                .as_ref()
                .unwrap()
                .story_acts,
            1,
            "act 1 belongs to the breaker"
        );
        // The act boss ALWAYS pays a map, INTO THE KILLER'S BAG (#136
        // T4+T6): the campaign's key reward is unmissable — a ground drop
        // once despawned while her killer respawned across the zone.
        // Mutation: drop the act-boss arm or the hand-delivery → fails.
        assert!(
            w.zone
                .get(slot)
                .unwrap()
                .character
                .as_ref()
                .unwrap()
                .inventory
                .iter()
                .any(|p| matches!(
                    &p.item,
                    crate::entity::BagItem::Gear(item)
                        if self_content_map(&content, item.base_idx)
                )),
            "the Mother's map lands in the killer's bag"
        );
        assert!(
            !loot.iter().any(|(_, payload, ..)| matches!(
                payload,
                crate::entity::LootPayload::Gear(item)
                    if self_content_map(&content, item.base_idx)
            )),
            "no duplicate map on the ground"
        );
    }

    fn self_content_map(content: &ContentDb, base_idx: u32) -> bool {
        content.items[base_idx as usize].map_tier.is_some()
    }

    #[test]
    fn the_tidewardens_storm_rises_below_half_life() {
        // #136 T2: the boss PHASE is real, not lore — below 50% life the
        // Tidewarden's kit (below_life_pct passives) folds in: double crit
        // chance, +50% crit multi, +60% phys on his fists, through the same
        // per-strike machinery as player gear. Mutation: strip the passives
        // from tidewarden.ron (or break monster strike conditions) → wounded
        // == healthy and this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xB055, &content);
        let warden = content.monster_idx("tidewarden").unwrap() as u32;
        w.spawn_monster_rolled(
            warden,
            0,
            FxV2::new(Fx::from_int(10), Fx::from_int(10)),
            Rarity::Unique,
            vec![],
            "The Tidewarden".into(),
        );
        let slot = w
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some())
            .map(|(s, _)| s)
            .unwrap();
        let offense = |w: &World, s: usize| {
            let o = w.effective_offense(s).unwrap();
            (o.damage[crate::entity::DMG_PHYS], o.crit_inc, o.crit_multi)
        };
        let (phys_hale, crit_hale, multi_hale) = offense(&w, slot);
        {
            let c = w.zone.get_mut(slot).unwrap().combat.as_mut().unwrap();
            c.life = c.life_max * 4 / 10; // 40%: the storm rises
        }
        let (phys_low, crit_low, multi_low) = offense(&w, slot);
        assert!(
            phys_low > phys_hale,
            "the colossus swings harder wounded ({phys_low} vs {phys_hale})"
        );
        assert_eq!(crit_low, crit_hale * 2, "storms crit twice as often");
        assert_eq!(multi_low, multi_hale + 5000, "and half again as hard");
    }

    #[test]
    fn state_hash_fingerprints_exit_seals() {
        // #136: two worlds identical but for an exit's requires_act admit
        // different futures (one departs, one gets -3) — the seal must hash.
        // Mutation: drop the requires_act fold in views.rs → identical digests.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF0A, &content);
        w.zone.exits.push(crate::zone::ExitState {
            pos: w.zone.spawn,
            dest: "saltmere".into(),
            open: true,
            requires_act: 1,
        });
        let h1 = w.state_hash();
        w.zone.exits.last_mut().unwrap().requires_act = 2;
        assert_ne!(h1, w.state_hash(), "the seal must move the digest");
    }

    #[test]
    fn self_status_flags_carry_act_completion_on_bit_1() {
        // #136: SS_FLAGS bit1 = act 1 complete, bit0 = dead — through the REAL
        // SelfStatus syscall. Mutation: shift act1 to bit 2 (or drop it) → the
        // post-completion read isn't 2; corrupt bit0 → the alive read fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF0B, &content);
        // SelfStatus(out=0xF000) every tick; flags land at 0xF000 + 32.
        w.tick(&TickInputs {
            arrivals: Vec::new(),
            removals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Flagbearer".into(),
                program: idlin_botc::assemble(
                    "loop:\npush 0xF000\nsys 1 1\npush 0xF200\nstore\njmp loop\n",
                )
                .unwrap(),
            }],
        });
        let slot = (0..w.zone.slot_count())
            .find(|&s| w.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let bot_idx = w.zone.get(slot).unwrap().bot.unwrap();
        let flags = |w: &mut World, idx: u32| -> i32 {
            w.bots.get_mut(idx).unwrap().vm.load_i32(0xF000 + 32)
        };
        assert_eq!(flags(&mut w, bot_idx), 0, "alive, no acts: flags 0");
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 1;
        w.tick(&TickInputs::default());
        assert_eq!(
            flags(&mut w, bot_idx),
            2,
            "act 1 complete + alive: exactly bit 1"
        );
    }

    #[test]
    fn story_and_sealed_exits_survive_world_serde() {
        // #136: the WORLD snapshot must carry a character's story_acts and an
        // exit's requires_act — a `#[serde(skip)]` on either would resume a
        // wiped campaign or an unsealed exit. Mutation: skip either field →
        // the corresponding assert fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0x51A8, &content);
        let slot = join_one(&mut w, "Pilgrim");
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 0b101;
        w.zone.exits.push(crate::zone::ExitState {
            pos: w.zone.spawn,
            dest: "saltmere".into(),
            open: true,
            requires_act: 2,
        });
        let bytes = postcard::to_allocvec(&w).expect("world serializes");
        let mut back: World = postcard::from_bytes(&bytes).expect("world resumes");
        back.attach_content(&content).expect("content re-attaches");
        let ch = (0..back.zone.slot_count())
            .find_map(|s| back.zone.get(s).and_then(|e| e.character.as_ref()))
            .expect("character restored");
        assert_eq!(ch.story_acts, 0b101, "story_acts survives the snapshot");
        assert_eq!(
            back.zone.exits.last().unwrap().requires_act,
            2,
            "the sealed exit survives the snapshot"
        );
    }

    #[test]
    fn state_hash_fingerprints_story_acts() {
        // #136: campaign progress gates future behavior (exits/maps), so it
        // must be hashed. Mutation: drop the story_acts fold → identical hash.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF09, &content);
        let slot = join_one(&mut w, "Storied");
        let h1 = w.state_hash();
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 3; // the WHOLE campaign (final_act-derived gate, #148 retro)
        assert_ne!(h1, w.state_hash(), "story_acts must move the digest");
    }

    #[test]
    fn state_hash_fingerprints_stash() {
        // #148 A5 review (B1): the chest steers bots (ReadStash → withdraw
        // branches), so it is replayed state and must be hashed. Mutation:
        // drop the stash fold from state_hash → this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF0A, &content);
        let slot = join_one(&mut w, "Chested");
        let h1 = w.state_hash();
        let cleaver = content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap() as u32;
        w.zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .stash
            .push(crate::entity::BagItem::Gear(crate::entity::Item {
                base_idx: cleaver,
                rarity: Rarity::Normal,
                item_level: 1,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
                unique_idx: None,
            }));
        assert_ne!(h1, w.state_hash(), "stash must move the digest");
    }

    #[test]
    fn state_hash_fingerprints_explored() {
        // #129: `explored` drives the wire visibility filter, so it is replayed
        // state and must be hashed BY CONTENT. Mutation: drop the explored fold
        // from state_hash (or hash only the length) → the flipped far bit
        // leaves the digest unchanged and this fails.
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut w = World::new(0xF08, &content);
        let slot = join_one(&mut w, "Hasher");
        let h1 = w.state_hash();
        let ch = w.zone.get_mut(slot).unwrap().character.as_mut().unwrap();
        let last = ch.explored.len() - 1;
        ch.explored[last] ^= 1 << 63; // a far, unstamped bit
        assert_ne!(
            h1,
            w.state_hash(),
            "flipping one explored bit must change the state hash"
        );
    }
}
