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
//      are earned by chapters: acts, boss falls, tallies, map opens, deaths,
//      a new deploy walking on, a unique hitting the ground.
//   3. CROSS-WORLD CUTS COST EXTRA. A jump to another instance is a full
//      scene change (new zone, camera snap) — it must be worth more than
//      a refocus inside the world the viewer is already reading.
//
// Scores: (score, hold_ticks). STORY_TIER may interrupt a live shot;
// everything else waits for the shot to end.
const SCORE_ACT: (u32, u32) = (95, 200);
const SCORE_BOSS_KILL: (u32, u32) = (90, 180);
// Map chapters are BY NATURE scene changes — their subject departs the
// emitting world as they fire, so they always pay CROSS_WORLD_PENALTY and
// must clear STORY_TIER after the toll (89-8=81, 88-8=80). At the original
// 85/82 they scored above the tier on paper but could never interrupt in
// practice: the 12-minute endgame audit (#176) watched three map runs
// complete with zero cuts.
const SCORE_MAP_TALLY: (u32, u32) = (89, 120);
const SCORE_MAP_OPEN: (u32, u32) = (88, 120);
const SCORE_DEATH: (u32, u32) = (80, 100);
const SCORE_JOIN: (u32, u32) = (75, 100);
const SCORE_UNIQUE_DROP: (u32, u32) = (70, 100);
/// Only cues at or above this score may cut INTO a live shot.
const STORY_TIER: u32 = 80;
/// The floor under every shot (10s at 10Hz): below-story cues queue
/// behind it, they don't shorten it.
const MIN_SHOT_TICKS: u64 = 100;
/// The ABSOLUTE floor between any two cuts, any tier (the broadcast
/// audit measured 1-second back-to-back pairs when a story beat landed
/// right at a rotation boundary — two full scene changes in the time it
/// takes to blink). Even the story waits three seconds.
const MIN_CUT_GAP_TICKS: u64 = 30;
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
    /// Consecutive updates the focused name was in NO roster — one is a
    /// ferry transit (normal), two is gone (end the shot).
    missing_streak: u32,
    /// A story beat the gap/floor blocked, held for its moment (codex:
    /// the first cut DROPPED an act-fall landing one tick after a
    /// rotation cut — the biggest beat in the game, silently missed).
    /// Held by NAME only — where the subject IS is resolved at fire
    /// time, so a beat survives a ferry transit and never fires into a
    /// world its subject already left.
    /// (name, score, reason, hold, expires_at).
    pending: Option<(String, u32, String, u32, u64)>,
    /// Consecutive updates the PENDING subject was in no roster — one is
    /// a ferry transit (the beat's normal life), two is gone for good:
    /// the ghost is dropped so it can neither shadow live beats nor squat
    /// in the pending slot until expiry (codex round 2 on #176).
    pending_missing: u32,
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
            missing_streak: 0,
            pending: None,
            pending_missing: 0,
            current_score: 0,
            cooldowns: HashMap::new(),
            rotation_idx: 0,
            last_emit: 0,
        }
    }

    /// Feed every world's tick; returns a cue when the broadcast should cut.
    pub fn update(&mut self, tick: u64, worlds: &[WorldView<'_>]) -> Option<Cue> {
        // The full roster, every world, deterministic order. Beats resolve
        // their subject here BY NAME — the emitting world is the wrong
        // anchor for tally/map-open beats, whose subject has already departed
        // it (process_exits removes the character before it emits).
        let roster = roster(worlds);
        let locate = |name: &str| -> Option<(String, u32)> {
            roster
                .iter()
                .find(|(_, _, n)| n == name)
                .map(|(w, id, _)| (w.clone(), *id))
        };

        // The strongest scoreable event this tick, across every world.
        // Every scored event carries its subject's NAME — the only identity
        // stable across worlds (net ids are per-world).
        let mut best: Option<(String, u32, String, u32)> = None;
        for w in worlds {
            for ev in w.events {
                let scored = match ev {
                    SimEvent::ActCompleted { name, act, .. } => Some((
                        name,
                        SCORE_ACT.0,
                        if *act == 1 {
                            "act 1 falls"
                        } else {
                            "act 2 falls"
                        },
                        SCORE_ACT.1,
                    )),
                    SimEvent::MonsterKilled { killer, rarity, .. }
                        if *rarity == idlin_sim::Rarity::Unique =>
                    {
                        Some((
                            killer,
                            SCORE_BOSS_KILL.0,
                            "the boss falls",
                            SCORE_BOSS_KILL.1,
                        ))
                    }
                    SimEvent::MapTally { name, .. } => {
                        Some((name, SCORE_MAP_TALLY.0, "the map tally", SCORE_MAP_TALLY.1))
                    }
                    SimEvent::CharacterDeparted { name, dest, .. }
                        if dest == "charted_shallows" =>
                    {
                        Some((name, SCORE_MAP_OPEN.0, "opens a map", SCORE_MAP_OPEN.1))
                    }
                    SimEvent::CharacterDied { name, .. } => {
                        Some((name, SCORE_DEATH.0, "death", SCORE_DEATH.1))
                    }
                    // Trash kills and routine level-ups are TICKER material —
                    // they never move the camera (the calm-director rework).
                    SimEvent::LootDropped { owner, rarity, .. }
                        if (*rarity as u8) >= RARE_DROP_MIN_RARITY =>
                    {
                        Some((
                            owner,
                            SCORE_UNIQUE_DROP.0,
                            "a unique drops",
                            SCORE_UNIQUE_DROP.1,
                        ))
                    }
                    SimEvent::CharacterJoined { name, .. } => {
                        Some((name, SCORE_JOIN.0, "new challenger", SCORE_JOIN.1))
                    }
                    _ => None,
                };
                let Some((name, score, reason, hold)) = scored else {
                    continue;
                };
                // The cooldown throttles RE-FEATURING a character, not the
                // current shot getting more interesting: the focused
                // subject's own beats bypass it (codex on #176 — a focused
                // runner's tally was cooldown-dead for the first 20s of
                // every 30s rotation shot).
                let is_focus = self.focus_name.as_deref() == Some(name.as_str());
                if !is_focus && self.cooldowns.get(name).copied().unwrap_or(0) > tick {
                    continue;
                }
                // A full scene change must be worth more than a refocus
                // inside the world the viewer is already reading. The toll
                // is judged against where the subject IS (a runner in a
                // 1-tick ferry transit is in no roster: the shot will land
                // in their arrival world, so it pays too).
                let same_world = locate(name)
                    .is_some_and(|(w, _)| self.current_world.as_deref() == Some(w.as_str()));
                let effective = if same_world {
                    score
                } else {
                    score.saturating_sub(CROSS_WORLD_PENALTY)
                };
                if best.as_ref().is_none_or(|(_, s, _, _)| effective > *s) {
                    best = Some((name.clone(), effective, reason.to_string(), hold));
                }
            }
        }

        // A blocked story beat waits for its moment; a stale one (10s) is
        // no longer news. It competes as if fresh.
        if let Some((_, _, _, _, expires)) = &self.pending
            && *expires <= tick
        {
            self.pending = None;
        }
        // A pending subject absent TWICE running is gone for good (the
        // same one-batch-transit heuristic the departed-subject rule
        // uses). Evict the ghost: it can never fire, and it must not hold
        // the slot against a live story beat waiting to be stored.
        if let Some((pname, _, _, _, _)) = &self.pending {
            if locate(pname).is_some() {
                self.pending_missing = 0;
            } else {
                self.pending_missing += 1;
                if self.pending_missing >= 2 {
                    self.pending = None;
                    self.pending_missing = 0;
                }
            }
        }
        // An UNLOCATABLE pending (subject mid-ferry, or gone for good) sits
        // out the competition — it can't fire anyway, and letting its score
        // shadow live beats would drop real story for up to its 10s expiry
        // (codex on #176: a ghost act-fall starving a live boss kill).
        if let Some((pname, pscore, preason, phold, _)) = self.pending.clone()
            && locate(&pname).is_some()
            && best.as_ref().is_none_or(|(_, s, _, _)| pscore > *s)
        {
            best = Some((pname, pscore, preason, phold));
        }

        // A SHOT IS A COMMITMENT (the calm-director rework): a live shot
        // runs its hold; only STORY-tier beats may cut in, and even they
        // respect the minimum shot length. Everything else waits its turn.
        if let Some((name, score, reason, hold)) = best {
            let shot_age = tick.saturating_sub(self.shot_started);
            let shot_over = tick >= self.hold_until;
            let story_cut =
                score >= STORY_TIER && score > self.current_score && shot_age >= MIN_SHOT_TICKS;
            // No cut of ANY kind lands within the absolute gap — the 1s
            // back-to-back pairs the audit measured were a rotation cut
            // chased by a story cut. (A fresh director with no shot yet is
            // exempt: the FIRST cut can't be "too soon after" anything.)
            let gap_ok = self.focus_name.is_none() || shot_age >= MIN_CUT_GAP_TICKS;
            // Where the subject is NOW — a beat may outlive the world that
            // emitted it (the tally arrives as its runner departs).
            let located = locate(&name);
            let interrupts = (shot_over || story_cut) && gap_ok && located.is_some();
            if !interrupts && score >= STORY_TIER {
                // Blocked by the gap/floor — or the subject is mid-ferry
                // (in no roster for a tick): hold the beat for its moment.
                if self
                    .pending
                    .as_ref()
                    .is_none_or(|(_, ps, _, _, _)| score > *ps)
                {
                    self.pending = Some((name.clone(), score, reason.clone(), hold, tick + 100));
                    self.pending_missing = 0;
                }
            }
            // A beat for the ALREADY-FOCUSED subject is not a scene change —
            // it's the current shot getting more interesting. It re-cues in
            // place through the same chokepoint: score/reason/hold update,
            // and set_focus repoints current_world when the subject ferried
            // (a focused runner's tally lands in Saltmere; the feed must
            // follow — codex on #176).
            if interrupts {
                let (world, id) = located.expect("interrupts requires a located subject");
                self.pending = None;
                self.set_focus(&name, &world, score, tick, hold as u64, &reason);
                return Some(Cue {
                    world_key: world,
                    focus: id,
                    reason: reason.to_string(),
                    hold_ticks: hold,
                });
            }
        }

        // A DEPARTED SUBJECT ENDS THE SHOT (#162, the entities=0 blip) —
        // but only after TWO consecutive absent updates: a zone transfer
        // leaves the traveler in no world's roster for exactly one batch
        // (departed A at tick T, arrives B at T+1), and codex traced the
        // eager version yanking the camera off every traveler at every
        // zone door — worse than the blip. Truly gone (killed, recalled)
        // = absent twice = the camera moves on, gap-exempt (vacant ground
        // is worse than a quick cut).
        if let Some(name) = &self.focus_name {
            if let Some((world, _, _)) = roster.iter().find(|(_, _, n)| n == name) {
                self.missing_streak = 0;
                // THE SHOT FOLLOWS THE SUBJECT: a beat-less zone door mid-
                // shot moves them to a new world. current_world must track
                // them every tick — replication targets it on every cue-less
                // tick, so a stale value points the featured feed at the
                // world they left (and made it oscillate against refresh
                // cues, 1 tick right / 49 ticks wrong — codex on #176).
                if self.current_world.as_deref() != Some(world.as_str()) {
                    self.current_world = Some(world.clone());
                }
            } else {
                self.missing_streak += 1;
                if self.missing_streak >= 2 {
                    self.focus_name = None;
                    self.hold_until = tick;
                    self.missing_streak = 0;
                }
            }
        }

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
        if tick >= self.hold_until
            && (self.focus_name.is_none()
                || tick.saturating_sub(self.shot_started) >= MIN_CUT_GAP_TICKS)
            && !roster.is_empty()
        {
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
    fn no_two_cuts_land_within_the_absolute_gap() {
        // The audit's 1s back-to-back pairs: a rotation cut chased by a
        // story cut. Even story-tier beats respect MIN_CUT_GAP_TICKS.
        // Mutation: drop the gap check from `interrupts` → the boss cut
        // lands at tick 2 and this fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let (a_ch, b_ch) = (chars(&[1]), chars(&[2]));
        let worlds1 = [WorldView {
            key: "a",
            events: &no_ev,
            characters: &a_ch,
        }];
        d.update(1, &worlds1).expect("rotation takes the shot");
        let b_ev = vec![boss_kill(2)];
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
        let early = d.update(2, &worlds2);
        assert!(
            early.is_none() || early.as_ref().unwrap().world_key == "a",
            "a boss cut one tick after a rotation cut is the strobe again"
        );
    }

    #[test]
    fn a_blocked_story_beat_is_delayed_not_dropped() {
        // Codex on the min-gap: the first cut DROPPED a story beat that
        // landed inside the gap — the act-fall could silently miss the
        // camera. The pending buffer holds it for its moment. Mutation:
        // remove the pending stash → no cue ever fires for the boss and
        // this fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let (a_ch, b_ch) = (chars(&[1]), chars(&[2]));
        d.update(
            1,
            &[WorldView {
                key: "a",
                events: &no_ev,
                characters: &a_ch,
            }],
        )
        .expect("rotation takes the shot");
        // The boss falls INSIDE the gap: no cut now...
        let b_ev = vec![boss_kill(2)];
        let blocked = d.update(
            2,
            &[
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
            ],
        );
        assert!(
            blocked.is_none() || blocked.as_ref().unwrap().world_key == "a",
            "the gap holds"
        );
        // ...but once the shot floor opens, the HELD beat fires without
        // the event recurring.
        let mut fired = false;
        for t in 3..140 {
            let quiet = [
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
            if let Some(c) = d.update(t, &quiet)
                && c.world_key == "b"
            {
                assert_eq!(c.reason, "the boss falls");
                fired = true;
                break;
            }
        }
        assert!(fired, "the held story beat must fire, not vanish");
    }

    #[test]
    fn a_tally_beat_survives_the_ferry_transit() {
        // #176: process_exits removes the runner BEFORE it emits the tally,
        // so the beat's subject is in NO world's roster on the emit tick —
        // the old (emitting world, net id) anchor dropped every tally ever
        // fired. Beats resolve by NAME at fire time: the beat pends through
        // the 1-tick transit and cuts to wherever the runner lands.
        // Mutations: restore the emitting-world name lookup → the beat is
        // dropped on emit and tick 2 cues "roaming"; restore SCORE_MAP_TALLY=85
        // → 85-8=77 misses STORY_TIER and never pends. Both fail here.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let empty: Vec<(u32, String)> = Vec::new();
        let tally_ev = vec![SimEvent::MapTally {
            id: 7,
            name: "Kargan".into(),
            kills: 120,
            deaths: 1,
            items: 30,
            ticks: 9000,
        }];
        // Emit tick: the map instance he just left, him in transit.
        let cue = d.update(
            1,
            &[
                WorldView {
                    key: "charted_shallows#Kargan@71810",
                    events: &tally_ev,
                    characters: &empty,
                },
                WorldView {
                    key: "saltmere",
                    events: &no_ev,
                    characters: &empty,
                },
            ],
        );
        assert!(cue.is_none(), "no cue may target a subject in transit");
        // Arrival tick: he lands in Saltmere under a NEW net id.
        let salt_ch = vec![(3u32, "Kargan".to_string())];
        let cue = d
            .update(
                2,
                &[
                    WorldView {
                        key: "charted_shallows#Kargan@71810",
                        events: &no_ev,
                        characters: &empty,
                    },
                    WorldView {
                        key: "saltmere",
                        events: &no_ev,
                        characters: &salt_ch,
                    },
                ],
            )
            .expect("the held tally fires on arrival");
        assert_eq!(cue.reason, "the map tally");
        assert_eq!(cue.world_key, "saltmere");
        assert_eq!(cue.focus, 3, "the cue carries the ARRIVAL net id");
    }

    #[test]
    fn a_map_open_beat_lands_on_the_new_map_instance() {
        // #176's twin: the map-open departure is emitted by the town the runner
        // is LEAVING. The cut must land in the map instance they arrive
        // in. Mutations as the tally test (emitting-world lookup / the
        // SCORE_MAP_OPEN=82 revert, 82-8=74 < STORY_TIER) both fail here.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let empty: Vec<(u32, String)> = Vec::new();
        let open_ev = vec![SimEvent::CharacterDeparted {
            id: 7,
            name: "Veles".into(),
            dest: "charted_shallows".into(),
        }];
        let cue = d.update(
            1,
            &[WorldView {
                key: "saltmere",
                events: &open_ev,
                characters: &empty,
            }],
        );
        assert!(cue.is_none(), "no cue may target a subject in transit");
        let map_ch = vec![(4u32, "Veles".to_string())];
        let cue = d
            .update(
                2,
                &[
                    WorldView {
                        key: "saltmere",
                        events: &no_ev,
                        characters: &empty,
                    },
                    WorldView {
                        key: "charted_shallows#Veles@99999",
                        events: &no_ev,
                        characters: &map_ch,
                    },
                ],
            )
            .expect("the held map-open fires on arrival");
        assert_eq!(cue.reason, "opens a map");
        assert_eq!(cue.world_key, "charted_shallows#Veles@99999");
        assert_eq!(cue.focus, 4, "the cue carries the ARRIVAL net id");
    }

    #[test]
    fn a_focused_runners_tally_upgrades_the_shot_in_place() {
        // Codex on #176: the focused subject's own beats were doubly dead —
        // the per-name cooldown (armed by the rotation cut that focused
        // them) ate the event, and the same-name guard suppressed the cue.
        // In a 4-runner endgame that's a quarter of all tallies. The beat
        // must re-cue IN PLACE: new reason, and the world repointed to
        // where the runner landed. Mutations: restore the same-name guard
        // OR the cooldown filter without the focus bypass → the tick-151
        // cue is the "roaming" refresh, and the reason assert fails.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let empty: Vec<(u32, String)> = Vec::new();
        let map_ch = vec![(7u32, "Kargan".to_string())];
        // Rotation focuses Kargan in his map instance (cooldown armed).
        let cue = d
            .update(
                1,
                &[WorldView {
                    key: "charted_shallows#Kargan@71810",
                    events: &no_ev,
                    characters: &map_ch,
                }],
            )
            .expect("rotation takes the shot");
        assert_eq!(cue.reason, "roaming");
        // Mid-shot, mid-cooldown: the map run ends. Emit tick = transit.
        let tally_ev = vec![SimEvent::MapTally {
            id: 7,
            name: "Kargan".into(),
            kills: 120,
            deaths: 1,
            items: 30,
            ticks: 9000,
        }];
        let cue = d.update(
            150,
            &[
                WorldView {
                    key: "charted_shallows#Kargan@71810",
                    events: &tally_ev,
                    characters: &empty,
                },
                WorldView {
                    key: "saltmere",
                    events: &no_ev,
                    characters: &empty,
                },
            ],
        );
        assert!(cue.is_none(), "no cue may target a subject in transit");
        // Arrival: the shot upgrades in place and follows him to Saltmere.
        let salt_ch = vec![(3u32, "Kargan".to_string())];
        let cue = d
            .update(
                151,
                &[WorldView {
                    key: "saltmere",
                    events: &no_ev,
                    characters: &salt_ch,
                }],
            )
            .expect("the focused runner's tally still cues");
        assert_eq!(cue.reason, "the map tally");
        assert_eq!(cue.world_key, "saltmere");
        assert_eq!(cue.focus, 3);
        assert_eq!(
            d.current_world.as_deref(),
            Some("saltmere"),
            "replication targets current_world on cue-less ticks"
        );
    }

    #[test]
    fn a_ghost_pending_does_not_starve_live_beats() {
        // Codex on #176: a pending beat whose subject is GONE (killed and
        // recalled, never to return) used to shadow every weaker live beat
        // by raw score until its 10s expiry. An unlocatable pending sits
        // out the competition. Mutation: let the pending compete without
        // the locate() guard → the ghost act-fall (87) outbids the live
        // boss kill (82), nothing can fire, and the reason assert sees
        // the "roaming" refresh instead.
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
        .expect("rotation takes the shot");
        // c2 completes an act inside the shot floor: pends...
        let b_ch = chars(&[2]);
        let act_ev = vec![SimEvent::ActCompleted {
            id: 2,
            name: "c2".into(),
            act: 2,
        }];
        let blocked = d.update(
            5,
            &[
                WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                },
                WorldView {
                    key: "b",
                    events: &act_ev,
                    characters: &b_ch,
                },
            ],
        );
        assert!(
            blocked.is_none() || blocked.as_ref().unwrap().world_key == "a",
            "the shot floor holds the act beat"
        );
        // ...then c2 is gone for good. A LIVE boss falls elsewhere: it must
        // fire despite the ghost's higher score.
        let c_ch = chars(&[3]);
        let boss_ev = vec![boss_kill(3)];
        let cue = d
            .update(
                101,
                &[
                    WorldView {
                        key: "a",
                        events: &no_ev,
                        characters: &a_ch,
                    },
                    WorldView {
                        key: "c",
                        events: &boss_ev,
                        characters: &c_ch,
                    },
                ],
            )
            .expect("the live boss kill fires");
        assert_eq!(cue.reason, "the boss falls");
        assert_eq!(cue.world_key, "c");
    }

    #[test]
    fn a_beatless_ferry_repoints_the_featured_world() {
        // Codex on #176 (second half of the focused-transfer finding): a
        // focused subject walking a zone door WITHOUT a beat left
        // current_world stale — and replication targets current_world on
        // every cue-less tick, so the featured feed oscillated between the
        // refresh cue's world and the dead one. The departed-subject scan
        // repoints it the tick the subject reappears. Mutation: drop the
        // repoint → current_world stays "a" and this fails.
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
        .expect("rotation takes the shot");
        assert_eq!(d.current_world.as_deref(), Some("a"));
        // Transit tick: c1 in no roster (the shot holds, streak = 1)...
        let empty: Vec<(u32, String)> = Vec::new();
        d.update(
            2,
            &[WorldView {
                key: "a",
                events: &no_ev,
                characters: &empty,
            }],
        );
        // ...arrival tick: c1 reappears in world b. No beat, no cue due —
        // but the director's self-model must follow.
        let b_ch = vec![(9u32, "c1".to_string())];
        d.update(
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
        );
        assert_eq!(
            d.current_world.as_deref(),
            Some("b"),
            "the featured world follows a beat-less ferry"
        );
    }

    #[test]
    fn a_ghost_pending_vacates_the_slot_for_a_blocked_live_beat() {
        // Codex round 2 on #176: the locate() gate kept a ghost from
        // COMPETING, but it still SQUATTED in the pending slot — a live
        // story beat blocked by the shot floor could not be stored behind
        // the ghost's higher dead score, and was lost by the time the
        // floor opened. The ghost is evicted after two roster-absent
        // updates (the one-batch-transit heuristic). Mutation: drop the
        // eviction → the boss beat at t20 fails the `82 > 87` store check,
        // the ghost sits out at t101 via locate(), and the reason assert
        // sees "roaming" instead.
        let mut d = Director::new();
        let no_ev: Vec<SimEvent> = Vec::new();
        let a_ch = chars(&[1]);
        let quiet_a = |d: &mut Director, t: u64| {
            d.update(
                t,
                &[WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                }],
            )
        };
        quiet_a(&mut d, 1).expect("rotation takes the shot");
        // c2 completes an act inside the shot floor: pends at 87...
        let b_ch = chars(&[2]);
        let act_ev = vec![SimEvent::ActCompleted {
            id: 2,
            name: "c2".into(),
            act: 2,
        }];
        d.update(
            5,
            &[
                WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                },
                WorldView {
                    key: "b",
                    events: &act_ev,
                    characters: &b_ch,
                },
            ],
        );
        // ...then c2 is recalled: two quiet updates evict the ghost.
        quiet_a(&mut d, 6);
        quiet_a(&mut d, 7);
        // A live boss falls, still inside the shot floor: it must claim
        // the now-vacant slot despite its lower score...
        let c_ch = chars(&[3]);
        let boss_ev = vec![boss_kill(3)];
        let blocked = d.update(
            20,
            &[
                WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                },
                WorldView {
                    key: "c",
                    events: &boss_ev,
                    characters: &c_ch,
                },
            ],
        );
        assert!(
            blocked.is_none() || blocked.as_ref().unwrap().world_key == "a",
            "the shot floor holds the boss beat"
        );
        // ...and fire once the floor opens.
        let cue = d
            .update(
                101,
                &[
                    WorldView {
                        key: "a",
                        events: &no_ev,
                        characters: &a_ch,
                    },
                    WorldView {
                        key: "c",
                        events: &no_ev,
                        characters: &c_ch,
                    },
                ],
            )
            .expect("the held boss beat fires once the floor opens");
        assert_eq!(cue.reason, "the boss falls");
        assert_eq!(cue.world_key, "c");
    }

    #[test]
    fn a_pending_beat_fires_where_the_subject_is_now() {
        // The latent half of #176: the pending buffer used to store the
        // (world, id) captured at BLOCK time and fire them stale — a
        // subject who ferried during the 3-10s block got a cue aimed at
        // the world they'd left. The fire-time roster lookup must win.
        // Mutation: store (world, id) in `pending` again → the cue lands
        // in "b" with net id 2 and both asserts fail.
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
        .expect("rotation takes the shot");
        // c2 completes an act in world b, inside the shot floor: pends.
        let b_ch = chars(&[2]);
        let act_ev = vec![SimEvent::ActCompleted {
            id: 2,
            name: "c2".into(),
            act: 2,
        }];
        let blocked = d.update(
            5,
            &[
                WorldView {
                    key: "a",
                    events: &no_ev,
                    characters: &a_ch,
                },
                WorldView {
                    key: "b",
                    events: &act_ev,
                    characters: &b_ch,
                },
            ],
        );
        assert!(
            blocked.is_none() || blocked.as_ref().unwrap().world_key == "a",
            "the shot floor holds the act beat"
        );
        // By the time the floor opens, c2 has ferried to world c under a
        // new net id. The held beat must follow them there.
        let c_ch = vec![(9u32, "c2".to_string())];
        let cue = d
            .update(
                101,
                &[
                    WorldView {
                        key: "a",
                        events: &no_ev,
                        characters: &a_ch,
                    },
                    WorldView {
                        key: "c",
                        events: &no_ev,
                        characters: &c_ch,
                    },
                ],
            )
            .expect("the held act beat fires once the floor opens");
        assert_eq!(cue.reason, "act 2 falls");
        assert_eq!(cue.world_key, "c", "fire-time location, not block-time");
        assert_eq!(cue.focus, 9, "fire-time net id, not block-time");
    }

    #[test]
    fn a_departed_subject_ends_the_shot() {
        // #162 (the entities=0 blip): the focus transfers out mid-hold —
        // the camera must re-cue NOW, not dwell on vacant ground. The
        // fresh-director exemption lets the recovery cut skip the gap.
        // Mutation: drop the departed-subject block → no cue until the
        // 30s hold expires and this fails.
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
        .expect("the shot starts");
        // The subject departs; only world b has anyone now. ONE absent
        // update is a ferry transit — the shot holds...
        let b_ch = chars(&[2]);
        let empty: Vec<(u32, String)> = Vec::new();
        let views = |t: u64, d: &mut Director| {
            d.update(
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
            )
        };
        let first = views(10, &mut d);
        assert!(
            first.is_none() || first.as_ref().unwrap().world_key == "a",
            "one absent update is a transit, not a departure"
        );
        // ...two is gone: the camera moves on.
        let cue = views(11, &mut d);
        assert_eq!(
            cue.map(|c| c.world_key),
            Some("b".to_string()),
            "two absent updates end the shot"
        );
    }

    #[test]
    fn a_ferry_transit_does_not_lose_the_camera() {
        // Codex on Q10: a transfer leaves the traveler rosterless for ONE
        // batch — the eager cut yanked the camera off every traveler at
        // every zone door. Present again next update = the shot survives.
        // Mutation: drop the missing_streak grace → the follow breaks.
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
        .expect("the shot starts");
        let empty: Vec<(u32, String)> = Vec::new();
        let b_ch = chars(&[2]);
        // Transit tick: c1 in no roster.
        let mid = d.update(
            5,
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
        );
        assert!(
            mid.is_none() || mid.as_ref().unwrap().world_key == "a",
            "the transit tick must not cut away"
        );
        // Arrival tick: c1 lands in world c — the follow survives.
        let c_ch = chars(&[1]);
        let _ = d.update(
            6,
            &[
                WorldView {
                    key: "c",
                    events: &no_ev,
                    characters: &c_ch,
                },
                WorldView {
                    key: "b",
                    events: &no_ev,
                    characters: &b_ch,
                },
            ],
        );
        let q = d.focus_queue(
            6,
            &[
                WorldView {
                    key: "c",
                    events: &no_ev,
                    characters: &c_ch,
                },
                WorldView {
                    key: "b",
                    events: &no_ev,
                    characters: &b_ch,
                },
            ],
        );
        assert!(
            q.iter().any(|e| e.name == "c1" && e.focused),
            "the follow survives the ferry"
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
        // Fixture is sim-faithful: a real death event carries the RESIDENT's
        // name (the sim emits it in the world the character died in), and
        // names are globally unique across worlds (joins key by name).
        let mut d = Director::new();
        let (a_ev, b_ev) = (vec![kill(1)], vec![death(2)]);
        let (a_ch, b_ch) = (chars(&[1]), chars(&[2]));
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
