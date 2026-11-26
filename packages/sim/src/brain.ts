// Where a program meets the world: answers its sensors and carries out the one
// action it commits. Called when an actor has nothing left to do.

import { isWalkable, NEIGHBOURS, type Point, tileIndex } from "./map.ts";
import { findPath } from "./path.ts";
import { nextInt } from "./rng.ts";
import { syscall } from "./syscalls.ts";
import { FAULTS, type Program, runDecision } from "./vm.ts";
import {
  type Actor,
  actorAt,
  clock,
  enemies,
  kindOf,
  lineOfAttack,
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

/** The way to the nearest tile that is free of other actors and of danger, or [] if this one already is. */
function wayClear(world: World, actor: Actor): Point[] {
  const { map } = world;
  const seen = new Set<number>([tileIndex(map, actor.x, actor.y)]);
  const queue: Point[] = [{ x: actor.x, y: actor.y }];
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head] as Point;
    const there = actorAt(world, at.x, at.y);
    if ((!there || there === actor) && danger(world, actor, at.x, at.y) === 0) {
      return findPath(map, actor, at) ?? [];
    }
    for (const [dx, dy] of NEIGHBOURS) {
      const x = at.x + dx;
      const y = at.y + dy;
      if (!isWalkable(map, x, y) || seen.has(tileIndex(map, x, y))) continue;
      seen.add(tileIndex(map, x, y));
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
        if (!isWalkable(map, tile.x, tile.y) || actorAt(world, tile.x, tile.y)) continue;
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

/** A walkable tile chosen at random with the world's generator. */
function randomWalkableTile(world: World): Point {
  const { map } = world;
  const walkable: Point[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (isWalkable(map, x, y)) walkable.push({ x, y });
  }
  return walkable[nextInt(world.rng, walkable.length)] as Point;
}

function sense(world: World, actor: Actor, id: number, args: readonly number[]): number {
  const [a = 0, b = 0] = args;
  switch (syscall(id)?.name) {
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
    case "danger":
      return danger(world, actor, a, b);
    case "danger_here":
      return danger(world, actor, actor.x, actor.y);
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
  const [a = 0, b = 0] = args;
  switch (syscall(id)?.name) {
    case "wait":
      actor.wait = Math.max(IDLE_TICKS, Math.min(MAX_WAIT_ACTION_TICKS, a));
      return;
    case "walk_to":
      actor.path = findPath(world.map, actor, { x: a, y: b }) ?? [];
      break;
    case "wander":
      actor.path = findPath(world.map, actor, randomWalkableTile(world)) ?? [];
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
    default:
      // `idle`, and any action this build does not know.
      break;
  }
  // An action that leaves nothing to do costs a short pause. Together with the
  // floor on `wait`, this means a standing actor decides at most once every
  // IDLE_TICKS ticks, however its program is written.
  if (actor.path.length === 0) actor.wait = IDLE_TICKS;
}
