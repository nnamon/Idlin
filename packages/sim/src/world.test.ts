import { describe, expect, it } from "vitest";
import { atlasOf, walkable } from "./atlas.ts";
import { compileBots } from "./tactics.ts";
import { shippedPrograms, shippedWorld } from "./testing.ts";
import {
  clock,
  createWorld,
  hashWorld,
  restore,
  SnapshotError,
  STEP_TICKS,
  snapshot,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
  type World,
} from "./world.ts";

const NAMES = ["Ash", "Birch", "Cedar", "Dara", "Elm", "Fen"];
const PROGRAMS = shippedPrograms(shippedWorld());
const KINDS = { wolf: { hp: 10, damage: 1, windup: 5, recovery: 5, reach: 1 } };
// For walking tests with a monster in them: the shipped programs fight when an
// enemy is near, so here everyone runs one that only stands.
const STILL = compileBots({ still: 'otherwise as "stand" -> wait(100)' });

const newWorld = (seed: number): World => {
  const world = createWorld(shippedWorld(), seed, PROGRAMS);
  step(
    world,
    spawnsNearCamp(
      world,
      NAMES.map((name) => ({ name, program: "wanderer" })),
    ),
  );
  return world;
};

const run = (world: World, ticks: number): World => {
  for (let i = 0; i < ticks; i++) step(world);
  return world;
};

describe("world", () => {
  // The golden hash. It changes only when the simulation's behaviour or state
  // layout changes on purpose; say why in the commit that updates it.
  it("reaches the pinned state after 2000 ticks from a fixed seed", () => {
    expect(hashWorld(run(newWorld(1), 2000))).toBe("2e769653685f4a7e");
  });

  it("two worlds from one seed stay identical; another seed diverges", () => {
    const a = newWorld(7);
    const b = newWorld(7);
    const other = newWorld(8);
    for (let i = 0; i < 100; i++) {
      run(a, 100);
      run(b, 100);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
    expect(a.tick).toBe(10_001);
    expect(hashWorld(run(other, 10_000))).not.toBe(hashWorld(a));
  });

  it("a world restored from a snapshot continues exactly as the original", () => {
    const straight = run(newWorld(3), 1500);
    const saved = snapshot(run(newWorld(3), 700));
    const resumed = restore(saved, shippedWorld(), PROGRAMS);
    expect(hashWorld(run(resumed, 800))).toBe(hashWorld(straight));
  });

  it("refuses snapshots it cannot trust", () => {
    const map = shippedWorld();
    const saved = snapshot(run(newWorld(3), 50));
    const edit = (change: (data: Record<string, unknown>) => void): string => {
      const data = JSON.parse(saved);
      change(data);
      return JSON.stringify(data);
    };
    expect(() => restore("not json", map, PROGRAMS)).toThrow(SnapshotError);
    expect(() => restore("null", map, PROGRAMS)).toThrow(SnapshotError);
    expect(() =>
      restore(
        edit((d) => (d.version = 999)),
        map,
        PROGRAMS,
      ),
    ).toThrow(/version 999/);
    expect(() =>
      restore(
        edit((d) => (d.map = "0000000000000000")),
        map,
        PROGRAMS,
      ),
    ).toThrow(/different map/);
    expect(() =>
      restore(
        edit((d) => ((d.state as World).tick = 9999)),
        map,
        PROGRAMS,
      ),
    ).toThrow(/damaged/);
    expect(() =>
      restore(
        edit((d) => (d.state = { tick: 1 })),
        map,
        PROGRAMS,
      ),
    ).toThrow(/damaged/);
    expect(hashWorld(restore(saved, map, PROGRAMS))).toBe(JSON.parse(saved).hash);
    expect(() => restore('{"version":{"toString":null}}', map, PROGRAMS)).toThrow(SnapshotError);
    expect(() => restore("[]", map, PROGRAMS)).toThrow(SnapshotError);
  });

  it("refuses snapshots whose contents hash the same but are not a possible world", () => {
    const map = shippedWorld();
    const world = createWorld(map, 3, PROGRAMS);
    step(world, [{ type: "spawn", name: "Ash", x: 11, y: 8, program: "wanderer" }]);
    const ash = world.actors[0];
    if (!ash) throw new Error("no actor");
    ash.wait = 0;
    ash.path = [{ x: 12, y: 8 }];
    const saved = snapshot(world);
    expect(hashWorld(restore(saved, map, PROGRAMS))).toBe(hashWorld(world));
    type Saved = {
      state: {
        tick: unknown;
        nextActorId: unknown;
        rng: { a: unknown };
        actors: Record<string, unknown>[];
      };
    };
    // A hostile snapshot can carry a correct hash for an impossible world, so
    // each forgery is tried twice: with the saved hash, and with its own.
    const forged = (change: (data: Saved) => void, rehash: boolean): string => {
      const data = JSON.parse(saved) as Saved & { hash: string };
      change(data);
      if (rehash) {
        try {
          data.hash = hashWorld({
            ...(data.state as unknown as World),
            atlas: atlasOf(map),
            programs: PROGRAMS,
            kinds: {},
            spawns: [],
          });
        } catch {
          // Not even hashable; the saved hash stays.
        }
      }
      return JSON.stringify(data);
    };
    const actor = (data: Saved): Record<string, unknown> =>
      data.state.actors[0] as Record<string, unknown>;
    const forgeries: [string, (data: Saved) => void][] = [
      // The hash folds values to 32 bits, so each of these keeps the saved hash.
      [
        "a step 2^32 tiles away",
        (d) => (((actor(d).path as { x: number }[])[0] as { x: number }).x += 2 ** 32),
      ],
      ["a position stored as text", (d) => (actor(d).x = "11")],
      ["a tick stored as text", (d) => (d.state.tick = String(d.state.tick))],
      [
        "a generator word outside 32 bits",
        (d) => (d.state.rng.a = (d.state.rng.a as number) + 2 ** 32),
      ],
      // These change the hash too; they are refused for what they are.
      [
        "an actor inside the lantern",
        (d) => Object.assign(actor(d), { x: 15, y: 8, fromX: 15, fromY: 8 }),
      ],
      ["a path that jumps", (d) => (actor(d).path = [{ x: 14, y: 8 }])],
      ["a step longer than a step", (d) => (actor(d).moveTicksLeft = 99)],
      ["a standing actor that came from elsewhere", (d) => (actor(d).fromX = 12)],
      [
        "a monster on an adventurer's tile",
        (d) => {
          d.state.actors.push({ ...actor(d), id: 2, kind: "wolf" });
          d.state.nextActorId = 3;
        },
      ],
      ["a missing name", (d) => delete actor(d).name],
      ["a blocked count with no path", (d) => Object.assign(actor(d), { path: [], blocked: 3 })],
      ["two actors with one id", (d) => (actor(d).id = 2)],
      ["a next id that is already in use", (d) => (d.state.nextActorId = 1)],
      ["a negative tick", (d) => (d.state.tick = -1)],
      ["an actor that is not an object", (d) => d.state.actors.push(null as never)],
    ];
    for (const [what, change] of forgeries) {
      expect(() => restore(forged(change, false), map, PROGRAMS), what).toThrow(/damaged/);
      expect(() => restore(forged(change, true), map, PROGRAMS), `${what}, rehashed`).toThrow(
        /damaged/,
      );
    }
  });

  it("keeps every actor on a walkable tile, and moves them", () => {
    const world = newWorld(5);
    const start = world.actors.map((a) => `${a.x},${a.y}`);
    const visited = new Set<string>();
    for (let i = 0; i < 6000; i++) {
      step(world);
      for (const a of world.actors) {
        expect(walkable(world.atlas, a.x, a.y)).toBe(true);
        expect(Math.abs(a.x - a.fromX) + Math.abs(a.y - a.fromY)).toBeLessThanOrEqual(1);
        visited.add(`${a.x},${a.y}`);
      }
    }
    expect(world.actors.map((a) => `${a.x},${a.y}`)).not.toEqual(start);
    // Six wanderers over ten minutes should have covered a good part of the map.
    expect(visited.size).toBeGreaterThan(150);
  });

  it("takes exactly STEP_TICKS ticks per tile", () => {
    const world = createWorld(shippedWorld(), 1, PROGRAMS);
    step(world, [{ type: "spawn", name: "Ash", x: 11, y: 8, program: "wanderer" }]);
    const actor = world.actors[0];
    if (!actor) throw new Error("no actor");
    actor.wait = 1000;
    actor.path = [12, 13, 14].map((x) => ({ x, y: 8 }));
    const arrivals: number[] = [];
    for (let i = 0; i < 20; i++) {
      const before = actor.x;
      step(world);
      if (actor.x !== before) arrivals.push(world.tick);
    }
    expect(STEP_TICKS).toBe(6);
    expect(arrivals).toEqual([2, 8, 14]);
    expect(actor.moveTicksLeft).toBe(0);
    expect([actor.x, actor.fromX]).toEqual([14, 14]);
  });

  it("adventurers walk through each other", () => {
    const world = createWorld(shippedWorld(), 1, PROGRAMS);
    step(world, [
      { type: "spawn", name: "Ash", x: 11, y: 8, program: "wanderer" },
      { type: "spawn", name: "Birch", x: 12, y: 8, program: "wanderer" },
    ]);
    const [ash, birch] = world.actors;
    if (!ash || !birch) throw new Error("no actors");
    birch.wait = ash.wait = 1000;
    birch.path = [];
    ash.path = [
      { x: 12, y: 8 },
      { x: 13, y: 8 },
    ];
    run(world, 2);
    expect([ash.x, ash.y]).toEqual([birch.x, birch.y]);
    run(world, 6);
    expect([ash.x, ash.y]).toEqual([13, 8]);
  });

  it("an adventurer held up by a monster waits, then gives up its walk", () => {
    const world = createWorld(shippedWorld(), 1, STILL, KINDS);
    step(world, [
      { type: "spawn", name: "Ash", x: 11, y: 13, program: "still" },
      { type: "spawn", name: "Birch", x: 12, y: 13, program: "still", kind: "wolf" },
    ]);
    const [ash, birch] = world.actors;
    if (!ash || !birch) throw new Error("no actors");
    birch.wait = 1000;
    birch.path = [];
    ash.wait = 1000;
    ash.path = [{ x: 12, y: 13 }];
    run(world, 9);
    expect([ash.x, ash.path.length]).toEqual([11, 1]);
    run(world, 1);
    expect([ash.x, ash.path.length, ash.blocked]).toEqual([11, 0, 0]);
  });

  it("of two walkers head to head, only the later one turns aside", () => {
    const world = createWorld(shippedWorld(), 1, STILL, KINDS);
    step(world, [
      { type: "spawn", name: "Ash", x: 11, y: 11, program: "still" },
      { type: "spawn", name: "Birch", x: 12, y: 11, program: "still", kind: "wolf" },
    ]);
    const [ash, birch] = world.actors;
    if (!ash || !birch) throw new Error("no actors");
    ash.wait = birch.wait = 1000;
    ash.path = [
      { x: 12, y: 11 },
      { x: 13, y: 11 },
    ];
    birch.path = [
      { x: 11, y: 11 },
      { x: 10, y: 11 },
    ];
    run(world, 10);
    expect(ash.path.length).toBe(2);
    // Birch goes round Ash to where it was going, a couple of steps longer.
    expect(birch.path.some((p) => p.x === 11 && p.y === 11)).toBe(false);
    expect(birch.path[birch.path.length - 1]).toEqual({ x: 10, y: 11 });
    expect(birch.path.length).toBeLessThanOrEqual(4);
  });

  it("drops spawn inputs it cannot honour", () => {
    const world = createWorld(shippedWorld(), 1, PROGRAMS);
    step(world, [
      { type: "spawn", name: "Ash", x: 14, y: 9, program: "wanderer" },
      { type: "spawn", name: "OnAsh", x: 14, y: 9, program: "wanderer" },
      { type: "spawn", name: "InLantern", x: 15, y: 8, program: "wanderer" },
      { type: "spawn", name: "Outside", x: -3, y: 400, program: "wanderer" },
      { type: "spawn", name: "", x: 13, y: 9, program: "wanderer" },
      { type: "spawn", name: "x".repeat(17), x: 13, y: 9, program: "wanderer" },
      { type: "spawn", name: "Half", x: 13.5, y: 9, program: "wanderer" },
      null as never,
      "spawn" as never,
      {
        type: "spawn",
        name: "Trap",
        get x(): number {
          throw new Error("no");
        },
        y: 9,
        program: "wanderer",
      },
      { type: "move", name: "Mover", x: 12, y: 9 } as never,
      { type: "spawn", name: 7, x: 12, y: 9 } as never,
      { type: "spawn", name: "Texty", x: "12", y: 9, program: "wanderer" } as never,
      { type: "spawn", name: "Birch", x: 13, y: 9, program: "wanderer" },
    ]);
    expect(world.tick).toBe(1);
    expect(world.actors.map((a) => [a.id, a.name])).toEqual([
      [1, "Ash"],
      [2, "Birch"],
    ]);
  });

  it("runs, hashes and resumes past the 32-bit tick boundary", () => {
    const map = shippedWorld();
    const world = newWorld(4);
    world.tick = 2 ** 31 - 2;
    const before = hashWorld(world);
    run(world, 5);
    expect(world.tick).toBe(2 ** 31 + 3);
    expect(hashWorld(restore(snapshot(world), map, PROGRAMS))).toBe(hashWorld(world));
    const later = restore(snapshot(world), map, PROGRAMS);
    later.tick += 2 ** 32;
    expect(hashWorld(later)).not.toBe(hashWorld(world));
    expect(before).not.toBe(hashWorld(world));
  });

  it("stores a spawn at negative zero as zero, as a snapshot would", () => {
    const tiny = {
      name: "one",
      width: 1,
      height: 1,
      tiles: [0],
      places: [{ name: "camp", x: 0, y: 0 }],
    };
    const world = createWorld(tiny, 1, PROGRAMS);
    step(world, [{ type: "spawn", name: "Ash", x: -0, y: -0, program: "wanderer" }]);
    expect(Object.is(world.actors[0]?.x, 0)).toBe(true);
    expect(Object.is(world.actors[0]?.fromY, 0)).toBe(true);
  });

  it("starts at dawn and turns a day over every 24 minutes of ticks", () => {
    const world = createWorld(shippedWorld(), 1, PROGRAMS);
    expect(clock(world)).toEqual({ day: 0, hour: 6, minute: 0 });
    world.tick = 615;
    expect(clock(world)).toEqual({ day: 0, hour: 7, minute: 1 });
    world.tick = TICKS_PER_DAY - 6 * 600;
    expect(clock(world)).toEqual({ day: 1, hour: 0, minute: 0 });
    expect(TICKS_PER_DAY).toBe(24 * 60 * 10);
  });
});
