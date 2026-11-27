import { describe, expect, it } from "vitest";
import { atlasOf } from "./atlas.ts";
import { CONFUSED_TICKS } from "./brain.ts";
import { isWalkable, NEIGHBOURS, type Point, place, terrainAt } from "./map.ts";
import { loadMonsters } from "./monsters.ts";
import { createRng, nextInt } from "./rng.ts";
import { BotError, compileBots } from "./tactics.ts";
import {
  botSources,
  firstLight,
  monsterSources,
  monsterStats,
  shippedMonsters,
  shippedPrograms,
  shippedWorld,
} from "./testing.ts";
import { FAULTS } from "./vm.ts";
import {
  ADVENTURER,
  checkSpawns,
  createWorld,
  DAY_HOUR,
  GROUP_SPREAD,
  hashWorld,
  isNight,
  KindError,
  LEAVE_DISTANCE,
  MONSTER_CAP,
  NIGHT_HOUR,
  RESPAWN_TICKS,
  restore,
  SnapshotError,
  type Spawns,
  START_HOUR,
  snapshot,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
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
const PROGRAMS = { ...shippedPrograms(), ...MONSTERS.programs };

const run = (world: World, ticks: number): WorldEvent[] => {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...step(world));
  return log;
};
const steps = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** A list of three with nothing at index 1. */
const gap = <T>(value: T): T[] => Object.assign(new Array<T>(3), { 0: value, 2: value });
const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
/** A list holding `entries`, whose iterator yields `shown` instead. */
const lying = <T>(entries: T[], shown: readonly T[]): T[] =>
  Object.assign([...entries], {
    *[Symbol.iterator]() {
      yield* shown;
    },
  });

describe("monsters from content", () => {
  it("loads each monster's numbers, program and places from content/monsters", () => {
    expect(Object.keys(MONSTERS.kinds)).toEqual(["goblin", "wolf"]);
    for (const [kind, raw] of Object.entries(monsterStats())) {
      const stats = raw as Record<string, unknown>;
      expect(MONSTERS.kinds[kind]).toEqual({
        hp: stats.hp,
        damage: stats.damage,
        windup: stats.windup,
        recovery: stats.recovery,
        reach: stats.reach,
      });
      const spawn = MONSTERS.spawns.find((s) => s.kind === kind);
      expect(spawn).toMatchObject({ name: stats.name, program: stats.program, group: stats.group });
      expect(spawn?.day).toEqual(
        (stats.day as string[]).map((p) => ({ x: place(MAP, p).x, y: place(MAP, p).y })),
      );
      expect(spawn?.night).toEqual(
        (stats.night as string[]).map((p) => ({ x: place(MAP, p).x, y: place(MAP, p).y })),
      );
    }
    expect(Object.keys(MONSTERS.programs).sort()).toEqual(Object.keys(monsterSources()).sort());
    // Monster programs share the world's program table with the residents', so no name is used twice.
    for (const name of Object.keys(MONSTERS.programs))
      expect(botSources()).not.toHaveProperty(name);
    // Night brings each kind closer to camp than day does.
    const camp = place(MAP, "camp");
    const nearest = (tiles: readonly Point[]) => Math.min(...tiles.map((t) => steps(t, camp)));
    for (const spawn of MONSTERS.spawns) {
      expect(nearest(spawn.night)).toBeLessThan(nearest(spawn.day));
    }
    // The shipped content makes a world.
    expect(() => createWorld(WORLD, 1, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns)).not.toThrow();
  });

  it("refuses monster files that are wrong, with the file named", () => {
    const stats = monsterStats();
    const wolf = stats.wolf as Record<string, unknown>;
    const bad: Record<string, unknown>[] = [
      { wolf: { ...wolf, hp: 0 } },
      { wolf: { ...wolf, reach: 9 } },
      { wolf: { ...wolf, damage: "8" } },
      { wolf: { ...wolf, recovery: undefined } },
      { wolf: { ...wolf, program: "nobody" } },
      { wolf: { ...wolf, program: 3 } },
      { wolf: { ...wolf, day: ["nowhere"] } },
      { wolf: { ...wolf, day: ["toString"] } },
      { wolf: { ...wolf, day: "deep_wood" } },
      { wolf: { ...wolf, night: [null] } },
      { wolf: { ...wolf, group: 1.5 } },
      { wolf: { ...wolf, colour: "grey" } },
      { wolf: null },
      { wolf: [] },
      { wolf: "wolf" },
      { Wolf: wolf },
      JSON.parse(`{"__proto__": ${JSON.stringify(wolf)}}`),
      // Values that throw when made into text, and lists with holes.
      { wolf: { ...wolf, program: { toString: null } } },
      { wolf: { ...wolf, day: [{ toString: null }] } },
      { wolf: { ...wolf, night: [Symbol("x")] } },
      { wolf: { ...wolf, day: Array(1) } },
      { wolf: { ...wolf, night: gap("near_wood") } },
      // Fields from a prototype, and a list whose iterator hides what it holds.
      { wolf: Object.assign(Object.create({ hp: wolf.hp }), without(wolf, "hp")) },
      { wolf: Object.assign(Object.create(wolf), { name: wolf.name }) },
      { wolf: { ...wolf, day: lying(["nowhere"], ["deep_wood"]) } },
      {
        wolf: Object.defineProperty({ ...wolf }, "hp", {
          enumerable: true,
          get() {
            throw new Error("boom");
          },
        }),
      },
    ];
    for (const [i, files] of bad.entries()) {
      expect(() => loadMonsters(files, monsterSources(), MAP), `bad file ${i}`).toThrow(KindError);
    }
    expect(() => loadMonsters(stats, monsterSources(), MAP)).not.toThrow();
    expect(() => loadMonsters({ wolf: { ...wolf, hp: 0 } }, monsterSources(), MAP)).toThrow(/wolf/);
    // A program that does not compile fails with its file, like a resident's.
    expect(() =>
      loadMonsters(stats, { ...monsterSources(), wolf: "when -> nothing" }, MAP),
    ).toThrow(/wolf\.tac, line 1/);
    expect(() =>
      loadMonsters(stats, { ...monsterSources(), wolf: "\u0000".repeat(50) }, MAP),
    ).toThrow(BotError);
    // A name or group the world would not take is refused here too, with the file named.
    for (const change of [
      { name: "" },
      { name: "wolf" },
      { name: "A".repeat(20) },
      { name: 7 },
      { name: undefined },
      { group: 0 },
      { group: MONSTER_CAP + 1 },
    ]) {
      expect(
        () => loadMonsters({ wolf: { ...wolf, ...change } }, monsterSources(), MAP),
        JSON.stringify(change),
      ).toThrow(/^wolf\.json: (name|group) must be/);
    }
  });

  it("a monster whose program is broken stands confused, and the world keeps running", () => {
    // Shipped wolf numbers and places, with a program that divides by zero on every decision.
    const broken = loadMonsters(
      { wolf: monsterStats().wolf },
      { wolf: 'otherwise as "think" -> wait(1 / 0)' },
      MAP,
    );
    const programs = { ...shippedPrograms(), ...broken.programs };
    const world = createWorld(WORLD, 4, programs, broken.kinds, broken.spawns);
    step(world, spawnsNearCamp(world, [{ name: "Ash", program: "homebody" }]));
    const log = run(world, 3 * TICKS_PER_GAME_HOUR);
    const wolves = world.actors.filter((a) => a.kind === "wolf");
    // One wolf an hour, from the first tick on, until the region holds its three: ticks 1, 601 and 1201.
    expect(wolves).toHaveLength(MONSTER_CAP);
    for (const wolf of wolves) {
      expect(FAULTS[wolf.fault]).toBe("divide_by_zero");
      // A confused wolf does nothing: no decision, no step.
      expect(log.some((e) => e.type === "decide" && e.actor === wolf.id)).toBe(false);
      expect([wolf.x, wolf.y]).toEqual([wolf.fromX, wolf.fromY]);
      // It tries again after standing confused for a while, and fails the same way.
      const ticks = log.filter((e) => e.type === "fault" && e.actor === wolf.id).map((e) => e.tick);
      expect(ticks.length).toBeGreaterThan(wolf === wolves[0] ? 30 : 0);
      for (let i = 1; i < ticks.length; i++) {
        expect((ticks[i] as number) - (ticks[i - 1] as number)).toBe(CONFUSED_TICKS + 1);
      }
    }
    // The resident carries on, and the world still saves and loads.
    expect(log.filter((e) => e.type === "decide" && e.actor === 1).length).toBeGreaterThan(20);
    expect(restore(snapshot(world), WORLD, programs, broken.kinds, broken.spawns)).toEqual(world);
  });
});

/**
 * One wolf and one resident a few tiles apart in the open ground east of the
 * river, the wolf placed by the fight's own seed. Fought until one goes down,
 * or for two and a half minutes.
 */
function duel(program: string, fight: number): { winner: string; actions: string[] } {
  const rng = createRng(1000 + fight);
  const ash = { x: 26, y: 15 };
  let wolf = ash;
  while (!isWalkable(MAP, wolf.x, wolf.y) || steps(wolf, ash) < 2) {
    wolf = { x: ash.x + nextInt(rng, 9) - 4, y: ash.y + nextInt(rng, 9) - 4 };
  }
  const world = createWorld(WORLD, fight, PROGRAMS, MONSTERS.kinds);
  step(world, [
    { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", ...wolf },
    { type: "spawn", name: "Ash", program, ...ash },
  ]);
  const actions: string[] = [];
  for (let t = 0; t < 1500; t++) {
    for (const event of step(world)) {
      if (event.type === "decide" && event.actor === 2) actions.push(event.action);
      if (event.type === "down")
        return { winner: event.kind === ADVENTURER ? "wolf" : "ash", actions };
    }
  }
  return { winner: "nobody", actions };
}

describe("three ways to fight", () => {
  const record = (program: string) => {
    const tally = { ash: 0, wolf: 0, nobody: 0 } as Record<string, number>;
    const actions = new Set<string>();
    for (let fight = 0; fight < 100; fight++) {
      const result = duel(program, fight);
      tally[result.winner] = (tally[result.winner] as number) + 1;
      for (const action of result.actions) actions.add(action);
    }
    return { won: tally.ash as number, lost: tally.wolf as number, actions };
  };
  const standing = record("wanderer");
  const dodging = record("riverwalker");
  const keeping = record("homebody");

  it("over 100 fights against a wolf, the dodging program wins more often than the standing one", () => {
    expect(dodging.won).toBeGreaterThan(standing.won);
    expect(dodging.lost).toBeLessThan(standing.lost);
    // The one that keeps its distance loses least of all, which may be none, as
    // the dodger can. It is slow to win: many of its fights run out of time
    // while it waits for an opening.
    expect(keeping.lost).toBeLessThanOrEqual(dodging.lost);
    expect(keeping.won).toBeGreaterThan(keeping.lost);
    expect(keeping.won).toBeGreaterThan(0);
  });

  it("the three fight with different moves", () => {
    // Standing and trading never gets out of the way.
    expect(standing.actions.has("attack")).toBe(true);
    expect(standing.actions.has("step_clear")).toBe(false);
    expect(standing.actions.has("flee")).toBe(false);
    // Dodging steps out of blows but never backs off.
    expect(dodging.actions.has("step_clear")).toBe(true);
    expect(dodging.actions.has("flee")).toBe(false);
    // Keeping its distance backs away, and stands watching between strikes.
    expect(keeping.actions.has("flee")).toBe(true);
    expect(keeping.actions.has("wait")).toBe(true);
    expect(keeping.actions.has("attack")).toBe(true);
  });

  it("the one that keeps its distance does not watch a wolf across a wall for ever", () => {
    // A wall at (12, 1) between them, and a wolf that stands where it is (the
    // shipped wolf would give up and wander off); a homebody that only watched would too.
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [
      { type: "spawn", name: "Wolf", program: "post", kind: "wolf", x: 11, y: 1 },
      { type: "spawn", name: "Ash", program: "homebody", x: 13, y: 1 },
    ]);
    expect(isWalkable(MAP, 12, 1)).toBe(false);
    const log = run(world, 600);
    const [wolf, ash] = world.actors;
    const ashMoves = log.filter((e) => e.type === "decide" && e.actor === 2 && e.action === "flee");
    expect(ashMoves.length).toBeGreaterThan(0);
    expect([wolf?.x, wolf?.y]).toEqual([11, 1]);
    expect([ash?.x, ash?.y]).not.toEqual([13, 1]);
  });

  it("a wolf whose circling gets nowhere, across a wall from one that stands, goes elsewhere", () => {
    // Every tile the wolf would circle to is wall or off the map.
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [
      { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", x: 11, y: 1 },
      { type: "spawn", name: "Ash", program: "post", x: 13, y: 1 },
    ]);
    const log = run(world, 600);
    const program = world.programs.wolf as (typeof world.programs)[string];
    const rules = log.flatMap((e) =>
      e.type === "decide" && e.actor === 1 ? [program.rules[e.rule] as string] : [],
    );
    const wolf = world.actors.find((a) => a.id === 1);
    expect([wolf?.x, wolf?.y]).not.toEqual([11, 1]);
    expect(rules).toContain("press in");
  });
});

describe("spawning", () => {
  const world = (seed = 1, spawns = MONSTERS.spawns): World =>
    createWorld(WORLD, seed, PROGRAMS, MONSTERS.kinds, spawns);
  const monsters = (w: World) => w.actors.filter((a) => a.kind !== ADVENTURER);

  it("by day monsters come out near their day places, up to the cap, and stay away from camp", () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const w = world(seed);
      const seen = new Set<number>();
      let most = 0;
      for (let t = 0; t < 12 * TICKS_PER_GAME_HOUR; t++) {
        step(w);
        expect(isNight(w)).toBe(false);
        for (const actor of monsters(w)) {
          // With nobody to fight them they keep well away from camp.
          expect(steps(actor, place(MAP, "camp"))).toBeGreaterThan(4);
          if (seen.has(actor.id)) continue;
          seen.add(actor.id);
          kinds.add(actor.kind);
          if (seen.size === 1) expect(w.tick).toBe(1);
          const spawn = MONSTERS.spawns.find((s) => s.kind === actor.kind) as Spawns[number];
          expect(Math.min(...spawn.day.map((p) => steps(p, actor)))).toBeLessThanOrEqual(2);
        }
        most = Math.max(most, monsters(w).length);
      }
      // Nobody dies, so the cap is reached and nothing more arrives.
      expect(most).toBe(MONSTER_CAP);
      expect(seen.size).toBe(MONSTER_CAP);
    }
    expect([...kinds].sort()).toEqual(["goblin", "wolf"]);
  });

  it("night places are used at night, and one that dies is replaced an hour later", () => {
    const night = world(2);
    night.tick = (NIGHT_HOUR - START_HOUR) * TICKS_PER_GAME_HOUR;
    run(night, 1);
    expect(isNight(night)).toBe(true);
    const first = monsters(night);
    expect(first.length).toBeGreaterThan(0);
    for (const actor of first) {
      const spawn = MONSTERS.spawns.find((s) => s.kind === actor.kind) as Spawns[number];
      expect(Math.min(...spawn.night.map((p) => steps(p, actor)))).toBeLessThanOrEqual(2);
    }
    // Fill up, then take one out as a fatal blow would.
    while (monsters(night).length < MONSTER_CAP) step(night);
    run(night, 3 * RESPAWN_TICKS);
    expect(monsters(night)).toHaveLength(MONSTER_CAP);
    const gone = monsters(night)[0] as World["actors"][number];
    night.actors = night.actors.filter((a) => a !== gone);
    const lost = night.tick;
    let back = 0;
    for (let t = 0; t < 2 * RESPAWN_TICKS && back === 0; t++) {
      step(night);
      if (monsters(night).length === MONSTER_CAP) back = night.tick;
    }
    // The wait starts again on every tick the world is full, so it is a full hour from the loss.
    expect(back - lost).toBe(RESPAWN_TICKS);
  });

  it("a world without a spawn table has no monsters", () => {
    const w = createWorld(WORLD, 1, PROGRAMS, MONSTERS.kinds);
    step(w, spawnsNearCamp(w, [{ name: "Ash", program: "wanderer" }]));
    run(w, TICKS_PER_DAY);
    expect(w.actors.map((a) => a.name)).toEqual(["Ash"]);
  });

  it("the same seed gives the same day, and a snapshot taken mid-day resumes to the same state", () => {
    const cast = (w: World) =>
      spawnsNearCamp(
        w,
        ["Ash", "Birch", "Cedar"].map((name, i) => ({
          name,
          program: ["wanderer", "riverwalker", "homebody"][i] as string,
        })),
      );
    const a = world(9);
    const b = world(9);
    step(a, cast(a));
    step(b, cast(b));
    for (let i = 0; i < 24; i++) {
      run(a, TICKS_PER_GAME_HOUR);
      run(b, TICKS_PER_GAME_HOUR);
      expect(hashWorld(a)).toBe(hashWorld(b));
    }
    const other = world(10);
    step(other, cast(other));
    run(other, TICKS_PER_DAY);
    expect(hashWorld(other)).not.toBe(hashWorld(a));

    const straight = world(9);
    step(straight, cast(straight));
    run(straight, 5000);
    const saved = snapshot(straight);
    const resumed = restore(saved, WORLD, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns);
    expect(resumed).toEqual(straight);
    run(straight, 5000);
    run(resumed, 5000);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
    // Other spawns than it was taken with, or none, are refused.
    expect(() => restore(saved, WORLD, PROGRAMS, MONSTERS.kinds)).toThrow(/different spawns/);
    const moved = MONSTERS.spawns.map((s) => ({ ...s, group: s.group === 1 ? 2 : 1 }));
    expect(() => restore(saved, WORLD, PROGRAMS, MONSTERS.kinds, moved)).toThrow(SnapshotError);
    // A next arrival a world could not have set is refused, even with a hash worked out for it.
    for (const next of [-1, 1.5, "600", null, straight.tick + RESPAWN_TICKS + 1]) {
      const data = JSON.parse(saved);
      data.state.nextSpawn = next;
      try {
        data.hash = hashWorld({
          ...data.state,
          atlas: atlasOf(WORLD),
          programs: PROGRAMS,
          kinds: MONSTERS.kinds,
          spawns: MONSTERS.spawns,
        });
      } catch {
        // Not even hashable; the saved hash stays.
      }
      expect(() =>
        restore(JSON.stringify(data), WORLD, PROGRAMS, MONSTERS.kinds, MONSTERS.spawns),
      ).toThrow(SnapshotError);
    }
  });

  it("refuses spawn tables that are wrong, whatever is passed in", () => {
    const [good] = MONSTERS.spawns as [Spawns[number]];
    const check = (spawns: unknown) =>
      checkSpawns(spawns as Spawns, WORLD, PROGRAMS, MONSTERS.kinds);
    expect(() => check([good])).not.toThrow();
    const thrower = Object.defineProperty({ ...good }, "group", {
      enumerable: true,
      get() {
        throw new Error("boom");
      },
    });
    for (const bad of [
      null,
      "wolf",
      { length: 1, 0: good },
      [null],
      [7],
      [{ ...good, kind: "ghost" }],
      [{ ...good, kind: ADVENTURER }],
      [{ ...good, kind: "__proto__" }],
      [{ ...good, program: "nobody" }],
      [{ ...good, program: "constructor" }],
      [{ ...good, name: "x" }],
      [{ ...good, name: 5 }],
      [{ ...good, group: 0 }],
      [{ ...good, group: MONSTER_CAP + 1 }],
      [{ ...good, group: Number.NaN }],
      [{ ...good, day: [{ x: 0, y: 0 }] }],
      [{ ...good, day: [{ x: -1, y: 5 }] }],
      [{ ...good, day: [{ x: 4.5, y: 6 }] }],
      [{ ...good, day: [{ x: "4", y: 6 }] }],
      [{ ...good, day: [null] }],
      [{ ...good, night: "near_wood" }],
      [{ ...good, night: Array(17).fill({ x: 4, y: 6 }) }],
      Array(65).fill(good),
      [thrower],
      // Holes, which a loop over the list would skip and a spawn would then pick.
      [{ ...good, day: Array(1) }],
      [{ ...good, night: gap({ x: 4, y: 6 }) }],
      Array(1),
      gap(good),
      // Values that are not plain data.
      [Object.assign(Object.create({ group: 1 }), { ...good })],
      [{ ...good, day: [Object.assign(Object.create({ x: 4 }), { y: 6 })] }],
      [{ ...good, day: [[4, 6]] }],
      [{ ...good, kind: { toString: null } }],
      [{ ...good, program: { toString: null } }],
      // The camp's ground, which monsters keep off.
      [{ ...good, day: [{ x: 14, y: 9 }] }],
      // A list whose own entries are wrong, with an iterator that hands out good ones.
      [{ ...good, day: lying([{ x: 14, y: 9 }], good.day) }],
      lying([null], [good]),
    ]) {
      expect(() => check(bad)).toThrow(KindError);
      expect(() => createWorld(WORLD, 1, PROGRAMS, MONSTERS.kinds, bad as Spawns)).toThrow(
        KindError,
      );
    }
    // Only a spawn's own fields are read, even ones every object inherits.
    const noGroup = Object.fromEntries(Object.entries(good).filter(([k]) => k !== "group"));
    const proto = Object.prototype as Record<string, unknown>;
    proto.group = 1;
    try {
      expect(() => check([noGroup])).toThrow(KindError);
    } finally {
      delete proto.group;
    }
    // Restoring checks the table it is given the same way.
    const saved = snapshot(world());
    const holed = [{ ...good, day: Array(1) }] as unknown as Spawns;
    expect(() => restore(saved, WORLD, PROGRAMS, MONSTERS.kinds, holed)).toThrow(KindError);
    // What a world keeps cannot be changed afterwards.
    const kept = world().spawns;
    expect(Object.isFrozen(kept) && Object.isFrozen(kept[0]) && Object.isFrozen(kept[0]?.day)).toBe(
      true,
    );
  });
});

// Residents for the tests below: one that strikes once and then stands, and one
// that only stands.
const EXTRA = compileBots({
  once: `when struck == 0 and threat_distance <= 1 as "hit it" -> set struck = 1; attack(threat_x, threat_y)
otherwise as "stand" -> wait(5)`,
  post: 'otherwise as "stand" -> wait(100)',
});
const ALL = { ...PROGRAMS, ...EXTRA };
const monstersIn = (w: World) => w.actors.filter((a) => a.kind !== ADVENTURER);
/** A free tile next to `p` that anyone can stand on. */
const besides = (w: World, p: Point): Point[] =>
  NEIGHBOURS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(
    (q) =>
      isWalkable(MAP, q.x, q.y) &&
      terrainAt(MAP, q.x, q.y) !== "camp" &&
      !w.actors.some((a) => a.x === q.x && a.y === q.y),
  );
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
        if (!isWalkable(MAP, q.x, q.y) || terrainAt(MAP, q.x, q.y) === "camp" || seen.has(key(q)))
          continue;
        seen.add(key(q));
        next.push(q);
      }
    }
    all.push(...next);
    ring = next;
  }
  return all;
}

describe("goblins", () => {
  it("a goblin hit once runs", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [
      { type: "spawn", name: "Goblin", program: "goblin", kind: "goblin", x: 26, y: 15 },
      { type: "spawn", name: "Ash", program: "once", x: 27, y: 15 },
    ]);
    const goblin = world.actors[0] as World["actors"][number];
    const log: WorldEvent[] = [];
    let farthest = 0;
    for (let t = 0; t < 60; t++) {
      log.push(...step(world));
      farthest = Math.max(farthest, steps(goblin, { x: 27, y: 15 }));
    }
    const hit = log.find((e) => e.type === "hit" && e.target === 1);
    expect(hit).toBeDefined();
    // One blow takes the goblin to half its hitpoints, and the next thing it does is run.
    expect(hit?.type === "hit" && hit.hp).toBe((MONSTERS.kinds.goblin?.hp as number) / 2);
    const next = log.find(
      (e) => e.type === "decide" && e.actor === 1 && e.tick >= (hit?.tick ?? 0),
    );
    expect(next?.type === "decide" && next.action).toBe("flee");

    // It got well clear before it thought of going home.
    expect(farthest).toBeGreaterThanOrEqual(6);
  });

  it("a hurt goblin at the end of a dead end, with its enemy two tiles off, does not try to run for ever", () => {
    // Every dead end away from camp: a tile with one way out, and a tile beyond that.
    const ground = (p: Point) => isWalkable(MAP, p.x, p.y) && terrainAt(MAP, p.x, p.y) !== "camp";
    const around = (p: Point) =>
      NEIGHBOURS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy })).filter(ground);
    let ends = 0;
    for (let y = 0; y < MAP.height; y++) {
      for (let x = 0; x < MAP.width; x++) {
        const tip = { x, y };
        if (!ground(tip) || steps(tip, place(MAP, "camp")) < 8) continue;
        const out = around(tip);
        if (out.length !== 1) continue;
        const neck = out[0] as Point;
        const beyond = around(neck).filter((p) => p.x !== x || p.y !== y);
        if (beyond.length !== 1) continue;
        ends++;
        const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
        step(world, [
          { type: "spawn", name: "Goblin", program: "goblin", kind: "goblin", ...tip },
          { type: "spawn", name: "Ash", program: "post", ...(beyond[0] as Point) },
        ]);
        const goblin = world.actors[0] as World["actors"][number];
        goblin.hp = (MONSTERS.kinds.goblin?.hp as number) / 2;
        let moved = false;
        for (let t = 0; t < 300; t++) {
          step(world);
          if (goblin.x !== x || goblin.y !== y) moved = true;
        }
        expect(moved, `goblin at ${x},${y}`).toBe(true);
      }
    }
    expect(ends).toBeGreaterThan(0);
  });
});

describe("the cap and the wait", () => {
  it("one that dies is replaced an hour after it died at the earliest, however few are out", () => {
    for (const seed of [3, 4, 5]) {
      const world = createWorld(WORLD, seed, ALL, MONSTERS.kinds, MONSTERS.spawns);
      step(world);
      const target = monstersIn(world)[0] as World["actors"][number];
      expect(world.tick).toBe(1);
      target.hp = 1;
      step(world, [
        { type: "spawn", name: "Ash", program: "once", ...(besides(world, target)[0] as Point) },
      ]);
      let died = 0;
      let back = 0;
      const known = new Set(world.actors.map((a) => a.id));
      for (let t = 0; t < 3 * RESPAWN_TICKS && back === 0; t++) {
        for (const event of step(world)) {
          if (event.type === "down" && event.actor === target.id) died = event.tick;
        }
        if (monstersIn(world).some((a) => !known.has(a.id))) back = world.tick;
      }
      // It died within the first few seconds, long before the hour was up.
      expect(died).toBeGreaterThan(0);
      expect(died).toBeLessThan(30);
      expect(back - died).toBeGreaterThanOrEqual(RESPAWN_TICKS);
    }
  });

  it("monsters put in by hand count against the cap and the wait", () => {
    const row = Array.from({ length: 7 }, (_, i) => ({ x: 8 + i, y: 15 }));
    const crowd = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(
      crowd,
      row.map((p) => ({
        type: "spawn" as const,
        name: "Wolf",
        program: "wolf",
        kind: "wolf",
        ...p,
      })),
    );
    expect(monstersIn(crowd)).toHaveLength(MONSTER_CAP);
    // A wolf put in by hand holds the table's first group back for a full hour
    // from the tick it is first in the world.
    const early = createWorld(WORLD, 1, ALL, MONSTERS.kinds, MONSTERS.spawns);
    step(early, [{ type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", x: 8, y: 15 }]);
    const arrived = early.tick;
    run(early, RESPAWN_TICKS - 1);
    expect(early.tick - arrived).toBe(RESPAWN_TICKS - 1);
    expect(monstersIn(early)).toHaveLength(1);
    run(early, 1);
    expect(monstersIn(early).length).toBeGreaterThan(1);
    // Monsters are not put on the camp's ground; adventurers are.
    const camp = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(camp, [
      { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", x: 14, y: 9 },
      { type: "spawn", name: "Ash", program: "post", x: 13, y: 9 },
    ]);
    expect(camp.actors.map((a) => a.name)).toEqual(["Ash"]);
  });

  it("a group comes whole and near its place, and the cap holds at every tick", () => {
    let groups = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const world = createWorld(WORLD, seed, ALL, MONSTERS.kinds, MONSTERS.spawns);
      const known = new Set<number>();
      for (let t = 0; t < 2 * TICKS_PER_DAY; t++) {
        step(world);
        const out = monstersIn(world);
        expect(out.length).toBeLessThanOrEqual(MONSTER_CAP);
        const fresh = out.filter((a) => !known.has(a.id));
        for (const a of out) known.add(a.id);
        if (fresh.length === 0) continue;
        groups++;
        const spawn = MONSTERS.spawns.find((s) => s.kind === fresh[0]?.kind) as Spawns[number];
        expect(fresh.map((a) => a.kind)).toEqual(Array(spawn.group).fill(spawn.kind));
        const places = isNight(world) ? spawn.night : spawn.day;
        // All of them near one of the places for this part of the day.
        expect(
          places.some((p) =>
            fresh.every((a) => within(p, GROUP_SPREAD).some((q) => steps(q, a) === 0)),
          ),
        ).toBe(true);
      }
    }
    // Groups by day and by night, over two days and six seeds.
    expect(groups).toBeGreaterThan(6 * 4);
  });

  it("a place too crowded for the whole group gets none, until there is room", () => {
    const den = { x: 26, y: 15 };
    const spawns: Spawns = [
      { kind: "goblin", name: "Goblin", program: "goblin", group: 3, day: [den], night: [] },
    ];
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds, spawns);
    const near = within(den, GROUP_SPREAD);
    expect(near.length).toBeGreaterThan(5);
    // Everyone but two of the tiles near the place has someone standing on it.
    step(
      world,
      near
        .slice(2)
        .map((p, i) => ({ type: "spawn" as const, name: `A${i}`, program: "post", ...p })),
    );
    expect(monstersIn(world)).toHaveLength(0);
    run(world, RESPAWN_TICKS - 2);
    expect(monstersIn(world)).toHaveLength(0);
    // One steps away: now there is room for three, and three come at the next try.
    world.actors = world.actors.slice(1);
    run(world, 2);
    const out = monstersIn(world);
    expect(out).toHaveLength(3);
    for (const goblin of out) expect(near.some((q) => steps(q, goblin) === 0)).toBe(true);
  });
});

describe("day and night", () => {
  const H = TICKS_PER_GAME_HOUR;
  /** Runs to the last tick before `hour` on day `day`. */
  const until = (world: World, hour: number, day = 0): WorldEvent[] =>
    run(world, day * TICKS_PER_DAY + (hour - START_HOUR) * H - 1 - world.tick);

  it("day monsters go home at dusk and night ones come; at dawn it turns round", () => {
    for (const seed of [1, 2, 3]) {
      const world = createWorld(WORLD, seed, ALL, MONSTERS.kinds, MONSTERS.spawns);
      until(world, NIGHT_HOUR);
      const day = monstersIn(world);
      expect(day).toHaveLength(MONSTER_CAP);
      expect(day.every((a) => a.shift === "day")).toBe(true);
      // Nobody is near them, so they go the moment night falls.
      const dusk = run(world, 1);
      expect(
        dusk.filter((e) => e.type === "leave").map((e) => e.type === "leave" && e.actor),
      ).toEqual(day.map((a) => a.id));
      expect(monstersIn(world)).toHaveLength(0);
      // The night's monsters come within the next hour or so, and fill up by midnight.
      until(world, NIGHT_HOUR + 2);
      expect(monstersIn(world).length).toBeGreaterThan(0);
      until(world, 23);
      const night = monstersIn(world);
      expect(night.every((a) => a.shift === "night")).toBe(true);
      expect(night.length).toBeGreaterThanOrEqual(MONSTER_CAP - 2);
      // At dawn they go in turn, and the day's come back.
      until(world, DAY_HOUR, 1);
      expect(monstersIn(world).length).toBeGreaterThan(0);
      run(world, 1);
      expect(monstersIn(world)).toHaveLength(0);
      until(world, DAY_HOUR + 2, 1);
      expect(monstersIn(world).every((a) => a.shift === "day")).toBe(true);
      expect(monstersIn(world).length).toBeGreaterThan(0);
    }
  });

  it("one with an adventurer near it at dusk stays until it is clear", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds, MONSTERS.spawns);
    until(world, NIGHT_HOUR);
    const stays = monstersIn(world)[0] as World["actors"][number];
    // An adventurer that only stands, a few tiles off, within LEAVE_DISTANCE.
    const spot = within(stays, 3)
      .filter((p) => steps(p, stays) === 3 && !world.actors.some((a) => steps(a, p) === 0))
      .at(0) as Point;
    expect(steps(spot, stays)).toBeLessThanOrEqual(LEAVE_DISTANCE);
    step(world, [{ type: "spawn", name: "Ash", program: "post", ...spot }]);
    // It stays, and so does anyone else that near the adventurer (give or take the
    // step it took after); the rest go.
    expect(monstersIn(world)).toContain(stays);
    for (const m of monstersIn(world))
      expect(steps(m, spot)).toBeLessThanOrEqual(LEAVE_DISTANCE + 1);
    // For as long as an adventurer is near it, it stays. The goblins go at Ash,
    // who only stands, so Ash goes down in time and wakes at camp, far off.
    let near = 0;
    for (let t = 0; t < 600 && world.actors.includes(stays); t++) {
      const close = world.actors.some(
        (a) => a.kind === ADVENTURER && steps(a, stays) <= LEAVE_DISTANCE,
      );
      step(world);
      if (close) {
        near++;
        expect(world.actors.includes(stays)).toBe(true);
      }
    }
    expect(near).toBeGreaterThan(20);
    // Once nobody is near, it goes.
    world.actors = world.actors.filter((a) => a.kind !== ADVENTURER);
    run(world, 20);
    expect(world.actors.includes(stays)).toBe(false);
  });

  it("refuses snapshots with a monster where none could be", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds, MONSTERS.spawns);
    run(world, 2 * RESPAWN_TICKS + 1);
    const saved = snapshot(world);
    expect(restore(saved, WORLD, ALL, MONSTERS.kinds, MONSTERS.spawns)).toEqual(world);
    const forge = (change: (state: { actors: Record<string, unknown>[] }) => void): string => {
      const data = JSON.parse(saved);
      change(data.state);
      data.hash = hashWorld({
        ...data.state,
        atlas: atlasOf(WORLD),
        programs: ALL,
        kinds: MONSTERS.kinds,
        spawns: MONSTERS.spawns,
      });
      return JSON.stringify(data);
    };
    const first = (s: { actors: Record<string, unknown>[] }) =>
      s.actors[0] as Record<string, unknown>;
    for (const bad of [
      forge((s) => Object.assign(first(s), { shift: "dusk" })),
      forge((s) => Object.assign(first(s), { shift: undefined })),
      // On the camp's ground.
      forge((s) => Object.assign(first(s), { x: 14, y: 9, fromX: 14, fromY: 9, path: [] })),
      // More than the cap.
      forge((s) => {
        for (let i = 0; i < MONSTER_CAP; i++)
          s.actors.push({
            ...first(s),
            id: 1000 + i,
            x: 8 + i,
            y: 15,
            fromX: 8 + i,
            fromY: 15,
            path: [],
          });
        (s as unknown as { nextActorId: number }).nextActorId = 2000;
      }),
    ]) {
      expect(() => restore(bad, WORLD, ALL, MONSTERS.kinds, MONSTERS.spawns)).toThrow(
        SnapshotError,
      );
    }
    // An adventurer is never out for a part of the day.
    const lived = createWorld(WORLD, 1, ALL, MONSTERS.kinds, MONSTERS.spawns);
    step(lived, [{ type: "spawn", name: "Ash", program: "post", x: 13, y: 9 }]);
    const text = JSON.parse(snapshot(lived));
    text.state.actors[0].shift = "day";
    text.hash = hashWorld({
      ...text.state,
      atlas: atlasOf(WORLD),
      programs: ALL,
      kinds: MONSTERS.kinds,
      spawns: MONSTERS.spawns,
    });
    expect(() =>
      restore(JSON.stringify(text), WORLD, ALL, MONSTERS.kinds, MONSTERS.spawns),
    ).toThrow(SnapshotError);
  });
});

describe("the camp's edge", () => {
  it("by day monsters turn back four tiles from camp; by night they come on to the camp's edge", () => {
    // (14, 5) is four steps from `camp` and right beside the camp's ground.
    const edge = { x: 14, y: 5 };
    expect(steps(edge, place(MAP, "camp"))).toBe(4);
    expect(terrainAt(MAP, 14, 6)).toBe("camp");
    for (const kind of ["wolf", "goblin"]) {
      const rules: Record<string, string[]> = {};
      for (const part of ["day", "night"]) {
        const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
        if (part === "night") world.tick = (NIGHT_HOUR - START_HOUR + 1) * TICKS_PER_GAME_HOUR;
        step(world, [{ type: "spawn", name: "M", program: kind, kind, ...edge }]);
        const log = run(world, 30);
        const program = world.programs[kind] as (typeof world.programs)[string];
        rules[part] = log.flatMap((e) =>
          e.type === "decide" ? [program.rules[e.rule] as string] : [],
        );
      }
      expect(rules.day, kind).toContain("too near camp");
      expect(rules.night, kind).not.toContain("too near camp");
      expect(rules.night?.length, kind).toBeGreaterThan(1);
    }
  });

  it("by night monsters still turn back three tiles from camp", () => {
    const camp = place(MAP, "camp");
    const near: Point[] = [];
    for (let y = 0; y < MAP.height; y++)
      for (let x = 0; x < MAP.width; x++)
        if (steps({ x, y }, camp) === 3 && isWalkable(MAP, x, y) && terrainAt(MAP, x, y) !== "camp")
          near.push({ x, y });
    expect(near.length).toBeGreaterThan(0);
    for (const kind of ["wolf", "goblin"]) {
      for (const at of near) {
        const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
        world.tick = (NIGHT_HOUR - START_HOUR + 1) * TICKS_PER_GAME_HOUR;
        expect(isNight(world)).toBe(true);
        step(world, [{ type: "spawn", name: "M", program: kind, kind, ...at }]);
        const log = run(world, 30);
        const program = world.programs[kind] as (typeof world.programs)[string];
        const rules = log.flatMap((e) =>
          e.type === "decide" ? [program.rules[e.rule] as string] : [],
        );
        // After the first decision, which only notes where home is.
        expect(rules[1], `${kind} at ${at.x},${at.y}`).toBe("too near camp");
      }
    }
  });
});

describe("getting nowhere", () => {
  it("`stalled` counts moves in a row that went nowhere, and any other decision clears it", () => {
    const programs = compileBots({
      stuck: `when stalled >= 3 and seen == 0 as "noticed" -> set seen = stalled; wait(5)
otherwise as "go nowhere" -> walk_to(self_x, self_y)`,
    });
    const world = createWorld(WORLD, 1, programs);
    step(world, [{ type: "spawn", name: "Ash", program: "stuck", x: 13, y: 9 }]);
    const ash = world.actors[0] as World["actors"][number];
    const seen: number[] = [];
    for (let t = 0; t < 60; t++) {
      step(world);
      seen.push(ash.stalled);
    }
    // 1, 2, 3, then the wait clears it, then it counts up again.
    expect(seen.filter((n, i) => n !== seen[i - 1])).toEqual([1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ash.memory[0]).toBe(3);
  });

  it("the wolf lunges at most twice from one tile, even when circling gets it nowhere", () => {
    // Every spot on the map where a wolf has one that stands two tiles off in line.
    let spots = 0;
    for (let y = 0; y < MAP.height; y++) {
      for (let x = 0; x < MAP.width; x++) {
        if (!isWalkable(MAP, x, y) || terrainAt(MAP, x, y) === "camp") continue;
        if (steps({ x, y }, place(MAP, "camp")) < 6) continue;
        const prey = { x: x + 2, y };
        if (!isWalkable(MAP, prey.x, prey.y) || !isWalkable(MAP, x + 1, y)) continue;
        spots++;
        const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
        step(world, [
          { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", x, y },
          { type: "spawn", name: "Ash", program: "post", ...prey },
        ]);
        const wolf = world.actors[0] as World["actors"][number];
        // Lunges since the wolf last stood anywhere else, and the most of them.
        let here = `${wolf.x},${wolf.y}`;
        let lunges = 0;
        let most = 0;
        for (let t = 0; t < 400 && wolf.hp > 0; t++) {
          const events = step(world);
          if (`${wolf.x},${wolf.y}` !== here) {
            here = `${wolf.x},${wolf.y}`;
            lunges = 0;
          }
          for (const e of events) if (e.type === "attack" && e.actor === wolf.id) lunges++;
          most = Math.max(most, lunges);
        }
        expect(most, `wolf at ${x},${y}`).toBeLessThanOrEqual(2);
      }
    }
    expect(spots).toBeGreaterThan(20);
  });
});
