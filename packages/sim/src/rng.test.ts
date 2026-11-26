import { describe, expect, it } from "vitest";
import { chance, createRng, nextInt, nextU32 } from "./rng.ts";

const take = (seed: number, n: number): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => nextU32(rng));
};

describe("rng", () => {
  // Pinned outputs. Every saved world and every replay depends on this exact
  // sequence, so a change to the algorithm, its constants or the seeding must
  // fail here and be made on purpose.
  it("produces the pinned sequence for fixed seeds", () => {
    expect(take(0, 6)).toEqual([
      0x23427724, 0xa326e0cb, 0x066a84ca, 0x4fc89f56, 0x94fffb63, 0xa38c1db3,
    ]);
    expect(take(1, 6)).toEqual([
      0x2f3d1c4a, 0xbfa66005, 0x098cf040, 0x449b7e4f, 0x76a3ace2, 0x1040b53d,
    ]);
    expect(take(119066, 6)).toEqual([
      0x41825864, 0x6d957dd1, 0x8dcb1b28, 0xccdfb4d8, 0x65018d03, 0xe84a2d78,
    ]);
  });

  it("keeps its whole state in four 32-bit integers that survive a JSON round trip", () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) nextU32(rng);
    for (const word of [rng.a, rng.b, rng.c, rng.d]) {
      expect(Number.isInteger(word)).toBe(true);
      expect(word).toBe(word | 0);
    }
    const restored = JSON.parse(JSON.stringify(rng));
    const expected = Array.from({ length: 50 }, () => nextU32(rng));
    expect(Array.from({ length: 50 }, () => nextU32(restored))).toEqual(expected);
  });

  it("treats seeds as 32-bit integers", () => {
    expect(take(0x1_0000_0001, 4)).toEqual(take(1, 4));
    expect(take(-1, 4)).toEqual(take(0xffffffff, 4));
    expect(take(1, 4)).not.toEqual(take(2, 4));
  });

  it("nextInt stays in range and covers it evenly", () => {
    const rng = createRng(7);
    const counts = new Array<number>(6).fill(0);
    const draws = 60_000;
    for (let i = 0; i < draws; i++) {
      const x = nextInt(rng, 6);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(6);
      counts[x] = (counts[x] ?? 0) + 1;
    }
    // Each face expects 10,000; a deviation of 400 is four standard deviations.
    for (const count of counts) expect(Math.abs(count - draws / 6)).toBeLessThan(400);
  });

  it("nextInt handles the edges of its range", () => {
    const rng = createRng(3);
    for (let i = 0; i < 100; i++) expect(nextInt(rng, 1)).toBe(0);
    const a = createRng(9);
    const b = createRng(9);
    expect(nextInt(a, 0x1_0000_0000)).toBe(nextU32(b));
  });

  it("nextInt redraws when the first draw falls in the biased tail", () => {
    // This state makes the next raw output 0xfffffffc, the first value at or
    // above the limit for a bound of 6 (2^32 - 2^32 % 6). Without the redraw
    // the result would be 0xfffffffc % 6 = 0.
    const rng = { a: -4, b: 0, c: 0, d: 0 };
    const twin = { ...rng };
    expect(nextU32(twin)).toBe(0xfffffffc);
    const second = nextU32(twin);
    expect(second).toBeLessThan(0xfffffffc);
    expect(nextInt(rng, 6)).toBe(second % 6);
    expect(rng).toEqual(twin);
  });

  it("the counter wraps inside the 32-bit signed range", () => {
    const rng = { a: 1, b: 2, c: 3, d: 0x7fffffff };
    nextU32(rng);
    expect(rng.d).toBe(-0x80000000);
  });

  it("chance rejects numerators that are not a count out of the denominator", () => {
    const rng = createRng(1);
    for (const bad of [0.5, -1, 11, Number.NaN]) {
      expect(() => chance(rng, bad, 10)).toThrow(RangeError);
    }
  });

  it("nextInt rejects bounds it cannot honour", () => {
    const rng = createRng(1);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 0x1_0000_0001]) {
      expect(() => nextInt(rng, bad)).toThrow(RangeError);
    }
  });

  it("chance is certain at the extremes and close to its ratio between them", () => {
    const rng = createRng(11);
    let hits = 0;
    for (let i = 0; i < 40_000; i++) {
      expect(chance(rng, 0, 10)).toBe(false);
      expect(chance(rng, 10, 10)).toBe(true);
      if (chance(rng, 1, 4)) hits++;
    }
    // Expect 10,000; a deviation of 350 is four standard deviations.
    expect(Math.abs(hits - 10_000)).toBeLessThan(350);
  });
});
