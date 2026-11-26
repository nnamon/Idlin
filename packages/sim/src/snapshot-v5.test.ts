// A version 5 snapshot, saved by the code from before skills and the bank,
// still restores. fixtures/snapshot-v5.json was written by that code (commit
// 6fd86c1): seed 5005 on first-light with SOURCES, KINDS and SPAWNS below,
// Ash, Bryn and Cole put in with spawnsNearCamp running "stroller", then 3,000
// ticks run and the snapshot taken. Wolves had come and been fought by then.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import { hashWorld, restore, SNAPSHOT_VERSION, SnapshotError, snapshot, step } from "./world.ts";

const MAP = firstLight();
const SOURCES = {
  stroller:
    'bot "Stroller"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> walk_to(deep_wood); wait(20)\n',
  biter:
    'bot "Biter"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\nwhen threat_distance < 12 -> walk_to(threat_x, threat_y)\notherwise -> wander; wait(10)\n',
};
const KINDS = { wolf: { hp: 30, damage: 2, windup: 8, recovery: 10, reach: 1 } };
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
const TEXT = readFileSync(new URL("./fixtures/snapshot-v5.json", import.meta.url), "utf8");

describe("a version 5 snapshot", () => {
  it("restores with no experience and empty bags and banks, and goes on", () => {
    expect(JSON.parse(TEXT).version).toBe(5);
    const world = restore(TEXT, MAP, PROGRAMS, KINDS, SPAWNS);
    expect(world.tick).toBe(3001);
    expect(world.actors.map((a) => a.name)).toEqual(["Ash", "Bryn", "Cole"]);
    for (const actor of world.actors) {
      expect(actor.xp).toEqual([0, 0, 0, 0, 0]);
      expect(actor.bag.every((slot) => slot === 0)).toBe(true);
      expect(actor.bank).toEqual([0, 0, 0]);
    }
    // The strollers walk to the deep wood, where the wolves come out, and learn from it.
    for (let t = 0; t < 3000; t++) step(world);
    expect(world.actors.some((a) => (a.xp[0] as number) > 0)).toBe(true);
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    expect(hashWorld(restore(again, MAP, PROGRAMS, KINDS, SPAWNS))).toBe(hashWorld(world));
  });

  it("is refused when damaged, and cannot pass for version 6", () => {
    const damaged = JSON.parse(TEXT);
    damaged.state.actors[0].hp = 11;
    expect(() => restore(JSON.stringify(damaged), MAP, PROGRAMS, KINDS, SPAWNS)).toThrow(
      SnapshotError,
    );
    const six = { ...JSON.parse(TEXT), version: 6 };
    expect(() => restore(JSON.stringify(six), MAP, PROGRAMS, KINDS, SPAWNS)).toThrow(SnapshotError);
  });
});
