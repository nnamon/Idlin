// The line under each resident's name on the page: what it is doing, to what
// or where, and at most one number, read off the world and the fight once a
// tick. It is built from the actor's state (its path, its wait, its
// hitpoints, its bag, who is near it and who it traded blows with), never
// from its program's rule labels, so a program cannot write into it. The same
// line with the name in front is how the news tells of it. Pure, like
// fight.ts: everything here is a function of the worlds seen so far.

import {
  type Actor,
  ADVENTURER,
  type Atlas,
  BAG_SLOTS,
  clock,
  GOODS,
  isNight,
  kindOf,
  type Point,
  regionAt,
  type World,
} from "@idlin/sim";
import { ARRIVE_TICKS, type Fight, LIE_TICKS, type News } from "./fight.ts";

/** Ticks a line stays up before another may replace it: two seconds. A resident downed goes up at once. */
export const HOLD_TICKS = 20;
/** An enemy this close, in steps, is near enough to be following, or to be run from. */
export const NEAR_ENEMY = 8;
/** An enemy this close to someone in a fight is one of those it is fighting. */
export const FOE_RANGE = 4;
/** A walk that ends this close to a named place is a walk to it; farther, it is a walk near it. */
export const PLACE_RANGE = 4;
/**
 * A walk that ends at least this many steps farther from an enemy than it
 * began is running from it. A single step round something on the way to a
 * monster is not.
 */
export const RUN_GAIN = 2;
/** Ticks each resident's line stays on the news when nothing has happened: five seconds. */
export const QUIET_TICKS = 50;

/** What a line says a resident is doing. */
export type Doing =
  | "downed"
  | "mending"
  | "stopped"
  | "fighting"
  | "running"
  | "towards"
  | "followed"
  | "walking"
  | "asleep"
  | "resting";

export interface Line {
  readonly doing: Doing;
  /** What it is doing, to what or where: "walking to the river". */
  readonly text: string;
  /** The same, less a place in the region it is in, for a row that names the region instead. */
  readonly bare: string;
  /** The one number that matters, or "": "bag 0/12", "wolf 16/24", "9 tiles to camp". */
  readonly number: string;
}

/** A walk in progress, as it was when it began. */
export interface Walk {
  readonly to: Point;
  readonly from: Point;
  /** Whether it began with an enemy near and ends at least RUN_GAIN steps farther from it. */
  readonly running: boolean;
}

export interface Lines {
  readonly tick: number;
  readonly walks: ReadonlyMap<number, Walk>;
  /** The line each resident's row shows, and since when. */
  readonly shown: ReadonlyMap<number, { readonly line: Line; readonly since: number }>;
  /** Lines of news from this tick. */
  readonly news: readonly News[];
}

export const NO_LINES: Lines = {
  tick: Number.NEGATIVE_INFINITY,
  walks: new Map(),
  shown: new Map(),
  news: [],
};

const steps = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "a wolf", "2 wolves": a monster's name, lower case, counted. */
function counted(name: string, n: number): string {
  const one = name.toLowerCase();
  if (n === 1) return /^[aeiou]/.test(one) ? `an ${one}` : `a ${one}`;
  const many = one.endsWith("f")
    ? `${one.slice(0, -1)}ves`
    : /(s|x|ch|sh)$/.test(one)
      ? `${one}es`
      : `${one}s`;
  return `${n} ${many}`;
}

/** "a wolf", "2 wolves", "a wolf and 3 goblins": enemies nearest first, by kind. */
function enemyList(enemies: readonly Actor[]): string {
  const byName = new Map<string, number>();
  for (const enemy of enemies) byName.set(enemy.name, (byName.get(enemy.name) ?? 0) + 1);
  const parts = [...byName].map(([name, n]) => counted(name, n));
  return parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Places that are part of camp, which the line calls camp. */
const AT_CAMP: ReadonlySet<string> = new Set(["bank", "fire"]);

/** How a place is written: "camp", "the river", "the near wood". */
export const placeName = (name: string): string =>
  name === "camp" ? "camp" : `the ${name.replaceAll("_", " ")}`;

/**
 * The named place nearest `p` in its own region, and whether `p` is at it
 * (within PLACE_RANGE). The bank is a chest at camp and the fire is camp's
 * own, so both go by camp.
 */
function placeAt(atlas: Atlas, p: Point): { name: string; at: boolean; region: number } | null {
  const region = regionAt(atlas, p.x, p.y);
  let best: { name: string; d: number } | null = null;
  for (const place of atlas.places) {
    if (AT_CAMP.has(place.name) || regionAt(atlas, place.x, place.y) !== region) continue;
    const d = steps(place, p);
    if (!best || d < best.d) best = { name: place.name, d };
  }
  return best && { name: best.name, at: best.d <= PLACE_RANGE, region };
}

/**
 * "to the river" / "near the meadow" (or "at the river", with `at`), with
 * the region the place is in. A place whose own name starts with "near" is
 * one a walk goes by, so a walk is never "near the near wood".
 */
function where(atlas: Atlas, p: Point, at: "to" | "at"): { words: string; region: number } | null {
  const found = placeAt(atlas, p);
  if (!found) return null;
  const name = placeName(found.name);
  const how = found.at ? at : found.name.startsWith("near_") ? "by" : "near";
  return { words: `${how} ${name}`, region: found.region };
}

/** "9 fish, 3 logs": what is in a bag, or "" if nothing is. */
export function bagList(bag: readonly number[]): string {
  const count = (good: (typeof GOODS)[number]): number =>
    bag.filter((slot) => slot === GOODS.indexOf(good) + 1).length;
  return [
    [count("raw_fish"), "fish", "fish"],
    [count("cooked_fish"), "cooked fish", "cooked fish"],
    [count("logs"), "log", "logs"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => plural(n as number, one as string, many as string))
    .join(", ");
}

/** The enemies in `actor`'s region within `range` steps of it, nearest first. */
function enemiesNear(world: World, actor: Actor, range: number): Actor[] {
  const region = regionAt(world.atlas, actor.x, actor.y);
  return world.actors
    .filter(
      (other) =>
        other.kind !== ADVENTURER &&
        regionAt(world.atlas, other.x, other.y) === region &&
        steps(other, actor) <= range,
    )
    .sort((a, b) => steps(a, actor) - steps(b, actor) || a.id - b.id);
}

const walking = (actor: Actor): boolean => actor.path.length > 0 || actor.moveTicksLeft > 0;
const destination = (actor: Actor): Point => actor.path.at(-1) ?? { x: actor.x, y: actor.y };
/** Whether `actor` is walking to somewhere nearer `p` than the tile it set off from on this step. */
const nearing = (actor: Actor, p: Point): boolean =>
  walking(actor) && steps(destination(actor), p) < steps({ x: actor.fromX, y: actor.fromY }, p);

/** The walk `actor` is on after this tick, given the one it was on: kept while it goes to the same tile. */
export function nextWalk(world: World, actor: Actor, walk: Walk | undefined): Walk | undefined {
  if (!walking(actor)) return undefined;
  const to = destination(actor);
  if (walk && walk.to.x === to.x && walk.to.y === to.y) return walk;
  const from = { x: actor.fromX, y: actor.fromY };
  const enemy = enemiesNear(world, { ...actor, ...from }, NEAR_ENEMY)[0];
  return {
    to,
    from,
    running: enemy !== undefined && steps(to, enemy) - steps(from, enemy) >= RUN_GAIN,
  };
}

const line = (doing: Doing, text: string, number = "", bare = text): Line => ({
  doing,
  text,
  bare,
  number,
});

/** "wolf 16/24", or "nearest 16/24" for several: the hitpoints of the nearest of `foes`. */
function foeNumber(world: World, foes: readonly Actor[]): string {
  const nearest = foes[0] as Actor;
  const hp = `${Math.max(0, nearest.hp)}/${kindOf(world, nearest).hp}`;
  return foes.length === 1 ? `${nearest.name.toLowerCase()} ${hp}` : `nearest ${hp}`;
}

/** "9 tiles to camp" for someone in camp's region away from it, else "". */
function campNumber(world: World, actor: Actor): string {
  const { atlas } = world;
  const camp = atlas.places.find((p) => p.name === "camp") as Point;
  const home = steps(actor, camp);
  return regionAt(atlas, actor.x, actor.y) === regionAt(atlas, camp.x, camp.y) && home > 0
    ? `${plural(home, "tile", "tiles")} to camp`
    : "";
}

/** "up at 11:31": when a resident mending at camp gets up. */
function upAt(world: World, actor: Actor): string {
  const up = clock({ ...world, tick: world.tick + actor.wait });
  return `up at ${String(up.hour).padStart(2, "0")}:${String(up.minute).padStart(2, "0")}`;
}

const gap = (actor: Actor, enemy: Actor): string => plural(steps(actor, enemy), "tile", "tiles");

/** The tile a resident was downed on, by whom, and when; undefined unless it is lying there still. */
function downedAt(fight: Fight, actor: Actor, tick: number): Fight["fallen"][number] | undefined {
  const since = fight.downs.get(actor.id);
  if (since === undefined || tick - since >= LIE_TICKS + ARRIVE_TICKS) return undefined;
  return fight.fallen.findLast((f) => f.id === actor.id && f.since === since);
}

/**
 * The line for resident `actor` in `world` (the whole world, in world
 * coordinates), from `fight` read off the same world and the walk it is on.
 * The first of these that holds: downed, mending, stopped, fighting, running,
 * walking towards an enemy, followed by one, walking, asleep, resting.
 */
export function lineFor(world: World, actor: Actor, fight: Fight, walk: Walk | undefined): Line {
  const { atlas } = world;
  const camp = atlas.places.find((p) => p.name === "camp") as Point;
  const fell = downedAt(fight, actor, world.tick);
  if (fell) {
    const by = fell.by ? ` by ${counted(fell.by, 1)}` : "";
    const at = where(atlas, fell, "at");
    return line("downed", `downed${by}${at ? ` ${at.words}` : ""}`);
  }
  if (fight.downs.has(actor.id) && actor.wait > 0)
    return line("mending", "mending at camp", upAt(world, actor));
  if (actor.fault !== 0) return line("stopped", "stopped", "program error");

  const foes = enemiesNear(world, actor, FOE_RANGE);
  if (foes.length > 0 && (fight.engaged.has(actor.id) || actor.windup > 0))
    return line("fighting", `fighting ${enemyList(foes)}`, foeNumber(world, foes));

  // Running, towards and followed all need a monster near now, not only when the walk began.
  const near = enemiesNear(world, actor, NEAR_ENEMY);
  const close = near[0];
  if (close && walking(actor) && walk?.running)
    return line("running", `running from ${enemyList(near)}`, campNumber(world, actor));
  if (close && nearing(actor, close))
    return line("towards", `walking towards ${enemyList([close])}`, gap(actor, close));
  // Followed: an enemy near is walking to somewhere nearer this resident.
  const after = near.filter((enemy) => nearing(enemy, actor));
  const first = after[0];
  if (first) return line("followed", `followed by ${enemyList(after)}`, gap(actor, first));

  const region = regionAt(atlas, actor.x, actor.y);
  const bag = bagList(actor.bag);
  if (walking(actor)) {
    const to = destination(actor);
    const place = where(atlas, to, "to");
    const text = place ? `walking ${place.words}` : "walking";
    const fromCamp = walk !== undefined && steps(walk.from, camp) <= PLACE_RANGE;
    const leaving = fromCamp && steps(to, camp) > PLACE_RANGE;
    const number = bag !== "" ? bag : leaving ? `bag 0/${BAG_SLOTS}` : "";
    return line("walking", text, number, place && place.region !== region ? text : "walking");
  }
  const place = where(atlas, actor, "at");
  if (isNight(world) && place?.words === "at camp") return line("asleep", "asleep at camp");
  return line("resting", place ? `resting ${place.words}` : "resting", "", "resting");
}

/** How the page writes a line: "walking to the river · bag 0/12", or for someone in another region, "in the Pinewood · walking". */
export function pageText(shown: Line, away?: string): string {
  if (away !== undefined)
    return `in ${away} · ${shown.bare}${shown.number ? `, ${shown.number}` : ""}`;
  return shown.number ? `${shown.text} · ${shown.number}` : shown.text;
}

/** How the news tells of a line: "Dara is running from 2 wolves, 9 tiles to camp". */
export function newsText(name: string, shown: Line): string {
  return `${name} is ${shown.text}${shown.number ? `, ${shown.number}` : ""}`;
}

/** The lines that are news when one goes up: a fight starting, and running from one. */
const NEWSWORTHY: ReadonlySet<Doing> = new Set(["fighting", "running"]);
/** The lines that go up at once, held line or not. */
const AT_ONCE: ReadonlySet<Doing> = new Set(["downed", "fighting"]);

/**
 * The number for `held`'s words as the world is now, or null if the words are
 * no longer true: a line about a monster when none is within NEAR_ENEMY.
 */
export function numberNow(world: World, actor: Actor, held: Line, fight: Fight): string | null {
  const near = enemiesNear(world, actor, NEAR_ENEMY);
  const close = near[0];
  switch (held.doing) {
    case "fighting":
      return close ? foeNumber(world, near) : null;
    case "running":
      return close ? campNumber(world, actor) : null;
    case "towards":
    case "followed":
      return close ? gap(actor, close) : null;
    case "mending":
      return fight.downs.has(actor.id) && actor.wait > 0 ? upAt(world, actor) : held.number;
    case "walking": {
      const bag = bagList(actor.bag);
      return bag !== "" ? bag : held.number;
    }
    default:
      return held.number;
  }
}

/**
 * The lines after a tick, from those before it. A row's line holds for
 * HOLD_TICKS before another replaces it, so a fight does not make it flicker
 * between fighting and walking. While its words are held its number follows
 * the world, and it is not held at all once its words are untrue (see
 * `numberNow`). A fight starting, or a resident downed, goes up at once.
 * Nothing is read across missed ticks: a walk seen first after a gap is a new
 * one.
 */
export function nextLines(previous: Lines, world: World, fight: Fight): Lines {
  const followsOn = previous.tick === world.tick - 1;
  const walks = new Map<number, Walk>();
  const shown = new Map<number, { line: Line; since: number }>();
  const news: News[] = [];
  for (const actor of world.actors) {
    if (actor.kind !== ADVENTURER) continue;
    const walk = nextWalk(world, actor, followsOn ? previous.walks.get(actor.id) : undefined);
    if (walk) walks.set(actor.id, walk);
    const next = lineFor(world, actor, fight, walk);
    const was = previous.shown.get(actor.id);
    if (was && was.line.text === next.text) {
      shown.set(actor.id, { line: next, since: was.since });
      continue;
    }
    const atOnce = AT_ONCE.has(next.doing) && was?.line.doing !== next.doing;
    const number =
      was && world.tick - was.since < HOLD_TICKS && !atOnce
        ? numberNow(world, actor, was.line, fight)
        : null;
    if (was && number !== null) {
      shown.set(actor.id, { line: { ...was.line, number }, since: was.since });
      continue;
    }
    shown.set(actor.id, { line: next, since: world.tick });
    if (was && NEWSWORTHY.has(next.doing) && was.line.doing !== next.doing)
      news.push({ text: newsText(actor.name, next), who: actor.id, doing: next.doing });
  }
  return { tick: world.tick, walks, shown, news };
}

/**
 * The line of news when nothing has happened: one resident's row line with
 * the name in front, "Tim is walking to the river, bag 0/12". It takes each
 * of `residents` the page does not list in turn, QUIET_TICKS each, or each of
 * them if the page lists them all. Null if there is no one to tell of.
 */
export function quietNews(
  lines: Lines,
  residents: readonly Actor[],
  listed: ReadonlySet<number>,
  tick: number,
): News | null {
  const told = residents.filter((actor) => lines.shown.has(actor.id));
  const unlisted = told.filter((actor) => !listed.has(actor.id));
  const pool = unlisted.length > 0 ? unlisted : told;
  const actor = pool[Math.floor(tick / QUIET_TICKS) % pool.length];
  const shown = actor && lines.shown.get(actor.id);
  return actor && shown ? { text: newsText(actor.name, shown.line), who: actor.id } : null;
}

/**
 * A line of news as it reads now. News of what a resident is doing is told
 * from its row's line as it is now, so its number is never old, and is null
 * once the row no longer says it is doing that: "is running" is not news
 * after the running has stopped. Any other news is as it was.
 */
export function newsNow(lines: Lines, world: World, news: News): News | null {
  if (news.doing === undefined) return news;
  const shown = lines.shown.get(news.who)?.line;
  const actor = world.actors.find((a) => a.id === news.who);
  if (!shown || !actor || shown.doing !== news.doing) return null;
  return { ...news, text: newsText(actor.name, shown) };
}
