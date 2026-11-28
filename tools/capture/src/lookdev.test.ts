import { describe, expect, it } from "vitest";
import { makeScene, SCENES } from "../../../packages/client/src/lookdev/scenes.ts";
import { BENCH, LOOKDEV_SCENES, PLANS } from "./lookdev.ts";

describe("what the capture shoots of the look-development page", () => {
  it("names only scenes the page has, and shoots every scene of the look target", () => {
    for (const scene of LOOKDEV_SCENES) expect(SCENES).toContain(scene);
    for (const scene of [
      "deck",
      "deck150",
      "deckside",
      "reveal",
      "expedition",
      "expedition-b",
      "expedition150",
      "siege",
      "siege150",
      "shield-levels",
    ])
      expect(LOOKDEV_SCENES).toContain(scene);
    expect(LOOKDEV_SCENES).toContain(BENCH);
  });

  it("takes every still, burst and clip from inside the scene's own length", () => {
    for (const [name, plan] of Object.entries(PLANS)) {
      const { duration } = makeScene(name);
      for (const at of plan.stills) expect(at).toBeLessThan(duration);
      for (const at of [plan.burst, ...Object.values(plan.bursts ?? {})])
        expect(at + 12 / 60).toBeLessThan(duration);
      expect(plan.clip[0]).toBeLessThan(plan.clip[1]);
      expect(plan.clip[1]).toBeLessThanOrEqual(duration);
    }
  });
});
