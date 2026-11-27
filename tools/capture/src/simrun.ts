// Runs the world without a page, the same world the viewer shows for a seed
// and a cast, and records every tick for the metrics: who is on the map the
// viewer draws (the camp's region), in that map's tile coordinates, and what
// they did. Someone in another region is not recorded on the map while away,
// nor is anything done there, except what residents decide, for the action mix.

import {
  ADVENTURER,
  compileBots,
  createWorld,
  type Monsters,
  placeConstants,
  regionAt,
  spawnsNearCamp,
  step,
  type World,
  type WorldEvent,
} from "@idlin/sim";
import { castOf } from "../../../packages/client/src/cast.ts";
import { createDirector, direct } from "../../../packages/client/src/director.ts";
import { campRegion, regionView } from "../../../packages/client/src/view.ts";
import { botSources, shippedWorld } from "../../../packages/sim/src/testing.ts";
import type { TickRecord } from "./metrics.ts";

/**
 * The shipped world with `cast` just spawned at camp, and the events of that
 * tick. `sources` replaces the shipped programs and `monsters` lets monsters in.
 */
export function start(
  seed: number,
  cast: readonly { name: string; program: string }[],
  sources: Readonly<Record<string, string>> = botSources(),
  monsters?: Monsters,
): { world: World; events: WorldEvent[] } {
  const atlas = shippedWorld();
  const world = createWorld(
    atlas,
    seed,
    { ...compileBots(sources, placeConstants(atlas)), ...monsters?.programs },
    monsters?.kinds,
    monsters?.spawns,
  );
  const events = step(world, spawnsNearCamp(world, cast));
  return { world, events };
}

/**
 * Follows the map the viewer shows, tick by tick. Each call gives that map and,
 * of `events` (what the last step did), those it shows: the ones by an actor
 * that was on it before or after the step, so one who went down there counts,
 * and for a hit, the ones on someone there.
 */
function follower(region: number) {
  let before = new Set<number>();
  return (world: World, events: readonly WorldEvent[]) => {
    const view = regionView(world, region);
    const here = new Set(view.actors.map((a) => a.id));
    const was = before;
    const on = (id: number): boolean => here.has(id) || was.has(id);
    before = here;
    return {
      view,
      events: events.filter((event) =>
        // A node's events have no actor; they belong to the region the node is in.
        "actor" in event
          ? on(event.actor) || (event.type === "hit" && on(event.target))
          : regionAt(world.atlas, event.x, event.y) === region,
      ),
    };
  };
}

/**
 * Steps `world` on for `ticks` ticks from a step that returned `events`, and
 * records the map the viewer shows. Each record also notes, under
 * `elsewhere`, the residents off the map and what they decided, which only
 * the action mix reads. Record `i` is the world after `i` more steps.
 * `after`, if given, sees the whole world and its events after each step.
 */
export function follow(
  world: World,
  events: WorldEvent[],
  ticks: number,
  after?: (world: World, events: readonly WorldEvent[]) => void,
): TickRecord[] {
  const shown = follower(campRegion(world));
  const run: TickRecord[] = [];
  let last = events;
  for (let tick = 0; tick < ticks; tick++) {
    const { view, events: seen } = shown(world, last);
    const here = new Set(view.actors.map((a) => a.id));
    const away = world.actors.filter((a) => a.kind === ADVENTURER && !here.has(a.id));
    const residents = new Set(world.actors.filter((a) => a.kind === ADVENTURER).map((a) => a.id));
    const shownEvents = new Set(seen);
    run.push({
      events: seen,
      actors: view.actors.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y })),
      elsewhere: {
        actors: away.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y })),
        // What the map does not show, so nothing is counted twice.
        events: last.filter(
          (event) =>
            event.type === "decide" && residents.has(event.actor) && !shownEvents.has(event),
        ),
      },
    });
    last = step(world);
    after?.(world, last);
  }
  return run;
}

/** Record `i` is the world at tick `i + 1`: the viewer's world after `i` ticks past its start. */
export function play(seed: number, residents: number, ticks: number): TickRecord[] {
  const { world, events } = start(seed, castOf(residents));
  return follow(world, events, ticks);
}

/**
 * The start of the busiest stretch of `window` ticks: the one in which the
 * most actors changed tile. The earliest such stretch if several tie.
 */
export function busiest(run: readonly TickRecord[], window: number): number {
  if (!(window >= 1)) throw new RangeError("the window must be at least one tick");
  const moves = run.map((record, i) => {
    const before = run[i - 1];
    if (!before) return 0;
    const was = new Map(before.actors.map((a) => [a.id, a]));
    return record.actors.filter((a) => {
      const old = was.get(a.id);
      return old !== undefined && (old.x !== a.x || old.y !== a.y);
    }).length;
  });
  let sum = 0;
  let best = { start: 0, sum: -1 };
  for (let i = 0; i < moves.length; i++) {
    sum += moves[i] as number;
    if (i >= window) sum -= moves[i - window] as number;
    const start = i - window + 1;
    if (start >= 0 && sum > best.sum) best = { start, sum };
  }
  return best.start;
}

/**
 * Runs the same world as `play` with the spotlight director watching the same
 * map: residents on it, and the events it shows. Returns who held the
 * spotlight on each tick, the residents' names, and the stretches of ticks
 * each resident was away from the map (from, to: `to` not included). Keeps
 * nothing else, so it can run for hours of stream time with a crowd.
 */
export function spotlightRun(
  seed: number,
  residents: number,
  ticks: number,
): {
  subjects: (number | null)[];
  names: Map<number, string>;
  away: Map<number, [number, number][]>;
} {
  const begun = start(seed, castOf(residents));
  const world = begun.world;
  let events = begun.events;
  const shown = follower(campRegion(world));
  const director = createDirector();
  const subjects: (number | null)[] = [];
  const cast = world.actors.filter((a) => a.kind === ADVENTURER);
  const names = new Map(cast.map((a) => [a.id, a.name]));
  const away = new Map<number, [number, number][]>(cast.map((a) => [a.id, []]));
  for (let tick = 0; tick < ticks; tick++) {
    const { view, events: seen } = shown(world, events);
    const present = view.actors.filter((a) => a.kind === ADVENTURER).map((a) => a.id);
    const here = new Set(present);
    for (const [id, spans] of away) {
      if (here.has(id)) continue;
      const last = spans[spans.length - 1];
      if (last && last[1] === tick) last[1] = tick + 1;
      else spans.push([tick, tick + 1]);
    }
    subjects.push(direct(director, world.tick, seen, present));
    events = step(world);
  }
  return { subjects, names, away };
}
