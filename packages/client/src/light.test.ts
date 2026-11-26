import { describe, expect, it } from "vitest";
import {
  DAYBREAK,
  dayAt,
  dayInk,
  daylight,
  dayRegion,
  EDGE,
  LAMP_CORE,
  LAMP_KNEE,
  LAMP_KNEE_LEVEL,
  lampAt,
  lampStrength,
  NIGHTFALL,
  pageDay,
  phaseName,
  skyCast,
  TURN_HOURS,
} from "./light.ts";

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

  it("night closes in on the lantern and day spreads out from it, quickly and without a jump", () => {
    const reach = 1700;
    expect(dayRegion(12, reach)).toEqual({ kind: "all" });
    expect(dayRegion(1, reach)).toEqual({ kind: "none" });
    expect(dayRegion(DAYBREAK - 0.01, reach)).toEqual({ kind: "none" });
    expect(dayRegion(NIGHTFALL - 0.01, reach)).toEqual({ kind: "all" });
    const radius = (hour: number): number => {
      const region = dayRegion(hour, reach);
      return region.kind === "circle" ? region.radius : region.kind === "all" ? reach : -EDGE;
    };
    // Nightfall: from all of the frame down to nothing.
    expect(radius(NIGHTFALL)).toBeCloseTo(reach);
    expect(radius(NIGHTFALL + TURN_HOURS - 0.0001)).toBeLessThan(-EDGE + 1);
    for (let h = NIGHTFALL + 0.02; h < NIGHTFALL + TURN_HOURS; h += 0.02)
      expect(radius(h)).toBeLessThan(radius(h - 0.02));
    // Daybreak: the other way.
    expect(radius(DAYBREAK)).toBe(-EDGE);
    expect(radius(DAYBREAK + TURN_HOURS - 0.0001)).toBeGreaterThan(reach - 1);
    for (let h = DAYBREAK + 0.02; h < DAYBREAK + TURN_HOURS; h += 0.02)
      expect(radius(h)).toBeGreaterThan(radius(h - 0.02));
    // The edge never moves more than a few pixels in a tick, round the whole day.
    for (let tick = 1; tick <= 24 * 600; tick++) {
      expect(
        Math.abs(radius(tick * HOURS_PER_TICK) - radius((tick - 1) * HOURS_PER_TICK)),
      ).toBeLessThan(9);
    }
    // It is over in under a minute of stream time, and the lamps are fully lit before it starts.
    expect(TURN_HOURS * 60).toBeLessThan(60);
    expect(lampStrength(NIGHTFALL)).toBe(1);
    expect(lampStrength(DAYBREAK)).toBe(1);
  });

  it("turns the page beside the map all at once, halfway through, over a few seconds", () => {
    expect(pageDay(12)).toBe(1);
    expect(pageDay(1)).toBe(0);
    expect(pageDay(NIGHTFALL)).toBe(1);
    expect(pageDay(NIGHTFALL + TURN_HOURS - 0.001)).toBe(0);
    expect(pageDay(DAYBREAK)).toBe(0);
    expect(pageDay(DAYBREAK + TURN_HOURS - 0.001)).toBe(1);
    expect(pageDay(NIGHTFALL + TURN_HOURS / 2)).toBeCloseTo(0.5);
    let changing = 0;
    for (let tick = 1; tick <= 24 * 600; tick++) {
      const step = Math.abs(pageDay(tick * HOURS_PER_TICK) - pageDay((tick - 1) * HOURS_PER_TICK));
      // Slow enough that no tick changes the page's brightness sharply.
      expect(step).toBeLessThan(0.06);
      if (step > 0) changing++;
    }
    // Two turns of about thirty ticks each.
    expect(changing).toBeGreaterThan(50);
    expect(changing).toBeLessThan(70);
  });

  it("says how lit a point is, the way the picture is drawn", () => {
    expect(dayAt({ kind: "all" }, 500)).toBe(1);
    expect(dayAt({ kind: "none" }, 0)).toBe(0);
    const region = { kind: "circle", radius: 400 } as const;
    expect(dayAt(region, 100)).toBe(1);
    expect(dayAt(region, 400 + EDGE / 2)).toBeCloseTo(0.5);
    expect(dayAt(region, 400 + EDGE)).toBe(0);
    // A region that has shrunk past nothing: only the fading rim is left at the centre.
    const rim = { kind: "circle", radius: -EDGE / 2 } as const;
    expect(dayAt(rim, 0)).toBe(1);
    expect(dayAt(rim, EDGE / 4)).toBeCloseTo(0.5);
    expect(dayAt(rim, EDGE / 2)).toBe(0);
    expect(dayAt({ kind: "circle", radius: -EDGE }, 0)).toBe(0);
  });

  it("throws lamplight along the same stops the picture's gradient uses", () => {
    expect(lampAt(0, 100, 0.8)).toBe(0.8);
    expect(lampAt(100 * LAMP_CORE, 100, 0.8)).toBe(0.8);
    // The knee sits LAMP_KNEE of the way from the core to the rim, as a gradient stop does.
    const knee = 100 * (LAMP_CORE + LAMP_KNEE * (1 - LAMP_CORE));
    expect(knee).toBeCloseTo(60.4);
    expect(lampAt(knee, 100, 1)).toBeCloseTo(LAMP_KNEE_LEVEL);
    // Halfway from the core to the knee, and from the knee to the rim: straight lines between stops.
    expect(lampAt((12 + knee) / 2, 100, 1)).toBeCloseTo((1 + LAMP_KNEE_LEVEL) / 2);
    expect(lampAt((knee + 100) / 2, 100, 1)).toBeCloseTo(LAMP_KNEE_LEVEL / 2);
    expect(lampAt(100, 100, 1)).toBe(0);
    expect(lampAt(150, 100, 1)).toBe(0);
    for (let d = 1; d <= 100; d++)
      expect(lampAt(d, 100, 1)).toBeLessThanOrEqual(lampAt(d - 1, 100, 1));
  });

  it("keeps lettering in the ink it had until the light is clearly past the middle", () => {
    expect(dayInk(0.51, undefined)).toBe(true);
    expect(dayInk(0.49, undefined)).toBe(false);
    // Light wavering round the middle changes nothing.
    for (const lit of [0.45, 0.55, 0.48, 0.59, 0.41]) {
      expect(dayInk(lit, true)).toBe(true);
      expect(dayInk(lit, false)).toBe(false);
    }
    expect(dayInk(0.39, true)).toBe(false);
    expect(dayInk(0.61, false)).toBe(true);
  });

  it("names the parts of the day", () => {
    // Dawn ends once the light is nearly full, not an hour after.
    expect(phaseName(6.7)).toBe("dawn");
    expect(phaseName(6.8)).toBe("morning");
    expect([2, 6, 9, 12, 15, 19, 22].map(phaseName)).toEqual([
      "night",
      "dawn",
      "morning",
      "about noon",
      "afternoon",
      "dusk",
      "night",
    ]);
  });
});
