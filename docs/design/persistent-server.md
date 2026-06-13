# Persistent server: identity, character lifecycle, and the living world

Status: **design RFC (v4), for review.** Supersedes the rejected #7 approach
(which moved a demo roster into content and called it architecture). The model is
settled; this revision hardens it against two independent heavy reviews.

> **Revision history.**
> - **v1 — killed.** Thesis ("character store is system-of-record, worlds a
>   flushed cache, worlds reconstructable from the store") was *provably false* —
>   a `CharacterBundle` lacks the per-world RNG/tick/entity/zone-brain state the
>   determinism hash folds — and it cited `ManagedWorld::create` as reusable infra
>   when that exists only on the rejected #7 branch.
> - **v2** — inverted the model (world snapshot = record; thin index on top),
>   re-grounded against `main`.
> - **v3** — folded in the live-review decisions (sharded demand-driven zones,
>   frozen 15-min instances, native pluggable accounts, the lifecycle).
> - **v4 (this)** — fixes the blockers found by *two* independent reviewers
>   (Opus + GPT-5.5-xhigh, which converged): the "free-floating loot" falsehood,
>   the inverted tutorial anti-farm gate, an underspecified/unsafe transfer
>   protocol, the hand-waved ownership service, the non-existent
>   `max_players` auto-instancing (the real behavior is a data-loss bug),
>   over-claimed efficiency/latency, and migration ordering that stranded crash
>   isolation. Honesty markers: claims about existing code are grounded against
>   `main`; everything else is labelled net-new or future.

## 0. The realization that drives everything

**Idlin is an idle game on a broadcast.** Two consequences:

1. **Population = registered CHARACTERS, not connected viewers.** Idlers grind
   while you sleep; the stream shows a living world regardless of who's watching.
   "Join" = register a character; "connect" = attach to spectate/manage one.
   **Idlers are always somewhere — they never park**; a character is always in
   some zone, always simulated.
2. **Therefore compute ≈ active characters, and the ONLY scaling lever is
   horizontal sharding** (spread zones across cores/processes/machines).
   Demand-driven ticking and ephemeral maps are *efficiency/cleanup*, not a
   scaling lever — since nobody parks, the aggregate doesn't shrink (see §4).

## 1. Where we are today (grounded against `main`)

- **Topology.** `main.rs` builds at boot: two shared worlds with empty pending —
  `saltmere` (`main.rs:126-134`) and `coast` (`137-144`) — plus one private
  `withered_shore#<name>` per roster idler, each with that idler queued to join
  (`146-167`). Roster hardcoded `["Kargan","Veles","Mirra"]` (`main.rs:53`).
- **Resume** swaps each world's snapshot in if present (content-hash gated),
  carries mid-ferry arrivals, suppresses a builtin join for any name already
  resident (`main.rs:168-203`).
- **Character creation:** `JoinRequest { name, program }` (`world/mod.rs:62`) →
  `apply_joins` spawns a fresh level-1 `CharacterState` (`world/mod.rs:987`).
  Identity is the **name string**; `CharacterState` has no owner/account field —
  only `name` (`entity.rs:267`).
- **Portable record:** `CharacterBundle { character, program, persist, params,
  bot_version }` (`world/mod.rs:72`) — a **progression record**, not a world
  snapshot. Arrival re-derives net_id / bot RNG / VM registers (persist
  restored), clears `respawn_at` (`world/mod.rs:1010-1049`).
- **Persistence (#9)** is per-world: `save_managed` postcards the whole `World`
  (RNG, tick, entities incl. loot, zone brain, `pending_uses`, characters), per
  key, content-hash gated (`persist.rs:48,76`). Saves at the **post-ferry
  boundary** (`runner.rs:186`); `pending_departures` is `#[serde(skip)]`
  (`world/mod.rs:340`). So the durable invariant is **"a character is in exactly
  one world's state-or-pending at every persistence boundary"** — not at every
  in-tick instant. `SAVE_EVERY_TICKS = 300` + a graceful-shutdown save.
- **Determinism.** Pure sim; per-domain seeded RNG; `state_hash` folds
  content_hash + tick + next_net_id + all four world RNG `(state,inc)` pairs +
  `pending_uses` + the entire entity graph incl. ground loot
  (`views.rs:364-553`) — so a `CharacterBundle` **cannot** reconstruct a world.
- **Identity/auth: none.** `C2S::Hello` has an unused `token` (`protocol/lib.rs
  :473`); `Role` hardcoded `Owner` (`main.rs:364`). `C2S` is read-only. The
  director's featured pick lives in replication (`replication.rs:249`) with a
  most-characters fallback in `runner.rs:215` (corpses included); `main.rs:435-455`
  only re-routes a *watcher's* subscription, not the director decision.
  `IDLIN_RECORD` journals the **output** wire stream, not an input-log.
- **Known current bug the design must fix, not inherit:** a ferry to a full or
  unknown zone **silently drops the character** (`runner.rs:182`, "lost at sea")
  — data loss. There is **no** `max_players`-driven auto-instancing today;
  `ManagedWorld` is a bare struct with no `impl` on `main` (create/reap are
  net-new; the `feat/07-world-layout` `ManagedWorld::create` is on the rejected
  branch and not assumed here).

Single-process today means dupes are impossible by construction (#9's single
writer). That guarantee is what sharding must preserve (§6).

## 2. The model

A runtime world tier (exists) + an identity/routing store (near-term) that grows
into a full ownership authority **only when we shard** (§6).

```
  IDENTITY / ROUTING / OWNERSHIP  (phased — see §6/§10)
    Phase 1-4 (single process): account_id ⇄ [character_id] (cap 1),
      character_id → world_key, projection. A simple durable store.
    Phase 5+ (sharded): the SAME store gains owner_shard + epoch fencing and
      the transfer state machine — the consistency authority for hand-offs.
  ──────────────────────────────────────────────────────────────────────
  WORLD TIER  (exists; system of record for LIVE state)
    one shard = one ManagedWorld = one zone instance; per-world snapshot is
    the durable record (RNG, tick, entities incl. loot, brain, characters).
    #9 unchanged.
```

- **The per-world snapshot is the system of record for live state** — the only
  thing carrying the RNG/tick/entity/brain state needed to resume exactly. We do
  not make a character store authoritative (v1's false move).
- **The store owns only what snapshots can't reconstruct:** the **account ↔
  character binding** (nothing in sim state carries an owner today) and, once
  sharded, the **owner_shard + epoch**. `character_id → world_key` and the UI
  projection are *rebuildable* cache (scan snapshots). The ownership/fencing
  role is **not near-term** — phases 1-4 are single-process and need only the
  binding + routing.

## 3. Identity & accounts (native, pluggable) — closed-alpha first

- **A native, first-class account system is the foundation** (`account_id` = root
  identity), independent of any external service.
- **Auth providers are pluggable**: a credential resolves → `account_id`.
  Providers — anonymous-token, Twitch OAuth, GitHub OAuth, … — *link to* an
  account; none *is* the account.
- **Anonymous tokens are OWNER-MINTED ONLY** (operator action) → **disposable**
  characters (demo idlers, testing, early-access). No self-service minting. This
  is **closed-alpha access control**, not a general Sybil solution: it works only
  while the operator is the registration bottleneck. Bearer-token theft/sharing
  is contained by disposability + **owner revocation** (tokens are revocable;
  there is no self-rotation); real public registration arrives with the provider
  plugins and brings the native account system's own rate-limit/verification.
- `account_id → [character_id]` is **one-to-many with a registration cap (= 1
  now)** — not a hard 1:1 field. UI shows one character and skips
  character-select while the cap is 1; raising it later is config + a select
  screen, not a schema migration. (The one-character *game-design* pillar, #24,
  is separate and unchanged.)
- We do **not** hard-gate the deploy loop (§8) behind OAuth: owner-restricted
  minting handles closed-alpha abuse and disposability handles theft stakes.
  `Role` finally means something: `Owner` (operator/director) vs `Player`
  (scoped to their own character), enforced before serialization.

## 4. Compute & sharding

**A shard is one `World` is one zone instance** — the natural determinism
boundary and the existing `ManagedWorld` granularity.

- **Reliability comes in two separable steps, and v3 wrongly merged them.**
  1. **In-process per-world panic containment (ship EARLY).** Today one thread
     runs every world (`runner.rs:126`); a panic anywhere kills the whole sim.
     Wrapping each world's tick in `catch_unwind` + reload-from-snapshot gives
     crash *containment* with **no** distributed machinery, and must land *with*
     runtime instances (§10 phase 4) because those multiply the blast radius.
  2. **Multi-process sharding (later).** Supervised per-shard processes for true
     isolation + horizontal scale; this is what needs the ownership authority and
     fenced transfer (§6).
- **Demand-driven ticking is efficiency, not scaling.** A zone ticks only while
  ≥1 idler is in it; empty shared zones idle down. Since idlers never park (§0),
  this only removes **empty-zone overhead** — the aggregate is still ≈ active
  idlers. Treat it as memory/cleanup, not the scaling answer. **Scaling is
  horizontal sharding**, bounded per shard by `max_players`.
- **`max_players` auto-instancing is NET-NEW and replaces a current bug.** Today a
  full-zone ferry silently drops the character (`runner.rs:182`). The design
  requires: a popular zone opens additional shard *instances* (or the ferry
  queues/retries) — **never drops**. This is new work, not existing behavior.
- **Per-tick budget (numbers grounded; latency is a TARGET to measure).** 10 Hz →
  100 ms wall (`world/mod.rs:31`); a bot may burn `DEFAULT_TICK_BUDGET = 5000`
  instructions (`vm/lib.rs:56`) + syscalls (`SYSCALL_COST=20`, `bots.rs:24`) +
  its sim step. The per-character µs cost is **not yet measured** — a budget-
  saturating bot is *plausibly* hundreds of µs, but that is a **measurement
  target**, not an established fact. The model (cap per shard, many shards) does
  not depend on the exact number; the number sets the cap.
- **The cost of sharding (real work, not bullets):** (1) the featured director
  (`replication.rs:249`, `runner.rs:215`) and watcher re-routing become
  cross-process aggregation; (2) cross-shard ferry ordering reintroduces
  nondeterminism that must be canonicalized (input-log, §9) and is the dupe
  boundary (§6). Ship single-process first, measure, design the ferry as a queue
  now, shard when the numbers demand it.

### Instances (maps)
- Created on first entry (per-owner shard, keyed by `character_id` — §5).
- **Frozen when empty** (snapshot, stop ticking) the moment the last idler leaves.
- **15-min wall-clock GC** from last-leave: re-enter within the window → resume
  the same frozen instance (state + remaining portals); past it → reaped,
  regenerated fresh next time.
- **GC↔thaw is a compare-and-swap, not just an epoch bump.** Each instance has a
  record `{ instance_id, epoch, state: frozen|thawing|live|reaping|reaped }`;
  GC and re-entry both CAS that record, so a reaper can't delete a snapshot a
  thaw is starting from (the loser aborts). (Single-process this is a mutex;
  sharded it's a transaction on the ownership store.)

## 5. Lifecycle (home town, death, the tutorial gate)

- **Home town = last town visited**, set on entering any `ZoneKind::Town`. A new
  persistent `home_town: zone_id` on `CharacterState` (travels in the bundle;
  mutates `state_hash`/golden — a known, accepted change; it is set by a sim
  event, so it stays deterministic).
- **Death by zone kind:** *persistent area* → return to that area's **start**
  (reposition only, no penalty for now); *map instance* → ejected to the **town
  map device, −1 portal** on that map (portals-as-lives; 0 ⇒ map spent).
- **Respawn-at-home-town triggers** are exactly two: **bot-code update** (treated
  as a disconnect→reconnect) and **portal-obol use** (not implemented). **Not
  death.**
- **Tutorial anti-farm gate — corrected (this was inverted in v3).** v3 claimed
  the shore brain's `zl_once` (keyed by `net_id` in zone-brain VM memory,
  `zone_lib.bot:77`) gates the guaranteed drops. **That is the opposite of true:**
  `net_id` is re-minted on every arrival (`world/mod.rs:1024`) and the brain's
  kill-thresholds read **lifetime** `kills` (`brain.bot:135,153`), so a graduated
  character entering a *fresh* shore instance would re-trigger the
  weapon/flask/gem/obol on tick 1 — a printer. The fix has two parts:
  1. **Tutorial rewards are grant-once per character INCARNATION, not per
     arrival.** Eligibility is a durable flag (a `tutorial_grants` bitset on
     `CharacterState`), consulted by the sim/brain — **not** `net_id` and **not**
     zone-brain memory (both reset per entry and were the v3 exploit). Because the
     flag lives on `CharacterState`, **the full state wipe below clears it** — so
     a refresh-mid-tutorial correctly starts a clean, fully-grantable fresh run,
     while a *graduated* character (flag set, never wiped) can never re-trigger
     the grants. The grant-once flag and the wipe are complementary, not in
     tension.
  2. **The tutorial zone is non-re-enterable.** A graduated character (home town
     set) is never routed back to `withered_shore`; there is no town→shore path,
     and the design must not add one without (1) in place. ("Home town set" thus
     also means "tutorial graduated.")
  - **Refresh-without-home = full state wipe + restart tutorial** (prevents
    refresh-loop farming of first-time grants; identity persists, only character
    *state* wipes, so the post-wipe run is a legitimate first run). After a town
    is reached, refresh is a **soft reset to home that keeps progress.** Death in
    the tutorial is reposition-to-start, never a wipe.
- **Mid-map bot-refresh = a death-equivalent:** −1 portal + return to home town;
  the instance freezes under the 15-min/CAS rule. No free panic-escape.
- **The map device is the social hub:** in town (the high-occupancy shard), where
  idlers congregate; **per-player portal visibility** — an idler sees/enters only
  their own portals (instance keyed by owner). This is the atlas (#21) entry
  point — `UseMap` opens *your* instance.

## 6. Crash-safety & anti-dupe (the shard-boundary protocol)

Multi-process breaks #9's single-writer invariant. What keeps it tractable:
**tradeable possessions live inside the `CharacterBundle`** (inventory,
equipment, stash, currency on `CharacterState`). **Un-picked ground loot is a
free-floating entity** (`LootState`/`Entity.loot`, `entity.rs:345-372`) — but it
is **world-local**: it lives in the source world's snapshot, is removed
atomically before inventory is credited on pickup (`inventory.rs:413`, single
shard), and does **not** travel in the bundle (`process_exits` ships only
`CharacterState`, `mod.rs:864`). So the dupe surface is:

1. **A character existing in two shards at once** (botched cross-shard hand-off).
2. **A non-atomic generate/consume path** within a shard (none today — pickup,
   craft, drop all resolve in one tick; future *trade* or *shared stash* would
   add cross-character moves that must use the transfer protocol below).

### The ownership service (specify it, don't hand-wave it)
The fenced transfer needs a consistency authority. **Near-term it is a single-node
embedded store with `fsync` durability** — explicitly a **SPOF**, linearizable by
being a single writer, **no partition tolerance** ("no cross-shard transfers
while it is down"). This is acceptable because it arrives *with* multi-process
sharding (§10 phase 5), not before. **Upgrade path:** replicate it (Raft/etcd-
class) only when we run multiple nodes. We do not build a consensus system for a
single-box demo.

### The transfer is a durable 2-phase state machine (not local optimism)
Per character the service holds a state, and shards act **idempotently from the
service state**, never from local assumption:

```
source_owned
  → departing(transfer_id, src_epoch, bundle)      [source marks intent, durable]
  → destination_prepared(snapshot_ref)             [dest DURABLY persists the bundle]
  → destination_owned(epoch = src_epoch+1)         [COMMIT: service flips owner]
  → (source observes commit, drops its copy)
```

- **The commit point is `destination_owned`, and it requires
  `destination_prepared` first** — the durable destination write precedes the
  epoch flip, closing v3's flip-then-crash gap (no "owner-of-record with no
  data"). The destination's prepared copy stays **fenced inactive** (not ticked)
  until commit, so a pre-commit crash never yields a live duplicate.
- **Idempotent + fenced:** `transfer_id` dedupes replays; a shard may only
  tick/mutate a character it owns at the **current epoch**, so a stale source at
  `src_epoch` is rejected once the service is at `src_epoch+1`. On recovery a
  shard reads the service state and resumes deterministically: not-yet-committed
  → source still owns, retry; committed → source drops, dest is authoritative.
- **Everything crossing a shard boundary** (ferry; future trade/shared-stash)
  uses this; nothing moves as a non-atomic copy.

### Single-shard & rollback
- Single-shard activity is atomic per snapshot: a crash rolls back the whole
  since-save window — gains **and** consumptions together. You lose progress,
  never copy items.
- **Crash-to-rollback** (undo a bad craft/death/spend) deterrent: the bounded
  save window + you also lose good progress. For high-value irreversible commits
  (craft, boss, trade) we can snapshot-on-commit or append an action log —
  **strictness is your knob.**
- **None of this is built before multi-process** — single-process #9 already
  prevents dupes, so the transfer machinery is coupled to phase 5, not earlier.

## 7. Persistence
- **Keep #9's per-world snapshots as the live-state record** — unchanged.
- **The identity/ownership store** is primary (not reconstructable) for the
  account↔character binding and (when sharded) owner_shard+epoch; `world_key` +
  projection are rebuildable cache. Files first (mirrors #9, zero deps); embedded
  KV later behind the same interface (YAGNI). Its consistency model is §6.
- **Reap-survival:** an instance is reaped only when it holds no live characters;
  characters ferry out (flushing to a shared world's snapshot) before teardown,
  under the GC↔thaw CAS (§4). Preserves the "exactly one place at a persistence
  boundary" invariant.
- **Crash window unchanged/honest:** loss bounded to ≤`SAVE_EVERY_TICKS` for all
  live state; the store does not reduce this.

## 8. The deploy path
The portal (#17, PR #44) plans builds/params but can't push them (no write path).
Add authenticated verbs:
- `C2S::Deploy { program }` — replace the owner's character's bot program;
  validate via `Vm::new`. **The home-town respawn / wipe-if-no-home / mid-map
  −1-portal orchestration of §5 is NET-NEW** — `Bot::redeploy` (`bots.rs:98`)
  only resets VM registers and bumps version (persist preserved); it does *not*
  move the character, reset state, or cost a portal. Don't oversell it.
- `C2S::SetParams { bytes }` — write the character's `0xF000` param block.

Both **owner-only** + rate-limited; available to any authenticated identity
(abuse handled by owner-minting, §3). Makes the bot-as-progression arc (#24,
Arc 2) real: iterate code on the same persisted character.

## 9. Determinism & replay (no overclaiming)
- A live server is **not** one global deterministic replay. The sim stays pure;
  the server stamps inputs with their tick. Determinism is **per-shard over
  `(seed, content, input-log)`**, with a world **snapshot as the replay origin**.
- You **cannot** reconstruct a world from bundles (v1's error). The golden
  fixture stays as the regression test.
- **The input-log does not exist yet** (`IDLIN_RECORD` is output-only). Its
  format + snapshot-origin contract is defined in the **deploy/ferry phase** (it
  records joins/arrivals/deploys/params and canonicalizes cross-shard ferry
  order), not deferred to after sharding.

## 10. Migration (sequenced; nothing strands the product or reliability)
Each phase ships behind tests + the determinism fixture.

1. **Native accounts + registration — single-process, name-keyed compat.**
   Account system + owner-minted anonymous provider; resolve `Hello.token` →
   `account_id`; first registration creates a character in a shared entry world;
   reconnect resumes via `world_key`. Replace `builtin_joins()` with
   "store-routed population + an owner-minted dev seed." **Ships with tests
   proving no empty broadcast.** Explicitly single-process; no sharding/ownership
   semantics. *This is the proper replacement for the rejected #7.*
2. **In-process per-world panic containment** (`catch_unwind` + reload) +
   **fix the "lost at sea" ferry** (queue/retry, never drop). Reliability that
   doesn't need distribution.
3. **Lifecycle:** home town, death-by-zone-kind, the corrected tutorial gate
   (grant-once by `character_id`), respawn-on-deploy.
4. **Deploy / SetParams + the input-log** (§8, §9); the portal goes live. **Runtime
   create/reap + frozen-15-min instances land here, so phase 2's panic
   containment must already exist** (instances multiply the blast radius).
5. **Multi-process sharding + the ownership service + the fenced transfer (§6),
   when measured.** True isolation, horizontal scale, and the anti-dupe protocol
   land together — only needed once there are multiple processes.
6. **External providers (Twitch/GitHub)** on the account system's provider seam.

## 11. What this design deliberately does NOT do
- Promote any demo/placeholder to first-class config (the #7 sin) — the trio is
  an **owner-minted dev seed**, never authored content.
- Invent content schema for population — it's runtime state + the store.
- Claim a world is reconstructable from bundles, or that a live server is one
  global replay.
- Cite rejected-branch code as infra: world create/reap and `ManagedWorld::create`
  are net-new.
- Build distributed-transaction/anti-dupe machinery before there are multiple
  processes (it's coupled to phase 5).
- Treat owner-minted tokens as a general Sybil solution — they're closed-alpha
  access control until real provider auth lands.
- Block the foundation on external OAuth; it builds a native account system with
  pluggable providers.
