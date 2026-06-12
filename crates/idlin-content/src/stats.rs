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
    /// The STR bucket: increased physical damage with melee weapons only.
    MeleePhys,
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

pub const STAT_COUNT: usize = 34;

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
        Stat::MeleePhys,
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

/// One concrete grant. Tree nodes carry these with fixed values; item
/// affixes carry rolled values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub stat: Stat,
    pub layer: Layer,
    /// Added: flat units. Increased/More: basis points.
    pub value: i64,
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
}
