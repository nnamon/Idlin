import { describe, expect, it } from "vitest";
import { DEATH_SPREAD, spreadDeaths } from "./cast.ts";
import { drawFigure, MAX_PATCHES, PATCH_SPOTS, patchesFor } from "./figure.ts";
import { partsFor } from "./looks.ts";
import type { Ctx } from "./pen.ts";
import type { Pose } from "./pose.ts";

const STANDING: Pose = {
  x: 0,
  y: 0,
  hop: 0,
  stride: 0.5,
  breath: 0,
  moving: false,
  walk: 0,
  resting: false,
  sit: 0,
  lean: 0,
  stoop: 0,
  squash: 0,
};

/** A context that records the rectangles drawn on it and ignores everything else. */
const recorder = (): { ctx: Ctx; rects: number } => {
  const seen = { rects: 0 };
  const ctx = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "rect"
          ? () => {
              seen.rects++;
            }
          : key === "globalAlpha"
            ? 1
            : () => undefined,
      set: () => true,
    },
  ) as Ctx;
  return {
    ctx,
    get rects() {
      return seen.rects;
    },
  };
};

const rectsFor = (deaths: number | undefined): number => {
  const record = recorder();
  // Id 2 has a plain cloak, so the only rectangles drawn are patches.
  const style = { ...partsFor(2), cloak: "c", hood: "h", ink: "i", paper: "p" };
  const counted = deaths === undefined ? {} : { deaths };
  drawFigure(record.ctx, 0, 0, STANDING, { ...style, facing: 1, scale: 1, ...counted }, 0);
  return record.rects;
};

describe("patches", () => {
  it("are one per death up to MAX_PATCHES, and none for a count that is not a number", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 99].map(patchesFor)).toEqual([0, 1, 2, 3, 4, 5, 5, 5]);
    for (const odd of [undefined, -3, Number.NaN, Number.POSITIVE_INFINITY])
      expect(patchesFor(odd)).toBe(0);
    expect(patchesFor(2.7)).toBe(2);
  });

  it("are each drawn, in a place of their own", () => {
    expect(PATCH_SPOTS).toHaveLength(MAX_PATCHES);
    expect(new Set(PATCH_SPOTS.map((s) => `${s.x},${s.y}`)).size).toBe(MAX_PATCHES);
    const none = rectsFor(undefined);
    expect(rectsFor(0)).toBe(none);
    // Each patch is two rectangles: the cloth, and the stitching inside its edge.
    for (const deaths of [1, 3, 5, 9]) expect(rectsFor(deaths) - none).toBe(2 * patchesFor(deaths));
  });

  it("are spread over the residents for captures as DEATH_SPREAD says", () => {
    const actors = Array.from({ length: 7 }, () => ({ deaths: 0 }));
    spreadDeaths(actors);
    expect(actors.map((a) => a.deaths)).toEqual([0, 1, 3, 5, 9, 0, 1]);
    expect(DEATH_SPREAD.map(patchesFor)).toEqual([0, 1, 3, 5, 5]);
  });
});
