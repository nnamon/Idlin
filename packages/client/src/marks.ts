// The effects of effects.ts as pen strokes: the glyphs drawn on name slips and
// the dashed route of a walk. Strokes only, never a fill.

import type { Point } from "@idlin/sim";
import type { Glyph } from "./effects.ts";
import { type Ctx, hash, type Pt } from "./pen.ts";

/** How far down a tile a route runs, as a fraction of the tile: along the middle of a bridge's deck. */
export const ROUTE_ROW = 0.6;
/** Pixels between the lanes of routes that share a path. */
export const LANE_GAP = 3.5;

/** Lays the strokes of a glyph centred on (0, 0), about 20 units across, without stroking them. */
function glyphPath(ctx: Ctx, glyph: Glyph): void {
  switch (glyph) {
    case "walk":
      // Two footprints, one a step ahead of the other.
      ctx.moveTo(-2.06, 2.4);
      ctx.ellipse(-5, 3, 3, 5, -0.2, 0, Math.PI * 2);
      ctx.moveTo(8.94, -3.4);
      ctx.ellipse(6, -4, 3, 5, 0.2, 0, Math.PI * 2);
      break;
    case "home":
      // A tent with its flap open.
      ctx.moveTo(-10, 8);
      ctx.lineTo(10, 8);
      ctx.moveTo(-8, 8);
      ctx.lineTo(0, -9);
      ctx.lineTo(8, 8);
      ctx.moveTo(0, -9);
      ctx.lineTo(-2, 8);
      ctx.moveTo(0, -2);
      ctx.lineTo(3, 8);
      break;
    case "rest":
      // A new moon.
      ctx.moveTo(3, -8.5);
      ctx.arc(0, 0, 9, -1.23, 1.23, true);
      ctx.arc(5, 0, 7, 1.85, -1.85);
      break;
    case "confused":
      // A question mark, the dot a short stroke.
      ctx.moveTo(-5, -4);
      ctx.arc(0, -4, 5, Math.PI, Math.PI * 2.4);
      ctx.lineTo(0, 4);
      ctx.moveTo(0, 9);
      ctx.lineTo(0, 9.5);
      break;
  }
}

/** Draws a glyph in `ink` centred on (x, y), `size` pixels across. */
export function drawGlyph(
  ctx: Ctx,
  glyph: Glyph,
  x: number,
  y: number,
  size: number,
  ink: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 20, size / 20);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  glyphPath(ctx, glyph);
  ctx.stroke();
  ctx.restore();
}

/** Where a route crosses a tile `tile` pixels a side, before it is put in its lane. */
export const routePoint = ({ x, y }: Point, tile: number): Pt => [
  (x + 0.5) * tile,
  (y + ROUTE_ROW) * tile,
];

/** How far a lane sits to one side of the path: 0, then one gap either side, then two, and so on. */
export const laneOffset = (lane: number): number =>
  Math.ceil(lane / 2) * (lane % 2 === 1 ? 1 : -1) * LANE_GAP;

/**
 * The line of a route, from `from` (the walker) through the middle of each of
 * `tiles` in turn, `tile` pixels a side. It is shifted sideways into its lane
 * and wobbles as the map's own lines do. The wobble is seeded by the resident
 * and the route's goal and tied to the tiles, so the line stays the same from
 * frame to frame as the walker comes along it.
 */
export function routeLine(
  from: Pt,
  tiles: readonly Point[],
  tile: number,
  id: number,
  lane: number,
  goal: Point,
): Pt[] {
  const points: Pt[] = [from, ...tiles.map((at) => routePoint(at, tile))];
  const seed = id * 7919 + goal.x * 131 + goal.y;
  const offset = laneOffset(lane);
  // The way the path goes at each point, as a unit normal: the mean of the
  // segments either side of it.
  const normal = (i: number): Pt => {
    let dx = 0;
    let dy = 0;
    for (const [a, b] of [
      [i - 1, i],
      [i, i + 1],
    ] as const) {
      const p = points[a];
      const q = points[b];
      if (!p || !q) continue;
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length > 0) {
        dx += (q[0] - p[0]) / length;
        dy += (q[1] - p[1]) / length;
      }
    }
    const length = Math.hypot(dx, dy);
    return length > 0 ? [-dy / length, dx / length] : [0, 0];
  };
  const shifted = points.map(([x, y], i): Pt => {
    // The line leaves from the walker's feet, under the figure, and the lanes
    // meet again at the goal, where the cross stays put after the walk ends.
    if (i === 0 || i === points.length - 1) return [x, y];
    const [nx, ny] = normal(i);
    const wobble = (hash(Math.round(x), Math.round(y), seed) - 0.5) * 3;
    return [x + nx * (offset + wobble), y + ny * (offset + wobble)];
  });
  // Two more points between each pair of tiles, each a little off the straight.
  const line: Pt[] = [];
  shifted.forEach((point, i) => {
    line.push(point);
    const next = shifted[i + 1];
    if (!next || i === 0) return;
    const [ax, ay] = point;
    const [bx, by] = next;
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / length, (bx - ax) / length];
    // Seeded by the two tiles, not by where the lane put them.
    const [px, py] = points[i] as Pt;
    const [qx, qy] = points[i + 1] as Pt;
    for (const t of [1 / 3, 2 / 3]) {
      const k = (hash(Math.round(px * 3 + qx), Math.round(py * 3 + qy), seed + t * 6) - 0.5) * 4;
      line.push([ax + (bx - ax) * t + nx * k, ay + (by - ay) * t + ny * k]);
    }
  });
  return line;
}

/** What is left of a line once `eaten` (0 to 1) of its length is taken up from its start. */
export function eat(points: readonly Pt[], eaten: number): Pt[] {
  if (eaten <= 0) return [...points];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as Pt;
    const [bx, by] = points[i] as Pt;
    total += Math.hypot(bx - ax, by - ay);
  }
  let skip = total * Math.min(1, eaten);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1] as Pt;
    const [bx, by] = points[i] as Pt;
    const length = Math.hypot(bx - ax, by - ay);
    if (skip < length || i === points.length - 1) {
      const t = length > 0 ? Math.min(1, skip / length) : 1;
      return [[ax + (bx - ax) * t, ay + (by - ay) * t], ...points.slice(i)];
    }
    skip -= length;
  }
  return points.slice(-1);
}

/**
 * Draws a route as a dashed line from its far end to its near one, so that
 * the dashes stay put on the ground as the walker comes along it, and marks
 * the far end with a small cross. `line` and `cross` are how strongly each is
 * drawn, 0 to 1.
 */
export function drawRoute(
  ctx: Ctx,
  points: readonly Pt[],
  colour: string,
  line: number,
  cross: number,
): void {
  const end = points[points.length - 1];
  if (!end) return;
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 2.6;
  const [first, second] = points;
  if (line > 0 && first && second && Math.hypot(first[0] - end[0], first[1] - end[1]) > 1) {
    ctx.globalAlpha = base * line;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    for (let i = points.length - 1; i >= 0; i--) {
      const [x, y] = points[i] as Pt;
      if (i === points.length - 1) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (cross > 0) {
    ctx.globalAlpha = base * cross;
    ctx.beginPath();
    const [x, y] = end;
    ctx.moveTo(x - 5, y - 4.5);
    ctx.lineTo(x + 5, y + 5);
    ctx.moveTo(x + 4.5, y - 5);
    ctx.lineTo(x - 5, y + 4.5);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * The hatching on a tile a blow is about to land on, `tile` pixels a side with
 * its top left corner at (x, y): diagonal strokes across it, laid one after
 * another as the wind-up runs, so how full the tile is says how soon the blow
 * lands. `strokes` (0 to `total`) is how many are down; the last one down is
 * still coming in, so the tile fills smoothly.
 */
export function drawHatch(
  ctx: Ctx,
  x: number,
  y: number,
  tile: number,
  strokes: number,
  total: number,
  colour: string,
): void {
  if (strokes <= 0) return;
  const base = ctx.globalAlpha;
  const inset = 5;
  const side = tile - inset * 2;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  // The tile's edge, faint, so the whole tile reads as marked from the first stroke.
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = base * 0.45 * Math.min(1, strokes);
  ctx.beginPath();
  ctx.moveTo(x + inset, y + inset + hash(x, y, 1) * 2);
  ctx.lineTo(x + tile - inset, y + inset + hash(x, y, 2) * 2);
  ctx.lineTo(x + tile - inset - hash(x, y, 3) * 2, y + tile - inset);
  ctx.lineTo(x + inset, y + tile - inset - hash(x, y, 4) * 2);
  ctx.closePath();
  ctx.stroke();
  ctx.lineWidth = 2.2;
  for (let k = 0; k < total; k++) {
    const strength = Math.min(1, strokes - k);
    if (strength <= 0) break;
    // Strokes from the bottom left to the top right, spaced across the tile,
    // the first in the middle and the rest out from it.
    const order = k % 2 === 0 ? k / 2 : -(k + 1) / 2;
    const at = 0.5 + (order / (total + 1)) * 1.6;
    const wobble = (hash(x + k, y, 7) - 0.5) * 3;
    const length = 0.5 - Math.abs(at - 0.5);
    const cx = x + inset + side * at;
    const cy = y + inset + side * (1 - at);
    const reach = side * Math.max(0.12, length) + wobble;
    ctx.globalAlpha = base * 0.85 * strength;
    ctx.beginPath();
    ctx.moveTo(cx - reach, cy - reach);
    ctx.lineTo(cx + reach, cy + reach);
    ctx.stroke();
  }
  ctx.restore();
}

/** A scratch left where a blow landed on nobody: three short gashes the way the blow went. */
export function drawScratch(
  ctx: Ctx,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  strength: number,
  colour: string,
): void {
  if (strength <= 0) return;
  const length = Math.hypot(dx, dy) || 1;
  const [ux, uy] = dx === 0 && dy === 0 ? [1, 0] : [dx / length, dy / length];
  const [nx, ny] = [-uy, ux];
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineWidth = 1.8;
  ctx.globalAlpha = base * 0.8 * strength;
  ctx.beginPath();
  for (const side of [-1, 0, 1]) {
    const ox = cx + nx * side * 5;
    const oy = cy + ny * side * 3.5;
    const half = side === 0 ? 9 : 7;
    ctx.moveTo(ox - ux * half, oy - uy * half * 0.6);
    ctx.lineTo(ox + ux * half, oy + uy * half * 0.6);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Where a downed resident lay: a pale wash of its cloak, the length of a
 * figure on the ground, inside a broken ink outline. Unlike a monster's dark
 * stain it is open and in the resident's own colour. `facing` is the way it
 * fell; (cx, cy) is where its feet were.
 */
export function drawLaid(
  ctx: Ctx,
  cx: number,
  cy: number,
  facing: 1 | -1,
  strength: number,
  cloak: string,
  colour: string,
): void {
  if (strength <= 0) return;
  const rx = 19;
  const ry = 6;
  const mx = cx + facing * 12;
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.globalAlpha = base * 0.45 * strength;
  ctx.fillStyle = cloak;
  ctx.beginPath();
  ctx.ellipse(mx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = base * 0.85 * strength;
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.ellipse(mx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Half the width and height of a hitpoint ring on the ground, in pixels. */
export const RING_RX = 19;
export const RING_RY = 6.5;

/**
 * A hitpoint ring on the ground round (cx, cy): a faint whole ring, and over
 * it a firm stroke for the share of hitpoints left, from the front round both
 * sides, so it closes towards the back as the hitpoints go.
 */
export function drawRing(
  ctx: Ctx,
  cx: number,
  cy: number,
  share: number,
  strength: number,
  colour: string,
): void {
  if (strength <= 0) return;
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = base * 0.35 * strength;
  ctx.beginPath();
  ctx.ellipse(cx, cy, RING_RX, RING_RY, 0, 0, Math.PI * 2);
  ctx.stroke();
  if (share > 0) {
    const half = Math.PI * Math.min(1, share);
    ctx.lineWidth = 2.6;
    ctx.globalAlpha = base * 0.9 * strength;
    ctx.beginPath();
    ctx.ellipse(cx, cy, RING_RX, RING_RY, 0, Math.PI / 2 - half, Math.PI / 2 + half);
    ctx.stroke();
  }
  ctx.restore();
}

/** Three flecks of ink thrown off a figure struck at (cx, cy), the way the blow went; `t` is 0 to 1 through their flight. */
export function drawFlecks(
  ctx: Ctx,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  t: number,
  colour: string,
): void {
  if (t <= 0 || t >= 1) return;
  const angle = dx === 0 && dy === 0 ? -Math.PI / 2 : Math.atan2(dy * 0.6, dx);
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.globalAlpha = base * (1 - t);
  ctx.beginPath();
  for (const turn of [-0.6, 0, 0.6]) {
    const a = angle + turn - 0.35;
    const from = 8 + 12 * t;
    const to = from + 4;
    ctx.moveTo(cx + Math.cos(a) * from, cy + Math.sin(a) * from);
    ctx.lineTo(cx + Math.cos(a) * to, cy + Math.sin(a) * to);
  }
  ctx.stroke();
  ctx.restore();
}

/** Dust kicked up where a figure hopped out of a blow, at its feet (cx, cy); `t` is 0 to 1 through its life. */
export function drawDust(ctx: Ctx, cx: number, cy: number, t: number, colour: string): void {
  if (t <= 0 || t >= 1) return;
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineWidth = 1.4;
  ctx.globalAlpha = base * 0.7 * (1 - t);
  const out = 8 + 10 * t;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(cx + side * out, cy - 1);
    ctx.quadraticCurveTo(cx + side * (out + 4), cy - 5 - 3 * t, cx + side * (out + 7), cy - 3);
    ctx.moveTo(cx + side * (out - 3), cy + 2);
    ctx.lineTo(cx + side * (out + 2), cy + 2.5);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The stain a fallen monster leaves, round (cx, cy) and `size` pixels across:
 * a tangle of short strokes inside a ragged outline, all the same from frame
 * to frame for one stain. `strength` is how strongly it is drawn, 0 to 1.
 */
export function drawBlot(
  ctx: Ctx,
  cx: number,
  cy: number,
  size: number,
  strength: number,
  colour: string,
  seed: number,
): void {
  if (strength <= 0) return;
  const rx = size / 2;
  const ry = size / 4;
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = base * 0.9 * strength;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const points = 11;
  for (let i = 0; i <= points; i++) {
    const a = ((i % points) / points) * Math.PI * 2;
    const k = 0.75 + hash(i % points, seed, 3) * 0.45;
    const px = cx + Math.cos(a) * rx * k;
    const py = cy + Math.sin(a) * ry * k;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  // Inside, crossed strokes thick enough to read as a stain.
  ctx.lineWidth = 2.6;
  ctx.globalAlpha = base * 0.8 * strength;
  ctx.beginPath();
  const strokes = Math.max(9, Math.round(size / 3));
  for (let i = 0; i < strokes; i++) {
    const t = (i + 0.5) / strokes;
    const along = -rx * 0.8 + t * rx * 1.6;
    const room = ry * Math.sqrt(Math.max(0, 1 - (along / rx) ** 2)) * 0.8;
    const tilt = (hash(i, seed, 5) - 0.5) * 4;
    ctx.moveTo(cx + along - 2 + tilt, cy + room);
    ctx.lineTo(cx + along + 2 - tilt, cy - room);
  }
  // A few drops thrown out beside it.
  for (let i = 0; i < 3; i++) {
    const a = hash(i, seed, 9) * Math.PI * 2;
    const px = cx + Math.cos(a) * rx * 1.25;
    const py = cy + Math.sin(a) * ry * 1.4;
    ctx.moveTo(px, py);
    ctx.lineTo(px + 1.5, py + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}
