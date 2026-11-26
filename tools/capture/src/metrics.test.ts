import {
  compileBots,
  createWorld,
  parseMap,
  placeConstants,
  spawnsNearCamp,
  step,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { botSources, rawFirstLight } from "../../../packages/sim/src/testing.ts";
import { brightnessGrid, FLICKER_LIMIT, flickerIndex } from "./flicker.ts";
import { type TickRecord, watchMetrics } from "./metrics.ts";

const record = (
  events: TickRecord["events"],
  positions: [number, string, number, number][],
): TickRecord => ({
  events,
  actors: positions.map(([id, name, x, y]) => ({ id, name, x, y })),
});

/** Runs the shipped map with the given cast for some seconds and records every tick. */
const play = (
  cast: { name: string; program: string }[],
  seconds: number,
  sources = botSources(),
): TickRecord[] => {
  const map = parseMap(rawFirstLight());
  const world = createWorld(map, 1, compileBots(sources, placeConstants(map)));
  const run: TickRecord[] = [];
  let events = step(world, spawnsNearCamp(world, cast));
  for (let tick = 0; tick < seconds * 10; tick++) {
    run.push({
      events,
      actors: world.actors.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y })),
    });
    events = step(world);
  }
  return run;
};

describe("watchMetrics", () => {
  it("passes the shipped programs over twenty minutes", () => {
    const metrics = watchMetrics(
      play(
        [
          { name: "Ash", program: "wanderer" },
          { name: "Birch", program: "homebody" },
          { name: "Cedar", program: "riverwalker" },
        ],
        1200,
      ),
    );
    expect(metrics.hardFails).toEqual([]);
    expect(metrics.actors).toBe(3);
    expect(metrics.seconds).toBe(1200);
    expect(metrics.deadAirSeconds).toBeLessThan(20);
    expect(metrics.decisionsPerMinute).toBeGreaterThan(3);
    expect(Object.values(metrics.actionMix).every((kinds) => kinds >= 2)).toBe(true);
    expect(metrics.faults).toBe(0);
  });

  it("a frozen world trips dead air and stuck actors", () => {
    // Every actor's program divides by zero, so nobody ever decides or moves.
    const frozen = play(
      [
        { name: "Ash", program: "stone" },
        { name: "Birch", program: "stone" },
      ],
      120,
      {
        stone: "otherwise -> wait(1 / 0)",
      },
    );
    const metrics = watchMetrics(frozen);
    expect(metrics.deadAirSeconds).toBe(120);
    expect(metrics.stuckActors).toEqual(["Ash", "Birch"]);
    expect(metrics.faults).toBeGreaterThan(30);
    expect(metrics.hardFails.some((f) => f.startsWith("dead air"))).toBe(true);
    expect(metrics.hardFails.some((f) => f.startsWith("stuck actors: Ash, Birch"))).toBe(true);
  });

  it("an actor that only ever does one thing is named", () => {
    const metrics = watchMetrics(
      play(
        [
          { name: "Ash", program: "pacer" },
          { name: "Birch", program: "wanderer" },
        ],
        700,
        {
          ...botSources(),
          pacer: "otherwise -> wander",
        },
      ),
    );
    expect(metrics.singleActionActors).toEqual(["Ash"]);
    expect(metrics.actionMix).toEqual({ Ash: 1, Birch: 2 });
    expect(metrics.hardFails).toEqual(["a single action for ten minutes: Ash"]);
  });

  it("measures dead air as the longest gap with nothing to see, including at the ends", () => {
    const decide = (tick: number, rule: number): TickRecord["events"] => [
      { type: "decide", tick, actor: 1, rule, action: "wait" },
    ];
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 500; tick++) {
      // The rule in charge changes at 100 and at 150. At 300 the same rule fires again, which shows nothing.
      const events =
        tick === 100
          ? decide(tick, 0)
          : tick === 150
            ? decide(tick, 1)
            : tick === 300
              ? decide(tick, 1)
              : [];
      run.push(record(events, [[1, "Ash", 4, 0]]));
    }
    // 0-100, 100-150, then 150 to the end at 500: the last gap is the longest.
    expect(watchMetrics(run).deadAirSeconds).toBe(35);
    expect(watchMetrics(run.slice(0, 160)).deadAirSeconds).toBe(10);
    // Someone changing tile is something to see, whatever the programs decide.
    const walking = run.map((r, tick) => record(r.events, [[1, "Ash", Math.floor(tick / 50), 0]]));
    expect(watchMetrics(walking).deadAirSeconds).toBe(5);
  });

  it("resting by choice is not stuck, moving is not stuck, and deciding to walk without getting anywhere is", () => {
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 2000; tick++) {
      run.push(
        record(
          tick % 200 === 0
            ? [
                { type: "decide", tick, actor: 1, rule: 0, action: "wait" },
                { type: "decide", tick, actor: 4, rule: 0, action: "walk_to" },
              ]
            : [],
          [
            [1, "Sleeper", 5, 5],
            [2, "Walker", tick % 30, 0],
            [3, "Statue", 9, 9],
            [4, "Jammed", 7, 7],
          ],
        ),
      );
    }
    expect(watchMetrics(run).stuckActors).toEqual(["Jammed", "Statue"]);
  });

  it("a long rest counts for as long as it lasts, with a wasted decision in between", () => {
    // Rest a full minute, find there is nowhere to walk to, rest again: 607 ticks between the two rests.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 3000; tick++) {
      const at = tick % 607;
      const action = at === 0 ? "wait" : at === 601 ? "walk_to" : null;
      run.push(
        record(action ? [{ type: "decide", tick, actor: 1, rule: 0, action }] : [], [
          [1, "Sleeper", 5, 5],
        ]),
      );
    }
    expect(watchMetrics(run).stuckActors).toEqual([]);
    // A rest that a fault cuts short stops counting.
    const faulted = run.map((r, tick) =>
      tick === 10
        ? record(
            [{ type: "fault", tick, actor: 1, fault: "divide_by_zero" }],
            [[1, "Sleeper", 5, 5]],
          )
        : tick > 10
          ? record([], [[1, "Sleeper", 5, 5]])
          : r,
    );
    expect(watchMetrics(faulted).stuckActors).toEqual(["Sleeper"]);
  });

  it("a blow can be seen but is not a decision", () => {
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 300; tick++) {
      run.push(
        record(
          tick === 100 ? [{ type: "hit", tick, actor: 2, target: 1, damage: 4, hp: 16 }] : [],
          [[1, "Ash", 4, 0]],
        ),
      );
    }
    const metrics = watchMetrics(run);
    // Nothing to see before the blow at 100 or after it: the longer gap is the 200 ticks after.
    expect(metrics.deadAirSeconds).toBe(20);
    expect(metrics.decisionsPerMinute).toBe(0);
    expect(metrics.actionMix).toEqual({ Ash: 0 });
  });

  it("judges the action mix on whole ten-minute windows only", () => {
    // Two actions in each of the first two windows, then a part window with one: the part does not count.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 15000; tick++) {
      const action = tick >= 12000 || tick % 200 === 0 ? "wait" : "wander";
      run.push(
        record(tick % 100 === 0 ? [{ type: "decide", tick, actor: 1, rule: 0, action }] : [], [
          [1, "Ash", tick % 9, 0],
        ]),
      );
    }
    expect(watchMetrics(run).actionMix).toEqual({ Ash: 2 });
    expect(watchMetrics(run).singleActionActors).toEqual([]);
  });
});

describe("flickerIndex", () => {
  const steady = new Array<number>(100).fill(120);
  it("is zero for a steady picture and small for something moving through it", () => {
    expect(flickerIndex([steady, steady, steady])).toBe(0);
    const moved = (at: number): number[] => steady.map((value, k) => (k === at ? 240 : value));
    expect(flickerIndex([moved(3), moved(4), moved(5)])).toBe(0.02);
    expect(flickerIndex([moved(3), moved(4), moved(5)])).toBeLessThan(FLICKER_LIMIT);
  });

  it("a screen that flashes trips the limit", () => {
    const flash = new Array<number>(100).fill(250);
    expect(flickerIndex([steady, flash, steady])).toBe(1);
    // A quarter of the screen flashing is still far over the limit.
    const partial = steady.map((value, k) => (k < 25 ? 250 : value));
    expect(flickerIndex([steady, partial])).toBe(0.25);
    expect(flickerIndex([steady, partial])).toBeGreaterThan(FLICKER_LIMIT);
  });

  it("ignores slow change, such as dusk falling", () => {
    const frames = Array.from({ length: 30 }, (_, i) => steady.map((value) => value - i * 2));
    expect(flickerIndex(frames)).toBe(0);
  });

  it("refuses frames of different sizes", () => {
    expect(() => flickerIndex([steady, [1, 2]])).toThrow(RangeError);
  });

  it("brightnessGrid averages each block of an image", () => {
    // A 4x2 image: left half white, right half black, in 2-pixel blocks.
    const pixels = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) =>
      i % 4 < 2 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    expect(brightnessGrid(pixels, 4, 2, 2)).toEqual([255, 0]);
    expect(brightnessGrid(pixels, 4, 2, 4)).toEqual([127.5]);
    // Blocks at the edge that are only partly inside the image are averaged over what is there.
    expect(brightnessGrid(pixels, 4, 2, 3)).toEqual([170, 0]);
  });
});
