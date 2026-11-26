// Shared by tests only: loads the shipped map, programs, monsters and items from content/.
import { readdirSync, readFileSync } from "node:fs";
import { type ItemTable, loadItems } from "./items.ts";
import { parseMap, placeConstants, type TileMap } from "./map.ts";
import { loadMonsters, type Monsters } from "./monsters.ts";
import { compileBots } from "./tactics.ts";
import type { Programs } from "./world.ts";

const content = (path: string): URL => new URL(`../../../content/${path}`, import.meta.url);

export const rawFirstLight = (): Record<string, unknown> =>
  JSON.parse(readFileSync(content("maps/first-light.json"), "utf8"));

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

/** Every shipped program's source, by file name without the extension. */
export const botSources = (): Record<string, string> => files("bots", ".tac");

export const shippedPrograms = (): Programs =>
  compileBots(botSources(), placeConstants(firstLight()));

/** Every monster file, parsed, by kind. */
export const monsterStats = (): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(files("monsters", ".json")).map(([kind, text]) => [kind, JSON.parse(text)]),
  );

/** Every monster program's source, by file name without the extension. */
export const monsterSources = (): Record<string, string> => files("monsters", ".tac");

export const shippedMonsters = (): Monsters =>
  loadMonsters(monsterStats(), monsterSources(), firstLight());

/** The three item files from content/items/, parsed but not validated. */
export const rawItems = (): { rarities: unknown; bases: unknown; affixes: unknown } => ({
  rarities: JSON.parse(readFileSync(content("items/rarities.json"), "utf8")),
  bases: JSON.parse(readFileSync(content("items/bases.json"), "utf8")),
  affixes: JSON.parse(readFileSync(content("items/affixes.json"), "utf8")),
});

export const shippedItems = (): ItemTable => loadItems(rawItems());
