import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { linked, pointOf, type Region, regionAt, tileAt, walkable } from "./atlas.ts";
import { wayTo } from "./brain.ts";
import {
  addMark,
  allAt,
  countWithin,
  firstAt,
  gridOf,
  holdGrid,
  inRegion,
  marksOn,
  nearest,
  putAt,
  releaseGrid,
  setPath,
  stepOff,
  stepOnto,
  tallyOf,
} from "./grid.ts";
import { NEIGHBOURS, type Point } from "./map.ts";
import { createRng, nextInt } from "./rng.ts";
import { crowd, shippedMonsters, shippedPrograms, shippedWorld } from "./testing.ts";
import {
  type Actor,
  blocks,
  canStep,
  createWorld,
  enemies,
  spawnsNearCamp,
  step,
  type World,
} from "./world.ts";

const steps = (a: Point, x: number, y: number): number => Math.abs(a.x - x) + Math.abs(a.y - y);

/** A crowd that has run a while, with some actors put onto others' tiles so tiles are shared. */
function busy(): World {
  const world = crowd(150, 450);
  for (let i = 0; i < 120; i++) step(world);
  const rng = createRng(7);
  for (let i = 0; i < 40; i++) {
    const a = world.actors[nextInt(rng, world.actors.length)] as Actor;
    const b = world.actors[nextInt(rng, world.actors.length)] as Actor;
    a.x = b.x;
    a.y = b.y;
  }
  return world;
}

describe("the grid of who stands where", () => {
  const world = busy();
  const rng = createRng(3);
  const { atlas } = world;
  const queries = Array.from({ length: 300 }, () => ({
    x: atlas.left + nextInt(rng, atlas.width),
    y: atlas.top + nextInt(rng, atlas.height),
    who: world.actors[nextInt(rng, world.actors.length)] as Actor,
    reach: nextInt(rng, 30) - 2,
  }));

  const all = atlas.regions[0] as Region;

  it("finds the nearest, first in update order among the nearest, as a pass over every actor does", () => {
    const grid = gridOf(world);
    for (const { x, y, who } of queries) {
      const test = (a: Actor): boolean => enemies(who, a);
      let expected: Actor | undefined;
      for (const a of world.actors)
        if (test(a) && (!expected || steps(a, x, y) < steps(expected, x, y))) expected = a;
      expect(nearest(grid, x, y, all, test)).toBe(expected);
    }
  });

  it("counts within a reach, and finds who is on a tile, as a pass over every actor does", () => {
    const grid = gridOf(world);
    for (const { x, y, who, reach } of queries) {
      const test = (a: Actor): boolean => a.kind === who.kind && a !== who;
      const within = world.actors.filter((a) => test(a) && steps(a, x, y) <= reach).length;
      expect(countWithin(grid, x, y, reach, all, test)).toBe(within);
      const on = (a: Actor): boolean => a.x === who.x && a.y === who.y;
      expect(allAt(grid, who.x, who.y, () => true)).toEqual(world.actors.filter(on));
      expect(firstAt(grid, who.x, who.y, (a) => blocks(a, who))).toBe(
        world.actors.find((a) => on(a) && blocks(a, who)),
      );
    }
  });

  it("a held grid follows every move, walk and mark, as a grid built afresh would have it", () => {
    const box = (): Point => ({
      x: atlas.left + nextInt(rng, atlas.width),
      y: atlas.top + nextInt(rng, atlas.height),
    });
    const inBox = (v: number, low: number, size: number): number =>
      Math.min(low + size - 1, Math.max(low, v));
    holdGrid(world);
    try {
      // Counted now, and kept from here by the changes below.
      tallyOf(gridOf(world));
      marksOn(gridOf(world), 0);
      for (let i = 0; i < 3000; i++) {
        const actor = world.actors[nextInt(rng, world.actors.length)] as Actor;
        const roll = nextInt(rng, 6);
        if (roll === 0) {
          // A jump, so actors cross into cells on every side.
          const to = box();
          putAt(world, actor, to.x, to.y);
        } else if (roll === 1) {
          const x = inBox(actor.x + nextInt(rng, 3) - 1, atlas.left, atlas.width);
          const y = inBox(actor.y + nextInt(rng, 3) - 1, atlas.top, atlas.height);
          stepOnto(world, actor, x, y);
        } else if (roll === 2) {
          setPath(world, actor, Array.from({ length: nextInt(rng, 4) }, box));
        } else if (roll === 3) {
          stepOff(world, actor);
        } else if (roll === 4) {
          addMark(world, { ...box(), by: actor.id });
        }
      }
      const held = gridOf(world);
      releaseGrid(world);
      const fresh = gridOf(world);
      expect(held.cells).toEqual(fresh.cells);
      expect(held.tally).toEqual(tallyOf(fresh));
      for (let tile = 0; tile < atlas.open.length; tile++)
        expect(marksOn(held, tile)).toEqual(marksOn(fresh, tile));
    } finally {
      releaseGrid(world);
    }
  });
});

describe("the grid on the shipped world's four regions", () => {
  it("looks for the nearest enemy and counts friends in the asker's region only, as a pass does", () => {
    const atlas = shippedWorld();
    const beasts = shippedMonsters(atlas);
    const world = createWorld(
      atlas,
      5,
      { ...shippedPrograms(atlas), ...beasts.programs },
      beasts.kinds,
      beasts.spawns,
    );
    step(
      world,
      spawnsNearCamp(
        world,
        Array.from({ length: 40 }, (_, i) => ({ name: `R${i}`, program: "wanderer" })),
      ),
    );
    let asked = 0;
    for (let t = 0; t < 4000; t++) {
      step(world);
      if (t % 100 !== 0) continue;
      const grid = gridOf(world);
      for (const who of world.actors) {
        const region = regionAt(atlas, who.x, who.y);
        const area = atlas.regions[region] as Region;
        const enemy = (a: Actor): boolean =>
          enemies(who, a) && regionAt(atlas, a.x, a.y) === region;
        let expected: Actor | undefined;
        for (const a of world.actors)
          if (enemy(a) && (!expected || steps(a, who.x, who.y) < steps(expected, who.x, who.y)))
            expected = a;
        const none = inRegion(grid, region, who.kind === "adventurer") === 0;
        expect(none ? undefined : nearest(grid, who.x, who.y, area, enemy)).toBe(expected);
        const friend = (a: Actor): boolean =>
          a !== who && a.kind === who.kind && regionAt(atlas, a.x, a.y) === region;
        const within = world.actors.filter((a) => friend(a) && steps(a, who.x, who.y) <= 10);
        expect(countWithin(grid, who.x, who.y, 10, area, friend)).toBe(within.length);
        asked++;
      }
    }
    // Monsters came out in more than one region, so the regions were really tried.
    expect(asked).toBeGreaterThan(1000);
  });
});

describe("what may change where actors stand and walk", () => {
  // A held grid is kept in step only by the changes grid.ts makes, so no other
  // simulation file may move an actor, change its walk or add a mark.
  // adopt.ts edits snapshot records before there is a world to hold a grid for.
  const dir = new URL(".", import.meta.url);
  const sources = readdirSync(dir).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.endsWith(".test.ts") &&
      !["testing.ts", "grid.ts", "adopt.ts"].includes(f),
  );
  const FORBIDDEN = [
    /\.(x|y)\s*=(?!=)/,
    /\.path\s*=(?!=)/,
    /\.path\.(shift|push|pop|splice|unshift|reverse|sort|fill|copyWithin)\(/,
    /\.path\.length\s*=(?!=)/,
    /\.path\[[^\]]*\]\s*=(?!=)/,
    /marks\.(push|unshift|splice)\(/,
  ];

  it("finds the simulation sources", () => {
    expect(sources).toContain("world.ts");
    expect(sources).toContain("brain.ts");
  });

  for (const file of sources) {
    it(`${file} leaves positions, walks and marks to grid.ts`, () => {
      const code = readFileSync(new URL(file, dir), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const pattern of FORBIDDEN)
        expect(code.match(pattern)?.[0], `${file}: ${pattern}`).toBeUndefined();
    });
  }

  it("the check itself catches each kind of change", () => {
    const bad = [
      "actor.x = 3;",
      "actor.path = [];",
      "actor.path.shift();",
      "a.path.length = 0;",
      "a.path[0] = p;",
      "world.marks.push(m);",
    ];
    for (const line of bad)
      expect(
        FORBIDDEN.some((p) => p.test(line)),
        line,
      ).toBe(true);
    expect(FORBIDDEN.some((p) => p.test("if (actor.x === 3 && a.path.length == 0) {}"))).toBe(
      false,
    );
  });
});

/** The way to `to` as wayTo found it before the search was made lazy and kept in typed arrays. */
function oldWayTo(world: World, actor: Actor, to: Point): Point[] {
  const { atlas } = world;
  if (!walkable(atlas, to.x, to.y)) return [];
  const start = tileAt(atlas, actor.x, actor.y);
  const target = tileAt(atlas, to.x, to.y);
  const barred = new Set<number>();
  const standing = new Set<number>();
  for (const other of world.actors) {
    if (other === actor) continue;
    standing.add(tileAt(atlas, other.x, other.y));
    const end = other.path[other.path.length - 1];
    if (end) standing.add(tileAt(atlas, end.x, end.y));
    if (blocks(other, actor)) barred.add(tileAt(atlas, other.x, other.y));
  }
  const sharing = world.actors.some(
    (other) =>
      other !== actor &&
      other.x === actor.x &&
      other.y === actor.y &&
      other.path.length === 0 &&
      other.moveTicksLeft === 0,
  );
  const free = (index: number): boolean => (index === start ? !sharing : !standing.has(index));
  const cameFrom = new Map<number, number>([[start, start]]);
  const queue: Point[] = [{ x: actor.x, y: actor.y }];
  for (let head = 0; head < queue.length && !(cameFrom.has(target) && free(target)); head++) {
    const at = queue[head] as Point;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!canStep(world, actor, at.x, at.y, x, y)) continue;
      const index = tileAt(atlas, x, y);
      if (cameFrom.has(index) || barred.has(index)) continue;
      cameFrom.set(index, tileAt(atlas, at.x, at.y));
      queue.push({ x, y });
    }
  }
  let goal: number | undefined;
  const seen = new Set<number>([tileAt(atlas, to.x, to.y)]);
  let ring: Point[] = [to];
  while (ring.length > 0 && goal === undefined) {
    for (const at of ring) {
      const index = tileAt(atlas, at.x, at.y);
      if (index === start && free(index)) {
        goal = index;
        break;
      }
      if (goal === undefined && cameFrom.has(index) && free(index)) goal = index;
    }
    if (goal !== undefined) break;
    const next: Point[] = [];
    for (const at of ring) {
      for (const [dx, dy] of NEIGHBOURS) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!linked(atlas, at.x, at.y, x, y) || seen.has(tileAt(atlas, x, y))) continue;
        seen.add(tileAt(atlas, x, y));
        next.push({ x, y });
      }
    }
    ring = next;
  }
  if (goal === undefined || goal === start) return [];
  const path: Point[] = [];
  for (let at = goal; at !== start; at = cameFrom.get(at) as number) path.push(pointOf(atlas, at));
  return path.reverse();
}

describe("walk_to's way", () => {
  it("is the way the search over every tile found, in a crowd, to free tiles and taken ones", () => {
    const world = busy();
    const rng = createRng(11);
    const { atlas } = world;
    for (let i = 0; i < 400; i++) {
      const actor = world.actors[nextInt(rng, world.actors.length)] as Actor;
      // Half the time somewhere at random, half the time someone's tile, as step_to(threat) does.
      const other = world.actors[nextInt(rng, world.actors.length)] as Actor;
      const to =
        i % 2 === 0
          ? { x: atlas.left + nextInt(rng, atlas.width), y: atlas.top + nextInt(rng, atlas.height) }
          : { x: other.x, y: other.y };
      expect(wayTo(world, actor, to)).toEqual(oldWayTo(world, actor, to));
    }
  });

  it("is the same when the tile asked for, or the one asking, is walled in by monsters", () => {
    const world = busy();
    const { atlas } = world;
    const monsters = world.actors.filter((a) => a.kind !== "adventurer");
    const wall = (at: Point): void => {
      for (const [dx, dy] of NEIGHBOURS) {
        const m = monsters.pop() as Actor;
        if (walkable(atlas, at.x + dx, at.y + dy)) [m.x, m.y] = [at.x + dx, at.y + dy];
      }
    };
    // A free tile with a monster on every side, and a resident in the same plight.
    const pocket = { x: 30, y: 10 };
    for (const a of world.actors) if (a.x === pocket.x && a.y === pocket.y) a.x = 31;
    wall(pocket);
    const shut = world.actors.find((a) => a.kind === "adventurer") as Actor;
    [shut.x, shut.y] = [80, 40];
    wall(shut);
    for (const actor of world.actors.slice(0, 60)) {
      for (const to of [pocket, { x: 31, y: 10 }, { x: shut.x, y: shut.y }, { x: 60, y: 32 }])
        expect(wayTo(world, actor, to)).toEqual(oldWayTo(world, actor, to));
    }
    for (const to of [pocket, { x: 60, y: 32 }, { x: 81, y: 40 }])
      expect(wayTo(world, shut, to)).toEqual(oldWayTo(world, shut, to));
  });
});
