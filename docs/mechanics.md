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

- Attack skill damage per type = `character damage × coeff_bp/10000 +
  gem added (at gem level) + support added (at support level)`. Spells
  drop the weapon term entirely — their `added_*` formulas ARE the
  damage. Legacy support stat grants fold in as a per-use sheet, then
  support MORE multipliers apply on top.
- Gem growth is **formula-driven**: every scaling number is a
  `(base, per_level)` pair evaluated at the gem's level. Gems gain
  **half** of each kill's XP individually; gem XP to next = 60 + 30·L²;
  cap 20.
- **Use time, not cooldowns**: an attack occupies its user for the
  weapon's `use_ticks`; a spell for `cast_ticks` scaled by cast speed.
  No moving or acting mid-use. `cooldown_ticks` exists only on special
  skills (e.g. Power Shot) and runs on top of the use time.
- Nova/AoE skills hit up to `max_targets` nearest enemies, in
  deterministic (distance, id) order.

## Support gems

Supports socket INTO a skill gem and apply only to that skill. Capacity
is earned, not authored: a skill gem holds 1 support, a 2nd from gem
level 7, a 3rd from 14 — both skill and support gems gain half their
owner's kill XP while socketed, so a build's support depth grows with
play. Only one copy of a given support fits a skill. Two layers:

- **Tags gate the pairing.** Every skill gem declares `tags`
  (attack/spell/melee/projectile/aoe/duration/fire/…); every support
  declares `requires_tags` and must share at least one with the skill.
  A manual `SocketGem` with a mismatched pair fails (−1) and emits a
  loud GemRejected event; auto-socketing simply skips misfits.
- **Effects change behavior, not just numbers**: `more_damage`
  (multiplicative, per-type or all), `added_damage` (flat, scales with
  the SUPPORT's level), `inc_attack_speed` / `inc_cast_speed` (shorten
  the use time), `extra_projectiles` (the shot fans out in 12° steps),
  `pierce`, `aoe_inc` (grows ring radius, corridor width, and cone
  reach), `dot_duration_inc`, and `mana_mult` (multiplies the skill's
  mana cost; ReadSkills reports the final cost).

Current roster: Heavier Blows (melee: 20% MORE phys), Quickening
(attack: 20% attack speed), Added Embers (attack|spell: flat fire),
Split Quiver (projectile: +2 projectiles, 25% LESS damage), Widening
(aoe: 30% increased area).

## Attributes

Strength, Dexterity, and Intelligence are stats like any other (tree nodes
and gear affixes can grant them). Each point converts:

| Attribute | Per point |
|---|---|
| Strength | +0.5 maximum life, +0.2% increased physical damage with MELEE weapons |
| Dexterity | +2 accuracy, +0.2% increased evasion |
| Intelligence | +0.5 maximum mana, +0.2% increased energy shield |

(Mana and energy shield pools land with the combat rework's next phase;
the grants already evaluate.) Damage comes in five types — **physical,
fire, cold, lightning, chaos** — with four typed resistances (capped at
75% at use); armour attenuates physical only.

## Item identity (names and affix budgets)

PoE-style prefix/suffix items:

- **Normal**: the base name alone ("Driftwood Bow"), zero affixes.
- **Magic**: at most ONE prefix and ONE suffix; the name composes from
  the rolled affixes around the base — "Heavy Driftwood Bow of the
  Wind".
- **Rare**: 3–5 affixes (≤3 prefixes, ≤3 suffixes) and a generated
  two-word name drawn from `content/naming.ron` word pools ("Vile
  Thorns"); displays carry the base in parentheses.
- **Unique**: fixed-name, fixed-affix items are planned; until real
  unique defs exist they roll like extra-affix rares with generated
  names.

Worn rarity reads on the character: magic/rare/unique gear and weapons
carry a tier-colored emissive glow on the worn mesh. Idlers with an
empty slot wear nothing — fresh wretches wash ashore naked.

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

## Crits, projectiles, dots, and shapes

- **Critical strikes**: every skill carries a base crit chance (the basic
  attack: 5%); the `crit_chance` stat scales it, capped 95%. A crit
  multiplies the post-mitigation hit by your `crit_multi` (base ×1.5).
  Spells crit too. Dots never crit.
- **Spells vs attacks**: attacks scale the weapon and roll accuracy;
  spells carry their own per-gem-level base damage (`(base: 9,
  per_level: 3)` formulas in content), never miss via accuracy, and cast
  in `cast_ticks` scaled by cast speed.
- **Projectiles are real**: they travel tick by tick, stop on the first
  body they hit (minus `pierce`), and are stopped by obstacles. Sidestep
  an arrow and it misses you.
- **Shapes**: strike, self-nova, directional cone (`cone_cos_bp`),
  directional line (`width_cu`), ground-target point-AoE, projectile.
  Direction/point shapes are aimed BY THE BOT (UseSkillDir/UseSkillAt).
- **Damage over time**: skills can apply typed dots (`dot:` in content)
  that burn once per second; strongest per source+skill wins, reapply
  refreshes. Dots skip accuracy, block, crit, and variance.
- **Buffs**: skills can grant timed self-buffs (`buff:`); grants fold
  into the stat sheet while active.
- **Mana costs**: every gem declares one (`mana_cost` formula); the use
  fails (code −4) without the mana, and the cost is charged on the swing.

## Pools, recovery, and commitment

- **Mana**: base 35 + 4/level, +0.5 per Intelligence point and flat from
  gear. Skill costs land with the skill executor rework; the pool and its
  regen are live. Mana regenerates 2% of maximum per second inherently,
  plus any flat `mana_regen` stat.
- **Energy shield** (INT defense): absorbs all damage before life. After
  **4 seconds** untouched it recharges at 10% of maximum per second.
- **Block**: shields (the offhand slot) grant a basis-point chance to
  negate an incoming hit entirely, capped at 75%. Rolled after the
  accuracy roll, before damage.
- **Life/mana regen stats** apply once per second, always. The
  out-of-combat burst heal (2%/tick after 5 quiet seconds) remains.
- **Leech**: `leech_life`/`leech_mana` return that share of damage dealt
  to the attacker, capped at 10% of the pool per strike.
- **Use-time commitment**: swinging a weapon (or firing a gem) occupies
  you for the weapon's `use_ticks`, divided by attack speed — no moving,
  no other actions until it completes. Cooldowns now exist only as extra
  gates on special skill gems.

## Death, regen, respawn

- Out-of-combat regeneration: after **50 ticks** without dealing or taking
  damage, everything alive heals 2% max life per tick.
- Characters respawn at the zone spawn **50 ticks** after death, full life,
  no XP or item loss.
- **Walls**: generated obstacles block attacks. Every strike — melee,
  projectile, and each nova victim individually — requires unbroken line
  of sight from attacker to target; a rock between you and the enemy means
  no hit (and no cooldown spent). Movement slides around obstacles, so
  repositioning is automatic but costs time. Bots can test a lane first
  with the `LineOfSight` syscall (21).
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
