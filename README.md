# Idlin

A stream-first idle ARPG. Viewers' characters play autonomously in a shared,
persistent world that is broadcast on stream, with the camera cycling between
interesting events — Ravenfall's presentation, Path of Exile's substance:
a tutorial campaign, an endgame of randomized maps, affix-based loot.

Characters are driven by **bots running in a constrained opcode VM** (64 KiB
memory, a per-tick instruction budget, syscalls as the only world interface).
Viewers control their character with chat commands that configure template
bots; eventually, players can write and submit their own bots — the resource
constraints are part of the sport.

## Architecture

- `crates/idlin-sim` — the **pure deterministic world sim**. No I/O, no
  threads, no wall clock, no floats (Q16.16 fixed-point + hand-rolled PCG32).
  Inputs in, events out; bit-exact across platforms.
- `crates/idlin-vm` — the bot VM: 32-bit stack machine, wrapping 64 KiB
  memory, budget-bounded, every state defined. Untrusted code runs here.
- `crates/idlin-botc` — bot assembler/compiler + built-in chat templates.
- `crates/idlin-content` — RON game content loader (zones, monsters, items).
- `crates/idlin-protocol` — WebSocket message types; TypeScript bindings
  generated into `web/src/gen/` via ts-rs.
- `crates/idlin-chat` — platform-agnostic chat adapters (Twitch, mock).
- `crates/idlin-server` — the impure shell: tick loop, persistence,
  replication, auto-director, chat command parsing.
- `web/` — Three.js + TypeScript spectator client (React for the overlay).

## Design principles

- **The engine runs content.** Zones, monsters, items — and *behavior* — are
  data in `content/`. NPC brains are bot assembly (`content/brains/*.asm`)
  compiled at load; monsters run on the exact same VM and syscalls as player
  bots. Hostility is data (`hostile: true` → faction), so friendly NPCs are
  just content too.
- **Determinism is law.** The sim is integer/fixed-point only; identical
  (seed, content, input history) reproduces the world bit-exactly on any
  platform. Snapshots + determinism = exact resume after restart.
- **Every state is defined.** Untrusted bytecode can be wrong, but it cannot
  crash, stall, or desync the world: wrapping memory, instruction budgets,
  defined div-by-zero, validated syscalls.

## Versioning

- **Project**: semver (workspace version, tagged releases).
- **Wire protocol**: `PROTO_VERSION` integer, checked at Hello.
- **Bytecode format**: `ILBC` container with a u16 format version, checked at
  deploy time — outdated bots are rejected with a typed error before they run.
- **Bot deployments**: monotonic integer per character, bumped on every swap.

## Development

Requires Rust (via rustup), Node 22 + pnpm, and [just](https://github.com/casey/just).

```sh
just dev      # server on :7777 + Vite dev server on :5173
just check    # everything CI runs: fmt, clippy, tests, TS bindings freshness, typecheck
just serve    # production-style: build frontend, serve it from the server
```
