import {
  ADVENTURER,
  compileBots,
  createWorld,
  placeConstants,
  regionAt,
  spawnsNearCamp,
  step,
  type World,
} from "@idlin/sim";
import { describe, expect, it } from "vitest";
import { botSources, shippedMonsters, shippedWorld } from "../../sim/src/testing.ts";
import {
  arrival,
  type Camera,
  cameraOn,
  DRIFT_TICKS,
  FOLLOW_TICKS,
  HOLD_TICKS,
  legAt,
  nextCamera,
  nextWatch,
  noticesOf,
  REASON,
  reasonLine,
  reasonOf,
  regionOf,
  routeBetween,
  STAY_TICKS,
  startWatch,
  viewAt,
  type Watch,
  wantedRegion,
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

  it("leaves a region nobody is in without waiting", () => {
    // On the hills with nobody there, the camp wanted from tick 10: it sets out at once.
    const camera = nextCamera(cameraOn(HILLS), atlas, CAMP, 10, true);
    expect([camera.route, camera.since]).toEqual([[HILLS, CAMP], 10]);
    // With someone there it waits FOLLOW_TICKS as usual.
    expect(nextCamera(cameraOn(HILLS), atlas, CAMP, 10, false).route).toEqual([HILLS]);
  });

  it("turns back part-way, without a jolt, when the region it is going to empties", () => {
    const out: Camera = { route: [CAMP, HILLS], since: 0, wanted: { region: HILLS, since: 0 } };
    // Someone is still in the hills: it carries on.
    expect(nextCamera(out, atlas, CAMP, 30, false).route).toEqual([CAMP, HILLS]);
    // The hills have emptied and the camp is wanted: it turns at tick 30.
    const back = nextCamera(out, atlas, CAMP, 30, true);
    expect([back.route, back.since, regionOf(back), arrival(back)]).toEqual([
      [HILLS, CAMP],
      30,
      CAMP,
      30 + DRIFT_TICKS,
    ]);
    // Wanting a region that lies on ahead does not turn it.
    const pine: Camera = { route: [PINE, CAMP], since: 0, wanted: { region: CAMP, since: 0 } };
    expect(nextCamera(pine, atlas, HILLS, 30, true).route).toEqual([PINE, CAMP]);
    // Frame by frame at six a tick across the turn: no jump where it turns,
    // the same speed either side of it, then slowing to rest on the camp.
    const at = (time: number) => (time < 30 ? viewAt(out, atlas, time) : viewAt(back, atlas, time));
    const frames = Array.from({ length: 6 * (DRIFT_TICKS + 20) }, (_, i) => at(20 + i / 6).x);
    const steps = frames.slice(1).map((x, i) => x - (frames[i] as number));
    const mean = 30 / (6 * DRIFT_TICKS);
    const turn = 6 * 10;
    expect(Math.abs((steps[turn] as number) - (steps[turn - 1] as number))).toBeLessThan(mean / 10);
    expect(Math.max(...steps.map(Math.abs))).toBeLessThanOrEqual(2 * mean);
    // It goes on a little further, comes about once, and ends at the camp.
    expect(
      steps.slice(turn).filter((d, i) => i > 0 && d * (steps[turn + i - 1] as number) < 0),
    ).toHaveLength(1);
    expect(at(30 + DRIFT_TICKS)).toEqual({ x: 0, y: 0 });
    expect(viewAt(back, atlas, 1e9)).toEqual({ x: 0, y: 0 });
  });

  it("does not set out for a region its subject is leaving, nor for a dwell about to end", () => {
    const long = 450;
    const standing = (x: number, y: number) => ({ x, y, path: [] });
    const walking = (x: number, y: number, to: { x: number; y: number }) => ({
      x,
      y,
      path: [to],
    });
    // The subject has a haul to show (weight 2) unless said otherwise.
    const want = (
      subject: Parameters<typeof wantedRegion>[1],
      here: number,
      empty: boolean,
      left: number,
      weight = REASON.haul,
      bar = 0,
    ) => wantedRegion(atlas, subject, { here, empty, left, weight, bar, camp: CAMP });
    // In the hills, staying there: the view goes there.
    expect(want(standing(40, 10), CAMP, false, long)).toBe(HILLS);
    expect(want(walking(40, 10, { x: 50, y: 12 }), CAMP, false, long)).toBe(HILLS);
    // In the hills but walking back into the camp, where the view is: it stays.
    expect(want(walking(31, 10, { x: 10, y: 10 }), CAMP, false, long)).toBe(CAMP);
    // In the hills, walking on to the pinewood: not the hills, and from a
    // camp with people in it, nowhere yet.
    const through = walking(31, 10, { x: -10, y: 10 });
    expect(want(through, CAMP, false, long)).toBe(-1);
    // From the river with nobody in it, on ahead to where the walk ends.
    expect(want(through, RIVER, true, long)).toBe(PINE);
    // On the view's region, walking out of it: the view stays with it until it is out.
    expect(want(walking(10, 10, { x: 40, y: 10 }), CAMP, false, long)).toBe(CAMP);
    // Too little of the dwell left to get there and show it for STAY_TICKS: it stays.
    const hills = standing(40, 10);
    expect(want(hills, CAMP, false, DRIFT_TICKS + STAY_TICKS)).toBe(HILLS);
    expect(want(hills, CAMP, false, DRIFT_TICKS + STAY_TICKS - 1)).toBe(-1);
    // Two regions away it takes two drifts.
    expect(want(standing(-10, 10), HILLS, false, 2 * DRIFT_TICKS + STAY_TICKS - 1)).toBe(-1);
    // Unless the view is on an empty region, where staying shows nothing.
    expect(want(hills, RIVER, true, 1)).toBe(HILLS);
  });

  it("says on the news line why it sets out", () => {
    const bag = (...goods: number[]) => [...goods, ...Array(12 - goods.length).fill(0)];
    expect(reasonLine("haul", { name: "Ash", bag: bag(1, 1, 1, 1, 1) }, "the Pinewood")).toBe(
      "Ash is chopping in the Pinewood, 5 logs",
    );
    expect(reasonLine("haul", { name: "Ash", bag: bag(1) }, "the Pinewood")).toBe(
      "Ash is chopping in the Pinewood, 1 log",
    );
    expect(reasonLine("haul", { name: "Elm", bag: bag(2, 2, 2) }, "the Lower River")).toBe(
      "Elm is fishing in the Lower River, 3 fish",
    );
    // A fight is told by the resident's own line, and a down by the fight's news.
    expect(reasonLine("fight", { name: "Fen", bag: bag() }, "the Hills")).toBeNull();
    expect(reasonLine("down", { name: "Fen", bag: bag() }, "Lantern Camp")).toBeNull();
  });

  it("goes to another region only for a reason, and holds there against anything no stronger", () => {
    const hills = { x: 40, y: 10, path: [] };
    const want = (here: number, empty: boolean, weight: number, bar = 0) =>
      wantedRegion(atlas, hills, { here, empty, left: 450, weight, bar, camp: CAMP });
    // A quiet resident's turn in the hills does not move the view off the camp.
    expect(want(CAMP, false, 0)).toBe(-1);
    // A haul, a fight or a down there does.
    expect(want(CAMP, false, REASON.haul)).toBe(HILLS);
    expect(want(CAMP, false, REASON.fight)).toBe(HILLS);
    // Just arrived at the river for a fight, the view holds against a haul
    // or another fight in the hills, and goes for a down.
    expect(want(RIVER, false, REASON.haul, REASON.fight)).toBe(-1);
    expect(want(RIVER, false, REASON.fight, REASON.fight)).toBe(-1);
    expect(want(RIVER, false, REASON.down, REASON.fight)).toBe(HILLS);
    // On a region nobody is left in it goes all the same: to the camp for a
    // quiet subject, to the subject for one with a reason, and from an empty
    // camp to the subject.
    expect(want(RIVER, true, 0, REASON.fight)).toBe(CAMP);
    expect(want(RIVER, true, REASON.haul, REASON.fight)).toBe(HILLS);
    expect(want(CAMP, true, 0)).toBe(HILLS);
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
    for (let tick = 0; tick < 24 * 600; tick++) {
      watch = nextWatch(watch, world);
      watches.push(watch);
      step(world);
    }
    return watches;
  }

  // How long the view may leave a spotlit resident with something to show
  // out of sight is checked over game days below (`longestAway`).
  it("starts on the camp and drifts out and back in the day", () => {
    const world = createShipped();
    let watch = startWatch(world.atlas);
    expect(regionOf(watch.camera)).toBe(CAMP);
    let drifts = 0;
    for (let tick = 0; tick < 24 * 600; tick++) {
      const before = watch.camera.since;
      watch = nextWatch(watch, world);
      if (watch.camera.since !== before) drifts++;
      step(world);
    }
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
    // A bag with more goods in it than at the tick before is a haul; the same or fewer is not.
    ash.bag[0] = 1;
    const carried = new Map([
      [ash.id, 0],
      [birch.id, 0],
    ]);
    expect(noticesOf(world, NO_FIGHT, carried)).toContainEqual({ type: "haul", actor: ash.id });
    expect(noticesOf(world, NO_FIGHT, carried)).not.toContainEqual({
      type: "haul",
      actor: birch.id,
    });
    expect(noticesOf(world, NO_FIGHT, new Map([[ash.id, 1]])).some((n) => n.type === "haul")).toBe(
      false,
    );
    // Nothing known of the tick before, nothing to compare with.
    expect(noticesOf(world, NO_FIGHT).some((n) => n.type === "haul")).toBe(false);
    ash.bag[0] = 0;
    // Downed at an earlier tick is not news now.
    const later = noticesOf(world, { ...NO_FIGHT, downs: new Map([[birch.id, world.tick - 1]]) });
    expect(later.some((n) => n.type === "down")).toBe(false);
    // Monsters are not the director's business.
    expect(
      notices.every((n) => world.actors.find((a) => a.id === n.actor)?.kind === ADVENTURER),
    ).toBe(true);
  });
});

const LONG = process.env.IDLIN_LONG === "1";

describe("the pans over game days", () => {
  /**
   * Watches `days` game days of the shipped world at `residents` and counts
   * the pans, the pans that turned back part-way (`turns`), and the pans that
   * go out and straight back: the next pan sets out within 10 s of this one's
   * arrival and goes back to where this one began. Of those and the turns,
   * `bounces` are the ones the view should not have made:
   * the resident it went for was already walking out of that region, or was
   * no longer spotlit when the view came back. The rest follow the same
   * resident walking back. Also counts the times the view got to a region
   * with no resident in it, the ticks it spent at rest on one, and the
   * longest the spotlit resident was in a region the view was not on or
   * drifting to.
   */
  function pans(days: number, residents: number, monsters: boolean) {
    const world = createShipped(residents, monsters);
    let watch = startWatch(world.atlas);
    const drifts: {
      start: number;
      end: number;
      set: number;
      there: number;
      subject: number | null;
      leaving: boolean;
      turned: boolean;
      /** Why it went: the subject's reason, or none for a view leaving an empty region. */
      why: string | null;
      fromEmpty: boolean;
      weight: number;
    }[] = [];
    let emptyArrivals = 0;
    let emptyTicks = 0;
    let away = 0;
    let longestAway = 0;
    let offCamp = 0;
    let someoneAway = 0;
    const residentsIn = () =>
      new Set(
        world.actors
          .filter((a) => a.kind === ADVENTURER)
          .map((a) => regionAt(world.atlas, a.x, a.y)),
      );
    for (let tick = 0; tick < days * 24 * 600; tick++) {
      const before = watch.camera;
      const wasEmpty = !residentsIn().has(regionOf(before));
      watch = nextWatch(watch, world);
      const { camera } = watch;
      const subject = world.actors.find((a) => a.id === watch.subject);
      if (camera.since !== before.since) {
        const end = subject?.path.at(-1);
        drifts.push({
          why: watch.reason?.kind ?? null,
          fromEmpty: wasEmpty,
          weight: before.route.length > 1 ? (before.weight ?? 0) : 0,
          start: camera.route[0] as number,
          end: regionOf(camera),
          set: camera.since,
          there: arrival(camera),
          subject: watch.subject,
          leaving: end !== undefined && regionAt(world.atlas, end.x, end.y) !== regionOf(camera),
          turned: camera.turned !== undefined,
        });
      }
      const occupied = residentsIn();
      // Got there this tick, whether or not it sets out again at once.
      if (world.tick === arrival(before) && !occupied.has(regionOf(before))) emptyArrivals++;
      if (world.tick >= arrival(camera) && !occupied.has(regionOf(camera))) emptyTicks++;
      // Out of sight while it has something to show.
      const there = subject ? regionAt(world.atlas, subject.x, subject.y) : -1;
      const busy = reasonOf(watch, watch.subject) !== null;
      away = subject && busy && there !== regionOf(camera) ? away + 1 : 0;
      longestAway = Math.max(longestAway, away);
      if (regionOf(camera) !== CAMP || world.tick < arrival(camera)) offCamp++;
      if ([...occupied].some((region) => region !== CAMP)) someoneAway++;
      step(world);
    }
    // Pans that turned back part-way, and the pans they cut short.
    const turns = drifts.filter((drift) => drift.turned).length;
    const backs = drifts.flatMap((drift, i) => {
      const next = drifts[i + 1];
      return next && next.set - drift.there <= 100 && next.end === drift.start
        ? [{ drift, next }]
        : [];
    });
    const bounces = backs.filter(
      ({ drift, next }) => drift.leaving || next.subject !== drift.subject,
    );
    const set = drifts.filter((drift) => !drift.turned);
    // A pan that set out within HOLD_TICKS of getting somewhere, for a reason
    // no stronger than the one it went there for, from a region with people in it.
    const unheld = set.filter((drift, i) => {
      const last = set[i - 1];
      return (
        last !== undefined &&
        !drift.fromEmpty &&
        drift.set < last.there + HOLD_TICKS &&
        (drift.why === null || REASON[drift.why as keyof typeof REASON] <= drift.weight)
      );
    });
    return {
      pansPerHour: Math.round((10 * set.length) / (days * 24)) / 10,
      withReason: set.filter((drift) => drift.why !== null).length,
      unexplained: set.filter((drift) => drift.why === null && !drift.fromEmpty).length,
      emptied: set.filter((drift) => drift.fromEmpty).length,
      unheld: unheld.length,
      pans: drifts.length - turns,
      turns,
      backs: backs.filter(({ next }) => !next.turned).length,
      bounces: bounces.length,
      emptyArrivals,
      emptyTicks,
      longestAway,
      leavesCamp: drifts.filter((drift) => drift.start === CAMP).length,
      offCampShare: Math.round((100 * offCamp) / (days * 24 * 600)),
      someoneAwayShare: Math.round((100 * someoneAway) / (days * 24 * 600)),
    };
  }

  // Three game days at six residents and one at fifteen in the gate; with
  // monsters, and at twelve, in the capture workflow.
  const runs: [number, number, boolean][] = [
    [3, 6, false],
    [1, 15, false],
    ...(LONG
      ? ([
          [3, 6, true],
          [2, 12, true],
          [3, 15, false],
          [3, 15, true],
        ] as [number, number, boolean][])
      : []),
  ];
  for (const [days, residents, monsters] of runs)
    it(`pans only for a reason, never for a resident leaving, nor rests on an empty region: ${days} days, ${residents} residents${monsters ? ", monsters" : ""}`, () => {
      const counted = pans(days, residents, monsters);
      console.log(JSON.stringify({ days, residents, monsters, ...counted }));
      expect(counted.pans).toBeGreaterThanOrEqual(2 * days);
      // Every pan has a reason, or leaves a region nobody is left in.
      expect(counted.unexplained).toBe(0);
      expect(counted.unheld).toBe(0);
      expect(counted.bounces).toBe(0);
      expect(counted.emptyArrivals).toBe(0);
      expect(counted.emptyTicks).toBe(0);
      // A subject with something to show is out of sight no longer than the
      // hold, the wait and two regions of pan.
      expect(counted.longestAway).toBeLessThanOrEqual(
        HOLD_TICKS + FOLLOW_TICKS + 2 * DRIFT_TICKS + STAY_TICKS,
      );
    }, 600_000);
});

/** The shipped world with `residents` just spawned at camp, as the viewer starts it for seed 1. */
function createShipped(residents = 6, monsters = false): World {
  const loaded = monsters ? shippedMonsters(atlas) : undefined;
  const world = createWorld(
    atlas,
    1,
    { ...compileBots(botSources(), placeConstants(atlas)), ...loaded?.programs },
    loaded?.kinds,
    loaded?.spawns,
  );
  step(world, spawnsNearCamp(world, castOf(residents)));
  return world;
}
