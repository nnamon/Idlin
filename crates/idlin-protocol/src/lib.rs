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

pub const PROTO_VERSION: u32 = 16;

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
    pub level: u32,
    /// Display name (characters: player name; monsters: archetype name).
    pub name: String,
    /// Visual key: character class or monster model or "loot".
    pub model: String,
    /// 0 normal, 1 magic, 2 rare, 3 unique (loot only).
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

/// A non-walkable disc generated with the area; the client renders the
/// matching prop (rock, dead tree) at exactly this spot.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ObstacleState {
    /// Q16.16 raw.
    pub x: i32,
    pub y: i32,
    pub radius: i32,
    /// 0 = rock, 1 = dead tree.
    pub kind: u8,
}

/// One equipment slot on the inspect sheet ("" name = empty slot).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct GearSlotView {
    pub slot: String,
    pub name: String,
    pub rarity: u8,
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
        /// Q16.16 raw zone extents.
        width: i32,
        height: i32,
        /// Generated non-walkable props; constant for the zone's lifetime.
        obstacles: Vec<ObstacleState>,
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
            }],
            projectiles: vec![],
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
    }

    /// Regenerates web/src/gen/. CI checks the output is committed and fresh.
    #[test]
    fn export_typescript_bindings() {
        let cfg = ts_rs::Config::new().with_out_dir("../../web/src/gen");
        C2S::export_all(&cfg).expect("export C2S");
        S2C::export_all(&cfg).expect("export S2C");
    }
}
