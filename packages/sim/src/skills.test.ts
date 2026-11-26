import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { gainXp, levelFor, MAX_LEVEL, MAX_XP, noXp, SKILLS, XP_TABLE } from "./skills.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import { ADVENTURER, createWorld, type Input, step, type World, type WorldEvent } from "./world.ts";

const MAP = firstLight();
const melee = SKILLS.indexOf("melee");
const hitpoints = SKILLS.indexOf("hitpoints");

describe("the experience curve", () => {
  it("is pinned", () => {
    expect(XP_TABLE).toHaveLength(MAX_LEVEL + 1);
    expect([1, 2, 3, 10, 50, 92, 98, 99].map((level) => XP_TABLE[level])).toEqual([
      0, 83, 174, 1_154, 101_333, 6_517_254, 11_805_607, 13_034_431,
    ]);
    for (let level = 2; level <= MAX_LEVEL; level++)
      expect(XP_TABLE[level] as number).toBeGreaterThan(XP_TABLE[level - 1] as number);
  });

  it("gives each level from its exact threshold", () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(82)).toBe(1);
    expect(levelFor(83)).toBe(2);
    expect(levelFor(1_153)).toBe(9);
    expect(levelFor(1_154)).toBe(10);
    expect(levelFor(13_034_430)).toBe(98);
    expect(levelFor(13_034_431)).toBe(99);
    expect(levelFor(MAX_XP)).toBe(99);
  });

  it("reports a level gained only when the threshold is crossed, and stops at the cap", () => {
    const xp = noXp();
    expect(gainXp(xp, "fishing", 82)).toBe(0);
    expect(gainXp(xp, "fishing", 1)).toBe(2);
    expect(gainXp(xp, "fishing", 0)).toBe(0);
    expect(gainXp(xp, "fishing", -500)).toBe(0);
    expect(xp[SKILLS.indexOf("fishing")]).toBe(83);
    // One huge gain jumps straight to the level it reaches.
    expect(gainXp(xp, "cooking", 2_000_000_000)).toBe(99);
    expect(xp[SKILLS.indexOf("cooking")]).toBe(MAX_XP);
    expect(gainXp(xp, "cooking", 1_000)).toBe(0);
    expect(xp[SKILLS.indexOf("cooking")]).toBe(MAX_XP);
  });
});

describe("experience from fighting", () => {
  const PROGRAMS = compileBots(
    {
      fighter:
        'when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)\notherwise -> idle',
      biter: 'otherwise as "bite" -> attack(threat_x, threat_y)',
      stander: 'otherwise as "stand" -> wait(100)',
      reader:
        "otherwise -> set m = xp(melee); set l = level(melee); set h = level(hitpoints); set x = level(99); set y = xp(0 - 1); idle",
    },
    placeConstants(MAP),
  );
  const at = (name: string, program: string, x: number, y: number, kind?: string): Input => ({
    type: "spawn",
    name,
    program,
    x,
    y,
    ...(kind ? { kind } : {}),
  });
  const run = (world: World, ticks: number): WorldEvent[] => {
    const log: WorldEvent[] = [];
    for (let i = 0; i < ticks; i++) log.push(...step(world));
    return log;
  };

  it("gives Melee for every hitpoint a blow takes, and the level at the blow that crosses 83", () => {
    // A training dummy that never strikes back.
    const world = createWorld(MAP, 1, PROGRAMS, {
      dummy: { hp: 1_000, damage: 0, windup: 5, recovery: 0, reach: 1 },
    });
    step(world, [at("Ash", "fighter", 20, 11), at("Post", "stander", 21, 11, "dummy")]);
    const log = run(world, 400);
    const ash = world.actors[0];
    const hits = log.filter((e) => e.type === "hit" && e.actor === ash?.id);
    expect(hits.length).toBeGreaterThan(6);
    expect(ash?.xp[melee]).toBe(hits.length * 16);
    // Five blows make 80; the sixth makes 96, past 83, and the level comes with it.
    const levels = log.filter((e) => e.type === "level");
    expect(levels[0]).toMatchObject({ actor: ash?.id, skill: "melee", level: 2 });
    expect(levels[0]?.tick).toBe(hits[5]?.tick);
    expect(world.actors[1]?.xp.every((n) => n === 0)).toBe(true);
    expect(ash?.xp[hitpoints]).toBe(0);
  });

  it("counts only the hitpoints a finishing blow takes", () => {
    const world = createWorld(MAP, 1, PROGRAMS, {
      gnat: { hp: 2, damage: 0, windup: 5, recovery: 0, reach: 1 },
    });
    step(world, [at("Ash", "fighter", 20, 11), at("Gnat", "stander", 21, 11, "gnat")]);
    const log = run(world, 60);
    expect(log.some((e) => e.type === "down" && e.kind === "gnat")).toBe(true);
    expect(world.actors[0]?.xp[melee]).toBe(8);
  });

  it("gives Hitpoints for every hitpoint taken, and goes on after a fall", () => {
    const world = createWorld(MAP, 1, PROGRAMS, {
      wasp: { hp: 1_000, damage: 3, windup: 5, recovery: 0, reach: 1 },
    });
    step(world, [at("Ash", "stander", 20, 11), at("Wasp", "biter", 21, 11, "wasp")]);
    const log = run(world, 120);
    const ash = world.actors.find((a) => a.kind === ADVENTURER);
    const blows = log.filter((e) => e.type === "hit" && e.target === ash?.id);
    // 20 hitpoints at 3 a blow: six blows take 18, the seventh only the 2 left.
    expect(log.some((e) => e.type === "down" && e.actor === ash?.id)).toBe(true);
    expect(ash?.xp[hitpoints]).toBe(4 * (18 + 2));
    expect(blows.length).toBe(7);
    expect(ash?.xp[melee]).toBe(0);
  });

  it("is read by level and xp, which give 0 for anything that is not a skill", () => {
    const world = createWorld(MAP, 1, PROGRAMS);
    step(world, [at("Ash", "reader", 20, 11)]);
    const ash = world.actors[0];
    if (!ash) throw new Error("no actor");
    ash.xp[melee] = 1_154;
    ash.xp[hitpoints] = 82;
    run(world, 10);
    expect(ash.memory.slice(0, 5)).toEqual([1_154, 10, 1, 0, 0]);
  });
});
