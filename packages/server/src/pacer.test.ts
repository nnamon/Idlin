import { describe, expect, it } from "vitest";
import { MAX_OWED_TICKS, Pacer } from "./pacer.ts";

describe("pacer", () => {
  it("runs one tick per tick's worth of time and carries the remainder", () => {
    const pacer = new Pacer(100);
    expect(pacer.take(100)).toEqual({ ticks: 1, droppedMs: 0 });
    expect(pacer.take(250)).toEqual({ ticks: 2, droppedMs: 0 });
    expect(pacer.owedMs).toBe(50);
    expect(pacer.take(50)).toEqual({ ticks: 1, droppedMs: 0 });
    expect(pacer.take(-500)).toEqual({ ticks: 0, droppedMs: 0 });
  });

  it("catches up a short stall in full", () => {
    const pacer = new Pacer(100);
    expect(pacer.take(3_000).ticks).toBe(30);
  });

  it("after a long stall runs a bounded burst and drops the rest of the time", () => {
    const pacer = new Pacer(100);
    const hour = pacer.take(3_600_000);
    expect(hour.ticks).toBe(MAX_OWED_TICKS);
    expect(hour.droppedMs).toBe(3_600_000 - MAX_OWED_TICKS * 100);
    // Nothing is left owed, so the next wake is ordinary.
    expect(pacer.take(100)).toEqual({ ticks: 1, droppedMs: 0 });
  });

  it("a server slower than real time never owes more than the cap", () => {
    // Each burst of ticks takes longer than the time it paid back.
    const pacer = new Pacer(100);
    let elapsed = 100;
    for (let i = 0; i < 1000; i++) {
      const { ticks } = pacer.take(elapsed);
      expect(ticks).toBeLessThanOrEqual(MAX_OWED_TICKS);
      elapsed = ticks * 150;
    }
  });
});
