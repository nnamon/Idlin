// Lays the slice's monsters on landings by the rules of docs/slice.md, section 1,
// and prints the numbers that section quotes: the growth table, pockets, walks,
// rings, the march, posts, dens, the standing floor, the bubble's stations, and
// how much of each tier's share is laid at 15 and at 150 citizens awake. With
// --pace it prints the level table, the drops and what the siege pays; with
// --siege, the growing horde, how long a shield holds against a median and a
// strong roster at 15 and 150 awake and at sizes between, the strongest
// roster on every landing level, and the cycle that follows.
//
//   docker compose run --rm dev node packages/sim/scripts/plate.ts [seeds] [--landing <key>] [--generator] [--middle <arms>] [--few]
//   docker compose run --rm dev node packages/sim/scripts/plate.ts --map <key> <seed> [--generator]
//   docker compose run --rm dev node packages/sim/scripts/plate.ts --growth
//   docker compose run --rm dev node packages/sim/scripts/plate.ts --pace
//   docker compose run --rm dev node packages/sim/scripts/plate.ts --siege
//
// seeds is how many landings of each size, 100 by default. A landing's key is
// its city size and its class: 1s, 1m, 1l, 2s and so on to 4l (LANDINGS below).
// Without --landing it lays the slice's five landings, up to 80 by 45.
// Without --generator every landing is a stand-in: the bubble's footprint in
// the middle as the city's ground, with the hull in it and its ramp out of any
// side, a rim two tiles deep and a horde gap three wide on each side, cut into
// blocks and districts the way packages/sim/src/landing.ts cuts its maps
// (blocks, seeds by band, growth, a spanning tree of passages and loops,
// borders a tile thick, cover stamped without cutting the ground, dens and
// caches spread by passages), with straight borders and no river, and the
// city's ground open to every pocket beside it. --generator runs the same
// laying on generateLanding's maps, which have the slice's five landings with
// the bubble's footprint as the yard, open to every pocket beside it; there
// the pockets' levels, the dens, the chests, the piles, the seams, the
// shrines and the wrecks are the generator's. Maps over 80 by 45 wait for
// #418.
//
// The first city is laid at level 8 for a young crowd and the others at level
// 23 for the slice's worked crowd (CROWDS below). --middle moves the crowd's
// tier between the median and the strongest from Arms 40, and --few lays two
// citizens at Arms 23 instead. --map prints one landing with 15 awake. All of
// this is an estimate for the spec; the build pieces measure the real thing.

import { type CitySize, generateLanding, SIZES } from "../src/landing.ts";
import { TERRAINS } from "../src/map.ts";
import { createRng, nextInt, type Rng } from "../src/rng.ts";
import { XP_TABLE } from "../src/skills.ts";

const args = process.argv.slice(2);
const useGenerator = args.includes("--generator");
const landingArg = args.indexOf("--landing");
const onlyLanding = landingArg === -1 ? undefined : args[landingArg + 1];
const mapArg = args.indexOf("--map");
const seedCount =
  mapArg === -1
    ? Number(args.find((a, k) => /^\d+$/.test(a) && args[k - 1] !== "--middle") ?? 100)
    : 1;

// The rules, as docs/slice.md, section 1, gives them.
const TICKS_A_STEP = 4;
const RAMP_CLEAR = 8; // dens and chests stand more than this many tiles, in a straight line, from the ramp
const YARD_LEVEL = 5;
const LEGS_PLANT = 1_800;
const SIGHTING = 4_800; // 8:00: the front gathers, and a den's clock has let its last pack out
const MARCH = 5_400; // 9:00, with half of the scouts' calls made
const MARCH_TICKS = 750; // the front is at the bubble this long after it marches
const STRIP = 2; // the black stops this many tiles' walk short of the bubble until the break
const STATION_GAP = 1; // a station has no other station within this many tiles
const DEN_PACKS = 60;
const NEAR = 5; // levels a pack may be off its post's ground, or off its den's level
const POST_GAP = 3; // a post has no other post within this many tiles
const PAY_CAP = 500; // pay, in hundredths
const GUARD = 4; // a chest's, a shrine's or a wreck's guard: three pack monsters and a brute

// The picture inside the frame's rule at 1920 by 1080 (docs/art.md, section 11).
const PICTURE = [1_880, 1_040] as const;

type Cls = "small" | "medium" | "large";
interface LandingSpec {
  /** City size and class: 1s, 1m, 1l to 4l. */
  readonly key: string;
  readonly city: number;
  readonly cls: Cls;
  readonly width: number;
  readonly height: number;
  readonly block: number;
  readonly cell: number;
  readonly bands: number;
  readonly gate: number;
  readonly loops: number;
  readonly blob: readonly [number, number];
}
interface CitySpec {
  readonly hull: readonly [number, number];
  readonly legs: number;
  /** The ground the feet stand on, round the hull. */
  readonly feet: readonly [number, number];
  /** Tiles the bubble's edge stands clear of the feet on every side (docs/art.md, section 7). */
  readonly clear: number;
  /** How deep the front gathers along the rim before it marches (docs/art.md, section 3). */
  readonly gather: number;
}
/** The four city sizes of docs/slice.md, section 1. The slice builds the first two. */
const CITIES: readonly CitySpec[] = [
  { hull: [13, 6], legs: 6, feet: [19, 12], clear: 2, gather: 2 },
  { hull: [15, 6], legs: 8, feet: [21, 14], clear: 4, gather: 4 },
  { hull: [17, 7], legs: 8, feet: [23, 15], clear: 4, gather: 4 },
  { hull: [19, 8], legs: 10, feet: [25, 16], clear: 4, gather: 4 },
];
/** The bubble's footprint, in tiles: the feet and the clearance round them. */
const bubbleOf = (c: CitySpec): readonly [number, number] => [
  c.feet[0] + 2 * c.clear,
  c.feet[1] + 2 * c.clear,
];
/** Levels the far level is over the strongest citizen's Arms, by class. */
const FAR: Record<Cls, number> = { small: 7, medium: 10, large: 15 };
const cut52 = { block: 4, cell: 5, bands: 2, gate: 2, loops: 34, blob: [1, 2] } as const;
const cut60 = { block: 5, cell: 3, bands: 2, gate: 2, loops: 30, blob: [1, 2] } as const;
const cut68 = { block: 5, cell: 3, bands: 3, gate: 2, loops: 30, blob: [1, 2] } as const;
const cut80 = { block: 5, cell: 4, bands: 3, gate: 3, loops: 30, blob: [1, 3] } as const;
const cut96 = { block: 6, cell: 5, bands: 3, gate: 3, loops: 30, blob: [2, 4] } as const;
const cut112 = { block: 6, cell: 6, bands: 3, gate: 3, loops: 30, blob: [2, 4] } as const;
const cut128 = { block: 7, cell: 6, bands: 4, gate: 3, loops: 30, blob: [2, 4] } as const;
const LANDINGS: readonly LandingSpec[] = [
  { key: "1s", city: 1, cls: "small", width: 52, height: 29, ...cut52 },
  { key: "1m", city: 1, cls: "medium", width: 56, height: 31, ...cut52 },
  { key: "1l", city: 1, cls: "large", width: 60, height: 33, ...cut60 },
  { key: "2s", city: 2, cls: "small", width: 68, height: 38, ...cut68 },
  { key: "2m", city: 2, cls: "medium", width: 80, height: 45, ...cut80 },
  { key: "2l", city: 2, cls: "large", width: 96, height: 54, ...cut96 },
  { key: "3s", city: 3, cls: "small", width: 80, height: 45, ...cut80 },
  { key: "3m", city: 3, cls: "medium", width: 96, height: 54, ...cut96 },
  { key: "3l", city: 3, cls: "large", width: 112, height: 63, ...cut112 },
  { key: "4s", city: 4, cls: "small", width: 96, height: 54, ...cut96 },
  { key: "4m", city: 4, cls: "medium", width: 112, height: 63, ...cut112 },
  { key: "4l", city: 4, cls: "large", width: 128, height: 72, ...cut128 },
];
const tilesOf = (l: LandingSpec): number => l.width * l.height;
const cityOf = (l: LandingSpec): CitySpec => CITIES[l.city - 1] as CitySpec;
const nearest = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));
/** The slice's maps are those up to 80 by 45; the counts past that wait for #418. */
const SLICE_TILES = 3_600;
/** What stands on the plate at legs-plant: 30 monsters for each 180 tiles, 600 on 80 by 45. */
const roomOf = (l: LandingSpec): number => Math.floor((tilesOf(l) * 30) / 180);
/** Dens let nothing out while the plate holds this many, and it holds at most 50 more. */
const gateOf = (l: LandingSpec): number => roomOf(l) + 50;
const capOf = (l: LandingSpec): number => roomOf(l) + 100;
const densOf = (l: LandingSpec): number => nearest(tilesOf(l), 700);
const chestsOf = (l: LandingSpec): number => Math.max(1, nearest(tilesOf(l), 1_100));
const shrinesOf = (l: LandingSpec): number => Math.max(1, nearest(tilesOf(l), 1_800));
const wrecksOf = (l: LandingSpec): number => Math.floor(tilesOf(l) / 1_800);
const pilesOf = (l: LandingSpec): number => Math.floor(tilesOf(l) / 100);
const seamsOf = (l: LandingSpec): number => Math.floor(tilesOf(l) / 150);
/** Pixels a tile at 1920 with the whole landing inside the rule. */
const tilePx = (l: LandingSpec): number =>
  Math.floor(Math.min(PICTURE[0] / l.width, PICTURE[1] / l.height));
/** A citizen's height by the camera, on the straight line between docs/art.md's columns (section 5). */
const ART_HEIGHTS: readonly (readonly [number, number])[] = [
  [14, 40],
  [17, 42],
  [23, 46],
  [31, 58],
  [47, 76],
  [66, 96],
  [100, 120],
];
const citizenPx = (l: LandingSpec): number => {
  const px = tilePx(l);
  for (let k = 1; k < ART_HEIGHTS.length; k++) {
    const [a, ha] = ART_HEIGHTS[k - 1] as [number, number];
    const [b, hb] = ART_HEIGHTS[k] as [number, number];
    if (px <= b) return Math.round(ha + ((hb - ha) * (Math.max(px, a) - a)) / (b - a));
  }
  return 120;
};
const RIM = 2;
const MIN_BLOCK = 4;
const BIOMES = ["meadow", "pinewood", "fen", "crags", "ash_waste"] as const;

/** What the laying needs of a landing. */
interface Ground {
  readonly width: number;
  readonly height: number;
  readonly open: boolean[];
  /** The district of each tile: 0 the city's, 1 and up a pocket, -1 anything else. */
  readonly district: number[];
  readonly pockets: number;
  readonly ramp: number;
  /** The middle of the city's footprint. */
  readonly middle: number;
  /** The tile just inside each horde gap. */
  readonly gaps: number[];
  /** The size's own dens, then the roster's. */
  readonly dens: number[];
  /** How many of `dens` are the size's own. */
  readonly ownDens: number;
  /** The den at ring 1's near end, or -1. */
  readonly nearDen: number;
  readonly chests: number[];
  readonly piles: number[];
  /** On generateLanding's maps, each district's ring and level as the generator set them. */
  readonly levels?: { readonly ring: number[]; readonly level: number[] };
  /** On generateLanding's maps, the shrines, wrecks and seams of ore the generator stood. */
  readonly holds?: {
    readonly shrines: number[];
    readonly wrecks: number[];
    readonly seams: number[];
  };
  /**
   * On generateLanding's maps, the strip round the yard: open ground in no
   * district, which counts as ground like a pocket's.
   */
  readonly strip?: boolean[];
}

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
const STEPS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const num = (list: readonly number[], i: number): number => list[i] as number;
const roll = (rng: Rng, bound: number): number => nextInt(rng, Math.max(1, bound));
function shuffle<V>(rng: Rng, list: V[]): V[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [list[i], list[j]] = [list[j] as V, list[i] as V];
  }
  return list;
}

/** Walk distances in steps from some tiles over open tiles, 4-connected; -1 where none. */
function walkFrom(width: number, height: number, open: readonly boolean[], starts: number[]) {
  const dist: number[] = new Array(width * height).fill(-1);
  const queue = [...starts];
  for (const s of starts) dist[s] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = num(queue, head);
    const [x, y] = [i % width, Math.floor(i / width)];
    for (const [dx, dy] of STEPS) {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!open[j] || num(dist, j) !== -1) continue;
      dist[j] = num(dist, i) + 1;
      queue.push(j);
    }
  }
  return { dist, order: queue };
}

/** A stand-in for #399's maps, cut the way landing.ts cuts its maps. */
function standIn(spec: LandingSpec, seed: number, extra: number): Ground {
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  const rng = createRng((seed * 7_919 + LANDINGS.indexOf(spec) * 104_729) | 0);
  const at = (x: number, y: number): number => y * W + x;
  const xOf = (i: number): number => i % W;
  const yOf = (i: number): number => Math.floor(i / W);
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;

  // The city's ground in the middle is the bubble's footprint: the ground the
  // feet stand on and the bubble's clearance round it, with the hull in its
  // middle and the ramp out of the middle of any side, its foot two tiles out.
  // The stand-in's bubble is square-cornered; the spec rounds its corners.
  const [hullW, hullH] = cityOf(spec).hull;
  const [bubW, bubH] = bubbleOf(cityOf(spec));
  const homeX = (W - bubW) >> 1;
  const homeY = (H - bubH) >> 1;
  const home = { x0: homeX, y0: homeY, x1: homeX + bubW, y1: homeY + bubH };
  if (Math.min(home.x0, home.y0) - RIM < MIN_BLOCK)
    throw new Error(`${spec.key}: no room for blocks on every side of the city`);
  const city = {
    x0: home.x0 + ((bubW - hullW) >> 1),
    x1: home.x0 + ((bubW - hullW) >> 1) + hullW,
    y0: home.y0 + ((bubH - hullH) >> 1),
    y1: home.y0 + ((bubH - hullH) >> 1) + hullH,
  };
  const cx = city.x0 + (hullW >> 1);
  const cy = city.y0 + (hullH >> 1);
  const rampSide = roll(rng, 4); // north, east, south, west
  const ramp = num(
    [at(cx, city.y0 - 2), at(city.x1 + 1, cy), at(cx, city.y1 + 1), at(city.x0 - 2, cy)],
    rampSide,
  );
  const lo = RIM;
  const hiX = W - RIM;
  const hiY = H - RIM;

  // 1. Blocks.
  const cut = (from: number, to: number): number[] => {
    const length = to - from;
    if (length <= 0) return [];
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
      const least = last + MIN_BLOCK;
      const most = length - MIN_BLOCK * (n - i);
      last = Math.max(least, Math.min(most, Math.floor((length * i) / n) + roll(rng, 3) - 1));
      ends.push(from + last);
    }
    ends.push(to);
    return ends;
  };
  const xs = [lo, ...cut(lo, home.x0), ...cut(home.x0, home.x1), ...cut(home.x1, hiX)];
  const ys = [lo, ...cut(lo, home.y0), ...cut(home.y0, home.y1), ...cut(home.y1, hiY)];
  const gw = xs.length - 1;
  const gh = ys.length - 1;
  const B = gw * gh;
  const box = (b: number) => ({
    x0: num(xs, b % gw),
    x1: num(xs, (b % gw) + 1),
    y0: num(ys, Math.floor(b / gw)),
    y1: num(ys, Math.floor(b / gw) + 1),
  });
  const beside = (b: number, steps: readonly (readonly [number, number])[]): number[] => {
    const out: number[] = [];
    for (const [dx, dy] of steps) {
      const [i, j] = [(b % gw) + dx, Math.floor(b / gw) + dy];
      if (i >= 0 && j >= 0 && i < gw && j < gh) out.push(j * gw + i);
    }
    return out;
  };
  const districtOf: number[] = Array.from({ length: B }, (_, b) => {
    const k = box(b);
    return k.x0 >= home.x0 && k.x1 <= home.x1 && k.y0 >= home.y0 && k.y1 <= home.y1 ? 0 : -1;
  });
  const free = districtOf.flatMap((d, b) => (d === -1 ? [b] : []));

  // 2. Districts: bands out from the city, seeds farthest from the seeds before
  // them, then turns at adding a free block beside one a district has.
  const out: number[] = districtOf.map((d) => (d === 0 ? 0 : -1));
  const ordered = districtOf.flatMap((d, b) => (d === 0 ? [b] : []));
  for (let head = 0; head < ordered.length; head++) {
    const b = num(ordered, head);
    for (const c of beside(b, AROUND)) {
      if (num(out, c) !== -1) continue;
      out[c] = num(out, b) + 1;
      ordered.push(c);
    }
  }
  const farthest = Math.max(1, ...out);
  const band = out.map((s) => (s === 0 ? 0 : 1 + Math.floor(((s - 1) * spec.bands) / farthest)));
  const rank: number[] = new Array(B).fill(0);
  shuffle(
    rng,
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
      if (best === -1 || gap > bestGap || (gap === bestGap && num(rank, b) < num(rank, best)))
        [best, bestGap] = [b, gap];
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
  // A piece of the map the city cuts off from the rest gets a seed of its own.
  const piece: number[] = new Array(B).fill(-1);
  for (const start of free) {
    if (num(piece, start) !== -1) continue;
    const members = [start];
    piece[start] = start;
    for (let head = 0; head < members.length; head++) {
      for (const c of beside(num(members, head), STEPS)) {
        if (num(districtOf, c) !== -1 || num(piece, c) !== -1) continue;
        piece[c] = start;
        members.push(c);
      }
    }
    if (!members.some((b) => seeds.includes(b))) seed1(members, num(band, start));
  }
  const count = seeds.length + 1;
  const blocksOf: number[][] = Array.from({ length: count }, (_, d) =>
    d === 0 ? [] : [num(seeds, d - 1)],
  );
  seeds.forEach((b, n) => {
    districtOf[b] = n + 1;
  });
  for (let round = 0, grew = true; grew && round < free.length; round++) {
    grew = false;
    for (let d = 1; d < count; d++) {
      let best = -1;
      let bestScore = 0;
      for (const b of blocksOf[d] as number[]) {
        for (const c of beside(b, STEPS)) {
          if (num(districtOf, c) !== -1) continue;
          const score = Math.abs(num(band, c) - num(bandOf, d)) * B + num(rank, c);
          if (best === -1 || score < bestScore) [best, bestScore] = [c, score];
        }
      }
      if (best === -1) continue;
      grew = true;
      districtOf[best] = d;
      (blocksOf[d] as number[]).push(best);
    }
  }

  // 3. Ground: a tile is its block's district's. A tile with a lower-numbered
  // pocket among the eight round it is border, so two pockets never touch. The
  // city's ground has no border: every pocket beside it opens onto it along
  // their whole shared side, so the bubble has ground outside it on every side
  // (#416 asks this of the generator).
  const blockUnder: number[] = new Array(N).fill(-1);
  for (let y = lo, j = 0; y < hiY; y++) {
    if (num(ys, j + 1) <= y) j++;
    for (let x = lo, i = 0; x < hiX; x++) {
      if (num(xs, i + 1) <= x) i++;
      blockUnder[at(x, y)] = j * gw + i;
    }
  }
  const raw: number[] = blockUnder.map((b) => (b === -1 ? -1 : num(districtOf, b)));
  const district: number[] = [...raw];
  for (let i = 0; i < N; i++) {
    const a = num(raw, i);
    if (a < 0) continue;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const b = num(raw, at(x, y));
      if (b > 0 && b < a) district[i] = -1;
    }
  }
  const open: boolean[] = district.map((d) => d >= 0);
  for (let y = city.y0; y < city.y1; y++)
    for (let x = city.x0; x < city.x1; x++) open[at(x, y)] = false;
  const gateTile: boolean[] = new Array(N).fill(false);

  // 4. Passages: a spanning tree grown from the city, near bands first, and
  // loops where they close the longest detours. Each gets a gate on a block
  // side its two districts share, cut through the border.
  const sides = new Map<number, [number, number][]>();
  const key = (a: number, b: number): number => Math.min(a, b) * 64 + Math.max(a, b);
  for (let b = 0; b < B; b++) {
    for (const c of [b % gw === gw - 1 ? -1 : b + 1, b + gw < B ? b + gw : -1]) {
      if (c === -1) continue;
      const [da, db] = [num(districtOf, b), num(districtOf, c)];
      if (da === db || da < 0 || db < 0) continue;
      const list = sides.get(key(da, db)) ?? [];
      list.push([b, c]);
      sides.set(key(da, db), list);
    }
  }
  const pairs = [...sides.keys()].sort((p, q) => p - q);
  const weight = new Map(pairs.map((p) => [p, roll(rng, 1000)]));
  const inTree = new Set([0]);
  const tree: number[] = [];
  while (inTree.size < count) {
    let best = -1;
    let bestScore = 0;
    for (const p of pairs) {
      const [a, b] = [Math.floor(p / 64), p % 64];
      if (inTree.has(a) === inTree.has(b)) continue;
      const score = Math.max(num(bandOf, a), num(bandOf, b)) * 1000 + (weight.get(p) as number);
      if (best === -1 || score < bestScore) [best, bestScore] = [p, score];
    }
    if (best === -1) break;
    tree.push(best);
    inTree.add(Math.floor(best / 64));
    inTree.add(best % 64);
  }
  const hops = (links: readonly number[], from: number): number[] => {
    const h: number[] = new Array(count).fill(-1);
    h[from] = 0;
    const queue = [from];
    for (let head = 0; head < queue.length; head++) {
      const d = num(queue, head);
      for (const p of links) {
        const [a, b] = [Math.floor(p / 64), p % 64];
        const next = a === d ? b : b === d ? a : -1;
        if (next === -1 || num(h, next) !== -1) continue;
        h[next] = num(h, d) + 1;
        queue.push(next);
      }
    }
    return h;
  };
  const loopsWanted = Math.floor((spec.loops * (count - 1) + 50) / 100);
  const spare = pairs
    .filter((p) => !tree.includes(p))
    .map((p) => ({ p, detour: num(hops(tree, Math.floor(p / 64)), p % 64), tie: roll(rng, 1000) }))
    .sort((u, v) => v.detour - u.detour || u.tie - v.tie);
  const links = [...tree, ...spare.slice(0, loopsWanted).map((s) => s.p)];
  for (const p of links) {
    const choices = sides.get(p) as [number, number][];
    const [b, c] = choices[roll(rng, choices.length)] as [number, number];
    const kb = box(b);
    const kc = box(c);
    const upright = kc.x0 === kb.x1; // c is to the right of b
    const span = upright ? [kb.y0, kb.y1] : [kb.x0, kb.x1];
    const length = num(span, 1) - num(span, 0);
    const width = Math.max(1, Math.min(spec.gate, length - 2));
    const start = num(span, 0) + 1 + roll(rng, length - 2 - width + 1);
    for (let k = start; k < start + width; k++) {
      for (const t of upright
        ? [at(kb.x1 - 1, k), at(kb.x1, k)]
        : [at(k, kb.y1 - 1), at(k, kb.y1)]) {
        if (district[t] === -1) {
          gateTile[t] = true;
          open[t] = true;
        }
      }
    }
  }

  // 5. The rim's gaps, three tiles wide, one a side near its middle, into a
  // pocket where the ground inside allows and onto the city's ground where it
  // does not.
  const gaps: number[] = [];
  for (let side = 0; side < 4; side++) {
    const along = side === 0 || side === 2 ? W : H;
    const inner = (p: number): number =>
      side === 0
        ? at(p, RIM)
        : side === 1
          ? at(W - RIM - 1, p)
          : side === 2
            ? at(p, H - RIM - 1)
            : at(RIM, p);
    const fits = (p: number, pocket: boolean): boolean =>
      [p - 1, p, p + 1].every((q) => open[inner(q)] && num(district, inner(q)) >= (pocket ? 1 : 0));
    const middle = (along >> 1) + roll(rng, 7) - 3;
    let found = -1;
    for (const pocket of [true, false]) {
      for (let off = 0; off < along && found === -1; off++) {
        for (const p of [middle - off, middle + off]) {
          if (found === -1 && p > RIM && p < along - RIM - 1 && fits(p, pocket)) found = p;
        }
      }
    }
    if (found === -1) continue;
    gaps.push(inner(found));
    for (const q of [found - 1, found, found + 1]) {
      for (let depth = 1; depth <= RIM; depth++) {
        const t =
          side === 0
            ? at(q, RIM - depth)
            : side === 1
              ? at(W - RIM - 1 + depth, q)
              : side === 2
                ? at(q, H - RIM - 1 + depth)
                : at(RIM - depth, q);
        open[t] = true;
      }
    }
  }

  // 6. Cover in each pocket: tiles turned only where the open ground round
  // them stays joined, so nothing is cut off.
  const isGateNear = (i: number): boolean =>
    AROUND.some(
      ([dx, dy]) => inside(xOf(i) + dx, yOf(i) + dy) && gateTile[at(xOf(i) + dx, yOf(i) + dy)],
    );
  const simple = (i: number): boolean => {
    const ring = AROUND.map(([dx, dy]) => {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      return inside(x, y) && (open[at(x, y)] as boolean);
    });
    const arcs: number[] = new Array(8).fill(-1);
    let arc = -1;
    const startAt = ring.indexOf(false);
    if (startAt === -1) return true;
    for (let k = 1; k <= 8; k++) {
      const n = (startAt + k) % 8;
      if (!ring[n]) continue;
      if (!ring[(n + 7) % 8]) arc++;
      arcs[n] = arc;
    }
    const sideArcs = new Set([0, 2, 4, 6].filter((n) => ring[n]).map((n) => arcs[n]));
    return sideArcs.size <= 1;
  };
  const centreOf = (d: number): number => {
    const tiles = district.flatMap((dd, i) => (dd === d && open[i] ? [i] : []));
    if (tiles.length === 0) return -1;
    const mx = tiles.reduce((s, i) => s + xOf(i), 0) / tiles.length;
    const my = tiles.reduce((s, i) => s + yOf(i), 0) / tiles.length;
    let best = num(tiles, 0);
    for (const i of tiles)
      if ((xOf(i) - mx) ** 2 + (yOf(i) - my) ** 2 < (xOf(best) - mx) ** 2 + (yOf(best) - my) ** 2)
        best = i;
    return best;
  };
  // Lanes, which cover never takes: the way from the ramp to every gate, every
  // gap and the middle of every pocket.
  const lane = new Set<number>();
  const fromRamp = walkFrom(W, H, open, [ramp]).dist;
  const trace = (to: number): void => {
    for (let i = to; num(fromRamp, i) > 0; ) {
      lane.add(i);
      const here = num(fromRamp, i);
      const back = STEPS.map(([dx, dy]) => [xOf(i) + dx, yOf(i) + dy] as const)
        .filter(([x, y]) => inside(x, y) && num(fromRamp, at(x, y)) === here - 1)
        .map(([x, y]) => at(x, y));
      i = Math.min(...back);
    }
  };
  for (let i = 0; i < N; i++) if (gateTile[i] && num(fromRamp, i) > 0) trace(i);
  for (const g of gaps) if (num(fromRamp, g) > 0) trace(g);
  for (let d = 1; d < count; d++) {
    const c = centreOf(d);
    if (c !== -1 && num(fromRamp, c) > 0) trace(c);
  }
  for (let d = 1; d < count; d++) {
    const tiles = district.flatMap((dd, i) => (dd === d && open[i] ? [i] : []));
    if (tiles.length === 0) continue;
    const patches = roll(rng, 3);
    for (let n = 0; n < patches; n++) {
      const centre = num(tiles, roll(rng, tiles.length));
      const r = spec.blob[0] + roll(rng, spec.blob[1] - spec.blob[0] + 1);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const [x, y] = [xOf(centre) + dx, yOf(centre) + dy];
          if (!inside(x, y)) continue;
          const i = at(x, y);
          if (district[i] !== d || !open[i] || lane.has(i) || isGateNear(i) || !simple(i)) continue;
          open[i] = false;
        }
      }
    }
  }
  // Anything the ramp cannot reach is closed. The rules above leave none.
  const reach = walkFrom(W, H, open, [ramp]).dist;
  for (let i = 0; i < N; i++) if (open[i] && num(reach, i) === -1) open[i] = false;

  // 7. Dens, chests and piles, as landing.ts stands them: each in the pocket
  // with the most passages between it and everything stood so far, then the
  // deepest, in the ring whose turn it is; never within 8 tiles of the ramp.
  // A district's ring is the third of the walk out from the yard that its
  // centre lies in.
  const pockets = count - 1;
  const fromYard = walkFrom(
    W,
    H,
    open,
    district.flatMap((d, i) => (d === 0 && open[i] ? [i] : [])),
  ).dist;
  const outmost = Math.max(
    1,
    ...district.map((d, i) => (d >= 0 && open[i] ? num(fromYard, i) : 0)),
  );
  const depth = Array.from({ length: count }, (_, d) => {
    const c = centreOf(d);
    return c === -1 ? 0 : Math.floor((num(fromYard, c) * 1000) / outmost);
  });
  const ring = depth.map((deep, d) =>
    d === 0 ? 0 : Math.min(3, 1 + Math.floor((deep * 3) / 1000)),
  );
  const apart = Array.from({ length: count }, (_, d) => hops(links, d));
  const order: number[][] = Array.from({ length: count }, (_, d) =>
    shuffle(
      rng,
      district.flatMap((dd, i) =>
        dd === d &&
        open[i] &&
        AROUND.every(([dx, dy]) => {
          const j = at(xOf(i) + dx, yOf(i) + dy);
          return district[j] === d && open[j];
        })
          ? [i]
          : [],
      ),
    ),
  );
  const taken = new Set<number>();
  const beyond = (i: number): boolean =>
    Math.abs(xOf(i) - xOf(ramp)) + Math.abs(yOf(i) - yOf(ramp)) > RAMP_CLEAR;
  const next = (d: number, far: boolean): number =>
    (order[d] as number[]).find((i) => !taken.has(i) && (!far || beyond(i))) ?? -1;
  const outer = Array.from({ length: pockets }, (_, n) => n + 1);
  const picked = [0];
  const RING_TURN = [3, 2, 3, 2, 1];
  const turn = (k: number, d: number): number =>
    ring[d] === RING_TURN[k % RING_TURN.length] ? 0 : 2;
  /** Stands n things, the kth on turn `from + k`, never in a pocket of `avoid`, which gains each pocket used. */
  const spread = (
    n: number,
    from: number,
    unfit: (k: number, d: number) => number,
    avoid: Set<number> | null,
  ): number[] => {
    const found: number[] = [];
    for (let k = from; k < from + n; k++) {
      const can = outer.filter((d) => next(d, true) !== -1 && !avoid?.has(d));
      if (can.length === 0) break;
      const least = Math.min(...can.map((d) => unfit(k, d)));
      const pool = can.filter((d) => unfit(k, d) === least);
      const fresh = pool.filter((d) => !picked.includes(d));
      let best = -1;
      let bestGap = -1;
      for (const d of fresh.length > 0 ? fresh : pool) {
        const gap = Math.min(...picked.map((p) => num(apart[p] as number[], d)));
        if (best === -1 || gap > bestGap || (gap === bestGap && num(depth, d) > num(depth, best)))
          [best, bestGap] = [d, gap];
      }
      const i = next(best, true);
      taken.add(i);
      found.push(i);
      picked.push(best);
      avoid?.add(best);
    }
    return found;
  };
  // A pocket holds one den at most, so a landing with more dens due than
  // pockets has one in each. The first den the roster adds stands at ring 1's
  // near end: on the tile of a pocket with no den nearest the yard by the walk
  // out of it, then the lower tile number.
  const denned = new Set<number>();
  const ownDens = densOf(spec);
  const dens = spread(ownDens, 0, turn, denned);
  let nearTile = -1;
  if (extra > 0) {
    let best = -1;
    for (const d of outer) {
      if (denned.has(d)) continue;
      for (const i of order[d] as number[]) {
        if (taken.has(i) || !beyond(i)) continue;
        const [e, eb] = [num(fromYard, i), best === -1 ? 0 : num(fromYard, best)];
        if (best === -1 || e < eb || (e === eb && i < best)) best = i;
      }
    }
    if (best !== -1) {
      taken.add(best);
      picked.push(num(district, best));
      denned.add(num(district, best));
      dens.push(best);
      nearTile = best;
    }
  }
  dens.push(...spread(ownDens + extra - dens.length, dens.length, turn, denned));
  const chests = spread(
    chestsOf(spec) + extra,
    0,
    (k, d) => turn(k, d) + (denned.has(d) ? 1 : 0),
    null,
  );
  // Piles are shared out by the blocks a pocket has, among the pockets with
  // no den while any of them has room.
  const held: number[] = new Array(count).fill(0);
  const sizeOf = (d: number): number => (blocksOf[d] as number[]).length;
  const piles: number[] = [];
  for (let n = 0; n < pilesOf(spec); n++) {
    let best = -1;
    const roomy = outer.some((d) => !denned.has(d) && next(d, false) !== -1);
    for (const d of outer) {
      if (next(d, false) === -1 || (roomy && denned.has(d))) continue;
      const share = (e: number): number => Math.floor((sizeOf(e) * 1000) / (num(held, e) + 1));
      if (best === -1 || share(d) > share(best)) best = d;
    }
    if (best === -1) break;
    held[best] = num(held, best) + 1;
    const i = next(best, false);
    taken.add(i);
    piles.push(i);
  }
  return {
    width: W,
    height: H,
    open,
    district,
    pockets,
    ramp,
    middle: at(cx, cy),
    gaps,
    dens,
    ownDens,
    nearDen: nearTile,
    chests,
    piles,
  };
}

/** Whether generateLanding has a map of this city size and class. */
const hasGenerator = (l: LandingSpec): boolean => SIZES[l.city as CitySize]?.[l.cls] !== undefined;

/** generateLanding's map, with the city's footprint closed, for --generator. */
function generatorGround(spec: LandingSpec, seed: number, extra: number, far: number): Ground {
  const landing = generateLanding({
    seed,
    city: spec.city,
    size: spec.cls,
    biome: BIOMES[seed % BIOMES.length],
    level: levelOfLanding(spec),
    far,
    extraDens: extra,
    extraCaches: extra,
  });
  const W = landing.width;
  const walkable = new Set(["grass", "path", "camp", "shore", "deep_grass", "den", "bridge"]);
  const open = landing.tiles.map((t) => walkable.has(TERRAINS[t] as string));
  const { city } = landing;
  for (let y = city.y; y < city.y + city.height; y++)
    for (let x = city.x; x < city.x + city.width; x++) open[y * W + x] = false;
  const fromYard = walkFrom(
    W,
    landing.height,
    open,
    landing.districtAt.flatMap((d, i) => (d === 0 && open[i] ? [i] : [])),
  ).dist;
  return {
    strip: landing.districtAt.map(
      (d, i) => d === -1 && num(fromYard, i) >= 1 && num(fromYard, i) <= STRIP,
    ),
    width: W,
    height: landing.height,
    open,
    district: [...landing.districtAt],
    pockets: landing.districts.length - 1,
    ramp: landing.ramp.y * W + landing.ramp.x,
    middle: (city.y + (city.height >> 1)) * W + city.x + (city.width >> 1),
    gaps: landing.entries.map((e) => e.y * W + e.x),
    dens: landing.dens.map((d) => d.y * W + d.x),
    ownDens: densOf(spec),
    // The size's own dens come first, then the caller's, the first of them the near den.
    nearDen: (() => {
      const near = extra > 0 ? landing.dens[densOf(spec)] : undefined;
      return near === undefined ? -1 : near.y * W + near.x;
    })(),
    chests: landing.caches.map((c) => c.y * W + c.x),
    piles: landing.piles.map((s) => s.y * W + s.x),
    levels: {
      ring: landing.districts.map((d) => d.ring),
      level: landing.districts.map((d) => d.level),
    },
    holds: {
      shrines: landing.shrines.map((s) => s.y * W + s.x),
      wrecks: landing.wrecks.map((s) => s.y * W + s.x),
      seams: landing.seams.map((s) => s.y * W + s.x),
    },
  };
}

// The packs: a swarm is 10 fodder and a pack monster leading, a pack 3 pack
// monsters and a brute leading, a brute pack 3 brutes. Rank weights 1, 3 and 12.
const KINDS = {
  S: { monsters: 11, weight: 13 },
  P: { monsters: 4, weight: 21 },
  B: { monsters: 3, weight: 36 },
} as const;
type Kind = keyof typeof KINDS;
const ORDER: readonly (readonly [Kind, number])[] = [
  ["S", 0],
  ["P", 0],
  ["S", 0],
  ["S", 0],
  ["B", 0],
  ["S", 5],
  ["P", 0],
  ["S", 0],
  ["P", 5],
  ["S", 10],
];
/** A share in hundredths of a pack: a third of Arms, 20 at least, to the nearest hundredth. */
const shareOf = (arms: number): number => Math.floor((200 * Math.max(arms, 20) + 3) / 6);

interface Crowd {
  readonly name: string;
  readonly tiers: readonly (readonly [number, number])[]; // Arms, citizens
}
/**
 * The first city has young citizens and a low landing: it is built over in
 * about seven hours of stream, by when plan.md's table has nobody past level
 * 20. The crowds for the later cities are the slice's worked ones.
 */
const YOUNG_LEVEL = 8;
const YOUNG_CROWDS: readonly Crowd[] = [
  {
    name: "15",
    tiers: [
      [3, 3],
      [8, 9],
      [15, 3],
    ],
  },
  {
    name: "150",
    tiers: [
      [3, 30],
      [8, 90],
      [15, 30],
    ],
  },
];
const levelOfLanding = (l: LandingSpec): number => (l.city === 1 ? YOUNG_LEVEL : 23);
// --middle <arms> moves the tier between the median and the strongest, which
// is 40 in the worked crowd, so the tiers over the median can be measured at
// any level. --few lays a roster of two at Arms 23 instead.
const middleArg = args.indexOf("--middle");
const MIDDLE = middleArg === -1 ? 40 : Number(args[middleArg + 1]);
const FEW: readonly Crowd[] = [{ name: "2", tiers: [[23, 2]] }];
const crowdsOf = (l: LandingSpec): readonly Crowd[] =>
  args.includes("--few") ? FEW : l.city === 1 ? YOUNG_CROWDS : CROWDS;
const CROWDS: readonly Crowd[] = [
  {
    name: "15",
    tiers: [
      [6, 2],
      [23, 10],
      [MIDDLE, 2],
      [58, 1],
    ],
  },
  {
    name: "150",
    tiers: [
      [6, 30],
      [23, 90],
      [MIDDLE, 20],
      [58, 10],
    ],
  },
];
const awakeOf = (crowd: Crowd): number => crowd.tiers.reduce((s, [, n]) => s + n, 0);
/** One den and one chest more for each 15 awake, rounded up. */
const extraOf = (crowd: Crowd): number => Math.ceil(awakeOf(crowd) / 15);

interface Pack {
  readonly kind: Kind;
  /** The level its share gave it, before a post's ground changed it. */
  readonly due: number;
  level: number;
  where: "post" | "den" | "none";
  tile: number;
  den: number;
}

interface TierResult {
  shareMonsters: number[];
  standing: number[];
  waiting: number[];
  whole: number[];
  laid: number[];
  pay: number[];
  capped: number;
  paid: number[];
  walk: number[];
  denWalk: number[];
  covered: number[];
  /** Monsters of its share at 65 or more: due, and laid. */
  highDue: number;
  highLaid: number;
}

interface LandingResult {
  pockets: number;
  sides: number;
  longest: number;
  outmost: number;
  ring1: number;
  ring2: number;
  inner3: number;
  posts: number;
  postTiles: number[];
  denTiles: number[];
  denPostCounts: number[];
  topElite: number;
  topChest: number;
  levelOf: number[];
  piles: number;
  dens: number;
  chests: number;
  chestTiles: number[];
  newcomerTiles: number;
  newcomerPosts: number;
  nearDenWalk: number;
  standingAtPlant: number;
  /** Monsters of the map's own packs, and those of them at 65 or more. */
  ownMonsters: number;
  ownHigh: number;
  ownTiles: number[];
  /** The posts a share's pack stands on at legs-plant. */
  shareTiles: number[];
  /** The smaller side's part of what stands, with the map cut across and cut down through the city. */
  lightHalf: number;
  stations: number;
  edge: number;
  denLetters: string[];
  denLevels: number[];
  shrineTiles: number[];
  wreckTiles: number[];
  seamTiles: number[];
  waitingInDens: number;
  denPacks: number[];
  denInterval: number[];
  denCovered: number[];
  farHalf: number;
  farAll: number;
  farBehind: number;
  ringTaken: number[];
  takenShare: number[];
  islands: number;
  frontPace: number[];
  tiers: Map<number, TierResult>;
}

/** Lays one crowd on one landing by section 1's rules and measures it. */
function lay(ground: Ground, spec: LandingSpec, crowd: Crowd, seed: number): LandingResult {
  const W = ground.width;
  const H = ground.height;
  const N = W * H;
  const { open, district } = ground;
  const LEVEL = levelOfLanding(spec);
  const rng = createRng((seed * 31 + 17) | 0);
  const walk = walkFrom(W, H, open, [ground.ramp]).dist;
  const onGround = (i: number): boolean =>
    (num(district, i) >= 0 || ground.strip?.[i] === true) && open[i] === true && num(walk, i) >= 0;
  let longest = 1;
  for (let i = 0; i < N; i++) if (onGround(i)) longest = Math.max(longest, num(walk, i));
  const cheb = (a: number, b: number): number =>
    Math.max(Math.abs((a % W) - (b % W)), Math.abs(Math.floor(a / W) - Math.floor(b / W)));

  const citizens: number[] = crowd.tiers.flatMap(([arms, n]) => new Array<number>(n).fill(arms));
  const nearLevel = Math.max(1, Math.floor(LEVEL / 3));
  const far = farOf(spec, crowd);
  // The yard is the city's own district. Each pocket has one level. The
  // pockets are taken in order of the walk out of the yard to their nearest
  // tile (their gate), then to their centre, then the lower number, and the
  // kth of P (from 0) is in ring 1 + floor(3k / P). Ring 1's step from a third
  // of the landing's level up toward it, ring 2's are at it, the nearer half
  // of ring 3's (rounded up) step from it to the far level, and the rest of
  // ring 3's are at the far level.
  const out = walkFrom(
    W,
    H,
    open,
    district.flatMap((d, i) => (d === 0 && open[i] ? [i] : [])),
  ).dist;
  let outmost = 1;
  for (let i = 0; i < N; i++) if (onGround(i)) outmost = Math.max(outmost, num(out, i));
  const R = outmost;
  const yard = (i: number): boolean => num(district, i) === 0;
  const P = ground.pockets;
  const tilesIn: number[][] = Array.from({ length: P + 1 }, () => []);
  for (let i = 0; i < N; i++) {
    const d = num(district, i);
    if (d >= 1 && d <= P && onGround(i)) (tilesIn[d] as number[]).push(i);
  }
  const ringOf: number[] = new Array(P + 1).fill(0);
  const gateWalk: number[] = new Array(P + 1).fill(0);
  const centreWalk: number[] = new Array(P + 1).fill(0);
  for (let d = 1; d <= P; d++) {
    const tiles = tilesIn[d] as number[];
    if (tiles.length === 0) continue;
    const mx0 = tiles.reduce((s, i) => s + (i % W), 0) / tiles.length;
    const my0 = tiles.reduce((s, i) => s + Math.floor(i / W), 0) / tiles.length;
    let centre = num(tiles, 0);
    const gap2 = (i: number): number => ((i % W) - mx0) ** 2 + (Math.floor(i / W) - my0) ** 2;
    for (const i of tiles) if (gap2(i) < gap2(centre)) centre = i;
    centreWalk[d] = num(out, centre);
    gateWalk[d] = Math.min(...tiles.map((i) => num(out, i)));
  }
  const byWalk = Array.from({ length: P }, (_, k) => k + 1)
    .filter((d) => (tilesIn[d] as number[]).length > 0)
    .sort(
      (a, b) =>
        num(gateWalk, a) - num(gateWalk, b) || num(centreWalk, a) - num(centreWalk, b) || a - b,
    );
  byWalk.forEach((d, k) => {
    ringOf[d] = 1 + Math.floor((3 * k) / byWalk.length);
  });
  const pocketLevel: number[] = new Array(P + 1).fill(LEVEL);
  for (const r of [1, 3]) {
    const list = byWalk.filter((d) => ringOf[d] === r);
    const m = list.length;
    // Enough of ring 3 steps that no step is over 10 levels, so every level
    // between the landing's and the far level is within 5 of a pocket.
    const half = Math.min(m, Math.max(Math.ceil(m / 2), Math.ceil((far - LEVEL) / 10)));
    list.forEach((d, k) => {
      pocketLevel[d] =
        r === 1
          ? nearLevel + Math.floor(((LEVEL - nearLevel) * k) / m)
          : k < half
            ? LEVEL + Math.floor(((far - LEVEL) * (k + 1)) / half)
            : far;
    });
  }
  // On generateLanding's maps the generator has set them by the same rules,
  // with its own district centres for the tie-break.
  if (ground.levels) {
    for (let d = 1; d <= P; d++) {
      ringOf[d] = num(ground.levels.ring, d);
      pocketLevel[d] = num(ground.levels.level, d);
    }
  }
  const levelAt = (i: number): number => {
    if (yard(i)) return Math.min(YARD_LEVEL, nearLevel);
    const d = num(district, i);
    return d >= 1 && d <= P ? num(pocketLevel, d) : -1;
  };

  /** A tile whose eight neighbours are open tiles of its own pocket. */
  const inner = (i: number): boolean => {
    const d = num(district, i);
    if (d < 1 || !onGround(i)) return false;
    const x = i % W;
    const y = Math.floor(i / W);
    return AROUND.every(([dx, dy]) => {
      const [nx, ny] = [x + dx, y + dy];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
      const j = ny * W + nx;
      return open[j] === true && district[j] === d;
    });
  };

  // Shares, in packs, each from its citizen's place in the order and the
  // hundredths carried from its last landing.
  const packs: Pack[] = [];
  const shareOfCitizen: Pack[][] = citizens.map((arms) => {
    const carry = roll(rng, 100);
    const place = roll(rng, 10);
    const n = Math.floor((carry + shareOf(arms)) / 100);
    const level = Math.min(far, Math.max(arms, nearLevel));
    return Array.from({ length: n }, (_, k) => {
      const [kind, plus] = ORDER[(place + k) % 10] as [Kind, number];
      const p: Pack = {
        kind,
        due: Math.min(far, level + plus),
        level: Math.min(far, level + plus),
        where: "none",
        tile: -1,
        den: -1,
      };
      packs.push(p);
      return p;
    });
  });

  // The stand-ins stand the near den already; so does the generator, which
  // also aims its dens and stands its first chest, so on its maps neither is
  // done again here.
  const dens = [...ground.dens];
  const nearAt = ground.nearDen;
  const size0 = ground.ownDens;
  const aimHere = ground.levels === undefined;
  // The size's own dens are aimed once the far level is known, at the levels
  // of ring 3's pockets from the far level down, one a level: the first in a
  // pocket at the far level, so it holds the strongest citizen's packs 5 and
  // 10 over and its elite is at the far level, and the next ones in the
  // stepping pockets below it, so every level between the landing's and the
  // far level has a den within 5. Dens past the levels there are stand where
  // the generator spread them. Each takes the tile whose pocket's level is
  // nearest its aim, in a pocket with no other den, clear of chests and piles
  // and more than 8 tiles from the ramp (then nearer the yard, then the lower
  // tile number).
  const aimDen = (k: number, aim: number): void => {
    if (dens.length <= k) return;
    const others = new Set(dens.filter((_, n) => n !== k).map((t) => num(district, t)));
    let best = -1;
    let bestKey = 0;
    for (let i = 0; i < N; i++) {
      if (!inner(i) || others.has(num(district, i))) continue;
      if ([...ground.chests, ...ground.piles].some((t) => cheb(t, i) <= 1)) continue;
      if (
        Math.abs((i % W) - (ground.ramp % W)) +
          Math.abs(Math.floor(i / W) - Math.floor(ground.ramp / W)) <=
        RAMP_CLEAR
      )
        continue;
      const key = Math.abs(levelAt(i) - aim) * 1_000_000 + num(out, i) * 10_000 + i;
      if (best === -1 || key < bestKey) [best, bestKey] = [i, key];
    }
    if (best !== -1) dens[k] = best;
  };
  const aims = [
    ...new Set(byWalk.filter((d) => ringOf[d] === 3).map((d) => num(pocketLevel, d))),
  ].sort((a, b) => b - a);
  if (aimHere) for (let k = 0; k < Math.min(size0, aims.length); k++) aimDen(k, num(aims, k));
  const denLevel = dens.map((t) => levelAt(t));
  const denPocket = dens.map((t) => num(district, t));
  const denPockets = new Set(denPocket);
  // The size's first chest stands on the far ground: on the tile whose ground
  // is nearest the far level, then in a pocket with no den, clear of dens,
  // piles and the other chests and more than 8 tiles from the ramp (then
  // nearer the yard, then the lower tile number).
  const chests = [...ground.chests];
  if (aimHere && chests.length > 0) {
    const clear = [...dens, ...ground.piles, ...chests.slice(1)];
    let best = -1;
    let bestKey = 0;
    for (let i = 0; i < N; i++) {
      if (!inner(i) || clear.some((t) => cheb(t, i) <= 1)) continue;
      if (
        Math.abs((i % W) - (ground.ramp % W)) +
          Math.abs(Math.floor(i / W) - Math.floor(ground.ramp / W)) <=
        RAMP_CLEAR
      )
        continue;
      const key =
        Math.abs(levelAt(i) - far) * 2_000_000_000 +
        (denPockets.has(num(district, i)) ? 1_000_000_000 : 0) +
        num(out, i) * 10_000 +
        i;
      if (best === -1 || key < bestKey) [best, bestKey] = [i, key];
    }
    if (best !== -1) chests[0] = best;
  }
  // What a pocket holds besides dens, chests and piles: shrines and wrecks,
  // each with a guard, and seams of ore. Each goes to the pocket holding the
  // fewest things so far (shrines and wrecks to one with no den or chest while
  // there is one; then the pocket with more tiles, then the lower number), on
  // its inner tile farthest from everything stood so far (then the lower tile
  // number), and never within 8 tiles of the ramp.
  const stood = [...dens, ...chests, ...ground.piles];
  const heldBy: number[] = new Array(ground.pockets + 1).fill(0);
  for (const t of stood) heldBy[num(district, t)] = num(heldBy, num(district, t)) + 1;
  const sited = new Set([...dens, ...chests].map((t) => num(district, t)));
  const pocketTiles: number[] = new Array(ground.pockets + 1).fill(0);
  for (let i = 0; i < N; i++) {
    const d = num(district, i);
    if (d >= 1 && onGround(i)) pocketTiles[d] = num(pocketTiles, d) + 1;
  }
  const beyondRamp = (i: number): boolean =>
    Math.abs((i % W) - (ground.ramp % W)) +
      Math.abs(Math.floor(i / W) - Math.floor(ground.ramp / W)) >
    RAMP_CLEAR;
  const stand = (count: number, site: boolean): number[] => {
    const found: number[] = [];
    for (let n = 0; n < count; n++) {
      let best = -1;
      let bestKey = 0;
      for (let d = 1; d <= ground.pockets; d++) {
        let tile = -1;
        let gap = -1;
        for (let i = 0; i < N; i++) {
          if (num(district, i) !== d || !inner(i) || !beyondRamp(i)) continue;
          const g = Math.min(99, ...stood.map((t) => cheb(t, i)));
          if (g > 1 && g > gap) [tile, gap] = [i, g];
        }
        if (tile === -1) continue;
        const key =
          (site && sited.has(d) ? 1_000_000_000 : 0) +
          num(heldBy, d) * 10_000_000 -
          num(pocketTiles, d) * 100 +
          d;
        if (best === -1 || key < bestKey) [best, bestKey] = [tile, key];
      }
      if (best === -1) break;
      const d = num(district, best);
      found.push(best);
      stood.push(best);
      heldBy[d] = num(heldBy, d) + 1;
      if (site) sited.add(d);
    }
    return found;
  };
  // The generator stands them itself (landing.ts, step 9).
  const { holds } = ground;
  if (holds) stood.push(...holds.shrines, ...holds.wrecks, ...holds.seams);
  const shrines = holds ? holds.shrines : stand(shrinesOf(spec), true);
  const wrecks = holds ? holds.wrecks : stand(wrecksOf(spec), true);
  const seams = holds ? holds.seams : stand(seamsOf(spec), false);

  // Posts: inner tiles of a pocket beyond the yard, not beside anything that
  // stands, taken in tile order, each more than 3 tiles (a diagonal counting
  // one) from every post of its pocket before it.
  const things = stood;
  const posts: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!inner(i)) continue;
    if (things.some((t) => cheb(t, i) <= 1)) continue;
    if (posts.some((p) => district[p] === district[i] && cheb(p, i) <= POST_GAP)) continue;
    posts.push(i);
  }
  const used = new Set<number>();
  const denPostsOf = (n: number): number[] => posts.filter((p) => district[p] === denPocket[n]);

  // The room is the size's standing floor, and counts everything standing at
  // legs-plant: the dens' elites, the guards of chests, shrines and wrecks, the
  // packs on posts and the two packs out of each den.
  const guards = GUARD * (chests.length + shrines.length + wrecks.length);
  let room = roomOf(spec) - dens.length - guards;
  const denHolds: number[] = dens.map(() => 0);
  const denCount: number[] = dens.map(() => 0);
  const denNear = (p: Pack): boolean => denLevel.some((v) => Math.abs(v - p.level) <= NEAR);
  const place1 = (p: Pack): void => {
    const m = KINDS[p.kind].monsters;
    let best = -1;
    let bestKey = 0;
    if (room >= m) {
      for (const t of posts) {
        if (used.has(t)) continue;
        const off = Math.abs(levelAt(t) - p.level);
        if (off > NEAR) continue;
        const k = off * 1_000_000 + num(walk, t) * 10_000 + t;
        if (best === -1 || k < bestKey) [best, bestKey] = [t, k];
      }
    }
    if (best !== -1) {
      used.add(best);
      room -= m;
      p.where = "post";
      p.tile = best;
      p.level = levelAt(best);
      return;
    }
    let den = -1;
    denLevel.forEach((v, n) => {
      if (Math.abs(v - p.level) > NEAR || num(denCount, n) >= DEN_PACKS) return;
      // A den whose pocket has no post could never let a pack out, so it takes none.
      if (denPostsOf(n).length === 0) return;
      if (den === -1 || num(denHolds, n) < num(denHolds, den)) den = n;
    });
    if (den === -1) return;
    // A pack in a den keeps its own level, which is within 5 of the den's.
    p.where = "den";
    p.den = den;
    // A den's first two packs come out at legs-plant, if the room has them, to
    // the free posts of its pocket farthest from the ramp.
    if (num(denCount, den) < 2 && room >= m) {
      let far1 = -1;
      for (const t of denPostsOf(den)) {
        if (used.has(t)) continue;
        if (far1 === -1 || num(walk, t) > num(walk, far1)) far1 = t;
      }
      if (far1 !== -1) {
        used.add(far1);
        room -= m;
        p.tile = far1;
      }
    }
    denCount[den] = num(denCount, den) + 1;
    denHolds[den] = num(denHolds, den) + m;
  };

  const turns = shuffle(
    rng,
    citizens.map((_, c) => c),
  );
  for (const firstRound of [true, false]) {
    const queues = shareOfCitizen.map((list) => list.filter((p) => !denNear(p) === firstRound));
    for (let more = true; more; ) {
      more = false;
      for (const c of turns) {
        const p = (queues[c] as Pack[]).shift();
        if (!p) continue;
        more = true;
        place1(p);
      }
    }
  }

  // The map's own packs. Where the shares left the plate under its room, the
  // landing lays packs of its own on the free posts, in the order of ten from a
  // place the seed draws, each at its post's ground level: on the post in the
  // pocket with the smallest part of its posts taken, then the one farthest
  // from the ramp by the walk, then the lower tile number. They are nobody's
  // share and pay as written.
  const postsIn: number[] = new Array(ground.pockets + 1).fill(0);
  const usedIn: number[] = new Array(ground.pockets + 1).fill(0);
  for (const t of posts) postsIn[num(district, t)] = num(postsIn, num(district, t)) + 1;
  for (const t of used) usedIn[num(district, t)] = num(usedIn, num(district, t)) + 1;
  const own: { kind: Kind; tile: number; level: number }[] = [];
  for (let k = roll(rng, 10); ; k++) {
    const [kind] = ORDER[k % 10] as [Kind, number];
    const m = KINDS[kind].monsters;
    if (room < m) break;
    let best = -1;
    let bestKey = 0;
    for (const t of posts) {
      if (used.has(t)) continue;
      const d = num(district, t);
      const key =
        Math.floor((num(usedIn, d) * 1_000) / num(postsIn, d)) * 100_000_000 -
        num(walk, t) * 100_000 +
        t;
      if (best === -1 || key < bestKey) [best, bestKey] = [t, key];
    }
    if (best === -1) break;
    used.add(best);
    usedIn[num(district, best)] = num(usedIn, num(district, best)) + 1;
    room -= m;
    own.push({ kind, tile: best, level: levelAt(best) });
  }

  // A den's letter: A for the one with the shortest walk from the ramp, then B
  // and so on (then the lower tile number).
  const lettered = dens
    .map((t, n) => ({ n, t }))
    .sort((a, b) => num(walk, a.t) - num(walk, b.t) || a.t - b.t);
  const denLetter: string[] = dens.map(() => "");
  lettered.forEach(({ n }, k) => {
    denLetter[n] = String.fromCharCode(65 + (k % 26));
  });

  // The front. From the sighting the black holds the ground fewer than g tiles
  // from the rim, or fewer than g steps' walk from a gap, where g grows evenly
  // from 1 at the sighting to the city's gather depth at the march. It never
  // takes the strip. The march sets out from that black and is at the bubble
  // 75 seconds later. A tile is taken at a share of that time: its walk h from
  // the black over h plus its walk d to the strip, the ground within two
  // tiles' walk of the bubble, and never before the tile next to it on its way
  // from the black. The strip itself is not taken until the shield breaks.
  const depthMax = cityOf(spec).gather;
  const gapWalk = walkFrom(
    W,
    H,
    open,
    ground.gaps.filter((g) => num(walk, g) >= 0),
  ).dist;
  const gatherOf = (i: number): number => {
    const x = i % W;
    const y = Math.floor(i / W);
    const rimRow = Math.min(x, y, W - 1 - x, H - 1 - y) - RIM;
    const g = num(gapWalk, i);
    return g === -1 ? rimRow : Math.min(rimRow, g);
  };
  const gathered = (i: number): boolean =>
    open[i] === true && num(walk, i) >= 0 && num(out, i) > STRIP && gatherOf(i) < depthMax;
  const blackAtMarch: number[] = [];
  for (let i = 0; i < N; i++) if (gathered(i)) blackAtMarch.push(i);
  const fromGaps = walkFrom(W, H, open, blackAtMarch);
  const BUBBLE = MARCH + MARCH_TICKS;
  const taken: number[] = new Array(N).fill(-1);
  /** Ticks a tile the front moves at, along each tile's way from the black. */
  const pace: number[] = [];
  for (const i of fromGaps.order) {
    const h = num(fromGaps.dist, i);
    if (h === 0) {
      taken[i] =
        depthMax <= 1
          ? SIGHTING
          : SIGHTING + Math.ceil(((MARCH - SIGHTING) * gatherOf(i)) / (depthMax - 1));
      continue;
    }
    const d = Math.max(0, num(out, i) - STRIP);
    if (d > 0) pace.push(MARCH_TICKS / (h + d));
    let back = Number.POSITIVE_INFINITY;
    for (const [dx, dy] of STEPS) {
      const [x, y] = [(i % W) + dx, Math.floor(i / W) + dy];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x;
      if (num(fromGaps.dist, j) === h - 1) back = Math.min(back, num(taken, j));
    }
    taken[i] = Math.max(MARCH + Math.ceil((MARCH_TICKS * h) / (h + d)), back);
  }
  const takenAt = (i: number): number => (num(taken, i) === -1 ? BUBBLE : num(taken, i));

  // The wall's stations: tiles two steps' walk outside the bubble, at the
  // black's edge, taken in tile order, each more than a tile from every
  // station before it.
  const stations: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!onGround(i) || num(out, i) !== STRIP) continue;
    if (stations.some((s) => cheb(s, i) <= STATION_GAP)) continue;
    stations.push(i);
  }
  // The bubble's edge: yard tiles with open ground that is not the yard's beside them.
  let edge = 0;
  for (let i = 0; i < N; i++) {
    if (!yard(i) || open[i] !== true) continue;
    const beside = STEPS.some(([dx, dy]) => {
      const [x, y] = [(i % W) + dx, Math.floor(i / W) + dy];
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const j = y * W + x;
      return open[j] === true && num(district, j) !== 0;
    });
    if (beside) edge++;
  }

  // The measures.
  const tiers = new Map<number, TierResult>();
  for (const [arms] of crowd.tiers)
    tiers.set(arms, {
      shareMonsters: [],
      standing: [],
      waiting: [],
      whole: [],
      laid: [],
      pay: [],
      capped: 0,
      paid: [],
      walk: [],
      denWalk: [],
      covered: [],
      highDue: 0,
      highLaid: 0,
    });
  shareOfCitizen.forEach((list, c) => {
    const tier = tiers.get(num(citizens, c)) as TierResult;
    const whole = list.reduce((s, p) => s + KINDS[p.kind].weight, 0);
    const laid = list
      .filter((p) => p.where !== "none")
      .reduce((s, p) => s + KINDS[p.kind].weight, 0);
    tier.shareMonsters.push(list.reduce((s, p) => s + KINDS[p.kind].monsters, 0));
    tier.standing.push(
      list.filter((p) => p.tile !== -1).reduce((s, p) => s + KINDS[p.kind].monsters, 0),
    );
    tier.waiting.push(
      list
        .filter((p) => p.where === "den" && p.tile === -1)
        .reduce((s, p) => s + KINDS[p.kind].monsters, 0),
    );
    tier.whole.push(whole);
    tier.laid.push(laid);
    // What its laid monsters pay in all, by weight, with pay at 5 at most.
    tier.paid.push(Math.min(whole, (laid * PAY_CAP) / 100));
    if (laid > 0) {
      tier.pay.push(Math.min(whole / laid, PAY_CAP / 100));
      if (whole * 100 > laid * PAY_CAP) tier.capped++;
    }
    for (const p of list) {
      if (p.due >= 65) tier.highDue += KINDS[p.kind].monsters;
      if (p.where !== "none" && p.level >= 65) tier.highLaid += KINDS[p.kind].monsters;
      if (p.tile !== -1) {
        tier.walk.push((num(walk, p.tile) * TICKS_A_STEP) / 10);
        tier.covered.push(takenAt(p.tile));
      }
      if (p.where === "den") tier.denWalk.push((num(walk, num(dens, p.den)) * TICKS_A_STEP) / 10);
    }
  });

  // Newcomers' ground: pocket tiles beyond the yard within 5 levels of the near
  // level, and the posts among them.
  let newcomerTiles = 0;
  for (let i = 0; i < N; i++) {
    if (num(district, i) >= 1 && onGround(i) && levelAt(i) <= nearLevel + NEAR) newcomerTiles++;
  }
  const newcomerPosts = posts.filter((t) => levelAt(t) <= nearLevel + NEAR).length;

  // Taken ground not joined to a gap through taken ground, as a share of all
  // taken ground, 20, 40 and 60 seconds into the march.
  let islands = 0;
  let takenAll = 0;
  for (const tick of [MARCH + 200, MARCH + 400, MARCH + 600]) {
    const isTaken = (i: number): boolean =>
      open[i] === true && num(fromGaps.dist, i) >= 0 && takenAt(i) <= tick;
    const seen = new Set<number>();
    const queue = blackAtMarch.filter(isTaken);
    for (const g of queue) seen.add(g);
    for (let head = 0; head < queue.length; head++) {
      const i = num(queue, head);
      for (const [dx, dy] of STEPS) {
        const [x, y] = [(i % W) + dx, Math.floor(i / W) + dy];
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const j = y * W + x;
        if (seen.has(j) || !isTaken(j)) continue;
        seen.add(j);
        queue.push(j);
      }
    }
    for (let i = 0; i < N; i++) {
      if (!isTaken(i)) continue;
      takenAll++;
      if (!seen.has(i)) islands++;
    }
  }
  // The far ground, the pockets at the far level: when the horde has half of
  // it and all of it, and how much of it lies on the far side of the city's
  // middle from the ramp.
  const mx = ground.middle % W;
  const my = Math.floor(ground.middle / W);
  const rx = (ground.ramp % W) - mx;
  const ry = Math.floor(ground.ramp / W) - my;
  let farTiles = 0;
  let behind = 0;
  const farTimes: number[] = [];
  const ringTimes: number[][] = [[], [], []];
  for (let i = 0; i < N; i++) {
    const d = num(district, i);
    if (!onGround(i) || d < 1 || d > P) continue;
    (ringTimes[Math.max(0, num(ringOf, d) - 1)] as number[]).push(takenAt(i));
    if (num(pocketLevel, d) < far) continue;
    farTiles++;
    farTimes.push(takenAt(i));
    if (((i % W) - mx) * rx + (Math.floor(i / W) - my) * ry < 0) behind++;
  }
  const groundTiles: number[] = [];
  for (let i = 0; i < N; i++) if (onGround(i)) groundTiles.push(takenAt(i));
  const takenShare = [MARCH, MARCH + 150, MARCH + 300, MARCH + 450, MARCH + 600].map(
    (t) => groundTiles.filter((v) => v <= t).length / Math.max(1, groundTiles.length),
  );
  // Pockets by the side of the city their middle lies on.
  const sideSeen = new Set<number>();
  for (let d = 1; d <= ground.pockets; d++) {
    const tiles = district.flatMap((dd, i) => (dd === d && open[i] ? [i] : []));
    if (tiles.length === 0) continue;
    const px = tiles.reduce((s, i) => s + (i % W), 0) / tiles.length - mx;
    const py = tiles.reduce((s, i) => s + Math.floor(i / W), 0) / tiles.length - my;
    // Scaled to the map's shape, so a corner counts for the side it leans to.
    const sx = px / W;
    const sy = py / H;
    sideSeen.add(Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 1 : 3) : sy > 0 ? 2 : 0);
  }
  // The halves test of docs/art.md, section 4, on what stands at legs-plant:
  // the part of it in the smaller half, cut across and cut down through the city.
  const standingTiles: [number, number][] = [
    ...packs
      .filter((p) => p.tile !== -1)
      .map((p): [number, number] => [p.tile, KINDS[p.kind].monsters]),
    ...own.map((p): [number, number] => [p.tile, KINDS[p.kind].monsters]),
    ...dens.map((t): [number, number] => [t, 1]),
    ...[...chests, ...shrines, ...wrecks].map((t): [number, number] => [t, GUARD]),
  ];
  const standingAll = standingTiles.reduce((s, [, m]) => s + m, 0);
  const left = standingTiles.filter(([t]) => t % W < mx).reduce((s, [, m]) => s + m, 0);
  const above = standingTiles
    .filter(([t]) => Math.floor(t / W) < my)
    .reduce((s, [, m]) => s + m, 0);
  const lightHalf =
    standingAll === 0
      ? 0
      : Math.min(left, standingAll - left, above, standingAll - above) / standingAll;
  const ownMonsters = own.reduce((s, p) => s + KINDS[p.kind].monsters, 0);
  const topDen = denLevel.reduce((best, v) => Math.max(best, v), -1);
  const topChest = chests.reduce((best, t) => Math.max(best, levelAt(t)), -1);

  return {
    pockets: ground.pockets,
    sides: sideSeen.size,
    longest,
    outmost: R,
    ring1: Math.floor(R / 3),
    ring2: Math.floor((2 * R) / 3),
    inner3: Math.floor((5 * R) / 6),
    posts: posts.length,
    postTiles: posts,
    denTiles: dens,
    denPostCounts: dens.map((_, n) => denPostsOf(n).length),
    // A den's elite is 5 over the den, and never over the far level.
    topElite: topDen === -1 ? -1 : Math.min(far, topDen + 5),
    topChest,
    levelOf: Array.from({ length: N }, (_, i) => (onGround(i) ? levelAt(i) : -1)),
    piles: ground.piles.length,
    dens: dens.length,
    chests: chests.length,
    chestTiles: chests,
    newcomerTiles,
    newcomerPosts,
    nearDenWalk: nearAt === -1 ? Number.NaN : (num(walk, nearAt) * TICKS_A_STEP) / 10,
    standingAtPlant: standingAll,
    ownMonsters,
    ownHigh: own.filter((p) => p.level >= 65).reduce((s, p) => s + KINDS[p.kind].monsters, 0),
    ownTiles: own.map((p) => p.tile),
    shareTiles: packs.filter((p) => p.tile !== -1).map((p) => p.tile),
    lightHalf,
    stations: stations.length,
    edge,
    denLetters: denLetter,
    denLevels: denLevel,
    shrineTiles: shrines,
    wreckTiles: wrecks,
    seamTiles: seams,
    waitingInDens: packs
      .filter((p) => p.where === "den" && p.tile === -1)
      .reduce((s, p) => s + KINDS[p.kind].monsters, 0),
    denPacks: [...denCount],
    denInterval: denCount.map((n) => (n > 2 ? Math.floor((SIGHTING - LEGS_PLANT) / (n - 2)) : 0)),
    denCovered: dens.map((t) => takenAt(t)),
    farHalf: median(farTimes),
    farAll: farTimes.length === 0 ? Number.NaN : Math.max(...farTimes),
    farBehind: farTiles === 0 ? 0 : behind / farTiles,
    ringTaken: ringTimes.map((list) => median(list)),
    takenShare,
    islands: takenAll === 0 ? 0 : islands / takenAll,
    frontPace: [pct(pace, 10), pct(pace, 90)],
    tiers,
  };
}

const median = (list: readonly number[]): number => {
  if (list.length === 0) return Number.NaN;
  const s = [...list].sort((a, b) => a - b);
  return num(s, Math.floor((s.length - 1) / 2));
};
const pct = (list: readonly number[], p: number): number => {
  if (list.length === 0) return Number.NaN;
  const s = [...list].sort((a, b) => a - b);
  return num(s, Math.min(s.length - 1, Math.floor((s.length * p) / 100)));
};
const mean = (list: readonly number[]): number =>
  list.length === 0 ? Number.NaN : list.reduce((s, v) => s + v, 0) / list.length;
const sum = (list: readonly number[]): number => list.reduce((s, v) => s + v, 0);
const clock = (tick: number): string => {
  if (Number.isNaN(tick)) return "-";
  const s = Math.floor(tick / 10);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const f = (v: number, digits = 1): string => (Number.isNaN(v) ? "-" : v.toFixed(digits));
const row = (cells: readonly (string | number)[]): string => `| ${cells.join(" | ")} |`;
/** The far level: the strongest citizen's Arms, or the landing's level if higher, plus the class's step. */
function farOf(spec: LandingSpec, crowd: Crowd): number {
  const top = Math.max(...crowd.tiers.map(([arms]) => arms));
  return Math.min(99, Math.max(top, levelOfLanding(spec)) + FAR[spec.cls]);
}
const groundOf = (spec: LandingSpec, seed: number, crowd: Crowd): Ground =>
  useGenerator
    ? generatorGround(spec, seed, extraOf(crowd), farOf(spec, crowd))
    : standIn(spec, seed, extraOf(crowd));
const landingOf = (key: string | undefined): LandingSpec => {
  const spec = LANDINGS.find((l) => l.key === key);
  if (!spec) throw new Error(`no landing ${key}; one of ${LANDINGS.map((l) => l.key).join(", ")}`);
  return spec;
};
const sizeText = (l: LandingSpec): string => `${l.width} by ${l.height}`;

// The works: what each thing costs, in the order the default builds them, and
// what a landing brings: 10 ore a citizen, each ore counted as 15 over the
// citizens awake (15 at least), so 150 a landing whatever the roster.
const WORK_A_LANDING = 150;
const LANDINGS_AN_HOUR = 60 / 13;
const SHIELD_LEVELS = 10;
const shieldCost = (level: number): number => 300 * level;
const CITY_COST = [0, 4_000, 25_000, 100_000];
const BUILD_ORDER: readonly (readonly ["shield" | "city", number])[] = [
  ["shield", 1],
  ["shield", 2],
  ["city", 2],
  ["shield", 3],
  ["shield", 4],
  ["shield", 5],
  ["city", 3],
  ["shield", 6],
  ["shield", 7],
  ["shield", 8],
  ["city", 4],
  ["shield", 9],
  ["shield", 10],
];
/** Hours of stream at which each step of the default order is paid for. */
const builtAt = (() => {
  let paid = 0;
  return BUILD_ORDER.map(([what, n]) => {
    paid += what === "shield" ? shieldCost(n) : num(CITY_COST, n - 1);
    return { what, n, paid, hours: paid / (WORK_A_LANDING * LANDINGS_AN_HOUR) };
  });
})();
const shieldAt = (hours: number): number =>
  builtAt.filter((b) => b.what === "shield" && b.hours <= hours).length;
const cityAt = (hours: number): number =>
  1 + builtAt.filter((b) => b.what === "city" && b.hours <= hours).length;

// Experience (docs/plan.md, section 2.3): weight * (40 + M) / 40, rounded down.
const xpOf = (weight: number, level: number): number =>
  Math.floor((weight * (40 + Math.min(99, level))) / 40);
const packXp = (kind: Kind, level: number): number =>
  kind === "S"
    ? 10 * xpOf(1, level) + xpOf(3, level)
    : kind === "P"
      ? 3 * xpOf(3, level) + xpOf(12, level)
      : 3 * xpOf(12, level);
const orderXp = (level: number): number =>
  ORDER.reduce((s, [kind, plus]) => s + packXp(kind, level + plus), 0);
const ORDER_WEIGHT = ORDER.reduce((s, [kind]) => s + KINDS[kind].weight, 0);
/** A landing's experience from a citizen's share, all of it killed. */
const shareXp = (level: number): number => (orderXp(level) * shareOf(level)) / 1_000;

// The siege (docs/slice.md, section 1). t is ticks from the tick the front is
// at the bubble, and L is the landing's level.
//
// The shield has one pool of 450 points and 90 more a level, and 10 posts and
// 2 more a level, each with a condition of 20 points and 1 more a level. The
// siege's weight W is the citizens awake at the march times the weight of a
// share at L, and the siege is owed W every 4,800 ticks, and 10 more for each
// citizen awake past 15, times (800 + t) / 800. A swarm is 10 fodder and a
// leader at L, with the order's 5 and 10 over on three places in ten, one
// fodder more for each 300 ticks of siege and one level more for each 60, to
// 99 at most. The swarms come to the posts in turn, in an order drawn at the
// sighting, each onto the station of its post's arc with the fewest swarms, a
// station holding one swarm for each 15 awake; with its arc full it waits in
// the black against that arc. A swarm slams unless someone is striking it.
// Each tick the pool loses 14 points times the weight slamming on each arc
// over W, three times over on a dark post's arc, and a lit post's condition
// loses what its arc took from the pool, the post going dark for the rest of
// the landing when it runs out. On `hold` a citizen goes aboard when
// lift_eta < 500 + way_home (breakEta below). The siege pays a citizen up to
// its share's weight a landing, and a monster ten or more levels under its
// killer gives a quarter of its experience.
//
// The fight is a flow estimate, not the simulation. A citizen swings every 5
// ticks and spends three quarters of its time swinging (the rest goes on
// stepping out of blows and drinking). A swing takes two fodder or the
// leader, and a monster takes max(1, hp / blow) swings, where blow is the
// citizen's blow with its gear and aim and hp is plan.md's. A swarm can be
// struck 10 ticks after it steps onto its station, and up to three citizens
// fight one. A citizen keeps to the swarm it is on until it is dead.
// Otherwise it takes Deckhand's `hold`: of the swarms no more than 10 levels
// over its Arms on the arcs of the posts within a sixth of the way round the
// foot of its side (where it came in, spread round the foot), one on a dark
// post's arc, or else on the lit post with the least condition left, one
// nobody is striking before one somebody is, the nearest first. With none
// there it waits. It walks to a swarm straight across the bubble, at 4 ticks
// a tile, on a ring of 108 tiles. The wall is the second city's medium
// landing's 45 stations, evenly round the foot, each on the arc of its
// nearest post, and the plate's cap of 700 counts the siege's monsters only.
// A swarm's monsters count as alive in proportion to what is left of it.
const shieldPoints = (level: number): number => 450 + 90 * level;
const shieldPosts = (level: number): number => 10 + 2 * level;
const postCondition = (level: number): number => 20 + level;
const DARK_TIMES = 3;
const SIEGE_SHARE_TICKS = 4_800;
const PRESSURE_TICKS = 800;
const LOSS_A_SHARE = 14;
const FODDER_EVERY = 300;
const LEVEL_EVERY = 60;
const SIEGE_PLACES = [0, 0, 0, 0, 0, 5, 0, 0, 5, 10] as const;
const SIEGE_STATIONS = 45;
const STATION_AWAKE = 15;
const SLOWER_A_CITIZEN = 10; // ticks added to the 4,800 for each citizen awake past 15
const SIEGE_LEVEL_MOST = 99; // world.ts's MOST_KIND_LEVEL
const PLATE_CAP = 700;
const SIEGE_OVER = 10;
const SIDE = 1 / 6; // a citizen holds the arcs of the posts this part of the way round the foot from its side, either way
const RING_TILES = 108;
const FIGHTERS_A_SWARM = 3;
const SWING_TICKS = 5;
const SWINGING = 0.75;
const STEP_OUT = 10;
const LIFT_AFTER_BREAK = 300;
const ABOARD_BY = 200;
const SIEGE_CAP = 6_000; // the model stops here; no siege it runs gets near it
/** A fodder monster's hitpoints at a level (plan.md, section 2.1). */
const fodderLife = (level: number): number => {
  const blow = 6 + level + Math.floor((level * level) / 20);
  return Math.floor((blow * (100 + 2 * level)) / 100);
};
/** The weight of a share at a level: its packs times the order's 177 over 10. */
const shareWeightOf = (level: number): number => ((shareOf(level) / 100) * ORDER_WEIGHT) / 10;
/** The fodder in a siege swarm sent t ticks into the siege, and the levels over the landing's it gains. */
const swarmFodder = (t: number): number => 10 + Math.floor(t / FODDER_EVERY);
const swarmBump = (t: number): number => Math.floor(t / LEVEL_EVERY);
/** A siege swarm's level: the landing's, its place in the order, a level each 60 ticks, 99 at most. */
const swarmLevel = (landing: number, place: number, t: number): number =>
  Math.min(SIEGE_LEVEL_MOST, landing + place + swarmBump(t));
/** The ticks over which the siege is owed W: 4,800, and 10 more for each citizen awake past 15. */
const siegePeriod = (awake: number): number =>
  SIEGE_SHARE_TICKS + SLOWER_A_CITIZEN * Math.max(0, awake - STATION_AWAKE);
/**
 * lift_eta's part for the shield: the ticks until the pool would reach 0 if
 * nothing more were killed and nobody struck anything, found by running the
 * siege forward from the state at the end of tick t: what is owed and sent,
 * the order of the posts, the weight alive on each arc, each post's
 * condition and the pool. Each swarm sent from now is against the arc it is
 * sent to, every swarm slams, and the run stops at 8,191 ticks. Kills and
 * strikes only take weight off the arcs, so the real break is never sooner.
 */
const breakEta = (
  from: {
    left: number;
    owed: number;
    sent: number;
    t: number;
    onArc: readonly number[];
    condition: readonly number[];
    turn: readonly number[];
  },
  siegeWeight: number,
  dark: number,
  period: number,
): number => {
  const posts = from.onArc.length;
  const onArc = from.onArc.slice();
  const condition = from.condition.slice();
  let { left, owed, sent } = from;
  for (let v = 1; v <= 8_191; v++) {
    const t = from.t + v;
    owed += (siegeWeight * (PRESSURE_TICKS + t)) / (period * PRESSURE_TICKS);
    const weight = swarmFodder(t) + 3;
    while (owed >= weight) {
      owed -= weight;
      const p = num(from.turn, sent % posts);
      onArc[p] = num(onArc, p) + weight;
      sent++;
    }
    let pressed = 0;
    for (let p = 0; p < posts; p++) {
      const lit = num(condition, p) > 0;
      pressed += num(onArc, p) * (lit ? 1 : dark);
      if (lit) condition[p] = num(condition, p) - (LOSS_A_SHARE * num(onArc, p)) / siegeWeight;
    }
    left -= Math.floor((LOSS_A_SHARE * 1_000 * pressed) / siegeWeight) / 1_000;
    if (left <= 0) return v;
  }
  return 8_191;
};
interface Defender {
  readonly arms: number;
  /** Its blow with gear and aim, against a monster with no armour. */
  readonly blow: number;
  readonly wayHome: number;
}
interface SiegeResult {
  /** Ticks from the front reaching the bubble to the break. */
  readonly holds: number;
  /** The last tick the weight slamming was under a twentieth of the siege's: from then the horde is ahead for good. */
  readonly outpaced: number;
  /** For each defender: weight killed over its share's weight, experience, swarms and monsters killed, and monsters at 65 or more. */
  readonly paid: readonly {
    part: number;
    xp: number;
    swarms: number;
    monsters: number;
    at65: number;
  }[];
  /** Every 100 ticks: the alive weight over the siege's, the loss a tick, the pool left and the lamps lit. */
  readonly curve: readonly { t: number; alive: number; loss: number; left: number; lit: number }[];
  /** The tick each defender went aboard on `hold`, or NaN. */
  readonly boarded: readonly number[];
  /** The tick the first post went dark, and the most siege monsters on the wall at once. */
  readonly firstDark: number;
  readonly mostOnWall: number;
  /** lift_eta each tick of the siege, the break's part and the 300 after it. */
  readonly etas: readonly number[];
}
/**
 * Runs a siege on a landing of level `landing` against a roster. On `hold`
 * each defender goes aboard when lift_eta < 500 + way_home; on `guard` it
 * fights to the break; with `nobody` no one fights.
 */
const runSiege = (
  roster: readonly Defender[],
  shieldLevel: number,
  mode: "hold" | "guard" | "nobody",
  landing: number,
  seed = 1,
  darkTimes = DARK_TIMES,
  trackEta = false,
): SiegeResult => {
  const awake = roster.length;
  const siegeWeight = awake * shareWeightOf(landing);
  const mine = roster.map((d) => shareWeightOf(d.arms));
  const posts = shieldPosts(shieldLevel);
  const room = Math.ceil(awake / STATION_AWAKE);
  const period = siegePeriod(awake);
  // Station s stands at (s + 0.5) / 45 of the way round the foot and post p
  // at (p + 0.5) / posts; a station is on the arc of its nearest post.
  const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
  const stationAt = (s: number): number => (s + 0.5) / SIEGE_STATIONS;
  const postAt = (p: number): number => (p + 0.5) / posts;
  const stationsOf: number[][] = Array.from({ length: posts }, () => []);
  for (let s = 0; s < SIEGE_STATIONS; s++) {
    let best = 0;
    for (let p = 1; p < posts; p++) {
      if (apart(stationAt(s), postAt(p)) < apart(stationAt(s), postAt(best)) - 1e-12) best = p;
    }
    stationsOf[best]?.push(s);
  }
  const rng = createRng((seed * 613 + shieldLevel * 31 + awake) | 0);
  const turn = shuffle(
    rng,
    Array.from({ length: posts }, (_, p) => p),
  );
  // Each citizen's side: where it came in, spread round the foot.
  const side = roster.map((_, k) => (k * 0.618_034 + 0.25) % 1);
  const sidePosts = side.map((x) =>
    Array.from({ length: posts }, (_, p) => p).filter((p) => apart(x, postAt(p)) <= SIDE),
  );
  const at = side.slice();
  const arrives = roster.map(() => 0);
  const onStation: number[] = new Array(SIEGE_STATIONS).fill(0);
  const condition: number[] = new Array(posts).fill(postCondition(shieldLevel));
  let owed = nextInt(rng, 1_300) / 100;
  let sent = 0;
  const aboard = roster.map(() => mode === "nobody");
  const boarded = roster.map(() => Number.NaN);
  const paid = roster.map(() => ({ part: 0, xp: 0, swarms: 0, monsters: 0, at65: 0 }));
  interface Swarm {
    id: number;
    post: number;
    station: number; // -1 while it waits in the black
    fodder: number;
    level: number;
    done: number;
    ready: number;
  }
  let swarms: Swarm[] = [];
  const on: (Swarm | undefined)[] = roster.map(() => undefined);
  const full = shieldPoints(shieldLevel);
  let left = full;
  let outpaced = 0;
  let firstDark = Number.NaN;
  let mostOnWall = 0;
  const etas: number[] = [];
  const curve: SiegeResult["curve"][number][] = [];
  const monstersOf = (s: Swarm): number => Math.ceil((s.fodder + 1) * (1 - s.done));
  for (let t = 0; t < SIEGE_CAP; t++) {
    // The horde sends, to the posts in turn.
    owed += (siegeWeight * (PRESSURE_TICKS + t)) / (period * PRESSURE_TICKS);
    const fodder = swarmFodder(t);
    while (owed >= fodder + 3) {
      owed -= fodder + 3;
      const place = SIEGE_PLACES[sent % 10] ?? 0;
      swarms.push({
        id: sent,
        post: num(turn, sent % posts),
        station: -1,
        fodder,
        level: swarmLevel(landing, place, t),
        done: 0,
        ready: -1,
      });
      sent++;
    }
    // Swarms step out, oldest first, onto the station of their post's arc with
    // the fewest swarms, while the plate has room for them. With the arc's
    // stations full a swarm waits in the black against that arc.
    let onWall = sum(swarms.filter((s) => s.station >= 0).map(monstersOf));
    for (const s of swarms) {
      if (s.station >= 0) continue;
      if (onWall + s.fodder + 1 > PLATE_CAP) break;
      let st = -1;
      for (const c of stationsOf[s.post] ?? []) {
        if (num(onStation, c) < room && (st < 0 || num(onStation, c) < num(onStation, st))) st = c;
      }
      if (st < 0) continue;
      s.station = st;
      s.ready = t + STEP_OUT;
      onStation[st] = num(onStation, st) + 1;
      onWall += s.fodder + 1;
    }
    mostOnWall = Math.max(mostOnWall, onWall);
    // The citizens fight.
    const strikable = swarms.filter((s) => s.station >= 0 && s.ready <= t);
    const fighters = new Map<Swarm, number>();
    for (const target of on) if (target) fighters.set(target, (fighters.get(target) ?? 0) + 1);
    const free = (s: Swarm): boolean => (fighters.get(s) ?? 0) < FIGHTERS_A_SWARM;
    const struck = new Set<Swarm>();
    roster.forEach((d, i) => {
      if (aboard[i]) return;
      let target = on[i];
      if (!target || target.done >= 1 - 1e-9) {
        if (target) fighters.set(target, (fighters.get(target) ?? 1) - 1);
        const mySide = sidePosts[i] ?? [];
        const can = strikable.filter((s) => free(s) && s.level <= d.arms + SIEGE_OVER);
        const near = (s: Swarm): number => apart(num(at, i), stationAt(s.station));
        const local = can.filter((s) => mySide.includes(s.post));
        const rank = (s: Swarm): number =>
          num(condition, s.post) <= 0 ? -1 : num(condition, s.post);
        const taken = (s: Swarm): number => ((fighters.get(s) ?? 0) > 0 ? 1 : 0);
        target = local.sort(
          (a, b) => rank(a) - rank(b) || taken(a) - taken(b) || near(a) - near(b),
        )[0];
        on[i] = target;
        if (!target) return;
        fighters.set(target, (fighters.get(target) ?? 0) + 1);
        // It walks straight across the bubble's edge, a chord of the ring.
        const chord = (RING_TILES / Math.PI) * Math.sin(Math.PI * near(target));
        arrives[i] = t + Math.round(chord * TICKS_A_STEP);
        at[i] = stationAt(target.station);
      }
      if (t < num(arrives, i)) return;
      struck.add(target);
      const hp = fodderLife(target.level);
      const swings =
        (target.fodder / 2) * Math.max(1, hp / d.blow) + Math.max(1, (3 * hp) / d.blow);
      const step = Math.min(1 - target.done, SWINGING / (swings * SWING_TICKS));
      target.done += step;
      const p = paid[i];
      // The siege pays a citizen up to its share's weight a landing, and
      // nothing past it.
      if (!p || p.part >= 1) return;
      const weight = target.fodder + 3;
      const under = target.level <= d.arms - 10 ? 4 : 1;
      p.part += (step * weight) / num(mine, i);
      p.xp += (step * (target.fodder * xpOf(1, target.level) + xpOf(3, target.level))) / under;
      p.swarms += step;
      p.monsters += step * (target.fodder + 1);
      if (target.level >= 65) p.at65 += step * (target.fodder + 1);
    });
    for (const s of swarms) {
      if (s.done >= 1 - 1e-9 && s.station >= 0)
        onStation[s.station] = num(onStation, s.station) - 1;
    }
    swarms = swarms.filter((s) => s.done < 1 - 1e-9);
    // The pool loses what slams on each arc, three times over on a dark post's,
    // and each lit post's condition loses what its arc took. A swarm someone
    // is striking goes for them and does not slam.
    const onArc: number[] = new Array(posts).fill(0);
    const slamming: number[] = new Array(posts).fill(0);
    for (const s of swarms) {
      const w = (s.fodder + 3) * (1 - s.done);
      onArc[s.post] = num(onArc, s.post) + w;
      if (!struck.has(s)) slamming[s.post] = num(slamming, s.post) + w;
    }
    let pressed = 0;
    for (let p = 0; p < posts; p++) {
      const dark = num(condition, p) <= 0;
      pressed += num(slamming, p) * (dark ? darkTimes : 1);
      if (!dark) {
        condition[p] = num(condition, p) - (LOSS_A_SHARE * num(slamming, p)) / siegeWeight;
        if (num(condition, p) <= 0 && Number.isNaN(firstDark)) firstDark = t;
      }
    }
    const alive = sum(onArc);
    const loss = Math.floor((LOSS_A_SHARE * 1_000 * pressed) / siegeWeight) / 1_000;
    left -= loss;
    const lit = condition.filter((c) => c > 0).length;
    if (sum(slamming) < siegeWeight / 20) outpaced = t;
    if (t % 100 === 0)
      curve.push({ t, alive: alive / siegeWeight, loss, left: Math.max(0, left), lit });
    if (left <= 0)
      return {
        holds: t,
        outpaced,
        paid,
        curve,
        boarded,
        firstDark,
        mostOnWall,
        etas,
      };
    // On `hold`, a citizen goes aboard by lift_eta.
    if (mode === "hold" || trackEta) {
      const eta = Math.min(
        9_999,
        breakEta({ left, owed, sent, t, onArc, condition, turn }, siegeWeight, darkTimes, period) +
          LIFT_AFTER_BREAK,
      );
      etas.push(eta);
      if (mode !== "hold") continue;
      roster.forEach((d, i) => {
        if (!aboard[i] && eta < LIFT_AFTER_BREAK + ABOARD_BY + d.wayHome) {
          aboard[i] = true;
          boarded[i] = t;
          on[i] = undefined;
        }
      });
    }
  }
  return {
    holds: SIEGE_CAP,
    outpaced,
    paid,
    curve,
    boarded,
    firstDark,
    mostOnWall,
    etas,
  };
};
/** A citizen's blow against an unarmoured monster: plan.md's blow with ordinary gear, or a third more with the best, times its aim. */
const blowOf = (arms: number, best: boolean): number =>
  fodderLife(arms) * (best ? 4 / 3 : 1) * (best ? 1.4 : 1.05);
/**
 * A roster from (Arms, citizens) tiers, with way_home spread from 40 to 200
 * ticks round the bubble across the tiers, and 120 for a citizen alone.
 */
const rosterOf = (tiers: readonly (readonly [number, number])[], best: boolean): Defender[] => {
  const all = tiers.flatMap(([arms, n]) => Array.from({ length: n }, () => arms));
  const n = all.length;
  return all.map((arms, k) => ({
    arms,
    blow: blowOf(arms, best),
    wayHome: n === 1 ? 120 : 40 + Math.floor((160 * ((k * 7) % n)) / (n - 1)),
  }));
};
/**
 * What the siege pays a citizen of this Arms in ordinary gear on `hold`, by
 * shield level: the average over a roster of 15 at that Arms, on a landing at
 * its level.
 */
const siegeCache = new Map<string, SiegeResult["paid"][number]>();
const siegeOf = (arms: number, shieldLevel: number): SiegeResult["paid"][number] => {
  const key = `${arms} ${shieldLevel}`;
  let got = siegeCache.get(key);
  if (!got) {
    const { paid } = runSiege(rosterOf([[arms, 15]], false), shieldLevel, "hold", arms);
    const mean = (pick: (p: (typeof paid)[number]) => number): number =>
      sum(paid.map(pick)) / paid.length;
    got = {
      part: mean((p) => p.part),
      xp: mean((p) => p.xp),
      swarms: mean((p) => p.swarms),
      monsters: mean((p) => p.monsters),
      at65: mean((p) => p.at65),
    };
    siegeCache.set(key, got);
  }
  return got;
};
/** Hours of stream to reach each level, from shares alone or with the siege at the default order. */
const hoursTo = (withSiege: boolean): number[] => {
  const at: number[] = [0, 0];
  let hours = 0;
  for (let level = 1; level < 99; level++) {
    let need = num(XP_TABLE, level + 1) - num(XP_TABLE, level);
    // The siege's part changes as the shield is built, so a level is worked a
    // tenth of a landing at a time.
    while (need > 0) {
      const gain = shareXp(level) + (withSiege ? siegeOf(level, shieldAt(hours)).xp : 0);
      const step = Math.min(need, gain / 10);
      need -= step;
      hours += step / gain / LANDINGS_AN_HOUR;
    }
    at.push(hours);
  }
  return at;
};
const levelAtHour = (at: readonly number[], hours: number): number => {
  let level = 1;
  while (level < 99 && num(at, level + 1) <= hours) level++;
  return level;
};

if (args.includes("--siege")) {
  const s = (ticks: number): string => (Number.isNaN(ticks) ? "-" : `${f(ticks / 10, 0)} s`);
  const pct = (v: number): string => `${f(100 * v, 0)}%`;
  const LANDING = 23;
  console.log(`## The growing horde, by siege time, on a level-${LANDING} landing`);
  console.log(
    row([
      "Siege",
      "Weight sent a tick, times the first",
      "Swarm",
      "Levels over the landing's",
      "Swarms a minute for each citizen awake",
    ]),
  );
  for (const t of [0, 200, 600, 900, 1_200, 1_500, 1_800, 2_400]) {
    const rate = (PRESSURE_TICKS + t) / (SIEGE_SHARE_TICKS * PRESSURE_TICKS);
    console.log(
      row([
        s(t),
        f((PRESSURE_TICKS + t) / PRESSURE_TICKS, 2),
        `${swarmFodder(t)} and a leader`,
        swarmBump(t),
        f((600 * rate * shareWeightOf(LANDING)) / (swarmFodder(t) + 3), 1),
      ]),
    );
  }

  // The worked crowd of section 1 at 15 awake, and ten times it at 150, on a
  // level-23 landing. The median roster is in ordinary gear with 5% aim. The
  // strong roster is the same crowd 10 Arms higher in the best gear (a third
  // over ordinary) with 40% aim, on the same landing.
  const MEDIAN: readonly (readonly [number, number])[] = [
    [6, 2],
    [23, 10],
    [40, 2],
    [58, 1],
  ];
  const STRONG_OVER = 10;
  const tiersAt = (awake: number, best: boolean): (readonly [number, number])[] =>
    MEDIAN.map(([a, c]) => [a + (best ? STRONG_OVER : 0), (c * awake) / 15]);
  const parts = (roster: readonly Defender[], result: SiegeResult): number[] =>
    [...new Set(roster.map((d) => d.arms))].map((arms) => {
      const mine = result.paid.filter((_, i) => roster[i]?.arms === arms);
      return sum(mine.map((p) => p.part)) / mine.length;
    });
  console.log(
    `\n## How long a shield holds on a level-${LANDING} landing, from the front at the bubble to the break`,
  );
  console.log(
    row([
      "Shield",
      "Awake",
      "Roster",
      "Nobody fights",
      "Untouched (hold)",
      "Everyone on guard",
      "First post dark (guard)",
      "Lamps lit 10 s before the break (guard)",
      "Most siege monsters on the wall (guard)",
      "Killed on hold, part of a share, by tier",
      "Most killed on guard",
    ]),
  );
  const holds: { level: number; awake: number; best: boolean; guard: number; hold: number }[] = [];
  let mostPart = 0;
  for (const level of [0, 5, 10]) {
    for (const awake of [15, 150]) {
      for (const best of [false, true]) {
        const roster = rosterOf(tiersAt(awake, best), best);
        const nobody = runSiege(roster, level, "nobody", LANDING);
        const guard = runSiege(roster, level, "guard", LANDING);
        const hold = runSiege(roster, level, "hold", LANDING);
        const onHold = parts(roster, hold);
        mostPart = Math.max(mostPart, ...onHold);
        holds.push({ level, awake, best, guard: guard.holds, hold: hold.holds });
        const before = guard.curve.filter((c) => c.t <= guard.holds - 100).at(-1);
        console.log(
          row([
            level,
            awake,
            best ? "strong" : "median",
            s(nobody.holds),
            s(hold.holds),
            s(guard.holds),
            s(guard.firstDark),
            `${before?.lit ?? "-"}/${shieldPosts(level)}`,
            guard.mostOnWall,
            onHold.map(pct).join(" / "),
            pct(Math.max(...parts(roster, guard))),
          ]),
        );
      }
    }
  }
  // Going aboard on untouched settings, over 20 draws of the posts' order.
  let leastMargin = Infinity;
  let worst = "";
  for (const level of [0, 5, 10]) {
    for (const awake of [15, 150]) {
      for (const best of [false, true]) {
        const roster = rosterOf(tiersAt(awake, best), best);
        for (let seed = 1; seed <= 20; seed++) {
          const hold = runSiege(roster, level, "hold", LANDING, seed);
          const margin = Math.min(
            ...hold.boarded.map((b, i) => hold.holds - b - (roster[i]?.wayHome ?? 0)),
          );
          if (margin < leastMargin) {
            leastMargin = margin;
            worst = `shield ${level}, ${awake} awake, ${best ? "strong" : "median"}, draw ${seed}`;
          }
        }
      }
    }
  }
  console.log(
    `untouched, over 20 draws of each row: every citizen up the ramp with its walk done at least ${s(leastMargin)} before the break (least at ${worst}); the most any tier killed on hold is ${pct(mostPart)} of its share`,
  );

  // How far lift_eta reads past the real lift-off, on every row of the hold
  // table in all three modes over 5 draws: at any tick, and at the ticks it
  // reads under a minute, where citizens go aboard by it.
  let pastAny = -Infinity;
  let pastNear = -Infinity;
  for (const level of [0, 5, 10]) {
    for (const awake of [15, 150]) {
      for (const best of [false, true]) {
        const roster = rosterOf(tiersAt(awake, best), best);
        for (const mode of ["nobody", "guard", "hold"] as const) {
          for (let seed = 1; seed <= 5; seed++) {
            const got = runSiege(roster, level, mode, LANDING, seed, DARK_TIMES, true);
            got.etas.forEach((eta, t) => {
              const past = t + eta - (got.holds + LIFT_AFTER_BREAK);
              pastAny = Math.max(pastAny, past);
              if (eta < LIFT_AFTER_BREAK + 600) pastNear = Math.max(pastNear, past);
            });
          }
        }
      }
    }
  }
  console.log(
    `lift_eta past the real lift-off, at most: ${pastAny} ticks at any tick, ${pastNear} while it reads under a minute (a negative number is never past)`,
  );
  // What piece 31's tests pin: the break with nothing killed, in ticks, which
  // is also lift_eta's part when the siege starts.
  for (const level of [0, 10]) {
    for (const awake of [15, 150]) {
      const nobody = [1, 2, 3, 4, 5].map(
        (seed) =>
          runSiege(rosterOf(tiersAt(awake, false), false), level, "nobody", LANDING, seed).holds,
      );
      console.log(
        `shield ${level}, ${awake} awake: with nothing killed it breaks ${Math.min(...nobody)} to ${Math.max(...nobody)} ticks into the siege over 5 draws`,
      );
    }
  }

  console.log("\n## The dark multiple, at shield 10 and 15 awake");
  console.log(
    row([
      "Dark arcs take",
      "Nobody fights",
      "Median on guard",
      "Strong on guard",
      "Median untouched",
    ]),
  );
  for (const times of [1, 2, 3, 4]) {
    const median = rosterOf(tiersAt(15, false), false);
    const strong = rosterOf(tiersAt(15, true), true);
    console.log(
      row([
        `${times} times`,
        s(runSiege(median, 10, "nobody", LANDING, 1, times).holds),
        s(runSiege(median, 10, "guard", LANDING, 1, times).holds),
        s(runSiege(strong, 10, "guard", LANDING, 1, times).holds),
        s(runSiege(median, 10, "hold", LANDING, 1, times).holds),
      ]),
    );
  }

  // The longest holds: once every swing kills, the swing rate is all that
  // limits a roster, and the weight sent outgrows it.
  console.log("\n## The longest holds, everyone on guard at shield 10");
  for (const awake of [15, 150]) {
    for (const [arms, landing] of [
      [20, 20],
      [33, 23],
      [33, 33],
      [58, 23],
      [99, 23],
      [58, 58],
      [99, 58],
      [99, 70],
      [99, 89],
      [99, 99],
      [99, 1],
    ] as const) {
      const got = runSiege(rosterOf([[arms, awake]], true), 10, "guard", landing);
      console.log(
        `${awake} at Arms ${arms} in the best gear on a level-${landing} landing: horde ahead at ${s(got.outpaced)}, first post dark at ${s(got.firstDark)}, breaks at ${s(got.holds)}`,
      );
    }
  }
  const strong33 = runSiege(rosterOf(tiersAt(15, true), true), 10, "guard", 33);
  console.log(
    `the strong roster of 15 on a level-33 landing, its own median, on guard at shield 10: breaks at ${s(strong33.holds)}`,
  );

  // Every landing breaks: the strongest roster there is, on every landing
  // level, where the swarms stop at level 99 and only their size and the
  // weight sent go on growing.
  for (const awake of [15, 150]) {
    let longest = 0;
    let longestAt = 0;
    let longestTo = 0;
    let shortest = Infinity;
    let from99 = SIEGE_LEVEL_MOST + 1;
    let capped = true;
    for (let landing = SIEGE_LEVEL_MOST; landing >= 1; landing--) {
      const got = runSiege(rosterOf([[99, awake]], true), 10, "guard", landing);
      if (got.holds >= SIEGE_CAP) throw new Error(`no break at ${awake} awake on level ${landing}`);
      if (got.holds > longest) [longest, longestAt, longestTo] = [got.holds, landing, landing];
      else if (got.holds === longest) longestAt = landing;
      shortest = Math.min(shortest, got.holds);
      // The swarms sent at the break, at the landing's own level, are at 99.
      capped &&= swarmLevel(landing, 0, got.holds) === SIEGE_LEVEL_MOST;
      if (capped) from99 = landing;
    }
    console.log(
      `${awake} at Arms 99 in the best gear on guard at shield 10, on every landing level from 1 to 99: every shield breaks, ${s(shortest)} to ${s(longest)} into the siege, the longest on levels ${longestAt} to ${longestTo}; from level ${from99} up every swarm sent at the break is at level 99`,
    );
  }

  // Bigger rosters hold longer: each roster above at more citizens awake, the
  // mean of 20 draws of the posts' order, and the least a size holds over the
  // size before it from 15 awake up.
  const SIZES = [5, 10, 15, 16, 20, 30, 45, 75, 150] as const;
  const DRAWS = 20;
  console.log(
    "\n## By citizens awake, from the front at the bubble to the break, the mean of 20 draws",
  );
  console.log(row(["Roster", "Landing", "Shield", "Mode", ...SIZES.map((n) => `${n} awake`)]));
  let leastGain = Infinity;
  let leastAt = "";
  let under15 = 0;
  const bySize = (
    label: string,
    landing: number,
    level: number,
    mode: "guard" | "hold",
    sizes: readonly number[],
    of: (n: number) => Defender[],
  ): void => {
    const got = sizes.map(
      (n) =>
        sum(
          Array.from(
            { length: DRAWS },
            (_, k) => runSiege(of(n), level, mode, landing, k + 1).holds,
          ),
        ) / DRAWS,
    );
    const at15 = num(got, sizes.indexOf(STATION_AWAKE));
    if (got.some((h, k) => num(sizes, k) < STATION_AWAKE && h > at15)) under15++;
    got.forEach((h, k) => {
      const before = got[k - 1];
      const n = num(sizes, k);
      if (before === undefined || n <= STATION_AWAKE) return;
      if (h - before < leastGain) {
        leastGain = h - before;
        leastAt = `${label}, level ${landing}, shield ${level}, ${mode}, ${sizes[k - 1]} to ${n} awake`;
      }
    });
    console.log(
      row([
        label,
        landing,
        level,
        mode,
        ...SIZES.map((n) => {
          const k = sizes.indexOf(n);
          return k < 0 ? "-" : s(num(got, k));
        }),
      ]),
    );
  };
  for (const [arms, landing] of [
    [20, 20],
    [33, 23],
    [33, 33],
    [58, 23],
    [99, 23],
    [58, 58],
    [99, 58],
    [99, 70],
    [99, 89],
    [99, 99],
    [99, 1],
  ] as const) {
    bySize(`Arms ${arms}, best gear`, landing, 10, "guard", SIZES, (n) =>
      rosterOf([[arms, n]], true),
    );
  }
  for (const level of [0, 5, 10]) {
    for (const best of [false, true]) {
      for (const mode of ["guard", "hold"] as const) {
        bySize(best ? "strong" : "median", LANDING, level, mode, [15, 30, 45, 75, 150], (n) =>
          rosterOf(tiersAt(n, best), best),
        );
      }
    }
  }
  console.log(
    `from 15 awake up, the least a roster holds over the next smaller one: ${f(leastGain / 10, 1)} s (${leastAt}); rows where 5 or 10 awake hold longer than 15: ${under15}`,
  );

  console.log(`\n## The siege by shield level, the median roster at 15 awake, level ${LANDING}`);
  console.log(
    row([
      "Shield",
      "Points",
      "Posts",
      "A post's condition",
      "Nobody fights",
      "Untouched",
      "Everyone on guard",
      "Killed by an Arms-23 citizen on hold, part of its share",
    ]),
  );
  for (let level = 0; level <= SHIELD_LEVELS; level++) {
    const roster = rosterOf(MEDIAN, false);
    const hold = runSiege(roster, level, "hold", LANDING);
    console.log(
      row([
        level,
        shieldPoints(level),
        shieldPosts(level),
        f(postCondition(level), 0),
        s(runSiege(roster, level, "nobody", LANDING).holds),
        s(hold.holds),
        s(runSiege(roster, level, "guard", LANDING).holds),
        pct(num(parts(roster, hold), 1)),
      ]),
    );
  }

  for (const best of [false, true]) {
    console.log(
      `\n## The curve: the ${best ? "strong" : "median"} roster at 15 awake, everyone on guard, shield 10`,
    );
    console.log(
      row([
        "Siege",
        "Alive, over the siege's weight",
        "Loss a tick",
        "The pool's loss a minute",
        "Pool left",
        "Lamps lit",
      ]),
    );
    for (const c of runSiege(rosterOf(tiersAt(15, best), best), 10, "guard", LANDING).curve) {
      if (c.t < 600 && c.t % 300 !== 0) continue;
      console.log(
        row([
          s(c.t),
          f(c.alive, 3),
          f(c.loss, 2),
          `${f((c.loss * 600 * 100) / shieldPoints(10), 0)}%`,
          f(c.left, 0),
          `${c.lit}/30`,
        ]),
      );
    }
  }

  console.log(
    "\n## The cycle: lift-off and the next transit, which is 13:00 less the lift and never under 3:00",
  );
  console.log(
    row([
      "Shield",
      "Awake",
      "Roster",
      "Who fights",
      "March",
      "Break",
      "Lift-off",
      "Next transit",
      "Cycle",
    ]),
  );
  for (const h of holds) {
    for (const [who, held] of [
      ["untouched", h.hold],
      ["on guard", h.guard],
    ] as const) {
      for (const march of [5_400, 5_700]) {
        const brk = march + MARCH_TICKS + held;
        const lift = brk + LIFT_AFTER_BREAK;
        const end = Math.max(7_800, lift);
        console.log(
          row([
            h.level,
            h.awake,
            h.best ? "strong" : "median",
            who,
            clock(march),
            clock(brk),
            clock(lift),
            clock(end - lift + LEGS_PLANT),
            clock(end),
          ]),
        );
      }
    }
  }
  process.exit(0);
}

if (args.includes("--pace")) {
  const time = (hours: number): string =>
    hours < 1
      ? `${f(hours * 60, 0)} minutes`
      : hours < 48
        ? `${f(hours)} hours`
        : `${f(hours / 24)} days`;
  const alone = hoursTo(false);
  const sieged = hoursTo(true);
  console.log("## Levels (docs/plan.md, section 2.3)");
  console.log(
    row([
      "Level",
      "From shares alone",
      "With the siege",
      "A landing's share",
      "A landing gives",
      "The siege adds",
    ]),
  );
  for (const level of [6, 10, 20, 23, 30, 40, 50, 58, 60, 70, 80, 90, 99]) {
    const siege = siegeOf(level, shieldAt(num(sieged, level)));
    console.log(
      row([
        level,
        time(num(alone, level)),
        time(num(sieged, level)),
        `${f(shareOf(level) / 100, 2)} packs`,
        f(shareXp(level), 0),
        f(siege.xp, 0),
      ]),
    );
  }
  console.log(
    `levels at hours 1, 10 and 100: ${[1, 10, 100].map((h) => levelAtHour(alone, h)).join(", ")} from shares alone; ${[1, 10, 100].map((h) => levelAtHour(sieged, h)).join(", ")} with the siege`,
  );
  console.log(
    `the order of ten: weight ${ORDER_WEIGHT}, experience ${orderXp(6)} at level 6, ${orderXp(23)} at 23, ${orderXp(58)} at 58`,
  );

  // Drops (docs/slice.md, section 3.2). Weights: salvage, magic, rare, unique.
  const WEIGHTS = [1_561, 360, 78, 1] as const;
  const kinds = (bonus: number): number[] => {
    const w = [WEIGHTS[0], WEIGHTS[1], WEIGHTS[2] * bonus, WEIGHTS[3] * bonus];
    const all = sum(w);
    return w.map((v) => v / all);
  };
  const T1 = 1 - (0.5 * (62 / 63) ** 3 + 0.5 * (62 / 63) ** 4); // a rare of 3 or 4 lines, each T1 once in 63
  interface Take {
    drops: number[];
    tools: number;
  }
  /** What some kills bring: fodder, pack monsters and brutes, with a bonus on the rare and unique weights. */
  const take = (fodder: number, pack: number, brutes: number, bonus: number): Take => {
    const plain = kinds(bonus);
    const brute = kinds(2 * bonus);
    const light = fodder * 0.04 + pack * 0.15;
    const heavy = brutes * 0.4;
    return {
      drops: plain.map((p, k) => p * light + num(brute, k) * heavy),
      tools: fodder * 0.005 + pack * 0.02 + brutes * 0.06,
    };
  };
  const rolls = (n: number): Take => ({ drops: kinds(5).map((p) => p * n), tools: 0.2 * n });
  const add = (...takes: Take[]): Take => ({
    drops: [0, 1, 2, 3].map((k) => sum(takes.map((t) => num(t.drops, k)))),
    tools: sum(takes.map((t) => t.tools)),
  });
  const cases = [
    { name: "Hour 1", arms: 6, boarders: 0, rolls: 1, hours: 1 },
    { name: "Hour 10", arms: 23, boarders: 4, rolls: 2, hours: 10 },
    { name: "Hour 100", arms: 58, boarders: 4, rolls: 2, hours: 100 },
  ];
  console.log("\n## Drops a landing (docs/slice.md, section 3.2)");
  console.log(row(["", "Salvage drops", "Magic", "Rare", "Unique", "Reroll", "Add", "Acid"]));
  for (const c of cases) {
    const packs = shareOf(c.arms) / 100;
    const share = add(take(packs * 6, packs * 1.5 + c.boarders, packs * 0.6, 1), rolls(c.rolls));
    // Boarders roll a tool at 4%, not a pack monster's 2%.
    const tools = share.tools + c.boarders * 0.02;
    const level = shieldAt(c.hours);
    const fought = siegeOf(c.arms, level);
    const swarms = fought.swarms;
    const fodderShare = (fought.monsters - swarms) / fought.monsters;
    const siege = take(fought.monsters - swarms, swarms, 0, 2);
    const line = (name: string, t: Take, tl: number): void =>
      console.log(
        row([
          name,
          f(num(t.drops, 0), 2),
          f(num(t.drops, 1), 2),
          f(num(t.drops, 2), 3),
          f(num(t.drops, 3), 4),
          f(tl * 0.8, 2),
          f(tl * 0.17, 3),
          f(tl * 0.03, 4),
        ]),
      );
    line(`${c.name}, Arms ${c.arms}: its share`, share, tools);
    line(
      `the siege at shield ${level}: ${f(swarms)} swarms, ${f(fought.monsters, 0)} monsters, ${f(fought.xp, 0)} experience, ${f(100 * fought.part, 0)}% of its share`,
      siege,
      siege.tools,
    );
    if (c.arms === 58) {
      // What can carry a T1 line: the swarm in ten of its share at 68, its two
      // rolls at the far level, and the siege's monsters at 65 or more.
      const far = take(packs * 1, packs * 0.1, 0, 1);
      const farRolls = rolls(2);
      const farSiege = take(fought.at65 * fodderShare, fought.at65 * (1 - fodderShare), 0, 2);
      const share65 = num(far.drops, 2) + num(farRolls.drops, 2);
      const all65 = share65 + num(farSiege.drops, 2);
      const hours = (rares: number): string => f(1 / (rares * T1) / LANDINGS_AN_HOUR);
      console.log(
        `  rares at 65 or more a landing: ${f(share65, 3)} from its share and two rolls (${f(num(farRolls.drops, 2), 3)} of it the rolls), ${f(num(farSiege.drops, 2), 3)} from the siege; a T1 line on ${f(100 * T1, 2)}% of them: one every ${hours(share65)} hours without the siege, ${hours(all65)} with it, ${hours(num(far.drops, 2) + num(farRolls.drops, 2) / 2)} with one roll and no siege`,
      );
    }
  }

  console.log("\n## The works, in the default order");
  console.log(row(["Built", "Cost", "Paid in all", "Hours of stream"]));
  for (const b of builtAt) {
    console.log(
      row([
        `${b.what} ${b.n}`,
        b.what === "shield" ? shieldCost(b.n) : num(CITY_COST, b.n - 1),
        b.paid,
        f(b.hours),
      ]),
    );
  }
  console.log(
    `at hours 1, 10 and 100 the city is size ${[1, 10, 100].map(cityAt).join(", ")} with shield ${[1, 10, 100].map(shieldAt).join(", ")}`,
  );
  process.exit(0);
}

if (args.includes("--growth")) {
  // The growth table: every landing of every city size, with what the frame
  // makes of it and what stands on it, and the medians of 20 stand-ins each.
  console.log(
    row([
      "City",
      "Hull",
      "Legs",
      "Feet over",
      "Landing",
      "Tiles",
      "px a tile",
      "Citizen px, art.md",
      "Hull px",
      "Deck room",
      "Bubble",
      "Beyond the feet",
      "Room",
      "Dens wait at",
      "Cap",
      "Dens",
      "Chests",
      "Shrines",
      "Wrecks",
      "Piles",
      "Seams",
      "Pockets",
      "Posts",
      "Longest walk",
      "Stations",
    ]),
  );
  for (const spec of LANDINGS) {
    const crowd = crowdsOf(spec)[0] as Crowd;
    const results: LandingResult[] = [];
    for (let seed = 1; seed <= 20; seed++)
      results.push(lay(standIn(spec, seed, extraOf(crowd)), spec, crowd, seed + 15_000));
    const med = (pick: (r: LandingResult) => number): number => median(results.map(pick));
    const city = cityOf(spec);
    console.log(
      row([
        spec.city,
        `${city.hull[0]} by ${city.hull[1]}`,
        city.legs,
        `${city.feet[0]} by ${city.feet[1]}`,
        `${spec.cls} ${sizeText(spec)}`,
        tilesOf(spec),
        tilePx(spec),
        citizenPx(spec),
        `${city.hull[0] * tilePx(spec)} (${f((100 * city.hull[0] * tilePx(spec)) / PICTURE[0], 1)}%)`,
        2 * city.hull[0] * city.hull[1],
        `${bubbleOf(city)[0]} by ${bubbleOf(city)[1]}`,
        `${f((spec.width - city.feet[0]) / 2)}, ${f((spec.height - city.feet[1]) / 2)}`,
        tilesOf(spec) > SLICE_TILES ? "#418" : roomOf(spec),
        tilesOf(spec) > SLICE_TILES ? "#418" : gateOf(spec),
        tilesOf(spec) > SLICE_TILES ? "#418" : capOf(spec),
        densOf(spec),
        chestsOf(spec),
        shrinesOf(spec),
        wrecksOf(spec),
        pilesOf(spec),
        seamsOf(spec),
        med((r) => r.pockets),
        med((r) => r.posts),
        `${f((med((r) => r.longest) * TICKS_A_STEP) / 10, 0)} s`,
        med((r) => r.stations),
      ]),
    );
  }
  process.exit(0);
}

if (mapArg !== -1) {
  // One landing as text, with 15 awake: # closed, + gate or border opened, o
  // a free post, s a share's pack, m one of the map's own, a den by its
  // letter in capitals, C chest, S shrine, W wreck, p pile, e seam, R ramp,
  // H inside a horde gap; a pocket's tiles are dots and the city's district
  // is 0. Beside it, each tile's ground level in tens, with - for under 10.
  const spec = landingOf(args[mapArg + 1]);
  const seed = Number(args[mapArg + 2] ?? 1);
  const crowd = crowdsOf(spec)[0] as Crowd;
  const ground = groundOf(spec, seed, crowd);
  const laid = lay(ground, spec, crowd, seed + 15_000);
  const marks = new Map<number, string>();
  for (const t of laid.postTiles) marks.set(t, "o");
  for (const t of laid.shareTiles) marks.set(t, "s");
  for (const t of laid.ownTiles) marks.set(t, "m");
  laid.denTiles.forEach((t, n) => {
    marks.set(t, laid.denLetters[n] as string);
  });
  for (const t of laid.chestTiles) marks.set(t, "C");
  for (const t of laid.shrineTiles) marks.set(t, "S");
  for (const t of laid.wreckTiles) marks.set(t, "W");
  for (const t of ground.piles) marks.set(t, "p");
  for (const t of laid.seamTiles) marks.set(t, "e");
  for (const t of ground.gaps) marks.set(t, "H");
  marks.set(ground.ramp, "R");
  for (let y = 0; y < ground.height; y++) {
    let line = "";
    let levels = "";
    for (let x = 0; x < ground.width; x++) {
      const i = y * ground.width + x;
      const d = num(ground.district, i);
      line += marks.get(i) ?? (!ground.open[i] ? "#" : d < 0 ? "+" : d === 0 ? "0" : ".");
      const v = num(laid.levelOf, i);
      levels += v < 0 ? " " : v < 10 ? "-" : String(Math.floor(v / 10));
    }
    console.log(`${line}   ${levels}`);
  }
  console.log(
    `${spec.key}, ${sizeText(spec)}, seed ${seed}: ${ground.pockets} pockets, longest walk ${laid.longest} tiles, ${laid.standingAtPlant} standing of a room of ${roomOf(spec)}, ${laid.ownMonsters} of them the map's own, ${laid.stations} stations`,
  );
  process.exit(0);
}

const chosen = LANDINGS.filter((l) =>
  onlyLanding ? l.key === onlyLanding : l.city <= 2 && tilesOf(l) <= SLICE_TILES,
);
if (chosen.length === 0) landingOf(onlyLanding);
console.log(
  `${useGenerator ? "generateLanding's maps" : "stand-in maps"}, ${seedCount} landings a size`,
);
for (const spec of chosen) {
  if (useGenerator && !hasGenerator(spec)) {
    console.log(`\n## ${spec.key}: the generator has no map of this size and hull`);
    continue;
  }
  for (const crowd of crowdsOf(spec)) {
    const results: LandingResult[] = [];
    for (let seed = 1; seed <= seedCount; seed++) {
      results.push(lay(groundOf(spec, seed, crowd), spec, crowd, seed + 1_000 * awakeOf(crowd)));
    }
    const all = (pick: (r: LandingResult) => number): number[] => results.map(pick);
    const flat = (pick: (r: LandingResult) => number[]): number[] => results.flatMap(pick);
    const span = (list: number[]): string =>
      `${Math.min(...list)} to ${Math.max(...list)}, median ${median(list)}`;
    console.log(
      `\n## ${spec.key}: city ${spec.city}, ${spec.cls}, ${sizeText(spec)}, level ${levelOfLanding(spec)}, ${crowd.name} awake`,
    );
    if (crowd.name === "15") {
      const walk = all((r) => (r.longest * TICKS_A_STEP) / 10);
      console.log(`pockets: ${span(all((r) => r.pockets))}`);
      console.log(
        `sides of the city with a pocket: ${span(all((r) => r.sides))}; all four on ${all((r) => r.sides).filter((v) => v === 4).length} of ${results.length}`,
      );
      console.log(
        `longest walk from the ramp: median ${median(all((r) => r.longest))} tiles, ${f(median(walk))} s unloaded; 90th percentile ${f(pct(walk, 90))} s`,
      );
      console.log(
        `the longest walk out of the yard: median ${median(all((r) => r.outmost))} tiles (a third of it ${median(all((r) => r.ring1))}, two thirds ${median(all((r) => r.ring2))})`,
      );
      console.log(
        `the march from 9:00: half of the far ground (the pockets at the far level) is taken by ${clock(median(all((r) => r.farHalf)))} and all by ${clock(median(all((r) => r.farAll)))} at the median (all by ${clock(
          pct(
            all((r) => r.farAll),
            10,
          ),
        )} to ${clock(
          pct(
            all((r) => r.farAll),
            90,
          ),
        )}, 10th to 90th percentile); ${f(100 * mean(all((r) => r.farBehind)), 0)}% of it is on the far side of the city's middle from the ramp`,
      );
      console.log(
        `pocket ground in rings 1, 2 and 3 is half taken by ${[0, 1, 2].map((k) => clock(median(all((r) => num(r.ringTaken, k))))).join(", ")} at the median`,
      );
      console.log(
        `ground taken when the front marches, and 15, 30, 45 and 60 s into the march: ${[0, 1, 2, 3, 4].map((k) => `${f(100 * median(all((r) => num(r.takenShare, k))), 0)}%`).join(", ")}`,
      );
      console.log(
        `taken ground cut off from the black, 20, 40 and 60 s in: ${f(100 * mean(all((r) => r.islands)), 1)}%; the front moves at ${f(median(all((r) => num(r.frontPace, 0))))} to ${f(median(all((r) => num(r.frontPace, 1))))} ticks a tile (10th to 90th percentile of the ground, median landing)`,
      );
      console.log(
        `the bubble: ${median(all((r) => r.edge))} tiles of its edge have open ground outside them, and the wall has ${span(all((r) => r.stations))} stations`,
      );
      console.log(
        `pocket tiles beyond the yard at 12 or under: median ${median(all((r) => r.newcomerTiles))}; posts among them: median ${median(all((r) => r.newcomerPosts))}, fewest ${Math.min(...all((r) => r.newcomerPosts))}`,
      );
    }
    console.log(
      `posts ${span(all((r) => r.posts))}; piles ${median(all((r) => r.piles))}; seams ${median(all((r) => r.seamTiles.length))}; dens ${median(all((r) => r.dens))}; chests ${median(all((r) => r.chests))}; shrines ${median(all((r) => r.shrineTiles.length))}; wrecks ${median(all((r) => r.wreckTiles.length))}; posts in a den's pocket: ${[0, 1, 2, 3].map((k) => `${k}${k === 3 ? "+" : ""} for ${flat((r) => r.denPostCounts).filter((v) => (k === 3 ? v >= 3 : v === k)).length}`).join(", ")} of ${flat((r) => r.denPostCounts).length} dens`,
    );
    console.log(
      `the highest den's elite: level ${median(all((r) => r.topElite))} at the median, 65 or more on ${all((r) => r.topElite).filter((v) => v >= 65).length} of ${results.length}; the highest chest: level ${median(all((r) => r.topChest))}, 65 or more on ${all((r) => r.topChest).filter((v) => v >= 65).length}`,
    );
    console.log(
      `the near den: walk from the ramp ${f(median(all((r) => r.nearDenWalk)))} s at the median; dens' levels at the median landing: ${results[Math.floor(results.length / 2)]?.denLevels.join(", ")}`,
    );
    console.log(
      `standing at legs-plant, elites and guards counted: ${span(all((r) => r.standingAtPlant))} of a room of ${roomOf(spec)}; the map's own packs: median ${median(all((r) => r.ownMonsters))} monsters, most ${Math.max(...all((r) => r.ownMonsters))}, ${f(mean(all((r) => r.ownHigh)), 1)} of them at 65 or more; waiting in dens: median ${median(all((r) => r.waitingInDens))}`,
    );
    console.log(
      `the halves test: the smaller half holds ${f(100 * median(all((r) => r.lightHalf)), 0)}% of what stands at the median, ${f(100 * Math.min(...all((r) => r.lightHalf)), 0)}% at the least; under a fifth on ${all((r) => r.lightHalf).filter((v) => v < 0.2).length} of ${results.length}`,
    );
    console.log(
      `packs a den holds: median ${median(flat((r) => r.denPacks))}, most ${Math.max(...flat((r) => r.denPacks))}; ticks between its packs after the first two: median ${median(flat((r) => r.denInterval).filter((v) => v > 0))}, least ${Math.min(...flat((r) => r.denInterval).filter((v) => v > 0))}`,
    );
    console.log(
      `a den is covered by the march at ${clock(median(flat((r) => r.denCovered)))} at the median, ${clock(Math.min(...flat((r) => r.denCovered)))} at the earliest`,
    );
    console.log(
      row([
        "Arms",
        "Citizens",
        "Share, monsters",
        "Standing",
        "In dens",
        "Laid",
        "Pay",
        "Paid",
        "Walk to its packs",
        "To its den",
        "Its posts covered",
      ]),
    );
    for (const [arms, n] of crowd.tiers) {
      const tier = (r: LandingResult): TierResult => r.tiers.get(arms) as TierResult;
      const whole = sum(results.flatMap((r) => tier(r).whole));
      const laid = sum(results.flatMap((r) => tier(r).laid));
      const pay = results.flatMap((r) => tier(r).pay);
      const capped = sum(all((r) => tier(r).capped));
      const paid = sum(results.flatMap((r) => tier(r).paid));
      const highDue = sum(all((r) => tier(r).highDue));
      const highLaid = sum(all((r) => tier(r).highLaid));
      console.log(
        row([
          arms,
          n,
          f(mean(results.flatMap((r) => tier(r).shareMonsters)), 0),
          f(mean(results.flatMap((r) => tier(r).standing)), 0),
          f(mean(results.flatMap((r) => tier(r).waiting)), 0),
          `${f((100 * laid) / whole, 0)}%`,
          f(paid / laid, 2),
          `${f((100 * paid) / whole, 0)}%`,
          `${f(median(results.flatMap((r) => tier(r).walk)))} s`,
          `${f(median(results.flatMap((r) => tier(r).denWalk)))} s`,
          clock(median(results.flatMap((r) => tier(r).covered))),
        ]),
      );
      console.log(
        `  (one citizen's pay: median ${f(median(pay), 2)}; held at ${PAY_CAP / 100} for ${capped} of ${n * results.length} shares; nothing laid for ${n * results.length - pay.length}${highDue > 0 ? `; ${f(highLaid / (n * results.length), 1)} of its monsters laid at 65 or more, against ${f(highDue / (n * results.length), 1)} due there` : ""})`,
      );
    }
  }
}
