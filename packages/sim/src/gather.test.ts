// Trees, fishing spots, cooking and eating.

import { describe, expect, it } from "vitest";
import { atlasOf } from "./atlas.ts";
import { BAG_SLOTS, GOODS, goodId } from "./bag.ts";
import {
  burnOdds,
  COOK_TICKS,
  COOK_XP,
  cook,
  EAT_HEAL,
  eat,
  GATHER_TICKS,
  gatherOdds,
  NO_NODE,
  work,
} from "./gather.ts";
import { MapError, parseMap } from "./map.ts";
import { NODE_KINDS, nodeKindId } from "./nodes.ts";
import { levelFor, SKILLS, type Skill, XP_TABLE } from "./skills.ts";
import { compileBots } from "./tactics.ts";
import { campMap, campMonsters, campPrograms, rawCamp, spawnsNearCamp } from "./testing.ts";
import {
  type Actor,
  ADVENTURER,
  ADVENTURER_KIND,
  createWorld,
  hashWorld,
  restore,
  SnapshotError,
  snapshot,
  step,
  type World,
  type WorldEvent,
} from "./world.ts";

const LONG = process.env.IDLIN_LONG === "1";
const WORLD = atlasOf(campMap());
/** What the camp world called a game hour and a game day, in ticks. */
const HOUR = 600;
const DAY = 24 * HOUR;
const MONSTERS = campMonsters(WORLD);
// Strong enough to put a resident down in the fight below, fed or not, against a blade's blow every 5 ticks.
const KINDS = { wolf: { hp: 150, damage: 4, windup: 6, recovery: 10, reach: 1 } };
const SOURCES: Record<string, string> = {
  chopper: "otherwise -> chop",
  fisher: "otherwise -> fish",
  cook: "otherwise -> cook",
  eater: "otherwise -> eat",
  stander: "otherwise -> wait(600)",
  reader: `otherwise -> set d = node_distance(tree); set x = node_x(tree); set y = node_y(tree);
    set o = node_distance(old_tree); set f = at_fire; set p = node_distance(deep_pool); idle`,
  // Eats between blows once it is down to 10, and otherwise trades blows,
  // following the wolf when its blade has knocked it back.
  fighter: `when hp <= 10 and carrying(cooked_fish) > 0 -> eat
    when threat_distance <= 1 -> attack(threat_x, threat_y)
    when threat_distance <= 3 -> step_to(threat_x, threat_y)
    otherwise -> wait(5)`,
  biter: "when threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wait(5)",
};
const hostile = [
  "node_distance(0)",
  "node_distance(5)",
  "node_distance(0 - 1)",
  "node_distance(2147483647)",
  "node_x(0 - 2147483647)",
  "node_y(99)",
];
hostile.forEach((call, i) => {
  SOURCES[`hostile${i}`] = `otherwise -> set v = ${call}; chop; fish; cook; eat`;
});
const PROGRAMS = compileBots(SOURCES, Object.fromEntries(WORLD.places.map((p) => [p.name, p])));

const LOGS = goodId("logs");
const RAW = goodId("raw_fish");
const COOKED = goodId("cooked_fish");
const BURNT = goodId("burnt_fish");

/** The index of the node on (x, y) of the camp's map. */
const nodeAt = (x: number, y: number): number => {
  const index = WORLD.nodes.findIndex((n) => n.x === x && n.y === y);
  if (index < 0) throw new Error(`no node at ${x}, ${y}`);
  return index;
};
// A tree near the camp, worked from (12, 6), the only node beside that tile.
const TREE = nodeAt(12, 5);
const BY_TREE = { x: 12, y: 6 };
// An old tree in the deep wood, worked from (8, 4).
const OLD_TREE = nodeAt(7, 4);
const BY_OLD_TREE = { x: 8, y: 4 };
// A deep pool, of which the camp has none, at (23, 0) of a copy of it, worked from (22, 0).
const POOL_MAP = atlasOf(
  parseMap({
    ...rawCamp(),
    name: "camp_with_pool",
    nodes: [...(rawCamp().nodes as unknown[]), { kind: "deep_pool", x: 23, y: 0 }],
  }),
);
const POOL = POOL_MAP.nodes.findIndex((n) => n.kind === nodeKindId("deep_pool"));
const BY_POOL = { x: 22, y: 0 };
// A fishing spot on the camp's river, worked from (23, 10), the `river` place.
const SPOT = nodeAt(24, 10);
const BY_SPOT = { x: 23, y: 10 };
// Beside the camp fire at (14, 7).
const BY_FIRE = { x: 14, y: 8 };

/** A world of the camp's map with one adventurer, Ash, on `where`, running `program`. */
function withOne(
  program: string,
  where: { x: number; y: number },
  map = WORLD,
): { world: World; ash: Actor } {
  const world = createWorld(map, 1, PROGRAMS, KINDS);
  step(world, [{ type: "spawn", name: "Ash", program, ...where }]);
  const ash = world.actors[0];
  if (!ash) throw new Error("no actor");
  return { world, ash };
}

const setLevel = (actor: Actor, skill: Skill, level: number): void => {
  actor.xp[SKILLS.indexOf(skill)] = XP_TABLE[level] as number;
};

/** Steps `ticks` times and returns every event. */
const run = (world: World, ticks: number): WorldEvent[] => {
  const log: WorldEvent[] = [];
  for (let t = 0; t < ticks; t++) log.push(...step(world));
  return log;
};

describe("nodes in the map files", () => {
  it("are listed in order, in world coordinates, on their kind's terrain", () => {
    expect(NODE_KINDS.map((k) => k.name)).toEqual([
      "tree",
      "old_tree",
      "fishing_spot",
      "deep_pool",
    ]);
    expect(nodeKindId("deep_pool")).toBe(4);
    const count = (name: string): number =>
      WORLD.nodes.filter((n) => n.kind === nodeKindId(name)).length;
    expect([count("tree"), count("old_tree"), count("fishing_spot"), count("deep_pool")]).toEqual([
      12, 3, 5, 0,
    ]);
    expect(WORLD.nodes[0]).toEqual({ kind: nodeKindId("tree"), x: 12, y: 5 });
  });

  it("refuses a node off its terrain, cut off, doubled, of no kind, or not a list", () => {
    const camp = rawCamp();
    const withNodes = (nodes: unknown) => () => parseMap({ ...camp, nodes });
    expect(withNodes([{ kind: "tree", x: 14, y: 9 }])).toThrow(/a tree must stand on tree/);
    expect(withNodes([{ kind: "fishing_spot", x: 12, y: 5 }])).toThrow(/must stand on water/);
    // Deep in the river, with water on every side.
    expect(withNodes([{ kind: "fishing_spot", x: 22, y: 16 }])).toThrow(/no walkable tile beside/);
    expect(
      withNodes([
        { kind: "tree", x: 12, y: 5 },
        { kind: "tree", x: 12, y: 5 },
      ]),
    ).toThrow(/two nodes on/);
    expect(withNodes([{ kind: "bush", x: 12, y: 5 }])).toThrow(/no kind of node called "bush"/);
    expect(withNodes([{ kind: "tree", x: 99, y: 5 }])).toThrow(/needs whole-number x and y/);
    expect(withNodes([{ kind: "tree", x: 12.5, y: 5 }])).toThrow(MapError);
    expect(withNodes({ kind: "tree" })).toThrow(/nodes must be a list/);
    expect(withNodes([null])).toThrow(/must be an object/);
    expect(withNodes(Array.from({ length: 65 }, () => ({})))).toThrow(/at most 64/);
    // Left out, a map has none.
    const bare = { ...camp };
    delete bare.nodes;
    expect(parseMap(bare).nodes).toEqual([]);
  });
});

describe("a node", () => {
  it("gives its yield one good at a time, runs out, and regrows after its time", () => {
    const { world, ash } = withOne("chopper", BY_TREE);
    const kind = NODE_KINDS[0] as (typeof NODE_KINDS)[number];
    const log: WorldEvent[] = [];
    let ranOut = -1;
    for (let t = 0; t < 3000 && ranOut < 0; t++) {
      const events = step(world);
      log.push(...events);
      if (events.some((e) => e.type === "deplete")) ranOut = world.tick;
    }
    const gathered = log.filter((e) => e.type === "gather");
    expect(gathered).toHaveLength(kind.yield);
    expect(gathered.every((e) => e.type === "gather" && e.node === TREE && e.good === "logs")).toBe(
      true,
    );
    expect(ash.bag.filter((g) => g === LOGS)).toHaveLength(kind.yield);
    expect(world.nodes[TREE]).toEqual({ left: 0, back: ranOut + kind.regrow });
    // Each log is 25 experience.
    expect(ash.xp[SKILLS.indexOf("woodcutting")]).toBe(kind.yield * kind.xp);
    // Run out, it gives nothing, and Ash's tries cost no roll and change nothing.
    const rng = { ...world.rng };
    const idle = run(world, kind.regrow - 2);
    expect(idle.filter((e) => e.type === "gather" || e.type === "regrow")).toEqual([]);
    expect(world.rng).toEqual(rng);
    expect(world.nodes[TREE]?.left).toBe(0);
    // Its time comes: it stands again with its full yield, on the tick it was due.
    const back = run(world, 2);
    expect(back.find((e) => e.type === "regrow")).toEqual({
      type: "regrow",
      tick: ranOut + kind.regrow,
      node: TREE,
      x: 12,
      y: 5,
    });
    expect(world.nodes[TREE]).toEqual({ left: kind.yield, back: 0 });
    // And can be worked again.
    expect(run(world, 600).some((e) => e.type === "gather")).toBe(true);
  });

  it("is tried once a decision, standing GATHER_TICKS between, and not at all with a full bag", () => {
    const { world, ash } = withOne("chopper", BY_TREE);
    const decided = run(world, 1200)
      .filter((e) => e.type === "decide" && e.actor === ash.id)
      .map((e) => e.tick);
    const gaps = new Set(decided.slice(1).map((tick, i) => tick - (decided[i] as number)));
    // One tick to decide, then GATHER_TICKS standing; with the tree out, the short pause.
    expect(gaps).toContain(GATHER_TICKS + 1);
    const full = withOne("chopper", BY_TREE);
    full.ash.bag = new Array<number>(BAG_SLOTS).fill(RAW);
    const rng = { ...full.world.rng };
    expect(run(full.world, 600).some((e) => e.type === "gather")).toBe(false);
    expect(full.world.rng).toEqual(rng);
    expect(full.world.nodes[TREE]?.left).toBe(NODE_KINDS[0]?.yield);
  });

  it("is only worked by the action of its skill, from beside it, by an adventurer", () => {
    // Fishing at a tree, and chopping two tiles from it, give nothing.
    expect(run(withOne("fisher", BY_TREE).world, 600).some((e) => e.type === "gather")).toBe(false);
    expect(
      run(withOne("chopper", { x: 12, y: 8 }).world, 600).some((e) => e.type === "gather"),
    ).toBe(false);
    const fished = run(withOne("fisher", BY_SPOT).world, 1200).filter((e) => e.type === "gather");
    expect(fished.length).toBeGreaterThan(0);
    expect(
      fished.every((e) => e.type === "gather" && e.node === SPOT && e.good === "raw_fish"),
    ).toBe(true);
    // A monster has no bag and no skills: its chop does nothing.
    const world = createWorld(WORLD, 1, PROGRAMS, KINDS);
    step(world, [{ type: "spawn", name: "Wolf", program: "chopper", kind: "wolf", ...BY_TREE }]);
    expect(run(world, 600).some((e) => e.type === "gather")).toBe(false);
    expect(world.nodes[TREE]?.left).toBe(NODE_KINDS[0]?.yield);
  });

  it("works out the odds of a try from the level, from 25 in 100 at the level it needs up to 90", () => {
    expect(gatherOdds(1, 1)).toBe(25);
    expect(gatherOdds(15, 15)).toBe(25);
    expect(gatherOdds(10, 1)).toBe(52);
    expect(gatherOdds(99, 1)).toBe(90);
    // Over many seeded tries at a tree, a level 1 adventurer gets a log about a quarter of the time.
    const { world, ash } = withOne("stander", BY_TREE);
    let got = 0;
    const tries = 4000;
    for (let i = 0; i < tries; i++) {
      ash.bag.fill(0);
      ash.xp.fill(0);
      (world.nodes[TREE] as { left: number }).left = 6;
      const before = ash.bag.filter((g) => g === LOGS).length;
      expect(work(world, ash, "woodcutting", [])).toBe(true);
      got += ash.bag.filter((g) => g === LOGS).length - before;
    }
    expect(got / tries).toBeGreaterThan(0.22);
    expect(got / tries).toBeLessThan(0.28);
  });
});

describe("level gates", () => {
  it("keep an old tree from anyone under Woodcutting 15, and let them in at 15", () => {
    const low = withOne("chopper", BY_OLD_TREE);
    setLevel(low.ash, "woodcutting", 14);
    // One experience short of 15 is still 14.
    low.ash.xp[SKILLS.indexOf("woodcutting")] = (XP_TABLE[15] as number) - 1;
    expect(run(low.world, 1200).some((e) => e.type === "gather")).toBe(false);
    expect(low.world.nodes[OLD_TREE]?.left).toBe(NODE_KINDS[1]?.yield);
    const high = withOne("chopper", BY_OLD_TREE);
    setLevel(high.ash, "woodcutting", 15);
    const got = run(high.world, 1200).filter((e) => e.type === "gather");
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((e) => e.type === "gather" && e.node === OLD_TREE)).toBe(true);
    expect(high.ash.xp[SKILLS.indexOf("woodcutting")]).toBe(
      (XP_TABLE[15] as number) + got.length * 60,
    );
  });

  it("keep a deep pool from anyone under Fishing 15", () => {
    const low = withOne("fisher", BY_POOL, POOL_MAP);
    setLevel(low.ash, "fishing", 14);
    expect(run(low.world, 1200).some((e) => e.type === "gather")).toBe(false);
    const high = withOne("fisher", BY_POOL, POOL_MAP);
    setLevel(high.ash, "fishing", 15);
    const got = run(high.world, 1200).filter((e) => e.type === "gather");
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((e) => e.type === "gather" && e.node === POOL && e.good === "raw_fish")).toBe(
      true,
    );
  });

  it("hide a node the level does not allow from the node sensors", () => {
    const { world, ash } = withOne("reader", BY_OLD_TREE);
    run(world, 10);
    // d, x, y, o, f, p: the tree beside (11, 4) is the nearest, at its free side (10, 4).
    expect(ash.memory.slice(0, 6)).toEqual([2, 10, 4, NO_NODE, 0, NO_NODE]);
    setLevel(ash, "woodcutting", 15);
    run(world, 10);
    expect(ash.memory[3]).toBe(0);
  });
});

describe("the node sensors", () => {
  it("point to the nearest free side of a standing node", () => {
    const { world, ash } = withOne("reader", BY_TREE);
    run(world, 10);
    expect(ash.memory.slice(0, 3)).toEqual([0, BY_TREE.x, BY_TREE.y]);
    // Someone standing on the tile next to it changes nothing.
    step(world, [{ type: "spawn", name: "Bryn", program: "stander", x: 13, y: 6 }]);
    const bryn = world.actors[1] as Actor;
    expect([bryn.x, bryn.y]).toEqual([13, 6]);
    run(world, 10);
    expect(ash.memory.slice(0, 3)).toEqual([0, BY_TREE.x, BY_TREE.y]);
    // On Ash's own tile, it takes that side. The other three sides of the tree are
    // each two steps off, and the first in NEIGHBOURS order, north, is the one.
    bryn.x = bryn.fromX = BY_TREE.x;
    bryn.y = bryn.fromY = BY_TREE.y;
    run(world, 10);
    expect(ash.memory.slice(0, 3)).toEqual([2, 12, 4]);
    // A tree that has run out is passed over: with Bryn gone, the next is the
    // tree at (11, 4), whose east side (12, 4) is two steps off.
    bryn.x = bryn.fromX = 13;
    bryn.y = bryn.fromY = 6;
    (world.nodes[TREE] as { left: number; back: number }).left = 0;
    (world.nodes[TREE] as { left: number; back: number }).back = world.tick + 100;
    run(world, 10);
    expect(ash.memory.slice(0, 3)).toEqual([2, 12, 4]);
  });

  it("see a fire only within two steps", () => {
    const fire = withOne("reader", { x: 14, y: 9 });
    run(fire.world, 10);
    expect(fire.ash.memory[4]).toBe(1);
    const far = withOne("reader", { x: 14, y: 10 });
    run(far.world, 10);
    expect(far.ash.memory[4]).toBe(0);
  });

  it("take hostile kinds without trouble", () => {
    for (let i = 0; i < hostile.length; i++) {
      const { world, ash } = withOne(`hostile${i}`, BY_TREE);
      const log = run(world, 300);
      expect(
        log.some((e) => e.type === "fault"),
        hostile[i],
      ).toBe(false);
      expect(ash.fault).toBe(0);
    }
  });
});

describe("cooking", () => {
  it("burns a fish with odds from the Cooking level: 30 in 100 at 1, none from 16", () => {
    expect([1, 5, 10, 15, 16, 99].map(burnOdds)).toEqual([30, 22, 12, 2, 0, 0]);
    const { world, ash } = withOne("stander", BY_FIRE);
    for (const level of [1, 10, 16]) {
      let burnt = 0;
      const tries = 3000;
      for (let i = 0; i < tries; i++) {
        setLevel(ash, "cooking", level);
        ash.bag.fill(0);
        ash.bag[3] = RAW;
        ash.bag[7] = LOGS;
        const events: WorldEvent[] = [];
        expect(cook(world, ash, events)).toBe(true);
        // The log is gone and the fish's slot holds what came out.
        expect(ash.bag[7]).toBe(0);
        expect([COOKED, BURNT]).toContain(ash.bag[3]);
        if (ash.bag[3] === BURNT) burnt++;
        const xp = ash.xp[SKILLS.indexOf("cooking")] as number;
        expect(xp - (XP_TABLE[level] as number)).toBe(ash.bag[3] === BURNT ? 0 : COOK_XP);
        expect(events[0]).toMatchObject({ type: "cook", actor: ash.id });
      }
      const odds = burnOdds(level) / 100;
      expect(burnt / tries, `level ${level}`).toBeGreaterThanOrEqual(odds - 0.03);
      expect(burnt / tries, `level ${level}`).toBeLessThanOrEqual(odds + 0.03);
    }
  });

  it("needs the fire, a raw fish and a log, and stands COOK_TICKS after", () => {
    const away = withOne("cook", { x: 14, y: 11 });
    away.ash.bag[0] = RAW;
    away.ash.bag[1] = LOGS;
    expect(run(away.world, 300).some((e) => e.type === "cook")).toBe(false);
    for (const bag of [[RAW], [LOGS], [COOKED, BURNT]]) {
      const { world, ash } = withOne("cook", BY_FIRE);
      bag.forEach((good, i) => {
        ash.bag[i] = good;
      });
      const rng = { ...world.rng };
      expect(run(world, 300).some((e) => e.type === "cook")).toBe(false);
      expect(world.rng).toEqual(rng);
    }
    const { world, ash } = withOne("cook", BY_FIRE);
    ash.bag[0] = RAW;
    ash.bag[1] = RAW;
    ash.bag[5] = LOGS;
    ash.bag[6] = LOGS;
    const cooked = run(world, 100).filter((e) => e.type === "cook");
    expect(cooked).toHaveLength(2);
    expect((cooked[1] as WorldEvent).tick - (cooked[0] as WorldEvent).tick).toBe(COOK_TICKS + 1);
    expect(ash.bag.filter((g) => g === LOGS || g === RAW)).toEqual([]);
  });
});

describe("eating", () => {
  it("heals up to EAT_HEAL, never past full, and keeps the fish at full hitpoints", () => {
    const { world, ash } = withOne("stander", BY_FIRE);
    ash.bag[2] = COOKED;
    ash.bag[4] = COOKED;
    ash.bag[5] = BURNT;
    expect(eat(world, ash, [])).toBe(false);
    expect(ash.bag.filter((g) => g === COOKED)).toHaveLength(2);
    ash.hp = 5;
    const events: WorldEvent[] = [];
    expect(eat(world, ash, events)).toBe(true);
    expect(ash.hp).toBe(5 + EAT_HEAL);
    expect(ash.bag[2]).toBe(0);
    expect(events).toEqual([{ type: "eat", tick: world.tick, actor: ash.id, hp: 5 + EAT_HEAL }]);
    ash.hp = ADVENTURER_KIND.hp - 2;
    expect(eat(world, ash, [])).toBe(true);
    expect(ash.hp).toBe(ADVENTURER_KIND.hp);
    // A burnt fish is no food.
    ash.hp = 3;
    expect(eat(world, ash, [])).toBe(false);
    expect(ash.bag[5]).toBe(BURNT);
  });

  it("works mid-fight: food carried is hitpoints carried", () => {
    // The same fight twice, once with three cooked fish in the bag.
    const fight = (fish: number) => {
      const world = createWorld(WORLD, 3, PROGRAMS, KINDS);
      step(world, [
        { type: "spawn", name: "Wolf", program: "biter", kind: "wolf", x: 22, y: 13 },
        { type: "spawn", name: "Ash", program: "fighter", x: 21, y: 13 },
      ]);
      const ash = world.actors[1] as Actor;
      for (let i = 0; i < fish; i++) ash.bag[i] = COOKED;
      const log = run(world, 600);
      return { ash, log, world };
    };
    const fed = fight(3);
    const eaten = fed.log.filter((e) => e.type === "eat");
    expect(eaten.length).toBeGreaterThan(0);
    // Each meal came while the wolf stood beside Ash, between blows.
    for (const meal of eaten) {
      const blows = fed.log.filter((e) => e.type === "hit" && e.target === fed.ash.id);
      expect(blows.some((b) => b.tick < meal.tick)).toBe(true);
      expect(blows.some((b) => b.tick > meal.tick)).toBe(true);
    }
    const hungry = fight(0);
    const firstDown = (log: WorldEvent[]) =>
      log.find((e) => e.type === "down" && e.kind === ADVENTURER)?.tick ?? Infinity;
    expect(firstDown(fed.log)).toBeGreaterThan(firstDown(hungry.log));
  });
});

describe("a snapshot of nodes", () => {
  /** A shipped world where Ash has run the tree beside it out and taken three of the next. */
  function worked(): World {
    const { world } = withOne("chopper", BY_TREE);
    while ((world.nodes[TREE] as { left: number }).left > 0) step(world);
    run(world, 30);
    return world;
  }

  it("restores what each node has left and goes on the same", () => {
    const world = worked();
    const copy = restore(snapshot(world), WORLD, PROGRAMS, KINDS);
    expect(copy.nodes).toEqual(world.nodes);
    expect(copy).toEqual(world);
    run(world, 2 * HOUR);
    run(copy, 2 * HOUR);
    expect(hashWorld(copy)).toBe(hashWorld(world));
    expect(copy.nodes[TREE]?.left).toBeGreaterThan(0);
  });

  it("refuses node states no world could hold", () => {
    const text = snapshot(worked());
    const tick = JSON.parse(text).state.tick as number;
    const breaks: ((nodes: Record<string, unknown>[], state: Record<string, unknown>) => void)[] = [
      (n) => n.pop(),
      (n) => n.push({ left: 1, back: 0 }),
      (_, s) => delete s.nodes,
      (_, s) => (s.nodes = {}),
      (n) => ((n[1] as Record<string, unknown>).left = -1),
      (n) => ((n[1] as Record<string, unknown>).left = 7),
      (n) => ((n[1] as Record<string, unknown>).left = "6"),
      (n) => ((n[1] as Record<string, unknown>).left = 2.5),
      (n) => delete (n[1] as Record<string, unknown>).back,
      // Standing, it is not due back; run out, it is due back after this tick and within its regrow time.
      (n) => ((n[1] as Record<string, unknown>).back = tick + 5),
      (n) => ((n[TREE] as Record<string, unknown>).back = 0),
      (n) => ((n[TREE] as Record<string, unknown>).back = tick),
      (n) => ((n[TREE] as Record<string, unknown>).back = tick + 2 * HOUR + 1),
      (n) => ((n[TREE] as Record<string, unknown>).back = 2 ** 60),
      (n) => (n[TREE] = null as unknown as Record<string, unknown>),
    ];
    for (const change of breaks) {
      const data = JSON.parse(text);
      change(data.state.nodes, data.state);
      expect(() => restore(JSON.stringify(data), WORLD, PROGRAMS, KINDS), String(change)).toThrow(
        SnapshotError,
      );
    }
    expect(() => restore(text, WORLD, PROGRAMS, KINDS)).not.toThrow();
  });

  it("refuses a good past the end of the list, and a bank of the old length", () => {
    const text = snapshot(worked());
    for (const change of [
      (a: Record<string, number[]>) => ((a.bag as number[])[0] = GOODS.length + 1),
      (a: Record<string, number[]>) => (a.bank as number[]).pop(),
      (a: Record<string, number[]>) => (a.bank as number[]).push(0),
    ]) {
      const data = JSON.parse(text);
      change(data.state.actors[0]);
      expect(() => restore(JSON.stringify(data), WORLD, PROGRAMS, KINDS)).toThrow(SnapshotError);
    }
  });
});

// The full soak runs in the capture workflow (IDLIN_LONG=1): more seeds, and fifty residents.
const SOAKS: [seed: number, residents: number][] = LONG
  ? [
      [1, 6],
      [2, 6],
      [3, 6],
      [1, 50],
    ]
  : [[1, 6]];

describe("a camp day of gathering", () => {
  for (const [seed, residents] of SOAKS)
    it(`seed ${seed}, ${residents} residents, 24 game hours: goods come only from nodes and go only into cooking and eating`, () => {
      const programs = { ...campPrograms(WORLD), ...MONSTERS.programs };
      const world = createWorld(WORLD, seed, programs, MONSTERS.kinds);
      const names = ["wanderer", "homebody", "riverwalker"];
      let events = step(
        world,
        spawnsNearCamp(
          world,
          Array.from({ length: residents }, (_, i) => ({
            name: `R${i}`,
            program: names[i % 3] as string,
          })),
        ),
      );
      const held = (good: number): number =>
        world.actors.reduce(
          (sum, a) => sum + a.bag.filter((g) => g === good).length + (a.bank[good - 1] as number),
          0,
        );
      // What the events say there should be of each good, by id.
      const expected = new Array<number>(GOODS.length + 1).fill(0);
      // What each node has given since it last stood full.
      const given = world.nodes.map(() => 0);
      const add = (list: number[], index: number, by: number): void => {
        list[index] = (list[index] as number) + by;
      };
      const idOf = (good: string): number => goodId(good as (typeof GOODS)[number]);
      const tally = { gathered: 0, cooked: 0, burnt: 0, eaten: 0, ranOut: 0, regrew: 0 };
      for (let t = 0; t < DAY; t++) {
        events = step(world);
        for (const e of events) {
          if (e.type === "gather") {
            add(expected, idOf(e.good), 1);
            add(given, e.node, 1);
            tally.gathered++;
          } else if (e.type === "cook") {
            add(expected, LOGS, -1);
            add(expected, RAW, -1);
            add(expected, idOf(e.good), 1);
            if (e.good === "burnt_fish") tally.burnt++;
            else tally.cooked++;
          } else if (e.type === "eat") {
            add(expected, COOKED, -1);
            tally.eaten++;
          } else if (e.type === "regrow") {
            given[e.node] = 0;
            tally.regrew++;
          } else if (e.type === "deplete") tally.ranOut++;
        }
        for (let good = 1; good <= GOODS.length; good++)
          expect(held(good), `${GOODS[good - 1]} at tick ${world.tick}`).toBe(expected[good]);
        world.nodes.forEach((state, i) => {
          const kind = NODE_KINDS[(WORLD.nodes[i] as { kind: number }).kind - 1] as {
            yield: number;
          };
          expect(state.left).toBe(kind.yield - (given[i] as number));
        });
        for (const a of world.actors) {
          if (a.kind !== ADVENTURER) expect([...a.bag, ...a.bank].every((n) => n === 0)).toBe(true);
          else expect(a.hp).toBeLessThanOrEqual(ADVENTURER_KIND.hp);
          expect(a.bag.every((g) => g >= 0 && g <= GOODS.length)).toBe(true);
        }
      }
      // The shipped residents do all of it in a day.
      expect(tally.gathered).toBeGreaterThan(50 * Math.min(residents, 6));
      expect(tally.cooked).toBeGreaterThan(0);
      expect(tally.burnt).toBeGreaterThan(0);
      expect(tally.ranOut).toBeGreaterThan(0);
      expect(tally.regrew).toBeGreaterThan(0);
      // Levels come from it: with six, someone is past Woodcutting 10. Fifty share
      // the same trees, so each gets less.
      expect(
        Math.max(...world.actors.map((a) => levelFor(a.xp[SKILLS.indexOf("woodcutting")] ?? 0))),
      ).toBeGreaterThan(residents <= 6 ? 10 : 5);
      expect(restore(snapshot(world), WORLD, programs, MONSTERS.kinds)).toEqual(world);
    }, 120_000);
});
