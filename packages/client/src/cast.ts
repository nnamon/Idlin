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

export function castOf(count: number): { name: string; program: string }[] {
  const size = Math.max(1, Math.min(MAX_CAST, Math.floor(count)));
  return Array.from({ length: size }, (_, i) => ({
    name: residentName(i),
    program: PROGRAMS[i % PROGRAMS.length] as string,
  }));
}
