//! Replication: turns the full simulation output (every world, every tick)
//! into per-world message FEEDS that viewers subscribe to. The "featured"
//! virtual feed composes the director-driven broadcast on top: it forwards
//! the featured world's stream, splices in global announcements from the
//! other worlds, and emits a fresh snapshot whenever the feature changes.
//! With IDLIN_RECORD set, every world's exact wire stream is journaled to
//! disk as a replayable recording.

use crate::director::{Director, WorldView};
use crate::runner::TickBatch;
use idlin_protocol::{
    EntityKind, EntityMove, EntityPatch, EntityState, GameEvent, HitFx, ObstacleState,
    ProjectileFx, S2C, SkillFx,
};
use idlin_sim::{EntityView, KIND_CHARACTER, KIND_MONSTER, SimEvent};
use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, RwLock};
use tokio::sync::{broadcast, mpsc, watch};
use tracing::{info, warn};

/// Frames queued behind the replication task before we start complaining.
/// The tick→replication channel is unbounded so a slow consumer can never
/// stall the sim thread; the price is that a backlog grows silently — so
/// it must not stay silent.
const BACKLOG_WARN_FRAMES: usize = 50;

/// Pre-serialized message broadcast to every connected client.
pub type Frame = Arc<str>;

/// One subscribable feed: live messages plus the latest snapshot for
/// joining and lag-recovery.
#[derive(Clone)]
pub struct FeedHandle {
    pub broadcast: broadcast::Sender<Frame>,
    pub snapshot: watch::Receiver<Frame>,
}

/// Where everyone is: sockets use this to follow a character's world
/// across transfers.
#[derive(Clone, Default)]
pub struct Routing {
    /// The current featured world key (informational; the featured FEED is
    /// already composed server-side, so sockets don't route with this yet).
    #[allow(dead_code)]
    pub featured: String,
    /// Character name → world key.
    pub by_character: HashMap<String, String>,
}

pub struct ReplicationHandles {
    /// The featured (director-driven) virtual feed — the default broadcast.
    pub featured: FeedHandle,
    /// Per-world feeds, created as worlds first report.
    pub feeds: Arc<RwLock<HashMap<String, FeedHandle>>>,
    /// Live routing table (featured key + character locations).
    pub routing: watch::Receiver<Routing>,
}

/// Per-world replication state (diff continuity, snapshot, recorder).
struct WorldState {
    prev: HashMap<u32, EntityState>,
    snap_tx: watch::Sender<Frame>,
    tx: broadcast::Sender<Frame>,
    recorder: Option<std::fs::File>,
}

/// One world's already-serialized output for this tick, kept so the
/// featured feed can be composed AFTER the director has watched every
/// world and chosen where the camera lives.
struct FrameOut {
    key: String,
    delta: Frame,
    snapshot: Frame,
    events: Vec<GameEvent>,
}

/// Events worth splicing onto the featured feed even when they happened
/// in a world the camera isn't watching.
fn is_announcement(ev: &GameEvent) -> bool {
    matches!(
        ev,
        GameEvent::CharacterDeparted { .. }
            | GameEvent::CharacterJoined { .. }
            | GameEvent::Narration { .. }
    )
}

pub fn spawn_replication(mut batches: mpsc::UnboundedReceiver<TickBatch>) -> ReplicationHandles {
    let (featured_tx, _) = broadcast::channel::<Frame>(256);
    let (featured_snap_tx, featured_snap_rx) =
        watch::channel::<Frame>(Arc::from(empty_snapshot("connecting…", 65536, 65536, &[])));
    let feeds: Arc<RwLock<HashMap<String, FeedHandle>>> = Arc::new(RwLock::new(HashMap::new()));
    let (routing_tx, routing_rx) = watch::channel(Routing::default());

    let featured_handle = FeedHandle {
        broadcast: featured_tx.clone(),
        snapshot: featured_snap_rx.clone(),
    };
    let feeds_task = feeds.clone();
    let record = std::env::var("IDLIN_RECORD").is_ok();

    tokio::spawn(async move {
        let mut worlds: HashMap<String, WorldState> = HashMap::new();
        let mut director = Director::new();
        let mut featured_key: Option<String> = None;
        while let Some(batch) = batches.recv().await {
            let backlog = batches.len();
            if backlog > BACKLOG_WARN_FRAMES {
                warn!("replication is {backlog} ticks behind the sim");
            }

            let mut routing = Routing {
                featured: String::new(),
                by_character: HashMap::new(),
            };
            let mut outs: Vec<FrameOut> = Vec::with_capacity(batch.frames.len());
            // The director's view of each world: (net id, name) for every
            // character there this tick — corpses included; a dead idler
            // awaiting respawn is still the story.
            let mut roster: Vec<Vec<(u32, String)>> = Vec::with_capacity(batch.frames.len());

            for frame in &batch.frames {
                // Lazily create this world's feed + state.
                if !worlds.contains_key(&frame.world_key) {
                    let (tx, _) = broadcast::channel::<Frame>(256);
                    let (snap_tx, snap_rx) = watch::channel::<Frame>(Arc::from(empty_snapshot(
                        &frame.zone_name,
                        frame.zone_width,
                        frame.zone_height,
                        &frame.obstacles,
                    )));
                    feeds_task.write().expect("feeds lock").insert(
                        frame.world_key.clone(),
                        FeedHandle {
                            broadcast: tx.clone(),
                            snapshot: snap_rx,
                        },
                    );
                    let recorder = if record {
                        open_recorder(&frame.world_key)
                    } else {
                        None
                    };
                    worlds.insert(
                        frame.world_key.clone(),
                        WorldState {
                            prev: HashMap::new(),
                            snap_tx,
                            tx,
                            recorder,
                        },
                    );
                    info!("world feed online: {}", frame.world_key);
                }
                let ws = worlds.get_mut(&frame.world_key).expect("just inserted");

                let mut current: HashMap<u32, EntityState> =
                    HashMap::with_capacity(frame.views.len());
                for v in &frame.views {
                    current.insert(v.id, to_state(v));
                    if v.kind == KIND_CHARACTER {
                        routing
                            .by_character
                            .insert(v.name.clone(), frame.world_key.clone());
                    }
                }

                let (spawned, moved, updated, removed) = diff(&ws.prev, &current);
                let delta = serialize(&S2C::ZoneDelta {
                    tick: frame.tick,
                    spawned,
                    moved,
                    updated,
                    removed,
                    hits: collect_hits(&frame.events),
                    projectiles: collect_projectiles(&frame.events),
                    skills: collect_skills(&frame.events),
                });
                let events: Vec<GameEvent> =
                    frame.events.iter().filter_map(to_game_event).collect();
                let events_msg = if events.is_empty() {
                    None
                } else {
                    Some(serialize(&S2C::Events {
                        events: events.clone(),
                    }))
                };

                // Snapshot for this world (joiners + lag resync).
                let mut entities: Vec<EntityState> = current.values().cloned().collect();
                entities.sort_by_key(|s| s.id);
                let snapshot = serialize(&S2C::ZoneSnapshot {
                    tick: frame.tick,
                    zone_name: frame.zone_name.clone(),
                    width: frame.zone_width,
                    height: frame.zone_height,
                    obstacles: frame.obstacles.clone(),
                    entities,
                });

                // The recording IS the wire stream: snapshot first, then
                // every delta and event line — replayable verbatim.
                if let Some(f) = ws.recorder.as_mut() {
                    if ws.prev.is_empty() {
                        let _ = writeln!(f, "{snapshot}");
                    }
                    let _ = writeln!(f, "{delta}");
                    if let Some(ev) = &events_msg {
                        let _ = writeln!(f, "{ev}");
                    }
                }

                let _ = ws.tx.send(delta.clone());
                if let Some(ev) = &events_msg {
                    let _ = ws.tx.send(ev.clone());
                }
                let _ = ws.snap_tx.send(snapshot.clone());
                ws.prev = current;

                roster.push(
                    frame
                        .views
                        .iter()
                        .filter(|v| v.kind == KIND_CHARACTER)
                        .map(|v| (v.id, v.name.clone()))
                        .collect(),
                );
                outs.push(FrameOut {
                    key: frame.world_key.clone(),
                    delta,
                    snapshot,
                    events,
                });
            }

            // The director watches EVERY world; the featured feed mirrors
            // whichever one it cues. The runner's most-characters hint only
            // seeds the camera before the first cue.
            let tick = batch.frames.iter().map(|f| f.tick).max().unwrap_or(0);
            let views: Vec<WorldView<'_>> = batch
                .frames
                .iter()
                .zip(&roster)
                .map(|(f, ch)| WorldView {
                    key: &f.world_key,
                    events: &f.events,
                    characters: ch,
                })
                .collect();
            let cue = director.update(tick, &views);
            let target = cue
                .as_ref()
                .map(|c| c.world_key.clone())
                .or_else(|| director.current_world.clone())
                .unwrap_or_else(|| batch.featured_key.clone());

            // -- compose the featured virtual feed --
            let featured_out = outs.iter().find(|o| o.key == target);
            if featured_key.as_deref() != Some(target.as_str()) {
                info!("featured world is now {target}");
                featured_key = Some(target.clone());
                if let Some(out) = featured_out {
                    let _ = featured_tx.send(out.snapshot.clone());
                }
            }
            if let Some(out) = featured_out {
                let _ = featured_tx.send(out.delta.clone());
            }
            // The featured world's full event stream, plus announcements
            // crossing over from everywhere else.
            let mut all_events: Vec<GameEvent> =
                featured_out.map(|o| o.events.clone()).unwrap_or_default();
            for out in &outs {
                if out.key != target {
                    all_events.extend(out.events.iter().filter(|e| is_announcement(e)).cloned());
                }
            }
            if !all_events.is_empty() {
                let _ = featured_tx.send(serialize(&S2C::Events { events: all_events }));
            }
            if let Some(cue) = cue {
                let _ = featured_tx.send(serialize(&S2C::DirectorCue {
                    focus: cue.focus,
                    reason: cue.reason,
                    hold_ticks: cue.hold_ticks,
                }));
            }
            if let Some(out) = featured_out {
                let _ = featured_snap_tx.send(out.snapshot.clone());
            }
            routing.featured = target;
            let _ = routing_tx.send(routing);
        }
        info!("tick batch channel closed; replication exiting");
    });

    ReplicationHandles {
        featured: featured_handle,
        feeds,
        routing: routing_rx,
    }
}

/// Open a JSONL journal for one world's wire stream.
fn open_recorder(world_key: &str) -> Option<std::fs::File> {
    let dir = std::path::Path::new("data/recordings");
    if let Err(e) = std::fs::create_dir_all(dir) {
        warn!("recordings dir: {e}");
        return None;
    }
    let name: String = world_key
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    match std::fs::File::create(dir.join(format!("{name}.jsonl"))) {
        Ok(f) => {
            info!("recording {world_key} → data/recordings/{name}.jsonl");
            Some(f)
        }
        Err(e) => {
            warn!("recorder for {world_key}: {e}");
            None
        }
    }
}

fn collect_hits(events: &[SimEvent]) -> Vec<HitFx> {
    events
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
        .collect()
}

fn collect_projectiles(events: &[SimEvent]) -> Vec<ProjectileFx> {
    events
        .iter()
        .filter_map(|ev| match ev {
            SimEvent::ProjectileSpawned {
                attacker,
                spell,
                x,
                y,
                vx,
                vy,
                range,
                dmg_type,
            } => Some(ProjectileFx {
                attacker: *attacker,
                spell: *spell,
                x: *x,
                y: *y,
                vx: *vx,
                vy: *vy,
                range: *range,
                dmg_type: *dmg_type,
            }),
            _ => None,
        })
        .collect()
}

fn collect_skills(events: &[SimEvent]) -> Vec<SkillFx> {
    events
        .iter()
        .filter_map(|ev| match ev {
            SimEvent::SkillFx {
                attacker,
                spell,
                shape,
                x,
                y,
                dx,
                dy,
                radius,
                range,
                dmg_type,
            } => Some(SkillFx {
                attacker: *attacker,
                spell: *spell,
                shape: *shape,
                x: *x,
                y: *y,
                dx: *dx,
                dy: *dy,
                radius: *radius,
                range: *range,
                dmg_type: *dmg_type,
            }),
            _ => None,
        })
        .collect()
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
                    || old.weapon_rarity != state.weapon_rarity
                    || old.gear != state.gear
                    || old.gear_rarity != state.gear_rarity
                {
                    updated.push(EntityPatch {
                        id: *id,
                        life_pct: state.life_pct,
                        level: state.level,
                        dead: state.dead,
                        kills: state.kills,
                        items: state.items,
                        weapon: state.weapon.clone(),
                        weapon_rarity: state.weapon_rarity,
                        gear: state.gear.clone(),
                        gear_rarity: state.gear_rarity.clone(),
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
        weapon_rarity: v.weapon_rarity,
        gear: v.gear.clone(),
        gear_rarity: v.gear_rarity.clone(),
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
            ..
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
        SimEvent::GemRejected {
            id,
            owner,
            gem,
            skill,
        } => GameEvent::GemRejected {
            id: *id,
            owner: owner.clone(),
            gem: gem.clone(),
            skill: skill.clone(),
        },
        SimEvent::CurrencyUsed {
            id,
            owner,
            currency,
            item,
        } => GameEvent::CurrencyUsed {
            id: *id,
            owner: owner.clone(),
            currency: currency.clone(),
            item: item.clone(),
        },
        SimEvent::Narration { target, text } => GameEvent::Narration {
            target: *target,
            text: text.clone(),
        },
        SimEvent::Speech { id, text } => GameEvent::Speech {
            id: *id,
            text: text.clone(),
        },
        SimEvent::CharacterDeparted { id, name, dest } => GameEvent::CharacterDeparted {
            id: *id,
            name: name.clone(),
            dest: dest.clone(),
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
        | SimEvent::SkillFx { .. }
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
            weapon_rarity: 0,
            gear: vec![],
            gear_rarity: vec![],
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
