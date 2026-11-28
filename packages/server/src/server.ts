// The world as a running process: steps it in real time, saves it on an
// interval and on stop, and streams it to viewers over a WebSocket. Every
// message a viewer receives is the sim's viewer message: the snapshot of the
// world after a tick, with that tick's blows and knockbacks. The first comes
// on connect, with neither, then one per tick. Chat reaches the world through the queue in
// packages/chat, and each tick's inputs go in the input log beside the newest
// snapshot before the world is stepped with them.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Chat, type ChatEvent, type Crowd } from "@idlin/chat";
import {
  type Blow,
  blowsOf,
  createWorld,
  type Knock,
  knocksOf,
  spawnsNearCamp,
  step,
  TICKS_PER_SECOND,
  viewerMessage,
  type World,
} from "@idlin/sim";
import { WebSocket, WebSocketServer } from "ws";
import { castOf } from "../../client/src/cast.ts";
import { type Content, loadContent } from "./content.ts";
import { InputLog, logName, replayLog } from "./inputlog.ts";
import { Pacer } from "./pacer.ts";
import { loadNewest, saveSnapshot, setAside } from "./store.ts";

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

/**
 * VIEWER_ORIGINS plus the comma-separated Origins in `extra` (IDLIN_ORIGINS), each
 * trimmed and matched exactly; empty entries are ignored.
 */
export const viewerOrigins = (extra = ""): readonly string[] => {
  const listed = extra.split(",").map((each) => each.trim());
  return [...new Set([...VIEWER_ORIGINS, ...listed.filter((each) => each !== "")])];
};

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
  /** A scripted crowd to read as chat; its 00:00 is the tick the server starts at. */
  readonly crowd?: Crowd;
  /** Accounts and logins whose chat is ignored (default the gate's list of chat bots). */
  readonly ignore?: readonly string[];
}

/** A resume's replay: the tick of the log replayed last, the lines of it that were used (see `replayLog`), and the ticks replayed. */
interface Replayed {
  readonly tick: number;
  readonly text: string | null;
  readonly ticks: number;
}

export class WorldServer {
  readonly world: World;
  private readonly options: ServerOptions;
  private readonly http: Server;
  private readonly sockets: WebSocketServer;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private savedTick: number;
  /** Refused snapshots that could not be set aside; saves neither replace nor delete them. */
  private readonly stuck: ReadonlySet<string>;
  private readonly chat: Chat;
  /** The log of the newest snapshot saved or resumed; null if it could not be opened. */
  private inputLog: InputLog | null = null;

  private constructor(
    world: World,
    options: ServerOptions,
    http: Server,
    sockets: WebSocketServer,
    stuck: ReadonlySet<string>,
    resumed: Replayed | null,
  ) {
    this.world = world;
    this.options = options;
    this.http = http;
    this.sockets = sockets;
    this.stuck = stuck;
    this.now = options.now ?? (() => performance.now());
    this.savedTick = world.tick;
    this.chat = new Chat({
      ...(options.crowd ? { crowd: options.crowd } : {}),
      ...(options.ignore ? { ignore: options.ignore } : {}),
      start: world.tick,
    });
    if (resumed) {
      // The log replayed last goes on, with the lines that were used, until the next save.
      if (resumed.text !== null) this.inputLog = this.openLog(resumed.tick, resumed.text);
      else options.log("running without an input log until the next snapshot");
      // A world that replayed anything is saved at once, so that a server
      // killed more often than the snapshot interval does not replay a longer
      // log at every start.
      if (resumed.ticks > 0) this.save();
    } else {
      // A new world is saved at once, so that every tick it steps is in a log beside a snapshot.
      this.save();
    }
    sockets.on("connection", (socket) => {
      // A bad frame or a message over maxPayload is reported here; without a
      // listener it would take the whole process down.
      let failed = false;
      socket.on("error", (error) => {
        if (!failed) options.log(`closing a viewer: ${error.message}`);
        failed = true;
        socket.terminate();
      });
      // Viewers only listen; anything they send is ignored. A viewer that
      // joins mid-tick has no tick before this one to draw blows across.
      socket.send(viewerMessage(this.world, []));
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
    const stuck = new Set<string>();
    const resumed = loadNewest(options.dataDir, content, options.log, stuck);
    let world: World;
    let replayed: Replayed | null = null;
    if (resumed) {
      world = resumed.world;
      options.log(`resumed ${resumed.file} at tick ${world.tick}`);
      let tick = world.tick;
      let replay = replayLog(options.dataDir, world, options.log);
      let ticks = replay.ticks;
      if (ticks > 0) options.log(`replayed ${ticks} ticks of its input log, to tick ${world.tick}`);
      // A log used to its end brings the world to the tick of the next
      // snapshot, which was refused if it was not resumed. Its log was written
      // against that same world, so the replay goes on into it.
      while (
        replay.whole &&
        replay.ticks > 0 &&
        existsSync(join(options.dataDir, logName(world.tick)))
      ) {
        tick = world.tick;
        replay = replayLog(options.dataDir, world, options.log);
        ticks += replay.ticks;
        options.log(
          `went on into the input log ${logName(tick)}: ${replay.ticks} more ticks, to tick ${world.tick}`,
        );
      }
      // A log at a later tick is a refused snapshot's that this replay did not
      // reach. The world goes on from here with other inputs, so it is set aside
      // and a later start cannot go on into it.
      for (const file of readdirSync(options.dataDir)) {
        const at = /^world-(\d{16})\.log$/.exec(file);
        if (at && Number(at[1]) > tick) setAside(options.dataDir, file, options.log);
      }
      replayed = { tick, text: replay.text, ticks };
    } else {
      // No snapshot here restores, so a log here was written beside one of another
      // world. It is set aside, so that it cannot be taken for this world's.
      for (const file of readdirSync(options.dataDir))
        if (/^world-\d{16}\.log$/.test(file)) setAside(options.dataDir, file, options.log);
      world = createWorld(
        content.atlas,
        options.seed,
        content.programs,
        content.kinds,
        content.spawns,
      );
      const cast = options.residents > 0 ? castOf(options.residents) : [];
      step(world, spawnsNearCamp(world, cast));
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
    return new WorldServer(world, options, http, sockets, stuck, replayed);
  }

  /** Hands a chat event to the gate; what it makes is applied at a coming tick. */
  hear(event: ChatEvent): void {
    this.chat.hear(event, this.world.tick);
  }

  /** What the chat queue holds now. */
  get waiting(): number {
    return this.chat.queue.size;
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
    // The old log is complete up to now either way: if this save fails, it goes on.
    this.inputLog?.flush();
    try {
      saveSnapshot(this.options.dataDir, this.world, this.options.log, this.stuck);
    } catch (error) {
      this.options.log(`snapshot at tick ${this.world.tick} failed: ${String(error)}`);
      return false;
    }
    this.inputLog?.close();
    this.inputLog = this.openLog(this.world.tick);
    return true;
  }

  private openLog(tick: number, text = ""): InputLog | null {
    try {
      return new InputLog(this.options.dataDir, tick, this.options.log, text);
    } catch (error) {
      this.options.log(`could not start the input log for tick ${tick}: ${String(error)}`);
      return null;
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
    this.inputLog?.close();
    this.inputLog = null;
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
    const inputs = this.chat.take(this.world.tick);
    this.inputLog?.append(this.world.tick, inputs);
    const events = step(this.world, inputs);
    if (this.world.tick - this.savedTick >= this.options.snapshotTicks) this.save();
    this.send(blowsOf(events), knocksOf(events));
  }

  private send(blows: readonly Blow[], knocks: readonly Knock[]): void {
    if (this.sockets.clients.size === 0) return;
    const text = viewerMessage(this.world, blows, knocks);
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
