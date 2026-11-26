// Where a program meets the world: answers its sensors and carries out the one
// action it commits. Called when an actor has nothing left to do.

import { isWalkable, type Point } from "./map.ts";
import { findPath } from "./path.ts";
import { nextInt } from "./rng.ts";
import { syscall } from "./syscalls.ts";
import { FAULTS, type Program, runDecision } from "./vm.ts";
import { type Actor, clock, type World, type WorldEvent } from "./world.ts";

/** Ticks an actor stands still after `idle` or an action that came to nothing; also the shortest `wait`. */
export const IDLE_TICKS = 5;
/** Ticks an actor stands confused after its program faults, before it tries again. */
export const CONFUSED_TICKS = 30;
export const MAX_WAIT_ACTION_TICKS = 600;

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
  act(world, actor, decision.action.id, decision.action.args);
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
    default:
      return 0;
  }
}

function act(world: World, actor: Actor, id: number, args: readonly number[]): void {
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
    default:
      // `idle`, and any action this build does not know.
      break;
  }
  // An action that leaves nothing to do costs a short pause. Together with the
  // floor on `wait`, this means a standing actor decides at most once every
  // IDLE_TICKS ticks, however its program is written.
  if (actor.path.length === 0) actor.wait = IDLE_TICKS;
}
