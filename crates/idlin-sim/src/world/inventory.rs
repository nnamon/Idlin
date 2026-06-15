//! The bag grid (MxN footprints, first-fit), bot-requested item moves and
//! drops, host-computed gear optimization (EquipBest), and ground pickups.

use super::{PICKUP_RANGE, SimEvent, World};
use crate::entity::{
    BAG_H, BAG_W, BagItem, CharacterState, GEAR_SLOTS, Item, LootPayload, PlacedItem,
};
use crate::stats::{Grant, Stat, StatSheet};
use idlin_content::GearSlot;

impl World {
    /// First-fit placement scan (row-major). Returns (x, y) or None.
    pub(crate) fn first_fit(&self, ch: &CharacterState, w: u8, h: u8) -> Option<(u8, u8)> {
        if w == 0 || h == 0 || w > BAG_W || h > BAG_H {
            return None;
        }
        let mut occupied = [[false; BAG_W as usize]; BAG_H as usize];
        for placed in &ch.inventory {
            let (pw, ph) = placed.item.footprint(&self.content);
            for dy in 0..ph {
                for dx in 0..pw {
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

    /// Put a shed gear item back in the bag (first-fit) or drop it at the
    /// character's feet when the grid is full.
    fn stash_or_drop_gear(&mut self, slot: usize, item: Item) {
        let spot = {
            let Some(e) = self.zone.get(slot) else { return };
            let Some(ch) = e.character.as_ref() else {
                return;
            };
            let (w, h) = {
                let d = &self.content.items[item.base_idx as usize];
                (d.w, d.h)
            };
            self.first_fit(ch, w, h)
        };
        match spot {
            Some((x, y)) => {
                if let Some(me) = self.zone.get_mut(slot) {
                    me.character.as_mut().unwrap().inventory.push(PlacedItem {
                        item: BagItem::Gear(item),
                        x,
                        y,
                    });
                }
            }
            None => {
                let Some(e) = self.zone.get(slot) else { return };
                let (pos, net) = (e.pos, e.net_id);
                self.spawn_loot(pos, LootPayload::Gear(item), net);
            }
        }
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
        let (w, h) = placed.item.footprint(&self.content);
        if x + w > BAG_W || y + h > BAG_H {
            return -1;
        }
        // Overlap check against everything but the moving item.
        for (i, other) in ch.inventory.iter().enumerate() {
            if i == inv_idx {
                continue;
            }
            let (ow, oh) = other.item.footprint(&self.content);
            let overlap_x = x < other.x + ow && other.x < x + w;
            let overlap_y = y < other.y + oh && other.y < y + h;
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
        let dropped = {
            let me = self.zone.get_mut(slot).unwrap();
            me.character
                .as_mut()
                .unwrap()
                .inventory
                .remove(inv_idx)
                .item
        };
        // Gear and gems both drop back to the ground as their own loot kind.
        let payload = match dropped {
            BagItem::Gear(it) => LootPayload::Gear(it),
            BagItem::Gem(g) => LootPayload::Gem(g),
        };
        self.spawn_loot(pos, payload, owner);
        0
    }

    /// Host-computed gear optimization (the EquipBest syscall): for each gear
    /// slot, equip the highest-scoring item between what's worn and what's in
    /// the bag. Returns the number of swaps; emits ItemEquipped events.
    /// Attribute totals (str, dex, int) for requirement checks: tree
    /// nodes + active buffs + equipped gear affixes — optionally
    /// excluding one gear slot, because an item's own affixes never
    /// satisfy its own requirements.
    pub(crate) fn attribute_totals(
        &self,
        slot: usize,
        exclude_gear: Option<usize>,
    ) -> (i64, i64, i64) {
        use crate::stats::{Stat, StatSheet};
        let Some(e) = self.zone.get(slot) else {
            return (0, 0, 0);
        };
        let Some(ch) = &e.character else {
            return (0, 0, 0);
        };
        let mut sheet = StatSheet::new();
        for &node_idx in &ch.allocated {
            if let Some(node) = self.content.tree.get(node_idx as usize) {
                for g in &node.grants {
                    sheet.apply(g);
                }
            }
        }
        for ef in &e.effects {
            if let crate::entity::ActiveEffect::Buff { grants, .. } = ef {
                for g in grants {
                    sheet.apply(g);
                }
            }
        }
        for (i, slot_item) in ch.equipment.iter().enumerate() {
            if Some(i) == exclude_gear {
                continue;
            }
            let Some(item) = slot_item else { continue };
            for ra in &item.affixes {
                let a = &self.content.affixes[ra.affix_idx as usize];
                sheet.apply(&crate::stats::Grant {
                    stat: a.stat,
                    layer: a.layer,
                    value: ra.value,
                });
            }
        }
        (
            sheet.value(Stat::Strength, 0),
            sheet.value(Stat::Dexterity, 0),
            sheet.value(Stat::Intelligence, 0),
        )
    }

    /// An item's LEVEL requirement: the base's floor, or the highest
    /// rolled affix tier's ilvl — power demands the level that earns it.
    pub(crate) fn item_level_requirement(&self, item: &Item) -> u32 {
        let def = &self.content.items[item.base_idx as usize];
        let mut req = def.req_level;
        for ra in &item.affixes {
            let a = &self.content.affixes[ra.affix_idx as usize];
            if let Some(t) = a.tiers.get(ra.tier as usize) {
                req = req.max(t.ilvl);
            }
        }
        req
    }

    /// Does this character MEET an item's requirements right now?
    /// `exclude_gear` names the equipment slot the item would occupy (or
    /// occupies) so its own grants don't count toward itself.
    pub(crate) fn meets_requirements(
        &self,
        slot: usize,
        item: &Item,
        exclude_gear: Option<usize>,
    ) -> bool {
        let def = &self.content.items[item.base_idx as usize];
        let req_level = self.item_level_requirement(item);
        if req_level == 0 && def.req_str == 0 && def.req_dex == 0 && def.req_int == 0 {
            return true; // the common case costs nothing
        }
        let level = self
            .zone
            .get(slot)
            .and_then(|e| e.character.as_ref())
            .map(|ch| ch.level)
            .unwrap_or(0);
        if level < req_level {
            return false;
        }
        if def.req_str == 0 && def.req_dex == 0 && def.req_int == 0 {
            return true;
        }
        let (st, dx, iq) = self.attribute_totals(slot, exclude_gear);
        st >= def.req_str && dx >= def.req_dex && iq >= def.req_int
    }

    /// Re-validate every equipped item against its requirements and SHED
    /// what no longer qualifies (to the bag, or the ground when full).
    /// Runs to a fixed point in slot order — shedding one attribute-
    /// granting piece can invalidate the next. Call on every event that
    /// can lower attributes: tree respec, gear changes, buff expiry.
    pub(crate) fn enforce_gear_requirements(&mut self, slot: usize, events: &mut Vec<SimEvent>) {
        for _ in 0..=GEAR_SLOTS {
            let Some(e) = self.zone.get(slot) else { return };
            let Some(ch) = &e.character else { return };
            let (net_id, owner) = (e.net_id, ch.name.clone());
            let mut shed: Option<usize> = None;
            for (i, slot_item) in ch.equipment.iter().enumerate() {
                let Some(item) = slot_item else { continue };
                if !self.meets_requirements(slot, item, Some(i)) {
                    shed = Some(i);
                    break;
                }
            }
            let Some(gear_idx) = shed else { return };
            let me = self.zone.get_mut(slot).unwrap();
            let ch_mut = me.character.as_mut().unwrap();
            let Some(item) = ch_mut.equipment[gear_idx].take() else {
                return;
            };
            let item_name = self.item_display(&item);
            let (w, h) = {
                let def = &self.content.items[item.base_idx as usize];
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
                        item: BagItem::Gear(item),
                        x,
                        y,
                    });
                }
                None => {
                    let (pos, owner_net) = {
                        let e = self.zone.get(slot).unwrap();
                        (e.pos, e.net_id)
                    };
                    self.spawn_loot(pos, LootPayload::Gear(item), owner_net);
                }
            }
            events.push(SimEvent::GearShed {
                id: net_id,
                owner,
                item: item_name,
            });
            self.refresh_derived_stats(slot);
        }
    }

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
            // A two-handed weapon claims the offhand: never fill that slot while
            // one is wielded, and shed any offhand already there (e.g. after a
            // 1H→2H weapon swap earlier in this same pass — weapon is slot 0,
            // offhand slot 1).
            if gear_idx == GearSlot::Offhand.idx()
                && ch.equipment[GearSlot::Weapon.idx()]
                    .as_ref()
                    .is_some_and(|w| self.content.items[w.base_idx as usize].two_handed)
            {
                let shed = self
                    .zone
                    .get_mut(slot)
                    .and_then(|e| e.character.as_mut())
                    .and_then(|c| c.equipment[GearSlot::Offhand.idx()].take());
                if let Some(off) = shed {
                    let item = self.item_display(&off);
                    self.stash_or_drop_gear(slot, off);
                    events.push(SimEvent::GearShed {
                        id: net_id,
                        owner: owner.clone(),
                        item,
                    });
                    self.refresh_derived_stats(slot);
                }
                continue;
            }
            let current_score = ch.equipment[gear_idx]
                .as_ref()
                .map(|i| self.item_score(i))
                .unwrap_or(-1);
            let mut best: Option<(usize, i64)> = None;
            for (inv_idx, placed) in ch.inventory.iter().enumerate() {
                // Gems share the grid now but are never equipment — skip them.
                let Some(gear) = placed.item.as_gear() else {
                    continue;
                };
                let islot = self.content.items[gear.base_idx as usize].slot;
                // Flask items fit EITHER belt loop; everything else maps 1:1.
                let fits = if GearSlot::FLASK_SLOTS.contains(&gear_idx) {
                    islot == GearSlot::Flask
                } else {
                    islot.idx() == gear_idx
                };
                if !fits {
                    continue;
                }
                // Requirements gate candidacy: an item we couldn't KEEP
                // equipped must not thrash on and off every tick.
                if !self.meets_requirements(slot, gear, Some(gear_idx)) {
                    continue;
                }
                let s = self.item_score(gear);
                if s > current_score && best.is_none_or(|(_, bs)| s > bs) {
                    best = Some((inv_idx, s));
                }
            }
            let Some((inv_idx, _)) = best else { continue };
            // Rolled display name, while the immutable borrow still holds.
            let item_name = self.item_display(
                ch.inventory[inv_idx]
                    .item
                    .as_gear()
                    .expect("equip candidate is gear"),
            );

            // Swap: candidate leaves the grid, then the old piece gets a
            // first-fit spot (likely the freed cells) or drops at our feet.
            let me = self.zone.get_mut(slot).unwrap();
            let ch_mut = me.character.as_mut().unwrap();
            let placed = ch_mut.inventory.remove(inv_idx);
            let BagItem::Gear(new_item) = placed.item else {
                continue; // unreachable: we filtered to gear
            };
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
                            item: BagItem::Gear(old_item),
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
        // A swap can REMOVE the attributes another piece leaned on —
        // shed whatever stopped qualifying (also the every-tick
        // self-heal for any invalidation path we didn't foresee).
        self.enforce_gear_requirements(slot, events);
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
        if def.slot == GearSlot::Flask {
            // Bigger heals win; charges are state, not quality.
            return def.flask_heal;
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
                        ch.inventory.push(PlacedItem {
                            item: BagItem::Gear(item),
                            x,
                            y,
                        });
                    }
                }
                LootPayload::Gem(gem) => {
                    // Gems are 1×1 grid items now (#54 PR2b) — they compete for
                    // bag space like gear; no room means no pickup.
                    let Some((x, y)) = self.first_fit(ch, 1, 1) else {
                        continue;
                    };
                    let gem = gem.clone();
                    self.zone.remove(loot_slot);
                    if let Some(me) = self.zone.get_mut(slot) {
                        let ch = me.character.as_mut().unwrap();
                        ch.items += 1;
                        ch.inventory.push(PlacedItem {
                            item: BagItem::Gem(gem),
                            x,
                            y,
                        });
                    }
                }
                LootPayload::Currency(idx) => {
                    let idx = *idx as usize;
                    self.zone.remove(loot_slot);
                    if let Some(me) = self.zone.get_mut(slot) {
                        let ch = me.character.as_mut().unwrap();
                        if ch.currency.len() <= idx {
                            ch.currency.resize(idx + 1, 0);
                        }
                        ch.currency[idx] += 1;
                        ch.items += 1;
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
