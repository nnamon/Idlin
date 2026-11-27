import { type Atlas, linked, pointOf, tileAt, walkable } from "./atlas.ts";
import { NEIGHBOURS, type Point } from "./map.ts";

/**
 * The shortest walk from `from` to `to`, as the tiles to step onto in order
 * (ending with `to`, not including `from`), through exits into other regions
 * where that is the way. Returns an empty list when already there and null
 * when there is no way. Among equally short walks the result is always the
 * same one: breadth-first search with a fixed neighbour order. Other actors are
 * not obstacles here; they are handled when a step is taken. `step` says which
 * steps may be taken; by default every step between two tiles one step joins.
 */
export function findPath(
  atlas: Atlas,
  from: Point,
  to: Point,
  step = (ax: number, ay: number, bx: number, by: number): boolean => linked(atlas, ax, ay, bx, by),
): Point[] | null {
  if (!walkable(atlas, from.x, from.y) || !walkable(atlas, to.x, to.y)) return null;
  const start = tileAt(atlas, from.x, from.y);
  const goal = tileAt(atlas, to.x, to.y);
  if (start === goal) return [];

  const cameFrom = new Map<number, number>([[start, start]]);
  const queue: Point[] = [{ x: from.x, y: from.y }];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    if (tileAt(atlas, at.x, at.y) === goal) break;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!step(at.x, at.y, x, y)) continue;
      const next = tileAt(atlas, x, y);
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, tileAt(atlas, at.x, at.y));
      queue.push({ x, y });
    }
  }
  if (!cameFrom.has(goal)) return null;

  const path: Point[] = [];
  for (let at = goal; at !== start; at = cameFrom.get(at) as number) path.push(pointOf(atlas, at));
  return path.reverse();
}
