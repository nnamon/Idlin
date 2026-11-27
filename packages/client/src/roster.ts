// Who the page lists, and which of their rows just changed. A row changes
// when its resident is hurt or downed, goes up a level, banks goods or kills
// a monster; the page underlines it for a few seconds so the eye goes there.
// Pure, like line.ts: read off the world and the fight once a tick.

import { type Actor, ADVENTURER, levelFor, type World } from "@idlin/sim";
import type { Fight } from "./fight.ts";

/** How long a row stays marked after it changed: five seconds. */
export const CHANGE_TICKS = 50;
/** With more residents than rows, how often the page chooses again whom it lists: once a game hour. */
export const LIST_TICKS = 600;

/** The sum of a resident's levels in every skill: the one number its row shows. */
export const totalLevel = (actor: Actor): number =>
  actor.xp.reduce((sum, xp) => sum + levelFor(xp), 0);

/** What is compared from one tick to the next. */
interface Seen {
  readonly hp: number;
  readonly level: number;
  readonly banked: number;
  readonly deaths: number;
}

export interface Changes {
  readonly tick: number;
  readonly seen: ReadonlyMap<number, Seen>;
  /** The tick each resident's row last changed. */
  readonly at: ReadonlyMap<number, number>;
}

export const NO_CHANGES: Changes = {
  tick: Number.NEGATIVE_INFINITY,
  seen: new Map(),
  at: new Map(),
};

const seenOf = (actor: Actor): Seen => ({
  hp: actor.hp,
  level: totalLevel(actor),
  banked: actor.bank.reduce((sum, n) => sum + n, 0),
  deaths: actor.deaths,
});

/**
 * The changes after a tick, from those before it. A resident's row changes
 * when its hitpoints fall, its total level or what it has banked goes up, it
 * dies, or the fight's news has it killing something. Time going back (a
 * world restarted from an earlier snapshot) starts again with nothing marked.
 */
export function nextChanges(previous: Changes, world: World, fight: Fight): Changes {
  const fresh = world.tick <= previous.tick;
  const seen = new Map<number, Seen>();
  const at = new Map<number, number>();
  for (const actor of world.actors) {
    if (actor.kind !== ADVENTURER) continue;
    const now = seenOf(actor);
    seen.set(actor.id, now);
    const was = fresh ? undefined : previous.seen.get(actor.id);
    const before = fresh ? undefined : previous.at.get(actor.id);
    const killed = fight.news.some(
      (news) => news.who === actor.id && news.text.startsWith(`${actor.name} killed `),
    );
    const changed =
      was !== undefined &&
      (now.hp < was.hp ||
        now.level > was.level ||
        now.banked > was.banked ||
        now.deaths > was.deaths ||
        killed);
    if (changed) at.set(actor.id, world.tick);
    else if (before !== undefined) at.set(actor.id, before);
  }
  return { tick: world.tick, seen, at };
}

/** How strongly a row's mark is drawn at `time`: 1 when it changed, fading out over its last second. */
export function markAt(changes: Changes, id: number, time: number): number {
  const since = changes.at.get(id);
  if (since === undefined) return 0;
  const left = CHANGE_TICKS - (time - since);
  return Math.max(0, Math.min(1, left / 10));
}

/**
 * Whom the page lists of `residents` (in id order), with room for `rows`:
 * all of them if they fit, else the `rows` whose rows changed most lately,
 * the rest by id, still listed in id order so a row keeps its place.
 */
export function pickListed(
  residents: readonly Actor[],
  at: ReadonlyMap<number, number>,
  rows: number,
): number[] {
  if (residents.length <= rows) return residents.map((actor) => actor.id);
  const recent = [...residents]
    .sort((a, b) => (at.get(b.id) ?? -1) - (at.get(a.id) ?? -1) || a.id - b.id)
    .slice(0, rows);
  const chosen = new Set(recent.map((actor) => actor.id));
  return residents.filter((actor) => chosen.has(actor.id)).map((actor) => actor.id);
}
