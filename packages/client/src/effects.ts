// Small effects that answer what happens in the world: a glyph on a resident's
// name slip when the rule in charge changes, a dashed route when a walk
// starts, and the lean, snap and settle of a figure setting off or pulling up.
// They are read off the world once a tick, from how each actor changed since
// the last tick, so the viewer needs nothing but the worlds it is given (the
// server sends those and no events). Everything here is a function of that
// history and the time: no randomness and no clock of its own. Pure, so it can
// be tested without a page.

import type { Actor, Point } from "@idlin/sim";

/** Ticks a glyph stays on a slip after the rule in charge changes. */
export const GLYPH_TICKS = 16;
/** Ticks a glyph takes to come in, and to fade at the end of its life. */
export const GLYPH_IN = 1;
export const GLYPH_OUT = 4;
/**
 * Ticks a route is drawn for at most. Over its last EAT_TICKS the line is
 * taken up from the walker's end until only the cross at its far end is left.
 */
export const ROUTE_TICKS = 24;
export const EAT_TICKS = 10;
/** Ticks a route takes to come in, and its end cross to fade once the line is gone. */
export const EASE_TICKS = 3;
/** How many routes can run side by side along one path, each in its own lane. */
export const LANES = 7;
/** The three beats of setting off or pulling up, in ticks: lean away, snap, settle. */
export const LEAN_TICKS = 3;
export const SNAP_TICKS = 1;
export const SETTLE_TICKS = 3;
export const BEAT_TICKS = LEAN_TICKS + SNAP_TICKS + SETTLE_TICKS;
/** How far the figure leans, as a slant of its body: back on the first beat, forward on the snap. */
export const LEAN_BACK = 0.09;
export const SNAP_FORWARD = 0.06;
/**
 * A walk ending this many steps from camp or nearer is a walk home. A crowd
 * going back to camp stops wherever there is room, up to about five tiles out.
 */
export const HOME_STEPS = 5;

/** What a resident has just set out to do, as a glyph on its slip. */
export type Glyph = "walk" | "rest" | "home" | "confused";

/** What is remembered of each actor from the last tick. */
interface Seen {
  readonly rule: number;
  readonly fault: number;
  /** Where its walk goes, as `x,y`, or "" when it is not walking. */
  readonly goal: string;
  /** Which way across the map it last went: 1 east, -1 west. */
  readonly dir: 1 | -1;
  /** Whether it is in the middle of a step, rather than standing (perhaps held up on its walk). */
  readonly stepping: boolean;
}

/** A change between standing and stepping, for a veteran's lean into its stride. */
export interface Stride {
  /** The tick it began. */
  readonly since: number;
  /** How far into its walk the figure was then, 0 to 1 (see `walkAt`). */
  readonly from: number;
  /** 1 when it began stepping, 0 when it stopped. */
  readonly to: 0 | 1;
}

/** A route under way. */
export interface Route {
  /** The tick it began. */
  readonly since: number;
  /** Which of the LANES it runs in, so that routes sharing a path stay apart. */
  readonly lane: number;
  /** Where it ends. */
  readonly goal: Point;
  /** The tick its walk ended, gave up or turned elsewhere; null while it goes on. */
  readonly stopped: number | null;
}

export interface Effects {
  /** The tick these effects are as of. */
  readonly tick: number;
  /** The glyph each resident shows, and the tick it began. */
  readonly glyphs: ReadonlyMap<number, { readonly glyph: Glyph; readonly since: number }>;
  readonly routes: ReadonlyMap<number, Route>;
  /** Each resident setting off or pulling up: the tick it began, and which way it was going. */
  readonly beats: ReadonlyMap<number, { readonly since: number; readonly dir: 1 | -1 }>;
  /** Each resident that began or stopped stepping in the last BEAT_TICKS. */
  readonly strides: ReadonlyMap<number, Stride>;
  readonly seen: ReadonlyMap<number, Seen>;
}

export const NO_EFFECTS: Effects = {
  tick: Number.NEGATIVE_INFINITY,
  glyphs: new Map(),
  routes: new Map(),
  beats: new Map(),
  strides: new Map(),
  seen: new Map(),
};

/** Where a walk goes: the last tile on its path, or the tile it is stepping onto. */
function goalOf(actor: Actor): Point | null {
  const last = actor.path[actor.path.length - 1];
  if (last) return last;
  return actor.moveTicksLeft > 0 ? { x: actor.x, y: actor.y } : null;
}

/** The glyph for what an actor has just decided, from what it is now doing. */
export function glyphOf(actor: Actor, home: Point): Glyph {
  if (actor.fault !== 0) return "confused";
  const goal = goalOf(actor);
  if (!goal) return "rest";
  return Math.abs(goal.x - home.x) + Math.abs(goal.y - home.y) <= HOME_STEPS ? "home" : "walk";
}

/** The tick a route's line is gone: when its walk stopped, or when it has been eaten up. */
const lineGone = (route: Route): number =>
  Math.min(route.stopped ?? Number.POSITIVE_INFINITY, route.since + ROUTE_TICKS);

/**
 * The effects after a tick. An actor seen for the first time starts nothing:
 * there is no change to show yet. Nor does anyone when ticks were missed (a
 * live viewer that lost the server for a while), since a change across the
 * gap is not one that just happened. Effects of actors no longer in the world
 * go.
 */
export function nextEffects(
  previous: Effects,
  actors: readonly Actor[],
  tick: number,
  home: Point,
): Effects {
  const glyphs = new Map<number, { glyph: Glyph; since: number }>();
  const routes = new Map<number, Route>();
  const beats = new Map<number, { since: number; dir: 1 | -1 }>();
  const strides = new Map<number, Stride>();
  const seen = new Map<number, Seen>();
  const followsOn = previous.tick === tick - 1;
  // Lanes held by routes still drawn, so that a new route takes one that is free.
  const lanes = new Map<number, number>();
  const present = new Set(actors.map((actor) => actor.id));
  for (const [id, route] of previous.routes) if (present.has(id)) lanes.set(id, route.lane);
  for (const actor of actors) {
    const id = actor.id;
    const was = followsOn ? previous.seen.get(id) : undefined;
    const at = goalOf(actor);
    const goal = at ? `${at.x},${at.y}` : "";
    // Facing as the figure is drawn: the way of its last step across the map.
    const next = actor.path[0];
    const step =
      actor.x !== actor.fromX
        ? actor.x - actor.fromX
        : actor.moveTicksLeft === 0 && next
          ? next.x - actor.x
          : 0;
    const dir: 1 | -1 = step > 0 ? 1 : step < 0 ? -1 : (previous.seen.get(id)?.dir ?? 1);
    const stepping = actor.moveTicksLeft > 0;
    seen.set(id, { rule: actor.rule, fault: actor.fault, goal, dir, stepping });
    const glyph = previous.glyphs.get(id);
    const beat = previous.beats.get(id);
    const stride = previous.strides.get(id);
    if (glyph && tick - glyph.since < GLYPH_TICKS) glyphs.set(id, glyph);
    if (beat && tick - beat.since < BEAT_TICKS) beats.set(id, beat);
    if (stride && tick - stride.since < BEAT_TICKS) strides.set(id, stride);
    let route = previous.routes.get(id);
    if (route && route.stopped === null && goal !== `${route.goal.x},${route.goal.y}`) {
      route = { ...route, stopped: tick };
    }
    if (route && tick - lineGone(route) < EASE_TICKS) routes.set(id, route);
    else lanes.delete(id);
    if (!was) continue;
    if (was.rule !== actor.rule || (was.fault === 0) !== (actor.fault === 0)) {
      glyphs.set(id, { glyph: glyphOf(actor, home), since: tick });
    }
    // A walk starts when it had none or its goal changes; a detour keeps the
    // goal. A walk given up mid-step has nothing left on its path: no new route.
    if (at && goal !== was.goal && actor.path.length > 0) {
      lanes.delete(id);
      const taken = new Set(lanes.values());
      let lane = 0;
      while (taken.has(lane) && lane < LANES - 1) lane++;
      lanes.set(id, lane);
      routes.set(id, { since: tick, lane, goal: at, stopped: null });
    }
    // Setting off leans back from the way it goes; pulling up leans back against the way it went.
    if ((goal === "") !== (was.goal === "")) {
      beats.set(id, { since: tick, dir });
    }
    // The lean into a stride eases from wherever it had got to, so a walk that
    // starts again a tick or two after stopping carries on from there.
    if (stepping !== was.stepping) {
      strides.set(id, { since: tick, from: walkAt(previous, id, tick), to: stepping ? 1 : 0 });
    }
  }
  return { tick, glyphs, routes, beats, strides, seen };
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * The glyph on resident `id`'s slip at `time`, and how strongly it is drawn
 * (0 to 1): in over GLYPH_IN ticks, then full until it fades over the last
 * GLYPH_OUT. Null for none.
 */
export function glyphAt(
  effects: Effects,
  id: number,
  time: number,
): { glyph: Glyph; alpha: number } | null {
  const glyph = effects.glyphs.get(id);
  if (!glyph) return null;
  const age = time - glyph.since;
  if (age < 0 || age >= GLYPH_TICKS) return null;
  const alpha = Math.min(smooth(age / GLYPH_IN), smooth((GLYPH_TICKS - age) / GLYPH_OUT));
  return alpha > 0 ? { glyph: glyph.glyph, alpha } : null;
}

/** How resident `id`'s route is drawn at `time`. */
export interface RouteView {
  /** How strongly the line is drawn, 0 to 1; 0 once the walk has stopped. */
  readonly line: number;
  /** How much of what is left of the line has been taken up from the walker's end, 0 to 1. */
  readonly eaten: number;
  /** How strongly the cross at the far end is drawn, 0 to 1. */
  readonly cross: number;
  readonly lane: number;
  readonly goal: Point;
}

/** Resident `id`'s route at `time`, or null for none. */
export function routeAt(effects: Effects, id: number, time: number): RouteView | null {
  const route = effects.routes.get(id);
  if (!route) return null;
  const age = time - route.since;
  if (age < 0) return null;
  const come = smooth(age / EASE_TICKS);
  const cross = come * (1 - smooth((time - lineGone(route)) / EASE_TICKS));
  if (cross <= 0) return null;
  const eaten = smooth((age - (ROUTE_TICKS - EAT_TICKS)) / EAT_TICKS);
  const going = route.stopped === null || time < route.stopped;
  return {
    line: going && eaten < 1 ? come : 0,
    eaten,
    cross,
    lane: route.lane,
    goal: route.goal,
  };
}

/**
 * The slant of the beat after setting off or pulling up, `age` ticks in,
 * going the way `dir`: positive leans the top of the figure east. It leans
 * back over LEAN_TICKS, snaps forward in SNAP_TICKS and settles upright over
 * SETTLE_TICKS.
 */
export function beat(age: number, dir: 1 | -1): number {
  if (age <= 0 || age >= BEAT_TICKS) return 0;
  let slant: number;
  if (age < LEAN_TICKS) slant = -LEAN_BACK * smooth(age / LEAN_TICKS);
  else if (age < LEAN_TICKS + SNAP_TICKS)
    slant = -LEAN_BACK + (LEAN_BACK + SNAP_FORWARD) * smooth((age - LEAN_TICKS) / SNAP_TICKS);
  else slant = SNAP_FORWARD * (1 - smooth((age - LEAN_TICKS - SNAP_TICKS) / SETTLE_TICKS));
  return slant * dir;
}

/** How far resident `id` leans at `time`; see `beat`. */
export function leanAt(effects: Effects, id: number, time: number): number {
  const b = effects.beats.get(id);
  return b ? beat(time - b.since, b.dir) : 0;
}

/**
 * 0 to 1: how far into its walk resident `id` is at `time`, for a veteran's
 * lean into its stride. 1 while it steps and 0 while it stands, including
 * when it stands held up on a walk, easing from where it was to the other
 * over BEAT_TICKS as it starts or stops stepping.
 */
export function walkAt(effects: Effects, id: number, time: number): number {
  const s = effects.strides.get(id);
  if (s) return s.from + (s.to - s.from) * smooth((time - s.since) / BEAT_TICKS);
  return effects.seen.get(id)?.stepping ? 1 : 0;
}
