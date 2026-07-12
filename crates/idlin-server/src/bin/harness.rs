//! The headless harness (#148 A6): run YOUR brain through the whole game.
//!
//! ```sh
//! cargo run -p idlin-server --bin harness -- --brain my.bot [--seed 0xC0FFEE]
//! ```
//!
//! Compiles the `.bot` with the same prelude the stock templates get (every
//! content num + ABI const in scope), then walks the salt road under the
//! band tests' exact mini host loop: the shore tutorial, both acts, the
//! Map Device, one map run. Prints a JSON report; exits 1 if the road
//! didn't complete. Deterministic per (seed, brain) — a red run replays
//! bit-identically, so a debug print in your brain lands on the same tick
//! every time.

use idlin_server::runner::salt_road::walk_the_salt_road;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut brain: Option<String> = None;
    let mut seed = 0x05A1_70AD_u64;
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--brain" => {
                brain = args.get(i + 1).cloned();
                i += 2;
            }
            "--seed" => {
                let raw = args.get(i + 1).cloned().unwrap_or_default();
                // 0x-prefixed = hex; bare digits = decimal (no silent
                // hex reinterpretation of "42").
                seed = if let Some(hex) = raw.strip_prefix("0x") {
                    u64::from_str_radix(hex, 16)
                } else {
                    raw.parse()
                }
                .unwrap_or_else(|_| {
                    eprintln!("bad --seed {raw}");
                    std::process::exit(2);
                });
                i += 2;
            }
            other => {
                eprintln!("unknown arg {other} (expected --brain <file.bot> [--seed N])");
                std::process::exit(2);
            }
        }
    }
    let Some(path) = brain else {
        eprintln!("usage: harness --brain <file.bot> [--seed N]");
        std::process::exit(2);
    };
    let source = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("read {path}: {e}");
        std::process::exit(2);
    });
    let program = idlin_botc::compile_deployed(&source).unwrap_or_else(|e| {
        eprintln!("compile: {e}");
        std::process::exit(2);
    });
    let report = walk_the_salt_road(seed, program);
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    std::process::exit(if report.completed() { 0 } else { 1 });
}
