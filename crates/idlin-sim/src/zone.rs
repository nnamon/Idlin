//! Zone storage: slot-based entity arena plus spawn-pack bookkeeping.
//! Iteration is always by ascending slot index — the determinism backbone.

use crate::entity::Entity;
use crate::fixed::{Fx, FxV2};
use idlin_content::SpawnPack;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackState {
    pub def: SpawnPack,
    /// Index into ContentDb::monsters (resolved at zone creation).
    pub monster_idx: u32,
    pub alive: u32,
    /// Counts down once any member is dead; at zero the pack refills.
    pub respawn_timer: u32,
}

/// A non-walkable disc generated with the area. Rendered by the client
/// as the matching prop (rock, dead tree); the sim slides entities along
/// its edge.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Obstacle {
    pub pos: FxV2,
    pub radius: Fx,
    /// Visual kind: 0 = rock, 1 = dead tree.
    pub kind: u8,
}

/// A skill projectile in flight. Stepped each tick; hits the first enemy
/// (or wall) in its path and resolves through the normal strike pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Projectile {
    pub pos: FxV2,
    /// Per-tick velocity.
    pub vel: FxV2,
    /// Travel budget remaining (units).
    pub remaining: Fx,
    pub radius: Fx,
    pub source: u32,
    pub source_name: String,
    pub source_is_char: bool,
    pub hostile_to_players: bool,
    /// Spell projectiles never miss via accuracy.
    pub spell: bool,
    pub accuracy: i64,
    pub damage: [i64; crate::entity::DMG_COUNT],
    pub crit_bp: i64,
    pub crit_multi: i64,
    pub pierce: u32,
    /// Net ids already struck (pierce passes through each once).
    pub already_hit: Vec<u32>,
    pub dot: Option<(u8, i64, u32, u32)>,
    /// Victim rider: (grants, duration_ticks) applied on hit.
    pub debuff: Option<(Vec<crate::stats::Grant>, u32)>,
}

/// Grid collision for authored (tile-mapped) zones: one cell per sim
/// unit, row-major. Static for the zone's lifetime — the map is content,
/// so the grid never feeds the state hash. Out-of-bounds is neither
/// solid nor sight-blocking: `clamp_pos` owns the zone edge, and treating
/// the rim as solid would jitter entities sitting exactly on it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimGrid {
    pub width: i32,
    pub height: i32,
    /// Cell is standable ground.
    pub walk: Vec<bool>,
    /// Cell blocks line of sight.
    pub los: Vec<bool>,
}

impl SimGrid {
    fn idx(&self, cx: i64, cy: i64) -> Option<usize> {
        if cx < 0 || cy < 0 || cx >= self.width as i64 || cy >= self.height as i64 {
            return None;
        }
        Some((cy * self.width as i64 + cx) as usize)
    }

    pub fn solid_cell(&self, cx: i64, cy: i64) -> bool {
        self.idx(cx, cy).is_some_and(|i| !self.walk[i])
    }

    pub fn sight_cell(&self, cx: i64, cy: i64) -> bool {
        self.idx(cx, cy).is_some_and(|i| self.los[i])
    }

    /// In-bounds AND standable — what spawn scatter needs.
    pub fn walkable_pos(&self, pos: FxV2) -> bool {
        self.idx(
            (pos.x.raw() as i64).div_euclid(65536),
            (pos.y.raw() as i64).div_euclid(65536),
        )
        .is_some_and(|i| self.walk[i])
    }
}

/// A tutorial gate: a rect of cells the brain can open or shut.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GateState {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub open: bool,
}

impl GateState {
    pub fn covers(&self, cx: i64, cy: i64) -> bool {
        cx >= self.x0 as i64 && cx <= self.x1 as i64 && cy >= self.y0 as i64 && cy <= self.y1 as i64
    }
}

/// A walk-up exit: a character bot standing close enough takes it with
/// the UseExit syscall — nothing ever forces a transfer. The zone brain
/// gates `open`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExitState {
    pub pos: FxV2,
    /// Destination zone id (the host ferries the bundle).
    pub dest: String,
    pub open: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    pub name: String,
    pub width: Fx,
    pub height: Fx,
    pub spawn: FxV2,
    /// Idlers spawn/respawn scattered within this radius of `spawn`, so the
    /// cast doesn't bunch up at a single point.
    pub spawn_radius: Fx,
    /// Monsters never acquire characters inside this radius of `spawn`.
    pub camp_radius: Fx,
    /// Generated with the area; constant for the zone's lifetime.
    pub obstacles: Vec<Obstacle>,
    /// Authored tile collision (zones with a map.txt); generated zones
    /// use `obstacles` instead.
    pub grid: Option<SimGrid>,
    /// Walk-up exits to other zones.
    pub exits: Vec<ExitState>,
    /// Brain-togglable barriers: closed = the rect blocks movement.
    pub gates: Vec<GateState>,
    /// Skill projectiles in flight.
    pub projectiles: Vec<Projectile>,
    pub packs: Vec<PackState>,
    slots: Vec<Option<Entity>>,
    free: Vec<u32>,
    by_net: BTreeMap<u32, u32>,
}

impl Zone {
    pub fn new(name: String, width: Fx, height: Fx, spawn: FxV2, spawn_radius: Fx) -> Zone {
        Zone {
            name,
            width,
            height,
            spawn,
            spawn_radius,
            camp_radius: Fx::ZERO,
            obstacles: Vec::new(),
            grid: None,
            exits: Vec::new(),
            gates: Vec::new(),
            projectiles: Vec::new(),
            packs: Vec::new(),
            slots: Vec::new(),
            free: Vec::new(),
            by_net: BTreeMap::new(),
        }
    }

    pub fn slot_count(&self) -> usize {
        self.slots.len()
    }

    pub fn get(&self, slot: usize) -> Option<&Entity> {
        self.slots.get(slot).and_then(|s| s.as_ref())
    }

    pub fn get_mut(&mut self, slot: usize) -> Option<&mut Entity> {
        self.slots.get_mut(slot).and_then(|s| s.as_mut())
    }

    pub fn slot_of(&self, net_id: u32) -> Option<usize> {
        self.by_net.get(&net_id).map(|&s| s as usize)
    }

    pub fn get_net(&self, net_id: u32) -> Option<&Entity> {
        self.slot_of(net_id).and_then(|s| self.get(s))
    }

    pub fn get_net_mut(&mut self, net_id: u32) -> Option<&mut Entity> {
        self.slot_of(net_id).and_then(|s| self.get_mut(s))
    }

    /// Insert an entity, reusing the lowest free slot (deterministic).
    pub fn insert(&mut self, entity: Entity) -> usize {
        let net_id = entity.net_id;
        // `free` is kept sorted descending so pop() yields the lowest index.
        let slot = match self.free.pop() {
            Some(s) => {
                self.slots[s as usize] = Some(entity);
                s as usize
            }
            None => {
                self.slots.push(Some(entity));
                self.slots.len() - 1
            }
        };
        self.by_net.insert(net_id, slot as u32);
        slot
    }

    pub fn remove(&mut self, slot: usize) -> Option<Entity> {
        let entity = self.slots.get_mut(slot)?.take()?;
        self.by_net.remove(&entity.net_id);
        self.free.push(slot as u32);
        self.free.sort_unstable_by(|a, b| b.cmp(a));
        Some(entity)
    }

    /// A cell blocked RIGHT NOW: static grid solidity or a shut gate.
    pub fn cell_blocked(&self, cx: i64, cy: i64) -> bool {
        if self.grid.as_ref().is_some_and(|g| g.solid_cell(cx, cy)) {
            return true;
        }
        self.gates.iter().any(|g| !g.open && g.covers(cx, cy))
    }

    pub fn clamp_pos(&self, pos: FxV2) -> FxV2 {
        FxV2::new(
            pos.x.clamp(Fx::ZERO, self.width),
            pos.y.clamp(Fx::ZERO, self.height),
        )
    }

    /// Iterate occupied slots in ascending order.
    pub fn iter(&self) -> impl Iterator<Item = (usize, &Entity)> {
        self.slots
            .iter()
            .enumerate()
            .filter_map(|(i, s)| s.as_ref().map(|e| (i, e)))
    }
}
