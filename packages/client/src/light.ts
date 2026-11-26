// The colour of the day. Ambient light multiplies the whole world; lamps add to it.

export type Rgb = readonly [number, number, number];

/** Ambient light by game hour. Night stays readable: dim and blue, never black. */
const KEYS: readonly (readonly [number, Rgb])[] = [
  [0, [0.3, 0.36, 0.62]],
  [4.5, [0.32, 0.38, 0.64]],
  [6, [0.86, 0.72, 0.74]],
  [7.5, [1, 0.97, 0.9]],
  [9, [1, 1, 1]],
  [16.5, [1, 1, 1]],
  [18.5, [1, 0.8, 0.62]],
  [20, [0.62, 0.5, 0.72]],
  [21.5, [0.34, 0.39, 0.66]],
  [24, [0.3, 0.36, 0.62]],
];

export function ambientAt(hour: number): Rgb {
  for (let i = 1; i < KEYS.length; i++) {
    const [h1, c1] = KEYS[i] as (typeof KEYS)[number];
    const [h0, c0] = KEYS[i - 1] as (typeof KEYS)[number];
    if (hour <= h1) {
      const t = (hour - h0) / (h1 - h0);
      return [0, 1, 2].map(
        (k) => (c0[k] as number) + ((c1[k] as number) - (c0[k] as number)) * t,
      ) as unknown as Rgb;
    }
  }
  return (KEYS[0] as (typeof KEYS)[number])[1];
}

/** How strongly lamps show: nothing at noon, full at night. */
export function lampStrength(hour: number): number {
  const [r, g, b] = ambientAt(hour);
  const brightness = (r + g + b) / 3;
  return Math.min(1, Math.max(0, (0.95 - brightness) / 0.5));
}

export const toHex = ([r, g, b]: Rgb): number =>
  (Math.round(Math.min(1, r) * 255) << 16) |
  (Math.round(Math.min(1, g) * 255) << 8) |
  Math.round(Math.min(1, b) * 255);

export function phaseName(hour: number): string {
  if (hour < 5) return "Night";
  if (hour < 7.5) return "Dawn";
  if (hour < 17) return "Day";
  if (hour < 20.5) return "Dusk";
  return "Night";
}
