// The scenes the look-development page can show, by name.

import { deckScene } from "./deck.ts";
import type { Draw } from "./draw.ts";
import {
  expedition150Scene,
  expeditionBScene,
  expeditionScene,
  revealScene,
} from "./expeditions.ts";
import { beastsSheet, figuresSheet, scaleSheet } from "./sheets.ts";
import { shieldLevelsSheet, siege150Scene, siegeScene } from "./siege.ts";
import type { PlacedTag } from "./stage.ts";
import { decksideScene } from "./voyage.ts";

/** What a scene can say about a moment without drawing it, for the tests and the capture's counts. */
export interface Probe {
  out: number;
  aboard: number;
  /** Monsters alive. */
  monsters: number;
  /** Every citizen in frame: feet on screen, height, and whether it is out on the ground. */
  citizens: { key: number; x: number; y: number; size: number; outside: boolean }[];
  tags: readonly PlacedTag[];
}

export interface Scene {
  /** Seconds before the scene repeats. */
  readonly duration: number;
  /** Draws the scene as it is `t` seconds in. The same `t` always gives the same frame. */
  draw(d: Draw, t: number): void;
  /** The hour's colour over the whole plate, if not plain daylight. */
  cast?(t: number): number;
  probe?(t: number): Probe;
}

const MAKERS: Readonly<Record<string, () => Scene>> = {
  deck: () => deckScene(15),
  deck150: () => deckScene(150),
  deckside: () => decksideScene(15),
  reveal: revealScene,
  expedition: expeditionScene,
  "expedition-b": expeditionBScene,
  expedition150: expedition150Scene,
  siege: siegeScene,
  siege150: siege150Scene,
  "shield-levels": shieldLevelsSheet,
  beasts: beastsSheet,
  figures: figuresSheet,
  scale: scaleSheet,
};

export const SCENES = Object.keys(MAKERS);

export function makeScene(name: string): Scene {
  return (MAKERS[name] ?? (MAKERS.deck as () => Scene))();
}
