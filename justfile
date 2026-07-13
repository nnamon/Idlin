# Idlin dev tasks. `just dev` is the one-command local stack.

# Live-server port (override: `just port=8080 redeploy`) — matches IDLIN_PORT.
port := "7777"
# Where the detached live server writes its log.
serverlog := "/tmp/idlin-server.log"

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

# One-command live redeploy (#51): rebuild the server + client and restart the
# live server, closing the silent "viewer renders nothing / tick 0 forever"
# break (a fresh client served by a stale server after a PROTO bump). Ordering
# is the safety property: build the server FIRST (while the old one keeps
# serving), and only AFTER the old server is down do we publish the new
# `web/dist` and start the new server — so a stale server can NEVER serve the
# new client (a failed server build leaves the old server + old client intact).
# The old server gets a graceful SIGTERM (it snapshots every world before
# exiting). Finally it VERIFIES the live `proto_version` equals the CLIENT's
# (`web/src/gen/proto.ts`, what the bundle actually ships) and FAILS LOUDLY
# otherwise. Use `serve` for an attached first run; `redeploy` for detached
# (re)deploys.
redeploy:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "→ building idlin-server (release)…"
    cargo build --release -p idlin-server
    # Stop the old server BEFORE publishing the new client, so the new web/dist
    # is never served by the stale server. (Skipped on a first run.)
    old=$(lsof -nP -tiTCP:{{port}} -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$old" ]; then
        echo "→ SIGTERM old server (pid $old); waiting for snapshots + :{{port}} to free…"
        kill $old 2>/dev/null || true
        for _ in $(seq 1 40); do
            lsof -nP -iTCP:{{port}} -sTCP:LISTEN >/dev/null 2>&1 || break
            sleep 0.5
        done
        if lsof -nP -iTCP:{{port}} -sTCP:LISTEN >/dev/null 2>&1; then
            echo "✗ :{{port}} still busy after 20s — aborting (old server + old client intact)" >&2
            exit 1
        fi
    fi
    # No server is running now → safe to publish the new client and start the new server.
    echo "→ building web/dist…"
    pnpm -C web build
    echo "→ starting new server (log: {{serverlog}})…"
    IDLIN_PORT={{port}} nohup ./target/release/idlin-server > {{serverlog}} 2>&1 &
    new_pid=$!
    # Verify the live server agrees with the CLIENT the bundle ships (proto.ts),
    # not just the Rust source — a stale proto.ts would otherwise pass silently.
    expect=$(sed -n 's/.*PROTO_VERSION = \([0-9]*\).*/\1/p' web/src/gen/proto.ts)
    for _ in $(seq 1 40); do
        curl -fsS "http://localhost:{{port}}/version" >/dev/null 2>&1 && break
        sleep 0.5
    done
    # `|| true` so a never-up server takes the loud failure path below, not an
    # abrupt set -e exit before the diagnostics.
    got=$(curl -fsS "http://localhost:{{port}}/version" 2>/dev/null \
        | sed -n 's/.*"proto_version":\([0-9]*\).*/\1/p') || true
    if [ "${got:-}" != "$expect" ]; then
        # Fail CLOSED: kill the just-started server rather than leave a broken
        # one serving the new web/dist (an "apparently connected, no frames"
        # viewer). Better an obvious hard-down than a silent mismatch.
        echo "✗ redeploy FAILED: live server proto '${got:-down}' != client proto '$expect' — killed the new server (see {{serverlog}})" >&2
        kill "$new_pid" 2>/dev/null || true
        tail -20 {{serverlog}} >&2 || true
        exit 1
    fi
    echo "✓ live on http://localhost:{{port}} — server + client both PROTO $got"

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
    git diff --exit-code content/ids.ron content/lib/gen_ids.bot content/lib/gen_abi.bot web/public/content-docs.json

# Boot the world fresh (3 built-in bots) with the production frontend.
demo: web-build
    rm -rf data/snapshots
    cargo run -p idlin-server

# Verify the golden replay fixture (pinned seed+content+inputs → state hash).
replay:
    cargo test -p idlin-sim --test golden -- --nocapture
