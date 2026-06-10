//! The pure, deterministic Idlin world simulation.
//!
//! This crate is the determinism boundary: no I/O, no threads, no wall clock,
//! no floats, no nondeterministic iteration. Everything entering the world
//! comes in as `TickInputs`; everything leaving comes out as state plus
//! `SimEvent`s. The server shell (`idlin-server`) owns time, sockets, and
//! persistence — this crate owns truth.

#![forbid(unsafe_code)]
#![deny(
    clippy::float_arithmetic,
    clippy::disallowed_types,
    clippy::disallowed_methods
)]

pub mod bots;
pub mod entity;
pub mod fixed;
pub mod hash;
pub mod rng;
pub mod stats;
pub mod world;
pub mod zone;

pub use entity::Rarity;
pub use world::{
    EntityView, JoinRequest, LOOT_DESPAWN_TICKS, RESPAWN_TICKS, SimEvent, TICK_HZ, TickInputs,
    World, universal_stats,
};

#[cfg(test)]
mod tests {
    use super::*;
    use idlin_content::ContentDb;

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
