// The shipped content the server runs: the world (its regions and exits), the
// programs, and the monsters with their spawns, read from content/.
import { readdirSync, readFileSync } from "node:fs";
import { type Crowd, CrowdError, parseCrowd } from "@idlin/chat";
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

/**
 * A crowd file from content/chat/ by its name without `.txt`, such as
 * `crowd-150`. Throws a CrowdError if it cannot be read as one.
 */
export function loadCrowd(name: string, dir: URL = CONTENT): Crowd {
  if (!/^[a-z0-9_-]{1,64}$/.test(name)) throw new CrowdError(`"${name}" is not a crowd file name`);
  let text: string;
  try {
    text = readFileSync(new URL(`chat/${name}.txt`, dir), "utf8");
  } catch (error) {
    throw new CrowdError(`cannot read the crowd file ${name}: ${String(error)}`);
  }
  return parseCrowd(text);
}

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
