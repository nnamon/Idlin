import {
  type Actor,
  compileBots,
  createWorld,
  placeConstants,
  spawnsNearCamp,
  step,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { botSources, shippedWorld } from "../../sim/src/testing.ts";
import {
  BEAT_TICKS,
  beat,
  EASE_TICKS,
  EAT_TICKS,
  type Effects,
  GLYPH_IN,
  GLYPH_OUT,
  GLYPH_TICKS,
  glyphAt,
  glyphOf,
  LEAN_BACK,
  LEAN_TICKS,
  leanAt,
  NO_EFFECTS,
  nextEffects,
  ROUTE_TICKS,
  routeAt,
  SNAP_FORWARD,
  SNAP_TICKS,
  walkAt,
} from "./effects.ts";

const HOME = { x: 10, y: 10 };

const actor = (over: Partial<Actor>): Actor =>
  ({
    id: 1,
    name: "Ash",
    x: 5,
    y: 5,
    fromX: 5,
    fromY: 5,
    moveTicksLeft: 0,
    path: [],
    wait: 0,
    rule: 0,
    fault: 0,
    ...over,
    // Cast: the effects read only the fields above.
  }) as Actor;

/** The effects after each of a run of ticks, one actor's state per tick, from tick 1. */
function history(states: readonly Partial<Actor>[]): Effects {
  let effects = NO_EFFECTS;
  states.forEach((state, i) => {
    effects = nextEffects(effects, [actor(state)], i + 1, HOME);
  });
  return effects;
}

describe("glyphs", () => {
  it("show what a resident has just set out to do", () => {
    expect(glyphOf(actor({ path: [{ x: 6, y: 5 }] }), HOME)).toBe("walk");
    expect(glyphOf(actor({ path: [{ x: 9, y: 10 }] }), HOME)).toBe("home");
    // Anywhere in the camp area: a crowd going home stops two to five tiles out.
    expect(glyphOf(actor({ path: [{ x: 7, y: 12 }] }), HOME)).toBe("home");
    expect(glyphOf(actor({ path: [{ x: 7, y: 13 }] }), HOME)).toBe("walk");
    expect(glyphOf(actor({ wait: 30 }), HOME)).toBe("rest");
    expect(glyphOf(actor({ fault: 2, path: [{ x: 6, y: 5 }] }), HOME)).toBe("confused");
  });

  it("start when the rule in charge changes, or the program faults, and not on a resident's first tick", () => {
    expect(history([{ rule: 2 }]).glyphs.size).toBe(0);
    expect(history([{ rule: 0 }, { rule: 0, path: [{ x: 6, y: 5 }] }]).glyphs.size).toBe(0);
    const changed = history([{ rule: 0 }, { rule: 1, path: [{ x: 10, y: 10 }] }]);
    expect(changed.glyphs.get(1)).toEqual({ glyph: "home", since: 2 });
    const faulted = history([{ rule: 0 }, { rule: 0, fault: 3, wait: 30 }]);
    expect(faulted.glyphs.get(1)).toEqual({ glyph: "confused", since: 2 });
  });

  it(`stay ${GLYPH_TICKS} ticks, in over one and at full ink until the last four`, () => {
    const effects = history([{ rule: 0 }, { rule: 1, wait: 30 }]);
    const alpha = (t: number) => glyphAt(effects, 1, 2 + t)?.alpha ?? 0;
    expect(alpha(0)).toBe(0);
    expect(alpha(0.5)).toBeGreaterThan(0);
    expect(alpha(0.5)).toBeLessThan(1);
    for (let t = GLYPH_IN; t <= GLYPH_TICKS - GLYPH_OUT; t++) expect(alpha(t)).toBe(1);
    expect(alpha(GLYPH_TICKS - 2)).toBeLessThan(1);
    expect(alpha(GLYPH_TICKS - 2)).toBeGreaterThan(alpha(GLYPH_TICKS - 1));
    expect(alpha(GLYPH_TICKS - 0.5)).toBeGreaterThan(0);
    expect(alpha(GLYPH_TICKS)).toBe(0);
    // Gone from the record once over.
    const later = nextEffects(effects, [actor({ rule: 1 })], 2 + GLYPH_TICKS, HOME);
    expect(later.glyphs.has(1)).toBe(false);
  });
});

describe("routes", () => {
  it(`start when a walk starts or heads somewhere new, and last ${ROUTE_TICKS} ticks`, () => {
    const walk = {
      path: [
        { x: 6, y: 5 },
        { x: 7, y: 5 },
      ],
    };
    expect(history([{}, walk]).routes.get(1)).toEqual({
      since: 2,
      lane: 0,
      goal: { x: 7, y: 5 },
      stopped: null,
    });
    // A walk going on is no new walk; one to a new goal is.
    expect(history([walk, walk]).routes.has(1)).toBe(false);
    expect(
      history([
        walk,
        {
          path: [
            { x: 6, y: 5 },
            { x: 6, y: 6 },
          ],
        },
      ]).routes.get(1)?.since,
    ).toBe(2);
    // A walk given up mid-step leaves nothing to draw a route along.
    expect(history([walk, { x: 6, moveTicksLeft: 3 }]).routes.has(1)).toBe(false);
  });

  it(`come in, are taken up from the walker's end before ${ROUTE_TICKS} ticks, and leave the cross to fade`, () => {
    const walk = {
      path: [
        { x: 6, y: 5 },
        { x: 40, y: 5 },
      ],
    };
    const effects = history([{}, walk]);
    const at = (t: number) => routeAt(effects, 1, 2 + t);
    expect(at(-0.5)).toBeNull();
    expect(at(0)).toBeNull();
    expect(at(1)?.line).toBeGreaterThan(0);
    expect(at(1)?.line).toBeLessThan(1);
    for (const t of [EASE_TICKS, ROUTE_TICKS - EAT_TICKS]) {
      expect(at(t)).toMatchObject({ line: 1, eaten: 0, cross: 1 });
    }
    // Eaten bit by bit, never all at once.
    const eaten = [1, 3, 5, 7, 9].map((t) => at(ROUTE_TICKS - EAT_TICKS + t)?.eaten ?? 0);
    for (let i = 1; i < eaten.length; i++) expect(eaten[i]).toBeGreaterThan(eaten[i - 1] as number);
    expect(eaten[eaten.length - 1]).toBeLessThan(1);
    // Then the cross alone, fading.
    expect(at(ROUTE_TICKS)).toMatchObject({ line: 0, cross: 1 });
    expect(at(ROUTE_TICKS + 1)?.cross).toBeLessThan(1);
    expect(at(ROUTE_TICKS + 1)?.cross).toBeGreaterThan(at(ROUTE_TICKS + 2)?.cross ?? 1);
    expect(at(ROUTE_TICKS + EASE_TICKS)).toBeNull();
  });

  it("end with the walk, leaving the cross to fade where it was going", () => {
    const walk = { path: [{ x: 6, y: 5 }] };
    const step = { x: 6, fromX: 5, moveTicksLeft: 1 };
    const effects = history([{}, walk, walk, walk, walk, step, { x: 6, fromX: 6 }]);
    expect(effects.routes.get(1)?.stopped).toBe(7);
    expect(routeAt(effects, 1, 7)).toMatchObject({ line: 0, cross: 1, goal: { x: 6, y: 5 } });
    expect(routeAt(effects, 1, 8)?.cross).toBeLessThan(1);
    expect(routeAt(effects, 1, 8)?.cross).toBeGreaterThan(0);
    expect(routeAt(effects, 1, 7 + EASE_TICKS)).toBeNull();
  });

  it("that run at once take different lanes", () => {
    const walk = (id: number) =>
      actor({
        id,
        path: [
          { x: 6, y: 5 },
          { x: 7, y: 5 },
        ],
      });
    let effects = nextEffects(
      NO_EFFECTS,
      [actor({ id: 1 }), actor({ id: 2 }), actor({ id: 3 })],
      1,
      HOME,
    );
    effects = nextEffects(effects, [walk(1), walk(2), actor({ id: 3 })], 2, HOME);
    effects = nextEffects(effects, [walk(1), walk(2), walk(3)], 3, HOME);
    expect([1, 2, 3].map((id) => effects.routes.get(id)?.lane)).toEqual([0, 1, 2]);
  });
});

describe("a gap in ticks", () => {
  it("is treated like a first tick: nothing starts from changes across it", () => {
    const before = nextEffects(NO_EFFECTS, [actor({ rule: 0 })], 10, HOME);
    // A live viewer that lost the server sees the world again 300 ticks on.
    const after = nextEffects(before, [actor({ rule: 2, path: [{ x: 6, y: 5 }] })], 310, HOME);
    expect(after.glyphs.size + after.routes.size + after.beats.size).toBe(0);
    // And the next tick follows on as usual.
    const next = nextEffects(after, [actor({ rule: 3, path: [{ x: 6, y: 5 }] })], 311, HOME);
    expect(next.glyphs.get(1)?.since).toBe(311);
  });
});

describe("the three beats", () => {
  it("lean back over three ticks, snap forward in one and settle over three", () => {
    expect(BEAT_TICKS).toBe(7);
    expect(beat(0, 1)).toBe(0);
    // Leaning away from the way it goes, further each tick.
    expect(beat(1, 1)).toBeLessThan(0);
    expect(beat(2, 1)).toBeLessThan(beat(1, 1));
    expect(beat(LEAN_TICKS, 1)).toBeCloseTo(-LEAN_BACK);
    // The snap, past upright, all within one tick.
    expect(beat(LEAN_TICKS + 0.5, 1)).toBeGreaterThan(-LEAN_BACK);
    expect(beat(LEAN_TICKS + SNAP_TICKS, 1)).toBeCloseTo(SNAP_FORWARD);
    // Settling back upright.
    expect(beat(5, 1)).toBeLessThan(SNAP_FORWARD);
    expect(beat(5, 1)).toBeGreaterThan(beat(6, 1));
    expect(beat(6, 1)).toBeGreaterThan(0);
    expect(beat(BEAT_TICKS, 1)).toBe(0);
    // Going west, the same beats mirrored.
    for (const t of [1, 3, 4, 5.5]) expect(beat(t, -1)).toBeCloseTo(-beat(t, 1));
  });

  it("on setting off, lean back from the first step; on pulling up, against the last", () => {
    const east = { path: [{ x: 6, y: 5 }] };
    const start = history([{}, east]);
    expect(start.beats.get(1)).toEqual({ since: 2, dir: 1 });
    expect(leanAt(start, 1, 2 + LEAN_TICKS)).toBeCloseTo(-LEAN_BACK);
    // A step west, then standing: the beat leans the top east, back against the way it went.
    const stop = history([{}, { x: 4, fromX: 5, moveTicksLeft: 1 }, { x: 4, fromX: 4 }]);
    expect(stop.beats.get(1)).toEqual({ since: 3, dir: -1 });
    expect(leanAt(stop, 1, 3 + LEAN_TICKS)).toBeCloseTo(LEAN_BACK);
    // Walking on with no stop in between is no beat.
    expect(history([east, { x: 6, fromX: 5, moveTicksLeft: 5 }]).beats.has(1)).toBe(false);
  });
});

describe("how far into a walk", () => {
  it("eases in over the beats on setting off and out over them on pulling up", () => {
    const east = { x: 6, fromX: 5, moveTicksLeft: 5, path: [{ x: 7, y: 5 }] };
    const start = history([{}, east]);
    expect(walkAt(start, 1, 2)).toBe(0);
    expect(walkAt(start, 1, 2 + BEAT_TICKS / 2)).toBeCloseTo(0.5);
    expect(walkAt(start, 1, 2 + BEAT_TICKS)).toBe(1);
    let before = 0;
    for (let t = 2; t <= 2 + BEAT_TICKS; t += 0.25) {
      expect(walkAt(start, 1, t)).toBeGreaterThanOrEqual(before);
      before = walkAt(start, 1, t);
    }
    // Walking on, long after setting off: all the way in.
    expect(walkAt(history([east, east, east, east, east, east, east, east, east]), 1, 9.5)).toBe(1);
    // Seen first mid-walk, then stopping: all the way out from all the way in.
    const stop = history([
      { x: 4, fromX: 5, moveTicksLeft: 1 },
      { x: 4, fromX: 4 },
    ]);
    expect(walkAt(stop, 1, 2)).toBe(1);
    expect(walkAt(stop, 1, 2 + BEAT_TICKS / 2)).toBeCloseTo(0.5);
    expect(walkAt(stop, 1, 2 + BEAT_TICKS)).toBe(0);
    // Standing still, and someone never seen.
    expect(walkAt(history([{}, {}]), 1, 2.5)).toBe(0);
    expect(walkAt(start, 99, 2.5)).toBe(0);
  });

  it("stands upright while held up on a walk, though the walk still has a goal", () => {
    const stepping = { x: 6, fromX: 5, moveTicksLeft: 3, path: [{ x: 7, y: 5 }] };
    // The step ends and the next tile is taken: it waits there, its path intact.
    const held = { x: 6, fromX: 6, moveTicksLeft: 0, path: [{ x: 7, y: 5 }] };
    const states = [stepping, stepping, ...Array.from({ length: 12 }, () => held)];
    const effects = history(states);
    expect(effects.seen.get(1)?.goal).toBe("7,5");
    expect(walkAt(effects, 1, states.length + 0.5)).toBe(0);
  });

  it("carries on from where the ease had got to when a walk starts again soon after stopping", () => {
    const stepping = { x: 6, fromX: 5, moveTicksLeft: 3, path: [{ x: 7, y: 5 }] };
    const standing = { x: 6, fromX: 6 };
    // Walking, stopped at tick 9, off again at tick 12.
    const states = [...Array.from({ length: 8 }, () => stepping), standing, standing, standing];
    const stopped = history(states);
    const at = walkAt(stopped, 1, 12);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(1);
    const again = history([...states, stepping]);
    // No jump at the restart, and back up from there.
    expect(walkAt(again, 1, 12)).toBeCloseTo(at);
    expect(walkAt(again, 1, 12.5)).toBeGreaterThan(at);
    expect(walkAt(again, 1, 12 + BEAT_TICKS)).toBe(1);
  });
});

describe("effects over a real run", () => {
  it("are a function of the world's history and the time alone", () => {
    const map = shippedWorld();
    const sources = botSources();
    const run = (): string[] => {
      const world = createWorld(map, 1, compileBots(sources, placeConstants(map)));
      const camp = placeConstants(map).camp as { x: number; y: number };
      step(
        world,
        spawnsNearCamp(
          world,
          ["Ash", "Birch", "Cedar", "Dara", "Elm", "Fen"].map((name, i) => ({
            name,
            program: ["wanderer", "homebody", "riverwalker"][i % 3] as string,
          })),
        ),
      );
      let effects = NO_EFFECTS;
      const seen: string[] = [];
      for (let tick = 0; tick < 1200; tick++) {
        step(world);
        effects = nextEffects(effects, world.actors, world.tick, camp);
        for (const { id } of world.actors) {
          const time = world.tick + 0.5;
          seen.push(
            `${glyphAt(effects, id, time)?.glyph ?? "-"}:${(routeAt(effects, id, time)?.cross ?? 0).toFixed(3)}:${leanAt(effects, id, time).toFixed(4)}`,
          );
        }
      }
      return seen;
    };
    const first = run();
    expect(run()).toEqual(first);
    // Something happened to compare: routes and beats both came up.
    expect(first.some((s) => !s.includes(":0.000:"))).toBe(true);
    expect(first.some((s) => !s.endsWith(":0.0000") && !s.endsWith(":-0.0000"))).toBe(true);
  });
});
