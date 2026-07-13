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
  block as the chat→bot channel. A C-like `.bot` language compiles down
  to it — the stock brains and zone scripts are written in it.
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
- **A two-act campaign**: Act 1 — the Salt Road — climbs from the
  tutorial shore through Saltmere, the Drowned Coast, and Brinelord
  Karesh's Saltworks to the Mother of the Drowned; breaking her unseals
  a story-locked stair DOWN into **Act 2 — the Undertow**: Lanternfall's
  air-bell town, the Kelp Forest, Bailiff Morr's Pressure Court, and the
  Riptide Sovereign at the bottom of everything. Act bosses run phase
  kits through the same per-strike stat machinery as player gear, and
  each can pay a **signature unique** — a named item with a fixed mod set.
- **Three stock archetypes** — sword (grinder), wand (Elementalist
  caster), bow (Deadeye ranger) — each with its own build plan, gear
  ladder, and combat discipline; every one completes the entire two-act
  campaign unaided, proven on every commit by seeded full-game band tests.
- **The map endgame**: completing the campaign opens the
  passage to the Last Harbor — the endgame's town, holding the game's
  only Map Device. Maps drop as items and roll
  affixes like any gear — quantity/rarity juice AND **rules**: Monster
  Fury scales every hostile hit, the Map Clock puts the run on a
  timer, and Sovereign-Marked deep maps spawn a tier boss (the
  Unwritten) with its own signature. Every run settles a **scoreboard**
  on the way out — kills, deaths, items, duration.
- **A town economy**: vendors turn junk into obols (the crafting
  currency), and every character owns a persistent stash chest that
  rides zone transfers and snapshots. The stock brains sell their road
  junk before opening maps.
- **Player brain deployment**: POST a `.bot` source to `/api/deploy` and
  your brain walks its own tutorial shore. A published
  **headless harness** (`cargo run -p idlin-server --bin harness`) runs
  any brain through the whole game deterministically before you deploy.
- **A broadcast that follows the roster**: a stable camera watches each
  character in turn (30s rotation) while the ticker and banners carry
  acts, boss falls, and map tallies. World journals (`IDLIN_RECORD=1`)
  replay deterministically in the viewer (`?replay=…&at=<line>`).
- **The stock brains play the whole game**: routing by zone ids, gearing
  off the ground via the engine's scorer, managing bags, selling junk,
  breaking every boss, and pivoting to map farming — a fresh level-1
  idler reaches the endgame unaided. Six seeded full-game runs (four
  melee seeds, a caster, a ranger) gate every commit: both acts and the
  first map, within tick and death bands.
- **Fog of war**: per-idler views reveal only what that character has
  seen — the wire itself is filtered, so route precomputation from
  network captures is off the table.

## Run it

Requires Rust (rustup), Node 22 + pnpm, and [just](https://github.com/casey/just).

```sh
just dev      # game server on :7777 + Vite dev server on :5173
just serve    # production-style: build the frontend, serve from the server
just demo     # wipe snapshots and boot a fresh world (3 built-in idlers)
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

Version 0.1.0 — "The Undertow". The game is a complete two-act campaign
with a rule-modified map endgame, three self-sufficient stock
archetypes, a town economy, player brain deployment, a story-aware
broadcast. Next horizons: chat integration (Twitch first)
with player-scoped views, and a third act beneath the Sovereign's
basin.
