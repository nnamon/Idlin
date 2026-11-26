// Stand-in behaviour until actors run programs: pause, pick a random walkable
// tile, walk there. Removed when the Tactics compiler lands.

import { isWalkable, type Point } from "./map.ts";
import { findPath } from "./path.ts";
import { nextInt } from "./rng.ts";
import type { Actor, World } from "./world.ts";

const MIN_PAUSE_TICKS = 10;
const PAUSE_SPREAD_TICKS = 40;

/** A walkable tile chosen at random with the world's generator. */
export function randomWalkableTile(world: World): Point {
  const { map } = world;
  const walkable: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) walkable.push({ x, y });
  }
  return walkable[nextInt(world.rng, walkable.length)] as Point;
}

export function wander(world: World, actor: Actor): void {
  if (actor.wait > 0) {
    actor.wait--;
    return;
  }
  actor.path = findPath(world.map, actor, randomWalkableTile(world)) ?? [];
  actor.wait = MIN_PAUSE_TICKS + nextInt(world.rng, PAUSE_SPREAD_TICKS);
}
