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

pub const PROTO_VERSION: u32 = 6;

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
    /// Visual part keys from equipped armor, in gear-slot order. The client
    /// composes the character model from these (modular paper-doll).
    pub gear: Vec<String>,
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
    /// Armor visual part keys; patched so upgrades show up mid-stream.
    pub gear: Vec<String>,
}

/// A landed hit, for client-side effects (tracers, impact flashes).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct HitFx {
    pub attacker: u32,
    pub target: u32,
    pub amount: i32,
    /// Dominant damage component: 0 phys, 1 elemental, 2 chaos.
    pub dmg_type: u8,
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
pub struct GemView {
    pub name: String,
    pub level: u32,
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
    pub kills: u32,
    pub dmg_phys: i32,
    pub dmg_ele: i32,
    pub dmg_chaos: i32,
    pub accuracy: i32,
    pub evasion: i32,
    pub armour: i32,
    /// Basis points (10000 = 100%); the cap is applied at use, not here.
    pub resist_ele_bp: i32,
    pub resist_chaos_bp: i32,
    pub equipment: Vec<GearSlotView>,
    pub inventory: Vec<InvItemView>,
    pub gems: Vec<GemView>,
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
                projectile: true,
                killed: false,
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
