// The statuses a hit leaves, as docs/slice.md section 4.2 sets them out: when
// each is set, how long it lasts and how long before it can come again. The
// world counts them down and does what each does (world.ts); this file holds
// the numbers and the rules for setting them. Integers only.

import { FULL, monsterLife, type Parts, type Rank } from "./hit.ts";

// Physical leaves a stagger, fire a burn, cold a chill (and a freeze, from a
// second chill) and lightning a shock.

/** How long a status lasts on a monster of each rank, in ticks: 4 seconds, or 2 on a brute and 1 on an elite. */
export const STATUS_TICKS: Readonly<Record<Rank, number>> = Object.freeze({
  fodder: 40,
  pack: 40,
  brute: 20,
  elite: 10,
});
/** How long a status lasts on a citizen, which has no rank. */
export const CITIZEN_STATUS_TICKS = 40;
/** A burn does its damage once a second. */
export const BURN_EVERY = 10;
/** After a stagger, and after a freeze thaws, so many ticks pass before another. */
export const LOCKOUT_TICKS = 20;
/** A shocked target takes 20% more from every hit: a "more" of this many hundredths of a percent. */
export const SHOCK_MORE = 2_000;
/** A hit on a shocked monster arcs for this share of its lightning part. */
export const ARC_SHARE = 3_000;
/** How far, in steps counted the way a king moves, a burn jumps, a shock arcs and a shatter chills. */
export const BURN_JUMP_REACH = 1;
export const ARC_REACH = 3;
export const SHATTER_REACH = 2;
/** A landing's monsters resist its element by 40%. */
export const LANDING_RESIST = 4_000;
/** A citizen takes a status from a part of at least this share of its life: 5%. */
export const CITIZEN_LINE = 500;

/**
 * What an actor is suffering, all in ticks or hitpoints. Every count is 0
 * when the status is off, and a burn's numbers are 0 while it does not burn.
 */
export interface Status {
  /** Ticks left of a burn. */
  burn: number;
  /** What the burn does each second. */
  burnDamage: number;
  /** Id of whoever set the burn, whose kill it is if the burn kills. */
  burnBy: number;
  /** 1 while the burn may still jump to a neighbour; a jumped burn never does. */
  burnJumps: number;
  chill: number;
  freeze: number;
  shock: number;
  /** Ticks before it can be staggered again. */
  staggerLock: number;
  /** Ticks before it can be frozen again, counted from the thaw. */
  freezeLock: number;
}

/** The fields of a Status, in the order a snapshot hashes them. */
export const STATUS_FIELDS = [
  "burn",
  "burnDamage",
  "burnBy",
  "burnJumps",
  "chill",
  "freeze",
  "shock",
  "staggerLock",
  "freezeLock",
] as const satisfies readonly (keyof Status)[];

export const noStatus = (): Status => ({
  burn: 0,
  burnDamage: 0,
  burnBy: 0,
  burnJumps: 0,
  chill: 0,
  freeze: 0,
  shock: 0,
  staggerLock: 0,
  freezeLock: 0,
});

/** `n / d` rounded down, for whole n >= 0 and d > 0. */
const div = (n: number, d: number): number => (n - (n % d)) / d;

/** An element's part that sets its status on a monster of `level`: a tenth of a fodder monster's life there. */
export const statusLine = (level: number): number => div(monsterLife("fodder", level), 10);

/** The physical part that staggers a monster: a tenth of its own life. */
export const staggerLine = (life: number): number => div(life, 10);

/** Any part that sets a status on a citizen: 5% of its life. */
export const citizenLine = (life: number): number => div(life * CITIZEN_LINE, FULL);

/** Steps and blows of a chilled body take half as long again. */
export const slowed = (ticks: number): number => ticks + div(ticks, 2);

/** Who takes a hit's statuses, and how. */
export interface Taker {
  /** A citizen takes the elements' statuses only, at its own line. */
  readonly citizen: boolean;
  /** Its full life, which sets the line for a citizen and for a stagger. */
  readonly life: number;
  /** A monster's level, which sets the elements' line. */
  readonly level: number;
  /** How long a status lasts on it. */
  readonly ticks: number;
}

/** What a hit did to its target's statuses, for the world to act on and report. */
export interface Took {
  readonly stagger: boolean;
  readonly burn: boolean;
  readonly chill: boolean;
  readonly freeze: boolean;
  readonly shock: boolean;
}

/**
 * Sets what one hit's parts, after the target's defences, leave on `status`.
 * No roll is involved. A part sets its status when it is over the line; a burn
 * stands if it is at least as strong as the one burning, and every other status
 * starts its time again. A cold hit over the line on a body chilled already
 * freezes it for half the status time, unless it is frozen or was frozen too
 * lately. A stagger needs a physical part of a tenth of a monster's life and
 * is not taken while its lockout runs; a citizen is never staggered. Does not
 * break the wind-up a stagger breaks: the world does that.
 */
export function takeHit(status: Status, parts: Parts, taker: Taker, by: number): Took {
  const [physical, fire, cold, lightning] = parts;
  const line = taker.citizen ? citizenLine(taker.life) : statusLine(taker.level);
  const over = (n: number): boolean => n > 0 && n >= line;
  const stagger =
    !taker.citizen &&
    physical > 0 &&
    physical >= staggerLine(taker.life) &&
    status.staggerLock === 0;
  if (stagger) status.staggerLock = LOCKOUT_TICKS;
  let burn = false;
  if (over(fire)) {
    // A citizen's burn does a fifth of the part a second, and at least 1.
    const strength = taker.citizen ? Math.max(1, div(fire, 5)) : fire;
    burn = setBurn(status, strength, by, taker.citizen ? 0 : 1, taker.ticks);
  }
  const chill = over(cold);
  const freeze = chill && status.chill > 0 && status.freeze === 0 && status.freezeLock === 0;
  if (chill) status.chill = taker.ticks;
  if (freeze) status.freeze = div(taker.ticks, 2);
  const shock = over(lightning);
  if (shock) status.shock = taker.ticks;
  return { stagger, burn, chill, freeze, shock };
}

/** Sets a burn if it is at least as strong as the one burning; returns whether it did. */
export function setBurn(
  status: Status,
  strength: number,
  by: number,
  jumps: number,
  ticks: number,
): boolean {
  if (status.burn > 0 && strength < status.burnDamage) return false;
  // A burn set over one still burning keeps that one's place in its second.
  // Blows land less than a second apart, and a count started afresh by each
  // of them would never reach a whole second.
  const into = status.burn > 0 ? (BURN_EVERY - (status.burn % BURN_EVERY)) % BURN_EVERY : 0;
  status.burn = ticks - into;
  status.burnDamage = strength;
  status.burnBy = by;
  status.burnJumps = jumps;
  return true;
}

/** How long a status lasts on a citizen, or on a monster of `rank`. */
export const statusTicksFor = (citizen: boolean, rank: Rank = "fodder"): number =>
  citizen ? CITIZEN_STATUS_TICKS : STATUS_TICKS[rank];

/**
 * Whether a world could hold `status` on an actor whose statuses last
 * `ticks`, its counts being whole and not below 0 already. A burn, chill or
 * shock lasts at most `ticks` and a freeze half that; a burning body's burn
 * does at least 1. A frozen body is chilled for longer than it stays frozen,
 * since the hit that freezes chills it afresh and both count down together,
 * and it is not in the lockout of a freeze. A citizen is never staggered and
 * its burns never jump.
 */
export function statusFits(status: Status, ticks: number, citizen: boolean): boolean {
  const { burn, burnDamage, burnJumps, chill, freeze, shock, staggerLock, freezeLock } = status;
  if (burn > ticks || chill > ticks || shock > ticks || freeze > div(ticks, 2)) return false;
  if (staggerLock > LOCKOUT_TICKS || freezeLock > LOCKOUT_TICKS || burnJumps > 1) return false;
  if (burn > 0 && burnDamage < 1) return false;
  if (freeze > 0 && (chill <= freeze || freezeLock > 0)) return false;
  if (citizen && (staggerLock > 0 || burnJumps > 0)) return false;
  return true;
}

/**
 * `status` with each count cut to what lasts `ticks`, for a monster whose
 * kind's rank now gives it less time; the same object if nothing was over.
 * Counts that are not numbers are left for the snapshot reader to refuse.
 */
export function cutStatus(status: Status, ticks: number): Status {
  const most = { burn: ticks, chill: ticks, shock: ticks, freeze: div(ticks, 2) };
  let cut: Status = status;
  for (const field of ["burn", "chill", "shock", "freeze"] as const) {
    const n = status[field];
    if (typeof n === "number" && n > most[field]) cut = { ...cut, [field]: most[field] };
  }
  return cut;
}

/** What one tick did to a status. */
export interface Passed {
  /** The burn's damage, if it burnt this tick, else 0. */
  readonly burnt: number;
  /** The burn may jump now, at its first second. */
  readonly jump: boolean;
  /** The freeze thawed this tick. */
  readonly thawed: boolean;
}

/**
 * Counts every status and lockout on `status` down one tick. A burn burns
 * each time a whole second of it has passed, and may jump at the first one;
 * a freeze that thaws starts its lockout.
 */
export function passTick(status: Status): Passed {
  let burnt = 0;
  let jump = false;
  if (status.burn > 0) {
    status.burn--;
    if (status.burn % BURN_EVERY === 0) {
      burnt = status.burnDamage;
      jump = status.burnJumps === 1;
      status.burnJumps = 0;
    }
    if (status.burn === 0) {
      status.burnDamage = 0;
      status.burnBy = 0;
      status.burnJumps = 0;
    }
  }
  if (status.chill > 0) status.chill--;
  if (status.shock > 0) status.shock--;
  if (status.staggerLock > 0) status.staggerLock--;
  if (status.freezeLock > 0) status.freezeLock--;
  let thawed = false;
  if (status.freeze > 0) {
    status.freeze--;
    if (status.freeze === 0) {
      status.freezeLock = LOCKOUT_TICKS;
      thawed = true;
    }
  }
  return { burnt, jump, thawed };
}
