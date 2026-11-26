// The world and the one function that advances it. Everything here is a pure
// function of the seed, the map and the inputs: integers only, no clock.

import { BAG_SLOTS, emptyBag, emptyBank, GOODS, MAX_BANKED } from "./bag.ts";
import { MAX_STALLED, think, wayTo } from "./brain.ts";
import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import {
  isWalkable,
  NEIGHBOURS,
  type Point,
  place,
  type TileMap,
  terrainAt,
  tileIndex,
} from "./map.ts";
import { createRng, nextInt, type Rng } from "./rng.ts";
import { gainXp, MAX_XP, noXp, SKILLS, type Skill, XP_PER_DAMAGE } from "./skills.ts";
import {
  FAULTS,
  MEMORY_SLOTS,
  PROGRAM_NAME,
  type Program,
  ProgramError,
  validateProgram,
} from "./vm.ts";

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
export const MAX_NAME_LENGTH = 16;
/** No actor's id reaches this; a world stops taking spawns first. */
export const MAX_ACTOR_ID = 0x7fffffff;
/** Ticks an adventurer rests at camp after being struck down, before its program runs again. */
export const DOWN_TICKS = 150;

/** What a kind of actor can take and deal in a fight. Content, like programs: fixed for the life of a world. */
export interface Kind {
  /** Hitpoints at full health. */
  readonly hp: number;
  /** Hitpoints one of its hits takes off. */
  readonly damage: number;
  /** Ticks between starting an attack and the hit landing. The marked tiles show for this long. */
  readonly windup: number;
  /** Ticks after the hit before it can do anything else. */
  readonly recovery: number;
  /** How many tiles in a line its attack reaches, 1 to 3. */
  readonly reach: number;
}
export type Kinds = Readonly<Record<string, Kind>>;

/** The kind every adventurer is. Any other kind is a monster, and the two are enemies. */
export const ADVENTURER = "adventurer";
export const ADVENTURER_KIND: Kind = Object.freeze({
  hp: 20,
  damage: 4,
  windup: 6,
  recovery: 6,
  reach: 1,
});
const KIND_LIMITS: Readonly<Record<keyof Kind, readonly [number, number]>> = {
  hp: [1, 100_000],
  damage: [0, 100_000],
  windup: [1, 100],
  recovery: [0, 100],
  reach: [1, 3],
};

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
      const kind: Record<string, number> = {};
      for (const field of Object.keys(KIND_LIMITS) as (keyof Kind)[]) {
        const value: unknown = (raw as Record<string, unknown>)[field];
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

/** The most monsters alive at once. */
export const MONSTER_CAP = 6;
/**
 * The shortest time from a monster arriving or going down, or from the world
 * last being full, to the next group arriving.
 */
export const RESPAWN_TICKS = TICKS_PER_GAME_HOUR;
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
const SPAWN_FIELDS = ["kind", "name", "program", "group", "day", "night"] as const;

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

/** Whether `actor` may stand on (x, y). Monsters keep off the camp's ground. */
export const walkableFor = (world: World, actor: Actor, x: number, y: number): boolean =>
  monsterWalkable(world.map, x, y) || (actor.kind === ADVENTURER && isWalkable(world.map, x, y));

const monsterWalkable = (map: TileMap, x: number, y: number): boolean =>
  isWalkable(map, x, y) && terrainAt(map, x, y) !== "camp";

/** Where and how a kind of monster comes into the world. Content, like kinds. */
export interface Spawn {
  /** One of the world's monster kinds. */
  readonly kind: string;
  /** The name each one is given, such as "Wolf". */
  readonly name: string;
  /** The program each one runs; one of the world's. */
  readonly program: string;
  /** How many arrive together, 1 to MONSTER_CAP. */
  readonly group: number;
  /** Where they come out by day, and by night. Either may be empty. */
  readonly day: readonly Point[];
  readonly night: readonly Point[];
}
export type Spawns = readonly Spawn[];

/**
 * Validates a spawn table against the map, programs and kinds it will be used
 * with, and returns a frozen copy. Throws a KindError for anything wrong.
 */
export function checkSpawns(
  spawns: Spawns,
  map: TileMap,
  programs: Programs,
  kinds: Kinds,
): Spawns {
  const table: Spawn[] = [];
  try {
    const list = plainList(spawns, 64);
    if (!list) throw new KindError("the spawn table must be a list of at most 64 spawns, no gaps");
    for (const raw of list) {
      if (!isPlainObject(raw)) throw new KindError("a spawn is not a plain object");
      const [kind, name, program, group, day, night] = SPAWN_FIELDS.map((field) => own(raw, field));
      if (typeof kind !== "string" || !Object.hasOwn(kinds, kind))
        throw new KindError(`spawn of an unknown kind ${show(kind).slice(0, 40)}`);
      if (typeof name !== "string" || !MONSTER_NAME.test(name))
        throw new KindError(
          `spawn of "${kind}": the name must be a capital letter and up to 15 letters or spaces`,
        );
      if (typeof program !== "string" || !Object.hasOwn(programs, program))
        throw new KindError(`spawn of "${kind}": no program called ${show(program).slice(0, 40)}`);
      if (!isInt32(group) || group < 1 || group > MONSTER_CAP)
        throw new KindError(
          `spawn of "${kind}": group must be a whole number from 1 to ${MONSTER_CAP}`,
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
          // Monsters keep off the camp's ground, so they cannot come out on it either.
          if (!isInt32(x) || !isInt32(y) || !monsterWalkable(map, x, y))
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
   * that chose the action, or the one that faulted), or -1. For showing why an
   * actor does what it does.
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
}

export type Shift = "" | "day" | "night";
const SHIFTS: readonly Shift[] = ["", "day", "night"];

/** Validated programs by name. Like the map, they are content: fixed for the life of a world. */
export type Programs = Readonly<Record<string, Program>>;

export interface World {
  readonly map: TileMap;
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
  /** The tick from which the next group of monsters may arrive. */
  nextSpawn: number;
}

export type Input = {
  readonly type: "spawn";
  readonly name: string;
  /** The program to run; must be one of the world's. */
  readonly program: string;
  /** A monster kind from the world's table. Left out, the actor is an adventurer. */
  readonly kind?: string;
} & Point;

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
 */
export function createWorld(
  map: TileMap,
  seed: number,
  programs: Programs = {},
  kinds: Kinds = {},
  spawns: Spawns = [],
): World {
  const programTable = checkPrograms(programs);
  const kindTable = checkKinds(kinds);
  return {
    map,
    programs: programTable,
    kinds: kindTable,
    spawns: checkSpawns(spawns, map, programTable, kindTable),
    tick: 0,
    rng: createRng(seed),
    nextActorId: 1,
    actors: [],
    marks: [],
    nextSpawn: 0,
  };
}

/** The numbers an actor fights with. */
export const kindOf = (world: World, actor: Actor): Kind =>
  actor.kind === ADVENTURER ? ADVENTURER_KIND : (world.kinds[actor.kind] as Kind);

/**
 * The tiles an actor's attack lands on in one direction: a line out from it,
 * as long as its reach, cut short by anything that cannot be walked on.
 */
export function lineOfAttack(world: World, actor: Actor, sx: number, sy: number): Point[] {
  const tiles: Point[] = [];
  for (let k = 1; k <= kindOf(world, actor).reach; k++) {
    const tile = { x: actor.x + sx * k, y: actor.y + sy * k };
    if (!isWalkable(world.map, tile.x, tile.y)) break;
    tiles.push(tile);
  }
  return tiles;
}

/** Adventurers and monsters are enemies; nobody else is. */
export const enemies = (a: Actor, b: Actor): boolean =>
  (a.kind === ADVENTURER) !== (b.kind === ADVENTURER);

export const actorAt = (world: World, x: number, y: number): Actor | undefined =>
  world.actors.find((a) => a.x === x && a.y === y);

/**
 * Whether `a` and `b` get in each other's way. Adventurers walk through each
 * other, so no one can hold a narrow way against the rest; anything involving
 * a monster blocks.
 */
export const blocks = (a: Actor, b: Actor): boolean =>
  a !== b && (a.kind !== ADVENTURER || b.kind !== ADVENTURER);

/** Someone on (x, y) who gets in `mover`'s way, if anyone does. */
export const blockerAt = (world: World, x: number, y: number, mover: Actor): Actor | undefined =>
  world.actors.find((a) => a.x === x && a.y === y && blocks(a, mover));

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
      readonly damage: number;
      /** The target's hitpoints afterwards; 0 or less means it is out. */
      readonly hp: number;
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
    };

/**
 * Advances the world by one tick, and returns what happened in it. This is the
 * only way the world changes.
 */
export function step(world: World, inputs: readonly Input[] = []): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const input of inputs) applyInput(world, input);
  world.tick++;
  sendHome(world, events);
  spawnMonsters(world);
  landAttacks(world, events);
  for (const actor of world.actors) updateActor(world, actor, events);
  return events;
}

/** Counts every wind-up down, lands the attacks that are due, and takes out whoever has no hitpoints left. */
function landAttacks(world: World, events: WorldEvent[]): void {
  const struck = new Map<number, number>();
  for (const attacker of world.actors) {
    if (attacker.windup === 0) continue;
    attacker.windup--;
    // Someone struck down earlier this tick does not get its own blow in.
    if (attacker.windup > 0 || attacker.hp <= 0) continue;
    const kind = kindOf(world, attacker);
    attacker.recover = kind.recovery;
    for (const mark of world.marks) {
      if (mark.by !== attacker.id) continue;
      // Adventurers can share a tile, so a blow lands on every enemy standing there.
      const targets = world.actors.filter(
        (a) => a.x === mark.x && a.y === mark.y && a.hp > 0 && enemies(a, attacker),
      );
      if (targets.length === 0) {
        events.push({ type: "miss", tick: world.tick, actor: attacker.id, x: mark.x, y: mark.y });
        continue;
      }
      for (const target of targets) {
        // Experience counts the hitpoints a blow actually took, not what it would have.
        const taken = Math.min(kind.damage, target.hp);
        target.hp -= kind.damage;
        struck.set(target.id, attacker.id);
        events.push({
          type: "hit",
          tick: world.tick,
          actor: attacker.id,
          target: target.id,
          damage: kind.damage,
          hp: target.hp,
        });
        const learner = attacker.kind === ADVENTURER ? attacker : target;
        const skill: Skill = learner === attacker ? "melee" : "hitpoints";
        const level = gainXp(learner.xp, skill, taken * XP_PER_DAMAGE);
        if (level > 0)
          events.push({ type: "level", tick: world.tick, actor: learner.id, skill, level });
      }
    }
    world.marks = world.marks.filter((mark) => mark.by !== attacker.id);
  }
  const out = world.actors.filter((actor) => actor.hp <= 0);
  if (out.length === 0) return;
  const gone = new Set(out.map((actor) => actor.id));
  world.marks = world.marks.filter((mark) => !gone.has(mark.by));
  world.actors = world.actors.filter((actor) => actor.hp > 0 || actor.kind === ADVENTURER);
  // One that dies is replaced an hour later at the earliest.
  if (out.some((actor) => actor.kind !== ADVENTURER)) holdSpawns(world);
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
    const bed = freeTileNear(world, place(world.map, "camp"), actor) ?? actor;
    actor.x = actor.fromX = bed.x;
    actor.y = actor.fromY = bed.y;
    actor.moveTicksLeft = 0;
    actor.path = [];
    actor.blocked = 0;
    actor.windup = 0;
    actor.recover = 0;
    actor.wait = DOWN_TICKS;
    actor.hp = ADVENTURER_KIND.hp;
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
  const { map } = world;
  if (!isWalkable(map, from.x, from.y)) return null;
  const standing = new Set<number>();
  const making = new Set<number>();
  for (const other of world.actors) {
    if (other === self) continue;
    standing.add(tileIndex(map, other.x, other.y));
    const end = other.path[other.path.length - 1];
    if (end) making.add(tileIndex(map, end.x, end.y));
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
  const { map } = world;
  const seen = new Set<number>([tileIndex(map, from.x, from.y)]);
  let ring: Point[] = [{ x: from.x, y: from.y }];
  while (ring.length > 0) {
    let found: Point | null = null;
    for (const at of ring) {
      if (taken(tileIndex(map, at.x, at.y))) continue;
      if (self && self.x === at.x && self.y === at.y) return at;
      if (!found) found = at;
    }
    if (found) return found;
    const next: Point[] = [];
    for (const at of ring) {
      for (const [dx, dy] of NEIGHBOURS) {
        const x = at.x + dx;
        const y = at.y + dy;
        if (!isWalkable(map, x, y) || seen.has(tileIndex(map, x, y))) continue;
        seen.add(tileIndex(map, x, y));
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
    const { type, name, x, y, program, kind } = raw as Record<string, unknown>;
    fields = { type, name, x, y, program, kind };
  } catch {
    return;
  }
  const { type, name } = fields;
  if (type !== "spawn") return;
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) return;
  if (!isInt32(fields.x) || !isInt32(fields.y)) return;
  // `| 0` turns a negative zero into zero, so the stored position is what a snapshot would hold.
  const x = fields.x | 0;
  const y = fields.y | 0;
  if (!isWalkable(world.map, x, y) || actorAt(world, x, y)) return;
  const { program } = fields;
  if (typeof program !== "string" || !Object.hasOwn(world.programs, program)) return;
  // Ids stay within 32 bits, so a world that has handed out every one takes no more actors.
  if (world.nextActorId >= MAX_ACTOR_ID) return;
  const kind = fields.kind ?? ADVENTURER;
  if (typeof kind !== "string") return;
  if (kind !== ADVENTURER) {
    // A monster put in by hand counts against the cap and the wait like any other.
    if (!Object.hasOwn(world.kinds, kind)) return;
    if (!monsterWalkable(world.map, x, y) || monstersAlive(world) >= MONSTER_CAP) return;
    // Inputs are applied before the tick moves on, and the monster is first in
    // the world on that next tick, so the hour is counted from there.
    holdSpawns(world, world.tick + 1);
  }
  addActor(world, name, x, y, program, kind, "");
}

/** Is it the part of the day when monsters come out at their night places? */
export function isNight(world: World): boolean {
  const { hour } = clock(world);
  return hour >= NIGHT_HOUR || hour < DAY_HOUR;
}

const monstersAlive = (world: World): number =>
  world.actors.filter((actor) => actor.kind !== ADVENTURER).length;

/** No group arrives for RESPAWN_TICKS from now. */
const holdSpawns = (world: World, from = world.tick): void => {
  world.nextSpawn = Math.max(world.nextSpawn, from + RESPAWN_TICKS);
};

/**
 * Sends home the monsters out for the part of the day that is over, each once
 * no adventurer is within LEAVE_DISTANCE and it is not in the middle of a blow.
 * One that is still fighting stays until it is clear.
 */
function sendHome(world: World, events: WorldEvent[]): void {
  const now: Shift = isNight(world) ? "night" : "day";
  const going = world.actors.filter(
    (actor) =>
      actor.shift !== "" &&
      actor.shift !== now &&
      actor.windup === 0 &&
      !world.actors.some(
        (other) =>
          other.kind === ADVENTURER &&
          Math.abs(other.x - actor.x) + Math.abs(other.y - actor.y) <= LEAVE_DISTANCE,
      ),
  );
  if (going.length === 0) return;
  world.actors = world.actors.filter((actor) => !going.includes(actor));
  for (const actor of going) {
    const { id, name, kind, x, y } = actor;
    events.push({ type: "leave", tick: world.tick, actor: id, name, kind, x, y });
  }
}

/**
 * Brings in a whole group of monsters when there is room for all of them and
 * it is time, on free tiles within GROUP_SPREAD steps of one of its places. A
 * group that does not fit there does not come, and the wait starts again.
 * While the world holds MONSTER_CAP monsters the wait starts again too.
 */
function spawnMonsters(world: World): void {
  if (world.spawns.length === 0) return;
  const alive = monstersAlive(world);
  if (alive >= MONSTER_CAP) {
    holdSpawns(world);
    return;
  }
  if (world.tick < world.nextSpawn) return;
  const night = isNight(world);
  const open = world.spawns.filter(
    (spawn) => (night ? spawn.night : spawn.day).length > 0 && alive + spawn.group <= MONSTER_CAP,
  );
  // Nothing fits yet; look again when one more has gone.
  if (open.length === 0) return;
  holdSpawns(world);
  const spawn = open[nextInt(world.rng, open.length)] as Spawn;
  const places = night ? spawn.night : spawn.day;
  const at = places[nextInt(world.rng, places.length)] as Point;
  const tiles = groupTiles(world, at, spawn.group);
  if (!tiles || world.nextActorId > MAX_ACTOR_ID - spawn.group) return;
  for (const tile of tiles) {
    addActor(world, spawn.name, tile.x, tile.y, spawn.program, spawn.kind, night ? "night" : "day");
  }
}

/**
 * The first `count` tiles, nearest first by walking, within GROUP_SPREAD steps
 * of `at` that a monster can stand on and nobody stands on or is walking to;
 * null if there are not that many.
 */
function groupTiles(world: World, at: Point, count: number): Point[] | null {
  const { map } = world;
  const taken = new Set<number>();
  for (const other of world.actors) {
    taken.add(tileIndex(map, other.x, other.y));
    const end = other.path[other.path.length - 1];
    if (end) taken.add(tileIndex(map, end.x, end.y));
  }
  const tiles: Point[] = [];
  const seen = new Set<number>([tileIndex(map, at.x, at.y)]);
  let ring: Point[] = [at];
  for (let depth = 0; depth <= GROUP_SPREAD && tiles.length < count; depth++) {
    const next: Point[] = [];
    for (const tile of ring) {
      if (!taken.has(tileIndex(map, tile.x, tile.y)) && tiles.length < count) tiles.push(tile);
      for (const [dx, dy] of NEIGHBOURS) {
        const x = tile.x + dx;
        const y = tile.y + dy;
        if (!monsterWalkable(map, x, y) || seen.has(tileIndex(map, x, y))) continue;
        seen.add(tileIndex(map, x, y));
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
): void {
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
    hp: (kind === ADVENTURER ? ADVENTURER_KIND : (world.kinds[kind] as Kind)).hp,
    windup: 0,
    recover: 0,
    shift,
    stalled: 0,
    xp: noXp(),
    bag: emptyBag(),
    bank: emptyBank(),
  });
}

function updateActor(world: World, actor: Actor, events: WorldEvent[]): void {
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
        actor.path = detour;
        return;
      }
      actor.path = [];
      actor.blocked = 0;
    } else if (actor.blocked >= 2 * BLOCKED_PATIENCE_TICKS) {
      actor.path = [];
      actor.blocked = 0;
    }
    return;
  }
  actor.path.shift();
  // A walk that has been re-routed once stays marked as such until the next decision.
  actor.blocked =
    actor.blocked >= BLOCKED_PATIENCE_TICKS && actor.path.length > 0 ? BLOCKED_PATIENCE_TICKS : 0;
  actor.fromX = actor.x;
  actor.fromY = actor.y;
  actor.x = next.x;
  actor.y = next.y;
  actor.moveTicksLeft = STEP_TICKS;
}

/** Spawn inputs that put the given actors on the free walkable tiles nearest the camp, in order. */
export function spawnsNearCamp(
  world: World,
  cast: readonly { readonly name: string; readonly program: string }[],
): Input[] {
  const { map } = world;
  const camp = place(map, "camp");
  const seen = new Set<number>([tileIndex(map, camp.x, camp.y)]);
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
      if (!isWalkable(map, x, y) || seen.has(tileIndex(map, x, y))) continue;
      seen.add(tileIndex(map, x, y));
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

/** A fingerprint of the program table: names in order, with each program's code and rule labels. */
export function hashPrograms(programs: Programs): string {
  return hashInts(
    Object.keys(programs)
      .sort()
      .flatMap((name) => {
        const program = programs[name] as Program;
        return [
          ...stringInts(name),
          program.version,
          program.code.length,
          ...program.code,
          program.rules.length,
          ...program.rules.flatMap(stringInts),
        ];
      }),
  );
}

/** A fingerprint of the monster kinds: names in order, with each one's numbers. */
export function hashKinds(kinds: Kinds): string {
  return hashInts(
    Object.keys(kinds)
      .sort()
      .flatMap((name) => {
        const kind = kinds[name] as Kind;
        return [...stringInts(name), kind.hp, kind.damage, kind.windup, kind.recovery, kind.reach];
      }),
  );
}

export function hashMap(map: TileMap): string {
  return hashInts([
    ...stringInts(map.name),
    map.width,
    map.height,
    ...map.tiles,
    ...map.places.flatMap((p) => [...stringInts(p.name), p.x, p.y]),
  ]);
}

/** A fingerprint of everything that decides the world's future. */
export function hashWorld(world: World): string {
  return hashWorldAs(world, SNAPSHOT_VERSION);
}

/**
 * The hash a snapshot of `version` stored. Version 4 had no spawn table, no
 * `nextSpawn`, and no `shift` or `stalled` on actors, so those are left out.
 * Versions 4 and 5 had no experience, bag or bank either.
 */
function hashWorldAs(world: World, version: number): string {
  const { rng } = world;
  const v4 = version === 4;
  const before6 = version < 6;
  return hashInts([
    ...stringInts(hashMap(world.map)),
    ...stringInts(hashPrograms(world.programs)),
    ...stringInts(hashKinds(world.kinds)),
    // The tick outgrows 32 bits after some years of uptime, so both halves are hashed.
    world.tick % 0x1_0000_0000,
    (world.tick - (world.tick % 0x1_0000_0000)) / 0x1_0000_0000,
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
      ...(before6 ? [] : [...a.xp, ...a.bag, ...a.bank]),
    ]),
    world.marks.length,
    ...world.marks.flatMap((m) => [m.x, m.y, m.by]),
    ...(v4
      ? []
      : [
          ...stringInts(hashSpawns(world.spawns)),
          world.nextSpawn % 0x1_0000_0000,
          (world.nextSpawn - (world.nextSpawn % 0x1_0000_0000)) / 0x1_0000_0000,
        ]),
  ]);
}

/** A fingerprint of the spawn table, in order. */
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
    ]),
  ]);
}

export const SNAPSHOT_VERSION = 6;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/** The world as text. The map is not stored, only its fingerprint. */
export function snapshot(world: World): string {
  const { map, programs, kinds, spawns, ...state } = world;
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    map: hashMap(map),
    programs: hashPrograms(programs),
    kinds: hashKinds(kinds),
    spawns: hashSpawns(spawns),
    hash: hashWorld(world),
    state,
  });
}

/**
 * Rebuilds a world from a snapshot and the content it was taken with. Refuses,
 * with a SnapshotError, anything it cannot be sure it reads correctly: another
 * version, another map, other programs, monster kinds or spawns, or contents
 * that do not hash to what was saved. Throws a ProgramError or a KindError
 * instead if the content passed in is itself invalid. A version 4 snapshot,
 * from before monsters spawned on their own, is read too: it has no spawn
 * table to compare, and takes on the spawns passed in. So is a version 5
 * snapshot, from before skills and the bank: everyone starts with no
 * experience, an empty bag and an empty bank.
 */
export function restore(
  text: string,
  map: TileMap,
  programs: Programs = {},
  kinds: Kinds = {},
  spawns: Spawns = [],
): World {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SnapshotError("snapshot is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SnapshotError("snapshot is not an object");
  }
  const {
    version,
    map: mapHash,
    programs: programsHash,
    kinds: kindsHash,
    spawns: spawnsHash,
    hash,
    state,
  } = data as Record<string, unknown>;
  if (version !== SNAPSHOT_VERSION && version !== 4 && version !== 5) {
    throw new SnapshotError(`snapshot version ${show(version)} is not 4, 5 or ${SNAPSHOT_VERSION}`);
  }
  if (mapHash !== hashMap(map)) throw new SnapshotError("snapshot was taken on a different map");
  const table = checkPrograms(programs);
  if (programsHash !== hashPrograms(table)) {
    throw new SnapshotError("snapshot was taken with different programs");
  }
  const kindTable = checkKinds(kinds);
  if (kindsHash !== hashKinds(kindTable)) {
    throw new SnapshotError("snapshot was taken with different monster kinds");
  }
  const spawnTable = checkSpawns(spawns, map, table, kindTable);
  // A version 4 world had no spawn table, so it takes on the one it is restored with.
  if (version !== 4 && spawnsHash !== hashSpawns(spawnTable)) {
    throw new SnapshotError("snapshot was taken with different spawns");
  }
  if (version === 4) refuseOldMonsters(state, map);
  const current =
    version === 4 ? fromVersion5(fromVersion4(state)) : version === 5 ? fromVersion5(state) : state;
  const world = readState(current, map, table, kindTable, spawnTable);
  if (!world || hashWorldAs(world, version) !== hash)
    throw new SnapshotError("snapshot contents are damaged");
  return world;
}

/**
 * Version 4 had no monster cap and let monsters onto the camp's ground. A
 * world saved like that cannot go on under today's rules, so it is refused
 * with a message that says so, before readState would call it damaged.
 */
function refuseOldMonsters(state: unknown, map: TileMap): void {
  if (typeof state !== "object" || state === null) return;
  const { actors } = state as Record<string, unknown>;
  if (!Array.isArray(actors)) return;
  let monsters = 0;
  for (const actor of actors as unknown[]) {
    if (typeof actor !== "object" || actor === null) continue;
    const { kind, x, y, fromX, fromY, path } = actor as Record<string, unknown>;
    if (typeof kind !== "string" || kind === ADVENTURER) continue;
    monsters++;
    const onCamp = (px: unknown, py: unknown): boolean =>
      isInt32(px) && isInt32(py) && isWalkable(map, px, py) && terrainAt(map, px, py) === "camp";
    const walking = Array.isArray(path) ? (path as unknown[]) : [];
    const stepsOnCamp = walking.some(
      (p) => typeof p === "object" && p !== null && onCamp(own(p, "x"), own(p, "y")),
    );
    if (onCamp(x, y) || onCamp(fromX, fromY) || stepsOnCamp)
      throw new SnapshotError(
        "snapshot has a monster on or walking onto the camp's ground, where monsters can no longer go",
      );
  }
  if (monsters > MONSTER_CAP)
    throw new SnapshotError(
      `snapshot holds ${monsters} monsters, more than the ${MONSTER_CAP} a world now allows`,
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
        ? { ...actor, xp: noXp(), bag: emptyBag(), bank: emptyBank() }
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

const MAX_WAIT_TICKS = 1_000_000;

/**
 * Rebuilds world state field by field, or returns null if anything is not what
 * a world could hold. The hash alone is not trusted for this: it folds every
 * value to 32 bits, so it cannot tell a number from a string that reads the same.
 */
function readState(
  raw: unknown,
  map: TileMap,
  programs: Programs,
  kinds: Kinds,
  spawns: Spawns,
): World | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { tick, rng, nextActorId, actors, marks, nextSpawn } = raw as Record<string, unknown>;
  if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0) return null;
  // The next arrival is set RESPAWN_TICKS ahead, and only ever from a tick already reached.
  if (typeof nextSpawn !== "number" || !Number.isSafeInteger(nextSpawn) || nextSpawn < 0)
    return null;
  if (nextSpawn > tick + RESPAWN_TICKS) return null;
  // Ids are handed out in order and monsters leave, so ids rise and stay below the next one.
  if (!Array.isArray(actors) || !Array.isArray(marks)) return null;
  if (!isInt32(nextActorId) || nextActorId < 1) return null;
  if (typeof rng !== "object" || rng === null) return null;
  const { a, b, c, d } = rng as Record<string, unknown>;
  if (!isInt32(a) || !isInt32(b) || !isInt32(c) || !isInt32(d)) return null;

  const world: World = {
    map,
    programs,
    kinds,
    spawns,
    tick,
    rng: { a, b, c, d },
    nextActorId,
    actors: [],
    marks: [],
    nextSpawn,
  };
  const adjacent = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
  let lastId = 0;
  let monsters = 0;
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
    } = item as Record<string, unknown>;
    const xp = counts(rawXp, SKILLS.length, MAX_XP);
    const bag = counts(rawBag, BAG_SLOTS, GOODS.length);
    const bank = counts(rawBank, GOODS.length, MAX_BANKED);
    if (!xp || !bag || !bank) return null;
    // A monster has no skills and carries and keeps nothing.
    if (kind !== ADVENTURER && [...xp, ...bag, ...bank].some((n) => n !== 0)) return null;
    if (!isInt32(id) || id <= lastId || id >= nextActorId) return null;
    lastId = id;
    if (typeof kind !== "string") return null;
    if (kind !== ADVENTURER && !Object.hasOwn(kinds, kind)) return null;
    if (!SHIFTS.includes(shift as Shift) || (kind === ADVENTURER && shift !== "")) return null;
    // Monsters keep off the camp's ground, and there are never more than the cap.
    const ground = kind === ADVENTURER ? isWalkable : monsterWalkable;
    if (kind !== ADVENTURER && ++monsters > MONSTER_CAP) return null;
    const numbers = kind === ADVENTURER ? ADVENTURER_KIND : (kinds[kind] as Kind);
    if (!isInt32(hp) || hp < 1 || hp > numbers.hp) return null;
    if (!isInt32(windup) || windup < 0 || windup > numbers.windup) return null;
    if (!isInt32(recover) || recover < 0 || recover > numbers.recovery) return null;
    if (windup > 0 && recover > 0) return null;
    if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
    if (!isInt32(x) || !isInt32(y) || !isInt32(fromX) || !isInt32(fromY)) return null;
    if (!ground(map, x, y) || !ground(map, fromX, fromY)) return null;
    if (!isInt32(moveTicksLeft) || moveTicksLeft < 0 || moveTicksLeft > STEP_TICKS) return null;
    const here = { x, y };
    const from = { x: fromX, y: fromY };
    if (moveTicksLeft === 0 ? fromX !== x || fromY !== y : !adjacent(here, from)) return null;
    if (!isInt32(wait) || wait < 0 || wait > MAX_WAIT_TICKS) return null;
    if (!isInt32(blocked) || blocked < 0 || blocked >= 2 * BLOCKED_PATIENCE_TICKS) return null;
    if (!isInt32(stalled) || stalled < 0 || stalled > MAX_STALLED) return null;
    if (!Array.isArray(path) || path.length > map.tiles.length) return null;
    const steps: Point[] = [];
    let at: Point = here;
    for (const stepTo of path as unknown[]) {
      if (typeof stepTo !== "object" || stepTo === null) return null;
      const { x: sx, y: sy } = stepTo as Record<string, unknown>;
      if (!isInt32(sx) || !isInt32(sy) || !ground(map, sx, sy)) return null;
      const next = { x: sx, y: sy };
      if (!adjacent(at, next)) return null;
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
  // exactly the marks of one attack: its line in one of the four directions.
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
    world.marks.push({ x, y, by });
  }
  const same = (a: readonly Point[], b: readonly Point[]): boolean =>
    a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);
  for (const actor of world.actors) {
    if (actor.windup === 0) continue;
    const own = marksOf.get(actor.id);
    if (!own || own.length === 0) return null;
    if (!NEIGHBOURS.some(([sx, sy]) => same(own, lineOfAttack(world, actor, sx, sy)))) return null;
  }
  return world;
}
