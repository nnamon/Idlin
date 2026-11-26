import { describe, expect, it } from "vitest";
import { DAYBREAK, NIGHTFALL, pageDay, TURN_HOURS } from "./light.ts";
import { contrast, DAY, NIGHT, pagePalette } from "./palette.ts";

/** Game hours per tick: a tick is a tenth of a second and an hour lasts a minute. */
const HOURS_PER_TICK = 1 / 600;

describe("the page's inks", () => {
  it("keep the ink at least 3:1 to the paper at every tick of the page's turn, and between ticks", () => {
    for (const start of [NIGHTFALL, DAYBREAK]) {
      const ticks = Math.round(TURN_HOURS / HOURS_PER_TICK);
      let turning = 0;
      let worst = Number.POSITIVE_INFINITY;
      // A stream shows about six frames to a tick.
      for (let sixth = 0; sixth <= ticks * 6; sixth++) {
        const hour = start + (sixth / 6) * HOURS_PER_TICK;
        const { ink, paper } = pagePalette(hour);
        const page = pageDay(hour);
        if (page > 0 && page < 1) turning++;
        worst = Math.min(worst, contrast(ink, paper));
        expect(contrast(ink, paper), `at ${hour}`).toBeGreaterThanOrEqual(3);
      }
      // The turn itself is covered, frame by frame, and its worst frame is at the switch of ink.
      expect(turning).toBeGreaterThan(100);
      expect(worst).toBeLessThan(4);
    }
  });

  it("are the day inks by day and the night inks by night, at every tick of the day", () => {
    for (let tick = 0; tick < 24 * 600; tick++) {
      const hour = tick * HOURS_PER_TICK;
      const palette = pagePalette(hour);
      expect(contrast(palette.ink, palette.paper), `at ${hour}`).toBeGreaterThanOrEqual(3);
      const page = pageDay(hour);
      if (page === 1) expect(palette.ink).toBe(DAY.ink);
      if (page === 0) {
        expect(palette.ink).toBe(NIGHT.ink);
        expect(palette.paper).toEqual(NIGHT.paper);
      }
    }
    expect(pagePalette(12).paper).toEqual(DAY.paper);
  });

  it("lay a little of the morning's cool colour on the page's paper at 08:00", () => {
    const [r, , b] = pagePalette(8).paper;
    const [dr, , db] = DAY.paper;
    // Bluer than plain cream, but still cream.
    expect(b - r).toBeGreaterThan(db - dr);
    expect(contrast(pagePalette(8).paper, DAY.paper)).toBeLessThan(1.15);
  });
});
