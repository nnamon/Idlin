import { describe, expect, it } from "vitest";
import { COLOURS, HOODS, identity, PAIRS } from "./identity.ts";

const rgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
const apart = (a: string, b: string): number => {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};
const hex = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;

describe("telling residents apart", () => {
  it("gives the first 56 residents 56 different pairs, hood never the same as cloak", () => {
    expect(PAIRS).toBe(56);
    const seen = new Set<string>();
    for (let id = 1; id <= PAIRS; id++) {
      const { hood, cloak } = identity(id);
      expect(hood).not.toBe(cloak);
      seen.add(`${hood}/${cloak}`);
    }
    expect(seen.size).toBe(56);
  });

  it("keeps the first six residents' cloaks (the teal a little lighter)", () => {
    expect([1, 2, 3, 4, 5, 6].map((id) => identity(id).cloak)).toEqual([
      "#c8442f",
      "#2f6fb0",
      "#d79a1e",
      "#3f8f5a",
      "#7d4fa3",
      "#3fb0b0",
    ]);
  });

  it("uses colours far enough apart to tell at a glance", () => {
    for (const set of [COLOURS, HOODS])
      for (let i = 0; i < set.length; i++)
        for (let k = i + 1; k < set.length; k++)
          expect(apart(hex(set[i] as number), hex(set[k] as number))).toBeGreaterThan(60);
    // Each hood is as far from the cloak it sits on.
    for (let id = 1; id <= PAIRS; id++) {
      const { hood, cloak } = identity(id);
      expect(apart(hood, cloak)).toBeGreaterThan(60);
    }
  });

  it("draws no hood in the colour of the faces, the paper's cream", () => {
    for (const hood of HOODS) expect(apart(hex(hood), "#f1e6cd")).toBeGreaterThan(80);
  });

  it("always answers, whatever the id", () => {
    for (const id of [0, -3, 57, 1000, 2.5, Number.MAX_SAFE_INTEGER])
      expect(identity(id).hood).toMatch(/^#[0-9a-f]{6}$/);
    expect(identity(57)).toEqual(identity(1));
  });
});
