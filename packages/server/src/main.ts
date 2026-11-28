// Runs the world server. Settings come from the environment:
//   IDLIN_DATA            snapshot directory (default: data)
//   IDLIN_HOST            address to listen on (default: 127.0.0.1)
//   IDLIN_PORT            WebSocket port (default: 4311)
//   IDLIN_SEED            seed for a new world (default: 1)
//   IDLIN_RESIDENTS       residents of a new world (default: 6, or 0 with IDLIN_CHAT)
//   IDLIN_SNAPSHOT_TICKS  ticks between snapshots (default: 600, one minute)
//   IDLIN_ORIGINS         comma-separated page Origins allowed to connect, on top of
//                         http://localhost:4310 and http://127.0.0.1:4310, matched
//                         exactly (e.g. http://viewer.example:4310)
//   IDLIN_CHAT            where chat comes from: crowd:<name> reads the crowd file
//                         content/chat/<name>.txt (default: no chat)
//   IDLIN_CHAT_IGNORE     comma-separated logins or account ids to ignore, on top of
//                         the gate's list of chat bots
// SIGTERM or SIGINT saves a snapshot and exits: 0 if it was saved, 1 if not.
import { DEFAULT_IGNORE } from "@idlin/chat";
import { loadCrowd } from "./content.ts";
import { viewerOrigins, WorldServer } from "./server.ts";

const int = (name: string, fallback: number): number => {
  const text = process.env[name];
  if (text === undefined || text === "") return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a whole number`);
  return value;
};

const log = (line: string): void => console.log(line);

const host = process.env.IDLIN_HOST || "127.0.0.1";
const chat = process.env.IDLIN_CHAT || "";
if (chat !== "" && !chat.startsWith("crowd:")) throw new Error("IDLIN_CHAT must be crowd:<name>");
const crowd = chat === "" ? undefined : loadCrowd(chat.slice("crowd:".length));
const ignore = (process.env.IDLIN_CHAT_IGNORE ?? "")
  .split(",")
  .map((each) => each.trim())
  .filter((each) => each !== "");
const server = await WorldServer.start({
  ...(crowd ? { crowd } : {}),
  ignore: [...DEFAULT_IGNORE, ...ignore],
  dataDir: process.env.IDLIN_DATA || "data",
  host,
  port: int("IDLIN_PORT", 4311),
  seed: int("IDLIN_SEED", 1),
  residents: int("IDLIN_RESIDENTS", crowd ? 0 : 6),
  snapshotTicks: Math.max(1, int("IDLIN_SNAPSHOT_TICKS", 600)),
  origins: viewerOrigins(process.env.IDLIN_ORIGINS),
  log,
});

let stopping = false;
const shutdown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  server.stop().then((saved) => {
    if (saved) log(`${signal}: saved at tick ${server.world.tick}`);
    else log(`${signal}: stopped at tick ${server.world.tick}; the snapshot was not saved`);
    process.exit(saved ? 0 : 1);
  });
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
server.run();
// Only now, with the handlers in place, is it ready to be stopped.
log(`listening on ${host}:${server.port}`);
