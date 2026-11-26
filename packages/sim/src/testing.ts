// Shared by tests only: loads the shipped map and programs from content/.
import { readdirSync, readFileSync } from "node:fs";
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
