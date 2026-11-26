// Whole game days with monsters at six residents, over many seeds, judged by
// the same metrics as a capture. Slow (about half a minute), so it has a file
// of its own and runs alongside the rest.

import {
  ADVENTURER,
  compileBots,
  createWorld,
  isNight,
  parseMap,
  placeConstants,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
  terrainAt,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { castOf } from "../../../packages/client/src/cast.ts";
import { botSources, rawFirstLight, shippedMonsters } from "../../../packages/sim/src/testing.ts";
import { type TickRecord, watchMetrics } from "./metrics.ts";

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);
const DAYS = 2;

describe("game days with monsters", () => {
  it(`seeds 1 to ${SEEDS.length}, ${DAYS} days each at six residents: no hard fail, and monsters by night as well as by day`, {
    timeout: 300_000,
  }, () => {
    const map = parseMap(rawFirstLight());
    const camp: { x: number; y: number }[] = [];
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) if (terrainAt(map, x, y) === "camp") camp.push({ x, y });
    const toCamp = (p: { x: number; y: number }) =>
      Math.min(...camp.map((c) => Math.abs(c.x - p.x) + Math.abs(c.y - p.y)));
    const monsters = shippedMonsters();
    const programs = { ...compileBots(botSources(), placeConstants(map)), ...monsters.programs };
    const fails: string[] = [];
    // Monster-ticks spent on the camp's ground, beside it, and in all, by day and by night.
    let onCamp = 0;
    const beside = { day: 0, night: 0 };
    const present = { day: 0, night: 0 };
    let nightHits = 0;
    let leaves = 0;
    let nightTicksWithMonsters = 0;
    let nightTicks = 0;
    for (const seed of SEEDS) {
      const world = createWorld(map, seed, programs, monsters.kinds, monsters.spawns);
      let events = step(world, spawnsNearCamp(world, castOf(6)));
      for (let day = 0; day < DAYS; day++) {
        const run: TickRecord[] = [];
        for (let t = 0; t < TICKS_PER_DAY; t++) {
          run.push({
            events,
            actors: world.actors.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y })),
          });
          events = step(world);
          const part = isNight(world) ? "night" : "day";
          const out = world.actors.filter((a) => a.kind !== ADVENTURER);
          for (const monster of out) {
            const d = toCamp(monster);
            if (d === 0) onCamp++;
            if (d === 1) beside[part]++;
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
        }
        const metrics = watchMetrics(run);
        for (const fail of metrics.hardFails) fails.push(`seed ${seed} day ${day + 1}: ${fail}`);
        if (metrics.faults > 0) fails.push(`seed ${seed} day ${day + 1}: ${metrics.faults} faults`);
      }
    }
    expect(fails).toEqual([]);
    // Monsters never set foot on the camp's ground, and by night they spend far
    // more of their time right at its edge than by day: 4.7% against 1.5% when
    // this was written.
    expect(onCamp).toBe(0);
    expect(beside.night / present.night).toBeGreaterThan((2 * beside.day) / present.day);
    // Day monsters go home at dusk, so the night has monsters of its own for most
    // of its length, and fights in it.
    expect(leaves).toBeGreaterThan(SEEDS.length);
    expect(nightTicksWithMonsters / nightTicks).toBeGreaterThan(0.75);
    expect(nightHits).toBeGreaterThan(SEEDS.length * DAYS * 20);
  });

  it("seed 142, where two hurt goblins once tried to run with nowhere to go for eleven minutes: no hard fail", () => {
    const map = parseMap(rawFirstLight());
    const monsters = shippedMonsters();
    const programs = { ...compileBots(botSources(), placeConstants(map)), ...monsters.programs };
    const world = createWorld(map, 142, programs, monsters.kinds, monsters.spawns);
    let events = step(world, spawnsNearCamp(world, castOf(6)));
    const run: TickRecord[] = [];
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      run.push({
        events,
        actors: world.actors.map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y })),
      });
      events = step(world);
    }
    expect(watchMetrics(run).hardFails).toEqual([]);
  });
});
