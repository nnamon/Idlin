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

## Use timing (windup → contact → recovery)

Every use — basic attack, skill, cast — COMMITS up front: mana,
cooldown, and the whole use time (`busy_until`) are paid the moment it
starts, and a `UseStarted` event announces the windup. The strike
itself resolves at the CONTACT tick — ~60% through an attack's use
time; at cast completion for spells — where the target is judged
FRESH: a victim that died or escaped past 1.5× range makes the blow
WHIFF (no refunds; that is what commitment means). Slow heavies are
therefore dodgeable, and the client rate-fits the swing clip so its
contact frame lands exactly when HitFx (numbers, flashes, shape FX)
arrives. Movement stays blocked for the full use; recovery is the
remainder after contact.

## Hit reactions: stun, freeze, knockback

Reactions scale with hit size RELATIVE TO THE VICTIM'S MAX LIFE — big
things resist naturally, no special-casing.

- **Stun**: chance ramps 0→100% as the (post-mitigation) hit grows
  from 12% to 25% of max life. A stun interrupts the victim's
  committed windup (the mana stays spent) and locks them for 4 ticks.
  A stunning COLD hit is a **freeze** instead: same lock, 6 ticks, icy
  read on the client.
- **Knockback**: an attacker's flat `knockback` stat (centi-units)
  shoves the victim along the blow on every hit; crushing hits (≥30%
  of max life) add an inherent 0.35 u shove. The slide is real sim
  displacement — walls and shut gates stop it.
- **Scaling**: `stagger` (attacker, increased) inflates the hit's
  effective size against the stun bar; `poise` (defender, increased)
  shrinks it. All three are ordinary stats — affixes roll them
  (Jarring/Staggering weapons, "of Driving"/"of Hurling" knockback,
  "of Poise" armour) and the monster pool carries "of Staggering" for
  elites whose blows rattle.

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

## Item requirements (and when they re-check)

Bases may demand a level and attribute floors (`req_level`,
`req_str/dex/int`) — and an item's LEVEL requirement is the higher of
its base floor and the highest rolled affix tier's ilvl: power demands
the level that earns it. (Affix tiers themselves only roll on items of
sufficient item level, which comes from the killed mob's effective
level — the chain is closed end to end.) Meeting them is checked at equip — and RE-CHECKED
on every event that can lower attributes: a tree respec, losing an
attribute-granting piece, an attribute buff expiring. An equipped item
that stops qualifying is SHED to the bag (or the ground when full),
loudly (GearShed event). The check runs to a fixed point in slot
order, and an item's own affixes never satisfy its own requirements.
Starter scraps are requirement-free by design — a level-1 wretch has
zero passive points, and the first-kill weapon must always lift.

## The Regret Obol (tree respec)

The FIRST tree is free, and so is pure steering (re-declaring a plan
that keeps every allocated node — a redeploy aiming future points).
Changing what's already allocated is a RESPEC: it consumes one
**Regret Obol**, resets allocated nodes, re-walks the new plan with
every banked point, returns gems from sockets you no longer own to
the pouch (overflow drops at your feet), and re-validates gear
requirements against the new attributes. Without the obol the
re-declaration is rejected loudly. Swapping builds mid-map is thus a
real, priced decision — not a free reroll.

## Item identity (names and affix budgets)

PoE-style prefix/suffix items:

- **Normal**: the base name alone ("Driftwood Bow"), zero affixes.
- **Magic**: at most ONE prefix and ONE suffix; the name composes from
  the rolled affixes around the base — "Heavy Driftwood Bow of the
  Wind".
- **Rare**: 3–5 affixes (≤3 prefixes, ≤3 suffixes) and a generated
  two-word name drawn from `content/naming.ron` word pools ("Vile
  Thorns"); displays carry the base in parentheses.
- **Unique**: authored items with a fixed name and a hand-set mod list,
  defined in `content/uniques/*.ron` (built on an existing base, with a
  `req_level`, a `drop_level` gate, and rolled-range `mods`). When the
  roller lands on Unique rarity it picks a real unique whose `drop_level`
  the killer's level clears; if NONE are eligible the roll fizzles —
  nothing drops (no rare cosplaying in orange). A unique's mods bake onto
  the instance as fixed grants (no affix tiers), fold into derived stats
  exactly like affixes, and its `req_level` gates equipping it.

Worn rarity reads on the character: magic/rare/unique gear and weapons
carry a tier-colored emissive glow on the worn mesh. Idlers with an
empty slot wear nothing — fresh wretches wash ashore naked.

## Currency (the obols)

Story zones are choreographed by their zone BRAIN (a bot, like
everything else): the Withered Shore's script guarantees a weapon on
your first kill, a gem suited to your wielded weapon on your second,
an obol on your tenth, narrates the march north, and pays the
Tidewarden's hoard — all without touching the loot math below.
Entities can also SPEAK (speech bubbles) from fixed content tables,
rate-limited, never free-text.

Drops follow the PoE order, per kill: **quantity first** — the
KILLER's `item_quantity` factor scales the number of drop rolls (base
35% expectation; whole overflow becomes guaranteed drops, e.g. +500%
quantity = 2 guaranteed + 10% chance of a third). Each roll then picks
its class (currency ~10%, gems ~12%, gear otherwise); gear rolls
rarity under the killer's `item_rarity` factor — the normal weight
(700) never moves while magic (250), rare (45), and unique (5) weights
scale — then affixes from the pools the BASE SUBSCRIBES to (each affix lives
in one named pool; the item lists its pools), tiers gated by monster
level. **Excess normal-rarity gear compacts**: at most one normal item
drops per kill; the rest convert into low-tier obols, so the shore
stays readable and trash kills still pay. Both find stats live on the
ordinary grant engine ("of Plunder" = rarity, "of Hoarding" =
quantity) and show on the focus panel.

Crafting is PoE verbs over the affix engine, held as plain COUNTS (no
bag space): **Transmute** (normal→magic), **Augment** (+1 affix on
magic), **Alter** (reroll magic), **Regal** (magic→rare, +1, new name),
**Alchemy** (normal→rare), **Chaotic** (reroll rare, new name),
**Exalted** (+1 on rare, name kept), **Scouring** (strip to normal),
**Divine** (reroll affix VALUES within their tiers). Obols drop from
monsters (~10% of drops, weighted — Exalted and Divine are rare),
stand on the shore under tier-colored pillars, and are spent through
`UseCurrency` on bag items only. Every roll draws from a dedicated
deterministic stream, so crafting spam never shifts loot luck.

## Monsters are characters

Everything-is-a-bot extends to everything-is-a-character: a monster def
can carry `mana` and a `skills:` kit — the same gem pool, fixed levels,
supports included (`(gem: "arc", level: 2, supports: [...])`,
validated at load against the same tag/duplicate rules). The kit
resolves at spawn into the exact structure characters socket; the same
executor, mana costs, cooldowns, and syscalls drive both. Monster gems
never gain XP — the def is the build. Weapon gates don't apply to
monsters (a monster IS its weapon).

### Area levels

Every zone declares a `level` (default 1). A normal mob fights at
`max(its def's authored level, the area level)` — the max() keeps
hand-designed ramps like the tutorial intact while real maps lift
everything. **Magic spawns at +1, rare at +2; authored uniques keep
their own level.** The effective level scales the def's baseline
(+12% life and +10% damage per level over it), pays +10% XP per
level, gates the elite's affix tiers, and stamps every drop's ITEM
LEVEL — items of a level only fall from mobs of that level.

### Monster rarity

The same Normal / Magic / Rare / Unique ladder as items, riding the
same affix system. A monster def subscribes to affix pools
(`affix_pools:`, default `["monster"]`); magic spawns roll 1–2 affixes
(≤1 per kind), rares 3–4 (≤3 per kind), applied through the ordinary
grant engine on top of an inherent elite bulk (magic ×1.6 life, rare
×2.6). Names come from the item machinery too: magic composes its
rolled TIER names ("Hulking … of Haste"); rares draw from the rare
naming pools.

Packs roll **as a group**, once per refill, from the pack's authored
`magic_bp` / `rare_bp` chances: a magic roll raises the WHOLE pack
magic wearing ONE shared affix set; a rare roll raises a single rare
leading an otherwise-normal pack. Pack rolls can never come up Unique —
uniques are authored (`unique: true` on the def, e.g. the Tidewarden)
and always spawn Unique. Brains can also stage elites directly
(`spawn_elite`).

Elites pay: ×2 XP for magic, ×4 for rare, and their rarity juices the
killer's quantity/rarity find factors on the drop roll (up to
+120%/+150% for a unique). Uniques in view get stacked boss life bars
top-center; magic/rare announce themselves with tinted nameplates.

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
- **Debuffs**: skills can land timed stat grants on their VICTIMS
  (`debuff:` — negative values: chill, blind, exposure) through the
  same effects system. Hitting a monster re-derives its stats from its
  def with active effects folded in, so a chilled tide husk genuinely
  moves and swings slower until the effect expires.
- **Mana costs**: every gem declares one (`mana_cost` formula); the use
  fails (code −4) without the mana, and the cost is charged on the swing.
- **Weapon gates**: attack skills list eligible weapon classes
  (`weapon_classes: [melee]` / `[bow]` / `[wand]`); using them with the
  wrong tool — or bare hands — fails with code −9. Spells (and attacks
  with an empty list) fire with anything.

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

## Zones, tilesets, and exits

Areas are AUTHORED: each bundle (`content/areas/<id>/`) carries a
`map.txt` glyph grid (1 character = 1 sim unit; zone dimensions derive
from it) and an optional `props.ron` set-piece layer (pure visuals —
buildings stand on collision-only `B` footprint tiles). The glyph
legend lives on a TILESET (`content/tilesets/<id>.ron`): a few themed
families, PoE-style, each owning its palette, look-and-feel variants,
its natural monster ecology, and its OPT-IN cosmetic `features` (sea,
bluffs_west, edge_hills, stars, fringe_scatter) — the renderer builds
only what a tileset declares.

Tiles may carry an `elevation` level (0 = base): the client raises
those cells into terraces (one level ≈ 2.6 world units, smoothed so
level changes arrive as short slopes). Elevation is pure LOOK — the
sim's walk grid stays flat — so level edges are authored with
non-walkable cliff tiles (the shore tileset's crag `K`), and a ramp is
simply a gap in the crag line where the slope shows. The Drowned
Coast is the first two-level map.

Collision is GRID-NATIVE: walkability and line-of-sight are tile
lookups (integer supercover; projectiles collide with walls through
the same path). The loader proves at load time that the spawn, every
pack anchor, and every exit are walkable AND reachable (flood-fill
from spawn) — unreachable content refuses to load.

Exits are PLACES. A zone declares them (`exits:` with a destination
zone id and an open flag); the zone brain gates them (`set_exit`);
and a character's bot must walk into reach and call `use_exit` to
leave. Nothing ever force-moves a character. `max_players` on a zone
(0 = unlimited) caps how many characters share one world of it —
story zones run solo instances; towns are shared.

GATES (`gates:` rects with an `id:`, toggled by the brain's
`set_gate`) block movement AND line of sight while shut — to bots
and monsters alike, nothing strains at or shoots through a lesson it
hasn't earned. The Withered Shore is built from them: a ladder of
beats (declare a build, first-kill weapon + flask, suited gem, the
flask gauntlet, the Shoal Witch's support gem + mana flask, a
guaranteed rare, the Tidewarden), each gate lifting when its lesson
lands. Scripted story drops never despawn — they are often gate keys.
