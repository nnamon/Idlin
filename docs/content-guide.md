# Idlin Content Authoring Guide

The engine runs content. Zones, monsters, items, affixes, gems, the passive
tree — and *behavior* — all live in `content/` as data, validated at server
start. A content mistake fails the boot with a path and line, never a live
game.

## Conventions

- **Format**: [RON](https://github.com/ron-rs/ron). Comments allowed.
- **Distances/speeds**: integer **centi-units** (`250` = 2.5 world units;
  `speed_cps: 330` = 3.3 units/second).
- **Percentages**: integer **basis points** (`1500` = 15%).
- **Time**: ticks (10/second).
- **Content hash**: every file feeds a hash recorded in snapshots and
  replays. Changing any content invalidates old snapshots (the server
  starts a fresh world and says so) and changes the golden replay hash —
  update `crates/idlin-sim/tests/golden.rs` deliberately when you intend it.
- Files are loaded by directory; ids must be unique within a kind;
  cross-references are validated at load.

## `content/zones/*.ron` — ZoneDef

```ron
ZoneDef(
    id: "withered_shore",
    name: "The Withered Shore",
    width_u: 60, height_u: 60,        // whole units
    spawn_x_u: 17, spawn_y_u: 122,    // idler spawn point
    spawn_radius_u: 7,                // spawn AREA: join/respawn scatter (0 = exact point)
    // collision and line-of-sight come from the authored map.txt tiles
    packs: [
        SpawnPack(monster: "drowned_shambler", count: 4,
                  x_u: 14, y_u: 16,   // pack anchor
                  radius_u: 5,        // spawn jitter
                  magic_bp: 2000,     // rarity roll, ONCE at spawn:
                  rare_bp: 700),      //   20% whole-pack magic, 7% one rare
    ],
)
```

Packs rise exactly once, at the world's mint — a wiped pack stays wiped
(the world is finite; no refills). The rarity roll happens at that one
spawn: magic raises the WHOLE pack under one shared affix set; rare
raises a single rare leading normals; packs never roll unique (author
`unique: true` on a def instead). Omit the chances (default 0) for
hand-choreographed zones like the tutorial, where elites come from the
brain's `spawn_elite`.

### Previewing a map

Authoring `map.txt` is no longer blind — render a zone to a PNG without
booting the server:

```sh
cargo run -p idlin-content --bin preview -- coast          # -> target/preview/coast.png
cargo run -p idlin-content --bin preview -- coast out.png --cell 16
```

It draws the tileset ground palette (variant-aware), elevation banding,
props, the spawn point + radius (green), pack anchors + jitter radii
(orange), exits (cyan), gates (magenta), and washes any walkable cell
**unreachable from spawn** in red — so a pocket walled off behind rock
(the Tidewarden bug) jumps out before it ships.

## `content/monsters/*.ron` — MonsterDef

```ron
MonsterDef(
    id: "tide_husk",
    name: "Tide Husk",
    model: "husk",            // client visual key
    brain: "hostile_melee",   // content/brains/<id>.asm drives it
    hostile: true,            // false = Neutral faction (unattackable NPC)
    level: 3,
    life: 150,
    damage: 14,               // physical attack damage
    damage_fire: 0, damage_cold: 0, damage_lightning: 0, damage_chaos: 0,
    armour: 80, evasion: 0,
    accuracy: 0,              // 0 = derived: 60 + 15·level
    resist_cold: 2500,        // typed resists: resist_fire/_cold/_lightning/_chaos (bp)
    resist_chaos: 0,
    speed_cps: 160,
    radius_cu: 80,            // body radius (collision)
    range_cu: 220,
    use_ticks: 16,            // ticks one attack occupies (base attack time)
    aggro_radius_cu: 800,     // exposed to the brain via SelfStatus
    xp: 70,
    projectile: false,        // client renders ranged tracers
)
```

## `content/brains/*.bot` — NPC behavior

Brains are **`.bot` programs** (see the language reference in
[bot-guide.md](bot-guide.md); raw `.asm` also accepted), compiled at content
load. Monsters run the exact same VM and syscalls as players;
`read_entities` filter 1 means "enemies of me", so one brain works for any
faction. The file stem is the brain id.

## `content/items/*.ron` — ItemDef

```ron
ItemDef(
    id: "rusted_cleaver",
    name: "Rusted Cleaver",
    slot: weapon,             // weapon | offhand | helm | chest | boots
    w: 2, h: 3,               // bag footprint (the bag is 12×5)
    // weapon fields — the equipped weapon DEFINES the normal attack:
    damage_phys: 14, damage_fire: 0, damage_cold: 0, damage_lightning: 0, damage_chaos: 0,
    range_cu: 220,
    use_ticks: 8,             // base attack time (speed stats divide it)
    projectile: false,
    // armour fields:
    armour: 0, evasion: 0,
    block_bp: 0,              // offhand only: chance to block a hit (bp)
    weight: 100,              // relative drop weight
)
```

## `content/affixes/*.ron` — AffixDef

An affix grants a LIST of effects with item-level-gated tiers — one effect for a
plain mod, several for a HYBRID (one roll, several stats). Each tier carries one
`rolls` range PER effect, positional. Rarity sets the affix count: magic 1–2,
rare 3–5, unique 4–5.

```ron
AffixDef(
    id: "heavy",
    name: "Heavy",                     // prefixes prepend, suffixes append
    kind: prefix,                      // prefix | suffix
    weight: 100,                       // eligibility is NOT here — a pool lists this affix
    effects: [(stat: damage_phys, layer: increased)],  // stat(s) granted; see registry below
    tiers: [
        (ilvl: 1, name: "Heavy",  weight: 100, rolls: [(min: 800,  max: 1500)]),
        (ilvl: 3, name: "Brutal", weight: 45,  rolls: [(min: 1600, max: 2500)]),
    ],
)
```

A HYBRID names several effects; each tier rolls one range per effect, in order:

```ron
AffixDef(
    id: "of_the_fox", name: "of the Fox", kind: suffix, weight: 55,
    effects: [(stat: dexterity, layer: added), (stat: evasion, layer: increased)],
    tiers: [
        (ilvl: 1, name: "of the Fox", weight: 100, rolls: [(min: 5, max: 10), (min: 500, max: 900)]),
    ],
)
```

An effect may carry a `condition` (note the explicit `Some(...)`, RON-style) — it
applies only while the predicate holds, evaluated from hashed state so it stays
deterministic. Conditions: `wielding_weapon_class(melee | bow | wand)` (unarmed
counts as melee).

```ron
effects: [(stat: damage_phys, layer: increased,
           condition: Some(wielding_weapon_class(melee)))],   // "increased phys with melee"
```

**Stat registry**: `strength, dexterity, intelligence, life, damage_phys,
damage_fire, damage_cold, damage_lightning, damage_chaos,
mana, energy_shield, life_regen, mana_regen, leech_life, leech_mana,
attack_speed, cast_speed, move_speed, armour, evasion, accuracy, block,
crit_chance, crit_multi, resist_fire, resist_cold, resist_lightning,
resist_chaos` (attributes convert per
[mechanics.md](mechanics.md); STR's increased-melee-phys is a conditional effect,
not a stat — see below). The same vocabulary powers gear, tree nodes, and support
gems — one evaluator (see [mechanics.md](mechanics.md)).

### Monster skill kits

MonsterDef takes `mana:` and `skills:` — the same gems characters use,
cast through the same brain syscalls:

```ron
    mana: 40,
    skills: [
        (gem: "arc", level: 2, supports: [(gem: "widening", level: 1)]),
    ],
```

Slot 1..N in list order for UseSkill/ReadSkills; load-time validation
enforces real gems, right kinds, tag fit, and no duplicate supports.

## `content/gems/*.ron` — GemDef

```ron
GemDef(
    id: "ember_bolt",
    name: "Ember Bolt",
    kind: skill,                        // skill | support
    skill_kind: spell,                  // attack | spell (default attack)
    target_mode: entity,                // entity | point | direction
    tags: [spell, projectile, fire],    // gate which supports fit
    weight: 60,
    // -- damage --
    coeff_bp: 0,                        // attacks: % of weapon damage (bp)
    added_fire: (base: 9, per_level: 3),// Formula: the gem's own damage
                                        // (added_phys/cold/lightning/chaos too)
    crit_bp: 600,                       // per-skill base crit chance
    // -- costs & timing --
    mana_cost: (base: 6, per_level: 1), // Formula; gated — a use needs the mana
    life_cost: (base: 0, per_level: 0), // Formula; UNGATED — paid even past 0 (self-kill)
    cast_ticks: 7,                      // spells only; attacks use the weapon
    cooldown_ticks: 0,                  // SPECIALS only, on top of use time
    // -- geometry (per shape) --
    shape: projectile,    // target | nova | cone | line | point_aoe | projectile
    range_cu: 900,        // 0 = weapon range
    radius_cu: 0,         // nova/point_aoe radius
    cone_cos_bp: 7000,    // cone: cos(half-angle) in bp (7000 ≈ 90° total)
    width_cu: 0,          // line corridor width
    proj_speed_cps: 1500, // projectile flight speed (centi-units/s)
    pierce: 0,            // bodies a projectile passes through
    max_targets: 1,
    // -- riders --
    dot: None,            // Some(DotDef(dtype, per_second: Formula, duration_ticks))
    buff: None,           // Some(BuffDef(grants, duration_ticks)) — self-buff on use
    debuff: None,         // Some(BuffDef(...)) — lands on VICTIMS (negative = chill etc.)
    weapon_classes: [],   // attack skills: eligible weapons (melee|bow|wand; [] = any)
    // Support capacity is NOT authored: a skill gem earns slots by level
    // (1 base, +1 at 7, +1 at 14).
)

GemDef(
    id: "split_quiver",
    name: "Split Quiver",
    kind: support,
    weight: 60,
    requires_tags: [projectile],        // must share ≥1 tag with the skill
    effects: [
        extra_projectiles(count: 2),    // fan in 12° steps
        more_damage(dtype: None, bp: -2500),   // 25% LESS, all types
        cost_mult(bp: 3000),            // 130% cost (mana AND life)
    ],
    // effects vocabulary: more_damage(dtype: Option, bp) ·
    // added_damage(dtype, amount: Formula — at the SUPPORT's level) ·
    // inc_attack_speed(bp) · inc_cast_speed(bp) · extra_projectiles(count) ·
    // pierce(count) · aoe_inc(bp) · dot_duration_inc(bp) · cost_mult(bp)
    // (legacy `grants:` stat lists still apply if present)
)
```

Gems drop (12% of drops), live in the pouch, and — while socketed —
gain half their owner's kill XP (cap level 20, supports included);
every Formula field re-evaluates at the gem's level. A skill gem
socketed in a `socket` tree node becomes UseSkill slot 1..N; supports
socket INTO that skill gem (capacity 1, +1 at gem level 7, +1 at 14;
one copy of each support), and the tag gate is enforced at socket time
(manual mismatch → −1 + a GemRejected event; auto skips misfits).

## Packaging an area — the canonical bundle

Everything one area needs ships together under `content/areas/<name>/`:

```
areas/withered_shore/
  zone.ron              the ZoneDef (its `id:` stays the lookup key)
  brain.bot             the area's script; the brain id IS the
                        directory name, so `brain: Some("<name>")`
                        in zone.ron resolves automatically
  monsters/*.ron        area-exclusive monsters (shared archetypes
                        stay in content/monsters/)
```

Start a new area by copying `content/templates/area/` (the loader
ignores `templates/`). Scripts DRY via the include directive —
`include "zone_lib.bot";` resolves under `content/lib/`, which
holds shared libraries (include-only, never brains themselves):
`zone_lib.bot` provides the per-character beat table (`zl_once`,
`zl_narrate_once`) and the record-offset constants. Included files
hash like any content, so a library edit changes the world's content
identity.

GOTCHA the library header repeats: `&&`/`||` are EAGER in the bot
language (both sides always evaluate) — keep side-effecting calls
like `zl_once` nested inside their gates, never beside them in a
compound condition.

## Zones — declarative data plus a scripting BRAIN

Zones are data: `kind` (story | map | town — story zones respawn you
at the entrance), extent, spawn point/scatter, `camp_radius_u` (a
sanctuary monsters never acquire characters inside), area-gen counts,
and packs that rise once as units (radius 0 = staked on the anchor).
Behavior belongs to the zone's `brain:` — a bot program with
zone-scoped syscalls (see bot-guide) — and its narration text lives in
the def's `lines:` list as `(id: "welcome", text: "…")` entries the
script fires BY NAME (`narrate(line "welcome", net)`), so inserting a
line never scrambles the story. Gates carry an `id:` for the same
reason (`set_gate(gate "start", 1)`); exits are addressed by their
destination (`set_exit(exit "saltmere", 1)`). All other content is
referenced by id too — `item "rusted_cleaver"`, `gem "arc"`,
`monster "tidewarden"` — resolved to indices at load; a typo refuses
to load. The Withered Shore's brain choreographs the whole tutorial:
welcome beat, first-kill weapon, suited-gem second kill, the first
obol, threshold story lines, and the Tidewarden's hoard.

Monsters may also carry `lines:` — things they SAY as speech bubbles
(the Say syscall); `content/speech.ron` holds the fixed set characters
may say.

## Affix pools — the pool owns its membership

Eligibility lives on the POOL side, never on the affix. A pool file
(`content/pools/<id>.ron`) LISTS the affixes it contains, and every base
item/monster lists the pools it draws from (`affix_pools: ["armour",
"find"]` on the ItemDef). The affix itself is pure stat+tier data with no
pool of its own — to make an affix roll somewhere, add its id to a pool.

```ron
// content/pools/weapon.ron
AffixPool(
    id: "weapon",
    affixes: ["heavy", "honed", "of_ruin", "of_kindling", /* ... */],
)
```

Current pools: `weapon` (offense), `armour` (life/defenses/resists),
`accessory` (rings/amulets/belts), `arcana` (mana/cast), `stride`
(movement, boots), `find` (rarity/quantity), `flask`, and `monster`
(rare/magic monster mods, never on player gear). An affix may sit in more
than one pool. New gear granularity is free: add a `bow` pool listing the
bow-only affixes and have bows subscribe. Loading fails on a subscription
to an undefined pool, a pool listing an affix that doesn't exist, or an
affix that no pool lists (it would be unrollable).

## `content/currency/*.ron` — CurrencyDef

```ron
CurrencyDef(
    id: "chaotic_obol",
    name: "Chaotic Obol",
    op: reroll_rare,      // to_magic | add_affix_magic | reroll_magic |
                          // to_rare | normal_to_rare | reroll_rare |
                          // add_affix_rare | to_normal | reroll_values
    weight: 25,           // drop weight within the currency pool
    tier: 2,              // 0..3 — pillar/panel color
)
```

## `content/naming.ron` — rare/unique name pools

One file, two word lists; rare and unique items draw `first + second`
("Vile Thorns") deterministically from the loot RNG:

```ron
NamingDef(
    first: ["Vile", "Grim", "Brine", ...],
    second: ["Thorns", "Maw", "Grasp", ...],
)
```

Empty pools fall back to the base name. Magic item names need no
authoring — they compose from the rolled affixes' `name` fields
(prefixes read like "Heavy", suffixes like "of the Wind").

## `content/tree/*.ron` — the passive tree

Files contribute nodes to one shared graph. Everyone (classless) starts at
the node with id `start`; links are undirected and may be declared on
either side.

```ron
TreeDef(
    nodes: [
        NodeDef(id: "start", num: 1, name: "Awakening", pos: (0, 0), kind: travel,
                links: ["s1", "v1"], grants: []),
        NodeDef(id: "v4", num: 33, name: "Oak Heart", pos: (0, 12), kind: notable,
                links: ["v3"],
                grants: [ (stat: life, layer: increased, value: 1200) ]),
        NodeDef(id: "socket_a", num: 2, name: "First Spark", pos: (2, 2),
                kind: socket_skill, links: ["start"], grants: []),
    ],
)
```

Node kinds: `travel` (small), `notable` (chunky), `keystone` (reserved for
more-multipliers/behavior flags), `socket` (holds one skill gem; supports
live on the gem). The `start` node is implicitly allocated and free — make
it a `socket` and every fresh character can run a skill gem from level 1. Characters get one point per level past 1; tree grants are affixes,
evaluated identically to gear.

`num` is the stable u16 reference compiled bots use in `build [...]`
declarations: unique, and **never reuse a number for a different node** —
deployed bots may still reference it.
