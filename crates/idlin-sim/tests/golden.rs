//! Golden replay: a pinned (seed, content, inputs) history must produce the
//! exact same state hash forever, on every platform. CI failure here means
//! either an intentional content/sim change (update the constants below and
//! say so in the commit) or — much worse — a determinism leak.

use idlin_content::ContentDb;
use idlin_sim::{JoinRequest, TickInputs, World};
use std::path::Path;

const GOLDEN_SEED: u64 = 0x1D71_C0DE;
const GOLDEN_TICKS: u64 = 2_000;
/// Update via: cargo test -p idlin-sim --test golden -- --nocapture
/// Re-pinned for the affix-model overhaul Phase D (#86): ten new affix files make
/// the engine's reachable-but-unauthored stats usable in-game — `of_the_leech`
/// (leech_life+leech_mana hybrid), `of_ruin` (crit_multi), `of_frost`/`of_sparks`
/// (cold/lightning), `of_savagery` (CONDITIONAL: phys while wielding melee),
/// `of_renewal` (life_regen), `of_sealing` (resist_chaos), `of_channeling`
/// (mana_regen), `of_casting` (cast_speed), `of_greed` (rarity+quantity hybrid).
/// They join the weapon/armour/arcana/find pools, so the grinder rolls a
/// different (still deterministic) set of mods over the 2000-tick replay —
/// `content_hash` moves (new files + regenerated `ids.ron`) and the trajectory
/// shifts with the new pool members. No sim-rule change; pure content.
/// (Prior: Phase A 0x0A71 — effects-list schema; #98 skill life cost; etc.)
const GOLDEN_HASH: u64 = 0x5755_BB24_B7D6_156A;

#[test]
fn golden_replay() {
    let content = ContentDb::load(Path::new("../../content")).expect("content loads");
    let program = idlin_botc::template_grinder().expect("template assembles");
    let mut world = World::new(GOLDEN_SEED, &content);

    let joins = TickInputs {
        arrivals: Vec::new(),
        joins: vec![
            JoinRequest {
                name: "Golden".into(),
                program: program.clone(),
            },
            JoinRequest {
                name: "Replay".into(),
                program,
            },
        ],
    };
    world.tick(&joins);
    let empty = TickInputs::default();
    for _ in 1..GOLDEN_TICKS {
        world.tick(&empty);
    }

    let actual = world.state_hash();
    println!("golden state hash after {GOLDEN_TICKS} ticks: 0x{actual:016X}");
    println!("content hash: 0x{:016X}", content.content_hash);
    assert_eq!(
        actual, GOLDEN_HASH,
        "world history diverged from the golden fixture.\n\
         If you changed content or sim rules ON PURPOSE, update GOLDEN_HASH \
         to 0x{actual:016X} and call the change out in your commit message.\n\
         If you didn't, you have a determinism bug — bisect before touching \
         the constant."
    );
}
