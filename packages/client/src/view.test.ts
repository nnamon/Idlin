import {
  type Actor,
  type Blow,
  compileBots,
  createWorld,
  type Mark,
  placeConstants,
  step,
  type World,
} from "@idlin/sim";
import { expect, it } from "vitest";
import { rawWorld, shippedWorld } from "../../sim/src/testing.ts";
import { type Fight, type News, NO_FIGHT, nextFight } from "./fight.ts";
import { TILE } from "./ground.ts";
import {
  awayFrom,
  campRegion,
  EDGE_FADE,
  edgeFade,
  GROUP_REACH,
  inWindow,
  monsterGroups,
  regionNames,
  rosterOf,
  viewSize,
  windowView,
} from "./view.ts";

// The shipped world: the camp's region at (0, 0), the pinewood west of it at
// (-30, 0), joined by the exit (-1, 7) to (0, 7), and the hills east of it at (30, 0).
const atlas = shippedWorld();
const CAMP = 0;
const CAMP_WINDOW = { x: 0, y: 0, width: 30, height: 21 };

it("shows who is in the window, where they are in the world", () => {
  const programs = compileBots(
    { out: "otherwise -> walk_to(pinewood)", stay: "otherwise -> wait(600)" },
    placeConstants(atlas),
  );
  const world = createWorld(atlas, 1, programs);
  // Ash at the camp's west exit heads into the pinewood, Bryn stands at camp,
  // Cole is in the pinewood across the exit, and Dara in the hills.
  step(world, [
    { type: "spawn", name: "Ash", program: "out", x: 0, y: 7 },
    { type: "spawn", name: "Bryn", program: "stay", x: 14, y: 9 },
    { type: "spawn", name: "Cole", program: "stay", x: -1, y: 7 },
    { type: "spawn", name: "Dara", program: "stay", x: 31, y: 8 },
  ]);
  expect(campRegion(world)).toBe(CAMP);
  expect(atlas.regions[CAMP]?.map.name).toBe("camp");
  // The window is as big as the camp's map.
  expect(viewSize(atlas, CAMP)).toEqual({ width: 30, height: 21 });
  const names = (window: typeof CAMP_WINDOW) =>
    windowView(world, window).actors.map((a) => [a.name, a.x, a.y]);
  expect(names(CAMP_WINDOW)).toEqual([
    ["Ash", 0, 7],
    ["Bryn", 14, 9],
  ]);
  // Over the hills and the pinewood, in world coordinates as they are.
  expect(names({ ...CAMP_WINDOW, x: 30 })).toEqual([["Dara", 31, 8]]);
  expect(names({ ...CAMP_WINDOW, x: -30 })).toEqual([["Cole", -1, 7]]);
  // Partway through a drift west, a tile partly in the window counts: Cole
  // comes in at its left edge while Bryn is still in it.
  expect(names({ ...CAMP_WINDOW, x: -15.5 }).map(([name]) => name)).toEqual([
    "Ash",
    "Bryn",
    "Cole",
  ]);
  expect(names({ ...CAMP_WINDOW, x: -16 }).map(([name]) => name)).toEqual(["Ash", "Cole"]);
  // The world itself is left as it was.
  expect(world.actors.map((a) => a.x)).toEqual([0, 14, -1, 31]);

  // Ash steps out, and is drawn for the length of the step: walking off the map's edge.
  step(world);
  const ash = world.actors[0];
  expect([ash?.x, ash?.fromX]).toEqual([-1, 0]);
  expect(ash?.moveTicksLeft).toBeGreaterThan(0);
  expect(windowView(world, CAMP_WINDOW).actors.map((a) => [a.name, a.x, a.fromX])).toEqual([
    ["Ash", -1, 0],
    ["Bryn", 14, 14],
  ]);
  while ((world.actors[0]?.moveTicksLeft ?? 0) > 0) step(world);
  expect(windowView(world, CAMP_WINDOW).actors.map((a) => a.name)).toEqual(["Bryn"]);
  // The page still lists all four.
  expect(rosterOf(world).map((a) => a.name)).toEqual(["Ash", "Bryn", "Cole", "Dara"]);
});

it("takes a tile as in the window if any of it is", () => {
  const window = { x: 2.25, y: -0.5, width: 30, height: 21 };
  expect(inWindow(window, 2, 0)).toBe(true);
  expect(inWindow(window, 1, 0)).toBe(false);
  expect(inWindow(window, 32, 20)).toBe(true);
  expect(inWindow(window, 33, 0)).toBe(false);
  expect(inWindow(window, 5, -1)).toBe(true);
  expect(inWindow(window, 5, 21)).toBe(false);
});

it("lists every resident on the page and no monster", () => {
  const programs = compileBots({ stay: "otherwise -> wait(600)" }, placeConstants(atlas));
  const world = createWorld(atlas, 1, programs);
  step(world, [
    { type: "spawn", name: "Ash", program: "stay", x: -17, y: 10 },
    { type: "spawn", name: "Bryn", program: "stay", x: 14, y: 9 },
  ]);
  const ash = world.actors[0];
  if (!ash) throw new Error("no Ash");
  // A resident away is listed; the same actor as a monster is not.
  expect(rosterOf(world).map((a) => a.name)).toEqual(["Ash", "Bryn"]);
  world.actors[0] = { ...ash, kind: "wolf" };
  expect(rosterOf(world).map((a) => a.name)).toEqual(["Bryn"]);
});

it("names the region each resident off the map is in, and nobody on it", () => {
  const names = regionNames(atlas, rawWorld().maps);
  expect(names).toEqual(["Lantern Camp", "the Pinewood", "the Hills", "the Lower River"]);
  // A map file without a title is called by its name.
  expect(regionNames(atlas, {})).toEqual(["camp", "pinewood", "hills", "lower-river"]);

  const programs = compileBots(
    { out: "otherwise -> walk_to(pinewood)", stay: "otherwise -> wait(600)" },
    placeConstants(atlas),
  );
  const world = createWorld(atlas, 1, programs);
  step(world, [
    { type: "spawn", name: "Ash", program: "out", x: 0, y: 7 },
    { type: "spawn", name: "Bryn", program: "stay", x: 14, y: 9 },
    { type: "spawn", name: "Dara", program: "stay", x: 31, y: 8 },
    { type: "spawn", name: "Elm", program: "stay", x: 12, y: 25 },
  ]);
  const at = (window = CAMP_WINDOW): [string, string][] => {
    const away = awayFrom(world, windowView(world, window), names);
    return world.actors.flatMap((a) =>
      away.has(a.id) ? [[a.name, away.get(a.id) as string]] : [],
    );
  };
  expect(at()).toEqual([
    ["Dara", "the Hills"],
    ["Elm", "the Lower River"],
  ]);
  // With the view on the hills, the camp's residents are the ones away.
  expect(at({ ...CAMP_WINDOW, x: 30 }).map(([name]) => name)).toEqual(["Ash", "Bryn", "Elm"]);
  // Ash, still drawn while stepping off the map, is not away until the step is done.
  step(world);
  expect(world.actors[0]?.x).toBe(-1);
  expect(at().map(([name]) => name)).toEqual(["Dara", "Elm"]);
  while ((world.actors[0]?.moveTicksLeft ?? 0) > 0) step(world);
  expect(at()[0]).toEqual(["Ash", "the Pinewood"]);
  // A monster off the map is not on the page, so it is not away either.
  world.actors[2] = { ...(world.actors[2] as Actor), kind: "wolf" };
  expect(at().map(([name]) => name)).toEqual(["Ash", "Elm"]);
});

it("fades a figure out over the last tile it walks off the map, and only then", () => {
  const width = 30 * TILE;
  const height = 21 * TILE;
  // Feet at a tile's middle across and near its foot down, as the scene draws them.
  const feet = (x: number, y: number): [number, number] => [(x + 0.5) * TILE, (y + 1) * TILE - 4];
  // Anywhere on the map, edge tiles too, it is drawn in full.
  for (const [x, y] of [
    [0, 0],
    [29, 20],
    [0, 7],
    [14, 9],
    [12, 20],
  ] as const)
    expect(edgeFade(...feet(x, y), width, height), `${x},${y}`).toBe(1);
  // A step off any edge takes it to nothing before the step is done.
  for (const [x, y] of [
    [-1, 7],
    [30, 8],
    [12, 21],
    [5, -1],
  ] as const)
    expect(edgeFade(...feet(x, y), width, height), `${x},${y}`).toBe(0);
  // Halfway across the fade, half drawn; and it only falls as the figure goes out.
  const [x0, y0] = feet(0, 7);
  expect(edgeFade(x0 - EDGE_FADE / 2, y0, width, height)).toBeCloseTo(0.5);
  let last = 1;
  for (let x = x0; x > x0 - TILE; x -= 4) {
    const fade = edgeFade(x, y0, width, height);
    expect(fade).toBeLessThanOrEqual(last);
    last = fade;
  }
  expect(last).toBe(0);
});

it("marks each group of monsters once, at its middle, and keeps groups apart by region", () => {
  const wolf = (id: number, x: number, y: number): Actor =>
    ({ id, name: "Wolf", kind: "wolf", x, y }) as Actor;
  const ash = { id: 9, name: "Ash", kind: "adventurer", x: 5, y: 5 } as Actor;
  const world = (actors: Actor[]) => ({ atlas, actors }) as unknown as World;
  // Three wolves together, a resident among them, and one far off: two groups.
  expect(
    monsterGroups(world([wolf(1, 4, 4), ash, wolf(2, 6, 4), wolf(3, 5, 7), wolf(4, 25, 15)])),
  ).toEqual([
    { x: 5, y: 5 },
    { x: 25, y: 15 },
  ]);
  // Near enough by steps, but either side of the pinewood exit: two groups.
  expect(monsterGroups(world([wolf(1, 0, 7), wolf(2, -1, 7)]))).toHaveLength(2);
  // One that comes between two groups joins them into one.
  const far = 2 * GROUP_REACH;
  expect(
    monsterGroups(world([wolf(1, 2, 10), wolf(2, 2 + far, 10), wolf(3, 2 + GROUP_REACH, 10)])),
  ).toEqual([{ x: 2 + GROUP_REACH, y: 10 }]);
  expect(monsterGroups(world([ash]))).toEqual([]);
});

// The fight is read off whole worlds made by hand, as in fight.test.ts, placed
// on the shipped atlas: the camp's region runs from x 0 to 29, and its west
// exit joins (-1, 7) in the pinewood to (0, 7) in the camp.
const KINDS = { wolf: { hp: 24, damage: 8, windup: 8, recovery: 20, reach: 2 } };
const someone = (over: Partial<Actor>): Actor =>
  ({
    id: 1,
    name: "Ash",
    kind: "adventurer",
    x: 2,
    y: 7,
    fromX: over.x ?? 2,
    fromY: over.y ?? 7,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    hp: 20,
    windup: 0,
    recover: 0,
    ...over,
    // Cast: the fight reads only the fields above.
  }) as Actor;
const wolf = (over: Partial<Actor>): Actor =>
  someone({ id: 2, name: "Wolf", kind: "wolf", hp: 24, ...over });

/**
 * The fight after a run of ticks from tick 1, with every line of news, and
 * everything that fell or went home at any tick.
 */
function watch(ticks: readonly { actors: Actor[]; marks?: Mark[]; blows?: Blow[] }[]): {
  fight: Fight;
  news: News[];
  fell: Fight["fallen"][number][];
  went: Fight["gone"][number][];
} {
  let fight = NO_FIGHT;
  const news: News[] = [];
  const fell = new Map<number, Fight["fallen"][number]>();
  const went = new Map<number, Fight["gone"][number]>();
  ticks.forEach(({ actors, marks = [], blows = [] }, i) => {
    const world = { atlas, tick: i + 1, actors, marks, kinds: KINDS } as unknown as World;
    fight = nextFight(fight, world, blows);
    news.push(...fight.news);
    for (const f of fight.fallen) fell.set(f.id, f);
    for (const g of fight.gone) went.set(g.id, g);
  });
  return { fight, news, fell: [...fell.values()], went: [...went.values()] };
}

/** Ticks of `actor` stepping from where it is one tile west, then standing there. */
const stepWest = (actor: Actor, after: number): Actor[] =>
  Array.from({ length: 6 + after }, (_, i) => ({
    ...actor,
    x: actor.x - 1,
    fromX: i < 6 ? actor.x : actor.x - 1,
    moveTicksLeft: Math.max(0, 5 - i),
  }));

it("does not take a monster walking into the next region for killed or gone home", () => {
  // Ash's blow lands on the wolf at the camp's west exit, and the wolf walks
  // on into the pinewood, hurt.
  const marks = [{ x: 0, y: 7, by: 1 }];
  const ash = someone({ x: 1 });
  const struck = { by: 1, target: 2, amount: 4, crit: false, type: "physical" } as const;
  const ticks = [
    { actors: [someone({ x: 1, windup: 1 }), wolf({ x: 0 })], marks },
    ...stepWest(wolf({ x: 0, hp: 20 }), 6).map((w, i) => ({
      actors: [ash, w],
      blows: i === 0 ? [struck] : [],
    })),
  ];
  const { fight, news, fell, went } = watch(ticks);
  // The blow is seen to land, on the camp's side of the exit.
  expect(fight.floaters).toEqual([{ since: 2, x: 0, y: 7, damage: 4, order: 0 }]);
  expect(fell).toEqual([]);
  expect(went).toEqual([]);
  expect(news.filter((line) => line.text.includes("killed"))).toEqual([]);
  // Killed for real, it falls where it stood.
  const killed = watch([
    { actors: [someone({ x: 1, windup: 1 }), wolf({ x: 0, hp: 4 })], marks },
    { actors: [ash], blows: [struck] },
  ]);
  expect(killed.fight.fallen.map((f) => [f.kind, f.x, f.y])).toEqual([["wolf", 0, 7]]);
  expect(killed.news.map((line) => line.text)).toEqual(["Ash killed a wolf"]);
});

it("does not take a resident walking into the next region for downed, and counts one downed there", () => {
  // Ash, nearly out, hops off the tile a wolf marked, out through the exit,
  // and the blow lands on nothing.
  const marks = [{ x: 0, y: 7, by: 2 }];
  const ash = someone({ x: 0, hp: 3 });
  const out = stepWest(ash, 20);
  const ticks = [
    { actors: [ash, wolf({ x: 1, windup: 2 })], marks },
    { actors: [out[0] as Actor, wolf({ x: 1, windup: 1 })], marks },
    ...out.slice(1).map((a) => ({ actors: [a, wolf({ x: 1, recover: 20 })] })),
  ];
  const away = watch(ticks);
  expect(away.fight.scratches.map((s) => [s.x, s.y])).toEqual([[0, 7]]);
  expect(away.fight.downs.size).toBe(0);
  expect(away.fell).toEqual([]);
  expect(away.news).toEqual([]);

  // In the pinewood a wolf downs her, and she is carried to camp: she is
  // downed, the news says so, and what she leaves lies where she fell, in
  // the pinewood, where the map draws it when it shows the pinewood.
  const deep = { ...(out.at(-1) as Actor), x: -10, fromX: -10 };
  const downed = watch([
    { actors: [deep, wolf({ id: 3, x: -9, windup: 1 })], marks: [{ x: -10, y: 7, by: 3 }] },
    {
      actors: [someone({ x: 14, y: 9, wait: 150 }), wolf({ id: 3, x: -9, recover: 20 })],
      blows: [{ by: 3, target: 1, amount: 8, crit: false, type: "physical" }],
    },
  ]);
  expect(downed.fight.downs.has(1)).toBe(true);
  expect(downed.news.map((line) => line.text)).toEqual(["Ash was downed by a wolf"]);
  expect(downed.fight.fallen.map((f) => [f.x, f.y])).toEqual([[-10, 7]]);
});
