// Where a program meets the world: answers its sensors and carries out the one
// action it commits. Called when an actor has nothing left to do.

import { type Atlas, pointOf, type Region, regionAt, stepTile, tileAt, walkable } from "./atlas.ts";
import { atBank, BAG_SLOTS, banked, carrying, deposit, freeSlots, GOODS, withdraw } from "./bag.ts";
import {
  atFire,
  COOK_TICKS,
  cook,
  eat,
  GATHER_TICKS,
  NO_NODE,
  nearestNode,
  work,
} from "./gather.ts";
import {
  addMark,
  countWithin,
  firstAt,
  gridOf,
  inRegion,
  marksOn,
  nearest,
  setPath,
  tallyOf,
  tileOf,
} from "./grid.ts";
import { NEIGHBOURS, type Point, place } from "./map.ts";
import { findPath, scratchFor } from "./path.ts";
import { nextInt } from "./rng.ts";
import { levelFor, SKILLS } from "./skills.ts";
import { syscall } from "./syscalls.ts";
import { FAULTS, type Program, runDecision } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  blockerAt,
  canStep,
  clock,
  enemies,
  inFirelight,
  kindOf,
  LIGHT_REACH,
  lineOfAttack,
  mending,
  sameRegion,
  type World,
  type WorldEvent,
} from "./world.ts";

/** Ticks an actor stands still after `idle` or an action that came to nothing; also the shortest `wait`. */
export const IDLE_TICKS = 5;
/** Ticks an actor stands confused after its program faults, before it tries again. */
export const CONFUSED_TICKS = 30;
export const MAX_WAIT_ACTION_TICKS = 600;
/** What `threat_distance` answers when there is no enemy. */
export const NO_THREAT = 9999;
/** How many tiles `flee` walks at most. */
export const FLEE_STEPS = 3;
/** How many steps ahead `flee` looks for somewhere farther away. */
export const FLEE_SIGHT = 8;
/** Where `stalled` stops counting. */
export const MAX_STALLED = 1000;

export function think(world: World, actor: Actor, events: WorldEvent[]): void {
  if (actor.wait > 0) {
    actor.wait--;
    return;
  }
  const program = world.programs[actor.program] as Program;
  // Nothing changes while the program decides, so the nearest enemy, and the
  // nearest node of each kind, are looked for once, the first time a sensor asks.
  let enemy: Actor | undefined | null = null;
  const foe = (): Actor | undefined => {
    if (enemy === null) enemy = threat(world, actor);
    return enemy;
  };
  const nodes = new Map<number, Point | null>();
  const node = (kind: number): Point | null => {
    let side = nodes.get(kind);
    if (side === undefined) {
      side = nearestNode(world, actor, kind);
      nodes.set(kind, side);
    }
    return side;
  };
  const decision = runDecision(program, actor.memory, (id, args) =>
    sense(world, actor, foe, node, id, args),
  );
  actor.rule = decision.rule;
  actor.fault = FAULTS.indexOf(decision.fault);
  if (!decision.action) {
    actor.wait = CONFUSED_TICKS;
    events.push({ type: "fault", tick: world.tick, actor: actor.id, fault: decision.fault });
    return;
  }
  events.push({
    type: "decide",
    tick: world.tick,
    actor: actor.id,
    rule: decision.rule,
    action: syscall(decision.action.id)?.name ?? "",
  });
  act(world, actor, decision.action.id, decision.action.args, events);
}

const steps = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * The nearest enemy in this actor's region, the one with the lowest id if
 * several are as near. A resident mending at camp is nobody's enemy.
 */
function threat(world: World, actor: Actor): Actor | undefined {
  const grid = gridOf(world);
  const region = regionAt(world.atlas, actor.x, actor.y);
  // A resident's enemies are monsters, and a monster's residents.
  if (inRegion(grid, region, actor.kind === ADVENTURER) === 0) return undefined;
  return nearest(
    grid,
    actor.x,
    actor.y,
    world.atlas.regions[region] as Region,
    (other) => enemies(actor, other) && !mending(other) && sameRegion(world, actor, other),
  );
}

/** How near, in steps, someone stands to count as one of the nearest enemy's friends for `threat_friends`. */
export const FRIENDS_REACH = 4;

/**
 * How many of `actor`'s own kind, itself and anyone mending left out, stand
 * within `reach` steps of it in its region. A reach below 0 finds nobody.
 */
const friendsWithin = (world: World, actor: Actor, reach: number): number =>
  countWithin(
    gridOf(world),
    actor.x,
    actor.y,
    reach,
    world.atlas.regions[regionAt(world.atlas, actor.x, actor.y)] as Region,
    (other) =>
      other !== actor &&
      other.kind === actor.kind &&
      !mending(other) &&
      sameRegion(world, actor, other),
  );

/** Ticks until an enemy's attack lands on a tile, or 0 if none is coming. */
function danger(world: World, actor: Actor, x: number, y: number): number {
  if (!walkable(world.atlas, x, y)) return 0;
  const grid = gridOf(world);
  let soonest = 0;
  for (const mark of marksOn(grid, tileOf(grid, x, y))) {
    if (mark.x !== x || mark.y !== y) continue;
    const attacker = grid.byId.get(mark.by);
    if (!attacker || !enemies(actor, attacker)) continue;
    if (soonest === 0 || attacker.windup < soonest) soonest = attacker.windup;
  }
  return soonest;
}

/**
 * The way to the nearest tile no enemy's blow is about to land on and nothing
 * blocks, walking only where this actor can walk, or [] if this one is already
 * safe or nowhere safe can be reached.
 */
function wayClear(world: World, actor: Actor): Point[] {
  const { atlas } = world;
  const start = tileAt(atlas, actor.x, actor.y);
  const cameFrom = new Map<number, number>([[start, start]]);
  const queue: Point[] = [{ x: actor.x, y: actor.y }];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    if (danger(world, actor, at.x, at.y) === 0) {
      const path: Point[] = [];
      for (let k = tileAt(atlas, at.x, at.y); k !== start; k = cameFrom.get(k) as number) {
        path.push(pointOf(atlas, k));
      }
      return path.reverse();
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!canStep(world, actor, at.x, at.y, x, y) || blockerAt(world, x, y, actor)) continue;
      const index = tileAt(atlas, x, y);
      if (cameFrom.has(index)) continue;
      cameFrom.set(index, tileAt(atlas, at.x, at.y));
      queue.push({ x, y });
    }
  }
  return [];
}

/**
 * The first FLEE_STEPS tiles of the way to the tile farthest from `from`, among
 * those within FLEE_SIGHT steps' walk. Looking that far ahead lets an actor
 * walk out of a corner instead of pressing into it. [] if nowhere is farther.
 */
function wayFrom(world: World, actor: Actor, from: Point): Point[] {
  const { atlas } = world;
  const start = tileAt(atlas, actor.x, actor.y);
  const cameFrom = new Map<number, number>([[start, start]]);
  let frontier: Point[] = [{ x: actor.x, y: actor.y }];
  let best: Point = frontier[0] as Point;
  for (let depth = 0; depth < FLEE_SIGHT && frontier.length > 0; depth++) {
    const next: Point[] = [];
    for (const at of frontier) {
      for (const [dx, dy] of NEIGHBOURS) {
        const tile = { x: at.x + dx, y: at.y + dy };
        if (
          !canStep(world, actor, at.x, at.y, tile.x, tile.y) ||
          blockerAt(world, tile.x, tile.y, actor)
        )
          continue;
        const index = tileAt(atlas, tile.x, tile.y);
        if (cameFrom.has(index)) continue;
        cameFrom.set(index, tileAt(atlas, at.x, at.y));
        next.push(tile);
        if (steps(tile, from) > steps(best, from)) best = tile;
      }
    }
    frontier = next;
  }
  const path: Point[] = [];
  for (let at = tileAt(atlas, best.x, best.y); at !== start; at = cameFrom.get(at) as number) {
    path.push(pointOf(atlas, at));
  }
  return path.reverse().slice(0, FLEE_STEPS);
}

/** The tiles an attack towards (x, y) would land on. */
function attackTiles(world: World, actor: Actor, x: number, y: number): Point[] {
  const dx = x - actor.x;
  const dy = y - actor.y;
  if (dx === 0 && dy === 0) return [];
  const [sx, sy] = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
  return lineOfAttack(world, actor, sx, sy);
}

/**
 * The way to `to`, going round anyone who gets in the way (adventurers walk
 * through each other; monsters do not). If someone already stands on `to`, or
 * the way is cut off, it leads instead to the nearest tile (by walking,
 * ignoring people) that can be reached and that nobody stands on; among tiles
 * as near as each other, staying where it is comes first. So people sent to
 * one place gather round it and settle instead of piling onto one tile.
 * [] when there is nowhere nearer to go.
 */
export function wayTo(world: World, actor: Actor, to: Point): Point[] {
  const { atlas } = world;
  if (!walkable(atlas, to.x, to.y)) return [];
  const start = tileAt(atlas, actor.x, actor.y);
  const { stamp, reached: inReach, from: cameFrom, queue, seen } = scratchFor(atlas);
  // Who else stands on a tile, and who else is walking to it, from the grid's
  // tally less this actor's own share.
  const grid = gridOf(world);
  const { standing, monsters, ending } = tallyOf(grid);
  const own = actor.path[actor.path.length - 1];
  const ownEnd = own ? tileOf(grid, own.x, own.y) : -1;
  const others = (tile: number): number => (standing[tile] as number) - (tile === start ? 1 : 0);
  // Someone on the tile gets in this actor's way (see `blocks`): anyone, for a
  // monster; a monster, for a resident.
  const barred = (tile: number): boolean =>
    actor.kind !== ADVENTURER ? others(tile) > 0 : (monsters[tile] as number) > 0;
  // Someone else stands on it, or is already walking to it, so two do not make for one tile.
  const taken = (tile: number): boolean =>
    others(tile) > 0 || (ending[tile] as number) - (tile === ownEnd ? 1 : 0) > 0;
  // Where someone else has stopped on this tile too, the one deciding walk_to moves
  // off. The one that arrived later often decides again as soon as its walk ends,
  // while the other is still resting, so it is usually the later one that makes way.
  // Someone only passing through does not count.
  const sharing =
    firstAt(
      grid,
      actor.x,
      actor.y,
      (other) => other !== actor && other.path.length === 0 && other.moveTicksLeft === 0,
    ) !== undefined;
  const free = (tile: number): boolean => (tile === start ? !sharing : !taken(tile));
  // Everywhere this actor can walk to without stepping on anyone, and the tile
  // each was first reached from. The search runs only as far as it needs to,
  // until it reaches the tile asked about or has been everywhere it can. A
  // tile keeps the step it was first reached from, so the way to any tile is
  // the same however far the search has run.
  const within = actor.kind !== ADVENTURER;
  inReach[start] = stamp;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  const reached = (tile: number): boolean => {
    for (; head < tail && inReach[tile] !== stamp; head++) {
      const at = queue[head] as number;
      for (let d = 0; d < 4; d++) {
        const next = stepTile(atlas, at, d, within);
        if (next < 0 || inReach[next] === stamp || barred(next)) continue;
        inReach[next] = stamp;
        cameFrom[next] = at;
        queue[tail++] = next;
      }
    }
    return inReach[tile] === stamp;
  };
  // The reachable tile nearest `to`, by walking and ignoring people, ring by
  // ring outwards from it; in a ring, staying put comes first, then the ring's
  // order.
  let goal = -1;
  let ring = [tileAt(atlas, to.x, to.y)];
  seen[ring[0] as number] = stamp;
  while (ring.length > 0) {
    if (ring.includes(start) && free(start)) {
      goal = start;
      break;
    }
    goal = ring.find((tile) => free(tile) && reached(tile)) ?? -1;
    if (goal >= 0) break;
    const next: number[] = [];
    for (const at of ring) {
      for (let d = 0; d < 4; d++) {
        const tile = stepTile(atlas, at, d, false);
        if (tile < 0 || seen[tile] === stamp) continue;
        seen[tile] = stamp;
        next.push(tile);
      }
    }
    ring = next;
  }
  if (goal < 0 || goal === start) return [];
  const path: Point[] = [];
  for (let at = goal; at !== start; at = cameFrom[at] as number) path.push(pointOf(atlas, at));
  return path.reverse();
}

/**
 * A tile `actor` can stand on in the region it is in, chosen at random with the
 * world's generator. Wandering is a stroll about where one is; going to another
 * region is something a program decides to do.
 */
function randomWalkableTile(world: World, actor: Actor): Point {
  const index = regionAt(world.atlas, actor.x, actor.y);
  const region = world.atlas.regions[index];
  if (!region) return actor;
  const tiles = groundOf(world.atlas)[index] as Point[];
  return tiles[nextInt(world.rng, tiles.length)] as Point;
}

const grounds = new WeakMap<Atlas, Point[][]>();

/**
 * Per region, every tile in it anyone may stand on (see walkableFor), row by
 * row. Worked out once per atlas, as it never changes.
 */
function groundOf(atlas: Atlas): Point[][] {
  let ground = grounds.get(atlas);
  if (!ground) {
    ground = atlas.regions.map((region) => {
      const tiles: Point[] = [];
      for (let y = region.y; y < region.y + region.map.height; y++) {
        for (let x = region.x; x < region.x + region.map.width; x++)
          if (walkable(atlas, x, y)) tiles.push({ x, y });
      }
      return tiles;
    });
    grounds.set(atlas, ground);
  }
  return ground;
}

/**
 * Answers sensor `id` for `actor`. `foe` gives the nearest enemy (see
 * `threat`), and `node` the nearest tile to work a node of a kind from (see
 * `nearestNode`).
 */
function sense(
  world: World,
  actor: Actor,
  foe: () => Actor | undefined,
  node: (kind: number) => Point | null,
  id: number,
  args: readonly number[],
): number {
  const [a = 0, b = 0] = args;
  const name = syscall(id)?.name;
  switch (name) {
    case "self_x":
      return actor.x;
    case "self_y":
      return actor.y;
    case "hour":
      return clock(world).hour;
    case "minute":
      return clock(world).minute;
    case "walkable":
      return walkable(world.atlas, a, b) ? 1 : 0;
    case "distance":
      // Kept in 64-bit floats until the end, so far-apart coordinates cannot wrap.
      return Math.min(0x7fffffff, Math.abs(a - actor.x) + Math.abs(b - actor.y));
    case "hp":
      return actor.hp;
    case "max_hp":
      return kindOf(world, actor).hp;
    case "threat_x":
      return (foe() ?? actor).x;
    case "threat_y":
      return (foe() ?? actor).y;
    case "threat_distance": {
      const enemy = foe();
      return enemy ? steps(actor, enemy) : NO_THREAT;
    }
    case "threat_hp":
      return foe()?.hp ?? 0;
    case "threat_recovering": {
      // What the enemy has left once this tick is over. One that comes later in
      // the update order has not counted this tick off yet, so it is counted here.
      const enemy = foe();
      if (!enemy) return 0;
      const { order } = gridOf(world);
      const counted = (order.get(enemy) as number) < (order.get(actor) as number);
      return counted ? enemy.recover : Math.max(0, enemy.recover - 1);
    }
    case "danger":
      return danger(world, actor, a, b);
    case "danger_here":
      return danger(world, actor, actor.x, actor.y);
    case "stalled":
      return actor.stalled;
    case "level":
    case "xp": {
      // A skill is named by its position in SKILLS; a monster has none.
      const xp = actor.kind === ADVENTURER && a >= 0 && a < SKILLS.length ? actor.xp[a] : undefined;
      if (xp === undefined) return 0;
      return name === "level" ? levelFor(xp) : xp;
    }
    case "bag_free":
      return freeSlots(actor);
    case "carrying":
      return carrying(actor, a);
    case "banked":
      return banked(actor, a);
    case "at_bank":
      return atBank(world, actor) ? 1 : 0;
    case "node_distance": {
      const side = node(a);
      return side ? steps(actor, side) : NO_NODE;
    }
    case "node_x":
      return (node(a) ?? actor).x;
    case "node_y":
      return (node(a) ?? actor).y;
    case "at_fire":
      return atFire(world, actor) ? 1 : 0;
    case "threat_friends": {
      const enemy = foe();
      return enemy ? friendsWithin(world, enemy, FRIENDS_REACH) : 0;
    }
    case "friends_near":
      return friendsWithin(world, actor, a);
    case "lit_here":
      return inFirelight(world, actor.x, actor.y) ? 1 : 0;
    case "threat_lit": {
      const enemy = foe();
      return enemy && inFirelight(world, enemy.x, enemy.y) ? 1 : 0;
    }
    case "threat_moving": {
      const enemy = foe();
      return enemy && (enemy.moveTicksLeft > 0 || enemy.path.length > 0) ? 1 : 0;
    }
    case "lit_enemies":
    case "lit_mending": {
      // Enemies who can fight, or residents who can't yet.
      const down = name === "lit_mending";
      // The firelight is within LIGHT_REACH of camp in a straight line, so
      // within twice that in steps.
      const camp = place(world.atlas, "camp");
      return countWithin(
        gridOf(world),
        camp.x,
        camp.y,
        2 * LIGHT_REACH,
        world.atlas.regions[regionAt(world.atlas, camp.x, camp.y)] as Region,
        (other) =>
          (down ? mending(other) : enemies(actor, other) && !mending(other)) &&
          sameRegion(world, actor, other) &&
          inFirelight(world, other.x, other.y),
      );
    }
    default:
      return 0;
  }
}

function act(
  world: World,
  actor: Actor,
  id: number,
  args: readonly number[],
  events: WorldEvent[],
): void {
  // Every decision starts a fresh walk, which may be re-routed once.
  actor.blocked = 0;
  const [a = 0, b = 0] = args;
  const name = syscall(id)?.name ?? "";
  // Counts up while the program keeps choosing to move and getting nowhere.
  const stalled = actor.stalled;
  actor.stalled = 0;
  switch (name) {
    case "wait":
      actor.wait = Math.max(IDLE_TICKS, Math.min(MAX_WAIT_ACTION_TICKS, a));
      return;
    case "walk_to":
      setPath(world, actor, wayTo(world, actor, { x: a, y: b }));
      break;
    case "wander": {
      const to = randomWalkableTile(world, actor);
      setPath(world, actor, findPath(world.atlas, actor, to, actor.kind !== ADVENTURER) ?? []);
      break;
    }
    case "attack": {
      const tiles = attackTiles(world, actor, a, b);
      if (tiles.length === 0) break;
      actor.windup = kindOf(world, actor).windup;
      for (const tile of tiles) addMark(world, { x: tile.x, y: tile.y, by: actor.id });
      events.push({
        type: "attack",
        tick: world.tick,
        actor: actor.id,
        tiles,
        lands: actor.windup,
      });
      return;
    }
    case "step_clear":
      setPath(world, actor, wayClear(world, actor));
      break;
    case "flee":
      setPath(world, actor, wayFrom(world, actor, { x: a, y: b }));
      break;
    case "step_to":
      // The first step of the way walk_to would take.
      setPath(world, actor, wayTo(world, actor, { x: a, y: b }).slice(0, 1));
      break;
    case "deposit":
    case "withdraw": {
      const moved = (name === "deposit" ? deposit : withdraw)(world, actor, a, b);
      if (moved > 0)
        events.push({
          type: name,
          tick: world.tick,
          actor: actor.id,
          good: GOODS[a - 1] as string,
          count: moved,
        });
      break;
    }
    case "bank_all":
      for (let id = 1; id <= GOODS.length; id++) {
        const moved = deposit(world, actor, id, BAG_SLOTS);
        if (moved > 0)
          events.push({
            type: "deposit",
            tick: world.tick,
            actor: actor.id,
            good: GOODS[id - 1] as string,
            count: moved,
          });
      }
      break;
    case "chop":
    case "fish":
      // A try takes a moment, whatever it gives; with no node beside it or no room, it is a pause.
      if (work(world, actor, name === "chop" ? "woodcutting" : "fishing", events)) {
        actor.wait = GATHER_TICKS;
        return;
      }
      break;
    case "cook":
      if (cook(world, actor, events)) {
        actor.wait = COOK_TICKS;
        return;
      }
      break;
    case "eat":
      // Quick enough to do between blows: the same short pause as any action that ends at once.
      eat(world, actor, events);
      break;
    default:
      // `idle`, and any action this build does not know.
      break;
  }
  // An action that leaves nothing to do costs a short pause. Together with the
  // floor on `wait`, this means a standing actor decides at most once every
  // IDLE_TICKS ticks, however its program is written.
  if (actor.path.length === 0) actor.wait = IDLE_TICKS;
  if (actor.path.length === 0 && MOVES.has(name))
    actor.stalled = Math.min(MAX_STALLED, stalled + 1);
}

/** The actions that walk somewhere, which `stalled` counts when they find nowhere to go. */
const MOVES = new Set(["walk_to", "wander", "step_clear", "flee", "step_to"]);
