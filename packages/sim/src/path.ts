import { isWalkable, NEIGHBOURS, type Point, type TileMap, tileIndex } from "./map.ts";

/**
 * The shortest walk from `from` to `to` over walkable tiles, as the tiles to
 * step onto in order (ending with `to`, not including `from`). Returns an empty
 * list when already there and null when there is no way. Among equally short
 * walks the result is always the same one: breadth-first search with a fixed
 * neighbour order. Other actors are not obstacles here; they are handled when
 * a step is taken.
 */
export function findPath(map: TileMap, from: Point, to: Point): Point[] | null {
  if (!isWalkable(map, from.x, from.y) || !isWalkable(map, to.x, to.y)) return null;
  const start = tileIndex(map, from.x, from.y);
  const goal = tileIndex(map, to.x, to.y);
  if (start === goal) return [];

  const cameFrom = new Map<number, number>([[start, start]]);
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    if (current === goal) break;
    const cx = current % map.width;
    const cy = (current - cx) / map.width;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = cx + dx;
      const y = cy + dy;
      if (!isWalkable(map, x, y)) continue;
      const next = tileIndex(map, x, y);
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      queue.push(next);
    }
  }
  if (!cameFrom.has(goal)) return null;

  const path: Point[] = [];
  for (let at = goal; at !== start; at = cameFrom.get(at) as number) {
    const x = at % map.width;
    path.push({ x, y: (at - x) / map.width });
  }
  return path.reverse();
}
