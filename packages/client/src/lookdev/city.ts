// The city (docs/art.md, section 7): a riveted hull on eight jointed legs,
// with decks built on over years, drawn as a cut-away so everyone aboard can
// be seen. One drawing serves the close-up in transit and the landing: as it
// is drawn smaller, planks, rivets and furniture drop out and the outline
// keeps its weight.
//
// Units: a hundredth of a tile, so the city is about 15 tiles long. The origin
// is on the ground under the middle of the hull; up is negative.

import { CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER, shade } from "./draw.ts";
import {
  detailFor,
  drawCitizen,
  HAT_TOP,
  type Look,
  type Pose,
  pose,
  standing,
  walking,
} from "./figure.ts";
import { clamp, easeInOut, hash, knee, lerp, ring, smooth } from "./geom.ts";

export const TIMBER = 0xc9a36b;
export const CANVAS = 0xe7dcc0;
export const IRON = 0x5b5048;
export const BRASS = 0xd2a24c;
export const LAMP = 0xf6cf6a;
const LAMPLIGHT = 0xf3d9a0;
const SOOT = 0x8a7f74;
/** Red oxide paint, on roofs and the strake: what marks the city out on any map. */
const OXIDE = 0xa8644a;

/** Seconds for all eight legs to step once, and the part of that a leg spends in the air. */
export const GAIT_SECONDS = 5.6;
const SWING = 0.3125;
/** How far a foot travels in a step, in city units; with the gait it sets the city's speed. */
const STRIDE = 170;
/** City units a second at a walk. */
export const CITY_SPEED = STRIDE / (GAIT_SECONDS * (1 - SWING));
/** The hull's height over the ground on straight legs, and parked. */
const STANDING = 222;
const PARKED = 92;

export interface CityState {
  /** Seconds, for everything that idles. */
  readonly t: number;
  /** How many gait cycles the legs have walked. */
  readonly gait: number;
  /** 1 walking, 0 with every foot planted. */
  readonly walk: number;
  /** 0 standing tall, 1 settled onto folded legs. */
  readonly settle: number;
  /** 0 the ramp folded up, 1 down on the ground. */
  readonly ramp: number;
  readonly crowd: readonly Look[];
  /** Whether citizen `i` of the crowd is still aboard. */
  aboard(i: number): boolean;
  /** If given, where each citizen aboard is and what it is called, in frame pixels, for its name tag. */
  readonly names?: { x: number; y: number; name: string; rgb?: number; must?: boolean }[];
}

interface Leg {
  readonly hip: number;
  readonly reach: number;
  readonly phase: number;
  readonly far: boolean;
  readonly bend: number;
}

const LEGS: readonly Leg[] = [
  { hip: -500, reach: -150, phase: 0, far: false, bend: 1 },
  { hip: -190, reach: -60, phase: 0.5, far: false, bend: 1 },
  { hip: 170, reach: 70, phase: 0.25, far: false, bend: -1 },
  { hip: 470, reach: 160, phase: 0.75, far: false, bend: -1 },
  { hip: -415, reach: -150, phase: 0.625, far: true, bend: 1 },
  { hip: -105, reach: -60, phase: 0.125, far: true, bend: 1 },
  { hip: 255, reach: 70, phase: 0.875, far: true, bend: -1 },
  { hip: 555, reach: 160, phase: 0.375, far: true, bend: -1 },
];

interface Foot {
  /** Where the foot is, from the hip, and how high off the ground. */
  readonly x: number;
  readonly lift: number;
  /** Seconds since it last came down, or a large number while it is in the air. */
  readonly planted: number;
}

function footOf(leg: Leg, s: CityState): Foot {
  const u = (((s.gait + leg.phase) % 1) + 1) % 1;
  let x: number;
  let lift = 0;
  let planted = 99;
  if (u < SWING) {
    const k = u / SWING;
    x = lerp(-STRIDE / 2, STRIDE / 2, easeInOut(k));
    lift = Math.sin(Math.PI * k) ** 0.8 * 74;
  } else {
    const k = (u - SWING) / (1 - SWING);
    x = lerp(STRIDE / 2, -STRIDE / 2, k);
    planted = (u - SWING) * GAIT_SECONDS;
  }
  // Coming to a halt, a foot in the air is set down where it is. To park, each
  // leg in turn takes one short step outward, so the hull can sink between them.
  const turn = clamp(s.settle * 1.6 - leg.phase * 0.6);
  const out = Math.sign(leg.reach) * (Math.abs(leg.reach) * 0.9 + 110) * easeInOut(turn);
  const hop = Math.sin(Math.PI * turn) * 46;
  return {
    x: leg.reach + x + out,
    lift: lift * s.walk + hop,
    planted:
      s.walk > 0.5
        ? planted
        : turn > 0 && turn < 1
          ? 99
          : turn >= 1
            ? (s.settle - (1 + leg.phase * 0.6) / 1.6) * 2.2
            : 99,
  };
}

/** Where the city's feet meet the ground, in city units from its middle, and how long ago. */
export function footfalls(s: CityState): { x: number; age: number; far: boolean }[] {
  return LEGS.map((leg) => {
    const foot = footOf(leg, s);
    return { x: leg.hip + foot.x, age: foot.planted, far: leg.far };
  });
}

/** How the hull sits this moment: its height, its dip toward a lifted leg, its roll. */
export function hullPose(s: CityState): { height: number; roll: number; sway: number } {
  let dip = 0;
  let roll = 0;
  let sway = 0;
  for (const leg of LEGS) {
    const foot = footOf(leg, s);
    const up = foot.lift / 74;
    dip += up * (leg.far ? 4 : 9) * (0.6 + Math.abs(leg.hip) / 800);
    roll += up * (leg.hip / 600) * (leg.far ? 0.005 : 0.011);
    // Hung things swing after each footfall and settle before the next.
    sway += ring(foot.planted, 5.2, 1.5) * (leg.hip > 0 ? 1 : -1) * 0.1;
  }
  const breath = Math.sin(s.t * 1.3) * 1.2;
  return {
    height: lerp(STANDING, PARKED, easeInOut(s.settle)) - dip + breath * s.settle,
    roll,
    sway,
  };
}

/** Where the foot of the ramp rests on the ground, in city units from the city's middle. */
export const RAMP_FOOT = 890;
const RAMP_HINGE = { x: 606, y: -20 };

/** A point on the ramp, 0 at the hull to 1 at the ground, for citizens walking down it. */
export function rampPoint(k: number): [number, number] {
  return [lerp(RAMP_HINGE.x, RAMP_FOOT, k), lerp(-(PARKED + 22), 0, k)];
}

type Act =
  | "idle"
  | "pace"
  | "smith"
  | "bench"
  | "cook"
  | "sit"
  | "sleep"
  | "stoke"
  | "carry"
  | "helm"
  | "lookout"
  | "rail"
  | "gunner"
  | "map"
  | "climb";

interface Spot {
  readonly x: number;
  readonly y: number;
  readonly act: Act;
  readonly face: number;
  /** How far it walks either side, for the ones that pace. */
  readonly range: number;
}

const HOLD = -14;
const MAIN = -140;
const UPPER = -268;
const ROOF = -388;
const NEST = -474;

const spot = (x: number, y: number, act: Act, face = 1, range = 0): Spot => ({
  x,
  y,
  act,
  face,
  range,
});

/** Where the first fifteen live: each at a station that belongs to a district. */
const STATIONS: readonly Spot[] = [
  spot(-470, HOLD, "stoke", -1),
  spot(-420, MAIN, "smith", -1),
  spot(190, MAIN, "cook", -1),
  spot(424, UPPER, "helm", 1),
  spot(-36, NEST, "lookout", 1),
  spot(640, MAIN, "gunner", 1),
  spot(-170, MAIN, "bench", -1),
  spot(40, HOLD, "carry", 1, 150),
  spot(268, MAIN - 34, "sit", -1),
  spot(410, HOLD - 62, "sleep", 1),
  spot(-640, MAIN, "gunner", -1),
  spot(120, UPPER, "rail", 1),
  spot(455, MAIN, "map", -1),
  spot(-262, UPPER, "pace", 1, 60),
  spot(8, MAIN - 70, "climb", 1),
];

/** Floors with room on them, for a crowd of 150: x from, x to, the floor's height. */
const FLOORS: readonly (readonly [number, number, number])[] = [
  [-700, 740, MAIN],
  [-480, 520, UPPER],
  [-560, 560, HOLD],
  [-360, -160, ROOF - 40],
  [270, 500, ROOF - 44],
  [-700, 740, MAIN],
  [-480, 250, UPPER],
];

function spotsFor(count: number): Spot[] {
  const spots = [...STATIONS];
  for (let i = spots.length; i < count; i++) {
    const floor = FLOORS[i % FLOORS.length] as readonly [number, number, number];
    const k = hash(i, 51);
    const x = lerp(floor[0] + 20, floor[1] - 20, hash(i, 52));
    const act: Act = k < 0.34 ? "pace" : k < 0.52 ? "sit" : "idle";
    spots.push(
      spot(
        x,
        floor[2] - (act === "sit" ? 16 : 0),
        act,
        hash(i, 53) < 0.5 ? 1 : -1,
        30 + hash(i, 54) * 60,
      ),
    );
  }
  return spots.slice(0, count);
}

const spotCache = new Map<number, Spot[]>();

function poseAt(sp: Spot, id: number, t: number): { p: Pose; x: number; y: number } {
  const beat = t + hash(id, 21) * 5;
  switch (sp.act) {
    case "pace": {
      const period = 5 + hash(id, 22) * 4;
      const u = ((beat / period) % 1) * 2;
      const going = u < 1 ? 1 : -1;
      const k = u < 1 ? u : 2 - u;
      const e = k * k * (3 - 2 * k);
      const still = Math.abs(k - 0.5) > 0.46;
      const x = sp.x + (e - 0.5) * 2 * sp.range;
      return {
        p: still ? standing(id, t, going) : walking(e * sp.range * 0.09 + 0.3, 1, going),
        x,
        y: sp.y,
      };
    }
    case "carry": {
      const period = 9;
      const u = ((beat / period) % 1) * 2;
      const going = u < 1 ? 1 : -1;
      const k = u < 1 ? u : 2 - u;
      const x = sp.x + (k - 0.5) * 2 * sp.range;
      return {
        p: { ...walking(k * sp.range * 0.09, 1, going), haul: 0.75, tool: "none" },
        x,
        y: sp.y,
      };
    }
    case "smith": {
      const k = (beat * 1.1) % 1;
      const up = k < 0.7 ? smooth(0, 0.7, k) : 1 - smooth(0.7, 0.82, k);
      return {
        p: pose({
          face: sp.face,
          lean: 0.12 + (1 - up) * 0.25,
          arm: lerp(1.0, 2.9, up),
          arm2: 0.9,
          grip: lerp(0.5, -0.2, up),
          tool: "hammer",
          crouch: (1 - up) * 0.2,
        }),
        x: sp.x,
        y: sp.y,
      };
    }
    case "bench":
      return {
        p: pose({
          face: sp.face,
          lean: 0.28,
          arm: 1.15 + Math.sin(beat * 5) * 0.12,
          arm2: 1.0 + Math.cos(beat * 3.1) * 0.1,
          nod: 0.2,
          tool: "none",
        }),
        x: sp.x,
        y: sp.y,
      };
    case "cook":
      return {
        p: pose({
          face: sp.face,
          lean: 0.16,
          arm: 1.0 + Math.sin(beat * 2.4) * 0.22,
          arm2: 0.3,
          grip: 0.5 + Math.cos(beat * 2.4) * 0.3,
          tool: "ladle",
        }),
        x: sp.x,
        y: sp.y,
      };
    case "sit":
      return {
        p: pose({
          face: sp.face,
          sit: 1,
          lean: 0.1 + Math.sin(beat * 0.8) * 0.04,
          arm: 0.9 + Math.sin(beat * 1.7) * 0.2,
          arm2: 0.6,
          tool: "none",
          nod: Math.sin(beat * 0.9) * 0.1,
        }),
        x: sp.x,
        y: sp.y,
      };
    case "sleep":
      return {
        p: pose({
          face: sp.face,
          down: -0.92,
          asleep: true,
          tool: "none",
          stretch: 1 + Math.sin(beat * 1.2) * 0.02,
        }),
        x: sp.x,
        y: sp.y,
      };
    case "stoke": {
      const k = Math.sin(beat * 2.2);
      return {
        p: pose({
          face: sp.face,
          lean: 0.3 + k * 0.1,
          crouch: 0.25,
          arm: 1.0 + k * 0.35,
          arm2: 0.7 + k * 0.3,
          grip: 0.45,
          tool: "pole",
          step: 0.8,
          stride: 0.25,
        }),
        x: sp.x,
        y: sp.y,
      };
    }
    case "helm":
      return {
        p: pose({
          face: sp.face,
          lean: 0.06,
          arm: 1.5 + Math.sin(beat * 0.9) * 0.2,
          arm2: 1.2 - Math.sin(beat * 0.9) * 0.2,
          tool: "none",
        }),
        x: sp.x,
        y: sp.y,
      };
    case "lookout":
      return {
        p: pose({
          face: sp.face,
          lean: 0.14,
          arm: 0.4,
          arm2: 2.5 + Math.sin(beat * 0.7) * 0.06,
          nod: -0.1,
          tool: "none",
        }),
        x: sp.x,
        y: sp.y,
      };
    case "rail":
      return {
        p: pose({
          face: sp.face,
          lean: 0.26,
          arm: 1.2,
          arm2: 1.05,
          nod: Math.sin(beat * 0.5) * 0.12,
          tool: "none",
          trail: 0.12 + Math.sin(beat * 1.3) * 0.04,
        }),
        x: sp.x,
        y: sp.y,
      };
    case "gunner":
      return {
        p: pose({
          face: sp.face,
          lean: 0.2,
          crouch: 0.15,
          arm: 1.35 + Math.sin(beat * 0.6) * 0.08,
          arm2: 1.15,
          tool: "none",
          step: 0.7,
          stride: 0.25,
        }),
        x: sp.x,
        y: sp.y,
      };
    case "map":
      return {
        p: pose({
          face: sp.face,
          lean: 0.2,
          arm: 1.2 + Math.sin(beat * 1.1) * 0.15,
          arm2: 0.2,
          nod: 0.18,
          tool: "none",
        }),
        x: sp.x,
        y: sp.y,
      };
    case "climb": {
      const k = Math.sin(beat * 0.5) * 0.5 + 0.5;
      return {
        p: pose({
          face: sp.face,
          arm: 2.6 + Math.sin(beat * 4) * 0.25,
          arm2: 2.3 - Math.sin(beat * 4) * 0.25,
          step: 0.7,
          stride: (beat * 0.7) % 1,
          tool: "none",
          lean: 0.05,
        }),
        x: sp.x,
        y: sp.y + (k - 0.5) * 70,
      };
    }
    default:
      return { p: { ...standing(id, t, sp.face), tool: "none" }, x: sp.x, y: sp.y };
  }
}

export function drawCity(d: Draw, s: CityState): void {
  const zoom = d.zoom;
  // What is left out as the city is drawn smaller: first hair lines, then form lines.
  const fine = smooth(0.4, 0.78, zoom);
  const hair = smooth(0.6, 0.92, zoom);
  const base = d.strength;
  const F = (fn: () => void): void => {
    if (fine < 0.03) return;
    d.strength = base * fine;
    fn();
    d.strength = base;
  };
  const H = (fn: () => void): void => {
    if (hair < 0.03) return;
    d.strength = base * hair;
    fn();
    d.strength = base;
  };
  const hull = hullPose(s);
  const t = s.t;
  const sway = hull.sway;
  const cos = Math.cos(hull.roll);
  const sin = Math.sin(hull.roll);
  /** A point of the body, as the ground sees it. */
  const out = (x: number, y: number): [number, number] => [
    x * cos - y * sin,
    -hull.height + x * sin + y * cos,
  ];

  // ---- The shadow on the ground under the hull.
  const shadowW = 690;
  d.hatch(d.round(30, 16, shadowW, 30, 14), 2, INK, 0.55);
  d.hatch(d.round(30, 16, shadowW * 0.7, 17, 12), 3, INK, 0.5);

  const beam = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    wa: number,
    wb: number,
  ): number[] => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    return [
      ax + (nx * wa) / 2,
      ay + (ny * wa) / 2,
      bx + (nx * wb) / 2,
      by + (ny * wb) / 2,
      bx - (nx * wb) / 2,
      by - (ny * wb) / 2,
      ax - (nx * wa) / 2,
      ay - (ny * wa) / 2,
    ];
  };

  const drawLeg = (leg: Leg): void => {
    const foot = footOf(leg, s);
    const [hx, hy] = out(leg.hip, -12);
    const fx = leg.hip + foot.x;
    const fy = -foot.lift;
    const ax = fx - Math.sign(leg.reach) * 14;
    const ay = fy - 54;
    // The knee stands above the hip, as a spider's does.
    const [kx, ky] = knee(hx, hy, ax, ay, 150, 330, leg.bend);
    const weight = leg.far ? FORM : HEAVY;
    const wash = leg.far ? 0.34 : 0.85;
    const key = leg.hip;
    if (leg.far) d.strength = base * 0.75;
    // The piston from the hull to the thigh.
    const [px, py] = out(leg.hip + leg.bend * 96, -2);
    const mx = lerp(hx, kx, 0.55);
    const my = lerp(hy, ky, 0.55);
    d.body(beam(px, py, lerp(px, mx, 0.55), lerp(py, my, 0.55), 9, 9), {
      smooth: false,
      wash: IRON,
      washAlpha: wash,
      weight: leg.far ? HAIR : FORM,
      seed: key + 1,
    });
    d.line(lerp(px, mx, 0.55), lerp(py, my, 0.55), mx, my, leg.far ? FORM : CONTOUR, key + 2);
    // Shin, then thigh over it, then the joints.
    d.body(beam(kx, ky, ax, ay, 24, 13), {
      smooth: false,
      wash: IRON,
      washAlpha: wash,
      weight,
      seed: key + 3,
    });
    d.body(beam(hx, hy, kx, ky, 32, 24), {
      smooth: false,
      wash: IRON,
      washAlpha: wash,
      weight,
      seed: key + 4,
    });
    if (!leg.far) {
      d.hatch(beam(kx + 3, ky, ax + 2, ay, 11, 6), 2, INK, 0.7);
      d.hatch(beam(hx + 4, hy + 3, kx + 4, ky + 3, 14, 10), 3, INK, 0.6);
      F(() => {
        for (let k = 1; k < 6; k++) d.dot(lerp(kx, ax, k / 6) - 6, lerp(ky, ay, k / 6), 1.5);
        for (let k = 1; k < 4; k++) d.dot(lerp(hx, kx, k / 4) - 8, lerp(hy, ky, k / 4) - 6, 1.6);
      });
    }
    d.body(d.round(kx, ky, 19, 19, 10), { wash: BRASS, washAlpha: wash, weight, seed: key + 5 });
    d.body(d.round(hx, hy, 25, 25, 10), { wash: IRON, washAlpha: wash, weight, seed: key + 6 });
    if (!leg.far) {
      d.dot(kx, ky, 4.5);
      d.dot(hx, hy, 5.5);
      F(() => d.curve(d.round(hx, hy, 17, 17, 8), FORM, key + 7, true));
    }
    // The ankle, and a splayed foot plate with three toes.
    d.body(beam(ax, ay, fx, fy - 12, 20, 26), {
      smooth: false,
      wash: IRON,
      washAlpha: wash,
      weight,
      seed: key + 8,
    });
    const toe = Math.sign(leg.reach) || 1;
    d.body(
      [
        fx - 46,
        fy,
        fx - 30,
        fy - 15,
        fx + 30,
        fy - 15,
        fx + 46,
        fy,
        fx + 52 * toe + 8,
        fy + 3,
        fx - 50,
        fy + 3,
      ],
      { smooth: false, wash: IRON, washAlpha: wash, weight, seed: key + 9 },
    );
    d.body(d.round(ax, ay, 13, 13, 8), {
      wash: BRASS,
      washAlpha: wash,
      weight: leg.far ? FORM : CONTOUR,
      seed: key + 10,
    });
    d.strength = base;
  };

  for (const leg of LEGS) if (leg.far) drawLeg(leg);

  // ---- The body: everything from here rides the hull.
  d.push();
  d.move(0, -hull.height);
  d.turn(hull.roll);

  const room = (
    x0: number,
    x1: number,
    floor: number,
    ceil: number,
    wash: number,
    alpha = 0.5,
  ): void => {
    const pts = d.box(x0, ceil, x1, floor);
    d.fill(pts, PAPER);
    d.wash(pts, wash, alpha);
    // A second, darker glaze over the upper wall, with its own dried edge: rooms are dim.
    const drop = (floor - ceil) * 0.62;
    const glaze = [x0, ceil];
    for (let x = x0; x <= x1; x += (x1 - x0) / 5)
      glaze.push(x, ceil + drop + (hash(x, floor) - 0.5) * 20 + (x - x0) * 0.06);
    glaze.push(x1, ceil);
    d.wash(glaze, 0x6b5540, 0.3);
    H(() => {
      for (let x = x0 + 12 + hash(x0, 1) * 10; x < x1 - 8; x += 20 + hash(x, x0) * 12)
        d.line(x, ceil + 5 + hash(x, 2) * 8, x + (hash(x, 3) - 0.5) * 3, floor - 4, HAIR, 0, 0.55);
    });
    // Shade gathers under the ceiling and against the right-hand wall.
    d.strength = base * lerp(0.5, 1, fine);
    d.hatch([x0, ceil, x1, ceil, x1, ceil + 30, x0, ceil + 12], 2, INK, 0.5);
    d.hatch([x1 - 26, ceil + 30, x1, ceil + 30, x1, floor, x1 - 9, floor], 1, INK, 0.5);
    d.strength = base;
  };

  const lamp = (x: number, y: number, len: number, lit = true): void => {
    const a = sway * (1 + hash(x, y) * 0.5);
    const lx = x + Math.sin(a) * len;
    const ly = y + Math.cos(a) * len;
    if (lit) {
      // Lamplight is laid in flat steps with an edge, not a glow.
      d.fill(d.round(lx, ly + 14, 82, 58, 12, 7), PAPER, 0.5, true);
      d.wash(d.round(lx, ly + 14, 82, 58, 12, 7), LAMPLIGHT, 0.5, true);
      d.fill(d.round(lx, ly + 10, 42, 31, 10, 9), PAPER, 0.5, true);
      d.wash(d.round(lx, ly + 10, 42, 31, 10, 9), LAMP, 0.45, true);
    }
    d.line(x, y, lx, ly - 8, FORM, x + 1);
    d.body([lx - 7, ly - 8, lx + 7, ly - 8, lx + 9, ly + 9, lx - 9, ly + 9], {
      smooth: false,
      wash: BRASS,
      weight: FORM,
      seed: x + 2,
    });
    d.dot(lx, ly + 1, 3.2 * Math.max(0.55, Math.min(1, zoom * 1.4)), LAMP);
  };

  const crate = (x: number, floor: number, w: number, h: number, key = 0): void => {
    d.body(d.box(x, floor - h, x + w, floor), {
      smooth: false,
      wash: TIMBER,
      washAlpha: 0.85,
      weight: fine > 0.5 ? CONTOUR : FORM,
      seed: x + key,
    });
    F(() => {
      d.line(x + 3, floor - h + 3, x + w - 3, floor - 3, FORM, x + key + 1);
      d.line(x + w - 3, floor - h + 3, x + 3, floor - 3, HAIR, x + key + 2);
    });
    d.hatch(
      [x + w * 0.62, floor - h, x + w, floor - h, x + w, floor, x + w * 0.74, floor],
      2,
      INK,
      0.5 * fine,
    );
  };

  const barrel = (x: number, floor: number, r: number, h: number, wash = TIMBER): void => {
    d.body(
      [
        x - r * 0.8,
        floor - h,
        x + r * 0.8,
        floor - h,
        x + r * 1.08,
        floor - h / 2,
        x + r * 0.8,
        floor,
        x - r * 0.8,
        floor,
        x - r * 1.08,
        floor - h / 2,
      ],
      { wash, washAlpha: 0.85, weight: fine > 0.5 ? CONTOUR : FORM, seed: x * 3 },
    );
    F(() => {
      d.curve([x - r, floor - h * 0.72, x, floor - h * 0.68, x + r, floor - h * 0.72], FORM, x + 5);
      d.curve([x - r, floor - h * 0.28, x, floor - h * 0.24, x + r, floor - h * 0.28], FORM, x + 6);
    });
    d.hatch(
      [
        x + r * 0.3,
        floor - h,
        x + r * 0.85,
        floor - h,
        x + r * 1.05,
        floor - h / 2,
        x + r * 0.8,
        floor,
        x + r * 0.45,
        floor,
      ],
      2,
      INK,
      0.5 * fine,
    );
  };

  const sack = (x: number, floor: number, r: number): void => {
    d.body(
      [
        x - r,
        floor,
        x - r * 0.9,
        floor - r * 0.9,
        x - r * 0.2,
        floor - r * 1.35,
        x + r * 0.15,
        floor - r * 1.6,
        x + r * 0.3,
        floor - r * 1.3,
        x + r * 0.95,
        floor - r * 0.8,
        x + r,
        floor,
      ],
      { wash: CANVAS, washAlpha: 0.9, weight: fine > 0.5 ? CONTOUR : FORM, seed: x * 5 },
    );
    F(() =>
      d.curve(
        [
          x - r * 0.3,
          floor - r * 1.25,
          x + r * 0.05,
          floor - r * 1.15,
          x + r * 0.3,
          floor - r * 1.28,
        ],
        FORM,
        x + 7,
      ),
    );
  };

  const ladder = (x: number, y0: number, y1: number): void => {
    d.line(x - 11, y0, x - 11, y1, CONTOUR, x + 1);
    d.line(x + 11, y0, x + 11, y1, CONTOUR, x + 2);
    F(() => {
      for (let y = y0 - 12; y > y1 + 6; y -= 17) d.line(x - 11, y, x + 11, y - 1, FORM, x + y);
    });
  };

  const rivets = (x0: number, y0: number, x1: number, y1: number, every = 22): void => {
    F(() => {
      const count = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / every));
      for (let k = 0; k <= count; k++) d.dot(lerp(x0, x1, k / count), lerp(y0, y1, k / count), 1.5);
    });
  };

  /** A puff-trail of smoke from a chimney top: loops of line that open and drift astern. */
  const smoke = (x: number, y: number, key: number, size = 1): void => {
    const puffs = 11;
    const life = 9;
    // Oldest first, so the fresh puffs at the chimney sit in front.
    const order: number[] = [];
    for (let k = 0; k < puffs; k++) order.push(k);
    const ageOf = (k: number): number => ((t / life + k / puffs + hash(key, 1)) % 1) * life;
    order.sort((a, b) => ageOf(b) - ageOf(a));
    for (const k of order) {
      const age = ageOf(k);
      const drift = s.walk * 40 + 14;
      const px = x - age * drift - Math.sin(age * 0.9 + key + k) * 9 * size;
      const py = y - 10 - age * 24 * size - Math.sqrt(age) * 16;
      const r = (10 + age * 7 + hash(k, key) * 6) * size;
      // A puff thins out as it ages: its outline breaks, then goes.
      const thin = clamp(1.15 - age / life);
      d.strength = base * thin;
      const blob = d.round(px, py, r * 1.15, r * 0.86, 10, key * 13 + k + 1);
      d.fill(blob, PAPER, 0.92, true);
      d.wash(blob, SOOT, 0.3, true);
      d.hatch(d.round(px + r * 0.3, py + r * 0.36, r * 0.7, r * 0.4, 8), 1, INK, 0.5);
      // Scallops along the top, as engraved smoke is drawn.
      const top: number[] = [];
      const turns = age * 0.25 + k;
      for (let a = 0; a <= 8; a++) {
        const angle = Math.PI * (1.08 + (a / 8) * (1.05 - age / life / 2)) + Math.sin(turns) * 0.3;
        const bump = 1 + (a % 2 ? 0.1 : -0.04);
        top.push(px + Math.cos(angle) * r * 1.15 * bump, py + Math.sin(angle) * r * 0.86 * bump);
      }
      d.curve(top, age < 2.5 ? CONTOUR : FORM, key * 7 + k);
      d.strength = base;
    }
  };

  // ---- The hull: a keel plate, riveted, its underside the darkest thing on the plate.
  const hullPts = [
    -742, -146, -752, -86, -700, -30, -610, 0, 570, 0, 690, -34, 792, -118, 850, -196, 770, -150,
  ];
  d.body(hullPts, { wash: IRON, washAlpha: 0.82, weight: HEAVY, seed: 101 });
  d.hatch(
    [
      -748, -70, -700, -30, -610, 0, 570, 0, 690, -34, 780, -100, 690, -62, 560, -32, -600, -32,
      -700, -60,
    ],
    3,
    INK,
    0.75,
    true,
  );
  d.fill([-640, -6, 596, -6, 560, 16, 300, 26, -330, 26, -590, 16], INK, 1, true);
  rivets(-720, -112, -600, -112);
  rivets(600, -112, 760, -112);
  rivets(-690, -70, -600, -40);
  rivets(610, -44, 720, -84);
  F(() => {
    d.curve([-742, -100, -660, -96, -596, -98], FORM, 102);
    d.curve([596, -98, 700, -100, 796, -128], FORM, 103);
    d.line(-660, -140, -664, -40, FORM, 104);
    d.line(684, -140, 680, -42, FORM, 105);
    // A patched plate at the stern, and soot streaks.
    d.path([-720, -86, -676, -90, -672, -52, -712, -50], FORM, 106, true);
    rivets(-716, -82, -678, -86, 13);
  });
  // Pipes and a chain under the keel.
  F(() => {
    d.curve([-420, 22, -300, 40, -120, 36, 60, 44, 240, 30], CONTOUR, 107);
    const cx = -40 + sway * 160;
    d.line(-40, 26, cx, 84, FORM, 108);
    d.body(d.round(cx, 92, 10, 12, 7), { wash: IRON, weight: FORM, seed: 109 });
  });

  // ---- The hold, cut open: engine, cargo, bunks.
  room(-590, -268, HOLD, -132, IRON, 0.42);
  room(-262, 250, HOLD, -132, TIMBER, 0.5);
  room(258, 590, HOLD, -132, TIMBER, 0.42);
  lamp(-10, -132, 30);
  lamp(330, -132, 26);
  // The boiler: a riveted drum with a firebox, a flywheel and a rod to the legs.
  d.body([-560, -112, -430, -118, -400, -70, -430, -22, -560, -18, -576, -66], {
    wash: IRON,
    washAlpha: 0.9,
    seed: 111,
  });
  d.hatch(
    [-470, -116, -430, -118, -402, -70, -430, -22, -480, -20],
    3,
    INK,
    0.6 * lerp(0.4, 1, fine),
    true,
  );
  rivets(-548, -100, -448, -104, 20);
  rivets(-548, -32, -448, -28, 20);
  const fire = 0.8 + Math.sin(t * 9) * 0.1 + Math.sin(t * 23) * 0.06;
  d.wash(d.round(-470, -52, 64 * fire, 40 * fire, 10, 5), LAMPLIGHT, 0.5, true);
  d.body(d.round(-520, -52, 21, 23, 9), { wash: LAMP, washAlpha: 1, seed: 112 });
  d.fill(d.round(-520, -48, 11 * fire, 14 * fire, 7, 3), 0xe2863a, 0.9, true);
  F(() => d.line(-542, -52, -498, -52, FORM, 113));
  const wheelA = s.gait * Math.PI * 2 * 2;
  d.body(d.round(-340, -62, 42, 42, 12), { wash: BRASS, washAlpha: 0.55, seed: 114 });
  F(() => {
    d.curve(d.round(-340, -62, 31, 31, 10), FORM, 115, true);
    for (let k = 0; k < 4; k++) {
      const a = wheelA + (k * Math.PI) / 4;
      d.line(
        -340 - Math.cos(a) * 31,
        -62 - Math.sin(a) * 31,
        -340 + Math.cos(a) * 31,
        -62 + Math.sin(a) * 31,
        FORM,
        116 + k,
      );
    }
  });
  d.dot(-340, -62, 4.5);
  const crankX = -340 + Math.cos(wheelA) * 30;
  const crankY = -62 + Math.sin(wheelA) * 30;
  d.line(crankX, crankY, -424 + Math.cos(wheelA) * 10, -62, CONTOUR, 121);
  d.dot(crankX, crankY, 3);
  // A steam pipe up through the decks at the stern.
  d.body(d.box(-586, -132, -572, -60), { smooth: false, wash: BRASS, weight: FORM, seed: 122 });
  // Cargo: crates, barrels, sacks, and the strongbox the hauls are banked in.
  crate(-246, HOLD, 46, 40);
  crate(-196, HOLD, 38, 32, 1);
  crate(-238, HOLD - 40, 36, 30, 2);
  barrel(-128, HOLD, 17, 44);
  barrel(-92, HOLD, 15, 38);
  sack(96, HOLD, 22);
  sack(128, HOLD, 18);
  sack(112, HOLD - 22, 16);
  d.body([172, HOLD, 172, HOLD - 30, 180, HOLD - 42, 228, HOLD - 42, 236, HOLD - 30, 236, HOLD], {
    smooth: false,
    wash: BRASS,
    washAlpha: 0.9,
    seed: 123,
  });
  F(() => {
    d.line(172, HOLD - 30, 236, HOLD - 30, FORM, 124);
    d.body(d.box(199, HOLD - 34, 209, HOLD - 22), {
      smooth: false,
      wash: IRON,
      weight: FORM,
      seed: 125,
    });
  });
  F(() => {
    // A net of stores slung from the beams.
    const nx = -40 + sway * 60;
    d.curve([-70, -132, nx - 26, -96, nx, -84, nx + 26, -96, -10, -132], FORM, 126);
    d.curve(d.round(nx, -98, 20, 13, 8), HAIR, 127, true);
  });
  // Bunks: two hammocks that swing after each step.
  for (const [hx, hy, key] of [
    [410, -84, 0],
    [520, -100, 1],
  ] as const) {
    const sag = sway * 26 * (key ? -1 : 1);
    d.body(
      [
        hx - 62,
        hy - 34,
        hx - 30 + sag,
        hy + 4,
        hx + sag,
        hy + 13,
        hx + 30 + sag,
        hy + 4,
        hx + 62,
        hy - 34,
        hx + 30 + sag,
        hy - 8,
        hx - 30 + sag,
        hy - 8,
      ],
      { wash: CANVAS, washAlpha: 0.95, weight: fine > 0.5 ? CONTOUR : FORM, seed: 130 + key },
    );
    F(() => {
      d.line(hx - 62, hy - 34, hx - 70, -132, FORM, 132 + key);
      d.line(hx + 62, hy - 34, hx + 70, -132, FORM, 134 + key);
    });
  }
  crate(286, HOLD, 34, 28, 3);
  F(() => {
    d.body(d.box(560, HOLD - 62, 584, HOLD), {
      smooth: false,
      wash: TIMBER,
      weight: FORM,
      seed: 136,
    });
    for (let k = 0; k < 3; k++)
      d.line(560, HOLD - 16 - k * 16, 584, HOLD - 16 - k * 16, FORM, 137 + k);
  });

  // ---- The main deck: gun posts at either end, and between them forge, bench, stair, galley, charts.
  room(-562, -320, MAIN, -260, SOOT, 0.5);
  room(-312, -90, MAIN, -260, TIMBER, 0.52);
  room(-82, 70, MAIN, -260, TIMBER, 0.36);
  room(78, 330, MAIN, -260, CANVAS, 0.7);
  room(338, 560, MAIN, -260, TIMBER, 0.45);
  lamp(-200, -260, 26);
  lamp(206, -260, 30);
  lamp(450, -260, 24);
  // The forge: hearth, hood and chimney, bellows that pump, an anvil.
  d.wash(d.round(-500, -176, 70, 46, 10, 4), LAMPLIGHT, 0.5, true);
  d.body([-552, MAIN, -552, -178, -476, -178, -476, MAIN], {
    smooth: false,
    wash: IRON,
    washAlpha: 0.9,
    seed: 141,
  });
  d.body([-560, -206, -468, -206, -486, -260, -544, -260], {
    smooth: false,
    wash: IRON,
    washAlpha: 0.9,
    seed: 142,
  });
  d.hatch([-510, -206, -468, -206, -486, -260, -516, -260], 3, INK, 0.6 * lerp(0.4, 1, fine));
  d.fill(d.round(-514, -184, 22 * fire, 9 * fire, 8, 2), 0xe2863a, 0.95, true);
  d.fill(d.round(-514, -186, 11 * fire, 5 * fire, 6, 2), LAMP, 1, true);
  const pump = Math.sin(t * 2.6) * 0.5 + 0.5;
  d.body(
    [-474, -150, -420 - pump * 6, -168 - pump * 10, -412, -150, -420 - pump * 6, -146 + pump * 4],
    { wash: TIMBER, washAlpha: 0.9, weight: fine > 0.5 ? CONTOUR : FORM, seed: 143 },
  );
  d.body(
    [
      -384,
      MAIN,
      -378,
      -160,
      -398,
      -168,
      -396,
      -178,
      -338,
      -178,
      -344,
      -166,
      -356,
      -160,
      -350,
      MAIN,
    ],
    { smooth: false, wash: IRON, washAlpha: 0.95, seed: 144 },
  );
  F(() => {
    // Tongs and hammers on the wall.
    for (let k = 0; k < 4; k++)
      d.line(-456 + k * 16, -246, -454 + k * 16, -212 - (k % 2) * 8, FORM, 145 + k);
  });
  // The bench: a vice, a rack of tools, jars, and the piece being worked.
  d.body(d.box(-290, -186, -112, -176), {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 151,
  });
  d.line(-280, -176, -282, MAIN, CONTOUR, 152);
  d.line(-122, -176, -120, MAIN, CONTOUR, 153);
  F(() => {
    d.line(-282, -156, -120, -156, FORM, 154);
    d.body(d.box(-262, -204, -240, -186), { smooth: false, wash: IRON, weight: FORM, seed: 155 });
    d.line(-268, -196, -234, -196, FORM, 156);
    for (let k = 0; k < 5; k++) {
      const jx = -300 + k * 24;
      d.body(d.round(jx, -232, 7, 9, 7), {
        wash: k % 2 ? BRASS : CANVAS,
        weight: FORM,
        seed: 157 + k,
      });
    }
    d.line(-312, -222, -180, -222, FORM, 163);
    d.curve([-160, -240, -146, -226, -132, -240], FORM, 164);
    d.line(-146, -250, -146, -206, FORM, 165);
  });
  d.body([-216, -186, -206, -200, -172, -202, -162, -186], {
    wash: BRASS,
    washAlpha: 0.9,
    weight: FORM,
    seed: 166,
  });
  // The stair and the foot of the mast.
  ladder(8, MAIN, -268);
  d.body(d.box(-44, -260, -16, MAIN), { smooth: false, wash: TIMBER, washAlpha: 0.9, seed: 171 });
  F(() => {
    d.line(-44, -230, -16, -230, FORM, 172);
    d.line(-44, -176, -16, -176, FORM, 173);
  });
  barrel(46, MAIN, 13, 34, BRASS);
  // The galley: a stove with a pot that steams, a table, pans on the wall.
  d.body([96, MAIN, 96, -186, 150, -186, 150, MAIN], {
    smooth: false,
    wash: IRON,
    washAlpha: 0.9,
    seed: 181,
  });
  d.body(d.box(104, -260, 118, -186), { smooth: false, wash: IRON, weight: FORM, seed: 182 });
  d.body([110, -186, 106, -206, 142, -206, 138, -186], {
    smooth: false,
    wash: BRASS,
    washAlpha: 0.95,
    seed: 183,
  });
  d.fill(d.round(123, -160, 13, 7 * fire, 7, 2), 0xe2863a, 0.9, true);
  for (let k = 0; k < 3; k++) {
    const age = (t * 0.5 + k / 3) % 1;
    d.curve(
      [
        124,
        -210 - age * 34,
        118 + Math.sin(age * 6 + k) * 7,
        -220 - age * 34,
        126,
        -230 - age * 34,
        120,
        -240 - age * 34,
      ],
      FORM,
      184 + k,
      false,
      (1 - age) * 0.8,
    );
  }
  d.body(d.box(214, -178, 322, -168), { smooth: false, wash: TIMBER, washAlpha: 0.95, seed: 187 });
  d.line(226, -168, 224, MAIN, CONTOUR, 188);
  d.line(312, -168, 314, MAIN, CONTOUR, 189);
  d.body(d.box(246, -174, 290, MAIN - 30), {
    smooth: false,
    wash: TIMBER,
    weight: FORM,
    seed: 190,
  });
  F(() => {
    d.body(d.round(238, -184, 7, 5, 6), { wash: CANVAS, weight: FORM, seed: 191 });
    d.body(d.round(296, -185, 6, 7, 6), { wash: BRASS, weight: FORM, seed: 192 });
    for (let k = 0; k < 3; k++) {
      const px = 250 + k * 26;
      const sw = sway * 40;
      d.line(px, -252, px + sw, -238, HAIR, 193 + k);
      d.body(d.round(px + sw, -230, 8, 8, 7), { wash: IRON, weight: FORM, seed: 196 + k });
    }
  });
  // The chart room: a table with the map of the march on it, and a round window.
  d.body(d.box(380, -184, 520, -174), { smooth: false, wash: TIMBER, washAlpha: 0.95, seed: 201 });
  d.line(392, -174, 390, MAIN, CONTOUR, 202);
  d.line(508, -174, 510, MAIN, CONTOUR, 203);
  d.body([398, -184, 406, -196, 500, -198, 506, -184], {
    smooth: false,
    wash: CANVAS,
    washAlpha: 1,
    weight: FORM,
    seed: 204,
  });
  d.body(d.round(388, -224, 19, 19, 10), { wash: 0xa9b4b0, washAlpha: 0.6, seed: 205 });
  F(() => {
    d.line(388, -243, 388, -205, FORM, 206);
    d.line(369, -224, 407, -224, FORM, 207);
    d.curve([420, -192, 450, -188, 470, -194, 492, -190], HAIR, 208);
    for (let k = 0; k < 4; k++)
      d.body(d.box(520 + (k % 2) * 3, -250 + k * 13, 552, -240 + k * 13), {
        smooth: false,
        wash: CANVAS,
        weight: HAIR,
        seed: 209 + k,
      });
  });

  // The gun posts: a great crossbow on a swivel behind an iron shield, at stern and prow.
  const gun = (x: number, dir: number, key: number): void => {
    const aim = Math.sin(t * 0.5 + key) * 0.12 - 0.12;
    d.body([x - 12, MAIN, x - 7, MAIN - 50, x + 7, MAIN - 50, x + 12, MAIN], {
      smooth: false,
      wash: IRON,
      washAlpha: 0.9,
      seed: key,
    });
    d.push();
    d.move(x, MAIN - 56);
    d.scale(dir, 1);
    d.turn(aim);
    d.body([-46, -7, 62, -5, 62, 5, -46, 7], {
      smooth: false,
      wash: TIMBER,
      washAlpha: 0.95,
      seed: key + 1,
    });
    d.curve([34, -56, 62, -30, 68, 0, 62, 30, 34, 56], HEAVY, key + 2);
    d.line(34, -56, -18, 0, FORM, key + 3);
    d.line(34, 56, -18, 0, FORM, key + 4);
    d.line(-18, 0, 96, 0, CONTOUR, key + 5);
    d.fill([96, -6, 114, 0, 96, 6], INK);
    d.pop();
    // The shield, with a slit to sight through.
    d.body(
      [
        x + dir * 70,
        MAIN,
        x + dir * 66,
        MAIN - 92,
        x + dir * 84,
        MAIN - 104,
        x + dir * 96,
        MAIN - 92,
        x + dir * 92,
        MAIN,
      ],
      { smooth: false, wash: IRON, washAlpha: 0.92, seed: key + 6 },
    );
    d.hatch(
      [x + dir * 80, MAIN - 100, x + dir * 96, MAIN - 92, x + dir * 92, MAIN, x + dir * 82, MAIN],
      3,
      INK,
      0.6,
    );
    rivets(x + dir * 72, MAIN - 80, x + dir * 72, MAIN - 12, 17);
    F(() => {
      // A rack of bolts.
      for (let k = 0; k < 4; k++)
        d.line(x - dir * (36 + k * 9), MAIN, x - dir * (30 + k * 9), MAIN - 44, FORM, key + 8 + k);
    });
  };
  gun(-650, -1, 220);
  gun(650, 1, 240);
  // Crenels along the open ends of the main deck.
  for (const [x0, x1] of [
    [-736, -572],
    [572, 766],
  ] as const) {
    for (let x = x0; x < x1 - 20; x += 38) {
      d.body(d.box(x, MAIN - 30, x + 22, MAIN - 4), {
        smooth: false,
        wash: TIMBER,
        washAlpha: 0.9,
        weight: fine > 0.4 ? CONTOUR : FORM,
        seed: x,
      });
    }
  }

  // ---- The upper deck: cabins under an awning, open deck round the mast, the wheelhouse.
  room(-372, -150, UPPER, ROOF, TIMBER, 0.5);
  room(258, 520, UPPER, ROOF - 34, BRASS, 0.3);
  lamp(-262, ROOF, 22);
  // Bunks in the cabin, a round window, a chest.
  for (let k = 0; k < 2; k++) {
    const by = UPPER - 34 - k * 44;
    d.body(d.box(-360, by - 8, -250, by), {
      smooth: false,
      wash: TIMBER,
      washAlpha: 0.95,
      weight: FORM,
      seed: 251 + k,
    });
    d.body([-356, by - 8, -352, by - 22, -262, by - 22, -256, by - 8], {
      wash: CANVAS,
      washAlpha: 0.95,
      weight: FORM,
      seed: 253 + k,
    });
  }
  d.line(-250, UPPER, -250, ROOF, CONTOUR, 255);
  d.body(d.round(-196, UPPER - 74, 17, 17, 9), { wash: 0xa9b4b0, washAlpha: 0.6, seed: 256 });
  crate(-226, UPPER, 40, 26, 5);
  // The wheelhouse: tall windows, the wheel, a pitched roof with a vane.
  const wheel = Math.sin(t * 0.7) * 0.5;
  for (let k = 0; k < 3; k++) {
    const wx = 276 + k * 78;
    d.body(d.box(wx, ROOF - 16, wx + 62, UPPER - 46), {
      smooth: false,
      wash: 0xa9b4b0,
      washAlpha: 0.5,
      weight: fine > 0.4 ? CONTOUR : FORM,
      seed: 261 + k,
    });
    F(() => {
      d.line(wx + 31, ROOF - 16, wx + 31, UPPER - 46, FORM, 264 + k);
      d.line(wx, UPPER - 84, wx + 62, UPPER - 84, FORM, 267 + k);
    });
  }
  d.body(d.round(462, UPPER - 62, 27, 27, 11), {
    wash: BRASS,
    washAlpha: 0.55,
    weight: fine > 0.4 ? CONTOUR : FORM,
    seed: 271,
  });
  F(() => {
    for (let k = 0; k < 4; k++) {
      const a = wheel + (k * Math.PI) / 4;
      d.line(
        462 - Math.cos(a) * 35,
        UPPER - 62 - Math.sin(a) * 35,
        462 + Math.cos(a) * 35,
        UPPER - 62 + Math.sin(a) * 35,
        FORM,
        272 + k,
      );
    }
  });
  d.line(462, UPPER - 34, 462, UPPER, CONTOUR, 276);
  d.body([244, ROOF - 30, 392, ROOF - 92, 536, ROOF - 30, 520, ROOF - 24, 258, ROOF - 24], {
    smooth: false,
    wash: OXIDE,
    washAlpha: 0.95,
    weight: HEAVY,
    seed: 277,
  });
  d.hatch([392, ROOF - 92, 536, ROOF - 30, 520, ROOF - 24, 400, ROOF - 24], 2, INK, 0.6);
  F(() => {
    for (let k = 1; k < 5; k++)
      d.line(
        lerp(244, 392, k / 5) + 6,
        lerp(ROOF - 30, ROOF - 92, k / 5) + 8,
        lerp(258, 392, k / 5),
        ROOF - 26,
        HAIR,
        278 + k,
      );
    d.line(392, ROOF - 92, 392, ROOF - 128, FORM, 284);
    d.fill([392, ROOF - 128, 420 + sway * 60, ROOF - 122, 392, ROOF - 114], INK);
  });
  // The cabin's awning, a water tank on its cradle.
  d.body(
    [
      -392,
      ROOF + 4,
      -268,
      ROOF - 50,
      -134,
      ROOF + 4,
      -160,
      ROOF + 12,
      -200,
      ROOF + 4,
      -240,
      ROOF + 12,
      -280,
      ROOF + 4,
      -320,
      ROOF + 12,
      -360,
      ROOF + 4,
    ],
    { smooth: false, wash: CANVAS, washAlpha: 0.98, seed: 291 },
  );
  F(() => {
    d.line(-268, ROOF - 50, -280, ROOF + 4, HAIR, 292);
    d.line(-268, ROOF - 50, -200, ROOF + 4, HAIR, 293);
    d.line(-268, ROOF - 50, -330, ROOF + 2, HAIR, 294);
  });
  d.hatch([-268, ROOF - 50, -134, ROOF + 4, -200, ROOF + 4], 1, INK, 0.5);
  // ---- The open deck's rail, and the washing strung from the mast to the wheelhouse.
  for (const [x0, x1] of [
    [-400, -380],
    [-142, 250],
  ] as const) {
    d.line(x0, UPPER - 30, x1, UPPER - 30, CONTOUR, x0 + 301);
    F(() => {
      for (let x = x0 + 8; x < x1; x += 24) d.line(x, UPPER - 30, x, UPPER, FORM, x + 302);
    });
  }
  const lineY = UPPER - 86;
  d.curve(
    [-22, lineY - 6, 60, lineY + 8 + sway * 20, 150, lineY + 10 + sway * 20, 258, lineY - 4],
    FORM,
    311,
  );
  const cloths = [CANVAS, 0xd9c7a0, CANVAS, 0xcdd3c8, CANVAS, 0xe0c9a6];
  cloths.forEach((cloth, k) => {
    const cx = 14 + k * 38 + (k > 2 ? 26 : 0);
    const cy = lineY + 5 + Math.sin((k + 1) * 0.55) * 4 + sway * 16;
    const sw = sway * 70 + Math.sin(t * 2.2 + k) * 4 * s.walk + s.walk * 6;
    const w = 20 + (k % 3) * 5;
    const h = 30 + ((k * 7) % 3) * 9;
    d.body(
      [
        cx,
        cy,
        cx + w,
        cy + 1,
        cx + w - sw * 0.9,
        cy + h,
        cx + w / 2 - sw,
        cy + h - 5,
        cx - sw * 0.9,
        cy + h + 2,
      ],
      { smooth: false, wash: cloth, washAlpha: 1, weight: FORM, seed: 312 + k },
    );
  });
  // The galley's stovepipe comes up through the open deck.
  d.body([104, -260, 104, ROOF - 40, 96, ROOF - 46, 126, ROOF - 46, 118, ROOF - 40, 118, -260], {
    smooth: false,
    wash: IRON,
    washAlpha: 0.9,
    weight: fine > 0.4 ? CONTOUR : FORM,
    seed: 321,
  });

  // ---- Clutter in each room: pipes, stores, tools, rugs.
  F(() => {
    // The hold: pipes under the beams with a valve, a ladder up, hams hung to cure, rope, more cargo.
    d.line(-258, -122, 246, -120, CONTOUR, 601);
    d.line(-258, -114, -60, -113, FORM, 602);
    for (const x of [-200, -90, 60, 180]) d.line(x, -132, x, -118, FORM, x + 603);
    d.curve(d.round(-150, -118, 9, 9, 8), FORM, 604, true);
    d.line(-159, -118, -141, -118, HAIR, 605);
    ladder(-168, HOLD, -132);
    for (let k = 0; k < 4; k++) {
      const hx = 70 + k * 22;
      const sw = sway * 50;
      d.line(hx, -132, hx + sw, -112, HAIR, 606 + k);
      d.body(
        [
          hx - 6 + sw,
          -112,
          hx + 6 + sw,
          -112,
          hx + 8 + sw * 1.3,
          -88 - (k % 2) * 6,
          hx - 4 + sw * 1.3,
          -84 - (k % 2) * 6,
        ],
        { wash: 0xb07a5c, washAlpha: 0.9, weight: FORM, seed: 610 + k },
      );
    }
    for (let k = 0; k < 3; k++)
      d.curve(d.round(244 - k * 2, HOLD - 8 - k * 7, 18 - k * 2, 6, 8), FORM, 614 + k, true);
    // The bunk room: a shelf of boots, a rug.
    d.line(270, -92, 330, -92, FORM, 617);
    for (let k = 0; k < 3; k++)
      d.path(
        [
          278 + k * 18,
          -92,
          278 + k * 18,
          -104,
          284 + k * 18,
          -104,
          285 + k * 18,
          -96,
          292 + k * 18,
          -92,
        ],
        FORM,
        618 + k,
      );
    // The forge: coal heaped by the hearth, shoes on the wall, a quench bucket.
    d.fill(
      [-470, MAIN, -462, MAIN - 16, -444, MAIN - 24, -426, MAIN - 14, -420, MAIN],
      INK,
      0.92,
      true,
    );
    for (let k = 0; k < 3; k++)
      d.curve(
        [
          -392 + k * 20,
          -236,
          -398 + k * 20,
          -222,
          -388 + k * 20,
          -214,
          -380 + k * 20,
          -224,
          -384 + k * 20,
          -236,
        ],
        FORM,
        621 + k,
      );
    // The bench: a stool, pegs of tools.
    d.path([-100, MAIN, -98, MAIN - 24, -76, MAIN - 24, -74, MAIN], FORM, 625);
    for (let k = 0; k < 3; k++)
      d.line(-108 + k * 7, -246, -108 + k * 7, -224 + k * 5, FORM, 626 + k);
    // The stair: cloaks on hooks, off duty.
    for (let k = 0; k < 2; k++) {
      const cx = 36 + k * 20;
      d.body([cx - 6, -246, cx + 6, -246, cx + 10 + sway * 30, -204, cx - 9 + sway * 30, -202], {
        wash: k ? 0xcdbf9f : 0xb8ad94,
        washAlpha: 0.95,
        weight: FORM,
        seed: 630 + k,
      });
    }
    // The galley: plates on a rail, herbs drying, a rug under the table.
    d.line(160, -232, 206, -232, FORM, 633);
    for (let k = 0; k < 4; k++)
      d.curve([164 + k * 11, -232, 169 + k * 11, -244, 174 + k * 11, -232], FORM, 634 + k);
    for (let k = 0; k < 3; k++) {
      const hx = 136 + k * 9;
      d.line(hx, -260, hx + sway * 30, -244, HAIR, 638 + k);
      d.curve(
        [hx - 3 + sway * 30, -244, hx + sway * 34, -232, hx + 3 + sway * 30, -244],
        FORM,
        641 + k,
      );
    }
    d.line(210, MAIN - 3, 330, MAIN - 3, FORM, 644);
    // The chart room: a globe, rolled charts in a bin.
    d.body(d.round(354, -196, 11, 11, 8), {
      wash: 0xa9b4b0,
      washAlpha: 0.7,
      weight: FORM,
      seed: 645,
    });
    d.line(354, -185, 354, -174, FORM, 646);
    d.curve([343, -196, 354, -192, 365, -196], HAIR, 647);
    for (let k = 0; k < 3; k++)
      d.line(534 + k * 6, MAIN, 530 + k * 8, MAIN - 40 - k * 4, CONTOUR, 648 + k);
    // Shot stacked by the guns.
    for (const gx of [-700, 720]) {
      d.body(d.box(gx - 14, MAIN - 16, gx + 14, MAIN), {
        smooth: false,
        wash: TIMBER,
        weight: FORM,
        seed: gx + 651,
      });
      d.body(d.box(gx - 9, MAIN - 30, gx + 12, MAIN - 16), {
        smooth: false,
        wash: TIMBER,
        weight: FORM,
        seed: gx + 652,
      });
    }
    // The cabin: curtains at the window. The open deck: casks, and herbs in boxes along the rail.
    d.curve([-216, UPPER - 94, -206, UPPER - 74, -214, UPPER - 54], FORM, 655);
    d.curve([-176, UPPER - 94, -186, UPPER - 74, -178, UPPER - 54], FORM, 656);
  });
  barrel(176, UPPER, 13, 32);
  barrel(206, UPPER, 14, 36, BRASS);
  for (let k = 0; k < 2; k++) {
    const bx = -110 + k * 52;
    d.body(d.box(bx, UPPER - 42, bx + 36, UPPER - 30), {
      smooth: false,
      wash: TIMBER,
      washAlpha: 0.95,
      weight: FORM,
      seed: 660 + k,
    });
    F(() => {
      for (let leaf = 0; leaf < 5; leaf++)
        d.curve(
          [
            bx + 4 + leaf * 7,
            UPPER - 42,
            bx + 2 + leaf * 7 + sway * 20,
            UPPER - 52,
            bx + 6 + leaf * 7 + sway * 30,
            UPPER - 58 - (leaf % 2) * 5,
          ],
          FORM,
          662 + k * 5 + leaf,
        );
    });
    d.wash(d.round(bx + 18, UPPER - 52, 20, 9, 8), 0x9aa884, 0.5, true);
  }

  // ---- People, at their stations.
  let spots = spotCache.get(s.crowd.length);
  if (!spots) {
    spots = spotsFor(s.crowd.length);
    spotCache.set(s.crowd.length, spots);
  }
  const tall = s.crowd.length > 40 ? 54 : 82;
  const detail = detailFor(tall * zoom);
  for (let i = 0; i < s.crowd.length; i++) {
    if (!s.aboard(i)) continue;
    const look = s.crowd[i] as Look;
    const sp = spots[i] as Spot;
    const at = poseAt(sp, look.id, t);
    const size =
      i < STATIONS.length
        ? Math.max(tall, s.crowd.length > 40 ? 62 : 82)
        : tall * (0.92 + hash(i, 61) * 0.16);
    drawCitizen(d, look, at.p, at.x, at.y, size, detail);
    if (s.names) {
      // Someone lying down has no hat top: the tag goes over the middle of them.
      const up = at.p.down === 0 ? size * HAT_TOP : size * 0.6;
      s.names.push({
        x: d.sx(at.x, at.y - up),
        y: d.sy(at.x, at.y - up),
        name: look.name,
        rgb: look.cloak,
      });
    }
  }

  // ---- Floors and posts, in front of the rooms they frame.
  const floor = (x0: number, x1: number, y: number, key: number): void => {
    d.body(d.box(x0, y, x1, y + 8), {
      smooth: false,
      wash: shade(TIMBER, 0.2),
      washAlpha: 1,
      weight: 0,
      seed: key,
    });
    d.line(x0, y, x1, y, CONTOUR, key + 1);
    d.line(x0, y + 8, x1, y + 8, FORM, key + 2);
    H(() => {
      for (let x = x0 + 30; x < x1; x += 46 + hash(x, key) * 20)
        d.line(x, y + 1, x, y + 7, HAIR, key + x);
    });
  };
  floor(-590, 590, HOLD, 401);
  floor(-742, 772, MAIN, 402);
  floor(-506, 542, UPPER, 403);
  for (const x of [-590, -265, 254, 590]) d.line(x, HOLD, x, -132, CONTOUR, x + 411);
  for (const x of [-566, -316, -86, 74, 334, 564]) d.line(x, MAIN, x, -260, CONTOUR, x + 412);
  for (const x of [-376, -146, 254, 524])
    d.line(x, UPPER, x, x > 0 ? ROOF - 30 : ROOF, CONTOUR, x + 413);
  d.line(-506, UPPER, -506, UPPER - 34, CONTOUR, 414);
  d.line(542, UPPER, 542, UPPER - 34, CONTOUR, 415);
  // The cut edge of the hull round the hold: plate with its thickness showing.
  d.path([-596, -136, -596, HOLD + 8, 596, HOLD + 8, 596, -136], HEAVY, 421);
  // The forge's lean-to roof and its chimney.
  d.body([-580, -260, -506, -312, -506, -260], {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 431,
  });
  F(() => {
    for (let k = 1; k < 4; k++) d.line(-580 + k * 18, -262, -506, -312 + k * 13, HAIR, 432 + k);
  });
  d.body([-548, -280, -546, -478, -554, -486, -520, -486, -528, -478, -526, -296], {
    smooth: false,
    wash: IRON,
    washAlpha: 0.92,
    seed: 436,
  });
  d.hatch([-536, -478, -528, -478, -526, -296, -535, -290], 3, INK, 0.6);
  F(() => {
    d.line(-547, -420, -527, -420, FORM, 437);
    d.line(-547, -350, -527, -350, FORM, 438);
  });

  // ---- The crane at the stern, its load swinging.
  const jib = Math.sin(t * 0.33) * 22;
  d.body(d.box(-452, -440, -436, UPPER), {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 441,
  });
  d.body(beam(-444, -436, -596 + jib, -470, 12, 7), {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 442,
  });
  d.line(-444, -440, -520 + jib * 0.5, -453, FORM, 443);
  d.line(-444, -330, -520 + jib * 0.5, -453, FORM, 444);
  const loadX = -596 + jib + sway * 150;
  d.line(-596 + jib, -470, loadX, -330, FORM, 445);
  d.body(d.box(loadX - 20, -330, loadX + 20, -296), {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 446,
  });
  F(() => {
    d.line(loadX - 20, -330, loadX + 20, -296, FORM, 447);
    d.line(loadX, -330, loadX - 20, -344, HAIR, 448);
    d.line(loadX, -330, loadX + 20, -344, HAIR, 449);
  });
  // A water tank on the stern deck's roof beam.
  d.body(
    [
      -208,
      ROOF - 2,
      -214,
      ROOF - 30,
      -200,
      ROOF - 54,
      -160,
      ROOF - 54,
      -146,
      ROOF - 30,
      -152,
      ROOF - 2,
    ],
    { wash: TIMBER, washAlpha: 0.9, seed: 451 },
  );
  F(() => {
    d.curve([-212, ROOF - 36, -180, ROOF - 32, -148, ROOF - 36], FORM, 452);
    d.curve([-210, ROOF - 16, -180, ROOF - 12, -150, ROOF - 16], FORM, 453);
  });

  // ---- Added structures that break the outline: a watch-house at the stern, a boat on davits, fenders, a painted strake.
  d.body([-506, UPPER, -506, ROOF - 44, -400, ROOF - 44, -400, UPPER], {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.9,
    seed: 701,
  });
  d.wash([-506, ROOF - 44, -400, ROOF - 44, -400, ROOF + 10, -506, ROOF - 10], 0x6b5540, 0.3);
  d.hatch([-424, ROOF - 44, -400, ROOF - 44, -400, UPPER, -416, UPPER], 2, INK, 0.55);
  d.body([-520, ROOF - 40, -456, ROOF - 122, -388, ROOF - 40], {
    smooth: false,
    wash: OXIDE,
    washAlpha: 0.92,
    weight: HEAVY,
    seed: 702,
  });
  d.hatch([-456, ROOF - 122, -388, ROOF - 40, -440, ROOF - 40], 2, INK, 0.6);
  d.body(d.box(-486, ROOF - 16, -462, ROOF + 22), {
    smooth: false,
    wash: LAMP,
    washAlpha: 0.7,
    weight: FORM,
    seed: 703,
  });
  d.body([-444, UPPER, -444, UPPER - 58, -432, UPPER - 66, -420, UPPER - 58, -420, UPPER], {
    smooth: false,
    spot: true,
    weight: FORM,
    seed: 704,
  });
  F(() => {
    d.line(-474, ROOF - 16, -474, ROOF + 22, HAIR, 705);
    d.line(-486, ROOF + 2, -462, ROOF + 2, HAIR, 706);
    for (let k = 1; k < 5; k++)
      d.line(
        lerp(-520, -456, k / 5) + 5,
        lerp(ROOF - 40, ROOF - 122, k / 5) + 9,
        lerp(-506, -456, k / 5),
        ROOF - 42,
        HAIR,
        707 + k,
      );
    for (let k = 0; k < 4; k++)
      d.line(-500, UPPER - 20 - k * 22, -402, UPPER - 21 - k * 22, HAIR, 712 + k);
  });
  // A painted strake under the main deck at either end, and fenders slung from it.
  for (const [x0, x1] of [
    [-740, -600],
    [600, 772],
  ] as const) {
    d.wash(
      [x0, -138, x1, -138, x1 + (x1 > 0 ? 8 : 0), -122, x0 - (x0 < 0 ? 6 : 0), -122],
      OXIDE,
      0.85,
    );
    d.line(x0 - (x0 < 0 ? 6 : 0), -122, x1 + (x1 > 0 ? 8 : 0), -122, FORM, x0 + 716);
  }
  for (let k = 0; k < 3; k++) {
    const fx = -712 + k * 34;
    const sw = sway * 40;
    d.line(fx, -138, fx + sw, -104, FORM, 718 + k);
    d.body(d.round(fx + sw, -92, 9, 13, 8, k + 3), {
      wash: CANVAS,
      washAlpha: 0.95,
      weight: fine > 0.4 ? CONTOUR : FORM,
      seed: 721 + k,
    });
  }
  // The boat, hung from davits off the prow quarter.
  const boat = sway * 60;
  d.line(700, -140, 696 + boat, -92, FORM, 725);
  d.line(772, -146, 770 + boat, -96, FORM, 726);
  d.body([682 + boat, -96, 786 + boat, -100, 774 + boat, -74, 742 + boat, -66, 700 + boat, -68], {
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 727,
  });
  d.hatch([740 + boat, -98, 786 + boat, -100, 774 + boat, -74, 742 + boat, -66], 2, INK, 0.55);
  F(() => d.curve([690 + boat, -86, 734 + boat, -80, 780 + boat, -88], FORM, 728));
  // Ratlines from the deck to the nest.
  d.line(-64, NEST, -138, UPPER - 30, FORM, 731);
  d.line(8, NEST, 74, UPPER - 30, FORM, 732);
  d.line(-52, NEST, -96, UPPER - 30, HAIR, 733);
  d.line(-6, NEST, 40, UPPER - 30, HAIR, 734);
  F(() => {
    for (let k = 1; k < 8; k++) {
      const u = k / 8;
      d.line(
        lerp(-64, -138, u),
        lerp(NEST, UPPER - 30, u),
        lerp(-52, -96, u),
        lerp(NEST, UPPER - 30, u),
        HAIR,
        735 + k,
      );
      d.line(
        lerp(8, 74, u),
        lerp(NEST, UPPER - 30, u),
        lerp(-6, 40, u),
        lerp(NEST, UPPER - 30, u),
        HAIR,
        745 + k,
      );
    }
  });

  // ---- The lantern mast: the tallest thing aboard, and the anchor of every view of the city.
  d.body([-41, UPPER, -37, -606, -23, -606, -19, UPPER], {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    weight: HEAVY,
    seed: 461,
  });
  d.hatch([-28, UPPER, -27, -606, -23, -606, -19, UPPER], 2, INK, 0.65);
  F(() => {
    for (const y of [-330, -400, -440, -560]) d.line(-40, y, -20, y - 2, FORM, y + 462);
  });
  // The crow's nest.
  d.body([-66, NEST, -72, NEST - 34, 12, NEST - 34, 6, NEST], {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 465,
  });
  F(() => {
    for (let k = 1; k < 5; k++) d.line(-70 + k * 16, NEST - 33, -66 + k * 15, NEST, HAIR, 466 + k);
  });
  d.line(-52, NEST, -32, NEST + 34, FORM, 471);
  d.line(-8, NEST, -28, NEST + 34, FORM, 472);
  // The yard, with a furled sail and a pennant streaming astern.
  d.body(beam(-136, -404, 82, -412, 9, 9), {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    seed: 473,
  });
  d.body([-124, -400, -94, -386, -40, -392, 14, -388, 72, -402, 72, -410, -124, -406], {
    wash: CANVAS,
    washAlpha: 0.95,
    weight: FORM,
    seed: 474,
  });
  F(() => {
    for (const x of [-90, -30, 30]) d.line(x, -410, x + 3, -390, HAIR, x + 475);
  });
  // Everything at the masthead is drawn from a little lower than it was first laid out.
  d.push();
  d.move(0, 34);
  const flap = (k: number): number =>
    Math.sin(t * 5 - k * 1.1) * (3 + k * 1.6) * (0.4 + s.walk * 0.6) + sway * 40;
  d.body(
    [
      -30,
      -640,
      -80,
      -636 + flap(1),
      -130,
      -648 + flap(2),
      -196,
      -636 + flap(3),
      -130,
      -630 + flap(2),
      -80,
      -620 + flap(1),
      -30,
      -622,
    ],
    { wash: 0xb5562f, washAlpha: 0.85, weight: FORM, seed: 475 },
  );
  // The lantern, hung from an arm at the masthead, swinging after each step.
  d.line(-30, -634, 44, -648, CONTOUR, 476);
  d.line(-30, -600, 30, -644, FORM, 477);
  const la = sway * 1.6;
  const lx = 40 + Math.sin(la) * 34;
  const ly = -646 + Math.cos(la) * 34;
  d.line(40, -647, lx, ly - 16, FORM, 478);
  d.body(
    [
      lx - 13,
      ly - 16,
      lx + 13,
      ly - 16,
      lx + 17,
      ly + 14,
      lx + 9,
      ly + 22,
      lx - 9,
      ly + 22,
      lx - 17,
      ly + 14,
    ],
    { smooth: false, wash: LAMP, washAlpha: 1, seed: 479 },
  );
  d.fill(d.round(lx, ly + 3, 6, 9, 7), 0xe2863a, 0.95, true);
  F(() => {
    d.line(lx - 15, ly - 2, lx + 15, ly - 2, FORM, 480);
    d.line(lx, ly - 16, lx, ly + 22, HAIR, 481);
  });
  d.body([lx - 9, ly - 16, lx, ly - 28, lx + 9, ly - 16], {
    smooth: false,
    wash: BRASS,
    weight: FORM,
    seed: 482,
  });
  // Stays to prow and stern, with a string of flags on the fore one.
  d.curve([-28, -628, 300, -480, 560, -350, 846, -230], FORM, 483);
  d.curve([-32, -628, -200, -548, -360, -490, -444, -474], FORM, 484);
  F(() => {
    for (let k = 0; k < 9; k++) {
      const u = 0.12 + k * 0.095;
      const fx = lerp(-28, 846, u) + 30 * Math.sin(u * 3);
      const fy = lerp(-628, -230, u) - 62 * Math.sin(u * Math.PI) * 0.5 + 12 * u;
      const fl = Math.sin(t * 6 + k * 1.3) * 3 * (0.3 + s.walk) + sway * 30;
      d.body([fx - 8, fy, fx + 8, fy + 6, fx - 2 - fl, fy + 26], {
        smooth: false,
        wash: k % 3 === 0 ? 0xb5562f : k % 3 === 1 ? CANVAS : BRASS,
        washAlpha: 0.9,
        weight: HAIR,
        seed: 485 + k,
      });
    }
  });

  d.pop();

  // ---- The prow: a beak of plate with a lamp slung under it; the stern rail and a ladder.
  F(() => {
    const pa = sway * 1.3;
    d.line(826, -178, 826 + Math.sin(pa) * 26, -178 + Math.cos(pa) * 26, FORM, 501);
    d.body(d.round(826 + Math.sin(pa) * 30, -178 + Math.cos(pa) * 34, 8, 10, 7), {
      wash: LAMP,
      washAlpha: 1,
      weight: FORM,
      seed: 502,
    });
    ladder(-728, -30, -140);
  });
  smoke(111, ROOF - 46, 3, 0.75);
  smoke(-537, -486, 1, 1.2);
  d.pop();

  // ---- The ramp, hinged at the hull's forward quarter.
  const [rx, ry] = out(RAMP_HINGE.x, RAMP_HINGE.y);
  const down = easeInOut(s.ramp);
  const folded = -1.9;
  const open = Math.atan2(0 - ry, RAMP_FOOT - rx);
  const angle = lerp(folded, open, down) + (s.ramp > 0.98 ? 0 : ring(s.ramp - 0.9, 30, 9) * 0.02);
  const length = Math.hypot(RAMP_FOOT - rx, ry);
  const ex = rx + Math.cos(angle) * length;
  const ey = ry + Math.sin(angle) * length;
  d.body(beam(rx, ry, ex, ey, 20, 14), {
    smooth: false,
    wash: TIMBER,
    washAlpha: 0.95,
    weight: HEAVY,
    seed: 511,
  });
  F(() => {
    for (let k = 1; k < 9; k++) {
      const bx = lerp(rx, ex, k / 9);
      const by = lerp(ry, ey, k / 9);
      d.line(bx - 3, by - 8, bx + 3, by + 8, FORM, 512 + k);
    }
  });
  if (s.ramp > 0.02) {
    // Chains from the hull to the ramp's end.
    const [cx, cy] = out(700, -120);
    d.curve(
      [cx, cy, lerp(cx, ex, 0.5), lerp(cy, ey, 0.5) + 30 * (1 - down), ex - 20, ey - 8],
      FORM,
      521,
    );
  }

  for (const leg of LEGS) if (!leg.far) drawLeg(leg);
  d.ink = INK;
  d.strength = base;
}

/** The ring of strokes and puff of dust where a foot has just come down. */
export function drawFootfall(d: Draw, x: number, y: number, age: number, key: number): void {
  if (age > 1.6) return;
  const k = age / 1.6;
  const strength = d.strength;
  // Held drawings, changing twelve times a second.
  const held = Math.floor(age * 12) / 12 / 1.6;
  const r = 40 + 90 * (1 - (1 - held) ** 2);
  d.strength = strength * (1 - k) ** 0.7;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + hash(key, i) * 0.4;
    const r0 = r * (0.78 + hash(i, key) * 0.1);
    const r1 = r * (1.0 + hash(i, key + 1) * 0.16);
    d.line(
      x + Math.cos(a) * r0,
      y + Math.sin(a) * r0 * 0.3,
      x + Math.cos(a) * r1,
      y + Math.sin(a) * r1 * 0.3,
      a > Math.PI ? FORM : CONTOUR,
      key + i,
    );
  }
  for (let i = 0; i < 5; i++) {
    const side = i % 2 ? 1 : -1;
    const px = x + side * (30 + held * 70 + i * 9);
    const py = y - 8 - held * 34 * (0.5 + hash(i, key + 2));
    const pr = 9 + held * 16 + i * 2;
    d.fill(d.round(px, py, pr, pr * 0.7, 8, key + i), PAPER, 0.7, true);
    d.curve(d.round(px, py, pr, pr * 0.7, 8, key + i).slice(0, 12), FORM, key + i + 20);
  }
  d.strength = strength;
}
