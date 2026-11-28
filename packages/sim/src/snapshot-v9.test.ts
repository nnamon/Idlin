// A version 9 snapshot, from before weapons, knockback, flasks and arrows.
// fixtures/snapshot-v9.json was written by the code at commit 3c9dee4: seed
// 9009 on first-light with SOURCES, KINDS and SPAWNS below, Ash, Bryn and Cole
// put in with spawnsNearCamp running "stroller", then run to tick 132, the
// first tick at which a resident was winding up a blow (Cole, at (4, 4)
// facing south), another was recovering longer than a blade's 3 ticks (Ash,
// 5), and a monster was winding up (the wolf #7, at (5, 7) facing west).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adopt } from "./adopt.ts";
import { placeConstants } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import { FLASK_DRINKS, WEAPONS } from "./weapons.ts";
import {
  ADVENTURER,
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
const TEXT = readFileSync(new URL("./fixtures/snapshot-v9.json", import.meta.url), "utf8");

const reload = (text: string): World => restore(text, MAP, PROGRAMS, KINDS, SPAWNS);
const edited = (change: (data: { version: number; state: Record<string, unknown> }) => void) => {
  const data = JSON.parse(TEXT);
  change(data);
  return JSON.stringify(data);
};
const actorsOf = (data: { state: Record<string, unknown> }): Record<string, unknown>[] =>
  data.state.actors as Record<string, unknown>[];

describe("a version 9 snapshot", () => {
  it("restores with a blade and a full flask for each resident, its blows fitted to the blade", () => {
    const saved = JSON.parse(TEXT);
    expect(saved.version).toBe(9);
    const world = reload(TEXT);
    expect(world.tick).toBe(132);
    const [ash, bryn, cole] = world.actors;
    for (const resident of [ash, bryn, cole]) {
      expect(resident).toMatchObject({ kind: ADVENTURER, weapon: "blade", flask: FLASK_DRINKS });
      expect(resident).toMatchObject({ kills: 0, knockX: 0, knockY: 0 });
    }
    // Cole's wind-up of a version 9 blow is called off, with its mark, and
    // Ash's recovery comes down to a blade's longest.
    expect(actorsOf(saved)[2]).toMatchObject({ name: "Cole", windup: 4 });
    expect(cole).toMatchObject({ name: "Cole", windup: 0 });
    expect(actorsOf(saved)[0]).toMatchObject({ name: "Ash", recover: 5 });
    expect(ash).toMatchObject({ name: "Ash", recover: WEAPONS.blade.recovery });
    // The wolf's wind-up goes on as it was, facing west, the way of its mark.
    const wolf = world.actors.find((a) => a.id === 7);
    expect(wolf).toMatchObject({ kind: "wolf", windup: 4, aim: 4, weapon: "", flask: 0 });
    expect(world.marks).toEqual([{ x: 4, y: 7, by: 7 }]);
    expect(world.arrows).toEqual([]);
    // What version 9 had stays.
    expect(world.actors.map((a) => a.hp)).toEqual(actorsOf(saved).map((a) => a.hp));
    expect(world.actors.map((a) => a.xp)).toEqual(actorsOf(saved).map((a) => a.xp));

    for (let t = 0; t < 2000; t++) step(world);
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    const resumed = reload(again);
    expect(resumed).toEqual(world);
    for (let t = 0; t < 500; t++) {
      step(world);
      step(resumed);
    }
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("is refused when damaged, and cannot pass for version 10", () => {
    // Its hash is checked before the blows are fitted, so a change to a wind-up is still damage.
    expect(() =>
      reload(edited((d) => Object.assign(actorsOf(d)[2] as object, { windup: 3 }))),
    ).toThrow(/damaged/);
    expect(() =>
      reload(edited((d) => Object.assign(actorsOf(d)[0] as object, { hp: 19 }))),
    ).toThrow(/damaged/);
    expect(() =>
      reload(
        edited((d) => {
          d.version = 10;
        }),
      ),
    ).toThrow(SnapshotError);
    // Garbage where version 9 had actors is refused, not thrown about.
    expect(() =>
      reload(
        edited((d) => {
          d.state.actors = [{ path: 7, memory: null }];
        }),
      ),
    ).toThrow(SnapshotError);
  });

  it("is carried over to new programs, its resident's blow called off as it no longer fits", () => {
    const programs = compileBots(
      { ...SOURCES, stroller: SOURCES.stroller.replace("wait(20)", "wait(21)") },
      placeConstants(MAP),
    );
    const { world, changes } = adopt(TEXT, MAP, programs, KINDS, SPAWNS);
    expect(changes).toContain(
      "Cole (#3): its attack is called off, as it no longer reaches the tiles marked",
    );
    expect(world.actors.find((a) => a.name === "Ash")?.recover).toBe(WEAPONS.blade.recovery);
    expect(world.marks).toEqual([{ x: 4, y: 7, by: 7 }]);
  });
});
