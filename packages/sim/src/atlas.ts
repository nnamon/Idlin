// The ground actors stand on: one tile map set down at a place in world
// coordinates, with what the simulation looks up on it worked out once. The
// city's ground is its deck in transit and a landing with the hull on it when
// it is set down (deck.ts); a world made on one fixed map stands on that map.
// Actors, paths, places and marks are all in world coordinates.

import { hashInts, stringInts } from "./hash.ts";
import {
  isWalkable,
  type MapNode,
  NEIGHBOURS,
  type Point,
  TERRAINS,
  type Terrain,
  type TileMap,
  terrainAt,
} from "./map.ts";

export interface Atlas {
  readonly name: string;
  readonly map: TileMap;
  /** World coordinates of the map's top-left tile, and its size in tiles. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** How many of its tiles can be walked on. */
  readonly walkable: number;
  /** The map's places, in world coordinates, sorted by name. */
  readonly places: readonly (Point & { readonly name: string })[];
  /** The map's resource nodes, in world coordinates, in its order. A node's index here is how the world refers to it. */
  readonly nodes: readonly MapNode[];
  /** Per tile, row by row: its terrain's index into TERRAINS. */
  readonly terrain: readonly number[];
  /** Per tile: whether it can be walked on. */
  readonly open: readonly boolean[];
  /**
   * Per tile, the floor it is on: 0 the ground, 1 the city's deck, 2 its
   * ramp. A step joins the deck and the ground only by way of the ramp.
   */
  readonly floor: Uint8Array;
}

const FLOOR: Partial<Record<Terrain, number>> = { deck: 1, hatch: 1, ramp: 2 };

/** Whether a step between tiles on these floors is allowed: anything but deck to ground. */
const floorsMeet = (a: number, b: number): boolean => a + b !== 1;

/** Whether (ax, ay) and (bx, by) are on floors a step or a push may go between. */
export function floorsJoin(atlas: Atlas, ax: number, ay: number, bx: number, by: number): boolean {
  const a = tileAt(atlas, ax, ay);
  const b = tileAt(atlas, bx, by);
  return a >= 0 && b >= 0 && floorsMeet(atlas.floor[a] as number, atlas.floor[b] as number);
}

/** The map holds at most this many tiles, so tile numbers stay small. */
export const MAX_WORLD_TILES = 65_536;

/** The tile at world (x, y), or -1 off the map. */
export function tileAt(atlas: Atlas, x: number, y: number): number {
  const cx = x - atlas.left;
  const cy = y - atlas.top;
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return -1;
  if (cx < 0 || cy < 0 || cx >= atlas.width || cy >= atlas.height) return -1;
  return cy * atlas.width + cx;
}

/** World coordinates of a tile. */
export function pointOf(atlas: Atlas, tile: number): Point {
  const cx = tile % atlas.width;
  return { x: atlas.left + cx, y: atlas.top + (tile - cx) / atlas.width };
}

export const walkable = (atlas: Atlas, x: number, y: number): boolean => {
  const tile = tileAt(atlas, x, y);
  return tile >= 0 && atlas.open[tile] === true;
};

/** The terrain at (x, y), or undefined off the map. */
export function terrainOf(atlas: Atlas, x: number, y: number): Terrain | undefined {
  const tile = tileAt(atlas, x, y);
  return tile < 0 ? undefined : TERRAINS[atlas.terrain[tile] as number];
}

/**
 * Whether one step takes an actor from (ax, ay) to (bx, by): the two are side
 * by side, both can be walked on, and the step is not off the deck's edge.
 */
export function linked(atlas: Atlas, ax: number, ay: number, bx: number, by: number): boolean {
  const a = tileAt(atlas, ax, ay);
  const b = tileAt(atlas, bx, by);
  if (a < 0 || b < 0 || !atlas.open[a] || !atlas.open[b]) return false;
  if (!floorsMeet(atlas.floor[a] as number, atlas.floor[b] as number)) return false;
  return Math.abs(bx - ax) + Math.abs(by - ay) === 1;
}

/**
 * The tile one step from tile `tile` in direction `d` (an index into
 * NEIGHBOURS), if `linked` joins the two, else -1. The same answer as
 * `linked`, by tile number, for searches that take many steps.
 */
export function stepTile(atlas: Atlas, tile: number, d: number): number {
  const { width, open } = atlas;
  const cx = tile % width;
  let next: number;
  if (d === 0) next = tile - width;
  else if (d === 1) next = cx === width - 1 ? -1 : tile + 1;
  else if (d === 2) next = tile + width;
  else next = cx === 0 ? -1 : tile - 1;
  if (next < 0 || next >= open.length || !open[tile] || !open[next]) return -1;
  return floorsMeet(atlas.floor[tile] as number, atlas.floor[next] as number) ? next : -1;
}

const wrapped = new WeakMap<TileMap, Atlas>();

/** The map itself at world (0, 0); an atlas is returned as it is. */
export function atlasOf(ground: TileMap | Atlas): Atlas {
  if ("map" in ground && "open" in ground) return ground;
  const map = ground as TileMap;
  let atlas = wrapped.get(map);
  if (!atlas) {
    atlas = groundAt(map, 0, 0);
    wrapped.set(map, atlas);
  }
  return atlas;
}

/** `map` set down with its top-left tile at world (x, y). Throws a RangeError for a map over MAX_WORLD_TILES. */
export function groundAt(map: TileMap, x: number, y: number): Atlas {
  const size = map.width * map.height;
  if (size > MAX_WORLD_TILES)
    throw new RangeError(`map "${map.name}" has ${size} tiles, more than ${MAX_WORLD_TILES}`);
  const terrain = new Array<number>(size);
  const open = new Array<boolean>(size);
  const floor = new Uint8Array(size);
  let count = 0;
  for (let ly = 0; ly < map.height; ly++) {
    for (let lx = 0; lx < map.width; lx++) {
      const tile = ly * map.width + lx;
      terrain[tile] = TERRAINS.indexOf(terrainAt(map, lx, ly));
      open[tile] = isWalkable(map, lx, ly);
      floor[tile] = FLOOR[terrainAt(map, lx, ly)] ?? 0;
      if (open[tile]) count++;
    }
  }
  return {
    name: map.name,
    map,
    left: x,
    top: y,
    width: map.width,
    height: map.height,
    walkable: count,
    places: map.places
      .map((p) => ({ name: p.name, x: x + p.x, y: y + p.y }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    nodes: (map.nodes ?? []).map((node) => ({ kind: node.kind, x: x + node.x, y: y + node.y })),
    terrain,
    open,
    floor,
  };
}

/**
 * Whether every walkable tile of the ground can be reached from (x, y), so
 * that nobody can be stranded on it.
 */
export function joined(atlas: Atlas, from: Point): boolean {
  const start = tileAt(atlas, from.x, from.y);
  if (start < 0 || !atlas.open[start]) return false;
  const seen = new Uint8Array(atlas.open.length);
  seen[start] = 1;
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as number;
    for (let d = 0; d < NEIGHBOURS.length; d++) {
      const next = stepTile(atlas, at, d);
      if (next < 0 || seen[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return queue.length === atlas.walkable;
}

/** A fingerprint of the ground: its map and where it lies. */
export function hashAtlas(atlas: Atlas): string {
  return hashInts([
    ...stringInts(atlas.name),
    ...stringInts(hashMap(atlas.map)),
    atlas.left,
    atlas.top,
  ]);
}

/** A fingerprint of one map. A map with no nodes hashes as maps did before there were any. */
export function hashMap(map: TileMap): string {
  const nodes = map.nodes ?? [];
  return hashInts([
    ...stringInts(map.name),
    map.width,
    map.height,
    ...map.tiles,
    ...map.places.flatMap((p) => [...stringInts(p.name), p.x, p.y]),
    ...(nodes.length === 0 ? [] : [nodes.length, ...nodes.flatMap((n) => [n.kind, n.x, n.y])]),
    // A map with no element hashes as maps did before they had one. A count of
    // nodes is never below 1, so -1 cannot be read as one.
    ...(map.element === undefined || map.element === "none"
      ? []
      : [-1, ["fire", "cold", "lightning"].indexOf(map.element)]),
  ]);
}
