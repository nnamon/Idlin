//! The Idlin server: the impure shell around the pure sim. Owns wall-clock
//! time, sockets, persistence, and chat; feeds `TickInputs` into the world
//! and fans state out to web clients.
//!
//! Phase 0: a real 10 Hz tick loop driving the (still skeletal) world, a
//! WebSocket endpoint speaking Hello/Ping → Welcome/Pong, and static serving
//! of the built frontend.

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use axum::{
    Router,
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
    routing::get,
};
use idlin_content::ContentDb;
use idlin_protocol::{C2S, PROTO_VERSION, Role, S2C};
use idlin_sim::{TICK_HZ, TickInputs, World};
use tower_http::services::ServeDir;
use tracing::{info, warn};

#[derive(Clone)]
struct AppState {
    /// Latest completed sim tick, published by the tick loop.
    server_tick: Arc<AtomicU64>,
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

    let content = match ContentDb::load(std::path::Path::new("content")) {
        Ok(db) => db,
        Err(e) => {
            warn!("failed to load content/: {e}; starting with empty content");
            ContentDb::empty()
        }
    };
    info!(
        content_hash = format_args!("{:016x}", content.content_hash),
        seed, "world configuration"
    );

    let server_tick = Arc::new(AtomicU64::new(0));
    spawn_tick_loop(seed, content, server_tick.clone());

    let state = AppState { server_tick };
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/healthz", get(|| async { "ok" }))
        .fallback_service(ServeDir::new("web/dist"))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("idlin-server listening on http://{addr} (ws at /ws)");
    axum::serve(listener, app).await?;
    Ok(())
}

/// The sim runs on its own thread at a fixed cadence; the async side only
/// ever observes published results. (Replication channels replace the bare
/// atomic in Phase 1.)
fn spawn_tick_loop(seed: u64, content: ContentDb, server_tick: Arc<AtomicU64>) {
    std::thread::spawn(move || {
        let mut world = World::new(seed, &content);
        let tick_interval = Duration::from_millis(1000 / TICK_HZ as u64);
        let inputs = TickInputs::default();
        loop {
            let started = std::time::Instant::now();
            let _events = world.tick(&inputs);
            server_tick.store(world.tick_count(), Ordering::Relaxed);
            // Fixed cadence with drop-behind: if a tick overruns we don't
            // try to repay the debt all at once (catch-up policy is Phase 1).
            std::thread::sleep(tick_interval.saturating_sub(started.elapsed()));
        }
    });
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    while let Some(Ok(msg)) = socket.recv().await {
        let Message::Text(text) = msg else { continue };
        let reply = match serde_json::from_str::<C2S>(&text) {
            Ok(C2S::Hello { proto_version, .. }) => {
                if proto_version != PROTO_VERSION {
                    S2C::Error {
                        code: 1,
                        msg: format!(
                            "protocol mismatch: server {PROTO_VERSION}, client {proto_version}"
                        ),
                    }
                } else {
                    // Token → role mapping arrives with sessions in Phase 2;
                    // every Phase 0 connection is the owner view.
                    S2C::Welcome {
                        role: Role::Owner,
                        proto_version: PROTO_VERSION,
                        server_tick: state.server_tick.load(Ordering::Relaxed),
                    }
                }
            }
            Ok(C2S::Ping { nonce }) => S2C::Pong {
                nonce,
                server_tick: state.server_tick.load(Ordering::Relaxed),
            },
            Err(e) => S2C::Error {
                code: 2,
                msg: format!("bad message: {e}"),
            },
        };
        let json = serde_json::to_string(&reply).expect("protocol types always serialize");
        if socket.send(Message::Text(json.into())).await.is_err() {
            break;
        }
    }
}
