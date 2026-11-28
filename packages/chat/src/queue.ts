// The queue between the gate and the world (docs/chat.md, section 8). Each
// account holds at most one waiting input of each kind; a newer one replaces
// it and keeps its place in the line, so typing faster gains nothing. Each
// tick takes up to INPUTS_PER_TICK in arrival order. Past MOST_WAITING,
// speech goes first and then the newest waiting input of whichever account
// has the most waiting. `join` and `mod` are never dropped.

import type { ChatInput } from "@idlin/sim";

export const INPUTS_PER_TICK = 32;
export const MOST_WAITING = 3000;
/** Param changes one account can have waiting, one per param. */
export const MOST_PARAMS = 8;

interface Entry {
  /** The account whose slot this is; null for `unsay`, which belongs to a message. */
  readonly account: string | null;
  /** The slot it takes in its account's queue. */
  readonly key: string;
  input: ChatInput;
  live: boolean;
}

/** The slot an input takes in its account's queue; null for one that never replaces another. */
function keyOf(input: ChatInput): string | null {
  switch (input.type) {
    case "go":
    case "free":
      return "flag";
    case "param":
      return `param:${input.name}`;
    case "unsay":
      return `unsay:${input.id}`;
    case "mod":
      return null;
    default:
      return input.type;
  }
}

const SPEECH = new Set<ChatInput["type"]>(["say", "unsay", "heard"]);
const KEPT = new Set<ChatInput["type"]>(["join", "mod"]);

export class InputQueue {
  /** Every entry in arrival order from `head`; dropped and replaced ones are marked dead. */
  private line: Entry[] = [];
  private head = 0;
  /** No live speech sits before this index: speech is dropped oldest first and only added at the end. */
  private speechFrom = 0;
  private live = 0;
  /** Each account's waiting entries by slot. */
  private readonly byAccount = new Map<string, Map<string, Entry>>();
  private unique = 0;

  get size(): number {
    return this.live;
  }

  /** What `account` has waiting, in arrival order. */
  waiting(account: string): ChatInput[] {
    const slots = this.byAccount.get(account);
    if (!slots) return [];
    return this.line
      .slice(this.head)
      .filter((entry) => entry.live && slots.get(entry.key) === entry)
      .map((entry) => entry.input);
  }

  push(input: ChatInput): void {
    const account = "account" in input ? input.account : null;
    const key = keyOf(input) ?? `once:${this.unique++}`;
    if (input.type === "unsay") {
      // A message deleted before it was taken is simply taken out.
      const said = this.findSay(input.id);
      if (said) {
        this.remove(said);
        return;
      }
    }
    const owner = account ?? "";
    const slots = this.byAccount.get(owner) ?? new Map<string, Entry>();
    this.byAccount.set(owner, slots);
    const waiting = slots.get(key);
    if (waiting) {
      waiting.input = input;
      return;
    }
    // `heard` rides on any other input an account has waiting.
    if (input.type === "heard" && slots.size > 0) return;
    if (
      input.type === "param" &&
      [...slots.keys()].filter((k) => k.startsWith("param:")).length >= MOST_PARAMS
    )
      return;
    const entry: Entry = { account, key, input, live: true };
    slots.set(key, entry);
    this.line.push(entry);
    this.live++;
    while (this.live > MOST_WAITING) if (!this.dropOne()) break;
  }

  /** Takes up to `most` waiting inputs, oldest first. */
  take(most = INPUTS_PER_TICK): ChatInput[] {
    const taken: ChatInput[] = [];
    while (taken.length < most && this.head < this.line.length) {
      const entry = this.line[this.head++] as Entry;
      if (!entry.live) continue;
      this.remove(entry);
      taken.push(entry.input);
    }
    if (this.head > 1024 && this.head * 2 > this.line.length) {
      this.line = this.line.slice(this.head);
      this.speechFrom = Math.max(0, this.speechFrom - this.head);
      this.head = 0;
    }
    return taken;
  }

  private remove(entry: Entry): void {
    entry.live = false;
    this.live--;
    const owner = entry.account ?? "";
    const slots = this.byAccount.get(owner);
    if (slots?.get(entry.key) === entry) slots.delete(entry.key);
    if (slots?.size === 0) this.byAccount.delete(owner);
  }

  private findSay(id: string): Entry | undefined {
    for (let i = this.head; i < this.line.length; i++) {
      const entry = this.line[i] as Entry;
      if (entry.live && entry.input.type === "say" && entry.input.id === id) return entry;
    }
    return undefined;
  }

  /** Drops one input past the bound and says whether there was one it could drop. */
  private dropOne(): boolean {
    for (let i = Math.max(this.head, this.speechFrom); i < this.line.length; i++) {
      const entry = this.line[i] as Entry;
      if (entry.live && SPEECH.has(entry.input.type)) {
        this.remove(entry);
        this.speechFrom = i + 1;
        return true;
      }
    }
    this.speechFrom = this.line.length;
    // The account with the most droppable inputs waiting loses its newest; on a tie, the
    // account whose newest came last.
    const counts = new Map<string, number>();
    let victim: Entry | undefined;
    let most = 0;
    for (let i = this.head; i < this.line.length; i++) {
      const entry = this.line[i] as Entry;
      if (!entry.live || KEPT.has(entry.input.type)) continue;
      const owner = entry.account ?? "";
      const count = (counts.get(owner) ?? 0) + 1;
      counts.set(owner, count);
      if (count >= most) {
        most = count;
        victim = entry;
      }
    }
    if (!victim) return false;
    this.remove(victim);
    return true;
  }
}
