//! The internal wiki: generated FROM the RONs, so it can never drift.
//! Run `cargo run -p idlin-content --bin wiki` from the repo root;
//! pages land in docs/wiki/. Structured fields get real prose/tables;
//! anything still evolving is shown via Debug so it stays honest.

use idlin_content::ContentDb;
use std::fmt::Write as _;
use std::path::Path;

fn main() {
    let db = ContentDb::load(Path::new("content")).expect("content loads (run from repo root)");
    let out = Path::new("docs/wiki");
    std::fs::create_dir_all(out).expect("mkdir docs/wiki");
    let write = |name: &str, body: String| {
        std::fs::write(out.join(name), body).expect("write page");
        println!("wrote docs/wiki/{name}");
    };

    // -- items: every base with its full affix table (weights + tiers) --
    let mut s = String::from(
        "# Item bases\n\nGenerated from content/ — do not edit.\n\nEach base lists every \
         affix its pools can roll. *Share* is the affix's weight over the total weight \
         available to this base (first-roll odds; rolled affixes leave the pool).\n\n",
    );
    for it in &db.items {
        let _ = writeln!(s, "## {} — pools: {}\n", it.id, it.affix_pools.join(", "));
        let eligible: Vec<_> = db
            .affixes
            .iter()
            .filter(|a| it.affix_pools.contains(&a.pool))
            .collect();
        let total: u32 = eligible.iter().map(|a| a.weight).sum();
        for a in &eligible {
            let share = if total > 0 {
                a.weight as f64 * 100.0 / total as f64
            } else {
                0.0
            };
            let _ = writeln!(
                s,
                "### {} (`{}`) — {:?} · {:?} {:?} · weight {} ({share:.1}%)\n",
                a.name, a.id, a.kind, a.stat, a.layer, a.weight,
            );
            let tw: u32 = a.tiers.iter().map(|t| t.weight).sum();
            let _ = writeln!(s, "| tier | name | ilvl | roll | weight |");
            let _ = writeln!(s, "|---|---|---|---|---|");
            // Tiers are authored low→high; display best-first like PoE.
            for (n, t) in a.tiers.iter().rev().enumerate() {
                let pct = if tw > 0 {
                    t.weight as f64 * 100.0 / tw as f64
                } else {
                    0.0
                };
                let _ = writeln!(
                    s,
                    "| T{} | {} | {}+ | {}–{} | {} ({pct:.0}%) |",
                    n + 1,
                    if t.name.is_empty() {
                        a.name.as_str()
                    } else {
                        t.name.as_str()
                    },
                    t.ilvl,
                    t.min,
                    t.max,
                    t.weight,
                );
            }
            let _ = writeln!(s);
        }
        if eligible.is_empty() {
            let _ = writeln!(s, "_No affixes subscribe to these pools._\n");
        }
    }
    write("items.md", s);

    let mut s = String::from("# Affixes by pool\n\nGenerated from content/ — do not edit.\n\n");
    let mut pools: Vec<&str> = db.affixes.iter().map(|a| a.pool.as_str()).collect();
    pools.sort_unstable();
    pools.dedup();
    for pool in pools {
        let _ = writeln!(s, "## pool `{pool}`\n");
        let subs: Vec<&str> = db
            .items
            .iter()
            .filter(|i| i.affix_pools.iter().any(|p| p == pool))
            .map(|i| i.id.as_str())
            .collect();
        let _ = writeln!(s, "Subscribed bases: {}\n", subs.join(", "));
        for a in db.affixes.iter().filter(|a| a.pool == pool) {
            let _ = writeln!(s, "### {}\n\n```\n{:#?}\n```\n", a.id, a);
        }
    }
    write("affixes.md", s);

    let mut s = String::from("# Gems\n\nGenerated from content/ — do not edit.\n\n");
    for g in &db.gems {
        let _ = writeln!(s, "## {}\n\n```\n{:#?}\n```\n", g.id, g);
    }
    write("gems.md", s);

    let mut s = String::from("# Currency (obols)\n\nGenerated from content/ — do not edit.\n\n");
    for c in &db.currency {
        let _ = writeln!(s, "## {}\n\n```\n{:#?}\n```\n", c.id, c);
    }
    write("currency.md", s);

    // -- uniques: the authored chase items and their fixed mods --
    let mut s = String::from(
        "# Uniques\n\nGenerated from content/ — do not edit.\n\nEach drops when the loot \
         roller lands on Unique rarity AND the killer's level ≥ the unique's drop level; \
         otherwise the roll fizzles (nothing drops).\n\n",
    );
    for u in &db.uniques {
        let base = db
            .items
            .iter()
            .find(|i| i.id == u.base)
            .map(|i| i.name.as_str())
            .unwrap_or(&u.base);
        let _ = writeln!(
            s,
            "## {} — *{}* ({})\n",
            u.name,
            if u.flavor.is_empty() {
                "—"
            } else {
                &u.flavor
            },
            base,
        );
        let _ = writeln!(
            s,
            "Req level {} · drops at level {}+ · weight {}\n",
            u.req_level, u.drop_level, u.weight
        );
        let _ = writeln!(s, "| stat | layer | min | max |");
        let _ = writeln!(s, "|---|---|---|---|");
        for m in &u.mods {
            let _ = writeln!(
                s,
                "| {:?} | {:?} | {} | {} |",
                m.stat, m.layer, m.min, m.max
            );
        }
        let _ = writeln!(s);
    }
    if db.uniques.is_empty() {
        let _ = writeln!(s, "_No uniques authored yet._\n");
    }
    write("uniques.md", s);

    let mut s = String::from("# Monsters\n\nGenerated from content/ — do not edit.\n\n");
    for m in &db.monsters {
        let _ = writeln!(s, "## {}\n\n```\n{:#?}\n```\n", m.id, m);
    }
    write("monsters.md", s);

    // -- tilesets: the themed families and their native ecology --
    let mut s = String::from("# Tilesets\n\nGenerated from content/ — do not edit.\n\n");
    for t in &db.tilesets {
        let _ = writeln!(s, "## {}\n", t.id);
        let _ = writeln!(s, "| glyph | tile | walk | LoS-block | ground | prop |");
        let _ = writeln!(s, "|---|---|---|---|---|---|");
        for tile in &t.tiles {
            let _ = writeln!(
                s,
                "| `{}` | {} | {} | {} | {} | {} |",
                tile.glyph,
                tile.id,
                tile.walkable,
                tile.blocks_los,
                tile.ground,
                tile.prop.as_deref().unwrap_or("—"),
            );
        }
        let vars: Vec<&str> = t.variants.iter().map(|v| v.id.as_str()).collect();
        let _ = writeln!(
            s,
            "\nVariants: {}\n",
            if vars.is_empty() {
                "—".into()
            } else {
                vars.join(", ")
            }
        );
        let _ = writeln!(
            s,
            "Natural monsters: {}\n",
            if t.natural_monsters.is_empty() {
                "none (staged only)".into()
            } else {
                t.natural_monsters.join(", ")
            },
        );
        let users: Vec<&str> = db
            .zones
            .iter()
            .filter(|z| z.tileset.as_deref() == Some(t.id.as_str()))
            .map(|z| z.id.as_str())
            .collect();
        let _ = writeln!(
            s,
            "Zones using it: {}\n",
            if users.is_empty() {
                "—".into()
            } else {
                users.join(", ")
            }
        );
    }
    write("tilesets.md", s);

    let mut s = String::from("# Zones\n\nGenerated from content/ — do not edit.\n\n");
    for z in &db.zones {
        let _ = writeln!(
            s,
            "## {} (`{}`)\n\n{}×{} u · kind {:?} · tileset {} · {} packs · {} exits · brain {}\n",
            z.name,
            z.id,
            z.width_u,
            z.height_u,
            z.kind,
            z.tileset.as_deref().unwrap_or("generated"),
            z.packs.len(),
            z.exits.len(),
            z.brain.as_deref().unwrap_or("—"),
        );
    }
    write("zones.md", s);

    // -- passive tree --
    let mut s = String::from("# Passive tree\n\nGenerated from content/ — do not edit.\n\n");
    for n in &db.tree {
        let _ = writeln!(
            s,
            "## {} (`{}`, num {})\n\n```\n{:#?}\n```\n",
            n.name, n.id, n.num, n.grants
        );
    }
    write("tree.md", s);

    let index = "# Idlin wiki\n\nGenerated from the RONs by `cargo run -p idlin-content --bin wiki`.\n\n\
        - [Item bases](items.md)\n- [Affixes by pool](affixes.md)\n- [Gems](gems.md)\n\
        - [Currency](currency.md)\n- [Uniques](uniques.md)\n- [Monsters](monsters.md)\n- [Tilesets](tilesets.md)\n\
        - [Zones](zones.md)\n- [Passive tree](tree.md)\n";
    write("README.md", index.to_string());
}
