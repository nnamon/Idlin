import { SKILLS, XP_TABLE } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { castOf, spreadLevels } from "./cast.ts";
import {
  BAND_FOOT,
  BAND_HEIGHT,
  BAND_PITCH,
  drawFigure,
  type FigureStyle,
  figureTop,
  HOOD_TOP,
} from "./figure.ts";
import {
  BAND_TOTALS,
  bandsFor,
  HOOD_SHAPES,
  looks,
  partsFor,
  RISE_MAX,
  riseFor,
  totalLevel,
} from "./looks.ts";
import type { Ctx } from "./pen.ts";
import type { Pose } from "./pose.ts";

type Matrix = [number, number, number, number, number, number];

/**
 * Enough of a canvas to follow where drawFigure puts things: it keeps the
 * transform, samples every path into points, and records each fill with its
 * colour and the highest point of its path, and each filled rectangle's colour.
 */
class Recorder {
  m: Matrix = [1, 0, 0, 1, 0, 0];
  stack: { m: Matrix; fillStyle: string }[] = [];
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  globalAlpha = 1;
  lineCap = "";
  lineJoin = "";
  font = "";
  textAlign = "";
  path: [number, number][] = [];
  at: [number, number] = [0, 0];
  fills: { style: string; top: number }[] = [];
  rects: string[] = [];

  apply(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  save(): void {
    this.stack.push({ m: [...this.m], fillStyle: this.fillStyle });
  }
  restore(): void {
    const top = this.stack.pop();
    if (top) {
      this.m = top.m;
      this.fillStyle = top.fillStyle;
    }
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const [A, B, C, D, E, F] = this.m;
    this.m = [
      A * a + C * b,
      B * a + D * b,
      A * c + C * d,
      B * c + D * d,
      A * e + C * f + E,
      B * e + D * f + F,
    ];
  }
  translate(x: number, y: number): void {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x: number, y: number): void {
    this.transform(x, 0, 0, y, 0, 0);
  }
  beginPath(): void {
    this.path = [];
  }
  point(x: number, y: number): void {
    this.at = [x, y];
    this.path.push(this.apply(x, y));
  }
  moveTo(x: number, y: number): void {
    this.point(x, y);
  }
  lineTo(x: number, y: number): void {
    this.point(x, y);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const [x0, y0] = this.at;
    for (let i = 1; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      this.point(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const [x0, y0] = this.at;
    for (let i = 1; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      const [k0, k1, k2, k3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      this.point(k0 * x0 + k1 * c1x + k2 * c2x + k3 * x, k0 * y0 + k1 * c1y + k2 * c2y + k3 * y);
    }
  }
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    _r: number,
    from: number,
    to: number,
  ): void {
    for (let i = 0; i <= 80; i++) {
      const a = from + ((to - from) * i) / 80;
      this.point(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
    }
  }
  arc(cx: number, cy: number, r: number, from: number, to: number): void {
    this.ellipse(cx, cy, r, r, 0, from, to);
  }
  rect(x: number, y: number, w: number, h: number): void {
    for (const [px, py] of [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ] as const)
      this.point(px, py);
  }
  roundRect(x: number, y: number, w: number, h: number): void {
    this.rect(x, y, w, h);
  }
  closePath(): void {}
  stroke(): void {}
  clip(): void {}
  fill(): void {
    this.fills.push({ style: this.fillStyle, top: Math.min(...this.path.map(([, y]) => y)) });
  }
  fillRect(): void {
    this.rects.push(this.fillStyle);
  }
  fillText(): void {}
  measureText(): { width: number } {
    return { width: 0 };
  }
}

const STANDING: Pose = {
  x: 0,
  y: 0,
  hop: 0,
  stride: 0,
  breath: 0,
  moving: false,
  walk: 0,
  resting: false,
  sit: 0,
  lean: 0,
  stoop: 0,
  squash: 0,
};

const HOOD = "#hood";
const PAPER = "#paper";
/** Nothing over the shoulder, so that only the hat can be the top of what is drawn in the hood's colour. */
const NO_KIT = { trade: null, tier: 0, starter: 2 } as const;

/** The hat as drawn for a resident with this id and experience: how high its top is, and how many bands it has. */
function hatOf(id: number, xp: number[]): { height: number; bands: number } {
  const ctx = new Recorder();
  const style: FigureStyle = {
    ...partsFor({ id, xp }),
    kit: NO_KIT,
    cloak: "#cloak",
    hood: HOOD,
    ink: "#ink",
    paper: PAPER,
    facing: 1,
    scale: 1,
  };
  drawFigure(ctx as unknown as Ctx, 0, 0, STANDING, style, 0);
  const tops = ctx.fills.filter((fill) => fill.style === HOOD).map((fill) => fill.top);
  return { height: -Math.min(...tops), bands: ctx.rects.filter((rect) => rect === PAPER).length };
}

const xpOf = (levels: readonly number[]): number[] =>
  levels.map((level) => XP_TABLE[level] as number);

/** Experience for this total level, spread over the skills as evenly as it goes. */
const xpForTotal = (total: number): number[] =>
  xpOf(SKILLS.map((_, k) => Math.floor(total / 5) + (k < total % 5 ? 1 : 0)));

describe("the hat, as drawn", () => {
  it("puts every shape's top at the same height for the same total, and its bands with it", () => {
    for (const total of [5, 28, 57, 105, 227, 495]) {
      const xp = xpForTotal(total);
      expect(totalLevel(xp)).toBe(total);
      for (let id = 1; id <= HOOD_SHAPES.length; id++) {
        const hat = hatOf(id, xp);
        expect(hat.height, `${looks(id).hood} at ${total}`).toBeCloseTo(HOOD_TOP + riseFor(xp), 1);
        expect(hat.bands).toBe(bandsFor(xp));
      }
    }
  });

  it("is taller or has more bands on whoever has more levels, whatever the two hats' shapes", () => {
    // Residents of every shape: the capture's spread of levels, and one skill
    // or all five raised a few levels at a time.
    const profiles: number[][] = [];
    const spread = castOf(12).map(() => ({ xp: SKILLS.map(() => 0) }));
    spreadLevels(spread, (level) => XP_TABLE[level] as number);
    profiles.push(...spread.map((actor) => actor.xp));
    for (let level = 1; level <= 99; level += 7) {
      profiles.push(xpOf(SKILLS.map((_, k) => (k === 2 ? level : 1))));
      profiles.push(xpOf(SKILLS.map(() => level)));
    }
    const drawn = profiles.flatMap((xp, n) =>
      // Each profile on residents of all four shapes, with different ids each time.
      [1, 2, 3, 4].map((shape) => {
        const id = shape + 4 * n;
        return { id, total: totalLevel(xp), ...hatOf(id, xp) };
      }),
    );
    expect(new Set(drawn.map((each) => looks(each.id).hood)).size).toBe(4);
    let pairs = 0;
    for (const a of drawn)
      for (const b of drawn) {
        if (a.total <= b.total) continue;
        pairs++;
        const reads = a.height > b.height + 1e-6 || a.bands > b.bands;
        expect(
          reads,
          `${looks(a.id).hood} at ${a.total} against ${looks(b.id).hood} at ${b.total}`,
        ).toBe(true);
      }
    expect(pairs).toBeGreaterThan(10000);
  });

  it("keeps each band inside its hat, and the tallest hat inside a portrait's row", () => {
    for (const [n, total] of BAND_TOTALS.entries()) {
      // The least total with n + 1 bands.
      const xp = xpForTotal(total);
      expect(bandsFor(xp)).toBe(n + 1);
      const bandTop = BAND_FOOT + BAND_HEIGHT + n * BAND_PITCH;
      expect(bandTop, `band ${n + 1}`).toBeLessThan(HOOD_TOP + riseFor(xp) - 1);
    }
    // On the page a portrait at scale 1.5 stands with its feet 90 pixels below the row's rule.
    const tallest = partsFor({ id: 1, xp: xpOf(SKILLS.map(() => 99)) });
    expect(tallest.rise).toBe(RISE_MAX);
    expect(figureTop({ ...tallest, kit: NO_KIT }) * 1.5).toBeLessThanOrEqual(90);
  });
});
