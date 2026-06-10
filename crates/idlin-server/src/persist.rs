//! World snapshot persistence. The sim is fully serde-serializable (including
//! every bot VM's memory), so a snapshot plus determinism equals an exact
//! resume. Writes are atomic (temp file + rename).

use anyhow::Context;
use idlin_content::ContentDb;
use idlin_sim::World;
use std::fs;
use std::path::Path;
use tracing::{info, warn};

const SNAP_NAME: &str = "world.snap";

pub fn save_world(world: &World, dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(dir).context("create snapshot dir")?;
    let bytes = postcard::to_allocvec(world).context("serialize world")?;
    let tmp = dir.join(format!("{SNAP_NAME}.tmp"));
    let path = dir.join(SNAP_NAME);
    fs::write(&tmp, &bytes).context("write snapshot temp file")?;
    fs::rename(&tmp, &path).context("publish snapshot")?;
    Ok(())
}

/// Load the latest snapshot if present and compatible with the loaded
/// content; otherwise None (caller starts a fresh world).
pub fn load_world(content: &ContentDb, dir: &Path) -> Option<World> {
    let path = dir.join(SNAP_NAME);
    let bytes = fs::read(&path).ok()?;
    let mut world: World = match postcard::from_bytes(&bytes) {
        Ok(w) => w,
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
                "resuming world from snapshot (state hash {:016x})",
                world.state_hash()
            );
            Some(world)
        }
        Err(snapshot_hash) => {
            warn!(
                "snapshot content hash {snapshot_hash:016x} != loaded content \
                 {:016x}; starting fresh",
                content.content_hash
            );
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use idlin_sim::TickInputs;
    use std::path::PathBuf;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("idlin-persist-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn snapshot_roundtrip_resumes_exactly() {
        let content = ContentDb::empty();
        let mut world = World::new(7, &content);
        let inputs = TickInputs::default();
        for _ in 0..25 {
            world.tick(&inputs);
        }
        let dir = temp_dir("roundtrip");
        save_world(&world, &dir).expect("save snapshot");
        let resumed = load_world(&content, &dir).expect("load snapshot");
        assert_eq!(resumed.tick_count(), world.tick_count());
        assert_eq!(resumed.state_hash(), world.state_hash());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_snapshot_means_fresh_world() {
        let dir = temp_dir("missing");
        assert!(load_world(&ContentDb::empty(), &dir).is_none());
    }

    #[test]
    fn corrupt_snapshot_is_refused_not_fatal() {
        let dir = temp_dir("corrupt");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(SNAP_NAME), b"not a postcard world").unwrap();
        assert!(load_world(&ContentDb::empty(), &dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn content_hash_mismatch_is_refused() {
        // A world snapshotted against real content must not resume against
        // empty content (and vice versa) — the hash gate catches it.
        let real = ContentDb::load(std::path::Path::new("../../content")).expect("real content");
        let world = World::new(7, &real);
        let dir = temp_dir("mismatch");
        save_world(&world, &dir).expect("save snapshot");
        assert!(load_world(&ContentDb::empty(), &dir).is_none());
        assert!(load_world(&real, &dir).is_some());
        let _ = fs::remove_dir_all(&dir);
    }
}
