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
/// Re-pinned for boss mechanics (quality pass): content_hash moved — the
/// Undertow's brain became the Sovereign's stage director (add waves +
/// beat lines at life thresholds), two zone lines were added, AND
/// gen_abi.bot regenerated with the QueryMonsters record consts (it
/// lives under content/lib and is hashed like all content). The engine
/// syscall itself hashes nothing; the shore replay has no zone brain
/// wave logic.
const GOLDEN_HASH: u64 = 0x9BBB_4D1D_97E7_DE3E;

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
