// Shared by tests only: loads the shipped programs and items from content/,
// the camp world's programs, monsters and map that the older mechanics tests
// are written on (fixtures/), and the large crowded map the tick is timed on.
import { readdirSync, readFileSync } from "node:fs";
import { linked, tileAt, walkable } from "./atlas.ts";
import { emptyBag, emptyBank } from "./bag.ts";
import { type Cycle, RAMP_DOWN } from "./cycle.ts";
import { deckMap } from "./deck.ts";
import type { Rank } from "./hit.ts";
import { type ItemTable, loadItems } from "./items.ts";
import type { Biome, CitySize, SizeClass } from "./landing.ts";
import {
  NEIGHBOURS,
  type Point,
  parseMap,
  placeConstants,
  TERRAINS,
  type Terrain,
  type TileMap,
} from "./map.ts";
import { loadMonsters, type Monsters } from "./monsters.ts";
import { NODE_KINDS } from "./nodes.ts";
import { freshOrders } from "./orders.ts";
import { inPocket } from "./packs.ts";
import { createRng, nextInt, type Rng } from "./rng.ts";
import { noXp, SKILLS, XP_TABLE } from "./skills.ts";
import { noStatus } from "./status.ts";
import { compileBots } from "./tactics.ts";
import { MEMORY_SLOTS, type Program } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  addMonster,
  createCity,
  createWorld,
  type Input,
  kindOf,
  type Programs,
  step,
  type World,
} from "./world.ts";

const content = (path: string): URL => new URL(`../../../content/${path}`, import.meta.url);
const fixture = (path: string): URL => new URL(`fixtures/${path}`, import.meta.url);

/**
 * The map the world was before it had regions, kept as a fixture: a world of
 * one map, with every place the camp's programs and monsters name, and a
 * `hold` on the camp's tile for the shipped Deckhand.
 */
export const rawFirstLight = (): Record<string, unknown> =>
  JSON.parse(readFileSync(fixture("first-light.json"), "utf8"));

export const firstLight = (): TileMap => parseMap(rawFirstLight());

/**
 * The camp: the shipped world's first region when it had regions, kept as a
 * fixture for the tests written on it. It has the camp's fire, bank and
 * trees, every place the camp's programs and monsters name, and a `hold` on
 * the camp's tile for the shipped Deckhand.
 */
export const rawCamp = (): Record<string, unknown> =>
  JSON.parse(readFileSync(fixture("camp.json"), "utf8"));

export const campMap = (): TileMap => parseMap(rawCamp());

/** Every file in a folder with the given extension, by name without it. */
const files = (folder: URL, extension: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(folder)
      .filter((file) => file.endsWith(extension))
      .map((file) => [
        file.slice(0, -extension.length),
        readFileSync(new URL(file, folder), "utf8"),
      ]),
  );

/** Every shipped program's source, by file name without the extension. */
export const botSources = (): Record<string, string> => files(content("bots/"), ".tac");

/**
 * The camp world's programs (homebody, riverwalker, wanderer, and the
 * Deckhand as the camp ran it), which only tests run now.
 */
export const campBotSources = (): Record<string, string> => files(fixture("bots/"), ".tac");

/** The shipped programs, compiled with the places of `ground`: the first city's deck unless told otherwise. */
export const shippedPrograms = (ground: Pick<TileMap, "places"> = deckMap(1)): Programs =>
  compileBots(botSources(), placeConstants(ground));

/** The camp world's programs, its Deckhand in place of the shipped one, compiled with the places of `ground`. */
export const campPrograms = (ground: Pick<TileMap, "places">): Programs =>
  compileBots({ ...botSources(), ...campBotSources() }, placeConstants(ground));

/** Every camp monster file, parsed, by kind. */
export const monsterStats = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(files(fixture("monsters/"), ".json")).map(([kind, text]) => [
      kind,
      JSON.parse(text),
    ]),
  );

/** Every camp monster program's source, by file name without the extension. */
export const monsterSources = (): Record<string, string> => files(fixture("monsters/"), ".tac");

/**
 * The camp world's monsters, the wolf and the goblin, with their programs
 * compiled with the places of `ground`. No landing has monsters until slice
 * piece 5, so only the fight tests use these.
 */
export const campMonsters = (ground: Pick<TileMap, "places"> = { places: [] }): Monsters =>
  loadMonsters(monsterStats(), monsterSources(), ground);
/** The three item files from content/items/, parsed but not validated. */
export const rawItems = (): { rarities: unknown; bases: unknown; affixes: unknown } => ({
  rarities: JSON.parse(readFileSync(content("items/rarities.json"), "utf8")),
  bases: JSON.parse(readFileSync(content("items/bases.json"), "utf8")),
  affixes: JSON.parse(readFileSync(content("items/affixes.json"), "utf8")),
});

export const shippedItems = (): ItemTable => loadItems(rawItems());

const BIG_WIDTH = 120;
const BIG_HEIGHT = 80;
const terrain = (name: Terrain): number => TERRAINS.indexOf(name);
const nodeId = (name: string): number => NODE_KINDS.findIndex((k) => k.name === name) + 1;
const OPEN = new Set<string>(["grass", "path", "camp", "shore", "deep_grass", "den", "bridge"]);

/**
 * A 120 by 80 map drawn from a fixed seed: grass inside a rock border, rock
 * outcrops, a river across the south with three bridges and fishing spots,
 * trees and old trees, and the camp in the middle with its fire and bank. It
 * has every place the camp's programs and monsters name, and a `hold` for the
 * Deckhand. Built in code, as the largest map file is 30 by 21.
 */
export function bigMap(): TileMap {
  const width = BIG_WIDTH;
  const height = BIG_HEIGHT;
  const rng = createRng(1);
  const tiles = new Array<number>(width * height).fill(terrain("grass"));
  const set = (x: number, y: number, name: Terrain): void => {
    if (x >= 0 && y >= 0 && x < width && y < height) tiles[y * width + x] = terrain(name);
  };
  const at = (x: number, y: number): number => tiles[y * width + x] as number;
  const walk = (i: number): boolean => OPEN.has(TERRAINS[tiles[i] as number] as string);
  for (let x = 0; x < width; x++) {
    set(x, 0, "rock");
    set(x, height - 1, "rock");
  }
  for (let y = 0; y < height; y++) {
    set(0, y, "rock");
    set(width - 1, y, "rock");
  }
  // The river, with a shore on each side and three bridges.
  for (let x = 1; x < width - 1; x++) {
    set(x, 54, "shore");
    for (let y = 55; y <= 57; y++) set(x, y, [30, 60, 90].includes(x) ? "bridge" : "water");
    set(x, 58, "shore");
  }
  const camp = { x: 60, y: 30 };
  const nearCamp = (x: number, y: number): boolean =>
    Math.abs(x - camp.x) <= 8 && Math.abs(y - camp.y) <= 8;
  for (let i = 0; i < 50; i++) {
    const cx = 2 + nextInt(rng, width - 4);
    const cy = 2 + nextInt(rng, 50);
    const r = 1 + nextInt(rng, 3);
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if (Math.abs(x - cx) + Math.abs(y - cy) <= r && !nearCamp(x, y)) set(x, y, "rock");
  }
  for (let y = camp.y - 5; y <= camp.y + 5; y++)
    for (let x = camp.x - 6; x <= camp.x + 6; x++) set(x, y, "camp");
  set(camp.x, camp.y, "campfire");
  set(camp.x + 4, camp.y - 3, "bank");
  const nodes: { kind: number; x: number; y: number }[] = [];
  for (let x = 4; x < width - 4; x += 6) nodes.push({ kind: nodeId("fishing_spot"), x, y: 55 });
  const plant = (count: number, name: Terrain, kind: number): void => {
    for (let placed = 0; placed < count; ) {
      const x = 2 + nextInt(rng, width - 4);
      const y = 2 + nextInt(rng, 50);
      if (at(x, y) !== terrain("grass") || nearCamp(x, y)) continue;
      set(x, y, name);
      nodes.push({ kind, x, y });
      placed++;
    }
  };
  plant(80, "tree", nodeId("tree"));
  plant(30, "dark_tree", nodeId("old_tree"));
  const places = [
    { name: "bank", x: camp.x + 4, y: camp.y - 2 },
    { name: "camp", x: camp.x, y: camp.y + 2 },
    { name: "deep_wood", x: 20, y: 20 },
    { name: "den", x: 20, y: 45 },
    { name: "fire", x: camp.x, y: camp.y + 1 },
    { name: "hold", x: camp.x, y: camp.y + 2 },
    { name: "lower_river", x: 60, y: 66 },
    { name: "meadow", x: 95, y: 20 },
    { name: "near_wood", x: 45, y: 25 },
    { name: "pinewood", x: 100, y: 45 },
    { name: "river", x: 61, y: 54 },
  ];
  for (const p of places) if (!walk(p.y * width + p.x)) set(p.x, p.y, "grass");
  // Ground the rocks and trees close off from camp becomes rock, as a world
  // with ground nobody can reach does not load.
  const start = (camp.y + 2) * width + camp.x;
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % width;
    for (const j of [i - width, i + width, x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1]) {
      if (j < 0 || j >= tiles.length || seen.has(j) || !walk(j)) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  for (let i = 0; i < tiles.length; i++) if (walk(i) && !seen.has(i)) tiles[i] = terrain("rock");
  return { name: "scale", width, height, tiles, places, nodes };
}

/**
 * A world on bigMap with `residents` adventurers running the camp's programs
 * in turn and `monsters` wolves and goblins, half each, every one on a tile of
 * its own drawn from `seed`. No more come unless `refill` puts them in.
 */
export function crowd(residents: number, monsters: number, seed = 1): World {
  const map = bigMap();
  const beasts = campMonsters(map);
  const programs = { ...campPrograms(map), ...beasts.programs };
  const world = createWorld(map, seed, programs, beasts.kinds);
  world.tick = 2400;
  const rng = createRng(seed + 1000);
  const taken = new Set<number>();
  const bots = ["homebody", "riverwalker", "wanderer"];
  const inputs: Input[] = [];
  for (let i = 0; i < residents; i++)
    inputs.push({
      type: "spawn",
      name: `R${i}`,
      program: bots[i % 3] as string,
      ...freeTile(world, rng, taken),
    });
  step(world, inputs);
  for (let i = 0; i < monsters; i++)
    putMonster(world, i % 2 === 0 ? "wolf" : "goblin", freeTile(world, rng, taken));
  return world;
}

/**
 * Puts monsters onto tiles nobody stands on, drawn from `rng`, until the
 * world has `monsters` of them, wolves and goblins as near half each as they
 * can be.
 */
export function refill(world: World, monsters: number, rng: Rng): void {
  const taken = new Set(world.actors.map((a) => tileAt(world.atlas, a.x, a.y)));
  const wolves = world.actors.filter((a) => a.kind === "wolf").length;
  const goblins = world.actors.filter((a) => a.kind === "goblin").length;
  for (let w = wolves, g = goblins; w + g < monsters; ) {
    const kind = w <= g ? "wolf" : "goblin";
    putMonster(world, kind, freeTile(world, rng, taken));
    if (kind === "wolf") w++;
    else g++;
  }
}

/** How long a tick took, in milliseconds. */
export interface Timing {
  readonly mean: number;
  readonly worst: number;
}

/**
 * Times `ticks` ticks of a crowd of `residents` and `monsters`, after `warm`
 * untimed ones. Monsters that go down are replaced between ticks, outside the
 * timing, so the crowd stays the size it was.
 */
export function timeCrowd(
  residents: number,
  monsters: number,
  warm: number,
  ticks: number,
): Timing {
  const world = crowd(residents, monsters);
  const rng = createRng(99);
  let total = 0;
  let worst = 0;
  for (let i = 0; i < warm + ticks; i++) {
    refill(world, monsters, rng);
    const start = performance.now();
    step(world);
    const took = performance.now() - start;
    if (i < warm) continue;
    total += took;
    worst = Math.max(worst, took);
  }
  return { mean: total / ticks, worst };
}

/** A landing's tick timed: as Timing, with the fewest and most monsters on the plate while it ran. */
export interface LandingTiming extends Timing {
  readonly fewest: number;
  readonly most: number;
}

/**
 * Times `ticks` ticks of the second city's medium landing, 80 by 45, with the
 * 150 crowd on Deckhand, from `warm` ticks after the ramp comes down, while
 * the citizens go for the packs. 150 kill faster than the dens' clocks let
 * packs out, and a den refills only its own pocket, so with `full` the plate
 * is held as it was when the ramp came down, as timeCrowd holds its crowd:
 * between timed ticks every den with packs inside has its next turn brought
 * to the coming tick, and a laid monster killed is put back on the tile it
 * stood on then, if nobody is there and its pack still stands.
 */
export function timeLanding(warm: number, ticks: number, full = false, seed = 2): LandingTiming {
  const world = crewCity({ seed, city: 2, size: "medium", level: 23, tiers: CROWDS[2][150] });
  const held = new Map<number, Actor>();
  const topUp = (): void => {
    if (!full || !world.plate) return;
    for (const den of world.plate.dens) if (den.queue.length > 0) den.next = world.tick + 1;
    const standing = new Set(world.actors.map((a) => a.id));
    const taken = new Set(world.actors.map((a) => `${a.x},${a.y}`));
    for (const [id, was] of [...held]) {
      if (standing.has(id)) continue;
      // Gone with its pack, or its tile and those round it in its pocket taken for now: it waits.
      const pack = world.plate.packs.find((p) => p.id === was.pack);
      if (!pack) held.delete(id);
      const spot = [[0, 0], ...NEIGHBOURS]
        .map(([dx, dy]) => ({ x: was.x + (dx as number), y: was.y + (dy as number) }))
        .find(
          (p) =>
            !taken.has(`${p.x},${p.y}`) &&
            pack !== undefined &&
            inPocket(world, pack.pocket, p.x, p.y) &&
            walkable(world.atlas, p.x, p.y),
        );
      if (!held.has(id) || !spot) continue;
      held.delete(id);
      addMonster(world, was.kind as Rank, was.level, was.pack, spot.x, spot.y);
      const back = world.actors[world.actors.length - 1] as Actor;
      held.set(back.id, { ...back, x: was.x, y: was.y });
      taken.add(`${spot.x},${spot.y}`);
    }
  };
  while (world.tick < RAMP_DOWN + warm) {
    topUp();
    step(world);
  }
  for (const a of world.actors) if (a.pack > 0) held.set(a.id, { ...a });
  let total = 0;
  let worst = 0;
  let fewest = Number.MAX_SAFE_INTEGER;
  let most = 0;
  for (let i = 0; i < ticks; i++) {
    topUp();
    // What the tick starts with; its blows take some of them.
    const monsters = world.actors.filter((a) => a.kind !== ADVENTURER).length;
    fewest = Math.min(fewest, monsters);
    most = Math.max(most, monsters);
    const start = performance.now();
    step(world);
    const took = performance.now() - start;
    total += took;
    worst = Math.max(worst, took);
  }
  return { mean: total / ticks, worst, fewest, most };
}

/** A tile of bigMap a crowd may be put on, not in `taken`, drawn from `rng`; it is added to `taken`. */
function freeTile(world: World, rng: Rng, taken: Set<number>): Point {
  const { map } = world.atlas;
  for (;;) {
    const x = 1 + nextInt(rng, BIG_WIDTH - 2);
    const y = 1 + nextInt(rng, BIG_HEIGHT - 2);
    const i = y * BIG_WIDTH + x;
    const name = TERRAINS[map.tiles[i] as number] as string;
    if (taken.has(i) || !["grass", "shore", "bridge", "camp"].includes(name)) continue;
    taken.add(i);
    return { x, y };
  }
}

/** The usernames of a crowd file in content/chat/, in the order its `names` lines give them. */
export const crowdNames = (file: "crowd-15" | "crowd-150"): string[] =>
  readFileSync(content(`chat/${file}.txt`), "utf8")
    .split("\n")
    .filter((line) => line.startsWith("names "))
    .flatMap((line) => line.slice("names ".length).trim().split(/\s+/));

/** A tier of a scripted crowd: its citizens' Arms, and how many of them. */
export type Tier = readonly [arms: number, citizens: number];

/**
 * The crowds plate.ts lays (docs/slice.md, section 1): for the second city a
 * level-23 landing with the worked tiers, for the first a level-8 landing
 * with a young crowd.
 */
export const CROWDS: Readonly<Record<CitySize, { level: number; 15: Tier[]; 150: Tier[] }>> = {
  1: {
    level: 8,
    15: [
      [3, 3],
      [8, 9],
      [15, 3],
    ],
    150: [
      [3, 30],
      [8, 90],
      [15, 30],
    ],
  },
  2: {
    level: 23,
    15: [
      [6, 2],
      [23, 10],
      [40, 2],
      [58, 1],
    ],
    150: [
      [6, 30],
      [23, 90],
      [40, 20],
      [58, 10],
    ],
  },
};

/**
 * A city of size `city` with citizens of the tiers given, at Arms and
 * Hitpoints of their tier, running the shipped programs, whose next landing
 * is the one asked for. It stands at tick 1, in transit; its legs plant at
 * LEGS_PLANT. Each citizen is named from the 150 crowd's usernames.
 */
export function crewCity(options: {
  readonly seed: number;
  readonly city: CitySize;
  readonly size: SizeClass;
  readonly level: number;
  readonly tiers: readonly Tier[];
  readonly biome?: Biome;
  /** Programs beside the shipped ones, for a test to give a citizen. */
  readonly programs?: Programs;
}): World {
  const { seed, city, size, level, tiers, biome = "meadow" } = options;
  const world = createCity(seed, { ...shippedPrograms(), ...options.programs }, {}, city);
  (world.cycle as Cycle).landing = { seed: (seed * 7919) | 0, size, biome, level };
  const names = crowdNames("crowd-150");
  const levels = tiers.flatMap(([arms, n]) => new Array<number>(n).fill(arms));
  step(
    world,
    levels.map((_, i) => ({
      type: "join",
      account: String(100_000 + i),
      name: names[i] ?? `citizen${1000 + i}`,
      role: "viewer",
    })),
  );
  const citizens = world.actors.filter((a) => a.kind === ADVENTURER);
  citizens.forEach((c, i) => {
    const xp = XP_TABLE[levels[i] as number] as number;
    c.xp[SKILLS.indexOf("melee")] = xp;
    c.xp[SKILLS.indexOf("hitpoints")] = xp;
    c.hp = kindOf(world, c).hp;
  });
  return world;
}

/**
 * Puts a monster of `kind` at (x, y), running `program`, the kind's own by
 * default, where a `spawn` input might be turned away.
 */
export function putMonster(world: World, kind: string, { x, y }: Point, program = kind): void {
  world.actors.push({
    ...freshOrders(world.programs[program] as Program, "", world.tick),
    id: world.nextActorId++,
    name: kind === "wolf" ? "Wolf" : "Goblin",
    x,
    y,
    fromX: x,
    fromY: y,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    blocked: 0,
    program,
    memory: new Array<number>(MEMORY_SLOTS).fill(0),
    rule: -1,
    fault: 0,
    kind,
    hp: world.kinds[kind]?.hp as number,
    windup: 0,
    recover: 0,
    stalled: 0,
    xp: noXp(),
    bag: emptyBag(),
    bank: emptyBank(),
    deaths: 0,
    weapon: "",
    aim: 0,
    knockX: 0,
    knockY: 0,
    flask: 0,
    kills: 0,
    status: noStatus(),
    level: 0,
    pack: 0,
    carry: 0,
    place: 0,
  });
}

/**
 * Spawn inputs that put the given actors on the free walkable tiles nearest
 * the map's `camp`, in order, for tests on the camp's maps. The city has no
 * camp: its citizens join aboard (`join`).
 */
export function spawnsNearCamp(
  world: World,
  cast: readonly { readonly name: string; readonly program: string }[],
): Input[] {
  const { atlas } = world;
  const camp = atlas.places.find((p) => p.name === "camp") as Point;
  const seen = new Set<number>([tileAt(atlas, camp.x, camp.y)]);
  const queue: Point[] = [camp];
  const inputs: Input[] = [];
  for (let head = 0; head < queue.length && inputs.length < cast.length; head++) {
    const at = queue[head] as Point;
    if (!world.actors.some((a) => a.x === at.x && a.y === at.y)) {
      const { name, program } = cast[inputs.length] as (typeof cast)[number];
      inputs.push({ type: "spawn", name, x: at.x, y: at.y, program });
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!linked(atlas, at.x, at.y, x, y) || seen.has(tileAt(atlas, x, y))) continue;
      seen.add(tileAt(atlas, x, y));
      queue.push({ x, y });
    }
  }
  return inputs;
}
