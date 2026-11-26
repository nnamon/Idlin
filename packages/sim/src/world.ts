// The world and the one function that advances it. Everything here is a pure
// function of the seed, the map and the inputs: integers only, no clock.

import { think } from "./brain.ts";
import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import { isWalkable, NEIGHBOURS, type Point, place, type TileMap, tileIndex } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";
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
  /** Ticks spent waiting for the next tile on the path to clear. */
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
}

/** Validated programs by name. Like the map, they are content: fixed for the life of a world. */
export type Programs = Readonly<Record<string, Program>>;

export interface World {
  readonly map: TileMap;
  readonly programs: Programs;
  readonly kinds: Kinds;
  tick: number;
  rng: Rng;
  nextActorId: number;
  /** In id order, which is also update order. */
  actors: Actor[];
  /** Tiles that attacks in wind-up are about to land on, in the order the attacks began. */
  marks: Mark[];
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
 * and a KindError if `kinds` holds a bad monster kind.
 */
export function createWorld(
  map: TileMap,
  seed: number,
  programs: Programs = {},
  kinds: Kinds = {},
): World {
  return {
    map,
    programs: checkPrograms(programs),
    kinds: checkKinds(kinds),
    tick: 0,
    rng: createRng(seed),
    nextActorId: 1,
    actors: [],
    marks: [],
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
    };

/**
 * Advances the world by one tick, and returns what happened in it. This is the
 * only way the world changes.
 */
export function step(world: World, inputs: readonly Input[] = []): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const input of inputs) applyInput(world, input);
  world.tick++;
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
      const target = world.actors.find(
        (a) => a.x === mark.x && a.y === mark.y && a.hp > 0 && enemies(a, attacker),
      );
      if (!target) {
        events.push({ type: "miss", tick: world.tick, actor: attacker.id, x: mark.x, y: mark.y });
        continue;
      }
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
    }
    world.marks = world.marks.filter((mark) => mark.by !== attacker.id);
  }
  const out = world.actors.filter((actor) => actor.hp <= 0);
  if (out.length === 0) return;
  const gone = new Set(out.map((actor) => actor.id));
  world.marks = world.marks.filter((mark) => !gone.has(mark.by));
  world.actors = world.actors.filter((actor) => actor.hp > 0 || actor.kind === ADVENTURER);
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

/** The walkable tile nearest `from` that nobody but `self` stands on, or null if there is none. */
export function freeTileNear(world: World, from: Point, self?: Actor): Point | null {
  const { map } = world;
  if (!isWalkable(map, from.x, from.y)) return null;
  const seen = new Set<number>([tileIndex(map, from.x, from.y)]);
  const queue: Point[] = [{ x: from.x, y: from.y }];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    const there = actorAt(world, at.x, at.y);
    if (!there || there === self) return at;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!isWalkable(map, x, y) || seen.has(tileIndex(map, x, y))) continue;
      seen.add(tileIndex(map, x, y));
      queue.push({ x, y });
    }
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
  if (kind !== ADVENTURER && !Object.hasOwn(world.kinds, kind)) return;
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
  if (actorAt(world, next.x, next.y)) {
    // Someone stands where this actor wants to step. Wait a little, then give up the path.
    actor.blocked++;
    if (actor.blocked >= BLOCKED_PATIENCE_TICKS) {
      actor.path = [];
      actor.blocked = 0;
    }
    return;
  }
  actor.path.shift();
  actor.blocked = 0;
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
  const { rng } = world;
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
    ]),
    world.marks.length,
    ...world.marks.flatMap((m) => [m.x, m.y, m.by]),
  ]);
}

export const SNAPSHOT_VERSION = 4;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/** The world as text. The map is not stored, only its fingerprint. */
export function snapshot(world: World): string {
  const { map, programs, kinds, ...state } = world;
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    map: hashMap(map),
    programs: hashPrograms(programs),
    kinds: hashKinds(kinds),
    hash: hashWorld(world),
    state,
  });
}

/**
 * Rebuilds a world from a snapshot and the content it was taken with. Refuses,
 * with a SnapshotError, anything it cannot be sure it reads correctly: another
 * version, another map, other programs or monster kinds, or contents that do
 * not hash to what was saved. Throws a ProgramError or a KindError instead if
 * the programs or kinds passed in are themselves invalid.
 */
export function restore(
  text: string,
  map: TileMap,
  programs: Programs = {},
  kinds: Kinds = {},
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
    hash,
    state,
  } = data as Record<string, unknown>;
  if (version !== SNAPSHOT_VERSION) {
    throw new SnapshotError(`snapshot version ${show(version)} is not ${SNAPSHOT_VERSION}`);
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
  const world = readState(state, map, table, kindTable);
  if (!world || hashWorld(world) !== hash) throw new SnapshotError("snapshot contents are damaged");
  return world;
}

const MAX_WAIT_TICKS = 1_000_000;

/**
 * Rebuilds world state field by field, or returns null if anything is not what
 * a world could hold. The hash alone is not trusted for this: it folds every
 * value to 32 bits, so it cannot tell a number from a string that reads the same.
 */
function readState(raw: unknown, map: TileMap, programs: Programs, kinds: Kinds): World | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { tick, rng, nextActorId, actors, marks } = raw as Record<string, unknown>;
  if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0) return null;
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
    tick,
    rng: { a, b, c, d },
    nextActorId,
    actors: [],
    marks: [],
  };
  const adjacent = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
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
    } = item as Record<string, unknown>;
    if (!isInt32(id) || id <= lastId || id >= nextActorId) return null;
    lastId = id;
    if (typeof kind !== "string") return null;
    if (kind !== ADVENTURER && !Object.hasOwn(kinds, kind)) return null;
    const numbers = kind === ADVENTURER ? ADVENTURER_KIND : (kinds[kind] as Kind);
    if (!isInt32(hp) || hp < 1 || hp > numbers.hp) return null;
    if (!isInt32(windup) || windup < 0 || windup > numbers.windup) return null;
    if (!isInt32(recover) || recover < 0 || recover > numbers.recovery) return null;
    if (windup > 0 && recover > 0) return null;
    if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
    if (!isInt32(x) || !isInt32(y) || !isInt32(fromX) || !isInt32(fromY)) return null;
    if (!isWalkable(map, x, y) || !isWalkable(map, fromX, fromY) || actorAt(world, x, y))
      return null;
    if (!isInt32(moveTicksLeft) || moveTicksLeft < 0 || moveTicksLeft > STEP_TICKS) return null;
    const here = { x, y };
    const from = { x: fromX, y: fromY };
    if (moveTicksLeft === 0 ? fromX !== x || fromY !== y : !adjacent(here, from)) return null;
    if (!isInt32(wait) || wait < 0 || wait > MAX_WAIT_TICKS) return null;
    if (!isInt32(blocked) || blocked < 0 || blocked >= BLOCKED_PATIENCE_TICKS) return null;
    if (!Array.isArray(path) || path.length > map.tiles.length) return null;
    const steps: Point[] = [];
    let at: Point = here;
    for (const stepTo of path as unknown[]) {
      if (typeof stepTo !== "object" || stepTo === null) return null;
      const { x: sx, y: sy } = stepTo as Record<string, unknown>;
      if (!isInt32(sx) || !isInt32(sy) || !isWalkable(map, sx, sy)) return null;
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
    });
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
