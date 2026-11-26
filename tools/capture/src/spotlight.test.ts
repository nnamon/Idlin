import { describe, expect, it } from "vitest";
import { DWELL_TICKS } from "../../../packages/client/src/director.ts";
import { spotlightWait } from "./metrics.ts";
import { spotlightRun } from "./simrun.ts";

/** Each stretch one subject held the spotlight, in ticks, leaving out the last, which the run's end cuts short. */
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
    it(`gives each of ${residents} residents a turn within the bound`, {
      timeout: RUN_TIMEOUT_MS,
    }, () => {
      const { subjects, names } = spotlightRun(1, residents, 3 * residents * DWELL_TICKS);
      expect(names.size).toBe(residents);
      const wait = spotlightWait(subjects, names);
      expect(wait.limitSeconds).toBe((2 * residents * DWELL_TICKS) / 10);
      expect(wait.hardFails).toEqual([]);
      expect(wait.longestSeconds).toBeLessThanOrEqual(wait.limitSeconds);
      expect(new Set(subjects)).toEqual(new Set(names.keys()));
      // Nobody is shown for less than the dwell.
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
