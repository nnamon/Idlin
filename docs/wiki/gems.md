# Gems

Generated from content/ — do not edit.

## added_embers

```
GemDef {
    id: "added_embers",
    name: "Added Embers",
    kind: Support,
    weight: 80,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Attack,
        Spell,
    ],
    effects: [
        AddedDamage {
            dtype: Fire,
            amount: Formula {
                base: 4,
                per_level: 2,
            },
        },
        ManaMult {
            bp: 1000,
        },
    ],
    grants: [],
}
```

## arc

```
GemDef {
    id: "arc",
    name: "Arc",
    kind: Skill,
    weight: 70,
    skill_kind: Spell,
    target_mode: Direction,
    tags: [
        Spell,
        Lightning,
    ],
    shape: Line,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 8,
        per_level: 4,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 800,
    mana_cost: Formula {
        base: 7,
        per_level: 1,
    },
    cast_ticks: 7,
    cooldown_ticks: 0,
    range_cu: 800,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 130,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 5,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## cleave

```
GemDef {
    id: "cleave",
    name: "Cleave",
    kind: Skill,
    weight: 100,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [
        Attack,
        Melee,
        Aoe,
        Physical,
    ],
    shape: Nova,
    coeff_bp: 11000,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 500,
    mana_cost: Formula {
        base: 4,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 320,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 5,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [
        Melee,
    ],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## ember_bolt

```
GemDef {
    id: "ember_bolt",
    name: "Ember Bolt",
    kind: Skill,
    weight: 60,
    skill_kind: Spell,
    target_mode: Entity,
    tags: [
        Spell,
        Projectile,
        Fire,
    ],
    shape: Projectile,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 9,
        per_level: 3,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 600,
    mana_cost: Formula {
        base: 6,
        per_level: 1,
    },
    cast_ticks: 7,
    cooldown_ticks: 0,
    range_cu: 900,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 1500,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## frost_nova

```
GemDef {
    id: "frost_nova",
    name: "Frost Nova",
    kind: Skill,
    weight: 70,
    skill_kind: Spell,
    target_mode: Entity,
    tags: [
        Spell,
        Cold,
        Aoe,
    ],
    shape: Nova,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 7,
        per_level: 3,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 600,
    mana_cost: Formula {
        base: 8,
        per_level: 1,
    },
    cast_ticks: 8,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 380,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 6,
    dot: None,
    buff: None,
    debuff: Some(
        BuffDef {
            grants: [
                Grant {
                    stat: MoveSpeed,
                    layer: Increased,
                    value: -2500,
                },
                Grant {
                    stat: AttackSpeed,
                    layer: Increased,
                    value: -2500,
                },
            ],
            duration_ticks: 30,
        },
    ),
    weapon_classes: [],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## heavier_blows

```
GemDef {
    id: "heavier_blows",
    name: "Heavier Blows",
    kind: Support,
    weight: 80,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Melee,
    ],
    effects: [
        MoreDamage {
            dtype: Some(
                Phys,
            ),
            bp: 2000,
        },
        ManaMult {
            bp: 1000,
        },
    ],
    grants: [],
}
```

## heavy_swing

```
GemDef {
    id: "heavy_swing",
    name: "Heavy Swing",
    kind: Skill,
    weight: 100,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [
        Attack,
        Melee,
        Physical,
    ],
    shape: Target,
    coeff_bp: 14500,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 600,
    mana_cost: Formula {
        base: 5,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [
        Melee,
    ],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## lingering

```
GemDef {
    id: "lingering",
    name: "Lingering",
    kind: Support,
    weight: 60,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Duration,
    ],
    effects: [
        DotDurationInc {
            bp: 4000,
        },
        ManaMult {
            bp: 1000,
        },
    ],
    grants: [],
}
```

## plague_cloud

```
GemDef {
    id: "plague_cloud",
    name: "Plague Cloud",
    kind: Skill,
    weight: 60,
    skill_kind: Spell,
    target_mode: Point,
    tags: [
        Spell,
        Chaos,
        Aoe,
        Duration,
    ],
    shape: PointAoe,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 2,
        per_level: 1,
    },
    crit_bp: 500,
    mana_cost: Formula {
        base: 10,
        per_level: 1,
    },
    cast_ticks: 10,
    cooldown_ticks: 0,
    range_cu: 700,
    radius_cu: 300,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 6,
    dot: Some(
        DotDef {
            dtype: Chaos,
            per_second: Formula {
                base: 6,
                per_level: 2,
            },
            duration_ticks: 50,
        },
    ),
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## power_shot

```
GemDef {
    id: "power_shot",
    name: "Power Shot",
    kind: Skill,
    weight: 80,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [
        Attack,
        Projectile,
        Physical,
    ],
    shape: Projectile,
    coeff_bp: 17000,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 700,
    mana_cost: Formula {
        base: 5,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 22,
    range_cu: 1100,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 1800,
    pierce: 1,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [
        Bow,
    ],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## quickening

```
GemDef {
    id: "quickening",
    name: "Quickening",
    kind: Support,
    weight: 70,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Attack,
    ],
    effects: [
        IncAttackSpeed {
            bp: 2000,
        },
    ],
    grants: [],
}
```

## split_quiver

```
GemDef {
    id: "split_quiver",
    name: "Split Quiver",
    kind: Support,
    weight: 60,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Projectile,
    ],
    effects: [
        ExtraProjectiles {
            count: 2,
        },
        MoreDamage {
            dtype: None,
            bp: -2500,
        },
        ManaMult {
            bp: 3000,
        },
    ],
    grants: [],
}
```

## swift_casting

```
GemDef {
    id: "swift_casting",
    name: "Swift Casting",
    kind: Support,
    weight: 70,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Spell,
    ],
    effects: [
        IncCastSpeed {
            bp: 2000,
        },
        ManaMult {
            bp: 500,
        },
    ],
    grants: [],
}
```

## war_cry

```
GemDef {
    id: "war_cry",
    name: "War Cry",
    kind: Skill,
    weight: 60,
    skill_kind: Spell,
    target_mode: Direction,
    tags: [
        Aoe,
        Duration,
    ],
    shape: Nova,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 12,
        per_level: 0,
    },
    cast_ticks: 6,
    cooldown_ticks: 80,
    range_cu: 0,
    radius_cu: 500,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: Some(
        BuffDef {
            grants: [
                Grant {
                    stat: DamagePhys,
                    layer: Increased,
                    value: 2500,
                },
            ],
            duration_ticks: 100,
        },
    ),
    debuff: None,
    weapon_classes: [],
    requires_tags: [],
    effects: [],
    grants: [],
}
```

## widening

```
GemDef {
    id: "widening",
    name: "Widening",
    kind: Support,
    weight: 60,
    skill_kind: Attack,
    target_mode: Entity,
    tags: [],
    shape: Target,
    coeff_bp: 0,
    added_phys: Formula {
        base: 0,
        per_level: 0,
    },
    added_fire: Formula {
        base: 0,
        per_level: 0,
    },
    added_cold: Formula {
        base: 0,
        per_level: 0,
    },
    added_lightning: Formula {
        base: 0,
        per_level: 0,
    },
    added_chaos: Formula {
        base: 0,
        per_level: 0,
    },
    crit_bp: 0,
    mana_cost: Formula {
        base: 0,
        per_level: 0,
    },
    cast_ticks: 0,
    cooldown_ticks: 0,
    range_cu: 0,
    radius_cu: 0,
    cone_cos_bp: 7000,
    width_cu: 0,
    proj_speed_cps: 0,
    pierce: 0,
    max_targets: 1,
    dot: None,
    buff: None,
    debuff: None,
    weapon_classes: [],
    requires_tags: [
        Aoe,
    ],
    effects: [
        AoeInc {
            bp: 3000,
        },
        ManaMult {
            bp: 1500,
        },
    ],
    grants: [],
}
```

