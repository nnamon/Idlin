// The monsters, drawn as the residents are: a few ink strokes over a thin
// wash, in day ink or night ink. A wolf is long and low with a raised tail; a
// goblin is a small hunched thing with long ears and a knife. A kind of
// monster with no drawing of its own yet is drawn as a goblin.

import type { Ctx } from "./pen.ts";
import type { Pose } from "./pose.ts";

export interface BeastStyle {
  /** The wash its body is filled with. */
  readonly body: string;
  readonly ink: string;
  readonly paper: string;
  /** 1 faces right, -1 faces left. */
  readonly facing: 1 | -1;
  readonly scale: number;
}

/**
 * Draws a monster with its feet at (x, y). `collapse` (0 to 1) is how far it
 * has sunk into the ground after being killed: it flattens and its strokes
 * thin out as it goes.
 */
export function drawBeast(
  ctx: Ctx,
  kind: string,
  x: number,
  y: number,
  pose: Pose,
  style: BeastStyle,
  collapse = 0,
): void {
  // The whole beast is drawn at the alpha it was called with, as when it fades in.
  const base = ctx.globalAlpha;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(style.scale, style.scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.ink;
  const wide = kind === "wolf" ? 7 : 5;
  // The shadow it stands on, in hatching.
  ctx.globalAlpha = base * 0.45 * (1 - collapse);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < wide; i++) {
    const at = (i - (wide - 1) / 2) * 4.5;
    ctx.moveTo(at - 2, 2);
    ctx.lineTo(at + 2, -1.5);
  }
  ctx.stroke();
  ctx.globalAlpha = base * (1 - collapse);
  if (pose.lean !== 0) ctx.transform(1, 0, -pose.lean, 1, 0, 0);
  const flat = Math.min(0.95, 0.16 * pose.squash + 0.85 * collapse);
  ctx.scale(1 + 0.12 * pose.squash + 0.5 * collapse, 1 - flat);
  ctx.scale(style.facing, 1);
  if (kind === "wolf") wolf(ctx, pose, style);
  else goblin(ctx, pose, style);
  ctx.restore();
}

function wolf(ctx: Ctx, pose: Pose, style: BeastStyle): void {
  const { body, ink } = style;
  const lift = pose.hop * 2.5 + pose.breath * 0.5;
  const swing = pose.stride * 4;
  // Hurt badly: the head hangs and the back sags.
  const hang = pose.stoop * 4;
  ctx.translate(0, -lift);
  // Legs: the far pair a little fainter, each pair swinging against the other.
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  for (const [hip, swingBy] of [
    [-10, swing],
    [9, -swing],
  ] as const) {
    ctx.moveTo(hip, -12);
    ctx.lineTo(hip + swingBy * 0.6 - 1, -6);
    ctx.lineTo(hip + swingBy - 2, lift);
    ctx.moveTo(hip + 3, -12);
    ctx.lineTo(hip + 3 - swingBy * 0.6, -6);
    ctx.lineTo(hip + 3 - swingBy + 1, lift);
  }
  ctx.stroke();
  // The tail, raised and bushy, swinging with the walk.
  ctx.fillStyle = body;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-13, -19 + hang * 0.3);
  ctx.quadraticCurveTo(-24, -22 - swing * 0.3, -27, -13 + hang);
  ctx.quadraticCurveTo(-21, -12, -14, -15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The body: a long back from the haunch up to the shoulder, the belly drawn in.
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-14, -13);
  ctx.quadraticCurveTo(-16, -21 + hang * 0.3, -8, -21 + hang * 0.4);
  ctx.quadraticCurveTo(2, -23 + hang * 0.5, 9, -22 + hang * 0.6);
  ctx.quadraticCurveTo(14, -19 + hang * 0.6, 13, -12);
  ctx.quadraticCurveTo(0, -9, -14, -13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Fur along the back: short strokes, swept back.
  ctx.lineWidth = 1;
  ctx.globalAlpha *= 0.7;
  ctx.beginPath();
  for (const at of [-9, -4, 1, 6]) {
    ctx.moveTo(at, -19 + hang * 0.45);
    ctx.lineTo(at - 3, -16 + hang * 0.45);
  }
  ctx.moveTo(-6, -12.5);
  ctx.lineTo(-3, -14.5);
  ctx.moveTo(2, -11.5);
  ctx.lineTo(5, -13.5);
  ctx.stroke();
  ctx.globalAlpha /= 0.7;
  // The head: a long muzzle out front, the ears pricked.
  ctx.translate(0, hang);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, -22);
  ctx.lineTo(12, -28);
  ctx.lineTo(14.5, -33);
  ctx.lineTo(16.5, -28);
  ctx.quadraticCurveTo(19, -27, 21, -25);
  ctx.lineTo(27, -22.5);
  ctx.quadraticCurveTo(28, -20, 25, -19.5);
  ctx.quadraticCurveTo(19, -18, 14, -16);
  ctx.quadraticCurveTo(11, -17, 9, -18);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The far ear, the nose and the eye.
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(11, -27);
  ctx.lineTo(11.5, -31.5);
  ctx.lineTo(13.5, -29);
  ctx.moveTo(19, -20.8);
  ctx.lineTo(24, -20.6);
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(27, -21.5, 1.3, 0, 7);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(17.5, -24.5, 1.4, 0.9, -0.2, 0, 7);
  ctx.fill();
}

function goblin(ctx: Ctx, pose: Pose, style: BeastStyle): void {
  const { body, ink, paper } = style;
  const lift = pose.hop * 3 + pose.breath * 0.6;
  const swing = pose.stride * 3;
  const hang = pose.stoop * 3;
  ctx.translate(0, -lift);
  // Short bowed legs.
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-3, -9);
  ctx.quadraticCurveTo(-7 - swing, -5, -5 - swing * 1.5, lift);
  ctx.moveTo(3, -9);
  ctx.quadraticCurveTo(7 + swing, -5, 5 + swing * 1.5, lift);
  ctx.stroke();
  if (pose.stoop > 0) ctx.transform(1, 0, -0.18 * pose.stoop, 1, 0, 0);
  // The far arm, behind the body.
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-4, -19);
  ctx.quadraticCurveTo(-10, -14 + swing, -8, -9 + swing);
  ctx.stroke();
  // A hunched body in a ragged tunic.
  ctx.fillStyle = body;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, -21 + hang * 0.4);
  ctx.quadraticCurveTo(-11, -17, -8, -9);
  ctx.lineTo(-5, -7);
  ctx.lineTo(-2, -9.5);
  ctx.lineTo(1, -7);
  ctx.lineTo(4, -9.5);
  ctx.lineTo(7, -7.5);
  ctx.quadraticCurveTo(9, -15, 5, -21 + hang * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The head: big, low on the shoulders, with long ears swept back.
  ctx.translate(1.5 * pose.stoop, hang);
  ctx.beginPath();
  ctx.moveTo(-5, -27);
  ctx.quadraticCurveTo(-14, -31, -17, -29);
  ctx.quadraticCurveTo(-12, -25, -5, -24);
  ctx.moveTo(5, -27.5);
  ctx.quadraticCurveTo(11, -32, 13, -33);
  ctx.quadraticCurveTo(10, -27, 6, -24.5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(1, -25.5, 6.5, 6, 0, 0, 7);
  ctx.fill();
  ctx.stroke();
  // A hooked nose, a narrow eye and a grin.
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(6.5, -27);
  ctx.quadraticCurveTo(10, -25, 7, -23.5);
  ctx.moveTo(1, -21.5);
  ctx.quadraticCurveTo(3.5, -20.5, 6, -22);
  ctx.stroke();
  ctx.fillStyle = paper;
  ctx.beginPath();
  ctx.ellipse(3.5, -27.5, 1.8, 1.1, 0, 0, 7);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(4, -27.5, 0.8, 0, 7);
  ctx.fill();
  ctx.translate(-1.5 * pose.stoop, -hang);
  // The near arm, out front with a short blade.
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(3, -18);
  ctx.quadraticCurveTo(8, -15 - swing, 10, -16 - swing);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(9.5, -15 - swing);
  ctx.lineTo(13, -23 - swing);
  ctx.moveTo(8, -17 - swing);
  ctx.lineTo(12, -15.5 - swing);
  ctx.stroke();
}
