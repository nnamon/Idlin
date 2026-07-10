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
/// Re-pinned for the wanted-door guard (quality pass, live find): the
/// templates' opportunistic use_exit() ate whatever door was underfoot —
/// the Pressure Court respawn sits beside its SOUTH exit, so a dying bot
/// heading north kept commuting backward. Template bytes only.
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
/// Re-pinned for #178 (the eternal voyage): the HASH DOMAIN grew — the
/// chart rules (map_ends_at, monster_fury_bp, loot_quantity_bp,
/// is_map_instance) AND the per-pack rarity juice (pack.def.magic_bp /
/// rare_bp — chart mints MUTATE these and respawns read them) now fold
/// into state_hash, so every world digest moves. The shore replay's
/// BEHAVIOR is bit-identical (chart fields zero/false there, pack defs at
/// authored values; the default voyage clock arms only in
/// new_map_instance) — only the fingerprint changed.
/// Re-pinned for #180 (sailing → mapping, operator directive): content-only
/// — the map item's display name, the map_clock/map_tier/map_table serde
/// names in RON, the vocabulary sweep over content-file COMMENTS (every
/// byte under content/ is hashed), and the regenerated content-docs all
/// move content_hash. No sim rule changed; the vocabulary did.
const GOLDEN_HASH: u64 = 0xC527_08F2_0FC3_B236;

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
