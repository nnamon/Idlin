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
/// Re-pinned for the affix-pool extension (#103 follow-up): nine affix files
/// added under content/ (of_leeching/of_siphoning/of_ruin/of_frost/of_sparks on
/// weapons; of_renewal/of_sealing on armour; of_channeling/of_casting on caster
/// gear), plus the regenerated content/ids.ron and content/lib/gen_ids.bot.
/// `content_hash` (FNV-1a over the rel-path + bytes of every file UNDER content/,
/// see `ContentDb::load`) folds into `state_hash`, so adding these files moves
/// the golden — the §4-expected re-pin for any content edit. (web/public/
/// content-docs.json is regenerated too, but lives under web/, NOT content/, so
/// it does not contribute to `content_hash`.) The affixes make leech, regen,
/// crit-multi, chaos-resist, and cold/lightning damage reachable through gear;
/// their engine paths are covered by the #103 combat unit tests, and the affixes
/// themselves by `affix_pool_subscriptions_resolve` +
/// `affix_pool_extension_wires_the_dark_stats` — not by this replay.
/// (Prior: #98 skill life cost + cost_mult; #91 accessory/gloves slots; etc.)
const GOLDEN_HASH: u64 = 0x5D21_B764_DAC4_E5AF;

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
