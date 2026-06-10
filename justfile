# Idlin dev tasks. `just dev` is the one-command local stack.

# Run server (port 7777) and Vite dev server (port 5173) together.
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    trap 'kill 0' EXIT
    cargo run -p idlin-server &
    pnpm -C web dev &
    wait

# Run the production-style stack: build the frontend, serve it from the server.
serve: web-build
    cargo run -p idlin-server

# All Rust + TS checks, same as CI.
check: fmt-check lint test gen-check typecheck

test:
    cargo test --workspace

lint:
    cargo clippy --workspace --all-targets -- -D warnings

fmt:
    cargo fmt --all

fmt-check:
    cargo fmt --all --check

typecheck:
    pnpm -C web typecheck

web-build:
    pnpm -C web build

# Regenerate web/src/gen from the protocol crate.
gen-ts:
    cargo test -p idlin-protocol export_typescript_bindings

# Fail if committed TS bindings are stale.
gen-check: gen-ts
    git diff --exit-code web/src/gen

# Boot the world fresh (4 built-in bots) with the production frontend.
demo: web-build
    rm -rf data/snapshots
    cargo run -p idlin-server

# Verify the golden replay fixture (pinned seed+content+inputs → state hash).
replay:
    cargo test -p idlin-sim --test golden -- --nocapture
