// Monsters (docs/art.md, section 6). They are made of ink: more black than
// anything friendly, grey washes only, paper for eyes and teeth. Rank is the
// first thing each drawing says. Fodder is drawn as a swarm that shares one
// outline; a pack monster is drawn singly in three builds; a brute is wide
// and carries a mass of spot black; the horde is a tide.

import { CONTOUR, type Draw, FORM, HAIR, INK, PAPER } from "./draw.ts";
import { clamp, lerp, smooth } from "./geom.ts";

const HIDE = 0x9a948a;
const HIDE_DARK = 0x77716a;
/** The horde's black (docs/art.md, section 3): bodies in it are drawn in this, lit by a paper line. */
export const HORDE_HIDE = 0x2c2420;

/**
 * The washes monsters are drawn in. A scene sets `horde` while it draws the
 * horde's bodies, so they are black with a paper line on their lantern side
 * and no paler wash than the bodies round them (docs/art.md, sections 3 and 6).
 */
export const TONE = { hide: HIDE, dark: HIDE_DARK, horde: false };

/** Draws `fn` with every monster in the horde's black. */
export function inHorde(fn: () => void): void {
  const was = { ...TONE };
  TONE.hide = HORDE_HIDE;
  TONE.dark = HORDE_HIDE;
  TONE.horde = true;
  try {
    fn();
  } finally {
    Object.assign(TONE, was);
  }
}

/**
 * How a monster is inked by how awake it is (docs/art.md, section 6), from 0
 * at rest through 1 alert to 2 awake. At rest: line at 45% ink, its wash at
 * half strength, no black and no hatching. Alert: line at 70%, full wash,
 * open hatching, ink eyes. Awake: full ink, its rank's hatching and black.
 */
export interface WakeInk {
  line: number;
  wash: number;
  /** Open hatching, and the rank's own hatching. */
  open: number;
  close: number;
  black: number;
}

export function wakeInk(wake: number): WakeInk {
  const w = clamp(wake, 0, 2);
  return {
    line: w <= 1 ? lerp(0.45, 0.7, w) : lerp(0.7, 1, w - 1),
    wash: w <= 1 ? lerp(0.5, 1, w) : 1,
    open: smooth(0.3, 0.9, w),
    close: smooth(1.2, 1.8, w),
    black: smooth(1.15, 1.75, w),
  };
}

/** A notched ridge down a leader's back, in ink, from (x0, y0) to (x1, y1) in the drawing's units. */
function ridge(
  d: Draw,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  teeth: number,
  high: number,
  alpha: number,
  seed: number,
): void {
  const pts: number[] = [];
  for (let k = 0; k <= teeth * 2; k++) {
    const u = k / (teeth * 2);
    const up = k % 2 ? high : 0;
    pts.push(lerp(x0, x1, u), lerp(y0, y1, u) - up);
  }
  d.path(pts, CONTOUR, seed, false, alpha);
}

export interface Mite {
  x: number;
  y: number;
  face: number;
  /** Where its legs are in their scuttle. */
  phase: number;
  /** Over 1 stretched along its length, under 1 squashed. */
  stretch: number;
  /** Drawn in paper with line only: the frame it is hit. */
  flash: boolean;
  seed: number;
  /** Which of three builds: humped, long and low, or round with pincers. */
  build?: number;
  /** Height off the ground, for one thrown by a blow. */
  z?: number;
  /** 0 to 1: lunging at what it is after. */
  lunge?: number;
  /** How awake it is, 0 at rest to 2 awake; awake if not said. */
  wake?: number;
  /** The swarm's leader: a head taller, with a notched ridge. */
  leader?: boolean;
}

// A skitter in three builds: a humped body carried high on six thin legs, a black shell, one eye.
const MITE_BODY = [
  [-0.5, -0.24, -0.44, -0.5, -0.12, -0.7, 0.28, -0.6, 0.54, -0.4, 0.5, -0.24],
  [-0.62, -0.22, -0.56, -0.4, -0.2, -0.54, 0.3, -0.5, 0.64, -0.34, 0.6, -0.2],
  [-0.42, -0.26, -0.44, -0.56, -0.1, -0.78, 0.26, -0.7, 0.46, -0.44, 0.42, -0.24],
] as const;
const MITE_SHELL = [
  [-0.48, -0.36, -0.42, -0.52, -0.12, -0.7, 0.26, -0.6, 0.12, -0.46, -0.2, -0.4],
  [-0.6, -0.3, -0.54, -0.42, -0.2, -0.54, 0.28, -0.5, 0.2, -0.4, -0.2, -0.36],
  [-0.4, -0.4, -0.42, -0.58, -0.1, -0.78, 0.24, -0.7, 0.14, -0.5, -0.16, -0.44],
] as const;

/**
 * A swarm of fodder, `size` long each in the drawing's units. Bodies that
 * overlap share one outline: every outline is laid first, then every body.
 */
export function drawSwarm(d: Draw, mites: readonly Mite[], count: number, size: number): void {
  const px = size * d.zoom;
  const pad = 1 + 5.2 / px;
  const grown: number[] = [];
  const at = (m: Mite): number => size * (m.leader ? 1.3 : 1);
  // Legs, spines and every outline first; then every body. Bodies that overlap share one outline.
  for (let i = 0; i < count; i++) {
    const m = mites[i] as Mite;
    const ink = wakeInk(m.wake ?? 2);
    const s = at(m);
    const b = (m.build ?? 0) % 3;
    const BODY = MITE_BODY[b] as readonly number[];
    d.push();
    d.move(m.x, m.y);
    d.hatch(
      [-s * 0.5, -s * 0.04, s * 0.5, -s * 0.04, s * 0.4, s * 0.07, -s * 0.4, s * 0.07],
      2,
      INK,
      0.5 * ink.wash,
    );
    d.move(0, -(m.z ?? 0));
    d.scale(s * m.face * m.stretch, s / m.stretch);
    if ((m.z ?? 0) > 0) d.turn(-0.6);
    if ((m.lunge ?? 0) > 0) d.shear(-0.3 * (m.lunge ?? 0)).move(0.15 * (m.lunge ?? 0), 0);
    // At rest a swarm is one pale shape: no legs or spines, only the shared outline.
    if (ink.open > 0.05) {
      if (b === 2) {
        // Pincers out in front.
        d.curve([0.4, -0.38, 0.66, -0.5, 0.74, -0.3], CONTOUR, m.seed + 40, false, ink.line);
        d.curve([0.36, -0.3, 0.6, -0.22, 0.7, -0.1], CONTOUR, m.seed + 41, false, ink.line);
      }
      for (let leg = 0; leg < 3; leg++) {
        const lx = -0.26 + leg * 0.27;
        const swing = Math.sin(m.phase * Math.PI * 2 + leg * 2.1) * 0.14;
        const a = ink.line * ink.open;
        d.line(lx, -0.3, lx - 0.16 + swing, -0.44, FORM, m.seed + leg, a);
        d.line(lx - 0.16 + swing, -0.44, lx - 0.26 + swing * 1.6, 0, FORM, m.seed + leg + 3, a);
        d.line(lx + 0.06, -0.3, lx + 0.2 - swing, -0.4, FORM, m.seed + leg + 6, a);
        d.line(lx + 0.2 - swing, -0.4, lx + 0.3 - swing * 1.6, 0.02, FORM, m.seed + leg + 9, a);
      }
    }
    grown.length = 0;
    for (let k = 0; k < BODY.length; k += 2)
      grown.push((BODY[k] as number) * pad, ((BODY[k + 1] as number) + 0.45) * pad - 0.45);
    d.fill(grown, INK, ink.line, true);
    // Spines along the shell: three, two long ones, or four short.
    if (ink.black > 0.02) {
      const a = ink.black;
      if (b === 0) {
        d.fill([-0.34, -0.58, -0.4, -0.92, -0.18, -0.66], INK, a);
        d.fill([-0.08, -0.68, -0.06, -1.0, 0.1, -0.66], INK, a);
        d.fill([0.16, -0.62, 0.3, -0.86, 0.3, -0.56], INK, a);
      } else if (b === 1) {
        d.fill([-0.4, -0.42, -0.62, -0.78, -0.2, -0.52], INK, a);
        d.fill([0.0, -0.52, -0.06, -0.92, 0.18, -0.5], INK, a);
      } else
        for (let q = 0; q < 4; q++) {
          const sx = -0.34 + q * 0.2;
          d.fill(
            [sx - 0.06, -0.62 - (q % 2) * 0.08, sx, -0.9, sx + 0.07, -0.64 - (q % 2) * 0.08],
            INK,
            a,
          );
        }
    }
    d.pop();
  }
  for (let i = 0; i < count; i++) {
    const m = mites[i] as Mite;
    const ink = wakeInk(m.wake ?? 2);
    const s = at(m);
    const b = (m.build ?? 0) % 3;
    const BODY = MITE_BODY[b] as readonly number[];
    const SHELL = MITE_SHELL[b] as readonly number[];
    d.push();
    d.move(m.x, m.y - (m.z ?? 0));
    d.scale(s * m.face * m.stretch, s / m.stretch);
    if ((m.z ?? 0) > 0) d.turn(-0.6);
    if ((m.lunge ?? 0) > 0) d.shear(-0.3 * (m.lunge ?? 0)).move(0.15 * (m.lunge ?? 0), 0);
    d.fill(BODY, PAPER, 1, true);
    if (!m.flash) {
      d.fill(BODY, TONE.hide, 0.9 * ink.wash, true);
      if (ink.black > 0.02) d.fill(SHELL, INK, ink.black, true);
      else if (ink.open > 0.05) d.hatch(SHELL, 1, INK, 0.8 * ink.open, true);
    }
    // The eye: paper on the black shell, or a dot of ink: a head as a dot at rest.
    const ex = b === 1 ? 0.46 : 0.34;
    const ey = b === 1 ? -0.36 : -0.44;
    if (ink.black > 0.5) d.dot(ex, ey, Math.max(1.3, px * 0.075), PAPER);
    else d.dot(ex, ey, Math.max(1.3, px * 0.07), INK, ink.line);
    if (m.leader) ridge(d, -0.44, -0.6, 0.24, -0.66, 3, 0.16, Math.max(0.5, ink.line), m.seed + 50);
    d.pop();
  }
}

export interface BeastPose {
  face: number;
  /** Where in its stride it is, 0 to 1. */
  stride: number;
  /** 0 standing to 1 at a full run. */
  speed: number;
  /** 0 to 1: drawn back before a lunge. */
  coil: number;
  /** 0 to 1: thrown forward in a lunge, jaws open. */
  lunge: number;
  /** 0 to 1: how lately it was hit; 1 is the frame of the blow. */
  hurt: number;
  /** Over 1 stretched, under 1 squashed. */
  stretch: number;
  /** How much ink it has left, 0 to 1: its hatching thins as its hitpoints go. */
  ink: number;
  flash: boolean;
  /** 0 to 1: lying down, legs folded, as in a sleeping heap. */
  rest: number;
  /** Where the head is carried: -1 down to the ground (gnawing, stalking), 0 level, 1 up and alert. */
  head: number;
  /** How awake it is: 0 at rest, 1 alert, 2 awake. Its ink follows this. */
  wake: number;
  /** A pack's leader: a head taller (the caller scales it) with a notched ridge in ink. */
  leader: boolean;
}

export const beastPose = (over: Partial<BeastPose>): BeastPose => ({
  face: 1,
  stride: 0,
  speed: 0,
  coil: 0,
  lunge: 0,
  hurt: 0,
  stretch: 1,
  ink: 1,
  flash: false,
  rest: 0,
  head: 0,
  wake: 2,
  leader: false,
  ...over,
});

/**
 * A pack monster: a lean hound of ink, `size` tall at the shoulder, in one of
 * three builds. Low with its head down when it stalks, coiled before it
 * lunges, stretched out in the lunge.
 */
export function drawHound(
  d: Draw,
  x: number,
  y: number,
  size: number,
  p: BeastPose,
  build: number,
  seed: number,
): void {
  const px = size * d.zoom;
  const heavy = build === 1 ? 1 : 0;
  const lanky = build === 2 ? 1 : 0;
  const gather = Math.sin(p.stride * Math.PI * 2) * p.speed;
  const reach = 1 + gather * 0.1 + p.lunge * 0.22 - p.coil * 0.14 + p.rest * 0.1;
  const low = (1 - p.speed) * 0.1 + p.coil * 0.2 + p.rest * 0.52 + Math.max(0, -p.head) * 0.12;
  const strength = d.strength;
  const ink = wakeInk(p.wake);
  d.push();
  d.move(x, y);
  d.hatch(
    [
      -size * 1.1,
      -size * 0.06,
      size * 1.2,
      -size * 0.06,
      size * 1.0,
      size * 0.1,
      -size * 0.9,
      size * 0.1,
    ],
    2,
    INK,
    0.5 * ink.wash,
  );
  d.scale(size * p.face * p.stretch, size / p.stretch);
  d.shear(-p.hurt * 0.5);
  const legLen = 0.56 + lanky * 0.1;
  const top = -(legLen + 0.42) + low;
  const X = (v: number): number => v * reach - p.coil * 0.15 + p.lunge * 0.2;
  // Legs: the far pair first.
  const stride = p.stride * Math.PI * 2;
  const leg = (hx: number, front: boolean, far: boolean): void => {
    const phase = stride + (front ? 0 : Math.PI * 0.9) + (far ? 0.6 : 0);
    const swing =
      Math.sin(phase) * 0.5 * p.speed + (front ? 1 : -1) * (p.lunge * 0.5 - p.coil * 0.2);
    const lift = Math.max(0, Math.cos(phase)) * 0.16 * p.speed;
    const fx = hx + swing * 0.7 + (front ? 0.05 : -0.05) + p.rest * (front ? 0.38 : 0.22);
    const fy = -lift;
    const kx = (hx + fx) / 2 + (front ? -0.1 : 0.16);
    const ky = top + 0.42 + legLen * 0.5 - lift * 0.5;
    d.strength = strength * (far ? 0.7 : 1);
    d.curve(
      [hx, top + 0.4, kx, ky, fx, fy],
      CONTOUR,
      seed + (front ? 1 : 2) + (far ? 4 : 0),
      false,
      ink.line,
    );
    d.line(fx, fy, fx + 0.14, fy + 0.01, CONTOUR, seed + 9, ink.line);
    d.strength = strength;
  };
  leg(X(0.52), true, true);
  leg(X(-0.62), false, true);
  // The tail, carried out behind; it whips when the beast is hit.
  const wag = Math.sin(stride * 0.5 + seed) * 0.08 - p.hurt * 0.3;
  d.curve(
    [X(-0.86), top + 0.12, X(-1.3), top + 0.02 + wag, X(-1.62), top + 0.3 + wag * 2],
    CONTOUR,
    seed + 11,
    false,
    ink.line,
  );
  // Body, neck and head in one outline.
  const head =
    low * 0.9 +
    p.coil * 0.1 -
    p.lunge * 0.08 +
    (1 - p.speed) * 0.12 -
    p.head * 0.16 +
    Math.max(0, -p.head) * 0.18 +
    p.rest * 0.12;
  const jaw = p.lunge * 0.16;
  const body = [
    X(-0.92),
    top + 0.14,
    X(-0.3),
    top - 0.02 - heavy * 0.03,
    X(0.3),
    top - 0.08 - heavy * 0.12,
    X(0.62),
    top - 0.2 + head,
    X(0.74),
    top - 0.46 + head,
    X(0.92),
    top - 0.24 + head,
    X(1.42),
    top - 0.02 + head - jaw * 0.3,
    X(1.12),
    top + 0.16 + head + jaw,
    X(0.72),
    top + 0.22 + head * 0.6,
    X(0.56),
    top + 0.5,
    X(-0.2),
    top + 0.44 - lanky * 0.04,
    X(-0.8),
    top + 0.42,
    X(-1.0),
    top + 0.3,
  ];
  d.body(body, { wash: p.flash ? PAPER : TONE.hide, washAlpha: 0.9 * ink.wash, weight: 0 });
  d.curve(body, CONTOUR, seed + 20, true, ink.line);
  if (!p.flash) {
    // A ragged mane of spot black down the back. As it loses ink the black breaks into hatching.
    const mane = [
      X(-0.86),
      top + 0.16,
      X(-0.3),
      top,
      X(0.3),
      top - 0.06 - heavy * 0.12,
      X(0.6),
      top - 0.18 + head,
      X(0.74),
      top - 0.44 + head,
      X(0.84),
      top - 0.2 + head,
      X(0.6),
      top + 0.02 + head * 0.5,
      X(0.38),
      top + 0.18,
      X(0.14),
      top + 0.1,
      X(-0.1),
      top + 0.24,
      X(-0.4),
      top + 0.16,
      X(-0.62),
      top + 0.28,
    ];
    if (ink.black > 0.02) {
      if (p.ink > 0.6) d.fill(mane, INK, ink.black, true);
      else d.hatch(mane, 3, INK, 0.9 * ink.black, true);
    }
    if (ink.open > 0.02 && ink.black < 0.98)
      d.hatch(mane, 1, INK, 0.8 * ink.open * (1 - ink.black), true);
    d.hatch(
      [
        X(-0.8),
        top + 0.3,
        X(0.5),
        top + 0.3,
        X(0.56),
        top + 0.5,
        X(-0.2),
        top + 0.44,
        X(-0.8),
        top + 0.42,
      ],
      1,
      INK,
      0.7 * p.ink * ink.open,
    );
    if (p.leader) ridge(d, X(-0.7), top + 0.06, X(0.5), top - 0.12, 4, 0.16, ink.line, seed + 40);
  }
  // An eye, shut in sleep, and teeth when the jaws open: paper on the black mane, ink on the hide.
  if (p.rest > 0.5)
    d.line(X(0.94), top - 0.08 + head, X(1.08), top - 0.06 + head, FORM, seed + 31, ink.line);
  else if (ink.black > 0.5 && !p.flash)
    d.dot(X(1.0), top - 0.1 + head, Math.max(1.3, px * 0.055), PAPER);
  else d.dot(X(1.0), top - 0.1 + head, Math.max(1.3, px * 0.05), INK, ink.line);
  if (jaw > 0.04) {
    d.fill(
      [X(1.14), top + 0.1 + head, X(1.36), top + 0.03 + head, X(1.2), top + 0.1 + head + jaw],
      PAPER,
    );
    d.line(X(1.14), top + 0.09 + head, X(1.38), top + 0.02 + head - jaw * 0.3, FORM, seed + 30);
  }
  leg(X(0.44), true, false);
  leg(X(-0.72), false, false);
  d.pop();
  d.strength = strength;
}

/**
 * A brute's parts at rest, in units of its height, facing right with its
 * feet on y = 0 (docs/art.md, section 6). It walks on its knuckles: the
 * forelimbs are longer than the hind legs, bend at the elbow and narrow by
 * half from shoulder to wrist with the fist wider again. Its belly is a
 * fifth of its height off the ground, so what is behind shows under it. It
 * is widest above its middle, no wider than it is tall, and carries its head
 * low and forward of the forelimbs with the lower jaw open.
 */
/** A forelimb's joints at rest: the shoulder, the elbow, the wrist; and its widths there. */
const SHOULDER = [0.08, -0.8] as const;
const UPPER = 0.41;
const FOREARM = 0.34;
/** At rest the upper arm runs down and forward from the shoulder, the forearm straight down. */
const ARM_REST = [1.01, 1.57] as const;

/** A forelimb as one outline from its joints, with the fist on the end: shoulder `sx, sy`, angles of the two bones. */
function forelimb(sx: number, sy: number, upper: number, lower: number): number[] {
  const ex = sx + Math.cos(upper) * UPPER;
  const ey = sy + Math.sin(upper) * UPPER;
  const wx = ex + Math.cos(lower) * FOREARM;
  const wy = ey + Math.sin(lower) * FOREARM;
  const side = (a: number, w: number): [number, number] => [-Math.sin(a) * w, Math.cos(a) * w];
  const [s0x, s0y] = side(upper, 0.11);
  const [e0x, e0y] = side((upper + lower) / 2, 0.075);
  const [w0x, w0y] = side(lower, 0.045);
  // The fist: wider again than the wrist, its knuckles on the end of the forearm.
  const fx = Math.cos(lower);
  const fy = Math.sin(lower);
  const [k0x, k0y] = side(lower, 0.085);
  return [
    sx + s0x,
    sy + s0y,
    ex + e0x,
    ey + e0y,
    wx + w0x,
    wy + w0y,
    wx + k0x + fx * 0.03,
    wy + k0y + fy * 0.03,
    wx + k0x * 0.8 + fx * 0.11,
    wy + k0y * 0.8 + fy * 0.11,
    wx - k0x * 0.8 + fx * 0.11,
    wy - k0y * 0.8 + fy * 0.11,
    wx - k0x + fx * 0.03,
    wy - k0y + fy * 0.03,
    wx - w0x,
    wy - w0y,
    ex - e0x,
    ey - e0y,
    sx - s0x,
    sy - s0y,
  ];
}

export const BRUTE_PARTS = {
  /**
   * Body: a wedge, narrow at the hips and deep at the shoulders, its back
   * rising to the hump and its belly sloping up toward the chest, clear of the
   * ground.
   */
  body: [
    -0.36, -0.3, -0.4, -0.46, -0.32, -0.64, -0.14, -0.86, 0.04, -0.99, 0.2, -0.97, 0.31, -0.86, 0.3,
    -0.7, 0.17, -0.52, 0.0, -0.38, -0.15, -0.3, -0.28, -0.27,
  ],
  /** The skull, low and forward of the forelimbs, with a heavy brow; and the open lower jaw under it. */
  head: [0.3, -0.76, 0.46, -0.79, 0.56, -0.71, 0.6, -0.61, 0.5, -0.58, 0.38, -0.59, 0.29, -0.66],
  jaw: [0.36, -0.55, 0.57, -0.53, 0.54, -0.45, 0.38, -0.46],
  /** A forelimb, shoulder to elbow to the fist on its knuckles; and a hind leg, hip to foot. */
  fore: forelimb(SHOULDER[0], SHOULDER[1], ARM_REST[0], ARM_REST[1]),
  hind: [
    -0.39, -0.5, -0.15, -0.48, -0.12, -0.27, -0.08, -0.05, -0.1, 0, -0.35, 0, -0.32, -0.12, -0.4,
    -0.3,
  ],
  /** The mane: black over the hump and shoulders, on top of the outline. */
  mane: [
    -0.24, -0.8, 0.04, -0.99, 0.2, -0.97, 0.31, -0.86, 0.27, -0.76, 0.19, -0.83, 0.1, -0.74, 0.0,
    -0.83, -0.1, -0.76, -0.17, -0.82,
  ],
} as const;

/** Where the hips are: rearing to strike, everything above them tips back round this point. */
const BRUTE_HIP = [-0.28, -0.42] as const;
/** How far back it rears at the top of its wind-up, in radians: its spine goes past 50 degrees. */
export const BRUTE_REAR = 0.55;

/**
 * The parts moved for a pose. Standing, one forelimb is off the ground or it
 * is in mid-stride, so it is never square. Winding up it rears: hind legs
 * planted, spine tipped back, both forelimbs bent over the head. In the slam
 * it comes down forward on both fists.
 */
function brutePose(
  p: BeastPose,
  step: number,
): {
  body: number[];
  head: number[];
  jaw: number[];
  mane: number[];
  fore: number[];
  farFore: number[];
  hind: number[];
  farHind: number[];
} {
  const rear = p.coil * BRUTE_REAR - p.lunge * 0.14;
  const cr = Math.cos(rear);
  const sr = Math.sin(rear);
  const tip = (pts: readonly number[], dx = 0, dy = 0): number[] => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) {
      const x = (pts[i] as number) + dx - BRUTE_HIP[0];
      const y = (pts[i + 1] as number) + dy - BRUTE_HIP[1];
      out.push(BRUTE_HIP[0] + x * cr + y * sr, BRUTE_HIP[1] - x * sr + y * cr);
    }
    return out;
  };
  // Standing still it holds the near fist up off the ground; walking, the limbs swing. Rearing,
  // the upper arm swings up and forward and the forearm folds back over the head; in the slam
  // both come down forward on the fists.
  const still = (1 - p.speed) * (1 - p.coil) * (1 - p.lunge);
  // `lift` raises the fist about a tenth of the height off the ground: the elbow comes forward
  // and the forearm angles back, so the fist stays inside the drawing's width.
  // Raised, the angles are in the body's frame before it tips back: the near upper arm ends up
  // pointing up and forward, the far one straighter up, both forearms folded back over the head.
  const limb = (
    dx: number,
    swing: number,
    lift: number,
    raised: readonly [number, number],
  ): number[] => {
    const up = p.coil;
    const upper =
      lerp(ARM_REST[0] + swing - lift * 0.27, raised[0], up) * (1 - p.lunge) + p.lunge * 0.55;
    const lower =
      lerp(ARM_REST[1] + swing * 0.6 + lift * 0.18, raised[1], up) * (1 - p.lunge) + p.lunge * 0.95;
    return tip(forelimb(SHOULDER[0] + dx, SHOULDER[1], upper, lower));
  };
  const fore = limb(0, step * 0.18, still + Math.max(0, step) * 0.6, [-0.2, -2.1]);
  const farFore = limb(-0.07, -step * 0.18 - still * 0.1, Math.max(0, -step) * 0.6, [-0.75, -2.5]);
  const down = (y: number, top: number): number => clamp((y - top) / -top);
  const H = BRUTE_PARTS.hind;
  const hind = H.map((v, i) => (i % 2 ? v : v - step * 0.05 * down(H[i + 1] as number, -0.47)));
  const farHind = H.map((v, i) =>
    i % 2 ? v : v + 0.06 + step * 0.05 * down(H[i + 1] as number, -0.47),
  );
  const open = 0.03 + p.lunge * 0.05 + p.coil * 0.05;
  return {
    body: tip(BRUTE_PARTS.body),
    head: tip(BRUTE_PARTS.head),
    jaw: tip(BRUTE_PARTS.jaw, 0, open),
    mane: tip(BRUTE_PARTS.mane),
    fore,
    farFore,
    hind,
    farHind,
  };
}

/**
 * A brute, `size` tall, on its knuckles with ground and its shadow under its
 * belly, widest above its middle, its head low and forward of the forelimbs
 * with two eyes and a row of teeth along the open lower jaw. On the map its
 * black is the mane and the forelimbs; in the horde (`TONE.horde`) it is all
 * black, shaped by a paper line down its lantern side. It is never square:
 * standing, one fist is off the ground. `coil` rears it to strike, `lunge`
 * brings it down.
 */
export function drawBrute(
  d: Draw,
  x: number,
  y: number,
  size: number,
  p: BeastPose,
  seed: number,
): void {
  const px = size * d.zoom;
  const strength = d.strength;
  const ink = wakeInk(p.wake);
  const horde = TONE.horde && !p.flash;
  const step = Math.sin(p.stride * Math.PI * 2) * p.speed;
  const parts = brutePose(p, step);
  d.push();
  d.move(x, y);
  // Its shadow on the ground under it, hatched, with ground showing between it and the belly.
  d.hatch(d.round(0.02 * size, 0.02 * size, size * 0.46, size * 0.09, 10), 3, INK, 0.55 * ink.wash);
  d.scale(size * p.face * p.stretch, size / p.stretch);
  d.shear(-p.hurt * 0.3);
  const hide = p.flash ? PAPER : TONE.hide;
  const dark = p.flash ? PAPER : TONE.dark;
  const limb = (pts: readonly number[], far: boolean, black: boolean, key: number): void => {
    d.strength = strength * (far ? 0.75 : 1);
    d.body(pts, { wash: dark, washAlpha: horde ? 1 : 0.95 * ink.wash, weight: 0 });
    if (black && !p.flash && !horde) {
      if (ink.black > 0.02) d.fill(pts, INK, ink.black, true);
      if (ink.open > 0.02 && ink.black < 0.98)
        d.hatch(pts, 1, INK, 0.8 * ink.open * (1 - ink.black), true);
    } else if (!p.flash && !horde) d.hatch(pts, ink.close > 0.5 ? 2 : 1, INK, 0.6 * ink.open, true);
    d.curve(pts, CONTOUR, seed + key, true, ink.line);
    d.strength = strength;
  };
  // The far limbs first.
  limb(parts.farHind, true, false, 1);
  limb(parts.farFore, true, true, 2);
  limb(parts.hind, false, false, 3);
  // The body over them.
  const B = parts.body;
  d.body(B, { wash: hide, washAlpha: horde ? 1 : 0.92 * ink.wash, weight: 0 });
  if (!p.flash && !horde) {
    // Its rank's hatching down the flank and haunch.
    d.hatch(
      [-0.38, -0.32, -0.37, -0.55, -0.22, -0.64, 0.06, -0.62, 0.16, -0.4, 0.0, -0.24, -0.25, -0.26],
      ink.close > 0.5 ? 2 : 1,
      INK,
      0.7 * ink.open * lerp(0.4, 1, p.ink),
      true,
    );
    // The mane: spot black over the hump, ragged along its lower edge.
    const M = parts.mane;
    if (ink.black > 0.02) {
      if (p.ink > 0.45) d.fill(M, INK, ink.black, false);
      else d.hatch(M, 3, INK, 0.9 * ink.black, false);
    }
    if (ink.open > 0.02 && ink.black < 0.98) d.hatch(M, 1, INK, 0.85 * ink.open * (1 - ink.black));
  }
  d.curve(B, CONTOUR, seed + 4, true, ink.line);
  if (p.leader) ridge(d, -0.3, -0.7, 0.06, -1.02, 3, 0.08, ink.line, seed + 9);
  // The skull and the open lower jaw, low and forward.
  d.body(parts.jaw, { wash: dark, washAlpha: horde ? 1 : 0.95 * ink.wash, weight: 0 });
  d.curve(parts.jaw, CONTOUR, seed + 12, true, ink.line);
  d.body(parts.head, { wash: hide, washAlpha: horde ? 1 : 0.95 * ink.wash, weight: 0 });
  d.curve(parts.head, CONTOUR, seed + 5, true, ink.line);
  const at = (k: number, pts: readonly number[]): [number, number] => [
    pts[k * 2] as number,
    pts[k * 2 + 1] as number,
  ];
  // The brow, then two eyes under it: paper on black, ink on a grey hide.
  const [b0x, b0y] = at(1, parts.head);
  const [b1x, b1y] = at(2, parts.head);
  d.line(b0x, b0y + 0.04, b1x + 0.01, b1y + 0.04, FORM, seed + 6, ink.line);
  const [e0x, e0y] = at(3, parts.head);
  const ex = e0x - 0.1;
  const ey = e0y - 0.04;
  const eye = Math.max(1.4, px * 0.026);
  const lit = horde || ink.black > 0.5;
  d.dot(ex, ey, eye, lit ? PAPER : INK, Math.max(ink.line, 0.6));
  d.dot(ex + 0.06, ey + 0.005, eye * 0.9, lit ? PAPER : INK, Math.max(ink.line, 0.6));
  // A row of five teeth along the open lower jaw, in paper.
  const [j0x, j0y] = at(0, parts.jaw);
  const [j1x, j1y] = at(1, parts.jaw);
  for (let k = 0; k < 5; k++) {
    const u = 0.12 + k * 0.18;
    const tx = lerp(j0x, j1x, u);
    const ty = lerp(j0y, j1y, u);
    const tooth = [tx - 0.014, ty + 0.004, tx, ty - 0.05, tx + 0.014, ty + 0.004];
    d.fill(tooth, PAPER, 1);
    d.path(tooth, HAIR, seed + 20 + k, true, ink.line);
  }
  // The near forelimb last: it walks on it, and rears and slams with it.
  limb(parts.fore, false, true, 10);
  if (!p.flash) {
    // Knuckles in paper on the black fist.
    const [kx, ky] = at(5, parts.fore);
    if (horde || ink.black > 0.5)
      for (let k = 0; k < 3; k++)
        d.line(
          kx - 0.04 - k * 0.05,
          ky - 0.01,
          kx - 0.04 - k * 0.05,
          ky - 0.06,
          FORM,
          seed + 11 + k,
        );
  }
  if (horde) {
    // The side toward the lantern catches its light: a paper line down the back, the shoulder
    // and the near forelimb, at contour weight.
    const ink0 = d.ink;
    d.ink = PAPER;
    d.curve(B.slice(6, 18), CONTOUR, seed + 30, false, 0.9);
    d.curve(parts.fore.slice(0, 8), CONTOUR, seed + 31, false, 0.9);
    d.curve(parts.head.slice(0, 8), FORM, seed + 32, false, 0.9);
    d.ink = ink0;
  }
  d.pop();
  d.strength = strength;
}

/** The elite's one colour: red-brown (docs/art.md, section 6). */
export const CREST = 0x9c3b22;

const pairsReversed = (pts: readonly number[]): number[] => {
  const out: number[] = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i] as number, pts[i + 1] as number);
  return out;
};

/**
 * An elite's sail (docs/art.md, section 6), in units of its height: its foot
 * along the spine from the hips to the skull, its ragged top edge, and five
 * ribs from the spine to the edge. It is tallest over the shoulder at a
 * quarter of the body's height, raked back 25 degrees, with four notches no
 * deeper than a third of it. `back` and `sit` follow the body's pose.
 */
export function eliteSail(
  back = 0,
  sit = 0,
): { base: number[]; top: number[]; ribs: number[]; tall: number[] } {
  // The spine, hips to skull, as the body's outline has it.
  const spine = [
    [-0.33, -0.6 + sit * 0.12],
    [-0.22 - back, -0.9 + sit * 0.16],
    [0.02 - back, -0.99 + sit * 0.18],
    [0.2 - back, -0.88 + sit * 0.16],
    [0.31 - back, -0.72 + sit * 0.14],
  ] as const;
  const along = (u: number): [number, number] => {
    const s = u * (spine.length - 1);
    const k = Math.min(spine.length - 2, Math.floor(s));
    const f = s - k;
    const a = spine[k] as readonly [number, number];
    const b = spine[k + 1] as readonly [number, number];
    return [lerp(a[0], b[0], f), lerp(a[1], b[1], f)];
  };
  const rake = (25 * Math.PI) / 180;
  const n = 24;
  const base: number[] = [];
  const top: number[] = [];
  const tall: number[] = [];
  const notches = [0.32, 0.5, 0.68, 0.84];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    const [bx, by] = along(u);
    // Out from the spine, raked back 25 degrees toward the tail.
    const [ax, ay] = along(Math.max(0, u - 0.02));
    const [cx, cy] = along(Math.min(1, u + 0.02));
    const tl = Math.hypot(cx - ax, cy - ay) || 1;
    const nx = (cy - ay) / tl;
    const ny = -(cx - ax) / tl;
    const ux = nx * Math.cos(rake) + ny * Math.sin(rake);
    const uy = -nx * Math.sin(rake) + ny * Math.cos(rake);
    // Tallest over the shoulder (u about 0.65), down to nothing at the hips and the skull.
    const rise =
      Math.sin(Math.min(1, u / 0.65) * (Math.PI / 2)) *
      Math.cos(Math.max(0, (u - 0.65) / 0.35) * (Math.PI / 2));
    let h = 0.25 * rise;
    // Shallow cuts in the top edge, never deeper than a third of the sail there.
    for (const c of notches) h *= 1 - 0.26 * Math.max(0, 1 - Math.abs(u - c) / 0.05);
    base.push(bx, by);
    top.push(bx + ux * h, by + uy * h);
    tall.push(h);
  }
  const ribs: number[] = [];
  for (const k of [5, 9, 13, 17, 20]) {
    ribs.push(base[k * 2] as number, base[k * 2 + 1] as number);
    ribs.push(top[k * 2] as number, top[k * 2 + 1] as number);
  }
  return { base, top, ribs, tall };
}

/**
 * An elite: drawn on its own, not as a larger brute. It stands upright and
 * hunched on two hocked legs, `size` tall, with long arms ending in claws, a
 * horned head carried low and forward, and a crest of spines down its back in
 * the one accent colour a monster may carry. `coil` raises the arms for its
 * heavy blow, `lunge` brings them down, `rest` sits it down asleep.
 */
export function drawElite(
  d: Draw,
  x: number,
  y: number,
  size: number,
  p: BeastPose,
  seed: number,
): void {
  const px = size * d.zoom;
  const ink = wakeInk(p.wake);
  // An elite stands alone at its den, so at rest it is drawn whole at half strength.
  const strength = d.strength * lerp(0.5, 1, clamp(p.wake));
  const outer = d.strength;
  d.strength = strength;
  const step = Math.sin(p.stride * Math.PI * 2) * p.speed;
  d.push();
  d.move(x, y);
  d.hatch(d.round(0, 0.02 * size, size * 0.62, size * 0.1, 10), 3, INK, 0.6);
  d.scale(size * p.face * p.stretch, size / p.stretch);
  d.move(0, p.rest * 0.22);
  d.shear(-p.hurt * 0.3 + p.coil * 0.15 - p.lunge * 0.2);
  const sit = p.rest;
  const back = p.coil * 0.08 - p.lunge * 0.1;
  // Legs: the far one first, a shade lighter.
  const leg = (far: boolean): void => {
    const s = far ? -step : step;
    const hx = far ? -0.18 : -0.06;
    const hy = -0.46 + sit * 0.1;
    const kx = hx + 0.12 + s * 0.06;
    const ky = -0.3 + sit * 0.12;
    const ax = hx - 0.06 - s * 0.08 + sit * 0.1;
    const ay = -0.12 + sit * 0.08;
    const fx = hx + 0.08 + s * 0.12 + sit * 0.18;
    d.strength = strength * (far ? 0.7 : 1);
    d.body(
      [
        hx - 0.08,
        hy,
        hx + 0.08,
        hy - 0.02,
        kx + 0.05,
        ky,
        ax + 0.04,
        ay,
        fx + 0.08,
        0,
        fx - 0.06,
        0,
        ax - 0.05,
        ay,
        kx - 0.06,
        ky + 0.01,
      ],
      {
        wash: p.flash ? PAPER : TONE.dark,
        washAlpha: 0.95,
        weight: CONTOUR,
        seed: seed + (far ? 1 : 2),
      },
    );
    d.strength = strength;
  };
  leg(true);
  // The far arm.
  const armUp = p.coil;
  const armDown = p.lunge;
  const shx = 0.12 - back;
  const shy = -0.8 + sit * 0.15;
  const hand = (far: boolean): [number, number] => [
    shx + (far ? -0.06 : 0) + 0.26 - armUp * 0.45 + armDown * 0.2,
    shy + 0.48 - armUp * 0.95 + armDown * 0.25 + sit * 0.1,
  ];
  const arm = (far: boolean): void => {
    const [hx, hy] = hand(far);
    const ex = (shx + hx) / 2 + 0.1 - armUp * 0.15;
    const ey = (shy + hy) / 2 + 0.04;
    d.strength = strength * (far ? 0.7 : 1);
    d.body(
      [
        shx - 0.06,
        shy,
        ex + 0.05,
        ey - 0.03,
        hx + 0.05,
        hy,
        hx - 0.04,
        hy + 0.02,
        ex - 0.06,
        ey + 0.04,
        shx + 0.06,
        shy + 0.08,
      ],
      {
        wash: p.flash ? PAPER : TONE.dark,
        washAlpha: 0.95,
        weight: CONTOUR,
        seed: seed + (far ? 3 : 4),
      },
    );
    // Claws.
    for (let k = 0; k < 3; k++)
      d.curve(
        [
          hx,
          hy,
          hx + 0.07 + k * 0.02,
          hy + 0.04 - k * 0.04,
          hx + 0.1 + k * 0.03,
          hy + 0.1 - k * 0.05,
        ],
        FORM,
        seed + 10 + k + (far ? 5 : 0),
      );
    d.strength = strength;
  };
  arm(true);
  // The body: hips to a humped back, the chest out over the near leg.
  const body = [
    -0.3,
    -0.42 + sit * 0.1,
    -0.34,
    -0.66 + sit * 0.12,
    -0.22 - back,
    -0.92 + sit * 0.16,
    0.02 - back,
    -1.0 + sit * 0.18,
    0.22 - back,
    -0.86 + sit * 0.16,
    0.32 - back,
    -0.68 + sit * 0.14,
    0.22,
    -0.5 + sit * 0.1,
    0.05,
    -0.4 + sit * 0.1,
  ];
  d.body(body, {
    wash: p.flash ? PAPER : TONE.hide,
    washAlpha: 0.92,
    weight: CONTOUR,
    seed: seed + 5,
  });
  if (!p.flash) {
    // Crossed hatching under the chest and spot black down the back; it thins as the ink goes.
    d.hatch(
      [
        0.3 - back,
        -0.7 + sit * 0.14,
        0.22,
        -0.5 + sit * 0.1,
        0.05,
        -0.4 + sit * 0.1,
        -0.3,
        -0.42 + sit * 0.1,
        -0.1,
        -0.62,
      ],
      p.ink > 0.4 && ink.close > 0.5 ? 3 : 1,
      INK,
      0.75 * ink.open,
    );
    const mane = [
      -0.32,
      -0.62 + sit * 0.12,
      -0.22 - back,
      -0.92 + sit * 0.16,
      0.02 - back,
      -1.0 + sit * 0.18,
      0.2 - back,
      -0.87 + sit * 0.16,
      0.06 - back,
      -0.8 + sit * 0.15,
      -0.12 - back,
      -0.78 + sit * 0.14,
    ];
    if (ink.black > 0.02) {
      if (p.ink > 0.5) d.fill(mane, INK, ink.black, true);
      else d.hatch(mane, 3, INK, 0.9 * ink.black, true);
    }
    if (ink.open > 0.02 && ink.black < 0.98)
      d.hatch(mane, 1, INK, 0.85 * ink.open * (1 - ink.black), true);
    // The crest: one sail down the spine from the hips to the skull, in its one colour.
    const sail = eliteSail(back, sit);
    // The top edge without its two ends, which are the base's own ends: one simple outline.
    const outline = [...sail.base, ...pairsReversed(sail.top.slice(2, -2))];
    d.fill(outline, CREST, 1);
    for (let k = 0; k < sail.ribs.length; k += 4)
      d.line(
        sail.ribs[k] as number,
        sail.ribs[k + 1] as number,
        sail.ribs[k + 2] as number,
        sail.ribs[k + 3] as number,
        FORM,
        seed + 20 + k,
      );
    d.path(outline, CONTOUR, seed + 26, true);
  }
  // The head, low and forward, horns swept back; one is broken.
  const hx = 0.4 - back * 1.2 + armDown * 0.05;
  const hy = -0.78 + sit * 0.2 + armDown * 0.06;
  const head = [
    hx - 0.14,
    hy - 0.06,
    hx - 0.02,
    hy - 0.13,
    hx + 0.12,
    hy - 0.08,
    hx + 0.2,
    hy + 0.0,
    hx + 0.12,
    hy + 0.06,
    hx - 0.06,
    hy + 0.08,
  ];
  d.body(head, {
    wash: p.flash ? PAPER : TONE.hide,
    washAlpha: 0.95,
    weight: CONTOUR,
    seed: seed + 30,
  });
  d.curve([hx - 0.06, hy - 0.11, hx - 0.18, hy - 0.26, hx - 0.34, hy - 0.24], CONTOUR, seed + 31);
  d.curve([hx + 0.02, hy - 0.12, hx - 0.04, hy - 0.22, hx - 0.12, hy - 0.25], CONTOUR, seed + 32);
  d.dot(hx + 0.09, hy - 0.04, Math.max(1.4, px * 0.03), PAPER);
  if (p.lunge > 0.2 || p.coil > 0.2) {
    d.fill([hx + 0.06, hy + 0.04, hx + 0.2, hy + 0.02, hx + 0.1, hy + 0.1], PAPER);
    d.line(hx + 0.04, hy + 0.03, hx + 0.2, hy + 0.01, FORM, seed + 33);
  }
  leg(false);
  arm(false);
  d.pop();
  d.strength = outer;
}
