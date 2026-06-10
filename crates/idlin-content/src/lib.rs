//! Game content loaded from `content/`: zones/monsters/items/affixes/gems/
//! tree as RON, NPC brains as `.bot` programs (or assembly).
//! The engine just runs this content — behavior, stats, and layout all live
//! here, not in Rust. The sim receives a validated `ContentDb` by value and
//! never touches the filesystem itself.
//!
//! Brains (`content/brains/*.bot`, or `.asm`) are compiled to versioned VM
//! bytecode at load time, so a content error surfaces at server start,
//! never mid-game.
//!
//! Distances/speeds use integer centi-units (250 = 2.5 world units) so the
//! files stay human-editable without floats; the sim converts to Q16.16.
//!
//! Every load computes a content hash embedded in snapshots and replays: a
//! replay is only meaningful against the exact content it was recorded with.

pub mod stats;

use serde::{Deserialize, Serialize};
use stats::{Grant, Layer, Stat};
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
    #[error("brain {path} failed to build: {msg}")]
    Brain { path: String, msg: String },
    #[error("{path}: zone `{zone}` references unknown monster `{monster}`")]
    UnknownMonster {
        path: String,
        zone: String,
        monster: String,
    },
    #[error("monster `{monster}` references unknown brain `{brain}`")]
    UnknownBrain { monster: String, brain: String },
    #[error("tree node `{node}` links to unknown node `{link}`")]
    UnknownTreeNode { node: String, link: String },
    #[error("the passive tree has nodes but no `start` node")]
    NoStartNode,
    #[error("duplicate id `{id}` in {path}")]
    DuplicateId { path: String, id: String },
    #[error("affix `{affix}`: {msg}")]
    BadAffixTiers { affix: String, msg: String },
}

/// An NPC brain: a `.bot` (or assembly) program compiled to versioned VM
/// bytecode. NPCs run the exact same VM and syscalls as player bots —
/// behavior is content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainDef {
    /// File stem of the source file.
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
    /// Physical attack damage.
    pub damage: i64,
    /// Elemental / chaos attack damage components.
    #[serde(default)]
    pub damage_ele: i64,
    #[serde(default)]
    pub damage_chaos: i64,
    /// Defenses. Accuracy 0 means "derive from level" (60 + 15·level).
    #[serde(default)]
    pub armour: i64,
    #[serde(default)]
    pub evasion: i64,
    #[serde(default)]
    pub accuracy: i64,
    /// Resistances in basis points.
    #[serde(default)]
    pub resist_ele: i64,
    #[serde(default)]
    pub resist_chaos: i64,
    /// Movement speed in centi-units per second.
    pub speed_cps: i32,
    /// Body radius in centi-units (collision/separation).
    #[serde(default = "default_radius_cu")]
    pub radius_cu: i32,
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

fn default_radius_cu() -> i32 {
    45
}

/// Where a piece of gear goes. Weapon stats define the normal attack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GearSlot {
    Weapon,
    Helm,
    Chest,
    Boots,
}

impl GearSlot {
    pub const COUNT: usize = 4;

    pub fn idx(self) -> usize {
        match self {
            GearSlot::Weapon => 0,
            GearSlot::Helm => 1,
            GearSlot::Chest => 2,
            GearSlot::Boots => 3,
        }
    }
}

/// An item base type. Rolled affixes provide everything beyond these bases.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDef {
    pub id: String,
    pub name: String,
    pub slot: GearSlot,
    /// Bag footprint (the inventory is a grid).
    #[serde(default = "default_dim")]
    pub w: u8,
    #[serde(default = "default_dim")]
    pub h: u8,
    /// Weapon: base attack damage by type (replaces unarmed).
    #[serde(default)]
    pub damage_phys: i64,
    #[serde(default)]
    pub damage_ele: i64,
    #[serde(default)]
    pub damage_chaos: i64,
    /// Weapon: attack range in centi-units.
    #[serde(default)]
    pub range_cu: i32,
    /// Weapon: ticks between attacks.
    #[serde(default)]
    pub cooldown_ticks: u32,
    /// Weapon: ranged attack.
    #[serde(default)]
    pub projectile: bool,
    /// Armor: base mitigation/avoidance (armour attenuates physical damage;
    /// evasion makes hits miss).
    #[serde(default)]
    pub armour: i64,
    #[serde(default)]
    pub evasion: i64,
    /// Relative drop weight.
    #[serde(default = "default_weight")]
    pub weight: u32,
    /// Client-side visual key for the equipped mesh (weapons; "" = none).
    #[serde(default)]
    pub model: String,
}

fn default_weight() -> u32 {
    100
}

fn default_dim() -> u8 {
    1
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AffixKind {
    Prefix,
    Suffix,
}

/// One rollable tier: eligible from `ilvl`, value rolled in `min..=max`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AffixTier {
    pub ilvl: u32,
    pub min: i64,
    pub max: i64,
}

/// A rollable item affix: a (stat, layer) grant whose value comes from the
/// highest tier the item level allows.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffixDef {
    pub id: String,
    /// Display: prefixes prepend ("Heavy ..."), suffixes append ("... of X").
    pub name: String,
    pub kind: AffixKind,
    /// Gear slots this affix can appear on.
    pub slots: Vec<GearSlot>,
    #[serde(default = "default_weight")]
    pub weight: u32,
    pub stat: Stat,
    pub layer: Layer,
    /// Must be sorted by ilvl ascending.
    pub tiers: Vec<AffixTier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GemKind {
    Skill,
    Support,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillShape {
    /// Single-target strike at the chosen enemy.
    Target,
    /// Hits everything hostile around the user.
    Nova,
}

fn shape_target() -> SkillShape {
    SkillShape::Target
}

fn default_max_targets() -> u32 {
    1
}

/// A gem: a skill (an active attack the bot can use) or a support (affix
/// grants applied to the skill socketed in its tree cluster). Gems gain XP
/// from kills; levels scale their numbers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GemDef {
    pub id: String,
    pub name: String,
    pub kind: GemKind,
    #[serde(default = "default_weight")]
    pub weight: u32,
    // -- skill fields --
    /// Percent of weapon damage (basis points; 10000 = 100%).
    #[serde(default)]
    pub coeff_bp: i64,
    /// Flat damage the skill itself contributes.
    #[serde(default)]
    pub added_phys: i64,
    #[serde(default)]
    pub added_ele: i64,
    #[serde(default)]
    pub added_chaos: i64,
    #[serde(default = "shape_target")]
    pub shape: SkillShape,
    #[serde(default)]
    pub projectile: bool,
    /// 0 = use the weapon's range.
    #[serde(default)]
    pub range_cu: i32,
    /// Nova radius.
    #[serde(default)]
    pub radius_cu: i32,
    #[serde(default = "default_max_targets")]
    pub max_targets: u32,
    #[serde(default)]
    pub cooldown_ticks: u32,
    /// Skill gems: how many support gems can be socketed INTO this gem.
    #[serde(default)]
    pub support_slots: u32,
    // -- support fields --
    /// Grants applied to the cluster's skill (scaled by gem level).
    #[serde(default)]
    pub grants: Vec<Grant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Travel,
    Notable,
    Keystone,
    /// A gem socket: holds one skill gem, which brings its own support
    /// slots (PoE2-style — support capacity lives on the gem, not the tree).
    Socket,
}

/// A passive tree node: grants affixes exactly like gear does.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeDef {
    pub id: String,
    /// Stable numeric reference (u16) used by compiled bots. Unique,
    /// author-assigned, NEVER reused for a different node.
    pub num: u16,
    pub name: String,
    /// Layout position for the client (abstract units).
    pub pos: (i32, i32),
    /// Undirected edges (either side may declare them).
    #[serde(default)]
    pub links: Vec<String>,
    pub kind: NodeKind,
    #[serde(default)]
    pub grants: Vec<Grant>,
}

/// A tree file: nodes merge across files into one graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeDef {
    pub nodes: Vec<NodeDef>,
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
    /// Sorted by id.
    pub items: Vec<ItemDef>,
    /// Sorted by id.
    pub affixes: Vec<AffixDef>,
    /// Sorted by id.
    pub gems: Vec<GemDef>,
    /// Passive tree, sorted by id. Adjacency in `tree_adj` (same indices).
    pub tree: Vec<NodeDef>,
    pub tree_adj: Vec<Vec<u32>>,
    /// Stable 16-bit name-hash ref per node (same indices); collision-checked.
    pub tree_refs: Vec<u16>,
    /// Index of the shared "start" node everyone begins at.
    pub tree_start: u32,
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

    pub fn item_idx(&self, id: &str) -> Option<usize> {
        self.items.binary_search_by(|i| i.id.as_str().cmp(id)).ok()
    }

    pub fn tree_node_idx(&self, id: &str) -> Option<usize> {
        self.tree.binary_search_by(|n| n.id.as_str().cmp(id)).ok()
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
            } else if rel_str.starts_with("items/") {
                db.items
                    .push(ron::from_str::<ItemDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("affixes/") {
                db.affixes
                    .push(ron::from_str::<AffixDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("gems/") {
                db.gems
                    .push(ron::from_str::<GemDef>(&text).map_err(parse_err)?);
            } else if rel_str.starts_with("tree/") {
                let tree = ron::from_str::<TreeDef>(&text).map_err(parse_err)?;
                db.tree.extend(tree.nodes);
            } else if rel_str.starts_with("brains/") {
                let id = Path::new(&rel_str)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let program = if rel_str.ends_with(".bot") {
                    idlin_botc::compile(&text).map_err(|e| ContentError::Brain {
                        path: rel_str.clone(),
                        msg: e.to_string(),
                    })?
                } else if rel_str.ends_with(".asm") {
                    idlin_botc::assemble(&text).map_err(|e| ContentError::Brain {
                        path: rel_str.clone(),
                        msg: e.to_string(),
                    })?
                } else {
                    continue;
                };
                db.brains.push(BrainDef { id, program });
            }
            // Other directories (items/, skills/, ...) come with later phases;
            // they still feed the hash so changes are never invisible.
        }
        db.content_hash = hash;

        db.monsters.sort_by(|a, b| a.id.cmp(&b.id));
        db.zones.sort_by(|a, b| a.id.cmp(&b.id));
        db.brains.sort_by(|a, b| a.id.cmp(&b.id));
        db.items.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.items.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "items/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        db.affixes.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.affixes.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "affixes/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        // The loot roller picks "highest tier with ilvl <= item level" by
        // scanning from the back, so tier order is load-bearing — reject
        // violations here instead of rolling wrong values at runtime.
        for affix in &db.affixes {
            if affix.tiers.is_empty() {
                return Err(ContentError::BadAffixTiers {
                    affix: affix.id.clone(),
                    msg: "has no tiers (dead affix)".into(),
                });
            }
            for w in affix.tiers.windows(2) {
                if w[0].ilvl >= w[1].ilvl {
                    return Err(ContentError::BadAffixTiers {
                        affix: affix.id.clone(),
                        msg: format!(
                            "tiers must be sorted by ilvl strictly ascending \
                             (found ilvl {} followed by {})",
                            w[0].ilvl, w[1].ilvl
                        ),
                    });
                }
            }
        }
        db.gems.sort_by(|a, b| a.id.cmp(&b.id));
        for w in db.gems.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "gems/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        db.build_tree()?;
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

    /// Sort nodes, resolve links into a symmetric adjacency list, find start.
    fn build_tree(&mut self) -> Result<(), ContentError> {
        self.tree.sort_by(|a, b| a.id.cmp(&b.id));
        for w in self.tree.windows(2) {
            if w[0].id == w[1].id {
                return Err(ContentError::DuplicateId {
                    path: "tree/".into(),
                    id: w[0].id.clone(),
                });
            }
        }
        let mut adj: Vec<Vec<u32>> = vec![Vec::new(); self.tree.len()];
        for (i, node) in self.tree.iter().enumerate() {
            for link in &node.links {
                let Some(j) = self.tree_node_idx(link) else {
                    return Err(ContentError::UnknownTreeNode {
                        node: node.id.clone(),
                        link: link.clone(),
                    });
                };
                // Undirected: either side may declare the edge.
                if !adj[i].contains(&(j as u32)) {
                    adj[i].push(j as u32);
                }
                if !adj[j].contains(&(i as u32)) {
                    adj[j].push(i as u32);
                }
            }
        }
        for edges in &mut adj {
            edges.sort_unstable();
        }
        self.tree_adj = adj;
        self.tree_refs = self.tree.iter().map(|n| n.num).collect();
        let mut seen = std::collections::BTreeMap::new();
        for (i, &r) in self.tree_refs.iter().enumerate() {
            if let Some(prev) = seen.insert(r, i) {
                return Err(ContentError::DuplicateId {
                    path: format!(
                        "tree/ (num {r} used by both `{}` and `{}`)",
                        self.tree[prev].id, self.tree[i].id
                    ),
                    id: self.tree[i].id.clone(),
                });
            }
        }
        self.tree_start = match self.tree_node_idx("start") {
            Some(i) => i as u32,
            None if self.tree.is_empty() => 0,
            None => return Err(ContentError::NoStartNode),
        };
        Ok(())
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
        } else if path
            .extension()
            .is_some_and(|e| e == "ron" || e == "asm" || e == "bot")
        {
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

    /// Build a throwaway content dir from (relative path, contents) pairs.
    struct TempContent(PathBuf);
    impl TempContent {
        fn new(name: &str, files: &[(&str, &str)]) -> TempContent {
            let dir = std::env::temp_dir()
                .join(format!("idlin-content-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            for (rel, body) in files {
                let path = dir.join(rel);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, body).unwrap();
            }
            TempContent(dir)
        }
    }
    impl Drop for TempContent {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const AFFIX_OK: &str = r#"AffixDef(
        id: "hale", name: "Hale", kind: prefix, slots: [helm],
        stat: life, layer: added,
        tiers: [(ilvl: 1, min: 8, max: 15), (ilvl: 3, min: 16, max: 28)],
    )"#;

    #[test]
    fn duplicate_ids_are_rejected() {
        let tc = TempContent::new(
            "dup",
            &[("affixes/a.ron", AFFIX_OK), ("affixes/b.ron", AFFIX_OK)],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::DuplicateId { id, .. }) => assert_eq!(id, "hale"),
            other => panic!("expected DuplicateId, got {other:?}"),
        }
    }

    #[test]
    fn unsorted_affix_tiers_are_rejected() {
        let tc = TempContent::new(
            "tiers",
            &[(
                "affixes/bad.ron",
                r#"AffixDef(
                    id: "bad", name: "Bad", kind: prefix, slots: [helm],
                    stat: life, layer: added,
                    tiers: [(ilvl: 5, min: 1, max: 2), (ilvl: 2, min: 3, max: 4)],
                )"#,
            )],
        );
        match ContentDb::load(&tc.0) {
            Err(ContentError::BadAffixTiers { affix, .. }) => assert_eq!(affix, "bad"),
            other => panic!("expected BadAffixTiers, got {other:?}"),
        }
    }

    #[test]
    fn tierless_affixes_are_rejected() {
        let tc = TempContent::new(
            "notiers",
            &[(
                "affixes/empty.ron",
                r#"AffixDef(
                    id: "empty", name: "Empty", kind: prefix, slots: [helm],
                    stat: life, layer: added, tiers: [],
                )"#,
            )],
        );
        assert!(matches!(
            ContentDb::load(&tc.0),
            Err(ContentError::BadAffixTiers { .. })
        ));
    }

    #[test]
    fn zone_referencing_unknown_monster_is_rejected() {
        let tc = TempContent::new(
            "zoneref",
            &[(
                "zones/test.ron",
                r#"ZoneDef(
                    id: "test", name: "Test", width_u: 10, height_u: 10,
                    spawn_x_u: 5, spawn_y_u: 5,
                    packs: [(monster: "no_such_monster", count: 1,
                             x_u: 2, y_u: 2, radius_u: 1, respawn_ticks: 10)],
                )"#,
            )],
        );
        assert!(matches!(
            ContentDb::load(&tc.0),
            Err(ContentError::UnknownMonster { .. })
        ));
    }

    #[test]
    fn tree_link_to_unknown_node_is_rejected() {
        let tc = TempContent::new(
            "treelink",
            &[(
                "tree/core.ron",
                r#"TreeDef(nodes: [
                    NodeDef(id: "start", num: 1, name: "Start", pos: (0, 0),
                            kind: socket, links: ["nowhere"], grants: []),
                ])"#,
            )],
        );
        assert!(matches!(
            ContentDb::load(&tc.0),
            Err(ContentError::UnknownTreeNode { .. })
        ));
    }
}
