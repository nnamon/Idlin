import { type ChildProcess, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { Chat } from "@idlin/chat";
import {
  type Actor,
  ADVENTURER,
  aboard,
  type Blow,
  blowsOf,
  compileBots,
  createCity,
  deckMap,
  hashWorld,
  placeConstants,
  readMessage,
  restore,
  SNAPSHOT_VERSION,
  snapshot,
  step,
  viewerMessage,
  type World,
  walkable,
} from "@idlin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { botSources, campMonsters } from "../../sim/src/testing.ts";
import { loadContent, loadCrowd } from "./content.ts";
import { logName } from "./inputlog.ts";
import {
  CLOSE_DEADLINE_MS,
  MAX_VIEWERS,
  type ServerOptions,
  VIEWER_ORIGINS,
  viewerOrigins,
  WorldServer,
} from "./server.ts";
import { listSnapshots, saveSnapshot, snapshotName } from "./store.ts";

/** Set to make every link and copy fail, so no snapshot can be set aside. */
const refuse = vi.hoisted(() => ({ setAside: false }));

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const refused = (): never => {
    throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
  };
  const linkSync: typeof fs.linkSync = (from, to) =>
    refuse.setAside ? refused() : fs.linkSync(from, to);
  const copyFileSync: typeof fs.copyFileSync = (from, to, mode) =>
    refuse.setAside ? refused() : fs.copyFileSync(from, to, mode);
  return { ...fs, default: { ...fs, linkSync, copyFileSync }, linkSync, copyFileSync };
});

const CONTENT = loadContent();
/** A snapshot read with the shipped content, as the server and the viewer read it. */
const read = (text: string): World => restore(text, null, CONTENT.programs, CONTENT.kinds);
const SEED = 5;
/** The servers here hear the 15-chatter crowd as their chat, so the city has citizens. */
const CROWD = loadCrowd("crowd-15");

const dirs: string[] = [];
const servers: WorldServer[] = [];
afterEach(async () => {
  refuse.setAside = false;
  for (const server of servers.splice(0)) await server.stop({ save: false });
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "idlin-server-"));
  dirs.push(dir);
  return dir;
};

const start = async (
  dataDir: string,
  lines: string[] = [],
  snapshotTicks = 100,
  extra: Partial<ServerOptions> & { quiet?: boolean } = {},
) => {
  const { quiet = false, ...rest } = extra;
  const server = await WorldServer.start({
    dataDir,
    port: 0,
    host: "127.0.0.1",
    seed: SEED,
    ...(quiet ? {} : { crowd: CROWD }),
    snapshotTicks,
    log: (line) => lines.push(line),
    content: CONTENT,
    ...rest,
  });
  servers.push(server);
  return server;
};

/** The hash of `world` as a viewer is sent it, without the orders it draws nothing from. */
const seenHash = (world: World): string =>
  hashWorld(readMessage(viewerMessage(world, []), null, CONTENT.programs, CONTENT.kinds).world);

/**
 * The city a new server starts, stepped on to `tick` with the crowd's chat
 * (or none, `quiet`), without a server.
 */
const reference = (tick: number, quiet = false): World => {
  const world = createCity(SEED, CONTENT.programs, CONTENT.kinds);
  const chat = new Chat({ ...(quiet ? {} : { crowd: CROWD }), start: 0 });
  while (world.tick < tick) step(world, chat.take(world.tick));
  return world;
};

const tickOf = (name: string): number => Number(name.slice(6, -5));

/** A viewer: connects and keeps every world it is sent. */
const viewer = async (port: number, origin?: string) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
  const worlds: World[] = [];
  const waiting: { tick: number; resolve: () => void }[] = [];
  socket.on("message", (data) => {
    // As the viewer reads it.
    const { world } = readMessage(String(data), null, CONTENT.programs, CONTENT.kinds);
    worlds.push(world);
    for (const wait of waiting.filter((w) => world.tick >= w.tick)) wait.resolve();
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return {
    socket,
    worlds,
    /** Resolves once a world at or past `tick` has arrived. */
    reach: (tick: number): Promise<void> =>
      (worlds.at(-1)?.tick ?? -1) >= tick
        ? Promise.resolve()
        : new Promise((resolve) => waiting.push({ tick, resolve })),
    close: () => socket.close(),
  };
};

describe("world server", () => {
  it("snapshots on an interval and keeps the newest three", async () => {
    const dir = tempDir();
    const server = await start(dir);
    server.advance(550);
    expect(listSnapshots(dir).map(tickOf)).toEqual([500, 400, 300]);
    expect(await server.stop()).toBe(true);
    servers.length = 0;
    expect(listSnapshots(dir).map(tickOf)).toEqual([550, 500, 400]);
  });

  it("after a kill, resumes from the last snapshot and its log and runs on as if never stopped", async () => {
    // A crowd's timeline starts with the server, so these hear no chat: a
    // resumed server would hear the crowd from its own start again.
    const dir = tempDir();
    const first = await start(dir, [], 100, { quiet: true });
    first.advance(350);
    // As if killed: no save on the way down.
    await first.stop({ save: false });
    servers.length = 0;

    const lines: string[] = [];
    const second = await start(dir, lines, 100, { quiet: true });
    expect(lines).toEqual([
      "resumed world-0000000000000300.json at tick 300",
      "replayed 50 ticks of its input log, to tick 350",
    ]);
    expect(hashWorld(second.world)).toBe(hashWorld(reference(350, true)));
    // On past legs-plant and the ramp coming down.
    second.advance(1750);
    expect(second.world.cycle?.landing).toEqual(reference(2100, true).cycle?.landing);
    expect(hashWorld(second.world)).toBe(hashWorld(reference(2100, true)));
  });

  it("skips a damaged snapshot, or one of another version, for the one before, saying why", async () => {
    const dir = tempDir();
    const first = await start(dir);
    first.advance(350);
    await first.stop({ save: false });
    servers.length = 0;
    const [newest, middle] = listSnapshots(dir) as [string, string];

    // The newest is cut short, as by a full disk; the one before has a version this build does not know.
    const text = readFileSync(join(dir, newest), "utf8");
    writeFileSync(join(dir, newest), text.slice(0, text.length / 2));
    const data = JSON.parse(readFileSync(join(dir, middle), "utf8"));
    writeFileSync(join(dir, middle), JSON.stringify({ ...data, version: SNAPSHOT_VERSION + 1 }));

    const lines: string[] = [];
    const second = await start(dir, lines);
    expect(lines).toEqual([
      "skipping snapshot world-0000000000000300.json: snapshot is not valid JSON",
      `skipping snapshot world-0000000000000200.json: snapshot version ${SNAPSHOT_VERSION + 1} is not ${SNAPSHOT_VERSION}`,
      "resumed world-0000000000000100.json at tick 100",
      "replayed 100 ticks of its input log, to tick 200",
      `went on into the input log ${logName(200)}: 100 more ticks, to tick 300`,
      `went on into the input log ${logName(300)}: 50 more ticks, to tick 350`,
    ]);
    // Each log runs up to the snapshot after it, so the refused ones' logs carry the world on.
    expect(hashWorld(second.world)).toBe(hashWorld(reference(350)));
    // Refused files are kept aside and not tried again.
    expect(readdirSync(dir).filter((f) => f.endsWith(".bad"))).toHaveLength(2);
  });

  it("skips a snapshot whose contents do not match its hash", async () => {
    const dir = tempDir();
    const first = await start(dir);
    first.advance(250);
    await first.stop({ save: false });
    servers.length = 0;
    const [newest] = listSnapshots(dir) as [string];
    // Only the stored hash changes, so nothing but the comparison can catch it.
    const data = JSON.parse(readFileSync(join(dir, newest), "utf8"));
    data.hash = hashWorld(reference(1));
    writeFileSync(join(dir, newest), JSON.stringify(data));

    const lines: string[] = [];
    const second = await start(dir, lines);
    expect(lines[0]).toBe(
      "skipping snapshot world-0000000000000200.json: snapshot contents are damaged",
    );
    expect(lines[1]).toBe("resumed world-0000000000000100.json at tick 100");
    expect(hashWorld(second.world)).toBe(hashWorld(reference(250)));
  });

  it("goes on to an older snapshot when a bad one cannot be set aside, and does not save over it", async () => {
    const dir = tempDir();
    const first = await start(dir);
    first.advance(250);
    await first.stop({ save: false });
    servers.length = 0;
    const [newest] = listSnapshots(dir) as [string];
    writeFileSync(join(dir, newest), "{ not a snapshot");
    // Without its log the older snapshot resumes at its own tick, so the next save lands on the bad one's name.
    rmSync(join(dir, logName(100)));
    refuse.setAside = true;

    const lines: string[] = [];
    const second = await start(dir, lines);
    expect(lines[0]).toBe(`skipping snapshot ${newest}: snapshot is not valid JSON`);
    expect(lines[1]).toMatch(new RegExp(`^could not set ${newest} aside as ${newest}\\.bad: `));
    expect(lines[2]).toBe("resumed world-0000000000000100.json at tick 100");
    // Its log is past where this start goes on from, so it is set aside too, and that fails as well.
    expect(lines[3]).toMatch(
      new RegExp(`^could not set ${logName(200)} aside as ${logName(200)}\\.bad: `),
    );
    expect(hashWorld(second.world)).toBe(hashWorld(reference(100)));
    // The save that lands on its name is refused and logged; the world runs on.
    second.advance(100);
    expect(lines[4]).toBe(
      `snapshot at tick 200 failed: Error: ${newest} holds a refused snapshot that could not be set aside`,
    );
    expect(readFileSync(join(dir, newest), "utf8")).toBe("{ not a snapshot");
  });

  // Other ways setting aside can fail are tested in store.test.ts.

  it("takes only plain files as snapshots, and writes through no symlink", async () => {
    const dir = tempDir();
    const outside = tempDir();
    const world = reference(1);
    expect(saveSnapshot(dir, world)).toBe(snapshotName(1));
    mkdirSync(join(dir, snapshotName(900)));
    writeFileSync(join(outside, "target"), "untouched");
    symlinkSync(join(outside, "target"), join(dir, snapshotName(901)));
    expect(listSnapshots(dir)).toEqual([snapshotName(1)]);

    // A symlink planted at the temporary name is replaced, not followed.
    const later = reference(5);
    symlinkSync(join(outside, "target"), join(dir, `.${snapshotName(5)}.tmp`));
    saveSnapshot(dir, later);
    expect(readFileSync(join(outside, "target"), "utf8")).toBe("untouched");
    expect(listSnapshots(dir)).toEqual([snapshotName(5), snapshotName(1)]);
    expect(hashWorld(read(readFileSync(join(dir, snapshotName(5)), "utf8")))).toBe(
      hashWorld(later),
    );
  });

  it("after a failed save, tries again an interval later and not on every tick", async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const server = await start(dir, lines);
    // The data directory turns into a file: every write fails.
    rmSync(dir, { recursive: true });
    writeFileSync(dir, "");
    server.advance(350);
    expect(lines.filter((line) => line.includes("failed"))).toEqual([
      expect.stringMatching(/^snapshot at tick 100 failed: /),
      expect.stringMatching(/^snapshot at tick 200 failed: /),
      expect.stringMatching(/^snapshot at tick 300 failed: /),
    ]);
    expect(await server.stop()).toBe(false);
    servers.length = 0;
    rmSync(dir);
  });

  it("starts a new city in a data folder of the camp world, setting its files aside", async () => {
    const dir = tempDir();
    // As the camp world saved them: version 12, a snapshot and its log.
    const camp = JSON.stringify({ version: 12, map: "0", hash: "0", state: { tick: 900 } });
    writeFileSync(join(dir, snapshotName(900)), camp);
    writeFileSync(join(dir, logName(900)), '{"tick":900,"inputs":[]}\n');
    const lines: string[] = [];
    const server = await start(dir, lines);
    expect(lines).toEqual([
      `skipping snapshot ${snapshotName(900)}: snapshot version 12 is of the camp world, which this build no longer runs; a new city starts in its place`,
      `no snapshot to resume; new city from seed ${SEED}`,
    ]);
    expect(server.world.tick).toBe(0);
    expect(hashWorld(server.world)).toBe(hashWorld(reference(0)));
    // Nothing is deleted: both old files are kept under `.bad` names.
    expect(
      readdirSync(dir)
        .filter((f) => f.endsWith(".bad"))
        .sort(),
    ).toEqual([`${snapshotName(900)}.bad`, `${logName(900)}.bad`]);
    expect(readFileSync(join(dir, `${snapshotName(900)}.bad`), "utf8")).toBe(camp);
  });

  it("starts a new city when there is no snapshot", async () => {
    const lines: string[] = [];
    const server = await start(tempDir(), lines);
    expect(lines[0]).toBe(`no snapshot to resume; new city from seed ${SEED}`);
    expect(hashWorld(server.world)).toBe(hashWorld(reference(0)));
    // It is the city: on its deck, with its cycle from 0:00.
    expect(server.world.cycle?.start).toBe(0);
    expect(server.world.atlas.map).toBe(deckMap(1));
  });

  it("keeps a world through a program edit: citizens keep their places and levels", async () => {
    const dir = tempDir();
    const world = reference(3000);
    // Levels from a long life, so there is something to lose.
    world.actors.forEach((actor, n) => {
      if (actor.kind === ADVENTURER) actor.xp = actor.xp.map((_, skill) => 1000 * (n + skill + 1));
    });
    saveSnapshot(dir, world);
    const sources = botSources();
    const edited = sources.deckhand?.replace("wander; wait(20)", "wander; wait(21)") as string;
    expect(edited).not.toBe(sources.deckhand);
    const content = {
      ...CONTENT,
      programs: {
        ...CONTENT.programs,
        ...compileBots({ deckhand: edited }, placeConstants(deckMap(1))),
      },
    };
    const deckhands = world.actors.filter((actor) => actor.program === "deckhand").length;
    expect(deckhands).toBeGreaterThan(10);

    const lines: string[] = [];
    const server = await start(dir, lines, 100, { content });
    expect(lines).toEqual([
      "snapshot world-0000000000003000.json was taken with other content; keeping its world:",
      "  the programs have changed",
      `  cleared the memory and rule of ${deckhands} actor(s) running "deckhand"`,
      "resumed world-0000000000003000.json at tick 3000",
    ]);
    expect(server.world.tick).toBe(3000);
    const kept = (actor: Actor) => [actor.id, actor.name, actor.x, actor.y, actor.hp, actor.xp];
    expect(server.world.actors.map(kept)).toEqual(world.actors.map(kept));
    expect(server.world.actors.filter((a) => a.kind === ADVENTURER).length).toBe(deckhands);
    // It runs on and saves with the new content.
    server.advance(100);
    const saved = readFileSync(join(dir, snapshotName(3100)), "utf8");
    expect(hashWorld(restore(saved, null, content.programs, content.kinds))).toBe(
      hashWorld(server.world),
    );
  });

  it("sends the world on connect and after every tick; a late viewer sees what an early one sees", async () => {
    const server = await start(tempDir());
    const early = await viewer(server.port);
    await early.reach(0);
    server.advance(200);
    const late = await viewer(server.port);
    await late.reach(200);
    server.advance(50);
    await Promise.all([early.reach(250), late.reach(250)]);

    expect(early.worlds.map((w) => w.tick)).toEqual(Array.from({ length: 251 }, (_, i) => i));
    expect(late.worlds[0]?.tick).toBe(200);
    const truth = seenHash(server.world);
    expect(hashWorld(early.worlds.at(-1) as World)).toBe(truth);
    expect(hashWorld(late.worlds.at(-1) as World)).toBe(truth);
    for (const world of late.worlds) {
      expect(hashWorld(world)).toBe(hashWorld(early.worlds[world.tick] as World));
    }
    early.close();
    late.close();
  });

  it("sends each tick's blows with its world, and none with the world sent on connect", async () => {
    // No landing has monsters until slice piece 5, so this city has the camp's
    // wolves put on its landing by hand, by a crowd of citizens out on it.
    const beasts = campMonsters();
    const content = {
      programs: { ...CONTENT.programs, ...beasts.programs },
      kinds: beasts.kinds,
    };
    const city = createCity(SEED, content.programs, content.kinds);
    const chat = new Chat({ crowd: CROWD, start: 0 });
    while (city.tick < 2400) step(city, chat.take(city.tick));
    const { atlas } = city;
    const open: { x: number; y: number }[] = [];
    for (const citizen of city.actors) {
      for (const [dx, dy] of [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ] as const) {
        const at = { x: citizen.x + dx, y: citizen.y + dy };
        if (!walkable(atlas, at.x, at.y) || aboard(atlas, at.x, at.y)) continue;
        if (city.actors.some((a) => a.x === at.x && a.y === at.y)) continue;
        if (!open.some((p) => p.x === at.x && p.y === at.y)) open.push(at);
      }
    }
    step(
      city,
      open
        .slice(0, 12)
        .map((at) => ({ type: "spawn", name: "Wolf", program: "wolf", kind: "wolf", ...at })),
    );
    expect(city.actors.filter((a) => a.kind === "wolf").length).toBeGreaterThan(4);
    const dir = tempDir();
    saveSnapshot(dir, city);
    const server = await start(dir, [], 100, { content, quiet: true });
    // Only the blows are read here: restoring thousands of worlds would take too long.
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const sent: unknown[] = [];
    socket.on("message", (data) => sent.push(JSON.parse(String(data)).blows));
    await new Promise((resolve) => socket.once("open", resolve));
    // In batches that stay well inside what the server queues for a viewer before dropping it.
    const ticks = 1_000;
    for (let done = 0; done < ticks; done += 50) {
      server.advance(50);
      await vi.waitFor(() => expect(sent).toHaveLength(done + 51));
    }
    expect(sent[0]).toEqual([]);
    // The same world stepped without a server makes the same blows on each tick.
    const world = restore(snapshot(city), null, content.programs, content.kinds);
    const made: (readonly Blow[])[] = [];
    while (world.tick < city.tick + ticks) made.push(blowsOf(step(world)));
    expect(sent.slice(1)).toEqual(made);
    expect(made.flat().length).toBeGreaterThan(0);
    socket.close();
  });

  it("drops a viewer that stops reading instead of queueing for it", async () => {
    const lines: string[] = [];
    const server = await start(tempDir(), lines);
    const stuck = await viewer(server.port);
    const reader = await viewer(server.port);
    await Promise.all([stuck.reach(0), reader.reach(0)]);
    stuck.socket.pause();
    const closed = new Promise((resolve) => stuck.socket.once("close", resolve));
    const dropped = () => lines.find((line) => line.startsWith("dropping a viewer"));
    // Each world is a few kilobytes; give the socket buffers time to fill between bursts.
    while (!dropped()) {
      server.advance(100);
      await reader.reach(server.world.tick);
      expect(server.world.tick).toBeLessThan(200_000);
    }
    // Dropped once a little over 1 MiB is queued: past the limit by no more than one world.
    const queued = Number(/\((\d+) bytes queued\)$/.exec(dropped() as string)?.[1]);
    expect(queued).toBeGreaterThan(1024 * 1024);
    expect(queued).toBeLessThan(1024 * 1024 + 20_000);
    stuck.socket.resume();
    await closed;
    server.advance(1);
    await reader.reach(server.world.tick);
    reader.close();
  }, 60_000);

  it("closes a viewer that sends a bad frame or too much, and keeps stepping", async () => {
    const lines: string[] = [];
    const server = await start(tempDir(), lines);
    const garbled = await viewer(server.port);
    const greedy = await viewer(server.port);
    const reader = await viewer(server.port);
    await Promise.all([garbled.reach(0), greedy.reach(0), reader.reach(0)]);
    const closed = (socket: WebSocket) => new Promise((resolve) => socket.once("close", resolve));
    const gone = [closed(garbled.socket), closed(greedy.socket)];
    // A final frame with opcode 15, which does not exist, written past the client's own checks.
    (garbled.socket as unknown as { _socket: Socket })._socket.write(
      Buffer.from([0x8f, 0x80, 0, 0, 0, 0]),
    );
    greedy.socket.send("x".repeat(4096));
    await Promise.all(gone);
    server.advance(5);
    await reader.reach(5);
    expect(lines.filter((line) => line.startsWith("closing a viewer: "))).toHaveLength(2);
    reader.close();
  });

  it(`lets in ${MAX_VIEWERS} viewers from the viewer's own page and no others`, async () => {
    const server = await start(tempDir());
    const refusal = (origin?: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${server.port}`, origin ? { origin } : {});
        socket.once("unexpected-response", (_, response) => resolve(response.statusCode ?? 0));
        socket.once("open", () => reject(new Error("let in")));
      });
    expect(await refusal("http://example.com")).toBe(403);
    expect(await refusal("http://localhost:4311")).toBe(403);
    const viewers = [await viewer(server.port, "http://localhost:4310")];
    while (viewers.length < MAX_VIEWERS) viewers.push(await viewer(server.port));
    expect(await refusal()).toBe(503);
    expect(await refusal("http://localhost:4310")).toBe(503);
    // A place frees up when one leaves.
    const leaving = viewers.pop();
    const left = new Promise((resolve) => leaving?.socket.once("close", resolve));
    leaving?.close();
    await left;
    await new Promise((resolve) => setTimeout(resolve, 50));
    viewers.push(await viewer(server.port));
    for (const each of viewers) each.close();
  });

  it("on stop, closes a connection that never asked for a WebSocket", async () => {
    const server = await start(tempDir());
    const idle = connect(server.port, "127.0.0.1");
    await new Promise((resolve) => idle.once("connect", resolve));
    const closed = new Promise((resolve) => idle.once("close", resolve));
    const from = Date.now();
    await server.stop({ save: false });
    servers.length = 0;
    expect(Date.now() - from).toBeLessThan(CLOSE_DEADLINE_MS);
    await closed;
  });

  it("stops after CLOSE_DEADLINE_MS even if a connection will not close", async () => {
    const lines: string[] = [];
    const server = await start(tempDir(), lines);
    const http = (server as unknown as { http: Server }).http;
    const close = http.close.bind(http);
    // As if some connection outlived every attempt to close it.
    http.close = () => http;
    const from = Date.now();
    expect(await server.stop()).toBe(true);
    servers.length = 0;
    expect(Date.now() - from).toBeGreaterThanOrEqual(CLOSE_DEADLINE_MS - 10);
    expect(lines.at(-1)).toBe(`connections still open after ${CLOSE_DEADLINE_MS} ms; leaving them`);
    await new Promise((resolve) => close(resolve));
  });

  it("yields between batches of catch-up however slow each tick is", async () => {
    // Each look at the clock finds a second gone: every tick seems to take that long.
    let clock = 0;
    const server = await start(tempDir(), [], 100, { now: () => (clock += 1000) });
    server.run();
    // How far the world moved each time the process got to do something else.
    const moves: number[] = [];
    let seen = server.world.tick;
    const deadline = Date.now() + 10_000;
    while (moves.length < 20 && Date.now() < deadline) {
      await new Promise((resolve) => setImmediate(resolve));
      if (server.world.tick !== seen) moves.push(server.world.tick - seen);
      seen = server.world.tick;
    }
    await server.stop({ save: false });
    expect(moves).toHaveLength(20);
    expect(Math.max(...moves)).toBe(1);
  });

  it("steps in real time", async () => {
    const server = await start(tempDir());
    const from = server.world.tick;
    server.run();
    await new Promise((resolve) => setTimeout(resolve, 1050));
    await server.stop({ save: false });
    // Ten ticks a second, give or take a timer's slack on a busy machine.
    expect(server.world.tick - from).toBeGreaterThanOrEqual(7);
    expect(server.world.tick - from).toBeLessThanOrEqual(13);
  });

  // The capture workflow runs 24 minutes of the city, two cycles; the gate runs six.
  const hours = process.env.IDLIN_LONG === "1" ? 24 : 6;
  it(`runs ${hours} minutes at speed with a viewer attached and memory stays flat`, async () => {
    setFlagsFromString("--expose-gc");
    const gc = runInNewContext("gc") as () => void;
    const heap = (): number => {
      gc();
      gc();
      return process.memoryUsage().heapUsed;
    };
    const server = await start(tempDir(), [], 600);
    const watcher = await viewer(server.port);
    // Only the newest world is kept, so the viewer itself holds no history.
    watcher.socket.on("message", () => watcher.worlds.splice(0, watcher.worlds.length - 1));
    const samples: number[] = [];
    const hour = 600;
    for (let h = 0; h < hours; h++) {
      for (let i = 0; i < hour; i += 50) {
        server.advance(50);
        await watcher.reach(server.world.tick);
      }
      samples.push(heap());
    }
    expect(server.world.tick).toBe(hours * hour);
    // Measured from the end of the first minute, once everything is warm.
    const [base, ...rest] = samples as [number, ...number[]];
    const growth = Math.max(...rest) - base;
    expect(
      growth,
      `heap after each hour: ${samples.map((s) => (s / 1e6).toFixed(1))} MB`,
    ).toBeLessThan(4_000_000);
    watcher.close();
  }, 120_000);
});

describe("viewerOrigins", () => {
  it("adds the trimmed, non-empty entries of IDLIN_ORIGINS to the defaults", () => {
    expect(viewerOrigins()).toEqual(VIEWER_ORIGINS);
    expect(viewerOrigins("")).toEqual(VIEWER_ORIGINS);
    expect(viewerOrigins(" , ,")).toEqual(VIEWER_ORIGINS);
    expect(
      viewerOrigins(" http://a.example:4310 ,, http://b.example ,http://localhost:4310"),
    ).toEqual([...VIEWER_ORIGINS, "http://a.example:4310", "http://b.example"]);
  });
});

describe("server process", () => {
  const MAIN = new URL("./main.ts", import.meta.url).pathname;
  const children: ChildProcess[] = [];
  afterEach(() => {
    // Whatever a test left running, even after a failed assertion.
    for (const child of children.splice(0)) if (child.exitCode === null) child.kill("SIGKILL");
  });

  /** Starts the server as a process; resolves with it and its port once it listens. */
  const launch = (dataDir: string, env: Record<string, string> = {}) => {
    const child = spawn(process.execPath, [MAIN], {
      env: {
        ...process.env,
        IDLIN_DATA: dataDir,
        IDLIN_PORT: "0",
        IDLIN_SEED: String(SEED),
        IDLIN_SNAPSHOT_TICKS: "5",
        ...env,
      },
      stdio: ["ignore", "pipe", "inherit"],
    });
    children.push(child);
    let out = "";
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    const listening = new Promise<number>((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        out += String(chunk);
        const port = /listening on [^:]+:(\d+)/.exec(out)?.[1];
        if (port) resolve(Number(port));
      });
      exited.then(() => reject(new Error(`server exited early: ${out}`)));
    });
    return { child, listening, exited, output: () => out };
  };

  /** Waits until `check` holds, for up to ten seconds. */
  const until = async (what: string, check: () => boolean): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  it("lets in a page from an Origin listed in IDLIN_ORIGINS and refuses one not listed", async () => {
    const server = launch(tempDir(), {
      IDLIN_ORIGINS: " http://viewer.example:4310,,http://other.example:4310 ",
    });
    const port = await server.listening;
    const outcome = (origin: string): Promise<number | "open"> =>
      new Promise((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
        socket.once("unexpected-response", (_, response) => resolve(response.statusCode ?? 0));
        socket.once("open", () => {
          socket.close();
          resolve("open");
        });
      });
    expect(await outcome("http://viewer.example:4310")).toBe("open");
    expect(await outcome("http://other.example:4310")).toBe("open");
    expect(await outcome("http://localhost:4310")).toBe("open");
    expect(await outcome("http://unlisted.example:4310")).toBe(403);
    expect(await outcome("http://viewer.example:4311")).toBe(403);
    server.child.kill("SIGTERM");
    expect(await server.exited).toBe(0);
  }, 30_000);

  it("killed outright, comes back from its last snapshot; stopped politely, saves first", async () => {
    const dir = tempDir();
    const first = launch(dir);
    await first.listening;
    await until("two snapshots", () => listSnapshots(dir).length >= 2);
    first.child.kill("SIGKILL");
    await first.exited;
    const last = listSnapshots(dir)[0] as string;

    const second = launch(dir);
    const port = await second.listening;
    expect(second.output()).toContain(`resumed ${last} at tick ${tickOf(last)}`);
    const watcher = await viewer(port);
    await watcher.reach(tickOf(last));
    const shown = watcher.worlds[0] as World;
    expect(shown.tick).toBeGreaterThanOrEqual(tickOf(last));
    expect(hashWorld(shown)).toBe(seenHash(reference(shown.tick)));
    watcher.close();

    second.child.kill("SIGTERM");
    expect(await second.exited).toBe(0);
    const saved = /SIGTERM: saved at tick (\d+)/.exec(second.output())?.[1];
    expect(listSnapshots(dir)[0]).toBe(`world-${String(saved).padStart(16, "0")}.json`);
  }, 30_000);

  it("saves when stopped the moment it says it is listening", async () => {
    const dir = tempDir();
    const server = launch(dir);
    await server.listening;
    server.child.kill("SIGTERM");
    expect(await server.exited).toBe(0);
    const saved = /SIGTERM: saved at tick (\d+)/.exec(server.output())?.[1];
    expect(listSnapshots(dir)[0]).toBe(`world-${String(saved).padStart(16, "0")}.json`);
  }, 30_000);

  it("stops with a connection open that never asked for a WebSocket", async () => {
    const dir = tempDir();
    const server = launch(dir);
    const port = await server.listening;
    const idle = connect(port, "127.0.0.1");
    idle.on("error", () => {});
    await new Promise((resolve) => idle.once("connect", resolve));
    const from = Date.now();
    server.child.kill("SIGTERM");
    expect(await server.exited).toBe(0);
    expect(Date.now() - from).toBeLessThan(CLOSE_DEADLINE_MS);
    idle.destroy();
  }, 30_000);

  it("exits with 1 and says so when the snapshot on the way down cannot be written", async () => {
    const dir = tempDir();
    const server = launch(dir);
    await server.listening;
    // A first snapshot means it is stepping, and so has its signal handlers.
    await until("a snapshot", () => listSnapshots(dir).length >= 1);
    rmSync(dir, { recursive: true });
    writeFileSync(dir, "");
    server.child.kill("SIGTERM");
    expect(await server.exited).toBe(1);
    expect(server.output()).toMatch(/SIGTERM: stopped at tick \d+; the snapshot was not saved/);
    expect(server.output()).not.toMatch(/SIGTERM: saved/);
  }, 30_000);
});
