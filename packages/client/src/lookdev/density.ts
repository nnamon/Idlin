// Two mockups of one moment on a landing, for the art director to choose a
// map size from (#362). Not the game and not for merging. The land, the
// pockets and what holds them come from the small seeded helper below; the
// fights round the pockets are placed by hand. The moment is 8:30 left on the
// cycle clock, 15 citizens with 13 out, drawn in take C's look (mockup.ts):
//   dense  a 60 by 33 map in which every pocket holds something, about 340 monsters;
//   big    an 80 by 45 map at the same density per tile, about 600.

import { beastPose, drawBrute, drawHound, drawSwarm, type Mite, TONE } from "./beasts.ts";
import { BRASS, CANVAS, IRON, LAMP, TIMBER } from "./city.ts";
import { BLOW, CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER, shade } from "./draw.ts";
import {
  detailFor,
  drawCitizen,
  HAT_TOP,
  type Look,
  lookOf,
  type Pose,
  pose,
  shooting,
  swinging,
  walking,
} from "./figure.ts";
import {
  drawArrow,
  drawBurn,
  drawDrop,
  drawImpact,
  drawPot,
  drawSpills,
  drawStone,
  drawSwing,
  drawTelegraph,
  RARITY,
  type Spill,
} from "./fx.ts";
import { hash, lerp, mix, noise1, noise2, rng, spline } from "./geom.ts";
import type { Scene } from "./scenes.ts";
import { HEIGHT, measure, WIDTH } from "./surface.ts";
import { drawMass, drawThingAt, type Mass, VALE_COLOURS } from "./vale.ts";

const { GROUND, GROWTH, GROWTH_DEEP, WATER, ROCK, STONE, FLOWER } = VALE_COLOURS;
const SHADOW = 0x4a4038;
const OXIDE = 0xa8644a;

const FRAME = { x0: 20, y0: 20, x1: WIDTH - 20, y1: HEIGHT - 20 } as const;
const OX = FRAME.x0;
const OY = FRAME.y0;
/** How much taller things stand than they lie, and how flat round things on the ground are. */
const ST = 1.4;
const GY = 0.8;

interface Config {
  /** Pixels a tile, and the map in tiles. */
  T: number;
  W: number;
  H: number;
  /** A citizen's height in tiles, in stand space. */
  S: number;
  pockets: number;
  monsters: number;
  seed: number;
  trees: number;
  small: number;
  masses: number;
  roam: number;
  /** The city's size against take C's hull of 15 tiles. */
  city: number;
}

const CONFIGS: Record<string, Config> = {
  dense: {
    T: 1880 / 60,
    W: 60,
    H: 1040 / (1880 / 60),
    S: 58 / ((1880 / 60) * ST),
    pockets: 13,
    monsters: 340,
    seed: 3621,
    trees: 13,
    small: 20,
    masses: 7,
    roam: 4,
    city: 1,
  },
  big: {
    T: 23.5,
    W: 80,
    H: 1040 / 23.5,
    S: 46 / (23.5 * ST),
    pockets: 26,
    monsters: 610,
    seed: 3622,
    trees: 22,
    small: 36,
    masses: 12,
    roam: 7,
    city: 1,
  },
  // The big map with a city the size of one early in progression: a hull of 9 tiles.
  small: {
    T: 23.5,
    W: 80,
    H: 1040 / 23.5,
    S: 46 / (23.5 * ST),
    pockets: 28,
    monsters: 650,
    seed: 3623,
    trees: 22,
    small: 36,
    masses: 12,
    roam: 8,
    city: 0.6,
  },
};

// The camera, set when a scene is made.
let T = 30;
let S = 1.4;
let MAP_W = 60;
let MAP_H = 33;
let CITY = { x: 30, y: 17.5 };
/** The city's size against take C's hull of 15 tiles. */
let CS = 1;

type AboardKind = "hammer" | "gun" | "shoot" | "draw" | "stand" | "walk";
/** Who is on deck: index, deck position in hull tiles, facing, and what they do. */
let ABOARD: [number, number, number, number, AboardKind][] = [
  [5, -0.2, 1.4, 1, "hammer"],
  [10, 6.3, -0.9, 1, "gun"],
];

/** The tile at the frame's top left corner, for a camera closed in on part of the map. */
let VX = 0;
let VY = 0;

const px = (x: number): number => OX + (x - VX) * T;
const py = (y: number): number => OY + (y - VY) * T;

const crowd: Look[] = Array.from({ length: 15 }, (_, i) => lookOf(i + 1));

// ---------------------------------------------------------------- the world

type PocketKind = "den" | "chest" | "scrap" | "ore" | "nest";
interface Pocket {
  x: number;
  y: number;
  kind: PocketKind;
  role: string | null;
  seed: number;
}

type FeatureKind = "den" | "chest" | "scrap" | "ore" | "nest" | "bones";
interface Feature {
  x: number;
  y: number;
  kind: FeatureKind;
  build: number;
  seed: number;
  label?: string;
}

type MAct = "pace" | "rest" | "stalk" | "lunge" | "coil" | "hurt" | "run" | "flash";
interface Mon {
  kind: "hound" | "brute" | "elite";
  x: number;
  y: number;
  face: number;
  act: MAct;
  build: number;
  air: number;
}

interface MiteAt {
  x: number;
  y: number;
  face: number;
  flash: boolean;
  air: number;
}

interface SwarmReq {
  x: number;
  y: number;
  weight: number;
  min: number;
  max: number;
  /** Where its mites are headed, if anywhere. */
  toward: [number, number] | null;
  /** Spread across and down, in tiles a mite. */
  sx: number;
  sy: number;
  flash: number;
  seed: number;
  mites: MiteAt[];
}

type Act =
  | "swing"
  | "hit"
  | "shoot"
  | "walk"
  | "hammer"
  | "chest"
  | "pot"
  | "sling"
  | "thrust"
  | "slam";
interface Cit {
  i: number;
  x: number;
  y: number;
  act: Act;
  face: number;
  haul?: number;
  pennant?: boolean;
}

interface Num {
  x: number;
  y: number;
  value: number;
  size: number;
  crit: boolean;
}

interface Thing {
  x: number;
  y: number;
  kind: number;
  size: number;
}

interface World {
  patches: { x: number; y: number; r: number; rgb: number; alpha: number; seed: number }[];
  river: number[];
  left: number[];
  right: number[];
  fords: [number, number][];
  paths: number[][];
  clumps: { x: number; y: number; kind: number; seed: number }[];
  masses: Mass[];
  things: Thing[];
  pockets: Pocket[];
  features: Feature[];
  mons: Mon[];
  swarms: SwarmReq[];
  cits: Cit[];
  spills: Spill[];
  ground: ((d: Draw) => void)[];
  under: ((d: Draw) => void)[];
  air: ((d: Draw) => void)[];
  flat: ((d: Draw) => void)[];
  nums: Num[];
  count: number;
}

/** The corner slips, in frame pixels, so the layout keeps clear of them. */
const CORNERS = [
  [FRAME.x0 + 18, FRAME.y0 + 18, FRAME.x0 + 260, FRAME.y0 + 140],
  [FRAME.x1 - 300, FRAME.y0 + 18, FRAME.x1 - 18, FRAME.y0 + 160],
  [FRAME.x0 + 18, FRAME.y1 - 84, FRAME.x0 + 470, FRAME.y1 - 18],
  [FRAME.x1 - 420, FRAME.y1 - 84, FRAME.x1 - 18, FRAME.y1 - 18],
] as const;

function underCorner(x: number, y: number, margin: number): boolean {
  const sx = px(x);
  const sy = py(y);
  const m = margin * T;
  return CORNERS.some(([a, b, c, e]) => sx > a - m && sx < c + m && sy > b - m && sy < e + m);
}

/** Inside the ground the city stands on, with its legs, its ramp and what it hides behind it. */
function inCity(x: number, y: number, grow: number): boolean {
  // A pocket's fight reaches about five tiles south of it, so a pocket north of the city keeps ten clear.
  const dx = Math.abs(x - CITY.x) / (14.2 * CS + 3.5 * (1 - CS) + grow);
  const dy =
    Math.abs(y - CITY.y) /
    ((y < CITY.y ? Math.max(10.5, 11.5 * CS) : 9.5 * CS + 2.5 * (1 - CS)) + grow);
  // Squarer to the north, where the far legs and the hull cover what stands behind them.
  return y < CITY.y ? dx ** 3 + dy ** 3 < 1 : dx * dx + dy * dy < 1;
}

function nearLine(line: number[], x: number, y: number): number {
  let best = 99;
  for (let i = 0; i < line.length; i += 2)
    best = Math.min(best, Math.hypot(x - (line[i] as number), y - (line[i + 1] as number)));
  return best;
}

const angleOf = (x: number, y: number): number => Math.atan2(y - CITY.y, x - CITY.x);
const angleGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};

function build(cfg: Config): World {
  const random = rng(cfg.seed);
  const W = MAP_W;
  const H = MAP_H;
  const area = (W * H) / (63 * 35);

  // The river: one, across the north-east corner from the top edge to the east edge, clear of the city.
  const ctrl: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    const x = lerp(W * 0.7, W + 2, u ** 0.8);
    const y = lerp(-2, H * 0.52, u ** 1.3);
    ctrl.push(x + 1.4 * noise1(i * 1.3, cfg.seed), y + 1.2 * noise1(i * 1.7, cfg.seed + 1));
  }
  const river: number[] = [];
  spline(ctrl, ctrl.length / 2, 0.6, false, river);
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

  // Pockets: each new one is the best of many candidates, farthest from those already laid.
  const okPocket = (x: number, y: number): boolean =>
    x > 5.5 &&
    x < W - 6.5 &&
    y > 6.0 &&
    y < H - 6.4 &&
    !inCity(x, y, 0) &&
    !underCorner(x, y, 2.6) &&
    // What a pocket holds reaches about five tiles west, seven east and five south.
    [
      [-4.5, 2],
      [0, 0],
      [0, 3.5],
      [4, 1.5],
      [6.5, 3.5],
      [2, 5],
      [-3, 5],
    ].every(([dx, dy]) => nearLine(river, x + (dx as number), y + (dy as number)) > 2.8);
  const pockets: Pocket[] = [];
  for (let n = 0; n < cfg.pockets; n++) {
    let best: [number, number] | null = null;
    let bestScore = -1;
    for (let c = 0; c < 600; c++) {
      const x = lerp(0, W, random());
      const y = lerp(0, H, random());
      if (!okPocket(x, y)) continue;
      let score = 99;
      for (const p of pockets) score = Math.min(score, Math.hypot((x - p.x) * 0.85, y - p.y));
      if (score > bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
    if (best) pockets.push({ x: best[0], y: best[1], kind: "scrap", role: null, seed: n * 97 + 5 });
  }

  // The fights, each given the pocket that best fits the direction it wants.
  const ROLES: [string, number, PocketKind][] = [
    ["denfight", -2.4, "den"],
    ["chest", -0.75, "chest"],
    ["mow", 0.55, "nest"],
    ["spear", 1.62, "scrap"],
    ["ore", -1.5, "ore"],
    ["closing", 2.4, "scrap"],
    ["bow", 3.05, "den"],
  ];
  for (const [role, want, kind] of ROLES) {
    let pick: Pocket | null = null;
    let score = 1e9;
    for (const p of pockets) {
      if (p.role) continue;
      // Away from the top and bottom edges if possible, so the fight is not under the black.
      const edge = p.y > MAP_H - 10 || p.y < 7.5 ? 40 : 0;
      const dist = Math.hypot(p.x - CITY.x, p.y - CITY.y);
      const s = angleGap(angleOf(p.x, p.y), want) * 12 + dist * 0.22 + edge;
      if (s < score) {
        score = s;
        pick = p;
      }
    }
    if (pick) {
      pick.role = role;
      pick.kind = kind;
    }
  }
  // The rest from one table: a den, a chest, scrap, a seam or a nest, each with its pack.
  const TABLE: PocketKind[] = [
    "den",
    "chest",
    "scrap",
    "den",
    "chest",
    "nest",
    "scrap",
    "ore",
    "den",
    "chest",
    "scrap",
  ];
  let ti = 0;
  for (const p of pockets) if (!p.role) p.kind = TABLE[ti++ % TABLE.length] as PocketKind;

  // Worn paths: out from the city's edge toward pockets on every side.
  const paths: number[][] = [];
  const fords: [number, number][] = [];
  const pathTo = pockets
    .filter((p) => p.role || hash(p.seed, 3) < 0.35)
    .map((p) => {
      const a = angleOf(p.x, p.y);
      const sx = CITY.x + Math.cos(a) * 10.5 * CS;
      const sy = CITY.y + Math.sin(a) * 6.8 * CS;
      const ex = p.x - Math.cos(a) * 2.5;
      const ey = p.y + 2.6;
      const mx = lerp(sx, ex, 0.5) - Math.sin(a) * 2.2 * (hash(p.seed, 4) - 0.5) * 2;
      const my = lerp(sy, ey, 0.5) + Math.cos(a) * 1.6 * (hash(p.seed, 5) - 0.5) * 2;
      const out: number[] = [];
      spline([sx, sy, mx, my, ex, ey], 3, 0.5, false, out);
      return out;
    });
  for (const path of pathTo) {
    paths.push(path);
    for (let i = 0; i < path.length; i += 2)
      if (nearLine(river, path[i] as number, path[i + 1] as number) < 0.5) {
        fords.push([path[i] as number, path[i + 1] as number]);
        break;
      }
  }

  // What a tall thing at (x, y) would cover or crowd.
  const crowds = (x: number, y: number, wide: number, tall: number): boolean => {
    for (const p of pockets) {
      if (Math.abs(x - p.x) > wide + 6) continue;
      if (y > p.y - 3.5 && y < p.y + 4.8 + tall) return true;
    }
    return false;
  };

  const masses: Mass[] = [];
  const massAt: [number, number, number][] = [];
  for (let n = 0, tries = 0; n < cfg.masses && tries < 4000; tries++) {
    const len = 4 + random() * 5;
    const x = lerp(-2, W + 2 - len, random());
    const y = lerp(1.5, H + 1, random());
    if (crowds(x + len / 2, y, len / 2, 4.8)) continue;
    if (inCity(x + len / 2, y, 3) || inCity(x, y, 2) || inCity(x + len, y, 2)) continue;
    if (nearLine(river, x, y) < 2 || nearLine(river, x + len, y) < 2) continue;
    if (paths.some((p) => nearLine(p, x + len / 2, y) < 2.5)) continue;
    if (massAt.some(([mx, my, ml]) => Math.abs(my - y) < 6 && x < mx + ml + 3 && x + len > mx - 3))
      continue;
    massAt.push([x, y, len]);
    n++;
  }
  massAt.forEach(([x0, y, len], i) => {
    const seed = 41 + i;
    const crag = hash(i, cfg.seed) < 0.28;
    const base: number[] = [];
    const step = crag ? 1.7 : 1.4;
    for (let x = x0; x <= x0 + len + 0.01; x += step)
      base.push(x, y + noise1(x / (crag ? 4 : 5) + seed, seed) * (crag ? 0.8 : 1.1));
    if (crag)
      masses.push({
        base,
        height: 3.0 + hash(i, 2) * 0.6,
        strength: 1,
        rgb: ROCK,
        seed,
        kind: "crag",
      });
    else
      masses.push({
        base,
        height: 2.5 + hash(i, 3) * 0.6,
        strength: 0.85 + hash(i, 4) * 0.15,
        rgb: hash(i, 5) < 0.3 ? GROWTH_DEEP : GROWTH,
        seed,
        kind: "wood",
      });
  });

  const things: Thing[] = [];
  const clearOf = (x: number, y: number, r: number): boolean =>
    things.every((t) => Math.hypot(t.x - x, t.y - y) > r) &&
    massAt.every(
      ([mx, my, ml]) => !(x > mx - 1 && x < mx + ml + 1 && y > my - 1.5 && y < my + 1.5),
    );
  for (let n = 0, tries = 0; n < cfg.trees && tries < 6000; tries++) {
    const x = lerp(1, W - 1, random());
    const y = lerp(2, H, random());
    if (crowds(x, y, 0.8, 3.4) || inCity(x, y, 1.5) || nearLine(river, x, y) < 1.6) continue;
    if (paths.some((p) => nearLine(p, x, y) < 1.2) || !clearOf(x, y, 3.5)) continue;
    things.push({ x, y, kind: Math.floor(random() * 5), size: 2.1 + random() * 0.5 });
    n++;
  }
  const SMALL = [5, 5, 6, 6, 8, 14, 5, 6];
  for (let n = 0, tries = 0; n < cfg.small && tries < 6000; tries++) {
    const x = lerp(1, W - 1, random());
    const y = lerp(2, H, random());
    if (inCity(x, y, -1) || nearLine(river, x, y) < 1.4 || !clearOf(x, y, 2.2)) continue;
    if (pockets.some((p) => Math.abs(p.x - x) < 6 && y > p.y - 1 && y < p.y + 5)) continue;
    if (paths.some((p) => nearLine(p, x, y) < 0.9)) continue;
    const kind = SMALL[n % SMALL.length] as number;
    things.push({ x, y, kind, size: kind === 8 ? 1.0 + random() * 0.3 : 0.7 + random() * 0.25 });
    n++;
  }

  // Ground washes.
  const patches: World["patches"] = [];
  for (let i = 0; i < 30 * area; i++)
    patches.push({
      x: lerp(-2, W + 2, random()),
      y: lerp(-1, H + 1, random()),
      r: 5 + random() * 5,
      rgb: GROUND,
      alpha: 0.24,
      seed: i * 7 + 1,
    });
  for (let i = 0; i < 16 * area; i++)
    patches.push({
      x: lerp(0, W, random()),
      y: lerp(0, H, random()),
      r: 2.5 + random() * 3,
      rgb: GROWTH,
      alpha: 0.16,
      seed: i * 11 + 3,
    });
  for (const [x, y, len] of massAt)
    patches.push({
      x: x + len / 2,
      y: y - 0.4,
      r: len * 0.45,
      rgb: 0x8ea673,
      alpha: 0.34,
      seed: Math.round(x * 13 + y),
    });
  patches.push({ x: CITY.x + 1, y: CITY.y + 0.8, r: 8 * CS, rgb: 0xcfc7a2, alpha: 0.4, seed: 909 });
  for (const p of pockets)
    patches.push({ x: p.x, y: p.y + 1.6, r: 3.2, rgb: 0xcfc7a2, alpha: 0.32, seed: p.seed });

  const clumps: World["clumps"] = [];
  for (let i = 0; i < 4200 * area; i++) {
    const x = lerp(-1, W + 1, random());
    const y = lerp(-1, H + 1, random());
    const density = noise2(x / 3.2, y / 3.2, 81) * 1.25 - 0.1;
    if (density < 0.5 + random() * 0.35) continue;
    if (nearLine(river, x, y) < 1.3) continue;
    if (Math.abs(x - CITY.x) < 7 && Math.abs(y - CITY.y + 0.5) < 2.5) continue;
    clumps.push({ x, y, kind: random() < 0.72 ? 0 : random() < 0.6 ? 1 : 2, seed: i });
  }

  // ---- What holds each pocket.
  const features: Feature[] = [];
  const mons: Mon[] = [];
  const swarms: SwarmReq[] = [];
  const cits: Cit[] = [];
  const spills: Spill[] = [];
  const ground: World["ground"] = [];
  const under: World["under"] = [];
  const air: World["air"] = [];
  const flat: World["flat"] = [];
  const nums: Num[] = [];

  const hound = (x: number, y: number, face: number, act: MAct, b = -1, airH = 0): void => {
    mons.push({ kind: "hound", x, y, face, act, build: b >= 0 ? b : mons.length % 3, air: airH });
  };
  const brute = (x: number, y: number, face: number, act: MAct): void => {
    mons.push({ kind: "brute", x, y, face, act, build: 0, air: 0 });
  };
  const elite = (x: number, y: number, face: number, act: MAct): void => {
    mons.push({ kind: "elite", x, y, face, act, build: 0, air: 0 });
  };
  const swarm = (
    x: number,
    y: number,
    weight: number,
    o: {
      min?: number;
      max?: number;
      toward?: [number, number] | null;
      sx?: number;
      sy?: number;
      flash?: number;
    } = {},
  ): SwarmReq => {
    const s: SwarmReq = {
      x,
      y,
      weight,
      min: o.min ?? 12,
      max: o.max ?? 50,
      toward: o.toward ?? null,
      sx: o.sx ?? 0.62,
      sy: o.sy ?? 0.34,
      flash: o.flash ?? 0,
      seed: swarms.length * 31 + 7,
      mites: [],
    };
    swarms.push(s);
    return s;
  };
  const cit = (
    i: number,
    x: number,
    y: number,
    act: Act,
    face: number,
    more: Partial<Cit> = {},
  ): Cit => {
    const c: Cit = { i, x, y, act, face, ...more };
    cits.push(c);
    return c;
  };
  const spill = (x: number, y: number, dx: number, dy: number, age: number, rank: number): void => {
    spills.push({ x, y, dx, dy, age, rank, seed: spills.length * 13 + 1 });
  };
  const num = (x: number, y: number, value: number, size: number, crit = false): void => {
    nums.push({ x, y, value, size, crit });
  };
  const swingOf = (c: Cit, angle: number, sweep = 2.3, radius = 2.0, age = 0.03): void => {
    const look = crowd[c.i] as Look;
    under.push((d) =>
      drawSwing(d, c.x, c.y / ST - 0.5, radius, angle, sweep, age, look.cloak, c.i * 17),
    );
  };
  const impact = (x: number, y: number, size = 0.8, seed = 1): void => {
    air.push((d) => drawImpact(d, x, y / ST - 0.6, 0.04, size, seed));
  };
  let level = 0;
  const LEVELS = [28, 31, 34, 23, 41, 37, 52, 26, 45, 61, 33, 48, 29, 56, 39, 68, 24, 44, 35, 50];

  const denAt = (p: Pocket): Feature => {
    const f: Feature = {
      x: p.x,
      y: p.y,
      kind: "den",
      build: features.filter((g) => g.kind === "den").length % 3,
      seed: p.seed,
      label: "",
    };
    f.label = `${LEVELS[level++ % LEVELS.length]}`;
    features.push(f);
    return f;
  };

  // Whoever is nearest, for heads that turn and packs that stalk.
  const nearestCit = (x: number, y: number): Cit | null => {
    let best: Cit | null = null;
    let bd = 10;
    for (const c of cits) {
      const dd = Math.hypot(c.x - x, c.y - y);
      if (dd < bd) {
        bd = dd;
        best = c;
      }
    }
    return best;
  };
  const idle = (x: number, y: number, k: number): { face: number; act: MAct } => {
    const c = nearestCit(x, y);
    if (c)
      return { face: c.x >= x ? 1 : -1, act: Math.hypot(c.x - x, c.y - y) < 6 ? "stalk" : "pace" };
    const r = hash(k, 61);
    return { face: hash(k, 62) < 0.5 ? 1 : -1, act: r < 0.6 ? "pace" : "rest" };
  };

  // The fights first, so idle packs can turn to the citizens near them.
  const roleOf = (r: string): Pocket | undefined => pockets.find((p) => p.role === r);
  const fights: (() => void)[] = [];

  {
    // The den fight: joshyboy88 lands a crit on the elite at the mouth; pixelwitch holds the hounds; goofguy shoots.
    const p = roleOf("denfight");
    if (p) {
      denAt(p);
      const x = p.x;
      const y = p.y;
      const a = cit(0, x + 2.0, y + 2.6, "hit", -1);
      const b = cit(3, x - 2.9, y + 3.4, "swing", 1);
      const c = cit(2, x + 6.4, y + 4.4, "shoot", -1);
      fights.push(() => {
        elite(x + 3.0, y + 1.6, -1, "hurt");
        hound(x - 4.6, y + 3.6, 1, "hurt", 1);
        hound(x - 4.3, y + 1.6, 1, "lunge", 2);
        hound(x - 1.2, y + 5.4, -1, "coil", 0);
        hound(x + 3.6, y + 4.8, -1, "lunge", 1);
        hound(x - 3.2, y - 0.4, 1, "coil", 0);
        swarm(x - 0.6, y + 4.0, 22, { toward: [a.x, a.y], sx: 0.55, sy: 0.32, flash: 0.1 });
        swingOf(a, Math.PI + 0.2);
        swingOf(b, -0.1);
        under.push((d) =>
          drawSwing(d, b.x, b.y / ST - 0.5, 1.6, 0.2, 2.0, 0.2, (crowd[3] as Look).cloak, 99),
        );
        impact(x + 0.5, y + 2.0, 1.1, 1);
        impact(x - 4.4, y + 3.6, 0.8, 2);
        num(x + 5.6, y - 0.6, 1284, 72, true);
        num(x - 5.6, y + 2.6, 212, 36);
        air.push((d) => {
          drawArrow(d, c.x - 1.9, c.y / ST - 1.3, -0.95, -0.3, 1.1, 5);
          drawArrow(d, c.x - 3.6, c.y / ST - 1.6, -0.95, -0.28, 1.0, 6);
        });
        num(x + 3.9, y + 3.2, 64, 30);
        spill(x - 4.0, y + 4.2, -0.6, 0.4, 0.4, 1);
        spill(x - 0.5, y + 3.5, 0.6, 0.7, 0.8, 0);
        spill(x + 1.5, y + 4.0, 0.9, 0.2, 2, 0);
        spill(x - 2.2, y + 1.3, -0.5, -0.4, 40, 1);
        air.push((d) =>
          drawDrop(d, x + 4.5, (y + 1.2) / ST, x + 4.5, (y + 1.2) / ST, 2, 2, 1, 61, 0),
        );
      });
    }
  }
  {
    // The chest: xXxKittyKatxXx works it while Bo7 throws the mites off with a maul and mossy_dan slings at the brute.
    const p = roleOf("chest");
    if (p) {
      const x = p.x;
      const y = p.y;
      features.push({ x, y, kind: "chest", build: 0, seed: p.seed });
      const w = cit(1, x - 0.9, y + 0.6, "chest", 1);
      const m = cit(8, x + 2.6, y + 3.0, "slam", 1);
      const s = cit(4, x - 3.6, y + 3.8, "sling", 1);
      fights.push(() => {
        brute(x + 3.4, y + 0.4, -1, "coil");
        hound(x - 2.8, y + 1.6, 1, "lunge", 2);
        hound(x + 6.2, y + 4.0, -1, "coil", 1);
        hound(x + 0.6, y + 5.2, 1, "hurt", 0);
        swarm(x + 4.6, y + 3.6, 14, { toward: [m.x, m.y], sx: 0.5, sy: 0.3, max: 20 });
        // The work at the chest: an arc of strokes round the worker's feet, half filled.
        ground.push((d) => {
          const look = crowd[1] as Look;
          for (let k = 0; k < 9; k++) {
            const ang = -Math.PI * 0.95 + (k / 12) * Math.PI * 1.9;
            const r0 = 0.9;
            d.line(
              w.x + Math.cos(ang) * r0,
              w.y + Math.sin(ang) * r0 * 0.55,
              w.x + Math.cos(ang) * (r0 + 0.35),
              w.y + Math.sin(ang) * (r0 + 0.35) * 0.55,
              HEAVY,
              700 + k,
            );
          }
          d.ink = look.cloak;
          for (let k = 0; k < 9; k++) {
            const ang = -Math.PI * 0.95 + (k / 12) * Math.PI * 1.9;
            d.line(
              w.x + Math.cos(ang) * 0.95,
              w.y + Math.sin(ang) * 0.52,
              w.x + Math.cos(ang) * 1.2,
              w.y + Math.sin(ang) * 0.66,
              CONTOUR,
              720 + k,
            );
          }
          d.ink = INK;
          // The maul's slam: a ring on the ground, cracked.
          const cx = m.x + 1.6;
          const cy = m.y + 0.3;
          const rx = 90 / 2 / T;
          const ry = 72 / 2 / T;
          d.wash(d.round(cx, cy, rx, ry, 16, 5), BLOW, 0.22, true);
          d.curve(d.round(cx, cy, rx, ry, 16, 5).slice(), CONTOUR, 730, true);
          d.curve(d.round(cx, cy, rx * 0.62, ry * 0.62, 12, 6).slice(), FORM, 731, true);
          for (let k = 0; k < 7; k++) {
            const ang = (k / 7) * Math.PI * 2 + 0.3;
            d.line(
              cx + Math.cos(ang) * rx * 0.3,
              cy + Math.sin(ang) * ry * 0.3,
              cx + Math.cos(ang) * rx * 1.25,
              cy + Math.sin(ang) * ry * 1.25,
              FORM,
              740 + k,
            );
          }
          // The brute's blow coming: its shape filling with strokes.
          drawTelegraph(d, x + 3.4, y + 0.6, Math.atan2(m.y - y - 0.6, m.x - x - 3.4), 2.6, 0.55);
        });
        // Six mites thrown two tiles in a fan off the slam.
        const thrown: MiteAt[] = [];
        for (let k = 0; k < 6; k++) {
          const ang = -0.7 + (k / 5) * 1.4;
          const r = 1.6 + hash(k, 8) * 0.8;
          thrown.push({
            x: m.x + 1.6 + Math.cos(ang) * r,
            y: m.y + 0.3 + Math.sin(ang) * r * 0.6,
            face: k % 2 ? 1 : -1,
            flash: k === 2,
            air: 0.6 + hash(k, 9) * 0.9,
          });
        }
        swarms.push({
          x: m.x,
          y: m.y,
          weight: 0,
          min: 0,
          max: 0,
          toward: null,
          sx: 0,
          sy: 0,
          flash: 0,
          seed: 991,
          mites: thrown,
        });
        num(m.x + 3.4, m.y - 0.6, 318, 36);
        air.push((d) => drawStone(d, s.x + 3.4, (s.y - 1.6) / ST, 1.5));
        num(x + 0.6, y + 3.4, 41, 30);
        spill(m.x + 2.6, m.y + 0.6, 1, 0.2, 0.3, 0);
        spill(m.x + 3.2, m.y - 0.2, 1, -0.4, 0.5, 0);
        spill(x - 2.6, y + 2.4, -0.6, 0.4, 25, 1);
        air.push((d) =>
          drawDrop(d, x - 2.6, (y + 4.8) / ST, x - 2.6, (y + 4.8) / ST, 2, 1, 2, 62, 0),
        );
      });
    }
  }
  {
    // The mow at the nest: joshyboy89 cuts through the swarm and goofguy_'s pot burns its far side.
    const p = roleOf("mow");
    if (p) {
      const x = p.x;
      const y = p.y;
      features.push({ x, y, kind: "nest", build: 0, seed: p.seed });
      features.push({ x: x - 3.0, y: y - 0.6, kind: "scrap", build: 0, seed: p.seed + 1 });
      features.push({ x: x + 3.4, y: y + 0.2, kind: "scrap", build: 1, seed: p.seed + 2 });
      const b = cit(9, x - 1.4, y + 3.0, "swing", 1);
      const pot = cit(7, x - 5.4, y + 4.6, "pot", 1);
      fights.push(() => {
        swarm(x + 1.6, y + 3.6, 40, { toward: [b.x, b.y], sx: 0.6, sy: 0.32, flash: 0.12 });
        swingOf(b, 0.15, 2.8, 2.1, 0.03);
        const bx = x + 3.6;
        const by = y + 4.6;
        ground.push((d) => drawBurn(d, bx, by, 0.6, 77));
        air.push((d) => drawPot(d, pot.x + 4.2, (pot.y - 0.8) / ST, 0.96, -0.2, 1.7, 0, 7));
        impact(x + 0.6, y + 3.0, 0.7, 3);
        num(x + 0.4, y + 1.3, 47, 30);
        num(bx + 1.2, by - 0.3, 96, 30);
        for (let k = 0; k < 7; k++)
          spill(
            x - 0.6 + hash(k, 41) * 2.4,
            y + 2.4 + hash(k, 42) * 1.8,
            1,
            hash(k, 43) - 0.5,
            0.2 + k * 0.5,
            0,
          );
        for (let k = 0; k < 5; k++)
          spill(x - 3 + hash(k, 44) * 3, y + 4 + hash(k, 45) * 1.5, 0.6, 0.6, 10 + k * 8, 0);
      });
    }
  }
  {
    // The south: NotABot_'s spear goes through two hounds; a brute comes with its mites.
    const p = roleOf("spear");
    if (p) {
      const x = p.x;
      const y = p.y;
      features.push({ x: x + 1.2, y, kind: "scrap", build: 0, seed: p.seed });
      features.push({ x: x - 2.4, y: y - 0.4, kind: "scrap", build: 1, seed: p.seed + 1 });
      features.push({ x: x + 3.6, y: y + 0.6, kind: "bones", build: 0, seed: p.seed + 2 });
      const s = cit(12, x - 3.2, y + 3.0, "thrust", 1);
      fights.push(() => {
        const reach = 120 / T;
        hound(s.x + reach * 0.45, s.y + 0.1, -1, "flash", 0);
        hound(s.x + reach * 0.85, s.y + 0.2, -1, "hurt", 2);
        hound(s.x + reach + 1.4, s.y - 0.1, -1, "hurt", 1, 0.9);
        brute(x + 5.2, y + 2.4, -1, "run");
        swarm(x + 4.4, y + 3.6, 14, { toward: [s.x, s.y], sx: 0.5, sy: 0.28, max: 16 });
        hound(x - 0.6, y + 5.4, -1, "coil", 1);
        flat.push((d) => {
          // The thrust: a line through everything on it.
          const look = crowd[12] as Look;
          const x0 = px(s.x) + 14;
          const y0 = py(s.y) - S * T * ST * 0.42;
          const x1 = x0 + 120;
          d.fill(
            [x0, y0 - 1.5, x1, y0 - 0.5, x1 + 10, y0, x1, y0 + 0.5, x0, y0 + 2.5],
            look.cloak,
            0.9,
          );
          d.line(x0 + 10, y0 - 3, x1 - 6, y0 - 2, HAIR, 801);
          d.line(x0 + 10, y0 + 4, x1 - 20, y0 + 3.5, HAIR, 802);
        });
        impact(s.x + reach * 0.45, s.y, 0.7, 4);
        num(s.x + reach * 0.7, s.y - 1.0, 164, 30);
        num(s.x + reach + 2.4, s.y - 1.8, 230, 36);
        spill(s.x + reach * 0.5, s.y + 0.3, 1, 0, 0.3, 1);
        spill(s.x + reach + 0.6, s.y + 0.1, 1, -0.2, 0.2, 1);
        spill(x - 0.5, y + 1.6, 0.3, 0.6, 60, 2);
      });
    }
  }
  {
    // The seam: kraken_main was working it; the pack that stalked has lunged.
    const p = roleOf("ore");
    if (p) {
      const x = p.x;
      const y = p.y;
      features.push({ x, y, kind: "ore", build: 0, seed: p.seed });
      features.push({ x: x + 2.8, y: y + 0.5, kind: "scrap", build: 1, seed: p.seed + 1 });
      const c = cit(13, x - 0.4, y + 1.6, "swing", -1);
      fights.push(() => {
        hound(x - 2.4, y + 2.0, 1, "lunge", 0);
        hound(x - 4.0, y + 3.4, 1, "coil", 2);
        hound(x - 3.6, y + 0.4, 1, "stalk", 1);
        hound(x + 1.8, y + 3.6, -1, "lunge", 1);
        swingOf(c, Math.PI - 0.1);
        impact(x - 2.0, y + 1.9, 0.7, 5);
        num(x - 3.1, y + 0.4, 88, 30);
        spill(x - 2.6, y + 2.3, -0.7, 0.3, 0.4, 1);
      });
    }
  }
  {
    // The south-west scrap: sleepyotter at work, the swarm turned toward them and closing.
    const p = roleOf("closing");
    if (p) {
      const x = p.x;
      const y = p.y;
      features.push({ x: x - 1.2, y, kind: "scrap", build: 0, seed: p.seed });
      features.push({ x: x + 1.8, y: y - 0.3, kind: "scrap", build: 1, seed: p.seed + 1 });
      const c = cit(11, x + 0.9, y + 1.4, "hammer", -1);
      fights.push(() => {
        swarm(x - 3.6, y + 3.4, 26, { toward: [c.x, c.y], sx: 0.6, sy: 0.32 });
      });
    }
  }
  {
    // The west den: definitely_not_a_goblin_7 shoots into its pack from range; two hounds come for them.
    const p = roleOf("bow");
    if (p) {
      denAt(p);
      const x = p.x;
      const y = p.y;
      const side = x < CITY.x ? 1 : -1;
      const c = cit(6, x + side * 6.2, y + 3.6, "shoot", -side);
      fights.push(() => {
        elite(x - side * 3.2, y + 1.0, side, "rest");
        hound(x + side * 2.6, y + 2.6, side, "hurt", 0);
        hound(x + side * 4.2, y + 3.2, side, "run", 1);
        hound(x + side * 3.6, y + 4.6, side, "run", 2);
        hound(x - side * 2.6, y + 2.4, side, "pace", 1);
        swarm(x - side * 0.6, y + 4.2, 22, { sx: 0.6, sy: 0.32 });
        air.push((d) =>
          drawArrow(d, x + side * 3.8, (y + 2.4) / ST - 1.0, -side * 0.98, -0.12, 1.0, 9),
        );
        impact(x + side * 2.6, y + 2.6, 0.7, 6);
        num(x + side * 2.2, y + 0.7, 71, 30);
        spill(x + side * 2.2, y + 2.9, -side, 0.2, 0.5, 1);
        void c;
      });
    }
  }
  // lil_gremlin coming home loaded, with the unique on the bundle, on the way in from the east.
  {
    // On the worn path most nearly east, where nothing else stands.
    let best: [number, number] = [CITY.x + 13, CITY.y + 2];
    let bestScore = 1e9;
    for (const path of paths) {
      const ex = path[path.length - 2] as number;
      const ey = path[path.length - 1] as number;
      const gap = angleGap(angleOf(ex, ey), 0.15);
      const pn = path.length / 2;
      for (let i = Math.floor(pn * 0.2); i < pn * 0.8; i++) {
        const x = path[i * 2] as number;
        const y = path[i * 2 + 1] as number;
        if (inCity(x, y, -2.5)) continue;
        const room = Math.min(...pockets.map((p) => Math.hypot((p.x - x) * 0.8, p.y + 2 - y)));
        if (room < 5.5) continue;
        const s = gap * 10 - room * 0.3;
        if (s < bestScore) {
          bestScore = s;
          best = [x, y];
        }
      }
    }
    cit(14, best[0], best[1], "walk", best[0] > CITY.x ? -1 : 1, { haul: 1, pennant: true });
  }
  for (const f of fights) f();
  // Fresh ink where each fighter's blows have been landing.
  for (const c of cits) {
    if (c.act === "walk" || c.act === "hammer" || c.act === "chest") continue;
    const reach = c.act === "shoot" || c.act === "sling" || c.act === "pot" ? 4.5 : 1.8;
    spill(c.x + c.face * reach, c.y + 0.5, c.face, 0.3, 0.6, 1);
    spill(c.x + c.face * (reach + 0.8), c.y - 0.4, c.face, -0.4, 1.4, 0);
    spill(c.x + c.face * (reach - 0.4), c.y + 1.3, c.face * 0.6, 0.8, 6, 0);
  }

  // Pockets nobody has reached.
  for (const p of pockets) {
    if (p.role) continue;
    const x = p.x;
    const y = p.y;
    const r = (k: number): number => hash(p.seed, k);
    const pack = (
      n: number,
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      a0: number,
      a1: number,
    ): void => {
      for (let k = 0; k < n; k++) {
        const ang = lerp(a0, a1, n === 1 ? 0.5 : k / (n - 1)) + (r(k + 20) - 0.5) * 0.3;
        const hx = cx + Math.cos(ang) * rx * (0.85 + r(k + 30) * 0.3);
        const hy = cy + Math.sin(ang) * ry * (0.85 + r(k + 40) * 0.3);
        const i = idle(hx, hy, p.seed + k);
        hound(hx, hy, i.face, i.act);
      }
    };
    if (p.kind === "den") {
      denAt(p);
      const e = idle(x, y + 1.8, p.seed);
      elite(x + (r(6) < 0.5 ? 3.2 : -3.2), y + 1.0, e.face, e.act === "pace" ? "rest" : e.act);
      pack(4 + Math.floor(r(1) * 2), x, y + 1.4, 3.6, 2.2, 0.1, Math.PI - 0.1);
      swarm(x + (r(2) - 0.5) * 1.5, y + 4.4, 1, { sx: 0.6, sy: 0.32 });
    } else if (p.kind === "chest") {
      features.push({ x, y, kind: "chest", build: 0, seed: p.seed });
      const side = r(3) < 0.5 ? 1 : -1;
      const e = idle(x + side * 1.6, y + 0.3, p.seed);
      brute(x + side * 1.7, y + 0.5, e.face, e.act === "stalk" ? "coil" : "rest");
      pack(3, x, y + 1.0, 3.2, 2.2, 0.4, Math.PI - 0.4);
      swarm(x + side * 1.4, y + 2.6, 0.55, { sx: 0.5, sy: 0.3, max: 22 });
    } else if (p.kind === "scrap") {
      features.push({ x: x - 1.4, y, kind: "scrap", build: 0, seed: p.seed });
      features.push({ x: x + 1.6, y: y + 0.5, kind: "scrap", build: 1, seed: p.seed + 1 });
      swarm(x, y + 2.8, 1.3, { sx: 0.62, sy: 0.32 });
      if (r(4) < 0.5) pack(3, x, y + 1.0, 4.0, 2.6, 0.2, Math.PI - 0.2);
    } else if (p.kind === "ore") {
      features.push({ x, y, kind: "ore", build: 0, seed: p.seed });
      features.push({ x: x + 2.6, y: y + 0.4, kind: "scrap", build: 1, seed: p.seed + 1 });
      pack(4, x + 0.5, y + 1.2, 4.2, 2.6, 0.2, Math.PI - 0.2);
      swarm(x - 0.6, y + 3.4, 0.5, { max: 20 });
    } else {
      features.push({ x, y, kind: "nest", build: 0, seed: p.seed });
      features.push({ x: x + 2.8, y: y + 0.3, kind: "scrap", build: 0, seed: p.seed + 1 });
      swarm(x + 0.4, y + 2.9, 1.7, { sx: 0.62, sy: 0.33 });
    }
  }

  // Between pockets: packs, swarms and brutes with their mites, out where nothing else is.
  for (let n = 0, tries = 0; n < cfg.roam && tries < 3000; tries++) {
    const x = lerp(4, W - 4, random());
    const y = lerp(5, H - 4, random());
    if (inCity(x, y, 1) || underCorner(x, y, 1.5) || nearLine(river, x, y) < 2.4) continue;
    if (pockets.some((p) => Math.hypot(p.x - x, p.y + 1.5 - y) < 6.5)) continue;
    if (things.some((t) => Math.hypot(t.x - x, t.y - y) < 2.2)) continue;
    if (massAt.some(([mx, my, ml]) => x > mx - 2 && x < mx + ml + 2 && y > my - 5.5 && y < my + 2))
      continue;
    const kind = n % 3;
    if (kind === 0) {
      for (let k = 0; k < 4; k++) {
        const i = idle(x + (k - 1.5) * 1.6, y + (k % 2) * 1.1, n * 7 + k);
        hound(x + (k - 1.5) * 1.6, y + (k % 2) * 1.1, i.face, i.act);
      }
    } else if (kind === 1) {
      swarm(x, y, 0.9, { max: 26 });
    } else {
      const i = idle(x, y, n);
      brute(x, y, i.face, i.act === "stalk" ? "coil" : "rest");
      swarm(x + 0.4, y + 1.6, 0.3, { min: 8, max: 9 });
    }
    n++;
  }

  // Share the mites out so the whole map holds about what it should.
  const big = mons.length;
  const flying = swarms.reduce((s, w) => s + w.mites.length, 0);
  let left2 = Math.max(0, cfg.monsters - big - flying);
  const fixed = swarms.filter((w) => w.weight > 1.99);
  const shared = swarms.filter((w) => w.weight > 0 && w.weight <= 1.99);
  const sizes = new Map<SwarmReq, number>();
  for (const w of fixed) {
    const n = Math.round(w.weight);
    sizes.set(w, n);
    left2 -= n;
  }
  const total = shared.reduce((s, w) => s + w.weight, 0) || 1;
  for (const w of shared)
    sizes.set(w, Math.max(w.min, Math.min(w.max, Math.round((left2 * w.weight) / total))));
  for (const w of swarms) {
    const n = sizes.get(w);
    if (n === undefined) continue;
    const rx = Math.sqrt(n) * w.sx;
    const ry = Math.sqrt(n) * w.sy;
    const rnd = rng(w.seed);
    for (let k = 0; k < n; k++) {
      // A crawling mass: thick in the middle, a few strays at its edge.
      const ang = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * (rnd() < 0.12 ? 1.35 : 1);
      const mx = w.x + Math.cos(ang) * rx * rr;
      const my = w.y + Math.sin(ang) * ry * rr;
      const face = w.toward
        ? w.toward[0] >= mx
          ? 1
          : -1
        : noise1(mx * 0.7 + my, w.seed) > 0
          ? 1
          : -1;
      w.mites.push({ x: mx, y: my, face, flash: rnd() < w.flash, air: 0 });
    }
  }
  const count = mons.length + swarms.reduce((s, w) => s + w.mites.length, 0);

  return {
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
    features,
    mons,
    swarms,
    cits,
    spills,
    ground,
    under,
    air,
    flat,
    nums,
    count,
  };
}

// ---------------------------------------------------------------- drawing helpers

function groundSpace(d: Draw): void {
  d.push();
  d.move(OX - VX * T, OY - VY * T);
  d.scale(T);
}

function standSpace(d: Draw): void {
  d.push();
  d.move(OX - VX * T, OY - VY * T);
  d.scale(T, T * ST);
}

function castShadow(d: Draw, x: number, y: number, h: number, w: number): void {
  const pts: number[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const along = Math.cos(a) * (w * 0.36 + h * 0.26);
    const across = Math.sin(a) * (w * 0.22 + 0.06);
    const cx = x + w * 0.12 + h * 0.24;
    const cy = y + 0.08 + h * 0.1;
    pts.push(cx + along * 0.92 - across * 0.35, cy + along * 0.34 + across * 0.9 * GY);
  }
  d.wash(pts, SHADOW, 0.24, true);
}

function citizenPose(c: Cit): Pose {
  let p: Pose;
  switch (c.act) {
    case "hit":
      p = swinging(0.235, c.face);
      break;
    case "swing":
      p = swinging(0.3, c.face);
      break;
    case "shoot":
      p = shooting(1, c.face, true);
      break;
    case "sling":
      p = shooting(0.9, c.face, false);
      p.tool = "sling";
      break;
    case "walk":
      p = walking(4.2 + c.i, 1, c.face);
      break;
    case "hammer":
      p = swinging(0.12 + (c.i % 3) * 0.03, c.face);
      p.tool = "hammer";
      break;
    case "slam":
      p = swinging(0.26, c.face);
      p.tool = "hammer";
      break;
    case "thrust":
      p = pose({
        face: c.face,
        lean: 0.35,
        arm: 1.55,
        arm2: 1.4,
        grip: -1.5,
        step: 0.9,
        stride: 0.4,
        tool: "pole",
        trail: 0.15,
      });
      break;
    case "chest":
      p = pose({
        face: c.face,
        crouch: 0.7,
        lean: 0.45,
        arm: 1.3,
        arm2: 1.0,
        tool: "none",
        nod: 0.2,
      });
      break;
    case "pot":
      p = pose({
        face: c.face,
        lean: 0.22,
        arm: 2.6,
        arm2: -0.5,
        step: 0.8,
        stride: 0.25,
        tool: "none",
        trail: -0.1,
      });
      break;
    default:
      p = swinging(0.3, c.face);
  }
  p.haul = c.haul ?? 0;
  return p;
}

interface Tag {
  x: number;
  y: number;
  name: string;
  rgb: number;
}

interface Item {
  y: number;
  draw: () => void;
}

// ---------------------------------------------------------------- dens, scrap

/** A den: a leaning mound with its mouth in its face, in three builds that differ in size, rim and mouth. */
function drawDen(d: Draw, buildNo: number, seed: number): void {
  const sx = [1, 1.2, 0.85][buildNo] as number;
  const sy = [1, 0.78, 1.25][buildNo] as number;
  const mw = [1, 1.3, 0.62][buildNo] as number;
  d.push();
  d.scale(sx, sy);
  const mound = [-2.4, 0, -2.2, -0.9, -1.5, -1.7, -0.3, -2.0, 1.1, -1.85, 2.0, -1.0, 2.4, 0];
  d.fill(mound, d.ground, 1, true);
  // Earth, warmer than any monster's grey hide.
  d.wash(mound, buildNo === 2 ? 0x9c8262 : buildNo === 1 ? 0xb09a72 : 0xa88c66, 0.85, true);
  d.hatch([0.6, -1.9, 1.1, -1.85, 2.0, -1.0, 2.4, 0, 1.0, 0], 2, INK, 0.6, true);
  const top = d.round(-0.25, -1.72, 1.5, 0.32, 12, seed + 2).slice();
  d.fill(top, buildNo === 1 ? 0x9a9a7a : GROWTH, 0.75, true);
  d.curve(top, FORM, seed + 3, true);
  d.curve(mound, CONTOUR, seed, true);
  const mouth = [
    -1.1 * mw,
    0.02,
    -1.0 * mw,
    -0.8,
    -0.5 * mw,
    -1.22,
    0.3 * mw,
    -1.22,
    0.9 * mw,
    -0.8,
    1.0 * mw,
    0.02,
  ];
  d.fill(mouth, INK, 1, true);
  for (let i = 0; i < 3; i++) {
    d.dot((-0.5 + i * 0.45) * mw, -0.42 - (i % 2) * 0.16, 2.6, PAPER);
    d.dot((-0.34 + i * 0.45) * mw, -0.4 - (i % 2) * 0.16, 2.6, PAPER);
  }
  if (buildNo === 0)
    for (let i = 0; i < 5; i++) {
      const x = -1.9 + i * 0.95;
      d.line(x, -0.1, x + (i - 2) * 0.12, -0.55, CONTOUR, seed + 9 + i);
    }
  if (buildNo === 1)
    // A rim of loose rocks round its top.
    for (let i = 0; i < 6; i++) {
      const x = -1.6 + i * 0.62;
      const y = -1.72 + Math.abs(i - 2.5) * 0.09;
      d.body(d.round(x, y, 0.26, 0.2, 7, seed + 20 + i), {
        wash: STONE,
        washAlpha: 0.9,
        weight: FORM,
        seed: seed + 20 + i,
      });
    }
  if (buildNo === 2) {
    // Bone spikes along its back, and a lip of black under the mouth.
    for (let i = 0; i < 6; i++) {
      const x = -1.7 + i * 0.66;
      const y = -1.6 - Math.sin((i / 5) * Math.PI) * 0.35;
      d.fill(
        [x - 0.12, y + 0.1, x + 0.1 * (i - 2.5) * 0.3, y - 0.55, x + 0.12, y + 0.1],
        PAPER,
        1,
        true,
      );
      d.path(
        [x - 0.12, y + 0.1, x + 0.1 * (i - 2.5) * 0.3, y - 0.55, x + 0.12, y + 0.1],
        FORM,
        seed + 30 + i,
      );
    }
    d.fill(d.round(0, 0.06, 1.2, 0.16, 9, seed + 40), INK, 0.8, true);
  }
  d.pop();
}

function drawScrapHeap(d: Draw, seed: number, small: boolean): void {
  if (small) {
    d.push();
    d.scale(0.8, 0.8);
  }
  d.hatch(d.round(0.4, 0.05, 1.6, 0.25, 9), 2, INK, 0.5);
  const plates: number[][] = [
    [-1.4, 0, -1.2, -0.7, -0.1, -0.9, 0.1, 0],
    [-0.2, 0, 0.1, -1.1, 1.0, -1.25, 1.4, 0],
    [-0.8, -0.6, -0.5, -1.4, 0.4, -1.2, 0.2, -0.5],
  ];
  plates.forEach((p, i) => {
    d.body(p, {
      smooth: false,
      wash: i === 2 ? OXIDE : IRON,
      washAlpha: 0.8,
      weight: CONTOUR,
      seed: seed + i,
    });
    d.hatch(p.slice(4).concat(p.slice(0, 2)), 2, INK, 0.5);
  });
  d.body(d.round(0.9, -1.25, 0.42, 0.42, 10), {
    wash: BRASS,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: seed + 5,
  });
  d.dot(0.9, -1.25, 3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.line(
      0.9 + Math.cos(a) * 0.42,
      -1.25 + Math.sin(a) * 0.42,
      0.9 + Math.cos(a) * 0.56,
      -1.25 + Math.sin(a) * 0.56,
      CONTOUR,
      seed + 10 + i,
    );
  }
  d.line(-1.0, -0.9, -1.8, -1.7, HEAVY, seed + 20);
  if (small) d.pop();
}

// ---------------------------------------------------------------- the city from above

const HULL = [
  -7.5, 0, -7.2, -2.2, -6.2, -2.9, 3.8, -3.0, 6.4, -1.8, 7.6, 0, 6.4, 1.8, 3.8, 3.0, -6.2, 2.9,
  -7.2, 2.2,
];

function drawCityTop(d: Draw, t: number, tags: Tag[], heads: number[]): void {
  const H = 1.7;
  const P = (x: number, y: number, z: number): [number, number] => [
    px(CITY.x + x * CS),
    py(CITY.y + y * GY * CS) - z * T * ST * CS,
  ];
  const poly = (pts: number[], z: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2)
      out.push(...P(pts[i] as number, pts[i + 1] as number, z));
    return out;
  };
  const k = (T / 30) * CS;
  const beam = (a: [number, number], b: [number, number], wa: number, wb: number): number[] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * k;
    const ny = (dx / len) * k;
    return [
      a[0] + nx * wa,
      a[1] + ny * wa,
      b[0] + nx * wb,
      b[1] + ny * wb,
      b[0] - nx * wb,
      b[1] - ny * wb,
      a[0] - nx * wa,
      a[1] - ny * wa,
    ];
  };
  const LEG_X = [-5.4, -2.2, 1.4, 4.4];
  const leg = (x: number, side: number, key: number): void => {
    const out = Math.sign(x || 1);
    const hip = P(x, side * 2.75, H - 0.3);
    const kneeAt = P(
      x * 1.3 + out * 1.0,
      side * (side < 0 ? 4.6 : 5.6),
      H + (side < 0 ? 0.9 : 1.3),
    );
    const foot = P(x * 1.6 + out * 2.0, side * 7.4, 0);
    const far = side < 0;
    const wash = far ? 0.55 : 0.85;
    const weight = far ? CONTOUR : HEAVY;
    d.body(beam(kneeAt, foot, 7, 4), {
      smooth: false,
      wash: IRON,
      washAlpha: wash,
      weight,
      seed: key,
    });
    d.body(beam(hip, kneeAt, 10, 7), {
      smooth: false,
      wash: IRON,
      washAlpha: wash,
      weight,
      seed: key + 1,
    });
    if (!far)
      d.hatch(beam([hip[0] + 2, hip[1] + 3], [kneeAt[0] + 2, kneeAt[1] + 3], 4, 3), 3, INK, 0.6);
    d.body(d.round(kneeAt[0], kneeAt[1], 9 * k, 9 * k, 10), {
      wash: BRASS,
      washAlpha: 0.9,
      weight: CONTOUR,
      seed: key + 2,
    });
    d.dot(kneeAt[0], kneeAt[1], 2.6);
    d.body(d.round(foot[0], foot[1] + 2, 12 * k, 5 * k, 9), {
      wash: IRON,
      washAlpha: 0.8,
      weight: CONTOUR,
      seed: key + 3,
    });
  };

  const shadow: number[] = [];
  for (let i = 0; i < HULL.length; i += 2)
    shadow.push(...P((HULL[i] as number) * 1.05 + 1.4, (HULL[i + 1] as number) * 1.1 + 1.0, 0));
  d.wash(shadow, SHADOW, 0.28, true);
  d.hatch(shadow, 2, INK, 0.35, true);

  LEG_X.forEach((x, i) => leg(x, -1, 700 + i * 10));

  const near: number[] = [];
  const nearPts: [number, number][] = [
    [-7.5, 0],
    [-7.2, 2.2],
    [-6.2, 2.9],
    [3.8, 3.0],
    [6.4, 1.8],
    [7.6, 0],
  ];
  for (const [x, y] of nearPts) near.push(...P(x, y, H));
  for (let i = nearPts.length - 1; i >= 0; i--) {
    const [x, y] = nearPts[i] as [number, number];
    near.push(...P(x * 0.97, y * 0.92, H - 1.25));
  }
  d.body(near, { smooth: false, wash: IRON, washAlpha: 0.9, weight: CONTOUR, seed: 801 });
  d.hatch(near, 3, INK, 0.55);
  const strake: number[] = [];
  for (const [x, y] of nearPts) strake.push(...P(x, y, H));
  for (let i = nearPts.length - 1; i >= 0; i--) {
    const [x, y] = nearPts[i] as [number, number];
    strake.push(...P(x * 0.995, y * 0.985, H - 0.32));
  }
  d.fill(strake, OXIDE, 0.9);
  d.path(strake, FORM, 802, true);
  for (let x = -6; x <= 5.5; x += 0.8) {
    const yy = x < 3.8 ? 2.95 : lerp(3.0, 1.8, (x - 3.8) / 2.6);
    const [rx, ry] = P(x, yy, H - 0.75);
    d.dot(rx, ry, 1.6, PAPER, 0.8);
  }

  const deck = poly(HULL, H);
  d.body(deck, { smooth: false, wash: TIMBER, washAlpha: 0.75, weight: HEAVY, seed: 803 });
  const inner: number[] = [];
  for (let i = 0; i < HULL.length; i += 2)
    inner.push(...P((HULL[i] as number) * 0.95, (HULL[i + 1] as number) * 0.87, H));
  d.path(inner, FORM, 804, true);
  d.strength = 0.5;
  for (let x = -7; x < 7.4; x += 0.55) {
    const [ax, ay] = P(x, -2.6, H);
    const [bx, by] = P(x, 2.6, H);
    d.line(ax, ay, bx, by, HAIR, 805 + Math.round(x * 10));
  }
  d.strength = 1;

  const room = (x0: number, y0: number, x1: number, y1: number, rgb: number, key: number): void => {
    const floor = poly([x0, y0, x1, y0, x1, y1, x0, y1], H);
    d.fill(floor, d.ground, 1);
    d.wash(floor, rgb, 0.8);
    const wall = poly([x0, y0, x1, y0, x1, y1, x0, y1], H + 0.35);
    const farIn = poly([x0, y0, x1, y0, x1, y0 + 0.01, x0, y0 + 0.01], H);
    d.fill(
      [
        wall[0] as number,
        wall[1] as number,
        wall[2] as number,
        wall[3] as number,
        farIn[2] as number,
        farIn[3] as number,
        farIn[0] as number,
        farIn[1] as number,
      ],
      shade(rgb, 0.35),
      0.8,
    );
    d.path(wall, CONTOUR, key, true);
    d.path(farIn.slice(0, 4), HAIR, key + 1);
  };
  room(-6.8, -2.0, -3.7, 2.0, 0xb8ad9a, 810);
  room(-3.5, -2.5, -1.3, -0.25, 0xc9b49a, 811);
  room(-3.5, 0.25, -1.3, 2.5, CANVAS, 812);
  room(1.7, -2.6, 4.1, -0.25, 0xd9c49a, 813);
  room(1.7, 0.25, 4.1, 2.6, 0xe0d4b4, 814);
  room(4.4, -1.3, 6.3, 1.3, 0xc9b49a, 815);

  const [bx, by] = P(-5.3, 0, H);
  d.body(d.round(bx, by, 1.0 * T * CS, 0.85 * T * GY * CS, 14), {
    wash: BRASS,
    washAlpha: 0.85,
    weight: CONTOUR,
    seed: 820,
  });
  d.hatch(d.round(bx + 8 * k, by + 6 * k, 0.6 * T * CS, 0.5 * T * GY * CS, 10), 2, INK, 0.5);
  d.dot(bx - 6 * k, by - 4 * k, 6 * k, 0xd98f3e);
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = P(-6.4 + i * 0.4, -1.6, H);
    const [cx, cy] = P(-4.0, -1.6 + i * 0.3, H);
    d.line(ax, ay, cx, cy, FORM, 821 + i);
  }
  for (let i = 0; i < 3; i++) {
    const b = poly(
      [-3.3 + i * 0.68, 0.5, -2.8 + i * 0.68, 0.5, -2.8 + i * 0.68, 2.2, -3.3 + i * 0.68, 2.2],
      H + 0.15,
    );
    d.body(b, { smooth: false, wash: 0x8fa3b8, washAlpha: 0.7, weight: FORM, seed: 830 + i });
  }
  const [fx, fy] = P(-2.9, -1.4, H);
  d.body(d.round(fx, fy, 14 * k, 9 * k, 9), {
    wash: 0x6d5e52,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: 840,
  });
  d.dot(fx, fy, 5 * k, 0xe0702c);
  const anvil = P(-1.9, -1.0, H + 0.2);
  d.body(d.box(anvil[0] - 10 * k, anvil[1] - 5 * k, anvil[0] + 10 * k, anvil[1] + 5 * k), {
    smooth: false,
    spot: true,
  });
  const [gx, gy] = P(2.3, -2.0, H);
  d.body(d.box(gx - 12 * k, gy - 8 * k, gx + 12 * k, gy + 8 * k), {
    smooth: false,
    wash: 0x6d5e52,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: 850,
  });
  d.dot(gx - 5 * k, gy, 3, 0xe0702c);
  const tb = poly([2.9, -1.4, 3.9, -1.4, 3.9, -0.6, 2.9, -0.6], H + 0.25);
  d.body(tb, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: FORM, seed: 851 });
  const ct = poly([2.0, 0.9, 3.6, 0.9, 3.6, 2.1, 2.0, 2.1], H + 0.25);
  d.body(ct, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: FORM, seed: 860 });
  const mp = poly([2.2, 1.05, 3.4, 1.0, 3.45, 1.95, 2.25, 1.9], H + 0.27);
  d.body(mp, { smooth: false, wash: PAPER, washAlpha: 1, weight: HAIR, seed: 861 });
  const [wx, wy] = P(5.6, 0, H + 0.3);
  d.curve(d.round(wx, wy, 12 * k, 12 * k * GY, 12).slice(), CONTOUR, 870, true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    d.line(
      wx - Math.cos(a) * 15 * k,
      wy - Math.sin(a) * 15 * k * GY,
      wx + Math.cos(a) * 15 * k,
      wy + Math.sin(a) * 15 * k * GY,
      FORM,
      871 + i,
    );
  }
  for (const [gxp, dir] of [
    [6.9, 1],
    [-6.9, -1],
  ] as const) {
    const [cx, cy] = P(gxp, 0, H + 0.2);
    d.body(d.round(cx, cy, 16 * k, 13 * k, 12), {
      wash: IRON,
      washAlpha: 0.8,
      weight: CONTOUR,
      seed: 880 + dir,
    });
    d.body(
      [
        cx,
        cy - 4 * k,
        cx + dir * 34 * k,
        cy - 7 * k,
        cx + dir * 34 * k,
        cy + 1 * k,
        cx,
        cy + 4 * k,
      ],
      { smooth: false, spot: true, seed: 882 + dir },
    );
  }
  for (const [x, y, kind] of [
    [-0.9, -2.0, 0],
    [-0.4, -2.1, 1],
    [1.0, 1.9, 0],
    [1.2, 1.3, 1],
    [-0.9, 2.0, 1],
    [6.6, 1.0, 0],
  ] as const) {
    const [cx, cy] = P(x, y, H + 0.2);
    if (kind === 0) {
      d.body(d.box(cx - 9 * k, cy - 7 * k, cx + 9 * k, cy + 7 * k), {
        smooth: false,
        wash: TIMBER,
        washAlpha: 0.95,
        weight: FORM,
        seed: 1000 + Math.round(x * 10),
      });
      d.line(cx - 9 * k, cy - 7 * k, cx + 9 * k, cy + 7 * k, HAIR, 1001);
    } else {
      d.body(d.round(cx, cy, 8 * k, 7 * k, 9), {
        wash: 0xa8845a,
        washAlpha: 0.95,
        weight: FORM,
        seed: 1002 + Math.round(x * 10),
      });
      d.curve(d.round(cx, cy, 5 * k, 4 * k, 8).slice(), HAIR, 1003, true);
    }
  }

  // The two aboard: one at the bench, one at the fore gun.
  for (const [i, x, y, face, kind] of ABOARD) {
    const look = crowd[i] as Look;
    const [fxp, fyp] = P(x, y, H);
    const p =
      kind === "hammer"
        ? swinging(0.14, face)
        : kind === "walk"
          ? walking(2.3 + i, 1, face)
          : kind === "stand"
            ? pose({ face, arm: 0.9, arm2: 0.7, tool: "none" })
            : shooting(1, face, kind !== "draw");
    if (kind === "hammer") p.tool = "hammer";
    if (kind === "shoot" || kind === "draw") p.tool = "bow";
    d.push();
    d.move(fxp, fyp);
    d.scale(T, T * ST);
    drawCitizen(d, look, p, 0, 0, S, detailFor(S * T));
    d.pop();
    const top = fyp - S * T * ST * HAT_TOP * 0.82;
    tags.push({ x: fxp, y: top, name: look.name, rgb: look.cloak });
    heads.push(fxp - 0.45 * S * T, fyp - S * T * ST, fxp + 0.45 * S * T, fyp - 0.45 * S * T * ST);
  }

  // The mast, at 3.5 tiles, with the crow's nest and the lantern.
  const m0 = P(0.2, 0, H);
  const m1 = P(0.2, 0, H + 3.5);
  d.body(d.round(m0[0], m0[1], 13 * k, 10 * k, 10), {
    wash: TIMBER,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: 890,
  });
  for (const [x, y] of [
    [-6.2, -2.8],
    [3.8, -2.9],
    [-6.2, 2.8],
    [3.8, 2.9],
  ] as const) {
    const [ax, ay] = P(x, y, H + 0.2);
    d.line(m1[0], m1[1] + 24 * k, ax, ay, HAIR, 891 + Math.round(x));
  }
  d.body([m0[0] - 4 * k, m0[1], m1[0] - 3 * k, m1[1], m1[0] + 3 * k, m1[1], m0[0] + 4 * k, m0[1]], {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: 895,
  });
  const nest = P(0.2, 0, H + 2.7);
  d.body(d.round(nest[0], nest[1], 15 * k, 7 * k, 10), {
    wash: TIMBER,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: 896,
  });
  d.dot(m1[0], m1[1], 11 * k, LAMP, 0.35);
  d.body(d.round(m1[0], m1[1], 6 * k, 7 * k, 8), {
    wash: LAMP,
    washAlpha: 1,
    weight: FORM,
    seed: 897,
  });
  d.curve(
    [m1[0], m1[1] - 8 * k, m1[0] + 18 * k, m1[1] - 12 * k, m1[0] + 34 * k, m1[1] - 6 * k],
    CONTOUR,
    898,
  );
  const s0 = P(-5.6, -0.4, H + 0.6);
  const s1 = P(-5.6, -0.4, H + 2.6);
  d.body([s0[0] - 7 * k, s0[1], s1[0] - 7 * k, s1[1], s1[0] + 7 * k, s1[1], s0[0] + 7 * k, s0[1]], {
    smooth: false,
    wash: IRON,
    washAlpha: 0.9,
    weight: CONTOUR,
    seed: 899,
  });
  for (let i = 0; i < 4; i++) {
    const r = (9 + i * 5) * k;
    d.body(
      d.round(
        s1[0] - (10 + i * 16) * k + Math.sin(t + i) * 3,
        s1[1] - (14 + i * 16) * k,
        r,
        r * 0.8,
        9,
        900 + i,
      ),
      { wash: 0xcfc7bb, washAlpha: 0.5, weight: HAIR, seed: 900 + i },
    );
  }

  const r0a = P(4.4, 2.75, H);
  const r0b = P(5.6, 2.2, H);
  const r1a = P(7.6, 5.8, 0);
  const r1b = P(8.8, 5.2, 0);
  const ramp = [r0a[0], r0a[1], r0b[0], r0b[1], r1b[0], r1b[1], r1a[0], r1a[1]];
  d.body(ramp, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: CONTOUR, seed: 910 });
  for (let i = 1; i < 8; i++) {
    const u = i / 8;
    d.line(
      lerp(r0a[0], r1a[0], u),
      lerp(r0a[1], r1a[1], u),
      lerp(r0b[0], r1b[0], u),
      lerp(r0b[1], r1b[1], u),
      HAIR,
      911 + i,
    );
  }

  LEG_X.forEach((x, i) => leg(x, 1, 760 + i * 10));
}

// ---------------------------------------------------------------- the black

interface Station {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  nx: number;
  ny: number;
  env: number;
}

const BRUISE = 0x5a2a3a;

/** The black along one whole edge, in frame pixels, at about `depth` deep. */
function band(
  edge: "n" | "s" | "e" | "w",
  from: number,
  to: number,
  depth: number,
  seed: number,
): Station[] {
  const out: Station[] = [];
  const steps = Math.max(2, Math.round((to - from) / 12));
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const along = lerp(from, to, u);
    const dd =
      depth * (0.8 + 0.2 * noise1(along / 190, seed)) +
      16 * noise1(along / 46, seed + 1) +
      7 * noise1(along / 14, seed + 2);
    const dep = Math.max(0, dd);
    let x = 0;
    let y = 0;
    let nx = 0;
    let ny = 0;
    if (edge === "e") [x, y, nx, ny] = [FRAME.x1, along, -1, 0];
    else if (edge === "w") [x, y, nx, ny] = [FRAME.x0, along, 1, 0];
    else if (edge === "n") [x, y, nx, ny] = [along, FRAME.y0, 0, 1];
    else [x, y, nx, ny] = [along, FRAME.y1, 0, -1];
    out.push({
      ix: x + nx * dep,
      iy: y + ny * dep,
      ox: x - nx * 40,
      oy: y - ny * 40,
      nx,
      ny,
      env: Math.min(1, dep / Math.max(1, depth * 0.6)),
    });
  }
  return out;
}

function drawBlack(d: Draw, st: Station[], t: number, seed: number): void {
  const n = st.length;
  if (n < 2) return;
  const strip: number[] = [];
  for (const [ahead, alpha] of [
    [130, 0.08],
    [56, 0.12],
  ] as const) {
    strip.length = 0;
    for (let i = 0; i < n; i++) {
      const s = st[i] as Station;
      const a = ahead * s.env * (0.75 + 0.25 * noise1(i / 9, seed + 3));
      strip.push(s.ix + s.nx * a, s.iy + s.ny * a, s.ox, s.oy);
    }
    d.surface.strip(strip, n, BRUISE, alpha, true);
  }
  for (let i = 0; i + 1 < n; i += 8) {
    const j = Math.min(n - 1, i + 8);
    const poly: number[] = [];
    for (let k = i; k <= j; k++) {
      const s = st[k] as Station;
      poly.push(s.ix, s.iy);
    }
    for (let k = j; k >= i; k--) {
      const s = st[k] as Station;
      const a = (38 + 12 * noise1(k / 6, seed + 4)) * s.env;
      poly.push(s.ix + s.nx * a, s.iy + s.ny * a);
    }
    d.hatch(poly, 2, BLOW, 0.9, false, 2.2);
  }
  strip.length = 0;
  for (let i = 0; i < n; i++) {
    const s = st[i] as Station;
    const bump =
      Math.abs(Math.sin(i * 0.9 + noise1(i / 7, seed + 5) * 3)) * 14 + hash(i, seed + 6) * 7;
    strip.push(s.ix + s.nx * bump, s.iy + s.ny * bump, s.ox, s.oy);
  }
  d.surface.strip(strip, n, INK, 1);
  for (let i = 1; i < n - 1; i += 3) {
    const s = st[i] as Station;
    const tx = -s.ny;
    const ty = s.nx;
    const len = 16 + hash(i, seed + 7) * 20;
    const lean = (hash(i, seed + 8) - 0.5) * 20;
    d.line(
      s.ix - s.nx * 4,
      s.iy - s.ny * 4,
      s.ix + s.nx * len + tx * lean,
      s.iy + s.ny * len + ty * lean,
      CONTOUR,
      i + 600,
    );
    if (i % 9 === 0) {
      const out = 34 + hash(i, seed + 9) * 40;
      const hx = s.ix + s.nx * out;
      const hy = s.iy + s.ny * out;
      d.fill(
        [
          s.ix + tx * 14,
          s.iy + ty * 14,
          hx + tx * 8,
          hy + ty * 8,
          hx + s.nx * 20,
          hy + s.ny * 20,
          hx - tx * 8,
          hy - ty * 8,
          s.ix - tx * 14,
          s.iy - ty * 14,
        ],
        INK,
        1,
        true,
      );
      d.dot(hx + tx * 3, hy + ty * 3, 2.6, PAPER);
      for (let tooth = 0; tooth < 3; tooth++) {
        const bx = hx + s.nx * (6 + tooth * 5) - tx * 4;
        const by = hy + s.ny * (6 + tooth * 5) - ty * 4;
        d.fill([bx, by, bx + s.nx * 4, by + s.ny * 4, bx - tx * 6, by - ty * 6], PAPER);
      }
    }
  }
  // Eyes in clusters, thick near the front.
  for (let i = 2; i < n; i += 5) {
    if (noise1(i / 6, seed + 12) < -0.15) continue;
    const s = st[i] as Station;
    const room = Math.hypot(s.ix - s.ox, s.iy - s.oy) - 40;
    if (room < 20) continue;
    const back = 10 + hash(i, seed + 10) * Math.min(40, room * 0.7);
    const ex = s.ix - s.nx * back;
    const ey = s.iy - s.ny * back;
    if (ex < FRAME.x0 || ex > FRAME.x1 || ey < FRAME.y0 || ey > FRAME.y1) continue;
    const blink = Math.sin(t * 0.9 + i * 2.7) > 0.93;
    const r = 2.0 + hash(i, seed + 11) * 1.6;
    if (!blink) {
      d.dot(ex, ey, r, PAPER);
      d.dot(ex - s.ny * r * 3, ey + s.nx * r * 3, r * 0.9, PAPER);
    }
  }
}

// ---------------------------------------------------------------- tags

const SPOTS: [number, number][] = [];
for (const r of [0, 28, 56, 84, 112, 140])
  for (const ox of r === 0 ? [0] : [0, 50, -50, 100, -100, 150, -150]) SPOTS.push([ox, -r]);
for (const [ox, oy] of [
  [110, 10],
  [-110, 10],
  [0, 70],
  [120, 40],
  [-120, 40],
  [0, 100],
  [160, 0],
  [-160, 0],
  [200, -40],
  [-200, -40],
  [0, 130],
  [180, 70],
  [-180, 70],
] as const)
  SPOTS.push([ox, oy]);

function placeTags(d: Draw, tags: Tag[], taken: number[]): void {
  const placed = [...taken];
  const where: number[] = [];
  const hits = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (x0 < FRAME.x0 + 6 || x1 > FRAME.x1 - 6 || y0 < FRAME.y0 + 6 || y1 > FRAME.y1 - 6)
      return true;
    for (let k = 0; k < placed.length; k += 4)
      if (
        x0 < (placed[k + 2] as number) &&
        x1 > (placed[k] as number) &&
        y0 < (placed[k + 3] as number) &&
        y1 > (placed[k + 1] as number)
      )
        return true;
    return false;
  };
  for (const tag of tags) {
    const w = measure("roman", 24, tag.name) + 12;
    let spot: [number, number] = SPOTS[0] as [number, number];
    for (const s of SPOTS) {
      const cx = tag.x + s[0];
      const base = tag.y + s[1] - 8;
      if (!hits(cx - w / 2, base - 22, cx + w / 2, base + 8)) {
        spot = s;
        break;
      }
    }
    const cx = tag.x + spot[0];
    const base = tag.y + spot[1] - 8;
    placed.push(cx - w / 2, base - 22, cx + w / 2, base + 8);
    where.push(cx, base);
  }
  tags.forEach((tag, i) => {
    const cx = where[i * 2] as number;
    const base = where[i * 2 + 1] as number;
    if (Math.hypot(cx - tag.x, base + 8 - tag.y) > 14)
      d.line(cx, base + 6, tag.x, tag.y + 4, HAIR, i + 5);
  });
  tags.forEach((tag, i) => {
    const cx = where[i * 2] as number;
    const base = where[i * 2 + 1] as number;
    const w = measure("roman", 24, tag.name);
    d.fill(d.box(cx - w / 2 - 1, base + 3, cx + w / 2 + 1, base + 7), d.ground);
    d.fill(d.box(cx - w / 2, base + 4, cx + w / 2, base + 6.5), tag.rgb);
    d.text(tag.name, cx, base, { size: 24, align: 0.5, halo: 1 });
  });
}

// ---------------------------------------------------------------- corners

function slip(d: Draw, x: number, y: number, w: number, h: number, seed: number): void {
  const n = 10;
  d.body(
    [
      x + n,
      y,
      x + w - n,
      y,
      x + w,
      y + n,
      x + w,
      y + h - n,
      x + w - n,
      y + h,
      x + n,
      y + h,
      x,
      y + h - n,
      x,
      y + n,
    ],
    { smooth: false, weight: FORM, seed },
  );
}

interface CornerOpts {
  time?: string;
  elapsed?: number;
  counts?: string[];
  log?: [who: number, what: string, rarity: number];
}

function drawCorners(d: Draw, o: CornerOpts = {}): number[] {
  const taken: number[] = [];
  // The clock: time left before lift-off, the dial filling toward it.
  {
    const x = FRAME.x0 + 18;
    const y = FRAME.y0 + 18;
    const w = 224;
    const h = 104;
    slip(d, x, y, w, h, 31);
    const cx = x + 50;
    const cy = y + h / 2;
    const r = 32;
    const elapsed = o.elapsed ?? 270 / 780;
    const wedge = [cx, cy];
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI / 2 + (i / 40) * elapsed * Math.PI * 2;
      wedge.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    d.wash(wedge, 0xc9a36b, 0.75);
    const end = [cx, cy];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (0.9 + (i / 10) * 0.1) * Math.PI * 2;
      end.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    d.hatch(end, 2, INK, 0.8);
    d.curve(d.round(cx, cy, r, r, 24).slice(), CONTOUR, 32, true);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      d.line(
        cx + Math.cos(a) * (r - 6),
        cy + Math.sin(a) * (r - 6),
        cx + Math.cos(a) * r,
        cy + Math.sin(a) * r,
        i % 3 ? HAIR : FORM,
        40 + i,
      );
    }
    const ha = -Math.PI / 2 + elapsed * Math.PI * 2;
    d.line(cx, cy, cx + Math.cos(ha) * (r - 4), cy + Math.sin(ha) * (r - 4), CONTOUR, 33);
    d.dot(cx, cy, 3);
    d.text(o.time ?? "8:30", x + 98, y + 56, { size: 48 });
    d.text("lift-off", x + 100, y + 86, { size: 24 });
    taken.push(x, y, x + w, y + h);
  }
  // The landing: its size and level range, a modifier a line.
  {
    const lines = ["packs ×2", "rares +40%"];
    const head = "Medium 23–68";
    const w =
      Math.max(measure("roman", 30, head), ...lines.map((l) => measure("roman", 24, l))) + 44;
    const h = 40 + 34 + lines.length * 30;
    const x = FRAME.x1 - 18 - w;
    const y = FRAME.y0 + 18;
    slip(d, x, y, w, h, 51);
    d.text(head, x + 22, y + 44, { size: 30 });
    lines.forEach((l, i) => d.text(l, x + 22, y + 80 + i * 30, { size: 24 }));
    taken.push(x, y, x + w, y + h);
  }
  // The log: who found what, the item in its rarity's colour.
  {
    const [whoIndex, what, rarity] = o.log ?? [14, "Nine Lives", 3];
    const who = (crowd[whoIndex] as Look).name;
    const ww = measure("roman", 30, who);
    const w = ww + 36 + measure("roman", 30, what) + 44;
    const h = 58;
    const x = FRAME.x0 + 18;
    const y = FRAME.y1 - 18 - h;
    slip(d, x, y, w, h, 61);
    d.text(who, x + 22, y + 39, { size: 30 });
    d.fill(d.box(x + 22, y + 44, x + 22 + ww, y + 46.5), (crowd[whoIndex] as Look).cloak);
    d.text(what, x + 22 + ww + 36, y + 39, {
      size: 30,
      rgb: mix(RARITY[rarity] as number, INK, 0.2),
    });
    taken.push(x, y, x + w, y + h);
  }
  // Counts: an icon and a number each.
  {
    const counts = o.counts ?? ["13", "2", "214", "31"];
    const h = 58;
    const cell = (s: string): number => 40 + measure("roman", 30, s) + 22;
    const w = counts.reduce((sum, s) => sum + cell(s), 0) + 16;
    const x0 = FRAME.x1 - 18 - w;
    const y = FRAME.y1 - 18 - h;
    slip(d, x0, y, w, h, 71);
    let x = x0 + 16;
    counts.forEach((s, k) => {
      const ix = x + 14;
      const iy = y + h / 2;
      if (k === 0) {
        d.body([ix - 9, iy + 13, ix - 6, iy - 2, ix + 6, iy - 2, ix + 9, iy + 13], {
          smooth: false,
          wash: 0x7a9cc0,
          weight: FORM,
          seed: 72,
        });
        d.body(d.round(ix, iy - 8, 6, 6, 8), { weight: FORM, seed: 73 });
        d.body([ix - 6, iy - 12, ix, iy - 24, ix + 6, iy - 12], {
          smooth: false,
          weight: FORM,
          wash: 0x7a9cc0,
          seed: 74,
        });
      } else if (k === 1) {
        d.body([ix - 15, iy - 4, ix + 15, iy - 4, ix + 10, iy + 4, ix - 11, iy + 4], {
          smooth: false,
          wash: IRON,
          washAlpha: 0.8,
          weight: FORM,
          seed: 75,
        });
        d.body(d.box(ix - 8, iy - 13, ix + 2, iy - 4), {
          smooth: false,
          wash: OXIDE,
          washAlpha: 0.8,
          weight: FORM,
          seed: 76,
        });
        for (const lx of [-10, -3, 4, 11])
          d.line(ix + lx, iy + 3, ix + lx * 1.35, iy + 14, FORM, 77 + lx);
      } else if (k === 2) {
        d.fill(d.round(ix, iy + 1, 9, 7, 10, 78), INK, 1, true);
        d.dot(ix + 12, iy - 6, 2.4);
        d.dot(ix - 12, iy + 7, 2);
        d.dot(ix + 9, iy + 10, 1.6);
      } else {
        d.body(
          [
            ix - 10,
            iy + 12,
            ix - 11,
            iy,
            ix - 4,
            iy - 7,
            ix + 4,
            iy - 7,
            ix + 11,
            iy,
            ix + 10,
            iy + 12,
          ],
          { wash: 0xc9a36b, washAlpha: 0.85, weight: FORM, seed: 79 },
        );
        d.line(ix - 5, iy - 7, ix + 5, iy - 7, CONTOUR, 80);
        d.line(ix - 2, iy - 7, ix - 5, iy - 13, FORM, 81);
        d.line(ix + 2, iy - 7, ix + 5, iy - 13, FORM, 82);
      }
      d.text(s, x + 38, y + 40, { size: 30 });
      x += cell(s);
    });
    taken.push(x0, y, x0 + w, y + h);
  }
  return taken;
}

function drawFrameRule(d: Draw): void {
  const { x0, y0, x1, y1 } = FRAME;
  const s = d.surface;
  s.paper(0, 0, WIDTH, y0);
  s.paper(0, y1, WIDTH, HEIGHT);
  s.paper(0, y0, x0, y1);
  s.paper(x1, y0, WIDTH, y1);
  d.rule(x0, y0, x1, y0, CONTOUR, 11);
  d.rule(x1, y0, x1, y1, CONTOUR, 12);
  d.rule(x1, y1, x0, y1, CONTOUR, 13);
  d.rule(x0, y1, x0, y0, CONTOUR, 14);
}

/** A number where a blow landed, in frame pixels, on paper so it reads over ink. */
function drawNum(d: Draw, n: Num): number[] {
  const x = px(n.x);
  const y = py(n.y);
  const face = n.crit ? "italic" : "roman";
  const text = String(n.value);
  const w = measure(face, n.size, text);
  const h = n.size * 0.08;
  for (const [ox, oy] of [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
    [-1.5, -1.5],
    [1.5, 1.5],
  ] as const)
    d.surface.text(face, n.size, text, x - w / 2 + ox, y + oy, 0, PAPER, 0.92);
  d.surface.text(face, n.size, text, x - w / 2, y, 0, n.crit ? BLOW : INK, 1);
  if (n.crit)
    d.surface.strip(
      [
        x - w / 2 - 4,
        y + 6 + h,
        x - w / 2 - 4,
        y + 10 + h,
        x + w / 2 + 6,
        y + 4 + h,
        x + w / 2 + 6,
        y + 7 + h,
      ],
      2,
      BLOW,
      1,
    );
  return [x - w / 2 - 4, y - n.size * 0.8, x + w / 2 + 6, y + 12];
}

// ---------------------------------------------------------------- the scene

export function densityScene(name: string): Scene {
  const cfg = CONFIGS[name] ?? (CONFIGS.dense as Config);
  T = cfg.T;
  S = cfg.S;
  MAP_W = cfg.W;
  MAP_H = cfg.H;
  CS = cfg.city;
  CITY = { x: cfg.W / 2, y: cfg.H / 2 + 0.8 * cfg.city };
  const L = build(cfg);
  (globalThis as unknown as { densityCount?: Record<string, unknown> }).densityCount = {
    monsters: L.count,
    hounds: L.mons.filter((m) => m.kind === "hound").length,
    brutes: L.mons.filter((m) => m.kind === "brute").length,
    elites: L.mons.filter((m) => m.kind === "elite").length,
    swarms: L.swarms.map((s) => s.mites.length),
    pockets: L.pockets.map((p) => `${p.kind}${p.role ? `:${p.role}` : ""}`),
    citizensOut: L.cits.length,
  };

  return {
    duration: 1,
    draw(d: Draw, t: number): void {
      const tags: Tag[] = [];
      const heads: number[] = [];
      const numberBoxes: number[] = [];

      // ---- Ground.
      drawGround(d, L);

      // ---- Shadows, and what lies on the ground.
      groundSpace(d);
      for (const m of L.masses) {
        const pts: number[] = [];
        const b = m.base;
        for (let i = 0; i < b.length; i += 2)
          pts.push((b[i] as number) + 0.4, (b[i + 1] as number) + 0.1);
        for (let i = b.length - 2; i >= 0; i -= 2)
          pts.push(
            (b[i] as number) + 0.4 + m.height * 0.55,
            (b[i + 1] as number) + 0.1 + m.height * 0.32,
          );
        d.wash(pts, SHADOW, 0.18, true);
      }
      for (const th of L.things) {
        const h = th.kind <= 4 ? th.size : th.size * 0.6;
        const w = th.kind <= 4 ? th.size * 0.6 : th.size * 1.1;
        castShadow(d, th.x, th.y, h, w);
      }
      for (const f of L.features) {
        if (f.kind === "den") castShadow(d, f.x, f.y, 1.8, 4.4);
        else if (f.kind === "nest") castShadow(d, f.x, f.y, 1.2, 2.6);
        else castShadow(d, f.x, f.y, 1.0, 2.4);
      }
      for (const c of L.cits) castShadow(d, c.x, c.y, S, 0.5);
      for (const m of L.mons)
        castShadow(d, m.x, m.y, m.kind === "hound" ? 0.7 : 1.9, m.kind === "hound" ? 1.6 : 2.4);
      for (const m of L.mons)
        if (m.kind === "elite") {
          d.hatch(d.round(m.x + 0.1, m.y + 0.05, 1.9, 0.7 * GY, 14), 2, BLOW, 0.9, true, 1.8);
          d.curve(d.round(m.x + 0.1, m.y + 0.05, 1.9, 0.7 * GY, 14).slice(), FORM, 991, true);
        }
      for (const g of L.ground) g(d);
      d.pop();

      // ---- Strokes, under the bodies that made them.
      standSpace(d);
      for (const u of L.under) u(d);
      d.pop();

      // ---- Everything that stands, sorted by its feet.
      const items: Item[] = [];
      for (const m of L.masses)
        items.push({
          y: (m.base[1] as number) + 0.01,
          draw: () => {
            standSpace(d);
            drawMass(d, MASS_CACHE.get(m) ?? scaleMass(m));
            d.pop();
          },
        });
      for (const th of L.things)
        items.push({
          y: th.y,
          draw: () => {
            standSpace(d);
            d.move(th.x, th.y / ST);
            drawThingAt(d, th.kind, th.size, Math.round(th.x * 31 + th.y * 7));
            d.pop();
          },
        });
      for (const f of L.features)
        items.push({
          y: f.y,
          draw: () => {
            standSpace(d);
            d.move(f.x, f.y / ST);
            if (f.kind === "den") drawDen(d, f.build, f.seed);
            else if (f.kind === "scrap") drawScrapHeap(d, f.seed, f.build === 1);
            else if (f.kind === "chest") drawThingAt(d, 12, 1.25, f.seed);
            else if (f.kind === "ore") drawThingAt(d, 9, 1.7, f.seed);
            else if (f.kind === "nest") drawThingAt(d, 13, 2.0, f.seed);
            else drawThingAt(d, 14, 1.0, f.seed);
            d.pop();
          },
        });
      items.push({ y: CITY.y, draw: () => drawCityTop(d, t, tags, heads) });
      for (const c of L.cits) {
        const look = crowd[c.i] as Look;
        items.push({
          y: c.y,
          draw: () => {
            standSpace(d);
            drawCitizen(d, look, citizenPose(c), c.x, c.y / ST, S, detailFor(S * T));
            if (c.pennant) {
              const bx = c.x + 0.45 * c.face;
              const by = c.y / ST - S * 0.95;
              d.line(bx, by + 0.2, bx + 0.08 * c.face, by - 0.5, FORM, 77);
              d.body(
                [
                  bx + 0.08 * c.face,
                  by - 0.5,
                  bx + 0.6 * c.face,
                  by - 0.38,
                  bx + 0.07 * c.face,
                  by - 0.22,
                ],
                { smooth: false, wash: RARITY[3], washAlpha: 1, weight: FORM, seed: 78 },
              );
            }
            d.pop();
          },
        });
      }
      for (const [idx, m] of L.mons.entries()) {
        if (m.air > 0) continue;
        items.push({ y: m.y, draw: () => drawMon(d, m, idx, t) });
      }
      for (const w of L.swarms) {
        const grounded = w.mites.filter((m) => m.air === 0);
        if (grounded.length === 0) continue;
        const my = grounded.reduce((s, m) => s + m.y, 0) / grounded.length;
        items.push({
          y: my,
          draw: () => {
            standSpace(d);
            const mites: Mite[] = grounded.map((m, i) => ({
              x: m.x,
              y: m.y / ST,
              face: m.face,
              phase: t * 3 + i * 0.37 + w.seed,
              stretch: 1 + (i % 3) * 0.05,
              flash: m.flash,
              seed: i + w.seed,
            }));
            mites.sort((a, b) => a.y - b.y);
            drawSwarm(d, mites, mites.length, 0.85);
            d.pop();
          },
        });
      }
      items.sort((a, b) => a.y - b.y);
      for (const item of items) item.draw();

      // ---- Bodies in the air, above their shadows.
      groundSpace(d);
      for (const w of L.swarms)
        for (const m of w.mites)
          if (m.air > 0) d.hatch(d.round(m.x, m.y + 0.03, 0.4, 0.13, 7), 2, INK, 0.6);
      for (const m of L.mons)
        if (m.air > 0) d.hatch(d.round(m.x, m.y + 0.04, 0.9, 0.25, 9), 2, INK, 0.6);
      d.pop();
      for (const [idx, m] of L.mons.entries()) if (m.air > 0) drawMon(d, m, idx, t);
      standSpace(d);
      for (const w of L.swarms) {
        const up = w.mites.filter((m) => m.air > 0);
        if (up.length === 0) continue;
        const mites: Mite[] = up.map((m, i) => ({
          x: m.x,
          y: m.y / ST - m.air,
          face: m.face,
          phase: i * 0.4,
          stretch: 1.15,
          flash: m.flash,
          seed: i + 400,
        }));
        drawSwarm(d, mites, mites.length, 0.85);
      }
      d.pop();

      // ---- Tag anchors and heads for every citizen out.
      for (const c of L.cits) {
        const look = crowd[c.i] as Look;
        const fx = px(c.x);
        const fy = py(c.y);
        const h = S * T * ST;
        tags.push({
          x: fx,
          y: fy - h * HAT_TOP * 0.82 - (c.pennant ? 12 : 0),
          name: look.name,
          rgb: look.cloak,
        });
        heads.push(fx - 0.42 * S * T, fy - h * 1.05, fx + 0.42 * S * T, fy - h * 0.45);
      }

      // ---- What is in the air.
      standSpace(d);
      for (const a of L.air) a(d);
      d.pop();
      for (const f of L.flat) f(d);
      for (const nm of L.nums) numberBoxes.push(...drawNum(d, nm));

      // ---- Den labels: `den`, a letter and a level, over the mound.
      const labels: number[] = [];
      const dens = L.features
        .filter((f) => f.kind === "den")
        .sort((a, b) => a.y - b.y || a.x - b.x);
      dens.forEach((den, i) => {
        const s = `den ${String.fromCharCode(65 + i)} ${den.label}`;
        const sy = [1, 0.78, 1.25][den.build] as number;
        const lx = px(den.x);
        const top = py(den.y) - 2.0 * sy * T * ST - 10;
        const w = measure("roman", 24, s);
        // Over the mound if there is room, else higher, else under its foot.
        const busy = [...numberBoxes, ...labels, ...CORNERS.flat()];
        const clear = (y: number): boolean => {
          if (y - 24 < FRAME.y0 + 50 || y > FRAME.y1 - 50) return false;
          for (let k = 0; k < busy.length; k += 4)
            if (
              lx - w / 2 - 4 < (busy[k + 2] as number) &&
              lx + w / 2 + 4 > (busy[k] as number) &&
              y - 20 < (busy[k + 3] as number) &&
              y + 6 > (busy[k + 1] as number)
            )
              return false;
          return true;
        };
        const ly = [top, top - 26, top + 22, py(den.y) + 30].find(clear) ?? top;
        d.text(s, lx, ly, { size: 24, align: 0.5, halo: 1 });
        labels.push(lx - w / 2 - 4, ly - 20, lx + w / 2 + 4, ly + 6);
      });

      // ---- The black, in at every edge.
      drawBlack(d, band("e", FRAME.y0 - 20, FRAME.y1 + 20, 62, 7), t, 7);
      drawBlack(d, band("n", FRAME.x0 - 20, FRAME.x1 + 20, 58, 17), t, 17);
      drawBlack(d, band("s", FRAME.x0 - 20, FRAME.x1 + 20, 64, 27), t, 27);
      drawBlack(d, band("w", FRAME.y0 - 20, FRAME.y1 + 20, 60, 37), t, 37);

      // ---- Corners, then tags clear of everything.
      const taken = drawCorners(d);
      placeTags(d, tags, [...taken, ...labels, ...numberBoxes, ...heads]);
      drawFrameRule(d);
    },
  };
}

function drawMon(d: Draw, m: Mon, idx: number, t: number): void {
  standSpace(d);
  const p = beastPose({
    face: m.face,
    stride: (idx * 0.37 + t * 0.5) % 1,
    speed: m.act === "run" ? 1 : m.act === "pace" ? 0.4 : m.act === "rest" ? 0 : 0.3,
    coil: m.act === "coil" ? 0.8 : m.act === "stalk" ? 0.45 : 0,
    lunge: m.act === "lunge" ? 0.9 : 0,
    hurt:
      m.act === "hurt" || m.act === "flash"
        ? 0.8
        : m.kind === "elite" && m.act !== "rest"
          ? 0.45
          : 0,
    flash: m.act === "flash",
    stretch:
      m.act === "flash"
        ? 0.86
        : m.act === "hurt"
          ? 0.9
          : m.act === "rest"
            ? 0.9
            : m.air > 0
              ? 1.15
              : 1,
    ink: m.act === "hurt" ? 0.5 : 1,
  });
  if (m.kind === "hound") drawHound(d, m.x, m.y / ST - m.air, 0.92, p, m.build, idx * 11 + 3);
  else {
    const size = m.kind === "elite" ? 2.4 : 1.9;
    // A brute at rest still holds its fist up, so it reads as a body and not a hill.
    if (m.act === "rest" || m.act === "pace") p.coil = 0.5;
    drawBrute(d, m.x, m.y / ST, size, p, idx * 11 + 3);
    if (m.kind === "elite") {
      // The elite's crest: a row of red-brown spikes along its back.
      for (let k = 0; k < 5; k++) {
        const u = -0.62 + k * 0.24;
        const bx = m.x + u * size * m.face;
        const by = m.y / ST - size * (0.95 + p.coil * 0.16 - Math.abs(u + 0.1) * 0.25);
        const tri = [
          bx - 0.09 * size * m.face,
          by + 0.05,
          bx + 0.04 * size * m.face,
          by - 0.34 * size,
          bx + 0.1 * size * m.face,
          by + 0.04,
        ];
        d.fill(tri, BLOW, 1, true);
        d.path(tri, FORM, idx * 11 + 40 + k, true);
      }
    }
  }
  d.pop();
}

/** Masses with their foot points moved into stand space. */
const MASS_CACHE = new Map<Mass, Mass>();
function scaleMass(m: Mass): Mass {
  const scaled: Mass = { ...m, base: m.base.map((v, i) => (i % 2 ? v / ST : v)) };
  MASS_CACHE.set(m, scaled);
  return scaled;
}

function drawGround(d: Draw, L: World): void {
      groundSpace(d);
      for (const p of L.patches) {
        const pts: number[] = [];
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const reach =
            p.r *
            (0.72 + 0.34 * noise1(i * 0.7 + p.seed, p.seed) + 0.14 * noise1(i * 2.3, p.seed + 1));
          pts.push(p.x + Math.cos(a) * reach * 1.45, p.y + Math.sin(a) * reach * 0.8);
        }
        d.wash(pts, p.rgb, p.alpha, true);
      }
      const n = L.river.length / 2;
      for (let i = 0; i + 4 < n; i += 4) {
        const quad: number[] = [];
        for (let j = i; j <= i + 4; j++)
          quad.push(L.left[j * 2] as number, L.left[j * 2 + 1] as number);
        for (let j = i + 4; j >= i; j--)
          quad.push(L.right[j * 2] as number, L.right[j * 2 + 1] as number);
        d.fill(quad, d.ground, 1);
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
        d.curve(L.left.slice(i * 2, to * 2 + 2), CONTOUR, 100 + i);
        d.curve(L.right.slice(i * 2, to * 2 + 2), FORM, 200 + i);
      }
      for (let i = 2; i < n - 2; i += 2) {
        const x = L.river[i * 2] as number;
        const y = L.river[i * 2 + 1] as number;
        const tx = (L.river[i * 2 + 2] as number) - x;
        const ty = (L.river[i * 2 + 3] as number) - y;
        const side = (hash(i, 93) - 0.5) * 0.8;
        d.strength = 0.7;
        d.line(
          x - ty * side - tx * 0.5,
          y + tx * side - ty * 0.5,
          x - ty * side + tx * 0.6,
          y + tx * side + ty * 0.6,
          HAIR,
          i + 300,
        );
        d.strength = 1;
      }
      for (const [fx, fy] of L.fords)
        for (let j = 0; j < 4; j++)
          d.body(
            d.round(fx - 0.75 + j * 0.5, fy + (j % 2) * 0.12, 0.22, 0.15 * GY * 1.1, 7, j + 5),
            { wash: STONE, washAlpha: 0.9, weight: FORM, seed: j + 400 },
          );
      for (const path of L.paths) {
        const pn = path.length / 2;
        for (let i = 0; i + 3 < pn; i += 3) {
          const bandPts: number[] = [];
          for (let j = i; j <= i + 3; j++)
            bandPts.push(path[j * 2] as number, (path[j * 2 + 1] as number) - 0.32);
          for (let j = i + 3; j >= i; j--)
            bandPts.push(path[j * 2] as number, (path[j * 2 + 1] as number) + 0.32);
          d.fill(bandPts, d.ground, 0.62);
        }
        d.strength = 0.75;
        for (let i = 0; i + 2 < pn; i += 3) {
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
        d.strength = 1;
      }
      for (const c of L.clumps) {
        if (c.kind === 0) {
          for (let b = 0; b < 3; b++) {
            const lean = (b - 1) * 0.09 + (hash(c.seed, b) - 0.5) * 0.06;
            d.line(
              c.x + b * 0.07,
              c.y,
              c.x + b * 0.07 + lean,
              c.y - (0.2 + hash(c.seed, b + 4) * 0.14) * ST,
              FORM,
              c.seed + b,
            );
          }
        } else if (c.kind === 1) {
          d.dot(c.x, c.y - 0.08, 2.1, FLOWER);
          d.dot(c.x + 0.22, c.y + 0.05, 1.7, FLOWER);
        } else {
          d.curve(
            [
              c.x - 0.14,
              c.y,
              c.x - 0.08,
              c.y - 0.12 * ST,
              c.x + 0.1,
              c.y - 0.13 * ST,
              c.x + 0.16,
              c.y,
            ],
            FORM,
            c.seed,
          );
        }
      }
      drawSpills(d, L.spills, L.spills.length);
      d.pop();
}

// ---------------------------------------------------------------- the shield siege (#413)
//
// Three mockups of one moment of phase 5, for the art director to pick the
// shield's look from. The horde is piled against the shield round the city at
// about half strength; six citizens hold its edge and nine are aboard. The
// camera is closed in to 32 px a tile on the 80 by 45 landing. Everything in
// the siege is placed by hand on the bigger map's ground.
//   dome  a hatched dome in the lantern's colour; hits crack it, strength is how much outline holds
//   ring  a lit disc on the ground; hits flare, and the disc shrinks as strength falls
//   wall  lamp posts with light strung between; hits knock posts dark

type Take = "dome" | "ring" | "wall";

interface SBody {
  kind: "mite" | "hound" | "brute" | "elite";
  x: number;
  y: number;
  face: number;
  act: MAct;
  /** Lifted off the ground, in stand tiles: climbing the heap, or thrown. */
  air: number;
  build: number;
  /** Part of the horde's black, or drawn in its usual hide. */
  dark: boolean;
}

const LAMP_INK = mix(LAMP, INK, 0.38);
const HORDE_HIDE = 0x3e3530;
const HORDE_DARK = 0x332b26;

/** Where the horde is breaking the shield: the angle round the city, and half the arc. */
const HITS_SPREAD = [
  { a: -1.98, w: 0.24 },
  { a: -0.78, w: 0.2 },
  { a: 0.04, w: 0.32 },
  { a: 2.97, w: 0.3 },
  { a: 2.25, w: 0.2 },
  { a: 0.95, w: 0.16 },
];
// The wall loses posts in runs, so what still burns is strung in long stretches.
const HITS_WALL = [
  { a: -1.98, w: 0.34 },
  { a: 0.04, w: 0.44 },
  { a: 2.97, w: 0.4 },
  { a: 1.0, w: 0.2 },
];
let HITS = HITS_SPREAD;
/** The share of the dome's outline that still holds. */
const DOME_HOLDS = 1 - HITS_SPREAD.reduce((s, h) => s + h.w * 2, 0) / (Math.PI * 2);
const angDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
};
const hitAt = (a: number, pad = 0): { a: number; w: number } | undefined =>
  HITS.find((h) => angDist(a, h.a) < h.w + pad);

export function siegeScene(take: Take): Scene {
  const cfg = CONFIGS.big as Config;
  T = cfg.T;
  S = cfg.S;
  MAP_W = cfg.W;
  MAP_H = cfg.H;
  CS = 1;
  CITY = { x: cfg.W / 2, y: cfg.H / 2 + 0.8 };
  VX = 0;
  VY = 0;
  const L = build(cfg);

  // Closed in on the shield: 32 px a tile, the shield with five tiles over and under it.
  T = 32;
  S = 59 / (T * ST);
  const C = { x: CITY.x + 0.3, y: CITY.y + 0.4 };
  const FULL = { rx: 15, ry: 11 };
  const R = take === "ring" ? { rx: 12.7, ry: 9.3 } : FULL;
  HITS = take === "wall" ? HITS_WALL : HITS_SPREAD;
  VX = C.x - (FRAME.x1 - FRAME.x0) / T / 2;
  VY = C.y - (FRAME.y1 - FRAME.y0) / T / 2;

  ABOARD = [
    [5, -0.2, 1.4, 1, "hammer"],
    [9, -2.2, -1.1, -1, "hammer"],
    [10, 6.3, -0.9, 1, "gun"],
    [11, -6.3, 0.9, -1, "gun"],
    [12, -1.4, -2.45, -1, "shoot"],
    [13, 5.3, 2.0, 1, "shoot"],
    [6, -4.9, 2.4, -1, "draw"],
    [7, 4.9, 0.5, 1, "stand"],
    [14, 2.9, -1.5, 1, "walk"],
  ];

  const E = (a: number, dd: number, r = R): [number, number] => [
    C.x + Math.cos(a) * (r.rx + dd),
    C.y + Math.sin(a) * (r.ry + dd),
  ];
  const depthOf = (x: number, y: number): number => {
    const nx = (x - C.x) / R.rx;
    const ny = (y - C.y) / R.ry;
    const r = Math.hypot(nx, ny) || 1e-6;
    const a = Math.atan2(ny, nx);
    return (r - 1) * Math.hypot(R.rx * Math.cos(a), R.ry * Math.sin(a));
  };
  const onScreen = (x: number, y: number, m = 2): boolean =>
    x > VX - m && x < VX + (FRAME.x1 - FRAME.x0) / T + m && y > VY - m && y < VY + 32.5 + m + 3;

  // ---- The horde.
  const rand = rng(4131);
  const bodies: SBody[] = [];
  const heapOf = (a: number): number =>
    2.5 * Math.max(Math.max(0, -Math.sin(a)) ** 1.6, Math.abs(Math.cos(a)) ** 5);
  const near = (a: number): boolean => Math.sin(a) > 0.42;
  const add = (b: SBody): void => {
    if (onScreen(b.x, b.y)) bodies.push(b);
  };
  const faceOf = (x: number): number => (x < C.x ? 1 : -1);
  // Whole bodies to three tiles out, pressed on the shield in four loose rows.
  for (let row = 0; row < 4; row++) {
    let a = -Math.PI + rand() * 0.3;
    while (a < Math.PI) {
      const dd0 = 0.28 + row * 0.7 + (rand() - 0.5) * 0.35;
      const hit = hitAt(a);
      const r = rand();
      let kind: SBody["kind"] = "mite";
      if (near(a)) kind = r < 0.27 ? "hound" : "mite";
      else if (row > 1 && r < 0.06) kind = "brute";
      else if (r < 0.42) kind = "hound";
      const dd = (row === 0 && hit ? 0.12 + rand() * 0.15 : dd0) + (take === "wall" ? 0.4 : 0);
      const [x, y] = E(a, dd);
      const heap = heapOf(a);
      const air =
        row === 0 ? (heap > 1 ? rand() * 0.4 : 0) : heap * (0.15 + rand() * 0.55) * (1 - row * 0.2);
      const act: MAct =
        row === 0
          ? hit
            ? rand() < 0.25
              ? "flash"
              : "lunge"
            : rand() < 0.5
              ? "lunge"
              : "coil"
          : rand() < 0.35
            ? "run"
            : rand() < 0.6
              ? "coil"
              : "stalk";
      add({
        kind,
        x,
        y,
        face: faceOf(x),
        act: kind === "brute" && act === "lunge" ? "coil" : act,
        air: kind === "brute" ? 0 : air,
        build: Math.floor(rand() * 3),
        dark: true,
      });
      const step = kind === "mite" ? 0.95 : kind === "hound" ? 1.7 : 2.6;
      const radius = Math.hypot((R.rx + dd) * Math.sin(a), (R.ry + dd) * Math.cos(a));
      a += (step + rand() * 0.35) / radius;
    }
  }
  // The heap climbs on the far side and at the ends, and leans in over the shield.
  for (let k = 0; k < 420; k++) {
    const a = -Math.PI + rand() * Math.PI * 2;
    const heap = heapOf(a);
    if (heap < 0.9 || rand() > heap / 2.5) continue;
    const dd = -0.45 + rand() * 1.8;
    const [x, y] = E(a, dd);
    add({
      kind: rand() < 0.7 ? "mite" : "hound",
      x,
      y,
      face: faceOf(x),
      act: rand() < 0.5 ? "lunge" : "coil",
      air: heap * (0.5 + rand() * 0.6) * (dd < 0.4 ? 1.05 : 0.75),
      build: Math.floor(rand() * 3),
      dark: true,
    });
  }
  // Brutes, and two elites, standing up out of the mass.
  let elites = 0;
  let brutes = 0;
  for (let k = 0; k < 60 && brutes < 6; k++) {
    const a = -Math.PI + rand() * Math.PI * 2;
    if (near(a)) continue;
    const dd = 3.6 + rand() * 3.0;
    const [x, y] = E(a, dd);
    if (bodies.some((b) => b.kind !== "mite" && b.kind !== "hound" && Math.hypot(b.x - x, b.y - y) < 4.5))
      continue;
    const elite = elites < 2 && rand() < 0.5 && Math.sin(a) < -0.6;
    if (elite) elites++;
    else brutes++;
    add({
      kind: elite ? "elite" : "brute",
      x,
      y,
      face: faceOf(x),
      act: rand() < 0.5 ? "pace" : "coil",
      air: 0,
      build: 0,
      dark: true,
    });
  }

  // ---- The six at the edge, the fights round them, and the shots from the rail.
  const out: Cit[] = [];
  const at = (a: number, dd: number): [number, number] => E(a, dd);
  const cit = (i: number, a: number, dd: number, act: Act, face: number): Cit => {
    const [x, y] = at(a, dd);
    const c: Cit = { i, x, y, act, face };
    out.push(c);
    return c;
  };
  const eastBlade = cit(0, -0.14, -1.25, "hit", 1);
  const maul = cit(8, 0.27, -1.35, "slam", 1);
  const spear = cit(1, -1.7, -1.3, "thrust", -1);
  const bow = cit(2, 2.02, -1.25, "shoot", -1);
  const pot = cit(3, 2.42, -1.15, "pot", -1);
  const westBlade = cit(4, 3.1, -1.2, "swing", -1);

  // Clear the bodies off where a citizen's blow has just landed, and set the ones it hit.
  const struck = (x: number, y: number, r: number, act: MAct): void => {
    for (const b of bodies) if (Math.hypot(b.x - x, b.y - y) < r && b.air === 0) b.act = act;
  };
  // The maul throws bodies back into the heap as a fan.
  for (let k = 0; k < 7; k++) {
    const a = 0.12 + k * 0.055;
    const [x, y] = E(a, 1.0 + (k % 3) * 0.8);
    bodies.push({
      kind: k === 3 ? "hound" : "mite",
      x,
      y,
      face: k % 2 ? 1 : -1,
      act: k % 3 === 1 ? "flash" : "hurt",
      air: 0.9 + (k % 3) * 0.55 + hash(k, 5) * 0.3,
      build: 1,
      dark: false,
    });
  }
  const [mx0, my0] = E(0.27, 0.15);
  struck(mx0, my0, 1.2, "hurt");
  const [ebx, eby] = E(-0.14, 0.3);
  struck(ebx, eby, 1.1, "flash");
  const [wbx, wby] = E(3.1, 0.3);
  struck(wbx, wby, 1.2, "flash");
  // The spear's elite, dying in the press on the far side, and the rare that drops from it.
  const [elx, ely] = E(-1.98, 0.9);
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i] as SBody;
    if (Math.hypot(b.x - elx, b.y - ely) < 1.6) bodies.splice(i, 1);
  }
  bodies.push({ kind: "elite", x: elx, y: ely, face: 1, act: "hurt", air: 0, build: 0, dark: false });
  const [dropX, dropY] = E(-1.72, 2.3);
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i] as SBody;
    if (Math.hypot(b.x - dropX, b.y - dropY) < 1.1) bodies.splice(i, 1);
  }
  const [burnX, burnY] = E(2.5, 1.7);

  const swings: ((d: Draw) => void)[] = [];
  const swingOf = (c: Cit, angle: number, sweep: number, radius: number, age = 0.03): void => {
    const look = crowd[c.i] as Look;
    swings.push((d) =>
      drawSwing(d, c.x, c.y / ST - 0.55, radius, angle, sweep, age, look.cloak, c.i * 17),
    );
  };
  swingOf(eastBlade, 0.05, 2.3, 2.6);
  swingOf(maul, 0.15, 2.0, 2.9, 0.06);
  swingOf(westBlade, Math.PI - 0.05, 2.3, 2.6);

  const nums: Num[] = [];
  const num = (x: number, y: number, value: number, size: number, crit = false): void => {
    nums.push({ x, y, value, size, crit });
  };
  num(elx - 3.9, ely - 1.0, 2140, 72, true);
  num(maul.x + 3.6, maul.y - 0.8, 318, 36);
  num(eastBlade.x + 3.4, eastBlade.y - 0.6, 186, 30);
  num(westBlade.x - 3.0, westBlade.y - 2.6, 207, 36);
  num(bow.x - 2.2, bow.y + 2.9, 94, 36);
  num(burnX + 0.4, burnY - 2.6, 41, 30);
  const BOLTS = [
    [1, -0.32, 1],
    [-1, Math.PI + 0.3, 2],
  ] as const;
  for (const [side, a] of BOLTS) {
    const [tx0, ty0] = E(a, 4.2);
    num(tx0 + side * 1.4, ty0 - 1.9, 260, 36);
  }

  // ---- The shield's posts, for the wall.
  const POSTS = 28;
  const posts = Array.from({ length: POSTS }, (_, k) => {
    const a = -Math.PI / 2 + (k / POSTS) * Math.PI * 2;
    const [x, y] = E(a, 0);
    const lit = !hitAt(a, 0.04);
    return { a, x, y, lit, lean: lit ? 0 : (hash(k, 3) - 0.5) * 0.9, snapped: !lit && hash(k, 4) < 0.4 };
  });
  const litPosts = posts.filter((p) => p.lit).length;

  (globalThis as unknown as { siegeCount?: Record<string, unknown> }).siegeCount = {
    take,
    bodies: bodies.length,
    out: out.length,
    aboard: ABOARD.length,
    litPosts,
  };

  return {
    duration: 1,
    draw(d: Draw, t: number): void {
      const tags: Tag[] = [];
      const heads: number[] = [];

      drawGround(d, L);

      // ---- Lamplight in three flat steps inside the shield.
      groundSpace(d);
      for (const [k, alpha] of [
        [1, 0.07],
        [0.74, 0.06],
        [0.48, 0.06],
      ] as const) {
        const pts: number[] = [];
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          pts.push(C.x + Math.cos(a) * R.rx * k, C.y + Math.sin(a) * R.ry * k);
        }
        d.fill(pts, LAMP, alpha);
      }
      if (take === "ring") {
        const disc: number[] = [];
        const edge: number[] = [];
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          disc.push(...E(a, 0));
        }
        d.wash(disc, LAMP, 0.26, true);
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const [ox, oy] = E(a, 0);
          const [ix, iy] = E(a, -0.55);
          edge.push(ox, oy, ix, iy);
        }
        // The lit band at the rim.
        const rim: number[] = [];
        for (let i = 0; i <= 72; i++) rim.push(edge[i * 4] as number, edge[i * 4 + 1] as number);
        for (let i = 72; i >= 0; i--) rim.push(edge[i * 4 + 2] as number, edge[i * 4 + 3] as number);
        d.fill(rim, LAMP, 0.42);
      }
      d.pop();

      // ---- The black: everything the horde has taken, from just behind its front to the rule.
      {
        const rib: number[] = [];
        const n = 220;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const dd = 1.35 + 0.45 * noise1(a * 3.1, 5) + 0.25 * noise1(a * 11, 6);
          const [ix, iy] = E(a, dd);
          const [ox, oy] = E(a, 60);
          rib.push(px(ix), py(iy), px(ox), py(oy));
        }
        d.surface.strip(rib, n + 1, INK, 1);
        // Trodden ground between the shield and the black.
        const tread: number[] = [];
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const [ix, iy] = E(a, 0.15);
          const [ox, oy] = E(a, 1.6);
          tread.push(px(ix), py(iy), px(ox), py(oy));
        }
        d.surface.strip(tread, n + 1, 0x5a4a40, 0.35);
      }

      // ---- The drowned map: what the black has taken, in paper line.
      d.ink = PAPER;
      groundSpace(d);
      d.strength = 0.32;
      const nRiver = L.river.length / 2;
      for (let i = 0; i + 1 < nRiver; i += 3) {
        const x = L.left[i * 2] as number;
        const y = L.left[i * 2 + 1] as number;
        if (depthOf(x, y) < 2.4 || !onScreen(x, y)) continue;
        const to = Math.min(nRiver - 1, i + 3);
        d.curve(L.left.slice(i * 2, to * 2 + 2), FORM, 100 + i);
        d.curve(L.right.slice(i * 2, to * 2 + 2), FORM, 200 + i);
      }
      for (const path of L.paths) {
        const pn = path.length / 2;
        for (let i = 0; i + 2 < pn; i += 2) {
          const x = path[i * 2] as number;
          const y = path[i * 2 + 1] as number;
          if (depthOf(x, y) < 2.4 || !onScreen(x, y)) continue;
          if (i % 4 === 0)
            d.line(x, y, path[i * 2 + 2] as number, path[i * 2 + 3] as number, HAIR, 700 + i);
        }
      }
      for (const m of L.masses) {
        const b = m.base;
        const x = b[0] as number;
        const y = b[1] as number;
        if (depthOf(x, y) < 2.6 || !onScreen(x, y, 6)) continue;
        d.curve(b, FORM, 800, true);
      }
      for (const th of L.things) {
        if (depthOf(th.x, th.y) < 2.6 || !onScreen(th.x, th.y)) continue;
        d.curve(d.round(th.x, th.y - th.size * 0.9, th.size * 0.4, th.size * 0.45, 8, 3).slice(), HAIR, 810, true);
        d.line(th.x, th.y, th.x, th.y - th.size * 0.5, HAIR, 811);
      }
      for (const f of L.features) {
        if (depthOf(f.x, f.y) < 2.6 || !onScreen(f.x, f.y, 3)) continue;
        if (f.kind === "den") {
          d.curve(d.round(f.x, f.y - 0.5, 2.1, 1.0, 10, 5).slice(), FORM, 820, true);
          d.curve([f.x - 0.7, f.y, f.x - 0.5, f.y - 0.8, f.x + 0.5, f.y - 0.8, f.x + 0.7, f.y], FORM, 821);
        } else d.curve(d.round(f.x, f.y - 0.3, 0.9, 0.5, 8, 6).slice(), HAIR, 822, true);
      }
      d.strength = 1;
      d.pop();

      // ---- The mass from three to eight tiles: heads and backs in paper line, eyes in clusters.
      standSpace(d);
      {
        const mr = rng(77);
        for (let k = 0; k < 2600; k++) {
          const a = mr() * Math.PI * 2;
          const dd = 2.4 + mr() ** 0.8 * 12;
          const [x, y] = E(a, dd);
          if (!onScreen(x, y, 1)) continue;
          const yy = y / ST;
          const deep = Math.min(1, (dd - 2.4) / 6);
          if (dd < 8.5 || mr() < 0.25) {
            const f = x < C.x ? 1 : -1;
            const s = 0.75 + mr() * 0.6;
            d.ink = PAPER;
            d.strength = 0.75 - deep * 0.45;
            d.curve(
              [x - 0.5 * s * f, yy + 0.05, x - 0.2 * s * f, yy - 0.3 * s, x + 0.25 * s * f, yy - 0.28 * s, x + 0.5 * s * f, yy - 0.05],
              dd < 5 ? FORM : HAIR,
              k,
            );
            d.strength = 1;
            d.ink = INK;
          }
          if (mr() < (dd < 8.5 ? 0.5 : 0.35)) {
            const f = x < C.x ? 1 : -1;
            const ea = 0.9 - deep * 0.4;
            d.dot(x + 0.42 * f, yy - 0.12, 1.7, PAPER, ea);
            d.dot(x + 0.56 * f, yy - 0.1, 1.5, PAPER, ea);
            if (mr() < 0.3) d.dot(x + 0.3 * f, yy - 0.18, 1.3, PAPER, ea * 0.8);
          }
        }
      }
      d.pop();

      // ---- The dome's outline and its cracks, behind what stands.
      const domeH = 6;
      const Ry = Math.hypot(R.ry, domeH * ST);
      const dome = (a: number, inset: number): [number, number] => [
        C.x + Math.cos(a) * (R.rx - inset),
        C.y + Math.sin(a) * ((Math.sin(a) < 0 ? Ry : R.ry) - inset),
      ];
      // The band's inner edge: the foot itself on the far side, where the dome is seen edge-on
      // and the band is its whole far wall; a narrow band elsewhere.
      const domeIn = (a: number): [number, number] => [
        C.x + Math.cos(a) * (R.rx - 0.75),
        C.y + Math.sin(a) * (Math.sin(a) < 0 ? R.ry - 0.25 - 0.5 * (1 + Math.sin(a)) : R.ry - 0.75),
      ];
      const drawDome = (): void => {
        groundSpace(d);
        d.ink = LAMP_INK;
        const n = 160;
        for (let i = 0; i < n; i++) {
          const a0 = -Math.PI + (i / n) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2) / n;
          const am = (a0 + a1) / 2;
          if (hitAt(am)) continue;
          const [o0x, o0y] = dome(a0, 0);
          const [o1x, o1y] = dome(a1, 0);
          const [i1x, i1y] = domeIn(a1);
          const [i0x, i0y] = domeIn(a0);
          const band = [o0x, o0y, o1x, o1y, i1x, i1y, i0x, i0y];
          const far = Math.sin(am) < -0.3;
          d.fill(band, LAMP, far ? 0.38 : 0.6);
          d.hatch(band, far ? 1 : 2, LAMP_INK, 0.9, false, FORM);
        }
        // The outline, in runs between the breaks.
        let run: number[] = [];
        let inner: number[] = [];
        const flush = (seed: number): void => {
          if (run.length >= 4) {
            d.ink = LAMP;
            d.curve(run, 9, seed + 2);
            d.ink = LAMP_INK;
            d.curve(run, CONTOUR, seed);
            d.curve(inner, FORM, seed + 1);
          }
          run = [];
          inner = [];
        };
        for (let i = 0; i <= n; i++) {
          const a = -Math.PI + (i / n) * Math.PI * 2;
          if (hitAt(a)) {
            flush(1300 + i);
            continue;
          }
          run.push(...dome(a, 0));
          inner.push(...domeIn(a));
        }
        flush(1500);
        // Cracks: from each break, jagged lines running up the dome toward the lantern.
        for (const [hi, h] of HITS.entries()) {
          const crr = rng(900 + hi);
          for (let c = 0; c < 5; c++) {
            // Each crack starts at a broken end of the outline or inside the break.
            const a = h.a + (c < 2 ? (c === 0 ? -h.w : h.w) : (crr() - 0.5) * h.w * 1.4);
            let [x, y] = dome(a, 0.3);
            const pts = [x, y];
            const forks: number[][] = [];
            const tx = C.x + 0.2;
            const ty = C.y - domeH * ST * 0.9;
            const len = 2.2 + crr() * 2.8;
            for (let s = 0; s < 5; s++) {
              const dx = tx - x;
              const dy = ty - y;
              const dl = Math.hypot(dx, dy) || 1;
              const stepL = len / 5;
              x += (dx / dl) * stepL + (crr() - 0.5) * 0.9;
              y += (dy / dl) * stepL + (crr() - 0.5) * 0.9;
              pts.push(x, y);
              if (crr() < 0.4) forks.push([x, y, x + (crr() - 0.5) * 1.8, y + (crr() - 0.5) * 1.8]);
            }
            d.ink = LAMP;
            d.path(pts, 6, 1850 + hi * 10 + c);
            d.ink = LAMP_INK;
            d.path(pts, c < 2 ? CONTOUR : FORM, 1800 + hi * 10 + c);
            for (const [k, f] of forks.entries())
              d.line(f[0] as number, f[1] as number, f[2] as number, f[3] as number, FORM, 1700 + c * 7 + k);
          }
        }
        d.ink = INK;
        d.pop();
      };

      // ---- Everything that stands, sorted by its feet.
      const items: Item[] = [];
      items.push({ y: CITY.y, draw: () => drawCityTop(d, t, tags, heads) });
      for (const th of L.things) {
        if (depthOf(th.x, th.y) > -0.5 || !onScreen(th.x, th.y)) continue;
        items.push({
          y: th.y,
          draw: () => {
            standSpace(d);
            d.move(th.x, th.y / ST);
            drawThingAt(d, th.kind, th.size, Math.round(th.x * 31 + th.y * 7));
            d.pop();
          },
        });
      }
      for (const c of out) {
        const look = crowd[c.i] as Look;
        items.push({
          y: c.y,
          draw: () => {
            groundSpace(d);
            castShadowAt(d, c.x, c.y);
            d.pop();
            standSpace(d);
            drawCitizen(d, look, citizenPose(c), c.x, c.y / ST, S, detailFor(S * T));
            d.pop();
          },
        });
      }
      const late: Item[] = [];
      for (const [idx, b] of bodies.entries()) {
        const a = Math.atan2((b.y - C.y) / R.ry, (b.x - C.x) / R.rx);
        const climber = b.air > 0.9 && (Math.sin(a) < -0.2 || Math.abs(Math.cos(a)) > 0.8);
        (take === "dome" && climber ? late : items).push({
          y: b.y + b.air * 0.6,
          draw: () => drawSBody(d, b, idx, t, C.x),
        });
      }
      if (take === "wall") {
        const HP = 2.3;
        const top = (p: (typeof posts)[number]): [number, number] => [
          p.x + Math.sin(p.lean) * HP * (p.snapped ? 0.45 : 1),
          p.y / ST - Math.cos(p.lean) * HP * (p.snapped ? 0.45 : 1),
        ];
        posts.forEach((p, k) => {
          const q = posts[(k + 1) % POSTS] as (typeof posts)[number];
          const list = Math.sin(p.a) < 0.3 && Math.sin(q.a) < 0.3 ? late : items;
          if (p.lit && q.lit)
            list.push({
              y: (p.y + q.y) / 2,
              draw: () => {
                standSpace(d);
                const [ax, ay] = top(p);
                const [bx, by] = top(q);
                const sheet = [p.x, p.y / ST, q.x, q.y / ST, bx, by + 0.12, ax, ay + 0.12];
                d.fill(sheet, LAMP, 0.42);
                d.ink = LAMP_INK;
                for (const u of [0.33, 0.66])
                  d.line(
                    lerp(p.x, ax, u),
                    lerp(p.y / ST, ay, u),
                    lerp(q.x, bx, u),
                    lerp(q.y / ST, by, u),
                    HAIR,
                    2000 + k,
                    0.7,
                  );
                d.ink = LAMP;
                d.line(ax, ay + 0.08, bx, by + 0.08, 8, 2150 + k);
                d.ink = LAMP_INK;
                d.line(ax, ay + 0.08, bx, by + 0.08, FORM, 2100 + k);
                d.line(p.x, p.y / ST, q.x, q.y / ST, FORM, 2120 + k);
                d.ink = INK;
                d.pop();
              },
            });
          list.push({
            y: p.y + 0.01,
            draw: () => {
              standSpace(d);
              const [tx, ty] = top(p);
              d.hatch(d.round(p.x, p.y / ST + 0.03, 0.35, 0.1, 7), 2, INK, 0.6);
              d.body([p.x - 0.11, p.y / ST, tx - 0.08, ty, tx + 0.08, ty, p.x + 0.11, p.y / ST], {
                smooth: false,
                wash: IRON,
                washAlpha: 0.95,
                weight: CONTOUR,
                seed: 2200 + k,
              });
              d.body(d.box(p.x - 0.2, p.y / ST - 0.12, p.x + 0.2, p.y / ST + 0.02), {
                smooth: false,
                wash: IRON,
                washAlpha: 0.95,
                weight: FORM,
                seed: 2250 + k,
              });
              if (p.snapped) {
                // The rest of it, knocked down beside its stump.
                const s = Math.sign(p.lean) || 1;
                d.body(
                  [tx, ty + 0.14, tx + s * 1.2, ty + 0.7, tx + s * 1.26, ty + 0.56, tx + 0.06, ty],
                  { smooth: false, wash: IRON, washAlpha: 0.95, weight: FORM, seed: 2300 + k },
                );
                d.body(d.round(tx + s * 1.32, ty + 0.66, 0.2, 0.15, 8), {
                  spot: true,
                  weight: FORM,
                  seed: 2350 + k,
                });
              } else if (p.lit) {
                d.dot(tx, ty, 20, LAMP, 0.4);
                d.body(d.round(tx, ty, 0.27, 0.22, 9), {
                  wash: LAMP,
                  washAlpha: 1,
                  weight: CONTOUR,
                  seed: 2400 + k,
                });
                d.dot(tx, ty, 3.5, PAPER);
              } else {
                d.body(d.round(tx, ty, 0.25, 0.2, 9), { spot: true, weight: CONTOUR, seed: 2500 + k });
              }
              d.pop();
            },
          });
        });
      }
      items.sort((a, b) => a.y - b.y);
      for (const item of items) item.draw();
      if (take === "dome") drawDome();
      late.sort((a, b) => a.y - b.y);
      for (const item of late) item.draw();

      // ---- The firepot's burn on the heap.
      groundSpace(d);
      d.wash(d.round(burnX, burnY - 0.5, 1.7, 1.0, 12, 31), 0xe79a3c, 0.5, true);
      d.wash(d.round(burnX + 0.2, burnY - 0.7, 0.9, 0.55, 10, 32), 0xf2c25a, 0.55, true);
      d.pop();
      standSpace(d);
      d.ink = BLOW;
      for (let k = 0; k < 5; k++) {
        const fx = burnX - 1.0 + k * 0.5 + (hash(k, 40) - 0.5) * 0.2;
        const fy = (burnY - 0.3 - (k % 2) * 0.4) / ST;
        const hgt = 0.45 + hash(k, 41) * 0.45;
        const lick = [fx - 0.13, fy, fx - 0.1, fy - hgt * 0.5, fx + 0.06, fy - hgt, fx + 0.04, fy - hgt * 0.45, fx + 0.14, fy];
        d.fill(lick, 0xf0a640, 0.9, true);
        d.curve(lick, FORM, 3000 + k, true);
      }
      d.ink = INK;
      d.pop();

      // ---- Strokes over the press.
      standSpace(d);
      for (const s of swings) s(d);
      // The spear's thrust: one long stroke through the shield into the elite.
      {
        const look = crowd[spear.i] as Look;
        const sx = spear.x - 1.3;
        const sy = spear.y / ST - 0.8;
        const ex = elx + 0.9;
        const ey = ely / ST - 1.2;
        const dx = ex - sx;
        const dy = ey - sy;
        const l = Math.hypot(dx, dy);
        const nx = -dy / l;
        const ny = dx / l;
        d.body([sx, sy, ex + nx * 0.22, ey + ny * 0.22, ex + dx * 0.08 / l, ey + dy * 0.08 / l, ex - nx * 0.22, ey - ny * 0.22], {
          smooth: false,
          wash: look.cloak,
          washAlpha: 1,
          weight: FORM,
          seed: 3100,
        });
      }
      d.pop();
      groundSpace(d);
      drawImpactRaw(d, elx + 0.5, ely - 1.6, 1.5, 3);
      drawImpactRaw(d, ebx + 0.6, eby - 0.9, 1.0, 4);
      drawImpactRaw(d, wbx - 0.6, wby - 0.9, 1.0, 5);
      d.pop();
      standSpace(d);
      // The pot in the air, the bow's arrows, the rail's arrows.
      drawPot(d, pot.x - 1.5, (pot.y - 0.4) / ST, -0.9, -0.35, 1.9, 0, 7);
      drawArrow(d, bow.x - 2.3, bow.y / ST - 0.2, -0.95, 0.3, 1.1, 8);
      drawArrow(d, bow.x - 3.8, bow.y / ST + 0.25, -0.95, 0.3, 0.9, 9);
      const rail = (ax: number, ay: number, a: number, dd: number, h: number, seed: number): void => {
        const [tx, ty] = E(a, dd);
        const fx = lerp(CITY.x + ax, tx, 0.62);
        const fy = lerp(CITY.y + ay * GY, ty, 0.62);
        const dx = tx - (CITY.x + ax);
        const dy = ty - (CITY.y + ay * GY);
        const l = Math.hypot(dx, dy);
        const ux = dx / l;
        const uy = dy / l;
        // Its shadow on the ground, then the arrow high over it with its streak behind.
        d.line(fx - ux * 0.4, fy / ST + 0.05, fx + ux * 0.4, fy / ST + 0.05 + uy * 0.3, HAIR, seed, 0.5);
        const hy = fy / ST - h;
        const tail = [fx - ux * 3.0, hy - (uy * 3.0) / ST];
        d.fill(
          [tail[0] as number, tail[1] as number, fx - ux * 0.5 - uy * 0.09, hy - (uy * 0.5) / ST + ux * 0.09, fx - ux * 0.5 + uy * 0.09, hy - (uy * 0.5) / ST - ux * 0.09],
          INK,
          0.35,
        );
        d.line(fx - ux * 0.5, hy - (uy * 0.5) / ST, fx + ux * 0.5, hy + (uy * 0.5) / ST, CONTOUR, seed + 1);
        d.fill(
          [fx + ux * 0.75, hy + (uy * 0.75) / ST, fx + ux * 0.4 - uy * 0.14, hy + (uy * 0.4) / ST + ux * 0.14, fx + ux * 0.4 + uy * 0.14, hy + (uy * 0.4) / ST - ux * 0.14],
          INK,
        );
      };
      rail(-1.4, -2.45, -2.25, 3.5, 2.4, 10);
      rail(-1.4, -2.45, -2.1, 4.5, 2.0, 11);
      rail(5.3, 2.0, 0.75, 3.0, 2.2, 12);
      rail(-4.9, 2.4, 2.65, 3.6, 2.1, 13);
      // The rare, two tiles out in the heap.
      drawDrop(d, dropX, dropY / ST, dropX, dropY / ST, 2, 2, 1, 63, 0.5);
      d.pop();
      // The gun posts' bolts, over the shield into the press.
      for (const [side, a, seed] of BOLTS) {
        const mx = px(CITY.x + side * 8.0);
        const my = py(CITY.y) - 1.9 * T * ST;
        const [tx0, ty0] = E(a, 4.2);
        const tx = px(tx0);
        const ty = py(ty0) - 0.9 * T * ST;
        const u = 0.7;
        const bx = lerp(mx, tx, u);
        const by = lerp(my, ty, u) - Math.sin(u * Math.PI) * 30;
        const ux = (tx - mx) / Math.hypot(tx - mx, ty - my);
        const uy = (ty - my) / Math.hypot(tx - mx, ty - my);
        // The streak behind it: a tapered wedge of paper, then the shaft in brass, inked.
        const sx0 = bx - ux * 160;
        const sy0 = by - uy * 160;
        d.fill([sx0, sy0, bx - ux * 40 - uy * 6, by - uy * 40 + ux * 6, bx - ux * 40 + uy * 6, by - uy * 40 - ux * 6], PAPER, 0.85);
        d.line(sx0, sy0, bx - ux * 40, by - uy * 40, HAIR, 3210 + seed, 0.8);
        d.line(bx - ux * 44, by - uy * 44, bx, by, 9, 3220 + seed);
        d.ink = BRASS;
        d.line(bx - ux * 42, by - uy * 42, bx - ux * 2, by - uy * 2, 4.5, 3230 + seed);
        d.ink = INK;
        const head = [bx + ux * 14, by + uy * 14, bx - uy * 7, by + ux * 7, bx + uy * 7, by - ux * 7];
        d.fill(head, PAPER, 1);
        d.path(head, FORM, 3240 + seed, true);
        groundSpace(d);
        drawImpactRaw(d, tx0, ty0 - 0.9, 1.1, 6 + seed);
        d.pop();
      }

      // ---- Where the horde strikes the shield.
      if (take === "dome") {
        groundSpace(d);
        d.ink = LAMP_INK;
        for (const [hi, h] of HITS.entries()) {
          const sr = rng(600 + hi);
          // What is left of the outline across the break: loose pieces, knocked out of line.
          for (let s = 0; s < 7; s++) {
            const a0 = h.a - h.w + (s / 7) * h.w * 2 + sr() * 0.03;
            const a1 = a0 + h.w * 0.12;
            const off = (sr() - 0.5) * 0.6;
            const [x0, y0] = dome(a0, off);
            const [x1, y1] = dome(a1, off + (sr() - 0.5) * 0.4);
            if (sr() < 0.75) d.line(x0, y0, x1, y1, CONTOUR, 3300 + hi * 10 + s);
          }
          // Shards, thrown off.
          for (let s = 0; s < 3; s++) {
            const [x, y] = dome(h.a + (sr() - 0.5) * h.w * 1.4, -0.4 - sr() * 1.0);
            const r = 0.3 + sr() * 0.2;
            const ang = sr() * Math.PI;
            const ux = Math.cos(ang) * r;
            const uy = Math.sin(ang) * r;
            const sliver = [x - ux, y - uy, x - uy * 0.25, y + ux * 0.25, x + ux, y + uy];
            d.fill(sliver, LAMP, 0.95);
            d.path(sliver, HAIR, 3400 + s, true);
          }
        }
        d.ink = INK;
        d.pop();
      } else if (take === "ring") {
        groundSpace(d);
        // Where the shield stood at full strength: a dotted line over the press.
        for (let i = 0; i < 150; i++) {
          const a = (i / 150) * Math.PI * 2;
          const [x, y] = E(a, 0, FULL);
          if (!onScreen(x, y, 0)) continue;
          d.dot(x, y, 2.4, LAMP, 0.85);
        }
        // The rim, bright, then flares where blows land on it.
        d.ink = LAMP_INK;
        const rimPts: number[] = [];
        for (let i = 0; i < 90; i++) rimPts.push(...E((i / 90) * Math.PI * 2, 0));
        d.curve(rimPts, HEAVY, 3500, true);
        d.ink = PAPER;
        const innerPts: number[] = [];
        for (let i = 0; i < 90; i++) innerPts.push(...E((i / 90) * Math.PI * 2, -0.22));
        d.curve(innerPts, FORM, 3501, true, 0.9);
        d.pop();
        standSpace(d);
        for (const [hi, h] of HITS.entries()) {
          const fr = rng(700 + hi);
          for (const da of [-0.45, 0, 0.5]) {
            const a = h.a + da * h.w;
            const [x, y] = E(a, 0);
            const yy = y / ST - 0.55;
            const big = da === 0 ? 1.5 : 0.9;
            d.dot(x, yy, 18 * big, LAMP, 0.45);
            for (let r = 0; r < 11; r++) {
              const ra = (r / 11) * Math.PI * 2 + fr();
              const l0 = 0.25 * big;
              const l1 = (0.7 + fr() * 0.7) * big;
              d.ink = LAMP_INK;
              d.line(x + Math.cos(ra) * l0, yy + Math.sin(ra) * l0 * 0.8, x + Math.cos(ra) * l1, yy + Math.sin(ra) * l1 * 0.8, CONTOUR, 3600 + hi * 30 + r);
            }
            d.ink = INK;
            d.body(d.round(x, yy, 0.3 * big, 0.24 * big, 9, 3700 + hi), { wash: LAMP, washAlpha: 1, weight: FORM, seed: 3700 + hi });
            d.dot(x, yy, 3.5 * big, PAPER);
          }
        }
        d.pop();
      } else {
        // Sparks off the posts the horde is knocking down, and off the light where it is hit.
        standSpace(d);
        posts.forEach((p, k) => {
          if (p.lit) return;
          const sr = rng(800 + k);
          d.ink = LAMP_INK;
          for (let s = 0; s < 7; s++) {
            const ra = sr() * Math.PI * 2;
            const r0 = 0.3;
            const r1 = 0.6 + sr() * 0.6;
            const yy = p.y / ST - 1.1;
            d.line(p.x + Math.cos(ra) * r0, yy + Math.sin(ra) * r0, p.x + Math.cos(ra) * r1, yy + Math.sin(ra) * r1, FORM, 3800 + k * 10 + s);
          }
          d.ink = INK;
        });
        d.pop();
      }

      for (const nm of nums) drawNum(d, nm);

      // ---- Names: the six out, four of the nine aboard.
      const boxes: number[] = [];
      const label = (name: string, rgb: number, ax: number, ay: number, dx: number, dy: number, size: number, seed: number): void => {
        const cx = ax + dx;
        const base = ay + dy;
        const w = measure("roman", size, name);
        if (Math.hypot(dx, dy) > 34) d.line(cx, base + 6, ax, ay + 2, HAIR, seed);
        d.fill(d.box(cx - w / 2 - 1, base + 3, cx + w / 2 + 1, base + 8), d.ground);
        d.fill(d.box(cx - w / 2, base + 4, cx + w / 2, base + 7), rgb);
        d.text(name, cx, base, { size, align: 0.5, halo: 1.4 });
        boxes.push(cx - w / 2, base - size * 0.8, cx + w / 2, base + 8);
      };
      const ringed = take === "ring";
      const OUT_TAG: Record<number, [number, number]> = {
        0: ringed ? [0, -46] : [-100, 100],
        8: [-60, 118],
        1: ringed ? [160, 14] : [10, 96],
        2: [120, 40],
        3: [100, -24],
        4: [90, 30],
      };
      for (const c of out) {
        const look = crowd[c.i] as Look;
        const [dx, dy] = OUT_TAG[c.i] ?? [0, -10];
        label(look.name, look.cloak, px(c.x), py(c.y) - S * T * ST * HAT_TOP * 0.82, dx, dy, 36, c.i + 40);
      }
      const ABOARD_TAG: Record<string, [number, number]> = {
        dr_spoon: [0, -18],
        sleepyotter: [0, -18],
        NotABot_: [-150, 8],
        kraken_main: [0, -18],
      };
      for (const tg of tags) {
        const o = ABOARD_TAG[tg.name];
        if (o) label(tg.name, tg.rgb, tg.x, tg.y, o[0], o[1], 30, 60);
      }

      drawCorners(d, {
        time: "3:40",
        elapsed: 0.72,
        counts: ["6", "9", "1388", "31"],
        log: [10, "Gravel Oath", 2],
      });
      drawShieldSlip(d, take, litPosts, POSTS);
      drawFrameRule(d);
    },
  };
}

function castShadowAt(d: Draw, x: number, y: number): void {
  castShadow(d, x, y, S, 0.5);
}

/** A contact burst at a ground point, `size` tiles across, already in ground space. */
function drawImpactRaw(d: Draw, x: number, y: number, size: number, seed: number): void {
  drawImpact(d, x, y, 0.04, size, seed);
}

function drawSBody(d: Draw, b: SBody, idx: number, t: number, cx: number): void {
  const hide = TONE.hide;
  const dark = TONE.dark;
  if (b.dark) {
    TONE.hide = HORDE_HIDE;
    TONE.dark = HORDE_DARK;
  }
  if (b.kind === "mite") {
    standSpace(d);
    drawSwarm(
      d,
      [
        {
          x: b.x,
          y: b.y / ST - b.air,
          face: b.face,
          phase: t * 3 + idx * 0.37,
          stretch: b.air > 0 ? 1.12 : 1 + (idx % 3) * 0.05,
          flash: b.act === "flash",
          seed: idx,
        },
      ],
      1,
      0.97,
    );
    d.pop();
  } else {
    drawMon(d, { kind: b.kind, x: b.x, y: b.y - b.air * ST, face: b.face, act: b.act, build: b.build, air: 0 }, idx, t);
  }
  TONE.hide = hide;
  TONE.dark = dark;
  if (!b.dark || b.act === "flash") return;
  // The side toward the lantern catches its light: a paper line along the back.
  const sz = b.kind === "mite" ? 0.62 : b.kind === "hound" ? 0.85 : b.kind === "brute" ? 1.75 : 2.2;
  const hw = b.kind === "mite" ? 0.42 : b.kind === "hound" ? 0.75 : 1.0;
  const s = b.x < cx ? 1 : -1;
  const top = b.y / ST - b.air - sz;
  standSpace(d);
  d.ink = PAPER;
  d.curve([b.x - s * hw * 0.1, top + 0.04, b.x + s * hw * 0.45, top - 0.02, b.x + s * hw * 0.9, top + 0.22 * hw], FORM, idx + 5000, false, 0.8);
  d.ink = INK;
  d.pop();
}

function drawShieldSlip(d: Draw, take: Take, lit: number, posts: number): void {
  const x = FRAME.x0 + 18;
  const y = FRAME.y0 + 18 + 104 + 12;
  const w = 224;
  const h = 96;
  slip(d, x, y, w, h, 35);
  const cx = x + 50;
  const cy = y + h / 2;
  const r = 30;
  const strength = take === "wall" ? lit / posts : take === "dome" ? DOME_HOLDS : 0.52;
  if (take === "dome") {
    // The dome in small: its outline holding over the share that still stands.
    const base = cy + 14;
    d.line(cx - r - 4, base, cx + r + 4, base, FORM, 36);
    const n = 24;
    d.ink = LAMP_INK;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI + (i / n) * Math.PI;
      const a1 = a0 + Math.PI / n;
      const holds = i / n < strength;
      const p0 = [cx + Math.cos(a0) * r, base + Math.sin(a0) * r * 1.05];
      const p1 = [cx + Math.cos(a1) * r, base + Math.sin(a1) * r * 1.05];
      if (holds) {
        const q0 = [cx + Math.cos(a0) * (r - 7), base + Math.sin(a0) * (r - 7)];
        const q1 = [cx + Math.cos(a1) * (r - 7), base + Math.sin(a1) * (r - 7)];
        const band = [p0[0], p0[1], p1[0], p1[1], q1[0], q1[1], q0[0], q0[1]] as number[];
        d.fill(band, LAMP, 0.5);
        d.hatch(band, 2, LAMP_INK, 0.9, false, FORM);
        d.line(p0[0] as number, p0[1] as number, p1[0] as number, p1[1] as number, CONTOUR, 37 + i);
      } else if (i % 2 === 0) {
        d.line(p0[0] as number, (p0[1] as number) - 2, p1[0] as number, (p1[1] as number) + 2, FORM, 37 + i);
      }
    }
    d.ink = INK;
  } else if (take === "ring") {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      d.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.8, LAMP_INK);
    }
    const k = 0.35 + 0.65 * strength;
    d.fill(d.round(cx, cy, r * k, r * k, 24).slice(), LAMP, 0.6);
    d.ink = LAMP_INK;
    d.curve(d.round(cx, cy, r * k, r * k, 24).slice(), CONTOUR, 38, true);
    d.ink = INK;
  } else {
    for (let i = 0; i < posts; i++) {
      const a = -Math.PI / 2 + (i / posts) * Math.PI * 2;
      const on = i < lit;
      const px0 = cx + Math.cos(a) * r;
      const py0 = cy + Math.sin(a) * r;
      if (on) {
        d.dot(px0, py0, 3.6, LAMP_INK);
        d.dot(px0, py0, 2.4, LAMP);
      } else d.dot(px0, py0, 2.2, INK);
    }
  }
  const value = take === "wall" ? `${lit}/${posts}` : `${Math.round(strength * 100)}%`;
  d.text(value, x + 98, y + 54, { size: take === "wall" ? 40 : 48 });
  d.text("shield", x + 100, y + 82, { size: 24 });
}
