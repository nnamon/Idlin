//! The pure, deterministic Idlin world simulation.
//!
//! This crate is the determinism boundary: no I/O, no threads, no wall clock,
//! no floats, no nondeterministic iteration. Everything entering the world
//! comes in as `TickInputs`; everything leaving comes out as state plus
//! `SimEvent`s. The server shell (`idlin-server`) owns time, sockets, and
//! persistence — this crate owns truth.
//!
//! Phase 0 ships the facade plus the foundational numerics (`fixed`, `rng`,
//! `hash`); entities, zones, combat, and the bot host land in Phase 1.

#![forbid(unsafe_code)]
#![deny(
    clippy::float_arithmetic,
    clippy::disallowed_types,
    clippy::disallowed_methods
)]

pub mod fixed;
pub mod hash;
pub mod rng;

use hash::Fnv1a64;
use idlin_content::ContentDb;
use serde::{Deserialize, Serialize};

/// Sim ticks per second. The protocol never assumes this; it ships tick
/// numbers, so the rate can change without breaking clients.
pub const TICK_HZ: u32 = 10;

/// Inputs applied at the start of a tick. Joins, bot deploys, parameter
/// updates, and admin commands all arrive through here — never by mutating
/// the world directly. Phase 0: empty placeholder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TickInputs {}

/// Things that happened during a tick that the outside world may care about
/// (replication, the auto-director, chat announcements, persistence).
/// Phase 0: no variants yet.
#[derive(Debug, Clone, Serialize)]
pub enum SimEvent {}

pub struct World {
    seed: u64,
    content_hash: u64,
    tick: u64,
}

impl World {
    pub fn new(seed: u64, content: &ContentDb) -> World {
        World {
            seed,
            content_hash: content.content_hash,
            tick: 0,
        }
    }

    /// Advance the world by exactly one tick. Must be bit-exact for identical
    /// (seed, content, input-history) on every platform.
    pub fn tick(&mut self, _inputs: &TickInputs) -> Vec<SimEvent> {
        self.tick += 1;
        Vec::new()
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

    /// Canonical state hash for determinism checks (replays, snapshots, CI).
    pub fn state_hash(&self) -> u64 {
        let mut h = Fnv1a64::new();
        h.write_u64(self.seed);
        h.write_u64(self.content_hash);
        h.write_u64(self.tick);
        h.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_histories_hash_identically() {
        let content = ContentDb::empty();
        let mut a = World::new(42, &content);
        let mut b = World::new(42, &content);
        let inputs = TickInputs::default();
        for _ in 0..1_000 {
            a.tick(&inputs);
            b.tick(&inputs);
        }
        assert_eq!(a.state_hash(), b.state_hash());
        assert_eq!(a.tick_count(), 1_000);

        let mut c = World::new(43, &content);
        c.tick(&inputs);
        assert_ne!(a.state_hash(), c.state_hash());
    }
}
