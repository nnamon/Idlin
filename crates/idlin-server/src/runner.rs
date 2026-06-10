//! The tick loop: a dedicated OS thread driving the pure sim at a fixed
//! cadence. The async side only ever sees published `TickFrame`s.

use idlin_sim::{EntityView, SimEvent, TICK_HZ, TickInputs, World};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{info, warn};

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
