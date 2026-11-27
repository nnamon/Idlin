import {
  type Actor,
  compileBots,
  createWorld,
  type Mark,
  placeConstants,
  step,
  type World,
} from "@idlin/sim";
import { expect, it } from "vitest";
import { rawWorld, shippedWorld } from "../../sim/src/testing.ts";
import { type Fight, type News, NO_FIGHT } from "./fight.ts";
import { TILE } from "./ground.ts";
import {
  awayFrom,
  campRegion,
  EDGE_FADE,
  edgeFade,
  fightOn,
  regionNames,
  regionView,
  rosterOf,
} from "./view.ts";

// The shipped world: the camp's region at (0, 0), the pinewood west of it at
// (-30, 0), joined by the exit (-1, 7) to (0, 7), and the hills east of it at (30, 0).
const atlas = shippedWorld();
const [CAMP, PINE, HILLS] = [0, 1, 2];

it("shows the camp's region: who is in it, in its own tile coordinates", () => {
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
  const shown = campRegion(world);
  expect(shown).toBe(CAMP);
  expect(atlas.regions[shown]?.map.name).toBe("camp");
  const view = regionView(world, shown);
  expect(view.actors.map((a) => [a.name, a.x, a.y])).toEqual([
    ["Ash", 0, 7],
    ["Bryn", 14, 9],
  ]);
  // Another region is moved into its own coordinates.
  expect(regionView(world, HILLS).actors.map((a) => [a.name, a.x, a.y])).toEqual([["Dara", 1, 8]]);
  expect(regionView(world, PINE).actors.map((a) => [a.name, a.x, a.y])).toEqual([["Cole", 29, 7]]);
  // The world itself is left as it was.
  expect(world.actors.map((a) => a.x)).toEqual([0, 14, -1, 31]);

  // Ash steps out, and is drawn for the length of the step: walking off the map's edge.
  step(world);
  const ash = world.actors[0];
  expect([ash?.x, ash?.fromX]).toEqual([-1, 0]);
  expect(ash?.moveTicksLeft).toBeGreaterThan(0);
  const leaving = regionView(world, shown).actors;
  expect(leaving.map((a) => [a.name, a.x, a.fromX])).toEqual([
    ["Ash", -1, 0],
    ["Bryn", 14, 14],
  ]);
  // Nothing of the path left to draw is off this map.
  expect(leaving[0]?.path).toEqual([]);
  while ((world.actors[0]?.moveTicksLeft ?? 0) > 0) step(world);
  expect(regionView(world, shown).actors.map((a) => a.name)).toEqual(["Bryn"]);
  // The page still lists all four.
  expect(rosterOf(world).map((a) => a.name)).toEqual(["Ash", "Bryn", "Cole", "Dara"]);
});

it("cuts a path where it leaves the region, so a route ends at the exit", () => {
  const programs = compileBots({ out: "otherwise -> walk_to(pinewood)" }, placeConstants(atlas));
  const world = createWorld(atlas, 1, programs);
  step(world, [{ type: "spawn", name: "Ash", program: "out", x: 14, y: 9 }]);
  step(world);
  const shown = campRegion(world);
  const [actor] = world.actors;
  // In the world the path runs on into the pinewood.
  expect(actor?.path.some((p) => p.x < 0)).toBe(true);
  const [seen] = regionView(world, shown).actors;
  const path = seen?.path ?? [];
  expect(path.length).toBeGreaterThan(0);
  expect(path.every((p) => p.x >= 0 && p.x < 30 && p.y >= 0 && p.y < 21)).toBe(true);
  // It ends on the camp's side of the exit to the pinewood.
  expect(path[path.length - 1]).toEqual({ x: 0, y: 7 });
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
  const at = (): [string, string][] => {
    const away = awayFrom(world, regionView(world, CAMP), names);
    return world.actors.flatMap((a) =>
      away.has(a.id) ? [[a.name, away.get(a.id) as string]] : [],
    );
  };
  expect(at()).toEqual([
    ["Dara", "the Hills"],
    ["Elm", "the Lower River"],
  ]);
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

// The fight is read off worlds made by hand, as in fight.test.ts, placed on the
// shipped atlas: the camp's region runs from x 0 to 29, and its west exit
// joins (-1, 7) in the pinewood to (0, 7) in the camp.
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
 * The fight on the camp's map after a run of ticks from tick 1, with every
 * line of news, and everything that fell or went home on it at any tick.
 */
function watch(ticks: readonly { actors: Actor[]; marks?: Mark[] }[]): {
  all: Fight;
  shown: Fight;
  news: News[];
  fell: Fight["fallen"][number][];
  went: Fight["gone"][number][];
} {
  let all = NO_FIGHT;
  let shown = NO_FIGHT;
  const news: News[] = [];
  const fell = new Map<number, Fight["fallen"][number]>();
  const went = new Map<number, Fight["gone"][number]>();
  ticks.forEach(({ actors, marks = [] }, i) => {
    const world = { atlas, tick: i + 1, actors, marks, kinds: KINDS } as unknown as World;
    ({ all, shown } = fightOn(all, world, CAMP));
    news.push(...shown.news);
    for (const f of shown.fallen) fell.set(f.id, f);
    for (const g of shown.gone) went.set(g.id, g);
  });
  return { all, shown, news, fell: [...fell.values()], went: [...went.values()] };
}

/** Ticks of `actor` stepping from where it is one tile west, then standing there. */
const stepWest = (actor: Actor, after: number): Actor[] =>
  Array.from({ length: 6 + after }, (_, i) => ({
    ...actor,
    x: actor.x - 1,
    fromX: i < 6 ? actor.x : actor.x - 1,
    moveTicksLeft: Math.max(0, 5 - i),
  }));

it("does not take a monster walking off the map for killed or gone home", () => {
  expect(atlas.regions[CAMP]?.map.name).toBe("camp");
  // Ash's blow lands on the wolf at the camp's west exit, and the wolf walks
  // on into the pinewood, hurt.
  const marks = [{ x: 0, y: 7, by: 1 }];
  const ash = someone({ x: 1 });
  const ticks = [
    { actors: [someone({ x: 1, windup: 1 }), wolf({ x: 0 })], marks },
    ...stepWest(wolf({ x: 0, hp: 20 }), 6).map((w) => ({ actors: [ash, w] })),
  ];
  const { shown, news, fell, went } = watch(ticks);
  // The blow is seen to land, on the camp's side of the exit.
  expect(shown.floaters).toEqual([{ since: 2, x: 0, y: 7, damage: 4, order: 0 }]);
  expect(fell).toEqual([]);
  expect(went).toEqual([]);
  expect(news.filter((line) => line.text.includes("killed"))).toEqual([]);
  // Killed for real, it falls where it stood.
  const killed = watch([
    { actors: [someone({ x: 1, windup: 1 }), wolf({ x: 0, hp: 4 })], marks },
    { actors: [ash] },
  ]);
  expect(killed.shown.fallen.map((f) => [f.kind, f.x, f.y])).toEqual([["wolf", 0, 7]]);
  expect(killed.news.map((line) => line.text)).toEqual(["Ash killed a wolf"]);
});

it("does not take a resident walking off the map for downed, and counts one downed off the map", () => {
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
  expect(away.shown.scratches.map((s) => [s.x, s.y])).toEqual([[0, 7]]);
  expect(away.shown.downs.size).toBe(0);
  expect(away.fell).toEqual([]);
  expect(away.news).toEqual([]);

  // In the pinewood a wolf downs her, and she is carried to camp: the page
  // calls her downed and the news says so, but what she leaves where she fell
  // is not on this map.
  const deep = { ...(out.at(-1) as Actor), x: -10, fromX: -10 };
  const downed = watch([
    { actors: [deep, wolf({ id: 3, x: -9, windup: 1 })], marks: [{ x: -10, y: 7, by: 3 }] },
    { actors: [someone({ x: 14, y: 9, wait: 150 }), wolf({ id: 3, x: -9, recover: 20 })] },
  ]);
  expect(downed.shown.downs.has(1)).toBe(true);
  expect(downed.news.map((line) => line.text)).toEqual(["Ash was downed by a wolf"]);
  expect(downed.all.fallen.map((f) => [f.x, f.y])).toEqual([[-10, 7]]);
  expect(downed.shown.fallen).toEqual([]);
  expect(downed.shown.floaters).toEqual([]);
});
