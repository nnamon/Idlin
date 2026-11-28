// Monsters (docs/art.md, section 6). They are made of ink: more black than
// anything friendly, grey washes only, paper for eyes and teeth. Rank is the
// first thing each drawing says. Fodder is drawn as a swarm that shares one
// outline; a pack monster is drawn singly in three builds; a brute is wide
// and carries a mass of spot black; the horde is a tide.

import { BLOW, CONTOUR, type Draw, FORM, INK, PAPER } from "./draw.ts";
import { hash, lerp, noise1 } from "./geom.ts";

/** The hide washes, which a mockup may darken for the horde. */
export const TONE = { hide: 0x9a948a, dark: 0x77716a };
const BRUISE = 0x5a2a3a;

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
}

/**
 * A swarm of fodder, `size` long each in the drawing's units. Bodies that
 * overlap share one outline: every outline is laid first, then every body.
 */
export function drawSwarm(d: Draw, mites: readonly Mite[], count: number, size: number): void {
  const px = size * d.zoom;
  const pad = 1 + 5.2 / px;
  // A skitter: a humped body carried high on six thin legs, a black shell, one eye.
  const BODY = [-0.5, -0.24, -0.44, -0.5, -0.12, -0.7, 0.28, -0.6, 0.54, -0.4, 0.5, -0.24];
  const SHELL = [-0.48, -0.36, -0.42, -0.52, -0.12, -0.7, 0.26, -0.6, 0.12, -0.46, -0.2, -0.4];
  const grown: number[] = [];
  // Legs, spines and every outline first; then every body. Bodies that overlap share one outline.
  for (let i = 0; i < count; i++) {
    const m = mites[i] as Mite;
    d.push();
    d.move(m.x, m.y);
    d.hatch(
      [
        -size * 0.5,
        -size * 0.04,
        size * 0.5,
        -size * 0.04,
        size * 0.4,
        size * 0.07,
        -size * 0.4,
        size * 0.07,
      ],
      2,
      INK,
      0.5,
    );
    d.scale(size * m.face * m.stretch, size / m.stretch);
    for (let leg = 0; leg < 3; leg++) {
      const lx = -0.26 + leg * 0.27;
      const swing = Math.sin(m.phase * Math.PI * 2 + leg * 2.1) * 0.14;
      d.line(lx, -0.3, lx - 0.16 + swing, -0.44, FORM, m.seed + leg);
      d.line(lx - 0.16 + swing, -0.44, lx - 0.26 + swing * 1.6, 0, FORM, m.seed + leg + 3);
      d.line(lx + 0.06, -0.3, lx + 0.2 - swing, -0.4, FORM, m.seed + leg + 6);
      d.line(lx + 0.2 - swing, -0.4, lx + 0.3 - swing * 1.6, 0.02, FORM, m.seed + leg + 9);
    }
    grown.length = 0;
    for (let k = 0; k < BODY.length; k += 2)
      grown.push((BODY[k] as number) * pad, ((BODY[k + 1] as number) + 0.45) * pad - 0.45);
    d.fill(grown, INK, 1, true);
    // Spines along the shell.
    d.fill([-0.34, -0.58, -0.4, -0.92, -0.18, -0.66], INK);
    d.fill([-0.08, -0.68, -0.06, -1.0, 0.1, -0.66], INK);
    d.fill([0.16, -0.62, 0.3, -0.86, 0.3, -0.56], INK);
    d.pop();
  }
  for (let i = 0; i < count; i++) {
    const m = mites[i] as Mite;
    d.push();
    d.move(m.x, m.y);
    d.scale(size * m.face * m.stretch, size / m.stretch);
    d.fill(BODY, PAPER, 1, true);
    if (!m.flash) {
      d.fill(BODY, TONE.hide, 0.9, true);
      d.fill(SHELL, INK, 1, true);
    }
    d.dot(0.36, -0.42, Math.max(1.3, px * 0.075), PAPER);
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
  const reach = 1 + gather * 0.1 + p.lunge * 0.22 - p.coil * 0.14;
  const low = (1 - p.speed) * 0.1 + p.coil * 0.2;
  const strength = d.strength;
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
    0.5,
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
    const fx = hx + swing * 0.7 + (front ? 0.05 : -0.05);
    const fy = -lift;
    const kx = (hx + fx) / 2 + (front ? -0.1 : 0.16);
    const ky = top + 0.42 + legLen * 0.5 - lift * 0.5;
    d.strength = strength * (far ? 0.7 : 1);
    d.curve([hx, top + 0.4, kx, ky, fx, fy], CONTOUR, seed + (front ? 1 : 2) + (far ? 4 : 0));
    d.line(fx, fy, fx + 0.14, fy + 0.01, CONTOUR, seed + 9);
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
  );
  // Body, neck and head in one outline.
  const head = low * 0.9 + p.coil * 0.1 - p.lunge * 0.08 + (1 - p.speed) * 0.12;
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
  d.body(body, { wash: p.flash ? PAPER : TONE.hide, washAlpha: 0.9, seed: seed + 20 });
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
    if (p.ink > 0.6) d.fill(mane, INK, 1, true);
    else d.hatch(mane, 3, INK, 0.9, true);
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
      0.7 * p.ink,
    );
  }
  // A paper eye, and teeth when the jaws open.
  d.dot(X(1.0), top - 0.1 + head, Math.max(1.3, px * 0.055), PAPER);
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
 * A brute: half as tall again as a citizen and more than twice as wide, a
 * hunched mass with a black back, small paper eyes and tusks. `wind` is its
 * slam winding up (0 to 1), `slam` the blow coming down.
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
  const step = Math.sin(p.stride * Math.PI * 2) * p.speed;
  d.push();
  d.move(x, y);
  d.hatch(d.round(0, 0.02 * size, size * 0.95, size * 0.13, 10), 3, INK, 0.55);
  d.scale(size * p.face * p.stretch, size / p.stretch);
  d.shear(-p.hurt * 0.3 + p.coil * 0.2 - p.lunge * 0.25);
  const rise = p.coil * 0.16 - p.lunge * 0.12;
  // The far arm and leg.
  d.strength = strength * 0.75;
  d.body([-0.5 - step * 0.1, 0, -0.62, -0.4, -0.3, -0.42, -0.24 - step * 0.1, 0], {
    wash: TONE.dark,
    washAlpha: 0.9,
    seed: seed + 1,
  });
  d.strength = strength;
  // The raised fist, when it winds up, comes from behind the head.
  const armX = 0.5 + p.lunge * 0.3 + step * 0.08;
  const armY = -p.coil * 1.1 + p.lunge * 0.05;
  const body = [
    -0.78,
    -0.02,
    -0.84,
    -0.5 - rise * 0.5,
    -0.56,
    -0.92 - rise,
    -0.08,
    -1.04 - rise,
    0.34,
    -0.88 - rise * 0.6,
    0.56,
    -0.64,
    0.86,
    -0.5,
    0.82,
    -0.36,
    0.56,
    -0.3,
    0.44,
    -0.14,
    0.1,
    -0.06,
    -0.3,
    -0.02,
  ];
  d.body(body, { wash: p.flash ? PAPER : TONE.hide, washAlpha: 0.92, weight: CONTOUR, seed: seed + 2 });
  if (!p.flash) {
    const back = [
      -0.8,
      -0.3,
      -0.84,
      -0.52 - rise * 0.5,
      -0.56,
      -0.92 - rise,
      -0.08,
      -1.04 - rise,
      0.34,
      -0.88 - rise * 0.6,
      0.5,
      -0.7,
      0.2,
      -0.62,
      -0.06,
      -0.72,
      -0.3,
      -0.56,
      -0.5,
      -0.5,
      -0.62,
      -0.3,
    ];
    if (p.ink > 0.45) d.fill(back, INK, 1, true);
    else d.hatch(back, 3, INK, 0.9, true);
    d.hatch(
      [-0.78, -0.3, 0.44, -0.5, 0.56, -0.3, 0.44, -0.14, 0.1, -0.06, -0.78, -0.02],
      2,
      INK,
      0.75 * lerp(0.4, 1, p.ink),
    );
    // Spines along the back.
    for (let k = 0; k < 4; k++) {
      const sx = -0.6 + k * 0.24;
      const sy = -0.9 - rise - Math.sin((k + 0.5) * 0.9) * 0.12;
      d.fill([sx - 0.06, sy + 0.04, sx - 0.02, sy - 0.2, sx + 0.08, sy + 0.02], INK);
    }
  }
  // The near arm: a club of a forelimb it walks on, and slams with.
  d.body(
    [
      armX - 0.2,
      armY - 0.56,
      armX + 0.1,
      armY - 0.6,
      armX + 0.26,
      armY - 0.1,
      armX + 0.3,
      armY + 0.0,
      armX - 0.08,
      armY + 0.0,
      armX - 0.16,
      armY - 0.14,
    ],
    { wash: p.flash ? PAPER : TONE.dark, washAlpha: 0.95, weight: CONTOUR, seed: seed + 3 },
  );
  if (!p.flash)
    d.hatch(
      [armX - 0.04, armY - 0.58, armX + 0.1, armY - 0.6, armX + 0.28, armY, armX + 0.06, armY],
      3,
      INK,
      0.7,
    );
  // Eyes and tusks in paper.
  d.dot(0.6, -0.56, Math.max(1.4, px * 0.035), PAPER);
  d.dot(0.72, -0.53, Math.max(1.2, px * 0.03), PAPER);
  d.fill([0.66, -0.36, 0.74, -0.5, 0.8, -0.36], PAPER);
  d.fill([0.5, -0.32, 0.56, -0.44, 0.62, -0.32], PAPER);
  d.line(0.56, -0.34, 0.84, -0.38, FORM, seed + 5);
  d.pop();
  d.strength = strength;
}

/**
 * The horde: a tide of spot black from the right edge of the plate, its front
 * `reach` frame pixels in from the edge, with eyes and teeth picked out along
 * it and red-brown hatching ahead of it. Drawn in frame pixels.
 */
export function drawHorde(
  d: Draw,
  edge: number,
  top: number,
  bottom: number,
  reach: number,
  t: number,
): void {
  if (reach <= 1) return;
  const frontAt = (y: number): number =>
    edge -
    reach * (0.72 + 0.28 * noise1(y / 210, 7)) -
    26 * noise1(y / 46 + t * 0.35, 8) -
    9 * noise1(y / 15 - t * 0.9, 9);
  // The bruise ahead of it deepens as it nears: two flat steps.
  for (const [ahead, alpha] of [
    [reach * 1.5 + 260, 0.1],
    [reach * 0.7 + 110, 0.12],
  ] as const) {
    const pts = [edge + 20, top - 20];
    for (let y = top - 20; y <= bottom + 20; y += 60)
      pts.push(frontAt(y) - ahead * (0.8 + 0.2 * noise1(y / 300, 11)), y);
    pts.push(edge + 20, bottom + 20);
    d.wash(pts, BRUISE, alpha, true);
  }
  // The leading edge, hatched in the red-brown of a blow about to land.
  const lead = [edge + 20, top - 20];
  for (let y = top - 20; y <= bottom + 20; y += 30)
    lead.push(frontAt(y) - 78 - 22 * noise1(y / 70, 12), y);
  lead.push(edge + 20, bottom + 20);
  d.hatch(lead, 2, BLOW, 1, false, 2.2);
  // The tide itself: heads and backs along its front.
  const mass = [edge + 20, top - 20];
  for (let y = top - 20; y <= bottom + 20; y += 13) {
    const bump =
      Math.abs(Math.sin(y / 23 + noise1(y / 90, 13) * 3)) * 16 + hash(Math.floor(y / 13), 14) * 8;
    mass.push(frontAt(y) - bump, y);
  }
  mass.push(edge + 20, bottom + 20);
  d.fill(mass, INK, 1);
  // Spines and reaching limbs break the edge.
  for (let y = top; y < bottom; y += 34) {
    const k = Math.floor(y / 34);
    const fy = y + hash(k, 15) * 30;
    const fx = frontAt(fy);
    const lean = Math.sin(t * 2.2 + k) * 6;
    d.line(fx - 6, fy, fx - 34 - hash(k, 16) * 22, fy - 16 + lean, CONTOUR, k + 600);
    if (k % 2)
      d.curve([fx - 4, fy + 12, fx - 26, fy + 16 + lean, fx - 40, fy + 6 + lean], CONTOUR, k + 640);
    // Every third one is a body lunging out ahead of the mass: a neck, a head, jaws, an eye.
    if (k % 3 === 0) {
      const out = 60 + hash(k, 21) * 70 + Math.sin(t * 1.7 + k * 1.3) * 18;
      const hy = fy + Math.sin(t * 2.3 + k) * 8;
      d.fill(
        [
          fx + 10,
          fy - 16,
          fx - out * 0.6,
          hy - 15,
          fx - out,
          hy - 7,
          fx - out - 22,
          hy + 2,
          fx - out,
          hy + 9,
          fx - out * 0.5,
          hy + 13,
          fx + 10,
          fy + 20,
        ],
        INK,
        1,
        true,
      );
      d.fill([fx - out - 4, hy + 3, fx - out - 26, hy + 12, fx - out - 2, hy + 12], INK);
      d.dot(fx - out + 4, hy - 3, 2.6, PAPER);
      for (let tooth = 0; tooth < 3; tooth++)
        d.fill(
          [
            fx - out - 6 - tooth * 6,
            hy + 3,
            fx - out - 2 - tooth * 6,
            hy + 3,
            fx - out - 4 - tooth * 6,
            hy + 9,
          ],
          PAPER,
        );
    }
  }
  // Single monsters at the front, picked out by paper eyes and teeth.
  for (let y = top + 10; y < bottom; y += 46) {
    const k = Math.floor(y / 46);
    const fy = y + hash(k, 17) * 36;
    const depth = 16 + hash(k, 18) * Math.min(120, reach * 0.5);
    const fx = frontAt(fy) + depth;
    if (fx > edge - 6) continue;
    const blink = Math.sin(t * 0.9 + k * 2.7) > 0.93;
    const r = 2.2 + hash(k, 19) * 2.2;
    if (!blink) {
      d.dot(fx, fy, r, PAPER);
      d.dot(fx + r * 3, fy + 1, r * 0.9, PAPER);
    }
    if (k % 3 === 0) {
      for (let tooth = 0; tooth < 4; tooth++) {
        const tx = fx - 4 + tooth * 6;
        d.fill([tx, fy + 10, tx + 5, fy + 10, tx + 2.5, fy + 18], PAPER);
      }
    }
  }
  d.ink = INK;
}
