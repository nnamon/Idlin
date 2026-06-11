//! The VM host: where brains meet the world. Characters and NPCs run on the
//! exact same VM with the exact same syscalls — a monster is just a bot whose
//! program came from content. Bots observe and act only through the syscalls
//! here; the sim validates everything, so a hostile or buggy bot can waste
//! its own tick but never corrupt the world.
//!
//! Syscall ABI (mirrored in idlin-botc templates and content/brains):
//! - args are popped first-arg-first (the bot pushes them in reverse order)
//! - exactly the syscall's true arity is popped; the bot-declared argc is
//!   only honored by `Debug` (capped) — lying about argc hurts only the bot
//! - every syscall pushes exactly one result word; unknown numbers push -1
//!
//! SelfStatus layout (i32 words): +0 x, +4 y, +8 life, +12 life_max,
//! +16 level, +20 xp, +24 map_w, +28 map_h, +32 flags (bit0 = dead),
//! +36 anchor_x, +40 anchor_y, +44 aggro_radius, +48 attack_range.

use crate::fixed::{Fx, FxV2};
use crate::rng::Pcg32;
use crate::world::{SimEvent, World};
use idlin_vm::{DEFAULT_TICK_BUDGET, RunExit, Vm};
use serde::{Deserialize, Serialize};

/// Extra budget charged per syscall (on top of the Syscall instruction).
pub const SYSCALL_COST: u32 = 20;
/// How far bots can see.
pub const QUERY_RADIUS: Fx = Fx::from_int(50);
/// Hard cap on entity-query results.
pub const MAX_QUERY_RESULTS: usize = 16;
/// Size of one ReadEntities record in bytes.
pub const ENTITY_RECORD_SIZE: u16 = 24;

pub const SYS_DEBUG: i32 = 0;
pub const SYS_SELF_STATUS: i32 = 1;
pub const SYS_READ_ENTITIES: i32 = 2;
pub const SYS_READ_INVENTORY: i32 = 5;
pub const SYS_MOVE_TO: i32 = 6;
pub const SYS_USE_SKILL: i32 = 7;
pub const SYS_PICK_UP: i32 = 8;
pub const SYS_EQUIP_BEST: i32 = 12;
/// Declares the whole passive build at bot initialization; emitted by the
/// compiler from the `build [...]` declaration.
pub const SYS_SET_BUILD: i32 = 14;
pub const SYS_RANDOM: i32 = 15;
pub const SYS_MOVE_ITEM: i32 = 16;
pub const SYS_DROP_ITEM: i32 = 17;
pub const SYS_READ_SKILLS: i32 = 18;
pub const SYS_SOCKET_GEM: i32 = 19;
pub const SYS_COUNT_ENTITIES: i32 = 20;
pub const SYS_LINE_OF_SIGHT: i32 = 21;
pub const SYS_USE_SKILL_AT: i32 = 22;
pub const SYS_USE_SKILL_DIR: i32 = 23;
pub const SYS_READ_CURRENCY: i32 = 24;
pub const SYS_USE_CURRENCY: i32 = 25;
pub const SYS_SAY: i32 = 26;

/// Size of one ReadSkills record in bytes:
/// slot_no, gem_idx, level, cooldown_left, range_raw, shape, radius_raw.
pub const SKILL_RECORD_SIZE: u16 = 48; // 12 words

/// Size of one ReadInventory record in bytes:
/// base_idx, slot, rarity, item_level, x, y, w, h.
pub const INVENTORY_RECORD_SIZE: u16 = 32;
/// Hard cap on inventory query results (a 12×5 bag of 1×1s caps at 60).
pub const MAX_INVENTORY_RESULTS: usize = 60;

/// ReadEntities filters. "Enemies" is faction-relative: a player bot sees
/// hostiles, a hostile NPC brain sees players — the same brain logic works
/// from either side of the fight.
pub const FILTER_ENEMIES: i32 = 1;
pub const FILTER_CHARACTERS: i32 = 2;
pub const FILTER_LOOT: i32 = 3;

#[derive(Clone, Serialize, Deserialize)]
pub struct Bot {
    pub vm: Vm,
    /// Per-bot RNG stream: bots get randomness without touching world streams.
    pub rng: Pcg32,
    /// Host-side copy of the parameter block, rewritten into VM memory each
    /// tick (the chat-command channel).
    pub params: Vec<u8>,
    /// The versioned bytecode container as deployed — zone transfers carry
    /// it so the bot can be rebuilt in the destination world.
    pub program: Vec<u8>,
    pub program_hash: u64,
    /// Deployment version, bumped on every program swap.
    pub version: u32,
}

impl Bot {
    /// Swap the bot's program for a new one. VM memory and registers reset,
    /// but the persistent block survives — bot-learned state outlives code
    /// (and zone transfers). Params are host-owned and survive too.
    pub fn redeploy(&mut self, program: &[u8]) -> Result<(), idlin_vm::VmError> {
        let persist = self.vm.read_persist_block();
        let mut vm = Vm::new(program)?;
        vm.write_persist_block(&persist);
        self.vm = vm;
        self.program = program.to_vec();
        self.program_hash = program_hash(program);
        self.version += 1;
        Ok(())
    }
}

/// Slot arena for bots. Monsters churn constantly in a forever-world, so
/// slots are reused (lowest-first — deterministic).
#[derive(Default, Serialize, Deserialize)]
pub struct BotArena {
    slots: Vec<Option<Bot>>,
    free: Vec<u32>,
}

impl BotArena {
    pub fn insert(&mut self, bot: Bot) -> u32 {
        match self.free.pop() {
            Some(idx) => {
                self.slots[idx as usize] = Some(bot);
                idx
            }
            None => {
                self.slots.push(Some(bot));
                (self.slots.len() - 1) as u32
            }
        }
    }

    pub fn remove(&mut self, idx: u32) -> Option<Bot> {
        let bot = self.slots.get_mut(idx as usize)?.take()?;
        self.free.push(idx);
        self.free.sort_unstable_by(|a, b| b.cmp(a)); // pop() yields lowest
        Some(bot)
    }

    pub fn take(&mut self, idx: u32) -> Option<Bot> {
        self.slots.get_mut(idx as usize)?.take()
    }

    pub fn put_back(&mut self, idx: u32, bot: Bot) {
        self.slots[idx as usize] = Some(bot);
    }

    pub fn get_mut(&mut self, idx: u32) -> Option<&mut Bot> {
        self.slots.get_mut(idx as usize)?.as_mut()
    }

    /// Occupied slots in ascending order (for hashing).
    pub fn iter(&self) -> impl Iterator<Item = (usize, &Bot)> {
        self.slots
            .iter()
            .enumerate()
            .filter_map(|(i, b)| b.as_ref().map(|b| (i, b)))
    }
}

impl World {
    pub(crate) fn run_bots(&mut self, events: &mut Vec<SimEvent>) {
        for slot in 0..self.zone.slot_count() {
            let Some(e) = self.zone.get(slot) else {
                continue;
            };
            let Some(bot_idx) = e.bot else { continue };
            if !e.alive() {
                continue; // the dead don't think; respawn handles them
            }
            // Move the bot out so the VM and the world can be borrowed together.
            let Some(mut bot) = self.bots.take(bot_idx) else {
                continue;
            };
            bot.vm.write_param_block(&bot.params);
            let mut budget = DEFAULT_TICK_BUDGET;
            loop {
                match bot.vm.run(&mut budget) {
                    RunExit::Halted | RunExit::OutOfBudget => break,
                    RunExit::Syscall { number, argc } => {
                        let result = self.syscall(slot, &mut bot, number, argc, events);
                        bot.vm.push(result);
                        budget = budget.saturating_sub(SYSCALL_COST);
                    }
                }
            }
            self.bots.put_back(bot_idx, bot);
        }
    }

    fn syscall(
        &mut self,
        slot: usize,
        bot: &mut Bot,
        number: i32,
        argc: i32,
        events: &mut Vec<SimEvent>,
    ) -> i32 {
        match number {
            SYS_DEBUG => {
                let n = argc.clamp(0, 8);
                let mut values = Vec::with_capacity(n as usize);
                for _ in 0..n {
                    values.push(bot.vm.pop());
                }
                let id = self.zone.get(slot).map(|e| e.net_id).unwrap_or(0);
                events.push(SimEvent::BotDebug { id, values });
                0
            }
            SYS_SELF_STATUS => {
                let out = bot.vm.pop() as u16;
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                let combat = e.combat.as_ref();
                let ch = e.character.as_ref();
                let life = combat
                    .map(|c| c.life.clamp(0, i32::MAX as i64) as i32)
                    .unwrap_or(0);
                let life_max = combat
                    .map(|c| c.life_max.clamp(0, i32::MAX as i64) as i32)
                    .unwrap_or(0);
                let level = ch.map(|c| c.level as i32).unwrap_or(0);
                let xp = ch
                    .map(|c| c.xp.clamp(0, i32::MAX as i64) as i32)
                    .unwrap_or(0);
                let dead = !e.alive();
                // Characters anchor to the zone spawn point; monsters to home.
                let anchor = e
                    .monster
                    .as_ref()
                    .map(|m| m.anchor)
                    .unwrap_or(self.zone.spawn);
                let aggro = e
                    .monster
                    .as_ref()
                    .map(|m| {
                        let def = &self.content_monsters()[m.def_idx as usize];
                        crate::world::fx_from_cu(def.aggro_radius_cu).raw()
                    })
                    .unwrap_or(0);
                let range = combat.map(|c| c.range.raw()).unwrap_or(0);
                let mana = combat
                    .map(|c| c.mana.clamp(0, i32::MAX as i64) as i32)
                    .unwrap_or(0);
                let mana_max = combat
                    .map(|c| c.mana_max.clamp(0, i32::MAX as i64) as i32)
                    .unwrap_or(0);
                let es = combat
                    .map(|c| c.es.clamp(0, i32::MAX as i64) as i32)
                    .unwrap_or(0);
                let fields = [
                    e.pos.x.raw(),
                    e.pos.y.raw(),
                    life,
                    life_max,
                    level,
                    xp,
                    self.zone.width.raw(),
                    self.zone.height.raw(),
                    dead as i32,
                    anchor.x.raw(),
                    anchor.y.raw(),
                    aggro,
                    range,
                    mana,
                    mana_max,
                    es,
                ];
                for (i, v) in fields.into_iter().enumerate() {
                    bot.vm.store_i32(out.wrapping_add(4 * i as u16), v);
                }
                0
            }
            SYS_READ_ENTITIES => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, MAX_QUERY_RESULTS as i32) as usize;
                let filter = bot.vm.pop();
                let Some(me) = self.zone.get(slot) else {
                    return -1;
                };
                let (my_pos, my_net, my_faction) = (me.pos, me.net_id, me.faction());

                let r = QUERY_RADIUS.raw() as i64;
                let radius_sq = r * r;
                // (dist_sq, net_id) keys make the ordering fully deterministic.
                let mut found: Vec<(i64, u32, [i32; 6])> = Vec::new();
                for (s, e) in self.zone.iter() {
                    if s == slot {
                        continue;
                    }
                    // Camp sanctuary: monsters can't acquire characters
                    // resting inside the spawn pocket.
                    let sanctified = e.character.is_some()
                        && self.zone.camp_radius.raw() > 0
                        && self.zone.get(slot).is_some_and(|q| q.monster.is_some())
                        && e.pos.dist(self.zone.spawn) < self.zone.camp_radius;
                    let visible = match filter {
                        FILTER_ENEMIES => {
                            my_faction.is_enemy_of(e.faction()) && e.alive() && !sanctified
                        }
                        FILTER_CHARACTERS => e.character.is_some() && e.alive(),
                        FILTER_LOOT => e.loot.as_ref().is_some_and(|l| l.owner == my_net),
                        _ => false,
                    };
                    if !visible {
                        continue;
                    }
                    let dx = (e.pos.x - my_pos.x).raw() as i64;
                    let dy = (e.pos.y - my_pos.y).raw() as i64;
                    let d2 = dx * dx + dy * dy;
                    if d2 > radius_sq {
                        continue;
                    }
                    let life_pct = e.combat.as_ref().map(|c| c.life_pct() as i32).unwrap_or(0);
                    let rarity = e.loot.as_ref().map(|l| l.rarity as i32).unwrap_or(0);
                    found.push((
                        d2,
                        e.net_id,
                        [
                            e.net_id as i32,
                            e.kind_code(),
                            e.pos.x.raw(),
                            e.pos.y.raw(),
                            life_pct,
                            rarity,
                        ],
                    ));
                }
                found.sort_unstable_by_key(|&(d2, net, _)| (d2, net));
                let n = found.len().min(max);
                for (i, (_, _, rec)) in found.iter().take(n).enumerate() {
                    let base = out.wrapping_add(i as u16 * ENTITY_RECORD_SIZE);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                }
                n as i32
            }
            SYS_COUNT_ENTITIES => {
                // Zone-wide census: how many entities match the filter (the
                // same codes as ReadEntities), regardless of distance. Lets
                // a bot ask "is this area cleared?".
                let filter = bot.vm.pop();
                let Some(me) = self.zone.get(slot) else {
                    return -1;
                };
                let (my_net, my_faction) = (me.net_id, me.faction());
                let mut n = 0;
                for (s, e) in self.zone.iter() {
                    if s == slot {
                        continue;
                    }
                    let counted = match filter {
                        FILTER_ENEMIES => my_faction.is_enemy_of(e.faction()) && e.alive(),
                        FILTER_CHARACTERS => e.character.is_some() && e.alive(),
                        FILTER_LOOT => e.loot.as_ref().is_some_and(|l| l.owner == my_net),
                        _ => false,
                    };
                    if counted {
                        n += 1;
                    }
                }
                n
            }
            SYS_LINE_OF_SIGHT => {
                // Is the straight line from me to (x, y) clear of obstacle
                // cover? 1 = clear, 0 = blocked. Attacks enforce the same
                // check, so a bot can test a lane before committing.
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                let Some(me) = self.zone.get(slot) else {
                    return -1;
                };
                let target = FxV2::new(Fx::from_raw(x), Fx::from_raw(y));
                (!self.los_blocked(me.pos, target)) as i32
            }
            SYS_MOVE_TO => {
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                let target = self
                    .zone
                    .clamp_pos(crate::fixed::FxV2::new(Fx::from_raw(x), Fx::from_raw(y)));
                if let Some(e) = self.zone.get_mut(slot) {
                    e.intents.move_to = Some(target);
                    0
                } else {
                    -1
                }
            }
            SYS_USE_SKILL => {
                // Slot 0 = basic weapon attack; 1..N = socketed skill gems
                // in tree-node order. Entity-aimed. Rich error codes (see
                // docs/bot-guide.md): 0 ok, -1 slot, -2 cooldown, -3 busy,
                // -4 mana, -5 range, -6 LoS, -7 wrong mode, -8 target.
                let skill_slot = bot.vm.pop();
                let target = bot.vm.pop();
                let _x = bot.vm.pop();
                let _y = bot.vm.pop();
                self.try_use_skill(
                    slot,
                    skill_slot,
                    crate::entity::SkillTarget::Entity(target as u32),
                )
            }
            SYS_USE_SKILL_AT => {
                // Point-aimed skills: ground-target a location.
                let skill_slot = bot.vm.pop();
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                self.try_use_skill(
                    slot,
                    skill_slot,
                    crate::entity::SkillTarget::Point(FxV2::new(Fx::from_raw(x), Fx::from_raw(y))),
                )
            }
            SYS_USE_SKILL_DIR => {
                // Direction-aimed skills: cones, lines, projectile volleys.
                let skill_slot = bot.vm.pop();
                let dx = bot.vm.pop();
                let dy = bot.vm.pop();
                self.try_use_skill(
                    slot,
                    skill_slot,
                    crate::entity::SkillTarget::Direction(FxV2::new(
                        Fx::from_raw(dx),
                        Fx::from_raw(dy),
                    )),
                )
            }
            SYS_READ_CURRENCY => {
                // Obol counts in content order (the bot-guide names the
                // indices); returns how many were written.
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, 16) as usize;
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                let Some(ch) = &e.character else { return -1 };
                let n = self.content_currency_len().min(max);
                for i in 0..n {
                    let count = ch.currency.get(i).copied().unwrap_or(0);
                    bot.vm.store_i32(
                        out.wrapping_add(4 * i as u16),
                        count.min(i32::MAX as u64) as i32,
                    );
                }
                n as i32
            }
            SYS_USE_CURRENCY => {
                let currency_sel = bot.vm.pop();
                let inv_sel = bot.vm.pop();
                self.use_currency(slot, currency_sel, inv_sel, events)
            }
            SYS_SAY => {
                let line = bot.vm.pop();
                self.try_say(slot, line, events)
            }
            SYS_PICK_UP => {
                let id = bot.vm.pop();
                if let Some(e) = self.zone.get_mut(slot) {
                    e.intents.pickup = Some(id as u32);
                    0
                } else {
                    -1
                }
            }
            SYS_READ_INVENTORY => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, MAX_INVENTORY_RESULTS as i32) as usize;
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                let Some(ch) = &e.character else { return -1 };
                // Record: base_idx, slot, rarity, item_level, x, y, w, h.
                let records: Vec<[i32; 8]> = ch
                    .inventory
                    .iter()
                    .take(max)
                    .map(|placed| {
                        let def = &self.content_items()[placed.item.base_idx as usize];
                        [
                            placed.item.base_idx as i32,
                            def.slot.idx() as i32,
                            placed.item.rarity as i32,
                            placed.item.item_level as i32,
                            placed.x as i32,
                            placed.y as i32,
                            def.w as i32,
                            def.h as i32,
                        ]
                    })
                    .collect();
                for (i, rec) in records.iter().enumerate() {
                    let base = out.wrapping_add(i as u16 * INVENTORY_RECORD_SIZE);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                }
                records.len() as i32
            }
            SYS_EQUIP_BEST => self.equip_best(slot, events),
            SYS_SET_BUILD => {
                let addr = bot.vm.pop() as u16;
                let count = bot.vm.pop().clamp(0, 240) as u16;
                let refs: Vec<u16> = (0..count)
                    .map(|i| bot.vm.load_u16(addr.wrapping_add(2 * i)))
                    .collect();
                self.set_build(slot, &refs, events)
            }
            SYS_MOVE_ITEM => {
                let inv_idx = bot.vm.pop();
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                if inv_idx < 0 || !(0..=255).contains(&x) || !(0..=255).contains(&y) {
                    return -1;
                }
                self.move_item(slot, inv_idx as usize, x as u8, y as u8)
            }
            SYS_DROP_ITEM => {
                let inv_idx = bot.vm.pop();
                if inv_idx < 0 {
                    return -1;
                }
                self.drop_item(slot, inv_idx as usize)
            }
            SYS_READ_SKILLS => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, 8) as usize;
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                // Characters read their socketed tree; monsters read their
                // def kit — same records, same slot numbering.
                let gems: Vec<&crate::entity::SocketedGem> = if let Some(ch) = &e.character {
                    self.skill_nodes(ch)
                        .iter()
                        .map(|node| &ch.sockets[node])
                        .collect()
                } else if let Some(m) = &e.monster {
                    m.skills.iter().collect()
                } else {
                    return -1;
                };
                let now = self.tick_count();
                let records: Vec<[i32; 12]> = gems
                    .iter()
                    .take(max)
                    .enumerate()
                    .map(|(i, sg)| {
                        let def = &self.content_gems()[sg.gem.gem_idx as usize];
                        let c = e.combat.as_ref();
                        let range = if def.range_cu > 0 {
                            crate::world::fx_from_cu(def.range_cu).raw()
                        } else {
                            c.map(|c| c.range.raw()).unwrap_or(0)
                        };
                        let shape = match def.shape {
                            idlin_content::SkillShape::Target => 0,
                            idlin_content::SkillShape::Nova => 1,
                            idlin_content::SkillShape::Cone => 2,
                            idlin_content::SkillShape::Line => 3,
                            idlin_content::SkillShape::PointAoe => 4,
                            idlin_content::SkillShape::Projectile => 5,
                        };
                        let target_mode = match def.target_mode {
                            idlin_content::TargetMode::Entity => 0,
                            idlin_content::TargetMode::Point => 1,
                            idlin_content::TargetMode::Direction => 2,
                        };
                        let skill_kind = match def.skill_kind {
                            idlin_content::SkillKind::Attack => 0,
                            idlin_content::SkillKind::Spell => 1,
                        };
                        // Final cost: support mana multipliers included.
                        let cost = self.skill_mana_cost(sg);
                        // Effective commitment: support speed effects and
                        // your cast speed folded in, same as the executor.
                        let use_ticks = self.skill_use_ticks(
                            sg,
                            c.map(|c| c.use_ticks).unwrap_or(0),
                            c.map(|c| c.cast_speed).unwrap_or(10000),
                        ) as i32;
                        // Weapon gates apply to the armed only.
                        let weapon_ok = e
                            .character
                            .as_ref()
                            .is_none_or(|ch| self.weapon_eligible(def, ch));
                        let ready = (sg.cooldown_left == 0
                            && weapon_ok
                            && c.map(|c| c.mana >= cost && now >= c.busy_until)
                                .unwrap_or(false)) as i32;
                        [
                            (i + 1) as i32,
                            sg.gem.gem_idx as i32,
                            sg.gem.level as i32,
                            sg.cooldown_left as i32,
                            range,
                            shape,
                            crate::world::fx_from_cu(def.radius_cu).raw(),
                            cost.clamp(0, i32::MAX as i64) as i32,
                            use_ticks,
                            target_mode,
                            skill_kind,
                            ready,
                        ]
                    })
                    .collect();
                for (i, rec) in records.iter().enumerate() {
                    let base = out.wrapping_add(i as u16 * SKILL_RECORD_SIZE);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                }
                records.len() as i32
            }
            SYS_SOCKET_GEM => {
                let socket_sel = bot.vm.pop();
                let pouch_sel = bot.vm.pop();
                self.socket_gem(slot, socket_sel, pouch_sel, events)
            }
            SYS_RANDOM => bot.rng.next_u32() as i32,
            _ => -1,
        }
    }
}

/// FNV-1a over program bytes — bot programs are content-addressed.
pub fn program_hash(program: &[u8]) -> u64 {
    let mut h = crate::hash::Fnv1a64::new();
    h.write_bytes(program);
    h.finish()
}
