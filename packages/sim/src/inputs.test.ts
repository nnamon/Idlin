import { describe, expect, it } from "vitest";
import { NEWCOMER_PROGRAM } from "./inputs.ts";
import { place } from "./map.ts";
import { shippedMonsters, shippedPrograms, shippedWorld } from "./testing.ts";
import {
  ADVENTURER,
  createWorld,
  hashWorld,
  type Input,
  restore,
  snapshot,
  spawnsNearCamp,
  step,
  type World,
} from "./world.ts";

const ATLAS = shippedWorld();
const MONSTERS = shippedMonsters(ATLAS);
const PROGRAMS = { ...shippedPrograms(ATLAS), ...MONSTERS.programs };

const newWorld = (): World => {
  const world = createWorld(ATLAS, 4, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
  step(world, spawnsNearCamp(world, [{ name: "Ash", program: "wanderer" }]));
  return world;
};

const join = (account: string, name: string): Input => ({
  type: "join",
  account,
  name,
  role: "viewer",
});

describe("join", () => {
  it("makes a citizen named by the username, on the newcomer's program, near the camp", () => {
    const world = newWorld();
    step(world, [join("1001", "xXxKittyKatxXx"), join("1002", "goofguy")]);
    const made = world.actors.filter((actor) => actor.name !== "Ash" && actor.kind === ADVENTURER);
    expect(made.map((actor) => actor.name)).toEqual(["xXxKittyKatxXx", "goofguy"]);
    const camp = place(ATLAS, "camp");
    for (const actor of made) {
      expect(actor.program).toBe(NEWCOMER_PROGRAM);
      expect(Math.abs(actor.x - camp.x) + Math.abs(actor.y - camp.y)).toBeLessThan(6);
    }
    expect(made[0]?.x !== made[1]?.x || made[0]?.y !== made[1]?.y).toBe(true);
  });

  it("changes nothing for a name already in the world, in any capitals", () => {
    const once = newWorld();
    step(once, [join("1001", "goofguy")]);
    const twice = newWorld();
    step(twice, [join("1001", "goofguy"), join("1001", "GoofGuy"), join("1003", "goofguy")]);
    expect(hashWorld(twice)).toBe(hashWorld(once));
  });

  it("takes a 25-character username, and a snapshot holding one restores", () => {
    const world = newWorld();
    const name = "a_very_long_username_25ch";
    expect(name).toHaveLength(25);
    step(world, [join("1001", name)]);
    expect(world.actors.some((actor) => actor.name === name)).toBe(true);
    const back = restore(snapshot(world), ATLAS, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
    expect(hashWorld(back)).toBe(hashWorld(world));
  });

  it("is dropped in a world without the newcomer's program", () => {
    const world = createWorld(ATLAS, 4, MONSTERS.programs, MONSTERS.kinds, MONSTERS.spawns);
    const copy = createWorld(ATLAS, 4, MONSTERS.programs, MONSTERS.kinds, MONSTERS.spawns);
    step(world, [join("1001", "goofguy")]);
    step(copy);
    expect(hashWorld(world)).toBe(hashWorld(copy));
    expect(world.actors.some((actor) => actor.name === "goofguy")).toBe(false);
  });
});

describe("hostile inputs", () => {
  const getter = (): unknown =>
    Object.defineProperty({ type: "join" }, "name", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
    });

  const hostile = (): unknown[] => [
    null,
    undefined,
    0,
    "join",
    [],
    {},
    { type: "join" },
    { type: "join", account: "1", name: "ab", role: "viewer" },
    { type: "join", account: "1", name: "x".repeat(26), role: "viewer" },
    { type: "join", account: "1", name: "has space", role: "viewer" },
    { type: "join", account: "1", name: "goofguy", role: "admin" },
    { type: "join", account: "", name: "goofguy", role: "viewer" },
    { type: "join", account: 1, name: "goofguy", role: "viewer" },
    { type: "join", account: "1", name: ["goofguy"], role: "viewer" },
    { type: "join", account: "1".repeat(41), name: "goofguy", role: "viewer" },
    getter(),
    { type: "go", account: "1", words: "river" },
    { type: "go", account: 7, words: { toString: () => "river" } },
    { type: "param", account: "1", name: "margin", value: "150" },
    { type: "say", account: "1", id: "m", text: "hello" },
    { type: "mod", by: "1", action: { action: "doors", open: false } },
    { type: "unsay", id: "m" },
    { type: "wake", account: "1", record: { name: "goofguy" } },
    { type: "spawn", name: "", program: "wanderer", x: 0, y: 0 },
    { type: "spawn", name: "Bad", program: "nonesuch", x: 0, y: 0 },
    { type: "spawn", name: "Bad", program: "wanderer", x: 1e12, y: -0.5 },
    { type: "__proto__", name: "goofguy" },
    { type: "constructor" },
  ];

  it("change nothing and never throw, one at a time or 10,000 in a tick", () => {
    const calm = newWorld();
    const struck = newWorld();
    const flood: unknown[] = [];
    while (flood.length < 10_000) flood.push(...hostile());
    flood.length = 10_000;
    for (let tick = 0; tick < 50; tick++) {
      step(calm);
      expect(() =>
        step(struck, tick === 0 ? (flood as Input[]) : (hostile() as Input[])),
      ).not.toThrow();
    }
    expect(hashWorld(struck)).toBe(hashWorld(calm));
    expect(struck.actors.map((actor) => actor.name)).toEqual(
      calm.actors.map((actor) => actor.name),
    );
  });
});
