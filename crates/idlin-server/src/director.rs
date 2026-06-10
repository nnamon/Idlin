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

// Event scoring: (score, hold_ticks) per event class. Higher score wins the
// tick and interrupts a weaker hold. Presentation tuning, not game balance —
// which is why it lives here and not in content/.
const SCORE_DEATH: (u32, u32) = (80, 60);
const SCORE_JOIN: (u32, u32) = (75, 60);
const SCORE_RARE_DROP: (u32, u32) = (70, 60);
const SCORE_LEVEL_UP: (u32, u32) = (60, 50);
const SCORE_KILL: (u32, u32) = (30, 40);
/// Minimum rarity (as u8) for a drop to be camera-worthy.
const RARE_DROP_MIN_RARITY: u8 = 2;

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
                SimEvent::CharacterDied { id, .. } => {
                    Some((*id, SCORE_DEATH.0, "death", SCORE_DEATH.1))
                }
                SimEvent::LevelUp { id, .. } => {
                    Some((*id, SCORE_LEVEL_UP.0, "level-up", SCORE_LEVEL_UP.1))
                }
                SimEvent::LootDropped {
                    owner_id, rarity, ..
                } if (*rarity as u8) >= RARE_DROP_MIN_RARITY => {
                    Some((*owner_id, SCORE_RARE_DROP.0, "rare drop", SCORE_RARE_DROP.1))
                }
                SimEvent::MonsterKilled { killer_id, .. } => {
                    Some((*killer_id, SCORE_KILL.0, "kill", SCORE_KILL.1))
                }
                SimEvent::CharacterJoined { id, .. } => {
                    Some((*id, SCORE_JOIN.0, "new challenger", SCORE_JOIN.1))
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn death(id: u32) -> SimEvent {
        SimEvent::CharacterDied {
            id,
            name: format!("c{id}"),
            killer: "test".into(),
        }
    }

    fn kill(killer_id: u32) -> SimEvent {
        SimEvent::MonsterKilled {
            killer_id,
            killer: format!("c{killer_id}"),
            monster: "shambler".into(),
            level: 1,
        }
    }

    #[test]
    fn strongest_event_wins_the_tick() {
        let mut d = Director::new();
        let cue = d
            .update(1, &[kill(1), death(2), kill(3)], &[1, 2, 3])
            .expect("a cue");
        assert_eq!(cue.focus, 2);
        assert_eq!(cue.reason, "death");
    }

    #[test]
    fn featured_focus_cools_down() {
        let mut d = Director::new();
        d.update(1, &[death(7)], &[7, 8]).expect("first cue");
        // Same character dies again immediately: still on cooldown, and the
        // hold is still running, so the camera must not re-cut to them.
        let cue = d.update(2, &[death(7)], &[7, 8]);
        assert!(cue.is_none(), "cooldown must suppress an immediate repeat");
        // Camera moves to 8 in the meantime...
        let cue = d.update(100, &[death(8)], &[7, 8]).expect("cut to 8");
        assert_eq!(cue.focus, 8);
        // ...and once 7's cooldown has lapsed, 7 is featurable again.
        let cue = d.update(1 + FOCUS_COOLDOWN_TICKS + 1, &[death(7)], &[7, 8]);
        assert!(cue.is_some_and(|c| c.focus == 7));
    }

    #[test]
    fn idle_rotation_cycles_characters_and_survives_empty_roster() {
        let mut d = Director::new();
        let first = d.update(1, &[], &[10, 11]).expect("idle cue");
        assert_eq!(first.reason, "roaming");
        // An empty roster must not panic or cue.
        assert!(d.update(1000, &[], &[]).is_none());
        // Roster back: rotation resumes.
        let next = d.update(2000, &[], &[10, 11]).expect("idle cue");
        assert!(next.focus == 10 || next.focus == 11);
    }

    #[test]
    fn weak_event_does_not_interrupt_a_strong_hold() {
        let mut d = Director::new();
        d.update(1, &[death(1)], &[1, 2]).expect("death cue");
        // A mere kill (score 30 < 80) during the death hold: no cut.
        assert!(d.update(2, &[kill(2)], &[1, 2]).is_none());
    }
}
