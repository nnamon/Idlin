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
use tower_http::services::{ServeDir, ServeFile};
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
    /// Pre-serialized deploy identity for `/version` (fixed at boot).
    version_json: Arc<str>,
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

/// Load gameplay content, failing CLOSED. A present-but-broken content tree (a
/// parse / IO / registry error) is FATAL: running with empty content would
/// silently produce a divergent deterministic world and write snapshots against
/// the wrong content hash. A *missing* tree is not an error — `ContentDb::load`
/// returns an empty db (an absent dir collects no files), and the caller warns
/// and runs the placeholder Void zone (the wrong-CWD dev path).
fn load_content(dir: &std::path::Path) -> anyhow::Result<ContentDb> {
    use anyhow::Context;
    ContentDb::load(dir).with_context(|| {
        format!(
            "content/ at {} failed to load — refusing to start with empty \
             content (it would diverge the world). Run from the repository root.",
            dir.display()
        )
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

    let content = load_content(std::path::Path::new("content"))?;
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
    // their instance into the town when the Tidewarden falls. Each world
    // RESUMES from its snapshot when one exists for this content hash.
    // Dev escape hatch: IDLIN_WORLD_OVERRIDE=<zone_id> runs ONE shared
    // world of that zone with every built-in idler in it (no
    // persistence) — how new zones get eyeballed before going live.
    let mut persistence: Option<PathBuf> = Some(snapshot_dir.clone());
    let worlds = if let Ok(zone_id) = std::env::var("IDLIN_WORLD_OVERRIDE") {
        persistence = None;
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
            let mut h = idlin_content::FNV1A_OFFSET;
            for b in join.name.bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(idlin_content::FNV1A_PRIME);
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
        // RESUME: swap in snapshots where they exist (content-hash
        // gated), carry mid-ferry arrivals, and only join a builtin
        // idler if they exist NOWHERE (state, pendings, or another
        // world — a finished pupil lives in town, not on the shore).
        let mut resident: Vec<String> = Vec::new();
        for mw in &mut worlds {
            let dir = persist::world_dir(&snapshot_dir, &mw.key);
            if let Some((world, pendings)) = persist::load_managed(&content, &dir) {
                info!(
                    "resuming {} at tick {} (+{} in-flight arrivals)",
                    mw.key,
                    world.tick_count(),
                    pendings.len()
                );
                mw.world = world;
                mw.pending.arrivals.extend(pendings);
            }
            for v in mw.world.views() {
                if v.kind == 1 {
                    resident.push(v.name);
                }
            }
            for b in &mw.pending.arrivals {
                resident.push(b.character.name.clone());
            }
        }
        for mw in &mut worlds {
            mw.pending.joins.retain(|j| {
                let fresh = !resident.contains(&j.name);
                if !fresh {
                    info!("{} already exists; skipping boot join", j.name);
                }
                fresh
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
    // Graceful shutdown: SIGINT/SIGTERM flag the tick thread, which
    // saves every world and exits — a deploy's pkill loses nothing.
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let flag = shutdown.clone();
        tokio::spawn(async move {
            let ctrl_c = tokio::signal::ctrl_c();
            #[cfg(unix)]
            {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("install SIGTERM handler");
                tokio::select! {
                    _ = ctrl_c => {}
                    _ = term.recv() => {}
                }
            }
            #[cfg(not(unix))]
            {
                let _ = ctrl_c.await;
            }
            tracing::info!("shutdown signal: saving worlds…");
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        });
    }
    // Deploy identity for `/version`, fixed at boot (captured before `worlds`
    // moves into the tick loop). Lets an operator tell at a glance whether the
    // binary, protocol, and content actually match the expected deploy.
    // `git_sha` is populated when the build sets IDLIN_GIT_SHA, null otherwise.
    let version_json: Arc<str> = Arc::from(version_payload(
        content.content_hash,
        worlds.len(),
        option_env!("IDLIN_GIT_SHA"),
    ));

    runner::spawn_tick_loop(
        worlds,
        frame_tx,
        inspect_rx,
        server_tick.clone(),
        persistence,
        shutdown,
    );
    let handles = replication::spawn_replication(frame_rx);

    let tree_json: Arc<str> = Arc::from(tree_to_json(&content));
    let state = AppState {
        server_tick,
        featured: handles.featured,
        feeds: handles.feeds,
        routing: handles.routing,
        inspect: inspect_tx,
        tree_json,
        version_json,
    };
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/tree", get(tree_handler))
        .route("/healthz", get(|| async { "ok" }))
        .route("/version", get(version_handler))
        // World journals (IDLIN_RECORD=1): playable via ?replay=/recordings/<file>.
        .nest_service("/recordings", ServeDir::new("data/recordings"))
        // SPA shell for the client's OWN routes (the individual idler view +
        // management page, #79): /idler/<name>[/manage] serve index.html so the
        // client routes on the path. Scoped to /idler so a genuine static miss
        // (e.g. a stale /assets/* hash) still 404s instead of 200-ing HTML.
        .nest_service("/idler", ServeFile::new("web/dist/index.html"))
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

/// Build the `/version` payload: the running deploy's identity. Pure (no I/O,
/// `git_sha` injected) so both the set and unset cases are unit-testable.
fn version_payload(content_hash: u64, world_count: usize, git_sha: Option<&str>) -> String {
    serde_json::json!({
        "server_version": SERVER_VERSION,
        "proto_version": PROTO_VERSION,
        "content_hash": format!("{content_hash:016x}"),
        "world_count": world_count,
        "git_sha": git_sha,
    })
    .to_string()
}

/// `/version`: the running deploy's identity (server/proto version, content hash,
/// world count, optional git SHA) so a bad deploy is visible, not silently live.
async fn version_handler(State(state): State<AppState>) -> impl axum::response::IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        state.version_json.to_string(),
    )
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

/// Choose which world an Inspect resolves against. The client knows exactly
/// which world it is displaying and sends it (`zone.worldKey`); honor that —
/// net ids are per-world and overlap, so resolving in any other world returns a
/// different character's sheet (#52). Only when the client sends nothing do we
/// fall back to this connection's followed world, then the director's featured.
fn inspect_world_key(provided: &str, current: Option<&str>, featured: &str) -> Option<String> {
    if !provided.is_empty() {
        return Some(provided.to_string());
    }
    if let Some(c) = current {
        return Some(c.to_string());
    }
    (!featured.is_empty()).then(|| featured.to_string())
}

/// Which world an Inspect resolves in. A WATCH connection is confined to its
/// bound idler's world — it ignores the client-supplied `provided` world_key and
/// never falls back to `featured` (#79 privacy: a pinned/unbound viewer must not
/// pull sheets from the broadcast); unbound (no `current`) → None, nothing to
/// inspect. A broadcast connection resolves the world it is displaying.
fn inspect_key(
    is_watch: bool,
    provided: &str,
    current: Option<&str>,
    featured: &str,
) -> Option<String> {
    if is_watch {
        return current.map(str::to_string);
    }
    inspect_world_key(provided, current, featured)
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
                            // Loud, because a silent reject is the "viewer shows
                            // nothing" footgun (#51): a stale server vs a fresh
                            // client after a PROTO bump. `just redeploy` prevents
                            // it; this makes a missed redeploy obvious in the log.
                            warn!(
                                "rejected client: protocol mismatch (server v{PROTO_VERSION}, \
                                 client v{proto_version}) — redeploy the server (`just redeploy`)"
                            );
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
                    Ok(C2S::Inspect { id, world_key }) => {
                        // A WATCH connection may inspect ONLY its bound idler's
                        // world (#79 privacy): ignore the client-supplied world_key
                        // and NEVER fall back to the featured world — otherwise an
                        // unbound or pinned viewer could pull sheets from the
                        // broadcast. Unbound → nothing to inspect yet. A BROADCAST
                        // connection resolves the world it's displaying (its own
                        // zone.worldKey; net ids are per-world, so the server can't
                        // guess), falling back to the featured world only then.
                        let key = inspect_key(
                            watch_name.is_some(),
                            &world_key,
                            current_key.as_deref(),
                            &routing.borrow().featured,
                        );
                        match key {
                            Some(key) => {
                                let (tx_r, rx_r) = tokio::sync::oneshot::channel();
                                let _ = state.inspect.send((Some(key), id, tx_r));
                                match tokio::time::timeout(
                                    std::time::Duration::from_millis(300),
                                    rx_r,
                                )
                                .await
                                {
                                    Ok(Ok(Some(sheet))) => S2C::CharacterSheet { sheet },
                                    _ => S2C::Error {
                                        code: 3,
                                        msg: format!("no character {id}"),
                                    },
                                }
                            }
                            None => S2C::Error {
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
                                // The idler's world feed isn't online yet (early
                                // connect before the routing table fills, or an
                                // unknown name). Do NOT fall back to the broadcast:
                                // an individual view is ONE idler only — no director
                                // cues, no other idlers' streams. Keep watch_name so
                                // the routing.changed arm binds the world feed the
                                // moment that idler appears; until then frames are
                                // gated off below (#79).
                                let err = serde_json::to_string(&S2C::Error {
                                    code: 4,
                                    msg: format!("character {name} is not streaming yet; waiting"),
                                }).expect("protocol always serializes");
                                if tx.send(Message::Text(err.into())).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                    // Send the bound feed's snapshot — but skip it for a watch that
                    // hasn't bound a world yet (current_key None): my_snapshot is
                    // still the featured one, and an individual view must never
                    // receive the broadcast. routing.changed sends the world
                    // snapshot once it binds.
                    if watch_name.is_none() || current_key.is_some() {
                        let snap = my_snapshot.borrow().clone();
                        if tx.send(Message::Text(snap.to_string().into())).await.is_err() {
                            break;
                        }
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
                    // Broadcast (no watch) or a BOUND watch only — an unbound watch
                    // still defaults to the featured subscription but must never
                    // forward it (one idler only: no director cues, no other
                    // idlers' streams, #79).
                    Ok(frame) if welcomed && (watch_name.is_none() || current_key.is_some()) => {
                        if tx.send(Message::Text(frame.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {} // pre-welcome, or an unbound watch: drop frames
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Fell behind: self-heal with a fresh snapshot — but not for
                        // an unbound watch (its snapshot is the featured one).
                        warn!("client lagged {n} frames; resyncing with snapshot");
                        if welcomed && (watch_name.is_none() || current_key.is_some()) {
                            let snap = my_snapshot.borrow().clone();
                            if tx.send(Message::Text(snap.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        PROTO_VERSION, SERVER_VERSION, inspect_key, inspect_world_key, load_content,
        version_payload,
    };

    #[test]
    fn version_payload_carries_deploy_identity() {
        // git_sha set → emitted as that string.
        let v: serde_json::Value =
            serde_json::from_str(&version_payload(0xABCD_EF12, 3, Some("abc123")))
                .expect("valid json");
        assert_eq!(v["server_version"], SERVER_VERSION);
        assert_eq!(v["proto_version"], PROTO_VERSION);
        // content_hash is the zero-padded 16-hex render of the u64.
        assert_eq!(v["content_hash"], "00000000abcdef12");
        assert_eq!(v["world_count"], 3);
        assert_eq!(v["git_sha"], "abc123");
        // git_sha unset → JSON null (key present, value null), not a string/bool.
        let unset: serde_json::Value =
            serde_json::from_str(&version_payload(0, 0, None)).expect("valid json");
        assert!(unset["git_sha"].is_null());
    }

    #[test]
    fn content_load_fails_closed_on_a_broken_tree() {
        use std::fs;
        // A present-but-malformed content tree must be FATAL, not silently empty:
        // empty content would diverge the deterministic world (#63).
        let dir = std::env::temp_dir().join(format!("idlin-content-broken-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("zones")).unwrap();
        fs::write(dir.join("zones/bad.ron"), b"this is not valid RON (((").unwrap();
        assert!(
            load_content(&dir).is_err(),
            "a broken content tree is fatal"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_content_is_not_fatal_just_empty() {
        // A missing tree (wrong CWD) is allowed: load returns an empty db and the
        // caller warns + runs the Void zone. Only a *broken* tree is fatal.
        let dir =
            std::env::temp_dir().join(format!("idlin-content-absent-{}-nope", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let db = load_content(&dir).expect("a missing content tree is allowed (empty)");
        assert!(
            db.zones.is_empty(),
            "missing content yields an empty db, not an error"
        );
    }

    #[test]
    fn inspect_resolves_in_the_clients_displayed_world() {
        // The client names its displayed world → use it, even when the director
        // has rotated to a different featured world (the #52 bug: a per-world
        // net id resolved against the wrong world = another character's sheet).
        assert_eq!(
            inspect_world_key("withered_shore#Kargan", None, "withered_shore#Veles"),
            Some("withered_shore#Kargan".to_string()),
        );
        // ...and even over an explicit follow.
        assert_eq!(
            inspect_world_key("withered_shore#Kargan", Some("saltmere"), "coast"),
            Some("withered_shore#Kargan".to_string()),
        );
    }

    #[test]
    fn inspect_falls_back_when_client_sends_no_world() {
        // No client world → this connection's followed world, then featured.
        assert_eq!(
            inspect_world_key("", Some("saltmere"), "coast"),
            Some("saltmere".to_string()),
        );
        assert_eq!(
            inspect_world_key("", None, "coast"),
            Some("coast".to_string())
        );
        assert_eq!(inspect_world_key("", None, ""), None);
    }

    #[test]
    fn watch_inspect_is_confined_to_its_bound_world() {
        // A WATCH connection inspects ONLY its bound idler's world (#79 privacy):
        // it ignores the client-supplied world_key and never falls back to the
        // featured world. Mutation: drop the is_watch branch and an unbound watch
        // resolves `featured` (the leak the critic found) → these fail.
        // Unbound watch → nothing to inspect, despite a provided/featured world.
        assert_eq!(inspect_key(true, "", None, "featured#w"), None);
        assert_eq!(inspect_key(true, "some#other", None, "featured#w"), None);
        // Bound watch → ALWAYS the bound world, ignoring the client world_key.
        assert_eq!(
            inspect_key(true, "some#other", Some("kargan#w"), "featured#w").as_deref(),
            Some("kargan#w"),
        );
        // A broadcast connection keeps the displayed-world / featured behaviour.
        assert_eq!(
            inspect_key(false, "shown#w", None, "featured#w").as_deref(),
            Some("shown#w"),
        );
        assert_eq!(
            inspect_key(false, "", None, "featured#w").as_deref(),
            Some("featured#w"),
        );
    }
}
