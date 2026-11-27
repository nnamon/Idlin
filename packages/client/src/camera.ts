// Where the view is. The map shows one region at a time, the one the
// spotlit resident is in, and when the spotlight goes to a resident in another
// region the view drifts there across the world plane, region by region along
// the exits, never cutting. Pure and deterministic for the same worlds, so the
// capture tool follows the same view without a page.

import { ADVENTURER, type Atlas, type Point, regionAt, type World } from "@idlin/sim";
import { createDirector, type Director, DWELL_TICKS, direct, type Notice } from "./director.ts";
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
  /**
   * For a drift that turned back part-way: where the view was when it
   * turned, in world tiles, and how fast it was going, in tiles a tick. Its
   * first leg sets out from there at that speed, instead of from rest at the
   * first region, which it never got to.
   */
  readonly turned?: {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
  };
  /**
   * How strong the reason the last drift set out for was (see `REASON`); 0
   * for none, as for a view leaving a region that emptied. Within HOLD_TICKS
   * of getting there, only a stronger one moves it.
   */
  readonly weight?: number;
}

/**
 * What is worth moving the view for, and how strongly. A haul is a resident's
 * bag gaining a good (a log cut, a fish caught); a fight is any blow struck or
 * taken, a kill included; a down is a resident downed.
 */
export const REASON = { haul: 2, fight: 3, down: 4 } as const;
export type ReasonKind = keyof typeof REASON;

/** How long something a resident did stays a reason to go and show it: fifteen seconds. */
export const REASON_TICKS = 150;

/** How long the view stays on a region it went to before it goes for anything no stronger: a minute. */
export const HOLD_TICKS = 600;

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
 * The least the view means to show its subject in a region once it gets
 * there: it does not set out for a subject whose dwell in the spotlight ends
 * sooner than the drift plus this. Eight seconds.
 */
export const STAY_TICKS = 80;

/**
 * The camera after a tick at which the view wants to be on region `want`
 * (-1 for nowhere in particular). `empty` says nobody is in the region it is
 * on, or drifting to. It sets out once the same region has been wanted for
 * FOLLOW_TICKS, or at once from an empty region. A drift under way is
 * finished first, unless the region it is going to is empty and the way to
 * `want` lies back along the leg it is on: then it turns back (see `viewAt`).
 * `weight` is how strong the reason for going is, kept on the camera.
 */
export function nextCamera(
  camera: Camera,
  atlas: Atlas,
  want: number,
  tick: number,
  empty = false,
  weight = 0,
): Camera {
  const wanted = camera.wanted.region === want ? camera.wanted : { region: want, since: tick };
  const kept = wanted === camera.wanted ? camera : { ...camera, wanted };
  const here = regionOf(camera);
  if (want < 0 || want === here) return kept;
  if (tick < arrival(camera)) {
    if (!empty) return kept;
    const { from, to } = legAt(camera, tick);
    const back = routeBetween(atlas, from, want);
    const on = routeBetween(atlas, to, want);
    if (back.length === 0 || from === to || back.length > on.length) return kept;
    const at = viewAt(camera, atlas, tick);
    const before = viewAt(camera, atlas, tick - 0.25);
    const after = viewAt(camera, atlas, tick + 0.25);
    const turned = { ...at, vx: (after.x - before.x) * 2, vy: (after.y - before.y) * 2 };
    return { route: [to, ...back], since: tick, wanted, turned, weight };
  }
  if (!empty && tick - wanted.since < FOLLOW_TICKS) return kept;
  const route = routeBetween(atlas, here, want);
  return route.length < 2 ? kept : { route, since: tick, wanted, weight };
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

/**
 * The view's top-left corner at `time`, in world tiles: a region's own
 * corner, or partway between two. On the first leg of a drift that turned
 * back, a curve from where it turned, setting out at the speed it had then,
 * so it slows, comes about and comes to rest at the next region with no jolt.
 */
export function viewAt(camera: Camera, atlas: Atlas, time: number): { x: number; y: number } {
  const { turned } = camera;
  const s = (time - camera.since) / DRIFT_TICKS;
  if (turned && s >= 0 && s < 1) {
    const b = atlas.regions[camera.route[1] as number];
    if (!b) return { x: turned.x, y: turned.y };
    // A cubic from the turning point at its speed to the next corner at rest.
    const start = 2 * s ** 3 - 3 * s ** 2 + 1;
    const speed = (s ** 3 - 2 * s ** 2 + s) * DRIFT_TICKS;
    const end = 3 * s ** 2 - 2 * s ** 3;
    return {
      x: start * turned.x + speed * turned.vx + end * b.x,
      y: start * turned.y + speed * turned.vy + end * b.y,
    };
  }
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
 * this tick, anyone downed this tick, and anyone carrying more goods than
 * `carried` (by resident, at the tick before) says it did: a haul.
 */
export function noticesOf(
  world: World,
  fight: Fight,
  carried: ReadonlyMap<number, number> = new Map(),
): Notice[] {
  const notices: Notice[] = [];
  for (const actor of world.actors) {
    if (actor.kind !== ADVENTURER) continue;
    notices.push({ type: "decide", actor: actor.id, rule: actor.rule });
    if (actor.fault !== 0) notices.push({ type: "fault", actor: actor.id });
    const before = carried.get(actor.id);
    if (before !== undefined && goodsIn(actor) > before)
      notices.push({ type: "haul", actor: actor.id });
  }
  for (const [id, at] of fight.engaged)
    if (at === world.tick) notices.push({ type: "attack", actor: id });
  for (const [id, at] of fight.downs)
    if (at === world.tick) notices.push({ type: "down", actor: id, by: id });
  return notices;
}

/** How many goods a resident has in its bag. */
const goodsIn = (actor: { readonly bag: readonly number[] }): number =>
  actor.bag.reduce((count, slot) => count + (slot !== 0 ? 1 : 0), 0);

/** The fight, the spotlight and the view, as of a tick. */
export interface Watch {
  readonly tick: number;
  readonly fight: Fight;
  /** By resident, how many goods it carried at this tick, to tell a haul. */
  readonly carried: ReadonlyMap<number, number>;
  /** Changed in place by each tick; a watch is followed forwards only. */
  readonly director: Director;
  /** By resident, the strongest thing it did lately that is worth showing, and when. */
  readonly doing: ReadonlyMap<number, { readonly kind: ReasonKind; readonly tick: number }>;
  /** The spotlit resident, or null. */
  readonly subject: number | null;
  readonly camera: Camera;
  /**
   * Why the view set out at this tick, for the news line: who, what it is
   * doing, and in which region. Null on any other tick, and when the view
   * left only because nobody was left on its region.
   */
  readonly reason: {
    readonly actor: number;
    readonly kind: ReasonKind;
    readonly region: number;
  } | null;
}

/** A watch that has seen nothing yet, its view on the camp's region. */
export function startWatch(atlas: Atlas): Watch {
  return {
    tick: Number.NEGATIVE_INFINITY,
    fight: NO_FIGHT,
    carried: new Map(),
    director: createDirector(),
    doing: new Map(),
    subject: null,
    camera: cameraOn(campRegion({ atlas })),
    reason: null,
  };
}

/**
 * The news line for the view setting out for a haul, in the news line's form
 * (see `newsText` in line.ts): who, what it is doing and where, and the count
 * after a comma. `place` is the region's name. Null for anything else: a
 * fight is told by the resident's own line, and a down by the fight's news.
 */
export function reasonLine(
  kind: ReasonKind,
  actor: { readonly name: string; readonly bag: readonly number[] },
  place: string,
): string | null {
  if (kind !== "haul") return null;
  const logs = actor.bag.filter((good) => good === 1).length;
  const fish = actor.bag.filter((good) => good >= 2).length;
  return logs >= fish
    ? `${actor.name} is chopping in ${place}, ${logs} ${logs === 1 ? "log" : "logs"}`
    : `${actor.name} is fishing in ${place}, ${fish} fish`;
}

/** What a resident did that `watch` saw, if it was in the last REASON_TICKS: a reason to show it. */
export function reasonOf(watch: Watch, id: number | null): ReasonKind | null {
  const doing = id === null ? undefined : watch.doing.get(id);
  return doing && watch.tick - doing.tick <= REASON_TICKS ? doing.kind : null;
}

/**
 * The watch after `world`'s tick: the fight read off the whole world, the
 * director's pick among every resident (those away from the camp count for
 * a little more), and the view following that resident's region when there
 * is a reason to (see `wantedRegion`). Seeing the same tick again changes
 * nothing.
 */
export function nextWatch(watch: Watch, world: World): Watch {
  if (world.tick === watch.tick) return watch;
  const fight = nextFight(watch.fight, world);
  const residents = world.actors.filter((actor) => actor.kind === ADVENTURER);
  const camp = campRegion(world);
  const away = new Set(
    residents
      .filter((actor) => regionAt(world.atlas, actor.x, actor.y) !== camp)
      .map((actor) => actor.id),
  );
  const notices = noticesOf(world, fight, watch.carried);
  const subject = direct(
    watch.director,
    world.tick,
    notices,
    residents.map((actor) => actor.id),
    away,
  );
  const carried = new Map(residents.map((actor) => [actor.id, goodsIn(actor)]));
  const doing = new Map(watch.doing);
  for (const notice of notices) {
    const kind: ReasonKind | null =
      notice.type === "haul"
        ? "haul"
        : notice.type === "attack"
          ? "fight"
          : notice.type === "down"
            ? "down"
            : null;
    if (!kind) continue;
    const was = doing.get(notice.actor);
    if (!was || REASON[kind] >= REASON[was.kind] || world.tick - was.tick > REASON_TICKS)
      doing.set(notice.actor, { kind, tick: world.tick });
  }
  for (const id of doing.keys()) if (!carried.has(id)) doing.delete(id);
  const spotlit = residents.find((actor) => actor.id === subject);
  const camera = watch.camera;
  const here = regionOf(camera);
  const empty = !residents.some((actor) => regionAt(world.atlas, actor.x, actor.y) === here);
  const left = DWELL_TICKS - (world.tick - watch.director.since);
  const kind = reasonOf({ ...watch, tick: world.tick, doing }, subject);
  const weight = kind ? REASON[kind] : 0;
  // What it takes to move the view on from a region it went to, within HOLD_TICKS of getting there.
  const bar =
    camera.route.length > 1 && world.tick < arrival(camera) + HOLD_TICKS ? (camera.weight ?? 0) : 0;
  const want = spotlit
    ? wantedRegion(world.atlas, spotlit, { here, empty, left, weight, bar, camp })
    : -1;
  const next = nextCamera(camera, world.atlas, want, world.tick, empty && want >= 0, weight);
  const setOut = next.since === world.tick && next.since !== camera.since && !next.turned;
  return {
    tick: world.tick,
    fight,
    carried,
    director: watch.director,
    doing,
    subject,
    camera: next,
    reason:
      setOut && kind && subject !== null && regionOf(next) === want
        ? { actor: subject, kind, region: want }
        : null,
  };
}

/**
 * The region the view wants to be on for `subject`, the spotlit resident,
 * or -1 when it should stay where it is. The view is on (or drifting to)
 * region `here`, `empty` when no resident is in it; the subject's dwell in
 * the spotlight ends in `left` ticks; `weight` is how strong the subject's
 * reason to be shown is (see `REASON`; 0 for none), and `bar` what it has to
 * beat for the view to leave a region it went to less than HOLD_TICKS ago
 * (0 once that is past).
 *
 * The view leaves its region for the subject's only when the subject has a
 * reason stronger than `bar`: a quiet resident's turn in another region does
 * not move it, and the page and the overview say where that resident is. A
 * subject walking out of its region is going where its path ends, so the view
 * does not set out for the region it is leaving. Nor does it set out for a
 * subject whose dwell ends before the view could get there and show it for
 * STAY_TICKS. From an empty region it always goes: to the subject's region,
 * or ahead to where its path ends, if the subject has a reason; else to the
 * camp, or the subject's region when the empty one is the camp.
 */
export function wantedRegion(
  atlas: Atlas,
  subject: { readonly x: number; readonly y: number; readonly path: readonly Point[] },
  view: {
    readonly here: number;
    readonly empty: boolean;
    readonly left: number;
    readonly weight: number;
    readonly bar: number;
    readonly camp: number;
  },
): number {
  const { here, empty, left, weight, bar, camp } = view;
  const at = regionAt(atlas, subject.x, subject.y);
  const end = subject.path.at(-1);
  const bound = end ? regionAt(atlas, end.x, end.y) : -1;
  const to = bound >= 0 ? bound : at;
  if (at === here || to === here) return here;
  if (empty) return weight > 0 || here === camp ? to : camp;
  if (weight <= bar || to !== at) return -1;
  const legs = routeBetween(atlas, here, at).length - 1;
  return left >= legs * DRIFT_TICKS + STAY_TICKS ? at : -1;
}
