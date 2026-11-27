import { describe, expect, it } from "vitest";
import { area2, hash, hatchLines, knee, rng, spline, triangulate } from "./geom.ts";

const triangleArea = (xy: number[], a: number, b: number, c: number): number =>
  Math.abs(
    ((xy[b * 2] as number) - (xy[a * 2] as number)) *
      ((xy[c * 2 + 1] as number) - (xy[a * 2 + 1] as number)) -
      ((xy[c * 2] as number) - (xy[a * 2] as number)) *
        ((xy[b * 2 + 1] as number) - (xy[a * 2 + 1] as number)),
  ) / 2;

describe("triangulate", () => {
  it("covers a concave polygon exactly, whichever way it winds", () => {
    // An L: area 3.
    const shape = [0, 0, 2, 0, 2, 1, 1, 1, 1, 2, 0, 2];
    const reversed: number[] = [];
    for (let i = 5; i >= 0; i--) reversed.push(shape[i * 2] as number, shape[i * 2 + 1] as number);
    for (const xy of [shape, reversed]) {
      const out: number[] = [];
      const count = triangulate(xy, 6, out);
      expect(count).toBe(12);
      let area = 0;
      for (let i = 0; i < count; i += 3)
        area += triangleArea(xy, out[i] as number, out[i + 1] as number, out[i + 2] as number);
      expect(area).toBeCloseTo(3, 6);
      expect(Math.abs(area2(xy, 6)) / 2).toBeCloseTo(3, 6);
    }
  });

  it("gives up on a degenerate ring without hanging or leaving a hole in the list", () => {
    const line = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0];
    const out: number[] = [];
    const count = triangulate(line, 5, out);
    expect(count % 3).toBe(0);
    expect(out.every((index) => index >= 0 && index < 5)).toBe(true);
  });
});

describe("hatchLines", () => {
  it("lays parallel strokes inside the shape, the spacing apart, counted from the anchor", () => {
    const square = [0, 0, 40, 0, 40, 40, 0, 40];
    const out: number[] = [];
    const pieces = hatchLines(square, 4, 6, 0, 0, false, out);
    expect(pieces).toBeGreaterThan(6);
    for (let i = 0; i < pieces; i++) {
      const [x0, y0, x1, y1] = out.slice(i * 4, i * 4 + 4) as [number, number, number, number];
      for (const v of [x0, y0, x1, y1]) {
        expect(v).toBeGreaterThanOrEqual(-0.01);
        expect(v).toBeLessThanOrEqual(40.01);
      }
      // Falling from upper right to lower left, at sixty degrees.
      expect(Math.atan2(y1 - y0, x1 - x0)).toBeCloseTo((Math.PI * 2) / 3, 5);
    }
    // Moving the shape and the anchor together moves every stroke with it.
    const moved: number[] = [];
    hatchLines(
      square.map((v, i) => v + (i % 2 ? 7.3 : 100.6)),
      4,
      6,
      100.6,
      7.3,
      false,
      moved,
    );
    expect(moved.length).toBe(out.length);
    expect((moved[0] as number) - (out[0] as number)).toBeCloseTo(100.6, 6);
    expect((moved[1] as number) - (out[1] as number)).toBeCloseTo(7.3, 6);
  });
});

describe("knee", () => {
  it("keeps both bones their length, and bends to the side asked for", () => {
    const [kx, ky] = knee(0, 0, 120, 160, 150, 330, -1);
    expect(Math.hypot(kx, ky)).toBeCloseTo(150, 6);
    expect(Math.hypot(120 - kx, 160 - ky)).toBeCloseTo(330, 6);
    const [ox, oy] = knee(0, 0, 120, 160, 150, 330, 1);
    expect(ox).not.toBeCloseTo(kx, 1);
    expect(Math.hypot(ox, oy)).toBeCloseTo(150, 6);
  });

  it("does not break on a target out of reach or on top of the joint", () => {
    for (const [tx, ty] of [
      [5000, 0],
      [0, 0],
      [1, 1],
    ] as const) {
      const [kx, ky] = knee(0, 0, tx, ty, 150, 330, 1);
      expect(Number.isFinite(kx) && Number.isFinite(ky)).toBe(true);
      expect(Math.hypot(kx, ky)).toBeCloseTo(150, 4);
    }
  });
});

describe("spline", () => {
  it("passes through its points, and closes when asked", () => {
    const pts = [0, 0, 10, 0, 10, 10, 0, 10];
    const open: number[] = [];
    const n = spline(pts, 4, 2, false, open);
    expect(open.slice(0, 2)).toEqual([0, 0]);
    expect(open.slice(n * 2 - 2)).toEqual([0, 10]);
    const closed: number[] = [];
    const m = spline(pts, 4, 2, true, closed);
    expect(m).toBeGreaterThan(n);
    const has = (x: number, y: number): boolean => {
      for (let i = 0; i < m; i++)
        if (Math.hypot((closed[i * 2] as number) - x, (closed[i * 2 + 1] as number) - y) < 1e-9)
          return true;
      return false;
    };
    expect(has(10, 10) && has(0, 10) && has(10, 0)).toBe(true);
  });
});

describe("seeded numbers", () => {
  it("are the same for the same seed and differ between seeds", () => {
    const a = rng(7);
    const b = rng(7);
    const c = rng(8);
    const run = (next: () => number): number[] => [next(), next(), next()];
    const first = run(a);
    expect(run(b)).toEqual(first);
    expect(run(c)).not.toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(hash(3, 4, 5)).toBe(hash(3, 4, 5));
    expect(hash(3, 4, 5)).not.toBe(hash(3, 4, 6));
  });
});
