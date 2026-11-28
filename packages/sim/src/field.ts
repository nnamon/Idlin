// Distance fields: for one target tile, how many steps each tile is from it,
// walking over the ground with people left out. Everyone heading for the same
// tile reads the same field, so a crowd going one way costs one search, not one
// each.
//
// A field is a breadth-first search out from its target over `stepTile` with
// exits allowed, in NEIGHBOURS order, so the tiles come out ring by ring and in
// the same order every time. It runs only as far as someone has asked about,
// and carries on from there when someone asks about a tile further out. A
// city's ground changes at legs-plant, ramp-down and lift-off; the fields are
// dropped whenever `world.atlas` changes, so none goes stale. A field is kept
// while anyone reads it and dropped KEEP_TICKS ticks after the last read.
//
// Fields and the work counters below are kept beside the world, not in it:
// they change how much is computed, never what. Two runs from one snapshot
// make the same reads in the same order, so they count the same work.

import { type Atlas, stepTile } from "./atlas.ts";
import type { World } from "./world.ts";

/** Ticks a field is kept after it was last read. */
export const KEEP_TICKS = 10;

export interface Field {
  /** The target's box tile. */
  goal: number;
  /** Per box tile: steps from the target, or -1 where the search has not got to yet. */
  readonly steps: Int32Array;
  /** The tiles in the order the search got to them: the target, then ring by ring. */
  readonly order: Int32Array;
  /** How many tiles are in `order`, and how many of those have had their neighbours added. */
  reached: number;
  expanded: number;
  /** The tick it was last read in. */
  used: number;
}

/**
 * What path-finding and the grid's queries have done in a world since it was
 * made or restored, counted, so a test can check the work a tick does on every
 * machine alike.
 */
export interface Work {
  /** Tiles whose neighbours a distance field added. */
  fieldTiles: number;
  /** Fields started: one per target tile asked about while none was kept. */
  fields: number;
  /** Tiles an actor's own search took off its queue, and ring tiles it looked at to pick a goal. */
  searchTiles: number;
  /** Actors looked at by the grid's `nearest` and `countWithin`. */
  actors: number;
}

interface Fields {
  readonly atlas: Atlas;
  readonly byGoal: Map<number, Field>;
  /** Fields dropped, kept to be used again so their arrays need not be made anew. */
  readonly spare: Field[];
  tick: number;
}

const kept = new WeakMap<World, Fields>();
const works = new WeakMap<World, Work>();

export function workOf(world: World): Work {
  let work = works.get(world);
  if (!work) {
    work = { fieldTiles: 0, fields: 0, searchTiles: 0, actors: 0 };
    works.set(world, work);
  }
  return work;
}

/** The field of steps to box tile `goal`, which must be walkable. */
export function fieldTo(world: World, goal: number): Field {
  let fields = kept.get(world);
  if (!fields || fields.atlas !== world.atlas) {
    fields = { atlas: world.atlas, byGoal: new Map(), spare: [], tick: world.tick };
    kept.set(world, fields);
  }
  if (fields.tick !== world.tick) {
    fields.tick = world.tick;
    for (const [at, field] of fields.byGoal) {
      if (world.tick - field.used <= KEEP_TICKS) continue;
      fields.byGoal.delete(at);
      fields.spare.push(field);
    }
  }
  let field = fields.byGoal.get(goal);
  if (!field) {
    field = fields.spare.pop() ?? newField(world.atlas.open.length);
    for (let i = 0; i < field.reached; i++) field.steps[field.order[i] as number] = -1;
    field.goal = goal;
    field.steps[goal] = 0;
    field.order[0] = goal;
    field.reached = 1;
    field.expanded = 0;
    fields.byGoal.set(goal, field);
    workOf(world).fields++;
  }
  field.used = world.tick;
  return field;
}

function newField(size: number): Field {
  return {
    goal: -1,
    steps: new Int32Array(size).fill(-1),
    order: new Int32Array(size),
    reached: 0,
    expanded: 0,
    used: 0,
  };
}

/** Adds the neighbours of the next tile in the field's order, if any is left. */
function expand(world: World, field: Field): boolean {
  if (field.expanded >= field.reached) return false;
  const at = field.order[field.expanded++] as number;
  const next = (field.steps[at] as number) + 1;
  for (let d = 0; d < 4; d++) {
    const tile = stepTile(world.atlas, at, d);
    if (tile < 0 || (field.steps[tile] as number) >= 0) continue;
    field.steps[tile] = next;
    field.order[field.reached++] = tile;
  }
  workOf(world).fieldTiles++;
  return true;
}

/** Steps from box tile `tile` to the field's target, or -1 if it cannot be walked to. */
export function stepsTo(world: World, field: Field, tile: number): number {
  while ((field.steps[tile] as number) < 0 && expand(world, field));
  return field.steps[tile] as number;
}

/**
 * The `i`th tile the field's search gets to, counting the target as the 0th,
 * or -1 if fewer than i + 1 tiles can be walked to from it. Read for i = 0, 1,
 * 2 and on, these are the rings round the target, nearest first.
 */
export function nthTile(world: World, field: Field, i: number): number {
  while (field.reached <= i && expand(world, field));
  return i < field.reached ? (field.order[i] as number) : -1;
}

const parts = new WeakMap<Atlas, Int32Array>();

/**
 * Which piece of ground tile `tile` is in: two tiles have the same number
 * when one can be walked to from the other, people left out. -1 for a tile
 * nobody can stand on. Worked out once per atlas.
 */
export function partOf(atlas: Atlas, tile: number): number {
  let part = parts.get(atlas);
  if (!part) {
    part = label(atlas);
    parts.set(atlas, part);
  }
  return part[tile] as number;
}

function label(atlas: Atlas): Int32Array {
  const size = atlas.open.length;
  const part = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let count = 0;
  for (let first = 0; first < size; first++) {
    if (!atlas.open[first] || (part[first] as number) >= 0) continue;
    part[first] = count;
    queue[0] = first;
    for (let head = 0, tail = 1; head < tail; head++) {
      const at = queue[head] as number;
      for (let d = 0; d < 4; d++) {
        const next = stepTile(atlas, at, d);
        if (next < 0 || (part[next] as number) >= 0) continue;
        part[next] = count;
        queue[tail++] = next;
      }
    }
    count++;
  }
  return part;
}
