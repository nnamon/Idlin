// A small figure in a hooded cloak, drawn with a few strokes. The colours of
// its hood and cloak are what tell one from another at a glance.

import type { Ctx } from "./pen.ts";
import type { Pose } from "./pose.ts";

export interface FigureStyle {
  readonly cloak: string;
  readonly hood: string;
  readonly ink: string;
  readonly paper: string;
  /** The face and the eye, where they are not the paper and the ink. */
  readonly face?: string;
  readonly eye?: string;
  /** 1 faces right, -1 faces left. */
  readonly facing: 1 | -1;
  /** What it carries, so that two figures in like colours still differ: 0 a staff, 1 a pack, 2 nothing. */
  readonly kit: number;
  readonly scale: number;
}

/** Draws a figure with its feet at (x, y). `time` only drives the small "z" of a resting figure. */
export function drawFigure(
  ctx: Ctx,
  x: number,
  y: number,
  pose: Pose,
  style: FigureStyle,
  time: number,
): void {
  const { cloak, hood, ink, paper } = style;
  // The whole figure is drawn at the alpha it was called with, as when it fades in.
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(style.scale, style.scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;

  // The shadow it stands on: a few hatch strokes, drawn before it lifts off the ground.
  ctx.globalAlpha = base * 0.45;
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(-9 + i * 4.5, 2);
    ctx.lineTo(-5 + i * 4.5, -1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = base;

  // Leaning: the body slants about its feet, which stay where they are.
  if (pose.lean !== 0) ctx.transform(1, 0, -pose.lean, 1, 0, 0);
  // Struck: pressed down and out a little about its feet.
  if (pose.squash > 0) ctx.scale(1 + 0.12 * pose.squash, 1 - 0.16 * pose.squash);
  ctx.scale(style.facing, 1);
  // Near death: bent forward over its feet.
  if (pose.stoop > 0) ctx.transform(1, 0, -0.16 * pose.stoop, 1, 0, 0);
  // A resting figure sits: lower, its legs folding away as it goes down.
  const sit = pose.sit * 7;
  const lift = pose.hop * 3 + pose.breath * 0.8;
  ctx.translate(0, sit - lift);

  if (pose.sit < 1) {
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-3.5, -10);
    ctx.lineTo(-4 - pose.stride * 4, lift - sit);
    ctx.moveTo(3.5, -10);
    ctx.lineTo(4 + pose.stride * 4, lift - sit);
    ctx.stroke();
  }

  if (style.kit === 1) {
    // A pack on the back.
    ctx.fillStyle = paper;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(-13, -25, 8, 13, 2);
    ctx.fill();
    ctx.stroke();
  }

  // The cloak, swaying a little with the stride.
  const sway = pose.stride * 1.5;
  ctx.fillStyle = cloak;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-6, -27);
  ctx.quadraticCurveTo(-13 - sway, -14, -10 - sway, -7);
  ctx.lineTo(10 - sway, -7);
  ctx.quadraticCurveTo(12 - sway, -16, 6, -27);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.globalAlpha = base * 0.55;
  ctx.beginPath();
  ctx.moveTo(2, -24);
  ctx.lineTo(4 - sway, -9);
  ctx.moveTo(6, -22);
  ctx.lineTo(8 - sway, -9);
  ctx.stroke();
  ctx.globalAlpha = base;
  if (pose.stoop > 0) {
    // Ragged: the hem torn in three places, and the head hung low.
    ctx.globalAlpha = base * pose.stoop;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [x, down] of [
      [-7, 4],
      [-1, 3],
      [6, 4.5],
    ] as const) {
      ctx.moveTo(x - 2 - sway, -7);
      ctx.lineTo(x - sway, -7 + down);
      ctx.lineTo(x + 2 - sway, -7);
    }
    ctx.stroke();
    ctx.globalAlpha = base;
    ctx.translate(1.5 * pose.stoop, 3 * pose.stoop);
  }

  // Head and hood.
  ctx.fillStyle = style.face ?? paper;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -33, 7.5, 0, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hood;
  ctx.beginPath();
  ctx.arc(0, -34, 8, 3.3, 6.1);
  ctx.lineTo(8, -32);
  ctx.quadraticCurveTo(0, -40, -8, -33);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = style.eye ?? ink;
  ctx.strokeStyle = style.eye ?? ink;
  if (pose.sit > 0.5) {
    // Eyes shut.
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(1.5, -32);
    ctx.lineTo(4.5, -32);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(3, -32, 1.1, 0, 7);
    ctx.fill();
  }
  ctx.strokeStyle = ink;

  if (style.kit === 0) {
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(12, -30 + sit * 0.3);
    ctx.lineTo(13 + pose.stride, -sit + lift);
    ctx.stroke();
  }
  ctx.restore();

  if (pose.sit > 0) {
    // Asleep: two small letters drift up and fade, and fade in as it sits down.
    ctx.save();
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    for (const [delay, size] of [
      [0, 15],
      [0.5, 11],
    ] as const) {
      const drift = (((time * 0.02 + delay) % 1) + 1) % 1;
      ctx.globalAlpha = base * Math.sin(Math.PI * drift) * 0.85 * pose.sit;
      ctx.font = `${size}px "Fell Italic"`;
      ctx.fillText("z", x + (13 + drift * 7) * style.scale, y - (34 + drift * 16) * style.scale);
    }
    ctx.restore();
  }
}
