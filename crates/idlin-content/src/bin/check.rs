//! Content dry-run validator. Loads a content directory through the EXACT
//! path the server uses and reports every problem in one pass — hard
//! errors (which would refuse the load) and lints (which wouldn't) — so an
//! author iterates without booting the server.
//!
//! ```text
//! cargo run -p idlin-content --bin check            # checks ./content
//! cargo run -p idlin-content --bin check some/dir   # checks some/dir
//! cargo run -p idlin-content --bin check --strict    # warnings -> exit 2
//! ```

use idlin_content::ContentDb;
use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut dir = "content".to_string();
    let mut strict = false;
    for arg in std::env::args().skip(1) {
        if arg == "--strict" {
            strict = true;
        } else {
            dir = arg;
        }
    }

    // A missing path is a CLI typo, not "empty content" — say so plainly.
    if !Path::new(&dir).exists() {
        eprintln!("error: content directory `{dir}` does not exist");
        return ExitCode::from(1);
    }

    match ContentDb::load_checked(Path::new(&dir)) {
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::from(1)
        }
        Ok((db, warnings)) => {
            println!(
                "ok: {} loaded — {} monsters, {} zones, {} items, {} affixes, {} gems, \
                 {} currency, {} brains, {} tilesets",
                dir,
                db.monsters.len(),
                db.zones.len(),
                db.items.len(),
                db.affixes.len(),
                db.gems.len(),
                db.currency.len(),
                db.brains.len(),
                db.tilesets.len(),
            );
            for w in &warnings {
                println!("warning: {}: {}", w.origin, w.msg);
            }
            if warnings.is_empty() {
                println!("no warnings.");
            } else {
                println!("{} warning(s).", warnings.len());
            }
            if strict && !warnings.is_empty() {
                ExitCode::from(2)
            } else {
                ExitCode::SUCCESS
            }
        }
    }
}
