//! The bag grid (MxN footprints, first-fit), bot-requested item moves and
//! drops, host-computed gear optimization (EquipBest), and ground pickups.

use super::{PICKUP_RANGE, SimEvent, World};
use crate::entity::{
    BAG_H, BAG_W, BagItem, CharacterState, GEAR_SLOTS, Item, LootPayload, PlacedItem,
};
use crate::stats::{Stat, StatSheet};
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

    /// Could every footprint in `displaced` (in placement order) find a home in
    /// the bag once the item at `exclude_idx` (the incoming replacement) leaves
    /// it? Mirrors the greedy first-fit the swap itself uses, so a deliberate
    /// `equip` can REFUSE rather than silently drop a piece it can't re-home.
    fn can_rehome_after_swap(
        &self,
        ch: &CharacterState,
        exclude_idx: usize,
        displaced: &[(u8, u8)],
    ) -> bool {
        let mut occupied = [[false; BAG_W as usize]; BAG_H as usize];
        for (i, placed) in ch.inventory.iter().enumerate() {
            if i == exclude_idx {
                continue; // the replacement is leaving the bag
            }
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
        for &(w, h) in displaced {
            if w == 0 || h == 0 || w > BAG_W || h > BAG_H {
                return false;
            }
            let mut placed_one = false;
            'find: for y in 0..=(BAG_H - h) {
                'spot: for x in 0..=(BAG_W - w) {
                    for dy in 0..h {
                        for dx in 0..w {
                            if occupied[(y + dy) as usize][(x + dx) as usize] {
                                continue 'spot;
                            }
                        }
                    }
                    for dy in 0..h {
                        for dx in 0..w {
                            occupied[(y + dy) as usize][(x + dx) as usize] = true;
                        }
                    }
                    placed_one = true;
                    break 'find;
                }
            }
            if !placed_one {
                return false;
            }
        }
        true
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
        // Bots supply x/y across the full u8 range, so `x + w` in u8 would overflow
        // (panic in debug, silently WRAP in release — a determinism hazard). Widen the
        // bounds check to u16; the boundary logic is otherwise unchanged.
        if x as u16 + w as u16 > BAG_W as u16 || y as u16 + h as u16 > BAG_H as u16 {
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
                for g in a.grants(&ra.values) {
                    sheet.apply(&g);
                }
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
        if e.character.is_none() {
            return -1;
        }

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
                self.shed_offhand_for_two_hander(slot, events);
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
                // The item fits this index iff it's one of its slot family's
                // loops (flasks and rings own two each; others a single index).
                let fits = islot.loops().contains(&gear_idx);
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
            self.swap_bag_into_slot(slot, inv_idx, gear_idx, events);
            changes += 1;
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

    /// Move the bag item at `inv_idx` into equipment `gear_idx`: the candidate
    /// leaves the grid, the displaced piece gets a first-fit spot (likely the
    /// freed cells) or drops at our feet, and ItemEquipped fires. The caller
    /// guarantees `inv_idx` is gear that fits `gear_idx`. Shared by
    /// `equip_best` (auto) and `equip` (manual) so the swap logic lives once.
    fn swap_bag_into_slot(
        &mut self,
        slot: usize,
        inv_idx: usize,
        gear_idx: usize,
        events: &mut Vec<SimEvent>,
    ) {
        let Some(e) = self.zone.get(slot) else { return };
        let Some(ch) = &e.character else { return };
        let (net_id, owner) = (e.net_id, ch.name.clone());
        let Some(gear) = ch.inventory.get(inv_idx).and_then(|p| p.item.as_gear()) else {
            return;
        };
        let item_name = self.item_display(gear);
        let me = self.zone.get_mut(slot).unwrap();
        let ch_mut = me.character.as_mut().unwrap();
        let placed = ch_mut.inventory.remove(inv_idx);
        let BagItem::Gear(new_item) = placed.item else {
            return; // unreachable: caller filtered to gear
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
        events.push(SimEvent::ItemEquipped {
            id: net_id,
            owner,
            rarity: item_rarity,
            item: item_name,
        });
    }

    /// A two-handed weapon claims the offhand: if one is wielded, shed any
    /// offhand piece (back to the grid / ground) with a GearShed event. Shared
    /// by `equip_best` and `equip`.
    fn shed_offhand_for_two_hander(&mut self, slot: usize, events: &mut Vec<SimEvent>) {
        let Some(e) = self.zone.get(slot) else { return };
        let Some(ch) = &e.character else { return };
        let wields_2h = ch.equipment[GearSlot::Weapon.idx()]
            .as_ref()
            .is_some_and(|w| self.content.items[w.base_idx as usize].two_handed);
        if !wields_2h {
            return;
        }
        let (net_id, owner) = (e.net_id, ch.name.clone());
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
                owner,
                item,
            });
            self.refresh_derived_stats(slot);
        }
    }

    /// Manual equip (#54 PR3): wear the bag item at `inv_idx` in its content-
    /// defined slot — the optimization path a bot drives itself, vs the
    /// `equip_best` shortcut. Returns 0 on success; -1 if the slot isn't gear,
    /// the item doesn't fit any slot, requirements aren't met, or it's an
    /// offhand while a two-hander is wielded. The displaced piece returns to the
    /// bag (first-fit, into the cells the replacement vacates); if it can't
    /// re-home there the swap is REFUSED (-1) rather than dropped — a deliberate
    /// swap never loses gear (unlike `equip_best`, which drops to juggle). A
    /// two-hander also sheds the offhand, which must fit too.
    pub(crate) fn equip(&mut self, slot: usize, inv_idx: i32, events: &mut Vec<SimEvent>) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let Ok(inv_idx) = usize::try_from(inv_idx) else {
            return -1;
        };
        let Some(gear) = ch.inventory.get(inv_idx).and_then(|p| p.item.as_gear()) else {
            return -1; // out of range, or the bag slot is a gem
        };
        let islot = self.content.items[gear.base_idx as usize].slot;
        // Land on the first FREE loop of the item's slot family (flasks and
        // rings own two), else its primary — single-slot families collapse to
        // idx(), and equip swaps whatever's worn there.
        let loops = islot.loops();
        let gear_idx = loops
            .iter()
            .copied()
            .find(|&i| ch.equipment[i].is_none())
            .unwrap_or(loops[0]);
        // Can't keep it equipped → refuse, rather than thrash it on and off.
        if !self.meets_requirements(slot, gear, Some(gear_idx)) {
            return -1;
        }
        let two_handed = self.content.items[gear.base_idx as usize].two_handed;
        // An offhand can't go on while a two-hander holds that slot: the bot
        // must swap the weapon first. (A two-hander itself sheds the offhand.)
        if gear_idx == GearSlot::Offhand.idx()
            && ch.equipment[GearSlot::Weapon.idx()]
                .as_ref()
                .is_some_and(|w| self.content.items[w.base_idx as usize].two_handed)
        {
            return -1;
        }
        // A deliberate swap never DROPS gear (like unequip): every piece we'd
        // displace — the slot's current item, plus the offhand a two-hander
        // sheds — must fit the bag once the replacement leaves it. Refuse if
        // not, so the bot frees space itself. (`equip_best` keeps drop-to-juggle:
        // an auto upgrade on a full bag still happens, shedding the worse piece.)
        let mut displaced: Vec<(u8, u8)> = Vec::new();
        if let Some(worn) = ch.equipment[gear_idx].as_ref() {
            let d = &self.content.items[worn.base_idx as usize];
            displaced.push((d.w, d.h));
        }
        if two_handed
            && gear_idx == GearSlot::Weapon.idx()
            && let Some(off) = ch.equipment[GearSlot::Offhand.idx()].as_ref()
        {
            let d = &self.content.items[off.base_idx as usize];
            displaced.push((d.w, d.h));
        }
        if !self.can_rehome_after_swap(ch, inv_idx, &displaced) {
            return -1;
        }
        self.swap_bag_into_slot(slot, inv_idx, gear_idx, events);
        if gear_idx == GearSlot::Weapon.idx() && two_handed {
            self.shed_offhand_for_two_hander(slot, events);
        }
        self.refresh_derived_stats(slot);
        // A swap can invalidate another piece's requirements — self-heal.
        self.enforce_gear_requirements(slot, events);
        0
    }

    /// Manual unequip (#54 PR3): bare gear slot `gear_sel`, moving the worn item
    /// back to the bag — the deliberate counterpart to `equip`'s swap. Returns 0;
    /// −1 if the slot index is invalid, already empty, or the BAG IS FULL. Like
    /// manual `equip` (and unlike the `equip_best` auto-swap, which drops to
    /// juggle), this REFUSES rather than ever dropping the item.
    pub(crate) fn unequip(
        &mut self,
        slot: usize,
        gear_sel: i32,
        events: &mut Vec<SimEvent>,
    ) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let Ok(gear_idx) = usize::try_from(gear_sel) else {
            return -1;
        };
        if gear_idx >= GEAR_SLOTS {
            return -1;
        }
        let Some(worn) = ch.equipment[gear_idx].as_ref() else {
            return -1; // nothing worn in that slot
        };
        let (net_id, owner) = (e.net_id, ch.name.clone());
        let (w, h) = {
            let def = &self.content.items[worn.base_idx as usize];
            (def.w, def.h)
        };
        // Find a home BEFORE removing — a deliberate unequip never drops: if the
        // bag can't hold it, refuse and leave it equipped.
        let Some((x, y)) = self.first_fit(ch, w, h) else {
            return -1;
        };
        let item = self.item_display(worn);
        let removed = self
            .zone
            .get_mut(slot)
            .and_then(|e| e.character.as_mut())
            .and_then(|c| c.equipment[gear_idx].take());
        if let Some(it) = removed {
            self.zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap()
                .inventory
                .push(PlacedItem {
                    item: BagItem::Gear(it),
                    x,
                    y,
                });
        }
        self.refresh_derived_stats(slot);
        // Baring a slot can drop attributes another piece leaned on — self-heal.
        self.enforce_gear_requirements(slot, events);
        events.push(SimEvent::GearShed {
            id: net_id,
            owner,
            item,
        });
        0
    }

    /// The worn gear as ReadEquipment records (#54 PR3): one `[slot, base_num,
    /// rarity, item_level]` per gear slot up to `max`, with `base_num == -1` for
    /// an empty slot. Definitional fields (slot→dims, affixes) stay in the docs /
    /// ReadItemMods (P1). Extracted from the syscall so the layout is testable.
    pub(crate) fn equipment_records(&self, slot: usize, max: usize) -> Vec<[i32; 4]> {
        let Some(ch) = self.zone.get(slot).and_then(|e| e.character.as_ref()) else {
            return Vec::new();
        };
        ch.equipment
            .iter()
            .take(max)
            .enumerate()
            .map(|(gear_idx, worn)| match worn {
                Some(it) => [
                    gear_idx as i32,
                    self.content_num(idlin_content::ids::Category::Item, it.base_idx as usize),
                    it.rarity as i32,
                    it.item_level as i32,
                ],
                None => [gear_idx as i32, -1, 0, 0],
            })
            .collect()
    }

    /// The gear slot a gear item num belongs to (#54 PR3 `item_slot` syscall):
    /// the GearSlot index, or -1 for a non-gear / unknown num. The deferred
    /// Def-lookup (RFC Q2) that manual gear scoring needs — base reads omit it.
    pub(crate) fn item_slot_of_num(&self, num: i32) -> i32 {
        match self.content_idx(num) {
            Some((idlin_content::ids::Category::Item, idx)) => {
                self.content.items[idx as usize].slot.idx() as i32
            }
            _ => -1,
        }
    }

    /// Deterministic single-item valuation for EquipBest: evaluate the item's
    /// own affixes over its own bases. Bots with opinions can do better.
    fn item_score(&self, item: &Item) -> i64 {
        let def = &self.content.items[item.base_idx as usize];
        let mut sheet = StatSheet::new();
        for ra in &item.affixes {
            let a = &self.content.affixes[ra.affix_idx as usize];
            for g in a.grants(&ra.values) {
                sheet.apply(&g);
            }
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
                + sheet.value(Stat::Mana, 0) * 50
                // Attributes feed real derived stats (STR→life/melee, DEX→acc/eva,
                // INT→mana/ES), so accessory jewelry's signature rolls must count —
                // else EquipBest can't tell a +20-STR amulet from a bare slot.
                + (sheet.value(Stat::Strength, 0)
                    + sheet.value(Stat::Dexterity, 0)
                    + sheet.value(Stat::Intelligence, 0))
                    * 80
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
