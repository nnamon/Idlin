// What a fight looks like, read off the world once a tick as effects.ts reads
// walks: the viewer is sent worlds and no events, so every blow is worked out
// from how the actors and the marked tiles changed since the last tick. A
// blow lands at the tick its attacker's wind-up runs out, on every enemy that
// stood on one of its marked tiles at the end of the tick before. From that
// come the lunge and the target's recoil, the number that floats up, the
// scratch a blow leaves on an empty tile, the blot a dead monster leaves, and
// the lines of news. Everything here is a function of that history and the
// time, with no randomness and no clock of its own. Pure, so it can be tested
// without a page.

import { type Actor, ADVENTURER, DOWN_TICKS, kindOf, type Mark, type World } from "@idlin/sim";

/** Ticks a number floats up over its target before it is gone. It fades over the last FLOAT_FADE. */
export const FLOAT_TICKS = 20;
export const FLOAT_FADE = 8;
/** How far a number rises in its life, in pixels. */
export const FLOAT_RISE = 16;
/** Ticks a dead monster takes to fall into a blot, and the ticks the blot stays: about a minute. */
export const COLLAPSE_TICKS = 5;
export const BLOT_TICKS = 600;
/** Ticks over which a blot fades at the end of its life. */
export const BLOT_FADE = 60;
/** Ticks a missed blow's scratch stays on the empty tile. */
export const SCRATCH_TICKS = 30;
/** Ticks the hatching of a landed blow takes to fade, so the tile never blinks clear. */
export const LANDED_FADE = 3;
/** How many strokes fill a marked tile by the time its blow lands. */
export const HATCH_STROKES = 7;
/**
 * The wind-up and the blow, in pixels and ticks: the attacker leans back over
 * the wind-up (at most LEAN_TICKS of it), lunges in LUNGE_OUT, holds for
 * HOLD, and comes back over LUNGE_BACK.
 */
export const LEAN_PX = 3;
export const LEAN_TICKS = 6;
export const LUNGE_PX = 6;
export const LUNGE_OUT = 1;
export const HOLD = 0.35;
export const LUNGE_BACK = 4;
/** The target slides this far away from the blow and squashes, as the lunge does. */
export const RECOIL_PX = 4;
/** Ticks a dodge hop takes, and how high it goes in pixels. */
export const DODGE_TICKS = 6;
export const DODGE_PX = 9;
/** Ticks a hitpoint ring takes to come in, go out, or move to a new value. */
export const RING_EASE = 3;
/** Ticks an actor still counts as fighting after it last struck, was struck at, or was marked. */
export const FIGHTING_TICKS = 50;
/** Below this share of its hitpoints a figure stoops. Ticks it takes to stoop or straighten. */
export const NEAR_DEATH = 0.3;
export const STOOP_TICKS = 4;
/** Ticks something new in the world takes to come in, or a monster going home to fade. */
export const ARRIVE_TICKS = 6;
/**
 * A downed resident: ticks it takes to topple, and ticks from the blow until
 * it starts to fade where it lies. It fades in at camp over the same
 * ARRIVE_TICKS it fades out over.
 */
export const TOPPLE_TICKS = 4;
export const LIE_TICKS = 30;
/** Ticks after it went up that a floating number still holds its place in a stack. */
export const FLOAT_STACK = 12;

/** What is remembered of each actor from the last tick. */
interface Seen {
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly max: number;
  readonly kind: string;
  readonly name: string;
  readonly windup: number;
  readonly facing: 1 | -1;
}

/** A unit step on the map: which way a blow went. */
interface Way {
  readonly dx: number;
  readonly dy: number;
}

export interface Floater {
  readonly since: number;
  /** The tile it rises from. */
  readonly x: number;
  readonly y: number;
  readonly damage: number;
  /** Which of several numbers on one tile at one tick it is, so they stand apart. */
  readonly order: number;
}

/** Something that fell: a monster killed, or a resident downed and carried to camp. */
export interface Fallen {
  readonly since: number;
  readonly x: number;
  readonly y: number;
  readonly kind: string;
  readonly id: number;
  readonly facing: 1 | -1;
  /** For a resident downed: the name of the monster whose blow did it. */
  readonly by?: string;
}

/** A monster gone home, fading where it was last. */
export type Gone = Fallen;

export interface Scratch extends Way {
  readonly since: number;
  readonly x: number;
  readonly y: number;
}

export interface Landed {
  readonly since: number;
  readonly x: number;
  readonly y: number;
  /** Who struck it. */
  readonly by: number;
}

export interface Ring {
  /** The share of hitpoints shown before the last change, the share now, and when it changed. */
  readonly from: number;
  readonly to: number;
  readonly since: number;
  /** When the ring came in, and when it began to go out (null while it stays). */
  readonly on: number;
  readonly off: number | null;
}

export interface Fight {
  readonly tick: number;
  readonly seen: ReadonlyMap<number, Seen>;
  /** The marked tiles at the last tick. */
  readonly marks: readonly Mark[];
  /** Each actor in a wind-up: when it began, how long it runs, and which way it goes. */
  readonly windups: ReadonlyMap<number, Way & { readonly since: number; readonly length: number }>;
  readonly lunges: ReadonlyMap<number, Way & { readonly since: number }>;
  readonly recoils: ReadonlyMap<number, Way & { readonly since: number }>;
  readonly dodges: ReadonlyMap<number, { readonly since: number }>;
  readonly arrivals: ReadonlyMap<number, number>;
  readonly engaged: ReadonlyMap<number, number>;
  readonly rings: ReadonlyMap<number, Ring>;
  /** Each figure's stoop: whether it is near death, and since when. */
  readonly stoops: ReadonlyMap<number, { readonly low: boolean; readonly since: number }>;
  readonly floaters: readonly Floater[];
  readonly fallen: readonly Fallen[];
  readonly gone: readonly Gone[];
  readonly scratches: readonly Scratch[];
  readonly landed: readonly Landed[];
  /** Residents downed, and the tick each went down, while they rest at camp. */
  readonly downs: ReadonlyMap<number, number>;
  /**
   * Lines of news from this tick, with the resident each is about. An urgent
   * one, a resident downed, goes up at once.
   */
  readonly news: readonly News[];
}

export interface News {
  readonly text: string;
  readonly who: number;
  readonly urgent?: boolean;
  /** A close call: old news once the same resident is downed. */
  readonly close?: boolean;
  /**
   * News of what a resident is doing (see line.ts): what its line says it is
   * doing. It is true only while it still does that.
   */
  readonly doing?: string;
}

export const NO_FIGHT: Fight = {
  tick: Number.NEGATIVE_INFINITY,
  seen: new Map(),
  marks: [],
  windups: new Map(),
  lunges: new Map(),
  recoils: new Map(),
  dodges: new Map(),
  arrivals: new Map(),
  engaged: new Map(),
  rings: new Map(),
  stoops: new Map(),
  floaters: [],
  fallen: [],
  gone: [],
  scratches: [],
  landed: [],
  downs: new Map(),
  news: [],
};

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** "a wolf", "a goblin": how the news names a monster. */
const aMonster = (name: string): string => {
  const lower = name.toLowerCase();
  return /^[aeiou]/.test(lower) ? `an ${lower}` : `a ${lower}`;
};

const isLow = (hp: number, max: number): boolean => hp > 0 && hp < max * NEAR_DEATH;

/**
 * The fight after a tick. As with effects.ts, an actor seen for the first
 * time starts nothing but its arrival, and nothing is read across missed
 * ticks: a change across a gap is not one that just happened.
 */
export function nextFight(previous: Fight, world: World): Fight {
  const tick = world.tick;
  const followsOn = previous.tick === tick - 1;
  const was = followsOn ? previous.seen : new Map<number, Seen>();
  const byId = new Map(world.actors.map((actor) => [actor.id, actor]));
  const keep = <T>(map: ReadonlyMap<number, T>, alive: (value: T) => boolean): Map<number, T> =>
    new Map([...map].filter(([id, value]) => byId.has(id) && alive(value)));

  const windups = new Map<number, Way & { since: number; length: number }>();
  const lunges = keep(previous.lunges, (l) => tick - l.since < LUNGE_OUT + HOLD + LUNGE_BACK + 1);
  const recoils = keep(previous.recoils, (r) => tick - r.since < LUNGE_OUT + HOLD + LUNGE_BACK + 1);
  const dodges = keep(previous.dodges, (d) => tick - d.since < DODGE_TICKS);
  const arrivals = keep(previous.arrivals, (since) => tick - since < ARRIVE_TICKS);
  const engaged = keep(previous.engaged, (at) => tick - at < FIGHTING_TICKS);
  const floaters = previous.floaters.filter((f) => tick - f.since < FLOAT_TICKS);
  const fallen = previous.fallen.filter((f) => tick - f.since < BLOT_TICKS);
  const gone = previous.gone.filter((g) => tick - g.since < ARRIVE_TICKS);
  const scratches = previous.scratches.filter((s) => tick - s.since < SCRATCH_TICKS);
  const landed = previous.landed.filter((l) => tick - l.since < LANDED_FADE);
  const downs = keep(previous.downs, (since) => tick - since < DOWN_TICKS);
  const news: News[] = [];

  // The blows that landed this tick: marks of the last tick whose attacker's
  // wind-up was on its last tick. A monster killed before its own blow came
  // round is gone, and its blow never landed. Residents strike first, being
  // older, so one carried off to camp this tick still struck.
  const blows = followsOn
    ? previous.marks.filter((mark) => was.get(mark.by)?.windup === 1 && byId.has(mark.by))
    : [];
  const enemyOf = (a: string, b: string): boolean => (a === ADVENTURER) !== (b === ADVENTURER);
  // Everyone struck, by what, from the tiles they stood on at the last tick.
  // Each blow's damage is kept apart, so each gets its own number.
  const struck = new Map<number, { damage: number; hits: number[]; from: Mark[] }>();
  // What each has left as the blows land in turn: as in the sim, one already out takes no more.
  const left = new Map<number, number>();
  for (const blow of blows) {
    const attacker = was.get(blow.by) as Seen;
    let hit = false;
    for (const [id, seen] of was) {
      if (seen.x !== blow.x || seen.y !== blow.y || (left.get(id) ?? seen.hp) <= 0) continue;
      if (!enemyOf(seen.kind, attacker.kind)) continue;
      const attackerActor = byId.get(blow.by) as Actor;
      const entry = struck.get(id) ?? { damage: 0, hits: [], from: [] };
      const damage = kindOf(world, attackerActor).damage;
      entry.damage += damage;
      entry.hits.push(damage);
      left.set(id, (left.get(id) ?? seen.hp) - damage);
      entry.from.push(blow);
      struck.set(id, entry);
      hit = true;
    }
    const at = was.get(blow.by) as Seen;
    const dx = sign(blow.x - at.x);
    const dy = sign(blow.y - at.y);
    if (lunges.get(blow.by)?.since !== tick) lunges.set(blow.by, { since: tick, dx, dy });
    landed.push({ since: tick, x: blow.x, y: blow.y, by: blow.by });
    if (!hit) scratches.push({ since: tick, x: blow.x, y: blow.y, dx, dy });
  }

  // Numbers on one tile stand apart: each takes the first place in the stack
  // that no number still rising there holds.
  const float = (x: number, y: number, hits: readonly number[]): void => {
    for (const damage of hits) {
      const taken = new Set(
        floaters
          .filter((f) => f.x === x && f.y === y && tick - f.since < FLOAT_STACK)
          .map((f) => f.order),
      );
      let order = 0;
      while (taken.has(order)) order++;
      floaters.push({ since: tick, x, y, damage, order });
    }
  };

  for (const [id, { damage, hits, from }] of struck) {
    const seen = was.get(id) as Seen;
    // The last blow to land is the one that killed or downed it.
    const by = (from.at(-1) as Mark).by;
    const attacker = was.get(by) as Seen;
    const now = byId.get(id);
    const way = { dx: sign(seen.x - attacker.x), dy: sign(seen.y - attacker.y) };
    engaged.set(id, tick);
    for (const mark of from) engaged.set(mark.by, tick);
    if (seen.kind !== ADVENTURER && now === undefined) {
      // A monster killed: it falls where it stood.
      float(seen.x, seen.y, hits);
      fallen.push({ since: tick, x: seen.x, y: seen.y, kind: seen.kind, id, facing: seen.facing });
      news.push({ text: `${attacker.name} killed ${aMonster(seen.name)}`, who: by });
      continue;
    }
    if (!now) continue;
    if (seen.kind === ADVENTURER && damage >= seen.hp) {
      // Downed: it falls where it stood, lies there a while, and only then
      // wakes at camp, so the two are never on the map at once.
      float(seen.x, seen.y, hits);
      fallen.push({
        since: tick,
        x: seen.x,
        y: seen.y,
        kind: seen.kind,
        id,
        facing: seen.facing,
        by: attacker.name,
      });
      arrivals.set(id, tick + LIE_TICKS);
      downs.set(id, tick);
      news.push({
        text: `${seen.name} was downed by ${aMonster(attacker.name)}`,
        who: id,
        urgent: true,
      });
      continue;
    }
    float(seen.x, seen.y, hits);
    recoils.set(id, { since: tick, ...way });
    if (seen.kind === ADVENTURER && isLow(now.hp, seen.max) && !isLow(seen.hp, seen.max)) {
      news.push({
        text: `${seen.name} took a blow from ${aMonster(attacker.name)}, ${now.hp} hitpoints left`,
        who: id,
        close: true,
      });
    }
  }

  // Monsters gone without being killed went home: they fade where they were.
  for (const [id, seen] of was) {
    if (byId.has(id) || struck.has(id) || seen.kind === ADVENTURER) continue;
    gone.push({ since: tick, x: seen.x, y: seen.y, kind: seen.kind, id, facing: seen.facing });
  }

  const marked = new Map<string, Mark[]>();
  for (const mark of world.marks) {
    const key = `${mark.x},${mark.y}`;
    marked.set(key, [...(marked.get(key) ?? []), mark]);
  }
  const lastMarked = new Map<string, Mark[]>();
  for (const mark of previous.marks) {
    const key = `${mark.x},${mark.y}`;
    lastMarked.set(key, [...(lastMarked.get(key) ?? []), mark]);
  }

  const seen = new Map<number, Seen>();
  const rings = new Map<number, Ring>();
  const stoops = new Map<number, { low: boolean; since: number }>();
  for (const actor of world.actors) {
    const id = actor.id;
    const max = kindOf(world, actor).hp;
    const before = was.get(id);
    const step = actor.x - actor.fromX;
    const facing: 1 | -1 =
      step > 0 ? 1 : step < 0 ? -1 : (before?.facing ?? previous.seen.get(id)?.facing ?? 1);
    seen.set(id, {
      x: actor.x,
      y: actor.y,
      hp: actor.hp,
      max,
      kind: actor.kind,
      name: actor.name,
      windup: actor.windup,
      facing,
    });
    if (followsOn && !before) arrivals.set(id, tick);

    // A wind-up runs from the tick it began; which way it goes is towards its marks.
    if (actor.windup > 0) {
      const old = previous.windups.get(id);
      const mine = world.marks.find((mark) => mark.by === id);
      if (old && before && before.windup > actor.windup) windups.set(id, old);
      else if (mine)
        windups.set(id, {
          since: tick,
          length: actor.windup,
          dx: sign(mine.x - actor.x),
          dy: sign(mine.y - actor.y),
        });
      engaged.set(id, tick);
    }
    // Standing on a marked tile, or striking at someone, counts as fighting.
    for (const mark of marked.get(`${actor.x},${actor.y}`) ?? []) {
      const by = byId.get(mark.by);
      if (by && enemyOf(by.kind, actor.kind)) engaged.set(id, tick);
    }
    // A dodge: it stood on a tile an enemy had marked, and has just stepped off it.
    if (
      before &&
      actor.moveTicksLeft > 0 &&
      actor.fromX === before.x &&
      actor.fromY === before.y &&
      (actor.x !== before.x || actor.y !== before.y) &&
      (lastMarked.get(`${before.x},${before.y}`) ?? []).some((mark) => {
        const by = was.get(mark.by);
        return by !== undefined && enemyOf(by.kind, actor.kind);
      })
    ) {
      dodges.set(id, { since: tick });
    }

    // The ring under it: while it is hurt or fighting, easing to each new value.
    const share = Math.max(0, Math.min(1, actor.hp / max));
    const wanted = actor.hp < max || engaged.has(id);
    const ring = previous.rings.get(id);
    const carried = downs.get(id) === tick;
    if (ring && !carried && (ring.off === null || tick - ring.off < RING_EASE || wanted)) {
      const shown = ringShare(ring, tick);
      const moved = share !== ring.to ? { from: shown, to: share, since: tick } : ring;
      const off = wanted ? null : (ring.off ?? tick);
      // Back on while going out: it comes in again from where it had got to.
      const on =
        wanted && ring.off !== null ? tick - ringStrength(ring, tick) * RING_EASE : ring.on;
      rings.set(id, { from: moved.from, to: moved.to, since: moved.since, on, off });
    } else if (wanted) {
      rings.set(id, { from: share, to: share, since: tick, on: tick, off: null });
    }

    const low = isLow(actor.hp, max);
    const stoop = previous.stoops.get(id);
    stoops.set(
      id,
      stoop && stoop.low === low ? stoop : { low, since: stoop ? tick : -STOOP_TICKS },
    );
  }

  return {
    tick,
    seen,
    marks: world.marks.map((mark) => ({ ...mark })),
    windups,
    lunges,
    recoils,
    dodges,
    arrivals,
    engaged,
    rings,
    stoops,
    floaters,
    fallen,
    gone,
    scratches,
    landed,
    downs,
    news,
  };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** The share of hitpoints a ring shows at `time`, easing from its last value to its new one. */
export function ringShare(ring: Ring, time: number): number {
  return ring.from + (ring.to - ring.from) * smooth((time - ring.since) / RING_EASE);
}

/** How strongly a ring is drawn at `time`, 0 to 1. */
export function ringStrength(ring: Ring, time: number): number {
  const come = smooth((time - ring.on) / RING_EASE);
  return ring.off === null ? come : Math.min(come, 1 - smooth((time - ring.off) / RING_EASE));
}

/** How much of a marked tile is hatched, 0 to HATCH_STROKES: a stroke more for each part of the wind-up gone. */
export function hatchAt(fight: Fight, by: number, time: number): number {
  const windup = fight.windups.get(by);
  if (!windup) return 0;
  // The first stroke is down as soon as the tile is marked, the last as the blow lands.
  const done = (time - windup.since + 1) / (windup.length + 1);
  return Math.max(0, Math.min(1, done)) * HATCH_STROKES;
}

/**
 * Where a figure is pushed by the fight at `time`, in pixels: back from its
 * blow through the wind-up, forward in the lunge, away from a blow that hit
 * it, up in a dodge. `squash` is how flat it is pressed, 0 to 1.
 */
export function shove(
  fight: Fight,
  id: number,
  time: number,
): { x: number; y: number; squash: number } {
  let x = 0;
  let y = 0;
  let squash = 0;
  const windup = fight.windups.get(id);
  if (windup) {
    const back = LEAN_PX * smooth((time - windup.since) / Math.min(LEAN_TICKS, windup.length));
    x -= windup.dx * back;
    y -= windup.dy * back;
  }
  const lunge = fight.lunges.get(id);
  if (lunge && !windup) {
    const reach = lungeAt(time - lunge.since);
    x += lunge.dx * reach;
    y += lunge.dy * reach;
  }
  const recoil = fight.recoils.get(id);
  if (recoil) {
    const reach = thrust(time - recoil.since);
    x += recoil.dx * RECOIL_PX * reach;
    y += recoil.dy * RECOIL_PX * reach;
    squash = Math.max(squash, reach);
  }
  const dodge = fight.dodges.get(id);
  if (dodge) {
    const age = (time - dodge.since) / DODGE_TICKS;
    if (age > 0 && age < 1) y -= Math.sin(Math.PI * age) * DODGE_PX;
  }
  return { x, y, squash };
}

/**
 * How far forward an attacker is, in pixels, `age` ticks after its blow
 * landed: from leaning LEAN_PX back to LUNGE_PX forward in LUNGE_OUT, held
 * for HOLD, and back to where it stands over LUNGE_BACK.
 */
export function lungeAt(age: number): number {
  if (age < 0) return 0;
  if (age < LUNGE_OUT) return -LEAN_PX + (LEAN_PX + LUNGE_PX) * smooth(age / LUNGE_OUT);
  return LUNGE_PX * thrust(age);
}

/**
 * How far out a lunge or recoil is, 0 to 1, `age` ticks after its blow
 * landed: out in LUNGE_OUT, held for HOLD, back over LUNGE_BACK.
 */
export function thrust(age: number): number {
  if (age <= 0) return 0;
  if (age < LUNGE_OUT) return smooth(age / LUNGE_OUT);
  if (age < LUNGE_OUT + HOLD) return 1;
  return 1 - smooth((age - LUNGE_OUT - HOLD) / LUNGE_BACK);
}

/** How far a figure stoops at `time`, 0 upright to 1 bent over. */
export function stoopAt(fight: Fight, id: number, time: number): number {
  const stoop = fight.stoops.get(id);
  if (!stoop) return 0;
  const t = smooth((time - stoop.since) / STOOP_TICKS);
  return stoop.low ? t : 1 - t;
}

/** How strongly a figure is drawn at `time` as it comes into the world, 0 to 1. */
export function arrivalAt(fight: Fight, id: number, time: number): number {
  const since = fight.arrivals.get(id);
  return since === undefined ? 1 : smooth((time - since) / ARRIVE_TICKS);
}

/** A floating number at `time`: how far it has risen, in pixels, and how strongly it is drawn. */
export function floatAt(floater: Floater, time: number): { rise: number; alpha: number } | null {
  const age = time - floater.since;
  if (age < 0 || age >= FLOAT_TICKS) return null;
  const t = age / FLOAT_TICKS;
  // Up fast, then slowing, as if thrown.
  const rise = FLOAT_RISE * (1 - (1 - t) * (1 - t));
  const alpha = Math.min(smooth(age / 1.5), smooth((FLOAT_TICKS - age) / FLOAT_FADE));
  return alpha > 0 ? { rise, alpha } : null;
}

/**
 * How a fallen monster or resident is drawn at `time`: `collapse` is how far
 * the figure has sunk, 0 to 1 (gone at 1), and `blot` how strongly the stain
 * is drawn. Null once the stain is gone.
 */
export function fallenAt(fallen: Fallen, time: number): { collapse: number; blot: number } | null {
  const age = time - fallen.since;
  if (age < 0 || age >= BLOT_TICKS) return null;
  const collapse = smooth(age / COLLAPSE_TICKS);
  const blot = Math.min(smooth(age / COLLAPSE_TICKS), smooth((BLOT_TICKS - age) / BLOT_FADE));
  return { collapse, blot };
}

/**
 * How a downed resident is drawn at `time`: `tip` is how far it has toppled,
 * 0 standing to 1 flat on the ground; `alpha` how strongly the body is drawn
 * as it lies there and then fades; `scuff` how strongly the scuffed ground it
 * leaves is drawn. Null once the scuff is gone.
 */
export function lyingAt(
  fallen: Fallen,
  time: number,
): { tip: number; alpha: number; scuff: number } | null {
  const age = time - fallen.since;
  if (age < 0 || age >= BLOT_TICKS) return null;
  const tip = smooth(age / TOPPLE_TICKS);
  const alpha = 1 - smooth((age - LIE_TICKS) / ARRIVE_TICKS);
  const scuff = Math.min(tip, smooth((BLOT_TICKS - age) / BLOT_FADE));
  return { tip, alpha, scuff };
}

/** How strongly a scratch, or the hatching of a blow just landed, is drawn at `time`. */
export function fadeAt(since: number, life: number, time: number): number {
  const age = time - since;
  if (age < 0 || age >= life) return 0;
  return 1 - smooth(age / life);
}
