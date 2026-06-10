//! Headless full-stack sim tests: real content, real bot templates, thousands
//! of ticks. The pure core fast-forwards far faster than real time, so these
//! cover hours of gameplay in seconds.

use idlin_content::ContentDb;
use idlin_sim::{Class, JoinRequest, SimEvent, TickInputs, World};
use std::path::Path;

fn content() -> ContentDb {
    ContentDb::load(Path::new("../../content")).expect("workspace content must load")
}

fn join_inputs() -> TickInputs {
    let program = idlin_botc::template_grinder().expect("template assembles");
    let joins = [
        ("Kargan", Class::Brute),
        ("Veles", Class::Hunter),
        ("Mirra", Class::Brute),
        ("Thane", Class::Hunter),
    ]
    .into_iter()
    .map(|(name, class)| JoinRequest {
        name: name.into(),
        class,
        program: program.clone(),
    })
    .collect();
    TickInputs { joins }
}

#[test]
fn bots_grind_the_shore() {
    let content = content();
    let mut world = World::new(0x1D71_2026, &content);

    let mut kills = 0u64;
    let mut level_ups = 0u64;
    let mut deaths = 0u64;
    let mut pickups = 0u64;
    let mut equips = 0u64;

    let mut events = world.tick(&join_inputs());
    // 6000 ticks = 10 minutes of game time.
    for _ in 0..6000 {
        events.extend(world.tick(&TickInputs::default()));
    }
    for ev in &events {
        match ev {
            SimEvent::MonsterKilled { .. } => kills += 1,
            SimEvent::LevelUp { .. } => level_ups += 1,
            SimEvent::CharacterDied { .. } => deaths += 1,
            SimEvent::ItemPickedUp { .. } => pickups += 1,
            SimEvent::ItemEquipped { .. } => equips += 1,
            _ => {}
        }
    }

    assert!(kills >= 20, "bots should clear packs; got {kills} kills");
    assert!(
        level_ups >= 1,
        "someone should level in 10 minutes; got {level_ups}"
    );
    assert!(pickups >= 1, "bots should pick up loot; got {pickups}");
    assert!(equips >= 1, "bots should equip upgrades; got {equips}");
    // Deaths are possible (tide husks hit hard) but not required.
    let _ = deaths;

    // The world must still be populated and bounded.
    let views = world.views();
    let characters = views.iter().filter(|v| v.kind == 1).count();
    assert_eq!(characters, 4, "characters never despawn");
    assert!(views.len() < 200, "entity leak? {} entities", views.len());
}

#[test]
fn full_determinism_with_bots() {
    let content = content();
    let mut a = World::new(7777, &content);
    let mut b = World::new(7777, &content);

    let join = join_inputs();
    a.tick(&join);
    b.tick(&join);
    let empty = TickInputs::default();
    for tick in 0..3000 {
        a.tick(&empty);
        b.tick(&empty);
        if tick % 100 == 0 {
            assert_eq!(
                a.state_hash(),
                b.state_hash(),
                "worlds diverged at tick {}",
                tick + 2
            );
        }
    }
    assert_eq!(a.state_hash(), b.state_hash());
}

#[test]
fn snapshot_roundtrip_resumes_identically() {
    let content = content();
    let mut a = World::new(99, &content);
    a.tick(&join_inputs());
    let empty = TickInputs::default();
    for _ in 0..500 {
        a.tick(&empty);
    }

    // Serialize, restore, and re-attach content — the clone must continue
    // bit-identically.
    let bytes = postcard::to_allocvec(&a).expect("serialize");
    let mut b: World = postcard::from_bytes(&bytes).expect("deserialize");
    b.attach_content(&content).expect("content hash matches");

    assert_eq!(a.state_hash(), b.state_hash());
    for _ in 0..500 {
        a.tick(&empty);
        b.tick(&empty);
    }
    assert_eq!(a.state_hash(), b.state_hash(), "snapshot clone diverged");
}

#[test]
fn same_faction_spawn_stack_drifts_apart() {
    // All four characters spawn on the same point with inert brains (halt
    // only), so the ONLY force on them is soft same-faction separation —
    // they must spread out within a few seconds. (Bots in motion may still
    // overlap transiently; pass-through is the intended behavior.)
    let content = ContentDb::empty();
    let mut world = World::new(5, &content);
    let halt = idlin_botc::assemble("halt\n").unwrap();
    let joins = TickInputs {
        joins: ["A", "B", "C", "D"]
            .into_iter()
            .map(|name| JoinRequest {
                name: name.into(),
                class: Class::Brute,
                program: halt.clone(),
            })
            .collect(),
    };
    world.tick(&joins);
    for _ in 0..100 {
        world.tick(&TickInputs::default());
    }
    let views = world.views();
    let chars: Vec<_> = views.iter().filter(|v| v.kind == 1).collect();
    assert_eq!(chars.len(), 4);
    for (i, a) in chars.iter().enumerate() {
        for b in chars.iter().skip(i + 1) {
            let dx = (a.x_raw - b.x_raw) as i64;
            let dy = (a.y_raw - b.y_raw) as i64;
            let dist_sq = dx * dx + dy * dy;
            // Combined radii ≈ 0.9–1.0u ⇒ require at least ~0.8u apart.
            let min = (0.8f64 * 65536.0) as i64; // test-side float is fine
            assert!(
                dist_sq >= min * min,
                "characters {} and {} still stacked (dist_sq {dist_sq})",
                a.id,
                b.id
            );
        }
    }
}
