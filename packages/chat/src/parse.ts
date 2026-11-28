// Turns one chat line into one input (docs/chat.md, sections 3 and 8). The
// parser checks a command's shape only. It does not look anything up in the
// world: `!go bra` becomes a `go` carrying "bra", and the simulation resolves
// it at the tick it applies it, so a replay of the log resolves it the same way.

import { type ChatInput, type ModAction, type Role, TOOLS, USERNAME } from "@idlin/sim";

/** Chat platforms cap a line at 500 characters; anything past that is cut off. */
export const MAX_LINE = 500;

/** The most characters of words a command carries (`!go waist hatch`, `!wear fire`). */
export const MAX_WORDS = 64;

/** Stash slots are numbered 1 to this (docs/slice.md, section 3). */
export const STASH_SLOTS = 12;

/** A moderator's mute lasts this many minutes unless given, and at most a week. */
export const MUTE_MINUTES = 10;
export const MAX_MUTE_MINUTES = 7 * 24 * 60;

/**
 * The params chat can set, by name, each with the names of its values (none
 * for a number). A program's params are its commands, so this is built from
 * the presets the city offers; until the city offers more than one it is
 * DEFAULT_VOCABULARY.
 */
export type Vocabulary = Readonly<Record<string, readonly string[]>>;

/**
 * The params every preset declares in docs/slice.md, section 5, as Deckhand
 * (content/bots/deckhand.tac) declares them. The simulation checks a value
 * against the citizen's own program when it applies it.
 */
export const DEFAULT_VOCABULARY: Vocabulary = Object.freeze({
  stance: ["gather", "fight", "careful"],
  margin: [],
  keep: ["any", "magic", "rare"],
  over: [],
  aid: [],
  ramp: ["board", "guard"],
});

/** The commands the game has whatever program a citizen runs. A param of the same name needs `!set`. */
export const BUILT_IN = [
  "go",
  "home",
  "free",
  "run",
  "me",
  "stash",
  "wear",
  "lock",
  "unlock",
  "scrap",
  ...TOOLS,
  "set",
  "idlin",
] as const;

const WORD = /^[a-z0-9_]{1,32}$/;
const NEGATIVE = /^-[0-9]{1,10}$/;
const SLOT = /^[0-9]{1,2}$/;
const MINUTES = /^[0-9]{1,5}$/;

export interface Line {
  readonly account: string;
  readonly role: Role;
  /** The message's id, carried by speech so a deletion can find it. */
  readonly id: string;
  readonly text: string;
}

/**
 * The line as the parser reads it: cut to MAX_LINE, every control character
 * and run of white space made one space, trimmed.
 */
export function clean(text: string): string {
  let out = "";
  for (const char of text.slice(0, MAX_LINE)) {
    const code = char.charCodeAt(0);
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return out.replace(/\s+/g, " ").trim();
}

const slotOf = (word: string | undefined): number | null => {
  if (word === undefined || !SLOT.test(word)) return null;
  const slot = Number(word);
  return slot >= 1 && slot <= STASH_SLOTS ? slot : null;
};

/** Words of at most MAX_WORDS characters, or null if there are none or too many. */
const wordsOf = (rest: readonly string[]): string | null => {
  const words = rest.join(" ");
  return words.length >= 1 && words.length <= MAX_WORDS ? words : null;
};

/** A username typed in a command, with or without `@`. */
const nameOf = (word: string | undefined): string | null => {
  const name = word?.startsWith("@") ? word.slice(1) : word;
  return name !== undefined && USERNAME.test(name) ? name : null;
};

/**
 * The input a line makes, or null if it makes none: a `!word` the game does
 * not know (other bots' commands share the chat), a command of the wrong
 * shape, or an empty line. Anything that does not start with `!` is speech.
 */
export function parseLine(
  line: Line,
  vocabulary: Vocabulary = DEFAULT_VOCABULARY,
): ChatInput | null {
  const text = clean(line.text);
  if (text === "") return null;
  const { account } = line;
  if (!text.startsWith("!")) return { type: "say", account, id: line.id, text };
  const [head = "", ...rest] = text.slice(1).split(" ");
  const command = head.toLowerCase();
  switch (command) {
    case "go": {
      const words = wordsOf(rest);
      return words === null ? null : { type: "go", account, words };
    }
    case "home":
      return { type: "go", account, words: "home" };
    case "free":
      return { type: "free", account };
    case "run": {
      const preset = rest[0]?.toLowerCase();
      return preset !== undefined && rest.length === 1 && WORD.test(preset)
        ? { type: "run", account, preset }
        : null;
    }
    case "me":
      return { type: "me", account };
    case "stash": {
      if (rest.length === 0) return { type: "stash", account, slot: null };
      const slot = slotOf(rest[0]);
      return slot === null || rest.length > 1 ? null : { type: "stash", account, slot };
    }
    case "wear": {
      const words = wordsOf(rest);
      return words === null ? null : { type: "wear", account, words };
    }
    case "lock":
    case "unlock": {
      const slot = slotOf(rest[0]);
      return slot === null || rest.length > 1
        ? null
        : { type: "lock", account, slot, on: command === "lock" };
    }
    case "scrap": {
      const slot = slotOf(rest[0]);
      return slot === null || rest.length > 1 ? null : { type: "scrap", account, slot };
    }
    case "reroll":
    case "add":
    case "acid": {
      const target = wordsOf(rest);
      return target === null ? null : { type: "bench", account, tool: command, target };
    }
    case "set":
      return param(account, rest[0]?.toLowerCase(), rest.slice(1), vocabulary);
    case "idlin": {
      if (line.role === "viewer") return null;
      const action = modAction(rest.map((word) => word.toLowerCase()));
      return action === null ? null : { type: "mod", by: account, action };
    }
  }
  if (Object.hasOwn(vocabulary, command)) return param(account, command, rest, vocabulary);
  // `!fight` alone sets the one param that has a value of that name.
  const owners = Object.keys(vocabulary).filter((name) => vocabulary[name]?.includes(command));
  const owner = owners[0];
  return owner !== undefined && owners.length === 1 && rest.length === 0
    ? { type: "param", account, name: owner, value: command }
    : null;
}

function param(
  account: string,
  name: string | undefined,
  rest: readonly string[],
  vocabulary: Vocabulary,
): ChatInput | null {
  if (name === undefined || !Object.hasOwn(vocabulary, name)) return null;
  const value = rest[0]?.toLowerCase();
  // A word, or a number with a minus sign for a param whose range goes below 0.
  if (value === undefined || rest.length > 1 || !(WORD.test(value) || NEGATIVE.test(value)))
    return null;
  return { type: "param", account, name, value };
}

/** `!idlin` and what follows it, in lower case (docs/chat.md, section 8). */
function modAction(words: readonly string[]): ModAction | null {
  const [verb, first, second, ...more] = words;
  if (more.length > 0) return null;
  switch (verb) {
    case "mute": {
      const name = nameOf(first);
      if (name === null) return null;
      if (second === undefined) return { action: "mute", name, minutes: MUTE_MINUTES };
      const minutes = MINUTES.test(second) ? Number(second) : 0;
      return minutes >= 1 && minutes <= MAX_MUTE_MINUTES ? { action: "mute", name, minutes } : null;
    }
    case "below":
    case "allow": {
      const name = nameOf(first);
      return name === null || second !== undefined ? null : { action: verb, name };
    }
    case "bubbles":
      if (second !== undefined) return null;
      return first === "on" || first === "off" ? { action: "bubbles", on: first === "on" } : null;
    case "doors":
      if (second !== undefined) return null;
      return first === "open" || first === "shut"
        ? { action: "doors", open: first === "open" }
        : null;
    case "clear":
      return first === "hatch" && second === undefined ? { action: "clear-hatch" } : null;
  }
  return null;
}
