// The fighting on a landing, as a script (docs/art.md, sections 6, 9 and 10).
// Citizens follow orders (walk a route, fight round a place, work a chest,
// hold the ramp); monsters keep to their pockets doing something a viewer
// reads as intent until a citizen comes near, then hunt. The script is
// stepped once, thirty times a second, from a seed, and everything the
// drawing needs is recorded so a scene can read any moment back by time:
// where each body is, what it is doing, and every blow, shot, kill and drop.
// The same script and seed always give the same fight.

import type { Look } from "./figure.ts";
import { clamp, hash, rng } from "./geom.ts";

export const MITE = 0;
export const HOUND = 1;
export const BRUTE = 2;
export const ELITE = 3;

export type Weapon = "blade" | "maul" | "spear" | "bow" | "sling" | "pot" | "gun" | "none";

export const STEP = 1 / 30;

/** What a body is doing, recorded each step. */
export const ACT = {
  aboard: 0,
  idle: 1,
  walk: 2,
  run: 3,
  swing: 4,
  shoot: 5,
  work: 6,
  hurt: 7,
  thrown: 8,
  down: 9,
  // monsters
  sleep: 10,
  pace: 11,
  gnaw: 12,
  stalk: 13,
  chase: 14,
  coil: 15,
  lunge: 16,
  wind: 17,
  slam: 18,
  dead: 19,
  hidden: 20,
  boil: 21,
  rise: 22,
} as const;

export type Order =
  | { t: number; go: [number, number][]; run?: boolean; route?: boolean }
  | { t: number; fight: [number, number]; r: number }
  | { t: number; work: [number, number]; kind: "chest" | "scrap" | "seam" }
  | { t: number; hold: [number, number]; r: number }
  | { t: number; down: true }
  | { t: number; board: [number, number][]; run?: boolean };

export interface CitizenPlan {
  look: Look;
  weapon: Weapon;
  x: number;
  y: number;
  /** Height off the ground at the start: at the top of the ramp, say. */
  z?: number;
  /** With `z`: it walks down the ramp, coming to the ground after this many tiles. */
  ramp?: number;
  /** Walking speed in tiles a second, if not the usual. */
  pace?: number;
  /** In a fight it goes for this kind first. */
  prefers?: number;
  /** From when it is out; before that it is aboard. */
  from?: number;
  orders: Order[];
  haul?: number;
  /** A pennant in a rarity's colour on its bundle. */
  pennant?: number;
  /** Seconds between blows or shots, if not its weapon's own. */
  cadence?: number;
  /** Times at which one of its blows lands or one of its shots looses, whatever the cadence. */
  pins?: number[];
  /** A blow landing at this time is a crit of this value. */
  crit?: { t: number; value: number };
  /** While it fights, the ramp's foot and how far from it, for those running in with runners behind. */
  runs?: boolean;
  /** It holds its ground with a bow or a pot: it neither steps back from what comes near nor walks after what is out of reach. */
  stands?: boolean;
}

export type Behave = "sleep" | "awake" | "pace" | "gnaw" | "boil" | "guard" | "runner" | "wave";

export interface MonsterPlan {
  kind: number;
  build: number;
  x: number;
  y: number;
  behave: Behave;
  group: number;
  /** Not on the map until then: it comes out of the ground or the den's mouth. */
  from?: number | undefined;
  /** A runner goes for this citizen from the start. */
  hunts?: number;
  /** The leader of a pack is a head taller. */
  leader?: boolean;
  /** One of every pack at rest is drawn alert, so the pack shows one darker head. */
  sentinel?: boolean;
  hp?: number;
}

/** How awake a monster is (docs/art.md, section 6): its ink follows this. */
export const REST = 0;
export const ALERT = 1;
export const AWAKE = 2;
/** Seconds to wake from rest, and to go back to rest from awake. */
const WAKE_UP = 0.3;
const WAKE_DOWN = 2;

export interface Group {
  /** Where it holds, and how near a citizen must come before it hunts. */
  home: [number, number];
  aggro: number;
  /** How far from home it will follow. */
  leash: number;
  /** For sleepers: how near before they wake. */
  wake?: number | undefined;
}

export interface Telegraph {
  /** Which monster, and when its blow lands. */
  who: number;
  at: number;
  /** The citizen it throws, and how far. */
  target: number;
  throw: number;
}

export interface Script {
  seed: number;
  seconds: number;
  /** Seconds between blows and shots are multiplied by this; over 1 is slower. */
  tempo?: number;
  /** Monsters' hitpoints are multiplied by this. */
  toughness?: number;
  citizens: CitizenPlan[];
  monsters: MonsterPlan[];
  groups: Group[];
  /** Heavy blows that land at a given time. */
  telegraphs?: Telegraph[];
  /** Monsters that die at a given time, whatever their hitpoints. */
  deaths?: { who: number; at: number; drop?: number }[];
  /** A citizen goes down at a time. */
  downs?: { who: number; at: number }[];
  /** A chest opens: its rare rises and these monsters come up out of the ground round it. */
  chests?: { at: number; x: number; y: number; who: number }[];
  /** A group starts hunting at a time, a given citizen if it says so. */
  rouse?: { group: number; at: number; hunts?: number }[];
  /** How many bodies one blade stroke can take; six if not said. */
  strokeHits?: number;
  /** Guns and bows aboard: they shoot at the nearest monster in range. */
  turrets?: {
    x: number;
    y: number;
    z: number;
    range: number;
    period: number;
    rgb: number;
    weapon: Weapon;
    pins?: number[];
    /** The way it faces: it shoots only at what is that side of it. */
    dir?: [number, number];
  }[];
  /** Where the ramp's foot is, for anyone boarding. */
  ramp: [number, number];
  /**
   * A shield nothing gets through until `until`: `out` gives the nearest place
   * outside it for a body that is inside, or null. Monsters are held outside
   * it, and so are citizens while they hold or fight at its edge.
   */
  bar?: { until: number; out(x: number, y: number, citizen: boolean): [number, number] | null };
}

export interface Blow {
  who: number;
  weapon: Weapon;
  start: number;
  contact: number;
  x: number;
  y: number;
  /** The blow's direction. */
  dx: number;
  dy: number;
  hits: number;
  value: number;
  crit: boolean;
  /** It killed something bigger than fodder. */
  big: boolean;
}

export interface Shot {
  /** The citizen who shot it, or -1 for a gun aboard. */
  who: number;
  rgb: number;
  weapon: Weapon;
  t0: number;
  t1: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
}

export interface Kill {
  t: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  kind: number;
  seed: number;
}

export interface Marker {
  t: number;
  x: number;
  y: number;
  rarity: number;
  seed: number;
}

export interface Hit {
  t: number;
  /** Where the blow was, in tiles: for a swing, just ahead of the one who struck. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  value: number;
  crit: boolean;
  big: boolean;
  /** The citizen who struck, or -1 for a gun aboard or a monster's blow. */
  who: number;
  /** Where it landed on what was struck, in tiles; `lift` is how high up that is, in citizen heights. */
  ax: number;
  ay: number;
  lift: number;
}

/**
 * How far apart two citizens holding a place keep, in tiles: side by side, and one behind the
 * other, where the one in front would otherwise cover the other's head.
 */
const APART_X = 1.2;
const APART_Y = 1.95;

/** How high up a struck monster is hit, and a struck citizen, in citizen heights. */
const ON_MONSTER = 0.2;
const ON_CITIZEN = 0.45;

export interface Fray {
  script: Script;
  steps: number;
  /** Per citizen and step: x, y, z, face, act, the act's start. */
  cit: Float32Array;
  /** Per monster and step: x, y, z, face, act, the act's start, ink left, how awake (0 to 2). */
  mon: Float32Array;
  blows: Blow[];
  shots: Shot[];
  kills: Kill[];
  markers: Marker[];
  hits: Hit[];
  burns: { t: number; x: number; y: number }[];
  slams: { t: number; x: number; y: number; w: number; h: number }[];
  thrusts: { t: number; x0: number; y0: number; x1: number; y1: number }[];
  telegraphs: { t0: number; t1: number; x: number; y: number; dx: number; dy: number; w: number }[];
  /** Times a citizen came aboard or went down. */
  boarded: number[];
  downed: number[];
}

const C = 6;
const M = 8;

const WEAPON = {
  blade: { reach: 1.05, period: 0.72, contact: 0.23, dmg: 64 },
  maul: { reach: 1.2, period: 1.25, contact: 0.42, dmg: 150 },
  spear: { reach: 2.1, period: 1.0, contact: 0.3, dmg: 125 },
  bow: { reach: 6.5, period: 0.9, contact: 0.15, dmg: 92 },
  sling: { reach: 5.5, period: 1.0, contact: 0.2, dmg: 70 },
  pot: { reach: 6.0, period: 2.4, contact: 0.3, dmg: 58 },
  gun: { reach: 9.0, period: 1.6, contact: 0.1, dmg: 260 },
  none: { reach: 1, period: 1, contact: 0.2, dmg: 0 },
} as const;

const SPEED: Record<string, number> = { arrow: 15, sling: 11, pot: 7, gun: 26 };
const HP = [48, 300, 1300, 4200];
const GRAVITY = 22;

interface CState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  face: number;
  act: number;
  since: number;
  out: boolean;
  aboard: boolean;
  downAt: number;
  target: number;
  next: number;
  leg: number;
  pins: number[];
  /** Until when it is held by being hit or thrown. */
  held: number;
}

interface MState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  face: number;
  act: number;
  since: number;
  hp: number;
  max: number;
  alive: boolean;
  shown: boolean;
  target: number;
  next: number;
  engaged: boolean;
  held: number;
  wx: number;
  wy: number;
  /** When it was last struck. */
  struck: number;
  /** How awake it is, 0 to 2, eased toward what it should be. */
  wake: number;
}

/** Runs the script and records it. */
export function runFray(s: Script): Fray {
  const random = rng(s.seed);
  const steps = Math.ceil(s.seconds / STEP) + 2;
  const nc = s.citizens.length;
  const nm = s.monsters.length;
  const cit = new Float32Array(steps * nc * C);
  const mon = new Float32Array(steps * nm * M);
  const f: Fray = {
    script: s,
    steps,
    cit,
    mon,
    blows: [],
    shots: [],
    kills: [],
    markers: [],
    hits: [],
    burns: [],
    slams: [],
    thrusts: [],
    telegraphs: [],
    boarded: new Array(nc).fill(Number.POSITIVE_INFINITY),
    downed: new Array(nc).fill(Number.POSITIVE_INFINITY),
  };
  const cs: CState[] = s.citizens.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z ?? 0,
    vx: 0,
    vy: 0,
    vz: 0,
    face: 1,
    act: (p.from ?? 0) > 0 ? ACT.aboard : ACT.idle,
    since: 0,
    out: (p.from ?? 0) <= 0,
    aboard: (p.from ?? 0) > 0,
    downAt: Number.POSITIVE_INFINITY,
    target: -1,
    next: random() * 0.6,
    leg: 0,
    pins: [...(p.pins ?? [])].sort((a, b) => a - b),
    held: -1,
  }));
  const ms: MState[] = s.monsters.map((p) => {
    const hp = p.hp ?? (HP[p.kind] as number) * (s.toughness ?? 1) * (0.8 + random() * 0.4);
    return {
      x: p.x,
      y: p.y,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      face: random() < 0.5 ? -1 : 1,
      act:
        (p.from ?? 0) > 0
          ? ACT.hidden
          : p.behave === "sleep"
            ? ACT.sleep
            : p.kind === MITE
              ? ACT.boil
              : ACT.idle,
      since: -random() * 3,
      hp,
      max: hp,
      alive: true,
      shown: (p.from ?? 0) <= 0,
      target: p.hunts ?? -1,
      next: random() * 1.5,
      engaged: p.behave === "runner" || p.behave === "wave",
      held: -1,
      wx: p.x,
      wy: p.y,
      struck: Number.NEGATIVE_INFINITY,
      wake: p.behave === "runner" || p.behave === "wave" ? AWAKE : p.sentinel ? ALERT : REST,
    };
  });
  const pending: { at: number; fn: () => void }[] = [];
  const later = (at: number, fn: () => void): void => {
    pending.push({ at, fn });
  };
  for (const tg of s.telegraphs ?? []) {
    const lead = s.monsters[tg.who]?.kind === ELITE ? 0.6 : 0.5;
    later(tg.at - lead, () => {
      const m = ms[tg.who] as MState;
      const c = cs[tg.target] as CState;
      if (!m.alive) return;
      m.act = ACT.wind;
      m.since = tg.at - lead;
      m.held = tg.at + 0.5;
      m.face = c.x >= m.x ? 1 : -1;
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      const l = Math.hypot(dx, dy) || 1;
      f.telegraphs.push({
        t0: tg.at - lead,
        t1: tg.at,
        x: (m.x + c.x) / 2,
        y: (m.y + c.y) / 2,
        dx: dx / l,
        dy: dy / l,
        w: s.monsters[tg.who]?.kind === ELITE ? 4 : 3,
      });
    });
    later(tg.at, () => {
      const m = ms[tg.who] as MState;
      const c = cs[tg.target] as CState;
      if (!m.alive) return;
      m.act = ACT.slam;
      m.since = tg.at;
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      const l = Math.hypot(dx, dy) || 1;
      throwBody(c, dx / l, dy / l, tg.throw, tg.at);
      c.act = ACT.thrown;
      c.since = tg.at;
      f.slams.push({ t: tg.at, x: c.x, y: c.y, w: 3, h: 2.4 });
      f.hits.push({
        t: tg.at,
        x: c.x,
        y: c.y,
        dx: dx / l,
        dy: dy / l,
        value: Math.round(380 + random() * 120),
        crit: false,
        big: true,
        who: -1,
        ax: c.x,
        ay: c.y,
        lift: ON_CITIZEN,
      });
    });
  }
  for (const dth of s.deaths ?? [])
    later(dth.at, () => {
      const m = ms[dth.who] as MState;
      if (!m.alive) return;
      kill(m, dth.who, 0.6, -0.3, dth.at);
      if (dth.drop !== undefined)
        f.markers.push({
          t: dth.at + 0.3,
          x: m.x + 0.6,
          y: m.y + 0.8,
          rarity: dth.drop,
          seed: dth.who,
        });
    });
  for (const dn of s.downs ?? [])
    later(dn.at, () => {
      const c = cs[dn.who] as CState;
      c.downAt = dn.at;
      c.act = ACT.down;
      c.since = dn.at;
      f.downed[dn.who] = dn.at;
    });
  for (const ch of s.chests ?? [])
    later(ch.at, () => {
      f.markers.push({
        t: ch.at + 0.2,
        x: ch.x + 0.4,
        y: ch.y + 0.3,
        rarity: 2,
        seed: ch.who * 13 + 1,
      });
    });
  for (const ro of s.rouse ?? [])
    later(ro.at, () => {
      s.monsters.forEach((p, j) => {
        if (p.group !== ro.group) return;
        const m = ms[j] as MState;
        m.engaged = true;
        if (ro.hunts !== undefined) m.target = ro.hunts;
      });
    });
  // Guns and bows aboard, at their cadence or a pinned time, at the nearest monster in range.
  for (const gun of s.turrets ?? []) {
    let next = 0.5;
    const pins = [...(gun.pins ?? [])];
    for (let t = 0.2; t < s.seconds; t += STEP * 3) {
      const pinned = pins.length > 0 && (pins[0] as number) <= t;
      if (!pinned && t < next) continue;
      const fire = (at: number, tries: number): void => {
        let best = -1;
        let bd = gun.range;
        ms.forEach((m, j) => {
          if (!m.alive || !m.shown) return;
          const dist = Math.hypot(m.x - gun.x, m.y - gun.y);
          if (
            gun.dir &&
            ((m.x - gun.x) * gun.dir[0] + (m.y - gun.y) * gun.dir[1]) / (dist || 1) < 0.45
          )
            return;
          if (dist < bd) {
            bd = dist;
            best = j;
          }
        });
        if (best < 0) {
          // A pinned shot waits a moment for something to come into range.
          if (tries > 0) later(at + STEP, () => fire(at + STEP, tries - 1));
          return;
        }
        const m = ms[best] as MState;
        const kind = gun.weapon === "bow" ? "arrow" : gun.weapon;
        const flight = Math.max(0.15, bd / (SPEED[kind] ?? 20));
        f.shots.push({
          who: -1,
          rgb: gun.rgb,
          weapon: gun.weapon,
          t0: at,
          t1: at + flight,
          x0: gun.x,
          y0: gun.y,
          z0: gun.z,
          x1: m.x,
          y1: m.y,
        });
        later(at + flight, () => {
          if (!m.alive) return;
          const dx = m.x - gun.x;
          const dy = m.y - gun.y;
          const l = Math.hypot(dx, dy) || 1;
          const res = damage(
            best,
            Math.round(WEAPON[gun.weapon].dmg * (0.85 + hash(best, Math.round(at * 30)) * 0.3)),
            dx / l,
            dy / l,
            0.25,
            at + flight,
          );
          f.hits.push({
            t: at + flight,
            x: m.x,
            y: m.y,
            dx: dx / l,
            dy: dy / l,
            value: res.dealt,
            crit: false,
            big: res.killed && (s.monsters[best] as MonsterPlan).kind >= HOUND,
            who: -1,
            ax: m.x,
            ay: m.y,
            lift: ON_MONSTER,
          });
        });
      };
      const at = t;
      later(at, () => fire(at, pinned ? 12 : 0));
      if (pinned) pins.shift();
      next = t + gun.period;
    }
  }

  function throwBody(
    b: { vx: number; vy: number; vz: number; z: number; held: number },
    dx: number,
    dy: number,
    far: number,
    t: number,
  ): void {
    const air = far >= 1 ? 0.42 + far * 0.1 : 0.2;
    b.vx = (dx * far) / air;
    b.vy = (dy * far) / air;
    b.vz = far >= 1 ? (GRAVITY * air) / 2 : 0;
    b.z = Math.max(b.z, 0.001);
    b.held = t + air + 0.25;
  }

  function kill(m: MState, j: number, dx: number, dy: number, t: number): void {
    m.alive = false;
    m.act = ACT.dead;
    m.since = t;
    const kind = s.monsters[j]?.kind ?? 0;
    f.kills.push({ t, x: m.x, y: m.y, dx, dy, kind, seed: j * 7 + 3 });
    const roll = hash(j, s.seed, 5);
    const rarity =
      kind === MITE
        ? roll < 0.05
          ? 1
          : -1
        : kind === HOUND
          ? roll < 0.06
            ? 2
            : roll < 0.3
              ? 1
              : -1
          : kind === BRUTE
            ? roll < 0.45
              ? 2
              : 1
            : -1;
    if (rarity > 0)
      f.markers.push({ t: t + 0.3, x: m.x + dx * 0.8, y: m.y + dy * 0.8, rarity, seed: j });
  }

  function damage(
    j: number,
    amount: number,
    dx: number,
    dy: number,
    knock: number,
    t: number,
  ): { dealt: number; killed: boolean } {
    const m = ms[j] as MState;
    const plan = s.monsters[j] as MonsterPlan;
    const scripted = (s.deaths ?? []).some((dth) => dth.who === j && dth.at > t);
    const dealt = amount;
    m.hp -= amount;
    m.engaged = true;
    m.struck = t;
    if (m.hp <= 0 && !scripted) {
      kill(m, j, dx, dy, t);
      if (plan.kind === MITE && knock >= 1) {
        // Fodder caught in a heavy blow is thrown together before it bursts.
        m.alive = true;
        m.hp = 0.0001;
        throwBody(m, dx, dy, knock, t);
        m.act = ACT.thrown;
        m.since = t;
        f.kills.pop();
        later(t + 0.62, () => {
          if (m.alive) kill(m, j, dx, dy, t + 0.62);
        });
      }
      return { dealt, killed: true };
    }
    if (scripted) m.hp = Math.max(m.hp, m.max * 0.05);
    if (knock > 0) throwBody(m, dx, dy, plan.kind >= BRUTE ? knock * 0.3 : knock, t);
    if (m.act !== ACT.wind && m.act !== ACT.slam) {
      m.act = knock >= 1 && plan.kind < BRUTE ? ACT.thrown : ACT.hurt;
      m.since = t;
    }
    return { dealt, killed: false };
  }

  const nearestMonster = (
    x: number,
    y: number,
    r: number,
    ax: number,
    ay: number,
    ar: number,
    prefers = -1,
  ): number => {
    let best = -1;
    let bd = r;
    for (let j = 0; j < nm; j++) {
      const m = ms[j] as MState;
      if (!m.alive || !m.shown || m.act === ACT.thrown) continue;
      if (Math.hypot(m.x - ax, m.y - ay) > ar) continue;
      // The kind it prefers counts as half as far.
      const dist =
        Math.hypot(m.x - x, m.y - y) * ((s.monsters[j] as MonsterPlan).kind === prefers ? 0.4 : 1);
      if (dist < bd) {
        bd = dist;
        best = j;
      }
    }
    return best;
  };

  const resolveMelee = (
    i: number,
    w: Weapon,
    dx: number,
    dy: number,
    t: number,
    start: number,
  ): void => {
    const c = cs[i] as CState;
    const plan = s.citizens[i] as CitizenPlan;
    const spec = WEAPON[w];
    let value = 0;
    let hits = 0;
    let big = false;
    const crit = plan.crit && Math.abs(plan.crit.t - t) < 0.12 ? plan.crit.value : 0;
    const isCrit = crit > 0 || hash(i, Math.round(t * 30), s.seed) < 0.1;
    const mult = isCrit && !crit ? 2.3 : 1;
    const struck: number[] = [];
    if (w === "blade") {
      for (let j = 0; j < nm; j++) {
        const m = ms[j] as MState;
        if (!m.alive || !m.shown) continue;
        const ox = m.x - c.x;
        const oy = m.y - c.y;
        const dist = Math.hypot(ox, oy);
        const size = (s.monsters[j] as MonsterPlan).kind >= BRUTE ? 0.7 : 0.25;
        if (dist > spec.reach + 0.55 + size) continue;
        if (dist > 0.2 && (ox * dx + oy * dy) / dist < Math.cos(1.25)) continue;
        struck.push(j);
      }
      struck.sort(
        (a, b) =>
          Math.hypot((ms[a] as MState).x - c.x, (ms[a] as MState).y - c.y) -
          Math.hypot((ms[b] as MState).x - c.x, (ms[b] as MState).y - c.y),
      );
      struck.length = Math.min(struck.length, s.strokeHits ?? 6);
    } else if (w === "maul") {
      const rx = c.x + dx * 1.1;
      const ry = c.y + dy * 1.1;
      for (let j = 0; j < nm; j++) {
        const m = ms[j] as MState;
        if (!m.alive || !m.shown) continue;
        if (Math.hypot((m.x - rx) / 1.6, (m.y - ry) / 1.3) <= 1) struck.push(j);
      }
      f.slams.push({ t, x: rx, y: ry, w: 3, h: 2.4 });
    } else if (w === "spear") {
      const x1 = c.x + dx * 4;
      const y1 = c.y + dy * 4;
      for (let j = 0; j < nm; j++) {
        const m = ms[j] as MState;
        if (!m.alive || !m.shown) continue;
        const ox = m.x - c.x;
        const oy = m.y - c.y;
        const along = ox * dx + oy * dy;
        const across = Math.abs(ox * dy - oy * dx);
        if (along > -0.2 && along < 4.2 && across < 0.7) struck.push(j);
      }
      f.thrusts.push({ t, x0: c.x + dx * 0.4, y0: c.y + dy * 0.4, x1, y1 });
    }
    // The burst goes on the nearest thing struck, where the blow meets it.
    let ax = c.x + dx * 0.8;
    let ay = c.y + dy * 0.8;
    let near = Number.POSITIVE_INFINITY;
    for (const j of struck) {
      const m = ms[j] as MState;
      const dist = Math.hypot(m.x - c.x, m.y - c.y);
      if (dist < near) {
        near = dist;
        ax = m.x;
        ay = m.y;
      }
    }
    for (const j of struck) {
      const m = ms[j] as MState;
      const ox = m.x - c.x;
      const oy = m.y - c.y;
      const l = Math.hypot(ox, oy) || 1;
      const kx = w === "maul" ? (ox / l) * 0.5 + dx * 0.5 : dx;
      const ky = w === "maul" ? (oy / l) * 0.5 + dy * 0.5 : dy;
      const kl = Math.hypot(kx, ky) || 1;
      const amount = Math.round(spec.dmg * (0.8 + hash(j, Math.round(t * 30), 3) * 0.4) * mult);
      const res = damage(
        j,
        amount,
        kx / kl,
        ky / kl,
        w === "maul" ? 2 : w === "spear" ? 1 : 0.25,
        t,
      );
      value += res.dealt;
      hits++;
      if (res.killed && (s.monsters[j] as MonsterPlan).kind >= HOUND) big = true;
    }
    if (crit) value = crit;
    if (hits > 0)
      f.hits.push({
        t,
        x: c.x + dx * 0.8,
        y: c.y + dy * 0.8,
        dx,
        dy,
        value,
        crit: isCrit,
        big,
        who: i,
        ax,
        ay,
        lift: ON_MONSTER,
      });
    f.blows.push({
      who: i,
      weapon: w,
      start,
      contact: t,
      x: c.x,
      y: c.y,
      dx,
      dy,
      hits,
      value,
      crit: isCrit && hits > 0,
      big,
    });
  };

  const loose = (i: number, w: Weapon, j: number, t: number): void => {
    const c = cs[i] as CState;
    const m = ms[j] as MState;
    const kind = w === "bow" ? "arrow" : w;
    const dist = Math.hypot(m.x - c.x, m.y - c.y);
    const flight = Math.max(0.18, dist / (SPEED[kind] ?? 12));
    // Aim where it will be, roughly.
    const ax = m.x + m.vx * flight * 0.5;
    const ay = m.y + m.vy * flight * 0.5;
    const shot: Shot = {
      who: i,
      rgb: (s.citizens[i] as CitizenPlan).look.cloak,
      weapon: w,
      t0: t,
      t1: t + flight,
      x0: c.x,
      y0: c.y,
      z0: c.z + 1.1,
      x1: ax,
      y1: ay,
    };
    f.shots.push(shot);
    later(t + flight, () => {
      const tt = t + flight;
      const sdx = ax - c.x;
      const sdy = ay - c.y;
      const l = Math.hypot(sdx, sdy) || 1;
      if (w === "pot") {
        f.burns.push({ t: tt, x: ax, y: ay });
        let value = 0;
        let big = false;
        for (let k = 0; k < nm; k++) {
          const mk = ms[k] as MState;
          if (!mk.alive || !mk.shown) continue;
          if (Math.hypot((mk.x - ax) / 1.6, (mk.y - ay) / 1.3) > 1) continue;
          const res = damage(
            k,
            Math.round(WEAPON.pot.dmg * (0.8 + hash(k, 9) * 0.5)),
            (mk.x - ax) / 1.6,
            (mk.y - ay) / 1.6,
            0.25,
            tt,
          );
          value += res.dealt;
          if (res.killed && (s.monsters[k] as MonsterPlan).kind >= HOUND) big = true;
        }
        if (value > 0)
          f.hits.push({
            t: tt,
            x: ax,
            y: ay,
            dx: sdx / l,
            dy: sdy / l,
            value,
            crit: false,
            big,
            who: i,
            ax,
            ay,
            lift: ON_MONSTER,
          });
        return;
      }
      const mm = ms[j] as MState;
      if (!mm.alive || Math.hypot(mm.x - ax, mm.y - ay) > 1.3) return;
      const crit = hash(i, Math.round(tt * 30), 11) < 0.12;
      const amount = Math.round(
        WEAPON[w].dmg * (0.8 + hash(j, Math.round(tt * 30)) * 0.4) * (crit ? 2.2 : 1),
      );
      const res = damage(j, amount, sdx / l, sdy / l, 0.25, tt);
      f.hits.push({
        t: tt,
        x: mm.x,
        y: mm.y,
        dx: sdx / l,
        dy: sdy / l,
        value: res.dealt,
        crit,
        big: res.killed && (s.monsters[j] as MonsterPlan).kind >= HOUND,
        who: i,
        ax: mm.x,
        ay: mm.y,
        lift: ON_MONSTER,
      });
    });
  };

  const orderAt = (p: CitizenPlan, t: number): { order: Order | null; index: number } => {
    let found: Order | null = null;
    let index = -1;
    p.orders.forEach((o, k) => {
      if (o.t <= t) {
        found = o;
        index = k;
      }
    });
    return { order: found, index };
  };
  /** Whether a citizen is one that keeps apart from the others: out on the ground, holding or fighting at a place. */
  const apart = (c: CState, i: number, t: number): boolean => {
    if (!c.out || c.aboard || c.z > 0.05 || c.act === ACT.thrown || c.act === ACT.down)
      return false;
    const { order } = orderAt(s.citizens[i] as CitizenPlan, t);
    return order !== null && ("hold" in order || "fight" in order);
  };

  const record = (k: number): void => {
    for (let i = 0; i < nc; i++) {
      const c = cs[i] as CState;
      const o = (k * nc + i) * C;
      cit[o] = c.x;
      cit[o + 1] = c.y;
      cit[o + 2] = c.z;
      cit[o + 3] = c.face;
      cit[o + 4] = c.aboard ? ACT.aboard : c.act;
      cit[o + 5] = c.since;
    }
    for (let j = 0; j < nm; j++) {
      const m = ms[j] as MState;
      const o = (k * nm + j) * M;
      mon[o] = m.x;
      mon[o + 1] = m.y;
      mon[o + 2] = m.z;
      mon[o + 3] = m.face;
      mon[o + 4] = m.act;
      mon[o + 5] = m.since;
      mon[o + 6] = m.alive ? clamp(m.hp / m.max) : 0;
      mon[o + 7] = m.wake;
    }
  };

  /** What each monster's ink should say: awake, alert or at rest; eased toward it. */
  const settleWake = (t: number): void => {
    for (let j = 0; j < nm; j++) {
      const m = ms[j] as MState;
      if (!m.shown) continue;
      const p = s.monsters[j] as MonsterPlan;
      let want = REST;
      const act = m.act;
      // Hunting counts as awake once its quarry is within ten tiles; before that it is alert.
      const quarry = m.engaged && m.target >= 0 ? (cs[m.target] as CState) : null;
      const close =
        quarry !== null && !quarry.aboard && Math.hypot(quarry.x - m.x, quarry.y - m.y) < 10;
      if (
        !m.alive ||
        p.behave === "runner" ||
        p.behave === "wave" ||
        t - m.struck < 2 ||
        close ||
        act === ACT.stalk ||
        (act === ACT.chase && (quarry === null || close)) ||
        act === ACT.coil ||
        act === ACT.lunge ||
        act === ACT.wind ||
        act === ACT.slam ||
        act === ACT.hurt ||
        act === ACT.thrown ||
        act === ACT.rise
      )
        want = AWAKE;
      else {
        let near = p.sentinel === true;
        for (let i = 0; i < nc && !near; i++) {
          const c = cs[i] as CState;
          if (!c.out || c.aboard || c.downAt <= t) continue;
          if (Math.hypot(c.x - m.x, c.y - m.y) < 10) near = true;
        }
        if (near) want = ALERT;
      }
      if (m.wake < want) m.wake = Math.min(want, m.wake + (STEP * AWAKE) / WAKE_UP);
      else if (m.wake > want) m.wake = Math.max(want, m.wake - (STEP * AWAKE) / WAKE_DOWN);
    }
  };

  const setAct = (b: { act: number; since: number }, act: number, t: number): void => {
    if (b.act !== act) {
      b.act = act;
      b.since = t;
    }
  };

  const lastOrder: number[] = new Array(nc).fill(-1);
  // Each group's fodder, for keeping room between bodies.
  const byGroup = new Map<number, number[]>();
  s.monsters.forEach((p, j) => {
    if (p.kind !== MITE) return;
    let list = byGroup.get(p.group);
    if (!list) {
      list = [];
      byGroup.set(p.group, list);
    }
    list.push(j);
  });
  const swarmsByGroup = [...byGroup.values()];
  for (let k = 0; k < steps; k++) {
    const t = k * STEP;
    // Scripted moments due by now.
    pending.sort((a, b) => a.at - b.at);
    while (pending.length > 0 && (pending[0] as { at: number }).at <= t + 1e-9)
      (pending.shift() as { fn: () => void }).fn();

    // ---- Citizens.
    for (let i = 0; i < nc; i++) {
      const c = cs[i] as CState;
      const p = s.citizens[i] as CitizenPlan;
      if (c.aboard) {
        if ((p.from ?? 0) <= t && f.boarded[i] === Number.POSITIVE_INFINITY) {
          c.aboard = false;
          c.out = true;
          c.act = ACT.walk;
          c.since = t;
        } else continue;
      }
      if ((f.boarded[i] as number) < t) {
        c.aboard = true;
        continue;
      }
      // In the air or sliding from a blow.
      if ((c.z > 0 && !p.ramp) || c.vz !== 0 || t < c.held) {
        c.x += c.vx * STEP;
        c.y += c.vy * STEP;
        if (c.z > 0 || c.vz > 0) {
          c.z += c.vz * STEP;
          c.vz -= GRAVITY * STEP;
          if (c.z <= 0) {
            c.z = 0;
            c.vz = 0;
            c.vx *= 0.15;
            c.vy *= 0.15;
          }
        } else {
          c.vx *= 0.8;
          c.vy *= 0.8;
        }
        if (t < c.held) continue;
      }
      c.vx = 0;
      c.vy = 0;
      if (c.downAt <= t) {
        setAct(c, ACT.down, c.downAt);
        continue;
      }
      const { order, index } = orderAt(p, t);
      if (index !== lastOrder[i]) {
        lastOrder[i] = index;
        c.leg = 0;
        c.target = -1;
      }
      if (!order) {
        setAct(c, ACT.idle, t);
        continue;
      }
      const w = p.weapon;
      const spec = WEAPON[w];
      const walkTo = (tx: number, ty: number, speed: number, act: number): boolean => {
        const dx = tx - c.x;
        const dy = ty - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.05) return true;
        // Down the ramp it walks, not runs.
        const onRamp = p.ramp !== undefined && c.z > 0 && c.vz === 0;
        const step = Math.min(dist, (onRamp ? Math.min(speed, 1.8) : speed) * STEP);
        c.x += (dx / dist) * step;
        c.y += (dy / dist) * step;
        if (onRamp) c.z = Math.max(0, c.z - (step * (p.z ?? 0)) / (p.ramp as number));
        if (Math.abs(dx) > 0.02) c.face = dx > 0 ? 1 : -1;
        setAct(c, onRamp ? ACT.walk : act, t);
        return dist <= step + 1e-6;
      };
      const loaded = (p.haul ?? 0) > 0.5;
      const pace = p.pace ?? (loaded ? 1.7 : 2.2);
      if ("go" in order || "board" in order) {
        const route = "go" in order ? order.go : order.board;
        const run = order.run === true;
        if (c.act === ACT.swing || c.act === ACT.shoot) {
          if (t - c.since < 0.5) continue;
        }
        // Someone running in with runners behind turns to swing at one that catches up.
        if (p.runs && w !== "none") {
          const j = nearestMonster(c.x, c.y, 1.15, c.x, c.y, 2);
          if (j >= 0 && t >= c.next) {
            const m = ms[j] as MState;
            const dx = m.x - c.x;
            const dy = m.y - c.y;
            const l = Math.hypot(dx, dy) || 1;
            c.face = dx >= 0 ? 1 : -1;
            setAct(c, ACT.swing, t);
            c.since = t;
            c.next = t + spec.period + 0.9;
            const start = t;
            later(t + spec.contact, () =>
              resolveMelee(i, w, dx / l, dy / l, start + spec.contact, start),
            );
            continue;
          }
        }
        const goal = route[Math.min(c.leg, route.length - 1)] as [number, number];
        if (walkTo(goal[0], goal[1], run ? (loaded ? 2.3 : 3.2) : pace, run ? ACT.run : ACT.walk)) {
          if (c.leg < route.length - 1) c.leg++;
          else if ("board" in order) {
            f.boarded[i] = t;
            c.aboard = true;
          } else setAct(c, ACT.idle, t);
        }
        continue;
      }
      if ("work" in order) {
        const [wx, wy] = order.work;
        // A monster on it: it turns and fights.
        const near = nearestMonster(c.x, c.y, 1.3, c.x, c.y, 1.3);
        if (near >= 0 || (c.act === ACT.swing && t - c.since < 0.7)) {
          if (near >= 0 && t >= c.next) {
            const m = ms[near] as MState;
            const dx = m.x - c.x;
            const dy = m.y - c.y;
            const l = Math.hypot(dx, dy) || 1;
            c.face = dx >= 0 ? 1 : -1;
            c.act = ACT.swing;
            c.since = t;
            c.next = t + 0.8;
            const start = t;
            const weapon: Weapon =
              w === "none" || w === "bow" || w === "sling" || w === "pot" ? "blade" : w;
            later(t + 0.23, () => resolveMelee(i, weapon, dx / l, dy / l, start + 0.23, start));
          }
          continue;
        }
        if (Math.hypot(wx - c.x, wy - c.y) > 0.6) walkTo(wx, wy, pace, ACT.walk);
        else {
          c.face = order.kind === "chest" ? 1 : c.face;
          setAct(c, ACT.work, t);
        }
        continue;
      }
      // Fighting round a place, or holding one.
      const [ax, ay] = "fight" in order ? order.fight : "hold" in order ? order.hold : [c.x, c.y];
      const r = "fight" in order ? order.r : "hold" in order ? order.r : 4;
      // A pinned blow or shot goes at its time, whatever the citizen was doing.
      const due = c.pins.length > 0 && (c.pins[0] as number) - spec.contact <= t + 1e-6;
      if (
        !due &&
        (c.act === ACT.swing || c.act === ACT.shoot) &&
        t - c.since < (c.act === ACT.swing ? 0.5 : 0.3)
      )
        continue;
      let j = c.target;
      if (j >= 0) {
        const m = ms[j] as MState;
        if (!m.alive || Math.hypot(m.x - ax, m.y - ay) > r + 3) j = -1;
      }
      if (j < 0) j = nearestMonster(c.x, c.y, 99, ax, ay, r, p.prefers ?? -1);
      c.target = j;
      const ranged = w === "bow" || w === "sling" || w === "pot" || w === "gun";
      if (j < 0) {
        if ("hold" in order && Math.hypot(ax - c.x, ay - c.y) > 0.4) walkTo(ax, ay, pace, ACT.walk);
        else setAct(c, ACT.idle, t);
        continue;
      }
      const m = ms[j] as MState;
      const dx = m.x - c.x;
      const dy = m.y - c.y;
      const dist = Math.hypot(dx, dy);
      const size =
        (s.monsters[j] as MonsterPlan).kind >= BRUTE
          ? 0.75
          : (s.monsters[j] as MonsterPlan).kind === HOUND
            ? 0.3
            : 0;
      const want = ranged ? spec.reach : spec.reach + size;
      const pinned = due;
      if (!ranged && dist > want + 0.15 && !pinned) {
        walkTo(m.x - (dx / dist) * want * 0.9, m.y - (dy / dist) * want * 0.9, 3.0, ACT.run);
        continue;
      }
      if (ranged && dist > want + 1.5 && !pinned && !p.stands) {
        walkTo(m.x - (dx / dist) * want, m.y - (dy / dist) * want, 2.6, ACT.run);
        continue;
      }
      if (ranged && dist < 2.2 && w !== "gun" && !pinned && !p.stands) {
        walkTo(c.x - dx, c.y - dy, 2.4, ACT.run);
        continue;
      }
      c.face = dx >= 0 ? 1 : -1;
      // A pinned blow or shot goes at its time; otherwise at the weapon's cadence.
      let go = false;
      if (pinned) {
        go = true;
        c.pins.shift();
      } else if (
        t >= c.next &&
        !(
          c.pins.length > 0 &&
          (c.pins[0] as number) - spec.contact - t < (p.cadence ?? spec.period) * 0.8
        )
      )
        go = true;
      if (!go) {
        if (c.act !== ACT.swing && c.act !== ACT.shoot) setAct(c, ACT.idle, t);
        else if (t - c.since > 0.7) setAct(c, ACT.idle, t);
        continue;
      }
      let l = dist || 1;
      let bx = dx;
      let by = dy;
      if (pinned && w === "maul") {
        // A pinned slam goes where the fodder is thickest round it.
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let q = 0; q < nm; q++) {
          const mq = ms[q] as MState;
          if (!mq.alive || !mq.shown || (s.monsters[q] as MonsterPlan).kind !== MITE) continue;
          if (Math.hypot(mq.x - c.x, mq.y - c.y) > 3.4) continue;
          sx += mq.x - c.x;
          sy += mq.y - c.y;
          n++;
        }
        if (n > 0) {
          bx = sx / n;
          by = sy / n;
          l = Math.hypot(bx, by) || 1;
          c.face = bx >= 0 ? 1 : -1;
        }
      }
      c.act = ranged ? ACT.shoot : ACT.swing;
      c.since = t;
      c.next =
        t + (p.cadence ?? spec.period) * (ranged ? 1 : (s.tempo ?? 1)) * (0.9 + hash(i, k) * 0.2);
      const start = t;
      if (ranged) later(t + spec.contact, () => loose(i, w, j, start + spec.contact));
      else
        later(t + spec.contact, () =>
          resolveMelee(i, w, bx / l, by / l, start + spec.contact, start),
        );
    }

    // ---- Monsters.
    for (let j = 0; j < nm; j++) {
      const m = ms[j] as MState;
      const p = s.monsters[j] as MonsterPlan;
      const g = s.groups[p.group] as Group;
      if (!m.shown) {
        if ((p.from ?? 0) <= t) {
          m.shown = true;
          m.act = ACT.rise;
          m.since = t;
          m.engaged = true;
        } else continue;
      }
      if (!m.alive) {
        if (m.z > 0) {
          m.x += m.vx * STEP;
          m.y += m.vy * STEP;
          m.z = Math.max(0, m.z + m.vz * STEP);
          m.vz -= GRAVITY * STEP;
        }
        continue;
      }
      if (m.z > 0 || m.vz !== 0 || t < m.held) {
        m.x += m.vx * STEP;
        m.y += m.vy * STEP;
        if (m.z > 0 || m.vz > 0) {
          m.z += m.vz * STEP;
          m.vz -= GRAVITY * STEP;
          if (m.z <= 0) {
            m.z = 0;
            m.vz = 0;
            m.vx *= 0.1;
            m.vy *= 0.1;
          }
        } else {
          m.vx *= 0.75;
          m.vy *= 0.75;
        }
        if (t < m.held) continue;
      }
      m.vx = 0;
      m.vy = 0;
      if (m.act === ACT.rise && t - m.since < 0.6) continue;
      // Who is near.
      let ci = -1;
      let cd = 99;
      for (let i = 0; i < nc; i++) {
        const c = cs[i] as CState;
        if (!c.out || c.aboard || c.downAt <= t) continue;
        const dist = Math.hypot(c.x - m.x, c.y - m.y);
        if (dist < cd) {
          cd = dist;
          ci = i;
        }
      }
      const fromHome = Math.hypot(m.x - g.home[0], m.y - g.home[1]);
      if (!m.engaged && ci >= 0) {
        const c = cs[ci] as CState;
        const homeDist = Math.hypot(c.x - g.home[0], c.y - g.home[1]);
        if (p.behave === "sleep" ? homeDist < (g.wake ?? 3) : homeDist < g.aggro) m.engaged = true;
      }
      if (m.engaged && p.behave !== "runner" && p.behave !== "wave") {
        // It will not follow past its leash; it goes back and settles.
        const q = m.target >= 0 ? m.target : ci;
        if (
          q < 0 ||
          Math.hypot((cs[q] as CState).x - g.home[0], (cs[q] as CState).y - g.home[1]) > g.leash
        ) {
          m.engaged = false;
          m.target = -1;
        }
      }
      const speedOf = p.kind === MITE ? 1.7 : p.kind === HOUND ? 3.0 : p.kind === BRUTE ? 1.4 : 1.6;
      const move = (tx: number, ty: number, speed: number, act: number, faceIt = true): void => {
        const dx = tx - m.x;
        const dy = ty - m.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.03) return;
        const step = Math.min(dist, speed * STEP);
        m.x += (dx / dist) * step;
        m.y += (dy / dist) * step;
        if (faceIt && Math.abs(dx) > 0.02) m.face = dx > 0 ? 1 : -1;
        setAct(m, act, t);
      };
      if (m.act === ACT.wind || m.act === ACT.slam) {
        if (t - m.since < 0.7) continue;
        setAct(m, ACT.idle, t);
      }
      if (!m.engaged) {
        // Heads turn to a citizen within ten tiles; within six a pack stalks.
        if (ci >= 0 && cd < 10 && p.kind !== MITE) m.face = (cs[ci] as CState).x >= m.x ? 1 : -1;
        if (ci >= 0 && cd < 6 && p.kind === HOUND && p.behave !== "sleep") {
          const c = cs[ci] as CState;
          // Low, facing it, closing; it does not come nearer than a couple of tiles until it hunts.
          if (fromHome < g.leash * 0.7 && cd > 2.6) move(c.x, c.y, 0.45, ACT.stalk);
          else {
            setAct(m, ACT.stalk, t);
            m.face = c.x >= m.x ? 1 : -1;
          }
          continue;
        }
        if (p.behave === "sleep") {
          setAct(m, p.leader ? ACT.idle : ACT.sleep, t);
          continue;
        }
        if (p.behave === "gnaw") {
          setAct(m, ACT.gnaw, t);
          continue;
        }
        if (p.behave === "pace" || p.behave === "guard") {
          const period = 6 + hash(j, 4) * 4;
          const u = ((t + hash(j, 5) * period) / period) % 1;
          const ang = hash(j, 6) * Math.PI * 2;
          const reach = p.behave === "guard" ? 0.7 : 1.6 + hash(j, 7) * 1.4;
          const off = Math.sin(u * Math.PI * 2) * reach;
          const tx = p.x + Math.cos(ang) * off;
          const ty = p.y + Math.sin(ang) * off * 0.6;
          if (Math.hypot(tx - m.x, ty - m.y) > 0.05)
            move(tx, ty, 0.7, ACT.pace, !(ci >= 0 && cd < 10));
          else setAct(m, ACT.idle, t);
          continue;
        }
        if (p.kind === MITE) {
          // A swarm boils round its ground.
          const a = t * (0.6 + hash(j, 8) * 0.6) + hash(j, 9) * 6.28;
          const rr = 0.35 + hash(j, 10) * 0.5;
          move(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr * 0.7, 0.9, ACT.boil);
          continue;
        }
        // Back to its place.
        if (Math.hypot(p.x - m.x, p.y - m.y) > 0.3) move(p.x, p.y, speedOf * 0.6, ACT.pace);
        else setAct(m, ACT.idle, t);
        continue;
      }
      // Hunting.
      let target =
        m.target >= 0 && !(cs[m.target] as CState).aboard && (cs[m.target] as CState).downAt > t
          ? m.target
          : ci;
      // The last wave goes for the ramp and strikes whoever is in its way.
      if (p.behave === "wave") target = ci >= 0 && cd < 3 ? ci : -1;
      m.target = target;
      if (target < 0) {
        if (p.behave === "wave") move(s.ramp[0], s.ramp[1], speedOf, ACT.chase);
        else setAct(m, ACT.idle, t);
        continue;
      }
      const c = cs[target] as CState;
      const dx = c.x - m.x;
      const dy = c.y - m.y;
      const dist = Math.hypot(dx, dy);
      const reach = p.kind === MITE ? 0.75 : p.kind === HOUND ? 1.0 : 1.5;
      if (p.kind === MITE) {
        // Round the target, each mite to its own side, so the swarm closes as one mass and flows round.
        const a = hash(j, 12) * Math.PI * 2 + t * 0.15;
        const ring = 0.7 + hash(j, 13) * 0.9;
        const tx = c.x + Math.cos(a) * ring;
        const ty = c.y + Math.sin(a) * ring * 0.75;
        if (Math.hypot(tx - m.x, ty - m.y) > 0.1) move(tx, ty, speedOf, ACT.chase, false);
        m.face = dx >= 0 ? 1 : -1;
        if (dist < reach + 0.9 && t >= m.next) {
          setAct(m, ACT.lunge, t);
          m.since = t;
          m.next = t + 0.8 + hash(j, k) * 0.8;
        } else if (m.act === ACT.lunge && t - m.since > 0.25) setAct(m, ACT.chase, t);
        continue;
      }
      if (dist > reach) {
        // A runner keeps a couple of tiles behind its quarry rather than catching it.
        const speed =
          p.behave === "runner" ? Math.min(speedOf * 0.72, dist > 2.4 ? 2.6 : 1.2) : speedOf;
        move(c.x - (dx / dist) * reach * 0.9, c.y - (dy / dist) * reach * 0.9, speed, ACT.chase);
        continue;
      }
      m.face = dx >= 0 ? 1 : -1;
      if (m.act === ACT.coil && t - m.since >= 0.32) {
        setAct(m, ACT.lunge, t);
        continue;
      }
      if (m.act === ACT.lunge && t - m.since < 0.3) continue;
      if (t >= m.next) {
        setAct(m, ACT.coil, t);
        m.since = t;
        m.next = t + (p.kind === HOUND ? 1.3 : 2.2) + hash(j, k) * 0.6;
      } else if (m.act !== ACT.coil) setAct(m, ACT.idle, t);
    }
    // Swarms keep a little room between bodies.
    for (const members of swarmsByGroup) {
      for (let ia = 0; ia < members.length; ia++) {
        const a = members[ia] as number;
        const ma = ms[a] as MState;
        if (!ma.alive || !ma.shown || ma.z > 0) continue;
        for (let ib = ia + 1; ib < members.length; ib++) {
          const b = members[ib] as number;
          const mb = ms[b] as MState;
          if (!mb.alive || !mb.shown || mb.z > 0) continue;
          const dx = mb.x - ma.x;
          const dy = (mb.y - ma.y) / 0.8;
          const dd = Math.hypot(dx, dy);
          if (dd > 0.46 || dd < 1e-6) continue;
          const push = (0.46 - dd) * 0.5;
          ma.x -= (dx / dd) * push;
          ma.y -= (dy / dd) * push * 0.8;
          mb.x += (dx / dd) * push;
          mb.y += (dy / dd) * push * 0.8;
        }
      }
    }
    // Citizens holding or fighting at a place keep apart, a figure's width side by side and its
    // height one behind the other, so one never stands over another on screen.
    for (let ia = 0; ia < nc; ia++) {
      const a = cs[ia] as CState;
      if (!apart(a, ia, t)) continue;
      for (let ib = ia + 1; ib < nc; ib++) {
        const b = cs[ib] as CState;
        if (!apart(b, ib, t)) continue;
        const ex = (b.x - a.x) / APART_X;
        const ey = (b.y - a.y) / APART_Y;
        const dd = Math.hypot(ex, ey);
        if (dd >= 1) continue;
        // Two on the very same spot part sideways, the lower index to the west.
        const [ux, uy] = dd < 1e-6 ? [1, 0] : [ex / dd, ey / dd];
        const push = (1 - dd) * 0.2;
        a.x -= ux * push * APART_X;
        a.y -= uy * push * APART_Y;
        b.x += ux * push * APART_X;
        b.y += uy * push * APART_Y;
      }
    }
    // Nothing crosses the shield until it breaks; citizens holding its edge stay outside it.
    if (s.bar && t < s.bar.until) {
      const bar = s.bar;
      for (let j = 0; j < nm; j++) {
        const m = ms[j] as MState;
        if (!m.alive || !m.shown) continue;
        const p = bar.out(m.x, m.y, false);
        if (p) [m.x, m.y] = p;
      }
      for (let i = 0; i < nc; i++) {
        const c = cs[i] as CState;
        if (c.aboard || !c.out) continue;
        const { order } = orderAt(s.citizens[i] as CitizenPlan, t);
        if (!order || !("hold" in order || "fight" in order)) continue;
        // Only those holding a place outside it: the ramp's foot is inside.
        const [ax, ay] = "hold" in order ? order.hold : order.fight;
        if (bar.out(ax, ay, true)) continue;
        const p = bar.out(c.x, c.y, true);
        if (p) [c.x, c.y] = p;
      }
    }
    settleWake(t);
    record(k);
  }
  f.blows.sort((a, b) => a.contact - b.contact);
  f.shots.sort((a, b) => a.t0 - b.t0);
  f.hits.sort((a, b) => a.t - b.t);
  f.kills.sort((a, b) => a.t - b.t);
  f.markers.sort((a, b) => a.t - b.t);
  return f;
}

export interface BodyAt {
  x: number;
  y: number;
  z: number;
  face: number;
  act: number;
  since: number;
  /** Ink left, for a monster. */
  ink: number;
  /** How awake a monster is, 0 at rest to 2 awake. */
  wake: number;
}

const read = (
  data: Float32Array,
  stride: number,
  count: number,
  steps: number,
  i: number,
  t: number,
): BodyAt => {
  const at = clamp(t / STEP, 0, steps - 1.001);
  const k = Math.floor(at);
  const u = at - k;
  const a = (k * count + i) * stride;
  const b = ((k + 1) * count + i) * stride;
  const act = data[a + 4] as number;
  const jump =
    Math.abs((data[b] as number) - (data[a] as number)) +
      Math.abs((data[b + 1] as number) - (data[a + 1] as number)) >
    2;
  const w = jump ? 0 : u;
  return {
    x: (data[a] as number) + ((data[b] as number) - (data[a] as number)) * w,
    y: (data[a + 1] as number) + ((data[b + 1] as number) - (data[a + 1] as number)) * w,
    z: Math.max(
      0,
      (data[a + 2] as number) + ((data[b + 2] as number) - (data[a + 2] as number)) * w,
    ),
    face: data[a + 3] as number,
    act,
    since: t - (data[a + 5] as number),
    ink: stride === M ? (data[a + 6] as number) : 1,
    wake:
      stride === M
        ? (data[a + 7] as number) + ((data[b + 7] as number) - (data[a + 7] as number)) * u
        : AWAKE,
  };
};

export const citizenAt = (f: Fray, i: number, t: number): BodyAt =>
  read(f.cit, C, f.script.citizens.length, f.steps, i, t);

export const monsterAt = (f: Fray, j: number, t: number): BodyAt =>
  read(f.mon, M, f.script.monsters.length, f.steps, j, t);

/** Monsters alive and on the map at `t`. */
export function aliveAt(f: Fray, t: number): number {
  let n = 0;
  for (let j = 0; j < f.script.monsters.length; j++) {
    const m = monsterAt(f, j, t);
    if (m.act !== ACT.dead && m.act !== ACT.hidden) n++;
  }
  return n;
}

/** Citizens out on the ground at `t` (not aboard), downs included. */
export function outAt(f: Fray, t: number): number {
  let n = 0;
  for (let i = 0; i < f.script.citizens.length; i++) if (citizenAt(f, i, t).act !== ACT.aboard) n++;
  return n;
}

/** Shots in the air at `t`. */
export function shotsAt(f: Fray, t: number): Shot[] {
  return f.shots.filter((s) => s.t0 <= t && s.t1 > t);
}
