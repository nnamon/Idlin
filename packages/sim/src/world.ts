// The world and the one function that advances it. Everything here is a pure
// function of the seed, the map and the inputs: integers only, no clock.

import { think } from "./brain.ts";
import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import { isWalkable, NEIGHBOURS, type Point, place, type TileMap, tileIndex } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";
import { FAULTS, MEMORY_SLOTS, type Program, ProgramError, validateProgram } from "./vm.ts";
import { wander } from "./wander.ts";

export const TICKS_PER_SECOND = 10;
/** A game hour lasts one minute of stream time, so a game day lasts 24 minutes. */
export const TICKS_PER_GAME_HOUR = 60 * TICKS_PER_SECOND;
export const TICKS_PER_GAME_MINUTE = TICKS_PER_GAME_HOUR / 60;
export const TICKS_PER_DAY = 24 * TICKS_PER_GAME_HOUR;
/** The world begins at dawn. */
export const START_HOUR = 6;
/** Ticks an actor takes to walk from one tile to the next. */
export const STEP_TICKS = 4;
/** Ticks an actor waits for a blocked tile to clear before giving up its path. */
export const BLOCKED_PATIENCE_TICKS = 10;
export const MAX_NAME_LENGTH = 16;

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
  /** Ticks left to pause before the stand-in behaviour picks a new target. */
  wait: number;
  /** Ticks spent waiting for the next tile on the path to clear. */
  blocked: number;
  /** Name of the program that decides for this actor, or null for the stand-in behaviour. */
  readonly program: string | null;
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
}

/** Validated programs by name. Like the map, they are content: fixed for the life of a world. */
export type Programs = Readonly<Record<string, Program>>;

export interface World {
  readonly map: TileMap;
  readonly programs: Programs;
  tick: number;
  rng: Rng;
  nextActorId: number;
  /** In id order, which is also update order. */
  actors: Actor[];
}

export type Input = {
  readonly type: "spawn";
  readonly name: string;
  /** The program to run; must be one of the world's. Left out, the actor uses the stand-in behaviour. */
  readonly program?: string;
} & Point;

/** Program names: a lower-case letter, then letters, digits or underscores. */
const PROGRAM_NAME = /^[a-z][a-z0-9_]{0,31}$/;

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

/** Throws a ProgramError if `programs` holds a bad name or an invalid program. */
export function createWorld(map: TileMap, seed: number, programs: Programs = {}): World {
  return {
    map,
    programs: checkPrograms(programs),
    tick: 0,
    rng: createRng(seed),
    nextActorId: 1,
    actors: [],
  };
}

export const actorAt = (world: World, x: number, y: number): Actor | undefined =>
  world.actors.find((a) => a.x === x && a.y === y);

/** Advances the world by one tick. This is the only way the world changes. */
export function step(world: World, inputs: readonly Input[] = []): void {
  for (const input of inputs) applyInput(world, input);
  world.tick++;
  for (const actor of world.actors) updateActor(world, actor);
}

function applyInput(world: World, input: Input): void {
  // An input that cannot be honoured is dropped; it never throws and never half-applies.
  // Inputs come from outside the simulation, so nothing about their shape is assumed.
  const raw: unknown = input;
  if (typeof raw !== "object" || raw === null) return;
  let fields: Record<string, unknown>;
  try {
    // Read every field once, before anything changes, so a property that throws changes nothing.
    const { type, name, x, y, program } = raw as Record<string, unknown>;
    fields = { type, name, x, y, program };
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
  const program = fields.program ?? null;
  if (program !== null && (typeof program !== "string" || !Object.hasOwn(world.programs, program)))
    return;
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
  });
}

function updateActor(world: World, actor: Actor): void {
  if (actor.moveTicksLeft > 0) {
    actor.moveTicksLeft--;
    if (actor.moveTicksLeft > 0) return;
    actor.fromX = actor.x;
    actor.fromY = actor.y;
  }
  const next = actor.path[0];
  if (!next) {
    if (actor.program === null) wander(world, actor);
    else think(world, actor);
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

/** Spawn inputs that put the named actors on the free walkable tiles nearest the camp. */
export function spawnsNearCamp(world: World, names: readonly string[]): Input[] {
  const { map } = world;
  const camp = place(map, "camp");
  const seen = new Set<number>([tileIndex(map, camp.x, camp.y)]);
  const queue: Point[] = [camp];
  const inputs: Input[] = [];
  for (let head = 0; head < queue.length && inputs.length < names.length; head++) {
    const at = queue[head] as Point;
    if (!actorAt(world, at.x, at.y)) {
      inputs.push({ type: "spawn", name: names[inputs.length] as string, x: at.x, y: at.y });
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
      // -1 for no program; a name's length is never negative.
      ...(a.program === null ? [-1] : stringInts(a.program)),
      ...a.memory,
      a.rule,
      a.fault,
    ]),
  ]);
}

export const SNAPSHOT_VERSION = 2;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/** The world as text. The map is not stored, only its fingerprint. */
export function snapshot(world: World): string {
  const { map, programs, ...state } = world;
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    map: hashMap(map),
    programs: hashPrograms(programs),
    hash: hashWorld(world),
    state,
  });
}

/**
 * Rebuilds a world from a snapshot and the content it was taken with. Refuses,
 * with a SnapshotError, anything it cannot be sure it reads correctly: another
 * version, another map, other programs, or contents that do not hash to what
 * was saved. Throws a ProgramError instead if the programs passed in are
 * themselves invalid.
 */
export function restore(text: string, map: TileMap, programs: Programs = {}): World {
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
  const world = readState(state, map, table);
  if (!world || hashWorld(world) !== hash) throw new SnapshotError("snapshot contents are damaged");
  return world;
}

const MAX_WAIT_TICKS = 1_000_000;

/**
 * Rebuilds world state field by field, or returns null if anything is not what
 * a world could hold. The hash alone is not trusted for this: it folds every
 * value to 32 bits, so it cannot tell a number from a string that reads the same.
 */
function readState(raw: unknown, map: TileMap, programs: Programs): World | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { tick, rng, nextActorId, actors } = raw as Record<string, unknown>;
  if (typeof tick !== "number" || !Number.isSafeInteger(tick) || tick < 0) return null;
  // Actors are never removed, so ids are exactly 1..n and the next id is n + 1.
  if (!Array.isArray(actors) || nextActorId !== actors.length + 1) return null;
  if (typeof rng !== "object" || rng === null) return null;
  const { a, b, c, d } = rng as Record<string, unknown>;
  if (!isInt32(a) || !isInt32(b) || !isInt32(c) || !isInt32(d)) return null;

  const world: World = { map, programs, tick, rng: { a, b, c, d }, nextActorId, actors: [] };
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
    } = item as Record<string, unknown>;
    if (id !== lastId + 1) return null;
    lastId = id;
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
    if (program !== null && (typeof program !== "string" || !Object.hasOwn(programs, program)))
      return null;
    if (!Array.isArray(memory) || memory.length !== MEMORY_SLOTS || !memory.every(isInt32))
      return null;
    const rules = program === null ? 0 : (programs[program] as Program).rules.length;
    if (!isInt32(rule) || rule < -1 || rule >= rules) return null;
    if (!isInt32(fault) || fault < 0 || fault >= FAULTS.length) return null;
    // An actor without a program never runs one, so it has nothing to remember and nothing to fault on.
    if (program === null && (fault !== 0 || memory.some((value) => value !== 0))) return null;
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
    });
  }
  return world;
}
