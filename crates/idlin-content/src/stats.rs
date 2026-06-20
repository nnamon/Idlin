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
