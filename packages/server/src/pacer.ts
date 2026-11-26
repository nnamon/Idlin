// Turns wall-clock time into ticks to run. Time the server could not keep up
// with is owed and paid back on the next wake, but never more than MAX_OWED_TICKS
// of it: past that the time is dropped, so a stall (a suspended machine, a long
// pause in the process) costs one bounded burst of work and the server never
// spends its time catching up on time spent catching up.

/** Five seconds of world time at ten ticks a second. */
export const MAX_OWED_TICKS = 50;

export class Pacer {
  /** Milliseconds of world time owed and not yet run. */
  owedMs = 0;

  readonly tickMs: number;
  readonly maxOwedTicks: number;

  constructor(tickMs: number, maxOwedTicks: number = MAX_OWED_TICKS) {
    this.tickMs = tickMs;
    this.maxOwedTicks = maxOwedTicks;
  }

  /** Adds the time since the last call; returns the ticks to run now and any time dropped. */
  take(elapsedMs: number): { ticks: number; droppedMs: number } {
    this.owedMs += Math.max(0, elapsedMs);
    const cap = this.maxOwedTicks * this.tickMs;
    const droppedMs = Math.max(0, this.owedMs - cap);
    this.owedMs -= droppedMs;
    const ticks = Math.floor(this.owedMs / this.tickMs);
    this.owedMs -= ticks * this.tickMs;
    return { ticks, droppedMs };
  }
}
