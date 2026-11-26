import { SKILLS, XP_TABLE } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { castOf, SPREAD, spreadLevels } from "./cast.ts";
import { figureTop } from "./figure.ts";
import {
  gaitFor,
  HOOD_SHAPES,
  kitFor,
  looks,
  MARK_COUNT,
  PATTERNS,
  partsFor,
  REST_POSES,
  RISE_MAX,
  riseFor,
  tierFor,
  totalLevel,
  VETERAN_TOTAL,
} from "./looks.ts";

/** Experience for these levels, by skill name; every other skill at level 1. */
const xpAt = (levels: Partial<Record<(typeof SKILLS)[number], number>>): number[] =>
  SKILLS.map((skill) => XP_TABLE[levels[skill] ?? 1] as number);
const noXp = (): number[] => SKILLS.map(() => 0);

describe("looks per resident", () => {
  it("gives the first 16 residents all 16 pairs of hood shape and cloak pattern", () => {
    const pairs = new Set<string>();
    for (let id = 1; id <= 16; id++) pairs.add(`${looks(id).hood}/${looks(id).pattern}`);
    expect(pairs.size).toBe(HOOD_SHAPES.length * PATTERNS.length);
  });

  it("never gives two residents next to each other the same hood shape", () => {
    for (let id = 1; id < 200; id++) expect(looks(id).hood).not.toBe(looks(id + 1).hood);
  });

  it("gives the first 24 residents 24 different marks", () => {
    const marks = Array.from({ length: MARK_COUNT }, (_, i) => looks(i + 1).mark);
    expect(new Set(marks).size).toBe(MARK_COUNT);
    for (const mark of marks) expect(mark >= 0 && mark < MARK_COUNT).toBe(true);
  });

  it("uses every rest pose among the first twelve, three times each", () => {
    const counts = new Map<string, number>();
    for (let id = 1; id <= 12; id++) {
      const rest = looks(id).rest;
      counts.set(rest, (counts.get(rest) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([...REST_POSES].sort());
    expect([...counts.values()]).toEqual([3, 3, 3, 3]);
  });

  it("gives the same looks for the same id every time, whatever else changes", () => {
    expect(looks(7)).toEqual(looks(7));
    expect(partsFor({ id: 7, xp: xpAt({ fishing: 80 }) }).looks).toEqual(looks(7));
    // The first resident's looks, written out, so a change to the rule shows here.
    expect(looks(1)).toEqual({ hood: "point", pattern: "plain", mark: 0, rest: "upright" });
    expect(looks(2)).toEqual({ hood: "round", pattern: "band", mark: 7, rest: "knees" });
  });

  it("always answers, whatever the id", () => {
    for (const id of [0, -3, 2.5, Number.NaN, Number.MAX_SAFE_INTEGER, Infinity]) {
      const each = looks(id);
      expect(HOOD_SHAPES).toContain(each.hood);
      expect(PATTERNS).toContain(each.pattern);
      expect(REST_POSES).toContain(each.rest);
      expect(Number.isInteger(each.mark)).toBe(true);
    }
  });
});

describe("kit tier by level", () => {
  it("starts a tier at levels 1, 20, 40, 60 and 80", () => {
    const levels = [1, 19, 20, 39, 40, 59, 60, 79, 80, 99];
    expect(levels.map(tierFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("draws the kit of the best trade, at that trade's tier", () => {
    expect(kitFor(1, xpAt({ woodcutting: 45, fishing: 30 }))).toMatchObject({
      trade: "woodcutting",
      tier: 2,
    });
    expect(kitFor(1, xpAt({ fishing: 61, cooking: 12 }))).toMatchObject({
      trade: "fishing",
      tier: 3,
    });
    expect(kitFor(1, xpAt({ melee: 99 }))).toMatchObject({ trade: "melee", tier: 4 });
    expect(kitFor(1, xpAt({ cooking: 2 }))).toMatchObject({ trade: "cooking", tier: 0 });
  });

  it("carries no tool for hitpoints, and takes the first trade on a tie", () => {
    expect(kitFor(4, xpAt({ hitpoints: 90 }))).toEqual({ trade: null, tier: 0, starter: 1 });
    expect(kitFor(4, xpAt({ fishing: 30, melee: 30 })).trade).toBe("melee");
  });

  it("gives someone with no trade yet the starter kit its id gives", () => {
    expect([3, 4, 5].map((id) => kitFor(id, noXp()))).toEqual([
      { trade: null, tier: 0, starter: 0 },
      { trade: null, tier: 0, starter: 1 },
      { trade: null, tier: 0, starter: 2 },
    ]);
    // A resident seen only by its id, with no experience to read, also gets it.
    expect(partsFor(5).kit).toEqual({ trade: null, tier: 0, starter: 2 });
  });
});

describe("how tall a figure stands, for the name slip over it", () => {
  it("keeps a plain figure at 46 and raises it for a tall hood and for higher kit", () => {
    const plain = partsFor(2); // a round hood, nothing over the shoulder
    expect(plain.looks.hood).toBe("round");
    expect(figureTop(plain)).toBe(46);
    expect(figureTop(partsFor(1))).toBeGreaterThan(46); // a pointed hood
    for (const trade of ["woodcutting", "fishing"] as const) {
      const tops = [2, 20, 40, 60, 80].map((level) =>
        figureTop({ ...plain, kit: kitFor(2, xpAt({ [trade]: level })) }),
      );
      for (let i = 1; i < tops.length; i++)
        expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] as number);
      expect(tops[4]).toBeGreaterThan(tops[0] as number);
    }
  });
});

describe("gait by level", () => {
  it("bobs at the start and strides from VETERAN_TOTAL levels, rising in between", () => {
    expect(gaitFor(noXp())).toBe(0);
    expect(gaitFor(xpAt({ melee: 99, hitpoints: 99, woodcutting: 9 }))).toBe(1);
    const middle = gaitFor(xpAt({ fishing: 50, cooking: 50 }));
    expect(middle).toBeGreaterThan(0.3);
    expect(middle).toBeLessThan(0.7);
    // More levels never make a walk less sure.
    let before = 0;
    for (let level = 1; level <= 99; level++) {
      const gait = gaitFor(xpAt({ melee: level, woodcutting: level }));
      expect(gait).toBeGreaterThanOrEqual(before);
      before = gait;
    }
    expect(VETERAN_TOTAL).toBeGreaterThan(SKILLS.length);
  });
});

describe("the hat, by total level", () => {
  it("rises with every level gained in any skill, from 0 for a newcomer to RISE_MAX", () => {
    expect(riseFor(noXp())).toBe(0);
    expect(riseFor(xpAt({}))).toBe(0);
    expect(riseFor(SKILLS.map(() => XP_TABLE[99] as number))).toBe(RISE_MAX);
    // One skill after another raised to 99, a level at a time: every level is taller.
    const levels = SKILLS.map(() => 1);
    let before = riseFor(xpAt({}));
    SKILLS.forEach((skill, k) => {
      for (let level = 2; level <= 99; level++) {
        levels[k] = level;
        const xp = SKILLS.map((_, j) => XP_TABLE[levels[j] as number] as number);
        expect(totalLevel(xp)).toBe(levels.reduce((sum, each) => sum + each, 0));
        const rise = riseFor(xp);
        expect(rise, `${skill} at ${level}`).toBeGreaterThan(before);
        before = rise;
      }
    });
    // The same total gives the same hat, whichever skills it is in.
    expect(riseFor(xpAt({ fishing: 41 }))).toBeCloseTo(riseFor(xpAt({ melee: 21, cooking: 21 })));
  });

  it("orders the capture's twelve by their total level, and the figure's top with it", () => {
    const actors = castOf(12).map(() => ({ xp: noXp() }));
    spreadLevels(actors, (level) => XP_TABLE[level] as number);
    const byTotal = [...actors].sort((a, b) => totalLevel(a.xp) - totalLevel(b.xp));
    for (let i = 1; i < byTotal.length; i++) {
      const [lower, higher] = [byTotal[i - 1]?.xp ?? [], byTotal[i]?.xp ?? []];
      expect(riseFor(higher)).toBeGreaterThan(riseFor(lower));
    }
    // With the same looks and kit, more levels never make a figure shorter, and
    // at the top a plain round hood stands taller than any newcomer's hood.
    const plain = partsFor(2);
    const tops = byTotal.map((actor) => figureTop({ ...plain, rise: riseFor(actor.xp) }));
    for (let i = 1; i < tops.length; i++)
      expect(tops[i]).toBeGreaterThanOrEqual(tops[i - 1] as number);
    const newcomers = [1, 2, 3, 4].map((id) => figureTop({ ...partsFor(id), kit: plain.kit }));
    expect(tops[tops.length - 1]).toBeGreaterThan(Math.max(...newcomers));
  });
});

describe("the capture's spread of levels", () => {
  it("shows a resident at each kit tier among twelve, in every trade", () => {
    const actors = castOf(12).map(() => ({ xp: noXp() }));
    spreadLevels(actors, (level) => XP_TABLE[level] as number);
    const kits = actors.map((actor, n) => kitFor(n + 1, actor.xp));
    expect(new Set(kits.map((kit) => kit.tier))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(new Set(kits.map((kit) => kit.trade))).toEqual(
      new Set([null, "melee", "woodcutting", "fishing", "cooking"]),
    );
    expect(SPREAD).toHaveLength(12);
  });
});
