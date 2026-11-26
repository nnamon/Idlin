// Where an actor is drawn, as a pure function of its simulation state and the
// time. Kept apart from the renderer so it can be tested without a canvas.

import { type Actor, STEP_TICKS } from "@idlin/sim";

/** Art pixels per tile. */
const TILE = 16;
const HOP_HEIGHT = 2.2;

export interface Pose {
  /** Art pixels: the middle of the actor's feet. */
  readonly x: number;
  readonly y: number;
  /** Art pixels the sprite is lifted off the ground mid-step. */
  readonly hop: number;
  /** 0 or 1 art pixel: a standing actor rises a pixel now and then, as if breathing. */
  readonly bob: number;
  readonly moving: boolean;
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
  return {
    x: (actor.fromX + (actor.x - actor.fromX) * eased) * TILE + TILE / 2,
    y: (actor.fromY + (actor.y - actor.fromY) * eased) * TILE + TILE,
    hop: moving ? Math.sin(Math.PI * progress) * HOP_HEIGHT : 0,
    // Whole pixels only: a scaled sprite would double or drop pixel rows.
    bob: !moving && Math.sin(time * 0.16 + actor.id * 1.7) > 0.6 ? 1 : 0,
    moving,
  };
}

/** Where the sun throws shadows at a game hour: which way, how long (art pixels) and how dark. */
export function sunShadow(hour: number): { direction: -1 | 1; length: number; alpha: number } {
  const SUNRISE = 5.5;
  const SUNSET = 19.5;
  if (hour <= SUNRISE || hour >= SUNSET) return { direction: 1, length: 0, alpha: 0 };
  const through = (hour - SUNRISE) / (SUNSET - SUNRISE);
  // Long and faint at the ends of the day, short and firm at noon.
  const low = Math.abs(through - 0.5) * 2;
  const edge = Math.min(1, Math.min(hour - SUNRISE, SUNSET - hour) / 0.75);
  return { direction: through < 0.5 ? -1 : 1, length: 2 + low * low * 14, alpha: 0.2 * edge };
}
