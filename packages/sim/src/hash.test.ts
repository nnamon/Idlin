import { describe, expect, it } from "vitest";
import { hashInts, isInt32, show, stringInts } from "./hash.ts";

describe("hash helpers", () => {
  it("tells apart strings that differ only in the second half of a character pair", () => {
    expect(stringInts("😀")).not.toEqual(stringInts("😁"));
    expect(hashInts(stringInts("😀"))).not.toBe(hashInts(stringInts("😁")));
    expect(stringInts("ab")).toEqual([2, 97, 98]);
  });

  it("hashes order and value, as 16 hex digits", () => {
    expect(hashInts([1, 2])).toMatch(/^[0-9a-f]{16}$/);
    expect(hashInts([1, 2])).not.toBe(hashInts([2, 1]));
    expect(hashInts([])).not.toBe(hashInts([0]));
  });

  it("show never throws", () => {
    expect(show({ toString: null })).toBe("a value of type object");
    expect(show("x")).toBe('"x"');
    expect(show(null)).toBe("null");
    expect(show([1])).toBe("a list");
    expect(show(3)).toBe("3");
  });

  it("isInt32 accepts only whole numbers that fit in 32 bits", () => {
    for (const ok of [0, -1, 2 ** 31 - 1, -(2 ** 31)]) expect(isInt32(ok)).toBe(true);
    for (const bad of [2 ** 31, 2 ** 32 + 1, 0.5, Number.NaN, "1", null])
      expect(isInt32(bad)).toBe(false);
  });
});
