// What a figure is drawn from, besides its colours: the looks a resident keeps
// (hood shape, cloak pattern, a mark, how it sits to rest), the kit its best
// trade has earned, and how it walks. The looks come from the id, the way the
// colours in identity.ts do; the kit, the gait and the height of the hat come
// from the levels. Pure,
// so the choice of parts can be tested without a canvas.

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

/** How much taller than a newcomer's a hat is at the highest total level, in figure units. */
export const RISE_MAX = 16;

/**
 * How much taller than a newcomer's the hat is, in figure units, from the
 * total of all levels: 0 for a newcomer, RISE_MAX with every skill at 99, and
 * higher for every level gained in between, whatever the skill. It is the one
 * part of a figure that says how far along a resident is; the kit says what at.
 * It grows fastest early, so the first levels already show.
 */
export function riseFor(xp: readonly number[]): number {
  const fresh = SKILLS.length;
  const share = (totalLevel(xp) - fresh) / (SKILLS.length * 99 - fresh);
  return RISE_MAX * Math.sqrt(Math.min(1, Math.max(0, share)));
}

export interface Parts {
  readonly looks: Looks;
  readonly kit: Kit;
  readonly gait: number;
  /** See `riseFor`. */
  readonly rise: number;
}

/** Everything a figure is drawn from, besides its colours, for this actor (or just an id). */
export function partsFor(actor: Pick<Actor, "id" | "xp"> | number): Parts {
  const id = typeof actor === "number" ? actor : actor.id;
  const xp = typeof actor === "number" ? [] : actor.xp;
  return { looks: looks(id), kit: kitFor(id, xp), gait: gaitFor(xp), rise: riseFor(xp) };
}
