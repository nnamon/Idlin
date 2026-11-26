// Runs the world without a page, the same world the viewer shows for a seed
// and a cast, and records every tick for the metrics.

import {
  ADVENTURER,
  compileBots,
  createWorld,
  parseMap,
  placeConstants,
  spawnsNearCamp,
  step,
} from "@idlin/sim";
import { castOf } from "../../../packages/client/src/cast.ts";
import { createDirector, direct } from "../../../packages/client/src/director.ts";
import { botSources, rawFirstLight } from "../../../packages/sim/src/testing.ts";
import type { TickRecord } from "./metrics.ts";

/** Record `i` is the world at tick `i + 1`: the viewer's world after `i` ticks past its start. */
export function play(seed: number, residents: number, ticks: number): TickRecord[] {
  const map = parseMap(rawFirstLight());
  const world = createWorld(map, seed, compileBots(botSources(), placeConstants(map)));
  const run: TickRecord[] = [];
  let events = step(world, spawnsNearCamp(world, castOf(residents)));
  for (let tick = 0; tick < ticks; tick++) {
    run.push({
      events,
      actors: world.actors.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y })),
    });
    events = step(world);
  }
  return run;
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
 * Runs the same world as `play` with the spotlight director watching, and
 * returns who held the spotlight on each tick and the residents' names. Keeps
 * nothing else, so it can run for hours of stream time with a crowd.
 */
export function spotlightRun(
  seed: number,
  residents: number,
  ticks: number,
): { subjects: (number | null)[]; names: Map<number, string> } {
  const map = parseMap(rawFirstLight());
  const world = createWorld(map, seed, compileBots(botSources(), placeConstants(map)));
  const director = createDirector();
  const subjects: (number | null)[] = [];
  let events = step(world, spawnsNearCamp(world, castOf(residents)));
  const cast = world.actors.filter((a) => a.kind === ADVENTURER);
  const names = new Map(cast.map((a) => [a.id, a.name]));
  for (let tick = 0; tick < ticks; tick++) {
    const present = world.actors.filter((a) => a.kind === ADVENTURER).map((a) => a.id);
    subjects.push(direct(director, world.tick, events, present));
    events = step(world);
  }
  return { subjects, names };
}
