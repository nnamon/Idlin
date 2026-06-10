//! Entity model. Entities live in slot storage inside a zone; every external
//! reference (protocol, syscalls, AI targets) uses the `net_id` — a monotonic
//! never-reused u32 — so slot reuse can never alias a stale reference.

use crate::fixed::{Fx, FxV2};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[repr(u8)]
pub enum Rarity {
    Normal = 0,
    Magic = 1,
    Rare = 2,
    Unique = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Class {
    Brute,
    Hunter,
    Arcanist,
}

impl Class {
    pub fn as_str(&self) -> &'static str {
        match self {
            Class::Brute => "brute",
            Class::Hunter => "hunter",
            Class::Arcanist => "arcanist",
        }
    }
}

/// Who fights whom. Attacks are only legal across the Player↔Hostile pair;
/// Neutral entities (service NPCs, tavern-dwellers) can neither hit nor be hit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Faction {
    Player,
    Hostile,
    Neutral,
}

impl Faction {
    pub fn is_enemy_of(self, other: Faction) -> bool {
        matches!(
            (self, other),
            (Faction::Player, Faction::Hostile) | (Faction::Hostile, Faction::Player)
        )
    }
}

/// Shared combat numbers for characters and monsters. All integer/fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatStats {
    pub life: i64,
    pub life_max: i64,
    pub damage: i64,
    pub range: Fx,
    pub cooldown_ticks: u32,
    pub cooldown_left: u32,
    pub speed_per_tick: Fx,
    pub projectile: bool,
    /// Last tick this entity dealt or took damage (drives out-of-combat regen).
    pub last_combat_tick: u64,
}

impl CombatStats {
    pub fn alive(&self) -> bool {
        self.life > 0
    }

    pub fn life_pct(&self) -> u8 {
        if self.life_max <= 0 {
            return 0;
        }
        (self.life.clamp(0, self.life_max) * 100 / self.life_max) as u8
    }
}

/// Per-tick action intents. `attack`/`pickup` are cleared every tick (bots
/// and AI re-issue); `move_to` persists until arrival so a budget-starved
/// bot keeps walking.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Intents {
    pub move_to: Option<FxV2>,
    pub attack: Option<u32>,
    pub pickup: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterState {
    pub name: String,
    pub class: Class,
    pub level: u32,
    pub xp: i64,
    /// Set while dead; tick at which the character respawns.
    pub respawn_at: Option<u64>,
    pub kills: u64,
    pub items: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonsterState {
    /// Index into ContentDb::monsters.
    pub def_idx: u32,
    /// Index into Zone::packs.
    pub pack_idx: u32,
    /// Home position; the brain reads it via SelfStatus for leashing.
    pub anchor: FxV2,
    /// Copied from the def at spawn so faction checks never need content.
    pub hostile: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootState {
    pub rarity: Rarity,
    /// Personal loot: only this character's net_id can see or take it.
    pub owner: u32,
    pub despawn_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub net_id: u32,
    pub pos: FxV2,
    pub intents: Intents,
    /// Index into the bot arena — characters AND monsters both think in the
    /// same VM; an entity without a bot (loot) just doesn't act.
    pub bot: Option<u32>,
    pub combat: Option<CombatStats>,
    pub character: Option<CharacterState>,
    pub monster: Option<MonsterState>,
    pub loot: Option<LootState>,
}

impl Entity {
    pub fn alive(&self) -> bool {
        self.combat.as_ref().is_some_and(|c| c.alive())
    }

    pub fn faction(&self) -> Faction {
        if self.character.is_some() {
            Faction::Player
        } else if let Some(m) = &self.monster {
            if m.hostile {
                Faction::Hostile
            } else {
                Faction::Neutral
            }
        } else {
            Faction::Neutral
        }
    }

    /// Wire/syscall kind code: 1 = character, 2 = monster, 3 = loot.
    pub fn kind_code(&self) -> i32 {
        if self.character.is_some() {
            1
        } else if self.monster.is_some() {
            2
        } else {
            3
        }
    }
}
