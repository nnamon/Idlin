import { describe, expect, it } from "vitest";
import { BAR_WIDTH, hpFill } from "./stats.ts";

describe("a hitpoint bar", () => {
  it("is full and plain at full hitpoints, and drawn as hurt for anything less", () => {
    expect(hpFill(20, 20)).toEqual({ width: BAR_WIDTH, hurt: false });
    // One hitpoint down already shows: a different colour and a sliver of paper.
    expect(hpFill(19, 20)).toEqual({ width: 38, hurt: true });
    expect(hpFill(7, 20)).toEqual({ width: 14, hurt: true });
  });

  it("is empty when down, and never runs past either end", () => {
    expect(hpFill(0, 20)).toEqual({ width: 0, hurt: true });
    expect(hpFill(-6, 20)).toEqual({ width: 0, hurt: true });
    expect(hpFill(25, 20)).toEqual({ width: BAR_WIDTH, hurt: false });
    expect(hpFill(5, 0)).toEqual({ width: 0, hurt: true });
  });
});
