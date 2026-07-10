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
    // -- ailments (#88): attacker-side proc + magnitude levers --
    // Per-element inflict chance — NO blanket "all ailments" stat: scaling every
    // ailment from one lever is too strong, so each element carries its own chance
    // and an "all-elemental" affix must be COMPOSED of these three effects.
    /// Attacker: basis-point chance for a FIRE hit to Ignite. Crits inflict
    /// regardless (unless CritAilmentDenied); this roll is independent of crit.
    IgniteChance,
    /// Attacker: basis-point chance for a LIGHTNING hit to Shock. Crits inflict
    /// regardless (unless CritAilmentDenied); this roll is independent of crit.
    ShockChance,
    /// Attacker: basis-point chance for a COLD hit to Chill. Crits inflict
    /// regardless (unless CritAilmentDenied); this roll is independent of crit.
    ChillChance,
    /// Attacker flag (Added sum > 0 ⇒ true): critical strikes cannot cause
    /// ailments — drops the guaranteed crit-inflict; the chance roll still applies.
    CritAilmentDenied,
    /// Attacker: basis-point cap on the Shock magnitude you inflict (the default
    /// cap is raised by the Added layer). Shock = % increased damage the victim takes.
    ShockMax,
    /// Attacker: basis-point cap on the Chill magnitude you inflict (the default
    /// cap is raised by the Added layer). Chill = % the victim's actions are slowed.
    ChillMax,
    /// Attacker: basis points scaling the duration of ailments you inflict (Ignite
    /// spreads a fixed total over the duration, so a shorter duration burns faster).
    AilmentDuration,
    /// MAP RULE (#148 A4): basis points of extra monster damage inside the
    /// map run this item opens. Read only by the Map Table; inert worn.
    MonsterFury,
    /// MAP RULE (#148 A4): the map's time limit in ticks — the clock
    /// takes the strand back and ferries everyone home when it expires.
    MapClock,
    /// MAP RULE (#148 A4): nonzero = the map's far end holds a TIER
    /// BOSS. Rolls only on deep maps.
    SovereignsMark,
    /// Basis points of increased SPELL damage (quality pass): the caster's
    /// gear curve. Spells never read weapon damage — a wand's implicit
    /// spell-damage grant is how the wand ladder finally feeds the kit.
    SpellDamage,
}

pub const STAT_COUNT: usize = 44;

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
        Stat::IgniteChance,
        Stat::ShockChance,
        Stat::ChillChance,
        Stat::CritAilmentDenied,
        Stat::ShockMax,
        Stat::ChillMax,
        Stat::AilmentDuration,
        Stat::MonsterFury,
        Stat::MapClock,
        Stat::SovereignsMark,
        Stat::SpellDamage,
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
            Stat::IgniteChance => (
                "ignite_chance",
                "Ignite Chance",
                "Chance for your fire hits to Ignite; crits inflict regardless.",
                AddedUnit::BasisPoints,
            ),
            Stat::ShockChance => (
                "shock_chance",
                "Shock Chance",
                "Chance for your lightning hits to Shock; crits inflict regardless.",
                AddedUnit::BasisPoints,
            ),
            Stat::ChillChance => (
                "chill_chance",
                "Chill Chance",
                "Chance for your cold hits to Chill; crits inflict regardless.",
                AddedUnit::BasisPoints,
            ),
            Stat::CritAilmentDenied => (
                "crit_ailment_denied",
                "Critical Strikes Cannot Cause Ailments",
                "Flag: your critical strikes no longer auto-inflict ailments (the ailment-chance roll still applies).",
                AddedUnit::Flat,
            ),
            Stat::ShockMax => (
                "shock_max",
                "Maximum Shock Effect",
                "Raises the cap on the increased-damage-taken your Shock inflicts.",
                AddedUnit::BasisPoints,
            ),
            Stat::ChillMax => (
                "chill_max",
                "Maximum Chill Effect",
                "Raises the cap on the action slow your Chill inflicts.",
                AddedUnit::BasisPoints,
            ),
            Stat::MonsterFury => (
                "monster_fury",
                "Monster Fury",
                "Map rule: monsters in the map deal this much more damage (basis points).",
                AddedUnit::Factor,
            ),
            Stat::MapClock => (
                "map_clock",
                "Map Clock",
                "Map rule: the map closes after this many ticks — beat the clock.",
                AddedUnit::Flat,
            ),
            Stat::SpellDamage => (
                "spell_damage",
                "Spell Damage",
                "Increased spell damage (basis points) — wand implicits and caster gear.",
                AddedUnit::Factor,
            ),
            Stat::SovereignsMark => (
                "sovereigns_mark",
                "Sovereign's Mark",
                "Map rule: the map’s far end holds a tier boss.",
                AddedUnit::Flat,
            ),
            Stat::AilmentDuration => (
                "ailment_duration",
                "Ailment Duration",
                "Scales how long your ailments last (Ignite spreads a fixed total, so shorter burns faster).",
                AddedUnit::BasisPoints,
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

/// A first-class ailment kind (#88). v1 ships Ignite/Shock/Chill; freeze/bleed/
/// poison are future. Each maps from the triggering hit's dominant damage type
/// (fire→Ignite, lightning→Shock, cold→Chill). Lives here (the leaf) because a
/// `Condition` reads it (`TargetHasAilment`); re-exported by `idlin-sim::entity`,
/// where `ActiveEffect::Ailment` carries it. Snapshots encode the variant by
/// index, so the `snake_case` RON rename doesn't move snapshot bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AilmentKind {
    /// Fire: a damage-over-time burn — a fixed total spread over the duration.
    Ignite,
    /// Lightning: the victim takes increased damage while shocked.
    Shock,
    /// Cold: the victim's actions and movement are slowed.
    Chill,
}

impl AilmentKind {
    /// The canonical active-ailment bit (matches the nameplate bitmask): Ignite=1,
    /// Shock=2, Chill=4. `EvalContext::target_ailments` is an OR of these.
    pub fn bit(self) -> u8 {
        match self {
            AilmentKind::Ignite => 1,
            AilmentKind::Shock => 2,
            AilmentKind::Chill => 4,
        }
    }
}

/// A predicate gating an affix effect (#86), read from HASHED STATE ONLY so it
/// stays deterministic (no floats / wall-clock). The sim evaluates it against an
/// `EvalContext` at the point the effect folds in. `None` on an effect = always.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Condition {
    /// DERIVE-TIME. While the wielded weapon is this class. Unarmed (no weapon)
    /// counts as Melee — fists are melee attacks (subsumes the legacy MeleePhys
    /// rule). Changes only on equip/unequip, so it folds into the cached sheet.
    WieldingWeaponClass(WeaponClass),
    /// STRIKE-TIME (#109). While the attacker's current life is BELOW this fraction
    /// of its max (basis points, 0..10000). Varies mid-combat with no re-derive, so
    /// it folds into a per-strike effective sheet, not the cached one.
    BelowLifePct(i64),
    /// STRIKE-TIME (#109). While the attacker's current life is ABOVE this fraction
    /// of its max (basis points, 0..10000).
    AboveLifePct(i64),
    /// STRIKE-TIME (#109). While the attacker is at full life (life == max).
    FullLife,
    /// STRIKE-TIME (#109). For this many ticks after the attacker's last kill —
    /// a momentum window (e.g. "+X% damage for 4s after a kill"). The window is a
    /// tick count (>= 0); `ticks_since_kill` is `now - last_kill_tick`, or "never".
    RecentlyKilled(i64),
    /// STRIKE-TIME + TARGET-DEPENDENT (#109 B2b). While the VICTIM of this hit
    /// carries the named ailment. Varies per victim (an AoE hits ailed and un-ailed
    /// enemies in one use), so it folds per-strike against the victim's state, not
    /// into the attacker's cached sheet — read from `EvalContext::target_ailments`.
    TargetHasAilment(AilmentKind),
}

impl Condition {
    /// STRIKE-TIME conditions vary between derives (life/target state), so they
    /// CANNOT be baked into the cached stat sheet — the sim folds them per-strike.
    /// DERIVE-TIME conditions (weapon class) change only on a re-derive trigger and
    /// fold into the cached sheet as usual (#109).
    pub fn is_strike_time(&self) -> bool {
        match self {
            Condition::WieldingWeaponClass(_) => false,
            Condition::BelowLifePct(_)
            | Condition::AboveLifePct(_)
            | Condition::FullLife
            | Condition::RecentlyKilled(_)
            | Condition::TargetHasAilment(_) => true,
        }
    }

    /// TARGET-DEPENDENT conditions (#109 B2b) read the VICTIM's state, so they vary
    /// per hit within a single use and can't fold even into the per-USE effective
    /// sheet — the sim collects these grants at derive and folds them per-VICTIM in
    /// `World::strike`. (A subset of `is_strike_time`.)
    pub fn is_target_dependent(&self) -> bool {
        matches!(self, Condition::TargetHasAilment(_))
    }
}

/// The hashed-state facts a `Condition` reads, built by the sim per entity at
/// fold time. Pure data so the predicate (`Condition::holds`) stays in content
/// and deterministic. Grows as new conditions land (life %, target ailments, …).
#[derive(Debug, Clone, Copy)]
pub struct EvalContext {
    /// The wielded weapon's class; `None` = unarmed (counts as melee).
    pub weapon_class: Option<WeaponClass>,
    /// STRIKE-TIME (#109): the entity's current life as basis points of its max
    /// (0..10000). Only meaningful when folding strike-time conditions; the cached
    /// derive ignores it (it skips strike-time conditions entirely).
    pub life_pct: i64,
    /// STRIKE-TIME (#109): ticks since the attacker's last kill (`now -
    /// last_kill_tick`), or a large sentinel when it has never killed. Read by
    /// `RecentlyKilled`.
    pub ticks_since_kill: i64,
    /// STRIKE-TIME PHASE (#109): when `false` (the cached derive) the fold SKIPS
    /// strike-time conditions — they vary mid-combat and can't bake into the cached
    /// sheet, so the sim folds them per-strike with this set `true`.
    pub include_strike: bool,
    /// TARGET-DEPENDENT (#109 B2b): the VICTIM's active ailments as an OR of
    /// `AilmentKind::bit()` (ignite=1, shock=2, chill=4). Only meaningful in the
    /// per-victim strike fold; 0 everywhere else (so `TargetHasAilment` never holds
    /// in the cached or per-use derive — those grants are collected and applied
    /// per-victim instead). Read by `TargetHasAilment`.
    pub target_ailments: u8,
}

impl Default for EvalContext {
    fn default() -> Self {
        // Full life, derive phase: the neutral default. Derive-time folds never
        // read life_pct (they skip strike-time conditions), and a bare context
        // shouldn't read as hurt or as the strike phase.
        EvalContext {
            weapon_class: None,
            life_pct: 10000,
            // "never killed": no RecentlyKilled window can hold by default.
            ticks_since_kill: i64::MAX,
            include_strike: false,
            // No target by default → TargetHasAilment can't hold.
            target_ailments: 0,
        }
    }
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
            // Strike-time life thresholds (#109): strict below / above, full at the
            // cap. life_pct is clamped 0..10000 by the sim when it builds the ctx.
            Condition::BelowLifePct(bp) => ctx.life_pct < *bp,
            Condition::AboveLifePct(bp) => ctx.life_pct > *bp,
            Condition::FullLife => ctx.life_pct >= 10000,
            // Within the post-kill window (inclusive). Sentinel ticks_since_kill
            // (never killed) exceeds any window, so it reads false.
            Condition::RecentlyKilled(window) => ctx.ticks_since_kill <= *window,
            // The victim carries this ailment (#109 B2b). 0 (no target) reads false.
            Condition::TargetHasAilment(kind) => ctx.target_ailments & kind.bit() != 0,
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
            ..Default::default()
        };
        let unarmed = EvalContext {
            weapon_class: None,
            ..Default::default()
        };
        let bow = EvalContext {
            weapon_class: Some(WeaponClass::Bow),
            ..Default::default()
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
        // Strike-time life conditions (#109) round-trip too.
        let b: Condition = ron::from_str("below_life_pct(3500)").unwrap();
        assert_eq!(b, Condition::BelowLifePct(3500));
        let f: Condition = ron::from_str("full_life").unwrap();
        assert_eq!(f, Condition::FullLife);
        let k: Condition = ron::from_str("recently_killed(40)").unwrap();
        assert_eq!(k, Condition::RecentlyKilled(40));
    }

    #[test]
    fn recently_killed_evaluates_against_ticks_since_kill() {
        // #109: RecentlyKilled holds for `window` ticks (inclusive) after a kill;
        // the "never killed" sentinel (i64::MAX) exceeds any window. Mutation: flip
        // `<=` to `<` or `>` in holds → the boundary/sentinel cases fail.
        let since = |ticks_since_kill: i64| EvalContext {
            ticks_since_kill,
            ..Default::default()
        };
        assert!(Condition::RecentlyKilled(40).holds(&since(0))); // just killed
        assert!(Condition::RecentlyKilled(40).holds(&since(40))); // inclusive edge
        assert!(!Condition::RecentlyKilled(40).holds(&since(41))); // window lapsed
        assert!(!Condition::RecentlyKilled(40).holds(&since(i64::MAX))); // never killed
        // The default context reads as "never killed".
        assert!(!Condition::RecentlyKilled(40).holds(&EvalContext::default()));
        // Never-killed stays inert even at the MAX valid window (36_000, the loader
        // cap) — the sentinel sits far above it, so no collision (#109 critic).
        assert!(!Condition::RecentlyKilled(36_000).holds(&since(i64::MAX)));
    }

    #[test]
    fn life_threshold_conditions_evaluate_against_life_pct() {
        // #109 strike-time conditions read `life_pct` (bp of max). Below/Above are
        // strict; FullLife is the cap. Mutation: flip `<`/`>` in holds → these fail.
        let at = |life_pct: i64| EvalContext {
            life_pct,
            ..Default::default()
        };
        assert!(Condition::BelowLifePct(3500).holds(&at(3499)));
        assert!(!Condition::BelowLifePct(3500).holds(&at(3500))); // strict: not at the line
        assert!(!Condition::BelowLifePct(3500).holds(&at(10000)));
        assert!(Condition::AboveLifePct(7500).holds(&at(7501)));
        assert!(!Condition::AboveLifePct(7500).holds(&at(7500))); // strict
        assert!(Condition::FullLife.holds(&at(10000)));
        assert!(!Condition::FullLife.holds(&at(9999)));
    }

    #[test]
    fn strike_time_conditions_are_classified() {
        // #109: only the life conditions are strike-time; weapon class is derive-time.
        // Mutation: misclassify any arm → the cached derive would (in)correctly fold
        // it and the sim's phase split breaks.
        assert!(!Condition::WieldingWeaponClass(WeaponClass::Melee).is_strike_time());
        assert!(Condition::BelowLifePct(3500).is_strike_time());
        assert!(Condition::AboveLifePct(7500).is_strike_time());
        assert!(Condition::FullLife.is_strike_time());
        assert!(Condition::RecentlyKilled(40).is_strike_time());
    }
}
