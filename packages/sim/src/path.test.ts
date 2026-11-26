import { describe, expect, it } from "vitest";
import { isWalkable, parseMap, place } from "./map.ts";
import { findPath } from "./path.ts";
import { firstLight } from "./testing.ts";

const grid = (rows: string[]) =>
  parseMap({
    name: "grid",
    width: rows[0]?.length,
    height: rows.length,
    legend: { ".": "grass", "#": "rock" },
    rows,
    places: { camp: { x: 0, y: 0 } },
  });

describe("findPath", () => {
  it("returns the steps to take, ending on the target and leaving out the start", () => {
    const map = grid(["...", ".#.", "..."]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(findPath(map, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  it("walks around obstacles by a shortest way", () => {
    const map = grid([".#.", ".#.", "..."]);
    const path = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(path).toHaveLength(6);
    expect(path?.every((p) => isWalkable(map, p.x, p.y))).toBe(true);
  });

  it("breaks ties the same way every time: north, east, south, west", () => {
    const map = grid(["...", "...", "..."]);
    // Two shortest ways lead from the middle-left to the top-middle; north comes first.
    expect(findPath(map, { x: 0, y: 1 }, { x: 1, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    expect(findPath(map, { x: 0, y: 1 }, { x: 1, y: 2 })).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ]);
  });

  it("returns null, without hanging, when the target cannot be walked to or from", () => {
    const map = grid(["..#", "..#"]);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(map, { x: 2, y: 0 }, { x: 0, y: 0 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 9, y: 9 })).toBeNull();
    expect(findPath(map, { x: -1, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it("crosses the river on the shipped map only by the bridge", () => {
    const map = firstLight();
    const path = findPath(map, place(map, "camp"), place(map, "meadow"));
    expect(path).not.toBeNull();
    expect(path?.some((p) => p.x === 24 && p.y === 8)).toBe(true);
    // Each step moves exactly one tile.
    let at = place(map, "camp");
    for (const next of path ?? []) {
      expect(Math.abs(next.x - at.x) + Math.abs(next.y - at.y)).toBe(1);
      at = next;
    }
  });
});
