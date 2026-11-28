// Wolves hunt: the sensors they hunt with, their pace, and hunts on the camp's
// map with the pack put in by hand. Most citizens in the hunts run one small
// program (runner): stand, run home one step at a time once an enemy is
// within eight tiles, and fight once one is beside them; some only stand
// (post). The wolves run the camp's wolf program. Then citizens mending after
// a down. The camp's night packs and firelight went with the camp world.

import { describe, expect, it } from "vitest";
import { placeConstants } from "./map.ts";
import { compileBots, compileTactics } from "./tactics.ts";
import { campMap, campMonsters } from "./testing.ts";
import {
  type Actor,
  ADVENTURER,
  createWorld,
  DOWN_TICKS,
  hashKinds,
  hashWorld,
  type Input,
  mending,
  restore,
  STEP_TICKS,
  snapshot,
  step,
  stepTicks,
  type World,
  type WorldEvent,
} from "./world.ts";

const ATLAS = campMap();
const MONSTERS = campMonsters(ATLAS);
const BOTS = compileBots(
  {
    runner: `bot "Runner"
when threat_distance <= 1 as "fight" -> attack(threat_x, threat_y)
when threat_distance <= 8 and distance(camp) > 2 as "run" -> step_to(camp)
otherwise as "stand" -> wait(10)`,
    // Reads the sensors into memory, in this order, and stands.
    probe: `otherwise -> set a = threat_friends; set b = friends_near(3); set e = threat_moving;
  set f = friends_near(0); set g = friends_near(-1); set h = friends_near(-2147483647);
  set i = friends_near(2147483647); set l = threat_distance; wait(600)`,
    post: 'otherwise as "stand" -> wait(600)',
    striker: 'otherwise as "strike" -> attack(self_x + 1, self_y)',
    walker: 'otherwise as "walk" -> walk_to(20, 1)',
    east: 'otherwise as "walk" -> walk_to(self_x + 6, self_y)',
  },
  placeConstants(ATLAS),
);
const PROGRAMS = { ...BOTS, ...MONSTERS.programs };

const person = (name: string, program: string, x: number, y: number): Input => ({
  type: "spawn",
  name,
  program,
  x,
  y,
});
const wolf = (x: number, y: number, program = "wolf"): Input => ({
  type: "spawn",
  name: "Wolf",
  program,
  kind: "wolf",
  x,
  y,
});

/** The camp's map with the actors `inputs` put in. */
function camp(inputs: readonly Input[], seed = 1): World {
  const world = createWorld(ATLAS, seed, PROGRAMS, MONSTERS.kinds);
  step(world, inputs);
  return world;
}

const named = (world: World, name: string): Actor => {
  const actor = world.actors.find((a) => a.name === name);
  if (!actor) throw new Error(`nobody called ${name}`);
  return actor;
};
const steps = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

interface Hunt {
  readonly events: WorldEvent[];
  /** The fewest steps any wolf came to any citizen. */
  readonly closest: number;
}

function hunt(world: World, ticks: number): Hunt {
  const events: WorldEvent[] = [];
  let closest = Number.POSITIVE_INFINITY;
  for (let t = 0; t < ticks; t++) {
    events.push(...step(world));
    const wolves = world.actors.filter((a) => a.kind === "wolf");
    for (const citizen of world.actors.filter((a) => a.kind === ADVENTURER))
      for (const w of wolves) closest = Math.min(closest, steps(w, citizen));
  }
  return { events, closest };
}

const decided = (world: World, events: WorldEvent[], label: string): number =>
  events.filter(
    (e) =>
      e.type === "decide" &&
      world.actors.find((a) => a.id === e.actor)?.kind === "wolf" &&
      world.programs.wolf?.rules[e.rule] === label,
  ).length;

describe("the sensors wolves hunt with", () => {
  it("count friends near an actor and near its enemy", () => {
    // Three citizens in a row on the road east of camp, a wolf beside the
    // last of them and a second wolf a tile from the first, and one more
    // citizen by the camp.
    const world = camp([
      person("Ash", "probe", 20, 8),
      person("Birch", "probe", 21, 8),
      person("Cedar", "probe", 22, 8),
      wolf(23, 8, "probe"),
      wolf(23, 9, "probe"),
      person("Dara", "probe", 15, 10),
    ]);
    const read = (actor: Actor): number[] => actor.memory.slice(0, 8);
    const [wolfA, wolfB] = world.actors.filter((a) => a.kind === "wolf") as [Actor, Actor];
    // threat_friends, friends_near(3), threat_moving, friends_near(0),
    // friends_near(-1), friends_near(most negative), friends_near(most positive),
    // threat_distance.
    // The first wolf's prey is Cedar, with Ash and Birch within four tiles; its
    // packmate is one tile off.
    expect(read(wolfA)).toEqual([2, 1, 0, 0, 0, 0, 1, 1]);
    expect(read(wolfB)).toEqual([2, 1, 0, 0, 0, 0, 1, 2]);
    // Cedar's enemy is the wolf beside it, with its packmate one tile off. Ash
    // and Birch are within three of Cedar, and Dara is on the map too.
    expect(read(named(world, "Cedar"))).toEqual([1, 2, 0, 0, 0, 0, 3, 1]);
    expect(read(named(world, "Ash"))).toEqual([1, 2, 0, 0, 0, 0, 3, 3]);
  });

  it("threat_moving reads the enemy", () => {
    // A wolf, reading a citizen that has just set off walking.
    const world = camp([person("Ash", "walker", 14, 6), wolf(14, 3, "probe")]);
    const watcher = world.actors[1] as Actor;
    expect(watcher.memory[2]).toBe(1);
  });

  it("friends_near and threat_friends never fault, whatever they are given", () => {
    const sources = {
      odd: `otherwise -> set a = friends_near(1 / 1 - 2147483647 - 1); set b = friends_near(threat_x * 99999);
  set c = threat_friends + friends_near(friends_near(friends_near(5))); wait(5)`,
    };
    const odd = compileBots(sources, placeConstants(ATLAS));
    const world = createWorld(ATLAS, 2, { ...PROGRAMS, ...odd }, MONSTERS.kinds);
    step(world, [person("Ash", "odd", 20, 8), person("Birch", "odd", 21, 8), wolf(25, 8)]);
    for (let t = 0; t < 200; t++) step(world);
    for (const actor of world.actors.filter((a) => a.program === "odd")) {
      expect(actor.fault).toBe(0);
      for (const value of actor.memory) expect(Number.isInteger(value)).toBe(true);
    }
    // Called with the wrong number of values, it does not compile.
    for (const source of [
      "otherwise -> set a = friends_near; idle",
      "otherwise -> set a = friends_near(1, 2); idle",
      "otherwise -> set a = friends_near(camp); idle",
      "otherwise -> set a = threat_friends(3); idle",
    ])
      expect(compileTactics(source, placeConstants(ATLAS)).ok, source).toBe(false);
  });
});

describe("wolves walk faster", () => {
  it("a wolf takes 4 ticks a tile, a citizen 6, and a goblin 6", () => {
    expect(MONSTERS.kinds.wolf?.step).toBe(4);
    expect(MONSTERS.kinds.goblin?.step).toBe(STEP_TICKS);
    // Each walks six tiles east along its own open row, again and again.
    const world = camp([
      wolf(12, 4, "east"),
      person("Ash", "east", 13, 5),
      { type: "spawn", name: "Goblin", program: "east", kind: "goblin", x: 8, y: 11 },
    ]);
    const walkers = world.actors as [Actor, Actor, Actor];
    expect(walkers.map((a) => stepTicks(world, a))).toEqual([4, 6, 6]);
    // The ticks between one tile and the next, for each of them, over its first walk.
    const changes = walkers.map(() => [] as number[]);
    const last = walkers.map((a) => `${a.x},${a.y}`);
    for (let t = 0; t < 40; t++) {
      step(world);
      walkers.forEach((a, i) => {
        if (`${a.x},${a.y}` === last[i]) return;
        last[i] = `${a.x},${a.y}`;
        changes[i]?.push(world.tick);
      });
    }
    const gaps = changes.map((ticks) => ticks.slice(1, 6).map((t, i) => t - (ticks[i] as number)));
    expect(gaps).toEqual([Array(5).fill(4), Array(5).fill(6), Array(5).fill(6)]);
  });

  it("the step is in the kinds' fingerprint, and a kind at the citizens' pace hashes as before", () => {
    const plain = { wolf: { hp: 24, damage: 8, windup: 8, recovery: 20, reach: 2 } };
    expect(hashKinds(createWorld(ATLAS, 1, {}, plain).kinds)).toBe(
      hashKinds(createWorld(ATLAS, 1, {}, { wolf: { ...plain.wolf, step: STEP_TICKS } }).kinds),
    );
    expect(hashKinds(createWorld(ATLAS, 1, {}, plain).kinds)).not.toBe(
      hashKinds(createWorld(ATLAS, 1, {}, { wolf: { ...plain.wolf, step: 4 } }).kinds),
    );
  });

  it("a snapshot holds a wolf partway through a step, and refuses one further into a step than a chilled wolf's", () => {
    const world = camp([person("Ash", "runner", 29, 3), wolf(27, 8), wolf(28, 8)]);
    let moving: Actor | undefined;
    for (let t = 0; t < 200 && !moving; t++) {
      step(world);
      moving = world.actors.find((a) => a.kind === "wolf" && a.moveTicksLeft === 4);
    }
    expect(moving).toBeDefined();
    const saved = snapshot(world);
    expect(restore(saved, ATLAS, PROGRAMS, MONSTERS.kinds)).toEqual(world);
    const data = JSON.parse(saved);
    const index = world.actors.indexOf(moving as Actor);
    // A step begun chilled takes half as long again, 6 ticks for a wolf, and
    // may still be under way after the chill is gone; 7 is more than any takes.
    const rehash = (moveTicksLeft: number): string => {
      data.state.actors[index].moveTicksLeft = moveTicksLeft;
      data.hash = hashWorld({
        ...data.state,
        atlas: world.atlas,
        programs: world.programs,
        kinds: world.kinds,
      });
      return JSON.stringify(data);
    };
    expect(restore(rehash(6), ATLAS, PROGRAMS, MONSTERS.kinds).actors[index]).toMatchObject({
      moveTicksLeft: 6,
    });
    expect(() => restore(rehash(7), ATLAS, PROGRAMS, MONSTERS.kinds)).toThrow(/damaged/);
  });
});

describe("a hunt", () => {
  // At the meadow's edge, far from camp.
  const FAR = { x: 29, y: 3 };
  // A group standing at the meadow's edge, and a pack of three on the road five tiles south of it.
  const GROUP = [FAR, { x: 28, y: 3 }, { x: 29, y: 2 }, { x: 28, y: 2 }, { x: 27, y: 3 }];
  const PACK = [wolf(27, 8), wolf(28, 8), wolf(28, 9)];

  it("a lone citizen far out is caught and downed by the pack", () => {
    const world = camp([person("Ash", "runner", FAR.x, FAR.y), ...PACK]);
    const ash = named(world, "Ash");
    const wolves = world.actors.filter((a) => a.kind === "wolf").map((a) => a.id);
    expect(wolves).toHaveLength(3);
    const { events } = hunt(world, 1200);
    const down = events.find((e) => e.type === "down" && e.actor === ash.id);
    expect(down).toBeDefined();
    if (down?.type !== "down") return;
    expect(wolves).toContain(down.by);
    // It ran before it was caught, and blows from more than one wolf of the pack landed on it.
    const ran = events.some(
      (e) =>
        e.type === "decide" && e.actor === ash.id && e.tick < down.tick && e.action === "step_to",
    );
    expect(ran).toBe(true);
    const biters = new Set(
      events.flatMap((e) =>
        e.type === "hit" && e.target === ash.id && e.tick <= down.tick ? [e.actor] : [],
      ),
    );
    expect(biters.size).toBeGreaterThanOrEqual(2);
    for (const biter of biters) expect(wolves).toContain(biter);
  });

  it("a group two bigger than the pack is left alone, and one no bigger is attacked", () => {
    const five = camp([...GROUP.map((p, i) => person(`R${i}`, "post", p.x, p.y)), ...PACK]);
    const left = hunt(five, 3000);
    // The pack came near enough to see them, and turned away.
    expect(left.closest).toBeLessThanOrEqual(10);
    expect(decided(five, left.events, "back off")).toBeGreaterThan(0);
    expect(left.events.filter((e) => e.type === "hit" || e.type === "down")).toEqual([]);
    // Three standing in the same place, against the same three wolves.
    const three = camp([
      ...GROUP.slice(0, 3).map((p, i) => person(`R${i}`, "post", p.x, p.y)),
      ...PACK,
    ]);
    const attacked = hunt(three, 1200);
    expect(attacked.events.some((e) => e.type === "down" && e.kind === ADVENTURER)).toBe(true);
  });

  it("a hunt saved partway resumes to the same world", () => {
    const begin = (): World => camp([person("Ash", "runner", FAR.x, FAR.y), ...PACK]);
    const straight = begin();
    for (let t = 0; t < 400; t++) step(straight);
    const half = begin();
    for (let t = 0; t < 150; t++) step(half);
    const resumed = restore(snapshot(half), ATLAS, PROGRAMS, MONSTERS.kinds);
    for (let t = 0; t < 250; t++) step(resumed);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });
});

describe("a citizen mending after a down", () => {
  const goblin = (x: number, y: number, program: string): Input => ({
    type: "spawn",
    name: "Goblin",
    program,
    kind: "goblin",
    x,
    y,
  });

  it("is left as a down leaves it, with no rule in charge, until it is up", () => {
    // A goblin beside Ash on the road strikes at Ash's tile whenever it can.
    const world = camp([person("Ash", "post", 20, 8), goblin(19, 8, "striker")]);
    const ash = named(world, "Ash");
    expect(mending(ash)).toBe(false);
    let downed = -1;
    for (let t = 0; t < 400 && downed < 0; t++)
      if (step(world).some((e) => e.type === "down" && e.actor === ash.id)) downed = world.tick;
    expect(downed).toBeGreaterThan(0);
    // Carried to the camp, the home of a world on one map.
    expect(ash).toMatchObject({ x: 14, y: 9, rule: -1, fault: 0 });
    expect(ash.wait).toBeGreaterThan(DOWN_TICKS - 5);
    expect(mending(ash)).toBe(true);
    let up = -1;
    for (let t = 0; t < 2 * DOWN_TICKS && up < 0; t++) {
      step(world);
      if (!mending(ash)) up = world.tick;
    }
    expect(up - downed).toBeGreaterThanOrEqual(DOWN_TICKS - 1);
    expect(up - downed).toBeLessThanOrEqual(DOWN_TICKS + 1);
    // Up again, it decides for itself.
    step(world);
    expect(ash.rule).toBe(0);
  });

  it("is passed by blows, and monsters' sensors leave it out", () => {
    const world = camp([person("Ash", "post", 13, 10)]);
    const ash = named(world, "Ash");
    // As a down leaves it.
    Object.assign(ash, { wait: DOWN_TICKS, rule: -1, fault: 0 });
    expect(mending(ash)).toBe(true);
    const log = step(world, [
      goblin(12, 10, "striker"),
      wolf(13, 11, "probe"),
      person("Elm", "probe", 28, 8),
    ]);
    const striker = world.actors.find((a) => a.program === "striker") as Actor;
    const watcher = world.actors.find((a) => a.program === "probe" && a.kind === "wolf") as Actor;
    while (mending(ash)) log.push(...step(world));
    const blows = log.filter(
      (e) => (e.type === "hit" || e.type === "miss") && e.actor === striker.id,
    );
    expect(blows.length).toBeGreaterThan(3);
    expect(blows.every((e) => e.type === "miss")).toBe(true);
    expect(ash.hp).toBe(20);
    // The wolf, beside Ash, takes Elm far out on the road for its nearest enemy.
    expect(steps(watcher, ash)).toBe(1);
    expect(watcher.memory[7]).toBe(steps(watcher, named(world, "Elm")));
    // Up again, it is struck.
    const after: WorldEvent[] = [];
    for (let t = 0; t < 40; t++) after.push(...step(world));
    expect(
      after.some((e) => e.type === "hit" && e.actor === striker.id && e.target === ash.id),
    ).toBe(true);
  });
});
