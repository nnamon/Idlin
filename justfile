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

# Mirror of CI's gates, in order — keep in lockstep with .github/workflows/ci.yml.
check: fmt-check lint test gen-check content-check web-install web-build

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

# Install web deps from the committed lockfile (CI's frozen-install gate).
web-install:
    pnpm -C web install --frozen-lockfile

web-build:
    pnpm -C web build

# Regenerate web/src/gen (protocol types + server constants).
gen-ts:
    cargo test -p idlin-protocol export_typescript_bindings
    cargo test -p idlin-server --test export_constants

# Fail if committed TS bindings are stale (CI's TS-freshness gate).
gen-check: gen-ts
    git diff --exit-code web/src/gen

# Regenerate content ids/consts/docs from content/.
gen-content:
    cargo run -p idlin-content --bin gen

# Fail if generated content artifacts are stale (CI gate `just check` once missed).
content-check: gen-content
    git diff --exit-code content/ids.ron content/lib/gen_ids.bot web/public/content-docs.json

# Boot the world fresh (4 built-in bots) with the production frontend.
demo: web-build
    rm -rf data/snapshots
    cargo run -p idlin-server

# Verify the golden replay fixture (pinned seed+content+inputs → state hash).
replay:
    cargo test -p idlin-sim --test golden -- --nocapture
