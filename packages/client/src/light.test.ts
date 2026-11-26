import { describe, expect, it } from "vitest";
import { ambientAt, lampStrength, phaseName } from "./light.ts";

const TICKS_PER_HOUR = 600;

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
