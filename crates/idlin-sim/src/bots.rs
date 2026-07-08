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
//! SelfStatus + every record stride are the VM-ABI, single-owned in
//! `idlin_vm::abi` (#50) — the host writers below consume those consts (a pin test
//! locks their values), and the bot side consumes the same owner via the generated
//! `content/lib/gen_abi.bot` include, so the two can't drift.

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

// Record strides come from idlin_vm::abi — the single VM-ABI owner (#50). (Doc
// comments for each record's field layout live there. The `.bot` side reads the
// same values via the generated content/lib/gen_abi.bot include.)
pub use idlin_vm::abi::{
    ENTITY_RECORD_SIZE, EQUIPMENT_RECORD_SIZE, INVENTORY_RECORD_SIZE, ITEM_MODS_RECORD_SIZE,
    SKILL_RECORD_SIZE,
};
// The SelfStatus field offsets (SS_*) are read below at their named addresses, so
// the host's write layout IS the single owner (no implicit array-order contract).
use idlin_vm::abi;

// Syscall numbers come from idlin_vm — the single ABI owner shared with
// the compiler's BUILTINS table.
use idlin_vm::{
    SYS_COUNT_ENTITIES, SYS_DEBUG, SYS_DROP_ITEM, SYS_EQUIP, SYS_EQUIP_BEST, SYS_ITEM_SLOT,
    SYS_LINE_OF_SIGHT, SYS_MOVE_ITEM, SYS_MOVE_TO, SYS_PICK_UP, SYS_RANDOM, SYS_READ_AILMENTS,
    SYS_READ_CURRENCY, SYS_READ_ENTITIES, SYS_READ_EQUIPMENT, SYS_READ_EXITS, SYS_READ_INVENTORY,
    SYS_READ_ITEM_MODS, SYS_READ_SKILLS, SYS_READ_STASH, SYS_SAY, SYS_SELF_STATUS, SYS_SELL,
    SYS_SET_BUILD, SYS_SKILL_INFO, SYS_SOCKET_GEM, SYS_STASH, SYS_UNEQUIP, SYS_USE_CHART,
    SYS_USE_CURRENCY, SYS_USE_EXIT, SYS_USE_FLASK, SYS_USE_SKILL, SYS_USE_SKILL_AT,
    SYS_USE_SKILL_DIR,
};
/// UseExit reach: how close a bot must stand to take an exit.
pub const EXIT_REACH_RAW: i32 = 3 * 65536 / 2; // 1.5 u

// SkillInfo writes a single 3-word record (shape, radius, skill_kind) inline —
// distinct from the ReadSkills record stride (SKILL_RECORD_SIZE, in idlin_vm::abi).
/// Hard cap on inventory query results (a 12×5 bag of 1×1s caps at 60).
pub const MAX_INVENTORY_RESULTS: usize = 60;
/// Hard cap on rolled-mod results per item.
pub const MAX_ITEM_MODS: usize = 16;

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
            SYS_READ_AILMENTS => {
                // arg: target net id → a bitmask of its active ailments (#88):
                // bit0 Ignite, bit1 Shock, bit2 Chill. 0 if unknown/unafflicted.
                let net = bot.vm.pop() as u32;
                let Some(e) = self.zone.get_net(net) else {
                    return 0;
                };
                use crate::entity::AilmentKind;
                let mut bits = 0;
                if e.ailment(AilmentKind::Ignite) > 0 {
                    bits |= 1;
                }
                if e.ailment(AilmentKind::Shock) > 0 {
                    bits |= 2;
                }
                if e.ailment(AilmentKind::Chill) > 0 {
                    bits |= 4;
                }
                bits
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
                // SS_FLAGS bit1 (#136): act 1 complete — exposed so brains can
                // pivot on campaign progress (the stock brain adopts it in T6).
                let act1 = e.character.as_ref().is_some_and(|c| c.story_acts & 1 != 0);
                // Act 2 (#148 A3): the same generic ladder — flags bit N = act N.
                let act2 = e.character.as_ref().is_some_and(|c| c.story_acts & 2 != 0);
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
                // Each field at its named SS_ offset (idlin_vm::abi, #50) — the
                // single owner the `.bot` reads mirror. Order/values unchanged.
                bot.vm.store_i32(out.wrapping_add(abi::SS_X), e.pos.x.raw());
                bot.vm.store_i32(out.wrapping_add(abi::SS_Y), e.pos.y.raw());
                bot.vm.store_i32(out.wrapping_add(abi::SS_LIFE), life);
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_LIFE_MAX), life_max);
                bot.vm.store_i32(out.wrapping_add(abi::SS_LEVEL), level);
                bot.vm.store_i32(out.wrapping_add(abi::SS_XP), xp);
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_MAP_W), self.zone.width.raw());
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_MAP_H), self.zone.height.raw());
                bot.vm.store_i32(
                    out.wrapping_add(abi::SS_FLAGS),
                    dead as i32 | ((act1 as i32) << 1) | ((act2 as i32) << 2),
                );
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_ANCHOR_X), anchor.x.raw());
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_ANCHOR_Y), anchor.y.raw());
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_AGGRO_RADIUS), aggro);
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_ATTACK_RANGE), range);
                bot.vm.store_i32(out.wrapping_add(abi::SS_MANA), mana);
                bot.vm
                    .store_i32(out.wrapping_add(abi::SS_MANA_MAX), mana_max);
                bot.vm.store_i32(out.wrapping_add(abi::SS_ES), es);
                // Which map this is: the zone's stable tagged num (#54). Bot writers
                // branch their whole strategy on it — grind the shore, stroll the town.
                bot.vm.store_i32(
                    out.wrapping_add(abi::SS_ZONE),
                    self.content_num(idlin_content::ids::Category::Zone, self.zone_idx as usize),
                );
                // The Charting Table (#136 T6): where charts spend, in world
                // coords (Q16.16 cell centers), or -1/-1 in table-less zones.
                let (tx, ty) = self.chart_table.map_or((-1, -1), |(x, y)| {
                    (Fx::from_int(x as i16).raw(), Fx::from_int(y as i16).raw())
                });
                bot.vm.store_i32(out.wrapping_add(abi::SS_TABLE_X), tx);
                bot.vm.store_i32(out.wrapping_add(abi::SS_TABLE_Y), ty);
                let cellq = |c: Option<(i32, i32)>| match c {
                    Some((x, y)) => (x * 65536 + 32768, y * 65536 + 32768),
                    None => (-1, -1),
                };
                let (vx, vy) = cellq(self.vendor);
                bot.vm.store_i32(out.wrapping_add(abi::SS_VENDOR_X), vx);
                bot.vm.store_i32(out.wrapping_add(abi::SS_VENDOR_Y), vy);
                let (sx2, sy2) = cellq(self.stash_cell);
                bot.vm.store_i32(out.wrapping_add(abi::SS_STASH_X), sx2);
                bot.vm.store_i32(out.wrapping_add(abi::SS_STASH_Y), sy2);
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
                    // The record's rarity word covers BOTH ladders (#148
                    // A2.5 review): a live monster's rank (normal 0 …
                    // unique 3) or a loot pile's tier — the old loot-only
                    // read left every live enemy at 0, which silently
                    // killed the templates' boss exemption.
                    let rarity = e
                        .monster
                        .as_ref()
                        .map(|m| m.rarity as i32)
                        .or_else(|| e.loot.as_ref().map(|l| l.rarity as i32))
                        .unwrap_or(0);
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
                // Is the straight line from me to (x, y) clear of wall
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
            // UseChart (#136 T4): consume a chart from the bag at the Charting
            // Table and sail. 0 = departing this tick; -1 bad index / not a
            // chart; -2 not at a table; -3 Act 1 incomplete (the sea is sealed
            // until the Mother falls); -4 not a character; -5 a departure is
            // already staged this tick (the chart is NOT consumed).
            SYS_USE_CHART => {
                let inv_sel = bot.vm.pop();
                self.use_chart(slot, inv_sel)
            }
            SYS_SELL => {
                let inv_sel = bot.vm.pop();
                self.sell(slot, inv_sel, events)
            }
            SYS_STASH => {
                let sel = bot.vm.pop();
                let op = bot.vm.pop();
                self.stash_op(slot, op, sel)
            }
            SYS_READ_STASH => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, MAX_INVENTORY_RESULTS as i32) as usize;
                let Some(e) = self.zone.get(slot) else {
                    return -4;
                };
                let Some(ch) = &e.character else { return -4 };
                // Same record as ReadInventory; x/y are -1 (no grid).
                let records: Vec<[i32; 5]> = ch
                    .stash
                    .iter()
                    .take(max)
                    .map(|item| match item {
                        crate::entity::BagItem::Gear(it) => [
                            self.content_num(
                                idlin_content::ids::Category::Item,
                                it.base_idx as usize,
                            ),
                            it.rarity as i32,
                            it.item_level as i32,
                            -1,
                            -1,
                        ],
                        crate::entity::BagItem::Gem(g) => [
                            self.content_num(idlin_content::ids::Category::Gem, g.gem_idx as usize),
                            crate::entity::Rarity::Normal as i32,
                            g.level as i32,
                            -1,
                            -1,
                        ],
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
            SYS_USE_CURRENCY => {
                let currency_sel = bot.vm.pop();
                let inv_sel = bot.vm.pop();
                // The bot passes a currency NUM; translate to its content index.
                let cidx = match self.content_idx(currency_sel) {
                    Some((idlin_content::ids::Category::Currency, i)) => i as i32,
                    _ => -1,
                };
                self.use_currency(slot, cidx, inv_sel, events)
            }
            SYS_SAY => {
                let line = bot.vm.pop();
                self.try_say(slot, line, events)
            }
            SYS_USE_FLASK => {
                // Drink a flask: 0 = restored; -1 no flask equipped;
                // -2 all useful flasks empty; -3 nothing to restore.
                // Resource-aware: picks the belt loop whose flask
                // restores what you actually LACK. The bot decides WHEN.
                let (need_life, need_mana) =
                    match self.zone.get(slot).and_then(|e| e.combat.as_ref()) {
                        Some(c) => (c.life < c.life_max, c.mana < c.mana_max),
                        None => return -1,
                    };
                let mut found_any = false;
                let mut pick: Option<(usize, u32, i64, i64)> = None;
                if let Some(ch) = self.zone.get(slot).and_then(|e| e.character.as_ref()) {
                    for fs in idlin_content::GearSlot::FLASK_SLOTS {
                        let Some(f) = ch.equipment[fs].as_ref() else {
                            continue;
                        };
                        found_any = true;
                        let def = &self.content_items()[f.base_idx as usize];
                        let useful =
                            (def.flask_heal > 0 && need_life) || (def.flask_mana > 0 && need_mana);
                        if useful && f.charges >= def.flask_cost && pick.is_none() {
                            pick = Some((fs, def.flask_cost, def.flask_heal, def.flask_mana));
                        }
                    }
                }
                let Some((flask_slot, cost, heal, mana)) = pick else {
                    if !found_any {
                        return -1;
                    }
                    return if need_life || need_mana { -2 } else { -3 };
                };
                let Some(e) = self.zone.get_mut(slot) else {
                    return -1;
                };
                let Some(ch) = e.character.as_mut() else {
                    return -1;
                };
                let Some(flask) = ch.equipment[flask_slot].as_mut() else {
                    return -1;
                };
                flask.charges = flask.charges.saturating_sub(cost);
                let c = e.combat.as_mut().unwrap();
                c.life = (c.life + heal).min(c.life_max);
                c.mana = (c.mana + mana).min(c.mana_max);
                0
            }
            SYS_READ_EXITS => {
                // The zone's exits as 16-byte records: (x raw, y raw, open,
                // dest zone num). Returns how many were written — the bot
                // navigates to and takes them itself; nothing ever forces a
                // transfer. The dest num (#136 T6) lets a brain ROUTE (match
                // it against the generated ZONE_* consts); -1 = unknown.
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, 16) as usize;
                let n = self.zone.exits.len().min(max);
                for (i, exit) in self.zone.exits.iter().take(n).enumerate() {
                    let base = out.wrapping_add(abi::EXIT_RECORD_SIZE * i as u16);
                    bot.vm.store_i32(base, exit.pos.x.raw());
                    bot.vm.store_i32(base.wrapping_add(4), exit.pos.y.raw());
                    bot.vm.store_i32(base.wrapping_add(8), exit.open as i32);
                    let dest = self.zone_num_by_id(&exit.dest);
                    bot.vm.store_i32(base.wrapping_add(12), dest);
                }
                n as i32
            }
            // 0 staged; -1 none in reach; -2 closed; -3 story-sealed (#136).
            SYS_USE_EXIT => {
                // Take the exit underfoot. 0 = staged (departs this tick),
                // −1 no exit in reach, −2 the exit in reach is closed.
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                if e.character.is_none() {
                    return -1; // monsters live and die in their zone
                }
                let net = e.net_id;
                let pos = e.pos;
                let story_acts = e.character.as_ref().map(|c| c.story_acts).unwrap_or(0);
                let reach = crate::fixed::Fx::from_raw(EXIT_REACH_RAW);
                let mut found_closed = false;
                let mut found_sealed = false;
                let mut dest: Option<String> = None;
                for exit in &self.zone.exits {
                    if pos.dist(exit.pos) > reach {
                        continue;
                    }
                    // Story seal (#136): an exit can require a completed act.
                    // Sealed reads distinctly from closed — the bot can tell
                    // "come back stronger" (-3) apart from "not open yet" (-2).
                    if exit.requires_act > 0 && story_acts & (1 << (exit.requires_act - 1)) == 0 {
                        found_sealed = true;
                        continue;
                    }
                    if exit.open {
                        dest = Some(exit.dest.clone());
                        break;
                    }
                    found_closed = true;
                }
                match dest {
                    Some(dest) => {
                        if !self.pending_exits.iter().any(|(n, ..)| *n == net) {
                            self.pending_exits.push((net, dest, None));
                        }
                        0
                    }
                    None if found_sealed => -3,
                    None if found_closed => -2,
                    None => -1,
                }
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
                // Record (#54): num, rarity, item_level, x, y. The bag holds
                // BOTH gear and gems (PR2b) — they're told apart by the num's
                // category (`num >> 23`): gear → CAT_ITEM, gem → CAT_GEM. A
                // gem has no rarity (0) and reports its gem LEVEL in the
                // item_level slot. slot/w/h (gear) and gem statics live in docs.
                let records: Vec<[i32; 5]> = ch
                    .inventory
                    .iter()
                    .take(max)
                    .map(|placed| match &placed.item {
                        crate::entity::BagItem::Gear(it) => [
                            self.content_num(
                                idlin_content::ids::Category::Item,
                                it.base_idx as usize,
                            ),
                            it.rarity as i32,
                            it.item_level as i32,
                            placed.x as i32,
                            placed.y as i32,
                        ],
                        crate::entity::BagItem::Gem(g) => [
                            self.content_num(idlin_content::ids::Category::Gem, g.gem_idx as usize),
                            crate::entity::Rarity::Normal as i32,
                            g.level as i32,
                            placed.x as i32,
                            placed.y as i32,
                        ],
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
                // v2 (#54): each entry is a 4-byte i32 tagged node num.
                let refs: Vec<i32> = (0..count)
                    .map(|i| bot.vm.load_i32(addr.wrapping_add(4 * i)))
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
                // Record (#54 PR2a): slot_no, gem_num, level, cooldown_left,
                // range, mana_cost, use_ticks, target_mode, ready, life_cost. The
                // pure-def GEOMETRY (shape/radius/skill_kind) moved to SkillInfo;
                // but target_mode stays — a bot needs it EVERY fire to pick the
                // UseSkill variant, so forcing a per-fire syscall for it would be
                // wasteful. range/cost/use_ticks/life_cost stay too (they fold
                // supports + live stats, not pure-def). life_cost is the FINAL
                // per-use life cost (#98) and is NOT folded into `ready`: a life
                // cost is ungated, so a bot that wants to avoid bleeding out must
                // weigh it against SelfStatus life itself.
                let records: Vec<[i32; 10]> = gems
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
                        let target_mode = match def.target_mode {
                            idlin_content::TargetMode::Entity => 0,
                            idlin_content::TargetMode::Point => 1,
                            idlin_content::TargetMode::Direction => 2,
                        };
                        // Final costs: support cost multipliers included.
                        let cost = self.skill_mana_cost(sg);
                        let life_cost = self.skill_life_cost(sg);
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
                            self.content_num(
                                idlin_content::ids::Category::Gem,
                                sg.gem.gem_idx as usize,
                            ),
                            sg.gem.level as i32,
                            sg.cooldown_left as i32,
                            range,
                            cost.clamp(0, i32::MAX as i64) as i32,
                            use_ticks,
                            target_mode,
                            ready,
                            life_cost.clamp(0, i32::MAX as i64) as i32,
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
            SYS_SKILL_INFO => {
                let slot_no = bot.vm.pop();
                let out = bot.vm.pop() as u16;
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                // Same slot space as ReadSkills (1-based; slot 0 is the basic
                // weapon attack, which has no gem def → -1).
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
                // Guard BEFORE subtracting: slot_no is raw bot input, and
                // `i32::MIN - 1` would overflow-panic in debug builds. Slot 0 is
                // the basic weapon attack (no gem def) → -1, like any bad slot.
                if slot_no <= 0 {
                    return -1;
                }
                let Some(sg) = gems.get(slot_no as usize - 1) else {
                    return -1;
                };
                let def = &self.content_gems()[sg.gem.gem_idx as usize];
                let shape = match def.shape {
                    idlin_content::SkillShape::Target => 0,
                    idlin_content::SkillShape::Nova => 1,
                    idlin_content::SkillShape::Cone => 2,
                    idlin_content::SkillShape::Line => 3,
                    idlin_content::SkillShape::PointAoe => 4,
                    idlin_content::SkillShape::Projectile => 5,
                };
                let skill_kind = match def.skill_kind {
                    idlin_content::SkillKind::Attack => 0,
                    idlin_content::SkillKind::Spell => 1,
                };
                // Record: shape, radius, skill_kind — the static geometry/kind a
                // bot needs to position AoE; target_mode lives in ReadSkills.
                let rec = [
                    shape,
                    crate::world::fx_from_cu(def.radius_cu).raw(),
                    skill_kind,
                ];
                for (j, v) in rec.iter().enumerate() {
                    bot.vm.store_i32(out.wrapping_add(4 * j as u16), *v);
                }
                0
            }
            SYS_READ_ITEM_MODS => {
                let inv_idx = bot.vm.pop();
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, MAX_ITEM_MODS as i32) as usize;
                let Some(e) = self.zone.get(slot) else {
                    return -1;
                };
                let Some(ch) = &e.character else { return -1 };
                let Ok(idx) = usize::try_from(inv_idx) else {
                    return -1;
                };
                let Some(placed) = ch.inventory.get(idx) else {
                    return -1;
                };
                // Only gear carries rolled affixes; a gem (1×1 bag item, #54
                // PR2b) has none — report zero mods, not an error.
                let Some(item) = placed.item.as_gear() else {
                    return 0;
                };
                // Record PER EFFECT: affix_num, effect_index, rolled value, tier.
                // A hybrid affix (#86) expands to one row per rolled value, all
                // sharing affix_num; the stat is definitional (docs lookup).
                let records: Vec<[i32; 4]> = item
                    .affixes
                    .iter()
                    .flat_map(|a| {
                        let num = self
                            .content_num(idlin_content::ids::Category::Affix, a.affix_idx as usize);
                        let tier = a.tier as i32;
                        a.values.iter().enumerate().map(move |(ei, &v)| {
                            [
                                num,
                                ei as i32,
                                v.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
                                tier,
                            ]
                        })
                    })
                    .take(max)
                    .collect();
                for (i, rec) in records.iter().enumerate() {
                    let base = out.wrapping_add(i as u16 * ITEM_MODS_RECORD_SIZE);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                }
                records.len() as i32
            }
            SYS_SOCKET_GEM => {
                let socket_sel = bot.vm.pop();
                // #54 PR2b: the gem source is a BAG slot index now, not a pouch
                // index (gems live in the grid). -1 = auto-pick.
                let inv_sel = bot.vm.pop();
                self.socket_gem(slot, socket_sel, inv_sel, events)
            }
            SYS_READ_EQUIPMENT => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, crate::entity::GEAR_SLOTS as i32) as usize;
                if self
                    .zone
                    .get(slot)
                    .and_then(|e| e.character.as_ref())
                    .is_none()
                {
                    return -1;
                }
                // One record per gear slot (#54 PR3): slot, base_num (-1 when
                // empty), rarity, item_level. Built by `equipment_records` so the
                // layout is unit-testable; written here to the VM buffer.
                let records = self.equipment_records(slot, max);
                for (i, rec) in records.iter().enumerate() {
                    let base = out.wrapping_add(i as u16 * EQUIPMENT_RECORD_SIZE);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                }
                records.len() as i32
            }
            SYS_EQUIP => {
                let inv_sel = bot.vm.pop();
                self.equip(slot, inv_sel, events)
            }
            SYS_UNEQUIP => {
                let gear_sel = bot.vm.pop();
                self.unequip(slot, gear_sel, events)
            }
            SYS_ITEM_SLOT => {
                let num = bot.vm.pop();
                self.item_slot_of_num(num)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::World;
    use idlin_content::ContentDb;
    use std::path::Path;

    /// #136: SS_FLAGS packs bit0 = dead and bit1 = act-1-complete — asserted
    /// through the REAL syscall handler with a DEAD entity. (run_bots skips
    /// dead bots, so the per-tick path can never observe bit0 on yourself; the
    /// handler below is still the ABI's single owner and must stay correct.)
    /// Mutations: shift `dead` off bit0 → the dead read isn't 1; shift act1
    /// off bit1 → the storied read isn't 2; the combined read pins 3.
    #[test]
    fn self_status_flags_pack_dead_bit0_and_act_bit1() {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut world = World::new(14, &content);
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Flagged".into(),
                program: idlin_botc::assemble("halt\n").unwrap(),
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let bot_idx = world.zone.get(slot).unwrap().bot.unwrap();
        let mut bot = world.bots.take(bot_idx).unwrap();
        let read_flags = |world: &mut World, bot: &mut Bot| -> i32 {
            bot.vm.push(0xF000);
            let r = world.syscall(slot, bot, SYS_SELF_STATUS, 1, &mut Vec::new());
            assert_eq!(r, 0, "SelfStatus succeeds");
            bot.vm.load_i32(0xF000 + abi::SS_FLAGS)
        };
        assert_eq!(read_flags(&mut world, &mut bot), 0, "alive, no acts");
        world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 1;
        assert_eq!(read_flags(&mut world, &mut bot), 2, "act 1 on bit 1");
        world
            .zone
            .get_mut(slot)
            .unwrap()
            .combat
            .as_mut()
            .unwrap()
            .life = 0;
        assert_eq!(read_flags(&mut world, &mut bot), 3, "dead + act 1 = 3");
        world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .story_acts = 0;
        assert_eq!(read_flags(&mut world, &mut bot), 1, "dead alone = bit 0");
        world.bots.put_back(bot_idx, bot);
    }

    /// #54 PR3: drive SYS_READ_EQUIPMENT through the VM and confirm the records
    /// land at the `EQUIPMENT_RECORD_SIZE` (16-byte) stride the bot-guide
    /// promises. The pure-records unit test pins field order; THIS pins the
    /// syscall's memory writes — a wrong stride would pass that test yet feed
    /// bots garbage (they read at `EQUIPMENT_RECORD_SIZE`, the single owner #50).
    #[test]
    fn read_equipment_syscall_writes_records_at_the_documented_stride() {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut world = World::new(13, &content);
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
        let cleaver_num = content
            .content_num(idlin_content::ids::Category::Item, cleaver_idx)
            .unwrap();
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
                rarity: crate::entity::Rarity::Normal,
                item_level: 4,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
                unique_idx: None,
            });
        }
        let bot_idx = world.zone.get(slot).unwrap().bot.unwrap();
        let mut bot = world.bots.take(bot_idx).unwrap();
        let out: u16 = 0xD000;
        // Args pushed in reverse (max then out); the dispatch pops out first.
        // Request the full slate so the returned count is the live GEAR_SLOTS.
        bot.vm.push(crate::entity::GEAR_SLOTS as i32);
        bot.vm.push(out as i32);
        let mut ev = Vec::new();
        let count = world.syscall(slot, &mut bot, SYS_READ_EQUIPMENT, 2, &mut ev);
        assert_eq!(
            count,
            crate::entity::GEAR_SLOTS as i32,
            "one record per gear slot"
        );
        let rd = |addr: u16, field: usize| bot.vm.load_i32(addr.wrapping_add(4 * field as u16));
        // Record 0 (the worn weapon) at out + 0.
        assert_eq!(rd(out, 0), 0, "record 0 slot index");
        assert_eq!(rd(out, 1), cleaver_num, "record 0 base_num");
        assert_eq!(rd(out, 3), 4, "record 0 item_level");
        // Record 1 (empty offhand) read at the LITERAL 16-byte stride the
        // bot-guide promises (the `.bot` side now consumes EQUIPMENT_RECORD_SIZE
        // from gen_abi.bot, #50) — pinned here as a LITERAL, NOT the const, so a
        // regression that changed the owner (and the dispatch with it) to a
        // different stride would land record 1's slot index elsewhere and fail here.
        assert_eq!(EQUIPMENT_RECORD_SIZE, 16, "the documented record stride");
        assert_eq!(rd(out.wrapping_add(16), 0), 1, "record 1 slot index @ +16");
        assert_eq!(
            rd(out.wrapping_add(16), 1),
            -1,
            "record 1 empty → base_num -1"
        );
        world.bots.put_back(bot_idx, bot);
    }

    #[test]
    fn read_ailments_syscall_returns_the_bitmask() {
        // #88: ReadAilments(net) → bit0 Ignite | bit1 Shock | bit2 Chill, 0 if
        // unknown. Mutation: drop a bit in the dispatch → the assert fails.
        use crate::entity::{ActiveEffect, AilmentKind};
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut world = World::new(13, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Reader".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        let (mon_slot, mon_net) = world
            .zone
            .iter()
            .find(|(_, e)| e.monster.is_some() && e.alive())
            .map(|(s, e)| (s, e.net_id))
            .unwrap();
        let effs = &mut world.zone.get_mut(mon_slot).unwrap().effects;
        effs.push(ActiveEffect::Ailment {
            kind: AilmentKind::Ignite,
            magnitude: 5,
            ticks_left: 40,
            source: 0,
        });
        effs.push(ActiveEffect::Ailment {
            kind: AilmentKind::Shock,
            magnitude: 1000,
            ticks_left: 40,
            source: 0,
        });
        let bot_idx = world.zone.get(slot).unwrap().bot.unwrap();
        let mut bot = world.bots.take(bot_idx).unwrap();
        let mut ev = Vec::new();
        bot.vm.push(mon_net as i32);
        assert_eq!(
            world.syscall(slot, &mut bot, SYS_READ_AILMENTS, 1, &mut ev),
            1 | 2,
            "ignite|shock bitmask"
        );
        bot.vm.push(999_999);
        assert_eq!(
            world.syscall(slot, &mut bot, SYS_READ_AILMENTS, 1, &mut ev),
            0,
            "unknown entity → 0"
        );
        // A negative net id casts to a huge u32 → no entity → 0, no panic.
        bot.vm.push(-1);
        assert_eq!(
            world.syscall(slot, &mut bot, SYS_READ_AILMENTS, 1, &mut ev),
            0,
            "negative net id → 0 (no panic)"
        );
        world.bots.put_back(bot_idx, bot);
    }

    #[test]
    fn read_skills_syscall_exposes_life_cost_as_the_tenth_word() {
        // #98: the ReadSkills record grew a 10th word — the FINAL per-use life
        // cost at +36 — and the stride widened 36 → 40. Give war_cry a life cost,
        // socket it ALONGSIDE a no-life-cost skill, and read both records back
        // through the syscall. Mutation guards: zeroing/dropping the life_cost
        // word fails the +36 read; reverting the stride to 36 lands record 1's
        // slot number somewhere other than +40.
        let mut content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let wc = content
            .gems
            .iter()
            .position(|g| g.id == "war_cry")
            .expect("war_cry gem");
        content.gems[wc].life_cost = idlin_content::Formula {
            base: 30,
            per_level: 0,
        };
        let cleave = content
            .gems
            .iter()
            .position(|g| g.id == "cleave")
            .expect("cleave gem");
        let war_num = content
            .content_num(idlin_content::ids::Category::Gem, wc)
            .unwrap();
        let mut world = World::new(13, &content);
        let program = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&crate::TickInputs {
            joins: vec![crate::JoinRequest {
                name: "Bleeder".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .unwrap();
        // First two socket nodes, ascending. `ch.sockets` is ordered, so the
        // lower node id is record 0 — war_cry goes there, cleave second.
        let mut socket_nodes = content
            .tree
            .iter()
            .enumerate()
            .filter(|(_, n)| n.kind == idlin_content::NodeKind::Socket)
            .map(|(i, _)| i as u32);
        let node_a = socket_nodes.next().expect("socket node A");
        let node_b = socket_nodes.next().expect("socket node B");
        assert!(node_a < node_b, "sockets iterate in ascending node order");
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            ch.sockets.insert(
                node_a,
                crate::entity::SocketedGem {
                    gem: crate::entity::GemInstance {
                        gem_idx: wc as u32,
                        level: 1,
                        xp: 0,
                    },
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
            ch.sockets.insert(
                node_b,
                crate::entity::SocketedGem {
                    gem: crate::entity::GemInstance {
                        gem_idx: cleave as u32,
                        level: 1,
                        xp: 0,
                    },
                    cooldown_left: 0,
                    supports: Vec::new(),
                },
            );
        }
        let bot_idx = world.zone.get(slot).unwrap().bot.unwrap();
        let mut bot = world.bots.take(bot_idx).unwrap();
        let out: u16 = 0xD100;
        // Args pushed in reverse (max then out); the dispatch pops out first.
        bot.vm.push(8);
        bot.vm.push(out as i32);
        let mut ev = Vec::new();
        let count = world.syscall(slot, &mut bot, SYS_READ_SKILLS, 2, &mut ev);
        assert_eq!(count, 2, "two socketed skills → two records");
        assert_eq!(SKILL_RECORD_SIZE, 40, "the documented 40-byte stride");
        let rd = |addr: u16, field: usize| bot.vm.load_i32(addr.wrapping_add(4 * field as u16));
        // Record 0 (war_cry): the life cost is the 10th word, at +36.
        assert_eq!(rd(out, 0), 1, "record 0 slot_no");
        assert_eq!(rd(out, 1), war_num, "record 0 is war_cry");
        assert_eq!(rd(out, 9), 30, "war_cry life_cost at +36 (word 9)");
        // Record 1 (cleave) read at the LITERAL 40-byte stride: its slot_no is 2,
        // which only lands at +40 if the record really is 40 bytes wide; and its
        // life cost is 0, proving word 9 is per-gem, not a constant.
        assert_eq!(rd(out.wrapping_add(40), 0), 2, "record 1 slot_no @ +40");
        assert_eq!(
            rd(out.wrapping_add(40), 9),
            0,
            "cleave has no life cost → word 9 is 0"
        );
        world.bots.put_back(bot_idx, bot);
    }
}
