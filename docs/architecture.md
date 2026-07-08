# Idlin Architecture

One server = one world. Starting `idlin-server` brings up the simulation,
the WebSocket replication layer, and the web spectator client. Viewers
watch the stream; the server owner (and later, individual players) get
browser views.

## Crate map

```
crates/
├── idlin-vm        the bot VM: stack machine, 64 KiB wrapping memory,
│                   instruction budgets, ILBC versioned bytecode. Zero
│                   game knowledge; the security boundary.
├── idlin-botc      bot toolchain: assembler + the C-like `.bot` compiler
│                   (stock brains and zone scripts are `.bot` source).
├── idlin-content   content schemas + RON/asm loader + validation +
│                   content hash. The stat vocabulary (Stat/Layer/Grant)
│                   lives here so content can speak it.
├── idlin-sim       THE DETERMINISM BOUNDARY. Pure world simulation:
│                   no I/O, no clock, no floats, no HashMap iteration
│                   (clippy-enforced). Inputs in → events out.
├── idlin-protocol  WebSocket message types; ts-rs generates the
│                   TypeScript bindings in web/src/gen/ (CI-checked).
├── idlin-chat      platform-agnostic chat adapter trait (Phase 2).
└── idlin-server    the impure shell: tick loop thread, replication,
                    auto-director, snapshot persistence, HTTP/WS.
web/                Vite + TypeScript + Three.js client; React overlay.
content/            the game itself (see content-guide.md).
```

## The tick pipeline (idlin-sim, 10 Hz)

Fixed order, ascending entity-slot order inside every phase — this is what
makes the world bit-exact:

1. Clear transient intents (attack/pickup; movement persists).
2. Apply `TickInputs` (joins; later: chat commands, bot deploys).
3. **Run every bot VM** (characters and monsters alike) up to 5,000
   instructions; syscalls observe the world and record intents.
4. Movement (with "stop to fight" when the attack target is in range).
5. Separation/collision (soft ally pass-through, firm enemy body-block).
6. Attacks: sequential resolution — hit roll → variance → per-type
   mitigation → deaths (XP, gem XP, loot rolls, pack bookkeeping).
7. Pickups (bag-grid first-fit; gems to pouch).
8. Out-of-combat regeneration.
9. Respawns (characters, packs), loot despawn.
10. Emit `SimEvent`s; canonical state hash on demand.

Everything that acts is a **bot**: monsters are entities whose brain
program came from `content/brains/`, with faction-relative syscalls so the
same code works on either side. The engine contains no AI.

## Replication (idlin-server)

- The sim runs on a dedicated thread; each tick it publishes a frame
  (entity views + events) over a channel.
- The replication task diffs consecutive frames into `ZoneDelta`
  (spawned/moved/updated/removed + hit effects), broadcasts pre-serialized
  JSON to all clients, and keeps a fresh `ZoneSnapshot` in a watch channel
  for connects and lag resync (a lagging client is healed with a snapshot).
- The **auto-director** scores events (death 80, join 75, rare drop 70,
  level-up 60, kill 30) with per-focus cooldowns, falls back to rotating
  idlers, and emits `DirectorCue`s the client camera follows.

## Persistence

- Full-world snapshot (postcard) every 300 ticks, atomic rename, into
  `data/snapshots/`. The sim — including every bot VM's memory — is serde-
  serializable, so **snapshot + determinism = exact resume**.
- Snapshots are pinned to the content hash; changed content → fresh world
  (logged loudly). SQLite accounts/journal arrive with Phase 2 chat.

## Versioning

| Thing | Scheme | Checked |
|---|---|---|
| Project | semver (workspace version) | releases |
| Wire protocol | `PROTO_VERSION` integer (currently 3) | at Hello |
| Bytecode format | `ILBC` container, u16 version | at deploy — outdated bots rejected with a typed error |
| Bot deployments | integer per character, bumped on every program swap | audit trail |

Bot **persistent state** (1 KiB at `0xF200`) is carried by the host across
program redeployments and zone transfers; the param block (`0xF000`) is the
only host→bot input channel.

## Determinism testing

- Golden replay: pinned (seed, content hash, inputs) must reproduce an
  exact state hash (`just replay`); CI fails on drift.
- Two-world determinism and snapshot-roundtrip tests over thousands of
  ticks; VM conformance tests per opcode; cross-platform hash equality
  (macOS-recorded fixture verified on Linux CI).
