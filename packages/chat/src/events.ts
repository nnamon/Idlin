// What a chat adapter reports (docs/chat.md, section 10). Adapters read and
// never send, so these three are everything a chat platform can tell the game.

import type { Role } from "@idlin/sim";

export type ChatEvent =
  | {
      readonly type: "message";
      /** The platform's id for the message, for deleting it later. */
      readonly id: string;
      /** The platform's id for the account: kept when the account is renamed. */
      readonly account: string;
      /** The username, in lower case on most platforms. */
      readonly login: string;
      /** The username as the chatter writes it. */
      readonly display: string;
      readonly text: string;
      readonly role: Role;
      /** Where emotes sit in `text`, as [start, end] code unit offsets. */
      readonly emotes: readonly (readonly [start: number, end: number])[];
    }
  /** A moderator deleted a message. */
  | { readonly type: "delete"; readonly id: string }
  /** An account was timed out for `seconds`, or banned if that is null. */
  | { readonly type: "clear"; readonly account: string; readonly seconds: number | null };
