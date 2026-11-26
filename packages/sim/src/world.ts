// The world and the one function that advances it. Everything here is a pure
// function of the seed, the map and the inputs: integers only, no clock.

import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import { isWalkable, NEIGHBOURS, type Point, place, type TileMap, tileIndex } from "./map.ts";
import { createRng, type Rng } from "./rng.ts";
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
}

export interface World {
  readonly map: TileMap;
  tick: number;
  rng: Rng;
  nextActorId: number;
  /** In id order, which is also update order. */
  actors: Actor[];
}

export type Input = { readonly type: "spawn"; readonly name: string } & Point;

export function createWorld(map: TileMap, seed: number): World {
  return { map, tick: 0, rng: createRng(seed), nextActorId: 1, actors: [] };
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
  const { type, name, x, y } = raw as Record<string, unknown>;
  if (type !== "spawn") return;
  if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) return;
  if (!isInt32(x) || !isInt32(y)) return;
  if (!isWalkable(world.map, x, y) || actorAt(world, x, y)) return;
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
    wander(world, actor);
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
    world.tick,
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
    ]),
  ]);
}

export const SNAPSHOT_VERSION = 1;

export class SnapshotError extends Error {
  override name = "SnapshotError";
}

/** The world as text. The map is not stored, only its fingerprint. */
export function snapshot(world: World): string {
  const { map, ...state } = world;
  return JSON.stringify({
    version: SNAPSHOT_VERSION,
    map: hashMap(map),
    hash: hashWorld(world),
    state,
  });
}

/**
 * Rebuilds a world from a snapshot and the map it was taken on. Refuses, with a
 * SnapshotError, anything it cannot be sure it reads correctly: another
 * version, another map, or contents that do not hash to what was saved.
 */
export function restore(text: string, map: TileMap): World {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new SnapshotError("snapshot is not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SnapshotError("snapshot is not an object");
  }
  const { version, map: mapHash, hash, state } = data as Record<string, unknown>;
  if (version !== SNAPSHOT_VERSION) {
    throw new SnapshotError(`snapshot version ${show(version)} is not ${SNAPSHOT_VERSION}`);
  }
  if (mapHash !== hashMap(map)) throw new SnapshotError("snapshot was taken on a different map");
  const world = readState(state, map);
  if (!world || hashWorld(world) !== hash) throw new SnapshotError("snapshot contents are damaged");
  return world;
}

const MAX_WAIT_TICKS = 1_000_000;

/**
 * Rebuilds world state field by field, or returns null if anything is not what
 * a world could hold. The hash alone is not trusted for this: it folds every
 * value to 32 bits, so it cannot tell a number from a string that reads the same.
 */
function readState(raw: unknown, map: TileMap): World | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { tick, rng, nextActorId, actors } = raw as Record<string, unknown>;
  if (!isInt32(tick) || tick < 0 || !isInt32(nextActorId) || nextActorId < 1) return null;
  if (typeof rng !== "object" || rng === null || !Array.isArray(actors)) return null;
  const { a, b, c, d } = rng as Record<string, unknown>;
  if (!isInt32(a) || !isInt32(b) || !isInt32(c) || !isInt32(d)) return null;

  const world: World = { map, tick, rng: { a, b, c, d }, nextActorId, actors: [] };
  const adjacent = (p: Point, q: Point): boolean => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
  let lastId = 0;
  for (const item of actors as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { id, name, x, y, fromX, fromY, moveTicksLeft, path, wait, blocked } = item as Record<
      string,
      unknown
    >;
    if (!isInt32(id) || id <= lastId || id >= nextActorId) return null;
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
    world.actors.push({ id, name, x, y, fromX, fromY, moveTicksLeft, path: steps, wait, blocked });
  }
  return world;
}
