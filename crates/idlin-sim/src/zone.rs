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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    pub name: String,
    pub width: Fx,
    pub height: Fx,
    pub spawn: FxV2,
    /// Idlers spawn/respawn scattered within this radius of `spawn`, so the
    /// cast doesn't bunch up at a single point.
    pub spawn_radius: Fx,
    /// Generated with the area; constant for the zone's lifetime.
    pub obstacles: Vec<Obstacle>,
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
            obstacles: Vec::new(),
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
