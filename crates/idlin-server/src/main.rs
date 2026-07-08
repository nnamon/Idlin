//! The Idlin server: the impure shell around the pure sim. Owns wall-clock
//! time, sockets, persistence, and (later) chat; feeds `TickInputs` into the
//! world and fans state out to web clients.

use idlin_server::{persist, replication, runner};

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
    /// Admin surface (#148 A6): deploy / kill / leaderboard.
    admin: mpsc::UnboundedSender<runner::AdminCommand>,
    /// Shared secret for the mutating admin routes; None = routes disabled.
    admin_token: Option<Arc<str>>,
    /// The kill-cam ring (#148 A7), fed by replication.
    killcams: Arc<std::sync::RwLock<std::collections::VecDeque<replication::KillCam>>>,
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
        removals: Vec::new(),
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
        // The world set derives from CONTENT via runner::boot_worlds (#136
        // T3) — shipping a new zone never needs a server change again.
        let joins = builtin_joins()?;
        let mut worlds = runner::boot_worlds(&content, seed, &joins.joins);
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
        // Chart voyages (#136 T4): resume any snapshot whose key no booted
        // world claims — the idler mid-voyage survives the restart. Runs
        // AFTER the booted-resume loop so a voyage is never double-loaded;
        // its characters count as residents like anyone else's. The
        // content-hash gate inside load_managed refuses stale content, and
        // only worlds that self-identify as chart instances are accepted.
        let booted: Vec<PathBuf> = worlds
            .iter()
            .map(|mw| persist::world_dir(&snapshot_dir, &mw.key))
            .collect();
        for (key, dir) in persist::scan_world_keys(&snapshot_dir) {
            if booted.contains(&dir) {
                continue;
            }
            let Some((world, pendings)) = persist::load_managed(&content, &dir) else {
                continue;
            };
            if !world.is_chart_instance() {
                continue;
            }
            let zone_id = content.zones[world.zone_index() as usize].id.clone();
            info!("resuming voyage {key} at tick {}", world.tick_count());
            for v in world.views() {
                if v.kind == 1 {
                    resident.push(v.name);
                }
            }
            for b in &pendings {
                resident.push(b.character.name.clone());
            }
            worlds.push(runner::ManagedWorld {
                key,
                zone_id: zone_id.clone(),
                tiles: runner::resolve_tile_map(&content, &zone_id),
                max_players: 1,
                pending: TickInputs {
                    joins: Vec::new(),
                    arrivals: pendings,
                    removals: Vec::new(),
                },
                world,
            });
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

    let (admin_tx, admin_rx) = mpsc::unbounded_channel::<runner::AdminCommand>();
    runner::spawn_tick_loop(
        worlds,
        frame_tx,
        inspect_rx,
        admin_rx,
        server_tick.clone(),
        persistence,
        shutdown,
        content.clone(),
        seed,
    );
    let handles = replication::spawn_replication(frame_rx);

    let tree_json: Arc<str> = Arc::from(tree_to_json(&content));
    let state = AppState {
        server_tick,
        featured: handles.featured,
        feeds: handles.feeds,
        routing: handles.routing,
        inspect: inspect_tx,
        admin: admin_tx,
        admin_token: std::env::var("IDLIN_ADMIN_TOKEN").ok().map(Arc::from),
        killcams: handles.killcams.clone(),
        tree_json,
        version_json,
    };
    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/tree", get(tree_handler))
        .route("/healthz", get(|| async { "ok" }))
        .route("/version", get(version_handler))
        // The bot economy (#148 A6). Deploy/kill demand IDLIN_ADMIN_TOKEN
        // (routes refuse 503 when it is unset — fail closed, no anonymous
        // deploys); the leaderboard is public read.
        .route("/api/deploy", axum::routing::post(deploy_handler))
        .route("/api/kill", axum::routing::post(kill_handler))
        .route("/api/leaderboard", get(leaderboard_handler))
        .route("/api/killcams", get(killcams_handler))
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

#[derive(serde::Deserialize)]
struct DeployBody {
    token: String,
    name: String,
    /// `.bot` source — compiled server-side; errors return verbatim.
    source: String,
}

#[derive(serde::Deserialize)]
struct KillBody {
    token: String,
    name: String,
}

/// Gate a mutating admin route (#148 A6): no configured token = disabled
/// (503), wrong token = 403. Fail closed, never open.
fn admin_gate(state: &AppState, token: &str) -> Result<(), (axum::http::StatusCode, String)> {
    match &state.admin_token {
        None => Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "admin routes disabled: set IDLIN_ADMIN_TOKEN".into(),
        )),
        Some(t) if t.as_ref() == token => Ok(()),
        Some(_) => Err((axum::http::StatusCode::FORBIDDEN, "bad token".into())),
    }
}

async fn deploy_handler(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<DeployBody>,
) -> Result<String, (axum::http::StatusCode, String)> {
    admin_gate(&state, &body.token)?;
    let name = body.name.trim();
    if name.is_empty()
        || name.len() > 24
        || !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "name: 1-24 chars of [A-Za-z0-9_-]".into(),
        ));
    }
    if body.source.len() > 64 * 1024 {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            "source too large (64KB cap)".into(),
        ));
    }
    let program = idlin_botc::compile_deployed(&body.source)
        .map_err(|e| (axum::http::StatusCode::BAD_REQUEST, format!("compile: {e}")))?;
    let (reply, rx) = tokio::sync::oneshot::channel();
    state
        .admin
        .send(runner::AdminCommand::Deploy {
            name: name.to_string(),
            program,
            reply,
        })
        .map_err(|_| {
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "sim gone".into(),
            )
        })?;
    match rx.await {
        Ok(Ok(())) => Ok(format!("{name} walks the shore")),
        Ok(Err(e)) => Err((axum::http::StatusCode::CONFLICT, e)),
        Err(_) => Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "sim gone".into(),
        )),
    }
}

async fn kill_handler(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<KillBody>,
) -> Result<String, (axum::http::StatusCode, String)> {
    admin_gate(&state, &body.token)?;
    let (reply, rx) = tokio::sync::oneshot::channel();
    state
        .admin
        .send(runner::AdminCommand::Kill {
            name: body.name.clone(),
            reply,
        })
        .map_err(|_| {
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "sim gone".into(),
            )
        })?;
    match rx.await {
        Ok(Ok(())) => Ok(format!("{} is recalled", body.name)),
        Ok(Err(e)) => Err((axum::http::StatusCode::NOT_FOUND, e)),
        Err(_) => Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "sim gone".into(),
        )),
    }
}

/// The last 50 boss falls (#148 A7), newest last. With IDLIN_RECORD on,
/// each carries the world journal's line at the kill — the web replay
/// (`?replay=/recordings/<world_key>.jsonl&at=<line>`) jumps straight to it.
async fn killcams_handler(State(state): State<AppState>) -> axum::Json<Vec<replication::KillCam>> {
    axum::Json(
        state
            .killcams
            .read()
            .expect("killcams lock")
            .iter()
            .cloned()
            .collect(),
    )
}

async fn leaderboard_handler(
    State(state): State<AppState>,
) -> Result<axum::Json<Vec<idlin_sim::LeaderRow>>, (axum::http::StatusCode, String)> {
    let (reply, rx) = tokio::sync::oneshot::channel();
    state
        .admin
        .send(runner::AdminCommand::Leaderboard { reply })
        .map_err(|_| {
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "sim gone".into(),
            )
        })?;
    rx.await.map(axum::Json).map_err(|_| {
        (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "sim gone".into(),
        )
    })
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
/// A connection's subscription state — the SINGLE source of truth for what data
/// it may receive (#79 privacy). The leaks this prevents all came from gating
/// distributed across `handle_socket` branches; centralising it here makes the
/// boundary one decision, and unit-testable.
///
/// - `Connecting` — before `Hello`: nothing at all (no frames, snapshot, inspect).
/// - `Broadcast` — `Hello` with no watch: the featured/director feed.
/// - `Watch` — `Hello watch=<name>`: confined to ONE idler. `world` is `None`
///   until that idler's world feed binds (early connect / absent / left); while
///   unbound, frames/snapshot/inspect are all refused. A watch NEVER reads the
///   featured feed, another world, or director cues.
#[derive(Debug, Clone, PartialEq, Eq)]
enum SubState {
    Connecting,
    Broadcast,
    Watch { name: String, world: Option<String> },
}

impl SubState {
    /// May the current feed's frames — or a resync snapshot — reach this client?
    fn may_stream(&self) -> bool {
        matches!(
            self,
            SubState::Broadcast | SubState::Watch { world: Some(_), .. }
        )
    }

    /// The world an `Inspect` resolves in, or `None` to refuse. `Connecting`
    /// refuses (no `Hello` yet — the pre-Hello leak). A `Watch` is confined to its
    /// bound `world`, IGNORING the client-supplied `provided`, and never falls back
    /// to `featured`. `Broadcast` resolves the client's displayed world, else
    /// featured.
    fn inspect_world(&self, provided: &str, featured: &str) -> Option<String> {
        match self {
            SubState::Connecting => None,
            SubState::Watch { world, .. } => world.clone(),
            SubState::Broadcast => inspect_world_key(provided, None, featured),
        }
    }

    /// The watched character name, if this is a watch connection.
    fn watch_name(&self) -> Option<&str> {
        match self {
            SubState::Watch { name, .. } => Some(name),
            _ => None,
        }
    }
}

/// The world key for a watched character, matched CASE-INSENSITIVELY so
/// `/idler/kargan` binds `Kargan`'s world (#79 — an operator-typed URL shouldn't
/// have to match the proper-noun casing). Idler names are unique proper nouns, so
/// at most one key matches (the iteration order can't pick differently). This is
/// the delivery layer — never hashed state — so the map walk is fine here.
fn world_for_watch(routing: &replication::Routing, name: &str) -> Option<String> {
    routing
        .by_character
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut tx, mut rx) = socket.split();

    // ONE subscription per connection; `sub` (SubState) is the single source of
    // truth for what data may reach this client (#79 privacy). The feed + snapshot
    // channel handles are kept in sync with `sub` across (re-)Hello and routing
    // changes; until Hello (`Connecting`), nothing is forwarded.
    let mut sub = SubState::Connecting;
    let mut feed = state.featured.broadcast.subscribe();
    let mut my_snapshot = state.featured.snapshot.clone();
    let mut routing = state.routing.clone();

    loop {
        tokio::select! {
            msg = rx.next() => {
                let Some(Ok(msg)) = msg else { break };
                let Message::Text(text) = msg else { continue };
                let mut welcomed_now = false;
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
                            // A (re-)Hello RESETS the subscription back to the
                            // featured channels; the welcome block below binds a
                            // watch to its idler's world. Resetting first means a
                            // failed (re-)bind can never retain a prior world (#79 —
                            // a repeat Hello must not leak the old idler's
                            // feed/snapshot/inspect).
                            sub = match watch {
                                None => SubState::Broadcast,
                                Some(name) => SubState::Watch { name, world: None },
                            };
                            feed = state.featured.broadcast.subscribe();
                            my_snapshot = state.featured.snapshot.clone();
                            welcomed_now = true;
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
                        // Resolve via the connection's subscription state: pre-Hello
                        // (`Connecting`) refuses; a watch is confined to its bound
                        // world (ignores the client world_key, never falls back to
                        // featured); broadcast resolves the displayed world, else
                        // featured (#79).
                        let key =
                            sub.inspect_world(&world_key, &routing.borrow().featured);
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
                let json = serde_json::to_string(&reply).expect("protocol always serializes");
                if tx.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
                // Right after a successful Hello: bind a watch to its idler's world
                // (if online), then deliver the bound feed's snapshot.
                if welcomed_now {
                    if let SubState::Watch { name, world } = &mut sub {
                        let key = world_for_watch(&routing.borrow(), name.as_str());
                        match key.and_then(|k| {
                            state.feeds.read().expect("feeds lock").get(&k).cloned().map(|f| (k, f))
                        }) {
                            Some((key, handle)) => {
                                feed = handle.broadcast.subscribe();
                                my_snapshot = handle.snapshot.clone();
                                *world = Some(key);
                            }
                            None => {
                                // The idler's world feed isn't online yet (early
                                // connect before the routing table fills, or an
                                // unknown name). Do NOT fall back to the broadcast:
                                // an individual view is ONE idler only — no director
                                // cues, no other idlers' streams. The watch stays
                                // unbound (world None) so frames stay gated off; the
                                // routing.changed arm binds the world feed the moment
                                // that idler appears (#79).
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
                    // Deliver the bound feed's snapshot. `may_stream()` is false for an
                    // unbound watch (its snapshot is still the featured one, which an
                    // individual view must never receive); routing.changed sends the
                    // world snapshot once it binds (#79).
                    if sub.may_stream() {
                        let snap = my_snapshot.borrow().clone();
                        if tx.send(Message::Text(snap.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
            // The watched idler's world changed: appears/moves → bind to it; leaves
            // EVERY world → unbind (world None) so we stop forwarding the world they
            // left (#79 — no stale binding). Frames stay gated off while unbound; a
            // later reappearance re-binds. A watch never falls back to the broadcast.
            changed = routing.changed(), if sub.watch_name().is_some() => {
                if changed.is_err() { break; }
                let SubState::Watch { name, world } = &mut sub else { continue };
                let key = world_for_watch(&routing.borrow(), name.as_str());
                if key.as_deref() == world.as_deref() {
                    continue; // binding unchanged
                }
                match key {
                    Some(k) => {
                        let handle = state.feeds.read().expect("feeds lock").get(&k).cloned();
                        if let Some(handle) = handle {
                            feed = handle.broadcast.subscribe();
                            my_snapshot = handle.snapshot.clone();
                            *world = Some(k);
                            // Only reached post-Hello (sub is Watch), so the welcome
                            // was already sent; deliver the newly-bound snapshot.
                            let snap = my_snapshot.borrow().clone();
                            if tx.send(Message::Text(snap.to_string().into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    None => *world = None, // idler left all worlds → unbind
                }
            }
            frame = feed.recv() => {
                match frame {
                    // Broadcast or a BOUND watch only — `Connecting` and an unbound
                    // watch (still defaulting to the featured subscription) must
                    // never forward it (one idler only: no director cues, no other
                    // idlers' streams, #79).
                    Ok(frame) if sub.may_stream() => {
                        if tx.send(Message::Text(frame.to_string().into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(_) => {} // pre-Hello, or an unbound watch: drop frames
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        // Fell behind: self-heal with a fresh snapshot — but not for
                        // an unbound watch (its snapshot is the featured one).
                        warn!("client lagged {n} frames; resyncing with snapshot");
                        if sub.may_stream() {
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
        PROTO_VERSION, SERVER_VERSION, SubState, inspect_world_key, load_content, version_payload,
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
    fn subscription_state_gates_streaming_and_inspect() {
        // SubState is the single privacy boundary (#79). Each leak the critic found
        // maps to one assertion here; reverting any gate fails this test.
        use SubState::*;

        // Pre-Hello (`Connecting`): nothing streams, nothing is inspectable — even
        // with a featured world present (the pre-Hello Inspect leak).
        assert!(!Connecting.may_stream());
        assert_eq!(Connecting.inspect_world("coast", "featured#w"), None);
        assert_eq!(Connecting.inspect_world("", "featured#w"), None);
        assert_eq!(Connecting.watch_name(), None);

        // Broadcast: streams; inspects the client's displayed world, else featured.
        assert!(Broadcast.may_stream());
        assert_eq!(
            Broadcast.inspect_world("shown#w", "featured#w").as_deref(),
            Some("shown#w"),
        );
        assert_eq!(
            Broadcast.inspect_world("", "featured#w").as_deref(),
            Some("featured#w"),
        );
        assert_eq!(Broadcast.watch_name(), None);

        // Watch UNBOUND (idler not yet on a world feed): never streams, never
        // inspects — ignoring both the provided world_key and featured (the
        // unbound-watch Inspect leak). Still reports its watched name so the
        // routing arm can bind it.
        let unbound = Watch {
            name: "Kargan".into(),
            world: None,
        };
        assert!(!unbound.may_stream());
        assert_eq!(unbound.inspect_world("coast", "featured#w"), None);
        assert_eq!(unbound.inspect_world("", "featured#w"), None);
        assert_eq!(unbound.watch_name(), Some("Kargan"));

        // Watch BOUND: streams; inspects ONLY its bound world, ignoring the
        // client-supplied world_key and never featured (the repeat-Hello / wrong-
        // world leak).
        let bound = Watch {
            name: "Kargan".into(),
            world: Some("kargan#w".into()),
        };
        assert!(bound.may_stream());
        assert_eq!(
            bound.inspect_world("some#other", "featured#w").as_deref(),
            Some("kargan#w"),
        );
        assert_eq!(
            bound.inspect_world("", "featured#w").as_deref(),
            Some("kargan#w"),
        );
        assert_eq!(bound.watch_name(), Some("Kargan"));
    }

    #[test]
    fn world_for_watch_matches_a_name_case_insensitively() {
        // `/idler/kargan` must bind `Kargan`'s world: an operator-typed URL
        // shouldn't have to match the proper-noun casing. Reverting the lookup to
        // an exact `by_character.get()` makes the lowercase/UPPERCASE cases fail.
        let mut routing = crate::replication::Routing::default();
        routing.by_character.insert("Kargan".into(), "coast".into());
        routing
            .by_character
            .insert("Veles".into(), "withered_shore#Veles".into());
        for q in ["kargan", "Kargan", "KARGAN", "kArGaN"] {
            assert_eq!(
                super::world_for_watch(&routing, q).as_deref(),
                Some("coast"),
                "{q} should resolve Kargan's world"
            );
        }
        assert_eq!(
            super::world_for_watch(&routing, "veles").as_deref(),
            Some("withered_shore#Veles"),
        );
        // An unknown idler resolves to nothing — the not-in-realms path.
        assert_eq!(super::world_for_watch(&routing, "nobody"), None);
    }
}
