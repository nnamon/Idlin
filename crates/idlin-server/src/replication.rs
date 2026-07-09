//! Replication: turns the full simulation output (every world, every tick)
//! into per-world message FEEDS that viewers subscribe to. The "featured"
//! virtual feed composes the director-driven broadcast on top: it forwards
//! the featured world's stream, splices in global announcements from the
//! other worlds, and emits a fresh snapshot whenever the feature changes.
//! With IDLIN_RECORD set, every world's exact wire stream is journaled to
//! disk as a replayable recording.

use crate::director::{Director, WorldView};
use crate::runner::{TickBatch, TickFrame};
use idlin_protocol::{
    EntityKind, EntityMove, EntityPatch, EntityState, FocusQueueEntry, GameEvent, HitFx,
    ProjectileFx, S2C, SkillFx, UseFx,
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
    /// The current featured world key — the director's choice, refreshed
    /// every tick. Sockets scope featured-feed inspections with it.
    pub featured: String,
    /// Character name → world key.
    pub by_character: HashMap<String, String>,
}

/// A camera-worthy moment (#148 A7): a boss fell. `line` is the world
/// journal's LINE COUNT at that instant — with IDLIN_RECORD on, the web
/// replay (`?replay=/recordings/<file>.jsonl&at=<line>`) fast-forwards
/// straight to it: a kill-cam on the deterministic replay affordance.
#[derive(Debug, Clone, serde::Serialize)]
pub struct KillCam {
    pub world_key: String,
    pub killer: String,
    pub monster: String,
    pub level: u32,
    /// The recording FILENAME stem (#148 A7 review B1): the raw world key
    /// is sanitized on disk ("#"/"@" → "_"), so the payload carries the
    /// exact name — `/?replay=/recordings/<recording>.jsonl&at=<line>`.
    pub recording: String,
    /// Journal lines written for this world when the kill landed (0 when
    /// recording is off — the moment still lists, it just can't deep-link).
    pub line: u64,
}

pub struct ReplicationHandles {
    /// The featured (director-driven) virtual feed — the default broadcast.
    pub featured: FeedHandle,
    /// Per-world feeds, created as worlds first report.
    pub feeds: Arc<RwLock<HashMap<String, FeedHandle>>>,
    /// Live routing table (featured key + character locations).
    pub routing: watch::Receiver<Routing>,
    /// The kill-cam ring (#148 A7) — GET /api/killcams serves it.
    pub killcams: Arc<std::sync::RwLock<std::collections::VecDeque<KillCam>>>,
}

/// Per-world replication state (diff continuity, snapshot, recorder).
struct WorldState {
    prev: HashMap<u32, EntityState>,
    /// Fog of war (#129): the union explored bitset as of the LAST frame —
    /// newly set bits become this tick's reveal delta. Seeded from the first
    /// frame (the snapshot already carries everything explored by then).
    prev_explored: Vec<u64>,
    snap_tx: watch::Sender<Frame>,
    tx: broadcast::Sender<Frame>,
    recorder: Option<std::fs::File>,
    /// Journal lines written so far (#148 A7): the kill-cam's seek anchor.
    journal_lines: u64,
}

/// Fog of war (#129/#134): THE single owner of wire visibility for one world
/// frame. Two tiers, matching the client fog: entities and positioned FX gate
/// on the residents' CURRENT sight (living characters' discs); layout — tiles,
/// props, exits, gates, and their change events — gates on the residents'
/// EXPLORED memory (terrain, once seen, stays). Every predicate lives here,
/// and `compose` below is the only place feed messages are built, so a new
/// data path cannot reach the wire without passing this type.
struct Visibility<'a> {
    /// Living characters' cells — the CURRENT sight sources. Characters always
    /// ship (they are the sources; a corpse is the viewer's own story), but
    /// dead ones project no sight, matching the sim's explore().
    sources: Vec<(i64, i64)>,
    /// The residents' union explored bitset (bit = y*zw + x).
    explored: &'a [u64],
    /// Zone width in cells.
    zw: i64,
}

impl<'a> Visibility<'a> {
    fn new(views: &[EntityView], explored: &'a [u64], zone_width_raw: i32) -> Visibility<'a> {
        Visibility {
            sources: views
                .iter()
                .filter(|v| v.kind == KIND_CHARACTER && !v.dead)
                .map(|v| ((v.x_raw >> 16) as i64, (v.y_raw >> 16) as i64))
                .collect(),
            explored,
            zw: (zone_width_raw >> 16) as i64,
        }
    }

    /// CURRENT sight: is a Q16.16 raw position within any living character's
    /// FOG_SIGHT_CELLS disc?
    fn sees_raw(&self, x_raw: i32, y_raw: i32) -> bool {
        const R: i64 = idlin_sim::FOG_SIGHT_CELLS as i64;
        let (x, y) = ((x_raw >> 16) as i64, (y_raw >> 16) as i64);
        self.sources.iter().any(|&(cx, cy)| {
            let (dx, dy) = (x - cx, y - cy);
            dx * dx + dy * dy <= R * R
        })
    }

    /// Does this entity go on the wire? Characters unconditionally; everything
    /// else only within current sight.
    fn keeps_entity(&self, v: &EntityView) -> bool {
        v.kind == KIND_CHARACTER || self.sees_raw(v.x_raw, v.y_raw)
    }

    /// EXPLORED memory: is this cell in a bitset? Out-of-range reads false — an
    /// off-map exit/prop can never leak through a bounds bug.
    fn cell_in(explored: &[u64], zw: i64, x: i64, y: i64) -> bool {
        if zw <= 0 || x < 0 || y < 0 || x >= zw {
            return false;
        }
        let bit = (y * zw + x) as usize;
        explored
            .get(bit / 64)
            .is_some_and(|word| word & (1 << (bit % 64)) != 0)
    }

    fn cell_explored(&self, x: i64, y: i64) -> bool {
        Self::cell_in(self.explored, self.zw, x, y)
    }

    /// A gate rect counts as explored when ANY of its cells is — a gate
    /// spanning the fog boundary is part of the discovered map.
    fn gate_in(explored: &[u64], zw: i64, x0: i32, y0: i32, x1: i32, y1: i32) -> bool {
        (y0..=y1).any(|y| (x0..=x1).any(|x| Self::cell_in(explored, zw, x as i64, y as i64)))
    }

    fn gate_explored(&self, x0: i32, y0: i32, x1: i32, y1: i32) -> bool {
        Self::gate_in(self.explored, self.zw, x0, y0, x1, y1)
    }

    /// An exit's bitset cell, or `usize::MAX` when off-map — which every bit
    /// test reads as never-explored. `ExitView` positions are raw Q16.16.
    fn exit_cell(&self, e: &idlin_protocol::ExitView) -> usize {
        let (x, y) = (((e.x >> 16) as i64), ((e.y >> 16) as i64));
        if x < 0 || y < 0 || x >= self.zw {
            return usize::MAX;
        }
        (y * self.zw + x) as usize
    }

    fn exit_explored(&self, e: &idlin_protocol::ExitView) -> bool {
        self.cell_explored((e.x >> 16) as i64, (e.y >> 16) as i64)
    }

    /// Newly discovered: set in this frame's explored, not in `prev`.
    fn newly(&self, prev: &[u64], bit: usize) -> bool {
        let (wi, m) = (bit / 64, 1u64 << (bit % 64));
        self.explored.get(wi).is_some_and(|w| w & m != 0) && prev.get(wi).is_none_or(|w| w & m == 0)
    }

    /// The tile cells newly explored this frame, with their TRUE glyphs — the
    /// reveal delta that un-masks the map as it is discovered.
    fn reveal_cells(
        &self,
        tiles: &idlin_protocol::TileMapState,
        prev: &[u64],
    ) -> Vec<idlin_protocol::RevealedCell> {
        let mut out = Vec::new();
        if self.zw <= 0 {
            return out;
        }
        for (wi, &cur) in self.explored.iter().enumerate() {
            let mut new_bits = cur & !prev.get(wi).copied().unwrap_or(0);
            while new_bits != 0 {
                let b = new_bits.trailing_zeros() as usize;
                new_bits &= new_bits - 1;
                let bit = (wi * 64 + b) as i64;
                let (x, y) = (bit % self.zw, bit / self.zw);
                if let Some(glyph) = tiles
                    .rows
                    .get(y as usize)
                    .and_then(|row| row.chars().nth(x as usize))
                {
                    out.push(idlin_protocol::RevealedCell {
                        x: x as i32,
                        y: y as i32,
                        glyph: glyph.to_string(),
                    });
                }
            }
        }
        out
    }

    /// May this event reach viewers? EXHAUSTIVE on purpose (#134): a NEW event
    /// variant refuses to compile until it makes a visibility decision here —
    /// a wildcard pass-through was fail-open for future positional events.
    fn event_visible(&self, ev: &GameEvent) -> bool {
        match ev {
            // Positional: gated on explored ground (the reveal delta carries
            // the current open state once the ground is found).
            GameEvent::ExitChanged { x, y, .. } => {
                self.cell_explored((x >> 16) as i64, (y >> 16) as i64)
            }
            GameEvent::GateChanged { x0, y0, x1, y1, .. } => self.gate_explored(*x0, *y0, *x1, *y1),
            // Non-positional narration/progress chatter: names and levels only
            // (the accepted union-of-residents knowledge, #129).
            GameEvent::CharacterJoined { .. }
            | GameEvent::CharacterDied { .. }
            | GameEvent::CharacterRespawned { .. }
            | GameEvent::LevelUp { .. }
            | GameEvent::MonsterKilled { .. }
            | GameEvent::LootDropped { .. }
            | GameEvent::ItemPickedUp { .. }
            | GameEvent::ItemEquipped { .. }
            | GameEvent::PassiveAllocated { .. }
            | GameEvent::GemSocketed { .. }
            | GameEvent::GemRejected { .. }
            | GameEvent::CurrencyUsed { .. }
            | GameEvent::Narration { .. }
            | GameEvent::Speech { .. }
            | GameEvent::CharacterDeparted { .. }
            | GameEvent::BuildDeclared { .. }
            | GameEvent::TreeRespecced { .. }
            | GameEvent::GearShed { .. }
            | GameEvent::BuildRejected { .. }
            | GameEvent::GemLevelUp { .. }
            | GameEvent::ActCompleted { .. }
            | GameEvent::CharacterRemoved { .. }
            | GameEvent::VoyageTally { .. } => true,
        }
    }

    /// The MASKED tile map a snapshot ships — unexplored glyphs blanked to ' '
    /// (the data is absent from the wire, not client-hidden), props on
    /// unexplored cells dropped. The legend stays whole: vocabulary, not
    /// positions.
    fn mask_tiles(&self, tiles: &idlin_protocol::TileMapState) -> idlin_protocol::TileMapState {
        let mut out = tiles.clone();
        for (y, row) in out.rows.iter_mut().enumerate() {
            *row = row
                .chars()
                .enumerate()
                .map(|(x, g)| {
                    if self.cell_explored(x as i64, y as i64) {
                        g
                    } else {
                        ' '
                    }
                })
                .collect();
        }
        out.props
            .retain(|p| self.cell_explored(p.x_u as i64, p.y_u as i64));
        out
    }
}

/// One world's composed wire output for a tick. Only `compose` builds these.
struct ComposedFeed {
    delta: Frame,
    snapshot: Frame,
    events: Vec<GameEvent>,
    events_msg: Option<Frame>,
    /// True when this was the feed's first composed frame (drives the
    /// recording's leading snapshot line).
    first_frame: bool,
}

/// Fog of war (#134): THE single constructor of world-feed wire messages. The
/// frame is destructured EXHAUSTIVELY — adding a field to `TickFrame` refuses
/// to compile until this function classifies it as visible or masked — and
/// every filter it applies is a `Visibility` method, the one policy owner.
fn compose(frame: &TickFrame, ws: &mut WorldState) -> ComposedFeed {
    let TickFrame {
        world_key,
        tick,
        zone_name,
        zone_level,
        zone_width,
        zone_height,
        tiles,
        exits,
        gates,
        views,
        events,
        explored,
    } = frame;
    let vis = Visibility::new(views, explored, *zone_width);

    // Entities: filtered BEFORE the prev-diff, so entering/leaving sight rides
    // the existing spawned/removed machinery; the snapshot shares the map.
    let mut current: HashMap<u32, EntityState> = HashMap::with_capacity(views.len());
    for v in views.iter().filter(|v| vis.keeps_entity(v)) {
        current.insert(v.id, to_state(v));
    }
    let (spawned, moved, updated, removed) = diff(&ws.prev, &current);

    // Positioned FX gate on CURRENT sight; a hit (it carries no coordinates)
    // ships when either party is on the wire — a visible victim struck from
    // the dark still flinches.
    let mut hits = collect_hits(events);
    hits.retain(|h| current.contains_key(&h.attacker) || current.contains_key(&h.target));
    let mut projectiles = collect_projectiles(events);
    projectiles.retain(|p| vis.sees_raw(p.x, p.y));
    let mut skills = collect_skills(events);
    skills.retain(|s| vis.sees_raw(s.x, s.y));
    let mut uses = collect_uses(events);
    uses.retain(|u| vis.sees_raw(u.x, u.y));

    // Layout gates on EXPLORED memory: the snapshot ships masked, and newly
    // explored ground streams as a reveal delta with its true glyphs. A
    // stale-length baseline (never expected — a world keeps its zone)
    // degrades to everything-new.
    let prev: &[u64] = if ws.prev_explored.len() == explored.len() {
        &ws.prev_explored
    } else {
        &[]
    };
    let mut revealed = Vec::new();
    let mut revealed_props = Vec::new();
    if let Some(tiles) = tiles.as_deref() {
        revealed = vis.reveal_cells(tiles, prev);
        revealed_props = tiles
            .props
            .iter()
            .filter(|p| {
                let (x, y) = (p.x_u as i64, p.y_u as i64);
                x >= 0 && x < vis.zw && y >= 0 && vis.newly(prev, (y * vis.zw + x) as usize)
            })
            .cloned()
            .collect();
    }
    let revealed_exits: Vec<_> = exits
        .iter()
        .filter(|e| vis.newly(prev, vis.exit_cell(e)))
        .cloned()
        .collect();
    let revealed_gates: Vec<_> = gates
        .iter()
        .filter(|g| {
            vis.gate_explored(g.x0, g.y0, g.x1, g.y1)
                && !Visibility::gate_in(prev, vis.zw, g.x0, g.y0, g.x1, g.y1)
        })
        .cloned()
        .collect();
    ws.prev_explored = explored.clone();

    let delta = serialize(&S2C::ZoneDelta {
        tick: *tick,
        spawned,
        moved,
        updated,
        removed,
        hits,
        projectiles,
        skills,
        uses,
        revealed,
        revealed_props,
        revealed_exits,
        revealed_gates,
    });

    let events_out: Vec<GameEvent> = events
        .iter()
        .filter_map(to_game_event)
        .filter(|ev| vis.event_visible(ev))
        .collect();
    let events_msg = if events_out.is_empty() {
        None
    } else {
        Some(serialize(&S2C::Events {
            events: events_out.clone(),
        }))
    };

    // Snapshot (joiners + lag resync): the same filtered entity map, masked
    // tiles, and explored-gated exits/gates.
    let mut entities: Vec<EntityState> = current.values().cloned().collect();
    entities.sort_by_key(|s| s.id);
    let snapshot = serialize(&S2C::ZoneSnapshot {
        tick: *tick,
        zone_name: zone_name.clone(),
        zone_level: *zone_level,
        world_key: world_key.clone(),
        width: *zone_width,
        height: *zone_height,
        tiles: tiles.as_deref().map(|t| vis.mask_tiles(t)),
        exits: exits
            .iter()
            .filter(|e| vis.exit_explored(e))
            .cloned()
            .collect(),
        gates: gates
            .iter()
            .filter(|g| vis.gate_explored(g.x0, g.y0, g.x1, g.y1))
            .cloned()
            .collect(),
        entities,
    });

    let first_frame = ws.prev.is_empty();
    ws.prev = current;
    ComposedFeed {
        delta,
        snapshot,
        events: events_out,
        events_msg,
        first_frame,
    }
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
            | GameEvent::ActCompleted { .. }
    )
}

pub fn spawn_replication(mut batches: mpsc::UnboundedReceiver<TickBatch>) -> ReplicationHandles {
    let (featured_tx, _) = broadcast::channel::<Frame>(256);
    let (featured_snap_tx, featured_snap_rx) =
        watch::channel::<Frame>(Arc::from(empty_snapshot("connecting…", 65536, 65536)));
    let feeds: Arc<RwLock<HashMap<String, FeedHandle>>> = Arc::new(RwLock::new(HashMap::new()));
    let (routing_tx, routing_rx) = watch::channel(Routing::default());

    let featured_handle = FeedHandle {
        broadcast: featured_tx.clone(),
        snapshot: featured_snap_rx.clone(),
    };
    let feeds_task = feeds.clone();
    let record = std::env::var("IDLIN_RECORD").is_ok();
    let killcams: Arc<std::sync::RwLock<std::collections::VecDeque<KillCam>>> =
        Arc::new(std::sync::RwLock::new(std::collections::VecDeque::new()));
    let killcams_task = killcams.clone();

    tokio::spawn(async move {
        let mut worlds: HashMap<String, WorldState> = HashMap::new();
        let mut director = Director::new();
        let mut featured_key: Option<String> = None;
        let mut last_queue: Option<Frame> = None;
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
            // Focus-queue dressing: name → (level, dead, zone display name).
            let mut char_info: HashMap<String, (u32, bool, String)> = HashMap::new();

            for frame in &batch.frames {
                // Lazily create this world's feed + state.
                if !worlds.contains_key(&frame.world_key) {
                    let (tx, _) = broadcast::channel::<Frame>(256);
                    let (snap_tx, snap_rx) = watch::channel::<Frame>(Arc::from(empty_snapshot(
                        &frame.zone_name,
                        frame.zone_width,
                        frame.zone_height,
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
                            // Baseline = this frame's explored: everything
                            // discovered by now rides the SNAPSHOT; reveals
                            // stream only what is discovered from here on.
                            prev_explored: frame.explored.clone(),
                            snap_tx,
                            tx,
                            recorder,
                            journal_lines: 0,
                        },
                    );
                    info!("world feed online: {}", frame.world_key);
                }
                let ws = worlds.get_mut(&frame.world_key).expect("just inserted");

                // ONE chokepoint (#134): every wire message this feed emits is
                // built inside compose(), which destructures the frame
                // exhaustively and filters through the Visibility policy.
                let out = compose(frame, ws);

                // The recording IS the wire stream: snapshot first, then
                // every delta and event line — replayable verbatim.
                if let Some(f) = ws.recorder.as_mut() {
                    if out.first_frame {
                        let _ = writeln!(f, "{}", out.snapshot);
                        ws.journal_lines += 1;
                    }
                    let _ = writeln!(f, "{}", out.delta);
                    ws.journal_lines += 1;
                    if let Some(ev) = &out.events_msg {
                        let _ = writeln!(f, "{ev}");
                        ws.journal_lines += 1;
                    }
                }
                // Kill-cams (#148 A7): a boss kill marks the journal line so
                // the replay page can jump straight to the fight's end.
                for ev in &frame.events {
                    if let idlin_sim::SimEvent::MonsterKilled {
                        killer,
                        monster,
                        level,
                        rarity: idlin_sim::Rarity::Unique,
                        ..
                    } = ev
                    {
                        let mut cams = killcams_task.write().expect("killcams lock");
                        cams.push_back(KillCam {
                            world_key: frame.world_key.clone(),
                            recording: recording_stem(&frame.world_key),
                            killer: killer.clone(),
                            monster: monster.clone(),
                            level: *level,
                            // ~450 lines ≈ 15-20s of 10Hz journal (2-3 lines/frame):
                            // a kill-cam needs the FIGHT, not just the corpse
                            // (the first cut, 60, replayed ~2 seconds).
                            line: ws.journal_lines.saturating_sub(450),
                        });
                        if cams.len() > 50 {
                            cams.pop_front();
                        }
                    }
                }

                let _ = ws.tx.send(out.delta.clone());
                if let Some(ev) = &out.events_msg {
                    let _ = ws.tx.send(ev.clone());
                }
                let _ = ws.snap_tx.send(out.snapshot.clone());

                roster.push(
                    frame
                        .views
                        .iter()
                        .filter(|v| v.kind == KIND_CHARACTER)
                        .map(|v| {
                            char_info
                                .insert(v.name.clone(), (v.level, v.dead, frame.zone_name.clone()));
                            routing
                                .by_character
                                .insert(v.name.clone(), frame.world_key.clone());
                            (v.id, v.name.clone())
                        })
                        .collect(),
                );
                outs.push(FrameOut {
                    key: frame.world_key.clone(),
                    delta: out.delta,
                    snapshot: out.snapshot,
                    events: out.events,
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
            let cue_emitted = cue.is_some();
            if let Some(cue) = cue {
                let _ = featured_tx.send(serialize(&S2C::DirectorCue {
                    focus: cue.focus,
                    reason: cue.reason,
                    hold_ticks: cue.hold_ticks,
                }));
            }
            // The focus queue rides the featured feed: on change, and with
            // every cue so late joiners get it within one refresh beat.
            let entries: Vec<FocusQueueEntry> = director
                .focus_queue(tick, &views)
                .into_iter()
                .map(|q| {
                    let (level, dead, zone) = char_info.get(&q.name).cloned().unwrap_or_default();
                    FocusQueueEntry {
                        name: q.name,
                        zone,
                        level,
                        dead,
                        focused: q.focused,
                        cooldown: q.on_cooldown,
                    }
                })
                .collect();
            let queue_msg = serialize(&S2C::FocusQueue { entries });
            if cue_emitted || last_queue.as_deref() != Some(&*queue_msg) {
                let _ = featured_tx.send(queue_msg.clone());
                last_queue = Some(queue_msg);
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
        killcams,
        featured: featured_handle,
        feeds,
        routing: routing_rx,
    }
}

/// Open a JSONL journal for one world's wire stream.
/// A world key as its recording filename stem (#148 A7): the ONE sanitizer
/// both the recorder and the kill-cam payload use — the deep-link must be
/// mechanically constructible from the API response.
pub fn recording_stem(world_key: &str) -> String {
    world_key
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect()
}

fn open_recorder(world_key: &str) -> Option<std::fs::File> {
    let dir = std::path::Path::new("data/recordings");
    if let Err(e) = std::fs::create_dir_all(dir) {
        warn!("recordings dir: {e}");
        return None;
    }
    let name = recording_stem(world_key);
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
                stun,
                freeze,
            } => Some(HitFx {
                attacker: *attacker,
                target: *target,
                amount: (*amount).clamp(0, i32::MAX as i64) as i32,
                dmg_type: *dmg_type,
                crit: *crit,
                dot: *dot,
                projectile: *projectile,
                killed: *killed,
                stun: *stun,
                freeze: *freeze,
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

fn collect_uses(events: &[SimEvent]) -> Vec<UseFx> {
    events
        .iter()
        .filter_map(|ev| match ev {
            SimEvent::UseStarted {
                id,
                spell,
                x,
                y,
                use_ticks,
                contact_ticks,
            } => Some(UseFx {
                attacker: *id,
                spell: *spell,
                x: *x,
                y: *y,
                use_ticks: *use_ticks,
                contact_ticks: *contact_ticks,
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
                    || old.es_pct != state.es_pct
                    || old.level != state.level
                    || old.dead != state.dead
                    || old.kills != state.kills
                    || old.items != state.items
                    || old.weapon != state.weapon
                    || old.weapon_rarity != state.weapon_rarity
                    || old.gear != state.gear
                    || old.gear_rarity != state.gear_rarity
                    || old.ailments != state.ailments
                {
                    updated.push(EntityPatch {
                        id: *id,
                        life_pct: state.life_pct,
                        es_pct: state.es_pct,
                        level: state.level,
                        dead: state.dead,
                        kills: state.kills,
                        items: state.items,
                        weapon: state.weapon.clone(),
                        weapon_rarity: state.weapon_rarity,
                        gear: state.gear.clone(),
                        gear_rarity: state.gear_rarity.clone(),
                        ailments: state.ailments,
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

fn empty_snapshot(zone_name: &str, width: i32, height: i32) -> String {
    serde_json::to_string(&S2C::ZoneSnapshot {
        tick: 0,
        zone_name: zone_name.to_string(),
        zone_level: 1,
        world_key: String::new(),
        width,
        height,
        tiles: None,
        exits: vec![],
        gates: vec![],
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
        es_pct: v.es_pct,
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
        ailments: v.ailments,
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
        SimEvent::CharacterRemoved { net_id, name } => GameEvent::CharacterRemoved {
            id: *net_id,
            name: name.clone(),
        },
        SimEvent::VoyageTally {
            id,
            name,
            kills,
            deaths,
            items,
            ticks,
        } => GameEvent::VoyageTally {
            id: *id,
            name: name.clone(),
            kills: *kills,
            deaths: *deaths,
            items: *items,
            ticks: *ticks,
        },
        SimEvent::CharacterRespawned { id } => GameEvent::CharacterRespawned { id: *id },
        SimEvent::GateChanged {
            x0,
            y0,
            x1,
            y1,
            open,
        } => GameEvent::GateChanged {
            x0: *x0,
            y0: *y0,
            x1: *x1,
            y1: *y1,
            open: *open,
        },
        SimEvent::ActCompleted { id, name, act } => GameEvent::ActCompleted {
            id: *id,
            name: name.clone(),
            act: *act,
        },
        SimEvent::ExitChanged { x, y, open } => GameEvent::ExitChanged {
            x: *x,
            y: *y,
            open: *open,
        },
        SimEvent::LevelUp { id, name, level } => GameEvent::LevelUp {
            id: *id,
            name: name.clone(),
            level: *level,
        },
        SimEvent::MonsterKilled {
            rarity,
            killer_id,
            killer,
            monster,
            level,
            ..
        } => GameEvent::MonsterKilled {
            killer_id: *killer_id,
            killer: killer.clone(),
            rarity: *rarity as u8,
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
        SimEvent::TreeRespecced { id, owner } => GameEvent::TreeRespecced {
            id: *id,
            owner: owner.clone(),
        },
        SimEvent::GearShed { id, owner, item } => GameEvent::GearShed {
            id: *id,
            owner: owner.clone(),
            item: item.clone(),
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
        | SimEvent::UseStarted { .. }
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
            es_pct: -1,
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
            ailments: 0,
        }
    }

    fn keyed(states: Vec<EntityState>) -> HashMap<u32, EntityState> {
        states.into_iter().map(|s| (s.id, s)).collect()
    }

    /// An `EntityView` at a sim-cell position (Q16.16 raw = cell << 16).
    fn view(id: u32, kind: u8, x: i64, y: i64, dead: bool) -> idlin_sim::EntityView {
        idlin_sim::EntityView {
            id,
            kind,
            x_raw: (x as i32) << 16,
            y_raw: (y as i32) << 16,
            life_pct: if dead { 0 } else { 100 },
            es_pct: -1,
            level: 1,
            name: format!("v{id}"),
            model: "idler".into(),
            weapon: String::new(),
            weapon_rarity: 0,
            gear: vec![],
            gear_rarity: vec![],
            rarity: 0,
            dead,
            kills: 0,
            items: 0,
            ailments: 0,
        }
    }

    /// A 4×2 tile map: rows "abcd"/"efgh", one prop per corner cell.
    fn tiny_tiles() -> idlin_protocol::TileMapState {
        let prop = |x: i32, y: i32| idlin_protocol::PropState {
            model: "barrel".into(),
            x_u: x,
            y_u: y,
            rot_deg: 0,
        };
        idlin_protocol::TileMapState {
            width: 4,
            height: 2,
            rows: vec!["abcd".into(), "efgh".into()],
            legend: vec![],
            props: vec![prop(0, 0), prop(3, 1)],
            features: vec![],
        }
    }

    /// Bits for a 4-wide grid: cell (x,y) = bit y*4+x, all in word 0.
    fn bits(cells: &[(i64, i64)]) -> Vec<u64> {
        let mut w = 0u64;
        for &(x, y) in cells {
            w |= 1 << (y * 4 + x);
        }
        vec![w]
    }

    /// A Visibility over a 4-wide grid with NO sight sources — the explored/
    /// layout predicates under test don't read current sight.
    fn vis(explored: &[u64]) -> Visibility<'_> {
        Visibility {
            sources: vec![],
            explored,
            zw: 4,
        }
    }

    #[test]
    fn snapshot_masks_unexplored_tiles_props_exits_and_gates() {
        // #129 stage 2b: a snapshot must not carry unexplored layout in ANY
        // form — glyphs blank to ' ', props on unexplored cells drop, and the
        // explored/gate predicates gate exits and gate rects. Mutations: skip
        // the row masking → 'd' leaks; skip the props retain → the far barrel
        // leaks; break gate_explored's any-cell rule → the spanning gate hides.
        let tiles = tiny_tiles();
        let explored = bits(&[(0, 0), (1, 0), (0, 1)]); // top-left corner only
        let masked = vis(&explored).mask_tiles(&tiles);
        assert_eq!(masked.rows, vec!["ab  ".to_string(), "e   ".to_string()]);
        assert_eq!(masked.props.len(), 1, "only the explored-corner prop ships");
        assert_eq!(masked.props[0].x_u, 0);
        assert_eq!(
            masked.legend.len(),
            tiles.legend.len(),
            "the legend is vocabulary, not positions"
        );
        // Exit/gate predicates.
        assert!(vis(&explored).cell_explored(1, 0));
        assert!(!vis(&explored).cell_explored(3, 1));
        assert!(
            !vis(&explored).cell_explored(-1, 0),
            "off-map is never explored"
        );
        assert!(
            vis(&explored).gate_explored(1, 0, 3, 1),
            "a gate rect spanning the fog boundary counts as explored (any cell)"
        );
        assert!(
            !vis(&explored).gate_explored(2, 1, 3, 1),
            "a fully dark rect does not"
        );
    }

    #[test]
    fn act_completed_reaches_the_wire_and_the_featured_splice() {
        // #136: the campaign's biggest beat must map to the wire, pass the
        // visibility gate (non-positional), and splice onto the featured feed
        // as an announcement. Mutations: drop the to_game_event arm → None
        // here; drop the announcement arm → the splice assert fails.
        let ev = SimEvent::ActCompleted {
            id: 7,
            name: "Vex".into(),
            act: 1,
        };
        let wire = to_game_event(&ev).expect("ActCompleted maps to the wire");
        match &wire {
            GameEvent::ActCompleted {
                id: 7,
                name,
                act: 1,
            } => assert_eq!(name, "Vex"),
            other => panic!("wrong mapping: {other:?}"),
        }
        assert!(
            vis(&[]).event_visible(&wire),
            "non-positional: visible even with nothing explored"
        );
        assert!(
            is_announcement(&wire),
            "an act completion is broadcast-worthy cross-world"
        );
    }

    #[test]
    fn positioned_events_and_exits_gate_on_explored_ground() {
        // #129 stage 2b: gate/exit CHANGE events are dropped until their ground
        // is explored (they carry positions), other events always pass, and the
        // exit-cell sentinel maps off-map exits to never-explored. Mutations:
        // flip event_visible's predicate sense → the dark-exit assert fails;
        // drop the exit_cell bounds guard → the off-map exit aliases cell 0
        // (which IS explored here) and the sentinel assert fails.
        let explored = bits(&[(0, 0), (1, 0)]);
        let exit_ev = |x: i32, y: i32| GameEvent::ExitChanged {
            x: x << 16,
            y: y << 16,
            open: true,
        };
        assert!(
            vis(&explored).event_visible(&exit_ev(1, 0)),
            "explored exit event passes"
        );
        assert!(
            !vis(&explored).event_visible(&exit_ev(3, 1)),
            "dark exit event is dropped"
        );
        let gate_ev = GameEvent::GateChanged {
            x0: 1,
            y0: 0,
            x1: 3,
            y1: 1,
            open: false,
        };
        assert!(
            vis(&explored).event_visible(&gate_ev),
            "a gate rect touching explored ground passes (any-cell rule)"
        );
        let dark_gate = GameEvent::GateChanged {
            x0: 2,
            y0: 1,
            x1: 3,
            y1: 1,
            open: false,
        };
        assert!(
            !vis(&explored).event_visible(&dark_gate),
            "a fully dark gate is dropped"
        );
        let other = GameEvent::CharacterJoined {
            id: 1,
            name: "Vex".into(),
        };
        assert!(
            vis(&explored).event_visible(&other),
            "non-positional events always pass"
        );
        // The exit-cell sentinel: off-map coordinates never read as explored.
        let exit = |x: i32, y: i32| idlin_protocol::ExitView {
            x: x << 16,
            y: y << 16,
            open: true,
        };
        assert_eq!(vis(&explored).exit_cell(&exit(1, 0)), 1);
        assert_eq!(
            vis(&explored).exit_cell(&exit(-1, 0)),
            usize::MAX,
            "negative x is off-map"
        );
        assert_eq!(
            vis(&explored).exit_cell(&exit(0, -1)),
            usize::MAX,
            "negative y is off-map"
        );
        assert_eq!(
            vis(&explored).exit_cell(&exit(4, 0)),
            usize::MAX,
            "x >= width is off-map"
        );
        assert!(!vis(&explored).newly(&[], vis(&explored).exit_cell(&exit(-1, 0))));
    }

    #[test]
    fn reveal_delta_streams_only_newly_explored_cells_with_true_glyphs() {
        // #129 stage 2b: the reveal delta is exactly explored & !prev, carrying
        // TRUE glyphs. Mutations: diff against nothing → old cells re-reveal
        // every tick; read the masked rows → blanks stream instead of glyphs.
        let tiles = tiny_tiles();
        let prev = bits(&[(0, 0), (1, 0)]);
        let now = bits(&[(0, 0), (1, 0), (2, 0), (3, 1)]);
        let v = Visibility {
            sources: vec![],
            explored: &now,
            zw: 4,
        };
        let mut cells = v.reveal_cells(&tiles, &prev);
        cells.sort_by_key(|c| (c.y, c.x));
        let flat: Vec<(i32, i32, &str)> =
            cells.iter().map(|c| (c.x, c.y, c.glyph.as_str())).collect();
        assert_eq!(
            flat,
            [(2, 0, "c"), (3, 1, "h")],
            "only the new cells, true glyphs"
        );
        // Steady state: nothing new → nothing streamed.
        assert!(v.reveal_cells(&tiles, &now).is_empty());
        // First frame against an empty baseline: everything explored streams.
        assert_eq!(v.reveal_cells(&tiles, &[]).len(), 4);
        // newly_explored agrees with the same window (drives props/exits).
        assert!(v.newly(&prev, 2)); // cell (2,0)
        assert!(!v.newly(&prev, 0)); // already known
        assert!(!v.newly(&prev, usize::MAX / 2), "far off-map is never new");
    }

    #[test]
    fn sight_filter_gates_by_living_characters_sight() {
        // #129 Layer B: the wire carries characters unconditionally, and
        // monsters/loot ONLY within a living character's FOG_SIGHT_CELLS disc.
        // A dead character ships but projects NO sight. Mutations: drop the
        // `!v.dead` source gate → the far monster near the corpse leaks; keep
        // entities regardless of sight → both far entities leak.
        const R: i64 = idlin_sim::FOG_SIGHT_CELLS as i64; // 28
        let views = vec![
            view(1, idlin_sim::KIND_CHARACTER, 30, 30, false), // living scout
            view(2, idlin_sim::KIND_CHARACTER, 150, 30, true), // distant corpse
            view(3, idlin_sim::KIND_MONSTER, 30 + R - 1, 30, false), // in sight
            view(4, idlin_sim::KIND_MONSTER, 30 + R + 2, 30, false), // beyond sight
            view(5, idlin_sim::KIND_MONSTER, 150 + 2, 30, false), // near ONLY the corpse
            view(6, 3, 150, 32, false),                        // loot near only the corpse
        ];
        let sight = Visibility::new(&views, &[], 200 << 16);
        let kept: Vec<u32> = views
            .iter()
            .filter(|v| sight.keeps_entity(v))
            .map(|v| v.id)
            .collect();
        assert_eq!(
            kept,
            [1, 2, 3],
            "characters always ship; only the in-sight monster joins them"
        );
        // Positioned-FX gating uses the same discs.
        assert!(sight.sees_raw(30 << 16, (30 + R as i32 - 1) << 16));
        assert!(
            !sight.sees_raw((150 + 2) << 16, 30 << 16),
            "no sight around a corpse"
        );
    }

    #[test]
    fn leaving_sight_rides_the_diff_as_removed() {
        // #129: filtering CURRENT before the diff makes an entity that walks out
        // of sight emit a natural `removed` (and re-entering emits `spawned`) —
        // no bespoke enter/leave machinery to drift. Mutation: filter only the
        // snapshot (not current) → no removed here.
        let scout = |mx: i64| -> HashMap<u32, EntityState> {
            let views = vec![
                view(1, idlin_sim::KIND_CHARACTER, 30, 30, false),
                view(2, idlin_sim::KIND_MONSTER, mx, 30, false),
            ];
            let sight = Visibility::new(&views, &[], 200 << 16);
            views
                .iter()
                .filter(|v| sight.keeps_entity(v))
                .map(|v| (v.id, to_state(v)))
                .collect()
        };
        let near = scout(40); // within 28 of the scout
        let far = scout(90); // beyond
        let (_, _, _, removed) = diff(&near, &far);
        assert_eq!(
            removed,
            [2],
            "walking out of sight removes the monster from the wire"
        );
        let (spawned, _, _, _) = diff(&far, &near);
        assert_eq!(
            spawned.iter().map(|s| s.id).collect::<Vec<_>>(),
            [2],
            "walking back in re-spawns it"
        );
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
    fn diff_patches_an_energy_shield_change() {
        // ES drains/recharges with life unmoved — the patch must still fire and
        // carry the new es_pct, else the overhead shield band would freeze.
        // (Mutation: drop `old.es_pct != state.es_pct` from diff() → no update.)
        let mut shielded = state(1, 0, 100);
        shielded.es_pct = 80;
        let prev = keyed(vec![shielded.clone()]);
        let mut drained = shielded;
        drained.es_pct = 30; // life still 100; only the shield moved
        let current = keyed(vec![drained]);
        let (_, _, updated, _) = diff(&prev, &current);
        assert_eq!(
            updated.iter().map(|u| (u.id, u.es_pct)).collect::<Vec<_>>(),
            [(1, 30)],
            "an ES-only change emits a patch carrying the new es_pct"
        );
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
