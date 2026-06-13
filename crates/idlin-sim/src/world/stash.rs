//! The town STASH: long-term per-character storage accessed at a PLACE
//! (like exits — walk into reach). Items move between the bag and a
//! larger stash grid; both use the one first-fit placement algorithm.
//! The stash lives on CharacterState, so it travels with the character
//! and persists in snapshots for free.

use super::World;
use crate::entity::{BAG_H, BAG_W, PlacedItem, STASH_H, STASH_W};
use crate::fixed::Fx;

/// How close a bot must stand to the stash place to use it (2 u — a
/// deliberate stop, slightly roomier than an exit's 1.5 u).
pub const STASH_REACH_RAW: i32 = 2 * 65536;

impl World {
    /// Is the character at `slot` within reach of this zone's stash? The
    /// single gate shared by the syscalls AND the sheet's `near_stash`.
    pub(crate) fn near_stash(&self, slot: usize) -> bool {
        let Some(stash) = self.zone.stash else {
            return false;
        };
        let Some(e) = self.zone.get(slot) else {
            return false;
        };
        e.pos.dist(stash) <= Fx::from_raw(STASH_REACH_RAW)
    }

    /// Deposit bag item `inv_idx` into the stash (first-fit). Returns
    /// 0 ok; -1 bad index; -2 out of range (no stash in reach); -3 stash
    /// full (no fit) — the same error vocabulary the rest of the API uses.
    pub(crate) fn stash_deposit(&mut self, slot: usize, inv_idx: usize) -> i32 {
        if !self.near_stash(slot) {
            return -2;
        }
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let Some(placed) = ch.inventory.get(inv_idx) else {
            return -1;
        };
        let (w, h) = {
            let def = &self.content.items[placed.item.base_idx as usize];
            (def.w, def.h)
        };
        let Some((x, y)) = self.fit_in_grid(&ch.stash, w, h, STASH_W, STASH_H) else {
            return -3; // stash full
        };
        let me = self.zone.get_mut(slot).unwrap();
        let ch = me.character.as_mut().unwrap();
        let item = ch.inventory.remove(inv_idx).item;
        ch.stash.push(PlacedItem { item, x, y });
        0
    }

    /// Withdraw stash item `stash_idx` into the bag (first-fit). Returns
    /// 0 ok; -1 bad index; -2 out of range; -3 bag full (no fit).
    pub(crate) fn stash_withdraw(&mut self, slot: usize, stash_idx: usize) -> i32 {
        if !self.near_stash(slot) {
            return -2;
        }
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let Some(placed) = ch.stash.get(stash_idx) else {
            return -1;
        };
        let (w, h) = {
            let def = &self.content.items[placed.item.base_idx as usize];
            (def.w, def.h)
        };
        let Some((x, y)) = self.fit_in_grid(&ch.inventory, w, h, BAG_W, BAG_H) else {
            return -3; // bag full
        };
        let me = self.zone.get_mut(slot).unwrap();
        let ch = me.character.as_mut().unwrap();
        let item = ch.stash.remove(stash_idx).item;
        ch.inventory.push(PlacedItem { item, x, y });
        0
    }
}

#[cfg(test)]
mod tests {
    use crate::entity::{Item, PlacedItem, Rarity, STASH_H, STASH_W};
    use crate::{JoinRequest, TickInputs, World};
    use idlin_content::ContentDb;
    use std::path::Path;

    fn content() -> ContentDb {
        ContentDb::load(Path::new("../../content")).expect("workspace content must load")
    }

    /// A fresh saltmere world (stash at (30,40)) with one inert character
    /// standing ON the stash, holding `n` 1x1 bag items.
    fn world_at_stash(n: usize) -> (World, usize) {
        let content = content();
        let mut world = World::new_for_zone(0x57A5, &content, "saltmere");
        let halt = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&TickInputs {
            arrivals: Vec::new(),
            joins: vec![JoinRequest {
                name: "Banker".into(),
                program: halt,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character joined");
        let net = world.zone.get(slot).unwrap().net_id;
        world.test_teleport(net, 30, 40); // onto the stash place
        let base = content
            .items
            .iter()
            .position(|i| i.w == 1 && i.h == 1)
            .unwrap_or(0) as u32;
        let me = world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap();
        for _ in 0..n {
            me.inventory.push(PlacedItem {
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
        (world, slot)
    }

    #[test]
    fn deposit_withdraw_roundtrip() {
        let (mut world, slot) = world_at_stash(1);
        assert!(world.near_stash(slot));
        assert_eq!(world.stash_deposit(slot, 0), 0);
        {
            let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
            assert!(ch.inventory.is_empty(), "bag emptied");
            assert_eq!(ch.stash.len(), 1, "stash holds it");
        }
        assert_eq!(world.stash_withdraw(slot, 0), 0);
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.inventory.len(), 1, "back in the bag");
        assert!(ch.stash.is_empty());
    }

    #[test]
    fn gated_by_range() {
        let (mut world, slot) = world_at_stash(1);
        let net = world.zone.get(slot).unwrap().net_id;
        world.test_teleport(net, 5, 5);
        assert!(!world.near_stash(slot));
        assert_eq!(world.stash_deposit(slot, 0), -2, "out of range");
        assert_eq!(world.stash_withdraw(slot, 0), -2);
    }

    #[test]
    fn bad_index_is_minus_one() {
        let (mut world, slot) = world_at_stash(0);
        assert_eq!(world.stash_deposit(slot, 9), -1);
        assert_eq!(world.stash_withdraw(slot, 9), -1);
    }

    #[test]
    fn full_stash_returns_minus_three() {
        let (mut world, slot) = world_at_stash(1);
        {
            let ch = world
                .zone
                .get_mut(slot)
                .unwrap()
                .character
                .as_mut()
                .unwrap();
            let item = ch.inventory[0].item.clone();
            for y in 0..STASH_H {
                for x in 0..STASH_W {
                    ch.stash.push(PlacedItem {
                        item: item.clone(),
                        x,
                        y,
                    });
                }
            }
        }
        assert_eq!(world.stash_deposit(slot, 0), -3, "no fit");
    }

    #[test]
    fn stash_round_trips_through_postcard() {
        let (mut world, slot) = world_at_stash(1);
        assert_eq!(world.stash_deposit(slot, 0), 0);
        let bytes = postcard::to_allocvec(&world).expect("serialize");
        let mut back: World = postcard::from_bytes(&bytes).expect("deserialize");
        back.attach_content(&content()).expect("content matches");
        assert_eq!(
            world.state_hash(),
            back.state_hash(),
            "stash folded + restored"
        );
    }
}
