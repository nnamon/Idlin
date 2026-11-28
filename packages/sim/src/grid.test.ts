import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Atlas, linked, pointOf, tileAt, walkable } from "./atlas.ts";
import { DETOUR_STEPS, wayTo } from "./brain.ts";
import {
  addMark,
  allAt,
  countWithin,
  dropMarks,
  firstAt,
  gridOf,
  holdGrid,
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
import { crowd } from "./testing.ts";
import { type Actor, blocks, canStep, enemies, step, type World } from "./world.ts";

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

  const all = atlas;

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
        } else {
          dropMarks(world, actor.id);
          // Listed again here, so the marks added after are kept in step too.
          marksOn(gridOf(world), 0);
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

/**
 * What wayTo should give, worked out with plain searches over every tile. The
 * way past people is found with no limit on its length; only an actor that
 * may not go the long way round is held to DETOUR_STEPS.
 */
interface Expected {
  /** The tile it should lead to: the free tile nearest `to` that the actor could walk to with nobody about. */
  readonly goal: number;
  /** The steps of the shortest way there past people, however long, or -1 if people shut it off. */
  readonly length: number;
  /** The longest way past people it may take without `round`: DETOUR_STEPS more than going by `to`. */
  readonly most: number;
  /** Past that, the tiles a way at most `most` long may end on instead, and the steps to each. */
  readonly ends: () => ReadonlyMap<number, number>;
  /** Steps from a tile to `to` with nobody about, and from the goal. */
  readonly field: (tile: number) => number;
  readonly rung: number;
}

/** Breadth-first steps from `from` over `next`, for every tile it gets to, in the order it gets to them. */
function stepsFrom(atlas: Atlas, from: number, next: (a: Point, b: Point) => boolean) {
  const steps = new Map<number, number>([[from, 0]]);
  const order = [from];
  for (let head = 0; head < order.length; head++) {
    const at = order[head] as number;
    const p = pointOf(atlas, at);
    for (const [dx, dy] of NEIGHBOURS) {
      const q = { x: p.x + dx, y: p.y + dy };
      const tile = tileAt(atlas, q.x, q.y);
      if (tile < 0 || steps.has(tile) || !next(p, q)) continue;
      steps.set(tile, (steps.get(at) as number) + 1);
      order.push(tile);
    }
  }
  return { steps, order };
}

function expected(world: World, actor: Actor, to: Point): Expected | null {
  const { atlas } = world;
  if (!walkable(atlas, to.x, to.y)) return null;
  const start = tileAt(atlas, actor.x, actor.y);
  const barred = new Set<number>();
  const taken = new Set<number>();
  for (const other of world.actors) {
    if (other === actor) continue;
    taken.add(tileAt(atlas, other.x, other.y));
    const end = other.path[other.path.length - 1];
    if (end) taken.add(tileAt(atlas, end.x, end.y));
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
  const free = (tile: number): boolean => (tile === start ? !sharing : !taken.has(tile));
  const step = (a: Point, b: Point): boolean => canStep(world, actor, a.x, a.y, b.x, b.y);
  const field = stepsFrom(atlas, tileAt(atlas, to.x, to.y), (a, b) =>
    linked(atlas, a.x, a.y, b.x, b.y),
  );
  const open = stepsFrom(atlas, start, step).steps;
  const away = field.steps.get(start);
  if (away === undefined) return null;
  let goal = -1;
  for (let i = 0, ring = -1; i < field.order.length && goal < 0; i++) {
    const tile = field.order[i] as number;
    const steps = field.steps.get(tile) as number;
    if (steps !== ring) {
      ring = steps;
      if (ring === away && free(start)) goal = start;
    }
    if (goal < 0 && free(tile) && open.has(tile)) goal = tile;
  }
  if (goal < 0 || goal === start) return null;
  const rung = field.steps.get(goal) as number;
  const most = away + rung + DETOUR_STEPS;
  const round = stepsFrom(
    atlas,
    start,
    (a, b) => step(a, b) && !barred.has(tileAt(atlas, b.x, b.y)),
  ).steps;
  // Every tile a way at most `most` long could pass through, and those of them that look nearest the goal.
  const ends = (): ReadonlyMap<number, number> => {
    const g = pointOf(atlas, goal);
    const guess = (tile: number): number => {
      const p = pointOf(atlas, tile);
      const line = Math.abs(p.x - g.x) + Math.abs(p.y - g.y);
      return Math.max(line, Math.abs((field.steps.get(tile) as number) - rung));
    };
    const within = [...round].filter(([tile, steps]) => steps + guess(tile) <= most);
    const nearest = Math.min(...within.map(([tile]) => guess(tile)));
    return new Map(within.filter(([tile]) => guess(tile) === nearest));
  };
  const steps = (tile: number): number => field.steps.get(tile) as number;
  return { goal, length: round.get(goal) ?? -1, most, ends, field: steps, rung };
}

type Outcome = "goal" | "long" | "near" | "none";

/**
 * Checks the way wayTo gives `actor` for `to`, with `round` or not, against
 * `want`: the goal by the shortest way past people if it may go the long way
 * round ("long" when that is more than DETOUR_STEPS too long) or if the way
 * is short enough ("goal"); otherwise as near as a short enough way gets
 * ("near"); and nowhere when there is nowhere to go ("none"). With `step`, the
 * way's first step, or on a way round more than DETOUR_STEPS too long, its
 * steps up to the first tile from which the rest is not. Gives the outcome
 * and how many steps `step` gave.
 */
function check(
  world: World,
  actor: Actor,
  to: Point,
  want: Expected | null,
  round: boolean,
): [Outcome, number] {
  const { atlas } = world;
  const way = wayTo(world, actor, to, round);
  const where = `${actor.kind} at ${actor.x},${actor.y} to ${to.x},${to.y}, round ${round}`;
  // Each step is one this actor can take, onto nobody who is in its way.
  let at: Point = actor;
  for (const next of way) {
    expect(canStep(world, actor, at.x, at.y, next.x, next.y), where).toBe(true);
    expect(
      world.actors.some((o) => o !== actor && o.x === next.x && o.y === next.y && blocks(o, actor)),
      where,
    ).toBe(false);
    at = next;
  }
  const end = tileAt(atlas, at.x, at.y);
  let outcome: Outcome;
  if (!want) {
    expect(way, where).toEqual([]);
    outcome = "none";
  } else if (want.length >= 0 && (round || want.length <= want.most)) {
    expect([end, way.length], where).toEqual([want.goal, want.length]);
    outcome = want.length > want.most ? "long" : "goal";
  } else {
    expect(want.ends().get(end), where).toBe(way.length);
    outcome = "near";
  }
  let steps = way.length === 0 ? 0 : 1;
  while (want && steps < way.length) {
    const p = way[steps - 1] as Point;
    if (way.length - steps <= want.field(tileAt(atlas, p.x, p.y)) + want.rung + DETOUR_STEPS) break;
    steps++;
  }
  expect(wayTo(world, actor, to, round, true), `${where}, step`).toEqual(way.slice(0, steps));
  return [outcome, steps];
}

describe("walk_to's way", () => {
  it("is the one plain searches over every tile say, in a crowd, to free tiles and taken ones", () => {
    const world = busy();
    const rng = createRng(11);
    const { atlas } = world;
    const seen = new Map<string, number>();
    let longer = 0;
    for (let i = 0; i < 400; i++) {
      const actor = world.actors[nextInt(rng, world.actors.length)] as Actor;
      // Half the time somewhere at random, half the time someone's tile, as step_to(threat) does.
      const other = world.actors[nextInt(rng, world.actors.length)] as Actor;
      const to =
        i % 2 === 0
          ? { x: atlas.left + nextInt(rng, atlas.width), y: atlas.top + nextInt(rng, atlas.height) }
          : { x: other.x, y: other.y };
      const want = expected(world, actor, to);
      for (const round of [false, true]) {
        const [outcome, steps] = check(world, actor, to, want, round);
        const key = `${round} ${outcome}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
        if (steps > 1) longer++;
      }
    }
    const count = (key: string): number => seen.get(key) ?? 0;
    // Each kind of answer came up: the goal reached, held up short of it, and nowhere to go.
    expect(count("false goal")).toBeGreaterThan(100);
    expect(count("false near")).toBeGreaterThan(10);
    expect(count("false none")).toBeGreaterThan(10);
    // Allowed the long way round, some went more than DETOUR_STEPS out of their way
    // (9 of the 400 since a blow pushes bodies in a row from the far end, which
    // changes where the crowd stands), and some were held up where people shut
    // the goal off (4 of them since the camp's wolves roam by `wander` instead
    // of their day round, which spreads the crowd differently).
    expect(count("true long")).toBeGreaterThan(5);
    expect(count("true near")).toBeGreaterThan(2);
    // On some of those long ways (8), step_to takes more than one step.
    expect(longer).toBeGreaterThan(5);
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
      for (const to of [pocket, { x: 31, y: 10 }, { x: shut.x, y: shut.y }, { x: 60, y: 32 }]) {
        const want = expected(world, actor, to);
        for (const round of [false, true]) check(world, actor, to, want, round);
      }
    }
    // Walled in, the resident goes nowhere, however it may go.
    for (const to of [pocket, { x: 60, y: 32 }, { x: 81, y: 40 }]) {
      const want = expected(world, shut, to);
      for (const round of [false, true]) {
        check(world, shut, to, want, round);
        expect(wayTo(world, shut, to, round)).toEqual([]);
      }
    }
  });
});
