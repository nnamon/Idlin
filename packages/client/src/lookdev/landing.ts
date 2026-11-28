// Drawing a landing (docs/art.md, sections 3, 4, 9, 10 and 11): the map, the
// city standing in it, citizens out in every direction, monsters in their
// pockets, what is in the air, numbers and markers, the black at the rim,
// the four corners and the name tags. A siege adds its shield and the horde
// pressed on it through `Stage.siege`. The scenes in expeditions.ts and
// siege.ts say what happens; this draws any moment of it.

import {
  beastPose,
  drawBrute,
  drawElite,
  drawHound,
  drawSwarm,
  inHorde,
  type Mite,
} from "./beasts.ts";
import { crewPlaces } from "./deck.ts";
import { CONTOUR, type Draw, FORM, INK, PAPER, shade } from "./draw.ts";
import {
  BLOW_CONTACT,
  detailFor,
  drawCitizen,
  HAT_TOP,
  hurt,
  type Look,
  type Pose,
  pose,
  shooting,
  standing,
  swinging,
  type Tool,
  thrown,
  walking,
} from "./figure.ts";
import {
  ACT,
  type BodyAt,
  BRUTE,
  citizenAt,
  type Fray,
  type Hit,
  HOUND,
  MITE,
  monsterAt,
  type Weapon,
} from "./fray.ts";
import {
  BURST_HOLD,
  drawBurn,
  drawBurst,
  drawMarker,
  drawNumber,
  drawPot,
  drawShaft,
  drawSlam,
  drawSpills,
  drawStone,
  drawSwing,
  drawTelegraph,
  drawUnmade,
  numberBox,
  onTwos,
  type Spill,
} from "./fx.ts";
import { clamp, easeOutBack, hash, lerp, mix } from "./geom.ts";
import {
  drawGround,
  drawShadows,
  type Landing,
  type Pocket,
  type Standing,
  standingItems,
  type View,
} from "./land.ts";
import type { Probe } from "./scenes.ts";
import {
  band,
  type Corners,
  cornerBoxes,
  drawBlack,
  drawCorners,
  drawFrameRule,
  drawPlacedTags,
  FRAME,
  figureBox,
  HALO,
  hatBox,
  headBox,
  inside,
  type PlacedTag,
  type Station,
  TAG_BIG,
  TAG_CALLED,
  TAG_SIZE,
  TagTimeline,
  type TagWant,
  tagBox,
  tagSeen,
  UP,
} from "./stage.ts";
import { measure } from "./surface.ts";
import { drawTopCity, type TopCity } from "./topcity.ts";
import type { Reveal } from "./vale.ts";

/** Sizes on a landing at its own scale, in frame pixels. */
export interface Sizes {
  citizen: number;
  mite: number;
  hound: number;
  brute: number;
  elite: number;
  stroke: number;
  rare: number;
  unique: number;
  /** A contact burst across, and a maul's ring or an elite's telegraph, wide and deep. */
  burst: number;
  ring: readonly [number, number];
  /** An arrow's shaft and streak. */
  arrow: readonly [number, number];
  /** A swing's stroke at its wet end. */
  wet: number;
}

export const MEDIUM_SIZES: Sizes = {
  citizen: 58,
  mite: 27,
  hound: 25,
  brute: 86,
  elite: 104,
  stroke: 90,
  rare: 90,
  unique: 150,
  burst: 40,
  ring: [120, 96],
  arrow: [26, 80],
  wet: 0,
};
export const LARGE_SIZES: Sizes = {
  citizen: 46,
  mite: 21,
  hound: 19.5,
  brute: 68,
  elite: 82,
  stroke: 70,
  rare: 70,
  unique: 115,
  burst: 40,
  ring: [92, 74],
  arrow: [26, 80],
  wet: 0,
};
/**
 * The mid city's landing at 23 px a tile (the art brief of 28 November on
 * #362, sections 2 and 3). Effects are sized against the 46 px citizen: a
 * stroke two and a half citizens long. A contact burst is a citizen and a
 * half across, so a blow carries at 640.
 */
export const MID_SIZES: Sizes = {
  citizen: 46,
  mite: 24,
  hound: 19.5,
  brute: 68,
  elite: 82,
  stroke: 115,
  rare: 69,
  unique: 115,
  burst: 69,
  ring: [115, 92],
  arrow: [23, 70],
  wet: 14,
};

export type Black = { kind: "edges"; alpha: number } | null;

/**
 * What a siege draws over a landing (docs/art.md, section 7, the shield):
 * `ground` after the ground and before anything that stands (lamplight, the
 * trodden ground, the black and the horde pressed on the shield's wall, the
 * foot); `items` the posts, sorted with everything else that stands;
 * `over` what lands on top (bursts on the wall, the break's drops).
 */
export interface Siege {
  ground(d: Draw, f: Frame, t: number): void;
  items(d: Draw, f: Frame, t: number): Standing[];
  over(d: Draw, f: Frame, t: number): void;
  /** Whether the map's own things at this place, in tiles, are hidden: under the black or on ground the horde has trodden. */
  covered(x: number, y: number, t: number): boolean;
  /** Whether the black covers this place: a drop there has gone under. */
  under(x: number, y: number, t: number): boolean;
  /** Whether a point on screen lies over the black, and not over the wall standing in front of it. */
  dark(f: Frame, px: number, py: number, t: number): boolean;
  /** What the capture records of a moment. */
  probe(t: number): Record<string, unknown>;
}

export interface Stage {
  land: Landing;
  fray: () => Fray;
  seconds: number;
  sizes: Sizes;
  view(t: number): View;
  /** The city as it stands at `t`, less where it is drawn. */
  city(t: number): Omit<TopCity, "ox" | "oy" | "T" | "t">;
  /** How much of the map is inked yet, during the reveal. */
  reveal?(t: number): Reveal | null;
  black(t: number): Black;
  corners(t: number): Corners;
  /** Stains from before the scene starts. */
  stains?: Spill[];
  /** Names of uniques by their marker's seed. */
  uniques?: Record<number, string>;
  /** How strong the lettering on the map is: it fades out and in during the camera move. */
  lettering?(t: number): number;
  /** Who gets a tag first when there are too many: citizen indices. */
  firstTags?(t: number): number[];
  /** A pennant on a citizen's bundle, by index. */
  pennants?: Record<number, number>;
  /** How much each citizen carries, by index. */
  hauls?: Record<number, number>;
  /** Routes drawn as a march: a citizen, from when, and the path. */
  routes?: { who: number; from: number; to: number; path: [number, number][] }[];
  /** Those aboard (by look id) who shoot from the rail or a gun post: always named. */
  shooters?(t: number): number[];
  /** Citizens out (by index) whose tags are called at `t`: 48 px, with a ring at their feet. */
  called?(t: number): number[];
  /** A citizen's height in pixels at `t`, where the scene sets it from its own camera. */
  size?(t: number): number;
  /** The monsters are the horde's: drawn in its black. */
  horde?: boolean;
  /** The shield and the horde on it, for a siege. */
  siege?: Siege;
  /** Pennants that go up during the scene: a citizen's index, from when, and its rarity. */
  pennantsFrom?: { who: number; at: number; rarity: number }[];
  /** How far a citizen out is lifted off the ground at `t`, in tiles: one hauled up on a line. */
  lift?(i: number, t: number): number;
  /** A drop that has been taken by `t`, by its marker's seed: its pole is down. */
  taken?(seed: number, t: number): boolean;
}

export interface Frame {
  v: View;
  sx: (x: number) => number;
  sy: (y: number) => number;
  /** Citizen size at this camera. */
  size: number;
  scale: number;
}

export const frameOf = (s: Stage, t: number): Frame => {
  const v = s.view(t);
  const scale = v.T / s.land.T;
  // From the close-up's 96 px a tile to the landing's own size, by whole parts as the camera moves.
  const size =
    s.size?.(t) ??
    (scale > 1
      ? lerp(s.sizes.citizen, 96, clamp((v.T - s.land.T) / (66 - s.land.T)))
      : s.sizes.citizen * scale);
  return { v, sx: (x) => v.ox + x * v.T, sy: (y) => v.oy + y * v.T, size, scale };
};

/** The tool a citizen's weapon is drawn as. */
const TOOL: Record<Weapon, Tool> = {
  blade: "blade",
  maul: "maul",
  spear: "spear",
  bow: "bow",
  sling: "sling",
  pot: "pot",
  gun: "none",
  none: "none",
};

/** How a citizen out on the landing stands, from what the script says it is doing. */
export function citizenPose(b: BodyAt, look: Look, weapon: Weapon, t: number, haul: number): Pose {
  const face = b.face || 1;
  const since = b.since;
  let p: Pose;
  switch (b.act) {
    case ACT.walk:
    case ACT.run: {
      const run = b.act === ACT.run;
      p = walking(t * (run ? 5.2 : 3.4) + look.id, run ? 2 : 1, face);
      break;
    }
    case ACT.swing: {
      // A maul's coil is longer: its beats are stretched to its contact.
      const contact = weapon === "maul" ? 0.42 : weapon === "spear" ? 0.3 : 0.23;
      const at =
        since < contact ? since * (BLOW_CONTACT / contact) : BLOW_CONTACT + (since - contact);
      p = swinging(at, face);
      if (weapon === "spear") p = { ...p, arm: lerp(p.arm, 1.6, 0.5), grip: -0.2 };
      break;
    }
    case ACT.shoot: {
      if (weapon === "pot") {
        const k = clamp(since / 0.3);
        p = pose({
          face,
          lean: lerp(-0.2, 0.3, k),
          arm: lerp(2.8, 0.6, k),
          arm2: -0.5,
          step: 0.8,
          stride: 0.25,
          trail: -0.1,
        });
      } else if (weapon === "gun")
        p = pose({ face, lean: 0.2, crouch: 0.15, arm: 1.35, arm2: 1.15 });
      else p = shooting(clamp(since / 0.15), face, since > 0.15);
      break;
    }
    case ACT.work: {
      const beat = (t * 1.3 + look.id * 0.37) % 1;
      if (haul >= 0) {
        const up = beat < 0.7 ? beat / 0.7 : 1 - (beat - 0.7) / 0.3;
        p = pose({
          face,
          lean: 0.1 + (1 - up) * 0.3,
          arm: lerp(0.9, 2.9, up),
          arm2: 0.8,
          grip: lerp(0.5, -0.2, up),
          tool: "hammer",
          crouch: (1 - up) * 0.2,
        });
      } else
        p = pose({
          face,
          crouch: 0.7,
          lean: 0.45,
          arm: 1.3 + Math.sin(t * 5) * 0.2,
          arm2: 1.0,
          tool: "none",
          nod: 0.2,
        });
      break;
    }
    case ACT.hurt:
      p = hurt(clamp(since / 0.4), face);
      break;
    case ACT.thrown:
      p = thrown(clamp(since / 0.7), face);
      break;
    case ACT.down:
      p = pose({ face, down: -1, tool: "none" });
      break;
    default:
      p = standing(look.id, t, face);
  }
  if (b.act !== ACT.work && b.act !== ACT.thrown && b.act !== ACT.down)
    p.tool = p.tool ?? TOOL[weapon];
  p.haul = Math.max(0, haul);
  return p;
}

const monsterPose = (b: BodyAt, t: number, j: number, leader = false) => {
  const since = b.since;
  const stride = (t * (b.act === ACT.chase ? 1.8 : 0.9) + j * 0.37) % 1;
  return beastPose({
    wake: b.wake,
    leader,
    face: b.face || 1,
    stride,
    speed: b.act === ACT.chase ? 1 : b.act === ACT.pace ? 0.35 : b.act === ACT.stalk ? 0.2 : 0,
    coil:
      b.act === ACT.coil
        ? clamp(since / 0.3) * 0.9
        : b.act === ACT.wind
          ? clamp(since / 0.5)
          : b.act === ACT.stalk
            ? 0.35
            : 0,
    lunge:
      b.act === ACT.lunge
        ? 0.9 * (1 - clamp((since - 0.15) / 0.3))
        : b.act === ACT.slam
          ? 1 - clamp(since / 0.6)
          : 0,
    hurt: b.act === ACT.hurt ? 1 - clamp(since / 0.35) : b.act === ACT.thrown ? 1 : 0,
    flash: (b.act === ACT.hurt || b.act === ACT.thrown) && since < 0.07,
    stretch: b.act === ACT.thrown ? 1.12 : 1,
    ink: b.ink,
    rest: b.act === ACT.sleep ? 1 : 0,
    head: b.act === ACT.gnaw || b.act === ACT.stalk ? -1 : b.act === ACT.idle ? 0.6 : 0,
  });
};

/** What a landing scene needs at a moment, without drawing: who is where, for tags, probes and tests. */
export interface Moment {
  f: Frame;
  /** Citizens out: index, feet on screen, height, and their body. */
  out: { i: number; x: number; y: number; body: BodyAt }[];
  aboard: { look: Look; x: number; y: number; size: number }[];
  labels: number[];
}

/** A number in frame. */
export interface ShownNumber {
  /** Its middle on screen. */
  x: number;
  y: number;
  value: number;
  size: number;
  crit: boolean;
  alpha: number;
  /** Where the blow was, in tiles. */
  tx: number;
  ty: number;
}

/** How long a number is up, and when it starts to go. */
const NUMBER_LIFE = 0.7;
const NUMBER_HOLD = 0.5;
/** How often what stands in a number's way is looked at over its life, in seconds. */
const NUMBER_GRID = 0.05;
/** At most this many numbers in frame. */
const NUMBERS_IN_FRAME = 24;

interface Laid {
  h: Hit;
  /** Set at 72 px: the largest blow in frame when it landed, one at a time. */
  top: boolean;
  /** Left out: a 30 px number with no free place within three citizens of its own. */
  out: boolean;
  /** Which way it rises on screen, its rise per tile of the camera, and how far on along that it was stepped, in px. */
  dir: [number, number];
  rise: number;
  step: number;
}

/** What a number keeps off at a moment: heads with their hats, figures, and boxes it never meets. */
interface Keep {
  f: Frame;
  heads: number[];
  figures: number[];
  hard: number[];
}

const meets = (b: readonly number[], list: readonly number[], pad = 0): boolean => {
  for (let k = 0; k < list.length; k += 4)
    if (
      (b[0] as number) - pad < (list[k + 2] as number) &&
      (b[2] as number) + pad > (list[k] as number) &&
      (b[1] as number) - pad < (list[k + 3] as number) &&
      (b[3] as number) + pad > (list[k + 1] as number)
    )
      return true;
  return false;
};

/** The share of box `f` that box `b` lies over. */
export const overShare = (b: readonly number[], f: readonly number[]): number => {
  const w = Math.min(b[2] as number, f[2] as number) - Math.max(b[0] as number, f[0] as number);
  const h = Math.min(b[3] as number, f[3] as number) - Math.max(b[1] as number, f[1] as number);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / (((f[2] as number) - (f[0] as number)) * ((f[3] as number) - (f[1] as number)));
};

/**
 * The numbers of a landing, each laid out once, when its blow lands (docs/art.md, section 10, and
 * the precedence on #371: a head, then its tag, then numbers, then bursts). A number starts over
 * what was struck and rises along the blow. Where that place lies over a head, more than a third
 * of a figure, a tag, a corner, a den's letters or another number at any moment of its life, it
 * steps on along the blow by half its own height, up to three citizens away. A 30 px number with
 * nowhere free is left out; a crit, a 36 and the 72 look further and in other directions. The 72
 * starts a citizen's height or more from its striker's hat, over the bodies the blow throws.
 * Laid out in the order the blows land, so a number is a function of time alone.
 */
class NumberLayout {
  private readonly hits: Hit[];
  private readonly laid: Laid[] = [];
  private readonly keeps = new Map<number, Keep>();
  private readonly s: Stage;
  private readonly keepAt: (t: number) => Omit<Keep, "f">;
  constructor(s: Stage, keepAt: (t: number) => Omit<Keep, "f">) {
    this.s = s;
    this.keepAt = keepAt;
    this.hits = s
      .fray()
      .hits.filter((h) => h.value > 0)
      .sort((a, b) => a.t - b.t || Number(b.crit) - Number(a.crit) || b.value - a.value);
  }

  private keep(g: number): Keep {
    let k = this.keeps.get(g);
    if (!k) {
      const t = g * NUMBER_GRID;
      k = { f: frameOf(this.s, t), ...this.keepAt(t) };
      this.keeps.set(g, k);
    }
    return k;
  }

  /** Where a laid number's middle is at `t`, in a frame `f`, stepped `step` px along `dir`. */
  static at(L: Laid, f: Frame, t: number, dir = L.dir, step = L.step): [number, number] {
    const age = t - L.h.t;
    const along = (1 - (1 - clamp(age / NUMBER_HOLD)) ** 3) * 0.9 * f.v.T * L.rise + step;
    return [
      f.sx(L.h.ax) + dir[0] * along,
      f.sy(L.h.ay) - f.size * (L.h.lift + 0.6) + dir[1] * along,
    ];
  }

  private lay(h: Hit, index: number): Laid {
    // The 72 is the largest blow up at any moment of its life, the earlier of two the same: the
    // blows are scripted, so the ones still to come are known. So there is one at a time.
    let top = !h.crit && h.value >= 200;
    for (let k = 0; top && k < this.hits.length; k++) {
      const o = this.hits[k] as Hit;
      if (k === index || o.crit || Math.abs(o.t - h.t) >= NUMBER_LIFE) continue;
      if (o.value > h.value || (o.value === h.value && k < index)) top = false;
    }
    const laid = this.place(h, top);
    // A 72 with nowhere free is set at 36 instead.
    return laid.step >= 0 || !top ? laid : this.place(h, false);
  }

  /** Where a number goes; `step` is -1 if nowhere was free and it is not left out. */
  private place(h: Hit, top: boolean): Laid {
    const live = this.laid.filter((q) => !q.out && h.t - q.h.t < NUMBER_LIFE);
    // A 30 px number may be set at 36 to lead its fight later, so it keeps room for that.
    const size = h.crit ? 48 : top ? 72 : 36;
    const vx = h.dx * 0.8;
    const vy = h.dy * 0.4 - 0.8;
    const rise = Math.hypot(vx, vy);
    const L: Laid = { h, top, out: false, dir: [vx / rise, vy / rise], rise, step: 0 };
    const f0 = frameOf(this.s, h.t);
    const reach = 3 * f0.size;
    const unit = size / 2;
    const g0 = Math.ceil(h.t / NUMBER_GRID - 1e-6);
    const g1 = Math.floor((h.t + NUMBER_LIFE) / NUMBER_GRID - 1e-6);
    const fray = this.s.fray();
    // The striker's hat at the blow, for the 72.
    let hat: [number, number] | null = null;
    if (top && h.who >= 0) {
      const b = citizenAt(fray, h.who, h.t);
      hat = [f0.sx(b.x), f0.sy(b.y) - f0.size * HAT_TOP];
    }
    const free = (dir: [number, number], step: number): boolean => {
      if (hat) {
        const [x, y] = NumberLayout.at(L, f0, h.t + NUMBER_HOLD, dir, step);
        const [x0, y0, x1, y1] = numberBox(x, y, h.value, size, h.crit);
        const dx = Math.max(x0 - hat[0], 0, hat[0] - x1);
        const dy = Math.max(y0 - hat[1], 0, hat[1] - y1);
        if (Math.hypot(dx, dy) < f0.size) return false;
      }
      for (let g = g0; g <= g1; g++) {
        const k = this.keep(g);
        const t = g * NUMBER_GRID;
        const [x, y] = NumberLayout.at(L, k.f, t, dir, step);
        const box = numberBox(x, y, h.value, size, h.crit);
        if (
          box[0] < FRAME.x0 + 6 ||
          box[2] > FRAME.x1 - 6 ||
          box[1] < FRAME.y0 + 6 ||
          box[3] > FRAME.y1 - 6
        )
          return false;
        if (meets(box, k.heads) || meets(box, k.hard)) return false;
        for (let q = 0; q < k.figures.length; q += 4)
          if (overShare(box, k.figures.slice(q, q + 4)) > 1 / 3) return false;
        for (const o of live) {
          if (t - o.h.t >= NUMBER_LIFE || t < o.h.t) continue;
          const [ox, oy] = NumberLayout.at(o, k.f, t);
          const osize = o.h.crit ? 48 : o.top ? 72 : 36;
          if (meets(box, numberBox(ox, oy, o.h.value, osize, o.h.crit), 3)) return false;
        }
      }
      return true;
    };
    const tryAlong = (dir: [number, number], far: number): number => {
      for (let step = 0; step <= far; step += unit) if (free(dir, step)) return step;
      return -1;
    };
    const step = tryAlong(L.dir, reach);
    if (step >= 0) return { ...L, step };
    if (size === 36 && !h.big) return { ...L, out: true };
    // Never left out: turned off the blow's line either way, near first, then further out.
    for (const far of [reach, reach * 2])
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, Math.PI]) {
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const dir: [number, number] = [L.dir[0] * c - L.dir[1] * sn, L.dir[0] * sn + L.dir[1] * c];
        const at = tryAlong(dir, far);
        if (at >= 0) return { ...L, dir, step: at };
      }
    if (top) return { ...L, step: -1 };
    // Nowhere free anywhere near: left out after all, rather than over a head or a tag.
    return { ...L, out: true };
  }

  /** The numbers in frame at `t`: at most 24, the smallest left out first and a crit never. */
  shown(t: number): ShownNumber[] {
    while (this.laid.length < this.hits.length) {
      const h = this.hits[this.laid.length] as Hit;
      if (h.t > t) break;
      this.laid.push(this.lay(h, this.laid.length));
    }
    const f = frameOf(this.s, t);
    const live = this.laid.filter((q) => !q.out && q.h.t <= t && t - q.h.t < NUMBER_LIFE);
    live.sort((a, b) => Number(b.h.crit) - Number(a.h.crit) || b.h.value - a.h.value);
    const shown = live.slice(0, NUMBERS_IN_FRAME);
    // In each fight (blows within four tiles of each other) one number is set at 36 px at least,
    // so every fight with a number has one a viewer at 640 can read: the largest first, then any
    // number with no such lead within four tiles of it.
    const leads = new Set<Laid>();
    for (const q of [...shown].sort((a, b) => b.h.value - a.h.value || a.h.t - b.h.t))
      if (![...leads].some((o) => Math.hypot(o.h.x - q.h.x, o.h.y - q.h.y) <= 4)) leads.add(q);
    return shown.map((q) => {
      const [x, y] = NumberLayout.at(q, f, t);
      return {
        x,
        y,
        value: q.h.value,
        size: q.h.crit ? 48 : q.top ? 72 : q.h.big || leads.has(q) ? 36 : 30,
        crit: q.h.crit,
        alpha: 1 - clamp((t - q.h.t - NUMBER_HOLD) / (NUMBER_LIFE - NUMBER_HOLD)),
        tx: q.h.x,
        ty: q.h.y,
      };
    });
  }
}

export function momentOf(s: Stage, t: number): Moment {
  const f = frameOf(s, t);
  const fray = s.fray();
  const out: Moment["out"] = [];
  fray.script.citizens.forEach((_, i) => {
    const b = citizenAt(fray, i, t);
    if (b.act === ACT.aboard) return;
    const z = b.z + (s.lift?.(i, t) ?? 0);
    out.push({ i, x: f.sx(b.x), y: f.sy(b.y) - z * UP * f.v.T, body: b });
  });
  const c = s.city(t);
  const aboard = crewPlaces({
    ...c,
    ox: f.sx(s.land.city.x),
    oy: f.sy(s.land.city.y),
    T: f.v.T,
    t,
  });
  const labels: number[] = [];
  for (const p of s.land.pockets)
    if (p.kind === "den") {
      const at = denLabelAt(f, p);
      const w = measure("roman", DEN_SIZE, denLabel(p));
      labels.push(
        at[0] - w / 2 - HALO,
        at[1] - DEN_SIZE * 0.78 - HALO,
        at[0] + w / 2 + HALO,
        at[1] + DEN_SIZE * 0.12 + HALO,
      );
    }
  return { f, out, aboard, labels };
}

/** A den is lettered with its letter and level, `den A 28`, at 36 px under its mouth. */
const DEN_SIZE = 36;
const denLabel = (p: Pocket): string =>
  p.letter ? `den ${p.letter} ${p.level}` : `den ${p.level}`;
const denLabelAt = (f: Frame, p: Pocket): [number, number] => [
  f.sx(p.x),
  f.sy(p.y) + 22 + 14 * Math.min(1, f.scale),
];

export interface LandingScene {
  duration: number;
  draw(d: Draw, t: number): void;
  probe(t: number): Probe & LandingProbe;
  /** The scripted fight behind it, and the map, for the tests. */
  fray(): Fray;
  land: Landing;
  /** For each citizen out in the frame drawn last: what was drawn over it, and whether it was outlined. */
  covers(): CitizenCover[];
}

/** What lies over a citizen out, as the frame was drawn. */
export interface CitizenCover {
  i: number;
  /** Its head and hat, and its figure, on screen. */
  head: [number, number, number, number];
  figure: [number, number, number, number];
  /** Of what was drawn after it, by kind: whether any lies over its head, and the share of its figure under them. */
  over: Record<MarkKind, { head: boolean; share: number }>;
  /** Drawn again on top as an outline (docs/art.md, section 4). */
  outlined: boolean;
}

export type MarkKind = "body" | "burst" | "number" | "tag";

/** Something drawn that may lie over a citizen: a box, or with `ellipse` the ellipse inside it. */
interface Mark {
  kind: MarkKind;
  box: [number, number, number, number];
  ellipse: boolean;
}

/** The share of a box, sampled on a grid, that the marks lie over, and whether any lies over `head`. */
function shareUnder(
  marks: readonly Mark[],
  from: number,
  kind: MarkKind,
  figure: readonly number[],
  head: readonly number[],
): { head: boolean; share: number } {
  const near: Mark[] = [];
  for (let k = from; k < marks.length; k++) {
    const m = marks[k] as Mark;
    if (m.kind === kind && overShare(m.box, figure) > 0) near.push(m);
  }
  if (near.length === 0) return { head: false, share: 0 };
  const inside = (m: Mark, x: number, y: number): boolean => {
    const [x0, y0, x1, y1] = m.box;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    if (!m.ellipse) return true;
    const rx = (x1 - x0) / 2;
    const ry = (y1 - y0) / 2;
    return ((x - x0 - rx) / rx) ** 2 + ((y - y0 - ry) / ry) ** 2 <= 1;
  };
  const sample = (b: readonly number[], cols: number, rows: number): number => {
    let n = 0;
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        const x = lerp(b[0] as number, b[2] as number, (c + 0.5) / cols);
        const y = lerp(b[1] as number, b[3] as number, (r + 0.5) / rows);
        if (near.some((m) => inside(m, x, y))) n++;
      }
    return n / (cols * rows);
  };
  return { head: sample(head, 4, 5) > 0, share: sample(figure, 6, 12) };
}

/**
 * A monster's body for the cover test, as the ellipse it mostly fills: a mite `size` long, a
 * hound `size` at the shoulder, a brute or an elite `size` tall, with its feet at (x, y).
 */
const bodyBox = (kind: number, x: number, y: number, size: number): Mark["box"] =>
  kind === MITE
    ? [x - size * 0.6, y - size * 0.95, x + size * 0.6, y]
    : kind === HOUND
      ? [x - size * 0.95, y - size * 1.25, x + size * 0.95, y]
      : kind === BRUTE
        ? [x - size * 0.5, y - size * 1.1, x + size * 0.5, y]
        : [x - size * 0.8, y - size * 1.05, x + size * 0.8, y];

/** What the tests ask of a landing at a moment. */
export interface LandingProbe {
  /** Monsters alive, on screen; and how many of them are awake. */
  monsterPoints: number[];
  awake: number;
  /** Pockets on screen, and where the hull's middle is. */
  pocketPoints: number[];
  hull: [number, number];
  /** What a siege says of the moment: its shield and the horde on it. */
  extra?: Record<string, unknown>;
  /** Shots in the air, and bodies thrown into it. */
  shots: number;
  airborne: number;
  /** The numbers in frame: where on screen, how big, and where the blow was on the map. */
  numbers: { x: number; y: number; size: number; tx: number; ty: number; value: number }[];
}

export function landingScene(s: Stage): LandingScene {
  const out40 = s.fray().script.citizens.length > 40;
  const tags = new TagTimeline((t) => {
    const m = momentOf(s, t);
    const fray = s.fray();
    const taken = cornerBoxes(s.corners(t));
    // No tag lies over a citizen out, its own or another's, nor over a head aboard.
    for (const o of m.out) taken.push(...figureBox(o.x, o.y, m.f.size));
    for (const a of m.aboard) taken.push(...headBox(a.x, a.y, a.size));
    // A den's mound and mouth are never under a tag.
    for (const p of s.land.pockets)
      if (p.kind === "den") {
        const x = m.f.sx(p.x);
        const y = m.f.sy(p.y);
        const T = m.f.v.T;
        taken.push(x - 2.5 * T, y - 2.2 * UP * T, x + 2.5 * T, y + 0.2 * T);
      }
    // Den letters are kept clear where there is room, but a tag may lie over one. Numbers give way
    // to tags, so a tag does not move for them.
    const soft = [...m.labels];
    const wants: TagWant[] = [];
    // A tag is 36 px on a landing while 20 or fewer are out, and 30 px with more.
    const usual = m.out.length <= 20 ? TAG_BIG : TAG_SIZE;
    const called = new Set(s.called?.(t) ?? []);
    const add = (
      key: number,
      x: number,
      y: number,
      size: number,
      look: Look,
      tag: number,
      call = false,
    ): void => {
      wants.push({
        key,
        x,
        y: y - size * HAT_TOP,
        name: look.name,
        rgb: look.cloak,
        size: call ? TAG_CALLED : tag,
        called: call,
        feet: [x, y, size],
      });
    };
    let order = m.out.map((o) => o.i);
    if (out40) {
      // More than forty out: at most 24 tags. Called ones, then the log, a pennant, a down, a
      // fight with something big; then whoever has gone longest without, changing every five seconds.
      const first = new Set(s.firstTags?.(t) ?? []);
      const turn = Math.floor((t + 2.5) / 5);
      order.sort(
        (a, b) =>
          Number(called.has(b)) - Number(called.has(a)) ||
          Number(first.has(b)) - Number(first.has(a)) ||
          ((a + turn * 37) % 151) - ((b + turn * 37) % 151),
      );
      // At most 24 tags in all: the four aboard take their share.
      order = order.slice(0, 20);
    }
    for (const i of order) {
      const o = m.out.find((q) => q.i === i) as Moment["out"][number];
      add(
        i,
        o.x,
        o.y,
        m.f.size,
        (fray.script.citizens[i] as { look: Look }).look,
        usual,
        called.has(i),
      );
    }
    // Aboard on a landing: those shooting are named, and the rest take turns, four at a time.
    const shooters = new Set(s.shooters?.(t) ?? []);
    const turn = Math.floor(t / 5);
    const rest = m.aboard.filter((a) => !shooters.has(a.look.id));
    const named =
      m.f.scale > 1.6
        ? m.aboard
        : [
            ...m.aboard.filter((a) => shooters.has(a.look.id)),
            ...rest.filter(
              (_, k) => rest.length <= 4 || Math.floor(k / 4) === turn % Math.ceil(rest.length / 4),
            ),
          ];
    if (m.aboard.length <= 40 || m.f.scale > 1.6)
      for (const a of named)
        add(1000 + a.look.id, a.x, a.y, a.size, a.look, m.f.scale > 1.6 ? TAG_SIZE : usual);
    return { wants, taken, must: !out40, soft, homes: true };
  });

  // What a number keeps off at a moment: every head and hat, every figure out and aboard, the
  // tags as laid out then, the corners and the dens' letters.
  const numbers = new NumberLayout(s, (t) => {
    const m = momentOf(s, t);
    const heads: number[] = [];
    const figures: number[] = [];
    for (const o of m.out) {
      heads.push(...hatBox(o.x, o.y, m.f.size));
      figures.push(...figureBox(o.x, o.y, m.f.size));
    }
    for (const a of m.aboard) {
      heads.push(...hatBox(a.x, a.y, a.size));
      figures.push(...figureBox(a.x, a.y, a.size));
    }
    const hard = [...cornerBoxes(s.corners(t)), ...m.labels];
    for (const tag of tags.get(t))
      if (tagSeen(tag) > 0) hard.push(...tagBox(tag.cx, tag.base, tag.w, tag.size));
    return { heads, figures, hard };
  });
  let drawn: CitizenCover[] = [];

  const draw = (d: Draw, t: number): void => {
    const fray = s.fray();
    const m = momentOf(s, t);
    const { f } = m;
    const v = f.v;
    const r = s.reveal?.(t) ?? null;
    const shown = (x: number, y: number): number => (r ? r.ink(x, y) : 1);
    const lettering = s.lettering?.(t) ?? 1;
    const T = v.T;
    const strength = d.strength;

    drawGround(d, s.land, v, r ?? undefined);

    // Ink on the ground: stains from before, and what the fighting has spilt.
    const spills: Spill[] = [...(s.stains ?? []).map((st) => ({ ...st, age: st.age + t }))];
    for (const k of fray.kills) {
      if (k.t > t) break;
      const delay = k.kind === MITE ? 0 : k.kind === HOUND ? 0.5 : k.kind === BRUTE ? 0.7 : 1.4;
      if (t - k.t < delay) continue;
      spills.push({
        x: k.x,
        y: k.y,
        dx: k.dx,
        dy: k.dy,
        age: t - k.t - delay,
        rank: k.kind === MITE ? 0 : k.kind === HOUND ? 1 : 2,
        seed: k.seed,
      });
    }
    d.push();
    d.move(v.ox, v.oy);
    d.scale(T);
    drawSpills(d, spills, spills.length);
    // Burns where firepots landed.
    for (const b of fray.burns) {
      if (b.t > t || t - b.t > 3) continue;
      d.push();
      d.move(b.x, b.y);
      d.scale(0.9, 0.72);
      drawBurn(d, 0, 0, t - b.t, Math.round(b.x * 13));
      d.pop();
    }
    d.pop();
    // Heavy blows coming: the telegraph fills a stroke at a time.
    // Sized against the citizen: an elite's telegraph and a maul's ring at the stage's ring size.
    const [ringW, ringH] = s.sizes.ring;
    for (const tg of fray.telegraphs) {
      if (t < tg.t0 || t > tg.t1 + 0.05) continue;
      drawTelegraph(
        d,
        f.sx(tg.x),
        f.sy(tg.y),
        ringW * (tg.w / 4) * f.scale,
        ringH * (tg.w / 4) * f.scale,
        (t - tg.t0) / (tg.t1 - tg.t0),
        Math.round(tg.x * 7),
      );
    }
    for (const sl of fray.slams)
      drawSlam(
        d,
        f.sx(sl.x),
        f.sy(sl.y),
        ringW * (sl.w / 3) * f.scale,
        ringH * (sl.h / 2.4) * f.scale,
        t - sl.t,
        Math.round(sl.x * 11),
      );
    drawShadows(d, s.land, v, r ?? undefined);

    // A siege lays its lamplight, the black and the horde on the shield before anything stands.
    // What the black covers on the map is not drawn.
    const black = s.black(t);
    s.siege?.ground(d, f, t);
    const covered = (x: number, y: number): boolean => s.siege?.covered(x, y, t) ?? false;

    // Routes drawn as a march: dashes along the path, the end cross in the walker's colour.
    for (const route of s.routes ?? []) {
      if (t < route.from || t > route.to) continue;
      const look = (fray.script.citizens[route.who] as { look: Look }).look;
      const body = citizenAt(fray, route.who, t);
      const pts: [number, number][] = [
        [body.x, body.y],
        ...route.path.filter(
          (p) =>
            (p[0] - body.x) * (route.path[route.path.length - 1] as [number, number])[0] >= -999,
        ),
      ];
      for (let k = 0; k + 1 < pts.length; k++) {
        const [ax, ay] = pts[k] as [number, number];
        const [bx, by] = pts[k + 1] as [number, number];
        const len = Math.hypot(bx - ax, by - ay);
        for (let u = 0; u < len; u += 0.7) {
          const e = Math.min(len, u + 0.35);
          d.line(
            f.sx(ax + ((bx - ax) * u) / len),
            f.sy(ay + ((by - ay) * u) / len),
            f.sx(ax + ((bx - ax) * e) / len),
            f.sy(ay + ((by - ay) * e) / len),
            FORM,
            k * 31 + Math.round(u * 10),
          );
        }
      }
      const [ex, ey] = route.path[route.path.length - 1] as [number, number];
      const ink = d.ink;
      d.ink = shade(look.cloak, 0.2);
      d.line(f.sx(ex) - 8, f.sy(ey) - 6, f.sx(ex) + 8, f.sy(ey) + 6, CONTOUR, 77);
      d.line(f.sx(ex) - 8, f.sy(ey) + 6, f.sx(ex) + 8, f.sy(ey) - 6, CONTOUR, 78);
      d.ink = ink;
    }

    // What is drawn from here on that may lie over a citizen, in the order it is drawn.
    const marks: Mark[] = [];
    // Bursts where blows land: on what was struck, and under the citizens of the fight, so a
    // citizen always lies over its own blow's burst (the precedence on #371: a head, its tag,
    // numbers, then bursts).
    for (const h of fray.hits) {
      if (h.t > t) break;
      if (t - h.t > BURST_HOLD) continue;
      const across = s.sizes.burst * Math.min(1, f.scale);
      const x = f.sx(h.ax);
      const y = f.sy(h.ay) - f.size * h.lift;
      drawBurst(d, x, y, t - h.t, across, Math.round(h.t * 97));
      const r = across * 1.2;
      marks.push({ kind: "burst", box: [x - r, y - r, x + r, y + r], ellipse: true });
    }

    // Strokes of blows, under the bodies that made them.
    const lift = (f.size * 0.45) / T;
    d.push();
    d.move(v.ox, v.oy);
    d.scale(T);
    for (const b of fray.blows) {
      if (b.contact > t + 0.01) break;
      const age = t - b.contact;
      if (age > 0.42 || b.weapon !== "blade") continue;
      const look = (fray.script.citizens[b.who] as { look: Look }).look;
      const radius = s.sizes.stroke / (2.0 * s.land.T);
      drawSwing(
        d,
        b.x,
        b.y - lift,
        radius,
        Math.atan2(b.dy, b.dx),
        2.0,
        age,
        look.cloak,
        b.who * 17 + Math.round(b.contact * 10),
        s.sizes.wet,
      );
    }
    d.pop();
    for (const th of fray.thrusts) {
      const age = t - th.t;
      if (age < 0 || age > 0.25) continue;
      const who = fray.blows.find((b) => Math.abs(b.contact - th.t) < 1e-6 && b.weapon === "spear");
      const look = who ? (fray.script.citizens[who.who] as { look: Look }).look : null;
      const held = onTwos(age);
      const x0 = f.sx(th.x0);
      const y0 = f.sy(th.y0) - f.size * 0.45;
      const x1 = f.sx(th.x1);
      const y1 = f.sy(th.y1) - f.size * 0.45;
      const nx = -(y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
      const ny = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0);
      d.strength = strength * (1 - held / 0.25);
      d.surface.poly(
        [
          x0 + nx * 2,
          y0 + ny * 2,
          x1 + nx * 6,
          y1 + ny * 6,
          x1 + (x1 - x0) * 0.04,
          y1 + (y1 - y0) * 0.04,
          x1 - nx * 6,
          y1 - ny * 6,
          x0 - nx * 2,
          y0 - ny * 2,
        ],
        5,
        mix(look?.cloak ?? INK, INK, 0.3),
        d.strength,
      );
      d.strength = strength;
    }

    // ---- Everything that stands, sorted by its feet.
    const items = standingItems(d, s.land, v, r ?? undefined, (p) => {
      const ch = (fray.script.chests ?? []).find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 2);
      return ch ? clamp((t - ch.at) / 0.4) : 0;
    }).filter((it) => !covered(it.x, it.y));
    if (s.siege) items.push(...s.siege.items(d, f, t));
    let hull: number[] = [];
    const city = s.city(t);
    items.push({
      x: Number.NaN,
      y: s.land.city.y + 2.5,
      draw: () => {
        const drawn = drawTopCity(d, {
          ...city,
          ox: f.sx(s.land.city.x),
          oy: f.sy(s.land.city.y),
          T,
          t,
        });
        hull = drawn.hull;
      },
    });
    const behind: number[] = [];
    // Where each citizen out comes in the marks, as it is drawn.
    const starts = new Map<number, number>();
    for (const o of m.out) {
      const plan = fray.script.citizens[o.i] as { look: Look; weapon: Weapon };
      items.push({
        x: o.body.x,
        y: o.body.y,
        draw: () => {
          starts.set(o.i, marks.length);
          const haul =
            s.hauls?.[o.i] ?? (o.body.act === ACT.work && plan.weapon !== "none" ? 0 : 0);
          const p = citizenPose(
            o.body,
            plan.look,
            plan.weapon,
            t,
            o.body.act === ACT.work && isChest(fray, o.i, t) ? -1 : haul,
          );
          const k = shown(o.body.x, o.body.y);
          d.strength = strength * k;
          if (o.body.z > 0.02) {
            // In the air above its shadow.
            d.fill(
              d.round(f.sx(o.body.x) + 4, f.sy(o.body.y) + 2, f.size * 0.3, f.size * 0.09, 8),
              INK,
              0.3,
            );
          }
          drawCitizen(d, plan.look, p, o.x, o.y, f.size, detailFor(f.size));
          const pen =
            s.pennants?.[o.i] ?? s.pennantsFrom?.find((q) => q.who === o.i && q.at <= t)?.rarity;
          if (pen !== undefined) {
            const u = f.size / 3;
            const bx = o.x - u * 0.9 * (o.body.face || 1);
            const by = o.y - u * 2.6;
            d.line(bx, by + u * 0.5, bx, by - u * 1.2, FORM, 77);
            d.body(
              [
                bx,
                by - u * 1.2,
                bx - u * 1.1 * (o.body.face || 1),
                by - u * 0.95,
                bx - u * 0.8 * (o.body.face || 1),
                by - u * 0.8,
                bx - u * 1.1 * (o.body.face || 1),
                by - u * 0.6,
                bx,
                by - u * 0.65,
              ],
              {
                smooth: false,
                wash: [0, 0x3e70a2, 0xd79a1e, 0xd9622b][pen] as number,
                washAlpha: 1,
                weight: FORM,
                seed: 78,
              },
            );
          }
          d.strength = strength;
          if (o.body.y < s.land.city.y + 2.5) behind.push(o.i);
        },
      });
    }
    // Monsters: hounds, brutes and elites singly; each swarm as one drawing at its middle.
    const swarms = new Map<number, { mites: Mite[]; y: number; n: number }>();
    fray.script.monsters.forEach((plan, j) => {
      const b = monsterAt(fray, j, t);
      if (b.act === ACT.hidden) return;
      const sx = f.sx(b.x);
      const sy = f.sy(b.y);
      const dead = b.act === ACT.dead;
      if (plan.kind === MITE) {
        if (dead) return;
        let g = swarms.get(plan.group);
        if (!g) {
          g = { mites: [], y: 0, n: 0 };
          swarms.set(plan.group, g);
        }
        g.mites.push({
          x: sx,
          y: sy,
          face: b.face || 1,
          phase: t * 3 + j * 0.37,
          stretch: 1 + (j % 3) * 0.05 + (b.act === ACT.thrown ? 0.2 : 0),
          flash: (b.act === ACT.hurt || b.act === ACT.thrown) && b.since < 0.08,
          seed: j,
          build: j % 3,
          z: b.z * UP * T,
          lunge: b.act === ACT.lunge ? 1 - clamp(b.since / 0.25) : 0,
          wake: b.wake,
          leader: plan.leader === true,
        });
        g.y += b.y;
        g.n++;
        return;
      }
      const size =
        (plan.kind === HOUND
          ? s.sizes.hound * (plan.leader ? 1.15 : 1)
          : plan.kind === BRUTE
            ? s.sizes.brute
            : s.sizes.elite) * f.scale;
      if (dead) {
        const dur = plan.kind === HOUND ? 0.5 : plan.kind === BRUTE ? 0.7 : 1.4;
        if (b.since > dur) return;
        items.push({
          x: b.x,
          y: b.y,
          draw: () => {
            d.push();
            d.move(sx, sy);
            d.scale(size);
            drawUnmade(
              d,
              0,
              0,
              plan.kind === HOUND ? 1.4 : 1.0,
              0.6,
              -0.2,
              clamp(b.since / dur),
              j,
            );
            d.pop();
          },
        });
        return;
      }
      items.push({
        x: b.x,
        y: b.y,
        draw: () => {
          const k = shown(b.x, b.y);
          if (k <= 0.01) return;
          const p = monsterPose(b, t, j, plan.leader === true);
          const rise = b.act === ACT.rise ? clamp(b.since / 0.6) : 1;
          d.strength = strength * clamp(k * 2) * (b.act === ACT.rise ? clamp(rise * 1.5) : 1);
          d.push();
          d.move(sx, sy - b.z * UP * T);
          d.scale(1, (r ? easeOutBack(clamp(k), 1.6) : 1) * rise);
          if (b.z > 0.02) d.turn(-0.4 * (b.face || 1));
          const body = (): void => {
            if (plan.kind === HOUND) drawHound(d, 0, 0, size, p, plan.build, j * 11 + 3);
            else if (plan.kind === BRUTE) drawBrute(d, 0, 0, size, p, j * 11 + 3);
            else drawElite(d, 0, 0, size, p, j * 11 + 3);
          };
          if (s.horde) inHorde(body);
          else body();
          d.pop();
          d.strength = strength;
          marks.push({
            kind: "body",
            box: bodyBox(plan.kind, sx, sy - b.z * UP * T, size * (b.z > 0.02 ? 1.5 : 1)),
            ellipse: true,
          });
        },
      });
    });
    for (const [group, g] of swarms) {
      // A swarm is one drawing, sorted at its middle row; one with a citizen among it is sorted
      // at its rearmost body, so it never comes down over a citizen standing in it.
      let y = g.y / g.n;
      let x0 = Number.POSITIVE_INFINITY;
      let x1 = Number.NEGATIVE_INFINITY;
      let y0 = Number.POSITIVE_INFINITY;
      let y1 = Number.NEGATIVE_INFINITY;
      for (const mt of g.mites) {
        x0 = Math.min(x0, mt.x);
        x1 = Math.max(x1, mt.x);
        y0 = Math.min(y0, mt.y);
        y1 = Math.max(y1, mt.y);
      }
      const reach = f.size;
      if (m.out.some((o) => o.x > x0 - reach && o.x < x1 + reach && o.y > y0 && o.y < y1 + reach))
        y = (y0 - v.oy) / T - 0.01;
      items.push({
        x: Number.NaN,
        y,
        draw: () => {
          const k = r
            ? shown(
                fray.script.groups[group]?.home[0] ?? 0,
                fray.script.groups[group]?.home[1] ?? 0,
              )
            : 1;
          if (k <= 0.01) return;
          d.strength = strength * clamp(k * 2);
          const size = s.sizes.mite * f.scale;
          const body = (): void => drawSwarm(d, g.mites, g.mites.length, size);
          if (s.horde) inHorde(body);
          else body();
          d.strength = strength;
          // A body thrown into the air is drawn stretched and turned, so it covers more.
          for (const mt of g.mites) {
            const s = size * (mt.leader ? 1.3 : 1) * ((mt.z ?? 0) > 0 ? 2 : mt.stretch);
            marks.push({
              kind: "body",
              box: bodyBox(MITE, mt.x, mt.y - (mt.z ?? 0), s),
              ellipse: true,
            });
          }
        },
      });
    }
    // Markers stand taller than a figure.
    for (const mk of fray.markers) {
      if (mk.t > t || s.taken?.(mk.seed, t) || s.siege?.under(mk.x, mk.y, t)) continue;
      items.push({
        x: mk.x,
        y: mk.y,
        draw: () => {
          const tall = mk.rarity === 3 ? s.sizes.unique : mk.rarity === 2 ? s.sizes.rare : 28;
          drawMarker(
            d,
            f.sx(mk.x),
            f.sy(mk.y),
            mk.rarity,
            tall * Math.min(1, f.scale),
            t - mk.t,
            t,
            mk.seed,
            s.uniques?.[mk.seed] ?? "",
          );
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) {
      item.draw();
      for (const box of item.covers?.() ?? []) marks.push({ kind: "body", box, ellipse: false });
    }

    // Anyone the hull covers, again on top as an outline in its cloak colour.
    if (hull.length > 0)
      for (const i of behind) {
        const o = m.out.find((q) => q.i === i) as Moment["out"][number];
        const headY = o.y - f.size * 0.8;
        if (!inside(hull, o.x, headY) && !inside(hull, o.x, o.y - f.size * 0.4)) continue;
        const plan = fray.script.citizens[i] as { look: Look; weapon: Weapon };
        const p = { ...citizenPose(o.body, plan.look, plan.weapon, t, 0), outline: true };
        const ink = d.ink;
        d.ink = shade(plan.look.cloak, 0.25);
        drawCitizen(d, plan.look, p, o.x, o.y, f.size, detailFor(f.size));
        d.ink = ink;
      }

    // ---- In the air: shots, and bursts where blows land.
    for (const sh of fray.shots) {
      if (sh.t0 > t) break;
      if (sh.t1 <= t) continue;
      const u = (t - sh.t0) / (sh.t1 - sh.t0);
      const x = lerp(sh.x0, sh.x1, u);
      const y = lerp(sh.y0, sh.y1, u);
      const arc = sh.weapon === "bow" ? 0.6 : sh.weapon === "gun" ? 0.2 : 1.6;
      const z = sh.z0 * (1 - u) + Math.sin(u * Math.PI) * arc;
      const px = f.sx(x);
      const py = f.sy(y);
      const height = z * UP * T;
      const dx = (sh.x1 - sh.x0) * T;
      const dy = (sh.y1 - sh.y0) * T - Math.cos(u * Math.PI) * arc * UP * T * 0.5;
      if (sh.weapon === "bow" || sh.weapon === "gun")
        drawShaft(
          d,
          px,
          py,
          height,
          dx,
          dy,
          sh.rgb,
          sh.weapon === "gun",
          Math.round(sh.t0 * 100),
          s.sizes.arrow,
        );
      else if (sh.weapon === "sling") drawStone(d, px, py, height);
      else drawPot(d, px, py, height, dx, dy, t, Math.round(sh.t0 * 100));
    }
    s.siege?.over(d, f, t);

    // ---- Numbers, laid out off heads, figures, tags and each other; over the black in paper.
    for (const n of numbers.shown(t)) {
      const onBlack =
        (s.siege?.dark(f, n.x, n.y, t) ?? false) ||
        (black?.kind === "edges" &&
          black.alpha > 0.5 &&
          (n.x < FRAME.x0 + 52 ||
            n.x > FRAME.x1 - 52 ||
            n.y < FRAME.y0 + 52 ||
            n.y > FRAME.y1 - 52));
      drawNumber(d, n.x, n.y, n.value, n.size, n.crit, n.alpha, onBlack);
      marks.push({
        kind: "number",
        box: numberBox(n.x, n.y, n.value, n.size, n.crit),
        ellipse: false,
      });
    }

    // ---- Den labels, as the ink reaches them; lettering is never scaled.
    for (const p of s.land.pockets) {
      if (p.kind !== "den" || covered(p.x, p.y)) continue;
      const a = lettering * clamp((shown(p.x, p.y) - 0.6) / 0.4);
      if (a <= 0.01) continue;
      const [lx, ly] = denLabelAt(f, p);
      d.text(denLabel(p), lx, ly, { size: DEN_SIZE, align: 0.5, halo: 1, reach: HALO, alpha: a });
    }

    // ---- Anyone a body in front covers, its head or over a third of it, again on top as an
    // outline in its cloak colour with its head in paper (docs/art.md, section 4).
    const outlined = new Set<number>();
    for (const o of m.out) {
      const from = starts.get(o.i);
      if (from === undefined) continue;
      const under = shareUnder(
        marks,
        from,
        "body",
        figureBox(o.x, o.y, f.size),
        hatBox(o.x, o.y, f.size),
      );
      if (!under.head && under.share <= 1 / 3) continue;
      outlined.add(o.i);
      const plan = fray.script.citizens[o.i] as { look: Look; weapon: Weapon };
      const p = { ...citizenPose(o.body, plan.look, plan.weapon, t, 0), outline: true };
      const ink = d.ink;
      d.ink = shade(plan.look.cloak, 0.25);
      d.strength = strength * shown(o.body.x, o.body.y);
      drawCitizen(d, plan.look, p, o.x, o.y, f.size, detailFor(f.size));
      d.strength = strength;
      d.ink = ink;
    }

    // ---- The black at the rim.
    if (black?.kind === "edges") drawTheBlack(d, s, f, black, t);

    const corners = s.corners(t);
    drawCorners(d, corners);
    const placed = tags.get(t);
    drawPlacedTags(d, placed, lettering);
    for (const tag of placed)
      if (tagSeen(tag) * lettering > 0.01)
        marks.push({ kind: "tag", box: tagBox(tag.cx, tag.base, tag.w, tag.size), ellipse: false });
    drawFrameRule(d);

    drawn = [];
    for (const o of m.out) {
      const from = starts.get(o.i);
      if (from === undefined) continue;
      const figure = figureBox(o.x, o.y, f.size);
      const head = hatBox(o.x, o.y, f.size);
      const over = {} as CitizenCover["over"];
      for (const kind of ["body", "burst", "number", "tag"] as const)
        over[kind] = shareUnder(marks, from, kind, figure, head);
      drawn.push({ i: o.i, head, figure, over, outlined: outlined.has(o.i) });
    }
  };

  return {
    duration: s.seconds,
    draw,
    fray: s.fray,
    land: s.land,
    covers: () => drawn,
    probe(t: number) {
      const fray = s.fray();
      const m = momentOf(s, t);
      const monsterPoints: number[] = [];
      let awake = 0;
      fray.script.monsters.forEach((_, j) => {
        const b = monsterAt(fray, j, t);
        if (b.act === ACT.dead || b.act === ACT.hidden) return;
        monsterPoints.push(m.f.sx(b.x), m.f.sy(b.y));
        if (b.wake > 1.5) awake++;
      });
      return {
        out: m.out.length,
        aboard: s.city(t).crew.length,
        monsters: monsterPoints.length / 2,
        awake,
        citizens: [
          ...m.out.map((o) => ({ key: o.i, x: o.x, y: o.y, size: m.f.size, outside: true })),
          ...m.aboard.map((a) => ({
            key: 1000 + a.look.id,
            x: a.x,
            y: a.y,
            size: a.size,
            outside: false,
          })),
        ],
        // Laid out only when asked for: a tag's place depends on every frame before it.
        get tags(): readonly PlacedTag[] {
          return tags.get(t);
        },
        monsterPoints,
        pocketPoints: s.land.pockets.flatMap((p) => [m.f.sx(p.x), m.f.sy(p.y)]),
        hull: [m.f.sx(s.land.city.x), m.f.sy(s.land.city.y)] as [number, number],
        ...(s.siege ? { extra: s.siege.probe(t) } : {}),
        numbers: numbers
          .shown(t)
          .map((n) => ({ x: n.x, y: n.y, size: n.size, tx: n.tx, ty: n.ty, value: n.value })),
        shots: fray.shots.filter((sh) => sh.t0 <= t && sh.t1 > t).length,
        airborne:
          m.out.filter((o) => o.body.z > 0.05).length +
          fray.script.monsters.filter((_, j) => monsterAt(fray, j, t).z > 0.05).length,
      };
    },
  };
}

const isChest = (f: Fray, i: number, t: number): boolean => {
  const plan = f.script.citizens[i];
  if (!plan) return false;
  for (let k = plan.orders.length - 1; k >= 0; k--) {
    const o = plan.orders[k];
    if (o && o.t <= t) return "work" in o && o.kind === "chest";
  }
  return false;
};

/** The black at the rim, with the drowned map showing through as paper lines. */
function drawTheBlack(d: Draw, s: Stage, f: Frame, black: NonNullable<Black>, t: number): void {
  if (black.alpha <= 0.01) return;
  const box = { x0: FRAME.x0, y0: FRAME.y0, x1: FRAME.x1, y1: FRAME.y1 };
  const stations: Station[][] = (["n", "e", "s", "w"] as const).map((e, k) =>
    band(box, e, 60, 7 + k * 10),
  );
  for (const [k, st] of stations.entries()) drawBlack(d, st, t, 7 + k * 10, black.alpha);
  drawDrowned(d, s.land, f, black.alpha, (x, y) => {
    const px = f.sx(x);
    const py = f.sy(y);
    return px < FRAME.x0 + 52 || px > FRAME.x1 - 52 || py < FRAME.y0 + 52 || py > FRAME.y1 - 52;
  });
}

/**
 * What the black has covered on the map, over two tiles tall, still shows the
 * top of its outline as paper lines: tree crowns, the tops of woods and
 * crags, den mounds. `covered` says, in tiles, where the black is.
 */
export function drawDrowned(
  d: Draw,
  land: Landing,
  f: Frame,
  alpha: number,
  covered: (x: number, y: number) => boolean,
): void {
  const strength = d.strength;
  const ink = d.ink;
  d.ink = PAPER;
  d.strength = strength * alpha * 0.42;
  const T = f.v.T;
  for (const [x, y, kind, size] of land.things) {
    if (kind > 4 && kind !== 7 && kind !== 11) continue;
    if (size < 2 || !covered(x, y)) continue;
    const px = f.sx(x);
    const py = f.sy(y);
    const h = size * T * UP * 0.85;
    const w = size * T * 0.3;
    // The top of a crown: lobes, not a smooth hump.
    const seed = Math.round(x * 17 + y);
    const crown: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const a = Math.PI + (k / 8) * Math.PI;
      const lobe = k % 2 ? 0.86 : 1;
      crown.push(
        px + Math.cos(a) * w * lobe,
        py - h * 0.62 + Math.sin(a) * h * 0.4 * lobe * (0.9 + hash(k, seed) * 0.2),
      );
    }
    d.curve(crown, FORM, seed);
  }
  for (const mass of land.masses) {
    const b = mass.base;
    for (let i = 0; i + 2 < b.length; i += 2) {
      const x = b[i] as number;
      const y = b[i + 1] as number;
      if (!covered(x, y)) continue;
      const x1 = b[i + 2] as number;
      const y1 = b[i + 3] as number;
      const h = mass.height * T * UP * (0.75 + hash(i, mass.seed) * 0.3);
      d.curve(
        [
          f.sx(x),
          f.sy(y) - h * 0.85,
          f.sx((x + x1) / 2),
          f.sy((y + y1) / 2) - h,
          f.sx(x1),
          f.sy(y1) - h * 0.8,
        ],
        FORM,
        mass.seed + i,
      );
    }
  }
  for (const p of land.pockets) {
    if (p.kind !== "den" || !covered(p.x, p.y)) continue;
    const px = f.sx(p.x);
    const py = f.sy(p.y);
    d.curve(
      [
        px - 2.2 * T,
        py,
        px - 1.6 * T,
        py - 1.6 * T * UP * 0.6,
        px,
        py - 2 * T * UP * 0.6,
        px + 1.5 * T,
        py - 1.7 * T * UP * 0.6,
        px + 2.3 * T,
        py,
      ],
      FORM,
      p.n * 7,
    );
  }
  d.ink = ink;
  d.strength = strength;
}
