# Idlin Mechanics Reference

All formulas are integer/fixed-point and bit-exact across platforms. Basis
points throughout: 10000 = 100%.

## The stat pipeline

Every source of power — gear affixes, passive tree nodes, support gems — is
a grant `(stat, layer, value)`:

```
final = (base + Σ added) × (1 + Σ increased/10000) × Π (1 + more_i/10000)
```

- **added** — flat units, summed.
- **increased** — all sources sum into ONE bucket, applied once. Ten "10%
  increased damage" = +100%, not ×1.1¹⁰.
- **more** — each source multiplies separately. Rare and powerful.

## Character bases (classless, level L)

| Stat | Base |
|---|---|
| Life | 100 + 14·(L−1) |
| Unarmed damage | 6 + L/3 physical |
| Accuracy | 90 + 12·(L−1) |
| Evasion | 20 + 6·(L−1) |
| Move speed | 3.3 u/s |
| Body radius | 0.45 u |
| XP to next level | 80 + 40·L² |

The equipped **weapon replaces** the unarmed attack (damage per type,
range, cooldown, projectile); class damage does not stack on top of weapon
base — affixes and the tree do. Armour/evasion bases sum from equipped
gear. Level-ups recompute everything and fully heal.

## Hit resolution (per strike)

1. **Hit roll**: chance = `10000·acc / (acc + eva/2)`, clamped to
   [3000, 10000] — nothing is unhittable, nothing always misses. A miss
   still swings (cooldown spent) and marks both parties in combat.
2. **Variance**: one roll, 75–125%, applied to every damage component.
3. **Mitigation per type**:
   - Physical — armour attenuation: `taken = raw·5raw / (armour + 5·raw)`.
     Armour is strong against small hits; big hits punch through. Armour
     equal to 5× the raw hit halves it.
   - Elemental / chaos — resistance: `taken = raw·(10000−res)/10000`,
     resistance capped at **75%** (floor −100% for future penalties).
4. Total damage minimum 1 on a hit.

Friendly fire is impossible: attacks only resolve across the
Player↔Hostile faction pair; Neutral entities can't hit or be hit.

## Skills and gems

- Skill damage base = `character damage per type × coeff_bp/10000 +
  gem added × gem_scale`, then support grants apply as a stat sheet on top.
- Supports socket into the skill gem itself (up to its `support_slots`,
  PoE2-style) and apply only to that skill.
- Gem scale: `1 + 4%·(gem level − 1)`; gems gain **half** of each kill's
  XP individually; gem XP to next = 60 + 30·L²; cap 20.
- Nova skills hit up to `max_targets` nearest enemies within the radius,
  in deterministic (distance, id) order. Per-skill cooldowns are
  independent of the weapon swing.
- Attack/skill cooldowns scale with attack speed:
  `cd = base·10000/attack_speed_factor`, minimum 2 ticks.

## Attributes

Strength, Dexterity, and Intelligence are stats like any other (tree nodes
and gear affixes can grant them). Each point converts:

| Attribute | Per point |
|---|---|
| Strength | +0.5 maximum life, +0.1% increased physical damage |
| Dexterity | +2 accuracy, +0.5 evasion |
| Intelligence | +0.1% increased elemental AND chaos damage |

## Experience and the passive tree

- Kills grant the monster's XP to the killer (full, plus the kill credit);
  **living characters within 10 u of the kill receive a 50% share**.
- **Two passive points per level-up, five on every 10th level** (level 100
  = 228 points total). Points are spent automatically along
  the bot's **declared build** (the `build [...]` list fixed at deploy):
  the next connected, unallocated entry is taken on each level-up.
  Allocation is append-only; redeploying with a new plan steers only
  future points. No respec exists yet (refund items are planned with the
  crafting system).
- Socketed gems each receive half of whatever XP their owner gains.

## Death, regen, respawn

- Out-of-combat regeneration: after **50 ticks** without dealing or taking
  damage, everything alive heals 2% max life per tick.
- Characters respawn at the zone spawn **50 ticks** after death, full life,
  no XP or item loss.
- **Walls**: generated obstacles block attacks. Every strike — melee,
  projectile, and each nova victim individually — requires unbroken line
  of sight from attacker to target; a rock between you and the enemy means
  no hit (and no cooldown spent). Movement slides around obstacles, so
  repositioning is automatic but costs time.
- Dead monsters leave corpses where they fell for **300 ticks** (30 s); a
  corpse is inert (no AI, untargetable, skipped by every system) and decays
  away on its own.
- Packs respawn **as a unit**: survivors hold their ground (no trickle
  refills); once the whole pack is wiped, `respawn_ticks` later it rises
  again at its spawn anchor.

## Loot

- 35% drop chance per monster killed by a character; **personal** — only
  the killer sees or takes their drops.
- 12% of drops are gems; otherwise gear: weighted base pick, rarity
  70% normal / 25% magic / 4.5% rare / 0.5% unique, affix count 0 / 1–2 /
  3–5 / 4–5, tiers gated by item level (= monster level).
- Ground loot despawns after 600 ticks. Pickup range 2.5 u.
- The bag is a **12×5 grid**; items have content-defined footprints;
  pickups fail when no rectangle fits. Gems go to a separate 12-slot pouch.

## Collision

Pairwise separation after movement: same-faction overlap gets a soft nudge
(0.05 u/tick — allies pass through each other), opposing factions push
0.4 u/tick (harder than any move speed — enemies body-block).

## Determinism

Identical (seed, content hash, input history) reproduces the world
bit-exactly on every platform: integer-only math, hand-rolled PCG32 with
independent streams per domain (AI, combat, loot, per-bot), fixed iteration
order everywhere, and a canonical state hash checked by golden replay
tests in CI.
