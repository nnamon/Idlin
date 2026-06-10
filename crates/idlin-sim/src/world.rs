//! The world: one zone (Phase 1), its entities, and the bots driving every
//! acting thing in it — player characters and NPCs alike. The engine runs
//! content; behavior lives in brain programs, stats and layout in RON. The
//! fixed-order tick pipeline must be bit-exact for identical (seed, content,
//! input history) on every platform.

use crate::bots::{Bot, BotArena, program_hash};
use crate::entity::{
    CharacterState, Class, CombatStats, Entity, GEAR_SLOTS, INVENTORY_CAP, Item, LootState,
    MonsterState, Rarity,
};
use crate::fixed::{Fx, FxV2};
use crate::hash::Fnv1a64;
use crate::rng::{Domain, Pcg32};
use crate::zone::{PackState, Zone};
use idlin_content::{ContentDb, GearSlot, MonsterDef};
use idlin_vm::Vm;
use serde::{Deserialize, Serialize};

/// Sim ticks per second. The protocol never assumes this; it ships tick
/// numbers, so the rate can change without breaking clients.
pub const TICK_HZ: u32 = 10;
/// Ticks a dead character waits before respawning.
pub const RESPAWN_TICKS: u64 = 50;
/// Ground loot lifetime.
pub const LOOT_DESPAWN_TICKS: u64 = 600;
/// How close a character must be to grab loot.
pub const PICKUP_RANGE: Fx = Fx::from_raw(0x2_8000); // 2.5 u
/// Ticks out of combat before regeneration kicks in.
pub const REGEN_DELAY_TICKS: u64 = 50;

/// Inputs applied at the start of a tick. Everything entering the world goes
/// through here — never by mutating state directly.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TickInputs {
    pub joins: Vec<JoinRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JoinRequest {
    pub name: String,
    pub class: Class,
    /// Assembled, versioned VM bytecode (a template for chat players).
    pub program: Vec<u8>,
}

/// Things that happened during a tick that the outside world may care about
/// (replication, the auto-director, chat announcements, persistence).
#[derive(Debug, Clone, Serialize)]
pub enum SimEvent {
    CharacterJoined {
        id: u32,
        name: String,
        class: Class,
    },
    /// A join was refused (e.g. outdated bytecode format). The server should
    /// surface the reason to the player.
    JoinRejected {
        name: String,
        reason: String,
    },
    CharacterDied {
        id: u32,
        name: String,
        killer: String,
    },
    CharacterRespawned {
        id: u32,
    },
    LevelUp {
        id: u32,
        name: String,
        level: u32,
    },
    MonsterKilled {
        killer_id: u32,
        killer: String,
        monster: String,
        level: u32,
    },
    LootDropped {
        owner_id: u32,
        owner: String,
        rarity: Rarity,
        item: String,
    },
    ItemPickedUp {
        owner_id: u32,
        owner: String,
        rarity: Rarity,
        item: String,
    },
    ItemEquipped {
        id: u32,
        owner: String,
        rarity: Rarity,
        item: String,
    },
    Hit {
        attacker: u32,
        target: u32,
        amount: i64,
        projectile: bool,
        killed: bool,
    },
    BotDebug {
        id: u32,
        values: Vec<i32>,
    },
}

/// Flat renderable view of an entity, exported to the server each tick.
#[derive(Debug, Clone)]
pub struct EntityView {
    pub id: u32,
    /// 1 = character, 2 = monster, 3 = loot.
    pub kind: u8,
    pub x_raw: i32,
    pub y_raw: i32,
    pub life_pct: u8,
    pub level: u32,
    pub name: String,
    /// Client-side visual key (monster archetype model, character class).
    pub model: String,
    pub rarity: u8,
    pub dead: bool,
    pub kills: u64,
    pub items: u64,
}

#[derive(Serialize, Deserialize)]
pub struct World {
    seed: u64,
    tick: u64,
    content_hash: u64,
    #[serde(skip)]
    content: ContentDb,
    pub(crate) zone: Zone,
    pub(crate) bots: BotArena,
    next_net_id: u32,
    rng_ai: Pcg32,
    rng_combat: Pcg32,
    rng_loot: Pcg32,
}

pub fn class_stats(class: Class) -> CombatStats {
    let (life, damage, range_cu, cooldown, speed_cps, radius_cu) = match class {
        Class::Brute => (120, 12, 200, 8, 320, 50),
        Class::Hunter => (90, 9, 900, 7, 350, 45),
        Class::Arcanist => (80, 11, 800, 9, 300, 45),
    };
    CombatStats {
        life,
        life_max: life,
        damage,
        range: fx_from_cu(range_cu),
        cooldown_ticks: cooldown,
        cooldown_left: 0,
        speed_per_tick: speed_from_cps(speed_cps),
        radius: fx_from_cu(radius_cu),
        projectile: matches!(class, Class::Hunter | Class::Arcanist),
        last_combat_tick: 0,
    }
}

pub(crate) fn fx_from_cu(cu: i32) -> Fx {
    Fx::from_raw(((cu as i64) * 65536 / 100) as i32)
}

fn speed_from_cps(cps: i32) -> Fx {
    // centi-units/sec → units/tick at TICK_HZ.
    Fx::from_raw(((cps as i64) * 65536 / 100 / TICK_HZ as i64) as i32)
}

fn xp_to_next(level: u32) -> i64 {
    let l = level as i64;
    80 + 40 * l * l
}

/// Class life/damage at a given level, before gear (integer compounding).
fn base_progression(class: Class, level: u32) -> (i64, i64) {
    let (mut life, mut damage) = match class {
        Class::Brute => (120, 12),
        Class::Hunter => (90, 9),
        Class::Arcanist => (80, 11),
    };
    for _ in 1..level {
        life += life / 10;
        damage += damage / 12 + 1;
    }
    (life, damage)
}

/// Placeholder until affixes: rarity scales an item's base stat.
fn rarity_mult(rarity: Rarity) -> i64 {
    match rarity {
        Rarity::Normal => 100,
        Rarity::Magic => 120,
        Rarity::Rare => 150,
        Rarity::Unique => 200,
    }
}

impl World {
    pub fn new(seed: u64, content: &ContentDb) -> World {
        let zone = match content
            .zone("withered_shore")
            .or_else(|| content.zones.first())
        {
            Some(def) => {
                let mut zone = Zone::new(
                    def.name.clone(),
                    Fx::from_int(def.width_u as i16),
                    Fx::from_int(def.height_u as i16),
                    FxV2::new(
                        Fx::from_int(def.spawn_x_u as i16),
                        Fx::from_int(def.spawn_y_u as i16),
                    ),
                );
                for pack in &def.packs {
                    let monster_idx = content
                        .monster_idx(&pack.monster)
                        .expect("content validated at load")
                        as u32;
                    zone.packs.push(PackState {
                        def: pack.clone(),
                        monster_idx,
                        alive: 0,
                        respawn_timer: 0,
                    });
                }
                zone
            }
            None => Zone::new(
                "The Void".into(),
                Fx::from_int(60),
                Fx::from_int(60),
                FxV2::new(Fx::from_int(30), Fx::from_int(30)),
            ),
        };
        World {
            seed,
            tick: 0,
            content_hash: content.content_hash,
            content: content.clone(),
            zone,
            bots: BotArena::default(),
            next_net_id: 1,
            rng_ai: Pcg32::stream(seed, Domain::ZoneAi, 0),
            rng_combat: Pcg32::stream(seed, Domain::Combat, 0),
            rng_loot: Pcg32::stream(seed, Domain::Loot, 0),
        }
    }

    /// Re-attach content after deserializing a snapshot. Fails on hash
    /// mismatch: a snapshot is only meaningful against its exact content.
    pub fn attach_content(&mut self, content: &ContentDb) -> Result<(), u64> {
        if content.content_hash != self.content_hash {
            return Err(self.content_hash);
        }
        self.content = content.clone();
        Ok(())
    }

    pub(crate) fn content_monsters(&self) -> &[MonsterDef] {
        &self.content.monsters
    }

    pub(crate) fn content_items(&self) -> &[idlin_content::ItemDef] {
        &self.content.items
    }

    pub fn tick_count(&self) -> u64 {
        self.tick
    }

    pub fn seed(&self) -> u64 {
        self.seed
    }

    pub fn content_hash(&self) -> u64 {
        self.content_hash
    }

    pub fn zone_name(&self) -> &str {
        &self.zone.name
    }

    pub fn zone_size_raw(&self) -> (i32, i32) {
        (self.zone.width.raw(), self.zone.height.raw())
    }

    pub fn character_count(&self) -> usize {
        self.zone
            .iter()
            .filter(|(_, e)| e.character.is_some())
            .count()
    }

    /// Advance the world by exactly one tick.
    pub fn tick(&mut self, inputs: &TickInputs) -> Vec<SimEvent> {
        self.tick += 1;
        let mut events = Vec::new();
        self.clear_transient_intents();
        self.apply_joins(inputs, &mut events);
        self.run_bots(&mut events);
        self.movement();
        self.separation();
        self.attacks(&mut events);
        self.pickups(&mut events);
        self.regen();
        self.respawns(&mut events);
        events
    }

    fn alloc_net(&mut self) -> u32 {
        let id = self.next_net_id;
        self.next_net_id += 1;
        id
    }

    fn clear_transient_intents(&mut self) {
        for slot in 0..self.zone.slot_count() {
            if let Some(e) = self.zone.get_mut(slot) {
                e.intents.attack = None;
                e.intents.pickup = None;
            }
        }
    }

    fn apply_joins(&mut self, inputs: &TickInputs, events: &mut Vec<SimEvent>) {
        for join in &inputs.joins {
            // The versioned container is checked here: outdated bots are
            // rejected at the door, with the reason surfaced as an event.
            let vm = match Vm::new(&join.program) {
                Ok(vm) => vm,
                Err(e) => {
                    events.push(SimEvent::JoinRejected {
                        name: join.name.clone(),
                        reason: e.to_string(),
                    });
                    continue;
                }
            };
            let net_id = self.alloc_net();
            let bot_idx = self.bots.insert(Bot {
                vm,
                rng: Pcg32::stream(self.seed, Domain::Bot, net_id as u64),
                params: vec![0; idlin_vm::PARAM_BLOCK_LEN],
                program_hash: program_hash(&join.program),
                version: 1,
            });
            self.zone.insert(Entity {
                net_id,
                pos: self.zone.spawn,
                intents: Default::default(),
                bot: Some(bot_idx),
                combat: Some(class_stats(join.class)),
                character: Some(CharacterState {
                    name: join.name.clone(),
                    class: join.class,
                    level: 1,
                    xp: 0,
                    respawn_at: None,
                    kills: 0,
                    items: 0,
                    inventory: Vec::new(),
                    equipment: Default::default(),
                }),
                monster: None,
                loot: None,
            });
            events.push(SimEvent::CharacterJoined {
                id: net_id,
                name: join.name.clone(),
                class: join.class,
            });
        }
    }

    fn monster_def(&self, idx: u32) -> &MonsterDef {
        &self.content.monsters[idx as usize]
    }

    fn movement(&mut self) {
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if !e.alive() {
                continue;
            }
            let Some(target) = e.intents.move_to else {
                continue;
            };
            let Some(combat) = &e.combat else { continue };
            let (pos, speed, range) = (e.pos, combat.speed_per_tick, combat.range);

            // Stop to fight: if the attack target is already in range, hold.
            if let Some(att) = e.intents.attack
                && let Some(t) = self.zone.get_net(att)
                && t.alive()
                && pos.dist(t.pos) <= range
            {
                continue;
            }

            let delta = target - pos;
            let dist = pos.dist(target);
            let new_pos = if dist <= speed {
                target
            } else {
                let factor = speed / dist;
                FxV2::new(pos.x + delta.x * factor, pos.y + delta.y * factor)
            };
            let new_pos = self.zone.clamp_pos(new_pos);
            if let Some(me) = self.zone.get_mut(slot) {
                me.pos = new_pos;
                if dist <= speed {
                    me.intents.move_to = None;
                }
            }
        }
    }

    /// Collision as separation, resolved pairwise in ascending slot order.
    /// Same-faction (and neutral) pairs pass through with a very soft nudge;
    /// opposing factions push hard enough to dominate movement speed —
    /// effective body-blocking without a pathfinding-aware solver.
    fn separation(&mut self) {
        /// Max push per tick between allies: a drift, never a wall.
        const SOFT_PUSH: Fx = Fx::from_raw(0x0CCC); // 0.05 u
        /// Max push per tick between enemies: outruns any move speed.
        const FIRM_PUSH: Fx = Fx::from_raw(0x6666); // 0.4 u

        let n = self.zone.slot_count();
        for a in 0..n {
            for b in (a + 1)..n {
                // Positions are re-read per pair: earlier pairs may have
                // already pushed either party this tick.
                let Some(ea) = self.zone.get(a) else { break };
                if !ea.alive() {
                    break;
                }
                let Some(ca) = &ea.combat else { break };
                let (pos_a, r_a, fac_a, net_a) = (ea.pos, ca.radius, ea.faction(), ea.net_id);
                let Some(eb) = self.zone.get(b) else { continue };
                if !eb.alive() {
                    continue;
                }
                let Some(cb) = &eb.combat else { continue };
                let (pos_b, r_b, fac_b) = (eb.pos, cb.radius, eb.faction());

                let min_dist = r_a + r_b;
                let dist = pos_a.dist(pos_b);
                if dist >= min_dist {
                    continue;
                }
                let cap = if fac_a.is_enemy_of(fac_b) {
                    FIRM_PUSH
                } else {
                    SOFT_PUSH
                };
                let push = ((min_dist - dist) / Fx::from_int(2)).min(cap);
                // Direction b←a; for exact overlap, derive a deterministic
                // pseudo-direction from the pair's net ids.
                let dir = if dist > Fx::from_raw(0x100) {
                    let d = pos_b - pos_a;
                    let f = Fx::ONE / dist;
                    FxV2::new(d.x * f, d.y * f)
                } else {
                    match (net_a ^ eb.net_id) & 3 {
                        0 => FxV2::new(Fx::ONE, Fx::ZERO),
                        1 => FxV2::new(-Fx::ONE, Fx::ZERO),
                        2 => FxV2::new(Fx::ZERO, Fx::ONE),
                        _ => FxV2::new(Fx::ZERO, -Fx::ONE),
                    }
                };
                let shift = FxV2::new(dir.x * push, dir.y * push);
                let new_a = self.zone.clamp_pos(pos_a - shift);
                let new_b = self.zone.clamp_pos(pos_b + shift);
                if let Some(ma) = self.zone.get_mut(a) {
                    ma.pos = new_a;
                }
                if let Some(mb) = self.zone.get_mut(b) {
                    mb.pos = new_b;
                }
            }
        }
    }

    fn attacks(&mut self, events: &mut Vec<SimEvent>) {
        // Cooldowns tick down first, for everyone, in slot order.
        for slot in 0..self.zone.slot_count() {
            if let Some(e) = self.zone.get_mut(slot)
                && let Some(c) = e.combat.as_mut()
            {
                c.cooldown_left = c.cooldown_left.saturating_sub(1);
            }
        }

        // Sequential resolution in slot order: earlier attackers can kill a
        // target before later ones swing. Deterministic and simple.
        let mut dead_monsters: Vec<(usize, u32)> = Vec::new(); // (slot, bot idx)
        let mut loot_spawns: Vec<(FxV2, Item, u32, String)> = Vec::new();
        let now = self.tick;

        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            if !e.alive() {
                continue;
            }
            let Some(target_net) = e.intents.attack else {
                continue;
            };
            let Some(combat) = &e.combat else { continue };
            if combat.cooldown_left > 0 {
                continue;
            }
            let attacker_net = e.net_id;
            let attacker_faction = e.faction();
            let attacker_name = match (&e.character, &e.monster) {
                (Some(c), _) => c.name.clone(),
                (_, Some(m)) => self.monster_def(m.def_idx).name.clone(),
                _ => continue,
            };
            let attacker_is_char = e.character.is_some();
            let (pos, damage, range, projectile, cooldown) = (
                e.pos,
                combat.damage,
                combat.range,
                combat.projectile,
                combat.cooldown_ticks,
            );

            // Validate the target now (it may have died earlier this phase).
            // Friendly fire is impossible: factions must oppose.
            let Some(target_slot) = self.zone.slot_of(target_net) else {
                continue;
            };
            let Some(t) = self.zone.get(target_slot) else {
                continue;
            };
            if !t.alive() || !attacker_faction.is_enemy_of(t.faction()) || pos.dist(t.pos) > range {
                continue;
            }

            // Damage roll: 75%..=125% of base, minimum 1.
            let roll = 75 + self.rng_combat.next_range(51) as i64;
            let amount = (damage * roll / 100).max(1);

            let t = self.zone.get_mut(target_slot).unwrap();
            let tc = t.combat.as_mut().unwrap();
            tc.life -= amount;
            tc.last_combat_tick = now;
            let killed = tc.life <= 0;
            events.push(SimEvent::Hit {
                attacker: attacker_net,
                target: target_net,
                amount,
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
                    if pack.respawn_timer == 0 {
                        pack.respawn_timer = pack.def.respawn_ticks;
                    }
                    if attacker_is_char {
                        events.push(SimEvent::MonsterKilled {
                            killer_id: attacker_net,
                            killer: attacker_name.clone(),
                            monster: monster_name,
                            level: monster_level,
                        });
                        // Loot roll (personal: owned by the killer).
                        if self.rng_loot.next_range(100) < 35
                            && let Some(item) = self.roll_item(monster_level)
                        {
                            loot_spawns.push((
                                target_pos,
                                item,
                                attacker_net,
                                attacker_name.clone(),
                            ));
                        }
                        self.grant_xp(slot, xp, events);
                    }
                } else if let Some(ch) = &mut t.character {
                    ch.respawn_at = Some(now + RESPAWN_TICKS);
                    let (id, name) = (t.net_id, ch.name.clone());
                    t.intents = Default::default();
                    events.push(SimEvent::CharacterDied {
                        id,
                        name,
                        killer: attacker_name.clone(),
                    });
                }
            }

            // Reset the attacker's cooldown and mark it in combat.
            if let Some(me) = self.zone.get_mut(slot)
                && let Some(c) = me.combat.as_mut()
            {
                c.cooldown_left = cooldown;
                c.last_combat_tick = now;
            }
        }

        for (slot, bot_idx) in dead_monsters {
            self.zone.remove(slot);
            if bot_idx != u32::MAX {
                self.bots.remove(bot_idx);
            }
        }
        for (pos, item, owner, owner_name) in loot_spawns {
            let net_id = self.alloc_net();
            let rarity = item.rarity;
            let item_name = self.content.items[item.base_idx as usize].name.clone();
            self.zone.insert(Entity {
                net_id,
                pos,
                intents: Default::default(),
                bot: None,
                combat: None,
                character: None,
                monster: None,
                loot: Some(LootState {
                    item,
                    rarity,
                    owner,
                    despawn_at: self.tick + LOOT_DESPAWN_TICKS,
                }),
            });
            events.push(SimEvent::LootDropped {
                owner_id: owner,
                owner: owner_name,
                rarity,
                item: item_name,
            });
        }
    }

    /// Roll a concrete item: weighted base pick + rarity + item level.
    fn roll_item(&mut self, monster_level: u32) -> Option<Item> {
        let total: u32 = self.content.items.iter().map(|i| i.weight).sum();
        if total == 0 {
            return None;
        }
        let mut roll = self.rng_loot.next_range(total);
        let mut base_idx = 0u32;
        for (i, def) in self.content.items.iter().enumerate() {
            if roll < def.weight {
                base_idx = i as u32;
                break;
            }
            roll -= def.weight;
        }
        let r = self.rng_loot.next_range(1000);
        let rarity = if r < 700 {
            Rarity::Normal
        } else if r < 950 {
            Rarity::Magic
        } else if r < 995 {
            Rarity::Rare
        } else {
            Rarity::Unique
        };
        Some(Item {
            base_idx,
            rarity,
            item_level: monster_level,
        })
    }

    fn grant_xp(&mut self, slot: usize, xp: i64, events: &mut Vec<SimEvent>) {
        let Some(e) = self.zone.get_mut(slot) else {
            return;
        };
        let net_id = e.net_id;
        let Some(ch) = e.character.as_mut() else {
            return;
        };
        ch.kills += 1;
        ch.xp += xp;
        let mut leveled = false;
        while ch.level < 100 && ch.xp >= xp_to_next(ch.level) {
            ch.xp -= xp_to_next(ch.level);
            ch.level += 1;
            leveled = true;
        }
        if leveled {
            let (name, level) = (ch.name.clone(), ch.level);
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
        }
    }

    /// Recompute a character's combat numbers from class, level, and gear.
    /// The weapon defines the normal attack (damage/range/cooldown/projectile,
    /// with class damage contributing half); armor adds life. Current life is
    /// preserved, gaining the max-life delta on upgrades.
    fn refresh_derived_stats(&mut self, slot: usize) {
        let Some(e) = self.zone.get(slot) else { return };
        let Some(ch) = &e.character else { return };
        let (class, level) = (ch.class, ch.level);
        let (base_life, base_damage) = base_progression(class, level);
        let unarmed = class_stats(class);

        let mut life_max = base_life;
        let mut damage = base_damage;
        let mut range = unarmed.range;
        let mut cooldown = unarmed.cooldown_ticks;
        let mut projectile = unarmed.projectile;
        for (i, slot_item) in ch.equipment.iter().enumerate() {
            let Some(item) = slot_item else { continue };
            let def = &self.content.items[item.base_idx as usize];
            let mult = rarity_mult(item.rarity);
            if i == GearSlot::Weapon.idx() {
                damage = base_damage / 2 + def.damage * mult / 100;
                range = fx_from_cu(def.range_cu);
                cooldown = def.cooldown_ticks;
                projectile = def.projectile;
            } else {
                life_max += def.life * mult / 100;
            }
        }

        if let Some(me) = self.zone.get_mut(slot)
            && let Some(c) = me.combat.as_mut()
        {
            let delta = life_max - c.life_max;
            c.life_max = life_max;
            if c.life > 0 {
                c.life = (c.life + delta.max(0)).min(life_max);
            }
            c.damage = damage;
            c.range = range;
            c.cooldown_ticks = cooldown;
            c.projectile = projectile;
        }
    }

    /// Host-computed gear optimization (the EquipBest syscall): for each gear
    /// slot, equip the highest-scoring item between what's worn and what's in
    /// the bag. Returns the number of swaps; emits ItemEquipped events.
    pub(crate) fn equip_best(&mut self, slot: usize, events: &mut Vec<SimEvent>) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let (net_id, owner) = (e.net_id, ch.name.clone());

        let score = |content: &ContentDb, item: &Item| -> i64 {
            let def = &content.items[item.base_idx as usize];
            let stat = if def.slot == GearSlot::Weapon {
                def.damage
            } else {
                def.life
            };
            stat * rarity_mult(item.rarity)
        };

        let mut changes = 0;
        for gear_idx in 0..GEAR_SLOTS {
            // Find the best inventory candidate for this slot.
            let Some(e) = self.zone.get(slot) else { break };
            let ch = e.character.as_ref().unwrap();
            let current_score = ch.equipment[gear_idx]
                .as_ref()
                .map(|i| score(&self.content, i))
                .unwrap_or(-1);
            let mut best: Option<(usize, i64)> = None;
            for (inv_idx, item) in ch.inventory.iter().enumerate() {
                if self.content.items[item.base_idx as usize].slot.idx() != gear_idx {
                    continue;
                }
                let s = score(&self.content, item);
                if s > current_score && best.is_none_or(|(_, bs)| s > bs) {
                    best = Some((inv_idx, s));
                }
            }
            let Some((inv_idx, _)) = best else { continue };

            let item_name;
            let item_rarity;
            {
                let me = self.zone.get_mut(slot).unwrap();
                let ch = me.character.as_mut().unwrap();
                let new_item = ch.inventory.remove(inv_idx);
                item_name = self.content.items[new_item.base_idx as usize].name.clone();
                item_rarity = new_item.rarity;
                if let Some(old) = ch.equipment[gear_idx].replace(new_item) {
                    ch.inventory.push(old);
                }
            }
            changes += 1;
            events.push(SimEvent::ItemEquipped {
                id: net_id,
                owner: owner.clone(),
                rarity: item_rarity,
                item: item_name,
            });
        }
        if changes > 0 {
            self.refresh_derived_stats(slot);
        }
        changes
    }

    fn pickups(&mut self, events: &mut Vec<SimEvent>) {
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            let Some(ch) = &e.character else { continue };
            if !e.alive() {
                continue;
            }
            let Some(loot_net) = e.intents.pickup else {
                continue;
            };
            let (my_net, my_pos, my_name) = (e.net_id, e.pos, ch.name.clone());
            let Some(loot_slot) = self.zone.slot_of(loot_net) else {
                continue;
            };
            let Some(l) = self.zone.get(loot_slot) else {
                continue;
            };
            let Some(loot) = &l.loot else { continue };
            if loot.owner != my_net || my_pos.dist(l.pos) > PICKUP_RANGE {
                continue;
            }
            // A full bag refuses the pickup (vendoring arrives with towns).
            if ch.inventory.len() >= INVENTORY_CAP {
                continue;
            }
            let rarity = loot.rarity;
            let item = loot.item.clone();
            let item_name = self.content.items[item.base_idx as usize].name.clone();
            self.zone.remove(loot_slot);
            if let Some(me) = self.zone.get_mut(slot) {
                let ch = me.character.as_mut().unwrap();
                ch.items += 1;
                ch.inventory.push(item);
            }
            events.push(SimEvent::ItemPickedUp {
                owner_id: my_net,
                owner: my_name,
                rarity,
                item: item_name,
            });
        }
    }

    /// Out-of-combat regeneration: anything alive that hasn't traded damage
    /// for a while heals 2%/tick. Replaces bespoke monster "reset" healing
    /// and keeps idle play forgiving for characters.
    fn regen(&mut self) {
        let now = self.tick;
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get_mut(slot) else {
                continue;
            };
            let Some(c) = e.combat.as_mut() else { continue };
            if c.life <= 0 || c.life >= c.life_max {
                continue;
            }
            if now.saturating_sub(c.last_combat_tick) >= REGEN_DELAY_TICKS {
                c.life = (c.life + (c.life_max / 50).max(1)).min(c.life_max);
            }
        }
    }

    fn respawns(&mut self, events: &mut Vec<SimEvent>) {
        // Characters.
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            let Some(ch) = &e.character else { continue };
            let Some(at) = ch.respawn_at else { continue };
            if at > self.tick {
                continue;
            }
            let spawn = self.zone.spawn;
            if let Some(me) = self.zone.get_mut(slot) {
                let id = me.net_id;
                me.pos = spawn;
                me.character.as_mut().unwrap().respawn_at = None;
                let c = me.combat.as_mut().unwrap();
                c.life = c.life_max;
                c.cooldown_left = 0;
                events.push(SimEvent::CharacterRespawned { id });
            }
        }

        // Packs refill once their timer runs out.
        for pack_idx in 0..self.zone.packs.len() {
            let pack = &self.zone.packs[pack_idx];
            if pack.alive >= pack.def.count {
                continue;
            }
            if pack.respawn_timer > 0 {
                self.zone.packs[pack_idx].respawn_timer -= 1;
                continue;
            }
            let (missing, monster_idx, count) = (
                pack.def.count - pack.alive,
                pack.monster_idx,
                pack.def.count,
            );
            let anchor = FxV2::new(
                Fx::from_int(pack.def.x_u as i16),
                Fx::from_int(pack.def.y_u as i16),
            );
            let jitter_r = Fx::from_int(pack.def.radius_u as i16).raw() as u32;
            for _ in 0..missing {
                let dx =
                    Fx::from_raw(self.rng_ai.next_range(jitter_r * 2) as i32 - jitter_r as i32);
                let dy =
                    Fx::from_raw(self.rng_ai.next_range(jitter_r * 2) as i32 - jitter_r as i32);
                let pos = self.zone.clamp_pos(FxV2::new(anchor.x + dx, anchor.y + dy));
                self.spawn_monster(monster_idx, pack_idx as u32, pos);
            }
            self.zone.packs[pack_idx].alive = count;
        }

        // Loot despawn.
        let mut stale: Vec<usize> = Vec::new();
        for (slot, e) in self.zone.iter() {
            if let Some(l) = &e.loot
                && l.despawn_at <= self.tick
            {
                stale.push(slot);
            }
        }
        for slot in stale {
            self.zone.remove(slot);
        }
    }

    /// Spawn one monster: same entity shape as a character, with a brain
    /// program from content driving it.
    fn spawn_monster(&mut self, monster_idx: u32, pack_idx: u32, pos: FxV2) {
        let def = &self.content.monsters[monster_idx as usize];
        let stats = CombatStats {
            life: def.life,
            life_max: def.life,
            damage: def.damage,
            range: fx_from_cu(def.range_cu),
            cooldown_ticks: def.cooldown_ticks,
            cooldown_left: 0,
            speed_per_tick: speed_from_cps(def.speed_cps),
            radius: fx_from_cu(def.radius_cu),
            projectile: def.projectile,
            last_combat_tick: 0,
        };
        let hostile = def.hostile;
        let program = self
            .content
            .brain_idx(&def.brain)
            .map(|i| self.content.brains[i].program.clone())
            .unwrap_or_default();
        // Brains are validated at content load; a failure here means empty
        // content (tests) — spawn a brainless (inert) monster rather than die.
        let vm = Vm::new(&program).ok();
        let net_id = self.alloc_net();
        let bot = vm.map(|vm| {
            self.bots.insert(Bot {
                vm,
                rng: Pcg32::stream(self.seed, Domain::Bot, net_id as u64),
                params: vec![0; idlin_vm::PARAM_BLOCK_LEN],
                program_hash: program_hash(&program),
                version: 1,
            })
        });
        self.zone.insert(Entity {
            net_id,
            pos,
            intents: Default::default(),
            bot,
            combat: Some(stats),
            character: None,
            monster: Some(MonsterState {
                def_idx: monster_idx,
                pack_idx,
                anchor: pos,
                hostile,
            }),
            loot: None,
        });
    }

    /// Flat per-entity views for replication.
    pub fn views(&self) -> Vec<EntityView> {
        self.zone
            .iter()
            .map(|(_, e)| {
                let combat = e.combat.as_ref();
                let (name, model, level, rarity, dead, kills, items) =
                    if let Some(ch) = &e.character {
                        (
                            ch.name.clone(),
                            ch.class.as_str().to_string(),
                            ch.level,
                            0,
                            !e.alive(),
                            ch.kills,
                            ch.items,
                        )
                    } else if let Some(m) = &e.monster {
                        let def = self.monster_def(m.def_idx);
                        (
                            def.name.clone(),
                            def.model.clone(),
                            def.level,
                            0,
                            false,
                            0,
                            0,
                        )
                    } else {
                        let l = e.loot.as_ref().unwrap();
                        (
                            String::new(),
                            "loot".to_string(),
                            0,
                            l.rarity as u8,
                            false,
                            0,
                            0,
                        )
                    };
                EntityView {
                    id: e.net_id,
                    kind: e.kind_code() as u8,
                    x_raw: e.pos.x.raw(),
                    y_raw: e.pos.y.raw(),
                    life_pct: combat.map(|c| c.life_pct()).unwrap_or(0),
                    level,
                    name,
                    model,
                    rarity,
                    dead,
                    kills,
                    items,
                }
            })
            .collect()
    }

    /// Canonical state hash for determinism checks (replays, snapshots, CI).
    pub fn state_hash(&self) -> u64 {
        let mut h = Fnv1a64::new();
        h.write_u64(self.seed);
        h.write_u64(self.content_hash);
        h.write_u64(self.tick);
        h.write_u32(self.next_net_id);
        for rng in [&self.rng_ai, &self.rng_combat, &self.rng_loot] {
            let (state, inc) = rng.state();
            h.write_u64(state);
            h.write_u64(inc);
        }
        for (slot, e) in self.zone.iter() {
            h.write_u64(slot as u64);
            h.write_u32(e.net_id);
            h.write_i32(e.pos.x.raw());
            h.write_i32(e.pos.y.raw());
            h.write_u32(e.bot.map(|b| b + 1).unwrap_or(0));
            if let Some(c) = &e.combat {
                h.write_i64(c.life);
                h.write_i64(c.life_max);
                h.write_i64(c.damage);
                h.write_u32(c.cooldown_left);
                h.write_u64(c.last_combat_tick);
                h.write_i32(c.radius.raw());
            }
            if let Some(ch) = &e.character {
                h.write_bytes(ch.name.as_bytes());
                h.write_u32(ch.level);
                h.write_i64(ch.xp);
                h.write_u64(ch.respawn_at.unwrap_or(0));
                h.write_u64(ch.kills);
                h.write_u64(ch.items);
                let fold_item = |h: &mut Fnv1a64, item: &Item| {
                    h.write_u32(item.base_idx);
                    h.write_u8(item.rarity as u8);
                    h.write_u32(item.item_level);
                };
                h.write_u64(ch.inventory.len() as u64);
                for item in &ch.inventory {
                    fold_item(&mut h, item);
                }
                for slot_item in &ch.equipment {
                    match slot_item {
                        Some(item) => {
                            h.write_u8(1);
                            fold_item(&mut h, item);
                        }
                        None => h.write_u8(0),
                    }
                }
            }
            if let Some(m) = &e.monster {
                h.write_u32(m.def_idx);
                h.write_u8(m.hostile as u8);
                h.write_i32(m.anchor.x.raw());
                h.write_i32(m.anchor.y.raw());
            }
            if let Some(l) = &e.loot {
                h.write_u8(l.rarity as u8);
                h.write_u32(l.owner);
                h.write_u64(l.despawn_at);
                h.write_u32(l.item.base_idx);
                h.write_u32(l.item.item_level);
            }
        }
        for pack in &self.zone.packs {
            h.write_u32(pack.alive);
            h.write_u32(pack.respawn_timer);
        }
        for (idx, bot) in self.bots.iter() {
            h.write_u64(idx as u64);
            for b in bot.vm.state_bytes() {
                h.write_u8(b);
            }
            let (state, inc) = bot.rng.state();
            h.write_u64(state);
            h.write_u64(inc);
            h.write_bytes(&bot.params);
            h.write_u64(bot.program_hash);
            h.write_u32(bot.version);
        }
        h.finish()
    }
}
