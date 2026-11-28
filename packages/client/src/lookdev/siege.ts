// The shield siege on the mid city's landing (the art director's siege brief
// on #362 with the conductor's corrections; docs/art.md, sections 7 and 11).
// The shield is an ink dome standing on lamp posts. It is one strength pool
// and the whole dome collapses at once when the pool runs out, so until the
// break there are no gaps and the horde is held at the wall all round. Each
// post has a condition that hits on its arc wear down; a post whose condition
// is gone is dark, its arc drawn unlit and cracked, and hits there take three
// times as much off the pool. The corner shows lamps lit of posts and how
// many it is losing a minute; it has no clock from the march to the break.
//
// The scene is a minute: the march's last six tiles (0 to 10 s), the siege
// (14 to 42 s), the break at 42 s and the run aboard. Citizens and the fights
// they are in are a script for fray.ts; the shield, the press of the horde,
// the heap on the wall and the swarms crossing to it are drawn here, each a
// function of time.

import {
  beastPose,
  drawBrute,
  drawElite,
  drawHound,
  drawSwarm,
  inHorde,
  type Mite,
} from "./beasts.ts";
import { itemInk } from "./deck.ts";
import { CONTOUR, type Draw, FORM, HAIR, HEAVY, INK, PAPER, shade } from "./draw.ts";
import { crowdOf, expeditionLanding, LANDED, MARCH, WEAPONS } from "./expeditions.ts";
import { detailFor, drawCitizen, type Look, pose, standing } from "./figure.ts";
import {
  aliveAt,
  BRUTE,
  type CitizenPlan,
  ELITE,
  type Fray,
  type Group,
  HOUND,
  MITE,
  type MonsterPlan,
  outAt,
  runFray,
  type Script,
  type Weapon,
} from "./fray.ts";
import { drawBurst } from "./fx.ts";
import { clamp, easeInOut, easeOut, hash, lerp, mix, noise1, rng } from "./geom.ts";
import type { Landing, Standing, View } from "./land.ts";
import {
  drawDrowned,
  type Frame,
  type LandingScene,
  landingScene,
  type Siege,
  type Sizes,
  type Stage,
} from "./landing.ts";
import { itemName } from "./names.ts";
import type { Scene } from "./scenes.ts";
import { type Corners, drawFrameRule, FRAME, UP } from "./stage.ts";
import { HEIGHT, WIDTH } from "./surface.ts";
import {
  BRASS,
  type Crew,
  crowdStations,
  IRON,
  RAIL_SPOTS,
  rampFoot,
  rampTop,
  STATION,
  STATIONS,
  type Station,
  TIMBER,
} from "./topcity.ts";

export const ACCENT = 0xf6cf6a;
/** Lamp ink: the accent mixed 38% toward ink, for hatching in the lamp's colour (docs/art.md, section 3). */
const LAMP_INK = mix(ACCENT, INK, 0.38);
/** The ground's wash greyed by a third, for the ground the horde has trodden. */
const TRODDEN = mix(0xd9dcae, 0x7d776e, 0.33);
const LAMPLIGHT = 0xf3d9a0;
/** A dark post's arc of the wall, strip and band: iron and soot at 40% (docs/art.md, section 7). */
export const UNLIT = mix(PAPER, 0x5b5048, 0.4);
export const LIT = mix(PAPER, ACCENT, 0.35);

// ---------------------------------------------------------------- the shield's shape and its state

/** The shield level the scene's city has built: 18 posts of banded timber. */
export const SIEGE_LEVEL = 4;
/** Posts for a shield level: ten, and two more a level. */
export const postsFor = (level: number): number => 10 + 2 * level;
/** When the lamps light, and when the pool runs out. */
export const LIGHT = 2;
export const BREAK = 42;
/** The black stops this many tiles off the foot during the siege. */
const PRESS = 2;
/** How deep the near side's strip lies outside the foot, in px at 32 px a tile: half a tile. */
const STRIP = 16;
/** Px a tile once the frame has closed, and a citizen's height there. */
export const SIEGE_TILE = 32;
const CITIZEN = 59;
/** A hit on a dark post's arc takes this many times as much off the pool as one on a lit arc. */
export const DARK_HIT = 3;

export interface Post {
  /** Its place in order round the foot from the far side, clockwise. */
  k: number;
  /** Its angle from the foot's middle, and where it stands, in tiles. */
  a: number;
  x: number;
  y: number;
  /** When its condition runs out and its lamp goes dark; past the break if it never does. */
  darkAt: number;
  /** When it lights at the march: a run both ways round from the ramp's side. */
  lightAt: number;
}

export interface Shield {
  cx: number;
  cy: number;
  /** The foot's distance from the middle along the ray at angle `a`, in tiles. */
  R(a: number): number;
  /** The point `d` tiles outside the foot along the ray at angle `a`. */
  at(a: number, d: number): [number, number];
  /** How far outside the foot a place is, in tiles, along its ray (negative inside). */
  outside(x: number, y: number): number;
  angle(x: number, y: number): number;
  posts: Post[];
  /** The two posts either side of the way out from the ramp's foot. */
  rampAngle: number;
}

const wrap = (a: number): number => {
  let v = a % (Math.PI * 2);
  if (v > Math.PI) v -= Math.PI * 2;
  if (v < -Math.PI) v += Math.PI * 2;
  return v;
};
const gap = (a: number, b: number): number => Math.abs(wrap(a - b));

/**
 * The shield on the mid city's landing: a foot of 30 by 22 tiles round the
 * city with the planted feet and the ramp's foot inside, bends no tighter than
 * two tiles, and its posts at even spacing by length with the way out from the
 * ramp's foot midway between two of them.
 */
export function makeShield(L: Landing, level: number): Shield {
  const cx = L.city.x + 0.2;
  const cy = L.city.y + 0.4;
  const rx = 15;
  const ry = 11;
  const R = (a: number): number =>
    (1 / Math.sqrt((Math.cos(a) / rx) ** 2 + (Math.sin(a) / ry) ** 2)) *
    (1 + 0.03 * noise1(a * 1.3 + 4, 7) + 0.012 * noise1(a * 2.9, 8));
  const at = (a: number, d: number): [number, number] => {
    const r = R(a) + d;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const angle = (x: number, y: number): number => Math.atan2(y - cy, x - cx);
  const outside = (x: number, y: number): number => {
    const a = angle(x, y);
    return Math.hypot(x - cx, y - cy) - R(a);
  };
  // Length round the foot, for spacing the posts evenly by it.
  const n = 1440;
  const lens: number[] = [0];
  let prev = at(-Math.PI, 0);
  for (let i = 1; i <= n; i++) {
    const p = at(-Math.PI + (i / n) * Math.PI * 2, 0);
    lens.push((lens[i - 1] as number) + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
    prev = p;
  }
  const total = lens[n] as number;
  const angleAt = (s: number): number => {
    const v = ((s % total) + total) % total;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if ((lens[mid] as number) <= v) lo = mid;
      else hi = mid;
    }
    const f = (v - (lens[lo] as number)) / ((lens[hi] as number) - (lens[lo] as number) || 1);
    return -Math.PI + ((lo + f) / n) * Math.PI * 2;
  };
  const foot = rampFoot(1);
  const rampAngle = angle(L.city.x + foot[0], L.city.y + foot[1]);
  const sR = lens[Math.round(((rampAngle + Math.PI) / (Math.PI * 2)) * n)] as number;
  const count = postsFor(level);
  const raw = Array.from({ length: count }, (_, k) => angleAt(sR + (total * (k + 0.5)) / count));
  // In order round the foot from the far side (straight up the frame), clockwise.
  raw.sort(
    (a, b) =>
      ((a + Math.PI / 2 + Math.PI * 4) % (Math.PI * 2)) -
      ((b + Math.PI / 2 + Math.PI * 4) % (Math.PI * 2)),
  );
  const posts: Post[] = raw.map((a, k) => {
    const [x, y] = at(a, 0);
    return { k, a, x, y, darkAt: Number.POSITIVE_INFINITY, lightAt: LIGHT };
  });
  // The lamps light in a run both ways round from the ramp's side, a tenth of a second a post.
  const first = posts
    .map((p) => p.k)
    .sort((a, b) => gap((posts[a] as Post).a, rampAngle) - gap((posts[b] as Post).a, rampAngle))
    .slice(0, 2);
  for (const p of posts) {
    const steps = Math.min(
      ...first.map((f) => {
        const d = Math.abs(p.k - f);
        return Math.min(d, count - d);
      }),
    );
    p.lightAt = LIGHT + steps * 0.1;
  }
  schedule(posts);
  return { cx, cy, R, at, outside, angle, posts, rampAngle };
}

/** Compass angles on the plan, with south down the frame. */
const DIR = {
  wnw: (-149 * Math.PI) / 180,
  s: (83 * Math.PI) / 180,
  far: (-40 * Math.PI) / 180,
  w: Math.PI,
  se: (30 * Math.PI) / 180,
  e: (-10 * Math.PI) / 180,
};

/**
 * When each lamp goes dark. A post's condition runs out where the horde is
 * striking hardest, so the next to go is the lit post nearest that place and
 * the dark ones come in runs: first at the west-north-west where nobody is,
 * then the south, then the far side past C. The pair at the east end, where
 * A and B hold, go last. Lamps lit: 16 at 17 s, 14 at 20, 12 at 23, 10 at 26,
 * 9 at 28, 7 at 31, 5 at 34, 3 at 37, 2 at 39 and 1 at 41.
 */
function schedule(posts: Post[]): void {
  const east = [...posts].sort((a, b) => gap(a.a, 0) - gap(b.a, 0)).slice(0, 2);
  const order: [number, number][] = [
    [17, DIR.wnw],
    [17, DIR.wnw],
    [20, DIR.wnw],
    [20, DIR.wnw],
    [23, DIR.s],
    [23, DIR.s],
    [26, DIR.s],
    [26, DIR.far],
    [28, DIR.far],
    [31, DIR.far],
    [31, DIR.s],
    [34, DIR.far],
    [34, DIR.s],
    [37, DIR.w],
    [37, DIR.w],
    [39, DIR.se],
    [41, DIR.e],
  ];
  for (const [t, toward] of order) {
    const last = t === 41;
    const pick = posts
      .filter((p) => p.darkAt > 99 && (last || !east.includes(p)))
      .sort((a, b) => gap(a.a, toward) - gap(b.a, toward))[0];
    if (pick) pick.darkAt = t;
  }
}

/** Which lamps are lit at `t`: none before the march's run reaches them, none from the break. */
export function litAt(sh: Shield, t: number): boolean[] {
  return sh.posts.map((p) => t >= p.lightAt && t < p.darkAt && t < BREAK);
}

/** A stretch of the foot held by one post, from midway to one neighbour to midway to the other. */
export interface Arc {
  /** The post that holds it. */
  k: number;
  /** Where it starts and ends, as angles from the foot's middle; `a1` may pass π. */
  a0: number;
  a1: number;
}

/** Each post's arc of the foot, in the posts' order. */
export function arcsOf(sh: Shield): Arc[] {
  const n = sh.posts.length;
  return sh.posts.map((p, k) => {
    const prev = sh.posts[(k + n - 1) % n] as Post;
    const next = sh.posts[(k + 1) % n] as Post;
    return { k, a0: p.a - gap(p.a, prev.a) / 2, a1: p.a + gap(next.a, p.a) / 2 };
  });
}

/**
 * How each arc of the wall, the near strip and the foot's band is drawn at `t`: lit while its
 * post's lamp is, dark from when it goes out, and not drawn before the lighting run reaches it.
 * The drawing takes its colours from this.
 */
export function arcStateAt(sh: Shield, t: number): ("rest" | "lit" | "dark")[] {
  const lit = litAt(sh, t);
  return sh.posts.map((p, k) => (t < p.lightAt ? "rest" : lit[k] ? "lit" : "dark"));
}

/** Lamps lit at `t` by their conditions alone, the lighting run aside. */
const litBySchedule = (sh: Shield, t: number): number =>
  t >= BREAK ? 0 : sh.posts.filter((p) => p.darkAt > t).length;

/** Lamps lost a minute at the rate of the last six seconds. */
export function lossAt(sh: Shield, t: number): number {
  if (t < LIGHT || t >= BREAK) return 0;
  return ((litBySchedule(sh, Math.max(LIGHT, t - 6)) - litBySchedule(sh, t)) * 60) / 6;
}

// ---------------------------------------------------------------- the horde on the shield

/** One of the 21 places round the foot where siege swarms throw themselves on the wall. */
interface Place {
  a: number;
  /** When its first swarm reaches the wall. */
  t0: number;
  /** How many bodies its heap can hold, and the heap's height in px at the wall. */
  most: number;
}

const PLACES = 21;

/**
 * The 21 places and when each heap starts: six by 13 s, fourteen by 28 s,
 * nineteen by 40 s. They fill first where the horde is striking hardest,
 * and last at the east end, where A and B are winning.
 */
function makePlaces(): Place[] {
  const hot = [DIR.wnw, DIR.s, DIR.far, DIR.w + 0.2, DIR.se + 0.5];
  const list = Array.from({ length: PLACES }, (_, p) => {
    const a = wrap(-Math.PI / 2 + ((p + 0.3) / PLACES) * Math.PI * 2);
    const heat = Math.min(...hot.map((h) => gap(a, h))) + (gap(a, 0) < 0.5 ? 2 : 0);
    const far = Math.sin(a) < 0.2 || Math.abs(Math.cos(a)) > 0.85;
    return { a, heat, most: far ? 16 + Math.round(hash(p, 3) * 6) : 7 };
  });
  const byHeat = [...list].sort((a, b) => a.heat - b.heat);
  const times = [
    10.4, 10.9, 11.4, 11.9, 12.3, 12.7, 14.5, 16.5, 18.5, 20.5, 22.5, 24, 25.5, 27, 29, 31.5, 34,
    36.5, 39, 40.4, 41.2,
  ];
  return list.map((q) => ({ a: q.a, most: q.most, t0: times[byHeat.indexOf(q)] as number }));
}

/** A body on the wall or in the press: where, what, and how it moves. */
interface PressBody {
  a: number;
  d: number;
  /** Height up the wall in px at 32 px a tile; 0 on the ground. */
  z: number;
  kind: number;
  build: number;
  seed: number;
}

/** Bodies in the press, two to five tiles off the foot, whole and in spot black. */
function makePress(sh: Shield): PressBody[] {
  const random = rng(4131);
  const out: PressBody[] = [];
  for (let row = 0; row < 4; row++) {
    let a = -Math.PI + random() * 0.2;
    while (a < Math.PI) {
      const d = PRESS + 0.25 + row * 0.75 + (random() - 0.5) * 0.45;
      const hound = random() < 0.3;
      out.push({
        a,
        d,
        z: 0,
        kind: hound ? HOUND : MITE,
        build: Math.floor(random() * 3),
        seed: out.length,
      });
      const r = sh.R(a) + d;
      // Bunched: steps between bodies vary, so the backs are not on one pitch.
      const step = (hound ? 1.5 : 0.85) * (0.6 + random() * 0.9) + (random() < 0.12 ? 1.2 : 0);
      a += step / r;
    }
  }
  return out;
}

// ---------------------------------------------------------------- drawing the shield and the horde

const onTwelves = (t: number): number => Math.floor(t * 12) / 12;

interface Drawn {
  bodies: number;
}

/** A point on the foot, as its angle, and its ray's index or -1 for a cut between two arcs. */
interface Segment {
  a: number;
  i: number;
}

/** The siege's own drawing over a landing, for `Stage.siege`. */
function siegeLayer(
  L: Landing,
  sh: Shield,
  places: Place[],
  press: PressBody[],
  mass: { brutes: [number, number, number][]; elites: [number, number, number][] },
  extra: (t: number) => Record<string, unknown>,
): Siege {
  const drawn: Drawn = { bodies: 0 };
  // The foot cut into short segments for drawing: 240 even rays, and a cut at each end of every
  // post's arc, so a change from lit to unlit falls exactly midway between two posts.
  const SEGMENTS: Segment[] = [
    ...Array.from({ length: 241 }, (_, i) => ({ a: -Math.PI + (i / 240) * Math.PI * 2, i })),
    ...arcsOf(sh).map((arc) => ({ a: wrap(arc.a1), i: -1 })),
  ].sort((p, q) => p.a - q.a);
  // The post whose arc each segment is on.
  const owners = SEGMENTS.slice(0, -1).map((seg, j) => {
    const am = (seg.a + (SEGMENTS[j + 1] as Segment).a) / 2;
    return sh.posts.reduce((m, p) => (gap(p.a, am) < gap(m.a, am) ? p : m)).k;
  });
  const ownerOf = (j: number): number => owners[j] as number;
  /** Where the black's inner edge is, in tiles off the foot along each ray. */
  const blackEdge = (a: number, t: number): number => {
    const wobble = 0.3 * noise1(a * 5, 11) + 0.15 * noise1(a * 13, 12);
    if (t < 10) return PRESS + 6 * (1 - easeInOut(t / 10)) + wobble;
    if (t < BREAK) return PRESS + wobble;
    // After the break the heap falls in two tiles by 42.9 s, and the black follows it to the hull by 56 s.
    const hull = hullReach(a) - sh.R(a);
    if (t < BREAK + 0.9) return lerp(PRESS, -2, easeOut((onTwelves(t) - BREAK) / 0.9)) + wobble;
    return lerp(-2, hull, clamp((t - BREAK - 0.9) / (56 - BREAK - 0.9))) + wobble;
  };
  /** The hull with its legs, as a reach from the foot's middle, in tiles. */
  const hullReach = (a: number): number =>
    1 / Math.sqrt((Math.cos(a) / 8.4) ** 2 + (Math.sin(a) / 4.4) ** 2);
  const heapCount = (pl: Place, t: number): number =>
    t < pl.t0 ? 0 : Math.min(pl.most, Math.round(4 + ((t - pl.t0) / 9) * pl.most));
  const wallHeight = (a: number, T: number): number => {
    const far = -Math.sin(a);
    return far > 0 ? 110 * (T / SIEGE_TILE) * Math.sqrt(far) : 0;
  };
  /** A post's height to the lamp, at level 4: one and a half citizens. */
  const POST = 1.5;

  const P = (f: Frame, a: number, d: number): [number, number] => {
    const [x, y] = sh.at(a, d);
    return [f.sx(x), f.sy(y)];
  };

  const darkArc = (a: number, t: number): boolean => {
    // The arc a post holds runs halfway to each neighbour; dark if its post is.
    let best: Post | null = null;
    let bd = 9;
    for (const p of sh.posts) {
      const g = gap(p.a, a);
      if (g < bd) {
        bd = g;
        best = p;
      }
    }
    return best !== null && t >= best.darkAt;
  };

  // Every place's blows on the wall: one every 1.1 to 1.6 s from its first swarm's arrival.
  const blowsAt = (pl: Place, k: number, t: number): number[] => {
    const out: number[] = [];
    if (t < pl.t0) return out;
    const period = 1.1 + hash(k, 41) * 0.5;
    for (let s = pl.t0 + 0.2; s <= t && s < BREAK; s += period) out.push(s);
    return out;
  };

  const drawMite = (
    d: Draw,
    x: number,
    y: number,
    size: number,
    face: number,
    seed: number,
    t: number,
    lunge = 0,
  ): void => {
    const m: Mite = {
      x,
      y,
      face,
      phase: t * 3 + seed * 0.37,
      stretch: 1 + (seed % 3) * 0.05,
      flash: false,
      seed,
      build: seed % 3,
      lunge,
    };
    drawSwarm(d, [m], 1, size);
  };
  // The side toward the lantern catches its light: a paper line along the back.
  const paperLine = (
    d: Draw,
    x: number,
    y: number,
    size: number,
    toward: number,
    seed: number,
    tall: number,
  ): void => {
    const ink = d.ink;
    d.ink = PAPER;
    d.curve(
      [
        x - toward * size * 0.05,
        y - size * tall,
        x + toward * size * 0.25,
        y - size * (tall + 0.05),
        x + toward * size * 0.5,
        y - size * (tall - 0.18),
      ],
      FORM,
      seed + 5000,
      false,
      0.9,
    );
    d.ink = ink;
  };

  const ground = (d: Draw, f: Frame, t: number): void => {
    const T = f.v.T;
    const k = T / SIEGE_TILE;
    const broken = t >= BREAK;
    const n = 240;
    const ray = (i: number): number => -Math.PI + (i / n) * Math.PI * 2;
    // ---- Lamplight in three flat steps inside the foot, centred on the lantern.
    if (t >= LIGHT && !broken) {
      const on = clamp((t - LIGHT) / 1);
      for (const [step, alpha] of [
        [1, 0.16],
        [0.72, 0.14],
        [0.46, 0.14],
      ] as const) {
        const pts: number[] = [];
        for (let i = 0; i < n; i += 4) {
          const a = ray(i);
          const r = sh.R(a) * step;
          pts.push(f.sx(sh.cx + Math.cos(a) * r), f.sy(sh.cy + Math.sin(a) * r));
        }
        d.fill(pts, LAMPLIGHT, alpha * on);
      }
    }
    // ---- The trodden ground between the foot and the station row: the ground's wash greyed.
    if (!broken) {
      const strip: number[] = [];
      for (let i = 0; i <= n; i++) {
        const a = ray(i);
        strip.push(...P(f, a, PRESS + 0.6), ...P(f, a, 0));
      }
      d.surface.strip(strip, n + 1, TRODDEN, d.strength);
    }
    // ---- The black, from its edge to past the frame.
    {
      const strip: number[] = [];
      for (let i = 0; i <= n; i++) {
        const a = ray(i);
        const e = blackEdge(a, t);
        strip.push(...P(f, a, e), ...P(f, a, 60));
      }
      d.surface.strip(strip, n + 1, INK, d.strength);
    }
    // The drowned map, in paper line, where the black is deep.
    drawDrowned(d, L, f, 1, (x, y) => sh.outside(x, y) > blackEdge(sh.angle(x, y), t) + 3.5);
    // ---- The mass, three to eight tiles in: heads and backs in clusters of five to twelve with
    // black between; then eyes in clusters out to the frame.
    {
      const random = rng(77);
      const ink = d.ink;
      for (let c = 0; c < 170; c++) {
        const a = -Math.PI + random() * Math.PI * 2;
        const deep = random();
        const d0 = 5 + deep * 8;
        const size = 5 + Math.floor(random() * 8);
        const seed = c * 31;
        for (let q = 0; q < size; q++) {
          const aa = a + ((random() - 0.5) * 1.6) / (sh.R(a) + d0);
          const dd = d0 + (random() - 0.5) * 0.9;
          const edge = blackEdge(aa, t);
          if (dd < edge + 1.2) continue;
          const [x, y] = P(f, aa, dd);
          if (x < FRAME.x0 - 10 || x > FRAME.x1 + 10 || y < FRAME.y0 - 10 || y > FRAME.y1 + 10)
            continue;
          const face = x < f.sx(sh.cx) ? 1 : -1;
          const s = (0.7 + random() * 0.5) * T * 0.8;
          const fade = clamp(1 - (dd - edge - 4) / 9, 0.25, 1);
          if (dd - edge < 7) {
            d.ink = PAPER;
            d.curve(
              [
                x - 0.5 * s * face,
                y + 1,
                x - 0.2 * s * face,
                y - 0.32 * s,
                x + 0.25 * s * face,
                y - 0.3 * s,
                x + 0.5 * s * face,
                y - 0.04 * s,
              ],
              dd - edge < 4 ? FORM : HAIR,
              seed + q,
              false,
              0.7 * fade,
            );
            d.ink = ink;
          }
          if (random() < 0.55) {
            const blink = Math.sin(t * 0.8 + seed + q * 2.3) > 0.95;
            if (!blink) {
              d.dot(x + 0.4 * s * face, y - 0.14 * s, 1.8, PAPER, 0.9 * fade);
              d.dot(x + 0.55 * s * face, y - 0.12 * s, 1.6, PAPER, 0.9 * fade);
            }
          }
        }
      }
    }
    // ---- Whole bodies in the press, sorted by their feet, with the brutes and elites standing in it.
    drawn.bodies = 0;
    const standing: { y: number; draw: () => void }[] = [];
    const mite = 31 * k;
    const hound = 19.5 * (T / 23);
    const cxS = f.sx(sh.cx);
    for (const b of press) {
      const e = blackEdge(b.a, t);
      // Before the black arrives the bodies are further out with it.
      const dd = b.d + (e - PRESS) * (t < 10 ? 1 : 0);
      if (t >= BREAK && dd - (e - PRESS) < e) continue;
      const [x, y] = P(f, b.a, t >= BREAK ? b.d + (e - PRESS) : dd);
      if (x < FRAME.x0 - 40 || x > FRAME.x1 + 40 || y < FRAME.y0 - 10 || y > FRAME.y1 + 60)
        continue;
      const face = x < cxS ? 1 : -1;
      standing.push({
        y,
        draw: () => {
          const beat = (t * 1.1 + hash(b.seed, 9) * 3) % 1;
          const lunge = beat < 0.2 ? 1 - beat / 0.2 : 0;
          if (b.kind === MITE) {
            drawMite(d, x, y, mite, face, b.seed, t, lunge);
            paperLine(d, x, y, mite, face, b.seed, 0.62);
          } else {
            drawHound(
              d,
              x,
              y,
              hound,
              beastPose({
                face,
                stride: (t * 1.4 + b.seed * 0.3) % 1,
                speed: 0.25,
                coil: beat > 0.6 ? (beat - 0.6) * 2 : 0,
                lunge,
                wake: 2,
              }),
              b.build,
              b.seed,
            );
            paperLine(d, x, y, hound * 1.1, face, b.seed, 0.95);
          }
          drawn.bodies++;
        },
      });
    }
    for (const [kind, list] of [
      [BRUTE, mass.brutes],
      [ELITE, mass.elites],
    ] as const)
      for (const [j, a0, d0] of list) {
        if (t >= BREAK + 1) continue;
        const [a, dd] = wade(a0, d0, t, sh.rampAngle);
        const [x, y] = P(f, a, dd + (t < 10 ? blackEdge(a, t) - PRESS : 0));
        const face = x < cxS ? 1 : -1;
        standing.push({
          y,
          draw: () => {
            const beat = (t * 0.45 + j * 0.37) % 1;
            const p = beastPose({
              face,
              stride: (t * 0.8 + j) % 1,
              speed: t > 20 && t < 38 ? 0.6 : 0.15,
              coil: beat > 0.7 ? clamp((beat - 0.7) / 0.2) : 0,
              lunge: beat < 0.12 ? 1 - beat / 0.12 : 0,
              wake: 2,
            });
            if (kind === BRUTE) drawBrute(d, x, y, 63.3 * (T / 23), p, j * 13);
            else drawElite(d, x, y, 76.2 * (T / 23), p, j * 13);
          },
        });
      }
    standing.sort((a, b) => a.y - b.y);
    inHorde(() => {
      for (const s of standing) s.draw();
    });

    if (broken) {
      drawFallingHeap(d, f, t);
      wallBursts(d, f, t);
      return;
    }
    // ---- The wall: drawn after the black and before everything that stands. On the far side it
    // stands from the foot to a quarter of a post above the lamps and narrows to nothing at the
    // ends; on the near side it is a strip half a tile deep on the ground outside the foot. Lit
    // arcs are the accent's wash with lamp-ink hatching leaning toward the lantern; a dark post's
    // arc stands unlit and cracked.
    const rise = t < LIGHT ? 0 : clamp((t - LIGHT - 0.2) / 0.5);
    const states = arcStateAt(sh, t);
    if (t >= LIGHT) {
      // The near strip is hatched across at a pitch along the foot: open in lamp ink on a lit arc,
      // in ink 6 px apart on a dark one.
      let along = 0;
      let was = "";
      for (let j = 0; j + 1 < SEGMENTS.length; j++) {
        const { a: a0, i } = SEGMENTS[j] as Segment;
        const { a: a1 } = SEGMENTS[j + 1] as Segment;
        const state = states[ownerOf(j)] as string;
        // The wall is hatched up behind the lighting run.
        if (state === "rest") continue;
        const post = sh.posts[ownerOf(j)] as Post;
        const up = rise * clamp((t - post.lightAt) / 0.5);
        const dark = state === "dark";
        const [x0, y0] = P(f, a0, 0);
        const [x1, y1] = P(f, a1, 0);
        const h0 = wallHeight(a0, T) * up;
        const h1 = wallHeight(a1, T) * up;
        // The strip lies on the ground wherever the standing wall shows less than the strip is
        // deep: the whole near side, and the ends, where the wall narrows and is seen edge on.
        const across = Math.abs(x1 - x0) / (Math.hypot(x1 - x0, y1 - y0) || 1);
        if (Math.max(wallHeight(a0, T), wallHeight(a1, T)) * across < STRIP * k) {
          const [o0x, o0y] = P(f, a0, 0.5 * up);
          const [o1x, o1y] = P(f, a1, 0.5 * up);
          d.fill([x0, y0, x1, y1, o1x, o1y, o0x, o0y], dark ? UNLIT : LIT, 1);
          if (state !== was) along = 0;
          was = state;
          const pitch = dark ? 6 : 10;
          const len = Math.hypot(x1 - x0, y1 - y0);
          const ink = d.ink;
          d.ink = dark ? INK : LAMP_INK;
          for (let s = Math.ceil(along / pitch) * pitch - along; s < len; s += pitch) {
            const u = s / len;
            const fx = lerp(x0, x1, u);
            const fy = lerp(y0, y1, u);
            const ox = lerp(o0x, o1x, u);
            const oy = lerp(o0y, o1y, u);
            // A short stroke across the strip, leaning a little along it.
            d.line(
              fx,
              fy,
              ox + ((x1 - x0) / len) * 4,
              oy + ((y1 - y0) / len) * 4,
              HAIR,
              j * 7 + Math.round(s),
              dark ? 0.8 : 0.7,
            );
          }
          d.ink = ink;
          along += len;
        }
        if (h0 + h1 > 1) {
          d.fill([x0, y0, x1, y1, x1, y1 - h1, x0, y0 - h0], dark ? UNLIT : LIT, 1);
          // Hatching: in lamp ink on a lit arc, leaning in toward the lantern; in ink on a dark one.
          if (i >= 0 && i % 3 === 0 && h0 > 6) {
            const lean = (f.sx(sh.cx) - x0) * 0.1;
            const ink = d.ink;
            d.ink = dark ? INK : LAMP_INK;
            d.line(x0, y0 - 2, x0 + lean, y0 - h0 + 4, HAIR, i, dark ? 0.55 : 0.85);
            d.ink = ink;
          }
        }
      }
      // The wall's top edge on the far side, in ink at contour weight.
      const top: number[] = [];
      const flush = (): void => {
        if (top.length >= 4) d.path(top, CONTOUR, 900 + top.length, false, rise);
        top.length = 0;
      };
      for (let i = 0; i <= n; i++) {
        const a = ray(i);
        const h = wallHeight(a, T) * rise;
        if (h < 2) {
          flush();
          continue;
        }
        const [x, y] = P(f, a, 0);
        // A dark arc's edge is ragged where it is cracked.
        const rag = darkArc(a, t) ? (hash(i, 31) - 0.5) * 7 : 0;
        top.push(x, y - h + rag);
      }
      flush();
      // The near strip's outer edge.
      const edge: number[] = [];
      for (let i = 0; i <= n; i++) {
        const a = ray(i);
        const [bx, by] = P(f, ray(i - 1), 0);
        const [cx, cy] = P(f, ray(i + 1), 0);
        const across = Math.abs(cx - bx) / (Math.hypot(cx - bx, cy - by) || 1);
        if (wallHeight(a, T) * across >= STRIP * k) {
          if (edge.length >= 4) d.path(edge, FORM, 950 + i, false, rise);
          edge.length = 0;
          continue;
        }
        edge.push(...P(f, a, 0.5 * rise));
      }
      if (edge.length >= 4) d.path(edge, FORM, 990, false, rise);
      // Cracks: on every dark arc from the foot to the top; on lit arcs where blows have landed,
      // each blow adding a third of the wall's height to the crack.
      places.forEach((pl, q) => {
        const blows = blowsAt(pl, q, t).length;
        drawCrack(d, f, pl.a, blows / 3, q * 7);
      });
      for (const p of sh.posts) {
        if (t < p.darkAt) continue;
        for (const side of [-1, 1]) drawCrack(d, f, p.a + side * 0.09, 1.2, p.k * 13 + side);
      }
    }
    // ---- The heap on the far side and the ends, drawn on the wall: black on gold.
    drawHeap(d, f, t, true);
    // ---- The foot: a heavy line in ink, inked behind the lighting run and closed all round from
    // then until the break, with a band 6 px wide along its inner side: the accent on a lit post's
    // arc and the unlit wash on a dark one's, changing midway between two posts.
    if (t >= LIGHT) {
      const inward = (a: number): number[] => {
        const [x, y] = P(f, a, 0);
        const inX = f.sx(sh.cx) - x;
        const inY = f.sy(sh.cy) - y;
        const l = Math.hypot(inX, inY) || 1;
        return [x + (inX / l) * 2, y + (inY / l) * 2, x + (inX / l) * 8, y + (inY / l) * 8];
      };
      const band: number[] = [];
      let bandState = "";
      const flushBand = (): void => {
        if (band.length >= 8)
          d.surface.strip(band, band.length / 4, bandState === "dark" ? UNLIT : ACCENT, d.strength);
        band.length = 0;
      };
      for (let j = 0; j + 1 < SEGMENTS.length; j++) {
        const state = states[ownerOf(j)] as string;
        if (state !== bandState) {
          flushBand();
          bandState = state;
        }
        if (state === "rest") continue;
        if (band.length === 0) band.push(...inward((SEGMENTS[j] as Segment).a));
        band.push(...inward((SEGMENTS[j + 1] as Segment).a));
      }
      flushBand();
      const line: number[] = [];
      const flushFoot = (): void => {
        if (line.length >= 4) d.path(line, HEAVY, 777 + line.length, false);
        line.length = 0;
      };
      for (let j = 0; j + 1 < SEGMENTS.length; j++) {
        if (states[ownerOf(j)] === "rest") {
          flushFoot();
          continue;
        }
        if (line.length === 0) line.push(...P(f, (SEGMENTS[j] as Segment).a, 0));
        line.push(...P(f, (SEGMENTS[j + 1] as Segment).a, 0));
      }
      flushFoot();
    }
    // ---- The near heap, under a tile high, in front of the foot.
    drawHeap(d, f, t, false);
    // ---- Siege swarms crossing the trodden ground to the wall.
    inHorde(() => {
      places.forEach((pl, q) => {
        for (let m = 0; m < 8; m++) {
          const arrive = pl.t0 + m * 5.5;
          const u = (t - (arrive - 1.6)) / 1.6;
          if (u < 0 || u > 1 || arrive > BREAK) continue;
          for (let b = 0; b < 7; b++) {
            const aa = pl.a + ((hash(q, m, b) - 0.5) * 2.2) / sh.R(pl.a);
            const dd = lerp(PRESS + 0.4, 0.35, u) + (hash(b, q, m) - 0.5) * 0.7;
            const [x, y] = P(f, aa, dd);
            const face = x < f.sx(sh.cx) ? 1 : -1;
            drawMite(d, x, y, mite, face, q * 50 + m * 7 + b, t);
            paperLine(d, x, y, mite, face, q * 50 + b, 0.62);
          }
        }
      });
    });
    wallBursts(d, f, t);

    function drawHeap(dd: Draw, ff: Frame, tt: number, farSide: boolean): void {
      inHorde(() => {
        const list: { y: number; x: number; z: number; s: number; face: number; seed: number }[] =
          [];
        places.forEach((pl, q) => {
          const far = Math.sin(pl.a) < 0.25;
          if (far !== farSide) return;
          const count = heapCount(pl, tt);
          const wallH = wallHeight(pl.a, T);
          // On the far side and at the ends it climbs to the lamps; on the near side under a tile.
          const lamp = POST * CITIZEN * k;
          const high = far ? Math.max(lamp * 0.9, wallH) : 26 * k;
          const late = clamp((tt - 34) / 6);
          for (let b = 0; b < count; b++) {
            const aa = pl.a + ((hash(q, b, 1) - 0.5) * 2.6) / sh.R(pl.a);
            const up = (b / Math.max(1, pl.most)) ** 0.8;
            const z = high * up * (0.55 + hash(q, b, 2) * 0.45);
            // Near the break the far heap leans in over the foot.
            const d0 = 0.15 + hash(q, b, 3) * 0.7 - (far ? late * 0.8 * up : 0);
            const [x, y] = P(ff, aa, d0);
            list.push({
              y,
              x,
              z,
              s: mite * (0.95 + hash(q, b, 4) * 0.2),
              face: x < ff.sx(sh.cx) ? 1 : -1,
              seed: q * 100 + b,
            });
          }
        });
        list.sort((a, b) => b.z - a.z || a.y - b.y);
        // Lowest last on the far side, so the climbers are behind those at the foot.
        list.sort((a, b) => a.y - a.z * 0.02 - (b.y - b.z * 0.02));
        for (const m of list) {
          const beat = (tt * 1.3 + m.seed * 0.17) % 1;
          drawMite(dd, m.x, m.y - m.z, m.s, m.face, m.seed, tt, beat < 0.25 ? 1 - beat / 0.25 : 0);
          paperLine(dd, m.x, m.y - m.z, m.s, m.face, m.seed, 0.62);
          drawn.bodies++;
        }
      });
    }

    function drawFallingHeap(dd: Draw, ff: Frame, tt: number): void {
      // The heap falls inward as one held drawing, landing up to two tiles inside the old foot.
      const u = easeOut(clamp((onTwelves(tt) - BREAK) / 0.9));
      if (tt > BREAK + 4) return;
      inHorde(() => {
        places.forEach((pl, q) => {
          const far = Math.sin(pl.a) < 0.25;
          const count = heapCount(pl, BREAK - 0.01);
          const wallH = wallHeight(pl.a, T);
          const lamp = POST * CITIZEN * k;
          const high = far ? Math.max(lamp * 0.9, wallH) : 26 * k;
          for (let b = 0; b < count; b++) {
            const aa = pl.a + ((hash(q, b, 1) - 0.5) * 2.6) / sh.R(pl.a);
            const up = (b / Math.max(1, pl.most)) ** 0.8;
            const z = high * up * (0.55 + hash(q, b, 2) * 0.45) * (1 - u);
            const d0 = lerp(0.15 + hash(q, b, 3) * 0.7, -0.4 - hash(q, b, 5) * 1.6, u);
            const [x, y] = P(ff, aa, d0);
            const face = x < ff.sx(sh.cx) ? 1 : -1;
            drawMite(dd, x, y - z, mite, face, q * 100 + b, tt, 0.6);
            paperLine(dd, x, y - z, mite, face, q * 100 + b, 0.62);
            drawn.bodies++;
          }
        });
      });
    }
  };

  /** A crack in ink up the wall at angle `a`, `reach` of the wall's height long (1 is foot to top). */
  const drawCrack = (d: Draw, f: Frame, a: number, reach: number, seed: number): void => {
    if (reach <= 0.05) return;
    const T = f.v.T;
    const h = wallHeight(a, T);
    const [x, y] = P(f, a, 0);
    if (h < 8) return;
    const len = Math.min(1, reach) * h;
    const pts: number[] = [x, y];
    let cx = x;
    let cy = y;
    const steps = 5;
    for (let s = 1; s <= steps; s++) {
      cx += (hash(seed, s) - 0.5) * 9;
      cy -= len / steps;
      pts.push(cx, cy);
    }
    d.path(pts, FORM, seed + 7000, false, 0.95);
    if (reach > 0.6)
      d.line(
        pts[4] as number,
        pts[5] as number,
        (pts[4] as number) + (hash(seed, 9) - 0.5) * 16,
        (pts[5] as number) - 8,
        HAIR,
        seed + 7100,
      );
  };

  /** Whether a point on screen lies over the black and not over the far wall standing in front of it. */
  const overBlack = (f: Frame, px: number, py: number, t: number): boolean => {
    const x = (px - f.v.ox) / f.v.T;
    const y = (py - f.v.oy) / f.v.T;
    if (sh.outside(x, y) <= blackEdge(sh.angle(x, y), t)) return false;
    if (t < LIGHT || t >= BREAK) return true;
    let best = 0;
    let near = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 240; i++) {
      const a = -Math.PI + (i / 240) * Math.PI * 2;
      if (wallHeight(a, f.v.T) < 1) continue;
      const gapX = Math.abs((P(f, a, 0)[0] as number) - px);
      if (gapX < near) {
        near = gapX;
        best = a;
      }
    }
    if (near > 12) return true;
    const footY = P(f, best, 0)[1] as number;
    return !(py <= footY && py >= footY - wallHeight(best, f.v.T));
  };

  const items = (d: Draw, f: Frame, t: number): Standing[] => {
    const out: Standing[] = [];
    const T = f.v.T;
    const k = T / SIEGE_TILE;
    const lit = litAt(sh, t);
    const litCount = lit.filter(Boolean).length;
    const lastLamp = sh.posts.find((p) => p.darkAt === 41) ?? (sh.posts[0] as Post);
    for (const p of sh.posts) {
      // Down and under the black, nothing of the shield is drawn.
      if (t >= BREAK && blackEdge(p.a, t) < -0.3) continue;
      const [x, y] = P(f, p.a, 0);
      const toCity = f.sx(sh.cx) > x ? 1 : -1;
      let fall = 0;
      if (t >= BREAK) {
        const steps = Math.min(
          Math.abs(p.k - lastLamp.k),
          sh.posts.length - Math.abs(p.k - lastLamp.k),
        );
        const start = BREAK + (steps / (sh.posts.length / 2)) * 0.6 - 0.07;
        fall = easeOut(clamp((t - start) / 0.22));
      }
      const dark = t >= p.darkAt || t >= BREAK;
      const rest = t < p.lightAt;
      const lean =
        (fall > 0 ? fall * (Math.PI / 2) : dark ? 0.18 + hash(p.k, 5) * 0.17 : 0) * toCity;
      // With a quarter of the lamps or fewer lit, one dark post in three is snapped at half height.
      const snapped = dark && t < BREAK && litCount <= sh.posts.length / 4 && p.k % 3 === 0;
      const high = POST * CITIZEN * k;
      out.push({
        x: p.x,
        y: p.y,
        draw: () =>
          drawPost(
            d,
            x,
            y,
            high,
            lean,
            lit[p.k] === true,
            rest,
            snapped,
            dark && t < BREAK,
            t,
            p.k,
            toCity,
            (px, py) => overBlack(f, px, py, t),
          ),
        // The shaft in four pieces, and the cage.
        covers: () => {
          const len = snapped ? high * 0.5 : high;
          const boxes: [number, number, number, number][] = [];
          for (let q = 0; q < 4; q++) {
            const u = (q + 0.5) / 4;
            const sx = x + Math.sin(lean) * len * u;
            const sy = y - Math.cos(lean) * len * u;
            const hx = (len / 8) * Math.abs(Math.sin(lean)) + 6;
            const hy = (len / 8) * Math.abs(Math.cos(lean)) + 6;
            boxes.push([sx - hx, sy - hy, sx + hx, sy + hy]);
          }
          if (!snapped) {
            const tx = x + Math.sin(lean) * len;
            const ty = y - Math.cos(lean) * len;
            boxes.push([tx - 10, ty - 15, tx + 10, ty + 9]);
          }
          return boxes;
        },
      });
    }
    return out;
  };

  // Bursts on the wall, drawn with the ground, under every citizen: one in the accent a citizen's
  // height across for each blow on the wall, and the break's.
  const wallBursts = (d: Draw, f: Frame, t: number): void => {
    const T = f.v.T;
    if (t < BREAK) {
      places.forEach((pl, q) => {
        for (const s of blowsAt(pl, q, t)) {
          if (t - s > 0.25) continue;
          const aa = pl.a + ((hash(q, Math.round(s * 10)) - 0.5) * 1.6) / sh.R(pl.a);
          const [x, y] = P(f, aa, 0.1);
          const h = wallHeight(aa, T);
          const z = h > 10 ? h * (0.3 + hash(q, Math.round(s * 10), 2) * 0.4) : 6;
          drawBurst(
            d,
            x,
            y - z,
            t - s,
            CITIZEN * (T / SIEGE_TILE),
            q * 31 + Math.round(s * 10),
            ACCENT,
          );
        }
      });
    }
    // The break: the last lamp goes out with one burst.
    if (t >= BREAK && t < BREAK + 0.6) {
      const last = sh.posts.find((p) => p.darkAt === 41) ?? (sh.posts[0] as Post);
      const lastLit = sh.posts.find((p) => p.darkAt > 99) ?? last;
      const [lx, ly] = P(f, lastLit.a, 0);
      drawBurst(
        d,
        lx,
        ly - 1.5 * CITIZEN * (T / SIEGE_TILE),
        t - BREAK,
        CITIZEN * (T / SIEGE_TILE) * 1.3,
        4242,
        ACCENT,
      );
    }
  };

  const over = (d: Draw, f: Frame, t: number): void => {
    const T = f.v.T;
    // The break: the wall and the foot break into drops of the accent that fall a tile inward
    // over 0.4 s and soak in. Nothing fades.
    if (t >= BREAK && t < BREAK + 0.6) {
      const u = clamp((t - BREAK) / 0.4);
      const n = 160;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI + (i / n) * Math.PI * 2;
        const h = wallHeight(a, T);
        const drops = h > 10 ? 3 : 1;
        for (let q = 0; q < drops; q++) {
          const z0 = h > 10 ? h * (q / drops + hash(i, q) * 0.3) : 0;
          const [x0, y0] = P(f, a + (hash(i, q, 2) - 0.5) * 0.02, 0);
          const [x1, y1] = P(f, a, -1);
          const fallU = easeInOut(u);
          const x = lerp(x0, x1, fallU);
          const y = lerp(y0 - z0, y1, fallU);
          const r = (2.5 + hash(i, q, 3) * 2) * (u >= 1 ? clamp(1 - (t - BREAK - 0.4) / 0.2) : 1);
          if (r > 0.3) d.dot(x, y, r, ACCENT);
        }
      }
    }
  };

  return {
    ground,
    items,
    over,
    // Under the black, and on the trodden ground between the foot and the black, nothing of the
    // map stands.
    covered: (x, y, t) => {
      const o = sh.outside(x, y);
      return o > blackEdge(sh.angle(x, y), t) || (t < BREAK && o > -0.4 && o < PRESS + 0.7);
    },
    under: (x, y, t) => sh.outside(x, y) > blackEdge(sh.angle(x, y), t),
    dark: (f, px, py, t) => overBlack(f, px, py, t),
    probe: (t) => ({ ...extra(t), bodies: drawn.bodies }),
  };
}

/** A brute or elite in the mass: from 20 s it wades toward the ramp's side, reaching the press's edge at 38 s. */
function wade(a0: number, d0: number, t: number, ramp: number): [number, number] {
  const u = easeInOut(clamp((t - 20) / 18));
  const toward = gap(a0, ramp) < 1.2 ? lerp(a0, ramp + (a0 > ramp ? 0.25 : -0.25), u * 0.6) : a0;
  return [toward, lerp(d0, PRESS + 0.6, u)];
}

/**
 * A lamp post at level 4: banded timber with a caged lamp, `high` px to the
 * lamp, in the city's colours with a paper line down its lantern side. Lit, a
 * disc of the accent 14 px across in an ink ring with a flat halo 40 px
 * across; dark, the cage in ink with no disc and no halo, the post leaning
 * toward the city and smoking in two loops. `dark` says whether a point on
 * screen lies over the black, where the smoke is in paper.
 */
function drawPost(
  d: Draw,
  x: number,
  y: number,
  high: number,
  lean: number,
  lit: boolean,
  rest: boolean,
  snapped: boolean,
  smoking: boolean,
  t: number,
  seed: number,
  toCity: number,
  dark: (px: number, py: number) => boolean = () => false,
): void {
  const strength = d.strength;
  if (rest) d.strength = strength * 0.5;
  const len = snapped ? high * 0.5 : high;
  const tx = x + Math.sin(lean) * len;
  const ty = y - Math.cos(lean) * len;
  const nx = Math.cos(lean) * 4;
  const ny = Math.sin(lean) * 4;
  // Its foot in the ground, a shadow, the shaft.
  d.hatch(d.round(x + 4, y + 2, 11, 3.5, 7), 2, INK, 0.5);
  d.body([x - nx * 1.4, y - ny, x + nx * 1.4, y + ny, tx + nx, ty + ny, tx - nx, ty - ny], {
    smooth: false,
    wash: TIMBER,
    washAlpha: rest ? 0.5 : 1,
    weight: CONTOUR,
    seed: seed + 2200,
  });
  // Iron bands at a third and two thirds.
  for (const u of [0.28, 0.62]) {
    if (u * high > len) continue;
    const bx = lerp(x, x + Math.sin(lean) * high, u);
    const by = lerp(y, y - Math.cos(lean) * high, u);
    d.line(bx - nx * 1.2, by - ny * 1.2, bx + nx * 1.2, by + ny * 1.2, CONTOUR, seed + 2300);
  }
  // The paper line down its lantern side.
  const ink = d.ink;
  d.ink = PAPER;
  d.line(
    x + toCity * 2.2 * Math.cos(lean),
    y + 2,
    tx + toCity * 2 * Math.cos(lean),
    ty + 4,
    FORM,
    seed + 2400,
    0.95,
  );
  d.ink = ink;
  if (snapped) {
    // The rest of it lies beside the stump, toward the city.
    const ex = tx + toCity * high * 0.45;
    const ey = ty + high * 0.35;
    d.body([tx - 3, ty, tx + 3, ty, ex + 3, ey, ex - 3, ey], {
      smooth: false,
      wash: TIMBER,
      washAlpha: 1,
      weight: CONTOUR,
      seed: seed + 2500,
    });
    d.strength = strength;
    return;
  }
  // The cage and its cap.
  const out = !lit && !rest;
  if (!out) d.fill(d.round(tx, ty - 1, 9, 9, 10), IRON, rest ? 0.4 : 0.9);
  if (lit) {
    d.fill(d.round(tx, ty, 20, 20, 16), ACCENT, 0.3 * d.strength);
    d.body(d.round(tx, ty, 7, 7, 10), {
      wash: ACCENT,
      washAlpha: 1,
      weight: CONTOUR,
      seed: seed + 2600,
    });
    d.dot(tx, ty - 1, 2.4, PAPER);
  } else if (rest) {
    d.body(d.round(tx, ty, 7, 7, 10), {
      wash: shade(TIMBER, 0.55),
      washAlpha: 0.4,
      weight: CONTOUR,
      seed: seed + 2600,
    });
  } else {
    // Out: an empty cage, its ring in ink with nothing in it.
    d.curve(d.round(tx, ty, 7, 7, 10), CONTOUR, seed + 2600, true);
  }
  for (const bar of [-3.5, 0, 3.5])
    d.line(tx + bar, ty - 7, tx + bar, ty + 7, out ? FORM : HAIR, seed + 2700);
  d.body([tx - 9, ty - 8, tx + 9, ty - 8, tx + 4, ty - 14, tx - 4, ty - 14], {
    smooth: false,
    wash: IRON,
    washAlpha: rest ? 0.4 : 1,
    weight: FORM,
    seed: seed + 2800,
  });
  if (smoking) {
    // Two loops of smoke at contour weight, each about 20 px across, drifting away from the city
    // as they rise: in paper where they lie over the black, in ink elsewhere. No soft puff.
    for (let q = 0; q < 2; q++) {
      const sway = Math.sin(t * 1.3 + q * 2 + seed) * 2.5;
      const sx = tx - toCity * (5 + q * 9) + sway;
      const sy = ty - 26 - q * 20;
      const r = 10 - q;
      d.ink = dark(sx, sy) ? PAPER : INK;
      d.curve(d.round(sx, sy, r, r * 0.8, 9, seed + q), CONTOUR, seed + 2900 + q, true);
    }
    d.ink = ink;
  }
  d.strength = strength;
}

// ---------------------------------------------------------------- the scenes

/** Sizes at 32 px a tile, given against the landing's own 23 so the drawing scales them by 32/23. */
const SIEGE_SIZES: Sizes = {
  citizen: CITIZEN,
  mite: 22.3,
  hound: 19.5,
  brute: 63.3,
  elite: 76.2,
  stroke: 106,
  rare: 69,
  unique: 115,
  burst: CITIZEN,
  ring: [106, 85],
  arrow: [21, 64],
  wet: 14,
};

interface Cast {
  citizens: CitizenPlan[];
  monsters: MonsterPlan[];
  groups: Group[];
  telegraphs: Script["telegraphs"];
  deaths: Script["deaths"];
  downs: Script["downs"];
  /** Aboard from the start, at their stations, and who leaves the deck when. */
  crew: Crew[];
  leaves: Record<number, number>;
  pennants: { who: number; at: number; rarity: number }[];
  /** Drops picked up: the marker's seed and when. */
  takes: { seed: number; at: number }[];
  /** Who is out from the start, by index: for the boarding stations. */
  homes: (i: number) => Station;
  called?: (t: number) => number[];
  lift?: (i: number, t: number) => number;
  logAt: (t: number) => Corners["log"];
  hauled?: { who: number; from: number };
}

/** Swarms and packs the script sends at a citizen: each from the press edge behind it, hunting it. */
class Sender {
  readonly monsters: MonsterPlan[] = [];
  readonly groups: Group[] = [];
  private readonly sh: Shield;
  constructor(sh: Shield) {
    this.sh = sh;
  }
  swarm(a: number, n: number, from: number, hunts: number, d = PRESS + 0.5, hp?: number): number[] {
    const g = this.groups.length;
    const [hx, hy] = this.sh.at(a, d);
    this.groups.push({ home: [hx, hy], aggro: 99, leash: 99 });
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const aa = a + ((hash(g, k) - 0.5) * 2) / this.sh.R(a);
      const [x, y] = this.sh.at(aa, d + (hash(k, g) - 0.5) * 0.8);
      out.push(this.monsters.length);
      this.monsters.push({
        kind: MITE,
        build: k % 3,
        x,
        y,
        behave: "runner",
        group: g,
        hunts,
        from,
        ...(hp ? { hp } : {}),
      });
    }
    return out;
  }
  pack(a: number, n: number, from: number, hunts: number, d = PRESS + 0.6): number[] {
    const g = this.groups.length;
    const [hx, hy] = this.sh.at(a, d);
    this.groups.push({ home: [hx, hy], aggro: 99, leash: 99 });
    const out: number[] = [];
    for (let k = 0; k < n; k++) {
      const [x, y] = this.sh.at(a + ((k - 1) * 0.9) / this.sh.R(a), d + (k % 2) * 0.5);
      out.push(this.monsters.length);
      this.monsters.push({
        kind: HOUND,
        build: k % 3,
        x,
        y,
        behave: "runner",
        group: g,
        hunts,
        from,
        leader: k === 0,
        hp: 900,
      });
    }
    return out;
  }
  one(
    kind: number,
    x: number,
    y: number,
    behave: MonsterPlan["behave"],
    from?: number,
    hunts?: number,
    hp?: number,
  ): number {
    const g = this.groups.length;
    this.groups.push({ home: [x, y], aggro: 2.5, leash: 4 });
    this.monsters.push({
      kind,
      build: 0,
      x,
      y,
      behave,
      group: g,
      ...(from !== undefined ? { from } : {}),
      ...(hunts !== undefined ? { hunts } : {}),
      ...(hp ? { hp } : {}),
    });
    return this.monsters.length - 1;
  }
}

/**
 * The siege at 15: six out in four places on four sides, nine aboard. A and
 * B at the east end, C on the far side, D and E at the south-west, F at the
 * west end. G comes down the ramp at 30 s and holds its foot.
 */
function castOf15(L: Landing, sh: Shield, crowd: Look[]): Cast {
  const S = new Sender(sh);
  const c = (i: number): Look => crowd[i] as Look;
  const foot: [number, number] = [L.city.x + rampFoot(1)[0], L.city.y + rampFoot(1)[1]];
  const top = rampTop(1);
  const rampTopAt: [number, number] = [L.city.x + top[0], L.city.y + top[1]];
  // Where each stands: angle round the foot and tiles outside it.
  const spot = {
    A: sh.at(-0.04, 1.0),
    B: sh.at(0.09, 1.9),
    C: sh.at(Math.atan2(-sh.R(-1.2), 4), 0.9),
    D: sh.at(2.3, 0.55),
    E: sh.at(2.42, 0.6),
    F: sh.at(3.08, 0.8),
  };
  const A = 0;
  const B = 1;
  const C = 2;
  const D = 3;
  const E = 4;
  const F = 5;
  // Under the hull between the legs: the way in from the far side and from the west.
  const underN: [number, number] = [L.city.x + 2.6, L.city.y - 1];
  const underW: [number, number] = [L.city.x - 3, L.city.y + 1.2];
  const hold = (p: [number, number], r = 2.6) => ({ t: 0, hold: p, r });
  const citizens: CitizenPlan[] = [
    {
      look: c(0),
      weapon: "blade",
      x: spot.A[0],
      y: spot.A[1],
      cadence: 0.9,
      orders: [
        hold(spot.A),
        { t: BREAK + 0.1, board: [[foot[0] + 3, foot[1] - 1], foot], run: true },
      ],
      pins: [12.9, 27.75],
    },
    {
      look: c(5),
      weapon: "maul",
      x: spot.B[0],
      y: spot.B[1],
      cadence: 1.7,
      prefers: MITE,
      orders: [
        hold(spot.B, 2.4),
        { t: BREAK + 0.1, go: [[foot[0] + 1.2, foot[1] + 0.4]], run: true },
        { t: BREAK + 2.6, hold: [foot[0] + 1.2, foot[1] + 0.4], r: 2.4 },
        { t: 54, board: [foot], run: true },
      ],
      pins: [12.95, 27.9, 47.5],
    },
    {
      look: c(7),
      weapon: "spear",
      // In from the north ahead of the black at the start.
      x: spot.C[0] + 1,
      y: spot.C[1] - 5.5,
      cadence: 1.1,
      orders: [
        { t: 0, go: [spot.C] },
        { t: 4.2, fight: sh.at(Math.atan2(-sh.R(-1.2), 4), PRESS + 0.2), r: 2.8 },
        { t: 25.4, go: [sh.at(Math.atan2(-sh.R(-1.2), 4) + 0.06, 1.4)] },
        // With the rare on its bundle it turns on a swarm that comes at it, then walks in.
        { t: 27.2, hold: sh.at(Math.atan2(-sh.R(-1.2), 4) + 0.06, 1.4), r: 2.6 },
        { t: 28.3, board: [underN, foot] },
      ],
      pins: [13.0, 23.9, 27.85],
    },
    {
      look: c(2),
      weapon: "bow",
      // In from the south-west with a bundle.
      x: spot.D[0] - 5,
      y: spot.D[1] + 4,
      haul: 0.4,
      stands: true,
      cadence: 1.0,
      orders: [
        { t: 0, go: [spot.D] },
        { t: 5, hold: spot.D, r: 5 },
        { t: BREAK + 0.1, board: [[foot[0] - 4, foot[1] + 1.4], foot], run: true },
      ],
      pins: [13.05, 27.8],
    },
    {
      look: c(4),
      weapon: "pot",
      x: spot.E[0],
      y: spot.E[1],
      haul: 0.9,
      cadence: 3.4,
      stands: true,
      orders: [
        hold(spot.E, 5),
        { t: BREAK + 0.1, board: [[foot[0] - 4.5, foot[1] + 1.6], foot], run: true },
      ],
      pins: [27.5],
    },
    {
      look: c(9),
      weapon: "blade",
      // In from the west at the start.
      x: spot.F[0] - 7,
      y: spot.F[1] - 0.5,
      cadence: 0.95,
      orders: [
        { t: 0, go: [spot.F] },
        { t: 4.6, hold: spot.F, r: 2.6 },
        { t: BREAK + 0.1, board: [underW, [L.city.x + 3, L.city.y + 2.2], foot], run: true },
      ],
      pins: [12.85, 27.95],
    },
    {
      look: c(12),
      weapon: "blade",
      x: rampTopAt[0] + 0.3,
      y: rampTopAt[1],
      z: 2.3,
      ramp: Math.hypot(foot[0] - rampTopAt[0], foot[1] - rampTopAt[1]),
      from: 30,
      cadence: 0.95,
      orders: [
        { t: 0, go: [[foot[0] + 0.3, foot[1] + 0.9]] },
        { t: 33, hold: [foot[0] + 0.3, foot[1] + 0.9], r: 2.4 },
        { t: 54, board: [foot], run: true },
      ],
    },
  ];
  // Siege swarms that come at each place from the press, and the elite C fights at the heap's foot.
  const aA = sh.angle(spot.A[0], spot.A[1]);
  const aC = sh.angle(spot.C[0], spot.C[1]);
  const aD = sh.angle(spot.D[0], spot.D[1]);
  const aF = sh.angle(spot.F[0], spot.F[1]);
  for (const at of [10.6, 16.5, 22, 26.2, 32, 37.5]) S.swarm(aA + 0.05, 9, at, B, PRESS + 0.5, 220);
  for (const at of [11.0, 19.5, 25.5, 31, 36.5]) S.swarm(aA - 0.12, 6, at, A, PRESS + 0.4, 160);
  for (const at of [11.4, 18.5, 26.0, 33]) S.swarm(aD - 0.05, 8, at, D, PRESS + 0.5, 160);
  for (const at of [11.2, 17.5, 25.6, 31.5, 37]) S.swarm(aF, 7, at, F, PRESS + 0.4, 180);
  // The elite at the foot of the heap, on the trodden ground: its rare drops there.
  const [ex, ey] = sh.at(aC + 0.02, PRESS - 0.4);
  const elite = S.one(ELITE, ex, ey, "guard", undefined, undefined, 5200);
  S.swarm(aC - 0.08, 6, 8, C, PRESS + 0.5, 140);
  S.swarm(aC + 0.1, 6, 25.8, C, PRESS + 0.4, 200);
  // After the break: the horde two or three tiles behind each runner.
  const behind = (who: number, a: number, n: number): void => {
    S.swarm(a, n, BREAK + 0.25, who, 1.2, 600);
  };
  behind(A, aA, 6);
  behind(D, aD, 7);
  behind(E, aD + 0.1, 5);
  behind(F, aF, 7);
  S.pack(aA + 0.15, 3, BREAK + 0.4, B, 1.6);
  // The brute whose blow throws E at 46 s.
  const [bx, by] = sh.at(aD + 0.25, -2.5);
  const brute = S.one(BRUTE, bx, by, "runner", BREAK + 1.6, E, 9000);
  const ramp = rampTopAt;
  const crew: Crew[] = [
    // Four at the rail looking out, two of them pointing.
    ...[0, 2, 4, 5].map((r, q) => {
      const [x, y, face] = RAIL_SPOTS[r] as readonly [number, number, number];
      return {
        look: c([10, 11, 13, 14][q] as number),
        station: { x, y, z: 0, act: "rail" as const, face, range: 0 },
        ...(q < 2 ? { pose: pose({ face, arm: 1.75, arm2: 0.2, lean: 0.12, tool: "none" }) } : {}),
      };
    }),
    // At the winch at the ramp's head.
    {
      look: c(8),
      station: {
        x: ramp[0] - 0.9 - L.city.x,
        y: (ramp[1] - L.city.y) / 0.8 - 0.6,
        z: 0,
        act: "rail",
        face: 1,
        range: 0,
      },
    },
    // Two carrying a bundle to the hold.
    { look: c(1), station: STATIONS[STATION.carrier] as Station },
    { look: c(3), station: { ...(STATIONS[STATION.carrier] as Station), x: 0.2, y: 0.3 } },
    { look: c(6), station: STATIONS[STATION.bench] as Station },
    { look: c(12), station: STATIONS[STATION.lookout] as Station },
  ];
  const homes: Station[] = [
    STATIONS[STATION.cook] as Station,
    STATIONS[STATION.smith] as Station,
    STATIONS[STATION.navigator] as Station,
    STATIONS[STATION.eater] as Station,
    STATIONS[STATION.sleeper] as Station,
    STATIONS[STATION.helm] as Station,
    STATIONS[STATION.bench2] as Station,
  ];
  const rare = itemName(57, 2, 1);
  return {
    citizens,
    monsters: S.monsters,
    groups: S.groups,
    telegraphs: [{ who: brute, at: 46, target: E, throw: 3.2 }],
    deaths: [{ who: elite, at: 24, drop: 2 }],
    downs: [{ who: E, at: 46.85 }],
    crew,
    // G is the lookout: it comes down at 30 s.
    leaves: { [c(12).id]: 30 },
    pennants: [{ who: C, at: 27.1, rarity: 2 }],
    takes: [{ seed: elite, at: 27.1 }],
    homes: (i) => homes[i] as Station,
    lift: (i, t) => (i === E && t > 56 ? lerp(0, 2.2, easeInOut(clamp((t - 56) / 3))) : 0),
    hauled: { who: E, from: 56 },
    logAt: (t) =>
      t >= 46.85
        ? { who: c(4).name, rgb: c(4).cloak, what: "down", whatRgb: 0x2f2621 }
        : t >= 27.1
          ? { who: c(7).name, rgb: c(7).cloak, what: rare, whatRgb: itemInk(2) }
          : { who: c(5).name, rgb: c(5).cloak, what: itemName(23, 2, 1), whatRgb: itemInk(2) },
  };
}

/**
 * The siege at 150: 106 aboard and 44 out in twelve places of two to five:
 * three on the far side, three on the near side, two at each end and one at
 * each of two corners, three tiles or more apart, at different depths across
 * the trodden ground. Fourteen cut the margin and come in from 36 s; the
 * other thirty run in at the break.
 */
function castOf150(L: Landing, sh: Shield, crowd: Look[]): Cast {
  const S = new Sender(sh);
  const foot: [number, number] = [L.city.x + rampFoot(1)[0], L.city.y + rampFoot(1)[1]];
  const groups: { a: number; n: number }[] = [
    { a: -2.05, n: 4 },
    { a: -1.55, n: 4 },
    { a: -1.0, n: 4 },
    { a: 1.15, n: 4 },
    { a: 1.6, n: 5 },
    { a: 2.05, n: 3 },
    { a: -0.22, n: 4 },
    { a: 0.2, n: 4 },
    { a: Math.PI - 0.2, n: 4 },
    { a: -Math.PI + 0.22, n: 3 },
    { a: -0.62, n: 3 },
    { a: 2.55, n: 2 },
  ];
  const aboard = 106;
  const citizens: CitizenPlan[] = [];
  const random = rng(1504);
  const early = new Set<number>();
  groups.forEach((g, q) => {
    const nearRamp = gap(g.a, sh.rampAngle) < 0.75;
    for (let m = 0; m < g.n; m++) {
      const i = citizens.length;
      const look = crowd[aboard + i] as Look;
      const along = (m - (g.n - 1) / 2) * 1.15 + (random() - 0.5) * 0.4;
      const a = g.a + along / sh.R(g.a);
      const d = 0.45 + ((m * 0.37 + q * 0.21) % 1) * 1.3;
      const [x, y] = sh.at(a, d);
      const weapon = WEAPONS[(look.id * 7 + m) % WEAPONS.length] as Weapon;
      // Fourteen cut the margin: those nearest the ramp, and a few from the ends.
      const cut =
        nearRamp || (q === 6 && m < 2) || (q === 4 && m < 2) || (q === 3 && m < 2) || q === 11;
      if (cut) early.add(i);
      const leave = cut ? 33.5 + (i % 5) * 0.6 : BREAK + 0.1 + random() * 0.4;
      const route: [number, number][] =
        Math.sin(a) < -0.3
          ? [[L.city.x + (x > L.city.x ? 2.6 : -2.4), L.city.y - 1], foot]
          : Math.cos(a) < -0.5
            ? [[L.city.x - 3, L.city.y + 1.2], [L.city.x + 3, L.city.y + 2.2], foot]
            : [[lerp(x, foot[0], 0.5), lerp(y, foot[1], 0.5) + 0.6], foot];
      citizens.push({
        look,
        weapon,
        x,
        y,
        cadence: 1.3 + (i % 4) * 0.2,
        haul: (i % 3) * 0.35,
        orders: [
          { t: 0, hold: [x, y], r: 2.4 },
          { t: leave, board: route, run: true },
        ],
      });
    }
    // Swarms at each place through the siege.
    const first = citizens.length - g.n;
    for (let s = 0; s < 5; s++)
      S.swarm(
        g.a + (s % 2 ? 0.06 : -0.06),
        7,
        10.5 + s * 6 + q * 0.4,
        first + (s % g.n),
        PRESS + 0.5,
        180,
      );
  });
  // After the break the horde comes in behind the runners in clumps.
  groups.forEach((g, q) => {
    const first =
      citizens.slice(
        0,
        groups.slice(0, q + 1).reduce((n, h) => n + h.n, 0),
      ).length - g.n;
    if (early.has(first)) return;
    S.swarm(g.a, 6, BREAK + 0.3, first, 1.2, 600);
  });
  const stations = crowdStations(aboard);
  const crew: Crew[] = Array.from({ length: aboard }, (_, k) => ({
    look: crowd[k] as Look,
    station: stations[k] as Station,
  }));
  const extra = crowdStations(150);
  return {
    citizens,
    monsters: S.monsters,
    groups: S.groups,
    telegraphs: [],
    deaths: [],
    downs: [],
    crew,
    leaves: {},
    pennants: [],
    takes: [],
    homes: (i) => extra[aboard + (i % 44)] as Station,
    called: (t) => (t >= 24 && t < 30 ? [5, 27] : t >= 40 && t < 46 ? [12, 31] : []),
    logAt: () => ({
      who: (crowd[aboard + 5] as Look).name,
      rgb: (crowd[aboard + 5] as Look).cloak,
      what: itemName(61, 2, 0),
      whatRgb: itemInk(2),
    }),
  };
}

/** The brutes and elites in the mass: two brutes and an elite toward the ramp's side, a brute and an elite at the west-north-west. */
function massOf(sh: Shield): {
  brutes: [number, number, number][];
  elites: [number, number, number][];
} {
  const r = sh.rampAngle;
  return {
    brutes: [
      [1, r - 0.42, 4.2],
      [2, r - 0.08, 6.4],
      [3, -2.55, 4.6],
    ],
    elites: [
      [4, r - 0.25, 7.2],
      [5, -2.85, 6.6],
    ],
  };
}

function siege(count: 15 | 150): LandingScene {
  const L = expeditionLanding();
  const sh = makeShield(L, SIEGE_LEVEL);
  const places = makePlaces();
  const press = makePress(sh);
  const mass = massOf(sh);
  const crowd = crowdOf(count);
  const cast = count === 15 ? castOf15(L, sh, crowd) : castOf150(L, sh, crowd);
  const foot: [number, number] = [L.city.x + rampFoot(1)[0], L.city.y + rampFoot(1)[1]];
  const script: Script = {
    seed: 4130 + count,
    seconds: 60.5,
    tempo: 1,
    toughness: 1,
    strokeHits: 4,
    citizens: cast.citizens,
    monsters: cast.monsters,
    groups: cast.groups,
    telegraphs: cast.telegraphs ?? [],
    deaths: cast.deaths ?? [],
    downs: cast.downs ?? [],
    ramp: foot,
    // Nothing crosses the shield before the break: the horde is held at its wall all round.
    bar: {
      until: BREAK,
      out: (x, y, citizen) => {
        const margin = citizen ? 0.4 : 0.15;
        if (sh.outside(x, y) >= margin) return null;
        return sh.at(sh.angle(x, y), margin);
      },
    },
  };
  let fray: Fray | null = null;
  const get = (): Fray => {
    if (!fray) fray = runFray(script);
    return fray;
  };
  const crewAt = (t: number): Crew[] => {
    const f = get();
    const out = cast.crew.filter((m) => (cast.leaves[m.look.id] ?? Number.POSITIVE_INFINITY) > t);
    // Those who have come aboard go to a place on the deck.
    cast.citizens.forEach((p, i) => {
      if ((f.boarded[i] ?? Number.POSITIVE_INFINITY) <= t)
        out.push({ look: p.look, station: cast.homes(i) });
    });
    return out;
  };
  // The camera: it closes from 27 px a tile to 32 over the march's last six tiles, holds, and
  // starts to close again as the black reaches the hull.
  const view = (t: number): View => {
    const T =
      t < 10
        ? lerp(27, SIEGE_TILE, easeInOut(t / 10))
        : t < 57
          ? SIEGE_TILE
          : lerp(SIEGE_TILE, 34, easeInOut(clamp((t - 57) / 3)));
    return { T, ox: WIDTH / 2 - sh.cx * T, oy: HEIGHT / 2 - sh.cy * T };
  };
  const corners = (t: number): Corners => {
    const f = get();
    const kills = 1388 + f.kills.filter((k) => k.t <= t).length;
    const base = {
      head: `${L.size} ${L.levels[0]}–${L.levels[1]}`,
      lines: ["packs ×2", "rares +40%"],
      log: cast.logAt(t),
      counts: [outAt(f, t), crewAt(t).length, kills, 31] as const,
    };
    if (t < LIGHT)
      return {
        ...base,
        left: LIGHT - t,
        to: "march",
        gone: clamp((MARCH - LANDED - (LIGHT - t)) / (MARCH - LANDED)),
        horn: 1,
        late: false,
      };
    if (t < BREAK)
      return {
        ...base,
        left: 0,
        to: "march",
        gone: 1,
        horn: 1,
        late: false,
        shield: { lit: litAt(sh, t), loss: lossAt(sh, t) },
      };
    // From the break the clock comes back, counting to lift-off thirty seconds on, in red-brown.
    return {
      ...base,
      left: 30 - (t - BREAK),
      to: "lift-off",
      gone: clamp((t - BREAK) / 30),
      horn: 1,
      late: true,
    };
  };
  const extra = (t: number): Record<string, unknown> => {
    const lit = litAt(sh, t);
    const f = get();
    const m = (list: [number, number, number][]) =>
      list.map(([, a0, d0]) => {
        const [a, d] = wade(a0, d0, t, sh.rampAngle);
        const [x, y] = sh.at(a, d);
        const v = view(t);
        return {
          tiles: [round2(x), round2(y)],
          frame: [Math.round(v.ox + x * v.T), Math.round(v.oy + y * v.T)],
        };
      });
    const v = view(t);
    return {
      // Where the plan is drawn: frame pixels = offset + tiles × px a tile.
      view: [round2(v.ox), round2(v.oy), round2(v.T)],
      posts: sh.posts.length,
      lit: lit.filter(Boolean).length,
      litPosts: lit.flatMap((on, k) => (on ? [k] : [])),
      loss: Math.round(lossAt(sh, t) * 10) / 10,
      pool: Math.round(poolAt(sh, places, t) * 1000) / 1000,
      brutes: t < BREAK + 1 ? m(mass.brutes) : [],
      elites: t < BREAK + 1 ? m(mass.elites) : [],
      monstersInScript: aliveAt(f, t),
    };
  };
  const layer = siegeLayer(L, sh, places, press, mass, extra);
  const stage: Stage = {
    land: L,
    fray: get,
    seconds: 60,
    sizes: SIEGE_SIZES,
    view,
    size: (t) => CITIZEN * (view(t).T / SIEGE_TILE),
    city: (t) => ({
      gait: 0,
      walk: 0,
      settle: 1,
      ramp: t < 56 ? 1 : 1 - easeInOut(clamp((t - 56) / 2.5)),
      rampSide: 1,
      detail: 0,
      size: CITIZEN * (view(t).T / SIEGE_TILE),
      crew: crewAt(t),
      lantern: 1,
    }),
    black: () => null,
    corners,
    horde: true,
    siege: layer,
    pennantsFrom: cast.pennants,
    // A rare that is taken goes onto its taker's bundle.
    taken: (seed, t) => cast.takes.some((q) => q.seed === seed && t >= q.at),
    ...(cast.called ? { called: cast.called } : {}),
    ...(cast.lift ? { lift: cast.lift } : {}),
    hauls: Object.fromEntries(cast.citizens.map((p, i) => [i, p.haul ?? 0])),
    firstTags: () => [],
  };
  const scene = landingScene(stage);
  if (!cast.hauled) return scene;
  const hauled = cast.hauled;
  return {
    ...scene,
    draw(d: Draw, t: number): void {
      scene.draw(d, t);
      if (t < hauled.from) return;
      // The winch line from the ramp's head down to the one being hauled up, and its bundle falling.
      const v = view(t);
      const b = scene.probe(t).citizens.find((q) => q.key === hauled.who);
      if (!b) return;
      const top = rampTop(1);
      const wx = v.ox + (L.city.x + top[0] - 0.9) * v.T;
      const wy = v.oy + (L.city.y + top[1]) * v.T - 2.6 * UP * v.T;
      d.line(wx, wy, b.x, b.y - b.size * 1.05, FORM, 99);
      const u = clamp((t - hauled.from - 0.6) / 1.2);
      if (u > 0 && u < 1) {
        const bx = b.x + 8;
        const by = lerp(
          b.y - b.size * 0.6,
          b.y + 2.2 * UP * v.T * easeInOut(clamp((t - hauled.from) / 3)),
          u * u,
        );
        d.body(d.round(bx, by, 9, 7, 8, 5), {
          wash: 0xc9a36b,
          washAlpha: 1,
          weight: FORM,
          seed: 98,
        });
      }
      drawFrameRule(d);
    },
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * The pool, 1 full to 0 at the break. Hits drain it: each heap's blows on
 * the wall, three times as hard where the post holding that arc is dark. It
 * is scaled so that it runs out at the break.
 */
export function poolAt(sh: Shield, places: Place[], t: number): number {
  const drain = (until: number): number => {
    let sum = 0;
    for (let s = LIGHT; s < until; s += 0.25)
      for (const pl of places) {
        if (s < pl.t0) continue;
        const post = sh.posts.reduce((m, p) => (gap(p.a, pl.a) < gap(m.a, pl.a) ? p : m));
        sum += s >= post.darkAt ? DARK_HIT : 1;
      }
    return sum;
  };
  const total = drain(BREAK);
  return t >= BREAK ? 0 : 1 - drain(t) / total;
}

export const siegeScene = (): LandingScene => siege(15);
export const siege150Scene = (): LandingScene => siege(150);
/** For the tests: the scene's shield and its heaps. */
export function siegeShield(): { sh: Shield; places: Place[] } {
  const L = expeditionLanding();
  const sh = makeShield(L, SIEGE_LEVEL);
  return { sh, places: makePlaces() };
}

// ---------------------------------------------------------------- the five shields side by side

/**
 * The far third of the shield at full strength at levels 0, 2, 4, 7 and 10,
 * side by side, with a citizen standing by each, and no lettering: timber and
 * rope, banded timber, brass with a pennant, carved and painted, taller and
 * closer at each step.
 */
export function shieldLevelsSheet(): Scene {
  const levels = [0, 2, 4, 7, 10];
  return {
    duration: 1,
    draw(d: Draw, t: number): void {
      d.surface.paper(0, 0, WIDTH, HEIGHT);
      const w = (FRAME.x1 - FRAME.x0) / levels.length;
      const scale = 0.95;
      levels.forEach((level, q) => {
        const x0 = FRAME.x0 + q * w;
        const posts = postsFor(level);
        const tier = level <= 2 ? 0 : level <= 5 ? 1 : level <= 8 ? 2 : 3;
        const high = [1.25, 1.5, 1.75, 2][tier] as number;
        const lamp = high * CITIZEN * scale;
        const wall = lamp * 1.25;
        const apart = (2625 / posts) * scale;
        const footY = 660;
        // The far wall: whole, the accent's wash, hatched in lamp ink, its top at contour weight.
        const n = 40;
        const span = w - 40;
        const pts: number[] = [];
        const topPts: number[] = [];
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const x = x0 + 20 + u * span;
          const arch = Math.sin(u * Math.PI);
          const y = footY - 60 * arch;
          const h = wall * Math.sqrt(arch);
          pts.push(x, y);
          topPts.push(x, y - h);
        }
        const body = [...pts];
        for (let i = topPts.length - 2; i >= 0; i -= 2)
          body.push(topPts[i] as number, topPts[i + 1] as number);
        d.fill(body, LIT, 1);
        const ink = d.ink;
        d.ink = LAMP_INK;
        for (let i = 1; i < n; i += 2)
          d.line(
            pts[i * 2] as number,
            (pts[i * 2 + 1] as number) - 2,
            (topPts[i * 2] as number) + 3,
            (topPts[i * 2 + 1] as number) + 3,
            HAIR,
            i,
          );
        d.ink = ink;
        d.path(topPts, CONTOUR, 300 + q);
        d.path(pts, HEAVY, 310 + q);
        // Its posts at their spacing along the foot.
        const count = Math.max(2, Math.floor(span / apart) + 1);
        for (let p = 0; p < count; p++) {
          const u = (p + 0.5) / count;
          const x = x0 + 20 + u * span;
          const y = footY - 60 * Math.sin(u * Math.PI);
          drawLevelPost(d, x, y, lamp, tier, q * 10 + p, t);
        }
        // A citizen standing by, for scale.
        const look = crowdOf(5)[q] as Look;
        drawCitizen(
          d,
          look,
          standing(look.id, t, 1),
          x0 + w * 0.5,
          footY + 90,
          CITIZEN * scale,
          detailFor(CITIZEN),
        );
      });
      drawFrameRule(d);
    },
  };
}

/** A post in one of the four builds: timber and rope, banded timber, brass, carved and painted. */
function drawLevelPost(
  d: Draw,
  x: number,
  y: number,
  high: number,
  tier: number,
  seed: number,
  t: number,
): void {
  const wash = [TIMBER, TIMBER, shade(TIMBER, 0.1), 0x8a4a3a][tier] as number;
  const half = 3 + tier * 0.6;
  d.hatch(d.round(x + 4, y + 2, 11, 3.5, 7), 2, INK, 0.5);
  d.body([x - half * 1.3, y, x + half * 1.3, y, x + half, y - high, x - half, y - high], {
    smooth: false,
    wash,
    washAlpha: 1,
    weight: CONTOUR,
    seed: seed + 10,
  });
  if (tier === 0) {
    // Rope lashings.
    for (const u of [0.3, 0.55])
      d.line(x - half * 1.4, y - high * u, x + half * 1.4, y - high * u + 3, FORM, seed + 11);
  } else if (tier === 1) {
    for (const u of [0.28, 0.62])
      d.line(x - half * 1.3, y - high * u, x + half * 1.3, y - high * u, CONTOUR, seed + 12);
  } else if (tier === 2) {
    for (const u of [0.2, 0.5, 0.8])
      d.fill(d.box(x - half * 1.4, y - high * u - 2, x + half * 1.4, y - high * u + 2), BRASS, 1);
    // A pennant under the lamp.
    d.body([x + half, y - high * 0.86, x + half + 16, y - high * 0.8, x + half, y - high * 0.74], {
      smooth: false,
      wash: 0x3e70a2,
      washAlpha: 1,
      weight: FORM,
      seed: seed + 13,
    });
  } else {
    // Carved and painted: notches and a painted band.
    d.fill(d.box(x - half, y - high * 0.5, x + half, y - high * 0.42), 0x3e70a2, 1);
    for (const u of [0.2, 0.32, 0.64, 0.76])
      d.line(x - half, y - high * u, x + half, y - high * u - 3, FORM, seed + 14);
  }
  const ink = d.ink;
  d.ink = PAPER;
  d.line(x - half * 0.6, y - 2, x - half * 0.5, y - high + 4, FORM, seed + 15, 0.95);
  d.ink = ink;
  const lx = x;
  const ly = y - high;
  d.fill(d.round(lx, ly, 20, 20, 16), ACCENT, 0.3);
  if (tier === 0) {
    // An open flame in a cup.
    d.body([lx - 7, ly + 2, lx + 7, ly + 2, lx + 5, ly + 7, lx - 5, ly + 7], {
      smooth: false,
      wash: IRON,
      washAlpha: 1,
      weight: FORM,
      seed: seed + 16,
    });
    d.body([lx - 4, ly + 2, lx, ly - 10 - Math.sin(t * 9) * 1.5, lx + 4, ly + 2], {
      smooth: false,
      wash: ACCENT,
      washAlpha: 1,
      weight: FORM,
      seed: seed + 17,
    });
  } else {
    d.body(d.round(lx, ly, 7, 7, 10), {
      wash: ACCENT,
      washAlpha: 1,
      weight: CONTOUR,
      seed: seed + 18,
    });
    if (tier === 1)
      for (const bar of [-3.5, 0, 3.5]) d.line(lx + bar, ly - 7, lx + bar, ly + 7, HAIR, seed + 19);
    if (tier === 3) {
      d.body(d.round(lx - 3, ly, 2.5, 4, 6), {
        wash: PAPER,
        washAlpha: 1,
        weight: HAIR,
        seed: seed + 20,
      });
      d.body(d.round(lx + 3, ly, 2.5, 4, 6), {
        wash: PAPER,
        washAlpha: 1,
        weight: HAIR,
        seed: seed + 21,
      });
    } else d.dot(lx, ly - 1, 2.4, PAPER);
    d.body([lx - 9, ly - 8, lx + 9, ly - 8, lx + 4, ly - 14, lx - 4, ly - 14], {
      smooth: false,
      wash: tier === 2 ? BRASS : IRON,
      washAlpha: 1,
      weight: FORM,
      seed: seed + 22,
    });
  }
}
