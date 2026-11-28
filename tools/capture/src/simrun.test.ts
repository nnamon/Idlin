import type { WorldEvent } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { ROSTER_ROWS } from "../../../packages/client/src/frame.ts";
import type { TickRecord } from "./metrics.ts";
import { blowAfter, crowdedMoment, fightIn, play } from "./simrun.ts";

const down = (tick: number, actor: number, kind: string): WorldEvent => ({
  type: "down",
  tick,
  actor,
  name: kind === "adventurer" ? "Ash" : "Wolf",
  kind,
  by: 0,
  x: 0,
  y: 0,
});
const hit = (tick: number, actor: number, target: number): WorldEvent => ({
  type: "hit",
  tick,
  actor,
  target,
  damage: 3,
  crit: false,
  damageType: "physical",
  hp: 1,
});
/** 400 ticks with nobody on the map and the given events. */
const run = (events: Record<number, WorldEvent[]>): TickRecord[] =>
  Array.from({ length: 400 }, (_, i) => ({ events: events[i] ?? [], actors: [] }));

describe("fightIn", () => {
  it("takes the first resident downed with a kill near it, and the last blow on that resident", () => {
    const found = fightIn(
      run({
        // A resident downed with no kill within 70 ticks.
        20: [down(20, 1, "adventurer")],
        // Blows on Ash (2) at 180 and 195, a blow on someone else at 198, Ash down at 200, a wolf down at 240.
        180: [hit(180, 9, 2)],
        195: [hit(195, 9, 2)],
        198: [hit(198, 9, 3)],
        200: [down(200, 2, "adventurer")],
        240: [down(240, 9, "wolf")],
        300: [down(300, 3, "adventurer"), down(300, 8, "wolf")],
      }),
    );
    expect(found).toEqual({ down: 200, kill: 240, blow: 195 });
  });

  it("is null when no resident is downed near a kill", () => {
    expect(
      fightIn(run({ 20: [down(20, 1, "adventurer")], 200: [down(200, 9, "wolf")] })),
    ).toBeNull();
  });

  it("finds the first blow from a tick on", () => {
    const blows = run({ 50: [hit(50, 1, 2)], 120: [hit(120, 1, 2)] });
    expect(blowAfter(blows, 51)).toBe(120);
    expect(blowAfter(blows, 121)).toBeNull();
  });
});

describe("crowdedMoment", () => {
  it("takes the earliest record with the most residents on the map, and where they stand", () => {
    const at = (ids: number[], view = { x: 0, y: 0 }): TickRecord => ({
      events: [],
      view,
      // A monster (99) is on the map too, and is not counted.
      actors: [...ids, 99].map((id) => ({ id, name: "", x: 10 + id * 2, y: 20 })),
    });
    const records = [at([1]), at([1, 2, 3], { x: 4, y: 5 }), at([1, 2]), at([1, 2, 3])];
    expect(crowdedMoment(records, new Set([1, 2, 3]), 0, 4)).toEqual({
      tick: 1,
      count: 3,
      x: 10,
      y: 15,
    });
    expect(crowdedMoment(records, new Set([1, 2, 3]), 2, 4).tick).toBe(3);
  });
});

describe("the page's lines in a run", () => {
  it("records a line for each resident the page lists, and the lines change", () => {
    const records = play(1, 15, 600);
    for (const record of records.slice(1)) expect(record.lines?.length).toBe(ROSTER_ROWS);
    const changes = records.filter((record, i) =>
      record.lines?.some((line) => {
        const was = records[i - 1]?.lines?.find((l) => l.id === line.id);
        return was !== undefined && was.text !== line.text;
      }),
    ).length;
    expect(changes).toBeGreaterThan(5);
  });
});
