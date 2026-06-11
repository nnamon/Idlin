//! The tick loop: a dedicated OS thread driving the pure sim at a fixed
//! cadence. The async side only ever sees published `TickFrame`s.

use idlin_protocol::{CharacterSheet, GearSlotView, GemView, InvItemView};
use idlin_sim::world::CharacterSheetView;
use idlin_sim::{EntityView, SimEvent, TICK_HZ, TickInputs, World};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;
use tracing::{info, warn};

/// A focus-panel inspection: answered by the tick thread between ticks so
/// the pure sim never crosses a thread boundary.
pub type InspectRequest = (u32, oneshot::Sender<Option<CharacterSheet>>);

/// Everything the replication side needs from one completed tick.
pub struct TickFrame {
    pub tick: u64,
    pub views: Vec<EntityView>,
    pub events: Vec<SimEvent>,
}

/// Ticks between world snapshots to disk (300 = 30 s).
const SNAPSHOT_EVERY: u64 = 300;

pub fn spawn_tick_loop(
    mut world: World,
    first_inputs: Option<TickInputs>,
    frames: UnboundedSender<TickFrame>,
    mut inspect_rx: UnboundedReceiver<InspectRequest>,
    server_tick: Arc<AtomicU64>,
    snapshot_dir: PathBuf,
) {
    std::thread::Builder::new()
        .name("idlin-sim".into())
        .spawn(move || {
            let tick_interval = Duration::from_millis(1000 / TICK_HZ as u64);
            let empty = TickInputs::default();
            let mut first_inputs = first_inputs;
            loop {
                let started = std::time::Instant::now();
                let inputs = first_inputs.take();
                let events = world.tick(inputs.as_ref().unwrap_or(&empty));
                let tick = world.tick_count();
                server_tick.store(tick, Ordering::Relaxed);

                for ev in &events {
                    if let SimEvent::JoinRejected { name, reason } = ev {
                        warn!("join rejected for {name}: {reason}");
                    }
                }

                // Replication gone (shutdown) → stop simulating.
                if frames
                    .send(TickFrame {
                        tick,
                        views: world.views(),
                        events,
                    })
                    .is_err()
                {
                    info!("replication channel closed; tick loop exiting");
                    return;
                }

                // Focus-panel inspections, answered against the fresh state.
                while let Ok((id, reply)) = inspect_rx.try_recv() {
                    let _ = reply.send(world.character_sheet(id).map(sheet_to_proto));
                }

                if tick.is_multiple_of(SNAPSHOT_EVERY)
                    && let Err(e) = crate::persist::save_world(&world, &snapshot_dir)
                {
                    warn!("snapshot save failed: {e:#}");
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
        passive_allocated: v.passive_allocated,
        passive_unspent: v.passive_unspent,
        build_len: v.build_len,
    }
}
