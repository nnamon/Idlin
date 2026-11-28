// Monsters as content: one JSON file of numbers per kind, and the Tactics
// program it runs. Turns what was read from a folder of monster files into the
// kinds and programs a world is created with.

import { show } from "./hash.ts";
import { type Point, placeConstants, type TileMap } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { PROGRAM_NAME, type Program } from "./vm.ts";
import { checkKinds, type Kind, KindError, type Kinds, own } from "./world.ts";

export interface Monsters {
  readonly kinds: Kinds;
  /** Compiled from the monsters' own program files. */
  readonly programs: Readonly<Record<string, Program>>;
  /** What each kind is called on screen, such as "Wolf". */
  readonly names: Readonly<Record<string, string>>;
  /** The program each kind runs. */
  readonly runs: Readonly<Record<string, string>>;
}

/** A capital letter and up to 15 letters or spaces. */
export const MONSTER_NAME = /^[A-Z][A-Za-z ]{0,15}$/;

/**
 * A kind's numbers, and its rank. `step` may be left out, and then the kind
 * walks as adventurers do; `rank` and `level`, and then it is level-1 fodder.
 */
const NUMBERS = ["hp", "damage", "windup", "recovery", "reach", "step", "rank", "level"] as const;
const FIELDS = new Set<string>([...NUMBERS, "name", "program"]);

/**
 * `stats` holds each monster file's parsed JSON by kind name, `sources` each
 * monster program's source by name, compiled with the places of `map` as
 * constants if one is given. Throws a KindError for a monster file that is
 * wrong, whatever it holds, and a BotError for a program that does not
 * compile.
 */
export function loadMonsters(
  stats: Readonly<Record<string, unknown>>,
  sources: Readonly<Record<string, string>>,
  map: Pick<TileMap, "places"> = { places: [] },
): Monsters {
  const places: Record<string, Point> = placeConstants(map);
  const programs = compileBots(sources, places);
  const kinds: Record<string, Kind> = Object.create(null);
  const names: Record<string, string> = Object.create(null);
  const runs: Record<string, string> = Object.create(null);
  let file = "a monster file";
  try {
    for (const kind of Object.keys(stats).sort()) {
      if (!PROGRAM_NAME.test(kind))
        throw new KindError(
          `${kind.slice(0, 40)}.json: a monster file's name must be a lower-case letter followed by letters, digits or underscores`,
        );
      file = `${kind}.json`;
      const raw = stats[kind];
      if (typeof raw !== "object" || raw === null || Array.isArray(raw))
        throw new KindError(`${file}: not an object`);
      for (const field of Object.keys(raw)) {
        if (!FIELDS.has(field))
          throw new KindError(`${file}: unknown field ${show(field).slice(0, 40)}`);
      }
      // Only the file's own fields count; nothing is read from a prototype.
      const numbers: Record<string, unknown> = {};
      for (const field of NUMBERS) numbers[field] = own(raw, field);
      kinds[kind] = numbers as unknown as Kind;
      const [name, program] = [own(raw, "name"), own(raw, "program")];
      if (typeof name !== "string" || !MONSTER_NAME.test(name))
        throw new KindError(
          `${file}: name must be a capital letter and up to 15 letters or spaces`,
        );
      if (typeof program !== "string" || !Object.hasOwn(programs, program))
        throw new KindError(
          `${file}: there is no monster program called ${show(program).slice(0, 40)}`,
        );
      names[kind] = name;
      runs[kind] = program;
    }
    return { kinds: checkKinds(kinds), programs, names, runs };
  } catch (error) {
    if (error instanceof KindError) throw error;
    // Anything else came from reading a value that is not plain data.
    throw new KindError(`${file}: could not be read`);
  }
}
