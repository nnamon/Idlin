// A version 11 snapshot, from before accounts, params, tokens and flags were
// kept. fixtures/snapshot-v11.json was written by the code at commit b38cc21:
// seed 1010 on first-light with SOURCES below, Ash put in with spawnsNearCamp
// running "stroller", goofguy joined from account 1001 on the tick after (as
// version 11's newcomer program, "wanderer"), then run to tick 60.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { FLAG_NONE, HEED_NONE, MAX_TOKENS } from "./orders.ts";
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
  wanderer: 'bot "Wanderer"\notherwise -> wander; wait(10)\n',
};
const PROGRAMS = compileBots(SOURCES, placeConstants(MAP));
const TEXT = readFileSync(new URL("./fixtures/snapshot-v11.json", import.meta.url), "utf8");

const reload = (text: string): World => restore(text, MAP, PROGRAMS);
const edited = (change: (data: { version: number; state: Record<string, unknown> }) => void) => {
  const data = JSON.parse(TEXT);
  change(data);
  return JSON.stringify(data);
};

describe("a version 11 snapshot", () => {
  it("restores with no account, flag or params set and a full set of tokens, and goes on", () => {
    expect(JSON.parse(TEXT).version).toBe(11);
    const world = reload(TEXT);
    expect(world.tick).toBe(60);
    expect(world.actors.map((a) => a.name)).toEqual(["Ash", "goofguy"]);
    for (const actor of world.actors) {
      expect(actor).toMatchObject({
        account: "",
        params: [],
        heard: 60,
        tokens: MAX_TOKENS,
        tokenAt: 0,
        flag: FLAG_NONE,
        heed: HEED_NONE,
      });
    }
    // Version 11 did not keep goofguy's account, so its chatter's orders find no citizen.
    const ordered = reload(TEXT);
    step(ordered, [{ type: "go", account: "1001", words: "camp" }]);
    step(world);
    expect(hashWorld(ordered)).toBe(hashWorld(world));

    for (let t = 0; t < 1000; t++) step(world);
    const again = snapshot(world);
    expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
    expect(SNAPSHOT_VERSION).toBe(12);
    const resumed = reload(again);
    expect(resumed).toEqual(world);
    for (let t = 0; t < 500; t++) {
      step(world);
      step(resumed);
    }
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("is refused when damaged, and cannot pass for version 12", () => {
    expect(() =>
      reload(edited((d) => Object.assign((d.state.actors as object[])[0] as object, { hp: 19 }))),
    ).toThrow(/damaged/);
    expect(() =>
      reload(
        edited((d) => {
          d.version = 12;
        }),
      ),
    ).toThrow(SnapshotError);
    expect(() =>
      reload(
        edited((d) => {
          d.version = 13;
        }),
      ),
    ).toThrow(/not 4 to 12/);
  });
});
