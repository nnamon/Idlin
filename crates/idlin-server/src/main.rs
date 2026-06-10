//! The Idlin server: the impure shell around the pure sim. Owns wall-clock
//! time, sockets, persistence, and (later) chat; feeds `TickInputs` into the
//! world and fans state out to web clients.

mod director;
mod persist;
mod replication;
mod runner;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    routing::get,
};
use futures_util::{SinkExt, StreamExt};
use idlin_content::ContentDb;
use idlin_protocol::{C2S, PROTO_VERSION, Role, S2C};
use idlin_sim::{JoinRequest, TickInputs, World};
use tokio::sync::{broadcast, mpsc, watch};
use tower_http::services::ServeDir;
use tracing::{info, warn};

pub const SERVER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
struct AppState {
    server_tick: Arc<AtomicU64>,
    broadcast: broadcast::Sender<replication::Frame>,
    snapshot: watch::Receiver<replication::Frame>,
}

/// The four built-in characters a fresh world starts with.
fn builtin_joins() -> anyhow::Result<TickInputs> {
    let program = idlin_botc::template_grinder()
        .map_err(|e| anyhow::anyhow!("grinder template failed to assemble: {e}"))?;
    let joins = ["Kargan", "Veles", "Mirra", "Thane"]
        .into_iter()
        .map(|name| JoinRequest {
            name: name.into(),
            program: program.clone(),
        })
        .collect();
    Ok(TickInputs { joins })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let seed: u64 = std::env::var("IDLIN_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0xC0FFEE);
    let port: u16 = std::env::var("IDLIN_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(7777);
    let snapshot_dir =
        PathBuf::from(std::env::var("IDLIN_DATA").unwrap_or_else(|_| "data/snapshots".into()));

    let content = match ContentDb::load(std::path::Path::new("content")) {
        Ok(db) => db,
        Err(e) => {
            warn!("failed to load content/: {e}; starting with empty content");
            ContentDb::empty()
        }
    };
    info!(
        version = SERVER_VERSION,
        content_hash = format_args!("{:016x}", content.content_hash),
        zones = content.zones.len(),
        monsters = content.monsters.len(),
        brains = content.brains.len(),
        seed,
        "idlin starting"
    );

    // Resume from snapshot when possible; otherwise a fresh world with the
    // built-in cast joining on tick 1.
    let (world, first_inputs) = match persist::load_world(&content, &snapshot_dir) {
        Some(world) => (world, None),
        None => (World::new(seed, &content), Some(builtin_joins()?)),
    };
    let zone_name = world.zone_name().to_string();
    let (zone_w, zone_h) = world.zone_size_raw();

    let server_tick = Arc::new(AtomicU64::new(world.tick_count()));
    let (frame_tx, frame_rx) = mpsc::unbounded_channel();
    runner::spawn_tick_loop(
        world,
        first_inputs,
        frame_tx,
        server_tick.clone(),
        snapshot_dir,
    );
    let handles = replication::spawn_replication(frame_rx, zone_name, zone_w, zone_h);

    let state = AppState {
        server_tick,
        broadcast: handles.broadcast,
        snapshot: handles.snapshot,
    };
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(ServeDir::new("web/dist"))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("idlin-server v{SERVER_VERSION} listening on http://{addr} (ws at /ws)");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut tx, mut rx) = socket.split();
    let mut feed = state.broadcast.subscribe();

    // Phase 1: every connection is the owner view. Hello → Welcome + snapshot,
    // then the live delta stream; Pings answered inline.
    let mut welcomed = false;
    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                let Message::Text(text) = msg else { continue };
                let reply = match serde_json::from_str::<C2S>(&text) {
                    Ok(C2S::Hello { proto_version, .. }) => {
                        if proto_version != PROTO_VERSION {
                            S2C::Error {
                                code: 1,
                                msg: format!(
                                    "protocol mismatch: server v{PROTO_VERSION}, client v{proto_version}"
                                ),
                            }
                        } else {
                            welcomed = true;
                            S2C::Welcome {
                                role: Role::Owner,
                                proto_version: PROTO_VERSION,
                                server_version: SERVER_VERSION.to_string(),
                                server_tick: state.server_tick.load(Ordering::Relaxed),
                            }
                        }
                    }
                    Ok(C2S::Ping { nonce }) => S2C::Pong {
                        nonce,
                        server_tick: state.server_tick.load(Ordering::Relaxed),
                    },
                    Ok(C2S::DirectorMode { .. }) => continue, // client-side concern in Phase 1
                    Err(e) => S2C::Error { code: 2, msg: format!("bad message: {e}") },
                };
                let is_welcome = welcomed && matches!(reply, S2C::Welcome { .. });
                let json = serde_json::to_string(&reply).expect("protocol always serializes");
                if tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
                // Right after Welcome, deliver the current world snapshot.
                if is_welcome {
                    let snap = state.snapshot.borrow().clone();
                    if tx.send(Message::Text(snap.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
            frame = feed.recv() => {
                match frame {
                    Ok(frame) if welcomed => {
                        if tx.send(Message::Text(frame.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {} // not welcomed yet; drop frames
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Fell behind: self-heal with a fresh snapshot.
                        warn!("client lagged {n} frames; resyncing with snapshot");
                        let snap = state.snapshot.borrow().clone();
                        if welcomed
                            && tx.send(Message::Text(snap.to_string().into())).await.is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}
