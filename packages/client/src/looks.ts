// What a figure is drawn from, besides its colours: the looks a resident keeps
// (hood shape, cloak pattern, a mark, how it sits to rest), the kit its best
// trade has earned, and how it walks. The looks come from the id, the way the
// colours in identity.ts do; the kit, the gait, and the height and bands of the
// hat come from the levels. Pure, so the choice of parts can be tested without
// a canvas.

import { type Actor, levelFor, SKILLS, type Skill } from "@idlin/sim";

export const HOOD_SHAPES = ["point", "round", "brim", "cowl"] as const;
export type HoodShape = (typeof HOOD_SHAPES)[number];

export const PATTERNS = ["plain", "band", "stripe", "check"] as const;
export type Pattern = (typeof PATTERNS)[number];

export const REST_POSES = ["upright", "back", "hunch", "knees"] as const;
export type RestPose = (typeof REST_POSES)[number];

/** How many marks there are to choose from; see `markPath` in figure.ts. */
export const MARK_COUNT = 24;

export interface Looks {
  readonly hood: HoodShape;
  readonly pattern: Pattern;
  /** 0 to MARK_COUNT - 1. */
  readonly mark: number;
  readonly rest: RestPose;
}

/**
 * The looks of the resident with this id. Hood and pattern step through all
 * sixteen pairs over the first sixteen residents, and the first 24 residents
 * all have different marks. Neighbours in the list never share a hood shape.
 */
export function looks(id: number): Looks {
  const i = Number.isFinite(id) ? Math.max(0, Math.floor(id) - 1) : 0;
  return {
    hood: HOOD_SHAPES[i % 4] as HoodShape,
    pattern: PATTERNS[(i + Math.floor(i / 4)) % 4] as Pattern,
    // 7 and 24 share no factor, so this visits every mark before it repeats one.
    mark: (i * 7) % MARK_COUNT,
    rest: REST_POSES[(i * 3 + Math.floor(i / 4)) % 4] as RestPose,
  };
}

/** The trades a kit is drawn for. Hitpoints is not one: nobody carries a tool for it. */
export const TRADES = [
  "melee",
  "woodcutting",
  "fishing",
  "cooking",
] as const satisfies readonly Skill[];
export type Trade = (typeof TRADES)[number];

/** The level each kit tier starts at. */
export const TIER_LEVELS = [1, 20, 40, 60, 80] as const;

/** 0 to 4: the kit tier a level gives. */
export function tierFor(level: number): number {
  let tier = 0;
  while (tier < TIER_LEVELS.length - 1 && level >= (TIER_LEVELS[tier + 1] as number)) tier++;
  return tier;
}

export interface Kit {
  /** The trade the tool is for, or null for someone with no trade above level 1 yet. */
  readonly trade: Trade | null;
  /** 0 to 4, from the trade's level. 0 when there is no trade. */
  readonly tier: number;
  /** For someone with no trade yet, what it carries: 0 a staff, 1 a pack, 2 nothing. */
  readonly starter: number;
}

const levelOf = (xp: readonly number[], skill: Skill): number =>
  levelFor(xp[SKILLS.indexOf(skill)] ?? 0);

/**
 * The kit for the best trade: the one at the highest level, the first in
 * TRADES on a tie. Someone whose trades are all still at level 1 carries the
 * starter kit their id gives, as every resident did before levels existed.
 */
export function kitFor(id: number, xp: readonly number[]): Kit {
  const starter = Number.isFinite(id) ? ((Math.floor(id) % 3) + 3) % 3 : 0;
  let trade: Trade | null = null;
  let best = 1;
  for (const each of TRADES) {
    const level = levelOf(xp, each);
    if (level > best) {
      best = level;
      trade = each;
    }
  }
  return { trade, tier: trade ? tierFor(best) : 0, starter };
}

/** The total of a resident's levels in every skill: SKILLS.length for a newcomer. */
export const totalLevel = (xp: readonly number[]): number =>
  SKILLS.reduce((sum, skill) => sum + levelOf(xp, skill), 0);

/** The total level of all skills at which a resident walks as a veteran. */
export const VETERAN_TOTAL = 200;

/**
 * 0 to 1: how much of a veteran's walk it has, from the total of its levels.
 * 0 bobs along on short steps; 1 strides, lower and longer.
 */
export function gaitFor(xp: readonly number[]): number {
  const fresh = SKILLS.length;
  return Math.min(1, Math.max(0, (totalLevel(xp) - fresh) / (VETERAN_TOTAL - fresh)));
}

/**
 * How much taller than a newcomer's a hat is at the highest total level, in
 * figure units. With the hood's own 43 and the ink, that keeps the tallest hat
 * at 59 units, inside a portrait's row on the page (90 pixels at scale 1.5).
 */
export const RISE_MAX = 15;

/** The bend in `riseFor`'s curve: the smaller it is, the more of the height goes to the first levels. */
const RISE_EASE = 6;

/**
 * How much taller than a newcomer's the hat is, in figure units, from the
 * total of all levels: 0 for a newcomer, RISE_MAX with every skill at 99, and
 * higher for every level gained in between, whatever the skill. Every hood
 * shape's top is the same height for the same rise (see `HOOD_TOP` in
 * figure.ts), so the hat compares across shapes. It grows on a log scale, so
 * the first few levels move it furthest: about 5 units by a total of 28 and
 * 8 by 57, of the 15 it reaches at 495.
 */
export function riseFor(xp: readonly number[]): number {
  const fresh = SKILLS.length;
  const gained = Math.max(0, totalLevel(xp) - fresh);
  const most = SKILLS.length * 99 - fresh;
  return RISE_MAX * Math.min(1, Math.log1p(gained / RISE_EASE) / Math.log1p(most / RISE_EASE));
}

/** The total levels at which a hat gets each of its bands. */
export const BAND_TOTALS = [20, 50, 100, 200] as const;

/**
 * 0 to 4: how many bands the hat has, from the total of all levels. They go
 * round every hood shape the same way, as a second count of how far along a
 * resident is that reads on the page and on the map at full size.
 */
export function bandsFor(xp: readonly number[]): number {
  const total = totalLevel(xp);
  return BAND_TOTALS.filter((at) => total >= at).length;
}

export interface Parts {
  readonly looks: Looks;
  readonly kit: Kit;
  readonly gait: number;
  /** See `riseFor`. */
  readonly rise: number;
  /** See `bandsFor`. */
  readonly bands: number;
}

/** Everything a figure is drawn from, besides its colours, for this actor (or just an id). */
export function partsFor(actor: Pick<Actor, "id" | "xp"> | number): Parts {
  const id = typeof actor === "number" ? actor : actor.id;
  const xp = typeof actor === "number" ? [] : actor.xp;
  return {
    looks: looks(id),
    kit: kitFor(id, xp),
    gait: gaitFor(xp),
    rise: riseFor(xp),
    bands: bandsFor(xp),
  };
}
