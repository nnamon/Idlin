// The determinism rule for chat: the same seed and the same log of inputs give
// the same world, and a snapshot taken partway resumes to the same hash.
import {
  ADVENTURER,
  createWorld,
  hashWorld,
  type Input,
  restore,
  snapshot,
  step,
  type World,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { shippedMonsters, shippedPrograms, shippedWorld } from "../../sim/src/testing.ts";
import { Chat } from "./chat.ts";
import { parseCrowd } from "./crowd.ts";

const ATLAS = shippedWorld();
const MONSTERS = shippedMonsters(ATLAS);
const PROGRAMS = { ...shippedPrograms(ATLAS), ...MONSTERS.programs };
const newWorld = (seed: number): World =>
  createWorld(ATLAS, seed, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);

const CROWD = parseCrowd(
  [
    "seed 50",
    "names joshyboy88 xXxKittyKatxXx goofguy pixel_pete moss_and_mud Ravenclaw_Rae dunkmaster3000",
    "names tinytoaster quietkoala LuckyLuka_ brb_snacks SirNapsAlot frogsong_ zzz_jen OatmilkOtis",
    "names captain_crumb hollowhank minty_mae greeb0 Kestrel_Kev Lowkey_Lumi spoonfedsam turbo_tess",
    "names NovaNiko bigsoup42 owlbert_ ferris_wheel22 Mistr_Moth jellybean_jo chunkyMonk3y",
    "names salty_sailor_ WillowWisp_ tacoTuesday9 cr1spy_bacon Grumpy_Gus nightowl_nia BarnabyBean",
    "names vexx_ hazelnutHal p0tatoqueen dizzyduck sundae_sam Arlo_Arcade velvetvole bloopbloop",
    "names tofu_tim the_real_rook MarbleMika crankyKai_ lilsprout_",
    "00:00 +20 regulars over 20s",
    "00:00 +10 commanders over 20s",
    "00:30 +10 talkers over 30s",
    "01:00 +9 lurkers over 1m",
    "02:00 +1 spammers",
    "05:00 * 50% !home",
  ].join("\n"),
);

/** Runs a world with the crowd for `ticks`, keeping each tick's inputs as a log line and a snapshot at `at`. */
const live = (seed: number, ticks: number, at: number) => {
  const world = newWorld(seed);
  const chat = new Chat({ crowd: CROWD, start: world.tick });
  const log: string[] = [];
  let saved = "";
  for (let i = 0; i < ticks; i++) {
    if (world.tick === at) saved = snapshot(world);
    const inputs = chat.take(world.tick);
    log.push(JSON.stringify({ tick: world.tick, inputs }));
    step(world, inputs);
  }
  return { world, log, saved };
};

const replay = (world: World, log: readonly string[]): World => {
  for (const line of log) {
    const { tick, inputs } = JSON.parse(line) as { tick: number; inputs: Input[] };
    if (tick < world.tick) continue;
    expect(tick).toBe(world.tick);
    step(world, inputs);
  }
  return world;
};

describe("a world with chat", () => {
  it("is the same from the same seed and log, and a snapshot partway resumes to the same hash", () => {
    const ticks = 4000;
    const { world, log, saved } = live(3, ticks, 1500);
    expect(world.actors.filter((actor) => actor.kind === ADVENTURER)).toHaveLength(50);
    expect(log.filter((line) => line.includes('"go"')).length).toBeGreaterThan(50);
    expect(hashWorld(live(3, ticks, 1500).world)).toBe(hashWorld(world));
    expect(hashWorld(replay(newWorld(3), log))).toBe(hashWorld(world));
    const resumed = restore(saved, ATLAS, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
    expect(resumed.tick).toBe(1500);
    expect(hashWorld(replay(resumed, log))).toBe(hashWorld(world));
    // And the log matters: the same seed without it is another world.
    const quiet = newWorld(3);
    while (quiet.tick < world.tick) step(quiet);
    expect(hashWorld(quiet)).not.toBe(hashWorld(world));
  });
});
