//! Stable content ids — the bot↔engine contract (RFC #54).
//!
//! Every bot-referenceable content def has a stable, tool-assigned `num`: a
//! tagged positive `i32` where the high bits encode the CATEGORY and the low
//! bits a per-category SEQUENCE. Nums are locked in `content/ids.ron` and are
//! NEVER renumbered or reused — a removed def's num is tombstoned (kept in the
//! registry, never handed out again). Bots reference content through generated
//! consts; reads return nums; the docs publish the name⇄num map.
//!
//! The layout (and the category codes) are part of the bytecode ABI: bots bake
//! `num >> SEQ_BITS` to recover the category. Changing either is a
//! `BYTECODE_FORMAT_VERSION` bump.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Bits reserved for the per-category sequence. The category occupies the bits
/// above it, and bit 31 stays 0 so every num is a positive `i32` (the VM word).
/// 8 category bits + 23 sequence bits = 31 → 256 categories, ~8.4M ids each.
pub const SEQ_BITS: u32 = 23;
pub const SEQ_MASK: i32 = (1 << SEQ_BITS) - 1;

/// Content categories a bot can reference. The discriminant is the CATEGORY
/// CODE baked into the high bits of every num — STABLE, never renumbered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum Category {
    Gem = 1,
    Item = 2,
    Affix = 3,
    Monster = 4,
    Node = 5,
    Zone = 6,
    Currency = 7,
    Tileset = 8,
}

impl Category {
    /// Every category, in code order — the generator and consts iterate this.
    pub const ALL: [Category; 8] = [
        Category::Gem,
        Category::Item,
        Category::Affix,
        Category::Monster,
        Category::Node,
        Category::Zone,
        Category::Currency,
        Category::Tileset,
    ];

    pub fn code(self) -> i32 {
        self as i32
    }

    /// Registry section name and generated-const prefix (`GEM_…`, `ITEM_…`).
    pub fn key(self) -> &'static str {
        match self {
            Category::Gem => "gem",
            Category::Item => "item",
            Category::Affix => "affix",
            Category::Monster => "monster",
            Category::Node => "node",
            Category::Zone => "zone",
            Category::Currency => "currency",
            Category::Tileset => "tileset",
        }
    }
}

/// Compose a tagged num from a category + per-category sequence.
pub fn compose(cat: Category, seq: i32) -> i32 {
    (cat.code() << SEQ_BITS) | (seq & SEQ_MASK)
}

/// The category code carried in a num's high bits (`num >> SEQ_BITS`).
pub fn category_code(num: i32) -> i32 {
    num >> SEQ_BITS
}

/// The per-category sequence in a num's low bits.
pub fn sequence(num: i32) -> i32 {
    num & SEQ_MASK
}

/// The committed id registry: per category, `string_id → sequence`. Tombstones
/// are simply entries whose def no longer exists — they stay forever so their
/// sequence is never reused. `fingerprint` is provenance only (not a gate).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Registry {
    /// Provenance: an FNV-1a hash over the canonical (category, id, seq) set.
    /// Lets the docs/site show "what a bot compiled against"; NOT a compat gate.
    #[serde(default)]
    pub fingerprint: String,
    /// `category key → (string id → sequence)`. BTreeMaps keep the on-disk file
    /// deterministic so regeneration produces a stable, diffable artifact.
    #[serde(default)]
    pub ids: BTreeMap<String, BTreeMap<String, i32>>,
}

/// One thing a regeneration changed, surfaced to the operator / CI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryChange {
    /// A brand-new def was assigned a sequence.
    Assigned {
        cat: &'static str,
        id: String,
        seq: i32,
    },
    /// A def in the registry no longer exists in content (its num is retired).
    Tombstoned {
        cat: &'static str,
        id: String,
        seq: i32,
    },
}

/// A locked-mapping violation — these must never happen under append-only rules.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    /// Two ids in a category resolved to the same sequence.
    SequenceReused {
        cat: &'static str,
        seq: i32,
        a: String,
        b: String,
    },
}

/// Per category, the live ids in content — each with an optional seeded
/// sequence (nodes seed their author-assigned `num`; everything else `None`).
pub type CategoryIds = (Category, Vec<(String, Option<i32>)>);

impl Registry {
    /// The full tagged num for a (category, string id), if present.
    pub fn num(&self, cat: Category, id: &str) -> Option<i32> {
        self.ids
            .get(cat.key())
            .and_then(|m| m.get(id))
            .map(|&seq| compose(cat, seq))
    }

    /// Regenerate from the previous registry plus the current content's ids per
    /// category. Carries every prior mapping over UNCHANGED (locked); assigns
    /// the next free sequence to genuinely-new ids; never removes (removals are
    /// tombstones). `seed` lets a category pin a sequence on first sight (nodes
    /// keep their author-assigned `num`). Returns the changes and any violation.
    pub fn regenerate(
        &self,
        present: &[CategoryIds],
    ) -> Result<(Registry, Vec<RegistryChange>), RegistryError> {
        let mut next = self.clone();
        let mut changes = Vec::new();

        for (cat, ids) in present {
            let section = next.ids.entry(cat.key().to_string()).or_default();
            // Next free sequence = one past the current high-water mark, so a
            // tombstoned sequence (still present here) is never reissued.
            let mut next_seq = section.values().copied().max().map(|m| m + 1).unwrap_or(0);
            for (id, seed) in ids {
                if section.contains_key(id) {
                    continue; // locked — carried over unchanged
                }
                let seq = match seed {
                    Some(s) => *s, // author-pinned (nodes)
                    None => {
                        let s = next_seq;
                        next_seq += 1;
                        s
                    }
                };
                section.insert(id.clone(), seq);
                changes.push(RegistryChange::Assigned {
                    cat: cat.key(),
                    id: id.clone(),
                    seq,
                });
            }
        }

        // Tombstones: registry entries with no matching present id.
        for (cat, ids) in present {
            if let Some(section) = next.ids.get(cat.key()) {
                let live: std::collections::BTreeSet<&str> =
                    ids.iter().map(|(id, _)| id.as_str()).collect();
                for (id, &seq) in section {
                    if !live.contains(id.as_str()) {
                        changes.push(RegistryChange::Tombstoned {
                            cat: cat.key(),
                            id: id.clone(),
                            seq,
                        });
                    }
                }
            }
        }

        // Revalidate: within each category, no sequence may be used twice.
        for (cat_key, section) in &next.ids {
            let mut seen: BTreeMap<i32, &str> = BTreeMap::new();
            for (id, &seq) in section {
                if let Some(&other) = seen.get(&seq) {
                    let cat = Category::ALL
                        .iter()
                        .find(|c| c.key() == cat_key)
                        .map(|c| c.key())
                        .unwrap_or("?");
                    return Err(RegistryError::SequenceReused {
                        cat,
                        seq,
                        a: other.to_string(),
                        b: id.clone(),
                    });
                }
                seen.insert(seq, id);
            }
        }

        next.fingerprint = next.compute_fingerprint();
        Ok((next, changes))
    }

    /// FNV-1a over the canonical (category, id, seq) listing — stable across
    /// runs because the BTreeMaps iterate in sorted order.
    fn compute_fingerprint(&self) -> String {
        let mut h = crate::FNV1A_OFFSET;
        let mut feed = |bytes: &[u8]| {
            for &b in bytes {
                h ^= b as u64;
                h = h.wrapping_mul(crate::FNV1A_PRIME);
            }
        };
        for (cat, section) in &self.ids {
            feed(cat.as_bytes());
            for (id, seq) in section {
                feed(id.as_bytes());
                feed(&seq.to_le_bytes());
            }
        }
        format!("{h:016x}")
    }
}
