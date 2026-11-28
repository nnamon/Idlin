// The world and the one function that advances it. Everything here is a pure
// function of the seed, the maps and the inputs: integers only, no clock.

import {
  type Atlas,
  atlasOf,
  hashAtlas,
  hashMap,
  linked,
  type Region,
  regionAt,
  terrainOf,
  tileAt,
  walkable,
} from "./atlas.ts";
import { BAG_SLOTS, emptyBag, emptyBank, GOODS, MAX_BANKED } from "./bag.ts";
import { MAX_STALLED, think, wayTo } from "./brain.ts";
import { fullNodes, type NodeState, regrowNodes } from "./gather.ts";
import {
  addMark,
  allAt,
  countWithin,
  dropMarks,
  firstAt,
  type Grid,
  gridOf,
  holdGrid,
  putAt,
  releaseGrid,
  setPath,
  stepOff,
  stepOnto,
} from "./grid.ts";
import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import {
  type Attacker,
  blow,
  DAMAGE_TYPES,
  type DamageType,
  type Defender,
  type Element,
  FAMILY_HIT,
  FULL,
  type Hit,
  hit,
  MOST_DAMAGE,
  type Modifier,
  monsterArmour,
  RANKS,
  type Rank,
  rollCrit,
} from "./hit.ts";
import { ACCOUNT, type ChatInput, NEWCOMER_PROGRAM, ROLES, USERNAME } from "./inputs.ts";
import { NEIGHBOURS, type Point, place, type TileMap } from "./map.ts";
import { NODE_KINDS, type NodeKind } from "./nodes.ts";
import { createRng, nextInt, type Rng } from "./rng.ts";
import {
  gainXp,
  levelFor,
  MAX_LEVEL,
  MAX_XP,
  noXp,
  SKILLS,
  type Skill,
  XP_PER_DAMAGE,
} from "./skills.ts";
import {
  ARC_REACH,
  ARC_SHARE,
  BURN_JUMP_REACH,
  LANDING_RESIST,
  noStatus,
  passTick,
  SHATTER_REACH,
  SHOCK_MORE,
  STATUS_FIELDS,
  type Status,
  setBurn,
  slowed,
  statusFits,
  statusTicksFor,
  type Taker,
  takeHit,
} from "./status.ts";
import {
  FAULTS,
  MEMORY_SLOTS,
  PROGRAM_NAME,
  type Program,
  ProgramError,
  validateProgram,
} from "./vm.ts";
import {
  ARROW_RANGE,
  type BlowTimes,
  blowShape,
  blowTimes,
  DIRECTIONS,
  directionTo,
  FAMILIES,
  type Family,
  FLASK_DRINKS,
  isLine,
  KILLS_PER_DRINK,
  QUARTERS_PER_TILE,
  WEAPONS,
} from "./weapons.ts";

export const TICKS_PER_SECOND = 10;
/** A game hour lasts one minute of stream time, so a game day lasts 24 minutes. */
export const TICKS_PER_GAME_HOUR = 60 * TICKS_PER_SECOND;
export const TICKS_PER_GAME_MINUTE = TICKS_PER_GAME_HOUR / 60;
export const TICKS_PER_DAY = 24 * TICKS_PER_GAME_HOUR;
/** The world begins at dawn. */
export const START_HOUR = 6;
/** Ticks an actor takes to walk from one tile to the next. */
export const STEP_TICKS = 6;
/** Ticks an actor waits for a blocked tile to clear before giving up its path. */
export const BLOCKED_PATIENCE_TICKS = 10;
/** A chat username can be 25 characters, and a citizen is named by it. */
export const MAX_NAME_LENGTH = 25;
/** No actor's id reaches this; a world stops taking spawns first. */
export const MAX_ACTOR_ID = 0x7fffffff;
/** Ticks an adventurer rests at camp after being struck down, before its program runs again. */
export const DOWN_TICKS = 150;
/** An adventurer's death count stops here. */
export const MAX_DEATHS = 0x7fffffff;

/** What a kind of actor can take and deal in a fight. Content, like programs: fixed for the life of a world. */
export interface Kind {
  /** Hitpoints at full health. */
  readonly hp: number;
  /**
   * A monster's blow, from which `hit` in hit.ts works out what each of its
   * hits takes off. An adventurer's blow comes from its Melee level instead,
   * so ADVENTURER_KIND's is not read.
   */
  readonly damage: number;
  /** Ticks between starting an attack and the hit landing. The marked tiles show for this long. */
  readonly windup: number;
  /** Ticks after the hit before it can do anything else. */
  readonly recovery: number;
  /** How many tiles in a line its attack reaches, 1 to 3. */
  readonly reach: number;
  /** Ticks it takes to walk from one tile to the next, 2 to 30. STEP_TICKS when left out. */
  readonly step?: number;
  /**
   * A monster's rank and level, which set its armour, how long a status lasts
   * on it and what part of a hit sets one (slice.md, section 4). Fodder of
   * level 1 when left out. They are the kind's until monsters take their level
   * from the ground they stand on.
   */
  readonly rank?: Rank;
  readonly level?: number;
}
export type Kinds = Readonly<Record<string, Kind>>;
/** The highest level a monster kind can be. */
export const MOST_KIND_LEVEL = 99;

/** The kind every adventurer is. Any other kind is a monster, and the two are enemies. */
export const ADVENTURER = "adventurer";
export const ADVENTURER_KIND: Kind = Object.freeze({
  hp: 20,
  damage: 4,
  windup: 6,
  recovery: 6,
  reach: 1,
  step: STEP_TICKS,
});
const KIND_LIMITS: Readonly<Record<Exclude<keyof Kind, "rank">, readonly [number, number]>> = {
  hp: [1, 100_000],
  damage: [0, 100_000],
  windup: [1, 100],
  recovery: [0, 100],
  reach: [1, 3],
  step: [2, 30],
  level: [1, MOST_KIND_LEVEL],
};
const RANK_NAMES = Object.keys(RANKS) as Rank[];

export class KindError extends Error {
  override name = "KindError";
}

/**
 * Validates a table of monster kinds and returns a frozen copy with no
 * prototype. Throws a KindError for a bad name or a number out of range.
 */
export function checkKinds(kinds: Kinds): Kinds {
  const table: Record<string, Kind> = Object.create(null);
  try {
    for (const name of Object.keys(kinds).sort()) {
      if (!PROGRAM_NAME.test(name) || name === ADVENTURER)
        throw new KindError(`"${name}" is not a valid kind name`);
      const raw: unknown = kinds[name];
      if (typeof raw !== "object" || raw === null)
        throw new KindError(`kind "${name}" is not an object`);
      const kind: Record<string, number | string> = {};
      const givenRank: unknown = (raw as Record<string, unknown>).rank;
      const rank = givenRank === undefined ? "fodder" : givenRank;
      if (!RANK_NAMES.includes(rank as Rank))
        throw new KindError(`kind "${name}": rank must be one of ${RANK_NAMES.join(", ")}`);
      kind.rank = rank as Rank;
      for (const field of Object.keys(KIND_LIMITS) as (keyof typeof KIND_LIMITS)[]) {
        const given: unknown = (raw as Record<string, unknown>)[field];
        // A kind that does not say how fast it walks walks as adventurers do,
        // and one that gives no level is level 1.
        const value =
          given === undefined && field === "step"
            ? STEP_TICKS
            : given === undefined && field === "level"
              ? 1
              : given;
        const [low, high] = KIND_LIMITS[field];
        if (!isInt32(value) || value < low || value > high)
          throw new KindError(
            `kind "${name}": ${field} must be a whole number from ${low} to ${high}`,
          );
        kind[field] = value;
      }
      table[name] = Object.freeze(kind as unknown as Kind);
    }
  } catch (error) {
    if (error instanceof KindError) throw error;
    throw new KindError("the kind table could not be read");
  }
  return Object.freeze(table);
}

/** The most monsters in a group that comes by day, and in one that comes by night. */
export const MOST_IN_GROUP = 3;
export const MOST_IN_NIGHT_GROUP = 6;
/**
 * How many monsters a region may hold at once: `base`, and one more for every
 * `residents` adventurers in the region, up to `most`. Residents never keep
 * monsters away; a busy region draws more. At six residents in a region that
 * is 6 by day and 13 by night, at fifteen 9 and 17, and from 28 on 12 and 24.
 */
export const MONSTER_CAPS = {
  day: { base: 4, residents: 3, most: 12 },
  night: { base: 10, residents: 2, most: 24 },
} as const;
/** The most monsters any region holds at any hour. */
export const MONSTER_CEILING = MONSTER_CAPS.night.most;
/**
 * The shortest time from a monster arriving or going down in a region, or from
 * the region last being at its cap, to the next group arriving there: six game
 * minutes, so a region refills within a few game minutes after a fight.
 */
export const RESPAWN_TICKS = 60;
/** The longest wait a snapshot may hold; worlds saved before the wait was shortened held a game hour. */
const MOST_SPAWN_WAIT = TICKS_PER_GAME_HOUR;
/** Monsters come out at their night places from this hour until DAY_HOUR. */
export const NIGHT_HOUR = 19;
export const DAY_HOUR = 6;
/** How far, in steps, a group's monsters may stand from the place they come out at. */
export const GROUP_SPREAD = 2;
/**
 * A monster out for the other part of the day goes home once no adventurer is
 * nearer than this many steps.
 */
export const LEAVE_DISTANCE = 8;
/** Places a spawn may list for one part of the day. */
const MAX_SPAWN_PLACES = 16;
export const MONSTER_NAME = /^[A-Z][A-Za-z ]{0,15}$/;
const SPAWN_FIELDS = [
  "kind",
  "name",
  "program",
  "group",
  "day",
  "night",
  "nightGroup",
  "nightMost",
  "most",
] as const;

/** A plain object, as JSON makes: not null, not a list, no prototype but Object's or none. */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * A copy of a list with every entry read once, or null if it is not a list,
 * is longer than `most`, or has holes.
 */
export function plainList(value: unknown, most: number): unknown[] | null {
  if (!Array.isArray(value) || value.length > most) return null;
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) return null;
    copy.push(value[i]);
  }
  return copy;
}

/** `record[key]` if the record has it as its own property, else undefined. */
export const own = (record: object, key: string): unknown =>
  Object.hasOwn(record, key) ? (record as Record<string, unknown>)[key] : undefined;

/**
 * Whether `actor` may stand on (x, y). Anyone may stand on any walkable tile,
 * the camp's ground included; monsters only keep to their region.
 */
export const walkableFor = (world: World, _actor: Actor, x: number, y: number): boolean =>
  walkable(world.atlas, x, y);

/** Whether a monster may come out on (x, y): walkable and off the camp's ground. */
const spawnGround = (atlas: Atlas, x: number, y: number): boolean =>
  walkable(atlas, x, y) && terrainOf(atlas, x, y) !== "camp";

/**
 * Whether one step takes an adventurer, or a monster, from (ax, ay) to (bx, by). Adventurers
 * cross exits into other regions; monsters keep to the region they are in.
 */
function stepsFor(
  atlas: Atlas,
  adventurer: boolean,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  if (!linked(atlas, ax, ay, bx, by)) return false;
  if (adventurer) return true;
  return regionAt(atlas, ax, ay) === regionAt(atlas, bx, by);
}

/** Whether one step takes `actor` from (ax, ay) to (bx, by). */
export const canStep = (
  world: World,
  actor: Actor,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean => stepsFor(world.atlas, actor.kind === ADVENTURER, ax, ay, bx, by);

/** Whether two actors are in the same region. */
export const sameRegion = (world: World, a: Point, b: Point): boolean =>
  regionAt(world.atlas, a.x, a.y) === regionAt(world.atlas, b.x, b.y);

/** Where and how a kind of monster comes into the world. Content, like kinds. */
export interface Spawn {
  /** One of the world's monster kinds. */
  readonly kind: string;
  /** The name each one is given, such as "Wolf". */
  readonly name: string;
  /** The program each one runs; one of the world's. */
  readonly program: string;
  /** The fewest that arrive together by day, 1 to MOST_IN_GROUP. */
  readonly group: number;
  /**
   * The most that arrive together by day, from `group` to MOST_IN_GROUP;
   * `group` when left out. Between the two, the number is drawn when they
   * come out.
   */
  readonly most?: number;
  /**
   * The fewest that arrive together by night, 1 to MOST_IN_NIGHT_GROUP; `group`
   * when left out.
   */
  readonly nightGroup?: number;
  /**
   * The most that arrive together by night, from `nightGroup` to
   * MOST_IN_NIGHT_GROUP; `nightGroup` when left out. Between the two, the
   * number is drawn when they come out.
   */
  readonly nightMost?: number;
  /** Where they come out by day, and by night. Either may be empty. */
  readonly day: readonly Point[];
  readonly night: readonly Point[];
}
export type Spawns = readonly Spawn[];

/** The fewest of a spawn that arrive together, by night or by day. */
export const groupOf = (spawn: Spawn, night: boolean): number =>
  night ? (spawn.nightGroup ?? spawn.group) : spawn.group;

/** The most of a spawn that arrive together, by night or by day. */
export const mostOf = (spawn: Spawn, night: boolean): number =>
  night ? (spawn.nightMost ?? groupOf(spawn, true)) : (spawn.most ?? spawn.group);

/**
 * Validates a spawn table against the world, programs and kinds it will be used
 * with, and returns a frozen copy. Throws a KindError for anything wrong.
 */
export function checkSpawns(
  spawns: Spawns,
  ground: TileMap | Atlas,
  programs: Programs,
  kinds: Kinds,
): Spawns {
  const atlas = atlasOf(ground);
  const table: Spawn[] = [];
  try {
    const list = plainList(spawns, 64);
    if (!list) throw new KindError("the spawn table must be a list of at most 64 spawns, no gaps");
    for (const raw of list) {
      if (!isPlainObject(raw)) throw new KindError("a spawn is not a plain object");
      const [
        kind,
        name,
        program,
        group,
        day,
        night,
        nightGroup = group,
        nightMost = nightGroup,
        most = group,
      ] = SPAWN_FIELDS.map((field) => own(raw, field));
      if (typeof kind !== "string" || !Object.hasOwn(kinds, kind))
        throw new KindError(`spawn of an unknown kind ${show(kind).slice(0, 40)}`);
      if (typeof name !== "string" || !MONSTER_NAME.test(name))
        throw new KindError(
          `spawn of "${kind}": the name must be a capital letter and up to 15 letters or spaces`,
        );
      if (typeof program !== "string" || !Object.hasOwn(programs, program))
        throw new KindError(`spawn of "${kind}": no program called ${show(program).slice(0, 40)}`);
      if (!isInt32(group) || group < 1 || group > MOST_IN_GROUP)
        throw new KindError(
          `spawn of "${kind}": group must be a whole number from 1 to ${MOST_IN_GROUP}`,
        );
      if (!isInt32(most) || most < group || most > MOST_IN_GROUP)
        throw new KindError(
          `spawn of "${kind}": the most by day must be a whole number from the group to ${MOST_IN_GROUP}`,
        );
      if (!isInt32(nightGroup) || nightGroup < 1 || nightGroup > MOST_IN_NIGHT_GROUP)
        throw new KindError(
          `spawn of "${kind}": the night group must be a whole number from 1 to ${MOST_IN_NIGHT_GROUP}`,
        );
      if (!isInt32(nightMost) || nightMost < nightGroup || nightMost > MOST_IN_NIGHT_GROUP)
        throw new KindError(
          `spawn of "${kind}": the most by night must be a whole number from the night group to ${MOST_IN_NIGHT_GROUP}`,
        );
      const points = (value: unknown, part: string): Point[] => {
        const tiles = plainList(value, MAX_SPAWN_PLACES);
        if (!tiles)
          throw new KindError(
            `spawn of "${kind}": ${part} must be a list of at most ${MAX_SPAWN_PLACES} tiles, no gaps`,
          );
        return tiles.map((p) => {
          if (!isPlainObject(p))
            throw new KindError(`spawn of "${kind}": a ${part} tile is not x and y`);
          const [x, y] = [own(p, "x"), own(p, "y")];
          // Monsters never come out on the camp's ground.
          if (!isInt32(x) || !isInt32(y) || !spawnGround(atlas, x, y))
            throw new KindError(
              `spawn of "${kind}": a ${part} tile is not ground a monster can stand on`,
            );
          return Object.freeze({ x: x | 0, y: y | 0 });
        });
      };
      table.push(
        Object.freeze({
          kind,
          name,
          program,
          group,
          most,
          nightGroup,
          nightMost,
          day: Object.freeze(points(day, "day")),
          night: Object.freeze(points(night, "night")),
        }),
      );
    }
  } catch (error) {
    if (error instanceof KindError) throw error;
    throw new KindError("the spawn table could not be read");
  }
  return Object.freeze(table);
}

/** A tile an attack is about to land on. It lands when its attacker's wind-up runs out. */
export interface Mark {
  readonly x: number;
  readonly y: number;
  /** Id of the attacker. */
  readonly by: number;
}

export interface Actor {
  readonly id: number;
  readonly name: string;
  /** The tile the actor occupies. While it walks, this is already the tile it is stepping onto. */
  x: number;
  y: number;
  /** The tile it is stepping from; equal to (x, y) when standing. For drawing only. */
  fromX: number;
  fromY: number;
  /** Ticks left in the current step; 0 when standing. */
  moveTicksLeft: number;
  /** Tiles still to step onto, in order. */
  path: Point[];
  /** Ticks left to stand still before the program is asked again. */
  wait: number;
  /**
   * Ticks spent waiting for the next tile on the path to clear. Below
   * BLOCKED_PATIENCE_TICKS the walk has not yet been re-routed; from there up to
   * twice that, it has, and the next hold-up ends the walk. A decision resets it.
   */
  blocked: number;
  /** Name of the program that decides for this actor; one of the world's. */
  readonly program: string;
  /** The program's memory slots, kept between decisions. */
  memory: number[];
  /**
   * Index of the rule that was running when the last decision ended (the rule
   * that chose the action, or the one that faulted), or -1 before its first
   * decision and after a down (see `mending`). For showing why an actor does
   * what it does.
   */
  rule: number;
  /** Index into FAULTS of how the last decision ended; 0 is no fault. A faulted actor stands confused. */
  fault: number;
  /** ADVENTURER, or the name of one of the world's monster kinds. */
  readonly kind: string;
  hp: number;
  /** Ticks until this actor's attack lands; 0 when it is not attacking. It cannot act meanwhile. */
  windup: number;
  /** Ticks left before it can act again after a hit. */
  recover: number;
  /**
   * The part of the day a monster from the spawn table came out for; it goes
   * home when that part is over. Empty for adventurers and for monsters put in
   * by an input, which stay.
   */
  readonly shift: Shift;
  /**
   * Decisions in a row that chose to walk somewhere and found nowhere to go, up
   * to MAX_STALLED. Programs read it as `stalled`.
   */
  stalled: number;
  /** Experience in each skill, in SKILLS order. All 0 for a monster, which has no skills. */
  xp: number[];
  /** BAG_SLOTS slots, each 0 for empty or a good's id (see GOODS). Always empty for a monster. */
  bag: number[];
  /** How many of each good this actor has banked, in GOODS order. Always 0 for a monster. */
  bank: number[];
  /** Times this adventurer has been struck down, up to MAX_DEATHS. Always 0 for a monster, which leaves the world. */
  deaths: number;
  /** The weapon family an adventurer fights with. Empty for a monster, which strikes in its kind's line. */
  readonly weapon: Family | "";
  /** The way its blow faces, as an index into DIRECTIONS: the one being wound up, or else the last. */
  aim: number;
  /**
   * Knockback not yet come to a whole tile, in quarter tiles along each axis,
   * from -3 to 3. A step of its own puts it back to 0.
   */
  knockX: number;
  knockY: number;
  /** Drinks left in an adventurer's flask, up to FLASK_DRINKS. Always 0 for a monster. */
  flask: number;
  /**
   * Kills towards the next drink back, below KILLS_PER_DRINK. Only counted
   * while a drink is missing, so 0 with a full flask, and always 0 for a monster.
   */
  kills: number;
  /** The statuses hits have left on it, and their lockouts (status.ts). */
  status: Status;
}

/**
 * An arrow in flight. It moves a tile a tick in direction `aim` and stops in
 * the first enemy of its shooter it meets, at a wall or the edge of its
 * region, or when it has flown ARROW_RANGE tiles.
 */
export interface Arrow {
  /** Id of the adventurer that loosed it. */
  readonly by: number;
  /** The tile it is over. */
  readonly x: number;
  readonly y: number;
  readonly aim: number;
  /** Tiles it has still to fly, 1 to ARROW_RANGE. */
  readonly left: number;
  /** The shooter's blow when it was loosed, and whether that swing crit. */
  readonly blow: number;
  readonly crit: boolean;
}

export type Shift = "" | "day" | "night";
const SHIFTS: readonly Shift[] = ["", "day", "night"];

/** Validated programs by name. Like the map, they are content: fixed for the life of a world. */
export type Programs = Readonly<Record<string, Program>>;

export interface World {
  /** The regions and the exits between them. */
  readonly atlas: Atlas;
  readonly programs: Programs;
  readonly kinds: Kinds;
  readonly spawns: Spawns;
  tick: number;
  rng: Rng;
  nextActorId: number;
  /** In id order, which is also update order. */
  actors: Actor[];
  /** Tiles that attacks in wind-up are about to land on, in the order the attacks began. */
  marks: Mark[];
  /** Per region, in the atlas's order, the tick from which the next group of monsters may arrive there. */
  nextSpawn: number[];
  /** What each of the atlas's nodes has left, in the atlas's order. */
  nodes: NodeState[];
  /** Arrows in flight, in the order they were loosed. */
  arrows: Arrow[];
}

export type Input =
  | ({
      readonly type: "spawn";
      readonly name: string;
      /** The program to run; must be one of the world's. */
      readonly program: string;
      /** A monster kind from the world's table. Left out, the actor is an adventurer. */
      readonly kind?: string;
      /** An adventurer's weapon family; left out, a blade. A monster takes none. */
      readonly weapon?: Family;
    } & Point)
  | ChatInput;

/**
 * Validates a program table and returns a frozen copy with no prototype, so a
 * name can never reach a built-in property and nothing can change a program
 * after it was checked. Throws a ProgramError for a bad name or program.
 */
export function checkPrograms(programs: Programs): Programs {
  const table: Record<string, Program> = Object.create(null);
  try {
    for (const name of Object.keys(programs).sort()) {
      if (!PROGRAM_NAME.test(name)) throw new ProgramError(`"${name}" is not a valid program name`);
      table[name] = validateProgram(programs[name]);
    }
  } catch (error) {
    // Whatever was passed in, the only thing that comes out is a ProgramError.
    if (error instanceof ProgramError) throw error;
    throw new ProgramError("the program table could not be read");
  }
  return Object.freeze(table);
}

/**
 * Throws a ProgramError if `programs` holds a bad name or an invalid program,
 * and a KindError if `kinds` holds a bad monster kind or `spawns` a bad spawn.
 * A single map is a world of one region; it throws a MapError if it has no
 * camp or ground that cannot be reached from it.
 */
export function createWorld(
  ground: TileMap | Atlas,
  seed: number,
  programs: Programs = {},
  kinds: Kinds = {},
  spawns: Spawns = [],
): World {
  const atlas = atlasOf(ground);
  const programTable = checkPrograms(programs);
  const kindTable = checkKinds(kinds);
  return {
    atlas,
    programs: programTable,
    kinds: kindTable,
    spawns: checkSpawns(spawns, atlas, programTable, kindTable),
    tick: 0,
    rng: createRng(seed),
    nextActorId: 1,
    actors: [],
    marks: [],
    nextSpawn: atlas.regions.map(() => 0),
    nodes: fullNodes(atlas),
    arrows: [],
  };
}

/** The numbers an actor fights with. */
export const kindOf = (world: World, actor: Actor): Kind =>
  actor.kind === ADVENTURER ? ADVENTURER_KIND : (world.kinds[actor.kind] as Kind);

/**
 * The tiles an actor's attack lands on in one direction: a line out from it,
 * as long as its reach, cut short by anything that cannot be walked on and by
 * the edge of its region: fights stay in one region.
 */
export function lineOfAttack(world: World, actor: Actor, sx: number, sy: number): Point[] {
  const { atlas } = world;
  const region = regionAt(atlas, actor.x, actor.y);
  const tiles: Point[] = [];
  for (let k = 1; k <= kindOf(world, actor).reach; k++) {
    const tile = { x: actor.x + sx * k, y: actor.y + sy * k };
    if (!walkable(atlas, tile.x, tile.y) || regionAt(atlas, tile.x, tile.y) !== region) break;
    tiles.push(tile);
  }
  return tiles;
}

/**
 * The tiles an actor's blow facing `aim` (an index into DIRECTIONS) lands on.
 * A monster strikes in its kind's line. An adventurer's weapon gives the
 * shape, without the tiles that cannot be walked on or are in another region;
 * a spear's or a bow's line ends at the first of those.
 */
export function blowTiles(world: World, actor: Actor, aim: number): Point[] {
  const [sx, sy] = DIRECTIONS[aim] as readonly [number, number];
  if (actor.weapon === "") return lineOfAttack(world, actor, sx, sy);
  const { atlas } = world;
  const region = regionAt(atlas, actor.x, actor.y);
  const tiles: Point[] = [];
  for (const offset of blowShape(actor.weapon, aim)) {
    const tile = { x: actor.x + offset.x, y: actor.y + offset.y };
    if (walkable(atlas, tile.x, tile.y) && regionAt(atlas, tile.x, tile.y) === region)
      tiles.push(tile);
    else if (isLine(actor.weapon)) break;
  }
  return tiles;
}

const MELEE = SKILLS.indexOf("melee");

/** An adventurer's Arms, which its Melee level stands in for until the deck's citizens have Arms. */
export const armsOf = (actor: Actor): number => levelFor(actor.xp[MELEE] as number);

/**
 * An actor's wind-up and recovery: its weapon's at its Arms for an
 * adventurer, its kind's for a monster, and half as long again while it is chilled.
 */
export function blowTimesOf(world: World, actor: Actor): BlowTimes {
  const { windup, recovery } =
    actor.weapon === "" ? kindOf(world, actor) : blowTimes(actor.weapon, armsOf(actor));
  if (actor.status.chill === 0) return { windup, recovery, carry: 0 };
  return { windup: slowed(windup), recovery: slowed(recovery), carry: 0 };
}

/** A monster's rank and level; an adventurer has neither, and reads as level-1 fodder. */
export const rankOf = (world: World, actor: Actor): Rank => kindOf(world, actor).rank ?? "fodder";
export const levelOf = (world: World, actor: Actor): number => kindOf(world, actor).level ?? 1;

/** The element of the landing that (x, y) is on, if it has one. */
export function elementAt(world: World, x: number, y: number): Element | undefined {
  const { atlas } = world;
  const element = (atlas.regions[regionAt(atlas, x, y)] as Region).map.element;
  return element === "none" ? undefined : element;
}

/** How far an actor's blow reaches, as `weapon_reach` reads it. */
export const reachOf = (world: World, actor: Actor): number =>
  actor.weapon === "" ? kindOf(world, actor).reach : WEAPONS[actor.weapon].reach;

/** Adventurers and monsters are enemies; nobody else is. */
export const enemies = (a: Actor, b: Actor): boolean =>
  (a.kind === ADVENTURER) !== (b.kind === ADVENTURER);

/**
 * Is `actor` a resident lying at camp after a down, not yet up? A down leaves
 * it waiting with no rule in charge and no fault (rule -1, fault 0), which no
 * decision does, until the wait runs out. Blows pass it by, and monsters'
 * sensors leave it out.
 */
export const mending = (actor: Actor): boolean =>
  actor.kind === ADVENTURER && actor.wait > 0 && actor.rule === -1 && actor.fault === 0;

export const actorAt = (world: World, x: number, y: number): Actor | undefined =>
  firstAt(gridOf(world), x, y, () => true);

/**
 * Whether `a` and `b` get in each other's way. Adventurers walk through each
 * other, so no one can hold a narrow way against the rest; anything involving
 * a monster blocks.
 */
export const blocks = (a: Actor, b: Actor): boolean =>
  a !== b && (a.kind !== ADVENTURER || b.kind !== ADVENTURER);

/** Someone on (x, y) who gets in `mover`'s way, if anyone does. */
export const blockerAt = (world: World, x: number, y: number, mover: Actor): Actor | undefined =>
  firstAt(gridOf(world), x, y, (a) => blocks(a, mover));

/**
 * Something that happened during a tick, for whoever is watching: the ticker,
 * the spotlight, the metrics. Events are an output of `step`, not part of the
 * world's state; nothing in the simulation reads them back.
 */
export type WorldEvent =
  | {
      readonly type: "decide";
      readonly tick: number;
      readonly actor: number;
      /** Index of the rule that chose the action, into the actor's program's rules. */
      readonly rule: number;
      /** Name of the action, as in the system call table. */
      readonly action: string;
    }
  | {
      readonly type: "fault";
      readonly tick: number;
      readonly actor: number;
      /** Name of the fault, as in FAULTS. */
      readonly fault: string;
    }
  | {
      /** An attack began: these tiles are marked until it lands. */
      readonly type: "attack";
      readonly tick: number;
      readonly actor: number;
      readonly tiles: readonly Point[];
      /** Ticks until it lands. */
      readonly lands: number;
    }
  | {
      readonly type: "hit";
      readonly tick: number;
      readonly actor: number;
      readonly target: number;
      /** What it took off, as `hit` in hit.ts works it out. */
      readonly damage: number;
      /** Whether the swing crit. A swing that lands on several crits on all or none. */
      readonly crit: boolean;
      /** The type that did most of it. */
      readonly damageType: DamageType;
      /** The target's hitpoints afterwards; 0 or less means it is out. */
      readonly hp: number;
      /** On an arc, the shocked monster it arced from; a blow has none. */
      readonly arcFrom?: number;
    }
  | {
      /** An attack landed on a tile with no enemy on it. */
      readonly type: "miss";
      readonly tick: number;
      readonly actor: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      /** An actor ran out of hitpoints. A monster is gone; an adventurer wakes at camp. */
      readonly type: "down";
      readonly tick: number;
      readonly actor: number;
      readonly name: string;
      readonly kind: string;
      /** Id of whoever struck the last blow. */
      readonly by: number;
      /** Where it fell. */
      readonly x: number;
      readonly y: number;
    }
  | {
      /** A monster went home because the part of the day it came out for is over. */
      readonly type: "leave";
      readonly tick: number;
      readonly actor: number;
      readonly name: string;
      readonly kind: string;
      /** Where it was last. */
      readonly x: number;
      readonly y: number;
    }
  | {
      /** An adventurer's experience in a skill reached a new level. */
      readonly type: "level";
      readonly tick: number;
      readonly actor: number;
      readonly skill: Skill;
      readonly level: number;
    }
  | {
      /** Goods went from an adventurer's bag into its bank, or out of the bank into the bag. */
      readonly type: "deposit" | "withdraw";
      readonly tick: number;
      readonly actor: number;
      /** A name from GOODS. */
      readonly good: string;
      readonly count: number;
    }
  | {
      /** An adventurer's `chop` or `fish` got a good from a node. */
      readonly type: "gather";
      readonly tick: number;
      readonly actor: number;
      /** Index of the node, into the atlas's nodes. */
      readonly node: number;
      /** A name from GOODS. */
      readonly good: string;
    }
  | {
      /** A node gave its last good (`deplete`), or stands again with its full yield (`regrow`). */
      readonly type: "deplete" | "regrow";
      readonly tick: number;
      readonly node: number;
      readonly x: number;
      readonly y: number;
    }
  | {
      /** An adventurer cooked a fish at the fire; `good` is `cooked_fish` or `burnt_fish`. */
      readonly type: "cook";
      readonly tick: number;
      readonly actor: number;
      readonly good: string;
    }
  | {
      /** An adventurer ate a cooked fish. */
      readonly type: "eat";
      readonly tick: number;
      readonly actor: number;
      /** Its hitpoints afterwards. */
      readonly hp: number;
    }
  | {
      readonly type: "drink";
      readonly tick: number;
      readonly actor: number;
      /** Its hitpoints and the drinks left afterwards. */
      readonly hp: number;
      readonly flask: number;
    }
  | {
      /** A drink came back to the flask, for kills. */
      readonly type: "refill";
      readonly tick: number;
      readonly actor: number;
      readonly flask: number;
    }
  | {
      /** An arrow was loosed from (x, y). */
      readonly type: "shoot";
      readonly tick: number;
      readonly actor: number;
      readonly x: number;
      readonly y: number;
      readonly aim: number;
    }
  | {
      /**
       * A hit pushed a body back. It went from (fromX, fromY) to (x, y), which
       * is the same tile when the push was under a whole tile or a wall or
       * someone stood right behind it. `stopped` says it was stopped short.
       */
      readonly type: "knock";
      readonly tick: number;
      readonly actor: number;
      readonly by: number;
      readonly fromX: number;
      readonly fromY: number;
      readonly x: number;
      readonly y: number;
      readonly stopped: boolean;
    }
  | {
      /** A hit, a burn's jump or a shatter set a status on an actor (status.ts). */
      readonly type: "status";
      readonly tick: number;
      readonly actor: number;
      /** Who set it: the one who struck, the burn's setter, or the monster that shattered. */
      readonly by: number;
      readonly status: StatusName;
    }
  | {
      /** A second of a burn did its damage. */
      readonly type: "burn";
      readonly tick: number;
      readonly actor: number;
      /** Who set the burn, whose kill it is. */
      readonly by: number;
      readonly damage: number;
      /** Its hitpoints afterwards. */
      readonly hp: number;
    }
  | {
      /** A frozen monster went down and shattered at (x, y). */
      readonly type: "shatter";
      readonly tick: number;
      readonly actor: number;
      readonly x: number;
      readonly y: number;
    };

/**
 * Advances the world by one tick, and returns what happened in it. This is the
 * only way the world changes.
 */
export function step(world: World, inputs: readonly Input[] = []): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const input of inputs) applyInput(world, input);
  world.tick++;
  regrowNodes(world, events);
  sendHome(world, events);
  spawnMonsters(world);
  landAttacks(world, events);
  // Nobody joins or leaves the world while the actors update, and only a step
  // moves one, so one grid of who stands where serves the whole pass.
  holdGrid(world);
  try {
    for (const actor of world.actors) updateActor(world, actor, events);
  } finally {
    releaseGrid(world);
  }
  return events;
}

/** No gear is worn yet, so no blow carries a line. */
const NO_LINES: readonly Modifier[] = [];
const UNARMOURED: Defender = { armour: 0 };
/** What a shocked target takes from every hit. */
const SHOCKED: Modifier = { kind: "more", pct: SHOCK_MORE };

/**
 * What an actor swings with. An adventurer's blow is the base blow of its
 * Arms, with its weapon family's share of the hit. A monster's is its kind's
 * damage, half of it as the element of the landing it stands on.
 */
export function swingerOf(world: World, actor: Actor, kind: Kind): Attacker {
  if (actor.weapon === "") {
    const element = elementAt(world, actor.x, actor.y);
    return element === undefined
      ? { blow: kind.damage, family: FULL }
      : { blow: kind.damage, family: FULL, element };
  }
  return { blow: blow(armsOf(actor)), family: FAMILY_HIT[actor.weapon] };
}

/**
 * What a hit meets on `target`. Nobody wears armour yet: coats come with
 * wearing gear. A brute or an elite has armour of four times its level, and a
 * monster resists the element of the landing it stands on by 40%.
 */
export function defenderOf(world: World, target: Actor): Defender {
  if (target.kind === ADVENTURER) return UNARMOURED;
  const armour = monsterArmour(rankOf(world, target), levelOf(world, target));
  const element = elementAt(world, target.x, target.y);
  return element === undefined ? { armour } : { armour, resist: { [element]: LANDING_RESIST } };
}

/** How long a status lasts on `actor`. */
const statusTicks = (world: World, actor: Actor): number =>
  statusTicksFor(actor.kind === ADVENTURER, rankOf(world, actor));

/** Who `takeHit` is told it sets statuses on. */
function takerOf(world: World, actor: Actor): Taker {
  const citizen = actor.kind === ADVENTURER;
  return {
    citizen,
    life: kindOf(world, actor).hp,
    level: citizen ? 1 : levelOf(world, actor),
    ticks: statusTicks(world, actor),
  };
}

/**
 * The living monster other than `from` that `fits`, nearest it within `reach`
 * steps (as a king moves) in its region; of those as near, the first in
 * update order.
 */
function nearestOther(
  world: World,
  from: Actor,
  reach: number,
  fits: (other: Actor) => boolean,
): Actor | undefined {
  let best: Actor | undefined;
  let bestSteps = reach + 1;
  for (const other of world.actors) {
    if (other === from || other.hp <= 0 || other.kind === ADVENTURER || !fits(other)) continue;
    const steps = Math.max(Math.abs(other.x - from.x), Math.abs(other.y - from.y));
    if (steps < bestSteps && sameRegion(world, other, from)) {
      best = other;
      bestSteps = steps;
    }
  }
  return best;
}

/**
 * One hit by `attacker` on `target`, worked out by `hit`, and the experience
 * it gives; `struck` records who struck the target last. A target still
 * standing takes the hit's statuses: a stagger starts its wind-up again. A hit
 * on a shocked target takes 20% more, and on a shocked monster arcs to the
 * nearest other monster within 3 tiles for 30% of its lightning part, the
 * hit that downs it too. An arc is a hit that leaves no status and does not
 * arc again; `arcFrom` is the id of the shocked monster it came from, and its
 * event carries it. Returns the hit. `lines` are the attacker's; nobody wears
 * gear yet, so only tests pass any.
 */
export function strike(
  world: World,
  attacker: Actor,
  target: Actor,
  swinger: Attacker,
  crit: boolean,
  events: WorldEvent[],
  struck: Map<number, number>,
  lines: readonly Modifier[] = NO_LINES,
  arcFrom = 0,
): Hit {
  const shocked = target.status.shock > 0;
  const result = hit(
    swinger,
    defenderOf(world, target),
    shocked ? [...lines, SHOCKED] : lines,
    crit,
  );
  const { amount, type } = result;
  // Experience counts the hitpoints a blow actually took, not what it would have.
  const taken = Math.min(amount, target.hp);
  target.hp -= amount;
  struck.set(target.id, attacker.id);
  events.push({
    type: "hit",
    tick: world.tick,
    actor: attacker.id,
    target: target.id,
    damage: amount,
    crit,
    damageType: type,
    hp: target.hp,
    ...(arcFrom === 0 ? {} : { arcFrom }),
  });
  const learner = attacker.kind === ADVENTURER ? attacker : target;
  const skill: Skill = learner === attacker ? "melee" : "hitpoints";
  const level = gainXp(learner.xp, skill, taken * XP_PER_DAMAGE);
  if (level > 0) events.push({ type: "level", tick: world.tick, actor: learner.id, skill, level });
  if (arcFrom !== 0) return result;
  // One downed takes no status, but a shocked monster's last hit still arcs.
  if (target.hp > 0) {
    const took = takeHit(target.status, result.parts, takerOf(world, target), attacker.id);
    // Broken off, the wind-up starts again from the beginning.
    if (took.stagger && target.windup > 0) target.windup = blowTimesOf(world, target).windup;
    for (const status of STATUS_NAMES)
      if (took[status])
        events.push({
          type: "status",
          tick: world.tick,
          actor: target.id,
          by: attacker.id,
          status,
        });
  }
  const lightning = result.parts[3];
  if (!shocked || target.kind === ADVENTURER || lightning === 0) return result;
  const share = (lightning * ARC_SHARE - ((lightning * ARC_SHARE) % FULL)) / FULL;
  const next = share > 0 && nearestOther(world, target, ARC_REACH, (o) => enemies(o, attacker));
  if (next) {
    const added: Modifier = { kind: "added", type: "lightning", amount: share };
    const swinger = { blow: 0, family: FULL };
    strike(world, attacker, next, swinger, false, events, struck, [added], target.id);
  }
  return result;
}

/** The statuses a hit can leave, as its events name them. */
const STATUS_NAMES = ["stagger", "burn", "chill", "freeze", "shock"] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

/**
 * Counts every actor's statuses down a tick. A burn that has burnt a whole
 * second does its damage, which can down a body, and is its setter's blow; at
 * its first second a burn set by a hit jumps, at half strength, to the
 * nearest monster within a tile that is not burning, and that burn does not
 * jump. The jumps are set once every count is down, so a burn is never
 * counted on the tick it is set.
 */
function passStatuses(world: World, events: WorldEvent[], struck: Map<number, number>): void {
  const jumps: { from: Actor; strength: number; by: number }[] = [];
  for (const actor of world.actors) {
    if (actor.hp <= 0) continue;
    const { burnBy: by, burnDamage } = actor.status;
    const { burnt, jump } = passTick(actor.status);
    if (burnt > 0) {
      actor.hp -= burnt;
      struck.set(actor.id, by);
      events.push({
        type: "burn",
        tick: world.tick,
        actor: actor.id,
        by,
        damage: burnt,
        hp: actor.hp,
      });
    }
    const strength = (burnDamage - (burnDamage % 2)) / 2;
    if (jump && strength > 0 && actor.kind !== ADVENTURER)
      jumps.push({ from: actor, strength, by });
  }
  for (const { from, strength, by } of jumps) {
    const next = nearestOther(world, from, BURN_JUMP_REACH, (o) => o.status.burn === 0);
    if (!next) continue;
    setBurn(next.status, strength, by, 0, statusTicks(world, next));
    events.push({ type: "status", tick: world.tick, actor: next.id, by, status: "burn" });
  }
}

/**
 * Whether a body knocked from where it stands one tile by (mx, my) can go
 * there: ground in its own region, with nobody on it who blocks it, and for a
 * diagonal, no wall on either side of the corner it passes.
 */
function knockable(world: World, body: Actor, mx: number, my: number): boolean {
  const { atlas } = world;
  const x = body.x + mx;
  const y = body.y + my;
  if (!walkable(atlas, x, y) || regionAt(atlas, x, y) !== regionAt(atlas, body.x, body.y))
    return false;
  if (mx !== 0 && my !== 0 && !(walkable(atlas, x, body.y) && walkable(atlas, body.x, y)))
    return false;
  return blockerAt(world, x, y, body) === undefined;
}

/**
 * Pushes `body` `quarters` quarter tiles in direction `aim`, on top of what
 * earlier pushes left. Each whole tile moves it a tile, until a tile it
 * cannot be knocked onto stops it; the rest of the push is then lost. Returns
 * whether it moved. One that moves stops walking where it lands. A frozen
 * body stands stock still and is not pushed at all.
 */
function knock(
  world: World,
  body: Actor,
  aim: number,
  quarters: number,
  by: number,
  events: WorldEvent[],
): boolean {
  if (quarters <= 0 || body.hp <= 0 || body.status.freeze > 0) return false;
  const [sx, sy] = DIRECTIONS[aim] as readonly [number, number];
  let kx = body.knockX + sx * quarters;
  let ky = body.knockY + sy * quarters;
  const fromX = body.x;
  const fromY = body.y;
  const whole = (n: number): number =>
    n >= QUARTERS_PER_TILE ? 1 : n <= -QUARTERS_PER_TILE ? -1 : 0;
  let stopped = false;
  for (;;) {
    const mx = whole(kx);
    const my = whole(ky);
    if (mx === 0 && my === 0) break;
    if (!knockable(world, body, mx, my)) {
      kx = 0;
      ky = 0;
      stopped = true;
      break;
    }
    putAt(world, body, body.x + mx, body.y + my);
    kx -= mx * QUARTERS_PER_TILE;
    ky -= my * QUARTERS_PER_TILE;
  }
  body.knockX = kx;
  body.knockY = ky;
  const moved = body.x !== fromX || body.y !== fromY;
  if (moved) {
    body.moveTicksLeft = 0;
    setPath(world, body, []);
    body.blocked = 0;
  }
  events.push({
    type: "knock",
    tick: world.tick,
    actor: body.id,
    by,
    fromX,
    fromY,
    x: body.x,
    y: body.y,
    stopped,
  });
  return moved;
}

/**
 * Moves the marks of `body`'s blow to where it now stands, facing the same
 * way, and returns them. A body knocked back in its wind-up takes its blow
 * with it; aimed at a wall, the blow lands on nothing.
 */
function reaim(world: World, body: Actor): Mark[] {
  dropMarks(world, body.id);
  const marks = blowTiles(world, body, body.aim).map((tile) => ({ ...tile, by: body.id }));
  for (const mark of marks) addMark(world, mark);
  return marks;
}

/**
 * Flies every arrow on a tile: into the first enemy of its shooter on that
 * tile, which it hits and stops in, or on, or out at a wall, at its region's
 * edge or at the end of its range.
 */
function flyArrows(
  world: World,
  events: WorldEvent[],
  struck: Map<number, number>,
  push: (body: Actor, aim: number, quarters: number, by: number) => void,
): void {
  if (world.arrows.length === 0) return;
  const { atlas } = world;
  const grid = gridOf(world);
  const flying: Arrow[] = [];
  for (const arrow of world.arrows) {
    const [sx, sy] = DIRECTIONS[arrow.aim] as readonly [number, number];
    const x = arrow.x + sx;
    const y = arrow.y + sy;
    // Adventurers never leave the world, so the shooter is still in it.
    const shooter = grid.byId.get(arrow.by) as Actor;
    const inWay = (a: Actor): boolean => a.hp > 0 && enemies(a, shooter) && !mending(a);
    // An enemy that came onto the arrow's own tile since it got there is in its way too.
    const met = firstAt(grid, arrow.x, arrow.y, inWay);
    if (
      !met &&
      (!walkable(atlas, x, y) || regionAt(atlas, x, y) !== regionAt(atlas, arrow.x, arrow.y))
    ) {
      events.push({ type: "miss", tick: world.tick, actor: arrow.by, x: arrow.x, y: arrow.y });
      continue;
    }
    const target = met ?? firstAt(grid, x, y, inWay);
    if (target) {
      const swinger = { blow: arrow.blow, family: FAMILY_HIT.bow };
      const { parts } = strike(world, shooter, target, swinger, arrow.crit, events, struck);
      // Knockback is physical: a hit with no physical part pushes nobody.
      if (parts[0] > 0) push(target, arrow.aim, WEAPONS.bow.knockback, shooter.id);
      continue;
    }
    if (arrow.left <= 1) {
      events.push({ type: "miss", tick: world.tick, actor: arrow.by, x, y });
      continue;
    }
    flying.push({ ...arrow, x, y, left: arrow.left - 1 });
  }
  world.arrows = flying;
}

/**
 * Counts the statuses down and burns, flies the arrows, counts every wind-up
 * down but a frozen one, lands the blows that are due, and takes out whoever
 * has no hitpoints left. A frozen monster that goes down shatters and chills
 * everyone standing within 2 tiles, citizens too.
 */
function landAttacks(world: World, events: WorldEvent[]): void {
  // Who struck each target last, which is who downs it.
  const struck = new Map<number, number>();
  // Each attacker's marks, in the order they were made.
  const marksBy = new Map<number, Mark[]>();
  for (const mark of world.marks) {
    const own = marksBy.get(mark.by);
    if (own) own.push(mark);
    else marksBy.set(mark.by, [mark]);
  }
  const push = (body: Actor, aim: number, quarters: number, by: number): void => {
    if (knock(world, body, aim, quarters, by, events) && body.windup > 0)
      marksBy.set(body.id, reaim(world, body));
  };
  const landed = new Set<number>();
  // Bodies are knocked back while blows land, so the grid is kept in step with them.
  holdGrid(world);
  try {
    passStatuses(world, events, struck);
    flyArrows(world, events, struck, push);
    const grid = gridOf(world);
    for (const attacker of world.actors) {
      if (attacker.windup === 0 || attacker.status.freeze > 0) continue;
      attacker.windup--;
      // Someone struck down earlier this tick does not get its own blow in.
      if (attacker.windup > 0 || attacker.hp <= 0) continue;
      const kind = kindOf(world, attacker);
      attacker.recover = blowTimesOf(world, attacker).recovery;
      landed.add(attacker.id);
      const citizen = attacker.kind === ADVENTURER;
      const swinger = swingerOf(world, attacker, kind);
      // One roll a swing, however many it lands on; monsters do not crit.
      const crit = citizen && rollCrit(world.rng, NO_LINES);
      if (attacker.weapon === "bow") {
        // The arrow sets off from the bow and flies from the next tick on.
        const { id: by, x, y, aim } = attacker;
        world.arrows.push({ by, x, y, aim, left: ARROW_RANGE, blow: swinger.blow, crit });
        events.push({ type: "shoot", tick: world.tick, actor: by, x, y, aim });
        continue;
      }
      // Every enemy on the blow's tiles is hit before anyone is knocked back,
      // so nobody is hit twice by one blow. Adventurers can share a tile, so
      // a blow lands on every enemy standing there. One mending at camp after
      // a down is passed by.
      const targets: Actor[] = [];
      for (const mark of marksBy.get(attacker.id) ?? []) {
        const here = allAt(
          grid,
          mark.x,
          mark.y,
          (a) => a.hp > 0 && enemies(a, attacker) && !mending(a),
        );
        if (here.length === 0)
          events.push({ type: "miss", tick: world.tick, actor: attacker.id, x: mark.x, y: mark.y });
        targets.push(...here);
      }
      // Knockback is physical: one hit with no physical part is not pushed.
      // One an arc from this blow has downed already is passed by.
      const pushed = targets.filter(
        (target) =>
          target.hp > 0 &&
          strike(world, attacker, target, swinger, crit, events, struck).parts[0] > 0,
      );
      // The farthest along the blow is pushed first, so one in front is not
      // stopped by the one behind it a moment before that one moves. Bodies
      // as far along keep the order they were hit in.
      const quarters = attacker.weapon === "" ? 0 : WEAPONS[attacker.weapon].knockback;
      const [ax, ay] = DIRECTIONS[attacker.aim] as readonly [number, number];
      const along = (t: Actor): number => (t.x - attacker.x) * ax + (t.y - attacker.y) * ay;
      const order = pushed.map((target, i) => ({ target, i, far: along(target) }));
      order.sort((p, q) => q.far - p.far || p.i - q.i);
      for (const { target } of order) push(target, attacker.aim, quarters, attacker.id);
    }
  } finally {
    releaseGrid(world);
  }
  if (landed.size > 0) world.marks = world.marks.filter((mark) => !landed.has(mark.by));
  const out = world.actors.filter((actor) => actor.hp <= 0);
  if (out.length === 0) return;
  // A kill brings a drink back to a flask that is missing one, every KILLS_PER_DRINK kills.
  const byId = new Map(world.actors.map((actor) => [actor.id, actor]));
  for (const actor of out) {
    const killer = byId.get(struck.get(actor.id) ?? 0);
    if (actor.kind === ADVENTURER || killer?.kind !== ADVENTURER) continue;
    if (killer.flask >= FLASK_DRINKS) continue;
    killer.kills++;
    if (killer.kills < KILLS_PER_DRINK) continue;
    killer.kills = 0;
    killer.flask++;
    events.push({ type: "refill", tick: world.tick, actor: killer.id, flask: killer.flask });
  }
  const gone = new Set(out.map((actor) => actor.id));
  world.marks = world.marks.filter((mark) => !gone.has(mark.by));
  world.actors = world.actors.filter((actor) => actor.hp > 0 || actor.kind === ADVENTURER);
  for (const actor of out) {
    if (actor.kind === ADVENTURER || actor.status.freeze === 0) continue;
    events.push({ type: "shatter", tick: world.tick, actor: actor.id, x: actor.x, y: actor.y });
    for (const other of world.actors) {
      const steps = Math.max(Math.abs(other.x - actor.x), Math.abs(other.y - actor.y));
      if (other.hp <= 0 || steps > SHATTER_REACH || mending(other)) continue;
      if (!sameRegion(world, other, actor)) continue;
      other.status.chill = statusTicks(world, other);
      events.push({
        type: "status",
        tick: world.tick,
        actor: other.id,
        by: actor.id,
        status: "chill",
      });
    }
  }
  // One that dies is replaced a wait later at the earliest, in the region it was in.
  for (const actor of out)
    if (actor.kind !== ADVENTURER) holdSpawns(world, regionAt(world.atlas, actor.x, actor.y));
  for (const actor of out) {
    events.push({
      type: "down",
      tick: world.tick,
      actor: actor.id,
      name: actor.name,
      kind: actor.kind,
      by: struck.get(actor.id) ?? 0,
      x: actor.x,
      y: actor.y,
    });
    if (actor.kind !== ADVENTURER) continue;
    // An adventurer is carried back to camp and rests there. What it loses by this is not decided here.
    const bed = freeTileNear(world, place(world.atlas, "camp"), actor) ?? actor;
    putAt(world, actor, bed.x, bed.y);
    actor.moveTicksLeft = 0;
    setPath(world, actor, []);
    actor.blocked = 0;
    actor.windup = 0;
    actor.recover = 0;
    actor.knockX = 0;
    actor.knockY = 0;
    actor.wait = DOWN_TICKS;
    // No rule is in charge while it mends; see `mending`.
    actor.rule = -1;
    actor.fault = 0;
    actor.hp = ADVENTURER_KIND.hp;
    actor.deaths = Math.min(MAX_DEATHS, actor.deaths + 1);
    // Camp stands in for the deck, where a flask fills again, until the deck is built.
    actor.flask = FLASK_DRINKS;
    actor.kills = 0;
    actor.status = noStatus();
  }
}

/**
 * The walkable tile nearest `from`, by walking, that nobody but `self` stands
 * on or is walking to, or null if there is none. Among tiles as near as each
 * other, `self`'s own tile comes first, so someone already as close as they can
 * get stays put. If every reachable tile is taken that way, the nearest one
 * nobody else stands on will do, as someone walking there may yet stop short.
 */
export function freeTileNear(world: World, from: Point, self?: Actor): Point | null {
  const { atlas } = world;
  if (!walkable(atlas, from.x, from.y)) return null;
  const standing = new Set<number>();
  const making = new Set<number>();
  for (const other of world.actors) {
    if (other === self) continue;
    standing.add(tileAt(atlas, other.x, other.y));
    const end = other.path[other.path.length - 1];
    if (end) making.add(tileAt(atlas, end.x, end.y));
  }
  return (
    nearestUntaken(world, from, self, (i) => standing.has(i) || making.has(i)) ??
    nearestUntaken(world, from, self, (i) => standing.has(i))
  );
}

function nearestUntaken(
  world: World,
  from: Point,
  self: Actor | undefined,
  taken: (index: number) => boolean,
): Point | null {
  const { atlas } = world;
  const seen = new Set<number>([tileAt(atlas, from.x, from.y)]);
  let ring: Point[] = [{ x: from.x, y: from.y }];
  while (ring.length > 0) {
    let found: Point | null = null;
    for (const at of ring) {
      if (taken(tileAt(atlas, at.x, at.y))) continue;
      if (self && self.x === at.x && self.y === at.y) return at;
      if (!found) found = at;
    }
    if (found) return found;
    const next: Point[] = [];
    for (const at of ring) {
      for (const [dx, dy] of NEIGHBOURS) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!linked(atlas, at.x, at.y, x, y) || seen.has(tileAt(atlas, x, y))) continue;
        seen.add(tileAt(atlas, x, y));
        next.push({ x, y });
      }
    }
    ring = next;
  }
  return null;
}

function applyInput(world: World, input: Input): void {
  // An input that cannot be honoured is dropped; it never throws and never half-applies.
  // Inputs come from outside the simulation, so nothing about their shape is assumed.
  const raw: unknown = input;
  if (typeof raw !== "object" || raw === null) return;
  let fields: Record<string, unknown>;
  try {
    // Read every field once, before anything changes, so a property that throws changes nothing.
    const { type, name, x, y, program, kind, weapon, account, role } = raw as Record<
      string,
      unknown
    >;
    fields = { type, name, x, y, program, kind, weapon, account, role };
  } catch {
    return;
  }
  const { type, name } = fields;
  if (type === "join") {
    join(world, fields.account, name, fields.role);
    return;
  }
  // The other chat inputs have no effect yet (see inputs.ts).
  if (type !== "spawn") return;
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) return;
  if (!isInt32(fields.x) || !isInt32(fields.y)) return;
  // `| 0` turns a negative zero into zero, so the stored position is what a snapshot would hold.
  const x = fields.x | 0;
  const y = fields.y | 0;
  if (!walkable(world.atlas, x, y) || actorAt(world, x, y)) return;
  const { program } = fields;
  if (typeof program !== "string" || !Object.hasOwn(world.programs, program)) return;
  // Ids stay within 32 bits, so a world that has handed out every one takes no more actors.
  if (world.nextActorId >= MAX_ACTOR_ID) return;
  const kind = fields.kind ?? ADVENTURER;
  if (typeof kind !== "string") return;
  // Checked before a monster holds its region's spawns, so a spawn dropped for its weapon holds none.
  const weapon = fields.weapon ?? "blade";
  if (!FAMILIES.includes(weapon as Family) || (kind !== ADVENTURER && fields.weapon !== undefined))
    return;
  if (kind !== ADVENTURER) {
    // A monster put in by hand counts against its region's cap and wait like any other.
    if (!Object.hasOwn(world.kinds, kind)) return;
    const region = regionAt(world.atlas, x, y);
    if (!spawnGround(world.atlas, x, y) || monstersIn(world, region) >= capFor(world, region))
      return;
    // Inputs are applied before the tick moves on, and the monster is first in
    // the world on that next tick, so the hour is counted from there.
    holdSpawns(world, region, world.tick + 1);
  }
  addActor(world, name, x, y, program, kind, "", weapon as Family);
}

/**
 * A chatter's first message makes their citizen: an adventurer named by their
 * username, on NEWCOMER_PROGRAM, on the free tile nearest the camp. A name
 * already in the world, in any capitals, is taken to be that chatter's
 * citizen, so a second join changes nothing. The account is checked and not
 * yet kept; the hatch, the name rule and colours from the account are C3's.
 */
function join(world: World, account: unknown, name: unknown, role: unknown): void {
  if (typeof account !== "string" || !ACCOUNT.test(account)) return;
  if (typeof name !== "string" || !USERNAME.test(name)) return;
  if (!ROLES.some((each) => each === role)) return;
  if (!Object.hasOwn(world.programs, NEWCOMER_PROGRAM)) return;
  if (world.nextActorId >= MAX_ACTOR_ID) return;
  const lower = name.toLowerCase();
  if (world.actors.some((actor) => actor.kind === ADVENTURER && actor.name.toLowerCase() === lower))
    return;
  const at = freeTileNear(world, place(world.atlas, "camp"));
  if (!at) return;
  addActor(world, name, at.x, at.y, NEWCOMER_PROGRAM, ADVENTURER, "");
}

/**
 * How far the camp's firelight reaches, in tiles, straight-line from the
 * `camp` place. The viewer's lantern light fades out at about this distance.
 */
export const LIGHT_REACH = 5;

/** Whether tile (x, y) is in the camp's firelight: in the camp's region and within LIGHT_REACH of `camp`. */
export function inFirelight(world: World, x: number, y: number): boolean {
  const camp = place(world.atlas, "camp");
  if (!walkable(world.atlas, x, y) || !sameRegion(world, camp, { x, y })) return false;
  const dx = x - camp.x;
  const dy = y - camp.y;
  return dx * dx + dy * dy <= LIGHT_REACH * LIGHT_REACH;
}

/** Is it the part of the day when monsters come out at their night places? */
export function isNight(world: World): boolean {
  const { hour } = clock(world);
  return hour >= NIGHT_HOUR || hour < DAY_HOUR;
}

/** The most monsters a region may hold at this time of day. */
export function capFor(world: World, region: number): number {
  const cap = isNight(world) ? MONSTER_CAPS.night : MONSTER_CAPS.day;
  let residents = 0;
  for (const actor of world.actors)
    if (actor.kind === ADVENTURER && regionAt(world.atlas, actor.x, actor.y) === region)
      residents++;
  return Math.min(cap.most, cap.base + Math.floor(residents / cap.residents));
}

/** How many monsters are in the region with this index. */
export const monstersIn = (world: World, region: number): number =>
  world.actors.filter(
    (actor) => actor.kind !== ADVENTURER && regionAt(world.atlas, actor.x, actor.y) === region,
  ).length;

/** How many actors, adventurers and monsters, are in the region with this index. */
export const actorsIn = (world: World, region: number): number =>
  world.actors.filter((actor) => regionAt(world.atlas, actor.x, actor.y) === region).length;

/** No group arrives in the region for RESPAWN_TICKS from now. */
const holdSpawns = (world: World, region: number, from = world.tick): void => {
  world.nextSpawn[region] = Math.max(world.nextSpawn[region] as number, from + RESPAWN_TICKS);
};

/**
 * Sends home the monsters out for the part of the day that is over, each once
 * no adventurer in its region is within LEAVE_DISTANCE and it is not in the
 * middle of a blow. One that is still fighting stays until it is clear.
 */
function sendHome(world: World, events: WorldEvent[]): void {
  const now: Shift = isNight(world) ? "night" : "day";
  let grid: Grid | undefined;
  const going = world.actors.filter((actor) => {
    if (actor.shift === "" || actor.shift === now || actor.windup !== 0) return false;
    grid ??= gridOf(world);
    const near = (other: Actor): boolean =>
      other.kind === ADVENTURER && sameRegion(world, other, actor);
    const area = world.atlas.regions[regionAt(world.atlas, actor.x, actor.y)] as Region;
    return countWithin(grid, actor.x, actor.y, LEAVE_DISTANCE, area, near) === 0;
  });
  if (going.length === 0) return;
  const gone = new Set(going);
  world.actors = world.actors.filter((actor) => !gone.has(actor));
  for (const actor of going) {
    const { id, name, kind, x, y } = actor;
    events.push({ type: "leave", tick: world.tick, actor: id, name, kind, x, y });
  }
}

/**
 * Region by region, in the atlas's order, brings in a whole group of monsters
 * when it is time there and the group fits: under the region's cap (capFor,
 * which counts monsters only and grows with the residents there), and on free
 * tiles within GROUP_SPREAD steps of one of its places in that region. A group
 * that does not fit near its place does not come, and the region's wait starts
 * again. While a region is at its cap its wait starts again too. A spawn whose
 * number by night is a range has the number drawn, and comes in as many of it
 * as there is room for, at least its fewest.
 */
function spawnMonsters(world: World): void {
  if (world.spawns.length === 0) return;
  const night = isNight(world);
  const { atlas } = world;
  const placesIn = (spawn: Spawn, region: number): readonly Point[] =>
    (night ? spawn.night : spawn.day).filter((p) => regionAt(atlas, p.x, p.y) === region);
  atlas.regions.forEach((_ground, region) => {
    const alive = monstersIn(world, region);
    const cap = capFor(world, region);
    if (alive >= cap) {
      holdSpawns(world, region);
      return;
    }
    if (world.tick < (world.nextSpawn[region] as number)) return;
    const room = cap - alive;
    const open = world.spawns.filter(
      (spawn) => placesIn(spawn, region).length > 0 && groupOf(spawn, night) <= room,
    );
    // Nothing fits yet; look again when one more has gone.
    if (open.length === 0) return;
    holdSpawns(world, region);
    const spawn = open[nextInt(world.rng, open.length)] as Spawn;
    const places = placesIn(spawn, region);
    const at = places[nextInt(world.rng, places.length)] as Point;
    const fewest = groupOf(spawn, night);
    const most = mostOf(spawn, night);
    const drawn = most > fewest ? fewest + nextInt(world.rng, most - fewest + 1) : fewest;
    const group = Math.min(drawn, room);
    const tiles = groupTiles(world, at, group);
    if (!tiles || world.nextActorId > MAX_ACTOR_ID - group) return;
    for (const tile of tiles) {
      addActor(
        world,
        spawn.name,
        tile.x,
        tile.y,
        spawn.program,
        spawn.kind,
        night ? "night" : "day",
      );
    }
  });
}

/**
 * The first `count` tiles, nearest first by walking, within GROUP_SPREAD steps
 * of `at` and in its region, that a monster can come out on (off the camp's
 * ground) and nobody stands on or is walking to; null if there are not that many.
 */
function groupTiles(world: World, at: Point, count: number): Point[] | null {
  const { atlas } = world;
  const taken = new Set<number>();
  for (const other of world.actors) {
    taken.add(tileAt(atlas, other.x, other.y));
    const end = other.path[other.path.length - 1];
    if (end) taken.add(tileAt(atlas, end.x, end.y));
  }
  const tiles: Point[] = [];
  const seen = new Set<number>([tileAt(atlas, at.x, at.y)]);
  let ring: Point[] = [at];
  for (let depth = 0; depth <= GROUP_SPREAD && tiles.length < count; depth++) {
    const next: Point[] = [];
    for (const tile of ring) {
      const free = !taken.has(tileAt(atlas, tile.x, tile.y)) && spawnGround(atlas, tile.x, tile.y);
      if (free && tiles.length < count) tiles.push(tile);
      for (const [dx, dy] of NEIGHBOURS) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (!stepsFor(atlas, false, tile.x, tile.y, x, y) || seen.has(tileAt(atlas, x, y)))
          continue;
        seen.add(tileAt(atlas, x, y));
        next.push({ x, y });
      }
    }
    ring = next;
  }
  return tiles.length === count ? tiles : null;
}

function addActor(
  world: World,
  name: string,
  x: number,
  y: number,
  program: string,
  kind: string,
  shift: Shift,
  weapon: Family = "blade",
): void {
  const adventurer = kind === ADVENTURER;
  world.actors.push({
    id: world.nextActorId++,
    name,
    x,
    y,
    fromX: x,
    fromY: y,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    blocked: 0,
    program,
    memory: new Array<number>(MEMORY_SLOTS).fill(0),
    rule: -1,
    fault: 0,
    kind,
    hp: (adventurer ? ADVENTURER_KIND : (world.kinds[kind] as Kind)).hp,
    windup: 0,
    recover: 0,
    shift,
    stalled: 0,
    xp: noXp(),
    bag: emptyBag(),
    bank: emptyBank(),
    deaths: 0,
    weapon: adventurer ? weapon : "",
    aim: 0,
    knockX: 0,
    knockY: 0,
    flask: adventurer ? FLASK_DRINKS : 0,
    kills: 0,
    status: noStatus(),
  });
}

function updateActor(world: World, actor: Actor, events: WorldEvent[]): void {
  // Frozen stock still: nothing it was doing goes on.
  if (actor.status.freeze > 0) return;
  // Committed to an attack, or getting its balance back after one.
  if (actor.windup > 0) return;
  if (actor.recover > 0) {
    actor.recover--;
    return;
  }
  if (actor.moveTicksLeft > 0) {
    actor.moveTicksLeft--;
    if (actor.moveTicksLeft > 0) return;
    actor.fromX = actor.x;
    actor.fromY = actor.y;
  }
  const next = actor.path[0];
  if (!next) {
    think(world, actor, events);
    return;
  }
  const ahead = blockerAt(world, next.x, next.y, actor);
  if (ahead) {
    // Someone stands where this actor wants to step. Wait a little, then look
    // once for a way round the people in the way, no more than a couple of
    // steps longer; if that walk is held up too, give it up so the program
    // decides again. Two walkers head to head: only the one that came later
    // turns aside, so the two do not both pick the same detour and meet again.
    actor.blocked++;
    if (actor.blocked === BLOCKED_PATIENCE_TICKS) {
      const facing = ahead.path[0]?.x === actor.x && ahead.path[0]?.y === actor.y;
      if (facing && ahead.id > actor.id) {
        actor.blocked = 0;
        return;
      }
      const goal = actor.path[actor.path.length - 1] as Point;
      const detour = wayTo(world, actor, goal);
      const end = detour[detour.length - 1];
      if (end?.x === goal.x && end.y === goal.y && detour.length <= actor.path.length + 2) {
        setPath(world, actor, detour);
        return;
      }
      setPath(world, actor, []);
      actor.blocked = 0;
    } else if (actor.blocked >= 2 * BLOCKED_PATIENCE_TICKS) {
      setPath(world, actor, []);
      actor.blocked = 0;
    }
    return;
  }
  stepOff(world, actor);
  // A walk that has been re-routed once stays marked as such until the next decision.
  actor.blocked =
    actor.blocked >= BLOCKED_PATIENCE_TICKS && actor.path.length > 0 ? BLOCKED_PATIENCE_TICKS : 0;
  stepOnto(world, actor, next.x, next.y);
  // A step of its own leaves a knocked body square on its tile again.
  actor.knockX = 0;
  actor.knockY = 0;
  actor.moveTicksLeft = stepTicks(world, actor);
}

/** Ticks `actor` takes to walk from one tile to the next, half as long again while it is chilled. */
export function stepTicks(world: World, actor: Actor): number {
  const ticks = kindOf(world, actor).step ?? STEP_TICKS;
  return actor.status.chill > 0 ? slowed(ticks) : ticks;
}

/** Spawn inputs that put the given actors on the free walkable tiles nearest the camp, in order. */
export function spawnsNearCamp(
  world: World,
  cast: readonly { readonly name: string; readonly program: string }[],
): Input[] {
  const { atlas } = world;
  const camp = place(atlas, "camp");
  const seen = new Set<number>([tileAt(atlas, camp.x, camp.y)]);
  const queue: Point[] = [camp];
  const inputs: Input[] = [];
  for (let head = 0; head < queue.length && inputs.length < cast.length; head++) {
    const at = queue[head] as Point;
    if (!actorAt(world, at.x, at.y)) {
      const { name, program } = cast[inputs.length] as (typeof cast)[number];
      inputs.push({ type: "spawn", name, x: at.x, y: at.y, program });
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!linked(atlas, at.x, at.y, x, y) || seen.has(tileAt(atlas, x, y))) continue;
      seen.add(tileAt(atlas, x, y));
      queue.push({ x, y });
    }
  }
  return inputs;
}

export interface Clock {
  /** Days since the world began, starting at 0. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export function clock(world: World): Clock {
  const ticks = world.tick + START_HOUR * TICKS_PER_GAME_HOUR;
  const ofDay = ticks % TICKS_PER_DAY;
  const ofHour = ofDay % TICKS_PER_GAME_HOUR;
  return {
    day: (ticks - ofDay) / TICKS_PER_DAY,
    hour: (ofDay - ofHour) / TICKS_PER_GAME_HOUR,
    minute: (ofHour - (ofHour % TICKS_PER_GAME_MINUTE)) / TICKS_PER_GAME_MINUTE,
  };
}

const programInts = (name: string, program: Program): number[] => [
  ...stringInts(name),
  program.version,
  program.code.length,
  ...program.code,
  program.rules.length,
  ...program.rules.flatMap(stringInts),
];

/** A fingerprint of the program table: names in order, with each program's code and rule labels. */
export function hashPrograms(programs: Programs): string {
  return hashInts(
    Object.keys(programs)
      .sort()
      .flatMap((name) => programInts(name, programs[name] as Program)),
  );
}

/** A fingerprint of one program under its name, so a snapshot can say which programs it ran. */
export const hashProgram = (name: string, program: Program): string =>
  hashInts(programInts(name, program));

/**
 * A fingerprint of the monster kinds: names in order, with each one's numbers.
 * A kind that walks at STEP_TICKS hashes as kinds did before they had a
 * `step`, so snapshots saved then still match; any other step follows its
 * numbers as -1 and the step. Nothing else can stand there (the next kind's
 * name starts with its length), so the two forms never read the same. In the
 * same way, a kind that is not level-1 fodder adds -3, its rank's place in
 * RANKS and its level.
 */
export function hashKinds(kinds: Kinds): string {
  return hashInts(
    Object.keys(kinds)
      .sort()
      .flatMap((name) => {
        const kind = kinds[name] as Kind;
        const step = kind.step ?? STEP_TICKS;
        const rank = kind.rank ?? "fodder";
        const level = kind.level ?? 1;
        return [
          ...stringInts(name),
          kind.hp,
          kind.damage,
          kind.windup,
          kind.recovery,
          kind.reach,
          ...(step === STEP_TICKS ? [] : [-1, step]),
          ...(rank === "fodder" && level === 1 ? [] : [-3, RANK_NAMES.indexOf(rank), level]),
        ];
      }),
  );
}

/** A fingerprint of everything that decides the world's future. */
export function hashWorld(world: World): string {
  return hashWorldAs(world, SNAPSHOT_VERSION);
}

/** Both 32-bit halves of a whole number that may outgrow 32 bits. */
const halves = (n: number): number[] => [
  n % 0x1_0000_0000,
  (n - (n % 0x1_0000_0000)) / 0x1_0000_0000,
];

/**
 * The hash a snapshot of `version` stored. Versions 4 to 6 ran on one map, so
 * they hashed that map and, in versions 5 and 6, one `nextSpawn`. Version 4
 * had no spawn table, no `nextSpawn`, and no `shift` or `stalled` on actors,
 * versions 4 and 5 had no experience, bag or bank, versions before 8 no
 * death count, versions before 9 no nodes, versions before 10 no weapons,
 * aims, knockback, flasks or arrows, and versions before 11 no statuses, so
 * those are left out. Banks before version 9 held the first V8_GOODS goods only.
 */
function hashWorldAs(world: World, version: number): string {
  const { atlas } = world;
  return hashStateAs(world, version, {
    map: version >= 7 ? hashAtlas(atlas) : hashMap((atlas.regions[0] as Region).map),
    programs: hashPrograms(world.programs),
    kinds: hashKinds(world.kinds),
    spawns: hashSpawns(world.spawns),
  });
}

/** The fingerprints of a world's content, as a snapshot of it stores them. */
export interface Prints {
  readonly map: string;
  readonly programs: string;
  readonly kinds: string;
  /** Not hashed in version 4, which had no spawn table. */
  readonly spawns: string;
}

/**
 * The hash a snapshot of `version` stored, with the content given by its
 * fingerprints only. `adopt` uses it to check a snapshot taken with content
 * it no longer has; the world's own atlas, programs, kinds and spawns are not read.
 */
export function hashStateAs(world: World, version: number, prints: Prints): string {
  const { rng } = world;
  const v4 = version === 4;
  const before6 = version < 6;
  const before8 = version < 8;
  const before9 = version < 9;
  const before10 = version < 10;
  const before11 = version < 11;
  return hashInts([
    ...stringInts(prints.map),
    ...stringInts(prints.programs),
    ...stringInts(prints.kinds),
    // The tick outgrows 32 bits after some years of uptime, so both halves are hashed.
    ...halves(world.tick),
    rng.a,
    rng.b,
    rng.c,
    rng.d,
    world.nextActorId,
    world.actors.length,
    ...world.actors.flatMap((a) => [
      a.id,
      ...stringInts(a.name),
      a.x,
      a.y,
      a.fromX,
      a.fromY,
      a.moveTicksLeft,
      a.wait,
      a.blocked,
      a.path.length,
      ...a.path.flatMap((p) => [p.x, p.y]),
      ...stringInts(a.program),
      ...a.memory,
      a.rule,
      a.fault,
      ...stringInts(a.kind),
      a.hp,
      a.windup,
      a.recover,
      ...(v4 ? [] : [SHIFTS.indexOf(a.shift), a.stalled]),
      ...(before6 ? [] : [...a.xp, ...a.bag, ...(before9 ? a.bank.slice(0, V8_GOODS) : a.bank)]),
      ...(before8 ? [] : [a.deaths]),
      ...(before10
        ? []
        : [FAMILIES.indexOf(a.weapon as Family), a.aim, a.knockX, a.knockY, a.flask, a.kills]),
      ...(before11 ? [] : STATUS_FIELDS.map((field) => a.status[field])),
    ]),
    world.marks.length,
    ...world.marks.flatMap((m) => [m.x, m.y, m.by]),
    ...(v4 ? [] : stringInts(prints.spawns)),
    ...(v4
      ? []
      : version < 7
        ? halves(world.nextSpawn[0] as number)
        : [world.nextSpawn.length, ...world.nextSpawn.flatMap(halves)]),
    ...(before9
      ? []
      : [world.nodes.length, ...world.nodes.flatMap((n) => [n.left, ...halves(n.back)])]),
    ...(before10
      ? []
      : [
          world.arrows.length,
          ...world.arrows.flatMap((r) => [r.by, r.x, r.y, r.aim, r.left, r.blow, r.crit ? 1 : 0]),
        ]),
  ]);
}

/**
 * A fingerprint of the spawn table, in order. A spawn that comes in the same
 * number by night as by day hashes as spawns did before they had a night
 * group; any other follows its night places with -1, its fewest by night and
 * its most by night, as in hashKinds. One whose most by day is more than its
 * group then adds -2 and that most.
 */
export function hashSpawns(spawns: Spawns): string {
  return hashInts([
    spawns.length,
    ...spawns.flatMap((s) => [
      ...stringInts(s.kind),
      ...stringInts(s.name),
      ...stringInts(s.program),
      s.group,
      s.day.length,
      ...s.day.flatMap((p) => [p.x, p.y]),
      s.night.length,
      ...s.night.flatMap((p) => [p.x, p.y]),
      ...(groupOf(s, true) === s.group && mostOf(s, true) === s.group
        ? []
        : [-1, groupOf(s, true), mostOf(s, true)]),
      ...(mostOf(s, false) === s.group ? [] : [-2, mostOf(s, false)]),
    ]),
  ]);
}

export const SNAPSHOT_VERSION = 11;
/** How many goods there were up to version 8: `logs`, `raw_fish` and `cooked_fish`. */
const V8_GOODS = 3;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/**
 * The world as text. The maps are not stored, only a fingerprint of the regions
 * and exits. `byProgram` holds a fingerprint of each program by name, so that
 * `adopt` can tell which programs changed; it is not part of the hash.
 */
export function snapshot(world: World): string {
  return JSON.stringify(savedOf(world));
}

/** A blow as a viewer is sent it: what one frame needs to draw it, and nothing else. */
export interface Blow {
  /** Who struck, and whom. */
  readonly by: number;
  readonly target: number;
  /** The hitpoints it took off. */
  readonly amount: number;
  readonly crit: boolean;
  /** The damage type that did most of it. */
  readonly type: DamageType;
  /** An arc's shocked monster, which the arc is drawn from; a blow struck by `by` itself has none. */
  readonly arcFrom?: number;
}
/** The blows among a tick's events, in the order they landed, arcs among them. */
export const blowsOf = (events: readonly WorldEvent[]): Blow[] =>
  events.flatMap((e) =>
    e.type === "hit"
      ? [
          {
            by: e.actor,
            target: e.target,
            amount: e.damage,
            crit: e.crit,
            type: e.damageType,
            ...(e.arcFrom === undefined ? {} : { arcFrom: e.arcFrom }),
          },
        ]
      : [],
  );

/**
 * A knockback as a viewer is sent it: who was pushed, by whom, and the tiles
 * it went from and to, which are the same when it moved less than a tile or
 * was stopped at once. What is left under a tile is on the actor, as
 * `knockX` and `knockY`.
 */
export interface Knock {
  readonly by: number;
  readonly target: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly x: number;
  readonly y: number;
  /** A wall or a body stopped it short. */
  readonly stopped: boolean;
}

/** The knockbacks among a tick's events, in the order they happened. */
export const knocksOf = (events: readonly WorldEvent[]): Knock[] =>
  events.flatMap((e) =>
    e.type === "knock"
      ? [
          {
            by: e.by,
            target: e.actor,
            fromX: e.fromX,
            fromY: e.fromY,
            x: e.x,
            y: e.y,
            stopped: e.stopped,
          },
        ]
      : [],
  );

/**
 * What the world server sends a viewer after each tick: the snapshot, with the
 * tick's blows and knockbacks beside it. Arrows in flight are in the world
 * itself. `restore` reads it as it reads a snapshot, and `readMessage` gives
 * the blows and knockbacks as well.
 */
export function viewerMessage(
  world: World,
  blows: readonly Blow[],
  knocks: readonly Knock[] = [],
): string {
  return JSON.stringify({ ...savedOf(world), blows, knocks });
}

/** A viewer message read: the world, and the blows and knockbacks of the tick that made it. */
export interface Message {
  readonly world: World;
  readonly blows: readonly Blow[];
  readonly knocks: readonly Knock[];
}

/**
 * Reads a viewer message as `restore` reads a snapshot, refusing the same
 * things. Blows and knockbacks that are not as `viewerMessage` writes them
 * are left out; a plain snapshot has none.
 */
export function readMessage(
  text: string,
  ground: TileMap | Atlas,
  programs: Programs = {},
  kinds: Kinds = {},
  spawns: Spawns = [],
): Message {
  const data = parseJson(text);
  const world = restoreSaved(savedFrom(data), ground, programs, kinds, spawns);
  const { blows, knocks } = data as Record<string, unknown>;
  return {
    world,
    blows: Array.isArray(blows) ? blows.filter(isBlow) : [],
    knocks: Array.isArray(knocks) ? knocks.filter(isKnock) : [],
  };
}

const isKnock = (raw: unknown): raw is Knock => {
  if (typeof raw !== "object" || raw === null) return false;
  const { by, target, fromX, fromY, x, y, stopped } = raw as Record<string, unknown>;
  return [by, target, fromX, fromY, x, y].every(isInt32) && typeof stopped === "boolean";
};
const isBlow = (raw: unknown): raw is Blow => {
  if (typeof raw !== "object" || raw === null) return false;
  const { by, target, amount, crit, type, arcFrom } = raw as Record<string, unknown>;
  return (
    isInt32(by) &&
    isInt32(target) &&
    isInt32(amount) &&
    typeof crit === "boolean" &&
    DAMAGE_TYPES.includes(type as DamageType) &&
    (arcFrom === undefined || isInt32(arcFrom))
  );
};

function savedOf(world: World) {
  const { atlas, programs, kinds, spawns, ...state } = world;
  return {
    version: SNAPSHOT_VERSION,
    map: hashAtlas(atlas),
    programs: hashPrograms(programs),
    byProgram: Object.fromEntries(
      Object.keys(programs)
        .sort()
        .map((name) => [name, hashProgram(name, programs[name] as Program)]),
    ),
    kinds: hashKinds(kinds),
    spawns: hashSpawns(spawns),
    hash: hashWorld(world),
    state,
  };
}

/** A snapshot's text, parsed, with its version checked and nothing else. */
export interface Saved {
  readonly version: number;
  readonly map: unknown;
  readonly programs: unknown;
  readonly byProgram: unknown;
  readonly kinds: unknown;
  readonly spawns: unknown;
  readonly hash: unknown;
  readonly state: unknown;
}

/** Parses a snapshot and checks its version. Throws a SnapshotError if either fails. */
export const parseSnapshot = (text: string): Saved => savedFrom(parseJson(text));

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SnapshotError("snapshot is not valid JSON");
  }
}

function savedFrom(data: unknown): Saved {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SnapshotError("snapshot is not an object");
  }
  const { version, map, programs, byProgram, kinds, spawns, hash, state } = data as Record<
    string,
    unknown
  >;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 4 ||
    version > SNAPSHOT_VERSION
  ) {
    throw new SnapshotError(`snapshot version ${show(version)} is not 4 to ${SNAPSHOT_VERSION}`);
  }
  return { version, map, programs, byProgram, kinds, spawns, hash, state };
}

/**
 * Whether a snapshot's map fingerprint is that of `atlas`. Versions 4 to 6,
 * from before regions, ran on one map, so the atlas must be that map alone at (0, 0).
 */
export function sameGround(version: number, mapHash: unknown, atlas: Atlas): boolean {
  if (version >= 7) return mapHash === hashAtlas(atlas);
  const only = atlas.regions[0] as Region;
  return (
    atlas.regions.length === 1 &&
    only.x === 0 &&
    only.y === 0 &&
    atlas.exits.length === 0 &&
    mapHash === hashMap(only.map)
  );
}

/**
 * A snapshot's state brought up to the current version, each older version to
 * the next in order. Throws a SnapshotError for old monsters that today's
 * rules do not allow (see refuseOldMonsters); anything else is left for
 * readState to judge.
 */
export function migrate(version: number, state: unknown, atlas: Atlas): unknown {
  const old = version < 7;
  if (old) refuseOldMonsters(state);
  const v5 = version === 4 ? fromVersion4(state) : state;
  const v6 = version === 4 || version === 5 ? fromVersion5(v5) : v5;
  const v7 = old ? fromVersion6(v6) : v6;
  const v8 = version < 8 ? fromVersion7(v7) : v7;
  const v9 = version < 9 ? fromVersion8(v8, atlas) : v8;
  const v10 = version < 10 ? fromVersion9(v9) : v9;
  return version < 11 ? fromVersion10(v10) : v10;
}

/** A version 10 world's state with what version 11 added: nobody has a status. */
function fromVersion10(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return state;
  return {
    ...state,
    actors: actors.map((actor: unknown) =>
      typeof actor === "object" && actor !== null ? { ...actor, status: noStatus() } : actor,
    ),
  };
}

/**
 * A version 9 world's state with what version 10 added: every adventurer
 * holds a blade and a full flask, nobody has been knocked back, each actor in
 * a wind-up faces the way of its marks, and no arrows are in flight. An
 * adventurer's wind-up and recovery from then do not fit a blade, so
 * `restore` calls them off afterwards (see callOffOldBlows), once the
 * version 9 hash has been checked.
 */
function fromVersion9(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors, marks } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return state;
  const firstMark = new Map<unknown, Record<string, unknown>>();
  if (Array.isArray(marks))
    for (const mark of marks as unknown[]) {
      if (typeof mark !== "object" || mark === null) continue;
      const { by } = mark as Record<string, unknown>;
      if (!firstMark.has(by)) firstMark.set(by, mark as Record<string, unknown>);
    }
  return {
    ...state,
    arrows: [],
    actors: actors.map((actor: unknown) => {
      if (typeof actor !== "object" || actor === null) return actor;
      const { id, kind, x, y } = actor as Record<string, unknown>;
      const adventurer = kind === ADVENTURER;
      const mark = firstMark.get(id);
      const aim =
        mark && typeof mark.x === "number" && typeof mark.y === "number"
          ? directionTo(mark.x - (x as number), mark.y - (y as number))
          : 0;
      return {
        ...actor,
        weapon: adventurer ? "blade" : "",
        aim: Math.max(0, aim),
        knockX: 0,
        knockY: 0,
        flask: adventurer ? FLASK_DRINKS : 0,
        kills: 0,
      };
    }),
  };
}

/**
 * A version 9 world as version 10 can run it: an adventurer's wind-up is
 * called off, with its marks, and its recovery cut to a blade's longest.
 */
function callOffOldBlows(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors, marks } = state as Record<string, unknown>;
  if (!Array.isArray(actors) || !Array.isArray(marks)) return state;
  const striking = new Set<unknown>();
  const settled = actors.map((actor: unknown) => {
    if (typeof actor !== "object" || actor === null) return actor;
    const { id, kind, windup, recover } = actor as Record<string, unknown>;
    if (kind !== ADVENTURER || typeof recover !== "number") return actor;
    if (windup !== 0) striking.add(id);
    return { ...actor, windup: 0, recover: Math.min(recover, WEAPONS.blade.recovery) };
  });
  return {
    ...state,
    actors: settled,
    marks: (marks as unknown[]).filter(
      (mark) =>
        typeof mark !== "object" ||
        mark === null ||
        !striking.has((mark as Record<string, unknown>).by),
    ),
  };
}

/**
 * Rebuilds a world from a snapshot and the content it was taken with. Refuses,
 * with a SnapshotError, anything it cannot be sure it reads correctly: another
 * version, other maps or exits, other programs, monster kinds or spawns, or
 * contents that do not hash to what was saved. Throws a ProgramError, KindError
 * or MapError instead if the content passed in is itself invalid. This is the
 * strict path, which tests and the viewer use; `adopt` carries a world over
 * to content that has changed.
 *
 * Versions 4 to 6, from before regions, are read too, into a world of the one
 * map they ran on (which must be passed in as that map, or as a world of that
 * map alone at (0, 0)). A version 4 snapshot, from before monsters spawned on
 * their own, has no spawn table to compare and takes on the spawns passed in.
 * In a version 4 or 5 snapshot, from before skills and the bank, everyone
 * starts with no experience, an empty bag and an empty bank. In a snapshot
 * from before version 8, nobody has died yet. In one from before version 9,
 * every node stands with its full yield and nobody has a burnt fish. In one
 * from before version 10, every adventurer holds a blade and a full flask,
 * and its wind-up, if it was in one, is called off. In one from before
 * version 11, nobody has a status.
 */
export const restore = (
  text: string,
  ground: TileMap | Atlas,
  programs: Programs = {},
  kinds: Kinds = {},
  spawns: Spawns = [],
): World => restoreSaved(parseSnapshot(text), ground, programs, kinds, spawns);

function restoreSaved(
  saved: Saved,
  ground: TileMap | Atlas,
  programs: Programs,
  kinds: Kinds,
  spawns: Spawns,
): World {
  const atlas = atlasOf(ground);
  const {
    version,
    map: mapHash,
    programs: programsHash,
    kinds: kindsHash,
    spawns: spawnsHash,
    hash,
    state,
  } = saved;
  if (!sameGround(version, mapHash, atlas))
    throw new SnapshotError("snapshot was taken on a different map");
  const table = checkPrograms(programs);
  if (programsHash !== hashPrograms(table)) {
    throw new SnapshotError("snapshot was taken with different programs");
  }
  const kindTable = checkKinds(kinds);
  if (kindsHash !== hashKinds(kindTable)) {
    throw new SnapshotError("snapshot was taken with different monster kinds");
  }
  const spawnTable = checkSpawns(spawns, atlas, table, kindTable);
  // A version 4 world had no spawn table, so it takes on the one it is restored with.
  if (version !== 4 && spawnsHash !== hashSpawns(spawnTable)) {
    throw new SnapshotError("snapshot was taken with different spawns");
  }
  const migrated = migrate(version, state, atlas);
  if (version === SNAPSHOT_VERSION) {
    const world = readState(migrated, atlas, table, kindTable, spawnTable);
    if (!world || hashWorldAs(world, version) !== hash)
      throw new SnapshotError("snapshot contents are damaged");
    return world;
  }
  // An older world is checked against its hash as it was saved, before the
  // blows of adventurers from before version 10 are fitted to its weapons.
  let hashed: string;
  try {
    const content = { atlas, programs: table, kinds: kindTable, spawns: spawnTable };
    hashed = hashWorldAs({ ...(migrated as World), ...content }, version);
  } catch {
    throw new SnapshotError("snapshot contents are damaged");
  }
  const fitted = version < 10 ? callOffOldBlows(migrated) : migrated;
  const world = hashed === hash ? readState(fitted, atlas, table, kindTable, spawnTable) : null;
  if (!world) throw new SnapshotError("snapshot contents are damaged");
  return world;
}

/**
 * Version 4 had no monster cap, and versions 5 and 6 allowed six monsters by
 * day and night alike, where a region may now hold up to MONSTER_CEILING. A world
 * saved like that cannot go on under today's rules, so it is refused with a
 * message that says so, before readState would call it damaged.
 */
function refuseOldMonsters(state: unknown): void {
  if (typeof state !== "object" || state === null) return;
  const { actors } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return;
  let monsters = 0;
  for (const actor of actors as unknown[]) {
    if (typeof actor !== "object" || actor === null) continue;
    const { kind } = actor as Record<string, unknown>;
    if (typeof kind !== "string" || kind === ADVENTURER) continue;
    monsters++;
  }
  if (monsters > MONSTER_CEILING)
    throw new SnapshotError(
      `snapshot holds ${monsters} monsters, more than the ${MONSTER_CEILING} a region now allows`,
    );
}

/**
 * A version 4 world's state with the fields version 5 added: no group has
 * been held back, so one may arrive from the tick it was saved at; every
 * actor was put in by hand or is an adventurer, so it has no part of the day
 * to go home at; and none has been counted as stalled. Anything else is left
 * for readState to judge.
 */
function fromVersion4(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors, tick } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return state;
  return {
    ...state,
    nextSpawn: tick,
    actors: actors.map((actor: unknown) =>
      typeof actor === "object" && actor !== null ? { ...actor, shift: "", stalled: 0 } : actor,
    ),
  };
}

/**
 * A version 5 world's state with the fields version 6 added: nobody has any
 * experience yet, and every bag and bank is empty.
 */
function fromVersion5(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return state;
  return {
    ...state,
    actors: actors.map((actor: unknown) =>
      typeof actor === "object" && actor !== null
        ? { ...actor, xp: noXp(), bag: emptyBag(), bank: new Array<number>(V8_GOODS).fill(0) }
        : actor,
    ),
  };
}

/** A copy of `value` if it is a list of `length` whole numbers from 0 to `most`, else null. */
function counts(value: unknown, length: number, most: number): number[] | null {
  const list = plainList(value, length);
  if (!list || list.length !== length) return null;
  if (!list.every((n) => isInt32(n) && n >= 0 && n <= most)) return null;
  return (list as number[]).map((n) => n | 0);
}

/**
 * A version 6 world's state as version 7 holds it: its one map is the only
 * region, so its one `nextSpawn` is that region's. Anything else is left for
 * readState to judge.
 */
function fromVersion6(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { nextSpawn } = state as Record<string, unknown>;
  return { ...state, nextSpawn: [nextSpawn] };
}

/** A version 7 world's state with the field version 8 added: nobody has died yet. */
function fromVersion7(state: unknown): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return state;
  return {
    ...state,
    actors: actors.map((actor: unknown) =>
      typeof actor === "object" && actor !== null ? { ...actor, deaths: 0 } : actor,
    ),
  };
}

/**
 * A version 8 world's state with what version 9 added: every node stands with
 * its full yield, and each bank gets a count of 0 for every good added since.
 * A version 8 bag or bank that holds anything but the goods of its day is
 * made unreadable, so readState refuses it, as nothing then could have made it.
 */
function fromVersion8(state: unknown, atlas: Atlas): unknown {
  if (typeof state !== "object" || state === null) return state;
  const { actors } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return state;
  const old = (value: unknown, length: number, most: number): boolean =>
    counts(value, length, most) !== null;
  return {
    ...state,
    nodes: fullNodes(atlas),
    actors: actors.map((actor: unknown) => {
      if (typeof actor !== "object" || actor === null) return actor;
      const { bag, bank } = actor as Record<string, unknown>;
      return {
        ...actor,
        bag: old(bag, BAG_SLOTS, V8_GOODS) ? bag : null,
        bank: old(bank, V8_GOODS, MAX_BANKED)
          ? [...(bank as number[]), ...new Array<number>(GOODS.length - V8_GOODS).fill(0)]
          : null,
      };
    }),
  };
}

/**
 * A copy of the world's node states if `value` is one per node of the atlas,
 * each with between 0 and its kind's yield left, standing (`back` 0) while it
 * has any, and otherwise due back within its regrow time after `tick`; else null.
 */
function readNodes(value: unknown, atlas: Atlas, tick: number): NodeState[] | null {
  const list = plainList(value, atlas.nodes.length);
  if (!list || list.length !== atlas.nodes.length) return null;
  const nodes: NodeState[] = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!isPlainObject(item)) return null;
    const left = own(item, "left");
    const back = own(item, "back");
    const kind = NODE_KINDS[(atlas.nodes[i] as (typeof atlas.nodes)[number]).kind - 1] as NodeKind;
    if (!isInt32(left) || left < 0 || left > kind.yield) return null;
    if (typeof back !== "number" || !Number.isSafeInteger(back)) return null;
    if (left > 0 ? back !== 0 : back <= tick || back > tick + kind.regrow) return null;
    nodes.push({ left, back });
  }
  return nodes;
}

const MAX_WAIT_TICKS = 1_000_000;

/**
 * Rebuilds world state field by field, or returns null if anything is not what
 * a world could hold. The hash alone is not trusted for this: it folds every
 * value to 32 bits, so it cannot tell a number from a string that reads the same.
 */
export function readState(
  raw: unknown,
  atlas: Atlas,
  programs: Programs,
  kinds: Kinds,
  spawns: Spawns,
): World | null {
  if (typeof raw !== "object" || raw === null) return null;
  const {
    tick,
    rng,
    nextActorId,
    actors,
    marks,
    nextSpawn,
    nodes: rawNodes,
    arrows: rawArrows,
  } = raw as Record<string, unknown>;
  if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0) return null;
  const nodes = readNodes(rawNodes, atlas, tick);
  if (!nodes) return null;
  // One arrival time per region, each set at most MOST_SPAWN_WAIT ahead, and only ever from a tick already reached.
  if (!Array.isArray(nextSpawn) || nextSpawn.length !== atlas.regions.length) return null;
  const arrivals: number[] = [];
  for (const at of nextSpawn as unknown[]) {
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 0) return null;
    if (at > tick + MOST_SPAWN_WAIT) return null;
    arrivals.push(at);
  }
  // Ids are handed out in order and monsters leave, so ids rise and stay below the next one.
  if (!Array.isArray(actors) || !Array.isArray(marks)) return null;
  if (!isInt32(nextActorId) || nextActorId < 1) return null;
  if (typeof rng !== "object" || rng === null) return null;
  const { a, b, c, d } = rng as Record<string, unknown>;
  if (!isInt32(a) || !isInt32(b) || !isInt32(c) || !isInt32(d)) return null;

  const world: World = {
    atlas,
    programs,
    kinds,
    spawns,
    tick,
    rng: { a, b, c, d },
    nextActorId,
    actors: [],
    marks: [],
    nextSpawn: arrivals,
    nodes,
    arrows: [],
  };
  // Monsters a region holds, by region.
  const monsters = new Map<number, number>();
  let lastId = 0;
  for (const item of actors as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const {
      id,
      name,
      x,
      y,
      fromX,
      fromY,
      moveTicksLeft,
      path,
      wait,
      blocked,
      program,
      memory,
      rule,
      fault,
      kind,
      hp,
      windup,
      recover,
      shift,
      stalled,
      xp: rawXp,
      bag: rawBag,
      bank: rawBank,
      deaths,
      weapon,
      aim,
      knockX,
      knockY,
      flask,
      kills,
      status: rawStatus,
    } = item as Record<string, unknown>;
    // An adventurer holds a weapon of one of the families, and a monster none.
    if (kind === ADVENTURER ? !FAMILIES.includes(weapon as Family) : weapon !== "") return null;
    // A monster strikes along the four axes only.
    if (!isInt32(aim) || aim < 0 || aim >= DIRECTIONS.length) return null;
    if (kind !== ADVENTURER && aim % 2 !== 0) return null;
    const under = (n: unknown): boolean => isInt32(n) && Math.abs(n) < QUARTERS_PER_TILE;
    if (!under(knockX) || !under(knockY)) return null;
    if (!isInt32(flask) || flask < 0 || flask > (kind === ADVENTURER ? FLASK_DRINKS : 0))
      return null;
    if (!isInt32(kills) || kills < 0 || kills >= KILLS_PER_DRINK) return null;
    if ((kind !== ADVENTURER || flask === FLASK_DRINKS) && kills !== 0) return null;
    const xp = counts(rawXp, SKILLS.length, MAX_XP);
    const bag = counts(rawBag, BAG_SLOTS, GOODS.length);
    const bank = counts(rawBank, GOODS.length, MAX_BANKED);
    if (!xp || !bag || !bank) return null;
    // A monster has no skills and carries and keeps nothing.
    if (kind !== ADVENTURER && [...xp, ...bag, ...bank].some((n) => n !== 0)) return null;
    // A monster that dies leaves the world, so only an adventurer counts deaths.
    if (!isInt32(deaths) || deaths < 0 || deaths > MAX_DEATHS) return null;
    if (kind !== ADVENTURER && deaths !== 0) return null;
    if (!isInt32(id) || id <= lastId || id >= nextActorId) return null;
    lastId = id;
    if (typeof kind !== "string") return null;
    if (kind !== ADVENTURER && !Object.hasOwn(kinds, kind)) return null;
    if (!SHIFTS.includes(shift as Shift) || (kind === ADVENTURER && shift !== "")) return null;
    // Monsters keep to their region, and a region never holds more than the night's cap.
    const adventurer = kind === ADVENTURER;
    const ground = (px: number, py: number): boolean => walkable(atlas, px, py);
    const stepped = (p: Point, q: Point): boolean =>
      stepsFor(atlas, adventurer, p.x, p.y, q.x, q.y);
    const numbers = kind === ADVENTURER ? ADVENTURER_KIND : (kinds[kind] as Kind);
    const lasts = statusTicksFor(adventurer, numbers.rank);
    const status = readStatus(rawStatus, nextActorId, lasts, adventurer);
    if (!status) return null;
    // A blow takes longest at Arms 1, and half as long again begun chilled.
    const longest = kind === ADVENTURER ? WEAPONS[weapon as Family] : numbers;
    if (!isInt32(hp) || hp < 1 || hp > numbers.hp) return null;
    if (!isInt32(windup) || windup < 0 || windup > slowed(longest.windup)) return null;
    if (!isInt32(recover) || recover < 0 || recover > slowed(longest.recovery)) return null;
    if (windup > 0 && recover > 0) return null;
    if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
    if (!isInt32(x) || !isInt32(y) || !isInt32(fromX) || !isInt32(fromY)) return null;
    if (!ground(x, y) || !ground(fromX, fromY)) return null;
    const region = regionAt(atlas, x, y);
    if (!adventurer) monsters.set(region, (monsters.get(region) ?? 0) + 1);
    if ((monsters.get(region) ?? 0) > MONSTER_CEILING) return null;
    const stepLength = slowed(numbers.step ?? STEP_TICKS);
    if (!isInt32(moveTicksLeft) || moveTicksLeft < 0 || moveTicksLeft > stepLength) return null;
    const here = { x, y };
    const from = { x: fromX, y: fromY };
    if (moveTicksLeft === 0 ? fromX !== x || fromY !== y : !stepped(from, here)) return null;
    if (!isInt32(wait) || wait < 0 || wait > MAX_WAIT_TICKS) return null;
    if (!isInt32(blocked) || blocked < 0 || blocked >= 2 * BLOCKED_PATIENCE_TICKS) return null;
    if (!isInt32(stalled) || stalled < 0 || stalled > MAX_STALLED) return null;
    if (!Array.isArray(path) || path.length > atlas.regionOf.length) return null;
    const steps: Point[] = [];
    let at: Point = here;
    for (const stepTo of path as unknown[]) {
      if (typeof stepTo !== "object" || stepTo === null) return null;
      const { x: sx, y: sy } = stepTo as Record<string, unknown>;
      if (!isInt32(sx) || !isInt32(sy) || !ground(sx, sy)) return null;
      const next = { x: sx, y: sy };
      if (!stepped(at, next)) return null;
      steps.push(next);
      at = next;
    }
    // The blocked count only runs while there is a path to wait on.
    if (steps.length === 0 && blocked !== 0) return null;
    // An attack is only begun standing still with nowhere to go.
    if (windup > 0 && (steps.length > 0 || moveTicksLeft > 0)) return null;
    if (typeof program !== "string" || !Object.hasOwn(programs, program)) return null;
    if (!Array.isArray(memory) || memory.length !== MEMORY_SLOTS || !memory.every(isInt32))
      return null;
    if (!isInt32(rule) || rule < -1 || rule >= (programs[program] as Program).rules.length) {
      return null;
    }
    if (!isInt32(fault) || fault < 0 || fault >= FAULTS.length) return null;
    world.actors.push({
      id,
      name,
      x,
      y,
      fromX,
      fromY,
      moveTicksLeft,
      path: steps,
      wait,
      blocked,
      program,
      memory: [...memory],
      rule,
      fault,
      kind,
      hp,
      windup,
      recover,
      shift: shift as Shift,
      stalled,
      xp,
      bag,
      bank,
      deaths,
      weapon: weapon as Family | "",
      aim,
      knockX: knockX as number,
      knockY: knockY as number,
      flask,
      kills,
      status,
    });
  }
  // Only adventurers share a tile.
  for (const actor of world.actors) {
    if (
      world.actors.some(
        (other) => other.x === actor.x && other.y === actor.y && blocks(other, actor),
      )
    )
      return null;
  }
  // Every mark belongs to an actor in wind-up, and an actor in wind-up has
  // exactly the marks of its blow, the way it aims, from where it stands.
  const marksOf = new Map<number, Point[]>();
  for (const item of marks as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { x, y, by } = item as Record<string, unknown>;
    if (!isInt32(x) || !isInt32(y) || !isInt32(by)) return null;
    const attacker = world.actors.find((actor) => actor.id === by);
    if (!attacker || attacker.windup === 0) return null;
    // One attack's marks are stored together.
    const last = world.marks.at(-1);
    if (marksOf.has(by) && last?.by !== by) return null;
    marksOf.set(by, [...(marksOf.get(by) ?? []), { x, y }]);
    addMark(world, { x, y, by });
  }
  const same = (a: readonly Point[], b: readonly Point[]): boolean =>
    a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);
  // A blow is begun only where it reaches some tile, but one knocked back
  // against a wall in its wind-up may reach none and have no marks.
  for (const actor of world.actors) {
    if (actor.windup === 0) continue;
    if (!same(marksOf.get(actor.id) ?? [], blowTiles(world, actor, actor.aim))) return null;
  }
  const arrows = readArrows(rawArrows, world);
  if (!arrows) return null;
  world.arrows = arrows;
  return world;
}

/**
 * A copy of an actor's status if `value` is one a world could hold on an
 * actor whose statuses last `ticks`, else null: whole counts, none below 0,
 * a burn's numbers 0 while it does not burn, its setter an id handed out
 * already, and everything `statusFits` asks of it.
 */
function readStatus(
  value: unknown,
  nextActorId: number,
  ticks: number,
  citizen: boolean,
): Status | null {
  if (!isPlainObject(value)) return null;
  const status = noStatus();
  for (const field of STATUS_FIELDS) {
    const n = own(value, field);
    if (!isInt32(n) || n < 0) return null;
    status[field] = n;
  }
  if (status.burnDamage > MOST_DAMAGE || status.burnBy >= nextActorId) return null;
  if (
    status.burn === 0 &&
    (status.burnDamage !== 0 || status.burnBy !== 0 || status.burnJumps !== 0)
  )
    return null;
  if (status.burn > 0 && status.burnBy < 1) return null;
  return statusFits(status, ticks, citizen) ? status : null;
}

/** The base blow at the highest Arms, which no arrow is loosed harder than. */
const HARDEST_BLOW = blow(MAX_LEVEL);

/**
 * The arrows in flight if `value` lists them as a world could hold them, each
 * loosed by an adventurer in it who holds a bow, over ground, no harder than
 * the blow of the highest Arms. A shooter looses one at most every
 * SHORTEST_BLOW ticks and it flies ARROW_RANGE, so no more than that many are
 * in flight for each. A weapon is never changed, so whoever loosed an arrow
 * still holds the bow.
 */
function readArrows(value: unknown, world: World): Arrow[] | null {
  const shooters = new Set(
    world.actors.filter((a) => a.kind === ADVENTURER && a.weapon === "bow").map((a) => a.id),
  );
  const list = plainList(value, shooters.size * ARROW_RANGE);
  if (!list) return null;
  const arrows: Arrow[] = [];
  for (const item of list) {
    if (!isPlainObject(item)) return null;
    const by = own(item, "by");
    const x = own(item, "x");
    const y = own(item, "y");
    const aim = own(item, "aim");
    const left = own(item, "left");
    const blow = own(item, "blow");
    const crit = own(item, "crit");
    if (!isInt32(by) || !shooters.has(by)) return null;
    if (!isInt32(x) || !isInt32(y) || !walkable(world.atlas, x, y)) return null;
    if (!isInt32(aim) || aim < 0 || aim >= DIRECTIONS.length) return null;
    if (!isInt32(left) || left < 1 || left > ARROW_RANGE) return null;
    if (!isInt32(blow) || blow < 0 || blow > HARDEST_BLOW || typeof crit !== "boolean") return null;
    arrows.push({ by, x, y, aim, left, blow, crit });
  }
  return arrows;
}
