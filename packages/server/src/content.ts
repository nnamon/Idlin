// The shipped content the server runs: the programs citizens run, read from
// content/. The city's ground is its own (deck.ts), and no landing has
// monsters until slice piece 5 lays them, so there is no map or monster file.
import { readdirSync, readFileSync } from "node:fs";
import { type Crowd, CrowdError, parseCrowd } from "@idlin/chat";
import { compileBots, deckMap, type Kinds, type Programs, placeConstants } from "@idlin/sim";

export interface Content {
  /** The citizens' programs, compiled with the places of the first city's deck. */
  readonly programs: Programs;
  readonly kinds: Kinds;
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

/** Throws a BotError or ProgramError if the content is bad. */
export function loadContent(dir: URL = CONTENT): Content {
  return {
    programs: compileBots(read(dir, "bots", ".tac"), placeConstants(deckMap(1))),
    kinds: {},
  };
}
