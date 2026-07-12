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
    /// A pack rises EXACTLY ONCE (operator ruling: monsters never
    /// resurrect — a cleared zone stays cleared, in the campaign and in
    /// maps alike; progression is forward, the loop is the NEXT map).
    #[serde(default)]
    pub risen: bool,
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
    /// Hit reactions carried from the launcher.
    pub stagger: i64,
    pub knockback_cu: i64,
    /// The firing skill's inherent ailment chance (bp, #88), carried to the hit.
    pub ailment_chance: i64,
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

    /// The WALK twin of sight_cell (#185 stall fix): true when the cell
    /// cannot be STOOD on. Water and chasms are transparent to sight but
    /// solid to feet — movement must test this, never sight.
    pub fn walk_blocked_cell(&self, x: i64, y: i64) -> bool {
        self.idx(x, y).is_none_or(|i| !self.walk[i])
    }

    /// Deterministic A* over the walk grid (#148 A2.5): 4-connected,
    /// unit costs, Manhattan heuristic, FIXED tie-breaking (lowest f, then
    /// lowest index) — same inputs, same path, forever. Returns the cell
    /// path START-EXCLUSIVE as centers, or None when unreachable. Bounded
    /// by the grid size; maps are ≤ ~6k cells.
    pub fn find_path(
        &self,
        from: FxV2,
        to: FxV2,
        extra_blocked: impl Fn(i64, i64) -> bool,
    ) -> Option<Vec<FxV2>> {
        let cell = |p: FxV2| {
            (
                (p.x.raw() as i64).div_euclid(65536),
                (p.y.raw() as i64).div_euclid(65536),
            )
        };
        let (sx, sy) = cell(from);
        let (tx, ty) = cell(to);
        let start = self.idx(sx, sy)?;
        let goal = self.idx(tx, ty)?;
        if !self.walk[goal] {
            return None;
        }
        let w = self.width as i64;
        let n = self.walk.len();
        let mut g = vec![u32::MAX; n];
        let mut prev = vec![usize::MAX; n];
        let mut open = std::collections::BinaryHeap::new();
        let h = |i: usize| {
            let (cx, cy) = ((i as i64) % w, (i as i64) / w);
            ((cx - tx).abs() + (cy - ty).abs()) as u32
        };
        g[start] = 0;
        // Reverse-ordered (min-heap): (f, index) — index ties keep it fixed.
        open.push(std::cmp::Reverse((h(start), start)));
        while let Some(std::cmp::Reverse((_, i))) = open.pop() {
            if i == goal {
                let mut path = Vec::new();
                let mut c = goal;
                while c != start {
                    let (cx, cy) = ((c as i64) % w, (c as i64) / w);
                    path.push(FxV2::new(
                        Fx::from_raw((cx * 65536 + 32768) as i32),
                        Fx::from_raw((cy * 65536 + 32768) as i32),
                    ));
                    c = prev[c];
                }
                path.reverse();
                return Some(path);
            }
            let (cx, cy) = ((i as i64) % w, (i as i64) / w);
            for (dx, dy) in [(1i64, 0i64), (-1, 0), (0, 1), (0, -1)] {
                let Some(j) = self.idx(cx + dx, cy + dy) else {
                    continue;
                };
                if !self.walk[j] {
                    continue;
                }
                // Gates (and any other dynamic block) veto cells the static
                // grid allows — the review's soft-pin: A* once planned
                // straight through a shut lesson gate.
                if extra_blocked(cx + dx, cy + dy) {
                    continue;
                }
                let ng = g[i].saturating_add(1);
                if ng < g[j] {
                    g[j] = ng;
                    prev[j] = i;
                    open.push(std::cmp::Reverse((ng + h(j), j)));
                }
            }
        }
        None
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
    /// Story seal (#136): 0 = none; N = requires act N complete to take.
    pub requires_act: u32,
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
    /// Authored tile collision (zones with a map.txt) — the one terrain
    /// and collision system. `None` only for placeholder/test zones.
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
    /// net_id -> slot lookup. A pure derived index over `slots`, so it is NOT
    /// serialized — it is rebuilt from `slots` on resume (`rebuild_net_index`),
    /// never trusted from a snapshot. Keeps it impossible for the index to drift
    /// from the authoritative `slots` (and out of `state_hash`, which hashes the
    /// slots it derives from).
    #[serde(skip)]
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

    /// Rebuild the net_id -> slot index from the authoritative `slots`. Called
    /// after a snapshot is deserialized (`by_net` is `#[serde(skip)]`), so the
    /// lookup index is always reconstructed from disk-restored slots rather than
    /// trusted from the snapshot bytes.
    pub fn rebuild_net_index(&mut self) {
        self.by_net.clear();
        for (slot, cell) in self.slots.iter().enumerate() {
            if let Some(e) = cell {
                self.by_net.insert(e.net_id, slot as u32);
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&str]) -> SimGrid {
        let height = rows.len() as i32;
        let width = rows[0].len() as i32;
        let mut walk = Vec::new();
        for r in rows {
            for c in r.chars() {
                walk.push(c == '.');
            }
        }
        SimGrid {
            width,
            height,
            los: walk.iter().map(|w| !w).collect(),
            walk,
        }
    }

    fn at(x: i64, y: i64) -> FxV2 {
        FxV2::new(
            Fx::from_raw((x * 65536 + 32768) as i32),
            Fx::from_raw((y * 65536 + 32768) as i32),
        )
    }

    #[test]
    fn astar_routes_around_walls_deterministically() {
        // #148 A2.5: a wall with one gap — the path must thread it, and two
        // identical calls must agree cell-for-cell (fixed tie-breaking).
        // Mutation: drop the tie-break index from the heap key → flaky order.
        let g = grid(&["....", ".##.", ".#..", "...."]);
        let p1 = g.find_path(at(1, 0), at(2, 2), |_, _| false).unwrap();
        let p2 = g.find_path(at(1, 0), at(2, 2), |_, _| false).unwrap();
        assert_eq!(p1, p2, "same inputs, same path");
        assert!(!p1.is_empty());
        // The unreachable case: boxed in on all sides.
        let sealed = grid(&["...", ".#.", "..."]);
        assert!(
            sealed.find_path(at(0, 0), at(1, 1), |_, _| false).is_none(),
            "a walled goal has no path"
        );
    }

    #[test]
    fn astar_respects_the_dynamic_veto() {
        // #148 A2.5 review (B2): shut gates veto cells the static grid
        // allows. Mutation: drop the extra_blocked check → the path runs
        // straight through the "gate" column.
        let g = grid(&["....", "....", "...."]);
        let gate_col = |cx: i64, _cy: i64| cx == 2;
        let p = g.find_path(at(0, 1), at(3, 1), gate_col);
        assert!(p.is_none(), "the veto seals the only corridor");
    }
}
