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
