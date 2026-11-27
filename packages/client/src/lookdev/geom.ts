// The arithmetic the look-development drawings are built from: seeded noise,
// easing, curves, triangulation, hatch lines cut to a shape, and a two-bone
// leg. Pure, so it is tested without a canvas.

/** A list of points as x0, y0, x1, y1, … */
export type Flat = ArrayLike<number>;

const at = (a: Flat, i: number): number => a[i] as number;

/** A value from 0 up to 1 that depends only on its arguments. */
export function hash(x: number, y = 0, k = 0): number {
  let h =
    (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul((k | 0) + 1, 83492791)) >>>
    0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A run of random numbers from 0 up to 1, the same for the same seed. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : Math.min(v, hi));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 0 below `a`, 1 above `b`, eased between. */
export function smooth(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
export const easeOut = (t: number): number => 1 - (1 - t) ** 3;
/** Eases out past 1 and settles back: one overshoot. */
export function easeOutBack(t: number, over = 1.70158): number {
  const u = clamp(t) - 1;
  return 1 + (over + 1) * u * u * u + over * u * u;
}
/** A swing that dies away: 1 at rest-breaking, 0 long after. */
export const ring = (age: number, freq: number, decay: number): number =>
  age < 0 ? 0 : Math.sin(age * freq) * Math.exp(-age * decay);

/** Smooth noise along a line, from -1 to 1. */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u) * 2 - 1;
}

/** Smooth noise over a plane, from 0 to 1. */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash(ix, iy, seed), hash(ix + 1, iy, seed), ux),
    lerp(hash(ix, iy + 1, seed), hash(ix + 1, iy + 1, seed), ux),
    uy,
  );
}

/** Twice the signed area: positive when the points run clockwise on screen (y down). */
export function area2(xy: Flat, n: number): number {
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    sum += at(xy, j * 2) * at(xy, i * 2 + 1) - at(xy, i * 2) * at(xy, j * 2 + 1);
  }
  return sum;
}

/**
 * Cuts a simple polygon into triangles by clipping ears. Writes point indices
 * to `out` from `offset` and returns how many it wrote (three a triangle).
 */
export function triangulate(xy: Flat, n: number, out: number[] | Uint32Array, offset = 0): number {
  if (n < 3) return 0;
  let count = 0;
  if (n === 3) {
    out[offset] = 0;
    out[offset + 1] = 1;
    out[offset + 2] = 2;
    return 3;
  }
  const sign = area2(xy, n) >= 0 ? 1 : -1;
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(i);
  let guard = n * n;
  let i = 0;
  while (ring.length > 3 && guard-- > 0) {
    const m = ring.length;
    const ia = ring[(i + m - 1) % m] as number;
    const ib = ring[i % m] as number;
    const ic = ring[(i + 1) % m] as number;
    const ax = at(xy, ia * 2);
    const ay = at(xy, ia * 2 + 1);
    const bx = at(xy, ib * 2);
    const by = at(xy, ib * 2 + 1);
    const cx = at(xy, ic * 2);
    const cy = at(xy, ic * 2 + 1);
    const cross = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) * sign;
    let ear = cross > 1e-9;
    if (ear) {
      for (let k = 0; k < m; k++) {
        const ip = ring[k] as number;
        if (ip === ia || ip === ib || ip === ic) continue;
        const px = at(xy, ip * 2);
        const py = at(xy, ip * 2 + 1);
        const d1 = ((bx - ax) * (py - ay) - (by - ay) * (px - ax)) * sign;
        const d2 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * sign;
        const d3 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * sign;
        if (d1 >= 0 && d2 >= 0 && d3 >= 0) {
          ear = false;
          break;
        }
      }
    }
    if (ear) {
      out[offset + count++] = ia;
      out[offset + count++] = ib;
      out[offset + count++] = ic;
      ring.splice(i % m, 1);
      i = Math.max(0, (i % m) - 1);
    } else i++;
  }
  // What is left is a triangle, or a ring too degenerate to clip: fan it.
  for (let k = 1; k + 1 < ring.length; k++) {
    out[offset + count++] = ring[0] as number;
    out[offset + count++] = ring[k] as number;
    out[offset + count++] = ring[k + 1] as number;
  }
  return count;
}

/** The direction hatching falls in: from upper right to lower left, at 60 degrees. */
export const HATCH_DX = -0.5;
export const HATCH_DY = 0.8660254;

/**
 * Hatch lines across a simple polygon, `spacing` apart, counted from the
 * anchor so that a shape that moves takes its hatching with it. With `cross`
 * the lines run at right angles to the usual fall. Appends x0, y0, x1, y1 for
 * each piece to `out` and returns the number of pieces.
 */
export function hatchLines(
  xy: Flat,
  n: number,
  spacing: number,
  ax: number,
  ay: number,
  cross: boolean,
  out: number[],
): number {
  const dx = cross ? HATCH_DY : HATCH_DX;
  const dy = cross ? -HATCH_DX : HATCH_DY;
  // Across the lines.
  const px = -dy;
  const py = dx;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = (at(xy, i * 2) - ax) * px + (at(xy, i * 2 + 1) - ay) * py;
    if (p < lo) lo = p;
    if (p > hi) hi = p;
  }
  let pieces = 0;
  const cuts: number[] = [];
  for (let k = Math.ceil(lo / spacing); k * spacing <= hi; k++) {
    const level = k * spacing + 0.013;
    cuts.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const pa = (at(xy, j * 2) - ax) * px + (at(xy, j * 2 + 1) - ay) * py - level;
      const pb = (at(xy, i * 2) - ax) * px + (at(xy, i * 2 + 1) - ay) * py - level;
      if (pa < 0 !== pb < 0) {
        const t = pa / (pa - pb);
        const x = lerp(at(xy, j * 2), at(xy, i * 2), t);
        const y = lerp(at(xy, j * 2 + 1), at(xy, i * 2 + 1), t);
        cuts.push((x - ax) * dx + (y - ay) * dy);
      }
    }
    cuts.sort((a, b) => a - b);
    for (let c = 0; c + 1 < cuts.length; c += 2) {
      const s0 = cuts[c] as number;
      const s1 = cuts[c + 1] as number;
      if (s1 - s0 < 1.5) continue;
      out.push(
        ax + px * level + dx * s0,
        ay + py * level + dy * s0,
        ax + px * level + dx * s1,
        ay + py * level + dy * s1,
      );
      pieces++;
    }
  }
  return pieces;
}

/**
 * A smooth curve through the points (Catmull-Rom), sampled about every `step`.
 * Appends to `out` and returns the number of points appended.
 */
export function spline(pts: Flat, n: number, step: number, closed: boolean, out: number[]): number {
  if (n < 2) return 0;
  const get = (i: number, o: number): number => {
    const k = closed ? ((i % n) + n) % n : i < 0 ? 0 : i >= n ? n - 1 : i;
    return at(pts, k * 2 + o);
  };
  let count = 0;
  const spans = closed ? n : n - 1;
  for (let s = 0; s < spans; s++) {
    const x0 = get(s - 1, 0);
    const y0 = get(s - 1, 1);
    const x1 = get(s, 0);
    const y1 = get(s, 1);
    const x2 = get(s + 1, 0);
    const y2 = get(s + 1, 1);
    const x3 = get(s + 2, 0);
    const y3 = get(s + 2, 1);
    const parts = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
    for (let k = 0; k < parts; k++) {
      const t = k / parts;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        0.5 *
          (2 * x1 +
            (x2 - x0) * t +
            (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 +
            (3 * x1 - x0 - 3 * x2 + x3) * t3),
        0.5 *
          (2 * y1 +
            (y2 - y0) * t +
            (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
            (3 * y1 - y0 - 3 * y2 + y3) * t3),
      );
      count++;
    }
  }
  if (!closed) {
    out.push(get(n - 1, 0), get(n - 1, 1));
    count++;
  }
  return count;
}

/**
 * The middle joint of a two-bone limb from (ax, ay) reaching for (tx, ty),
 * bent to the side `bend` gives (1 or -1). A target out of reach is met as
 * nearly as the bones allow.
 */
export function knee(
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  l1: number,
  l2: number,
  bend: number,
): [number, number] {
  const dx = tx - ax;
  const dy = ty - ay;
  const far = Math.hypot(dx, dy) || 1e-6;
  const d = clamp(far, Math.abs(l1 - l2) + 1e-6, l1 + l2 - 1e-6);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along)) * bend;
  // With the target on the joint itself there is no direction to it: take straight down.
  const ux = far > 1e-5 ? dx / far : 0;
  const uy = far > 1e-5 ? dy / far : 1;
  return [ax + ux * along - uy * off, ay + uy * along + ux * off];
}

/** A point on a quadratic curve. */
export const quad = (a: number, c: number, b: number, t: number): number =>
  (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;

/** Mixes two 0xRRGGBB colours. */
export function mix(a: number, b: number, t: number): number {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t);
  const g = lerp((a >> 8) & 255, (b >> 8) & 255, t);
  const bl = lerp(a & 255, b & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}
