// Skills: experience per skill, and the level it makes, from 1 to 99. Only
// adventurers have skills. Experience only comes from doing the thing; see
// `gainXp` for who calls it.

/**
 * Every skill, in the order an actor's `xp` list holds them. Programs name a
 * skill by its position, so the order is permanent: append only.
 */
export const SKILLS = ["melee", "hitpoints", "woodcutting", "fishing", "cooking"] as const;
export type Skill = (typeof SKILLS)[number];

export const MAX_LEVEL = 99;
/** Experience stops counting here, so it always fits in 32 bits. */
export const MAX_XP = 200_000_000;
/** Experience per hitpoint taken off an enemy (Melee) or taken (Hitpoints). */
export const XP_PER_DAMAGE = 4;

/** 2^(r/7) for r = 0 to 6, in millionths, so the curve needs no floating point. */
const SEVENTH_ROOTS = [1_000_000, 1_104_090, 1_219_014, 1_345_900, 1_485_994, 1_640_671, 1_811_447];

/** `n / d` rounded down, for whole n >= 0 and d > 0, without a floating-point division. */
const div = (n: number, d: number): number => (n - (n % d)) / d;

/**
 * XP_TABLE[level] is the experience that level starts at; XP_TABLE[1] is 0.
 * Each level needs about a tenth more than the one before: going from level
 * l to l + 1 adds l + 300 * 2^(l/7) points, and the experience is a quarter
 * of the points, rounded down. Level 2 is at 83, level 99 at about 13 million.
 */
export const XP_TABLE: readonly number[] = (() => {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level < MAX_LEVEL; level++) {
    const r = level % 7;
    const doublings = 2 ** div(level, 7);
    points += level + div(300 * doublings * (SEVENTH_ROOTS[r] as number), 1_000_000);
    table.push(div(points, 4));
  }
  return Object.freeze(table);
})();

/** The level `xp` experience makes: 1 to MAX_LEVEL. */
export function levelFor(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && (XP_TABLE[level + 1] as number) <= xp) level++;
  return level;
}

/** A fresh list of experience, all 0, one entry per skill. */
export const noXp = (): number[] => new Array<number>(SKILLS.length).fill(0);

/**
 * Adds `amount` experience in `skill` to the list `xp`, up to MAX_XP, and
 * returns the new level if it went up, or 0 if it did not.
 */
export function gainXp(xp: number[], skill: Skill, amount: number): number {
  const index = SKILLS.indexOf(skill);
  const before = xp[index] as number;
  if (amount <= 0) return 0;
  const after = Math.min(MAX_XP, before + amount);
  xp[index] = after;
  const level = levelFor(after);
  return level > levelFor(before) ? level : 0;
}
