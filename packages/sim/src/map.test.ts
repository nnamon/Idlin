import { describe, expect, it } from "vitest";
import { isWalkable, MapError, parseMap, place, terrainAt } from "./map.ts";
import { firstLight, rawFirstLight } from "./testing.ts";

const tiny = (overrides: Record<string, unknown> = {}) => ({
  name: "tiny",
  width: 3,
  height: 2,
  legend: { ".": "grass", "#": "rock" },
  rows: ["..#", "..."],
  places: { camp: { x: 0, y: 0 } },
  ...overrides,
});

describe("parseMap", () => {
  it("loads the shipped map: one frame, with its landmarks where they can be walked to", () => {
    const map = firstLight();
    expect([map.width, map.height]).toEqual([30, 21]);
    expect(map.places.map((p) => p.name)).toEqual([
      "bank",
      "camp",
      "deep_wood",
      "den",
      "meadow",
      "near_wood",
      "river",
    ]);
    expect(terrainAt(map, 15, 8)).toBe("lantern");
    expect(isWalkable(map, 15, 8)).toBe(false);
    expect(terrainAt(map, 24, 8)).toBe("bridge");
    expect(isWalkable(map, 24, 8)).toBe(true);
    expect(terrainAt(map, place(map, "den").x, place(map, "den").y)).toBe("den");
  });

  it("reads tiles row by row and treats the outside as unwalkable", () => {
    const map = parseMap(tiny());
    expect(terrainAt(map, 2, 0)).toBe("rock");
    expect(isWalkable(map, 2, 0)).toBe(false);
    expect(isWalkable(map, 2, 1)).toBe(true);
    expect(isWalkable(map, -1, 0)).toBe(false);
    expect(isWalkable(map, 0, 2)).toBe(false);
    expect(() => terrainAt(map, 3, 0)).toThrow(RangeError);
  });

  const rejects: [string, unknown, RegExp][] = [
    ["something that is not an object", "map", /must be an object/],
    ["a missing name", tiny({ name: "" }), /needs a name/],
    ["a fractional size", tiny({ width: 2.5 }), /whole numbers/],
    ["a map larger than the frame", tiny({ width: 31 }), /does not fit the frame/],
    [
      "an unknown terrain",
      tiny({ legend: { ".": "lava", "#": "rock" } }),
      /unknown terrain "lava"/,
    ],
    ["a legend key of two characters", tiny({ legend: { "..": "grass" } }), /single character/],
    ["a missing row", tiny({ rows: ["..#"] }), /expected 2 rows, found 1/],
    ["a short row", tiny({ rows: ["..#", ".."] }), /row 1 must be 3 characters/],
    ["a symbol outside the legend", tiny({ rows: ["..#", ".?."] }), /row 1, column 1: "\?"/],
    ["no camp", tiny({ places: { den: { x: 0, y: 0 } } }), /"camp" is required/],
    ["a place on a rock", tiny({ places: { camp: { x: 2, y: 0 } } }), /not on a walkable tile/],
    ["a place off the map", tiny({ places: { camp: { x: 9, y: 9 } } }), /not on a walkable tile/],
    [
      "a place without numbers",
      tiny({ places: { camp: { x: "0", y: 0 } } }),
      /whole-number x and y/,
    ],
    [
      "a walkable pocket cut off from camp",
      tiny({ rows: [".#.", ".#."] }),
      /\(2, 0\) cannot be reached from camp/,
    ],
  ];
  for (const [what, raw, message] of rejects) {
    it(`rejects ${what}`, () => {
      expect(() => parseMap(raw)).toThrow(MapError);
      expect(() => parseMap(raw)).toThrow(message);
    });
  }

  it("rejects the shipped map once it is damaged", () => {
    const raw = rawFirstLight();
    (raw.rows as string[])[8] = "t,,,,,,....:cccLccc:::::~~::::";
    expect(() => parseMap(raw)).toThrow(/cannot be reached from camp/);
  });
});
