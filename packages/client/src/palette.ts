// The two inks the map is drawn in. By day: sepia on cream paper with thin
// watercolour washes. By night: the same drawing in pale ink on dark blue
// paper.

import { type Rgb, rgb } from "./light.ts";

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
  | "flame";

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
};

const NIGHT_WASH: Record<WashName, Rgb> = {
  deepWood: rgb(0x16233a),
  wood: rgb(0x1c2c44),
  meadow: rgb(0x212d4a),
  water: rgb(0x25406a),
  waterDeep: rgb(0x1f3860),
  den: rgb(0x231f38),
  camp: rgb(0x26304c),
  sand: rgb(0x2a3350),
  leaf: rgb(0x1d2e46),
  pine: rgb(0x162940),
  canvas: rgb(0x2b3654),
  timber: rgb(0x2f3450),
  glass: rgb(0xf6cf6a),
  flame: rgb(0xf2a24a),
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

/** Cloak colours, picked to be told apart at a glance on cream paper and under lamplight. */
const CLOAKS = [
  0xc8442f, 0x2f6fb0, 0xd79a1e, 0x3f8f5a, 0x7d4fa3, 0x2a8f98, 0xb5527e, 0x6b7f2a, 0xd0692b,
  0x4a55a8, 0x8a5a3a, 0x3a9a7a,
];

/** The cloak colour of the actor with this id: the first dozen are hand-picked, the rest spread round the wheel. */
export function cloakColor(id: number): string {
  const index = Math.max(0, id - 1);
  if (index < CLOAKS.length) return `#${(CLOAKS[index] as number).toString(16).padStart(6, "0")}`;
  const hue = Math.round((index * 137.508) % 360);
  const light = 38 + ((index * 7) % 3) * 8;
  return `hsl(${hue}, 58%, ${light}%)`;
}
