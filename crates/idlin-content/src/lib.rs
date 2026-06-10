//! Game content loaded from `content/`: zones and monsters as RON, NPC
//! brains as bot assembly (items/skills/affixes arrive in later phases).
//! The engine just runs this content — behavior, stats, and layout all live
//! here, not in Rust. The sim receives a validated `ContentDb` by value and
//! never touches the filesystem itself.
//!
//! Brains (`content/brains/*.asm`) are assembled to versioned VM bytecode at
//! load time, so a content error surfaces at server start, never mid-game.
//!
//! Distances/speeds use integer centi-units (250 = 2.5 world units) so the
//! files stay human-editable without floats; the sim converts to Q16.16.
//!
//! Every load computes a content hash embedded in snapshots and replays: a
//! replay is only meaningful against the exact content it was recorded with.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum ContentError {
    #[error("io error reading content: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error in {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: Box<ron::error::SpannedError>,
    },
    #[error("brain {path} failed to assemble: {source}")]
    Brain {
        path: String,
        #[source]
        source: idlin_botc::AsmError,
    },
    #[error("{path}: zone `{zone}` references unknown monster `{monster}`")]
    UnknownMonster {
        path: String,
        zone: String,
        monster: String,
    },
    #[error("monster `{monster}` references unknown brain `{brain}`")]
    UnknownBrain { monster: String, brain: String },
    #[error("duplicate id `{id}` in {path}")]
    DuplicateId { path: String, id: String },
}

/// An NPC brain: bot assembly compiled to versioned VM bytecode. NPCs run on
/// the exact same VM and syscalls as player bots — behavior is content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainDef {
    /// File stem of the .asm source.
    pub id: String,
    /// Assembled, versioned bytecode container.
    pub program: Vec<u8>,
}

/// A monster archetype. `model` picks the client-side visual; `brain` picks
/// the bot program that drives it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonsterDef {
    pub id: String,
    pub name: String,
    pub model: String,
    /// BrainDef id driving this NPC.
    pub brain: String,
    /// Hostile NPCs fight players; non-hostile ones are scenery/services.
    pub hostile: bool,
    pub level: u32,
    pub life: i64,
    pub damage: i64,
    /// Movement speed in centi-units per second.
    pub speed_cps: i32,
    /// Attack range in centi-units.
    pub range_cu: i32,
    /// Ticks between attacks.
    pub cooldown_ticks: u32,
    /// Aggro radius in centi-units.
    pub aggro_radius_cu: i32,
    /// XP granted to the killer.
    pub xp: i64,
    /// Ranged attack (client renders a projectile tracer).
    pub projectile: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpawnPack {
    /// MonsterDef id.
    pub monster: String,
    pub count: u32,
    /// Pack anchor, in whole units.
    pub x_u: i32,
    pub y_u: i32,
    /// Spawn jitter radius around the anchor, whole units.
    pub radius_u: i32,
    /// Ticks after a wipe before the pack respawns.
    pub respawn_ticks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneDef {
    pub id: String,
    pub name: String,
    /// Zone extent in whole units (logical 2D plane).
    pub width_u: i32,
    pub height_u: i32,
    /// Character spawn/respawn point, whole units.
    pub spawn_x_u: i32,
    pub spawn_y_u: i32,
    pub packs: Vec<SpawnPack>,
}

#[derive(Debug, Clone, Default)]
pub struct ContentDb {
    /// FNV-1a 64 over every content file (relative path + bytes), sorted by path.
    pub content_hash: u64,
    /// Sorted by id — indices into this vec are stable for a given content set.
    pub monsters: Vec<MonsterDef>,
    /// Sorted by id.
    pub zones: Vec<ZoneDef>,
    /// Sorted by id.
    pub brains: Vec<BrainDef>,
}

impl ContentDb {
    /// An empty database (tests, headless tools).
    pub fn empty() -> ContentDb {
        ContentDb::default()
    }

    pub fn monster_idx(&self, id: &str) -> Option<usize> {
        self.monsters
            .binary_search_by(|m| m.id.as_str().cmp(id))
            .ok()
    }

    pub fn brain_idx(&self, id: &str) -> Option<usize> {
        self.brains.binary_search_by(|b| b.id.as_str().cmp(id)).ok()
    }

    pub fn zone(&self, id: &str) -> Option<&ZoneDef> {
        self.zones
            .binary_search_by(|z| z.id.as_str().cmp(id))
            .ok()
            .map(|i| &self.zones[i])
    }

    pub fn load(dir: &Path) -> Result<ContentDb, ContentError> {
        let mut files = Vec::new();
        collect_ron_files(dir, &mut files)?;
        files.sort();

        const FNV_OFFSET: u64 = 0xcbf29ce484222325;
        const FNV_PRIME: u64 = 0x100000001b3;
        let mut hash = FNV_OFFSET;
        let write = |hash: &mut u64, bytes: &[u8]| {
            for &b in bytes {
                *hash ^= b as u64;
                *hash = hash.wrapping_mul(FNV_PRIME);
            }
        };

        let mut db = ContentDb::default();
        for path in &files {
            let rel = path.strip_prefix(dir).unwrap_or(path);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let bytes = fs::read(path)?;
            write(&mut hash, rel_str.as_bytes());
            write(&mut hash, &bytes);

            let text = String::from_utf8_lossy(&bytes);
            let parse_err = |source| ContentError::Parse {
                path: rel_str.clone(),
                source: Box::new(source),
            };
            if rel_str.starts_with("monsters/") {
                db.monsters
                    .push(ron::from_str::<MonsterDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("zones/") {
                db.zones
                    .push(ron::from_str::<ZoneDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("brains/") && rel_str.ends_with(".asm") {
                let id = Path::new(&rel_str)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let program =
                    idlin_botc::assemble(&text).map_err(|source| ContentError::Brain {
                        path: rel_str.clone(),
                        source,
                    })?;
                db.brains.push(BrainDef { id, program });
            }
            // Other directories (items/, skills/, ...) come with later phases;
            // they still feed the hash so changes are never invisible.
        }
        db.content_hash = hash;

        db.monsters.sort_by(|a, b| a.id.cmp(&b.id));
        db.zones.sort_by(|a, b| a.id.cmp(&b.id));
        db.brains.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.monsters.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "monsters/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        for w in db.zones.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "zones/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        for zone in &db.zones {
            for pack in &zone.packs {
                if db.monster_idx(&pack.monster).is_none() {
                    return Err(ContentError::UnknownMonster {
                        path: format!("zones/{}.ron", zone.id),
                        zone: zone.id.clone(),
                        monster: pack.monster.clone(),
                    });
                }
            }
        }
        for monster in &db.monsters {
            if db.brain_idx(&monster.brain).is_none() {
                return Err(ContentError::UnknownBrain {
                    monster: monster.id.clone(),
                    brain: monster.brain.clone(),
                });
            }
        }
        Ok(db)
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
        } else if path.extension().is_some_and(|e| e == "ron" || e == "asm") {
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
        assert!(db.monsters.is_empty());
    }

    #[test]
    fn loads_the_real_content_dir() {
        // The workspace content/ directory must always parse and validate.
        let db = ContentDb::load(Path::new("../../content")).unwrap();
        assert!(!db.zones.is_empty(), "expected at least one zone");
        assert!(!db.monsters.is_empty(), "expected at least one monster");
        let zone = db
            .zone("withered_shore")
            .expect("withered_shore must exist");
        assert!(!zone.packs.is_empty());
    }
}
