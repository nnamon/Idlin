//! The stat vocabulary shared by all power sources: item affixes, passive
//! tree nodes, and gems all describe themselves as grants of
//! `(stat, layer, value)`. The sim owns the evaluator; content owns the words.

use serde::{Deserialize, Serialize};

/// The stat registry. Content references these by snake_case name.
/// Declaration order is the index order (`idx` relies on it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stat {
    /// Attributes: granted by tree/gear, converted to derived bonuses
    /// (STR → life + melee phys%, DEX → accuracy + evasion%,
    /// INT → mana + energy shield%; see docs/mechanics.md).
    Strength,
    Dexterity,
    Intelligence,
    // -- pools --
    Life,
    Mana,
    EnergyShield,
    // -- recovery (Added: units per second; integer-divided per tick) --
    LifeRegen,
    ManaRegen,
    /// Basis points of damage dealt returned as life/mana (rate-capped).
    LeechLife,
    LeechMana,
    // -- damage by type --
    DamagePhys,
    DamageFire,
    DamageCold,
    DamageLightning,
    DamageChaos,
    // ("increased melee physical" is no longer a stat: STR grants damage_phys
    //  gated by Condition::WieldingWeaponClass(Melee) — see refresh_character_stats.)
    // -- speeds (factors, base 10000) --
    AttackSpeed,
    CastSpeed,
    MoveSpeed,
    // -- defenses --
    Armour,
    Evasion,
    Accuracy,
    /// Basis points chance to negate a hit entirely (needs a shield).
    Block,
    // -- crit --
    /// Basis points; skills supply their own base, this scales it.
    CritChance,
    /// Basis points of bonus damage on crit (base 5000 = +50%).
    CritMulti,
    // -- resistances (basis points, capped at use) --
    ResistFire,
    ResistCold,
    ResistLightning,
    ResistChaos,
    // -- find (factors, base 10000; the KILLER's values drive drops) --
    /// Scales the magic/rare/unique weights of the rarity roll.
    ItemRarity,
    /// Scales how many drop rolls a kill makes.
    ItemQuantity,
    // -- hit reactions (see mechanics.md "Stun, freeze, knockback") --
    /// Attacker: basis points easier to stun (shifts the victim's bar).
    Stagger,
    /// Defender: basis points harder to stun / shorter stuns.
    Poise,
    /// Attacker: flat knockback in centi-units added to every hit.
    Knockback,
}

pub const STAT_COUNT: usize = 33;

impl Stat {
    pub const ALL: [Stat; STAT_COUNT] = [
        Stat::Strength,
        Stat::Dexterity,
        Stat::Intelligence,
        Stat::Life,
        Stat::Mana,
        Stat::EnergyShield,
        Stat::LifeRegen,
        Stat::ManaRegen,
        Stat::LeechLife,
        Stat::LeechMana,
        Stat::DamagePhys,
        Stat::DamageFire,
        Stat::DamageCold,
        Stat::DamageLightning,
        Stat::DamageChaos,
        Stat::AttackSpeed,
        Stat::CastSpeed,
        Stat::MoveSpeed,
        Stat::Armour,
        Stat::Evasion,
        Stat::Accuracy,
        Stat::Block,
        Stat::CritChance,
        Stat::CritMulti,
        Stat::ResistFire,
        Stat::ResistCold,
        Stat::ResistLightning,
        Stat::ResistChaos,
        Stat::ItemRarity,
        Stat::ItemQuantity,
        Stat::Stagger,
        Stat::Poise,
        Stat::Knockback,
    ];

    pub fn idx(self) -> usize {
        self as usize
    }

    /// Bot/player-facing vocabulary (#87): the stable snake_case key (matches the
    /// serialized form used by `effects[].stat`), a display name, a one-line
    /// meaning, and the unit an `Added`-layer value is expressed in. Increased /
    /// More layers are ALWAYS basis-point percentages regardless of `added_unit`.
    /// Surfaced in content-docs so a reader knows what e.g. `leech_life` does.
    pub fn doc(self) -> StatDoc {
        // (key, name, description, added_unit)
        let (key, name, desc, added_unit) = match self {
            Stat::Strength => (
                "strength",
                "Strength",
                "Attribute: grants Life and — while wielding a melee weapon — increased physical damage.",
                AddedUnit::Flat,
            ),
            Stat::Dexterity => (
                "dexterity",
                "Dexterity",
                "Attribute: grants Accuracy and increased Evasion.",
                AddedUnit::Flat,
            ),
            Stat::Intelligence => (
                "intelligence",
                "Intelligence",
                "Attribute: grants Mana and increased Energy Shield.",
                AddedUnit::Flat,
            ),
            Stat::Life => (
                "life",
                "Life",
                "Maximum life; reaching 0 is death.",
                AddedUnit::Flat,
            ),
            Stat::Mana => (
                "mana",
                "Mana",
                "Maximum mana; skills draw on it and running dry blocks casting.",
                AddedUnit::Flat,
            ),
            Stat::EnergyShield => (
                "energy_shield",
                "Energy Shield",
                "A buffer depleted before life; recharges after a delay untouched.",
                AddedUnit::Flat,
            ),
            Stat::LifeRegen => (
                "life_regen",
                "Life Regeneration",
                "Life recovered per second (integer-divided per tick).",
                AddedUnit::PerSecond,
            ),
            Stat::ManaRegen => (
                "mana_regen",
                "Mana Regeneration",
                "Mana recovered per second (integer-divided per tick).",
                AddedUnit::PerSecond,
            ),
            Stat::LeechLife => (
                "leech_life",
                "Life Leech",
                "Damage dealt recovered as life, rate-capped.",
                AddedUnit::BasisPoints,
            ),
            Stat::LeechMana => (
                "leech_mana",
                "Mana Leech",
                "Damage dealt recovered as mana, rate-capped.",
                AddedUnit::BasisPoints,
            ),
            Stat::DamagePhys => (
                "damage_phys",
                "Physical Damage",
                "Physical hit damage.",
                AddedUnit::Flat,
            ),
            Stat::DamageFire => (
                "damage_fire",
                "Fire Damage",
                "Fire hit damage.",
                AddedUnit::Flat,
            ),
            Stat::DamageCold => (
                "damage_cold",
                "Cold Damage",
                "Cold hit damage.",
                AddedUnit::Flat,
            ),
            Stat::DamageLightning => (
                "damage_lightning",
                "Lightning Damage",
                "Lightning hit damage.",
                AddedUnit::Flat,
            ),
            Stat::DamageChaos => (
                "damage_chaos",
                "Chaos Damage",
                "Chaos hit damage (ignores armour and elemental resists).",
                AddedUnit::Flat,
            ),
            Stat::AttackSpeed => (
                "attack_speed",
                "Attack Speed",
                "Factor on attack rate (base 10000; higher is faster).",
                AddedUnit::Factor,
            ),
            Stat::CastSpeed => (
                "cast_speed",
                "Cast Speed",
                "Factor on cast rate (base 10000; higher is faster).",
                AddedUnit::Factor,
            ),
            Stat::MoveSpeed => (
                "move_speed",
                "Movement Speed",
                "Factor on movement rate (base 10000; higher is faster).",
                AddedUnit::Factor,
            ),
            Stat::Armour => (
                "armour",
                "Armour",
                "Attenuates incoming physical damage.",
                AddedUnit::Flat,
            ),
            Stat::Evasion => (
                "evasion",
                "Evasion",
                "Chance for incoming hits to miss.",
                AddedUnit::Flat,
            ),
            Stat::Accuracy => (
                "accuracy",
                "Accuracy",
                "Improves the chance your attacks land against evasion.",
                AddedUnit::Flat,
            ),
            Stat::Block => (
                "block",
                "Block",
                "Chance to negate an incoming hit entirely (needs a shield).",
                AddedUnit::BasisPoints,
            ),
            Stat::CritChance => (
                "crit_chance",
                "Critical Strike Chance",
                "Scales a skill's base critical-strike chance.",
                AddedUnit::BasisPoints,
            ),
            Stat::CritMulti => (
                "crit_multi",
                "Critical Strike Multiplier",
                "Bonus damage on a critical strike (base 5000 = +50%).",
                AddedUnit::BasisPoints,
            ),
            Stat::ResistFire => (
                "resist_fire",
                "Fire Resistance",
                "Fire damage mitigated (capped at use).",
                AddedUnit::BasisPoints,
            ),
            Stat::ResistCold => (
                "resist_cold",
                "Cold Resistance",
                "Cold damage mitigated (capped at use).",
                AddedUnit::BasisPoints,
            ),
            Stat::ResistLightning => (
                "resist_lightning",
                "Lightning Resistance",
                "Lightning damage mitigated (capped at use).",
                AddedUnit::BasisPoints,
            ),
            Stat::ResistChaos => (
                "resist_chaos",
                "Chaos Resistance",
                "Chaos damage mitigated (capped at use).",
                AddedUnit::BasisPoints,
            ),
            Stat::ItemRarity => (
                "item_rarity",
                "Item Rarity",
                "Factor scaling drop-rarity weights on your kills (base 10000).",
                AddedUnit::Factor,
            ),
            Stat::ItemQuantity => (
                "item_quantity",
                "Item Quantity",
                "Factor scaling how many drop rolls your kills make (base 10000).",
                AddedUnit::Factor,
            ),
            Stat::Stagger => (
                "stagger",
                "Stagger",
                "Makes your hits stun more easily (shifts the victim's stun bar).",
                AddedUnit::BasisPoints,
            ),
            Stat::Poise => (
                "poise",
                "Poise",
                "Makes you harder to stun and shortens stuns against you.",
                AddedUnit::BasisPoints,
            ),
            Stat::Knockback => (
                "knockback",
                "Knockback",
                "Flat knockback (centi-units) added to your hits.",
                AddedUnit::CentiUnits,
            ),
        };
        StatDoc {
            key,
            name,
            desc,
            added_unit,
        }
    }
}

/// The unit an `Added`-layer grant for a stat is measured in (Increased / More
/// are always basis-point percentages, so they don't vary by stat).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AddedUnit {
    /// Whole units (life, attributes, flat damage).
    Flat,
    /// Basis points (10000 = 100%) — leech, resists, block, crit.
    BasisPoints,
    /// Whole units per second (regen).
    PerSecond,
    /// A factor in basis points, base 10000 (speeds, find).
    Factor,
    /// Centi-units of distance (knockback).
    CentiUnits,
}

impl AddedUnit {
    /// Stable token for content-docs / display.
    pub fn key(self) -> &'static str {
        match self {
            AddedUnit::Flat => "flat",
            AddedUnit::BasisPoints => "basis_points",
            AddedUnit::PerSecond => "per_second",
            AddedUnit::Factor => "factor_bp",
            AddedUnit::CentiUnits => "centi_units",
        }
    }
}

/// Bot/player-facing vocabulary for one `Stat` (#87).
#[derive(Debug, Clone, Copy)]
pub struct StatDoc {
    pub key: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    pub added_unit: AddedUnit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Layer {
    Added,
    Increased,
    More,
}

/// Weapon families. A skill gates on them (gem `weapon_classes`); a condition
/// can read the wielded class (`Condition::WieldingWeaponClass`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WeaponClass {
    Melee,
    Bow,
    Wand,
}

/// A predicate gating an affix effect (#86), read from HASHED STATE ONLY so it
/// stays deterministic (no floats / wall-clock). The sim evaluates it against an
/// `EvalContext` at the point the effect folds in. `None` on an effect = always.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    /// While the wielded weapon is this class. Unarmed (no weapon) counts as
    /// Melee — fists are melee attacks (subsumes the legacy MeleePhys rule).
    WieldingWeaponClass(WeaponClass),
}

/// The hashed-state facts a `Condition` reads, built by the sim per entity at
/// fold time. Pure data so the predicate (`Condition::holds`) stays in content
/// and deterministic. Grows as new conditions land (life %, target ailments, …).
#[derive(Debug, Clone, Copy, Default)]
pub struct EvalContext {
    /// The wielded weapon's class; `None` = unarmed (counts as melee).
    pub weapon_class: Option<WeaponClass>,
}

impl Condition {
    /// Does this condition hold in `ctx`? Pure + integer — deterministic.
    pub fn holds(&self, ctx: &EvalContext) -> bool {
        match self {
            // Unarmed (fists) satisfies a Melee gate; other classes need an exact
            // match. Equivalent to the legacy `!projectile` rule for current
            // content (bow/wand are projectile; melee + unarmed are not).
            Condition::WieldingWeaponClass(WeaponClass::Melee) => {
                matches!(ctx.weapon_class, Some(WeaponClass::Melee) | None)
            }
            Condition::WieldingWeaponClass(want) => ctx.weapon_class == Some(*want),
        }
    }
}

/// One concrete grant — the SINGLE power-source unit (#86): item affixes (rolled
/// value), tree nodes, and gem buffs all produce these, and each may carry a
/// `condition`. The fold sites evaluate `condition` against an `EvalContext`
/// before applying, so one path covers every source. `None` = unconditional.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub stat: Stat,
    pub layer: Layer,
    /// Added: flat units. Increased/More: basis points.
    pub value: i64,
    #[serde(default)]
    pub condition: Option<Condition>,
}

impl Grant {
    /// An unconditional grant (the common case — attribute conversions, fixed
    /// engine bonuses). Conditional grants set `condition` directly.
    pub fn new(stat: Stat, layer: Layer, value: i64) -> Grant {
        Grant {
            stat,
            layer,
            value,
            condition: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_order_matches_discriminants() {
        for (i, s) in Stat::ALL.iter().enumerate() {
            assert_eq!(s.idx(), i, "{s:?} out of order");
        }
    }

    #[test]
    fn wielding_weapon_class_condition_treats_unarmed_as_melee() {
        use Condition::WieldingWeaponClass as W;
        // Melee gate: a melee weapon OR unarmed (fists) — the legacy MeleePhys rule.
        let melee = EvalContext {
            weapon_class: Some(WeaponClass::Melee),
        };
        let unarmed = EvalContext { weapon_class: None };
        let bow = EvalContext {
            weapon_class: Some(WeaponClass::Bow),
        };
        assert!(W(WeaponClass::Melee).holds(&melee));
        assert!(
            W(WeaponClass::Melee).holds(&unarmed),
            "fists count as melee"
        );
        assert!(!W(WeaponClass::Melee).holds(&bow));
        // Other classes need an exact match — unarmed does NOT satisfy them.
        assert!(W(WeaponClass::Bow).holds(&bow));
        assert!(!W(WeaponClass::Bow).holds(&unarmed));
        assert!(!W(WeaponClass::Bow).holds(&melee));
    }

    #[test]
    fn condition_round_trips_through_ron() {
        let c: Condition = ron::from_str("wielding_weapon_class(bow)").unwrap();
        assert_eq!(c, Condition::WieldingWeaponClass(WeaponClass::Bow));
    }
}
