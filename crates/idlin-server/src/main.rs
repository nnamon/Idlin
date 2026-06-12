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
    /// The featured (director-driven) virtual feed — the default watch.
    featured: replication::FeedHandle,
    /// Per-world feeds for character subscriptions.
    feeds: Arc<std::sync::RwLock<std::collections::HashMap<String, replication::FeedHandle>>>,
    /// Live routing: featured key + character → world key.
    routing: watch::Receiver<replication::Routing>,
    /// Focus-panel inspections, answered by the tick thread.
    inspect: mpsc::UnboundedSender<runner::InspectRequest>,
    /// Pre-serialized passive tree for the map page.
    tree_json: Arc<str>,
}

/// The built-in characters a fresh world starts with.
fn builtin_joins() -> anyhow::Result<TickInputs> {
    let program = idlin_botc::template_grinder()
        .map_err(|e| anyhow::anyhow!("grinder template failed to assemble: {e}"))?;
    let joins = ["Kargan", "Veles", "Mirra"]
        .into_iter()
        .map(|name| JoinRequest {
            name: name.into(),
            program: program.clone(),
        })
        .collect();
    Ok(TickInputs {
        joins,
        arrivals: Vec::new(),
    })
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
    if content.zones.is_empty() {
        warn!(
            "no zones loaded — content/ is missing or empty; the world will \
             be the placeholder Void zone (run from the repository root)"
        );
    }
    info!(
        version = SERVER_VERSION,
        content_hash = format_args!("{:016x}", content.content_hash),
        zones = content.zones.len(),
        monsters = content.monsters.len(),
        brains = content.brains.len(),
        seed,
        "idlin starting"
    );

    // The multi-world layout: one SHARED town (Saltmere) plus a private
    // shore instance per built-in idler. Transfers ferry characters from
    // their instance into the town when the Tidewarden falls.
    // (Snapshot resume is disabled in multi-world mode for now: every
    // boot is a fresh act.)
    let _ = &snapshot_dir;
    // Dev escape hatch: IDLIN_WORLD_OVERRIDE=<zone_id> runs ONE shared
    // world of that zone with every built-in idler in it — how the tile
    // test range (and any future zone) gets eyeballed before going live.
    let worlds = if let Ok(zone_id) = std::env::var("IDLIN_WORLD_OVERRIDE") {
        info!("IDLIN_WORLD_OVERRIDE: running a single {zone_id} world");
        vec![runner::ManagedWorld {
            key: zone_id.clone(),
            zone_id: zone_id.clone(),
            world: World::new_for_zone(seed, &content, &zone_id),
            tiles: runner::resolve_tile_map(&content, &zone_id),
            max_players: content.zone(&zone_id).map_or(0, |z| z.max_players),
            pending: builtin_joins()?,
        }]
    } else {
        let mut worlds = vec![
            runner::ManagedWorld {
                key: "saltmere".into(),
                zone_id: "saltmere".into(),
                world: World::new_for_zone(seed, &content, "saltmere"),
                tiles: runner::resolve_tile_map(&content, "saltmere"),
                max_players: content.zone("saltmere").map_or(0, |z| z.max_players),
                pending: TickInputs::default(),
            },
            // The shared grinding ground past town: one Drowned Coast
            // for everyone, like the town itself.
            runner::ManagedWorld {
                key: "coast".into(),
                zone_id: "coast".into(),
                world: World::new_for_zone(seed ^ 0xC0A57, &content, "coast"),
                tiles: runner::resolve_tile_map(&content, "coast"),
                max_players: content.zone("coast").map_or(0, |z| z.max_players),
                pending: TickInputs::default(),
            },
        ];
        let joins = builtin_joins()?;
        for join in joins.joins {
            let key = format!("withered_shore#{}", join.name);
            // Per-instance seed: every idler gets their own deterministic
            // shore.
            let mut h = 0xcbf29ce484222325u64;
            for b in join.name.bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x100000001b3);
            }
            worlds.push(runner::ManagedWorld {
                key,
                zone_id: "withered_shore".into(),
                world: World::new_for_zone(seed ^ h, &content, "withered_shore"),
                tiles: runner::resolve_tile_map(&content, "withered_shore"),
                max_players: content.zone("withered_shore").map_or(0, |z| z.max_players),
                pending: TickInputs {
                    joins: vec![join],
                    arrivals: Vec::new(),
                },
            });
        }
        worlds
    };
    info!(
        "running {} worlds: {}",
        worlds.len(),
        worlds
            .iter()
            .map(|w| w.key.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );

    let server_tick = Arc::new(AtomicU64::new(0));
    let (frame_tx, frame_rx) = mpsc::unbounded_channel();
    let (inspect_tx, inspect_rx) = mpsc::unbounded_channel();
    runner::spawn_tick_loop(worlds, frame_tx, inspect_rx, server_tick.clone());
    let handles = replication::spawn_replication(frame_rx);

    let tree_json: Arc<str> = Arc::from(tree_to_json(&content));
    let state = AppState {
        server_tick,
        featured: handles.featured,
        feeds: handles.feeds,
        routing: handles.routing,
        inspect: inspect_tx,
        tree_json,
    };
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/tree", get(tree_handler))
        .route("/healthz", get(|| async { "ok" }))
        // World journals (IDLIN_RECORD=1): playable via ?replay=/recordings/<file>.
        .nest_service("/recordings", ServeDir::new("data/recordings"))
        .fallback_service(ServeDir::new("web/dist"))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("idlin-server v{SERVER_VERSION} listening on http://{addr} (ws at /ws)");
    // Hand-rolled accept loop so every connection gets TCP_NODELAY:
    // axum::serve leaves Nagle ON, and a 10 Hz stream of small frames
    // under Nagle + delayed ACKs arrives in 40-200 ms BURSTS — visible
    // stagger, and ping reads inflated because the pong queues behind
    // the same coalescing.
    loop {
        let (stream, _peer) = listener.accept().await?;
        let _ = stream.set_nodelay(true);
        let tower_svc = app.clone();
        tokio::spawn(async move {
            let socket = hyper_util::rt::TokioIo::new(stream);
            let svc = hyper_util::service::TowerToHyperService::new(tower_svc);
            let _ =
                hyper_util::server::conn::auto::Builder::new(hyper_util::rt::TokioExecutor::new())
                    .serve_connection_with_upgrades(socket, svc)
                    .await;
        });
    }
}

/// The passive tree as JSON for the map page: nodes + resolved edges.
fn tree_to_json(content: &ContentDb) -> String {
    let nodes: Vec<serde_json::Value> = content
        .tree
        .iter()
        .map(|n| {
            serde_json::json!({
                "id": n.id,
                "num": n.num,
                "name": n.name,
                "kind": n.kind,
                "x": n.pos.0,
                "y": n.pos.1,
                "grants": n.grants,
            })
        })
        .collect();
    let mut edges: Vec<[u32; 2]> = Vec::new();
    for (i, adj) in content.tree_adj.iter().enumerate() {
        for &j in adj {
            if (i as u32) < j {
                edges.push([i as u32, j]);
            }
        }
    }
    serde_json::json!({ "nodes": nodes, "edges": edges }).to_string()
}

async fn tree_handler(State(state): State<AppState>) -> impl axum::response::IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        state.tree_json.to_string(),
    )
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut tx, mut rx) = socket.split();

    // Every connection holds ONE subscription: the featured broadcast by
    // default, or — when Hello names a character to watch — the feed of
    // whichever world contains them, re-routed live as they transfer.
    let mut feed = state.featured.broadcast.subscribe();
    let mut my_snapshot = state.featured.snapshot.clone();
    let mut routing = state.routing.clone();
    let mut watch_name: Option<String> = None;
    let mut current_key: Option<String> = None; // None = the featured feed

    let mut welcomed = false;
    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                let Message::Text(text) = msg else { continue };
                let reply = match serde_json::from_str::<C2S>(&text) {
                    Ok(C2S::Hello { proto_version, watch, .. }) => {
                        if proto_version != PROTO_VERSION {
                            S2C::Error {
                                code: 1,
                                msg: format!(
                                    "protocol mismatch: server v{PROTO_VERSION}, client v{proto_version}"
                                ),
                            }
                        } else {
                            welcomed = true;
                            watch_name = watch;
                            S2C::Welcome {
                                role: Role::Owner,
                                proto_version: PROTO_VERSION,
                                server_tick: state.server_tick.load(Ordering::Relaxed),
                                server_version: SERVER_VERSION.to_string(),
                            }
                        }
                    }
                    Ok(C2S::Ping { nonce }) => S2C::Pong {
                        nonce,
                        server_tick: state.server_tick.load(Ordering::Relaxed),
                    },
                    Ok(C2S::DirectorMode { .. }) => continue, // client-side concern in Phase 1
                    Ok(C2S::Inspect { id }) => {
                        // Featured viewers inspect in whichever world the
                        // director's camera is on RIGHT NOW — the runner's
                        // own fallback pick can disagree with the broadcast.
                        let key = current_key.clone().or_else(|| {
                            let f = routing.borrow().featured.clone();
                            (!f.is_empty()).then_some(f)
                        });
                        let (tx_r, rx_r) = tokio::sync::oneshot::channel();
                        let _ = state.inspect.send((key, id, tx_r));
                        match tokio::time::timeout(std::time::Duration::from_millis(300), rx_r)
                            .await
                        {
                            Ok(Ok(Some(sheet))) => S2C::CharacterSheet { sheet },
                            _ => S2C::Error {
                                code: 3,
                                msg: format!("no character {id}"),
                            },
                        }
                    }
                    Err(e) => S2C::Error { code: 2, msg: format!("bad message: {e}") },
                };
                let is_welcome = welcomed && matches!(reply, S2C::Welcome { .. });
                let json = serde_json::to_string(&reply).expect("protocol always serializes");
                if tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
                // Right after Welcome: bind the subscription and deliver
                // that feed's current snapshot.
                if is_welcome {
                    if let Some(name) = &watch_name {
                        let key = routing.borrow().by_character.get(name).cloned();
                        match key.and_then(|k| {
                            state.feeds.read().expect("feeds lock").get(&k).cloned().map(|f| (k, f))
                        }) {
                            Some((key, handle)) => {
                                feed = handle.broadcast.subscribe();
                                my_snapshot = handle.snapshot.clone();
                                current_key = Some(key);
                            }
                            None => {
                                let err = serde_json::to_string(&S2C::Error {
                                    code: 4,
                                    msg: format!("no character named {name}; showing the broadcast"),
                                }).expect("protocol always serializes");
                                if tx.send(Message::Text(err.into())).await.is_err() {
                                    break;
                                }
                                watch_name = None;
                            }
                        }
                    }
                    let snap = my_snapshot.borrow().clone();
                    if tx.send(Message::Text(snap.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
            // A watched character moved worlds: follow them.
            changed = routing.changed(), if watch_name.is_some() => {
                if changed.is_err() { break; }
                let Some(name) = &watch_name else { continue };
                let key = routing.borrow().by_character.get(name).cloned();
                if key == current_key || key.is_none() {
                    continue;
                }
                let key = key.unwrap();
                let handle = state.feeds.read().expect("feeds lock").get(&key).cloned();
                if let Some(handle) = handle {
                    feed = handle.broadcast.subscribe();
                    my_snapshot = handle.snapshot.clone();
                    current_key = Some(key);
                    let snap = my_snapshot.borrow().clone();
                    if welcomed
                        && tx.send(Message::Text(snap.to_string().into())).await.is_err()
                    {
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
                        let snap = my_snapshot.borrow().clone();
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
