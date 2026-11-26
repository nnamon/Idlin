import {
  compileBots,
  createWorld,
  type Monsters,
  parseMap,
  placeConstants,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
  type WorldEvent,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { castOf } from "../../../packages/client/src/cast.ts";
import { botSources, rawFirstLight, shippedMonsters } from "../../../packages/sim/src/testing.ts";
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
  monsters?: Monsters,
): TickRecord[] => {
  const map = parseMap(rawFirstLight());
  const world = createWorld(
    map,
    1,
    { ...compileBots(sources, placeConstants(map)), ...monsters?.programs },
    monsters?.kinds,
    monsters?.spawns,
  );
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
    expect(Object.values(metrics.actionMix).every((mix) => mix.actions >= 2)).toBe(true);
    expect(metrics.faults).toBe(0);
  });

  it("passes a full game day with monsters at six residents", () => {
    const run = play(castOf(6), TICKS_PER_DAY / 10, botSources(), shippedMonsters());
    const metrics = watchMetrics(run);
    expect(metrics.hardFails).toEqual([]);
    expect(metrics.faults).toBe(0);
    // Monsters came, fought and were replaced: more actors than residents, and blows on both sides.
    const events = run.flatMap((r) => r.events);
    const downs = events.filter((e) => e.type === "down");
    expect(downs.filter((e) => e.kind !== "adventurer").length).toBeGreaterThan(3);
    expect(downs.filter((e) => e.kind === "adventurer").length).toBeGreaterThan(0);
    expect(metrics.actors).toBeGreaterThan(6 + 6);
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
    expect(metrics.actionMix).toEqual({
      1: { name: "Ash", actions: 1 },
      2: { name: "Birch", actions: 2 },
    });
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
    expect(metrics.actionMix).toEqual({ 1: { name: "Ash", actions: 0 } });
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
    expect(watchMetrics(run).actionMix).toEqual({ 1: { name: "Ash", actions: 2 } });
    expect(watchMetrics(run).singleActionActors).toEqual([]);
  });

  it("judges actors that come and go on the whole windows they were there for, and tells shared names apart", () => {
    // Ash is there throughout. Wolf 2 arrives at 1000 and stays for 7000 ticks, with
    // two actions in its first window and one in the rest. Wolf 3 is there for
    // less than a window and is not judged.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 12000; tick++) {
      const events: WorldEvent[] = [];
      if (tick % 100 === 0) {
        events.push({
          type: "decide",
          tick,
          actor: 1,
          rule: 0,
          action: tick % 200 ? "wait" : "wander",
        });
        if (tick >= 1000 && tick < 8000) {
          const action = tick < 7000 && tick % 300 === 0 ? "wait" : "attack";
          events.push({ type: "decide", tick, actor: 2, rule: 0, action });
        }
        if (tick >= 9000)
          events.push({ type: "decide", tick, actor: 3, rule: 0, action: "attack" });
      }
      const actors: [number, string, number, number][] = [[1, "Ash", tick % 9, 0]];
      if (tick >= 1000 && tick < 8000) actors.push([2, "Wolf", 5, tick % 7]);
      if (tick >= 9000) actors.push([3, "Wolf", 6, tick % 7]);
      run.push(record(events, actors));
    }
    const metrics = watchMetrics(run);
    expect(metrics.actionMix).toEqual({
      1: { name: "Ash", actions: 2 },
      2: { name: "Wolf", actions: 2 },
    });
    expect(metrics.singleActionActors).toEqual([]);
    expect(metrics.actors).toBe(3);
  });

  it("keeps actors apart by id, whatever they are called", () => {
    // Two called "Wolf" and one called "Wolf 2", each with a different number of
    // actions, and all three standing still for two minutes.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 1200; tick++) {
      const events: WorldEvent[] =
        tick % 100 === 0
          ? [
              { type: "decide", tick, actor: 2, rule: 0, action: "attack" },
              { type: "decide", tick, actor: 3, rule: 0, action: tick % 200 ? "attack" : "flee" },
              {
                type: "decide",
                tick,
                actor: 4,
                rule: 0,
                action: ["attack", "flee", "idle"][tick % 3] as string,
              },
            ]
          : [];
      run.push(
        record(events, [
          [2, "Wolf", 1, 1],
          [3, "Wolf", 2, 2],
          [4, "Wolf 2", 3, 3],
        ]),
      );
    }
    const metrics = watchMetrics(run);
    expect(metrics.actionMix).toEqual({
      2: { name: "Wolf", actions: 1 },
      3: { name: "Wolf", actions: 2 },
      4: { name: "Wolf 2", actions: 3 },
    });
    expect(metrics.singleActionActors).toEqual(["Wolf (2)"]);
    expect(metrics.stuckActors).toEqual(["Wolf (2)", "Wolf (3)", "Wolf 2"]);
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
