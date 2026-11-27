import { type Atlas, pointOf, stepTile, tileAt, walkable } from "./atlas.ts";
import type { Point } from "./map.ts";

/**
 * Arrays the size of an atlas's box for a search over its tiles, kept between
 * searches so that each does not have to make and clear its own. An entry
 * counts only where its tile's stamp is the stamp of the search running now.
 * One search runs at a time, and none starts another.
 */
export interface Scratch {
  readonly stamp: number;
  /** Per tile: the stamp of the search that reached it, and the tile it was reached from. */
  readonly reached: Uint32Array;
  readonly from: Int32Array;
  /** The search's queue of tiles. */
  readonly queue: Int32Array;
  /** Per tile: the stamp of a second search's visit. */
  readonly seen: Uint32Array;
}

const scratches = new WeakMap<Atlas, { stamp: number } & Omit<Scratch, "stamp">>();

/** The scratch arrays for `atlas`, with a new stamp: nothing is marked in them yet. */
export function scratchFor(atlas: Atlas): Scratch {
  const size = atlas.open.length;
  let scratch = scratches.get(atlas);
  if (!scratch) {
    scratch = {
      stamp: 0,
      reached: new Uint32Array(size),
      from: new Int32Array(size),
      queue: new Int32Array(size),
      seen: new Uint32Array(size),
    };
    scratches.set(atlas, scratch);
  }
  if (scratch.stamp === 0xffffffff) {
    scratch.reached.fill(0);
    scratch.seen.fill(0);
    scratch.stamp = 0;
  }
  scratch.stamp++;
  return scratch;
}

/**
 * The shortest walk from `from` to `to`, as the tiles to step onto in order
 * (ending with `to`, not including `from`), through exits into other regions
 * where that is the way. Returns an empty list when already there and null
 * when there is no way. Among equally short walks the result is always the
 * same one: breadth-first search with a fixed neighbour order. Other actors are
 * not obstacles here; they are handled when a step is taken. With `within`,
 * the walk keeps to the region it starts in, as monsters do.
 */
export function findPath(atlas: Atlas, from: Point, to: Point, within = false): Point[] | null {
  if (!walkable(atlas, from.x, from.y) || !walkable(atlas, to.x, to.y)) return null;
  const start = tileAt(atlas, from.x, from.y);
  const goal = tileAt(atlas, to.x, to.y);
  if (start === goal) return [];

  const { stamp, reached, from: cameFrom, queue } = scratchFor(atlas);
  reached[start] = stamp;
  queue[0] = start;
  for (let head = 0, tail = 1; head < tail; head++) {
    const at = queue[head] as number;
    if (at === goal) break;
    for (let d = 0; d < 4; d++) {
      const next = stepTile(atlas, at, d, within);
      if (next < 0 || reached[next] === stamp) continue;
      reached[next] = stamp;
      cameFrom[next] = at;
      queue[tail++] = next;
    }
  }
  if (reached[goal] !== stamp) return null;

  const path: Point[] = [];
  for (let at = goal; at !== start; at = cameFrom[at] as number) path.push(pointOf(atlas, at));
  return path.reverse();
}
