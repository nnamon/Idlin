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
