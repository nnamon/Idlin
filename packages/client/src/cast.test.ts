import { describe, expect, it } from "vitest";
import { castOf, MAX_CAST, residentName } from "./cast.ts";

describe("the cast", () => {
  it("starts with the six regulars, three programs between them", () => {
    expect(castOf(6)).toEqual([
      { name: "Ash", program: "wanderer" },
      { name: "Birch", program: "homebody" },
      { name: "Cedar", program: "riverwalker" },
      { name: "Dara", program: "wanderer" },
      { name: "Elm", program: "homebody" },
      { name: "Fen", program: "riverwalker" },
    ]);
  });

  it("gives everyone in the largest cast a different short name", () => {
    const names = castOf(MAX_CAST).map((member) => member.name);
    expect(new Set(names).size).toBe(MAX_CAST);
    expect(Math.max(...names.map((name) => name.length))).toBeLessThanOrEqual(5);
    expect(residentName(6)).toBe(residentName(6));
  });

  it("keeps the count within limits", () => {
    expect(castOf(0)).toHaveLength(1);
    expect(castOf(9999)).toHaveLength(MAX_CAST);
    expect(castOf(12.9)).toHaveLength(12);
  });
});
