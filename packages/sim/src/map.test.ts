import { describe, expect, it } from "vitest";
import { atlasOf, hashMap } from "./atlas.ts";
import { isWalkable, MapError, parseMap, place, terrainAt } from "./map.ts";
import { firstLight, rawFirstLight } from "./testing.ts";
import { createWorld } from "./world.ts";

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
  it("loads the one-map fixture: one frame, with its landmarks where they can be walked to", () => {
    const map = firstLight();
    expect([map.width, map.height]).toEqual([30, 21]);
    expect(map.places.map((p) => p.name)).toEqual([
      "bank",
      "camp",
      "deep_wood",
      "den",
      "hold",
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
    [
      "a terrain that cannot be printed",
      tiny({ legend: { ".": { toString: null }, "#": "rock" } }),
      /unknown terrain a value of type object/,
    ],
    ["a legend key of two characters", tiny({ legend: { "..": "grass" } }), /single character/],
    ["a missing row", tiny({ rows: ["..#"] }), /expected 2 rows, found 1/],
    ["a short row", tiny({ rows: ["..#", ".."] }), /row 1 must be 3 characters/],
    ["a symbol outside the legend", tiny({ rows: ["..#", ".?."] }), /row 1, column 1: "\?"/],
    [
      "a place name that is not a plain word",
      tiny({ places: { camp: { x: 0, y: 0 }, "Old Mill": { x: 1, y: 0 } } }),
      /place name "Old Mill" must be a lower-case letter/,
    ],
    ["a place on a rock", tiny({ places: { camp: { x: 2, y: 0 } } }), /not on a walkable tile/],
    ["a place off the map", tiny({ places: { camp: { x: 9, y: 9 } } }), /not on a walkable tile/],
    [
      "a place without numbers",
      tiny({ places: { camp: { x: "0", y: 0 } } }),
      /whole-number x and y/,
    ],
  ];
  for (const [what, raw, message] of rejects) {
    it(`rejects ${what}`, () => {
      expect(() => parseMap(raw)).toThrow(MapError);
      expect(() => parseMap(raw)).toThrow(message);
    });
  }

  it("leaves reachability to the world, which refuses a map with ground cut off", () => {
    // A camp is not needed: the city has none, and a world on one map need not either.
    expect(() => createWorld(parseMap(tiny({ places: { den: { x: 0, y: 0 } } })), 1)).not.toThrow();
    expect(() => atlasOf(parseMap(tiny({ rows: [".#.", ".#."] })))).not.toThrow();
    expect(() => createWorld(parseMap(tiny({ rows: [".#.", ".#."] })), 1)).toThrow(
      /map "tiny" has walkable ground that cannot be reached from the rest/,
    );
    expect(() => createWorld(parseMap(tiny({ rows: ["###", "###"], places: {} })), 1)).toThrow(
      /has no ground that can be walked on/,
    );
  });

  it("refuses the fixture once it is damaged", () => {
    const raw = rawFirstLight();
    (raw.rows as string[])[8] = "t,,,,,,....:cccLccc:::::~~::::";
    expect(() => createWorld(parseMap(raw), 1)).toThrow(/cannot be reached from the rest/);
  });
});

describe("hashMap", () => {
  it("tells maps apart by their element, and hashes a map with none as before", () => {
    const map = firstLight();
    const base = hashMap(map);
    expect(hashMap({ ...map, element: "none" })).toBe(base);
    const fire = hashMap({ ...map, element: "fire" });
    const cold = hashMap({ ...map, element: "cold" });
    const lightning = hashMap({ ...map, element: "lightning" });
    expect(new Set([base, fire, cold, lightning]).size).toBe(4);
  });
});
