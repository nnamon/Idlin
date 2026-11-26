// Shared by tests only: loads the shipped map, programs and items from content/.
import { readdirSync, readFileSync } from "node:fs";
import { type ItemTable, loadItems } from "./items.ts";
import { parseMap, placeConstants, type TileMap } from "./map.ts";
import { compileBots } from "./tactics.ts";
import type { Programs } from "./world.ts";

const content = (path: string): URL => new URL(`../../../content/${path}`, import.meta.url);

export const rawFirstLight = (): Record<string, unknown> =>
  JSON.parse(readFileSync(content("maps/first-light.json"), "utf8"));

export const firstLight = (): TileMap => parseMap(rawFirstLight());

/** Every shipped program's source, by file name without the extension. */
export const botSources = (): Record<string, string> =>
  Object.fromEntries(
    readdirSync(content("bots/"))
      .filter((file) => file.endsWith(".tac"))
      .map((file) => [file.slice(0, -4), readFileSync(content(`bots/${file}`), "utf8")]),
  );

export const shippedPrograms = (): Programs =>
  compileBots(botSources(), placeConstants(firstLight()));

/** The three item files from content/items/, parsed but not validated. */
export const rawItems = (): { rarities: unknown; bases: unknown; affixes: unknown } => ({
  rarities: JSON.parse(readFileSync(content("items/rarities.json"), "utf8")),
  bases: JSON.parse(readFileSync(content("items/bases.json"), "utf8")),
  affixes: JSON.parse(readFileSync(content("items/affixes.json"), "utf8")),
});

export const shippedItems = (): ItemTable => loadItems(rawItems());
