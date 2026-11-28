// Shared by tests only: loads the shipped world, programs, monsters and items
// from content/, the one-map world the older mechanics tests are written on,
// and the large crowded map the tick is timed on.
import { readdirSync, readFileSync } from "node:fs";
import { type Atlas, parseWorld, type Region, tileAt } from "./atlas.ts";
import { emptyBag, emptyBank } from "./bag.ts";
import { type ItemTable, loadItems } from "./items.ts";
import {
  type Point,
  parseMap,
  placeConstants,
  TERRAINS,
  type Terrain,
  type TileMap,
} from "./map.ts";
import { loadMonsters, type Monsters } from "./monsters.ts";
import { NODE_KINDS } from "./nodes.ts";
import { createRng, nextInt, type Rng } from "./rng.ts";
import { noXp } from "./skills.ts";
import { compileBots } from "./tactics.ts";
import { MEMORY_SLOTS } from "./vm.ts";
import { createWorld, type Input, type Programs, step, type World } from "./world.ts";

const content = (path: string): URL => new URL(`../../../content/${path}`, import.meta.url);

/**
 * The map the world was before it had regions, kept as a fixture: a world of
 * one region, with every place the shipped programs and monsters name.
 */
export const rawFirstLight = (): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL("fixtures/first-light.json", import.meta.url), "utf8"));

export const firstLight = (): TileMap => parseMap(rawFirstLight());

/** Every file in a content folder with the given extension, by name without it. */
const files = (folder: string, extension: string): Record<string, string> =>
  Object.fromEntries(
    readdirSync(content(`${folder}/`))
      .filter((file) => file.endsWith(extension))
      .map((file) => [
        file.slice(0, -extension.length),
        readFileSync(content(`${folder}/${file}`), "utf8"),
      ]),
  );

/** content/world.json and every map file, parsed but not validated. */
export const rawWorld = (): { world: unknown; maps: Record<string, unknown> } => ({
  world: JSON.parse(readFileSync(content("world.json"), "utf8")),
  maps: Object.fromEntries(
    Object.entries(files("maps", ".json")).map(([name, text]) => [name, JSON.parse(text)]),
  ),
});

/** The shipped world: its regions and the exits between them. */
export const shippedWorld = (): Atlas => {
  const { world, maps } = rawWorld();
  return parseWorld(world, maps);
};

/** Every shipped program's source, by file name without the extension. */
export const botSources = (): Record<string, string> => files("bots", ".tac");

/** The shipped programs, compiled with the places of `ground`: the shipped world unless told otherwise. */
export const shippedPrograms = (ground: Pick<TileMap, "places"> = shippedWorld()): Programs =>
  compileBots(botSources(), placeConstants(ground));

/** Every monster file, parsed, by kind. */
export const monsterStats = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(files("monsters", ".json")).map(([kind, text]) => [kind, JSON.parse(text)]),
  );

/** Every monster program's source, by file name without the extension. */
export const monsterSources = (): Record<string, string> => files("monsters", ".tac");

/** The shipped monsters, placed by the places of `ground`: the shipped world unless told otherwise. */
export const shippedMonsters = (ground: Pick<TileMap, "places"> = shippedWorld()): Monsters =>
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
 * has every place the shipped programs and monsters name. Built in code, as
 * the largest map file is 30 by 21.
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
 * A world on bigMap with `residents` adventurers running the shipped programs
 * in turn and `monsters` wolves and goblins, half each, every one on a tile of
 * its own drawn from `seed`. Monsters are put in directly, as the caps that
 * keep a region of the shipped world to 24 would turn most of them away. The
 * world starts at 10:00 and has no spawn table, so no more come unless
 * `refill` puts them in.
 */
export function crowd(residents: number, monsters: number, seed = 1): World {
  const map = bigMap();
  const beasts = shippedMonsters(map);
  const programs = { ...shippedPrograms(map), ...beasts.programs };
  const world = createWorld(map, seed, programs, beasts.kinds);
  world.tick = 4 * 600;
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

/** A tile of bigMap a crowd may be put on, not in `taken`, drawn from `rng`; it is added to `taken`. */
function freeTile(world: World, rng: Rng, taken: Set<number>): Point {
  const map = (world.atlas.regions[0] as Region).map;
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

/**
 * Puts a monster of `kind` at (x, y), running `program`, the kind's own by
 * default, past the caps and spawn tables that would turn it away.
 */
export function putMonster(world: World, kind: string, { x, y }: Point, program = kind): void {
  world.actors.push({
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
    shift: "",
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
  });
}
