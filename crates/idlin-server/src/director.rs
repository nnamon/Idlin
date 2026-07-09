//! Auto-director v2: scores events across EVERY world (each idler's
//! instance, the shared town), applies per-character cooldowns, and falls
//! back to a round-robin over all characters everywhere. The featured
//! world FOLLOWS the director's focus — the camera cuts between instances
//! the way a sports broadcast cuts between courts. Scoring lives
//! server-side so cues can later also drive chat announcements and clips.

use idlin_sim::SimEvent;
use std::collections::HashMap;

/// One world's tick, as the director sees it.
pub struct WorldView<'a> {
    pub key: &'a str,
    pub events: &'a [SimEvent],
    /// Every character there this tick (net id, name) — dead included;
    /// a corpse awaiting respawn is still the story.
    pub characters: &'a [(u32, String)],
}

/// A camera cue (mapped to `S2C::DirectorCue` by replication). The world
/// key tells replication which feed the broadcast should now mirror.
pub struct Cue {
    pub world_key: String,
    pub focus: u32,
    pub reason: String,
    pub hold_ticks: u32,
}

/// One row of the focus queue: an idler somewhere, and when the idle
/// rotation will reach them (their position in the returned Vec).
pub struct QueueEntry {
    /// Where they are (tests assert cross-world coverage; the wire entry
    /// carries the zone display name instead).
    #[allow(dead_code)]
    pub world_key: String,
    pub name: String,
    /// Currently held by the camera.
    pub focused: bool,
    /// Recently featured; event cues skip them until the cooldown lapses.
    pub on_cooldown: bool,
}

/// How long a character stays ineligible after being featured.
const FOCUS_COOLDOWN_TICKS: u64 = 200;
/// Default idle rotation dwell (30s at 10Hz): long enough to watch a
/// character DO something — fight a pack, clear a room — before the
/// rotation moves on. The 8s original read as channel-surfing.
const IDLE_HOLD_TICKS: u32 = 300;
/// Re-broadcast the current cue this often even when focus is unchanged —
/// cues aren't in the snapshot, so without this a viewer who connects
/// after the last cut idles in overview forever.
const REFRESH_TICKS: u64 = 50;

// Event scoring: (score, hold_ticks) per event class. Higher score wins the
// tick and interrupts a weaker hold. Presentation tuning, not game balance —
// which is why it lives here and not in content/.
// THE CALM DIRECTOR (post-playtest rework): the first cut of this system
// scored EVERY event and cut on the winner — four parallel tutorials made
// the broadcast a strobe of cross-world jumps every few seconds.
// Unwatchable. The rework runs on three rules a human editor would use:
//
//   1. A SHOT IS A COMMITMENT. Nothing below the STORY tier may interrupt
//      before MIN_SHOT_TICKS; the default dwell is long enough to watch a
//      character actually do something (fight a pack, clear a room).
//   2. THE CAMERA FOLLOWS STORY, NOT NOISE. Trash kills and routine
//      level-ups are TICKER material — they never move the camera. Cuts
//      are earned by chapters: acts, boss falls, tallies, sails, deaths,
//      a new deploy walking on, a unique hitting the ground.
//   3. CROSS-WORLD CUTS COST EXTRA. A jump to another instance is a full
//      scene change (new zone, camera snap) — it must be worth more than
//      a refocus inside the world the viewer is already reading.
//
// Scores: (score, hold_ticks). STORY_TIER may interrupt a live shot;
// everything else waits for the shot to end.
const SCORE_ACT: (u32, u32) = (95, 200);
const SCORE_BOSS_KILL: (u32, u32) = (90, 180);
const SCORE_TALLY: (u32, u32) = (85, 120);
const SCORE_SAIL: (u32, u32) = (82, 120);
const SCORE_DEATH: (u32, u32) = (80, 100);
const SCORE_JOIN: (u32, u32) = (75, 100);
const SCORE_UNIQUE_DROP: (u32, u32) = (70, 100);
/// Only cues at or above this score may cut INTO a live shot.
const STORY_TIER: u32 = 80;
/// The floor under every shot (10s at 10Hz): below-story cues queue
/// behind it, they don't shorten it.
const MIN_SHOT_TICKS: u64 = 100;
/// A cue from ANOTHER world pays this toll — refocusing inside the
/// current world is cheap, a full scene change is not.
const CROSS_WORLD_PENALTY: u32 = 8;
/// Uniques only (3): magic/rare drops ride the ticker.
const RARE_DROP_MIN_RARITY: u8 = 3;

pub struct Director {
    /// The focused character by NAME — the only identity stable across
    /// worlds (net ids are per-world, and a transfer changes both).
    focus_name: Option<String>,
    /// The world the broadcast currently mirrors.
    pub current_world: Option<String>,
    hold_until: u64,
    /// When the current shot began — the MIN_SHOT_TICKS floor's anchor.
    shot_started: u64,
    /// The live cue's reason, for mid-shot re-broadcasts.
    current_reason: String,
    current_score: u32,
    cooldowns: HashMap<String, u64>,
    rotation_idx: usize,
    /// Tick of the last cue actually broadcast (drives the refresher).
    last_emit: u64,
}

impl Director {
    #[allow(clippy::new_without_default)] // a stateful loop object, not a value type
    pub fn new() -> Director {
        Director {
            focus_name: None,
            current_world: None,
            hold_until: 0,
            shot_started: 0,
            current_reason: String::new(),
            current_score: 0,
            cooldowns: HashMap::new(),
            rotation_idx: 0,
            last_emit: 0,
        }
    }

    /// Feed every world's tick; returns a cue when the broadcast should cut.
    pub fn update(&mut self, tick: u64, worlds: &[WorldView<'_>]) -> Option<Cue> {
        let name_of = |key: &str, id: u32| -> Option<&String> {
            worlds
                .iter()
                .find(|w| w.key == key)
                .and_then(|w| w.characters.iter().find(|(i, _)| *i == id))
                .map(|(_, n)| n)
        };

        // The strongest scoreable event this tick, across every world.
        let mut best: Option<(String, u32, String, u32, &'static str, u32)> = None;
        for w in worlds {
            for ev in w.events {
                let scored = match ev {
                    SimEvent::ActCompleted { id, act, .. } => Some((
                        *id,
                        SCORE_ACT.0,
                        if *act == 1 {
                            "act 1 falls"
                        } else {
                            "act 2 falls"
                        },
                        SCORE_ACT.1,
                    )),
                    SimEvent::MonsterKilled {
                        killer_id, rarity, ..
                    } if *rarity == idlin_sim::Rarity::Unique => Some((
                        *killer_id,
                        SCORE_BOSS_KILL.0,
                        "the boss falls",
                        SCORE_BOSS_KILL.1,
                    )),
                    SimEvent::VoyageTally { id, .. } => {
                        Some((*id, SCORE_TALLY.0, "the voyage tally", SCORE_TALLY.1))
                    }
                    SimEvent::CharacterDeparted { id, dest, .. } if dest == "charted_shallows" => {
                        Some((*id, SCORE_SAIL.0, "sets sail", SCORE_SAIL.1))
                    }
                    SimEvent::CharacterDied { id, .. } => {
                        Some((*id, SCORE_DEATH.0, "death", SCORE_DEATH.1))
                    }
                    // Trash kills and routine level-ups are TICKER material —
                    // they never move the camera (the calm-director rework).
                    SimEvent::LootDropped {
                        owner_id, rarity, ..
                    } if (*rarity as u8) >= RARE_DROP_MIN_RARITY => Some((
                        *owner_id,
                        SCORE_UNIQUE_DROP.0,
                        "a unique drops",
                        SCORE_UNIQUE_DROP.1,
                    )),
                    SimEvent::CharacterJoined { id, .. } => {
                        Some((*id, SCORE_JOIN.0, "new challenger", SCORE_JOIN.1))
                    }
                    _ => None,
                };
                let Some((id, score, reason, hold)) = scored else {
                    continue;
                };
                let Some(name) = name_of(w.key, id) else {
                    continue;
                };
                if self.cooldowns.get(name).copied().unwrap_or(0) > tick {
                    continue;
                }
                // A full scene change must be worth more than a refocus
                // inside the world the viewer is already reading.
                let effective = if self.current_world.as_deref() == Some(w.key) {
                    score
                } else {
                    score.saturating_sub(CROSS_WORLD_PENALTY)
                };
                if best
                    .as_ref()
                    .is_none_or(|(_, _, _, s, _, _)| effective > *s)
                {
                    best = Some((w.key.to_string(), id, name.clone(), effective, reason, hold));
                }
            }
        }

        // A SHOT IS A COMMITMENT (the calm-director rework): a live shot
        // runs its hold; only STORY-tier beats may cut in, and even they
        // respect the minimum shot length. Everything else waits its turn.
        if let Some((world, id, name, score, reason, hold)) = best {
            let shot_age = tick.saturating_sub(self.shot_started);
            let shot_over = tick >= self.hold_until;
            let story_cut =
                score >= STORY_TIER && score > self.current_score && shot_age >= MIN_SHOT_TICKS;
            let interrupts = shot_over || story_cut;
            if interrupts && self.focus_name.as_ref() != Some(&name) {
                self.set_focus(&name, &world, score, tick, hold as u64, reason);
                return Some(Cue {
                    world_key: world,
                    focus: id,
                    reason: reason.to_string(),
                    hold_ticks: hold,
                });
            }
        }

        // The full roster, every world, deterministic order.
        let roster = roster(worlds);

        // MID-SHOT REFRESH (the calm-director rework): cues aren't in the
        // snapshot, so a viewer who connects mid-hold must still lock on —
        // and calm 30s shots made "wait for the next cut" too long. The
        // re-broadcast repeats the CURRENT cue; the shot clock keeps
        // running (this is not a cut).
        if tick < self.hold_until
            && tick.saturating_sub(self.last_emit) >= REFRESH_TICKS
            && let Some(name) = self.focus_name.clone()
            && let Some((world, id, _)) = roster.iter().find(|(_, _, n)| n == &name).cloned()
        {
            self.last_emit = tick;
            return Some(Cue {
                world_key: world,
                focus: id,
                reason: self.current_reason.clone(),
                hold_ticks: self.hold_until.saturating_sub(tick) as u32,
            });
        }

        // Idle rotation across all characters everywhere. Even an unchanged
        // focus is re-broadcast periodically — cues aren't in the snapshot,
        // and a viewer who joins after the last cut must still lock on.
        if tick >= self.hold_until && !roster.is_empty() {
            self.rotation_idx = (self.rotation_idx + 1) % roster.len();
            let (world, id, name) = roster[self.rotation_idx].clone();
            let refresh_due = tick.saturating_sub(self.last_emit) >= REFRESH_TICKS;
            if self.focus_name.as_ref() != Some(&name) || refresh_due {
                self.set_focus(&name, &world, 0, tick, IDLE_HOLD_TICKS as u64, "roaming");
                return Some(Cue {
                    world_key: world,
                    focus: id,
                    reason: "roaming".to_string(),
                    hold_ticks: IDLE_HOLD_TICKS,
                });
            }
            self.hold_until = tick + IDLE_HOLD_TICKS as u64;
        }
        None
    }

    /// The cross-world roster in upcoming-focus order: index 0 is next up
    /// in the idle rotation. What a stream overlay shows as "who's next" —
    /// events can jump the queue, which is the charm, not a lie.
    pub fn focus_queue(&self, tick: u64, worlds: &[WorldView<'_>]) -> Vec<QueueEntry> {
        let roster = roster(worlds);
        let len = roster.len();
        (1..=len)
            .map(|i| {
                let (world_key, _, name) = roster[(self.rotation_idx + i) % len].clone();
                QueueEntry {
                    focused: self.focus_name.as_ref() == Some(&name),
                    on_cooldown: self.cooldowns.get(&name).copied().unwrap_or(0) > tick,
                    world_key,
                    name,
                }
            })
            .collect()
    }

    fn set_focus(
        &mut self,
        name: &str,
        world: &str,
        score: u32,
        tick: u64,
        hold: u64,
        reason: &str,
    ) {
        self.current_reason = reason.to_string();
        self.focus_name = Some(name.to_string());
        self.current_world = Some(world.to_string());
        self.current_score = score;
        self.hold_until = tick + hold;
        self.shot_started = tick;
        self.last_emit = tick;
        self.cooldowns
            .insert(name.to_string(), tick + FOCUS_COOLDOWN_TICKS);
        self.cooldowns.retain(|_, &mut until| until > tick);
    }
}

/// Everyone everywhere as (world key, net id, name), name-sorted — the
/// deterministic order both the idle rotation and the focus queue walk.
fn roster(worlds: &[WorldView<'_>]) -> Vec<(String, u32, String)> {
    let mut roster: Vec<(String, u32, String)> = worlds
        .iter()
        .flat_map(|w| {
            w.characters
                .iter()
                .map(|(id, n)| (w.key.to_string(), *id, n.clone()))
        })
        .collect();
    roster.sort_by(|a, b| a.2.cmp(&b.2));
    roster
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sentinel the (removed) overview beat used: a cue focus matching no
    /// entity, so the client plays its overview. Real idler net ids are >= 1, so
    /// the rotation must never emit this — asserted below.
    const OVERVIEW_FOCUS: u32 = 0;

    fn death(id: u32) -> SimEvent {
        SimEvent::CharacterDied {
            id,
            name: format!("c{id}"),
            killer: "test".into(),
        }
    }

    fn boss_kill(killer_id: u32) -> SimEvent {
        SimEvent::MonsterKilled {
            rarity: idlin_sim::Rarity::Unique,
            killer_id,
            killer: format!("c{killer_id}"),
            monster: "The Riptide Sovereign".into(),
            def_idx: 0,
            level: 21,
        }
    }

    fn kill(killer_id: u32) -> SimEvent {
        SimEvent::MonsterKilled {
            rarity: idlin_sim::Rarity::Normal,
            killer_id,
            killer: format!("c{killer_id}"),
            monster: "shambler".into(),
            def_idx: 0,
            level: 1,
        }
    }

    fn chars(ids: &[u32]) -> Vec<(u32, String)> {
        ids.iter().map(|i| (*i, format!("c{i}"))).collect()
    }

    #[test]
    fn a_shot_is_a_commitment_below_the_story_tier() {
        // The calm-director rework: a fresh shot holds against sub-story
        // noise — a death elsewhere (80, story-tier) CAN cut after the
        // floor, but a join (75) cannot cut a live shot at all. Mutation:
        // drop the STORY_TIER/MIN_SHOT_TICKS gates → the join cuts, fails.
        let mut d = Director::new();
        let (a_ev, no_ev) = (vec![death(1)], Vec::new());
        let (a_ch, b_ch) = (chars(&[1]), chars(&[2]));
        let worlds1 = [
            WorldView {
                key: "a",
                events: &a_ev,
                characters: &a_ch,
            },
            WorldView {
                key: "b",
                events: &no_ev,
                characters: &b_ch,
            },
        ];
        let cue = d.update(1, &worlds1).expect("the death takes the shot");
        assert_eq!(cue.world_key, "a");
        // Tick 5: a JOIN elsewhere (below the story tier) must NOT cut.
        let b_ev = vec![SimEvent::CharacterJoined {
            id: 2,
            name: "c2".into(),
        }];
        let worlds2 = [
            WorldView {
                key: "a",
                events: &no_ev,
                characters: &a_ch,
            },
            WorldView {
                key: "b",
                events: &b_ev,
                characters: &b_ch,
            },
        ];
        let cut = d.update(5, &worlds2);
        assert!(
            cut.is_none() || cut.as_ref().unwrap().world_key == "a",
            "a join must not cut a live shot: {:?}",
            cut.map(|c| c.world_key)
        );
        // And even a STORY-tier boss fall respects the shot floor.
        let b_boss = vec![boss_kill(2)];
        let worlds3 = [
            WorldView {
                key: "a",
                events: &no_ev,
                characters: &a_ch,
            },
            WorldView {
                key: "b",
                events: &b_boss,
                characters: &b_ch,
            },
        ];
        let early = d.update(20, &worlds3);
        assert!(
            early.is_none() || early.as_ref().unwrap().world_key == "a",
            "even a boss fall waits for the {MIN_SHOT_TICKS}-tick floor"
        );
    }

    #[test]
    fn a_boss_fall_outranks_a_death() {
        // #148 A7: the campaign beat wins the tick — the broadcast cuts to
        // the boss kill even when someone dies elsewhere the same tick.
        // Mutation: drop the Unique arm from the scorer → the death wins.
        let mut d = Director::new();
        let (a_ev, b_ev) = (vec![death(1)], vec![boss_kill(2)]);
        let (a_ch, b_ch) = (chars(&[1]), chars(&[2]));
        let worlds = [
            WorldView {
                key: "shore#A",
                events: &a_ev,
                characters: &a_ch,
            },
            WorldView {
                key: "shore#B",
                events: &b_ev,
                characters: &b_ch,
            },
        ];
        let cue = d.update(1, &worlds).expect("a cue");
        assert_eq!(cue.world_key, "shore#B", "the boss fall holds the camera");
        assert_eq!(cue.reason, "the boss falls");
    }

    #[test]
    fn strongest_event_wins_across_worlds() {
        let mut d = Director::new();
        let (a_ev, b_ev) = (vec![kill(1)], vec![death(1)]);
        let (a_ch, b_ch) = (chars(&[1]), vec![(1, "other".to_string())]);
        let worlds = [
            WorldView {
                key: "a",
                events: &a_ev,
                characters: &a_ch,
            },
            WorldView {
                key: "b",
                events: &b_ev,
                characters: &b_ch,
            },
        ];
        let cue = d.update(1, &worlds).expect("a cue");
        assert_eq!(
            cue.world_key, "b",
            "the death in world b outranks the kill in a"
        );
        assert_eq!(cue.reason, "death");
    }

    #[test]
    fn rotation_visits_every_world() {
        let mut d = Director::new();
        let (no_ev, a_ch, b_ch): (Vec<SimEvent>, _, _) =
            (vec![], chars(&[1]), vec![(5, "zed".to_string())]);
        let mut seen = std::collections::HashSet::new();
        let mut t = 1;
        for _ in 0..40 {
            let worlds = [
                WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                },
                WorldView {
                    key: "b",
                    events: &no_ev,
                    characters: &b_ch,
                },
            ];
            if let Some(c) = d.update(t, &worlds)
                && c.focus != OVERVIEW_FOCUS
            {
                seen.insert(c.world_key.clone());
            }
            t += IDLE_HOLD_TICKS as u64;
        }
        assert!(seen.contains("a") && seen.contains("b"), "got {seen:?}");
    }

    #[test]
    fn featured_focus_cools_down_by_name() {
        let mut d = Director::new();
        let ev = vec![death(7)];
        let ch = chars(&[7, 8]);
        let w = |e: &'static Vec<SimEvent>, c: &'static Vec<(u32, String)>| WorldView {
            key: "a",
            events: e,
            characters: c,
        };
        // (leak for 'static in test simplicity)
        let ev: &'static Vec<SimEvent> = Box::leak(Box::new(ev));
        let ch: &'static Vec<(u32, String)> = Box::leak(Box::new(ch));
        d.update(1, &[w(ev, ch)]).expect("first cue");
        // Same character dies again immediately: cooldown + hold suppress.
        assert!(d.update(2, &[w(ev, ch)]).is_none());
    }

    #[test]
    fn a_lone_character_is_recued_for_late_joiners() {
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = vec![];
        let ch = chars(&[42]);
        let first = d
            .update(
                1,
                &[WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &ch,
                }],
            )
            .expect("initial cue");
        assert_eq!(first.focus, 42);
        let mut refreshed = false;
        for t in 2..200 {
            if let Some(c) = d.update(
                t,
                &[WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &ch,
                }],
            ) {
                assert_eq!(c.focus, 42);
                refreshed = true;
                break;
            }
        }
        assert!(refreshed, "the lone-character cue must refresh");
    }

    #[test]
    fn focus_queue_walks_the_rotation_order_and_flags_focus() {
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = vec![];
        let (a_ch, b_ch) = (chars(&[1, 2]), vec![(9, "zed".to_string())]);
        let worlds = [
            WorldView {
                key: "a",
                events: &no_ev,
                characters: &a_ch,
            },
            WorldView {
                key: "b",
                events: &no_ev,
                characters: &b_ch,
            },
        ];
        let cue = d.update(1, &worlds).expect("initial cue");
        let q = d.focus_queue(1, &worlds);
        assert_eq!(q.len(), 3, "everyone everywhere is listed");
        let focused: Vec<&str> = q
            .iter()
            .filter(|e| e.focused)
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(focused.len(), 1, "exactly one focused entry");
        let by_id = |id: u32| {
            if id == 9 {
                "zed".to_string()
            } else {
                format!("c{id}")
            }
        };
        assert_eq!(
            focused[0],
            by_id(cue.focus),
            "the focused row matches the cue"
        );
        assert!(
            q.iter().any(|e| e.world_key == "b"),
            "the other world is in the queue"
        );
        // The focused character just got a cooldown stamp.
        assert!(q.iter().find(|e| e.focused).unwrap().on_cooldown);
    }

    #[test]
    fn rotation_never_sweeps_to_overview() {
        // The scheduled overview beat was removed: with idlers present and no
        // events, every cue must stay on a person — never the OVERVIEW_FOCUS
        // sentinel. Runs well past the old beat interval. (Mutation: restore the
        // beat → a sentinel cue fires around tick 600 and this fails.)
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = vec![];
        let ch = chars(&[7]);
        for t in 1..1500 {
            if let Some(c) = d.update(
                t,
                &[WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &ch,
                }],
            ) {
                assert_ne!(
                    c.focus, OVERVIEW_FOCUS,
                    "the director must keep an idler in focus, not sweep to overview (tick {t})"
                );
            }
        }
    }
}
