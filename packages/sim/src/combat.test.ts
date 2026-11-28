import { describe, expect, it } from "vitest";
import { atlasOf } from "./atlas.ts";
import { NO_THREAT } from "./brain.ts";
import { blow } from "./hit.ts";
import { isWalkable, placeConstants } from "./map.ts";
import { XP_TABLE } from "./skills.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import { blowShape } from "./weapons.ts";
import {
  ADVENTURER,
  ADVENTURER_KIND,
  blowsOf,
  checkKinds,
  createWorld,
  DOWN_TICKS,
  hashWorld,
  type Input,
  KindError,
  type Kinds,
  MAX_ACTOR_ID,
  readMessage,
  restore,
  SnapshotError,
  snapshot,
  step,
  viewerMessage,
  type World,
  type WorldEvent,
} from "./world.ts";

const MAP = firstLight();
const KINDS: Kinds = {
  wolf: { hp: 12, damage: 5, windup: 10, recovery: 8, reach: 2 },
  brute: { hp: 500, damage: 30, windup: 10, recovery: 4, reach: 1 },
  thug: { hp: 500, damage: 12, windup: 10, recovery: 4, reach: 1 },
  slow: { hp: 500, damage: 1, windup: 30, recovery: 4, reach: 1 },
  snap: { hp: 500, damage: 30, windup: 1, recovery: 4, reach: 3 },
};
const PROGRAMS = compileBots(
  {
    // Strikes at whoever is nearest, wherever they are.
    biter: 'otherwise as "bite" -> attack(threat_x, threat_y)',
    stander: 'otherwise as "stand" -> wait(100)',
    runner: "otherwise -> flee(0, 0)",
    dodger: `when danger_here > 0 as "step out" -> step_clear
otherwise as "watch" -> idle`,
    fighter: `when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
otherwise as "wait for it" -> idle`,
    // As fighter, and follows what its blows knock back.
    chaser: `when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
otherwise as "close in" -> step_to(threat_x, threat_y)`,
    coward: `when threat_distance < 6 as "run" -> flee(threat_x, threat_y)
otherwise as "calm" -> idle`,
    lonely: `when threat_distance == ${NO_THREAT} and threat_hp == 0 and hp == max_hp as "alone" -> idle
otherwise as "company" -> idle`,
    meter: "otherwise -> set seen = danger_here; idle",
    east: "otherwise -> walk_to(27, 11)",
    wild: "otherwise -> attack(2147483647, 0 - 2147483647)",
    self: "otherwise -> attack(self_x, self_y)",
    far: "otherwise -> flee(2147483647, 2147483647)",
    gauge: "otherwise -> set seen = threat_recovering; wait(5)",
    stepper: "otherwise -> step_to(20, 11)",
    stepwild: "otherwise -> step_to(2147483647, 0 - 2147483647)",
  },
  placeConstants(MAP),
);

// The camp is at (14, 9) with open ground round it.
const at = (name: string, program: string, x: number, y: number, kind?: string): Input => ({
  type: "spawn",
  name,
  program,
  x,
  y,
  ...(kind ? { kind } : {}),
});

function fight(inputs: Input[], seed = 1): World {
  const world = createWorld(MAP, seed, PROGRAMS, KINDS);
  step(world, inputs);
  return world;
}

function run(world: World, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...step(world));
  return log;
}

const named = (world: World, name: string) => world.actors.find((a) => a.name === name);

describe("fights", () => {
  it("a telegraphed hit lands on an actor that stays and misses one that steps out in time", () => {
    const stay = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "stander", 15, 11)]);
    const stayed = run(stay, 60);
    const hits = stayed.filter((e) => e.type === "hit");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits[0]).toMatchObject({ actor: 1, target: 2, damage: 5, hp: 15 });
    // The tiles were marked for the whole wind-up before the first blow.
    // (The very first attack began in the tick the two were spawned, before this log starts.)
    const began = stayed.find((e) => e.type === "attack");
    expect(began).toMatchObject({
      actor: 1,
      lands: 10,
      tiles: [
        { x: 15, y: 11 },
        { x: 16, y: 11 },
      ],
    });
    const landed = stayed.find((e) => e.type === "hit" && e.tick > (began as WorldEvent).tick);
    expect((landed as WorldEvent).tick - (began as WorldEvent).tick).toBe(10);

    const leave = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "dodger", 15, 11)]);
    const left = run(leave, 600);
    expect(left.filter((e) => e.type === "hit")).toEqual([]);
    expect(left.filter((e) => e.type === "miss").length).toBeGreaterThan(20);
    expect(named(leave, "Ash")?.hp).toBe(ADVENTURER_KIND.hp);
  });

  it("an attacker stands still through wind-up and recovery, and its marks last exactly the wind-up", () => {
    const world = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "stander", 20, 11)]);
    const wolf = named(world, "Wolf");
    let marked = 0;
    let busy = 0;
    for (let i = 0; i < 18; i++) {
      step(world);
      if (world.marks.length > 0) marked++;
      if ((wolf?.windup ?? 0) > 0 || (wolf?.recover ?? 0) > 0) busy++;
      expect([wolf?.x, wolf?.y]).toEqual([14, 11]);
    }
    // One attack: marks for the ten ticks before it lands, then recovery until the eighth tick after.
    expect(marked).toBe(10);
    expect(busy).toBe(17);
  });

  it("a monster with no hitpoints left is gone, with its marks, and the world carries on", () => {
    const world = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "fighter", 15, 11)]);
    const log = run(world, 200);
    const down = log.find((e) => e.type === "down");
    expect(down).toMatchObject({ actor: 1, name: "Wolf", kind: "wolf", by: 2, x: 14, y: 11 });
    expect(world.actors.map((a) => a.name)).toEqual(["Ash"]);
    expect(world.marks).toEqual([]);
    // Ash's level-1 blow is 7, or 14 on a crit, and the blows go on until the twelve hitpoints are gone.
    const blows = log.flatMap((e) => (e.type === "hit" && e.target === 1 ? [e] : []));
    for (const b of blows) expect(b.damage).toBe(b.crit ? 14 : 7);
    const total = blows.reduce((sum, b) => sum + b.damage, 0);
    expect(total).toBeGreaterThanOrEqual(12);
    expect(total - (blows.at(-1)?.damage ?? 0)).toBeLessThan(12);
    // Ids are never reused, and the survivor goes on deciding.
    step(world, [at("Late", "stander", 14, 9)]);
    expect(named(world, "Late")?.id).toBe(3);
    expect(run(world, 50).some((e) => e.type === "decide" && e.actor === 2)).toBe(true);
  });

  it("an adventurer's blow is the base blow of its Melee level, doubled on one swing in 20", () => {
    const kinds: Kinds = { post: { hp: 100_000, damage: 0, windup: 10, recovery: 4, reach: 1 } };
    const world = createWorld(MAP, 3, PROGRAMS, kinds);
    // The blade knocks the post back a quarter of a tile a blow, so Ash follows it.
    step(world, [at("Ash", "chaser", 20, 9), at("Post", "stander", 21, 9, "post")]);
    const ash = named(world, "Ash") as World["actors"][number];
    ash.xp[0] = XP_TABLE[10] as number;
    let level = 10;
    let swings = 0;
    let crits = 0;
    for (const e of run(world, 6_000)) {
      if (e.type === "level" && e.actor === ash.id && e.skill === "melee") level = e.level;
      if (e.type !== "hit") continue;
      expect(e.actor).toBe(ash.id);
      // 21 at level 10, 23 at 11, 26 at 12.
      expect(e.damage).toBe(blow(level) * (e.crit ? 2 : 1));
      expect(e.damageType).toBe("physical");
      swings++;
      if (e.crit) crits++;
    }
    expect(level).toBeGreaterThan(10);
    // 5% of the swings, within 4 standard deviations: sqrt(n * 0.05 * 0.95).
    expect(swings).toBeGreaterThan(300);
    const spread = 4 * Math.sqrt(swings * 0.05 * 0.95);
    expect(Math.abs(crits - swings * 0.05)).toBeLessThanOrEqual(spread);
  });

  it("a monster's blow is its kind's damage, and never a crit", () => {
    const world = fight([at("Thug", "biter", 20, 9, "thug"), at("Ash", "stander", 21, 9)]);
    const hits = run(world, 300).flatMap((e) => (e.type === "hit" ? [e] : []));
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const e of hits) expect([e.damage, e.crit]).toEqual([12, false]);
  });

  it("an adventurer struck down wakes at camp with full hitpoints and rests", () => {
    const world = fight([at("Brute", "biter", 20, 9, "brute"), at("Ash", "stander", 21, 9)]);
    const log = run(world, 12);
    expect(log.find((e) => e.type === "down")).toMatchObject({
      actor: 2,
      name: "Ash",
      kind: ADVENTURER,
      by: 1,
      x: 21,
      y: 9,
    });
    const ash = named(world, "Ash");
    expect(ash).toMatchObject({ x: 14, y: 9, hp: ADVENTURER_KIND.hp, path: [], windup: 0 });
    expect(ash?.wait).toBeGreaterThan(DOWN_TICKS - 5);
    // It does nothing until the rest is over.
    const resting = run(world, DOWN_TICKS - 10);
    expect(resting.some((e) => e.type === "decide" && e.actor === 2)).toBe(false);
  });

  it("someone struck down in the same tick does not get its own blow in", () => {
    // Both begin at once with a wind-up as long as a blade's; the brute's blow
    // lands first (lower id) and takes Ash out.
    const kinds: Kinds = { brute: { hp: 500, damage: 30, windup: 2, recovery: 4, reach: 1 } };
    const world = createWorld(MAP, 1, PROGRAMS, kinds);
    step(world, [at("Brute", "biter", 20, 9, "brute"), at("Ash", "fighter", 21, 9)]);
    const log = run(world, 8);
    expect(log.some((e) => e.type === "down" && e.actor === 2)).toBe(true);
    expect(log.some((e) => e.type === "hit" && e.actor === 2)).toBe(false);
    expect(world.marks.every((m) => m.by === 1)).toBe(true);
  });

  it("sensors say who is near and what is coming; allies are not threats", () => {
    const alone = fight([at("Ash", "lonely", 14, 9), at("Birch", "lonely", 15, 9)]);
    run(alone, 10);
    expect(alone.actors.map((a) => alone.programs.lonely?.rules[a.rule])).toEqual([
      "alone",
      "alone",
    ]);
    const met = fight([at("Ash", "lonely", 14, 9), at("Wolf", "stander", 20, 9, "wolf")]);
    run(met, 10);
    expect(met.programs.lonely?.rules[named(met, "Ash")?.rule ?? -1]).toBe("company");
    // A wolf's marks are no danger to another wolf standing on them.
    const pack = fight([
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Pup", "dodger", 15, 11, "wolf"),
      at("Ash", "stander", 17, 11),
    ]);
    const log = run(pack, 40);
    expect(named(pack, "Pup")).toMatchObject({ x: 15, y: 11, hp: 12 });
    expect(log.some((e) => e.type === "hit" && e.target === 2)).toBe(false);
  });

  it("a blow lands on every adventurer standing on the tile", () => {
    const two = fight([
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Ash", "stander", 15, 11),
      at("Birch", "stander", 16, 12),
    ]);
    // Spawns never share a tile; put Birch on Ash's tile as if it were passing through.
    Object.assign(named(two, "Birch") as World["actors"][number], {
      x: 15,
      y: 11,
      fromX: 15,
      fromY: 11,
      path: [],
    });
    const log = run(two, 12);
    const hit = log.flatMap((e) => (e.type === "hit" ? [e.target] : []));
    expect(hit.sort()).toEqual([2, 3]);
  });

  it("monsters block each other; adventurers do not", () => {
    // A wolf walking east along a row with another wolf in the way stops; an adventurer walks through.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      at("Wolf", "stander", 18, 11, "wolf"),
      at("Pup", "stander", 19, 11, "wolf"),
      at("Ash", "stander", 18, 13),
      at("Birch", "stander", 19, 13),
    ]);
    const wolf = named(world, "Wolf") as World["actors"][number];
    const ash = named(world, "Ash") as World["actors"][number];
    for (const who of [wolf, ash]) {
      who.wait = 1000;
      who.path = [
        { x: 19, y: who.y },
        { x: 20, y: who.y },
      ];
    }
    run(world, 8);
    expect([wolf.x, ash.x]).toEqual([18, 20]);
  });

  it("step_clear steps onto an ally's tile to get out of the way, never through a monster", () => {
    // On the bridge, with the river either side: a wolf east, an ally on the bank to the west.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      at("Wolf", "biter", 25, 8, "wolf"),
      at("Ash", "dodger", 24, 8),
      at("Birch", "stander", 23, 8),
    ]);
    const log = run(world, 40);
    expect(log.some((e) => e.type === "hit" && e.target === 2)).toBe(false);
    expect(named(world, "Ash")?.x).toBeLessThanOrEqual(23);
  });

  it("flee runs through allies", () => {
    // Hemmed in by friends on three sides, with a wolf on the fourth.
    const world = fight([
      at("Wolf", "stander", 14, 11, "wolf"),
      at("Ash", "coward", 15, 11),
      at("Birch", "stander", 16, 11),
      at("Cedar", "stander", 15, 10),
      at("Dara", "stander", 15, 12),
    ]);
    run(world, 30);
    expect(named(world, "Ash")?.x).toBeGreaterThanOrEqual(17);
  });

  it("an adventurer wakes on a bed of its own, not on a living ally", () => {
    // Ash is struck down where Birch also stands; the camp tile itself is free.
    const world = fight([
      at("Brute", "biter", 20, 11, "brute"),
      at("Ash", "stander", 21, 11),
      at("Birch", "stander", 14, 9),
    ]);
    run(world, 12);
    const ash = named(world, "Ash") as World["actors"][number];
    const birch = named(world, "Birch") as World["actors"][number];
    expect([ash.x, ash.y]).not.toEqual([birch.x, birch.y]);
    expect(Math.abs(ash.x - 14) + Math.abs(ash.y - 9)).toBe(1);
  });

  it("struck down at camp on a tile shared with a living ally, it wakes on a tile of its own", () => {
    // Ash rests on the camp tile; Birch walks onto it, and a wolf's blow from just
    // outside the camp lands on both.
    // Ash, low on hitpoints, goes down; Birch lives and keeps the tile.
    const world = fight([
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Ash", "stander", 14, 9),
      at("Birch", "stander", 14, 8),
    ]);
    const ash = named(world, "Ash") as World["actors"][number];
    const birch = named(world, "Birch") as World["actors"][number];
    ash.hp = 5;
    Object.assign(birch, { x: 14, y: 9, fromX: 14, fromY: 9, path: [] });
    const log = run(world, 12);
    expect(log.some((e) => e.type === "down" && e.actor === ash.id)).toBe(true);
    expect(birch).toMatchObject({ x: 14, y: 9, hp: ADVENTURER_KIND.hp - 5 });
    expect([ash.x, ash.y]).not.toEqual([14, 9]);
    expect(Math.abs(ash.x - 14) + Math.abs(ash.y - 9)).toBe(1);
  });

  it("an adventurer does not wake on the camp tile someone is walking to", () => {
    // Birch is three steps from the camp tile and making for it when Ash goes down.
    const world = fight([
      at("Brute", "biter", 20, 11, "brute"),
      at("Ash", "stander", 21, 11),
      at("Birch", "stander", 14, 12),
    ]);
    const birch = named(world, "Birch") as World["actors"][number];
    Object.assign(birch, {
      wait: 1000,
      path: [
        { x: 14, y: 11 },
        { x: 14, y: 10 },
        { x: 14, y: 9 },
      ],
    });
    const log = run(world, 12);
    expect(log.some((e) => e.type === "down" && e.actor === 2)).toBe(true);
    expect(birch.path.length).toBeGreaterThan(0);
    const ash = named(world, "Ash") as World["actors"][number];
    expect([ash.x, ash.y]).not.toEqual([14, 9]);
    expect(Math.abs(ash.x - 14) + Math.abs(ash.y - 9)).toBe(1);
    run(world, 30);
    expect(birch).toMatchObject({ x: 14, y: 9, path: [] });
    expect([ash.x, ash.y]).not.toEqual([birch.x, birch.y]);
  });

  it("step_clear goes to the only safe tile even when an ally stands on it", () => {
    // On the bridge: a wolf east strikes the two bridge tiles, Birch stands on the
    // west bank, and monsters hold every tile round Birch, so its tile is the only way out.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      at("Wolf", "biter", 26, 8, "wolf"),
      at("Ash", "dodger", 24, 8),
      at("Birch", "stander", 23, 8),
      at("North", "stander", 23, 7, "brute"),
      at("South", "stander", 23, 9, "brute"),
      at("West", "stander", 22, 8, "brute"),
    ]);
    const log = run(world, 40);
    expect(log.some((e) => e.type === "attack" && e.actor === 1)).toBe(true);
    expect(log.some((e) => e.type === "hit" && e.target === 2)).toBe(false);
    expect(named(world, "Ash")).toMatchObject({ x: 23, y: 8, hp: ADVENTURER_KIND.hp });
  });

  it("an attack stops at whatever cannot be walked on", () => {
    // East of (12, 3) is a tree. A wolf reaches two tiles; here only one is open.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    const began = step(world, [at("Wolf", "biter", 11, 3, "wolf"), at("Ash", "stander", 14, 3)]);
    expect(began.find((e) => e.type === "attack")).toMatchObject({ tiles: [{ x: 12, y: 3 }] });
    expect(world.marks).toEqual([{ x: 12, y: 3, by: 1 }]);
    // Right against it there is nothing to strike, so no attack begins at all.
    const blocked = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(blocked, [at("Wolf", "biter", 12, 3, "wolf"), at("Ash", "stander", 14, 3)]);
    expect(run(blocked, 50).some((e) => e.type === "attack")).toBe(false);
  });

  it("danger is the soonest blow coming, and the threat is the nearest enemy, lowest id first", () => {
    // A wolf's blow (ten ticks) and a slow one (thirty) are both coming at (15, 11).
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Slow", "biter", 15, 12, "slow"),
      at("Ash", "meter", 15, 11),
    ]);
    expect(named(world, "Ash")?.memory[0]).toBe(10);

    // Two wolves as near as each other: the one that came first is the threat.
    const between = createWorld(MAP, 1, PROGRAMS, KINDS);
    const began = step(between, [
      at("First", "stander", 14, 11, "wolf"),
      at("Second", "stander", 16, 11, "wolf"),
      at("Ash", "fighter", 15, 11),
    ]);
    // The first tile of a blade's arc is the one it faces.
    const swing = began.find((e) => e.type === "attack");
    expect(swing?.type === "attack" && swing.tiles[0]).toEqual({ x: 14, y: 11 });
  });

  it("the last blow gets the credit, and nobody is struck after going down", () => {
    // Two thugs' blows land together on one adventurer: twelve, then twelve more, from twenty.
    const pair = fight([
      at("One", "biter", 14, 11, "thug"),
      at("Two", "biter", 16, 11, "thug"),
      at("Ash", "stander", 15, 11),
    ]);
    const twice = run(pair, 12);
    expect(twice.filter((e) => e.type === "hit" && e.target === 3)).toHaveLength(2);
    expect(twice.find((e) => e.type === "down")).toMatchObject({ actor: 3, by: 2 });
    // Two brutes: the first blow is enough, and the second finds nobody there.
    const over = fight([
      at("One", "biter", 14, 11, "brute"),
      at("Two", "biter", 16, 11, "brute"),
      at("Ash", "stander", 15, 11),
    ]);
    const once = run(over, 12);
    expect(once.filter((e) => e.type === "hit")).toHaveLength(1);
    expect(once.find((e) => e.type === "down")).toMatchObject({ actor: 3, by: 1 });
    expect(once.some((e) => e.type === "miss" && e.actor === 2)).toBe(true);
  });

  it("several struck down at once each get a tile of their own at a camp that is not empty", () => {
    const world = fight([
      at("Keeper", "stander", 14, 9),
      at("B1", "biter", 20, 11, "brute"),
      at("V1", "stander", 21, 11),
      at("B2", "biter", 17, 11, "brute"),
      at("V2", "stander", 18, 11),
      at("B3", "biter", 11, 11, "brute"),
      at("V3", "stander", 12, 11),
    ]);
    const log = run(world, 12);
    expect(log.filter((e) => e.type === "down")).toHaveLength(3);
    const tiles = world.actors.map((a) => `${a.x},${a.y}`);
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(named(world, "Keeper")).toMatchObject({ x: 14, y: 9 });
    for (const name of ["V1", "V2", "V3"]) {
      const victim = named(world, name);
      expect(Math.abs((victim?.x ?? 0) - 14) + Math.abs((victim?.y ?? 0) - 9)).toBeLessThanOrEqual(
        2,
      );
    }
  });

  it("someone struck down while walking wakes with nowhere to go, and the world still saves", () => {
    // Ash has just set off east when the blow lands; its path must not come back to camp with it.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [at("Snap", "biter", 20, 11, "snap"), at("Ash", "east", 21, 11)]);
    expect(named(world, "Ash")?.path.length).toBeGreaterThan(0);
    const log = run(world, 1);
    expect(log.some((e) => e.type === "down" && e.actor === 2)).toBe(true);
    expect(named(world, "Ash")).toMatchObject({
      x: 14,
      y: 9,
      fromX: 14,
      fromY: 9,
      path: [],
      blocked: 0,
      moveTicksLeft: 0,
    });
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
    run(world, 400);
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });

  it("flee goes round someone standing in the way", () => {
    const world = fight([
      at("Wolf", "stander", 14, 11, "wolf"),
      at("Ash", "coward", 15, 11),
      at("Birch", "stander", 16, 11),
    ]);
    run(world, 200);
    const ash = named(world, "Ash");
    expect(Math.abs((ash?.x ?? 0) - 14) + Math.abs((ash?.y ?? 0) - 11)).toBeGreaterThanOrEqual(6);
  });

  it("threat_recovering says how long the nearest enemy needs after its blow", () => {
    // The wolf strikes at Birch; Ash watches from out of reach.
    const world = fight([
      at("Wolf", "biter", 14, 11, "wolf"),
      at("Birch", "stander", 15, 11),
      at("Ash", "gauge", 14, 14),
    ]);
    const ash = named(world, "Ash");
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      step(world);
      // Ash decides every five ticks, after the wolf has been updated in the same tick.
      if (world.tick % 5 === 1) seen.push(ash?.memory[0] ?? -1);
      if (ash?.memory[0]) expect(ash.memory[0]).toBeLessThanOrEqual(KINDS.wolf?.recovery as number);
    }
    // Read every five ticks, the highest is within five of the wolf's whole recovery.
    expect(Math.max(...seen)).toBeGreaterThan((KINDS.wolf?.recovery as number) - 5);
    expect(seen.some((v) => v === 0)).toBe(true);
    // With no enemy anywhere, it is 0.
    const alone = fight([at("Ash", "gauge", 14, 14)]);
    run(alone, 20);
    expect(named(alone, "Ash")?.memory[0]).toBe(0);
  });

  it("threat_recovering reads the same whether the enemy is updated before or after the one asking", () => {
    const recovery = KINDS.wolf?.recovery as number;
    for (const wolfFirst of [true, false]) {
      const wolf = at("Wolf", "biter", 14, 11, "wolf");
      const ash = at("Ash", "gauge", 14, 14);
      const world = fight([
        ...(wolfFirst ? [wolf] : [ash]),
        at("Birch", "stander", 15, 11),
        ...(wolfFirst ? [ash] : [wolf]),
      ]);
      const wolfId = named(world, "Wolf")?.id;
      const ashActor = named(world, "Ash");
      let landed = -1;
      const readings: [number, number][] = [];
      for (let i = 0; i < 120; i++) {
        for (const event of step(world)) {
          if ((event.type === "hit" || event.type === "miss") && event.actor === wolfId)
            landed = event.tick;
          if (event.type === "decide" && event.actor === ashActor?.id && landed >= 0)
            readings.push([event.tick - landed, ashActor.memory[0] as number]);
        }
      }
      // Read `ticks` after the blow landed, it says the wolf needs `recovery - 1 - ticks`
      // more after this one, and then 0.
      const recovering = readings.filter(([ticks]) => ticks < recovery);
      expect(recovering.length, `wolf first: ${wolfFirst}`).toBeGreaterThan(2);
      for (const [ticks, value] of readings) {
        expect(value, `wolf first: ${wolfFirst}, ${ticks} ticks after`).toBe(
          Math.max(0, recovery - 1 - ticks),
        );
      }
    }
  });

  it("step_to takes one step along the way, and none towards somewhere it cannot go", () => {
    const world = fight([at("Ash", "stepper", 14, 11), at("Wild", "stepwild", 14, 13)]);
    const ash = named(world, "Ash");
    // Six tiles from where it is going, it takes one step and is asked again after each.
    expect(ash?.path).toEqual([{ x: 15, y: 11 }]);
    for (let i = 0; i < 60 && ash?.x !== 20; i++) {
      step(world);
      expect(ash?.path.length).toBeLessThanOrEqual(1);
    }
    expect([ash?.x, ash?.y]).toEqual([20, 11]);
    // Somewhere off the map gives no step at all.
    run(world, 100);
    expect([named(world, "Wild")?.x, named(world, "Wild")?.y]).toEqual([14, 13]);
  });

  it("flee walks away from a point, a few tiles at a time", () => {
    const world = fight([at("Wolf", "stander", 14, 11, "wolf"), at("Ash", "coward", 15, 11)]);
    run(world, 200);
    const ash = named(world, "Ash");
    expect(Math.abs((ash?.x ?? 0) - 14) + Math.abs((ash?.y ?? 0) - 11)).toBeGreaterThanOrEqual(6);
    expect(world.programs.coward?.rules[ash?.rule ?? -1]).toBe("calm");
  });
});

describe("hostile input to a fight", () => {
  it("attacks and flights at absurd places change nothing they should not", () => {
    const world = fight([
      at("Wild", "wild", 14, 11),
      at("Self", "self", 16, 11),
      at("Far", "far", 18, 11),
      at("Wolf", "stander", 20, 13, "wolf"),
    ]);
    const log = run(world, 300);
    // Striking at oneself is no attack at all.
    expect(log.some((e) => e.type === "attack" && e.actor === 2)).toBe(false);
    // A far-off target only gives a direction, here north-east, and the
    // blade's arc that way from (14, 11) is what gets marked.
    const wild = log.find((e) => e.type === "attack" && e.actor === 1);
    expect(wild?.type === "attack" && wild.tiles).toEqual(
      blowShape("blade", 7)
        .map((o) => ({ x: 14 + o.x, y: 11 + o.y }))
        .filter((p) => isWalkable(MAP, p.x, p.y)),
    );
    expect(wild?.type === "attack" && wild.tiles[0]).toEqual({ x: 15, y: 10 });
    for (const actor of world.actors) {
      expect(Number.isInteger(actor.x) && Number.isInteger(actor.y)).toBe(true);
      expect(actor.hp).toBeGreaterThan(0);
    }
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });

  it("a spawn of an unknown kind is dropped, and bad kind tables are refused", () => {
    const world = fight([at("Ghost", "stander", 14, 9, "ghost")]);
    expect(world.actors).toEqual([]);
    step(world, [{ ...at("Odd", "stander", 14, 9), kind: 7 } as unknown as Input]);
    step(world, [at("Proto", "stander", 14, 9, "__proto__")]);
    // A world that has handed out every id takes no more actors, and can still be saved.
    const full = fight([at("Ash", "stander", 14, 9)]);
    full.nextActorId = MAX_ACTOR_ID;
    step(full, [at("Late", "stander", 15, 9)]);
    expect(full.actors.map((a) => a.name)).toEqual(["Ash"]);
    expect(restore(snapshot(full), MAP, PROGRAMS, KINDS)).toEqual(full);
    step(world, [at("Ctor", "stander", 14, 9, "constructor")]);
    expect(world.actors).toEqual([]);

    const wolf = { hp: 12, damage: 5, windup: 10, recovery: 8, reach: 2 };
    expect(() => checkKinds({ wolf })).not.toThrow();
    for (const bad of [
      { wolf: { ...wolf, hp: 0 } },
      { wolf: { ...wolf, windup: 0 } },
      { wolf: { ...wolf, reach: 4 } },
      { wolf: { ...wolf, damage: 1.5 } },
      { wolf: { ...wolf, recovery: "8" } },
      { wolf: null },
      { [ADVENTURER]: wolf },
      { "Bad Name": wolf },
      { wolf: { hp: 12 } },
    ]) {
      expect(() => checkKinds(bad as unknown as Kinds)).toThrow(KindError);
    }
    expect(() => createWorld(MAP, 1, PROGRAMS, { wolf: { ...wolf, hp: -1 } })).toThrow(KindError);
    // The table a world keeps cannot be changed afterwards.
    const kept = createWorld(MAP, 1, PROGRAMS, { wolf }).kinds;
    expect(Object.isFrozen(kept) && Object.isFrozen(kept.wolf)).toBe(true);
  });
});

describe("fights and determinism", () => {
  const melee = (seed: number): World =>
    fight(
      [
        at("Wolf", "biter", 14, 11, "wolf"),
        at("Ash", "fighter", 15, 11),
        at("Birch", "dodger", 14, 12),
        at("Brute", "biter", 16, 12, "brute"),
        at("Cedar", "coward", 13, 11),
      ],
      seed,
    );

  it("the same fight from the same seed ends in the same state", () => {
    const a = melee(5);
    const b = melee(5);
    for (let i = 0; i < 30; i++) {
      run(a, 100);
      run(b, 100);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
  });

  it("a snapshot taken between wind-up and hit resumes to the same state", () => {
    const straight = melee(3);
    const paused = melee(3);
    let saved: string | undefined;
    for (let i = 0; i < 400 && !saved; i++) {
      step(straight);
      step(paused);
      if (paused.marks.length > 0 && paused.actors.some((a) => a.windup > 2))
        saved = snapshot(paused);
    }
    expect(saved).toBeDefined();
    const resumed = restore(saved as string, MAP, PROGRAMS, KINDS);
    expect(resumed).toEqual(paused);
    run(straight, 1000);
    run(resumed, 1000);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it("crits come out the same after a snapshot and resume", () => {
    const kinds: Kinds = { post: { hp: 100_000, damage: 0, windup: 10, recovery: 4, reach: 1 } };
    const training = (): World => {
      const world = createWorld(MAP, 9, PROGRAMS, kinds);
      step(world, [at("Ash", "chaser", 20, 9), at("Post", "stander", 21, 9, "post")]);
      run(world, 150);
      return world;
    };
    const straight = training();
    const resumed = restore(snapshot(training()), MAP, PROGRAMS, kinds);
    const hitsOf = (world: World) =>
      run(world, 2_000).flatMap((e) => (e.type === "hit" ? [[e.tick, e.damage, e.crit]] : []));
    const hits = hitsOf(straight);
    expect(hitsOf(resumed)).toEqual(hits);
    expect(hits.filter(([, , crit]) => crit).length).toBeGreaterThan(0);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });

  it("a snapshot that could not be a real fight is refused", () => {
    const world = melee(3);
    while (world.marks.length === 0) step(world);
    const good = JSON.parse(snapshot(world));
    interface Saved {
      marks: { x: number; y: number; by: number }[];
      actors: { id: number; hp: number; windup: number; recover: number; kind: string }[];
      nextActorId: number;
    }
    // A hostile snapshot can carry the right hash for an impossible world, so each
    // forgery is tried with the saved hash and with one worked out for it.
    const tamper = (change: (state: Saved) => void, rehash: boolean): string => {
      const copy = structuredClone(good);
      change(copy.state);
      if (rehash) {
        try {
          copy.hash = hashWorld({
            ...copy.state,
            atlas: atlasOf(MAP),
            programs: PROGRAMS,
            kinds: KINDS,
            spawns: [],
          });
        } catch {
          // Not even hashable; the saved hash stays.
        }
      }
      return JSON.stringify(copy);
    };
    const attacker = world.actors.findIndex((a) => a.windup > 0);
    const striker = world.actors[attacker] as World["actors"][number];
    const idle = world.actors.find((a) => a.windup === 0) as World["actors"][number];
    const cases: ((state: Saved) => void)[] = [
      (s) => s.marks.push({ x: 14, y: 9, by: 99 }),
      // A mark from someone who is not attacking, and one on the attacker's own tile.
      (s) => s.marks.push({ x: idle.x + 1, y: idle.y, by: idle.id }),
      (s) => s.marks.push({ x: striker.x, y: striker.y, by: striker.id }),
      // Marks in more than one direction, and a line with its first tile missing.
      (s) => {
        const first = s.marks.find((m) => m.by === striker.id) as Saved["marks"][number];
        s.marks.push({
          x: striker.x - (first.x - striker.x),
          y: striker.y - (first.y - striker.y),
          by: striker.id,
        });
      },
      (s) => {
        s.marks = s.marks.filter((m) => m.by !== striker.id);
        s.marks.push({ x: striker.x + 2, y: striker.y, by: striker.id });
      },
      (s) => {
        s.nextActorId = 2 ** 31;
      },
      (s) => s.marks.push({ ...(s.marks[0] as Saved["marks"][number]) }),
      (s) => {
        s.marks = [];
      },
      (s) => {
        (s.marks[0] as Saved["marks"][number]).x += 5;
      },
      (s) => {
        (s.actors[0] as Saved["actors"][number]).hp = 100_000;
      },
      (s) => {
        (s.actors[0] as Saved["actors"][number]).hp = 0;
      },
      (s) => {
        (s.actors[attacker] as Saved["actors"][number]).windup = 99;
      },
      (s) => {
        (s.actors[attacker] as Saved["actors"][number]).recover = 1;
      },
      (s) => {
        (s.actors[0] as Saved["actors"][number]).kind = "ghost";
      },
      (s) => {
        (s.actors[1] as Saved["actors"][number]).id = 1;
      },
      (s) => {
        s.nextActorId = 2;
      },
      (s) => {
        delete (s as Partial<Saved>).marks;
      },
    ];
    for (const change of cases) {
      expect(() => restore(tamper(change, false), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
      expect(() => restore(tamper(change, true), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    }
    // Two attacks' marks shuffled together: each attack's marks are stored side by side.
    const two = fight([
      at("West", "biter", 14, 11, "wolf"),
      at("East", "biter", 20, 11, "wolf"),
      at("Ash", "stander", 17, 11),
    ]);
    expect(two.marks.map((m) => m.by)).toEqual([1, 1, 2, 2]);
    const shuffled = JSON.parse(snapshot(two));
    const [a0, a1, b0, b1] = shuffled.state.marks;
    shuffled.state.marks = [a0, b0, a1, b1];
    shuffled.hash = hashWorld({
      ...shuffled.state,
      atlas: atlasOf(MAP),
      programs: PROGRAMS,
      kinds: KINDS,
      spawns: [],
    });
    expect(() => restore(JSON.stringify(shuffled), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    expect(restore(snapshot(two), MAP, PROGRAMS, KINDS)).toEqual(two);

    // Only adventurers share a tile: two of them may, a monster and anyone may not.
    const calm = fight([
      at("Wolf", "stander", 20, 11, "wolf"),
      at("Ash", "stander", 15, 11),
      at("Birch", "stander", 16, 11),
    ]);
    const onto = (name: string): string => {
      const copy = JSON.parse(snapshot(calm));
      const who = copy.state.actors.find((a: { name: string }) => a.name === name);
      Object.assign(who, { x: 15, y: 11, fromX: 15, fromY: 11 });
      copy.hash = hashWorld({
        ...copy.state,
        atlas: atlasOf(MAP),
        programs: PROGRAMS,
        kinds: KINDS,
        spawns: [],
      });
      return JSON.stringify(copy);
    };
    expect(restore(onto("Birch"), MAP, PROGRAMS, KINDS).actors[2]).toMatchObject({ x: 15, y: 11 });
    expect(() => restore(onto("Wolf"), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);

    // An empty world still needs a next id of at least one.
    const empty = JSON.parse(snapshot(createWorld(MAP, 1, PROGRAMS, KINDS)));
    for (const next of [0, -5]) {
      empty.state.nextActorId = next;
      empty.hash = hashWorld({
        ...empty.state,
        atlas: atlasOf(MAP),
        programs: PROGRAMS,
        kinds: KINDS,
        spawns: [],
      });
      expect(() => restore(JSON.stringify(empty), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    }
    // Other monster numbers than the ones it was taken with.
    expect(() =>
      restore(snapshot(world), MAP, PROGRAMS, {
        ...KINDS,
        wolf: { ...KINDS.wolf, hp: 13 },
      } as Kinds),
    ).toThrow(/different monster kinds/);
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });
});

describe("the viewer message", () => {
  /** The wolf's first blow on Ash, and the world after the tick it landed in. */
  const struck = () => {
    const world = fight([at("Wolf", "biter", 14, 11, "wolf"), at("Ash", "stander", 15, 11)]);
    let events = step(world);
    while (!events.some((e) => e.type === "hit")) events = step(world);
    return { world, blows: blowsOf(events) };
  };

  it("carries the tick's blows beside the snapshot, each cut to who, whom, how much, crit and type", () => {
    const { world, blows } = struck();
    expect(blows).toEqual([{ by: 1, target: 2, amount: 5, crit: false, type: "physical" }]);
    const text = viewerMessage(world, blows);
    const read = readMessage(text, MAP, PROGRAMS, KINDS);
    expect(read.blows).toEqual(blows);
    // Nobody here has an account or a flag, and the orders left out are put back as they were.
    expect(read.world).toEqual(world);
    // A snapshot reads as a message with no blows.
    expect(readMessage(snapshot(world), MAP, PROGRAMS, KINDS).blows).toEqual([]);
  });

  it("leaves out blows not as it writes them, and refuses a world as restore does", () => {
    const { world, blows } = struck();
    const good = blows[0];
    const data = JSON.parse(viewerMessage(world, blows));
    const listed = (list: unknown) =>
      readMessage(JSON.stringify({ ...data, blows: list }), MAP, PROGRAMS, KINDS).blows;
    expect(
      listed([
        good,
        { ...good, amount: 1.5 },
        { ...good, type: "acid" },
        { ...good, crit: 1 },
        { ...good, by: "1" },
        null,
        "hit",
      ]),
    ).toEqual([good]);
    expect(listed("all of them")).toEqual([]);
    expect(() => readMessage("{", MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
    const damaged = { ...data, state: { ...data.state, tick: data.state.tick + 1 } };
    expect(() => readMessage(JSON.stringify(damaged), MAP, PROGRAMS, KINDS)).toThrow(SnapshotError);
  });
});
