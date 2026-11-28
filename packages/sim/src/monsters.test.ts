import { describe, expect, it } from "vitest";
import { CONFUSED_TICKS } from "./brain.ts";
import { isWalkable, NEIGHBOURS, type Point, place, terrainAt } from "./map.ts";
import { loadMonsters } from "./monsters.ts";
import { createRng, nextInt } from "./rng.ts";
import { BotError, compileBots } from "./tactics.ts";
import {
  botSources,
  campBotSources,
  campMap,
  campMonsters,
  campPrograms,
  monsterSources,
  monsterStats,
} from "./testing.ts";
import { FAULTS } from "./vm.ts";
import {
  ADVENTURER,
  createWorld,
  KindError,
  restore,
  STEP_TICKS,
  snapshot,
  step,
  type World,
  type WorldEvent,
} from "./world.ts";

// The worlds here are made on the camp's map, which has every place the
// camp's programs and monsters name.
const MAP = campMap();
const WORLD = MAP;
const MONSTERS = campMonsters(MAP);
const PROGRAMS = { ...campPrograms(MAP), ...MONSTERS.programs };

const run = (world: World, ticks: number): WorldEvent[] => {
  const log: WorldEvent[] = [];
  for (let i = 0; i < ticks; i++) log.push(...step(world));
  return log;
};
const steps = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

describe("monsters from files", () => {
  it("loads each monster's numbers, name and program", () => {
    expect(Object.keys(MONSTERS.kinds)).toEqual(["goblin", "wolf"]);
    for (const [kind, raw] of Object.entries(monsterStats())) {
      const stats = raw as Record<string, unknown>;
      expect(MONSTERS.kinds[kind]).toEqual({
        hp: stats.hp,
        damage: stats.damage,
        windup: stats.windup,
        recovery: stats.recovery,
        reach: stats.reach,
        step: stats.step ?? STEP_TICKS,
        rank: stats.rank ?? "fodder",
        level: stats.level ?? 1,
      });
      expect(MONSTERS.names[kind]).toBe(stats.name);
      expect(MONSTERS.runs[kind]).toBe(stats.program);
    }
    expect(Object.keys(MONSTERS.programs).sort()).toEqual(Object.keys(monsterSources()).sort());
    // Monster programs share the world's program table with the citizens', so no name is used twice.
    for (const name of Object.keys(MONSTERS.programs)) {
      expect(botSources()).not.toHaveProperty(name);
      expect(campBotSources()).not.toHaveProperty(name);
    }
    expect(() => createWorld(WORLD, 1, PROGRAMS, MONSTERS.kinds)).not.toThrow();
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
      { wolf: { ...wolf, step: 1 } },
      { wolf: { ...wolf, step: 31 } },
      { wolf: { ...wolf, step: "4" } },
      { wolf: { ...wolf, step: null } },
      // The spawn table went with the camp: its fields are unknown now.
      { wolf: { ...wolf, group: 2 } },
      { wolf: { ...wolf, day: ["deep_wood"] } },
      { wolf: { ...wolf, night: [] } },
      { wolf: { ...wolf, night_group: 3 } },
      { wolf: { ...wolf, colour: "grey" } },
      { wolf: null },
      { wolf: [] },
      { wolf: "wolf" },
      { Wolf: wolf },
      JSON.parse(`{"__proto__": ${JSON.stringify(wolf)}}`),
      // Values that throw when made into text, and fields from a prototype.
      { wolf: { ...wolf, program: { toString: null } } },
      { wolf: Object.assign(Object.create({ hp: wolf.hp }), without(wolf, "hp")) },
      { wolf: Object.assign(Object.create(wolf), { name: wolf.name }) },
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
    // A program that does not compile fails with its file, like a citizen's.
    expect(() =>
      loadMonsters(stats, { ...monsterSources(), wolf: "when -> nothing" }, MAP),
    ).toThrow(/wolf\.tac, line 1/);
    expect(() =>
      loadMonsters(stats, { ...monsterSources(), wolf: "\u0000".repeat(50) }, MAP),
    ).toThrow(BotError);
    // A name the world would not take is refused here too, with the file named.
    for (const change of [
      { name: "" },
      { name: "wolf" },
      { name: "A".repeat(20) },
      { name: 7 },
      { name: undefined },
    ]) {
      expect(
        () => loadMonsters({ wolf: { ...wolf, ...change } }, monsterSources(), MAP),
        JSON.stringify(change),
      ).toThrow(/^wolf\.json: name must be/);
    }
    // A kind with no step walks as citizens do.
    const plain = loadMonsters({ wolf: without(wolf, "step") }, monsterSources(), MAP);
    expect(plain.kinds.wolf?.step).toBe(STEP_TICKS);
  });

  it("a monster whose program is broken stands confused, and the world keeps running", () => {
    // The wolf's numbers, with a program that divides by zero on every decision.
    const broken = loadMonsters(
      { wolf: monsterStats().wolf },
      { wolf: 'otherwise as "think" -> wait(1 / 0)' },
      MAP,
    );
    const programs = { ...campPrograms(MAP), ...broken.programs };
    const world = createWorld(WORLD, 4, programs, broken.kinds);
    const camp = place(MAP, "camp");
    step(world, [
      { type: "spawn", name: "Ash", program: "homebody", ...camp },
      { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", ...place(MAP, "deep_wood") },
      { type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", ...place(MAP, "meadow") },
    ]);
    const log = run(world, 1800);
    const wolves = world.actors.filter((a) => a.kind === "wolf");
    expect(wolves).toHaveLength(2);
    for (const wolf of wolves) {
      expect(FAULTS[wolf.fault]).toBe("divide_by_zero");
      // A confused wolf does nothing: no decision, no step.
      expect(log.some((e) => e.type === "decide" && e.actor === wolf.id)).toBe(false);
      expect([wolf.x, wolf.y]).toEqual([wolf.fromX, wolf.fromY]);
      // It tries again after standing confused for a while, and fails the same way.
      const ticks = log.filter((e) => e.type === "fault" && e.actor === wolf.id).map((e) => e.tick);
      expect(ticks.length).toBeGreaterThan(30);
      for (let i = 1; i < ticks.length; i++) {
        expect((ticks[i] as number) - (ticks[i - 1] as number)).toBe(CONFUSED_TICKS + 1);
      }
    }
    // The citizen carries on, and the world still saves and loads.
    expect(log.filter((e) => e.type === "decide" && e.actor === 1).length).toBeGreaterThan(20);
    expect(restore(snapshot(world), WORLD, programs, broken.kinds)).toEqual(world);
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

// Residents for the tests below: one that strikes once and then stands, and one
// that only stands.
const EXTRA = compileBots({
  once: `when struck == 0 and threat_distance <= 1 as "hit it" -> set struck = 1; attack(threat_x, threat_y)
otherwise as "stand" -> wait(5)`,
  post: 'otherwise as "stand" -> wait(100)',
});
const ALL = { ...PROGRAMS, ...EXTRA };

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
    // One level-1 blow of 7 takes the goblin to half its 14 hitpoints, and the next thing it does is run.
    // A crit would kill it outright, so this needs a seed whose first blow does not crit.
    expect(
      hit?.type === "hit" && hit.crit,
      "Ash's first blow crit and killed the goblin; the world's rolls have moved, so give this test a seed whose first blow does not crit",
    ).toBe(false);
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
