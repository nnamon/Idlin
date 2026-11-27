// The two inks the map is drawn in. By day: sepia on cream paper with thin
// watercolour washes. By night: the same drawing in pale ink on dark blue
// paper.

import { pageDay, type Rgb, rgb, skyCast } from "./light.ts";

export interface Palette {
  readonly paper: Rgb;
  readonly ink: Rgb;
  readonly wash: Readonly<Record<WashName, Rgb>>;
}

export type WashName =
  | "deepWood"
  | "wood"
  | "meadow"
  | "water"
  | "waterDeep"
  | "den"
  | "camp"
  | "sand"
  | "leaf"
  | "pine"
  | "canvas"
  | "timber"
  | "glass"
  | "flame"
  /** The hatching of a blow about to land: a red-brown used for nothing else. */
  | "hatch"
  | "wolf"
  | "goblin";

const DAY_WASH: Record<WashName, Rgb> = {
  deepWood: rgb(0x93aa8c),
  wood: rgb(0xbccb9f),
  meadow: rgb(0xd9dcae),
  water: rgb(0x9cc4d2),
  waterDeep: rgb(0x7fb0c4),
  den: rgb(0xbfae9f),
  camp: rgb(0xe9d3a4),
  sand: rgb(0xe8d9b4),
  leaf: rgb(0xa9c08a),
  pine: rgb(0x6f8f78),
  canvas: rgb(0xe7dcc0),
  timber: rgb(0xc9a36b),
  glass: rgb(0xf6cf6a),
  flame: rgb(0xf2a24a),
  hatch: rgb(0x9c3b22),
  wolf: rgb(0xa8a196),
  goblin: rgb(0x98a067),
};

const NIGHT_WASH: Record<WashName, Rgb> = {
  deepWood: rgb(0x16233a),
  wood: rgb(0x1c2c44),
  meadow: rgb(0x212d4a),
  water: rgb(0x25406a),
  waterDeep: rgb(0x1f3860),
  // Close to the night paper: a stronger colour reads as a stain spilt on the map.
  den: rgb(0x212741),
  camp: rgb(0x26304c),
  sand: rgb(0x2a3350),
  leaf: rgb(0x1d2e46),
  pine: rgb(0x162940),
  canvas: rgb(0x2b3654),
  timber: rgb(0x2f3450),
  glass: rgb(0xf6cf6a),
  flame: rgb(0xf2a24a),
  hatch: rgb(0xe08a6c),
  wolf: rgb(0x343d5c),
  goblin: rgb(0x2c3d3f),
};

export const DAY: Palette = {
  paper: rgb(0xf1e6cd),
  ink: rgb(0x2f2621),

  wash: DAY_WASH,
};
export const NIGHT: Palette = {
  paper: rgb(0x1d2742),
  ink: rgb(0xcfd8ea),

  wash: NIGHT_WASH,
};

/** How strongly the sky's colour lies on the page, as a share of how strongly it lies on the map. */
export const PAGE_CAST = 0.5;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Relative luminance, 0 to 1, as the WCAG contrast ratio counts it. */
export function luminance(color: Rgb): number {
  const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2]);
}

/** The WCAG contrast ratio of two colours, from 1 (the same) to 21 (black on white). */
export function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * How strongly the page's secondary lettering and rules are drawn: their ink's
 * alpha over the paper. Secondary is anything a viewer reads second, such as
 * the row of someone off the map or the caption over a column.
 */
export const FAINT = 0.74;
/** The least contrast to its paper of the page's ink, and of its secondary lettering. */
export const INK_CONTRAST = 7;
export const FAINT_CONTRAST = 4.5;

/** Secondary lettering on `palette`'s paper: its ink at FAINT over the paper, as the page draws it. */
export const faintInk = (palette: Palette): Rgb => mix(palette.paper, palette.ink, FAINT);

/** Whether `ink` and its secondary lettering read on `paper`, by INK_CONTRAST and FAINT_CONTRAST. */
const readable = (ink: Rgb, paper: Rgb): boolean =>
  contrast(ink, paper) >= INK_CONTRAST && contrast(mix(paper, ink, FAINT), paper) >= FAINT_CONTRAST;

/**
 * The inks of the page beside the map at this hour. Its paper is the day
 * paper, with a little of the sky's colour on it, or the night paper, or
 * partway between the two while the page turns. The ink changes over in one
 * step when the turn is halfway. A paper halfway between cream and navy reads
 * with neither ink, so while the page turns its paper goes only as far from
 * its own side as keeps the ink at INK_CONTRAST and the secondary lettering at
 * FAINT_CONTRAST, and makes the rest of the change in that one step.
 */
export function pagePalette(hour: number): Palette {
  const cast = skyCast(hour);
  const dayPaper = mix(DAY.paper, cast.color, cast.alpha * PAGE_CAST);
  const turn = pageDay(hour);
  const inks = turn >= 0.5 ? DAY : NIGHT;
  const paperAt = (t: number): Rgb => mix(NIGHT.paper, dayPaper, t);
  // The day side reads better the lighter its paper, the night side the darker,
  // so the paper nearest the turn's that reads is found by halving the gap.
  const side = inks === DAY ? 1 : 0;
  let [near, far] = [turn, side];
  if (!readable(inks.ink, paperAt(near))) {
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (readable(inks.ink, paperAt(mid))) far = mid;
      else near = mid;
    }
    near = far;
  }
  return { ...inks, paper: paperAt(near) };
}
