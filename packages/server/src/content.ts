// The shipped content the server runs: the world (its regions and exits), the
// programs, and the monsters with their spawns, read from content/.
import { readdirSync, readFileSync } from "node:fs";
import {
  type Atlas,
  compileBots,
  type Kinds,
  loadMonsters,
  type Programs,
  parseWorld,
  placeConstants,
  type Spawns,
} from "@idlin/sim";

export interface Content {
  readonly atlas: Atlas;
  /** The residents' programs and the monsters' programs together. */
  readonly programs: Programs;
  readonly kinds: Kinds;
  readonly spawns: Spawns;
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

const parsed = (files: Record<string, string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [name, JSON.parse(text)]));

/** Throws a MapError, BotError, KindError or ProgramError if the content is bad. */
export function loadContent(dir: URL = CONTENT): Content {
  const maps = parsed(read(dir, "maps", ".json"));
  const atlas = parseWorld(JSON.parse(readFileSync(new URL("world.json", dir), "utf8")), maps);
  const monsters = loadMonsters(
    parsed(read(dir, "monsters", ".json")),
    read(dir, "monsters", ".tac"),
    atlas,
  );
  return {
    atlas,
    programs: {
      ...compileBots(read(dir, "bots", ".tac"), placeConstants(atlas)),
      ...monsters.programs,
    },
    kinds: monsters.kinds,
    spawns: monsters.spawns,
  };
}
