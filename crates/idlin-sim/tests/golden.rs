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
/// Re-pinned for the #86 grant-unification follow-up: `state_hash` was made a
/// COMPLETE fingerprint of replay-relevant persisted state — it had silently
/// dropped a lot of it. Now hashed: active-buff grant internals, the full
/// projectile payload, `intents.move_to`, `CharacterState.build_plan`, the WHOLE
/// `CombatStats` (regen/leech/range/stagger/poise/knockback/use_ticks/speed/
/// projectile/find factors), `MonsterState` (pack_idx/affixes/display_name/skill
/// supports), and the World's zone identity (zone_idx/level/lines). The world is
/// byte-identical (no sim-rule or content change — `content_hash` is unchanged);
/// only the FINGERPRINT widened, so the digest of the same 2000-tick replay
/// moves. The determinism trio still agrees under the wider hash, confirming a
/// representation change, not a leak.
/// (Prior: 0x8541 — first hash-completeness pass; Phase D 0x5755 — ten new affix
/// files; Phase A 0x0A71 — effects-list schema; #98 skill life cost; etc.)
const GOLDEN_HASH: u64 = 0x5662_D967_D6E4_BF38;

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
