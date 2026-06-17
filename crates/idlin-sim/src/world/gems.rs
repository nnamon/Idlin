//! Gem socketing (PoE2-style: support capacity lives on the skill gem) and
//! the deterministic skill-slot ordering UseSkill/ReadSkills index into.

use super::{SimEvent, World};
use crate::entity::{
    BagItem, CharacterState, GemInstance, LootPayload, PlacedItem, SocketedGem, support_slots,
};
use idlin_content::{GemKind, NodeKind};

impl World {
    /// Socketed skill slots in deterministic order (ascending node index).
    /// Slot numbers for UseSkill/ReadSkills are 1-based into this list.
    pub(crate) fn skill_nodes(&self, ch: &CharacterState) -> Vec<u32> {
        ch.sockets
            .iter()
            .filter(|(node, sg)| {
                self.content.tree[**node as usize].kind == NodeKind::Socket
                    && self.content.gems[sg.gem.gem_idx as usize].kind == GemKind::Skill
            })
            .map(|(node, _)| *node)
            .collect()
    }

    /// Socket gems. Skill gems go into allocated tree socket nodes; support
    /// gems go into a socketed skill gem's own support slots (PoE2-style —
    /// capacity lives on the gem). Manual: (node, inv_idx) — the BAG entry at
    /// inv_idx must be a GEM (#54 PR2b: gems live in the grid now); a skill gem
    /// fills an empty node, a support attaches to that node's skill if it has a
    /// free slot. Auto (-1, -1): fill empty nodes with skill gems, then fill
    /// every socketed skill's free support slots. A consumed gem leaves the
    /// grid; a swapped-out squatter returns to it (or drops if it's full).
    /// Returns the number of gems socketed, or -1.
    pub(crate) fn socket_gem(
        &mut self,
        slot: usize,
        socket_sel: i32,
        inv_sel: i32,
        events: &mut Vec<SimEvent>,
    ) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let (net_id, owner) = (e.net_id, ch.name.clone());

        let gem_kind_of = |gem: &GemInstance| self.content.gems[gem.gem_idx as usize].kind;
        // Capacity grows as the SKILL gem levels (1, then 2 at 7, 3 at 14).
        let support_slots_of = |gem: &GemInstance| support_slots(gem.level);
        let is_socket_node = |node: u32| self.content.tree[node as usize].kind == NodeKind::Socket;
        // The start node is implicitly allocated — if it's a socket (the
        // First Spark pattern), it's usable from level 1.
        let start_idx = self.content.tree_start;
        let owns = |node: u32| node == start_idx || ch.allocated.contains(&node);
        // The gem at a bag slot, or None if that slot is gear / out of range.
        let gem_at = |i: usize| ch.inventory.get(i).and_then(|p| p.item.as_gem());

        // Work list: (node, bag index, attach_as_support) — plus skill SWAPS
        // (node, bag index): the squatter returns to the grid.
        let mut plans: Vec<(u32, usize, bool)> = Vec::new();
        let mut swaps: Vec<(u32, usize)> = Vec::new();
        if socket_sel >= 0 {
            // #54 PR3: socket_sel is a stable tagged NODE num (like set_build),
            // not a tree array index — translate it. A non-node / unknown num
            // is rejected, same as an out-of-range index always was.
            let node = match self.content.content_idx(socket_sel) {
                Some((idlin_content::ids::Category::Node, i)) => i,
                _ => return -1,
            };
            let inv_idx = inv_sel.max(0) as usize;
            let Some(gem) = gem_at(inv_idx) else {
                return -1; // out of range, or the bag slot isn't a gem
            };
            if !owns(node) || !is_socket_node(node) {
                return -1;
            }
            match gem_kind_of(gem) {
                GemKind::Skill => {
                    if ch.sockets.contains_key(&node) {
                        return -1;
                    }
                    plans.push((node, inv_idx, false));
                }
                GemKind::Support => {
                    let Some(sg) = ch.sockets.get(&node) else {
                        return -1;
                    };
                    if sg.supports.len() >= support_slots_of(&sg.gem) {
                        return -1;
                    }
                    // One copy of a given support per skill (PoE rule).
                    if sg.supports.iter().any(|g| g.gem_idx == gem.gem_idx) {
                        return -1;
                    }
                    // Tag gate: the support must fit the skill it joins.
                    let sup = &self.content.gems[gem.gem_idx as usize];
                    let skill = &self.content.gems[sg.gem.gem_idx as usize];
                    if !sup.fits_skill(skill) {
                        events.push(SimEvent::GemRejected {
                            id: net_id,
                            owner,
                            gem: sup.name.clone(),
                            skill: skill.name.clone(),
                        });
                        return -1;
                    }
                    plans.push((node, inv_idx, true));
                }
            }
        } else {
            // A skill that deals damage ITSELF (weapon coeff, added
            // damage, or a dot) outranks a pure utility buff — auto is
            // a sensible default, like EquipBest. (A War Cry squatting
            // in the only socket once cost a pupil the whole tutorial.)
            let deals_damage = |gem: &GemInstance| {
                let d = &self.content.gems[gem.gem_idx as usize];
                d.coeff_bp > 0
                    || d.dot.is_some()
                    || [
                        &d.added_phys,
                        &d.added_fire,
                        &d.added_cold,
                        &d.added_lightning,
                        &d.added_chaos,
                    ]
                    .iter()
                    .any(|f| f.at(gem.level.max(1)) > 0)
            };
            let mut used: Vec<usize> = Vec::new();
            // Pass 1: empty socket nodes get skill gems (start included),
            // damage-dealers first, then bag order.
            for node in std::iter::once(start_idx).chain(ch.allocated.iter().copied()) {
                if !is_socket_node(node) || ch.sockets.contains_key(&node) {
                    continue;
                }
                let found = ch
                    .inventory
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| p.item.as_gem().map(|g| (i, g)))
                    .filter(|(i, g)| !used.contains(i) && gem_kind_of(g) == GemKind::Skill)
                    .min_by_key(|(i, g)| (!deals_damage(g), *i));
                if let Some((i, _)) = found {
                    used.push(i);
                    plans.push((node, i, false));
                }
            }
            // Pass 1.5: upgrade a UTILITY squatter — a socketed skill
            // that deals no damage and carries no supports yields its
            // node to a damage skill from the bag (the utility gem
            // returns to the grid).
            for (&node, sg) in &ch.sockets {
                if deals_damage(&sg.gem) || !sg.supports.is_empty() {
                    continue;
                }
                let found = ch
                    .inventory
                    .iter()
                    .enumerate()
                    .filter_map(|(i, p)| p.item.as_gem().map(|g| (i, g)))
                    .find(|(i, g)| {
                        !used.contains(i) && gem_kind_of(g) == GemKind::Skill && deals_damage(g)
                    });
                if let Some((i, _)) = found {
                    used.push(i);
                    swaps.push((node, i));
                }
            }
            // Pass 2: socketed skills with free slots get supports. (Skills
            // socketed in pass 1 start empty and are filled next call —
            // keeping this single-pass over current state is simpler and
            // deterministic; the grinder calls SocketGem every tick.)
            for (&node, sg) in &ch.sockets {
                let skill = &self.content.gems[sg.gem.gem_idx as usize];
                // One copy of a given support per skill (PoE rule).
                let mut have: Vec<u32> = sg.supports.iter().map(|g| g.gem_idx).collect();
                let mut free = support_slots_of(&sg.gem).saturating_sub(sg.supports.len());
                while free > 0 {
                    // Tag gate: auto-socketing quietly skips misfits.
                    let found = ch
                        .inventory
                        .iter()
                        .enumerate()
                        .filter_map(|(i, p)| p.item.as_gem().map(|g| (i, g)))
                        .find(|(i, g)| {
                            !used.contains(i)
                                && gem_kind_of(g) == GemKind::Support
                                && !have.contains(&g.gem_idx)
                                && self.content.gems[g.gem_idx as usize].fits_skill(skill)
                        });
                    let Some((i, g)) = found.map(|(i, g)| (i, g.gem_idx)) else {
                        break;
                    };
                    used.push(i);
                    have.push(g);
                    plans.push((node, i, true));
                    free -= 1;
                }
            }
        }
        if plans.is_empty() && swaps.is_empty() {
            return 0;
        }

        // Apply: pull consumed gems OUT of the bag highest-index-first so the
        // remaining indices hold. Swapped-out squatters are collected and
        // re-placed in the grid afterward (a fresh borrow, since first_fit
        // needs to see the post-removal bag).
        let mut returned: Vec<GemInstance> = Vec::new();
        {
            let me = self.zone.get_mut(slot).unwrap();
            let ch = me.character.as_mut().unwrap();
            let mut by_idx: Vec<(u32, usize, Option<bool>)> = plans
                .iter()
                .map(|&(n, i, a)| (n, i, Some(a)))
                .chain(swaps.iter().map(|&(n, i)| (n, i, None)))
                .collect();
            by_idx.sort_unstable_by_key(|p| std::cmp::Reverse(p.1));
            for (node, inv_idx, attach) in by_idx {
                // Every planned index points at a gem (we filtered above).
                let BagItem::Gem(gem) = ch.inventory.remove(inv_idx).item else {
                    continue;
                };
                match attach {
                    Some(true) => ch.sockets.get_mut(&node).unwrap().supports.push(gem),
                    Some(false) => {
                        ch.sockets.insert(
                            node,
                            SocketedGem {
                                gem,
                                cooldown_left: 0,
                                supports: Vec::new(),
                            },
                        );
                    }
                    // Swap: the damage skill takes the node, the utility
                    // squatter comes back out for re-placement.
                    None => {
                        let sg = ch.sockets.get_mut(&node).unwrap();
                        returned.push(std::mem::replace(&mut sg.gem, gem));
                        sg.cooldown_left = 0;
                    }
                }
            }
        }
        // Squatters land back in the bag (1×1), or drop at our feet if full.
        for gem in returned {
            let spot = {
                let e = self.zone.get(slot).unwrap();
                self.first_fit(e.character.as_ref().unwrap(), 1, 1)
            };
            match spot {
                Some((x, y)) => {
                    let me = self.zone.get_mut(slot).unwrap();
                    me.character.as_mut().unwrap().inventory.push(PlacedItem {
                        item: BagItem::Gem(gem),
                        x,
                        y,
                    });
                }
                None => {
                    let (pos, net) = {
                        let e = self.zone.get(slot).unwrap();
                        (e.pos, e.net_id)
                    };
                    self.spawn_loot(pos, LootPayload::Gem(gem), net);
                }
            }
        }
        // Event names via content (after the mutable borrow ends).
        let count = (plans.len() + swaps.len()) as i32;
        let mut gem_names: Vec<String> = Vec::new();
        {
            let e = self.zone.get(slot).unwrap();
            let ch = e.character.as_ref().unwrap();
            for (node, _, attach) in &plans {
                let sg = &ch.sockets[node];
                let idx = if *attach {
                    sg.supports
                        .last()
                        .map(|g| g.gem_idx)
                        .unwrap_or(sg.gem.gem_idx)
                } else {
                    sg.gem.gem_idx
                };
                gem_names.push(self.content.gems[idx as usize].name.clone());
            }
            for (node, _) in &swaps {
                gem_names.push(
                    self.content.gems[ch.sockets[node].gem.gem_idx as usize]
                        .name
                        .clone(),
                );
            }
        }
        for name in gem_names {
            events.push(SimEvent::GemSocketed {
                id: net_id,
                owner: owner.clone(),
                gem: name,
            });
        }
        count
    }
}
