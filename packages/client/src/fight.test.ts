import type { Actor, Mark, World } from "@idlin/sim";
import { describe, expect, it } from "vitest";
import {
  ARRIVE_TICKS,
  arrivalAt,
  BLOT_TICKS,
  COLLAPSE_TICKS,
  type Fight,
  FLOAT_STACK,
  FLOAT_TICKS,
  fallenAt,
  floatAt,
  HATCH_STROKES,
  hatchAt,
  LIE_TICKS,
  lyingAt,
  NO_FIGHT,
  nextFight,
  ringShare,
  SCRATCH_TICKS,
  STOOP_TICKS,
  shove,
  stoopAt,
  TOPPLE_TICKS,
} from "./fight.ts";

const KINDS = { wolf: { hp: 24, damage: 8, windup: 8, recovery: 20, reach: 2 } };

const actor = (over: Partial<Actor>): Actor =>
  ({
    id: 1,
    name: "Ash",
    kind: "adventurer",
    x: 5,
    y: 5,
    fromX: over.x ?? 5,
    fromY: over.y ?? 5,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    hp: 20,
    windup: 0,
    recover: 0,
    ...over,
    // Cast: the fight reads only the fields above.
  }) as Actor;

const wolf = (over: Partial<Actor>): Actor =>
  actor({ id: 2, name: "Wolf", kind: "wolf", hp: 24, x: 4, y: 5, ...over });

/** The fight after each of a run of ticks, from tick 1: the actors and marks at each. */
function history(ticks: readonly { actors: Actor[]; marks?: Mark[] }[]): Fight {
  let fight = NO_FIGHT;
  ticks.forEach(({ actors, marks = [] }, i) => {
    fight = nextFight(fight, { tick: i + 1, actors, marks, kinds: KINDS } as unknown as World);
  });
  return fight;
}

describe("a fight read off the world", () => {
  it("floats the damage over whoever a landed blow hit, pushes it away and lunges the attacker", () => {
    const fight = history([
      { actors: [actor({}), wolf({ windup: 1 })], marks: [{ x: 5, y: 5, by: 2 }] },
      { actors: [actor({ hp: 12 }), wolf({ recover: 20 })] },
    ]);
    expect(fight.floaters).toEqual([{ since: 2, x: 5, y: 5, damage: 8, order: 0 }]);
    expect(fight.recoils.get(1)).toEqual({ since: 2, dx: 1, dy: 0 });
    expect(fight.lunges.get(2)).toEqual({ since: 2, dx: 1, dy: 0 });
    expect(fight.scratches).toEqual([]);
    // Pushed east, away from the wolf, at the height of the blow.
    expect(shove(fight, 1, 3).x).toBeGreaterThan(0);
    expect(shove(fight, 2, 3).x).toBeGreaterThan(0);
    // The ring eases from full to what is left.
    const ring = fight.rings.get(1);
    expect(ring && ringShare(ring, 2)).toBe(1);
    expect(ring && ringShare(ring, 10)).toBeCloseTo(0.6);
  });

  it("counts a hop off a marked tile as a dodge, and the blow on the empty tile leaves a scratch for a while", () => {
    const fight = history([
      { actors: [actor({}), wolf({ windup: 2 })], marks: [{ x: 5, y: 5, by: 2 }] },
      {
        actors: [actor({ x: 5, y: 4, fromY: 5, moveTicksLeft: 5 }), wolf({ windup: 1 })],
        marks: [{ x: 5, y: 5, by: 2 }],
      },
      { actors: [actor({ x: 5, y: 4, fromY: 5, moveTicksLeft: 4 }), wolf({ recover: 20 })] },
    ]);
    expect(fight.dodges.get(1)).toEqual({ since: 2 });
    expect(fight.floaters).toEqual([]);
    expect(fight.scratches).toEqual([{ since: 3, x: 5, y: 5, dx: 1, dy: 0 }]);
    let later = fight;
    for (let tick = 4; tick < 3 + SCRATCH_TICKS; tick++)
      later = nextFight(later, {
        tick,
        actors: [actor({ x: 5, y: 4 }), wolf({})],
        marks: [],
        kinds: KINDS,
      } as unknown as World);
    expect(later.scratches).toHaveLength(1);
    later = nextFight(later, {
      tick: 3 + SCRATCH_TICKS,
      actors: [actor({ x: 5, y: 4 }), wolf({})],
      marks: [],
      kinds: KINDS,
    } as unknown as World);
    expect(later.scratches).toEqual([]);
  });

  it("leaves a blot that stays about a minute where a monster was killed, and says who killed it", () => {
    const fight = history([
      { actors: [actor({ windup: 1 }), wolf({ hp: 4 })], marks: [{ x: 4, y: 5, by: 1 }] },
      { actors: [actor({ recover: 6 })] },
    ]);
    expect(fight.news).toEqual([{ text: "Ash killed a wolf", who: 1 }]);
    const [fallen] = fight.fallen;
    expect(fallen).toMatchObject({ x: 4, y: 5, kind: "wolf" });
    if (!fallen) return;
    expect(fallenAt(fallen, 2)?.collapse).toBe(0);
    expect(fallenAt(fallen, 2 + COLLAPSE_TICKS)?.collapse).toBe(1);
    expect(fallenAt(fallen, 2 + BLOT_TICKS - 1)?.blot).toBeGreaterThan(0);
    expect(fallenAt(fallen, 2 + BLOT_TICKS)).toBeNull();
    // A minute of stream time, give or take.
    expect(BLOT_TICKS / 10).toBeGreaterThanOrEqual(50);
    expect(BLOT_TICKS / 10).toBeLessThanOrEqual(70);
  });

  it("credits the blow that killed when two residents strike one monster in a tick", () => {
    const elm = (over: Partial<Actor>): Actor => actor({ id: 3, name: "Elm", x: 3, y: 5, ...over });
    const marks = [
      { x: 4, y: 5, by: 1 },
      { x: 4, y: 5, by: 3 },
    ];
    // Ash's blow kills the wolf; Elm's, landing after it, finds nobody.
    const first = history([
      { actors: [actor({ windup: 1 }), wolf({ hp: 4 }), elm({ windup: 1 })], marks },
      { actors: [actor({ recover: 6 }), elm({ recover: 6 })] },
    ]);
    expect(first.news).toEqual([{ text: "Ash killed a wolf", who: 1 }]);
    expect(first.floaters).toEqual([{ since: 2, x: 4, y: 5, damage: 4, order: 0 }]);
    expect(first.scratches).toMatchObject([{ x: 4, y: 5 }]);

    // Neither alone kills: the last blow to land, Elm's, gets the kill, and
    // each blow has its own number, apart from the other.
    const both = history([
      { actors: [actor({ windup: 1 }), wolf({ hp: 8 }), elm({ windup: 1 })], marks },
      { actors: [actor({ recover: 6 }), elm({ recover: 6 })] },
    ]);
    expect(both.news).toEqual([{ text: "Elm killed a wolf", who: 3 }]);
    expect(both.floaters.map((f) => [f.damage, f.order])).toEqual([
      [4, 0],
      [4, 1],
    ]);
    expect(both.scratches).toEqual([]);
  });

  it("stacks a number on a spot where another is still rising, and reuses the place once it is free", () => {
    // The wolf's blow lands at ticks 2 and 3 on the same spot.
    const winding = (hp: number) => ({
      actors: [actor({ hp }), wolf({ windup: 1 })],
      marks: [{ x: 5, y: 5, by: 2 }],
    });
    const fight = history([
      winding(20),
      winding(12),
      { actors: [actor({ hp: 4 }), wolf({ recover: 20 })] },
    ]);
    expect(fight.floaters.map((f) => [f.since, f.order])).toEqual([
      [2, 0],
      [3, 1],
    ]);
    // Long after, a new number on that spot goes back to the first place.
    let later = fight;
    for (let tick = 4; tick < 4 + FLOAT_STACK; tick++) {
      later = nextFight(later, {
        tick,
        actors: [actor({ hp: 4 }), wolf({ windup: tick === 3 + FLOAT_STACK ? 1 : 0 })],
        marks: tick === 3 + FLOAT_STACK ? [{ x: 5, y: 5, by: 2 }] : [],
        kinds: KINDS,
      } as unknown as World);
    }
    later = nextFight(later, {
      tick: 4 + FLOAT_STACK,
      actors: [actor({ hp: 16, x: 14, y: 9 }), wolf({ recover: 20 })],
      marks: [],
      kinds: KINDS,
    } as unknown as World);
    expect(later.floaters.at(-1)).toMatchObject({ since: 4 + FLOAT_STACK, order: 0 });
  });

  it("leaves no blot and no news for a monster that went home", () => {
    const fight = history([{ actors: [actor({}), wolf({})] }, { actors: [actor({})] }]);
    expect(fight.fallen).toEqual([]);
    expect(fight.news).toEqual([]);
    expect(fight.gone).toHaveLength(1);
  });

  it("tells of a resident downed and of one left near death", () => {
    const downed = history([
      { actors: [actor({ hp: 6 }), wolf({ windup: 1 })], marks: [{ x: 5, y: 5, by: 2 }] },
      // Carried back to camp with its hitpoints back.
      { actors: [actor({ x: 14, y: 9, wait: 150 }), wolf({ recover: 20 })] },
    ]);
    expect(downed.news).toEqual([{ text: "Ash was downed by a wolf", who: 1, urgent: true }]);
    expect(downed.fallen).toMatchObject([{ x: 5, y: 5, kind: "adventurer" }]);
    expect(downed.downs.get(1)).toBe(2);
    // It topples and lies where it fell, and only once it fades there does it come in at camp.
    const [laid] = downed.fallen;
    if (!laid) return;
    expect(lyingAt(laid, 2 + TOPPLE_TICKS)).toMatchObject({ tip: 1, alpha: 1 });
    expect(lyingAt(laid, 2 + LIE_TICKS)?.alpha).toBe(1);
    expect(arrivalAt(downed, 1, 2 + LIE_TICKS)).toBe(0);
    expect(lyingAt(laid, 2 + LIE_TICKS + ARRIVE_TICKS)?.alpha).toBe(0);
    expect(arrivalAt(downed, 1, 2 + LIE_TICKS + ARRIVE_TICKS)).toBe(1);
    // The ground where it lay stays marked as long as a monster's blot.
    expect(lyingAt(laid, 2 + BLOT_TICKS - 1)?.scuff).toBeGreaterThan(0);

    const close = history([
      { actors: [actor({ hp: 13 }), wolf({ windup: 1 })], marks: [{ x: 5, y: 5, by: 2 }] },
      { actors: [actor({ hp: 5 }), wolf({ recover: 20 })] },
    ]);
    expect(close.news).toEqual([
      { text: "Ash took a blow from a wolf, 5 hitpoints left", who: 1, close: true },
    ]);
    expect(stoopAt(close, 1, 2)).toBe(0);
    expect(stoopAt(close, 1, 2 + STOOP_TICKS)).toBe(1);
  });

  it("hatches a marked tile stroke by stroke as the wind-up runs, full as the blow lands", () => {
    const ticks = [8, 7, 6, 5, 4, 3, 2, 1].map((windup) => ({
      actors: [actor({}), wolf({ windup })],
      marks: [{ x: 5, y: 5, by: 2 }],
    }));
    let fight = NO_FIGHT;
    const strokes: number[] = [];
    ticks.forEach(({ actors, marks }, i) => {
      fight = nextFight(fight, { tick: i + 1, actors, marks, kinds: KINDS } as unknown as World);
      strokes.push(hatchAt(fight, 2, i + 1));
    });
    for (let i = 1; i < strokes.length; i++)
      expect(strokes[i]).toBeGreaterThan(strokes[i - 1] as number);
    expect(strokes[0]).toBeGreaterThan(0);
    expect(hatchAt(fight, 2, 9)).toBe(HATCH_STROKES);
  });

  it("floats a number up and fades it out within its life", () => {
    const floater = { since: 10, x: 0, y: 0, damage: 4, order: 0 };
    const early = floatAt(floater, 11);
    const late = floatAt(floater, 10 + FLOAT_TICKS - 1);
    expect(early && late && late.rise > early.rise).toBe(true);
    expect(late && late.alpha < 1).toBe(true);
    expect(floatAt(floater, 10 + FLOAT_TICKS)).toBeNull();
    expect(floatAt(floater, 9)).toBeNull();
  });
});
