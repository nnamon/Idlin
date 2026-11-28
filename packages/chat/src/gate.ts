// The gate between a chat adapter and the input queue (docs/chat.md, section
// 10): the ignore list, flood control, and the parser. It keeps time in world
// ticks, which the caller passes with each event, so the same events at the
// same ticks always give the same inputs. The speech filter is C4's.

import { ACCOUNT, type ChatInput, ROLES, TICKS_PER_SECOND, USERNAME } from "@idlin/sim";
import type { ChatEvent } from "./events.ts";
import { DEFAULT_VOCABULARY, parseLine, type Vocabulary } from "./parse.ts";

/** Messages an account may send in any one second; the rest are dropped before they are parsed. */
export const FLOOD_MESSAGES = 5;

/** The longest message id the gate passes on. */
export const MAX_ID = 64;

/** The longest timeout passed on, in seconds: two weeks, as long as a platform allows. */
export const MAX_TIMEOUT_SECONDS = 14 * 24 * 60 * 60;

/** Chat bots that would otherwise become citizens. The streamer adds to the list. */
export const DEFAULT_IGNORE: readonly string[] = [
  "nightbot",
  "streamelements",
  "streamlabs",
  "moobot",
  "fossabot",
  "wizebot",
  "botisimo",
  "soundalerts",
  "sery_bot",
  "kofistreambot",
];

export interface GateOptions {
  /** Logins or account ids whose messages are dropped, in any capitals. Default DEFAULT_IGNORE. */
  readonly ignore?: Iterable<string>;
  readonly vocabulary?: Vocabulary;
}

/**
 * A citizen's name (docs/chat.md, section 2): the display name if it is the
 * login in other capitals, else the login. The name filter is C10's.
 */
export function citizenName(login: string, display: string): string {
  return display.toLowerCase() === login.toLowerCase() && USERNAME.test(display) ? display : login;
}

const text = (value: unknown, most: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= most;

export class Gate {
  private readonly ignore: Set<string>;
  private readonly vocabulary: Vocabulary;
  /** Accounts that have sent a message since the gate started, and so have been sent a `join`. */
  private readonly joined = new Set<string>();
  /** Each account's last FLOOD_MESSAGES arrival ticks, oldest first. */
  private readonly recent = new Map<string, number[]>();

  constructor(options: GateOptions = {}) {
    this.ignore = new Set(
      [...(options.ignore ?? DEFAULT_IGNORE)].map((name) => name.toLowerCase()),
    );
    this.vocabulary = options.vocabulary ?? DEFAULT_VOCABULARY;
  }

  /**
   * The inputs one event makes, arriving at world tick `tick`, in the order
   * they are to be queued. An account's first message since the gate started
   * makes a `join` first; the simulation ignores one for a citizen it already
   * has, so a restarted gate joining everyone again changes nothing. A message
   * that makes no other input is still heard. Never throws: an event of the
   * wrong shape makes nothing.
   */
  pass(event: ChatEvent, tick: number): ChatInput[] {
    try {
      return this.read(event, tick);
    } catch {
      return [];
    }
  }

  private read(event: ChatEvent, tick: number): ChatInput[] {
    const raw: unknown = event;
    if (typeof raw !== "object" || raw === null) return [];
    const { type } = raw as { type?: unknown };
    if (type === "delete") {
      const { id } = raw as { id?: unknown };
      return text(id, MAX_ID) ? [{ type: "unsay", id }] : [];
    }
    if (type === "clear") {
      const { account, seconds } = raw as { account?: unknown; seconds?: unknown };
      if (typeof account !== "string" || !ACCOUNT.test(account)) return [];
      if (seconds === null)
        return [{ type: "mod", by: "platform", action: { action: "ban", account } }];
      if (!Number.isSafeInteger(seconds) || (seconds as number) < 1) return [];
      const length = Math.min(seconds as number, MAX_TIMEOUT_SECONDS);
      return [
        { type: "mod", by: "platform", action: { action: "timeout", account, seconds: length } },
      ];
    }
    if (type !== "message") return [];
    const { id, account, login, display, role } = raw as Record<string, unknown>;
    const said = (raw as { text?: unknown }).text;
    if (!text(id, MAX_ID) || typeof account !== "string" || !ACCOUNT.test(account)) return [];
    if (typeof login !== "string" || !USERNAME.test(login)) return [];
    if (typeof display !== "string" || typeof said !== "string") return [];
    if (!ROLES.some((each) => each === role)) return [];
    const as = role as (typeof ROLES)[number];
    if (this.ignore.has(login.toLowerCase()) || this.ignore.has(account.toLowerCase())) return [];
    if (!this.admit(account, tick)) return [];
    const inputs: ChatInput[] = [];
    if (!this.joined.has(account)) {
      this.joined.add(account);
      inputs.push({ type: "join", account, name: citizenName(login, display), role: as });
    }
    const input = parseLine({ account, role: as, id, text: said }, this.vocabulary);
    inputs.push(input ?? { type: "heard", account });
    return inputs;
  }

  /** Flood control: whether a message from `account` at `tick` is within FLOOD_MESSAGES in the last second. */
  private admit(account: string, tick: number): boolean {
    const times = this.recent.get(account) ?? [];
    const oldest = times[0];
    if (times.length >= FLOOD_MESSAGES && oldest !== undefined && tick - oldest < TICKS_PER_SECOND)
      return false;
    times.push(tick);
    if (times.length > FLOOD_MESSAGES) times.shift();
    this.recent.set(account, times);
    return true;
  }
}
