import { type Actor, STEP_TICKS } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { actorPose, easeSit, REST_TICKS, SIT_STEP } from "./pose.ts";

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
  it("stands an actor on the middle of its tile, feet on the tile's bottom edge", () => {
    const pose = actorPose(actor({}), 0.4, 100);
    expect([pose.x, pose.y, pose.hop, pose.stride, pose.moving]).toEqual([5.5, 6, 0, 0, false]);
  });

  it("moves smoothly from one tile to the next over a step, never backwards or past the end", () => {
    // A step east from (5,5) to (6,5): the sim sets moveTicksLeft to STEP_TICKS, then counts down.
    const xs: number[] = [];
    for (let left = STEP_TICKS; left >= 1; left--) {
      for (const fraction of [0, 0.25, 0.5, 0.75]) {
        xs.push(actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: left }), fraction, 0).x);
      }
    }
    expect(xs[0]).toBe(5.5);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] as number);
    expect(xs.at(-1)).toBeLessThan(6.5);
    // Eased: it sets off and arrives slowly, and is fastest in the middle of the step.
    const jumps = xs.slice(1).map((x, i) => x - (xs[i] as number));
    const middle = jumps[Math.floor(jumps.length / 2)] as number;
    expect(Math.max(...jumps)).toBeLessThan(0.13);
    expect(jumps[0]).toBeLessThan(middle / 2);
    expect(jumps.at(-1)).toBeLessThan(middle / 2);
  });

  it("joins one step to the next without a jump", () => {
    const endOfFirst = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 1 }), 0.999, 0);
    const startOfSecond = actorPose(actor({ x: 7, fromX: 6, moveTicksLeft: STEP_TICKS }), 0, 0);
    expect(Math.abs(startOfSecond.x - endOfFirst.x)).toBeLessThan(0.001);
    expect(endOfFirst.hop).toBeLessThan(0.01);
    expect(Math.abs(endOfFirst.stride)).toBeLessThan(0.01);
  });

  it("stays in range for a fraction outside 0 to 1", () => {
    const early = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: STEP_TICKS }), -3, 0);
    const late = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 1 }), 7, 0);
    expect(early.x).toBe(5.5);
    expect(late.x).toBe(6.5);
    expect(early.hop).toBeCloseTo(0);
  });

  it("hops and strides mid-step, with the other leg leading on the next tile", () => {
    const half = STEP_TICKS / 2;
    const first = actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: half }), 0, 0);
    const second = actorPose(actor({ x: 7, fromX: 6, moveTicksLeft: half }), 0, 0);
    expect(first.hop).toBeGreaterThan(0.9);
    expect(Math.abs(first.stride)).toBeGreaterThan(0.9);
    expect(Math.sign(first.stride)).toBe(-Math.sign(second.stride));
  });

  it("breathes slowly while standing and not at all while walking", () => {
    const seen = new Set<number>();
    for (let time = 0; time < 200; time++) {
      const breath = actorPose(actor({}), 0, time).breath;
      expect(breath).toBeGreaterThanOrEqual(0);
      expect(breath).toBeLessThanOrEqual(1);
      seen.add(Math.round(breath * 4));
      expect(actorPose(actor({ x: 6, fromX: 5, moveTicksLeft: 2 }), 0, time).breath).toBe(0);
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });

  it("rests only when standing with nowhere to go and a good while to wait", () => {
    expect(actorPose(actor({ wait: REST_TICKS + 1 }), 0, 0).resting).toBe(true);
    expect(actorPose(actor({ wait: REST_TICKS }), 0, 0).resting).toBe(false);
    expect(actorPose(actor({ wait: 100, path: [{ x: 6, y: 5 }] }), 0, 0).resting).toBe(false);
    expect(actorPose(actor({ wait: 100, x: 6, fromX: 5, moveTicksLeft: 2 }), 0, 0).resting).toBe(
      false,
    );
  });

  it("gives full sitting depth while resting and none otherwise", () => {
    expect(actorPose(actor({ wait: REST_TICKS + 1 }), 0, 0).sit).toBe(1);
    expect(actorPose(actor({ wait: 0 }), 0, 0).sit).toBe(0);
  });
});

describe("easeSit", () => {
  it("goes down into sitting and back up over a few ticks, never more than SIT_STEP a tick", () => {
    expect(SIT_STEP).toBeLessThanOrEqual(0.25);
    let sit = 0;
    const down: number[] = [];
    while (sit < 1 && down.length < 100) {
      const next = easeSit(sit, 1);
      expect(next - sit).toBeGreaterThan(0);
      expect(next - sit).toBeLessThanOrEqual(SIT_STEP + 1e-9);
      sit = next;
      down.push(sit);
    }
    expect(down.length).toBeGreaterThanOrEqual(4);
    expect(sit).toBe(1);
    // Stays put once there, and comes up the same way.
    expect(easeSit(1, 1)).toBe(1);
    let ticks = 0;
    while (sit > 0 && ticks < 100) {
      const next = easeSit(sit, 0);
      expect(sit - next).toBeLessThanOrEqual(SIT_STEP + 1e-9);
      sit = next;
      ticks++;
    }
    expect([sit, ticks]).toEqual([0, down.length]);
  });

  it("turns back from part way without a jump", () => {
    const half = easeSit(easeSit(0, 1), 1);
    expect(Math.abs(easeSit(half, 0) - half)).toBeLessThanOrEqual(SIT_STEP + 1e-9);
    expect(easeSit(half, 0)).toBeLessThan(half);
  });
});
