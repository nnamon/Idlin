import { describe, expect, it } from "vitest";
import {
  alone,
  FADE,
  type Fits,
  letGo,
  MIN_HOLD,
  NEWS_HOLD,
  NO_SLIPS,
  nextSlips,
  SLIP_BUDGET,
  type Slips,
  type Someone,
  slipAlpha,
} from "./slips.ts";

/** A tight knot of residents, every one within a step of another. */
const knot = (count: number): Someone[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    x: 10 + (i % 5),
    y: 10 + Math.floor(i / 5),
  }));

/** No slips yet, with everyone already in the world: slips given now fade in. */
const seenAll = (everyone: readonly Someone[]): Slips => ({
  ...NO_SLIPS,
  seen: new Set(everyone.map((who) => who.id)),
});

const always = () => true;

const run = (
  start: Slips,
  everyone: Someone[],
  named: Map<number, number>,
  from: number,
  ticks: number,
  fits?: Fits,
) => {
  let slips = start;
  for (let t = from; t < from + ticks; t++) slips = nextSlips(slips, everyone, named, t, fits);
  return slips;
};

describe("name slips", () => {
  it("everyone keeps a slip while there are no more residents than the budget", () => {
    const slips = run(NO_SLIPS, knot(SLIP_BUDGET), new Map(), 0, 20);
    expect(slips.held.size).toBe(SLIP_BUDGET);
  });

  it("in a crowd only those named in the news or standing apart get one, never more than the budget", () => {
    const crowd = knot(40);
    crowd.push({ id: 41, x: 2, y: 2 }, { id: 42, x: 25, y: 2 });
    const named = new Map([[7, 0]]);
    const slips = run(NO_SLIPS, crowd, named, 0, 5);
    expect([...slips.held.keys()].sort((a, b) => a - b)).toEqual([7, 41, 42]);
    // Fifty named at once still fill only the budget, newest news first.
    const many = new Map(crowd.map((who) => [who.id, who.id]));
    const full = nextSlips(NO_SLIPS, crowd, many, 60);
    expect(full.held.size).toBe(SLIP_BUDGET);
    expect([...full.held.keys()].sort((a, b) => b - a).slice(0, 3)).toEqual([42, 41, 40]);
  });

  it("a slip is held for at least five seconds, and news keeps it for ten", () => {
    const crowd = knot(20);
    const named = new Map([[3, 0]]);
    let slips = run(NO_SLIPS, crowd, named, 0, 1);
    expect(slips.held.has(3)).toBe(true);
    slips = run(slips, crowd, named, 1, NEWS_HOLD - 2);
    expect(slips.held.has(3)).toBe(true);
    slips = run(slips, crowd, named, NEWS_HOLD - 1, 2);
    expect(slips.held.has(3)).toBe(false);
    expect(slips.leaving.has(3)).toBe(true);
    // Someone alone for a moment, then back in the crowd: held for MIN_HOLD all the same.
    const loner = { id: 99, x: 30, y: 30 };
    slips = nextSlips(seenAll([...crowd, loner]), [...crowd, loner], new Map(), 1000);
    const back = [...crowd, { id: 99, x: 11, y: 11 }];
    slips = run(slips, back, new Map(), 1001, MIN_HOLD - 2);
    expect(slips.held.has(99)).toBe(true);
    slips = run(slips, back, new Map(), 1000 + MIN_HOLD - 1, 2);
    expect(slips.held.has(99)).toBe(false);
  });

  it("when the budget is full a new claim waits instead of taking someone's slip", () => {
    const crowd = knot(30);
    const named = new Map(crowd.slice(0, SLIP_BUDGET).map((who) => [who.id, 0]));
    let slips = nextSlips(NO_SLIPS, crowd, named, 0);
    named.set(20, 50);
    slips = run(slips, crowd, named, 1, 55);
    expect(slips.held.has(20)).toBe(false);
    expect(slips.held.size).toBe(SLIP_BUDGET);
    // Once the first claims run out and their slips have faded, the waiting one gets its slip.
    slips = run(slips, crowd, named, 56, 60);
    expect(slips.held.has(20)).toBe(true);
  });

  it("a slip fading out keeps its place in the budget until it has gone", () => {
    const crowd = knot(30);
    // Resident 1's claim runs out at NEWS_HOLD; the other seven hold on.
    const named = new Map(
      crowd.slice(0, SLIP_BUDGET).map((who) => [who.id, who.id === 1 ? 0 : 50]),
    );
    let slips = run(NO_SLIPS, crowd, named, 0, NEWS_HOLD);
    expect(slips.held.size).toBe(SLIP_BUDGET);
    // Just as it does, resident 20 is named: it waits while 1's slip fades.
    named.set(20, NEWS_HOLD);
    for (let t = NEWS_HOLD; t < NEWS_HOLD + FADE; t++) {
      slips = nextSlips(slips, crowd, named, t);
      expect(slips.leaving.has(1)).toBe(true);
      expect(slips.held.has(20)).toBe(false);
      const showing = crowd.filter((who) => slipAlpha(slips, who.id, t + 0.5) > 0);
      expect(showing.length).toBe(SLIP_BUDGET);
    }
    slips = nextSlips(slips, crowd, named, NEWS_HOLD + FADE);
    expect(slips.leaving.has(1)).toBe(false);
    expect(slips.held.has(20)).toBe(true);
  });

  it("news outranks standing alone: a loner's slip gives way once it has been held MIN_HOLD", () => {
    const loners = Array.from({ length: SLIP_BUDGET }, (_, i) => ({
      id: 101 + i,
      x: i * 5,
      y: 40,
    }));
    const everyone = [...knot(20), ...loners];
    let slips = nextSlips(seenAll(everyone), everyone, new Map(), 0);
    expect([...slips.held.keys()].sort((a, b) => a - b)).toEqual(loners.map((who) => who.id));
    // Resident 1, in the knot, is named at tick 10 and stays in the news.
    const named = new Map<number, number>();
    for (let t = 1; t < MIN_HOLD; t++) {
      if (t >= 10) named.set(1, t);
      slips = nextSlips(slips, everyone, named, t);
      expect(slips.held.has(1)).toBe(false);
      expect(slips.leaving.size).toBe(0);
    }
    // At MIN_HOLD the oldest loner's slip, lowest id first, starts to fade; only that one.
    for (let t = MIN_HOLD; t < MIN_HOLD + FADE; t++) {
      named.set(1, t);
      slips = nextSlips(slips, everyone, named, t);
      expect([...slips.leaving.keys()]).toEqual([101]);
      expect(slips.held.has(101)).toBe(false);
      expect(slips.held.has(1)).toBe(false);
      const showing = everyone.filter((who) => slipAlpha(slips, who.id, t + 0.5) > 0);
      expect(showing.length).toBeLessThanOrEqual(SLIP_BUDGET);
    }
    // Faded: the news resident has it, and the loner waits.
    named.set(1, MIN_HOLD + FADE);
    slips = nextSlips(slips, everyone, named, MIN_HOLD + FADE);
    expect(slips.held.has(1)).toBe(true);
    expect(slips.held.has(101)).toBe(false);
    expect(slips.held.size).toBe(SLIP_BUDGET);
  });

  it("a slip taken back while fading out fades back in from where it was", () => {
    const leaving = { ...seenAll(knot(20)), leaving: new Map([[4, 100]]) };
    const before = slipAlpha(leaving, 4, 102);
    const back = nextSlips(leaving, knot(20), new Map([[4, 102]]), 102);
    expect(back.held.has(4)).toBe(true);
    expect(slipAlpha(back, 4, 102)).toBeCloseTo(before);
    // The hold counts from the tick it was taken back, not from where the fade picks up.
    expect(back.held.get(4)).toBe(102);
  });

  it("holds a slip there from the first tick a full MIN_HOLD, though it shows at once", () => {
    const loners = Array.from({ length: SLIP_BUDGET }, (_, i) => ({
      id: 101 + i,
      x: i * 5,
      y: 40,
    }));
    const everyone = [...knot(10), ...loners];
    let slips = nextSlips(NO_SLIPS, everyone, new Map(), 0);
    expect([...slips.held.keys()].sort((a, b) => a - b)).toEqual(loners.map((who) => who.id));
    for (const who of loners) expect(slipAlpha(slips, who.id, 0)).toBe(1);
    // Resident 9, in the knot, is in the news from tick 1 on: no loner gives way before MIN_HOLD.
    const named = new Map<number, number>();
    for (let t = 1; t < MIN_HOLD; t++) {
      named.set(9, t);
      slips = nextSlips(slips, everyone, named, t);
      expect(slips.leaving.size).toBe(0);
      for (const who of loners) expect(slipAlpha(slips, who.id, t)).toBe(1);
    }
    named.set(9, MIN_HOLD);
    slips = nextSlips(slips, everyone, named, MIN_HOLD);
    expect([...slips.leaving.keys()]).toEqual([101]);
  });

  it("fades in and out over half a second", () => {
    const crowd = knot(20);
    const named = new Map([[4, 0]]);
    const slips = nextSlips(seenAll(crowd), crowd, named, 10);
    expect(slipAlpha(slips, 4, 10)).toBe(0);
    expect(slipAlpha(slips, 4, 10 + FADE / 2)).toBeCloseTo(0.5);
    expect(slipAlpha(slips, 4, 10 + FADE)).toBe(1);
    expect(slipAlpha(slips, 5, 10)).toBe(0);
    const gone = { ...seenAll(crowd), leaving: new Map([[4, 200]]) };
    expect(slipAlpha(gone, 4, 200)).toBe(1);
    expect(slipAlpha(gone, 4, 200 + FADE / 2)).toBeCloseTo(0.5);
    expect(slipAlpha(gone, 4, 200 + FADE)).toBe(0);
    // A fading slip is dropped once it has faded, or when its owner leaves the world.
    expect(nextSlips(gone, crowd, new Map(), 200 + FADE).leaving.has(4)).toBe(false);
    expect(nextSlips(gone, crowd.slice(5), new Map(), 201).leaving.has(4)).toBe(false);
  });

  it("counts someone within two steps of another as together", () => {
    const a = { id: 1, x: 0, y: 0 };
    expect(alone(a, [a, { id: 2, x: 2, y: 0 }])).toBe(false);
    expect(alone(a, [a, { id: 2, x: 2, y: 1 }])).toBe(true);
    expect(alone(a, [a])).toBe(true);
  });

  it("gives slips left over to residents with no claim, where they fit", () => {
    // Twelve together, nobody in the news: room for all eight.
    const twelve = knot(12);
    const filled = run(seenAll(twelve), twelve, new Map(), 0, 3, always);
    expect(filled.held.size).toBe(SLIP_BUDGET);
    expect([...filled.held.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // Only where they fit: here an odd id never has room.
    const evens = run(seenAll(twelve), twelve, new Map(), 0, 3, (id) => id % 2 === 0);
    expect([...evens.held.keys()].sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10, 12]);
    // Those who have gone longest without a slip come first.
    const recent = { ...seenAll(twelve), had: new Map([1, 2, 3, 4, 5, 6].map((id) => [id, 90])) };
    const next = nextSlips(recent, twelve, new Map(), 100, always);
    expect([...next.held.keys()].sort((a, b) => a - b)).toEqual([1, 2, 7, 8, 9, 10, 11, 12]);
    // A slip held only for the room goes as soon as it no longer fits, however
    // recently it was given, and fades from as solid as it had got.
    const kept = nextSlips(filled, twelve, new Map(), 3, (id) => id !== 1);
    expect(kept.held.has(1)).toBe(false);
    expect(kept.leaving.has(1)).toBe(true);
    expect(slipAlpha(kept, 1, 3)).toBeCloseTo(slipAlpha(filled, 1, 3));
    expect(slipAlpha(kept, 1, 3)).toBeLessThan(1);
    // One held for a claim keeps it MIN_HOLD after the claim has gone, fitting or not.
    const loner = [...twelve, { id: 99, x: 40, y: 40 }];
    let claimed = run(seenAll(loner), loner, new Map(), 0, 1, always);
    expect(claimed.held.has(99)).toBe(true);
    const back = [...twelve, { id: 99, x: 11, y: 11 }];
    claimed = run(claimed, back, new Map(), 1, MIN_HOLD - 1, (id) => id !== 99);
    expect(claimed.held.has(99)).toBe(true);
    claimed = run(claimed, back, new Map(), MIN_HOLD, 1, (id) => id !== 99);
    expect(claimed.held.has(99)).toBe(false);
  });

  it("a slip held only for the room gives way to someone standing apart", () => {
    const crowd = knot(20);
    let slips = run(seenAll(crowd), crowd, new Map(), 0, MIN_HOLD, always);
    expect(slips.held.size).toBe(SLIP_BUDGET);
    const loner = { id: 99, x: 40, y: 40 };
    const everyone = [...crowd, loner];
    slips = run(slips, everyone, new Map(), MIN_HOLD, 1, always);
    expect(slips.leaving.size).toBe(1);
    expect(slips.held.has(99)).toBe(false);
    slips = run(slips, everyone, new Map(), MIN_HOLD + 1, FADE, always);
    expect(slips.held.has(99)).toBe(true);
    expect(slips.held.size + slips.leaving.size).toBeLessThanOrEqual(SLIP_BUDGET);
  });

  it("a slip given for the room and then claimed by the news is held on every tick", () => {
    // As the scene does it: after each tick, a slip held only for the room that
    // something covers starts to fade. Here resident 3's slip covers something
    // from the moment it is named.
    const twelve = knot(12);
    const settle = (slips: Slips, covered: ReadonlySet<number>, tick: number): Slips => {
      const fade = [...slips.room].filter((id) => covered.has(id));
      return fade.length === 0 ? slips : letGo(slips, fade, [], tick);
    };
    let slips = run(seenAll(twelve), twelve, new Map(), 0, 3, always);
    expect(slips.room.has(3)).toBe(true);
    const named = new Map([[3, 10]]);
    for (let t = 10; t < 10 + NEWS_HOLD; t++) {
      slips = settle(
        nextSlips(slips, twelve, named, t, (id) => id !== 3),
        new Set([3]),
        t,
      );
      expect(slips.held.has(3)).toBe(true);
      expect(slips.room.has(3)).toBe(false);
    }
  });

  it("shows a slip there from a resident's first tick at once, without a fade", () => {
    const six = knot(6);
    const start = nextSlips(NO_SLIPS, six, new Map(), 0);
    for (const who of six) expect(slipAlpha(start, who.id, 0)).toBe(1);
    // Someone joining later gets theirs at once too; someone already there fades in.
    const seven = [...six, { id: 7, x: 30, y: 30 }];
    const later = nextSlips(start, seven, new Map(), 10);
    expect(slipAlpha(later, 7, 10)).toBe(1);
    const crowd = knot(20);
    const news = nextSlips(seenAll(crowd), crowd, new Map([[4, 10]]), 10);
    expect(slipAlpha(news, 4, 10)).toBe(0);
  });
});
