import { describe, expect, it } from "vitest";
import { DWELL_TICKS } from "../../../packages/client/src/director.ts";
import { outOfSight, spotlightWait, type TickRecord } from "./metrics.ts";
import { spotlightRun } from "./simrun.ts";

/**
 * Each stretch one subject held the spotlight, in ticks, leaving out the last,
 * which the run's end cuts short.
 */
const holds = (subjects: readonly (number | null)[]): number[] => {
  const out: number[] = [];
  let length = 0;
  subjects.forEach((s, i) => {
    length++;
    if (subjects[i + 1] !== s) {
      if (i + 1 < subjects.length) out.push(length);
      length = 0;
    }
  });
  return out;
};

// A run of 50 residents takes several seconds, more on a shared CI runner than
// vitest's default 5 s allows.
const RUN_TIMEOUT_MS = 120_000;
// The capture workflow runs the 50-resident case; the gate stops at twelve.
const LONG = process.env.IDLIN_LONG === "1";

describe("the spotlight over a headless run", () => {
  for (const residents of LONG ? [6, 12, 50] : [6, 12]) {
    it(`keeps the wait of each of ${residents} residents, wherever they are, within the bound`, {
      timeout: RUN_TIMEOUT_MS,
    }, () => {
      const { subjects, names } = spotlightRun(1, residents, 3 * residents * DWELL_TICKS);
      expect(names.size).toBe(residents);
      const wait = spotlightWait(subjects, names);
      expect(wait.limitSeconds).toBe((2 * residents * DWELL_TICKS) / 10);
      expect(wait.hardFails).toEqual([]);
      expect(wait.longestSeconds).toBeLessThanOrEqual(wait.limitSeconds);
      // Only residents are shown, and more than half the cast gets a turn.
      const shown = subjects.filter((s): s is number => s !== null);
      expect(shown.every((id) => names.has(id))).toBe(true);
      expect(new Set(shown).size).toBeGreaterThan(residents / 2);
      // Nobody is shown for less than the dwell: the view goes with them to another region.
      expect(Math.min(...holds(subjects))).toBeGreaterThanOrEqual(DWELL_TICKS);
    });
  }

  it("is the same for the same seed, run twice in one process", { timeout: RUN_TIMEOUT_MS }, () => {
    const first = spotlightRun(3, 12, 6000);
    // A different run in between must leave nothing behind that changes the next.
    spotlightRun(7, 50, 3000);
    const second = spotlightRun(3, 12, 6000);
    expect(new Set(first.subjects).size).toBeGreaterThan(1);
    expect(second.subjects).toEqual(first.subjects);
    expect([...second.names]).toEqual([...first.names]);
  });
});

describe("outOfSight", () => {
  const record = (subject: number | null, on: number[], busy = true): TickRecord => ({
    events: [],
    subject,
    busy,
    actors: on.map((id) => ({ id, name: `${id}`, x: 0, y: 0 })),
  });

  it("counts the longest stretch the same subject was off the map", () => {
    const run = [
      record(1, [1]),
      ...Array(30).fill(record(1, [2])),
      record(1, [1]),
      // Another subject off the map starts a stretch of its own.
      ...Array(20).fill(record(1, [])),
      ...Array(25).fill(record(2, [])),
      // Nobody in the spotlight is nobody out of sight.
      ...Array(500).fill(record(null, [])),
      // Nor is a subject with nothing to show, which the view does not go to.
      ...Array(2000).fill(record(3, [], false)),
    ];
    expect(outOfSight(run)).toEqual({ longestSeconds: 3, limitSeconds: 86, hardFails: [] });
  });

  it("fails a view that leaves its subject off the map for longer than the limit", () => {
    const run = [record(1, [1]), ...Array(861).fill(record(1, [2]))];
    expect(outOfSight(run).hardFails).toEqual([
      "the spotlit resident was off the map for 86.1 s, over 86 s",
    ]);
    expect(outOfSight(run.slice(0, 861)).hardFails).toEqual([]);
  });
});

describe("spotlightWait", () => {
  const names = new Map([
    [1, "Ash"],
    [2, "Birch"],
  ]);

  it("counts from the start of the run and up to its end", () => {
    // Ash from the start for 10 ticks, then Birch for 20: Ash waits 20, Birch 10.
    const subjects = [...Array(10).fill(1), ...Array(20).fill(2)];
    expect(spotlightWait(subjects, names).perActor).toEqual({ Ash: 2, Birch: 1 });
  });

  it("fails an actor only once its wait is over the limit", () => {
    // Birch is never shown. The limit for two is 2 × 2 × 45 s = 180 s, or 1800 ticks.
    expect(spotlightWait(Array(100).fill(1), names).hardFails).toEqual([]);
    expect(spotlightWait(Array(1801).fill(1), names).hardFails).toEqual([
      "spotlight wait over 180 s: Birch",
    ]);
  });
});
