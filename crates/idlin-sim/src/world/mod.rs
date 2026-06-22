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

pub use views::{CharacterSheetView, SkillStatView};

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
    LevelUp {
        id: u32,
        name: String,
        level: u32,
    },
    MonsterKilled {
        killer_id: u32,
        killer: String,
        monster: String,
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
}

/// Flat renderable view of an entity, exported to the server each tick.
#[derive(Debug, Clone)]
pub struct EntityView {
    pub id: u32,
    /// 1 = character, 2 = monster, 3 = loot.
    pub kind: u8,
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
    pub(crate) pending_exits: Vec<(u32, String)>,
    /// Committed uses winding up toward their contact tick.
    #[serde(default)]
    pub(crate) pending_uses: Vec<crate::world::combat::PendingUse>,
}

// ---- universal (classless) character bases ----

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
        use_ticks: def.use_ticks,
        busy_until: 0,
        speed_per_tick: speed_from_cps(def.speed_cps),
        radius: fx_from_cu(def.radius_cu),
        projectile: def.projectile,
        item_rarity: 10000,
        item_quantity: 10000,
        last_combat_tick: 0,
        has_strike_conditions: false,
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
        damage: [base_unarmed_damage(level), 0, 0, 0, 0],
        accuracy: base_accuracy(level),
        evasion: base_evasion(level),
        armour: 0,
        resists: [0; crate::entity::RES_COUNT],
        range: fx_from_cu(UNARMED_RANGE_CU),
        stagger: 0,
        poise: 0,
        knockback_cu: 0,
        use_ticks: UNARMED_USE_TICKS,
        busy_until: 0,
        speed_per_tick: speed_from_cps(BASE_SPEED_CPS),
        radius: fx_from_cu(BASE_RADIUS_CU),
        projectile: false,
        item_rarity: 10000,
        item_quantity: 10000,
        last_combat_tick: 0,
        has_strike_conditions: false,
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
                        respawn_timer: 0,
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
    pub fn tick(&mut self, inputs: &TickInputs) -> Vec<SimEvent> {
        self.tick += 1;
        let mut events = Vec::new();
        self.clear_transient_intents();
        self.apply_joins(inputs, &mut events);
        self.run_bots(&mut events);
        self.process_exits(&mut events);
        self.movement();
        self.separation();
        self.obstacle_pushout();
        self.step_projectiles(&mut events);
        self.attacks(&mut events);
        self.effects_tick(&mut events);
        self.pickups(&mut events);
        self.regen();
        self.respawns(&mut events);
        self.run_zone_brain(&mut events);
        events
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
        for (net, dest) in std::mem::take(&mut self.pending_exits) {
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
                },
                dest.clone(),
            ));
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
                    items: 0,
                    inventory: Vec::new(),
                    equipment: Default::default(),
                    allocated: Vec::new(),
                    build_plan: Vec::new(),
                    currency: vec![0; self.content.currency.len()],
                    sockets: std::collections::BTreeMap::new(),
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
            if character.currency.len() < self.content.currency.len() {
                character.currency.resize(self.content.currency.len(), 0);
            }
            let name = character.name.clone();
            let level = character.level;
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
            let (pos, speed, range) = (e.pos, combat.speed_per_tick, combat.range);

            // Stop to fight: if the attack target is already in range, hold.
            if let Some(att) = e.intents.attack
                && let crate::entity::SkillTarget::Entity(tid) = att.target
                && let Some(t) = self.zone.get_net(tid)
                && t.alive()
                && pos.dist(t.pos) <= range
            {
                continue;
            }

            let delta = target - pos;
            let dist = pos.dist(target);
            let new_pos = if dist <= speed {
                target
            } else {
                let factor = speed / dist;
                FxV2::new(pos.x + delta.x * factor, pos.y + delta.y * factor)
            };
            let new_pos = self.zone.clamp_pos(new_pos);
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
            if c.life < c.life_max && now.saturating_sub(c.last_combat_tick) >= REGEN_DELAY_TICKS {
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
                events.push(SimEvent::CharacterRespawned { id });
            }
        }

        // Packs respawn as a unit: survivors hold their ground (no trickle
        // refills); once the pack is wiped and its timer runs out, the whole
        // pack rises again.
        for pack_idx in 0..self.zone.packs.len() {
            let pack = &self.zone.packs[pack_idx];
            if pack.alive > 0 {
                continue;
            }
            if pack.respawn_timer > 0 {
                self.zone.packs[pack_idx].respawn_timer -= 1;
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
                (d.magic_bp, d.rare_bp)
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
        let def = &self.content.monsters[monster_idx as usize];
        let mut stats = monster_base_stats(def);
        // Level scaling FIRST: the area lifts the def's baseline before
        // elite bulk and affixes compound on top. +12% life / +10%
        // damage per level above the authored baseline.
        let eff_level = self.effective_monster_level(monster_idx, rarity);
        let delta = eff_level as i64 - def.level as i64;
        let life_bp = (10000 + delta * 1200).max(2500);
        let dmg_bp = (10000 + delta * 1000).max(2500);
        let scaled_life = def.life * life_bp / 10000;
        if delta != 0 {
            stats.life_max = scaled_life.max(1);
            stats.life = stats.life_max;
            for d in stats.damage.iter_mut() {
                *d = *d * dmg_bp / 10000;
            }
        }
        if matches!(rarity, Rarity::Magic | Rarity::Rare) {
            // Inherent elite bulk on TOP of affixes, PoE-style.
            let bulk = if rarity == Rarity::Magic {
                16000
            } else {
                26000
            };
            // Monsters wield no weapon → unarmed, which counts as melee, so a
            // melee condition holds and bow/wand conditions don't (#86). Evaluate
            // so a conditional monster affix isn't applied unconditionally. Derive
            // phase (#109): strike-time conditions are deferred (inert for monsters
            // this pass — no monster content carries one).
            let ctx = crate::stats::EvalContext {
                weapon_class: None,
                ..Default::default()
            };
            let mut sheet = crate::stats::StatSheet::new();
            for ra in &affixes {
                let a = &self.content.affixes[ra.affix_idx as usize];
                for g in a.grants(&ra.values) {
                    crate::world::progression::apply_conditional(&mut sheet, &g, &ctx);
                }
            }
            stats.life_max =
                sheet.value(idlin_content::stats::Stat::Life, scaled_life) * bulk / 10000;
            stats.life = stats.life_max;
            for (i, base) in [
                def.damage * dmg_bp / 10000,
                def.damage_fire * dmg_bp / 10000,
                def.damage_cold * dmg_bp / 10000,
                def.damage_lightning * dmg_bp / 10000,
                def.damage_chaos * dmg_bp / 10000,
            ]
            .into_iter()
            .enumerate()
            {
                let st = [
                    idlin_content::stats::Stat::DamagePhys,
                    idlin_content::stats::Stat::DamageFire,
                    idlin_content::stats::Stat::DamageCold,
                    idlin_content::stats::Stat::DamageLightning,
                    idlin_content::stats::Stat::DamageChaos,
                ][i];
                stats.damage[i] = sheet.value(st, base);
            }
            // Typed resists and hit reactions roll on elites too — the
            // SAME sheet items use (of Wards, of Staggering).
            let res_stats = [
                idlin_content::stats::Stat::ResistFire,
                idlin_content::stats::Stat::ResistCold,
                idlin_content::stats::Stat::ResistLightning,
                idlin_content::stats::Stat::ResistChaos,
            ];
            for (i, st) in res_stats.into_iter().enumerate() {
                stats.resists[i] = sheet.value(st, stats.resists[i]);
            }
            stats.stagger = sheet.value(idlin_content::stats::Stat::Stagger, 0).max(0);
            stats.poise = sheet.value(idlin_content::stats::Stat::Poise, 0).max(0);
            stats.knockback_cu = sheet.value(idlin_content::stats::Stat::Knockback, 0).max(0);
            // (attack cadence lives on the def's use_ticks; the haste
            // affix still applies wherever derived stats read it)
        }
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
        self.zone.insert(Entity {
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
            pool: "monster".into(),
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

    /// A fresh shore world with ONE multi-member non-unique pack forced
    /// to the given rarity chances (every other pack stays plain), ticked
    /// once so the initial refill runs. Returns the forced pack's index.
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
}
