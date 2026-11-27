// The kinds of resource node: trees and fishing spots that a map lists, which
// give goods to whoever works them from beside them, run out and come back.
// Programs name a kind by its position here plus 1, so the order is permanent:
// append only.

import type { Good } from "./bag.ts";
import type { Terrain } from "./map.ts";

export interface NodeKind {
  /** What programs call it, as they call goods and skills by name. */
  readonly name: string;
  /** The terrain it stands on. It is worked from a walkable tile beside it. */
  readonly terrain: Terrain;
  /** The action that works it: `chop` or `fish`. */
  readonly skill: "woodcutting" | "fishing";
  /** The level in that skill it needs. */
  readonly level: number;
  readonly good: Good;
  /** Experience per good it gives. */
  readonly xp: number;
  /** Goods it gives before it runs out. */
  readonly yield: number;
  /** Ticks from running out to standing again. */
  readonly regrow: number;
}

/** Ticks in a game hour, as in world.ts, which this file cannot import. */
const HOUR = 600;

export const NODE_KINDS: readonly NodeKind[] = Object.freeze([
  {
    name: "tree",
    terrain: "tree",
    skill: "woodcutting",
    level: 1,
    good: "logs",
    xp: 25,
    yield: 6,
    regrow: 2 * HOUR,
  },
  {
    name: "old_tree",
    terrain: "dark_tree",
    skill: "woodcutting",
    level: 15,
    good: "logs",
    xp: 60,
    yield: 10,
    regrow: 3 * HOUR,
  },
  {
    name: "fishing_spot",
    terrain: "water",
    skill: "fishing",
    level: 1,
    good: "raw_fish",
    xp: 20,
    yield: 8,
    regrow: HOUR,
  },
  {
    name: "deep_pool",
    terrain: "water",
    skill: "fishing",
    level: 15,
    good: "raw_fish",
    xp: 50,
    yield: 10,
    regrow: 2 * HOUR,
  },
]);

/** The id of a node kind, as programs know it: its position in NODE_KINDS plus 1. */
export const nodeKindId = (name: string): number =>
  NODE_KINDS.findIndex((kind) => kind.name === name) + 1;

/** The kind with this id, or undefined for an id that is not one. */
export const nodeKind = (id: number): NodeKind | undefined =>
  Number.isInteger(id) && id >= 1 ? NODE_KINDS[id - 1] : undefined;
