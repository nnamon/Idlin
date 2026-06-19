//! The tick loop: a dedicated OS thread driving the pure sims at a fixed
//! cadence. The server runs MANY worlds — the shared town plus per-idler
//! zone instances — ticking them all and ferrying zone transfers between
//! them; the async side only ever sees the FEATURED world's `TickFrame`s.

use idlin_content::ContentDb;
use idlin_protocol::{
    CharacterSheet, CurrencyView, ExitView, GateView, GearSlotView, GemView, InvItemView,
    PropState, SkillStat, SkillSupport, TileMapState, TileVisual,
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

pub fn spawn_tick_loop(
    mut worlds: Vec<ManagedWorld>,
    frames: UnboundedSender<TickBatch>,
    mut inspect_rx: UnboundedReceiver<InspectRequest>,
    server_tick: Arc<AtomicU64>,
    snapshot_base: Option<std::path::PathBuf>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
) {
    std::thread::Builder::new()
        .name("idlin-sim".into())
        .spawn(move || {
            let tick_interval = Duration::from_millis(1000 / TICK_HZ as u64);
            let mut ticks_since_save = 0u64;
            loop {
                let started = std::time::Instant::now();
                let stopping = shutdown.load(Ordering::Relaxed);

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
                ferry_departures(&mut worlds, all_departures);

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
                        let dir = crate::persist::world_dir(base, &mw.key);
                        if let Err(e) =
                            crate::persist::save_managed(&mw.world, &mw.pending.arrivals, &dir)
                        {
                            warn!("snapshot for {} failed: {e:#}", mw.key);
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
            .map(|(slot, item, dimmed)| {
                let (name, rarity) = item.unwrap_or_default();
                GearSlotView {
                    slot: slot.to_string(),
                    name,
                    rarity,
                    dimmed,
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
    }
}

#[cfg(test)]
mod tests {
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
        });
        w
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
                items: 0,
                inventory: Vec::new(),
                equipment: Default::default(),
                allocated: Vec::new(),
                build_plan: Vec::new(),
                currency: Vec::new(),
                sockets: std::collections::BTreeMap::new(),
            },
            program: idlin_botc::assemble("halt\n").unwrap(),
            persist: Vec::new(),
            params: Vec::new(),
            bot_version: 1,
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
