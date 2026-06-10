//! The passive tree at runtime: whole-build declaration at bot init
//! (SetBuild) with strict connectivity validation, and append-only
//! auto-allocation as levels arrive.

use super::{SimEvent, World};

impl World {
    /// Bot initialization: declare the whole build up front. Auto-allocation
    /// walks this list as levels arrive — append-only, so tree-dependent
    /// state (socketed gems) is never invalidated. Re-declaring (a redeploy)
    /// only steers FUTURE points; allocated nodes always persist.
    pub(crate) fn set_build(
        &mut self,
        slot: usize,
        refs: &[u16],
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
            let Some(idx) = self.content.tree_refs.iter().position(|tr| tr == r) else {
                events.push(SimEvent::BuildRejected {
                    id: net_id,
                    owner,
                    reason: format!("entry {k}: unknown node ref {r:#06x}"),
                });
                return -1;
            };
            let idx = idx as u32;
            if idx == start {
                events.push(SimEvent::BuildRejected {
                    id: net_id,
                    owner,
                    reason: format!("entry {k}: the start node is implicit"),
                });
                return -1;
            }
            let connected = ch.allocated.contains(&idx)
                || plan.contains(&idx)
                || self.content.tree_adj[idx as usize]
                    .iter()
                    .any(|n| *n == start || ch.allocated.contains(n) || plan.contains(n));
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
        let declared = plan.len() as u32;
        if let Some(me) = self.zone.get_mut(slot) {
            me.character.as_mut().unwrap().build_plan = plan;
        }
        events.push(SimEvent::BuildDeclared {
            id: net_id,
            owner,
            nodes: declared,
        });
        // Catch-up: a redeployed bot may have banked points.
        self.allocate_from_plan(slot, events);
        declared as i32
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
