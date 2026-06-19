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
/// Re-pinned for #98 (skill life cost + general support cost multiplier). Two
/// REPRESENTATION changes move the hash while the sim TRAJECTORY stays identical.
/// One: the 6 support gems renamed `mana_mult` → `cost_mult` in their RON and
/// `hostile_melee.bot` widened its ReadSkills stride 36 → 40 — both edit files
/// under content/, moving `content_hash` (FNV over content/), which folds into
/// `state_hash`. Two: the ReadSkills record grew a 10th word (life_cost), so the
/// grinder template recompiled to a 40-byte stride and the two golden grinder
/// bots carry that new bytecode in hashed state. Behavior is identical — mana
/// cost is computed byte-for-byte as before, no content carries a life cost
/// (default 0), and the bot reader/writer record strides ALWAYS agree, so every
/// bot reads the same logical (ready, target_mode) it read before (life_cost is
/// appended past them at +36 and unread by the stock bots); only the
/// representation shifted.
/// (Prior: #91 accessory/gloves slots + affixes; #54 PR3 grinder rewrite; etc.)
const GOLDEN_HASH: u64 = 0x2779_BEAA_C621_F4D7;

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
