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
/// Re-pinned for the endgame cycle (quality pass, live find): the three
/// templates' voyage-return route now names SALTMERE — the town the
/// voyage exit actually reaches. Template bytes only.
/// Re-pinned for the itemization ladder (quality pass): content-only —
/// eight deep armour/accessory bases (the audit found ONE base per
/// slot; a level-23 character wore tutorial gloves). New bases enter
/// the drop pool, so every seeded roll reshuffles.
/// Re-pinned for the Mother + Bailiff directors (quality pass):
/// content-only — the hollow brain gained the chorus/last-verse beats,
/// the Pressure Court its FIRST brain (the ORDER beat), plus their zone
/// lines. Same pattern as the Sovereign's; no engine change.
/// Re-pinned for boss mechanics (quality pass): content_hash moved — the
/// Undertow's brain became the Sovereign's stage director (add waves +
/// beat lines at life thresholds), two zone lines were added, AND
/// gen_abi.bot regenerated with the QueryMonsters record consts (it
/// lives under content/lib and is hashed like all content). The engine
/// syscall itself hashes nothing; the shore replay has no zone brain
/// wave logic.
const GOLDEN_HASH: u64 = 0xD946_383F_E854_79F6;

#[test]
fn golden_replay() {
    let content = ContentDb::load(Path::new("../../content")).expect("content loads");
    let program = idlin_botc::template_grinder().expect("template assembles");
    let mut world = World::new(GOLDEN_SEED, &content);

    let joins = TickInputs {
        arrivals: Vec::new(),
        removals: Vec::new(),
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
