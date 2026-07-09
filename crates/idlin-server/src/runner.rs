//! The tick loop: a dedicated OS thread driving the pure sims at a fixed
//! cadence. The server runs MANY worlds — the shared town plus per-idler
//! zone instances — ticking them all and ferrying zone transfers between
//! them; the async side only ever sees the FEATURED world's `TickFrame`s.

use idlin_content::ContentDb;
use idlin_protocol::{
    CharacterSheet, CurrencyView, ExitView, GateView, GearSlotView, GemView, InvItemView,
    PropState, RolledModView, SkillStat, SkillSupport, StatSourceView, TileMapState, TileVisual,
};
use idlin_sim::world::{CharacterSheetView, SkillStatView};
use idlin_sim::{CharacterBundle, EntityView, SimEvent, TICK_HZ, TickInputs, World};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;
use tracing::{info, warn};

/// A focus-panel inspection: answered by the tick thread between ticks so
/// the pure sim never crosses a thread boundary. The world key scopes the
/// lookup (net ids are per-world); None = the featured world.
pub type InspectRequest = (Option<String>, u32, oneshot::Sender<Option<CharacterSheet>>);

/// Admin-surface commands (#148 A6), answered by the tick thread at tick
/// boundaries — the sim stays single-threaded and deterministic; HTTP only
/// stages inputs.
pub enum AdminCommand {
    /// Deploy a compiled brain: the character joins the shore (the tutorial
    /// gates everyone the same). The reply is Ok(()) or a refusal string.
    Deploy {
        name: String,
        program: Vec<u8>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// The kill switch: remove the named character wherever it is.
    Kill {
        name: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    /// The per-brain scoreboard, aggregated across every live world.
    Leaderboard {
        reply: oneshot::Sender<Vec<idlin_sim::LeaderRow>>,
    },
}

/// Deployed-brain headroom (#148 A6): builtins + deploys share the worlds;
/// the cap keeps a griefing script from flooding the shore.
pub const MAX_CHARACTERS: usize = 24;

/// One world's completed tick, with zone identity so any feed can emit a
/// full snapshot at any moment (late joiners, subscription switches).
pub struct TickFrame {
    /// Stable identity of the world this frame came from.
    pub world_key: String,
    pub tick: u64,
    pub zone_name: String,
    pub zone_level: u32,
    pub zone_width: i32,
    pub zone_height: i32,
    /// Authored zones: the resolved tile map (static; shared by Arc).
    pub tiles: Option<Arc<TileMapState>>,
    /// Walk-up exits with live open state.
    pub exits: Vec<ExitView>,
    /// Tutorial gates with live open state.
    pub gates: Vec<GateView>,
    pub views: Vec<EntityView>,
    pub events: Vec<SimEvent>,
    /// Fog of war (#129): the residents' union explored bitset (row-major,
    /// bit = y*w + x over the zone's cells) — replication masks tiles/props/
    /// exits/gates against it and streams newly explored cells as reveals.
    pub explored: Vec<u64>,
}

/// Every world's frame for one server tick — the FULL simulation output.
/// Replication fans this into per-world feeds; viewers subscribe to the
/// feeds their permissions allow.
pub struct TickBatch {
    /// The director-followed world (most characters).
    pub featured_key: String,
    pub frames: Vec<TickFrame>,
}

/// One world under management: the shared town, or a per-idler instance.
pub struct ManagedWorld {
    /// Unique key ("saltmere", "withered_shore#Kargan").
    pub key: String,
    /// The ZoneDef id this world simulates (transfer destinations match it).
    pub zone_id: String,
    pub world: World,
    /// Resolved tile map for authored zones (build once at boot).
    pub tiles: Option<Arc<TileMapState>>,
    /// ZoneDef::max_players (0 = unlimited). The ferry honors this cap when
    /// ROUTING a transfer to a destination, but it is a soft cap: a character
    /// with nowhere to go returns to its source even if that source is at cap
    /// (never lost beats never-overfilled — see `route_departure`). The sim
    /// itself enforces no hard cap.
    pub max_players: u32,
    /// Inputs queued for this world's next tick (joins at boot, then
    /// ferried arrivals).
    pub pending: TickInputs,
}

/// Whether a world can still accept a character (`max_players == 0` is
/// unlimited; otherwise the projected next-tick population must be under the
/// cap). The projection counts live characters PLUS those already queued for
/// next tick (`pending` joins + arrivals) — so several ferries in one pass
/// can't each see the same free slot and collectively overfill a capped zone.
fn has_room(mw: &ManagedWorld) -> bool {
    if mw.max_players == 0 {
        return true;
    }
    let live = mw.world.views().iter().filter(|v| v.kind == 1).count();
    let queued = mw.pending.joins.len() + mw.pending.arrivals.len();
    ((live + queued) as u32) < mw.max_players
}

/// Pick the world index a departing character routes to: the world whose key
/// matches `dest` (a specific instance) and has room, else any world
/// simulating that zone with room (a returning idler rejoins an existing
/// instance). When NOTHING can take them — an unknown destination, or every
/// matching instance is full — the character returns to its `source` world
/// rather than being dropped overboard ("lost at sea", #63). The host then
/// always lands the bundle in exactly one world's arrivals.
///
/// The source fallback is intentionally NOT capacity-gated: never losing a
/// character outranks honoring the soft cap. In a same-tick race — another
/// transfer claims the slot this character just vacated before its own
/// bounce-back — the source can exceed its cap, and sustained contention could
/// push it further over. That is accepted: `max_players` only shapes routing
/// (the sim hard-enforces no cap), and admitting the character always beats
/// dropping it (#63). Enforcing a hard cap here would need a reservation pass
/// and is out of scope for the data-loss fix.
fn route_departure(worlds: &[ManagedWorld], source: usize, dest: &str) -> usize {
    worlds
        .iter()
        .position(|mw| mw.key == dest && has_room(mw))
        .or_else(|| {
            worlds
                .iter()
                .position(|mw| mw.zone_id == dest && has_room(mw))
        })
        // Nowhere to go → home, cap or no cap. Never overboard.
        .unwrap_or(source)
}

/// A chart instance is done when nothing lives there and nothing is bound
/// for it (#136 T4). Never true for booted worlds — only voyages retire.
fn chart_instance_emptied(mw: &ManagedWorld) -> bool {
    mw.world.is_chart_instance()
        && mw.pending.arrivals.is_empty()
        && mw.pending.joins.is_empty()
        && mw.world.views().iter().all(|v| v.kind != 1)
}

/// The chart-aware ferry (#136 T4): departures carrying a ChartTicket open a
/// FRESH instance of their (map-kind) destination — keyed
/// "<zone>#<name>@<tick>", seeded from that key, its area level and juice set
/// by the ticket — and land there. Everything else rides the normal ferry.
/// Instances retire at the top of a later tick once they empty (never
/// mid-tick: frame posting indexes into `worlds`).
fn ferry_departures_with_charts(
    worlds: &mut Vec<ManagedWorld>,
    departures: Vec<(usize, CharacterBundle, String)>,
    content: &ContentDb,
    seed: u64,
    server_tick: u64,
) {
    let mut plain = Vec::new();
    for (source, mut bundle, dest) in departures {
        let Some(ticket) = bundle.chart.take() else {
            plain.push((source, bundle, dest));
            continue;
        };
        // Only map-kind zones may be chart-instanced; anything else rides
        // the normal ferry (and bounces home if unknown) — fail safe.
        let is_map = content
            .zone(&dest)
            .is_some_and(|z| matches!(z.kind, idlin_content::ZoneKind::Map));
        if !is_map {
            warn!(
                "{} chart-sailed for non-map zone {dest}; refunding the trip home",
                bundle.character.name
            );
            plain.push((source, bundle, dest));
            continue;
        }
        let key = format!("{dest}#{}@{server_tick}", bundle.character.name);
        let mut h = idlin_content::FNV1A_OFFSET;
        for b in key.bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(idlin_content::FNV1A_PRIME);
        }
        info!(
            "charting {} for {} (tier {})",
            key, bundle.character.name, ticket.tier
        );
        let mut mw = ManagedWorld {
            key: key.clone(),
            zone_id: dest.clone(),
            world: World::new_chart_instance(seed ^ h, content, &dest, ticket),
            tiles: resolve_tile_map(content, &dest),
            max_players: 1,
            pending: TickInputs::default(),
        };
        mw.pending.arrivals.push(bundle);
        worlds.push(mw);
    }
    ferry_departures(worlds, plain);
}

/// Land each of this tick's departures into exactly one world's arrivals.
/// `route_departure` guarantees a valid target — the destination instance, or
/// the source world when the destination is unknown or full — so a transfer
/// can never drop a character ("lost at sea", #63).
fn ferry_departures(
    worlds: &mut [ManagedWorld],
    departures: Vec<(usize, CharacterBundle, String)>,
) {
    for (source, bundle, dest) in departures {
        let target = route_departure(worlds, source, &dest);
        if target == source {
            warn!(
                "{} could not reach zone {dest} (unknown or full); returned to source {}",
                bundle.character.name, worlds[source].key
            );
        } else {
            info!(
                "ferrying {} to {}",
                bundle.character.name, worlds[target].key
            );
        }
        worlds[target].pending.arrivals.push(bundle);
    }
}

/// Derive the boot world set from CONTENT (#136 T3): every authored zone
/// boots by kind — shared town/story zones as one world each, solo story
/// zones as one instance per built-in idler, and `map` zones not at all
/// (they are chart-instanced on demand, #136 T4). Shipping a new zone never
/// needs a server change again: the Saltworks and the Hollow shipped
/// unbootable once, and route_departure silently bounced travelers home.
pub fn boot_worlds(
    content: &ContentDb,
    seed: u64,
    joins: &[idlin_sim::JoinRequest],
) -> Vec<ManagedWorld> {
    let twist = |name: &str| -> u64 {
        let mut h = idlin_content::FNV1A_OFFSET;
        for b in name.bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(idlin_content::FNV1A_PRIME);
        }
        h
    };
    let mut worlds = Vec::new();
    for def in &content.zones {
        match def.kind {
            idlin_content::ZoneKind::Map => continue,
            idlin_content::ZoneKind::Town | idlin_content::ZoneKind::Story
                if def.max_players == 0 =>
            {
                worlds.push(ManagedWorld {
                    key: def.id.clone(),
                    zone_id: def.id.clone(),
                    world: World::new_for_zone(seed ^ twist(&def.id), content, &def.id),
                    tiles: resolve_tile_map(content, &def.id),
                    max_players: def.max_players,
                    pending: TickInputs::default(),
                });
            }
            _ => {
                for join in joins {
                    let key = format!("{}#{}", def.id, join.name);
                    worlds.push(ManagedWorld {
                        key: key.clone(),
                        zone_id: def.id.clone(),
                        world: World::new_for_zone(seed ^ twist(&key), content, &def.id),
                        tiles: resolve_tile_map(content, &def.id),
                        max_players: def.max_players,
                        pending: TickInputs {
                            joins: vec![join.clone()],
                            arrivals: Vec::new(),
                            removals: Vec::new(),
                        },
                    });
                }
            }
        }
    }
    worlds
}

/// Resolve a zone's authored map into wire form: tileset + variant
/// applied server-side, so snapshots and recordings are self-contained.
pub fn resolve_tile_map(content: &ContentDb, zone_id: &str) -> Option<Arc<TileMapState>> {
    let def = content.zone(zone_id)?;
    let grid = def.tiles.as_ref()?;
    let ts = content.tileset(def.tileset.as_deref()?)?;
    let variant = def
        .tileset_variant
        .as_deref()
        .and_then(|v| ts.variants.iter().find(|var| var.id == v));
    let color_of = |ground: &str| -> String {
        variant
            .and_then(|v| v.palette.iter().find(|(g, _)| g == ground))
            .or_else(|| ts.palette.iter().find(|(g, _)| g == ground))
            .map(|(_, c)| c.clone())
            .unwrap_or_else(|| "#444444".into())
    };
    let legend = ts
        .tiles
        .iter()
        .map(|t| TileVisual {
            glyph: t.glyph.to_string(),
            ground: color_of(&t.ground),
            ground_id: t.ground.clone(),
            prop: t.prop.clone(),
            walkable: t.walkable,
            elevation: t.elevation,
        })
        .collect();
    let rows = (0..grid.height)
        .map(|y| {
            (0..grid.width)
                .map(|x| ts.tiles[grid.cell(x, y).expect("in bounds") as usize].glyph)
                .collect::<String>()
        })
        .collect();
    Some(Arc::new(TileMapState {
        width: grid.width,
        height: grid.height,
        rows,
        legend,
        features: ts.features.clone(),
        props: def
            .props
            .iter()
            .map(|p| PropState {
                model: p.model.clone(),
                x_u: p.x_u,
                y_u: p.y_u,
                rot_deg: p.rot_deg,
            })
            .collect(),
    }))
}

#[allow(clippy::too_many_arguments)] // a top-level spawn: each arg is a distinct host wire
pub fn spawn_tick_loop(
    mut worlds: Vec<ManagedWorld>,
    frames: UnboundedSender<TickBatch>,
    mut inspect_rx: UnboundedReceiver<InspectRequest>,
    mut admin_rx: UnboundedReceiver<AdminCommand>,
    server_tick: Arc<AtomicU64>,
    snapshot_base: Option<std::path::PathBuf>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    // Chart instancing (#136 T4): the ferry mints fresh worlds on demand.
    content: ContentDb,
    seed: u64,
) {
    std::thread::Builder::new()
        .name("idlin-sim".into())
        .spawn(move || {
            let tick_interval = Duration::from_millis(1000 / TICK_HZ as u64);
            let mut ticks_since_save = 0u64;
            // Host tick: only for unique chart-instance keys (worlds each
            // keep their own sim tick).
            let mut host_tick: u64 = 0;
            loop {
                let started = std::time::Instant::now();
                let stopping = shutdown.load(Ordering::Relaxed);
                host_tick += 1;

                // Retire emptied chart instances (#136 T4) — at the TOP of
                // the tick so no frame index from the previous loop survives
                // the removal. A voyage ends when its idler leaves or dies
                // out; the strand folds back into the sea.
                worlds.retain(|mw| {
                    let retire = chart_instance_emptied(mw);
                    if retire {
                        info!("chart instance {} emptied; retired", mw.key);
                        // The voyage's snapshot goes with it — a retired
                        // instance must never resume as a ghost.
                        if let Some(base) = &snapshot_base {
                            let dir = crate::persist::world_dir(base, &mw.key);
                            if let Err(e) = std::fs::remove_dir_all(&dir)
                                && dir.exists()
                            {
                                warn!("could not clear {}: {e}", dir.display());
                            }
                        }
                    }
                    !retire
                });

                // Tick every world, collecting its events and departures.
                let mut all_departures = Vec::new();
                let mut frames_data: Vec<(usize, Vec<SimEvent>)> = Vec::new();
                for (i, mw) in worlds.iter_mut().enumerate() {
                    let inputs = std::mem::take(&mut mw.pending);
                    let events = mw.world.tick(&inputs);
                    for ev in &events {
                        if let SimEvent::JoinRejected { name, reason } = ev {
                            warn!("[{}] join rejected for {name}: {reason}", mw.key);
                        }
                    }
                    // Tag each departure with its SOURCE world so a transfer
                    // that can't be placed can be returned home, not dropped.
                    all_departures.extend(
                        mw.world
                            .take_departures()
                            .into_iter()
                            .map(|(b, dest)| (i, b, dest)),
                    );
                    frames_data.push((i, events));
                }

                // Ferry: land each departure into its destination world (or
                // back to its source when that zone is unknown or full) — a
                // transfer never loses a character (#63).
                ferry_departures_with_charts(
                    &mut worlds,
                    all_departures,
                    &content,
                    seed,
                    host_tick,
                );

                // PERSISTENCE: save at the post-ferry boundary — every
                // character is in exactly one world's state or pending
                // list at this instant, so a restart can never duplicate
                // or lose one. Interval saves bound crash loss; a
                // graceful shutdown (SIGINT/SIGTERM) saves and exits.
                ticks_since_save += 1;
                if let Some(base) = &snapshot_base
                    && (ticks_since_save >= crate::persist::SAVE_EVERY_TICKS || stopping)
                {
                    ticks_since_save = 0;
                    for mw in &worlds {
                        // Chart instances snapshot like any world (#136 T4):
                        // a crash must never cost the CHARACTER inside one.
                        // Their dirs carry a plaintext `key` file so the boot
                        // scan can resume them (the dirname is a one-way
                        // hash); retirement deletes the dir.
                        let dir = crate::persist::world_dir(base, &mw.key);
                        if let Err(e) =
                            crate::persist::save_managed(&mw.world, &mw.pending.arrivals, &dir)
                        {
                            warn!("snapshot for {} failed: {e:#}", mw.key);
                        } else {
                            crate::persist::save_world_key(&dir, &mw.key);
                        }
                    }
                    if stopping {
                        info!("all worlds saved; shutting down");
                        std::process::exit(0);
                    }
                }
                if stopping {
                    // No persistence configured: just exit cleanly.
                    info!("shutting down (no persistence)");
                    std::process::exit(0);
                }

                // Feature the world with the most characters — corpses
                // included: a dead idler awaiting respawn is still the
                // story (counting only the living made every death flap
                // the stream to the empty town for five seconds). Ties go
                // to the earliest world.
                let featured = worlds
                    .iter()
                    .enumerate()
                    .map(|(i, mw)| {
                        let chars = mw.world.views().iter().filter(|v| v.kind == 1).count();
                        (i, chars)
                    })
                    .max_by(|a, b| a.1.cmp(&b.1).then(b.0.cmp(&a.0)))
                    .map(|(i, _)| i)
                    .unwrap_or(0);

                // Ship EVERY world's frame: the full simulation output.
                // Replication fans it into per-world feeds; the featured
                // virtual feed is composed there too.
                let mut batch_frames = Vec::with_capacity(worlds.len());
                let mut events_by_world: Vec<Vec<SimEvent>> = vec![Vec::new(); worlds.len()];
                for (i, evs) in frames_data {
                    events_by_world[i] = evs;
                }
                for (i, mw) in worlds.iter().enumerate() {
                    let (zw, zh) = mw.world.zone_size_raw();
                    batch_frames.push(TickFrame {
                        world_key: mw.key.clone(),
                        tick: mw.world.tick_count(),
                        zone_name: mw.world.zone_name().to_string(),
                        zone_level: mw.world.zone_level(),
                        zone_width: zw,
                        zone_height: zh,
                        explored: mw.world.union_explored(),
                        tiles: mw.tiles.clone(),
                        exits: mw
                            .world
                            .exit_views()
                            .into_iter()
                            .map(|(x, y, open)| ExitView { x, y, open })
                            .collect(),
                        gates: mw
                            .world
                            .gate_views()
                            .into_iter()
                            .map(|(x0, y0, x1, y1, open)| GateView {
                                x0,
                                y0,
                                x1,
                                y1,
                                open,
                            })
                            .collect(),
                        views: mw.world.views(),
                        events: std::mem::take(&mut events_by_world[i]),
                    });
                }
                server_tick.store(worlds[featured].world.tick_count(), Ordering::Relaxed);
                // Replication gone (shutdown) → stop simulating.
                if frames
                    .send(TickBatch {
                        featured_key: worlds[featured].key.clone(),
                        frames: batch_frames,
                    })
                    .is_err()
                {
                    info!("replication channel closed; tick loop exiting");
                    return;
                }

                // Focus-panel inspections answer from the requested world
                // (net ids are per-world; None = featured).
                while let Ok((world_key, id, reply)) = inspect_rx.try_recv() {
                    let mw = match &world_key {
                        Some(key) => worlds.iter().find(|mw| &mw.key == key),
                        None => Some(&worlds[featured]),
                    };
                    let _ = reply.send(
                        mw.and_then(|mw| mw.world.character_sheet(id))
                            .map(sheet_to_proto),
                    );
                }

                // Admin surface (#148 A6): deploy / kill / leaderboard,
                // staged as ordinary tick inputs — HTTP never touches a
                // world directly.
                while let Ok(cmd) = admin_rx.try_recv() {
                    match cmd {
                        AdminCommand::Deploy {
                            name,
                            program,
                            reply,
                        } => {
                            let taken = |mw: &ManagedWorld| {
                                mw.world
                                    .leaderboard_rows()
                                    .iter()
                                    .any(|r| r.name == name)
                                    || mw.pending.joins.iter().any(|j| j.name == name)
                                    || mw.pending.arrivals.iter().any(|b| b.character.name == name)
                            };
                            let population: usize = worlds
                                .iter()
                                .map(|mw| {
                                    mw.world.leaderboard_rows().len()
                                        + mw.pending.joins.len()
                                        + mw.pending.arrivals.len()
                                })
                                .sum();
                            let res = if worlds.iter().any(taken) {
                                Err(format!("the name {name} is taken"))
                            } else if population >= MAX_CHARACTERS {
                                Err(format!(
                                    "the worlds are full ({population}/{MAX_CHARACTERS}) — recall a brain first"
                                ))
                            } else {
                                // Every idler gets their OWN tutorial shore —
                                // the boot model (withered_shore#Kargan…),
                                // never a seat in a builtin's max_players:1
                                // instance (the review's B2: find() dumped
                                // every deploy into Kargan's).
                                let key = format!("withered_shore#{name}");
                                let mut h = idlin_content::FNV1A_OFFSET;
                                for b in key.bytes() {
                                    h ^= b as u64;
                                    h = h.wrapping_mul(idlin_content::FNV1A_PRIME);
                                }
                                let mut mw = ManagedWorld {
                                    key: key.clone(),
                                    zone_id: "withered_shore".into(),
                                    world: World::new_for_zone(
                                        seed ^ h,
                                        &content,
                                        "withered_shore",
                                    ),
                                    tiles: resolve_tile_map(&content, "withered_shore"),
                                    max_players: 1,
                                    pending: TickInputs::default(),
                                };
                                mw.pending.joins.push(idlin_sim::JoinRequest {
                                    name,
                                    program,
                                });
                                worlds.push(mw);
                                Ok(())
                            };
                            let _ = reply.send(res);
                        }
                        AdminCommand::Kill { name, reply } => {
                            let holder = worlds.iter_mut().find(|mw| {
                                mw.world.leaderboard_rows().iter().any(|r| r.name == name)
                            });
                            let res = match holder {
                                Some(mw) => {
                                    mw.pending.removals.push(name);
                                    Ok(())
                                }
                                None => Err(format!("no character named {name}")),
                            };
                            let _ = reply.send(res);
                        }
                        AdminCommand::Leaderboard { reply } => {
                            let mut rows: Vec<idlin_sim::LeaderRow> = worlds
                                .iter()
                                .flat_map(|mw| mw.world.leaderboard_rows())
                                .collect();
                            rows.sort_by(|a, b| {
                                (b.story_acts.count_ones(), b.level, b.kills).cmp(&(
                                    a.story_acts.count_ones(),
                                    a.level,
                                    a.kills,
                                ))
                            });
                            let _ = reply.send(rows);
                        }
                    }
                }

                // Fixed cadence with drop-behind: if a tick overruns we don't
                // repay the debt all at once.
                std::thread::sleep(tick_interval.saturating_sub(started.elapsed()));
            }
        })
        .expect("spawn sim thread");
}

fn clamp_i32(v: i64) -> i32 {
    v.clamp(i32::MIN as i64, i32::MAX as i64) as i32
}

/// Map a sim item's rolled affixes (affix_num, tier, values) to the wire view.
fn rolled_mods(mods: &[(i32, u32, Vec<i64>)]) -> Vec<RolledModView> {
    mods.iter()
        .map(|(num, tier, values)| RolledModView {
            num: *num,
            tier: *tier,
            values: values.iter().map(|v| clamp_i32(*v)).collect(),
        })
        .collect()
}

/// Map one computed skill readout to the wire type. XP is clamped nonnegative
/// (parity with the gem-row clamp) so corrupt state can't render a negative bar.
fn skill_to_proto(s: SkillStatView) -> SkillStat {
    SkillStat {
        name: s.name,
        level: s.level,
        xp: clamp_i32(s.xp.max(0)),
        xp_next: clamp_i32(s.xp_next.max(0)),
        kind: if s.is_spell { "spell" } else { "attack" }.to_string(),
        shape: s.shape.to_string(),
        damage: s.damage.iter().map(|d| clamp_i32(*d)).collect(),
        dps: clamp_i32(s.dps),
        crit_chance_bp: clamp_i32(s.crit_chance_bp),
        crit_multi_bp: clamp_i32(s.crit_multi_bp),
        use_ticks: s.use_ticks,
        cooldown_ticks: s.cooldown_ticks,
        mana_cost: clamp_i32(s.mana_cost),
        life_cost: clamp_i32(s.life_cost),
        range_cu: s.range_cu,
        radius_cu: s.radius_cu,
        width_cu: s.width_cu,
        projectiles: s.projectiles,
        pierce: s.pierce,
        dot_per_sec: clamp_i32(s.dot_per_sec),
        dot_duration_ticks: s.dot_duration_ticks,
        buff_duration_ticks: s.buff_duration_ticks,
        debuff_duration_ticks: s.debuff_duration_ticks,
        supports: s
            .supports
            .into_iter()
            .map(|(name, level, xp, xp_next)| SkillSupport {
                name,
                level,
                xp: clamp_i32(xp.max(0)),
                xp_next: clamp_i32(xp_next.max(0)),
            })
            .collect(),
    }
}

fn sheet_to_proto(v: CharacterSheetView) -> CharacterSheet {
    CharacterSheet {
        id: v.id,
        name: v.name,
        level: v.level,
        xp: clamp_i32(v.xp),
        xp_next: clamp_i32(v.xp_next),
        life: clamp_i32(v.life),
        life_max: clamp_i32(v.life_max),
        mana: clamp_i32(v.mana),
        mana_max: clamp_i32(v.mana_max),
        es: clamp_i32(v.es),
        es_max: clamp_i32(v.es_max),
        // No reservation mechanic yet (combat rework) — 0 for now; the client's
        // reserved gravel band is exercised via harness fixtures until then.
        life_reserved: 0,
        mana_reserved: 0,
        block_bp: clamp_i32(v.block),
        kills: v.kills.min(u32::MAX as u64) as u32,
        story_acts: v.story_acts,
        dmg_phys: clamp_i32(v.damage[0]),
        dmg_fire: clamp_i32(v.damage[1]),
        dmg_cold: clamp_i32(v.damage[2]),
        dmg_lightning: clamp_i32(v.damage[3]),
        dmg_chaos: clamp_i32(v.damage[4]),
        accuracy: clamp_i32(v.accuracy),
        evasion: clamp_i32(v.evasion),
        armour: clamp_i32(v.armour),
        resist_fire_bp: clamp_i32(v.resists[0]),
        resist_cold_bp: clamp_i32(v.resists[1]),
        resist_lightning_bp: clamp_i32(v.resists[2]),
        resist_chaos_bp: clamp_i32(v.resists[3]),
        item_rarity_bp: clamp_i32((v.item_rarity - 10000).max(0)),
        item_quantity_bp: clamp_i32((v.item_quantity - 10000).max(0)),
        equipment: v
            .equipment
            .into_iter()
            .map(|(slot, item, dimmed)| match item {
                Some(it) => GearSlotView {
                    slot: slot.to_string(),
                    name: it.name,
                    rarity: it.rarity,
                    dimmed,
                    base_num: it.base_num,
                    item_level: it.item_level,
                    mods: rolled_mods(&it.mods),
                },
                None => GearSlotView {
                    slot: slot.to_string(),
                    name: String::new(),
                    rarity: 0,
                    dimmed,
                    base_num: -1,
                    item_level: 0,
                    mods: Vec::new(),
                },
            })
            .collect(),
        inventory: v
            .inventory
            .into_iter()
            .map(|(it, x, y, w, h)| InvItemView {
                name: it.name,
                rarity: it.rarity,
                x,
                y,
                w,
                h,
                base_num: it.base_num,
                item_level: it.item_level,
                mods: rolled_mods(&it.mods),
            })
            .collect(),
        gems: v
            .gems
            .into_iter()
            .map(|(name, level, xp, xp_next, support)| GemView {
                name,
                level,
                xp: xp.clamp(0, i32::MAX as i64) as i32,
                xp_next: xp_next.clamp(0, i32::MAX as i64) as i32,
                support,
            })
            .collect(),
        skills: v.skills.into_iter().map(skill_to_proto).collect(),
        currency: v
            .currency
            .into_iter()
            .map(|(name, count, tier)| CurrencyView {
                name,
                count: count.min(u32::MAX as u64) as u32,
                tier,
            })
            .collect(),
        passive_allocated: v.passive_allocated,
        passive_unspent: v.passive_unspent,
        build_len: v.build_len,
        stat_sources: v
            .stat_sources
            .into_iter()
            .map(|(stat, source, layer, value)| StatSourceView {
                stat,
                source,
                layer,
                value: clamp_i32(value),
            })
            .collect(),
    }
}

/// The headless harness (#148 A6): run ANY brain through the WHOLE game —
/// shore tutorial, both acts, the table, one charted sail — under the same
/// mini host loop the band tests use. `cargo run -p idlin-server --bin
/// harness -- --brain my.bot` is the published form; the band tests assert
/// over the same report.
pub mod salt_road {
    use super::*;
    use idlin_content::ContentDb;

    /// What a full run reports: every campaign milestone by name, plus the
    /// band's three meters.
    #[derive(Debug, serde::Serialize)]
    pub struct SaltRoadReport {
        pub milestones: Vec<(String, bool)>,
        pub sailed_at: u64,
        pub deaths: u32,
        pub sales: u32,
    }

    impl SaltRoadReport {
        pub fn completed(&self) -> bool {
            self.milestones.iter().all(|(_, m)| *m)
        }
        /// The first unlit milestone's name (the wall), if any.
        pub fn stuck_before(&self) -> Option<&str> {
            self.milestones
                .iter()
                .find(|(_, m)| !m)
                .map(|(n, _)| n.as_str())
        }
    }

    /// THE 1.0 PROMISE (#136 T6) + THE BALANCE BAND (#136 T8): a stock
    /// grinder, joined fresh at level 1 in Saltmere, plays the whole game by
    /// itself — walks the road (coast, the Saltworks past Karesh, down the
    /// Hollow), breaks the Mother, completes Act 1, carries her chart home
    /// to the table, and SAILS. A mini host loop (tick + chart-aware ferry)
    /// stands in for the server. Across SEEDS, the run must also stay
    /// inside the band: done within the tick budget, without death-spam —
    /// a content change that turns a zone into a meat grinder or a wall
    /// fails here, not in front of the operator. Mutation: break routing,
    /// the act hook, UseChart, the ferry mint, or overtune any fight → a
    /// milestone never lights (or the band breaks) and this fails named.
    pub fn walk_the_salt_road(seed: u64, program: Vec<u8>) -> SaltRoadReport {
        let content = ContentDb::load(std::path::Path::new("../../content")).unwrap();
        // The WHOLE game: the join lands on the shore, so the real tutorial
        // (gates, lessons, the Tidewarden exam) delivers a ~level-5 pupil to
        // Saltmere before the campaign begins — exactly a fresh idler's life.
        let joins = vec![idlin_sim::JoinRequest {
            name: "Pathfinder".into(),
            program,
        }];
        let mut worlds = boot_worlds(&content, seed, &joins);
        let mut milestones = [false; 8];
        let mut sales = 0u32;
        let names = [
            "reach the coast",
            "reach the saltworks",
            "reach the hollow",
            "complete act 1",
            "descend to Lanternfall",
            "complete act 2",
            "spend a chart at a table",
            "sail a charted voyage",
        ];
        let mut deaths = 0u32;
        let mut sailed_at = 0u64;
        'run: for host_tick in 0..280_000u64 {
            let mut departures = Vec::new();
            for (i, mw) in worlds.iter_mut().enumerate() {
                let inputs = std::mem::take(&mut mw.pending);
                let events = mw.world.tick(&inputs);
                for ev in &events {
                    if let SimEvent::ActCompleted { name, act, .. } = ev
                        && name == "Pathfinder"
                    {
                        match act {
                            1 => milestones[3] = true,
                            2 => milestones[5] = true,
                            _ => {}
                        }
                    }
                    if let SimEvent::CharacterDied { name, .. } = ev
                        && name == "Pathfinder"
                    {
                        deaths += 1;
                    }
                    // #148 A5 (review B2): the economy proof must be VENDOR-
                    // specific — kills also pay obols, so a currency-sum
                    // assert was vacuous. Only sell() narrates "Sold ".
                    if let SimEvent::Narration { text, .. } = ev
                        && text.starts_with("Sold ")
                    {
                        sales += 1;
                    }
                }
                departures.extend(
                    mw.world
                        .take_departures()
                        .into_iter()
                        .map(|(b, dest)| (i, b, dest)),
                );
            }
            // A ticketed departure IS the town milestone: standing at the
            // table, act done, chart spent (zone sampling every 200 ticks
            // can miss the transit — the road home is 6 cells long).
            for (_, b, dest) in &departures {
                if b.character.name == "Pathfinder" && b.chart.is_some() {
                    milestones[6] = true;
                }
                // Town transits outrun the 200-tick zone sampling (the T6
                // lesson, again): a departure BOUND for the town proves the
                // descent as well as standing in it would.
                if b.character.name == "Pathfinder" && dest == "lanternfall" {
                    milestones[4] = true;
                }
            }
            ferry_departures_with_charts(&mut worlds, departures, &content, seed, host_tick);
            if host_tick % 20_000 == 1 {
                for mw in &worlds {
                    for v in mw.world.views() {
                        if v.kind == 1 {
                            let bag: Vec<String> = mw
                                .world
                                .character_sheet(v.id)
                                .map(|sh| sh.inventory.iter().map(|r| r.0.name.clone()).collect())
                                .unwrap_or_default();
                            println!(
                                "P t={host_tick} z={} lvl={} x={} y={} charts={}",
                                mw.zone_id,
                                v.level,
                                v.x_raw / 65536,
                                v.y_raw / 65536,
                                bag.iter().filter(|n| n.contains("Chart")).count()
                            );
                        }
                    }
                }
            }
            if host_tick % 200 == 0 {
                for mw in &worlds {
                    let here = mw
                        .world
                        .views()
                        .iter()
                        .any(|v| v.kind == 1 && v.name == "Pathfinder");
                    if !here {
                        continue;
                    }
                    match mw.zone_id.as_str() {
                        "coast" => milestones[0] = true,
                        "saltworks" => milestones[1] = true,
                        "hollow" => milestones[2] = true,
                        "lanternfall" => milestones[4] = true,
                        "charted_shallows" => {
                            milestones[7] = true;
                            sailed_at = host_tick;
                            break 'run;
                        }
                        _ => {}
                    }
                }
            }
        }
        SaltRoadReport {
            milestones: names
                .iter()
                .zip(milestones.iter())
                .map(|(n, m)| (n.to_string(), *m))
                .collect(),
            sailed_at,
            deaths,
            sales,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::salt_road::{SaltRoadReport, walk_the_salt_road};

    /// Band-side assertion: the road must COMPLETE — the report names the
    /// wall when it doesn't.
    fn assert_complete(seed: u64, r: &SaltRoadReport) {
        assert!(
            r.completed(),
            "seed {seed:#x}: the road ends early — stuck before `{}`",
            r.stuck_before().unwrap()
        );
    }

    use super::*;
    use idlin_sim::JoinRequest;
    use idlin_sim::entity::CharacterState;

    /// Corrupt/negative gem XP must not reach the wire as a negative width —
    /// `skill_to_proto` clamps skill AND support xp/xp_next to 0. Drop the
    /// `.max(0)` calls and this fails.
    #[test]
    fn skill_to_proto_clamps_negative_xp_to_zero() {
        let view = SkillStatView {
            name: "Corrupt".into(),
            level: 3,
            xp: -50,
            xp_next: -10,
            is_spell: false,
            shape: "target",
            damage: [0; 5],
            dps: 0,
            crit_chance_bp: 0,
            crit_multi_bp: 15000,
            use_ticks: 10,
            cooldown_ticks: 0,
            mana_cost: 0,
            life_cost: 0,
            range_cu: 0,
            radius_cu: 0,
            width_cu: 0,
            projectiles: 0,
            pierce: 0,
            dot_per_sec: 0,
            dot_duration_ticks: 0,
            buff_duration_ticks: 0,
            debuff_duration_ticks: 0,
            supports: vec![("Sup".into(), 2, -30, -5)],
        };
        let out = skill_to_proto(view);
        assert_eq!(out.xp, 0, "negative skill xp clamps to 0");
        assert_eq!(out.xp_next, 0, "negative skill xp_next clamps to 0");
        assert_eq!(out.supports[0].xp, 0, "negative support xp clamps to 0");
        assert_eq!(
            out.supports[0].xp_next, 0,
            "negative support xp_next clamps to 0"
        );
    }

    /// A world holding `n` characters (joined halt-bots), so `has_room` sees a
    /// real `views()` population. Empty content keeps it cheap and deterministic.
    fn world_with_chars(n: usize, content: &ContentDb) -> World {
        let mut w = World::new(0xF0, content);
        let prog = idlin_botc::assemble("halt\n").unwrap();
        let joins = (0..n)
            .map(|i| JoinRequest {
                name: format!("c{i}"),
                program: prog.clone(),
            })
            .collect();
        w.tick(&TickInputs {
            joins,
            arrivals: Vec::new(),
            removals: Vec::new(),
        });
        w
    }

    #[test]
    fn the_stock_grinder_walks_the_salt_road() {
        // Three seeds (#136 T8): the promise must hold for EVERY fresh
        // idler, not one lucky roll. Bands (generous — regression trips,
        // not tuning drift): sail within 90k ticks vs measured 9.8k-27.2k,
        // and at most 40 deaths vs measured 1-4 — death-SPAM is the smell
        // this catches, not death itself: dying is idle life. The band's
        // first catch: 72 deaths in the pre-tune Hollow on one seed. A
        // subtle 2x pacing drift passes by design; walls and grinders trip.
        // The fourth seed is 1.0's tutorial-deadlock finder — kept forever.
        for seed in [0x05A1_70AD, 0x1D71_2026, 0xBADC_0DE5, 0x0CA5_7E12] {
            let r = walk_the_salt_road(seed, idlin_botc::template_grinder().unwrap());
            assert_complete(seed, &r);
            let (sailed_at, deaths, sales) = (r.sailed_at, r.deaths, r.sales);
            // #148 A5 (review B2, take two): the vendor-specific economy
            // proof lives in THE MELEE BAND ONLY — its four seeds all
            // arrive at the table holding act-road junk; the ranged pair
            // sometimes field-shed to a clean bag (the caster did, and a
            // currency-sum assert was vacuous — kills pay obols too). The
            // sell CONTRACT itself is unit-pinned. Mutation: remove the
            // templates' sell adoption → no "Sold " narration, this trips.
            assert!(
                sales > 0,
                "seed {seed:#x}: the sailor should have SOLD junk before sailing"
            );
            // RETROSPECTIVE re-band (#148): the A3-era 180k line was set
            // against a pre-scorer 103k run; the economy arcs quietly
            // quintupled the pace — measured 19-26k across all four seeds.
            // 60k = ~2.5x headroom; drift past it means the road slowed
            // for a reason someone should name.
            assert!(
                sailed_at <= 60_000,
                "seed {seed:#x}: sailed at {sailed_at} — the road has a wall"
            );
            // Measured 9-24 deaths across the four seeds post-economy;
            // 60 = ~2.5x headroom, still far below the meat-grinder
            // signatures the band exists to catch (72+, 151).
            assert!(
                deaths <= 60,
                "seed {seed:#x}: {deaths} deaths — a zone is a meat grinder"
            );
        }
    }

    /// #148 A2: the promise holds for EVERY ARCHETYPE, not just the sword.
    /// One seed each (melee has four above): the caster and the ranger
    /// must ALSO walk the whole road — tutorial, campaign, Mother, sail —
    /// inside the same bands. Mutation: break either build plan, ladder,
    /// or the ranged hold badly enough and the road ends early.
    #[test]
    fn the_caster_walks_the_salt_road() {
        // RETROSPECTIVE re-band (#148): the debt-era lines were set before
        // the scorer economy landed — measured 69.4k/128 on the nastiest
        // seed (the 1.0-deadlock canary). 150k/200 gives ~2x headroom.
        // The caster's 128 deaths remain the balance OUTLIER (melee runs
        // 9-24, the bow 10-50): the wand corpse-trades where the bow
        // out-ranges — a tuning thread, not a wall.
        let r = walk_the_salt_road(0x0CA5_7E12, idlin_botc::template_caster().unwrap());
        assert_complete(0x0CA5_7E12, &r);
        let (sailed_at, deaths) = (r.sailed_at, r.deaths);
        assert!(sailed_at <= 150_000, "the caster hit a wall at {sailed_at}");
        assert!(
            deaths <= 200,
            "{deaths} caster deaths — a grinder for wands"
        );
    }

    #[test]
    fn the_ranger_walks_the_salt_road() {
        // Measured ~20-50k sails; 120k = the wall line. Deaths measured
        // 48-130 across configs — the bow shares the wand's defense debt
        // (bases exist since A2.5, but the stock brains don't stat-weigh
        // gear: rarity-first wears whatever drops). 160 = the same debt
        // band as the caster; both tighten when brains learn to value
        // defense (the remaining A2.5 thread, noted in #148).
        // THREAD CLOSED (#148 retrospective): seed 0x0BB0_77A1 used to WALL
        // at the bow-vs-Mother fight and was parked as a known repro. The
        // A5 scorer economy + the A2.5 nine-tenths hold healed it as a
        // side effect — measured complete at 22.8k/10 deaths — so BOTH
        // seeds are banded again. If either regresses, the fight thread
        // reopens.
        for seed in [0x0BB0_77A1u64, 0x0BB0_77A2] {
            let r = walk_the_salt_road(seed, idlin_botc::template_ranger().unwrap());
            assert_complete(seed, &r);
            let (sailed_at, deaths) = (r.sailed_at, r.deaths);
            assert!(sailed_at <= 80_000, "the ranger hit a wall at {sailed_at}");
            assert!(deaths <= 110, "{deaths} ranger deaths — a grinder for bows");
        }
        let _ = (0,);
        let (sailed_at, deaths) = (0u64, 0u32);
        let _ = (sailed_at, deaths);
        assert!(sailed_at <= 260_000, "the ranger hit a wall at {sailed_at}");
        assert!(deaths <= 240, "{deaths} ranger deaths — a grinder for bows");
    }

    #[test]
    fn a_chart_departure_mints_a_voyage_and_it_retires_when_empty() {
        // #136 T4: a ticketed departure opens a fresh instance of the map
        // zone (leveled + juiced + ephemeral) holding exactly that bundle;
        // an unticketed one rides the normal ferry; and the emptied voyage
        // retires while booted worlds never do. Mutations: drop the ticket
        // branch, the map-kind guard, or the retire predicate → fails.
        let content = ContentDb::load(std::path::Path::new("../../content")).unwrap();
        let mut worlds = vec![ManagedWorld {
            key: "saltmere".into(),
            zone_id: "saltmere".into(),
            world: World::new_for_zone(3, &content, "saltmere"),
            tiles: None,
            max_players: 0,
            pending: TickInputs::default(),
        }];
        let mut b = bundle("Sailor");
        b.chart = Some(idlin_sim::ChartTicket {
            tier: 2,
            rarity_bp: 1000,
            quantity_bp: 500,
            fury_bp: 0,
            clock: 0,
            boss: false,
        });
        ferry_departures_with_charts(
            &mut worlds,
            vec![(0, b, "charted_shallows".to_string())],
            &content,
            99,
            41,
        );
        assert_eq!(worlds.len(), 2, "the voyage exists");
        let mw = &worlds[1];
        assert_eq!(mw.key, "charted_shallows#Sailor@41");
        assert_eq!(mw.zone_id, "charted_shallows");
        assert!(mw.world.is_chart_instance());
        assert_eq!(mw.world.zone_level(), 14, "12 + tier 2");
        assert_eq!(mw.pending.arrivals.len(), 1, "the sailor is aboard");
        // Not yet retired: the arrival is pending.
        assert!(!chart_instance_emptied(&worlds[1]));
        // Land the arrival, then walk them home: the instance empties.
        let inputs = std::mem::take(&mut worlds[1].pending);
        worlds[1].world.tick(&inputs);
        assert!(
            !chart_instance_emptied(&worlds[1]),
            "occupied voyages persist"
        );
        // A booted world is never "emptied", even with zero characters.
        assert!(!chart_instance_emptied(&worlds[0]));
        // A ticket for a NON-map zone refunds home instead of minting.
        let mut b2 = bundle("Confused");
        b2.chart = Some(idlin_sim::ChartTicket {
            tier: 1,
            rarity_bp: 0,
            quantity_bp: 0,
            fury_bp: 0,
            clock: 0,
            boss: false,
        });
        let before = worlds.len();
        ferry_departures_with_charts(
            &mut worlds,
            vec![(0, b2, "saltmere".to_string())],
            &content,
            99,
            42,
        );
        assert_eq!(worlds.len(), before, "no voyage minted for a story zone");
        assert!(
            worlds[0]
                .pending
                .arrivals
                .iter()
                .any(|a| a.character.name == "Confused"),
            "the confused sailor lands home"
        );
    }

    #[test]
    fn boot_worlds_runs_every_live_zone() {
        // #136 T3: THE test that was missing when the Saltworks and the
        // Hollow shipped unbootable — every non-map authored zone must be
        // live at boot, solo zones per idler, map zones absent (they are
        // chart-instanced, T4). Mutation: drop a kind arm (or hardcode the
        // world list again) → the matching assert fails.
        let content = ContentDb::load(std::path::Path::new("../../content")).unwrap();
        let joins = vec![
            idlin_sim::JoinRequest {
                name: "Kargan".into(),
                program: idlin_botc::assemble("halt\n").unwrap(),
            },
            idlin_sim::JoinRequest {
                name: "Veles".into(),
                program: idlin_botc::assemble("halt\n").unwrap(),
            },
        ];
        let worlds = boot_worlds(&content, 7, &joins);
        let keys: Vec<&str> = worlds.iter().map(|w| w.key.as_str()).collect();
        // Shared zones: one world each, keyed by id.
        for shared in [
            "saltmere",
            "coast",
            "saltworks",
            "hollow",
            "sunken_stair",
            "lanternfall",
            "kelp_forest",
            "pressure_court",
            "the_undertow",
        ] {
            assert!(keys.contains(&shared), "{shared} must boot; got {keys:?}");
        }
        // Solo story zones: one instance per built-in idler.
        assert!(keys.contains(&"withered_shore#Kargan"));
        assert!(keys.contains(&"withered_shore#Veles"));
        // Map zones never boot — the proving ground stays off the live set.
        assert!(
            !keys.iter().any(|k| k.contains("test_range")),
            "map zones are chart-instanced, not booted; got {keys:?}"
        );
        // Every travel destination in the act resolves to a booted world, so
        // route_departure can never bounce a campaign traveler home.
        for def in &content.zones {
            for exit in &def.exits {
                let dest = &exit.dest;
                let reachable = worlds.iter().any(|w| w.zone_id == *dest);
                let is_map = content
                    .zone(dest)
                    .is_some_and(|z| matches!(z.kind, idlin_content::ZoneKind::Map));
                assert!(
                    reachable || is_map,
                    "exit {}->{dest} leads nowhere live",
                    def.id
                );
            }
        }
    }

    fn managed(key: &str, zone_id: &str, world: World, max_players: u32) -> ManagedWorld {
        ManagedWorld {
            key: key.into(),
            zone_id: zone_id.into(),
            world,
            tiles: None,
            max_players,
            pending: TickInputs::default(),
        }
    }

    fn bundle(name: &str) -> CharacterBundle {
        CharacterBundle {
            character: CharacterState {
                name: name.into(),
                level: 1,
                xp: 0,
                respawn_at: None,
                kills: 0,
                deaths: 0,
                items: 0,
                inventory: Vec::new(),
                equipment: Default::default(),
                allocated: Vec::new(),
                build_plan: Vec::new(),
                currency: Vec::new(),
                stash: Vec::new(),
                sockets: std::collections::BTreeMap::new(),
                explored: Vec::new(),
                story_acts: 0,
            },
            program: idlin_botc::assemble("halt\n").unwrap(),
            persist: Vec::new(),
            params: Vec::new(),
            bot_version: 1,
            chart: None,
        }
    }

    #[test]
    fn route_departure_prefers_exact_key_then_zone_then_source() {
        let content = ContentDb::empty();
        let worlds = vec![
            managed("saltmere", "saltmere", world_with_chars(0, &content), 0),
            managed(
                "shore#A",
                "withered_shore",
                world_with_chars(0, &content),
                0,
            ),
            managed(
                "shore#B",
                "withered_shore",
                world_with_chars(0, &content),
                0,
            ),
        ];
        // An exact instance key wins.
        assert_eq!(route_departure(&worlds, 0, "shore#B"), 2);
        // No matching key → first roomy instance of the zone.
        assert_eq!(route_departure(&worlds, 0, "withered_shore"), 1);
        // Unknown destination → back to source, never dropped (#63).
        assert_eq!(route_departure(&worlds, 0, "atlantis"), 0);
    }

    #[test]
    fn route_departure_skips_full_instances_and_falls_back_to_source() {
        let content = ContentDb::empty();
        // The only instance of "withered_shore" is full (cap 1, holds 1).
        let mut worlds = vec![
            managed("saltmere", "saltmere", world_with_chars(0, &content), 0),
            managed(
                "shore#A",
                "withered_shore",
                world_with_chars(1, &content),
                1,
            ),
        ];
        // No room anywhere → returns to source (the "lost at sea" case, #63).
        assert_eq!(route_departure(&worlds, 0, "withered_shore"), 0);
        // Add a second, roomy instance: the departure routes there instead.
        worlds.push(managed(
            "shore#B",
            "withered_shore",
            world_with_chars(0, &content),
            1,
        ));
        assert_eq!(route_departure(&worlds, 0, "withered_shore"), 2);
    }

    #[test]
    fn ferry_returns_character_home_when_destination_unknown_or_full() {
        let content = ContentDb::empty();
        let mut worlds = vec![
            managed("saltmere", "saltmere", world_with_chars(0, &content), 0),
            managed(
                "shore#A",
                "withered_shore",
                world_with_chars(1, &content),
                1,
            ), // full
        ];
        // One bound for an unknown zone, one for a full zone — both must survive.
        let departures = vec![
            (0, bundle("Lost"), "atlantis".to_string()),
            (0, bundle("Crowded"), "withered_shore".to_string()),
        ];
        ferry_departures(&mut worlds, departures);
        assert_eq!(
            worlds[0].pending.arrivals.len(),
            2,
            "unknown + full destinations both return home, not overboard"
        );
        assert_eq!(
            worlds[1].pending.arrivals.len(),
            0,
            "the full instance took nobody"
        );
        let names: Vec<&str> = worlds[0]
            .pending
            .arrivals
            .iter()
            .map(|b| b.character.name.as_str())
            .collect();
        assert!(names.contains(&"Lost") && names.contains(&"Crowded"));
    }

    #[test]
    fn ferry_delivers_to_a_matching_roomy_world() {
        let content = ContentDb::empty();
        let mut worlds = vec![
            managed("saltmere", "saltmere", world_with_chars(0, &content), 0),
            managed(
                "shore#A",
                "withered_shore",
                world_with_chars(0, &content),
                0,
            ),
        ];
        ferry_departures(
            &mut worlds,
            vec![(0, bundle("Traveler"), "withered_shore".to_string())],
        );
        assert_eq!(
            worlds[1].pending.arrivals.len(),
            1,
            "delivered to the destination zone"
        );
        assert_eq!(worlds[0].pending.arrivals.len(), 0, "source keeps nobody");
    }

    #[test]
    fn ferry_does_not_overfill_a_capped_world_within_one_tick() {
        let content = ContentDb::empty();
        // One empty instance of the zone, cap 1. Two characters race its slot.
        let mut worlds = vec![
            managed("saltmere", "saltmere", world_with_chars(0, &content), 0),
            managed(
                "shore#A",
                "withered_shore",
                world_with_chars(0, &content),
                1,
            ),
        ];
        let departures = vec![
            (0, bundle("First"), "withered_shore".to_string()),
            (0, bundle("Second"), "withered_shore".to_string()),
        ];
        ferry_departures(&mut worlds, departures);
        // The cap-1 instance admits exactly one; counting queued arrivals stops
        // the second from seeing the same free slot and overfilling it.
        assert_eq!(
            worlds[1].pending.arrivals.len(),
            1,
            "a cap-1 zone takes exactly one of two same-tick arrivals"
        );
        assert_eq!(
            worlds[0].pending.arrivals.len(),
            1,
            "the second returns to source, neither overfills nor is lost"
        );
    }

    #[test]
    fn ferry_never_loses_a_returning_character_even_when_its_slot_was_taken() {
        // The race the soft cap accepts: shore#A (cap 1) has just emptied, an
        // external transfer claims its one slot, and shore#A's own departed
        // character then bounces back (its destination unknown). The cap may be
        // exceeded by one, but NO character is dropped — the #63 invariant.
        let content = ContentDb::empty();
        let mut worlds = vec![
            managed("town", "town", world_with_chars(0, &content), 0),
            managed(
                "shore#A",
                "withered_shore",
                world_with_chars(0, &content),
                1,
            ),
        ];
        let departures = vec![
            // External: claims shore#A's free slot first.
            (0, bundle("Visitor"), "withered_shore".to_string()),
            // shore#A's own occupant, destination unknown → bounces home.
            (1, bundle("Owner"), "atlantis".to_string()),
        ];
        ferry_departures(&mut worlds, departures);
        let total: usize = worlds.iter().map(|w| w.pending.arrivals.len()).sum();
        assert_eq!(
            total, 2,
            "every departed character lands somewhere — none lost"
        );
        // The returner specifically is preserved (admitted to its source).
        assert!(
            worlds[1]
                .pending
                .arrivals
                .iter()
                .any(|b| b.character.name == "Owner"),
            "the returning character is admitted home, not dropped"
        );
    }
}
