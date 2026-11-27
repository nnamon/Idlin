// A resident's hitpoints on its page row: a small bar ruled round in ink,
// filled solid as far as the hitpoints go. Full, it is filled in ink; hurt,
// in the red-brown kept for harm, with the lost part left as paper.

import type { Ctx } from "./pen.ts";

/** The bar's size, in frame pixels. */
export const BAR_WIDTH = 40;
export const BAR_HEIGHT = 9;

/** How much of the bar is filled, in pixels, and whether it is drawn as hurt: anything short of full. */
export function hpFill(hp: number, max: number): { width: number; hurt: boolean } {
  if (!(max > 0)) return { width: 0, hurt: true };
  const share = Math.max(0, Math.min(hp, max)) / max;
  return { width: Math.round(BAR_WIDTH * share), hurt: hp < max };
}

/**
 * Draws the hitpoint bar from `left` with its foot on `bottom`: filled in
 * `ink` when full and in `hurt` when not, ruled round in `ink`.
 */
export function drawHp(
  ctx: Ctx,
  hp: number,
  max: number,
  left: number,
  bottom: number,
  ink: string,
  hurt: string,
): void {
  const top = bottom - BAR_HEIGHT;
  const fill = hpFill(hp, max);
  if (fill.width > 0) {
    ctx.fillStyle = fill.hurt ? hurt : ink;
    ctx.fillRect(left, top, fill.width, BAR_HEIGHT);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(left, top, BAR_WIDTH, BAR_HEIGHT);
}
