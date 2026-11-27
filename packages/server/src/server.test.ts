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
import {
  type Actor,
  ADVENTURER,
  createWorld,
  GROUP_SPREAD,
  hashWorld,
  restore,
  SNAPSHOT_VERSION,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
  type World,
} from "@idlin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { castOf } from "../../client/src/cast.ts";
import { shippedPrograms as botPrograms } from "../../sim/src/testing.ts";
import { loadContent } from "./content.ts";
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
const read = (text: string): World =>
  restore(text, CONTENT.atlas, CONTENT.programs, CONTENT.kinds, CONTENT.spawns);
const SEED = 5;
const RESIDENTS = 6;

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
  extra: Partial<ServerOptions> = {},
) => {
  const server = await WorldServer.start({
    dataDir,
    port: 0,
    host: "127.0.0.1",
    seed: SEED,
    residents: RESIDENTS,
    snapshotTicks,
    log: (line) => lines.push(line),
    content: CONTENT,
    ...extra,
  });
  servers.push(server);
  return server;
};

/** The world a new server starts, stepped on to `tick`, without a server. */
const reference = (tick: number): World => {
  const world = createWorld(CONTENT.atlas, SEED, CONTENT.programs, CONTENT.kinds, CONTENT.spawns);
  step(world, spawnsNearCamp(world, castOf(RESIDENTS)));
  while (world.tick < tick) step(world);
  return world;
};

const tickOf = (name: string): number => Number(name.slice(6, -5));

/** A viewer: connects and keeps every world it is sent. */
const viewer = async (port: number, origin?: string) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
  const worlds: World[] = [];
  const waiting: { tick: number; resolve: () => void }[] = [];
  socket.on("message", (data) => {
    const world = read(String(data));
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
    expect(listSnapshots(dir).map(tickOf)).toEqual([501, 401, 301]);
    expect(await server.stop()).toBe(true);
    servers.length = 0;
    expect(listSnapshots(dir).map(tickOf)).toEqual([551, 501, 401]);
  });

  it("after a kill, resumes from the last snapshot and runs on as if never stopped", async () => {
    const dir = tempDir();
    const first = await start(dir);
    first.advance(350);
    // As if killed: no save on the way down.
    await first.stop({ save: false });
    servers.length = 0;

    const lines: string[] = [];
    const second = await start(dir, lines);
    expect(lines[0]).toBe("resumed world-0000000000000301.json at tick 301");
    expect(hashWorld(second.world)).toBe(hashWorld(reference(301)));
    second.advance(700);
    expect(hashWorld(second.world)).toBe(hashWorld(reference(1001)));
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
    expect(lines.slice(0, 3)).toEqual([
      "skipping snapshot world-0000000000000301.json: snapshot is not valid JSON",
      `skipping snapshot world-0000000000000201.json: snapshot version ${SNAPSHOT_VERSION + 1} is not 4 to ${SNAPSHOT_VERSION}`,
      "resumed world-0000000000000101.json at tick 101",
    ]);
    expect(hashWorld(second.world)).toBe(hashWorld(reference(101)));
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
      "skipping snapshot world-0000000000000201.json: snapshot contents are damaged",
    );
    expect(second.world.tick).toBe(101);
  });

  it("goes on to an older snapshot when a bad one cannot be set aside, and does not save over it", async () => {
    const dir = tempDir();
    const first = await start(dir);
    first.advance(250);
    await first.stop({ save: false });
    servers.length = 0;
    const [newest] = listSnapshots(dir) as [string];
    writeFileSync(join(dir, newest), "{ not a snapshot");
    refuse.setAside = true;

    const lines: string[] = [];
    const second = await start(dir, lines);
    expect(lines[0]).toBe(`skipping snapshot ${newest}: snapshot is not valid JSON`);
    expect(lines[1]).toMatch(new RegExp(`^could not set ${newest} aside as ${newest}\\.bad: `));
    expect(lines[2]).toBe("resumed world-0000000000000101.json at tick 101");
    expect(hashWorld(second.world)).toBe(hashWorld(reference(101)));
    // The save that lands on its name is refused and logged; the world runs on.
    second.advance(100);
    expect(lines[3]).toBe(
      `snapshot at tick 201 failed: Error: ${newest} holds a refused snapshot that could not be set aside`,
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
      expect.stringMatching(/^snapshot at tick 101 failed: /),
      expect.stringMatching(/^snapshot at tick 201 failed: /),
      expect.stringMatching(/^snapshot at tick 301 failed: /),
    ]);
    expect(await server.stop()).toBe(false);
    servers.length = 0;
    rmSync(dir);
  });

  it("starts a new world when there is no snapshot", async () => {
    const lines: string[] = [];
    const server = await start(tempDir(), lines);
    expect(lines[0]).toBe(`no snapshot to resume; new world from seed ${SEED}`);
    expect(hashWorld(server.world)).toBe(hashWorld(reference(1)));
  });

  it("runs the shipped monsters: one comes at its spawn place within a game day, and viewers see it", async () => {
    const server = await start(tempDir());
    expect(Object.keys(server.world.kinds).sort()).toEqual(["goblin", "wolf"]);
    expect(server.world.spawns.map((spawn) => spawn.kind).sort()).toEqual(["goblin", "wolf"]);
    // Looked at on the tick it came, before it has walked anywhere. With seed 5 a
    // group of goblins comes to the den on the first tick, with the residents.
    const first = (): Actor | undefined =>
      server.world.actors.find((actor) => actor.kind !== ADVENTURER);
    let monster = first();
    while (!monster && server.world.tick <= TICKS_PER_DAY) {
      server.advance(1);
      monster = first();
    }
    expect(monster, "no monster came in a game day").toBeDefined();
    const { x, y, id, kind } = monster as Actor;
    const spawn = server.world.spawns.find((each) => each.kind === kind);
    const places = [...(spawn?.day ?? []), ...(spawn?.night ?? [])];
    const nearest = Math.min(...places.map((p) => Math.abs(x - p.x) + Math.abs(y - p.y)));
    expect(nearest).toBeLessThanOrEqual(GROUP_SPREAD);
    // A viewer that connects now is sent the world with the monster in it, and can read it.
    const watcher = await viewer(server.port);
    await watcher.reach(server.world.tick);
    expect(watcher.worlds.at(-1)?.actors.find((actor) => actor.id === id)?.kind).toBe(kind);
    watcher.close();
  });

  it("sets aside a snapshot saved without monsters and starts a new world with them", async () => {
    const dir = tempDir();
    const without = createWorld(CONTENT.atlas, SEED, botPrograms());
    step(without, spawnsNearCamp(without, castOf(RESIDENTS)));
    while (without.tick < 500) step(without);
    saveSnapshot(dir, without);

    const lines: string[] = [];
    const server = await start(dir, lines);
    expect(lines.slice(0, 2)).toEqual([
      "skipping snapshot world-0000000000000500.json: snapshot was taken with different programs",
      `no snapshot to resume; new world from seed ${SEED}`,
    ]);
    expect(readdirSync(dir)).toContain("world-0000000000000500.json.bad");
    expect(hashWorld(server.world)).toBe(hashWorld(reference(1)));
  });

  it("sends the world on connect and after every tick; a late viewer sees what an early one sees", async () => {
    const server = await start(tempDir());
    const early = await viewer(server.port);
    await early.reach(1);
    server.advance(200);
    const late = await viewer(server.port);
    await late.reach(201);
    server.advance(50);
    await Promise.all([early.reach(251), late.reach(251)]);

    expect(early.worlds.map((w) => w.tick)).toEqual(Array.from({ length: 251 }, (_, i) => i + 1));
    expect(late.worlds[0]?.tick).toBe(201);
    const truth = hashWorld(server.world);
    expect(hashWorld(early.worlds.at(-1) as World)).toBe(truth);
    expect(hashWorld(late.worlds.at(-1) as World)).toBe(truth);
    for (const world of late.worlds) {
      expect(hashWorld(world)).toBe(hashWorld(early.worlds[world.tick - 1] as World));
    }
    early.close();
    late.close();
  });

  it("drops a viewer that stops reading instead of queueing for it", async () => {
    const lines: string[] = [];
    const server = await start(tempDir(), lines);
    const stuck = await viewer(server.port);
    const reader = await viewer(server.port);
    await Promise.all([stuck.reach(1), reader.reach(1)]);
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
    await Promise.all([garbled.reach(1), greedy.reach(1), reader.reach(1)]);
    const closed = (socket: WebSocket) => new Promise((resolve) => socket.once("close", resolve));
    const gone = [closed(garbled.socket), closed(greedy.socket)];
    // A final frame with opcode 15, which does not exist, written past the client's own checks.
    (garbled.socket as unknown as { _socket: Socket })._socket.write(
      Buffer.from([0x8f, 0x80, 0, 0, 0, 0]),
    );
    greedy.socket.send("x".repeat(4096));
    await Promise.all(gone);
    server.advance(5);
    await reader.reach(6);
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

  // The capture workflow runs the whole day; the gate runs six hours of it.
  const hours = process.env.IDLIN_LONG === "1" ? 24 : 6;
  it(`runs ${hours} game hours at speed with a viewer attached and memory stays flat`, async () => {
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
    const hour = TICKS_PER_DAY / 24;
    for (let h = 0; h < hours; h++) {
      for (let i = 0; i < hour; i += 50) {
        server.advance(50);
        await watcher.reach(server.world.tick);
      }
      samples.push(heap());
    }
    expect(server.world.tick).toBe(1 + hours * hour);
    // Measured from the end of the first hour, once everything is warm.
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
    expect(hashWorld(shown)).toBe(hashWorld(reference(shown.tick)));
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
