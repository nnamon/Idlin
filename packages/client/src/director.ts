// The spotlight director: picks the one resident the stream shows up close.
// Fed each tick's world events and the residents present, it holds each
// subject for at least DWELL_TICKS, prefers residents something notable just
// happened to, and rations turns so nobody waits longer than twice the
// population times the dwell. Pure and deterministic for the same input
// stream, so the capture tool can run it without a page.

import type { WorldEvent } from "@idlin/sim";

/** 45 seconds of stream time at 10 ticks a second. */
export const DWELL_TICKS = 450;

/** How much an event makes a resident worth showing. Higher wins. */
const WEIGHT = { rule: 1, fault: 1, fight: 2, down: 3 } as const;

export interface Director {
  /** The resident in the spotlight, or null when nobody is present. */
  subject: number | null;
  /** Tick the subject came into the spotlight. */
  since: number;
  /** Per resident present: the last tick it was in the spotlight, or the tick it arrived. */
  readonly seen: Map<number, number>;
  /** Per resident: the strongest notable thing that happened to it since it was last shown. */
  readonly notable: Map<number, { weight: number; tick: number }>;
  /** Per resident: the rule that made its last decision, to tell when the rule in charge changes. */
  readonly rules: Map<number, number>;
}

export function createDirector(): Director {
  return { subject: null, since: 0, seen: new Map(), notable: new Map(), rules: new Map() };
}

/**
 * Takes one tick: the events `step` returned for it and the ids of the
 * residents in the world afterwards. Returns who is in the spotlight.
 */
export function direct(
  director: Director,
  tick: number,
  events: readonly WorldEvent[],
  present: readonly number[],
): number | null {
  const here = new Set(present);
  for (const id of present) if (!director.seen.has(id)) director.seen.set(id, tick);
  for (const id of [...director.seen.keys()]) {
    if (here.has(id)) continue;
    director.seen.delete(id);
    director.notable.delete(id);
    director.rules.delete(id);
  }

  const mark = (id: number, weight: number) => {
    if (!here.has(id)) return;
    const was = director.notable.get(id);
    if (!was || weight >= was.weight) director.notable.set(id, { weight, tick });
  };
  for (const event of events) {
    switch (event.type) {
      case "decide": {
        const was = director.rules.get(event.actor);
        director.rules.set(event.actor, event.rule);
        // A resident's first decision is not news; a change of rule is.
        if (was !== undefined && was !== event.rule) mark(event.actor, WEIGHT.rule);
        break;
      }
      case "fault":
        mark(event.actor, WEIGHT.fault);
        break;
      case "attack":
      case "miss":
        mark(event.actor, WEIGHT.fight);
        break;
      case "hit":
        mark(event.actor, WEIGHT.fight);
        mark(event.target, WEIGHT.fight);
        break;
      case "down":
        mark(event.actor, WEIGHT.down);
        mark(event.by, WEIGHT.down);
        break;
    }
  }

  // Someone who left can't be shown; anyone else keeps the spotlight for the whole dwell.
  if (director.subject !== null && !here.has(director.subject)) director.subject = null;
  if (director.subject === null || tick - director.since >= DWELL_TICKS) {
    const next = pick(director, tick, present);
    if (next !== director.subject) {
      director.subject = next;
      director.since = tick;
    }
  }
  if (director.subject !== null) {
    director.seen.set(director.subject, tick);
    // What happens while on screen has been shown; it earns no second turn.
    director.notable.delete(director.subject);
  }
  return director.subject;
}

/**
 * The next subject. Anyone who has waited the population times the dwell goes
 * first, longest wait first. Otherwise the resident with the strongest notable
 * event in the last dwell, then whoever has waited longest. Ties go to the
 * lowest id.
 *
 * Why no wait reaches twice the population times the dwell: once a resident
 * is urgent, only other urgent residents can go ahead of it. Each of those can
 * go ahead at most once, because after its turn its wait starts again from
 * zero and it cannot become urgent again in the time left. So after one
 * resident turns urgent, at most the rest of the current dwell and one dwell
 * per other resident pass before it is shown. The order among urgent
 * residents does not matter for the cap.
 */
function pick(director: Director, tick: number, present: readonly number[]): number | null {
  const others = present.filter((id) => id !== director.subject);
  const pool = others.length > 0 ? others : present;
  if (pool.length === 0) return null;
  const wait = (id: number) => tick - (director.seen.get(id) ?? tick);
  const urgent = present.length * DWELL_TICKS;
  const score = (id: number) => {
    const news = director.notable.get(id);
    const weight = news && tick - news.tick <= DWELL_TICKS ? news.weight : 0;
    return [wait(id) >= urgent ? wait(id) : 0, weight, wait(id), -id];
  };
  let best = pool[0] as number;
  let bestScore = score(best);
  for (const id of pool.slice(1)) {
    const s = score(id);
    for (let i = 0; i < s.length; i++) {
      if ((s[i] as number) === (bestScore[i] as number)) continue;
      if ((s[i] as number) > (bestScore[i] as number)) {
        best = id;
        bestScore = s;
      }
      break;
    }
  }
  return best;
}
