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
    gen_rocks: 16,                    // area generation: non-walkable obstacles placed
    gen_trees: 9,                     //   with the zone (block movement AND line of sight)
    packs: [
        SpawnPack(monster: "drowned_shambler", count: 4,
                  x_u: 14, y_u: 16,   // pack anchor
                  radius_u: 5,        // spawn jitter
                  respawn_ticks: 150),
    ],
)
```

Packs respawn as a group `respawn_ticks` after first loss once wiped low.

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

Affixes are single-stat grants with item-level-gated tiers. Rarity sets the
roll count: magic 1–2, rare 3–5, unique 4–5.

```ron
AffixDef(
    id: "heavy",
    name: "Heavy",            // prefixes prepend, suffixes append
    kind: prefix,             // prefix | suffix
    slots: [weapon],          // where it can appear
    weight: 100,
    stat: damage_phys,        // see stat registry below
    layer: increased,         // added | increased | more
    tiers: [
        (ilvl: 1, min: 800, max: 1500),   // value rolled in min..=max
        (ilvl: 3, min: 1600, max: 2500),  // highest eligible tier is used
    ],
)
```

**Stat registry**: `strength, dexterity, intelligence, life, damage_phys,
damage_fire, damage_cold, damage_lightning, damage_chaos, melee_phys,
mana, energy_shield, life_regen, mana_regen, leech_life, leech_mana,
attack_speed, cast_speed, move_speed, armour, evasion, accuracy, block,
crit_chance, crit_multi, resist_fire, resist_cold, resist_lightning,
resist_chaos` (attributes convert per
[mechanics.md](mechanics.md)). The same vocabulary powers gear, tree nodes, and support
gems — one evaluator (see [mechanics.md](mechanics.md)).

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
    mana_cost: (base: 6, per_level: 1), // Formula
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
        mana_mult(bp: 3000),            // 130% mana cost
    ],
    // effects vocabulary: more_damage(dtype: Option, bp) ·
    // added_damage(dtype, amount: Formula — at the SUPPORT's level) ·
    // inc_attack_speed(bp) · inc_cast_speed(bp) · extra_projectiles(count) ·
    // pierce(count) · aoe_inc(bp) · dot_duration_inc(bp) · mana_mult(bp)
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
