// The landings the look target is drawn on (docs/art.md, sections 4 and 8):
// ground in plan, things standing up on it at the lean, and pockets on every
// side of the city, each with something to take. The mid city's landing, 80
// by 45 tiles, comes from a small seeded helper (`growMid`), not from the
// game's generator; the expedition, the reveal and `expedition-b` are drawn on
// it. The 62 by 34 map laid out by hand and `growLanding` are kept only for
// the late ring, which the shield siege replaces. Distances are in tiles from
// the map's corner.

import { CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER } from "./draw.ts";
import { clamp, easeOutBack, hash, lerp, mix, noise1, noise2, rng, spline } from "./geom.ts";
import { BACK, castShadow, OXIDE, SHADOW, UP } from "./stage.ts";
import { BRASS, IRON, TIMBER } from "./topcity.ts";
import { drawMass, drawThingAt, type Mass, type Reveal, SHOWN, VALE_COLOURS } from "./vale.ts";

const { GROUND, GROWTH, GROWTH_DEEP, WATER, ROCK, STONE, FLOWER } = VALE_COLOURS;

export type PocketKind = "den" | "chest" | "seam" | "nest" | "scrap";

export interface Pocket {
  /** From 1, as the brief's table numbers them. */
  n: number;
  x: number;
  y: number;
  kind: PocketKind;
  /** A den's level, and which of three builds it is. */
  level: number;
  build: number;
  /** Scrap heaps in or beside the pocket. */
  heaps: [number, number][];
  /** A den's letter, what a chatter types to send a citizen there. */
  letter?: string;
}

export interface Landing {
  size: "Medium" | "Large";
  cols: number;
  rows: number;
  /** Pixels a tile, and where the map's corner is on screen. */
  T: number;
  ox: number;
  oy: number;
  /** The ground under the middle of the hull. */
  city: { x: number; y: number };
  rampSide: 1 | -1;
  levels: readonly [number, number];
  patches: { x: number; y: number; r: number; rgb: number; alpha: number; seed: number }[];
  river: number[];
  left: number[];
  right: number[];
  /** Stepping stones where a path crosses the river. */
  fords: [number, number][];
  paths: number[][];
  clumps: { x: number; y: number; kind: number; seed: number }[];
  masses: Mass[];
  /** Standing things: x, y, kind (as vale.ts numbers them), size. */
  things: [number, number, number, number][];
  pockets: Pocket[];
}

// ---------------------------------------------------------------- shared building

function riverBanks(centre: number[]): { river: number[]; left: number[]; right: number[] } {
  const river: number[] = [];
  spline(centre, centre.length / 2, 0.6, false, river);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < river.length / 2; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(river.length / 2 - 1, i + 1);
    const tx = (river[b * 2] as number) - (river[a * 2] as number);
    const ty = (river[b * 2 + 1] as number) - (river[a * 2 + 1] as number);
    const tl = Math.hypot(tx, ty) || 1;
    const w = 0.75 + 0.25 * noise1(i / 5, 71);
    left.push(
      (river[i * 2] as number) + (ty / tl) * w,
      (river[i * 2 + 1] as number) - (tx / tl) * w,
    );
    right.push(
      (river[i * 2] as number) - (ty / tl) * w,
      (river[i * 2 + 1] as number) + (tx / tl) * w,
    );
  }
  return { river, left, right };
}

export function distToRiver(river: number[], x: number, y: number): number {
  let best = 99;
  for (let i = 0; i < river.length; i += 2)
    best = Math.min(best, Math.hypot(x - (river[i] as number), y - (river[i + 1] as number)));
  return best;
}

export function distToPaths(paths: number[][], x: number, y: number): number {
  let best = 99;
  for (const p of paths)
    for (let i = 0; i < p.length; i += 2)
      best = Math.min(best, Math.hypot(x - (p[i] as number), y - (p[i + 1] as number)));
  return best;
}

/** How far a point is outside the hull and its feet, roughly: 0 under it. */
export function fromHull(city: { x: number; y: number }, x: number, y: number): number {
  const dx = Math.max(0, Math.abs(x - city.x) - 7.6);
  const dy = Math.max(0, Math.abs(y - city.y) - 2.4);
  return Math.hypot(dx, dy);
}

function woodRow(
  x0: number,
  x1: number,
  y: number,
  height: number,
  strength: number,
  seed: number,
  rgb = GROWTH,
): Mass {
  const base: number[] = [];
  for (let x = x0; x <= x1 + 0.01; x += 1.4) base.push(x, y + noise1(x / 5 + seed, seed) * 1.1);
  return { base, height, strength, rgb, seed, kind: "wood" };
}

function cragRow(x0: number, x1: number, y: number, height: number, seed: number): Mass {
  const base: number[] = [];
  for (let x = x0; x <= x1 + 0.01; x += 1.7) base.push(x, y + noise1(x / 4 + seed, seed) * 0.8);
  return { base, height, strength: 1, rgb: ROCK, seed, kind: "crag" };
}

function groundMarks(
  random: () => number,
  cols: number,
  rows: number,
  river: number[],
  city: { x: number; y: number },
  count: number,
): Landing["clumps"] {
  const clumps: Landing["clumps"] = [];
  for (let i = 0; i < count; i++) {
    const x = lerp(-1, cols + 1, random());
    const y = lerp(-1, rows + 1, random());
    const density = noise2(x / 3.2, y / 3.2, 81) * 1.25 - 0.1;
    if (density < 0.5 + random() * 0.35) continue;
    if (distToRiver(river, x, y) < 1.3) continue;
    if (Math.abs(x - city.x) < 7 && Math.abs(y - city.y + 0.5) < 2.5) continue;
    clumps.push({ x, y, kind: random() < 0.72 ? 0 : random() < 0.6 ? 1 : 2, seed: i });
  }
  return clumps;
}

// ---------------------------------------------------------------- the medium map

const MEDIUM_RIVER = [44, -1.5, 43, 5, 46.5, 11, 45, 17, 48, 23.5, 46, 29.5, 49, 36.5];
const MEDIUM_PATHS: number[][] = [
  [40, 18.6, 43, 18, 45.6, 17.2, 49, 15, 51.5, 12.5],
  [45.6, 17.2, 48.5, 20.5, 51, 24.5],
  [23.5, 19.6, 18, 19.2, 12, 18.9, 6.5, 19.2],
  [18, 19.2, 16.4, 15.5, 14.2, 12.4],
  [14, 19.1, 12.6, 22.5, 11.6, 24.6],
  [36, 22.6, 34, 25, 32.4, 28.5],
  [33.5, 24.8, 38, 26.4, 40.6, 28.2],
  [26, 13, 24, 9, 22.2, 6.6],
  [33, 13.2, 33.8, 9, 34.2, 6.4],
];

/** Scenery that is not a pocket: trees, bushes, boulders, stones, the ruin, the wreck, bones. */
const MEDIUM_THINGS: [number, number, number, number][] = [
  [5.0, 15.6, 0, 2.4],
  [7.2, 23.6, 1, 2.6],
  [20.6, 23.4, 2, 2.4],
  [24.2, 29.6, 0, 2.2],
  [28.5, 4.4, 3, 2.4],
  [17.4, 7.6, 1, 2.6],
  [36.8, 26.0, 0, 2.5],
  [40.6, 9.4, 2, 2.3],
  [49.2, 17.6, 1, 2.5],
  [53.5, 23.6, 0, 2.2],
  [60.0, 24.6, 4, 2.4],
  [50.0, 7.6, 0, 2.2],
  [2.4, 24.2, 4, 2.2],
  [37.8, 11.2, 3, 2.1],
  [13.4, 31.2, 0, 2.2],
  [61.4, 30.6, 1, 2.3],
  [27.6, 24.8, 1, 2.0],
  [21.6, 13.4, 5, 0.9],
  [37.6, 22.8, 5, 0.8],
  [8.8, 21.2, 5, 0.9],
  [25.4, 7.8, 5, 0.8],
  [51.2, 29.8, 5, 0.9],
  [33.6, 26.6, 6, 0.8],
  [18.8, 26.2, 6, 0.7],
  [44.8, 8.2, 6, 0.9],
  [57.8, 14.6, 6, 0.8],
  [5.8, 11.6, 6, 0.7],
  [26.2, 9.4, 8, 1.3],
  [27.1, 9.0, 8, 1.0],
  [44.1, 19.0, 10, 0.9],
  [12.4, 11.2, 14, 0.9],
  [30.2, 31.2, 14, 1.0],
  [55.0, 23.4, 14, 0.8],
  [59.8, 18.0, 7, 4.2],
  [11.0, 25.0, 11, 2.8],
];

/** The thirteen pockets of the brief's table, in its order. */
const MEDIUM_POCKETS: Pocket[] = [
  { n: 1, x: 10, y: 9.2, kind: "den", level: 28, build: 0, heaps: [] },
  { n: 2, x: 4.4, y: 19, kind: "den", level: 31, build: 1, heaps: [] },
  { n: 3, x: 53.2, y: 11, kind: "chest", level: 0, build: 0, heaps: [] },
  { n: 4, x: 25, y: 5.2, kind: "chest", level: 0, build: 1, heaps: [] },
  { n: 5, x: 34.2, y: 5, kind: "seam", level: 0, build: 0, heaps: [] },
  { n: 6, x: 57, y: 20.6, kind: "den", level: 34, build: 2, heaps: [] },
  {
    n: 7,
    x: 56.4,
    y: 26.6,
    kind: "nest",
    level: 0,
    build: 0,
    heaps: [
      [53.6, 28.6],
      [58.8, 29.4],
    ],
  },
  {
    n: 8,
    x: 32,
    y: 30,
    kind: "scrap",
    level: 0,
    build: 0,
    heaps: [
      [30.4, 29.4],
      [34.4, 30.6],
    ],
  },
  {
    n: 9,
    x: 17.4,
    y: 29.4,
    kind: "scrap",
    level: 0,
    build: 0,
    heaps: [
      [16.2, 29.2],
      [19.4, 30.4],
    ],
  },
  { n: 10, x: 8.6, y: 27.6, kind: "chest", level: 0, build: 2, heaps: [] },
  { n: 11, x: 41.4, y: 29.6, kind: "den", level: 23, build: 1, heaps: [] },
  {
    n: 12,
    x: 46.4,
    y: 4.4,
    kind: "scrap",
    level: 0,
    build: 0,
    heaps: [
      [45.0, 4.4],
      [48.2, 5.2],
    ],
  },
  {
    n: 13,
    x: 51.6,
    y: 20.4,
    kind: "scrap",
    level: 0,
    build: 0,
    heaps: [
      [50.6, 21.2],
      [53.4, 19.6],
    ],
  },
];

let medium: Landing | null = null;

/** The medium map of the mockups, 62 by 34 tiles at 30 px, with the city at (31, 18). */
export function mediumLanding(): Landing {
  if (medium) return medium;
  const random = rng(3620362);
  const city = { x: 31, y: 18 };
  const patches: Landing["patches"] = [];
  for (let i = 0; i < 30; i++)
    patches.push({
      x: lerp(-2, 64, random()),
      y: lerp(-1, 36, random()),
      r: 5 + random() * 5,
      rgb: GROUND,
      alpha: 0.24,
      seed: i * 7 + 1,
    });
  for (let i = 0; i < 16; i++)
    patches.push({
      x: lerp(0, 62, random()),
      y: lerp(0, 34, random()),
      r: 2.5 + random() * 3,
      rgb: GROWTH,
      alpha: 0.16,
      seed: i * 11 + 3,
    });
  for (const [x, y, r] of [
    [5, 7.5, 4],
    [19, 3.2, 5],
    [39, 4.8, 3.5],
    [39, 33, 5],
    [4, 29.2, 3.5],
    [1, 13.8, 3],
  ] as const)
    patches.push({ x, y, r, rgb: 0x8ea673, alpha: 0.34, seed: Math.round(x * 13 + y) });
  for (let i = 0; i < 5; i++)
    patches.push({
      x: 56 + random() * 7,
      y: 4 + random() * 6,
      r: 2.5 + random() * 2.5,
      rgb: ROCK,
      alpha: 0.38,
      seed: i * 13 + 5,
    });
  patches.push({ x: city.x + 1, y: city.y + 0.8, r: 7, rgb: 0xcfc7a2, alpha: 0.4, seed: 909 });
  const { river, left, right } = riverBanks(MEDIUM_RIVER);
  const paths = MEDIUM_PATHS.map((p) => {
    const out: number[] = [];
    spline(p, p.length / 2, 0.5, false, out);
    return out;
  });
  const clumps = groundMarks(random, 62, 34, river, city, 4200);
  const masses: Mass[] = [
    woodRow(12, 27, 1.6, 2.6, 0.6, 42, GROWTH_DEEP),
    woodRow(0, 7.5, 6.2, 3.0, 1, 41),
    woodRow(36, 41.5, 3.8, 3.0, 1, 43),
    cragRow(56.5, 64, 6.8, 3.4, 44),
    woodRow(33, 38.5, 33.6, 3.0, 1, 45),
    woodRow(0, 6.0, 31.6, 2.8, 1, 46),
    woodRow(-1, 2.0, 13.2, 2.6, 0.85, 47, GROWTH_DEEP),
    woodRow(20, 25, 33.8, 2.6, 1, 48),
    woodRow(44.5, 48.5, 33.4, 2.8, 1, 49),
    cragRow(13.5, 17.5, 22.8, 2.2, 50),
  ];
  medium = {
    size: "Medium",
    cols: 62,
    rows: 34,
    T: 30,
    ox: 20,
    oy: 20,
    city,
    rampSide: 1,
    levels: [23, 68],
    patches,
    river,
    left,
    right,
    fords: [
      [44.9, 17.0],
      [45.4, 17.12],
      [45.9, 17.24],
      [46.4, 17.36],
    ],
    paths,
    clumps,
    masses,
    things: MEDIUM_THINGS,
    pockets: MEDIUM_POCKETS,
  };
  return medium;
}

// ---------------------------------------------------------------- the helper

export interface GrowOptions {
  seed: number;
  size: "Medium" | "Large";
  rampSide: 1 | -1;
}

/** What a helper landing holds, by size: dens and chests, then scrap, seams and a nest. */
const CONTENTS = {
  Medium: { pockets: 13, dens: 4, chests: 3, nests: 1, seams: 1 },
  Large: { pockets: 37, dens: 15, chests: 13, nests: 1, seams: 1 },
} as const;

/**
 * A landing from a seed: pocket centres at least 9 tiles apart and clear of
 * the hull, a wood or crag mass between neighbours with a gap in it, one
 * river that misses the city, worn paths from the ramp through the gaps,
 * and contents from one table.
 */
export function growLanding(o: GrowOptions): Landing {
  const random = rng(o.seed * 7919 + 17);
  const large = o.size === "Large";
  const cols = large ? 80 : 62;
  const rows = large ? 45 : 34;
  const T = large ? 23 : 30;
  const ox = 20 + (1880 - cols * T) / 2;
  const oy = 20 + (1040 - rows * T) / 2;
  const city = { x: cols / 2 + (random() - 0.5) * 2, y: rows / 2 + (random() - 0.5) * 1.5 };
  const want = CONTENTS[o.size];
  // The corner slips, in tiles, where nothing worth finding may sit.
  const corners = [
    [0, 0, 270 / T, 150 / T],
    [cols - 240 / T, 0, cols, 170 / T],
    [0, rows - 100 / T, 720 / T, rows],
    [cols - 430 / T, rows - 100 / T, cols, rows],
  ];
  const inCorner = (x: number, y: number): boolean =>
    corners.some(
      ([x0, y0, x1, y1]) =>
        x > (x0 as number) - 2 &&
        x < (x1 as number) + 2 &&
        y > (y0 as number) - 2 &&
        y < (y1 as number) + 2,
    );
  const spots: [number, number][] = [];
  for (let tries = 0; tries < 20000 && spots.length < want.pockets; tries++) {
    const x = 3 + random() * (cols - 6);
    const y = 3 + random() * (rows - 6);
    if (
      fromHull(city, x, y) < 5.5 ||
      Math.hypot(x - city.x, (y - city.y) * 1.6) < (large ? 11 : 13)
    )
      continue;
    if (inCorner(x, y)) continue;
    if (spots.some(([px, py]) => Math.hypot(px - x, py - y) < (large ? 7.4 : 9))) continue;
    spots.push([x, y]);
  }
  // Contents from one table: dens where the walk is longest, chests nearer, the rest scrap and seams.
  const byWalk = spots
    .map((s, i) => ({ i, d: Math.hypot(s[0] - city.x, s[1] - city.y) }))
    .sort((a, b) => b.d - a.d);
  const kinds: PocketKind[] = new Array(spots.length).fill("scrap");
  let dens = 0;
  let chests = 0;
  for (const { i } of byWalk) {
    if (dens < want.dens && (dens <= chests * 1.4 || chests >= want.chests)) {
      kinds[i] = "den";
      dens++;
    } else if (chests < want.chests) {
      kinds[i] = "chest";
      chests++;
    }
  }
  const rest = byWalk.filter(({ i }) => kinds[i] === "scrap");
  if (rest[0]) kinds[rest[0].i] = "nest";
  if (rest[rest.length - 1] && rest.length > 1)
    kinds[(rest[rest.length - 1] as { i: number }).i] = "seam";
  const pockets: Pocket[] = spots.map(([x, y], i) => {
    const kind = kinds[i] as PocketKind;
    const far = Math.hypot(x - city.x, y - city.y) / Math.hypot(cols / 2, rows / 2);
    const lo = large ? 31 : 23;
    const hi = large ? 76 : 68;
    const heaps: [number, number][] =
      kind === "scrap" || kind === "nest"
        ? [
            [x - 1.6 + random() * 0.6, y + 0.6 + random() * 0.8],
            [x + 1.4 + random() * 0.6, y - 0.4 + random() * 0.8],
          ]
        : [];
    return {
      n: i + 1,
      x,
      y,
      kind,
      level: Math.round(lerp(lo, hi, clamp(far))),
      build: i % 3,
      heaps,
    };
  });
  // The river: rim to rim, a third of the way across on one side, missing the city.
  const side = random() < 0.5 ? -1 : 1;
  const rx = city.x + side * (12 + random() * (cols / 2 - 18));
  const centre: number[] = [];
  for (let y = -1.5; y <= rows + 2; y += 5.5)
    centre.push(rx + noise1(y / 6, o.seed + 3) * 3.2 + (random() - 0.5), y);
  const { river, left, right } = riverBanks(centre);
  // Worn paths from the ramp's foot to each pocket, bending a little.
  const foot = { x: city.x + 5, y: city.y + o.rampSide * 4.4 };
  const paths: number[][] = [];
  const fords: [number, number][] = [];
  for (const p of pockets) {
    const mx = (foot.x + p.x) / 2 + (random() - 0.5) * 4;
    const my = (foot.y + p.y) / 2 + (random() - 0.5) * 3;
    // Round the hull rather than under it, for a pocket on the other side of the ramp.
    const ctrl: number[] = [foot.x, foot.y];
    if ((p.y - city.y) * o.rampSide < -3) {
      const sideX = p.x < city.x ? city.x - 10 : city.x + 10;
      ctrl.push(sideX, city.y + o.rampSide * 3.5);
    }
    ctrl.push(mx, my, p.x, p.y + 1.2);
    const out: number[] = [];
    spline(ctrl, ctrl.length / 2, 0.5, false, out);
    paths.push(out);
    for (let i = 0; i + 2 < out.length; i += 2)
      if (distToRiver(river, out[i] as number, out[i + 1] as number) < 0.4) {
        const fx = out[i] as number;
        const fy = out[i + 1] as number;
        if (!fords.some(([x, y]) => Math.hypot(x - fx, y - fy) < 4))
          for (let s = -1.5; s <= 1.5; s += 1) fords.push([fx + s * 0.5, fy + s * 0.12]);
        break;
      }
  }
  // Masses between neighbours, cut back where a path runs through: that is the gap.
  const masses: Mass[] = [];
  const clearOf = (x: number, y: number): boolean =>
    fromHull(city, x, y) > 3.5 &&
    !pockets.some((p) => Math.hypot(p.x - x, p.y - y) < 4.2) &&
    distToRiver(river, x, y) > 1.6 &&
    distToPaths(paths, x, y) > 1.6 &&
    !inCorner(x, y) &&
    x > 0.5 &&
    x < cols - 0.5;
  let seed = 400;
  for (let i = 0; i < pockets.length; i++)
    for (let j = i + 1; j < pockets.length; j++) {
      const a = pockets[i] as Pocket;
      const b = pockets[j] as Pocket;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (gap > (large ? 15 : 17)) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const crag = random() < 0.25;
      const pieces: [number, number][] = [];
      if (Math.abs(a.x - b.x) > Math.abs(a.y - b.y)) {
        // Side by side: short rows stacked up the line between them.
        for (let k = -2; k <= 2; k++) pieces.push([mx + (random() - 0.5) * 1.2, my + k * 1.7]);
      } else for (let k = -3; k <= 3; k++) pieces.push([mx + k * 1.5, my + (random() - 0.5) * 0.8]);
      let run: [number, number][] = [];
      const flush = (): void => {
        if (run.length >= 2) {
          const xs = run.map((r) => r[0]);
          const ys = run.map((r) => r[1]);
          const x0 = Math.min(...xs) - 0.8;
          const x1 = Math.max(...xs) + 0.8;
          const y = ys.reduce((s, v) => s + v, 0) / ys.length;
          seed++;
          masses.push(
            crag
              ? cragRow(x0, x1, y, 2.6, seed)
              : woodRow(
                  x0,
                  x1,
                  y,
                  2.6 + random() * 0.5,
                  1,
                  seed,
                  random() < 0.3 ? GROWTH_DEEP : GROWTH,
                ),
          );
        } else if (run.length === 1) {
          const [x, y] = run[0] as [number, number];
          seed++;
          masses.push(woodRow(x - 1.2, x + 1.2, y, 2.4, 1, seed));
        }
        run = [];
      };
      for (const pc of pieces) {
        if (clearOf(pc[0], pc[1])) run.push(pc);
        else flush();
      }
      flush();
    }
  // Woods along parts of the rim, under where the black will lie.
  for (let x = 2; x < cols - 4; x += 9 + random() * 6)
    if (!inCorner(x, 1) && random() < 0.6)
      masses.push(woodRow(x, x + 4 + random() * 3, 1.2, 2.6, 0.8, ++seed, GROWTH_DEEP));
  // Scenery: trees, bushes and boulders on open ground, bones near dens.
  const things: Landing["things"] = [];
  for (let tries = 0; tries < (large ? 900 : 520) && things.length < (large ? 80 : 46); tries++) {
    const x = 1 + random() * (cols - 2);
    const y = 1.5 + random() * (rows - 2.5);
    if (!clearOf(x, y)) continue;
    if (
      masses.some(
        (m) =>
          Math.abs((m.base[1] as number) - y) < 1.6 &&
          x > (m.base[0] as number) - 1.5 &&
          x < (m.base[m.base.length - 2] as number) + 1.5,
      )
    )
      continue;
    if (things.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 2.2)) continue;
    const k = random();
    things.push(
      k < 0.6
        ? [x, y, Math.floor(random() * 5), 2.1 + random() * 0.5]
        : k < 0.8
          ? [x, y, 5, 0.8 + random() * 0.15]
          : [x, y, 6, 0.7 + random() * 0.25],
    );
  }
  for (const p of pockets) if (p.kind === "den") things.push([p.x + 2.6, p.y + 1.4, 14, 0.9]);
  const patches: Landing["patches"] = [];
  for (let i = 0; i < (large ? 46 : 30); i++)
    patches.push({
      x: lerp(-2, cols + 2, random()),
      y: lerp(-1, rows + 1, random()),
      r: 5 + random() * 5,
      rgb: GROUND,
      alpha: 0.24,
      seed: i * 7 + 1,
    });
  for (let i = 0; i < (large ? 26 : 16); i++)
    patches.push({
      x: lerp(0, cols, random()),
      y: lerp(0, rows, random()),
      r: 2.5 + random() * 3,
      rgb: GROWTH,
      alpha: 0.16,
      seed: i * 11 + 3,
    });
  for (const p of pockets)
    if (p.kind === "den")
      patches.push({ x: p.x, y: p.y, r: 3.2, rgb: 0x8ea673, alpha: 0.3, seed: p.n * 17 });
  patches.push({ x: city.x + 1, y: city.y + 0.8, r: 7, rgb: 0xcfc7a2, alpha: 0.4, seed: 909 });
  const clumps = groundMarks(random, cols, rows, river, city, large ? 7000 : 4200);
  return {
    size: o.size,
    cols,
    rows,
    T,
    ox,
    oy,
    city,
    rampSide: o.rampSide,
    levels: large ? [31, 76] : [23, 68],
    patches,
    river,
    left,
    right,
    fords,
    paths,
    clumps,
    masses,
    things,
    pockets,
  };
}

// ---------------------------------------------------------------- the mid city's landing

/** The mid city's landing: 80 by 45 tiles at 23 px a tile, the whole of it in frame. */
export const MID = { cols: 80, rows: 45, T: 23 } as const;

export interface MidOptions {
  seed: number;
  rampSide: 1 | -1;
  /**
   * Pockets wanted in given directions from the city, with what they hold:
   * angle in radians (0 east, a quarter turn south), and how far, in tiles.
   */
  roles?: readonly { angle: number; kind: PocketKind; far: number }[];
}

export interface MidLanding extends Landing {
  /** The pocket given each role, in the order asked. */
  roles: number[];
  /** The corner slips, in tiles: nothing worth finding sits under them. */
  corners: readonly (readonly [number, number, number, number])[];
}

/** What the 26 pockets hold: eight dens, six chests, three nests, two seams, the rest scrap. */
const MID_HOLDS = { pockets: 26, dens: 8, chests: 6, nests: 3, seams: 2 } as const;
const LETTERS = "ABCDEFGH";

/**
 * The mid city's landing from a seed (the art brief of 28 November on #362,
 * section 3): 26 pockets laid one at a time, each the candidate farthest from
 * those already laid; woods and crags between neighbours, with a gap where a
 * path goes through; one river through the gaps; worn paths from the ramp.
 * Every pocket is bounded on two sides or more by a wood, a crag, the river
 * or the map's edge.
 */
export function growMid(o: MidOptions): MidLanding {
  const random = rng(o.seed * 7919 + 29);
  const { cols, rows, T } = MID;
  const ox = 20 + (1880 - cols * T) / 2;
  const oy = 20 + (1040 - rows * T) / 2;
  const city = { x: cols / 2, y: rows / 2 };
  // The corner slips in tiles, from the pixel boxes the tags keep off.
  const corners = [
    [0, 0, 10, 6.5],
    [69, 0, cols, 7.2],
    [0, 41, 31.5, rows],
    [61.5, 41, cols, rows],
  ] as const;
  const inCorner = (x: number, y: number, m: number): boolean =>
    corners.some(([x0, y0, x1, y1]) => x > x0 - m && x < x1 + m && y > y0 - m && y < y1 + m);
  const offCity = (x: number, y: number): number =>
    Math.hypot((x - city.x) / 1.3, (y - city.y) / 0.85);
  // The planted feet reach about ten and a half tiles along and seven to ten across; a pocket keeps
  // three tiles clear of them.
  const underFeet = (x: number, y: number): boolean =>
    x > city.x - 14 && x < city.x + 12.5 && y > city.y - 13 && y < city.y + 10.6;

  // ---- Pockets: each the best of many candidates, farthest from those laid.
  const spots: [number, number][] = [];
  for (let n = 0; n < MID_HOLDS.pockets; n++) {
    let best: [number, number] | null = null;
    let bestScore = -1;
    for (let c = 0; c < 900; c++) {
      const x = 4.5 + random() * (cols - 9);
      const y = 4.6 + random() * (rows - 8.8);
      if (offCity(x, y) < 11.5 || underFeet(x, y) || inCorner(x, y, 2.5)) continue;
      let score = 99;
      for (const [sx, sy] of spots) score = Math.min(score, Math.hypot((x - sx) * 0.9, y - sy));
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
    if (best) spots.push(best);
  }
  // ---- Roles first, each the pocket that best fits its direction and distance.
  const kinds: (PocketKind | null)[] = spots.map(() => null);
  const roles: number[] = [];
  for (const role of o.roles ?? []) {
    let pick = -1;
    let score = Number.POSITIVE_INFINITY;
    spots.forEach(([x, y], i) => {
      if (kinds[i]) return;
      const a = Math.atan2(y - city.y, x - city.x);
      let gap = Math.abs(a - role.angle) % (Math.PI * 2);
      if (gap > Math.PI) gap = Math.PI * 2 - gap;
      const s = gap * 14 + Math.abs(Math.hypot(x - city.x, y - city.y) - role.far) * 0.5;
      if (s < score) {
        score = s;
        pick = i;
      }
    });
    if (pick >= 0) kinds[pick] = role.kind;
    roles.push(pick);
  }
  // ---- The rest from one table: dens where the walk is longest, then chests, nests, seams; scrap.
  const count = (k: PocketKind): number => kinds.filter((q) => q === k).length;
  const byWalk = spots
    .map((s, i) => ({ i, d: Math.hypot(s[0] - city.x, s[1] - city.y) }))
    .sort((a, b) => b.d - a.d);
  for (const { i } of byWalk) {
    if (kinds[i]) continue;
    if (
      count("den") < MID_HOLDS.dens &&
      (count("den") <= count("chest") + 1 || count("chest") >= MID_HOLDS.chests)
    )
      kinds[i] = "den";
    else if (count("chest") < MID_HOLDS.chests) kinds[i] = "chest";
  }
  for (const { i } of [...byWalk].reverse()) {
    if (kinds[i]) continue;
    if (count("nest") < MID_HOLDS.nests && hash(i, o.seed, 3) < 0.5) kinds[i] = "nest";
    else if (count("seam") < MID_HOLDS.seams && hash(i, o.seed, 4) < 0.6) kinds[i] = "seam";
  }
  for (let i = 0; i < kinds.length; i++) if (!kinds[i]) kinds[i] = "scrap";
  // Den letters run round the city from the west, through north, east and south.
  const dens = spots
    .map((s, i) => ({ i, a: Math.atan2(s[1] - city.y, s[0] - city.x) }))
    .filter((q) => kinds[q.i] === "den")
    .sort((a, b) => a.a - b.a);
  const letterOf = new Map<number, string>();
  for (const [k, q] of dens.entries()) letterOf.set(q.i, LETTERS[k % LETTERS.length] as string);
  let denBuild = 0;
  const pockets: Pocket[] = spots.map(([x, y], i) => {
    const kind = kinds[i] as PocketKind;
    const far = Math.hypot(x - city.x, y - city.y) / Math.hypot(cols / 2, rows / 2);
    const heaps: [number, number][] =
      kind === "scrap"
        ? [
            [x - 1.8 + random() * 0.4, y + 0.3 + random() * 0.5],
            [x + 1.8 + random() * 0.4, y - 0.2 + random() * 0.5],
          ]
        : [];
    const letter = letterOf.get(i);
    return {
      n: i + 1,
      x,
      y,
      kind,
      level: Math.round(lerp(23, 68, clamp(far * 1.15))),
      build: kind === "den" ? denBuild++ % 3 : i % 3,
      heaps,
      ...(letter ? { letter } : {}),
    };
  });

  // ---- One river from the top edge to the bottom, through the gaps, missing the city.
  let centre: number[] = [];
  let bestRiver = -1;
  for (let c = 0; c < 60; c++) {
    const side = random() < 0.5 ? -1 : 1;
    const rx = city.x + side * (15 + random() * 17);
    const phase = random() * 10;
    const pts: number[] = [];
    for (let y = -1.5; y <= rows + 2; y += 5.5)
      pts.push(rx + noise1(y / 6 + phase, o.seed + 3) * 4, y);
    let clearance = 99;
    for (let k = 0; k < pts.length; k += 2) {
      const x = pts[k] as number;
      const y = pts[k + 1] as number;
      for (const p of pockets) clearance = Math.min(clearance, Math.hypot(x - p.x, y - p.y));
      clearance = Math.min(clearance, offCity(x, y) * 0.8);
    }
    if (clearance > bestRiver) {
      bestRiver = clearance;
      centre = pts;
    }
  }
  const { river, left, right } = riverBanks(centre);

  // ---- Worn paths from the ramp's foot to the role pockets and a few more, bending round the hull.
  const foot = { x: city.x + 5, y: city.y + o.rampSide * 4.4 };
  const pathed = new Set<number>(roles.filter((r) => r >= 0));
  const byAngle = pockets
    .map((p, i) => ({
      i,
      a: Math.atan2(p.y - city.y, p.x - city.x),
      d: Math.hypot(p.x - city.x, p.y - city.y),
    }))
    .sort((a, b) => a.a - b.a);
  for (let k = 0; k < byAngle.length && pathed.size < 11; k += 3)
    pathed.add((byAngle[k] as { i: number }).i);
  const paths: number[][] = [];
  const fords: [number, number][] = [];
  for (const i of [...pathed].sort((a, b) => a - b)) {
    const p = pockets[i] as Pocket;
    const ctrl: number[] = [foot.x, foot.y];
    if ((p.y - city.y) * o.rampSide < -3) {
      const sideX = p.x < city.x ? city.x - 11 : city.x + 11;
      ctrl.push(sideX, city.y + o.rampSide * 3.5);
    }
    const ex = p.x + (foot.x - p.x) * 0.08;
    const ey = p.y + 3.2;
    ctrl.push(
      (ctrl[ctrl.length - 2] as number) * 0.4 + ex * 0.6 + (random() - 0.5) * 3,
      (ctrl[ctrl.length - 1] as number) * 0.4 + ey * 0.6 + (random() - 0.5) * 2.5,
      ex,
      ey,
    );
    const out: number[] = [];
    spline(ctrl, ctrl.length / 2, 0.5, false, out);
    paths.push(out);
    for (let k = 0; k + 2 < out.length; k += 2)
      if (distToRiver(river, out[k] as number, out[k + 1] as number) < 0.4) {
        const fx = out[k] as number;
        const fy = out[k + 1] as number;
        if (!fords.some(([x, y]) => Math.hypot(x - fx, y - fy) < 4))
          for (let s = -1.5; s <= 1.5; s += 1) fords.push([fx + s * 0.5, fy + s * 0.12]);
        break;
      }
  }

  // ---- Woods and crags between neighbours, with a gap in each.
  // A mass may not stand where it would cover a pocket's contents: its trees rise about three and
  // a half tiles above its foot, so nothing stands within that of a pocket's front.
  const hides = (x: number, y: number): boolean =>
    pockets.some(
      (p) =>
        Math.hypot(x - p.x, y - p.y) < 4.4 ||
        (Math.abs(x - p.x) < 4.2 && y > p.y - 1.2 && y < p.y + 4.8),
    );
  const clearOf = (x: number, y: number): boolean =>
    offCity(x, y) > 10 &&
    !hides(x, y) &&
    distToRiver(river, x, y) > 1.8 &&
    distToPaths(paths, x, y) > 1.7 &&
    !inCorner(x, y, 0.8) &&
    x > 0.8 &&
    x < cols - 0.8 &&
    y > 1.8 &&
    y < rows - 0.6;
  const masses: Mass[] = [];
  let seed = 400;
  const row = (x0: number, x1: number, y: number, crag: boolean): void => {
    seed++;
    masses.push(
      crag
        ? cragRow(x0, x1, y, 2.5 + random() * 0.5, seed)
        : woodRow(x0, x1, y, 2.5 + random() * 0.5, 1, seed, random() < 0.3 ? GROWTH_DEEP : GROWTH),
    );
  };
  const lay = (pieces: [number, number][], stacked: boolean, crag: boolean): void => {
    let run: [number, number][] = [];
    const flush = (): void => {
      if (stacked) for (const [x, y] of run) row(x - 1.3, x + 1.3, y, crag);
      else if (run.length >= 2) {
        const xs = run.map((r) => r[0]);
        const y = run.reduce((s, r) => s + r[1], 0) / run.length;
        row(Math.min(...xs) - 0.8, Math.max(...xs) + 0.8, y, crag);
      } else if (run.length === 1) {
        const [x, y] = run[0] as [number, number];
        row(x - 1.3, x + 1.3, y, crag);
      }
      run = [];
    };
    for (const pc of pieces) {
      if (clearOf(pc[0], pc[1])) run.push(pc);
      else flush();
    }
    flush();
  };
  for (let i = 0; i < pockets.length; i++)
    for (let j = i + 1; j < pockets.length; j++) {
      const a = pockets[i] as Pocket;
      const b = pockets[j] as Pocket;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (gap > 13.5) continue;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      // Neighbours only: no other pocket nearer the middle than they are.
      if (pockets.some((c, k) => k !== i && k !== j && Math.hypot(c.x - mx, c.y - my) < gap / 2))
        continue;
      const crag = random() < 0.3;
      const pieces: [number, number][] = [];
      // A short wood or crag either side of a gap in the middle.
      if (Math.abs(a.x - b.x) > Math.abs(a.y - b.y)) {
        for (const k of [-1.1, 1.1]) pieces.push([mx + (random() - 0.5) * 1.0, my + k * 1.8]);
        lay(pieces, true, crag);
      } else {
        for (const k of [-2.6, -1.6, 1.6, 2.6]) pieces.push([mx + k, my + (random() - 0.5) * 0.6]);
        lay(pieces, false, crag);
      }
    }
  // ---- Every pocket bounded on two sides or more; where one is not, a wood is set on a free side.
  const sidesOf = (p: Pocket): number => boundedSides({ masses, river, cols, rows }, p);
  for (const p of pockets) {
    const tries: [number, number, boolean][] = [];
    for (const dy of [-5.4, -6.4, -7.4])
      for (const dx of [0, -2, 2]) tries.push([p.x + dx, p.y + dy, false]);
    for (const dx of [6.4, 7.4, 8.2])
      for (const dy of [1, -1, 3])
        for (const sgn of [-1, 1]) tries.push([p.x + sgn * dx, p.y + dy, true]);
    for (const dy of [8.2, 8.8])
      for (const dx of [0, -2.5, 2.5]) tries.push([p.x + dx, p.y + dy, false]);
    for (const [x, y, stacked] of tries) {
      if (sidesOf(p) >= 2) break;
      const pieces: [number, number][] = stacked
        ? [
            [x, y - 1.7],
            [x, y],
            [x, y + 1.7],
          ]
        : [
            [x - 2.2, y],
            [x, y],
            [x + 2.2, y],
          ];
      lay(pieces, stacked, random() < 0.3);
    }
  }

  // ---- Scenery on open ground: trees, bushes and boulders; bones near dens.
  const things: Landing["things"] = [];
  const onMass = (x: number, y: number): boolean =>
    masses.some(
      (m) =>
        Math.abs((m.base[1] as number) - y) < 1.8 &&
        x > (m.base[0] as number) - 1.6 &&
        x < (m.base[m.base.length - 2] as number) + 1.6,
    );
  for (let tries = 0; tries < 1400 && things.length < 64; tries++) {
    const x = 1 + random() * (cols - 2);
    const y = 1.8 + random() * (rows - 2.6);
    if (!clearOf(x, y) || onMass(x, y)) continue;
    if (things.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 3)) continue;
    const k = random();
    things.push(
      k < 0.55
        ? [x, y, Math.floor(random() * 5), 2.0 + random() * 0.5]
        : k < 0.8
          ? [x, y, 5, 0.8 + random() * 0.15]
          : [x, y, 6, 0.7 + random() * 0.25],
    );
  }
  for (const p of pockets) if (p.kind === "den") things.push([p.x - 3.0, p.y + 0.8, 14, 0.85]);

  // ---- Washes: ground, growth, the clearings the pockets stand in, earth round the dens.
  const patches: Landing["patches"] = [];
  for (let i = 0; i < 48; i++)
    patches.push({
      x: lerp(-2, cols + 2, random()),
      y: lerp(-1, rows + 1, random()),
      r: 5 + random() * 5,
      rgb: GROUND,
      alpha: 0.24,
      seed: i * 7 + 1,
    });
  for (let i = 0; i < 28; i++)
    patches.push({
      x: lerp(0, cols, random()),
      y: lerp(0, rows, random()),
      r: 2.5 + random() * 3,
      rgb: GROWTH,
      alpha: 0.16,
      seed: i * 11 + 3,
    });
  for (const p of pockets) {
    patches.push({ x: p.x, y: p.y + 1.6, r: 3.4, rgb: 0xcfc7a2, alpha: 0.32, seed: p.n * 13 });
    if (p.kind === "den")
      patches.push({ x: p.x, y: p.y + 0.4, r: 2.6, rgb: EARTH, alpha: 0.3, seed: p.n * 17 });
  }
  patches.push({ x: city.x + 1, y: city.y + 0.8, r: 8, rgb: 0xcfc7a2, alpha: 0.4, seed: 909 });
  const clumps = groundMarks(random, cols, rows, river, city, 4600);
  return {
    size: "Medium",
    cols,
    rows,
    T,
    ox,
    oy,
    city,
    rampSide: o.rampSide,
    levels: [23, 68],
    patches,
    river,
    left,
    right,
    fords,
    paths,
    clumps,
    masses,
    things,
    pockets,
    roles,
    corners,
  };
}

/** How many sides of a pocket (of north, east, south and west) a wood, a crag, the river or the edge bounds within 8.5 tiles. */
export function boundedSides(
  L: Pick<Landing, "masses" | "river" | "cols" | "rows">,
  p: Pocket,
): number {
  const sides = new Set<number>();
  const mark = (x: number, y: number): void => {
    const dist = Math.hypot(x - p.x, y - p.y);
    if (dist > 8.5 || dist < 0.5) return;
    const a = Math.atan2(y - p.y, x - p.x);
    sides.add(((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4);
  };
  for (const m of L.masses)
    for (let k = 0; k < m.base.length; k += 2) mark(m.base[k] as number, m.base[k + 1] as number);
  for (let k = 0; k < L.river.length; k += 2) mark(L.river[k] as number, L.river[k + 1] as number);
  if (p.x < 7.5) sides.add(2);
  if (p.x > L.cols - 7.5) sides.add(0);
  if (p.y < 7.5) sides.add(3);
  if (p.y > L.rows - 7.5) sides.add(1);
  return sides.size;
}

/** The earth a den's mound is washed in, so a grey brute beside it is not read as another den. */
export const EARTH = 0x9c7b58;

/**
 * A landing in peace stops as an unfinished drawing does (docs/art.md,
 * section 3): in its last two tiles the lines trail off and the washes end
 * short of the edge, into bare paper.
 */
export function unfinishedEdge(L: Landing): Reveal {
  const edge = (x: number, y: number): number => Math.min(x, y, L.cols - x, L.rows - y);
  return {
    ink: (x, y) => clamp(edge(x, y) / 2),
    flood: (x, y) => clamp((edge(x, y) - 1.4) / 0.7),
  };
}

// ---------------------------------------------------------------- drawing the ground

/** A camera on a landing: pixels a tile and where the map's corner is on screen. */
export interface View {
  T: number;
  ox: number;
  oy: number;
}

export const viewOf = (L: Landing): View => ({ T: L.T, ox: L.ox, oy: L.oy });

/** The ground: washes, the river, fords, worn paths and ground marks. `r` says what is inked yet. */
export function drawGround(d: Draw, L: Landing, v: View, r: Reveal = SHOWN): void {
  const strength = d.strength;
  d.push();
  d.move(v.ox, v.oy);
  d.scale(v.T);
  for (const p of L.patches) {
    const shown = r.flood(p.x, p.y);
    if (shown <= 0.01) continue;
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const reach =
        p.r * (0.72 + 0.34 * noise1(i * 0.7 + p.seed, p.seed) + 0.14 * noise1(i * 2.3, p.seed + 1));
      pts.push(p.x + Math.cos(a) * reach * 1.45, p.y + Math.sin(a) * reach * 0.8);
    }
    d.strength = strength * shown;
    d.wash(pts, p.rgb, p.alpha, true);
  }
  // The river.
  const n = L.river.length / 2;
  for (let i = 0; i + 4 < n; i += 4) {
    const mx = L.river[(i + 2) * 2] as number;
    const my = L.river[(i + 2) * 2 + 1] as number;
    const flood = r.flood(mx, my);
    const ink = r.ink(mx, my);
    if (ink <= 0.01) continue;
    const quad: number[] = [];
    for (let j = i; j <= i + 4; j++)
      quad.push(L.left[j * 2] as number, L.left[j * 2 + 1] as number);
    for (let j = i + 4; j >= i; j--)
      quad.push(L.right[j * 2] as number, L.right[j * 2 + 1] as number);
    d.strength = strength * ink;
    d.fill(quad, d.ground, 1);
    d.strength = strength * flood;
    d.fill(quad, WATER, 0.7);
    const deep: number[] = [];
    for (let j = i; j <= i + 4; j++)
      deep.push(
        lerp(L.left[j * 2] as number, L.right[j * 2] as number, 0.3),
        lerp(L.left[j * 2 + 1] as number, L.right[j * 2 + 1] as number, 0.3),
      );
    for (let j = i + 4; j >= i; j--)
      deep.push(
        lerp(L.left[j * 2] as number, L.right[j * 2] as number, 0.9),
        lerp(L.left[j * 2 + 1] as number, L.right[j * 2 + 1] as number, 0.9),
      );
    d.fill(deep, 0x6f97a3, 0.45);
  }
  for (let i = 0; i + 1 < n; i += 9) {
    const to = Math.min(n - 1, i + 10);
    const ink = r.ink(L.river[i * 2] as number, L.river[i * 2 + 1] as number);
    if (ink <= 0.01) continue;
    d.strength = strength * ink;
    d.curve(L.left.slice(i * 2, to * 2 + 2), CONTOUR, 100 + i);
    d.curve(L.right.slice(i * 2, to * 2 + 2), FORM, 200 + i);
  }
  for (let i = 2; i < n - 2; i += 2) {
    const x = L.river[i * 2] as number;
    const y = L.river[i * 2 + 1] as number;
    const ink = r.ink(x, y);
    if (ink <= 0.01) continue;
    const tx = (L.river[i * 2 + 2] as number) - x;
    const ty = (L.river[i * 2 + 3] as number) - y;
    const side = (hash(i, 93) - 0.5) * 0.8;
    d.strength = strength * 0.7 * ink;
    d.line(
      x - ty * side - tx * 0.5,
      y + tx * side - ty * 0.5,
      x - ty * side + tx * 0.6,
      y + tx * side + ty * 0.6,
      HAIR,
      i + 300,
    );
  }
  for (const [j, [fx, fy]] of L.fords.entries()) {
    const ink = r.ink(fx, fy);
    if (ink <= 0.01) continue;
    d.strength = strength * ink;
    d.body(d.round(fx, fy, 0.22, 0.15 * BACK * 1.1, 7, j + 5), {
      wash: STONE,
      washAlpha: 0.9,
      weight: FORM,
      seed: j + 400,
    });
  }
  // Worn paths.
  for (const path of L.paths) {
    const pn = path.length / 2;
    for (let i = 0; i + 3 < pn; i += 3) {
      const ink = r.ink(path[i * 2] as number, path[i * 2 + 1] as number);
      if (ink <= 0.01) continue;
      const band: number[] = [];
      for (let j = i; j <= i + 3; j++)
        band.push(path[j * 2] as number, (path[j * 2 + 1] as number) - 0.32);
      for (let j = i + 3; j >= i; j--)
        band.push(path[j * 2] as number, (path[j * 2 + 1] as number) + 0.32);
      d.strength = strength * r.flood(path[i * 2] as number, path[i * 2 + 1] as number);
      d.fill(band, d.ground, 0.62);
      d.strength = strength * 0.75 * ink;
      const x = path[i * 2] as number;
      const y = path[i * 2 + 1] as number;
      const x1 = path[i * 2 + 4] as number;
      const y1 = path[i * 2 + 5] as number;
      if (hash(i, 96) < 0.75)
        d.line(x, y - 0.34, lerp(x, x1, 0.7), lerp(y, y1, 0.7) - 0.34, HAIR, i + 500);
      if (hash(i, 97) < 0.75)
        d.line(lerp(x, x1, 0.2), lerp(y, y1, 0.2) + 0.34, x1, y1 + 0.34, HAIR, i + 600);
      if (hash(i, 98) < 0.25) d.dot(x + 0.2, y + (hash(i, 99) - 0.5) * 0.4, 1.6);
    }
  }
  for (const c of L.clumps) {
    const ink = r.ink(c.x, c.y);
    if (ink <= 0.01) continue;
    d.strength = strength * ink;
    if (c.kind === 0) {
      for (let b = 0; b < 3; b++) {
        const lean = (b - 1) * 0.09 + (hash(c.seed, b) - 0.5) * 0.06;
        d.line(
          c.x + b * 0.07,
          c.y,
          c.x + b * 0.07 + lean,
          c.y - (0.2 + hash(c.seed, b + 4) * 0.14) * UP,
          FORM,
          c.seed + b,
        );
      }
    } else if (c.kind === 1) {
      d.dot(c.x, c.y - 0.08, 2.1, FLOWER);
      d.dot(c.x + 0.22, c.y + 0.05, 1.7, FLOWER);
    } else
      d.curve(
        [c.x - 0.14, c.y, c.x - 0.08, c.y - 0.12 * UP, c.x + 0.1, c.y - 0.13 * UP, c.x + 0.16, c.y],
        FORM,
        c.seed,
      );
  }
  d.pop();
  d.strength = strength;
}

/** Shadows of masses and things, on the ground under everything that stands. */
export function drawShadows(d: Draw, L: Landing, v: View, r: Reveal = SHOWN): void {
  const strength = d.strength;
  d.push();
  d.move(v.ox, v.oy);
  d.scale(v.T);
  for (const m of L.masses) {
    const b = m.base;
    const shown = r.ink(b[0] as number, b[1] as number);
    if (shown <= 0.01) continue;
    const pts: number[] = [];
    for (let i = 0; i < b.length; i += 2)
      pts.push((b[i] as number) + 0.4, (b[i + 1] as number) + 0.1);
    for (let i = b.length - 2; i >= 0; i -= 2)
      pts.push(
        (b[i] as number) + 0.4 + m.height * 0.5,
        (b[i + 1] as number) + 0.1 + m.height * 0.3,
      );
    d.strength = strength * shown;
    d.wash(pts, SHADOW, 0.18, true);
  }
  d.pop();
  for (const [x, y, kind, size] of L.things) {
    const shown = r.ink(x, y);
    if (shown <= 0.01) continue;
    d.strength = strength * shown;
    const h = (kind <= 4 ? size : kind === 7 ? size * 0.9 : size * 0.6) * v.T * UP;
    const w = (kind <= 4 ? size * 0.6 : size * 1.1) * v.T;
    castShadow(d, v.ox + x * v.T, v.oy + y * v.T, h * 0.6, w);
  }
  for (const p of L.pockets) {
    const shown = r.ink(p.x, p.y);
    if (shown <= 0.01) continue;
    d.strength = strength * shown;
    const sx = v.ox + p.x * v.T;
    const sy = v.oy + p.y * v.T;
    if (p.kind === "den") castShadow(d, sx, sy, 2 * v.T * UP * 0.6, 4.6 * v.T);
    for (const [hx, hy] of p.heaps)
      castShadow(d, v.ox + hx * v.T, v.oy + hy * v.T, 1.2 * v.T, 3 * v.T);
  }
  d.strength = strength;
}

export interface Standing {
  /** Where its foot is, in tiles: y for sorting with everything else that stands. */
  x: number;
  y: number;
  draw: () => void;
  /** What of it may stand in front of a citizen, as boxes on screen, for the cover test. */
  covers?: () => [number, number, number, number][];
  /**
   * For a thing of the map that does not move: what its drawing depends on besides the map, the
   * camera and the ink coming in, so the drawing can be kept while these stay the same.
   */
  still?: () => number[];
}

/** Everything that stands on the landing as items to sort by their feet. */
export function standingItems(
  d: Draw,
  L: Landing,
  v: View,
  r: Reveal = SHOWN,
  opened: (p: Pocket) => number = () => 0,
): Standing[] {
  const items: Standing[] = [];
  const stand = (): void => {
    d.push();
    d.move(v.ox, v.oy);
    d.scale(v.T, v.T * UP);
  };
  for (const m of L.masses) {
    const mid = Math.floor(m.base.length / 4) * 2;
    items.push({
      x: m.base[mid] as number,
      y: (m.base[1] as number) + 0.01,
      draw: () => {
        stand();
        drawMass(d, scaledMass(m), {
          ink: (x, y) => r.ink(x, y * UP),
          flood: (x, y) => r.flood(x, y * UP),
        });
        d.pop();
      },
      still: () => [],
    });
  }
  for (const [x, y, kind, size] of L.things) {
    items.push({
      x,
      y,
      still: () => [],
      draw: () => {
        const shown = r.ink(x, y);
        if (shown <= 0.01) return;
        stand();
        d.move(x, y / UP);
        drawThingAt(d, kind, size, Math.round(x * 31 + y * 7), shown, r.flood(x, y));
        d.pop();
      },
    });
  }
  for (const p of L.pockets) {
    const rise = (): number => easeOutBack(clamp(r.ink(p.x, p.y)), 1.6);
    const thing = (x: number, y: number, fn: () => void): void => {
      items.push({
        x,
        y,
        // A chest's lid opens with time; the rest stand as they are.
        still: () => (p.kind === "chest" ? [opened(p)] : []),
        draw: () => {
          const shown = r.ink(x, y);
          if (shown <= 0.01) return;
          const strength = d.strength;
          d.strength = strength * clamp(shown * 2);
          stand();
          d.move(x, y / UP);
          d.scale(1, rise());
          fn();
          d.pop();
          d.strength = strength;
        },
      });
    };
    if (p.kind === "den") thing(p.x, p.y, () => drawDen(d, p.build, p.level * 13));
    else if (p.kind === "chest") thing(p.x, p.y, () => drawChest(d, p.n * 7, opened(p)));
    else if (p.kind === "seam") thing(p.x, p.y, () => drawThingAt(d, 9, 2.2, p.n * 31));
    else if (p.kind === "nest") thing(p.x, p.y, () => drawThingAt(d, 13, 2.4, p.n * 31));
    for (const [i, [hx, hy]] of p.heaps.entries())
      thing(hx, hy, () => drawScrapHeap(d, p.n * 17 + i * 5, i));
  }
  return items;
}

const MASS_CACHE = new Map<Mass, Mass>();
function scaledMass(m: Mass): Mass {
  let s = MASS_CACHE.get(m);
  if (!s) {
    s = { ...m, base: m.base.map((v, i) => (i % 2 ? v / UP : v)) };
    MASS_CACHE.set(m, s);
  }
  return s;
}

// ---------------------------------------------------------------- pockets

/**
 * A den: a mound of rock leaning toward the viewer, its grassy top showing
 * and a black mouth in its face, in three builds that differ in rim, size
 * and mouth. Drawn in stand space with its foot at the origin.
 */
export function drawDen(d: Draw, build: number, seed: number): void {
  const w = [2.4, 2.1, 2.7][build % 3] as number;
  const h = [2.0, 1.75, 1.6][build % 3] as number;
  const mound =
    build % 3 === 0
      ? [
          -w,
          0,
          -w * 0.92,
          -h * 0.45,
          -w * 0.62,
          -h * 0.85,
          -w * 0.12,
          -h,
          w * 0.46,
          -h * 0.92,
          w * 0.83,
          -h * 0.5,
          w,
          0,
        ]
      : build % 3 === 1
        ? [
            -w,
            0,
            -w * 0.8,
            -h * 0.6,
            -w * 0.4,
            -h * 0.95,
            w * 0.15,
            -h * 1.08,
            w * 0.62,
            -h * 0.75,
            w,
            -h * 0.25,
            w * 1.02,
            0,
          ]
        : [
            -w,
            0,
            -w * 0.96,
            -h * 0.3,
            -w * 0.72,
            -h * 0.7,
            -w * 0.3,
            -h * 0.86,
            w * 0.2,
            -h * 0.95,
            w * 0.7,
            -h * 0.72,
            w * 0.95,
            -h * 0.32,
            w,
            0,
          ];
  d.fill(mound, d.ground, 1, true);
  d.wash(mound, EARTH, 0.88, true);
  d.hatch(
    [w * 0.2, -h * 0.95, w * 0.5, -h * 0.9, w * 0.85, -h * 0.5, w, 0, w * 0.35, 0],
    2,
    INK,
    0.6,
    true,
  );
  // The top face, at BACK.
  const top = d.round(-w * 0.1, -h * 0.86, w * 0.62, 0.3, 12, seed + 2).slice();
  d.fill(top, GROWTH, 0.78, true);
  d.curve(top, FORM, seed + 3, true);
  d.curve(mound, CONTOUR, seed, true);
  if (build % 3 === 2) {
    // A broken rim of stones round the top.
    for (let i = 0; i < 6; i++) {
      const a = Math.PI + (i / 5) * Math.PI;
      d.body(
        d.round(
          -w * 0.1 + Math.cos(a) * w * 0.62,
          -h * 0.86 + Math.sin(a) * 0.3,
          0.2,
          0.14,
          7,
          seed + 20 + i,
        ),
        { wash: STONE, washAlpha: 0.9, weight: FORM, seed: seed + 20 + i },
      );
    }
  }
  // The mouth: a black arch with eyes in it, a different shape for each build.
  const mw = [1.05, 0.8, 1.3][build % 3] as number;
  const mh = [1.25, 1.1, 0.9][build % 3] as number;
  const mouth =
    build % 3 === 1
      ? [-mw, 0.02, -mw * 0.7, -mh * 0.8, 0, -mh, mw * 0.7, -mh * 0.8, mw, 0.02]
      : [
          -mw,
          0.02,
          -mw * 0.95,
          -mh * 0.65,
          -mw * 0.45,
          -mh,
          mw * 0.3,
          -mh,
          mw * 0.85,
          -mh * 0.65,
          mw,
          0.02,
        ];
  d.fill(mouth, INK, 1, true);
  for (let i = 0; i < 3; i++) {
    d.dot(-mw * 0.45 + i * mw * 0.42, -mh * 0.35 - (i % 2) * 0.14, 2.6, PAPER);
    d.dot(-mw * 0.3 + i * mw * 0.42, -mh * 0.33 - (i % 2) * 0.14, 2.6, PAPER);
  }
  if (build % 3 === 0)
    for (let i = 0; i < 5; i++) {
      const x = -1.9 + i * 0.95;
      d.line(x, -0.1, x + (i - 2) * 0.12, -0.55, CONTOUR, seed + 9 + i);
    }
  else if (build % 3 === 1) {
    // Tusks of bone either side of the mouth.
    d.curve([-mw - 0.2, 0, -mw - 0.45, -0.6, -mw - 0.15, -1.0], HEAVY, seed + 9);
    d.curve([mw + 0.2, 0, mw + 0.45, -0.6, mw + 0.15, -1.0], HEAVY, seed + 10);
  } else
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      d.line(
        Math.cos(a) * mw * 1.1,
        -0.05 + Math.sin(a) * mh * 1.05,
        Math.cos(a) * mw * 1.35,
        -0.05 + Math.sin(a) * mh * 1.3,
        CONTOUR,
        seed + 30 + i,
      );
    }
}

/** A chest on a rise, its lid showing; `open` 0 to 1 lifts the lid. */
export function drawChest(d: Draw, seed: number, open: number): void {
  const rise = d.round(0, -0.05, 1.5, 0.5, 12, seed).slice();
  d.fill(rise, d.ground, 1, true);
  d.wash(rise, 0xb8b089, 0.7, true);
  d.curve(rise.slice(0, 14), FORM, seed + 1);
  const w = 0.62;
  const h = 0.42;
  const box = [-w, -0.2, w, -0.2, w, -0.2 - h, -w, -0.2 - h];
  d.body(box, { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: CONTOUR, seed: seed + 2 });
  d.hatch([0, -0.2, w, -0.2, w, -0.2 - h, 0, -0.2 - h], 1, INK, 0.5);
  d.line(-w, -0.2 - h * 0.45, w, -0.2 - h * 0.45, FORM, seed + 3);
  const lift = clamp(open);
  const lid = [
    -w,
    -0.2 - h,
    w,
    -0.2 - h,
    w * 0.92,
    -0.2 - h - 0.22 - lift * 0.35,
    -w * 0.92,
    -0.2 - h - 0.22 - lift * 0.35,
  ];
  d.body(lid, { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: CONTOUR, seed: seed + 4 });
  d.fill(d.box(-0.1, -0.2 - h - 0.08, 0.1, -0.2 - h + 0.12), BRASS, 1);
  if (lift > 0.3) d.fill(d.box(-w * 0.85, -0.2 - h - 0.06, w * 0.85, -0.2 - h + 0.02), INK, 1);
  for (const sx of [-w * 0.6, w * 0.6])
    d.line(sx, -0.2, sx, -0.2 - h - 0.2 - lift * 0.3, FORM, seed + 5 + Math.round(sx * 10), 0.8);
}

/**
 * A heap of scrap a citizen and a half wide: plates, a gear, a pipe. It is a
 * place on the map, which sits back (docs/art.md, section 4): pale washes,
 * open hatching, nothing near black.
 */
export function drawScrapHeap(d: Draw, seed: number, build: number): void {
  d.hatch(d.round(0.4, 0.05, 1.6, 0.25, 9), 1, INK, 0.45);
  const flip = build % 2 ? -1 : 1;
  const plates: number[][] = [
    [-1.4, 0, -1.2, -0.7, -0.1, -0.9, 0.1, 0],
    [-0.2, 0, 0.1, -1.1, 1.0, -1.25, 1.4, 0],
    [-0.8, -0.6, -0.5, -1.4, 0.4, -1.2, 0.2, -0.5],
  ].map((p) => p.map((v, i) => (i % 2 ? v : v * flip)));
  const pale = (rgb: number): number => mix(rgb, PAPER, 0.45);
  plates.forEach((p, i) => {
    d.body(p, {
      smooth: false,
      wash: pale(i === 2 ? OXIDE : IRON),
      washAlpha: 0.75,
      weight: CONTOUR,
      seed: seed + i,
    });
    d.hatch(p.slice(4).concat(p.slice(0, 2)), 1, INK, 0.45);
  });
  const gx = 0.9 * flip;
  d.body(d.round(gx, -1.25, 0.34, 0.34, 10), {
    wash: pale(BRASS),
    washAlpha: 0.9,
    weight: FORM,
    seed: seed + 5,
  });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.line(
      gx + Math.cos(a) * 0.34,
      -1.25 + Math.sin(a) * 0.34,
      gx + Math.cos(a) * 0.46,
      -1.25 + Math.sin(a) * 0.46,
      FORM,
      seed + 10 + i,
    );
  }
  d.line(-1.0 * flip, -0.9, -1.8 * flip, -1.7, CONTOUR, seed + 20);
}
