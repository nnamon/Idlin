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
