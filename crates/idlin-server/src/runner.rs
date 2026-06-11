//! The tick loop: a dedicated OS thread driving the pure sims at a fixed
//! cadence. The server runs MANY worlds — the shared town plus per-idler
//! zone instances — ticking them all and ferrying zone transfers between
//! them; the async side only ever sees the FEATURED world's `TickFrame`s.

use idlin_content::ContentDb;
use idlin_protocol::{
    CharacterSheet, CurrencyView, ExitView, GearSlotView, GemView, InvItemView, ObstacleState,
    PropState, TileMapState, TileVisual,
};
use idlin_sim::world::CharacterSheetView;
use idlin_sim::{EntityView, SimEvent, TICK_HZ, TickInputs, World};
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

/// One world's completed tick, with zone identity so any feed can emit a
/// full snapshot at any moment (late joiners, subscription switches).
pub struct TickFrame {
    /// Stable identity of the world this frame came from.
    pub world_key: String,
    pub tick: u64,
    pub zone_name: String,
    pub zone_width: i32,
    pub zone_height: i32,
    pub obstacles: Vec<ObstacleState>,
    /// Authored zones: the resolved tile map (static; shared by Arc).
    pub tiles: Option<Arc<TileMapState>>,
    /// Walk-up exits with live open state.
    pub exits: Vec<ExitView>,
    pub views: Vec<EntityView>,
    pub events: Vec<SimEvent>,
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
    /// Inputs queued for this world's next tick (joins at boot, then
    /// ferried arrivals).
    pub pending: TickInputs,
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
            prop: t.prop.clone(),
            walkable: t.walkable,
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

pub fn spawn_tick_loop(
    mut worlds: Vec<ManagedWorld>,
    frames: UnboundedSender<TickBatch>,
    mut inspect_rx: UnboundedReceiver<InspectRequest>,
    server_tick: Arc<AtomicU64>,
) {
    std::thread::Builder::new()
        .name("idlin-sim".into())
        .spawn(move || {
            let tick_interval = Duration::from_millis(1000 / TICK_HZ as u64);
            loop {
                let started = std::time::Instant::now();

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
                    all_departures.extend(mw.world.take_departures());
                    frames_data.push((i, events));
                }

                // Ferry: each departure becomes an arrival in the world
                // whose zone matches — shared zones are keyed by their
                // zone id; failing that, any world simulating the zone
                // (a returning idler rejoins an existing instance).
                for (bundle, dest) in all_departures {
                    let name = bundle.character.name.clone();
                    let target = worlds
                        .iter_mut()
                        .position(|mw| mw.key == dest)
                        .or_else(|| worlds.iter().position(|mw| mw.zone_id == dest));
                    match target {
                        Some(i) => {
                            info!("ferrying {name} to {}", worlds[i].key);
                            worlds[i].pending.arrivals.push(bundle);
                        }
                        None => warn!("{name} departed for unknown zone {dest}; lost at sea"),
                    }
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
                        zone_width: zw,
                        zone_height: zh,
                        obstacles: mw
                            .world
                            .obstacle_views()
                            .into_iter()
                            .map(|(x, y, radius, kind)| ObstacleState { x, y, radius, kind })
                            .collect(),
                        tiles: mw.tiles.clone(),
                        exits: mw
                            .world
                            .exit_views()
                            .into_iter()
                            .map(|(x, y, open)| ExitView { x, y, open })
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
        block_bp: clamp_i32(v.block),
        kills: v.kills.min(u32::MAX as u64) as u32,
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
            .map(|(slot, item)| {
                let (name, rarity) = item.unwrap_or_default();
                GearSlotView {
                    slot: slot.to_string(),
                    name,
                    rarity,
                }
            })
            .collect(),
        inventory: v
            .inventory
            .into_iter()
            .map(|(name, rarity, x, y, w, h)| InvItemView {
                name,
                rarity,
                x,
                y,
                w,
                h,
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
    }
}
