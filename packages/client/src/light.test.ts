import { describe, expect, it } from "vitest";
import { daylight, dayRegion, EDGE, lampStrength, mix, phaseName, skyCast } from "./light.ts";

/** Game hours per tick: a tick is a tenth of a second and an hour lasts a minute. */
const HOURS_PER_TICK = 1 / 600;

describe("the light of the day", () => {
  it("is full by day, gone at night, and never jumps from one tick to the next", () => {
    expect(daylight(12)).toBe(1);
    expect(daylight(9)).toBe(1);
    expect(daylight(0)).toBe(0);
    expect(daylight(23)).toBe(0);
    expect(daylight(6)).toBeGreaterThan(0.2);
    expect(daylight(6)).toBeLessThan(0.8);
    let before = daylight(0);
    for (let tick = 1; tick <= 24 * 600; tick++) {
      const now = daylight(tick * HOURS_PER_TICK);
      expect(Math.abs(now - before)).toBeLessThan(0.002);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).toBeLessThanOrEqual(1);
      before = now;
    }
  });

  it("lights the lamps as the day goes, a little before full dark", () => {
    expect(lampStrength(12)).toBe(0);
    expect(lampStrength(0)).toBe(1);
    expect(lampStrength(19)).toBeGreaterThan(0.2);
    expect(lampStrength(19)).toBeGreaterThan(1 - daylight(19));
    let before = lampStrength(0);
    for (let tick = 1; tick <= 24 * 600; tick++) {
      const now = lampStrength(tick * HOURS_PER_TICK);
      expect(Math.abs(now - before)).toBeLessThan(0.004);
      before = now;
    }
  });

  it("casts rose at dawn and amber at dusk, nothing at noon or midnight, and never jumps", () => {
    expect(skyCast(12).alpha).toBe(0);
    expect(skyCast(0).alpha).toBe(0);
    const dawn = skyCast(6);
    const dusk = skyCast(19);
    expect(dawn.alpha).toBeGreaterThan(0.15);
    expect(dusk.alpha).toBeGreaterThan(0.15);
    // Rose has more blue than green; amber has more green than blue.
    expect(dawn.color[2]).toBeGreaterThan(dawn.color[1]);
    expect(dusk.color[1]).toBeGreaterThan(dusk.color[2]);
    let before = skyCast(0).alpha;
    for (let tick = 1; tick <= 24 * 600; tick++) {
      const now = skyCast(tick * HOURS_PER_TICK).alpha;
      expect(Math.abs(now - before)).toBeLessThan(0.001);
      before = now;
    }
  });

  it("moves the edge between day and night smoothly, from all of one to all of the other", () => {
    const reach = 1700;
    const width = 1920;
    expect(dayRegion(12, reach, width)).toEqual({ kind: "all" });
    expect(dayRegion(1, reach, width)).toEqual({ kind: "none" });
    // Dawn: the light comes in from the east and ends having crossed the whole frame.
    const dawn = [5, 5.5, 6, 6.5, 7].map((hour) => dayRegion(hour, reach, width));
    expect(dawn.every((region) => region.kind === "front")).toBe(true);
    const fronts = dawn.map((region) => (region.kind === "front" ? region.x : Number.NaN));
    for (let i = 1; i < fronts.length; i++) expect(fronts[i]).toBeLessThan(fronts[i - 1] as number);
    expect(fronts[0]).toBeGreaterThan(width - EDGE);
    expect(fronts.at(-1)).toBeLessThan(0);
    // Dusk: the dark closes in on the lantern, and ends with nothing left of the day.
    const dusk = [18, 18.5, 19, 19.5, 20, 20.5].map((hour) => dayRegion(hour, reach, width));
    expect(dusk.every((region) => region.kind === "circle")).toBe(true);
    const radii = dusk.map((region) => (region.kind === "circle" ? region.radius : Number.NaN));
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeLessThan(radii[i - 1] as number);
    expect(radii[0]).toBeGreaterThan(reach - EDGE);
    expect(radii.at(-1)).toBeLessThan(0);
    // No jump from one tick to the next, including where the edge starts and stops.
    const where = (hour: number): number => {
      const region = dayRegion(hour, reach, width);
      if (region.kind === "circle") return region.radius;
      if (region.kind === "front") return region.x;
      return Number.NaN;
    };
    for (let tick = 1; tick <= 24 * 600; tick++) {
      const a = where((tick - 1) * HOURS_PER_TICK);
      const b = where(tick * HOURS_PER_TICK);
      if (!Number.isNaN(a) && !Number.isNaN(b)) expect(Math.abs(b - a)).toBeLessThan(8);
    }
  });

  it("names the parts of the day and blends colours", () => {
    expect([2, 6, 9, 12, 15, 19, 22].map(phaseName)).toEqual([
      "night",
      "dawn",
      "morning",
      "about noon",
      "afternoon",
      "dusk",
      "night",
    ]);
    expect(mix([0, 0, 0], [1, 0.5, 0], 0.5)).toEqual([0.5, 0.25, 0]);
  });
});
