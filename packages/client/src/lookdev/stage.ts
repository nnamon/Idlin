// What every scene of the look target shares (docs/art.md, sections 3, 4 and
// 11): the rule round the picture, the four corner slips, the black at the
// rim of a landing, shadows, and the name tags with their hold rule.

import { BLOW, CONTOUR, type Draw, FORM, HAIR, INK, PAPER } from "./draw.ts";
import { clamp, hash, lerp, mix, noise1 } from "./geom.ts";
import { HEIGHT, measure, WIDTH } from "./surface.ts";

/** The rule round the picture, 20 px in from the frame's edge. */
export const FRAME = { x0: 20, y0: 20, x1: WIDTH - 20, y1: HEIGHT - 20 } as const;

export const SHADOW = 0x4a4038;
export const BRUISE = 0x5a2a3a;
export const OXIDE = 0xa8644a;
/** How much taller a thing stands than its plan scale, and how flat a shape on the ground is drawn. */
export const UP = 1.4;
export const BACK = 0.8;

// ---------------------------------------------------------------- the rule

export function drawFrameRule(d: Draw): void {
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

// ---------------------------------------------------------------- shadows

/** A cast shadow to the lower right, in frame pixels, for something `h` px tall and `w` px wide. */
export function castShadow(
  d: Draw,
  x: number,
  y: number,
  h: number,
  w: number,
  alpha = 0.24,
): void {
  const pts: number[] = [];
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const along = Math.cos(a) * (w * 0.36 + h * 0.13);
    const across = Math.sin(a) * (w * 0.2 + 2);
    const cx = x + w * 0.1 + h * 0.12;
    const cy = y + 2 + h * 0.05;
    pts.push(cx + along * 0.92 - across * 0.35, cy + along * 0.3 + across * BACK);
  }
  d.wash(pts, SHADOW, alpha, true);
}

// ---------------------------------------------------------------- corners

/** A slip of paper with clipped corners and a frame at form weight. */
export function slip(d: Draw, x: number, y: number, w: number, h: number, seed: number): void {
  const n = 10;
  d.body(
    [
      x + n,
      y,
      x + w - n,
      y,
      x + w,
      y + n,
      x + w,
      y + h - n,
      x + w - n,
      y + h,
      x + n,
      y + h,
      x,
      y + h - n,
      x,
      y + n,
    ],
    { smooth: false, weight: FORM, seed },
  );
}

export interface Corners {
  /** Seconds left on the clock, and what it counts to. */
  left: number;
  to: "landing" | "march" | "lift-off";
  /**
   * From the march to the break the clock is not drawn and the slip holds the
   * shield (docs/art.md, section 11): each post's lamp, lit or dark, in order
   * round the foot from the far side clockwise, and the lamps lost a minute.
   */
  shield?: { lit: readonly boolean[]; loss: number };
  /** The part of the cycle gone, 0 to 1; the dial's wedge. */
  gone: number;
  /** Where the horn is on the dial, 0 to 1: the stretch after it is hatched. */
  horn: number;
  /** The last two minutes: the wedge and the number in red-brown. */
  late: boolean;
  /** The landing's size and level range, then its modifiers, one a line. */
  head: string;
  lines: readonly string[];
  /** The log's one line: a username ruled in its cloak colour, then an item in its colour or a label. */
  log: { who: string; rgb: number; what: string; whatRgb: number } | null;
  /** Out, aboard, kills, banked. */
  counts: readonly [number, number, number, number];
  alpha?: number;
}

/** The four corner slips. Returns the rectangles they cover (x0, y0, x1, y1, …). */
export function drawCorners(d: Draw, c: Corners): number[] {
  const taken: number[] = [];
  const strength = d.strength;
  d.strength = strength * (c.alpha ?? 1);
  const inset = 18;
  if (c.shield) {
    // The shield in the clock's place: a ring of one dot a post, lamps lit of posts at 48 px,
    // the lamps lost a minute at 36 px in red-brown beside them, and `shield` under at 24.
    const { w, h, count, loss } = shieldSlip(c.shield);
    const x = FRAME.x0 + inset;
    const y = FRAME.y0 + inset;
    slip(d, x, y, w, h, 31);
    const cx = x + 50;
    const cy = y + h / 2;
    const r = 30;
    const n = c.shield.lit.length;
    c.shield.lit.forEach((on, k) => {
      const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (on) {
        d.dot(px, py, 4.6, INK);
        d.dot(px, py, 3.2, LAMP_ACCENT);
      } else d.dot(px, py, 3.2, INK);
    });
    d.text(count, x + 96, y + 58, { size: 48 });
    const cw = measure("roman", 48, count);
    d.text(loss, x + 96 + cw + 16, y + 58, { size: 36, rgb: BLOW });
    d.text("shield", x + 98, y + 90, { size: 24 });
    taken.push(x, y, x + w, y + h);
  } else {
    // The clock: a dial 60 px across, the time left at 48 px, what it counts to under it at 24.
    const time = clockText(c.left);
    const w = 96 + Math.max(measure("roman", 48, time), measure("roman", 24, c.to)) + 26;
    const h = 108;
    const x = FRAME.x0 + inset;
    const y = FRAME.y0 + inset;
    slip(d, x, y, w, h, 31);
    const cx = x + 50;
    const cy = y + h / 2;
    const r = 30;
    const tint = c.late ? BLOW : 0xc9a36b;
    const wedge = [cx, cy];
    for (let i = 0; i <= 40; i++) {
      const a = -Math.PI / 2 + (i / 40) * c.gone * Math.PI * 2;
      wedge.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    if (c.gone > 0.005) d.wash(wedge, tint, 0.8);
    const end = [cx, cy];
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (c.horn + (i / 12) * (1 - c.horn)) * Math.PI * 2;
      end.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    if (c.horn < 0.999) d.hatch(end, 2, INK, 0.8);
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
    d.text(time, x + 96, y + 58, { size: 48, rgb: c.late ? mix(BLOW, INK, 0.1) : INK });
    d.text(c.to, x + 98, y + 90, { size: 24 });
    taken.push(x, y, x + w, y + h);
  }
  // The landing: its size and level range at 30, its modifiers at 24, one a line.
  {
    const w =
      Math.max(measure("roman", 30, c.head), ...c.lines.map((l) => measure("roman", 24, l))) + 44;
    const h = 30 + 34 + c.lines.length * 30;
    const x = FRAME.x1 - inset - w;
    const y = FRAME.y0 + inset;
    slip(d, x, y, w, h, 51);
    d.text(c.head, x + 22, y + 42, { size: 30 });
    for (const [i, l] of c.lines.entries()) d.text(l, x + 22, y + 76 + i * 30, { size: 24 });
    taken.push(x, y, x + w, y + h);
  }
  // The log: one line at 30.
  if (c.log) {
    const { who, what } = c.log;
    const ww = measure("roman", 30, who);
    const w = ww + 40 + measure("roman", 30, what) + 44;
    const h = 60;
    const x = FRAME.x0 + inset;
    const y = FRAME.y1 - inset - h;
    slip(d, x, y, w, h, 61);
    d.text(who, x + 22, y + 39, { size: 30 });
    d.fill(d.box(x + 22, y + 45, x + 22 + ww, y + 47.5), c.log.rgb);
    d.text(what, x + 22 + ww + 40, y + 39, { size: 30, rgb: c.log.whatRgb });
    taken.push(x, y, x + w, y + h);
  }
  // Counts: an icon and a number each.
  {
    const counts = c.counts.map(String);
    const h = 60;
    const cell = (s: string): number => 42 + measure("roman", 30, s) + 24;
    const w = counts.reduce((sum, s) => sum + cell(s), 0) + 16;
    const x0 = FRAME.x1 - inset - w;
    const y = FRAME.y1 - inset - h;
    slip(d, x0, y, w, h, 71);
    let x = x0 + 16;
    counts.forEach((s, k) => {
      const ix = x + 15;
      const iy = y + h / 2;
      if (k === 0) {
        // Out: a cloaked figure.
        d.body([ix - 9, iy + 13, ix - 6, iy - 2, ix + 6, iy - 2, ix + 9, iy + 13], {
          smooth: false,
          wash: 0x7a9cc0,
          weight: FORM,
          seed: 72,
        });
        d.body(d.round(ix, iy - 8, 6, 6, 8), { weight: FORM, seed: 73 });
        d.body([ix - 6, iy - 12, ix, iy - 24, ix + 6, iy - 12], {
          smooth: false,
          weight: FORM,
          wash: 0x7a9cc0,
          seed: 74,
        });
      } else if (k === 1) {
        // Aboard: the hull on its legs.
        d.body([ix - 15, iy - 4, ix + 15, iy - 4, ix + 10, iy + 4, ix - 11, iy + 4], {
          smooth: false,
          wash: 0x5b5048,
          washAlpha: 0.8,
          weight: FORM,
          seed: 75,
        });
        d.body(d.box(ix - 8, iy - 13, ix + 2, iy - 4), {
          smooth: false,
          wash: OXIDE,
          washAlpha: 0.8,
          weight: FORM,
          seed: 76,
        });
        for (const lx of [-10, -3, 4, 11])
          d.line(ix + lx, iy + 3, ix + lx * 1.35, iy + 14, FORM, 77 + lx);
      } else if (k === 2) {
        // Kills: a splash of ink.
        d.fill(d.round(ix, iy + 1, 9, 7, 10, 78), INK, 1, true);
        d.dot(ix + 12, iy - 6, 2.4);
        d.dot(ix - 12, iy + 7, 2);
        d.dot(ix + 9, iy + 10, 1.6);
      } else {
        // Banked: a tied sack.
        d.body(
          [
            ix - 10,
            iy + 12,
            ix - 11,
            iy,
            ix - 4,
            iy - 7,
            ix + 4,
            iy - 7,
            ix + 11,
            iy,
            ix + 10,
            iy + 12,
          ],
          { wash: 0xc9a36b, washAlpha: 0.85, weight: FORM, seed: 79 },
        );
        d.line(ix - 5, iy - 7, ix + 5, iy - 7, CONTOUR, 80);
        d.line(ix - 2, iy - 7, ix - 5, iy - 13, FORM, 81);
        d.line(ix + 2, iy - 7, ix + 5, iy - 13, FORM, 82);
      }
      d.text(s, x + 40, y + 40, { size: 30 });
      x += cell(s);
    });
    taken.push(x0, y, x0 + w, y + h);
  }
  d.strength = strength;
  return taken;
}

/** Seconds as m:ss. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The lamp accent, for the shield's lit dots in the corner. */
const LAMP_ACCENT = 0xf6cf6a;

/** Lamps lost a minute as the corner sets it: a negative number to one place, or 0.0. */
export function lossText(loss: number): string {
  const v = Math.round(Math.max(0, loss) * 10) / 10;
  return v === 0 ? "0.0" : `−${v.toFixed(1)}`;
}

/** The shield's slip: its size and the two numbers it sets. */
function shieldSlip(s: { lit: readonly boolean[]; loss: number }): {
  w: number;
  h: number;
  count: string;
  loss: string;
} {
  const count = `${s.lit.filter(Boolean).length}/${s.lit.length}`;
  const loss = lossText(s.loss);
  const w = 96 + measure("roman", 48, count) + 16 + measure("roman", 36, loss) + 26;
  return { w, h: 108, count, loss };
}

/** The corners' rectangles without drawing them, for laying tags out ahead of a frame. */
export function cornerBoxes(c: Corners): number[] {
  const time = clockText(c.left);
  const out: number[] = [];
  const inset = 18;
  const w0 = c.shield
    ? shieldSlip(c.shield).w
    : 96 + Math.max(measure("roman", 48, time), measure("roman", 24, c.to)) + 26;
  out.push(FRAME.x0 + inset, FRAME.y0 + inset, FRAME.x0 + inset + w0, FRAME.y0 + inset + 108);
  const w1 =
    Math.max(measure("roman", 30, c.head), ...c.lines.map((l) => measure("roman", 24, l))) + 44;
  const h1 = 30 + 34 + c.lines.length * 30;
  out.push(FRAME.x1 - inset - w1, FRAME.y0 + inset, FRAME.x1 - inset, FRAME.y0 + inset + h1);
  // The log's slip is laid out for the longest line it shows, so tags stay off it whatever it says.
  out.push(FRAME.x0 + inset, FRAME.y1 - inset - 60, FRAME.x0 + inset + 700, FRAME.y1 - inset);
  out.push(FRAME.x1 - inset - 420, FRAME.y1 - inset - 60, FRAME.x1 - inset, FRAME.y1 - inset);
  return out;
}

// ---------------------------------------------------------------- the black

export interface Station {
  ix: number;
  iy: number;
  ox: number;
  oy: number;
  nx: number;
  ny: number;
  /** 0 to 1: how far in the black has come here. */
  env: number;
}

/** A band of black along one edge of a box, in frame pixels. */
export function band(
  box: { x0: number; y0: number; x1: number; y1: number },
  edge: "n" | "s" | "e" | "w",
  depth: number,
  seed: number,
): Station[] {
  const out: Station[] = [];
  const horizontal = edge === "n" || edge === "s";
  const from = (horizontal ? box.x0 : box.y0) - 30;
  const to = (horizontal ? box.x1 : box.y1) + 30;
  const steps = Math.max(2, Math.round((to - from) / 12));
  for (let s = 0; s <= steps; s++) {
    const along = lerp(from, to, s / steps);
    const dd =
      depth * (0.82 + 0.18 * noise1(along / 190, seed)) +
      14 * noise1(along / 46, seed + 1) +
      6 * noise1(along / 14, seed + 2);
    const dep = Math.max(8, dd);
    let x = 0;
    let y = 0;
    let nx = 0;
    let ny = 0;
    if (edge === "e") [x, y, nx, ny] = [box.x1, along, -1, 0];
    else if (edge === "w") [x, y, nx, ny] = [box.x0, along, 1, 0];
    else if (edge === "n") [x, y, nx, ny] = [along, box.y0, 0, 1];
    else [x, y, nx, ny] = [along, box.y1, 0, -1];
    out.push({
      ix: x + nx * dep,
      iy: y + ny * dep,
      ox: x - nx * 40,
      oy: y - ny * 40,
      nx,
      ny,
      env: 1,
    });
  }
  return out;
}

/**
 * The edge of the black as one closed curve round (cx, cy), radii rx and ry in
 * frame pixels. The last point repeats the first.
 */
export function ringEdge(cx: number, cy: number, rx: number, ry: number, seed: number): number[] {
  const out: number[] = [];
  const n = 260;
  for (let s = 0; s <= n; s++) {
    const a = ((s % n) / n) * Math.PI * 2;
    const r =
      1 +
      0.13 * noise1(a * 2.2, seed) +
      0.05 * noise1(a * 9, seed + 1) +
      0.022 * noise1(a * 30, seed + 2);
    out.push(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r);
  }
  return out;
}

/** Stations along a closed edge, with the black outside it. */
export function ringStations(edge: number[], cx: number, cy: number): Station[] {
  const out: Station[] = [];
  for (let i = 0; i < edge.length; i += 2) {
    const ix = edge[i] as number;
    const iy = edge[i + 1] as number;
    const dx = ix - cx;
    const dy = iy - cy;
    const nl = Math.hypot(dx, dy) || 1;
    out.push({
      ix,
      iy,
      ox: cx + (dx / nl) * 2600,
      oy: cy + (dy / nl) * 2600,
      nx: -dx / nl,
      ny: -dy / nl,
      env: 1,
    });
  }
  return out;
}

/** Whether (x, y) is inside a closed polygon of flat points. */
export function inside(poly: readonly number[], x: number, y: number): boolean {
  let hit = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2] as number;
    const yi = poly[i * 2 + 1] as number;
    const xj = poly[j * 2] as number;
    const yj = poly[j * 2 + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * Black on the ground: the bruise ahead in two flat steps, the red-brown hatch
 * of a blow about to land, the mass with heads and backs along its front,
 * bodies crowded on the edge, and eyes and teeth in clusters behind it.
 * Returns how many bodies it stood along the edge.
 */
export function drawBlack(d: Draw, st: Station[], t: number, seed: number, alpha = 1): number {
  const n = st.length;
  if (n < 2) return 0;
  const strength = d.strength;
  d.strength = strength * alpha;
  const strip: number[] = [];
  for (const [ahead, a] of [
    [150, 0.09],
    [64, 0.12],
  ] as const) {
    strip.length = 0;
    for (let i = 0; i < n; i++) {
      const s = st[i] as Station;
      const reach = ahead * s.env * (0.75 + 0.25 * noise1(i / 9, seed + 3));
      strip.push(s.ix + s.nx * reach, s.iy + s.ny * reach, s.ox, s.oy);
    }
    d.surface.strip(strip, n, BRUISE, a * d.strength, true);
  }
  for (let i = 0; i + 1 < n; i += 8) {
    const j = Math.min(n - 1, i + 8);
    const poly: number[] = [];
    for (let k = i; k <= j; k++) {
      const s = st[k] as Station;
      poly.push(s.ix, s.iy);
    }
    for (let k = j; k >= i; k--) {
      const s = st[k] as Station;
      const reach = (34 + 12 * noise1(k / 6, seed + 4)) * s.env;
      poly.push(s.ix + s.nx * reach, s.iy + s.ny * reach);
    }
    d.hatch(poly, 2, BLOW, 0.9, false, 2.2);
  }
  strip.length = 0;
  for (let i = 0; i < n; i++) {
    const s = st[i] as Station;
    const bump =
      Math.abs(Math.sin(i * 0.9 + noise1(i / 7, seed + 5) * 3)) * 9 + hash(i, seed + 6) * 5;
    strip.push(s.ix + s.nx * bump, s.iy + s.ny * bump, s.ox, s.oy);
  }
  d.surface.strip(strip, n, INK, d.strength);
  // Bodies on the edge: a hunched back, a head and a reaching limb, each different, every few stations.
  let bodies = 0;
  for (let i = 1; i < n - 1; i += 2) {
    const s = st[i] as Station;
    if (
      s.ix < FRAME.x0 - 10 ||
      s.ix > FRAME.x1 + 10 ||
      s.iy < FRAME.y0 - 10 ||
      s.iy > FRAME.y1 + 10
    )
      continue;
    if (hash(i, seed + 21) < 0.35) continue;
    const tx = -s.ny;
    const ty = s.nx;
    const size = 9 + hash(i, seed + 22) * 9;
    const lean = (hash(i, seed + 8) - 0.5) * 1.2;
    const bx = s.ix + s.nx * 4;
    const by = s.iy + s.ny * 4;
    // A back humped out of the mass.
    d.fill(
      [
        bx - tx * size,
        by - ty * size,
        bx + s.nx * size * 0.9 - tx * size * 0.4,
        by + s.ny * size * 0.9 - ty * size * 0.4,
        bx + s.nx * size * 1.1 + tx * size * (0.3 + lean * 0.3),
        by + s.ny * size * 1.1 + ty * size * (0.3 + lean * 0.3),
        bx + tx * size,
        by + ty * size,
      ],
      INK,
      1,
      true,
    );
    const hx = bx + s.nx * size * 1.1 + tx * size * (0.6 + lean * 0.4);
    const hy = by + s.ny * size * 1.1 + ty * size * (0.6 + lean * 0.4);
    d.dot(hx, hy, size * 0.42);
    d.dot(hx + s.nx * 1.5, hy + s.ny * 1.5, 1.6, PAPER);
    if (hash(i, seed + 23) < 0.5) {
      const reach = size * (1.4 + hash(i, seed + 24));
      d.line(
        bx + tx * size * 0.4,
        by + ty * size * 0.4,
        bx + s.nx * reach + tx * size * lean,
        by + s.ny * reach + ty * size * lean,
        CONTOUR,
        i + 600,
      );
    }
    bodies++;
  }
  // Eyes and teeth inside the front, thick near the edge and in clusters.
  for (let i = 2; i < n; i += 3) {
    const s = st[i] as Station;
    if (noise1(i / 5, seed + 12) < 0.45) continue;
    const room = Math.hypot(s.ix - s.ox, s.iy - s.oy) - 40;
    if (room < 18) continue;
    const cluster = 1 + Math.floor(hash(i, seed + 13) * 3);
    for (let c = 0; c < cluster; c++) {
      const back = 10 + hash(i, seed + 10 + c * 7) ** 2 * Math.min(140, room * 0.8);
      const side = (hash(i, seed + 14 + c) - 0.5) * 16;
      const ex = s.ix - s.nx * back - s.ny * side;
      const ey = s.iy - s.ny * back + s.nx * side;
      if (ex < FRAME.x0 || ex > FRAME.x1 || ey < FRAME.y0 || ey > FRAME.y1) continue;
      const blink = Math.sin(t * 0.9 + i * 2.7 + c) > 0.94;
      const r = 1.8 + hash(i, seed + 11 + c) * 1.6;
      if (!blink) {
        d.dot(ex, ey, r, PAPER);
        d.dot(ex - s.ny * r * 2.8, ey + s.nx * r * 2.8, r * 0.9, PAPER);
      }
      if ((i + c) % 11 === 2)
        for (let tooth = 0; tooth < 4; tooth++) {
          const tx = ex - 4 + tooth * 5;
          d.fill([tx, ey + 7, tx + 4, ey + 7, tx + 2, ey + 13], PAPER);
        }
    }
  }
  d.strength = strength;
  return bodies;
}

// ---------------------------------------------------------------- tags

/** A tag's usual size: 30 px, 36 on a landing while 20 or fewer are out, 48 for a called tag. */
export const TAG_SIZE = 30;
export const TAG_BIG = 36;
export const TAG_CALLED = 48;
/** The paper halo round lettering on the map, in pixels. */
export const HALO = 5;

/**
 * Where a tag may go, as offsets from its spot over the hat for a 24 px tag:
 * over it first, then rings further out. They are scaled by the tag's size.
 */
export const SPOTS: (readonly [number, number])[] = [[0, 0]];
for (const r of [26, 52, 78, 104, 130, 150, 172, 196])
  for (const ox of [0, 44, -44, 88, -88, 22, -22, 66, -66, 110, -110, 132, -132, 154, -154])
    if (Math.hypot(ox, r) <= 200) SPOTS.push([ox, -r]);
// Beside and below the owner too, for a crowd with no room overhead.
for (const oy of [-10, 14, 40]) for (const ox of [150, -150, 120, -120]) SPOTS.push([ox, oy]);
for (const [ox, oy] of [
  [96, 8],
  [-96, 8],
  [128, 30],
  [-128, 30],
  [0, 64],
  [70, 54],
  [-70, 54],
  [0, 96],
  [96, 96],
  [-96, 96],
  [0, 128],
  [170, 60],
  [-170, 60],
] as const)
  SPOTS.push([ox, oy]);

export interface TagWant {
  /** Who it belongs to; a tag keeps its spot by this. */
  key: number;
  /** The top of its owner's hat, in frame pixels. */
  x: number;
  y: number;
  name: string;
  rgb: number;
  /** Its size in pixels; TAG_SIZE if not said. */
  size?: number;
  /** Called by its chatter: drawn with a ring round its owner's feet. */
  called?: boolean;
  /** The owner's feet and height, for the ring. */
  feet?: [number, number, number];
}

export interface PlacedTag {
  key: number;
  name: string;
  rgb: number;
  /** The owner's hat. */
  x: number;
  y: number;
  /** Where the tag is drawn: the middle of its baseline. */
  cx: number;
  base: number;
  w: number;
  alpha: number;
  size: number;
  called: boolean;
  feet: [number, number, number] | null;
}

/** A tag's box, from the middle of its baseline, the halo included. */
export const tagBox = (
  cx: number,
  base: number,
  w: number,
  size = TAG_SIZE,
): [number, number, number, number] => [
  cx - w / 2 - HALO,
  base - size * 0.78 - HALO,
  cx + w / 2 + HALO,
  base + size * 0.12 + HALO,
];

/** Whether two segments cross. */
export function crosses(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): boolean {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Whether a segment passes through a box. */
function throughBox(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  box: readonly [number, number, number, number],
): boolean {
  const [x0, y0, x1, y1] = box;
  for (let k = 0; k <= 12; k++) {
    const x = lerp(ax, bx, k / 12);
    const y = lerp(ay, by, k / 12);
    if (x > x0 && x < x1 && y > y0 && y < y1) return true;
  }
  return false;
}

/**
 * A tag's leader: from the nearest point under its name to its owner's hat, or null when the
 * tag sits on its owner.
 */
export const leaderOf = (
  cx: number,
  base: number,
  size: number,
  x: number,
  y: number,
  w: number,
): [number, number, number, number] | null => {
  const sx = clamp(x, cx - w / 2 + 6, cx + w / 2 - 6);
  return Math.hypot(sx - x, base + 8 - y) > 14 + (size - 24) * 0.5
    ? [sx, base + size * 0.12 + 2, x, y + 4]
    : null;
};

/** A tag may sit centred over its spot, or with one end over its owner: by this much of its width. */
const SHIFTS = [0, 1, -1] as const;

/** A grid of rectangles for asking quickly whether a new one meets any. */
class Boxes {
  private readonly cells = new Map<number, number[]>();
  private readonly all: number[] = [];
  add(x0: number, y0: number, x1: number, y1: number): void {
    const i = this.all.length;
    this.all.push(x0, y0, x1, y1);
    for (let gx = Math.floor(x0 / 96); gx <= Math.floor(x1 / 96); gx++)
      for (let gy = Math.floor(y0 / 96); gy <= Math.floor(y1 / 96); gy++) {
        const key = gx * 1000 + gy;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(i);
      }
  }
  meets(x0: number, y0: number, x1: number, y1: number): boolean {
    const a = this.all;
    for (let gx = Math.floor(x0 / 96); gx <= Math.floor(x1 / 96); gx++)
      for (let gy = Math.floor(y0 / 96); gy <= Math.floor(y1 / 96); gy++) {
        const cell = this.cells.get(gx * 1000 + gy);
        if (!cell) continue;
        for (const i of cell)
          if (
            x0 < (a[i + 2] as number) &&
            x1 > (a[i] as number) &&
            y0 < (a[i + 3] as number) &&
            y1 > (a[i + 1] as number)
          )
            return true;
      }
    return false;
  }
}

/** How far a tag may move against its owner in a sixtieth of a second, in pixels. */
export const TAG_STEP = 3.8;

interface Held {
  spot: number;
  ox: number;
  oy: number;
  since: number;
  alpha: number;
}

/**
 * Name tags that hold their spots. Stepped a sixtieth of a second at a time
 * from the start of a scene: a tag keeps its spot while the spot is free,
 * takes the nearest free one of a fixed set when it is not (at most once a
 * second unless it would otherwise lie over something), and slides there
 * no faster than TAG_STEP a frame.
 */
export class TagLayout {
  private readonly held = new Map<number, Held>();

  /**
   * One step. `taken` is what no tag may lie over (heads, numbers, corners).
   * `show` tags are laid out in their order; with `mustShow` a tag that finds
   * no free spot is still drawn at its nearest, otherwise it fades out.
   */
  step(
    t: number,
    wants: readonly TagWant[],
    taken: readonly number[],
    mustShow: boolean,
    lines: readonly number[] = [],
    /** What a tag keeps off if it can (numbers, labels), but may lie over rather than not be shown. */
    soft: readonly number[] = [],
    /** Whether a tag moved off its own spot keeps off the other owners' spots where it can. */
    keepHomes = false,
  ): PlacedTag[] {
    const boxes = new Boxes();
    for (let k = 0; k < taken.length; k += 4)
      boxes.add(
        taken[k] as number,
        taken[k + 1] as number,
        taken[k + 2] as number,
        taken[k + 3] as number,
      );
    const softBoxes = new Boxes();
    for (let k = 0; k < soft.length; k += 4)
      softBoxes.add(
        soft[k] as number,
        soft[k + 1] as number,
        soft[k + 2] as number,
        soft[k + 3] as number,
      );
    const out: PlacedTag[] = [];
    const seen = new Set<number>();
    // Leaders already laid this step, and lines drawn on the plate that no leader may cross.
    const leaders: number[] = [...lines];
    const placed: [number, number, number, number][] = [];
    const inFrame = (x0: number, y0: number, x1: number, y1: number): boolean =>
      x0 >= FRAME.x0 + 6 && x1 <= FRAME.x1 - 6 && y0 >= FRAME.y0 + 6 && y1 <= FRAME.y1 - 6;
    // Tier 0 keeps leaders off the plate's lines and each other; tier 1 lets them cross the plate's
    // lines; tier 2 lets them cross other leaders; tier 3, for a tag that must be shown, lets it
    // lie over a number or a label. A tag never lies on another tag or a head.
    let tier = 0;
    let ignoreSoft = false;
    // A new spot must have room to spare, so a head moving a little does not send the tag on again.
    let spare = 0;
    // Each owner's own spot over its hat. Another tag keeps off it where it can, so a tag moved out
    // of its way does not take a third tag's place in turn.
    const homes = (keepHomes ? wants : []).map((want) => {
      const size = want.size ?? TAG_SIZE;
      return {
        key: want.key,
        box: tagBox(want.x, want.y - 8, measure("roman", size, want.name), size),
      };
    });
    let self = -1;
    let home = false;
    const onHome = (x0: number, y0: number, x1: number, y1: number): boolean =>
      homes.some(
        (q) => q.key !== self && x0 < q.box[2] && x1 > q.box[0] && y0 < q.box[3] && y1 > q.box[1],
      );
    const fits = (x0: number, y0: number, x1: number, y1: number): boolean =>
      inFrame(x0, y0, x1, y1) &&
      !boxes.meets(x0 - spare, y0 - spare, x1 + spare, y1 + spare) &&
      (ignoreSoft || tier >= 3 || !softBoxes.meets(x0, y0, x1, y1)) &&
      (home || tier >= 2 || !onHome(x0, y0, x1, y1));
    const leaderFree = (leader: [number, number, number, number] | null): boolean => {
      if (!leader || tier >= 2) return true;
      const [ax, ay, bx, by] = leader;
      for (let k = tier >= 1 ? lines.length : 0; k < leaders.length; k += 4)
        if (
          crosses(
            ax,
            ay,
            bx,
            by,
            leaders[k] as number,
            leaders[k + 1] as number,
            leaders[k + 2] as number,
            leaders[k + 3] as number,
          )
        )
          return false;
      return !placed.some((b) => throughBox(ax, ay, bx, by, b));
    };
    // Called tags first, then those that already hold a spot, so a newcomer moves round them; among
    // newcomers the longest names first, as they are the hardest to fit.
    const order = [...wants].sort(
      (a, b) =>
        Number(b.called ?? false) - Number(a.called ?? false) ||
        (this.held.has(a.key) ? 0 : 1) - (this.held.has(b.key) ? 0 : 1) ||
        b.name.length - a.name.length ||
        a.key - b.key,
    );
    for (const want of order) {
      seen.add(want.key);
      self = want.key;
      ignoreSoft = false;
      tier = 0;
      const size = want.size ?? TAG_SIZE;
      const scale = size / 24;
      const w = measure("roman", size, want.name);
      const h = this.held.get(want.key);
      // A spot is one of SPOTS, the tag centred on it or shifted so one end is over its owner.
      const count = SPOTS.length * SHIFTS.length;
      const spotXY = (id: number): [number, number] => {
        const [ox, oy] = SPOTS[Math.floor(id / SHIFTS.length)] as readonly [number, number];
        const shift = SHIFTS[id % SHIFTS.length] as number;
        return [ox * scale + shift * Math.max(0, w / 2 - 18), oy * scale];
      };
      const at = (id: number): [number, number, number, number] => {
        const [ox, oy] = spotXY(id);
        return tagBox(want.x + ox, want.y + oy - 8, w, size);
      };
      const leaderAt = (id: number): [number, number, number, number] | null => {
        const [ox, oy] = spotXY(id);
        return leaderOf(want.x + ox, want.y + oy - 8, size, want.x, want.y, w);
      };
      const ok = (id: number): boolean => fits(...at(id)) && leaderFree(leaderAt(id));
      const must = mustShow || want.called === true;
      let target = -1;
      // A tag's own spot is 8 px over its owner's hat. It goes back there whenever that is free and
      // the way there is clear, so it is never seen sliding over something to get home.
      tier = 0;
      home = true;
      if (ok(0)) {
        let clear = true;
        if (h && h.spot !== 0)
          for (let k = 1; k < 8 && clear; k++)
            clear = fits(
              ...tagBox(want.x + h.ox * (1 - k / 8), want.y + h.oy * (1 - k / 8) - 8, w, size),
            );
        if (clear) target = 0;
      }
      home = false;
      // Otherwise it keeps the spot it holds while only a label passes over it.
      if (target < 0 && h && h.spot < count) {
        tier = 0;
        ignoreSoft = true;
        if (ok(h.spot)) target = h.spot;
        else ignoreSoft = false;
      }
      for (tier = 0; tier < (must ? 4 : 3) && target < 0; tier++) {
        if (h && h.spot < count && ok(h.spot)) target = h.spot;
        else {
          // The spot with the shortest leader near where the tag is now, so a move is short; first
          // with room to spare.
          const fromX = h ? h.ox : 0;
          const fromY = h ? h.oy : 0;
          for (spare = h ? 8 : 0; spare >= 0 && target < 0; spare -= 8) {
            let best = Number.POSITIVE_INFINITY;
            for (let id = 0; id < count; id++) {
              const [ox, oy] = spotXY(id);
              const l = leaderAt(id);
              const length = l ? Math.hypot(l[2] - l[0], l[3] - l[1]) : 0;
              const cost = Math.hypot(ox - fromX, oy - fromY) * 0.5 + length + Math.abs(oy) * 0.2;
              if (cost >= best) continue;
              if (ok(id)) {
                best = cost;
                target = id;
              }
            }
          }
          spare = 0;
        }
      }
      tier = Math.max(0, tier - 1);
      let alpha = h ? h.alpha : mustShow ? 1 : 0;
      let spot = target;
      if (spot < 0) {
        if (!mustShow && (!h || alpha <= 1 / 12)) {
          this.held.delete(want.key);
          continue;
        }
        spot = h ? h.spot : 0;
      }
      const [tx, ty] = spotXY(spot);
      // A tag that has faded right out is not seen moving: it goes straight to its free spot.
      const gone = !h || (h.alpha <= 0 && target >= 0);
      let ox = gone ? tx : h.ox;
      let oy = gone ? ty : h.oy;
      const dx = tx - ox;
      const dy = ty - oy;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) {
        const move = Math.min(dist, TAG_STEP, Math.max(1.2, dist * 0.28));
        ox += (dx / dist) * move;
        oy += (dy / dist) * move;
      }
      const cx = want.x + ox;
      const base = want.y + oy - 8;
      const box = tagBox(cx, base, w, size);
      const leader = leaderOf(cx, base, size, want.x, want.y, w);
      // A tag that lies over something on its way, or has nowhere free to go, fades until it is clear.
      home = spot === 0;
      const clear = target >= 0 && fits(...box) && leaderFree(leader);
      home = false;
      alpha = clear
        ? Math.min(1, alpha + (mustShow ? 0.25 : 0.15))
        : Math.max(0, Math.min(alpha - 0.25, 0.45));
      const since = !h || h.spot !== spot ? t : h.since;
      this.held.set(want.key, { spot, ox, oy, since, alpha });
      boxes.add(...box);
      placed.push(box);
      if (leader && alpha > 0.45) leaders.push(...leader);
      // The spot it is going to is kept clear for it too.
      if (dist > 0.01) boxes.add(...at(spot));
      out.push({
        key: want.key,
        name: want.name,
        rgb: want.rgb,
        x: want.x,
        y: want.y,
        cx,
        base,
        w,
        alpha,
        size,
        called: want.called ?? false,
        feet: want.feet ?? null,
      });
    }
    for (const key of [...this.held.keys()]) if (!seen.has(key)) this.held.delete(key);
    return out;
  }
}

/** What a moment asks of the tags: who wants one, what they keep off, and whether all must show. */
export interface TagAsk {
  wants: TagWant[];
  taken: number[];
  must: boolean;
  lines?: number[];
  soft?: number[];
  /** A tag moved off its own spot keeps off the other owners' spots where it can. */
  homes?: boolean;
}

/** Tags laid out once per sixtieth of a second from the start, and read back by time. */
export class TagTimeline {
  private readonly frames: PlacedTag[][] = [];
  private readonly layout = new TagLayout();
  private readonly at: (t: number) => TagAsk;
  constructor(at: (t: number) => TagAsk) {
    this.at = at;
  }

  /** The tags as they stand `t` seconds in. */
  get(t: number): PlacedTag[] {
    const want = Math.max(0, Math.floor(t * 60 + 1e-6));
    while (this.frames.length <= want) {
      const s = this.frames.length / 60;
      const { wants, taken, must, lines, soft, homes } = this.at(s);
      this.frames.push(this.layout.step(s, wants, taken, must, lines, soft, homes));
    }
    return this.frames[want] as PlacedTag[];
  }
}

/** How strongly a placed tag is drawn: one held back to under half is not drawn at all. */
export const tagSeen = (tag: PlacedTag): number => clamp((tag.alpha - 0.45) / 0.55);

/**
 * Draws tags: a called tag's ring round its owner's feet, leaders to owners, then each name with
 * its paper halo, ruled under in its owner's colour.
 */
export function drawPlacedTags(d: Draw, tags: readonly PlacedTag[], alpha = 1): void {
  const seen = (tag: PlacedTag): number => tagSeen(tag) * alpha;
  for (const tag of tags) {
    if (!tag.called || !tag.feet || seen(tag) <= 0.01) continue;
    const [fx, fy, h] = tag.feet;
    const ink = d.ink;
    d.ink = tag.rgb;
    d.curve(
      d.round(fx, fy, h * 0.55, h * 0.55 * BACK * 0.6, 18).slice(),
      CONTOUR,
      7,
      true,
      seen(tag),
    );
    d.ink = ink;
  }
  tags.forEach((tag, i) => {
    const leader = leaderOf(tag.cx, tag.base, tag.size, tag.x, tag.y, tag.w);
    if (leader && seen(tag) > 0.01) d.line(...leader, HAIR, i + 5, seen(tag));
  });
  for (const tag of tags) {
    const a = seen(tag);
    if (a <= 0.01) continue;
    const { cx, base, w, size } = tag;
    const k = size / 24;
    d.fill(d.box(cx - w / 2 - 1, base + 3 * k, cx + w / 2 + 1, base + 7 * k), d.ground, a);
    d.fill(d.box(cx - w / 2, base + 4 * k, cx + w / 2, base + 6.5 * k), tag.rgb, a);
    d.text(tag.name, cx, base, { size, align: 0.5, halo: 1, reach: HALO, alpha: a });
  }
}

/**
 * How far above its feet a citizen's hat reaches, for keeping things off it: a little under
 * HAT_TOP, so a tag in its own spot 8 px over the hat clears it.
 */
const HAT_CLEAR = 1.42;

/** A citizen's head and hat, for a citizen `size` px tall with its feet at (x, y). */
export const hatBox = (x: number, y: number, size: number): [number, number, number, number] => [
  x - size * 0.24,
  y - size * HAT_CLEAR,
  x + size * 0.24,
  y - size * 0.62,
];

/** A citizen's whole figure, hat to feet, with what it holds out. */
export const figureBox = (x: number, y: number, size: number): [number, number, number, number] => [
  x - size * 0.32,
  y - size * HAT_CLEAR,
  x + size * 0.32,
  y,
];

/** A head's box for a citizen `size` px tall with its feet at (x, y). */
export const headBox = (x: number, y: number, size: number): [number, number, number, number] => [
  x - size * 0.2,
  y - size * 1.02,
  x + size * 0.2,
  y - size * 0.64,
];
