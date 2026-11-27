// Runs the world without a page, the same world the viewer shows for a seed
// and a cast, and records every tick for the metrics: who is on the map the
// viewer draws (the window that follows the spotlight, see camera.ts), in
// world tile coordinates, and what they did. Someone outside the window is
// not recorded on the map, nor is anything done there, except what residents
// decide, for the action mix.

import {
  ADVENTURER,
  compileBots,
  createWorld,
  type Monsters,
  placeConstants,
  spawnsNearCamp,
  step,
  type World,
  type WorldEvent,
} from "@idlin/sim";
import { nextWatch, startWatch, viewAt } from "../../../packages/client/src/camera.ts";
import { castOf } from "../../../packages/client/src/cast.ts";
import { campRegion, inWindow, viewSize, windowView } from "../../../packages/client/src/view.ts";
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
 * Follows the map the viewer shows, tick by tick, as the viewer works it out
 * (see camera.ts): the window where the view is at each tick. Each call gives
 * that map and, of `events` (what the last step did), those it shows: the
 * ones by an actor that was on it before or after the step, so one who went
 * down there counts, for a hit, the ones on someone there, and for a node
 * (a tree or a fishing spot), the ones whose tile is in the window. It also gives
 * the watch: the spotlit resident and the camera.
 */
function follower(atlas: World["atlas"]) {
  let watch = startWatch(atlas);
  const size = viewSize(atlas, campRegion({ atlas }));
  let before = new Set<number>();
  return (world: World, events: readonly WorldEvent[]) => {
    watch = nextWatch(watch, world);
    const at = viewAt(watch.camera, atlas, world.tick);
    const window = { ...at, ...size };
    const view = windowView(world, window);
    const here = new Set(view.actors.map((a) => a.id));
    const was = before;
    const on = (id: number): boolean => here.has(id) || was.has(id);
    before = here;
    return {
      view,
      at,
      events: events.filter((event) =>
        // A node's events have no actor; they belong to the window when the node's tile is in it.
        "actor" in event
          ? on(event.actor) || (event.type === "hit" && on(event.target))
          : inWindow(window, event.x, event.y),
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
  const shown = follower(world.atlas);
  const run: TickRecord[] = [];
  let last = events;
  for (let tick = 0; tick < ticks; tick++) {
    const { view, events: seen, at } = shown(world, last);
    const here = new Set(view.actors.map((a) => a.id));
    const away = world.actors.filter((a) => a.kind === ADVENTURER && !here.has(a.id));
    const residents = new Set(world.actors.filter((a) => a.kind === ADVENTURER).map((a) => a.id));
    const shownEvents = new Set(seen);
    run.push({
      events: seen,
      view: at,
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
 * Runs the same world as `play` with the spotlight director watching it as
 * the viewer's does (see camera.ts): every resident, wherever it is, from
 * what the worlds show. Returns who held the spotlight on each tick and the
 * residents' names. Keeps nothing else, so it can run for hours of stream
 * time with a crowd.
 */
export function spotlightRun(
  seed: number,
  residents: number,
  ticks: number,
): {
  subjects: (number | null)[];
  names: Map<number, string>;
} {
  const { world } = start(seed, castOf(residents));
  let watch = startWatch(world.atlas);
  const subjects: (number | null)[] = [];
  const cast = world.actors.filter((a) => a.kind === ADVENTURER);
  const names = new Map(cast.map((a) => [a.id, a.name]));
  for (let tick = 0; tick < ticks; tick++) {
    watch = nextWatch(watch, world);
    subjects.push(watch.subject);
    step(world);
  }
  return { subjects, names };
}

/**
 * The drifts in a run: for each, the record at which the view set out, and
 * the one at which it got there (see `TickRecord.view`).
 */
export function drifts(run: readonly TickRecord[]): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  let from = -1;
  run.forEach((record, i) => {
    const before = run[i - 1]?.view;
    const now = record.view;
    const next = run[i + 1]?.view;
    if (!before || !now) return;
    const moving = (a: typeof now, b: typeof now | undefined) =>
      b !== undefined && (a.x !== b.x || a.y !== b.y);
    if (from < 0 && moving(before, now)) from = i - 1;
    if (from >= 0 && !moving(now, next)) {
      found.push({ from, to: i });
      from = -1;
    }
  });
  return found;
}
