//! Replication: turns per-tick sim frames into protocol messages.
//! One delta stream is broadcast to all clients (Phase 1: everyone is the
//! owner view); a full snapshot is kept fresh for new joiners and lag resync.

use crate::director::Director;
use crate::runner::TickFrame;
use idlin_protocol::{
    EntityKind, EntityMove, EntityPatch, EntityState, GameEvent, HitFx, ObstacleState,
    ProjectileFx, S2C,
};
use idlin_sim::{EntityView, KIND_CHARACTER, KIND_MONSTER, SimEvent};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, watch};
use tracing::{info, warn};

/// Frames queued behind the replication task before we start complaining.
/// The tick→replication channel is unbounded so a slow consumer can never
/// stall the sim thread; the price is that a backlog grows silently — so
/// it must not stay silent.
const BACKLOG_WARN_FRAMES: usize = 50;

/// Pre-serialized message broadcast to every connected client.
pub type Frame = Arc<str>;

pub struct ReplicationHandles {
    /// Per-tick delta/event/cue stream.
    pub broadcast: broadcast::Sender<Frame>,
    /// Latest full snapshot JSON, for connect/resync.
    pub snapshot: watch::Receiver<Frame>,
}

pub fn spawn_replication(
    mut frames: mpsc::UnboundedReceiver<TickFrame>,
    zone_name: String,
    zone_width: i32,
    zone_height: i32,
    obstacles: Vec<ObstacleState>,
) -> ReplicationHandles {
    let (tx, _) = broadcast::channel::<Frame>(256);
    let (snap_tx, snap_rx) = watch::channel::<Frame>(Arc::from(empty_snapshot(
        &zone_name,
        zone_width,
        zone_height,
        &obstacles,
    )));
    let broadcast = tx.clone();

    tokio::spawn(async move {
        let mut prev: HashMap<u32, EntityState> = HashMap::new();
        let mut director = Director::new();
        while let Some(frame) = frames.recv().await {
            let backlog = frames.len();
            if backlog > BACKLOG_WARN_FRAMES && frame.tick.is_multiple_of(50) {
                warn!("replication is {backlog} frames behind the sim");
            }

            let mut current: HashMap<u32, EntityState> = HashMap::with_capacity(frame.views.len());
            for v in &frame.views {
                current.insert(v.id, to_state(v));
            }

            let (spawned, moved, updated, removed) = diff(&prev, &current);

            let hits: Vec<HitFx> = frame
                .events
                .iter()
                .filter_map(|ev| match ev {
                    SimEvent::Hit {
                        attacker,
                        target,
                        amount,
                        dmg_type,
                        crit,
                        dot,
                        projectile,
                        killed,
                    } => Some(HitFx {
                        attacker: *attacker,
                        target: *target,
                        amount: (*amount).clamp(0, i32::MAX as i64) as i32,
                        dmg_type: *dmg_type,
                        crit: *crit,
                        dot: *dot,
                        projectile: *projectile,
                        killed: *killed,
                    }),
                    _ => None,
                })
                .collect();
            let projectiles: Vec<ProjectileFx> = frame
                .events
                .iter()
                .filter_map(|ev| match ev {
                    SimEvent::ProjectileSpawned {
                        x,
                        y,
                        vx,
                        vy,
                        range,
                        dmg_type,
                    } => Some(ProjectileFx {
                        x: *x,
                        y: *y,
                        vx: *vx,
                        vy: *vy,
                        range: *range,
                        dmg_type: *dmg_type,
                    }),
                    _ => None,
                })
                .collect();

            let delta = S2C::ZoneDelta {
                tick: frame.tick,
                spawned,
                moved,
                updated,
                removed,
                hits,
                projectiles,
            };
            // broadcast::send only errs when no client is subscribed —
            // normal between viewers, not a fault.
            let _ = broadcast.send(serialize(&delta));

            // -- narratable events --
            let events: Vec<GameEvent> = frame.events.iter().filter_map(to_game_event).collect();
            if !events.is_empty() {
                let _ = broadcast.send(serialize(&S2C::Events { events }));
            }

            // -- director --
            let characters: Vec<u32> = frame
                .views
                .iter()
                .filter(|v| v.kind == KIND_CHARACTER && !v.dead)
                .map(|v| v.id)
                .collect();
            if let Some(cue) = director.update(frame.tick, &frame.events, &characters) {
                let _ = broadcast.send(serialize(&S2C::DirectorCue {
                    focus: cue.focus,
                    reason: cue.reason,
                    hold_ticks: cue.hold_ticks,
                }));
            }

            // -- fresh snapshot for joiners --
            let mut entities: Vec<EntityState> = current.values().cloned().collect();
            entities.sort_by_key(|s| s.id);
            let snapshot = S2C::ZoneSnapshot {
                tick: frame.tick,
                zone_name: zone_name.clone(),
                width: zone_width,
                height: zone_height,
                obstacles: obstacles.clone(),
                entities,
            };
            // The watch receiver lives in ReplicationHandles, so this send
            // cannot fail while the server runs.
            let _ = snap_tx.send(serialize(&snapshot));

            prev = current;
        }
        info!("tick frame channel closed; replication exiting");
    });

    ReplicationHandles {
        broadcast: tx,
        snapshot: snap_rx,
    }
}

/// Pure delta computation between two keyed entity-state maps, with stable
/// (id-sorted) ordering for readable wire traffic.
#[allow(clippy::type_complexity)]
fn diff(
    prev: &HashMap<u32, EntityState>,
    current: &HashMap<u32, EntityState>,
) -> (
    Vec<EntityState>,
    Vec<EntityMove>,
    Vec<EntityPatch>,
    Vec<u32>,
) {
    let mut spawned: Vec<EntityState> = Vec::new();
    let mut moved: Vec<EntityMove> = Vec::new();
    let mut updated: Vec<EntityPatch> = Vec::new();
    let mut removed: Vec<u32> = Vec::new();
    for (id, state) in current {
        match prev.get(id) {
            None => spawned.push(state.clone()),
            Some(old) => {
                if old.x != state.x || old.y != state.y {
                    moved.push(EntityMove {
                        id: *id,
                        x: state.x,
                        y: state.y,
                    });
                }
                if old.life_pct != state.life_pct
                    || old.level != state.level
                    || old.dead != state.dead
                    || old.kills != state.kills
                    || old.items != state.items
                    || old.weapon != state.weapon
                    || old.gear != state.gear
                {
                    updated.push(EntityPatch {
                        id: *id,
                        life_pct: state.life_pct,
                        level: state.level,
                        dead: state.dead,
                        kills: state.kills,
                        items: state.items,
                        weapon: state.weapon.clone(),
                        gear: state.gear.clone(),
                    });
                }
            }
        }
    }
    for id in prev.keys() {
        if !current.contains_key(id) {
            removed.push(*id);
        }
    }
    spawned.sort_by_key(|s| s.id);
    moved.sort_by_key(|m| m.id);
    updated.sort_by_key(|u| u.id);
    removed.sort_unstable();
    (spawned, moved, updated, removed)
}

fn serialize(msg: &S2C) -> Frame {
    Arc::from(serde_json::to_string(msg).expect("protocol types always serialize"))
}

fn empty_snapshot(zone_name: &str, width: i32, height: i32, obstacles: &[ObstacleState]) -> String {
    serde_json::to_string(&S2C::ZoneSnapshot {
        tick: 0,
        zone_name: zone_name.to_string(),
        width,
        height,
        obstacles: obstacles.to_vec(),
        entities: vec![],
    })
    .expect("serialize")
}

fn to_state(v: &EntityView) -> EntityState {
    EntityState {
        id: v.id,
        kind: match v.kind {
            KIND_CHARACTER => EntityKind::Character,
            KIND_MONSTER => EntityKind::Monster,
            _ => EntityKind::Loot,
        },
        x: v.x_raw,
        y: v.y_raw,
        life_pct: v.life_pct,
        level: v.level,
        name: v.name.clone(),
        model: v.model.clone(),
        rarity: v.rarity,
        weapon: v.weapon.clone(),
        gear: v.gear.clone(),
        dead: v.dead,
        kills: v.kills.min(u32::MAX as u64) as u32,
        items: v.items.min(u32::MAX as u64) as u32,
    }
}

fn to_game_event(ev: &SimEvent) -> Option<GameEvent> {
    Some(match ev {
        SimEvent::CharacterJoined { id, name } => GameEvent::CharacterJoined {
            id: *id,
            name: name.clone(),
        },
        SimEvent::CharacterDied { id, name, killer } => GameEvent::CharacterDied {
            id: *id,
            name: name.clone(),
            killer: killer.clone(),
        },
        SimEvent::CharacterRespawned { id } => GameEvent::CharacterRespawned { id: *id },
        SimEvent::LevelUp { id, name, level } => GameEvent::LevelUp {
            id: *id,
            name: name.clone(),
            level: *level,
        },
        SimEvent::MonsterKilled {
            killer_id,
            killer,
            monster,
            level,
        } => GameEvent::MonsterKilled {
            killer_id: *killer_id,
            killer: killer.clone(),
            monster: monster.clone(),
            level: *level,
        },
        SimEvent::LootDropped {
            owner_id,
            owner,
            rarity,
            item,
        } => GameEvent::LootDropped {
            owner_id: *owner_id,
            owner: owner.clone(),
            rarity: *rarity as u8,
            item: item.clone(),
        },
        SimEvent::ItemPickedUp {
            owner_id,
            owner,
            rarity,
            item,
        } => GameEvent::ItemPickedUp {
            owner_id: *owner_id,
            owner: owner.clone(),
            rarity: *rarity as u8,
            item: item.clone(),
        },
        SimEvent::ItemEquipped {
            id,
            owner,
            rarity,
            item,
        } => GameEvent::ItemEquipped {
            id: *id,
            owner: owner.clone(),
            rarity: *rarity as u8,
            item: item.clone(),
        },
        SimEvent::PassiveAllocated { id, owner, node } => GameEvent::PassiveAllocated {
            id: *id,
            owner: owner.clone(),
            node: node.clone(),
        },
        SimEvent::GemSocketed { id, owner, gem } => GameEvent::GemSocketed {
            id: *id,
            owner: owner.clone(),
            gem: gem.clone(),
        },
        SimEvent::BuildDeclared { id, owner, nodes } => GameEvent::BuildDeclared {
            id: *id,
            owner: owner.clone(),
            nodes: *nodes,
        },
        SimEvent::BuildRejected { id, owner, reason } => GameEvent::BuildRejected {
            id: *id,
            owner: owner.clone(),
            reason: reason.clone(),
        },
        SimEvent::GemLevelUp {
            id,
            owner,
            gem,
            level,
        } => GameEvent::GemLevelUp {
            id: *id,
            owner: owner.clone(),
            gem: gem.clone(),
            level: *level,
        },
        SimEvent::Hit { .. }
        | SimEvent::ProjectileSpawned { .. }
        | SimEvent::BotDebug { .. }
        | SimEvent::JoinRejected { .. } => {
            return None;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(id: u32, x: i32, life_pct: u8) -> EntityState {
        EntityState {
            id,
            kind: EntityKind::Character,
            x,
            y: 0,
            life_pct,
            level: 1,
            name: format!("e{id}"),
            model: "idler".into(),
            rarity: 0,
            weapon: String::new(),
            gear: vec![],
            dead: false,
            kills: 0,
            items: 0,
        }
    }

    fn keyed(states: Vec<EntityState>) -> HashMap<u32, EntityState> {
        states.into_iter().map(|s| (s.id, s)).collect()
    }

    #[test]
    fn diff_classifies_spawn_move_update_remove() {
        let prev = keyed(vec![state(1, 0, 100), state(2, 5, 100), state(3, 9, 50)]);
        let current = keyed(vec![
            state(1, 7, 100), // moved
            state(2, 5, 40),  // updated
            state(4, 0, 100), // spawned
        ]); // 3 removed
        let (spawned, moved, updated, removed) = diff(&prev, &current);
        assert_eq!(spawned.iter().map(|s| s.id).collect::<Vec<_>>(), [4]);
        assert_eq!(
            moved.iter().map(|m| (m.id, m.x)).collect::<Vec<_>>(),
            [(1, 7)]
        );
        assert_eq!(
            updated
                .iter()
                .map(|u| (u.id, u.life_pct))
                .collect::<Vec<_>>(),
            [(2, 40)]
        );
        assert_eq!(removed, [3]);
    }

    #[test]
    fn diff_of_identical_maps_is_empty() {
        let a = keyed(vec![state(1, 3, 80), state(2, 4, 90)]);
        let (spawned, moved, updated, removed) = diff(&a, &a.clone());
        assert!(spawned.is_empty() && moved.is_empty() && updated.is_empty() && removed.is_empty());
    }

    #[test]
    fn diff_output_is_id_sorted_regardless_of_map_order() {
        let prev = HashMap::new();
        let current = keyed(vec![state(9, 0, 100), state(2, 0, 100), state(5, 0, 100)]);
        let (spawned, ..) = diff(&prev, &current);
        assert_eq!(spawned.iter().map(|s| s.id).collect::<Vec<_>>(), [2, 5, 9]);
    }
}
