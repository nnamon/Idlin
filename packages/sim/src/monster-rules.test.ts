import { atlasOf } from "./atlas.ts";
// The smaller rules around monsters and getting nowhere, each tested where it
// changes what happens: the residents' and monsters' rules for being stuck, a
// monster's blow at dusk, the camp's ground, and the `stalled` count.

import { describe, expect, it } from "vitest";
import { MAX_STALLED } from "./brain.ts";
import { isWalkable, NEIGHBOURS, type Point, parseMap, place, terrainAt } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight, shippedMonsters, shippedPrograms, shippedWorld } from "./testing.ts";
import {
  createWorld,
  GROUP_SPREAD,
  hashWorld,
  isNight,
  NIGHT_HOUR,
  restore,
  SnapshotError,
  START_HOUR,
  snapshot,
  step,
  TICKS_PER_GAME_HOUR,
  type World,
  type WorldEvent,
} from "./world.ts";

// The worlds here are made on the shipped world, as the shipped programs need.
// Its camp's region, where every monster comes out, is MAP at the same
// coordinates, so the tests read the ground off MAP.
const MAP = firstLight();
const WORLD = shippedWorld();
const MONSTERS = shippedMonsters();
const EXTRA = compileBots({
  post: 'otherwise as "stand" -> wait(100)',
  swing: 'otherwise as "swing" -> attack(self_x - 1, self_y)',
  clear: 'otherwise as "clear" -> step_clear',
  roam: 'otherwise as "roam" -> wander',
  stuck: 'otherwise as "go nowhere" -> walk_to(self_x, self_y)',
  to_wood: 'otherwise as "go" -> walk_to(4, 6); wait(100)',
});
const ALL = { ...shippedPrograms(), ...MONSTERS.programs, ...EXTRA };
type Actor = World["actors"][number];

const run = (world: World, ticks: number): WorldEvent[] => {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...step(world));
  return log;
};
const steps = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const ground = (p: Point) => isWalkable(MAP, p.x, p.y) && terrainAt(MAP, p.x, p.y) !== "camp";
/** The two dead ends north of camp: the tip, its one way out, and the tile beyond. */
const DEAD_ENDS: readonly (readonly [Point, Point, Point])[] = [
  [
    { x: 6, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 2 },
  ],
  [
    { x: 13, y: 1 },
    { x: 14, y: 1 },
    { x: 14, y: 2 },
  ],
];
/**
 * The most moves in a row that went nowhere (`stalled`) for `actor`, over
 * `ticks` ticks. Standing to chop a tree is not counted: only moves are.
 */
function longestStall(world: World, actor: Actor, ticks: number): number {
  let longest = 0;
  for (let t = 0; t < ticks; t++) {
    step(world);
    longest = Math.max(longest, actor.stalled);
  }
  return longest;
}

describe("the dead ends", () => {
  it("the tiles are what the tests below take them for", () => {
    for (const [tip, neck, beyond] of DEAD_ENDS) {
      const around = (p: Point) =>
        NEIGHBOURS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(ground);
      expect(around(tip)).toEqual([neck]);
      expect(around(neck).filter((p) => steps(p, tip) > 0)).toEqual([beyond]);
      expect(steps(tip, place(MAP, "camp"))).toBeGreaterThanOrEqual(8);
    }
  });
});

describe("finding another way", () => {
  it("a resident that can't get at a monster past an ally goes elsewhere instead of standing", () => {
    // A goblin that only stands at the tip, an ally that only stands on the neck,
    // and the resident one tile beyond: every step towards the goblin goes nowhere.
    for (const program of ["wanderer", "riverwalker"]) {
      for (const [tip, neck, beyond] of DEAD_ENDS) {
        const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
        step(world, [
          { type: "spawn", name: "Goblin", program: "post", kind: "goblin", ...tip },
          { type: "spawn", name: "Bryn", program: "post", ...neck },
          { type: "spawn", name: "Ash", program, ...beyond },
        ]);
        const ash = world.actors[2] as Actor;
        // Without the rule, Ash repeats step_to and gets nowhere, dozens of times in a row.
        expect(
          longestStall(world, ash, 1500),
          `${program} at ${beyond.x},${beyond.y}`,
        ).toBeLessThanOrEqual(3);
      }
    }
  });

  it("a hurt goblin cornered at the end of a dead end stabs its way out", () => {
    for (const [tip, neck] of DEAD_ENDS) {
      const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
      step(world, [
        { type: "spawn", name: "Goblin", program: "goblin", kind: "goblin", ...tip },
        { type: "spawn", name: "Ash", program: "post", ...neck },
      ]);
      const goblin = world.actors[0] as Actor;
      goblin.hp = (MONSTERS.kinds.goblin?.hp as number) / 2;
      let moved = false;
      const log: WorldEvent[] = [];
      for (let t = 0; t < 600 && !moved; t++) {
        log.push(...step(world));
        moved = goblin.x !== tip.x || goblin.y !== tip.y;
      }
      // Ash blocks the only way out and never moves, so the goblin is only out
      // once its stabs have put Ash down and sent it back to camp.
      expect(log.some((e) => e.type === "attack" && e.actor === goblin.id)).toBe(true);
      expect(log.some((e) => e.type === "down" && e.actor === 2)).toBe(true);
      expect(moved, `goblin at ${tip.x},${tip.y}`).toBe(true);
    }
  });
});

describe("prowling and loitering", () => {
  /** Tiles a monster can stand on within `most` steps' walk of `from`, `from` included. */
  function within(from: Point, most: number): Point[] {
    const key = (p: Point) => p.y * MAP.width + p.x;
    const seen = new Set([key(from)]);
    let ring = [from];
    const all = [from];
    for (let depth = 0; depth < most; depth++) {
      const next: Point[] = [];
      for (const p of ring) {
        for (const [dx, dy] of NEIGHBOURS) {
          const q = { x: p.x + dx, y: p.y + dy };
          if (!ground(q) || seen.has(key(q))) continue;
          seen.add(key(q));
          next.push(q);
        }
      }
      all.push(...next);
      ring = next;
    }
    return all;
  }

  it("a lone wolf or goblin on any tile it can come out on walks about without going nowhere", () => {
    let homes = 0;
    for (const spawn of MONSTERS.spawns) {
      for (const part of ["day", "night"] as const) {
        for (const at of spawn[part]) {
          for (const home of within(at, GROUP_SPREAD)) {
            homes++;
            const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
            if (part === "night") world.tick = (NIGHT_HOUR - START_HOUR + 1) * TICKS_PER_GAME_HOUR;
            step(world, [
              { type: "spawn", name: "M", program: spawn.program, kind: spawn.kind, ...home },
            ]);
            const monster = world.actors[0] as Actor;
            const tiles = new Set<string>();
            for (let t = 0; t < 400; t++) {
              step(world);
              tiles.add(`${monster.x},${monster.y}`);
              // Every walk it chose went somewhere.
              expect(monster.stalled, `${spawn.kind} from ${home.x},${home.y}`).toBe(0);
            }
            expect(tiles.size, `${spawn.kind} from ${home.x},${home.y}`).toBeGreaterThan(2);
          }
        }
      }
    }
    expect(homes).toBeGreaterThan(10);
  });
});

describe("going home", () => {
  it("a monster in the middle of a blow at dusk stays until the blow lands", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    const dusk = (NIGHT_HOUR - START_HOUR) * TICKS_PER_GAME_HOUR;
    world.tick = dusk - 4;
    // A goblin out for the day, alone, that swings at the empty tile beside it.
    step(world, [{ type: "spawn", name: "Goblin", program: "swing", kind: "goblin", x: 4, y: 6 }]);
    const goblin = world.actors[0] as Actor;
    Object.assign(goblin, { shift: "day" });
    expect(goblin.windup).toBeGreaterThan(0);
    const log: WorldEvent[] = [];
    while (world.tick < dusk) log.push(...step(world));
    expect(isNight(world)).toBe(true);
    expect(world.actors).toContain(goblin);
    while (world.actors.includes(goblin) && world.tick < dusk + 30) log.push(...step(world));
    const landed = log.find((e) => e.type === "miss" && e.actor === goblin.id);
    const left = log.find((e) => e.type === "leave" && e.actor === goblin.id);
    expect(landed).toBeDefined();
    // It goes on the tick after its blow lands.
    expect(left?.tick).toBe((landed?.tick as number) + 1);
  });
});

describe("the camp's ground", () => {
  it("a monster may step onto it, but is never put down on it", () => {
    // (14, 5) is beside the camp's ground at (14, 6). Blows are about to land on
    // it and on its other three neighbours, so the nearest safe tile is camp.
    const edge = { x: 14, y: 5 };
    expect(terrainAt(MAP, 14, 6)).toBe("camp");
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [
      { type: "spawn", name: "Goblin", program: "clear", kind: "goblin", ...edge },
      { type: "spawn", name: "Ash", program: "post", x: 22, y: 3 },
      // Put down on the camp's ground by hand: refused.
      { type: "spawn", name: "Goblin", program: "post", kind: "goblin", x: 14, y: 7 },
    ]);
    expect(world.actors).toHaveLength(2);
    const [goblin, ash] = world.actors as [Actor, Actor];
    ash.windup = 100;
    world.marks = [edge, { x: 13, y: 5 }, { x: 15, y: 5 }, { x: 14, y: 4 }].map((p) => ({
      ...p,
      by: ash.id,
    }));
    run(world, 10);
    // It took the nearest safe tile, on the camp's ground.
    expect(goblin).toMatchObject({ x: 14, y: 6 });
    // And a world with it standing there saves and resumes, once the blows
    // made up for this test, longer than Ash's wind-up, are cleared.
    ash.windup = 0;
    world.marks = [];
    const resumed = restore(snapshot(world), WORLD, ALL, MONSTERS.kinds);
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });
});

describe("`stalled`", () => {
  it("counts step_clear and wander that go nowhere", () => {
    // A map of one tile, so wander has nowhere to go, and no blows, so step_clear
    // has nothing to step out of.
    const pocket = parseMap({
      name: "pocket",
      width: 1,
      height: 1,
      legend: { c: "camp" },
      rows: ["c"],
      places: { camp: { x: 0, y: 0 } },
    });
    for (const program of ["clear", "roam"]) {
      const world = createWorld(pocket, 1, EXTRA);
      step(world, [{ type: "spawn", name: "Ash", program, x: 0, y: 0 }]);
      const ash = world.actors[0] as Actor;
      run(world, 30);
      expect(ash.stalled, program).toBeGreaterThanOrEqual(4);
    }
  });

  it("stops counting at its cap, and a snapshot past the cap is refused", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [{ type: "spawn", name: "Ash", program: "stuck", x: 13, y: 9 }]);
    const ash = world.actors[0] as Actor;
    ash.stalled = MAX_STALLED - 2;
    const seen: number[] = [];
    for (let t = 0; t < 60; t++) {
      step(world);
      seen.push(ash.stalled);
    }
    expect(seen.filter((n, i) => n !== seen[i - 1])).toEqual([
      MAX_STALLED - 2,
      MAX_STALLED - 1,
      MAX_STALLED,
    ]);

    const saved = snapshot(world);
    expect(restore(saved, WORLD, ALL, MONSTERS.kinds)).toEqual(world);
    const forge = (stalled: unknown): string => {
      const data = JSON.parse(saved);
      data.state.actors[0].stalled = stalled;
      data.hash = hashWorld({
        ...data.state,
        atlas: atlasOf(WORLD),
        programs: ALL,
        kinds: MONSTERS.kinds,
        spawns: [],
      });
      return JSON.stringify(data);
    };
    expect(restore(forge(0), WORLD, ALL, MONSTERS.kinds).actors[0]?.stalled).toBe(0);
    for (const bad of [MAX_STALLED + 1, -1, 1.5, "3"]) {
      expect(() => restore(forge(bad), WORLD, ALL, MONSTERS.kinds), `stalled ${bad}`).toThrow(
        SnapshotError,
      );
    }
  });
});

describe("where a group comes out", () => {
  it("not on a tile someone is walking to", () => {
    // One goblin by day at `deep_wood`, the first group held back a tick, and Ash
    // beside it making for that very tile when the goblin comes.
    const spawns = [
      {
        kind: "goblin",
        name: "Goblin",
        program: "post",
        group: 1,
        day: [{ x: 4, y: 6 }],
        night: [],
      },
    ];
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds, spawns);
    world.nextSpawn = [2];
    step(world, [{ type: "spawn", name: "Ash", program: "to_wood", x: 3, y: 6 }]);
    const ash = world.actors[0] as Actor;
    expect(ash.path).toEqual([{ x: 4, y: 6 }]);
    step(world);
    const goblin = world.actors.find((a) => a.kind === "goblin") as Actor;
    expect(goblin).toBeDefined();
    expect([goblin.x, goblin.y]).not.toEqual([4, 6]);
    expect(steps(goblin, { x: 4, y: 6 })).toBe(1);
    run(world, 20);
    expect([ash.x, ash.y]).toEqual([4, 6]);
  });
});
