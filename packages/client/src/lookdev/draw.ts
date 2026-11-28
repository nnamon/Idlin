// The one pen (docs/art.md, section 2). Everything in the look-development
// scenes is laid through this: pressure strokes at four weights, washes that
// sit off their outlines with a pooled edge, spot black, and hatching that
// falls one way across the plate. Widths are in frame pixels whatever the
// drawing's scale, so a thing drawn smaller keeps its line.

import { area2, clamp, type Flat, hash, len, mix, noise1, smooth, spline } from "./geom.ts";
import { type Face, measure, type Surface } from "./surface.ts";

export const INK = 0x2f2621;
export const PAPER = 0xf1e6cd;
/** The hatch that means a blow lands here. */
export const BLOW = 0x9c3b22;

export const HEAVY = 5;
export const CONTOUR = 3;
export const FORM = 1.5;
export const HAIR = 0.75;

/** How far a wash sits down and right of its outline. */
const OFFSET = 2.4;

export interface BodyOptions {
  /** Round the outline through the points. Default true. */
  smooth?: boolean;
  /** The wash colour, if any. */
  wash?: number;
  washAlpha?: number;
  /** The outline's weight; 0 for none. Default contour. */
  weight?: number;
  /** Lay paper under it first, hiding what is behind. Default true. */
  paper?: boolean;
  /** Fill with solid ink instead of a wash. */
  spot?: boolean;
  seed?: number;
}

export interface TextOptions {
  face?: Face;
  size?: number;
  rgb?: number;
  alpha?: number;
  /** 0 starts at x, 0.5 centres on it, 1 ends at it. */
  align?: number;
  rot?: number;
  /** Extra space between letters, in pixels. */
  spacing?: number;
  /** Over 0: paper pressed round the letters, this strong, so they read over drawing. */
  halo?: number;
  /** How far the halo reaches round each letter, in pixels; a twelfth of the size if not said. */
  reach?: number;
}

export class Draw {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  /** The ink in the pen. */
  ink = INK;
  /** Everything is drawn this strong: under 1 for things far off or still being inked. */
  strength = 1;
  /** The paper laid under bodies. */
  ground = PAPER;
  /** How far a wash sits down and right of its outline: less on a small drawing. */
  offset = OFFSET;
  /** The halo's reach for the lettering being set, in pixels; 0 for a twelfth of its size. */
  private haloReach = 0;
  private readonly saved: number[] = [];
  private readonly screen: number[] = [];
  private readonly dense: number[] = [];
  /** A stroke's points on screen, apart from `dense`, which holds the last outline. */
  private readonly track: number[] = [];
  /** The transform and points the outline in `dense` was made from, its count, and whether rounded. */
  private readonly was: number[] = [];
  private wasCount = -1;
  private wasPoints = 0;
  private wasRounded = false;
  private readonly rib: number[] = [];
  /** A stroke's ribbon, and how far down it each station is, grown as long strokes need them. */
  private ribs = new Float64Array(1024);
  private runs = new Float64Array(256);
  private readonly local: number[] = [];

  readonly surface: Surface;

  constructor(surface: Surface) {
    this.surface = surface;
  }

  push(): void {
    this.saved.push(this.a, this.b, this.c, this.d, this.e, this.f);
  }

  pop(): void {
    const s = this.saved;
    this.f = s.pop() as number;
    this.e = s.pop() as number;
    this.d = s.pop() as number;
    this.c = s.pop() as number;
    this.b = s.pop() as number;
    this.a = s.pop() as number;
    this.surface.anchor(this.e, this.f);
  }

  reset(): void {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    this.saved.length = 0;
    this.ink = INK;
    this.strength = 1;
    this.ground = PAPER;
    this.surface.anchor(0, 0);
  }

  move(x: number, y: number): this {
    this.e += this.a * x + this.c * y;
    this.f += this.b * x + this.d * y;
    this.surface.anchor(this.e, this.f);
    return this;
  }

  scale(sx: number, sy = sx): this {
    this.a *= sx;
    this.b *= sx;
    this.c *= sy;
    this.d *= sy;
    return this;
  }

  turn(angle: number): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const { a, b, c, d } = this;
    this.a = a * cos + c * sin;
    this.b = b * cos + d * sin;
    this.c = c * cos - a * sin;
    this.d = d * cos - b * sin;
    return this;
  }

  /** Leans everything over: x shifts by `k` times the height above the origin. */
  shear(k: number): this {
    this.c += this.a * k;
    this.d += this.b * k;
    return this;
  }

  sx(x: number, y: number): number {
    return this.a * x + this.c * y + this.e;
  }

  sy(x: number, y: number): number {
    return this.b * x + this.d * y + this.f;
  }

  /** How many frame pixels one unit of the drawing is. */
  get zoom(): number {
    return Math.sqrt(Math.abs(this.a * this.d - this.b * this.c));
  }

  // The scratch lists below are written by index and never cut short: setting an array's length
  // costs more than anything else on the stroke path. Each call passes on how many points it wrote.
  private toScreen(pts: Flat, n: number, out: number[]): void {
    const { a, b, c, d, e, f } = this;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2] as number;
      const y = pts[i * 2 + 1] as number;
      out[i * 2] = a * x + c * y + e;
      out[i * 2 + 1] = b * x + d * y + f;
    }
  }

  /**
   * Lays one stroke along dense screen points: thin on entry, swelling to its
   * weight, leaving in a flick, and wandering a little as a hand does.
   */
  private lay(
    p: number[],
    n: number,
    weight: number,
    seed: number,
    rgb: number,
    alpha: number,
    even = false,
  ): void {
    if (n < 2) return;
    // How far down the stroke each station is.
    if (this.runs.length < n) this.runs = new Float64Array(n * 2);
    const runs = this.runs;
    let length = 0;
    runs[0] = 0;
    for (let i = 1; i < n; i++) {
      length += len(
        (p[i * 2] as number) - (p[i * 2 - 2] as number),
        (p[i * 2 + 1] as number) - (p[i * 2 - 1] as number),
      );
      runs[i] = length;
    }
    if (length < 0.5) return;
    // Under a pixel a line breaks into dots: keep it a pixel wide and fainter.
    let w = weight;
    let strength = alpha * this.strength;
    if (w < 1.15) {
      strength *= w / 1.15;
      w = 1.15;
    }
    if (this.ribs.length < n * 4) this.ribs = new Float64Array(n * 8);
    const rib = this.ribs;
    const enter = Math.min(0.2, 16 / length);
    const leave = Math.min(0.3, 22 / length);
    const wander = Math.min(0.6 * weight, 1.6);
    const swell = weight * 4 + 9;
    const drift = weight * 6 + 14;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2] as number;
      const y = p[i * 2 + 1] as number;
      const ia = i > 0 ? i - 1 : 0;
      const ib = i < n - 1 ? i + 1 : n - 1;
      let tx = (p[ib * 2] as number) - (p[ia * 2] as number);
      let ty = (p[ib * 2 + 1] as number) - (p[ia * 2 + 1] as number);
      const tl = len(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const run = runs[i] as number;
      const u = run / length;
      const press = even
        ? 1
        : (0.4 + 0.6 * smooth(0, enter, u)) * (0.16 + 0.84 * smooth(1, 1 - leave, u));
      const half = (w * press * (1 + 0.16 * noise1(run / swell, seed + 7))) / 2;
      const off = wander * noise1(run / drift, seed);
      const cx = x - ty * off;
      const cy = y + tx * off;
      rib[i * 4] = cx - ty * half;
      rib[i * 4 + 1] = cy + tx * half;
      rib[i * 4 + 2] = cx + ty * half;
      rib[i * 4 + 3] = cy - tx * half;
    }
    this.surface.strip(rib, n, rgb, strength);
  }

  /** Resamples a screen polyline so a stroke along it has room to wander. */
  private densify(p: number[], n: number, step: number, out: number[]): number {
    let o = 0;
    for (let i = 0; i + 1 < n; i++) {
      const x0 = p[i * 2] as number;
      const y0 = p[i * 2 + 1] as number;
      const x1 = p[i * 2 + 2] as number;
      const y1 = p[i * 2 + 3] as number;
      const parts = Math.max(1, Math.ceil(len(x1 - x0, y1 - y0) / step));
      for (let k = 0; k < parts; k++) {
        out[o++] = x0 + ((x1 - x0) * k) / parts;
        out[o++] = y0 + ((y1 - y0) * k) / parts;
      }
    }
    out[o++] = p[n * 2 - 2] as number;
    out[o++] = p[n * 2 - 1] as number;
    return o / 2;
  }

  /** A straight stroke. */
  line(x0: number, y0: number, x1: number, y1: number, weight = FORM, seed = 0, alpha = 1): void {
    const p = this.screen;
    p[0] = this.sx(x0, y0);
    p[1] = this.sy(x0, y0);
    p[2] = this.sx(x1, y1);
    p[3] = this.sy(x1, y1);
    const n = this.densify(p, 2, clamp(weight * 3, 5, 12), this.track);
    this.lay(this.track, n, weight, seed || hash(x0 * 7 + x1, y0 * 5 + y1) * 9999, this.ink, alpha);
  }

  /** A stroke through the points with its corners kept, each side a stroke of its own. */
  path(pts: Flat, weight = FORM, seed = 0, closed = false, alpha = 1): void {
    const n = pts.length / 2;
    const sides = closed ? n : n - 1;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % n;
      this.line(
        pts[i * 2] as number,
        pts[i * 2 + 1] as number,
        pts[j * 2] as number,
        pts[j * 2 + 1] as number,
        weight,
        seed + i * 13 + 1,
        alpha,
      );
    }
  }

  /** A stroke along a smooth curve through the points. A closed one overruns its start a little. */
  curve(pts: Flat, weight = FORM, seed = 1, closed = false, alpha = 1): void {
    const n = pts.length / 2;
    this.toScreen(pts, n, this.screen);
    const step = clamp(weight * 3, 4, 11);
    const p = this.track;
    let count = spline(this.screen, n, step, closed, p, 0);
    if (closed && count > 3) {
      p[count * 2] = p[0] as number;
      p[count * 2 + 1] = p[1] as number;
      p[count * 2 + 2] = p[2] as number;
      p[count * 2 + 3] = p[3] as number;
      count += 2;
    }
    this.lay(p, count, weight, seed, this.ink, alpha);
  }

  /** A stroke of even width with no flick: a ruled line. */
  rule(x0: number, y0: number, x1: number, y1: number, weight: number, seed = 3, alpha = 1): void {
    const p = this.screen;
    p[0] = this.sx(x0, y0);
    p[1] = this.sy(x0, y0);
    p[2] = this.sx(x1, y1);
    p[3] = this.sy(x1, y1);
    const n = this.densify(p, 2, 14, this.track);
    this.lay(this.track, n, weight, seed, this.ink, alpha, true);
  }

  /**
   * The outline's points on screen, rounded or not, left in `this.dense`. The same points under
   * the same transform give the same outline, so a body's fill, wash and hatch round it once.
   */
  private outline(pts: Flat, rounded: boolean): number {
    const n = pts.length / 2;
    const was = this.was;
    let same =
      this.wasCount >= 0 &&
      this.wasRounded === rounded &&
      this.wasPoints === n &&
      was[0] === this.a &&
      was[1] === this.b &&
      was[2] === this.c &&
      was[3] === this.d &&
      was[4] === this.e &&
      was[5] === this.f;
    for (let i = 0; same && i < n * 2; i++) same = was[i + 6] === pts[i];
    if (same) return this.wasCount;
    this.wasPoints = n;
    was[0] = this.a;
    was[1] = this.b;
    was[2] = this.c;
    was[3] = this.d;
    was[4] = this.e;
    was[5] = this.f;
    for (let i = 0; i < n * 2; i++) was[i + 6] = pts[i] as number;
    this.wasRounded = rounded;
    if (!rounded) {
      this.toScreen(pts, n, this.dense);
      this.wasCount = n;
    } else {
      this.toScreen(pts, n, this.screen);
      this.wasCount = spline(this.screen, n, 7, true, this.dense, 0);
    }
    return this.wasCount;
  }

  /** A flat fill, exactly on its points. */
  fill(pts: Flat, rgb: number, alpha = 1, rounded = false): void {
    const n = this.outline(pts, rounded);
    this.surface.poly(this.dense, n, rgb, alpha * this.strength);
  }

  /**
   * A wash: a flat tint set down and right of its outline, darker along its
   * lower right edge where the water pooled.
   */
  wash(pts: Flat, rgb: number, alpha = 0.78, rounded = false): void {
    const n = this.outline(pts, rounded);
    this.washScreen(this.dense, n, rgb, alpha);
  }

  private washScreen(p: number[], n: number, rgb: number, alpha: number): void {
    // The outline is moved off its place here, so it is not the last outline any more.
    if (p === this.dense) this.wasCount = -1;
    const off = this.offset;
    for (let i = 0; i < n * 2; i++) p[i] = (p[i] as number) + off;
    const strength = alpha * this.strength;
    this.surface.poly(p, n, rgb, strength, true);
    // The pooled edge, along the sides that face down and right.
    const sign = area2(p, n) >= 0 ? 1 : -1;
    const rib = this.rib;
    let stations = 0;
    const pool = mix(rgb, INK, 0.3);
    const flush = (): void => {
      if (stations >= 2) this.surface.strip(rib, stations, pool, strength * 0.5, true);
      stations = 0;
    };
    const depth = Math.min(2.6, 1 + this.zoom * 14);
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      const h = (i + n - 1) % n;
      const j = (i + 1) % n;
      let nx = ((p[j * 2 + 1] as number) - (p[h * 2 + 1] as number)) * sign;
      let ny = -((p[j * 2] as number) - (p[h * 2] as number)) * sign;
      const nl = len(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      const facing = (nx + ny) * Math.SQRT1_2;
      if (facing > 0.15) {
        const deep = depth * smooth(0.15, 0.6, facing);
        const x = p[i * 2] as number;
        const y = p[i * 2 + 1] as number;
        rib[stations * 4] = x;
        rib[stations * 4 + 1] = y;
        rib[stations * 4 + 2] = x - nx * deep;
        rib[stations * 4 + 3] = y - ny * deep;
        stations++;
      } else flush();
    }
    flush();
  }

  /**
   * Hatching over a shape: tone 1 open (6 px), 2 close (3 px), 3 crossed.
   * Strokes fall from upper right to lower left.
   */
  hatch(
    pts: Flat,
    tone: 1 | 2 | 3,
    rgb = this.ink,
    alpha = 0.8,
    rounded = false,
    weight = HAIR,
  ): void {
    const n = this.outline(pts, rounded);
    const spacing = tone === 1 ? 6 : 3;
    // Under a pixel a line breaks into dots: keep it a pixel wide and fainter.
    let w = weight;
    let strength = alpha * this.strength;
    if (w < 1.15) {
      strength *= w / 1.15;
      w = 1.15;
    }
    this.surface.hatch(this.dense, n, rgb, strength, spacing, w, false);
    if (tone === 3) this.surface.hatch(this.dense, n, rgb, strength, spacing, w, true);
  }

  /**
   * A whole body in one call: paper under it, a wash or spot black, and its
   * outline. Most things on the plate are one or more of these.
   */
  body(pts: Flat, options: BodyOptions = {}): void {
    const rounded = options.smooth ?? true;
    const seed =
      options.seed ?? Math.floor(hash(pts[0] as number, pts[1] as number, pts.length) * 9999);
    if (options.spot) this.fill(pts, this.ink, 1, rounded);
    else {
      if (options.paper ?? true) this.fill(pts, this.ground, 1, rounded);
      if (options.wash !== undefined)
        this.wash(pts, options.wash, options.washAlpha ?? 0.78, rounded);
    }
    const weight = options.weight ?? CONTOUR;
    if (weight > 0) {
      if (rounded) this.curve(pts, weight, seed, true);
      else this.path(pts, weight, seed, true);
    }
  }

  /** Points round a circle, squashed if `ry` is given, for a body or a wash. */
  round(x: number, y: number, rx: number, ry = rx, points = 10, seed = 0): number[] {
    const out = this.local;
    out.length = 0;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const wobble = seed ? 1 + (hash(i, seed) - 0.5) * 0.16 : 1;
      out.push(x + Math.cos(angle) * rx * wobble, y + Math.sin(angle) * ry * wobble);
    }
    return out;
  }

  /** A solid dot of ink (or of another colour), `r` frame pixels across whatever the scale. */
  dot(x: number, y: number, r: number, rgb = this.ink, alpha = 1): void {
    const cx = this.sx(x, y);
    const cy = this.sy(x, y);
    const p = this.track;
    const points = r < 2.5 ? 6 : r < 7 ? 9 : 14;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      p[i * 2] = cx + Math.cos(angle) * r;
      p[i * 2 + 1] = cy + Math.sin(angle) * r;
    }
    this.surface.poly(p, points, rgb, alpha * this.strength);
  }

  /** A box by two corners, as points for a body, a wash or a hatch. */
  box(x0: number, y0: number, x1: number, y1: number): number[] {
    return [x0, y0, x1, y0, x1, y1, x0, y1];
  }

  text(s: string, x: number, y: number, options: TextOptions = {}): number {
    const face = options.face ?? "roman";
    const size = options.size ?? 24;
    const rgb = options.rgb ?? this.ink;
    const alpha = (options.alpha ?? 1) * this.strength;
    const rot = options.rot ?? 0;
    const spacing = options.spacing ?? 0;
    const px = this.sx(x, y);
    const py = this.sy(x, y);
    this.haloReach = options.reach ?? 0;
    if (spacing === 0) {
      const width = measure(face, size, s);
      const start = (options.align ?? 0) * width;
      this.letter(
        face,
        size,
        s,
        px - Math.cos(rot) * start,
        py - Math.sin(rot) * start,
        rot,
        rgb,
        alpha,
        options.halo ?? 0,
      );
      return width;
    }
    let width = 0;
    for (const ch of s) width += measure(face, size, ch) + spacing;
    width -= spacing;
    let run = -(options.align ?? 0) * width;
    for (const ch of s) {
      this.letter(
        face,
        size,
        ch,
        px + Math.cos(rot) * run,
        py + Math.sin(rot) * run,
        rot,
        rgb,
        alpha,
        options.halo ?? 0,
      );
      run += measure(face, size, ch) + spacing;
    }
    return width;
  }

  /** One run of lettering, with paper pressed round it where it lies over drawing. */
  private letter(
    face: Face,
    size: number,
    s: string,
    x: number,
    y: number,
    rot: number,
    rgb: number,
    alpha: number,
    halo: number,
  ): void {
    if (halo > 0) {
      const reach = this.haloReach || Math.max(2, size / 12);
      const around = reach > 3.5 ? 12 : 8;
      for (let k = 0; k < around; k++) {
        const a = (k / around) * Math.PI * 2;
        this.surface.text(
          face,
          size,
          s,
          x + Math.cos(a) * reach,
          y + Math.sin(a) * reach,
          rot,
          this.ground,
          Math.min(1, alpha * halo),
        );
      }
    }
    this.surface.text(face, size, s, x, y, rot, rgb, alpha);
  }
}

/** A colour a step darker, for the shade side of a wash. */
export const shade = (rgb: number, by = 0.25): number => mix(rgb, INK, by);
