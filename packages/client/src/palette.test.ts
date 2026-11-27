import { describe, expect, it } from "vitest";
import { DAYBREAK, NIGHTFALL, pageDay, TURN_HOURS } from "./light.ts";
import {
  contrast,
  DAY,
  FAINT_CONTRAST,
  faintInk,
  INK_CONTRAST,
  NIGHT,
  pagePalette,
} from "./palette.ts";

/** Game hours per tick: a tick is a tenth of a second and an hour lasts a minute. */
const HOURS_PER_TICK = 1 / 600;

describe("the page's inks", () => {
  it("keep the ink at 7:1 and secondary lettering at 4.5:1 to the paper, every frame of the day", () => {
    let turning = 0;
    let worstInk = Number.POSITIVE_INFINITY;
    let worstFaint = Number.POSITIVE_INFINITY;
    // A stream shows about six frames to a tick; every one of them, all day.
    for (let sixth = 0; sixth < 24 * 600 * 6; sixth++) {
      const hour = (sixth / 6) * HOURS_PER_TICK;
      const palette = pagePalette(hour);
      const page = pageDay(hour);
      if (page > 0 && page < 1) turning++;
      const ink = contrast(palette.ink, palette.paper);
      const faint = contrast(faintInk(palette), palette.paper);
      worstInk = Math.min(worstInk, ink);
      worstFaint = Math.min(worstFaint, faint);
      if (ink < INK_CONTRAST) expect.fail(`ink ${ink.toFixed(2)}:1 at ${hour}`);
      if (faint < FAINT_CONTRAST) expect.fail(`secondary ${faint.toFixed(2)}:1 at ${hour}`);
      // The hurt part of a hitpoint bar is not lettering, but it must still be seen.
      const hurt = contrast(palette.wash.hatch, palette.paper);
      if (hurt < 3) expect.fail(`hurt ${hurt.toFixed(2)}:1 at ${hour}`);
    }
    // Both turns are in it, frame by frame, and the turn is where it is tightest.
    expect(turning).toBeGreaterThan(300);
    expect(worstInk).toBeLessThan(7.5);
    expect(worstFaint).toBeGreaterThanOrEqual(FAINT_CONTRAST);
  });

  it("keep the dusk and dawn turns: the paper still moves from one side to the other", () => {
    for (const start of [NIGHTFALL, DAYBREAK]) {
      const papers = new Set<string>();
      for (let sixth = 0; sixth <= Math.round(TURN_HOURS / HOURS_PER_TICK) * 6; sixth++)
        papers.add(String(pagePalette(start + (sixth / 6) * HOURS_PER_TICK).paper));
      // Not a cut from one paper to the other: it goes through shades on each side of the step.
      expect(papers.size).toBeGreaterThan(20);
    }
  });

  it("are the day inks by day and the night inks by night, at every tick of the day", () => {
    for (let tick = 0; tick < 24 * 600; tick++) {
      const hour = tick * HOURS_PER_TICK;
      const palette = pagePalette(hour);
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
