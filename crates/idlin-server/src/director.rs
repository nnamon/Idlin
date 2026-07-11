//! The broadcast camera (operator ruling, 2026-07-11): a STABLE camera
//! that watches one character at a time and switches on a fixed rotation.
//! No event scoring, no story cuts, no pending beats — the operator's
//! words: "just have a stable camera that switches when the character
//! view switches. Start simple." Events still reach the viewer through
//! the ticker and banners (replication's announcement splice); the
//! CAMERA ignores them entirely.

use idlin_sim::SimEvent;

/// One world's tick, as the camera sees it.
pub struct WorldView<'a> {
    pub key: &'a str,
    /// Present for replication's call-site symmetry; the camera reads no
    /// events (operator ruling — rotation only).
    pub events: &'a [SimEvent],
    /// Every character there this tick (net id, name) — dead included;
    /// a corpse awaiting respawn is still on camera until rotation moves.
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

/// One row of the focus queue: an idler somewhere, and when the rotation
/// will reach them (their position in the returned Vec).
pub struct QueueEntry {
    /// Where they are (tests assert cross-world coverage; the wire entry
    /// carries the zone display name instead).
    #[allow(dead_code)]
    pub world_key: String,
    pub name: String,
    /// Currently held by the camera.
    pub focused: bool,
    /// Kept for wire compatibility; nothing sets it under rotation-only.
    pub on_cooldown: bool,
}

/// The dwell per character (30s at 10Hz): long enough to watch them DO
/// something — fight a pack, clear a room — before the rotation moves on.
const SHOT_TICKS: u32 = 300;
/// Re-broadcast the current cue this often even when focus is unchanged —
/// cues aren't in the snapshot, so without this a viewer who connects
/// after the last switch never locks on. A repeat cue carries the SAME
/// (world, focus); it never moves the camera.
const REFRESH_TICKS: u64 = 50;

pub struct Director {
    /// The focused character by NAME — the only identity stable across
    /// worlds (net ids are per-world, and a transfer changes both).
    focus_name: Option<String>,
    /// The world the broadcast currently mirrors. Replication targets this
    /// on cue-less ticks, so it must track the subject every tick.
    pub current_world: Option<String>,
    hold_until: u64,
    /// Consecutive updates the focused name was in NO roster — one is a
    /// ferry transit (normal), two is gone (advance the rotation).
    missing_streak: u32,
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
            missing_streak: 0,
            rotation_idx: 0,
            last_emit: 0,
        }
    }

    /// Feed every world's tick; returns a cue when the broadcast should
    /// switch (or re-announce) its view. Pure rotation:
    ///   1. every SHOT_TICKS, advance to the next character (name order);
    ///   2. a subject gone from every roster for two updates advances the
    ///      rotation immediately (one absence is a zone-door transit);
    ///   3. the camera FOLLOWS its subject across zone doors (the feed
    ///      repoints; this is a follow, not a switch);
    ///   4. a periodic refresh re-announces the current view so late
    ///      joiners lock on.
    pub fn update(&mut self, tick: u64, worlds: &[WorldView<'_>]) -> Option<Cue> {
        let roster = roster(worlds);
        if roster.is_empty() {
            // A briefly-empty roster (a lone subject mid-ferry) must not
            // forget the focus — the streak logic owns gone-ness.
            return None;
        }

        // Where is the subject now? (None while mid-ferry.)
        let located = self.focus_name.as_ref().and_then(|name| {
            roster
                .iter()
                .find(|(_, _, n)| n == name)
                .map(|(w, id, _)| (w.clone(), *id))
        });

        // A subject gone from every roster twice running is gone for good
        // (killed-and-recalled, not a one-batch zone transit): advance now
        // — vacant ground is worse than an early switch.
        if self.focus_name.is_some() {
            if located.is_some() {
                self.missing_streak = 0;
            } else {
                self.missing_streak += 1;
                if self.missing_streak >= 2 {
                    self.hold_until = tick; // force the advance below
                    self.missing_streak = 0;
                }
            }
        }

        // The switch: advance the rotation on schedule.
        if tick >= self.hold_until {
            // The FIRST switch starts at the top of the order; later
            // switches advance. (The roster can shrink between calls, so
            // always re-clamp.)
            if self.focus_name.is_some() {
                self.rotation_idx += 1;
            }
            self.rotation_idx %= roster.len();
            let (world, id, name) = roster[self.rotation_idx].clone();
            self.focus_name = Some(name);
            self.current_world = Some(world.clone());
            self.hold_until = tick + SHOT_TICKS as u64;
            self.last_emit = tick;
            self.missing_streak = 0;
            return Some(Cue {
                world_key: world,
                focus: id,
                reason: "watching".to_string(),
                hold_ticks: SHOT_TICKS,
            });
        }

        // Mid-shot: follow the subject (a zone door repoints the feed —
        // replication targets current_world on cue-less ticks) and refresh
        // for late joiners.
        if let Some((world, id)) = located {
            let moved = self.current_world.as_deref() != Some(world.as_str());
            if moved {
                self.current_world = Some(world.clone());
            }
            if moved || tick.saturating_sub(self.last_emit) >= REFRESH_TICKS {
                self.last_emit = tick;
                return Some(Cue {
                    world_key: world,
                    focus: id,
                    reason: "watching".to_string(),
                    hold_ticks: self.hold_until.saturating_sub(tick) as u32,
                });
            }
        }
        None
    }

    /// The roster in upcoming-view order: index 0 is next up.
    pub fn focus_queue(&self, _tick: u64, worlds: &[WorldView<'_>]) -> Vec<QueueEntry> {
        let roster = roster(worlds);
        let len = roster.len();
        (1..=len)
            .map(|i| {
                let (world_key, _, name) = roster[(self.rotation_idx + i) % len].clone();
                QueueEntry {
                    focused: self.focus_name.as_ref() == Some(&name),
                    on_cooldown: false,
                    world_key,
                    name,
                }
            })
            .collect()
    }
}

/// Everyone everywhere as (world key, net id, name), name-sorted — the
/// deterministic order the rotation walks.
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

    fn chars(ids: &[u32]) -> Vec<(u32, String)> {
        ids.iter().map(|i| (*i, format!("c{i}"))).collect()
    }

    #[test]
    fn the_rotation_is_the_whole_camera() {
        // Operator ruling: a stable camera that switches per character —
        // events NEVER move it. A death (the old system's strongest
        // mid-shot interrupt) in another world must not cut. Mutation:
        // reintroduce any event-driven cut → the world_key assert fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let (a_ch, b_ch) = (chars(&[1]), chars(&[2]));
        let cue = d
            .update(
                1,
                &[
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
                ],
            )
            .expect("the first switch");
        assert_eq!(cue.reason, "watching");
        let first_world = cue.world_key.clone();
        // A death fires in the OTHER world mid-shot: the camera must hold.
        let died = vec![SimEvent::CharacterDied {
            id: 2,
            name: "c2".into(),
            killer: "wight".into(),
        }];
        let (evs_a, evs_b) = if first_world == "a" {
            (&no_ev, &died)
        } else {
            (&died, &no_ev)
        };
        for t in 2..250 {
            if let Some(c) = d.update(
                t,
                &[
                    WorldView {
                        key: "a",
                        events: evs_a,
                        characters: &a_ch,
                    },
                    WorldView {
                        key: "b",
                        events: evs_b,
                        characters: &b_ch,
                    },
                ],
            ) {
                assert_eq!(
                    c.world_key, first_world,
                    "an event moved the camera — the rotation is the whole camera"
                );
            }
        }
    }

    #[test]
    fn the_rotation_visits_every_character_in_order() {
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let (a_ch, b_ch) = (chars(&[1]), vec![(5u32, "zed".to_string())]);
        let mut seen = Vec::new();
        let mut t = 1u64;
        for _ in 0..4 {
            let cue = loop {
                if let Some(c) = d.update(
                    t,
                    &[
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
                    ],
                ) && c.hold_ticks == SHOT_TICKS
                {
                    break c;
                }
                t += 1;
            };
            seen.push(cue.world_key.clone());
            t += 1;
        }
        assert_eq!(
            seen,
            vec!["a", "b", "a", "b"],
            "name order, every character, wraps"
        );
    }

    #[test]
    fn a_departed_subject_advances_after_the_transit_grace() {
        // One absent update = a zone-door transit (hold); two = gone —
        // advance immediately rather than film vacant ground. Mutation:
        // drop the streak logic → no switch until the 30s hold and the
        // in-window assert fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let a_ch = chars(&[1]);
        let b_ch = chars(&[2]);
        let empty: Vec<(u32, String)> = Vec::new();
        let cue = d
            .update(
                1,
                &[
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
                ],
            )
            .expect("first switch");
        assert_eq!(cue.world_key, "a");
        // c1 vanishes entirely. Within the grace the camera moves to c2.
        let mut switched = None;
        for t in 2..10 {
            if let Some(c) = d.update(
                t,
                &[
                    WorldView {
                        key: "a",
                        events: &no_ev,
                        characters: &empty,
                    },
                    WorldView {
                        key: "b",
                        events: &no_ev,
                        characters: &b_ch,
                    },
                ],
            ) {
                switched = Some((t, c.world_key.clone()));
                break;
            }
        }
        let (t, world) = switched.expect("the camera must advance off vacant ground");
        assert!(
            t <= 4,
            "advance within the two-update grace, not the 30s hold"
        );
        assert_eq!(world, "b");
    }

    #[test]
    fn the_camera_follows_its_subject_through_a_zone_door() {
        // A mid-shot zone transfer repoints the feed to the subject's new
        // world as a FOLLOW (cue emitted, world changes, the shot clock
        // keeps running). Mutation: drop the moved-repoint → the feed sits
        // on the old world until the next refresh/switch and this fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let a_ch = chars(&[1]);
        d.update(
            1,
            &[WorldView {
                key: "a",
                events: &no_ev,
                characters: &a_ch,
            }],
        )
        .expect("first switch");
        // Transit tick: nowhere.
        let empty: Vec<(u32, String)> = Vec::new();
        assert!(
            d.update(
                2,
                &[WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &empty,
                }],
            )
            .is_none(),
            "one absence is a transit — no switch, no vacant cue"
        );
        // Arrival: c1 lands in world b under a new net id.
        let b_ch = vec![(9u32, "c1".to_string())];
        let cue = d
            .update(
                3,
                &[
                    WorldView {
                        key: "a",
                        events: &no_ev,
                        characters: &empty,
                    },
                    WorldView {
                        key: "b",
                        events: &no_ev,
                        characters: &b_ch,
                    },
                ],
            )
            .expect("the follow re-cue");
        assert_eq!(cue.world_key, "b");
        assert_eq!(cue.focus, 9, "the arrival net id");
        assert_eq!(d.current_world.as_deref(), Some("b"));
    }

    #[test]
    fn a_late_joiner_gets_a_refresh_within_five_seconds() {
        // Cues aren't in snapshots: the current view re-announces every
        // REFRESH_TICKS. Mutation: drop the refresh arm → no cue between
        // switches and this fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let a_ch = chars(&[1]);
        d.update(
            1,
            &[WorldView {
                key: "a",
                events: &no_ev,
                characters: &a_ch,
            }],
        )
        .expect("first switch");
        let mut refreshed = false;
        for t in 2..=(1 + REFRESH_TICKS + 1) {
            if let Some(c) = d.update(
                t,
                &[WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                }],
            ) {
                assert_eq!(c.world_key, "a");
                assert!(c.hold_ticks < SHOT_TICKS, "a refresh, not a new shot");
                refreshed = true;
                break;
            }
        }
        assert!(refreshed, "the view re-announces for late joiners");
    }

    #[test]
    fn focus_queue_walks_the_rotation_order() {
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let (a_ch, b_ch) = (chars(&[1]), vec![(5u32, "zed".to_string())]);
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
        d.update(1, &worlds).expect("first switch");
        let q = d.focus_queue(1, &worlds);
        assert_eq!(q.len(), 2);
        assert!(q.iter().any(|e| e.focused), "the current view is flagged");
        let worlds_seen: std::collections::HashSet<_> =
            q.iter().map(|e| e.world_key.clone()).collect();
        assert_eq!(worlds_seen.len(), 2, "the queue spans the worlds");
    }
}
