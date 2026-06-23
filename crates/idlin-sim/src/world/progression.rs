//! Experience, leveling (character and gem), and the derived-stat engine
//! that folds tree grants, gear affixes, and attribute conversions into a
//! character's effective combat stats.

use super::{
    BASE_SPEED_CPS, SimEvent, UNARMED_RANGE_CU, UNARMED_USE_TICKS, World, base_accuracy,
    base_evasion, base_life, base_mana, base_unarmed_damage, fx_from_cu, speed_from_cps,
};
use crate::entity::{DMG_COUNT, GEM_LEVEL_CAP, Item, RES_COUNT, gem_xp_to_next};
use crate::fixed::Fx;
use crate::stats::{EvalContext, Grant, Stat, StatSheet};
use idlin_content::GearSlot;

/// Fold one grant into a sheet IF its condition holds (`None` = always) — the
/// single conditional-apply path every power source shares (#86): affixes, tree
/// nodes, and buffs all route through here against the entity's `EvalContext`.
pub(crate) fn apply_conditional(sheet: &mut StatSheet, g: &Grant, ctx: &EvalContext) {
    if g.condition.is_none_or(|c| c.holds(ctx)) {
        sheet.apply(g);
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
        let Some(e) = self.zone.get_mut(slot) else {
            return;
        };
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

    /// Monsters: def base + active effect grants. Folds the combat-relevant
    /// stats (life, damage, accuracy/evasion/armour, resists, attack and
    /// move speed) with the same clamps the character path uses.
    fn refresh_monster_stats(&mut self, slot: usize) {
        use crate::entity::ActiveEffect;
        let Some(e) = self.zone.get(slot) else { return };
        let Some(m) = &e.monster else { return };
        let def_idx = m.def_idx;
        // Monsters wield no weapon → unarmed (counts as melee) for conditions.
        let ctx = EvalContext { weapon_class: None };
        let mut sheet = StatSheet::new();
        for ef in &e.effects {
            if let ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    apply_conditional(&mut sheet, g, &ctx);
                }
            }
        }
        let def = &self.content.monsters[def_idx as usize];
        let mut next = super::monster_base_stats(def);
        next.life_max = sheet.value(Stat::Life, next.life_max).max(1);
        const DMG_STATS: [Stat; DMG_COUNT] = [
            Stat::DamagePhys,
            Stat::DamageFire,
            Stat::DamageCold,
            Stat::DamageLightning,
            Stat::DamageChaos,
        ];
        for (i, stat) in DMG_STATS.iter().enumerate() {
            next.damage[i] = sheet.value(*stat, next.damage[i]).max(0);
        }
        next.accuracy = sheet.value(Stat::Accuracy, next.accuracy).max(0);
        next.evasion = sheet.value(Stat::Evasion, next.evasion).max(0);
        next.armour = sheet.value(Stat::Armour, next.armour).max(0);
        const RES_STATS: [Stat; RES_COUNT] = [
            Stat::ResistFire,
            Stat::ResistCold,
            Stat::ResistLightning,
            Stat::ResistChaos,
        ];
        for (i, stat) in RES_STATS.iter().enumerate() {
            next.resists[i] = sheet.value(*stat, next.resists[i]);
        }
        let attack_factor = sheet.value(Stat::AttackSpeed, 10000).max(1000);
        next.use_ticks = ((def.use_ticks as i64 * 10000 / attack_factor).max(2)) as u32;
        let move_factor = sheet.value(Stat::MoveSpeed, 10000).max(1000);
        next.speed_per_tick = crate::fixed::Fx::from_raw(
            (super::speed_from_cps(def.speed_cps).raw() as i64 * move_factor / 10000) as i32,
        );
        // Ailments (#88): full monster parity — caps start at the base defaults
        // (4000/3000 from monster_base_stats) and rolled mods raise them.
        next.ignite_chance = sheet.value(Stat::IgniteChance, next.ignite_chance).max(0);
        next.shock_chance = sheet.value(Stat::ShockChance, next.shock_chance).max(0);
        next.chill_chance = sheet.value(Stat::ChillChance, next.chill_chance).max(0);
        next.crits_no_ailment = sheet.value(Stat::CritAilmentDenied, 0) > 0;
        next.shock_max = sheet.value(Stat::ShockMax, next.shock_max).max(0);
        next.chill_max = sheet.value(Stat::ChillMax, next.chill_max).max(0);
        next.ailment_duration = sheet.value(Stat::AilmentDuration, next.ailment_duration);

        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.combat.as_mut()
        {
            // Runtime state survives the rebuild; life clamps to the new max.
            next.life = c.life.min(next.life_max);
            next.busy_until = c.busy_until;
            next.last_combat_tick = c.last_combat_tick;
            next.es_recharge_at = c.es_recharge_at;
            *c = next;
        }
    }

    /// Build the full stat sheet for a character: tree grants + gear affixes,
    /// evaluated over universal bases and gear base stats. The weapon defines
    /// the normal attack; armour/evasion bases sum across gear.
    fn refresh_character_stats(&mut self, slot: usize) {
        let Some(e) = self.zone.get(slot) else { return };
        let Some(ch) = &e.character else { return };
        let level = ch.level;

        let mut sheet = StatSheet::new();
        // The condition context up front (wielded weapon class; None = unarmed,
        // which counts as melee) so EVERY power source — tree, buffs, affixes —
        // evaluates its grant conditions against it through one path (#86).
        let weapon_class = ch.equipment[GearSlot::Weapon.idx()]
            .as_ref()
            .and_then(|it| self.content.items[it.base_idx as usize].weapon_class);
        let ctx = crate::stats::EvalContext { weapon_class };
        for &node_idx in &ch.allocated {
            if let Some(node) = self.content.tree.get(node_idx as usize) {
                for g in &node.grants {
                    apply_conditional(&mut sheet, g, &ctx);
                }
            }
        }
        // Active buffs are grants with a clock; they re-derive on apply and
        // on expiry, so folding them here keeps one evaluation path.
        for ef in &e.effects {
            if let crate::entity::ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    apply_conditional(&mut sheet, g, &ctx);
                }
            }
        }
        let mut weapon: Option<&Item> = None;
        let mut armour_base = 0i64;
        let mut evasion_base = base_evasion(level);
        let mut block_base = 0i64;
        for (i, slot_item) in ch.equipment.iter().enumerate() {
            let Some(item) = slot_item else { continue };
            let def = &self.content.items[item.base_idx as usize];
            for ra in &item.affixes {
                let a = &self.content.affixes[ra.affix_idx as usize];
                for g in a.grants(&ra.values) {
                    apply_conditional(&mut sheet, &g, &ctx);
                }
            }
            if i == GearSlot::Weapon.idx() {
                weapon = Some(item);
            } else {
                armour_base += def.armour;
                evasion_base += def.evasion;
                block_base += def.block_bp;
            }
        }

        // Attribute conversions (PoE-classic, user-locked; ratios flagged
        // for redline). Each point of:
        //   Strength:     +0.5 life,     +0.2% increased MELEE phys
        //   Dexterity:    +2 accuracy,   +0.2% increased evasion
        //   Intelligence: +0.5 mana,     +0.2% increased energy shield
        let strength = sheet.value(Stat::Strength, 0);
        let dexterity = sheet.value(Stat::Dexterity, 0);
        let intelligence = sheet.value(Stat::Intelligence, 0);
        for grant in [
            Grant::new(Stat::Life, crate::stats::Layer::Added, strength / 2),
            // STR's "increased melee physical" — a CONDITIONAL grant in the same
            // loop (#86): the retired MeleePhys bucket, now the unified mechanism's
            // first client (phys while wielding melee; unarmed counts).
            Grant {
                stat: Stat::DamagePhys,
                layer: crate::stats::Layer::Increased,
                value: strength * 20,
                condition: Some(crate::stats::Condition::WieldingWeaponClass(
                    crate::stats::WeaponClass::Melee,
                )),
            },
            Grant::new(Stat::Accuracy, crate::stats::Layer::Added, dexterity * 2),
            Grant::new(
                Stat::Evasion,
                crate::stats::Layer::Increased,
                dexterity * 20,
            ),
            Grant::new(Stat::Mana, crate::stats::Layer::Added, intelligence / 2),
            Grant::new(
                Stat::EnergyShield,
                crate::stats::Layer::Increased,
                intelligence * 20,
            ),
        ] {
            if grant.value != 0 {
                apply_conditional(&mut sheet, &grant, &ctx);
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

        let life_max = sheet.value(Stat::Life, base_life(level)).max(1);
        const DMG_STATS: [Stat; DMG_COUNT] = [
            Stat::DamagePhys,
            Stat::DamageFire,
            Stat::DamageCold,
            Stat::DamageLightning,
            Stat::DamageChaos,
        ];
        let mut damage = [0i64; DMG_COUNT];
        for i in 0..DMG_COUNT {
            damage[i] = sheet.value(DMG_STATS[i], dmg_base[i]);
        }
        let accuracy = sheet.value(Stat::Accuracy, base_accuracy(level));
        let evasion = sheet.value(Stat::Evasion, evasion_base);
        let armour = sheet.value(Stat::Armour, armour_base);
        const RES_STATS: [Stat; RES_COUNT] = [
            Stat::ResistFire,
            Stat::ResistCold,
            Stat::ResistLightning,
            Stat::ResistChaos,
        ];
        let mut resists = [0i64; RES_COUNT];
        for i in 0..RES_COUNT {
            resists[i] = sheet.value(RES_STATS[i], 0);
        }
        let attack_factor = sheet.value(Stat::AttackSpeed, 10000).max(1000);
        let use_ticks = ((use_base as i64 * 10000 / attack_factor).max(2)) as u32;
        let move_factor = sheet.value(Stat::MoveSpeed, 10000).max(1000);
        let mana_max = sheet.value(Stat::Mana, base_mana(level)).max(0);
        let es_max = sheet.value(Stat::EnergyShield, 0);
        let life_regen = sheet.value(Stat::LifeRegen, 0);
        let mana_regen = sheet.value(Stat::ManaRegen, 0);
        let leech_life = sheet.value(Stat::LeechLife, 0);
        let leech_mana = sheet.value(Stat::LeechMana, 0);
        let block = sheet.value(Stat::Block, block_base).min(7500);
        let crit_inc = sheet.value(Stat::CritChance, 10000).max(0);
        let crit_multi = (15000 + sheet.value(Stat::CritMulti, 0)).max(10000);
        let cast_speed = sheet.value(Stat::CastSpeed, 10000).max(1000);
        let item_rarity = sheet.value(Stat::ItemRarity, 10000).max(0);
        let item_quantity = sheet.value(Stat::ItemQuantity, 10000).max(0);
        let stagger = sheet.value(Stat::Stagger, 0).max(0);
        let poise = sheet.value(Stat::Poise, 0).max(0);
        let knockback_cu = sheet.value(Stat::Knockback, 0).max(0);
        // Ailments (#88): per-element inflict chance + flag + per-ailment caps
        // (base 4000/3000, raised by the Added layer) + duration scale.
        let ignite_chance = sheet.value(Stat::IgniteChance, 0).max(0);
        let shock_chance = sheet.value(Stat::ShockChance, 0).max(0);
        let chill_chance = sheet.value(Stat::ChillChance, 0).max(0);
        let crits_no_ailment = sheet.value(Stat::CritAilmentDenied, 0) > 0;
        let shock_max = sheet.value(Stat::ShockMax, 4000).max(0);
        let chill_max = sheet.value(Stat::ChillMax, 3000).max(0);
        let ailment_duration = sheet.value(Stat::AilmentDuration, 0);
        let speed = Fx::from_raw(
            ((speed_from_cps(BASE_SPEED_CPS).raw() as i64) * move_factor / 10000) as i32,
        );

        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.combat.as_mut()
        {
            let delta = life_max - c.life_max;
            c.life_max = life_max;
            if c.life > 0 {
                c.life = (c.life + delta.max(0)).min(life_max);
            }
            let mana_delta = mana_max - c.mana_max;
            c.mana_max = mana_max;
            c.mana = (c.mana + mana_delta.max(0)).clamp(0, mana_max);
            let es_delta = es_max - c.es_max;
            c.es_max = es_max;
            c.es = (c.es + es_delta.max(0)).clamp(0, es_max);
            c.life_regen = life_regen;
            c.mana_regen = mana_regen;
            c.leech_life = leech_life;
            c.leech_mana = leech_mana;
            c.block = block;
            c.crit_inc = crit_inc;
            c.crit_multi = crit_multi;
            c.cast_speed = cast_speed;
            c.damage = damage;
            c.accuracy = accuracy;
            c.evasion = evasion;
            c.armour = armour;
            c.resists = resists;
            c.range = range;
            c.use_ticks = use_ticks;
            c.speed_per_tick = speed;
            c.projectile = projectile;
            c.item_rarity = item_rarity;
            c.item_quantity = item_quantity;
            c.stagger = stagger;
            c.poise = poise;
            c.knockback_cu = knockback_cu;
            c.ignite_chance = ignite_chance;
            c.shock_chance = shock_chance;
            c.chill_chance = chill_chance;
            c.crits_no_ailment = crits_no_ailment;
            c.shock_max = shock_max;
            c.chill_max = chill_max;
            c.ailment_duration = ailment_duration;
        }
    }
}

#[cfg(test)]
mod grant_tests {
    use super::apply_conditional;
    use crate::stats::{Condition, EvalContext, Grant, Layer, Stat, StatSheet, WeaponClass};

    #[test]
    fn apply_conditional_gates_every_power_source_uniformly() {
        // The single fold path (#86): a conditional grant — from an affix, a tree
        // node, OR a buff — applies only when its condition holds; unconditional
        // grants always do. Mutation: drop the condition check in apply_conditional
        // and the bow case wrongly gains the bonus.
        let melee = EvalContext {
            weapon_class: Some(WeaponClass::Melee),
        };
        let bow = EvalContext {
            weapon_class: Some(WeaponClass::Bow),
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
