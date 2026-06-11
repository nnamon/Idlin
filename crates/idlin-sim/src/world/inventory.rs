//! The bag grid (MxN footprints, first-fit), bot-requested item moves and
//! drops, host-computed gear optimization (EquipBest), and ground pickups.

use super::{PICKUP_RANGE, SimEvent, World};
use crate::entity::{
    BAG_H, BAG_W, CharacterState, GEAR_SLOTS, Item, LootPayload, POUCH_CAP, PlacedItem,
};
use crate::stats::{Grant, Stat, StatSheet};
use idlin_content::GearSlot;

impl World {
    /// First-fit placement scan (row-major). Returns (x, y) or None.
    fn first_fit(&self, ch: &CharacterState, w: u8, h: u8) -> Option<(u8, u8)> {
        if w == 0 || h == 0 || w > BAG_W || h > BAG_H {
            return None;
        }
        let mut occupied = [[false; BAG_W as usize]; BAG_H as usize];
        for placed in &ch.inventory {
            let def = &self.content.items[placed.item.base_idx as usize];
            for dy in 0..def.h {
                for dx in 0..def.w {
                    let (px, py) = ((placed.x + dx) as usize, (placed.y + dy) as usize);
                    if py < BAG_H as usize && px < BAG_W as usize {
                        occupied[py][px] = true;
                    }
                }
            }
        }
        for y in 0..=(BAG_H - h) {
            'spot: for x in 0..=(BAG_W - w) {
                for dy in 0..h {
                    for dx in 0..w {
                        if occupied[(y + dy) as usize][(x + dx) as usize] {
                            continue 'spot;
                        }
                    }
                }
                return Some((x, y));
            }
        }
        None
    }

    /// Bot-requested item move within the bag. Returns 0 or -1.
    pub(crate) fn move_item(&mut self, slot: usize, inv_idx: usize, x: u8, y: u8) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let Some(placed) = ch.inventory.get(inv_idx) else {
            return -1;
        };
        let def = &self.content.items[placed.item.base_idx as usize];
        if x + def.w > BAG_W || y + def.h > BAG_H {
            return -1;
        }
        // Overlap check against everything but the moving item.
        for (i, other) in ch.inventory.iter().enumerate() {
            if i == inv_idx {
                continue;
            }
            let odef = &self.content.items[other.item.base_idx as usize];
            let overlap_x = x < other.x + odef.w && other.x < x + def.w;
            let overlap_y = y < other.y + odef.h && other.y < y + def.h;
            if overlap_x && overlap_y {
                return -1;
            }
        }
        if let Some(me) = self.zone.get_mut(slot) {
            let ch = me.character.as_mut().unwrap();
            ch.inventory[inv_idx].x = x;
            ch.inventory[inv_idx].y = y;
        }
        0
    }

    /// Bot-requested drop: the item returns to the ground as personal loot.
    pub(crate) fn drop_item(&mut self, slot: usize, inv_idx: usize) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        if inv_idx >= ch.inventory.len() {
            return -1;
        }
        let (pos, owner) = (e.pos, e.net_id);
        let item = {
            let me = self.zone.get_mut(slot).unwrap();
            me.character
                .as_mut()
                .unwrap()
                .inventory
                .remove(inv_idx)
                .item
        };
        self.spawn_loot(pos, LootPayload::Gear(item), owner);
        0
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

        let mut changes = 0;
        for gear_idx in 0..GEAR_SLOTS {
            let Some(e) = self.zone.get(slot) else { break };
            let ch = e.character.as_ref().unwrap();
            let current_score = ch.equipment[gear_idx]
                .as_ref()
                .map(|i| self.item_score(i))
                .unwrap_or(-1);
            let mut best: Option<(usize, i64)> = None;
            for (inv_idx, placed) in ch.inventory.iter().enumerate() {
                if self.content.items[placed.item.base_idx as usize].slot.idx() != gear_idx {
                    continue;
                }
                let s = self.item_score(&placed.item);
                if s > current_score && best.is_none_or(|(_, bs)| s > bs) {
                    best = Some((inv_idx, s));
                }
            }
            let Some((inv_idx, _)) = best else { continue };

            // Swap: candidate leaves the grid, then the old piece gets a
            // first-fit spot (likely the freed cells) or drops at our feet.
            let me = self.zone.get_mut(slot).unwrap();
            let ch_mut = me.character.as_mut().unwrap();
            let placed = ch_mut.inventory.remove(inv_idx);
            let new_item = placed.item;
            let item_name = self.content.items[new_item.base_idx as usize].name.clone();
            let item_rarity = new_item.rarity;
            let old = ch_mut.equipment[gear_idx].replace(new_item);
            if let Some(old_item) = old {
                let (w, h) = {
                    let def = &self.content.items[old_item.base_idx as usize];
                    (def.w, def.h)
                };
                let spot = {
                    let e = self.zone.get(slot).unwrap();
                    self.first_fit(e.character.as_ref().unwrap(), w, h)
                };
                match spot {
                    Some((x, y)) => {
                        let me = self.zone.get_mut(slot).unwrap();
                        me.character.as_mut().unwrap().inventory.push(PlacedItem {
                            item: old_item,
                            x,
                            y,
                        });
                    }
                    None => {
                        let (pos, owner_net) = {
                            let e = self.zone.get(slot).unwrap();
                            (e.pos, e.net_id)
                        };
                        self.spawn_loot(pos, LootPayload::Gear(old_item), owner_net);
                    }
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

    /// Deterministic single-item valuation for EquipBest: evaluate the item's
    /// own affixes over its own bases. Bots with opinions can do better.
    fn item_score(&self, item: &Item) -> i64 {
        let def = &self.content.items[item.base_idx as usize];
        let mut sheet = StatSheet::new();
        for ra in &item.affixes {
            let a = &self.content.affixes[ra.affix_idx as usize];
            sheet.apply(&Grant {
                stat: a.stat,
                layer: a.layer,
                value: ra.value,
            });
        }
        if def.slot == GearSlot::Weapon {
            let dmg = sheet.value(Stat::DamagePhys, def.damage_phys)
                + sheet.value(Stat::DamageFire, def.damage_fire)
                + sheet.value(Stat::DamageCold, def.damage_cold)
                + sheet.value(Stat::DamageLightning, def.damage_lightning)
                + sheet.value(Stat::DamageChaos, def.damage_chaos);
            let speed_bonus = sheet.value(Stat::AttackSpeed, 10000) - 10000;
            dmg * 100 + speed_bonus
        } else {
            sheet.value(Stat::Armour, def.armour) * 100
                + sheet.value(Stat::Block, def.block_bp) / 3
                + sheet.value(Stat::Evasion, def.evasion) * 100
                + sheet.value(Stat::Life, 0) * 200
                + sheet.value(Stat::ResistFire, 0) / 10
                + sheet.value(Stat::ResistCold, 0) / 10
                + sheet.value(Stat::ResistLightning, 0) / 10
                + sheet.value(Stat::ResistChaos, 0) / 10
                + (sheet.value(Stat::MoveSpeed, 10000) - 10000)
        }
    }

    pub(super) fn pickups(&mut self, events: &mut Vec<SimEvent>) {
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
            let (rarity, name) = self.payload_display(&loot.payload);
            match &loot.payload {
                LootPayload::Gear(item) => {
                    // The grid must have room (bots juggle space; that's the game).
                    let def = &self.content.items[item.base_idx as usize];
                    let Some((x, y)) = self.first_fit(ch, def.w, def.h) else {
                        continue;
                    };
                    let item = item.clone();
                    self.zone.remove(loot_slot);
                    if let Some(me) = self.zone.get_mut(slot) {
                        let ch = me.character.as_mut().unwrap();
                        ch.items += 1;
                        ch.inventory.push(PlacedItem { item, x, y });
                    }
                }
                LootPayload::Gem(gem) => {
                    if ch.pouch.len() >= POUCH_CAP {
                        continue;
                    }
                    let gem = gem.clone();
                    self.zone.remove(loot_slot);
                    if let Some(me) = self.zone.get_mut(slot) {
                        let ch = me.character.as_mut().unwrap();
                        ch.items += 1;
                        ch.pouch.push(gem);
                    }
                }
            }
            events.push(SimEvent::ItemPickedUp {
                owner_id: my_net,
                owner: my_name,
                rarity,
                item: name,
            });
        }
    }
}
