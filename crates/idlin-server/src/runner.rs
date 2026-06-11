//! The tick loop: a dedicated OS thread driving the pure sims at a fixed
//! cadence. The server runs MANY worlds — the shared town plus per-idler
//! zone instances — ticking them all and ferrying zone transfers between
//! them; the async side only ever sees the FEATURED world's `TickFrame`s.

use idlin_protocol::{
    CharacterSheet, CurrencyView, GearSlotView, GemView, InvItemView, ObstacleState,
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
/// the pure sim never crosses a thread boundary.
pub type InspectRequest = (u32, oneshot::Sender<Option<CharacterSheet>>);

/// Everything the replication side needs from one completed tick of the
/// featured world. Zone identity rides along so replication can reset and
/// resend a full snapshot whenever the featured world changes.
pub struct TickFrame {
    /// Stable identity of the world this frame came from.
    pub world_key: String,
    pub tick: u64,
    pub zone_name: String,
    pub zone_width: i32,
    pub zone_height: i32,
    pub obstacles: Vec<ObstacleState>,
    pub views: Vec<EntityView>,
    pub events: Vec<SimEvent>,
}

/// One world under management: the shared town, or a per-idler instance.
pub struct ManagedWorld {
    /// Unique key ("saltmere", "withered_shore#Kargan").
    pub key: String,
    /// The ZoneDef id this world simulates (transfer destinations match it).
    pub zone_id: String,
    pub world: World,
    /// Inputs queued for this world's next tick (joins at boot, then
    /// ferried arrivals).
    pub pending: TickInputs,
}

pub fn spawn_tick_loop(
    mut worlds: Vec<ManagedWorld>,
    frames: UnboundedSender<TickFrame>,
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

                // The featured world's full event stream, plus the GLOBAL
                // announcements from every other world (arrivals,
                // departures, town narration) so the ticker never misses a
                // crossing just because the camera was elsewhere.
                let mut events: Vec<SimEvent> = Vec::new();
                for (i, evs) in frames_data {
                    if i == featured {
                        events.extend(evs);
                    } else {
                        events.extend(evs.into_iter().filter(|ev| {
                            matches!(
                                ev,
                                SimEvent::CharacterDeparted { .. }
                                    | SimEvent::CharacterJoined { .. }
                                    | SimEvent::Narration { .. }
                            )
                        }));
                    }
                }

                let mw = &worlds[featured];
                let tick = mw.world.tick_count();
                server_tick.store(tick, Ordering::Relaxed);
                let (zw, zh) = mw.world.zone_size_raw();
                let frame = TickFrame {
                    world_key: mw.key.clone(),
                    tick,
                    zone_name: mw.world.zone_name().to_string(),
                    zone_width: zw,
                    zone_height: zh,
                    obstacles: mw
                        .world
                        .obstacle_views()
                        .into_iter()
                        .map(|(x, y, radius, kind)| ObstacleState { x, y, radius, kind })
                        .collect(),
                    views: mw.world.views(),
                    events,
                };
                // Replication gone (shutdown) → stop simulating.
                if frames.send(frame).is_err() {
                    info!("replication channel closed; tick loop exiting");
                    return;
                }

                // Focus-panel inspections answer from the featured world
                // (its ids are the ones on screen).
                while let Ok((id, reply)) = inspect_rx.try_recv() {
                    let _ = reply.send(
                        worlds[featured]
                            .world
                            .character_sheet(id)
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
