// The four weapon families of docs/slice.md section 3.1: which tiles a blow
// covers, how long it takes, and how far it knocks a body back. The ground is
// a flat grid seen from above, so a blow faces one of eight directions on it.
// Integers only.

import { FULL } from "./hit.ts";
import type { Point } from "./map.ts";

export const FAMILIES = ["blade", "maul", "spear", "bow"] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * The eight directions a blow can face, a step east first and then round
 * clockwise as the map is drawn (y grows downwards). One place on in the list
 * is 45 degrees clockwise.
 */
export const DIRECTIONS: readonly (readonly [number, number])[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** A quarter of a tile, the unit knockback is counted in. */
export const QUARTERS_PER_TILE = 4;

/** How far an arrow flies, in tiles. */
export const ARROW_RANGE = 9;

export interface Weapon {
  /** Wind-up and recovery at Arms 1, in ticks. */
  readonly windup: number;
  readonly recovery: number;
  /** How far each hit pushes a body, in quarter tiles. */
  readonly knockback: number;
  /** The farthest tile a blow reaches, in steps counted the way a king moves. */
  readonly reach: number;
}

export const WEAPONS: Readonly<Record<Family, Weapon>> = Object.freeze({
  blade: Object.freeze({ windup: 2, recovery: 3, knockback: 1, reach: 2 }),
  maul: Object.freeze({ windup: 5, recovery: 5, knockback: 8, reach: 3 }),
  spear: Object.freeze({ windup: 3, recovery: 3, knockback: 4, reach: 4 }),
  bow: Object.freeze({ windup: 3, recovery: 2, knockback: 1, reach: ARROW_RANGE }),
});

/** Arms from which a tick comes off the recovery, and from which one comes off the wind-up. */
export const QUICKER_RECOVERY_ARMS = 30;
export const QUICKER_WINDUP_ARMS = 60;
/** No blow, wind-up and recovery together, is shorter than this. */
export const SHORTEST_BLOW = 2;

/** `n / d` rounded down, for whole n >= 0 and d > 0. */
const div = (n: number, d: number): number => (n - (n % d)) / d;

/**
 * The direction, as an index into DIRECTIONS, that faces (dx, dy) most
 * nearly, or -1 for (0, 0). A diagonal covers the angles from 22.6 to 67.4
 * degrees off the nearer axis, near enough to the even split of 22.5.
 */
export function directionTo(dx: number, dy: number): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax === 0 && ay === 0) return -1;
  // Mostly along one axis, the other counts for nothing.
  const sx = 12 * ax <= 5 * ay ? 0 : Math.sign(dx);
  const sy = 12 * ay <= 5 * ax ? 0 : Math.sign(dy);
  return DIRECTIONS.findIndex(([x, y]) => x === sx && y === sy);
}

/**
 * The tiles a blow facing direction `aim` covers, as offsets from the one who
 * swings, nearest first, before walls cut them. The first is always the step
 * in that direction.
 *
 * - Blade: an arc three tiles wide and two deep, the three tiles facing it and
 *   the three beyond those.
 * - Maul: the nine tiles of the square centred two tiles out.
 * - Spear: a line four tiles long.
 * - Bow: the arrow's line, nine tiles long.
 */
export function blowShape(family: Family, aim: number): Point[] {
  const [dx, dy] = DIRECTIONS[aim] as readonly [number, number];
  const [lx, ly] = DIRECTIONS[(aim + 7) % 8] as readonly [number, number];
  const [rx, ry] = DIRECTIONS[(aim + 1) % 8] as readonly [number, number];
  if (family === "blade")
    return [
      { x: dx, y: dy },
      { x: lx, y: ly },
      { x: rx, y: ry },
      { x: 2 * dx, y: 2 * dy },
      { x: dx + lx, y: dy + ly },
      { x: dx + rx, y: dy + ry },
    ];
  if (family === "maul") {
    const tiles: Point[] = [{ x: dx, y: dy }];
    for (let oy = -1; oy <= 1; oy++)
      for (let ox = -1; ox <= 1; ox++) {
        const x = 2 * dx + ox;
        const y = 2 * dy + oy;
        if (x !== dx || y !== dy) tiles.push({ x, y });
      }
    return tiles;
  }
  const length = family === "spear" ? 4 : ARROW_RANGE;
  return Array.from({ length }, (_, k) => ({ x: dx * (k + 1), y: dy * (k + 1) }));
}

/** Whether a family's blow is a line, cut at the first wall, rather than an area. */
export const isLine = (family: Family): boolean => family === "spear" || family === "bow";

export interface BlowTimes {
  readonly windup: number;
  readonly recovery: number;
  /** Hundredths of a tick left over, carried into the next blow. */
  readonly carry: number;
}

/**
 * How long a blow takes at an Arms level, with `faster` hundredths of a
 * percent off ("N% faster" lines, summed) and `carry` hundredths of a tick
 * left from the last blow. A tick comes off the recovery at Arms 30 and one
 * off the wind-up at 60; then `faster` takes its share off each, held in
 * hundredths of a tick, and what is under a whole tick carries on. A wind-up
 * is at least 1 tick, and the two together at least SHORTEST_BLOW.
 */
export function blowTimes(family: Family, arms: number, faster = 0, carry = 0): BlowTimes {
  const weapon = WEAPONS[family];
  const windup = weapon.windup - (arms >= QUICKER_WINDUP_ARMS ? 1 : 0);
  const recovery = weapon.recovery - (arms >= QUICKER_RECOVERY_ARMS ? 1 : 0);
  const keep = FULL - Math.min(FULL, Math.max(0, faster));
  const windupHundredths = carry + div(windup * 100 * keep, FULL);
  const wound = div(windupHundredths, 100);
  const recoveryHundredths = (windupHundredths % 100) + div(recovery * 100 * keep, FULL);
  const recovered = div(recoveryHundredths, 100);
  const w = Math.max(1, wound);
  return {
    windup: w,
    recovery: Math.max(SHORTEST_BLOW - w, recovered),
    carry: recoveryHundredths % 100,
  };
}

/** A flask holds this many drinks, each giving back this share of life, and one comes back for so many kills. */
export const FLASK_DRINKS = 3;
export const DRINK_SHARE = 4_000;
export const KILLS_PER_DRINK = 20;

/** What one drink gives back to a body of `life` hitpoints. */
export const drinkOf = (life: number): number => div(life * DRINK_SHARE, FULL);
