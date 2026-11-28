// Wolves hunt: the sensors they hunt with, the night pack, and hunts on the
// shipped world by night, out on the map and into the camp's light. Most
// residents in the hunts run one small program (runner): stand, run home one
// step at a time once an enemy is within eight tiles, and fight once one is
// beside them; some only stand (post). The wolves run the shipped program.
// Then residents mending after a down, and goblins at the light's edge.

import { describe, expect, it } from "vitest";
import { regionAt, terrainOf, walkable } from "./atlas.ts";
import { placeConstants } from "./map.ts";
import { findPath } from "./path.ts";
import { compileBots, compileTactics } from "./tactics.ts";
import { shippedMonsters, shippedWorld } from "./testing.ts";
import {
  type Actor,
  ADVENTURER,
  createWorld,
  DOWN_TICKS,
  hashKinds,
  hashSpawns,
  hashWorld,
  type Input,
  inFirelight,
  LIGHT_REACH,
  MONSTER_CAPS,
  mending,
  NIGHT_HOUR,
  restore,
  type Spawns,
  START_HOUR,
  STEP_TICKS,
  snapshot,
  step,
  stepTicks,
  TICKS_PER_GAME_HOUR,
  type World,
  type WorldEvent,
} from "./world.ts";

const ATLAS = shippedWorld();
const MONSTERS = shippedMonsters(ATLAS);
const WOLF_SPAWNS = MONSTERS.spawns.filter((s) => s.kind === "wolf");
const BOTS = compileBots(
  {
    runner: `bot "Runner"
when threat_distance <= 1 as "fight" -> attack(threat_x, threat_y)
when threat_distance <= 8 and lit_here == 0 as "run" -> step_to(camp)
otherwise as "stand" -> wait(10)`,
    // Reads the new sensors into memory, in this order, and stands.
    probe: `otherwise -> set a = threat_friends; set b = friends_near(3); set c = lit_here;
  set d = threat_lit; set e = threat_moving; set f = friends_near(0); set g = friends_near(-1);
  set h = friends_near(-2147483647); set i = friends_near(2147483647); set j = lit_enemies;
  set k = lit_mending; set l = threat_distance; wait(600)`,
    post: 'otherwise as "stand" -> wait(600)',
    striker: 'otherwise as "strike" -> attack(self_x + 1, self_y)',
    walker: 'otherwise as "walk" -> walk_to(20, 1)',
    east: 'otherwise as "walk" -> walk_to(self_x + 6, self_y)',
  },
  placeConstants(ATLAS),
);
const PROGRAMS = { ...BOTS, ...MONSTERS.programs };
const NIGHTFALL = (NIGHT_HOUR - START_HOUR) * TICKS_PER_GAME_HOUR;

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

/** The shipped world at 19:00 with `spawns` and the actors `inputs` put in. */
function night(spawns: Spawns, inputs: readonly Input[], seed = 1): World {
  const world = createWorld(ATLAS, seed, PROGRAMS, MONSTERS.kinds, spawns);
  world.tick = NIGHTFALL;
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

/** Tiles of walking from (x, y) to the first tile in the firelight on the way to camp. */
function walkToLight(world: World, x: number, y: number): number {
  const path = findPath(ATLAS, { x, y }, { x: 14, y: 9 }) ?? [];
  return path.findIndex((p) => inFirelight(world, p.x, p.y)) + 1;
}

interface Hunt {
  readonly events: WorldEvent[];
  /** The fewest steps any wolf came to any resident. */
  readonly closest: number;
  /** The tick on which the resident named first reached the light without having been downed, or -1. */
  readonly home: number;
  /** Wolves' blows that landed on a resident standing in the light, not counting downing blows. */
  readonly litHits: number;
}

function hunt(world: World, ticks: number, watched: string): Hunt {
  const events: WorldEvent[] = [];
  let closest = Number.POSITIVE_INFINITY;
  let home = -1;
  let litHits = 0;
  const who = named(world, watched);
  for (let t = 0; t < ticks; t++) {
    const out = step(world);
    events.push(...out);
    const wolves = world.actors.filter((a) => a.kind === "wolf");
    for (const resident of world.actors.filter((a) => a.kind === ADVENTURER))
      for (const w of wolves) closest = Math.min(closest, steps(w, resident));
    const downed = events.some((e) => e.type === "down" && e.actor === who.id);
    if (home < 0 && !downed && inFirelight(world, who.x, who.y)) home = world.tick;
    // A resident downed this tick has been carried to camp already, so only blows that left it standing count.
    for (const e of out) {
      if (e.type !== "hit" || !wolves.some((w) => w.id === e.actor)) continue;
      const target = world.actors.find((a) => a.id === e.target);
      const fell = out.some((d) => d.type === "down" && d.actor === e.target);
      if (target && !fell && inFirelight(world, target.x, target.y)) litHits++;
    }
  }
  return { events, closest, home, litHits };
}

const decided = (world: World, events: WorldEvent[], label: string): number =>
  events.filter(
    (e) =>
      e.type === "decide" &&
      world.actors.find((a) => a.id === e.actor)?.kind === "wolf" &&
      world.programs.wolf?.rules[e.rule] === label,
  ).length;

describe("the sensors wolves hunt with", () => {
  it("count friends near an actor and near its enemy, and say who is in the light", () => {
    // Three residents in a row on the road east of camp, out of the light, a
    // wolf beside the last of them and a second wolf a tile from the first.
    // One more resident stands in the light, and one in the hills, another region.
    const world = createWorld(ATLAS, 1, PROGRAMS, MONSTERS.kinds);
    step(world, [
      person("Ash", "probe", 20, 8),
      person("Birch", "probe", 21, 8),
      person("Cedar", "probe", 22, 8),
      wolf(23, 8, "probe"),
      wolf(23, 9, "probe"),
      person("Dara", "probe", 15, 10),
      person("Elm", "probe", 35, 8),
    ]);
    const read = (name: string, id?: number): number[] =>
      (id === undefined
        ? named(world, name)
        : (world.actors.find((a) => a.id === id) as Actor)
      ).memory.slice(0, 10);
    const [wolfA, wolfB] = world.actors.filter((a) => a.kind === "wolf") as [Actor, Actor];
    // threat_friends, friends_near(3), lit_here, threat_lit, threat_moving,
    // friends_near(0), friends_near(-1), friends_near(most negative), friends_near(most positive),
    // lit_enemies.
    // The first wolf's prey is Cedar, with Ash and Birch within four tiles; its
    // packmate is one tile off. Of its enemies, Dara stands in the light.
    expect(read("Wolf", wolfA.id)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 1, 1]);
    expect(read("Wolf", wolfB.id)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 1, 1]);
    // Cedar's enemy is the wolf beside it, with its packmate one tile off. Ash and Birch are
    // within three of Cedar, and Dara is in its region too; Elm, in the hills, is not.
    expect(read("Cedar")).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 3, 0]);
    expect(read("Ash")).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 3, 0]);
    // Dara stands in the light; the nearest wolf is out of it.
    expect(read("Dara")).toEqual([1, 0, 1, 0, 0, 0, 0, 0, 3, 0]);
    // Elm, alone in the hills, has no enemy and nobody near.
    expect(read("Elm")).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(inFirelight(world, 15, 10) && !inFirelight(world, 20, 8)).toBe(true);
  });

  it("lit_enemies counts the enemies in the camp's light, in the reader's region only", () => {
    // Two wolves in the light, one out of it; a resident far out on the road,
    // one in the light, and one in the hills.
    const world = night([], []);
    step(world, [
      wolf(12, 10, "probe"),
      wolf(13, 11, "probe"),
      wolf(25, 3, "probe"),
      person("Ash", "probe", 28, 8),
      person("Birch", "probe", 15, 9),
      person("Elm", "probe", 35, 8),
    ]);
    const lit = (actor: Actor): number => actor.memory[9] as number;
    const [inA, inB, out] = world.actors as [Actor, Actor, Actor];
    expect(inFirelight(world, 12, 10) && inFirelight(world, 13, 11)).toBe(true);
    expect(inFirelight(world, 25, 3)).toBe(false);
    expect(lit(named(world, "Ash"))).toBe(2);
    expect(lit(named(world, "Birch"))).toBe(2);
    expect(lit(named(world, "Elm"))).toBe(0);
    // The wolves see Birch in the light; a wolf does not count itself or its pack.
    for (const w of [inA, inB, out]) expect(lit(w)).toBe(1);
  });

  it("the light is the walkable tiles of camp's region within LIGHT_REACH of camp; threat_lit and threat_moving read the enemy", () => {
    const world = createWorld(ATLAS, 1, PROGRAMS, MONSTERS.kinds);
    const campRegion = regionAt(ATLAS, 14, 9);
    let lit = 0;
    for (let y = ATLAS.top - 2; y < ATLAS.top + ATLAS.height + 2; y++)
      for (let x = ATLAS.left - 2; x < ATLAS.left + ATLAS.width + 2; x++) {
        const expected =
          walkable(ATLAS, x, y) &&
          regionAt(ATLAS, x, y) === campRegion &&
          (x - 14) ** 2 + (y - 9) ** 2 <= LIGHT_REACH ** 2;
        expect(inFirelight(world, x, y), `${x},${y}`).toBe(expected);
        if (expected) lit++;
      }
    expect(lit).toBeGreaterThan(50);
    // Any numbers a program could ask about.
    expect(inFirelight(world, 2147483647, -2147483647)).toBe(false);
    // A wolf out of the light, reading a resident in it that has just set off walking out.
    step(world, [person("Ash", "walker", 14, 6), wolf(14, 3, "probe")]);
    const watcher = world.actors[1] as Actor;
    expect(watcher.memory.slice(3, 5)).toEqual([1, 1]);
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
      "otherwise -> lit_here",
    ])
      expect(compileTactics(source, placeConstants(ATLAS)).ok, source).toBe(false);
  });
});

describe("wolves walk faster and come in packs by night", () => {
  it("a wolf takes 4 ticks a tile, a resident 6, and a goblin 6", () => {
    expect(MONSTERS.kinds.wolf?.step).toBe(4);
    expect(MONSTERS.kinds.goblin?.step).toBe(STEP_TICKS);
    // Each walks six tiles east along its own open row, again and again.
    const world = createWorld(ATLAS, 1, PROGRAMS, MONSTERS.kinds);
    step(world, [
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

  it("the wolf spawn brings a pack of two or three by day and three to five by night", () => {
    expect(WOLF_SPAWNS).toHaveLength(1);
    expect(WOLF_SPAWNS[0]).toMatchObject({ group: 2, most: 3, nightGroup: 3, nightMost: 5 });
    // Over twenty seeds, each pack is two or three by day and three to five by
    // night, and every size turns up.
    const daySizes = new Set<number>();
    const nightSizes = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const day = createWorld(ATLAS, seed, PROGRAMS, MONSTERS.kinds, WOLF_SPAWNS);
      step(day);
      const dark = night(WOLF_SPAWNS, [], seed);
      for (const [world, sizes, shift] of [
        [day, daySizes, "day"],
        [dark, nightSizes, "night"],
      ] as const) {
        expect(world.actors.every((a) => a.kind === "wolf" && a.shift === shift)).toBe(true);
        sizes.add(world.actors.length);
        // They come out together, within GROUP_SPREAD of where they came out, so
        // within four steps of each other.
        for (const a of world.actors)
          for (const b of world.actors) expect(steps(a, b)).toBeLessThanOrEqual(4);
      }
    }
    expect([...daySizes].sort()).toEqual([2, 3]);
    expect([...nightSizes].sort()).toEqual([3, 4, 5]);
  });

  it("a pack comes in only as many as there is room for, never fewer than three", () => {
    // Tiles off the camp's ground and out of the light, south-west of camp.
    const camp = regionAt(ATLAS, 14, 9);
    const dark = night([], []);
    const tiles: { x: number; y: number }[] = [];
    for (let y = 20; y >= 12 && tiles.length < MONSTER_CAPS.night.base; y--)
      for (let x = 0; x < 12 && tiles.length < MONSTER_CAPS.night.base; x++)
        if (
          walkable(ATLAS, x, y) &&
          regionAt(ATLAS, x, y) === camp &&
          terrainOf(ATLAS, x, y) !== "camp" &&
          !inFirelight(dark, x, y)
        )
          tiles.push({ x, y });
    const wolves = (n: number) => tiles.slice(0, n).map((p) => wolf(p.x, p.y));
    // With no residents the night's cap is MONSTER_CAPS.night.base. Two short
    // of it leaves room for two: no pack.
    const full = night(WOLF_SPAWNS, wolves(MONSTER_CAPS.night.base - 2));
    expect(full.actors).toHaveLength(MONSTER_CAPS.night.base - 2);
    for (let t = 0; t < 3 * TICKS_PER_GAME_HOUR; t++) step(full);
    expect(full.actors).toHaveLength(MONSTER_CAPS.night.base - 2);
    // Three short leaves room for three: a pack of three, however many were drawn.
    for (let seed = 1; seed <= 10; seed++) {
      const three = night(WOLF_SPAWNS, wolves(MONSTER_CAPS.night.base - 3), seed);
      for (let t = 0; t < 2 * TICKS_PER_GAME_HOUR; t++) step(three);
      expect(three.actors.length, `seed ${seed}`).toBe(MONSTER_CAPS.night.base);
    }
  });

  it("the new numbers are in the fingerprints, and the old ones hash as before", () => {
    const plain = { wolf: { hp: 24, damage: 8, windup: 8, recovery: 20, reach: 2 } };
    expect(hashKinds(createWorld(ATLAS, 1, {}, plain).kinds)).toBe(
      hashKinds(createWorld(ATLAS, 1, {}, { wolf: { ...plain.wolf, step: STEP_TICKS } }).kinds),
    );
    expect(hashKinds(createWorld(ATLAS, 1, {}, plain).kinds)).not.toBe(
      hashKinds(createWorld(ATLAS, 1, {}, { wolf: { ...plain.wolf, step: 4 } }).kinds),
    );
    const [spawn] = WOLF_SPAWNS as [Spawns[number]];
    const { nightGroup: _, nightMost: __, most: ___, ...bare } = spawn;
    const same = { ...bare, most: spawn.group, nightGroup: spawn.group, nightMost: spawn.group };
    expect(hashSpawns([same])).toBe(hashSpawns([bare]));
    expect(hashSpawns([spawn])).not.toBe(hashSpawns([same]));
    // The fewest and the most each count, by night and by day.
    expect(hashSpawns([{ ...spawn, nightMost: 4 }])).not.toBe(hashSpawns([spawn]));
    expect(hashSpawns([{ ...spawn, nightGroup: 4 }])).not.toBe(hashSpawns([spawn]));
    expect(hashSpawns([{ ...spawn, most: 2 }])).not.toBe(hashSpawns([spawn]));
    expect(hashSpawns([{ ...bare, most: 3 }])).not.toBe(hashSpawns([bare]));
  });

  it("a snapshot holds a wolf partway through a step, and refuses one further into a step than a chilled wolf's", () => {
    const world = night(WOLF_SPAWNS, [person("Ash", "runner", 29, 3)]);
    let moving: Actor | undefined;
    for (let t = 0; t < 200 && !moving; t++) {
      step(world);
      moving = world.actors.find((a) => a.kind === "wolf" && a.moveTicksLeft === 4);
    }
    expect(moving).toBeDefined();
    const saved = snapshot(world);
    expect(restore(saved, ATLAS, PROGRAMS, MONSTERS.kinds, WOLF_SPAWNS)).toEqual(world);
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
        spawns: world.spawns,
      });
      return JSON.stringify(data);
    };
    expect(
      restore(rehash(6), ATLAS, PROGRAMS, MONSTERS.kinds, WOLF_SPAWNS).actors[index],
    ).toMatchObject({ moveTicksLeft: 6 });
    expect(() => restore(rehash(7), ATLAS, PROGRAMS, MONSTERS.kinds, WOLF_SPAWNS)).toThrow(
      /damaged/,
    );
  });
});

describe("a night hunt", () => {
  // At the meadow's edge, 19 tiles' walk from the light, on the round the night pack walks.
  const FAR = { x: 29, y: 3 };
  // South-west of camp, 8 tiles' walk from the light, with the den behind it.
  const NEAR = { x: 9, y: 17 };
  // A group standing at the meadow's edge, and a pack of three on the road five tiles south of it.
  const GROUP = [FAR, { x: 28, y: 3 }, { x: 29, y: 2 }, { x: 28, y: 2 }, { x: 27, y: 3 }];
  const PACK = [wolf(27, 8), wolf(28, 8), wolf(28, 9)];
  // Two places by the fire, on the camp's ground.
  const FIRESIDE = [
    { x: 14, y: 8 },
    { x: 13, y: 8 },
  ];

  it("a lone resident far out is caught and downed by the pack", () => {
    const world = night(WOLF_SPAWNS, [person("Ash", "runner", FAR.x, FAR.y)]);
    expect(walkToLight(world, FAR.x, FAR.y)).toBeGreaterThanOrEqual(19);
    const ash = named(world, "Ash");
    const wolves = world.actors.filter((a) => a.kind === "wolf").map((a) => a.id);
    expect(wolves.length).toBeGreaterThanOrEqual(3);
    const { events } = hunt(world, 1200, "Ash");
    const down = events.find((e) => e.type === "down" && e.actor === ash.id);
    expect(down).toBeDefined();
    if (down?.type !== "down") return;
    expect(wolves).toContain(down.by);
    expect(inFirelight(world, down.x, down.y)).toBe(false);
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
    const five = night([], [...GROUP.map((p, i) => person(`R${i}`, "post", p.x, p.y)), ...PACK]);
    const left = hunt(five, 3000, "R0");
    // The pack came near enough to see them, and turned away.
    expect(left.closest).toBeLessThanOrEqual(10);
    expect(decided(five, left.events, "back off")).toBeGreaterThan(0);
    expect(left.events.filter((e) => e.type === "hit" || e.type === "down")).toEqual([]);
    // Three standing in the same place, against the same three wolves.
    const three = night(
      [],
      [...GROUP.slice(0, 3).map((p, i) => person(`R${i}`, "post", p.x, p.y)), ...PACK],
    );
    const attacked = hunt(three, 1200, "R0");
    expect(attacked.events.some((e) => e.type === "down" && e.kind === ADVENTURER)).toBe(true);
  });

  it("a resident 8 tiles from the light, with a pair 8 tiles behind it, gets home to a camp that outnumbers the pair", () => {
    const world = night(
      [],
      [
        person("Ash", "runner", NEAR.x, NEAR.y),
        ...FIRESIDE.map((p, i) => person(`Camp${i}`, "post", p.x, p.y)),
        wolf(2, 16),
        wolf(3, 15),
      ],
    );
    expect(walkToLight(world, NEAR.x, NEAR.y)).toBe(8);
    const ash = named(world, "Ash");
    for (const w of world.actors.filter((a) => a.kind === "wolf")) expect(steps(w, ash)).toBe(8);
    const { events, home, litHits } = hunt(world, 600, "Ash");
    expect(home).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "down")).toBe(false);
    expect(litHits).toBe(0);
    // The wolves gave chase, and at the light's edge they stopped.
    expect(decided(world, events, "hunt")).toBeGreaterThan(0);
    expect(decided(world, events, "pace the edge")).toBeGreaterThan(0);
  });

  it("a pack that outnumbers the residents in the light follows its prey into it", () => {
    // The same chase, with three wolves behind Ash and one resident by the fire.
    const world = night(
      [],
      [
        person("Ash", "runner", NEAR.x, NEAR.y),
        person("Camp0", "runner", FIRESIDE[0]?.x ?? 0, FIRESIDE[0]?.y ?? 0),
        wolf(2, 16),
        wolf(3, 15),
        wolf(2, 15),
      ],
    );
    const { events, home, litHits } = hunt(world, 900, "Ash");
    expect(home).toBeGreaterThan(0);
    // Blows land on residents standing in the light, and someone is downed.
    expect(litHits).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "down" && e.kind === ADVENTURER)).toBe(true);
  });

  it("a hunt saved partway resumes to the same world", () => {
    const begin = (): World => night(WOLF_SPAWNS, [person("Ash", "runner", FAR.x, FAR.y)]);
    const straight = begin();
    for (let t = 0; t < 400; t++) step(straight);
    const half = begin();
    for (let t = 0; t < 150; t++) step(half);
    const resumed = restore(snapshot(half), ATLAS, PROGRAMS, MONSTERS.kinds, WOLF_SPAWNS);
    for (let t = 0; t < 250; t++) step(resumed);
    expect(hashWorld(resumed)).toBe(hashWorld(straight));
  });
});

describe("a resident mending at camp after a down", () => {
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
    const world = createWorld(ATLAS, 1, PROGRAMS, MONSTERS.kinds);
    step(world, [person("Ash", "post", 20, 8), goblin(19, 8, "striker")]);
    const ash = named(world, "Ash");
    expect(mending(ash)).toBe(false);
    let downed = -1;
    for (let t = 0; t < 400 && downed < 0; t++)
      if (step(world).some((e) => e.type === "down" && e.actor === ash.id)) downed = world.tick;
    expect(downed).toBeGreaterThan(0);
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
    const world = night([], [person("Ash", "post", 13, 10)]);
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
    // The wolf, beside Ash, takes Elm far out on the road for its nearest
    // enemy, sees nobody standing in the light, and one resident mending there.
    // threat_friends, lit_here, threat_lit, lit_enemies, lit_mending, threat_distance:
    const { memory } = watcher;
    expect(steps(watcher, ash)).toBe(1);
    expect([memory[0], memory[2], memory[3], memory[9], memory[10], memory[11]]).toEqual([
      0,
      1,
      0,
      0,
      1,
      steps(watcher, named(world, "Elm")),
    ]);
    // Elm, a resident, counts nobody near it but sees Ash mending.
    expect([named(world, "Elm").memory[8], named(world, "Elm").memory[10]]).toEqual([0, 1]);
    // Up again, it is struck.
    const after: WorldEvent[] = [];
    for (let t = 0; t < 40; t++) after.push(...step(world));
    expect(
      after.some((e) => e.type === "hit" && e.actor === striker.id && e.target === ash.id),
    ).toBe(true);
  });

  it("over a night with a pack, one or two residents by the fire are downed at most once a half hour each", () => {
    const FIRE = [
      { x: 14, y: 8 },
      { x: 13, y: 8 },
    ];
    let downs = 0;
    for (const residents of [1, 2])
      for (let seed = 1; seed <= 3; seed++) {
        const world = night(
          WOLF_SPAWNS,
          FIRE.slice(0, residents).map((p, i) => person(`R${i}`, "post", p.x, p.y)),
          seed,
        );
        const at = new Map<number, number[]>();
        for (let t = 0; t < 11 * TICKS_PER_GAME_HOUR; t++) {
          const resting = new Set(world.actors.filter(mending).map((a) => a.id));
          for (const e of step(world)) {
            if (e.type === "hit") expect(resting.has(e.target)).toBe(false);
            if (e.type === "down" && e.kind === ADVENTURER)
              at.set(e.actor, [...(at.get(e.actor) ?? []), e.tick]);
          }
        }
        const where = `${residents} by the fire, seed ${seed}`;
        for (const ticks of at.values()) {
          downs += ticks.length;
          expect(ticks.length, where).toBeLessThanOrEqual(12);
          for (let i = 1; i < ticks.length; i++)
            expect((ticks[i] as number) - (ticks[i - 1] as number), where).toBeGreaterThanOrEqual(
              TICKS_PER_GAME_HOUR / 2,
            );
        }
      }
    // The packs did come into the light.
    expect(downs).toBeGreaterThan(6);
  }, 30_000);
});

describe("goblins in the camp's light", () => {
  // On the road east of camp, just out of the light, so their round is the
  // river and the meadow; and the residents just inside its edge.
  const GOBLINS = [
    { x: 19, y: 8 },
    { x: 20, y: 9 },
    { x: 20, y: 8 },
  ];
  const EDGE = [
    { x: 18, y: 8 },
    { x: 18, y: 9 },
    { x: 17, y: 9 },
    { x: 17, y: 8 },
  ];
  /** `residents` standing just inside the light and three goblins put in just out of it, for 300 ticks. */
  function visit(residents: number, dark: boolean) {
    const world = createWorld(ATLAS, 1, PROGRAMS, MONSTERS.kinds);
    if (dark) world.tick = NIGHTFALL + TICKS_PER_GAME_HOUR;
    step(
      world,
      EDGE.slice(0, residents).map((p, i) => person(`R${i}`, "post", p.x, p.y)),
    );
    const log = step(
      world,
      GOBLINS.map((p) => ({
        type: "spawn",
        name: "Goblin",
        program: "goblin",
        kind: "goblin",
        ...p,
      })),
    );
    const goblins = world.actors.filter((a) => a.kind === "goblin");
    expect(goblins).toHaveLength(3);
    for (const g of goblins) expect(inFirelight(world, g.x, g.y)).toBe(false);
    const residentsThere = world.actors.filter((a) => a.kind === ADVENTURER);
    expect(residentsThere).toHaveLength(residents);
    for (const r of residentsThere) expect(inFirelight(world, r.x, r.y)).toBe(true);
    // The longest any goblin stayed in the light without leaving it.
    let longest = 0;
    const since = new Map<number, number>();
    for (let t = 0; t < 300; t++) {
      log.push(...step(world));
      for (const g of goblins) {
        if (!inFirelight(world, g.x, g.y) || !world.actors.includes(g)) since.delete(g.id);
        else since.set(g.id, (since.get(g.id) ?? 0) + 1);
        longest = Math.max(longest, since.get(g.id) ?? 0);
      }
    }
    const bites = log.filter((e) => e.type === "hit" && goblins.some((g) => g.id === e.actor));
    return { bites: bites.length, longest };
  }

  it("by night three goblins go into the light after one or two residents, and don't stay in it for three or more", () => {
    for (const residents of [1, 2]) {
      const { bites, longest } = visit(residents, true);
      expect(bites, `${residents}`).toBeGreaterThan(0);
      expect(longest, `${residents}`).toBeGreaterThan(20);
    }
    for (const residents of [3, 4]) {
      const { bites, longest } = visit(residents, true);
      expect(bites, `${residents}`).toBe(0);
      // A step of its round may clip the light's edge; it walks out at once.
      expect(longest, `${residents}`).toBeLessThanOrEqual(10);
    }
  });

  it("by day they don't stay in it, whoever is there", () => {
    for (const residents of [1, 2, 4]) {
      const { bites, longest } = visit(residents, false);
      expect(bites, `${residents}`).toBe(0);
      expect(longest, `${residents}`).toBeLessThanOrEqual(10);
    }
  });
});
