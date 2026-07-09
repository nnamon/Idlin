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
        removals: Vec::new(),
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

    // The shore is a SOLO story zone (max_players: 1; the server boots
    // one instance per idler) — its gated, one-shot tutorial beats are
    // sized for exactly one character.
    let program = idlin_botc::template_grinder().expect("template assembles");
    let mut events = world.tick(&TickInputs {
        joins: vec![JoinRequest {
            name: "Kargan".into(),
            program,
        }],
        arrivals: Vec::new(),
        removals: Vec::new(),
    });
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

    // The strand is FINITE now (one-shot packs, 17 mobs incl. the boss):
    // a near-full clear in ten minutes is the tutorial working.
    assert!(
        kills >= 15,
        "bots should clear the strand; got {kills} kills"
    );
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
        1,
        "characters never vanish without a departure"
    );
    assert!(views.len() < 200, "entity leak? {} entities", views.len());
}

#[test]
fn the_grinder_prefers_affixed_gear_over_plain() {
    // #148 A1: the stock template upgrades by RARITY first, item level as
    // the tiebreak — the old ilvl-only rule let plain bases evict affixed
    // gear, and every 1.0 seed sailed at zero resist. A worn plain ilvl-6
    // helm must lose to a bagged magic ilvl-5 helm. Mutation: revert the
    // rule to ilvl-only → the magic helm stays in the bag and this fails.
    let content = content();
    let mut w = World::new_for_zone(0xA1F1, &content, "test_range");
    let program = idlin_botc::template_grinder().expect("template assembles");
    w.tick(&TickInputs {
        joins: vec![JoinRequest {
            name: "Chooser".into(),
            program,
        }],
        arrivals: Vec::new(),
        removals: Vec::new(),
    });
    let net = w
        .views()
        .iter()
        .find(|v| v.kind == 1)
        .map(|v| v.id)
        .unwrap();
    let helm = content
        .items
        .iter()
        .position(|i| i.id == "brine_helm")
        .unwrap() as u32;
    let warding = content
        .affixes
        .iter()
        .position(|a| a.id == "of_warding")
        .unwrap() as u32;
    w.test_wear_and_bag_helms(net, helm, warding);
    // Give the template a few upkeep cadences.
    let empty = TickInputs::default();
    for _ in 0..40 {
        w.tick(&empty);
    }
    let worn = w.test_worn_helm(net).expect("a helm is worn");
    assert_eq!(
        worn,
        (1, 5),
        "the magic ilvl-5 helm must displace the plain ilvl-6 one; got rarity/ilvl {worn:?}"
    );
}

#[test]
fn the_act_1_zones_stand_up() {
    // #136 T3: both new zones boot from shipped content — packs spawn, the
    // bosses rise at Unique rarity with their authored names, and the exit
    // chain runs shore->saltmere->coast->saltworks->hollow and back.
    // Mutation: break a pack anchor, an exit dest, or a boss def -> fails.
    let content = content();
    let empty = TickInputs::default();

    let mut works = World::new_for_zone(0x5A17, &content, "saltworks");
    works.tick(&empty);
    let views = works.views();
    let mobs = views.iter().filter(|v| v.kind == 2).count();
    assert!(mobs >= 15, "the pans are worked; got {mobs}");
    let karesh: Vec<_> = views.iter().filter(|v| v.rarity == 3 && !v.dead).collect();
    assert_eq!(karesh.len(), 1, "one Brinelord holds the court");
    assert_eq!(karesh[0].name, "Brinelord Karesh");

    let mut hollow = World::new_for_zone(0x5A18, &content, "hollow");
    hollow.tick(&empty);
    let views = hollow.views();
    let mobs = views.iter().filter(|v| v.kind == 2).count();
    assert!(mobs >= 12, "the throat is sung; got {mobs}");
    let mother: Vec<_> = views.iter().filter(|v| v.rarity == 3 && !v.dead).collect();
    assert_eq!(mother.len(), 1, "one Mother in the basin");
    assert_eq!(mother[0].name, "Mother of the Drowned");

    // The Sovereign's stage direction (#162 boss mechanics): drop him
    // below half and the zone brain narrates the rise + spawns the wave.
    // Mutation: drop the query_monsters phase block from the brain (or
    // break the syscall) → no adds, this fails.
    let mut stage = World::new_for_zone(0x50FA, &content, "the_undertow");
    stage.tick(&empty);
    let before = stage
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    let boss = stage
        .views()
        .iter()
        .find(|v| v.name == "The Riptide Sovereign")
        .map(|v| v.id)
        .expect("the Sovereign stands");
    stage.test_set_life_pct(boss, 40);
    stage.tick(&empty);
    stage.tick(&empty);
    let after = stage
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    assert!(
        after >= before + 2,
        "the rise must add its wave ({before} -> {after})"
    );
    // The 25% break too (codex on Q7: an unpinned phase is a deletable
    // phase — the same gap existed in this committed Q6 pin).
    stage.test_set_life_pct(boss, 20);
    stage.tick(&empty);
    stage.tick(&empty);
    let broke = stage
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    assert!(
        broke >= after + 3,
        "the break brings the drowned ({after} -> {broke})"
    );

    // The Mother's and the Bailiff's directors (#162, same pattern —
    // mutation: drop either brain's phase block → its assert fails).
    let mut hollow = World::new_for_zone(0x50FB, &content, "hollow");
    hollow.tick(&empty);
    let before = hollow
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    let mother = hollow
        .views()
        .iter()
        .find(|v| v.name == "Mother of the Drowned")
        .map(|v| v.id)
        .expect("the Mother stands");
    hollow.test_set_life_pct(mother, 40);
    hollow.tick(&empty);
    hollow.tick(&empty);
    let after = hollow
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    assert!(
        after >= before + 2,
        "the chorus answers ({before} -> {after})"
    );
    // The 25% verse too (codex: an unpinned phase is a deletable phase).
    hollow.test_set_life_pct(mother, 20);
    hollow.tick(&empty);
    hollow.tick(&empty);
    let last = hollow
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    assert!(
        last >= after + 2,
        "the last verse rises ({after} -> {last})"
    );

    let mut court = World::new_for_zone(0x50FC, &content, "pressure_court");
    court.tick(&empty);
    let before = court
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    let bailiff = court
        .views()
        .iter()
        .find(|v| v.name == "Bailiff Morr")
        .map(|v| v.id)
        .expect("the Bailiff holds session");
    court.test_set_life_pct(bailiff, 40);
    court.tick(&empty);
    court.tick(&empty);
    let after = court
        .views()
        .iter()
        .filter(|v| v.kind == 2 && !v.dead)
        .count();
    assert!(
        after >= before + 2,
        "the session files in ({before} -> {after})"
    );

    // Act 2 (#148 A3): the Undertow stands up the same way.
    let mut deep = World::new_for_zone(0x5A19, &content, "the_undertow");
    deep.tick(&empty);
    let views = deep.views();
    let sovereign: Vec<_> = views.iter().filter(|v| v.rarity == 3 && !v.dead).collect();
    assert_eq!(sovereign.len(), 1, "one Sovereign in the basin");
    assert_eq!(sovereign[0].name, "The Riptide Sovereign");

    // The chain: every authored exit leads where the campaign says —
    // both acts, and the sealed stair rides the hollow's exit list.
    let chain = [
        ("withered_shore", vec!["saltmere"]),
        ("saltmere", vec!["coast"]),
        ("coast", vec!["saltmere", "saltworks"]),
        ("saltworks", vec!["coast", "hollow"]),
        ("hollow", vec!["saltworks", "sunken_stair"]),
        ("sunken_stair", vec!["hollow", "lanternfall"]),
        ("lanternfall", vec!["sunken_stair", "kelp_forest"]),
        ("kelp_forest", vec!["lanternfall", "pressure_court"]),
        ("pressure_court", vec!["kelp_forest", "the_undertow"]),
        ("the_undertow", vec!["pressure_court"]),
    ];
    for (zone, dests) in chain {
        let def = content.zone(zone).expect(zone);
        let got: Vec<&str> = def.exits.iter().map(|e| e.dest.as_str()).collect();
        for d in dests {
            assert!(got.contains(&d), "{zone} must reach {d}; has {got:?}");
        }
    }
    // The stair is STORY-SEALED (#148 A3): the way down demands Act 1 —
    // asserted at RUNTIME on the real exit, not just the content field. A
    // walker bot standing on the stair reads -3 mid-campaign and departs
    // the moment the bit is granted. Mutation: drop requires_act from the
    // hollow's exit (or the seal check in use_exit) → the -3 read fails.
    let mut hollow = World::new_for_zone(0x5EA1, &content, "hollow");
    let walker = idlin_botc::assemble("loop:\nsys 28 0\npush 0xF200\nstore\njmp loop\n").unwrap();
    hollow.tick(&TickInputs {
        joins: vec![JoinRequest {
            name: "Sealed".into(),
            program: walker,
        }],
        arrivals: Vec::new(),
        removals: Vec::new(),
    });
    let net = hollow
        .views()
        .iter()
        .find(|v| v.kind == 1)
        .map(|v| v.id)
        .unwrap();
    let stair_pos = content
        .zone("hollow")
        .unwrap()
        .exits
        .iter()
        .find(|e| e.dest == "sunken_stair")
        .map(|e| (e.x_u, e.y_u))
        .unwrap();
    assert_eq!(stair_pos, (14, 4), "the stair sits where authored");
    hollow.test_teleport(net, stair_pos.0 as i16, stair_pos.1 as i16);
    hollow.tick(&empty);
    assert_eq!(
        hollow.test_vm_word(net, 0xF200),
        Some(-3),
        "mid-campaign, the stair refuses with the story-seal code"
    );
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
        removals: Vec::new(),
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

    // A plan that jumps straight to a deep node (w4 without w1-w3) must be
    // rejected outright; a connected plan must be accepted. Refs are stable
    // tagged node nums (#54: compose(Node, seq)): 41943063 = w4 (seq 23);
    // 41943050/51/52 = str1/str2/str3 (seq 10/11/12); 41943060 = w1 (seq 20).
    let bad = idlin_botc::compile("build [41943063]; fn main() {}").unwrap();
    let good = idlin_botc::compile("build [41943050, 41943051, 41943052, 41943060]; fn main() {}")
        .unwrap();
    let joins = TickInputs {
        arrivals: Vec::new(),
        removals: Vec::new(),
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
        removals: Vec::new(),
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
        removals: Vec::new(),
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
    let mut act_beat = false;
    let empty = TickInputs::default();
    // Generous budget: the grinder hunts every effigy in view first, then
    // must sit out the ~12s boredom latch before it commits to the exit,
    // then walk the whole strand back to the bluff gate.
    for _ in 0..3000 {
        let events = shore.tick(&empty);
        act_beat |= events
            .iter()
            .any(|ev| matches!(ev, SimEvent::ActCompleted { .. }));
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
    // #136 T3: the shore's Tidewarden is the TUTORIAL exam, not the act boss —
    // Act 1 now ends at the Mother in the Hollow. Mutation: put act_boss back
    // on the tutorial warden → a beat fires here and this fails.
    assert!(
        !act_beat,
        "the tutorial exam must NOT complete an act (the Mother does, in the Hollow)"
    );
    let (bundle, dest) = departed.pop().unwrap();
    assert_eq!(dest, "saltmere");
    assert!(
        bundle.character.kills >= 1,
        "the killer carries their tally"
    );
    // #136 T3: no act completes on the shore — the pilgrim climbs to
    // Saltmere still mid-campaign; the Hollow's Mother holds the flag.
    assert_eq!(
        bundle.character.story_acts, 0,
        "the tutorial leaves the campaign unfinished"
    );
    let kills_at_departure = bundle.character.kills;

    // The host ferries the bundle into the town.
    let events = town.tick(&TickInputs {
        joins: Vec::new(),
        arrivals: vec![bundle],
        removals: Vec::new(),
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

/// The whole gated tutorial, unscripted: a single stock grinder must
/// learn every lesson the brain teaches — declare, first kill, gem,
/// the flask gauntlet, the witch's support gem, the rare, the boss —
/// and walk out to Saltmere on its own. No teleports, no effigies:
/// this is the real onboarding a viewer's idler lives.
///
/// Runs across SEVERAL seeds (including the production derivation for
/// a builtin idler): the strand is one-shot, so a boss a pupil can't
/// break on a bad seed is a wall with no ladder — seed luck must never
/// strand the tutorial.
#[test]
fn the_gated_tutorial_teaches_a_stock_grinder_to_saltmere() {
    let content = content();
    // The server's per-instance seed for Kargan: base seed ^ FNV(name).
    let kargan = {
        let mut h = idlin_content::FNV1A_OFFSET;
        for b in "Kargan".bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(idlin_content::FNV1A_PRIME);
        }
        12648430 ^ h
    };
    for seed in [0x717, kargan, 0xBADC0DE, 0x5EED5] {
        run_tutorial(&content, seed);
    }
}

fn run_tutorial(content: &ContentDb, seed: u64) {
    let mut shore = World::new_for_zone(seed, content, "withered_shore");
    let program = idlin_botc::template_grinder().expect("template assembles");
    shore.tick(&TickInputs {
        joins: vec![JoinRequest {
            name: "Pupil".into(),
            program,
        }],
        arrivals: Vec::new(),
        removals: Vec::new(),
    });

    let mut min_life = 100u8;
    let mut witch_seen = false;
    let mut rare_seen = false;
    let mut deaths = 0u32;
    let mut departed = None;
    let empty = TickInputs::default();
    for tick in 0..40_000u32 {
        let events = shore.tick(&empty);
        deaths += events
            .iter()
            .filter(|e| matches!(e, SimEvent::CharacterDied { .. }))
            .count() as u32;
        if std::env::var("IDLIN_TRACE").is_ok() {
            for e in &events {
                match e {
                    SimEvent::LootDropped { item, .. } => println!("t{tick} DROP {item}"),
                    SimEvent::ItemPickedUp { item, .. } => println!("t{tick} PICKUP {item}"),
                    SimEvent::GemSocketed { gem, .. } => println!("t{tick} SOCKET {gem}"),
                    SimEvent::GemRejected { gem, skill, .. } => {
                        println!("t{tick} REJECT {gem} on {skill}")
                    }
                    SimEvent::MonsterKilled { monster, .. } => println!("t{tick} KILL {monster}"),
                    _ => {}
                }
            }
        }
        // IDLIN_TRACE=1: tick-level telemetry for tuning sessions.
        if tick % 500 == 0 && std::env::var("IDLIN_TRACE").is_ok() {
            let mut pupil = String::new();
            let mut loot = 0;
            for v in shore.views() {
                if v.kind == 1 {
                    pupil = format!(
                        "({:.1},{:.1}) kills {} lvl {} life {}%",
                        v.x_raw as f64 / 65536.0,
                        v.y_raw as f64 / 65536.0,
                        v.kills,
                        v.level,
                        v.life_pct
                    );
                }
                if v.kind == 3 {
                    loot += 1;
                }
            }
            println!("t{tick}: {pupil} loot-on-ground {loot}");
        }
        // Sample the world sparsely — the assertions only need trends.
        if tick % 25 == 0 {
            for v in shore.views() {
                if v.kind == 1 && !v.dead {
                    min_life = min_life.min(v.life_pct);
                }
                if v.name.contains("Shoal Witch") {
                    witch_seen = true;
                }
                // The scripted rare wears a naming-pool name + base.
                if v.kind == 2 && v.rarity == 2 {
                    rare_seen = true;
                }
            }
        }
        let dep = shore.take_departures();
        if let Some((bundle, dest)) = dep.into_iter().next() {
            departed = Some((tick, bundle, dest));
            break;
        }
    }
    let (tick, bundle, dest) = departed.unwrap_or_else(|| {
        // Dump the stuck world so the failure explains itself.
        let mut dump = String::new();
        for v in shore.views() {
            if v.kind == 1 {
                dump += &format!(
                    "\n  pupil: ({:.1},{:.1}) kills {} lvl {} life {}% dead {}",
                    v.x_raw as f64 / 65536.0,
                    v.y_raw as f64 / 65536.0,
                    v.kills,
                    v.level,
                    v.life_pct,
                    v.dead
                );
            } else if v.kind == 2 && !v.dead {
                dump += &format!(
                    "\n  monster: {} ({:.0},{:.0}) {}%",
                    v.name,
                    v.x_raw as f64 / 65536.0,
                    v.y_raw as f64 / 65536.0,
                    v.life_pct
                );
            }
        }
        panic!("seed {seed:#x}: the tutorial must be completable by the stock grinder.{dump}")
    });
    assert_eq!(dest, "saltmere");
    let ch = &bundle.character;
    assert!(
        ch.kills >= 15,
        "seed {seed:#x}: cleared the strand ({} kills)",
        ch.kills
    );
    assert!(
        witch_seen,
        "seed {seed:#x}: the scripted magic witch must rise"
    );
    assert!(rare_seen, "seed {seed:#x}: the guaranteed rare must rise");
    // The gauntlet must BITE (the flask lesson needs stakes) — if this
    // fails the grasping_drowned need sharper teeth, not the test.
    assert!(
        min_life <= 70,
        "seed {seed:#x}: the gauntlet should hurt (min life seen: {min_life}%)"
    );
    // An occasional death is drama; a respawn LOOP is a broken exam.
    assert!(
        deaths <= 3,
        "seed {seed:#x}: too many deaths ({deaths}) — the tutorial is overtuned"
    );
    println!(
        "seed {seed:#x}: tutorial completed at tick {tick}: kills {}, level {}, min life {min_life}%, deaths {deaths}",
        ch.kills, ch.level
    );
}
