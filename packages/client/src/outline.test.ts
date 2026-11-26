import { describe, expect, it } from "vitest";
import { type Pt, regionLoops, smoothLoop } from "./outline.ts";

const grid = (rows: string[]) => (x: number, y: number): boolean => rows[y]?.[x] === "#";
/** Twice the signed area of a loop: positive when it runs clockwise on screen (y down). */
const area2 = (loop: readonly Pt[]): number =>
  loop.reduce((sum, [x, y], i) => {
    const [nx, ny] = loop[(i + 1) % loop.length] as Pt;
    return sum + (x * ny - nx * y);
  }, 0);

describe("regionLoops", () => {
  it("traces one tile as a square, clockwise", () => {
    const loops = regionLoops(3, 3, grid(["...", ".#.", "..."]));
    expect(loops).toEqual([
      [
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
      ],
    ]);
    expect(area2(loops[0] as Pt[])).toBe(2);
  });

  it("traces an L-shaped region as one loop enclosing its area", () => {
    const loops = regionLoops(3, 3, grid(["#..", "#..", "###"]));
    expect(loops).toHaveLength(1);
    expect(area2(loops[0] as Pt[]) / 2).toBe(5);
  });

  it("gives a ring an outer loop and an inner one, and separate regions separate loops", () => {
    const ring = regionLoops(3, 3, grid(["###", "#.#", "###"]));
    expect(ring.map((l) => area2(l) / 2).sort()).toEqual([-1, 9]);
    expect(regionLoops(5, 1, grid(["#.#.#"]))).toHaveLength(3);
  });

  it("keeps two tiles that touch only at a corner as two simple loops", () => {
    const loops = regionLoops(2, 2, grid(["#.", ".#"]));
    expect(loops.map((l) => l.length)).toEqual([4, 4]);
  });

  it("follows the map edge where the region runs off it, and returns nothing for no region", () => {
    const loops = regionLoops(2, 2, grid(["##", "##"]));
    expect(area2(loops[0] as Pt[]) / 2).toBe(4);
    expect(regionLoops(2, 2, () => false)).toEqual([]);
  });

  it("is the same every time", () => {
    const rows = ["..##.", ".###.", "##..#", ".#.##"];
    expect(regionLoops(5, 4, grid(rows))).toEqual(regionLoops(5, 4, grid(rows)));
  });
});

describe("smoothLoop", () => {
  it("cuts the corners of a square, staying inside it and keeping most of its area", () => {
    const square: Pt[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const round = smoothLoop(square, 2);
    expect(round).toHaveLength(16);
    for (const [x, y] of round) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(4);
    }
    expect(area2(round) / 2).toBeGreaterThan(13);
    expect(area2(round) / 2).toBeLessThan(16);
    expect(smoothLoop(square, 0)).toEqual(square);
  });
});
