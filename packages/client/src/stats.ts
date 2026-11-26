// A resident's numbers on the page: its hitpoints as a hatched bar with the
// count beside it, and a level for each skill behind a small pen-drawn mark.

import { type Actor, ADVENTURER, levelFor, SKILLS, type Skill } from "@idlin/sim";
import { type Ctx, Pen, type Pt } from "./pen.ts";

/** The marks' height, and the room each mark takes before its number. */
export const MARK = 18;
const MARK_ROOM = 23;
/** Between one skill's number and the next skill's mark. */
const SKILL_GAP = 13;
const HP_FONT = '26px "Fell"';
const LEVEL_FONT = '26px "Fell"';
const BAR_WIDTH = 60;
const BAR_HEIGHT = 12;

/** Each skill's mark, in a square of side 1 from its top-left corner: lines for a pen. */
const MARKS: Readonly<Record<Skill, readonly (readonly Pt[])[]>> = {
  // A sword, point up and to the right, with its guard.
  melee: [
    [
      [0.08, 0.92],
      [0.92, 0.08],
    ],
    [
      [0.12, 0.52],
      [0.48, 0.88],
    ],
  ],
  hitpoints: [
    [
      [0.5, 0.95],
      [0.15, 0.62],
      [0.04, 0.38],
      [0.1, 0.17],
      [0.28, 0.08],
      [0.43, 0.16],
      [0.5, 0.32],
      [0.57, 0.16],
      [0.72, 0.08],
      [0.9, 0.17],
      [0.96, 0.38],
      [0.85, 0.62],
      [0.5, 0.95],
    ],
  ],
  // A hatchet: a straight haft, and a head across its top with a short poll
  // behind and a blade that flares from the haft to a long edge, its lower
  // corner swept down.
  woodcutting: [
    [
      [0.36, 0.98],
      [0.4, 0.04],
    ],
    [
      [0.4, 0.14],
      [0.2, 0.14],
      [0.2, 0.3],
      [0.4, 0.3],
      [0.6, 0.32],
      [0.8, 0.62],
      [0.95, 0.38],
      [0.97, 0.16],
      [0.86, 0.0],
      [0.6, 0.12],
      [0.4, 0.14],
    ],
  ],
  fishing: [
    [
      [0.04, 0.52],
      [0.3, 0.28],
      [0.58, 0.3],
      [0.76, 0.52],
      [0.58, 0.72],
      [0.3, 0.74],
      [0.04, 0.52],
    ],
    [
      [0.76, 0.52],
      [0.98, 0.3],
      [0.98, 0.74],
      [0.76, 0.52],
    ],
  ],
  // A pot with its rim, and steam over it.
  cooking: [
    [
      [0.02, 0.44],
      [0.98, 0.44],
    ],
    [
      [0.1, 0.44],
      [0.14, 0.76],
      [0.3, 0.96],
      [0.7, 0.96],
      [0.86, 0.76],
      [0.9, 0.44],
    ],
    [
      [0.42, 0.32],
      [0.48, 0.18],
      [0.42, 0.02],
    ],
    [
      [0.6, 0.32],
      [0.66, 0.18],
      [0.6, 0.02],
    ],
  ],
};

/** Draws a skill's mark with its bottom-left corner at (x, y), MARK pixels high. */
export function drawMark(ctx: Ctx, skill: Skill, x: number, y: number): void {
  // The same pen every time, so the mark does not shimmer from frame to frame.
  const pen = new Pen(SKILLS.indexOf(skill) + 11);
  for (const line of MARKS[skill]) {
    pen.line(
      ctx,
      line.map(([u, v]) => [x + u * MARK, y - MARK + v * MARK] as const),
      1.8,
      0.5,
    );
  }
}

/** What the page writes for a resident's hitpoints. */
export const hpText = (hp: number, max: number): string => `${Math.max(0, hp)}/${max}`;

/** How wide the hitpoints are drawn, so the name beside them can keep clear. */
export function hpWidth(ctx: Ctx, hp: number, max: number): number {
  ctx.font = HP_FONT;
  return ctx.measureText(hpText(hp, max)).width + 12 + BAR_WIDTH;
}

/**
 * Draws hitpoints ending at `right` on the baseline `y`: the count, then a
 * bar outlined in ink and hatched as far as the hitpoints go.
 */
export function drawHp(ctx: Ctx, hp: number, max: number, end: number, y: number): void {
  // Kept a little inside `end`, so the pen's wobble stays within the page's rules.
  const right = end - 2;
  const left = right - BAR_WIDTH;
  ctx.font = HP_FONT;
  ctx.textAlign = "right";
  ctx.fillText(hpText(hp, max), left - 10, y);
  ctx.textAlign = "left";
  const top = y - BAR_HEIGHT - 4;
  const pen = new Pen(7);
  pen.line(
    ctx,
    [
      [left, top],
      [right, top],
      [right, top + BAR_HEIGHT],
      [left, top + BAR_HEIGHT],
    ],
    1.6,
    0.4,
    true,
  );
  const full = Math.round((BAR_WIDTH * Math.max(0, Math.min(hp, max))) / max);
  if (full <= 0) return;
  // Strokes rising to the right at 45 degrees, each cut to the hatched part of the bar.
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = left - BAR_HEIGHT; x < left + full; x += 5) {
    const from = Math.max(x, left);
    const to = Math.min(x + BAR_HEIGHT, left + full);
    if (to <= from) continue;
    ctx.moveTo(from, top + BAR_HEIGHT - (from - x));
    ctx.lineTo(to, top + BAR_HEIGHT - (to - x));
  }
  ctx.stroke();
}

/**
 * Draws an adventurer's level in every skill from `left` on the baseline `y`,
 * a mark and then the number, squeezed if they would run past `right`.
 * Monsters have no skills, and nothing is drawn for them.
 */
export function drawLevels(ctx: Ctx, actor: Actor, left: number, right: number, y: number): void {
  if (actor.kind !== ADVENTURER) return;
  ctx.font = LEVEL_FONT;
  const levels = SKILLS.map((_, i) => String(levelFor(actor.xp[i] ?? 0)));
  const widths = levels.map((text) => ctx.measureText(text).width);
  const total = widths.reduce((sum, w) => sum + MARK_ROOM + w + SKILL_GAP, -SKILL_GAP);
  const squeeze = Math.min(1, (right - left) / total);
  ctx.save();
  ctx.translate(left, y);
  ctx.scale(squeeze, squeeze);
  let x = 0;
  SKILLS.forEach((skill, i) => {
    drawMark(ctx, skill, x, 0);
    ctx.fillText(levels[i] as string, x + MARK_ROOM, 0);
    x += MARK_ROOM + (widths[i] as number) + SKILL_GAP;
  });
  ctx.restore();
}
