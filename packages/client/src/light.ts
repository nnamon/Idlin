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

/** How wide the soft edge between day and night is, in frame pixels. */
export const EDGE = 260;
/** The game hour at which the dark starts to close in, and the one at which the light starts to spread. */
export const NIGHTFALL = 19.8;
export const DAYBREAK = 5.6;
/** How long either takes, in game hours: a little over half a minute of stream time. */
export const TURN_HOURS = 0.6;

/**
 * Which part of the frame is in daylight. Day and night are two different
 * drawings, and a frame that is half one and half the other reads as a fault,
 * so the change is quick and has one shape: at nightfall the dark closes in on
 * the lantern from all round, and at daybreak the light spreads out from it
 * again. Before and after, the hour shows in the colour of the light and in
 * the lamps, which change slowly.
 *
 * `reach` is the distance from the lantern to the farthest corner of the frame.
 */
export type DayRegion =
  | { readonly kind: "all" }
  | { readonly kind: "none" }
  /** Day inside this distance of the lantern, fading to night over EDGE beyond it. */
  | { readonly kind: "circle"; readonly radius: number };

export function dayRegion(hour: number, reach: number): DayRegion {
  // The radius runs from -EDGE (no day left at all) to `reach` (day everywhere).
  const radius = (open: number): number => smooth(open) * (reach + EDGE) - EDGE;
  if (hour >= DAYBREAK && hour < DAYBREAK + TURN_HOURS) {
    return { kind: "circle", radius: radius((hour - DAYBREAK) / TURN_HOURS) };
  }
  if (hour >= NIGHTFALL && hour < NIGHTFALL + TURN_HOURS) {
    return { kind: "circle", radius: radius(1 - (hour - NIGHTFALL) / TURN_HOURS) };
  }
  return hour >= DAYBREAK && hour < NIGHTFALL ? { kind: "all" } : { kind: "none" };
}

/** How much of full daylight reaches a point at this distance from the lantern: 1 inside the region, 0 outside. */
export function dayAt(region: DayRegion, distance: number): number {
  if (region.kind === "all") return 1;
  if (region.kind === "none") return 0;
  // Full inside the radius, fading to nothing over EDGE beyond it. Once the
  // radius is below zero only part of that fading rim is left, round the lantern.
  const inner = Math.max(0, region.radius);
  const outer = region.radius + EDGE;
  if (outer <= 0) return 0;
  return 1 - Math.min(1, Math.max(0, (distance - inner) / (outer - inner)));
}

/** How much light a lamp of the given reach and strength throws at a distance; the same curve the picture uses. */
export function lampAt(distance: number, reach: number, strength: number): number {
  const t = distance / reach;
  if (t >= 1) return 0;
  if (t <= 0.12) return strength;
  if (t <= 0.55) return strength * (1 - ((t - 0.12) / 0.43) * 0.45);
  return strength * 0.55 * (1 - (t - 0.55) / 0.45);
}

/** How strongly lamps show: nothing by day, full at night. They come on a little before dark. */
export function lampStrength(hour: number): number {
  return smooth((1 - daylight(hour)) * 1.6);
}

/** The colour the sky lays over everything, and how strongly (0 to 1): rose at dawn, amber at dusk. */
export function skyCast(hour: number): { color: Rgb; alpha: number } {
  const bump = (centre: number, width: number): number =>
    smooth(1 - Math.abs(hour - centre) / width);
  const dawn = bump(6, 1.4);
  const dusk = bump(19.4, 1.7);
  if (dawn >= dusk) return { color: [1, 0.62, 0.7], alpha: dawn * 0.22 };
  return { color: [1, 0.58, 0.2], alpha: dusk * 0.28 };
}

export const css = ([r, g, b]: Rgb, alpha = 1): string =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;

export const rgb = (hex: number): Rgb => [
  ((hex >> 16) & 255) / 255,
  ((hex >> 8) & 255) / 255,
  (hex & 255) / 255,
];

export function phaseName(hour: number): string {
  if (hour < 5) return "night";
  if (hour < 7.5) return "dawn";
  if (hour < 11) return "morning";
  if (hour < 14) return "about noon";
  if (hour < 17.5) return "afternoon";
  if (hour < 20.5) return "dusk";
  return "night";
}
