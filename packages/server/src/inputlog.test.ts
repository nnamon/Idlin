import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Crowd, parseCrowd } from "@idlin/chat";
import { ADVENTURER, hashWorld } from "@idlin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { loadContent, loadCrowd } from "./content.ts";
import { logName } from "./inputlog.ts";
import { type ServerOptions, WorldServer } from "./server.ts";

const CONTENT = loadContent();
const dirs: string[] = [];
const servers: WorldServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop({ save: false });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "idlin-log-"));
  dirs.push(dir);
  return dir;
};

const start = async (dataDir: string, extra: Partial<ServerOptions> = {}, lines: string[] = []) => {
  const server = await WorldServer.start({
    dataDir,
    port: 0,
    host: "127.0.0.1",
    seed: 8,
    residents: 0,
    snapshotTicks: 100,
    log: (line) => lines.push(line),
    content: CONTENT,
    ...extra,
  });
  servers.push(server);
  return server;
};

/** Fifty chatters from the 150-chatter file's names, who join and give orders. */
const FIFTY: Crowd = (() => {
  const names = loadCrowd("crowd-150")
    .chatters.slice(0, 50)
    .map((chatter) => chatter.login);
  return parseCrowd(
    [
      "seed 50",
      `names ${names.join(" ")}`,
      "00:00 +20 regulars over 20s",
      "00:00 +10 commanders over 20s",
      "00:30 +10 talkers over 30s",
      "01:00 +9 lurkers over 1m",
      "02:00 +1 spammers",
      "05:00 * 50% !home",
      "15:00 * 30% !go river",
    ].join("\n"),
  );
})();

const logs = (dir: string): string[] =>
  readdirSync(dir)
    .filter((file) => file.endsWith(".log"))
    .sort();

describe("the input log", () => {
  it("brings a snapshot to the live hash after a crowd of 50 has joined and ordered for 12,000 ticks", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY, snapshotTicks: 5000 });
    live.advance(12_000);
    expect(live.world.tick).toBe(12_001);
    expect(live.world.actors.filter((actor) => actor.kind === ADVENTURER)).toHaveLength(50);
    // The last snapshot is at 10,001, and its log holds every tick since.
    const text = readFileSync(join(dir, logName(10_001)), "utf8");
    expect(text.split("\n")).toHaveLength(2001);
    expect(text).toContain('"type":"go"');

    // Started again on the same folder, as after a kill: no save on the way down.
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY, snapshotTicks: 5000 }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000010001.json at tick 10001",
      "replayed 2000 ticks of its input log, to tick 12001",
    ]);
    expect(hashWorld(again.world)).toBe(hashWorld(live.world));
  });

  it("replays the 150-chatter crowd file's log to the same hash", async () => {
    const dir = tempDir();
    const crowd = loadCrowd("crowd-150");
    // Past the 60% `!home` at 12:05.
    const live = await start(dir, { crowd, snapshotTicks: 4000 });
    live.advance(7600);
    expect(live.world.actors.filter((actor) => actor.kind === ADVENTURER)).toHaveLength(150);
    const lines: string[] = [];
    const again = await start(dir, { crowd, snapshotTicks: 4000 }, lines);
    expect(lines[1]).toBe("replayed 3600 ticks of its input log, to tick 7601");
    expect(hashWorld(again.world)).toBe(hashWorld(live.world));
  });

  it("ignores a torn last line, and goes on from the lines before it", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(150);
    const name = logName(101);
    // A crash in the middle of a write.
    appendFileSync(join(dir, name), '{"tick":151,"inputs":[{"type":"jo');
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000101.json at tick 101",
      "replayed 50 ticks of its input log, to tick 151",
    ]);
    expect(hashWorld(again.world)).toBe(hashWorld(live.world));
    // The torn line is gone from the file, and what comes after it reads.
    const kept = readFileSync(join(dir, name), "utf8");
    expect(kept.endsWith("}\n")).toBe(true);
    expect(kept.split("\n")).toHaveLength(51);
    again.advance(30);
    await again.stop({ save: false });
    servers.splice(servers.indexOf(again), 1);
    const third: string[] = [];
    const resumed = await start(dir, { crowd: FIFTY }, third);
    expect(third[1]).toBe("replayed 80 ticks of its input log, to tick 181");
    expect(hashWorld(resumed.world)).toBe(hashWorld(again.world));
  });

  it("stops at a line that is not the next tick, and says so", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(120);
    await live.stop({ save: false });
    servers.splice(servers.indexOf(live), 1);
    appendFileSync(join(dir, logName(101)), '{"tick":999,"inputs":[]}\n{"tick":121,"inputs":[]}\n');
    const lines: string[] = [];
    const again = await start(dir, {}, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000101.json at tick 101",
      `the input log ${logName(101)} stops being usable at line 21; the rest is ignored`,
      "replayed 20 ticks of its input log, to tick 121",
    ]);
    expect(again.world.tick).toBe(121);
  });

  it("keeps a log beside each snapshot kept, and deletes it with its snapshot", async () => {
    const dir = tempDir();
    const server = await start(dir);
    server.advance(550);
    expect(logs(dir)).toEqual([301, 401, 501].map(logName));
    await server.stop();
    servers.length = 0;
    expect(logs(dir)).toEqual([401, 501, 551].map(logName));
  });

  it("queues what an adapter hears and applies it at the next tick", async () => {
    const server = await start(tempDir());
    server.hear({
      type: "message",
      id: "m1",
      account: "4242",
      login: "goofguy",
      display: "goofguy",
      text: "hello",
      role: "viewer",
      emotes: [],
    });
    expect(server.waiting).toBe(2);
    server.advance(1);
    expect(server.waiting).toBe(0);
    expect(server.world.actors.map((actor) => actor.name)).toContain("goofguy");
  });
});
