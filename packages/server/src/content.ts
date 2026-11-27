// The shipped content the server runs: the world (its regions and exits) and the
// programs, read from content/.
import { readdirSync, readFileSync } from "node:fs";
import { type Atlas, compileBots, type Programs, parseWorld, placeConstants } from "@idlin/sim";

export interface Content {
  readonly atlas: Atlas;
  readonly programs: Programs;
}

const CONTENT = new URL("../../../content/", import.meta.url);

/** Every file in a folder of `dir` with the given extension, by name without it. */
function read(dir: URL, folder: string, extension: string): Record<string, string> {
  const at = new URL(`${folder}/`, dir);
  return Object.fromEntries(
    readdirSync(at)
      .filter((file) => file.endsWith(extension))
      .map((file) => [file.slice(0, -extension.length), readFileSync(new URL(file, at), "utf8")]),
  );
}

/** Throws a MapError, BotError or ProgramError if the content is bad. */
export function loadContent(dir: URL = CONTENT): Content {
  const maps = Object.fromEntries(
    Object.entries(read(dir, "maps", ".json")).map(([name, text]) => [name, JSON.parse(text)]),
  );
  const atlas = parseWorld(JSON.parse(readFileSync(new URL("world.json", dir), "utf8")), maps);
  return { atlas, programs: compileBots(read(dir, "bots", ".tac"), placeConstants(atlas)) };
}
