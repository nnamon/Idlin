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
/// Re-pinned for the #86 grant-unification follow-up: `state_hash` was widened to
/// fingerprint all REPLAY-RELEVANT world state it had silently dropped — active-
/// buff grant internals, the full projectile payload, `intents.move_to`,
/// `CharacterState.build_plan`, the WHOLE `CombatStats` (regen/leech/range/stagger/
/// poise/knockback/use_ticks/speed/projectile/find factors), `MonsterState`
/// (pack_idx/affixes/display_name/skill supports), and the World's zone identity
/// (zone_idx/level/lines). The world is byte-identical (no sim-rule or content
/// change — `content_hash` is unchanged); only the FINGERPRINT widened, so the
/// digest of the same 2000-tick replay moves. The determinism trio still agrees
/// under the wider hash, confirming a representation change, not a leak. (The
/// later item-charges/affix-tier additions left the digest at this value — the
/// 2000-tick golden replay holds no items or monster affixes at the hashed tick.)
/// Re-pinned for #109 (strike-time conditional affixes): (1) `CombatStats` gained
/// `has_strike_conditions`, folded into `state_hash` (whole-struct rule) — a
/// FINGERPRINT widening; AND (2) a content change — the new `of_desperation` affix
/// (strike-time "+phys while below 35% life") shifts `content_hash`
/// (0x31EC…→0x400E_EE4F_FED9_A16C) and the weighted weapon-suffix pool, so the
/// 2000-tick grind's rolls/outcomes move. The strike-time mechanism itself is inert
/// until a character actually wields such an affix below the threshold; the
/// determinism trio still agrees, confirming no leak.
/// Re-pinned for #109 RecentlyKilled (the deferred self strike-time condition):
/// (1) `CombatStats` gained `last_kill_tick: u64`, folded into `state_hash`; AND
/// (2) the new `of_the_hunt` affix ("+phys for 4s after a kill") shifts content_hash
/// (→0x7AD5_C0B2_7F9F_A5C3) and the weapon-suffix pool. Inert until a character
/// wields it and lands a kill; the determinism trio still agrees.
/// (Prior: 0xC190 — #109 B2a; 0x5662 — #86 state_hash widening; 0x8541 — earlier
/// hash-completeness; Phase D 0x5755 — ten new affix files; Phase A 0x0A71; etc.)
const GOLDEN_HASH: u64 = 0x4BCC_A9D3_F91F_A6AE;

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
