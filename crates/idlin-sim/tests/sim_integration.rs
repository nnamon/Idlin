//! Headless full-stack sim tests: real content, real bot templates, thousands
//! of ticks. The pure core fast-forwards far faster than real time, so these
//! cover hours of gameplay in seconds.

use idlin_content::ContentDb;
use idlin_sim::{JoinRequest, SimEvent, TickInputs, World};
use std::path::Path;

fn content() -> ContentDb {
    ContentDb::load(Path::new("../../content")).expect("workspace content must load")
}

fn join_inputs() -> TickInputs {
    let program = idlin_botc::template_grinder().expect("template assembles");
    let joins = ["Kargan", "Veles", "Mirra", "Thane"]
        .into_iter()
        .map(|name| JoinRequest {
            name: name.into(),
            program: program.clone(),
        })
        .collect();
    TickInputs {
        joins,
        arrivals: Vec::new(),
    }
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
    let mut passives = 0u64;
    let mut gems_socketed = 0u64;

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
            SimEvent::PassiveAllocated { .. } => passives += 1,
            SimEvent::GemSocketed { .. } => gems_socketed += 1,
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
    assert!(
        passives >= 1,
        "bots should allocate passives; got {passives}"
    );
    assert!(
        gems_socketed >= 1,
        "bots should socket gems; got {gems_socketed}"
    );
    // Deaths are possible (tide husks hit hard) but not required.
    let _ = deaths;

    // The world must still be populated and bounded. Characters only
    // leave by BREAKING THE TIDEWARDEN (the shore brain transfers them
    // to Saltmere) — anyone missing must be accounted for by a departure.
    let departures = events
        .iter()
        .filter(|ev| matches!(ev, SimEvent::CharacterDeparted { .. }))
        .count();
    let views = world.views();
    let characters = views.iter().filter(|v| v.kind == 1).count();
    assert_eq!(
        characters + departures,
        4,
        "characters never vanish without a departure"
    );
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
        arrivals: Vec::new(),
        joins: ["A", "B", "C", "D"]
            .into_iter()
            .map(|name| JoinRequest {
                name: name.into(),
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

#[test]
fn persist_block_survives_redeploy() {
    use idlin_sim::bots::{Bot, program_hash};
    use idlin_sim::rng::{Domain, Pcg32};

    // Program A: write a magic value into the persist block, then halt.
    let writer = idlin_botc::assemble("push 0x1D71BEEF\npush 0xF200\nstore\nhalt\n").unwrap();
    // Program B: read it back onto the stack via Debug (no-op here).
    let reader = idlin_botc::assemble("halt\n").unwrap();

    let mut bot = Bot {
        vm: idlin_vm::Vm::new(&writer).unwrap(),
        rng: Pcg32::stream(1, Domain::Bot, 1),
        params: vec![0; idlin_vm::PARAM_BLOCK_LEN],
        program: writer.clone(),
        program_hash: program_hash(&writer),
        version: 1,
    };
    let mut budget = 1000;
    assert_eq!(bot.vm.run(&mut budget), idlin_vm::RunExit::Halted);
    assert_eq!(bot.vm.load_u32(0xF200), 0x1D71BEEF);

    // Redeploy with new code: memory resets, persist block survives,
    // version bumps.
    bot.redeploy(&reader).unwrap();
    assert_eq!(bot.version, 2);
    assert_eq!(bot.vm.pc(), 0);
    assert_eq!(
        bot.vm.load_u32(0xF200),
        0x1D71BEEF,
        "persist block must survive a code swap"
    );
    // Ordinary memory did NOT survive.
    assert_eq!(bot.vm.load_u32(0xC000), 0);
}

#[test]
fn disconnected_builds_are_rejected_at_declaration() {
    let content = content();
    let mut world = World::new(11, &content);

    // A plan that jumps straight to a deep node (v4 without v1-v3) must be
    // rejected outright; a connected plan must be accepted.
    let bad = idlin_botc::compile("build [23]; fn main() {}").unwrap();
    let good = idlin_botc::compile("build [10, 11, 12, 20]; fn main() {}").unwrap();
    let joins = TickInputs {
        arrivals: Vec::new(),
        joins: vec![
            JoinRequest {
                name: "Bad".into(),
                program: bad,
            },
            JoinRequest {
                name: "Good".into(),
                program: good,
            },
        ],
    };
    let events = world.tick(&joins);
    let mut rejected = None;
    let mut declared = None;
    for ev in &events {
        match ev {
            SimEvent::BuildRejected { owner, reason, .. } => {
                rejected = Some((owner.clone(), reason.clone()));
            }
            SimEvent::BuildDeclared { owner, nodes, .. } => {
                declared = Some((owner.clone(), *nodes));
            }
            _ => {}
        }
    }
    let (who, why) = rejected.expect("bad build must be rejected");
    assert_eq!(who, "Bad");
    assert!(why.contains("not connected"), "reason: {why}");
    assert_eq!(declared, Some(("Good".into(), 4)));
}

#[test]
fn the_shore_brain_choreographs_the_opening() {
    let content = content();
    let mut world = World::new(0x5708E, &content);
    let program = idlin_botc::template_grinder().expect("template assembles");
    let mut events = world.tick(&TickInputs {
        joins: vec![JoinRequest {
            name: "Wretch".into(),
            program,
        }],
        arrivals: Vec::new(),
    });
    for _ in 0..1200 {
        events.extend(world.tick(&TickInputs::default()));
    }

    let narrations: Vec<&str> = events
        .iter()
        .filter_map(|ev| match ev {
            SimEvent::Narration { text, .. } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        narrations.iter().any(|t| t.contains("tide spits you")),
        "the welcome beat must fire; got {narrations:?}"
    );
    assert!(
        narrations.iter().any(|t| t.contains("give up their tools")),
        "the first-kill beat must fire; got {narrations:?}"
    );

    // The scripted weapon and suited gem both landed as drops.
    let weapon_names = ["Rusted Cleaver", "Driftwood Bow", "Barnacle Wand"];
    let gem_names = [
        "Cleave",
        "Heavy Swing",
        "Power Shot",
        "Ember Bolt",
        "Frost Nova",
        "Arc",
        "Plague Cloud",
    ];
    let drops: Vec<&str> = events
        .iter()
        .filter_map(|ev| match ev {
            SimEvent::LootDropped { item, .. } => Some(item.as_str()),
            _ => None,
        })
        .collect();
    assert!(
        drops.iter().any(|d| weapon_names.contains(d)),
        "scripted weapon must drop; got {drops:?}"
    );
    assert!(
        drops.iter().any(|d| gem_names.contains(d)),
        "scripted suited gem must drop; got {drops:?}"
    );
    assert!(
        narrations.iter().any(|t| t.contains("Armed")),
        "the first-equip beat must fire; got {narrations:?}"
    );
}

#[test]
fn the_tidewarden_falls_and_the_killer_climbs_to_saltmere() {
    let content = content();
    // Two worlds, one host (this test): a private shore and the shared town.
    let mut shore = World::new_for_zone(0xAC71, &content, "withered_shore");
    let mut town = World::new_for_zone(0xAC72, &content, "saltmere");
    let program = idlin_botc::template_grinder().expect("template assembles");
    shore.tick(&TickInputs {
        joins: vec![JoinRequest {
            name: "Pilgrim".into(),
            program,
        }],
        arrivals: Vec::new(),
    });
    town.tick(&TickInputs::default());

    // Stage the final exam in test time: drop the pilgrim at the bluff and
    // reduce EVERY monster to a 1-life, harmless effigy — the bluff's
    // neighbors would otherwise eat a level-1 pilgrim, and there are no
    // forced transfers to save them anymore. The kill, hoard, exit
    // opening, and the bot's own walk through the bluff gate all run the
    // REAL pipeline and brain.
    let views = shore.views();
    let me = views.iter().find(|v| v.kind == 1).unwrap().id;
    views
        .iter()
        .find(|v| v.name == "The Tidewarden")
        .expect("the boss stands at the bluff");
    shore.test_teleport(me, 17, 8);
    for v in &views {
        if v.kind == 2 && !v.dead {
            shore.test_set_combat(v.id, 1, 0);
        }
    }

    let mut departed = None;
    let empty = TickInputs::default();
    for _ in 0..600 {
        let events = shore.tick(&empty);
        let dep = shore.take_departures();
        if !dep.is_empty() {
            assert!(events.iter().any(|ev| matches!(
                ev,
                SimEvent::CharacterDeparted { name, dest, .. }
                    if name == "Pilgrim" && dest == "saltmere"
            )));
            departed = Some(dep);
            break;
        }
    }
    let mut departed = departed.expect("the pilgrim must break the Tidewarden and leave");
    let (bundle, dest) = departed.pop().unwrap();
    assert_eq!(dest, "saltmere");
    assert!(
        bundle.character.kills >= 1,
        "the killer carries their tally"
    );
    let kills_at_departure = bundle.character.kills;

    // The host ferries the bundle into the town.
    let events = town.tick(&TickInputs {
        joins: Vec::new(),
        arrivals: vec![bundle],
    });
    assert!(
        events
            .iter()
            .any(|ev| matches!(ev, SimEvent::CharacterJoined { name, .. } if name == "Pilgrim"))
    );
    // Saltmere's brain greets the arrival within a few ticks.
    let mut greeted = false;
    let mut t = events;
    for _ in 0..5 {
        greeted |= t
            .iter()
            .any(|ev| matches!(ev, SimEvent::Narration { text, .. } if text.contains("Saltmere")));
        t = town.tick(&empty);
    }
    assert!(greeted, "the town must greet the arrival");
    // Identity survived the ferry.
    let views = town.views();
    let me = views.iter().find(|v| v.kind == 1).expect("arrived");
    assert_eq!(me.name, "Pilgrim");
    assert_eq!(me.kills, kills_at_departure, "the tally crossed the bluff");
    assert!(!me.weapon.is_empty(), "still armed in town");
}
