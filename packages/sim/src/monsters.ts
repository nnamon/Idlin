// Monsters as content: one JSON file of numbers per kind, and the Tactics
// program it runs. Turns what was read from content/monsters/ into the kinds,
// programs and spawns a world is created with.

import { isInt32, show } from "./hash.ts";
import { type Point, placeConstants, type TileMap } from "./map.ts";
import { compileBots } from "./tactics.ts";
import { PROGRAM_NAME, type Program } from "./vm.ts";
import {
  checkKinds,
  type Kind,
  KindError,
  type Kinds,
  MONSTER_NAME,
  MOST_IN_GROUP,
  MOST_IN_NIGHT_GROUP,
  own,
  plainList,
  type Spawn,
  type Spawns,
} from "./world.ts";

export interface Monsters {
  readonly kinds: Kinds;
  /** Compiled from the monsters' own program files. */
  readonly programs: Readonly<Record<string, Program>>;
  readonly spawns: Spawns;
}

/** A kind's numbers. `step` may be left out, and then the kind walks as adventurers do. */
const NUMBERS = ["hp", "damage", "windup", "recovery", "reach", "step"] as const;
const FIELDS = new Set<string>([
  ...NUMBERS,
  "name",
  "program",
  "group",
  "night_group",
  "day",
  "night",
]);
/** More places than a spawn may list; the world refuses those with a clearer message. */
const MOST_PLACES = 64;

/**
 * `stats` holds each monster file's parsed JSON by kind name, `sources` each
 * monster program's source by name. Throws a KindError for a monster file
 * that is wrong, whatever it holds, and a BotError for a program that does not
 * compile. The spawns are checked in full when a world is created from them.
 */
export function loadMonsters(
  stats: Readonly<Record<string, unknown>>,
  sources: Readonly<Record<string, string>>,
  map: Pick<TileMap, "places">,
): Monsters {
  const places = placeConstants(map);
  const programs = compileBots(sources, places);
  const kinds: Record<string, Kind> = Object.create(null);
  const spawns: Spawn[] = [];
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
      const where = (part: "day" | "night"): Point[] => {
        const list = plainList(own(raw, part), MOST_PLACES);
        if (!list) throw new KindError(`${file}: ${part} must be a list of places, no gaps`);
        return list.map((name) => {
          if (typeof name !== "string" || !Object.hasOwn(places, name))
            throw new KindError(`${file}: the map has no place called ${show(name).slice(0, 40)}`);
          return places[name] as Point;
        });
      };
      const [name, program] = [own(raw, "name"), own(raw, "program")];
      // Each a number, or the fewest and the most as a list of two.
      const day = own(raw, "group");
      const dayRange = Array.isArray(day) ? plainList(day, 2) : null;
      const [group, most] = dayRange ? dayRange : [day, day];
      const night = own(raw, "night_group");
      const range = Array.isArray(night) ? plainList(night, 2) : null;
      const [nightGroup, nightMost] =
        night === undefined ? [group, group] : range ? range : [night, night];
      if (typeof name !== "string" || !MONSTER_NAME.test(name))
        throw new KindError(
          `${file}: name must be a capital letter and up to 15 letters or spaces`,
        );
      if (
        (dayRange && dayRange.length !== 2) ||
        !isInt32(group) ||
        !isInt32(most) ||
        group < 1 ||
        most < group ||
        most > MOST_IN_GROUP
      )
        throw new KindError(
          `${file}: group must be a whole number from 1 to ${MOST_IN_GROUP}, or the fewest and the most as two of those`,
        );
      if (
        (range && range.length !== 2) ||
        !isInt32(nightGroup) ||
        !isInt32(nightMost) ||
        nightGroup < 1 ||
        nightMost < nightGroup ||
        nightMost > MOST_IN_NIGHT_GROUP
      )
        throw new KindError(
          `${file}: night_group must be a whole number from 1 to ${MOST_IN_NIGHT_GROUP}, or the fewest and the most as two of those`,
        );
      if (typeof program !== "string" || !Object.hasOwn(programs, program))
        throw new KindError(
          `${file}: there is no monster program called ${show(program).slice(0, 40)}`,
        );
      spawns.push({
        kind,
        name,
        program,
        group,
        most,
        nightGroup,
        nightMost,
        day: where("day"),
        night: where("night"),
      });
    }
    return { kinds: checkKinds(kinds), programs, spawns };
  } catch (error) {
    if (error instanceof KindError) throw error;
    // Anything else came from reading a value that is not plain data.
    throw new KindError(`${file}: could not be read`);
  }
}
