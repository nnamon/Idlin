import type { WorldEvent } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { createDirector, DWELL_TICKS, direct } from "./director.ts";

const down = (tick: number, actor: number, by = 99): WorldEvent => ({
  type: "down",
  tick,
  actor,
  name: `r${actor}`,
  kind: "adventurer",
  by,
  x: 0,
  y: 0,
});

const decide = (tick: number, actor: number, rule: number): WorldEvent => ({
  type: "decide",
  tick,
  actor,
  rule,
  action: "wait",
});

/** Runs a director over `ticks` ticks; `at` gives the events and residents for each. */
const run = (
  ticks: number,
  at: (tick: number) => { events?: WorldEvent[]; present: number[] },
): (number | null)[] => {
  const director = createDirector();
  const subjects: (number | null)[] = [];
  for (let tick = 1; tick <= ticks; tick++) {
    const { events = [], present } = at(tick);
    subjects.push(direct(director, tick, events, present));
  }
  return subjects;
};

/** Each stretch one subject held the spotlight, as [subject, ticks]. */
const holds = (subjects: readonly (number | null)[]): [number | null, number][] => {
  const out: [number | null, number][] = [];
  for (const s of subjects) {
    const last = out[out.length - 1];
    if (last && last[0] === s) last[1]++;
    else out.push([s, 1]);
  }
  return out;
};

/** Per resident, its longest stretch of ticks out of the spotlight from the start to the end. */
const longestWaits = (subjects: readonly (number | null)[], ids: number[]) =>
  ids.map((id) => {
    let start = 0;
    let longest = 0;
    subjects.forEach((s, tick) => {
      if (s !== id) return;
      longest = Math.max(longest, tick - start);
      start = tick + 1;
    });
    return Math.max(longest, subjects.length - start);
  });

describe("spotlight director", () => {
  it("holds each subject for the dwell and then moves on", () => {
    const subjects = run(DWELL_TICKS * 9, () => ({ present: [1, 2, 3] }));
    const stretches = holds(subjects);
    expect(stretches.map(([s]) => s)).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
    expect(stretches.every(([, ticks]) => ticks === DWELL_TICKS)).toBe(true);
  });

  it("a notable event pulls the spotlight after the dwell, never before", () => {
    const subjects = run(DWELL_TICKS * 3, (tick) => ({
      events: tick === 100 ? [down(tick, 3)] : [],
      present: [1, 2, 3],
    }));
    // Resident 1 keeps the spotlight through the rest of its dwell.
    expect(subjects.slice(0, DWELL_TICKS).every((s) => s === 1)).toBe(true);
    // Then resident 3, who went down, ahead of 2, who has waited as long and has the lower id.
    expect(subjects[DWELL_TICKS]).toBe(3);
    expect(holds(subjects).map(([s]) => s)).toEqual([1, 3, 2]);
  });

  it("prefers the strongest notable event", () => {
    const rule = decide;
    const subjects = run(DWELL_TICKS + 1, (tick) => ({
      events:
        tick === 10
          ? [rule(tick, 2, 0), rule(tick, 3, 0)]
          : tick === 20
            ? [rule(tick, 2, 1), down(tick, 3)]
            : [],
      present: [1, 2, 3],
    }));
    expect(subjects[DWELL_TICKS]).toBe(3);
  });

  it("does not let busy residents squeeze out quiet ones", () => {
    // Residents 1 and 2 go down every tick; 3 and 4 never do anything.
    const ids = [1, 2, 3, 4];
    const ticks = 3 * ids.length * DWELL_TICKS;
    const subjects = run(ticks, (tick) => ({
      events: [down(tick, 1), down(tick, 2)],
      present: ids,
    }));
    const limit = 2 * ids.length * DWELL_TICKS;
    for (const wait of longestWaits(subjects, ids)) expect(wait).toBeLessThanOrEqual(limit);
    expect(new Set(subjects)).toEqual(new Set(ids));
  });

  it("replaces a subject that leaves at once and gives a newcomer a turn", () => {
    // Resident 1 leaves at tick 100; resident 4 arrives at tick 200.
    const subjects = run(DWELL_TICKS * 12, (tick) => ({
      present: [...(tick < 100 ? [1] : []), 2, 3, ...(tick >= 200 ? [4] : [])],
    }));
    expect(subjects[98]).toBe(1);
    expect(subjects[99]).toBe(2);
    expect(subjects.slice(99).includes(1)).toBe(false);
    const firstFour = subjects.indexOf(4);
    expect(firstFour).toBeGreaterThan(0);
    // Its wait from arriving is within the bound for the population it joined.
    expect(firstFour + 1 - 200).toBeLessThanOrEqual(2 * 3 * DWELL_TICKS);
    // After the change of subject, every hold lasts the dwell again.
    const stretches = holds(subjects.slice(99));
    expect(stretches.slice(0, -1).every(([, t]) => t === DWELL_TICKS)).toBe(true);
  });

  it("shows nobody when nobody is present", () => {
    const subjects = run(10, (tick) => ({ present: tick <= 5 ? [] : [7] }));
    expect(subjects).toEqual([null, null, null, null, null, 7, 7, 7, 7, 7]);
  });

  it("gives the same answer for the same event stream", () => {
    const at = (tick: number) => ({
      events: tick % 37 === 0 ? [down(tick, (tick % 5) + 1)] : [],
      present: [1, 2, 3, 4, 5],
    });
    expect(run(DWELL_TICKS * 20, at)).toEqual(run(DWELL_TICKS * 20, at));
  });

  it("gives no priority for an event older than the dwell", () => {
    // 2 goes down at tick 10; 4 arrives at tick 5 and goes down at tick 10 too.
    // 2 wins the pick at 451 on its longer wait, so 4 loses it. At 901 the down
    // on 4 is 891 ticks old, so 3, quiet but waiting longer, goes ahead of it.
    const subjects = run(DWELL_TICKS * 2 + 1, (tick) => ({
      events: tick === 10 ? [down(tick, 2), down(tick, 4)] : [],
      present: [1, 2, 3, ...(tick >= 5 ? [4] : [])],
    }));
    expect(subjects[DWELL_TICKS]).toBe(2);
    expect(subjects[2 * DWELL_TICKS]).toBe(3);
  });

  it("an event on the subject during its own dwell earns it no next turn", () => {
    // 1 goes down at tick 440 while it is shown. 2 takes over at 451 and leaves at
    // 460; the pick then is between 1, shown 10 ticks ago, and 3, who has waited.
    const subjects = run(DWELL_TICKS + 20, (tick) => ({
      events: tick === 440 ? [down(tick, 1)] : [],
      present: tick < 460 ? [1, 2, 3] : [1, 3],
    }));
    expect(subjects[DWELL_TICKS]).toBe(2);
    expect(subjects[459]).toBe(3);
  });

  it("credits the target of a hit and whoever struck the last blow", () => {
    // Actor 99 is not a resident; only the other side of each event is present.
    const hit: WorldEvent = { type: "hit", tick: 10, actor: 99, target: 3, damage: 1, hp: 4 };
    const byHit = run(DWELL_TICKS + 1, (tick) => ({
      events: tick === 10 ? [hit] : [],
      present: [1, 2, 3],
    }));
    expect(byHit[DWELL_TICKS]).toBe(3);
    const byDown = run(DWELL_TICKS + 1, (tick) => ({
      events: tick === 10 ? [down(tick, 99, 3)] : [],
      present: [1, 2, 3],
    }));
    expect(byDown[DWELL_TICKS]).toBe(3);
  });

  it("a resident's first decision is not news", () => {
    const subjects = run(DWELL_TICKS + 1, (tick) => ({
      events: tick === 10 ? [decide(tick, 3, 0)] : [],
      present: [1, 2, 3],
    }));
    expect(subjects[DWELL_TICKS]).toBe(2);
  });

  it("does not depend on the order residents are listed in", () => {
    const at = (tick: number) => ({
      events: tick % 37 === 0 ? [down(tick, (tick % 5) + 1)] : [],
      present: [1, 2, 3, 4, 5, ...(tick >= 1000 && tick < 6000 ? [6] : [])],
    });
    const reversed = (tick: number) => {
      const { events, present } = at(tick);
      return { events, present: [...present].reverse() };
    };
    const forward = run(DWELL_TICKS * 20, at);
    expect(new Set(forward).size).toBe(6);
    expect(run(DWELL_TICKS * 20, reversed)).toEqual(forward);
  });
});
