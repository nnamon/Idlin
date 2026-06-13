# The Atlas — endgame design writeup

**Decision (issue #21, user-confirmed 2026-06-13):** the Atlas is the endgame
spine. **Maps are ITEMS** that roll affixes from a dedicated pool through the
same roller gear uses; a **town device** consumes a map and the host spins up a
**generated instance** at the map's level with the map's mods; **higher maps
drop higher maps** (sustain is the meta-game). **No private hideouts, ever.**

> Per the issue's sequencing this is the **design writeup first** — map base
> schema, mod pool, generation recipe, instance lifecycle. It is grounded in
> the actual code seams (cited) and ends with a phased build plan. The build is
> a later phase, gated on #7 landing and built behind the tutorial. This doc
> commits the design; it ships no engine code.

## What already exists (the seams we build on)

- **Dynamic instance creation** — `ManagedWorld::create(content, base_seed, key,
  zone_id)` lands via **#7** (PR #27): the single world-construction path, seed
  `= base_seed ^ fnv1a64(key)`. Boot layout and (now) the atlas's on-demand
  instances both go through it. *Not yet on main — #7 is the hard dep.*
- **The ferry** (`runner.rs`): a character's `CharacterBundle` departs with a
  `dest`; the tick loop routes it to the world whose `key == dest` (else any
  world whose `zone_id == dest`) and pushes it as an arrival. `UseExit`
  (syscall 28) stages the departure. This is exactly how a runner enters and
  leaves a map instance.
- **The affix roller** (`world/loot.rs::roll_affixes_into`): takes
  `pools: &[String]` + `item_level` + prefix/suffix caps, filters affixes by
  pool membership and tier `ilvl ≤ item_level`, weight-picks tiers and rolls
  values. **Already shared by items and monsters** — maps are a third caller.
- **"Place" syscalls** as the device model: exits (`ReadExits`/`UseExit`) and
  the stash (#20: a `ZoneDef.stash` place, `near_stash` 2u gate, syscalls
  30–32) show the proximity-gated-place pattern a map device copies.
- **Tilesets as themed families** (`TilesetDef`): base tiles + palette +
  `variants` + **`natural_monsters`** (the mob pool for a family) + cosmetic
  `features`. The raw material for "pick family+variant, generate, scatter".
- **Area level** drives everything: `World.zone_level` scales monster
  life/damage/xp and drop item levels; the level→ilvl→affix-tier chain is
  closed. A map's level feeds `zone_level` directly.
- **Boss/pack spawning**: `SpawnPack` (authored packs, one-shared-rarity roll
  per refill) and `spawn_elite` (zone-brain, explicit rarity) — the parts a
  generated instance assembles.

## What does NOT exist yet (the net-new work)

1. **A procedural layout generator.** Every zone today is **authored** via a
   `map.txt` + tileset; the old disc-scatter `generate_obstacles` is still
   present on main as the no-tiles fallback (`world/mod.rs`) but is unreachable
   by live content (every shipped zone is authored) and is slated for removal in
   #8. Maps need either a seeded generator or an authored-template fallback
   (below) — not the disc scatter.
2. **Instance teardown.** Worlds live forever in a `Vec<ManagedWorld>`. Ephemeral
   map instances must be created on demand and **reaped** when empty.
3. **Map-mod interpretation.** Map affixes modify an INSTANCE, not a wearer —
   a new read of rolled affixes at instance-build time (the roller is reused;
   the *interpretation* is new).
4. **The device syscall + map item base + map pool content.**

## 1. Map base schema (maps are items)

A **map base** is an `ItemDef` flavored as a consumable chart, not worn gear:

- A new `GearSlot`-adjacent marker — recommend an `ItemKind`/`map: bool` flag on
  `ItemDef` (NOT a wearable slot; maps live in the bag grid like other items so
  they can carry rolled affixes and be crafted). Bases author `tileset` +
  optional `tileset_variant` (the family the instance generates in), a base
  `tier`, and `affix_pools: ["map"]`.
- A dropped map is an `Item { base_idx, rarity, item_level, affixes, … }` exactly
  like gear: `item_level` comes from the killing instance's level (the chain is
  already closed), rarity rolls Normal→Unique, and affixes roll from the `"map"`
  pool via the existing roller. **The whole crafting economy applies to content
  itself**: transmute a white chart to magic, alchemy/chaos a rare one chasing
  juicy instance mods, scour a bricked roll.
- Example: `Tidewashed Chart` (tier 1, tileset `drowned_shore`), `item_level 9`,
  rare, mods rolled from `"map"`.

## 2. The map mod pool (affixes that modify the instance)

A new `content/affixes/*.ron` set in pool **`"map"`**, tiered by ilvl like every
pool. These affixes' `(stat, value)` are read by the **instance builder**, not
folded into a character's `StatSheet`. Candidate mods (PoE-shaped):

| Mod (prefix/suffix) | Effect on the instance |
|---|---|
| `area_level` (+1..+3, tiered) | bumps `zone_level` above the base tier |
| `pack_size` | extra packs scattered |
| `pack_magic` / `pack_rare` | raises per-pack magic/rare roll chance |
| `monster_life` / `monster_damage` | flat-MORE on every mob (danger for reward) |
| `item_quantity` / `item_rarity` | the RUNNER's find factors inside the instance |
| `extra_boss` / `boss_rarity` | a tougher / additional boss |

This needs a small `MapMods` struct populated by scanning the consumed map's
rolled affixes (by `Stat`), passed into instance creation. Reusing the affix
engine means tiers, weights, and ilvl-gating come for free; only the
*interpretation* table above is new.

## 3. Generation recipe (instance layout + population)

Two options; we commit to the **template fallback for v1**, the **seeded
generator as the full vision**.

**v1 — authored map templates (zero new generator, ships fast).** Author a
handful of `map_<family>_<n>` template zones per tileset family (a `map.txt`
each, like the coast). On consume, pick a template for the map's family by the
instance seed. The entire existing authored-zone path (`World::new_for_zone` →
collision grid from tiles) is reused unchanged. Population: the template's
authored `packs` reference the family's `natural_monsters`; the map's
`pack_size`/`pack_*` mods scale counts/rarity; a boss is `spawn_elite`'d by the
instance brain. Replayability is bounded by the template count — honest, and
enough to prove the loop.

**v2 — seeded procedural layout (the real Atlas).** A deterministic generator
(`fn generate_map_layout(seed, tileset, area_level, mods) -> TileGrid + packs`):
carve a connected walkable region from the family's ground tiles (seeded
cellular/maze), scatter packs from `natural_monsters` weighted by `area_level`
and `pack_size`, place a boss arena, set the return exit. Seeded by the
instance key → fully deterministic and replayable. This is the larger build and
where most engine work lives.

Either way the instance is just a `ManagedWorld` whose zone was built from a
(template or generated) `TileGrid` + the map's `zone_level` + the runner's
find-factor mods.

## 4. The device + consume syscall

- **The device is a PLACE** in town: `ZoneDef.device: Option<(x,y)>` (mirror
  `stash`), validated walkable+reachable at load, rendered as a prop. Saltmere
  (and later the main hub) place one.
- **`ReadMaps`** (new syscall): list the maps in the bag (base, tier, ilvl,
  rarity) so a bot can choose — the inventory already exposes items; this is a
  filtered view or a flag on `ReadInventory`.
- **`UseMap(inv_idx)`** (new syscall, range-gated to the device like
  `stash_deposit`): consume the map item and stage a departure to a fresh
  instance. The bot must be at the device.

## 5. Instance lifecycle (create → run → reap)

1. **Create.** `UseMap` removes the map from the bag and stages a departure with
   a destination describing the instance: key = `map#<char>#<base>#<ilvl>#<salt>`
   and the rolled `MapMods` + tileset. The server, seeing a map-instance
   destination the ferry can't resolve to an existing world, calls
   `ManagedWorld::create` (#7) with that key → deterministic seed
   `base_seed ^ fnv1a64(key)`, builds the zone (template or generated) at the
   map's level with the mods, and pushes the character as an arrival.
2. **Run.** The instance ticks like any world. Its brain scatters/juices packs
   per the mods and places the boss; the boss hoard is juiced by the map's
   `item_quantity`/`item_rarity`. A **return exit** (dest = town) lets the runner
   leave; higher map bases drop here, feeding the ladder.
3. **Reap.** Ephemeral instances are **not persisted** (unlike town/shore) and
   are **torn down** when empty: the tick loop drops a `ManagedWorld` flagged
   ephemeral once it has held zero characters for N ticks (a new, small teardown
   path — the one piece of lifecycle the engine lacks today). If the runner
   disconnects/dies, respawn returns them to town and the instance reaps.

## 6. The ladder

Higher-tier instances drop higher-tier map bases (the `"map"` drop weighting
tiers up with `zone_level`), so **sustain is the meta-game** — a good runner's
program banks and re-rolls charts to keep climbing. Map **bosses** are
`spawn_elite` uniques or generated rares with juiced hoards. The per-character
**atlas progression** (the atlas passive tree, per #24's "Atlas" arc) is earned
by completion and spent on *how you map* — endless sidegrade, no reroll.

## 7. Determinism, content-hash, wire

- **Deterministic:** every instance is seeded by its key, so the same chart
  consumed by the same character reproduces the same layout/packs/loot. No
  wall-clock, no `Math.random` (the sim forbids both).
- **content_hash / golden:** adding map bases, the `"map"` pool, and any
  template zones moves `content_hash` → the golden re-pins (content-only if the
  golden world doesn't run atlas content). Ephemeral instances seeded by key
  keep replays exact.
- **Wire/PROTO:** if maps surface in the inspect sheet or an instance HUD badge
  ships, that's a `PROTO_VERSION` bump + regenerated TS bindings. The core loop
  needs none (maps are bag items; instances are just worlds).

## 8. Prerequisites & phased build (post-design)

**Prereqs:** **#7** (ManagedWorld::create — the instance seam; merge first), the
generated-zone layout (template fallback first, generator later), the `"map"`
affix-pool content, and the device syscall + ferry-into/teardown-of ephemeral
worlds.

**Phases (each: tests + golden re-pin + docs):**
1. **Map item + pool** — `ItemDef` map flag, `"map"` affix pool content, drops
   roll charts; `MapMods` interpretation struct (no instances yet — a chart you
   can roll/craft/stash).
2. **Device + consume + template instances** — device place, `ReadMaps`/`UseMap`,
   ferry into a `ManagedWorld::create`'d instance from an authored template,
   return exit, **teardown path**. The loop closes end-to-end on templates.
3. **Procedural generator** — seeded layout + pack scatter from
   `natural_monsters`; retire the template fallback (or keep as set-pieces).
4. **Boss hoards + the ladder** — juiced map bosses, higher-maps-drop-higher,
   the atlas passive tree (#24 Arc 1).

## Concerns for redline
- **v1 = authored templates** (bounded variety) vs jumping straight to the
  procedural generator (much larger, the real vision). I recommend templates
  first to close the loop, generator second — flagged.
- **Teardown** is the one genuinely-missing lifecycle primitive; everything else
  reuses existing seams.
- **Map mods as a non-StatSheet interpretation** is the only new
  affix-semantics layer; keeping the *roll* on the shared engine is deliberate.
- Depends on **#7** (instance seam) and reads best alongside **#24** (the Atlas
  is Arc 1 of the one-character long game).
