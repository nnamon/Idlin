// Numbers about how a run of the world would look to someone watching, worked
// out from the simulation's event log. Pure functions; durations are in seconds
// of stream time. Thresholds follow docs/watch-rubric.md.

import type { WorldEvent } from "@idlin/sim";
import { DWELL_TICKS } from "../../../packages/client/src/director.ts";

export const TICKS_PER_SECOND = 10;
export const DEAD_AIR_LIMIT_SECONDS = 20;
export const STUCK_LIMIT_SECONDS = 60;
/** Decisions to stand still on purpose: `wait`, and working a node or the fire. */
const STANDING_WORK: ReadonlySet<string> = new Set(["wait", "chop", "fish", "cook"]);
const ACTION_MIX_WINDOW_SECONDS = 600;

export interface ActorSample {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/**
 * One tick of a run: the events `step` returned and where everyone stood
 * afterwards, on the map the viewer shows. `elsewhere` holds the residents
 * off that map and what they decided there; only the action mix reads it.
 */
export interface TickRecord {
  readonly events: readonly WorldEvent[];
  readonly actors: readonly ActorSample[];
  readonly elsewhere?: {
    readonly actors: readonly ActorSample[];
    readonly events: readonly WorldEvent[];
  };
}

export interface ActionMix {
  readonly name: string;
  readonly actions: number;
}

export interface WatchMetrics {
  readonly seconds: number;
  readonly actors: number;
  /** Longest stretch in which nothing visible happened: nobody changed tile and nobody's rule in charge changed. */
  readonly deadAirSeconds: number;
  /** Actors that at some point neither changed tile nor chose to rest (`wait`) for longer than the limit. */
  readonly stuckActors: readonly string[];
  /** By actor id, the fewest different actions the actor used in any ten-minute window. */
  readonly actionMix: Readonly<Record<string, ActionMix>>;
  /**
   * Actors that used a single action throughout some ten-minute window. In
   * this list and in `stuckActors`, a name more than one actor had is
   * followed by the id.
   */
  readonly singleActionActors: readonly string[];
  readonly decisionsPerMinute: number;
  readonly faults: number;
  readonly hardFails: readonly string[];
}

export function watchMetrics(run: readonly TickRecord[]): WatchMetrics {
  const seconds = run.length / TICKS_PER_SECOND;
  const names = new Map<number, string>();
  /**
   * The stretches of ticks each actor was in the run, first to last. An actor
   * that leaves the map and comes back has one for each time it was there.
   */
  const seen = new Map<number, { first: number; last: number }[]>();
  /** The same for the action mix, which counts a resident off the map as there. */
  const present = new Map<number, { first: number; last: number }[]>();
  const lastAlive = new Map<number, number>();
  const lastSpot = new Map<number, string>();
  const stuck = new Set<number>();
  const actions = new Map<number, { tick: number; action: string }[]>();
  const lastRule = new Map<number, number>();
  const resting = new Set<number>();
  let lastVisible = 0;
  let deadAirTicks = 0;
  let decisions = 0;
  let faults = 0;
  const addAction = (actor: number, tick: number, action: string): void => {
    const list = actions.get(actor) ?? [];
    list.push({ tick, action });
    actions.set(actor, list);
  };
  /** Adds `tick` to the actor's stretches in `spans`; whether it starts a new one. */
  const extend = (
    spans: Map<number, { first: number; last: number }[]>,
    id: number,
    tick: number,
  ): boolean => {
    const list = spans.get(id) ?? [];
    spans.set(id, list);
    const span = list[list.length - 1];
    if (span && span.last === tick) return false;
    if (span && span.last === tick - 1) {
      span.last = tick;
      return false;
    }
    list.push({ first: tick, last: tick });
    return true;
  };

  run.forEach((record, tick) => {
    let visible = false;
    for (const event of record.events) {
      if (event.type === "fault") {
        faults++;
        resting.delete(event.actor);
        continue;
      }
      if (event.type !== "decide") {
        // A blow starting, landing or missing, and someone going down, can all be seen.
        visible = true;
        continue;
      }
      decisions++;
      // The page shows the rule in charge, so a change of rule can be seen. The same rule firing again cannot.
      if (lastRule.get(event.actor) !== event.rule) visible = true;
      lastRule.set(event.actor, event.rule);
      // Choosing to rest, or to work a tree, a fishing spot or the fire, is a
      // reason to stand still. Any other choice has to show as movement. The
      // rest lasts until the actor next decides something.
      if (STANDING_WORK.has(event.action)) resting.add(event.actor);
      else resting.delete(event.actor);
      addAction(event.actor, tick, event.action);
    }
    // Off the map nothing is seen, but what residents there decide counts for their action mix.
    for (const event of record.elsewhere?.events ?? [])
      if (event.type === "decide") addAction(event.actor, tick, event.action);
    for (const actor of record.elsewhere?.actors ?? []) {
      names.set(actor.id, actor.name);
      extend(present, actor.id, tick);
    }
    for (const actor of record.actors) {
      names.set(actor.id, actor.name);
      extend(present, actor.id, tick);
      const spot = `${actor.x},${actor.y}`;
      // Back after ticks off the map, it is counted from here, as if it had just appeared.
      if (extend(seen, actor.id, tick)) lastSpot.delete(actor.id);
      if (lastSpot.get(actor.id) !== spot) {
        // Appearing in the world is not a move.
        if (lastSpot.has(actor.id)) visible = true;
        lastSpot.set(actor.id, spot);
        lastAlive.set(actor.id, tick);
      }
      if (resting.has(actor.id)) lastAlive.set(actor.id, tick);
      if (tick - (lastAlive.get(actor.id) ?? 0) > STUCK_LIMIT_SECONDS * TICKS_PER_SECOND)
        stuck.add(actor.id);
    }
    if (visible) {
      deadAirTicks = Math.max(deadAirTicks, tick - lastVisible);
      lastVisible = tick;
    }
  });
  deadAirTicks = Math.max(deadAirTicks, run.length - lastVisible);

  const actionMix: Record<string, ActionMix> = {};
  const window = ACTION_MIX_WINDOW_SECONDS * TICKS_PER_SECOND;
  const named = [...names.values()];
  // Monsters of a kind share a name, so in a list those are told apart by id.
  const label = (id: number): string => {
    const name = names.get(id) as string;
    return named.indexOf(name) === named.lastIndexOf(name) ? name : `${name} (${id})`;
  };
  for (const [id, name] of names) {
    const list = actions.get(id) ?? [];
    let fewest = Number.POSITIVE_INFINITY;
    for (const { first, last } of present.get(id) ?? []) {
      const end = last + 1;
      // Whole windows only, each inside one stretch the actor was in the run,
      // on the map or (a resident) off it, counted from when it appeared.
      // Someone there for the whole of a run shorter than one window is judged
      // on the run as a single window; a monster that came and went before a
      // window was up is not judged.
      const whole = first === 0 && end === run.length;
      for (let start = first; (whole && start === 0) || start + window <= end; start += window) {
        const used = new Set(
          list.filter((a) => a.tick >= start && a.tick < start + window).map((a) => a.action),
        );
        fewest = Math.min(fewest, used.size);
      }
    }
    if (fewest === Number.POSITIVE_INFINITY) continue;
    actionMix[id] = { name, actions: fewest };
  }
  const singleActionActors = Object.keys(actionMix)
    .filter((id) => (actionMix[id] as ActionMix).actions <= 1)
    .map((id) => label(Number(id)))
    .sort();
  const stuckActors = [...stuck].map(label).sort();
  const deadAirSeconds = deadAirTicks / TICKS_PER_SECOND;

  const hardFails: string[] = [];
  if (deadAirSeconds > DEAD_AIR_LIMIT_SECONDS)
    hardFails.push(`dead air: ${deadAirSeconds} s with nothing visible happening`);
  if (stuckActors.length > 0) hardFails.push(`stuck actors: ${stuckActors.join(", ")}`);
  if (singleActionActors.length > 0)
    hardFails.push(`a single action for ten minutes: ${singleActionActors.join(", ")}`);

  return {
    seconds,
    actors: names.size,
    deadAirSeconds,
    stuckActors,
    actionMix,
    singleActionActors,
    decisionsPerMinute: seconds > 0 ? Math.round((decisions / seconds) * 60 * 10) / 10 : 0,
    faults,
    hardFails,
  };
}

export interface SpotlightWait {
  /** Per actor, its longest stretch out of the spotlight, from the start of the run to its end. */
  readonly perActor: Readonly<Record<string, number>>;
  readonly longestSeconds: number;
  /** Twice the population times the minimum dwell. */
  readonly limitSeconds: number;
  readonly hardFails: readonly string[];
}

/**
 * How long each actor went without the spotlight, given who held it on each
 * tick of a run and the actors in it. One never shown waited the whole run.
 *
 * `away` gives, by actor, the stretches it was off the map (from, to, with
 * `to` not included). A wait ends when the actor leaves the map and starts
 * again when it comes back, as the director counts it. The limit uses the
 * whole cast, `names.size`, even while some of it is away.
 */
export function spotlightWait(
  subjects: readonly (number | null)[],
  names: ReadonlyMap<number, string>,
  away: ReadonlyMap<number, readonly (readonly [number, number])[]> = new Map(),
): SpotlightWait {
  const gapStart = new Map([...names.keys()].map((id) => [id, 0]));
  const longest = new Map([...names.keys()].map((id) => [id, 0]));
  const close = (id: number, tick: number) => {
    longest.set(id, Math.max(longest.get(id) as number, tick - (gapStart.get(id) as number)));
  };
  // By tick, who leaves the map then and who comes back.
  const leaves = new Map<number, number[]>();
  const returns = new Map<number, number[]>();
  const add = (at: Map<number, number[]>, tick: number, id: number) =>
    at.set(tick, [...(at.get(tick) ?? []), id]);
  for (const [id, spans] of away) {
    if (!names.has(id)) continue;
    for (const [from, to] of spans) {
      add(leaves, from, id);
      add(returns, to, id);
    }
  }
  const gone = new Set<number>();
  for (let tick = 0; tick <= subjects.length; tick++) {
    for (const id of returns.get(tick) ?? []) {
      gone.delete(id);
      gapStart.set(id, tick);
    }
    for (const id of leaves.get(tick) ?? []) {
      close(id, tick);
      gone.add(id);
    }
    if (tick === subjects.length) break;
    const subject = subjects[tick] ?? null;
    if (subject === null || !gapStart.has(subject)) continue;
    close(subject, tick);
    gapStart.set(subject, tick + 1);
  }
  for (const id of names.keys()) if (!gone.has(id)) close(id, subjects.length);

  const perActor: Record<string, number> = {};
  for (const [id, name] of names) perActor[name] = (longest.get(id) as number) / TICKS_PER_SECOND;
  const longestSeconds = Math.max(0, ...Object.values(perActor));
  const limitSeconds = (2 * names.size * DWELL_TICKS) / TICKS_PER_SECOND;
  const over = Object.keys(perActor)
    .filter((name) => (perActor[name] as number) > limitSeconds)
    .sort();
  const hardFails =
    over.length > 0 ? [`spotlight wait over ${limitSeconds} s: ${over.join(", ")}`] : [];
  return { perActor, longestSeconds, limitSeconds, hardFails };
}
