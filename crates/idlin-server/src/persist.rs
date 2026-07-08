//! World snapshot persistence. The sim is fully serde-serializable (including
//! every bot VM's memory), so a snapshot plus determinism equals an exact
//! resume.
//!
//! A world and its in-flight ferries (`pending arrivals`) are written together
//! as ONE atomically-published file (temp file + rename), so a crash can never
//! pair a fresh world with a stale pending list — the two are always from the
//! same instant.
//!
//! MULTI-WORLD: every managed world saves under its own key —
//! `data/snapshots/<sanitized-key>-<fnv8>/` — at a consistent point
//! (after the ferry, so every character is in exactly one world's
//! state or pending list), every SAVE_EVERY_TICKS and on graceful
//! shutdown. A character mid-ferry survives the restart.

use anyhow::Context;
use idlin_content::ContentDb;
use idlin_sim::{CharacterBundle, World};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

const SNAP_NAME: &str = "world.snap";

/// Magic prefix stamped on every snapshot file, checked before any decode so an
/// incompatible or foreign file is refused cleanly instead of being fed to
/// postcard (which is non-self-describing and would either error mid-decode or,
/// worse, silently mis-decode misaligned bytes into a plausible-but-corrupt
/// `World`).
const SNAP_MAGIC: [u8; 4] = *b"IDLN";

/// On-disk snapshot format version. BUMP whenever any serialized type reachable
/// from `World` or `CharacterBundle` changes layout (fields added, removed,
/// reordered, or retyped), OR the snapshot envelope itself changes. Same manual
/// discipline as `GOLDEN_HASH` and `PROTO_VERSION`: an old snapshot carrying a
/// different version is refused cleanly (the world starts fresh), never
/// mis-decoded.
///
/// v2 (#54 PR2b): `CharacterState` lost its `pouch` field and `PlacedItem.item`
/// was retyped `Item` → `BagItem` (gems became 1×1 bag items).
/// v3 (#63): the world and its pending arrivals now share ONE file — the
/// snapshot payload is `(World, Vec<CharacterBundle>)` instead of a bare
/// `World` with a sidecar `pending.snap` — so a torn pair is impossible.
/// v4 (#91): the equipment array grew 7 → 12 — accessory slots (2 rings, a
/// belt, an amulet) plus a gloves slot — so `Character` serializes five more
/// `Option<Item>`.
/// v5 (#86 Phase A): affixes became multi-effect (hybrid support), so
/// `RolledAffix` serializes `values: Vec<i64>` instead of a single `value` — a
/// v4 snapshot's items would fail to decode, so refuse them cleanly.
/// v6 (#86 Phase B): the `Stat` enum lost `MeleePhys`, shifting the postcard
/// variant index of every later stat. `Grant { stat: Stat, .. }` is serialized in
/// active-buff and projectile-debuff state (`ActiveEffect::Buff`), so a v5
/// snapshot's buffs would decode shifted stats — refuse them cleanly.
/// v7 (#86 unify): `Grant` gained a `condition: Option<Condition>` field (one
/// conditional model for affixes, tree, and buffs), changing the postcard layout
/// of every serialized `Grant` — in active-buff and projectile-debuff state
/// alike — so a v6 snapshot's grants would mis-decode; refuse them cleanly.
/// v8 (#86 unify): `Zone::by_net` became a `#[serde(skip)]` derived index
/// (rebuilt from `slots` on resume rather than trusted from the snapshot), so it
/// left the postcard byte stream — a v7 snapshot's `Zone` would mis-decode.
/// v9 (#88 ailments): the `Stat` enum grew (discriminants in serialized `Grant`s),
/// `ActiveEffect` gained an `Ailment` variant, and `CombatStats` gained 5 fields —
/// all change the postcard layout, so a v8 snapshot would mis-decode; refuse it.
/// v10 (#88 per-element rework): the blanket `AilmentChance` stat was split into
/// `IgniteChance`/`ShockChance`/`ChillChance` — `Stat` discriminants shifted (in
/// serialized `Grant`s) AND `CombatStats`'s one `ailment_chance` field became three;
/// both change the postcard layout, so a v9 snapshot would mis-decode; refuse it.
/// v11 (#109 strike conditions): `CombatStats` gained `has_strike_conditions: bool`
/// (the strike-time conditional cache), adding a serialized field to every entity's
/// combat block — a v10 snapshot's `CombatStats` would mis-decode; refuse it.
/// v12 (#109 RecentlyKilled): `CombatStats` gained `last_kill_tick: u64` (the post-kill
/// window) — another serialized combat field; a v11 snapshot's `CombatStats` mis-decodes.
/// v13 (#109 B2b target conditions): `CombatStats` gained `target_grants: Vec<Grant>` (the
/// per-victim target-dependent conditional grants, e.g. "vs ignited") — another serialized
/// combat field; a v12 snapshot's `CombatStats` would mis-decode. Refuse it.
/// v14 (#129 fog of war): `CharacterState` gained `explored: Vec<u64>` (the per-character
/// discovered-cells bitset that drives the wire visibility filter) — a serialized character
/// field; a v13 snapshot's `CharacterState` would mis-decode. Refuse it.
/// v15 (#136 campaign spine): `CharacterState` gained `story_acts: u32` (campaign progress)
/// and `ExitState` gained `requires_act: u32` (story-sealed exits) — both serialized; a v14
/// snapshot would mis-decode. Refuse it.
/// v16 (#136 charts): `CharacterBundle` gained `chart: Option<ChartTicket>` and `World`
/// gained `loot_quantity_bp` / `chart_table` / `is_chart_instance` — all serialized; a v15
/// snapshot would mis-decode. Refuse it.
/// v17 (#136 uniques): `Item` gained `unique_idx: Option<u32>` — serialized; a v16 snapshot
/// would mis-decode. Refuse it.
/// v18 (#148 A2.5): `Intents` gained `path: Vec<FxV2>` (cached A* waypoints) and `ItemDef`
/// gained `energy_shield` — serialized; a v17 snapshot would mis-decode. Refuse it.
/// v19 (#148 A4): `ChartTicket` gained the rule fields (`fury_bp`/`clock`/`boss`) and `World`
/// gained `monster_fury_bp`/`voyage_ends_at` — serialized; a v18 snapshot would mis-decode.
/// v20 (#148 A5): `CharacterState` gained `stash: Vec<BagItem>` — serialized; a v19
/// snapshot would mis-decode. Refuse it.
/// v21 (#148 A6): `CharacterState` gained `deaths: u64` — serialized; a v20 snapshot
/// would mis-decode. Refuse it.
pub const SNAPSHOT_FORMAT_VERSION: u32 = 21;

/// Save cadence (ticks): 30 s. Graceful shutdown saves regardless, so
/// this is only the crash-loss window.
pub const SAVE_EVERY_TICKS: u64 = 300;

/// A world key's snapshot directory: filesystem-safe name plus a short
/// hash so sanitization can never collide two keys.
/// The world's KEY, plaintext, beside its snapshot: `world_dir` hashes the
/// key one-way, so resuming a world whose key isn't known at boot (a chart
/// instance, #136 T4) needs it written down.
pub fn save_world_key(dir: &Path, key: &str) {
    let _ = std::fs::write(dir.join("key"), key);
}

/// Every (key, dir) under the snapshot base — booted worlds resume by
/// derived dir; anything else (chart voyages) resumes from this scan.
pub fn scan_world_keys(base: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(base) else {
        return out;
    };
    for entry in rd.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        if let Ok(key) = std::fs::read_to_string(dir.join("key")) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                out.push((key, dir));
            }
        }
    }
    out.sort();
    out
}

pub fn world_dir(base: &Path, world_key: &str) -> PathBuf {
    let safe: String = world_key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut h = idlin_content::FNV1A_OFFSET;
    for b in world_key.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(idlin_content::FNV1A_PRIME);
    }
    base.join(format!("{safe}-{:08x}", (h >> 32) as u32))
}

/// Prepend the 8-byte format header (`SNAP_MAGIC` ++ version, little-endian) to
/// a postcard payload. No payload checksum — postcard decode plus the existing
/// content-hash gate already catch body corruption; the header's only job is
/// format *identity*.
fn frame(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + payload.len());
    out.extend_from_slice(&SNAP_MAGIC);
    out.extend_from_slice(&SNAPSHOT_FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(payload);
    out
}

/// Validate a snapshot header and return the payload slice, or a noun-phrase
/// reason that reads as `"<file>: <reason>"`. Legacy headerless files (raw
/// postcard, no header) fail the magic check.
fn unframe(bytes: &[u8]) -> Result<&[u8], String> {
    if bytes.len() < 8 {
        return Err("truncated header".to_string());
    }
    if bytes[..4] != SNAP_MAGIC {
        return Err("bad magic (not an Idlin snapshot)".to_string());
    }
    let version = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
    if version != SNAPSHOT_FORMAT_VERSION {
        return Err(format!(
            "format v{version} (build expects v{SNAPSHOT_FORMAT_VERSION})"
        ));
    }
    Ok(&bytes[8..])
}

/// Publish `bytes` to `path` atomically: write a sibling temp file, then rename
/// over the destination. A crash mid-write leaves the stale-but-valid old file,
/// never a half-written one.
fn atomic_publish(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).context("write snapshot temp file")?;
    fs::rename(&tmp, path).context("publish snapshot")?;
    Ok(())
}

/// Save a managed world together with its not-yet-arrived ferries, as a single
/// atomically-published snapshot. World and pendings are one serialized unit, so
/// a resume can never see them out of sync.
pub fn save_managed(
    world: &World,
    pending_arrivals: &[CharacterBundle],
    dir: &Path,
) -> anyhow::Result<()> {
    fs::create_dir_all(dir).context("create snapshot dir")?;
    let payload =
        postcard::to_allocvec(&(world, pending_arrivals)).context("serialize snapshot")?;
    atomic_publish(&dir.join(SNAP_NAME), &frame(&payload))
}

/// Load a managed world and its in-flight arrivals if present and compatible
/// with the loaded content; None = start fresh.
pub fn load_managed(content: &ContentDb, dir: &Path) -> Option<(World, Vec<CharacterBundle>)> {
    let path = dir.join(SNAP_NAME);
    let bytes = fs::read(&path).ok()?;
    let payload = match unframe(&bytes) {
        Ok(p) => p,
        Err(why) => {
            warn!("snapshot at {}: {why}; starting fresh", path.display());
            return None;
        }
    };
    let (mut world, pendings): (World, Vec<CharacterBundle>) = match postcard::from_bytes(payload) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "snapshot at {} is unreadable ({e}); starting fresh",
                path.display()
            );
            return None;
        }
    };
    match world.attach_content(content) {
        Ok(()) => {
            // Pendings ride ALONGSIDE the world (in-flight arrivals), so
            // attach_content didn't see them; validate their items too — an
            // arrival's malformed affix would otherwise reach AffixDef::grants
            // when apply_joins refreshes it (#86 fail-closed resume).
            if let Some((i, why)) = pendings.iter().enumerate().find_map(|(i, b)| {
                World::first_malformed_character_affix(content, &b.character).map(|w| (i, w))
            }) {
                warn!(
                    "snapshot at {}: pending arrival {i}: {why}; starting fresh",
                    path.display()
                );
                return None;
            }
            info!(
                tick = world.tick_count(),
                pending = pendings.len(),
                "resuming world from snapshot (state hash {:016x})",
                world.state_hash()
            );
            Some((world, pendings))
        }
        Err(why) => {
            warn!("snapshot at {}: {why}; starting fresh", path.display());
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use idlin_sim::entity::CharacterState;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("idlin-persist-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    /// A minimal in-flight ferry bundle, enough to round-trip through a snapshot.
    fn bundle(name: &str) -> CharacterBundle {
        CharacterBundle {
            character: CharacterState {
                name: name.into(),
                level: 1,
                xp: 0,
                respawn_at: None,
                kills: 0,
                deaths: 0,
                items: 0,
                inventory: Vec::new(),
                equipment: Default::default(),
                allocated: Vec::new(),
                build_plan: Vec::new(),
                currency: Vec::new(),
                stash: Vec::new(),
                sockets: std::collections::BTreeMap::new(),
                explored: Vec::new(),
                story_acts: 0,
            },
            program: idlin_botc::assemble("halt\n").unwrap(),
            persist: Vec::new(),
            params: Vec::new(),
            bot_version: 1,
            chart: None,
        }
    }

    #[test]
    fn snapshot_roundtrip_resumes_exactly() {
        let content = ContentDb::empty();
        let mut world = World::new(7, &content);
        let inputs = idlin_sim::TickInputs::default();
        for _ in 0..25 {
            world.tick(&inputs);
        }
        let dir = temp_dir("roundtrip");
        save_managed(&world, &[], &dir).expect("save snapshot");
        let (resumed, pendings) = load_managed(&content, &dir).expect("load snapshot");
        assert_eq!(resumed.tick_count(), world.tick_count());
        assert_eq!(resumed.state_hash(), world.state_hash());
        assert!(pendings.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pending_arrivals_resume_with_their_world() {
        // A character mid-ferry is saved IN the same blob as the world and comes
        // back with it — the whole point of persisting pendings.
        let content = ContentDb::empty();
        let world = World::new(7, &content);
        let dir = temp_dir("pendings");
        save_managed(&world, &[bundle("InFlight")], &dir).expect("save");
        let (_, pendings) = load_managed(&content, &dir).expect("load");
        assert_eq!(pendings.len(), 1, "the in-flight character survives");
        assert_eq!(pendings[0].character.name, "InFlight");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_malformed_pending_affix_refuses_the_resume() {
        // Pendings ride alongside the world; a malformed rolled affix on an
        // in-flight character must fail the resume CLOSED (#86) — otherwise it
        // reaches AffixDef::grants when the arrival refreshes. With empty content
        // any affix_idx is out of range, so this rolled affix is unresolvable.
        // Mutation: drop the pending-validation loop in load_managed and this
        // resumes (Some) instead of starting fresh (None).
        use idlin_sim::entity::{Item, Rarity, RolledAffix};
        let content = ContentDb::empty();
        let world = World::new(7, &content);
        let mut b = bundle("Corrupt");
        b.character.equipment[0] = Some(Item {
            base_idx: 0,
            rarity: Rarity::Magic,
            item_level: 1,
            affixes: vec![RolledAffix {
                affix_idx: 0,
                values: vec![1],
                tier: 0,
            }],
            name: String::new(),
            charges: 0,
            unique_idx: None,
        });
        let dir = temp_dir("bad-pending");
        save_managed(&world, &[b], &dir).expect("save");
        assert!(
            load_managed(&content, &dir).is_none(),
            "a malformed pending arrival fails the resume closed"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stray_pending_file_cannot_desync_the_resume() {
        // The pre-v3 format wrote world + pendings as two files; a crash between
        // their renames could pair a fresh world with a stale pending list. The
        // combined blob is the single source of truth, so a leftover
        // `pending.snap` from an old build is simply ignored.
        let content = ContentDb::empty();
        let world = World::new(7, &content);
        let dir = temp_dir("stray-pending");
        save_managed(&world, &[bundle("InFlight")], &dir).expect("save");
        fs::write(dir.join("pending.snap"), b"stale garbage from a torn save").unwrap();
        let (_, pendings) = load_managed(&content, &dir).expect("load");
        assert_eq!(
            pendings.len(),
            1,
            "pendings come from the blob, not the stray"
        );
        assert_eq!(pendings[0].character.name, "InFlight");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_snapshot_means_fresh_world() {
        let dir = temp_dir("missing");
        assert!(load_managed(&ContentDb::empty(), &dir).is_none());
    }

    #[test]
    fn corrupt_snapshot_is_refused_not_fatal() {
        // Garbage fails the magic check before any decode is attempted.
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SNAP_NAME), b"not a postcard world").unwrap();
        assert!(load_managed(&ContentDb::empty(), &dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_crashed_voyage_resumes_by_key_scan() {
        // #136 T4: chart instances snapshot like any world; their dirs carry
        // a plaintext `key` file so the boot scan can find them (the dirname
        // is a one-way hash of the key). The character inside survives the
        // restart. Mutation: drop save_world_key from the save loop, or the
        // is_chart_instance marker → the scan (or the accept gate) fails.
        let content = ContentDb::load(std::path::Path::new("../../content")).unwrap();
        let world = World::new_chart_instance(
            9,
            &content,
            "charted_shallows",
            idlin_sim::ChartTicket {
                tier: 2,
                rarity_bp: 0,
                quantity_bp: 0,
                fury_bp: 0,
                clock: 0,
                boss: false,
            },
        );
        let base = std::env::temp_dir().join(format!("idlin-voyage-scan-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let key = "charted_shallows#Mariner@7";
        let dir = world_dir(&base, key);
        save_managed(&world, &[bundle("Mariner")], &dir).unwrap();
        save_world_key(&dir, key);
        let found = scan_world_keys(&base);
        assert_eq!(found.len(), 1, "the voyage is discoverable");
        assert_eq!(found[0].0, key);
        let (back, pendings) = load_managed(&content, &found[0].1).expect("resumes");
        assert!(back.is_chart_instance(), "ephemerality survives the disk");
        assert_eq!(
            content.zones[back.zone_index() as usize].id,
            "charted_shallows",
            "the zone id comes back from the state itself"
        );
        assert_eq!(pendings[0].character.name, "Mariner");
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn a_pending_chart_ticket_survives_the_snapshot() {
        // #136 T4: a mid-ferry chart bundle (saved at the post-ferry
        // boundary) must resume with its ticket intact — otherwise a restart
        // silently downgrades a paid voyage to a walk home. Mutation: drop
        // `chart` from the bundle serde → this fails to decode the juice.
        let content = ContentDb::empty();
        let world = World::new(3, &content);
        let mut b = bundle("Mariner");
        b.chart = Some(idlin_sim::ChartTicket {
            tier: 4,
            rarity_bp: 2100,
            quantity_bp: 900,
            fury_bp: 0,
            clock: 0,
            boss: false,
        });
        let dir = temp_dir("chart-ticket");
        save_managed(&world, &[b], &dir).unwrap();
        let (_, pendings) = load_managed(&content, &dir).expect("snapshot loads");
        let back = &pendings[0];
        assert_eq!(back.character.name, "Mariner");
        assert_eq!(
            back.chart,
            Some(idlin_sim::ChartTicket {
                tier: 4,
                rarity_bp: 2100,
                quantity_bp: 900,
                fury_bp: 0,
                clock: 0,
                boss: false,
            })
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn nonzero_story_progress_survives_the_pending_bundle() {
        // #136: campaign state must roundtrip — every other fixture uses
        // zeros, so a `#[serde(skip)]` on story_acts would pass them all.
        // (The live-world half — ExitState.requires_act + an in-zone
        // character's story — is covered in-crate in idlin-sim, where the
        // zone is reachable.) Mutation: skip story_acts → this fails.
        let content = ContentDb::empty();
        let world = World::new(0x51A7, &content);
        let mut pilgrim = bundle("Pilgrim");
        pilgrim.character.story_acts = 0b101; // acts 1 + 3
        let dir = temp_dir("story_roundtrip");
        save_managed(&world, &[pilgrim], &dir).expect("save");
        let (_, pendings) = load_managed(&content, &dir).expect("load");
        assert_eq!(
            pendings[0].character.story_acts, 0b101,
            "story_acts roundtrips through the snapshot file"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn snapshot_format_version_is_pinned() {
        // Deliberate checkpoint (like GOLDEN_HASH / PROTO_VERSION): any serialized-layout
        // change must bump this ON PURPOSE. `version_mismatch_is_refused` below is relative
        // (`+1`), so it can't catch a forgotten/reverted bump — this exact pin does. Update
        // it together with the layout change and the version-history note above.
        assert_eq!(SNAPSHOT_FORMAT_VERSION, 21);
    }

    #[test]
    fn version_mismatch_is_refused() {
        // A snapshot stamped with a future format version is refused at the
        // header, before any decode — never mis-decoded.
        let content = ContentDb::empty();
        let world = World::new(7, &content);
        let dir = temp_dir("version-mismatch");
        fs::create_dir_all(&dir).unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SNAP_MAGIC);
        bytes.extend_from_slice(&(SNAPSHOT_FORMAT_VERSION + 1).to_le_bytes());
        bytes.extend_from_slice(
            &postcard::to_allocvec(&(&world, &Vec::<CharacterBundle>::new())).unwrap(),
        );
        fs::write(dir.join(SNAP_NAME), &bytes).unwrap();
        assert!(load_managed(&content, &dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn legacy_headerless_snapshot_is_refused() {
        // Pre-versioning snapshots were raw postcard with no header; they fail
        // the magic check cleanly instead of mis-decoding.
        let content = ContentDb::empty();
        let world = World::new(7, &content);
        let dir = temp_dir("legacy-headerless");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SNAP_NAME), postcard::to_allocvec(&world).unwrap()).unwrap();
        assert!(load_managed(&content, &dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn content_hash_mismatch_is_refused() {
        // A world snapshotted against real content must not resume against
        // empty content (and vice versa) — the hash gate catches it.
        let real = ContentDb::load(std::path::Path::new("../../content")).expect("real content");
        let world = World::new(7, &real);
        let dir = temp_dir("mismatch");
        save_managed(&world, &[], &dir).expect("save snapshot");
        assert!(load_managed(&ContentDb::empty(), &dir).is_none());
        assert!(load_managed(&real, &dir).is_some());
        let _ = fs::remove_dir_all(&dir);
    }
}
