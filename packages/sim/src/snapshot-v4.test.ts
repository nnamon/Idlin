// A version 4 snapshot, saved by the code from before monsters spawned on their
// own, still restores. fixtures/snapshot-v4.json was written by that code
// (commit 56a7709): seed 4004 on first-light with SOURCES and KINDS below, the
// three adventurers put in with spawnsNearCamp, a wolf put in by hand at
// `deep_wood` on the next tick, then 2,400 ticks run and the snapshot taken.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight, shippedMonsters } from "./testing.ts";
import {
  ADVENTURER,
  hashSpawns,
  hashWorld,
  restore,
  SNAPSHOT_VERSION,
  SnapshotError,
  snapshot,
  step,
} from "./world.ts";

const MAP = firstLight();
const SOURCES = {
  stroller:
    'bot "Stroller"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wander; wait(20)\n',
  biter:
    'bot "Biter"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wander; wait(10)\n',
};
const KINDS = { wolf: { hp: 400, damage: 1, windup: 8, recovery: 10, reach: 1 } };
const PROGRAMS = compileBots(SOURCES, placeConstants(MAP));
const TEXT = readFileSync(new URL("./fixtures/snapshot-v4.json", import.meta.url), "utf8");

describe("a version 4 snapshot", () => {
  it("restores with the fields versions 5 to 7 added filled in, and goes on", () => {
    expect(JSON.parse(TEXT).version).toBe(4);
    const world = restore(TEXT, MAP, PROGRAMS, KINDS);
    expect(world.tick).toBe(2402);
    expect(world.actors.map((a) => [a.name, a.kind])).toEqual([
      ["Ash", ADVENTURER],
      ["Bryn", ADVENTURER],
      ["Cole", ADVENTURER],
      ["Wolf", "wolf"],
    ]);
    // Put in by hand, so it never goes home; nothing has stalled; no group is held back.
    expect(world.actors.every((a) => a.shift === "" && a.stalled === 0)).toBe(true);
    expect(world.nextSpawn).toEqual([world.tick]);
    expect(
      world.actors.every((a) => a.xp.every((n) => n === 0) && a.bank.every((n) => n === 0)),
    ).toBe(true);
    expect(world.spawns).toEqual([]);
    for (let t = 0; t < 2000; t++) step(world);
    expect(world.tick).toBe(4402);
    // Saved again, it is a current snapshot that restores to the same state.
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    expect(hashWorld(restore(again, MAP, PROGRAMS, KINDS))).toBe(hashWorld(world));
  });

  it("takes on the spawn table it is restored with", () => {
    // The fixture was saved with only the wolf kind and the two programs above,
    // and those must match, so the spawn table uses them with the shipped
    // goblins' places and group.
    const [goblins] = shippedMonsters(firstLight()).spawns as [
      ReturnType<typeof shippedMonsters>["spawns"][number],
    ];
    // Two, so that with the wolf already there they fit under a region's cap of three.
    const spawns = [{ ...goblins, kind: "wolf", program: "biter", group: 2 }];
    const world = restore(TEXT, MAP, PROGRAMS, KINDS, spawns);
    expect(world.spawns).toHaveLength(1);
    const before = world.actors.length;
    step(world);
    expect(world.actors.length).toBeGreaterThan(before);
    expect(world.actors.slice(before).every((a) => a.shift !== "")).toBe(true);
  });

  it("is refused, saying why, when its monsters break today's rules", () => {
    // Version 4 had no cap and let monsters onto the camp's ground.
    const crowded = JSON.parse(TEXT);
    const wolf = crowded.state.actors[3];
    expect(wolf.kind).toBe("wolf");
    for (let i = 0; i < 6; i++)
      crowded.state.actors.push({
        ...wolf,
        id: 100 + i,
        x: 20 + i,
        y: 15,
        fromX: 20 + i,
        fromY: 15,
        path: [],
      });
    expect(() => restore(JSON.stringify(crowded), MAP, PROGRAMS, KINDS)).toThrow(
      /holds 7 monsters, more than the 3 a region now allows/,
    );
    for (const change of [
      { x: 14, y: 9, fromX: 14, fromY: 9, path: [] },
      { path: [{ x: 14, y: 9 }] },
    ]) {
      const camped = JSON.parse(TEXT);
      Object.assign(camped.state.actors[3], change);
      expect(() => restore(JSON.stringify(camped), MAP, PROGRAMS, KINDS)).toThrow(
        /a monster on or walking onto the camp's ground/,
      );
    }
  });

  it("is refused when damaged, like any other", () => {
    const data = JSON.parse(TEXT);
    data.state.actors[0].hp = 19;
    expect(() => restore(JSON.stringify(data), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    // A version 4 snapshot cannot pass for version 5, or the other way round.
    const five = { ...JSON.parse(TEXT), version: 5 };
    expect(() => restore(JSON.stringify(five), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    five.spawns = hashSpawns([]);
    expect(() => restore(JSON.stringify(five), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
  });
});
