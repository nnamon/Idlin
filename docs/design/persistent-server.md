# Persistent server: identity, character lifecycle, and the living world

Status: **design RFC for review.** Supersedes the rejected #7 approach (which
moved a demo roster into content and called it architecture). This settles *how
Idlin becomes a real persistent server* — where characters come from, how they
persist, how players attach to them, how the world set is shaped — before any of
it is built.

> This is the v2 of this doc. A heavy architecture review killed v1's central
> thesis (a "character store as system-of-record, worlds as a flushed cache")
> as **provably false** — a character bundle does not contain a world's RNG
> streams, tick, live monsters, loot, or zone-brain state, all of which the
> determinism hash folds, so "worlds are reconstructable from the store" cannot
> be true. v2 inverts that: **the per-world snapshot stays the record for live
> state; identity/routing is a thin index on top.** v1 also cited
> `ManagedWorld::create` as a reusable seam — it exists only on the rejected #7
> branch, not in trunk. v2 is grounded against `main`.

## 0. The realization that drives everything

**Idlin is an idle game on a broadcast.** Two consequences:

1. **The population is the set of registered CHARACTERS, not connected
   viewers.** Your idler grinds while you sleep; the stream shows a living world
   whether or not its inhabitants watch. "A player joins" means **registering a
   character**; "a player connects" means **attaching to spectate/manage** an
   already-running one. The current server has no notion of either — the only
   way a character exists is a hardcoded boot roster.
2. **Compute scales with simulated characters, not viewers.** This is the
   central engineering reality and the main risk (§4, §7).

## 1. Where we are today (grounded against `main`)

- **Topology.** `main.rs` builds, at boot: **two shared worlds with empty
  pending** — `saltmere` (`main.rs:126-134`) and `coast` (`137-144`) — plus
  **one private `withered_shore#<name>` instance per roster idler**, each with
  that idler queued to join (`146-167`). The roster is hardcoded
  `["Kargan","Veles","Mirra"]` in `builtin_joins()` (`main.rs:53`).
- **Resume already exists.** On boot, each world swaps in its snapshot if one
  exists (content-hash gated), carries mid-ferry arrivals, and **suppresses a
  builtin join for any name already resident anywhere** (`main.rs:168-203`). So
  a finished idler who climbed to town stays in town on restart.
- **A character** is created by a `JoinRequest { name, program }`
  (`world/mod.rs:62`); `apply_joins` spawns a fresh **level-1** `CharacterState`
  (`world/mod.rs:987`). Identity is the **name string** — no account, no
  ownership.
- **The portable record** is `CharacterBundle { character, program, persist,
  params, bot_version }` (`world/mod.rs:72`). It is a **progression record**,
  not a world snapshot: on arrival, `apply_joins` allocates a **new net_id**,
  builds a **fresh bot RNG stream** from the destination seed, resets transient
  VM registers (persist block restored), and clears `respawn_at`
  (`world/mod.rs:1010-1049`). Level/xp/items/gear/tree/persist survive; runtime
  identity is deliberately re-derived.
- **Persistence (#9)** is **per-world**: `save_managed` postcard-serializes the
  **whole `World`** (RNG streams, tick, monsters, loot, zone brain,
  `pending_uses`, and every character) per world key, content-hash gated
  (`persist.rs:48,76`). The durable invariant: *a character is in exactly one
  world's state or pending list at any instant* (`persist.rs:7-9`). `SAVE_
  EVERY_TICKS = 300`, plus a graceful-shutdown save.
- **Determinism.** Pure sim: per-domain seeded RNG (`rng.rs`); `content_hash`
  folded into `state_hash` along with `tick`, `next_net_id`, all four world RNG
  `(state,inc)` pairs, and `pending_uses` (`views.rs:364-402`); the golden test
  pins one `(seed, content, input-stream)`. No wall-clock, no unseeded RNG.
- **Identity/auth: none.** `C2S::Hello` carries an unused `token: String`
  (`protocol/lib.rs:473`); `Role` is hardcoded `Owner` (`main.rs:364`). `C2S` is
  **read-only** — no deploy, no create, no write path. `IDLIN_RECORD` records
  the **output** wire stream (a replay-for-viewing), **not** an input-log.

The gap is not "the roster is hardcoded." It is: **there is no owned, persistent
character with a lifecycle (create → attach → relocate → retire) decoupled from
the boot roster, and no client→server write path to manage one.**

## 2. The model (corrected)

Two tiers, plus a thin index. The world tier already exists and is correct; we
add identity/routing on top and a real lifecycle.

```
   IDENTITY + ROUTING INDEX  (new, small)
     player_id  ⇄  one character_id              ← identity (§3)
     character_id → current world_key            ← routing/location
     character_id → progression projection        ← UI/ladder, cheap copy
   ──────────────────────────────────────────────
   WORLD TIER  (exists; system of record for LIVE state)   (§4,§5)
     ManagedWorlds tick the sim; per-world snapshots are
     the durable record (RNG, tick, monsters, loot, brain,
     AND the characters living in them). #9, unchanged.
```

**The per-world snapshot remains the system of record for live state** — it is
the only thing that contains the RNG/tick/entity/zone-brain state a world needs
to resume exactly (the property #9 already guarantees and tests). We do **not**
make a character store authoritative; that was v1's false move.

**The index is a thin identity/routing layer**, not a world-reconstruction
source. Its only jobs:
- **Identity binding:** `player_id ⇄ character_id` (one character per player,
  per #24).
- **Location/routing:** `character_id → world_key` so a connecting player's
  feed can find their character, and so the ferry/boot can place them. This is
  the same information `main.rs`'s `routing` map already tracks for watched
  characters (`main.rs:39-46`) — generalized and persisted.
- **Cheap projection:** a small denormalized copy (name, level, last-seen,
  ladder stats) for portal/ladder UI without loading a world.

Because every character is always *inside some persisted world* (§4), the
durable character data lives in that world's snapshot; the index never needs to
hold a bundle as a primary copy. Relocation between worlds is the **existing
ferry** (departure→arrival moves the bundle; the index updates the location).
Instance teardown is safe because **characters ferry out to a shared world
before an empty instance is reaped** — they're never stranded in a deleted
snapshot.

This dissolves v1's store-vs-world consistency problem: there is one record
(the world snapshot), and a small index that is a *projection/router*, allowed
to be rebuilt or lag without losing character data.

## 3. Identity (build the shape before the OAuth — but honestly)

#17 names OAuth (Twitch/GitHub) as the eventual identity. We can build the
server shape first, **if we are honest that early tokens are not real auth.**

- **Phase A — anonymous tokens, NO stealable value.** First connect with an
  empty `Hello.token` mints an opaque `player_id`; the client stores and
  replays it. **This is a bearer credential** — whoever holds the string is the
  player. That is acceptable *only* while a character carries no value worth
  stealing. Therefore: **the persisted, ownership-gated deploy loop (§6) does
  NOT ship on anonymous tokens.** Anonymous-token characters are
  early-access/disposable.
- **Phase B — OAuth (#17) before persisted progression.** Real identity
  (provider account → `player_id`) must land **before** Deploy/SetParams make a
  character's accumulated build worth stealing. The `player_id ⇄ character_id`
  binding underneath is identical; the issuer is a pluggable front end.

**Abuse model (v1 omitted this entirely — it's a correctness requirement under
always-on, not a nicety):**
- **Sybil/DoS.** Free anonymous identity minting + always-on simulation (§4)
  means N scripted empty-token connects = N permanently-simulated characters =
  unbounded CPU + persistence growth on the single tick-thread. Mitigations:
  rate-limit minting (per-IP / proof-of-work / invite), and **evict abandoned
  characters** (never-connected or idle past a threshold) — which is also what
  bounds always-on cost (§4). Eviction is mandatory, not optional.
- **Token theft.** Anonymous bearer tokens can be copied (shared screen, logs,
  localStorage). Contained by Phase A's "no stealable value" rule; fully closed
  by OAuth (Phase B) before progression matters.

Spectating stays open (no token to watch). A token is required only to
own/manage. `Role` finally means something: `Owner` (operator/director) vs
`Player` (scoped to their character), enforced server-side before serialization.

## 4. The world tier — and THE decision: simulation policy

Shared zones come from content via `ZoneKind` (`Town | Map` → an always-on
shared world), **minus any authored roster** — the salvageable idea from #7,
done without the placeholder. Per-character story/atlas instances are created on
demand and reaped when idle.

**Honest note on the create/reap primitives:** runtime world creation and
teardown **do not exist in trunk today** (`main.rs` builds worlds with struct
literals at boot; there is no `impl ManagedWorld`, and the tick loop never
removes a world). A `ManagedWorld::create` appeared on the **rejected** #7
branch but is *not* in `main` and is not assumed here — building a single
create-path + a teardown/reap primitive is **net-new work** this design
requires (and shares with the atlas, #21).

**The decision I need from you — character simulation policy:**

- **(A) Unbounded always-on.** Every registered character simulates 24/7. The
  literal idle-game promise. **Not viable as stated:** the single deterministic
  tick-thread (10 Hz, 100 ms wall) runs every world sequentially; each character
  can burn a 5000-instruction bot budget + syscalls + its sim step. A
  budget-saturating bot is hundreds of µs *before* sim; a few hundred active
  characters plus their monster populations plausibly blow the 100 ms tick, and
  overruns silently slow the **whole** broadcast (one shared thread). Unbounded
  always-on is a fantasy without sharding, and sharding (below) is hard.
- **(A′) Capped always-on + dormant long-tail — RECOMMENDED, and it IS the
  architecture, not a knob.** A bounded set of "active" characters simulate
  continuously (the broadcast-visible population); the long tail (abandoned /
  long-idle / never-connected) is **dormant**: persisted, not ticked, and
  evicted per §3. This bounds CPU to a known N, closes the Sybil/DoS hole, and
  keeps a single-process featured-director honest. Dormancy needs a defined
  wake rule (a returning owner re-activates their character) and, if we ever
  want "you progressed while away," an explicit **offline-catch-up** model —
  which I'd design separately and only if wanted (it's a second, non-
  deterministic progression path; flagged, not assumed).
- **(B) Active-window only.** Simulate only while the owner is connected.
  Cheapest, but the broadcast is empty when few watch — that isn't Idlin.
  Rejected as the primary model; (A′)'s dormancy borrows its mechanism for the
  tail.

**Sharding is not a free escape hatch.** "Shard by world" is clean for the sim
*arithmetic* (worlds are independent except at ferry hand-off) but **breaks two
things this design relies on**: (1) the **featured director** picks the most-
alive world by scanning every world each tick and re-routes watchers globally
(`runner.rs:220-229`, `main.rs:435-455`) — a cross-process aggregation problem;
(2) **cross-shard ferry ordering** reintroduces nondeterminism the single thread
currently avoids. So scale-out is a real research item, not a bullet point;
(A′)'s bounded N is what lets us **defer** it credibly. We ship single-process,
**instrument per-character per-tick cost**, commit to a target N, and shard only
if the measured numbers force it — designing the ferry as a queue now so the
seam exists.

`max_players` per zone stays content-authored (the ferry already respects it).

## 5. Persistence (keep #9; add an index; add reap-survival)

- **Keep per-world snapshots exactly as they are.** They are correct, tested,
  and the only complete resume source. No inversion.
- **Add the identity/routing index** as its own small durable store
  (`data/index/`: `player_id ⇄ character_id`, `character_id → world_key`,
  projection). Be precise about what is and isn't reconstructable: the
  **`character_id → world_key` location map and the projection ARE rebuildable**
  by scanning world snapshots (each character's name and location is in its
  world), so those are pure cache. But the **`player_id ⇄ character_id` binding
  is the index's OWN primary record** — today nothing in the sim carries an
  owner: `CharacterState` has only a `name`, and `CharacterBundle` no owner at
  all, so the binding is **not** reconstructable from snapshots and must be
  durably persisted as authoritative (the one thing the index genuinely owns).
  (Alternative: add `owner: player_id` to `CharacterState`/the bundle so the
  world snapshot becomes the sole record — but that mutates sim state folded by
  `state_hash`, a determinism/golden change; the cleaner first cut is to let the
  index own the binding.) Start as a flat file / per-key files (mirrors #9, zero
  new deps); swap to an embedded KV (sled/redb) later behind the same interface
  **only if** scale needs it (YAGNI until then).
- **Reap-survival rule (the one new persistence invariant):** *an instance is
  reaped only when it holds no live characters.* Characters ferry out to a
  shared world (which snapshots them) before teardown. This preserves #9's
  "exactly one place" invariant and means no character ever lives solely in a
  deleted snapshot.
- **Crash window is unchanged and honest:** `SAVE_EVERY_TICKS` bounds loss to
  ≤300 ticks for *all* live state (characters and world alike), exactly as
  today. We are **not** claiming the index reduces this — it can't; the world
  snapshot is the record and it saves on the same cadence.

## 6. The deploy path (closing the "build your idler" loop)

The portal (#17, PR #44) plans builds and composes params but cannot push them —
there is no write path. Add authenticated verbs:

- `C2S::Deploy { program }` — replace the owner's character's bot program.
  Validate (`Vm::new` accepts the versioned container, as `apply_joins` does),
  then **hot-redeploy the live bot** via `Bot::redeploy` (already preserves the
  persist block + bumps version). The character keeps simulating across the
  swap.
- `C2S::SetParams { bytes }` — write the character's `0xF000` param block (the
  chat-command channel; `Bot.params`).

Both **owner-only** (token resolves to that character) and rate-limited.
**Gated on real identity (§3, Phase B):** the persisted-deploy loop ships with
OAuth, not anonymous tokens, so an accumulating build is never protected by a
copyable string. This is what makes the bot-as-progression arc (#24, Arc 2)
real: iterate code on the *same* persisted character.

## 7. Determinism & replay (no overclaiming)

- A live persistent server is **not** one global deterministic replay — joins,
  arrivals, deploys, and params arrive at wall-clock-arbitrary ticks. The sim
  stays pure; the server stamps each input with its tick.
- **Exact replay requires a world SNAPSHOT as origin + the forward input-log** —
  you cannot reconstruct a world from character bundles (v1's error). The golden
  fixture (snapshot-free, fixed inputs from tick 0) stays as the determinism
  regression test.
- **The input-log does not exist yet.** `IDLIN_RECORD` records the *output* wire
  stream (replay-for-viewing). A true per-world input-log (re-feedable to the
  sim) is future work; until then, debugging a live world means resuming its
  snapshot and replaying recorded inputs forward — call it what it is.

## 8. The demo trio (what it should have been)

`["Kargan","Veles","Mirra"]` is **scaffolding**. Correct treatment: a
**dev/early-access seed** of AI idlers behind an explicit flag
(`IDLIN_DEMO_IDLERS=...`), used to populate an empty broadcast before real
registrations exist, and **never** written into content as first-class config.
In production the population is registered characters. This is the specific #7
mistake, foreclosed.

## 9. Migration (sequenced so the product is never stranded)

1. **Identity + registration, together.** Mint/resolve `player_id` from
   `Hello.token`; first-connect creates a character (starter template) in a
   shared entry world; reconnect resumes via the index→world_key. Replace
   `builtin_joins()` with "index-routed population + dev seed (§8)." *These ship
   as one phase* — splitting them (v1's mistake) strands production with an
   empty broadcast between "roster deleted" and "registration works." This is
   the proper replacement for the rejected #7.
2. **Create/reap primitives.** A single world-create path + a teardown/reap with
   the reap-survival rule (§5). Enables on-demand instances (shared with #21).
3. **OAuth (#17).** Real identity, *before* step 4 makes builds valuable.
4. **Deploy / SetParams.** The authenticated write path (§6); the portal goes
   live on real auth.
5. **Dormancy + eviction.** Implement (A′)'s dormant tail + abuse eviction (§3).
   (Could move earlier if anonymous-token abuse bites in testing.)
6. **Scale-out, only if measured.** Shard worlds behind the ferry queue, solving
   the featured-director aggregation and cross-shard ferry ordering (§4) — a
   real project, not a flag.

## 10. Decisions I need from you

1. **Simulation policy:** (A′) capped-always-on + dormant tail (my rec), or do
   you want true unbounded always-on (accepting it forces sharding early), or
   active-window (B)? This shapes everything downstream.
2. **Offline catch-up:** if a character is dormant while its owner is away,
   should it "progress while away" (a separate, non-deterministic model to
   design) or simply be paused until they return? I lean *paused* for v1.
3. **Identity ordering:** OK to gate the persisted-deploy loop on OAuth (so
   anonymous early-access characters are disposable), rather than shipping
   deploy on anonymous tokens?
4. **One character per identity, hard rule?** #24 says yes; confirming, because
   it removes the character-select screen forever and simplifies the index.

## What this doc deliberately does NOT do

- It does not promote any demo/placeholder to first-class config (#7's sin).
- It does not invent content schema for population — population is runtime state
  + a thin index, never authored content.
- It does not claim a world is reconstructable from character bundles (v1's
  false thesis), nor that a live server is one deterministic replay.
- It does not cite rejected-branch code as established infrastructure: runtime
  world create/reap is net-new work, not a "seam to reuse."
- It does not block the foundation on OAuth — but it does refuse to ship
  *valuable* progression on anonymous tokens.
