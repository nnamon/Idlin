import { describe, expect, it } from "vitest";
import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  fitFrame,
  MAX_FRAME_HEIGHT,
  MAX_FRAME_WIDTH,
  pageHeight,
} from "./frame.ts";

// The shipped map: 30 by 21 tiles of 48 pixels.
const MAP = [1440, 1008] as const;
const fit = (width: number, height: number) => fitFrame(width, height, ...MAP);
const PLAIN = { width: 1920, height: 1080, below: false, columns: 1 };

describe("fitting the frame to a window", () => {
  it("is the plain frame in a 16:9 window, at any size", () => {
    expect(fit(1920, 1080)).toEqual({ ...PLAIN, scale: 1 });
    expect(fit(960, 540)).toEqual({ ...PLAIN, scale: 0.5 });
    expect(fit(3840, 2160)).toEqual({ ...PLAIN, scale: 2 });
    expect(fit(640, 360)).toMatchObject(PLAIN);
  });

  it("in a wide window, makes the map as tall as the window and gives the page the rest", () => {
    // The operator's window: 1920 by 955.
    const wide = fit(1920, 955);
    expect(wide).toMatchObject({ below: false, height: 1008 });
    expect(wide.scale).toBeCloseTo(955 / 1008);
    expect(wide.width).toBeGreaterThan(2020);
    // Slightly wider than 16:9: the frame loses some of the room below the map and nothing else.
    expect(fit(1920, 1040)).toEqual({
      width: 1920,
      height: 1040,
      scale: 1,
      below: false,
      columns: 1,
    });
    // Very wide: still the map at full height.
    expect(fit(3440, 1000)).toMatchObject({ below: false, height: 1008 });
  });

  it("in a tall window, puts the page below the map in as many columns as fill it best", () => {
    const square = fit(1200, 1200);
    expect(square).toMatchObject({ below: true, columns: 3 });
    expect(square.height).toBeGreaterThanOrEqual(MAP[1] + pageHeight(3));
    const tall = fit(1000, 1400);
    expect(tall).toMatchObject({ below: true, columns: 2, width: 1440 });
    expect(tall.scale).toBeCloseTo(1000 / 1440);
    const phone = fit(390, 844);
    expect(phone).toMatchObject({ below: true, columns: 1, width: 1440 });
    // The map is larger than it would be with the page beside it.
    expect(tall.scale).toBeGreaterThan(1000 / 1920);
    // One column would not fit at that size; two leave about a seventh of the window empty.
    expect((MAP[1] + pageHeight(1)) * tall.scale).toBeGreaterThan(1400);
    expect((MAP[1] + pageHeight(2)) * tall.scale).toBeGreaterThan(1400 * 0.84);
  });

  it("always covers the window, with no more than a pixel to spare", () => {
    for (const [w, h] of [
      [1920, 955],
      [1000, 1400],
      [1366, 768],
      [2560, 1080],
      [390, 844],
      [1921, 1080],
      [1200, 1200],
      [1300, 1200],
      [777, 913],
    ] as const) {
      const f = fit(w, h);
      expect(f.width * f.scale).toBeGreaterThanOrEqual(w - 1e-6);
      expect(f.height * f.scale).toBeGreaterThanOrEqual(h - 1e-6);
      expect(f.width * f.scale).toBeLessThan(w + 1.5);
      expect(f.height * f.scale).toBeLessThan(h + 1.5);
      // The map and the page both fit inside the frame.
      expect(f.width).toBeGreaterThanOrEqual(f.below ? MAP[0] : FRAME_WIDTH);
      expect(f.height).toBeGreaterThanOrEqual(f.below ? MAP[1] + pageHeight(f.columns) : MAP[1]);
    }
  });

  it("stops growing at a size a browser can still draw", () => {
    // Windows no one has, but a docked panel can make: the frame is capped and a bar shows.
    for (const [w, h] of [
      [100, 1800],
      [1, 1000],
      [300, 3000],
      [5000, 100],
      [4000, 1],
    ] as const) {
      const f = fit(w, h);
      expect(f.width).toBeLessThanOrEqual(MAX_FRAME_WIDTH);
      expect(f.height).toBeLessThanOrEqual(MAX_FRAME_HEIGHT);
      expect(f.width).toBeGreaterThanOrEqual(MAP[0]);
      expect(f.height).toBeGreaterThanOrEqual(MAP[1]);
    }
    // The cap is well clear of ordinary windows.
    expect(fit(390, 844).height).toBeLessThan(MAX_FRAME_HEIGHT);
    expect(fit(3440, 1440).width).toBeLessThan(MAX_FRAME_WIDTH);
  });

  it("gives the plain frame to a window or a map with no size", () => {
    expect(fit(0, 0)).toEqual({ ...PLAIN, scale: 1 });
    expect(fit(Number.NaN, 500)).toEqual({ ...PLAIN, scale: 1 });
    expect(fitFrame(1920, 1080, 0, 0)).toEqual({ ...PLAIN, scale: 1 });
    expect(fitFrame(1920, 1080)).toMatchObject({ width: FRAME_WIDTH, height: FRAME_HEIGHT });
  });
});
