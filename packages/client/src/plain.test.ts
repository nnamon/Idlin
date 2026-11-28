import { createCity, deckGround, step, type World } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { shippedPrograms } from "../../sim/src/testing.ts";
import { clock, HEIGHT, headline, layoutOf, WIDTH } from "./plain.ts";

const city = (ticks: number, inputs = 0): World => {
  const world = createCity(3, shippedPrograms());
  step(
    world,
    Array.from({ length: inputs }, (_, i) => ({
      type: "join" as const,
      account: String(10 + i),
      name: `chatter_${i}`,
      role: "viewer" as const,
    })),
  );
  while (world.tick < ticks) step(world);
  return world;
};

describe("the plain view", () => {
  it("fits the deck, and every landing, in the frame under the line along the top", () => {
    const deck = layoutOf(deckGround(1));
    expect(deck.tile).toBe(Math.floor((WIDTH - 48) / 13));
    expect(deck.left + 13 * deck.tile).toBeLessThanOrEqual(WIDTH);
    const landed = city(1800).atlas;
    const { tile, left, top } = layoutOf(landed);
    expect(tile).toBeGreaterThanOrEqual(20);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(72);
    expect(top + tile * landed.height).toBeLessThanOrEqual(HEIGHT);
    expect(left + tile * landed.width).toBeLessThanOrEqual(WIDTH);
  });

  it("writes the beat and the time to the next, but no time to the break", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(1800)).toBe("3:00");
    expect(clock(1)).toBe("0:01");
    const transit = city(10, 2);
    expect(headline(transit)).toMatch(/^cycle 1 {3}transit {3}0:59 {3}(small|medium|large) /);
    expect(headline(transit)).toMatch(/level 1 {3}2 citizens$/);
    expect(headline(city(2500))).toMatch(/^cycle 1 {3}peace {3}2:20 /);
    // The siege ends when the shield breaks, which nothing counts to yet.
    expect(headline(city(6500))).toMatch(/^cycle 1 {3}the siege {3}(small|medium|large) /);
  });
});
