// Who stands where, so that finding the actors on a tile or near one does not
// mean going through every actor in the world.
//
// A grid is the atlas's box cut into square cells of CELL tiles a side, each
// with a plain list of the actors standing in it, kept in the world's update
// order; and, per tile, a tally of the actors standing on it, the monsters
// among them, and the walks that end on it. Every query walks cells in a
// fixed order and breaks ties by update order, so its answer is the one a
// pass over `world.actors` in order would give, whatever the cells hold.
// Nothing is read out of a hash map in its own order: `order` is only looked
// up by actor.
//
// `step` holds one grid while it updates the actors. Nobody joins or leaves
// the world in that pass, and the only changes to where an actor stands or
// where it is walking to are made through stepOnto, putAt, setPath and
// stepOff below, which keep a held grid in step (grid.test.ts fails if any
// other simulation file makes them). Anywhere else, `gridOf` builds a grid
// from the world as it is, so there is no grid to go stale.

import { type Region, regionAt } from "./atlas.ts";
import { workOf } from "./field.ts";
import type { Point } from "./map.ts";
import { type Actor, ADVENTURER, type Mark, type World } from "./world.ts";

/** Tiles along each side of a cell. */
const CELL = 8;

/** Per box tile of the atlas: actors standing on it, the monsters among them, and walks ending on it. */
export interface Tally {
  readonly standing: Int32Array;
  readonly monsters: Int32Array;
  readonly ending: Int32Array;
}

export interface Grid {
  /** World coordinates of the atlas box's top-left tile, which is the first cell's, and the box's size. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly cols: number;
  readonly rows: number;
  /** Per cell, row by row, the actors standing in it in update order. */
  readonly cells: readonly Actor[][];
  /** Each actor's place in `world.actors`. */
  readonly order: ReadonlyMap<Actor, number>;
  /** The actors, as `world.actors` held them when the grid was built. */
  readonly actors: readonly Actor[];
  /** Each actor by id. */
  readonly byId: ReadonlyMap<number, Actor>;
  /** Counted the first time it is asked for. */
  tally: Tally | null;
  /** The world's marks by box tile, each tile's in the world's order; listed the first time they are asked for. */
  marks: Map<number, Mark[]> | null;
  /** Per region, in the atlas's order: residents standing in it, then monsters. */
  readonly sides: Int32Array;
  readonly world: World;
}

const held = new WeakMap<World, Grid>();

function build(world: World): Grid {
  const { atlas } = world;
  const cols = Math.ceil(atlas.width / CELL);
  const rows = Math.ceil(atlas.height / CELL);
  const cells: Actor[][] = Array.from({ length: cols * rows }, () => []);
  const order = new Map<Actor, number>();
  const byId = new Map<number, Actor>();
  const grid: Grid = {
    left: atlas.left,
    top: atlas.top,
    width: atlas.width,
    height: atlas.height,
    cols,
    rows,
    cells,
    order,
    actors: world.actors,
    byId,
    tally: null,
    marks: null,
    sides: new Int32Array(atlas.regions.length * 2),
    world,
  };
  world.actors.forEach((actor, i) => {
    order.set(actor, i);
    byId.set(actor.id, actor);
    cells[cellOf(grid, actor.x, actor.y)]?.push(actor);
    side(grid, actor, actor.x, actor.y, 1);
  });
  return grid;
}

/**
 * The box tile of world tile (x, y). Every actor stands on a tile of the
 * atlas, and every walk ends on one: `restore` refuses a snapshot otherwise,
 * and the simulation only moves actors along walkable steps.
 */
export const tileOf = (grid: Grid, x: number, y: number): number =>
  (y - grid.top) * grid.width + (x - grid.left);

/** The grid's tally, counted from its actors the first time it is asked for. */
export function tallyOf(grid: Grid): Tally {
  if (grid.tally) return grid.tally;
  const size = grid.width * grid.height;
  const tally: Tally = {
    standing: new Int32Array(size),
    monsters: new Int32Array(size),
    ending: new Int32Array(size),
  };
  for (const actor of grid.actors) {
    count(grid, tally, actor, actor.x, actor.y, 1);
    const end = actor.path[actor.path.length - 1];
    if (end) (tally.ending[tileOf(grid, end.x, end.y)] as number)++;
  }
  grid.tally = tally;
  return tally;
}

/** The marks on box tile `tile`, in the world's order. */
export function marksOn(grid: Grid, tile: number): readonly Mark[] {
  if (!grid.marks) {
    grid.marks = new Map();
    for (const mark of grid.world.marks) listMark(grid, mark);
  }
  return grid.marks.get(tile) ?? [];
}

function listMark(grid: Grid, mark: Mark): void {
  const marks = grid.marks as Map<number, Mark[]>;
  const tile = tileOf(grid, mark.x, mark.y);
  const list = marks.get(tile);
  if (list) list.push(mark);
  else marks.set(tile, [mark]);
}

/** Marks a tile an attack is about to land on. */
export function addMark(world: World, mark: Mark): void {
  world.marks.push(mark);
  const grid = held.get(world);
  if (grid?.marks) listMark(grid, mark);
}

function count(grid: Grid, tally: Tally, actor: Actor, x: number, y: number, by: number): void {
  const tile = tileOf(grid, x, y);
  tally.standing[tile] = (tally.standing[tile] as number) + by;
  if (actor.kind !== ADVENTURER) tally.monsters[tile] = (tally.monsters[tile] as number) + by;
}

/** Moves `actor` onto (x, y), stepping from where it stood: that becomes the tile it steps from. */
export function stepOnto(world: World, actor: Actor, x: number, y: number): void {
  actor.fromX = actor.x;
  actor.fromY = actor.y;
  move(world, actor, x, y);
}

/** Puts `actor` on (x, y), standing still there. */
export function putAt(world: World, actor: Actor, x: number, y: number): void {
  move(world, actor, x, y);
  actor.fromX = x;
  actor.fromY = y;
}

/** Gives `actor` a new walk. */
export function setPath(world: World, actor: Actor, path: Point[]): void {
  const grid = held.get(world);
  if (grid?.tally) {
    const { ending } = grid.tally;
    const old = actor.path[actor.path.length - 1];
    if (old) (ending[tileOf(grid, old.x, old.y)] as number)--;
    const end = path[path.length - 1];
    if (end) (ending[tileOf(grid, end.x, end.y)] as number)++;
  }
  actor.path = path;
}

/** Takes the first tile off `actor`'s walk and returns it. */
export function stepOff(world: World, actor: Actor): Point | undefined {
  const next = actor.path.shift();
  const grid = held.get(world);
  // The walk's end changes only when the tile taken off was the last.
  if (next && actor.path.length === 0 && grid?.tally)
    (grid.tally.ending[tileOf(grid, next.x, next.y)] as number)--;
  return next;
}

function move(world: World, actor: Actor, x: number, y: number): void {
  const fromX = actor.x;
  const fromY = actor.y;
  actor.x = x;
  actor.y = y;
  const grid = held.get(world);
  if (!grid) return;
  if (grid.tally) {
    count(grid, grid.tally, actor, fromX, fromY, -1);
    count(grid, grid.tally, actor, x, y, 1);
  }
  side(grid, actor, fromX, fromY, -1);
  side(grid, actor, x, y, 1);
  const from = cellOf(grid, fromX, fromY);
  const to = cellOf(grid, x, y);
  if (from === to) return;
  const old = grid.cells[from];
  const at = old ? old.indexOf(actor) : -1;
  if (at >= 0) old?.splice(at, 1);
  const cell = grid.cells[to];
  if (!cell) return;
  // Into the cell at its place in update order.
  const place = grid.order.get(actor) as number;
  let i = cell.length;
  while (i > 0 && (grid.order.get(cell[i - 1] as Actor) as number) > place) i--;
  cell.splice(i, 0, actor);
}

/** The cell holding world tile (x, y), or -1 off the grid. */
function cellOf(grid: Grid, x: number, y: number): number {
  const cx = Math.floor((x - grid.left) / CELL);
  const cy = Math.floor((y - grid.top) / CELL);
  if (!(cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows)) return -1;
  return cy * grid.cols + cx;
}

/** The grid `step` holds for the world, or one built now. */
export const gridOf = (world: World): Grid => held.get(world) ?? build(world);

/** Builds a grid that `gridOf` answers with until `releaseGrid`. */
export function holdGrid(world: World): void {
  held.set(world, build(world));
}

export function releaseGrid(world: World): void {
  held.delete(world);
}

/** The first actor in update order standing on (x, y) that `test` accepts. */
export function firstAt(
  grid: Grid,
  x: number,
  y: number,
  test: (actor: Actor) => boolean,
): Actor | undefined {
  const cell = grid.cells[cellOf(grid, x, y)];
  if (!cell) return undefined;
  for (const actor of cell) if (actor.x === x && actor.y === y && test(actor)) return actor;
  return undefined;
}

/** Every actor standing on (x, y) that `test` accepts, in update order. */
export function allAt(grid: Grid, x: number, y: number, test: (actor: Actor) => boolean): Actor[] {
  const cell = grid.cells[cellOf(grid, x, y)];
  return cell ? cell.filter((actor) => actor.x === x && actor.y === y && test(actor)) : [];
}

const steps = (a: Actor, x: number, y: number): number => Math.abs(a.x - x) + Math.abs(a.y - y);

/** A rectangle of world tiles: a region's map where it lies. */
export type Area = Pick<Region, "x" | "y" | "map">;

/** The cells, as [first column, last column, first row, last row], that hold any tile of `area`. */
function cellsOver(grid: Grid, area: Area): [number, number, number, number] {
  const clamp = (v: number, most: number): number => Math.min(most, Math.max(0, v));
  return [
    clamp(Math.floor((area.x - grid.left) / CELL), grid.cols - 1),
    clamp(Math.floor((area.x + area.map.width - 1 - grid.left) / CELL), grid.cols - 1),
    clamp(Math.floor((area.y - grid.top) / CELL), grid.rows - 1),
    clamp(Math.floor((area.y + area.map.height - 1 - grid.top) / CELL), grid.rows - 1),
  ];
}

/** How many residents (`monsters` false) or monsters stand in region `region`. */
export const inRegion = (grid: Grid, region: number, monsters: boolean): number =>
  grid.sides[region * 2 + (monsters ? 1 : 0)] ?? 0;

function side(grid: Grid, actor: Actor, x: number, y: number, by: number): void {
  const region = regionAt(grid.world.atlas, x, y);
  if (region < 0) return;
  const i = region * 2 + (actor.kind === ADVENTURER ? 0 : 1);
  grid.sides[i] = (grid.sides[i] as number) + by;
}

/**
 * The actor `test` accepts that is fewest steps in a straight grid line from
 * (x, y), the first in update order if several are as near, looking only in
 * cells that hold a tile of `area`: `test` must accept no actor outside it.
 * Cells are looked at ring by ring outwards from (x, y)'s, until no cell
 * further out could hold one as near.
 */
export function nearest(
  grid: Grid,
  x: number,
  y: number,
  area: Area,
  test: (actor: Actor) => boolean,
): Actor | undefined {
  const cx = Math.floor((x - grid.left) / CELL);
  const cy = Math.floor((y - grid.top) / CELL);
  const [x0, x1, y0, y1] = cellsOver(grid, area);
  const rings = Math.max(cx - x0, x1 - cx, cy - y0, y1 - cy);
  let best: Actor | undefined;
  let bestSteps = 0;
  let bestPlace = 0;
  let looked = 0;
  for (let k = 0; k <= rings; k++) {
    // Every tile of a cell k rings out is at least this many steps away.
    if (best && (k - 1) * CELL + 1 > bestSteps) break;
    for (let gy = cy - k; gy <= cy + k; gy++) {
      if (gy < y0 || gy > y1) continue;
      const stride = k === 0 || gy === cy - k || gy === cy + k ? 1 : 2 * k;
      for (let gx = cx - k; gx <= cx + k; gx += stride) {
        if (gx < x0 || gx > x1) continue;
        const cell = grid.cells[gy * grid.cols + gx] as Actor[];
        looked += cell.length;
        for (const actor of cell) {
          if (!test(actor)) continue;
          const away = steps(actor, x, y);
          const place = grid.order.get(actor) as number;
          if (!best || away < bestSteps || (away === bestSteps && place < bestPlace)) {
            best = actor;
            bestSteps = away;
            bestPlace = place;
          }
        }
      }
    }
  }
  workOf(grid.world).actors += looked;
  return best;
}

/**
 * How many actors `test` accepts within `reach` steps of (x, y) in a straight
 * grid line, looking only in cells that hold a tile of `area`: `test` must
 * accept no actor outside it.
 */
export function countWithin(
  grid: Grid,
  x: number,
  y: number,
  reach: number,
  area: Area,
  test: (actor: Actor) => boolean,
): number {
  if (reach < 0) return 0;
  const [ax0, ax1, ay0, ay1] = cellsOver(grid, area);
  const x0 = Math.max(ax0, Math.floor((x - reach - grid.left) / CELL));
  const x1 = Math.min(ax1, Math.floor((x + reach - grid.left) / CELL));
  const y0 = Math.max(ay0, Math.floor((y - reach - grid.top) / CELL));
  const y1 = Math.min(ay1, Math.floor((y + reach - grid.top) / CELL));
  let count = 0;
  let looked = 0;
  for (let gy = y0; gy <= y1; gy++)
    for (let gx = x0; gx <= x1; gx++) {
      const cell = grid.cells[gy * grid.cols + gx] as Actor[];
      looked += cell.length;
      for (const actor of cell) if (steps(actor, x, y) <= reach && test(actor)) count++;
    }
  workOf(grid.world).actors += looked;
  return count;
}
