// Hashing for world state: two independent 32-bit FNV-1a passes over a list of
// 32-bit integers, printed as 16 hex digits. Integer maths only.

const mixInto = (hash: number, value: number): number => {
  let h = hash;
  for (let shift = 0; shift < 32; shift += 8) {
    h = Math.imul(h ^ ((value >>> shift) & 0xff), 0x01000193);
  }
  return h;
};

export function hashInts(values: readonly number[]): string {
  let a = 0x811c9dc5 | 0;
  let b = 0x9747b28c | 0;
  for (const value of values) {
    a = mixInto(a, value | 0);
    b = mixInto(b, ~value | 0);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** A string as integers: its length, then its UTF-16 code units. */
export const stringInts = (text: string): number[] => [
  text.length,
  ...Array.from(text, (_, i) => text.charCodeAt(i)),
];
