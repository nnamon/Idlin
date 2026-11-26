// Numbers about how a run of the world would look to someone watching, worked
// out from the simulation's event log. Pure functions; durations are in seconds
// of stream time. Thresholds follow docs/watch-rubric.md.

import type { WorldEvent } from "@idlin/sim";

export const TICKS_PER_SECOND = 10;
export const DEAD_AIR_LIMIT_SECONDS = 20;
export const STUCK_LIMIT_SECONDS = 60;
const ACTION_MIX_WINDOW_SECONDS = 600;

export interface ActorSample {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
}

/** One tick of a run: the events `step` returned and where everyone stood afterwards. */
export interface TickRecord {
  readonly events: readonly WorldEvent[];
  readonly actors: readonly ActorSample[];
}

export interface WatchMetrics {
  readonly seconds: number;
  readonly actors: number;
  /** Longest stretch in which nothing visible happened: nobody changed tile and nobody's rule in charge changed. */
  readonly deadAirSeconds: number;
  /** Actors that at some point neither changed tile nor chose to rest (`wait`) for longer than the limit. */
  readonly stuckActors: readonly string[];
  /** Per actor, the fewest different actions it used in any ten-minute window. */
  readonly actionMix: Readonly<Record<string, number>>;
  /** Actors that used a single action throughout some ten-minute window. */
  readonly singleActionActors: readonly string[];
  readonly decisionsPerMinute: number;
  readonly faults: number;
  readonly hardFails: readonly string[];
}

export function watchMetrics(run: readonly TickRecord[]): WatchMetrics {
  const seconds = run.length / TICKS_PER_SECOND;
  const names = new Map<number, string>();
  const lastAlive = new Map<number, number>();
  const lastSpot = new Map<number, string>();
  const stuck = new Set<string>();
  const actions = new Map<number, { tick: number; action: string }[]>();
  const lastRule = new Map<number, number>();
  const resting = new Set<number>();
  let lastVisible = 0;
  let deadAirTicks = 0;
  let decisions = 0;
  let faults = 0;

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
      // Choosing to rest is a reason to stand still. Any other choice has to show as movement.
      // The rest lasts until the actor next decides something.
      if (event.action === "wait") resting.add(event.actor);
      else resting.delete(event.actor);
      const list = actions.get(event.actor) ?? [];
      list.push({ tick, action: event.action });
      actions.set(event.actor, list);
    }
    for (const actor of record.actors) {
      names.set(actor.id, actor.name);
      const spot = `${actor.x},${actor.y}`;
      if (lastSpot.get(actor.id) !== spot) {
        // Appearing in the world is not a move.
        if (lastSpot.has(actor.id)) visible = true;
        lastSpot.set(actor.id, spot);
        lastAlive.set(actor.id, tick);
      }
      if (resting.has(actor.id)) lastAlive.set(actor.id, tick);
      if (tick - (lastAlive.get(actor.id) ?? 0) > STUCK_LIMIT_SECONDS * TICKS_PER_SECOND)
        stuck.add(actor.name);
    }
    if (visible) {
      deadAirTicks = Math.max(deadAirTicks, tick - lastVisible);
      lastVisible = tick;
    }
  });
  deadAirTicks = Math.max(deadAirTicks, run.length - lastVisible);

  const actionMix: Record<string, number> = {};
  const window = ACTION_MIX_WINDOW_SECONDS * TICKS_PER_SECOND;
  for (const [id, name] of names) {
    const list = actions.get(id) ?? [];
    let fewest = Number.POSITIVE_INFINITY;
    // Whole windows only: a run shorter than one window is judged as a single window.
    for (let start = 0; start === 0 || start + window <= run.length; start += window) {
      const used = new Set(
        list.filter((a) => a.tick >= start && a.tick < start + window).map((a) => a.action),
      );
      fewest = Math.min(fewest, used.size);
    }
    actionMix[name] = fewest;
  }
  const singleActionActors = Object.keys(actionMix)
    .filter((name) => (actionMix[name] as number) <= 1)
    .sort();
  const stuckActors = [...stuck].sort();
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
