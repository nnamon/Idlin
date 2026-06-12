//! The zone brain: the dungeon master is a bot too. An optional bot
//! program (ZoneDef.brain) runs once per tick at the END of the pipeline
//! with a zone-scoped syscall table — scripted encounters, narration
//! beats, and guaranteed drops are all content, never engine hooks.
//!
//! Events are DATA the script drains (PollEvents), not callbacks: the VM
//! stays a synchronous one-main()-per-tick machine.

use super::{SimEvent, World};
use crate::bots::{Bot, SYSCALL_COST};
use crate::entity::{GemInstance, Item, LootPayload, Rarity};
use crate::fixed::{Fx, FxV2};
use idlin_vm::DEFAULT_TICK_BUDGET;
use idlin_vm::RunExit;

// Event kinds the brain can drain (record: kind, char net, a, b).
pub const EV_KILL: i32 = 1; // a = monster def idx, b = monster level
pub const EV_EQUIP: i32 = 2; // a = rarity
pub const EV_SOCKET: i32 = 3;
pub const EV_LEVEL: i32 = 4; // a = new level
pub const EV_DIED: i32 = 5;
pub const EV_PICKUP: i32 = 6; // a = rarity

// Zone-scoped syscalls (entity bots get -1 for these).
const SYS_QUERY_CHARACTERS: i32 = 100;
const SYS_POLL_EVENTS: i32 = 101;
const SYS_NARRATE: i32 = 102;
const SYS_DROP_LOOT: i32 = 103;
const SYS_SPAWN_MONSTER: i32 = 104;
const SYS_SET_EXIT: i32 = 106;
const SYS_SET_GATE: i32 = 107;
const SYS_SPAWN_ELITE: i32 = 108;
const SYS_DEBUG: i32 = 0;
const SYS_RANDOM: i32 = 15;

/// QueryCharacters record: net, kills, level, x, y, weapon_class, life_pct,
/// dead — 8 words.
const CHAR_RECORD_WORDS: u16 = 10;

impl World {
    /// Translate this tick's events for the brain, then run it. Runs at the
    /// end of the tick: the script sees the tick complete; its own verbs
    /// (spawns, drops, narration) land in the same event stream.
    pub(super) fn run_zone_brain(&mut self, events: &mut Vec<SimEvent>) {
        if self.zone_brain.is_none() {
            return;
        }
        self.zone_brain_inbox.clear();
        for ev in events.iter() {
            let rec = match ev {
                SimEvent::MonsterKilled {
                    killer_id,
                    def_idx,
                    level,
                    ..
                } => [EV_KILL, *killer_id as i32, *def_idx as i32, *level as i32],
                SimEvent::ItemEquipped { id, rarity, .. } => {
                    [EV_EQUIP, *id as i32, *rarity as i32, 0]
                }
                SimEvent::GemSocketed { id, .. } => [EV_SOCKET, *id as i32, 0, 0],
                SimEvent::LevelUp { id, level, .. } => [EV_LEVEL, *id as i32, *level as i32, 0],
                SimEvent::CharacterDied { id, .. } => [EV_DIED, *id as i32, 0, 0],
                SimEvent::ItemPickedUp {
                    owner_id, rarity, ..
                } => [EV_PICKUP, *owner_id as i32, *rarity as i32, 0],
                _ => continue,
            };
            self.zone_brain_inbox.push(rec);
        }

        let Some(mut bot) = self.zone_brain.take() else {
            return;
        };
        let mut budget = DEFAULT_TICK_BUDGET;
        loop {
            match bot.vm.run(&mut budget) {
                RunExit::Halted | RunExit::OutOfBudget => break,
                RunExit::Syscall { number, argc } => {
                    let result = self.zone_syscall(&mut bot, number, argc, events);
                    bot.vm.push(result);
                    budget = budget.saturating_sub(SYSCALL_COST);
                }
            }
        }
        self.zone_brain = Some(bot);
        self.zone_brain_inbox.clear();
    }

    fn zone_syscall(
        &mut self,
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
                events.push(SimEvent::BotDebug { id: 0, values });
                0
            }
            SYS_RANDOM => bot.rng.next_u32() as i32,
            SYS_QUERY_CHARACTERS => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, 16) as usize;
                let mut n = 0u16;
                for (_, e) in self.zone.iter() {
                    if n as usize >= max {
                        break;
                    }
                    let Some(ch) = &e.character else { continue };
                    let c = e.combat.as_ref();
                    let wclass = ch.equipment[idlin_content::GearSlot::Weapon.idx()]
                        .as_ref()
                        .and_then(|i| self.content.items[i.base_idx as usize].weapon_class)
                        .map(|w| w as i32)
                        .unwrap_or(-1);
                    // Declared-build signals: the gate that asks "who are
                    // you going to be?" reads these. Archetype from the
                    // build plan's limb sockets/keystones: 0 melee, 1 bow,
                    // 2 wand, -1 undeclared/unclear.
                    let arch = {
                        let has = |num: u16| {
                            ch.build_plan.iter().any(|&n| {
                                self.content.tree_refs.get(n as usize).copied() == Some(num)
                                    || n == num as u32
                            })
                        };
                        if ch.build_plan.is_empty() {
                            -1
                        } else if has(26) || has(25) || has(36) || has(35) {
                            0
                        } else if has(56) || has(55) || has(66) || has(65) {
                            1
                        } else if has(86) || has(85) || has(96) || has(95) {
                            2
                        } else {
                            -1
                        }
                    };
                    let rec: [i32; CHAR_RECORD_WORDS as usize] = [
                        e.net_id as i32,
                        ch.kills.min(i32::MAX as u64) as i32,
                        ch.level as i32,
                        e.pos.x.raw(),
                        e.pos.y.raw(),
                        wclass,
                        c.map(|c| c.life_pct() as i32).unwrap_or(0),
                        (!e.alive()) as i32,
                        ch.build_plan.len() as i32,
                        arch,
                    ];
                    let base = out.wrapping_add(n * CHAR_RECORD_WORDS * 4);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                    n += 1;
                }
                n as i32
            }
            SYS_POLL_EVENTS => {
                let out = bot.vm.pop() as u16;
                let max = bot.vm.pop().clamp(0, 32) as usize;
                let n = self.zone_brain_inbox.len().min(max);
                for (i, rec) in self.zone_brain_inbox.drain(..n).enumerate() {
                    let base = out.wrapping_add(i as u16 * 16);
                    for (j, v) in rec.iter().enumerate() {
                        bot.vm.store_i32(base.wrapping_add(4 * j as u16), *v);
                    }
                }
                n as i32
            }
            SYS_NARRATE => {
                let line = bot.vm.pop();
                let target = bot.vm.pop();
                let Some(text) = self
                    .zone_lines
                    .get(usize::try_from(line).unwrap_or(usize::MAX))
                else {
                    return -1;
                };
                events.push(SimEvent::Narration {
                    target: target.max(0) as u32,
                    text: text.clone(),
                });
                0
            }
            SYS_DROP_LOOT => {
                let kind = bot.vm.pop();
                let idx = bot.vm.pop();
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                let owner = bot.vm.pop().max(0) as u32;
                let pos = self
                    .zone
                    .clamp_pos(FxV2::new(Fx::from_raw(x), Fx::from_raw(y)));
                let payload = match kind {
                    // A plain gear base (the scripted first weapon).
                    0 => {
                        let i = usize::try_from(idx).unwrap_or(usize::MAX);
                        if i >= self.content.items.len() {
                            return -1;
                        }
                        LootPayload::Gear(Item {
                            base_idx: i as u32,
                            rarity: Rarity::Normal,
                            item_level: 1,
                            affixes: Vec::new(),
                            name: self.content.items[i].name.clone(),
                            charges: self.content.items[i].flask_charges,
                        })
                    }
                    // A level-1 gem.
                    1 => {
                        let i = usize::try_from(idx).unwrap_or(usize::MAX);
                        if i >= self.content.gems.len() {
                            return -1;
                        }
                        LootPayload::Gem(GemInstance {
                            gem_idx: i as u32,
                            level: 1,
                            xp: 0,
                        })
                    }
                    // An obol.
                    2 => {
                        let i = usize::try_from(idx).unwrap_or(usize::MAX);
                        if i >= self.content.currency.len() {
                            return -1;
                        }
                        LootPayload::Currency(i as u32)
                    }
                    // A rolled RARE at item level `idx` (boss chests).
                    3 => {
                        let ilvl = idx.clamp(1, 100) as u32;
                        match self.roll_item_forced(ilvl, Rarity::Rare) {
                            Some(item) => LootPayload::Gear(item),
                            None => return -1,
                        }
                    }
                    _ => return -1,
                };
                let (rarity, name) = self.payload_display(&payload);
                self.spawn_loot(pos, payload, owner);
                events.push(SimEvent::LootDropped {
                    owner_id: owner,
                    owner: String::new(),
                    rarity,
                    item: name,
                });
                0
            }
            SYS_SPAWN_MONSTER => {
                let def = bot.vm.pop();
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                let i = usize::try_from(def).unwrap_or(usize::MAX);
                if i >= self.content.monsters.len() {
                    return -1;
                }
                let pos = self
                    .zone
                    .clamp_pos(FxV2::new(Fx::from_raw(x), Fx::from_raw(y)));
                // Scripted spawns belong to no pack (sentinel): they never
                // respawn and don't disturb pack bookkeeping.
                self.spawn_monster(i as u32, u32::MAX, pos);
                0
            }
            SYS_SPAWN_ELITE => {
                // Scripted elite: spawn_elite(def, x, y, rarity) — the
                // tutorial's guaranteed magic/rare encounters.
                let def = bot.vm.pop();
                let x = bot.vm.pop();
                let y = bot.vm.pop();
                let r = bot.vm.pop();
                let i = usize::try_from(def).unwrap_or(usize::MAX);
                if i >= self.content.monsters.len() {
                    return -1;
                }
                let rarity = match r {
                    1 => crate::entity::Rarity::Magic,
                    2 => crate::entity::Rarity::Rare,
                    _ => crate::entity::Rarity::Normal,
                };
                let pos = self
                    .zone
                    .clamp_pos(FxV2::new(Fx::from_raw(x), Fx::from_raw(y)));
                self.spawn_monster_with(i as u32, u32::MAX, pos, rarity);
                0
            }
            SYS_SET_GATE => {
                // Lift or shut a tutorial gate. Brains gate LESSONS, not
                // people: the barrier blocks ground, never teleports.
                let idx = bot.vm.pop();
                let open = bot.vm.pop() != 0;
                let Some(gate) = usize::try_from(idx)
                    .ok()
                    .and_then(|i| self.zone.gates.get_mut(i))
                else {
                    return -1;
                };
                if gate.open != open {
                    gate.open = open;
                    events.push(SimEvent::GateChanged {
                        x0: gate.x0,
                        y0: gate.y0,
                        x1: gate.x1,
                        y1: gate.y1,
                        open,
                    });
                }
                0
            }
            SYS_SET_EXIT => {
                // Gate an exit open or closed. The brain only ever gates;
                // characters take exits THEMSELVES (UseExit) — there is no
                // forced transfer.
                let idx = bot.vm.pop();
                let open = bot.vm.pop() != 0;
                let Some(exit) = usize::try_from(idx)
                    .ok()
                    .and_then(|i| self.zone.exits.get_mut(i))
                else {
                    return -1;
                };
                if exit.open != open {
                    exit.open = open;
                    events.push(SimEvent::ExitChanged {
                        x: exit.pos.x.raw(),
                        y: exit.pos.y.raw(),
                        open,
                    });
                }
                0
            }
            _ => -1,
        }
    }
}
