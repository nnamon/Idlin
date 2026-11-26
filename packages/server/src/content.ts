// The shipped content the server runs: the map and the programs, read from content/.
import { readdirSync, readFileSync } from "node:fs";
import { compileBots, type Programs, parseMap, placeConstants, type TileMap } from "@idlin/sim";

export interface Content {
  readonly map: TileMap;
  readonly programs: Programs;
}

const CONTENT = new URL("../../../content/", import.meta.url);

/** Throws a MapError, BotError or ProgramError if the content is bad. */
export function loadContent(dir: URL = CONTENT): Content {
  const map = parseMap(JSON.parse(readFileSync(new URL("maps/first-light.json", dir), "utf8")));
  const bots = new URL("bots/", dir);
  const sources = Object.fromEntries(
    readdirSync(bots)
      .filter((file) => file.endsWith(".tac"))
      .map((file) => [file.slice(0, -4), readFileSync(new URL(file, bots), "utf8")]),
  );
  return { map, programs: compileBots(sources, placeConstants(map)) };
}
