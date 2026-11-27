// Shared by tests only: loads the shipped world, programs, monsters and items
// from content/, and the one-map world the older mechanics tests are written on.
import { readdirSync, readFileSync } from "node:fs";
import { type Atlas, parseWorld } from "./atlas.ts";
import { type ItemTable, loadItems } from "./items.ts";
import { parseMap, placeConstants, type TileMap } from "./map.ts";
import { loadMonsters, type Monsters } from "./monsters.ts";
import { compileBots } from "./tactics.ts";
import type { Programs } from "./world.ts";

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
