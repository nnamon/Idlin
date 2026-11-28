import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emptyBag, emptyBank } from "./bag.ts";
import { blow, rollCrit } from "./hit.ts";
import { isWalkable, type Point, placeConstants } from "./map.ts";
import { MAX_LEVEL, noXp, XP_TABLE } from "./skills.ts";
import { noStatus } from "./status.ts";
import { compileBots } from "./tactics.ts";
import { firstLight } from "./testing.ts";
import { MEMORY_SLOTS } from "./vm.ts";
import {
  ARROW_RANGE,
  blowShape,
  blowTimes,
  DIRECTIONS,
  directionTo,
  drinkOf,
  FAMILIES,
  type Family,
  FLASK_DRINKS,
  KILLS_PER_DRINK,
  WEAPONS,
} from "./weapons.ts";
import {
  type Actor,
  ADVENTURER_KIND,
  createWorld,
  DOWN_TICKS,
  hashStateAs,
  hashWorld,
  type Input,
  type Kinds,
  knocksOf,
  readMessage,
  restore,
  SNAPSHOT_VERSION,
  SnapshotError,
  snapshot,
  step,
  viewerMessage,
  type World,
  type WorldEvent,
} from "./world.ts";

// first-light has open grass for four tiles round (16, 13), but for the tent at (17, 10).
const MAP = firstLight();
const ASH: Point = { x: 16, y: 13 };
const KINDS: Kinds = {
  post: { hp: 1_000, damage: 0, windup: 10, recovery: 4, reach: 1 },
  gnat: { hp: 1, damage: 0, windup: 10, recovery: 4, reach: 1 },
  brute: { hp: 500, damage: 30, windup: 2, recovery: 4, reach: 1 },
};
const PROGRAMS = compileBots(
  {
    east: "otherwise -> attack(self_x + 5, self_y)",
    west: "otherwise -> attack(self_x - 5, self_y)",
    southeast: "otherwise -> attack(self_x + 5, self_y + 5)",
    northeast: "otherwise -> attack(self_x + 5, self_y - 5)",
    stander: "otherwise -> wait(600)",
    reader: "otherwise -> set r = weapon_reach; set f = flask; idle",
    drinker: "when hp < max_hp -> drink\notherwise -> wait(5)",
    fighter: "when threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wait(5)",
    biter: "when threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> idle",
  },
  placeConstants(MAP),
);

const spawn = (
  name: string,
  program: string,
  at: Point,
  weapon?: Family,
  kind?: string,
): Input => ({
  type: "spawn",
  name,
  program,
  ...at,
  ...(weapon ? { weapon } : {}),
  ...(kind ? { kind } : {}),
});

/** A world with Ash at ASH holding `weapon` and running `program`, after the tick it was put in. */
function armed(weapon: Family, program: string, at: Point = ASH): World {
  const world = createWorld(MAP, 1, PROGRAMS, KINDS);
  step(world, [spawn("Ash", program, at, weapon)]);
  return world;
}

/**
 * Stands a monster of `kind` on (x, y), outside the spawn rules so that a
 * blow's whole shape can be filled. It is a monster like any other from then on.
 */
function plant(world: World, x: number, y: number, kind = "post", program = "stander"): Actor {
  const post: Actor = {
    id: world.nextActorId++,
    name: "Post",
    x,
    y,
    fromX: x,
    fromY: y,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    blocked: 0,
    program,
    memory: new Array<number>(MEMORY_SLOTS).fill(0),
    rule: -1,
    fault: 0,
    kind,
    hp: (KINDS[kind] as { hp: number }).hp,
    windup: 0,
    recover: 0,
    shift: "",
    stalled: 0,
    xp: noXp(),
    bag: emptyBag(),
    bank: emptyBank(),
    deaths: 0,
    weapon: "",
    aim: 0,
    knockX: 0,
    knockY: 0,
    flask: 0,
    kills: 0,
    status: noStatus(),
  };
  world.actors.push(post);
  return post;
}

function run(world: World, ticks: number): WorldEvent[] {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...step(world));
  return log;
}

const sorted = (tiles: readonly Point[]): Point[] =>
  [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
const square = (x0: number, x1: number, y0: number, y1: number): Point[] => {
  const tiles: Point[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ x, y });
  return tiles;
};

/**
 * The tiles of the posts Ash's first blow hits, with a post on every tile
 * within four steps of it that can be stood on.
 */
function struck(weapon: Family, program: string): Point[] {
  const world = armed(weapon, program);
  const where = new Map<number, Point>();
  for (const { x, y } of square(ASH.x - 4, ASH.x + 4, ASH.y - 4, ASH.y + 4)) {
    if ((x === ASH.x && y === ASH.y) || !isWalkable(MAP, x, y)) continue;
    where.set(plant(world, x, y).id, { x, y });
  }
  const hits = run(world, 20).filter((e) => e.type === "hit");
  const first = hits[0]?.tick;
  return sorted(hits.filter((e) => e.tick === first).map((e) => where.get(e.target) as Point));
}

describe("aiming", () => {
  it("faces the nearest of the eight directions, and nowhere at its own tile", () => {
    expect(directionTo(0, 0)).toBe(-1);
    expect(DIRECTIONS.map(([x, y]) => directionTo(x * 7, y * 7))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // A diagonal covers from 5 in 12 off the axis (22.6 degrees) to 12 in 5.
    expect(directionTo(12, 5)).toBe(0);
    expect(directionTo(12, 6)).toBe(1);
    expect(directionTo(5, 12)).toBe(2);
    expect(directionTo(-6, -12)).toBe(5);
    // Far-off targets do not overflow: integers this size are exact in a double.
    expect(directionTo(2_147_483_647, -2_147_483_647)).toBe(7);
  });

  it("the first tile of every shape is the step it faces", () => {
    for (const family of FAMILIES)
      for (let aim = 0; aim < 8; aim++) {
        const [dx, dy] = DIRECTIONS[aim] as [number, number];
        expect(blowShape(family, aim)[0]).toEqual({ x: dx, y: dy });
      }
  });
});

describe("the blow shapes", () => {
  it("a blade cuts an arc three tiles wide and two deep", () => {
    expect(struck("blade", "east")).toEqual(sorted(square(17, 18, 12, 14)));
    // Turned to a diagonal, the arc is the three tiles facing it and the three beyond.
    expect(struck("blade", "southeast")).toEqual(
      sorted([
        { x: 17, y: 13 },
        { x: 16, y: 14 },
        { x: 17, y: 14 },
        { x: 18, y: 14 },
        { x: 17, y: 15 },
        { x: 18, y: 15 },
      ]),
    );
  });

  it("a maul crushes the nine tiles of the square centred two tiles out", () => {
    expect(struck("maul", "east")).toEqual(sorted(square(17, 19, 12, 14)));
    expect(struck("maul", "southeast")).toEqual(sorted(square(17, 19, 14, 16)));
  });

  it("a spear runs a line four tiles long through everyone on it", () => {
    expect(struck("spear", "east")).toEqual(sorted(square(17, 20, 13, 13)));
    expect(struck("spear", "northeast")).toEqual(
      sorted([
        { x: 17, y: 12 },
        { x: 18, y: 11 },
        { x: 19, y: 10 },
        { x: 20, y: 9 },
      ]),
    );
    // To the south-east the river is the fourth tile, and the line ends before it.
    const world = armed("spear", "southeast");
    expect(world.marks).toEqual([
      { x: 17, y: 14, by: 1 },
      { x: 18, y: 15, by: 1 },
      { x: 19, y: 16, by: 1 },
    ]);
  });

  it("a bow's arrow stops in the first body on its line", () => {
    expect(struck("bow", "east")).toEqual([{ x: 17, y: 13 }]);
    const world = armed("bow", "east");
    // Its line is marked through the wind-up, nine tiles or to the river at (23, 13).
    expect(world.marks.map((m) => m.x)).toEqual([17, 18, 19, 20, 21, 22]);
    const near = plant(world, 18, 13);
    const far = plant(world, 20, 13);
    const hits = run(world, 10).filter((e) => e.type === "hit");
    // Two arrows are loosed in that time, and both stop in the nearer post.
    expect(new Set(hits.map((e) => e.type === "hit" && e.target))).toEqual(new Set([near.id]));
    expect(far.hp).toBe(1_000);
  });

  it("tactics.md's example strikes only at a target its weapon reaches", () => {
    const doc = readFileSync(new URL("../../../docs/tactics.md", import.meta.url), "utf8");
    const from = doc.indexOf("```\n", doc.indexOf("close in with a maul")) + 4;
    const programs = {
      ...PROGRAMS,
      ...compileBots({ example: doc.slice(from, doc.indexOf("```", from)) }, placeConstants(MAP)),
    };
    // Off Ash's eight lines, on a row and on diagonals, all on open ground.
    const offsets = [
      [3, 1],
      [2, 2],
      [-4, 0],
      [4, -2],
      [-2, 3],
      [-3, -3],
    ] as const;
    for (const weapon of FAMILIES)
      for (const [dx, dy] of offsets) {
        const world = createWorld(MAP, 1, programs, KINDS);
        step(world, [spawn("Ash", "example", ASH, weapon)]);
        const post = plant(world, ASH.x + dx, ASH.y + dy);
        let hits = 0;
        for (let t = 0; t < 60; t++) {
          const events = step(world);
          hits += events.filter((e) => e.type === "hit" && e.target === post.id).length;
          if (!events.some((e) => e.type === "attack" && e.actor === 1)) continue;
          const marked = world.marks.some((m) => m.by === 1 && m.x === post.x && m.y === post.y);
          expect(marked, `${weapon} at (${dx}, ${dy}), tick ${world.tick}`).toBe(true);
        }
        expect(hits, `${weapon} at (${dx}, ${dy})`).toBeGreaterThan(0);
      }
  });

  it("weapon_reach says how far each reaches, and a monster's is its kind's", () => {
    const reach = (weapon: Family) => {
      const world = armed(weapon, "reader");
      return world.actors[0]?.memory[0];
    };
    expect(FAMILIES.map(reach)).toEqual([2, 3, 4, 9]);
    expect(FAMILIES.map((f) => Math.max(...blowShape(f, 0).map((t) => t.x)))).toEqual([2, 3, 4, 9]);
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [spawn("Post", "reader", { x: 20, y: 13 }, undefined, "post")]);
    expect(world.actors[0]?.memory).toEqual([1, 0, ...new Array(MEMORY_SLOTS - 2).fill(0)]);
  });
});

describe("blow times", () => {
  it("are slice.md's at Arms 1, a tick off the recovery at 30 and one off the wind-up at 60", () => {
    const at = (arms: number) => FAMILIES.map((f) => [f, blowTimes(f, arms)]);
    const times = (w: number, r: number) => ({ windup: w, recovery: r, carry: 0 });
    expect(Object.fromEntries(at(1))).toEqual({
      blade: times(2, 3),
      maul: times(5, 5),
      spear: times(3, 3),
      bow: times(3, 2),
    });
    expect(blowTimes("maul", 29)).toEqual(times(5, 5));
    expect(blowTimes("maul", 30)).toEqual(times(5, 4));
    expect(blowTimes("maul", 59)).toEqual(times(5, 4));
    expect(blowTimes("maul", 60)).toEqual(times(4, 4));
    expect(blowTimes("blade", 99)).toEqual(times(1, 2));
  });

  it("take a faster line's share off both, and carry what is under a tick into the next blow", () => {
    // 10% off a blade's 2 + 3 is 180 + 270 hundredths. The first blow is 1 + 3
    // with 50 left over; the next starts from those 50 and is 2 + 3.
    expect(blowTimes("blade", 1, 1_000)).toEqual({ windup: 1, recovery: 3, carry: 50 });
    expect(blowTimes("blade", 1, 1_000, 50)).toEqual({ windup: 2, recovery: 3, carry: 0 });
    // So ten blows take 45 ticks, where rounding each down would make them 40.
    let carry = 0;
    let ticks = 0;
    for (let i = 0; i < 10; i++) {
      const t = blowTimes("blade", 1, 1_000, carry);
      ticks += t.windup + t.recovery;
      carry = t.carry;
    }
    expect([ticks, carry]).toEqual([45, 0]);
    // One percent counts: 1% off a maul is 990 hundredths a blow, so a tick is gone by the tenth.
    carry = 0;
    ticks = 0;
    for (let i = 0; i < 10; i++) {
      const t = blowTimes("maul", 1, 100, carry);
      ticks += t.windup + t.recovery;
      carry = t.carry;
    }
    expect([ticks, carry]).toEqual([99, 0]);
  });

  it("no blow is shorter than 2 ticks, and no wind-up shorter than 1", () => {
    for (const family of FAMILIES)
      for (const faster of [2_800, 5_000, 10_000, 20_000, -5_000]) {
        const t = blowTimes(family, 99, faster);
        expect(t.windup).toBeGreaterThanOrEqual(1);
        expect(t.windup + t.recovery).toBeGreaterThanOrEqual(2);
      }
    expect(blowTimes("blade", 99, 10_000)).toEqual({ windup: 1, recovery: 1, carry: 0 });
    // A negative "faster" counts as none.
    expect(blowTimes("bow", 1, -5_000)).toEqual(blowTimes("bow", 1));
  });

  it("are what a resident takes to swing in the world, at its Arms", () => {
    for (const family of FAMILIES)
      for (const arms of [1, 30, 60]) {
        const world = armed(family, "east");
        const ash = world.actors[0] as Actor;
        // No post to hit, so the swings give no experience and Arms stays put.
        ash.xp[0] = XP_TABLE[arms] as number;
        const log = run(world, 40);
        // From the second swing on, which began at this Arms.
        const begun = log.filter((e) => e.type === "attack").map((e) => e.tick);
        const landed = log
          .filter((e) => (family === "bow" ? e.type === "shoot" : e.type === "miss"))
          .map((e) => e.tick);
        const { windup, recovery } = blowTimes(family, arms);
        const [, second = 0, third = 0] = begun;
        expect(third - second, `${family} at ${arms}`).toBe(windup + recovery);
        expect(new Set(landed).has(second + windup)).toBe(true);
      }
  });
});

describe("arrows", () => {
  it("fly a tile a tick, so a post six tiles off is hit six ticks after the arrow is loosed", () => {
    const world = armed("bow", "east");
    const post = plant(world, 22, 13);
    const log: WorldEvent[] = [];
    // Where the first arrow is after each tick, by the tick.
    const flight = new Map<number, number>();
    for (let t = 0; t < 12; t++) {
      log.push(...step(world));
      const first = world.arrows[0];
      if (first) flight.set(world.tick, first.x);
    }
    const shot = log.find((e) => e.type === "shoot") as WorldEvent;
    const hit = log.find((e) => e.type === "hit") as WorldEvent & { type: "hit" };
    expect(hit.tick - shot.tick).toBe(6);
    expect(hit).toMatchObject({ actor: 1, target: post.id, damage: blow(1) * (hit.crit ? 2 : 1) });
    // In flight the arrow is in the world: over Ash's tile when loosed, then a tile further each tick.
    const path = [0, 1, 2, 3, 4, 5].map((k) => flight.get(shot.tick + k));
    expect(path).toEqual([16, 17, 18, 19, 20, 21]);
  });

  it("miss a target that steps off the line before they get there, and stop at the river", () => {
    const world = armed("bow", "east");
    const post = plant(world, 22, 13);
    let log = run(world, 3);
    const shot = log.find((e) => e.type === "shoot") as WorldEvent;
    expect(shot).toMatchObject({ actor: 1, x: 16, y: 13, aim: 0 });
    // Two ticks into the arrow's flight the post is moved a tile north.
    log = run(world, 2);
    Object.assign(post, { y: 12, fromY: 12 });
    log = run(world, 6);
    expect(post.hp).toBe(1_000);
    // The arrow passes (22, 13) and the river ends it there.
    expect(log).toContainEqual({ type: "miss", tick: shot.tick + 7, actor: 1, x: 22, y: 13 });
  });

  it("hit a target that walks onto the arrow's own tile", () => {
    const world = armed("bow", "east");
    const post = plant(world, 22, 13);
    let log = run(world, 3);
    const shot = log.find((e) => e.type === "shoot") as WorldEvent;
    log = run(world, 1);
    // The post walks up the line onto the tile the arrow is over, as a monster
    // stepping towards the archer does between two arrow moves.
    const arrow = world.arrows[0];
    expect(arrow).toBeDefined();
    Object.assign(post, { x: arrow?.x, fromX: arrow?.x });
    log = run(world, 1);
    expect(log.find((e) => e.type === "hit")).toMatchObject({ actor: 1, target: post.id });
    expect(shot).toMatchObject({ actor: 1, aim: 0 });
  });

  it("fly nine tiles at most", () => {
    // From (9, 11) east there is open ground to (23, 11).
    const world = armed("bow", "east", { x: 9, y: 11 });
    expect(world.marks).toHaveLength(ARROW_RANGE);
    const beyond = plant(world, 19, 11);
    const log = run(world, 15);
    const shot = log.find((e) => e.type === "shoot") as WorldEvent;
    expect(log).toContainEqual({ type: "miss", tick: shot.tick + 9, actor: 1, x: 18, y: 11 });
    expect(beyond.hp).toBe(1_000);
  });
});

describe("knockback", () => {
  it("a blade's quarter tile moves a body a tile every fourth hit", () => {
    const world = armed("blade", "east");
    const post = plant(world, 17, 13);
    const knocks = knocksOf(run(world, 40)).slice(0, 5);
    expect(knocks.map((k) => [k.fromX, k.x])).toEqual([
      [17, 17],
      [17, 17],
      [17, 17],
      [17, 18],
      [18, 18],
    ]);
    expect(knocks.every((k) => k.by === 1 && k.target === post.id && !k.stopped)).toBe(true);
  });

  it("a spear's moves a body a tile and a maul's two, each hit", () => {
    for (const [weapon, x] of [
      ["spear", 18],
      ["maul", 19],
    ] as const) {
      const world = armed(weapon, "east");
      const post = plant(world, 17, 13);
      let knocks = knocksOf(step(world));
      while (knocks.length === 0) knocks = knocksOf(step(world));
      const knock = knocks[0];
      expect(knock).toEqual({
        by: 1,
        target: post.id,
        fromX: 17,
        fromY: 13,
        x,
        y: 13,
        stopped: false,
      });
      expect([post.x, post.y, post.knockX, post.knockY]).toEqual([x, 13, 0, 0]);
    }
  });

  it("a body knocked into a wall stops against it, and the rest of the push is lost", () => {
    // A tree stands at (11, 12). A maul swung west from (14, 12) pushes a post
    // at (13, 12) one tile, to (12, 12), and the tree stops the second.
    const world = armed("maul", "west", { x: 14, y: 12 });
    const post = plant(world, 13, 12);
    const knock = knocksOf(run(world, 10))[0];
    expect(knock).toEqual({
      by: 1,
      target: post.id,
      fromX: 13,
      fromY: 12,
      x: 12,
      y: 12,
      stopped: true,
    });
    expect([post.x, post.y, post.knockX, post.knockY]).toEqual([12, 12, 0, 0]);
    // Up against the tree, the next blow cannot move it at all.
    const next = knocksOf(run(world, 15))[0];
    expect(next).toMatchObject({ fromX: 12, x: 12, stopped: true });
  });

  it("a body knocked into another body stops there", () => {
    const world = armed("maul", "east");
    const post = plant(world, 17, 13);
    // A resident is no target for Ash's maul, but a monster cannot pass through one.
    step(world, [spawn("Bryn", "stander", { x: 18, y: 13 })]);
    const knock = knocksOf(run(world, 10)).find((k) => k.target === post.id);
    expect(knock).toMatchObject({ fromX: 17, x: 17, stopped: true });
  });

  it("bodies in a row are pushed from the far end, so each that has room moves", () => {
    // From (9, 11) a maul swung east crushes (10..12, 10..12), and a spear runs (10..13, 11).
    for (const [weapon, to] of [
      ["maul", [12, 13, 14]],
      ["spear", [11, 12, 13]],
    ] as const) {
      const world = armed(weapon, "east", { x: 9, y: 11 });
      const posts = [10, 11, 12].map((x) => plant(world, x, 11));
      let knocks = knocksOf(step(world));
      while (knocks.length === 0) knocks = knocksOf(step(world));
      expect(
        posts.map((post) => knocks.find((k) => k.target === post.id)),
        weapon,
      ).toEqual(
        posts.map((post, i) => ({
          by: 1,
          target: post.id,
          fromX: 10 + i,
          fromY: 11,
          x: to[i],
          y: 11,
          stopped: false,
        })),
      );
      expect(posts.map((post) => post.x)).toEqual(to);
    }
  });

  it("a body knocked back in its wind-up takes its blow with it", () => {
    const world = armed("spear", "east");
    const brute = plant(world, 17, 13, "brute", "biter");
    brute.hp = 500;
    let log = run(world, 1);
    expect(log.some((e) => e.type === "attack" && e.actor === brute.id)).toBe(true);
    expect(world.marks.filter((m) => m.by === brute.id)).toEqual([{ x: 16, y: 13, by: brute.id }]);
    // The brute's wind-up (2, from tick 2) and the spear's (3, from tick 1) end
    // in tick 4; the spear, first in the update order, lands first and pushes
    // the brute a tile east, so the brute's blow falls on the empty tile in front of it.
    log = run(world, 2);
    expect(log.find((e) => e.type === "knock")).toMatchObject({ actor: brute.id, x: 18 });
    expect(log.some((e) => e.type === "hit" && e.actor === brute.id)).toBe(false);
  });

  it("marks of a knocked body's wind-up move with it", () => {
    const kinds: Kinds = {
      ...KINDS,
      brute: { hp: 500, damage: 30, windup: 9, recovery: 4, reach: 1 },
    };
    const world = createWorld(MAP, 1, PROGRAMS, kinds);
    step(world, [spawn("Ash", "east", ASH, "spear")]);
    const brute = plant(world, 17, 13, "brute", "biter");
    // The brute starts its wind-up in tick 2; the spear lands in tick 4.
    run(world, 2);
    expect(brute.windup).toBeGreaterThan(0);
    expect(world.marks.filter((m) => m.by === brute.id)).toEqual([{ x: 16, y: 13, by: brute.id }]);
    run(world, 1);
    expect(brute.x).toBe(18);
    // Still facing west, now from (18, 13).
    expect(world.marks.filter((m) => m.by === brute.id)).toEqual([{ x: 17, y: 13, by: brute.id }]);
    expect(restore(snapshot(world), MAP, PROGRAMS, kinds)).toEqual(world);
  });
});

describe("the flask", () => {
  it("holds three drinks of 40% of life, and a drink at full hitpoints is kept", () => {
    expect(drinkOf(ADVENTURER_KIND.hp)).toBe(8);
    expect(drinkOf(1_292)).toBe(516);
    const world = armed("blade", "drinker");
    const ash = world.actors[0] as Actor;
    expect(ash.flask).toBe(FLASK_DRINKS);
    run(world, 10);
    expect(ash.flask).toBe(FLASK_DRINKS);
    ash.hp = 1;
    const log = run(world, 40);
    const drinks = log.filter((e) => e.type === "drink");
    // 1, then 9, then 17, then full at 20 with one drink left.
    expect(drinks.map((e) => e.type === "drink" && [e.hp, e.flask])).toEqual([
      [9, 2],
      [17, 1],
      [20, 0],
    ]);
    ash.hp = 3;
    expect(run(world, 20).some((e) => e.type === "drink")).toBe(false);
    expect([ash.hp, ash.flask]).toEqual([3, 0]);
  });

  it("gets a drink back for every 20 kills, and only while one is missing", () => {
    const world = armed("blade", "fighter");
    const ash = world.actors[0] as Actor;
    ash.flask = 1;
    const kill = (): WorldEvent[] => {
      plant(world, 17, 13, "gnat");
      return run(world, 10);
    };
    const refills: WorldEvent[] = [];
    for (let k = 1; k <= 2 * KILLS_PER_DRINK + 5; k++) {
      const log = kill();
      expect(
        log.some((e) => e.type === "down" && e.by === ash.id),
        `kill ${k}`,
      ).toBe(true);
      refills.push(...log.filter((e) => e.type === "refill"));
      if (k === KILLS_PER_DRINK - 1) expect([ash.flask, ash.kills]).toEqual([1, 19]);
    }
    expect(refills.map((e) => e.type === "refill" && e.flask)).toEqual([2, 3]);
    // Full again at the 40th kill, so the five after it count for nothing.
    expect([ash.flask, ash.kills]).toEqual([FLASK_DRINKS, 0]);
  });

  it("is full again after a down", () => {
    const world = armed("blade", "stander");
    const ash = world.actors[0] as Actor;
    Object.assign(ash, { flask: 0, kills: 7 });
    plant(world, 17, 13, "brute", "biter");
    const log = run(world, 10);
    expect(log.some((e) => e.type === "down" && e.actor === ash.id)).toBe(true);
    expect([ash.flask, ash.kills]).toEqual([FLASK_DRINKS, 0]);
    expect(ash.wait).toBeGreaterThan(DOWN_TICKS - 10);
  });
});

describe("the crit roll", () => {
  /**
   * Ash's first blade swing east with a post on each of `tiles`, in a world of
   * `seed`: the generator just before the tick it lands, the generator after,
   * and that tick's hits and misses.
   */
  function firstSwing(seed: number, tiles: readonly Point[]) {
    const world = createWorld(MAP, seed, PROGRAMS, KINDS);
    step(world, [spawn("Ash", "east", ASH, "blade")]);
    for (const { x, y } of tiles) plant(world, x, y);
    for (let t = 0; t < 20; t++) {
      const before = { ...world.rng };
      const events = step(world).filter(
        (e) => (e.type === "hit" || e.type === "miss") && e.actor === 1,
      );
      if (events.length > 0) return { before, after: world.rng, events };
    }
    throw new Error(`Ash did not swing in 20 ticks on seed ${seed}`);
  }

  it("one swing on six posts makes one roll, and every post takes the same crit", () => {
    const crits = new Set<boolean>();
    for (let seed = 1; seed <= 200; seed++) {
      const { before, after, events } = firstSwing(seed, square(17, 18, 12, 14));
      const hits = events.flatMap((e) => (e.type === "hit" ? [e] : []));
      expect(hits).toHaveLength(6);
      const crit = rollCrit(before, []);
      for (const e of hits) expect(e.crit, `seed ${seed}: a post took its own crit`).toBe(crit);
      expect(after, `seed ${seed}: the swing drew other than one roll`).toEqual(before);
      crits.add(crit);
    }
    // Both kinds of swing came up, so the check above saw crits and plain hits.
    expect(crits).toEqual(new Set([true, false]));
  });

  it("a swing that finds no one still makes its roll", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { before, after, events } = firstSwing(seed, []);
      expect(events.map((e) => e.type)).toEqual(["miss", "miss", "miss", "miss", "miss", "miss"]);
      rollCrit(before, []);
      expect(after, `seed ${seed}: the empty swing did not draw its roll`).toEqual(before);
    }
  });
});

describe("weapons in the world's state", () => {
  /** A bow and a blade at work on posts, with arrows in flight and bodies part-knocked. */
  const busy = (): World => {
    const world = createWorld(MAP, 4, PROGRAMS, KINDS);
    step(world, [spawn("Ash", "east", ASH, "bow"), spawn("Bryn", "west", { x: 21, y: 11 })]);
    plant(world, 22, 13);
    plant(world, 20, 11);
    run(world, 9);
    return world;
  };

  it("a snapshot with arrows in flight and part-knocked bodies resumes to the same state", () => {
    const world = busy();
    expect(world.arrows.length).toBeGreaterThan(0);
    expect(world.actors.some((a) => a.knockX !== 0)).toBe(true);
    const resumed = restore(snapshot(world), MAP, PROGRAMS, KINDS);
    expect(resumed).toEqual(world);
    for (let i = 0; i < 200; i++) {
      step(world);
      step(resumed);
    }
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("the viewer message carries the tick's knockbacks, and arrows in flight are in its world", () => {
    const world = busy();
    let events = step(world);
    while (!events.some((e) => e.type === "knock")) events = step(world);
    const knocks = knocksOf(events);
    const read = readMessage(viewerMessage(world, [], knocks), MAP, PROGRAMS, KINDS);
    expect(read.knocks).toEqual(knocks);
    expect(read.world.arrows).toEqual(world.arrows);
    const data = JSON.parse(viewerMessage(world, [], knocks));
    const bad = [{ ...knocks[0], x: 1.5 }, { ...knocks[0], stopped: "no" }, null, "knock"];
    const listed = readMessage(
      JSON.stringify({ ...data, knocks: [...knocks, ...bad] }),
      MAP,
      PROGRAMS,
      KINDS,
    );
    expect(listed.knocks).toEqual(knocks);
    expect(readMessage(snapshot(world), MAP, PROGRAMS, KINDS).knocks).toEqual([]);
  });

  it("a snapshot holding what no world could is refused", () => {
    const text = snapshot(busy());
    const forged: [string, (state: Record<string, unknown>) => void][] = [
      ["a weapon no family has", (s) => Object.assign(actorOf(s, 0), { weapon: "axe" })],
      ["a monster with a weapon", (s) => Object.assign(actorOf(s, 2), { weapon: "blade" })],
      ["an adventurer with none", (s) => Object.assign(actorOf(s, 0), { weapon: "" })],
      ["a monster facing a diagonal", (s) => Object.assign(actorOf(s, 2), { aim: 3 })],
      ["an aim past the eighth", (s) => Object.assign(actorOf(s, 0), { aim: 8 })],
      ["a whole tile of knockback left", (s) => Object.assign(actorOf(s, 2), { knockX: 4 })],
      ["four drinks", (s) => Object.assign(actorOf(s, 0), { flask: 4 })],
      ["a monster with a drink", (s) => Object.assign(actorOf(s, 2), { flask: 1 })],
      ["kills counted with a full flask", (s) => Object.assign(actorOf(s, 0), { kills: 3 })],
      ["twenty kills", (s) => Object.assign(actorOf(s, 0), { flask: 1, kills: 20 })],
      ["an arrow from a monster", (s) => Object.assign(arrowOf(s), { by: 3 })],
      ["an arrow from nobody", (s) => Object.assign(arrowOf(s), { by: 99 })],
      ["an arrow with nowhere left to fly", (s) => Object.assign(arrowOf(s), { left: 0 })],
      ["an arrow over the river", (s) => Object.assign(arrowOf(s), { x: 24 })],
      ["an arrow that crits maybe", (s) => Object.assign(arrowOf(s), { crit: 1 })],
      ["an arrow from a blade", (s) => Object.assign(arrowOf(s), { by: actorOf(s, 1).id })],
      [
        "an arrow harder than Arms 99 shoots",
        (s) => Object.assign(arrowOf(s), { blow: blow(MAX_LEVEL) + 1 }),
      ],
      ["arrows that are not a list", (s) => Object.assign(s, { arrows: { 0: arrowOf(s) } })],
      [
        "a blade's wind-up longer than a blade's",
        (s) => Object.assign(actorOf(s, 1), { windup: 3 }),
      ],
    ];
    // Each forged state gets the hash it would need, so it is readState that
    // refuses it and not the hash check.
    const forge = (change: (state: Record<string, unknown>) => void): string => {
      const data = JSON.parse(text);
      change(data.state);
      try {
        data.hash = hashStateAs(data.state as World, SNAPSHOT_VERSION, {
          map: data.map,
          programs: data.programs,
          kinds: data.kinds,
          spawns: data.spawns,
        });
      } catch {
        // Arrows that are not a list cannot be hashed, so the old hash stays.
      }
      return JSON.stringify(data);
    };
    // The hash made to fit is the one restore wants: an unchanged state passes with it.
    expect(
      hashWorld(
        restore(
          forge(() => {}),
          MAP,
          PROGRAMS,
          KINDS,
        ),
      ),
    ).toBe(hashWorld(busy()));
    for (const [what, change] of forged) {
      expect(() => restore(forge(change), MAP, PROGRAMS, KINDS), what).toThrow(SnapshotError);
    }
  });

  it("a spawn with a weapon no family has, or a monster with any weapon, is dropped", () => {
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      { ...spawn("Ash", "stander", ASH), weapon: "axe" } as unknown as Input,
      spawn("Post", "stander", { x: 20, y: 13 }, "bow", "post"),
      spawn("Bryn", "stander", { x: 18, y: 11 }),
    ]);
    expect(world.actors.map((a) => [a.name, a.weapon])).toEqual([["Bryn", "blade"]]);
  });

  it("a monster spawn dropped for its weapon holds back none of its region's spawns", () => {
    const quiet = createWorld(MAP, 1, PROGRAMS, KINDS);
    const tried = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(quiet);
    step(tried, [spawn("Post", "stander", { x: 20, y: 13 }, "bow", "post")]);
    expect(tried.actors).toEqual([]);
    expect(tried.nextSpawn).toEqual(quiet.nextSpawn);
    expect(hashWorld(tried)).toBe(hashWorld(quiet));
    // Without the weapon the same spawn is honoured and holds them.
    step(tried, [spawn("Post", "stander", { x: 20, y: 13 }, undefined, "post")]);
    step(quiet);
    expect(tried.actors.map((a) => a.kind)).toEqual(["post"]);
    expect(tried.nextSpawn).not.toEqual(quiet.nextSpawn);
  });
});

const actorOf = (state: Record<string, unknown>, i: number): Record<string, unknown> =>
  (state.actors as Record<string, unknown>[])[i] as Record<string, unknown>;
const arrowOf = (state: Record<string, unknown>): Record<string, unknown> =>
  (state.arrows as Record<string, unknown>[])[0] as Record<string, unknown>;

// So the families' numbers stay slice.md's.
it("the families' knockback is a quarter, two tiles, one tile and a quarter", () => {
  expect(FAMILIES.map((f) => WEAPONS[f].knockback)).toEqual([1, 8, 4, 1]);
});
