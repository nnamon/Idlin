//! The stat vocabulary shared by all power sources: item affixes, passive
//! tree nodes, and (later) gems all describe themselves as grants of
//! `(stat, layer, value)`. The sim owns the evaluator; content owns the words.

use serde::{Deserialize, Serialize};

/// The stat registry. Content references these by snake_case name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stat {
    /// Attributes: granted by tree/gear, converted to derived bonuses
    /// (see docs/mechanics.md).
    Strength,
    Dexterity,
    Intelligence,
    Life,
    DamagePhys,
    DamageEle,
    DamageChaos,
    /// Factor on attack rate (base 10000); higher = faster attacks.
    AttackSpeed,
    /// Factor on movement (base 10000).
    MoveSpeed,
    Armour,
    Evasion,
    Accuracy,
    /// Basis points of elemental resistance (capped at use).
    ResistEle,
    /// Basis points of chaos resistance (capped at use).
    ResistChaos,
}

pub const STAT_COUNT: usize = 14;

impl Stat {
    pub const ALL: [Stat; STAT_COUNT] = [
        Stat::Strength,
        Stat::Dexterity,
        Stat::Intelligence,
        Stat::Life,
        Stat::DamagePhys,
        Stat::DamageEle,
        Stat::DamageChaos,
        Stat::AttackSpeed,
        Stat::MoveSpeed,
        Stat::Armour,
        Stat::Evasion,
        Stat::Accuracy,
        Stat::ResistEle,
        Stat::ResistChaos,
    ];

    pub fn idx(self) -> usize {
        Stat::ALL
            .iter()
            .position(|&s| s == self)
            .expect("stat in registry")
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
