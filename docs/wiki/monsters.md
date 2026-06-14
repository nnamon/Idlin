# Monsters

Generated from content/ — do not edit.

## bone_stalker

```
MonsterDef {
    id: "bone_stalker",
    name: "Bone Stalker",
    model: "stalker",
    brain: "hostile_melee",
    hostile: true,
    affix_pools: [
        "monster",
    ],
    unique: false,
    level: 2,
    life: 38,
    damage: 4,
    damage_fire: 0,
    damage_cold: 0,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 0,
    evasion: 40,
    accuracy: 0,
    resist_fire: 0,
    resist_cold: 0,
    resist_lightning: 0,
    resist_chaos: 0,
    speed_cps: 330,
    radius_cu: 40,
    range_cu: 750,
    use_ticks: 14,
    aggro_radius_cu: 1600,
    xp: 35,
    projectile: true,
    mana: 25,
    lines: [],
    skills: [
        MonsterSkillDef {
            gem: "heavy_swing",
            level: 3,
            supports: [],
        },
    ],
}
```

## drowned_shambler

```
MonsterDef {
    id: "drowned_shambler",
    name: "Drowned Shambler",
    model: "shambler",
    brain: "hostile_melee",
    hostile: true,
    affix_pools: [
        "monster",
    ],
    unique: false,
    level: 1,
    life: 45,
    damage: 3,
    damage_fire: 0,
    damage_cold: 0,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 20,
    evasion: 0,
    accuracy: 0,
    resist_fire: 0,
    resist_cold: 0,
    resist_lightning: 0,
    resist_chaos: 0,
    speed_cps: 250,
    radius_cu: 45,
    range_cu: 180,
    use_ticks: 12,
    aggro_radius_cu: 1400,
    xp: 25,
    projectile: false,
    mana: 0,
    lines: [],
    skills: [],
}
```

## grasping_drowned

```
MonsterDef {
    id: "grasping_drowned",
    name: "Grasping Drowned",
    model: "shambler",
    brain: "hostile_melee",
    hostile: true,
    affix_pools: [
        "monster",
    ],
    unique: false,
    level: 1,
    life: 16,
    damage: 2,
    damage_fire: 0,
    damage_cold: 0,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 0,
    evasion: 0,
    accuracy: 0,
    resist_fire: 0,
    resist_cold: 0,
    resist_lightning: 0,
    resist_chaos: 0,
    speed_cps: 300,
    radius_cu: 40,
    range_cu: 180,
    use_ticks: 8,
    aggro_radius_cu: 800,
    xp: 8,
    projectile: false,
    mana: 0,
    lines: [],
    skills: [],
}
```

## shoal_witch

```
MonsterDef {
    id: "shoal_witch",
    name: "Shoal Witch",
    model: "husk",
    brain: "hostile_melee",
    hostile: true,
    affix_pools: [
        "monster",
    ],
    unique: false,
    level: 4,
    life: 80,
    damage: 5,
    damage_fire: 0,
    damage_cold: 0,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 10,
    evasion: 0,
    accuracy: 0,
    resist_fire: 2000,
    resist_cold: 0,
    resist_lightning: 0,
    resist_chaos: 0,
    speed_cps: 240,
    radius_cu: 60,
    range_cu: 220,
    use_ticks: 16,
    aggro_radius_cu: 1500,
    xp: 90,
    projectile: false,
    mana: 60,
    lines: [],
    skills: [
        MonsterSkillDef {
            gem: "ember_bolt",
            level: 2,
            supports: [],
        },
    ],
}
```

## tide_husk

```
MonsterDef {
    id: "tide_husk",
    name: "Tide Husk",
    model: "husk",
    brain: "hostile_melee",
    hostile: true,
    affix_pools: [
        "monster",
    ],
    unique: false,
    level: 3,
    life: 90,
    damage: 6,
    damage_fire: 0,
    damage_cold: 0,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 80,
    evasion: 0,
    accuracy: 0,
    resist_fire: 0,
    resist_cold: 2500,
    resist_lightning: 0,
    resist_chaos: 0,
    speed_cps: 195,
    radius_cu: 80,
    range_cu: 220,
    use_ticks: 16,
    aggro_radius_cu: 1300,
    xp: 70,
    projectile: false,
    mana: 40,
    lines: [],
    skills: [
        MonsterSkillDef {
            gem: "arc",
            level: 2,
            supports: [],
        },
    ],
}
```

## tidewarden

```
MonsterDef {
    id: "tidewarden",
    name: "The Tidewarden",
    model: "tidewarden",
    brain: "hostile_melee",
    hostile: true,
    affix_pools: [
        "monster",
    ],
    unique: true,
    level: 8,
    life: 320,
    damage: 9,
    damage_fire: 0,
    damage_cold: 2,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 35,
    evasion: 20,
    accuracy: 0,
    resist_fire: 0,
    resist_cold: 4000,
    resist_lightning: 4000,
    resist_chaos: 0,
    speed_cps: 210,
    radius_cu: 70,
    range_cu: 200,
    use_ticks: 14,
    aggro_radius_cu: 1600,
    xp: 420,
    projectile: false,
    mana: 90,
    lines: [
        "THE TIDE KEEPS WHAT IT TAKES.",
        "You crawled OUT? Crawl back.",
        "Every wreck on this shore is mine.",
    ],
    skills: [
        MonsterSkillDef {
            gem: "arc",
            level: 3,
            supports: [],
        },
        MonsterSkillDef {
            gem: "frost_nova",
            level: 3,
            supports: [],
        },
        MonsterSkillDef {
            gem: "war_cry",
            level: 2,
            supports: [],
        },
    ],
}
```

## villager

```
MonsterDef {
    id: "villager",
    name: "Survivor",
    model: "idler",
    brain: "villager",
    hostile: false,
    affix_pools: [
        "monster",
    ],
    unique: false,
    level: 1,
    life: 50,
    damage: 0,
    damage_fire: 0,
    damage_cold: 0,
    damage_lightning: 0,
    damage_chaos: 0,
    armour: 0,
    evasion: 0,
    accuracy: 0,
    resist_fire: 0,
    resist_cold: 0,
    resist_lightning: 0,
    resist_chaos: 0,
    speed_cps: 160,
    radius_cu: 40,
    range_cu: 100,
    use_ticks: 20,
    aggro_radius_cu: 0,
    xp: 0,
    projectile: false,
    mana: 0,
    lines: [
        "Cold night again.",
        "You came up from the shore? Then you've seen it.",
        "The braziers stay lit. That's the rule.",
        "Tide took the old town. We keep this one.",
        "Mind the gate after dark.",
        "The smith trades fair. The innkeep less so.",
    ],
    skills: [],
}
```

