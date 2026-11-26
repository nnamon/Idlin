// The world as a running process: steps it in real time, saves it on an
// interval and on stop, and streams it to viewers over a WebSocket. Every
// message a viewer receives is the sim's snapshot text of the world after a
// tick: the first on connect, then one per tick.
import { mkdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createWorld,
  snapshot,
  spawnsNearCamp,
  step,
  TICKS_PER_SECOND,
  type World,
} from "@idlin/sim";
import { WebSocket, WebSocketServer } from "ws";
import { castOf } from "../../client/src/cast.ts";
import { type Content, loadContent } from "./content.ts";
import { Pacer } from "./pacer.ts";
import { loadNewest, saveSnapshot } from "./store.ts";

export const TICK_MS = 1000 / TICKS_PER_SECOND;

/**
 * A viewer this far behind on reading (in bytes queued) is dropped rather than
 * buffered for. A message is about 2 KB with six residents and up to about
 * 67 KB with 150, so this is fifteen or more messages, and MAX_VIEWERS of them
 * stay far inside the server's memory limit.
 */
export const MAX_QUEUED_BYTES = 1024 * 1024;

/** Viewers connected at once; past this a new one is refused. */
export const MAX_VIEWERS = 16;

/** Wall time one wake spends stepping before it lets the process do anything else. */
export const BUDGET_MS = 50;

/** How long stop waits for connections to close before it gives up on them. */
export const CLOSE_DEADLINE_MS = 1000;

/** Pages allowed to connect: the viewer as `docker compose up client` serves it. */
export const VIEWER_ORIGINS: readonly string[] = ["http://localhost:4310", "http://127.0.0.1:4310"];

export interface ServerOptions {
  /** Where snapshots are kept; created if missing. */
  readonly dataDir: string;
  /** 0 picks a free port. */
  readonly port: number;
  readonly host: string;
  /** For a new world, when there is no snapshot to resume. */
  readonly seed: number;
  /** Residents of a new world. */
  readonly residents: number;
  /** Ticks between snapshots. */
  readonly snapshotTicks: number;
  readonly log: (line: string) => void;
  readonly content?: Content;
  /** Origins a browser may connect from (default VIEWER_ORIGINS). A client that sends none is let in. */
  readonly origins?: readonly string[];
  /** Milliseconds, for pacing (default `performance.now`). */
  readonly now?: () => number;
}

export class WorldServer {
  readonly world: World;
  private readonly options: ServerOptions;
  private readonly http: Server;
  private readonly sockets: WebSocketServer;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private savedTick: number;

  private constructor(
    world: World,
    options: ServerOptions,
    http: Server,
    sockets: WebSocketServer,
  ) {
    this.world = world;
    this.options = options;
    this.http = http;
    this.sockets = sockets;
    this.now = options.now ?? (() => performance.now());
    this.savedTick = world.tick;
    sockets.on("connection", (socket) => {
      // A bad frame or a message over maxPayload is reported here; without a
      // listener it would take the whole process down.
      let failed = false;
      socket.on("error", (error) => {
        if (!failed) options.log(`closing a viewer: ${error.message}`);
        failed = true;
        socket.terminate();
      });
      // Viewers only listen; anything they send is ignored.
      socket.send(snapshot(this.world));
    });
    sockets.on("error", (error) => options.log(`server socket: ${error.message}`));
  }

  /**
   * Resumes the newest valid snapshot in the data directory, or starts a new
   * world, and listens. It does not log that it listens; the caller says so
   * once it is ready to be stopped.
   */
  static async start(options: ServerOptions): Promise<WorldServer> {
    const content = options.content ?? loadContent();
    mkdirSync(options.dataDir, { recursive: true });
    const resumed = loadNewest(options.dataDir, content, options.log);
    let world: World;
    if (resumed) {
      world = resumed.world;
      options.log(`resumed ${resumed.file} at tick ${world.tick}`);
    } else {
      world = createWorld(content.map, options.seed, content.programs);
      step(world, spawnsNearCamp(world, castOf(options.residents)));
      options.log(`no snapshot to resume; new world from seed ${options.seed}`);
    }
    const origins = options.origins ?? VIEWER_ORIGINS;
    // The HTTP server is our own so that stop can close connections that never
    // asked for a WebSocket; one left open would keep it from closing.
    const http = createServer((_, response) => {
      response.writeHead(426).end();
    });
    const sockets: WebSocketServer = new WebSocketServer({
      server: http,
      maxPayload: 1024,
      verifyClient: ({ origin }, accept) => {
        // Browsers always send an Origin; other pages must not be able to read the world.
        if (origin && !origins.includes(origin)) accept(false, 403);
        else if (sockets.clients.size >= MAX_VIEWERS) accept(false, 503);
        else accept(true);
      },
    });
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(options.port, options.host, () => {
        http.off("error", reject);
        resolve();
      });
    });
    return new WorldServer(world, options, http, sockets);
  }

  get port(): number {
    return (this.http.address() as AddressInfo).port;
  }

  /** Steps the world `ticks` times now, saving and sending as it goes. */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /**
   * Steps the world in real time until stopped. A wake runs the ticks owed, but
   * stops after BUDGET_MS of work and carries the rest to the next wake, which
   * comes straight after, so signals and connections are seen between batches.
   */
  run(): void {
    const pacer = new Pacer(TICK_MS);
    let last = this.now();
    const wake = (): void => {
      const start = this.now();
      const { ticks, droppedMs } = pacer.take(start - last);
      last = start;
      if (droppedMs > 0) {
        this.options.log(`fell ${Math.round(droppedMs)} ms behind; that time is skipped`);
      }
      let ran = 0;
      while (ran < ticks && (ran === 0 || this.now() - start < BUDGET_MS)) {
        this.tick();
        ran++;
      }
      pacer.owedMs += (ticks - ran) * TICK_MS;
      this.timer = setTimeout(wake, Math.max(0, TICK_MS - pacer.owedMs));
    };
    this.timer = setTimeout(wake, TICK_MS);
  }

  /**
   * Writes a snapshot now and says whether it was written. A failed write is
   * logged and the world runs on; the next try comes a full interval later.
   */
  save(): boolean {
    this.savedTick = this.world.tick;
    try {
      saveSnapshot(this.options.dataDir, this.world, this.options.log);
      return true;
    } catch (error) {
      this.options.log(`snapshot at tick ${this.world.tick} failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Stops stepping, saves unless told not to, and closes every connection,
   * whether or not it became a WebSocket. Waits at most CLOSE_DEADLINE_MS for
   * them to close. Resolves false if the save was asked for and failed.
   */
  async stop({ save = true }: { save?: boolean } = {}): Promise<boolean> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const saved = save ? this.save() : true;
    for (const socket of this.sockets.clients) socket.terminate();
    this.sockets.close();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const closed = await Promise.race([
      new Promise<boolean>((resolve) => {
        this.http.close(() => resolve(true));
        this.http.closeAllConnections();
      }),
      new Promise<boolean>((resolve) => {
        deadline = setTimeout(() => resolve(false), CLOSE_DEADLINE_MS);
      }),
    ]);
    clearTimeout(deadline);
    if (!closed)
      this.options.log(`connections still open after ${CLOSE_DEADLINE_MS} ms; leaving them`);
    return saved;
  }

  private tick(): void {
    step(this.world);
    if (this.world.tick - this.savedTick >= this.options.snapshotTicks) this.save();
    this.send();
  }

  private send(): void {
    if (this.sockets.clients.size === 0) return;
    const text = snapshot(this.world);
    for (const socket of this.sockets.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.bufferedAmount > MAX_QUEUED_BYTES) {
        this.options.log(
          `dropping a viewer that has stopped reading (${socket.bufferedAmount} bytes queued)`,
        );
        socket.terminate();
        continue;
      }
      socket.send(text);
    }
  }
}
