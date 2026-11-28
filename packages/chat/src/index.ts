// Chat: the gate between a stream's chat and the world, and the scripted crowd.
export { Chat, type ChatOptions } from "./chat.ts";
export {
  accountFor,
  type Crowd,
  CrowdError,
  type CrowdKind,
  crowdEvents,
  KINDS,
  MOST_CHATTERS,
  parseCrowd,
} from "./crowd.ts";
export type { ChatEvent } from "./events.ts";
export {
  citizenName,
  DEFAULT_IGNORE,
  FLOOD_MESSAGES,
  Gate,
  type GateOptions,
  MAX_ID,
} from "./gate.ts";
export {
  BUILT_IN,
  clean,
  DEFAULT_VOCABULARY,
  type Line,
  MAX_LINE,
  MAX_WORDS,
  parseLine,
  STASH_SLOTS,
  type Vocabulary,
} from "./parse.ts";
export { INPUTS_PER_TICK, InputQueue, MOST_PARAMS, MOST_WAITING } from "./queue.ts";
