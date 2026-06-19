//! The wire protocol between `idlin-server` and the web clients.
//!
//! Single source of truth for both sides: Rust types here, TypeScript types
//! generated into `web/src/gen/` by `cargo test -p idlin-protocol` (the
//! `export_typescript_bindings` test). JSON over WebSocket for v1; the serde
//! derives are the seam for a binary transport later.
//!
//! Positions are raw Q16.16 fixed-point integers (divide by 65536 client-side).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// 36: EntityState.es_pct (#100 — energy shield on the overhead bar).
pub const PROTO_VERSION: u32 = 36;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum Role {
    /// Server owner / broadcast view: full world visibility.
    Owner,
    /// Scoped to one character; enforced server-side before serialization.
    Player,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub enum EntityKind {
    Character,
    Monster,
    Loot,
}

/// Full renderable state of one entity.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EntityState {
    pub id: u32,
    pub kind: EntityKind,
    /// Q16.16 raw.
    pub x: i32,
    pub y: i32,
    pub life_pct: u8,
    /// Energy-shield fill for the overhead bar: -1 = no ES (draw none), else
    /// es/es_max as 0..=100. Lets the scene show a shield band per entity.
    pub es_pct: i32,
    pub level: u32,
    /// Display name (characters: player name; monsters: archetype name).
    pub name: String,
    /// Visual key: character class or monster model or "loot".
    pub model: String,
    /// 0 normal, 1 magic, 2 rare, 3 unique (loot drops AND monsters —
    /// elite monsters tint their nameplates; uniques get boss bars).
    pub rarity: u8,
    /// Equipped weapon visual key ("" = unarmed; characters only).
    pub weapon: String,
    /// Weapon rarity 0..3 — the client tints the worn mesh by tier.
    pub weapon_rarity: u8,
    /// Visual part keys from equipped armor, in gear-slot order. The client
    /// composes the character model from these (modular paper-doll).
    pub gear: Vec<String>,
    /// Rarity per gear entry (aligned with `gear`) for worn-tier glows.
    pub gear_rarity: Vec<u8>,
    pub dead: bool,
    pub kills: u32,
    pub items: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EntityMove {
    pub id: u32,
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct EntityPatch {
    pub id: u32,
    pub life_pct: u8,
    /// Energy-shield fill (-1 = no ES, else 0..=100); patched so the overhead
    /// shield band tracks ES drain/recharge mid-stream.
    pub es_pct: i32,
    pub level: u32,
    pub dead: bool,
    pub kills: u32,
    pub items: u32,
    /// Equipped weapon visual key; patched so swaps show up mid-stream.
    pub weapon: String,
    pub weapon_rarity: u8,
    /// Armor visual part keys; patched so upgrades show up mid-stream.
    pub gear: Vec<String>,
    pub gear_rarity: Vec<u8>,
}

/// A use BEGAN (any attack, skill, or cast): the windup the client
/// animates. The strike resolves `contact_ticks` later — HitFx and
/// shape FX land exactly on the contact frame.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UseFx {
    pub attacker: u32,
    /// Spells play the cast clip; attacks the weapon swing.
    pub spell: bool,
    /// Aim point, raw Q16.16 — turns the body toward the action.
    pub x: i32,
    pub y: i32,
    /// Full commitment (busy) in ticks; the entity recovers after.
    pub use_ticks: u32,
    /// Ticks from start to the blow landing (<= use_ticks).
    pub contact_ticks: u32,
}

/// A projectile took flight; the client animates the streak (hits arrive
/// separately as authoritative HitFx).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ProjectileFx {
    /// Caster, so the client can play the launch animation.
    pub attacker: u32,
    /// Spell projectiles get a cast animation; attacks a weapon swing.
    pub spell: bool,
    /// Q16.16 raw launch position and per-tick velocity.
    pub x: i32,
    pub y: i32,
    pub vx: i32,
    pub vy: i32,
    /// Q16.16 raw travel budget.
    pub range: i32,
    pub dmg_type: u8,
}

/// A non-projectile skill went off: the client plays the right cast/swing
/// animation and draws the shape (ring, cone, line) where it happened.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SkillFx {
    pub attacker: u32,
    pub spell: bool,
    /// 0 strike, 1 nova, 2 cone, 3 line, 4 point-AoE.
    pub shape: u8,
    /// Q16.16 raw: the shape's anchor (the caster, except point-AoE which
    /// anchors at the blast point) and aim direction (normalized).
    pub x: i32,
    pub y: i32,
    pub dx: i32,
    pub dy: i32,
    /// Q16.16 raw footprint: ring radius (nova/point-AoE), or the full
    /// corridor width for lines.
    pub radius: i32,
    pub range: i32,
    pub dmg_type: u8,
}

/// A landed hit, for client-side effects (tracers, impact flashes).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct HitFx {
    pub attacker: u32,
    pub target: u32,
    pub amount: i32,
    /// Dominant damage component: 0 phys, 1 fire, 2 cold, 3 lightning,
    /// 4 chaos.
    pub dmg_type: u8,
    pub crit: bool,
    /// A damage-over-time burn tick (steady, once per second).
    pub dot: bool,
    pub projectile: bool,
    pub killed: bool,
    /// The hit STAGGERED its victim (windup interrupted, briefly locked);
    /// a stunning cold hit reads as FROZEN instead.
    pub stun: bool,
    pub freeze: bool,
}

/// Narratable world events: the ticker, the director, and (later) chat
/// announcements all feed on these.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data")]
pub enum GameEvent {
    CharacterJoined {
        id: u32,
        name: String,
    },
    /// A tutorial gate lifted or shut (cell rect).
    GateChanged {
        x0: i32,
        y0: i32,
        x1: i32,
        y1: i32,
        open: bool,
    },
    /// An exit opened or closed (raw Q16.16 coords — the client keys its
    /// portal visuals by position).
    ExitChanged {
        x: i32,
        y: i32,
        open: bool,
    },
    CharacterDied {
        id: u32,
        name: String,
        killer: String,
    },
    CharacterRespawned {
        id: u32,
    },
    LevelUp {
        id: u32,
        name: String,
        level: u32,
    },
    MonsterKilled {
        killer_id: u32,
        killer: String,
        monster: String,
        level: u32,
    },
    LootDropped {
        owner_id: u32,
        owner: String,
        rarity: u8,
        item: String,
    },
    ItemPickedUp {
        owner_id: u32,
        owner: String,
        rarity: u8,
        item: String,
    },
    ItemEquipped {
        id: u32,
        owner: String,
        rarity: u8,
        item: String,
    },
    PassiveAllocated {
        id: u32,
        owner: String,
        node: String,
    },
    GemSocketed {
        id: u32,
        owner: String,
        gem: String,
    },
    /// A support refused a skill at socket time (tag mismatch).
    GemRejected {
        id: u32,
        owner: String,
        gem: String,
        skill: String,
    },
    /// An obol spent on a bag item (the name is post-craft).
    CurrencyUsed {
        id: u32,
        owner: String,
        currency: String,
        item: String,
    },
    /// Authored zone narration (target 0 = everyone).
    Narration {
        target: u32,
        text: String,
    },
    /// An entity speaks: the client draws a bubble over its head.
    Speech {
        id: u32,
        text: String,
    },
    /// A character left for another zone.
    CharacterDeparted {
        id: u32,
        name: String,
        dest: String,
    },
    BuildDeclared {
        id: u32,
        owner: String,
        nodes: u32,
    },
    /// A Regret Obol bought a tree respec: allocated nodes re-walked a
    /// new plan (orphaned sockets returned their gems; gear that leaned
    /// on dropped attributes was shed).
    TreeRespecced {
        id: u32,
        owner: String,
    },
    /// Equipped gear stopped meeting its requirements (respec, gear
    /// loss, buff expiry) and was shed to the bag or the ground.
    GearShed {
        id: u32,
        owner: String,
        item: String,
    },
    BuildRejected {
        id: u32,
        owner: String,
        reason: String,
    },
    GemLevelUp {
        id: u32,
        owner: String,
        gem: String,
        level: u32,
    },
}

/// One equipment slot on the inspect sheet ("" name = empty slot).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GearSlotView {
    pub slot: String,
    pub name: String,
    pub rarity: u8,
    /// Shown greyed: a two-handed weapon mirrors into the offhand slot to
    /// signal it claims both hands (the offhand can't be filled).
    pub dimmed: bool,
}

/// One bag item on the inspect sheet (grid placement + footprint).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct InvItemView {
    pub name: String,
    pub rarity: u8,
    pub x: u8,
    pub y: u8,
    pub w: u8,
    pub h: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CurrencyView {
    pub name: String,
    /// Owned count (only nonzero entries ship).
    pub count: u32,
    /// Display tier 0..3 (panel color).
    pub tier: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GemView {
    pub name: String,
    pub level: u32,
    /// Progress into the current level; xp_next is 0 at the level cap.
    pub xp: i32,
    pub xp_next: i32,
    /// Support gems render indented under their skill.
    pub support: bool,
}

/// A support gem bound to a skill (name + level + its own XP progress), nested
/// under `SkillStat`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SkillSupport {
    pub name: String,
    pub level: u32,
    /// Gem XP into the current level, and the amount for the next (0 at cap).
    pub xp: i32,
    pub xp_next: i32,
}

/// Computed readout for one socketed SKILL gem — straight from the sim's own
/// resolution pipeline, never a client reimplementation. `dps` is the headline
/// for damage skills; the dot / buff / debuff fields carry the pertinent number
/// for skills that deal no direct hit (a DoT, an aura, an on-hit debuff).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SkillStat {
    pub name: String,
    pub level: u32,
    /// Gem XP into the current level, and the amount for the next (0 at cap).
    pub xp: i32,
    pub xp_next: i32,
    /// "attack" | "spell".
    pub kind: String,
    /// "target" | "nova" | "cone" | "line" | "point_aoe" | "projectile".
    pub shape: String,
    /// Per-hit typed damage [phys, fire, cold, lightning, chaos], post-support, pre-crit.
    pub damage: Vec<i32>,
    /// Damage/second: Σdamage × crit factor ÷ use-seconds. 0 when no direct hit.
    pub dps: i32,
    /// Effective crit chance (gem base × global increased), basis points.
    pub crit_chance_bp: i32,
    /// Crit multiplier, basis points (15000 = 150%).
    pub crit_multi_bp: i32,
    /// Effective use duration, ticks (support speed folded).
    pub use_ticks: u32,
    /// Extra cooldown on top of use time (specials), ticks; 0 if none.
    pub cooldown_ticks: u32,
    pub mana_cost: i32,
    /// Life paid per use (0 for most skills). Ungated — a use can self-kill.
    pub life_cost: i32,
    /// Content-unit footprint. 0 range = the weapon's range.
    pub range_cu: i32,
    pub radius_cu: i32,
    /// Line/corridor width in content units (0 for non-line skills).
    pub width_cu: i32,
    /// Projectiles fired (1 + support extras); 0 for non-projectile skills.
    pub projectiles: u32,
    pub pierce: u32,
    /// Damage-over-time per second and its duration (ticks); 0 when no DoT.
    pub dot_per_sec: i32,
    pub dot_duration_ticks: u32,
    /// Self-buff duration, ticks; 0 when the skill grants no buff.
    pub buff_duration_ticks: u32,
    /// On-hit debuff duration, ticks; 0 when none.
    pub debuff_duration_ticks: u32,
    pub supports: Vec<SkillSupport>,
}

/// A tutorial gate: a rect of CELLS that blocks ground while shut.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GateView {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub open: bool,
}

/// A walk-up zone exit (portal). Bots take these themselves; the client
/// renders open ones as an inviting glow.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ExitView {
    /// Q16.16 raw.
    pub x: i32,
    pub y: i32,
    pub open: bool,
}

/// One glyph's resolved look: the server applies tileset + variant so
/// snapshots (and recordings) are self-contained — the client never
/// reads content files.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TileVisual {
    /// Single map character, as a string for wire/TS friendliness.
    pub glyph: String,
    /// Ground paint, "#rrggbb".
    pub ground: String,
    /// Ground KIND id ("water", "sand", "cobble"…) — the renderer shapes
    /// terrain by kind, not by color.
    pub ground_id: String,
    /// What stands on the tile (client recipe key): wall/house/rock/…
    pub prop: Option<String>,
    /// The client may path-preview/dim unwalkable ground.
    pub walkable: bool,
    /// Terrain level (0 = base): the renderer raises these cells into
    /// terraces; the sim's walk grid stays flat.
    #[serde(default)]
    pub elevation: u8,
}

/// One authored set-piece placement (props.ron).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct PropState {
    pub model: String,
    pub x_u: i32,
    pub y_u: i32,
    pub rot_deg: i32,
}

/// An authored zone's tile map, fully resolved for rendering. One char
/// per sim unit, rows top-to-bottom.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TileMapState {
    pub width: i32,
    pub height: i32,
    pub rows: Vec<String>,
    pub legend: Vec<TileVisual>,
    pub props: Vec<PropState>,
    /// The tileset's OPT-IN cosmetic features (sea, bluffs, stars…).
    #[serde(default)]
    pub features: Vec<String>,
}

/// One idler on the global focus-queue roster (every world), listed in
/// the order the director's idle rotation will visit them. Events can
/// jump the queue — that's the broadcast's charm, not a lie.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FocusQueueEntry {
    pub name: String,
    /// Display name of the zone they're in.
    pub zone: String,
    pub level: u32,
    pub dead: bool,
    /// Currently held by the director's camera.
    pub focused: bool,
    /// Recently featured; event cues skip them for a while.
    pub cooldown: bool,
}

/// On-demand character inspection, shown while the director focuses an
/// idler: gear, brief stats, bag, gems, passives.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CharacterSheet {
    pub id: u32,
    pub name: String,
    pub level: u32,
    pub xp: i32,
    pub xp_next: i32,
    pub life: i32,
    pub life_max: i32,
    pub mana: i32,
    pub mana_max: i32,
    pub es: i32,
    pub es_max: i32,
    /// Reserved life/mana — unavailable pool shown as the gravel band growing from
    /// the TOP of the orb. 0 until reservations (auras) exist in the sim.
    pub life_reserved: i32,
    pub mana_reserved: i32,
    /// Basis points chance to block (0 without a shield).
    pub block_bp: i32,
    pub kills: u32,
    pub dmg_phys: i32,
    pub dmg_fire: i32,
    pub dmg_cold: i32,
    pub dmg_lightning: i32,
    pub dmg_chaos: i32,
    pub accuracy: i32,
    pub evasion: i32,
    pub armour: i32,
    /// Basis points (10000 = 100%); the cap is applied at use, not here.
    pub resist_fire_bp: i32,
    pub resist_cold_bp: i32,
    pub resist_lightning_bp: i32,
    pub resist_chaos_bp: i32,
    /// Find factors in basis points over 10000 (0 = no bonus).
    pub item_rarity_bp: i32,
    pub item_quantity_bp: i32,
    pub equipment: Vec<GearSlotView>,
    pub inventory: Vec<InvItemView>,
    pub gems: Vec<GemView>,
    /// Computed per-socketed-skill readout (DPS / DoT / buff / footprint).
    pub skills: Vec<SkillStat>,
    pub currency: Vec<CurrencyView>,
    pub passive_allocated: u32,
    pub passive_unspent: u32,
    pub build_len: u32,
}

/// Client → server.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data")]
pub enum C2S {
    Hello {
        token: String,
        proto_version: u32,
        /// What this connection watches: None/absent = the featured
        /// broadcast (director-driven); Some(name) = the world containing
        /// that character, following them across zone transfers.
        /// Permission gating arrives with real auth.
        #[serde(default)]
        watch: Option<String>,
    },
    Ping {
        nonce: u32,
    },
    /// Owner only: toggle automatic camera direction.
    DirectorMode {
        auto: bool,
    },
    /// Request the inspect sheet for a character (the focus panel).
    Inspect {
        id: u32,
        /// The world the client is CURRENTLY displaying (`zone.worldKey`).
        /// net ids are per-world and overlap, so the sheet must be resolved
        /// in this exact world — not a server-side guess at what's featured.
        /// Empty = let the server fall back to the followed/featured world.
        #[serde(default)]
        world_key: String,
    },
}

/// Server → client.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data")]
pub enum S2C {
    Welcome {
        role: Role,
        proto_version: u32,
        /// Semver of the server build.
        server_version: String,
        /// Current sim tick. Fits in a JS number for ~28M years at 10 Hz.
        #[ts(type = "number")]
        server_tick: u64,
    },
    Pong {
        nonce: u32,
        #[ts(type = "number")]
        server_tick: u64,
    },
    /// Full zone state: sent on connect and periodically as a keyframe.
    ZoneSnapshot {
        #[ts(type = "number")]
        tick: u64,
        zone_name: String,
        /// AREA LEVEL: the mob-scaling floor, shown beside the name.
        #[serde(default)]
        zone_level: u32,
        /// Which WORLD this is ("saltmere", "withered_shore#Kargan") —
        /// explicit identity, not inferred from appearance.
        #[serde(default)]
        world_key: String,
        /// Q16.16 raw zone extents.
        width: i32,
        height: i32,
        /// The authored tile map (every zone has one).
        #[serde(default)]
        tiles: Option<TileMapState>,
        /// Walk-up exits (portals), open state included.
        #[serde(default)]
        exits: Vec<ExitView>,
        /// Tutorial gates (cell rects), open state included.
        #[serde(default)]
        gates: Vec<GateView>,
        entities: Vec<EntityState>,
    },
    /// Per-tick changes relative to the previous tick.
    ZoneDelta {
        #[ts(type = "number")]
        tick: u64,
        spawned: Vec<EntityState>,
        moved: Vec<EntityMove>,
        updated: Vec<EntityPatch>,
        removed: Vec<u32>,
        hits: Vec<HitFx>,
        projectiles: Vec<ProjectileFx>,
        skills: Vec<SkillFx>,
        /// Windups that began this tick (the client animates from here;
        /// the strike arrives `contact_ticks` later).
        #[serde(default)]
        uses: Vec<UseFx>,
    },
    /// Batched narratable events for this tick.
    Events {
        events: Vec<GameEvent>,
    },
    /// Auto-director camera cue (owner view).
    DirectorCue {
        focus: u32,
        reason: String,
        hold_ticks: u32,
    },
    /// The cross-world roster in upcoming-focus order (featured feed).
    FocusQueue {
        entries: Vec<FocusQueueEntry>,
    },
    CharacterSheet {
        sheet: CharacterSheet,
    },
    Error {
        code: u32,
        msg: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_roundtrip() {
        let msg = C2S::Ping { nonce: 7 };
        let json = serde_json::to_string(&msg).unwrap();
        assert_eq!(json, r#"{"type":"Ping","data":{"nonce":7}}"#);
        let back: C2S = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, C2S::Ping { nonce: 7 }));

        let msg = S2C::ZoneDelta {
            tick: 42,
            spawned: vec![],
            moved: vec![EntityMove {
                id: 1,
                x: 65536,
                y: -65536,
            }],
            updated: vec![],
            removed: vec![9],
            hits: vec![HitFx {
                attacker: 1,
                target: 2,
                amount: 13,
                dmg_type: 1,
                crit: false,
                dot: false,
                projectile: true,
                killed: false,
                stun: false,
                freeze: false,
            }],
            projectiles: vec![],
            uses: Vec::new(),
            skills: vec![SkillFx {
                attacker: 1,
                spell: true,
                shape: 1,
                x: 0,
                y: 0,
                dx: 65536,
                dy: 0,
                radius: 65536 * 3,
                range: 0,
                dmg_type: 2,
            }],
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: S2C = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, S2C::ZoneDelta { tick: 42, .. }));

        // The per-skill readout (#19) survives the wire — notably `width_cu`,
        // the newest field, and a nested support.
        let sheet = S2C::CharacterSheet {
            sheet: CharacterSheet {
                id: 1,
                name: "Brakka".into(),
                level: 42,
                xp: 0,
                xp_next: 0,
                life: 100,
                life_max: 100,
                mana: 0,
                mana_max: 0,
                es: 0,
                es_max: 0,
                life_reserved: 25,
                mana_reserved: 40,
                block_bp: 0,
                kills: 0,
                dmg_phys: 0,
                dmg_fire: 0,
                dmg_cold: 0,
                dmg_lightning: 0,
                dmg_chaos: 0,
                accuracy: 0,
                evasion: 0,
                armour: 0,
                resist_fire_bp: 0,
                resist_cold_bp: 0,
                resist_lightning_bp: 0,
                resist_chaos_bp: 0,
                item_rarity_bp: 0,
                item_quantity_bp: 0,
                equipment: vec![],
                inventory: vec![],
                gems: vec![],
                skills: vec![SkillStat {
                    name: "Arc".into(),
                    level: 5,
                    xp: 120,
                    xp_next: 400,
                    kind: "spell".into(),
                    shape: "line".into(),
                    damage: vec![0, 0, 0, 160, 0],
                    dps: 200,
                    crit_chance_bp: 500,
                    crit_multi_bp: 15000,
                    use_ticks: 8,
                    cooldown_ticks: 0,
                    mana_cost: 12,
                    life_cost: 7,
                    range_cu: 600,
                    radius_cu: 0,
                    width_cu: 130,
                    projectiles: 0,
                    pierce: 0,
                    dot_per_sec: 0,
                    dot_duration_ticks: 0,
                    buff_duration_ticks: 0,
                    debuff_duration_ticks: 0,
                    supports: vec![SkillSupport {
                        name: "Added Lightning".into(),
                        level: 3,
                        xp: 30,
                        xp_next: 90,
                    }],
                }],
                currency: vec![],
                passive_allocated: 0,
                passive_unspent: 0,
                build_len: 0,
            },
        };
        let json = serde_json::to_string(&sheet).unwrap();
        let back: S2C = serde_json::from_str(&json).unwrap();
        let S2C::CharacterSheet { sheet } = back else {
            panic!("expected CharacterSheet");
        };
        assert_eq!(sheet.skills.len(), 1);
        assert_eq!(
            sheet.skills[0].width_cu, 130,
            "line width survives the wire"
        );
        assert_eq!(sheet.skills[0].dps, 200);
        assert_eq!(
            sheet.skills[0].life_cost, 7,
            "skill life cost survives the wire"
        );
        assert_eq!(sheet.skills[0].xp, 120, "gem xp survives the wire");
        assert_eq!(sheet.skills[0].xp_next, 400);
        assert_eq!(sheet.skills[0].supports[0].name, "Added Lightning");
        assert_eq!(sheet.life_reserved, 25, "reserved life survives the wire");
        assert_eq!(sheet.mana_reserved, 40, "reserved mana survives the wire");
        assert_eq!(
            sheet.skills[0].supports[0].xp, 30,
            "support xp survives the wire"
        );
        assert_eq!(
            sheet.skills[0].supports[0].xp_next, 90,
            "support xp-to-next survives the wire"
        );
    }

    /// Regenerates web/src/gen/. CI checks the output is committed and fresh.
    #[test]
    fn export_typescript_bindings() {
        let cfg = ts_rs::Config::new().with_out_dir("../../web/src/gen");
        C2S::export_all(&cfg).expect("export C2S");
        S2C::export_all(&cfg).expect("export S2C");
        // The wire VERSION ships with the types: the client imports this
        // constant, so a PROTO bump reaches both sides in one commit —
        // hand-syncing it once caused a silent handshake rejection (live
        // link, tick 0 forever).
        std::fs::write(
            "../../web/src/gen/proto.ts",
            format!(
                "// AUTO-GENERATED by idlin-protocol's export_typescript_bindings test — do not edit.\nexport const PROTO_VERSION = {PROTO_VERSION};\n"
            ),
        )
        .expect("export proto.ts");
    }
}
