// Landings: the ground the walking city parks on (#361, #364), generated from a
// seed, a size, a biome and a level, to docs/slice.md, section 1. Integer maths
// and the seeded generator only, so the same input gives the same landing
// anywhere. It is not part of a world yet: nothing here is read by world.ts.
//
// How a landing is made
//
// The layout is a graph first and ground second. Nothing is placed by trying
// a spot and checking it, and nothing is repaired afterwards.
//
// 1. Blocks. Jittered lines cut the map into blocks of four tiles or more a
//    side. The blocks under the city's apron are the city's district, which
//    holds the ramp and is the graph's root.
// 2. Districts. The other blocks are counted outward from the city into
//    bands. Each band gets a seed block for every few of its blocks, each
//    seed the block farthest from the seeds before it, and so does any piece
//    of the map the city cuts off from the rest. Then the districts take
//    turns to add a free block beside one they have, keeping to their band
//    where they can. A district is a connected, irregular group of blocks,
//    and every block ends up in one.
// 3. Passages. Districts with blocks side by side are neighbours. A spanning
//    tree is grown outward from the city over the neighbours (Prim's
//    algorithm, nearer bands first, seeded weights). Where the biome has a
//    river, one branch of the tree is its far bank. Of the neighbours left
//    over, the ones that close the longest detours become loop passages: a
//    set share of the districts, of which only one or two may cross the river.
// 4. Skeleton. Each passage gets a gate on a block side its two districts
//    share: tiles two deep and one to three wide, with a wall tile (a jamb)
//    at each end. Each district gets lanes, which are 4-connected lines: from
//    its centre (the hub of its seed block) from block to block, to its side
//    of every gate, to each den, cache and seam it holds, and to the map's
//    edge where the horde comes in. A lane tile has all eight tiles round it
//    in its own district's blocks, so the lanes of two districts are never
//    nearer than two tiles.
// 5. Ground. A tile's land is the district of the block under it, looked up
//    a few tiles to one side by smooth noise. The shift is nothing beside a
//    lane or a gate and grows away from them, so borders curve where there
//    is room and stay where the gates are. Then every district is grown from
//    its lanes, a tile at a time, each next to one it has: over its own land
//    first, then over any land its owner could not get to. A tile with
//    another district among the eight round it stays out for good. What
//    stays out is the border between districts, at least one tile thick,
//    also diagonally.
// 6. Barriers. Border tiles become water (the river, where the border has
//    the far bank on one side only), rock beside a crag, dark trees beside
//    an old wood, and the biome's own barrier elsewhere. A passage across
//    the river is a bridge if it is on the tree and a ford if it is a loop,
//    and nothing else crosses it. Where a passage is "open" the border
//    between its two districts is taken out instead.
// 7. Dressing. Woods and the river are thickened, the map's edges get the
//    biome's barrier (one tile deep on the side the horde comes from), and
//    cover (groves, ponds, outcrops), cache walls and den walls are stamped
//    inside districts. Each of these turns walkable tiles into blocked ones,
//    and a tile is turned only if it is not on a lane and its walkable
//    4-neighbours stay joined to each other through the eight tiles round it.
// 8. Rings and contents. A district's ring is the third of the longest walk
//    from the ramp, along the lanes, that its centre lies in. District kinds
//    are dealt from the biome's deck. Dens and caches take tiles in the
//    districts with the most passages between them and the ramp and each
//    other, more of them in the far rings, and never within eight tiles of
//    the ramp. Seams are shared out by the size of a district. Each takes
//    the next tile in its district's fixed order, so no two share one.
//
// Why every walkable tile can be reached from the ramp
//
// - The neighbour graph is connected: the blocks tile the map and each is in
//   a district, so any two districts are joined by a chain of blocks side by
//   side. Prim's algorithm therefore spans every district.
// - The skeleton is connected. All of a district's lanes run from its centre.
//   A tree passage joins the centres of its two districts by lane, gate,
//   lane. The city's centre is the ramp.
// - After step 5 a walkable tile is in a district or in a gate. A district's
//   tile was added beside a tile already in the district, so by induction it
//   is joined to one of the district's lanes. A gate's tiles lie between the
//   lane ends of its two districts.
// - A border tile opened in step 6 has a 4-neighbour in one of its passage's
//   two districts.
// - Step 7 never cuts the ground: if a tile's walkable 4-neighbours are
//   joined through the eight tiles round it, a walk through the tile can go
//   round it instead.
// - Nothing else changes what is walkable. Shore, path, den floor and deep
//   grass repaint tiles that already were.
//
// The graph is also exact. Two districts never touch (step 5). A gate's
// 4-neighbours are its two districts' lane ends, its own tiles and its jambs.
// An opened border tile has only its passage's two districts among the eight
// tiles round it, and is never beside another passage's tile. So a walk
// leaves a district only through one of its passages, and the routes in the
// output are the only routes there are.
//
// Cost: every loop runs over tiles, blocks, districts or passages a fixed
// number of times, and the growth pushes a tile at most four times. No step
// retries, and no loop's length depends on what the seed drew.

import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import { NEIGHBOURS, type Point, TERRAINS, type Terrain, type TileMap } from "./map.ts";
import { createRng, nextU32, type Rng } from "./rng.ts";

export class LandingError extends Error {
  override name = "LandingError";
}

export const SIZE_CLASSES = ["small", "medium", "large"] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** What a size class holds. Size is difficulty (docs/slice.md, section 1). */
export interface SizeSpec {
  readonly width: number;
  readonly height: number;
  /** Tiles of open ground kept round the city's footprint. */
  readonly apron: number;
  /** How many bands of blocks, counted out from the city, each get their own seed blocks. */
  readonly bands: number;
  /** The side a block aims for, in tiles. Districts are made of blocks. */
  readonly block: number;
  /** How many blocks a district aims for. */
  readonly cell: number;
  /** The widest a gate is cut, in tiles. */
  readonly gate: number;
  /** Loop passages added to the spanning tree, per 100 districts. */
  readonly loops: number;
  /** Places on the horde's edge where it comes in. */
  readonly entries: number;
  /** How many times the barrier on the quiet edges is thickened. */
  readonly edge: number;
  /** How many times a wood between districts is thickened. */
  readonly wood: number;
  /** How many times the river is widened, on both banks. */
  readonly river: number;
  /** How far, in tiles, the noise may push a border off the line between two districts. */
  readonly warp: number;
  /** The most loop passages that may ford the river. */
  readonly fords: number;
  /** Radius range of a grove, meadow or pond. */
  readonly blob: readonly [number, number];
  /** Dens and caches, before what the caller adds. */
  readonly dens: number;
  readonly caches: number;
  /** Levels ring 3 is above the landing's level. */
  readonly far: number;
}

/**
 * The three size classes, as docs/slice.md has them. The look target (#362)
 * may still change the tile counts; these are the numbers to change when it does.
 */
export const SIZES: Readonly<Record<SizeClass, SizeSpec>> = Object.freeze({
  small: {
    width: 40,
    height: 22,
    apron: 3,
    bands: 2,
    block: 4,
    cell: 4,
    gate: 2,
    loops: 34,
    entries: 1,
    edge: 1,
    wood: 1,
    river: 0,
    warp: 2,
    fords: 1,
    blob: [1, 2],
    dens: 1,
    caches: 1,
    far: 0,
  },
  medium: {
    width: 60,
    height: 33,
    apron: 4,
    bands: 2,
    block: 5,
    cell: 5,
    gate: 2,
    loops: 30,
    entries: 2,
    edge: 2,
    wood: 1,
    river: 1,
    warp: 3,
    fords: 1,
    blob: [2, 3],
    dens: 3,
    caches: 2,
    far: 5,
  },
  large: {
    width: 80,
    height: 45,
    apron: 4,
    bands: 3,
    block: 5,
    cell: 7,
    gate: 3,
    loops: 30,
    entries: 3,
    edge: 2,
    wood: 2,
    river: 1,
    warp: 4,
    fords: 2,
    blob: [2, 4],
    dens: 5,
    caches: 3,
    far: 10,
  },
});

/** The ground the parked city stands on, in tiles, and the width of its ramp. */
export const CITY_WIDTH = 10;
export const CITY_HEIGHT = 6;
export const RAMP_WIDTH = 3;

/** The apron: ground within this many tiles' walk of the ramp, which stays gentle. */
export const APRON = 8;
/** The highest level a monster may have on the apron. */
export const APRON_LEVEL = 5;
export const MAX_LEVEL = 99;
export const MAX_MONSTER_LEVEL = 99;
/** The most dens, and the most caches, a caller may add to a size's own. */
export const MAX_EXTRA = 20;

/** What a biome's monsters and ground deal in. */
export const ELEMENTS = ["none", "cold", "lightning", "fire"] as const;
export type Element = (typeof ELEMENTS)[number];

/** The biomes of docs/art.md, section 8. Append only. */
export const BIOMES = ["meadow", "pinewood", "fen", "crags", "ash_waste"] as const;
export type Biome = (typeof BIOMES)[number];

export const EDGES = ["north", "east", "south", "west"] as const;
export type Edge = (typeof EDGES)[number];
/** The step toward each edge, in EDGES order. */
const TOWARD: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The rings, by a district's `ring`: 0 is the city's own, then thirds of the longest walk. */
export const RINGS = ["city", "ring 1", "ring 2", "ring 3"] as const;

/** What a district is mostly made of. Append only. */
export const DISTRICT_KINDS = ["city", "meadow", "grove", "mere", "crag", "oldwood"] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

/**
 * How a passage gets through the border between its districts: no border at
 * all, a gap in a wood, a pass through a ridge, or a ford or bridge over the
 * river. Append only.
 */
export const PASSAGE_KINDS = ["open", "gap", "pass", "ford", "bridge"] as const;
export type PassageKind = (typeof PASSAGE_KINDS)[number];

/** A node of the layout graph: a piece of ground with one way in per passage. */
export interface District extends Point {
  /** Its position in `districts`. The city's, which holds the ramp, is 0 and the root. */
  readonly id: number;
  /** 0 for the city's; else 1 to 3, the third of the longest walk its centre lies in. */
  readonly ring: number;
  readonly kind: DistrictKind;
  /** The box round the blocks its lanes were laid in. Its ground may spill past it. */
  readonly bounds: Rect;
  /** Passages between it and the city, by the fewest. */
  readonly steps: number;
  /** Tiles from the ramp to its centre along the lanes, by the shortest route. */
  readonly distance: number;
  /** `distance` as a share of the landing's longest, 0 to 1000. */
  readonly depth: number;
  /** The passages that lead out of it, as positions in `passages`. */
  readonly passages: readonly number[];
}

/** An edge of the layout graph: the only way between its two districts. */
export interface Passage extends Point {
  readonly id: number;
  readonly a: number;
  readonly b: number;
  readonly kind: PassageKind;
  /** On the spanning tree; the others are loops. */
  readonly tree: boolean;
  /** The gate: the tiles cut through the border. `x`, `y` is one in its middle. */
  readonly tiles: readonly Point[];
}

/** Where the horde's front comes in, and the way it knows to the hull. */
export interface Entry extends Point {
  readonly district: number;
  /** The districts it crosses, from the entry's to the city's. */
  readonly route: readonly number[];
  /** The passages between them, in order. */
  readonly passages: readonly number[];
  /** Every tile of the way, from the entry to the ramp, each next to the last. */
  readonly path: readonly Point[];
}

/** Something that stands on a tile of its own in a district. */
export interface Stand extends Point {
  readonly district: number;
  /** Its district's ring, 1 to 3. */
  readonly ring: number;
}

/** A den's mouth. Its name is a place, lettered on the map. */
export interface Den extends Stand {
  readonly name: string;
  /** Its ring's level: the level of its elite and of what comes out of it. */
  readonly level: number;
}

/** A cache, opened by standing work. Its name is a place. */
export interface Cache extends Stand {
  readonly name: string;
  /** Its ring's level: the item level of what it gives. */
  readonly level: number;
}

/** A seam of salvage, worked from its tile. */
export type Seam = Stand;

export interface Landing extends TileMap {
  readonly seed: number;
  readonly size: SizeClass;
  readonly biome: Biome;
  /** The biome's element. */
  readonly element: Element;
  /** The landing's level, which the navigator set. */
  readonly level: number;
  /** Monster level by ring: the most on the apron, then rings 1, 2 and 3. */
  readonly levels: readonly number[];
  /** The ground under the parked city: `camp`, which monsters cannot stand on. */
  readonly city: Rect;
  /** The foot of the ramp in its middle, also the place `ramp`. */
  readonly ramp: Point;
  /** The edge the horde's front comes in along. */
  readonly horde: Edge;
  /** The layout graph's nodes. The city's district is the first, and the root. */
  readonly districts: readonly District[];
  /** The layout graph's edges. */
  readonly passages: readonly Passage[];
  /** The district each tile belongs to, row by row; -1 for a border or a gate. */
  readonly districtAt: readonly number[];
  readonly entries: readonly Entry[];
  readonly dens: readonly Den[];
  readonly caches: readonly Cache[];
  readonly seams: readonly Seam[];
}

export interface LandingInput {
  readonly seed: number;
  readonly size: SizeClass;
  readonly biome: Biome;
  /** 1 to MAX_LEVEL. */
  readonly level: number;
  /** Dens and caches beyond the size's own, as for a larger crew; 0 to MAX_EXTRA each. */
  readonly extraDens?: number;
  readonly extraCaches?: number;
}

const T = (terrain: Terrain): number => TERRAINS.indexOf(terrain);
const GRASS = T("grass");
const PATH = T("path");
const CAMP = T("camp");
const SHORE = T("shore");
const DEEP_GRASS = T("deep_grass");
const DEN = T("den");
const BRIDGE = T("bridge");
const TREE = T("tree");
const DARK_TREE = T("dark_tree");
const WATER = T("water");
const ROCK = T("rock");
/** The walkable terrains, as map.ts has them. */
const WALK = new Set([GRASS, PATH, CAMP, SHORE, DEEP_GRASS, DEN, BRIDGE]);

/** The eight tiles round a tile, clockwise from the north; the even ones are NEIGHBOURS. */
const AROUND: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** What a biome is made of: its element, its barrier, whether it has a river, its districts. */
interface BiomeSpec {
  readonly element: Element;
  /** The terrain of its borders and its edge, where no crag or old wood says otherwise. */
  readonly wall: number;
  readonly river: boolean;
  /** District kinds dealt to its districts, in this order, round and round. */
  readonly deck: readonly DistrictKind[];
}
const BIOME_SPECS: Readonly<Record<Biome, BiomeSpec>> = {
  meadow: {
    element: "none",
    wall: TREE,
    river: true,
    deck: ["meadow", "grove", "mere", "meadow", "grove", "crag"],
  },
  pinewood: {
    element: "none",
    wall: DARK_TREE,
    river: true,
    deck: ["oldwood", "grove", "crag", "oldwood", "meadow", "mere"],
  },
  fen: {
    element: "cold",
    wall: DARK_TREE,
    river: true,
    deck: ["mere", "meadow", "mere", "oldwood", "mere", "grove"],
  },
  crags: {
    element: "lightning",
    wall: ROCK,
    river: true,
    deck: ["crag", "crag", "meadow", "crag", "mere", "oldwood"],
  },
  ash_waste: {
    element: "fire",
    wall: ROCK,
    river: false,
    deck: ["crag", "oldwood", "meadow", "crag", "oldwood", "meadow"],
  },
};
/** Out of 100 passages into a band, how many have no border at all. */
const OPEN_SHARE = [0, 60, 35, 15];
/** The least a block measures either way: room for a lane with a tile clear on each side. */
const MIN_BLOCK = 4;

/** An integer in [0, bound) from one draw; bound is at most 2^20, so the product is exact. */
const roll = (rng: Rng, bound: number): number =>
  Math.floor((nextU32(rng) * bound) / 0x1_0000_0000);
const between = (rng: Rng, lo: number, hi: number): number => lo + roll(rng, hi - lo + 1);
function shuffle<V>(rng: Rng, list: V[]): V[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = roll(rng, i + 1);
    [list[i], list[j]] = [list[j] as V, list[i] as V];
  }
  return list;
}

/** The tiles of a 4-connected line from one point to another, both included. */
function line(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const n = dx + dy;
  const out: [number, number][] = [[ax, ay]];
  let x = ax;
  let y = ay;
  for (let i = 1; i <= n; i++) {
    if (Math.floor((i * dx) / n) > Math.floor(((i - 1) * dx) / n)) x += Math.sign(bx - ax);
    else y += Math.sign(by - ay);
    out.push([x, y]);
  }
  return out;
}

/** Smooth noise, 0 to 255 a tile: random values on a coarse lattice, blended between. */
function noise(rng: Rng, width: number, height: number, period: number): number[] {
  const gw = Math.floor(width / period) + 2;
  const gh = Math.floor(height / period) + 2;
  const lattice: number[] = [];
  for (let i = 0; i < gw * gh; i++) lattice.push(roll(rng, 256));
  const field: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / period);
      const gy = Math.floor(y / period);
      const fx = x - gx * period;
      const fy = y - gy * period;
      const v = (ox: number, oy: number): number => lattice[(gy + oy) * gw + gx + ox] as number;
      field.push(
        Math.floor(
          (v(0, 0) * (period - fx) * (period - fy) +
            v(1, 0) * fx * (period - fy) +
            v(0, 1) * (period - fx) * fy +
            v(1, 1) * fx * fy) /
            (period * period),
        ),
      );
    }
  }
  return field;
}

/** A rectangle of tiles: x0 and y0 inside, x1 and y1 one past the end. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A side shared by blocks of two districts. `a` is the district on the left or upper side. */
interface Side {
  a: number;
  b: number;
  blockA: number;
  blockB: number;
  /** The shared side runs north to south, so the passage goes west to east. */
  upright: boolean;
  /** The first column (or row) of `b`. */
  at: number;
  /** The shared stretch of the side: from `lo`, up to but not including `hi`. */
  lo: number;
  hi: number;
  weight: number;
}

/** A passage being laid out, with its tiles as indices. */
interface Link {
  side: Side;
  tree: boolean;
  kind: PassageKind;
  gate: number[];
  /** From `a`'s centre to the gate, the gate's middle row, and from `b`'s centre to the gate. */
  laneA: number[];
  row: number[];
  laneB: number[];
}

const FIELDS = new Set(["seed", "size", "biome", "level", "extraDens", "extraCaches"]);

/** Reads and checks an input, whatever it is; throws a LandingError for anything wrong. */
function readInput(raw: unknown): {
  seed: number;
  size: SizeClass;
  biome: Biome;
  level: number;
  extraDens: number;
  extraCaches: number;
} {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new LandingError("a landing's input must be an object");
    for (const field of Object.keys(raw)) {
      if (!FIELDS.has(field)) throw new LandingError(`unknown field ${show(field).slice(0, 40)}`);
    }
    const own = (field: string): unknown =>
      Object.hasOwn(raw, field) ? (raw as Record<string, unknown>)[field] : undefined;
    const seed = own("seed");
    if (!isInt32(seed)) throw new LandingError("seed must be a 32-bit whole number");
    const size = SIZE_CLASSES.find((s) => s === own("size"));
    if (size === undefined)
      throw new LandingError(
        `size must be one of ${SIZE_CLASSES.join(", ")}, not ${show(own("size")).slice(0, 40)}`,
      );
    const biome = BIOMES.find((b) => b === own("biome"));
    if (biome === undefined)
      throw new LandingError(
        `biome must be one of ${BIOMES.join(", ")}, not ${show(own("biome")).slice(0, 40)}`,
      );
    const level = own("level");
    if (!isInt32(level) || level < 1 || level > MAX_LEVEL)
      throw new LandingError(`level must be a whole number from 1 to ${MAX_LEVEL}`);
    const extra = (field: string): number => {
      const value = own(field) ?? 0;
      if (!isInt32(value) || value < 0 || value > MAX_EXTRA)
        throw new LandingError(`${field} must be a whole number from 0 to ${MAX_EXTRA}`);
      return value;
    };
    return {
      seed,
      size,
      biome,
      level,
      extraDens: extra("extraDens"),
      extraCaches: extra("extraCaches"),
    };
  } catch (error) {
    if (error instanceof LandingError) throw error;
    // Anything else came from reading a value that is not plain data.
    throw new LandingError("a landing's input could not be read");
  }
}

/** A min-heap of whole numbers. */
class Heap {
  private readonly keys: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number): void {
    const keys = this.keys;
    let i = keys.length;
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((keys[parent] as number) <= key) break;
      keys[i] = keys[parent] as number;
      i = parent;
    }
    keys[i] = key;
  }
  pop(): number {
    const keys = this.keys;
    const top = keys[0] as number;
    const last = keys.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && (keys[child + 1] as number) < (keys[child] as number)) child++;
        if ((keys[child] as number) >= last) break;
        keys[i] = keys[child] as number;
        i = child;
      }
      keys[i] = last;
    }
    return top;
  }
}

/**
 * Generates a landing from its input, or throws a LandingError if the input
 * is not one: an unknown size or biome, a level or a count out of range, or a
 * seed that is not a 32-bit whole number.
 */
export function generateLanding(input: unknown): Landing {
  const { seed, size, biome: biomeName, level, extraDens, extraCaches } = readInput(input);
  const biome = BIOME_SPECS[biomeName];
  const spec = SIZES[size];
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  // One stream a stage, so that a change to one stage's draws leaves the others' alone.
  const master = createRng(seed);
  const fork = (): Rng => createRng(nextU32(master) | 0);
  const layoutRng = fork();
  const graphRng = fork();
  const contentRng = fork();
  const shapeRng = fork();
  const denRng = fork();

  const at = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const xOf = (i: number): number => i % W;
  const yOf = (i: number): number => (i - (i % W)) / W;
  const point = (i: number): Point => ({ x: xOf(i), y: yOf(i) });

  const tiles: number[] = new Array(N).fill(GRASS);
  /** The district a tile is in, or -1. */
  const owner: number[] = new Array(N).fill(-1);
  /** The passage whose gate or opened border a tile is, or -1. */
  const label: number[] = new Array(N).fill(-1);
  /** Tiles the growth may not take: gates and their jambs. */
  const fixed: boolean[] = new Array(N).fill(false);
  /** Tiles no barrier or obstacle may take: lanes, gates and the city's apron. */
  const kept: boolean[] = new Array(N).fill(false);

  // 0. The city: off the middle, away from the horde's edge, so the plate has room
  // on the side where things happen. Its ramp comes out on that side, toward the land.
  const hordeIndex = roll(layoutRng, 4);
  const horde = EDGES[hordeIndex] as Edge;
  const [hx, hy] = TOWARD[hordeIndex] as [number, number];
  const cx = (W >> 1) - hx * (W >> 3);
  const cy = (H >> 1) - hy * (H >> 3);
  const city: Rect = {
    x: cx - (CITY_WIDTH >> 1),
    y: cy - (CITY_HEIGHT >> 1),
    width: CITY_WIDTH,
    height: CITY_HEIGHT,
  };
  const cityRight = city.x + city.width - 1;
  const cityBottom = city.y + city.height - 1;
  // The ramp: RAMP_WIDTH tiles wide and two long, out from the middle of that side.
  const half = RAMP_WIDTH >> 1;
  const rampBase: Rect =
    hx > 0
      ? { x: cityRight + 1, y: cy - half, width: 2, height: RAMP_WIDTH }
      : hx < 0
        ? { x: city.x - 2, y: cy - half, width: 2, height: RAMP_WIDTH }
        : hy > 0
          ? { x: cx - half, y: cityBottom + 1, width: RAMP_WIDTH, height: 2 }
          : { x: cx - half, y: city.y - 2, width: RAMP_WIDTH, height: 2 };
  const ramp: Point =
    hx > 0
      ? { x: cityRight + 2, y: cy }
      : hx < 0
        ? { x: city.x - 2, y: cy }
        : hy > 0
          ? { x: cx, y: cityBottom + 2 }
          : { x: cx, y: city.y - 2 };

  // 1. Blocks. The apron, two tiles deeper on the ramp's side, is the city's own
  // ground; a side with no room for a block beyond it gives that ground to the city.
  const pad = [spec.apron, spec.apron, spec.apron, spec.apron];
  pad[hordeIndex] = spec.apron + 2;
  const apron: Box = {
    x0: Math.max(0, city.x - (pad[3] as number)),
    y0: Math.max(0, city.y - (pad[0] as number)),
    x1: Math.min(W, cityRight + 1 + (pad[1] as number)),
    y1: Math.min(H, cityBottom + 1 + (pad[2] as number)),
  };
  const home: Box = {
    x0: apron.x0 < MIN_BLOCK ? 0 : apron.x0,
    y0: apron.y0 < MIN_BLOCK ? 0 : apron.y0,
    x1: W - apron.x1 < MIN_BLOCK ? W : apron.x1,
    y1: H - apron.y1 < MIN_BLOCK ? H : apron.y1,
  };
  /** Cuts a stretch into blocks near the class's size, none under the least: where each ends. */
  const cut = (from: number, to: number): number[] => {
    const length = to - from;
    if (length === 0) return [];
    const n = Math.max(
      1,
      Math.min(
        Math.floor((length + (spec.block >> 1)) / spec.block),
        Math.floor(length / MIN_BLOCK),
      ),
    );
    const ends: number[] = [];
    let last = 0;
    for (let i = 1; i < n; i++) {
      const lo = last + MIN_BLOCK;
      const hi = length - MIN_BLOCK * (n - i);
      last = Math.max(lo, Math.min(hi, Math.floor((length * i) / n) + between(layoutRng, -1, 1)));
      ends.push(from + last);
    }
    ends.push(to);
    return ends;
  };
  const xs = [0, ...cut(0, home.x0), ...cut(home.x0, home.x1), ...cut(home.x1, W)];
  const ys = [0, ...cut(0, home.y0), ...cut(home.y0, home.y1), ...cut(home.y1, H)];
  const gw = xs.length - 1;
  const gh = ys.length - 1;
  const B = gw * gh;
  const boxOf = (b: number): Box => ({
    x0: xs[b % gw] as number,
    x1: xs[(b % gw) + 1] as number,
    y0: ys[Math.floor(b / gw)] as number,
    y1: ys[Math.floor(b / gw) + 1] as number,
  });
  const boxes = Array.from({ length: B }, (_, b) => boxOf(b));
  /** The blocks beside a block, as NEIGHBOURS or as AROUND. */
  const beside = (b: number, steps: readonly (readonly [number, number])[]): number[] => {
    const out: number[] = [];
    for (const [dx, dy] of steps) {
      const [i, j] = [(b % gw) + dx, Math.floor(b / gw) + dy];
      if (i >= 0 && j >= 0 && i < gw && j < gh) out.push(j * gw + i);
    }
    return out;
  };
  /** The district each block belongs to; the city's is 0. */
  const districtOf: number[] = boxes.map((box) =>
    box.x0 >= home.x0 && box.x1 <= home.x1 && box.y0 >= home.y0 && box.y1 <= home.y1 ? 0 : -1,
  );
  const free = districtOf.flatMap((d, b) => (d === -1 ? [b] : []));
  if (free.length === 0) throw new Error(`a ${size} landing has no room for a district`);
  // How far out a block is: blocks from the city, counting diagonals as one.
  const out: number[] = districtOf.map((d) => (d === 0 ? 0 : -1));
  const ordered = districtOf.flatMap((d, b) => (d === 0 ? [b] : []));
  for (let head = 0; head < ordered.length; head++) {
    const b = ordered[head] as number;
    for (const c of beside(b, AROUND)) {
      if (out[c] !== -1) continue;
      out[c] = (out[b] as number) + 1;
      ordered.push(c);
    }
  }
  const farthest = Math.max(...out);
  /** The ring a block lies in, 1 to the class's count. */
  const band = out.map((steps) =>
    steps === 0 ? 0 : 1 + Math.floor(((steps - 1) * spec.bands) / farthest),
  );

  // Districts. Each ring gets a seed block for every few of its blocks, each seed
  // the block farthest from the seeds so far; a piece of the map cut off by the
  // city with no seed in it gets one too. Then the districts take turns to add a
  // free block next to one they have, staying in their ring where they can.
  const rank: number[] = new Array(B).fill(0);
  shuffle(
    layoutRng,
    Array.from({ length: B }, (_, b) => b),
  ).forEach((b, n) => {
    rank[b] = n;
  });
  const seeds: number[] = [];
  const bandOf: number[] = [0];
  const blockGap = (p: number, q: number): number =>
    Math.max(Math.abs((p % gw) - (q % gw)), Math.abs(Math.floor(p / gw) - Math.floor(q / gw)));
  const seed1 = (pool: readonly number[], ring: number): void => {
    let best = -1;
    let bestGap = -1;
    for (const b of pool) {
      if (seeds.includes(b)) continue;
      const gap = Math.min(B, ...seeds.map((s) => blockGap(s, b)));
      const better =
        gap > bestGap || (gap === bestGap && (rank[b] as number) < (rank[best] as number));
      if (best === -1 || better) [best, bestGap] = [b, gap];
    }
    if (best === -1) return;
    seeds.push(best);
    bandOf.push(ring);
  };
  for (let k = 1; k <= spec.bands; k++) {
    const pool = free.filter((b) => band[b] === k);
    const wanted = Math.floor((pool.length + (spec.cell >> 1)) / spec.cell);
    for (let n = 0; n < Math.max(1, wanted) && pool.length > 0; n++) seed1(pool, k);
  }
  // The pieces the free blocks fall into, by flooding from each in turn.
  const piece: number[] = new Array(B).fill(-1);
  for (const start of free) {
    if (piece[start] !== -1) continue;
    const members = [start];
    piece[start] = start;
    for (let head = 0; head < members.length; head++) {
      for (const c of beside(members[head] as number, NEIGHBOURS)) {
        if (districtOf[c] !== -1 || piece[c] !== -1) continue;
        piece[c] = start;
        members.push(c);
      }
    }
    if (!members.some((b) => seeds.includes(b))) seed1(members, band[start] as number);
  }
  const count = seeds.length + 1;
  // The growth packs a district into six bits of a heap key, and a tile into twelve.
  if (count > 64) throw new Error("a landing has more districts than its growth can order");
  if (N > 4096) throw new Error("a landing has more tiles than its growth can order");
  const each = Array.from({ length: count }, (_, d) => d);
  /** The block a block was added from; -1 for a seed and for the city's. */
  const parentBlock: number[] = new Array(B).fill(-1);
  const blocksOf: number[][] = each.map((d) => (d === 0 ? [] : [seeds[d - 1] as number]));
  seeds.forEach((b, n) => {
    districtOf[b] = n + 1;
  });
  for (let round = 0, grew = true; grew && round < free.length; round++) {
    grew = false;
    for (let d = 1; d < count; d++) {
      let best = -1;
      let from = -1;
      let bestScore = 0;
      for (const b of blocksOf[d] as number[]) {
        for (const c of beside(b, NEIGHBOURS)) {
          if (districtOf[c] !== -1) continue;
          const score =
            Math.abs((band[c] as number) - (bandOf[d] as number)) * B + (rank[c] as number);
          if (best === -1 || score < bestScore) [best, from, bestScore] = [c, b, score];
        }
      }
      if (best === -1) continue;
      grew = true;
      districtOf[best] = d;
      parentBlock[best] = from;
      (blocksOf[d] as number[]).push(best);
    }
  }
  if (districtOf.includes(-1)) throw new Error("a block of a landing was left to no district");

  /** The block each tile lies in. */
  const blockUnder: number[] = [];
  for (let y = 0, j = 0; y < H; y++) {
    if ((ys[j + 1] as number) <= y) j++;
    for (let x = 0, i = 0; x < W; x++) {
      if ((xs[i + 1] as number) <= x) i++;
      blockUnder.push(j * gw + i);
    }
  }
  const blockAt = (x: number, y: number): number => blockUnder[at(x, y)] as number;
  /**
   * Puts a tile in a district before the growth starts. It must lie well inside
   * the district's blocks: every tile round it in a block of the same district.
   * That keeps the lanes of two districts two tiles or more apart.
   */
  const claim = (i: number, district: number): void => {
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (inside(x, y) && districtOf[blockAt(x, y)] !== district)
        throw new Error("a lane leaves its district's blocks");
    }
    if (fixed[i]) throw new Error("a lane crosses a gate");
    owner[i] = district;
    kept[i] = true;
  };

  // 2. Passages. Every two districts with blocks side by side are neighbours, and
  // one of those sides, drawn by lot, is where a passage between them would go.
  const sideOf = new Map<number, Side>();
  for (let b = 0; b < B; b++) {
    for (const upright of [true, false]) {
      const c = upright ? b + 1 : b + gw;
      if (upright ? b % gw === gw - 1 : c >= B) continue;
      const [da, db] = [districtOf[b] as number, districtOf[c] as number];
      if (da === db) continue;
      const box = boxes[b] as Box;
      const ring = Math.max(bandOf[da] as number, bandOf[db] as number);
      const side: Side = {
        a: da,
        b: db,
        blockA: b,
        blockB: c,
        upright,
        at: upright ? box.x1 : box.y1,
        lo: upright ? box.y0 : box.x0,
        hi: upright ? box.y1 : box.x1,
        weight: ring * 0x10_0000 + roll(graphRng, 0x10_0000),
      };
      const key = Math.min(da, db) * count + Math.max(da, db);
      const old = sideOf.get(key);
      if (old === undefined || side.weight < old.weight) sideOf.set(key, side);
    }
  }
  const sides = [...sideOf.values()];
  // The spanning tree, grown outward from the city: always the lightest side
  // that joins a new district, and a nearer ring is always lighter.
  const joined: boolean[] = each.map((d) => d === 0);
  const parent: number[] = each.map(() => -1);
  const treeSteps: number[] = each.map(() => 0);
  const onTree = new Set<Side>();
  for (let n = 1; n < count; n++) {
    let best: Side | undefined;
    for (const side of sides) {
      if (joined[side.a] === joined[side.b]) continue;
      if (best === undefined || side.weight < best.weight) best = side;
    }
    if (best === undefined) throw new Error("a landing's districts are not all neighbours");
    const [from, to] = joined[best.a] ? [best.a, best.b] : [best.b, best.a];
    joined[to] = true;
    parent[to] = from;
    treeSteps[to] = (treeSteps[from] as number) + 1;
    onTree.add(best);
  }
  /** Passages between two districts along the tree. */
  const treeDistance = (a: number, b: number): number => {
    let [p, q, steps] = [a, b, 0];
    for (let n = 0; n < 2 * count && p !== q; n++) {
      if ((treeSteps[p] as number) >= (treeSteps[q] as number)) p = parent[p] as number;
      else q = parent[q] as number;
      steps++;
    }
    return steps;
  };
  // The river's far bank: the tree branch nearest a third of the districts that
  // leaves a district on the map's edge on each bank. Without one, no river.
  const below: number[][] = each.map((d) => [d]);
  for (const d of [...each].sort((p, q) => (treeSteps[q] as number) - (treeSteps[p] as number))) {
    if (d !== 0) (below[parent[d] as number] as number[]).push(...(below[d] as number[]));
  }
  const onEdge: boolean[] = each.map(() => false);
  boxes.forEach((box, b) => {
    if (box.x0 === 0 || box.y0 === 0 || box.x1 === W || box.y1 === H)
      onEdge[districtOf[b] as number] = true;
  });
  const edgeCount = onEdge.filter(Boolean).length;
  const far: boolean[] = each.map(() => false);
  let branch = -1;
  let branchScore = 0;
  for (let d = 1; d < count; d++) {
    const members = below[d] as number[];
    const touching = members.filter((m) => onEdge[m]).length;
    if (touching === 0 || touching === edgeCount) continue;
    const score = Math.abs(3 * members.length - count) * 0x10_0000 + roll(graphRng, 0x10_0000);
    if (branch === -1 || score < branchScore) [branch, branchScore] = [d, score];
  }
  if (biome.river && branch !== -1) for (const m of below[branch] as number[]) far[m] = true;

  // Loops: the spare sides that close the longest way round, first. Only so many
  // may cross the river, so the bridge and the fords stay the ways over it.
  const spare = sides
    .filter((side) => !onTree.has(side))
    .map((side) => ({ side, detour: treeDistance(side.a, side.b) }))
    .sort((p, q) => q.detour - p.detour || p.side.weight - q.side.weight);
  const loopCount = Math.min(spare.length, Math.floor((count * spec.loops + 99) / 100));
  const chosen = [...onTree];
  let fords = 0;
  for (const { side } of spare) {
    if (chosen.length - onTree.size === loopCount) break;
    if (far[side.a] !== far[side.b] && fords++ >= spec.fords) continue;
    chosen.push(side);
  }

  // District kinds, dealt from the biome's deck to the districts in a shuffled order.
  const kinds: DistrictKind[] = each.map(() => "city");
  shuffle(
    contentRng,
    each.filter((d) => d !== 0),
  ).forEach((d, n) => {
    kinds[d] = biome.deck[n % biome.deck.length] as DistrictKind;
  });

  // 3. The skeleton. The city first: its footprint, its ramp and the apron round them.
  for (let y = apron.y0 + 1; y < apron.y1 - 1; y++) {
    for (let x = apron.x0 + 1; x < apron.x1 - 1; x++) claim(at(x, y), 0);
  }
  for (let y = city.y; y <= cityBottom; y++) {
    for (let x = city.x; x <= cityRight; x++) tiles[at(x, y)] = CAMP;
  }
  for (let dy = 0; dy < rampBase.height; dy++) {
    for (let dx = 0; dx < rampBase.width; dx++) tiles[at(rampBase.x + dx, rampBase.y + dy)] = CAMP;
  }
  // A lane out of the city goes from the ramp along the road round the footprint
  // and the ramp, then straight to where it is going.
  const road: Box = {
    x0: Math.min(city.x, rampBase.x) - 1,
    y0: Math.min(city.y, rampBase.y) - 1,
    x1: Math.max(cityRight, rampBase.x + rampBase.width - 1) + 1,
    y1: Math.max(cityBottom, rampBase.y + rampBase.height - 1) + 1,
  };
  const loop: [number, number][] = [];
  for (let x = road.x0; x < road.x1; x++) loop.push([x, road.y0]);
  for (let y = road.y0; y < road.y1; y++) loop.push([road.x1, y]);
  for (let x = road.x1; x > road.x0; x--) loop.push([x, road.y1]);
  for (let y = road.y1; y > road.y0; y--) loop.push([road.x0, y]);
  const onLoop = (x: number, y: number): number => loop.findIndex((p) => p[0] === x && p[1] === y);
  const foot = onLoop(ramp.x + hx, ramp.y + hy);
  const cityLane = (to: number): number[] => {
    let qx = Math.max(road.x0, Math.min(road.x1, xOf(to)));
    let qy = Math.max(road.y0, Math.min(road.y1, yOf(to)));
    if (qx > road.x0 && qx < road.x1 && qy > road.y0 && qy < road.y1) {
      // Inside the road, which only a tile of the apron can be: out by the nearest side.
      const gaps = [qy - road.y0, road.x1 - qx, road.y1 - qy, qx - road.x0];
      const side = gaps.indexOf(Math.min(...gaps));
      if (side === 0) qy = road.y0;
      else if (side === 1) qx = road.x1;
      else if (side === 2) qy = road.y1;
      else qx = road.x0;
    }
    const target = onLoop(qx, qy);
    const ahead = (target - foot + loop.length) % loop.length;
    const step = ahead <= loop.length - ahead ? 1 : loop.length - 1;
    const lane = [at(ramp.x, ramp.y)];
    for (let i = foot, n = 0; n <= loop.length; i = (i + step) % loop.length, n++) {
      const [x, y] = loop[i] as [number, number];
      lane.push(at(x, y));
      if (i === target) break;
    }
    for (const [x, y] of line(qx, qy, xOf(to), yOf(to)).slice(1)) lane.push(at(x, y));
    return lane;
  };

  // Each block of a district has a hub, a tile inside it, and a lane to the hub
  // of the block it was added from, through the side they share. So a district's
  // lanes are a tree over its blocks, and its centre is its seed block's hub.
  const hub: number[] = boxes.map((box) =>
    at(between(layoutRng, box.x0 + 1, box.x1 - 2), between(layoutRng, box.y0 + 1, box.y1 - 2)),
  );
  const tilesOf = (points: [number, number][]): number[] => points.map(([x, y]) => at(x, y));
  /** The lane from the hub of a block's parent to its own. */
  const limb: number[][] = boxes.map((box, b) => {
    const p = parentBlock[b] as number;
    if (p === -1) return [];
    const from = boxes[p] as Box;
    const upright = from.y0 === box.y0;
    // Where it crosses: a tile of the shared side that is not at either end of it.
    const v = upright
      ? between(layoutRng, box.y0 + 1, box.y1 - 2)
      : between(layoutRng, box.x0 + 1, box.x1 - 2);
    const lower = upright ? from.x0 < box.x0 : from.y0 < box.y0;
    const edge = upright ? (lower ? box.x0 : from.x0) : lower ? box.y0 : from.y0;
    const [near, farther] = lower ? [edge - 1, edge] : [edge, edge - 1];
    const [px, py] = upright ? [near, v] : [v, near];
    const [qx, qy] = upright ? [farther, v] : [v, farther];
    return [
      ...tilesOf(line(xOf(hub[p] as number), yOf(hub[p] as number), px, py)),
      ...tilesOf(line(qx, qy, xOf(hub[b] as number), yOf(hub[b] as number))),
    ];
  });
  /** The tiles from a district's centre to the hub of one of its blocks. */
  const trunk = (block: number): number[] => {
    const parts: number[][] = [];
    for (let b = block, n = 0; parentBlock[b] !== -1 && n < B; b = parentBlock[b] as number, n++)
      parts.push(limb[b] as number[]);
    const lane = [hub[block] as number];
    if (parts.length === 0) return lane;
    lane.length = 0;
    for (const part of parts.reverse()) lane.push(...(lane.length === 0 ? part : part.slice(1)));
    return lane;
  };
  const centre: number[] = each.map((d) =>
    d === 0 ? at(ramp.x, ramp.y) : (hub[seeds[d - 1] as number] as number),
  );
  /** Lays a lane from a district's centre to a tile in or on one of its blocks, and returns it. */
  const lay = (district: number, block: number, to: number): number[] => {
    const start = hub[block] as number;
    const lane =
      district === 0
        ? cityLane(to)
        : [...trunk(block), ...tilesOf(line(xOf(start), yOf(start), xOf(to), yOf(to))).slice(1)];
    for (const i of lane) claim(i, district);
    return lane;
  };

  // The gates: two tiles deep across the shared side, a jamb at each end.
  const links: Link[] = chosen.map((side, id) => {
    const width = Math.min(spec.gate, side.hi - side.lo - 2);
    const start = between(graphRng, side.lo + 1, side.hi - 1 - width);
    /** A tile by its place across the side and along it. */
    const tile = (across: number, along: number): number =>
      side.upright ? at(across, along) : at(along, across);
    const gate: number[] = [];
    for (let v = start; v < start + width; v++) {
      for (const u of [side.at - 1, side.at]) {
        gate.push(tile(u, v));
        fixed[tile(u, v)] = true;
        label[tile(u, v)] = id;
      }
      claim(tile(side.at - 2, v), side.a);
      claim(tile(side.at + 1, v), side.b);
      // The approach to the gate is kept as wide as the gate.
      for (let u = side.at - 4; u <= side.at + 3; u++) {
        const [x, y] = side.upright ? [u, v] : [v, u];
        if (inside(x, y)) kept[at(x, y)] = true;
      }
    }
    for (const v of [start - 1, start + width]) {
      for (const u of [side.at - 1, side.at]) fixed[tile(u, v)] = true;
    }
    const mid = start + (width >> 1);
    const crossing = far[side.a] !== far[side.b];
    const tree = onTree.has(side);
    const ring = Math.max(bandOf[side.a] as number, bandOf[side.b] as number);
    const open = roll(graphRng, 100) < (OPEN_SHARE[ring] as number);
    const kind: PassageKind = crossing
      ? tree
        ? "bridge"
        : "ford"
      : open
        ? "open"
        : kinds[side.a] === "crag" || kinds[side.b] === "crag"
          ? "pass"
          : "gap";
    return {
      side,
      tree,
      kind,
      gate,
      laneA: lay(side.a, side.blockA, tile(side.at - 2, mid)),
      row: [tile(side.at - 1, mid), tile(side.at, mid)],
      laneB: lay(side.b, side.blockB, tile(side.at + 1, mid)),
    };
  });
  const linksOf: number[][] = each.map(() => []);
  links.forEach((link, id) => {
    (linksOf[link.side.a] as number[]).push(id);
    (linksOf[link.side.b] as number[]).push(id);
  });

  // Distances over the graph: fewest passages, and fewest tiles along the lanes.
  const steps: number[] = each.map((d) => (d === 0 ? 0 : -1));
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head] as number;
    for (const id of linksOf[d] as number[]) {
      const { a, b } = (links[id] as Link).side;
      const next = a === d ? b : a;
      if (steps[next] !== -1) continue;
      steps[next] = (steps[d] as number) + 1;
      queue.push(next);
    }
  }
  const distance: number[] = each.map((d) => (d === 0 ? 0 : -1));
  /** The passage a district takes toward the ramp. */
  const homeward: number[] = each.map(() => -1);
  const settled: boolean[] = each.map(() => false);
  for (let n = 0; n < count; n++) {
    let d = -1;
    for (const e of each) {
      if (settled[e] || distance[e] === -1) continue;
      if (d === -1 || (distance[e] as number) < (distance[d] as number)) d = e;
    }
    if (d === -1) break;
    settled[d] = true;
    for (const id of linksOf[d] as number[]) {
      const link = links[id] as Link;
      const next = link.side.a === d ? link.side.b : link.side.a;
      const through = (distance[d] as number) + link.laneA.length + link.laneB.length + 2;
      if (distance[next] !== -1 && (distance[next] as number) <= through) continue;
      distance[next] = through;
      homeward[next] = id;
    }
  }
  const longest = Math.max(1, ...distance);
  const depth = distance.map((tilesAway) => Math.floor((tilesAway * 1000) / longest));
  /** Fewest passages between every two districts. */
  const apart: number[][] = each.map((from) => {
    const hops: number[] = each.map((d) => (d === from ? 0 : -1));
    const reachedFrom = [from];
    for (let head = 0; head < reachedFrom.length; head++) {
      const d = reachedFrom[head] as number;
      for (const id of linksOf[d] as number[]) {
        const { a, b } = (links[id] as Link).side;
        const next = a === d ? b : a;
        if (hops[next] !== -1) continue;
        hops[next] = (hops[d] as number) + 1;
        reachedFrom.push(next);
      }
    }
    return hops;
  });

  // Rings (docs/slice.md, section 1): thirds of the longest walk from the ramp.
  const ring: number[] = depth.map((deep, d) =>
    d === 0 ? 0 : Math.min(3, 1 + Math.floor((deep * 3) / 1000)),
  );

  // Where things stand in a district: its tiles inside its blocks, in one fixed
  // order (the blocks shuffled, a tile of each in turn from a drawn start).
  // Each thing takes the first tile in that order that nothing has, so no two
  // stand on one tile. A den or a cache takes one beyond the apron only.
  const inner = (b: number): number => {
    const box = boxes[b] as Box;
    return (box.x1 - box.x0 - 2) * (box.y1 - box.y0 - 2);
  };
  const outer = each.filter((d) => d !== 0);
  const order: number[][] = each.map((d) => {
    const blocks = shuffle(contentRng, [...(blocksOf[d] as number[])]);
    const first = blocks.map((b) => roll(contentRng, inner(b)));
    const list: number[] = [];
    for (let turn = 0; turn < Math.max(0, ...blocks.map(inner)); turn++) {
      blocks.forEach((b, n) => {
        if (turn >= inner(b)) return;
        const box = boxes[b] as Box;
        const width = box.x1 - box.x0 - 2;
        const k = ((first[n] as number) + turn) % inner(b);
        list.push(at(box.x0 + 1 + (k % width), box.y0 + 1 + Math.floor(k / width)));
      });
    }
    return list;
  });
  const taken: boolean[] = new Array(N).fill(false);
  /** True for a tile no walk of APRON tiles or fewer from the ramp can reach. */
  const beyond = (i: number): boolean =>
    Math.abs(xOf(i) - ramp.x) + Math.abs(yOf(i) - ramp.y) > APRON;
  type Spot = { d: number; block: number; i: number };
  const next = (d: number, far: boolean): number =>
    (order[d] as number[]).find((i) => !taken[i] && (!far || beyond(i))) ?? -1;
  const stand = (d: number, far: boolean): Spot => {
    const i = next(d, far);
    taken[i] = true;
    return { d, block: blockUnder[i] as number, i };
  };

  /**
   * Stands things that should be far from the ramp and from each other: each
   * in the district with the most passages between it and everything stood so
   * far, then the deepest. Never in the city's, on the apron, or in a
   * district with no tile left.
   */
  const picked = [0];
  const spread = (n: number, unfit: (k: number, d: number) => number): Spot[] => {
    const found: Spot[] = [];
    for (let k = 0; k < n; k++) {
      const open = outer.filter((d) => next(d, true) !== -1);
      if (open.length === 0) throw new LandingError(`a ${size} landing has no room for so many`);
      const least = Math.min(...open.map((d) => unfit(k, d)));
      const pool = open.filter((d) => unfit(k, d) === least);
      const fresh = pool.filter((d) => !picked.includes(d));
      let best = -1;
      let bestGap = -1;
      for (const d of fresh.length > 0 ? fresh : pool) {
        const gap = Math.min(...picked.map((p) => (apart[p] as number[])[d] as number));
        const better =
          gap > bestGap || (gap === bestGap && (depth[d] as number) > (depth[best] as number));
        if (best === -1 || better) [best, bestGap] = [d, gap];
      }
      found.push(stand(best, true));
      picked.push(best);
    }
    return found;
  };
  // Dens first: the first in ring 3, the next in ring 2, and so on round the
  // order below, so the far ground has most and the near ground one in five.
  // Then caches the same way, in districts without a den while there are any.
  const RING_TURN = [3, 2, 3, 2, 1];
  /** 0 for a district in the ring whose turn it is, 2 for any other. */
  const turn = (k: number, d: number): number =>
    ring[d] === RING_TURN[k % RING_TURN.length] ? 0 : 2;
  const denAt = spread(spec.dens + extraDens, turn);
  const denned = new Set(denAt.map((s) => s.d));
  const cacheAt = spread(spec.caches + extraCaches, (k, d) => turn(k, d) + (denned.has(d) ? 1 : 0));
  // Seams: one for each 100 tiles, shared out by the number of blocks a district
  // has. Each goes to the district with the most blocks for each seam it holds.
  const held: number[] = each.map(() => 0);
  const seamAt: Spot[] = [];
  for (let n = 0; n < Math.floor(N / 100); n++) {
    let best = -1;
    for (const d of outer) {
      if (next(d, false) === -1) continue;
      const share = (d2: number): number =>
        Math.floor(((blocksOf[d2] as number[]).length * 1000) / ((held[d2] as number) + 1));
      if (best === -1 || share(d) > share(best)) best = d;
    }
    if (best === -1) throw new LandingError(`a ${size} landing has no room for its seams`);
    held[best] = (held[best] as number) + 1;
    seamAt.push(stand(best, false));
  }
  // What each district grows, by its kind: obstacles of one terrain, and deep
  // grass. A patch needs no tile of its own; it is centred on one of the district's.
  const GROWS: Readonly<Record<DistrictKind, readonly number[]>> = {
    city: [],
    meadow: [DEEP_GRASS, DEEP_GRASS],
    grove: [TREE, TREE, DEEP_GRASS],
    mere: [WATER, DEEP_GRASS, TREE],
    crag: [ROCK, ROCK, DEEP_GRASS],
    oldwood: [DARK_TREE, DARK_TREE, DEEP_GRASS],
  };
  const patches = outer.flatMap((d) =>
    GROWS[kinds[d] as DistrictKind].map((terrain, n) => ({
      d,
      i: (order[d] as number[])[n % (order[d] as number[]).length] as number,
      terrain,
      r: between(contentRng, spec.blob[0], spec.blob[1]),
    })),
  );
  const spurs = [...denAt, ...cacheAt, ...seamAt].map(({ d, block, i }) => lay(d, block, i));
  for (const { i } of [...denAt, ...cacheAt]) {
    for (const [dx, dy] of NEIGHBOURS) {
      if (inside(xOf(i) + dx, yOf(i) + dy)) kept[at(xOf(i) + dx, yOf(i) + dy)] = true;
    }
  }

  // The horde's entries: blocks on its edge, spread along it, each with a lane to the edge.
  const facesHorde = (b: number): boolean => {
    const box = boxes[b] as Box;
    return hx > 0 ? box.x1 === W : hx < 0 ? box.x0 === 0 : hy > 0 ? box.y1 === H : box.y0 === 0;
  };
  const edgeBlocks = boxes.flatMap((_, b) => (facesHorde(b) ? [b] : []));
  let gateways = edgeBlocks.filter((b) => districtOf[b] !== 0);
  // With only the city on that edge, the horde comes straight at the ramp.
  if (gateways.length === 0)
    gateways = [
      blockAt(hx > 0 ? W - 1 : hx < 0 ? 0 : ramp.x, hy > 0 ? H - 1 : hy < 0 ? 0 : ramp.y),
    ];
  const entryCount = Math.min(spec.entries, gateways.length);
  const entryPhase = roll(graphRng, gateways.length);
  const entryLanes = Array.from({ length: entryCount }, (_, n) => {
    const block = gateways[
      (entryPhase + Math.floor((n * gateways.length) / entryCount)) % gateways.length
    ] as number;
    const d = districtOf[block] as number;
    const box = boxes[block] as Box;
    const from = d === 0 ? at(ramp.x + hx, ramp.y + hy) : (hub[block] as number);
    // Straight out for the city; otherwise up to two tiles to either side.
    const drift = d === 0 ? 0 : between(graphRng, -2, 2);
    const [lo, hi] = hx !== 0 ? [box.y0 + 1, box.y1 - 2] : [box.x0 + 1, box.x1 - 2];
    const along = Math.max(lo, Math.min(hi, (hx !== 0 ? yOf(from) : xOf(from)) + drift));
    const edge = hx > 0 ? W - 1 : hy > 0 ? H - 1 : 0;
    const lane = lay(d, block, hx !== 0 ? at(edge, along) : at(along, edge));
    // The way in is three tiles wide where the block allows.
    for (const beside1 of [along - 1, along + 1]) {
      if (beside1 < lo || beside1 > hi) continue;
      claim(hx !== 0 ? at(edge, beside1) : at(beside1, edge), d);
    }
    return { d, lane };
  });

  // 4. The ground. First whose land each tile is. Unbent, that is the district of
  // the block under it. Smooth noise bends it: a tile looks up the block a few
  // tiles to one side, by an amount that is nothing beside a lane or a gate and
  // grows with the distance from them. So borders are curves where there is
  // room, and stay where the gates are. Then lone tiles are tidied away.
  const rough = noise(shapeRng, W, H, 5);
  const fine = noise(shapeRng, W, H, 3);
  const swayX = noise(shapeRng, W, H, 7);
  const swayY = noise(shapeRng, W, H, 7);
  /** Tiles from the nearest lane or gate, counting diagonals as one. */
  const clear: number[] = owner.map((d, i) => (d !== -1 || fixed[i] ? 0 : -1));
  const wavefront = clear.flatMap((steps, i) => (steps === 0 ? [i] : []));
  for (let head = 0; head < wavefront.length; head++) {
    const i = wavefront[head] as number;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y) || clear[at(x, y)] !== -1) continue;
      clear[at(x, y)] = (clear[i] as number) + 1;
      wavefront.push(at(x, y));
    }
  }
  let land: number[] = owner.map((d, i) => {
    if (d !== -1) return d;
    if (fixed[i]) return -1;
    const most = Math.min(spec.warp, (clear[i] as number) - 1);
    const sway = (field: readonly number[]): number =>
      Math.max(-most, Math.min(most, Math.floor((((field[i] as number) - 128) * most) / 40)));
    const x = Math.max(0, Math.min(W - 1, xOf(i) + sway(swayX)));
    const y = Math.max(0, Math.min(H - 1, yOf(i) + sway(swayY)));
    return districtOf[blockAt(x, y)] as number;
  });
  for (let pass = 0; pass < 2; pass++) {
    land = land.map((d, i) => {
      if (owner[i] !== -1 || fixed[i]) return d;
      // The district most of the nine tiles here belong to, if five or more do.
      const votes: number[] = [];
      for (const [dx, dy] of AROUND) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (inside(x, y) && land[at(x, y)] !== -1) votes.push(land[at(x, y)] as number);
      }
      for (const v of votes) if (v !== d && votes.filter((w) => w === v).length >= 5) return v;
      return d;
    });
  }
  // Then the district itself: grown from its lanes, a tile at a time, each next
  // to one it already has. Its own land comes first, nearest the lanes first;
  // land that its district could not reach that way goes after, to whichever
  // district gets to it. A tile with another district among the eight round it
  // stays out, and is not offered again.
  const heap = new Heap();
  const done: boolean[] = owner.map((d, i) => d !== -1 || (fixed[i] as boolean));
  const LATER = 0x1_0000;
  const offer = (i: number): void => {
    const district = owner[i] as number;
    for (const [dx, dy] of NEIGHBOURS) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const j = at(x, y);
      if (done[j]) continue;
      const order =
        (land[j] === district ? 0 : LATER) + (clear[j] as number) * 256 + (rough[j] as number);
      heap.push((order * 4096 + j) * 64 + district);
    }
  };
  for (let i = 0; i < N; i++) if (owner[i] !== -1) offer(i);
  while (heap.size > 0) {
    const key = heap.pop();
    const district = key % 64;
    const i = ((key - district) / 64) % 4096;
    if (done[i]) continue;
    done[i] = true;
    let alone = true;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const other = owner[at(x, y)] as number;
      if (other !== -1 && other !== district) alone = false;
    }
    if (!alone) continue;
    owner[i] = district;
    offer(i);
  }

  // 5. Barriers. Where a passage is open, the border between its two districts goes:
  // each border tile that touches one of the two and has no third district, no other
  // passage's tile, and no border tile with a third district beside it.
  const openBetween = new Map<number, number>();
  links.forEach((link, id) => {
    const { a, b } = link.side;
    if (link.kind === "open") openBetween.set(Math.min(a, b) * count + Math.max(a, b), id);
  });
  /** The districts among the eight tiles round a tile, lowest first. */
  const around = (i: number): number[] => {
    const found: number[] = [];
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const d = owner[at(x, y)] as number;
      if (d !== -1 && !found.includes(d)) found.push(d);
    }
    return found.sort((p, q) => p - q);
  };
  for (let i = 0; i < N; i++) {
    if (owner[i] !== -1 || label[i] !== -1) continue;
    const near = around(i);
    if (near.length !== 2) continue;
    const [a, b] = near as [number, number];
    const id = openBetween.get(a * count + b);
    if (id === undefined) continue;
    let touches = false;
    let clear = true;
    for (const [dx, dy] of NEIGHBOURS) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const j = at(x, y);
      if (owner[j] !== -1) touches = true;
      else if (label[j] !== -1) clear &&= label[j] === id;
      else clear &&= around(j).every((d) => d === a || d === b);
    }
    if (touches && clear) label[i] = id;
  }
  links.forEach((link, id) => {
    const terrain = link.kind === "bridge" ? BRIDGE : link.kind === "ford" ? SHORE : GRASS;
    for (const i of link.gate) tiles[i] = terrain;
    if (link.kind === "open") for (let i = 0; i < N; i++) if (label[i] === id) tiles[i] = GRASS;
  });
  // The rest of the border is the river between its two banks, a ridge beside a crag,
  // and a wood anywhere else. `grows` is how many more times a barrier thickens.
  const grows: number[] = new Array(N).fill(0);
  const border: number[] = [];
  /** The river's banks among a border tile's districts: 1 the far one, 2 the near one, 3 both. */
  const banks: number[] = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== -1 || label[i] !== -1) continue;
    border.push(i);
    for (const d of around(i)) banks[i] = (banks[i] as number) | (far[d] ? 1 : 2);
  }
  for (const i of border) {
    const near = around(i);
    // Water where the two banks meet: in one tile, or in two side by side where
    // the border is two tiles thick and each sees one bank only.
    const wet =
      banks[i] === 3 ||
      (banks[i] !== 0 &&
        AROUND.some(([dx, dy]) => {
          const [x, y] = [xOf(i) + dx, yOf(i) + dy];
          return inside(x, y) && ((banks[at(x, y)] as number) | (banks[i] as number)) === 3;
        }));
    if (near.length === 0) {
      tiles[i] = -1;
    } else if (wet) {
      tiles[i] = WATER;
      grows[i] = spec.river;
    } else if (near.some((d) => kinds[d] === "crag")) {
      tiles[i] = ROCK;
    } else {
      // Dark trees beside an old wood; else the biome's own barrier.
      tiles[i] = near.some((d) => kinds[d] === "oldwood") ? DARK_TREE : biome.wall;
      grows[i] = spec.wood;
    }
  }
  // A border tile with no district beside it takes after the border next to it.
  for (const i of border) {
    if (tiles[i] !== -1) continue;
    tiles[i] = TREE;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y) || owner[at(x, y)] !== -1 || label[at(x, y)] !== -1) continue;
      const beside = tiles[at(x, y)] as number;
      if (beside === -1) continue;
      tiles[i] = beside;
      grows[i] = grows[at(x, y)] as number;
      break;
    }
  }

  // 6. Dressing. From here a tile changes from walkable to blocked only through
  // `block`, which refuses a tile whose walkable neighbours would lose each other.
  const walkable = (x: number, y: number): boolean =>
    inside(x, y) && WALK.has(tiles[at(x, y)] as number);
  /**
   * True if a walk through this tile can go round it instead: all its walkable
   * 4-neighbours lie in one unbroken run of walkable tiles among the eight
   * round it. Blocking such a tile cannot cut the ground in two.
   */
  const spare8 = (i: number): boolean => {
    const open = AROUND.map(([dx, dy]) => walkable(xOf(i) + dx, yOf(i) + dy));
    let runs = 0;
    for (let k = 0; k < 8; k++) {
      // A run of walkable tiles starts here, and holds a 4-neighbour.
      if (!open[k] || open[(k + 7) % 8]) continue;
      for (let n = k; open[n % 8] && n < k + 8; n++) {
        if (n % 2 === 0) {
          runs++;
          break;
        }
      }
    }
    return runs <= 1;
  };
  const block = (i: number, terrain: number, district = owner[i] as number): boolean => {
    if (kept[i] || owner[i] === -1 || owner[i] !== district) return false;
    if (!WALK.has(tiles[i] as number) || !spare8(i)) return false;
    tiles[i] = terrain;
    return true;
  };
  /** The tiles of a lumpy round patch, nearest its middle first. */
  const patch = (i: number, r: number): number[] => {
    const found: [number, number][] = [];
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (!inside(x, y)) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 * 256 <= r * r * (150 + (fine[at(x, y)] as number))) found.push([d2, at(x, y)]);
      }
    }
    return found.sort((p, q) => p[0] - q[0] || p[1] - q[1]).map((f) => f[1]);
  };
  /** The step from a tile away from its district's centre, one of NEIGHBOURS. */
  const outward = (i: number, district: number): [number, number] => {
    const from = centre[district] as number;
    const [dx, dy] = [xOf(i) - xOf(from), yOf(i) - yOf(from)];
    if (dx === 0 && dy === 0) return [1, 0];
    return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
  };

  // Caches: a broken wall round a path floor. The lanes through it are its doors.
  for (const { d, i } of cacheAt) {
    const [x, y] = [xOf(i), yOf(i)];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!inside(x + dx, y + dy)) continue;
        const j = at(x + dx, y + dy);
        const wall = Math.abs(dx) === 2 || Math.abs(dy) === 2;
        const standing = roll(contentRng, 5) > 0;
        if (wall && standing && block(j, ROCK, d)) continue;
        if (owner[j] === d && tiles[j] === GRASS) tiles[j] = PATH;
      }
    }
  }

  // Dens: a floor of den ground with a rock wall at its back, away from the centre.
  const denRadius = size === "large" ? 3 : 2;
  for (const { d, i } of denAt) {
    const [ox, oy] = outward(i, d);
    for (const j of patch(i, denRadius)) {
      if (owner[j] === d && (tiles[j] === GRASS || tiles[j] === PATH)) tiles[j] = DEN;
    }
    tiles[i] = DEN;
    for (const j of patch(i, denRadius + 1)) {
      const [dx, dy] = [xOf(j) - xOf(i), yOf(j) - yOf(i)];
      if (dx * ox + dy * oy <= 0 || tiles[j] === DEN) continue;
      if (roll(denRng, 4) > 0) block(j, ROCK, d);
    }
  }

  // Seams: the tile one is worked from, with an outcrop of rock beside it.
  for (const { d, i } of seamAt) {
    const [ox, oy] = outward(i, d);
    if (inside(xOf(i) + ox, yOf(i) + oy)) block(at(xOf(i) + ox, yOf(i) + oy), ROCK, d);
  }

  // Cover: groves, ponds, outcrops and deep grass.
  for (const { d, terrain, i, r } of patches) {
    if (terrain === DEEP_GRASS) {
      for (const j of patch(i, r + 1))
        if (owner[j] !== -1 && tiles[j] === GRASS) tiles[j] = terrain;
      continue;
    }
    for (const j of patch(i, terrain === ROCK ? Math.min(r, 2) : r)) block(j, terrain, d);
  }

  // The edge of the map, in the biome's barrier: one tile deep on the horde's side
  // and thicker elsewhere.
  for (let i = 0; i < N; i++) {
    const [x, y] = [xOf(i), yOf(i)];
    if (x !== 0 && y !== 0 && x !== W - 1 && y !== H - 1) continue;
    if (!block(i, biome.wall)) continue;
    const facing = hx > 0 ? x === W - 1 : hx < 0 ? x === 0 : hy > 0 ? y === H - 1 : y === 0;
    grows[i] = facing ? 0 : spec.edge;
  }
  // Thickening: a barrier takes the ground next to it, where the noise allows.
  const KEEP: Readonly<Record<number, number>> = {
    [TREE]: 150,
    [DARK_TREE]: 160,
    [WATER]: 170,
    [ROCK]: 120,
  };
  for (let pass = Math.max(spec.edge, spec.wood, spec.river, 1); pass > 0; pass--) {
    const taking: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      if (kept[i] || owner[i] === -1 || !WALK.has(tiles[i] as number)) continue;
      let from = -1;
      for (const [dx, dy] of NEIGHBOURS) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (!inside(x, y)) continue;
        const j = at(x, y);
        if ((grows[j] as number) > (from === -1 ? 0 : (grows[from] as number))) from = j;
      }
      if (from === -1) continue;
      const terrain = tiles[from] as number;
      if ((rough[i] as number) < (KEEP[terrain] ?? 0))
        taking.push([i, terrain, grows[from] as number]);
    }
    for (const [i, terrain, left] of taking) if (block(i, terrain)) grows[i] = left - 1;
  }

  // Shores round open water, and worn paths from the ramp to each den and cache.
  for (let i = 0; i < N; i++) {
    if (tiles[i] !== GRASS && tiles[i] !== DEEP_GRASS) continue;
    if (
      NEIGHBOURS.some(
        ([dx, dy]) =>
          inside(xOf(i) + dx, yOf(i) + dy) && tiles[at(xOf(i) + dx, yOf(i) + dy)] === WATER,
      )
    )
      tiles[i] = SHORE;
  }
  const wear = (lane: readonly number[]): void => {
    for (const i of lane) {
      if (tiles[i] === GRASS || tiles[i] === DEEP_GRASS || tiles[i] === SHORE) tiles[i] = PATH;
    }
  };
  /** The tiles from a district's centre to the ramp, and the districts and passages on the way. */
  const wayHome = (from: number): { path: number[]; route: number[]; through: number[] } => {
    const path: number[] = [];
    const route = [from];
    const through: number[] = [];
    for (let d = from, n = 0; d !== 0 && n < count; n++) {
      const id = homeward[d] as number;
      const link = links[id] as Link;
      const forward = link.side.a === d;
      path.push(
        ...(forward ? link.laneA : link.laneB),
        ...(forward ? link.row : [...link.row].reverse()),
        ...[...(forward ? link.laneB : link.laneA)].reverse(),
      );
      d = forward ? link.side.b : link.side.a;
      route.push(d);
      through.push(id);
    }
    // Where two lanes meet at a centre the tile is listed once.
    return { path: path.filter((i, n) => n === 0 || i !== path[n - 1]), route, through };
  };
  [...denAt, ...cacheAt].forEach(({ d }, n) => {
    wear(spurs[n] as number[]);
    wear(wayHome(d).path);
  });

  // Levels by ring (docs/slice.md, section 1): a third of the landing's level,
  // the level, and the level plus what the size adds. The first is the most a
  // monster may be on the apron, the ground within APRON tiles of the ramp.
  const levels = [
    APRON_LEVEL,
    Math.max(1, Math.floor(level / 3)),
    level,
    Math.min(MAX_MONSTER_LEVEL, level + spec.far),
  ];
  const dens: Den[] = denAt.map(({ d, i }, n) => ({
    name: n === 0 ? "den" : `den_${n + 1}`,
    ...point(i),
    district: d,
    ring: ring[d] as number,
    level: levels[ring[d] as number] as number,
  }));
  const caches: Cache[] = cacheAt.map(({ d, i }, n) => ({
    name: n === 0 ? "cache" : `cache_${n + 1}`,
    ...point(i),
    district: d,
    ring: ring[d] as number,
    level: levels[ring[d] as number] as number,
  }));
  const seams: Seam[] = seamAt.map(({ d, i }) => ({
    ...point(i),
    district: d,
    ring: ring[d] as number,
  }));

  const entries: Entry[] = entryLanes.map(({ d, lane }) => {
    const home = wayHome(d);
    const inward = [...lane].reverse();
    // The city's own entry lane already ends at the ramp.
    const path = d === 0 ? inward : [...inward, ...home.path.slice(1)];
    return {
      ...point(inward[0] as number),
      district: d,
      route: home.route,
      passages: home.through,
      path: path.map(point),
    };
  });

  const toRect = (b: Box): Rect => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
  const districts: District[] = each.map((d) => ({
    id: d,
    ...point(centre[d] as number),
    ring: ring[d] as number,
    kind: kinds[d] as DistrictKind,
    bounds: toRect(
      d === 0
        ? home
        : (blocksOf[d] as number[])
            .map((b) => boxes[b] as Box)
            .reduce((all, box) => ({
              x0: Math.min(all.x0, box.x0),
              y0: Math.min(all.y0, box.y0),
              x1: Math.max(all.x1, box.x1),
              y1: Math.max(all.y1, box.y1),
            })),
    ),
    steps: steps[d] as number,
    distance: distance[d] as number,
    depth: depth[d] as number,
    passages: linksOf[d] as number[],
  }));
  const passages: Passage[] = links.map((link, id) => ({
    id,
    ...point(link.row[0] as number),
    a: link.side.a,
    b: link.side.b,
    kind: link.kind,
    tree: link.tree,
    tiles: link.gate.map(point),
  }));

  const places = [
    { name: "ramp", x: ramp.x, y: ramp.y },
    { name: "city", x: cx, y: cy },
    ...dens.map((d) => ({ name: d.name, x: d.x, y: d.y })),
    ...caches.map((c) => ({ name: c.name, x: c.x, y: c.y })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    name: `${size}_${biomeName}_${seed >>> 0}`,
    width: W,
    height: H,
    tiles,
    places,
    seed,
    size,
    biome: biomeName,
    element: biome.element,
    level,
    levels,
    city,
    ramp,
    horde,
    districts,
    passages,
    districtAt: owner,
    entries,
    dens,
    caches,
    seams,
  };
}

/** A fingerprint of a landing: every tile, place, den, cache, seam and the whole graph. */
export function hashLanding(landing: Landing): string {
  return hashInts([
    ...stringInts(landing.name),
    landing.seed,
    SIZE_CLASSES.indexOf(landing.size),
    BIOMES.indexOf(landing.biome),
    ELEMENTS.indexOf(landing.element),
    landing.level,
    ...landing.levels,
    landing.width,
    landing.height,
    ...landing.tiles,
    ...landing.places.flatMap((p) => [...stringInts(p.name), p.x, p.y]),
    landing.city.x,
    landing.city.y,
    landing.ramp.x,
    landing.ramp.y,
    EDGES.indexOf(landing.horde),
    landing.districts.length,
    ...landing.districts.flatMap((d) => [
      d.x,
      d.y,
      d.ring,
      DISTRICT_KINDS.indexOf(d.kind),
      d.bounds.x,
      d.bounds.y,
      d.bounds.width,
      d.bounds.height,
      d.steps,
      d.distance,
      d.depth,
      d.passages.length,
      ...d.passages,
    ]),
    landing.passages.length,
    ...landing.passages.flatMap((p) => [
      p.a,
      p.b,
      PASSAGE_KINDS.indexOf(p.kind),
      p.tree ? 1 : 0,
      p.x,
      p.y,
      p.tiles.length,
      ...p.tiles.flatMap((t) => [t.x, t.y]),
    ]),
    ...landing.districtAt,
    landing.entries.length,
    ...landing.entries.flatMap((e) => [
      e.x,
      e.y,
      e.district,
      e.route.length,
      ...e.route,
      ...e.passages,
      e.path.length,
      ...e.path.flatMap((t) => [t.x, t.y]),
    ]),
    landing.dens.length,
    ...landing.dens.flatMap((d) => [d.x, d.y, d.district, d.ring, d.level]),
    landing.caches.length,
    ...landing.caches.flatMap((c) => [c.x, c.y, c.district, c.ring, c.level]),
    landing.seams.length,
    ...landing.seams.flatMap((s) => [s.x, s.y, s.district, s.ring]),
  ]);
}

const SYMBOL: Readonly<Record<Terrain, string>> = {
  grass: ".",
  path: ":",
  camp: "c",
  shore: "s",
  deep_grass: ",",
  den: "d",
  bridge: "=",
  tree: "T",
  dark_tree: "t",
  water: "~",
  rock: "#",
  lantern: "L",
  campfire: "f",
  bank: "B",
  tent: "A",
};
const LETTERS = "0abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * A landing as text, one character a tile, with the horde's edge marked by a
 * line of arrows outside the map. Terrain as in content/maps. On top of it:
 * `+` a gate tile (`=` on a bridge, `%` on a ford), `'` a border taken out
 * for an open passage, R the ramp, H where the horde comes in, D a den, C a
 * cache and o a seam. Closed borders are the rock, trees and water between
 * districts.
 *
 * The `districts` view shows the graph instead: each tile as its district's
 * letter (0 for the city's), `#` for a border, `+` for a gate and `'` for an
 * opened border, and `@` at each district's centre. The `rings` view shows
 * each tile as its district's ring, 0 to 3.
 */
export function landingText(
  landing: Landing,
  view: "terrain" | "districts" | "rings" = "terrain",
): string {
  const index = (p: Point): number => p.y * landing.width + p.x;
  const gates = new Map<number, PassageKind>();
  for (const p of landing.passages) for (const t of p.tiles) gates.set(index(t), p.kind);
  const grid = landing.tiles.map((t, i) => {
    const district = landing.districtAt[i] as number;
    if (view === "terrain") return SYMBOL[TERRAINS[t] as Terrain];
    if (district === -1) return "#";
    return view === "rings"
      ? `${landing.districts[district]?.ring}`
      : (LETTERS[district % LETTERS.length] as string);
  });
  const put = (p: Point, c: string): void => {
    grid[index(p)] = c;
  };
  landing.tiles.forEach((t, i) => {
    const kind = gates.get(i);
    if (kind !== undefined) grid[i] = kind === "bridge" ? "=" : kind === "ford" ? "%" : "+";
    else if (landing.districtAt[i] === -1 && WALK.has(t)) grid[i] = "'";
  });
  if (view === "districts") for (const d of landing.districts) put(d, "@");
  if (view !== "districts") {
    for (const s of landing.seams) put(s, "o");
    for (const c of landing.caches) put(c, "C");
    for (const d of landing.dens) put(d, "D");
  }
  for (const e of landing.entries) put(e, "H");
  put(landing.ramp, "R");
  const rows: string[] = [];
  for (let y = 0; y < landing.height; y++) {
    rows.push(grid.slice(y * landing.width, (y + 1) * landing.width).join(""));
  }
  const across = (c: string): string => c.repeat(landing.width);
  const framed =
    landing.horde === "north"
      ? [across("v"), ...rows]
      : landing.horde === "south"
        ? [...rows, across("^")]
        : landing.horde === "east"
          ? rows.map((r) => `${r}<`)
          : rows.map((r) => `>${r}`);
  const rings = RINGS.slice(1).map(
    (name, k) => `${landing.districts.filter((d) => d.ring === k + 1).length} ${name}`,
  );
  const loops = landing.passages.filter((p) => !p.tree).length;
  const crossings = landing.passages.filter((p) => p.kind === "bridge" || p.kind === "ford").length;
  return [
    `${landing.size} ${landing.width}x${landing.height}, ${landing.biome} (element: ${landing.element}), seed ${landing.seed}, level ${landing.level}`,
    `horde from the ${landing.horde} by ${landing.entries.length} ${landing.entries.length === 1 ? "entry" : "entries"}; ${landing.dens.length} dens, ${landing.caches.length} caches, ${landing.seams.length} seams`,
    `districts: the city and ${rings.join(", ")}; passages: ${landing.passages.length - loops} on the tree and ${loops} loops, ${crossings} over the river`,
    `levels: apron ${landing.levels[0]} at most, ring 1 ${landing.levels[1]}, ring 2 ${landing.levels[2]}, ring 3 ${landing.levels[3]}`,
    `dens: ${landing.dens.map((d) => `${d.name} ring ${d.ring} level ${d.level}`).join("; ")}`,
    ...framed,
  ].join("\n");
}

/** The layout graph as text: a line a district, a line a passage, a line an entry. */
export function landingGraphText(landing: Landing): string {
  const letter = (d: number): string => LETTERS[d % LETTERS.length] as string;
  return [
    ...landing.districts.map(
      (d) =>
        `district ${letter(d.id)}: ring ${d.ring} ${d.kind} at (${d.x}, ${d.y}), ${d.steps} passages and ${d.distance} tiles from the ramp`,
    ),
    ...landing.passages.map(
      (p) =>
        `passage ${letter(p.a)}-${letter(p.b)}: ${p.kind}, ${p.tree ? "tree" : "loop"}, ${p.tiles.length / 2} wide at (${p.x}, ${p.y})`,
    ),
    ...landing.entries.map(
      (e) =>
        `entry at (${e.x}, ${e.y}): ${e.route.map(letter).join(" > ")}, ${e.path.length} tiles to the ramp`,
    ),
  ].join("\n");
}
