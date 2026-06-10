//! Auto-director v1: scores world events, applies per-focus cooldowns, and
//! falls back to a round-robin of characters when nothing exciting happens.
//! The client follows cues in auto mode; scoring lives server-side so cues
//! can later also drive chat announcements.

use idlin_sim::SimEvent;
use std::collections::HashMap;

/// A camera cue (mapped to `S2C::DirectorCue` by replication).
pub struct Cue {
    pub focus: u32,
    pub reason: String,
    pub hold_ticks: u32,
}

/// How long a focus stays ineligible after being featured.
const FOCUS_COOLDOWN_TICKS: u64 = 200;
/// Default idle rotation hold.
const IDLE_HOLD_TICKS: u32 = 80;

pub struct Director {
    focus: Option<u32>,
    hold_until: u64,
    current_score: u32,
    cooldowns: HashMap<u32, u64>,
    rotation: Vec<u32>,
    rotation_idx: usize,
}

impl Director {
    pub fn new() -> Director {
        Director {
            focus: None,
            hold_until: 0,
            current_score: 0,
            cooldowns: HashMap::new(),
            rotation: Vec::new(),
            rotation_idx: 0,
        }
    }

    /// Feed one tick's events + the character roster; returns a cue when the
    /// camera should move.
    pub fn update(&mut self, tick: u64, events: &[SimEvent], characters: &[u32]) -> Option<Cue> {
        self.rotation = characters.to_vec();

        // Find the strongest scoreable event this tick.
        let mut best: Option<(u32, u32, &'static str, u32)> = None; // (focus, score, reason, hold)
        for ev in events {
            let scored = match ev {
                SimEvent::CharacterDied { id, .. } => Some((*id, 80, "death", 60u32)),
                SimEvent::LevelUp { id, .. } => Some((*id, 60, "level-up", 50)),
                SimEvent::LootDropped {
                    owner_id, rarity, ..
                } if (*rarity as u8) >= 2 => Some((*owner_id, 70, "rare drop", 60)),
                SimEvent::MonsterKilled { killer_id, .. } => Some((*killer_id, 30, "kill", 40)),
                SimEvent::CharacterJoined { id, .. } => Some((*id, 75, "new challenger", 60)),
                _ => None,
            };
            let Some((focus, score, reason, hold)) = scored else {
                continue;
            };
            if self.cooldowns.get(&focus).copied().unwrap_or(0) > tick {
                continue;
            }
            if best.is_none_or(|(_, s, _, _)| score > s) {
                best = Some((focus, score, reason, hold));
            }
        }

        // A new event interrupts when it outranks the current hold.
        if let Some((focus, score, reason, hold)) = best {
            let interrupts = tick >= self.hold_until || score > self.current_score;
            if interrupts && self.focus != Some(focus) {
                self.set_focus(focus, score, tick, hold as u64);
                return Some(Cue {
                    focus,
                    reason: reason.to_string(),
                    hold_ticks: hold,
                });
            }
        }

        // Idle rotation between characters.
        if tick >= self.hold_until && !self.rotation.is_empty() {
            self.rotation_idx = (self.rotation_idx + 1) % self.rotation.len();
            let focus = self.rotation[self.rotation_idx];
            if self.focus != Some(focus) {
                self.set_focus(focus, 0, tick, IDLE_HOLD_TICKS as u64);
                return Some(Cue {
                    focus,
                    reason: "roaming".to_string(),
                    hold_ticks: IDLE_HOLD_TICKS,
                });
            }
            self.hold_until = tick + IDLE_HOLD_TICKS as u64;
        }
        None
    }

    fn set_focus(&mut self, focus: u32, score: u32, tick: u64, hold: u64) {
        self.focus = Some(focus);
        self.current_score = score;
        self.hold_until = tick + hold;
        self.cooldowns.insert(focus, tick + FOCUS_COOLDOWN_TICKS);
        self.cooldowns.retain(|_, &mut until| until > tick);
    }
}
