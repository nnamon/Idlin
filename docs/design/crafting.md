# Crafting — design (first draft, for redline)

The crafting MECHANICS exist and are deterministic (a dedicated
`rng_craft` stream, so currency spam never shifts the loot rolls). This
doc settles the **roster** and lays out the **depth vision** the parked
issue (#18) asked for. Numbers below are a first draft — redline freely.

## The obol roster (content/currency/*.ron)

Currency is COUNTED, not bag-stored; it drops (≈10% of drop rolls,
weighted) and trash-compaction mints low-tier obols. Each obol is a
verb applied to ONE bag item via `use_currency` (UseCurrency syscall).
The table is ordered by weight (common → rare); the **Idx** column is
the index a bot reads (currency is sorted by id, so the bot index is
the alphabetical order — see bot-guide).

| Idx | Obol | Op | Tier | Weight | What it does |
|---|---|---|---|---|---|
| 9 | Transmute | to_magic | 1 | 100 | Normal → Magic (1–2 affixes) |
| 2 | Augment | add_affix_magic | 1 | 90 | +1 affix on a Magic item with room |
| 1 | Alter | reroll_magic | 1 | 80 | reroll a Magic item's affixes |
| 8 | Scouring | to_normal | 1 | 40 | strip to Normal (start over) |
| 6 | Regal | to_rare | 2 | 35 | Magic → Rare, +1 affix |
| 0 | Alchemy | normal_to_rare | 2 | 30 | Normal → Rare (3–5 affixes) |
| 3 | Chaotic | reroll_rare | 2 | 25 | reroll a Rare's affixes |
| 7 | Regret | respec | 2 | 12 | (not an item op) buys a passive RESPEC |
| 4 | Divine | reroll_values | 3 | 8 | reroll affix VALUES within their tiers |
| 5 | Exalted | add_affix_rare | 3 | 6 | +1 affix on a Rare with room |

Tiers gate trash-compaction (≤1) and signal rarity/value. Acquisition
is a smooth curve: tier-1 spam obols are common, tier-3 finishers rare.

## Bot crafting policy (what ships now)

The grinder spends Alchemy obols on white bag gear (Normal → Rare) — a
big monotonic upgrade that `equip_best` then equips. It's the demo that
makes currency MATTER and stream content (the ticker celebrates each
craft). Deliberately minimal and legible; smarter policies below are
proposed for redline, not yet built.

**Index fragility (known limitation):** player templates compile without
a content database, so unlike zone brains they can't use `currency
"..."` name refs — they hardcode the sorted index. The grinder uses
Alchemy = 0 (sorts first, stable). A name→index lookup for player bots
(or a ReadCurrency that returns ids) is a planned follow-up.

## Depth vision (proposed — redline)

- **Smarter bot policies**: "chaos-spam a rare until it has both
  resists", "regal promising magics", "exalt a rare with an open
  affix". These need the bot to READ an item's affixes (a richer
  ReadInventory or a per-item inspect) — currently it only sees rarity +
  item_level. A first real depth step.
- **Deterministic bench crafts**: spend currency for a GUARANTEED
  outcome (add a chosen affix, set a tier) — removes pure gambling for
  the floor of a build. PoE's crafting bench. Lives at a town BENCH
  place (#23 teaches it).
- **Meta-crafting**: "prefixes cannot be changed", fractured/influenced
  mods, multi-mod — the endgame chase. Far later.
- **Map crafting** (#21): maps are items; the SAME obols roll the map's
  modifiers. The crafting economy applies to content itself.

## Open questions for the user
1. Steepness of the acquisition curve (drop weights above are a guess).
2. Should currency be stashable, or always carried? (Currently carried —
   bots need obols mid-map for Regret; recommended to keep carried.)
3. Which depth step first after this draft: smarter bot policies
   (needs affix-read), or the deterministic bench (needs #23)?
