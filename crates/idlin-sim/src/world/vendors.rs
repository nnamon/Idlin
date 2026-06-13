//! Town VENDORS: neutral NPCs that buy a character's trash for currency and
//! sell a small stock of basics. Accessed by PROXIMITY (like the stash) — a
//! bot walks into reach of a vendor and trades through the syscalls. A vendor
//! is just a non-hostile monster whose `MonsterDef.shop` names a `VendorDef`;
//! everything-is-a-bot, so the shopkeeper wanders and chats like any NPC.

use super::World;
use crate::entity::{BAG_H, BAG_W, Item, PlacedItem, Rarity};
use crate::fixed::Fx;

/// How close a bot must stand to a vendor to trade (2u — same deliberate
/// stop as the stash).
pub const VENDOR_REACH_RAW: i32 = 2 * 65536;

impl World {
    /// The nearest vendor within reach of the character at `slot`: returns
    /// (vendor entity slot, VendorDef index), or None. Deterministic: ties
    /// break by net id, like the entity queries.
    pub(crate) fn nearest_vendor(&self, slot: usize) -> Option<(usize, usize)> {
        let me = self.zone.get(slot)?;
        let pos = me.pos;
        let reach = Fx::from_raw(VENDOR_REACH_RAW);
        let mut best: Option<(i64, u32, usize, usize)> = None;
        for (s, e) in self.zone.iter() {
            if s == slot {
                continue;
            }
            let Some(m) = e.monster.as_ref() else {
                continue;
            };
            let Some(shop) = self.content.monsters[m.def_idx as usize].shop.as_deref() else {
                continue;
            };
            let Some(vidx) = self.content.vendor_idx(shop) else {
                continue;
            };
            if pos.dist(e.pos) > reach {
                continue;
            }
            let dx = (e.pos.x - pos.x).raw() as i64;
            let dy = (e.pos.y - pos.y).raw() as i64;
            let d2 = dx * dx + dy * dy;
            let key = (d2, e.net_id, s, vidx);
            if best.is_none_or(|b| (key.0, key.1) < (b.0, b.1)) {
                best = Some(key);
            }
        }
        best.map(|(_, _, s, vidx)| (s, vidx))
    }

    /// Vendor NPCs within query range of the character at `slot`, as
    /// ReadVendors records [net_id, x_raw, y_raw, vendor_def_idx], nearest
    /// first (ties by net id). Content access lives here (bots.rs only writes
    /// the records into VM memory).
    pub(crate) fn nearby_vendor_records(&self, slot: usize, max: usize) -> Vec<[i32; 4]> {
        let Some(me) = self.zone.get(slot) else {
            return Vec::new();
        };
        let pos = me.pos;
        let r = crate::bots::QUERY_RADIUS.raw() as i64;
        let radius_sq = r * r;
        let mut found: Vec<(i64, u32, [i32; 4])> = Vec::new();
        for (s, e) in self.zone.iter() {
            if s == slot {
                continue;
            }
            let Some(m) = e.monster.as_ref() else {
                continue;
            };
            let Some(shop) = self.content.monsters[m.def_idx as usize].shop.as_deref() else {
                continue;
            };
            let Some(vidx) = self.content.vendor_idx(shop) else {
                continue;
            };
            let dx = (e.pos.x - pos.x).raw() as i64;
            let dy = (e.pos.y - pos.y).raw() as i64;
            let d2 = dx * dx + dy * dy;
            if d2 > radius_sq {
                continue;
            }
            found.push((
                d2,
                e.net_id,
                [e.net_id as i32, e.pos.x.raw(), e.pos.y.raw(), vidx as i32],
            ));
        }
        found.sort_unstable_by_key(|&(d2, net, _)| (d2, net));
        found.into_iter().take(max).map(|(_, _, rec)| rec).collect()
    }

    /// Stock of the nearest in-range vendor as ReadShop records
    /// [item_base_idx, currency_idx, price, w, h]; None when no vendor is in
    /// range (the syscall reports -2).
    pub(crate) fn shop_records(&self, slot: usize, max: usize) -> Option<Vec<[i32; 5]>> {
        let (_, vidx) = self.nearest_vendor(slot)?;
        Some(
            self.content.vendors[vidx]
                .stock
                .iter()
                .take(max)
                .map(|s| {
                    let item_idx = self.content.item_idx(&s.item).unwrap_or(0);
                    let cur = self.content.currency_idx(&s.currency).unwrap_or(0);
                    let def = &self.content.items[item_idx];
                    [
                        item_idx as i32,
                        cur as i32,
                        s.price as i32,
                        def.w as i32,
                        def.h as i32,
                    ]
                })
                .collect(),
        )
    }

    /// The current zone's bounty board as ReadBounties records
    /// [target_monster_idx, count, reward_currency_idx, reward_count]. The
    /// human pitch is narration (a zone line), not part of this payload.
    pub(crate) fn bounty_records(&self, max: usize) -> Vec<[i32; 4]> {
        self.content.zones[self.zone_idx as usize]
            .bounties
            .iter()
            .take(max)
            .map(|b| {
                [
                    self.content.monster_idx(&b.target_monster).unwrap_or(0) as i32,
                    b.count as i32,
                    self.content.currency_idx(&b.reward_currency).unwrap_or(0) as i32,
                    b.reward_count as i32,
                ]
            })
            .collect()
    }

    /// Sell bag item `inv_idx` to the nearest in-range vendor for the
    /// vendor's payout currency (scaled by the item's rarity). Returns
    /// 0 ok; -1 bad index; -2 no vendor in range.
    pub(crate) fn vendor_sell(&mut self, slot: usize, inv_idx: usize) -> i32 {
        let Some((_, vidx)) = self.nearest_vendor(slot) else {
            return -2;
        };
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let Some(placed) = ch.inventory.get(inv_idx) else {
            return -1;
        };
        let rarity = placed.item.rarity as usize;
        let vendor = &self.content.vendors[vidx];
        let cur = self
            .content
            .currency_idx(&vendor.pays_currency)
            .expect("vendor currency validated at load");
        let amount = vendor.pays_amount[rarity.min(3)] as u64;
        let me = self.zone.get_mut(slot).unwrap();
        let ch = me.character.as_mut().unwrap();
        ch.inventory.remove(inv_idx);
        if ch.currency.len() <= cur {
            ch.currency.resize(cur + 1, 0);
        }
        ch.currency[cur] += amount;
        0
    }

    /// Buy stock line `stock_idx` from the nearest in-range vendor, paying
    /// its price in the listed currency. The bought base is a clean Normal
    /// item at the zone's level (flasks come full). Returns 0 ok; -1 bad
    /// index; -2 no vendor in range; -3 bag full; -4 can't afford.
    pub(crate) fn vendor_buy(&mut self, slot: usize, stock_idx: usize) -> i32 {
        let Some((_, vidx)) = self.nearest_vendor(slot) else {
            return -2;
        };
        let vendor = &self.content.vendors[vidx];
        let Some(line) = vendor.stock.get(stock_idx) else {
            return -1;
        };
        let item_idx = self
            .content
            .item_idx(&line.item)
            .expect("vendor stock item validated at load");
        let cur = self
            .content
            .currency_idx(&line.currency)
            .expect("vendor stock currency validated at load");
        let price = line.price as u64;
        let def = &self.content.items[item_idx];
        let (w, h, charges) = (def.w, def.h, def.flask_charges);
        let ilvl = self.zone_level.max(1);

        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        if ch.currency.get(cur).copied().unwrap_or(0) < price {
            return -4;
        }
        let Some((x, y)) = self.fit_in_grid(&ch.inventory, w, h, BAG_W, BAG_H) else {
            return -3;
        };
        let me = self.zone.get_mut(slot).unwrap();
        let ch = me.character.as_mut().unwrap();
        ch.currency[cur] -= price;
        ch.inventory.push(PlacedItem {
            item: Item {
                base_idx: item_idx as u32,
                rarity: Rarity::Normal,
                item_level: ilvl,
                affixes: Vec::new(),
                name: String::new(),
                charges,
            },
            x,
            y,
        });
        0
    }
}

#[cfg(test)]
mod tests {
    use crate::entity::{Item, PlacedItem, Rarity};
    use crate::{JoinRequest, TickInputs, World};
    use idlin_content::ContentDb;
    use std::path::Path;

    fn content() -> ContentDb {
        ContentDb::load(Path::new("../../content")).expect("workspace content must load")
    }

    /// A saltmere world with one inert character; vendors spawn from the
    /// zone packs (smith at 26,40 / quartermaster at 34,40). Returns the
    /// world, the character slot, and the smith's net id.
    fn world_with_vendors() -> (World, usize) {
        let content = content();
        let mut world = World::new_for_zone(0x5A17, &content, "saltmere");
        let halt = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&TickInputs {
            arrivals: Vec::new(),
            joins: vec![JoinRequest {
                name: "Shopper".into(),
                program: halt,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character joined");
        (world, slot)
    }

    fn currency_idx(world: &World, id: &str) -> usize {
        world.content.currency_idx(id).expect(id)
    }

    fn give_normal_item(world: &mut World, slot: usize, n: usize) {
        let base = world
            .content
            .items
            .iter()
            .position(|i| i.w == 1 && i.h == 1)
            .unwrap_or(0) as u32;
        let ch = world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap();
        for _ in 0..n {
            ch.inventory.push(PlacedItem {
                item: Item {
                    base_idx: base,
                    rarity: Rarity::Normal,
                    item_level: 1,
                    affixes: Vec::new(),
                    name: String::new(),
                    charges: 0,
                },
                x: 0,
                y: 0,
            });
        }
    }

    fn at_smith(world: &mut World, slot: usize) {
        let net = world.zone.get(slot).unwrap().net_id;
        world.test_teleport(net, 26, 40); // onto the smith
    }

    #[test]
    fn vendors_spawn_and_are_discoverable() {
        let (mut world, slot) = world_with_vendors();
        // Stand central so both vendors are within query range.
        let net = world.zone.get(slot).unwrap().net_id;
        world.test_teleport(net, 30, 40);
        let recs = world.nearby_vendor_records(slot, 16);
        assert_eq!(recs.len(), 2, "both shopkeepers visible");
        // Records are [net, x, y, vendor_def_idx]; nearest first.
        assert!(recs.iter().all(|r| r[0] != 0));
    }

    #[test]
    fn sell_pays_currency_by_rarity() {
        let (mut world, slot) = world_with_vendors();
        at_smith(&mut world, slot);
        give_normal_item(&mut world, slot, 1);
        let tcur = currency_idx(&world, "transmute_obol");
        assert_eq!(world.vendor_sell(slot, 0), 0, "sold");
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert!(ch.inventory.is_empty(), "bag item gone");
        // Smith pays 1 transmute for a Normal item (pays_amount[0]).
        assert_eq!(ch.currency.get(tcur).copied().unwrap_or(0), 1);
    }

    #[test]
    fn buy_deducts_currency_and_adds_item() {
        let (mut world, slot) = world_with_vendors();
        at_smith(&mut world, slot);
        let tcur = currency_idx(&world, "transmute_obol");
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            if ch.currency.len() <= tcur {
                ch.currency.resize(tcur + 1, 0);
            }
            ch.currency[tcur] = 5;
        }
        assert_eq!(world.vendor_buy(slot, 0), 0, "bought the cleaver");
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.currency[tcur], 4, "paid 1 obol");
        assert_eq!(ch.inventory.len(), 1, "cleaver in the bag");
    }

    #[test]
    fn buy_broke_is_minus_four() {
        let (mut world, slot) = world_with_vendors();
        at_smith(&mut world, slot);
        assert_eq!(world.vendor_buy(slot, 0), -4, "no obols");
    }

    #[test]
    fn trade_gated_by_range() {
        let (mut world, slot) = world_with_vendors();
        let net = world.zone.get(slot).unwrap().net_id;
        world.test_teleport(net, 5, 5); // far from any vendor
        give_normal_item(&mut world, slot, 1);
        assert_eq!(world.vendor_sell(slot, 0), -2, "no vendor in range");
        assert_eq!(world.vendor_buy(slot, 0), -2);
        assert!(world.shop_records(slot, 16).is_none());
    }

    #[test]
    fn shop_and_bounty_readouts() {
        let (mut world, slot) = world_with_vendors();
        at_smith(&mut world, slot);
        let stock = world.shop_records(slot, 16).expect("in range");
        assert_eq!(stock.len(), 1, "smith sells one weapon");
        // [item_base_idx, currency_idx, price, w, h]; price is 1.
        assert_eq!(stock[0][2], 1);
        let bounties = world.bounty_records(16);
        assert_eq!(bounties.len(), 1, "the warden bounty");
        let mon = world.content.monster_idx("tidewarden").unwrap() as i32;
        assert_eq!(bounties[0][0], mon, "targets the tidewarden");
    }

    /// END-TO-END: a bot PROGRAM (not a direct Rust call) compiles the
    /// `vendor_sell` builtin and the sale happens through the VM syscall
    /// path. Guards against the language and the sim drifting apart — the
    /// builtins must be registered in idlin-botc's BUILTINS table, or this
    /// fails to compile.
    #[test]
    fn a_bot_program_can_trade_through_the_syscalls() {
        let content = content();
        let program = idlin_botc::compile("fn main() { vendor_sell(0); }")
            .expect("vendor builtins must be registered in the language");
        let mut world = World::new_for_zone(0x00BA_2A11, &content, "saltmere");
        world.tick(&TickInputs {
            joins: vec![JoinRequest {
                name: "Trader".into(),
                program,
            }],
            arrivals: Vec::new(),
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character joined");
        at_smith(&mut world, slot);
        give_normal_item(&mut world, slot, 1);
        let tcur = currency_idx(&world, "transmute_obol");
        // One tick: the bot runs `vendor_sell(0)` while standing on the smith.
        world.tick(&TickInputs::default());
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert!(
            ch.inventory.is_empty(),
            "the program sold the item via the VM"
        );
        assert_eq!(
            ch.currency.get(tcur).copied().unwrap_or(0),
            1,
            "paid in obols"
        );
    }

    #[test]
    fn nearest_vendor_picks_the_closer() {
        let (mut world, slot) = world_with_vendors();
        let net = world.zone.get(slot).unwrap().net_id;
        // Sit one cell off the smith (26,40); quartermaster is at 34,40.
        world.test_teleport(net, 27, 40);
        let (_, vidx) = world.nearest_vendor(slot).expect("smith in range");
        assert_eq!(world.content.vendors[vidx].id, "smith");
    }
}
