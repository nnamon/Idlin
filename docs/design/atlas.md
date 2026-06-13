# The Atlas — specification

The Atlas is Idlin's endgame: the system that gives a finished character somewhere
endless to go. It is built on four commitments:

- **Maps are items.** A map is a bag item that drops, is crafted, traded, and
  stashed exactly like gear. Its affixes *are* its difficulty and reward dials.
- **The device opens them.** A device in town consumes a map and opens it into an
  instanced zone built to that map's tier and mods.
- **Higher maps drop higher maps.** Sustain — keeping your stock of charts
  climbing — is the meta-game. There is no fixed "end."
- **No private hideouts, ever.** The only personal space is a map you are
  actively running; it is ephemeral and reaped when you leave.

Maps reuse the existing crafting economy (the shared affix roller and the obol
currencies) and the persistent-server **instance lifecycle** (created on entry,
frozen when empty, GC'd after a grace window — see `persistent-server.md`).

---

## 1. Map items

A **map base** is an item with `map: true` — a 1×1 bag item, not worn gear, that
carries rolled affixes.

```ron
// content/maps/tidewashed_chart.ron
MapBase(
    id: "tidewashed_chart",
    name: "Tidewashed Chart",
    tier: 1,                       // difficulty rung (1..N)
    tileset: "drowned_shore",      // the family the instance generates in
    tileset_variant: Some("storm"),
    area_level: 9,                 // feeds the instance's zone_level
    base_portals: 6,               // lives per run (PoE convention)
    boss: "tidewarden",            // the family boss spawned at the end
    affix_pools: ["map"],          // what it rolls from
)
```

- **Rarity rolls like gear:** Normal (no mods) · Magic (1–2 mods) · Rare (3–6
  mods) · Unique (fixed, authored). The full obol set applies — transmute a white
  chart to magic, alchemy/chaos a rare one chasing a juicy combination, exalt to
  add, scour a bricked roll, divine the values. **The crafting economy now
  applies to *content itself*.**
- **`item_level`** is set on drop from the dropping instance's level (the same
  level → ilvl → affix-tier chain gear uses), so higher-tier instances drop
  charts that can roll higher map-mod tiers.
- Maps sit in the bag, so they travel in the character bundle and are protected
  by the same anti-dupe transfer protocol as any possession (§6).

---

## 2. Map mods — the `"map"` affix pool

Map affixes are rolled by the standard affix roller against the `"map"` pool,
tiered by item level like every pool. They are **not** worn — at instance-build
time they are scanned by `Stat` into a `MapMods` value the instance reads. Three
families (values first-pass, tunable):

**Difficulty (prefixes) — more danger:**

| Mod | Tiers (by ilvl) | Effect on the instance |
|---|---|---|
| `map_pack_size` | +12% / +20% / +30% | more packs scattered |
| `map_monster_life` | +20% / +35% / +55% | global MORE life on every monster |
| `map_monster_damage` | +15% / +25% / +40% | global MORE damage on every monster |
| `map_area_level` | +1 / +2 | raises `zone_level` above the base tier |
| `map_extra_portals` | +1 (rare: +2) | more lives for the run |

**Reward (suffixes) — more loot:**

| Mod | Tiers | Effect |
|---|---|---|
| `map_item_quantity` | +20% / +40% / +60% | the runner's quantity find inside |
| `map_item_rarity` | +15% / +30% / +50% | the runner's rarity find inside |
| `map_pack_magic` | +% | per-pack chance to roll magic |
| `map_pack_rare` | +% | per-pack chance a rare leads |
| `map_currency_find` | +% | obol drop weight |

**Risk-for-reward (suffixes) — harder, but charts that carry these tend to roll
fatter reward mods:**

| Mod | Tiers | Effect |
|---|---|---|
| `map_monster_resist` | +20% / +30% / +40% | monsters gain typed resistance |
| `map_player_max_resist` | −2% / −4% | the runner's max resistances are lowered for the run |

`MapMods` mapping: `pack_size`/`pack_*` set the instance's pack count and rarity
rolls; `monster_life`/`monster_damage`/`monster_resist` stack a MORE multiplier
on top of the def's level-scaled stats; `item_quantity`/`item_rarity`/
`currency_find` fold into the runner's find factors *inside the instance only*;
`area_level` adds to `zone_level`; `extra_portals` adds to the run's portal
count; `player_max_resist` applies a temporary debuff for the duration.

---

## 3. The instance

Opening a map creates one ephemeral, per-owner zone instance.

- **Identity & seed.** The instance key is `map#<character_id>#<map base>#<run
  incarnation>`; its seed is `base_seed ^ fnv1a64(key)`. The same chart run by the
  same character within an incarnation reproduces the same layout, packs, and loot
  rolls — fully deterministic.
- **Level.** `zone_level = map.area_level + map_area_level mod`. That drives
  monster level (and thus their life/damage/xp) and the item level of everything
  that drops — the chain is closed, so a tier-15 map is genuinely tier-15
  dangerous and tier-15 rewarding.
- **Layout.** The instance generates in the map base's tileset family + variant.
  The target is a **seeded procedural generator**: carve a connected walkable
  region from the family's ground tiles, place a boss arena and a return exit.
  (Authored per-family templates are an acceptable bounded substitute when the
  generator isn't ready — same instance path, fewer distinct layouts.)
- **Population.** Packs are scattered from the tileset's `natural_monsters`, their
  count and rarity scaled by the map's `pack_size`/`pack_magic`/`pack_rare` mods;
  monster stats take the map's MORE multipliers. The map's **boss** is spawned at
  the arena (a unique, or a juiced generated rare at higher tiers).
- **Portals (lives).** The run starts with `base_portals + map_extra_portals`.
  Each **death** or **mid-run bot redeploy** consumes one portal and ejects the
  runner to the device; re-entry (within the lifecycle's grace window) resumes the
  same instance with the remaining portals. **0 portals ⇒ the run is over:** the
  instance is reaped and the map item is consumed.
- **Lifecycle.** Instances are **not persisted long-term**; they follow the
  persistent-server instance lifecycle — live while occupied, **frozen when
  empty**, GC'd after the grace window, reaped on completion or portal-exhaustion.

---

## 4. The device

The map device is a **place** in town — the social hub where runners gather (the
town is a shared, high-occupancy world; the device is where they launch from).

- **A place, range-gated** (≈2u), rendered as a prop, authored on the town zone
  (a `device` coordinate, validated walkable + reachable, mirroring the stash).
- **Per-player portals.** A runner sees and opens **only their own** maps;
  instances are keyed by owner, so no one enters another's run. The congregation
  is social, the runs are private.
- **Bot API** (proximity-gated to the device):
  - `read_maps(out, max)` → the maps in the bag, one record each: base id, tier,
    item level, rarity, remaining portals.
  - `use_map(inv_idx)` → consume the map and depart into its instance. Errors:
    out of device range; bad index; already at portal cap (re-entry of an active
    run uses the device too).
  - The instance carries a **return exit** (`UseExit`) back to the device.

---

## 5. The ladder & atlas progression

- **Maps sustain maps.** An instance drops map bases weighted toward its own
  tier, with a chance — scaled by the runner's quantity find and atlas
  progression — to drop the **next** tier. Baseline drop rates target ≥1 map per
  map cleared at the boss, so a competent runner climbs rather than runs dry.
- **Bosses are the completion mark.** Every map ends at a boss; killing it is the
  run's headline reward (a hoard juiced by the map's quantity/rarity) and what
  unlocks higher tiers. **Pinnacle bosses** sit behind keys assembled from
  sustained mapping, and carry **per-character completion marks** — the trophies
  one idler accumulates over weeks.
- **The atlas passive tree** is a **second, per-character tree**, separate from
  the build tree, earned by map completions and spent on *how you map* rather than
  on the character's body — e.g. "+pack size on all maps", "weight a specific
  content type", "access tier N+", "bosses drop +quantity", "chance not to consume
  a map". It is endless horizontal sidegrade: you re-weight your atlas, you never
  reroll a character. (This is Arc 1 of the one-character long game,
  `one-character.md`.)

---

## 6. Determinism & integrity

- **Deterministic.** Every instance is seeded by its key; same chart + same
  character + same incarnation ⇒ identical run. The sim uses only seeded RNG (no
  wall-clock, no `Math.random`).
- **No dupes.** Maps are possessions in the character bundle, so consuming a map
  and opening its instance is a fenced transfer under the anti-dupe protocol
  (`persistent-server.md` §6) — a crash mid-open never duplicates a chart or its
  contents.
- **Crafting integrity.** Rolling maps draws from the same dedicated deterministic
  currency RNG stream as gear crafting, so chart-spam never perturbs loot luck.

---

## Open design choices (for redline)

These are genuine design decisions, not implementation status:

- **Procedural generator vs authored templates** as the shipping layout source
  (variety vs effort) — the spec targets the generator; templates are the
  fallback quality bar.
- **The mod values and tier ladder above are first-pass** and want a balance pass
  against real character power at each tier.
- **Pinnacle-key design** — what assembles a key, how many bosses, the cadence.
- **Atlas-tree scope** — size, the content-weighting axes, whether tier access is
  gated by the tree or by boss completion.
- **Trade of maps** — whether charts are tradeable between players from day one
  (they are bundle items, so the machinery allows it; it's a design call).

> Implementation status, dependencies, and the phased build are tracked in the
> Atlas issue (#21) — this document is the standing target specification.
