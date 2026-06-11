//! Gem socketing (PoE2-style: support capacity lives on the skill gem) and
//! the deterministic skill-slot ordering UseSkill/ReadSkills index into.

use super::{SimEvent, World};
use crate::entity::{CharacterState, GemInstance, SocketedGem};
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
    /// capacity lives on the gem). Manual: (node, pouch_idx) — a skill gem
    /// fills an empty node, a support attaches to that node's skill if it
    /// has a free slot. Auto (-1, -1): fill empty nodes with skill gems,
    /// then fill every socketed skill's free support slots. Returns the
    /// number of gems socketed, or -1.
    pub(crate) fn socket_gem(
        &mut self,
        slot: usize,
        socket_sel: i32,
        pouch_sel: i32,
        events: &mut Vec<SimEvent>,
    ) -> i32 {
        let Some(e) = self.zone.get(slot) else {
            return -1;
        };
        let Some(ch) = &e.character else { return -1 };
        let (net_id, owner) = (e.net_id, ch.name.clone());

        let gem_kind_of = |gem: &GemInstance| self.content.gems[gem.gem_idx as usize].kind;
        let support_slots_of =
            |gem: &GemInstance| self.content.gems[gem.gem_idx as usize].support_slots as usize;
        let is_socket_node = |node: u32| self.content.tree[node as usize].kind == NodeKind::Socket;
        // The start node is implicitly allocated — if it's a socket (the
        // First Spark pattern), it's usable from level 1.
        let start_idx = self.content.tree_start;
        let owns = |node: u32| node == start_idx || ch.allocated.contains(&node);

        // Work list: (node, pouch index, attach_as_support).
        let mut plans: Vec<(u32, usize, bool)> = Vec::new();
        if socket_sel >= 0 {
            let node = socket_sel as u32;
            let pouch_idx = pouch_sel.max(0) as usize;
            if (node as usize) >= self.content.tree.len()
                || !owns(node)
                || !is_socket_node(node)
                || pouch_idx >= ch.pouch.len()
            {
                return -1;
            }
            match gem_kind_of(&ch.pouch[pouch_idx]) {
                GemKind::Skill => {
                    if ch.sockets.contains_key(&node) {
                        return -1;
                    }
                    plans.push((node, pouch_idx, false));
                }
                GemKind::Support => {
                    let Some(sg) = ch.sockets.get(&node) else {
                        return -1;
                    };
                    if sg.supports.len() >= support_slots_of(&sg.gem) {
                        return -1;
                    }
                    // Tag gate: the support must fit the skill it joins.
                    let sup = &self.content.gems[ch.pouch[pouch_idx].gem_idx as usize];
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
                    plans.push((node, pouch_idx, true));
                }
            }
        } else {
            let mut used: Vec<usize> = Vec::new();
            // Pass 1: empty socket nodes get skill gems (start included).
            for node in std::iter::once(start_idx).chain(ch.allocated.iter().copied()) {
                if !is_socket_node(node) || ch.sockets.contains_key(&node) {
                    continue;
                }
                let found = ch
                    .pouch
                    .iter()
                    .enumerate()
                    .find(|(i, g)| !used.contains(i) && gem_kind_of(g) == GemKind::Skill);
                if let Some((i, _)) = found {
                    used.push(i);
                    plans.push((node, i, false));
                }
            }
            // Pass 2: socketed skills with free slots get supports. (Skills
            // socketed in pass 1 start empty and are filled next call —
            // keeping this single-pass over current state is simpler and
            // deterministic; the grinder calls SocketGem every tick.)
            for (&node, sg) in &ch.sockets {
                let skill = &self.content.gems[sg.gem.gem_idx as usize];
                let mut free = support_slots_of(&sg.gem).saturating_sub(sg.supports.len());
                while free > 0 {
                    // Tag gate: auto-socketing quietly skips misfits.
                    let found = ch.pouch.iter().enumerate().find(|(i, g)| {
                        !used.contains(i)
                            && gem_kind_of(g) == GemKind::Support
                            && self.content.gems[g.gem_idx as usize].fits_skill(skill)
                    });
                    let Some((i, _)) = found else { break };
                    used.push(i);
                    plans.push((node, i, true));
                    free -= 1;
                }
            }
        }
        if plans.is_empty() {
            return 0;
        }

        // Apply: remove pouch gems highest-index-first so indices hold.
        {
            let me = self.zone.get_mut(slot).unwrap();
            let ch = me.character.as_mut().unwrap();
            let mut by_pouch = plans.clone();
            by_pouch.sort_unstable_by_key(|p| std::cmp::Reverse(p.1));
            for (node, pouch_idx, attach) in by_pouch {
                let gem = ch.pouch.remove(pouch_idx);
                if attach {
                    ch.sockets.get_mut(&node).unwrap().supports.push(gem);
                } else {
                    ch.sockets.insert(
                        node,
                        SocketedGem {
                            gem,
                            cooldown_left: 0,
                            supports: Vec::new(),
                        },
                    );
                }
            }
        }
        // Event names via content (after the mutable borrow ends).
        let count = plans.len() as i32;
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
