// Whole game days judged by the same metrics as a capture, on the shipped
// world as the viewer and the capture record it: the camp's region. With
// monsters at six residents over many seeds: the full 60 seeds take about a
// minute, so the gate runs five of them and the capture workflow all 60
// (IDLIN_LONG=1). And as `capture --review` runs it, also with monsters, for
// seeds 1 and 2 at six and twelve residents.

import {
  ADVENTURER,
  inFirelight,
  isNight,
  LIGHT_REACH,
  place,
  sameRegion,
  TICKS_PER_DAY,
  terrainOf,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { castOf } from "../../../packages/client/src/cast.ts";
import { botSources, shippedMonsters, shippedWorld } from "../../../packages/sim/src/testing.ts";
import { watchMetrics } from "./metrics.ts";
import { follow, play, start } from "./simrun.ts";

const LONG_RUNS = process.env.IDLIN_LONG === "1";
const SEEDS = Array.from({ length: LONG_RUNS ? 60 : 5 }, (_, i) => i + 1);
const DAYS = 2;

describe("game days with monsters", () => {
  it(`seeds 1 to ${SEEDS.length}, ${DAYS} days each at six residents: no hard fail, and monsters by night as well as by day`, {
    timeout: 300_000,
  }, () => {
    const atlas = shippedWorld();
    const camp: { x: number; y: number }[] = [];
    for (let y = atlas.top; y < atlas.top + atlas.height; y++)
      for (let x = atlas.left; x < atlas.left + atlas.width; x++)
        if (terrainOf(atlas, x, y) === "camp") camp.push({ x, y });
    const toCamp = (p: { x: number; y: number }) =>
      Math.min(...camp.map((c) => Math.abs(c.x - p.x) + Math.abs(c.y - p.y)));
    const campPlace = place(atlas, "camp");
    const monsters = shippedMonsters();
    const fails: string[] = [];
    // Monster-ticks spent on the camp's ground, in its firelight, at the edge of
    // the light (up to two tiles past its reach), and in all, by day and by night.
    const onCamp = { day: 0, night: 0 };
    const lit = { day: 0, night: 0 };
    const edge = { day: 0, night: 0 };
    const present = { day: 0, night: 0 };
    let nightHits = 0;
    let leaves = 0;
    let nightTicksWithMonsters = 0;
    let nightTicks = 0;
    for (const seed of SEEDS) {
      const { world, events } = start(seed, castOf(6), botSources(), monsters);
      const run = follow(world, events, DAYS * TICKS_PER_DAY, (world, events) => {
        const part = isNight(world) ? "night" : "day";
        const out = world.actors.filter((a) => a.kind !== ADVENTURER);
        for (const monster of out) {
          if (toCamp(monster) === 0) onCamp[part]++;
          if (inFirelight(world, monster.x, monster.y)) lit[part]++;
          const [dx, dy] = [monster.x - campPlace.x, monster.y - campPlace.y];
          const away = dx * dx + dy * dy;
          if (sameRegion(world, monster, campPlace) && away > LIGHT_REACH ** 2)
            if (away <= (LIGHT_REACH + 2) ** 2) edge[part]++;
          present[part]++;
        }
        for (const event of events) {
          if (event.type === "hit" && part === "night") nightHits++;
          if (event.type === "leave") leaves++;
        }
        if (part === "night") {
          nightTicks++;
          if (out.length > 0) nightTicksWithMonsters++;
        }
      });
      for (let day = 0; day < DAYS; day++) {
        const metrics = watchMetrics(run.slice(day * TICKS_PER_DAY, (day + 1) * TICKS_PER_DAY));
        for (const fail of metrics.hardFails) fails.push(`seed ${seed} day ${day + 1}: ${fail}`);
        if (metrics.faults > 0) fails.push(`seed ${seed} day ${day + 1}: ${metrics.faults} faults`);
      }
    }
    expect(fails).toEqual([]);
    // By day monsters are on the camp's ground or in its light only for the odd
    // step of a chase or out of a blow. By night packs go into the light and
    // onto the camp's ground some of the time, when they outnumber the residents
    // there, and spend more of their time in the light or at its edge than by day:
    // the camp is where residents are at night. By day a wolf chasing someone
    // just outside the light may cross its edge, so the night's share in the
    // light is held to half as much again as the day's, not twice.
    const shares = JSON.stringify({ onCamp, lit, edge, present });
    expect(onCamp.day / present.day, shares).toBeLessThan(0.003);
    expect(lit.day / present.day, shares).toBeLessThan(0.04);
    expect(lit.day / present.day, shares).toBeLessThan(lit.night / present.night / 1.5);
    expect(onCamp.night, shares).toBeGreaterThan(0);
    expect(lit.night / present.night, shares).toBeLessThan(0.25);
    expect((edge.night + lit.night) / present.night, shares).toBeGreaterThan(
      (edge.day + lit.day) / present.day,
    );
    // Day monsters go home at dusk, so the night has monsters of its own for most
    // of its length, and fights in it.
    expect(leaves).toBeGreaterThan(SEEDS.length);
    expect(nightTicksWithMonsters / nightTicks).toBeGreaterThan(LONG_RUNS ? 0.75 : 0.6);
    expect(nightHits).toBeGreaterThan(SEEDS.length * DAYS * 20);
  });

  it("seed 142, where two hurt goblins once tried to run with nowhere to go for eleven minutes: no hard fail", () => {
    const { world, events } = start(142, castOf(6), botSources(), shippedMonsters());
    expect(watchMetrics(follow(world, events, TICKS_PER_DAY)).hardFails).toEqual([]);
  });
});

describe("the shipped world, as the viewer shows it", () => {
  // The capture's own numbers: a game day of the camp's region, as `capture --review` runs it.
  const runs = LONG_RUNS ? [6, 12, 50] : [6, 12];
  for (const residents of runs)
    for (const seed of [1, 2])
      it(`seed ${seed}, ${residents} residents, a game day: no hard fail`, {
        timeout: 120_000,
      }, () => {
        const metrics = watchMetrics(play(seed, residents, TICKS_PER_DAY));
        expect(metrics.hardFails).toEqual([]);
        expect(metrics.faults).toBe(0);
      });
});
