// The input log (docs/chat.md, section 10). Each snapshot has a log beside it,
// `world-<tick>.log` next to `world-<tick>.json`, with one line for every tick
// stepped after it: `{"tick":481220,"inputs":[…]}`, the tick the inputs were
// applied at. The snapshot plus its log is the world at the log's last line.
// Lines are written ten ticks at a time, so a process that dies loses at most
// those ticks and their inputs together, and the world and the log agree.

import {
  closeSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { INPUTS_PER_TICK } from "@idlin/chat";
import { type Input, step, type World } from "@idlin/sim";
import { setAside } from "./store.ts";

/** Ticks between writes of the log to disk. */
export const FLUSH_TICKS = 10;

export const logName = (tick: number): string => `world-${String(tick).padStart(16, "0")}.log`;

/** The log of the snapshot at `tick`, open for appending; it starts with `text`, the lines kept from before. */
export class InputLog {
  readonly name: string;
  private readonly fd: number;
  private buffer = "";
  /** Bytes a write did not take. */
  private unwritten = Buffer.alloc(0);
  private lines = 0;
  private readonly log: (line: string) => void;

  constructor(dir: string, tick: number, log: (line: string) => void, text = "") {
    this.name = logName(tick);
    this.log = log;
    // Written beside its name and renamed into place, as snapshots are, so
    // whatever was at the name (a longer log, a symlink) is replaced and not written through.
    const temp = join(dir, `.${this.name}.tmp`);
    try {
      unlinkSync(temp);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    writeFileSync(temp, text, { flag: "wx" });
    renameSync(temp, join(dir, this.name));
    this.fd = openSync(join(dir, this.name), "a");
  }

  /** Records the inputs applied at `tick`; every FLUSH_TICKS lines go to disk. */
  append(tick: number, inputs: readonly Input[]): void {
    this.buffer += `${JSON.stringify({ tick, inputs })}\n`;
    if (++this.lines % FLUSH_TICKS === 0) this.flush();
  }

  /**
   * Writes what is waiting. What a write did not take, because it failed or
   * wrote only part, waits for the next one, so the file never has a gap or a
   * torn line in the middle. It waits until the next snapshot at most, which
   * starts a new log.
   */
  flush(): void {
    if (this.buffer === "" && this.unwritten.length === 0) return;
    const bytes = Buffer.concat([this.unwritten, Buffer.from(this.buffer)]);
    this.buffer = "";
    let written = 0;
    try {
      while (written < bytes.length) written += writeSync(this.fd, bytes, written);
    } catch (error) {
      this.log(`could not write the input log ${this.name}: ${String(error)}`);
    }
    this.unwritten = bytes.subarray(written);
  }

  close(): void {
    this.flush();
    try {
      closeSync(this.fd);
    } catch (error) {
      this.log(`could not close the input log ${this.name}: ${String(error)}`);
    }
  }
}

/**
 * Steps `world`, just restored from the snapshot at its tick, through that
 * snapshot's log. Stops at the first line that is not whole, or not the next
 * tick, or holds more than a tick's inputs: a torn last line is what a crash
 * mid-write leaves. A log that cannot be read, or has a whole line after the
 * one it stops at, is copied aside as `<name>.bad` (see `setAside`) to look at.
 * The log stays at its name until the new log, opened with the lines used,
 * replaces it, so a kill before then loses nothing; the next start copies it
 * aside again.
 *
 * Returns how many ticks it replayed; the text of the lines it used, for the
 * log to go on from, or null if the log could not be copied aside and must
 * not be replaced; and whether the replay used
 * every byte of the file.
 */
export function replayLog(
  dir: string,
  world: World,
  log: (line: string) => void,
): { ticks: number; text: string | null; whole: boolean } {
  const name = logName(world.tick);
  let text: string;
  try {
    text = readFileSync(join(dir, name), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ticks: 0, text: "", whole: true };
    log(`could not read the input log ${name}: ${String(error)}`);
    return { ticks: 0, text: setAside(dir, name, log, false) ? "" : null, whole: false };
  }
  const lines = text.split("\n");
  // What follows the last newline was never finished.
  lines.pop();
  let kept = "";
  let ticks = 0;
  for (const line of lines) {
    const inputs = inputsAt(line, world.tick);
    if (inputs === null) {
      log(`the input log ${name} stops being usable at line ${ticks + 1}; the rest is ignored`);
      return { ticks, text: setAside(dir, name, log, false) ? kept : null, whole: false };
    }
    step(world, inputs);
    kept += `${line}\n`;
    ticks++;
  }
  return { ticks, text: kept, whole: kept === text };
}

/** The inputs of one log line if it is the line for `tick`, else null. */
function inputsAt(line: string, tick: number): Input[] | null {
  let data: unknown;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { tick: at, inputs } = data as { tick?: unknown; inputs?: unknown };
  if (at !== tick || !Array.isArray(inputs) || inputs.length > INPUTS_PER_TICK) return null;
  // The simulation checks each input's shape itself and drops one it cannot honour.
  return inputs as Input[];
}
