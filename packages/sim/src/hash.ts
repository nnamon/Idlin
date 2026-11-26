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
export function stringInts(text: string): number[] {
  const ints = [text.length];
  for (let i = 0; i < text.length; i++) ints.push(text.charCodeAt(i));
  return ints;
}

/** A value as short text for an error message. Never throws, whatever it is given. */
export function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "a list"
      : `a value of type ${typeof value}`;
}

/** True for a whole number that fits in 32 bits, signed. */
export const isInt32 = (value: unknown): value is number =>
  typeof value === "number" && (value | 0) === value;
