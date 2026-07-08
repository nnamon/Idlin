//! Experience, leveling (character and gem), and the derived-stat engine
//! that folds tree grants, gear affixes, and attribute conversions into a
//! character's effective combat stats.

use super::{
    BASE_SPEED_CPS, SimEvent, UNARMED_RANGE_CU, UNARMED_USE_TICKS, World, base_accuracy,
    base_evasion, base_life, base_mana, base_unarmed_damage, fx_from_cu, speed_from_cps,
};
use crate::entity::{DMG_COUNT, GEM_LEVEL_CAP, Item, RES_COUNT, Rarity, gem_xp_to_next};
use crate::fixed::Fx;
use crate::stats::{EvalContext, Grant, Stat, StatSheet};
use idlin_content::GearSlot;

/// Fold one grant into a sheet IF its condition holds (`None` = always) — the
/// single conditional-apply path every power source shares (#86): affixes, tree
/// nodes, and buffs all route through here against the entity's `EvalContext`.
///
/// Phase (#109): a STRIKE-TIME condition (life %, …) is SKIPPED unless
/// `ctx.include_strike` — the cached derive defers it so it can't bake a
/// mid-combat-varying bonus into the sheet; the per-strike re-derive sets the
/// flag and folds it. Returns whether the grant carried a strike-time condition,
/// so the caller can cache a `has_strike_conditions` flag (callers that don't
/// care ignore it).
pub(crate) fn apply_conditional(sheet: &mut StatSheet, g: &Grant, ctx: &EvalContext) -> bool {
    let is_strike = g.condition.is_some_and(|c| c.is_strike_time());
    let fold = match g.condition {
        None => true,
        Some(_) if is_strike && !ctx.include_strike => false, // deferred to strike phase
        Some(c) => c.holds(ctx),
    };
    if fold {
        sheet.apply(g);
    }
    is_strike
}

/// Fold a grant for the cached/per-use derive (`apply_conditional`) AND, if it
/// carries a TARGET-DEPENDENT condition (#109 B2b, e.g. "vs ignited"), collect it
/// for the per-victim strike fold. A target grant never folds into the sheet here
/// — its predicate reads the victim, and the derive ctx has `target_ailments == 0`
/// — so it must be applied later, per victim, in `World::strike`. Returns the
/// strike-time flag, exactly like `apply_conditional`.
fn fold_and_collect(
    sheet: &mut StatSheet,
    g: &Grant,
    ctx: &EvalContext,
    targets: &mut Vec<Grant>,
) -> bool {
    if g.condition.is_some_and(|c| c.is_target_dependent()) {
        targets.push(*g);
    }
    apply_conditional(sheet, g, ctx)
}

/// Apply an attacker's TARGET-DEPENDENT conditional grants (#109 B2b) to a per-type
/// damage array, given the VICTIM's active-ailment bitmask. Each grant whose
/// condition holds for this victim folds into a fresh sheet; every damage type is
/// then scaled by its resulting factor — reusing the canonical `StatSheet` layering
/// rather than reimplementing increased/more. Scales the WHOLE landed hit (the
/// natural reading of "more damage vs ailed"). Pure + RNG-free, so `World::strike`
/// can call it per victim without perturbing the seeded streams; a no-op when
/// `grants` is empty or none hold, so the common hit is unchanged.
pub(crate) fn fold_target_damage(
    damage: [i64; DMG_COUNT],
    grants: &[Grant],
    victim_ailments: u8,
) -> [i64; DMG_COUNT] {
    if grants.is_empty() {
        return damage;
    }
    const DMG_STATS: [Stat; DMG_COUNT] = [
        Stat::DamagePhys,
        Stat::DamageFire,
        Stat::DamageCold,
        Stat::DamageLightning,
        Stat::DamageChaos,
    ];
    let ctx = EvalContext {
        target_ailments: victim_ailments,
        include_strike: true,
        ..Default::default()
    };
    let mut sheet = StatSheet::new();
    for g in grants {
        apply_conditional(&mut sheet, g, &ctx);
    }
    let mut out = damage;
    for i in 0..DMG_COUNT {
        let factor = sheet.value(DMG_STATS[i], 10000);
        if factor != 10000 {
            out[i] = (damage[i] * factor / 10000).max(0);
        }
    }
    out
}

/// The derived combat values a character's stat sheet produces (#109) — the
/// fields `refresh_character_stats` assigns and the per-strike re-derive reads.
/// Live pools (life/mana/ES and timers) are NOT here: the cached refresh
/// preserves the entity's actual pools, and the strike path only reads the
/// offensive values. `has_strike` flags whether any strike-time condition exists.
struct CharDerived {
    life_max: i64,
    mana_max: i64,
    es_max: i64,
    life_regen: i64,
    mana_regen: i64,
    leech_life: i64,
    leech_mana: i64,
    block: i64,
    crit_inc: i64,
    crit_multi: i64,
    cast_speed: i64,
    damage: [i64; DMG_COUNT],
    accuracy: i64,
    evasion: i64,
    armour: i64,
    resists: [i64; RES_COUNT],
    range: Fx,
    use_ticks: u32,
    speed: Fx,
    projectile: bool,
    item_rarity: i64,
    item_quantity: i64,
    stagger: i64,
    poise: i64,
    knockback_cu: i64,
    ignite_chance: i64,
    shock_chance: i64,
    chill_chance: i64,
    crits_no_ailment: bool,
    shock_max: i64,
    chill_max: i64,
    ailment_duration: i64,
    has_strike: bool,
    /// TARGET-DEPENDENT conditional grants (#109 B2b) collected from this entity's
    /// power sources — applied per-victim in `World::strike`, never folded here.
    target_grants: Vec<Grant>,
}

/// The OFFENSIVE subset of a per-strike effective re-derive (#109) — the only
/// values `resolve_skill` reads from the attacker. Returned by `effective_offense`
/// so the full `CharDerived` stays private to the derive.
pub(super) struct EffectiveOffense {
    pub damage: [i64; DMG_COUNT],
    pub crit_inc: i64,
    pub crit_multi: i64,
    pub accuracy: i64,
    pub range: Fx,
    pub stagger: i64,
    pub knockback_cu: i64,
}

/// The per-kind BASE each stat starts from before the sheet (grants) folds over it
/// (#125 monster parity). Characters fill it from level + gear + weapon; monsters
/// from the level/rarity-scaled def. The compute that turns base + sheet into a
/// `CharDerived` (`derive_from_sheet`) is IDENTICAL for both, so the two kinds can
/// never drift — only the grant sources and these bases differ.
struct DeriveBase {
    life: i64,
    mana: i64,
    damage: [i64; DMG_COUNT],
    accuracy: i64,
    evasion: i64,
    armour: i64,
    /// Base energy shield from worn gear (#148 A2.5) — folds like armour.
    es: i64,
    resists: [i64; RES_COUNT],
    use_ticks: u32,
    speed: Fx,
    range: Fx,
    projectile: bool,
    block: i64,
}

/// The shared derive core (#125): fold attribute conversions into the sheet, then
/// compute every `CombatStats` field from `sheet.value(stat, base)`. Used by BOTH
/// the character and monster derives so the field math can't diverge. `has_strike`
/// carries whether the source grants (tree/gear/affixes/passives/buffs) held a
/// strike-time condition — attribute grants never are, so this only ever passes it
/// through (the `|=` keeps the contract explicit).
fn derive_from_sheet(
    mut sheet: StatSheet,
    base: DeriveBase,
    ctx: &EvalContext,
    mut has_strike: bool,
    target_grants: Vec<Grant>,
) -> CharDerived {
    use crate::stats::{Condition, Layer, WeaponClass};
    // Attribute conversions (PoE-classic, user-locked; ratios flagged for redline).
    // Each point of: Strength → +0.5 life, +0.2% increased MELEE phys (unarmed
    // counts); Dexterity → +2 accuracy, +0.2% increased evasion; Intelligence →
    // +0.5 mana, +0.2% increased energy shield. Folded as grants so the STR melee
    // bonus runs the same conditional path as everything else (#86).
    let strength = sheet.value(Stat::Strength, 0);
    let dexterity = sheet.value(Stat::Dexterity, 0);
    let intelligence = sheet.value(Stat::Intelligence, 0);
    for grant in [
        Grant::new(Stat::Life, Layer::Added, strength / 2),
        Grant {
            stat: Stat::DamagePhys,
            layer: Layer::Increased,
            value: strength * 20,
            condition: Some(Condition::WieldingWeaponClass(WeaponClass::Melee)),
        },
        Grant::new(Stat::Accuracy, Layer::Added, dexterity * 2),
        Grant::new(Stat::Evasion, Layer::Increased, dexterity * 20),
        Grant::new(Stat::Mana, Layer::Added, intelligence / 2),
        Grant::new(Stat::EnergyShield, Layer::Increased, intelligence * 20),
    ] {
        if grant.value != 0 {
            has_strike |= apply_conditional(&mut sheet, &grant, ctx);
        }
    }

    const DMG_STATS: [Stat; DMG_COUNT] = [
        Stat::DamagePhys,
        Stat::DamageFire,
        Stat::DamageCold,
        Stat::DamageLightning,
        Stat::DamageChaos,
    ];
    let mut damage = [0i64; DMG_COUNT];
    for i in 0..DMG_COUNT {
        damage[i] = sheet.value(DMG_STATS[i], base.damage[i]);
    }
    const RES_STATS: [Stat; RES_COUNT] = [
        Stat::ResistFire,
        Stat::ResistCold,
        Stat::ResistLightning,
        Stat::ResistChaos,
    ];
    let mut resists = [0i64; RES_COUNT];
    for i in 0..RES_COUNT {
        resists[i] = sheet.value(RES_STATS[i], base.resists[i]);
    }
    let attack_factor = sheet.value(Stat::AttackSpeed, 10000).max(1000);
    let move_factor = sheet.value(Stat::MoveSpeed, 10000).max(1000);
    CharDerived {
        life_max: sheet.value(Stat::Life, base.life).max(1),
        mana_max: sheet.value(Stat::Mana, base.mana).max(0),
        es_max: sheet.value(Stat::EnergyShield, base.es),
        life_regen: sheet.value(Stat::LifeRegen, 0),
        mana_regen: sheet.value(Stat::ManaRegen, 0),
        leech_life: sheet.value(Stat::LeechLife, 0),
        leech_mana: sheet.value(Stat::LeechMana, 0),
        block: sheet.value(Stat::Block, base.block).min(7500),
        crit_inc: sheet.value(Stat::CritChance, 10000).max(0),
        crit_multi: (15000 + sheet.value(Stat::CritMulti, 0)).max(10000),
        cast_speed: sheet.value(Stat::CastSpeed, 10000).max(1000),
        damage,
        accuracy: sheet.value(Stat::Accuracy, base.accuracy),
        evasion: sheet.value(Stat::Evasion, base.evasion),
        armour: sheet.value(Stat::Armour, base.armour),
        resists,
        range: base.range,
        use_ticks: ((base.use_ticks as i64 * 10000 / attack_factor).max(2)) as u32,
        speed: Fx::from_raw((base.speed.raw() as i64 * move_factor / 10000) as i32),
        projectile: base.projectile,
        item_rarity: sheet.value(Stat::ItemRarity, 10000).max(0),
        item_quantity: sheet.value(Stat::ItemQuantity, 10000).max(0),
        stagger: sheet.value(Stat::Stagger, 0).max(0),
        poise: sheet.value(Stat::Poise, 0).max(0),
        knockback_cu: sheet.value(Stat::Knockback, 0).max(0),
        ignite_chance: sheet.value(Stat::IgniteChance, 0).max(0),
        shock_chance: sheet.value(Stat::ShockChance, 0).max(0),
        chill_chance: sheet.value(Stat::ChillChance, 0).max(0),
        crits_no_ailment: sheet.value(Stat::CritAilmentDenied, 0) > 0,
        shock_max: sheet.value(Stat::ShockMax, 4000).max(0),
        chill_max: sheet.value(Stat::ChillMax, 3000).max(0),
        ailment_duration: sheet.value(Stat::AilmentDuration, 0),
        has_strike,
        target_grants,
    }
}

/// A monster's pre-grant base (#125): the def's stats with the per-instance level
/// and elite-bulk scaling baked in (the monster analogue of `base_life(level)` for a
/// character). Only life + damage scale with level/rarity; everything else is the raw
/// def. The derive then folds rolled affixes + passives + buffs over this, every
/// refresh — so the scaling (and affixes) can no longer be lost when a monster is
/// chilled. (Bulk multiplies the base here rather than post-affix as the old spawn
/// did; flat-life affixes are no longer bulk-scaled — a small, intentional shift.)
fn monster_scaled_base(
    def: &idlin_content::MonsterDef,
    eff_level: u32,
    rarity: Rarity,
) -> DeriveBase {
    let delta = eff_level as i64 - def.level as i64;
    let life_bp = (10000 + delta * 1200).max(2500);
    let dmg_bp = (10000 + delta * 1000).max(2500);
    // Elite bulk multiplies LIFE ONLY (matching pre-#125 spawn) — magic/rare are
    // bulkier, not harder-hitting. Damage scales with level (dmg_bp) but never bulk.
    let bulk = match rarity {
        Rarity::Magic => 16000,
        Rarity::Rare => 26000,
        _ => 10000,
    };
    let raw = [
        def.damage,
        def.damage_fire,
        def.damage_cold,
        def.damage_lightning,
        def.damage_chaos,
    ];
    let mut damage = [0i64; DMG_COUNT];
    for i in 0..DMG_COUNT {
        damage[i] = raw[i] * dmg_bp / 10000;
    }
    let accuracy = if def.accuracy > 0 {
        def.accuracy
    } else {
        60 + 15 * def.level as i64
    };
    DeriveBase {
        life: (def.life * life_bp / 10000 * bulk / 10000).max(1),
        mana: def.mana,
        damage,
        accuracy,
        evasion: def.evasion,
        es: 0,
        armour: def.armour,
        resists: [
            def.resist_fire,
            def.resist_cold,
            def.resist_lightning,
            def.resist_chaos,
        ],
        use_ticks: def.use_ticks,
        speed: speed_from_cps(def.speed_cps),
        range: fx_from_cu(def.range_cu),
        projectile: def.projectile,
        block: 0,
    }
}

/// XP to advance from `level` to `level+1`. Hybrid curve: a quadratic
/// BASE (smooth early game) times an exponential factor that engages
/// only AFTER the tutorial band, so levels 1..=5 are unchanged and the
/// back half (90→100) becomes a genuine mountain — roughly the whole
/// 1→90 climb again. Integer-only (the exponential is fixed-point so
/// the curve is bit-identical on every platform). Tunable via the two
/// rate constants.
pub(super) fn xp_to_next(level: u32) -> i64 {
    const RAMP_FROM: u32 = 5; // levels 1..=5 unchanged (tutorial pacing)
    const SCALE: i64 = 1 << 20; // fixed-point multiplier scale
    const R_NUM: i64 = 27; // r = 1.08, exactly 27/25
    const R_DEN: i64 = 25;
    let l = level as i64;
    let base = 80 + 40 * l * l;
    // r^(level - RAMP_FROM), accumulated in fixed point. Operands stay
    // far inside i64 even at level 100 (base*mult ≈ 6.3e14 « i64::MAX).
    let mut mult = SCALE;
    for _ in 0..level.saturating_sub(RAMP_FROM) {
        mult = mult * R_NUM / R_DEN;
    }
    base * mult / SCALE
}

impl World {
    pub(super) fn grant_xp(
        &mut self,
        slot: usize,
        xp: i64,
        credit_kill: bool,
        events: &mut Vec<SimEvent>,
    ) {
        let now = self.tick;
        let Some(e) = self.zone.get_mut(slot) else {
            return;
        };
        // Stamp the kill tick on the combat block (#109 RecentlyKilled) before
        // borrowing the character — opens the post-kill momentum window. This is the
        // character-side stamp; MONSTER killers are stamped at the kill site
        // (`handle_kill`, #125), so RecentlyKilled works for monsters too. The two
        // are idempotent on overlap (a character killing a monster) — same tick.
        if credit_kill
            && e.character.is_some()
            && let Some(c) = e.combat.as_mut()
        {
            c.last_kill_tick = now;
        }
        let net_id = e.net_id;
        let Some(ch) = e.character.as_mut() else {
            return;
        };
        if credit_kill {
            ch.kills += 1;
            // Kills refill BOTH equipped flasks (PoE-style charge gain).
            for flask_slot in idlin_content::GearSlot::FLASK_SLOTS {
                if let Some(flask) = ch.equipment[flask_slot].as_mut() {
                    let def = &self.content.items[flask.base_idx as usize];
                    flask.charges = (flask.charges + def.flask_gain).min(def.flask_charges);
                }
            }
        }
        ch.xp += xp;
        let mut leveled = false;
        while ch.level < 100 && ch.xp >= xp_to_next(ch.level) {
            ch.xp -= xp_to_next(ch.level);
            ch.level += 1;
            leveled = true;
        }
        // Socketed gems learn from kills too (half share, each).
        let mut gem_levelups: Vec<(u32, u32)> = Vec::new();
        for sg in ch.sockets.values_mut() {
            for gem in std::iter::once(&mut sg.gem).chain(sg.supports.iter_mut()) {
                gem.xp += xp / 2;
                while gem.level < GEM_LEVEL_CAP && gem.xp >= gem_xp_to_next(gem.level) {
                    gem.xp -= gem_xp_to_next(gem.level);
                    gem.level += 1;
                    gem_levelups.push((gem.gem_idx, gem.level));
                }
            }
        }
        let owner_name = ch.name.clone();
        for (gem_idx, glevel) in gem_levelups {
            events.push(SimEvent::GemLevelUp {
                id: net_id,
                owner: owner_name.clone(),
                gem: self.content.gems[gem_idx as usize].name.clone(),
                level: glevel,
            });
        }

        if leveled {
            let name = owner_name;
            let level = {
                let e = self.zone.get(slot).unwrap();
                e.character.as_ref().unwrap().level
            };
            self.refresh_derived_stats(slot);
            if let Some(me) = self.zone.get_mut(slot)
                && let Some(c) = me.combat.as_mut()
            {
                c.life = c.life_max; // level-up: full heal
            }
            events.push(SimEvent::LevelUp {
                id: net_id,
                name,
                level,
            });
            // New points walk the declared build.
            self.allocate_from_plan(slot, events);
        }
    }

    /// Re-derive an entity's combat stats after anything that changes them
    /// (level, gear, tree, timed effects). Characters rebuild their full
    /// sheet; monsters rebuild from their def and fold active effects —
    /// that's how enemy debuffs (chill etc.) actually bite.
    pub(super) fn refresh_derived_stats(&mut self, slot: usize) {
        let Some(e) = self.zone.get(slot) else { return };
        if e.character.is_some() {
            self.refresh_character_stats(slot);
        } else if e.monster.is_some() {
            self.refresh_monster_stats(slot);
        }
    }

    /// Pure derive for a MONSTER (#125 parity) — the mirror of
    /// `character_derived_stats`. Folds rolled affixes, the def's fixed passive set,
    /// and active buffs (plus attribute conversion, via the shared core) over the
    /// level/rarity-scaled def base, computing EVERY field a character does. The
    /// cached refresh calls it at full life in the DERIVE phase; the hit path calls it
    /// at live life % in the STRIKE phase so strike-time conditions fold per-strike.
    fn monster_derived_stats(
        &self,
        slot: usize,
        life_pct: i64,
        include_strike: bool,
    ) -> Option<CharDerived> {
        let e = self.zone.get(slot)?;
        let m = e.monster.as_ref()?;
        let def = &self.content.monsters[m.def_idx as usize];
        // Ticks since this monster last killed (#125: RecentlyKilled works for
        // monsters too) — same 0=never sentinel + saturating cast as the char path.
        let ticks_since_kill = e
            .combat
            .as_ref()
            .map(|c| {
                if c.last_kill_tick == 0 {
                    i64::MAX
                } else {
                    self.tick
                        .saturating_sub(c.last_kill_tick)
                        .min(i64::MAX as u64) as i64
                }
            })
            .unwrap_or(i64::MAX);
        // Monsters wield no weapon → unarmed (counts as melee) for conditions.
        let ctx = EvalContext {
            weapon_class: None,
            life_pct,
            ticks_since_kill,
            include_strike,
            target_ailments: 0,
        };
        let mut sheet = StatSheet::new();
        let mut has_strike = false;
        let mut target_grants = Vec::new();
        // Rolled affixes — folded EVERY refresh (not baked at spawn), so a chilled
        // rare keeps its affix bonuses. Same `grants(values)` path as gear affixes.
        for ra in &m.affixes {
            let a = &self.content.affixes[ra.affix_idx as usize];
            for g in a.grants(&ra.values) {
                has_strike |= fold_and_collect(&mut sheet, &g, &ctx, &mut target_grants);
            }
        }
        // The def's fixed passive set (#125).
        for g in &def.passives {
            has_strike |= fold_and_collect(&mut sheet, g, &ctx, &mut target_grants);
        }
        // Active buffs/debuffs (chill/shock/…) — clock-bearing grants, same as chars.
        for ef in &e.effects {
            if let crate::entity::ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    has_strike |= fold_and_collect(&mut sheet, g, &ctx, &mut target_grants);
                }
            }
        }
        let base = monster_scaled_base(def, m.level, m.rarity);
        Some(derive_from_sheet(
            sheet,
            base,
            &ctx,
            has_strike,
            target_grants,
        ))
    }

    /// Refresh a monster's cached combat stats (#125): derive at full life in the
    /// DERIVE phase (strike-time conditions deferred), then assign onto the live
    /// `CombatStats` — preserving runtime pools/timers and clamping to new maxes,
    /// exactly like `refresh_character_stats`.
    fn refresh_monster_stats(&mut self, slot: usize) {
        let Some(d) = self.monster_derived_stats(slot, 10000, false) else {
            return;
        };
        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.combat.as_mut()
        {
            let life_delta = d.life_max - c.life_max;
            c.life_max = d.life_max;
            if c.life > 0 {
                c.life = (c.life + life_delta.max(0)).min(d.life_max);
            }
            let mana_delta = d.mana_max - c.mana_max;
            c.mana_max = d.mana_max;
            c.mana = (c.mana + mana_delta.max(0)).clamp(0, d.mana_max);
            let es_delta = d.es_max - c.es_max;
            c.es_max = d.es_max;
            c.es = (c.es + es_delta.max(0)).clamp(0, d.es_max);
            c.life_regen = d.life_regen;
            c.mana_regen = d.mana_regen;
            c.leech_life = d.leech_life;
            c.leech_mana = d.leech_mana;
            c.block = d.block;
            c.crit_inc = d.crit_inc;
            c.crit_multi = d.crit_multi;
            c.cast_speed = d.cast_speed;
            c.damage = d.damage;
            c.accuracy = d.accuracy;
            c.evasion = d.evasion;
            c.armour = d.armour;
            c.resists = d.resists;
            c.range = d.range;
            c.use_ticks = d.use_ticks;
            c.speed_per_tick = d.speed;
            c.projectile = d.projectile;
            c.item_rarity = d.item_rarity;
            c.item_quantity = d.item_quantity;
            c.stagger = d.stagger;
            c.poise = d.poise;
            c.knockback_cu = d.knockback_cu;
            c.ignite_chance = d.ignite_chance;
            c.shock_chance = d.shock_chance;
            c.chill_chance = d.chill_chance;
            c.crits_no_ailment = d.crits_no_ailment;
            c.shock_max = d.shock_max;
            c.chill_max = d.chill_max;
            c.ailment_duration = d.ailment_duration;
            c.has_strike_conditions = d.has_strike;
            c.target_grants = d.target_grants;
        }
    }

    /// Pure derive (#109): build a character's effective combat stats for a given
    /// life fraction (basis points) and condition phase. The cached `refresh`
    /// calls this with full life + the DERIVE phase (strike-time conditions are
    /// deferred); the hit path calls it with the live life % + the STRIKE phase so
    /// strike-time conditions (e.g. "while below 35% life") fold per-strike.
    /// `has_strike` reports whether any power source carried a strike-time
    /// condition, so the caller can cache the gate flag. Reads only; the caller
    /// assigns (preserving the live life/mana/ES pools).
    fn character_derived_stats(
        &self,
        slot: usize,
        life_pct: i64,
        include_strike: bool,
    ) -> Option<CharDerived> {
        let e = self.zone.get(slot)?;
        let ch = e.character.as_ref()?;
        let level = ch.level;

        let mut sheet = StatSheet::new();
        let mut has_strike = false;
        // The condition context up front (wielded weapon class; None = unarmed,
        // which counts as melee) so EVERY power source — tree, buffs, affixes —
        // evaluates its grant conditions against it through one path (#86). The
        // life % + phase carry #109's strike-time conditions.
        let weapon_class = ch.equipment[GearSlot::Weapon.idx()]
            .as_ref()
            .and_then(|it| self.content.items[it.base_idx as usize].weapon_class);
        // Ticks since this entity last killed (#109 RecentlyKilled). last_kill_tick
        // 0 is the "never killed" sentinel → i64::MAX (no window holds); a real kill
        // can't land at tick 0 (combat needs a windup first). Otherwise now - then.
        let ticks_since_kill = e
            .combat
            .as_ref()
            .map(|c| {
                if c.last_kill_tick == 0 {
                    i64::MAX
                } else {
                    // Saturate the u64→i64 cast: an absurd elapsed (> i64::MAX ticks,
                    // ~29Gyr — never in practice) must read as "long ago", never wrap
                    // negative (which would re-activate any window). Valid windows are
                    // capped far below i64::MAX (loader), so this can't false-positive.
                    self.tick
                        .saturating_sub(c.last_kill_tick)
                        .min(i64::MAX as u64) as i64
                }
            })
            .unwrap_or(i64::MAX);
        let ctx = crate::stats::EvalContext {
            weapon_class,
            life_pct,
            ticks_since_kill,
            include_strike,
            target_ailments: 0,
        };
        let mut target_grants = Vec::new();
        for &node_idx in &ch.allocated {
            if let Some(node) = self.content.tree.get(node_idx as usize) {
                for g in &node.grants {
                    has_strike |= fold_and_collect(&mut sheet, g, &ctx, &mut target_grants);
                }
            }
        }
        // Active buffs are grants with a clock; they re-derive on apply and
        // on expiry, so folding them here keeps one evaluation path.
        for ef in &e.effects {
            if let crate::entity::ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    has_strike |= fold_and_collect(&mut sheet, g, &ctx, &mut target_grants);
                }
            }
        }
        let mut weapon: Option<&Item> = None;
        let mut armour_base = 0i64;
        let mut evasion_base = base_evasion(level);
        let mut es_base = 0i64;
        let mut block_base = 0i64;
        for (i, slot_item) in ch.equipment.iter().enumerate() {
            let Some(item) = slot_item else { continue };
            let def = &self.content.items[item.base_idx as usize];
            for ra in &item.affixes {
                let a = &self.content.affixes[ra.affix_idx as usize];
                for g in a.grants(&ra.values) {
                    has_strike |= fold_and_collect(&mut sheet, &g, &ctx, &mut target_grants);
                }
            }
            // A unique's FIXED mods (#136 T5) fold exactly like rolled
            // affixes — same chokepoint, same conditional machinery.
            if let Some(u) = item.unique_idx {
                for g in &self.content.uniques[u as usize].mods {
                    has_strike |= fold_and_collect(&mut sheet, g, &ctx, &mut target_grants);
                }
            }
            if i == GearSlot::Weapon.idx() {
                weapon = Some(item);
            } else {
                armour_base += def.armour;
                evasion_base += def.evasion;
                es_base += def.energy_shield;
                block_base += def.block_bp;
            }
        }

        let (dmg_base, range, use_base, projectile) = match weapon {
            Some(item) => {
                let def = &self.content.items[item.base_idx as usize];
                (
                    [
                        def.damage_phys,
                        def.damage_fire,
                        def.damage_cold,
                        def.damage_lightning,
                        def.damage_chaos,
                    ],
                    fx_from_cu(def.range_cu),
                    def.use_ticks,
                    def.projectile,
                )
            }
            None => (
                [base_unarmed_damage(level), 0, 0, 0, 0],
                fx_from_cu(UNARMED_RANGE_CU),
                UNARMED_USE_TICKS,
                false,
            ),
        };
        // What a character starts each stat from: level-scaled pools/accuracy,
        // gear-summed armour/evasion/block, the weapon's damage/range/use-time.
        // Attribute conversion + the field math are shared via `derive_from_sheet`.
        let base = DeriveBase {
            life: base_life(level),
            mana: base_mana(level),
            damage: dmg_base,
            accuracy: base_accuracy(level),
            evasion: evasion_base,
            armour: armour_base,
            es: es_base,
            resists: [0; RES_COUNT],
            use_ticks: use_base,
            speed: speed_from_cps(BASE_SPEED_CPS),
            range,
            projectile,
            block: block_base,
        };
        Some(derive_from_sheet(
            sheet,
            base,
            &ctx,
            has_strike,
            target_grants,
        ))
    }

    /// Refresh a character's cached combat stats (#86/#109): derive at full life
    /// in the DERIVE phase (strike-time conditions deferred), then assign —
    /// preserving the live life/mana/ES pools — and cache the strike-gate flag.
    fn refresh_character_stats(&mut self, slot: usize) {
        let Some(d) = self.character_derived_stats(slot, 10000, false) else {
            return;
        };
        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.combat.as_mut()
        {
            let delta = d.life_max - c.life_max;
            c.life_max = d.life_max;
            if c.life > 0 {
                c.life = (c.life + delta.max(0)).min(d.life_max);
            }
            let mana_delta = d.mana_max - c.mana_max;
            c.mana_max = d.mana_max;
            c.mana = (c.mana + mana_delta.max(0)).clamp(0, d.mana_max);
            let es_delta = d.es_max - c.es_max;
            c.es_max = d.es_max;
            c.es = (c.es + es_delta.max(0)).clamp(0, d.es_max);
            c.life_regen = d.life_regen;
            c.mana_regen = d.mana_regen;
            c.leech_life = d.leech_life;
            c.leech_mana = d.leech_mana;
            c.block = d.block;
            c.crit_inc = d.crit_inc;
            c.crit_multi = d.crit_multi;
            c.cast_speed = d.cast_speed;
            c.damage = d.damage;
            c.accuracy = d.accuracy;
            c.evasion = d.evasion;
            c.armour = d.armour;
            c.resists = d.resists;
            c.range = d.range;
            c.use_ticks = d.use_ticks;
            c.speed_per_tick = d.speed;
            c.projectile = d.projectile;
            c.item_rarity = d.item_rarity;
            c.item_quantity = d.item_quantity;
            c.stagger = d.stagger;
            c.poise = d.poise;
            c.knockback_cu = d.knockback_cu;
            // Per-element ailment levers (#88) — now sourced from the shared derive.
            c.ignite_chance = d.ignite_chance;
            c.shock_chance = d.shock_chance;
            c.chill_chance = d.chill_chance;
            c.crits_no_ailment = d.crits_no_ailment;
            c.shock_max = d.shock_max;
            c.chill_max = d.chill_max;
            c.ailment_duration = d.ailment_duration;
            c.has_strike_conditions = d.has_strike;
            c.target_grants = d.target_grants;
        }
    }

    /// Per-strike effective offense (#109): re-derive a CHARACTER's offensive stats
    /// against its LIVE life %, folding strike-time conditions (e.g. "while below
    /// 35% life"). Only the offensive subset `resolve_skill` reads. Callers should
    /// gate on `has_strike_conditions` — this re-runs the full sheet fold, so it's
    /// not free; with no strike-time conditions the result equals the cached stats.
    pub(super) fn effective_offense(&self, slot: usize) -> Option<EffectiveOffense> {
        let e = self.zone.get(slot)?;
        let c = e.combat.as_ref()?;
        // Live life as basis points of max (clamped 0..10000).
        let life_pct = (c.life.max(0) * 10000 / c.life_max.max(1)).clamp(0, 10000);
        // #125: monsters re-derive through their own sheet build; both share the core.
        let d = if e.character.is_some() {
            self.character_derived_stats(slot, life_pct, true)?
        } else {
            self.monster_derived_stats(slot, life_pct, true)?
        };
        Some(EffectiveOffense {
            damage: d.damage,
            crit_inc: d.crit_inc,
            crit_multi: d.crit_multi,
            accuracy: d.accuracy,
            range: d.range,
            stagger: d.stagger,
            knockback_cu: d.knockback_cu,
        })
    }
}

#[cfg(test)]
mod grant_tests {
    use super::{apply_conditional, fold_target_damage};
    use crate::stats::{Condition, EvalContext, Grant, Layer, Stat, StatSheet, WeaponClass};

    #[test]
    fn target_damage_folds_only_against_a_matching_ailment() {
        use crate::entity::{DMG_COLD, DMG_COUNT, DMG_PHYS};
        use crate::stats::AilmentKind;
        // #109 B2b: "+50% more cold damage vs chilled" — a target-dependent grant.
        let grant = Grant {
            stat: Stat::DamageCold,
            layer: Layer::More,
            value: 5000,
            condition: Some(Condition::TargetHasAilment(AilmentKind::Chill)),
        };
        let mut base = [0i64; DMG_COUNT];
        base[DMG_PHYS] = 100;
        base[DMG_COLD] = 100;
        // Chilled victim: cold scales ×1.5; a cold-only grant leaves phys alone.
        let chilled = fold_target_damage(base, &[grant], AilmentKind::Chill.bit());
        assert_eq!(
            chilled[DMG_COLD], 150,
            "cold scales ×1.5 vs a chilled victim"
        );
        assert_eq!(
            chilled[DMG_PHYS], 100,
            "a cold-only grant leaves phys untouched"
        );
        // Mutation: drop the condition gate and the un-ailed case wrongly returns 150.
        assert_eq!(
            fold_target_damage(base, &[grant], 0)[DMG_COLD],
            100,
            "no scaling when the victim carries no ailment",
        );
        // Wrong ailment present (ignited, not chilled): still no scaling.
        assert_eq!(
            fold_target_damage(base, &[grant], AilmentKind::Ignite.bit())[DMG_COLD],
            100,
            "the chill grant ignores an ignited victim",
        );
        // No target grants: identity — the common hit pays nothing.
        assert_eq!(
            fold_target_damage(base, &[], AilmentKind::Chill.bit()),
            base,
            "no grants = identity",
        );
    }

    #[test]
    fn apply_conditional_gates_every_power_source_uniformly() {
        // The single fold path (#86): a conditional grant — from an affix, a tree
        // node, OR a buff — applies only when its condition holds; unconditional
        // grants always do. Mutation: drop the condition check in apply_conditional
        // and the bow case wrongly gains the bonus.
        let melee = EvalContext {
            weapon_class: Some(WeaponClass::Melee),
            ..Default::default()
        };
        let bow = EvalContext {
            weapon_class: Some(WeaponClass::Bow),
            ..Default::default()
        };
        let cond = Grant {
            stat: Stat::DamagePhys,
            layer: Layer::Increased,
            value: 5000, // +50%
            condition: Some(Condition::WieldingWeaponClass(WeaponClass::Melee)),
        };
        let plain = Grant::new(Stat::DamagePhys, Layer::Increased, 5000);

        let val = |g: &Grant, ctx: &EvalContext| {
            let mut s = StatSheet::new();
            apply_conditional(&mut s, g, ctx);
            s.value(Stat::DamagePhys, 100)
        };
        assert_eq!(val(&cond, &melee), 150, "conditional applies under melee");
        assert_eq!(val(&cond, &bow), 100, "conditional gated off under bow");
        assert_eq!(val(&plain, &bow), 150, "unconditional always applies");
    }

    #[test]
    fn derive_phase_defers_strike_time_conditions() {
        // #109: in the DERIVE phase a strike-time condition is SKIPPED (deferred to
        // the per-strike re-derive) regardless of whether it would hold; in the
        // STRIKE phase it folds when it holds. Mutation: drop the include_strike
        // gate in apply_conditional → the derive-phase value wrongly gains it.
        let below = Grant {
            stat: Stat::DamagePhys,
            layer: Layer::Increased,
            value: 5000, // +50% while below 35% life
            condition: Some(Condition::BelowLifePct(3500)),
        };
        let val = |life_pct: i64, include_strike: bool| {
            let mut s = StatSheet::new();
            let is_strike = apply_conditional(
                &mut s,
                &below,
                &EvalContext {
                    life_pct,
                    include_strike,
                    ..Default::default()
                },
            );
            (s.value(Stat::DamagePhys, 100), is_strike)
        };
        // Derive phase: deferred even though 10% < 35% would hold.
        assert_eq!(
            val(1000, false),
            (100, true),
            "derive phase defers + reports strike"
        );
        // Strike phase: folds when below the threshold, not when above.
        assert_eq!(
            val(1000, true),
            (150, true),
            "strike phase folds below-life"
        );
        assert_eq!(
            val(5000, true),
            (100, true),
            "strike phase: above threshold, no fold"
        );
    }
}

#[cfg(test)]
mod xp_curve_tests {
    use super::xp_to_next;

    /// Levels 1..=5 are byte-identical to the old quadratic (80 + 40·L²):
    /// the tutorial completes inside this band and must not be repaced.
    #[test]
    fn preserves_tutorial_band() {
        assert_eq!(xp_to_next(1), 120);
        assert_eq!(xp_to_next(2), 240);
        assert_eq!(xp_to_next(3), 440);
        assert_eq!(xp_to_next(4), 720);
        assert_eq!(xp_to_next(5), 1080);
        // The old formula for each:
        for l in 1..=5u32 {
            assert_eq!(xp_to_next(l), 80 + 40 * (l as i64) * (l as i64));
        }
    }

    /// Strictly increasing across the whole 1..=100 range — integer
    /// truncation in the exponential never stalls it (the per-step
    /// increment dwarfs the truncation).
    #[test]
    fn is_monotonic() {
        for l in 1..100u32 {
            assert!(
                xp_to_next(l) < xp_to_next(l + 1),
                "non-monotonic at {l}: {} >= {}",
                xp_to_next(l),
                xp_to_next(l + 1)
            );
        }
    }

    /// The back half is a mountain: a single level near the cap costs
    /// >100× a mid-game level, and the cap value is overflow-safe.
    #[test]
    fn is_a_back_loaded_mountain() {
        assert!(
            xp_to_next(99) > 100 * xp_to_next(49),
            "expected steep back-loading: L99 {} vs 100·L49 {}",
            xp_to_next(99),
            100 * xp_to_next(49)
        );
        let cap = xp_to_next(100);
        assert!(
            cap > 0 && cap < i64::MAX / 2,
            "cap value overflow-safe: {cap}"
        );
        // Total XP to REACH level 100 (sum of 1..=99) is the mountain.
        let total: i64 = (1..100u32).map(xp_to_next).sum();
        assert!(
            total > 5_000_000_000,
            "total to L100 should be a multi-billion climb, got {total}"
        );
    }
}
