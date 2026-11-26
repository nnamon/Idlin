// Where an actor is drawn and how it holds itself, as a pure function of its
// simulation state and the time. Kept apart from the renderer so it can be
// tested without a canvas.

import { type Actor, STEP_TICKS } from "@idlin/sim";

/** Ticks an actor must still have to wait before it is drawn sitting down to rest. */
export const REST_TICKS = 12;

export interface Pose {
  /** In tiles: the middle of the tile across, and the tile's bottom edge down. */
  readonly x: number;
  readonly y: number;
  /** 0 to 1: how high off the ground the actor is in the middle of a step. */
  readonly hop: number;
  /** -1 to 1: which leg leads. Swings once per two steps while walking; 0 when standing. */
  readonly stride: number;
  /** 0 to 1: a slow rise and fall while standing, as of breathing. */
  readonly breath: number;
  readonly moving: boolean;
  /** Standing still with a good while yet to wait. */
  readonly resting: boolean;
  /**
   * 0 to 1: how far down into sitting. `actorPose` gives 1 while resting and 0
   * otherwise; the scene eases it over a few ticks with `easeSit`.
   */
  readonly sit: number;
  /**
   * The slant of the body about its feet, as a shear: positive leans the top
   * east. `actorPose` gives 0; the scene sets it from the beats in effects.ts.
   */
  readonly lean: number;
}

/** How much of the way into or out of sitting a figure moves in one tick. */
export const SIT_STEP = 0.25;

/** The next tick's sitting depth, moving at most SIT_STEP towards the pose's own (0 or 1). */
export function easeSit(before: number, target: number): number {
  if (target > before) return Math.min(target, before + SIT_STEP);
  return Math.max(target, before - SIT_STEP);
}

/**
 * `fraction` is how far the picture is into the next tick, 0 to 1. A step
 * starts with `moveTicksLeft` at STEP_TICKS and ends when it reaches 0, so the
 * pose moves smoothly from one tile to the next and on into a following step.
 */
export function actorPose(actor: Actor, fraction: number, time: number): Pose {
  const moving = actor.moveTicksLeft > 0;
  const raw = moving ? (STEP_TICKS - actor.moveTicksLeft + fraction) / STEP_TICKS : 1;
  const progress = Math.min(1, Math.max(0, raw));
  // Ease in and out of each step.
  const eased = progress * progress * (3 - 2 * progress);
  // Steps alternate legs: tiles whose coordinates sum to an even number lead with the left.
  const side = (actor.x + actor.y) % 2 === 0 ? 1 : -1;
  const resting = !moving && actor.path.length === 0 && actor.wait > REST_TICKS;
  return {
    x: actor.fromX + (actor.x - actor.fromX) * eased + 0.5,
    y: actor.fromY + (actor.y - actor.fromY) * eased + 1,
    hop: moving ? Math.sin(Math.PI * progress) : 0,
    stride: moving ? Math.sin(Math.PI * progress) * side : 0,
    breath: moving ? 0 : (Math.sin(time * 0.12 + actor.id * 1.7) + 1) / 2,
    moving,
    resting,
    sit: resting ? 1 : 0,
    lean: 0,
  };
}
