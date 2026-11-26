// Who gets a name slip on the map. In a crowd, a slip over everyone is a sheet
// of text nobody reads, so at most SLIP_BUDGET are out at once. Residents
// something has just happened to (named in the line of news) come first, then
// those who stand apart from the rest. Slips left over go to whoever has gone
// longest without one, lowest id first, wherever a slip fits without covering
// another, and keeps it only while it goes on fitting. With no more residents
// than the budget, everyone keeps one. Slips fade in and out, and one given for
// a claim is held for a while, so they do not blink as people move; a slip
// there from a resident's first tick is there at once.
// Pure, so it can be tested without a page.

export const SLIP_BUDGET = 8;
/** Ticks a slip given for a claim is held at least: five seconds. */
export const MIN_HOLD = 50;
/** Ticks a resident named in the news keeps its claim to a slip: ten seconds. */
export const NEWS_HOLD = 100;
/** Ticks a slip takes to fade in or out: half a second. */
export const FADE = 5;
/** Residents this many steps apart or nearer count as together. */
export const TOGETHER = 2;

export interface Someone {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export interface Slips {
  /** Holders, by id: the tick each was given its slip, from which MIN_HOLD counts. */
  readonly held: ReadonlyMap<number, number>;
  /**
   * Holders, by id: the tick each slip began to fade in. Earlier than the tick
   * it was given when it is there at once (from a resident's first tick) or
   * fades back in from part way out.
   */
  readonly shown: ReadonlyMap<number, number>;
  /** Slips fading out, by id: the tick each was taken away. */
  readonly leaving: ReadonlyMap<number, number>;
  /** The last tick each resident held a slip. */
  readonly had: ReadonlyMap<number, number>;
  /** Who was in the world at the last tick. */
  readonly seen: ReadonlySet<number>;
  /**
   * Holders whose slip is there only because there was room for it: they keep
   * it only while it fits, however recently it was given.
   */
  readonly room: ReadonlySet<number>;
}

export const NO_SLIPS: Slips = {
  held: new Map(),
  shown: new Map(),
  leaving: new Map(),
  had: new Map(),
  seen: new Set(),
  room: new Set(),
};

/**
 * Whether resident `id` could have a slip beside the slips `held` and those
 * `leaving` (still fading out): with all of them placed together, the way they
 * will be drawn, its slip covers nothing and makes no other slip cover anything.
 */
export type Fits = (id: number, held: readonly number[], leaving: readonly number[]) => boolean;

/** Whether anyone else stands within TOGETHER steps. */
export function alone(who: Someone, everyone: readonly Someone[]): boolean {
  return !everyone.some(
    (other) =>
      other.id !== who.id && Math.abs(other.x - who.x) + Math.abs(other.y - who.y) <= TOGETHER,
  );
}

/**
 * The slips after a tick. `named` maps a resident to the tick it was last
 * named in the news. Slips left over after news and standing apart are only
 * given where `fits` says there is room; by default there is none.
 */
export function nextSlips(
  previous: Slips,
  everyone: readonly Someone[],
  named: ReadonlyMap<number, number>,
  tick: number,
  fits: Fits = () => false,
): Slips {
  const present = new Set(everyone.map((who) => who.id));
  const held = new Map<number, number>();
  const leaving = new Map<number, number>();
  for (const [id, since] of previous.leaving) {
    if (present.has(id) && tick - since < FADE) leaving.set(id, since);
  }
  const few = everyone.length <= SLIP_BUDGET;
  const newsClaim = (id: number): number | undefined => {
    const at = named.get(id);
    return at !== undefined && tick - at < NEWS_HOLD ? at : undefined;
  };
  // 2 for news, 1 for standing apart (or for anyone, when everyone fits the
  // budget), 0 for a slip given only because there was room for it.
  const claim = (who: Someone): number =>
    newsClaim(who.id) !== undefined ? 2 : few || alone(who, everyone) ? 1 : 0;
  const shown = new Map<number, number>();
  const room = new Set<number>();
  const give = (id: number, forRoom: boolean): void => {
    if (forRoom) room.add(id);
    else room.delete(id);
    const gone = leaving.get(id);
    // There from the resident's first tick: no fade. Taken back while fading
    // out: fade back in from where it had got to, not from nothing. Either
    // way the hold counts from now.
    shown.set(
      id,
      !previous.seen.has(id) ? tick - FADE : gone === undefined ? tick : 2 * tick - FADE - gone,
    );
    held.set(id, tick);
    leaving.delete(id);
  };

  // Holders with a claim keep their slip, and a claim keeps it at least
  // MIN_HOLD ticks after it lapses. A slip held only for the room (given for
  // it, or held past MIN_HOLD with no claim) keeps it for now, and once the
  // claims are settled, for as long as it still fits.
  const roomOnly: number[] = [];
  for (const who of everyone) {
    const since = previous.held.get(who.id);
    if (since === undefined) continue;
    held.set(who.id, since);
    shown.set(who.id, previous.shown.get(who.id) ?? since);
    // A claim makes it a claimed slip: the scene no longer takes it away when
    // something lands on it.
    if (previous.room.has(who.id) && claim(who) === 0) room.add(who.id);
    if (claim(who) === 0 && (room.has(who.id) || tick - since >= MIN_HOLD)) roomOnly.push(who.id);
  }

  // Claims waiting for a slip: the newest news first, then whoever stands
  // apart, lowest id first.
  const waiting = everyone
    .filter((who) => !held.has(who.id) && claim(who) > 0)
    .sort((a, b) => {
      const na = newsClaim(a.id) ?? Number.NEGATIVE_INFINITY;
      const nb = newsClaim(b.id) ?? Number.NEGATIVE_INFINITY;
      return nb - na || a.id - b.id;
    });
  // A slip fading out counts as coming free, so a claim makes at most one
  // slip give way. When none is coming free, a slip with a lesser claim, held
  // at least MIN_HOLD, starts to fade: the least claim first, then the oldest.
  let coming = SLIP_BUDGET - held.size;
  // Once a claim has been made to wait, nobody with a lesser claim takes a slot ahead of it.
  let keptWaiting = Number.NEGATIVE_INFINITY;
  for (const who of waiting) {
    const mine = claim(who);
    if (coming <= 0) {
      const yielding = everyone
        .filter((other) => {
          const since = held.get(other.id);
          return since !== undefined && claim(other) < mine && tick - since >= MIN_HOLD;
        })
        .sort(
          (a, b) =>
            claim(a) - claim(b) ||
            (held.get(a.id) as number) - (held.get(b.id) as number) ||
            a.id - b.id,
        )[0];
      if (yielding !== undefined) {
        held.delete(yielding.id);
        leaving.set(yielding.id, tick);
        coming++;
      }
    }
    if (coming <= 0) {
      keptWaiting = Math.max(keptWaiting, mine);
      continue;
    }
    coming--;
    const gone = leaving.get(who.id);
    // A slip still fading out is still on the map, so it keeps its place in the budget until it has gone.
    const full = held.size + leaving.size - (gone === undefined ? 0 : 1) >= SLIP_BUDGET;
    if (full || mine < keptWaiting) {
      keptWaiting = Math.max(keptWaiting, mine);
      continue;
    }
    give(who.id, false);
  }

  // A slip that starts to fade is still on the map until it has gone, so the
  // slips checked after it are checked against it as it fades.
  for (const id of roomOnly) {
    if (!held.has(id)) continue;
    room.add(id);
    const others = [...held.keys()].filter((other) => other !== id);
    if (fits(id, others, [...leaving.keys()])) continue;
    leaving.set(id, fadeFrom(shown.get(id) ?? (held.get(id) as number), tick));
    held.delete(id);
    room.delete(id);
  }

  // What is left goes to those who have gone longest without a slip, where it fits.
  if (keptWaiting === Number.NEGATIVE_INFINITY && held.size + leaving.size < SLIP_BUDGET) {
    const last = (id: number): number => previous.had.get(id) ?? Number.NEGATIVE_INFINITY;
    const rest = everyone
      .filter((who) => !held.has(who.id) && !leaving.has(who.id))
      .sort((a, b) => last(a.id) - last(b.id) || a.id - b.id);
    for (const who of rest) {
      if (held.size + leaving.size >= SLIP_BUDGET) break;
      if (fits(who.id, [...held.keys()], [...leaving.keys()])) give(who.id, true);
    }
  }

  const had = new Map<number, number>();
  for (const [id, at] of previous.had) if (present.has(id)) had.set(id, at);
  for (const id of held.keys()) had.set(id, tick);
  for (const id of shown.keys()) if (!held.has(id)) shown.delete(id);
  for (const id of room) if (!held.has(id)) room.delete(id);
  return { held, shown, leaving, had, seen: present, room };
}

/**
 * The slips after taking some away at `tick`: those of `fade` start to fade
 * out, those of `drop` go at once.
 */
export function letGo(
  slips: Slips,
  fade: readonly number[],
  drop: readonly number[],
  tick: number,
): Slips {
  const held = new Map(slips.held);
  const shown = new Map(slips.shown);
  const leaving = new Map(slips.leaving);
  const room = new Set(slips.room);
  for (const id of fade) {
    const since = slips.shown.get(id) ?? slips.held.get(id);
    if (since === undefined) continue;
    held.delete(id);
    shown.delete(id);
    room.delete(id);
    leaving.set(id, fadeFrom(since, tick));
  }
  for (const id of drop) {
    held.delete(id);
    shown.delete(id);
    room.delete(id);
    leaving.delete(id);
  }
  return { ...slips, held, shown, leaving, room };
}

/** How solid a resident's slip is drawn at `time` (ticks, fractions allowed): 0 for none. */
export function slipAlpha(slips: Slips, id: number, time: number): number {
  const clamp = (t: number): number => Math.min(1, Math.max(0, t));
  const since = slips.shown.get(id) ?? slips.held.get(id);
  if (since !== undefined) return clamp((time - since) / FADE);
  const gone = slips.leaving.get(id);
  if (gone !== undefined) return clamp(1 - (time - gone) / FADE);
  return 0;
}

/**
 * The tick to count a fade out from when a slip that began to fade in at
 * `since` is taken away at `tick`, so that it fades from as solid as it had got.
 */
function fadeFrom(since: number, tick: number): number {
  return tick - FADE + Math.min(FADE, Math.max(0, tick - since));
}
