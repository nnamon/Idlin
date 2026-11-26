import { TICKS_PER_GAME_HOUR } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { ambientAt, lampStrength, phaseName, washAt } from "./light.ts";

const TICKS_PER_HOUR = TICKS_PER_GAME_HOUR;

describe("the light of the day", () => {
  it("never jumps: from one tick to the next the ambient light barely moves", () => {
    let before = ambientAt(0);
    for (let tick = 1; tick <= 24 * TICKS_PER_HOUR; tick++) {
      const now = ambientAt((tick / TICKS_PER_HOUR) % 24);
      for (const k of [0, 1, 2] as const) expect(Math.abs(now[k] - before[k])).toBeLessThan(0.002);
      before = now;
    }
  });

  it("keeps the night readable and the day at full light", () => {
    for (let hour = 0; hour < 24; hour += 0.25) {
      const [r, g, b] = ambientAt(hour);
      expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(0.3);
      expect(Math.max(r, g, b)).toBeLessThanOrEqual(1);
    }
    expect(ambientAt(12)).toEqual([1, 1, 1]);
    expect(ambientAt(2)[2]).toBeGreaterThan(ambientAt(2)[0]);
  });

  it("lights the lamps at night and puts them out by day", () => {
    expect(lampStrength(12)).toBe(0);
    expect(lampStrength(0)).toBe(1);
    expect(lampStrength(19.5)).toBeGreaterThan(0);
    expect(lampStrength(19.5)).toBeLessThan(1);
  });

  it("names the parts of the day", () => {
    expect([2, 6, 12, 19, 22].map(phaseName)).toEqual(["Night", "Dawn", "Day", "Dusk", "Night"]);
  });
});

describe("the colour wash", () => {
  it("is strongest at dawn and dusk, gone by day, and never jumps", () => {
    expect(washAt(12).alpha).toBe(0);
    expect(washAt(6.2).alpha).toBeGreaterThan(washAt(1).alpha);
    expect(washAt(18.8).alpha).toBeGreaterThan(washAt(1).alpha);
    // Dawn leans pink (more blue than green), dusk leans amber (more green than blue).
    expect(washAt(6.2).color[2]).toBeGreaterThan(washAt(6.2).color[1]);
    expect(washAt(18.8).color[1]).toBeGreaterThan(washAt(18.8).color[2]);
    let before = washAt(0);
    for (let tick = 1; tick <= 24 * TICKS_PER_HOUR; tick++) {
      const now = washAt((tick / TICKS_PER_HOUR) % 24);
      expect(Math.abs(now.alpha - before.alpha)).toBeLessThan(0.001);
      for (const k of [0, 1, 2] as const)
        expect(Math.abs(now.color[k] - before.color[k])).toBeLessThan(0.005);
      before = now;
    }
  });
});
