# Items

Items are content in `content/items/`, loaded and checked by `loadItems` in
`packages/sim/src/items.ts`. The module is not wired into the world yet:
nothing drops, nobody wears anything, and nothing is drawn.

## The files

- `rarities.json`: `normal`, `magic` and `rare`, each with a `weight` (the
  relative chance of an item rolling it), the most `prefixes` and `suffixes`
  it may have (0 to 3 each), and `min` and `max`, the range the number of
  affixes is rolled from.
- `bases.json`: base types by id. Each has a `name`, a `slot` (`weapon`,
  `body`, `helm` or `ring`), a `level` (the lowest item level it can be) and
  the `stats` every item of that base has.
- `affixes.json`: affixes by id. Each has a `name` ("Sharp" for a prefix,
  "of Aim" for a suffix), a `kind` (`prefix` or `suffix`), a `group`, the
  `stat` it adds to, the `slots` it can roll on, a `weight`, and `tiers`:
  a list of `{ level, min, max }` with levels going up.

Stats are `life`, `life_regen`, `damage`, `damage_pct`, `armour`,
`armour_pct`, `accuracy` and `speed`. Ids are lower-case letters, digits and
underscores; names are up to 24 letters, spaces and apostrophes.

Every number is a whole number, in these ranges:

| Value                                    | Range                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| rarity `weight`                          | 0 to 10000, at least one above 0                                             |
| rarity `prefixes`, `suffixes`            | 0 to 3                                                                       |
| rarity `min`, `max`                      | 0 to 6, `min` no more than `max`, `max` no more than `prefixes` + `suffixes` |
| base `level`, tier `level`               | 1 to 100 (item levels run from 1 to 100)                                     |
| stat values on a base, tier `min`, `max` | 0 to 10000, `min` no more than `max`                                         |
| affix `weight`                           | 1 to 10000                                                                   |

`bases.json` and `affixes.json` hold 1 to 100 entries each. An affix has 1 to
10 tiers and lists 1 to 4 slots, none twice. A list with gaps is refused, and
-0 is read as 0.

Loading refuses anything else, including unknown fields, with an `ItemError`
that names the file part and field. A table is returned only when all of it
is valid.

## Rolling

`rollItem(table, base, itemLevel, rng)` advances the world's generator and
returns an item: its base, level, rarity and the prefixes and suffixes it
rolled, each as `{ affix, tier, value }`.

1. The rarity is picked by weight, then the number of affixes evenly from its
   `min` to `max`.
2. Each affix is picked by weight from those that roll on the base's slot,
   still have room in their kind, share no group with an affix already on the
   item, and have a tier at or below the item level. If none is left, the
   item keeps the affixes it has.
3. The tier is picked evenly from the affix's tiers at or below the item
   level, and the value evenly from that tier's `min` to `max`.

`itemStats` adds the base's stats to the affixes' and then raises `damage`
by `damage_pct` percent and `armour` by `armour_pct` percent, rounding down.
`itemName` gives "Sharp Rusty Sword of Aim" for a magic item and the base's
name for the others; rare items have no names of their own yet.
