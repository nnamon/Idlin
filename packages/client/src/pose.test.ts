import { type Actor, STEP_TICKS } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { actorPose, sunShadow } from "./pose.ts";

const actor = (over: Partial<Actor>): Actor =>
  ({
    id: 1,
    name: "Ash",
    x: 5,
    y: 5,
    fromX: 5,
    fromY: 5,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    blocked: 0,
    ...over,
    // Cast: the pose reads only the fields above, whatever else an actor carries.
  }) as Actor;

describe("actorPose", () => {
  it("stands an actor on the middle of its tile", () => {
    const pose = actorPose(actor({}), 0.4, 100);
    expect([pose.x, pose.y, pose.hop, pose.moving]).toEqual([5 * 16 + 8, 6 * 16, 0, false]);
  });

  it("moves smoothly from one tile to the next over a step, never backwards or past the end", () => {
    // A step east from (5,5) to (6,5): the sim sets moveTicksLeft to STEP_TICKS, then counts down.
    const xs: number[] = [];
    for (let left = STEP_TICKS; left >= 1; left--) {
      for (const fraction of [0, 0.25, 0.5, 0.75]) {
        xs.push(actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: left }), fraction, 0).x);
      }
    }
    expect(xs[0]).toBe(5 * 16 + 8);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] as number);
    expect(xs.at(-1)).toBeLessThan(6 * 16 + 8);
    // The largest move between two samples a quarter of a tick apart is a small part of a tile.
    const jumps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    expect(Math.max(...jumps)).toBeLessThan(2);
    // Eased: it sets off and arrives slowly, and is fastest in the middle of the step.
    const middle = jumps[Math.floor(jumps.length / 2)] as number;
    expect(jumps[0]).toBeLessThan(middle / 2);
    expect(jumps.at(-1)).toBeLessThan(middle / 2);
  });

  it("joins one step to the next without a jump", () => {
    const endOfFirst = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 1 }), 0.999, 0);
    const startOfSecond = actorPose(actor({ x: 7, fromX: 6, moveTicksLeft: STEP_TICKS }), 0, 0);
    expect(Math.abs(startOfSecond.x - endOfFirst.x)).toBeLessThan(0.01);
    expect(endOfFirst.hop).toBeLessThan(0.01);
  });

  it("stays in range for a fraction outside 0 to 1", () => {
    const early = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: STEP_TICKS }), -3, 0);
    const late = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 1 }), 7, 0);
    expect(early.x).toBe(5 * 16 + 8);
    expect(late.x).toBe(6 * 16 + 8);
    expect(early.hop).toBeCloseTo(0);
  });

  it("hops mid-step and bobs by whole pixels only when standing", () => {
    expect(actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 2 }), 0, 0).hop).toBeGreaterThan(2);
    const bobs = new Set<number>();
    for (let time = 0; time < 200; time++) {
      bobs.add(actorPose(actor({}), 0, time).bob);
      expect(actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 2 }), 0, time).bob).toBe(0);
    }
    expect([...bobs].sort()).toEqual([0, 1]);
  });
});

describe("sunShadow", () => {
  it("points west in the morning and east in the evening, shortest at noon, gone at night", () => {
    expect(sunShadow(7).direction).toBe(-1);
    expect(sunShadow(18).direction).toBe(1);
    expect(sunShadow(7).length).toBeGreaterThan(sunShadow(12.5).length + 5);
    expect(sunShadow(18).length).toBeGreaterThan(sunShadow(12.5).length + 5);
    for (const night of [0, 3, 5.5, 19.5, 22]) expect(sunShadow(night).alpha).toBe(0);
    expect(sunShadow(12).alpha).toBeGreaterThan(0.15);
  });

  it("fades in and out without a jump", () => {
    let before = sunShadow(0);
    for (let tick = 1; tick <= 24 * 600; tick++) {
      const now = sunShadow(tick / 600);
      expect(Math.abs(now.alpha - before.alpha)).toBeLessThan(0.001);
      if (now.alpha > 0.01 && before.alpha > 0.01 && now.direction === before.direction) {
        expect(Math.abs(now.length - before.length)).toBeLessThan(0.05);
      }
      before = now;
    }
  });
});
