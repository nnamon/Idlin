// A citizen (docs/art.md, section 5): three heads tall, a cloak hung from a
// spine that the pose bends, two arms that hold and swing, legs with feet, and
// a hat. One construction at every size; `detail` says how much of it is
// shown: 0 far (a landing), 1 mid, 2 near (the city close up). Between two
// sizes whole parts fade in or out and no line gets thinner.

import { identity } from "../identity.ts";
import { CONTOUR, type Draw, FORM, HAIR, INK, PAPER, shade } from "./draw.ts";
import { clamp, hash, lerp } from "./geom.ts";
import { usernameOf } from "./names.ts";

export const TOOLS = [
  "blade",
  "bow",
  "sling",
  "hammer",
  "ladle",
  "pole",
  "pot",
  "maul",
  "spear",
  "none",
] as const;
export type Tool = (typeof TOOLS)[number];

export interface Look {
  readonly id: number;
  readonly name: string;
  readonly cloak: number;
  readonly hood: number;
  /** 0 a pointed hat, 1 a round cap, 2 a brimmed hat, 3 a cowl. */
  readonly hat: number;
  /** 0 plain, 1 a band at the hem, 2 stripes, 3 both. */
  readonly pattern: number;
  /** 0 to 1: how tall the hat has grown. */
  readonly rise: number;
  readonly bands: number;
  readonly tool: Tool;
}

const FIGHTING: readonly Tool[] = [
  "blade",
  "blade",
  "bow",
  "blade",
  "sling",
  "blade",
  "bow",
  "pot",
];

/** The look of the citizen with this id (from 1): colours as the game already gives them. */
export function lookOf(id: number): Look {
  const colours = identity(id);
  const i = id - 1;
  return {
    id,
    name: usernameOf(i),
    cloak: Number.parseInt(colours.cloak.slice(1), 16),
    hood: Number.parseInt(colours.hood.slice(1), 16),
    hat: i % 4,
    pattern: (i + Math.floor(i / 4)) % 4,
    rise: hash(id, 77),
    bands: Math.floor(hash(id, 78) * 4),
    tool: FIGHTING[i % FIGHTING.length] as Tool,
  };
}

export interface Pose {
  /** 1 facing right, -1 left. */
  face: number;
  /** How far the spine tips toward where it faces, in radians. */
  lean: number;
  /** How far the spine bows: positive coils the shoulders back. */
  coil: number;
  /** 0 to 1: knees bent, body lowered. */
  crouch: number;
  /** Height against its own: over 1 stretched, under 1 squashed. */
  stretch: number;
  /** Where in a stride the legs are, 0 to 1, and how long the stride is. */
  stride: number;
  step: number;
  /** The near arm's angle from hanging (forward is positive) and the far arm's. */
  arm: number;
  arm2: number;
  /** The tool's angle from the arm, and which tool, if not the citizen's own. */
  grip: number;
  tool: Tool | null;
  /** The head's tilt. */
  nod: number;
  /** 0 to 1: the bundle on its back. */
  haul: number;
  /** -1 fallen on its back, 1 on its face, 0 up. */
  down: number;
  /** 0 to 1: seated, legs out in front. */
  sit: number;
  /** How far the hem and hat tip trail behind, in heads; negative ahead. */
  trail: number;
  /** Drawn in paper with ink line only: the frame a blow lands. */
  flash: boolean;
  /**
   * Drawn again on top of what covers it (docs/art.md, section 4): in paper with its line, as
   * `flash`, but keeping its hat's colour, the first thing a viewer looks for.
   */
  outline?: boolean;
  /** Eyes shut. */
  asleep: boolean;
}

export const REST: Pose = {
  face: 1,
  lean: 0,
  coil: 0,
  crouch: 0,
  stretch: 1,
  stride: 0,
  step: 0,
  arm: 0.12,
  arm2: -0.1,
  grip: 0.5,
  tool: null,
  nod: 0,
  haul: 0,
  down: 0,
  sit: 0,
  trail: 0,
  flash: false,
  asleep: false,
};

export const pose = (over: Partial<Pose>): Pose => ({ ...REST, ...over });

/** Standing, breathing. Loops are offset by id so a crowd is never in step. */
export function standing(id: number, t: number, face = 1): Pose {
  const phase = t / (2.6 + hash(id, 3) * 1.4) + hash(id, 4);
  const breath = Math.sin(phase * Math.PI * 2);
  return pose({
    face,
    lean: 0.03 + (hash(id, 5) - 0.5) * 0.1,
    stretch: 1 + breath * 0.012,
    arm: 0.1 + breath * 0.03,
    arm2: -0.12 - breath * 0.03,
    nod: Math.sin(phase * 2.3 + id) * 0.05,
    trail: breath * 0.02,
  });
}

/** Walking (speed 1) or running (speed 2); `along` is the distance covered, in heads. */
export function walking(along: number, speed: number, face: number): Pose {
  const run = clamp(speed - 1);
  const stride = along / (2.1 + run * 1.3);
  const swing = Math.sin(stride * Math.PI * 2);
  return pose({
    face,
    lean: lerp(0.17, 0.35, run),
    stride: stride % 1,
    step: lerp(1, 1.55, run),
    stretch: 1 + Math.abs(swing) * 0.02 - 0.02,
    arm: -swing * lerp(0.5, 0.95, run),
    arm2: swing * lerp(0.5, 0.95, run),
    trail: lerp(0.16, 0.34, run) + swing * 0.04,
    nod: swing * 0.03,
  });
}

/** How long each beat of a wide blow lasts, in seconds. */
export const BLOW = { coil: 0.16, strike: 0.07, follow: 0.22, recover: 0.24 };
export const BLOW_CONTACT = BLOW.coil + BLOW.strike;
export const BLOW_LENGTH = BLOW.coil + BLOW.strike + BLOW.follow + BLOW.recover;

/**
 * A wide blow, `at` seconds in (hit-stop already taken out by the caller):
 * the coil away from the target, the strike, the weapon carried past, and
 * the recovery, with the hem and hat arriving late.
 */
export function swinging(at: number, face: number): Pose {
  const { coil, strike, follow, recover } = BLOW;
  if (at < coil) {
    const k = 1 - (1 - at / coil) ** 2;
    return pose({
      face,
      lean: -0.34 * k,
      coil: 0.5 * k,
      crouch: 0.25 * k,
      arm: lerp(0.3, 3.3, k),
      arm2: -0.7 * k,
      grip: lerp(0.5, -0.5, k),
      trail: -0.2 * k,
      nod: -0.15 * k,
    });
  }
  if (at < coil + strike) {
    const k = (at - coil) / strike;
    return pose({
      face,
      lean: lerp(-0.34, 0.42, k),
      coil: lerp(0.5, -0.35, k),
      crouch: 0.25,
      stretch: 1.04,
      arm: lerp(3.3, 1.35, k),
      arm2: lerp(-0.7, 0.6, k),
      grip: lerp(-0.5, 0.3, k),
      trail: lerp(-0.2, 0.5, k),
      step: 0.9,
      stride: 0.25,
    });
  }
  if (at < coil + strike + follow) {
    const k = (at - coil - strike) / follow;
    const e = 1 - (1 - k) ** 3;
    return pose({
      face,
      lean: lerp(0.42, 0.5, e),
      coil: -0.35,
      crouch: 0.3,
      arm: lerp(1.35, -0.55, e),
      arm2: 0.6,
      grip: lerp(0.3, 0.9, e),
      trail: lerp(0.5, -0.28, e),
      step: 0.9,
      stride: 0.25,
      nod: 0.12,
    });
  }
  const k = clamp((at - coil - strike - follow) / recover);
  const e = k * k * (3 - 2 * k);
  return pose({
    face,
    lean: lerp(0.5, 0.05, e),
    coil: lerp(-0.35, 0, e),
    crouch: lerp(0.3, 0, e),
    arm: lerp(-0.55, 0.12, e),
    arm2: lerp(0.6, -0.1, e),
    grip: lerp(0.9, 0.5, e),
    trail: lerp(-0.28, 0.08, e) * (1 - e),
    step: lerp(0.9, 0, e),
    stride: 0.25,
  });
}

/** Drawing a bow or winding a sling: `k` 0 to 1 is the draw, then the loose. */
export function shooting(k: number, face: number, loosed: boolean): Pose {
  const pull = loosed ? 0 : k;
  return pose({
    face,
    lean: lerp(0, -0.16, pull) + (loosed ? 0.14 : 0),
    coil: 0.2 * pull,
    arm: 1.5,
    arm2: lerp(1.2, -0.5, pull) + (loosed ? -0.9 : 0),
    grip: 0,
    step: 0.7,
    stride: 0.25,
    trail: loosed ? -0.15 : 0.05,
  });
}

/** Bent round the point it was hit, `k` 0 just hit to 1 recovered. */
export function hurt(k: number, face: number): Pose {
  const e = 1 - clamp(k);
  return pose({
    face,
    lean: -0.5 * e,
    coil: -0.6 * e,
    stretch: 1 - 0.18 * e * Math.cos(k * 9),
    arm: 1.2 * e,
    arm2: -1.1 * e,
    nod: -0.3 * e,
    trail: -0.4 * e,
    flash: k < 0.12,
  });
}

/**
 * Thrown by a blow, `k` 0 just struck to 1 landed: the body turns over
 * backward through the air, arms flung out, and comes down flat.
 */
export function thrown(k: number, face: number): Pose {
  const e = clamp(k);
  return pose({
    face,
    down: -lerp(0.15, 0.95, e),
    lean: -0.4,
    coil: -0.5 * (1 - e),
    arm: lerp(2.6, 1.8, e),
    arm2: lerp(-2.2, -1.2, e),
    nod: -0.3,
    trail: -0.5 * (1 - e),
    stretch: 1 + 0.12 * Math.sin(e * Math.PI),
    tool: "none",
  });
}

/** The spine's sideways offset at a height above the hips, in heads. */
const bend = (p: Pose, h: number): number => Math.tan(p.lean) * h - p.coil * h * h * 0.42;

/**
 * Draws a citizen with its feet at (x, y), `size` frame pixels tall to the
 * top of its head.
 */
export function drawCitizen(
  d: Draw,
  look: Look,
  p: Pose,
  x: number,
  y: number,
  size: number,
  detail: number,
): void {
  const mid = clamp(detail);
  const near = clamp(detail - 1);
  const u = size / 3;
  // Frame pixels to a head, for dots, whose size does not follow the drawing's scale.
  const px = u * d.zoom;
  const strength = d.strength;
  const offset = d.offset;
  d.offset = clamp(px * 0.16, 1, offset);
  const ghost = p.flash || p.outline === true;
  const cloak = ghost ? PAPER : look.cloak;
  const hood = p.flash ? PAPER : look.hood;
  const seed = look.id * 31;

  d.push();
  d.move(x, y);
  // A few strokes of shadow on the ground, under everything that stands.
  if (Math.abs(p.down) < 0.5) {
    d.push();
    d.scale(u);
    d.hatch(d.round(0.08, 0.02, 0.86, 0.17, 8), 2, INK, 0.5);
    d.pop();
  }
  d.scale(u * p.face, u * p.stretch);
  if (p.down !== 0) d.turn(p.down * 1.5).move(0, -0.2 * Math.abs(p.down));
  if (p.sit > 0) d.move(0, 0.55 * p.sit);

  const hipY = -1.02 + p.crouch * 0.3;
  const hipX = p.crouch * 0.08;
  const at = (h: number): number => hipX + bend(p, h);
  const neckH = 1.02;
  const neckX = at(neckH);
  const neckY = hipY - neckH + Math.abs(p.lean) * 0.12 + Math.abs(p.coil) * 0.1;
  const shoulderY = neckY + 0.12;
  const headX = neckX + 0.1 + Math.sin(p.lean + p.nod) * 0.42;
  const headY = neckY - 0.44;

  const limb = (
    sx: number,
    sy: number,
    angle: number,
    length: number,
    weight: number,
    key: number,
  ): [number, number] => {
    const hx = sx + Math.sin(angle) * length;
    const hy = sy + Math.cos(angle) * length;
    // The elbow sits a little behind the straight line.
    const ex = (sx + hx) / 2 - Math.cos(angle) * length * 0.16;
    const ey = (sy + hy) / 2 + Math.sin(angle) * length * 0.16 * (angle > 2 ? -1 : 1);
    d.curve([sx, sy, ex, ey, hx, hy], weight, seed + key);
    return [hx, hy];
  };

  // The far arm, behind the body: only while it is doing something at the far size.
  const armsShown = Math.max(mid, Math.abs(p.arm) > 0.6 || Math.abs(p.arm2) > 0.6 ? 1 : 0);
  if (armsShown > 0 && p.down === 0) {
    d.strength = strength * armsShown;
    const [fx, fy] = limb(neckX - 0.06, shoulderY, p.arm2, 0.92, CONTOUR, 1);
    d.dot(fx, fy, Math.max(1.6, px * 0.11));
    d.strength = strength;
  }

  // Legs and feet, from the mid size up. At the far size the cloak reaches the ground.
  if (mid > 0) {
    d.strength = strength * mid;
    for (let leg = 0; leg < 2; leg++) {
      const phase = (p.stride + leg * 0.5) * Math.PI * 2;
      let fx = Math.sin(phase) * 0.42 * p.step + (leg ? -0.1 : 0.12);
      let fy = -Math.max(0, Math.cos(phase)) * 0.22 * p.step;
      if (p.sit > 0) {
        fx = lerp(fx, 0.95 + leg * 0.12, p.sit);
        fy = lerp(fy, -0.5 + leg * 0.05, p.sit);
      }
      const hx = hipX + (leg ? -0.1 : 0.1);
      const kx = (hx + fx) / 2 + 0.16 + p.crouch * 0.2 + p.sit * 0.2;
      const ky = (hipY + fy) / 2 - p.sit * 0.3;
      d.curve([hx, hipY + 0.2, kx, ky, fx, fy], CONTOUR, seed + 20 + leg);
      d.line(fx - 0.03, fy, fx + 0.26, fy + 0.02, CONTOUR, seed + 30 + leg);
    }
    d.strength = strength;
  }

  // The bundle on its back grows with the haul.
  if (p.haul > 0.02) {
    const r = 0.28 + p.haul * 0.42;
    const bx = at(0.6) - 0.42 - r * 0.5;
    const by = hipY - 0.55 - r * 0.2;
    d.body(d.round(bx, by, r, r * 0.9, 8, seed + 5), {
      wash: 0xc9a36b,
      washAlpha: 0.85,
      seed: seed + 40,
    });
    d.line(bx - r * 0.7, by - r * 0.2, bx + r * 0.75, by + r * 0.1, FORM, seed + 41);
    if (near > 0)
      d.line(bx - r * 0.1, by - r * 0.85, bx + r * 0.1, by + r * 0.85, FORM, seed + 42, near);
  }

  // The cloak, hung from the spine. Its hem trails behind the body's movement.
  const hemY = lerp(-0.08, -0.6, mid) + p.sit * 0.1;
  const trail = p.trail;
  const cloakPts = [
    neckX + 0.2,
    neckY + 0.02,
    at(0.55) + 0.36,
    hipY - 0.5,
    hipX + 0.44 - trail * 0.35,
    hemY - 0.02,
    hipX - 0.12 - trail * 0.9,
    hemY + 0.07,
    hipX - 0.62 - trail * 1.5,
    hemY - 0.05,
    at(0.5) - 0.5 - trail * 0.35,
    hipY - 0.45,
    neckX - 0.26,
    neckY + 0.04,
  ];
  // At the far size a rim of bare paper is left round the figure, so it stands
  // clear of grass, ink and other bodies.
  const rim = (pts: number[], rounded: boolean): void => {
    if (mid >= 1) return;
    const ink = d.ink;
    d.ink = d.ground;
    d.strength = strength * (1 - mid);
    if (rounded) d.curve(pts, 8, seed + 99, true);
    else d.path(pts, 8, seed + 99, true);
    d.ink = ink;
    d.strength = strength;
  };
  rim(cloakPts, true);
  d.body(cloakPts, { wash: cloak, washAlpha: lerp(1, 0.9, mid), seed: seed + 50 });
  if (!ghost) {
    // The shade side is the lower right of everything, whichever way it faces.
    if (mid > 0) {
      const front = p.face > 0;
      const band = front
        ? [
            neckX + 0.14,
            neckY + 0.3,
            at(0.55) + 0.3,
            hipY - 0.5,
            hipX + 0.38 - trail * 0.35,
            hemY - 0.06,
            hipX + 0.08 - trail * 0.6,
            hemY,
            at(0.5) + 0.08,
            hipY - 0.5,
          ]
        : [
            neckX - 0.2,
            neckY + 0.3,
            at(0.5) - 0.44 - trail * 0.35,
            hipY - 0.45,
            hipX - 0.55 - trail * 1.4,
            hemY - 0.08,
            hipX - 0.2 - trail * 0.9,
            hemY,
            at(0.5) - 0.16,
            hipY - 0.5,
          ];
      d.strength = strength * mid;
      d.hatch(band, 2, INK, 0.62, true);
      if (look.pattern & 1)
        d.curve(
          [
            hipX + 0.4 - trail * 0.35,
            hemY - 0.22,
            hipX - 0.12 - trail * 0.9,
            hemY - 0.12,
            hipX - 0.58 - trail * 1.4,
            hemY - 0.24,
          ],
          FORM,
          seed + 60,
        );
      d.strength = strength;
    }
    if (near > 0) {
      d.strength = strength * near;
      // Folds, the stripes of the cloth, and the mark it wears.
      d.curve(
        [
          neckX - 0.05,
          neckY + 0.3,
          at(0.5) - 0.1,
          hipY - 0.4,
          hipX - 0.2 - trail * 0.8,
          hemY - 0.1,
        ],
        FORM,
        seed + 61,
      );
      d.curve(
        [
          neckX + 0.1,
          neckY + 0.4,
          at(0.4) + 0.2,
          hipY - 0.2,
          hipX + 0.22 - trail * 0.4,
          hemY - 0.1,
        ],
        HAIR,
        seed + 62,
      );
      if (look.pattern & 2) {
        d.curve(
          [
            neckX - 0.16,
            neckY + 0.25,
            at(0.5) - 0.32,
            hipY - 0.4,
            hipX - 0.42 - trail * 1.2,
            hemY - 0.08,
          ],
          FORM,
          seed + 63,
        );
        d.curve(
          [
            neckX + 0.02,
            neckY + 0.28,
            at(0.5) + 0.04,
            hipY - 0.4,
            hipX + 0.02 - trail * 0.6,
            hemY - 0.02,
          ],
          FORM,
          seed + 64,
        );
      }
      const mx = at(0.62) - 0.06;
      const my = hipY - 0.66;
      const mark = look.id % 4;
      d.ink = shade(look.hood, 0.35);
      if (mark === 0)
        d.path([mx - 0.1, my, mx, my - 0.12, mx + 0.1, my, mx, my + 0.12], FORM, seed + 65, true);
      else if (mark === 1) d.curve(d.round(mx, my, 0.1, 0.1, 7), FORM, seed + 65, true);
      else if (mark === 2) {
        d.line(mx - 0.1, my, mx + 0.1, my, FORM, seed + 65);
        d.line(mx, my - 0.12, mx, my + 0.12, FORM, seed + 66);
      } else d.path([mx - 0.1, my + 0.08, mx, my - 0.1, mx + 0.1, my + 0.08], FORM, seed + 65);
      d.ink = INK;
      d.strength = strength;
    }
  }

  // The head: a paper disc. It is the mark that says "a person".
  const headR = 0.48;
  d.body(d.round(headX, headY, headR, headR, 9), { seed: seed + 70 });
  if (mid > 0) {
    d.strength = strength * mid;
    const ex = headX + 0.2;
    const ey = headY + 0.02;
    if (p.asleep) d.line(ex - 0.1, ey, ex + 0.1, ey + 0.03, FORM, seed + 71);
    else d.dot(ex, ey, Math.max(1.3, px * 0.075));
    d.strength = strength;
  }
  if (near > 0) {
    d.strength = strength * near;
    // A brow and a mouth: enough for a mood.
    const mood = hash(look.id, 9);
    d.line(
      headX + 0.06,
      headY - 0.14 + (mood - 0.5) * 0.08,
      headX + 0.36,
      headY - 0.17,
      FORM,
      seed + 72,
    );
    d.curve(
      [
        headX + 0.12,
        headY + 0.24,
        headX + 0.24,
        headY + 0.27 + (mood - 0.4) * 0.07,
        headX + 0.36,
        headY + 0.22,
      ],
      FORM,
      seed + 73,
    );
    d.dot(headX + 0.44, headY + 0.08, Math.max(1, px * 0.04));
    d.strength = strength;
  }

  // The hat: its shape and colour are how a citizen is found in a crowd.
  const rise = look.rise * 0.34;
  const tip = trail * 0.9;
  let hatPts: number[];
  if (look.hat === 0)
    hatPts = [
      headX - 0.6,
      headY - 0.14,
      headX + 0.56,
      headY - 0.26,
      headX + 0.12,
      headY - 0.78,
      headX - 0.34 - tip,
      headY - 1.42 - rise,
      headX - 0.3,
      headY - 0.7,
    ];
  else if (look.hat === 1)
    hatPts = [
      headX - 0.58,
      headY - 0.1,
      headX + 0.58,
      headY - 0.2,
      headX + 0.46,
      headY - 0.62,
      headX - tip * 0.3,
      headY - 0.9 - rise * 0.6,
      headX - 0.5,
      headY - 0.58,
    ];
  else if (look.hat === 2)
    hatPts = [
      headX - 0.98,
      headY - 0.16,
      headX - 0.4,
      headY - 0.3,
      headX - 0.36 - tip * 0.3,
      headY - 0.86 - rise,
      headX + 0.36 - tip * 0.3,
      headY - 0.9 - rise,
      headX + 0.42,
      headY - 0.36,
      headX + 1.02,
      headY - 0.3,
      headX,
      headY - 0.1,
    ];
  else
    hatPts = [
      headX - 0.12,
      headY + 0.5,
      headX - 0.64 - tip * 0.4,
      headY + 0.2,
      headX - 0.62,
      headY - 0.36,
      headX - 0.16,
      headY - 0.76 - rise * 0.5,
      headX + 0.44,
      headY - 0.5,
      headX + 0.2,
      headY - 0.3,
      headX - 0.12,
      headY - 0.1,
    ];
  rim(hatPts, look.hat !== 2);
  d.body(hatPts, {
    wash: hood,
    washAlpha: lerp(1, 0.92, mid),
    seed: seed + 80,
    smooth: look.hat !== 2,
  });
  if (mid > 0 && !p.flash) {
    d.strength = strength * mid;
    for (let band = 0; band < look.bands; band++) {
      const by = headY - 0.3 - band * 0.13;
      d.line(
        headX - 0.5 + band * 0.05,
        by + 0.04,
        headX + 0.48 - band * 0.08,
        by - 0.06,
        FORM,
        seed + 81 + band,
      );
    }
    d.strength = strength;
  }

  // The near arm and what it holds.
  if (armsShown > 0 || p.tool !== "none") {
    const tool = p.tool ?? look.tool;
    d.strength = strength * armsShown;
    const [hx, hy] =
      armsShown > 0
        ? limb(neckX + 0.1, shoulderY, p.arm, 0.95, CONTOUR, 2)
        : [neckX + 0.1 + Math.sin(p.arm) * 0.95, shoulderY + Math.cos(p.arm) * 0.95];
    d.strength = strength;
    const angle = p.arm + p.grip;
    const ax = Math.sin(angle);
    const ay = Math.cos(angle);
    if (tool === "blade") {
      // A long curved blade: its silhouette is what reads at the far size.
      d.curve(
        [
          hx - ax * 0.2,
          hy - ay * 0.2,
          hx + ax * 0.9 + ay * 0.1,
          hy + ay * 0.9 - ax * 0.1,
          hx + ax * 1.75,
          hy + ay * 1.75,
        ],
        CONTOUR,
        seed + 90,
      );
      if (mid > 0)
        d.line(
          hx - ay * 0.16,
          hy + ax * 0.16,
          hx + ay * 0.16,
          hy - ax * 0.16,
          CONTOUR,
          seed + 91,
          mid,
        );
    } else if (tool === "bow") {
      const bx = hx + ax * 0.1;
      const by = hy + ay * 0.1;
      d.curve(
        [
          bx - ay * 0.95,
          by + ax * 0.95,
          bx + ax * 0.42,
          by + ay * 0.42,
          bx + ay * 0.95,
          by - ax * 0.95,
        ],
        CONTOUR,
        seed + 90,
      );
      d.line(bx - ay * 0.95, by + ax * 0.95, bx + ay * 0.95, by - ax * 0.95, HAIR, seed + 91);
    } else if (tool === "sling") {
      d.curve(
        [
          hx,
          hy,
          hx + ax * 0.35 - ay * 0.2,
          hy + ay * 0.35 + ax * 0.2,
          hx + ax * 0.7,
          hy + ay * 0.7,
        ],
        FORM,
        seed + 90,
      );
      d.dot(hx + ax * 0.7, hy + ay * 0.7, Math.max(1.6, px * 0.11));
    } else if (tool === "pot") {
      d.body(d.round(hx + ax * 0.18, hy + ay * 0.18, 0.2, 0.2, 7), {
        wash: 0xd98f3e,
        washAlpha: 0.95,
        weight: FORM,
        seed: seed + 90,
      });
    } else if (tool === "hammer") {
      d.line(hx - ax * 0.15, hy - ay * 0.15, hx + ax * 0.85, hy + ay * 0.85, CONTOUR, seed + 90);
      d.body(
        [
          hx + ax * 0.7 - ay * 0.26,
          hy + ay * 0.7 + ax * 0.26,
          hx + ax * 0.7 + ay * 0.26,
          hy + ay * 0.7 - ax * 0.26,
          hx + ax * 1.02 + ay * 0.26,
          hy + ay * 1.02 - ax * 0.26,
          hx + ax * 1.02 - ay * 0.26,
          hy + ay * 1.02 + ax * 0.26,
        ],
        { smooth: false, wash: 0x5b5048, washAlpha: 0.9, weight: FORM, seed: seed + 91 },
      );
    } else if (tool === "ladle") {
      d.line(hx, hy, hx + ax * 0.95, hy + ay * 0.95, FORM, seed + 90);
      d.dot(hx + ax * 1, hy + ay * 1, Math.max(1.6, px * 0.1));
    } else if (tool === "pole") {
      d.line(hx - ax * 0.9, hy - ay * 0.9, hx + ax * 1.5, hy + ay * 1.5, CONTOUR, seed + 90);
    } else if (tool === "maul") {
      // A long haft with a block of iron at its end: the head is what reads at the far size.
      d.line(hx - ax * 0.35, hy - ay * 0.35, hx + ax * 1.35, hy + ay * 1.35, CONTOUR, seed + 90);
      const k0 = 1.1;
      const k1 = 1.62;
      d.body(
        [
          hx + ax * k0 - ay * 0.4,
          hy + ay * k0 + ax * 0.4,
          hx + ax * k0 + ay * 0.4,
          hy + ay * k0 - ax * 0.4,
          hx + ax * k1 + ay * 0.36,
          hy + ay * k1 - ax * 0.36,
          hx + ax * k1 - ay * 0.36,
          hy + ay * k1 + ax * 0.36,
        ],
        { smooth: false, spot: !ghost, weight: CONTOUR, seed: seed + 91 },
      );
    } else if (tool === "spear") {
      // A long shaft with a leaf of iron at its point.
      d.line(hx - ax * 1.0, hy - ay * 1.0, hx + ax * 2.0, hy + ay * 2.0, CONTOUR, seed + 90);
      d.body(
        [
          hx + ax * 1.9 - ay * 0.16,
          hy + ay * 1.9 + ax * 0.16,
          hx + ax * 2.5,
          hy + ay * 2.5,
          hx + ax * 1.9 + ay * 0.16,
          hy + ay * 1.9 - ax * 0.16,
        ],
        { smooth: false, spot: !ghost, weight: FORM, seed: seed + 91 },
      );
    }
    // The mitten.
    if (armsShown > 0) {
      if (near > 0) d.body(d.round(hx, hy, 0.13, 0.13, 6), { weight: FORM, seed: seed + 95 });
      else d.dot(hx, hy, Math.max(1.6, px * 0.11));
    }
  }
  d.pop();
  d.strength = strength;
  d.offset = offset;
}

/** How much of a citizen is drawn when it stands `px` frame pixels tall: 0 far, 1 mid, 2 near. */
export const detailFor = (px: number): number => clamp((px - 34) / 16) + clamp((px - 60) / 22);

/** How far above its feet the top of a citizen's hat is, as a multiple of its height: where its name goes. */
export const HAT_TOP = 1.5;
