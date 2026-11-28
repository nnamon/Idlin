// Mockups for #445: a raider rig alongside the walking city at 1:40 on the
// cycle clock, in the widened transit view at 40 px a tile. Three takes of
// the rig share one city and one fight: (a) a smaller walking machine, (b) a
// wheeled wagon train with grapnel towers, (c) a sledge hauled by a beast.
// These are stills for the art director to pick from, not the built scene.

import { drawBrute, drawElite, drawHound, beastPose, type BeastPose } from "./beasts.ts";
import { GAIT_SECONDS } from "./city.ts";
import { drawTransitPlan, itemInk } from "./deck.ts";
import { CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER, shade } from "./draw.ts";
import {
  HAT_TOP,
  type Look,
  lookOf,
  type Pose,
  pose,
  shooting,
  swinging,
  BLOW_LENGTH,
  hurt,
} from "./figure.ts";
import { drawBurst, drawNumber, drawShaft } from "./fx.ts";
import { clamp, easeInOut, hash, lerp } from "./geom.ts";
import { itemName } from "./names.ts";
import type { Scene } from "./scenes.ts";
import {
  BACK,
  clockText,
  type Corners,
  drawFrameRule,
  drawPlacedTags,
  FRAME,
  headBox,
  OXIDE,
  SHADOW,
  slip,
  TagTimeline,
  type TagWant,
  UP,
} from "./stage.ts";
import { measure } from "./surface.ts";
import {
  type Crew,
  drawFootfallTop,
  drawTopCity,
  halfWidth,
  HULL_DEEP,
  hullRide,
  lanternAt,
  STATIONS,
  STATION,
  type Station,
  stayLines,
  type TopCity,
  TIMBER,
  IRON,
  WALK_SPEED,
} from "./topcity.ts";

const T = 40;
const SIZE = 68;
const HOUND = 0.85 * T;
const BRUTE = 2.4 * T;
const ELITE = 2.9 * T;
const SOOT = 0x5b5048;
const TAG = 20;

export type Take = "a" | "b" | "c";

/** Where each take puts the city and the rig: the ground under each one's middle, on screen. */
const PLACE: Record<Take, { cx: number; cy: number; rx: number; ry: number }> = {
  a: { cx: 840, cy: 388, rx: 1170, ry: 806 },
  b: { cx: 760, cy: 388, rx: 1110, ry: 806 },
  c: { cx: 780, cy: 388, rx: 1000, ry: 808 },
};

/** Where the three lines land on the city's near rail, in hull tiles along it. */
const LANDINGS = [-5.0, -0.5, 3.5] as const;

const st = (x: number, y: number, act: Station["act"], face = 1, range = 0, z = 0): Station => ({
  x,
  y,
  act,
  face,
  range,
  z,
});

type Proj = (x: number, y: number, z: number) => [number, number];

// ---------------------------------------------------------------- corners at the desktop sizes

/** The four corners at docs/art.md section 11's sizes for a desktop viewer. */
function drawDeskCorners(d: Draw, c: Corners): number[] {
  const taken: number[] = [];
  const inset = 18;
  {
    const time = clockText(c.left);
    const w = 84 + Math.max(measure("roman", 32, time), measure("roman", 20, c.to)) + 22;
    const h = 84;
    const x = FRAME.x0 + inset;
    const y = FRAME.y0 + inset;
    slip(d, x, y, w, h, 31);
    const cx = x + 42;
    const cy = y + h / 2;
    const r = 30;
    const wedge = [cx, cy];
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI / 2 + (i / 40) * c.gone * Math.PI * 2;
      wedge.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    d.wash(wedge, TIMBER, 0.8);
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
    const ha = -Math.PI / 2 + c.gone * Math.PI * 2;
    d.line(cx, cy, cx + Math.cos(ha) * (r - 4), cy + Math.sin(ha) * (r - 4), CONTOUR, 33);
    d.dot(cx, cy, 3);
    d.text(time, x + 84, y + 42, { size: 32 });
    d.text(c.to, x + 85, y + 66, { size: 20 });
    taken.push(x, y, x + w, y + h);
  }
  {
    const w =
      Math.max(measure("roman", 24, c.head), ...c.lines.map((l) => measure("roman", 20, l))) + 36;
    const h = 24 + 26 + c.lines.length * 24;
    const x = FRAME.x1 - inset - w;
    const y = FRAME.y0 + inset;
    slip(d, x, y, w, h, 51);
    d.text(c.head, x + 18, y + 34, { size: 24 });
    for (const [i, l] of c.lines.entries()) d.text(l, x + 18, y + 60 + i * 24, { size: 20 });
    taken.push(x, y, x + w, y + h);
  }
  if (c.log) {
    const { who, what } = c.log;
    const ww = measure("roman", 24, who);
    const w = ww + 30 + measure("roman", 24, what) + 36;
    const h = 48;
    const x = FRAME.x0 + inset;
    const y = FRAME.y1 - inset - h;
    slip(d, x, y, w, h, 61);
    d.text(who, x + 18, y + 31, { size: 24 });
    d.fill(d.box(x + 18, y + 36, x + 18 + ww, y + 38), c.log.rgb);
    d.text(what, x + 18 + ww + 30, y + 31, { size: 24, rgb: c.log.whatRgb });
    taken.push(x, y, x + w, y + h);
  }
  {
    const counts = c.counts.map(String);
    const h = 48;
    const cell = (s: string): number => 34 + measure("roman", 24, s) + 20;
    const w = counts.reduce((sum, s) => sum + cell(s), 0) + 12;
    const x0 = FRAME.x1 - inset - w;
    const y = FRAME.y1 - inset - h;
    slip(d, x0, y, w, h, 71);
    let x = x0 + 12;
    counts.forEach((s, k) => {
      const ix = x + 12;
      const iy = y + h / 2;
      const q = 0.8;
      if (k === 0) {
        d.body([ix - 7, iy + 10, ix - 5, iy - 2, ix + 5, iy - 2, ix + 7, iy + 10], {
          smooth: false,
          wash: 0x7a9cc0,
          weight: FORM,
          seed: 72,
        });
        d.body(d.round(ix, iy - 7, 5, 5, 8), { weight: FORM, seed: 73 });
      } else if (k === 1) {
        d.body([ix - 12, iy - 3, ix + 12, iy - 3, ix + 8, iy + 3, ix - 9, iy + 3], {
          smooth: false,
          wash: SOOT,
          washAlpha: 0.8,
          weight: FORM,
          seed: 75,
        });
        d.body(d.box(ix - 6, iy - 10, ix + 2, iy - 3), {
          smooth: false,
          wash: OXIDE,
          washAlpha: 0.8,
          weight: FORM,
          seed: 76,
        });
        for (const lx of [-8, -2, 3, 9])
          d.line(ix + lx, iy + 2, ix + lx * 1.35, iy + 11, FORM, 77 + lx);
      } else if (k === 2) {
        d.fill(d.round(ix, iy + 1, 9 * q, 7 * q, 10, 78), INK, 1, true);
        d.dot(ix + 10, iy - 5, 2);
        d.dot(ix - 10, iy + 6, 1.6);
      } else {
        d.body(
          [ix - 8, iy + 10, ix - 9, iy, ix - 3, iy - 6, ix + 3, iy - 6, ix + 9, iy, ix + 8, iy + 10],
          { wash: TIMBER, washAlpha: 0.85, weight: FORM, seed: 79 },
        );
        d.line(ix - 4, iy - 6, ix + 4, iy - 6, CONTOUR, 80);
      }
      d.text(s, x + 32, y + 32, { size: 24 });
      x += cell(s);
    });
    taken.push(x0, y, x0 + w, y + h);
  }
  return taken;
}

// ---------------------------------------------------------------- shared pieces

/** A beam from a to b, wa and wb wide at its ends, as points. */
function beam(a: [number, number], b: [number, number], wa: number, wb: number): number[] {
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
}

/** A rough bone of soot plate, close-hatched down its shade side, with seams. */
function sootBone(
  d: Draw,
  a: [number, number],
  b: [number, number],
  wa: number,
  wb: number,
  near: boolean,
  seed: number,
): void {
  d.body(beam(a, b, wa, wb), {
    smooth: false,
    wash: SOOT,
    washAlpha: 0.4,
    weight: near ? HEAVY : CONTOUR,
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
  d.hatch(
    [
      a[0] - nx * wa * 0.1,
      a[1] - ny * wa * 0.1,
      b[0] - nx * wb * 0.1,
      b[1] - ny * wb * 0.1,
      b[0] + nx * wb,
      b[1] + ny * wb,
      a[0] + nx * wa,
      a[1] + ny * wa,
    ],
    near ? 3 : 2,
    INK,
    near ? 0.8 : 0.55,
  );
  for (const u of [0.35, 0.72]) {
    const cx = lerp(a[0], b[0], u);
    const cy = lerp(a[1], b[1], u);
    const w = lerp(wa, wb, u);
    d.line(cx - nx * w, cy - ny * w, cx + nx * w, cy + ny * w, FORM, seed + Math.round(u * 50));
  }
}

/** A thrower on a rail: a post 1.2 citizens tall with an arm, a hook and a coil of line. Returns the arm's tip. */
function drawThrower(d: Draw, x: number, y: number, face: number, seed: number): [number, number] {
  const tall = SIZE * 1.2;
  d.body(d.box(x - 4, y - tall, x + 4, y), { smooth: false, spot: true, seed });
  const tip: [number, number] = [x + face * 26, y - tall - 12];
  d.line(x, y - tall + 6, tip[0], tip[1], HEAVY, seed + 1);
  d.dot(x, y - tall + 6, 4.5);
  // The coil at its foot.
  d.body(d.round(x + face * 10, y - 4, 11, 6, 10, seed), { wash: 0xe7dcc0, weight: FORM, seed });
  d.curve(d.round(x + face * 10, y - 4, 6, 3, 8, seed + 2).slice(), FORM, seed + 3, true);
  return tip;
}

/** A grapnel's hook over a rail: three prongs. */
function drawHook(d: Draw, x: number, y: number, dx: number, dy: number, seed: number): void {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  for (const a of [-0.9, 0, 0.9]) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const px = ux * c - uy * s;
    const py = ux * s + uy * c;
    d.line(x, y, x + px * 11, y + py * 11, CONTOUR, seed + Math.round(a * 10));
  }
  d.dot(x, y, 3.5);
}

/** A crate: timber with its braces. */
function drawCrate(d: Draw, x: number, y: number, s: number, seed: number): void {
  const top = [x - s, y - s * 1.1, x + s, y - s * 1.1, x + s * 0.9, y - s * 0.4, x - s * 0.9, y - s * 0.4];
  const front = [x - s * 0.9, y - s * 0.4, x + s * 0.9, y - s * 0.4, x + s * 0.9, y, x - s * 0.9, y];
  d.body(front, { smooth: false, wash: shade(TIMBER, 0.25), washAlpha: 0.95, weight: CONTOUR, seed });
  d.body(top, { smooth: false, wash: TIMBER, washAlpha: 0.95, weight: CONTOUR, seed: seed + 1 });
  d.line(x - s * 0.9, y - s * 1.05, x + s * 0.85, y - s * 0.45, FORM, seed + 2);
  d.line(x - s * 0.8, y - s * 0.2, x + s * 0.8, y - s * 0.2, FORM, seed + 3);
}

/** A beast drawn along a slope: a boarder on a line. */
function houndOn(
  d: Draw,
  x: number,
  y: number,
  angle: number,
  p: BeastPose,
  build: number,
  seed: number,
  size = HOUND,
): void {
  d.push();
  d.move(x, y);
  d.turn(angle);
  drawHound(d, 0, 0, size, p, build, seed);
  d.pop();
}

/** A taut line from a to b with a little sag, as points. */
function linePts(a: [number, number], b: [number, number], sag: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    out.push(lerp(a[0], b[0], u), lerp(a[1], b[1], u) + Math.sin(Math.PI * u) * sag);
  }
  return out;
}

const along = (pts: readonly number[], u: number): [number, number, number] => {
  const n = pts.length / 2 - 1;
  const f = clamp(u) * n;
  const i = Math.min(n - 1, Math.floor(f));
  const k = f - i;
  const x0 = pts[i * 2] as number;
  const y0 = pts[i * 2 + 1] as number;
  const x1 = pts[i * 2 + 2] as number;
  const y1 = pts[i * 2 + 3] as number;
  return [lerp(x0, x1, k), lerp(y0, y1, k), Math.atan2(y1 - y0, x1 - x0)];
};

/** A puff of smoke from a stack, drawn as the city's are. */
function puffs(d: Draw, x: number, y: number, t: number, seed: number, drift: number): void {
  const strength = d.strength;
  for (let i = 4; i >= 0; i--) {
    const age = (t * 0.45 + i / 5 + hash(seed, 1)) % 1;
    const r = (0.18 + age * 0.4) * T;
    const sx = x - age * drift * T + Math.sin(age * 5 + i) * 0.1 * T;
    const sy = y - 0.2 * T - age * 1.4 * T;
    d.strength = strength * (1 - clamp((age - 0.65) / 0.35));
    const puff: number[] = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const lobe = k % 2 ? 0.86 : 1.04;
      puff.push(sx + Math.cos(a) * r * lobe, sy + Math.sin(a) * r * 0.78 * lobe);
    }
    d.body(puff, { wash: 0x8e867c, washAlpha: 0.85, weight: FORM, seed: seed + i });
    d.hatch([sx, sy, sx + r, sy, sx + r * 0.7, sy + r * 0.6, sx - r * 0.2, sy + r * 0.75], 2, INK, 0.6, true);
  }
  d.strength = strength;
}

/** A claw foot: three prongs splayed on the ground. */
function claw(d: Draw, x: number, y: number, face: number, near: boolean, seed: number): void {
  for (const [a, l] of [
    [-0.7, 13],
    [0, 16],
    [0.7, 13],
  ] as const) {
    const ang = (face > 0 ? 0 : Math.PI) + a;
    d.line(x, y, x + Math.cos(ang) * l, y + Math.sin(ang) * l * 0.55, near ? HEAVY : CONTOUR, seed + Math.round(a * 10));
  }
}

// ---------------------------------------------------------------- the rigs

interface Rig {
  /** The thrower tips the lines leave from, on screen. */
  throwers: [number, number][];
  /** Drawn on the ground before anything stands: tracks, shadow. */
  ground(d: Draw): void;
  /** The rig and its crew. */
  draw(d: Draw): void;
}

/** (a) A smaller walking machine on six rough legs, a rival in the same pen. */
function walkerRig(rx: number, ry: number, t: number): Rig {
  const P: Proj = (x, y, z) => [rx + x * T, ry + y * BACK * T - z * UP * T];
  const STEP = 1.2;
  const cycle = STEP / (WALK_SPEED * 0.6);
  const gait = t / cycle;
  const legs = [
    { x: -3.6, side: 1, phase: 0 },
    { x: 0, side: 1, phase: 0.5 },
    { x: 3.6, side: 1, phase: 0 },
    { x: -3.6, side: -1, phase: 0.5 },
    { x: 0, side: -1, phase: 0 },
    { x: 3.6, side: -1, phase: 0.5 },
  ];
  const feet = legs.map((l) => {
    const u = (gait + l.phase) % 1;
    const out = Math.sign(l.x);
    const restX = l.x * 1.6 + out * 0.6;
    let dx: number;
    let lift = 0;
    let planted = 99;
    if (u < 0.4) {
      const k = u / 0.4;
      dx = lerp(-STEP / 2, STEP / 2, easeInOut(k));
      lift = Math.sin(Math.PI * k) * 0.5;
    } else {
      const k = (u - 0.4) / 0.6;
      dx = lerp(STEP / 2, -STEP / 2, k);
      planted = (u - 0.4) * cycle;
    }
    return { x: restX + dx, y: l.side * 4.5, lift, planted };
  });
  let dip = 0;
  for (const f of feet) dip += f.lift * 0.05;
  const deckZ = 1.4 - dip;
  const HULLR = [-5, -1.6, -4.4, -2.25, 4.4, -2.25, 5, -1.6, 5, 1.6, 4.4, 2.25, -4.4, 2.25, -5, 1.6];
  const deck = (): number[] => {
    const out: number[] = [];
    for (let i = 0; i < HULLR.length; i += 2) out.push(...P(HULLR[i] as number, HULLR[i + 1] as number, deckZ));
    return out;
  };
  const throwerAt = (x: number): [number, number] => P(x, -2.15, deckZ);
  const tips = [-3.2, 0, 3.2].map((x) => {
    const [px, py] = throwerAt(x);
    return [px + 26, py - SIZE * 1.2 - 12] as [number, number];
  });
  const leg = (d: Draw, i: number): void => {
    const l = legs[i] as (typeof legs)[number];
    const f = feet[i] as (typeof feet)[number];
    const near = l.side > 0;
    const hip = P(l.x * 0.9, l.side * 1.9, deckZ - 0.5);
    const knee = P(lerp(l.x, f.x, 0.45), l.side * 3.2, 2.1 + f.lift * 0.3);
    const foot = P(f.x, f.y, f.lift);
    // Rough: one leg thinner, one with a splint lashed on, all a little crooked.
    const thin = i === 4 ? 0.7 : 1;
    sootBone(d, hip, knee, 9 * thin, 7 * thin, near, 3100 + i * 7);
    sootBone(d, knee, foot, 7 * thin, 4, near, 3101 + i * 7);
    if (i === 1) {
      // The splint and its lashings.
      const a = knee;
      const b = foot;
      d.line(lerp(a[0], b[0], 0.15) + 7, lerp(a[1], b[1], 0.15), lerp(a[0], b[0], 0.7) + 7, lerp(a[1], b[1], 0.7), CONTOUR, 3150);
      for (const u of [0.25, 0.45, 0.62])
        d.line(lerp(a[0], b[0], u) - 6, lerp(a[1], b[1], u) - 2, lerp(a[0], b[0], u) + 10, lerp(a[1], b[1], u) + 3, FORM, 3151 + u * 10);
    }
    d.body(d.round(knee[0], knee[1], 8, 8, 8), { spot: true, seed: 3160 + i });
    d.dot(knee[0] - 1.5, knee[1] - 1.5, 1.6, PAPER);
    claw(d, foot[0], foot[1], Math.sign(l.x) || 1, near, 3170 + i * 5);
  };
  return {
    throwers: tips,
    ground(d) {
      // Its trail: claw prints behind it on the land, fading astern.
      for (let k = 1; k < 14; k++) {
        for (const side of [-1, 1]) {
          const wx = -6 - k * 1.25 - ((t * WALK_SPEED) % 1.25);
          const [x, y] = P(wx, side * 4.5 + (hash(k, side) - 0.5) * 0.4, 0);
          if (x < FRAME.x0 + 10) continue;
          d.strength = 0.4 * (1 - k / 14);
          claw(d, x, y, 1, false, 3300 + k * 3 + side);
          d.strength = 1;
        }
      }
      const shadow: number[] = [];
      for (let i = 0; i < HULLR.length; i += 2) shadow.push(...P((HULLR[i] as number) + 1.0, (HULLR[i + 1] as number) * 1.05 + 0.6, 0));
      d.wash(shadow, SHADOW, 0.24, true);
      feet.forEach((f, i) => {
        if (f.planted > 1.6) return;
        const [x, y] = P(f.x, f.y, 0);
        d.push();
        d.move(x, y);
        d.scale(T / 100 * 0.7);
        drawFootfallTop(d, f.planted, 3400 + i);
        d.pop();
      });
    },
    draw(d) {
      for (let i = 3; i < 6; i++) leg(d, i);
      // The near side: spot black for its whole depth, with a paper line at the rim.
      const side = [...P(-5, 1.6, deckZ), ...P(-4.4, 2.25, deckZ), ...P(4.4, 2.25, deckZ), ...P(5, 1.6, deckZ), ...P(5, 1.6, deckZ - 0.8), ...P(4.4, 2.25, deckZ - 0.8), ...P(-4.4, 2.25, deckZ - 0.8), ...P(-5, 1.6, deckZ - 0.8)];
      d.body(side, { smooth: false, spot: true, seed: 3200 });
      // A spiked ram across the blunt prow.
      d.body([...P(5, -1.4, deckZ - 0.3), ...P(5.9, -0.6, deckZ - 0.55), ...P(5.9, 0.7, deckZ - 0.55), ...P(5, 1.5, deckZ - 0.3), ...P(5, 1.5, deckZ - 0.8), ...P(5, -1.4, deckZ - 0.8)], { smooth: false, spot: true, seed: 3205 });
      for (const y of [-0.9, 0, 0.9]) {
        const [a, b] = P(5.8, y, deckZ - 0.6);
        d.body([a, b - 5, a + 22, b, a, b + 5], { smooth: false, wash: 0xe7dcc0, weight: CONTOUR, seed: 3206 + y });
      }
      const top = deck();
      d.body(top, { smooth: false, wash: SOOT, washAlpha: 0.4, weight: HEAVY, seed: 3201 });
      d.line(...P(-4.4, 2.25, deckZ - 0.06), ...P(4.4, 2.25, deckZ - 0.06), FORM, 3202);
      d.ink = PAPER;
      d.line(...P(-4.3, 2.25, deckZ - 0.12), ...P(4.3, 2.25, deckZ - 0.12), FORM, 3203);
      d.ink = INK;
      // Plate seams, patches and rivets.
      for (const x of [-3, -1, 1, 3]) d.line(...P(x, -2.2, deckZ), ...P(x + 0.15, 2.2, deckZ), FORM, 3210 + x);
      for (const y of [-0.8, 0.8]) d.line(...P(-4.8, y, deckZ), ...P(4.8, y, deckZ), HAIR, 3220 + y);
      for (const [px, py, w, h] of [
        [-2.2, 1.2, 1.1, 0.7],
        [2.0, -1.4, 0.9, 0.6],
        [3.9, 1.0, 0.7, 0.8],
      ] as const) {
        const patch = [...P(px, py, deckZ), ...P(px + w, py + 0.05, deckZ), ...P(px + w - 0.05, py + h, deckZ), ...P(px - 0.05, py + h - 0.05, deckZ)];
        d.body(patch, { smooth: false, wash: shade(SOOT, 0.3), washAlpha: 0.5, weight: FORM, seed: 3230 + px });
        d.hatch(patch, 2, INK, 0.5);
        for (let k = 0; k < 4; k++) d.dot(patch[k * 2] as number, patch[k * 2 + 1] as number, 1.6);
      }
      for (let x = -4.6; x <= 4.6; x += 0.5) {
        const [a, b] = P(x, 2.05, deckZ);
        d.dot(a, b, 1.4);
      }
      // The hatch amidships in spot black, the platform aft, the cage forward.
      d.body([...P(-0.6, -0.6, deckZ), ...P(0.6, -0.6, deckZ), ...P(0.6, 0.6, deckZ), ...P(-0.6, 0.6, deckZ)], { smooth: false, spot: true, seed: 3240 });
      const plat = [...P(-4.6, -1.5, deckZ + 0.6), ...P(-2.6, -1.5, deckZ + 0.6), ...P(-2.6, 1.3, deckZ + 0.6), ...P(-4.6, 1.3, deckZ + 0.6)];
      const platSide = [...P(-4.6, 1.3, deckZ + 0.6), ...P(-2.6, 1.3, deckZ + 0.6), ...P(-2.6, 1.3, deckZ), ...P(-4.6, 1.3, deckZ)];
      d.body(platSide, { smooth: false, spot: true, seed: 3241 });
      d.body(plat, { smooth: false, wash: SOOT, washAlpha: 0.55, weight: CONTOUR, seed: 3242 });
      d.hatch(plat, 1, INK, 0.5);
      // Cage forward: bars.
      const [gx, gy] = P(3.7, 0, deckZ);
      d.body(d.round(gx, gy, 0.8 * T, 0.6 * T, 12), { wash: SOOT, washAlpha: 0.3, weight: CONTOUR, seed: 3243 });
      for (let k = -3; k <= 3; k++) d.line(gx + k * 0.22 * T, gy - 0.5 * T - 30, gx + k * 0.22 * T, gy + 0.45 * T, FORM, 3244 + k);
      d.curve([gx - 0.75 * T, gy - 30, gx, gy - 0.65 * T - 30, gx + 0.75 * T, gy - 30], CONTOUR, 3250);
      // Two short stacks at the stern, smoking.
      for (const [sx2, sy2, k] of [
        [-4.75, -1.0, 0],
        [-4.75, 0.6, 1],
      ] as const) {
        const s0 = P(sx2, sy2, deckZ);
        const s1 = P(sx2, sy2, deckZ + 1.3);
        d.body([s0[0] - 9, s0[1], s1[0] - 8, s1[1], s1[0] + 8, s1[1], s0[0] + 9, s0[1]], { smooth: false, spot: true, seed: 3260 + k });
        puffs(d, s1[0], s1[1], t + k * 0.7, 3270 + k * 10, 2.2);
      }
      // Throwers on the far rail and their knots of crew.
      [-3.2, 0, 3.2].forEach((x, i) => {
        const [px, py] = throwerAt(x);
        drawThrower(d, px, py, 1, 3280 + i * 7);
      });
      rigCrew(d, P, deckZ, t, [
        [-2.4, -1.4],
        [-3.8, -1.2],
        [0.9, -1.5],
        [-0.9, -1.2],
        [2.4, -1.5],
        [4.2, -1.1],
        [1.6, 1.4],
      ], [1.2, 0.9], [-3.6, -0.1, deckZ + 0.6]);
      for (let i = 0; i < 3; i++) leg(d, i);
    },
  };
}

/** The crew left aboard a rig: hounds at the throwers, the brute by the hatch, the captain aft with its sail. */
function rigCrew(
  d: Draw,
  P: Proj,
  deckZ: number,
  t: number,
  hounds: readonly (readonly [number, number])[],
  brute: readonly [number, number],
  captain: readonly [number, number, number],
): void {
  const list: { y: number; draw: () => void }[] = [];
  hounds.forEach(([x, y], i) => {
    list.push({
      y,
      draw: () => {
        const [sx, sy] = P(x, y, deckZ);
        const beat = (t * 1.2 + i * 0.37) % 1;
        drawHound(
          d,
          sx,
          sy,
          HOUND,
          beastPose({ face: i % 3 === 0 ? -1 : 1, head: 1, coil: beat > 0.6 ? (beat - 0.6) * 2 : 0, stride: (t + i * 0.3) % 1, speed: 0.2 }),
          i % 3,
          3500 + i * 11,
        );
      },
    });
  });
  list.push({
    y: brute[1],
    draw: () => {
      const [sx, sy] = P(brute[0], brute[1], deckZ);
      drawBrute(d, sx, sy, BRUTE, beastPose({ face: -1, head: 1, stride: (t * 0.5) % 1, speed: 0.1 }), 3600);
    },
  });
  list.push({
    y: captain[1],
    draw: () => {
      const [sx, sy] = P(captain[0], captain[1], captain[2]);
      drawElite(d, sx, sy, ELITE, beastPose({ face: 1, head: 1, stride: (t * 0.4) % 1 }), 3700);
    },
  });
  list.sort((a, b) => a.y - b.y);
  for (const it of list) it.draw();
}

/** A spoked wheel standing across the line of travel, seen from the south. */
function wheel(d: Draw, x: number, y: number, r: number, turn: number, near: boolean, seed: number): void {
  d.body(d.round(x, y, r, r * 1.02, 18, seed), { wash: SOOT, washAlpha: 0.35, weight: near ? HEAVY : CONTOUR, seed });
  d.curve(d.round(x, y, r * 0.78, r * 0.8, 16).slice(), FORM, seed + 1, true);
  for (let k = 0; k < 8; k++) {
    const a = turn + (k / 8) * Math.PI * 2;
    d.line(x, y, x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.8, near ? CONTOUR : FORM, seed + 2 + k);
  }
  d.fill(d.round(x, y, r * 0.2, r * 0.2, 8), INK, 1);
  // Studs on the rim.
  for (let k = 0; k < 10; k++) {
    const a = turn * 1.0 + (k / 10) * Math.PI * 2;
    d.dot(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, 1.8);
  }
  if (near) d.hatch(d.round(x + r * 0.3, y + r * 0.3, r * 0.7, r * 0.7, 10).slice(), 2, INK, 0.5, true);
}

/** (b) A wheeled siege train: an engine and three wagons, each wagon with a grapnel tower. */
function wagonRig(rx: number, ry: number, t: number): Rig {
  const P: Proj = (x, y, z) => [rx + x * T, ry + y * BACK * T - z * UP * T];
  const R = 0.75;
  const roll = (t * WALK_SPEED) / R;
  const bob = (i: number): number => Math.sin(t * 3.1 + i * 1.7) * 0.03;
  // Wagons: middle x, half length, bed height. The engine leads on the right.
  const cars = [
    { x: -7.4, half: 2.4, kind: "tower" },
    { x: -2.2, half: 2.4, kind: "tower" },
    { x: 3.0, half: 2.4, kind: "tower" },
    { x: 8.1, half: 2.1, kind: "engine" },
  ] as const;
  const W = 2.2;
  const WY = W - 0.2;
  const bed = 1.3;
  const towerTop = 4.2;
  const tips: [number, number][] = cars
    .filter((c) => c.kind === "tower")
    .map((c, i) => {
      const [x, y] = P(c.x + 0.4, -W + 0.4, towerTop + bob(i));
      return [x + 30, y - 6];
    });
  return {
    throwers: tips,
    ground(d) {
      // Ruts behind it, two a side, running back to the frame's edge.
      for (const yy of [-WY - 0.1, WY - 0.1]) {
        const pts: number[] = [];
        for (let x = -28; x <= -8.6; x += 0.5) pts.push(...P(x, yy + 0.05 * Math.sin(x * 0.7), 0));
        d.strength = 0.4;
        d.curve(pts, CONTOUR, 4000 + Math.round(yy * 10));
        const pts2: number[] = [];
        for (let x = -28; x <= -8.6; x += 0.5) pts2.push(...P(x, yy + 0.32 + 0.05 * Math.sin(x * 0.6 + 1), 0));
        d.curve(pts2, FORM, 4010 + Math.round(yy * 10));
        d.strength = 1;
      }
      for (const c of cars) {
        const sh = [...P(c.x - c.half + 0.9, -W + 0.5, 0), ...P(c.x + c.half + 0.9, -W + 0.5, 0), ...P(c.x + c.half + 0.7, W + 0.9, 0), ...P(c.x - c.half + 0.7, W + 0.9, 0)];
        d.wash(sh, SHADOW, 0.24, true);
      }
    },
    draw(d) {
      // Drawbars between the cars.
      for (let i = 0; i + 1 < cars.length; i++) {
        const a = cars[i] as (typeof cars)[number];
        const b = cars[i + 1] as (typeof cars)[number];
        d.body(beam(P(a.x + a.half - 0.1, 0, bed - 0.4), P(b.x - b.half + 0.1, 0, bed - 0.4), 4, 4), { smooth: false, spot: true, seed: 4020 + i });
      }
      cars.forEach((c, i) => {
        const z = bed + bob(i);
        const x0 = c.x - c.half;
        const x1 = c.x + c.half;
        // Far wheels behind, then the near ones, both under the bed.
        for (const wx of [x0 + 0.8, x1 - 0.8]) {
          const [x, y] = P(wx, -WY, R);
          wheel(d, x, y, R * T, roll + wx, false, 4100 + i * 20 + Math.round(wx));
        }
        for (const wx of [x0 + 0.8, x1 - 0.8]) {
          const [x, y] = P(wx, WY, R);
          wheel(d, x, y, R * T, roll + wx * 1.3, true, 4500 + i * 20 + Math.round(wx));
        }
        // The bed and its near side.
        const side = [...P(x0, W, z), ...P(x1, W, z), ...P(x1, W, z - 0.6), ...P(x0, W, z - 0.6)];
        d.body(side, { smooth: false, spot: true, seed: 4200 + i });
        const top = [...P(x0, -W, z), ...P(x1, -W, z), ...P(x1, W, z), ...P(x0, W, z)];
        d.body(top, { smooth: false, wash: SOOT, washAlpha: 0.4, weight: HEAVY, seed: 4210 + i });
        d.ink = PAPER;
        d.line(...P(x0 + 0.1, W, z - 0.08), ...P(x1 - 0.1, W, z - 0.08), FORM, 4220 + i);
        d.ink = INK;
        // Floor boards run along the bed, and a low sideboard stands round it, so it reads as open from above.
        for (let k = 1; k < 6; k++) d.line(...P(x0 + 0.15, lerp(-W, W, k / 6), z), ...P(x1 - 0.15, lerp(-W, W, k / 6), z), HAIR, 4230 + i * 6 + k);
        const rail = 0.35;
        for (const [ax, ay, bx2, by] of [
          [x0, -W, x1, -W],
          [x0, -W, x0, W],
          [x1, -W, x1, W],
        ] as const) {
          d.body([...P(ax, ay, z), ...P(bx2, by, z), ...P(bx2, by, z + rail), ...P(ax, ay, z + rail)], { smooth: false, wash: SOOT, washAlpha: 0.55, weight: CONTOUR, seed: 4240 + i + ax });
        }
        d.body([...P(x0, W, z), ...P(x1, W, z), ...P(x1, W, z + rail), ...P(x0, W, z + rail)], { smooth: false, spot: true, seed: 4250 + i });
        for (let x = x0 + 0.2; x < x1; x += 0.5) {
          const [a, b] = P(x, W, z + rail * 0.5);
          d.dot(a, b, 1.4, PAPER);
        }
        if (c.kind === "engine") {
          // A boiler lying along the bed, seen from above: its top in wash, its near half close-hatched, iron bands.
          const B0 = x0 + 0.4;
          const B1 = x1 - 0.3;
          const BR = 1.15;
          const BZ = z + 0.2 + BR;
          const bTop = [...P(B0, -BR, BZ), ...P(B1, -BR, BZ), ...P(B1 + 0.5, 0, BZ), ...P(B1, BR, BZ), ...P(B1, BR, BZ - BR), ...P(B0, BR, BZ - BR), ...P(B0, BR, BZ)];
          d.body(bTop, { smooth: true, wash: SOOT, washAlpha: 0.5, weight: HEAVY, seed: 4300 });
          d.hatch([...P(B0, 0.2, BZ), ...P(B1 + 0.3, 0.2, BZ), ...P(B1, BR, BZ - BR), ...P(B0, BR, BZ - BR)], 3, INK, 0.85);
          for (let k = 1; k < 5; k++) {
            const xx = lerp(B0, B1, k / 5);
            d.line(...P(xx, -BR, BZ), ...P(xx, BR, BZ - BR * 0.9), CONTOUR, 4310 + k);
          }
          const s0 = P(x1 - 0.9, 0, z + 1.3);
          const s1 = P(x1 - 0.9, 0, z + 2.8);
          d.body([s0[0] - 10, s0[1], s1[0] - 12, s1[1], s1[0] + 12, s1[1], s0[0] + 10, s0[1]], { smooth: false, spot: true, seed: 4320 });
          puffs(d, s1[0], s1[1], t, 4330, 3.2);
          // A ram's plough at the front.
          d.body([...P(x1, -W, z - 0.5), ...P(x1 + 1.1, 0, z - 0.8), ...P(x1, W, z - 0.5)], { smooth: false, spot: true, seed: 4340 });
        } else {
          // A grapnel tower at the far side: two legs and braces up to a head with its arm.
          const base0 = P(c.x - 0.6, -W + 0.3, z);
          const base1 = P(c.x + 1.4, -W + 0.3, z);
          const head = P(c.x + 0.4, -W + 0.4, towerTop + bob(i));
          sootBone(d, base0, head, 5, 3.5, false, 4400 + i * 10);
          sootBone(d, base1, head, 5, 3.5, false, 4401 + i * 10);
          for (const u of [0.3, 0.55, 0.78]) {
            const a = [lerp(base0[0], head[0], u), lerp(base0[1], head[1], u)] as [number, number];
            const b = [lerp(base1[0], head[0], u), lerp(base1[1], head[1], u)] as [number, number];
            d.line(a[0], a[1], b[0], b[1], CONTOUR, 4410 + i * 10 + u * 10);
          }
          const a0 = [lerp(base0[0], head[0], 0.3), lerp(base0[1], head[1], 0.3)] as const;
          const b1 = [lerp(base1[0], head[0], 0.55), lerp(base1[1], head[1], 0.55)] as const;
          d.line(a0[0], a0[1], b1[0], b1[1], FORM, 4420 + i);
          d.body(d.box(head[0] - 9, head[1] - 9, head[0] + 9, head[1] + 4), { smooth: false, spot: true, seed: 4430 + i });
          d.line(head[0], head[1] - 4, head[0] + 30, head[1] - 6, HEAVY, 4440 + i);
          d.dot(head[0] + 30, head[1] - 6, 3.5);
          // A winch drum at its foot.
          const [wx, wy] = P(c.x + 0.5, -W + 0.9, z);
          d.body(d.round(wx, wy, 12, 8, 10), { wash: 0xe7dcc0, weight: CONTOUR, seed: 4450 + i });
          d.curve(d.round(wx, wy, 7, 4, 8).slice(), FORM, 4460 + i, true);
          d.line(wx, wy - 4, head[0], head[1] + 3, FORM, 4470 + i);
        }
      });
      // Crew: knots on each tower wagon, the brute on the engine, the captain on the middle wagon.
      const list: { y: number; draw: () => void }[] = [];
      const houndsAt: [number, number, number][] = [
        [-8.6, 0.3, 0],
        [-5.4, 0.2, 1],
        [-3.6, 1.1, 2],
        [2.0, 0.4, 4],
        [4.3, 1.1, 5],
        [-8.0, 1.4, 3],
      ];
      for (const [x, y, k] of houndsAt)
        list.push({
          y,
          draw: () => {
            const [sx, sy] = P(x, y, bed + bob(Math.floor((x + 9) / 5)));
            drawHound(d, sx, sy, HOUND, beastPose({ face: k % 2 ? -1 : 1, head: 1, stride: (t + k * 0.3) % 1, speed: 0.2 }), k % 3, 4600 + k * 11);
          },
        });
      list.push({
        y: 0.6,
        draw: () => {
          const [sx, sy] = P(-6.6, 1.3, bed + bob(0));
          drawBrute(d, sx, sy, BRUTE, beastPose({ face: -1, head: 1 }), 4700);
        },
      });
      list.push({
        y: 0.5,
        draw: () => {
          const [sx, sy] = P(-1.4, 0.8, bed + bob(1));
          drawElite(d, sx, sy, ELITE, beastPose({ face: 1, head: 1 }), 4710);
        },
      });
      list.sort((a, b) => a.y - b.y);
      for (const it of list) it.draw();
    },
  };
}

/** (c) A sledge platform on runners, hauled by a great beast in a yoke ahead of it. */
function sledgeRig(rx: number, ry: number, t: number): Rig {
  const P: Proj = (x, y, z) => [rx + x * T, ry + y * BACK * T - z * UP * T];
  const L = 4.8;
  const W = 2.2;
  const z = 0.8 + Math.sin(t * 2.2) * 0.02;
  // The beast ahead: its middle, along from the sledge's.
  const bx = 9.6;
  const beastStride = (t * WALK_SPEED) / 1.6;
  const tips: [number, number][] = [-3.0, 0, 3.0].map((x) => {
    const [px, py] = P(x, -W + 0.1, z);
    return [px + 26, py - SIZE * 1.2 - 12];
  });
  const beastLegs = [-2.2, 0, 2.2];
  const beastFoot = (i: number, side: number): { x: number; y: number; lift: number } => {
    const u = (beastStride + i * 0.33 + (side > 0 ? 0.5 : 0)) % 1;
    const dx = u < 0.35 ? lerp(-0.7, 0.7, easeInOut(u / 0.35)) : lerp(0.7, -0.7, (u - 0.35) / 0.65);
    const lift = u < 0.35 ? Math.sin((Math.PI * u) / 0.35) * 0.45 : 0;
    return { x: bx + (beastLegs[i] as number) * 1.45 + dx, y: side * 3.7, lift };
  };
  const drawBeastLeg = (i: number, side: number): void => {
    const f = beastFoot(i, side);
    const near = side > 0;
    const hip = P(bx + (beastLegs[i] as number), side * 1.5, 1.2);
    // Near legs bend at a raised elbow, splayed fore and aft; far legs stay low behind the shell.
    const knee = near
      ? P(bx + (beastLegs[i] as number) * 0.7 - 0.3, 2.4, 1.9 + f.lift * 0.5)
      : P(lerp(bx + (beastLegs[i] as number), f.x, 0.5), side * 3.0, 1.35 + f.lift * 0.5);
    const foot = P(f.x, f.y, f.lift);
    d0Leg(hip, knee, foot, near, 5000 + i * 7 + (near ? 50 : 0));
  };
  let dref: Draw | null = null;
  const d0Leg = (hip: [number, number], knee: [number, number], foot: [number, number], near: boolean, seed: number): void => {
    const d = dref as Draw;
    sootBone(d, hip, knee, 13, 10, near, seed);
    sootBone(d, knee, foot, 9, 7, near, seed + 1);
    d.fill(d.round(foot[0], foot[1], 11, 5, 8), INK, 1);
    for (const k of [-1, 0, 1]) d.line(foot[0] + k * 7, foot[1], foot[0] + k * 9 + 8, foot[1] + 3, CONTOUR, seed + 3 + k);
  };
  return {
    throwers: tips,
    ground(d) {
      // Furrows from the runners, scraped back to the frame's edge, with spoil thrown up along them.
      for (const yy of [-W + 0.4, W - 0.4]) {
        const pts: number[] = [];
        for (let x = -24; x <= -L; x += 0.5) pts.push(...P(x, yy + 0.06 * Math.sin(x * 0.5), 0));
        d.strength = 0.45;
        d.curve(pts, CONTOUR, 5100 + Math.round(yy * 10));
        for (let x = -24; x <= -L; x += 0.7) {
          const [a, b] = P(x + hash(x * 10, yy) * 0.4, yy + 0.35, 0);
          d.line(a, b, a + 6, b + 3, FORM, 5110 + Math.round(x * 10));
        }
        d.strength = 1;
      }
      const sh = [...P(-L + 0.9, -W + 0.4, 0), ...P(L + 0.9, -W + 0.4, 0), ...P(L + 0.7, W + 0.8, 0), ...P(-L + 0.7, W + 0.8, 0)];
      d.wash(sh, SHADOW, 0.24, true);
      d.wash(d.round(...P(bx + 0.8, 0.5, 0), 4.2 * T, 1.6 * T, 14).slice(), SHADOW, 0.24, true);
    },
    draw(d) {
      dref = d;
      // The beast's far legs, then the traces from the sledge's prow to its yoke.
      for (let i = 0; i < 3; i++) drawBeastLeg(i, -1);
      // The runners, curled up at the front.
      for (const yy of [-W + 0.4, W - 0.4]) {
        const pts = [...P(-L - 0.2, yy, 0.05), ...P(L - 0.2, yy, 0.05), ...P(L + 0.5, yy, 0.35), ...P(L + 0.6, yy, 0.75)];
        d.curve(pts, yy > 0 ? HEAVY : CONTOUR, 5200 + Math.round(yy * 10));
        for (const x of [-3.5, -1.2, 1.2, 3.5]) d.line(...P(x, yy, 0.1), ...P(x, yy, z - 0.1), CONTOUR, 5210 + Math.round(x * 10 + yy));
      }
      // The platform and its near side.
      const side = [...P(-L, W, z), ...P(L, W, z), ...P(L, W, z - 0.45), ...P(-L, W, z - 0.45)];
      d.body(side, { smooth: false, spot: true, seed: 5300 });
      const top = [...P(-L, -W, z), ...P(L, -W, z), ...P(L + 0.4, 0, z), ...P(L, W, z), ...P(-L, W, z)];
      d.body(top, { smooth: false, wash: SOOT, washAlpha: 0.4, weight: HEAVY, seed: 5301 });
      d.ink = PAPER;
      d.line(...P(-L + 0.1, W, z - 0.07), ...P(L - 0.1, W, z - 0.07), FORM, 5302);
      d.ink = INK;
      // Lashed beams across it, and hides tied down.
      for (let x = -L + 0.6; x < L; x += 0.9) d.line(...P(x, -W, z), ...P(x + 0.1, W, z), FORM, 5310 + Math.round(x * 10));
      for (const [hx, hy] of [
        [-2.4, 1.1],
        [3.3, 1.0],
      ] as const) {
        const hide = d.round(...P(hx, hy, z), 0.9 * T, 0.45 * T, 10, 5320 + hx).slice();
        d.body(hide, { wash: shade(SOOT, 0.4), washAlpha: 0.5, weight: FORM, seed: 5330 + hx });
        d.hatch(hide, 2, INK, 0.6, true);
      }
      // A spot black hatch and a brazier with smoke.
      d.body([...P(-0.6, -0.5, z), ...P(0.6, -0.5, z), ...P(0.6, 0.6, z), ...P(-0.6, 0.6, z)], { smooth: false, spot: true, seed: 5340 });
      const [fx, fy] = P(-4.0, 0.2, z);
      d.body(d.round(fx, fy - 6, 12, 8, 10), { spot: true, seed: 5350 });
      puffs(d, fx, fy - 12, t, 5360, 2.6);
      // Throwers on the far rail.
      [-3.0, 0, 3.0].forEach((x, i) => {
        const [px, py] = P(x, -W + 0.1, z);
        drawThrower(d, px, py, 1, 5400 + i * 7);
      });
      // Traces: two chains from the prow to the yoke.
      for (const yy of [-1.0, 1.0]) {
        const a = P(L + 0.4, yy * 0.5, z + 0.2);
        const b = P(bx - 2.6, yy * 1.1, 1.6);
        d.line(a[0], a[1], b[0], b[1], HEAVY, 5450 + yy);
        for (let u = 0.1; u < 1; u += 0.12) d.dot(lerp(a[0], b[0], u), lerp(a[1], b[1], u), 2.6, PAPER);
      }
      // The crew on the sledge and the driver at the front with its goad.
      rigCrew(d, P, z, t, [
        [-2.0, -1.4],
        [-3.8, -0.9],
        [0.9, -1.5],
        [-0.8, -1.1],
        [2.2, -1.5],
        [3.9, -1.0],
      ], [4.2, 0.6], [-3.0, 0.9, z]);
      // The beast: a great armoured hauler seen from above, its shell in bands of plate, horns forward.
      const SZ = 2.3;
      const low = 1.0;
      const RX = 3.2;
      const RY = 1.7;
      const rim = (z0: number, from: number, to: number, n = 24): number[] => {
        const out: number[] = [];
        for (let k = 0; k <= n; k++) {
          const a = lerp(from, to, k / n);
          out.push(...P(bx + Math.cos(a) * RX, Math.sin(a) * RY, z0));
        }
        return out;
      };
      // The head first, low and forward, so the shell's front edge lies over its neck.
      const H0 = bx + RX - 0.4;
      const headTop = [...P(H0, -1.0, 1.6), ...P(H0 + 1.3, -0.65, 1.5), ...P(H0 + 1.8, 0, 1.4), ...P(H0 + 1.3, 0.65, 1.5), ...P(H0, 1.0, 1.6)];
      const headFace = [...P(H0, 1.0, 1.6), ...P(H0 + 1.3, 0.65, 1.5), ...P(H0 + 1.8, 0, 1.4), ...P(H0 + 1.8, 0, 0.9), ...P(H0 + 1.3, 0.65, 0.9), ...P(H0, 1.0, 1.0)];
      d.body(headFace, { smooth: false, spot: true, seed: 5530 });
      d.body(headTop, { smooth: false, wash: SOOT, washAlpha: 0.4, weight: HEAVY, seed: 5531 });
      d.hatch(headTop, 2, INK, 0.6);
      for (const s of [-1, 1]) {
        const a = P(H0 + 0.9, s * 0.7, 1.6);
        const b = P(H0 + 1.9, s * 1.7, 2.1);
        const c2 = P(H0 + 2.5, s * 1.5, 2.4);
        d.body([a[0] - 6, a[1], b[0], b[1] - 3, c2[0], c2[1], b[0] + 3, b[1] + 5, a[0] + 6, a[1] + 3], { smooth: true, wash: 0xe7dcc0, weight: CONTOUR, seed: 5540 + s });
      }
      const [ex, ey] = P(H0 + 1.2, 0.7, 1.3);
      d.dot(ex, ey, 3.6, PAPER);
      d.dot(ex + 1, ey, 1.6, INK);
      // The near flank: from the shell's near rim down to its belly, in spot black.
      d.body([...rim(SZ, 0, Math.PI), ...rim(low, Math.PI, 0)], { smooth: false, spot: true, seed: 5500 });
      // The shell's top.
      const shellTop = rim(SZ, 0, Math.PI * 2, 32);
      d.body(shellTop, { smooth: false, wash: SOOT, washAlpha: 0.35, weight: HEAVY, seed: 5501 });
      d.hatch([...rim(SZ, -0.2, 1.4, 12), ...P(bx + 0.4, 0.2, SZ)], 2, INK, 0.7);
      // Scutes over the shell in three rows, each outlined, hatched on its lower right, the gaps black.
      for (const [row, n] of [
        [-1, 4],
        [0, 5],
        [1, 4],
      ] as const) {
        for (let k = 0; k < n; k++) {
          const u = (k - (n - 1) / 2) * 1.2;
          const yy = row * 0.95;
          if ((u / RX) ** 2 + (yy / RY) ** 2 > 0.8) continue;
          const [sx, sy] = P(bx + u, yy, SZ);
          const sc = d.round(sx, sy, 0.55 * T, 0.36 * T, 6, 5560 + k * 3 + row).slice();
          d.fill(d.round(sx + 1, sy + 1, 0.62 * T, 0.42 * T, 6, 5560 + k * 3 + row).slice(), INK, 0.9);
          d.body(sc, { smooth: false, wash: SOOT, washAlpha: 0.3, weight: FORM, seed: 5570 + k * 3 + row });
          d.hatch([sx, sy, sx + 0.55 * T, sy, sx + 0.3 * T, sy + 0.3 * T, sx - 0.2 * T, sy + 0.3 * T], 2, INK, 0.7);
        }
      }
      // The flank's skirt of plates, scalloped along the belly.
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (0.06 + (k / 8) * 0.88);
        const [sx, sy] = P(bx + Math.cos(a) * RX, Math.sin(a) * RY, low + 0.15);
        d.ink = PAPER;
        d.curve([sx - 9, sy - 6, sx, sy + 2, sx + 9, sy - 6], FORM, 5590 + k);
        d.ink = INK;
      }
      // A ridge of spines down its middle.
      for (let k = -4; k <= 4; k++) {
        const [sx, sy] = P(bx + k * 0.6, 0, SZ);
        d.body([sx - 5, sy, sx + 1, sy - 15 + Math.abs(k) * 1.2, sx + 5, sy], { smooth: false, spot: true, seed: 5535 + k });
      }
      // The yoke over its neck: an iron beam with a ring at each end.
      const y0 = P(H0 - 0.1, -1.9, 2.0);
      const y1 = P(H0 - 0.1, 1.9, 1.9);
      d.body(beam(y0, y1, 5, 5), { smooth: false, spot: true, seed: 5550 });
      d.curve(d.round(y0[0], y0[1], 6, 6, 8).slice(), CONTOUR, 5551, true);
      d.curve(d.round(y1[0], y1[1], 6, 6, 8).slice(), CONTOUR, 5552, true);
      const hx = ex;
      const hy = ey;
      // The driver's goad line from the brute to the beast's head.
      const [dx, dy] = P(4.2, 0.6, z);
      d.curve([dx + 20, dy - BRUTE * 0.8, (dx + hx) / 2, dy - BRUTE * 1.1, hx, hy - 0.8 * T], FORM, 5560);
      for (let i = 0; i < 3; i++) drawBeastLeg(i, 1);
    },
  };
}

// ---------------------------------------------------------------- the scene

export function raidScene(take: Take): Scene {
  const { cx, cy, rx, ry } = PLACE[take];
  const crowd: Look[] = Array.from({ length: 15 }, (_, i) => lookOf(i + 1));
  const at = (k: number): Look => crowd[k] as Look;
  const gait = (t: number): number => t / GAIT_SECONDS;

  // Who does what at 1:40: three pairs at the rail, both gunners, two hauling a crate inboard,
  // the lookout pointing, the helm, the stoker, the smith, and the sleeper still asleep.
  const fighters = (t: number): Crew[] => {
    const blow = (k: number, face: number): Pose => swinging(((t + k * 0.41) % (BLOW_LENGTH * 1.6)) / 1.0, face);
    const bow = (k: number, face: number): Pose => {
      const u = (t * 0.7 + k * 0.3) % 1;
      return shooting(clamp(u / 0.8), face, u > 0.8);
    };
    const haul = (k: number): Pose =>
      pose({ face: 1, lean: 0.42, crouch: 0.35, arm: -1.3, arm2: -1.0, grip: 0, step: 1.1, stride: (t * 0.6 + k * 0.5) % 1, trail: 0.2 });
    const S = STATIONS;
    return [
      { look: at(0), station: S[STATION.aftGun] as Station },
      { look: at(1), station: S[STATION.stoker] as Station },
      { look: at(2), station: S[STATION.smith] as Station },
      { look: at(3), station: st(-4.0, 2.3, "idle", -1), pose: blow(0, -1) },
      { look: at(4), station: S[STATION.sleeper] as Station },
      { look: at(5), station: st(-3.4, 1.35, "idle", -1), pose: bow(1, -1) },
      { look: at(6), station: st(0.85, 2.35, "idle", -1), pose: blow(2, -1) },
      { look: at(7), station: st(-1.5, 1.6, "idle", 1), pose: blow(3, 1) },
      { look: at(8), station: st(2.55, 0.05, "idle", 1), pose: haul(0) },
      { look: at(9), station: st(2.95, -0.55, "idle", 1), pose: haul(1) },
      { look: at(10), station: st(2.5, 2.35, "idle", 1), pose: blow(4, 1) },
      { look: at(11), station: st(3.0, 1.35, "idle", 1), pose: hurt(clamp((t % 3) / 1.2), 1) },
      { look: at(12), station: S[STATION.helm] as Station },
      { look: at(13), station: S[STATION.foreGun] as Station },
      { look: at(14), station: S[STATION.lookout] as Station },
    ];
  };

  const city = (t: number): TopCity => ({
    ox: cx,
    oy: cy,
    T,
    t,
    gait: gait(t),
    walk: 1,
    settle: 0,
    ramp: 0,
    rampSide: 1,
    detail: 0.5,
    size: SIZE,
    crew: fighters(t),
    lantern: 0.4,
    gunAim: [2.25, 1.25],
  });
  const H = (t: number): number => hullRide(t, gait(t), 1, 0).belly + HULL_DEEP;
  const CP = (t: number): Proj => (x, y, z) => [cx + x * T, cy + y * BACK * T - z * UP * T];

  const rig = (t: number): Rig =>
    take === "a" ? walkerRig(rx, ry, t) : take === "b" ? wagonRig(rx, ry, t) : sledgeRig(rx, ry, t);

  const lines = (t: number): number[][] => {
    const r = rig(t);
    const P = CP(t);
    const h = H(t);
    return LANDINGS.map((xL, i) => {
      const end = P(xL, halfWidth(xL) * 0.98, h + 0.25);
      return linePts(r.throwers[i] as [number, number], end, 10 + i * 3);
    });
  };

  // Boarders on the deck: one coming over the rail at each landing, one on the deck mid-ships.
  const boardersAboard = (t: number) => (P: Proj, h: number) => {
    const out: { y: number; draw: () => void }[] = [];
    LANDINGS.forEach((xL, i) => {
      out.push({
        y: 3.3,
        draw: () => {
          const [x, y] = P(xL + 0.15, halfWidth(xL) - 0.05, h + 0.2);
          const beat = (t * 1.3 + i * 0.5) % 1;
          drawHound(
            d0(),
            x,
            y,
            HOUND,
            beastPose({ face: i === 0 ? 1 : -1, head: 1, coil: beat > 0.5 ? (beat - 0.5) * 2 : 0, lunge: beat < 0.2 ? 1 - beat / 0.2 : 0, stretch: 1.05 }),
            i % 3,
            6000 + i * 17,
          );
        },
      });
    });
    out.push({
      y: 2.25,
      draw: () => {
        const [x, y] = P(-0.25, 2.25, h);
        const beat = (t * 1.1) % 1;
        drawHound(d0(), x, y, HOUND, beastPose({ face: 1, head: 0.5, lunge: beat < 0.25 ? 1 - beat / 0.25 : 0, coil: beat > 0.7 ? (beat - 0.7) * 3 : 0 }), 1, 6100);
      },
    });
    // A boarder on the fore deck going for the stores: the hurt citizen took its bite.
    out.push({
      y: 1.75,
      draw: () => {
        const [x, y] = P(3.85, 1.7, h);
        drawHound(d0(), x, y, HOUND, beastPose({ face: -1, head: 0, lunge: 0.6 }), 2, 6110);
      },
    });
    // The crate the two are dragging inboard, and its rope.
    out.push({
      y: -0.2,
      draw: () => {
        const d = d0();
        const [x, y] = P(1.7, -0.25, h);
        drawCrate(d, x, y, 13, 6200);
        const [h1x, h1y] = P(2.55, 0.05, h);
        const [h2x, h2y] = P(2.95, -0.55, h);
        d.curve([x + 12, y - 8, (x + h1x) / 2, y - 4, h1x - 14, h1y - SIZE * 0.45], FORM, 6210);
        d.curve([x + 12, y - 10, (x + h2x) / 2, y - 12, h2x - 14, h2y - SIZE * 0.45], FORM, 6211);
      },
    });
    // A second crate already dragged in, by the hatch.
    out.push({
      y: 0.6,
      draw: () => {
        const [x, y] = P(1.3, 0.55, h);
        drawCrate(d0(), x, y, 12, 6220);
      },
    });
    return out;
  };
  let current: Draw | null = null;
  const d0 = (): Draw => current as Draw;

  const corners = (crowdLook: Look): Corners => ({
    left: 80,
    to: "landing",
    gone: 100 / 180,
    horn: 1,
    late: false,
    head: "Medium 23–68",
    lines: ["packs ×2", "rares +40%"],
    log: { who: crowdLook.name, rgb: crowdLook.cloak, what: itemName(22, 1, 3), whatRgb: itemInk(1) },
    counts: [0, 15, 9, 31],
  });

  const placesOf = (t: number): { look: Look; x: number; y: number }[] => {
    const P = CP(t);
    const h = H(t);
    return fighters(t).map((m) => {
      const [x, y] = P(m.station.x, m.station.y, h + m.station.z);
      return { look: m.look, x, y };
    });
  };

  const tags = new TagTimeline((t) => {
    const places = placesOf(t);
    // The corner slips' rectangles, as drawDeskCorners lays them out; generous boxes are fine here.
    const taken = [
      FRAME.x0, FRAME.y0, FRAME.x0 + 260, FRAME.y0 + 110,
      FRAME.x1 - 230, FRAME.y0, FRAME.x1, FRAME.y0 + 130,
      FRAME.x0, FRAME.y1 - 80, FRAME.x0 + 560, FRAME.y1,
      FRAME.x1 - 380, FRAME.y1 - 80, FRAME.x1, FRAME.y1,
    ];
    for (const p of places) taken.push(...headBox(p.x, p.y, SIZE));
    const c = city(t);
    const [lx, ly] = lanternAt(c);
    taken.push(lx - 16, ly - 20, lx + 16, ly + 16);
    // Named: the six at the rail, both gunners, the two hauling, the hurt one and the lookout.
    const quiet = new Set([1, 2, 4, 12]);
    const wants: TagWant[] = places.filter((_, i) => !quiet.has(i)).map((p) => ({
      key: p.look.id,
      x: p.x,
      y: p.y - SIZE * HAT_TOP,
      name: p.look.name,
      rgb: p.look.cloak,
      size: TAG,
    }));
    return { wants, taken, must: true, lines: [...stayLines(c), ...lines(t).flatMap((l) => {
      const a = l;
      const out: number[] = [];
      for (let i = 0; i + 3 < a.length; i += 6) out.push(a[i] as number, a[i + 1] as number, a[Math.min(a.length - 2, i + 6)] as number, a[Math.min(a.length - 1, i + 7)] as number);
      return out;
    })] };
  });

  return {
    duration: 12,
    draw(d: Draw, t: number): void {
      current = d;
      const c = city(t);
      c.more = boardersAboard(t);
      const r = rig(t);
      // The stream turned to run down the frame's upper right, off the line between the machines.
      drawTransitPlan(d, cx, cy, T, t * WALK_SPEED, 1, { slope: 1, at: (1320 - cx) / T + 14.7 });
      r.ground(d);
      // Bodies on the ground between and astern: shot off the lines and left behind.
      for (const [wx, wy, k] of [
        [-2.5, 10.4, 0],
        [-9.5, 11.2, 1],
        [-16.5, 8.8, 2],
      ] as const) {
        const x = cx + (wx - ((t * WALK_SPEED) % 1)) * T;
        const y = cy + wy * BACK * T;
        if (x < FRAME.x0 + 40) continue;
        d.strength = 0.9;
        drawHound(d, x, y, HOUND, beastPose({ face: k % 2 ? 1 : -1, rest: 1, ink: 0.4, wake: 2 }), k % 3, 6300 + k);
        d.fill(d.round(x + 20, y + 4, 16, 6, 9, 6310 + k), INK, 0.8, true);
        d.strength = 1;
      }
      drawTopCity(d, c);
      const ls = lines(t);
      ls.forEach((pts, i) => {
        d.curve(pts, CONTOUR, 6400 + i);
        const n = pts.length;
        drawHook(d, pts[n - 2] as number, pts[n - 1] as number, (pts[n - 2] as number) - (pts[n - 4] as number), (pts[n - 1] as number) - (pts[n - 3] as number), 6410 + i);
      });
      // Boarders on the lines: one or two crossing each, one with a crate going back.
      const onLine: [number, number, number, boolean][] = [
        [0, 0.38, 0, false],
        [0, 0.72, 1, false],
        [1, 0.5, 2, true],
        [2, 0.3, 0, false],
        [2, 0.62, 1, false],
      ];
      for (const [li, u0, build, crate] of onLine) {
        const pts = ls[li] as number[];
        const u = crate ? u0 - ((t * 0.02) % 0.1) : u0 + ((t * 0.03) % 0.1);
        const [x, y, ang] = along(pts, u);
        const face = Math.cos(ang) >= 0 ? 1 : -1;
        const tilt = face > 0 ? ang : ang - Math.PI;
        if (crate) {
          drawCrate(d, x - 6, y + 22, 11, 6500);
          d.line(x, y, x - 6, y + 10, FORM, 6501);
        }
        houndOn(d, x, y, clamp(tilt, -0.9, 0.9), beastPose({ face: crate ? -face : face, stride: (t * 2 + u0) % 1, speed: 0.5, head: crate ? -0.5 : 0.6 }), build, 6510 + li * 7 + Math.round(u0 * 10));
      }
      // Arrows from the rail at the boarders on the lines, in their archers' colours, one just landed.
      for (const [li, u, off, k] of [
        [0, 0.55, -26, 5],
        [1, 0.62, 30, 7],
        [1, 0.3, -24, 11],
      ] as const) {
        const pts = ls[li] as number[];
        const [x, y, ang] = along(pts, u);
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        drawShaft(d, x + nx * off, y + ny * off, 26, -Math.cos(ang), -Math.sin(ang), at(k).cloak, false, 6800 + k);
      }
      {
        const [x, y] = along(ls[0] as number[], 0.72);
        drawBurst(d, x, y - 14, 0.04, 26, 6820);
      }
      // The guns firing: a burst at each muzzle, and a boarder knocked off line 3 by the fore gun.
      const h = H(t);
      const P = CP(t);
      for (const [gx, aim, age, seed] of [
        [6.85, 2.25, 0.06, 6600],
        [-6.85, 1.25, 0.16, 6610],
      ] as const) {
        const [gx0, gy0] = P(gx, 0, h + 0.18);
        const mx = gx0 + Math.cos(aim) * 1.25 * T;
        const my = gy0 + Math.sin(aim) * BACK * 1.25 * T - 0.12 * T;
        drawBurst(d, mx, my, age, 34, seed);
        // The shot's track.
        for (let k = 1; k < 5; k++) {
          const a = 1.4 * T + k * 0.55 * T;
          d.line(gx0 + Math.cos(aim) * a, gy0 + Math.sin(aim) * BACK * a - 0.12 * T, gx0 + Math.cos(aim) * (a + 0.3 * T), gy0 + Math.sin(aim) * BACK * (a + 0.3 * T) - 0.12 * T, FORM, seed + k);
        }
      }
      {
        const [x, y] = along(ls[2] as number[], 0.45);
        d.push();
        d.move(x + 18, y + 40);
        d.turn(2.3);
        drawHound(d, 0, 0, HOUND, beastPose({ face: 1, hurt: 1, flash: true }), 2, 6700);
        d.pop();
        drawNumber(d, x + 52, y + 4, 31, 24, false, 1);
      }
      // A citizen's blow landing on the hound at the mid landing.
      {
        const [x, y] = P(-0.25, 2.25, h);
        drawNumber(d, x + 6, y - 64, 12, 24, false, 1);
      }
      r.draw(d);
      drawDeskCorners(d, corners(at(6)));
      drawPlacedTags(d, tags.get(t));
      drawFrameRule(d);
    },
  };
}

export const raidAScene = (): Scene => raidScene("a");
export const raidBScene = (): Scene => raidScene("b");
export const raidCScene = (): Scene => raidScene("c");
