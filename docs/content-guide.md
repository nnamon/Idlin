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
    spawn_x_u: 30, spawn_y_u: 54,     // character spawn point
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
    damage_ele: 0, damage_chaos: 0,
    armour: 80, evasion: 0,
    accuracy: 0,              // 0 = derived: 60 + 15·level
    resist_ele: 2500,         // basis points (25%)
    resist_chaos: 0,
    speed_cps: 160,
    radius_cu: 80,            // body radius (collision)
    range_cu: 220,
    cooldown_ticks: 16,
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
    slot: weapon,             // weapon | helm | chest | boots
    w: 2, h: 3,               // bag footprint (the bag is 12×5)
    // weapon fields — the equipped weapon DEFINES the normal attack:
    damage_phys: 14, damage_ele: 0, damage_chaos: 0,
    range_cu: 220,
    cooldown_ticks: 8,
    projectile: false,
    // armour fields:
    armour: 0, evasion: 0,
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
damage_ele, damage_chaos, attack_speed, move_speed, armour, evasion,
accuracy, resist_ele, resist_chaos` (attributes convert per
[mechanics.md](mechanics.md)). The same vocabulary powers gear, tree nodes, and support
gems — one evaluator (see [mechanics.md](mechanics.md)).

## `content/gems/*.ron` — GemDef

```ron
GemDef(
    id: "cleave",
    name: "Cleave",
    kind: skill,              // skill | support
    weight: 100,
    // skill fields:
    coeff_bp: 11000,          // 110% of weapon damage (all types)
    added_phys: 0, added_ele: 0, added_chaos: 0,   // the gem's own damage
    shape: nova,              // target | nova
    projectile: false,
    range_cu: 0,              // 0 = weapon range
    radius_cu: 320,           // nova radius
    max_targets: 5,
    support_slots: 2,         // supports socket INTO the gem (PoE2-style)
    cooldown_ticks: 14,
)

GemDef(
    id: "heavier_blows",
    name: "Heavier Blows",
    kind: support,
    grants: [ (stat: damage_phys, layer: more, value: 2000) ],
)
```

Gems drop (12% of drops), live in a 12-slot pouch, gain XP from kills
(+4% effect per level, cap 20). A skill gem socketed in a `socket_skill`
tree node becomes UseSkill slot 1..N; support gems in **adjacent**
`socket_support` nodes modify that skill.

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
