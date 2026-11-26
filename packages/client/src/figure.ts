// A small figure in a hooded cloak, drawn from a sheet of parts. The colours
// of its hood and cloak tell one resident from another at a glance; the parts
// in looks.ts tell them apart when the colours are alike, and show how far on
// they are. On the map a figure is only about 13 pixels tall at 640 wide, so
// what differs sits above or outside the outline: the shape of the hood, the
// tool over the shoulder, a shield or a pot on the back. The pattern and the
// mark on the cloak read on the page, where the figure is drawn larger.

import type { HoodShape, Kit, Looks, Parts } from "./looks.ts";
import type { Ctx } from "./pen.ts";
import type { Pose } from "./pose.ts";

export interface FigureStyle extends Parts {
  readonly cloak: string;
  readonly hood: string;
  readonly ink: string;
  readonly paper: string;
  /** The face and the eye, where they are not the paper and the ink. */
  readonly face?: string;
  readonly eye?: string;
  /** 1 faces right, -1 faces left. */
  readonly facing: 1 | -1;
  readonly scale: number;
}

type Shape = {
  readonly lines: readonly (readonly number[])[];
  readonly arcs?: readonly number[][];
};

/**
 * The 24 marks, in a box from -1 to 1 each way, y down. Each line is a run of
 * x, y pairs; each arc is centre x, centre y, radius, start and end angle.
 */
const MARKS: readonly Shape[] = [
  { lines: [], arcs: [[0, 0, 0.8, 0, 7]] },
  {
    lines: [
      [0, -1, 0, 1],
      [-1, 0, 1, 0],
    ],
  },
  {
    lines: [
      [-0.8, -0.8, 0.8, 0.8],
      [0.8, -0.8, -0.8, 0.8],
    ],
  },
  { lines: [[0, -0.9, 0.9, 0.8, -0.9, 0.8, 0, -0.9]] },
  { lines: [[0, 0.9, 0.9, -0.8, -0.9, -0.8, 0, 0.9]] },
  { lines: [[-0.75, -0.75, 0.75, -0.75, 0.75, 0.75, -0.75, 0.75, -0.75, -0.75]] },
  { lines: [[0, -1, 0.8, 0, 0, 1, -0.8, 0, 0, -1]] },
  { lines: [[-0.9, 0.5, 0, -0.5, 0.9, 0.5]] },
  {
    lines: [
      [-0.9, 0.1, 0, -0.8, 0.9, 0.1],
      [-0.9, 0.9, 0, 0, 0.9, 0.9],
    ],
  },
  { lines: [[-1, 0.2, -0.5, -0.4, 0, 0.2, 0.5, -0.4, 1, 0.2]] },
  {
    lines: [],
    arcs: [
      [0, 0, 0.85, 0.6, 5.7],
      [0.45, 0, 0.6, 1.9, 4.4],
    ],
  },
  {
    lines: [
      [0, -1, 0, -0.6],
      [0, 0.6, 0, 1],
      [-1, 0, -0.6, 0],
      [0.6, 0, 1, 0],
    ],
    arcs: [[0, 0, 0.4, 0, 7]],
  },
  {
    lines: [[0, -1, 0.59, 0.81, -0.95, -0.31, 0.95, -0.31, -0.59, 0.81, 0, -1]],
  },
  {
    lines: [
      [0, 1, 0, -1],
      [-0.6, -0.4, 0, -1, 0.6, -0.4],
    ],
  },
  {
    lines: [
      [0, 1, 0, -1],
      [-0.7, -1, -0.7, -0.3, 0.7, -0.3, 0.7, -1],
    ],
  },
  { lines: [[-0.8, -0.9, 0.8, -0.9, -0.8, 0.9, 0.8, 0.9, -0.8, -0.9]] },
  { lines: [[0, -1, 0, 1]], arcs: [[0, 0, 0.7, 0, 7]] },
  {
    lines: [
      [-0.8, -0.6, 0.8, -0.6],
      [-0.8, 0, 0.8, 0],
      [-0.8, 0.6, 0.8, 0.6],
    ],
  },
  {
    lines: [[-1, 0, -0.5, -0.5, 0.5, -0.5, 1, 0, 0.5, 0.5, -0.5, 0.5, -1, 0]],
    arcs: [[0, 0, 0.2, 0, 7]],
  },
  {
    lines: [
      [0, 1, 0, -1],
      [-0.8, 0.2, 0, -0.6, 0.8, 0.2],
      [-0.8, 0.8, 0, 0, 0.8, 0.8],
    ],
  },
  {
    lines: [
      [
        0.1, 0, 0.3, -0.3, 0, -0.6, -0.5, -0.4, -0.6, 0.2, -0.1, 0.7, 0.6, 0.5, 0.9, -0.2, 0.6,
        -0.9,
      ],
    ],
  },
  {
    lines: [[-0.8, 0.8, 0.8, -0.8]],
    arcs: [
      [0.6, 0.6, 1.1, 3.4, 4.9],
      [-0.6, -0.6, 1.1, 0.25, 1.75],
    ],
  },
  {
    lines: [
      [0, -1, 0, 0.9],
      [-0.4, -0.6, 0.4, -0.6],
    ],
    arcs: [[0, 0.2, 0.7, 0, 3.14]],
  },
  {
    lines: [
      [-0.6, -1, -0.6, 1],
      [0.6, -1, 0.6, 1],
      [-0.6, -0.35, 0.6, -0.35],
      [-0.6, 0.35, 0.6, 0.35],
    ],
  },
];

/** Draws mark `mark` (0 to 23) centred on (x, y), `size` across, in `colour`. */
export function drawMarkGlyph(
  ctx: Ctx,
  mark: number,
  x: number,
  y: number,
  size: number,
  colour: string,
  width = size / 8,
): void {
  const shape = MARKS[((Math.floor(mark) % MARKS.length) + MARKS.length) % MARKS.length] as Shape;
  const k = size / 2;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const line of shape.lines) {
    for (let i = 0; i + 1 < line.length; i += 2) {
      const px = x + (line[i] as number) * k;
      const py = y + (line[i + 1] as number) * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  for (const [cx = 0, cy = 0, r = 0, from = 0, to = 0] of shape.arcs ?? []) {
    ctx.moveTo(x + (cx + r * Math.cos(from)) * k, y + (cy + r * Math.sin(from)) * k);
    ctx.arc(x + cx * k, y + cy * k, r * k, from, to);
  }
  ctx.stroke();
  ctx.restore();
}

function cloakPath(ctx: Ctx, sway: number): void {
  ctx.beginPath();
  ctx.moveTo(-6, -27);
  ctx.quadraticCurveTo(-13 - sway, -14, -10 - sway, -7);
  ctx.lineTo(10 - sway, -7);
  ctx.quadraticCurveTo(12 - sway, -16, 6, -27);
  ctx.closePath();
}

/**
 * The cloak's pattern, in the hood's colour. Each shape keeps inside the
 * cloak's outline, which is stroked over it, so nothing needs clipping.
 */
function drawPattern(ctx: Ctx, looks: Looks, sway: number, hood: string): void {
  ctx.fillStyle = hood;
  ctx.beginPath();
  switch (looks.pattern) {
    case "band":
      // Across the skirt, where the cloak is about 21 wide.
      ctx.moveTo(-10.5 - sway * 0.6, -14);
      ctx.lineTo(10.3 - sway * 0.6, -14);
      ctx.lineTo(10.4 - sway * 0.8, -9.5);
      ctx.lineTo(-10.6 - sway * 0.8, -9.5);
      ctx.closePath();
      ctx.fill();
      break;
    case "stripe":
      ctx.moveTo(-2.5, -27);
      ctx.lineTo(2.5, -27);
      ctx.lineTo(3 - sway, -7);
      ctx.lineTo(-3 - sway, -7);
      ctx.closePath();
      ctx.fill();
      break;
    case "check":
      // Four by four squares from the shoulders to the hem, every other one filled.
      for (let row = 0; row < 4; row++)
        for (let col = 0; col < 4; col++)
          if ((row + col) % 2 === 0)
            ctx.rect(-8 + col * 4 - sway * ((row + 1) / 4), -23 + row * 4, 4, 4);
      ctx.fill();
      break;
    case "plain":
      break;
  }
}

/** The tool's haft: from the hand behind the body to the top end, over the back shoulder. */
const HAFTS: Readonly<Record<string, readonly [number, number, number]>> = {
  // Per tool and tier 0 to 2: the top end's x and y, and the haft's width.
  melee0: [-8, -43, 3],
  melee1: [-10, -51, 2.6],
  melee2: [-10, -51, 2.6],
  woodcutting0: [-9, -45, 2.2],
  woodcutting1: [-11, -52, 2.4],
  woodcutting2: [-12, -55, 2.4],
  fishing0: [-14, -49, 2],
  fishing1: [-20, -54, 2],
  fishing2: [-27, -57, 2],
  cooking0: [-8, -44, 2.2],
  cooking1: [-7, -38, 2.4],
  cooking2: [-8, -44, 2.2],
};

/**
 * How far above its feet the top of each hood shape reaches on a newcomer.
 * They are kept within a few units of each other, so that only the rise with
 * level (`riseFor` in looks.ts) makes one hat stand taller than another.
 */
const HOOD_TOPS: Readonly<Record<HoodShape, number>> = { point: 46, round: 42, brim: 44, cowl: 44 };

/**
 * How far above its feet a standing figure reaches, in its own units: at least
 * 46, which leaves the plainest figure room for the ink of its outline, and
 * more for a tall hat or a tool held high.
 */
export function figureTop(parts: Parts): number {
  const { kit, looks, rise } = parts;
  const tool =
    kit.trade === null ? 0 : -(HAFTS[`${kit.trade}${Math.min(2, kit.tier)}`]?.[1] ?? 0) + 4;
  return Math.max(46, HOOD_TOPS[looks.hood] + rise + 1, tool);
}

/** How far a figure is lifted off the ground in the middle of a step: a newcomer bobs higher. */
export const liftOf = (pose: Pose, gait: number): number => pose.hop * (4.5 - 3 * gait);

/** What is carried on the back, drawn before the cloak so the cloak hides its lower part. */
function drawBack(ctx: Ctx, kit: Kit, style: FigureStyle): void {
  const { ink, paper, hood } = style;
  if (kit.trade === null) {
    if (kit.starter === 1) {
      // A pack on the back.
      ctx.fillStyle = paper;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.roundRect(-13, -25, 8, 13, 2);
      ctx.fill();
      ctx.stroke();
    }
    return;
  }
  const shape = Math.min(2, kit.tier);
  const [tx, ty, width] = HAFTS[`${kit.trade}${shape}`] as readonly [number, number, number];
  // A round shield or a pot on the back, sticking out behind the cloak.
  if (shape === 2 && (kit.trade === "melee" || kit.trade === "cooking")) {
    ctx.fillStyle = kit.trade === "melee" ? hood : ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (kit.trade === "melee") ctx.arc(-12, -19, 7.5, 0, 7);
    else ctx.roundRect(-20, -23, 13, 10, [1, 1, 5, 5]);
    ctx.fill();
    ctx.stroke();
    if (kit.trade === "melee") {
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.arc(-12, -19, 1.8, 0, 7);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(-21.5, -23);
      ctx.lineTo(-5.5, -23);
      ctx.stroke();
    }
  }
  const hx = -1;
  const hy = -13;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  // Along the haft, from the top end down: a unit step along it and across it.
  const length = Math.hypot(tx - hx, ty - hy);
  const ax = (hx - tx) / length;
  const ay = (hy - ty) / length;
  const at = (along: number, across: number): [number, number] => [
    tx + ax * along - ay * across,
    ty + ay * along + ax * across,
  ];
  const poly = (points: readonly (readonly [number, number])[]): void => {
    ctx.beginPath();
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };
  switch (kit.trade) {
    case "woodcutting": {
      // A hatchet, a felling axe with a longer haft and a broader bit, and a double-bit.
      const bit = shape === 0 ? 5 : 7.5;
      const deep = shape === 0 ? 4 : 5.5;
      poly([at(2, 0), at(2, -bit), at(2 + deep + 1.5, -bit - 1), at(2 + deep, 0)]);
      if (shape === 2) poly([at(2, 0), at(2, bit), at(2 + deep + 1.5, bit + 1), at(2 + deep, 0)]);
      break;
    }
    case "fishing": {
      // A rod, longer at each tier, its line hanging from the tip; a float on the longest.
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 2, ty + 9 + shape * 3);
      ctx.stroke();
      if (shape === 2) {
        ctx.fillStyle = hood;
        ctx.beginPath();
        ctx.arc(tx - 2, ty + 16, 2, 0, 7);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case "melee": {
      if (shape === 0) {
        // A cudgel: a knob on the end.
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, 7);
        ctx.fill();
      } else {
        // A sword, point up; its guard across the haft near the hand.
        ctx.lineWidth = 2;
        ctx.beginPath();
        const [g1x, g1y] = at(length - 7, -4);
        const [g2x, g2y] = at(length - 7, 4);
        ctx.moveTo(g1x, g1y);
        ctx.lineTo(g2x, g2y);
        ctx.stroke();
      }
      break;
    }
    case "cooking": {
      // A ladle; then a pan; then the pot on the back with the ladle.
      ctx.beginPath();
      ctx.arc(tx, ty, shape === 1 ? 6 : 3, 0, 7);
      if (shape === 1) {
        ctx.fillStyle = ink;
        ctx.fill();
      } else {
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      break;
    }
  }
  if (kit.tier >= 3) {
    // A pennant tied to the top end: a long swallowtail at the top tier.
    ctx.fillStyle = hood;
    ctx.lineWidth = 1.4;
    const [px, py] = [tx, ty];
    ctx.beginPath();
    ctx.moveTo(px, py);
    if (kit.tier === 4) {
      ctx.lineTo(px - 17, py + 1);
      ctx.lineTo(px - 11, py + 5);
      ctx.lineTo(px - 17, py + 9);
      ctx.lineTo(px, py + 8);
    } else {
      ctx.lineTo(px - 12, py + 3.5);
      ctx.lineTo(px, py + 7);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * The hood over the head, in its shape, `rise` units taller than a
 * newcomer's: the cowl's peak, the dome of the round hood, the point and the
 * crown of the hat all go up by that much.
 */
function drawHood(ctx: Ctx, looks: Looks, hood: string, rise: number): void {
  ctx.fillStyle = hood;
  ctx.lineWidth = 2;
  if (looks.hood === "cowl") {
    // A cowl: wide, falling to the shoulders behind the head, its peak drawn up and back.
    ctx.beginPath();
    ctx.moveTo(8, -32);
    ctx.quadraticCurveTo(5, -44 - rise, -3 - 0.3 * rise, -43 - rise);
    ctx.quadraticCurveTo(-13, -41 - 0.5 * rise, -12.5, -26);
    ctx.lineTo(-5, -26);
    ctx.quadraticCurveTo(-7, -34, 0, -38);
    ctx.quadraticCurveTo(5, -38, 8, -32);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  if (looks.hood === "round") {
    // A dome over the head, drawn up into a taller cap.
    ctx.moveTo(-7.9, -35.3);
    ctx.bezierCurveTo(-8.5, -44.3 - (4 / 3) * rise, 8.5, -44.3 - (4 / 3) * rise, 7.9, -35.4);
  } else {
    ctx.arc(0, -34, 8, 3.3, 6.1);
  }
  ctx.lineTo(8, -32);
  ctx.quadraticCurveTo(0, -40, -8, -33);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (looks.hood === "point") {
    // A point, falling further back the taller it is.
    ctx.beginPath();
    ctx.moveTo(-7, -38);
    ctx.lineTo(-10 - 0.35 * rise, -45 - rise);
    ctx.lineTo(2, -41.8);
    ctx.fill();
    ctx.stroke();
  } else if (looks.hood === "brim") {
    // A hat: a flat crown and a brim wider than the head.
    ctx.beginPath();
    ctx.moveTo(-6, -38);
    ctx.lineTo(-5, -43 - rise);
    ctx.lineTo(5, -43 - rise);
    ctx.lineTo(6, -38);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -38, 13.5, 2.6, 0, 0, 7);
    ctx.fill();
    ctx.stroke();
  }
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
  const { cloak, hood, ink, paper, looks, kit, gait } = style;
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
  // A veteran walks leaning into its stride, easing into it as it sets off and out as it stops.
  if (pose.walk > 0 && gait > 0) ctx.transform(1, 0, -0.08 * gait * pose.walk, 1, 0, 0);
  // At rest, each in its own way: leant back, or hunched forward.
  const sitting = pose.sit;
  if (looks.rest === "back" && sitting > 0) ctx.transform(1, 0, 0.2 * sitting, 1, 0, 0);
  if (looks.rest === "hunch" && sitting > 0) ctx.transform(1, 0, -0.18 * sitting, 1, 0, 0);
  // A resting figure sits: lower, its legs folding away as it goes down.
  const sit = sitting * 7;
  // A newcomer bobs on short steps; a veteran keeps low and steps long.
  const lift = liftOf(pose, gait) + pose.breath * 0.8;
  const spread = 3 + 4 * gait;
  ctx.translate(0, sit - lift);

  if (sitting < 1) {
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-3.5, -10);
    ctx.lineTo(-4 - pose.stride * spread, lift - sit);
    ctx.moveTo(3.5, -10);
    ctx.lineTo(4 + pose.stride * spread, lift - sit);
    ctx.stroke();
  }

  drawBack(ctx, kit, style);
  ctx.strokeStyle = ink;

  // The cloak, swaying a little with the stride, its pattern in the hood's colour.
  const sway = pose.stride * 1.5;
  ctx.fillStyle = cloak;
  ctx.lineWidth = 2;
  cloakPath(ctx, sway);
  ctx.fill();
  if (looks.pattern !== "plain") {
    drawPattern(ctx, looks, sway, hood);
    cloakPath(ctx, sway);
  }
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
  // The mark, on the cloak's back in the paper's colour.
  drawMarkGlyph(ctx, looks.mark, -4.5 - sway * 0.5, -18, 6.5, paper, 1.3);
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
  if (looks.rest === "knees" && sitting > 0) {
    // Sitting with its knees drawn up in front of it.
    ctx.globalAlpha = base * sitting;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(4, -9);
    ctx.lineTo(10, -15);
    ctx.lineTo(13, lift - sit);
    ctx.stroke();
    ctx.globalAlpha = base;
  }
  // Hunched over, the head hangs.
  if (looks.rest === "hunch" && sitting > 0) ctx.translate(1.5 * sitting, 2.5 * sitting);

  // Head and hood.
  ctx.fillStyle = style.face ?? paper;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -33, 7.5, 0, 7);
  ctx.fill();
  ctx.stroke();
  drawHood(ctx, looks, hood, style.rise);
  ctx.fillStyle = style.eye ?? ink;
  ctx.strokeStyle = style.eye ?? ink;
  if (sitting > 0.5) {
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

  if (kit.trade === null && kit.starter === 0) {
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(12, -30 + sit * 0.3);
    ctx.lineTo(13 + pose.stride, -sit + lift);
    ctx.stroke();
  }
  ctx.restore();

  if (sitting > 0) {
    // Asleep: two small letters drift up and fade, and fade in as it sits down.
    ctx.save();
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    for (const [delay, size] of [
      [0, 15],
      [0.5, 11],
    ] as const) {
      const drift = (((time * 0.02 + delay) % 1) + 1) % 1;
      ctx.globalAlpha = base * Math.sin(Math.PI * drift) * 0.85 * sitting;
      ctx.font = `${size}px "Fell Italic"`;
      ctx.fillText("z", x + (13 + drift * 7) * style.scale, y - (34 + drift * 16) * style.scale);
    }
    ctx.restore();
  }
}
