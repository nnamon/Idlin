// Where a program meets the world: answers its sensors and carries out the one
// action it commits. Called when an actor has nothing left to do.

import { atBank, BAG_SLOTS, banked, carrying, deposit, freeSlots, GOODS, withdraw } from "./bag.ts";
import { isWalkable, NEIGHBOURS, type Point, tileIndex } from "./map.ts";
import { findPath } from "./path.ts";
import { nextInt } from "./rng.ts";
import { levelFor, SKILLS } from "./skills.ts";
import { syscall } from "./syscalls.ts";
import { FAULTS, type Program, runDecision } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  blockerAt,
  blocks,
  clock,
  enemies,
  kindOf,
  lineOfAttack,
  type World,
  type WorldEvent,
  walkableFor,
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
  const decision = runDecision(program, actor.memory, (id, args) => sense(world, actor, id, args));
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

/** The nearest enemy, the one with the lowest id if several are as near. */
function threat(world: World, actor: Actor): Actor | undefined {
  let nearest: Actor | undefined;
  for (const other of world.actors) {
    if (!enemies(actor, other)) continue;
    if (!nearest || steps(actor, other) < steps(actor, nearest)) nearest = other;
  }
  return nearest;
}

/** Ticks until an enemy's attack lands on a tile, or 0 if none is coming. */
function danger(world: World, actor: Actor, x: number, y: number): number {
  let soonest = 0;
  for (const mark of world.marks) {
    if (mark.x !== x || mark.y !== y) continue;
    const attacker = world.actors.find((a) => a.id === mark.by);
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
  const { map } = world;
  const start = tileIndex(map, actor.x, actor.y);
  const cameFrom = new Map<number, number>([[start, start]]);
  const queue: Point[] = [{ x: actor.x, y: actor.y }];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    if (danger(world, actor, at.x, at.y) === 0) {
      const path: Point[] = [];
      for (let k = tileIndex(map, at.x, at.y); k !== start; k = cameFrom.get(k) as number) {
        const x = k % map.width;
        path.push({ x, y: (k - x) / map.width });
      }
      return path.reverse();
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!walkableFor(world, actor, x, y) || blockerAt(world, x, y, actor)) continue;
      const index = tileIndex(map, x, y);
      if (cameFrom.has(index)) continue;
      cameFrom.set(index, tileIndex(map, at.x, at.y));
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
  const { map } = world;
  const start = tileIndex(map, actor.x, actor.y);
  const cameFrom = new Map<number, number>([[start, start]]);
  let frontier: Point[] = [{ x: actor.x, y: actor.y }];
  let best: Point = frontier[0] as Point;
  for (let depth = 0; depth < FLEE_SIGHT && frontier.length > 0; depth++) {
    const next: Point[] = [];
    for (const at of frontier) {
      for (const [dx, dy] of NEIGHBOURS) {
        const tile = { x: at.x + dx, y: at.y + dy };
        if (!walkableFor(world, actor, tile.x, tile.y) || blockerAt(world, tile.x, tile.y, actor))
          continue;
        const index = tileIndex(map, tile.x, tile.y);
        if (cameFrom.has(index)) continue;
        cameFrom.set(index, tileIndex(map, at.x, at.y));
        next.push(tile);
        if (steps(tile, from) > steps(best, from)) best = tile;
      }
    }
    frontier = next;
  }
  const path: Point[] = [];
  for (let at = tileIndex(map, best.x, best.y); at !== start; at = cameFrom.get(at) as number) {
    const x = at % map.width;
    path.push({ x, y: (at - x) / map.width });
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
  const { map } = world;
  if (!isWalkable(map, to.x, to.y)) return [];
  // Everywhere this actor can walk to without stepping on anyone, and how. The
  // search stops as soon as it reaches the goal, if the goal is free.
  const start = tileIndex(map, actor.x, actor.y);
  const target = tileIndex(map, to.x, to.y);
  // Tiles that bar the way, and tiles someone already stands on or is making for.
  const barred = new Set<number>();
  const standing = new Set<number>();
  for (const other of world.actors) {
    if (other === actor) continue;
    standing.add(tileIndex(map, other.x, other.y));
    // Where someone is already walking to counts as taken too, so two do not make for one tile.
    const end = other.path[other.path.length - 1];
    if (end) standing.add(tileIndex(map, end.x, end.y));
    if (blocks(other, actor)) barred.add(tileIndex(map, other.x, other.y));
  }
  // Where someone else has stopped on this tile too, the one deciding walk_to moves
  // off. The one that arrived later often decides again as soon as its walk ends,
  // while the other is still resting, so it is usually the later one that makes way.
  // Someone only passing through does not count.
  const sharing = world.actors.some(
    (other) =>
      other !== actor &&
      other.x === actor.x &&
      other.y === actor.y &&
      other.path.length === 0 &&
      other.moveTicksLeft === 0,
  );
  const free = (index: number): boolean => (index === start ? !sharing : !standing.has(index));
  const cameFrom = new Map<number, number>([[start, start]]);
  const queue: Point[] = [{ x: actor.x, y: actor.y }];
  for (let head = 0; head < queue.length && !(cameFrom.has(target) && free(target)); head++) {
    const at = queue[head] as Point;
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!walkableFor(world, actor, x, y)) continue;
      const index = tileIndex(map, x, y);
      if (cameFrom.has(index) || barred.has(index)) continue;
      cameFrom.set(index, tileIndex(map, at.x, at.y));
      queue.push({ x, y });
    }
  }
  // The reachable tile nearest `to`, ring by ring outwards from it.
  let goal: number | undefined;
  const seen = new Set<number>([tileIndex(map, to.x, to.y)]);
  let ring: Point[] = [to];
  while (ring.length > 0 && goal === undefined) {
    for (const at of ring) {
      const index = tileIndex(map, at.x, at.y);
      if (index === start && free(index)) {
        goal = index;
        break;
      }
      if (goal === undefined && cameFrom.has(index) && free(index)) goal = index;
    }
    if (goal !== undefined) break;
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
  if (goal === undefined || goal === start) return [];
  const path: Point[] = [];
  for (let at = goal; at !== start; at = cameFrom.get(at) as number) {
    const x = at % map.width;
    path.push({ x, y: (at - x) / map.width });
  }
  return path.reverse();
}

/** A tile `actor` can stand on, chosen at random with the world's generator. */
function randomWalkableTile(world: World, actor: Actor): Point {
  const { map } = world;
  const walkable: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++)
      if (walkableFor(world, actor, x, y)) walkable.push({ x, y });
  }
  return walkable[nextInt(world.rng, walkable.length)] as Point;
}

function sense(world: World, actor: Actor, id: number, args: readonly number[]): number {
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
      return isWalkable(world.map, a, b) ? 1 : 0;
    case "distance":
      // Kept in 64-bit floats until the end, so far-apart coordinates cannot wrap.
      return Math.min(0x7fffffff, Math.abs(a - actor.x) + Math.abs(b - actor.y));
    case "hp":
      return actor.hp;
    case "max_hp":
      return kindOf(world, actor).hp;
    case "threat_x":
      return (threat(world, actor) ?? actor).x;
    case "threat_y":
      return (threat(world, actor) ?? actor).y;
    case "threat_distance": {
      const enemy = threat(world, actor);
      return enemy ? steps(actor, enemy) : NO_THREAT;
    }
    case "threat_hp":
      return threat(world, actor)?.hp ?? 0;
    case "threat_recovering": {
      // What the enemy has left once this tick is over. One that comes later in
      // the update order has not counted this tick off yet, so it is counted here.
      const enemy = threat(world, actor);
      if (!enemy) return 0;
      const counted = world.actors.indexOf(enemy) < world.actors.indexOf(actor);
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
      actor.path = wayTo(world, actor, { x: a, y: b });
      break;
    case "wander":
      actor.path =
        findPath(world.map, actor, randomWalkableTile(world, actor), (x, y) =>
          walkableFor(world, actor, x, y),
        ) ?? [];
      break;
    case "attack": {
      const tiles = attackTiles(world, actor, a, b);
      if (tiles.length === 0) break;
      actor.windup = kindOf(world, actor).windup;
      for (const tile of tiles) world.marks.push({ x: tile.x, y: tile.y, by: actor.id });
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
      actor.path = wayClear(world, actor);
      break;
    case "flee":
      actor.path = wayFrom(world, actor, { x: a, y: b });
      break;
    case "step_to":
      // The first step of the way walk_to would take.
      actor.path = wayTo(world, actor, { x: a, y: b }).slice(0, 1);
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
