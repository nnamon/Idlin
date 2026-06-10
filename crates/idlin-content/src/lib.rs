//! Game content (zones, monsters, items, affixes, skills) loaded from RON
//! files in `content/`. The sim receives a validated `ContentDb` by value and
//! never touches the filesystem itself.
//!
//! Every load computes a content hash that is embedded in snapshots and
//! replays: a replay is only meaningful against the exact content it was
//! recorded with.
//!
//! Phase 0: directory hashing + the empty db. Schema structs and the RON
//! loader land in Phase 1 alongside the first zone.

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    #[error("io error reading content: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ContentDb {
    /// FNV-1a 64 over every .ron file (path + bytes), in sorted path order.
    pub content_hash: u64,
}

impl ContentDb {
    /// An empty database (tests, headless tools).
    pub fn empty() -> ContentDb {
        ContentDb { content_hash: 0 }
    }

    pub fn load(dir: &Path) -> Result<ContentDb, ContentError> {
        let mut files = Vec::new();
        collect_ron_files(dir, &mut files)?;
        files.sort();

        const FNV_OFFSET: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x100000001b3;
        let mut hash = FNV_OFFSET;
        let mut write = |bytes: &[u8]| {
            for &b in bytes {
                hash ^= b as u64;
                hash = hash.wrapping_mul(FNV_PRIME);
            }
        };
        for path in &files {
            // Hash the path relative to the content root so a rename changes
            // the hash but a different absolute checkout location does not.
            let rel = path.strip_prefix(dir).unwrap_or(path);
            write(rel.to_string_lossy().as_bytes());
            write(&fs::read(path)?);
        }
        Ok(ContentDb { content_hash: hash })
    }
}

fn collect_ron_files(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_ron_files(&path, out)?;
        } else if path.extension().is_some_and(|e| e == "ron") {
            out.push(path);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_dir_is_empty_content() {
        let db = ContentDb::load(Path::new("/nonexistent/idlin-content")).unwrap();
        assert_eq!(db.content_hash, 0xcbf29ce484222325); // FNV offset, nothing hashed
    }
}
