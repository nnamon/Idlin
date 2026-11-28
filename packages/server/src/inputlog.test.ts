import {
  appendFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Crowd, parseCrowd } from "@idlin/chat";
import { ADVENTURER, hashWorld } from "@idlin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadContent, loadCrowd } from "./content.ts";
import { InputLog, logName, replayLog } from "./inputlog.ts";
import { type ServerOptions, WorldServer } from "./server.ts";
import { listSnapshots, loadNewest, snapshotName } from "./store.ts";

/**
 * Writes and reads to make fail: `write` and `short` count the next writeSync
 * calls that throw or take only five bytes, `read` names a file whose next read throws.
 */
const fail = vi.hoisted(() => ({ write: 0, short: 0, read: "" }));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const eio = (call: string): never => {
    throw Object.assign(new Error(`EIO: i/o error, ${call}`), { code: "EIO" });
  };
  const writeSync = ((fd: number, data: string | Uint8Array, ...rest: unknown[]): number => {
    if (fail.write > 0) {
      fail.write--;
      return eio("write");
    }
    if (fail.short > 0) {
      fail.short--;
      const bytes = typeof data === "string" ? Buffer.from(data) : data;
      const offset = typeof data !== "string" && typeof rest[0] === "number" ? rest[0] : 0;
      return fs.writeSync(fd, bytes, offset, 5);
    }
    return (fs.writeSync as (...args: unknown[]) => number)(fd, data, ...rest);
  }) as typeof fs.writeSync;
  const readFileSync = ((path: unknown, options?: unknown) => {
    if (fail.read !== "" && String(path).endsWith(fail.read)) {
      fail.read = "";
      return eio("read");
    }
    return (fs.readFileSync as (...args: unknown[]) => unknown)(path, options);
  }) as typeof fs.readFileSync;
  return { ...fs, default: { ...fs, writeSync, readFileSync }, writeSync, readFileSync };
});

const CONTENT = loadContent();
const dirs: string[] = [];
const servers: WorldServer[] = [];
afterEach(async () => {
  Object.assign(fail, { write: 0, short: 0, read: "" });
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
    expect(live.world.tick).toBe(12_000);
    expect(live.world.actors.filter((actor) => actor.kind === ADVENTURER)).toHaveLength(50);
    // The last snapshot is at 10,001, and its log holds every tick since.
    const text = readFileSync(join(dir, logName(10_000)), "utf8");
    expect(text.split("\n")).toHaveLength(2001);
    expect(text).toContain('"type":"go"');

    // Started again on the same folder, as after a kill: no save on the way down.
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY, snapshotTicks: 5000 }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000010000.json at tick 10000",
      "replayed 2000 ticks of its input log, to tick 12000",
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
    expect(lines[1]).toBe("replayed 3600 ticks of its input log, to tick 7600");
    expect(hashWorld(again.world)).toBe(hashWorld(live.world));
  });

  it("ignores a torn last line, and goes on from the lines before it", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(150);
    const name = logName(100);
    // A crash in the middle of a write.
    appendFileSync(join(dir, name), '{"tick":150,"inputs":[{"type":"jo');
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000100.json at tick 100",
      "replayed 50 ticks of its input log, to tick 150",
    ]);
    expect(hashWorld(again.world)).toBe(hashWorld(live.world));
    // The torn line is gone from the file, and the world was saved where the replay ended.
    const kept = readFileSync(join(dir, name), "utf8");
    expect(kept.endsWith("}\n")).toBe(true);
    expect(kept.split("\n")).toHaveLength(51);
    expect(listSnapshots(dir)[0]).toBe(snapshotName(150));
    again.advance(30);
    await again.stop({ save: false });
    servers.splice(servers.indexOf(again), 1);
    const third: string[] = [];
    const resumed = await start(dir, { crowd: FIFTY }, third);
    expect(third).toEqual([
      `resumed ${snapshotName(150)} at tick 150`,
      "replayed 30 ticks of its input log, to tick 180",
    ]);
    expect(hashWorld(resumed.world)).toBe(hashWorld(again.world));
  });

  it("stops at a line that is not the next tick, and says so", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(120);
    await live.stop({ save: false });
    servers.splice(servers.indexOf(live), 1);
    appendFileSync(join(dir, logName(100)), '{"tick":999,"inputs":[]}\n{"tick":120,"inputs":[]}\n');
    const whole = readFileSync(join(dir, logName(100)), "utf8");
    const lines: string[] = [];
    const again = await start(dir, {}, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000100.json at tick 100",
      `the input log ${logName(100)} stops being usable at line 21; the rest is ignored`,
      "replayed 20 ticks of its input log, to tick 120",
    ]);
    expect(again.world.tick).toBe(120);
    // The whole file is kept aside to look at; the lines used stay beside their snapshot.
    expect(readFileSync(join(dir, `${logName(100)}.bad`), "utf8")).toBe(whole);
    expect(readFileSync(join(dir, logName(100)), "utf8")).toBe(
      `${whole.split("\n").slice(0, 20).join("\n")}\n`,
    );
  });

  it("keeps the lines a write could not take, so the file never has a gap or a torn line", () => {
    const dir = tempDir();
    const lines: string[] = [];
    const log = new InputLog(dir, 1, (line) => lines.push(line));
    const ticks = (from: number, to: number): void => {
      for (let tick = from; tick < to; tick++) log.append(tick, []);
    };
    ticks(1, 11);
    // The second flush throws; the third writes only five bytes at its first try.
    fail.write = 1;
    ticks(11, 21);
    fail.short = 1;
    ticks(21, 31);
    log.close();
    const expected = Array.from({ length: 30 }, (_, i) => `{"tick":${i + 1},"inputs":[]}\n`);
    expect(readFileSync(join(dir, logName(1)), "utf8")).toBe(expected.join(""));
    expect(lines).toEqual([
      `could not write the input log ${logName(1)}: Error: EIO: i/o error, write`,
    ]);
  });

  it("sets a log it cannot read aside, and does not replace it", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(150);
    await live.stop({ save: false });
    servers.splice(servers.indexOf(live), 1);
    const name = logName(100);
    const text = readFileSync(join(dir, name), "utf8");
    fail.read = name;
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000100.json at tick 100",
      `could not read the input log ${name}: Error: EIO: i/o error, read`,
    ]);
    expect(again.world.tick).toBe(100);
    expect(readFileSync(join(dir, `${name}.bad`), "utf8")).toBe(text);
  });

  it("snapshots after a replay, so a server killed more often than the interval replays no more each start", async () => {
    const dir = tempDir();
    let server = await start(dir);
    const seen: string[][] = [];
    for (let kill = 0; kill < 3; kill++) {
      server.advance(60);
      await server.stop({ save: false });
      servers.splice(servers.indexOf(server), 1);
      const lines: string[] = [];
      server = await start(dir, {}, lines);
      seen.push(lines);
    }
    expect(seen).toEqual(
      [0, 60, 120].map((tick) => [
        `resumed ${snapshotName(tick)} at tick ${tick}`,
        `replayed 60 ticks of its input log, to tick ${tick + 60}`,
      ]),
    );
    const live = await start(tempDir());
    live.advance(180);
    expect(hashWorld(server.world)).toBe(hashWorld(live.world));
  });

  it("goes on from the older snapshot's log into the log of a newer snapshot it refused", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(250);
    await live.stop({ save: false });
    servers.splice(servers.indexOf(live), 1);
    writeFileSync(join(dir, snapshotName(200)), "{ not a snapshot");
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY }, lines);
    expect(lines).toEqual([
      `skipping snapshot ${snapshotName(200)}: snapshot is not valid JSON`,
      "resumed world-0000000000000100.json at tick 100",
      "replayed 100 ticks of its input log, to tick 200",
      `went on into the input log ${logName(200)}: 50 more ticks, to tick 250`,
    ]);
    expect(hashWorld(again.world)).toBe(hashWorld(live.world));
  });

  it("sets aside a refused snapshot's log that its replay fell short of, so a later start cannot go on into it", async () => {
    const dir = tempDir();
    // Life 1: snapshots at 1, 100 and 200, with chat.
    const first = await start(dir, { crowd: FIFTY });
    first.advance(250);
    await first.stop({ save: false });
    servers.splice(servers.indexOf(first), 1);
    const abandoned = readFileSync(join(dir, logName(200)), "utf8");
    writeFileSync(join(dir, snapshotName(200)), "{ not a snapshot");
    // Life 2: 200 is refused and 100's log cannot be read, so the world goes on
    // live from 100 with no chat, and is killed at 200 before it saves there.
    fail.read = logName(100);
    const second = await start(dir, { snapshotTicks: 1000 });
    second.advance(100);
    await second.stop({ save: false });
    servers.splice(servers.indexOf(second), 1);
    // Life 3 replays life 2's log to 200 and stops: life 1's log of 200 belongs to another history.
    const lines: string[] = [];
    const third = await start(dir, { snapshotTicks: 1000 }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000100.json at tick 100",
      "replayed 100 ticks of its input log, to tick 200",
    ]);
    expect(hashWorld(third.world)).toBe(hashWorld(second.world));
    expect(readFileSync(join(dir, `${logName(200)}.bad`), "utf8")).toBe(abandoned);
  });

  it("leaves a log it stops in at its name until the new log replaces it", async () => {
    const dir = tempDir();
    const live = await start(dir, { crowd: FIFTY });
    live.advance(150);
    await live.stop({ save: false });
    servers.splice(servers.indexOf(live), 1);
    const name = logName(100);
    const rows = readFileSync(join(dir, name), "utf8").split("\n");
    rows[30] = "not a line";
    const damaged = rows.join("\n");
    writeFileSync(join(dir, name), damaged);
    // A start killed after its replay and before it opens the new log.
    const resumed = loadNewest(dir, CONTENT, () => {});
    if (!resumed) throw new Error("no snapshot resumed");
    expect(replayLog(dir, resumed.world, () => {}).ticks).toBe(30);
    expect(readFileSync(join(dir, name), "utf8")).toBe(damaged);
    expect(readFileSync(join(dir, `${name}.bad`), "utf8")).toBe(damaged);
    // So the next start still has the lines before the bad one.
    const lines: string[] = [];
    const again = await start(dir, { crowd: FIFTY }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000100.json at tick 100",
      `the input log ${name} stops being usable at line 31; the rest is ignored`,
      "replayed 30 ticks of its input log, to tick 130",
    ]);
    expect(again.world.tick).toBe(130);
    expect(readFileSync(join(dir, `${name}.1.bad`), "utf8")).toBe(damaged);
  });

  it("sets aside the logs it finds when it starts a new world", async () => {
    const dir = tempDir();
    const old = await start(dir, { crowd: FIFTY });
    old.advance(150);
    await old.stop({ save: false });
    servers.splice(servers.indexOf(old), 1);
    const before = readFileSync(join(dir, logName(100)), "utf8");
    for (const file of listSnapshots(dir)) unlinkSync(join(dir, file));
    // A new world killed at tick 100, the old world's snapshot tick, before it saved there.
    const fresh = await start(dir, { seed: 9, snapshotTicks: 1000 });
    fresh.advance(100);
    await fresh.stop({ save: false });
    servers.splice(servers.indexOf(fresh), 1);
    const lines: string[] = [];
    const again = await start(dir, { seed: 9, snapshotTicks: 1000 }, lines);
    expect(lines).toEqual([
      "resumed world-0000000000000000.json at tick 0",
      "replayed 100 ticks of its input log, to tick 100",
    ]);
    expect(hashWorld(again.world)).toBe(hashWorld(fresh.world));
    expect(readFileSync(join(dir, `${logName(100)}.bad`), "utf8")).toBe(before);
  });

  it("keeps a log beside each snapshot kept, and deletes it with its snapshot", async () => {
    const dir = tempDir();
    const server = await start(dir);
    server.advance(550);
    expect(logs(dir)).toEqual([300, 400, 500].map(logName));
    await server.stop();
    servers.length = 0;
    expect(logs(dir)).toEqual([400, 500, 550].map(logName));
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
