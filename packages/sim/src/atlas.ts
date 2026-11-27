// The world's ground: one or more regions, each a tile map set down at its own
// place in world coordinates, and the exits that join them. Built once from
// content, validated, then read-only. Actors, paths, places and marks are all in
// world coordinates; the region an actor is in is the one its tile belongs to.

import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import {
  isWalkable,
  MapError,
  type MapNode,
  NEIGHBOURS,
  type Point,
  parseMap,
  TERRAINS,
  type Terrain,
  type TileMap,
  terrainAt,
} from "./map.ts";

export interface Region {
  readonly map: TileMap;
  /** World coordinates of the map's top-left tile. */
  readonly x: number;
  readonly y: number;
  /** How many of its tiles can be walked on. */
  readonly walkable: number;
}

/** Two side-by-side tiles in different regions, in world coordinates. Stepping between them crosses. */
export type Exit = readonly [Point, Point];

export interface Atlas {
  readonly name: string;
  /** In content order. A region's index here is how the world refers to it. */
  readonly regions: readonly Region[];
  readonly exits: readonly Exit[];
  /** Every region's places, in world coordinates, sorted by name. Names are unique across regions. */
  readonly places: readonly (Point & { readonly name: string })[];
  /**
   * Every region's resource nodes, in world coordinates: the regions in order,
   * and each region's in its file's order. A node's index here is how the world
   * refers to it.
   */
  readonly nodes: readonly MapNode[];
  /** The box round every region: its top-left in world coordinates, and its size in tiles. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Per tile of the box, row by row: the index of its region, or -1 outside every region. */
  readonly regionOf: readonly number[];
  /** Per tile of the box: its terrain's index into TERRAINS, or -1 outside every region. */
  readonly terrain: readonly number[];
  /** Per tile of the box: whether it can be walked on. */
  readonly open: readonly boolean[];
  /** Per tile of the box: one bit per direction, in NEIGHBOURS order, in which an exit leads out of it. */
  readonly exitBits: readonly number[];
}

export const MAX_REGIONS = 16;
export const MAX_EXITS = 64;
/** The box round all regions holds at most this many tiles, so tile numbers stay small. */
export const MAX_WORLD_TILES = 65_536;

/** The box tile at world (x, y), or -1 if no region has a tile there. */
export function tileAt(atlas: Atlas, x: number, y: number): number {
  const cx = x - atlas.left;
  const cy = y - atlas.top;
  if (!Number.isInteger(cx) || !Number.isInteger(cy)) return -1;
  if (cx < 0 || cy < 0 || cx >= atlas.width || cy >= atlas.height) return -1;
  const tile = cy * atlas.width + cx;
  return (atlas.regionOf[tile] as number) < 0 ? -1 : tile;
}

/** World coordinates of a box tile. */
export function pointOf(atlas: Atlas, tile: number): Point {
  const cx = tile % atlas.width;
  return { x: atlas.left + cx, y: atlas.top + (tile - cx) / atlas.width };
}

/** The index of the region (x, y) is in, or -1 if it is in none. */
export function regionAt(atlas: Atlas, x: number, y: number): number {
  const tile = tileAt(atlas, x, y);
  return tile < 0 ? -1 : (atlas.regionOf[tile] as number);
}

export const walkable = (atlas: Atlas, x: number, y: number): boolean => {
  const tile = tileAt(atlas, x, y);
  return tile >= 0 && atlas.open[tile] === true;
};

/** The terrain at (x, y), or undefined outside every region. */
export function terrainOf(atlas: Atlas, x: number, y: number): Terrain | undefined {
  const tile = tileAt(atlas, x, y);
  return tile < 0 ? undefined : TERRAINS[atlas.terrain[tile] as number];
}

/**
 * Whether one step takes an actor from (ax, ay) to (bx, by): the two are side
 * by side, both can be walked on, and they are in the same region or an exit
 * joins them.
 */
export function linked(atlas: Atlas, ax: number, ay: number, bx: number, by: number): boolean {
  const a = tileAt(atlas, ax, ay);
  const b = tileAt(atlas, bx, by);
  if (a < 0 || b < 0 || !atlas.open[a] || !atlas.open[b]) return false;
  const dx = bx - ax;
  const dy = by - ay;
  const direction = NEIGHBOURS.findIndex(([nx, ny]) => nx === dx && ny === dy);
  if (direction < 0) return false;
  return (
    atlas.regionOf[a] === atlas.regionOf[b] ||
    ((atlas.exitBits[a] as number) & (1 << direction)) !== 0
  );
}

/**
 * The box tile one step from box tile `tile` in direction `d` (an index into
 * NEIGHBOURS), if `linked` joins the two, else -1. With `within`, only a step
 * that stays in the region counts. The same answer as `linked`, by tile
 * number, for searches that take many steps.
 */
export function stepTile(atlas: Atlas, tile: number, d: number, within: boolean): number {
  const { width, open, regionOf } = atlas;
  const cx = tile % width;
  let next: number;
  if (d === 0) next = tile - width;
  else if (d === 1) next = cx === width - 1 ? -1 : tile + 1;
  else if (d === 2) next = tile + width;
  else next = cx === 0 ? -1 : tile - 1;
  if (next < 0 || next >= open.length || !open[tile] || !open[next]) return -1;
  if (regionOf[tile] === regionOf[next]) return next;
  return !within && ((atlas.exitBits[tile] as number) & (1 << d)) !== 0 ? next : -1;
}

const wrapped = new WeakMap<TileMap, Atlas>();

/** A world of one region, the map itself at world (0, 0) with no exits; an atlas is returned as it is. */
export function atlasOf(ground: TileMap | Atlas): Atlas {
  if ("regions" in ground) return ground;
  let atlas = wrapped.get(ground);
  if (!atlas) {
    atlas = buildAtlas(ground.name, [{ map: ground, x: 0, y: 0 }], []);
    wrapped.set(ground, atlas);
  }
  return atlas;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads `[x, y]` as a point, or null. */
const pointFrom = (raw: unknown): Point | null =>
  Array.isArray(raw) && raw.length === 2 && isInt32(raw[0]) && isInt32(raw[1])
    ? { x: raw[0], y: raw[1] }
    : null;

/**
 * Builds the world from content/world.json, parsed, and the parsed map files
 * it names, by file name without the extension. Throws a MapError that says
 * what is wrong: a region file that is missing or bad, regions that overlap, a
 * place name used twice, a bad exit, no camp, or ground cut off from camp.
 */
export function parseWorld(raw: unknown, maps: Readonly<Record<string, unknown>>): Atlas {
  if (!isRecord(raw)) throw new MapError("the world must be an object");
  const { name, regions, exits } = raw;
  if (typeof name !== "string" || name === "") throw new MapError("the world needs a name");
  if (!Array.isArray(regions) || regions.length < 1 || regions.length > MAX_REGIONS)
    throw new MapError(`the world needs from 1 to ${MAX_REGIONS} regions`);
  const placed = regions.map((region: unknown, i) => {
    if (!isRecord(region)) throw new MapError(`region ${i} must be an object`);
    const { map, x, y } = region;
    if (typeof map !== "string" || !Object.hasOwn(maps, map))
      throw new MapError(`region ${i}: there is no map file called ${show(map).slice(0, 40)}`);
    if (!isInt32(x) || !isInt32(y)) throw new MapError(`region ${i}: needs whole-number x and y`);
    const parsed = parseMap(maps[map]);
    if (parsed.name !== map)
      throw new MapError(`map file "${map}" must have the name "${map}", not "${parsed.name}"`);
    return { map: parsed, x, y };
  });
  if (!Array.isArray(exits) || exits.length > MAX_EXITS)
    throw new MapError(`exits must be a list of at most ${MAX_EXITS}`);
  const joins = exits.map((exit: unknown, i): Exit => {
    const pair = Array.isArray(exit) && exit.length === 2 ? exit.map(pointFrom) : [];
    const [a, b] = pair;
    if (!a || !b) throw new MapError(`exit ${i} must be two tiles, each [x, y]`);
    return [a, b];
  });
  return buildAtlas(name, placed, joins);
}

function buildAtlas(
  name: string,
  placed: readonly { readonly map: TileMap; readonly x: number; readonly y: number }[],
  exits: readonly Exit[],
): Atlas {
  const fail = (message: string): never => {
    throw new MapError(`world "${name}": ${message}`);
  };
  const names = new Set<string>();
  for (const { map } of placed) {
    if (names.has(map.name)) fail(`the map "${map.name}" is used for two regions`);
    names.add(map.name);
  }
  const left = Math.min(...placed.map((r) => r.x));
  const top = Math.min(...placed.map((r) => r.y));
  const width = Math.max(...placed.map((r) => r.x + r.map.width)) - left;
  const height = Math.max(...placed.map((r) => r.y + r.map.height)) - top;
  if (width * height > MAX_WORLD_TILES)
    fail(`the regions are spread over ${width}x${height} tiles, more than ${MAX_WORLD_TILES}`);

  const size = width * height;
  const regionOf = new Array<number>(size).fill(-1);
  const terrain = new Array<number>(size).fill(-1);
  const open = new Array<boolean>(size).fill(false);
  const counts: number[] = [];
  placed.forEach(({ map, x, y }, r) => {
    let count = 0;
    for (let ly = 0; ly < map.height; ly++) {
      for (let lx = 0; lx < map.width; lx++) {
        const tile = (y + ly - top) * width + (x + lx - left);
        const other = regionOf[tile] as number;
        if (other >= 0) fail(`the regions "${placed[other]?.map.name}" and "${map.name}" overlap`);
        regionOf[tile] = r;
        terrain[tile] = TERRAINS.indexOf(terrainAt(map, lx, ly));
        open[tile] = isWalkable(map, lx, ly);
        if (open[tile]) count++;
      }
    }
    counts.push(count);
  });

  const places: (Point & { name: string })[] = [];
  const placeOwner = new Map<string, string>();
  for (const { map, x, y } of placed) {
    for (const p of map.places) {
      const owner = placeOwner.get(p.name);
      if (owner !== undefined)
        fail(`the place "${p.name}" is in both "${owner}" and "${map.name}"`);
      placeOwner.set(p.name, map.name);
      places.push({ name: p.name, x: x + p.x, y: y + p.y });
    }
  }
  places.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const exitBits = new Array<number>(size).fill(0);
  const atlas: Atlas = {
    name,
    regions: placed.map(({ map, x, y }, r) => ({ map, x, y, walkable: counts[r] as number })),
    exits,
    places,
    nodes: placed.flatMap(({ map, x, y }) =>
      (map.nodes ?? []).map((node) => ({ kind: node.kind, x: x + node.x, y: y + node.y })),
    ),
    left,
    top,
    width,
    height,
    regionOf,
    terrain,
    open,
    exitBits,
  };
  exits.forEach(([a, b], i) => {
    const ta = tileAt(atlas, a.x, a.y);
    const tb = tileAt(atlas, b.x, b.y);
    const direction = NEIGHBOURS.findIndex(([dx, dy]) => a.x + dx === b.x && a.y + dy === b.y);
    if (ta < 0 || tb < 0 || !open[ta] || !open[tb])
      fail(`exit ${i}: both of its tiles must be ground that can be walked on`);
    if (direction < 0) fail(`exit ${i}: its two tiles must be side by side`);
    if (regionOf[ta] === regionOf[tb]) fail(`exit ${i}: its two tiles are in the same region`);
    exitBits[ta] = (exitBits[ta] as number) | (1 << direction);
    exitBits[tb] = (exitBits[tb] as number) | (1 << ((direction + 2) % 4));
  });

  const camp = places.find((p) => p.name === "camp");
  if (!camp) return fail('a place called "camp" is required');
  // Every walkable tile must be reachable from camp, or an actor could be stranded.
  const start = tileAt(atlas, camp.x, camp.y);
  const seen = new Set<number>([start]);
  const queue: Point[] = [camp];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!linked(atlas, at.x, at.y, x, y)) continue;
      const tile = tileAt(atlas, x, y);
      if (seen.has(tile)) continue;
      seen.add(tile);
      queue.push({ x, y });
    }
  }
  for (let tile = 0; tile < size; tile++) {
    if (!open[tile] || seen.has(tile)) continue;
    const region = placed[regionOf[tile] as number] as (typeof placed)[number];
    const { x, y } = pointOf(atlas, tile);
    fail(
      `walkable tile (${x - region.x}, ${y - region.y}) of "${region.map.name}" cannot be reached from camp`,
    );
  }
  return atlas;
}

/** A fingerprint of the world's ground: each region's map and where it lies, and the exits. */
export function hashAtlas(atlas: Atlas): string {
  return hashInts([
    ...stringInts(atlas.name),
    atlas.regions.length,
    ...atlas.regions.flatMap((r) => [...stringInts(hashMap(r.map)), r.x, r.y]),
    atlas.exits.length,
    ...atlas.exits.flatMap(([a, b]) => [a.x, a.y, b.x, b.y]),
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
  ]);
}
