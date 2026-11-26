import { describe, expect, it } from "vitest";
import { BAG_SLOTS, goodId, MAX_BANKED } from "./bag.ts";
import { placeConstants } from "./map.ts";
import { SKILLS } from "./skills.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import {
  type Actor,
  createWorld,
  hashWorld,
  restore,
  SnapshotError,
  snapshot,
  step,
  type World,
  type WorldEvent,
} from "./world.ts";

const MAP = firstLight();
const LOGS = goodId("logs");
const FISH = goodId("raw_fish");
const COOKED = goodId("cooked_fish");
// The chest is at (16, 9); (15, 9) is the `bank` place, next to it.
const BANK = { x: 15, y: 9 };
const AWAY = { x: 20, y: 11 };
const KINDS = { wolf: { hp: 10, damage: 1, windup: 5, recovery: 5, reach: 1 } };

const SOURCES: Record<string, string> = {
  deposit2: "otherwise -> deposit(logs, 2)",
  depositall: "otherwise -> deposit(logs, 2147483647)",
  withdraw100: "otherwise -> withdraw(cooked_fish, 100)",
  bankall: "otherwise -> bank_all",
  reader:
    "otherwise -> set c = carrying(logs); set b = banked(cooked_fish); set f = bag_free; set a = at_bank; set n = carrying(0); idle",
  stander: "otherwise -> wait(100)",
};
const hostile = [
  "deposit(0, 5)",
  "deposit(4, 5)",
  "deposit(0 - 1, 5)",
  "deposit(2147483647, 2147483647)",
  "deposit(logs, 0)",
  "deposit(logs, 0 - 5)",
  "deposit(logs, 0 - 2147483647)",
  "withdraw(0, 5)",
  "withdraw(4, 100)",
  "withdraw(cooked_fish, 0)",
  "withdraw(cooked_fish, 0 - 2147483647)",
  "withdraw(0 - 2147483647, 2147483647)",
];
hostile.forEach((call, i) => {
  SOURCES[`hostile${i}`] = `otherwise -> ${call}`;
});
const PROGRAMS = compileBots(SOURCES, placeConstants(MAP));

/** A world with one adventurer at `where`, which has made its first decision with an empty bag. */
function withOne(program: string, where = BANK): { world: World; ash: Actor } {
  const world = createWorld(MAP, 1, PROGRAMS, KINDS);
  step(world, [{ type: "spawn", name: "Ash", program, ...where }]);
  const ash = world.actors[0];
  if (!ash) throw new Error("no actor");
  return { world, ash };
}

/** Steps until the actor's next decision, and returns that tick's events. */
function decide(world: World): WorldEvent[] {
  for (let i = 0; i < 1_000; i++) {
    const events = step(world);
    if (events.some((e) => e.type === "decide" || e.type === "fault")) return events;
  }
  throw new Error("no decision");
}

describe("the bag and the bank", () => {
  it("deposits up to the count asked for, emptying slots from the first", () => {
    const { world, ash } = withOne("deposit2");
    ash.bag = [FISH, LOGS, LOGS, 0, LOGS, 0, 0, 0, 0, 0, 0, 0];
    const events = decide(world);
    expect(ash.bag).toEqual([FISH, 0, 0, 0, LOGS, 0, 0, 0, 0, 0, 0, 0]);
    expect(ash.bank).toEqual([2, 0, 0]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "deposit", good: "logs", count: 2 }),
    );
    decide(world);
    // Only one left to move; a third time there are none and nothing is reported.
    expect(ash.bank).toEqual([3, 0, 0]);
    expect(decide(world).some((e) => e.type === "deposit")).toBe(false);
    expect(ash.bank).toEqual([3, 0, 0]);
  });

  it("withdraws only as many as there are empty slots for, and nothing into a full bag", () => {
    const { world, ash } = withOne("withdraw100");
    ash.bank = [0, 0, 30];
    ash.bag[3] = LOGS;
    const events = decide(world);
    expect(ash.bag.filter((g) => g === COOKED)).toHaveLength(BAG_SLOTS - 1);
    expect(ash.bag[3]).toBe(LOGS);
    expect(ash.bank).toEqual([0, 0, 30 - (BAG_SLOTS - 1)]);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "withdraw", count: BAG_SLOTS - 1 }),
    );
    // The bag is full now: the next withdraw moves nothing.
    expect(decide(world).some((e) => e.type === "withdraw")).toBe(false);
    expect(ash.bank).toEqual([0, 0, 19]);
  });

  it("takes out no more than is banked", () => {
    const { world, ash } = withOne("withdraw100");
    ash.bank = [0, 0, 3];
    decide(world);
    expect(ash.bag.filter((g) => g === COOKED)).toHaveLength(3);
    expect(ash.bank).toEqual([0, 0, 0]);
  });

  it("banks everything with bank_all", () => {
    const { world, ash } = withOne("bankall");
    ash.bag = [LOGS, FISH, COOKED, LOGS, FISH, LOGS, 0, 0, 0, 0, 0, LOGS];
    ash.bank = [1, 1, 1];
    decide(world);
    expect(ash.bag.every((g) => g === 0)).toBe(true);
    expect(ash.bank).toEqual([5, 3, 2]);
  });

  it("keeps in the bag what the bank has no room for", () => {
    const { world, ash } = withOne("depositall");
    ash.bag = [LOGS, LOGS, LOGS, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    ash.bank = [MAX_BANKED - 1, 0, 0];
    decide(world);
    expect(ash.bank[0]).toBe(MAX_BANKED);
    expect(ash.bag.filter((g) => g === LOGS)).toHaveLength(2);
  });

  it("changes nothing away from the chest", () => {
    for (const program of ["deposit2", "depositall", "withdraw100", "bankall"]) {
      const { world, ash } = withOne(program, AWAY);
      ash.bag = [LOGS, LOGS, FISH, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ash.bank = [4, 4, 4];
      const before = hashWorld(world);
      const events = decide(world);
      expect(events.some((e) => e.type === "deposit" || e.type === "withdraw")).toBe(false);
      expect(ash.bag).toEqual([LOGS, LOGS, FISH, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(ash.bank).toEqual([4, 4, 4]);
      expect(hashWorld(world)).not.toBe(before);
    }
  });

  it("changes nothing for goods that do not exist or counts below 1", () => {
    hostile.forEach((call, i) => {
      const { world, ash } = withOne(`hostile${i}`);
      ash.bag = [LOGS, FISH, COOKED, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      ash.bank = [7, 7, 7];
      for (let k = 0; k < 3; k++) {
        const events = decide(world);
        expect(
          events.some((e) => e.type === "fault"),
          call,
        ).toBe(false);
        expect(
          events.some((e) => e.type === "deposit" || e.type === "withdraw"),
          call,
        ).toBe(false);
      }
      expect(ash.bag, call).toEqual([LOGS, FISH, COOKED, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(ash.bank, call).toEqual([7, 7, 7]);
    });
  });

  it("is read by carrying, banked, bag_free and at_bank", () => {
    const { world, ash } = withOne("reader");
    ash.bag = [LOGS, LOGS, FISH, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    ash.bank = [0, 0, 9];
    decide(world);
    expect(ash.memory.slice(0, 5)).toEqual([2, 9, BAG_SLOTS - 3, 1, 0]);
    const away = withOne("reader", AWAY);
    decide(away.world);
    expect(away.ash.memory.slice(0, 5)).toEqual([0, 0, BAG_SLOTS, 0, 0]);
  });
});

describe("a snapshot with skills, a bag and a bank", () => {
  function stocked(): World {
    const { world, ash } = withOne("stander");
    step(world, [{ type: "spawn", name: "Wolf", program: "stander", x: 22, y: 13, kind: "wolf" }]);
    ash.xp = [83, 1_154, 0, 5, 13_034_431];
    ash.bag = [LOGS, 0, FISH, 0, 0, 0, 0, 0, 0, 0, 0, COOKED];
    ash.bank = [10, 0, MAX_BANKED];
    return world;
  }

  it("restores everything and goes on the same", () => {
    const world = stocked();
    const copy = restore(snapshot(world), MAP, PROGRAMS, KINDS);
    expect(copy.actors[0]?.xp).toEqual([83, 1_154, 0, 5, 13_034_431]);
    expect(copy.actors[0]?.bag).toEqual(world.actors[0]?.bag);
    expect(copy.actors[0]?.bank).toEqual([10, 0, MAX_BANKED]);
    expect(hashWorld(copy)).toBe(hashWorld(world));
    for (let i = 0; i < 300; i++) {
      step(world);
      step(copy);
    }
    expect(hashWorld(copy)).toBe(hashWorld(world));
  });

  it("refuses contents no world could hold", () => {
    const text = snapshot(stocked());
    const breaks: ((actors: Record<string, unknown>[]) => void)[] = [
      (a) => ((a[0] as { xp: number[] }).xp[0] = -1),
      (a) => ((a[0] as { xp: number[] }).xp[0] = 200_000_001),
      (a) => ((a[0] as { xp: unknown[] }).xp[0] = "83"),
      (a) => (a[0] as { xp: number[] }).xp.push(0),
      (a) => ((a[0] as { bag: number[] }).bag[0] = 4),
      (a) => (a[0] as { bag: number[] }).bag.pop(),
      (a) => ((a[0] as { bank: number[] }).bank[0] = -3),
      (a) => ((a[0] as { bank: number[] }).bank[1] = 1.5),
      (a) => delete a[0]?.bank,
      // A monster has no skills and holds nothing.
      (a) => ((a[1] as { xp: number[] }).xp[SKILLS.indexOf("melee")] = 4),
      (a) => ((a[1] as { bag: number[] }).bag[0] = LOGS),
      (a) => ((a[1] as { bank: number[] }).bank[0] = 1),
    ];
    for (const change of breaks) {
      const data = JSON.parse(text);
      change(data.state.actors);
      expect(() => restore(JSON.stringify(data), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    }
  });
});
