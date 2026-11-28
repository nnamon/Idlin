// The scenes the look-development page can show, by name.

import type { Draw } from "./draw.ts";
import { fightScene } from "./fight.ts";
import { mockupScene } from "./mockup.ts";
import { figuresSheet, scaleSheet } from "./sheets.ts";
import { deckScene, revealScene } from "./voyage.ts";

export interface Scene {
  /** Seconds before the scene repeats. */
  readonly duration: number;
  /** Draws the scene as it is `t` seconds in. The same `t` always gives the same frame. */
  draw(d: Draw, t: number): void;
  /** The hour's colour over the whole plate, if not plain daylight. */
  cast?(t: number): number;
}

const MAKERS: Readonly<Record<string, () => Scene>> = {
  deck: () => deckScene(15),
  deck150: () => deckScene(150),
  reveal: () => revealScene(15),
  reveal150: () => revealScene(150),
  fight: () => fightScene({ citizens: 15, monsters: 110, seconds: 24 }),
  fight150: () => fightScene({ citizens: 150, monsters: 450, seconds: 24 }),
  // What the renderers are timed on: 150 citizens, 450 monsters, a hundred shots in the air.
  bench: () => fightScene({ citizens: 150, monsters: 450, seconds: 12, volley: true, bare: true }),
  // Mockups of one landing, four stagings (#362).
  mockA: () => mockupScene("A"),
  mockB: () => mockupScene("B"),
  mockC: () => mockupScene("C"),
  mockD: () => mockupScene("D"),
  figures: figuresSheet,
  scale: scaleSheet,
};

export const SCENES = Object.keys(MAKERS);

export function makeScene(name: string): Scene {
  return (MAKERS[name] ?? (MAKERS.deck as () => Scene))();
}
