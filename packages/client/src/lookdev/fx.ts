// Effects (docs/art.md, sections 9 and 10). Ink is the one material: a blow
// is a dry-brush stroke, a kill is ink thrown along the blow, and what lands
// stays on the ground as a stain. Ink marks are held drawings that change
// twelve times a second; bodies move every frame.

import { BLOW, CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER } from "./draw.ts";
import { clamp, easeOut, hash, mix, smooth } from "./geom.ts";
import { measure } from "./surface.ts";

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
  /** How wide the wet end is, in pixels; a sixth of the radius if not said. */
  wet = 0,
): void {
  if (age < 0 || age > 0.42) return;
  const held = onTwos(age);
  const zoom = d.zoom;
  const cx = d.sx(x, y);
  const cy = d.sy(x, y);
  const r = radius * zoom;
  const body = wet > 0 ? Math.min(0.44, (wet * 1.6) / r) : 0.44;
  const tipWide = wet > 0 ? wet / r : 0.16;
  const stations = 18;
  const rib: number[] = [];
  const along: number[] = [];
  const dry: number[] = [];
  const parch = held < 0.06 ? 0 : smooth(0.05, 0.28, held);
  for (let i = 0; i <= stations; i++) {
    const u = i / stations;
    // u = 1 is the leading end, where the blade is.
    const a = angle - sweep / 2 + sweep * u;
    const width = r * body * (0.2 + 0.8 * u ** 0.7) * (1 - 0.6 * (u > 0.9 ? (u - 0.9) * 10 : 0));
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
    const width = r * tipWide * (1 - 0.5 * (i / 6));
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
/** The turn from one of a blot's points to the next, and that turn two and three times over. */
const STEP = [Math.cos((Math.PI * 2) / BLOT), Math.sin((Math.PI * 2) / BLOT)] as const;
const STEP2 = [Math.cos((Math.PI * 4) / BLOT), Math.sin((Math.PI * 4) / BLOT)] as const;
const STEP3 = [Math.cos((Math.PI * 6) / BLOT), Math.sin((Math.PI * 6) / BLOT)] as const;

/** A seven-sided blot in frame pixels. */
function blot(x: number, y: number, r: number, seed: number): number[] {
  // Two or three lobes, so no two blots are the same shape and none is a regular polygon.
  const lobes = 2 + (seed % 2);
  const turn = hash(seed, 3) * 6.28;
  // Each point's angle is a step round from the last: turned by a fixed rotation, not looked up.
  let c = Math.cos(seed);
  let s = Math.sin(seed);
  let lc = Math.cos(seed * lobes + turn);
  let ls = Math.sin(seed * lobes + turn);
  const step = lobes === 2 ? STEP2 : STEP3;
  for (let i = 0; i < BLOT; i++) {
    const rr = r * (0.8 + 0.22 * ls + hash(i, seed) * 0.16);
    scratch[i * 2] = x + c * rr;
    scratch[i * 2 + 1] = y + s * rr;
    const nc = c * STEP[0] - s * STEP[1];
    s = s * STEP[0] + c * STEP[1];
    c = nc;
    const nl = lc * step[0] - ls * step[1];
    ls = ls * step[0] + lc * step[1];
    lc = nl;
  }
  return scratch;
}

/** How old a spill is when it has dried and stopped spreading, and when its stain has gone, in seconds. */
export const SPILL_DRY = 4.5;
export const SPILL_GONE = 15;

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
 * `from` and `to` pick which of the three passes (rim, fill, wet) to lay, so
 * a caller can put other stains between the rims and the fills.
 */
export function drawSpills(
  d: Draw,
  spills: readonly Spill[],
  count: number,
  from = 0,
  to = 3,
): void {
  const zoom = d.zoom;
  const surface = d.surface;
  // Rim first, then fill, then whatever is still wet on top.
  for (let pass = from; pass < to; pass++) {
    for (let i = 0; i < count; i++) {
      const s = spills[i] as Spill;
      const wetness = 1 - smooth(1, SPILL_DRY, s.age);
      // After a while a stain fades into the paper.
      const gone = smooth(8, SPILL_GONE, s.age);
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
      // Fodder bursts into five to nine drops thrown one to two tiles along the blow.
      const drops = s.rank === 0 ? 5 + (s.seed % 5) : s.rank === 1 ? 10 : 18;
      const heading = Math.atan2(s.dy, s.dx);
      for (let k = 0; k < drops; k++) {
        const a = heading + (hash(s.seed, k) - 0.5) * 1.05;
        const reach =
          scale * (s.rank === 0 ? 4 + hash(s.seed, k + 20) * 4 : 1.2 + hash(s.seed, k + 20) * 3.0);
        const land = 0.05 + hash(s.seed, k + 40) * 0.16;
        const u = clamp(held / land);
        const far = reach * easeOut(u);
        const size = Math.max(
          s.rank === 0 ? 2.5 : 0,
          scale * (0.14 + hash(s.seed, k + 60) * 0.3) * (0.6 + 0.4 * spread),
        );
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
    // The flames: one ragged shape with tongues, joined at the base, not a row of separate points.
    const tongues = 5;
    const w = r * 0.62 * (0.6 + 0.4 * life);
    const flame: number[] = [x - w, y + r * 0.12];
    for (let k = 0; k < tongues; k++) {
      const u0 = k / tongues;
      const um = (k + 0.5) / tongues;
      const tall =
        r *
        (0.55 + 0.5 * Math.sin(um * Math.PI)) *
        (0.75 + hash(k, seed + Math.floor(held * 12)) * 0.4);
      flame.push(
        x - w + u0 * 2 * w + w * 0.08,
        y - r * 0.1 - tall * 0.25 * life,
        x - w + um * 2 * w + (hash(k, seed + 3) - 0.5) * w * 0.12,
        y - r * 0.1 - tall * life,
      );
    }
    flame.push(x + w - w * 0.08, y - r * 0.1, x + w, y + r * 0.12);
    flame.push(x + w * 0.5, y + r * 0.22, x - w * 0.5, y + r * 0.22);
    d.fill(flame, 0xe8892f, 0.85 * life, true);
    const core = flame.map((v, i) => (i % 2 ? y + (v - y) * 0.55 + r * 0.06 : x + (v - x) * 0.6));
    d.fill(core, 0xf6cf6a, 0.8 * life, true);
    d.curve([...flame, flame[0] as number, flame[1] as number], FORM, seed + 40, false, life);
    d.strength = strength;
  }
}

/**
 * A blow about to land: its shape fills with red-brown hatching a stroke at
 * a time, so its fullness says how soon. `k` runs 0 to 1.
 */

// ---------------------------------------------------------------- in the air, in frame pixels

/**
 * An arrow or a bolt in flight at (x, y), `height` px above its shadow at
 * (x, y + height): a shaft at contour weight (a bolt at heavy) and a streak
 * behind it three times its length in the shooter's colour.
 */
export function drawShaft(
  d: Draw,
  x: number,
  y: number,
  height: number,
  dx: number,
  dy: number,
  rgb: number,
  bolt: boolean,
  seed: number,
  /** An arrow's shaft and streak, in pixels, if not 26 and 80; a bolt's are always 40 and 120. */
  arrow: readonly [number, number] = [26, 80],
): void {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const shaft = bolt ? 40 : arrow[0];
  const streak = bolt ? 120 : arrow[1];
  const ay = y - height;
  // Its shadow on the ground.
  d.line(
    x - ux * shaft * 0.6,
    y - uy * shaft * 0.3,
    x + ux * shaft * 0.3,
    y + uy * shaft * 0.15,
    FORM,
    seed,
    0.45,
  );
  // The streak: a tapering ribbon, wide at the shaft's tail.
  const nx = -uy;
  const ny = ux;
  const tx = x - ux * shaft * 0.5;
  const ty = ay - uy * shaft * 0.5;
  d.surface.poly(
    [
      tx + nx * 3,
      ty + ny * 3,
      tx - ux * streak + nx * 0.6,
      ty - uy * streak + ny * 0.6,
      tx - ux * streak - nx * 0.6,
      ty - uy * streak - ny * 0.6,
      tx - nx * 3,
      ty - ny * 3,
    ],
    4,
    mix(rgb, INK, 0.15),
    d.strength * 0.85,
  );
  d.line(tx, ty, x + ux * shaft * 0.5, ay + uy * shaft * 0.5, bolt ? HEAVY : CONTOUR, seed + 3);
  // The head.
  const hx = x + ux * shaft * 0.5;
  const hy = ay + uy * shaft * 0.5;
  d.surface.poly(
    [hx + ux * 7, hy + uy * 7, hx + nx * 3.5, hy + ny * 3.5, hx - nx * 3.5, hy - ny * 3.5],
    3,
    INK,
    d.strength,
  );
}

/** A sling stone: an 8 px dot `height` px above its 6 px shadow. */
export function drawStone(d: Draw, x: number, y: number, height: number): void {
  d.fill(d.round(x, y + 1, 6, 2.5, 7), INK, 0.4);
  d.dot(x, y - height, 4);
  d.dot(x - 6, y - height + 2, 1.4, INK, 0.5);
}

/** A firepot: a 12 px dot trailing loops of smoke, `height` px above its shadow. */
export function drawPot(
  d: Draw,
  x: number,
  y: number,
  height: number,
  dx: number,
  dy: number,
  t: number,
  seed: number,
): void {
  const l = Math.hypot(dx, dy) || 1;
  d.fill(d.round(x, y + 1, 8, 3, 7), INK, 0.4);
  const py = y - height;
  for (let k = 1; k < 5; k++) {
    const sx = x - (dx / l) * k * 10;
    const sy = py - (dy / l) * k * 10 - k * 2;
    const r = 3 + k * 1.6;
    d.curve(
      d.round(sx, sy, r, r, 7, seed + k + Math.floor(t * 12)).slice(0, 12),
      CONTOUR,
      seed + k,
    );
  }
  d.dot(x, py, 6, 0xd98f3e);
  d.curve(d.round(x, py, 6.5, 6.5, 8), FORM, seed, true);
}

/** How long a contact burst is held, in seconds: three drawings on twos. */
export const BURST_HOLD = 0.25;

/**
 * Where a blow lands: a burst `across` px wide, a star of bare paper inked
 * round its edge with heavy strokes thrown out of it, held on twos.
 */
export function drawBurst(
  d: Draw,
  x: number,
  y: number,
  age: number,
  across: number,
  seed: number,
  rgb = PAPER,
): void {
  if (age < 0 || age > BURST_HOLD) return;
  const held = onTwos(age);
  const r = (across / 2) * (0.75 + held * 1.6);
  const star: number[] = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + seed;
    const rr = r * (k % 2 ? 0.42 : 0.9 + hash(seed, k) * 0.3);
    star.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9);
  }
  d.surface.poly(star, 14, rgb, d.strength * 0.92);
  d.path(star, FORM, seed + 50, true, 0.85);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + seed * 1.7;
    const r0 = r * (0.95 + hash(seed, k + 20) * 0.2);
    const r1 = r * (1.5 + hash(seed, k + 30) * 0.6);
    const w = Math.max(2.4, across * 0.045);
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    d.surface.poly(
      [
        x + Math.cos(a) * r0 + nx,
        y + Math.sin(a) * r0 + ny,
        x + Math.cos(a) * r1,
        y + Math.sin(a) * r1,
        x + Math.cos(a) * r0 - nx,
        y + Math.sin(a) * r0 - ny,
      ],
      3,
      INK,
      d.strength,
    );
  }
}

/**
 * A blow about to land: an ellipse `w` by `h` px that fills with red-brown
 * hatching a stroke at a time, outward from its middle, so its fullness says
 * how soon. `k` runs 0 to 1.
 */
export function drawTelegraph(
  d: Draw,
  x: number,
  y: number,
  w: number,
  h: number,
  k: number,
  seed: number,
): void {
  const strength = d.strength;
  const ink = d.ink;
  d.ink = BLOW;
  d.strength = strength * 0.95;
  d.curve(d.round(x, y, w / 2, h / 2, 18, seed).slice(), CONTOUR, seed, true);
  d.ink = ink;
  const held = Math.floor(clamp(k) * 12) / 12;
  if (held > 0.02)
    d.hatch(d.round(x, y, (w / 2) * held, (h / 2) * held, 16, seed), 2, BLOW, 0.95, false, 2.2);
  d.strength = strength;
}

/** A maul's slam: a ring of ink strokes `w` by `h` px round where it landed, and dust. */
export function drawSlam(
  d: Draw,
  x: number,
  y: number,
  w: number,
  h: number,
  age: number,
  seed: number,
): void {
  if (age < 0 || age > 0.5) return;
  const held = onTwos(age);
  const strength = d.strength;
  d.strength = strength * (1 - held / 0.5);
  const grow = 0.75 + held * 0.6;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + hash(seed, i) * 0.3;
    const r0 = 0.82 + hash(i, seed) * 0.1;
    const r1 = 1.04 + hash(i, seed + 1) * 0.16;
    d.line(
      x + Math.cos(a) * (w / 2) * r0 * grow,
      y + Math.sin(a) * (h / 2) * r0 * grow,
      x + Math.cos(a) * (w / 2) * r1 * grow,
      y + Math.sin(a) * (h / 2) * r1 * grow,
      CONTOUR,
      seed + i,
    );
  }
  d.strength = strength;
}

/**
 * A drop's marker on a landing, `tall` px high from its foot at (x, y):
 * magic is a peg with a ringed bundle, a rare a pole with a swallowtail, a
 * unique a taller pole drawn over a second, with a slip that carries its name.
 */
export function drawMarker(
  d: Draw,
  x: number,
  y: number,
  rarity: number,
  tall: number,
  age: number,
  t: number,
  seed: number,
  name = "",
): void {
  if (age < 0) return;
  const rgb = RARITY[rarity] as number;
  const grow = rarity === 3 ? easeOut(clamp(age / 1)) : easeOut(clamp(age / 0.3));
  const h = tall * grow;
  d.fill(d.round(x + 4, y + 2, 10, 3.5, 8), INK, 0.35);
  if (rarity === 1) {
    d.line(x, y, x, y - h, CONTOUR, seed);
    const by = y - h * 0.62;
    d.body(d.round(x + 1, by, 7, 6, 8, seed), {
      wash: rgb,
      washAlpha: 1,
      weight: FORM,
      seed: seed + 1,
    });
    d.curve(d.round(x + 1, by, 9.5, 8.5, 10).slice(), FORM, seed + 2, true);
    return;
  }
  const sway = Math.sin(t * 1.6 + seed) * 2;
  d.line(x, y, x + sway * 0.3, y - h, CONTOUR, seed);
  const fy = y - h;
  const fx = x + sway * 0.3;
  const fw = rarity === 3 ? 34 : 28;
  const fh = rarity === 3 ? 20 : 16;
  const flap = Math.sin(t * 3.4 + seed) * 2;
  d.body(
    [
      fx,
      fy,
      fx + fw,
      fy + 3 + flap,
      fx + fw * 0.72,
      fy + fh * 0.55 + flap,
      fx + fw,
      fy + fh + flap,
      fx,
      fy + fh,
    ],
    {
      smooth: false,
      wash: rgb,
      washAlpha: 1,
      weight: FORM,
      seed: seed + 3,
    },
  );
  if (rarity === 3 && name && age > 0.6) {
    // The slip with its name, lettered once the pole is up.
    const a = clamp((age - 0.6) / 0.4);
    const w = measure("roman", 24, name) + 20;
    const sx = fx - w / 2 + 8;
    const sy = fy - 42;
    const strength = d.strength;
    d.strength = strength * a;
    d.body(d.box(sx, sy, sx + w, sy + 32), { smooth: false, weight: FORM, seed: seed + 4 });
    d.text(name, sx + 10, sy + 24, { size: 24, rgb: mix(rgb, INK, 0.38) });
    d.strength = strength;
  }
}

/**
 * A number where a blow landed, `size` px (30, 36 for a kill of something
 * bigger than fodder, 48 italic in red-brown for a crit, 72 for the largest
 * in frame), with a paper halo. Drawn with its middle at (x, y). Over the
 * black it is in paper colour with no halo (docs/art.md, section 10).
 */
export function drawNumber(
  d: Draw,
  x: number,
  y: number,
  value: number,
  size: number,
  crit: boolean,
  alpha: number,
  onBlack = false,
): void {
  const text = String(value);
  const face = crit ? "italic" : "roman";
  const w = measure(face, size, text);
  const left = x - w / 2;
  const base = y + size * 0.32;
  if (onBlack) {
    d.surface.text(face, size, text, left, base, 0, PAPER, alpha * d.strength);
    if (crit)
      d.surface.strip(
        [left - 2, base + 5, left - 2, base + 8.5, left + w + 4, base + 3, left + w + 4, base + 6],
        2,
        BLOW,
        alpha * d.strength,
      );
    return;
  }
  // A paper halo five pixels wide all round, so the digits' halos join and knock out what is under them.
  const reach = 5;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    d.surface.text(
      face,
      size,
      text,
      left + Math.cos(a) * reach,
      base + Math.sin(a) * reach,
      0,
      PAPER,
      alpha * 0.92,
    );
  }
  d.surface.text(face, size, text, left, base, 0, crit ? BLOW : INK, alpha * d.strength);
  if (crit)
    d.surface.strip(
      [left - 2, base + 5, left - 2, base + 8.5, left + w + 4, base + 3, left + w + 4, base + 6],
      2,
      BLOW,
      alpha * d.strength,
    );
}

/** A number's box, as drawNumber lays it. */
export function numberBox(
  x: number,
  y: number,
  value: number,
  size: number,
  crit: boolean,
): [number, number, number, number] {
  const w = measure(crit ? "italic" : "roman", size, String(value));
  return [x - w / 2 - 5, y - size * 0.62 - 2, x + w / 2 + 5, y + size * 0.42 + 2];
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
