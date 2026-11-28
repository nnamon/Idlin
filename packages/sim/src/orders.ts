// What chat changes on a citizen (docs/chat.md, sections 3 and 8): its flag,
// its params, and when its chatter was last heard. A command never moves a
// citizen. It changes something the citizen's program reads, and the program
// decides. Names typed in `!go` are resolved here, against the world at the
// tick the order is applied, so a replay of the log resolves them the same way.

import { type Atlas, tileAt, walkable } from "./atlas.ts";
import { fieldTo, stepsTo } from "./field.ts";
import { setPath } from "./grid.ts";
import { isInt32, stringInts } from "./hash.ts";
import { ACCOUNT } from "./inputs.ts";
import { type Point, place } from "./map.ts";
import { SYSCALLS } from "./syscalls.ts";
import { OP, operandsOf, type Program } from "./vm.ts";
import {
  type Actor,
  ADVENTURER,
  DAY_HOUR,
  isNight,
  mending,
  NIGHT_HOUR,
  START_HOUR,
  stepTicks,
  TICKS_PER_DAY,
  TICKS_PER_GAME_HOUR,
  type World,
} from "./world.ts";

/** Orders and param changes a citizen can hold at once, and the ticks one takes to come back (section 8). */
export const MAX_TOKENS = 2;
export const TOKEN_TICKS = 200;
/** Where `heard` stops counting: 24 hours of ticks. */
export const HEARD_MOST = 864_000;
/** A name typed in `!go` matches any prefix of at least this many letters that only one name has. */
export const SHORTEST_PREFIX = 3;
/** How far from the camp a compass point's flag goes, in tiles along each axis it names. */
export const COMPASS_REACH = 12;
/**
 * In the camp, which has no cycle yet, nightfall stands in for the horde at
 * the hull, sighted this many ticks before it. `lift_eta` reads NOT_SIGHTED
 * until then.
 */
export const SIGHTING_TICKS = 3000;
export const NOT_SIGHTED = 9999;
/** What `way_home` reads where there is no way home. */
export const NO_WAY = 9999;

/** What a flag is on, as `flagged` reads it. */
export const FLAG_NONE = 0;
export const FLAG_TILE = 1;
export const FLAG_CITIZEN = 2;
export const FLAG_HOME = 3;

/**
 * Whether the program took its flag at its last decision (docs/chat.md,
 * section 3.2): followed when the rule that won reads the flag or sits under
 * one that does; held when it sits above every rule that reads the flag;
 * unread when no rule reads it. HEED_NONE with no flag, and from the moment
 * one is planted until the program has decided with it.
 */
export const HEED_NONE = 0;
export const HEED_FOLLOWED = 1;
export const HEED_HELD = 2;
export const HEED_UNREAD = 3;

/** The part of an actor that chat changes, as it is saved and hashed. */
export interface Orders {
  /** The chat account the citizen belongs to; "" for an actor no chatter owns. */
  readonly account: string;
  /** The values of its program's params, in the program's order. */
  params: number[];
  /** The tick its chatter last typed anything, or the tick it came into the world. */
  heard: number;
  /** Orders and param changes it can take now, 0 to MAX_TOKENS. */
  tokens: number;
  /** With fewer than MAX_TOKENS, the tick the next one comes back; 0 with all of them. */
  tokenAt: number;
  /** FLAG_NONE, FLAG_TILE, FLAG_CITIZEN or FLAG_HOME. */
  flag: number;
  /** The tile a flag on a tile or at home stands on; 0 otherwise. */
  flagX: number;
  flagY: number;
  /** The id of the citizen a flag on a citizen follows; 0 otherwise. */
  flagOn: number;
  /** The tick the flag was planted; 0 with no flag. */
  flagAt: number;
  /** HEED_NONE, HEED_FOLLOWED, HEED_HELD or HEED_UNREAD. */
  heed: number;
}

/** The orders an actor starts with: its program's defaults, a full set of tokens, no flag. */
export const freshOrders = (program: Program, account: string, tick: number): Orders => ({
  account,
  params: program.params.map((param) => param.value),
  heard: tick,
  tokens: MAX_TOKENS,
  tokenAt: 0,
  flag: FLAG_NONE,
  flagX: 0,
  flagY: 0,
  flagOn: 0,
  flagAt: 0,
  heed: HEED_NONE,
});

/** Both 32-bit halves of a tick, which may outgrow 32 bits. */
const halvesOf = (n: number): number[] => [
  n % 0x1_0000_0000,
  (n - (n % 0x1_0000_0000)) / 0x1_0000_0000,
];

/** An actor's orders as the hash takes them. */
export const ordersInts = (a: Orders): number[] => [
  ...stringInts(a.account),
  a.params.length,
  ...a.params,
  ...halvesOf(a.heard),
  a.tokens,
  ...halvesOf(a.tokenAt),
  a.flag,
  a.flagX,
  a.flagY,
  a.flagOn,
  ...halvesOf(a.flagAt),
  a.heed,
];

const tickLike = (n: unknown, most: number): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= most;

/**
 * A saved actor's orders, or null if they are not what an actor of that kind
 * on that program could hold at `tick`. A flag on a citizen is checked against
 * the other actors afterwards (see `flagsHold`).
 */
export function readOrders(
  item: Record<string, unknown>,
  adventurer: boolean,
  program: Program,
  atlas: Atlas,
  tick: number,
): Orders | null {
  const { account, params, heard, tokens, tokenAt, flag, flagX, flagY, flagOn, flagAt, heed } =
    item;
  if (typeof account !== "string") return null;
  if (account !== "" && (!adventurer || !ACCOUNT.test(account))) return null;
  if (!Array.isArray(params) || params.length !== program.params.length) return null;
  const values: number[] = [];
  for (let i = 0; i < params.length; i++) {
    const value: unknown = params[i];
    const param = program.params[i];
    if (!param || !isInt32(value) || value < param.min || value > param.max) return null;
    values.push(value);
  }
  if (!tickLike(heard, tick)) return null;
  if (!isInt32(tokens) || tokens < 0 || tokens > MAX_TOKENS) return null;
  if (tokens === MAX_TOKENS ? tokenAt !== 0 : !tickLike(tokenAt, tick + TOKEN_TICKS) || tokenAt < 1)
    return null;
  if (!isInt32(flag) || flag < FLAG_NONE || flag > FLAG_HOME) return null;
  if (!isInt32(flagX) || !isInt32(flagY) || !isInt32(flagOn) || !tickLike(flagAt, tick))
    return null;
  if (!isInt32(heed) || heed < HEED_NONE || heed > HEED_UNREAD) return null;
  const onTile = flag === FLAG_TILE || flag === FLAG_HOME;
  if (onTile ? !walkable(atlas, flagX, flagY) : flagX !== 0 || flagY !== 0) return null;
  if (flag === FLAG_CITIZEN ? flagOn < 1 : flagOn !== 0) return null;
  if (flag === FLAG_NONE && (flagAt !== 0 || heed !== HEED_NONE)) return null;
  // Only a chatter plants a flag, and only on its own citizen.
  if (flag !== FLAG_NONE && account === "") return null;
  return {
    account,
    params: values,
    heard,
    tokens,
    tokenAt: tokenAt as number,
    flag,
    flagX,
    flagY,
    flagOn,
    flagAt,
    heed,
  };
}

/** Whether every flag on a citizen follows another adventurer in the world. */
export const flagsHold = (actors: readonly Actor[]): boolean =>
  actors.every(
    (a) =>
      a.flag !== FLAG_CITIZEN ||
      actors.some((b) => b.id === a.flagOn && b !== a && b.kind === ADVENTURER),
  );

/**
 * A saved actor from before the orders were kept, with them: its program's
 * defaults, a full set of tokens, no flag, and no account, since the snapshot
 * did not keep one, so no chatter can order it.
 */
export function withOrders(
  actor: unknown,
  programs: Readonly<Record<string, Program>>,
  tick: unknown,
): unknown {
  if (typeof actor !== "object" || actor === null) return actor;
  const { program } = actor as Record<string, unknown>;
  const table =
    typeof program === "string" && Object.hasOwn(programs, program) ? programs[program] : undefined;
  const fresh = freshOrders(table ?? { version: 0, code: [], rules: [], params: [] }, "", 0);
  return { ...actor, ...fresh, heard: tickLike(tick, Number.MAX_SAFE_INTEGER) ? tick : 0 };
}

/**
 * A saved actor's orders fitted to content that has changed (see adopt.ts).
 * A changed program's params go back to its defaults, since the snapshot
 * keeps their values and not what they were. A flag comes down when the
 * ground it stood on is gone or the citizen it followed was removed.
 * Returns the fields to change, and whether the flag came down.
 */
export function fitOrders(
  item: Readonly<Record<string, unknown>>,
  program: Program,
  changed: boolean,
  atlas: Atlas,
  citizens: ReadonlySet<unknown>,
): { readonly fields: Record<string, unknown>; readonly flagDown: boolean } {
  const fields: Record<string, unknown> = {};
  if (changed) fields.params = program.params.map((param) => param.value);
  const { flag, flagX, flagY, flagOn, id } = item;
  const onTile = flag === FLAG_TILE || flag === FLAG_HOME;
  const gone =
    (onTile && !(isInt32(flagX) && isInt32(flagY) && walkable(atlas, flagX, flagY))) ||
    (flag === FLAG_CITIZEN && (flagOn === id || !citizens.has(flagOn)));
  if (gone)
    Object.assign(fields, {
      flag: FLAG_NONE,
      flagX: 0,
      flagY: 0,
      flagOn: 0,
      flagAt: 0,
      heed: HEED_NONE,
    });
  return { fields, flagDown: gone };
}

/** The citizen of a chat account, if it has one in the world. */
export const citizenOf = (world: World, account: string): Actor | undefined =>
  account === ""
    ? undefined
    : world.actors.find((actor) => actor.kind === ADVENTURER && actor.account === account);

/** Brings the tokens up to date with the tick: one back every TOKEN_TICKS, up to MAX_TOKENS. */
function refill(actor: Actor, tick: number): void {
  while (actor.tokens < MAX_TOKENS && tick >= actor.tokenAt) {
    actor.tokens++;
    actor.tokenAt += TOKEN_TICKS;
  }
  if (actor.tokens >= MAX_TOKENS) actor.tokenAt = 0;
}

/** Whether the citizen has a token to spend at `tick`. */
function hasToken(actor: Actor, tick: number): boolean {
  refill(actor, tick);
  return actor.tokens > 0;
}

function spend(actor: Actor, tick: number): void {
  if (actor.tokens === MAX_TOKENS) actor.tokenAt = tick + TOKEN_TICKS;
  actor.tokens--;
}

/**
 * An accepted order ends what the citizen is doing: the step it is in and a
 * blow it is in finish, and then its program decides again. One mending after
 * a down goes on mending.
 */
function interrupt(world: World, actor: Actor): void {
  if (mending(actor)) return;
  setPath(world, actor, []);
  actor.blocked = 0;
  actor.wait = 0;
}

type Target =
  | { readonly flag: typeof FLAG_TILE | typeof FLAG_HOME; readonly x: number; readonly y: number }
  | { readonly flag: typeof FLAG_CITIZEN; readonly on: number };

/**
 * The one of `names` that `word` names: the name itself, or else the one name
 * it is a prefix of SHORTEST_PREFIX or more letters long. "none" when nothing
 * matches, so the next step is looked in; "refused" when two names share it.
 */
function match<T>(word: string, names: readonly (readonly [string, T])[]): T | "none" | "refused" {
  const exact = names.filter(([name]) => name === word);
  if (exact.length === 1) return (exact[0] as readonly [string, T])[1];
  if (exact.length > 1) return "refused";
  if (word.length < SHORTEST_PREFIX) return "none";
  const prefixed = names.filter(([name]) => name.startsWith(word));
  if (prefixed.length === 1) return (prefixed[0] as readonly [string, T])[1];
  return prefixed.length > 1 ? "refused" : "none";
}

/** The eight compass points, by both their names, with the way each goes. */
const COMPASS: readonly (readonly [string, string, number, number])[] = [
  ["n", "north", 0, -1],
  ["ne", "northeast", 1, -1],
  ["e", "east", 1, 0],
  ["se", "southeast", 1, 1],
  ["s", "south", 0, 1],
  ["sw", "southwest", -1, 1],
  ["w", "west", -1, 0],
  ["nw", "northwest", -1, -1],
];

const compassTiles = new WeakMap<Atlas, Point[]>();

/**
 * Where each compass point's flag stands: the walkable tile nearest the point
 * COMPASS_REACH tiles from the camp that way, the first in row order of those
 * as near. The slice's landings have no sectors, whose hearts these will be;
 * in the camp they are somewhere a citizen can walk to. Worked out once per atlas.
 */
function compassOf(atlas: Atlas): Point[] {
  let tiles = compassTiles.get(atlas);
  if (tiles) return tiles;
  const camp = place(atlas, "camp");
  tiles = COMPASS.map(([, , dx, dy]) => {
    const to = { x: camp.x + dx * COMPASS_REACH, y: camp.y + dy * COMPASS_REACH };
    let best: Point = camp;
    let bestSteps = Number.MAX_SAFE_INTEGER;
    for (const region of atlas.regions) {
      for (let y = region.y; y < region.y + region.map.height; y++) {
        for (let x = region.x; x < region.x + region.map.width; x++) {
          const steps = Math.abs(x - to.x) + Math.abs(y - to.y);
          if (steps >= bestSteps || !walkable(atlas, x, y)) continue;
          best = { x, y };
          bestSteps = steps;
        }
      }
    }
    return best;
  });
  compassTiles.set(atlas, tiles);
  return tiles;
}

/**
 * What `!go <words>` plants a flag on for `self`, looked up in docs/chat.md's
 * order: home, a compass point, a named place, a citizen by username (or
 * `@name` for a citizen only). The first step with a match wins. Null when
 * nothing matches, or when two names in the step that matched share the
 * prefix typed.
 */
export function resolveGo(world: World, self: Actor, typed: string): Target | null {
  const words = typed.toLowerCase().replace(/\s+/g, " ").trim();
  const citizen = words.startsWith("@");
  const word = citizen ? words.slice(1) : words;
  if (word === "") return null;
  const { atlas } = world;
  if (!citizen) {
    if (word === "home") {
      const camp = place(atlas, "camp");
      return { flag: FLAG_HOME, x: camp.x, y: camp.y };
    }
    const point = COMPASS.findIndex(([short, long]) => word === short || word === long);
    if (point >= 0) {
      const at = compassOf(atlas)[point] as Point;
      return { flag: FLAG_TILE, x: at.x, y: at.y };
    }
    // A place's name is written with underscores and typed with spaces.
    const places = atlas.places.map((p) => [p.name.replace(/_/g, " "), p] as const);
    const found = match(word, places);
    if (found === "refused") return null;
    if (found !== "none") return { flag: FLAG_TILE, x: found.x, y: found.y };
  }
  const citizens = world.actors
    .filter((actor) => actor.kind === ADVENTURER)
    .map((actor) => [actor.name.toLowerCase(), actor] as const);
  const found = match(word, citizens);
  if (found === "none" || found === "refused" || found === self) return null;
  return { flag: FLAG_CITIZEN, on: found.id };
}

/** Where the actor's flag stands now, or null with no flag. A flag on a citizen is where that citizen is. */
export function flagPlace(world: World, actor: Actor): Point | null {
  if (actor.flag === FLAG_NONE) return null;
  if (actor.flag !== FLAG_CITIZEN) return { x: actor.flagX, y: actor.flagY };
  return world.actors.find((other) => other.id === actor.flagOn) ?? null;
}

/** Whether the citizen the flag is on is down. */
export function flagDown(world: World, actor: Actor): boolean {
  if (actor.flag !== FLAG_CITIZEN) return false;
  const on = world.actors.find((other) => other.id === actor.flagOn);
  return on !== undefined && mending(on);
}

const FLAG_SENSORS = new Set(
  ["flagged", "flag_x", "flag_y", "flag_age", "flag_down"].map(
    (name) => SYSCALLS.find((c) => c.name === name)?.id,
  ),
);
const flagRules = new WeakMap<Program, number>();

/**
 * The first rule of a program that reads the flag, in its condition or its
 * actions, or -1 if none does. Read off the bytecode, so it holds for any
 * program the machine runs.
 */
export function firstFlagRule(program: Program): number {
  let first = flagRules.get(program);
  if (first !== undefined) return first;
  first = -1;
  const { code } = program;
  let rule = -1;
  for (let at = 0; at < code.length; at += 1 + operandsOf(code[at] as number)) {
    const op = code[at];
    if (op === OP.RULE) rule = code[at + 1] as number;
    if (op === OP.SENSE && FLAG_SENSORS.has(code[at + 1]) && (first < 0 || rule < first))
      first = rule;
  }
  flagRules.set(program, first);
  return first;
}

/** Whether the program took the flag, as `heed` keeps it, after a decision ended in `rule`. */
export function heedOf(program: Program, actor: Actor, rule: number): number {
  if (actor.flag === FLAG_NONE) return HEED_NONE;
  const first = firstFlagRule(program);
  if (first < 0) return HEED_UNREAD;
  return rule >= first ? HEED_FOLLOWED : HEED_HELD;
}

/** Ticks until the horde reaches the hull, as `lift_eta` reads it; in the camp, until nightfall. */
export function liftEta(world: World): number {
  if (isNight(world)) return 0;
  const ofDay = (world.tick + START_HOUR * TICKS_PER_GAME_HOUR) % TICKS_PER_DAY;
  const left = NIGHT_HOUR * TICKS_PER_GAME_HOUR - ofDay;
  return ofDay >= DAY_HOUR * TICKS_PER_GAME_HOUR && left <= SIGHTING_TICKS ? left : NOT_SIGHTED;
}

/** Ticks the walk home takes the actor from where it stands, as `way_home` reads it. */
export function wayHome(world: World, actor: Actor): number {
  const { atlas } = world;
  const camp = place(atlas, "camp");
  const steps = stepsTo(
    world,
    fieldTo(world, tileAt(atlas, camp.x, camp.y)),
    tileAt(atlas, actor.x, actor.y),
  );
  return steps < 0 ? NO_WAY : Math.min(NO_WAY, steps * stepTicks(world, actor));
}

/**
 * Applies a chat input to the citizen of its account: every one says its
 * chatter was heard, and `go`, `free` and `param` change the flag or a param
 * when they can. Anything that cannot be honoured is dropped whole: a word
 * that names nothing, a value the param does not allow, no token left. A
 * repeat of what already stands costs nothing and does nothing. `fields` are
 * the input's own, read once.
 */
export function applyOrder(world: World, fields: Readonly<Record<string, unknown>>): void {
  const { type, account } = fields;
  if (typeof account !== "string") return;
  const actor = citizenOf(world, account);
  if (!actor) return;
  const { tick } = world;
  actor.heard = tick;
  if (type === "free") {
    if (actor.flag === FLAG_NONE || !hasToken(actor, tick)) return;
    spend(actor, tick);
    Object.assign(actor, { flag: FLAG_NONE, flagX: 0, flagY: 0, flagOn: 0, flagAt: 0 });
    actor.heed = HEED_NONE;
    interrupt(world, actor);
  } else if (type === "go") {
    const { words } = fields;
    if (typeof words !== "string" || words.length > 64 || !hasToken(actor, tick)) return;
    const target = resolveGo(world, actor, words);
    if (!target) return;
    const flagX = target.flag === FLAG_CITIZEN ? 0 : target.x;
    const flagY = target.flag === FLAG_CITIZEN ? 0 : target.y;
    const flagOn = target.flag === FLAG_CITIZEN ? target.on : 0;
    const same =
      actor.flag === target.flag &&
      actor.flagX === flagX &&
      actor.flagY === flagY &&
      actor.flagOn === flagOn;
    if (same) return;
    spend(actor, tick);
    Object.assign(actor, { flag: target.flag, flagX, flagY, flagOn, flagAt: tick });
    actor.heed = HEED_NONE;
    interrupt(world, actor);
  } else if (type === "param") {
    const { name, value } = fields;
    if (typeof name !== "string" || typeof value !== "string") return;
    const program = world.programs[actor.program] as Program;
    const index = program.params.findIndex((param) => param.name === name);
    const param = program.params[index];
    if (!param) return;
    // A named value by its name, and a number as digits: `!stance fight`, `!margin 150`.
    let set: number | null = null;
    if (param.values.length > 0)
      set = param.values.includes(value) ? param.values.indexOf(value) : null;
    else if (/^[0-9]{1,10}$/.test(value)) set = Number(value);
    if (set === null || set < param.min || set > param.max) return;
    if (actor.params[index] === set || !hasToken(actor, tick)) return;
    spend(actor, tick);
    actor.params[index] = set;
    interrupt(world, actor);
  }
}
