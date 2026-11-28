// Where a program meets the world: answers its sensors and carries out the one
// action it commits. Called when an actor has nothing left to do.

import { type Atlas, pointOf, stepTile, tileAt, walkable } from "./atlas.ts";
import { atBank, BAG_SLOTS, banked, carrying, deposit, freeSlots, GOODS, withdraw } from "./bag.ts";
import { PER_TILE } from "./deck.ts";
import { type Field, fieldTo, nthTile, partOf, stepsTo, workOf } from "./field.ts";
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
  allAt,
  countWithin,
  gridOf,
  marksOn,
  nearest,
  onGround,
  setPath,
  tallyOf,
  tileOf,
} from "./grid.ts";
import { NEIGHBOURS, type Point } from "./map.ts";
import { FLAG_NONE, flagDown, flagPlace, HEARD_MOST, heedOf, liftEta, wayHome } from "./orders.ts";
import { denNear, NO_PACK, packNear } from "./packs.ts";
import { findPath, scratchFor } from "./path.ts";
import { nextInt } from "./rng.ts";
import { levelFor, SKILLS } from "./skills.ts";
import { syscall } from "./syscalls.ts";
import { FAULTS, type Program, runDecision } from "./vm.ts";
import { directionTo, drinkOf } from "./weapons.ts";
import {
  type Actor,
  ADVENTURER,
  blockerAt,
  blowTiles,
  blowTimesOf,
  canStep,
  enemies,
  kindOf,
  mending,
  reachOf,
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
  // The packs and dens `pack_*` and `den_*` find, by their argument, looked for once each.
  const packs = new Map<number, Actor | undefined>();
  const dens = new Map<number, Point | undefined>();
  const near: Near = {
    pack: (n) => {
      if (!packs.has(n)) packs.set(n, packNear(world, actor, n));
      return packs.get(n);
    },
    den: (n) => {
      if (!dens.has(n)) dens.set(n, denNear(world, actor, n));
      return dens.get(n);
    },
  };
  const decision = runDecision(
    program,
    actor.memory,
    (id, args) => sense(world, actor, foe, node, near, id, args),
    actor.params,
  );
  actor.rule = decision.rule;
  actor.heed = heedOf(program, actor, decision.rule);
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
 * The nearest enemy, the one with the lowest id if several are as near. A
 * citizen mending after a down is nobody's enemy.
 */
function threat(world: World, actor: Actor): Actor | undefined {
  const grid = gridOf(world);
  // A citizen's enemies are monsters, and a monster's citizens.
  if (onGround(grid, actor.kind === ADVENTURER) === 0) return undefined;
  return nearest(
    grid,
    actor.x,
    actor.y,
    world.atlas,
    (other) => enemies(actor, other) && !mending(other),
  );
}

/** How near, in steps, someone stands to count as one of the nearest enemy's friends for `threat_friends`. */
export const FRIENDS_REACH = 4;

/**
 * How many of `actor`'s own kind, itself and anyone mending left out, stand
 * within `reach` steps of it. A reach below 0 finds nobody.
 */
const friendsWithin = (world: World, actor: Actor, reach: number): number =>
  countWithin(
    gridOf(world),
    actor.x,
    actor.y,
    reach,
    world.atlas,
    (other) => other !== actor && other.kind === actor.kind && !mending(other),
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

/**
 * The way an attack towards (x, y) faces, as an index into DIRECTIONS, or -1
 * at the actor's own tile. An adventurer turns to the nearest of the eight
 * directions; a monster to the nearer of up, down, left and right.
 */
function aimAt(actor: Actor, x: number, y: number): number {
  const dx = x - actor.x;
  const dy = y - actor.y;
  if (dx === 0 && dy === 0) return -1;
  if (actor.weapon !== "") return directionTo(dx, dy);
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 4) : dy > 0 ? 2 : 6;
}

/**
 * The way to `to`, going round anyone who gets in the way (adventurers walk
 * through each other; monsters do not). If someone already stands on `to`, or
 * is walking there, it leads instead to the nearest tile (by walking, ignoring
 * people) that nobody stands on or is walking to and that this actor could
 * walk to if nobody were about; among tiles as near as each other, staying
 * where it is comes first. So people sent to one place gather round it and
 * settle instead of piling onto one tile. [] when there is nowhere nearer to go.
 *
 * The way round people is the shortest, if it is at most DETOUR_STEPS longer
 * than going by way of `to`. If people block every such way, it leads as near
 * the goal as a way that long gets this actor (see searchRound), so someone
 * held up at a crowd waits at its edge instead of setting off the long way
 * round. With `round` the way round is the shortest however long, if any
 * gets there. walk_to and step_to ask for that once the last move got
 * nowhere, so people who stand still in the way hold an actor up for one
 * pause and no longer.
 *
 * With `step`, the start of the way only, for step_to: its first step, or,
 * on a way round more than DETOUR_STEPS too long, its steps up to the first
 * tile from which the rest of it is not. From there the next step_to finds
 * the rest without `round`; taken one step at a time, the next would lead
 * back to the crowd's edge instead.
 *
 * Everyone sent to `to` reads one distance field (see field.ts), so a crowd
 * going one way is searched once, and each actor's own search looks at
 * little more than its way.
 */
export function wayTo(world: World, actor: Actor, to: Point, round = false, step = false): Point[] {
  const { atlas } = world;
  if (!walkable(atlas, to.x, to.y)) return [];
  const start = tileAt(atlas, actor.x, actor.y);
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
  // A tile takes one, but a deck tile berths PER_TILE citizens (deck.ts).
  const room = (tile: number): number =>
    actor.kind === ADVENTURER && atlas.floor[tile] === 1 ? PER_TILE : 1;
  // Others stand on it or are already walking to it, as many as it has room for.
  const taken = (tile: number): boolean =>
    others(tile) + (ending[tile] as number) - (tile === ownEnd ? 1 : 0) >= room(tile);
  // Where as many others as it has room for have stopped on this tile too, the
  // one deciding walk_to moves off. The one that arrived later often decides
  // again as soon as its walk ends, while the other is still resting, so it is
  // usually the later one that makes way. Someone only passing through does
  // not count.
  const sharing =
    allAt(
      grid,
      actor.x,
      actor.y,
      (other) => other !== actor && other.path.length === 0 && other.moveTicksLeft === 0,
    ).length >= room(start);
  const free = (tile: number): boolean => (tile === start ? !sharing : !taken(tile));
  const field = fieldTo(world, tileAt(atlas, to.x, to.y));
  const away = stepsTo(world, field, start);
  if (away < 0) return [];
  // The free tile nearest `to` that this actor could walk to if nobody were
  // about, ring by ring outwards from `to`; in a ring, staying put comes
  // first, then the ring's order. A citizen sent to a deck tile goes to the
  // nearest deck tile with room, however far round the deck that is: aboard
  // is what counts, and the ground beside the hull is not aboard.
  const part = partOf(atlas, start);
  const target = tileAt(atlas, to.x, to.y);
  const deck = actor.kind === ADVENTURER && atlas.floor[target] === 1;
  const fits = (tile: number): boolean => !deck || atlas.floor[tile] === 1;
  const work = workOf(world);
  let goal = -1;
  let ring = -1;
  for (let i = 0; goal < 0; i++) {
    const tile = nthTile(world, field, i);
    if (tile < 0) return [];
    work.searchTiles++;
    const steps = field.steps[tile] as number;
    if (steps !== ring) {
      ring = steps;
      if (ring === away && free(start) && fits(start)) goal = start;
    }
    if (goal < 0 && free(tile) && fits(tile) && partOf(atlas, tile) === part) goal = tile;
  }
  if (goal === start) return [];
  const rung = field.steps[goal] as number;
  const most = away + rung + DETOUR_STEPS;
  // No way past people is longer than there are tiles. Where a way within
  // the cap gets to the goal, the search with no cap finds the same one.
  const way =
    (round ? searchRound(world, field, start, goal, atlas.open.length, barred, true) : null) ??
    (searchRound(world, field, start, goal, most, barred, false) as Point[]);
  if (!step || way.length === 0) return way;
  let steps = 1;
  for (; steps < way.length; steps++) {
    const at = way[steps - 1] as Point;
    const left = way.length - steps;
    if (left <= stepsTo(world, field, tileAt(atlas, at.x, at.y)) + rung + DETOUR_STEPS) break;
  }
  return way.slice(0, steps);
}

/** How many steps longer than the way by `to` itself a way round people may be. */
export const DETOUR_STEPS = 8;

// The search's queues, by how long the way through a tile might be, kept between searches.
const buckets: number[][] = [];

/**
 * The shortest way from box tile `start` to `goal` that steps on nobody
 * `barred` names and is at most `most` steps long. If there is none, the
 * shortest way to the tile the search got to that looks nearest `goal`, which
 * may be `start` itself, giving [].
 *
 * With `sure`, null instead when no way gets to `goal`. To find that out
 * without looking at every tile `start` can get to, a second search walks out
 * from `goal` over the tiles nobody bars, a tile for each tile the first
 * takes, until the two meet. If it runs out of tiles first, `goal` is shut in.
 *
 * It is an A* search guided by `field`: a tile `s` steps from `to`, when
 * `goal` is `rung` steps from it, is at least |s - rung| steps from `goal`,
 * and at least as many as in a straight grid line. Among tiles as promising
 * as each other it takes the one it found last, and it tries the neighbours
 * of a tile in NEIGHBOURS order, so with nobody in the way it goes straight
 * down the field and looks at little else.
 */
function searchRound(
  world: World,
  field: Field,
  start: number,
  goal: number,
  most: number,
  barred: (tile: number) => boolean,
  sure: boolean,
): Point[] | null {
  const { atlas } = world;
  const { stamp, reached: done, from: cameFrom, seen, cost, back, queue: out } = scratchFor(atlas);
  const work = workOf(world);
  const rung = field.steps[goal] as number;
  const gx = goal % atlas.width;
  const gy = (goal - gx) / atlas.width;
  const guess = (tile: number): number => {
    const x = tile % atlas.width;
    const line = Math.abs(x - gx) + Math.abs((tile - x) / atlas.width - gy);
    return Math.max(line, Math.abs(stepsTo(world, field, tile) - rung));
  };
  const least = guess(start);
  // Queues up to `top` have been emptied for this search, and nothing is queued past it.
  let top = -1;
  const queue = (through: number, tile: number): void => {
    for (; top < through - least; top++) {
      const bucket = buckets[top + 1];
      if (bucket) bucket.length = 0;
      else buckets[top + 1] = [];
    }
    (buckets[through - least] as number[]).push(tile);
  };
  seen[start] = stamp;
  cost[start] = 0;
  queue(least, start);
  let best = start;
  let bestGuess = least;
  // The walk out from `goal`: tiles out[head..tail) are still to be looked
  // round. `meeting` while it has not yet met the search from `start`.
  let meeting = sure;
  let head = 0;
  let tail = 0;
  if (sure) {
    back[goal] = stamp;
    out[tail++] = goal;
  }
  search: for (let f = least; f <= least + top; f++) {
    const bucket = buckets[f - least] as number[];
    while (bucket.length > 0) {
      const at = bucket.pop() as number;
      if (done[at] === stamp) continue;
      done[at] = stamp;
      work.searchTiles++;
      if (meeting && back[at] === stamp) meeting = false;
      if (meeting) {
        if (head === tail) return null;
        const from = out[head++] as number;
        work.searchTiles++;
        for (let d = 0; d < 4; d++) {
          const next = stepTile(atlas, from, d);
          if (next < 0 || back[next] === stamp) continue;
          if (seen[next] === stamp) {
            meeting = false;
            break;
          }
          if (barred(next)) continue;
          back[next] = stamp;
          out[tail++] = next;
        }
      }
      const left = at === goal ? 0 : guess(at);
      if (left < bestGuess) {
        best = at;
        bestGuess = left;
      }
      if (at === goal) break search;
      const steps = (cost[at] as number) + 1;
      // Pushed last, popped first: the first of NEIGHBOURS is tried first.
      for (let d = 3; d >= 0; d--) {
        const next = stepTile(atlas, at, d);
        if (next < 0 || done[next] === stamp || barred(next)) continue;
        if (seen[next] === stamp && (cost[next] as number) <= steps) continue;
        const through = steps + guess(next);
        if (through > most) continue;
        seen[next] = stamp;
        cost[next] = steps;
        cameFrom[next] = at;
        queue(through, next);
      }
    }
  }
  if (sure && best !== goal) return null;
  const path: Point[] = [];
  for (let at = best; at !== start; at = cameFrom[at] as number) path.push(pointOf(atlas, at));
  return path.reverse();
}

/** A tile of the ground `actor` can stand on, chosen at random with the world's generator. */
function randomWalkableTile(world: World, actor: Actor): Point {
  const tiles = standable(world.atlas);
  return tiles.length === 0 ? actor : (tiles[nextInt(world.rng, tiles.length)] as Point);
}

const grounds = new WeakMap<Atlas, Point[]>();

/**
 * Every tile anyone may stand on (see walkableFor), row by row. Worked out
 * once per atlas, as it never changes.
 */
function standable(atlas: Atlas): Point[] {
  let ground = grounds.get(atlas);
  if (!ground) {
    ground = [];
    for (let y = atlas.top; y < atlas.top + atlas.height; y++)
      for (let x = atlas.left; x < atlas.left + atlas.width; x++)
        if (walkable(atlas, x, y)) ground.push({ x, y });
    grounds.set(atlas, ground);
  }
  return ground;
}

/** The nearest laid monster and den in a level range, as `pack_*(n)` and `den_*(n)` read them (packs.ts). */
interface Near {
  readonly pack: (n: number) => Actor | undefined;
  readonly den: (n: number) => Point | undefined;
}

/**
 * Answers sensor `id` for `actor`. `foe` gives the nearest enemy (see
 * `threat`), `node` the nearest tile to work a node of a kind from (see
 * `nearestNode`), and `near` the packs and dens.
 */
function sense(
  world: World,
  actor: Actor,
  foe: () => Actor | undefined,
  node: (kind: number) => Point | null,
  near: Near,
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
    case "threat_moving": {
      const enemy = foe();
      return enemy && (enemy.moveTicksLeft > 0 || enemy.path.length > 0) ? 1 : 0;
    }
    case "weapon_reach":
      return reachOf(world, actor);
    case "flask":
      return actor.flask;
    case "flagged":
      return flagPlace(world, actor) ? actor.flag : FLAG_NONE;
    case "flag_x":
      return (flagPlace(world, actor) ?? actor).x;
    case "flag_y":
      return (flagPlace(world, actor) ?? actor).y;
    case "flag_age":
      return actor.flag === FLAG_NONE ? 0 : Math.min(0x7fffffff, world.tick - actor.flagAt);
    case "flag_down":
      return flagDown(world, actor) ? 1 : 0;
    case "heard":
      return Math.min(HEARD_MOST, world.tick - actor.heard);
    case "lift_eta":
      return liftEta(world);
    case "way_home":
      return wayHome(world, actor);
    case "pack_distance": {
      const pack = near.pack(a);
      return pack ? steps(actor, pack) : NO_PACK;
    }
    case "pack_x":
      return (near.pack(a) ?? actor).x;
    case "pack_y":
      return (near.pack(a) ?? actor).y;
    case "den_distance": {
      const den = near.den(a);
      return den ? steps(actor, den) : NO_PACK;
    }
    case "den_x":
      return (near.den(a) ?? actor).x;
    case "den_y":
      return (near.den(a) ?? actor).y;
    default:
      return 0;
  }
}

/**
 * Drinks from the flask: a drink gives back DRINK_SHARE of the most
 * hitpoints the actor can have, up to that most. At full hitpoints, or with
 * an empty flask, nothing happens and the drink is kept.
 */
function drink(world: World, actor: Actor, events: WorldEvent[]): void {
  const most = kindOf(world, actor).hp;
  if (actor.flask <= 0 || actor.hp >= most) return;
  actor.flask--;
  actor.hp = Math.min(most, actor.hp + drinkOf(most));
  events.push({
    type: "drink",
    tick: world.tick,
    actor: actor.id,
    hp: actor.hp,
    flask: actor.flask,
  });
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
  // One that got nowhere last time goes round whoever is in the way, however far.
  const round = stalled > 0;
  switch (name) {
    case "wait":
      actor.wait = Math.max(IDLE_TICKS, Math.min(MAX_WAIT_ACTION_TICKS, a));
      return;
    case "walk_to":
      setPath(world, actor, wayTo(world, actor, { x: a, y: b }, round));
      break;
    case "wander": {
      const to = randomWalkableTile(world, actor);
      setPath(world, actor, findPath(world.atlas, actor, to) ?? []);
      break;
    }
    case "attack":
      if (attackAt(world, actor, a, b, events)) return;
      break;
    case "step_clear":
      setPath(world, actor, wayClear(world, actor));
      break;
    case "flee":
      setPath(world, actor, wayFrom(world, actor, { x: a, y: b }));
      break;
    case "step_to":
      // The first step of the way walk_to would take, or more of a long way round.
      setPath(world, actor, wayTo(world, actor, { x: a, y: b }, round, true));
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
    case "drink":
      drink(world, actor, events);
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

/**
 * Begins a blow towards (x, y): turns to it, marks the tiles it will land on
 * and winds up. False, and nothing done, if the blow would land on no tile.
 */
export function attackAt(
  world: World,
  actor: Actor,
  x: number,
  y: number,
  events: WorldEvent[],
): boolean {
  const aim = aimAt(actor, x, y);
  const tiles = aim < 0 ? [] : blowTiles(world, actor, aim);
  if (tiles.length === 0) return false;
  actor.aim = aim;
  actor.windup = blowTimesOf(world, actor).windup;
  for (const tile of tiles) addMark(world, { x: tile.x, y: tile.y, by: actor.id });
  events.push({ type: "attack", tick: world.tick, actor: actor.id, tiles, lands: actor.windup });
  return true;
}

/** The actions that walk somewhere, which `stalled` counts when they find nowhere to go. */
const MOVES = new Set(["walk_to", "wander", "step_clear", "flee", "step_to"]);
