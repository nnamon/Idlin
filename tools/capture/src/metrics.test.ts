import { type Monsters, TICKS_PER_DAY, type WorldEvent } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { castOf } from "../../../packages/client/src/cast.ts";
import { botSources, shippedMonsters } from "../../../packages/sim/src/testing.ts";
import { brightnessGrid, FLICKER_LIMIT, flickerIndex } from "./flicker.ts";
import { type TickRecord, watchMetrics } from "./metrics.ts";
import { follow, start } from "./simrun.ts";

const record = (
  events: TickRecord["events"],
  positions: [number, string, number, number][],
): TickRecord => ({
  events,
  actors: positions.map(([id, name, x, y]) => ({ id, name, x, y })),
});

/** Runs the shipped world with the given cast for some seconds and records the camp's map, as a capture does. */
const play = (
  cast: { name: string; program: string }[],
  seconds: number,
  sources = botSources(),
  monsters?: Monsters,
): TickRecord[] => {
  const { world, events } = start(1, cast, sources, monsters);
  return follow(world, events, seconds * 10);
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
      2: { name: "Birch", actions: 4 },
    });
    expect(metrics.hardFails).toEqual(["a single action for ten minutes: Ash"]);
  });

  it("measures dead air as the longest gap with nothing to see, including at the ends", () => {
    // The page's line under Ash changes at 100 and at 150. It is set again to the same words at 300, which shows nothing.
    const text = (tick: number): string =>
      tick < 100 ? "resting at camp" : tick < 150 ? "walking to the river" : "resting by the river";
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 500; tick++) {
      run.push({ ...record([], [[1, "Ash", 4, 0]]), lines: [{ id: 1, text: text(tick) }] });
    }
    // 0-100, 100-150, then 150 to the end at 500: the last gap is the longest.
    expect(watchMetrics(run).deadAirSeconds).toBe(35);
    expect(watchMetrics(run.slice(0, 160)).deadAirSeconds).toBe(10);
    // A change of the rule in charge, with the line as it was, shows nothing.
    const rules = run.map((r, tick) => ({
      ...r,
      lines: [{ id: 1, text: "resting at camp" }],
      events:
        tick % 50 === 0
          ? [{ type: "decide", tick, actor: 1, rule: tick / 50, action: "wait" } as const]
          : [],
    }));
    expect(watchMetrics(rules).deadAirSeconds).toBe(50);
    // A resident newly listed is not a change of line.
    const listed = run.map((r, tick) => (tick < 200 ? { ...r, lines: [] } : r));
    expect(watchMetrics(listed).deadAirSeconds).toBe(50);
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
          tick === 100
            ? [
                {
                  type: "hit",
                  tick,
                  actor: 2,
                  target: 1,
                  damage: 4,
                  crit: false,
                  damageType: "physical",
                  hp: 16,
                },
              ]
            : [],
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

  it("counts someone who left the map and came back from their return", () => {
    // Bryn walks about throughout. Ash stands on (3, 3) for 30 s, is off the map
    // for 50 s and comes back onto the same tile, where it stands 50 s more.
    // Nobody is still for over a minute while on the map.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 1300; tick++) {
      const actors: [number, string, number, number][] = [[2, "Bryn", 5 + (tick % 4), 5]];
      if (tick < 300 || tick >= 800) actors.push([1, "Ash", 3, 3]);
      run.push(record([], actors));
    }
    expect(watchMetrics(run).stuckActors).toEqual([]);
    // Standing 61 s after coming back is stuck.
    for (let tick = 1300; tick < 1420; tick++)
      run.push(
        record(
          [],
          [
            [2, "Bryn", 5 + (tick % 4), 5],
            [1, "Ash", 3, 3],
          ],
        ),
      );
    expect(watchMetrics(run).stuckActors).toEqual(["Ash"]);
  });

  it("judges the action mix only on whole windows inside one visit to the map", () => {
    // Ash does one thing only, but is on the map in two visits of 5000 and 5500
    // ticks, each shorter than a window, so it is not judged. Birch is there the whole
    // time with two actions.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 18000; tick++) {
      const here = tick < 5000 || (tick >= 10000 && tick < 15500);
      const events: WorldEvent[] = [];
      if (tick % 100 === 0) {
        if (here) events.push({ type: "decide", tick, actor: 1, rule: 0, action: "wander" });
        events.push({
          type: "decide",
          tick,
          actor: 2,
          rule: 0,
          action: tick % 200 ? "wait" : "wander",
        });
      }
      const actors: [number, string, number, number][] = [[2, "Birch", tick % 9, 0]];
      if (here) actors.push([1, "Ash", tick % 7, 2]);
      run.push(record(events, actors));
    }
    const metrics = watchMetrics(run);
    expect(metrics.actionMix).toEqual({ 2: { name: "Birch", actions: 2 } });
    expect(metrics.singleActionActors).toEqual([]);
  });

  it("judges a resident off the map on what it decided there too", () => {
    // As above, but the records say where Ash is while it is away, and that it
    // goes on deciding "wander" there. Ash is in the run throughout, with one
    // action, and is named; Birch is judged as before.
    const run: TickRecord[] = [];
    for (let tick = 0; tick < 18000; tick++) {
      const here = tick < 5000 || (tick >= 10000 && tick < 15500);
      const mine: WorldEvent[] =
        tick % 100 === 0 ? [{ type: "decide", tick, actor: 1, rule: 0, action: "wander" }] : [];
      const events: WorldEvent[] = here ? [...mine] : [];
      if (tick % 100 === 0)
        events.push({
          type: "decide",
          tick,
          actor: 2,
          rule: 0,
          action: tick % 200 ? "wait" : "wander",
        });
      const actors: [number, string, number, number][] = [[2, "Birch", tick % 9, 0]];
      if (here) actors.push([1, "Ash", tick % 7, 2]);
      run.push({
        ...record(events, actors),
        elsewhere: here
          ? { actors: [], events: [] }
          : { actors: [{ id: 1, name: "Ash", x: -5, y: 3 }], events: mine },
      });
    }
    const metrics = watchMetrics(run);
    expect(metrics.actionMix).toEqual({
      1: { name: "Ash", actions: 1 },
      2: { name: "Birch", actions: 2 },
    });
    expect(metrics.singleActionActors).toEqual(["Ash"]);
    // What is done off the map is not something to see, nor a decision on screen.
    const mapOnly = watchMetrics(run.map((r) => ({ events: r.events, actors: r.actors })));
    expect(metrics.decisionsPerMinute).toBe(mapOnly.decisionsPerMinute);
    expect(metrics.deadAirSeconds).toBe(mapOnly.deadAirSeconds);
    expect(metrics.stuckActors).toEqual([]);
  });

  it("counts every resident of a shipped game day in the action mix, those who left the map too", () => {
    const run = play(castOf(6), 1800);
    const left = new Set(run.flatMap((r) => r.elsewhere?.actors.map((a) => a.name) ?? []));
    // Some of the cast spent time off the map, and all six are judged.
    expect(left.size).toBeGreaterThan(0);
    const mix = watchMetrics(run).actionMix;
    expect(
      Object.values(mix)
        .map((m) => m.name)
        .sort(),
    ).toEqual(
      castOf(6)
        .map((c) => c.name)
        .sort(),
    );
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
