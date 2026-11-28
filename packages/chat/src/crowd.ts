// The scripted crowd: a chat adapter for captures, tests and the gate, read
// from a crowd file (content/chat/). What it says at a tick is a pure
// function of the file and the tick, so a run with a crowd is the same every
// time. The format, one directive a line, `#` for a comment:
//
//   seed 7                          seeds who says what, and when
//   names joshyboy88 goofguy ...    usernames generated chatters are given, in order
//   mods goofguy                    usernames with the moderator role
//   streamer joshyboy88             the streamer's username
//   00:00 +12 regulars              12 chatters of a kind arrive at 00:00
//   01:00 +3 talkers every 20s      ... with their own period
//   06:10 +40 raid over 10s         ... arriving spread over 10 s
//   00:05 goofguy: hello            one line from one chatter
//   12:05 * 60% !home               a line from 60% of those who have arrived
//
// Times are minutes and seconds (or hours, minutes and seconds) from the
// crowd's start. Each chatter's first line comes when it arrives. Then it says
// one line in each period after that, at a seeded point in the period:
//
//   regulars   every 60 s, speech or a command
//   talkers    every 20 s, speech
//   commanders every 30 s, a command
//   lurkers    nothing after the first line
//   raid       every 120 s, speech or a command
//   spammers   ten `!go` lines a second for the first 5 s of every 60 s
//
// A chatter with a name the filter fails is C10's, with the filter.

import { TICKS_PER_SECOND, USERNAME } from "@idlin/sim";
import type { ChatEvent } from "./events.ts";

export class CrowdError extends Error {
  override name = "CrowdError";
}

export const KINDS = ["regulars", "talkers", "commanders", "lurkers", "raid", "spammers"] as const;
export type CrowdKind = (typeof KINDS)[number];

/** Each kind's period in ticks; 0 for one that says nothing after its first line. */
const PERIOD: Readonly<Record<CrowdKind, number>> = {
  regulars: 60 * TICKS_PER_SECOND,
  talkers: 20 * TICKS_PER_SECOND,
  commanders: 30 * TICKS_PER_SECOND,
  lurkers: 0,
  raid: 120 * TICKS_PER_SECOND,
  spammers: 60 * TICKS_PER_SECOND,
};

/** How long a spammer floods at the start of each period. */
const SPAM_TICKS = 5 * TICKS_PER_SECOND;

/** The most chatters a file may generate, and the most lines it may have. */
export const MOST_CHATTERS = 5000;
export const MOST_LINES = 10_000;

const SPEECH = [
  "hi",
  "hello",
  "hey all",
  "lol",
  "gg",
  "nice",
  "o7",
  "back",
  "brb",
  "lets go",
  "where is everyone",
  "that was close",
  "what level is that",
  "who has the rare",
];

const PLACES = ["river", "hills", "camp", "north", "east", "south", "west", "home"];

interface Chatter {
  readonly login: string;
  readonly account: string;
  readonly kind: CrowdKind | null;
  /** Crowd tick of its first line; for a chatter with explicit lines only, its first one. */
  readonly arrives: number;
  readonly period: number;
}

interface Said {
  readonly tick: number;
  readonly login: string;
  readonly text: string;
}

interface Broadcast {
  readonly tick: number;
  readonly percent: number;
  readonly text: string;
  readonly line: number;
}

export interface Crowd {
  readonly seed: number;
  /** In the order they were made; explicit speakers who are not generated come after. */
  readonly chatters: readonly Chatter[];
  /** Explicit lines by crowd tick, in file order. */
  readonly said: ReadonlyMap<number, readonly Said[]>;
  /** Shares by crowd tick, in file order. */
  readonly broadcasts: ReadonlyMap<number, readonly Broadcast[]>;
  readonly mods: ReadonlySet<string>;
  readonly streamer: string | null;
}

/** Mixes three integers into an unsigned 32-bit number. */
function mix(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ b, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ c, 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * A stable numeric account id for a username, as a chat platform would give
 * one: the same name always has the same id.
 */
export function accountFor(login: string): string {
  let h = 0x811c9dc5;
  for (const char of login.toLowerCase()) h = Math.imul(h ^ char.charCodeAt(0), 0x01000193);
  return String(10_000_000 + (h >>> 0));
}

const TIME = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/;
const SPAN = /^(\d{1,4})(s|m)$/;

const ticksOf = (text: string, line: number): number => {
  const match = TIME.exec(text);
  if (!match) throw new CrowdError(`line ${line}: "${text}" is not a time such as 01:30`);
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  return ((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * TICKS_PER_SECOND;
};

const spanOf = (text: string | undefined, line: number): number => {
  const match = SPAN.exec(text ?? "");
  if (!match) throw new CrowdError(`line ${line}: "${text ?? ""}" is not a span such as 20s or 2m`);
  const [, count = "0", unit] = match;
  return Number(count) * (unit === "m" ? 60 : 1) * TICKS_PER_SECOND;
};

/** Reads a crowd file. Throws a CrowdError, naming the line, for anything it cannot read. */
export function parseCrowd(text: string): Crowd {
  const lines = text.split("\n");
  if (lines.length > MOST_LINES) throw new CrowdError(`more than ${MOST_LINES} lines`);
  let seed = 0;
  const pool: string[] = [];
  const mods = new Set<string>();
  let streamer: string | null = null;
  const groups: { tick: number; count: number; kind: CrowdKind; period: number; over: number }[] =
    [];
  const said: Said[] = [];
  const broadcasts: Broadcast[] = [];
  const username = (name: string, line: number): string => {
    if (!USERNAME.test(name))
      throw new CrowdError(
        `line ${line}: "${name}" is not a username of 3 to 25 letters, digits and underscores`,
      );
    return name;
  };
  lines.forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) return;
    const [first = "", ...rest] = text.split(/\s+/);
    if (first === "seed") {
      const value = Number(rest[0]);
      if (rest.length !== 1 || !Number.isSafeInteger(value))
        throw new CrowdError(`line ${line}: seed needs one whole number`);
      seed = value | 0;
      return;
    }
    if (first === "names") {
      for (const name of rest) pool.push(username(name, line));
      return;
    }
    if (first === "mods") {
      for (const name of rest) mods.add(username(name, line).toLowerCase());
      return;
    }
    if (first === "streamer") {
      if (rest.length !== 1) throw new CrowdError(`line ${line}: streamer needs one username`);
      streamer = username(rest[0] as string, line).toLowerCase();
      return;
    }
    const tick = ticksOf(first, line);
    const [what = ""] = rest;
    if (what.startsWith("+")) {
      const count = Number(what.slice(1));
      const kind = KINDS.find((each) => each === rest[1]);
      if (!Number.isInteger(count) || count < 1 || count > MOST_CHATTERS)
        throw new CrowdError(`line ${line}: "${what}" is not a count such as +12`);
      if (!kind) throw new CrowdError(`line ${line}: the kind must be one of ${KINDS.join(", ")}`);
      let period = PERIOD[kind];
      let over = 0;
      for (let i = 2; i < rest.length; i += 2) {
        const option = rest[i];
        if (option !== "every" && option !== "over")
          throw new CrowdError(`line ${line}: "${option}" is not "every" or "over"`);
        const span = spanOf(rest[i + 1], line);
        if (option === "over") over = span;
        else if (kind === "lurkers" || span < 1)
          throw new CrowdError(`line ${line}: lurkers have no period, and a period must be over 0`);
        else period = span;
      }
      groups.push({ tick, count, kind, period, over });
      return;
    }
    if (what === "*") {
      const percent = Number(/^(\d{1,3})%$/.exec(rest[1] ?? "")?.[1]);
      if (!(percent >= 1 && percent <= 100))
        throw new CrowdError(`line ${line}: "* " needs a share such as 60%`);
      const said = rest.slice(2).join(" ");
      if (said === "") throw new CrowdError(`line ${line}: nothing to say`);
      broadcasts.push({ tick, percent, text: said, line });
      return;
    }
    const colon = text.indexOf(":", first.length);
    const name = text.slice(first.length, colon).trim();
    const words = text.slice(colon + 1).trim();
    if (colon < 0 || words === "")
      throw new CrowdError(`line ${line}: expected "+count kind", "* share text" or "name: text"`);
    said.push({ tick, login: username(name, line), text: words });
  });

  const lower = pool.map((name) => name.toLowerCase());
  const twice = lower.find((name, i) => lower.indexOf(name) !== i);
  if (twice !== undefined) throw new CrowdError(`the names list has ${twice} twice`);
  const chatters: Chatter[] = [];
  let next = 0;
  for (const group of groups) {
    if (next + group.count > pool.length)
      throw new CrowdError(`the names list has ${pool.length} names, and the groups need more`);
    for (let i = 0; i < group.count; i++) {
      const login = pool[next] as string;
      const arrives = group.tick + (group.over > 0 ? mix(seed, next, 0) % group.over : 0);
      const { kind, period } = group;
      chatters.push({ login, account: accountFor(login), kind, arrives, period });
      next++;
    }
  }
  // Someone who only has lines of their own arrives with the first of them.
  const known = new Set(chatters.map((chatter) => chatter.login.toLowerCase()));
  for (const line of [...said].sort((a, b) => a.tick - b.tick)) {
    if (known.has(line.login.toLowerCase())) continue;
    known.add(line.login.toLowerCase());
    const { login, tick: arrives } = line;
    chatters.push({ login, account: accountFor(login), kind: null, arrives, period: 0 });
  }
  if (chatters.length > MOST_CHATTERS) throw new CrowdError(`more than ${MOST_CHATTERS} chatters`);
  if (new Set(chatters.map((chatter) => chatter.account)).size !== chatters.length)
    throw new CrowdError("two names in the file have the same account id; rename one");
  return { seed, chatters, said: byTick(said), broadcasts: byTick(broadcasts), mods, streamer };
}

function byTick<T extends { readonly tick: number }>(items: readonly T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) map.set(item.tick, [...(map.get(item.tick) ?? []), item]);
  return map;
}

/** A generated chatter's line for its `n`th period: speech or a command, as its kind says. */
function lineFor(crowd: Crowd, index: number, n: number): string {
  const chatter = crowd.chatters[index] as Chatter;
  const roll = mix(crowd.seed, index, n + 0x5bd1e995);
  const speech = SPEECH[roll % SPEECH.length] as string;
  if (n === 0 && chatter.kind !== "spammers") return speech;
  const command = (): string => {
    const pick = (roll >>> 8) % 10;
    if (pick < 4) {
      const others = crowd.chatters.length;
      const place = (roll >>> 16) % (PLACES.length + 1);
      const target =
        place < PLACES.length
          ? (PLACES[place] as string)
          : (crowd.chatters[(roll >>> 4) % others] as Chatter).login;
      return `!go ${target}`;
    }
    if (pick === 4) return "!free";
    if (pick === 5) return "!me";
    if (pick === 6) return `!margin ${((roll >>> 12) % 9) * 30}`;
    return ["!fight", "!gather", "!careful"][(roll >>> 12) % 3] as string;
  };
  switch (chatter.kind) {
    case "talkers":
    case "lurkers":
      return speech;
    case "commanders":
      return command();
    case "spammers":
      return `!go ${PLACES[n % PLACES.length]}`;
    default:
      return (roll >>> 24) % 2 === 0 ? speech : command();
  }
}

/** What a generated chatter says at crowd tick `tick`, or null. */
function generated(crowd: Crowd, index: number, tick: number): string | null {
  const chatter = crowd.chatters[index] as Chatter;
  if (chatter.kind === null || tick < chatter.arrives) return null;
  const since = tick - chatter.arrives;
  if (since === 0) return lineFor(crowd, index, 0);
  const { period } = chatter;
  if (period === 0) return null;
  const n = Math.floor(since / period);
  const into = since - n * period;
  if (chatter.kind === "spammers") return into < SPAM_TICKS ? lineFor(crowd, index, since) : null;
  if (n === 0) return null;
  return into === mix(crowd.seed, index, n) % period ? lineFor(crowd, index, n) : null;
}

/**
 * Every message the crowd sends at crowd tick `tick` (0 is its start), in a
 * fixed order: generated chatters in the order they were made, then explicit
 * lines in file order, then shares. Message ids are `c<tick>-<n>`.
 */
export function crowdEvents(crowd: Crowd, tick: number): ChatEvent[] {
  const out: { login: string; account: string; text: string }[] = [];
  crowd.chatters.forEach((chatter, index) => {
    const text = generated(crowd, index, tick);
    if (text !== null) out.push({ login: chatter.login, account: chatter.account, text });
  });
  for (const line of crowd.said.get(tick) ?? [])
    out.push({ login: line.login, account: accountFor(line.login), text: line.text });
  for (const share of crowd.broadcasts.get(tick) ?? []) {
    crowd.chatters.forEach((chatter, index) => {
      if (chatter.arrives >= tick) return;
      if (mix(crowd.seed, index, share.line) % 100 >= share.percent) return;
      out.push({ login: chatter.login, account: chatter.account, text: share.text });
    });
  }
  return out.map(({ login, account, text }, n) => {
    const lower = login.toLowerCase();
    const role = lower === crowd.streamer ? "streamer" : crowd.mods.has(lower) ? "mod" : "viewer";
    return {
      type: "message",
      id: `c${tick}-${n}`,
      account,
      login: lower,
      display: login,
      text,
      role,
      emotes: [],
    };
  });
}
