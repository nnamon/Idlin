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
/// Re-broadcast the current cue this often even when focus is unchanged —
/// cues aren't in the snapshot, so without this a viewer who connects
/// after the last cut idles in overview forever (exactly what happens
/// with a single character, whose focus never changes).
const REFRESH_TICKS: u64 = 50;
/// A deliberate sweeping look at the whole zone, once a minute…
const OVERVIEW_EVERY: u64 = 600;
/// …held for five seconds before the camera returns to the people.
const OVERVIEW_HOLD: u32 = 50;
/// Sentinel focus: matches no entity, so the client plays its overview.
pub const OVERVIEW_FOCUS: u32 = 0;

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
    /// Tick of the last cue actually broadcast (drives the refresher).
    last_emit: u64,
    /// Next scheduled overview beat.
    next_overview: u64,
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
            last_emit: 0,
            next_overview: OVERVIEW_EVERY,
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
                self.last_emit = tick;
                return Some(Cue {
                    focus,
                    reason: reason.to_string(),
                    hold_ticks: hold,
                });
            }
        }

        // A scheduled overview beat: a sweeping look at the whole zone,
        // never interrupting an event hold; the rotation resumes after.
        if tick >= self.next_overview && tick >= self.hold_until && !self.rotation.is_empty() {
            self.next_overview = tick + OVERVIEW_EVERY;
            self.focus = None;
            self.current_score = 0;
            self.hold_until = tick + OVERVIEW_HOLD as u64;
            self.last_emit = tick;
            return Some(Cue {
                focus: OVERVIEW_FOCUS,
                reason: "the wider shore".to_string(),
                hold_ticks: OVERVIEW_HOLD,
            });
        }

        // Idle rotation between characters. Even an unchanged focus is
        // re-broadcast periodically — cues aren't in the snapshot, and a
        // viewer who joins after the last cut must still lock on.
        if tick >= self.hold_until && !self.rotation.is_empty() {
            self.rotation_idx = (self.rotation_idx + 1) % self.rotation.len();
            let focus = self.rotation[self.rotation_idx];
            let refresh_due = tick.saturating_sub(self.last_emit) >= REFRESH_TICKS;
            if self.focus != Some(focus) || refresh_due {
                self.set_focus(focus, 0, tick, IDLE_HOLD_TICKS as u64);
                self.last_emit = tick;
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
            def_idx: 0,
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
        // Roster back: an overdue overview may take the first slot; the
        // rotation must resume on a character right after.
        let next = d.update(2000, &[], &[10, 11]).expect("idle cue");
        if next.focus == OVERVIEW_FOCUS {
            let mut resumed = None;
            for t in 2001..2300 {
                if let Some(c) = d.update(t, &[], &[10, 11]) {
                    resumed = Some(c);
                    break;
                }
            }
            let c = resumed.expect("rotation resumes after the sweep");
            assert!(c.focus == 10 || c.focus == 11);
        } else {
            assert!(next.focus == 10 || next.focus == 11);
        }
    }

    #[test]
    fn weak_event_does_not_interrupt_a_strong_hold() {
        let mut d = Director::new();
        d.update(1, &[death(1)], &[1, 2]).expect("death cue");
        // A mere kill (score 30 < 80) during the death hold: no cut.
        assert!(d.update(2, &[kill(2)], &[1, 2]).is_none());
    }

    #[test]
    fn a_lone_character_is_recued_for_late_joiners() {
        let mut d = Director::new();
        let first = d.update(1, &[], &[42]).expect("initial cue");
        assert_eq!(first.focus, 42);
        // Focus never changes with one character — but the cue must still
        // re-broadcast so late-connecting viewers lock on.
        let mut refreshed = false;
        for t in 2..200 {
            if let Some(c) = d.update(t, &[], &[42]) {
                assert_eq!(c.focus, 42);
                refreshed = true;
                break;
            }
        }
        assert!(refreshed, "the lone-character cue must refresh");
    }

    #[test]
    fn overview_beats_arrive_on_schedule_and_yield_to_people() {
        let mut d = Director::new();
        d.update(1, &[], &[7]).expect("initial cue");
        // March to the first scheduled overview.
        let mut saw_overview_at = None;
        for t in 2..OVERVIEW_EVERY + 200 {
            if let Some(c) = d.update(t, &[], &[7])
                && c.focus == OVERVIEW_FOCUS
            {
                saw_overview_at = Some(t);
                break;
            }
        }
        let t0 = saw_overview_at.expect("a scheduled overview must fire");
        // And afterwards the camera returns to the character.
        let mut returned = false;
        for t in t0 + 1..t0 + 200 {
            if let Some(c) = d.update(t, &[], &[7]) {
                assert_eq!(c.focus, 7, "people come back after the sweep");
                returned = true;
                break;
            }
        }
        assert!(returned);
    }
}
