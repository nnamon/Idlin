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

pub use views::CharacterSheetView;

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

/// Inputs applied at the start of a tick. Everything entering the world goes
/// through here — never by mutating state directly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TickInputs {
    pub joins: Vec<JoinRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinRequest {
    pub name: String,
    /// Assembled, versioned VM bytecode (a template for chat players).
    pub program: Vec<u8>,
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
    LevelUp {
        id: u32,
        name: String,
        level: u32,
    },
    MonsterKilled {
        killer_id: u32,
        killer: String,
        monster: String,
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
    GemSocketed {
        id: u32,
        owner: String,
        gem: String,
    },
    GemLevelUp {
        id: u32,
        owner: String,
        gem: String,
        level: u32,
    },
    Hit {
        attacker: u32,
        target: u32,
        amount: i64,
        /// Dominant damage component: 0 phys, 1 elemental, 2 chaos.
        dmg_type: u8,
        projectile: bool,
        killed: bool,
    },
    BotDebug {
        id: u32,
        values: Vec<i32>,
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
    pub level: u32,
    pub name: String,
    /// Client-side visual key (monster archetype model; characters: "idler").
    pub model: String,
    /// Equipped weapon visual key (characters; "" when unarmed).
    pub weapon: String,
    /// Visual part keys from equipped armor (characters), gear-slot order.
    pub gear: Vec<String>,
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
    pub(crate) bots: BotArena,
    next_net_id: u32,
    rng_ai: Pcg32,
    rng_combat: Pcg32,
    rng_loot: Pcg32,
}

// ---- universal (classless) character bases ----

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
const UNARMED_COOLDOWN: u32 = 8;

/// Unarmed, ungeared stats at a given level — what everyone spawns with.
pub fn universal_stats(level: u32) -> CombatStats {
    CombatStats {
        life: base_life(level),
        life_max: base_life(level),
        damage: [base_unarmed_damage(level), 0, 0],
        accuracy: base_accuracy(level),
        evasion: base_evasion(level),
        armour: 0,
        resist_ele: 0,
        resist_chaos: 0,
        range: fx_from_cu(UNARMED_RANGE_CU),
        cooldown_ticks: UNARMED_COOLDOWN,
        cooldown_left: 0,
        speed_per_tick: speed_from_cps(BASE_SPEED_CPS),
        radius: fx_from_cu(BASE_RADIUS_CU),
        projectile: false,
        last_combat_tick: 0,
    }
}

pub(crate) fn fx_from_cu(cu: i32) -> Fx {
    Fx::from_raw(((cu as i64) * 65536 / 100) as i32)
}

fn speed_from_cps(cps: i32) -> Fx {
    // centi-units/sec → units/tick at TICK_HZ.
    Fx::from_raw(((cps as i64) * 65536 / 100 / TICK_HZ as i64) as i32)
}

/// Area generation: scatter non-walkable rocks/trees, keeping the spawn
/// area, pack anchors, and other obstacles clear. Deterministic from the
/// world seed — every replay and every client sees the same layout.
fn generate_obstacles(zone: &mut crate::zone::Zone, seed: u64, rocks: u32, trees: u32) {
    let mut rng = Pcg32::stream(seed, Domain::MapLayout, 0);
    let margin = Fx::from_int(2);
    let span_x = (zone.width - margin - margin).raw().max(1) as u32;
    let span_y = (zone.height - margin - margin).raw().max(1) as u32;
    let kinds: [(u32, u8, i32, i32); 2] = [
        // (count, kind, min radius cu, max radius cu)
        (rocks, 0, 70, 140),
        (trees, 1, 45, 75),
    ];
    for (count, kind, r_min, r_max) in kinds {
        for _ in 0..count {
            'attempts: for _ in 0..12 {
                let x = margin + Fx::from_raw(rng.next_range(span_x) as i32);
                let y = margin + Fx::from_raw(rng.next_range(span_y) as i32);
                let radius = fx_from_cu(r_min + rng.next_range((r_max - r_min) as u32 + 1) as i32);
                let pos = FxV2::new(x, y);
                if pos.dist(zone.spawn) < zone.spawn_radius + Fx::from_int(3) {
                    continue 'attempts;
                }
                for pack in &zone.packs {
                    let anchor = FxV2::new(
                        Fx::from_int(pack.def.x_u as i16),
                        Fx::from_int(pack.def.y_u as i16),
                    );
                    if pos.dist(anchor) < Fx::from_int(pack.def.radius_u as i16 + 3) {
                        continue 'attempts;
                    }
                }
                for ob in &zone.obstacles {
                    if pos.dist(ob.pos) < radius + ob.radius + Fx::from_int(1) {
                        continue 'attempts;
                    }
                }
                zone.obstacles
                    .push(crate::zone::Obstacle { pos, radius, kind });
                break 'attempts;
            }
        }
    }
}

impl World {
    pub fn new(seed: u64, content: &ContentDb) -> World {
        let zone = match content
            .zone("withered_shore")
            .or_else(|| content.zones.first())
        {
            Some(def) => {
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
                generate_obstacles(&mut zone, seed, def.gen_rocks, def.gen_trees);
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
            bots: BotArena::default(),
            next_net_id: 1,
            rng_ai: Pcg32::stream(seed, Domain::ZoneAi, 0),
            rng_combat: Pcg32::stream(seed, Domain::Combat, 0),
            rng_loot: Pcg32::stream(seed, Domain::Loot, 0),
        }
    }

    /// Re-attach content after deserializing a snapshot. Fails on hash
    /// mismatch: a snapshot is only meaningful against its exact content.
    pub fn attach_content(&mut self, content: &ContentDb) -> Result<(), u64> {
        if content.content_hash != self.content_hash {
            return Err(self.content_hash);
        }
        self.content = content.clone();
        Ok(())
    }

    pub(crate) fn content_monsters(&self) -> &[MonsterDef] {
        &self.content.monsters
    }

    pub(crate) fn content_items(&self) -> &[ItemDef] {
        &self.content.items
    }

    pub(crate) fn content_gems(&self) -> &[idlin_content::GemDef] {
        &self.content.gems
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
        self.movement();
        self.separation();
        self.obstacle_pushout();
        self.attacks(&mut events);
        self.pickups(&mut events);
        self.regen();
        self.respawns(&mut events);
        events
    }

    fn alloc_net(&mut self) -> u32 {
        let id = self.next_net_id;
        self.next_net_id += 1;
        id
    }

    /// A spawn position scattered inside the zone's spawn area, so idlers
    /// don't stack on one point at joins and respawns.
    fn spawn_pos(&mut self) -> FxV2 {
        let r = self.zone.spawn_radius.raw();
        if r <= 0 {
            return self.zone.spawn;
        }
        let r = r as u32;
        let dx = Fx::from_raw(self.rng_ai.next_range(r * 2) as i32 - r as i32);
        let dy = Fx::from_raw(self.rng_ai.next_range(r * 2) as i32 - r as i32);
        let spawn = self.zone.spawn;
        self.zone.clamp_pos(FxV2::new(spawn.x + dx, spawn.y + dy))
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
                program_hash: program_hash(&join.program),
                version: 1,
            });
            let pos = self.spawn_pos();
            self.zone.insert(Entity {
                net_id,
                pos,
                intents: Default::default(),
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
                    pouch: Vec::new(),
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
            let (pos, speed, range) = (e.pos, combat.speed_per_tick, combat.range);

            // Stop to fight: if the attack target is already in range, hold.
            if let Some(att) = e.intents.attack
                && let Some(t) = self.zone.get_net(att.target)
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

    /// Obstacles are non-walkable: anything alive overlapping one is pushed
    /// out radially, with a consistent tangential bias so an entity walking
    /// dead-center at a rock slides around it instead of pinning against
    /// the face. Runs after separation, in slot order — deterministic.
    fn obstacle_pushout(&mut self) {
        /// Max correction per tick: firm enough to beat any move speed.
        const MAX_PUSH: Fx = Fx::from_raw(0x8000); // 0.5 u
        if self.zone.obstacles.is_empty() {
            return;
        }
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if !e.alive() {
                continue;
            }
            let Some(c) = &e.combat else { continue };
            let (pos, radius) = (e.pos, c.radius);
            let mut push_x = Fx::ZERO;
            let mut push_y = Fx::ZERO;
            for ob in &self.zone.obstacles {
                let min_dist = radius + ob.radius;
                let dist = pos.dist(ob.pos);
                if dist >= min_dist {
                    continue;
                }
                let need = (min_dist - dist).min(MAX_PUSH);
                let dir = if dist > Fx::from_raw(0x100) {
                    let f = Fx::ONE / dist;
                    FxV2::new((pos.x - ob.pos.x) * f, (pos.y - ob.pos.y) * f)
                } else {
                    FxV2::new(Fx::ONE, Fx::ZERO) // dead-center: deterministic out
                };
                let side = need / Fx::from_int(2);
                push_x = push_x + dir.x * need - dir.y * side;
                push_y = push_y + dir.y * need + dir.x * side;
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

    /// Out-of-combat regeneration: anything alive that hasn't traded damage
    /// for a while heals 2%/tick. Keeps idle play forgiving without bespoke
    /// per-kind healing rules.
    fn regen(&mut self) {
        let now = self.tick;
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get_mut(slot) else {
                continue;
            };
            let Some(c) = e.combat.as_mut() else { continue };
            if c.life <= 0 || c.life >= c.life_max {
                continue;
            }
            if now.saturating_sub(c.last_combat_tick) >= REGEN_DELAY_TICKS {
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
                c.cooldown_left = 0;
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
            for _ in 0..missing {
                let dx =
                    Fx::from_raw(self.rng_ai.next_range(jitter_r * 2) as i32 - jitter_r as i32);
                let dy =
                    Fx::from_raw(self.rng_ai.next_range(jitter_r * 2) as i32 - jitter_r as i32);
                let pos = self.zone.clamp_pos(FxV2::new(anchor.x + dx, anchor.y + dy));
                self.spawn_monster(monster_idx, pack_idx as u32, pos);
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
        let def = &self.content.monsters[monster_idx as usize];
        let accuracy = if def.accuracy > 0 {
            def.accuracy
        } else {
            60 + 15 * def.level as i64
        };
        let stats = CombatStats {
            life: def.life,
            life_max: def.life,
            damage: [def.damage, def.damage_ele, def.damage_chaos],
            accuracy,
            evasion: def.evasion,
            armour: def.armour,
            resist_ele: def.resist_ele,
            resist_chaos: def.resist_chaos,
            range: fx_from_cu(def.range_cu),
            cooldown_ticks: def.cooldown_ticks,
            cooldown_left: 0,
            speed_per_tick: speed_from_cps(def.speed_cps),
            radius: fx_from_cu(def.radius_cu),
            projectile: def.projectile,
            last_combat_tick: 0,
        };
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
                program_hash: program_hash(&program),
                version: 1,
            })
        });
        self.zone.insert(Entity {
            net_id,
            pos,
            intents: Default::default(),
            bot,
            combat: Some(stats),
            character: None,
            monster: Some(MonsterState {
                def_idx: monster_idx,
                pack_idx,
                anchor: pos,
                hostile,
                decay_at: None,
            }),
            loot: None,
        });
    }
}
