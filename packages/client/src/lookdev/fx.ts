// Effects (docs/art.md, sections 9 and 10). Ink is the one material: a blow
// is a dry-brush stroke, a kill is ink thrown along the blow, and what lands
// stays on the ground as a stain. Ink marks are held drawings that change
// twelve times a second; bodies move every frame.

import { BLOW, CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER } from "./draw.ts";
import { clamp, easeOut, hash, lerp, mix, smooth } from "./geom.ts";

/** Time as an ink mark sees it: in steps of a twelfth of a second. */
export const onTwos = (age: number): number => Math.floor(age * 12) / 12;

const STAIN = mix(PAPER, 0x5e4336, 0.48);
const STAIN_RIM = mix(PAPER, 0x3f2c24, 0.7);

/** The colour of a drop's mark, by rarity: none, blue, yellow, orange. */
export const RARITY = [0x8a7f74, 0x3e70a2, 0xd79a1e, 0xd9622b] as const;

/**
 * The stroke a wide blow leaves: one dry-brush arc in the citizen's colour
 * round (x, y), wet and dark at its leading end and breaking up at its tail.
 * It holds for three frames, then runs dry and is gone.
 */
export function drawSwing(
  d: Draw,
  x: number,
  y: number,
  radius: number,
  angle: number,
  sweep: number,
  age: number,
  rgb: number,
  seed: number,
): void {
  if (age < 0 || age > 0.42) return;
  const held = onTwos(age);
  const zoom = d.zoom;
  const cx = d.sx(x, y);
  const cy = d.sy(x, y);
  const r = radius * zoom;
  const stations = 18;
  const rib: number[] = [];
  const along: number[] = [];
  const dry: number[] = [];
  const parch = held < 0.06 ? 0 : smooth(0.05, 0.28, held);
  for (let i = 0; i <= stations; i++) {
    const u = i / stations;
    // u = 1 is the leading end, where the blade is.
    const a = angle - sweep / 2 + sweep * u;
    const width = r * 0.44 * (0.2 + 0.8 * u ** 0.7) * (1 - 0.6 * (u > 0.9 ? (u - 0.9) * 10 : 0));
    const rr = r * (0.82 + 0.1 * u);
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    rib.push(
      cx + cos * (rr + width / 2),
      cy + sin * (rr + width / 2),
      cx + cos * (rr - width / 2),
      cy + sin * (rr - width / 2),
    );
    along.push(u * sweep * r);
    dry.push(clamp(0.82 - u * 0.9 + parch));
  }
  d.surface.brush(rib, stations + 1, mix(rgb, INK, 0.22), d.strength, along, dry, seed);
  // The wet leading end, darker.
  const tip: number[] = [];
  const tipAlong: number[] = [];
  const tipDry: number[] = [];
  for (let i = 0; i <= 6; i++) {
    const u = 0.72 + (i / 6) * 0.28;
    const a = angle - sweep / 2 + sweep * u;
    const width = r * 0.16 * (1 - 0.5 * (i / 6));
    const rr = r * (0.84 + 0.1 * u);
    tip.push(
      cx + Math.cos(a) * (rr + width / 2),
      cy + Math.sin(a) * (rr + width / 2),
      cx + Math.cos(a) * (rr - width / 2),
      cy + Math.sin(a) * (rr - width / 2),
    );
    tipAlong.push(u * sweep * r);
    tipDry.push(clamp(0.5 - (i / 6) * 0.5 + parch * 1.2));
  }
  d.surface.brush(tip, 7, mix(rgb, INK, 0.6), d.strength, tipAlong, tipDry, seed + 3);
  // Drops shaken off the end of the stroke.
  if (held > 0.05) {
    for (let k = 0; k < 5; k++) {
      const a = angle + sweep / 2 + 0.1 + hash(seed, k) * 0.5;
      const far = r * (0.95 + held * (1.2 + hash(seed, k + 5) * 1.6));
      d.surface.poly(
        blot(
          cx + Math.cos(a) * far,
          cy + Math.sin(a) * far,
          1.6 + hash(seed, k + 9) * 2.4,
          seed + k,
        ),
        BLOT,
        mix(rgb, INK, 0.35),
        d.strength * (1 - held * 2.6),
      );
    }
  }
}

const scratch: number[] = [];
/** How many points a blot's edge has. */
const BLOT = 12;

/** A seven-sided blot in frame pixels. */
function blot(x: number, y: number, r: number, seed: number): number[] {
  scratch.length = 0;
  // Two or three lobes, so no two blots are the same shape and none is a regular polygon.
  const lobes = 2 + (seed % 2);
  const turn = hash(seed, 3) * 6.28;
  for (let i = 0; i < BLOT; i++) {
    const a = (i / BLOT) * Math.PI * 2 + seed;
    const rr = r * (0.8 + 0.22 * Math.sin(a * lobes + turn) + hash(i, seed) * 0.16);
    scratch.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  return scratch;
}

export interface Spill {
  /** Where the body was, in tiles, and which way the blow went. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Seconds since the kill. */
  age: number;
  /** 0 fodder, 1 pack, 2 brute. */
  rank: number;
  seed: number;
}

/**
 * Ink on the ground. Each spill is a pool where the body was and drops thrown
 * along the blow in a fan about sixty degrees wide. Wet ink is solid; it
 * spreads, stops, and dries to a brown stain. All the dry stains are laid
 * with one rim and one fill, so stains that touch are one pool with one edge.
 */
export function drawSpills(d: Draw, spills: readonly Spill[], count: number): void {
  const zoom = d.zoom;
  const surface = d.surface;
  // Rim first, then fill, then whatever is still wet on top.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < count; i++) {
      const s = spills[i] as Spill;
      const wetness = 1 - smooth(1, 4.5, s.age);
      // After a while a stain fades into the paper.
      const gone = smooth(8, 15, s.age);
      if (gone >= 1) continue;
      if (pass === 2 && wetness <= 0) continue;
      const held = onTwos(s.age);
      const scale = (s.rank === 0 ? 0.26 : s.rank === 1 ? 0.55 : 1.2) * zoom;
      const spread = 0.55 + 0.45 * easeOut(clamp(held / 1.4));
      const grow = pass === 0 ? 1.8 : 0;
      const rgb = pass === 0 ? STAIN_RIM : pass === 1 ? STAIN : INK;
      const alpha = pass === 2 ? wetness : 1 - gone;
      const bx = d.sx(s.x, s.y);
      const by = d.sy(s.x, s.y);
      // The pool.
      const pool = blot(
        bx,
        by,
        scale * spread * (pass === 2 ? 0.55 + 0.45 * wetness : 1) + grow,
        s.seed,
      );
      surface.poly(pool, BLOT, rgb, alpha * d.strength);
      // The drops, landing along the blow.
      const drops = s.rank === 0 ? 6 : s.rank === 1 ? 10 : 18;
      const heading = Math.atan2(s.dy, s.dx);
      for (let k = 0; k < drops; k++) {
        const a = heading + (hash(s.seed, k) - 0.5) * 1.05;
        const reach = scale * (1.2 + hash(s.seed, k + 20) * 3.0);
        const land = 0.05 + hash(s.seed, k + 40) * 0.16;
        const u = clamp(held / land);
        const far = reach * easeOut(u);
        const size = scale * (0.14 + hash(s.seed, k + 60) * 0.3) * (0.6 + 0.4 * spread);
        const px = bx + Math.cos(a) * far;
        const py = by + Math.sin(a) * far - Math.sin(u * Math.PI) * reach * 0.18;
        if (u < 1 && pass < 2) continue;
        if (u < 1) {
          // In the air: a streak along its flight.
          surface.poly(
            [
              px,
              py,
              px - Math.cos(a) * size * 3,
              py - Math.sin(a) * size * 3 + 1,
              px - Math.cos(a) * size * 3,
              py - Math.sin(a) * size * 3 - 1,
            ],
            3,
            INK,
            d.strength,
          );
        }
        surface.poly(
          blot(px, py, Math.max(1.1, size) + grow, s.seed + k),
          BLOT,
          rgb,
          alpha * d.strength,
        );
        // A run from a big drop, down the blow.
        if (k % 4 === 0 && u >= 1) {
          const run = size * 3.5 * spread;
          surface.poly(
            [
              px - Math.sin(a) * size * 0.5,
              py + Math.cos(a) * size * 0.5,
              px + Math.cos(a) * run,
              py + Math.sin(a) * run,
              px + Math.sin(a) * size * 0.5,
              py - Math.cos(a) * size * 0.5,
            ],
            3,
            rgb,
            alpha * d.strength,
          );
        }
      }
    }
  }
}

/**
 * A pack monster or brute coming apart into the strokes it was drawn with,
 * which fall and pool. `k` runs 0 to 1 over the fall.
 */
export function drawUnmade(
  d: Draw,
  x: number,
  y: number,
  size: number,
  dx: number,
  dy: number,
  k: number,
  seed: number,
): void {
  const strokes = 9;
  for (let i = 0; i < strokes; i++) {
    const a = (i / strokes) * Math.PI * 2 + seed;
    const out = size * (0.3 + hash(seed, i) * 0.5);
    const fall = k * k;
    const sx = x + Math.cos(a) * out * (0.6 + k * 0.5) + dx * size * k * 1.3;
    const sy =
      y - size * 0.55 * (1 - fall) + Math.sin(a) * out * 0.5 * (1 - fall) + dy * size * k * 1.3;
    const len = size * (0.5 + hash(seed, i + 9) * 0.5) * (1 - k * 0.6);
    const turn = a + k * (hash(seed, i + 3) - 0.5) * 5;
    d.curve(
      [
        sx - Math.cos(turn) * len * 0.5,
        sy - Math.sin(turn) * len * 0.5,
        sx + Math.sin(turn) * len * 0.15,
        sy - Math.cos(turn) * len * 0.15,
        sx + Math.cos(turn) * len * 0.5,
        sy + Math.sin(turn) * len * 0.5,
      ],
      i % 3 === 0 ? HEAVY : CONTOUR,
      seed + i,
    );
  }
}

/** Dust at the feet of something thrown back: two or three strokes and a skid line. */
export function drawSkid(
  d: Draw,
  x: number,
  y: number,
  dx: number,
  dy: number,
  age: number,
  seed: number,
): void {
  if (age > 0.45) return;
  const held = onTwos(age);
  const strength = d.strength;
  d.strength = strength * (1 - held / 0.45);
  d.line(x - dx * 0.9, y - dy * 0.9 + 0.04, x - dx * 0.1, y - dy * 0.1 + 0.04, HAIR, seed);
  for (let k = 0; k < 3; k++) {
    const px = x - dx * (0.3 + k * 0.3) + (hash(seed, k) - 0.5) * 0.3;
    const py = y - dy * (0.3 + k * 0.3) - 0.1 - held * 0.9 * (0.4 + hash(seed, k + 3));
    d.curve(
      [px - 0.14, py + 0.05, px - 0.05, py - 0.08, px + 0.1, py - 0.05, px + 0.16, py + 0.06],
      FORM,
      seed + k + 6,
    );
  }
  d.strength = strength;
}

/** An arrow in flight: a line with a streak behind it three times its length, and its shadow on the ground. */
export function drawArrow(
  d: Draw,
  x: number,
  y: number,
  dx: number,
  dy: number,
  height: number,
  seed: number,
): void {
  d.line(x - dx * 0.3, y - dy * 0.3 + 0.06, x + dx * 0.2, y + dy * 0.2 + 0.06, HAIR, seed, 0.6);
  const ay = y - height;
  d.line(x - dx * 1.9, ay - dy * 1.9, x - dx * 0.5, ay - dy * 0.5, HAIR, seed + 1, 0.8);
  d.line(
    x - dx * 1.4,
    ay - dy * 1.4 + 0.05,
    x - dx * 0.6,
    ay - dy * 0.6 + 0.05,
    HAIR,
    seed + 2,
    0.5,
  );
  d.line(x - dx * 0.5, ay - dy * 0.5, x + dx * 0.28, ay + dy * 0.28, CONTOUR, seed + 3);
}

/** A sling stone: a dot on its arc, with its shadow running along the ground beneath. */
export function drawStone(d: Draw, x: number, y: number, height: number): void {
  d.hatch(d.round(x, y + 0.03, 0.2, 0.07, 6), 2, INK, 0.7);
  d.dot(x, y - height, 3.4);
  d.dot(x - 0.5, y - height * 0.96, 1.4, INK, 0.5);
}

/** A firepot: a dot trailing loops of smoke. */
export function drawPot(
  d: Draw,
  x: number,
  y: number,
  dx: number,
  dy: number,
  height: number,
  t: number,
  seed: number,
): void {
  d.hatch(d.round(x, y + 0.03, 0.24, 0.08, 6), 2, INK, 0.7);
  const py = y - height;
  for (let k = 1; k < 5; k++) {
    const sx = x - dx * k * 0.34;
    const sy = py - dy * k * 0.34 - k * 0.05;
    const r = 0.07 + k * 0.035;
    d.curve(d.round(sx, sy, r, r, 7, seed + k + Math.floor(t * 12)).slice(0, 12), HAIR, seed + k);
  }
  d.dot(x, py, 4.6, 0xd98f3e);
  d.curve(d.round(x, py, 0.15, 0.15, 7), FORM, seed, true);
}

/**
 * Where a firepot landed: an amber wash that spreads in a ring with a
 * hatched edge and burns down, leaving a scorch.
 */
export function drawBurn(d: Draw, x: number, y: number, age: number, seed: number): void {
  const held = onTwos(age);
  const grow = easeOut(clamp(held / 0.35));
  const r = 1.7 * grow;
  const life = clamp(1 - (held - 0.4) / 2.2);
  if (held > 0.5)
    d.wash(d.round(x, y, r * 0.9, r * 0.8, 11, seed), 0x4a4440, 0.3 * (1 - life * 0.6), true);
  if (life > 0) {
    d.wash(
      d.round(x, y, r, r * 0.92, 12, seed + Math.floor(held * 6)),
      0xe79a3c,
      0.55 * life,
      true,
    );
    d.wash(d.round(x, y, r * 0.55 * life, r * 0.5 * life, 9, seed + 2), 0xf6cf6a, 0.7 * life, true);
    // Its edge, in short strokes that thin as it burns down.
    const strength = d.strength;
    d.strength = strength * life;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + seed;
      const flick = hash(k, seed + Math.floor(held * 12)) * 0.3;
      d.line(
        x + Math.cos(a) * r * 0.9,
        y + Math.sin(a) * r * 0.84,
        x + Math.cos(a) * r * (1.04 + flick),
        y + Math.sin(a) * r * (0.96 + flick) - flick * 0.4,
        FORM,
        k + seed,
      );
    }
    d.strength = strength;
  }
}

/**
 * A blow about to land: its shape fills with red-brown hatching a stroke at
 * a time, so its fullness says how soon. `k` runs 0 to 1.
 */
export function drawTelegraph(
  d: Draw,
  x: number,
  y: number,
  angle: number,
  radius: number,
  k: number,
): void {
  const pts = [x, y];
  for (let i = 0; i <= 10; i++) {
    const a = angle - 0.95 + (i / 10) * 1.9;
    pts.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius * 0.9);
  }
  const strength = d.strength;
  d.strength = strength * 0.9;
  const ink = d.ink;
  d.ink = BLOW;
  d.curve(pts.slice(2), FORM, 71);
  d.ink = ink;
  // The filled part grows outward from the brute.
  const part = [x, y];
  const reach = radius * clamp(k);
  for (let i = 0; i <= 10; i++) {
    const a = angle - 0.95 + (i / 10) * 1.9;
    part.push(x + Math.cos(a) * reach, y + Math.sin(a) * reach * 0.9);
  }
  d.hatch(part, 2, BLOW, 0.95, false, 1.5);
  d.strength = strength;
}

/** What kind of thing a drop is, from its place in the list: drawn small, in colour. */
function drawItem(d: Draw, x: number, y: number, kind: number, rgb: number, seed: number): void {
  if (kind === 0) {
    // A blade.
    d.line(x - 0.2, y + 0.16, x + 0.22, y - 0.26, CONTOUR, seed);
    d.line(x - 0.2, y + 0.02, x - 0.04, y + 0.16, CONTOUR, seed + 1);
  } else if (kind === 1) {
    // A ring.
    d.body(d.round(x, y - 0.06, 0.15, 0.15, 8), { wash: rgb, washAlpha: 1, weight: FORM, seed });
    d.dot(x, y - 0.06, 1.6, PAPER);
  } else if (kind === 2) {
    // A helm.
    d.body(
      [x - 0.2, y + 0.1, x - 0.18, y - 0.14, x, y - 0.3, x + 0.18, y - 0.14, x + 0.2, y + 0.1],
      { wash: rgb, washAlpha: 1, weight: FORM, seed },
    );
  } else {
    // A pouch.
    d.body(d.round(x, y, 0.17, 0.14, 7, seed), { wash: rgb, washAlpha: 1, weight: FORM, seed });
    d.line(x - 0.08, y - 0.14, x + 0.08, y - 0.14, FORM, seed + 2);
  }
}

/**
 * A drop on the ground, drawn as the kind of item it is. Rarity is an
 * ornament on its outline: none, one ring, a ring with ticks. A rare or
 * unique drop also has a tall brush mark in its colour above it, taller for
 * a unique. The scene letters the name of a rare or unique beside it.
 */
export function drawDrop(
  d: Draw,
  x: number,
  y: number,
  fx: number,
  fy: number,
  age: number,
  rarity: number,
  kind: number,
  seed: number,
  t: number,
): void {
  // It is thrown from the body and bounces once.
  const fly = clamp(age / 0.3);
  const px = lerp(fx, x, easeOut(fly));
  const py = lerp(fy, y, easeOut(fly));
  const hop =
    fly < 1
      ? Math.sin(fly * Math.PI) * 0.9
      : Math.max(0, Math.sin(clamp((age - 0.3) / 0.16) * Math.PI)) * 0.18;
  const rgb = RARITY[rarity] as number;
  const ink = d.ink;
  if (fly >= 1) d.hatch(d.round(px, py + 0.04, 0.3, 0.09, 7), 2, INK, 0.6);
  if (rarity === 0) {
    // Common: a small thing, hardly marked. Most of what drops is this.
    d.dot(px, py - hop - 0.05, 2.6, 0xb8a98c);
    d.curve(d.round(px, py - hop - 0.05, 0.1, 0.1, 6), HAIR, seed, true);
    return;
  }
  drawItem(d, px, py - hop, kind, rgb, seed);
  if (fly < 1) return;
  const since = age - 0.3;
  d.ink = mix(rgb, INK, 0.25);
  // The ring round it, drawn on.
  const ring = d.round(px, py - 0.02, 0.42, 0.3, 12);
  const shown = Math.max(4, Math.floor(clamp(since / 0.2) * 26));
  ring.push(ring[0] as number, ring[1] as number);
  d.curve(ring.slice(0, shown), FORM, seed + 5);
  if (rarity >= 2) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      d.line(
        px + Math.cos(a) * 0.5,
        py - 0.02 + Math.sin(a) * 0.36,
        px + Math.cos(a) * 0.66,
        py - 0.02 + Math.sin(a) * 0.48,
        FORM,
        seed + 10 + k,
      );
    }
    // The tall mark: one brush stroke pulled upward, wet at its foot, dry at its head.
    const height = (rarity === 3 ? 4.6 : 3.3) * easeOut(clamp(since / 0.28));
    const zoom = d.zoom;
    const bx = d.sx(px, py);
    const by = d.sy(px, py);
    const rib: number[] = [];
    const along: number[] = [];
    const dry: number[] = [];
    const sway = Math.sin(t * 1.6 + seed) * 0.6;
    for (let i = 0; i <= 12; i++) {
      const u = i / 12;
      const w =
        zoom * (rarity === 3 ? 0.3 : 0.22) * (1 - u * 0.75) * (0.8 + 0.2 * Math.sin(u * 9 + seed));
      const cx = bx + Math.sin(u * 2.4 + seed) * zoom * 0.07 + sway * u * u * 3;
      const cy = by - zoom * (0.5 + u * height);
      rib.push(cx - w, cy, cx + w, cy);
      along.push(u * height * zoom);
      dry.push(clamp(u * 1.0 - 0.18));
    }
    d.surface.brush(rib, 13, rgb, d.strength, along, dry, seed);
    // A flick at its head, and two specks.
    const hx = bx + sway * 3;
    const hy = by - zoom * (0.5 + height);
    if (since > 0.28) {
      d.surface.poly(blot(hx + 5, hy - 7, 2.4, seed), BLOT, rgb, d.strength);
      d.surface.poly(blot(hx - 6, hy - 14, 1.6, seed + 1), BLOT, rgb, d.strength);
    }
  }
  d.ink = ink;
}

/**
 * A number lettered where a blow landed, rising along the blow. Three sizes
 * by how large the blow was; a crit is italic with a stroke under it.
 */
export function drawNumber(
  d: Draw,
  x: number,
  y: number,
  dx: number,
  dy: number,
  age: number,
  value: number,
  crit: boolean,
  kill: boolean,
): void {
  if (age > 0.9) return;
  const rise = easeOut(clamp(age / 0.5)) * 1.3;
  const px = d.sx(x + dx * rise * 0.8, y + dy * rise * 0.5 - 1.2 - rise * 0.7);
  const py = d.sy(x + dx * rise * 0.8, y + dy * rise * 0.5 - 1.2 - rise * 0.7);
  const size = crit ? 36 : kill ? 30 : 24;
  const alpha = 1 - smooth(0.6, 0.9, age);
  const text = String(value);
  const face = crit ? "italic" : "roman";
  // Paper under the figures, so they read over ink.
  for (const [ox, oy] of [
    [-2, 0],
    [2, 0],
    [0, -2],
    [0, 2],
  ] as const)
    d.surface.text(face, size, text, px + ox - size * 0.3, py + oy, 0, PAPER, alpha * 0.9);
  d.surface.text(face, size, text, px - size * 0.3, py, 0, crit ? BLOW : INK, alpha);
  if (crit)
    d.surface.strip(
      [
        px - size * 0.35,
        py + 5,
        px - size * 0.35,
        py + 8,
        px + size * 0.75,
        py + 3,
        px + size * 0.75,
        py + 5,
      ],
      2,
      BLOW,
      alpha,
    );
}

/** Where a blow lands: a burst of short strokes round a point of bare paper, held for two drawings. */
export function drawImpact(
  d: Draw,
  x: number,
  y: number,
  age: number,
  size: number,
  seed: number,
): void {
  if (age < 0 || age > 0.17) return;
  const held = onTwos(age);
  const cx = d.sx(x, y);
  const cy = d.sy(x, y);
  const r = size * d.zoom * (0.7 + held * 4);
  const star: number[] = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + seed;
    const rr = r * (k % 2 ? 0.42 : 0.9 + hash(seed, k) * 0.3);
    star.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9);
  }
  d.surface.poly(star, 14, PAPER, d.strength * 0.55);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + seed * 1.7;
    const r0 = r * (1.0 + hash(seed, k + 20) * 0.2);
    const r1 = r * (1.5 + hash(seed, k + 30) * 0.7);
    const w = 1.6;
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    d.surface.poly(
      [
        cx + Math.cos(a) * r0 + nx,
        cy + Math.sin(a) * r0 * 0.9 + ny,
        cx + Math.cos(a) * r1,
        cy + Math.sin(a) * r1 * 0.9,
        cx + Math.cos(a) * r0 - nx,
        cy + Math.sin(a) * r0 * 0.9 - ny,
      ],
      3,
      INK,
      d.strength,
    );
  }
}
