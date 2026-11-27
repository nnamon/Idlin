// Who lives at the camp. The first six are the regulars; a larger cast, for
// seeing how a crowd reads, is filled out with made-up names. Pure, so the
// capture tool can build the same cast without a page.

const REGULARS = ["Ash", "Birch", "Cedar", "Dara", "Elm", "Fen"];
const PROGRAMS = ["wanderer", "homebody", "riverwalker"];
const ONSETS = ["B", "D", "G", "H", "K", "L", "M", "N", "P", "R", "S", "T", "V", "W"];
const VOWELS = ["a", "e", "i", "o", "u"];
const CODAS = ["n", "r", "l", "sh", "th", "m", "k"];
export const MAX_CAST = 200;

/** The name of the nth resident: always the same, and no two alike within MAX_CAST. */
export function residentName(index: number): string {
  if (index < REGULARS.length) return REGULARS[index] as string;
  // Stride through the syllables so neighbours in the list do not rhyme.
  const n = (index - REGULARS.length) * 37;
  const onset = ONSETS[n % ONSETS.length] as string;
  const vowel = VOWELS[Math.floor(n / ONSETS.length) % VOWELS.length] as string;
  const coda = CODAS[Math.floor(n / (ONSETS.length * VOWELS.length)) % CODAS.length] as string;
  return onset + vowel + coda;
}

/** The best-trade levels `spreadLevels` hands out, one per resident in turn. */
export const SPREAD = [1, 25, 45, 65, 85, 12, 30, 50, 70, 92, 5, 99] as const;
const TRADE_ORDER = [2, 3, 0, 4] as const; // woodcutting, fishing, melee, cooking, by index in SKILLS

/**
 * For captures only (`?levels`): gives the residents of a world of the
 * viewer's own a spread of levels, so that figures of every kit tier and gait
 * can be seen side by side. The nth resident gets SPREAD[n] in one trade and a
 * third of that in each other skill. Hitpoints are left alone: the most a
 * resident can have is its kind's, whatever its Hitpoints level. The world
 * server never does this.
 */
export function spreadLevels(
  actors: readonly { xp: number[] }[],
  xpAt: (level: number) => number,
): void {
  actors.forEach((actor, n) => {
    const level = SPREAD[n % SPREAD.length] as number;
    const trade = TRADE_ORDER[n % TRADE_ORDER.length] as number;
    for (let skill = 0; skill < actor.xp.length; skill++)
      actor.xp[skill] = xpAt(skill === trade ? level : Math.max(1, Math.floor(level / 3)));
  });
}

/** The death counts `spreadDeaths` hands out, one per resident in turn. The last is past the most patches drawn. */
export const DEATH_SPREAD = [0, 1, 3, 5, 9] as const;

/**
 * For captures only (`?deaths`): gives the residents of a world of the
 * viewer's own a spread of death counts, so that figures with no patches up
 * to the most can be seen side by side. The world server never does this.
 */
export function spreadDeaths(actors: readonly { deaths: number }[]): void {
  actors.forEach((actor, n) => {
    actor.deaths = DEATH_SPREAD[n % DEATH_SPREAD.length] as number;
  });
}

export function castOf(count: number): { name: string; program: string }[] {
  const size = Math.max(1, Math.min(MAX_CAST, Math.floor(count)));
  return Array.from({ length: size }, (_, i) => ({
    name: residentName(i),
    program: PROGRAMS[i % PROGRAMS.length] as string,
  }));
}
