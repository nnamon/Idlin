// The inputs chat and the streamer's site send the world (docs/chat.md,
// section 10). The gate in packages/chat makes them; the world server logs
// them a tick at a time and `step` applies them. `join`, `heard`, `go`,
// `free` and `param` have their effects (orders.ts), and every input from a
// chatter's own messages marks them heard. The rest are dropped by `step`
// until the pieces that give them one are built.

/** A chat username as the platform gives it: 3 to 25 letters, digits and underscores. */
export const USERNAME = /^[A-Za-z0-9_]{3,25}$/;

/** An account id from the chat platform; the key a citizen is kept under. */
export const ACCOUNT = /^[A-Za-z0-9_:-]{1,40}$/;

export type Role = "viewer" | "mod" | "streamer";
export const ROLES: readonly Role[] = ["viewer", "mod", "streamer"];

/**
 * The program a citizen made by `join` runs: the shipped program, Deckhand
 * (docs/chat.md, section 9). A world without it takes no joins.
 */
export const NEWCOMER_PROGRAM = "deckhand";

/** The tools a bench order spends (docs/slice.md, section 3). */
export type Tool = "reroll" | "add" | "acid";
export const TOOLS: readonly Tool[] = ["reroll", "add", "acid"];

/** What a moderator, the platform's own moderation, or the streamer's site asks of the city. */
export type ModAction =
  | { readonly action: "mute"; readonly name: string; readonly minutes: number }
  | { readonly action: "below"; readonly name: string }
  | { readonly action: "allow"; readonly name: string }
  | { readonly action: "bubbles"; readonly on: boolean }
  | { readonly action: "doors"; readonly open: boolean }
  | { readonly action: "clear-hatch" }
  /** The platform timed an account out; `seconds` long. */
  | { readonly action: "timeout"; readonly account: string; readonly seconds: number }
  /** The platform banned an account. */
  | { readonly action: "ban"; readonly account: string };

/**
 * One input from chat. Every kind but `unsay` and `mod` is for the citizen of
 * `account`, and comes from that account's own messages. Words are as typed:
 * the simulation resolves them against the world at the tick it applies them.
 */
export type ChatInput =
  | { readonly type: "join"; readonly account: string; readonly name: string; readonly role: Role }
  | { readonly type: "heard"; readonly account: string }
  | { readonly type: "go"; readonly account: string; readonly words: string }
  | { readonly type: "free"; readonly account: string }
  | {
      readonly type: "param";
      readonly account: string;
      readonly name: string;
      readonly value: string;
    }
  | { readonly type: "run"; readonly account: string; readonly preset: string }
  | { readonly type: "me"; readonly account: string }
  | { readonly type: "stash"; readonly account: string; readonly slot: number | null }
  | { readonly type: "wear"; readonly account: string; readonly words: string }
  | {
      readonly type: "lock";
      readonly account: string;
      readonly slot: number;
      readonly on: boolean;
    }
  | { readonly type: "scrap"; readonly account: string; readonly slot: number }
  | {
      readonly type: "bench";
      readonly account: string;
      readonly tool: Tool;
      readonly target: string;
    }
  | {
      readonly type: "say";
      readonly account: string;
      readonly id: string;
      readonly text: string;
    }
  | { readonly type: "unsay"; readonly id: string }
  /** `by` is the moderator's account, `platform` for the chat's own moderation, or `site`. */
  | { readonly type: "mod"; readonly by: string; readonly action: ModAction };

export type ChatInputType = ChatInput["type"];
