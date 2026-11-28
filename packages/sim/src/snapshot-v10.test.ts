// A version 10 snapshot, from before statuses. fixtures/snapshot-v10.json was
// written by the code at commit 8c007cb: seed 1010 on first-light with
// SOURCES, KINDS and SPAWNS below, Ash with a blade, Bryn with a maul and
// Cole with a bow put in with spawnsNearCamp running "stroller", then run to
// tick 131, the first tick at which a resident was winding up a blow (Cole,
// at (4, 5) facing east), a monster was too (the wolf #6, at (5, 5) facing
// west), and a monster had been knocked back less than a tile (#6 again).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adopt } from "./adopt.ts";
import { placeConstants } from "./map.ts";
import { noStatus } from "./status.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import {
  hashWorld,
  restore,
  SNAPSHOT_VERSION,
  SnapshotError,
  snapshot,
  step,
  type World,
} from "./world.ts";

const MAP = firstLight();
const SOURCES = {
  stroller:
    'bot "Stroller"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> walk_to(deep_wood); wait(20)\n',
  biter:
    'bot "Biter"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\nwhen threat_distance < 12 -> walk_to(threat_x, threat_y)\notherwise -> wander; wait(10)\n',
};
const KINDS = { wolf: { hp: 30, damage: 2, windup: 7, recovery: 9, reach: 1 } };
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
const TEXT = readFileSync(new URL("./fixtures/snapshot-v10.json", import.meta.url), "utf8");

const reload = (text: string): World => restore(text, MAP, PROGRAMS, KINDS, SPAWNS);
const edited = (change: (data: { version: number; state: Record<string, unknown> }) => void) => {
  const data = JSON.parse(TEXT);
  change(data);
  return JSON.stringify(data);
};
const actorsOf = (data: { state: Record<string, unknown> }): Record<string, unknown>[] =>
  data.state.actors as Record<string, unknown>[];

describe("a version 10 snapshot", () => {
  it("restores with nobody under a status, its blows going on as they were", () => {
    const saved = JSON.parse(TEXT);
    expect(saved.version).toBe(10);
    const world = reload(TEXT);
    expect(world.tick).toBe(131);
    for (const actor of world.actors) expect(actor.status).toEqual(noStatus());
    // Everything version 10 had stays, the wind-ups and knockback with it.
    const fields = ["id", "x", "y", "hp", "windup", "recover", "weapon", "aim", "knockX", "knockY"];
    const pick = (a: object) => fields.map((f) => (a as Record<string, unknown>)[f]);
    expect(world.actors.map(pick)).toEqual(actorsOf(saved).map(pick));
    expect(world.actors.find((a) => a.name === "Cole")).toMatchObject({ weapon: "bow", windup: 3 });
    expect(world.actors.find((a) => a.id === 6)).toMatchObject({ windup: 7, knockX: 1 });
    expect(world.marks).toEqual(saved.state.marks);

    for (let t = 0; t < 2000; t++) step(world);
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    expect(SNAPSHOT_VERSION).toBe(11);
    const resumed = reload(again);
    expect(resumed).toEqual(world);
    for (let t = 0; t < 500; t++) {
      step(world);
      step(resumed);
    }
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("is refused when damaged, and cannot pass for version 11", () => {
    expect(() =>
      reload(edited((d) => Object.assign(actorsOf(d)[2] as object, { windup: 2 }))),
    ).toThrow(/damaged/);
    // Version 11 holds a status on every actor, which this one has not.
    expect(() =>
      reload(
        edited((d) => {
          d.version = 11;
        }),
      ),
    ).toThrow(SnapshotError);
    expect(() =>
      reload(
        edited((d) => {
          d.state.actors = [{ path: 7, memory: null }];
        }),
      ),
    ).toThrow(SnapshotError);
  });

  it("is carried over to new programs, with nobody under a status", () => {
    const programs = compileBots(
      { ...SOURCES, stroller: SOURCES.stroller.replace("wait(20)", "wait(21)") },
      placeConstants(MAP),
    );
    const { world, changes } = adopt(TEXT, MAP, programs, KINDS, SPAWNS);
    expect(changes).toContain('cleared the memory and rule of 3 actor(s) running "stroller"');
    for (const actor of world.actors) expect(actor.status).toEqual(noStatus());
    expect(world.actors.find((a) => a.name === "Cole")?.windup).toBe(3);
  });
});
