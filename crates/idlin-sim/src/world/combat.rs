//! Attack resolution: cooldowns, weapon and skill-gem swings, and the shared
//! `strike` path every hit funnels through (hit roll, variance, mitigation,
//! death handling). Sequential in slot order — earlier attackers can kill a
//! target before later ones swing.

use super::{RESPAWN_TICKS, SimEvent, World, XP_SHARE_RADIUS, fx_from_cu};
use crate::entity::{AttackIntent, DMG_COUNT, DMG_PHYS, LootPayload, gem_scale_bp};
use crate::fixed::FxV2;
use crate::stats::{Grant, Stat, StatSheet, apply_resist, hit_chance_bp, mitigate_phys};
use idlin_content::{GemKind, SkillShape};

impl World {
    pub(super) fn attacks(&mut self, events: &mut Vec<SimEvent>) {
        // Cooldowns tick down first (weapon and every socketed skill).
        for slot in 0..self.zone.slot_count() {
            if let Some(e) = self.zone.get_mut(slot) {
                if let Some(c) = e.combat.as_mut() {
                    c.cooldown_left = c.cooldown_left.saturating_sub(1);
                }
                if let Some(ch) = e.character.as_mut() {
                    for sg in ch.sockets.values_mut() {
                        sg.cooldown_left = sg.cooldown_left.saturating_sub(1);
                    }
                }
            }
        }

        // Sequential resolution in slot order: earlier attackers can kill a
        // target before later ones swing. Deterministic and simple.
        let mut dead_monsters: Vec<(usize, u32)> = Vec::new(); // (slot, bot idx)
        let mut loot_spawns: Vec<(FxV2, LootPayload, u32, String)> = Vec::new();
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
            let Some(combat) = &e.combat else { continue };
            let attacker_net = e.net_id;
            let attacker_faction = e.faction();
            let attacker_name = match (&e.character, &e.monster) {
                (Some(c), _) => c.name.clone(),
                (_, Some(m)) => self.monster_def(m.def_idx).name.clone(),
                _ => continue,
            };
            let attacker_is_char = e.character.is_some();
            let (pos, char_damage, accuracy, weapon_range, weapon_projectile, weapon_cd) = (
                e.pos,
                combat.damage,
                combat.accuracy,
                combat.range,
                combat.projectile,
                combat.cooldown_ticks,
            );

            match skill {
                None => {
                    // Basic weapon attack.
                    if combat.cooldown_left > 0 {
                        continue;
                    }
                    let Some(target_slot) = self.zone.slot_of(target) else {
                        continue;
                    };
                    let Some(t) = self.zone.get(target_slot) else {
                        continue;
                    };
                    if !t.alive()
                        || !attacker_faction.is_enemy_of(t.faction())
                        || pos.dist(t.pos) > weapon_range
                        || self.los_blocked(pos, t.pos)
                    {
                        continue;
                    }
                    self.strike(
                        slot,
                        attacker_net,
                        &attacker_name,
                        attacker_is_char,
                        accuracy,
                        char_damage,
                        weapon_projectile,
                        target_slot,
                        now,
                        events,
                        &mut dead_monsters,
                        &mut loot_spawns,
                    );
                    if let Some(me) = self.zone.get_mut(slot)
                        && let Some(c) = me.combat.as_mut()
                    {
                        c.cooldown_left = weapon_cd;
                        c.last_combat_tick = now;
                    }
                }
                Some(node) => {
                    // Socketed skill gem.
                    let Some(ch) = &e.character else { continue };
                    let Some(sg) = ch.sockets.get(&node) else {
                        continue;
                    };
                    if sg.cooldown_left > 0 {
                        continue;
                    }
                    let gem_def = &self.content.gems[sg.gem.gem_idx as usize];
                    if gem_def.kind != GemKind::Skill {
                        continue;
                    }
                    let scale = gem_scale_bp(sg.gem.level);

                    // Supports socketed in this gem apply their grants
                    // (each scaled by its own level).
                    let mut sheet = StatSheet::new();
                    for sup in &sg.supports {
                        let sdef = &self.content.gems[sup.gem_idx as usize];
                        let sscale = gem_scale_bp(sup.level);
                        for g in &sdef.grants {
                            sheet.apply(&Grant {
                                stat: g.stat,
                                layer: g.layer,
                                value: g.value * sscale / 10000,
                            });
                        }
                    }

                    let added = [
                        gem_def.added_phys,
                        gem_def.added_fire,
                        gem_def.added_cold,
                        gem_def.added_lightning,
                        gem_def.added_chaos,
                    ];
                    let mut damage = [0i64; DMG_COUNT];
                    let stats = [
                        Stat::DamagePhys,
                        Stat::DamageFire,
                        Stat::DamageCold,
                        Stat::DamageLightning,
                        Stat::DamageChaos,
                    ];
                    for i in 0..DMG_COUNT {
                        let base =
                            char_damage[i] * gem_def.coeff_bp / 10000 + added[i] * scale / 10000;
                        damage[i] = sheet.value(stats[i], base);
                    }
                    let range = if gem_def.range_cu > 0 {
                        fx_from_cu(gem_def.range_cu)
                    } else {
                        weapon_range
                    };
                    let speed_factor = sheet.value(Stat::AttackSpeed, 10000).max(1000);
                    let cooldown =
                        ((gem_def.cooldown_ticks as i64 * 10000 / speed_factor).max(2)) as u32;
                    let projectile = gem_def.projectile || weapon_projectile;
                    let (shape, radius, max_targets) = (
                        gem_def.shape,
                        fx_from_cu(gem_def.radius_cu),
                        gem_def.max_targets,
                    );

                    let mut swung = false;
                    match shape {
                        SkillShape::Target => {
                            if let Some(target_slot) = self.zone.slot_of(target)
                                && let Some(t) = self.zone.get(target_slot)
                                && t.alive()
                                && attacker_faction.is_enemy_of(t.faction())
                                && pos.dist(t.pos) <= range
                                && !self.los_blocked(pos, t.pos)
                            {
                                self.strike(
                                    slot,
                                    attacker_net,
                                    &attacker_name,
                                    attacker_is_char,
                                    accuracy,
                                    damage,
                                    projectile,
                                    target_slot,
                                    now,
                                    events,
                                    &mut dead_monsters,
                                    &mut loot_spawns,
                                );
                                swung = true;
                            }
                        }
                        SkillShape::Nova => {
                            // Everything hostile around the attacker, nearest
                            // first, capped — deterministic (d², net id) order.
                            let rr = radius.raw() as i64 * radius.raw() as i64;
                            let mut victims: Vec<(i64, u32, usize)> = Vec::new();
                            for (ts, te) in self.zone.iter() {
                                if !te.alive() || !attacker_faction.is_enemy_of(te.faction()) {
                                    continue;
                                }
                                let dx = (te.pos.x - pos.x).raw() as i64;
                                let dy = (te.pos.y - pos.y).raw() as i64;
                                let d2 = dx * dx + dy * dy;
                                if d2 <= rr && !self.los_blocked(pos, te.pos) {
                                    victims.push((d2, te.net_id, ts));
                                }
                            }
                            victims.sort_unstable();
                            for &(_, _, target_slot) in victims.iter().take(max_targets as usize) {
                                self.strike(
                                    slot,
                                    attacker_net,
                                    &attacker_name,
                                    attacker_is_char,
                                    accuracy,
                                    damage,
                                    false,
                                    target_slot,
                                    now,
                                    events,
                                    &mut dead_monsters,
                                    &mut loot_spawns,
                                );
                                swung = true;
                            }
                        }
                    }

                    if swung && let Some(me) = self.zone.get_mut(slot) {
                        if let Some(ch) = me.character.as_mut()
                            && let Some(sg) = ch.sockets.get_mut(&node)
                        {
                            sg.cooldown_left = cooldown;
                        }
                        if let Some(c) = me.combat.as_mut() {
                            c.last_combat_tick = now;
                        }
                    }
                }
            }
        }

        // The dead stay where they fell: free the brain immediately (the
        // arena slot may be reused), mark the corpse for decay, and let
        // respawns() sweep it later. Corpses fail alive(), so every other
        // system already ignores them.
        for (slot, bot_idx) in dead_monsters {
            if bot_idx != u32::MAX {
                self.bots.remove(bot_idx);
            }
            if let Some(e) = self.zone.get_mut(slot) {
                e.bot = None;
                e.intents = Default::default();
                if let Some(m) = e.monster.as_mut() {
                    m.decay_at = Some(now + super::CORPSE_TICKS);
                }
            }
        }
        for (pos, payload, owner, owner_name) in loot_spawns {
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

    /// One attack landing on one target: hit roll, variance, per-type
    /// mitigation, death handling (XP, loot roll, pack bookkeeping).
    #[allow(clippy::too_many_arguments)]
    fn strike(
        &mut self,
        attacker_slot: usize,
        attacker_net: u32,
        attacker_name: &str,
        attacker_is_char: bool,
        accuracy: i64,
        damage: [i64; DMG_COUNT],
        projectile: bool,
        target_slot: usize,
        now: u64,
        events: &mut Vec<SimEvent>,
        dead_monsters: &mut Vec<(usize, u32)>,
        loot_spawns: &mut Vec<(FxV2, LootPayload, u32, String)>,
    ) {
        let Some(t) = self.zone.get(target_slot) else {
            return;
        };
        if !t.alive() {
            return; // an earlier strike this phase may have killed it
        }
        let target_net = t.net_id;
        let tc_ro = t.combat.as_ref().unwrap();
        let (t_evasion, t_armour, t_resists) = (tc_ro.evasion, tc_ro.armour, tc_ro.resists);

        // Hit roll: accuracy vs evasion. A miss still marks combat.
        let hit = (self.rng_combat.next_range(10000) as i64) < hit_chance_bp(accuracy, t_evasion);

        let mut amount = 0i64;
        let mut dmg_type = 0u8;
        if hit {
            // One variance roll (75%..=125%) applied to every component, then
            // per-type mitigation: the armour curve for phys, capped typed
            // resistances for everything else.
            let variance = 75 + self.rng_combat.next_range(51) as i64;
            let mut taken = [0i64; DMG_COUNT];
            taken[DMG_PHYS] = mitigate_phys(damage[DMG_PHYS] * variance / 100, t_armour);
            for i in 1..DMG_COUNT {
                taken[i] = apply_resist(damage[i] * variance / 100, t_resists[i - 1]);
            }
            amount = taken.iter().sum::<i64>().max(1);
            // Dominant component drives the client's damage-number color
            // (0 phys, 1 fire, 2 cold, 3 lightning, 4 chaos).
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
        tc.life -= amount;
        tc.last_combat_tick = now;
        let killed = tc.life <= 0;
        events.push(SimEvent::Hit {
            attacker: attacker_net,
            target: target_net,
            amount,
            dmg_type,
            projectile,
            killed,
        });

        if killed {
            let target_pos = t.pos;
            if let Some(m) = &t.monster {
                let (def_idx, pack_idx) = (m.def_idx, m.pack_idx);
                let target_bot = t.bot;
                let def = self.monster_def(def_idx);
                let (monster_name, monster_level, xp) = (def.name.clone(), def.level, def.xp);
                dead_monsters.push((target_slot, target_bot.unwrap_or(u32::MAX)));
                let pack = &mut self.zone.packs[pack_idx as usize];
                pack.alive = pack.alive.saturating_sub(1);
                // Packs respawn as a unit: the timer starts only once the
                // whole pack has been wiped.
                if pack.alive == 0 {
                    pack.respawn_timer = pack.def.respawn_ticks;
                }
                if attacker_is_char {
                    events.push(SimEvent::MonsterKilled {
                        killer_id: attacker_net,
                        killer: attacker_name.to_string(),
                        monster: monster_name,
                        level: monster_level,
                    });
                    // Loot roll (personal: owned by the killer).
                    if self.rng_loot.next_range(100) < 35
                        && let Some(payload) = self.roll_drop(monster_level)
                    {
                        loot_spawns.push((
                            target_pos,
                            payload,
                            attacker_net,
                            attacker_name.to_string(),
                        ));
                    }
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
            } else if let Some(ch) = &mut t.character {
                ch.respawn_at = Some(now + RESPAWN_TICKS);
                let (id, name) = (t.net_id, ch.name.clone());
                t.intents = Default::default();
                events.push(SimEvent::CharacterDied {
                    id,
                    name,
                    killer: attacker_name.to_string(),
                });
            }
        }
    }
}
