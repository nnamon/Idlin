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
/// Re-pinned for #88 first-class ailments MERGED onto a `main` that already carries
/// #50 (VM-ABI generation; main was 0xF08B…). #88 brings: a content_hash change (new
/// ailment affixes; `frost_nova`'s hardcoded chill debuff replaced by an inherent
/// Chill ailment) AND a sim-rule change (cold/fire/lightning hits proc Ignite/Shock/
/// Chill on crit or via ailment-chance), so the 2000-tick grind's outcomes move; AND
/// a FINGERPRINT widening — the ailment `CombatStats` fields (the per-element inflict
/// chances/crits_no_ailment/shock_max/chill_max/ailment_duration, spawn-set for
/// monsters from rolled affixes) and the in-flight projectile's `ailment_chance` now
/// fold into `state_hash`.
/// Re-pinned again for the per-element ailment-chance rework: the single blanket
/// `AilmentChance` stat (which scaled all ailments at once — too strong) is SPLIT into
/// `IgniteChance`/`ShockChance`/`ChillChance`, the proc picks chance by the hit's
/// element, `of_affliction` becomes a HYBRID composed of the three, and the keystone-
/// only `of_composure` weapon affix is DELETED (tombstoned). This moves content_hash
/// (affix effects + tombstone + stat vocab → 0xBA6F31C912F0421D), the fingerprint (3
/// chance fields hashed instead of 1), AND grind outcomes (monsters with of_affliction
/// now derive per-element chances). The determinism trio still agrees.
/// (Prior: 0xBB5A — #88-onto-#50 merge, blanket AilmentChance; 0xF08B — #50 part 2 on
/// main; 0x5349 — #88 standalone, pre-#50-merge; 0x5662 — #86 state_hash widening; etc.)
const GOLDEN_HASH: u64 = 0x53B5_355E_C826_266C;

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
