// The walking city run with the 150-chatter crowd for three cycles, the break
// put by input at 11:00, 12:50 and 14:20 of each (slice piece 2): lift-off
// comes 300 ticks after each break, the next cycle's 0:00 at 13:00 or at
// lift-off, the later, and its legs plant 1,800 ticks after that. Snapshot and
// resume in each beat give the same hash.
import { readFileSync } from "node:fs";
import {
  ADVENTURER,
  aboard,
  beat,
  type Cycle,
  createCity,
  hashWorld,
  type Input,
  restore,
  snapshot,
  step,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { shippedPrograms } from "../../sim/src/testing.ts";
import { Chat } from "./chat.ts";
import { parseCrowd } from "./crowd.ts";

const PROGRAMS = shippedPrograms();
const CROWD = parseCrowd(
  readFileSync(new URL("../../../content/chat/crowd-150.txt", import.meta.url), "utf8"),
);
/** Where each cycle's break is put, in ticks from its 0:00: 11:00, 12:50 and 14:20. */
const BREAKS = [6600, 7700, 8600];

describe("three cycles of the city with the 150-chatter crowd", () => {
  it("lifts 300 ticks after each break and plants 1,800 ticks after each next 0:00", () => {
    const world = createCity(150, PROGRAMS);
    const chat = new Chat({ crowd: CROWD, start: world.tick });
    const cycle = (): Cycle => world.cycle as Cycle;
    const log = new Map<number, Input[]>();
    const beats: [number, string][] = [];
    const starts: number[] = [0];
    // A snapshot at the first tick of each beat up to the fourth legs-plant,
    // with the live world's hash AHEAD ticks later.
    const AHEAD = 100;
    const saved: { tick: number; beat: string; text: string; hash: string }[] = [];
    // Citizens off the deck half way through each peace, and the margin of
    // each citizen still outside at a lift.
    const peace: number[] = [];
    const winched: number[] = [];
    const plants = (): number => beats.filter(([, b]) => b === "legs").length;
    while (plants() < 4 || world.tick < (saved.at(-1)?.tick ?? 0) + AHEAD) {
      const inputs: Input[] = [...chat.take(world.tick)];
      const cycles = cycle().count;
      if (cycles <= 3 && world.tick === cycle().start + (BREAKS[cycles - 1] as number) - 1)
        inputs.push({ type: "break" });
      log.set(world.tick, inputs);
      const events = step(world, inputs);
      for (const e of events) {
        if (e.type === "winch")
          winched.push(world.actors.find((a) => a.id === e.actor)?.params[1] ?? -1);
        if (e.type !== "beat") continue;
        beats.push([e.tick, e.beat]);
        if (plants() <= 4)
          saved.push({ tick: e.tick, beat: e.beat, text: snapshot(world), hash: "" });
      }
      if (cycle().count !== cycles) starts.push(cycle().start);
      if (world.tick === cycle().start + 3000)
        peace.push(
          world.actors.filter((a) => a.kind === ADVENTURER && !aboard(world.atlas, a.x, a.y))
            .length,
        );
      for (const x of saved) if (x.tick + AHEAD === world.tick) x.hash = hashWorld(world);
    }
    const after = (name: string, before: string): number[] =>
      beats.filter(([, b], i) => b === name && beats[i - 1]?.[1] === before).map(([t]) => t);
    const breaks = after("break", "siege");
    expect(breaks).toEqual([6600, 7800 + 7700, 15800 + 8600]);
    expect(after("transit", "break")).toEqual(breaks.map((t) => t + 300));
    expect(starts).toEqual([0, 7800, 15800, 24700]);
    expect(beats.filter(([, b]) => b === "legs").map(([t]) => t)).toEqual(
      starts.map((t) => t + 1800),
    );
    const citizens = world.actors.filter((a) => a.kind === ADVENTURER);
    expect(citizens).toHaveLength(150);
    // They went out in the peace of each landing, and were home by each lift
    // but for a few whose chatters set `!margin 0`, which cuts it as fine as
    // it can be cut.
    expect(peace).toHaveLength(3);
    expect(peace.every((n) => n > 50)).toBe(true);
    expect(winched.length).toBeLessThan(15);
    expect(winched.every((margin) => margin === 0)).toBe(true);
    // Aboard as the fourth landing is set down, its ramp still up.
    expect(world.tick).toBe(26500 + AHEAD);
    expect(beat(world)?.beat).toBe("legs");
    expect(citizens.every((a) => aboard(world.atlas, a.x, a.y))).toBe(true);

    // A snapshot from each beat of each cycle resumes to the live world's hash.
    const names = "raid transit legs peace scouts sighting march siege break transit";
    expect(saved.map((s) => s.beat).join(" ")).toBe(
      [names, names, names, "raid transit legs"].join(" "),
    );
    for (const { tick, text, hash } of saved) {
      const resumed = restore(text, null, PROGRAMS);
      expect(resumed.tick).toBe(tick);
      while (resumed.tick < tick + AHEAD) step(resumed, log.get(resumed.tick) ?? []);
      expect([tick, hashWorld(resumed)]).toEqual([tick, hash]);
    }
  });
});
