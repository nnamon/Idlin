import { describe, expect, it } from "vitest";
import { tileAt, walkable } from "./atlas.ts";
import { wayTo } from "./brain.ts";
import { fieldTo, KEEP_TICKS, nthTile, partOf, stepsTo, workOf } from "./field.ts";
import { parseMap, type TileMap } from "./map.ts";
import { createRng, nextInt } from "./rng.ts";
import { compileBots } from "./tactics.ts";
import { bigMap, putMonster, shippedMonsters, shippedPrograms, shippedWorld } from "./testing.ts";
import {
  type Actor,
  createWorld,
  hashWorld,
  type Input,
  type Programs,
  restore,
  snapshot,
  spawnsNearCamp,
  step,
  type World,
} from "./world.ts";

/**
 * A comb: a corridor along row 10 with dead-end teeth going north and south
 * from it every third column. Every way between two tiles is the only one.
 */
function comb(): TileMap {
  const width = 30;
  const height = 21;
  const teeth = new Set([2, 5, 8, 11, 14, 17, 20, 23, 26]);
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const inside = x > 0 && y > 0 && x < width - 1 && y < height - 1;
      if (x === 1 && y === 10) row += "c";
      else if (inside && (y === 10 || teeth.has(x))) row += ".";
      else row += "#";
    }
    rows.push(row);
  }
  return parseMap({
    name: "comb",
    width,
    height,
    legend: { ".": "grass", "#": "rock", c: "camp" },
    rows,
    places: { camp: { x: 1, y: 10 } },
  });
}

const COMB_PROGRAMS = compileBots({
  // Half an hour to the far north-east tooth's end, half an hour to the
  // south-west one's: five of them share each end, so they gather along it.
  pace: "when (hour * 60 + minute) mod 60 < 30 -> walk_to(26, 1)\notherwise -> walk_to(2, 19)",
  // One step at a time, between the ends of the middle teeth.
  stepper: "when (hour * 60 + minute) mod 40 < 20 -> step_to(14, 1)\notherwise -> step_to(14, 19)",
});

describe("ways where there is only one", () => {
  it("come out as they did before the ways were shared", () => {
    const world = createWorld(comb(), 1, COMB_PROGRAMS);
    const inputs: Input[] = [];
    for (let i = 0; i < 5; i++)
      inputs.push({ type: "spawn", name: `P${i}`, program: "pace", x: 2 + 3 * i, y: 10 });
    for (let i = 0; i < 2; i++)
      inputs.push({ type: "spawn", name: `S${i}`, program: "stepper", x: 20 + 3 * i, y: 10 });
    step(world, inputs);
    const been = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      step(world);
      for (const a of world.actors) been.add(`${a.x},${a.y}`);
    }
    // They went the length of the comb, not stood about.
    expect(been.has("26,1") && been.has("2,19") && been.has("14,1")).toBe(true);
    // Taken on main before the ways were shared.
    expect(hashWorld(world)).toBe("ad90ea6b0d31a58e");
  });
});

/** The big map with residents standing still on the given tiles. */
function standing(tiles: readonly [number, number][]) {
  const world = createWorld(bigMap(), 1, compileBots({ still: "otherwise -> wait(100)" }));
  step(
    world,
    tiles.map(([x, y], i) => ({ type: "spawn", name: `R${i}`, program: "still", x, y })),
  );
  return world;
}

describe("distance fields", () => {
  it("count steps ring by ring from their target, going round rock and water", () => {
    const world = standing([]);
    const { atlas } = world;
    // The camp's fire is at (60, 30); the river runs along rows 55 to 57, with bridges at x 30, 60 and 90.
    const field = fieldTo(world, tileAt(atlas, 60, 40));
    expect(stepsTo(world, field, tileAt(atlas, 60, 41))).toBe(1);
    expect(stepsTo(world, field, tileAt(atlas, 60, 30))).toBe(-1);
    // Over the middle bridge and back: straight down column 60.
    expect(stepsTo(world, field, tileAt(atlas, 60, 60))).toBe(20);
    // South of the river at x 45 is reached by the bridge at x 30 or 60, 15 tiles off either way.
    expect(stepsTo(world, field, tileAt(atlas, 45, 60))).toBeGreaterThanOrEqual(15 + 20);
    // The tiles come out nearest first.
    let last = 0;
    for (let i = 0; nthTile(world, field, i) >= 0; i++) {
      const steps = field.steps[nthTile(world, field, i)] as number;
      expect(steps - last === 0 || steps - last === 1).toBe(true);
      last = steps;
    }
    expect(last).toBeGreaterThan(60);
  });

  it("are shared: twenty sent to one tile start one field between them", () => {
    const at: [number, number][] = Array.from({ length: 20 }, (_, i) => [10 + 4 * i, 12]);
    const world = standing(at);
    const work = workOf(world);
    const before = { ...work };
    for (const actor of world.actors) wayTo(world, actor, { x: 61, y: 66 });
    expect(work.fields - before.fields).toBe(1);
    // The field was grown once, as far as the farthest of them: fewer tiles than in the map.
    expect(work.fieldTiles - before.fieldTiles).toBeLessThan(120 * 80);
    // The first one asks for most of it, the others for little more.
    const again = { ...work };
    wayTo(world, world.actors[0] as Actor, { x: 61, y: 66 });
    expect(work.fieldTiles).toBe(again.fieldTiles);
    expect(work.fields).toBe(again.fields);
  });

  it("are kept while read, and dropped KEEP_TICKS ticks after the last read", () => {
    const world = standing([]);
    const goal = tileAt(world.atlas, 61, 66);
    const work = workOf(world);
    fieldTo(world, goal);
    expect(work.fields).toBe(1);
    for (let i = 0; i < KEEP_TICKS; i++) step(world);
    fieldTo(world, goal);
    expect(work.fields).toBe(1);
    for (let i = 0; i <= KEEP_TICKS; i++) step(world);
    // Another target in the meantime may take the dropped one's arrays.
    fieldTo(world, tileAt(world.atlas, 20, 20));
    const field = fieldTo(world, goal);
    expect(work.fields).toBe(3);
    // A field made from spare arrays starts clean.
    expect(field.reached).toBe(1);
    expect(stepsTo(world, field, tileAt(world.atlas, 61, 67))).toBe(1);
    expect(stepsTo(world, field, tileAt(world.atlas, 20, 20))).toBe(46 + 41);
  });

  it("change how much is worked out, never what: a world resumed with no fields ends the same", () => {
    // The shipped world, its regions joined by exits, with residents and the monsters' spawns.
    const atlas = shippedWorld();
    const beasts = shippedMonsters(atlas);
    const programs = { ...shippedPrograms(atlas), ...beasts.programs };
    const world = createWorld(atlas, 5, programs, beasts.kinds, beasts.spawns);
    const bots = ["homebody", "riverwalker", "wanderer"];
    step(
      world,
      spawnsNearCamp(
        world,
        Array.from({ length: 30 }, (_, i) => ({ name: `R${i}`, program: bots[i % 3] as string })),
      ),
    );
    for (let i = 0; i < 2000; i++) step(world);
    // Monsters come and go: between 3 and 12 of them in this run's first 4,000 ticks.
    expect(world.actors.filter((a) => a.kind !== "adventurer").length).toBeGreaterThan(3);
    const resumed = restore(snapshot(world), atlas, programs, beasts.kinds, beasts.spawns);
    const warm = workOf(world).fields;
    for (let i = 0; i < 2000; i++) {
      step(world);
      step(resumed);
    }
    expect(hashWorld(resumed)).toBe(hashWorld(world));
    // The resumed world had to start again the fields the other had kept.
    expect(workOf(resumed).fields).toBeGreaterThan(workOf(world).fields - warm);
  });
});

describe("pieces of ground", () => {
  it("join the tiles one can walk between, and nothing else", () => {
    const world = standing([]);
    const { atlas } = world;
    const camp = partOf(atlas, tileAt(atlas, 60, 40), false);
    expect(camp).toBeGreaterThanOrEqual(0);
    expect(partOf(atlas, tileAt(atlas, 60, 70), false)).toBe(camp);
    expect(partOf(atlas, tileAt(atlas, 60, 70), true)).toBe(
      partOf(atlas, tileAt(atlas, 60, 40), true),
    );
    // Rock and water are in no piece.
    expect(partOf(atlas, tileAt(atlas, 0, 0), false)).toBe(-1);
    expect(partOf(atlas, tileAt(atlas, 59, 56), false)).toBe(-1);
  });
});

/** The tiles round (60, 40) that eleven goblins guard, open only to the north. */
const GUARDS: readonly [number, number][] = [
  [59, 39],
  [61, 39],
  [59, 40],
  [61, 40],
  [59, 41],
  [60, 41],
  [61, 41],
  [58, 38],
  [62, 38],
  [58, 39],
  [62, 39],
];

/**
 * 150 residents sent to (60, 40) by `call`, with the guards standing still
 * round it. Each one that gets there is taken out of the world, as at a ramp.
 * The tick by which the last one got there, or -1 if some never did.
 */
function boarding(call: "walk_to" | "step_to", ticks: number): number {
  const world = boardingWorld(boarders(call));
  for (let tick = 1; tick <= ticks; tick++) {
    board(world);
    if (!world.actors.some((a) => a.kind === "adventurer")) return tick;
  }
  return -1;
}

const boarders = (call: "walk_to" | "step_to") =>
  compileBots({ boarder: `otherwise -> ${call}(60, 40)`, guard: "otherwise -> wait(100)" });

/** A tick of boarding: a step, then whoever is on (60, 40) leaves the world. */
function board(world: World): void {
  step(world);
  world.actors = world.actors.filter((a) => a.kind !== "adventurer" || a.x !== 60 || a.y !== 40);
}

/** The guards and the 150 residents for boarding, after the tick they are spawned in. */
function boardingWorld(programs: Programs): World {
  const map = bigMap();
  const world = createWorld(map, 1, programs, shippedMonsters(map).kinds);
  for (const [x, y] of GUARDS) putMonster(world, "goblin", { x, y }, "guard");
  const { atlas } = world;
  const rng = createRng(3);
  const taken = new Set(GUARDS.map(([x, y]) => tileAt(atlas, x, y)));
  taken.add(tileAt(atlas, 60, 40));
  const inputs: Input[] = [];
  while (inputs.length < 150) {
    const x = 1 + nextInt(rng, 118);
    const y = 1 + nextInt(rng, 53);
    if (!walkable(atlas, x, y) || taken.has(tileAt(atlas, x, y))) continue;
    taken.add(tileAt(atlas, x, y));
    inputs.push({ type: "spawn", name: `R${inputs.length}`, program: "boarder", x, y });
  }
  step(world, inputs);
  return world;
}

/**
 * Forty goblins on each side of the river sent over it to the other by plain
 * walk_to, with nothing in their programs for getting nowhere. The middle
 * bridge, one tile wide, is the nearest way for all of them, so the two
 * fronts meet on it. The tick by which all 80 had been on the far bank, or
 * -1 if some never were.
 */
function headOn(ticks: number): number {
  const world = headOnWorld();
  const crossed = new Set<Actor>();
  for (let tick = 1; tick <= ticks; tick++) {
    step(world);
    for (const a of world.actors) if (a.program === "south" ? a.y >= 58 : a.y <= 54) crossed.add(a);
    if (crossed.size === 80) return tick;
  }
  return -1;
}

const HEAD_ON = compileBots({
  south: "otherwise -> walk_to(60, 66)",
  north: "otherwise -> walk_to(60, 44)",
});

/** The forty goblins each side of the river for headOn, before the first tick. */
function headOnWorld() {
  const map = bigMap();
  const world = createWorld(map, 1, HEAD_ON, shippedMonsters(map).kinds);
  const { atlas } = world;
  const rng = createRng(4);
  const taken = new Set<number>();
  const put = (program: string, top: number, bottom: number): void => {
    for (let placed = 0; placed < 40; ) {
      const x = 50 + nextInt(rng, 21);
      const y = top + nextInt(rng, bottom - top + 1);
      if (!walkable(atlas, x, y) || taken.has(tileAt(atlas, x, y))) continue;
      taken.add(tileAt(atlas, x, y));
      putMonster(world, "goblin", { x, y }, program);
      placed++;
    }
  };
  put("south", 46, 53);
  put("north", 59, 66);
  return world;
}

// Each bound is about one and a half times what the run takes. When a way
// round was never longer than DETOUR_STEPS more than the way through, a
// resident or two waited at the guards' edge for good, and no goblin got over
// the bridge in 20,000 ticks.
describe("a walker held up by people who stand still", () => {
  it("goes round them with walk_to: 150 residents all reach a guarded tile in 12,000 ticks", () => {
    // 8,478 ticks.
    expect(boarding("walk_to", 12_000)).toBeGreaterThan(0);
  });

  it("goes round them with step_to, a step or a few at a time, in 1,500 ticks", () => {
    // 1,044 ticks. When a step_to round them took one step, the next step_to
    // took it back to the guards' edge, and one never got there.
    expect(boarding("step_to", 1_500)).toBeGreaterThan(0);
  });

  it("goes round them when two crowds meet head on at a one-wide bridge: all 80 across in 3,000 ticks", () => {
    // 1,869 ticks.
    expect(headOn(3_000)).toBeGreaterThan(0);
  });

  it("goes the same way in a world resumed while it was held up", () => {
    // Whether an actor goes the long way round comes from `stalled`, which
    // snapshots keep. Resumed from ticks when residents had stalled at the
    // guards, each world ends as the one that ran on.
    for (const call of ["walk_to", "step_to"] as const) {
      const programs = boarders(call);
      const world = boardingWorld(programs);
      const kinds = shippedMonsters(bigMap()).kinds;
      const saved: string[] = [];
      let held = 0;
      for (let tick = 1; tick <= 600; tick++) {
        board(world);
        if (tick % 100 === 0) {
          saved.push(snapshot(world));
          held += world.actors.filter((a) => a.stalled > 0).length;
        }
      }
      expect(held, call).toBeGreaterThan(0);
      for (let tick = 601; tick <= 900; tick++) board(world);
      for (const [i, text] of saved.entries()) {
        const resumed = restore(text, world.atlas, programs, kinds);
        for (let tick = 100 * (i + 1); tick < 900; tick++) board(resumed);
        expect(hashWorld(resumed), `${call} resumed at tick ${100 * (i + 1)}`).toBe(
          hashWorld(world),
        );
      }
    }
  });
});
