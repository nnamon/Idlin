//! The passive tree at runtime: whole-build declaration at bot init
//! (SetBuild) with strict connectivity validation, and append-only
//! auto-allocation as levels arrive. Re-declaring a plan that keeps
//! every allocated node is free STEERING; a plan that would change
//! what's already allocated is a RESPEC and consumes a Regret Obol —
//! only the first tree is free.

use super::{SimEvent, World};

impl World {
    /// Declare (or re-declare) the whole build. Steering is free; a
    /// respec costs one Regret Obol, resets allocated nodes, re-walks
    /// the new plan, unsockets gems from sockets no longer owned, and
    /// re-validates gear requirements against the new attributes.
    pub(crate) fn set_build(
        &mut self,
        slot: usize,
        refs: &[i32],
        events: &mut Vec<SimEvent>,
    ) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let (net_id, owner) = (e.net_id, ch.name.clone());
        let start = self.content.tree_start;

        // Resolve and validate the WHOLE plan before storing anything:
        // every entry must resolve, and must be connected to the start node,
        // the already-allocated set, or an earlier plan entry. A bad plan is
        // rejected outright (loudly) — better a visible authoring error than
        // a bot silently stuck mid-build.
        let mut plan: Vec<u32> = Vec::with_capacity(refs.len());
        for (k, r) in refs.iter().take(240).enumerate() {
            // v2 (#54): refs are stable tagged node nums — translate each to its
            // tree array index. A non-node num (wrong category) or unknown num
            // is rejected, same as an unknown ref always was.
            let idx = match self.content.content_idx(*r) {
                Some((idlin_content::ids::Category::Node, i)) => i,
                _ => {
                    events.push(SimEvent::BuildRejected {
                        id: net_id,
                        owner,
                        reason: format!("entry {k}: unknown node num {r}"),
                    });
                    return -1;
                }
            };
            if idx == start {
                events.push(SimEvent::BuildRejected {
                    id: net_id,
                    owner,
                    reason: format!("entry {k}: the start node is implicit"),
                });
                return -1;
            }
            let connected = plan.contains(&idx)
                || self.content.tree_adj[idx as usize]
                    .iter()
                    .any(|n| *n == start || plan.contains(n));
            if !connected {
                events.push(SimEvent::BuildRejected {
                    id: net_id,
                    owner,
                    reason: format!(
                        "entry {k}: `{}` is not connected to the path",
                        self.content.tree[idx as usize].id
                    ),
                });
                return -1;
            }
            plan.push(idx);
        }
        // Steering vs RESPEC: keeping every allocated node makes this a
        // free re-aim of future points; dropping any allocated node is
        // regret, and regret has a price.
        let is_respec = ch.allocated.iter().any(|a| !plan.contains(a));
        if is_respec {
            let regret = self
                .content
                .currency
                .iter()
                .position(|c| c.op == idlin_content::CurrencyOp::Respec);
            let have = regret
                .map(|i| ch.currency.get(i).copied().unwrap_or(0))
                .unwrap_or(0);
            let Some(regret_idx) = regret.filter(|_| have > 0) else {
                events.push(SimEvent::BuildRejected {
                    id: net_id,
                    owner,
                    reason: "changing an allocated tree costs a Regret Obol".into(),
                });
                return -2;
            };
            if let Some(me) = self.zone.get_mut(slot) {
                let ch = me.character.as_mut().unwrap();
                ch.currency[regret_idx] -= 1;
                ch.allocated.clear();
            }
            events.push(SimEvent::TreeRespecced {
                id: net_id,
                owner: owner.clone(),
            });
        }

        let declared = plan.len() as u32;
        if let Some(me) = self.zone.get_mut(slot) {
            me.character.as_mut().unwrap().build_plan = plan;
        }
        events.push(SimEvent::BuildDeclared {
            id: net_id,
            owner,
            nodes: declared,
        });
        // Catch-up: a redeployed (or respecced) bot may have banked points.
        self.allocate_from_plan(slot, events);
        if is_respec {
            // Sockets on nodes we no longer own give their gems back to
            // the bag as 1×1 items (or the ground when it's full); gear that
            // leaned on dropped attribute nodes is shed.
            self.unsocket_orphans(slot, events);
            self.refresh_derived_stats(slot);
            self.enforce_gear_requirements(slot, events);
        }
        declared as i32
    }

    /// After a respec: any socketed gem whose socket node is no longer owned
    /// returns to the bag as a 1×1 item (#54 PR2b), or drops at our feet if the
    /// grid is full.
    fn unsocket_orphans(&mut self, slot: usize, _events: &mut Vec<SimEvent>) {
        let start = self.content.tree_start;
        let Some(e) = self.zone.get(slot) else { return };
        let Some(ch) = &e.character else { return };
        let orphan_nodes: Vec<u32> = ch
            .sockets
            .keys()
            .copied()
            .filter(|n| *n != start && !ch.allocated.contains(n))
            .collect();
        if orphan_nodes.is_empty() {
            return;
        }
        // Pull the orphaned gems (skill + its supports) out of their sockets.
        let mut freed: Vec<crate::entity::GemInstance> = Vec::new();
        if let Some(me) = self.zone.get_mut(slot) {
            let ch = me.character.as_mut().unwrap();
            for node in orphan_nodes {
                let Some(sg) = ch.sockets.remove(&node) else {
                    continue;
                };
                freed.extend(std::iter::once(sg.gem).chain(sg.supports));
            }
        }
        // Each lands back in the grid, or drops if there's no 1×1 gap left.
        for gem in freed {
            let spot = {
                let e = self.zone.get(slot).unwrap();
                self.first_fit(e.character.as_ref().unwrap(), 1, 1)
            };
            match spot {
                Some((x, y)) => {
                    let me = self.zone.get_mut(slot).unwrap();
                    me.character
                        .as_mut()
                        .unwrap()
                        .inventory
                        .push(crate::entity::PlacedItem {
                            item: crate::entity::BagItem::Gem(gem),
                            x,
                            y,
                        });
                }
                None => {
                    let (pos, net_id) = {
                        let e = self.zone.get(slot).unwrap();
                        (e.pos, e.net_id)
                    };
                    self.spawn_loot(pos, crate::entity::LootPayload::Gem(gem), net_id);
                }
            }
        }
    }

    /// Spend available passive points along the declared plan: skip entries
    /// already allocated, stop at the first one that isn't connected yet.
    pub(crate) fn allocate_from_plan(&mut self, slot: usize, events: &mut Vec<SimEvent>) {
        loop {
            let Some(e) = self.zone.get(slot) else { return };
            let Some(ch) = &e.character else { return };
            if ch.passive_points() == 0 {
                return;
            }
            let start = self.content.tree_start;
            let next = ch
                .build_plan
                .iter()
                .copied()
                .find(|idx| !ch.allocated.contains(idx));
            let Some(idx) = next else { return };
            let connected = idx != start
                && self.content.tree_adj[idx as usize]
                    .iter()
                    .any(|n| *n == start || ch.allocated.contains(n));
            if !connected {
                return; // plan blocked (authoring gap); retried next level
            }
            let (net_id, owner) = (e.net_id, ch.name.clone());
            let node_name = self.content.tree[idx as usize].name.clone();
            if let Some(me) = self.zone.get_mut(slot) {
                let ch = me.character.as_mut().unwrap();
                ch.allocated.push(idx);
                ch.allocated.sort_unstable();
            }
            self.refresh_derived_stats(slot);
            events.push(SimEvent::PassiveAllocated {
                id: net_id,
                owner,
                node: node_name,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::{JoinRequest, TickInputs, World};
    use idlin_content::{ContentDb, CurrencyOp};
    use std::path::Path;

    /// Stable tagged node nums (#54: `compose(Node, seq)` = `(5 << 23) | seq`)
    /// for the core.ron STR and DEX trunks — the same values the generated
    /// `NODE_*` consts carry. Seqs: str1=10, str2=11, str3=12, dex1=40, dex2=41.
    const STR1: i32 = 41943050;
    const STR2: i32 = 41943051;
    const STR3: i32 = 41943052;
    const DEX1: i32 = 41943080;
    const DEX2: i32 = 41943081;

    fn world_with_pupil() -> (World, usize) {
        let content = ContentDb::load(Path::new("../../content")).expect("content loads");
        let mut world = World::new(0x7E57, &content);
        let halt = idlin_botc::assemble("halt\n").unwrap();
        world.tick(&TickInputs {
            arrivals: Vec::new(),
            joins: vec![JoinRequest {
                name: "Regretful".into(),
                program: halt,
            }],
        });
        let slot = (0..world.zone.slot_count())
            .find(|&s| world.zone.get(s).is_some_and(|e| e.character.is_some()))
            .expect("character joined");
        (world, slot)
    }

    /// The whole regret loop: a STR build wielding a STR cleaver — the
    /// first declaration is free; changing it is rejected without a
    /// Regret Obol; WITH one, allocated nodes re-walk the new plan and
    /// the cleaver (its requirement now unmet) is SHED to the bag.
    #[test]
    fn respec_costs_regret_and_sheds_unqualified_gear() {
        let (mut world, slot) = world_with_pupil();
        // Level 2: the first two passive points exist (level 1 has none).
        world
            .zone
            .get_mut(slot)
            .unwrap()
            .character
            .as_mut()
            .unwrap()
            .level = 2;
        let mut events = Vec::new();
        assert!(world.set_build(slot, &[STR1, STR2], &mut events) >= 0);
        {
            let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
            assert_eq!(ch.allocated.len(), 2, "level 2 = 2 points, both spent");
        }
        // Wield a SYNTHETIC STR-gated cleaver: starter content is
        // requirement-free by design, but the MACHINERY must hold for
        // the gated bases to come — fake the requirement on the def.
        let cleaver = world
            .content
            .items
            .iter()
            .position(|i| i.id == "rusted_cleaver")
            .unwrap() as u32;
        world.content.items[cleaver as usize].req_str = 10;
        {
            let me = world.zone.get_mut(slot).unwrap();
            let ch = me.character.as_mut().unwrap();
            ch.equipment[idlin_content::GearSlot::Weapon.idx()] = Some(crate::entity::Item {
                base_idx: cleaver,
                rarity: crate::entity::Rarity::Normal,
                item_level: 1,
                affixes: Vec::new(),
                name: String::new(),
                charges: 0,
            });
        }
        world.refresh_derived_stats(slot);
        let worn = world
            .zone
            .get(slot)
            .unwrap()
            .character
            .as_ref()
            .unwrap()
            .equipment[0]
            .clone()
            .unwrap();
        assert!(world.meets_requirements(slot, &worn, Some(0)));

        // Regret without an obol: rejected, nothing changes.
        let mut events = Vec::new();
        let r = world.set_build(slot, &[DEX1, DEX2], &mut events);
        assert_eq!(r, -2, "a respec without a Regret Obol is refused");
        assert!(
            events
                .iter()
                .any(|e| matches!(e, super::SimEvent::BuildRejected { .. }))
        );
        {
            let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
            assert_eq!(ch.allocated.len(), 2);
            assert!(ch.equipment[0].is_some(), "the cleaver stays");
        }

        // Pay the regret: nodes re-walk DEX; the cleaver is shed to the bag.
        let regret = world
            .content
            .currency
            .iter()
            .position(|c| c.op == CurrencyOp::Respec)
            .expect("regret obol exists");
        {
            let me = world.zone.get_mut(slot).unwrap();
            let ch = me.character.as_mut().unwrap();
            if ch.currency.len() <= regret {
                ch.currency.resize(regret + 1, 0);
            }
            ch.currency[regret] = 1;
        }
        let mut events = Vec::new();
        let r = world.set_build(slot, &[DEX1, DEX2], &mut events);
        assert!(r >= 0, "respec with an obol goes through: {r}");
        assert!(
            events
                .iter()
                .any(|e| matches!(e, super::SimEvent::TreeRespecced { .. }))
        );
        assert!(
            events
                .iter()
                .any(|e| matches!(e, super::SimEvent::GearShed { .. })),
            "the STR cleaver must be shed"
        );
        let ch = world.zone.get(slot).unwrap().character.as_ref().unwrap();
        assert_eq!(ch.currency[regret], 0, "the obol is consumed");
        assert!(ch.equipment[0].is_none(), "weapon slot emptied");
        assert!(
            ch.inventory
                .iter()
                .any(|p| p.item.as_gear().is_some_and(|it| it.base_idx == cleaver)),
            "the cleaver landed in the bag"
        );
        let names: Vec<&str> = ch
            .allocated
            .iter()
            .map(|&i| world.content.tree[i as usize].id.as_str())
            .collect();
        assert!(
            names.contains(&"dex1") && names.contains(&"dex2"),
            "{names:?}"
        );
    }

    /// Steering (a plan that KEEPS everything allocated) stays free.
    #[test]
    fn append_steering_is_free() {
        let (mut world, slot) = world_with_pupil();
        let mut events = Vec::new();
        assert!(world.set_build(slot, &[STR1, STR2], &mut events) >= 0);
        let mut events = Vec::new();
        // Same prefix, longer plan: no obol required.
        let r = world.set_build(slot, &[STR1, STR2, STR3], &mut events);
        assert!(r >= 0, "steering must stay free: {r}");
        assert!(
            !events
                .iter()
                .any(|e| matches!(e, super::SimEvent::BuildRejected { .. }))
        );
    }
}
