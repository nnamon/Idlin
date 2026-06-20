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
pub const SNAPSHOT_FORMAT_VERSION: u32 = 5;

/// Save cadence (ticks): 30 s. Graceful shutdown saves regardless, so
/// this is only the crash-loss window.
pub const SAVE_EVERY_TICKS: u64 = 300;

/// A world key's snapshot directory: filesystem-safe name plus a short
/// hash so sanitization can never collide two keys.
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
                items: 0,
                inventory: Vec::new(),
                equipment: Default::default(),
                allocated: Vec::new(),
                build_plan: Vec::new(),
                currency: Vec::new(),
                sockets: std::collections::BTreeMap::new(),
            },
            program: idlin_botc::assemble("halt\n").unwrap(),
            persist: Vec::new(),
            params: Vec::new(),
            bot_version: 1,
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
