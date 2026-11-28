// A version 8 snapshot, from before nodes and burnt fish.
// fixtures/snapshot-v8.json was written by the code at commit 852a5aa: seed
// 8008 on first-light with SOURCES, KINDS and SPAWNS below, Ash, Bryn and Cole
// put in with spawnsNearCamp running "stroller", then 3,000 ticks run. Before
// the snapshot was taken, Ash was given a bag of [1, 2, 3, 0, ..., 0, 3] and a
// bank of [5, 2, 7], and Bryn a bank of [0, 9, 0], as nothing could gather
// goods in that version.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOODS } from "./bag.ts";
import { placeConstants } from "./map.ts";
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
const TEXT = readFileSync(new URL("./fixtures/snapshot-v8.json", import.meta.url), "utf8");

const reload = (text: string): World => restore(text, MAP, PROGRAMS, KINDS, SPAWNS);
/** The fixture, parsed, with `change` made to it, as text again. */
const edited = (change: (data: { version: number; state: Record<string, unknown> }) => void) => {
  const data = JSON.parse(TEXT);
  change(data);
  return JSON.stringify(data);
};
type RawActor = Record<string, unknown> & { bag: unknown[]; bank: unknown[] };
const actorsOf = (data: { state: Record<string, unknown> }): RawActor[] =>
  data.state.actors as RawActor[];

describe("a version 8 snapshot", () => {
  it("restores with every bank padded for the goods added since, and goes on", () => {
    expect(JSON.parse(TEXT).version).toBe(8);
    expect(GOODS.length).toBe(4);
    const world = reload(TEXT);
    expect(world.tick).toBe(3001);
    const [ash, bryn, cole] = world.actors;
    expect(ash?.bag).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
    expect(ash?.bank).toEqual([5, 2, 7, 0]);
    expect(bryn?.bank).toEqual([0, 9, 0, 0]);
    expect(cole?.bank).toEqual([0, 0, 0, 0]);
    // What version 8 had stays: deaths, experience, hitpoints.
    expect(world.actors.map((a) => a.deaths)).toEqual([4, 3, 4]);
    expect(ash?.xp).toEqual([384, 380, 0, 0, 0]);
    // First light has no nodes.
    expect(world.nodes).toEqual([]);
    for (let t = 0; t < 2000; t++) step(world);
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    expect(SNAPSHOT_VERSION).toBe(10);
    const resumed = reload(again);
    expect(resumed).toEqual(world);
    for (let t = 0; t < 500; t++) {
      step(world);
      step(resumed);
    }
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("is refused with a good its version did not have, or a bank of the wrong length", () => {
    const forged: [string, (data: { state: Record<string, unknown> }) => void][] = [
      ["a burnt fish in the bag", (d) => ((actorsOf(d)[0] as RawActor).bag[3] = 4)],
      ["a good past every list", (d) => ((actorsOf(d)[0] as RawActor).bag[3] = 5)],
      ["a burnt fish in the bank", (d) => (actorsOf(d)[0] as RawActor).bank.push(1)],
      ["an empty count for it", (d) => (actorsOf(d)[2] as RawActor).bank.push(0)],
      ["a bank one short", (d) => (actorsOf(d)[2] as RawActor).bank.pop()],
      ["a bank that is not a list", (d) => ((actorsOf(d)[1] as RawActor).bank = { 1: 9 } as never)],
      ["no bag", (d) => delete (actorsOf(d)[0] as Record<string, unknown>).bag],
      ["a count that is not whole", (d) => ((actorsOf(d)[1] as RawActor).bank[1] = 9.5)],
    ];
    for (const [what, change] of forged)
      expect(() => reload(edited(change)), what).toThrow(SnapshotError);
  });

  it("has its nodes from the ground it is restored on, whatever it says", () => {
    const claimed = edited((d) => {
      d.state.nodes = [{ left: 3, back: 0 }];
    });
    expect(reload(claimed).nodes).toEqual([]);
  });

  it("is refused when damaged, and cannot pass for version 9", () => {
    expect(() =>
      reload(
        edited((d) => {
          (actorsOf(d)[0] as RawActor).hp = 6;
        }),
      ),
    ).toThrow(SnapshotError);
    expect(() =>
      reload(
        edited((d) => {
          d.version = 9;
        }),
      ),
    ).toThrow(SnapshotError);
    // Even given the fields version 9 adds, its hash is a version 8 hash.
    expect(() =>
      reload(
        edited((d) => {
          d.version = 9;
          d.state.nodes = [];
          for (const actor of actorsOf(d)) actor.bank.push(0);
        }),
      ),
    ).toThrow(/damaged/);
    expect(() =>
      reload(
        edited((d) => {
          d.version = 11;
        }),
      ),
    ).toThrow(/not 4 to 10/);
  });
});
