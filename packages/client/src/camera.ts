// Where the view is. The map shows one region at a time, the one the
// spotlit resident is in, and when the spotlight goes to a resident in another
// region the view drifts there across the world plane, region by region along
// the exits, never cutting. Pure and deterministic for the same worlds, so the
// capture tool follows the same view without a page.

import { ADVENTURER, type Atlas, type Blow, regionAt, type World } from "@idlin/sim";
import { createDirector, type Director, direct, type Notice } from "./director.ts";
import { type Fight, NO_FIGHT, nextFight } from "./fight.ts";
import { campRegion } from "./view.ts";

/** Ticks the view takes to drift from one region to the next: eight seconds. */
export const DRIFT_TICKS = 80;
/**
 * Ticks the view has to have wanted another region before it sets out there:
 * two seconds, so a resident stepping back and forth over an exit does not
 * swing it about.
 */
export const FOLLOW_TICKS = 20;

export interface Camera {
  /**
   * The regions the last drift went through, from where it began to where it
   * ends, each next to the one before it by an exit. One region when the
   * view has not moved yet.
   */
  readonly route: readonly number[];
  /** The tick the last drift began. */
  readonly since: number;
  /** The region last wanted (-1 for none), and since which tick. */
  readonly wanted: { readonly region: number; readonly since: number };
}

/** A view on `region` that has been there as long as anyone knows. */
export const cameraOn = (region: number): Camera => ({
  route: [region],
  since: Number.NEGATIVE_INFINITY,
  wanted: { region, since: Number.NEGATIVE_INFINITY },
});

/** The region the view is on, or drifting to. */
export const regionOf = (camera: Camera): number => camera.route.at(-1) as number;

/** The tick the view gets to `regionOf(camera)`. */
export const arrival = (camera: Camera): number =>
  camera.route.length > 1
    ? camera.since + (camera.route.length - 1) * DRIFT_TICKS
    : Number.NEGATIVE_INFINITY;

/**
 * The fewest regions from `from` to `to`, both included, each joined to the
 * one before it by an exit; ties go to lower region indices. Empty when no
 * exits lead there.
 */
export function routeBetween(atlas: Atlas, from: number, to: number): number[] {
  const next = atlas.regions.map(() => new Set<number>());
  for (const [a, b] of atlas.exits) {
    const ra = regionAt(atlas, a.x, a.y);
    const rb = regionAt(atlas, b.x, b.y);
    if (ra < 0 || rb < 0 || ra === rb) continue;
    next[ra]?.add(rb);
    next[rb]?.add(ra);
  }
  const back = new Map<number, number>([[from, from]]);
  const queue = [from];
  while (queue.length > 0) {
    const here = queue.shift() as number;
    if (here === to) break;
    for (const there of [...(next[here] ?? [])].sort((a, b) => a - b)) {
      if (back.has(there)) continue;
      back.set(there, here);
      queue.push(there);
    }
  }
  if (!back.has(to)) return [];
  const route = [to];
  while (route[0] !== from) route.unshift(back.get(route[0] as number) as number);
  return route;
}

/**
 * The camera after a tick at which the view wants to be on region `want`
 * (-1 for nowhere in particular). It sets out once the same region has been
 * wanted for FOLLOW_TICKS, and a drift under way is finished first.
 */
export function nextCamera(camera: Camera, atlas: Atlas, want: number, tick: number): Camera {
  const wanted = camera.wanted.region === want ? camera.wanted : { region: want, since: tick };
  const kept = wanted === camera.wanted ? camera : { ...camera, wanted };
  const here = regionOf(camera);
  if (want < 0 || want === here || tick < arrival(camera)) return kept;
  if (tick - wanted.since < FOLLOW_TICKS) return kept;
  const route = routeBetween(atlas, here, want);
  return route.length < 2 ? kept : { route, since: tick, wanted };
}

/**
 * Where a drift is at `time` (in ticks, fractions allowed): the leg it is on,
 * from one region to the next, and how far along that leg it is, eased in and
 * out so it starts and stops slowly. A view standing still is on a leg from
 * its region to itself.
 */
export function legAt(camera: Camera, time: number): { from: number; to: number; share: number } {
  const legs = camera.route.length - 1;
  const last = regionOf(camera);
  const first = camera.route[0] as number;
  if (legs === 0) return { from: last, to: last, share: 0 };
  if (!(time > camera.since)) return { from: first, to: first, share: 0 };
  const along = (time - camera.since) / DRIFT_TICKS;
  if (along >= legs) return { from: last, to: last, share: 0 };
  const leg = Math.floor(along);
  const t = along - leg;
  return {
    from: camera.route[leg] as number,
    to: camera.route[leg + 1] as number,
    share: t * t * (3 - 2 * t),
  };
}

/** The view's top-left corner at `time`, in world tiles: a region's own corner, or partway between two. */
export function viewAt(camera: Camera, atlas: Atlas, time: number): { x: number; y: number } {
  const { from, to, share } = legAt(camera, time);
  const a = atlas.regions[from];
  const b = atlas.regions[to];
  if (!a || !b) return { x: 0, y: 0 };
  return { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share };
}

/**
 * What the director reads off a world the viewer is sent, which carries no
 * events: every resident's rule in charge (a change of rule is news), a
 * resident confused by a fault, anyone the fight says struck or was struck at
 * this tick, and anyone downed this tick.
 */
export function noticesOf(world: World, fight: Fight): Notice[] {
  const notices: Notice[] = [];
  for (const actor of world.actors) {
    if (actor.kind !== ADVENTURER) continue;
    notices.push({ type: "decide", actor: actor.id, rule: actor.rule });
    if (actor.fault !== 0) notices.push({ type: "fault", actor: actor.id });
  }
  for (const [id, at] of fight.engaged)
    if (at === world.tick) notices.push({ type: "attack", actor: id });
  for (const [id, at] of fight.downs)
    if (at === world.tick) notices.push({ type: "down", actor: id, by: id });
  return notices;
}

/** The fight, the spotlight and the view, as of a tick. */
export interface Watch {
  readonly tick: number;
  readonly fight: Fight;
  /** Changed in place by each tick; a watch is followed forwards only. */
  readonly director: Director;
  /** The spotlit resident, or null. */
  readonly subject: number | null;
  readonly camera: Camera;
}

/** A watch that has seen nothing yet, its view on the camp's region. */
export function startWatch(atlas: Atlas): Watch {
  return {
    tick: Number.NEGATIVE_INFINITY,
    fight: NO_FIGHT,
    director: createDirector(),
    subject: null,
    camera: cameraOn(campRegion({ atlas })),
  };
}

/**
 * The watch after `world`'s tick: the fight read off the whole world, the
 * director's pick among every resident, and the view following that resident's
 * region. Seeing the same tick again changes nothing. `blows` are the blows
 * of the tick that made `world`.
 */
export function nextWatch(watch: Watch, world: World, blows: readonly Blow[]): Watch {
  if (world.tick === watch.tick) return watch;
  const fight = nextFight(watch.fight, world, blows);
  const residents = world.actors.filter((actor) => actor.kind === ADVENTURER);
  const subject = direct(
    watch.director,
    world.tick,
    noticesOf(world, fight),
    residents.map((actor) => actor.id),
  );
  const spotlit = residents.find((actor) => actor.id === subject);
  const want = spotlit ? regionAt(world.atlas, spotlit.x, spotlit.y) : -1;
  return {
    tick: world.tick,
    fight,
    director: watch.director,
    subject,
    camera: nextCamera(watch.camera, world.atlas, want, world.tick),
  };
}
