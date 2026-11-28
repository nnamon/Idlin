// The city from above (docs/art.md, section 7): one machine on eight
// splayed legs, seen from the south and above by the lean of section 4, with
// its deck open to the viewer. The same drawing at every size: in transit at
// 66 px a tile with the walls up and the furniture in full, on a landing at
// 30 or 23 px with the walls dropped and each room down to its largest piece.
//
// Hull-local units are tiles from the middle of the hull: x along it, stern
// at -7.5 and prow at +7.6; y across it, negative on the far side; z up from
// the ground. A flat shape is drawn at BACK of its depth and a height at UP.

import { type Act, GAIT_SECONDS, poseAt, type Spot, SWING } from "./city.ts";
import { BLOW, CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER, shade } from "./draw.ts";
import { detailFor, drawCitizen, type Look, type Pose } from "./figure.ts";
import { clamp, easeInOut, hash, lerp, mix, ring, smooth } from "./geom.ts";
import { BACK, OXIDE, SHADOW, UP } from "./stage.ts";

export const TIMBER = 0xc9a36b;
export const CANVAS = 0xe7dcc0;
export const IRON = 0x5b5048;
export const BRASS = 0xd2a24c;
export const LAMP = 0xf6cf6a;
const LAND = 0xa9b4b0;

/** The deck's outline, hull-local: 15 tiles by 6, pointed at the prow, blunt at the stern. */
export const HULL = [
  -7.5, 0, -7.2, -2.2, -6.2, -2.9, 3.8, -3.0, 6.4, -1.8, 7.6, 0, 6.4, 1.8, 3.8, 3.0, -6.2, 2.9,
  -7.2, 2.2,
];
const NEAR_SIDE: readonly (readonly [number, number])[] = [
  [-7.5, 0],
  [-7.2, 2.2],
  [-6.2, 2.9],
  [3.8, 3.0],
  [6.4, 1.8],
  [7.6, 0],
];
/** How deep the hull's side is below the deck, in tiles. */
export const HULL_DEEP = 1.25;
/** The belly's height off the ground walking and parked. */
export const BELLY_WALK = 0.9;
export const BELLY_PARKED = 0.5;
export const MAST_HIGH = 3.5;
export const MAST_AT = { x: 0.2, y: 0 } as const;
/** The crow's nest stands low enough that the lookout's hat is under the lantern at the mast's head. */
export const NEST_HIGH = 1.85;

/** The lantern at the mast's head on screen, for keeping tags off it. */
export function lanternAt(c: {
  ox: number;
  oy: number;
  T: number;
  t: number;
  gait: number;
  walk: number;
  settle: number;
}): [number, number] {
  const ride = hullRide(c.t, c.gait, c.walk, c.settle);
  const H = ride.belly + HULL_DEEP;
  return [
    c.ox + MAST_AT.x * c.T + ride.sway * 0.4 * c.T,
    c.oy - (H + MAST_HIGH) * UP * c.T + 0.1 * c.T,
  ];
}

/** The mast's stays on screen as segments (x0, y0, x1, y1, …), which no tag's leader may cross. */
export function stayLines(c: {
  ox: number;
  oy: number;
  T: number;
  t: number;
  gait: number;
  walk: number;
  settle: number;
}): number[] {
  const ride = hullRide(c.t, c.gait, c.walk, c.settle);
  const H = ride.belly + HULL_DEEP;
  const P = (x: number, y: number, z: number): [number, number] => [
    c.ox + x * c.T,
    c.oy + y * BACK * c.T - z * UP * c.T,
  ];
  const m1 = P(MAST_AT.x, 0, H + MAST_HIGH);
  const out: number[] = [];
  for (const [x, y] of STAY_FEET) out.push(m1[0], m1[1] + 0.55 * c.T, ...P(x, y, H + 0.28));
  return out;
}

const STAY_FEET = [
  [-6.2, -2.8],
  [3.8, -2.9],
  [-6.2, 2.8],
  [3.8, 2.9],
] as const;

/** Half the hull's width at `x` along it. */
export function halfWidth(x: number): number {
  for (let i = 0; i + 1 < NEAR_SIDE.length; i++) {
    const [x0, y0] = NEAR_SIDE[i] as readonly [number, number];
    const [x1, y1] = NEAR_SIDE[i + 1] as readonly [number, number];
    if (x >= x0 && x <= x1) return lerp(y0, y1, (x - x0) / (x1 - x0 || 1));
  }
  return 0;
}

// ---------------------------------------------------------------- the gait

interface LegDef {
  readonly x: number;
  readonly side: 1 | -1;
  readonly phase: number;
  /** How far across from the hull's middle line its foot comes down, in tiles. */
  readonly reach: number;
}

/**
 * Four legs a side; the phases keep at least five feet on the ground. Feet
 * come down seven tiles across from the hull's middle line. The two middle
 * legs on the far side reach further, as a spider's middle legs do, so that
 * their feet stand clear above the far walls and the stack in the close-up
 * instead of behind them.
 */
export const LEGS: readonly LegDef[] = [
  { x: -5.4, side: 1, phase: 0, reach: 7 },
  { x: -2.2, side: 1, phase: 0.5, reach: 7 },
  { x: 1.4, side: 1, phase: 0.25, reach: 7 },
  { x: 4.4, side: 1, phase: 0.75, reach: 7 },
  { x: -5.4, side: -1, phase: 0.625, reach: 7 },
  { x: -2.2, side: -1, phase: 0.125, reach: 9.2 },
  { x: 1.4, side: -1, phase: 0.875, reach: 9.2 },
  { x: 4.4, side: -1, phase: 0.375, reach: 7 },
];

/** How far a foot travels in a step, in tiles, and the city's walking speed in tiles a second. */
export const STEP_TILES = 1.7;
export const WALK_SPEED = STEP_TILES / (GAIT_SECONDS * (1 - SWING));

export interface Foot {
  /** Hull-local, on the ground (y before BACK). */
  x: number;
  y: number;
  lift: number;
  /** Seconds since it came down; 99 while it is in the air. */
  planted: number;
}

/**
 * Where a leg's foot is. `gait` counts gait cycles walked; `walk` is 1 while
 * walking and falls to 0 as the city halts; `settle` 0 to 1 is the parking,
 * in which each leg takes one short step outward.
 */
export function footAt(leg: LegDef, gait: number, walk: number, settle: number): Foot {
  const out = Math.sign(leg.x) || 1;
  const rx = leg.x * 1.6 + out * 2.0;
  const ry = leg.side * leg.reach;
  const u = (((gait + leg.phase) % 1) + 1) % 1;
  let dx: number;
  let lift = 0;
  let planted = 99;
  if (u < SWING) {
    const k = u / SWING;
    dx = lerp(-STEP_TILES / 2, STEP_TILES / 2, easeInOut(k));
    lift = Math.sin(Math.PI * k) ** 0.8 * 0.55;
  } else {
    const k = (u - SWING) / (1 - SWING);
    dx = lerp(STEP_TILES / 2, -STEP_TILES / 2, k);
    planted = (u - SWING) * GAIT_SECONDS;
  }
  const turn = clamp(settle * 1.6 - leg.phase * 0.6);
  const step = easeInOut(turn);
  const hop = Math.sin(Math.PI * turn) * 0.45;
  return {
    x: rx + dx + out * 0.5 * step,
    y: ry + leg.side * 0.6 * step,
    lift: lift * walk + hop,
    planted:
      walk > 0.5
        ? planted
        : turn > 0 && turn < 1
          ? 99
          : turn >= 1
            ? (settle - (1 + leg.phase * 0.6) / 1.6) * 2.2
            : 99,
  };
}

/** How the hull rides: its belly's height, dipping toward lifted legs, and how hung things swing. */
export function hullRide(
  t: number,
  gait: number,
  walk: number,
  settle: number,
): { belly: number; sway: number } {
  let dip = 0;
  let sway = 0;
  for (const leg of LEGS) {
    const f = footAt(leg, gait, walk, settle);
    dip += (f.lift / 0.55) * (leg.side > 0 ? 0.05 : 0.03);
    sway += ring(f.planted, 5.2, 1.5) * (leg.x > 0 ? 1 : -1) * 0.1;
  }
  const breath = Math.sin(t * 1.3) * 0.015 * settle;
  return { belly: lerp(BELLY_WALK, BELLY_PARKED, easeInOut(settle)) - dip + breath, sway };
}

// ---------------------------------------------------------------- stations

export interface Station extends Spot {
  /** Height above the deck, for the crow's nest. */
  readonly z: number;
}

const st = (x: number, y: number, act: Act, face = 1, range = 0, z = 0): Station => ({
  x,
  y,
  act,
  face,
  range,
  z,
});

/** The fifteen stations, one for each district's work. x and y are hull tiles; range is in hull tiles. */
export const STATIONS: readonly Station[] = [
  st(-6.85, 0.15, "gunner", -1),
  st(-5.0, 1.35, "stoke", -1),
  st(-2.5, -1.25, "smith", -1),
  st(-3.0, -2.0, "bench", 1),
  st(-2.3, 1.55, "sleep", 1),
  st(-0.85, -1.55, "bench", 1),
  st(0.75, -1.75, "bench", -1),
  st(1.25, 1.95, "rail", 1),
  st(-0.6, 0.85, "carry", 1, 0.9),
  st(2.35, -1.25, "cook", 1),
  st(3.6, -0.9, "sit", -1),
  st(2.6, 1.3, "map", 1),
  st(5.0, 0.3, "helm", 1),
  st(6.85, 0.15, "gunner", 1),
  st(MAST_AT.x - 0.05, 0.02, "lookout", 1, 0, NEST_HIGH),
];

/** Which station is which, for the scenes. */
export const STATION = {
  aftGun: 0,
  stoker: 1,
  smith: 2,
  bellows: 3,
  sleeper: 4,
  bench: 5,
  bench2: 6,
  crane: 7,
  carrier: 8,
  cook: 9,
  eater: 10,
  navigator: 11,
  helm: 12,
  foreGun: 13,
  lookout: 14,
} as const;

/** Places on the rail, for citizens shooting outward from it: hull x, y and which way they face. */
export const RAIL_SPOTS: readonly (readonly [number, number, number])[] = [
  [-4.2, -2.75, -1],
  [0.6, 2.75, 1],
  [3.4, -2.75, 1],
  [-1.6, 2.75, -1],
  [6.2, 1.5, 1],
  [-6.6, -2.2, -1],
];

/**
 * Stations for a crowd: two to a deck tile, a tile apart along a row and rows
 * half a tile apart, every other row offset by half a tile, so that no head
 * is behind the body or hat of the one in front. With more than the fifteen
 * aboard, the fifteen stations move to the nearest point of the same lattice
 * and keep their work; the rest fill it from the middle out.
 */
export function crowdStations(count: number): Station[] {
  if (count <= STATIONS.length) return STATIONS.slice(0, count);
  const blocked = (x: number, y: number): boolean =>
    // the mast, the hatch, the boiler, the wheel
    Math.hypot(x - MAST_AT.x, y) < 0.45 ||
    Math.hypot(x - 0.95, y - 1.05) < 0.5 ||
    Math.hypot(x + 5.4, y + 0.6) < 0.8 ||
    Math.hypot(x - 5.6, y) < 0.45;
  const spots: [number, number][] = [];
  for (let row = 0; row < 12; row++) {
    const y = -2.75 + row * 0.5;
    for (let col = 0; col < 16; col++) {
      const x = -7.0 + col + (row % 2 ? 0.5 : 0);
      if (Math.abs(y) > halfWidth(x) - 0.05) continue;
      if (blocked(x, y)) continue;
      spots.push([x, y]);
    }
  }
  const used = new Set<number>();
  const out: Station[] = STATIONS.map((s) => {
    // With a crowd the figures are smaller, so the nest goes higher to keep the lookout's head
    // above those at the far rail; its hat is still under the lantern.
    if (s.z > 0) return { ...s, z: NEST_HIGH + 0.45 };
    let best = -1;
    let bd = Number.POSITIVE_INFINITY;
    spots.forEach(([x, y], k) => {
      const dist = Math.hypot(x - s.x, (y - s.y) * 1.5);
      if (!used.has(k) && dist < bd) {
        bd = dist;
        best = k;
      }
    });
    used.add(best);
    const [x, y] = spots[best] as [number, number];
    return { ...s, x, y, range: 0 };
  });
  // Fill from the middle out, so a smaller crowd stands on the open deck.
  const order = spots
    .map((_, k) => k)
    .sort((a, b) => {
      const [ax, ay] = spots[a] as [number, number];
      const [bx, by] = spots[b] as [number, number];
      return Math.hypot(ax * 0.6, ay) - Math.hypot(bx * 0.6, by);
    });
  for (const k of order) {
    if (out.length >= count) break;
    if (used.has(k)) continue;
    const [x, y] = spots[k] as [number, number];
    // A crowd stands or sits where it is put; nobody paces into the head of the one beside it.
    const r = hash(Math.round(x * 10), Math.round(y * 10), 51);
    out.push(st(x, y, r < 0.3 ? "sit" : "idle", hash(x, y, 53) < 0.5 ? 1 : -1));
  }
  return out.slice(0, count);
}

// ---------------------------------------------------------------- drawing

export interface Crew {
  look: Look;
  station: Station;
  /** In place of the station's own pose, as for one shooting from the rail. */
  pose?: Pose;
}

export interface TopCity {
  /** Where the ground under the middle of the hull is on screen, and pixels a tile. */
  ox: number;
  oy: number;
  T: number;
  t: number;
  gait: number;
  walk: number;
  settle: number;
  /** 0 the ramp folded up against the rail, 1 down on the ground; and which side it is on. */
  ramp: number;
  rampSide: 1 | -1;
  /** 1 the close-up, walls up and furniture in full; 0 a landing. */
  detail: number;
  /** A citizen's height aboard, in pixels. */
  size: number;
  crew: readonly Crew[];
  /** 0 the lantern plain, 1 at full accent. */
  lantern: number;
}

export interface CityDrawn {
  /** Each citizen aboard: feet on screen, height, and who. */
  aboard: { look: Look; x: number; y: number; size: number }[];
  /** The deck and the hull's near side as one outline on screen, for telling who is behind it. */
  hull: number[];
  /** Feet on screen. */
  feet: [number, number][];
}

/** Where the foot of the ramp meets the ground, in tiles from the ground under the hull's middle. */
export function rampFoot(side: 1 | -1): [number, number] {
  return [5.0, side * (halfWidth(5.0) + 3.2) * BACK];
}

/** Where the ramp meets the deck's edge, in tiles from the ground under the hull's middle, and its height. */
export function rampTop(side: 1 | -1): [number, number] {
  return [5.0, side * halfWidth(5.0) * BACK];
}

const ROOMS = {
  engine: [-6.8, -2.3, -3.7, 2.3],
  forge: [-3.5, -2.6, -1.3, -0.2],
  bunks: [-3.5, 0.2, -1.3, 2.6],
  galley: [1.7, -2.65, 4.1, -0.2],
  charts: [1.7, 0.2, 4.1, 2.65],
  wheel: [4.4, -1.3, 6.3, 1.3],
} as const;

export function drawTopCity(d: Draw, c: TopCity): CityDrawn {
  const { T, t } = c;
  const ride = hullRide(t, c.gait, c.walk, c.settle);
  const H = ride.belly + HULL_DEEP;
  const sway = ride.sway;
  const k = clamp(c.detail);
  const px = T / 30;
  const P = (x: number, y: number, z: number): [number, number] => [
    c.ox + x * T,
    c.oy + y * BACK * T - z * UP * T,
  ];
  const poly = (pts: readonly number[], z: number): number[] => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2)
      out.push(...P(pts[i] as number, pts[i + 1] as number, z));
    return out;
  };
  const beam = (a: [number, number], b: [number, number], wa: number, wb: number): number[] => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
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
  const strength = d.strength;
  const drawn: CityDrawn = { aboard: [], hull: [], feet: [] };

  // ---- On the ground: footfalls, the hull's shadow, foot plates.
  const feet = LEGS.map((leg) => footAt(leg, c.gait, c.walk, c.settle));
  feet.forEach((f, i) => {
    if (f.planted > 1.6) return;
    const [fx, fy] = P(f.x, f.y, 0);
    d.push();
    d.move(fx, fy);
    d.scale(T / 100);
    drawFootfallTop(d, f.planted, i * 37 + 5);
    d.pop();
  });
  const shadow: number[] = [];
  for (let i = 0; i < HULL.length; i += 2)
    shadow.push(
      ...P(
        (HULL[i] as number) * 1.04 + 0.5 + H * 0.5,
        (HULL[i + 1] as number) * 1.08 + 0.4 + H * 0.35,
        0,
      ),
    );
  d.wash(shadow, SHADOW, 0.28, true);
  d.hatch(shadow, 1, INK, 0.45, true);
  feet.forEach((f, i) => {
    const [fx, fy] = P(f.x, f.y, 0);
    const lifted = P(f.x, f.y, f.lift);
    d.wash(
      d.round(fx + 0.35 * T, fy + 0.12 * T, 0.42 * T, 0.16 * T, 9, i + 3).slice(),
      SHADOW,
      0.24,
      true,
    );
    drawn.feet.push([lifted[0], lifted[1]]);
  });

  // ---- Legs: the far ones before the hull.
  const leg = (i: number): void => {
    const def = LEGS[i] as LegDef;
    const f = feet[i] as Foot;
    const far = def.side < 0;
    const out = Math.sign(def.x) || 1;
    const hip = P(def.x, def.side * 2.6, H - 0.35);
    const foot = P(f.x, f.y, f.lift);
    const kx = lerp(def.x, f.x, 0.55) + out * 0.25;
    const ky = def.side * (far ? 4.7 : 5.3);
    const kz = H + (far ? 0.85 : 1.75) + f.lift * 0.4;
    const kneeAt = P(kx, ky, kz);
    const wash = far ? 0.55 : 0.88;
    const weight = far ? CONTOUR : HEAVY;
    // A bone of plate: its outline, hatching down the side away from the light (lower right),
    // plate seams across it and rivets along both edges.
    const bone = (
      a: [number, number],
      b: [number, number],
      wa: number,
      wb: number,
      seed: number,
    ): void => {
      d.body(beam(a, b, wa, wb), {
        smooth: false,
        wash: IRON,
        washAlpha: wash,
        weight,
        seed,
      });
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;
      if (nx + ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      // The shade side: from the middle line to the edge facing down and right.
      d.hatch(
        [
          a[0] + nx * wa * 0.15,
          a[1] + ny * wa * 0.15,
          b[0] + nx * wb * 0.15,
          b[1] + ny * wb * 0.15,
          b[0] + nx * wb,
          b[1] + ny * wb,
          a[0] + nx * wa,
          a[1] + ny * wa,
        ],
        far ? 1 : 3,
        INK,
        far ? 0.45 : 0.65,
      );
      if (T < 14) return;
      d.strength = strength * (far ? 0.6 : 1) * smooth(8, 20, T);
      for (const u of [0.3, 0.68]) {
        const cx = lerp(a[0], b[0], u);
        const cy = lerp(a[1], b[1], u);
        const w = lerp(wa, wb, u);
        d.line(cx - nx * w, cy - ny * w, cx + nx * w, cy + ny * w, FORM, seed + Math.round(u * 50));
      }
      if (T >= 40)
        for (let u = 0.1; u < 0.95; u += 0.1) {
          const cx = lerp(a[0], b[0], u);
          const cy = lerp(a[1], b[1], u);
          const w = lerp(wa, wb, u) * 0.62;
          d.dot(cx - nx * w, cy - ny * w, 1.4, PAPER, 0.9);
          d.dot(cx + nx * w, cy + ny * w, 1.4, INK, 0.7);
        }
      d.strength = strength;
    };
    bone(kneeAt, foot, 7 * px, 4 * px, 700 + i * 10);
    bone(hip, kneeAt, 10 * px, 7 * px, 701 + i * 10);
    // The piston at the knee: a cylinder on the upper bone, its rod into the lower one.
    if (T >= 14) {
      const along = (p: [number, number], q: [number, number], u: number): [number, number] => [
        lerp(p[0], q[0], u),
        lerp(p[1], q[1], u),
      ];
      const up = along(hip, kneeAt, 0.42);
      const low = along(kneeAt, foot, 0.32);
      const off = -9 * px;
      const c0: [number, number] = [up[0], up[1] + off * 0.6];
      const c1: [number, number] = along(c0, [low[0], low[1] + off * 0.3], 0.55);
      const r0: [number, number] = [low[0], low[1] + off * 0.3];
      d.strength = strength * (far ? 0.7 : 1);
      d.line(c1[0], c1[1], r0[0], r0[1], CONTOUR, 760 + i);
      d.body(beam(c0, c1, 3.4 * px, 3.4 * px), {
        smooth: false,
        wash: shade(IRON, 0.2),
        washAlpha: 0.95,
        weight: FORM,
        seed: 765 + i,
      });
      d.dot(r0[0], r0[1], Math.max(1.4, 1.6 * px), BRASS);
      d.strength = strength;
    }
    d.body(d.round(kneeAt[0], kneeAt[1], 9 * px, 9 * px, 10), {
      wash: BRASS,
      washAlpha: 0.9,
      weight: CONTOUR,
      seed: 702 + i * 10,
    });
    d.dot(kneeAt[0], kneeAt[1], 2.6 * Math.min(1.6, px));
    // The foot plate, at BACK on the ground.
    d.body(d.round(foot[0], foot[1] + 2 * px, 13 * px, 5.5 * px, 9), {
      wash: IRON,
      washAlpha: 0.85,
      weight: CONTOUR,
      seed: 703 + i * 10,
    });
  };
  for (let i = 0; i < LEGS.length; i++) if ((LEGS[i] as LegDef).side < 0) leg(i);

  // ---- A ramp on the far side comes down behind the hull.
  if (c.rampSide < 0) drawRamp(d, c, P, H, -1);

  // ---- The hull's near side, below the rim.
  const near: number[] = [];
  for (const [x, y] of NEAR_SIDE) near.push(...P(x, y, H));
  for (let i = NEAR_SIDE.length - 1; i >= 0; i--) {
    const [x, y] = NEAR_SIDE[i] as readonly [number, number];
    near.push(...P(x * 0.97, y * 0.9, H - HULL_DEEP));
  }
  d.body(near, { smooth: false, wash: IRON, washAlpha: 0.9, weight: HEAVY, seed: 801 });
  d.hatch(near, 2, INK, 0.6);
  // Spot black where the plate turns under.
  const under: number[] = [];
  for (let i = NEAR_SIDE.length - 1; i >= 0; i--) {
    const [x, y] = NEAR_SIDE[i] as readonly [number, number];
    under.push(...P(x * 0.97, y * 0.9, H - HULL_DEEP));
  }
  for (const [x, y] of NEAR_SIDE) under.push(...P(x * 0.975, y * 0.93, H - HULL_DEEP + 0.28));
  d.fill(under, INK, 0.95);
  // The oxide strake under the rim, and rivets.
  const strake: number[] = [];
  for (const [x, y] of NEAR_SIDE) strake.push(...P(x, y, H));
  for (let i = NEAR_SIDE.length - 1; i >= 0; i--) {
    const [x, y] = NEAR_SIDE[i] as readonly [number, number];
    strake.push(...P(x * 0.995, y * 0.985, H - 0.3));
  }
  d.fill(strake, OXIDE, 0.9);
  d.path(strake, FORM, 802, true);
  d.strength = strength * smooth(0.15, 0.6, T / 66);
  for (let x = -6.6; x <= 6; x += 0.55) {
    const yy = halfWidth(x) * 0.97;
    const [rx, ry] = P(x, yy, H - 0.62);
    d.dot(rx, ry, 1.6, PAPER, 0.85);
    if (k > 0.5) {
      const [qx, qy] = P(x + 0.27, yy, H - 0.95);
      d.dot(qx, qy, 1.3, PAPER, 0.6);
    }
  }
  // Portholes with lamplight behind them, below the engine room and the galley.
  for (const x of [-5.9, -5.1, -4.3, 2.2, 3.0]) {
    const yy = halfWidth(x) * 0.95;
    const [px, py] = P(x, yy, H - 0.72);
    const r = Math.max(2.2, 0.15 * T);
    d.body(d.round(px, py, r, r * 1.1, 9), {
      wash: LAMP,
      washAlpha: 0.85,
      weight: FORM,
      seed: 806 + Math.round(x * 10),
    });
    d.curve(d.round(px, py, r * 1.35, r * 1.45, 10).slice(), FORM, 807 + Math.round(x * 10), true);
  }
  // Plate seams down the side.
  for (let x = -5.6; x < 6; x += 1.8) {
    const yy = halfWidth(x);
    const [ax, ay] = P(x, yy, H - 0.3);
    const [bx, by] = P(x * 0.97, yy * 0.9, H - HULL_DEEP + 0.28);
    d.line(ax, ay, bx, by, FORM, 803 + Math.round(x * 3));
  }
  d.strength = strength;

  // ---- The deck: planking, the rim, then everything aboard sorted by its feet.
  const deck = poly(HULL, H);
  d.body(deck, { smooth: false, wash: TIMBER, washAlpha: 0.72, weight: HEAVY, seed: 803 });
  const inner: number[] = [];
  for (let i = 0; i < HULL.length; i += 2)
    inner.push(...P((HULL[i] as number) * 0.96, (HULL[i + 1] as number) * 0.88, H));
  d.path(inner, FORM, 804, true);
  // Planks run along the hull, with butt joints staggered.
  d.strength = strength * 0.55;
  for (let y = -2.55; y <= 2.56; y += 0.42) {
    const reach = Math.max(0, 7.2 - Math.abs(y) * 0.45);
    let x0 = -reach;
    while (x0 < reach) {
      const len = 1.6 + hash(Math.round(y * 10), Math.round(x0 * 10), 9) * 2.2;
      const x1 = Math.min(reach, x0 + len);
      const [ax, ay] = P(x0, y, H);
      const [bx, by] = P(x1 - 0.06, y, H);
      if (Math.abs(y) < halfWidth((x0 + x1) / 2) - 0.12)
        d.line(ax, ay, bx, by, HAIR, 805 + Math.round((y + x0) * 10));
      x0 = x1;
    }
  }
  d.strength = strength;

  interface Item {
    y: number;
    draw: () => void;
  }
  const items: Item[] = [];
  const wallH = lerp(0.35, 0.9, k);
  const floor = (box: readonly number[], rgb: number, alpha: number): void => {
    const [x0, y0, x1, y1] = box as [number, number, number, number];
    const f = poly([x0, y0, x1, y0, x1, y1, x0, y1], H);
    d.fill(f, d.ground, 1);
    d.wash(f, rgb, alpha);
  };
  floor(ROOMS.engine, 0xb8ad9a, 0.7);
  floor(ROOMS.forge, mix(OXIDE, PAPER, 0.45), 0.75);
  floor(ROOMS.bunks, CANVAS, 0.85);
  floor(ROOMS.galley, mix(BRASS, PAPER, 0.35), 0.7);
  floor(ROOMS.charts, LAND, 0.6);
  floor(ROOMS.wheel, shade(TIMBER, 0.12), 0.8);
  // Lamplight on the floors round the fires and the lamps, in three flat steps.
  for (const [lx, ly, r] of [
    [-2.55, -2.1, 1.0],
    [2.4, -1.9, 0.9],
    [2.9, 1.65, 0.85],
    [-5.0, 0.2, 0.9],
    [-2.4, 1.4, 0.8],
    [5.3, -0.6, 0.75],
  ] as const) {
    const [cx, cy] = P(lx, ly, H);
    for (const [k, a] of [
      [1, 0.22],
      [0.66, 0.26],
      [0.36, 0.32],
    ] as const)
      d.wash(
        d.round(cx, cy, r * k * T, r * k * BACK * T, 12, Math.round(lx * 7 + k * 10)).slice(),
        0xf3d9a0,
        a,
        true,
      );
  }
  // Brick in the forge, grating in the engine room: the floors differ as well as their washes.
  d.strength = strength * (0.35 + 0.4 * k);
  for (let gx = -6.6; gx < -3.8; gx += 0.36) {
    const [ax, ay] = P(gx, -2.2, H);
    const [bx, by] = P(gx, 2.2, H);
    d.line(ax, ay, bx, by, HAIR, 840 + Math.round(gx * 10));
  }
  for (let by0 = -2.5; by0 < -0.3; by0 += 0.3)
    for (let bx0 = -3.4 + (Math.round(by0 * 10) % 2 ? 0.2 : 0); bx0 < -1.4; bx0 += 0.42) {
      const [ax, ay] = P(bx0, by0, H);
      const [cx, cy] = P(bx0 + 0.36, by0, H);
      d.line(ax, ay, cx, cy, HAIR, 860 + Math.round((bx0 + by0) * 30));
    }
  d.strength = strength;

  // Walls: a far wall stands up with what hangs on it, side walls are low, the near wall is a sill.
  const wall = (
    box: readonly number[],
    key: number,
    hung: (() => void) | null,
    open = false,
  ): void => {
    const [x0, y0, x1, y1] = box as [number, number, number, number];
    const farH = open ? Math.min(wallH, 0.35) : wallH;
    items.push({
      y: y0 - 0.01,
      draw: () => {
        const a = P(x0, y0, H);
        const b = P(x1, y0, H);
        const at = P(x1, y0, H + farH);
        const bt = P(x0, y0, H + farH);
        if (!open) {
          d.body([a[0], a[1], b[0], b[1], at[0], at[1], bt[0], bt[1]], {
            smooth: false,
            wash: TIMBER,
            washAlpha: 0.85,
            weight: CONTOUR,
            seed: key,
          });
          d.hatch(
            [
              a[0],
              a[1],
              b[0],
              b[1],
              at[0],
              at[1] + (a[1] - bt[1]) * 0.55,
              bt[0],
              bt[1] + (a[1] - bt[1]) * 0.55,
            ],
            1,
            INK,
            0.45,
          );
          // Its top, a board's thickness seen from above, and the boards it is built of.
          const cap = [
            bt[0],
            bt[1],
            at[0],
            at[1],
            at[0],
            at[1] - 0.1 * BACK * T,
            bt[0],
            bt[1] - 0.1 * BACK * T,
          ];
          d.body(cap, {
            smooth: false,
            wash: shade(TIMBER, 0.2),
            washAlpha: 0.9,
            weight: FORM,
            seed: key + 7,
          });
          d.strength = strength * fine * 0.6;
          for (let u = 0.25; u < 1; u += 0.25)
            d.line(
              a[0],
              lerp(a[1], bt[1], u),
              b[0],
              lerp(b[1], at[1], u),
              HAIR,
              key + 8 + Math.round(u * 8),
            );
          d.strength = strength;
        }
        if (hung) hung();
        // Side walls: low.
        for (const x of [x0, x1]) {
          const s0 = P(x, y0, H + 0.35);
          const s1 = P(x, y1, H + 0.35);
          const s2 = P(x, y1, H);
          const s3 = P(x, y0, H);
          d.body([s0[0], s0[1], s1[0], s1[1], s2[0], s2[1], s3[0], s3[1]], {
            smooth: false,
            wash: shade(TIMBER, 0.15),
            washAlpha: 0.8,
            weight: FORM,
            seed: key + (x === x0 ? 1 : 2),
          });
        }
      },
    });
    items.push({
      y: y1 + 0.01,
      draw: () => {
        const a = P(x0, y1, H);
        const b = P(x1, y1, H);
        const at = P(x1, y1, H + 0.12);
        const bt = P(x0, y1, H + 0.12);
        d.body([a[0], a[1], b[0], b[1], at[0], at[1], bt[0], bt[1]], {
          smooth: false,
          wash: TIMBER,
          washAlpha: 0.9,
          weight: FORM,
          seed: key + 3,
        });
      },
    });
  };
  const fine = smooth(0.25, 0.8, k);

  // The engine room: pipes and gauges on the far wall, the boiler and its stack, the flywheel.
  wall(ROOMS.engine, 810, () => {
    const [x0, y0, x1] = ROOMS.engine;
    for (let i = 0; i < 3; i++) {
      const z = H + wallH * (0.3 + i * 0.22);
      const a = P(x0 + 0.2, y0, z);
      const b = P(x1 - 0.2, y0, z);
      d.line(a[0], a[1], b[0], b[1], i === 1 ? CONTOUR : FORM, 811 + i);
    }
    d.strength = strength * fine;
    for (let i = 0; i < 3; i++) {
      const [gx, gy] = P(x0 + 0.7 + i * 0.95, y0, H + wallH * 0.72);
      d.body(d.round(gx, gy, 0.16 * T, 0.16 * T, 10), { wash: PAPER, weight: FORM, seed: 815 + i });
      const a = t * 0.6 + i * 2;
      d.line(gx, gy, gx + Math.cos(a) * 0.12 * T, gy + Math.sin(a) * 0.12 * T, FORM, 818 + i);
    }
    const [vx, vy] = P(x1 - 0.5, y0, H + wallH * 0.45);
    d.curve(d.round(vx, vy, 0.2 * T, 0.2 * T, 10).slice(), FORM, 819, true);
    d.line(vx - 0.2 * T, vy, vx + 0.2 * T, vy, FORM, 820);
    d.line(vx, vy - 0.2 * T, vx, vy + 0.2 * T, FORM, 821);
    d.strength = strength;
  });
  items.push({
    y: -0.6,
    draw: () => {
      // The boiler: a drum lying along the hull, brass bands round it.
      const top = H + 0.55;
      const body = [
        ...P(-6.35, -1.3, top),
        ...P(-4.45, -1.3, top),
        ...P(-4.45, 0.05, top),
        ...P(-4.45, 0.05, H),
        ...P(-6.35, 0.05, H),
        ...P(-6.35, 0.05, top),
      ];
      d.body(body, { smooth: false, wash: BRASS, washAlpha: 0.85, weight: CONTOUR, seed: 822 });
      const faceTop = [
        ...P(-6.35, -1.3, top),
        ...P(-4.45, -1.3, top),
        ...P(-4.45, 0.05, top),
        ...P(-6.35, 0.05, top),
      ];
      d.fill(faceTop, mix(BRASS, PAPER, 0.35), 0.9);
      d.path(faceTop, FORM, 823, true);
      d.hatch(
        [
          ...P(-6.35, 0.05, top),
          ...P(-4.45, 0.05, top),
          ...P(-4.45, 0.05, H),
          ...P(-6.35, 0.05, H),
        ],
        2,
        INK,
        0.55,
      );
      d.strength = strength * fine;
      for (const bx of [-5.9, -5.3, -4.8]) {
        const a = P(bx, -1.3, top);
        const b = P(bx, 0.05, top);
        const cc = P(bx, 0.05, H);
        d.line(a[0], a[1], b[0], b[1], FORM, 824 + Math.round(bx * 10));
        d.line(b[0], b[1], cc[0], cc[1], FORM, 825 + Math.round(bx * 10));
      }
      // The firebox's door, glowing.
      const [fx, fy] = P(-5.0, 0.05, H + 0.25);
      d.body(d.box(fx - 0.18 * T, fy - 0.14 * T, fx + 0.18 * T, fy + 0.14 * T), {
        smooth: false,
        spot: true,
      });
      d.dot(fx, fy, Math.max(2, 0.08 * T), 0xe0702c);
      d.strength = strength;
    },
  });
  items.push({
    y: 1.2,
    draw: () => {
      // The flywheel, turning, with its belt to the boiler.
      const [wx, wy] = P(-4.45, 1.25, H + 0.5);
      const r = 0.55 * T;
      d.body(d.round(wx, wy, r * 0.35, r, 14), {
        wash: IRON,
        washAlpha: 0.8,
        weight: CONTOUR,
        seed: 830,
      });
      d.strength = strength * (0.5 + 0.5 * fine);
      for (let i = 0; i < 4; i++) {
        const a = t * 1.8 + (i / 4) * Math.PI;
        d.line(
          wx - Math.cos(a) * r * 0.3,
          wy - Math.sin(a) * r * 0.9,
          wx + Math.cos(a) * r * 0.3,
          wy + Math.sin(a) * r * 0.9,
          FORM,
          831 + i,
        );
      }
      const [bx, by] = P(-5.0, -0.2, H + 0.45);
      d.line(wx, wy - r, bx, by - 0.1 * T, FORM, 835);
      d.line(wx, wy + r * 0.8, bx, by + 0.1 * T, FORM, 836);
      d.strength = strength;
    },
  });

  // The forge: the hood over the hearth on the far wall, tongs and hammers hung, the anvil, the bellows.
  wall(ROOMS.forge, 840, () => {
    const [x0, y0] = ROOMS.forge;
    const hx = x0 + 0.95;
    const a = P(hx - 0.55, y0, H + wallH * 0.55);
    const b = P(hx + 0.55, y0, H + wallH * 0.55);
    const cc = P(hx + 0.22, y0, H + wallH + 0.55 * k + 0.15);
    const dd = P(hx - 0.22, y0, H + wallH + 0.55 * k + 0.15);
    d.body([a[0], a[1], b[0], b[1], cc[0], cc[1], dd[0], dd[1]], {
      smooth: false,
      wash: OXIDE,
      washAlpha: 0.85,
      weight: CONTOUR,
      seed: 841,
    });
    d.hatch([a[0], a[1], b[0], b[1], cc[0], cc[1], dd[0], dd[1]], 2, INK, 0.55);
    // The hearth under it, glowing.
    const [gx, gy] = P(hx, y0 + 0.35, H + 0.2);
    d.body(d.round(gx, gy, 0.5 * T, 0.22 * T, 10), {
      wash: 0x6d5e52,
      washAlpha: 0.9,
      weight: CONTOUR,
      seed: 842,
    });
    d.dot(gx, gy, Math.max(2.5, 0.12 * T), 0xe0702c);
    d.dot(gx + 0.1 * T, gy - 0.03 * T, Math.max(1.5, 0.06 * T), LAMP);
    // The fire: tongues of flame out of the coals, flickering.
    if (T >= 20)
      for (let f = 0; f < 3; f++) {
        const fx = gx + (f - 1) * 0.2 * T;
        const tall = (0.32 + 0.12 * Math.sin(t * 9 + f * 2.1)) * T * (f === 1 ? 1.25 : 1);
        const flame = [
          fx - 0.1 * T,
          gy,
          fx - 0.05 * T,
          gy - tall * 0.5,
          fx + 0.02 * T,
          gy - tall,
          fx + 0.08 * T,
          gy - tall * 0.45,
          fx + 0.1 * T,
          gy,
        ];
        d.fill(flame, 0xe0702c, 0.95, true);
        d.fill(
          flame.map((v, q) => (q % 2 ? gy + (v - gy) * 0.55 : fx + (v - fx) * 0.5)),
          LAMP,
          1,
          true,
        );
        d.curve(flame, HAIR, 848 + f);
      }
    d.strength = strength * fine;
    for (let i = 0; i < 3; i++) {
      const [tx, ty] = P(x0 + 1.75 + i * 0.16, y0, H + wallH * 0.9);
      const swing = Math.sin(t * 1.4 + i) * sway * 0.4;
      d.line(tx, ty, tx + swing * T, ty + 0.38 * T, FORM, 843 + i);
      if (i === 1)
        d.body(
          d.box(tx - 0.07 * T + swing * T, ty + 0.36 * T, tx + 0.09 * T + swing * T, ty + 0.46 * T),
          { smooth: false, spot: true },
        );
    }
    d.strength = strength;
  });
  items.push({
    y: -1.0,
    draw: () => {
      // The anvil on its block: a horn to one side, a flat face, a waist.
      const [ax, ay] = P(-2.0, -0.95, H + 0.42);
      const u = 1.35;
      d.body(d.box(ax - 0.16 * T, ay + 0.26 * T * u, ax + 0.16 * T, ay + 0.5 * T * u), {
        smooth: false,
        wash: TIMBER,
        washAlpha: 0.95,
        weight: FORM,
        seed: 844,
      });
      d.body(
        [
          ax - 0.42 * T * u,
          ay - 0.02 * T * u,
          ax - 0.22 * T * u,
          ay - 0.07 * T * u,
          ax + 0.34 * T * u,
          ay - 0.07 * T * u,
          ax + 0.34 * T * u,
          ay + 0.08 * T * u,
          ax + 0.14 * T * u,
          ay + 0.12 * T * u,
          ax + 0.1 * T * u,
          ay + 0.26 * T * u,
          ax - 0.12 * T * u,
          ay + 0.26 * T * u,
          ax - 0.14 * T * u,
          ay + 0.1 * T * u,
          ax - 0.26 * T * u,
          ay + 0.06 * T * u,
        ],
        { smooth: false, spot: true, seed: 845 },
      );
      d.fill(
        d.box(ax - 0.2 * T * u, ay - 0.06 * T * u, ax + 0.3 * T * u, ay - 0.03 * T * u),
        PAPER,
        0.7,
      );
    },
  });
  items.push({
    y: -1.95,
    draw: () => {
      // The bellows, pumping.
      const pump = 0.5 + 0.5 * Math.sin(t * 3.1);
      const [bx, by] = P(-3.0, -1.75, H + 0.15);
      const w = 0.42 * T;
      const h = (0.1 + 0.12 * pump) * T;
      d.body(
        [
          bx - w,
          by,
          bx - w * 0.2,
          by - h,
          bx + w * 0.7,
          by - h * 0.5,
          bx + w,
          by,
          bx + w * 0.7,
          by + h * 0.5,
          bx - w * 0.2,
          by + h,
        ],
        { smooth: false, wash: 0x8a6a4a, washAlpha: 0.9, weight: CONTOUR, seed: 846 },
      );
      d.strength = strength * fine;
      d.line(bx + w, by, bx + w * 1.6, by - 0.05 * T, FORM, 847);
      d.strength = strength;
    },
  });

  // The bunks: hammocks slung between posts, swinging after each step.
  wall(
    ROOMS.bunks,
    850,
    () => {
      const [x0, y0, x1] = ROOMS.bunks;
      for (const x of [x0 + 0.1, (x0 + x1) / 2, x1 - 0.1]) {
        const a = P(x, y0, H);
        const b = P(x, y0, H + wallH);
        d.line(a[0], a[1], b[0], b[1], CONTOUR, 851 + Math.round(x * 10));
      }
      const l = P(x0 + 0.1, y0, H + wallH);
      const r = P(x1 - 0.1, y0, H + wallH);
      d.line(l[0], l[1], r[0], r[1], FORM, 855);
      // Washing hung on the line between the posts, and a lamp on the middle post.
      d.strength = strength * fine;
      for (let w = 0; w < 4; w++) {
        const u = 0.12 + w * 0.22;
        const hx = lerp(l[0], r[0], u);
        const hy = lerp(l[1], r[1], u);
        const swing = Math.sin(t * 1.2 + w) * 0.03 * T + sway * 0.2 * T;
        const cloth = [
          hx - 0.17 * T,
          hy,
          hx + 0.17 * T,
          hy,
          hx + 0.15 * T + swing,
          hy + 0.36 * T,
          hx - 0.15 * T + swing,
          hy + 0.36 * T,
        ];
        d.body(cloth, {
          smooth: false,
          wash: [CANVAS, 0x9fb4c8, 0xc98a6a, CANVAS][w] as number,
          washAlpha: 0.95,
          weight: FORM,
          seed: 856 + w * 3,
        });
      }
      const [lx, ly] = P((x0 + x1) / 2, y0, H + wallH * 0.7);
      d.wash(d.round(lx, ly, 0.38 * T, 0.32 * T, 10, 3).slice(), LAMP, 0.45, true);
      d.body(d.round(lx, ly, 0.07 * T, 0.09 * T, 7), {
        wash: LAMP,
        washAlpha: 1,
        weight: FORM,
        seed: 870,
      });
      d.strength = strength;
    },
    true,
  );
  for (let i = 0; i < 3; i++) {
    const hy = 0.65 + i * 0.62;
    items.push({
      y: hy - 0.2,
      draw: () => {
        const swing = Math.sin(t * 1.1 + i * 1.7) * 0.06 + sway * 0.4;
        const a = P(-3.35, hy - 0.15, H + 0.55);
        const b = P(-1.45, hy - 0.15, H + 0.55);
        const m = P(-2.4, hy + swing, H + 0.22);
        if (i === 1 && k < 0.5) return;
        d.body(
          [
            a[0],
            a[1],
            m[0] - 0.4 * T,
            m[1] + 0.05 * T,
            m[0] + 0.4 * T,
            m[1] + 0.05 * T,
            b[0],
            b[1],
            m[0] + 0.45 * T,
            m[1] - 0.12 * T,
            m[0] - 0.45 * T,
            m[1] - 0.12 * T,
          ],
          { wash: CANVAS, washAlpha: 0.95, weight: FORM, seed: 856 + i },
        );
        d.strength = strength * fine;
        d.line(a[0], a[1], a[0], a[1] + 0.3 * UP * T, FORM, 859 + i);
        d.line(b[0], b[1], b[0], b[1] + 0.3 * UP * T, FORM, 862 + i);
        d.strength = strength;
      },
    });
  }

  // The galley: shelves of pots on the far wall, the stove with a pot steaming, the table.
  wall(ROOMS.galley, 870, () => {
    const [x0, y0, x1] = ROOMS.galley;
    const a = P(x0 + 1.2, y0, H + wallH * 0.62);
    const b = P(x1 - 0.15, y0, H + wallH * 0.62);
    d.line(a[0], a[1], b[0], b[1], CONTOUR, 871);
    d.strength = strength * fine;
    for (let i = 0; i < 4; i++) {
      const [px0, py0] = P(x0 + 1.4 + i * 0.6, y0, H + wallH * 0.62);
      d.body(d.round(px0, py0 - 0.12 * T, 0.13 * T, 0.11 * T, 8, 872 + i), {
        wash: i % 2 ? BRASS : IRON,
        washAlpha: 0.85,
        weight: FORM,
        seed: 872 + i,
      });
    }
    for (let i = 0; i < 3; i++) {
      const [lx, ly] = P(x0 + 1.55 + i * 0.5, y0, H + wallH * 0.9);
      d.line(lx, ly, lx, ly + 0.28 * T, FORM, 877 + i);
      d.dot(lx, ly + 0.3 * T, Math.max(1.6, 0.05 * T));
    }
    d.strength = strength;
  });
  items.push({
    y: -1.9,
    draw: () => {
      const [gx, gy] = P(2.4, -1.95, H + 0.4);
      d.body(d.box(gx - 0.42 * T, gy - 0.18 * T, gx + 0.42 * T, gy + 0.22 * T), {
        smooth: false,
        wash: 0x6d5e52,
        washAlpha: 0.92,
        weight: CONTOUR,
        seed: 880,
      });
      d.body(d.round(gx + 0.1 * T, gy - 0.18 * T, 0.2 * T, 0.12 * T, 9), {
        wash: IRON,
        washAlpha: 0.9,
        weight: FORM,
        seed: 881,
      });
      d.dot(gx - 0.2 * T, gy + 0.06 * T, Math.max(1.6, 0.06 * T), 0xe0702c);
      // The pot itself: a fat iron belly with a lid and a ladle in it, on the stove's top.
      const [ox0, oy0] = [gx + 0.1 * T, gy - 0.22 * T];
      d.body(
        [
          ox0 - 0.26 * T,
          oy0 - 0.12 * T,
          ox0 + 0.26 * T,
          oy0 - 0.12 * T,
          ox0 + 0.3 * T,
          oy0 + 0.06 * T,
          ox0 + 0.2 * T,
          oy0 + 0.2 * T,
          ox0 - 0.2 * T,
          oy0 + 0.2 * T,
          ox0 - 0.3 * T,
          oy0 + 0.06 * T,
        ],
        { wash: IRON, washAlpha: 0.95, weight: CONTOUR, seed: 883 },
      );
      d.fill(d.round(ox0, oy0 - 0.12 * T, 0.26 * T, 0.08 * T, 10), mix(0xc98a4a, PAPER, 0.2), 1);
      d.line(ox0 + 0.05 * T, oy0 - 0.14 * T, ox0 + 0.3 * T, oy0 - 0.42 * T, FORM, 884);
      // Steam off it, in drawn puffs.
      for (let i = 0; i < 4; i++) {
        const rise = (t * 0.5 + i / 4) % 1;
        const sx = ox0 + Math.sin(rise * 6 + i) * 0.1 * T - rise * 0.25 * T;
        const sy = oy0 - 0.25 * T - rise * 1.0 * T;
        const r = (0.08 + rise * 0.13) * T;
        d.strength = strength * (1 - smooth(0.55, 1, rise));
        d.body(d.round(sx, sy, r, r * 0.8, 8, 882 + i), {
          wash: PAPER,
          washAlpha: 0.9,
          weight: FORM,
          seed: 882 + i,
        });
      }
      d.strength = strength;
    },
  });
  items.push({
    y: -0.75,
    draw: () => {
      const tb = poly([3.05, -1.25, 4.0, -1.25, 4.0, -0.55, 3.05, -0.55], H + 0.3);
      d.body(tb, { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: FORM, seed: 885 });
      d.strength = strength * fine;
      const [bx, by] = P(3.3, -0.9, H + 0.3);
      d.body(d.round(bx, by, 0.12 * T, 0.07 * T, 7), { wash: PAPER, weight: HAIR, seed: 886 });
      d.strength = strength;
    },
  });

  // The chart room: a rack of rolled charts and a pinned map on the far wall, the table, a lamp swinging.
  wall(ROOMS.charts, 890, () => {
    const [x0, y0, x1] = ROOMS.charts;
    const a = P(x0 + 0.25, y0, H + wallH * 0.2);
    const b = P(x0 + 1.25, y0, H + wallH * 0.2);
    const cc = P(x0 + 1.25, y0, H + wallH * 0.95);
    const dd = P(x0 + 0.25, y0, H + wallH * 0.95);
    d.body([a[0], a[1], b[0], b[1], cc[0], cc[1], dd[0], dd[1]], {
      smooth: false,
      wash: PAPER,
      washAlpha: 1,
      weight: FORM,
      seed: 891,
    });
    d.strength = strength * fine;
    d.curve(
      [
        a[0] + 0.15 * T,
        a[1] - 0.15 * T,
        b[0] - 0.3 * T,
        cc[1] + 0.4 * T,
        cc[0] - 0.1 * T,
        cc[1] + 0.2 * T,
      ],
      HAIR,
      892,
    );
    for (let i = 0; i < 5; i++) {
      const [rx, ry] = P(x1 - 1.0 + i * 0.17, y0, H + wallH * 0.75);
      d.body(d.round(rx, ry, 0.06 * T, 0.06 * T, 6), { wash: CANVAS, weight: FORM, seed: 893 + i });
    }
    d.strength = strength;
  });
  items.push({
    y: 1.95,
    draw: () => {
      const ct = poly([2.0, 1.1, 3.75, 1.1, 3.75, 2.2, 2.0, 2.2], H + 0.3);
      d.body(ct, { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: FORM, seed: 900 });
      const mp = poly([2.15, 1.22, 3.55, 1.18, 3.6, 2.08, 2.2, 2.05], H + 0.31);
      d.body(mp, { smooth: false, wash: PAPER, washAlpha: 1, weight: HAIR, seed: 901 });
      d.strength = strength * fine;
      const [mx, my] = P(2.8, 1.6, H + 0.31);
      d.curve(
        [mx - 0.4 * T, my, mx - 0.1 * T, my - 0.15 * T, mx + 0.3 * T, my + 0.05 * T],
        HAIR,
        902,
      );
      d.dot(mx + 0.3 * T, my + 0.05 * T, Math.max(1.3, 0.04 * T), BLOW);
      // The lamp over it, swinging on its chain.
      const swing = Math.sin(t * 1.5) * 0.12 + sway;
      const [hx, hy] = P(2.9, 1.65, H + 1.2);
      const lx = hx + swing * T;
      const ly = hy + 0.35 * T;
      d.line(hx, hy, lx, ly, HAIR, 903);
      d.body(d.round(lx, ly, 0.08 * T, 0.1 * T, 7), {
        wash: LAMP,
        washAlpha: 0.9,
        weight: FORM,
        seed: 904,
      });
      d.strength = strength;
    },
  });

  // The wheelhouse: an arched window frame on the far wall, the wheel turning, the binnacle.
  wall(ROOMS.wheel, 910, () => {
    const [x0, y0, x1] = ROOMS.wheel;
    const a = P(x0 + 0.35, y0, H + wallH * 0.3);
    const b = P(x1 - 0.35, y0, H + wallH * 0.3);
    const top = P((x0 + x1) / 2, y0, H + wallH + 0.25 * k);
    d.curve(
      [a[0], a[1], a[0], top[1] + 0.2 * T, top[0], top[1], b[0], top[1] + 0.2 * T, b[0], b[1]],
      CONTOUR,
      911,
    );
    d.strength = strength * fine;
    d.line(top[0], top[1], top[0], a[1], FORM, 912);
    d.line(a[0], (a[1] + top[1]) / 2 + 0.1 * T, b[0], (a[1] + top[1]) / 2 + 0.1 * T, FORM, 913);
    d.strength = strength;
  });
  items.push({
    y: 0.05,
    draw: () => {
      const [wx, wy] = P(5.65, 0.0, H + 0.45);
      const r = 0.42 * T;
      d.curve(d.round(wx, wy, r * 0.32, r, 12).slice(), CONTOUR, 920, true);
      const turn = Math.sin(t * 0.45) * 0.6;
      for (let i = 0; i < 4; i++) {
        const a = turn + (i / 4) * Math.PI;
        d.line(
          wx - Math.cos(a) * r * 0.42,
          wy - Math.sin(a) * r * 1.25,
          wx + Math.cos(a) * r * 0.42,
          wy + Math.sin(a) * r * 1.25,
          FORM,
          921 + i,
        );
      }
      d.dot(wx, wy, Math.max(2, 0.06 * T));
      const [px0, py0] = P(5.65, 0.0, H);
      d.line(px0, py0, wx, wy + r * 0.6, CONTOUR, 925);
    },
  });

  // Gun posts at either end, the guns turning.
  for (const [gx, dir, key] of [
    [6.85, 1, 930],
    [-6.85, -1, 940],
  ] as const) {
    items.push({
      y: -0.25,
      draw: () => {
        const [cx, cy] = P(gx, 0, H + 0.18);
        d.body(d.round(cx, cy, 0.5 * T, 0.4 * T, 12), {
          wash: IRON,
          washAlpha: 0.8,
          weight: CONTOUR,
          seed: key,
        });
        const aim = dir * (0.25 * Math.sin(t * 0.3 + key)) + (dir < 0 ? Math.PI : 0);
        const ax = Math.cos(aim);
        const ay = Math.sin(aim) * BACK;
        const len = 1.15 * T;
        d.body(
          [
            cx - ay * 0.12 * T,
            cy + ax * 0.12 * T - 0.1 * T,
            cx + ax * len - ay * 0.08 * T,
            cy + ay * len + ax * 0.08 * T - 0.12 * T,
            cx + ax * len + ay * 0.08 * T,
            cy + ay * len - ax * 0.08 * T - 0.12 * T,
            cx + ay * 0.12 * T,
            cy - ax * 0.12 * T - 0.1 * T,
          ],
          { smooth: false, spot: true, seed: key + 1 },
        );
      },
    });
  }

  // The open deck: the bench, the hatch and its crane, stores, the winch.
  items.push({
    y: -1.75,
    draw: () => {
      const bt = poly([-0.55, -2.15, 0.45, -2.15, 0.45, -1.75, -0.55, -1.75], H + 0.35);
      d.body(bt, { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: CONTOUR, seed: 950 });
      d.strength = strength * fine;
      const [vx, vy] = P(-0.3, -1.95, H + 0.35);
      d.body(d.box(vx - 0.12 * T, vy - 0.1 * T, vx + 0.12 * T, vy + 0.04 * T), {
        smooth: false,
        wash: IRON,
        washAlpha: 0.9,
        weight: FORM,
        seed: 951,
      });
      const [sx, sy] = P(0.15, -1.95, H + 0.36);
      d.line(sx - 0.2 * T, sy, sx + 0.25 * T, sy - 0.05 * T, CONTOUR, 952);
      d.strength = strength;
    },
  });
  items.push({
    y: 1.05,
    draw: () => {
      const hatch = poly([0.45, 0.6, 1.5, 0.6, 1.5, 1.5, 0.45, 1.5], H + 0.05);
      d.fill(hatch, INK, 0.9);
      d.path(hatch, CONTOUR, 955, true);
      // The crane: a post, a jib that turns, a crate on its line.
      const [cx, cy] = P(1.55, 0.55, H);
      const top = P(1.55, 0.55, H + 1.5);
      d.line(cx, cy, top[0], top[1], CONTOUR, 956);
      const turn = 0.6 + Math.sin(t * 0.35) * 0.8;
      const jx = top[0] + Math.cos(turn) * 1.1 * T;
      const jy = top[1] + Math.sin(turn) * 0.6 * BACK * T - 0.1 * T;
      d.line(top[0], top[1], jx, jy, CONTOUR, 957);
      const hang = (0.5 + 0.2 * Math.sin(t * 0.9)) * UP * T;
      const swing = sway * T * 0.6;
      d.line(jx, jy, jx + swing, jy + hang, HAIR, 958);
      d.body(d.box(jx + swing - 0.16 * T, jy + hang, jx + swing + 0.16 * T, jy + hang + 0.24 * T), {
        smooth: false,
        wash: TIMBER,
        washAlpha: 0.95,
        weight: FORM,
        seed: 959,
      });
    },
  });
  const stores: [number, number, number][] = [
    [-1.0, 2.05, 0],
    [-0.55, 2.2, 1],
    [1.15, -2.3, 0],
    [1.45, -2.0, 1],
    [6.3, -1.0, 0],
    [-6.6, 1.5, 1],
  ];
  for (const [x, y, kind] of stores) {
    items.push({
      y,
      draw: () => {
        if (k < 0.4 && (x < -6 || x > 6)) return;
        const [cx, cy] = P(x, y, H + 0.18);
        const s = 0.24 * T;
        if (kind === 0) {
          d.body(d.box(cx - s, cy - s * 0.8, cx + s, cy + s * 0.8), {
            smooth: false,
            wash: TIMBER,
            washAlpha: 0.95,
            weight: FORM,
            seed: 960 + Math.round(x * 10),
          });
          d.line(cx - s, cy - s * 0.8, cx + s, cy + s * 0.8, HAIR, 961);
        } else {
          d.body(d.round(cx, cy, s * 0.85, s * 0.75, 9), {
            wash: 0xa8845a,
            washAlpha: 0.95,
            weight: FORM,
            seed: 962 + Math.round(x * 10),
          });
          d.curve(d.round(cx, cy, s * 0.5, s * 0.42, 8).slice(), HAIR, 963, true);
        }
      },
    });
  }
  items.push({
    y: 0.9,
    draw: () => {
      // The winch: a drum of rope on two cheeks.
      const [wx, wy] = P(-1.05, 0.95, H + 0.25);
      d.body(d.box(wx - 0.3 * T, wy - 0.14 * T, wx + 0.3 * T, wy + 0.14 * T), {
        smooth: false,
        wash: CANVAS,
        washAlpha: 0.95,
        weight: CONTOUR,
        seed: 965,
      });
      d.strength = strength * fine;
      for (let i = 0; i < 4; i++)
        d.line(
          wx - 0.24 * T + i * 0.16 * T,
          wy - 0.14 * T,
          wx - 0.2 * T + i * 0.16 * T,
          wy + 0.14 * T,
          HAIR,
          966 + i,
        );
      d.strength = strength;
    },
  });

  // The rail: posts and a top rail round the deck; the far half now, the near half in front of everyone.
  const railHalf = (sign: 1 | -1): void => {
    const pts: number[] = [];
    const tops: number[] = [];
    for (let i = 0; i <= 30; i++) {
      const x = lerp(-7.3, 7.4, i / 30);
      const y = sign * halfWidth(x) * 0.97;
      pts.push(...P(x, y, H));
      tops.push(...P(x, y, H + 0.28));
    }
    d.curve(tops, CONTOUR, sign > 0 ? 970 : 975);
    for (let i = 0; i <= 30; i += 2) {
      const b = [pts[i * 2] as number, pts[i * 2 + 1] as number];
      const a = [tops[i * 2] as number, tops[i * 2 + 1] as number];
      d.line(
        b[0] as number,
        b[1] as number,
        a[0] as number,
        a[1] as number,
        FORM,
        980 + i + (sign > 0 ? 40 : 0),
      );
    }
  };
  items.push({ y: -3.2, draw: () => railHalf(-1) });

  // Citizens aboard.
  const aboardSize = c.size;
  const detail = detailFor(aboardSize);
  for (const member of c.crew) {
    const sp = member.station;
    const spot100: Spot = { ...sp, x: sp.x * 100, y: sp.y * 100, range: sp.range * 100 };
    const placed = poseAt(spot100, member.look.id, t);
    const p = member.pose ?? placed.p;
    const hx = placed.x / 100;
    const hy = sp.y;
    const z = H + sp.z;
    items.push({
      y: sp.z > 0 ? 0.3 : hy,
      draw: () => {
        const [fx, fy] = P(hx, hy, z);
        if (sp.z > 0) {
          // The crow's nest: its basket's back, the lookout, its front.
          const [nx, ny] = P(MAST_AT.x, 0, z);
          d.body(d.round(nx, ny, 0.45 * T, 0.2 * T, 10), {
            wash: TIMBER,
            washAlpha: 0.9,
            weight: CONTOUR,
            seed: 990,
          });
          drawCitizen(d, member.look, p, fx, fy, aboardSize, detail);
          const front = [
            nx - 0.45 * T,
            ny,
            nx + 0.45 * T,
            ny,
            nx + 0.4 * T,
            ny + 0.32 * T,
            nx - 0.4 * T,
            ny + 0.32 * T,
          ];
          d.body(front, {
            smooth: false,
            wash: TIMBER,
            washAlpha: 0.95,
            weight: CONTOUR,
            seed: 991,
          });
        } else drawCitizen(d, member.look, p, fx, fy, aboardSize, detail);
        drawn.aboard.push({ look: member.look, x: fx, y: fy, size: aboardSize });
      },
    });
  }

  // The mast: up out of the open deck, stays to the corners, the nest, the lantern at its head.
  items.push({
    y: 0.02,
    draw: () => {
      const m0 = P(MAST_AT.x, 0, H);
      const m1 = P(MAST_AT.x, 0, H + MAST_HIGH);
      d.body(d.round(m0[0], m0[1], 0.32 * T, 0.24 * T, 10), {
        wash: TIMBER,
        washAlpha: 0.9,
        weight: CONTOUR,
        seed: 1000,
      });
      d.strength = strength * (0.6 + 0.4 * fine);
      for (const [x, y] of STAY_FEET) {
        const [ax, ay] = P(x, y, H + 0.28);
        d.line(m1[0], m1[1] + 0.55 * T, ax, ay, HAIR, 1001 + Math.round(x + y));
      }
      d.strength = strength;
      d.body(
        [
          m0[0] - 0.12 * T,
          m0[1],
          m1[0] - 0.08 * T,
          m1[1],
          m1[0] + 0.08 * T,
          m1[1],
          m0[0] + 0.12 * T,
          m0[1],
        ],
        { smooth: false, wash: TIMBER, washAlpha: 0.9, weight: CONTOUR, seed: 1005 },
      );
      d.hatch(
        [m0[0] + 0.02 * T, m0[1], m1[0], m1[1], m1[0] + 0.08 * T, m1[1], m0[0] + 0.12 * T, m0[1]],
        2,
        INK,
        0.5,
      );
      // A yard across it, and the pennant streaming back.
      const yard = P(MAST_AT.x, 0, H + MAST_HIGH * 0.82);
      d.line(
        yard[0] - 0.8 * T,
        yard[1] + 0.05 * T,
        yard[0] + 0.8 * T,
        yard[1] - 0.05 * T,
        CONTOUR,
        1006,
      );
      const flap = Math.sin(t * 3.2) * 0.08 * T;
      d.body(
        [
          m1[0],
          m1[1] - 0.05 * T,
          m1[0] - 0.9 * T,
          m1[1] + 0.05 * T + flap,
          m1[0] - 0.75 * T,
          m1[1] + 0.15 * T + flap,
          m1[0] - 0.95 * T,
          m1[1] + 0.25 * T + flap,
          m1[0],
          m1[1] + 0.22 * T,
        ],
        { smooth: false, wash: OXIDE, washAlpha: 0.95, weight: FORM, seed: 1007 },
      );
      if (c.crew.every((m) => m.station.z <= 0)) {
        const [nx, ny] = P(MAST_AT.x, 0, H + NEST_HIGH);
        d.body(d.round(nx, ny, 0.45 * T, 0.2 * T, 10), {
          wash: TIMBER,
          washAlpha: 0.9,
          weight: CONTOUR,
          seed: 990,
        });
        d.body(
          [
            nx - 0.45 * T,
            ny,
            nx + 0.45 * T,
            ny,
            nx + 0.4 * T,
            ny + 0.32 * T,
            nx - 0.4 * T,
            ny + 0.32 * T,
          ],
          { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: CONTOUR, seed: 991 },
        );
      }
    },
  });
  // The lantern at the mast's head, after everyone aboard so the lookout never covers it.
  items.push({
    y: 0.5,
    draw: () => {
      const m1 = P(MAST_AT.x, 0, H + MAST_HIGH);
      const lx = m1[0] + sway * 0.4 * T;
      const ly = m1[1] + 0.1 * T;
      const s = Math.max(5, 0.26 * T);
      const glow = lerp(0.35, 0.8, c.lantern);
      // Its light in two flat steps, then the lamp: a brass cap and base, glass between, a ring to hang by.
      d.wash(d.round(lx, ly, s * 2.6, s * 2.3, 12, 7).slice(), LAMP, glow * 0.45, true);
      d.wash(d.round(lx, ly, s * 1.6, s * 1.45, 12, 8).slice(), LAMP, glow * 0.8, true);
      d.line(m1[0], m1[1] - 0.2 * T, lx, ly - s * 1.1, FORM, 1012);
      d.curve(d.round(lx, ly - s * 1.25, s * 0.28, s * 0.22, 8).slice(), FORM, 1013, true);
      d.body(
        [
          lx - s * 0.7,
          ly - s * 0.75,
          lx + s * 0.7,
          ly - s * 0.75,
          lx + s * 0.6,
          ly + s * 0.75,
          lx - s * 0.6,
          ly + s * 0.75,
        ],
        {
          smooth: false,
          wash: LAMP,
          washAlpha: 1,
          weight: CONTOUR,
          seed: 1008,
        },
      );
      d.body([lx - s * 0.85, ly - s * 0.75, lx, ly - s * 1.15, lx + s * 0.85, ly - s * 0.75], {
        smooth: false,
        wash: BRASS,
        washAlpha: 0.95,
        weight: FORM,
        seed: 1009,
      });
      d.body(d.box(lx - s * 0.75, ly + s * 0.72, lx + s * 0.75, ly + s * 0.95), {
        smooth: false,
        wash: BRASS,
        washAlpha: 0.95,
        weight: FORM,
        seed: 1010,
      });
      d.line(lx, ly - s * 0.72, lx, ly + s * 0.72, HAIR, 1014);
      d.dot(lx, ly + s * 0.1, Math.max(1.6, s * 0.28), mix(LAMP, 0xe0702c, 0.4 + 0.6 * c.lantern));
    },
  });

  // The stack and its smoke, drifting back as it walks.
  items.push({
    y: -0.95,
    draw: () => {
      const s0 = P(-5.85, -0.85, H + 0.55);
      const s1 = P(-5.85, -0.85, H + 2.2);
      d.body(
        [
          s0[0] - 0.2 * T,
          s0[1],
          s1[0] - 0.2 * T,
          s1[1],
          s1[0] + 0.2 * T,
          s1[1],
          s0[0] + 0.2 * T,
          s0[1],
        ],
        { smooth: false, wash: IRON, washAlpha: 0.95, weight: CONTOUR, seed: 1010 },
      );
      d.hatch(
        [s0[0], s0[1], s1[0], s1[1], s1[0] + 0.2 * T, s1[1], s0[0] + 0.2 * T, s0[1]],
        2,
        INK,
        0.6,
      );
      d.fill(d.round(s1[0], s1[1], 0.2 * T, 0.08 * T, 8), INK, 1);
      // Smoke as drawn puffs: each a scalloped outline with a grey wash and hatching on its shade side,
      // held whole until late in its rise.
      for (let i = 4; i >= 0; i--) {
        const age = (t * 0.45 + i / 5) % 1;
        const r = (0.2 + age * 0.42) * T;
        const drift = -age * (0.6 + c.walk * 1.6) * T;
        const sx = s1[0] + drift + Math.sin(age * 5 + i) * 0.1 * T;
        const sy = s1[1] - 0.25 * T - age * 1.6 * T;
        d.strength = strength * (1 - smooth(0.65, 1, age));
        const puff: number[] = [];
        for (let k2 = 0; k2 < 14; k2++) {
          const a = (k2 / 14) * Math.PI * 2;
          const lobe = k2 % 2 ? 0.86 : 1.04;
          puff.push(sx + Math.cos(a) * r * lobe, sy + Math.sin(a) * r * 0.78 * lobe);
        }
        d.body(puff, { wash: 0xbdb5aa, washAlpha: 0.85, weight: FORM, seed: 1011 + i });
        d.hatch(
          [sx, sy, sx + r, sy, sx + r * 0.7, sy + r * 0.6, sx - r * 0.2, sy + r * 0.75],
          1,
          INK,
          0.5,
          true,
        );
      }
      d.strength = strength;
    },
  });

  // Bunting from the mast's head to the stern and the prow, swaying after each step.
  items.push({
    y: 0.03,
    draw: () => {
      const top = P(MAST_AT.x, 0, H + MAST_HIGH * 0.95);
      for (const [ex, ey] of [
        [-7.2, -0.6],
        [7.4, 0.2],
      ] as const) {
        const end = P(ex, ey, H + 0.6);
        const sag = (0.35 + sway * 0.6) * T;
        const line: number[] = [];
        for (let k = 0; k <= 10; k++) {
          const u = k / 10;
          line.push(lerp(top[0], end[0], u), lerp(top[1], end[1], u) + Math.sin(u * Math.PI) * sag);
        }
        d.curve(line, HAIR, 1030 + Math.round(ex));
        if (k < 0.3) continue;
        d.strength = strength * smooth(0.3, 0.8, k);
        for (let f = 1; f < 10; f++) {
          const u = f / 10;
          const x0 = lerp(top[0], end[0], u);
          const y0 = lerp(top[1], end[1], u) + Math.sin(u * Math.PI) * sag;
          const flag = 0.16 * T;
          const tint = [OXIDE, BRASS, CANVAS][f % 3] as number;
          d.body(
            [
              x0 - flag * 0.5,
              y0,
              x0 + flag * 0.5,
              y0,
              x0 + Math.sin(t * 2 + f) * 2,
              y0 + flag * 1.3,
            ],
            { smooth: false, wash: tint, washAlpha: 0.95, weight: HAIR, seed: 1035 + f },
          );
        }
        d.strength = strength;
      }
      // The flag at the stern.
      const pole = P(-7.25, 0, H + 0.2);
      const head = P(-7.25, 0, H + 1.6);
      d.line(pole[0], pole[1], head[0], head[1], CONTOUR, 1040);
      const flap = Math.sin(t * 2.6) * 0.06 * T;
      d.body(
        [
          head[0],
          head[1],
          head[0] - 0.75 * T,
          head[1] + 0.1 * T + flap,
          head[0] - 0.7 * T,
          head[1] + 0.45 * T + flap,
          head[0],
          head[1] + 0.4 * T,
        ],
        { smooth: false, wash: OXIDE, washAlpha: 0.95, weight: FORM, seed: 1041 },
      );
    },
  });
  items.push({ y: 3.2, draw: () => railHalf(1) });
  items.sort((a, b) => a.y - b.y);
  for (const item of items) item.draw();

  // ---- A ramp on the near side comes down in front of the hull.
  if (c.rampSide > 0) drawRamp(d, c, P, H, 1);

  // ---- The near legs, in front of everything aboard.
  for (let i = 0; i < LEGS.length; i++) if ((LEGS[i] as LegDef).side > 0) leg(i);

  // The outline of deck and side together, for who is behind the hull.
  for (let i = 0; i < HULL.length; i += 2) {
    const y = HULL[i + 1] as number;
    if (y <= 0) drawn.hull.push(...P(HULL[i] as number, y, H));
  }
  for (let i = NEAR_SIDE.length - 1; i >= 0; i--) {
    const [x, y] = NEAR_SIDE[i] as readonly [number, number];
    drawn.hull.push(...P(x * 0.97, y * 0.9, H - HULL_DEEP));
  }
  d.strength = strength;
  return drawn;
}

/** The ramp: timber, through a gap in the rail, folded up against it when stowed. */
function drawRamp(
  d: Draw,
  c: TopCity,
  P: (x: number, y: number, z: number) => [number, number],
  H: number,
  side: 1 | -1,
): void {
  const edge = halfWidth(5.0) * side;
  // Stowed, it is folded in two and stands half a tile up against the rail; it unfolds as it comes down.
  const e = easeInOut(clamp(c.ramp));
  const R = lerp(0.55, Math.hypot(3.2, H), e);
  const down = Math.atan2(3.2, -H);
  const a = down * e;
  const endY = edge + Math.sin(a) * R * side;
  const endZ = H + Math.cos(a) * R;
  const x0 = 4.4;
  const x1 = 5.6;
  const q = [
    ...P(x0, edge, H),
    ...P(x1, edge, H),
    ...P(x1 + 0.35, endY, endZ),
    ...P(x0 + 0.35, endY, endZ),
  ];
  d.body(q, { smooth: false, wash: TIMBER, washAlpha: 0.92, weight: CONTOUR, seed: 1020 + side });
  const strength = d.strength;
  d.strength = strength * smooth(0.3, 0.8, c.T / 66) * 0.8 + strength * 0.2;
  for (let i = 1; i < 8; i++) {
    const u = i / 8;
    const l = P(x0 + 0.35 * u, lerp(edge, endY, u), lerp(H, endZ, u));
    const r = P(x1 + 0.35 * u, lerp(edge, endY, u), lerp(H, endZ, u));
    d.line(l[0], l[1], r[0], r[1], HAIR, 1022 + i);
  }
  d.strength = strength;
  if (c.ramp > 0.98) {
    const [fx, fy] = P(x0 + 0.35, endY, 0);
    const [gx, gy] = P(x1 + 0.35, endY, 0);
    d.wash(
      [fx - 4, fy, gx + 4, gy, gx + 8, gy + 0.3 * c.T, fx, fy + 0.3 * c.T],
      SHADOW,
      0.24,
      false,
    );
  }
}

/** The ring of strokes and puff of dust where a foot has come down, flattened to lie on the ground. */
function drawFootfallTop(d: Draw, age: number, key: number): void {
  if (age > 1.6) return;
  const k = age / 1.6;
  const strength = d.strength;
  const held = Math.floor(age * 12) / 12 / 1.6;
  const r = 40 + 80 * (1 - (1 - held) ** 2);
  d.strength = strength * (1 - k) ** 0.7;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + hash(key, i) * 0.4;
    const r0 = r * (0.78 + hash(i, key) * 0.1);
    const r1 = r * (1.0 + hash(i, key + 1) * 0.16);
    d.line(
      Math.cos(a) * r0,
      Math.sin(a) * r0 * BACK * 0.55,
      Math.cos(a) * r1,
      Math.sin(a) * r1 * BACK * 0.55,
      a > Math.PI ? FORM : CONTOUR,
      key + i,
    );
  }
  for (let i = 0; i < 4; i++) {
    const side = i % 2 ? 1 : -1;
    const px = side * (30 + held * 60 + i * 9);
    const py = -6 - held * 26 * (0.5 + hash(i, key + 2));
    const pr = 8 + held * 14 + i * 2;
    d.fill(d.round(px, py, pr, pr * 0.7, 8, key + i), PAPER, 0.7, true);
    d.curve(d.round(px, py, pr, pr * 0.7, 8, key + i).slice(0, 12), FORM, key + i + 20);
  }
  d.strength = strength;
}
