// Death counts, and a version 7 snapshot from before them.
// fixtures/snapshot-v7.json was written by the code at commit 46f972d: seed
// 7007 on first-light with SOURCES, KINDS and SPAWNS below, Ash, Bryn and Cole
// put in with spawnsNearCamp running "stroller", then 3,000 ticks run and the
// snapshot taken. The wolves had struck the strollers down 12 times by then.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import {
  ADVENTURER,
  createWorld,
  hashWorld,
  MAX_DEATHS,
  restore,
  SNAPSHOT_VERSION,
  SnapshotError,
  snapshot,
  spawnsNearCamp,
  step,
  type World,
  type WorldEvent,
} from "./world.ts";

const MAP = firstLight();
const SOURCES = {
  stroller:
    'bot "Stroller"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> walk_to(deep_wood); wait(20)\n',
  biter:
    'bot "Biter"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\nwhen threat_distance < 12 -> walk_to(threat_x, threat_y)\notherwise -> wander; wait(10)\n',
};
const KINDS = { wolf: { hp: 60, damage: 5, windup: 8, recovery: 10, reach: 1 } };
const SPAWNS = [
  {
    kind: "wolf",
    name: "Wolf",
    program: "biter",
    group: 2,
    day: [{ x: 4, y: 6 }],
    night: [{ x: 4, y: 6 }],
  },
];
const PROGRAMS = compileBots(SOURCES, placeConstants(MAP));
const TEXT = readFileSync(new URL("./fixtures/snapshot-v7.json", import.meta.url), "utf8");

const reload = (text: string): World => restore(text, MAP, PROGRAMS, KINDS, SPAWNS);

/** Steps `world` `ticks` times and returns how often each adventurer was struck down, by id. */
const runCountingDowns = (world: World, ticks: number): Map<number, number> => {
  const downs = new Map<number, number>();
  for (let t = 0; t < ticks; t++) {
    for (const event of step(world) as WorldEvent[]) {
      if (event.type === "down" && event.kind === ADVENTURER)
        downs.set(event.actor, (downs.get(event.actor) ?? 0) + 1);
    }
  }
  return downs;
};

describe("death counts", () => {
  it("go up by one each time an adventurer is struck down, and survive a snapshot", () => {
    const world = createWorld(MAP, 7007, PROGRAMS, KINDS, SPAWNS);
    step(
      world,
      spawnsNearCamp(
        world,
        ["Ash", "Bryn", "Cole"].map((name) => ({ name, program: "stroller" })),
      ),
    );
    for (const actor of world.actors) expect(actor.deaths).toBe(0);
    const downs = runCountingDowns(world, 3000);
    expect([...downs.values()].reduce((sum, n) => sum + n, 0)).toBeGreaterThan(3);
    for (const actor of world.actors.filter((a) => a.kind === ADVENTURER))
      expect(actor.deaths).toBe(downs.get(actor.id) ?? 0);
    // Monsters that die leave, so the ones still here have none.
    for (const actor of world.actors.filter((a) => a.kind !== ADVENTURER))
      expect(actor.deaths).toBe(0);
    const resumed = reload(snapshot(world));
    expect(resumed.actors.map((a) => a.deaths)).toEqual(world.actors.map((a) => a.deaths));
    runCountingDowns(world, 2000);
    runCountingDowns(resumed, 2000);
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("stop at MAX_DEATHS", () => {
    const world = createWorld(MAP, 7007, PROGRAMS, KINDS, SPAWNS);
    step(world, spawnsNearCamp(world, [{ name: "Ash", program: "stroller" }]));
    const ash = world.actors[0] as World["actors"][number];
    ash.deaths = MAX_DEATHS - 1;
    for (let t = 0; t < 6000 && ash.deaths < MAX_DEATHS; t++) step(world);
    expect(ash.deaths).toBe(MAX_DEATHS);
    for (let t = 0; t < 3000; t++) step(world);
    expect(ash.deaths).toBe(MAX_DEATHS);
    expect(reload(snapshot(world)).actors[0]?.deaths).toBe(MAX_DEATHS);
  });

  it("are refused in a snapshot when not a whole number from 0 to MAX_DEATHS, or on a monster", () => {
    const world = createWorld(MAP, 7007, PROGRAMS, KINDS, SPAWNS);
    step(
      world,
      spawnsNearCamp(
        world,
        ["Ash", "Bryn"].map((name) => ({ name, program: "stroller" })),
      ),
    );
    step(world, [{ type: "spawn", name: "Wolf", x: 4, y: 6, program: "biter", kind: "wolf" }]);
    const wolf = world.actors.find((a) => a.kind === "wolf");
    expect(wolf).toBeDefined();
    // Each forged world is snapshotted with its own hash, so only the field check can refuse it.
    const forged = (deaths: unknown, who = 0): string => {
      const copy = reload(snapshot(world));
      (copy.actors[who] as unknown as Record<string, unknown>).deaths = deaths;
      return snapshot(copy);
    };
    for (const bad of [-1, MAX_DEATHS + 1, 2 ** 53, 1e300, 1.5, Number.NaN, "3", null, [1]])
      expect(() => reload(forged(bad)), String(bad)).toThrow(/damaged/);
    expect(() => reload(forged(1, world.actors.indexOf(wolf as World["actors"][number])))).toThrow(
      /damaged/,
    );
    const missing = JSON.parse(snapshot(world));
    delete missing.state.actors[0].deaths;
    expect(() => reload(JSON.stringify(missing))).toThrow(/damaged/);
    expect(reload(forged(5)).actors[0]?.deaths).toBe(5);
  });
});

describe("a version 7 snapshot", () => {
  it("restores with nobody having died yet, counts from there, and saves as the current version", () => {
    expect(JSON.parse(TEXT).version).toBe(7);
    const world = reload(TEXT);
    expect(world.tick).toBe(3001);
    expect(world.actors.filter((a) => a.kind === ADVENTURER).map((a) => a.name)).toEqual([
      "Ash",
      "Bryn",
      "Cole",
    ]);
    for (const actor of world.actors) expect(actor.deaths).toBe(0);
    const downs = runCountingDowns(world, 3000);
    expect(downs.size).toBeGreaterThan(0);
    for (const actor of world.actors.filter((a) => a.kind === ADVENTURER))
      expect(actor.deaths).toBe(downs.get(actor.id) ?? 0);
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    expect(hashWorld(reload(again))).toBe(hashWorld(world));
  });

  it("is refused when damaged, and cannot pass for version 8", () => {
    const damaged = JSON.parse(TEXT);
    damaged.state.actors[0].hp = 3;
    expect(() => reload(JSON.stringify(damaged))).toThrow(SnapshotError);
    // A version 7 world has no death count to read, whatever the file says.
    const counted = JSON.parse(TEXT);
    counted.state.actors[0].deaths = 4;
    expect(reload(JSON.stringify(counted)).actors[0]?.deaths).toBe(0);
    const eight = { ...JSON.parse(TEXT), version: 8 };
    expect(() => reload(JSON.stringify(eight))).toThrow(SnapshotError);
  });
});
