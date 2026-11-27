// The landing the look target is drawn on: a vale (docs/art.md, section 8).
// The ground is in plan and everything that stands on it is in elevation.
// Woods and crags are masses with one lumpy outline, banks are curves, paths
// are worn ground, and detail is thickest round the city and the places
// worth going to: ore, a ruin with a cache, a wreck, nests.
//
// It is laid out by hand and by seed here, not generated from tile data: the
// landing generator (#364) will give the game's own. Distances are in tiles
// from the ground under the middle of the city.

import { CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER } from "./draw.ts";
import { clamp, easeOutBack, hash, lerp, noise1, noise2, rng, spline } from "./geom.ts";

const GROUND = 0xd9dcae;
const GROWTH = 0x98b47e;
const GROWTH_DEEP = 0x6f9468;
const WATER = 0xa8c3c9;
const ROCK = 0xa99a88;
const STONE = 0xcbc3b2;
const FLOWER = 0xd98f3e;
const ORE = 0x7fa6b0;
const IRON = 0x5b5048;

/** How much of the land has been drawn yet, at a place: its lines, and its washes half a second behind. */
export interface Reveal {
  ink(x: number, y: number): number;
  flood(x: number, y: number): number;
}

export const SHOWN: Reveal = { ink: () => 1, flood: () => 1 };

/** The part of the vale a landing shows: tiles from the city, with room to spare. */
const X0 = -18;
const X1 = 46;
const Y1 = 12;

const RIVER = [
  12, -24, 14.5, -17.5, 19.5, -13.5, 19, -8.5, 22.5, -4.8, 24.2, -0.5, 21.8, 3.6, 23.2, 7.2, 27, 12,
];
const PATH = [8.9, 0.4, 12.5, 0.9, 16.5, -0.6, 20, -3.2, 22.6, -4.8, 25.5, -5.6, 28.4, -7.4];

interface Patch {
  x: number;
  y: number;
  r: number;
  rgb: number;
  alpha: number;
  seed: number;
}

interface Row {
  /** The foot of the mass, left to right: x, y pairs. */
  base: number[];
  height: number;
  strength: number;
  rgb: number;
  seed: number;
  kind: "wood" | "crag";
}

interface Standing {
  x: number;
  y: number;
  kind: number;
  size: number;
  seed: number;
}

interface Vale {
  patches: Patch[];
  rows: Row[];
  things: Standing[];
  clumps: { x: number; y: number; kind: number; seed: number }[];
  river: number[];
  left: number[];
  right: number[];
  path: number[];
}

let vale: Vale | null = null;

function build(): Vale {
  const random = rng(20261127);
  const patches: Patch[] = [];
  // The meadow floor: overlapping washes, so the tone builds where they cross.
  for (let i = 0; i < 13; i++) {
    const x = lerp(-12, 40, random());
    const y = lerp(-10, 6.5, random()) + (x > 30 ? -2 : 0);
    patches.push({ x, y, r: 6 + random() * 5, rgb: GROUND, alpha: 0.24, seed: i * 7 + 1 });
  }
  for (let i = 0; i < 7; i++) {
    const x = lerp(-10, 38, random());
    const y = lerp(-10, 6, random());
    patches.push({ x, y, r: 2.5 + random() * 3, rgb: GROWTH, alpha: 0.16, seed: i * 11 + 3 });
  }
  // Darker ground along the foot of the woods on either side.
  for (let i = 0; i < 9; i++) {
    const north = i % 2 === 0;
    patches.push({
      x: lerp(-8, 34, random()),
      y: north ? -12.6 + random() * 1.6 : 7 + random() * 1.4,
      r: 3 + random() * 2.5,
      rgb: 0x8ea673,
      alpha: 0.34,
      seed: i * 17 + 9,
    });
  }
  // Rock underfoot toward the crags.
  for (let i = 0; i < 7; i++)
    patches.push({
      x: 33 + random() * 12,
      y: -19 + random() * 12,
      r: 3 + random() * 3,
      rgb: ROCK,
      alpha: 0.4,
      seed: i * 13 + 5,
    });

  const rows: Row[] = [];
  const wood = (
    x0: number,
    x1: number,
    y: number,
    height: number,
    strength: number,
    seed: number,
    rgb = GROWTH,
  ): void => {
    const base: number[] = [];
    for (let x = x0; x <= x1 + 0.01; x += 1.4) base.push(x, y + noise1(x / 5 + seed, seed) * 1.1);
    rows.push({ base, height, strength, rgb, seed, kind: "wood" });
  };
  // A wood along the north side, three ranks deep; the back ranks paler.
  wood(-2, 31, -19.4, 3.6, 0.5, 11, GROWTH_DEEP);
  wood(1, 13.5, -16.8, 3.4, 0.75, 12);
  wood(17.5, 30, -17.2, 3.2, 0.75, 13);
  wood(3.5, 12, -14.4, 3.0, 1, 14);
  wood(21.5, 28.5, -15, 2.8, 1, 15);
  // West of the city, and the south-east corner in front of everything.
  wood(-19, -8.5, -8.5, 3.4, 0.75, 16, GROWTH_DEEP);
  wood(-19, -11, -5.2, 3.0, 1, 17);
  wood(28, 47, 8.2, 3.0, 0.85, 18, GROWTH_DEEP);
  wood(31, 47, 10.6, 3.2, 1, 19);
  wood(-19, -4, 9.8, 2.8, 1, 20);
  // Crags closing the east end, with a gap the horde comes through.
  const crag = (
    x0: number,
    x1: number,
    y: number,
    height: number,
    strength: number,
    seed: number,
  ): void => {
    const base: number[] = [];
    for (let x = x0; x <= x1 + 0.01; x += 1.7) base.push(x, y + noise1(x / 4 + seed, seed) * 0.8);
    rows.push({ base, height, strength, rgb: ROCK, seed, kind: "crag" });
  };
  crag(31.5, 47, -18.2, 5.2, 0.6, 31);
  crag(34.5, 47, -14.6, 4.6, 0.8, 32);
  crag(37, 47, -10.6, 4.2, 1, 33);
  crag(39, 47, -6.6, 3.4, 1, 34);
  crag(40.5, 47, 2.6, 3.0, 1, 35);

  const things: Standing[] = [];
  // Kept bare: the corner the compass and scale sit in, and the ground the fight is held on.
  const kept = (x: number, y: number): boolean =>
    (x < 1.5 && y > 2.6) || (x > 9.5 && x < 20.5 && y > -5.4 && y < 6.4);
  const lone = (x: number, y: number, kind: number, size: number): void => {
    if (kind <= 6 && kept(x, y)) return;
    things.push({ x, y, kind, size, seed: things.length * 17 + 3 });
  };
  // Single trees stand in open ground, kept clear of where the fight is held.
  const trees: [number, number][] = [
    [-9.5, -3.2],
    [-6.2, -10.6],
    [-3.5, 5.6],
    [2.5, -11.5],
    [14, -11.2],
    [16.6, -9.2],
    [26.4, -11.8],
    [30.6, -3.4],
    [33.8, 4.4],
    [26.8, 5.9],
    [36.2, -1.2],
    [-12.5, 3.8],
    [5.4, 7.4],
    [12, 8],
    [17.5, 6.8],
    [31.5, -10.5],
    [-7.5, -13.5],
    [35.5, 6.6],
    [9, -12.6],
  ];
  trees.forEach(([x, y], i) => {
    lone(x, y, i % 5, 1.9 + hash(i, 5) * 0.9);
  });
  // Bushes, with fruit to take, and boulders.
  for (let i = 0; i < 16; i++)
    lone(lerp(-10, 36, random()), lerp(-10.5, 7.5, random()), 5, 0.6 + random() * 0.4);
  for (let i = 0; i < 14; i++)
    lone(lerp(-12, 40, random()), lerp(-12, 8, random()), 6, 0.35 + random() * 0.5);
  // A ruined tower on its knoll, east of the ford, with a cache at its foot.
  lone(28.6, -7.2, 7, 5.4);
  lone(30.5, -6.5, 12, 0.9);
  // Standing stones on the near meadow.
  lone(15.2, -6.2, 8, 1.4);
  lone(16.3, -6.6, 8, 1.1);
  lone(14.3, -6.8, 8, 0.9);
  // Ore: three seams, each bigger the further from the ramp. A cairn by the path.
  lone(23.6, -10.4, 9, 1.3);
  lone(33.4, -9.2, 9, 1.7);
  lone(36.6, -4.6, 9, 2.1);
  lone(26.4, -4.2, 10, 0.9);
  // The wreck of another city's leg, with plate worth stripping.
  lone(30.6, 3.4, 11, 5);
  // A second nest and an ore seam on the near bank, north of the fight.
  lone(6.5, -9.6, 13, 2);
  lone(17.4, -8.6, 9, 1.8);
  // Nests, where the swarm comes up, and bones round them.
  lone(35.6, 1.2, 13, 2.6);
  lone(33.2, -6.2, 13, 2);
  lone(27.4, 6.4, 14, 1.1);
  lone(24.6, -1.6, 14, 0.8);
  lone(34.6, -2.2, 14, 1);
  things.sort((a, b) => a.y - b.y);

  const river: number[] = [];
  spline(RIVER, RIVER.length / 2, 0.8, false, river);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < river.length / 2; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(river.length / 2 - 1, i + 1);
    const tx = (river[b * 2] as number) - (river[a * 2] as number);
    const ty = (river[b * 2 + 1] as number) - (river[a * 2 + 1] as number);
    const tl = Math.hypot(tx, ty) || 1;
    const w = 0.62 + 0.22 * noise1(i / 5, 71);
    left.push(
      (river[i * 2] as number) + (ty / tl) * w * (1 + 0.2 * noise1(i / 2.3, 72)),
      (river[i * 2 + 1] as number) - (tx / tl) * w,
    );
    right.push(
      (river[i * 2] as number) - (ty / tl) * w * (1 + 0.2 * noise1(i / 2.7, 73)),
      (river[i * 2 + 1] as number) + (tx / tl) * w,
    );
  }
  const path: number[] = [];
  spline(PATH, PATH.length / 2, 0.6, false, path);

  // Ground marks in clumps, with bare paper between: thick near the city, the path and the water.
  const clumps: Vale["clumps"] = [];
  const near = (x: number, y: number): number => {
    let best = Math.hypot(x, y) * 0.45;
    for (let i = 0; i < path.length; i += 6)
      best = Math.min(best, Math.hypot(x - (path[i] as number), y - (path[i + 1] as number)));
    for (let i = 0; i < river.length; i += 8)
      best = Math.min(
        best,
        Math.hypot(x - (river[i] as number), y - (river[i + 1] as number)) * 0.8,
      );
    return best;
  };
  for (let i = 0; i < 2600; i++) {
    const x = lerp(X0, X1, random());
    const y = lerp(-13, Y1, random());
    const density = noise2(x / 3.2, y / 3.2, 81) * 1.25 - near(x, y) / 16;
    if (density < 0.42 + random() * 0.35) continue;
    if (x < 1.5 && y > 2.6) continue;
    clumps.push({ x, y, kind: random() < 0.72 ? 0 : random() < 0.6 ? 1 : 2, seed: i });
  }
  return { patches, rows, things, clumps, river, left, right, path };
}

function get(): Vale {
  if (!vale) vale = build();
  return vale;
}

/** A piece of a long curve, as its own stroke, if the land there has been inked. */
function stretch(
  d: Draw,
  pts: number[],
  from: number,
  to: number,
  weight: number,
  seed: number,
  r: Reveal,
  alpha = 1,
): void {
  const mid = Math.floor((from + to) / 2);
  const shown = r.ink(pts[mid * 2] as number, pts[mid * 2 + 1] as number);
  if (shown <= 0.02) return;
  // The stroke is drawn on from its near end as the ink reaches it.
  const end = from + Math.max(2, Math.ceil((to - from) * clamp(shown * 1.4)));
  d.curve(pts.slice(from * 2, Math.min(to, end) * 2 + 2), weight, seed, false, alpha);
}

/** The ground: washes, the river, the path, hachures on the valley sides, and ground marks. */
export function drawValeGround(d: Draw, r: Reveal): void {
  const v = get();
  const base = d.strength;
  for (const p of v.patches) {
    const flood = r.flood(p.x, p.y);
    if (flood <= 0.02) continue;
    // A wash floods out from its middle and stops at a hard edge.
    const grown = p.r * lerp(0.5, 1, flood);
    const pts: number[] = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      // An uneven edge, as a brush leaves: no two patches the same shape.
      const reach =
        grown *
        (0.72 + 0.34 * noise1(k * 0.7 + p.seed, p.seed) + 0.14 * noise1(k * 2.3, p.seed + 1));
      pts.push(p.x + Math.cos(a) * reach * 1.45, p.y + Math.sin(a) * reach * 0.8);
    }
    d.wash(pts, p.rgb, p.alpha * clamp(flood * 1.5), true);
  }

  // The river: water between two banks that are curves, never steps.
  const n = v.river.length / 2;
  for (let i = 0; i + 4 < n; i += 4) {
    const flood = r.flood(v.river[i * 2 + 4] as number, v.river[i * 2 + 5] as number);
    if (flood <= 0.02) continue;
    const quad: number[] = [];
    for (let k = i; k <= i + 4; k++)
      quad.push(v.left[k * 2] as number, v.left[k * 2 + 1] as number);
    for (let k = i + 4; k >= i; k--)
      quad.push(v.right[k * 2] as number, v.right[k * 2 + 1] as number);
    d.fill(quad, d.ground, flood);
    d.fill(quad, WATER, 0.7 * flood);
    // Deeper water down the middle, with its own edge.
    const deep: number[] = [];
    for (let k = i; k <= i + 4; k++)
      deep.push(
        lerp(v.left[k * 2] as number, v.right[k * 2] as number, 0.3),
        lerp(v.left[k * 2 + 1] as number, v.right[k * 2 + 1] as number, 0.3),
      );
    for (let k = i + 4; k >= i; k--)
      deep.push(
        lerp(v.left[k * 2] as number, v.right[k * 2] as number, 0.92),
        lerp(v.left[k * 2 + 1] as number, v.right[k * 2 + 1] as number, 0.92),
      );
    d.fill(deep, 0x6f97a3, 0.45 * flood);
  }
  for (let i = 0; i + 1 < n; i += 9) {
    const to = Math.min(n - 1, i + 10);
    stretch(d, v.left, i, to, CONTOUR, 100 + i, r);
    stretch(d, v.right, i, to, FORM, 200 + i, r);
  }
  // Ripples along the flow, and reeds on the banks.
  for (let i = 2; i < n - 2; i += 2) {
    const x = v.river[i * 2] as number;
    const y = v.river[i * 2 + 1] as number;
    const shown = r.ink(x, y);
    if (shown < 0.6) continue;
    const tx = (v.river[i * 2 + 2] as number) - x;
    const ty = (v.river[i * 2 + 3] as number) - y;
    const side = (hash(i, 93) - 0.5) * 0.7;
    d.strength = base * 0.7;
    d.line(
      x - ty * side - tx * 0.3,
      y + tx * side - ty * 0.3,
      x - ty * side + tx * 0.4,
      y + tx * side + ty * 0.4,
      HAIR,
      i + 300,
    );
    d.strength = base;
    if (i % 6 === 0) {
      const bx = v.left[i * 2] as number;
      const by = v.left[i * 2 + 1] as number;
      for (let k = 0; k < 4; k++)
        d.line(
          bx + k * 0.1 - 0.3,
          by,
          bx + k * 0.12 - 0.36 + (k - 1.5) * 0.06,
          by - 0.5 - hash(i, k) * 0.3,
          FORM,
          i * 5 + k,
        );
    }
  }
  // Stepping stones at the ford.
  for (let k = 0; k < 4; k++) {
    const x = 21.7 + k * 0.5;
    const y = -5.1 + k * 0.16;
    if (r.ink(x, y) < 0.6) continue;
    d.body(d.round(x, y, 0.2, 0.14, 7, k + 5), {
      wash: STONE,
      washAlpha: 0.9,
      weight: FORM,
      seed: k + 400,
    });
  }

  // The path: worn ground, paler than the meadow, with broken edges and a few stones.
  const pn = v.path.length / 2;
  for (let i = 0; i + 3 < pn; i += 3) {
    const x = v.path[i * 2 + 2] as number;
    const y = v.path[i * 2 + 3] as number;
    const flood = r.flood(x, y);
    if (flood <= 0.02) continue;
    const band: number[] = [];
    for (let k = i; k <= i + 3; k++)
      band.push(
        v.path[k * 2] as number,
        (v.path[k * 2 + 1] as number) - 0.3 - 0.06 * noise1(k / 2, 94),
      );
    for (let k = i + 3; k >= i; k--)
      band.push(
        v.path[k * 2] as number,
        (v.path[k * 2 + 1] as number) + 0.3 + 0.06 * noise1(k / 2, 95),
      );
    d.fill(band, d.ground, 0.62 * flood);
  }
  d.strength = base * 0.75;
  for (let i = 0; i + 2 < pn; i += 3) {
    const x = v.path[i * 2] as number;
    const y = v.path[i * 2 + 1] as number;
    if (r.ink(x, y) < 0.6) continue;
    const x1 = v.path[i * 2 + 4] as number;
    const y1 = v.path[i * 2 + 5] as number;
    if (hash(i, 96) < 0.8)
      d.line(x, y - 0.32, lerp(x, x1, 0.7), lerp(y, y1, 0.7) - 0.32, HAIR, i + 500);
    if (hash(i, 97) < 0.8)
      d.line(lerp(x, x1, 0.2), lerp(y, y1, 0.2) + 0.32, x1, y1 + 0.32, HAIR, i + 600);
    if (hash(i, 98) < 0.3) d.dot(x + 0.2, y + (hash(i, 99) - 0.5) * 0.4, 1.6);
  }
  d.strength = base;

  // Ground marks.
  for (const c of v.clumps) {
    const shown = r.ink(c.x, c.y);
    if (shown < 0.7) continue;
    if (c.kind === 0) {
      for (let b = 0; b < 3; b++) {
        const lean = (b - 1) * 0.09 + (hash(c.seed, b) - 0.5) * 0.06;
        d.line(
          c.x + b * 0.07,
          c.y,
          c.x + b * 0.07 + lean,
          c.y - 0.2 - hash(c.seed, b + 4) * 0.14,
          FORM,
          c.seed + b,
        );
      }
    } else if (c.kind === 1) {
      d.dot(c.x, c.y - 0.08, 2.1, FLOWER);
      d.dot(c.x + 0.22, c.y + 0.05, 1.7, FLOWER);
      d.line(c.x, c.y - 0.05, c.x + 0.02, c.y + 0.12, HAIR, c.seed);
    } else {
      d.curve(
        [c.x - 0.14, c.y, c.x - 0.08, c.y - 0.12, c.x + 0.1, c.y - 0.13, c.x + 0.16, c.y],
        FORM,
        c.seed,
      );
    }
  }
}

/** The outline of a mass: scallops (a wood) or facets (a crag) along the top, down the end, and back along its foot. */
function massOutline(row: Row): { outline: number[]; tops: number[] } {
  const base = row.base;
  const n = base.length / 2;
  const outline: number[] = [];
  const tops: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = base[i * 2] as number;
    const y = base[i * 2 + 1] as number;
    const edge = Math.min(i, n - 1 - i);
    const taper = clamp(edge / 2 + 0.35);
    const h = row.height * taper * (0.72 + hash(i, row.seed) * 0.5);
    if (row.kind === "wood") {
      outline.push(x - 0.5, y - h * 0.8, x, y - h, x + 0.5, y - h * 0.86);
      tops.push(x, y - h);
    } else {
      // A crag rises to a point and drops sharply on its right.
      outline.push(
        x - 0.75,
        y - h * 0.5,
        x - 0.05,
        y - h * (0.9 + (i % 2) * 0.22),
        x + 0.5,
        y - h * 0.6,
      );
      tops.push(x - 0.05, y - h * (0.9 + (i % 2) * 0.22));
    }
  }
  const lastX = base[n * 2 - 2] as number;
  const lastY = base[n * 2 - 1] as number;
  outline.push(lastX + 1, lastY - 0.3);
  for (let i = n - 1; i >= 0; i--)
    outline.push((base[i * 2] as number) + 0.3, (base[i * 2 + 1] as number) + (i % 2) * 0.12);
  outline.push((base[0] as number) - 1, (base[1] as number) - 0.2);
  return { outline, tops };
}

const outlines = new Map<Row, { outline: number[]; tops: number[] }>();

function drawRow(d: Draw, row: Row, r: Reveal): void {
  const base = row.base;
  const n = base.length / 2;
  const midX = base[Math.floor(n / 2) * 2] as number;
  const midY = base[Math.floor(n / 2) * 2 + 1] as number;
  // A long mass is revealed from the end nearer the city.
  const shown = Math.max(
    r.ink(midX, midY),
    r.ink(base[0] as number, base[1] as number),
    r.ink(base[n * 2 - 2] as number, base[n * 2 - 1] as number),
  );
  if (shown <= 0.02) return;
  let made = outlines.get(row);
  if (!made) {
    made = massOutline(row);
    outlines.set(row, made);
  }
  const strength = d.strength;
  d.push();
  d.move(0, midY);
  d.scale(1, easeOutBack(clamp(shown), 1.1));
  d.move(0, -midY);
  d.strength = strength * row.strength * clamp(shown * 2);
  const wood = row.kind === "wood";
  d.fill(made.outline, d.ground, 1, wood);
  d.strength = strength * row.strength * clamp(r.flood(midX, midY) * 2);
  d.wash(made.outline, row.rgb, wood ? 0.8 : 0.75, wood);
  d.strength = strength * row.strength * clamp(shown * 2);
  if (wood) {
    // Under the canopy it is dark: a band of solid ink along the foot, broken by the trunks.
    const under: number[] = [];
    for (let i = 0; i < n; i++)
      under.push(
        (base[i * 2] as number) - 0.2,
        (base[i * 2 + 1] as number) - 0.62 - (i % 2) * 0.22,
      );
    for (let i = n - 1; i >= 0; i--)
      under.push((base[i * 2] as number) + 0.1, (base[i * 2 + 1] as number) - 0.1 + (i % 2) * 0.08);
    d.fill(under, 0x33402f, row.strength >= 1 ? 0.88 : 0.6, true);
  }
  for (let i = 0; i < n; i++) {
    const x = base[i * 2] as number;
    const y = base[i * 2 + 1] as number;
    const tx = made.tops[i * 2] as number;
    const ty = made.tops[i * 2 + 1] as number;
    if (wood) {
      // Shade on the lower right of each crown, and the crown's own arc inside the mass.
      d.hatch(
        [tx + 0.1, ty + 0.5, tx + 0.8, ty + 0.4, tx + 0.9, y - 0.2, tx + 0.2, y - 0.2],
        2,
        INK,
        0.6,
      );
      if (i % 2 === 0)
        d.curve(
          [tx - 0.6, ty + 0.9, tx - 0.2, ty + 0.4, tx + 0.4, ty + 0.5, tx + 0.7, ty + 1.0],
          FORM,
          row.seed * 9 + i,
        );
      // Trunks show only along the near edge: pale against the dark behind them.
      if (row.strength >= 1) {
        const lean = (hash(i, row.seed) - 0.5) * 0.2;
        const wide = 0.1 + hash(i, row.seed + 1) * 0.1;
        const trunk = [
          x - wide + lean,
          y - 0.7,
          x + wide * 0.6 + lean,
          y - 0.7,
          x + wide,
          y + 0.12,
          x - wide * 1.2,
          y + 0.12,
        ];
        d.fill(trunk, 0xb09a7c);
        d.line(x - wide + lean, y - 0.7, x - wide * 1.2, y + 0.12, FORM, row.seed * 5 + i);
        d.line(x + wide * 0.6 + lean, y - 0.7, x + wide, y + 0.12, CONTOUR, row.seed * 6 + i);
      }
    } else {
      // Facets: the right face of each tooth is hatched close, with a crack or two.
      d.hatch(
        [tx, ty, tx + 0.6, ty + (y - ty) * 0.38, tx + 0.8, y - 0.1, tx + 0.1, y - 0.1],
        row.strength >= 1 ? 3 : 2,
        INK,
        0.7,
      );
      d.line(tx, ty, tx + 0.12, y - 0.2, FORM, row.seed * 5 + i);
      if (i % 2) d.line(tx - 0.4, ty + (y - ty) * 0.5, tx - 0.55, y - 0.3, HAIR, row.seed * 7 + i);
      // A cave mouth at the foot of every third tooth of the near crags, with something in it.
      if (row.strength >= 1 && i % 3 === 1) {
        d.fill(
          [
            x - 0.6,
            y - 0.05,
            x - 0.52,
            y - 0.7,
            x - 0.2,
            y - 0.95,
            x + 0.12,
            y - 0.7,
            x + 0.2,
            y - 0.05,
          ],
          INK,
          1,
          true,
        );
        d.dot(x - 0.3, y - 0.5, 2, PAPER);
        d.dot(x - 0.06, y - 0.5, 2, PAPER);
      }
    }
  }
  if (wood) d.curve(made.outline, CONTOUR, row.seed, true);
  else d.path(made.outline, CONTOUR, row.seed, true);
  d.pop();
  d.strength = strength;
}

function drawThing(d: Draw, s: Standing, shown: number, flood: number): void {
  const strength = d.strength;
  const h = s.size;
  d.push();
  d.move(s.x, s.y);
  d.scale(1, easeOutBack(clamp(shown), 1.6));
  d.strength = strength * clamp(shown * 2);
  const wash = (pts: number[], rgb: number, alpha: number, rounded = true): void => {
    d.fill(pts, d.ground, 1, rounded);
    const keep = d.strength;
    d.strength = keep * clamp(flood * 2);
    d.wash(pts, rgb, alpha, rounded);
    d.strength = keep;
  };
  if (s.kind <= 4) {
    // A tree, in five builds: round, tall, twin, leaning, bare.
    d.hatch(d.round(0.4, 0.06, h * 0.5, 0.15, 8), 2, INK, 0.55);
    const lean = s.kind === 3 ? 0.35 : 0;
    // The trunk has a width, a flare at its foot and limbs that reach into the crown.
    const trunk = [
      -0.14,
      0.03,
      -0.06 + lean * 0.3,
      -h * 0.26,
      -0.05 + lean * 0.6,
      -h * 0.52,
      0.05 + lean * 0.6,
      -h * 0.52,
      0.07 + lean * 0.3,
      -h * 0.26,
      0.16,
      0.03,
    ];
    wash(trunk, 0xb09a7c, 0.9, false);
    d.hatch(
      [
        0.02 + lean * 0.6,
        -h * 0.52,
        0.05 + lean * 0.6,
        -h * 0.52,
        0.07 + lean * 0.3,
        -h * 0.26,
        0.16,
        0.03,
        0.04,
        0.03,
      ],
      2,
      INK,
      0.7,
    );
    d.curve(
      [-0.14, 0.03, -0.06 + lean * 0.3, -h * 0.26, -0.05 + lean * 0.6, -h * 0.52],
      CONTOUR,
      s.seed,
    );
    d.curve(
      [0.16, 0.03, 0.07 + lean * 0.3, -h * 0.26, 0.05 + lean * 0.6, -h * 0.52],
      FORM,
      s.seed + 30,
    );
    if (s.kind === 4) {
      d.curve([lean, -h * 0.45, -0.3, -h * 0.75, -0.42, -h * 1.02], CONTOUR, s.seed + 1);
      d.curve([0, -h * 0.4, 0.3, -h * 0.7, 0.26, -h * 0.98], CONTOUR, s.seed + 2);
      d.curve([0.14, -h * 0.58, 0.5, -h * 0.72, 0.62, -h * 0.66], FORM, s.seed + 3);
      d.curve([-0.2, -h * 0.66, -0.52, -h * 0.7, -0.66, -h * 0.84], FORM, s.seed + 4);
      d.curve([0.24, -h * 0.82, 0.44, -h * 0.9, 0.48, -h * 1.04], FORM, s.seed + 5);
    } else {
      const crowns: [number, number, number, number][] =
        s.kind === 0
          ? [[0, -h * 0.72, h * 0.36, h * 0.34]]
          : s.kind === 1
            ? [[0, -h * 0.78, h * 0.24, h * 0.42]]
            : s.kind === 2
              ? [
                  [-h * 0.16, -h * 0.62, h * 0.24, h * 0.24],
                  [h * 0.16, -h * 0.84, h * 0.22, h * 0.22],
                ]
              : [[lean * 1.2, -h * 0.74, h * 0.34, h * 0.28]];
      crowns.forEach(([cx, cy, rx, ry], k) => {
        // The crown is a mass of foliage with a lumpy edge: seven or eight scallops, no two alike.
        const crown: number[] = [];
        const lumps = 9 + ((s.seed + k) % 3);
        for (let i = 0; i < lumps; i++) {
          const a = (i / lumps) * Math.PI * 2 - Math.PI / 2;
          const b = a + Math.PI / lumps;
          const out = 1.0 + hash(s.seed + k, i) * 0.14;
          crown.push(cx + Math.cos(a) * rx * out, cy + Math.sin(a) * ry * out);
          crown.push(cx + Math.cos(b) * rx * 0.93, cy + Math.sin(b) * ry * 0.93);
        }
        wash(crown, k ? GROWTH : s.seed % 3 ? GROWTH : GROWTH_DEEP, 0.72);
        d.hatch(d.round(cx + rx * 0.34, cy + ry * 0.34, rx * 0.6, ry * 0.58, 8), 2, INK, 0.6);
        d.curve(crown, CONTOUR, s.seed + k + 5, true);
        // Masses of leaf inside it, and a limb showing through.
        d.curve(
          [
            cx - rx * 0.62,
            cy + ry * 0.2,
            cx - rx * 0.34,
            cy - ry * 0.2,
            cx + rx * 0.02,
            cy - ry * 0.06,
          ],
          FORM,
          s.seed + k + 8,
        );
        d.curve(
          [
            cx - rx * 0.1,
            cy + ry * 0.5,
            cx + rx * 0.2,
            cy + ry * 0.14,
            cx + rx * 0.56,
            cy + ry * 0.26,
          ],
          FORM,
          s.seed + k + 9,
        );
        d.curve(
          [
            cx - rx * 0.2,
            cy - ry * 0.46,
            cx + rx * 0.1,
            cy - ry * 0.62,
            cx + rx * 0.4,
            cy - ry * 0.44,
          ],
          HAIR,
          s.seed + k + 10,
        );
        if (k === 0)
          d.line(
            cx * 0.4 + lean * 0.6,
            -h * 0.5,
            cx * 0.8 + rx * 0.2,
            cy + ry * 0.5,
            FORM,
            s.seed + 11,
          );
      });
    }
  } else if (s.kind === 5) {
    // A bush with fruit.
    const bush = d.round(0, -h * 0.45, h * 0.62, h * 0.46, 8, s.seed).slice();
    wash(bush, GROWTH, 0.75);
    d.curve(bush, FORM, s.seed, true);
    d.dot(-h * 0.2, -h * 0.5, 2, FLOWER);
    d.dot(h * 0.22, -h * 0.36, 2, FLOWER);
    d.dot(h * 0.02, -h * 0.72, 1.8, FLOWER);
  } else if (s.kind === 6) {
    // A boulder.
    const rock = [
      -h * 0.6,
      0,
      -h * 0.46,
      -h * 0.5,
      -h * 0.05,
      -h * 0.72,
      h * 0.42,
      -h * 0.5,
      h * 0.62,
      0,
    ];
    wash(rock, STONE, 0.8, false);
    d.hatch([-h * 0.05, -h * 0.72, h * 0.42, -h * 0.5, h * 0.62, 0, h * 0.1, 0], 2, INK, 0.6);
    d.path(rock, FORM, s.seed, true);
  } else if (s.kind === 7) {
    // The Old Watch: a round tower, broken off, with a doorway, a fallen stretch of wall and its knoll.
    d.hatch(d.round(0.5, 0.12, h * 0.62, 0.3, 10), 2, INK, 0.5);
    d.curve([-h * 0.8, 0.1, -h * 0.4, -0.3, h * 0.3, -0.34, h * 0.86, 0.14], FORM, s.seed + 20);
    const tower = [
      -h * 0.24,
      0,
      -h * 0.2,
      -h * 0.7,
      -h * 0.26,
      -h * 0.74,
      -h * 0.26,
      -h * 0.9,
      -h * 0.1,
      -h * 0.84,
      -h * 0.02,
      -h * 1.0,
      h * 0.1,
      -h * 0.82,
      h * 0.24,
      -h * 0.62,
      h * 0.2,
      -h * 0.56,
      h * 0.24,
      0,
    ];
    wash(tower, STONE, 0.85, false);
    d.hatch(
      [
        h * 0.02,
        -h * 0.96,
        h * 0.1,
        -h * 0.82,
        h * 0.24,
        -h * 0.62,
        h * 0.2,
        -h * 0.56,
        h * 0.24,
        0,
        h * 0.04,
        0,
      ],
      3,
      INK,
      0.6,
    );
    d.path(tower, CONTOUR, s.seed, true);
    d.fill(
      [-h * 0.09, 0, -h * 0.09, -h * 0.2, -h * 0.02, -h * 0.27, h * 0.05, -h * 0.2, h * 0.05, 0],
      INK,
    );
    d.fill(
      [
        -h * 0.06,
        -h * 0.5,
        -h * 0.02,
        -h * 0.58,
        h * 0.02,
        -h * 0.5,
        h * 0.02,
        -h * 0.42,
        -h * 0.06,
        -h * 0.42,
      ],
      INK,
    );
    for (let k = 0; k < 5; k++)
      d.line(
        -h * 0.2 + (k % 2) * 0.1,
        -h * (0.14 + k * 0.13),
        -h * 0.2 + 0.36 + (k % 2) * 0.1,
        -h * (0.14 + k * 0.13) - 0.02,
        HAIR,
        s.seed + k,
      );
    const wall = [
      h * 0.3,
      0,
      h * 0.32,
      -h * 0.26,
      h * 0.5,
      -h * 0.3,
      h * 0.56,
      -h * 0.16,
      h * 0.74,
      -h * 0.14,
      h * 0.8,
      0,
    ];
    wash(wall, STONE, 0.8, false);
    d.path(wall, FORM, s.seed + 9, true);
    d.body(d.box(-h * 0.56, -h * 0.1, -h * 0.4, 0), {
      smooth: false,
      wash: STONE,
      weight: FORM,
      seed: s.seed + 12,
    });
  } else if (s.kind === 8) {
    // A standing stone.
    d.hatch(d.round(0.2, 0.04, h * 0.3, 0.1, 7), 2, INK, 0.55);
    const stone = [
      -h * 0.16,
      0,
      -h * 0.2,
      -h * 0.7,
      -h * 0.04,
      -h,
      h * 0.14,
      -h * 0.86,
      h * 0.17,
      0,
    ];
    wash(stone, STONE, 0.85, false);
    d.hatch([-h * 0.02, -h * 0.96, h * 0.14, -h * 0.86, h * 0.17, 0, h * 0.02, 0], 2, INK, 0.65);
    d.path(stone, CONTOUR, s.seed, true);
  } else if (s.kind === 9) {
    // An ore seam: a split rock with its own colour showing.
    const rock = [-h * 0.7, 0, -h * 0.5, -h * 0.6, 0, -h * 0.8, h * 0.56, -h * 0.5, h * 0.7, 0];
    wash(rock, ROCK, 0.85, false);
    d.path(rock, CONTOUR, s.seed, true);
    d.fill(
      [-h * 0.1, -h * 0.1, 0, -h * 0.6, h * 0.14, -h * 0.5, h * 0.06, -h * 0.08],
      0x7fa6b0,
      0.95,
    );
    d.path(
      [-h * 0.1, -h * 0.1, 0, -h * 0.6, h * 0.14, -h * 0.5, h * 0.06, -h * 0.08],
      FORM,
      s.seed + 3,
      true,
    );
    // More of the seam, standing out of the rock.
    for (let k = 0; k < 3; k++) {
      const cx = -h * 0.4 + k * h * 0.36;
      const top = -h * (0.74 + (k % 2) * 0.3);
      const crystal = [
        cx - h * 0.1,
        -h * 0.3,
        cx - h * 0.04,
        top,
        cx + h * 0.08,
        top + h * 0.12,
        cx + h * 0.1,
        -h * 0.3,
      ];
      d.fill(crystal, ORE, 1);
      d.path(crystal, FORM, s.seed + 5 + k, true);
    }
  } else if (s.kind === 10) {
    // A cairn.
    for (let k = 0; k < 4; k++) {
      const w = h * (0.5 - k * 0.1);
      d.body(d.round(0, -h * (0.12 + k * 0.22), w, h * 0.13, 7, s.seed + k), {
        wash: STONE,
        washAlpha: 0.85,
        weight: FORM,
        seed: s.seed + k,
      });
    }
  } else if (s.kind === 11) {
    // A wrecked leg of another city: thigh and shin lying where they fell, a joint, plate and ribs.
    d.hatch(d.round(0.3, 0.1, h * 0.95, 0.3, 10), 3, INK, 0.5);
    const thigh = [-h * 0.9, -0.1, -h * 0.82, -0.5, -h * 0.1, -h * 0.5, 0, -h * 0.36];
    const shin = [0, -h * 0.5, 0.16, -h * 0.34, h * 0.86, -0.3, h * 0.8, -0.02];
    for (const [beam, key] of [
      [shin, 1],
      [thigh, 2],
    ] as const) {
      d.fill(beam, d.ground, 1);
      d.wash(beam, IRON, 0.85);
      d.path(beam, HEAVY, s.seed + key, true);
    }
    d.hatch([-h * 0.5, -h * 0.3, -h * 0.1, -h * 0.5, 0, -h * 0.36, -h * 0.9, -0.1], 3, INK, 0.7);
    d.body(d.round(0, -h * 0.43, 0.42, 0.42, 9), {
      wash: 0xd2a24c,
      washAlpha: 0.9,
      seed: s.seed + 3,
    });
    d.dot(0, -h * 0.43, 3);
    // Ribs of the hull it came off, half buried.
    for (let k = 0; k < 4; k++) {
      const rx = -h * 0.5 + k * 0.5;
      d.curve(
        [rx, 0.1, rx - 0.1, -0.7 - k * 0.12, rx + 0.3, -1.1 - k * 0.14],
        CONTOUR,
        s.seed + 6 + k,
      );
    }
    d.body([h * 0.4, 0, h * 0.44, -0.5, h * 0.66, -0.56, h * 0.7, 0], {
      smooth: false,
      wash: IRON,
      washAlpha: 0.8,
      weight: FORM,
      seed: s.seed + 12,
    });
  } else if (s.kind === 12) {
    // A cache: a banded chest, with the ring a magic drop gets.
    d.hatch(d.round(0.1, 0.05, h * 0.6, 0.12, 7), 2, INK, 0.6);
    d.body(
      [
        -h * 0.44,
        0,
        -h * 0.44,
        -h * 0.4,
        -h * 0.34,
        -h * 0.6,
        h * 0.34,
        -h * 0.6,
        h * 0.44,
        -h * 0.4,
        h * 0.44,
        0,
      ],
      { smooth: false, wash: 0xd2a24c, washAlpha: 0.95, seed: s.seed },
    );
    d.line(-h * 0.44, -h * 0.4, h * 0.44, -h * 0.4, FORM, s.seed + 1);
    d.fill(d.box(-h * 0.07, -h * 0.46, h * 0.07, -h * 0.26), INK);
    const ink = d.ink;
    d.ink = 0x3e70a2;
    d.curve(d.round(0, -h * 0.2, h * 0.8, h * 0.46, 12), FORM, s.seed + 2, true);
    d.ink = ink;
  } else if (s.kind === 13) {
    // A nest: a pit of solid ink with a raised lip, eggs in it, things looking out.
    const lip = d.round(0, -0.1, h * 0.9, h * 0.42, 12, s.seed).slice();
    wash(lip, 0x8a7f74, 0.8);
    d.curve(lip, CONTOUR, s.seed, true);
    d.fill(d.round(0, -0.08, h * 0.62, h * 0.26, 11, s.seed + 1), INK, 1, true);
    for (let k = 0; k < 3; k++) {
      d.dot(-h * 0.3 + k * h * 0.26, -0.08 + (k % 2) * 0.08, 2.4, PAPER);
      d.dot(-h * 0.3 + k * h * 0.26 + 0.16, -0.06 + (k % 2) * 0.08, 2.4, PAPER);
    }
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI - 0.2;
      d.line(
        Math.cos(a) * h * 0.86,
        -0.1 - Math.sin(a) * h * 0.4,
        Math.cos(a) * h * 1.14,
        -0.1 - Math.sin(a) * h * 0.62,
        CONTOUR,
        s.seed + 4 + k,
      );
    }
  } else {
    // Bones: a rib cage and a skull.
    for (let k = 0; k < 4; k++)
      d.curve(
        [
          -h * 0.5 + k * h * 0.26,
          0,
          -h * 0.44 + k * h * 0.26,
          -h * 0.6,
          -h * 0.2 + k * h * 0.26,
          -h * 0.7,
        ],
        CONTOUR,
        s.seed + k,
      );
    d.line(-h * 0.6, -h * 0.06, h * 0.5, -h * 0.1, FORM, s.seed + 5);
    d.body(d.round(h * 0.72, -h * 0.22, h * 0.24, h * 0.2, 8, s.seed), {
      weight: FORM,
      seed: s.seed + 6,
    });
    d.dot(h * 0.78, -h * 0.24, 2);
  }
  d.pop();
  d.strength = strength;
}

/** What stands on the land: `front` is what stands nearer the viewer than the city's feet. */
export function drawValeStanding(d: Draw, r: Reveal, front: boolean): void {
  const v = get();
  const split = 2.5;
  for (const row of v.rows) {
    const y = row.base[1] as number;
    if (y > split === front) drawRow(d, row, r);
  }
  for (const s of v.things) {
    if (s.y > split !== front) continue;
    const shown = r.ink(s.x, s.y);
    if (shown <= 0.02) continue;
    drawThing(d, s, shown, r.flood(s.x, s.y));
  }
}
