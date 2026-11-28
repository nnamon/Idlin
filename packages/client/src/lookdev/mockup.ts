// Mockup stills of one landing for the operator to choose a staging from
// (#362). Not the game: every position is laid by hand. Four takes of the
// same moment, a medium landing mid-expedition with 13 citizens out and 2
// aboard:
//   A  #371's map, flat plan with things standing up as icons;
//   B  the same with things leaning toward the camera, ground at 0.8;
//   C  B with the city drawn from above, decks open;
//   D  B at 11:50, the black closed into a ring and everyone running for the ramp.

import { drawBrute, drawHound, drawSwarm, beastPose, type Mite } from "./beasts.ts";
import { BRASS, CANVAS, type CityState, drawCity, IRON, LAMP, TIMBER } from "./city.ts";
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
  standing,
  swinging,
  walking,
} from "./figure.ts";
import {
  drawArrow,
  drawDrop,
  drawImpact,
  drawNumber,
  drawPot,
  drawSpills,
  drawStone,
  drawSwing,
  RARITY,
  type Spill,
} from "./fx.ts";
import { hash, lerp, mix, noise1, noise2, rng, spline } from "./geom.ts";
import type { Scene } from "./scenes.ts";
import { HEIGHT, measure, WIDTH } from "./surface.ts";
import { drawMass, drawThingAt, type Mass, VALE_COLOURS } from "./vale.ts";

const { GROUND, GROWTH, GROWTH_DEEP, WATER, ROCK, STONE, FLOWER } = VALE_COLOURS;
const SHADOW = 0x4a4038;
const BRUISE = 0x5a2a3a;
const OXIDE = 0xa8644a;

/** Pixels a tile. The map is about 63 by 35 tiles: a medium landing. */
const T = 30;
const FRAME = { x0: 20, y0: 20, x1: WIDTH - 20, y1: HEIGHT - 20 } as const;
const OX = FRAME.x0;
const OY = FRAME.y0;
/** A citizen's height in tiles. */
const S = 1.4;
/** Where the ground under the middle of the city is, in tiles. */
const CITY = { x: 31, y: 18 } as const;

interface Take {
  /** How much taller things stand than in #371. */
  st: number;
  /** How flat round things on the ground are drawn. */
  gy: number;
  shadows: boolean;
  cityTop: boolean;
  late: boolean;
}

const TAKES: Record<string, Take> = {
  A: { st: 1, gy: 1, shadows: false, cityTop: false, late: false },
  B: { st: 1.4, gy: 0.8, shadows: true, cityTop: false, late: false },
  C: { st: 1.4, gy: 0.8, shadows: true, cityTop: true, late: false },
  D: { st: 1.4, gy: 0.8, shadows: true, cityTop: false, late: true },
};

const crowd: Look[] = Array.from({ length: 15 }, (_, i) => lookOf(i + 1));

// ---------------------------------------------------------------- the land

const RIVER = [44, -1.5, 43, 5, 46.5, 11, 45, 17, 48, 23.5, 46, 29.5, 49, 36.5];
const PATHS: number[][] = [
  [40, 18.6, 43, 18, 45.6, 17.2, 49, 15, 51.5, 12.5],
  [45.6, 17.2, 48.5, 20.5, 51, 24.5],
  [23.5, 19.6, 18, 19.2, 12, 18.9, 6.5, 19.2],
  [18, 19.2, 16.4, 15.5, 14.2, 12.4],
  [14, 19.1, 12.6, 22.5, 11.6, 24.6],
  [31, 20.5, 31.6, 25, 31, 29.2],
  [26, 13, 24, 9, 22.2, 6.6],
];

interface Land {
  patches: { x: number; y: number; r: number; rgb: number; alpha: number; seed: number }[];
  river: number[];
  left: number[];
  right: number[];
  paths: number[][];
  clumps: { x: number; y: number; kind: number; seed: number }[];
  masses: Mass[];
}

let land: Land | null = null;

function nearRiver(river: number[], x: number, y: number): number {
  let best = 99;
  for (let i = 0; i < river.length; i += 4)
    best = Math.min(best, Math.hypot(x - (river[i] as number), y - (river[i + 1] as number)));
  return best;
}

function buildLand(): Land {
  const random = rng(3620362);
  const patches: Land["patches"] = [];
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
  // Darker ground at the foot of woods, rock toward the crags.
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
  // Trodden ground round the city's feet.
  patches.push({ x: CITY.x + 1, y: CITY.y + 0.8, r: 7, rgb: 0xcfc7a2, alpha: 0.4, seed: 909 });

  const river: number[] = [];
  spline(RIVER, RIVER.length / 2, 0.6, false, river);
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
  const paths = PATHS.map((p) => {
    const out: number[] = [];
    spline(p, p.length / 2, 0.5, false, out);
    return out;
  });

  const clumps: Land["clumps"] = [];
  for (let i = 0; i < 4200; i++) {
    const x = lerp(-1, 64, random());
    const y = lerp(-1, 36, random());
    const density = noise2(x / 3.2, y / 3.2, 81) * 1.25 - 0.1;
    if (density < 0.5 + random() * 0.35) continue;
    if (nearRiver(river, x, y) < 1.3) continue;
    if (Math.abs(x - CITY.x) < 7 && Math.abs(y - CITY.y + 0.5) < 2.5) continue;
    clumps.push({ x, y, kind: random() < 0.72 ? 0 : random() < 0.6 ? 1 : 2, seed: i });
  }

  const masses: Mass[] = [];
  const wood = (
    x0: number,
    x1: number,
    y: number,
    height: number,
    strength: number,
    seed: number,
    rgb = GROWTH,
  ): void => {
    const base: number[] = [];
    for (let x = x0; x <= x1 + 0.01; x += 1.4) base.push(x, y + noise1(x / 5 + seed, seed) * 1.1);
    masses.push({ base, height, strength, rgb, seed, kind: "wood" });
  };
  const crag = (x0: number, x1: number, y: number, height: number, seed: number): void => {
    const base: number[] = [];
    for (let x = x0; x <= x1 + 0.01; x += 1.7) base.push(x, y + noise1(x / 4 + seed, seed) * 0.8);
    masses.push({ base, height, strength: 1, rgb: ROCK, seed, kind: "crag" });
  };
  wood(12, 27, 1.6, 2.6, 0.6, 42, GROWTH_DEEP);
  wood(0, 8.5, 6.6, 3.0, 1, 41);
  wood(36, 41.5, 3.8, 3.0, 1, 43);
  crag(55.5, 64, 6.8, 3.4, 44);
  wood(33, 44.5, 33.6, 3.0, 1, 45);
  wood(0, 6.5, 28.8, 2.8, 1, 46);
  wood(-1, 2.6, 13.2, 2.6, 0.85, 47, GROWTH_DEEP);
  wood(20, 25, 33.8, 2.6, 1, 48);
  return { patches, river, left, right, paths, clumps, masses };
}

function getLand(): Land {
  if (!land) land = buildLand();
  return land;
}

/** Lone standing things: [x, y, kind, size]. */
const THINGS: [number, number, number, number][] = [
  // trees
  [5.0, 15.6, 0, 2.4],
  [7.2, 23.6, 1, 2.6],
  [20.6, 23.4, 2, 2.4],
  [24.2, 29.6, 0, 2.2],
  [27.5, 4.6, 3, 2.4],
  [17.4, 7.6, 1, 2.6],
  [36.8, 27.2, 0, 2.5],
  [40.6, 9.4, 2, 2.3],
  [50.2, 18.6, 1, 2.5],
  [53.5, 21.6, 0, 2.2],
  [59.6, 24.6, 4, 2.4],
  [48.6, 6.4, 0, 2.2],
  [2.4, 24.2, 4, 2.2],
  [35.6, 11.2, 3, 2.1],
  [13.4, 31.2, 0, 2.2],
  [61.4, 30.6, 1, 2.3],
  [28.2, 25.6, 1, 2.0],
  // bushes with fruit, boulders
  [21.6, 13.4, 5, 0.9],
  [37.6, 22.8, 5, 0.8],
  [8.8, 20.8, 5, 0.9],
  [42.6, 26.6, 5, 0.85],
  [25.4, 7.8, 5, 0.8],
  [51.2, 29.8, 5, 0.9],
  [33.6, 26.6, 6, 0.8],
  [18.8, 26.2, 6, 0.7],
  [44.8, 8.2, 6, 0.9],
  [57.8, 14.6, 6, 0.8],
  [5.8, 11.6, 6, 0.7],
  [29.2, 30.9, 6, 1.0],
  // standing stones, a cairn at the ford, bones
  [26.2, 9.4, 8, 1.3],
  [27.1, 9.0, 8, 1.0],
  [44.1, 19.0, 10, 0.9],
  [12.4, 11.2, 14, 0.9],
  [30.2, 30.0, 14, 1.0],
  [55.0, 23.4, 14, 0.8],
  // resources
  [34.2, 4.9, 9, 1.8],
  [24.4, 26.8, 9, 1.4],
  [53.1, 10.6, 12, 1.2],
  [25.2, 4.6, 12, 1.0],
  [10.2, 25.4, 11, 3.0],
  [56.6, 26.4, 13, 2.0],
  [58.8, 18.4, 7, 4.4],
];

const DENS: { x: number; y: number; level: number }[] = [
  { x: 9.6, y: 9.0, level: 28 },
  { x: 4.4, y: 18.8, level: 31 },
];
const SCRAP = { x: 17.6, y: 29.6 };

// ---------------------------------------------------------------- who is where

type Act = "swing" | "hit" | "shoot" | "walk" | "run" | "hammer" | "chest" | "pot" | "sling" | "stand";

interface Cit {
  i: number;
  x: number;
  y: number;
  act: Act;
  face: number;
  haul?: number;
  pennant?: boolean;
  outline?: boolean;
}

/** The moment at 4:30, for takes A to C. */
const OUT: Cit[] = [
  // The den fight: joshyboy88 lands a big one on the elite.
  { i: 0, x: 17.2, y: 12.9, act: "hit", face: -1 },
  { i: 3, x: 11.6, y: 14.8, act: "swing", face: -1 },
  { i: 2, x: 21.6, y: 10.4, act: "shoot", face: -1 },
  // The chest and its guards.
  { i: 1, x: 51.3, y: 11.3, act: "chest", face: 1 },
  { i: 8, x: 54.0, y: 13.4, act: "swing", face: 1 },
  { i: 12, x: 49.8, y: 15.0, act: "sling", face: 1 },
  // Scrap.
  { i: 4, x: 11.7, y: 26.4, act: "hammer", face: -1 },
  { i: 9, x: 16.0, y: 30.0, act: "hammer", face: 1 },
  // The mites.
  { i: 11, x: 52.9, y: 27.5, act: "swing", face: 1 },
  { i: 7, x: 49.9, y: 24.2, act: "pot", face: 1 },
  // Home with a full pack and the unique on it.
  { i: 14, x: 43.4, y: 22.6, act: "walk", face: -1, haul: 1, pennant: true },
  // Ore to the north, and one on the way out west.
  { i: 13, x: 32.7, y: 5.4, act: "hammer", face: 1 },
  { i: 6, x: 17.2, y: 20.2, act: "walk", face: -1, haul: 0.2 },
];
const ABOARD_EARLY = new Set([5, 10]);

/** The moment at 11:50. */
const LATE_OUT: Cit[] = [
  { i: 0, x: 22.6, y: 19.4, act: "run", face: 1, haul: 0.6 },
  { i: 2, x: 45.2, y: 11.6, act: "run", face: -1, haul: 0.4 },
  { i: 11, x: 44.6, y: 23.0, act: "run", face: -1, haul: 0.8 },
  { i: 7, x: 46.4, y: 24.4, act: "run", face: -1, haul: 0.3 },
  { i: 3, x: 40.6, y: 19.9, act: "swing", face: 1 },
  { i: 6, x: 27.0, y: 15.6, act: "walk", face: 1, haul: 0.5, outline: true },
];
const ABOARD_LATE = new Set([1, 4, 5, 8, 9, 10, 12, 13, 14]);

type Kind = "hound" | "brute" | "elite";
interface Mon {
  kind: Kind;
  x: number;
  y: number;
  face: number;
  act: "idle" | "lunge" | "coil" | "hurt" | "run" | "flash";
  build: number;
}

const MONSTERS: Mon[] = [
  // the den fight
  { kind: "elite", x: 14.4, y: 12.1, face: 1, act: "hurt", build: 0 },
  { kind: "hound", x: 9.4, y: 14.3, face: 1, act: "hurt", build: 1 },
  { kind: "hound", x: 7.6, y: 12.0, face: 1, act: "coil", build: 2 },
  { kind: "hound", x: 19.8, y: 14.6, face: -1, act: "lunge", build: 0 },
  // the chest's guards
  { kind: "hound", x: 56.0, y: 13.2, face: -1, act: "hurt", build: 0 },
  { kind: "hound", x: 55.9, y: 15.5, face: -1, act: "lunge", build: 2 },
  { kind: "hound", x: 55.4, y: 10.2, face: -1, act: "coil", build: 1 },
  // packs nobody has gone to yet: den 31, the ruin, the south
  { kind: "hound", x: 8.4, y: 20.0, face: 1, act: "idle", build: 0 },
  { kind: "hound", x: 7.6, y: 18.2, face: 1, act: "idle", build: 1 },
  { kind: "hound", x: 8.0, y: 22.0, face: -1, act: "idle", build: 2 },
  { kind: "hound", x: 57.0, y: 20.4, face: -1, act: "idle", build: 1 },
  { kind: "hound", x: 59.6, y: 21.0, face: 1, act: "idle", build: 0 },
  { kind: "hound", x: 56.0, y: 19.0, face: -1, act: "idle", build: 2 },
  { kind: "brute", x: 32.6, y: 30.6, face: -1, act: "idle", build: 0 },
  { kind: "hound", x: 34.6, y: 31.4, face: -1, act: "idle", build: 1 },
  { kind: "hound", x: 30.6, y: 32.0, face: 1, act: "idle", build: 2 },
];

const LATE_MONSTERS: Mon[] = [
  // runners behind each one coming in
  { kind: "hound", x: 19.4, y: 19.0, face: 1, act: "run", build: 0 },
  { kind: "hound", x: 18.6, y: 20.6, face: 1, act: "run", build: 2 },
  { kind: "hound", x: 47.6, y: 10.0, face: -1, act: "run", build: 1 },
  { kind: "hound", x: 47.0, y: 8.4, face: -1, act: "run", build: 0 },
  { kind: "hound", x: 48.6, y: 25.4, face: -1, act: "run", build: 2 },
  { kind: "hound", x: 49.6, y: 23.4, face: -1, act: "run", build: 1 },
  { kind: "brute", x: 50.4, y: 26.8, face: -1, act: "run", build: 0 },
  // at the ramp's foot
  { kind: "hound", x: 42.6, y: 20.4, face: -1, act: "hurt", build: 1 },
  { kind: "hound", x: 42.6, y: 22.0, face: -1, act: "lunge", build: 0 },
];

// ---------------------------------------------------------------- drawing helpers

/** Ground space: tiles, origin at the frame's corner. */
function groundSpace(d: Draw): void {
  d.push();
  d.move(OX, OY);
  d.scale(T);
}

/** Stand space: the same, but heights are `st` taller. A ground point (x, y) is (x, y / st) here. */
function standSpace(d: Draw, k: Take): void {
  d.push();
  d.move(OX, OY);
  d.scale(T, T * k.st);
}

const px = (x: number): number => OX + x * T;
const py = (y: number): number => OY + y * T;

/** A cast shadow to the lower right, in ground space, for something `h` tall and `w` wide. */
function castShadow(d: Draw, k: Take, x: number, y: number, h: number, w: number): void {
  if (!k.shadows) return;
  const pts: number[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // Long toward the lower right, narrow across.
    const along = Math.cos(a) * (w * 0.36 + h * 0.26);
    const across = Math.sin(a) * (w * 0.22 + 0.06);
    const cx = x + w * 0.12 + h * 0.24;
    const cy = y + 0.08 + h * 0.1;
    pts.push(cx + along * 0.92 - across * 0.35, cy + along * 0.34 + across * 0.9 * k.gy);
  }
  d.wash(pts, SHADOW, 0.24, true);
}

function citizenPose(c: Cit, look: Look, t: number): Pose {
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
    case "run":
      p = walking(3.1 + c.i * 0.7, 2, c.face);
      break;
    case "hammer":
      p = swinging(0.12 + (c.i % 3) * 0.03, c.face);
      p.tool = "hammer";
      break;
    case "chest":
      p = pose({ face: c.face, crouch: 0.7, lean: 0.45, arm: 1.3, arm2: 1.0, tool: "none", nod: 0.2 });
      break;
    case "pot":
      p = pose({ face: c.face, lean: 0.22, arm: 2.6, arm2: -0.5, step: 0.8, stride: 0.25, tool: "none", trail: -0.1 });
      break;
    default:
      p = standing(look.id, t, c.face);
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

function drawDen(d: Draw, k: Take, seed: number): void {
  if (k.st === 1) {
    // #371's nest, larger: a pit of ink with a raised lip, spines round it.
    const lip = d.round(0, -0.1, 2.0, 0.95, 14, seed).slice();
    d.fill(lip, d.ground, 1, true);
    d.wash(lip, 0x8a7f74, 0.8, true);
    d.curve(lip, CONTOUR, seed, true);
    d.fill(d.round(0, -0.1, 1.4, 0.58, 12, seed + 1), INK, 1, true);
    for (let i = 0; i < 4; i++) {
      d.dot(-0.8 + i * 0.5, -0.12 + (i % 2) * 0.14, 2.6, PAPER);
      d.dot(-0.62 + i * 0.5, -0.1 + (i % 2) * 0.14, 2.6, PAPER);
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI - 0.15;
      d.line(
        Math.cos(a) * 1.9,
        -0.1 - Math.sin(a) * 0.9,
        Math.cos(a) * 2.5,
        -0.1 - Math.sin(a) * 1.4,
        CONTOUR,
        seed + 4 + i,
      );
    }
    return;
  }
  // Leaning: a mound of rock with its grassy top showing and the mouth in its face.
  const mound = [-2.4, 0, -2.2, -0.9, -1.5, -1.7, -0.3, -2.0, 1.1, -1.85, 2.0, -1.0, 2.4, 0];
  d.fill(mound, d.ground, 1, true);
  d.wash(mound, ROCK, 0.85, true);
  d.hatch([0.6, -1.9, 1.1, -1.85, 2.0, -1.0, 2.4, 0, 1.0, 0], 2, INK, 0.6, true);
  // The top face.
  const top = d.round(-0.25, -1.72, 1.5, 0.32, 12, seed + 2).slice();
  d.fill(top, GROWTH, 0.75, true);
  d.curve(top, FORM, seed + 3, true);
  d.curve(mound, CONTOUR, seed, true);
  // The mouth: a black arch with eyes in it.
  const mouth = [-1.1, 0.02, -1.0, -0.8, -0.5, -1.22, 0.3, -1.22, 0.9, -0.8, 1.0, 0.02];
  d.fill(mouth, INK, 1, true);
  for (let i = 0; i < 3; i++) {
    d.dot(-0.5 + i * 0.45, -0.42 - (i % 2) * 0.16, 2.6, PAPER);
    d.dot(-0.34 + i * 0.45, -0.4 - (i % 2) * 0.16, 2.6, PAPER);
  }
  for (let i = 0; i < 5; i++) {
    const x = -1.9 + i * 0.95;
    d.line(x, -0.1, x + (i - 2) * 0.12, -0.55, CONTOUR, seed + 9 + i);
  }
}

function drawScrapHeap(d: Draw, seed: number): void {
  d.hatch(d.round(0.4, 0.05, 1.6, 0.25, 9), 2, INK, 0.5);
  const plates: number[][] = [
    [-1.4, 0, -1.2, -0.7, -0.1, -0.9, 0.1, 0],
    [-0.2, 0, 0.1, -1.1, 1.0, -1.25, 1.4, 0],
    [-0.8, -0.6, -0.5, -1.4, 0.4, -1.2, 0.2, -0.5],
  ];
  plates.forEach((p, i) => {
    d.body(p, { smooth: false, wash: i === 2 ? OXIDE : IRON, washAlpha: 0.8, weight: CONTOUR, seed: seed + i });
    d.hatch(p.slice(4).concat(p.slice(0, 2)), 2, INK, 0.5);
  });
  // A gear and a pipe sticking out.
  d.body(d.round(0.9, -1.25, 0.42, 0.42, 10), { wash: BRASS, washAlpha: 0.9, weight: CONTOUR, seed: seed + 5 });
  d.dot(0.9, -1.25, 3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.line(0.9 + Math.cos(a) * 0.42, -1.25 + Math.sin(a) * 0.42, 0.9 + Math.cos(a) * 0.56, -1.25 + Math.sin(a) * 0.56, CONTOUR, seed + 10 + i);
  }
  d.line(-1.0, -0.9, -1.8, -1.7, HEAVY, seed + 20);
}

// ---------------------------------------------------------------- the city from above

const HULL = [-7.5, 0, -7.2, -2.2, -6.2, -2.9, 3.8, -3.0, 6.4, -1.8, 7.6, 0, 6.4, 1.8, 3.8, 3.0, -6.2, 2.9, -7.2, 2.2];

function drawCityTop(d: Draw, k: Take, t: number, tags: Tag[], heads: number[]): void {
  const H = 1.7;
  const P = (x: number, y: number, z: number): [number, number] => [
    px(CITY.x + x),
    py(CITY.y + y * k.gy) - z * T * k.st,
  ];
  const poly = (pts: number[], z: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(...P(pts[i] as number, pts[i + 1] as number, z));
    return out;
  };
  const beam = (a: [number, number], b: [number, number], wa: number, wb: number): number[] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return [a[0] + nx * wa, a[1] + ny * wa, b[0] + nx * wb, b[1] + ny * wb, b[0] - nx * wb, b[1] - ny * wb, a[0] - nx * wa, a[1] - ny * wa];
  };
  const LEG_X = [-5.4, -2.2, 1.4, 4.4];
  const leg = (x: number, side: number, key: number): void => {
    const out = Math.sign(x || 1);
    const hip = P(x, side * 2.75, H - 0.3);
    const kneeAt = P(x * 1.3 + out * 1.0, side * (side < 0 ? 4.6 : 5.6), H + (side < 0 ? 0.9 : 1.3));
    const foot = P(x * 1.6 + out * 2.0, side * 7.4, 0);
    const far = side < 0;
    const wash = far ? 0.55 : 0.85;
    const weight = far ? CONTOUR : HEAVY;
    d.body(beam(kneeAt, foot, 7, 4), { smooth: false, wash: IRON, washAlpha: wash, weight, seed: key });
    d.body(beam(hip, kneeAt, 10, 7), { smooth: false, wash: IRON, washAlpha: wash, weight, seed: key + 1 });
    if (!far) d.hatch(beam([hip[0] + 2, hip[1] + 3], [kneeAt[0] + 2, kneeAt[1] + 3], 4, 3), 3, INK, 0.6);
    d.body(d.round(kneeAt[0], kneeAt[1], 9, 9, 10), { wash: BRASS, washAlpha: 0.9, weight: CONTOUR, seed: key + 2 });
    d.dot(kneeAt[0], kneeAt[1], 2.6);
    // The foot: a pad on the ground.
    d.body(d.round(foot[0], foot[1] + 2, 12, 5, 9), { wash: IRON, washAlpha: 0.8, weight: CONTOUR, seed: key + 3 });
  };

  // Shadow under the hull, thrown to the lower right.
  const shadow: number[] = [];
  for (let i = 0; i < HULL.length; i += 2)
    shadow.push(...P((HULL[i] as number) * 1.05 + 1.4, (HULL[i + 1] as number) * 1.1 + 1.0, 0));
  d.wash(shadow, SHADOW, 0.28, true);
  d.hatch(shadow, 2, INK, 0.35, true);

  // Far legs, behind the hull.
  LEG_X.forEach((x, i) => leg(x, -1, 700 + i * 10));

  // The hull's near side, below the rim.
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
  // A red strake along the top of the side, and rivets.
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

  // The deck, open: planking, then rooms with their roofs off.
  const deck = poly(HULL, H);
  d.body(deck, { smooth: false, wash: TIMBER, washAlpha: 0.75, weight: HEAVY, seed: 803 });
  const inner: number[] = [];
  for (let i = 0; i < HULL.length; i += 2) inner.push(...P((HULL[i] as number) * 0.95, (HULL[i + 1] as number) * 0.87, H));
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
    // The walls' tops, and their inner face just showing below the far wall.
    const wall = poly([x0, y0, x1, y0, x1, y1, x0, y1], H + 0.35);
    const farIn = poly([x0, y0, x1, y0, x1, y0 + 0.01, x0, y0 + 0.01], H);
    d.fill([wall[0] as number, wall[1] as number, wall[2] as number, wall[3] as number, farIn[2] as number, farIn[3] as number, farIn[0] as number, farIn[1] as number], shade(rgb, 0.35), 0.8);
    d.path(wall, CONTOUR, key, true);
    d.path(farIn.slice(0, 4), HAIR, key + 1);
  };
  // Engine room at the stern: the boiler and its stack.
  room(-6.8, -2.0, -3.7, 2.0, 0xb8ad9a, 810);
  // Forge and bunks.
  room(-3.5, -2.5, -1.3, -0.25, 0xc9b49a, 811);
  room(-3.5, 0.25, -1.3, 2.5, CANVAS, 812);
  // Galley, charts, wheelhouse.
  room(1.7, -2.6, 4.1, -0.25, 0xd9c49a, 813);
  room(1.7, 0.25, 4.1, 2.6, 0xe0d4b4, 814);
  room(4.4, -1.3, 6.3, 1.3, 0xc9b49a, 815);

  // Furniture.
  const [bx, by] = P(-5.3, 0, H);
  d.body(d.round(bx, by, 1.0 * T, 0.85 * T * k.gy, 14), { wash: BRASS, washAlpha: 0.85, weight: CONTOUR, seed: 820 });
  d.hatch(d.round(bx + 8, by + 6, 0.6 * T, 0.5 * T * k.gy, 10), 2, INK, 0.5);
  d.dot(bx - 6, by - 4, 6, 0xd98f3e);
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = P(-6.4 + i * 0.4, -1.6, H);
    const [cx, cy] = P(-4.0, -1.6 + i * 0.3, H);
    d.line(ax, ay, cx, cy, FORM, 821 + i);
  }
  // Bunks.
  for (let i = 0; i < 3; i++) {
    const b = poly([-3.3 + i * 0.68, 0.5, -2.8 + i * 0.68, 0.5, -2.8 + i * 0.68, 2.2, -3.3 + i * 0.68, 2.2], H + 0.15);
    d.body(b, { smooth: false, wash: 0x8fa3b8, washAlpha: 0.7, weight: FORM, seed: 830 + i });
  }
  // Forge: anvil and fire.
  const [fx, fy] = P(-2.9, -1.4, H);
  d.body(d.round(fx, fy, 14, 9, 9), { wash: 0x6d5e52, washAlpha: 0.9, weight: CONTOUR, seed: 840 });
  d.dot(fx, fy, 5, 0xe0702c);
  const anvil = P(-1.9, -1.0, H + 0.2);
  d.body(d.box(anvil[0] - 10, anvil[1] - 5, anvil[0] + 10, anvil[1] + 5), { smooth: false, spot: true });
  // Galley: stove and table.
  const [gx, gy] = P(2.3, -2.0, H);
  d.body(d.box(gx - 12, gy - 8, gx + 12, gy + 8), { smooth: false, wash: 0x6d5e52, washAlpha: 0.9, weight: CONTOUR, seed: 850 });
  d.dot(gx - 5, gy, 3, 0xe0702c);
  const tb = poly([2.9, -1.4, 3.9, -1.4, 3.9, -0.6, 2.9, -0.6], H + 0.25);
  d.body(tb, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: FORM, seed: 851 });
  // Charts: a table with a map on it.
  const ct = poly([2.0, 0.9, 3.6, 0.9, 3.6, 2.1, 2.0, 2.1], H + 0.25);
  d.body(ct, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: FORM, seed: 860 });
  const mp = poly([2.2, 1.05, 3.4, 1.0, 3.45, 1.95, 2.25, 1.9], H + 0.27);
  d.body(mp, { smooth: false, wash: PAPER, washAlpha: 1, weight: HAIR, seed: 861 });
  // Wheelhouse: the wheel.
  const [wx, wy] = P(5.6, 0, H + 0.3);
  d.curve(d.round(wx, wy, 12, 12 * k.gy, 12).slice(), CONTOUR, 870, true);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    d.line(wx - Math.cos(a) * 15, wy - Math.sin(a) * 15 * k.gy, wx + Math.cos(a) * 15, wy + Math.sin(a) * 15 * k.gy, FORM, 871 + i);
  }
  // Gun posts at either end.
  for (const [gxp, dir] of [
    [6.9, 1],
    [-6.9, -1],
  ] as const) {
    const [cx, cy] = P(gxp, 0, H + 0.2);
    d.body(d.round(cx, cy, 16, 13, 12), { wash: IRON, washAlpha: 0.8, weight: CONTOUR, seed: 880 + dir });
    d.body([cx, cy - 4, cx + dir * 34, cy - 7, cx + dir * 34, cy + 1, cx, cy + 4], { smooth: false, spot: true, seed: 882 + dir });
  }

  // Stores on the open deck: crates and barrels.
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
      d.body(d.box(cx - 9, cy - 7, cx + 9, cy + 7), { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: FORM, seed: 1000 + Math.round(x * 10) });
      d.line(cx - 9, cy - 7, cx + 9, cy + 7, HAIR, 1001);
    } else {
      d.body(d.round(cx, cy, 8, 7, 9), { wash: 0xa8845a, washAlpha: 0.95, weight: FORM, seed: 1002 + Math.round(x * 10) });
      d.curve(d.round(cx, cy, 5, 4, 8).slice(), HAIR, 1003, true);
    }
  }

  // The two aboard.
  const aboard: [number, number, number, number][] = [
    [5, 2.9, -1.1, -1],
    [10, -4.7, 1.4, 1],
  ];
  for (const [i, x, y, face] of aboard) {
    const look = crowd[i] as Look;
    const [fxp, fyp] = P(x, y, H);
    const p = i === 5 ? pose({ face, arm: 1.0, arm2: 0.6, lean: 0.15, tool: "ladle" }) : swinging(0.1, face);
    if (i === 10) p.tool = "pole";
    d.push();
    d.move(fxp, fyp);
    d.scale(T, T * k.st);
    drawCitizen(d, look, p, 0, 0, S, detailFor(S * T));
    d.pop();
    const top = fyp - S * T * k.st * HAT_TOP * 0.82;
    tags.push({ x: fxp, y: top, name: look.name, rgb: look.cloak });
    heads.push(fxp - 0.45 * S * T, fyp - S * T * k.st, fxp + 0.45 * S * T, fyp - 0.45 * S * T * k.st);
  }

  // The mast: up out of the open deck, with the lantern.
  const m0 = P(0.2, 0, H);
  const m1 = P(0.2, 0, H + 5.2);
  d.body(d.round(m0[0], m0[1], 13, 10, 10), { wash: TIMBER, washAlpha: 0.9, weight: CONTOUR, seed: 890 });
  for (const [x, y] of [
    [-6.2, -2.8],
    [3.8, -2.9],
    [-6.2, 2.8],
    [3.8, 2.9],
  ] as const) {
    const [ax, ay] = P(x, y, H + 0.2);
    d.line(m1[0], m1[1] + 30, ax, ay, HAIR, 891 + Math.round(x));
  }
  d.body([m0[0] - 4, m0[1], m1[0] - 3, m1[1], m1[0] + 3, m1[1], m0[0] + 4, m0[1]], { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: CONTOUR, seed: 895 });
  const nest = P(0.2, 0, H + 3.9);
  d.body(d.round(nest[0], nest[1], 15, 7, 10), { wash: TIMBER, washAlpha: 0.9, weight: CONTOUR, seed: 896 });
  d.dot(m1[0], m1[1], 11, LAMP, 0.35);
  d.body(d.round(m1[0], m1[1], 6, 7, 8), { wash: LAMP, washAlpha: 1, weight: FORM, seed: 897 });
  d.curve([m1[0], m1[1] - 8, m1[0] + 18, m1[1] - 12, m1[0] + 34, m1[1] - 6], CONTOUR, 898);
  // Smoke from the boiler's stack.
  const s0 = P(-5.6, -0.4, H + 0.6);
  const s1 = P(-5.6, -0.4, H + 2.6);
  d.body([s0[0] - 7, s0[1], s1[0] - 7, s1[1], s1[0] + 7, s1[1], s0[0] + 7, s0[1]], { smooth: false, wash: IRON, washAlpha: 0.9, weight: CONTOUR, seed: 899 });
  for (let i = 0; i < 4; i++) {
    const r = 9 + i * 5;
    d.body(d.round(s1[0] - 10 - i * 16 + Math.sin(t + i) * 3, s1[1] - 14 - i * 16, r, r * 0.8, 9, 900 + i), { wash: 0xcfc7bb, washAlpha: 0.5, weight: HAIR, seed: 900 + i });
  }

  // The ramp, down off the near side to the ground.
  const r0a = P(4.4, 2.75, H);
  const r0b = P(5.6, 2.2, H);
  const r1a = P(7.6, 5.8, 0);
  const r1b = P(8.8, 5.2, 0);
  const ramp = [r0a[0], r0a[1], r0b[0], r0b[1], r1b[0], r1b[1], r1a[0], r1a[1]];
  d.body(ramp, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: CONTOUR, seed: 910 });
  for (let i = 1; i < 8; i++) {
    const u = i / 8;
    d.line(lerp(r0a[0], r1a[0], u), lerp(r0a[1], r1a[1], u), lerp(r0b[0], r1b[0], u), lerp(r0b[1], r1b[1], u), HAIR, 911 + i);
  }

  // Near legs, in front of everything aboard.
  LEG_X.forEach((x, i) => leg(x, 1, 760 + i * 10));
}

// ---------------------------------------------------------------- the horde

interface Station {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  nx: number;
  ny: number;
  /** 0 to 1: how far in the black has come here; the bruise and hatching ahead of it scale with it. */
  env: number;
}

/** A band of black along one edge, in frame pixels. `from` and `to` run along the edge; depth peaks between. */
function band(edge: "n" | "s" | "e" | "w", from: number, to: number, depth: number, seed: number, full = false): Station[] {
  const out: Station[] = [];
  const steps = Math.max(2, Math.round((to - from) / 12));
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const along = lerp(from, to, u);
    const env = full ? 1 : Math.sin(Math.PI * u) ** 0.55;
    const dd =
      depth * env * (0.7 + 0.3 * noise1(along / 190, seed)) +
      22 * noise1(along / 46, seed + 1) * env +
      8 * noise1(along / 14, seed + 2) * env;
    const dep = Math.max(0, dd);
    let x = 0;
    let y = 0;
    let nx = 0;
    let ny = 0;
    if (edge === "e") [x, y, nx, ny] = [FRAME.x1, along, -1, 0];
    else if (edge === "w") [x, y, nx, ny] = [FRAME.x0, along, 1, 0];
    else if (edge === "n") [x, y, nx, ny] = [along, FRAME.y0, 0, 1];
    else [x, y, nx, ny] = [along, FRAME.y1, 0, -1];
    out.push({ ix: x + nx * dep, iy: y + ny * dep, ox: x - nx * 40, oy: y - ny * 40, nx, ny, env: Math.min(1, dep / Math.max(1, depth * 0.6)) });
  }
  return out;
}

/** The black closed into a ring round (cx, cy), with radii rx and ry, in frame pixels. */
function ringStations(cx: number, cy: number, rx: number, ry: number, seed: number): Station[] {
  const out: Station[] = [];
  const n = 260;
  for (let s = 0; s <= n; s++) {
    const a = ((s % n) / n) * Math.PI * 2;
    const r = 1 + 0.16 * noise1(a * 2.2, seed) + 0.05 * noise1(a * 9, seed + 1) + 0.025 * noise1(a * 30, seed + 2);
    const ix = cx + Math.cos(a) * rx * r;
    const iy = cy + Math.sin(a) * ry * r;
    const nl = Math.hypot(cx - ix, cy - iy) || 1;
    out.push({ ix, iy, ox: cx + Math.cos(a) * 2600, oy: cy + Math.sin(a) * 2600, nx: (cx - ix) / nl, ny: (cy - iy) / nl, env: 1 });
  }
  return out;
}

function drawBlack(d: Draw, st: Station[], t: number, seed: number): void {
  const n = st.length;
  if (n < 2) return;
  const strip: number[] = [];
  // The bruise ahead of it: two flat steps.
  for (const [ahead, alpha] of [
    [150, 0.09],
    [64, 0.12],
  ] as const) {
    strip.length = 0;
    for (let i = 0; i < n; i++) {
      const s = st[i] as Station;
      const a = ahead * s.env * (0.75 + 0.25 * noise1(i / 9, seed + 3));
      strip.push(s.ix + s.nx * a, s.iy + s.ny * a, s.ox, s.oy);
    }
    d.surface.strip(strip, n, BRUISE, alpha, true);
  }
  // Hatching in the red-brown of a blow about to land, in short pieces so each is a simple shape.
  for (let i = 0; i + 1 < n; i += 8) {
    const j = Math.min(n - 1, i + 8);
    const poly: number[] = [];
    for (let k = i; k <= j; k++) {
      const s = st[k] as Station;
      poly.push(s.ix, s.iy);
    }
    for (let k = j; k >= i; k--) {
      const s = st[k] as Station;
      const a = (42 + 14 * noise1(k / 6, seed + 4)) * s.env;
      poly.push(s.ix + s.nx * a, s.iy + s.ny * a);
    }
    d.hatch(poly, 2, BLOW, 0.9, false, 2.2);
  }
  // The mass: heads and backs along its front.
  strip.length = 0;
  for (let i = 0; i < n; i++) {
    const s = st[i] as Station;
    const bump = Math.abs(Math.sin(i * 0.9 + noise1(i / 7, seed + 5) * 3)) * 14 + hash(i, seed + 6) * 7;
    strip.push(s.ix + s.nx * bump, s.iy + s.ny * bump, s.ox, s.oy);
  }
  d.surface.strip(strip, n, INK, 1);
  // Spines, reaching limbs, a head lunging out every so often.
  for (let i = 1; i < n - 1; i += 3) {
    const s = st[i] as Station;
    if (Math.hypot(s.ix - s.ox, s.iy - s.oy) < 70) continue;
    const tx = -s.ny;
    const ty = s.nx;
    const len = 18 + hash(i, seed + 7) * 22;
    const lean = (hash(i, seed + 8) - 0.5) * 20;
    d.line(s.ix - s.nx * 4, s.iy - s.ny * 4, s.ix + s.nx * len + tx * lean, s.iy + s.ny * len + ty * lean, CONTOUR, i + 600);
    if (i % 9 === 0) {
      const out = 40 + hash(i, seed + 9) * 50;
      const hx = s.ix + s.nx * out;
      const hy = s.iy + s.ny * out;
      d.fill(
        [s.ix + tx * 14, s.iy + ty * 14, hx + tx * 8, hy + ty * 8, hx + s.nx * 20, hy + s.ny * 20, hx - tx * 8, hy - ty * 8, s.ix - tx * 14, s.iy - ty * 14],
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
  // Eyes and teeth inside the front.
  for (let i = 2; i < n; i += 4) {
    const s = st[i] as Station;
    const room = Math.hypot(s.ix - s.ox, s.iy - s.oy) - 40;
    if (room < 30) continue;
    const back = 18 + hash(i, seed + 10) * Math.min(120, room * 0.6);
    const ex = s.ix - s.nx * back;
    const ey = s.iy - s.ny * back;
    if (ex < FRAME.x0 || ex > FRAME.x1 || ey < FRAME.y0 || ey > FRAME.y1) continue;
    const blink = Math.sin(t * 0.9 + i * 2.7) > 0.93;
    const r = 2.2 + hash(i, seed + 11) * 2;
    if (!blink) {
      d.dot(ex, ey, r, PAPER);
      d.dot(ex - s.ny * r * 3, ey + s.nx * r * 3, r * 0.9, PAPER);
    }
    if (i % 12 === 2)
      for (let tooth = 0; tooth < 4; tooth++) {
        const tx = ex - 4 + tooth * 6;
        d.fill([tx, ey + 9, tx + 5, ey + 9, tx + 2.5, ey + 17], PAPER);
      }
  }
}

// ---------------------------------------------------------------- tags

const SPOTS: [number, number][] = [];
for (const r of [0, 28, 56, 84, 112, 140])
  for (const ox of r === 0 ? [0] : [0, 50, -50, 100, -100, 150, -150]) {
    SPOTS.push([ox, -r]);
  }
for (const [ox, oy] of [
  [110, 10],
  [-110, 10],
  [0, 70],
  [120, 40],
  [-120, 40],
  [0, 100],
  [160, 0],
  [-160, 0],
] as const)
  SPOTS.push([ox, oy]);

function placeTags(d: Draw, tags: Tag[], taken: number[]): number[] {
  const placed = [...taken];
  const where: number[] = [];
  const hits = (x0: number, y0: number, x1: number, y1: number, skipFrom: number): boolean => {
    if (x0 < FRAME.x0 + 6 || x1 > FRAME.x1 - 6 || y0 < FRAME.y0 + 6 || y1 > FRAME.y1 - 6) return true;
    for (let k = 0; k < placed.length; k += 4) {
      if (k === skipFrom) continue;
      if (x0 < (placed[k + 2] as number) && x1 > (placed[k] as number) && y0 < (placed[k + 3] as number) && y1 > (placed[k + 1] as number))
        return true;
    }
    return false;
  };
  for (const tag of tags) {
    const w = measure("roman", 24, tag.name) + 12;
    let spot: [number, number] = SPOTS[0] as [number, number];
    for (const s of SPOTS) {
      const cx = tag.x + s[0];
      const base = tag.y + s[1] - 8;
      if (!hits(cx - w / 2, base - 22, cx + w / 2, base + 8, -1)) {
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
    if (Math.hypot(cx - tag.x, base + 8 - tag.y) > 14) d.line(cx, base + 6, tag.x, tag.y + 4, HAIR, i + 5);
  });
  tags.forEach((tag, i) => {
    const cx = where[i * 2] as number;
    const base = where[i * 2 + 1] as number;
    const w = measure("roman", 24, tag.name);
    d.fill(d.box(cx - w / 2 - 1, base + 3, cx + w / 2 + 1, base + 7), d.ground);
    d.fill(d.box(cx - w / 2, base + 4, cx + w / 2, base + 6.5), tag.rgb);
    d.text(tag.name, cx, base, { size: 24, align: 0.5, halo: 1 });
  });
  return placed;
}

// ---------------------------------------------------------------- corners

function slip(d: Draw, x: number, y: number, w: number, h: number, seed: number): void {
  const n = 10;
  d.body([x + n, y, x + w - n, y, x + w, y + n, x + w, y + h - n, x + w - n, y + h, x + n, y + h, x, y + h - n, x, y + n], {
    smooth: false,
    weight: FORM,
    seed,
  });
}

function drawCorners(d: Draw, late: boolean): number[] {
  const taken: number[] = [];
  // The clock: a dial filling toward the black's arrival, and the time.
  {
    const x = FRAME.x0 + 18;
    const y = FRAME.y0 + 18;
    const w = 212;
    const h = 92;
    slip(d, x, y, w, h, 31);
    const cx = x + 48;
    const cy = y + h / 2;
    const r = 30;
    const elapsed = late ? 710 / 780 : 270 / 780;
    const wedge = [cx, cy];
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI / 2 + (i / 40) * elapsed * Math.PI * 2;
      wedge.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    d.wash(wedge, late ? BLOW : 0xc9a36b, 0.75);
    // The last stretch, when the black arrives, hatched.
    const end = [cx, cy];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (0.9 + (i / 10) * 0.1) * Math.PI * 2;
      end.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    d.hatch(end, 2, INK, 0.8);
    d.curve(d.round(cx, cy, r, r, 24).slice(), CONTOUR, 32, true);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      d.line(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6), cx + Math.cos(a) * r, cy + Math.sin(a) * r, i % 3 ? HAIR : FORM, 40 + i);
    }
    const ha = -Math.PI / 2 + elapsed * Math.PI * 2;
    d.line(cx, cy, cx + Math.cos(ha) * (r - 4), cy + Math.sin(ha) * (r - 4), CONTOUR, 33);
    d.dot(cx, cy, 3);
    d.text(late ? "11:50" : "4:30", x + 94, y + 60, { size: 44 });
    taken.push(x, y, x + w, y + h);
  }
  // The landing: size and level range, a modifier a line.
  {
    const lines = ["packs ×2", "rares +40%"];
    const head = "Medium 23–68";
    const w = Math.max(measure("roman", 30, head), ...lines.map((l) => measure("roman", 24, l))) + 44;
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
    const who = "lil_gremlin";
    const what = "Nine Lives";
    const ww = measure("roman", 28, who);
    const w = ww + 36 + measure("roman", 28, what) + 44;
    const h = 56;
    const x = FRAME.x0 + 18;
    const y = FRAME.y1 - 18 - h;
    slip(d, x, y, w, h, 61);
    d.text(who, x + 22, y + 37, { size: 28 });
    d.fill(d.box(x + 22, y + 42, x + 22 + ww, y + 44.5), (crowd[14] as Look).cloak);
    d.text(what, x + 22 + ww + 36, y + 37, { size: 28, rgb: mix(RARITY[3], INK, 0.2) });
    taken.push(x, y, x + w, y + h);
  }
  // Counts: an icon and a number each.
  {
    const counts = late ? ["6", "9", "612", "88"] : ["13", "2", "214", "31"];
    const h = 56;
    const cell = (s: string): number => 40 + measure("roman", 28, s) + 22;
    const w = counts.reduce((sum, s) => sum + cell(s), 0) + 16;
    const x0 = FRAME.x1 - 18 - w;
    const y = FRAME.y1 - 18 - h;
    slip(d, x0, y, w, h, 71);
    let x = x0 + 16;
    counts.forEach((s, k) => {
      const ix = x + 14;
      const iy = y + h / 2;
      if (k === 0) {
        // Out: a cloaked figure.
        d.body([ix - 9, iy + 13, ix - 6, iy - 2, ix + 6, iy - 2, ix + 9, iy + 13], { smooth: false, wash: 0x7a9cc0, weight: FORM, seed: 72 });
        d.body(d.round(ix, iy - 8, 6, 6, 8), { weight: FORM, seed: 73 });
        d.body([ix - 6, iy - 12, ix, iy - 24, ix + 6, iy - 12], { smooth: false, weight: FORM, wash: 0x7a9cc0, seed: 74 });
      } else if (k === 1) {
        // Aboard: the hull on its legs.
        d.body([ix - 15, iy - 4, ix + 15, iy - 4, ix + 10, iy + 4, ix - 11, iy + 4], { smooth: false, wash: IRON, washAlpha: 0.8, weight: FORM, seed: 75 });
        d.body(d.box(ix - 8, iy - 13, ix + 2, iy - 4), { smooth: false, wash: OXIDE, washAlpha: 0.8, weight: FORM, seed: 76 });
        for (const lx of [-10, -3, 4, 11]) d.line(ix + lx, iy + 3, ix + lx * 1.35, iy + 14, FORM, 77 + lx);
      } else if (k === 2) {
        // Kills: a splash of ink.
        d.fill(d.round(ix, iy + 1, 9, 7, 10, 78), INK, 1, true);
        d.dot(ix + 12, iy - 6, 2.4);
        d.dot(ix - 12, iy + 7, 2);
        d.dot(ix + 9, iy + 10, 1.6);
      } else {
        // Loot: a tied sack.
        d.body([ix - 10, iy + 12, ix - 11, iy, ix - 4, iy - 7, ix + 4, iy - 7, ix + 11, iy, ix + 10, iy + 12], { wash: 0xc9a36b, washAlpha: 0.85, weight: FORM, seed: 79 });
        d.line(ix - 5, iy - 7, ix + 5, iy - 7, CONTOUR, 80);
        d.line(ix - 2, iy - 7, ix - 5, iy - 13, FORM, 81);
        d.line(ix + 2, iy - 7, ix + 5, iy - 13, FORM, 82);
      }
      d.text(s, x + 38, y + 38, { size: 28 });
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

// ---------------------------------------------------------------- the scene

export function mockupScene(name: string): Scene {
  const k = TAKES[name] ?? (TAKES.A as Take);
  const random = rng(4242);
  // The mite swarm in the far pocket, and the few at the unguarded chest.
  const mitesAt: [number, number][] = [];
  for (let i = 0; i < 26; i++) {
    const a = random() * Math.PI * 2;
    const r = 0.8 + random() * 2.6;
    mitesAt.push([55.4 + Math.cos(a) * r * 1.3, 26.6 + Math.sin(a) * r * 0.75]);
  }
  for (let i = 0; i < 7; i++) mitesAt.push([23.8 + random() * 3, 5.4 + random() * 1.6]);
  const lateMites: [number, number][] = [];
  for (let i = 0; i < 10; i++) lateMites.push([47.6 + random() * 3.2, 24.6 + random() * 2.4]);

  return {
    duration: 1,
    draw(d: Draw, t: number): void {
      const L = getLand();
      const out = k.late ? LATE_OUT : OUT;
      const aboardSet = k.late ? ABOARD_LATE : ABOARD_EARLY;
      const monsters = k.late ? LATE_MONSTERS : MONSTERS;
      const tags: Tag[] = [];
      const heads: number[] = [];
      const numberBoxes: number[] = [];

      // ---- Ground.
      groundSpace(d);
      for (const p of L.patches) {
        const pts: number[] = [];
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          const reach = p.r * (0.72 + 0.34 * noise1(i * 0.7 + p.seed, p.seed) + 0.14 * noise1(i * 2.3, p.seed + 1));
          pts.push(p.x + Math.cos(a) * reach * 1.45, p.y + Math.sin(a) * reach * 0.8);
        }
        d.wash(pts, p.rgb, p.alpha, true);
      }
      // The river.
      const n = L.river.length / 2;
      for (let i = 0; i + 4 < n; i += 4) {
        const quad: number[] = [];
        for (let j = i; j <= i + 4; j++) quad.push(L.left[j * 2] as number, L.left[j * 2 + 1] as number);
        for (let j = i + 4; j >= i; j--) quad.push(L.right[j * 2] as number, L.right[j * 2 + 1] as number);
        d.fill(quad, d.ground, 1);
        d.fill(quad, WATER, 0.7);
        const deep: number[] = [];
        for (let j = i; j <= i + 4; j++)
          deep.push(lerp(L.left[j * 2] as number, L.right[j * 2] as number, 0.3), lerp(L.left[j * 2 + 1] as number, L.right[j * 2 + 1] as number, 0.3));
        for (let j = i + 4; j >= i; j--)
          deep.push(lerp(L.left[j * 2] as number, L.right[j * 2] as number, 0.9), lerp(L.left[j * 2 + 1] as number, L.right[j * 2 + 1] as number, 0.9));
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
        d.line(x - ty * side - tx * 0.5, y + tx * side - ty * 0.5, x - ty * side + tx * 0.6, y + tx * side + ty * 0.6, HAIR, i + 300);
        d.strength = 1;
      }
      // Stepping stones at the ford.
      for (let j = 0; j < 4; j++)
        d.body(d.round(44.9 + j * 0.5, 17.0 + j * 0.12, 0.22, 0.15 * k.gy * 1.1, 7, j + 5), { wash: STONE, washAlpha: 0.9, weight: FORM, seed: j + 400 });
      // Worn paths.
      for (const path of L.paths) {
        const pn = path.length / 2;
        for (let i = 0; i + 3 < pn; i += 3) {
          const bandPts: number[] = [];
          for (let j = i; j <= i + 3; j++) bandPts.push(path[j * 2] as number, (path[j * 2 + 1] as number) - 0.32);
          for (let j = i + 3; j >= i; j--) bandPts.push(path[j * 2] as number, (path[j * 2 + 1] as number) + 0.32);
          d.fill(bandPts, d.ground, 0.62);
        }
        d.strength = 0.75;
        for (let i = 0; i + 2 < pn; i += 3) {
          const x = path[i * 2] as number;
          const y = path[i * 2 + 1] as number;
          const x1 = path[i * 2 + 4] as number;
          const y1 = path[i * 2 + 5] as number;
          if (hash(i, 96) < 0.75) d.line(x, y - 0.34, lerp(x, x1, 0.7), lerp(y, y1, 0.7) - 0.34, HAIR, i + 500);
          if (hash(i, 97) < 0.75) d.line(lerp(x, x1, 0.2), lerp(y, y1, 0.2) + 0.34, x1, y1 + 0.34, HAIR, i + 600);
          if (hash(i, 98) < 0.25) d.dot(x + 0.2, y + (hash(i, 99) - 0.5) * 0.4, 1.6);
        }
        d.strength = 1;
      }
      for (const c of L.clumps) {
        if (c.kind === 0) {
          for (let b = 0; b < 3; b++) {
            const lean = (b - 1) * 0.09 + (hash(c.seed, b) - 0.5) * 0.06;
            d.line(c.x + b * 0.07, c.y, c.x + b * 0.07 + lean, c.y - (0.2 + hash(c.seed, b + 4) * 0.14) * k.st, FORM, c.seed + b);
          }
        } else if (c.kind === 1) {
          d.dot(c.x, c.y - 0.08, 2.1, FLOWER);
          d.dot(c.x + 0.22, c.y + 0.05, 1.7, FLOWER);
        } else {
          d.curve([c.x - 0.14, c.y, c.x - 0.08, c.y - 0.12 * k.st, c.x + 0.1, c.y - 0.13 * k.st, c.x + 0.16, c.y], FORM, c.seed);
        }
      }

      // Ink on the ground: fresh where fights are on, dry stains where they were.
      const spills: Spill[] = [];
      const spill = (x: number, y: number, dx: number, dy: number, age: number, rank: number, seed: number): void => {
        spills.push({ x, y, dx, dy, age, rank, seed });
      };
      if (!k.late) {
        spill(8.6, 13.4, -0.8, -0.3, 0.5, 1, 11);
        spill(12.6, 16.2, -0.4, 0.8, 1.6, 1, 12);
        spill(18.8, 10.2, 0.6, -0.6, 30, 1, 13);
        spill(16.2, 14.6, 0.3, 0.9, 1.0, 0, 14);
        spill(57.2, 12.0, 0.8, -0.3, 0.7, 1, 21);
        spill(54.2, 15.8, 0.3, 0.9, 14, 1, 22);
        for (let i = 0; i < 9; i++) spill(53.6 + hash(i, 31) * 4, 25.4 + hash(i, 32) * 3, 1, hash(i, 33) - 0.5, 0.3 + i * 1.4, 0, 30 + i);
      } else {
        spill(41.8, 19.8, 0.9, 0.3, 0.5, 1, 41);
        spill(43.4, 21.0, 0.8, 0.5, 6, 1, 42);
        spill(13, 13, 0.4, 0.4, 60, 2, 43);
        spill(54.8, 12.4, 0.4, 0.4, 60, 1, 44);
      }
      // Old stains from earlier along the paths.
      spill(20.2, 18.8, -0.6, 0.4, 80, 1, 51);
      spill(36.2, 21.4, 0.5, 0.6, 90, 0, 52);
      spill(47.6, 16.2, 0.8, -0.2, 70, 1, 53);
      spill(26.6, 24.0, -0.3, 0.8, 120, 2, 54);
      drawSpills(d, spills, spills.length);
      d.pop();

      // ---- Shadows under what stands (take B on).
      groundSpace(d);
      for (const m of L.masses) {
        if (!k.shadows) break;
        const pts: number[] = [];
        const b = m.base;
        for (let i = 0; i < b.length; i += 2) pts.push((b[i] as number) + 0.4, (b[i + 1] as number) + 0.1);
        for (let i = b.length - 2; i >= 0; i -= 2) pts.push((b[i] as number) + 0.4 + m.height * 0.55, (b[i + 1] as number) + 0.1 + m.height * 0.32);
        d.wash(pts, SHADOW, 0.18, true);
      }
      for (const [x, y, kind, size] of THINGS) {
        const h = kind <= 4 ? size * 1.0 : kind === 7 ? size * 0.9 : size * 0.6;
        const w = kind <= 4 ? size * 0.6 : size * 1.1;
        castShadow(d, k, x, y, h, w);
      }
      for (const den of DENS) castShadow(d, k, den.x, den.y, 1.8, 4.4);
      castShadow(d, k, SCRAP.x, SCRAP.y, 1.2, 3);
      for (const c of out) castShadow(d, k, c.x, c.y, S, 0.5);
      for (const m of monsters) castShadow(d, k, m.x, m.y, m.kind === "hound" ? 0.7 : 1.9, m.kind === "hound" ? 1.6 : 2.4);
      if (k.shadows && !k.cityTop) {
        // The hull's shadow, long to the lower right.
        const pts: number[] = [];
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          pts.push(CITY.x + 2.2 + Math.cos(a) * 7.2, CITY.y + 0.5 + Math.sin(a) * 0.9);
        }
        d.wash(pts, SHADOW, 0.12, true);
      }
      // The elite's mark: a ring of the blow's colour round its feet.
      if (!k.late) {
        const elite = MONSTERS[0] as Mon;
        d.hatch(d.round(elite.x + 0.1, elite.y + 0.05, 1.9, 0.7 * k.gy, 14), 2, BLOW, 0.9, true, 1.8);
        d.curve(d.round(elite.x + 0.1, elite.y + 0.05, 1.9, 0.7 * k.gy, 14).slice(), FORM, 991, true);
      }
      d.pop();

      // ---- Swings, under the bodies that made them.
      standSpace(d, k);
      const swingOf = (c: Cit, angle: number, age: number): void => {
        const look = crowd[c.i] as Look;
        drawSwing(d, c.x, c.y / k.st - 0.5, 1.6, angle, 2.2, age, look.cloak, c.i * 17);
      };
      if (!k.late) {
        swingOf(OUT[0] as Cit, Math.PI + 0.25, 0.05);
        swingOf(OUT[1] as Cit, Math.PI - 0.1, 0.06);
        swingOf(OUT[4] as Cit, 0.0, 0.06);
        swingOf(OUT[8] as Cit, 0.1, 0.06);
      } else {
        swingOf(LATE_OUT[4] as Cit, 0.1, 0.08);
      }
      d.pop();

      // ---- Everything that stands, sorted by its feet.
      const items: Item[] = [];
      for (const m of L.masses) {
        const y = (m.base[1] as number) + 0.01;
        items.push({
          y,
          draw: () => {
            // A mass is drawn in stand space with its foot where the ground has it.
            standSpace(d, k);
            const scaled: Mass = MASS_CACHE.get(m)?.get(k.st) ?? scaleMass(m, k.st);
            drawMass(d, scaled);
            d.pop();
          },
        });
      }
      for (const [x, y, kind, size] of THINGS) {
        items.push({
          y,
          draw: () => {
            standSpace(d, k);
            d.move(x, y / k.st);
            drawThingAt(d, kind, size, Math.round(x * 31 + y * 7));
            d.pop();
          },
        });
      }
      for (const den of DENS)
        items.push({
          y: den.y,
          draw: () => {
            standSpace(d, k);
            d.move(den.x, den.y / k.st);
            drawDen(d, k, den.level * 13);
            d.pop();
          },
        });
      items.push({
        y: SCRAP.y,
        draw: () => {
          standSpace(d, k);
          d.move(SCRAP.x, SCRAP.y / k.st);
          drawScrapHeap(d, 990);
          d.pop();
        },
      });
      // The city.
      items.push({
        y: CITY.y,
        draw: () => {
          if (k.cityTop) {
            drawCityTop(d, k, t, tags, heads);
            return;
          }
          const names: NonNullable<CityState["names"]> = [];
          d.push();
          d.move(px(CITY.x), py(CITY.y));
          d.scale(T / 100, (T * k.st) / 100);
          drawCity(d, {
            t,
            gait: 0.1,
            walk: 0,
            settle: 0.55,
            ramp: 1,
            crowd,
            aboard: (i) => aboardSet.has(i),
            names,
          });
          d.pop();
          for (const nm of names) {
            tags.push({ x: nm.x, y: nm.y + 10, name: nm.name, rgb: nm.rgb ?? INK });
            heads.push(nm.x - 12, nm.y + 10, nm.x + 12, nm.y + 34);
          }
        },
      });
      // Citizens out.
      for (const c of out) {
        const look = crowd[c.i] as Look;
        items.push({
          y: c.y,
          draw: () => {
            if (c.outline) return;
            standSpace(d, k);
            const p = citizenPose(c, look, t);
            drawCitizen(d, look, p, c.x, c.y / k.st, S, detailFor(S * T));
            if (c.pennant) {
              // The unique on its bundle: a pennant in the unique's colour.
              const bx = c.x + 0.45 * c.face;
              const by = c.y / k.st - S * 0.95;
              d.line(bx, by + 0.2, bx + 0.08 * c.face, by - 0.5, FORM, 77);
              d.body([bx + 0.08 * c.face, by - 0.5, bx + 0.6 * c.face, by - 0.38, bx + 0.07 * c.face, by - 0.22], {
                smooth: false,
                wash: RARITY[3],
                washAlpha: 1,
                weight: FORM,
                seed: 78,
              });
            }
            d.pop();
          },
        });
      }
      // Monsters.
      for (const [idx, m] of monsters.entries()) {
        items.push({
          y: m.y,
          draw: () => {
            standSpace(d, k);
            const p = beastPose({
              face: m.face,
              stride: (idx * 0.37 + t * 0.5) % 1,
              speed: m.act === "run" ? 1 : m.act === "idle" ? 0 : 0.3,
              coil: m.act === "coil" ? 0.8 : 0,
              lunge: m.act === "lunge" ? 0.9 : 0,
              hurt: m.kind === "elite" ? 0.45 : m.act === "hurt" || m.act === "flash" ? 0.8 : 0,
              flash: m.act === "flash",
              stretch: m.act === "flash" ? 0.86 : m.act === "hurt" ? 0.9 : 1,
              ink: m.act === "hurt" ? 0.5 : 1,
            });
            if (m.kind === "hound") drawHound(d, m.x, m.y / k.st, 0.92, p, m.build, idx * 11 + 3);
            else drawBrute(d, m.x, m.y / k.st, m.kind === "elite" ? 2.8 : 2.2, p, idx * 11 + 3);
            d.pop();
          },
        });
      }
      // Mites, as one drawing at their mean depth.
      const mitesNow = k.late ? lateMites : mitesAt;
      items.push({
        y: k.late ? 25.5 : 26.4,
        draw: () => {
          standSpace(d, k);
          const mites: Mite[] = mitesNow.map(([x, y], i) => ({
            x,
            y: y / k.st,
            face: x < (k.late ? 46 : 55.4) ? 1 : -1,
            phase: t * 3 + i * 0.37,
            stretch: 1 + (i % 3) * 0.05,
            flash: !k.late && i === 3,
            seed: i,
          }));
          // In take D the swarm runs toward the ramp, the other way.
          if (k.late) for (const m of mites) m.face = -1;
          drawSwarm(d, mites, mites.length, 0.85);
          d.pop();
        },
      });
      items.sort((a, b) => a.y - b.y);
      for (const item of items) item.draw();

      // The citizen behind the hull, as an outline over it.
      for (const c of out) {
        if (!c.outline) continue;
        const look = crowd[c.i] as Look;
        standSpace(d, k);
        const p = citizenPose(c, look, t);
        p.flash = true;
        drawCitizen(d, look, p, c.x, c.y / k.st, S, detailFor(S * T));
        d.pop();
      }

      // ---- Tag anchors and heads for every citizen out.
      for (const c of out) {
        const look = crowd[c.i] as Look;
        const fx = px(c.x);
        const fy = py(c.y);
        const h = S * T * k.st;
        tags.push({ x: fx, y: fy - h * HAT_TOP * 0.82 - (c.pennant ? 12 : 0), name: look.name, rgb: look.cloak });
        heads.push(fx - 0.42 * S * T, fy - h * 1.05, fx + 0.42 * S * T, fy - h * 0.45);
      }

      // ---- What is in the air, and where blows land.
      standSpace(d, k);
      const sy = (y: number): number => y / k.st;
      const number = (x: number, y: number, dx: number, dy: number, age: number, value: number, crit: boolean, kill: boolean): void => {
        drawNumber(d, x, sy(y), dx, dy, age, value, crit, kill);
        const rise = 1.3 * (1 - (1 - Math.min(1, age / 0.5)) ** 3);
        const sxp = d.sx(x + dx * rise * 0.8, sy(y) + dy * rise * 0.5 - 1.2 - rise * 0.7);
        const syp = d.sy(x + dx * rise * 0.8, sy(y) + dy * rise * 0.5 - 1.2 - rise * 0.7);
        const size = crit ? 36 : kill ? 30 : 24;
        const w = measure(crit ? "italic" : "roman", size, String(value));
        numberBoxes.push(sxp - size * 0.3 - 4, syp - size * 0.85, sxp - size * 0.3 + w + 4, syp + 10);
      };
      if (!k.late) {
        // The big hit on the elite.
        drawImpact(d, 15.1, sy(12.1) - 1.3, 0.03, 1.1, 1);
        number(15.6, 11.0, 0.4, -0.5, 0.3, 1284, true, false);
        // pixelwitch on a hound, the hound at the chest, the mites.
        drawImpact(d, 9.8, sy(14.3) - 0.5, 0.06, 0.8, 2);
        number(9.0, 14.6, -0.4, 0.2, 0.36, 212, false, false);
        drawImpact(d, 55.6, sy(13.2) - 0.5, 0.04, 0.8, 3);
        number(57.0, 13.0, 0.5, -0.2, 0.2, 96, false, false);
        drawImpact(d, 54.5, sy(27.3) - 0.3, 0.03, 0.5, 4);
        number(56.4, 28.2, 0.6, 0.1, 0.36, 47, false, true);
        number(58.2, 25.4, 0.2, -0.2, 0.5, 38, false, true);
        // goofguy's arrows at the elite, NotABot_'s stone at a guard, goofguy_'s pot at the swarm.
        drawArrow(d, 18.6, sy(11.6), -0.98, 0.16, 1.2, 5);
        drawArrow(d, 20.0, sy(11.1), -0.98, 0.18, 1.0, 6);
        drawStone(d, 53.0, sy(14.6), 1.4);
        drawPot(d, 52.6, sy(24.9), 0.96, 0.28, 1.8, t, 7);
        // Drops: a rare by the den, a magic ring by the chest.
        drawDrop(d, 13.4, sy(16.6), 13.4, sy(16.6), 2, 2, 1, 61, t);
        drawDrop(d, 52.2, sy(13.0), 52.2, sy(13.0), 2, 1, 1, 62, t);
      } else {
        drawImpact(d, 42.4, sy(20.4) - 0.4, 0.04, 0.8, 8);
        number(42.6, 20.2, 0.5, -0.2, 0.3, 188, false, false);
      }
      d.pop();

      // ---- Den labels.
      const labels: number[] = [];
      if (!k.late)
        for (const den of DENS) {
          const s = `den ${den.level}`;
          const lx = px(den.x);
          const ly = py(den.y) + (k.st === 1 ? 52 : 30);
          const w = measure("roman", 26, s);
          d.text(s, lx, ly, { size: 26, align: 0.5, halo: 1 });
          labels.push(lx - w / 2 - 4, ly - 22, lx + w / 2 + 4, ly + 6);
        }

      // ---- The black at the edges.
      if (!k.late) {
        drawBlack(d, band("e", FRAME.y0 - 20, FRAME.y1 + 20, 78, 7, true), t, 7);
        drawBlack(d, band("n", 620, 1560, 58, 17), t, 17);
        drawBlack(d, band("s", 100, 1000, 62, 27), t, 27);
        drawBlack(d, band("w", 600, FRAME.y1 + 20, 52, 37), t, 37);
      } else {
        drawBlack(d, ringStations(px(CITY.x + 3), py(CITY.y - 1.2), 24.5 * T, 13.4 * T, 47), t, 47);
      }

      // ---- Corners, then tags clear of everything.
      const taken = drawCorners(d, k.late);
      placeTags(d, tags, [...taken, ...labels, ...numberBoxes, ...heads]);
      drawFrameRule(d);
    },
  };
}

/** Masses with their foot points moved into stand space, once per lean. */
const MASS_CACHE = new Map<Mass, Map<number, Mass>>();
function scaleMass(m: Mass, st: number): Mass {
  const base = m.base.map((v, i) => (i % 2 ? v / st : v));
  const scaled: Mass = { ...m, base };
  let byLean = MASS_CACHE.get(m);
  if (!byLean) {
    byLean = new Map();
    MASS_CACHE.set(m, byLean);
  }
  byLean.set(st, scaled);
  return scaled;
}

export const MOCKUP_TAKES = Object.keys(TAKES);
