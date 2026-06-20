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
/// Re-pinned for the affix-model overhaul Phase A (#86): affixes became a LIST of
/// effects (hybrid support), so `RolledAffix` stores `values: Vec<i64>` and the
/// schema moved. Three intentional sources move the hash: (1) `content_hash` (FNV
/// over content/) — all 31 affix files rewritten to the `effects`/`rolls` shape,
/// plus the new `of_the_fox` hybrid affix and the regenerated `ids.ron`; (2) the
/// item-affix hash format in `world/views.rs` now writes the per-effect `values`
/// vec (length-prefixed) instead of one `value`; (3) `of_the_fox` joins the
/// `armour` affix pool, so the grinder rolls a different (still deterministic) set
/// of mods over the 2000-tick replay. Single-effect affixes draw the SAME one RNG
/// value as before (per-effect rolls iterate one range), so the only trajectory
/// change is the new pool member — no determinism bug.
/// (Prior: #98 skill life cost + cost_mult; #91 accessory/gloves slots; etc.)
const GOLDEN_HASH: u64 = 0x0A71_7DDC_482C_633D;

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
