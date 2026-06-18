//! The skill executor: aim resolution (entity/point/direction), shape
//! geometry (strike/nova/cone/line/point-AoE/projectile), the universal
//! damage pipeline, and timed effects (dots, buffs).
//!
//! Pipeline per landed strike (one order, used everywhere):
//! accuracy (attacks only) → block → crit → variance → per-type mitigation
//! (armour for phys, typed resists otherwise) → ES before life → leech →
//! on-hit riders (dot application).

use super::{ES_RECHARGE_DELAY_TICKS, RESPAWN_TICKS, SimEvent, World, XP_SHARE_RADIUS, fx_from_cu};
use crate::entity::{
    ActiveEffect, AttackIntent, DMG_COUNT, DMG_PHYS, GemInstance, LootPayload, SkillTarget,
    SocketedGem,
};
use crate::fixed::{Fx, FxV2};
use crate::stats::{Grant, Stat, StatSheet, apply_resist, hit_chance_bp, mitigate_phys};
use crate::zone::Projectile;
use idlin_content::{GemKind, SkillKind, SkillShape, SupportEffect};

/// Base crit chance of the basic weapon attack (gems author their own).
const BASIC_CRIT_BP: i64 = 500;
/// Flight speed of basic ranged-weapon projectiles (cu/s).
const BASIC_PROJ_SPEED_CPS: i32 = 1600;
/// Body radius of projectiles (collision sweep).
const PROJ_RADIUS_CU: i32 = 25;
/// Crit chance is capped here at the roll (95%); the inspect-sheet readout
/// caps the same way so its DPS can't promise crit the executor never rolls.
const CRIT_CHANCE_CAP_BP: i64 = 9500;
/// Fan spread between extra projectiles: 12-degree steps (Q16.16 cos/sin,
/// cos rounded DOWN so repeated rotation never lengthens the vector).
const FAN_COS_RAW: i64 = 64103;
const FAN_SIN_RAW: i64 = 13626;

/// Rotate a normalized direction by `steps` fan increments (sign picks the
/// side). Pure integer math, deterministic.
fn rotate_fan(dir: FxV2, steps: i32) -> FxV2 {
    let (mut x, mut y) = (dir.x.raw() as i64, dir.y.raw() as i64);
    let s = if steps >= 0 {
        FAN_SIN_RAW
    } else {
        -FAN_SIN_RAW
    };
    for _ in 0..steps.unsigned_abs() {
        let nx = (x * FAN_COS_RAW - y * s) >> 16;
        let ny = (x * s + y * FAN_COS_RAW) >> 16;
        x = nx;
        y = ny;
    }
    FxV2::new(Fx::from_raw(x as i32), Fx::from_raw(y as i32))
}

/// The i-th projectile of a fan rotates 0, +1, -1, +2, -2... steps.
fn fan_step(i: u32) -> i32 {
    if i == 0 {
        0
    } else {
        let k = i.div_ceil(2) as i32;
        if i % 2 == 1 { k } else { -k }
    }
}

/// Every socketed support's behavior effects, folded down for one use.
pub(super) struct SupportMods {
    /// Multiplicative per-type damage (10000 = unchanged).
    more_bp: [i64; DMG_COUNT],
    /// Flat typed damage added to the skill (scales with SUPPORT level).
    added: [i64; DMG_COUNT],
    attack_speed_bp: i64,
    cast_speed_bp: i64,
    extra_projectiles: u32,
    pierce: u32,
    aoe_bp: i64,
    dot_duration_bp: i64,
}

impl Default for SupportMods {
    fn default() -> Self {
        SupportMods {
            more_bp: [10000; DMG_COUNT],
            added: [0; DMG_COUNT],
            attack_speed_bp: 0,
            cast_speed_bp: 0,
            extra_projectiles: 0,
            pierce: 0,
            aoe_bp: 0,
            dot_duration_bp: 0,
        }
    }
}

/// Everything one landed hit needs to resolve, independent of where it came
/// from (direct swing, traveling projectile, or a ticking dot).
/// A committed use winding up: mana, cooldown, and the use-time itself
/// were paid when it STARTED; the strike resolves — target re-validated
/// fresh — at `resolve_at` (the contact tick). Hashed and serialized:
/// windups are world state.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(crate) struct PendingUse {
    pub attacker: u32,
    pub target: SkillTarget,
    pub skill: Option<u32>,
    pub resolve_at: u64,
}

pub(super) struct StrikeSpec {
    pub attacker_slot: Option<usize>,
    pub attacker_net: u32,
    pub attacker_name: String,
    pub attacker_is_char: bool,
    /// Spells skip the accuracy roll.
    pub is_spell: bool,
    /// Dots skip accuracy, block, crit, AND variance — steady burn.
    pub is_dot: bool,
    pub accuracy: i64,
    pub damage: [i64; DMG_COUNT],
    /// Effective crit chance (already scaled by the attacker's crit_inc).
    pub crit_bp: i64,
    pub crit_multi: i64,
    /// FX flag for the client.
    pub projectile: bool,
    /// On-hit rider: (dtype, per_second, duration_ticks, skill idx).
    pub dot: Option<(u8, i64, u32, u32)>,
    /// On-hit rider applied to the VICTIM: timed stat grants (chill etc.).
    pub debuff: Option<(Vec<Grant>, u32)>,
    /// Hit reactions (attacker-derived): bp easier to stun, flat shove cu.
    pub stagger: i64,
    pub knockback_cu: i64,
}

impl StrikeSpec {
    fn clone_for_next_victim(&self) -> StrikeSpec {
        StrikeSpec {
            attacker_name: self.attacker_name.clone(),
            ..StrikeSpec {
                attacker_slot: self.attacker_slot,
                attacker_net: self.attacker_net,
                attacker_name: String::new(),
                attacker_is_char: self.attacker_is_char,
                is_spell: self.is_spell,
                is_dot: self.is_dot,
                accuracy: self.accuracy,
                damage: self.damage,
                crit_bp: self.crit_bp,
                crit_multi: self.crit_multi,
                projectile: self.projectile,
                dot: self.dot,
                debuff: self.debuff.clone(),
                stagger: self.stagger,
                knockback_cu: self.knockback_cu,
            }
        }
    }
}

/// A socketed skill fully resolved into what a strike needs — typed damage
/// (weapon-scaled for attacks, gem-flat for spells), AoE geometry, dot,
/// debuff, crit, projectile flag — with supports and the attacker's stats
/// folded ONCE. Target-agnostic and side-effect-free, so the executor (and,
/// later, the DPS panel) read a single source of truth. `spec_template` is
/// cloned per victim via `clone_for_next_victim`.
pub(super) struct ResolvedSkill {
    pub spec_template: StrikeSpec,
    pub gem_def: idlin_content::GemDef,
    pub mods: SupportMods,
    pub range: Fx,
    pub radius: Fx,
    pub width: Fx,
}

type DeadList = Vec<(usize, u32)>;
type LootList = Vec<(FxV2, LootPayload, u32, String)>;

/// Skill-use error codes returned to bots (see docs/bot-guide.md).
pub(crate) const SKILL_ERR_SLOT: i32 = -1;
pub(crate) const SKILL_ERR_COOLDOWN: i32 = -2;
pub(crate) const SKILL_ERR_BUSY: i32 = -3;
pub(crate) const SKILL_ERR_MANA: i32 = -4;
pub(crate) const SKILL_ERR_RANGE: i32 = -5;
pub(crate) const SKILL_ERR_LOS: i32 = -6;
pub(crate) const SKILL_ERR_MODE: i32 = -7;
pub(crate) const SKILL_ERR_TARGET: i32 = -8;
pub(crate) const SKILL_ERR_WEAPON: i32 = -9;

/// The socketed gem a skill key refers to, for either kind of actor:
/// characters key by tree node (the intent stores the node id); monsters
/// key by index into their def-resolved kit.
pub(crate) fn skill_of(e: &crate::entity::Entity, key: u32) -> Option<&SocketedGem> {
    if let Some(ch) = &e.character {
        ch.sockets.get(&key)
    } else {
        e.monster.as_ref().and_then(|m| m.skills.get(key as usize))
    }
}

fn skill_of_mut(e: &mut crate::entity::Entity, key: u32) -> Option<&mut SocketedGem> {
    if let Some(ch) = e.character.as_mut() {
        ch.sockets.get_mut(&key)
    } else {
        e.monster
            .as_mut()
            .and_then(|m| m.skills.get_mut(key as usize))
    }
}

impl World {
    /// Fold the behavior effects of every support socketed into a skill.
    fn support_mods(&self, supports: &[GemInstance]) -> SupportMods {
        let mut m = SupportMods::default();
        for sup in supports {
            let def = &self.content.gems[sup.gem_idx as usize];
            for ef in &def.effects {
                match *ef {
                    SupportEffect::MoreDamage { dtype, bp } => {
                        let f = (10000 + bp).max(0);
                        match dtype {
                            Some(d) => m.more_bp[d.idx()] = m.more_bp[d.idx()] * f / 10000,
                            None => {
                                for v in m.more_bp.iter_mut() {
                                    *v = *v * f / 10000;
                                }
                            }
                        }
                    }
                    SupportEffect::AddedDamage { dtype, amount } => {
                        m.added[dtype.idx()] += amount.at(sup.level).max(0);
                    }
                    SupportEffect::IncAttackSpeed { bp } => m.attack_speed_bp += bp,
                    SupportEffect::IncCastSpeed { bp } => m.cast_speed_bp += bp,
                    SupportEffect::ExtraProjectiles { count } => m.extra_projectiles += count,
                    SupportEffect::Pierce { count } => m.pierce += count,
                    SupportEffect::AoeInc { bp } => m.aoe_bp += bp,
                    SupportEffect::DotDurationInc { bp } => m.dot_duration_bp += bp,
                    // Folded by skill_mana_cost, where the syscall check
                    // can reach it too.
                    SupportEffect::ManaMult { .. } => {}
                }
            }
        }
        m
    }

    /// Whether the character's wielded weapon satisfies a gem's weapon
    /// gate. Empty requirement = anything (spells, universal attacks);
    /// otherwise the wielded class must be listed — bare hands never are.
    pub(crate) fn weapon_eligible(
        &self,
        gem: &idlin_content::GemDef,
        ch: &crate::entity::CharacterState,
    ) -> bool {
        if gem.weapon_classes.is_empty() {
            return true;
        }
        ch.equipment[idlin_content::GearSlot::Weapon.idx()]
            .as_ref()
            .and_then(|item| self.content.items[item.base_idx as usize].weapon_class)
            .is_some_and(|class| gem.weapon_classes.contains(&class))
    }

    /// A skill's mana cost with support multipliers folded in. Shared by the
    /// syscall validation and the executor so they cannot disagree.
    pub(crate) fn skill_mana_cost(&self, sg: &SocketedGem) -> i64 {
        let gem = &self.content.gems[sg.gem.gem_idx as usize];
        let mut cost = gem.mana_cost.at(sg.gem.level).max(0);
        for sup in &sg.supports {
            for ef in &self.content.gems[sup.gem_idx as usize].effects {
                if let SupportEffect::ManaMult { bp } = *ef {
                    cost = cost * (10000 + bp).max(0) / 10000;
                }
            }
        }
        cost
    }

    /// Effective use-time commitment for one use of a socketed skill —
    /// support speed effects included. Shared by the executor and
    /// ReadSkills so the bot sees the same number the sim charges.
    pub(crate) fn skill_use_ticks(
        &self,
        sg: &SocketedGem,
        weapon_use: u32,
        cast_speed: i64,
    ) -> u64 {
        let gem = &self.content.gems[sg.gem.gem_idx as usize];
        let mods = self.support_mods(&sg.supports);
        if gem.skill_kind == SkillKind::Spell {
            let eff = cast_speed.max(1000) * (10000 + mods.cast_speed_bp).max(1000) / 10000;
            (gem.cast_ticks.max(2) as i64 * 10000 / eff.max(1000)).max(2) as u64
        } else {
            let eff = (10000 + mods.attack_speed_bp).max(1000);
            (weapon_use.max(2) as i64 * 10000 / eff).max(2) as u64
        }
    }

    /// Validate a skill use and queue the intent. The same checks rerun at
    /// execution (a tick later, the world may have moved), but validating
    /// here gives bots an honest, immediate diagnosis.
    pub(crate) fn try_use_skill(
        &mut self,
        slot: usize,
        skill_slot: i32,
        target: SkillTarget,
    ) -> i32 {
        use idlin_content::TargetMode;
        let now = self.tick;
        let Some(e) = self.zone.get(slot) else {
            return SKILL_ERR_SLOT;
        };
        let Some(c) = &e.combat else {
            return SKILL_ERR_SLOT;
        };
        if now < c.busy_until {
            return SKILL_ERR_BUSY;
        }
        let pos = e.pos;
        let my_faction = e.faction();

        let check_entity = |world: &World, id: u32, range: Fx| -> i32 {
            let Some(t) = world.zone.get_net(id) else {
                return SKILL_ERR_TARGET;
            };
            if !t.alive() || !my_faction.is_enemy_of(t.faction()) {
                return SKILL_ERR_TARGET;
            }
            if pos.dist(t.pos) > range {
                return SKILL_ERR_RANGE;
            }
            if world.los_blocked(pos, t.pos) {
                return SKILL_ERR_LOS;
            }
            0
        };

        let skill = if skill_slot <= 0 {
            // The basic weapon attack is always entity-aimed.
            let SkillTarget::Entity(id) = target else {
                return SKILL_ERR_MODE;
            };
            let code = check_entity(self, id, c.range);
            if code != 0 {
                return code;
            }
            None
        } else {
            // Characters: slot N = the Nth socketed tree node. Monsters:
            // slot N = the Nth entry of their def kit.
            let key = if let Some(ch) = &e.character {
                let nodes = self.skill_nodes(ch);
                match nodes.get(skill_slot as usize - 1) {
                    Some(&node) => node,
                    None => return SKILL_ERR_SLOT,
                }
            } else {
                skill_slot as u32 - 1
            };
            let Some(sg) = skill_of(e, key) else {
                return SKILL_ERR_SLOT;
            };
            if sg.cooldown_left > 0 {
                return SKILL_ERR_COOLDOWN;
            }
            let gem = &self.content.gems[sg.gem.gem_idx as usize];
            // Weapon gates are for the armed: a monster IS its weapon.
            if let Some(ch) = &e.character
                && !self.weapon_eligible(gem, ch)
            {
                return SKILL_ERR_WEAPON;
            }
            if c.mana < self.skill_mana_cost(sg) {
                return SKILL_ERR_MANA;
            }
            let mode_ok = matches!(
                (gem.target_mode, &target),
                (TargetMode::Entity, SkillTarget::Entity(_))
                    | (TargetMode::Point, SkillTarget::Point(_))
                    | (TargetMode::Direction, SkillTarget::Direction(_))
            );
            if !mode_ok {
                return SKILL_ERR_MODE;
            }
            let range = if gem.range_cu > 0 {
                fx_from_cu(gem.range_cu)
            } else {
                c.range
            };
            let radius = fx_from_cu(gem.radius_cu);
            match target {
                SkillTarget::Entity(id) => {
                    let code = check_entity(self, id, range);
                    if code != 0 {
                        return code;
                    }
                }
                SkillTarget::Point(p) => {
                    if pos.dist(p) > range + radius {
                        return SKILL_ERR_RANGE;
                    }
                    if self.los_blocked(pos, p) {
                        return SKILL_ERR_LOS;
                    }
                }
                SkillTarget::Direction(d) => {
                    let origin = FxV2::new(Fx::ZERO, Fx::ZERO);
                    if origin.dist(d).raw() <= 0x100 {
                        return SKILL_ERR_TARGET;
                    }
                }
            }
            Some(key)
        };

        if let Some(me) = self.zone.get_mut(slot) {
            me.intents.attack = Some(AttackIntent { target, skill });
            0
        } else {
            SKILL_ERR_SLOT
        }
    }

    pub(super) fn attacks(&mut self, events: &mut Vec<SimEvent>) {
        // Gem cooldowns tick down (the basic weapon is governed by the
        // use-time commitment, busy_until, instead).
        for slot in 0..self.zone.slot_count() {
            if let Some(e) = self.zone.get_mut(slot) {
                if let Some(ch) = e.character.as_mut() {
                    for sg in ch.sockets.values_mut() {
                        sg.cooldown_left = sg.cooldown_left.saturating_sub(1);
                    }
                }
                if let Some(m) = e.monster.as_mut() {
                    for sg in m.skills.iter_mut() {
                        sg.cooldown_left = sg.cooldown_left.saturating_sub(1);
                    }
                }
            }
        }

        let mut dead: DeadList = Vec::new();
        let mut loot: LootList = Vec::new();
        let now = self.tick;

        // Phase 1: CONTACT. Windups committed earlier resolve now, with
        // the target re-validated fresh — a victim that died or stepped
        // away makes the blow WHIFF (the mana and time were already
        // paid; that is what commitment means). Slow heavy swings are
        // dodgeable, and the client's contact frame is TRUE.
        let mut due: Vec<PendingUse> = Vec::new();
        self.pending_uses.retain(|p| {
            if p.resolve_at <= now {
                due.push(*p);
                false
            } else {
                true
            }
        });
        for p in due {
            let Some(slot) = self.zone.slot_of(p.attacker) else {
                continue; // departed or removed mid-windup
            };
            if !self.zone.get(slot).is_some_and(|e| e.alive()) {
                continue; // died winding up
            }
            self.resolve_use(slot, p.target, p.skill, events, &mut dead, &mut loot);
        }

        // Phase 2: STARTS. Commit new uses (mana, cooldown, busy) and
        // announce them — the client plays the windup from here.
        self.start_uses(events);

        self.finish_kills(dead, loot, events);
    }

    /// Resolve a socketed skill to everything a strike needs, with supports and
    /// the attacker's stats folded once. Target-agnostic and side-effect-free —
    /// the executor assembles every gem strike from this. `None` if the slot has
    /// no combatant, the key isn't socketed, or it isn't a skill gem.
    pub(super) fn resolve_skill(&self, slot: usize, skill_key: u32) -> Option<ResolvedSkill> {
        let e = self.zone.get(slot)?;
        let c = e.combat.as_ref()?;
        let attacker_net = e.net_id;
        let attacker_name = match (&e.character, &e.monster) {
            (Some(ch), _) => ch.name.clone(),
            (_, Some(m)) => self.monster_def(m.def_idx).name.clone(),
            _ => return None,
        };
        let attacker_is_char = e.character.is_some();
        let char_damage = c.damage;
        let (accuracy, weapon_range) = (c.accuracy, c.range);
        let (crit_inc, crit_multi) = (c.crit_inc, c.crit_multi);
        let (a_stagger, a_knockback) = (c.stagger, c.knockback_cu);

        let sg = skill_of(e, skill_key)?;
        let gem_def = self.content.gems[sg.gem.gem_idx as usize].clone();
        if gem_def.kind != GemKind::Skill {
            return None;
        }
        let gem_idx = sg.gem.gem_idx;
        let level = sg.gem.level;
        let is_spell = gem_def.skill_kind == SkillKind::Spell;

        // Supports: behavior effects folded down, plus legacy stat grants on a
        // per-use sheet.
        let mods = self.support_mods(&sg.supports);

        let mut sheet = StatSheet::new();
        for sup in &sg.supports {
            let sdef = &self.content.gems[sup.gem_idx as usize];
            for g in &sdef.grants {
                sheet.apply(g);
            }
        }

        // Damage: attacks scale the weapon plus the gem's own flat; spells are
        // the gem's flat alone.
        let added = [
            gem_def.added_phys.at(level),
            gem_def.added_fire.at(level),
            gem_def.added_cold.at(level),
            gem_def.added_lightning.at(level),
            gem_def.added_chaos.at(level),
        ];
        let stats = [
            Stat::DamagePhys,
            Stat::DamageFire,
            Stat::DamageCold,
            Stat::DamageLightning,
            Stat::DamageChaos,
        ];
        let mut damage = [0i64; DMG_COUNT];
        for i in 0..DMG_COUNT {
            let weapon_part = if is_spell {
                0
            } else {
                char_damage[i] * gem_def.coeff_bp / 10000
            };
            damage[i] = sheet.value(stats[i], weapon_part + added[i] + mods.added[i]);
            damage[i] = damage[i] * mods.more_bp[i] / 10000;
        }

        // AoE supports grow the skill's footprint: ring radius, corridor width,
        // and (for cones) the sector's reach.
        let aoe = |cu: i32| (cu as i64 * (10000 + mods.aoe_bp).max(0) / 10000) as i32;
        let mut range = if gem_def.range_cu > 0 {
            fx_from_cu(gem_def.range_cu)
        } else {
            weapon_range
        };
        if gem_def.shape == SkillShape::Cone && mods.aoe_bp != 0 {
            range =
                Fx::from_raw((range.raw() as i64 * (10000 + mods.aoe_bp).max(0) / 10000) as i32);
        }
        let radius = fx_from_cu(aoe(gem_def.radius_cu));
        let width = fx_from_cu(aoe(gem_def.width_cu));
        let dot = gem_def.dot.map(|d| {
            (
                d.dtype.idx() as u8,
                d.per_second.at(level).max(0),
                (d.duration_ticks as i64 * (10000 + mods.dot_duration_bp).max(0) / 10000) as u32,
                gem_idx,
            )
        });
        let debuff = gem_def.debuff.clone().map(|b| {
            (
                b.grants,
                (b.duration_ticks as i64 * (10000 + mods.dot_duration_bp).max(0) / 10000) as u32,
            )
        });
        let spec_template = StrikeSpec {
            attacker_slot: Some(slot),
            attacker_net,
            attacker_name,
            attacker_is_char,
            is_spell,
            is_dot: false,
            accuracy,
            damage,
            crit_bp: gem_def.crit_bp * crit_inc / 10000,
            crit_multi,
            projectile: gem_def.shape == SkillShape::Projectile,
            dot,
            debuff,
            stagger: a_stagger,
            knockback_cu: a_knockback,
        };

        Some(ResolvedSkill {
            spec_template,
            gem_def,
            mods,
            range,
            radius,
            width,
        })
    }

    /// Computed inspect-sheet readout for one socketed skill (#19). Reuses the
    /// executor's own `resolve_skill` + `skill_use_ticks` + `skill_mana_cost`,
    /// so the panel's numbers can never drift from what the sim charges and
    /// deals. Side-effect-free. (Lives here because it reads `SupportMods`,
    /// which is private to this module.)
    pub(super) fn skill_stat_view(
        &self,
        slot: usize,
        key: u32,
    ) -> Option<super::views::SkillStatView> {
        let resolved = self.resolve_skill(slot, key)?;
        let e = self.zone.get(slot)?;
        let c = e.combat.as_ref()?;
        let sg = skill_of(e, key)?;
        let gem = &resolved.gem_def;
        let spec = &resolved.spec_template;
        let mods = &resolved.mods;

        let use_ticks = self.skill_use_ticks(sg, c.use_ticks, c.cast_speed) as u32;
        let mana_cost = self.skill_mana_cost(sg);

        // Effective crit chance: globally-scaled, then capped exactly as the
        // executor caps the roll — so the panel never promises crit the sim
        // won't deliver.
        let crit_chance_bp = spec.crit_bp.min(CRIT_CHANCE_CAP_BP);
        // Average per-hit multiplier including crit: 1 + chance × (multi − 1),
        // in basis points.
        let crit_factor_bp = 10000 + crit_chance_bp * (spec.crit_multi - 10000) / 10000;
        let total: i64 = spec.damage.iter().sum();
        // Σdamage × crit factor × hits/sec; hit variance averages to 100%.
        let dps = if total > 0 && use_ticks > 0 {
            total * crit_factor_bp * super::TICK_HZ as i64 / (10000 * use_ticks as i64)
        } else {
            0
        };

        // Content units back out of Q16.16 (inverse of fx_from_cu).
        let cu = |f: Fx| (f.raw() as i64 * 100 / 65536) as i32;
        let (dot_per_sec, dot_duration_ticks) = match spec.dot {
            Some((_, per_sec, dur, _)) => (per_sec, dur),
            None => (0, 0),
        };
        let buff_duration_ticks = gem.buff.as_ref().map_or(0, |b| {
            (b.duration_ticks as i64 * (10000 + mods.dot_duration_bp).max(0) / 10000) as u32
        });
        let debuff_duration_ticks = spec.debuff.as_ref().map_or(0, |(_, d)| *d);
        let projectiles = if gem.shape == SkillShape::Projectile {
            1 + mods.extra_projectiles
        } else {
            0
        };
        let shape = match gem.shape {
            SkillShape::Target => "target",
            SkillShape::Nova => "nova",
            SkillShape::Cone => "cone",
            SkillShape::Line => "line",
            SkillShape::PointAoe => "point_aoe",
            SkillShape::Projectile => "projectile",
        };
        let gem_next = |level: u32| {
            if level >= crate::entity::GEM_LEVEL_CAP {
                0
            } else {
                crate::entity::gem_xp_to_next(level)
            }
        };
        let supports = sg
            .supports
            .iter()
            .map(|s| {
                (
                    self.content.gems[s.gem_idx as usize].name.clone(),
                    s.level,
                    s.xp,
                    gem_next(s.level),
                )
            })
            .collect();
        Some(super::views::SkillStatView {
            name: self.content.gems[sg.gem.gem_idx as usize].name.clone(),
            level: sg.gem.level,
            xp: sg.gem.xp,
            xp_next: gem_next(sg.gem.level),
            is_spell: gem.skill_kind == SkillKind::Spell,
            shape,
            damage: spec.damage,
            dps,
            crit_chance_bp,
            crit_multi_bp: spec.crit_multi,
            use_ticks,
            cooldown_ticks: gem.cooldown_ticks,
            mana_cost,
            range_cu: cu(resolved.range),
            radius_cu: cu(resolved.radius),
            width_cu: cu(resolved.width),
            projectiles,
            pierce: gem.pierce + mods.pierce,
            dot_per_sec,
            dot_duration_ticks,
            buff_duration_ticks,
            debuff_duration_ticks,
            supports,
        })
    }

    /// Resolve one committed use at its contact tick. Costs were paid at
    /// start; every guard here is a WHIFF, not a refusal.
    fn resolve_use(
        &mut self,
        slot: usize,
        target: SkillTarget,
        skill: Option<u32>,
        events: &mut Vec<SimEvent>,
        dead: &mut DeadList,
        loot: &mut LootList,
    ) {
        let now = self.tick;
        let Some(e) = self.zone.get(slot) else {
            return;
        };
        let Some(c) = &e.combat else { return };
        let attacker_net = e.net_id;
        let attacker_faction = e.faction();
        let attacker_name = match (&e.character, &e.monster) {
            (Some(ch), _) => ch.name.clone(),
            (_, Some(m)) => self.monster_def(m.def_idx).name.clone(),
            _ => return,
        };
        let attacker_is_char = e.character.is_some();
        let pos = e.pos;
        let (char_damage, accuracy, weapon_range, weapon_projectile, _weapon_use) =
            (c.damage, c.accuracy, c.range, c.projectile, c.use_ticks);
        let (crit_inc, crit_multi, _cast_speed) = (c.crit_inc, c.crit_multi, c.cast_speed);
        let (a_stagger, a_knockback) = (c.stagger, c.knockback_cu);
        let hostile_to_players = matches!(attacker_faction, crate::entity::Faction::Hostile);

        match skill {
            None => {
                // Basic weapon attack: always entity-aimed.
                let SkillTarget::Entity(target_id) = target else {
                    return;
                };
                let Some(target_slot) = self.zone.slot_of(target_id) else {
                    return; // whiff: the victim is gone
                };
                let Some(t) = self.zone.get(target_slot) else {
                    return;
                };
                // Half-range GRACE on contact: the windup was
                // committed in range — only a real escape (or a slow
                // heavy telegraph walked out of) whiffs it.
                let grace = Fx::from_raw(weapon_range.raw() + weapon_range.raw() / 2);
                if !t.alive()
                    || !attacker_faction.is_enemy_of(t.faction())
                    || pos.dist(t.pos) > grace
                    || self.los_blocked(pos, t.pos)
                {
                    return; // whiff
                }
                let spec = StrikeSpec {
                    attacker_slot: Some(slot),
                    attacker_net,
                    attacker_name,
                    attacker_is_char,
                    is_spell: false,
                    is_dot: false,
                    accuracy,
                    damage: char_damage,
                    crit_bp: BASIC_CRIT_BP * crit_inc / 10000,
                    crit_multi,
                    projectile: weapon_projectile,
                    dot: None,
                    debuff: None,
                    stagger: a_stagger,
                    knockback_cu: a_knockback,
                };
                if weapon_projectile {
                    let toward = t.pos;
                    self.launch_projectile(
                        pos,
                        toward,
                        spec,
                        BASIC_PROJ_SPEED_CPS,
                        weapon_range + Fx::from_int(2),
                        0,
                        hostile_to_players,
                        events,
                    );
                } else {
                    self.strike(spec, target_slot, now, events, dead, loot);
                }
            }
            Some(node) => {
                // Socketed skill gem — a character's tree socket or a monster's
                // def kit; one executor for both. Cooldown and mana were paid at
                // the START of the use; the strike is assembled from the one
                // shared resolver (so the DPS panel can read the same numbers).
                let Some(resolved) = self.resolve_skill(slot, node) else {
                    return;
                };
                if let Some(ch) = &e.character
                    && !self.weapon_eligible(&resolved.gem_def, ch)
                {
                    return; // disarmed mid-windup: the blow whiffs
                }
                let ResolvedSkill {
                    spec_template,
                    gem_def,
                    mods,
                    range,
                    radius,
                    width,
                } = resolved;

                // Aim: where is this skill pointed?
                let aim_point: Option<FxV2> = match target {
                    SkillTarget::Entity(id) => {
                        self.zone.get_net(id).filter(|t| t.alive()).map(|t| t.pos)
                    }
                    SkillTarget::Point(p) => Some(p),
                    SkillTarget::Direction(d) => {
                        let origin = FxV2::new(Fx::ZERO, Fx::ZERO);
                        let len = origin.dist(d);
                        if len.raw() <= 0x100 {
                            None
                        } else {
                            let f = Fx::ONE / len;
                            Some(FxV2::new(pos.x + d.x * f * range, pos.y + d.y * f * range))
                        }
                    }
                };
                let Some(aim_point) = aim_point else { return };
                let dir_len = pos.dist(aim_point);
                let dir_n = if dir_len > Fx::from_raw(0x100) {
                    let f = Fx::ONE / dir_len;
                    FxV2::new((aim_point.x - pos.x) * f, (aim_point.y - pos.y) * f)
                } else {
                    FxV2::new(Fx::ONE, Fx::ZERO)
                };

                let mut swung = false;
                match gem_def.shape {
                    SkillShape::Target => {
                        // Same half-range contact grace as basic
                        // attacks: committed in range, only a real
                        // escape whiffs.
                        let grace = Fx::from_raw(range.raw() + range.raw() / 2);
                        if let SkillTarget::Entity(id) = target
                            && let Some(ts) = self.zone.slot_of(id)
                            && let Some(t) = self.zone.get(ts)
                            && t.alive()
                            && attacker_faction.is_enemy_of(t.faction())
                            && pos.dist(t.pos) <= grace
                            && !self.los_blocked(pos, t.pos)
                        {
                            let spec = spec_template.clone_for_next_victim();
                            self.strike(spec, ts, now, events, dead, loot);
                            swung = true;
                        }
                    }
                    SkillShape::Nova => {
                        // Pure-utility novas (War Cry) carry no damage
                        // and strike nobody — riders still fire below.
                        if spec_template.damage.iter().any(|d| *d > 0) {
                            let victims = self.collect_victims_radius(
                                pos,
                                radius,
                                attacker_faction,
                                gem_def.max_targets,
                                Some(pos),
                            );
                            for ts in victims {
                                let spec = spec_template.clone_for_next_victim();
                                self.strike(spec, ts, now, events, dead, loot);
                            }
                        }
                        swung = true; // the sweep happens even on air
                    }
                    SkillShape::PointAoe => {
                        if pos.dist(aim_point) <= range + radius
                            && !self.los_blocked(pos, aim_point)
                        {
                            let victims = self.collect_victims_radius(
                                aim_point,
                                radius,
                                attacker_faction,
                                gem_def.max_targets,
                                None,
                            );
                            for ts in victims {
                                let spec = spec_template.clone_for_next_victim();
                                self.strike(spec, ts, now, events, dead, loot);
                            }
                            swung = true; // the blast happens even on air
                        }
                    }
                    SkillShape::Cone | SkillShape::Line => {
                        let victims = self.collect_victims_directional(
                            pos,
                            dir_n,
                            range,
                            gem_def.shape,
                            gem_def.cone_cos_bp,
                            width,
                            attacker_faction,
                            gem_def.max_targets,
                        );
                        for ts in victims {
                            let spec = spec_template.clone_for_next_victim();
                            self.strike(spec, ts, now, events, dead, loot);
                        }
                        swung = true; // the sweep happens even on air
                    }
                    SkillShape::Projectile => {
                        // Extra projectiles fan out in 12-degree steps
                        // around the aimed direction.
                        for i in 0..=mods.extra_projectiles {
                            let d = rotate_fan(dir_n, fan_step(i));
                            let toward = FxV2::new(pos.x + d.x * range, pos.y + d.y * range);
                            let spec = spec_template.clone_for_next_victim();
                            self.launch_projectile(
                                pos,
                                toward,
                                spec,
                                gem_def.proj_speed_cps.max(400),
                                range,
                                gem_def.pierce + mods.pierce,
                                hostile_to_players,
                                events,
                            );
                        }
                        swung = true;
                    }
                }

                if swung {
                    // Buff rider: self always, plus allies inside the
                    // skill's radius (War Cry rallies the line). The
                    // duration support stretches it like other riders.
                    if let Some(buff) = gem_def.buff.clone() {
                        let duration = (buff.duration_ticks as i64
                            * (10000 + mods.dot_duration_bp).max(0)
                            / 10000) as u32;
                        self.apply_buff(slot, buff.grants.clone(), duration);
                        if radius.raw() > 0 {
                            let rr = radius.raw() as i64 * radius.raw() as i64;
                            let allies: Vec<usize> = self
                                .zone
                                .iter()
                                .filter(|(s, a)| {
                                    *s != slot
                                        && a.alive()
                                        && a.faction() == attacker_faction
                                        && a.combat.is_some()
                                        && {
                                            let dx = (a.pos.x - pos.x).raw() as i64;
                                            let dy = (a.pos.y - pos.y).raw() as i64;
                                            dx * dx + dy * dy <= rr
                                        }
                                })
                                .map(|(s, _)| s)
                                .collect();
                            for ally in allies {
                                self.apply_buff(ally, buff.grants.clone(), duration);
                            }
                        }
                    }
                    // Cast/swing FX for non-projectile shapes (the fan
                    // announces itself via ProjectileSpawned).
                    if gem_def.shape != SkillShape::Projectile {
                        let shape_code = match gem_def.shape {
                            SkillShape::Target => 0u8,
                            SkillShape::Nova => 1,
                            SkillShape::Cone => 2,
                            SkillShape::Line => 3,
                            _ => 4,
                        };
                        let anchor = if gem_def.shape == SkillShape::PointAoe {
                            aim_point
                        } else {
                            pos
                        };
                        let mut dtype = 0usize;
                        for i in 1..DMG_COUNT {
                            if spec_template.damage[i] > spec_template.damage[dtype] {
                                dtype = i;
                            }
                        }
                        // Lines report their corridor width in the
                        // radius field (it's the visual footprint).
                        let fx_radius = if gem_def.shape == SkillShape::Line {
                            width
                        } else {
                            radius
                        };
                        events.push(SimEvent::SkillFx {
                            attacker: attacker_net,
                            spell: spec_template.is_spell,
                            shape: shape_code,
                            x: anchor.x.raw(),
                            y: anchor.y.raw(),
                            dx: dir_n.x.raw(),
                            dy: dir_n.y.raw(),
                            radius: fx_radius.raw(),
                            range: range.raw(),
                            dmg_type: dtype as u8,
                        });
                    }
                }
                let _ = swung; // air swings still spent their windup
            }
        }
    }

    /// Phase 2 of attacks(): COMMIT new uses. An entity with an attack
    /// intent, off busy, pays everything UP FRONT (mana, cooldown, the
    /// use-time itself) and announces the windup — the strike resolves
    /// at the contact tick (~60% through an attack; cast end for
    /// spells), where the target is judged fresh.
    fn start_uses(&mut self, events: &mut Vec<SimEvent>) {
        let now = self.tick;
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if !e.alive() {
                continue;
            }
            let Some(AttackIntent { target, skill }) = e.intents.attack else {
                continue;
            };
            let Some(c) = &e.combat else { continue };
            if now < c.busy_until {
                continue; // mid-swing/cast: committed
            }
            let attacker_net = e.net_id;
            let attacker_faction = e.faction();
            let pos = e.pos;
            let (weapon_range, weapon_use, cast_speed) = (c.range, c.use_ticks, c.cast_speed);

            // What does this use cost, how long does it take, and where
            // is it aimed? Refusals here are FREE (nothing committed).
            let (is_spell, cost, busy_ticks, cooldown, aim): (bool, i64, u64, u32, FxV2) =
                match skill {
                    None => {
                        // Basic attack: commit only against a live,
                        // visible, in-range enemy — bots don't pay for
                        // swings at air.
                        let SkillTarget::Entity(target_id) = target else {
                            continue;
                        };
                        let Some(t) = self.zone.get_net(target_id) else {
                            continue;
                        };
                        if !t.alive()
                            || !attacker_faction.is_enemy_of(t.faction())
                            || pos.dist(t.pos) > weapon_range
                            || self.los_blocked(pos, t.pos)
                        {
                            continue;
                        }
                        (false, 0, weapon_use as u64, 0, t.pos)
                    }
                    Some(node) => {
                        let Some(sg) = skill_of(e, node) else {
                            continue;
                        };
                        if sg.cooldown_left > 0 {
                            continue;
                        }
                        let gem_def = &self.content.gems[sg.gem.gem_idx as usize];
                        if gem_def.kind != GemKind::Skill {
                            continue;
                        }
                        if let Some(ch) = &e.character
                            && !self.weapon_eligible(gem_def, ch)
                        {
                            continue;
                        }
                        let cost = self.skill_mana_cost(sg);
                        if cost > 0 && c.mana < cost {
                            continue;
                        }
                        let busy_ticks = self.skill_use_ticks(sg, weapon_use, cast_speed);
                        let range = if gem_def.range_cu > 0 {
                            fx_from_cu(gem_def.range_cu)
                        } else {
                            weapon_range
                        };
                        // Aim must resolve NOW (the windup needs a
                        // facing); entity aims also gate on validity so
                        // a dead target refuses the commit for free.
                        let aim = match target {
                            SkillTarget::Entity(id) => {
                                let Some(t) = self.zone.get_net(id) else {
                                    continue;
                                };
                                if !t.alive() {
                                    continue;
                                }
                                if gem_def.shape == SkillShape::Target
                                    && (!attacker_faction.is_enemy_of(t.faction())
                                        || pos.dist(t.pos) > range
                                        || self.los_blocked(pos, t.pos))
                                {
                                    continue;
                                }
                                t.pos
                            }
                            SkillTarget::Point(p) => {
                                // Point blasts refuse unreachable aims
                                // for free (same gate the old resolve
                                // applied before swinging).
                                if gem_def.shape == SkillShape::PointAoe
                                    && (pos.dist(p) > range + fx_from_cu(gem_def.radius_cu)
                                        || self.los_blocked(pos, p))
                                {
                                    continue;
                                }
                                p
                            }
                            SkillTarget::Direction(d) => {
                                let origin = FxV2::new(Fx::ZERO, Fx::ZERO);
                                if origin.dist(d).raw() <= 0x100 {
                                    continue;
                                }
                                FxV2::new(pos.x + d.x, pos.y + d.y)
                            }
                        };
                        (
                            gem_def.skill_kind == SkillKind::Spell,
                            cost,
                            busy_ticks,
                            gem_def.cooldown_ticks,
                            aim,
                        )
                    }
                };

            // Contact: spells land their effect when the cast completes;
            // attacks connect ~60% through the swing, recovery after.
            let busy_ticks = busy_ticks.max(1);
            let contact = if is_spell {
                busy_ticks
            } else {
                (busy_ticks * 3 / 5).max(1)
            };

            // COMMIT: everything is paid here, refunds don't exist.
            if let Some(me) = self.zone.get_mut(slot) {
                if let Some(c) = me.combat.as_mut() {
                    if cost > 0 {
                        c.mana = (c.mana - cost).max(0);
                    }
                    c.busy_until = now + busy_ticks;
                    c.last_combat_tick = now;
                }
                if cooldown > 0
                    && let Some(node) = skill
                    && let Some(sg) = skill_of_mut(me, node)
                {
                    sg.cooldown_left = cooldown;
                }
            }
            self.pending_uses.push(PendingUse {
                attacker: attacker_net,
                target,
                skill,
                resolve_at: now + contact,
            });
            events.push(SimEvent::UseStarted {
                id: attacker_net,
                spell: is_spell,
                x: aim.x.raw(),
                y: aim.y.raw(),
                use_ticks: busy_ticks as u32,
                contact_ticks: contact as u32,
            });
        }
    }

    /// Living enemies of `faction` within `radius` of `center`, nearest
    /// first, capped; optional line-of-sight origin (novas check from the
    /// caster, point blasts don't).
    fn collect_victims_radius(
        &self,
        center: FxV2,
        radius: Fx,
        faction: crate::entity::Faction,
        max_targets: u32,
        los_from: Option<FxV2>,
    ) -> Vec<usize> {
        let rr = radius.raw() as i64 * radius.raw() as i64;
        let mut found: Vec<(i64, u32, usize)> = Vec::new();
        for (ts, te) in self.zone.iter() {
            if !te.alive() || !faction.is_enemy_of(te.faction()) {
                continue;
            }
            let dx = (te.pos.x - center.x).raw() as i64;
            let dy = (te.pos.y - center.y).raw() as i64;
            let d2 = dx * dx + dy * dy;
            if d2 > rr {
                continue;
            }
            if let Some(origin) = los_from
                && self.los_blocked(origin, te.pos)
            {
                continue;
            }
            found.push((d2, te.net_id, ts));
        }
        found.sort_unstable();
        found
            .into_iter()
            .take(max_targets as usize)
            .map(|(_, _, ts)| ts)
            .collect()
    }

    /// Living enemies inside a cone or line from `origin` along `dir_n`
    /// (normalized), nearest first, capped. Integer sector/corridor tests.
    #[allow(clippy::too_many_arguments)]
    fn collect_victims_directional(
        &self,
        origin: FxV2,
        dir_n: FxV2,
        range: Fx,
        shape: SkillShape,
        cone_cos_bp: i64,
        width: Fx,
        faction: crate::entity::Faction,
        max_targets: u32,
    ) -> Vec<usize> {
        let range_raw = range.raw() as i64;
        let rr = range_raw * range_raw;
        let (nx, ny) = (dir_n.x.raw() as i64, dir_n.y.raw() as i64); // ~±65536
        let mut found: Vec<(i64, u32, usize)> = Vec::new();
        for (ts, te) in self.zone.iter() {
            if !te.alive() || !faction.is_enemy_of(te.faction()) {
                continue;
            }
            let tx = (te.pos.x - origin.x).raw() as i64;
            let ty = (te.pos.y - origin.y).raw() as i64;
            let d2 = tx * tx + ty * ty;
            if d2 > rr || d2 == 0 {
                continue;
            }
            let dot = nx * tx + ny * ty; // |to| scaled by 65536
            if dot <= 0 {
                continue; // behind us
            }
            let body = te
                .combat
                .as_ref()
                .map(|c| c.radius.raw() as i64)
                .unwrap_or(0);
            let inside = match shape {
                SkillShape::Cone => {
                    // dot/65536 ≥ (cos_bp/10000)·|to|  ⇔ compare squares.
                    let lhs = dot / 65536;
                    lhs * lhs * 10000 >= cone_cos_bp * cone_cos_bp / 10000 * d2
                }
                SkillShape::Line => {
                    let cross = (nx * ty - ny * tx).abs() / 65536;
                    cross <= (width.raw() as i64) / 2 + body
                }
                _ => false,
            };
            if !inside || self.los_blocked(origin, te.pos) {
                continue;
            }
            found.push((d2, te.net_id, ts));
        }
        found.sort_unstable();
        found
            .into_iter()
            .take(max_targets as usize)
            .map(|(_, _, ts)| ts)
            .collect()
    }

    /// Spawn a traveling projectile aimed from `from` toward `toward`.
    #[allow(clippy::too_many_arguments)]
    fn launch_projectile(
        &mut self,
        from: FxV2,
        toward: FxV2,
        spec: StrikeSpec,
        speed_cps: i32,
        range: Fx,
        pierce: u32,
        hostile_to_players: bool,
        events: &mut Vec<SimEvent>,
    ) {
        let len = from.dist(toward);
        let dir_n = if len > Fx::from_raw(0x100) {
            let f = Fx::ONE / len;
            FxV2::new((toward.x - from.x) * f, (toward.y - from.y) * f)
        } else {
            FxV2::new(Fx::ONE, Fx::ZERO)
        };
        let per_tick = super::speed_from_cps(speed_cps);
        let vel = FxV2::new(dir_n.x * per_tick, dir_n.y * per_tick);
        // Dominant payload type colors the client's tracer.
        let mut dtype = 0u8;
        for i in 1..DMG_COUNT {
            if spec.damage[i] > spec.damage[dtype as usize] {
                dtype = i as u8;
            }
        }
        events.push(SimEvent::ProjectileSpawned {
            attacker: spec.attacker_net,
            spell: spec.is_spell,
            x: from.x.raw(),
            y: from.y.raw(),
            vx: vel.x.raw(),
            vy: vel.y.raw(),
            range: range.raw(),
            dmg_type: dtype,
        });
        self.zone.projectiles.push(Projectile {
            pos: from,
            vel,
            remaining: range,
            radius: fx_from_cu(PROJ_RADIUS_CU),
            source: spec.attacker_net,
            source_name: spec.attacker_name,
            source_is_char: spec.attacker_is_char,
            hostile_to_players,
            spell: spec.is_spell,
            accuracy: spec.accuracy,
            damage: spec.damage,
            crit_bp: spec.crit_bp,
            crit_multi: spec.crit_multi,
            pierce,
            already_hit: Vec::new(),
            dot: spec.dot,
            debuff: spec.debuff,
            stagger: spec.stagger,
            knockback_cu: spec.knockback_cu,
        });
    }

    /// Fly every projectile one tick: walls stop them, enemies caught in the
    /// sweep take strikes (pierce passes through), budget expiry ends them.
    pub(super) fn step_projectiles(&mut self, events: &mut Vec<SimEvent>) {
        if self.zone.projectiles.is_empty() {
            return;
        }
        let now = self.tick;
        let mut dead: DeadList = Vec::new();
        let mut loot: LootList = Vec::new();

        let mut projectiles = std::mem::take(&mut self.zone.projectiles);
        let mut keep: Vec<Projectile> = Vec::with_capacity(projectiles.len());
        for mut p in projectiles.drain(..) {
            let prev = p.pos;
            let next = FxV2::new(prev.x + p.vel.x, prev.y + p.vel.y);
            let step = prev.dist(next);
            p.pos = next;
            #[allow(clippy::assign_op_pattern)]
            {
                p.remaining = p.remaining - step;
            }
            // Walls stop arrows.
            if self.los_blocked(prev, p.pos) {
                continue;
            }
            // Collisions: nearest first, honoring pierce.
            let mut alive = true;
            loop {
                let mut best: Option<(i64, u32, usize)> = None;
                for (ts, te) in self.zone.iter() {
                    if !te.alive() {
                        continue;
                    }
                    let is_enemy = if p.hostile_to_players {
                        te.character.is_some()
                    } else {
                        te.monster.as_ref().is_some_and(|m| m.hostile)
                    };
                    if !is_enemy || p.already_hit.contains(&te.net_id) {
                        continue;
                    }
                    let reach = te.combat.as_ref().map(|c| c.radius).unwrap_or(Fx::ZERO) + p.radius;
                    // SWEPT test: closest approach of the whole tick's
                    // travel segment to the target, not just the endpoint —
                    // an endpoint check tunnels through small targets when
                    // the per-tick step exceeds the combined radii (fast
                    // arrows sailed clean through skeletons). Coordinates
                    // downshift 8 bits so every product fits i64; ordering
                    // is by first contact ALONG the flight, then net id.
                    const S: i64 = 8;
                    let ax = (prev.x.raw() as i64) >> S;
                    let ay = (prev.y.raw() as i64) >> S;
                    let bx = (p.pos.x.raw() as i64) >> S;
                    let by = (p.pos.y.raw() as i64) >> S;
                    let ox = (te.pos.x.raw() as i64) >> S;
                    let oy = (te.pos.y.raw() as i64) >> S;
                    let (dx, dy) = (bx - ax, by - ay);
                    let len2 = (dx * dx + dy * dy).max(1);
                    let dot = ((ox - ax) * dx + (oy - ay) * dy).clamp(0, len2);
                    let tq = (dot << 16) / len2;
                    let cx = ax + ((dx * tq) >> 16);
                    let cy = ay + ((dy * tq) >> 16);
                    let (ddx, ddy) = (ox - cx, oy - cy);
                    let d2 = ddx * ddx + ddy * ddy;
                    let r = (reach.raw() as i64) >> S;
                    if d2 <= r * r && best.is_none_or(|(bt, bn, _)| (tq, te.net_id) < (bt, bn)) {
                        best = Some((tq, te.net_id, ts));
                    }
                }
                let Some((_, net, ts)) = best else { break };
                let spec = StrikeSpec {
                    attacker_slot: self.zone.slot_of(p.source),
                    attacker_net: p.source,
                    attacker_name: p.source_name.clone(),
                    attacker_is_char: p.source_is_char,
                    is_spell: p.spell,
                    is_dot: false,
                    accuracy: p.accuracy,
                    damage: p.damage,
                    crit_bp: p.crit_bp,
                    crit_multi: p.crit_multi,
                    projectile: true,
                    dot: p.dot,
                    debuff: p.debuff.clone(),
                    stagger: p.stagger,
                    knockback_cu: p.knockback_cu,
                };
                self.strike(spec, ts, now, events, &mut dead, &mut loot);
                p.already_hit.push(net);
                if p.pierce == 0 {
                    alive = false;
                    break;
                }
                p.pierce -= 1;
            }
            if alive && p.remaining.raw() > 0 {
                keep.push(p);
            }
        }
        self.zone.projectiles = keep;

        self.finish_kills(dead, loot, events);
    }

    /// One landed strike. See the module docs for the pipeline order.
    /// Knock the victim back along the hit line, stopping at walls and
    /// shut gates — a real displacement, deterministic, in small steps.
    fn shove(&mut self, slot: usize, from: FxV2, at: FxV2, dist_cu: i64) {
        let len = from.dist(at);
        let (dx, dy) = if len > Fx::from_raw(0x100) {
            let f = Fx::ONE / len;
            ((at.x - from.x) * f, (at.y - from.y) * f)
        } else {
            return; // point-blank overlap: no meaningful direction
        };
        let total = fx_from_cu(dist_cu.min(150) as i32);
        let step = Fx::from_raw(total.raw() / 4);
        let Some(e) = self.zone.get(slot) else { return };
        let mut pos = e.pos;
        for _ in 0..4 {
            let cand = self
                .zone
                .clamp_pos(FxV2::new(pos.x + dx * step, pos.y + dy * step));
            let (cx, cy) = (
                (cand.x.raw() as i64).div_euclid(65536),
                (cand.y.raw() as i64).div_euclid(65536),
            );
            if self.zone.cell_blocked(cx, cy) {
                break;
            }
            pos = cand;
        }
        if let Some(e) = self.zone.get_mut(slot) {
            e.pos = pos;
        }
    }

    pub(super) fn strike(
        &mut self,
        spec: StrikeSpec,
        target_slot: usize,
        now: u64,
        events: &mut Vec<SimEvent>,
        dead_monsters: &mut DeadList,
        loot_spawns: &mut LootList,
    ) {
        let Some(t) = self.zone.get(target_slot) else {
            return;
        };
        if !t.alive() {
            return; // an earlier strike this phase may have killed it
        }
        let target_net = t.net_id;
        let target_pos = t.pos;
        let tc_ro = t.combat.as_ref().unwrap();
        let (t_evasion, t_armour, t_resists, t_block) =
            (tc_ro.evasion, tc_ro.armour, tc_ro.resists, tc_ro.block);
        let (t_life_max, t_poise) = (tc_ro.life_max, tc_ro.poise);

        // Accuracy: attacks can miss; spells and dots cannot.
        let mut hit = spec.is_spell
            || spec.is_dot
            || (self.rng_combat.next_range(10000) as i64) < hit_chance_bp(spec.accuracy, t_evasion);
        // Block: a shield can negate the whole hit (not steady burns).
        if hit
            && !spec.is_dot
            && t_block > 0
            && (self.rng_combat.next_range(10000) as i64) < t_block.min(7500)
        {
            hit = false;
        }

        let mut amount = 0i64;
        let mut dmg_type = 0u8;
        let mut crit = false;
        if hit {
            // Crit, then one variance roll, then per-type mitigation.
            let mut scale = 100i64;
            if !spec.is_dot {
                if spec.crit_bp > 0
                    && (self.rng_combat.next_range(10000) as i64)
                        < spec.crit_bp.min(CRIT_CHANCE_CAP_BP)
                {
                    crit = true;
                }
                scale = 75 + self.rng_combat.next_range(51) as i64;
            }
            let mut taken = [0i64; DMG_COUNT];
            taken[DMG_PHYS] = mitigate_phys(spec.damage[DMG_PHYS] * scale / 100, t_armour);
            for i in 1..DMG_COUNT {
                taken[i] = apply_resist(spec.damage[i] * scale / 100, t_resists[i - 1]);
            }
            amount = taken.iter().sum::<i64>();
            if crit {
                amount = amount * spec.crit_multi.max(10000) / 10000;
            }
            amount = amount.max(1);
            let mut best = 0;
            for i in 1..DMG_COUNT {
                if taken[i] > taken[best] {
                    best = i;
                }
            }
            dmg_type = best as u8;
        }

        let t = self.zone.get_mut(target_slot).unwrap();
        let tc = t.combat.as_mut().unwrap();
        // Energy shield absorbs before life; any damage taken pushes the
        // recharge delay out.
        let to_es = amount.min(tc.es);
        tc.es -= to_es;
        tc.life -= amount - to_es;
        if amount > 0 {
            tc.es_recharge_at = now + ES_RECHARGE_DELAY_TICKS;
        }
        tc.last_combat_tick = now;
        let killed = tc.life <= 0;

        // -- hit reactions: STUN (freeze when cold) and KNOCKBACK --
        // Scaled by hit size RELATIVE TO MAX LIFE, so big things resist
        // naturally. Stagger (attacker) inflates the effective size;
        // poise (defender) shrinks it. Chance ramps 0→100% between 12%
        // and 25% of max life; a stun interrupts the victim's committed
        // windup (mana lost) and locks them briefly.
        let mut stun = false;
        let mut freeze = false;
        let mut shove_cu = 0i64;
        if hit && !spec.is_dot && !killed && amount > 0 {
            let pct_bp = (amount * 10000 / t_life_max.max(1)) * (10000 + spec.stagger)
                / (10000 + t_poise).max(1);
            const STUN_FLOOR_BP: i64 = 1200;
            const STUN_SURE_BP: i64 = 2500;
            if pct_bp > STUN_FLOOR_BP {
                let chance =
                    ((pct_bp - STUN_FLOOR_BP) * 10000 / (STUN_SURE_BP - STUN_FLOOR_BP)).min(10000);
                if (self.rng_combat.next_range(10000) as i64) < chance {
                    stun = true;
                    // A stunning COLD hit FREEZES: same lock, icy flavor,
                    // a little longer.
                    freeze = dmg_type == 2;
                    let dur = if freeze { 6 } else { 4 };
                    let tc = self
                        .zone
                        .get_mut(target_slot)
                        .unwrap()
                        .combat
                        .as_mut()
                        .unwrap();
                    tc.busy_until = tc.busy_until.max(now + dur);
                    self.pending_uses.retain(|p| p.attacker != target_net);
                }
            }
            // Knockback: the attacker's flat stat, plus an inherent shove
            // on crushing hits (≥30% of max life).
            shove_cu = spec.knockback_cu + if pct_bp >= 3000 { 35 } else { 0 };
        }
        if shove_cu > 0
            && let Some(a) = self.zone.get_net(spec.attacker_net)
        {
            let from = a.pos;
            self.shove(target_slot, from, target_pos, shove_cu);
        }

        events.push(SimEvent::Hit {
            attacker: spec.attacker_net,
            target: target_net,
            amount,
            dmg_type,
            crit,
            dot: spec.is_dot,
            projectile: spec.projectile,
            killed,
            stun,
            freeze,
        });

        // On-hit rider: apply/refresh the skill's dot (strongest wins per
        // source+skill; reapply refreshes the clock).
        if hit
            && !killed
            && !spec.is_dot
            && let Some((dtype, per_second, duration, skill)) = spec.dot
            && per_second > 0
        {
            let t = self.zone.get_mut(target_slot).unwrap();
            let mut found = false;
            for ef in t.effects.iter_mut() {
                if let ActiveEffect::Dot {
                    source,
                    skill: s,
                    per_second: ps,
                    ticks_left,
                    ..
                } = ef
                    && *source == spec.attacker_net
                    && *s == skill
                {
                    if per_second >= *ps {
                        *ps = per_second;
                        *ticks_left = duration;
                    }
                    found = true;
                    break;
                }
            }
            if !found {
                t.effects.push(ActiveEffect::Dot {
                    dtype,
                    per_second,
                    ticks_left: duration,
                    source: spec.attacker_net,
                    skill,
                });
            }
        }

        // On-hit rider: the skill's debuff lands on the victim through the
        // same timed-effects channel as self-buffs (re-deriving its stats).
        if hit
            && !killed
            && !spec.is_dot
            && let Some((grants, duration)) = spec.debuff.clone()
            && !grants.is_empty()
        {
            self.apply_buff(target_slot, grants, duration);
        }

        // Leech: a slice of damage dealt returns to the attacker (capped
        // at 10% of the pool per strike so big hits don't full-heal).
        if amount > 0
            && !spec.is_dot
            && let Some(attacker_slot) = spec.attacker_slot
        {
            let (leech_life, leech_mana) = {
                let a = self.zone.get(attacker_slot).and_then(|e| e.combat.as_ref());
                (
                    a.map(|c| c.leech_life).unwrap_or(0),
                    a.map(|c| c.leech_mana).unwrap_or(0),
                )
            };
            if (leech_life > 0 || leech_mana > 0)
                && let Some(ac) = self
                    .zone
                    .get_mut(attacker_slot)
                    .and_then(|e| e.combat.as_mut())
            {
                if leech_life > 0 && ac.life > 0 {
                    let gain = (amount * leech_life / 10000).min(ac.life_max / 10);
                    ac.life = (ac.life + gain).min(ac.life_max);
                }
                if leech_mana > 0 {
                    let gain = (amount * leech_mana / 10000).min(ac.mana_max / 10);
                    ac.mana = (ac.mana + gain).min(ac.mana_max);
                }
            }
        }

        if killed {
            self.handle_kill(
                spec.attacker_slot,
                spec.attacker_net,
                &spec.attacker_name,
                spec.attacker_is_char,
                target_slot,
                now,
                events,
                dead_monsters,
                loot_spawns,
            );
        }
    }

    /// Death bookkeeping shared by strikes, projectiles, and dots: XP,
    /// loot, pack counts, respawn timers, corpse marking.
    #[allow(clippy::too_many_arguments)]
    fn handle_kill(
        &mut self,
        attacker_slot: Option<usize>,
        attacker_net: u32,
        attacker_name: &str,
        attacker_is_char: bool,
        target_slot: usize,
        now: u64,
        events: &mut Vec<SimEvent>,
        dead_monsters: &mut DeadList,
        loot_spawns: &mut LootList,
    ) {
        let Some(t) = self.zone.get_mut(target_slot) else {
            return;
        };
        let target_pos = t.pos;
        if let Some(m) = &t.monster {
            let (def_idx, pack_idx) = (m.def_idx, m.pack_idx);
            let target_bot = t.bot;
            let m_rarity = m.rarity;
            let m_level = m.level;
            let def = self.monster_def(def_idx);
            // Elites pay elite wages: 2x / 4x XP for magic / rare.
            let xp_mult = match m_rarity {
                crate::entity::Rarity::Magic => 2,
                crate::entity::Rarity::Rare => 4,
                _ => 1,
            };
            // The EFFECTIVE level (area-scaled; 0 = legacy spawn) drives
            // drop item levels and pays +10% XP per level over baseline.
            let monster_level = if m_level > 0 { m_level } else { def.level };
            let level_bp = 10000 + (monster_level as i64 - def.level as i64) * 1000;
            let (monster_name, xp) = (
                def.name.clone(),
                def.xp * xp_mult * level_bp.max(2500) / 10000,
            );
            dead_monsters.push((target_slot, target_bot.unwrap_or(u32::MAX)));
            // Scripted spawns (spawn_monster/spawn_elite) belong to no
            // pack — the sentinel index has no bookkeeping to update.
            if let Some(pack) = self.zone.packs.get_mut(pack_idx as usize) {
                pack.alive = pack.alive.saturating_sub(1);
                // Packs respawn as a unit: the timer starts only once
                // the whole pack has been wiped.
                if pack.alive == 0 {
                    pack.respawn_timer = pack.def.respawn_ticks;
                }
            }
            if attacker_is_char {
                events.push(SimEvent::MonsterKilled {
                    killer_id: attacker_net,
                    killer: attacker_name.to_string(),
                    monster: monster_name,
                    def_idx,
                    level: monster_level,
                });
                // Loot (personal: owned by the killer): quantity first,
                // then per-drop rarity — both the killer's stats. Multiple
                // drops scatter a little so pillars don't stack.
                for payload in self.roll_kill_drops_juiced(monster_level, attacker_slot, m_rarity) {
                    let dx = self.rng_loot.next_range(120) as i32 - 60;
                    let dy = self.rng_loot.next_range(120) as i32 - 60;
                    let pos = FxV2::new(
                        target_pos.x + super::fx_from_cu(dx),
                        target_pos.y + super::fx_from_cu(dy),
                    );
                    loot_spawns.push((pos, payload, attacker_net, attacker_name.to_string()));
                }
                if let Some(attacker_slot) = attacker_slot {
                    self.grant_xp(attacker_slot, xp, true, events);
                    // Allies near the kill share half the experience.
                    let rr = XP_SHARE_RADIUS.raw() as i64 * XP_SHARE_RADIUS.raw() as i64;
                    let allies: Vec<usize> = self
                        .zone
                        .iter()
                        .filter(|(s, a)| {
                            *s != attacker_slot && a.character.is_some() && a.alive() && {
                                let dx = (a.pos.x - target_pos.x).raw() as i64;
                                let dy = (a.pos.y - target_pos.y).raw() as i64;
                                dx * dx + dy * dy <= rr
                            }
                        })
                        .map(|(s, _)| s)
                        .collect();
                    for ally in allies {
                        self.grant_xp(ally, xp / 2, false, events);
                    }
                }
            }
        } else if let Some(ch) = &mut t.character {
            ch.respawn_at = Some(now + RESPAWN_TICKS);
            let (id, name) = (t.net_id, ch.name.clone());
            t.intents = Default::default();
            t.effects.clear();
            events.push(SimEvent::CharacterDied {
                id,
                name,
                killer: attacker_name.to_string(),
            });
        }
    }

    /// Free dead monsters' brains, mark corpses, spawn dropped loot.
    fn finish_kills(&mut self, dead: DeadList, loot: LootList, events: &mut Vec<SimEvent>) {
        // The dead stay where they fell: free the brain immediately (the
        // arena slot may be reused), mark the corpse for decay, and let
        // respawns() sweep it later. Corpses fail alive(), so every other
        // system already ignores them.
        for (slot, bot_idx) in dead {
            if bot_idx != u32::MAX {
                self.bots.remove(bot_idx);
            }
            if let Some(e) = self.zone.get_mut(slot) {
                e.bot = None;
                e.intents = Default::default();
                e.effects.clear();
                if let Some(m) = e.monster.as_mut() {
                    m.decay_at = Some(self.tick + super::CORPSE_TICKS);
                }
            }
        }
        for (pos, payload, owner, owner_name) in loot {
            let (rarity, name) = self.payload_display(&payload);
            self.spawn_loot(pos, payload, owner);
            events.push(SimEvent::LootDropped {
                owner_id: owner,
                owner: owner_name,
                rarity,
                item: name,
            });
        }
    }

    /// Apply (or refresh) a self-buff and re-derive stats.
    fn apply_buff(&mut self, slot: usize, grants: Vec<Grant>, duration_ticks: u32) {
        if let Some(e) = self.zone.get_mut(slot) {
            for ef in e.effects.iter_mut() {
                if let ActiveEffect::Buff {
                    grants: g,
                    ticks_left,
                } = ef
                    && *g == grants
                {
                    *ticks_left = duration_ticks;
                    self.refresh_derived_stats(slot);
                    return;
                }
            }
            e.effects.push(ActiveEffect::Buff {
                grants,
                ticks_left: duration_ticks,
            });
        }
        self.refresh_derived_stats(slot);
    }

    /// Timed effects: dots burn once per second, buffs expire. Runs after
    /// attacks so a fresh dot starts ticking from the next second edge.
    pub(super) fn effects_tick(&mut self, events: &mut Vec<SimEvent>) {
        let now = self.tick;
        let second_edge = now.is_multiple_of(10);
        let mut dead: DeadList = Vec::new();
        let mut loot: LootList = Vec::new();
        let mut needs_refresh: Vec<usize> = Vec::new();

        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if e.effects.is_empty() || !e.alive() {
                continue;
            }
            // Collect due burns first (no aliasing while striking).
            let mut burns: Vec<(u8, i64, u32)> = Vec::new();
            if second_edge {
                for ef in &e.effects {
                    if let ActiveEffect::Dot {
                        dtype,
                        per_second,
                        source,
                        ..
                    } = ef
                    {
                        burns.push((*dtype, *per_second, *source));
                    }
                }
            }
            for (dtype, per_second, source) in burns {
                let (source_name, source_is_char) = self
                    .zone
                    .get_net(source)
                    .map(|s| {
                        (
                            s.character
                                .as_ref()
                                .map(|c| c.name.clone())
                                .unwrap_or_default(),
                            s.character.is_some(),
                        )
                    })
                    .unwrap_or_default();
                let mut damage = [0i64; DMG_COUNT];
                damage[dtype as usize] = per_second;
                let spec = StrikeSpec {
                    attacker_slot: self.zone.slot_of(source),
                    attacker_net: source,
                    attacker_name: source_name,
                    attacker_is_char: source_is_char,
                    is_spell: true,
                    is_dot: true,
                    accuracy: 0,
                    damage,
                    crit_bp: 0,
                    crit_multi: 10000,
                    projectile: false,
                    dot: None,
                    debuff: None,
                    stagger: 0,
                    knockback_cu: 0,
                };
                self.strike(spec, slot, now, events, &mut dead, &mut loot);
            }

            // Count down and sweep.
            if let Some(e) = self.zone.get_mut(slot) {
                let mut buff_expired = false;
                for ef in e.effects.iter_mut() {
                    match ef {
                        ActiveEffect::Dot { ticks_left, .. } => {
                            *ticks_left = ticks_left.saturating_sub(1);
                        }
                        ActiveEffect::Buff { ticks_left, .. } => {
                            *ticks_left = ticks_left.saturating_sub(1);
                            if *ticks_left == 0 {
                                buff_expired = true;
                            }
                        }
                    }
                }
                e.effects.retain(|ef| match ef {
                    ActiveEffect::Dot { ticks_left, .. } => *ticks_left > 0,
                    ActiveEffect::Buff { ticks_left, .. } => *ticks_left > 0,
                });
                if buff_expired {
                    needs_refresh.push(slot);
                }
            }
        }

        for slot in needs_refresh {
            self.refresh_derived_stats(slot);
            // An expired buff can drop the attributes a piece of gear
            // leaned on — requirements re-validate here too.
            self.enforce_gear_requirements(slot, events);
        }
        self.finish_kills(dead, loot, events);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::World;
    use idlin_content::ContentDb;
    use std::path::Path;

    fn content() -> ContentDb {
        ContentDb::load(Path::new("../../content")).expect("workspace content must load")
    }

    /// Uses WIND UP now: the first attacks() pass commits, the contact
    /// pass resolves. Sixteen clock steps cover every contact in the
    /// roster while staying short of a second swing's resolution.
    fn run_attacks(world: &mut World, events: &mut Vec<super::SimEvent>) {
        for _ in 0..16 {
            world.attacks(events);
            world.tick += 1;
        }
    }

    fn gem_idx(content: &ContentDb, id: &str) -> u32 {
        content.gems.iter().position(|g| g.id == id).expect(id) as u32
    }

    fn instance(content: &ContentDb, id: &str, level: u32) -> GemInstance {
        GemInstance {
            gem_idx: gem_idx(content, id),
            level,
            xp: 0,
        }
    }

    /// Test helper (#54 PR2b): drop a level-1 gem into the next free bag cell,
    /// returning its inventory index (the handle socket_gem takes now).
    fn bag_gem(ch: &mut crate::entity::CharacterState, content: &ContentDb, id: &str) -> usize {
        use crate::entity::{BAG_W, BagItem, PlacedItem};
        let i = ch.inventory.len();
        ch.inventory.push(PlacedItem {
            item: BagItem::Gem(instance(content, id, 1)),
            x: (i as u8) % BAG_W,
            y: (i as u8) / BAG_W,
        });
        i
    }

    /// A crushing hit (past the sure-stun knee) STUNS — the victim's
    /// committed windup is cancelled and busy extends — and an attacker
    /// with flat Knockback SHOVES the victim along the blow.
    #[test]
    fn crushing_hits_stun_and_knockback_shoves() {
        let content = content();
        let mut world = World::new(0x57A6, &content);
        let halt = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Crusher".into(),
                program: halt,
            }],
        }); // packs spawn; one inert character joins
        for g in &mut world.zone.gates {
            g.open = true;
        }
        let (m_slot, m_net, m_pos) = world
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(s, e)| (s, e.net_id, e.pos))
            .expect("a monster stands somewhere");
        // Beef the victim so the crusher doesn't kill it, and give it a
        // committed windup to break.
        {
            let m = world.zone.get_mut(m_slot).unwrap();
            let c = m.combat.as_mut().unwrap();
            c.life = 400;
            c.life_max = 400;
        }
        world.pending_uses.push(super::PendingUse {
            attacker: m_net,
            target: crate::entity::SkillTarget::Entity(9999),
            skill: None,
            resolve_at: world.tick + 50,
        });
        // Direction comes from the attacker's live position: park the
        // character one unit west of the victim.
        let ch_net = world
            .zone
            .iter()
            .find(|(_, e)| e.character.is_some())
            .map(|(_, e)| e.net_id)
            .expect("a character joined");
        let attacker_pos = FxV2::new(m_pos.x - Fx::from_int(1), m_pos.y);
        let ch_slot = world.zone.slot_of(ch_net).unwrap();
        world.zone.get_mut(ch_slot).unwrap().pos = attacker_pos;

        let spec = StrikeSpec {
            attacker_slot: Some(ch_slot),
            attacker_net: ch_net,
            attacker_name: "Test".into(),
            attacker_is_char: true,
            is_spell: true, // never misses
            is_dot: false,
            accuracy: 0,
            damage: [160, 0, 0, 0, 0], // 40% of 400: past the knee
            crit_bp: 0,
            crit_multi: 10000,
            projectile: false,
            dot: None,
            debuff: None,
            stagger: 0,
            knockback_cu: 60,
        };
        let now = world.tick;
        let mut events = Vec::new();
        let mut dead = Vec::new();
        let mut loot = Vec::new();
        world.strike(spec, m_slot, now, &mut events, &mut dead, &mut loot);

        assert!(
            events
                .iter()
                .any(|ev| matches!(ev, super::SimEvent::Hit { stun: true, .. })),
            "a 40%-of-life hit must stun"
        );
        let m = world.zone.get(m_slot).unwrap();
        assert!(
            m.combat.as_ref().unwrap().busy_until >= now + 4,
            "the stun locks the victim"
        );
        assert!(
            !world.pending_uses.iter().any(|p| p.attacker == m_net),
            "the victim's committed windup is interrupted"
        );
        assert!(
            m.pos.x.raw() > m_pos.x.raw(),
            "knockback shoves along the blow ({} -> {})",
            m_pos.x.raw(),
            m.pos.x.raw()
        );
    }

    #[test]
    fn fan_steps_alternate_sides() {
        assert_eq!(
            (0..5).map(fan_step).collect::<Vec<_>>(),
            vec![0, 1, -1, 2, -2]
        );
    }

    #[test]
    fn rotate_fan_keeps_length_and_turns() {
        let dir = FxV2::new(Fx::ONE, Fx::ZERO);
        for steps in [-3, -1, 1, 3] {
            let r = rotate_fan(dir, steps);
            let len2 = r.x.raw() as i64 * r.x.raw() as i64 + r.y.raw() as i64 * r.y.raw() as i64;
            let unit2 = 65536i64 * 65536;
            // Integer rounding shaves a little length but never adds it.
            assert!(len2 <= unit2 && len2 > unit2 * 98 / 100, "len2 {len2}");
            // The sign of the turn matches the step sign.
            assert_eq!(r.y.raw() > 0, steps > 0);
            assert!(r.x.raw() < 65536);
        }
        // Symmetric steps mirror across the aim axis (floor-shift rounding
        // may differ by one raw unit, 1/65536 u — invisible and harmless).
        let l = rotate_fan(dir, 2);
        let r = rotate_fan(dir, -2);
        assert!((l.x.raw() - r.x.raw()).abs() <= 1);
        assert!((l.y.raw() + r.y.raw()).abs() <= 1);
    }

    #[test]
    fn support_mods_fold_effects() {
        let content = content();
        let world = World::new(1, &content);
        let supports = vec![
            instance(&content, "split_quiver", 1),
            instance(&content, "heavier_blows", 1),
            instance(&content, "added_embers", 3),
        ];
        let m = world.support_mods(&supports);
        assert_eq!(m.extra_projectiles, 2);
        // 25% less (all) then 20% more phys: 10000 → 7500 → 9000.
        assert_eq!(m.more_bp[crate::entity::DMG_PHYS], 9000);
        assert_eq!(m.more_bp[1], 7500);
        // Added Embers at gem level 3: 4 + 2×2 = 8 flat fire.
        assert_eq!(m.added[1], 8);
        assert_eq!(m.added[crate::entity::DMG_PHYS], 0);
    }

    /// One fresh world: a character with (skill + supports) socketed,
    /// teleported next to a live monster, intent queued. Returns events
    /// from a single attacks() pass.
    fn use_supported_skill(skill: &str, supports: &[&str]) -> Vec<super::SimEvent> {
        let content = content();
        let mut world = World::new(424_242, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Tester".into(),
                program,
            }],
        });
        let char_slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character spawned");
        let (monster_net, monster_pos) = world
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(_, e)| (e.net_id, e.pos))
            .expect("a monster exists");
        let socket_node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .expect("a socket node exists") as u32;

        let sg = SocketedGem {
            gem: instance(&content, skill, 1),
            cooldown_left: 0,
            supports: supports.iter().map(|s| instance(&content, s, 1)).collect(),
        };
        // Attack skills demand an eligible weapon — wield one.
        let weapon = match skill {
            "cleave" => Some("rusted_cleaver"),
            "power_shot" => Some("driftwood_bow"),
            _ => None,
        };
        let e = world.zone.get_mut(char_slot).unwrap();
        e.pos = FxV2::new(monster_pos.x + Fx::from_raw(0x4000), monster_pos.y);
        let ch = e.character.as_mut().unwrap();
        ch.sockets.insert(socket_node, sg);
        if let Some(id) = weapon {
            let base_idx = content.items.iter().position(|i| i.id == id).expect(id) as u32;
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] = Some(crate::entity::Item {
                base_idx,
                rarity: crate::entity::Rarity::Normal,
                item_level: 1,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
            });
        }
        let c = e.combat.as_mut().unwrap();
        c.mana = 100;
        e.intents.attack = Some(AttackIntent {
            target: SkillTarget::Entity(monster_net),
            skill: Some(socket_node),
        });

        let mut events = Vec::new();
        run_attacks(&mut world, &mut events);
        events
    }

    /// #54 PR2a: SkillInfo exposes the def geometry stripped from ReadSkills,
    /// and ReadItemMods exposes an item's rolled affixes — both keyed by stable
    /// tagged nums.
    #[test]
    fn skill_info_and_read_item_mods_expose_def_detail() {
        use crate::entity::{BagItem, Item, PlacedItem, Rarity, RolledAffix, SocketedGem};
        use idlin_content::ids::Category;
        let content = content();
        let mut world = World::new(0x5141, &content);
        // One debug() per value (debug is single-arg): skill_info return, then
        // shape/skill_kind from its record; mod count, then affix_num/value/tier
        // from the first mod.
        let program = idlin_botc::compile(
            "fn main() {\n\
             debug(skill_info(1, 0xE000));\n\
             var n = read_item_mods(0, 0xE100, 8);\n\
             debug(mem[0xE000]);\n\
             debug(mem[0xE008]);\n\
             debug(n);\n\
             debug(mem[0xE100]);\n\
             debug(mem[0xE104]);\n\
             debug(mem[0xE108]);\n\
             debug(skill_info(9, 0xE200));\n\
             debug(read_item_mods(9, 0xE300, 8));\n\
             debug(skill_info(0, 0xE200));\n\
             debug(skill_info(0 - 5, 0xE200));\n\
             }\n",
        )
        .expect("compiles");
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Seer".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character");
        let net = world.zone.get(slot).unwrap().net_id;
        let socket_node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        let hale_idx = content.affixes.iter().position(|a| a.id == "hale").unwrap() as u32;
        let expect_affix_num = content
            .content_num(Category::Affix, hale_idx as usize)
            .unwrap();
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.sockets.insert(
                socket_node,
                SocketedGem {
                    gem: instance(&content, "frost_nova", 1),
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(Item {
                    base_idx: 0,
                    rarity: Rarity::Magic,
                    item_level: 5,
                    affixes: vec![RolledAffix {
                        affix_idx: hale_idx,
                        value: 12,
                        tier: 0,
                    }],
                    name: String::new(),
                    charges: 0,
                }),
                x: 0,
                y: 0,
            });
        }
        // Next tick: the bot reads its now-populated skill + item.
        let events = world.tick(&crate::TickInputs::default());
        let vals: Vec<i32> = events
            .iter()
            .filter_map(|e| match e {
                super::SimEvent::BotDebug { id, values } if *id == net => values.first().copied(),
                _ => None,
            })
            .collect();
        assert_eq!(vals.len(), 11, "eleven debug emits: {vals:?}");
        assert_eq!(vals[0], 0, "skill_info(1) is a valid slot");
        assert_eq!(vals[1], 1, "frost_nova shape = nova");
        assert_eq!(vals[2], 1, "frost_nova kind = spell");
        assert_eq!(vals[3], 1, "one rolled mod on the item");
        assert_eq!(vals[4], expect_affix_num, "the rolled affix's tagged num");
        assert_eq!(vals[5], 12, "the rolled value");
        assert_eq!(vals[6], 0, "the rolled tier");
        // Out-of-range / zero / negative slot and a bad item index are all
        // rejected with -1 — never garbage, never a panic (slot is raw input).
        assert_eq!(vals[7], -1, "skill_info on an empty slot → -1");
        assert_eq!(vals[8], -1, "read_item_mods on a bad index → -1");
        assert_eq!(vals[9], -1, "skill_info on slot 0 (basic attack) → -1");
        assert_eq!(vals[10], -1, "skill_info on a negative slot → -1");
    }

    #[test]
    fn widened_nova_emits_grown_skill_fx() {
        let events = use_supported_skill("cleave", &["widening"]);
        let fx = events
            .iter()
            .find_map(|ev| match ev {
                super::SimEvent::SkillFx { shape, radius, .. } => Some((*shape, *radius)),
                _ => None,
            })
            .expect("nova use must emit SkillFx");
        assert_eq!(fx.0, 1, "cleave is a nova");
        // Cleave 320 cu, Widening +30% → 416 cu.
        assert_eq!(fx.1, fx_from_cu(416).raw());
        assert!(
            events
                .iter()
                .any(|ev| matches!(ev, super::SimEvent::Hit { .. })),
            "the adjacent monster is inside the nova"
        );
    }

    #[test]
    fn split_quiver_fans_three_projectiles() {
        let events = use_supported_skill("power_shot", &["split_quiver"]);
        let launches: Vec<(i32, i32)> = events
            .iter()
            .filter_map(|ev| match ev {
                super::SimEvent::ProjectileSpawned { vx, vy, spell, .. } => {
                    assert!(!spell, "power shot is an attack");
                    Some((*vx, *vy))
                }
                _ => None,
            })
            .collect();
        assert_eq!(launches.len(), 3, "1 + 2 extra projectiles");
        // The fan spreads: no two directions equal.
        assert!(launches[0] != launches[1] && launches[1] != launches[2]);
        assert!(
            !events
                .iter()
                .any(|ev| matches!(ev, super::SimEvent::SkillFx { .. })),
            "projectile skills announce via ProjectileSpawned, not SkillFx"
        );
    }

    #[test]
    fn support_capacity_grows_with_gem_level() {
        use crate::entity::support_slots;
        assert_eq!(support_slots(1), 1);
        assert_eq!(support_slots(6), 1);
        assert_eq!(support_slots(7), 2);
        assert_eq!(support_slots(13), 2);
        assert_eq!(support_slots(14), 3);
        assert_eq!(support_slots(20), 3);

        // At the socket: a level-1 skill is full after one support.
        let content = content();
        let mut world = World::new(8, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Tester".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.allocated.push(node);
            ch.sockets.insert(
                node,
                SocketedGem {
                    gem: instance(&content, "cleave", 1),
                    cooldown_left: 0,
                    supports: vec![instance(&content, "heavier_blows", 1)],
                },
            );
            bag_gem(ch, &content, "quickening");
        }
        // #54 PR3: socket_gem takes the stable node NUM now, not the array index.
        let node_num = content
            .content_num(idlin_content::ids::Category::Node, node as usize)
            .unwrap();
        let mut ev = Vec::new();
        assert_eq!(world.socket_gem(slot, node_num, 0, &mut ev), -1);
        // The same skill at level 7 has a second slot.
        world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .sockets
            .get_mut(&node)
            .unwrap()
            .gem
            .level = 7;
        assert_eq!(world.socket_gem(slot, node_num, 0, &mut ev), 1);
    }

    #[test]
    fn speech_comes_from_tables_and_rate_limits() {
        let content = content();
        let mut world = World::new(0x5A1D, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Talker".into(),
                program,
            }],
        });
        let char_slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let mut events = Vec::new();
        assert_eq!(world.try_say(char_slot, 0, &mut events), 0);
        assert!(matches!(
            &events[0],
            super::SimEvent::Speech { text, .. } if text == "Still breathing."
        ));
        // Rate-limited immediately after.
        assert_eq!(world.try_say(char_slot, 1, &mut events), -2);
        // A shambler has no lines: it has nothing to say.
        let shambler = world
            .zone
            .iter()
            .find(|(_, e)| {
                e.monster
                    .as_ref()
                    .is_some_and(|m| world.content_monsters_id(m.def_idx) == "drowned_shambler")
            })
            .map(|(s, _)| s)
            .unwrap();
        assert_eq!(world.try_say(shambler, 0, &mut events), -1);
        // The Tidewarden speaks; index wraps.
        let warden = world
            .zone
            .iter()
            .find(|(_, e)| {
                e.monster
                    .as_ref()
                    .is_some_and(|m| world.content_monsters_id(m.def_idx) == "tidewarden")
            })
            .map(|(s, _)| s)
            .unwrap();
        assert_eq!(world.try_say(warden, 99, &mut events), 0);
    }

    #[test]
    fn fast_projectiles_cannot_tunnel_through_small_targets() {
        // An 8u-per-tick projectile crosses a staked shambler whose
        // combined radii are far smaller than the step. The endpoint-only
        // check sailed straight through; the swept segment must connect.
        let content = content();
        let mut world = World::new(0xA110, &content);
        world.tick(&crate::TickInputs::default()); // packs spawn
        // The tutorial's shut gates block projectiles (correctly) — this
        // test is about swept collision, so lift them out of the way.
        for g in &mut world.zone.gates {
            g.open = true;
        }
        let (slot, pos) = world
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(s, e)| (s, e.pos))
            .expect("a monster stands somewhere");
        let life_before = world.zone.get(slot).unwrap().combat.as_ref().unwrap().life;
        world.zone.projectiles.push(crate::zone::Projectile {
            pos: FxV2::new(pos.x, pos.y - Fx::from_int(4)),
            vel: FxV2::new(Fx::ZERO, Fx::from_int(8)), // leaps clean past
            remaining: Fx::from_int(20),
            radius: Fx::from_raw(0x4000), // 0.25 u
            source: 9999,
            source_name: "Test".into(),
            source_is_char: true,
            hostile_to_players: false,
            spell: true, // spells never miss via accuracy
            accuracy: 0,
            damage: [25, 0, 0, 0, 0],
            crit_bp: 0,
            crit_multi: 15000,
            pierce: 0,
            already_hit: Vec::new(),
            dot: None,
            debuff: None,
            stagger: 0,
            knockback_cu: 0,
        });
        let mut events = Vec::new();
        world.step_projectiles(&mut events);
        let life_after = world
            .zone
            .get(slot)
            .map(|e| e.combat.as_ref().unwrap().life)
            .unwrap_or(0); // killed outright also counts as a hit
        assert!(
            life_after < life_before,
            "the swept segment must connect ({life_before} -> {life_after})"
        );
    }

    #[test]
    fn monsters_cast_their_kit_through_the_same_pipeline() {
        let content = content();
        let mut world = World::new(0xBEEF, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Bait".into(),
                program,
            }],
        });
        let bait_slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let (husk_slot, husk_net, husk_pos, husk_mana) = world
            .zone
            .iter()
            .find(|(_, e)| {
                e.monster
                    .as_ref()
                    .is_some_and(|m| content.monsters[m.def_idx as usize].id == "tide_husk")
            })
            .map(|(s, e)| (s, e.net_id, e.pos, e.combat.as_ref().unwrap().mana))
            .expect("a tide husk spawned");
        assert!(husk_mana > 0, "husks carry mana now");
        assert!(
            !world
                .zone
                .get(husk_slot)
                .unwrap()
                .monster
                .as_ref()
                .unwrap()
                .skills
                .is_empty(),
            "the def kit resolved at spawn"
        );
        // Drop unkillable bait next to it and let the brain work.
        {
            let e = world.zone.get_mut(bait_slot).unwrap();
            e.pos = FxV2::new(husk_pos.x + Fx::from_int(3), husk_pos.y);
            let c = e.combat.as_mut().unwrap();
            c.life_max = 1_000_000;
            c.life = 1_000_000;
        }
        let mut arced = false;
        for _ in 0..100 {
            let events = world.tick(&crate::TickInputs::default());
            // Bait drifts from separation pushes; keep it close and alive.
            if let Some(e) = world.zone.get_mut(bait_slot) {
                let c = e.combat.as_mut().unwrap();
                c.life = 1_000_000;
            }
            arced |= events.iter().any(|ev| {
                matches!(
                    ev,
                    super::SimEvent::Hit { attacker, dmg_type: 3, .. } if *attacker == husk_net
                )
            });
            if arced {
                break;
            }
        }
        assert!(arced, "the husk must land Arc (lightning) on the bait");
        let mana_now = world
            .zone
            .get(husk_slot)
            .unwrap()
            .combat
            .as_ref()
            .unwrap()
            .mana;
        assert!(mana_now < husk_mana, "casting spent monster mana");
    }

    #[test]
    fn war_cry_rallies_nearby_allies_and_lingers() {
        let content = content();
        let mut world = World::new(77_77, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![
                crate::JoinRequest {
                    name: "Caster".into(),
                    program: program.clone(),
                },
                crate::JoinRequest {
                    name: "Ally".into(),
                    program,
                },
            ],
        });
        let chars: Vec<usize> = (0..world.zone.slot_count())
            .filter(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .collect();
        let (caster, ally) = (chars[0], chars[1]);
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        let base_pos = world.zone.get(caster).unwrap().pos;
        {
            let a = world.zone.get_mut(ally).unwrap();
            a.pos = FxV2::new(base_pos.x + Fx::from_int(2), base_pos.y);
        }
        let base_phys = world
            .zone
            .get(ally)
            .unwrap()
            .combat
            .as_ref()
            .unwrap()
            .damage[0];
        {
            let e = world.zone.get_mut(caster).unwrap();
            e.character.as_mut().unwrap().sockets.insert(
                node,
                SocketedGem {
                    gem: instance(&content, "war_cry", 1),
                    cooldown_left: 0,
                    // Lingering: the duration tag stretches the buff too.
                    supports: vec![instance(&content, "lingering", 1)],
                },
            );
            e.combat.as_mut().unwrap().mana = 100;
            e.intents.attack = Some(AttackIntent {
                target: SkillTarget::Direction(FxV2::new(Fx::ONE, Fx::ZERO)),
                skill: Some(node),
            });
        }
        let mut events = Vec::new();
        run_attacks(&mut world, &mut events);
        assert!(
            !events
                .iter()
                .any(|ev| matches!(ev, super::SimEvent::Hit { .. })),
            "war cry strikes nobody"
        );
        for &who in &[caster, ally] {
            let e = world.zone.get(who).unwrap();
            let lingered = e.effects.iter().any(
                |ef| matches!(ef, ActiveEffect::Buff { ticks_left, .. } if *ticks_left == 140),
            );
            assert!(lingered, "slot {who} carries the 100×1.4-tick rally");
        }
        let buffed_phys = world
            .zone
            .get(ally)
            .unwrap()
            .combat
            .as_ref()
            .unwrap()
            .damage[0];
        assert!(
            buffed_phys > base_phys,
            "the rally raises ally phys: {buffed_phys} vs {base_phys}"
        );
    }

    #[test]
    fn attack_skills_demand_an_eligible_weapon() {
        let content = content();
        let mut world = World::new(99_99, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Tester".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let monster_net = world
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(_, e)| e.net_id)
            .unwrap();
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        let item_idx = |id: &str| content.items.iter().position(|i| i.id == id).expect(id) as u32;
        let equip = |world: &mut World, base: Option<u32>| {
            let e = world.zone.get_mut(slot).unwrap();
            let ch = e.character.as_mut().unwrap();
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] =
                base.map(|base_idx| crate::entity::Item {
                    base_idx,
                    rarity: crate::entity::Rarity::Normal,
                    item_level: 1,
                    affixes: Vec::new(),
                    name: String::new(),
                    charges: 0,
                });
            e.combat.as_mut().unwrap().mana = 100;
        };
        {
            // Stand next to the monster so range/LoS never interfere.
            let mpos = world.zone.get_net(monster_net).unwrap().pos;
            let e = world.zone.get_mut(slot).unwrap();
            e.pos = FxV2::new(mpos.x + Fx::from_raw(0x4000), mpos.y);
        }
        // Cleave demands melee: bare hands and a bow both refuse (−9);
        // the cleaver fires.
        {
            let e = world.zone.get_mut(slot).unwrap();
            e.character.as_mut().unwrap().sockets.insert(
                node,
                SocketedGem {
                    gem: instance(&content, "cleave", 1),
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
        }
        equip(&mut world, None);
        assert_eq!(
            world.try_use_skill(slot, 1, SkillTarget::Entity(monster_net)),
            SKILL_ERR_WEAPON,
            "bare hands can't cleave"
        );
        equip(&mut world, Some(item_idx("driftwood_bow")));
        assert_eq!(
            world.try_use_skill(slot, 1, SkillTarget::Entity(monster_net)),
            SKILL_ERR_WEAPON,
            "a bow can't cleave"
        );
        equip(&mut world, Some(item_idx("rusted_cleaver")));
        assert_eq!(
            world.try_use_skill(slot, 1, SkillTarget::Entity(monster_net)),
            0,
            "the cleaver cleaves"
        );
        // Ember Bolt is a spell: the weapon is irrelevant, bare hands fine.
        {
            let e = world.zone.get_mut(slot).unwrap();
            let ch = e.character.as_mut().unwrap();
            ch.sockets.get_mut(&node).unwrap().gem = instance(&content, "ember_bolt", 1);
        }
        equip(&mut world, None);
        assert_eq!(
            world.try_use_skill(slot, 1, SkillTarget::Entity(monster_net)),
            0,
            "spells cast bare-handed"
        );
    }

    #[test]
    fn debuffs_chill_monsters_and_expire() {
        use crate::stats::{Grant, Layer, Stat};
        let mut content = content();
        // A synthetic chill spell: clone a real gem and bolt on the rider.
        let mut chill = content
            .gems
            .iter()
            .find(|g| g.id == "ember_bolt")
            .unwrap()
            .clone();
        chill.id = "zz_test_chill".into();
        chill.shape = idlin_content::SkillShape::Target;
        chill.debuff = Some(idlin_content::BuffDef {
            grants: vec![
                Grant {
                    stat: Stat::MoveSpeed,
                    layer: Layer::Increased,
                    value: -3000,
                },
                Grant {
                    stat: Stat::AttackSpeed,
                    layer: Layer::Increased,
                    value: -3000,
                },
            ],
            duration_ticks: 20,
        });
        content.gems.push(chill);

        let mut world = World::new(515_151, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Tester".into(),
                program,
            }],
        });
        let char_slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let (monster_slot, monster_net, monster_pos) = world
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(s, e)| (s, e.net_id, e.pos))
            .unwrap();
        let (base_speed, base_use) = {
            let c = world
                .zone
                .get(monster_slot)
                .unwrap()
                .combat
                .as_ref()
                .unwrap();
            (c.speed_per_tick, c.use_ticks)
        };
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        {
            let e = world.zone.get_mut(char_slot).unwrap();
            e.pos = FxV2::new(monster_pos.x + Fx::from_raw(0x4000), monster_pos.y);
            e.character.as_mut().unwrap().sockets.insert(
                node,
                SocketedGem {
                    gem: instance(&content, "zz_test_chill", 1),
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
            let c = e.combat.as_mut().unwrap();
            c.mana = 100;
            e.intents.attack = Some(AttackIntent {
                target: SkillTarget::Entity(monster_net),
                skill: Some(node),
            });
        }
        let mut events = Vec::new();
        run_attacks(&mut world, &mut events);
        assert!(
            events
                .iter()
                .any(|ev| matches!(ev, super::SimEvent::Hit { .. })),
            "the chill bolt must land"
        );
        let c = world
            .zone
            .get(monster_slot)
            .unwrap()
            .combat
            .as_ref()
            .unwrap();
        assert!(
            c.speed_per_tick < base_speed,
            "chilled monsters move slower: {} vs {}",
            c.speed_per_tick.raw(),
            base_speed.raw()
        );
        assert!(
            c.use_ticks > base_use,
            "chilled monsters swing slower: {} vs {base_use}",
            c.use_ticks
        );
        // The debuff burns down through effects_tick and stats restore.
        for _ in 0..21 {
            let mut ev = Vec::new();
            world.effects_tick(&mut ev);
        }
        let e = world.zone.get(monster_slot).unwrap();
        assert!(e.effects.is_empty(), "debuff must expire");
        let c = e.combat.as_ref().unwrap();
        assert_eq!(c.speed_per_tick, base_speed, "speed restores on expiry");
        assert_eq!(c.use_ticks, base_use, "swing time restores on expiry");
    }

    #[test]
    fn duplicate_supports_are_refused() {
        let content = content();
        let mut world = World::new(7, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Tester".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character spawned");
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .expect("a socket node exists") as u32;
        // #54 PR3: socket_gem takes the stable node NUM now, not the array index.
        let node_num = content
            .content_num(idlin_content::ids::Category::Node, node as usize)
            .unwrap();
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.allocated.push(node);
            ch.sockets.insert(
                node,
                SocketedGem {
                    // Level 7: capacity 2, so only the dup rule can refuse.
                    gem: instance(&content, "cleave", 7),
                    cooldown_left: 0,
                    supports: vec![instance(&content, "heavier_blows", 1)],
                },
            );
            bag_gem(ch, &content, "heavier_blows");
        }
        let mut ev = Vec::new();
        // Manual: a second copy of the same support is refused outright.
        assert_eq!(world.socket_gem(slot, node_num, 0, &mut ev), -1);
        // Auto: the duplicate is skipped (nothing sockets).
        assert_eq!(world.socket_gem(slot, -1, -1, &mut ev), 0);
        // A different fitting support still goes in.
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            bag_gem(ch, &content, "quickening");
        }
        assert_eq!(world.socket_gem(slot, -1, -1, &mut ev), 1);
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.sockets[&node].supports.len(), 2);
    }

    /// #54 PR2b: auto-socket upgrades a utility squatter to a damage skill, and
    /// the displaced gem comes back to the BAG GRID (it used to go to the pouch)
    /// — exercising socket_gem's new grid re-placement.
    #[test]
    fn auto_socket_returns_a_swapped_squatter_to_the_grid() {
        use crate::entity::{BagItem, SocketedGem};
        let content = content();
        let mut world = World::new(0x9E5, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Swapper".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        // Use the start socket ("First Spark") as the SOLE socket, so the only
        // way to place cleave is to swap the squatter out — no empty socket for
        // Pass 1 to fill instead.
        let node = content.tree_start;
        assert_eq!(
            content.tree[node as usize].kind,
            idlin_content::NodeKind::Socket,
            "this test assumes the start node is a socket"
        );
        let cleave = gem_idx(&content, "cleave");
        let war_cry = gem_idx(&content, "war_cry");
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            // A no-damage utility skill squats the only socket; a real damage
            // skill waits in the bag.
            ch.sockets.insert(
                node,
                SocketedGem {
                    gem: instance(&content, "war_cry", 1),
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
            bag_gem(ch, &content, "cleave");
        }
        let mut ev = Vec::new();
        assert_eq!(
            world.socket_gem(slot, -1, -1, &mut ev),
            1,
            "the swap happens"
        );
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(
            ch.sockets[&node].gem.gem_idx, cleave,
            "the damage skill took the socket"
        );
        assert!(
            ch.inventory
                .iter()
                .any(|p| matches!(&p.item, BagItem::Gem(g) if g.gem_idx == war_cry)),
            "the displaced utility gem is back in the bag as a 1×1 item"
        );
    }

    /// A two-handed weapon claims the offhand: EquipBest won't fill it and
    /// sheds any offhand worn under it, and the inspect sheet mirrors the
    /// weapon into the offhand slot dimmed.
    #[test]
    fn a_two_handed_weapon_claims_the_offhand() {
        use crate::entity::{BagItem, Item, PlacedItem, Rarity};
        use idlin_content::GearSlot;
        // EquipBest's offhand-shed relies on the weapon slot being processed
        // before the offhand within one pass.
        assert!(
            GearSlot::Weapon.idx() < GearSlot::Offhand.idx(),
            "weapon must precede offhand in slot order"
        );
        let content = content();
        let mut world = World::new(0x2042, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Archer".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let net = world.zone.get(slot).unwrap().net_id;
        let base = |id: &str| content.items.iter().position(|i| i.id == id).unwrap() as u32;
        let mk = |base_idx| Item {
            base_idx,
            rarity: Rarity::Normal,
            item_level: 1,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
        };
        let bow = base("driftwood_bow"); // two_handed
        let buckler = base("driftwood_buckler"); // offhand
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.equipment[GearSlot::Weapon.idx()] = Some(mk(bow));
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(mk(buckler)),
                x: 0,
                y: 0,
            });
        }
        // EquipBest must NOT equip the buckler while the 2H bow is wielded.
        let mut ev = Vec::new();
        world.equip_best(slot, &mut ev);
        {
            let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
            assert!(
                ch.equipment[GearSlot::Offhand.idx()].is_none(),
                "a 2H weapon forbids an offhand"
            );
        }
        // An offhand forced on under a 2H weapon is shed on the next pass.
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.equipment[GearSlot::Offhand.idx()] = Some(mk(buckler));
        }
        let mut ev = Vec::new();
        world.equip_best(slot, &mut ev);
        let off_now = world
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .equipment[GearSlot::Offhand.idx()]
        .is_none();
        assert!(off_now, "an offhand worn under a 2H weapon is shed");
        // The inspect sheet mirrors the weapon into the offhand slot, dimmed.
        let sheet = world.character_sheet(net).unwrap();
        let off = &sheet.equipment[GearSlot::Offhand.idx()];
        assert!(off.2, "the offhand slot is dimmed (2H mirror)");
        assert!(off.1.is_some(), "the dimmed offhand mirrors the weapon");
    }

    /// #91: the accessory + gloves slots — 2 rings (two fingers, the Flask
    /// precedent), a belt, an amulet, gloves — accept their items, the second
    /// ring lands on the OTHER finger (never displacing the first), their affixes
    /// fold into the resolved sheet, and the grown 12-slot array survives a v4
    /// roundtrip.
    #[test]
    fn accessories_occupy_their_own_slots_and_fold_affixes() {
        use crate::entity::{BagItem, Item, PlacedItem, Rarity, RolledAffix};
        use idlin_content::GearSlot;
        let content = content();
        let mut world = World::new(0xACCE_0001, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Jeweler".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let base = |id: &str| content.items.iter().position(|i| i.id == id).unwrap() as u32;
        let hardy = content
            .affixes
            .iter()
            .position(|a| a.id == "hardy")
            .unwrap() as u32;
        // A ring carrying +25 flat life (the `hardy` accessory prefix), so the
        // affix-fold is verifiable through life_max.
        let ring = |val: i64| Item {
            base_idx: base("coral_ring"),
            rarity: Rarity::Magic,
            item_level: 10,
            affixes: vec![RolledAffix {
                affix_idx: hardy,
                value: val,
                tier: 0,
            }],
            name: String::new(),
            charges: 0,
        };
        let plain = |id: &str| Item {
            base_idx: base(id),
            rarity: Rarity::Normal,
            item_level: 1,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
        };
        // Push a bag item and return its index (robust to any starter bag).
        let stash = |world: &mut World, item: Item| -> i32 {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(item),
                x: 0,
                y: 0,
            });
            (ch.inventory.len() - 1) as i32
        };
        let worn = |world: &World, gslot: usize| -> bool {
            world
                .zone
                .get(slot)
                .unwrap()
                .character
                .as_ref()
                .unwrap()
                .equipment[gslot]
                .is_some()
        };
        let life = |world: &World| -> i64 {
            world
                .zone
                .get(slot)
                .unwrap()
                .combat
                .as_ref()
                .unwrap()
                .life_max
        };

        let life0 = life(&world);
        let mut ev = Vec::new();

        // First ring → finger 1; the second → finger 2, NOT over the first.
        let i = stash(&mut world, ring(25));
        assert_eq!(world.equip(slot, i, &mut ev), 0, "first ring equips");
        assert!(worn(&world, GearSlot::RING_SLOTS[0]), "ring on finger 1");
        assert!(
            !worn(&world, GearSlot::RING_SLOTS[1]),
            "finger 2 still free"
        );
        let i = stash(&mut world, ring(25));
        assert_eq!(world.equip(slot, i, &mut ev), 0, "second ring equips");
        assert!(
            worn(&world, GearSlot::RING_SLOTS[0]) && worn(&world, GearSlot::RING_SLOTS[1]),
            "two rings, two fingers — the 2nd never displaces the 1st"
        );

        // Belt, amulet, and gloves are single 1:1 slots.
        for (id, gslot) in [
            ("corded_belt", GearSlot::Belt),
            ("tidal_amulet", GearSlot::Amulet),
            ("kelp_grips", GearSlot::Gloves),
        ] {
            let i = stash(&mut world, plain(id));
            assert_eq!(world.equip(slot, i, &mut ev), 0, "{id} equips");
            assert!(worn(&world, gslot.idx()), "{id} sits in its slot");
        }

        // Both rings' +25 life folded into the resolved sheet (+50 over bare).
        let life_now = life(&world);
        assert_eq!(
            life_now,
            life0 + 50,
            "both rings' +life folded into life_max"
        );

        // v4 snapshot: the grown 12-slot array (accessories, gloves, and all)
        // survives a postcard roundtrip unchanged.
        let bytes = postcard::to_allocvec(&world).expect("serialize");
        let restored: World = postcard::from_bytes(&bytes).expect("deserialize");
        for s in [
            GearSlot::RING_SLOTS[0],
            GearSlot::RING_SLOTS[1],
            GearSlot::Belt.idx(),
            GearSlot::Amulet.idx(),
            GearSlot::Gloves.idx(),
        ] {
            assert!(
                worn(&restored, s),
                "accessory/gloves slot {s} survives the roundtrip"
            );
        }
        assert_eq!(
            life(&restored),
            life_now,
            "resolved life identical after roundtrip"
        );
    }

    /// #91: EquipBest must fill BOTH ring fingers from the bag — the fits-branch
    /// for `RING_SLOTS` is what lets loop 2 (index 8, no enum variant) accept a
    /// ring. Revert that branch and the second finger never fills.
    #[test]
    fn equip_best_fills_both_ring_fingers() {
        use crate::entity::{BagItem, Item, PlacedItem, Rarity};
        use idlin_content::GearSlot;
        let content = content();
        let mut world = World::new(0xACCE_0002, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Collector".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let coral = content
            .items
            .iter()
            .position(|i| i.id == "coral_ring")
            .unwrap() as u32;
        let ring = || Item {
            base_idx: coral,
            rarity: Rarity::Normal,
            item_level: 1,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
        };
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(ring()),
                x: 0,
                y: 0,
            });
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(ring()),
                x: 1,
                y: 0,
            });
        }
        let mut ev = Vec::new();
        world.equip_best(slot, &mut ev);
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert!(
            ch.equipment[GearSlot::RING_SLOTS[0]].is_some()
                && ch.equipment[GearSlot::RING_SLOTS[1]].is_some(),
            "EquipBest fills BOTH ring fingers (the fits-branch covers loop 2)"
        );
    }

    /// #91: the LIVE stock grinder must read all 12 equipment records before it
    /// decides a swap. `upkeep_gear` indexes `EQ + item_slot(num)*16`, and a ring
    /// reports slot 7 — so with the old `read_equipment(EQ, 7)` records 7..11
    /// stayed stale (worn item_level read as 0), making the grinder treat ANY
    /// bag ring as an upgrade and DISPLACE a worn one. With both fingers full of
    /// ilvl-10 rings, a worse ilvl-1 bag ring must never reach a finger.
    #[test]
    fn the_stock_grinder_reads_worn_rings_before_swapping() {
        use crate::entity::{BagItem, Item, PlacedItem, Rarity};
        use idlin_content::GearSlot;
        let content = content();
        let mut world = World::new(0xACCE_0003, &content);
        let program = idlin_botc::template_grinder().expect("template assembles");
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Grinder".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let coral = content
            .items
            .iter()
            .position(|i| i.id == "coral_ring")
            .unwrap() as u32;
        let ring = |ilvl: u32| Item {
            base_idx: coral,
            rarity: Rarity::Normal,
            item_level: ilvl,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
        };
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.equipment[GearSlot::RING_SLOTS[0]] = Some(ring(10));
            ch.equipment[GearSlot::RING_SLOTS[1]] = Some(ring(10));
            ch.inventory.clear();
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(ring(1)),
                x: 0,
                y: 0,
            });
        }
        // The bug CHURNS (it would oscillate the ilvl-1 ring on and off each
        // tick), so a final-state check could pass on an even tick — assert
        // after EVERY tick that no finger ever holds the worse ring.
        for t in 0..8 {
            world.tick(&crate::TickInputs::default());
            let Some(e) = world.zone.get(slot) else { break };
            let Some(ch) = e.character.as_ref() else {
                break;
            };
            for &r in &GearSlot::RING_SLOTS {
                if let Some(worn) = ch.equipment[r].as_ref() {
                    assert_ne!(
                        worn.item_level, 1,
                        "tick {t}: the worse ilvl-1 ring displaced a worn ring \
                         — the grinder read a stale (unwritten) accessory record"
                    );
                }
            }
        }
    }

    /// #91: item_score must value accessory attribute rolls (STR/DEX/INT), which
    /// feed real derived stats — else EquipBest can't rank attribute jewelry and
    /// both rings score 0. With the weight, the STRONGER ring wins the first ring
    /// loop EquipBest processes; revert the attribute weight and the weaker ring
    /// (first in the bag) takes it on the tie-break.
    #[test]
    fn equip_best_ranks_accessories_by_their_attribute_rolls() {
        use crate::entity::{BagItem, Item, PlacedItem, Rarity, RolledAffix};
        use idlin_content::GearSlot;
        let content = content();
        let mut world = World::new(0xACCE_0004, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Appraiser".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let coral = content
            .items
            .iter()
            .position(|i| i.id == "coral_ring")
            .unwrap() as u32;
        let bold = content.affixes.iter().position(|a| a.id == "bold").unwrap() as u32;
        // Two coral rings, identical but for the +STR roll.
        let ring = |strength: i64| Item {
            base_idx: coral,
            rarity: Rarity::Magic,
            item_level: 10,
            affixes: vec![RolledAffix {
                affix_idx: bold,
                value: strength,
                tier: 0,
            }],
            name: String::new(),
            charges: 0,
        };
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.equipment[GearSlot::RING_SLOTS[0]] = None;
            ch.equipment[GearSlot::RING_SLOTS[1]] = None;
            ch.inventory.clear();
            // Weak ring FIRST so the tie-break (without the weight) would pick it.
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(ring(4)),
                x: 0,
                y: 0,
            });
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(ring(24)),
                x: 1,
                y: 0,
            });
        }
        let mut ev = Vec::new();
        world.equip_best(slot, &mut ev);
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        let worn_str = ch.equipment[GearSlot::RING_SLOTS[0]]
            .as_ref()
            .expect("first ring loop is filled")
            .affixes[0]
            .value;
        assert_eq!(
            worn_str, 24,
            "EquipBest put the higher-STR ring in the first loop (item_score values attributes)"
        );
    }

    /// #63: move_item must reject out-of-grid bot coordinates with -1, never
    /// overflow `x + w` (debug panic / release wrap). The x=255 case panics in
    /// debug if the u16-widened bounds check is reverted — so this test pins it.
    #[test]
    fn move_item_rejects_overflowing_coords_without_panicking() {
        use crate::entity::{BAG_H, BAG_W, BagItem, Item, PlacedItem, Rarity};
        let content = content();
        let mut world = World::new(0x303, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            arrivals: Vec::new(),
            joins: vec![crate::JoinRequest {
                name: "Packer".into(),
                program,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        // A 2×2 base (the buckler) at the top-left, so w=h=2 exercises the math.
        let buckler = content
            .items
            .iter()
            .position(|i| i.id == "driftwood_buckler")
            .unwrap() as u32;
        assert_eq!(
            (
                content.items[buckler as usize].w,
                content.items[buckler as usize].h
            ),
            (2, 2),
            "test assumes a 2×2 buckler"
        );
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(Item {
                    base_idx: buckler,
                    rarity: Rarity::Normal,
                    item_level: 1,
                    affixes: Vec::new(),
                    name: String::new(),
                    charges: 0,
                }),
                x: 0,
                y: 0,
            });
        }
        // The overflow case: a hostile coord must be rejected, not panic/wrap.
        // x=255 and y=255 are pinned independently so a one-sided regression (only
        // the x term or only the y term left in u8) still fails this test.
        assert_eq!(world.move_item(slot, 0, 255, 255), -1, "far OOB → -1");
        assert_eq!(world.move_item(slot, 0, 255, 0), -1, "x overflow → -1");
        assert_eq!(world.move_item(slot, 0, 0, 255), -1, "y overflow → -1");
        // One past the right/bottom edge for a 2×2 (BAG_W-1 / BAG_H-1).
        assert_eq!(
            world.move_item(slot, 0, BAG_W - 1, 0),
            -1,
            "x one past edge → -1"
        );
        assert_eq!(
            world.move_item(slot, 0, 0, BAG_H - 1),
            -1,
            "y one past edge → -1"
        );
        // Exact bottom-right fit for a 2×2 is accepted.
        assert_eq!(
            world.move_item(slot, 0, BAG_W - 2, BAG_H - 2),
            0,
            "exact bottom-right fit is allowed"
        );
    }

    #[test]
    fn mana_mult_scales_skill_cost() {
        let content = content();
        let world = World::new(1, &content);
        let bare = SocketedGem {
            gem: instance(&content, "cleave", 1),
            cooldown_left: 0,
            supports: Vec::new(),
        };
        // Cleave: 4 mana. Split Quiver (130%) then Widening (115%):
        // 4 → 5 → 5 with integer truncation at each step.
        let mut supported = bare.clone();
        supported
            .supports
            .push(instance(&content, "split_quiver", 1));
        supported.supports.push(instance(&content, "widening", 1));
        assert_eq!(world.skill_mana_cost(&bare), 4);
        assert_eq!(world.skill_mana_cost(&supported), 5);
    }

    /// #52 / #54 PR3: a melee grinder must never socket a bow skill gem (it
    /// could never swing it). We seed ONLY a bow gem (power_shot) in town
    /// (saltmere — no monsters, so no scripted drops, so the First Spark socket
    /// stays EMPTY the whole window). An empty socket would accept any skill if
    /// the grinder socketed indiscriminately — the melee build must leave the
    /// bow gem. Fails if the whitelist regresses (verified by mutation: adding
    /// power_shot to the grinder's plan makes this fail). The melee-skill path
    /// is covered by `bots_grind_the_shore` / the tutorial.
    #[test]
    fn grinder_skips_a_bow_gem_on_a_melee_build() {
        let content = content();
        let mut world = World::new_for_zone(0x52F1, &content, "saltmere");
        let program = idlin_botc::template_grinder().expect("template assembles");
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Melee".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            bag_gem(ch, &content, "power_shot"); // bow skill — must be skipped
        }
        let empty = crate::TickInputs::default();
        let mut socketed_bow = false;
        for _ in 0..30 {
            for ev in world.tick(&empty) {
                if let SimEvent::GemSocketed { gem, .. } = ev
                    && gem == "Power Shot"
                {
                    socketed_bow = true;
                }
            }
        }
        assert!(
            !socketed_bow,
            "a melee build must NOT socket the bow skill, even into an empty socket (#52)"
        );
    }

    /// #54 PR3 syscalls: `item_slot` maps gear nums to their slot and rejects
    /// everything else; `equip` handles hostile/out-of-range input with -1, never
    /// a panic, and a real gear item lands in its slot.
    #[test]
    fn equip_and_item_slot_reject_bad_input() {
        use idlin_content::ids::Category;
        let content = content();
        let mut world = World::new(9, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Tester".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();

        let cleaver_idx = content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap();
        let cleaver_num = content.content_num(Category::Item, cleaver_idx).unwrap();
        let cleave_gem_num = content
            .content_num(
                Category::Gem,
                content.gems.iter().position(|g| g.id == "cleave").unwrap(),
            )
            .unwrap();
        // item_slot: a gear num → its slot; a gem / unknown / negative → -1.
        assert_eq!(
            world.item_slot_of_num(cleaver_num),
            idlin_content::GearSlot::Weapon.idx() as i32
        );
        assert_eq!(
            world.item_slot_of_num(cleave_gem_num),
            -1,
            "a gem has no slot"
        );
        assert_eq!(world.item_slot_of_num(-1), -1);
        assert_eq!(world.item_slot_of_num(0), -1);
        assert_eq!(world.item_slot_of_num(i32::MAX), -1);

        // equip: out-of-range / negative / empty bag / a gem all return -1.
        let mut ev = Vec::new();
        assert_eq!(world.equip(slot, -1, &mut ev), -1);
        assert_eq!(world.equip(slot, i32::MAX, &mut ev), -1);
        assert_eq!(
            world.equip(slot, 0, &mut ev),
            -1,
            "empty bag → nothing to equip"
        );
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            bag_gem(ch, &content, "cleave"); // a gem at index 0
            ch.inventory.push(crate::entity::PlacedItem {
                item: crate::entity::BagItem::Gear(crate::entity::Item {
                    base_idx: cleaver_idx as u32,
                    rarity: crate::entity::Rarity::Normal,
                    item_level: 1,
                    affixes: Vec::new(),
                    name: String::new(),
                    charges: 0,
                }),
                x: 5,
                y: 0,
            });
        }
        assert_eq!(world.equip(slot, 0, &mut ev), -1, "a gem can't be equipped");
        // The real cleaver (index 1) equips and lands in the weapon slot.
        assert_eq!(world.equip(slot, 1, &mut ev), 0, "the cleaver equips");
        assert!(
            world
                .zone
                .get(slot)
                .unwrap()
                .character
                .as_ref()
                .unwrap()
                .equipment[idlin_content::GearSlot::Weapon.idx()]
            .is_some(),
            "the weapon slot is now filled"
        );
    }

    /// #54 PR3: `unequip` bares a slot to the bag, guards bad input, and — the
    /// headline — REFUSES (leaving the item worn) when the bag is full instead of
    /// dropping it (unlike `equip`'s swap).
    #[test]
    fn unequip_moves_gear_to_the_bag_and_refuses_when_full() {
        let content = content();
        let mut world = World::new(21, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Bare".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let cleaver_idx = content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap() as u32;
        let wpn = idlin_content::GearSlot::Weapon.idx();
        let wear_cleaver = |world: &mut World| {
            world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap()
                .equipment[wpn] = Some(crate::entity::Item {
                base_idx: cleaver_idx,
                rarity: crate::entity::Rarity::Normal,
                item_level: 1,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
            });
        };
        wear_cleaver(&mut world);

        let mut ev = Vec::new();
        // Bad input: out-of-range / negative slot → -1, no panic.
        assert_eq!(world.unequip(slot, -1, &mut ev), -1);
        assert_eq!(world.unequip(slot, 99, &mut ev), -1);
        // An empty slot → -1.
        assert_eq!(
            world.unequip(slot, idlin_content::GearSlot::Helm.idx() as i32, &mut ev),
            -1,
            "the helm slot is empty"
        );
        // Bare the weapon: slot empties, the cleaver lands in the bag.
        assert_eq!(world.unequip(slot, wpn as i32, &mut ev), 0);
        {
            let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
            assert!(ch.equipment[wpn].is_none(), "weapon slot bared");
            assert!(
                ch.inventory
                    .iter()
                    .any(|p| p.item.as_gear().is_some_and(|g| g.base_idx == cleaver_idx)),
                "the cleaver is back in the bag"
            );
        }

        // Re-wear, then FILL the bag (12×5 = 60 cells) — unequip must refuse and
        // leave the cleaver equipped rather than drop it.
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            let i = ch
                .inventory
                .iter()
                .position(|p| p.item.as_gear().is_some_and(|g| g.base_idx == cleaver_idx))
                .unwrap();
            ch.inventory.remove(i);
        }
        wear_cleaver(&mut world);
        for _ in 0..60 {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            bag_gem(ch, &content, "cleave");
        }
        let n_full = world
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .inventory
            .len();
        assert_eq!(
            world.unequip(slot, wpn as i32, &mut ev),
            -1,
            "full bag → refuse"
        );
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert!(
            ch.equipment[wpn].is_some(),
            "the cleaver stays equipped when the bag is full"
        );
        assert_eq!(
            ch.inventory.len(),
            n_full,
            "nothing was added to the full bag"
        );
    }

    /// #54 PR3: a deliberate `equip` never DROPS the displaced piece. Swapping a
    /// smaller weapon (cleaver, 2×3) in for a larger worn one (bow, 2×4) when the
    /// bag can't re-home the bow must REFUSE (-1) and leave both in place — not
    /// drop the bow. (`equip_best` would still juggle by dropping; this is the
    /// manual contract.)
    #[test]
    fn equip_refuses_a_swap_that_would_drop_the_displaced_item() {
        use crate::entity::{BAG_H, BAG_W, BagItem, Item, PlacedItem, Rarity};
        let content = content();
        let mut world = World::new(0x533, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Packed".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let item_base = |id: &str| content.items.iter().position(|i| i.id == id).unwrap() as u32;
        let bow = item_base("driftwood_bow"); // 2×4 worn fixture
        let cleaver = item_base("rusted_cleaver"); // 2×3 replacement (no reqs)
        let wpn = idlin_content::GearSlot::Weapon.idx();
        let gear = |base_idx: u32| Item {
            base_idx,
            rarity: Rarity::Normal,
            item_level: 1,
            affixes: Vec::new(),
            name: String::new(),
            charges: 0,
        };
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.equipment[wpn] = Some(gear(bow)); // wear the larger bow
            // The cleaver (replacement) at the top-left 2×3; gems pack the rest.
            ch.inventory.push(PlacedItem {
                item: BagItem::Gear(gear(cleaver)),
                x: 0,
                y: 0,
            });
            for y in 0..BAG_H {
                for x in 0..BAG_W {
                    if x < 2 && y < 3 {
                        continue; // reserved for the cleaver's 2×3
                    }
                    ch.inventory.push(PlacedItem {
                        item: BagItem::Gem(instance(&content, "cleave", 1)),
                        x,
                        y,
                    });
                }
            }
        }
        let mut ev = Vec::new();
        // Equipping the cleaver would displace the bow; freeing the cleaver's
        // 2×3 leaves no 2×4 region, so the bow can't re-home → refuse.
        assert_eq!(
            world.equip(slot, 0, &mut ev),
            -1,
            "the swap refuses when the displaced bow can't re-home"
        );
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(
            ch.equipment[wpn].as_ref().unwrap().base_idx,
            bow,
            "the bow stays equipped — not dropped"
        );
        assert!(
            ch.inventory
                .iter()
                .any(|p| p.item.as_gear().is_some_and(|g| g.base_idx == cleaver)),
            "the cleaver stays in the bag"
        );
    }

    /// #54 PR3: ReadEquipment's record layout — one `[slot, base_num/-1, rarity,
    /// item_level]` per gear slot, empty slots reporting base_num -1, `max`
    /// honored. Pins the host-side struct a bot reads.
    #[test]
    fn equipment_records_report_every_slot() {
        use idlin_content::ids::Category;
        let content = content();
        let mut world = World::new(11, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Worn".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let cleaver_idx = content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap();
        let cleaver_num = content.content_num(Category::Item, cleaver_idx).unwrap();
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] = Some(crate::entity::Item {
                base_idx: cleaver_idx as u32,
                rarity: crate::entity::Rarity::Magic,
                item_level: 7,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
            });
        }
        let recs = world.equipment_records(slot, crate::entity::GEAR_SLOTS);
        assert_eq!(
            recs.len(),
            crate::entity::GEAR_SLOTS,
            "one record per gear slot"
        );
        assert_eq!(
            recs[0],
            [0, cleaver_num, crate::entity::Rarity::Magic as i32, 7],
            "the worn weapon: slot, num, rarity, item_level"
        );
        for (i, rec) in recs.iter().enumerate().skip(1) {
            assert_eq!(*rec, [i as i32, -1, 0, 0], "empty slot {i} → base_num -1");
        }
        // The `max` argument clamps the record count.
        assert_eq!(
            world.equipment_records(slot, 2).len(),
            2,
            "max clamps the record count"
        );
    }

    /// #42/#74: the shared `resolve_skill` is the executor's source of truth.
    /// Pin its contract: an ATTACK scales the weapon by the gem coefficient, a
    /// SPELL ignores the weapon entirely, and crit folds the attacker's global
    /// increased-crit. (The executor staying byte-for-byte — golden unchanged —
    /// proves the extraction; this pins the resolver's own behavior.)
    #[test]
    fn resolve_skill_is_consistent() {
        let content = content();
        let mut world = World::new(0x4242, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Resolver".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        let hs = gem_idx(&content, "heavy_swing"); // attack (weapon coeff > 0)
        let arc = gem_idx(&content, "arc"); // spell (ignores the weapon)

        let set_weapon = |world: &mut World, phys: i64, crit_inc: i64| {
            let c = world.zone.get_mut(slot).unwrap().combat.as_mut().unwrap();
            c.damage = [phys, 0, 0, 0, 0];
            c.crit_inc = crit_inc;
        };
        let socket = |world: &mut World, gem: u32| {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.allocated = vec![node];
            ch.sockets.clear();
            ch.sockets.insert(
                node,
                SocketedGem {
                    gem: GemInstance {
                        gem_idx: gem,
                        level: 1,
                        xp: 0,
                    },
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
        };

        // Attack: its damage rises with the weapon's damage (coefficient scaling).
        socket(&mut world, hs);
        set_weapon(&mut world, 10000, 10000);
        let atk_lo = world
            .resolve_skill(slot, node)
            .unwrap()
            .spec_template
            .damage[0];
        set_weapon(&mut world, 20000, 10000);
        let atk_hi = world
            .resolve_skill(slot, node)
            .unwrap()
            .spec_template
            .damage[0];
        assert!(
            atk_hi > atk_lo,
            "an attack scales with the weapon ({atk_lo} → {atk_hi})"
        );

        // Spell: damage is the gem's OWN flat (its lightning add), not the
        // weapon — even with a huge weapon the resolved lightning equals arc's
        // added_lightning at level 1, and no weapon phys leaks in. (No spell in
        // content carries a weapon coefficient, so this pins the flat path.)
        socket(&mut world, arc);
        set_weapon(&mut world, 999_999, 10000);
        let arc_dmg = world
            .resolve_skill(slot, node)
            .unwrap()
            .spec_template
            .damage;
        let arc_light = content.gems[arc as usize].added_lightning.at(1);
        assert!(arc_light > 0, "arc has flat lightning to check");
        assert_eq!(arc_dmg[3], arc_light, "a spell's damage is its gem flat");
        assert_eq!(
            arc_dmg[0], 0,
            "the weapon's phys does not leak into a spell"
        );

        // Crit folds the global increase: crit_bp = gem.crit_bp × crit_inc / 10000.
        socket(&mut world, hs);
        set_weapon(&mut world, 10000, 20000);
        let r = world.resolve_skill(slot, node).unwrap();
        let gem_crit = content.gems[hs as usize].crit_bp;
        assert_eq!(
            r.spec_template.crit_bp,
            gem_crit * 20000 / 10000,
            "crit folds the attacker's global increase"
        );
    }

    #[test]
    fn skill_stat_view_reports_dps_and_timing_from_the_pipeline() {
        let content = content();
        let mut world = World::new(0x7BD, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Statter".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let node = content
            .tree
            .iter()
            .position(|n| n.kind == idlin_content::NodeKind::Socket)
            .unwrap() as u32;
        let hs = gem_idx(&content, "heavy_swing");
        let arc = gem_idx(&content, "arc");
        let socket = |world: &mut World, gem: u32| {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.allocated = vec![node];
            ch.sockets.clear();
            ch.sockets.insert(
                node,
                SocketedGem {
                    gem: GemInstance {
                        gem_idx: gem,
                        level: 1,
                        xp: 0,
                    },
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
        };
        let set_weapon = |world: &mut World, phys: i64, crit_inc: i64| {
            let c = world.zone.get_mut(slot).unwrap().combat.as_mut().unwrap();
            c.damage = [phys, 0, 0, 0, 0];
            c.crit_inc = crit_inc;
        };

        // Attack with real weapon damage + a doubled global crit.
        socket(&mut world, hs);
        set_weapon(&mut world, 30000, 20000);
        let v = world.skill_stat_view(slot, node).unwrap();
        let r = world.resolve_skill(slot, node).unwrap();

        // The view's per-hit damage IS the resolver's (one source of truth).
        assert_eq!(v.damage, r.spec_template.damage);
        assert!(!v.is_spell, "heavy_swing is an attack");
        assert!(v.use_ticks >= 2, "use time is real");

        // DPS = Σdamage × average-crit factor × hits/sec — derived here from the
        // resolver's own outputs + the view's use time, so a bug in the view's
        // dps expression (lost crit factor, wrong divisor) breaks this.
        let total: i64 = r.spec_template.damage.iter().sum();
        let crit = r.spec_template.crit_bp.min(CRIT_CHANCE_CAP_BP);
        let crit_factor = 10000 + crit * (r.spec_template.crit_multi - 10000) / 10000;
        let expect =
            total * crit_factor * crate::world::TICK_HZ as i64 / (10000 * v.use_ticks as i64);
        assert_eq!(
            v.dps, expect,
            "dps tracks resolved damage / use time / crit"
        );
        if crit_factor > 10000 {
            let no_crit = total * crate::world::TICK_HZ as i64 / v.use_ticks as i64;
            assert!(v.dps > no_crit, "crit lifts dps over the no-crit baseline");
        }

        // DPS scales with weapon damage.
        let dps_lo = v.dps;
        set_weapon(&mut world, 60000, 20000);
        let dps_hi = world.skill_stat_view(slot, node).unwrap().dps;
        assert!(
            dps_hi > dps_lo,
            "doubling weapon damage raises dps ({dps_lo} → {dps_hi})"
        );

        // Crit chance is capped exactly where the executor caps the roll, so
        // the panel never promises crit the sim won't deliver.
        set_weapon(&mut world, 30000, 2_000_000);
        let uncapped = world
            .resolve_skill(slot, node)
            .unwrap()
            .spec_template
            .crit_bp;
        let capped = world.skill_stat_view(slot, node).unwrap();
        assert!(
            uncapped > CRIT_CHANCE_CAP_BP,
            "the test drives crit past the cap"
        );
        assert_eq!(
            capped.crit_chance_bp, CRIT_CHANCE_CAP_BP,
            "the panel caps crit where the executor's roll caps"
        );
        // And DPS uses the CAPPED crit too — not just the displayed chance. A
        // regression that capped the chance but fed uncapped crit into the dps
        // factor would equal `dps_if_uncapped` and break the equality below.
        let cap_total: i64 = capped.damage.iter().sum();
        let cap_factor = 10000 + CRIT_CHANCE_CAP_BP * (capped.crit_multi_bp - 10000) / 10000;
        let expect_capped = cap_total * cap_factor * crate::world::TICK_HZ as i64
            / (10000 * capped.use_ticks as i64);
        assert_eq!(capped.dps, expect_capped, "dps uses the capped crit chance");
        let uncapped_factor = 10000 + uncapped * (capped.crit_multi_bp - 10000) / 10000;
        let dps_if_uncapped = cap_total * uncapped_factor * crate::world::TICK_HZ as i64
            / (10000 * capped.use_ticks as i64);
        assert!(
            dps_if_uncapped > capped.dps,
            "uncapped crit would overstate dps ({dps_if_uncapped} vs {})",
            capped.dps
        );

        // A spell reports as a spell with its own flat damage (no weapon leak).
        socket(&mut world, arc);
        set_weapon(&mut world, 999_999, 10000);
        let vs = world.skill_stat_view(slot, node).unwrap();
        assert!(vs.is_spell, "arc is a spell");
        assert_eq!(
            vs.damage[0], 0,
            "no weapon phys leaks into a spell's stat block"
        );
        assert!(vs.dps > 0, "a damaging spell has dps");

        // Gem XP passthrough: the view reports the socketed gem's own progress
        // (and each support's), with xp-to-next from the curve (0 at the cap).
        let hb = gem_idx(&content, "heavier_blows");
        socket(&mut world, hs);
        if let Some(sg) = world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .sockets
            .get_mut(&node)
        {
            sg.gem.xp = 55;
            sg.supports.push(GemInstance {
                gem_idx: hb,
                level: 3,
                xp: 25,
            });
        }
        let xv = world.skill_stat_view(slot, node).unwrap();
        assert_eq!(xv.xp, 55, "the view reports the gem's xp");
        assert_eq!(
            xv.xp_next,
            crate::entity::gem_xp_to_next(xv.level),
            "xp-to-next comes from the curve below the cap"
        );
        assert!(
            xv.xp_next > 0,
            "a sub-cap gem has xp remaining to the next level"
        );
        // The support's own progress is reported too (name, level, xp, xp-next).
        assert_eq!(xv.supports.len(), 1);
        assert_eq!(xv.supports[0].2, 25, "the support's xp passes through");
        assert_eq!(
            xv.supports[0].3,
            crate::entity::gem_xp_to_next(3),
            "the support's xp-to-next comes from the curve"
        );

        // At the level cap, xp-to-next is 0 (the gold/MAX state) — for the skill
        // and its support.
        if let Some(sg) = world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .sockets
            .get_mut(&node)
        {
            sg.gem.level = crate::entity::GEM_LEVEL_CAP;
            sg.supports[0].level = crate::entity::GEM_LEVEL_CAP;
        }
        let maxed = world.skill_stat_view(slot, node).unwrap();
        assert_eq!(maxed.xp_next, 0, "a capped skill gem has no xp-to-next");
        assert_eq!(
            maxed.supports[0].3, 0,
            "a capped support gem has no xp-to-next"
        );
    }
}
