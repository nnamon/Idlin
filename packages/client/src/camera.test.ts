import {
  ADVENTURER,
  type Blow,
  blowsOf,
  compileBots,
  createWorld,
  placeConstants,
  regionAt,
  spawnsNearCamp,
  step,
  type World,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { botSources, shippedWorld } from "../../sim/src/testing.ts";
import {
  arrival,
  type Camera,
  cameraOn,
  DRIFT_TICKS,
  FOLLOW_TICKS,
  legAt,
  nextCamera,
  nextWatch,
  noticesOf,
  regionOf,
  routeBetween,
  startWatch,
  viewAt,
  type Watch,
} from "./camera.ts";
import { castOf } from "./cast.ts";
import { NO_FIGHT } from "./fight.ts";

// The shipped world: the camp at (0, 0), the pinewood west of it at (-30, 0),
// the hills east at (30, 0) and the lower river south at (0, 21), each joined
// to the camp by one exit and to nothing else.
const atlas = shippedWorld();
const [CAMP, PINE, HILLS, RIVER] = [0, 1, 2, 3];

describe("the way between regions", () => {
  it("goes along the exits, through the camp when two regions do not meet", () => {
    expect(routeBetween(atlas, CAMP, HILLS)).toEqual([CAMP, HILLS]);
    expect(routeBetween(atlas, HILLS, CAMP)).toEqual([HILLS, CAMP]);
    expect(routeBetween(atlas, PINE, HILLS)).toEqual([PINE, CAMP, HILLS]);
    expect(routeBetween(atlas, RIVER, PINE)).toEqual([RIVER, CAMP, PINE]);
    expect(routeBetween(atlas, RIVER, RIVER)).toEqual([RIVER]);
    // A world of one region has nowhere else to go.
    expect(routeBetween({ ...atlas, exits: [] }, CAMP, HILLS)).toEqual([]);
  });
});

describe("which region the view is on", () => {
  /** The camera after wanting `want` at each tick from `from` to `to`, both included. */
  const wanting = (camera: Camera, want: number, from: number, to: number): Camera => {
    let next = camera;
    for (let tick = from; tick <= to; tick++) next = nextCamera(next, atlas, want, tick);
    return next;
  };

  it("drifts to a region wanted for long enough, and finishes a drift before another", () => {
    let camera: Camera = cameraOn(CAMP);
    // Wanting nowhere in particular, or where it is, moves nothing.
    expect(wanting(camera, -1, 10, 500).route).toEqual([CAMP]);
    expect(wanting(camera, CAMP, 10, 500).route).toEqual([CAMP]);
    // The hills wanted for less than FOLLOW_TICKS, then the camp again: it stays.
    camera = wanting(camera, HILLS, 10, 10 + FOLLOW_TICKS - 1);
    expect(camera.route).toEqual([CAMP]);
    expect(wanting(camera, CAMP, 10 + FOLLOW_TICKS, 500).route).toEqual([CAMP]);
    // Wanted for FOLLOW_TICKS, it sets out.
    camera = wanting(cameraOn(CAMP), HILLS, 10, 10 + FOLLOW_TICKS);
    const set = 10 + FOLLOW_TICKS;
    expect([camera.route, camera.since]).toEqual([[CAMP, HILLS], set]);
    expect(regionOf(camera)).toBe(HILLS);
    expect(arrival(camera)).toBe(set + DRIFT_TICKS);
    // Under way it does not turn: the pinewood, wanted from the next tick,
    // has to wait until it has got to the hills.
    const there = set + DRIFT_TICKS;
    const under = wanting(camera, PINE, set + 1, there - 1);
    expect([under.route, under.since]).toEqual([[CAMP, HILLS], set]);
    camera = nextCamera(under, atlas, PINE, there);
    expect([camera.route, camera.since]).toEqual([[HILLS, CAMP, PINE], there]);
    // Two regions on, it gets there after two drifts.
    expect(arrival(camera)).toBe(there + 2 * DRIFT_TICKS);
    // A region with no way to it is not drifted to.
    const alone = { ...atlas, exits: [] };
    let stuck = cameraOn(CAMP);
    for (let tick = 0; tick < 100; tick++) stuck = nextCamera(stuck, alone, HILLS, tick);
    expect(stuck.route).toEqual([CAMP]);
  });

  it("moves without a cut: eased from rest to rest, never faster than half again its mean", () => {
    const camera: Camera = {
      route: [PINE, CAMP, HILLS],
      since: 100,
      wanted: { region: HILLS, since: 80 },
    };
    // Before it sets out, it is on the pinewood; halfway through a leg, halfway along.
    expect(viewAt(camera, atlas, 0)).toEqual({ x: -30, y: 0 });
    expect(viewAt(camera, atlas, 100)).toEqual({ x: -30, y: 0 });
    expect(viewAt(camera, atlas, 100 + DRIFT_TICKS / 2)).toEqual({ x: -15, y: 0 });
    expect(viewAt(camera, atlas, 100 + DRIFT_TICKS)).toEqual({ x: 0, y: 0 });
    expect(legAt(camera, 100 + DRIFT_TICKS)).toEqual({ from: CAMP, to: HILLS, share: 0 });
    expect(viewAt(camera, atlas, 100 + 2 * DRIFT_TICKS)).toEqual({ x: 30, y: 0 });
    expect(viewAt(camera, atlas, 1e9)).toEqual({ x: 30, y: 0 });
    // Frame by frame at six frames a tick: it only goes one way, it slows to
    // a stop at the camp between the legs and at the end, and no frame moves
    // further than 1.5 times the mean step (30 tiles in DRIFT_TICKS).
    const frames = Array.from({ length: 6 * (2 * DRIFT_TICKS + 20) + 1 }, (_, i) =>
      viewAt(camera, atlas, 95 + i / 6),
    );
    const steps = frames.slice(1).map((f, i) => f.x - (frames[i] as { x: number }).x);
    const mean = 30 / (6 * DRIFT_TICKS);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...steps)).toBeLessThanOrEqual(1.5 * mean + 1e-9);
    expect(frames.every((f) => f.y === 0)).toBe(true);
    const atCamp = 6 * (5 + DRIFT_TICKS);
    expect(Math.abs((steps[atCamp] as number) + (steps[atCamp - 1] as number))).toBeLessThan(
      mean / 20,
    );
    // South to the lower river it moves down, as far as one region is tall.
    const south: Camera = { route: [CAMP, RIVER], since: 0, wanted: { region: RIVER, since: 0 } };
    expect(viewAt(south, atlas, DRIFT_TICKS)).toEqual({ x: 0, y: 21 });
    expect(viewAt(south, atlas, DRIFT_TICKS / 4).x).toBe(0);
  });
});

describe("the watch over the shipped world", () => {
  /** Six residents of the shipped programs, from seed 1, watched for a game day. */
  function day(): Watch[] {
    const world = createShipped();
    let watch = startWatch(world.atlas);
    const watches: Watch[] = [];
    let blows: Blow[] = [];
    for (let tick = 0; tick < 24 * 600; tick++) {
      watch = nextWatch(watch, world, blows);
      watches.push(watch);
      blows = blowsOf(step(world));
    }
    return watches;
  }

  it("follows the spotlit resident to its region, and drifts there in the day", () => {
    const world = createShipped();
    let watch = startWatch(world.atlas);
    expect(regionOf(watch.camera)).toBe(CAMP);
    // How long the spotlit resident has been in the region it is in.
    let since = 0;
    let last: { subject: number | null; region: number } | null = null;
    let drifts = 0;
    let lagging = 0;
    // A drift under way, of two regions at most, then FOLLOW_TICKS of wanting.
    const settle = 2 * DRIFT_TICKS + FOLLOW_TICKS + 1;
    let blows: Blow[] = [];
    for (let tick = 0; tick < 24 * 600; tick++) {
      const before = watch.camera.since;
      watch = nextWatch(watch, world, blows);
      if (watch.camera.since !== before) drifts++;
      const subject = world.actors.find((a) => a.id === watch.subject && a.kind === ADVENTURER);
      const region = subject ? regionAt(world.atlas, subject.x, subject.y) : -1;
      if (!last || last.subject !== watch.subject || last.region !== region) since = tick;
      last = { subject: watch.subject, region };
      // Once the same resident has been in one region for long enough to get
      // there from anywhere, the view is on that region.
      if (subject && tick - since >= settle && regionOf(watch.camera) !== region) lagging++;
      blows = blowsOf(step(world));
    }
    expect(lagging).toBe(0);
    // At least one trip out of the camp and back, so the view did follow someone.
    expect(drifts).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("is the same for the same worlds", () => {
    const first = day().map((w) => [w.subject, w.camera.since, ...w.camera.route]);
    const second = day().map((w) => [w.subject, w.camera.since, ...w.camera.route]);
    expect(second).toEqual(first);
  }, 60_000);

  it("reads a change of rule and a resident downed off the worlds it is sent", () => {
    const world = createShipped();
    const [ash, birch] = world.actors as [World["actors"][number], World["actors"][number]];
    const notices = noticesOf(world, { ...NO_FIGHT, downs: new Map([[birch.id, world.tick]]) });
    expect(notices).toContainEqual({ type: "decide", actor: ash.id, rule: ash.rule });
    expect(notices).toContainEqual({ type: "down", actor: birch.id, by: birch.id });
    // Downed at an earlier tick is not news now.
    const later = noticesOf(world, { ...NO_FIGHT, downs: new Map([[birch.id, world.tick - 1]]) });
    expect(later.some((n) => n.type === "down")).toBe(false);
    // Monsters are not the director's business.
    expect(
      notices.every((n) => world.actors.find((a) => a.id === n.actor)?.kind === ADVENTURER),
    ).toBe(true);
  });
});

/** The shipped world with six residents just spawned at camp, as the viewer starts it for seed 1. */
function createShipped(): World {
  const world = createWorld(atlas, 1, compileBots(botSources(), placeConstants(atlas)));
  step(world, spawnsNearCamp(world, castOf(6)));
  return world;
}
