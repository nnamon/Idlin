//! The Proving Grounds: integration tests for grid-native collision.
//! This authored test zone exercises every tile mechanic — walls and a
//! gate, a roomed doorway, water (blocks feet, not sight) — before any
//! real zone converts to tiles.

use idlin_content::ContentDb;
use idlin_sim::{JoinRequest, SimEvent, TickInputs, World};
use std::path::Path;

fn content() -> ContentDb {
    ContentDb::load(Path::new("../../content")).expect("content loads")
}

fn join_two() -> TickInputs {
    let program = idlin_botc::template_grinder().expect("template assembles");
    TickInputs {
        arrivals: Vec::new(),
        joins: vec![
            JoinRequest {
                name: "Probe".into(),
                program: program.clone(),
            },
            JoinRequest {
                name: "Gauge".into(),
                program,
            },
        ],
    }
}

#[test]
fn sight_obeys_the_authored_walls() {
    let world = World::new_for_zone(0xCAFE, &content(), "test_range");
    // Straight up the gate column: clear.
    assert!(world.test_los_clear(13, 16, 13, 3), "the gate sees through");
    // Straight up a walled column: blocked.
    assert!(
        !world.test_los_clear(5, 16, 5, 3),
        "the rampart blocks sight"
    );
    // Across the pool: water blocks feet, not eyes.
    assert!(world.test_los_clear(17, 10, 22, 10), "water is transparent");
    // Through the room's doorway at y=10, not through its wall at y=9.
    assert!(
        world.test_los_clear(4, 10, 10, 10),
        "the doorway sees through"
    );
    assert!(!world.test_los_clear(4, 9, 10, 9), "the room wall blocks");
}

#[test]
fn bots_fight_through_the_gate_and_never_stand_in_walls() {
    let mut world = World::new_for_zone(0xBEEF, &content(), "test_range");
    let mut events = world.tick(&join_two());
    let empty = TickInputs::default();
    let mut kills = 0;
    for _ in 1..1500 {
        for ev in &events {
            if matches!(ev, SimEvent::MonsterKilled { .. }) {
                kills += 1;
            }
        }
        // Invariant: nothing alive stands inside a wall or the pool. The
        // pushout outruns every move speed, so a center never crosses a
        // solid cell's face.
        for v in world.views() {
            let solid_matters = (v.kind == idlin_sim::KIND_CHARACTER
                || v.kind == idlin_sim::KIND_MONSTER)
                && !v.dead;
            if solid_matters {
                assert_eq!(
                    world.test_on_walkable(v.id),
                    Some(true),
                    "{} stands in a wall at tick {}",
                    v.name,
                    world.tick_count()
                );
            }
        }
        events = world.tick(&empty);
    }
    assert!(kills > 0, "grinders must cross the gate and fight");
}

#[test]
fn bots_take_the_open_exit_and_the_loop_ferries_them_back() {
    // The range's exit is always open and loops to itself: bots clear the
    // gate pack (close enemies outrank leaving), then walk through and
    // re-arrive at the south camp — the full transfer machinery on a loop,
    // chosen by the bot's own UseExit call. Nothing forces it.
    let mut world = World::new_for_zone(0xD0_0D, &content(), "test_range");
    let mut inputs = join_two();
    let mut departures = 0;
    let mut joins = 0;
    for _ in 0..2500 {
        let events = world.tick(&inputs);
        inputs = TickInputs::default();
        joins += events
            .iter()
            .filter(|e| matches!(e, SimEvent::CharacterJoined { .. }))
            .count();
        for (bundle, dest) in world.take_departures() {
            assert_eq!(dest, "test_range", "the demo exit loops home");
            departures += 1;
            inputs.arrivals.push(bundle);
        }
        if departures >= 2 {
            break;
        }
    }
    assert!(departures >= 1, "a bot must choose the open exit");
    assert!(
        joins > 2,
        "ferried bots must re-arrive (beyond the 2 boot joins)"
    );
}

#[test]
fn the_proving_grounds_replay_identically() {
    let run = |seed: u64| {
        let mut w = World::new_for_zone(seed, &content(), "test_range");
        w.tick(&join_two());
        let empty = TickInputs::default();
        for _ in 1..600 {
            w.tick(&empty);
        }
        w.state_hash()
    };
    assert_eq!(run(7), run(7), "same seed, same history");
}
