// How the land of a landing is drawn (docs/art.md, section 8): wood and crag
// masses with one lumpy outline, and the standing things of the vale biome,
// each revealed by the ink as the reveal reaches it. Where they stand is
// land.ts's business.

import { CONTOUR, type Draw, FORM, HAIR, HEAVY, INK } from "./draw.ts";
import { clamp, easeOutBack, hash } from "./geom.ts";

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
      // A hollow at the foot of every third tooth of the near crags, in close hatching: an arch of
      // black with eyes in it is a den's mouth and nothing else (docs/art.md, section 6).
      if (row.strength >= 1 && i % 3 === 1)
        d.hatch(
          [
            x - 0.6,
            y - 0.05,
            x - 0.52,
            y - 0.6,
            x - 0.2,
            y - 0.8,
            x + 0.12,
            y - 0.6,
            x + 0.2,
            y - 0.05,
          ],
          2,
          INK,
          0.6,
          true,
        );
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
    // A nest: a mound of woven sticks with a hollow in its top and pale eggs in it. Only a den's
    // mouth is spot black on the map, so the hollow is a dark wash, not ink.
    const lip = d.round(0, -0.1, h * 0.9, h * 0.42, 12, s.seed).slice();
    wash(lip, 0x9a8466, 0.85);
    d.curve(lip, CONTOUR, s.seed, true);
    const hollow = d.round(0, -0.12, h * 0.6, h * 0.24, 11, s.seed + 1).slice();
    wash(hollow, 0x6d5e52, 0.8);
    d.curve(hollow, FORM, s.seed + 1, true);
    for (let k = 0; k < 4; k++)
      d.body(d.round(-h * 0.3 + k * h * 0.2, -0.12 + (k % 2) * 0.06, h * 0.08, h * 0.06, 7), {
        wash: 0xe8dcc0,
        washAlpha: 1,
        weight: FORM,
        seed: s.seed + 10 + k,
      });
    // Sticks woven round the lip.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const b = a + 0.55;
      d.line(
        Math.cos(a) * h * 0.86,
        -0.1 + Math.sin(a) * h * 0.4,
        Math.cos(b) * h * 1.02,
        -0.1 + Math.sin(b) * h * 0.48,
        FORM,
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

/** A wood or crag mass, as land.ts lays them out. */
export type Mass = Row;
export const VALE_COLOURS = { GROUND, GROWTH, GROWTH_DEEP, WATER, ROCK, STONE, FLOWER, ORE, IRON };

/** A wood or crag mass. Keep the same object between frames. `r` says how much of it is inked yet. */
export function drawMass(d: Draw, row: Mass, r: Reveal = SHOWN): void {
  drawRow(d, row, r);
}

/**
 * One standing thing (0-4 trees, 5 bush, 6 boulder, 7 ruin, 8 stone, 9 ore,
 * 10 cairn, 11 wreck, 12 cache, 13 nest, 14 bones) with its foot at the
 * origin; `shown` and `flood` say how much of its ink and wash are laid yet.
 */
export function drawThingAt(
  d: Draw,
  kind: number,
  size: number,
  seed: number,
  shown = 1,
  flood = 1,
): void {
  drawThing(d, { x: 0, y: 0, kind, size, seed }, shown, flood);
}
