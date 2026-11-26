// The hour of the day as the picture shows it: how much daylight there is, how
// strongly the lamps show, and the colour the sky lends the paper at dawn and
// dusk. All of it changes smoothly; nothing jumps.

export type Rgb = readonly [number, number, number];

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

const DAWN_START = 4.75;
const DAWN_END = 7.25;
const DUSK_START = 17.75;
const DUSK_END = 20.75;

/** 0 in the dead of night, 1 in full day. */
export function daylight(hour: number): number {
  if (hour < DAWN_START || hour >= DUSK_END) return 0;
  if (hour < DAWN_END) return smooth((hour - DAWN_START) / (DAWN_END - DAWN_START));
  if (hour < DUSK_START) return 1;
  return 1 - smooth((hour - DUSK_START) / (DUSK_END - DUSK_START));
}

/** How strongly lamps show: nothing by day, full at night. They come on a little before dark. */
export function lampStrength(hour: number): number {
  return smooth((1 - daylight(hour)) * 1.6);
}

/** The colour the sky lays over everything, and how strongly (0 to 1): rose at dawn, amber at dusk. */
export function skyCast(hour: number): { color: Rgb; alpha: number } {
  const bump = (centre: number, width: number): number => smooth(1 - Math.abs(hour - centre) / width);
  const dawn = bump(6, 1.4);
  const dusk = bump(19, 1.6);
  if (dawn >= dusk) return { color: [1, 0.62, 0.7], alpha: dawn * 0.22 };
  return { color: [1, 0.58, 0.2], alpha: dusk * 0.26 };
}

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const css = ([r, g, b]: Rgb, alpha = 1): string =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;

export const rgb = (hex: number): Rgb => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

export function phaseName(hour: number): string {
  if (hour < 5) return "night";
  if (hour < 7.5) return "dawn";
  if (hour < 11) return "morning";
  if (hour < 14) return "about noon";
  if (hour < 17.5) return "afternoon";
  if (hour < 20.5) return "dusk";
  return "night";
}
