import { describe, expect, it } from "vitest";
import { wayTo } from "./brain.ts";
import { placeConstants } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { firstLight, shippedPrograms, shippedWorld } from "./testing.ts";
import {
  createWorld,
  hashWorld,
  type Input,
  restore,
  snapshot,
  spawnsNearCamp,
  step,
} from "./world.ts";

const MAP = firstLight();
// The shipped world, whose camp region is MAP at the same coordinates, for the shipped programs.
const SHIPPED = shippedWorld();
// The full sweep runs in the capture workflow; the gate runs a few of its seeds.
const LONG = process.env.IDLIN_LONG === "1";
// Something that stands in the way and never moves.
const KINDS = { boulder: { hp: 100, damage: 0, windup: 1, recovery: 0, reach: 1 } };
const PROGRAMS = compileBots(
  {
    // Everyone to one tile, and stay there.
    gather: "otherwise -> walk_to(meadow); wait(50)",
    stay: "otherwise -> wait(100)",
    through: "when distance(27, 11) > 0 -> walk_to(27, 11)\notherwise -> wait(50)",
  },
  placeConstants(MAP),
);

describe("crowds", () => {
  it("twenty sent to one tile gather round it on twenty tiles, and none is left trying forever", () => {
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(
      world,
      spawnsNearCamp(
        world,
        Array.from({ length: 20 }, (_, i) => ({ name: `G${i}`, program: "gather" })),
      ),
    );
    const meadow = { x: 27, y: 6 };
    for (let i = 0; i < 1500; i++) step(world);
    const tiles = world.actors.map((a) => `${a.x},${a.y}`);
    expect(new Set(tiles).size).toBe(20);
    // Nobody is still trying to get through: over the next half minute no one is
    // held up behind someone else or walking.
    for (let i = 0; i < 300; i++) {
      step(world);
      for (const a of world.actors) {
        expect(a.blocked, `${a.name} is held up at tick ${world.tick}`).toBe(0);
        expect(a.path, `${a.name} is walking at tick ${world.tick}`).toEqual([]);
      }
    }
    expect(world.actors.some((a) => a.x === meadow.x && a.y === meadow.y)).toBe(true);
    // They are gathered, not strewn: most are within three steps of it.
    const close = world.actors.filter(
      (a) => Math.abs(a.x - meadow.x) + Math.abs(a.y - meadow.y) <= 3,
    );
    expect(close.length).toBeGreaterThanOrEqual(12);
    // And they are settled: nobody is still walking.
    expect(world.actors.every((a) => a.path.length === 0 && a.moveTicksLeft === 0)).toBe(true);
  });

  it("a walker goes round a monster standing in its way", () => {
    // Rock stands on the first step of the shortest way east; there is open grass round it.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    const inputs: Input[] = [
      { type: "spawn", name: "Walker", program: "through", x: 20, y: 13 },
      { type: "spawn", name: "Rock", program: "stay", x: 21, y: 13, kind: "boulder" },
    ];
    step(world, inputs);
    for (let i = 0; i < 400; i++) step(world);
    const walker = world.actors.find((a) => a.name === "Walker");
    expect([walker?.x, walker?.y]).toEqual([27, 11]);
  });

  it("a walk that a monster steps into goes round it once", () => {
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      { type: "spawn", name: "Walker", program: "stay", x: 18, y: 11 },
      { type: "spawn", name: "Rock", program: "stay", x: 19, y: 11, kind: "boulder" },
    ]);
    const [walker] = world.actors;
    if (!walker) throw new Error("no walker");
    // As if it had just decided to walk four tiles east, and a monster stepped into the way.
    walker.path = [19, 20, 21, 22].map((x) => ({ x, y: 11 }));
    walker.wait = 1000;
    for (let i = 0; i < 200; i++) step(world);
    expect([walker.x, walker.y]).toEqual([22, 11]);
  });

  it("a detour is only taken if it is at most two steps longer", () => {
    // Two boulders in the way: the way round is four steps longer, so the walk is given up.
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      { type: "spawn", name: "Walker", program: "stay", x: 18, y: 11 },
      { type: "spawn", name: "Rock", program: "stay", x: 19, y: 11, kind: "boulder" },
      { type: "spawn", name: "Stone", program: "stay", x: 19, y: 10, kind: "boulder" },
    ]);
    const [walker] = world.actors;
    if (!walker) throw new Error("no walker");
    walker.path = [
      { x: 19, y: 11 },
      { x: 20, y: 11 },
    ];
    walker.wait = 1000;
    for (let i = 0; i < 10; i++) step(world);
    expect(walker.path).toEqual([]);
    expect(walker.x).toBe(18);
  });

  it("a walk that has been re-routed can be saved and restored", () => {
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      { type: "spawn", name: "Walker", program: "stay", x: 18, y: 11 },
      { type: "spawn", name: "Rock", program: "stay", x: 19, y: 11, kind: "boulder" },
    ]);
    const [walker] = world.actors;
    if (!walker) throw new Error("no walker");
    walker.path = [19, 20, 21, 22].map((x) => ({ x, y: 11 }));
    walker.wait = 1000;
    for (let i = 0; i < 10; i++) step(world);
    expect(walker.blocked).toBeGreaterThanOrEqual(10);
    expect(restore(snapshot(world), MAP, PROGRAMS, KINDS)).toEqual(world);
  });

  it("of two stopped on one tile the one deciding moves off, but someone passing through moves nobody", () => {
    const world = createWorld(MAP, 1, PROGRAMS, KINDS);
    step(world, [
      { type: "spawn", name: "Ash", program: "stay", x: 18, y: 11 },
      { type: "spawn", name: "Birch", program: "stay", x: 20, y: 11 },
    ]);
    const [ash, birch] = world.actors;
    if (!ash || !birch) throw new Error("no actors");
    const home = { x: 20, y: 11 };
    // Ash walks over Birch's tile on its way somewhere else: Birch stays.
    Object.assign(ash, {
      x: 20,
      y: 11,
      fromX: 19,
      fromY: 11,
      moveTicksLeft: 3,
      path: [{ x: 21, y: 11 }],
    });
    expect(wayTo(world, birch, home)).toEqual([]);
    // Ash has stopped there too: whichever of them decides makes way, one step.
    Object.assign(ash, { fromX: 20, moveTicksLeft: 0, path: [] });
    expect(wayTo(world, birch, home)).toHaveLength(1);
    expect(wayTo(world, ash, home)).toHaveLength(1);
  });

  it("on the shipped programs nobody goes a minute without deciding, and the sleepers settle", () => {
    const names = ["wanderer", "homebody", "riverwalker"];
    for (const [residents, seeds] of [
      [6, LONG ? [1, 2, 3, 4, 5] : [1, 2]],
      [50, LONG ? [1, 2, 3] : [1]],
    ] as const) {
      for (const seed of seeds) {
        const world = createWorld(SHIPPED, seed, shippedPrograms());
        const last = new Map<number, number>();
        let longest = 0;
        let worst = "";
        const moves = new Map<number, number>();
        let sleepersAtMidnight: string[] = [];
        const trail = new Map<number, Set<string>>();
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
        for (let tick = 1; tick <= 24 * 600; tick++) {
          for (const e of events)
            if (e.type === "decide" || e.type === "fault") last.set(e.actor, tick);
          for (const a of world.actors) {
            const gap = tick - (last.get(a.id) ?? 0);
            if (gap > longest) {
              longest = gap;
              worst = `${a.name} at tick ${tick}`;
            }
          }
          const before = new Map(world.actors.map((a) => [a.id, `${a.x},${a.y}`]));
          events = step(world);
          // Sleepers who have stopped; someone still walking home may pass over another's tile.
          if (tick === 18 * 600)
            sleepersAtMidnight = world.actors
              .filter(
                (a) => a.program !== "wanderer" && a.path.length === 0 && a.moveTicksLeft === 0,
              )
              .map((a) => `${a.x},${a.y}`);
          // 23:00 to 24:00: count how often each camp sleeper steps back onto a tile it
          // left. Walking home late is fine; going back and forth is shuffling.
          if (tick > 17 * 600 && tick <= 18 * 600) {
            for (const a of world.actors) {
              if (a.program === "wanderer") continue;
              const here = `${a.x},${a.y}`;
              if (before.get(a.id) === here) continue;
              const been = trail.get(a.id) ?? new Set<string>();
              if (been.has(here)) moves.set(a.id, (moves.get(a.id) ?? 0) + 1);
              been.add(before.get(a.id) as string);
              trail.set(a.id, been);
            }
          }
        }
        expect(longest, `${residents} residents, seed ${seed}: ${worst}`).toBeLessThanOrEqual(600);
        const restless = [...moves.values()].filter((n) => n > 2).length;
        expect(restless, `${residents} residents, seed ${seed}: sleepers still walking`).toBe(0);
        expect(
          new Set(sleepersAtMidnight).size,
          `${residents} residents, seed ${seed}: sleepers sharing`,
        ).toBe(sleepersAtMidnight.length);
        expect(restore(snapshot(world), SHIPPED, shippedPrograms())).toEqual(world);
        expect(hashWorld(restore(snapshot(world), SHIPPED, shippedPrograms()))).toBe(
          hashWorld(world),
        );
      }
    }
  }, 60_000);
});
