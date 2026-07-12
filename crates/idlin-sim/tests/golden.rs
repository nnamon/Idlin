//! Golden replay: a pinned (seed, content, inputs) history must produce the
//! exact same state hash forever, on every platform. CI failure here means
//! either an intentional content/sim change (update the constants below and
//! say so in the commit) or — much worse — a determinism leak.
//!
//! The re-pin comments below are a LEDGER, oldest first: each entry
//! describes the world AS IT WAS at that pin (history, like commits —
//! not current-state claims; later entries supersede earlier ones).

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
/// map rules (map_ends_at, monster_fury_bp, loot_quantity_bp,
/// is_map_instance) AND (AT THE TIME — since reworked by B4 below) the
/// per-pack rarity juice folds joined state_hash, so every digest moved. The shore replay's
/// BEHAVIOR is bit-identical (chart fields zero/false there, pack defs at
/// authored values; the default voyage clock arms only in
/// new_map_instance) — only the fingerprint changed.
/// Re-pinned for #180 (sailing → mapping, operator directive): content-only
/// — the map item's display name, the map_clock/map_tier/map_table serde
/// names in RON, the vocabulary sweep over content-file COMMENTS (every
/// byte under content/ is hashed), and the regenerated content-docs all
/// move content_hash. No sim rule changed; the vocabulary did.
/// Re-pinned for #185 B4 (operator ruling): the hash DOMAIN changed shape —
/// the per-pack def folds (the old rarity-juice patch) left, spawn_rarity_bp
/// joined. Pack defs are immutable content again; the shore replay's
/// BEHAVIOR is bit-identical, only the fingerprint moved.
/// Re-pinned for the no-respawn world + the operator's tuning (#185):
/// SIM RULES changed (packs rise exactly once — monsters never resurrect;
/// the out-of-combat burst heal is characters-only — it was silently
/// resetting kited bosses) AND content moved (pack density ×1.6 campaign /
/// ×2.1 Act 2, non-boss XP ×1.25, the walk-line movement fix's behavior).
/// The shore replay's history is materially different by design.
/// (+ the QueryMonsters clamp 16→64 — content brains widened their scans,
/// gen_abi/content bytes moved.)
// 0xA185C5C2AEAC99A6: respawn_ticks removed from SpawnPack + every zone RON
// (dead schema under the no-respawn world) + the round-4 prose sweep
// (zone comments + narration are content bytes) — content_hash moved; the
// 2000-tick behavior is identical.
// Re-pinned for the difficulty re-anchor (operator: tier-1 maps at 40,
// campaign graduates ~38): map area = 39+tier, the zone arc re-mapped
// (coast 7 … undertow 35), boss levels re-anchored, XP re-tuned (both
// acts ×1.35, bosses re-anchored, curve 80+8l²·1.04^(l−10)), Act-2
// density trimmed, wight re-authored. Content + behavior both moved.
const GOLDEN_HASH: u64 = 0x2B2E_8355_7C33_E810;

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
