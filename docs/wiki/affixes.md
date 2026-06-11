# Affixes by pool

Generated from content/ — do not edit.

## pool `arcana`

Subscribed bases: brine_helm, kelp_vest

### arcane

```
AffixDef {
    id: "arcane",
    name: "Arcane",
    kind: Prefix,
    pool: "arcana",
    weight: 70,
    stat: Mana,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 6,
            max: 12,
        },
        AffixTier {
            ilvl: 3,
            min: 13,
            max: 22,
        },
        AffixTier {
            ilvl: 6,
            min: 23,
            max: 36,
        },
    ],
}
```

## pool `armour`

Subscribed bases: brine_helm, kelp_vest, wader_boots

### hale

```
AffixDef {
    id: "hale",
    name: "Hale",
    kind: Prefix,
    pool: "armour",
    weight: 100,
    stat: Life,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 8,
            max: 15,
        },
        AffixTier {
            ilvl: 3,
            min: 16,
            max: 28,
        },
        AffixTier {
            ilvl: 6,
            min: 29,
            max: 45,
        },
    ],
}
```

### of_iron

```
AffixDef {
    id: "of_iron",
    name: "of Iron",
    kind: Suffix,
    pool: "armour",
    weight: 90,
    stat: Armour,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 15,
            max: 30,
        },
        AffixTier {
            ilvl: 4,
            min: 31,
            max: 60,
        },
    ],
}
```

### of_storms

```
AffixDef {
    id: "of_storms",
    name: "of Storms",
    kind: Suffix,
    pool: "armour",
    weight: 80,
    stat: ResistLightning,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 500,
            max: 900,
        },
        AffixTier {
            ilvl: 3,
            min: 901,
            max: 1500,
        },
        AffixTier {
            ilvl: 6,
            min: 1501,
            max: 2400,
        },
    ],
}
```

### of_the_depths

```
AffixDef {
    id: "of_the_depths",
    name: "of the Depths",
    kind: Suffix,
    pool: "armour",
    weight: 80,
    stat: ResistCold,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 500,
            max: 900,
        },
        AffixTier {
            ilvl: 3,
            min: 901,
            max: 1500,
        },
        AffixTier {
            ilvl: 6,
            min: 1501,
            max: 2400,
        },
    ],
}
```

### of_warding

```
AffixDef {
    id: "of_warding",
    name: "of Warding",
    kind: Suffix,
    pool: "armour",
    weight: 80,
    stat: ResistFire,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 500,
            max: 1200,
        },
        AffixTier {
            ilvl: 4,
            min: 1300,
            max: 2200,
        },
    ],
}
```

### of_wind

```
AffixDef {
    id: "of_wind",
    name: "of the Wind",
    kind: Suffix,
    pool: "armour",
    weight: 90,
    stat: Evasion,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 12,
            max: 25,
        },
        AffixTier {
            ilvl: 4,
            min: 26,
            max: 50,
        },
    ],
}
```

### shimmering

```
AffixDef {
    id: "shimmering",
    name: "Shimmering",
    kind: Prefix,
    pool: "armour",
    weight: 70,
    stat: EnergyShield,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 5,
            max: 10,
        },
        AffixTier {
            ilvl: 3,
            min: 11,
            max: 19,
        },
        AffixTier {
            ilvl: 6,
            min: 20,
            max: 32,
        },
    ],
}
```

## pool `find`

Subscribed bases: brine_helm, driftwood_buckler, wader_boots

### of_hoarding

```
AffixDef {
    id: "of_hoarding",
    name: "of Hoarding",
    kind: Suffix,
    pool: "find",
    weight: 35,
    stat: ItemQuantity,
    layer: Increased,
    tiers: [
        AffixTier {
            ilvl: 2,
            min: 400,
            max: 800,
        },
        AffixTier {
            ilvl: 6,
            min: 900,
            max: 1500,
        },
    ],
}
```

### of_plunder

```
AffixDef {
    id: "of_plunder",
    name: "of Plunder",
    kind: Suffix,
    pool: "find",
    weight: 50,
    stat: ItemRarity,
    layer: Increased,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 800,
            max: 1500,
        },
        AffixTier {
            ilvl: 4,
            min: 1600,
            max: 2500,
        },
    ],
}
```

## pool `stride`

Subscribed bases: wader_boots

### of_the_hare

```
AffixDef {
    id: "of_the_hare",
    name: "of the Hare",
    kind: Suffix,
    pool: "stride",
    weight: 70,
    stat: MoveSpeed,
    layer: Increased,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 500,
            max: 900,
        },
        AffixTier {
            ilvl: 4,
            min: 1000,
            max: 1500,
        },
    ],
}
```

## pool `weapon`

Subscribed bases: barnacle_wand, driftwood_bow, rusted_cleaver

### heavy

```
AffixDef {
    id: "heavy",
    name: "Heavy",
    kind: Prefix,
    pool: "weapon",
    weight: 100,
    stat: DamagePhys,
    layer: Increased,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 800,
            max: 1500,
        },
        AffixTier {
            ilvl: 3,
            min: 1600,
            max: 2500,
        },
        AffixTier {
            ilvl: 6,
            min: 2600,
            max: 4000,
        },
    ],
}
```

### honed

```
AffixDef {
    id: "honed",
    name: "Honed",
    kind: Prefix,
    pool: "weapon",
    weight: 100,
    stat: DamagePhys,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 2,
            max: 4,
        },
        AffixTier {
            ilvl: 3,
            min: 5,
            max: 8,
        },
        AffixTier {
            ilvl: 6,
            min: 9,
            max: 14,
        },
    ],
}
```

### keen

```
AffixDef {
    id: "keen",
    name: "Keen",
    kind: Prefix,
    pool: "weapon",
    weight: 70,
    stat: Accuracy,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 15,
            max: 30,
        },
        AffixTier {
            ilvl: 4,
            min: 31,
            max: 60,
        },
    ],
}
```

### of_embers

```
AffixDef {
    id: "of_embers",
    name: "of Embers",
    kind: Suffix,
    pool: "weapon",
    weight: 80,
    stat: DamageFire,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 2,
            max: 5,
        },
        AffixTier {
            ilvl: 4,
            min: 6,
            max: 11,
        },
    ],
}
```

### of_precision

```
AffixDef {
    id: "of_precision",
    name: "of Precision",
    kind: Suffix,
    pool: "weapon",
    weight: 60,
    stat: CritChance,
    layer: Increased,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 1000,
            max: 1800,
        },
        AffixTier {
            ilvl: 4,
            min: 1801,
            max: 3000,
        },
    ],
}
```

### of_venom

```
AffixDef {
    id: "of_venom",
    name: "of Venom",
    kind: Suffix,
    pool: "weapon",
    weight: 50,
    stat: DamageChaos,
    layer: Added,
    tiers: [
        AffixTier {
            ilvl: 2,
            min: 2,
            max: 4,
        },
        AffixTier {
            ilvl: 5,
            min: 5,
            max: 9,
        },
    ],
}
```

### swift

```
AffixDef {
    id: "swift",
    name: "Swift",
    kind: Prefix,
    pool: "weapon",
    weight: 70,
    stat: AttackSpeed,
    layer: Increased,
    tiers: [
        AffixTier {
            ilvl: 1,
            min: 500,
            max: 900,
        },
        AffixTier {
            ilvl: 4,
            min: 1000,
            max: 1600,
        },
    ],
}
```

