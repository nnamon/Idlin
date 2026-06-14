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

/// Compose a tagged num from a category + per-category sequence. Both must fit
/// their fields: a `seq` past `SEQ_MASK` or a `cat` past 8 bits would silently
/// overlap another num or flip the sign bit, so it's a hard invariant (the
/// registry's overflow guard upholds it; this asserts in dev/test).
pub fn compose(cat: Category, seq: i32) -> i32 {
    debug_assert!(
        (0..=SEQ_MASK).contains(&seq),
        "sequence {seq} exceeds the {SEQ_BITS}-bit field"
    );
    debug_assert!(
        (0..=0xFF).contains(&cat.code()),
        "category code {} exceeds 8 bits",
        cat.code()
    );
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
    /// A seeded id (e.g. a tree node) is in the registry with a sequence that no
    /// longer matches its authoritative seed — the committed registry was edited
    /// away from `NodeDef.num`. Catches a hand-tampered renumber for seeds.
    SeedMismatch {
        cat: &'static str,
        id: String,
        expected: i32,
        found: i32,
    },
    /// A category's sequence counter overflowed its field (> ~8.4M live ids).
    SequenceOverflow { cat: &'static str, seq: i32 },
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
                if let Some(&existing) = section.get(id) {
                    // Locked. A seeded id (node) has an authoritative source, so
                    // re-verify the committed registry still matches it.
                    if let Some(s) = seed
                        && existing != *s
                    {
                        return Err(RegistryError::SeedMismatch {
                            cat: cat.key(),
                            id: id.clone(),
                            expected: *s,
                            found: existing,
                        });
                    }
                    continue; // carried over unchanged
                }
                let seq = match seed {
                    Some(s) => *s, // author-pinned (nodes)
                    None => {
                        if next_seq > SEQ_MASK {
                            return Err(RegistryError::SequenceOverflow {
                                cat: cat.key(),
                                seq: next_seq,
                            });
                        }
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

        // Tombstones: registry entries with no matching present id. Iterate the
        // REGISTRY (not `present`), so a category dropped from `present` is still
        // scanned and its retired ids surfaced.
        let live: BTreeMap<&str, std::collections::BTreeSet<&str>> = present
            .iter()
            .map(|(cat, ids)| (cat.key(), ids.iter().map(|(id, _)| id.as_str()).collect()))
            .collect();
        for (cat_key, section) in &next.ids {
            let cat_static = Category::ALL
                .iter()
                .find(|c| c.key() == cat_key)
                .map(|c| c.key())
                .unwrap_or("?");
            for (id, &seq) in section {
                let is_live = live
                    .get(cat_key.as_str())
                    .is_some_and(|l| l.contains(id.as_str()));
                if !is_live {
                    changes.push(RegistryChange::Tombstoned {
                        cat: cat_static,
                        id: id.clone(),
                        seq,
                    });
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(items: &[(&str, Option<i32>)]) -> Vec<(String, Option<i32>)> {
        items
            .iter()
            .map(|(s, seed)| (s.to_string(), *seed))
            .collect()
    }

    #[test]
    fn compose_round_trips_and_stays_positive() {
        for (cat, seq) in [
            (Category::Gem, 0),
            (Category::Item, 5),
            (Category::Tileset, SEQ_MASK),
        ] {
            let num = compose(cat, seq);
            assert!(num > 0, "nums must stay positive (the VM word is i32)");
            assert_eq!(category_code(num), cat.code());
            assert_eq!(sequence(num), seq);
        }
    }

    #[test]
    #[should_panic]
    fn compose_rejects_overflowing_sequence() {
        let _ = compose(Category::Gem, SEQ_MASK + 1); // doesn't fit 23 bits
    }

    #[test]
    fn assigns_sequentially_then_locks() {
        let (r1, c1) = Registry::default()
            .regenerate(&[(Category::Gem, ids(&[("a", None), ("b", None)]))])
            .unwrap();
        assert_eq!(r1.num(Category::Gem, "a"), Some(compose(Category::Gem, 0)));
        assert_eq!(r1.num(Category::Gem, "b"), Some(compose(Category::Gem, 1)));
        assert_eq!(c1.len(), 2);
        // Re-run: existing locked, only the new id assigned.
        let (r2, c2) = r1
            .regenerate(&[(Category::Gem, ids(&[("a", None), ("b", None), ("c", None)]))])
            .unwrap();
        assert_eq!(r2.num(Category::Gem, "a"), Some(compose(Category::Gem, 0)));
        assert_eq!(r2.num(Category::Gem, "c"), Some(compose(Category::Gem, 2)));
        assert_eq!(
            c2.iter()
                .filter(|c| matches!(c, RegistryChange::Assigned { .. }))
                .count(),
            1
        );
    }

    #[test]
    fn tombstones_retire_a_sequence_forever() {
        let (r1, _) = Registry::default()
            .regenerate(&[(Category::Gem, ids(&[("a", None), ("b", None)]))])
            .unwrap();
        // Drop "a", add "c": "a" tombstoned (kept), "c" gets seq 2 not the freed 0.
        let (r2, changes) = r1
            .regenerate(&[(Category::Gem, ids(&[("b", None), ("c", None)]))])
            .unwrap();
        assert!(
            changes
                .iter()
                .any(|c| matches!(c, RegistryChange::Tombstoned { id, .. } if id == "a"))
        );
        assert_eq!(r2.num(Category::Gem, "a"), Some(compose(Category::Gem, 0)));
        assert_eq!(r2.num(Category::Gem, "c"), Some(compose(Category::Gem, 2)));
    }

    #[test]
    fn seed_mismatch_is_rejected() {
        // A tampered registry has node "n" at 99, but its seed (NodeDef.num) is 10.
        let mut reg = Registry::default();
        reg.ids
            .entry("node".into())
            .or_default()
            .insert("n".into(), 99);
        let err = reg.regenerate(&[(Category::Node, ids(&[("n", Some(10))]))]);
        assert!(matches!(
            err,
            Err(RegistryError::SeedMismatch {
                expected: 10,
                found: 99,
                ..
            })
        ));
    }

    #[test]
    fn duplicate_sequence_is_rejected() {
        let mut reg = Registry::default();
        let s = reg.ids.entry("gem".into()).or_default();
        s.insert("a".into(), 0);
        s.insert("b".into(), 0); // tampered: same sequence
        let err = reg.regenerate(&[(Category::Gem, ids(&[("a", None), ("b", None)]))]);
        assert!(matches!(
            err,
            Err(RegistryError::SequenceReused { seq: 0, .. })
        ));
    }
}
