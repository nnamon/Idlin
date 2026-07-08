# Idlin

A stream-first idle ARPG. Viewers' characters play autonomously in a shared,
persistent world that is broadcast on stream, with an auto-director cutting
between fights, deaths, drops, and level-ups — Ravenfall's presentation,
Path of Exile's substance.

The twist: **everything that acts is a bot.** Player characters and monsters
alike run programs in a constrained virtual machine — 64 KiB of memory, an
instruction budget per tick, syscalls as the only window into the world.
Players start out steering template bots with chat commands; eventually they
write and submit their own brains, and the resource constraints are part of
the sport. Monster behavior is bot code too, shipped as content.

## What works today

- **Deterministic world sim** (10 Hz, integer/fixed-point only): identical
  seed + content + inputs reproduce the world bit-exactly on any platform.
  Snapshot + determinism = exact resume after restart.
- **The bot VM**: ~40 opcodes, wrapping memory, defined behavior for every
  state, versioned `ILBC` bytecode (outdated bots rejected at deploy), a
  1 KiB persist block that survives program redeployments, and a param
  block as the chat→bot channel. Assembler with templates; a C-like
  compiler is next.
- **NPCs are bots**: monsters run the same VM and syscalls; hostility is a
  content flag → faction (friendly NPCs need zero engine changes);
  `ReadEntities` is faction-relative so one brain works from either side.
- **Classless characters over one stat engine**: every point of power is an
  affix grant (added / increased / more, integer basis points) from gear,
  the passive tree, or gems — one evaluator for everything.
- **Full hit pipeline**: accuracy vs evasion, armour *attenuation* for
  physical (not flat life), capped resistances for elemental/chaos, three
  damage types.
- **Items with rolled affixes** (content pools, ilvl-gated tiers) in a
  **12×5 bag grid** with footprints — pickups fail when nothing fits, and
  bag management is a genuine bot skill.
- **Skill & support gems** in tree-unlocked sockets: skills are gems,
  supports modify their tree cluster's skill, gems gain XP from kills.
- **Faction-aware collision**: allies pass through with a soft nudge,
  enemies body-block.
- **The broadcast view**: Three.js spectator client with snapshot/delta
  replication, an auto-director camera, event ticker, and idler leaderboard.
- **Act 1 — the Salt Road**: a five-zone campaign (the tutorial shore,
  Saltmere town, the Drowned Coast, the Saltworks under Brinelord Karesh,
  and the Tidewarden's Hollow) ending at the Mother of the Drowned. Act
  bosses run phase kits through the same per-strike stat machinery as
  player gear, and each can pay a **signature unique** — a named item with
  a fixed mod set.
- **The chart endgame**: breaking the Mother unseals Saltmere's Charting
  Table. Charts drop as items, roll affixes like any gear (quantity and
  rarity juice), and open private leveled instances of charted waters —
  deeper charts drop in deeper waters.
- **The stock brain plays the whole game**: the default grinder template
  routes the campaign by zone ids, gears itself off the ground, manages
  its bag, breaks every boss, and pivots to chart farming — a fresh
  level-1 idler reaches the endgame unaided. Three seeded full-game runs
  gate every commit (sail the first voyage within bounds, without
  death-spam).
- **Fog of war**: per-idler views reveal only what that character has
  seen — the wire itself is filtered, so route precomputation from
  network captures is off the table.

## Run it

Requires Rust (rustup), Node 22 + pnpm, and [just](https://github.com/casey/just).

```sh
just dev      # game server on :7777 + Vite dev server on :5173
just serve    # production-style: build the frontend, serve from the server
just demo     # wipe snapshots and boot a fresh world (4 built-in idlers)
just check    # everything CI runs: fmt, clippy, tests, bindings, typecheck
just replay   # verify the golden determinism fixture
```

Environment: `IDLIN_SEED` (world seed), `IDLIN_PORT` (default 7777),
`IDLIN_DATA` (snapshot dir, default `data/snapshots`).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/bot-guide.md](docs/bot-guide.md) | **Bot programming guide**: machine model, memory map, instruction set, assembly syntax, the full syscall ABI with struct layouts, worked examples |
| [docs/content-guide.md](docs/content-guide.md) | Authoring zones, monsters, brains, items, affixes, gems, and the passive tree |
| [docs/mechanics.md](docs/mechanics.md) | Game math: the stat pipeline, hit resolution, gems, loot, death rules |
| [docs/architecture.md](docs/architecture.md) | Crate map, tick pipeline, replication, persistence, versioning |

## Design principles

- **The engine runs content.** Stats, layout, items, *and behavior* live in
  `content/`; novel mechanics should be new content vocabulary, not new
  engine code paths.
- **Determinism is law.** No floats, no wall clock, no nondeterministic
  iteration anywhere in the sim — lint-enforced, replay-tested in CI.
- **Every state is defined.** Untrusted bytecode can be wrong, but it
  cannot crash, stall, or desync the world.
- **Viewers watch the stream.** Only the owner's broadcast client and
  individual player views hold connections; the world scales with the sim,
  not the audience.

## Versioning

Project releases follow **semver**. The wire protocol, the bytecode format
(`ILBC` container), and individual bot deployments carry integer versions —
each checked at its boundary so incompatibilities fail fast and loudly.

## Status

Phases 0–1 of the [roadmap](docs/architecture.md) are complete plus the
gearing arc (stats, inventory, affixes, tree, gems). Next: the `.bot`
compiler, the real passive tree, then chat integration (Twitch first) with
player-scoped views.
