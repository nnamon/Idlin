// The monsters on a landing once laid (docs/slice.md, section 1; piece 5 of
// section 11): dens' clocks and the post a pack let out takes, nothing coming
// out of the ground, keeping to the pocket, leaving a strong citizen alone,
// `pack_*` and `den_*`, outrunning, what the plate letters, and saving.
import { describe, expect, it } from "vitest";
import { terrainOf } from "./atlas.ts";
import { LEGS_PLANT, MARCH, RAMP_DOWN, SIGHTING } from "./cycle.ts";
import { deckMap, landingFor } from "./deck.ts";
import { FULL } from "./hit.ts";
import type { Landing } from "./landing.ts";
import { DEN_GATE, monstersOf, PACK_KINDS, plateGround, walkFrom } from "./laying.ts";
import { ABOARD, type Point, placeConstants } from "./map.ts";
import {
  capOf,
  ELITE,
  inPocket,
  monstersOnPlate,
  NO_PACK,
  type PackState,
  plateLetters,
  roomOfWorld,
} from "./packs.ts";
import { compileBots } from "./tactics.ts";
import { CROWDS, crewCity } from "./testing.ts";
import {
  type Actor,
  ADVENTURER,
  armsOf,
  hashWorld,
  laidKind,
  mending,
  restore,
  STEP_TICKS,
  snapshot,
  step,
  strike,
  type World,
  type WorldEvent,
} from "./world.ts";

const TEST_PROGRAMS = compileBots(
  {
    still: 'otherwise as "stand" -> wait(100)',
    home: 'otherwise as "home" -> walk_to(hold)',
    probe: `otherwise -> set near = pack_distance(-9); set den = den_distance(-9); wait(5)`,
    // Stands until its count is up, then strikes whatever is nearest.
    late: `when count < 40 -> set count = count + 1; wait(5)
when threat_distance <= weapon_reach -> attack(threat_x, threat_y)
otherwise -> wait(5)`,
  },
  placeConstants(deckMap(1)),
);

const runTo = (world: World, tick: number, events: WorldEvent[] = []): WorldEvent[] => {
  while (world.tick < tick) events.push(...step(world));
  return events;
};
const landingOf = (world: World): Landing => {
  const cycle = world.cycle as NonNullable<World["cycle"]>;
  return landingFor(cycle.city, cycle.landing);
};
const citizensOf = (world: World): Actor[] => world.actors.filter((a) => a.kind === ADVENTURER);
const membersOf = (world: World, pack: PackState): Actor[] =>
  world.actors.filter((a) => a.pack === pack.id);
const tileOf = (landing: Landing, p: Point): number =>
  (p.y + landing.city.y) * landing.width + p.x + landing.city.x;
const pointOf = (landing: Landing, t: number): Point => ({
  x: (t % landing.width) - landing.city.x,
  y: Math.floor(t / landing.width) - landing.city.y,
});
/** Puts a citizen down on (x, y), standing, with `program`. */
function place(actor: Actor, at: Point, program: string): void {
  Object.assign(actor, { x: at.x, y: at.y, fromX: at.x, fromY: at.y, path: [], program, wait: 0 });
  Object.assign(actor, { moveTicksLeft: 0, rule: -1, memory: actor.memory.map(() => 0) });
}

describe("a landing of 150 awake, from legs-plant to the march", () => {
  // The first city's medium landing: its dens fill, its room is small, and the plate meets its cap.
  const world = crewCity({ seed: 5, city: 1, size: "medium", level: 8, tiers: CROWDS[1][150] });
  const turns: WorldEvent[] = [];
  const problems: string[] = [];
  let laid: WorldEvent | undefined;
  let everyAtPlant: number[] = [];
  let insideAtPlant: number[] = [];
  let firstTwo: number[] = [];
  let highest = 0;
  const seen = new Set<number>();
  // Run once; each test reads what it needs from the record.
  const record = (): void => {
    for (const e of runTo(world, LEGS_PLANT)) if (e.type === "laid") laid = e;
    const plate = world.plate;
    if (!plate) throw new Error("a plate at legs-plant");
    const lettered = landingFor(1, (world.cycle as NonNullable<World["cycle"]>).landing);
    everyAtPlant = plate.dens.map((d) => d.every);
    insideAtPlant = plate.dens.map((d) => d.queue.length);
    firstTwo = plate.dens.map(
      (_, n) => plate.packs.filter((p) => p.den === n && p.kind !== ELITE).length,
    );
    for (const a of world.actors) seen.add(a.id);
    const last = plate.dens.map(() => LEGS_PLANT);
    const ground = plateGround(lettered);
    while (world.tick < MARCH) {
      // The world as the tick will find it: the packs that still have monsters, and the citizens out.
      const before = monstersOnPlate(world);
      const alive = new Set(world.actors.filter((a) => a.pack > 0).map((a) => a.pack));
      const held = plate.packs
        .filter((p) => alive.has(p.id) && p.kind !== ELITE && PACK_KINDS[p.kind] !== "guard")
        .map((p) => tileOf(lettered, p));
      const out = citizensOf(world)
        .filter((c) => !mending(c) && !ABOARD.has(terrainOf(world.atlas, c.x, c.y) as never))
        .map((c) => tileOf(lettered, c))
        .filter((t) => ground.open[t]);
      const known = new Set(plate.packs.map((p) => p.id));
      const events = step(world);
      const dens = events.filter((e) => e.type === "den");
      turns.push(...dens);
      // Turns on one tick go in order of the longest since a pack came out, then den number.
      const order = dens.map((e) => (e.type === "den" ? e.den : -1));
      const sorted = [...order].sort((p, q) => (last[p] as number) - (last[q] as number) || p - q);
      if (order.join() !== sorted.join()) problems.push(`tick ${world.tick}: turns ${order}`);
      if (dens[0]?.type === "den" && dens[0].monsters !== before)
        problems.push(`tick ${world.tick}: counted ${dens[0].monsters}, held ${before}`);
      const made = plate.packs.filter((p) => !known.has(p.id));
      const outs = dens.filter((e) => e.type === "den" && e.out);
      if (made.length !== outs.length)
        problems.push(`tick ${world.tick}: ${made.length} new packs`);
      const walk =
        out.length === 0
          ? ground.walk
          : walkFrom(lettered.width, lettered.height, ground.open, out);
      outs.forEach((e, k) => {
        if (e.type !== "den") return;
        last[e.den] = world.tick;
        const pack = made[k];
        if (!pack || pack.den !== e.den) {
          problems.push(`tick ${world.tick}: den ${e.den} let out no pack of its own`);
          return;
        }
        // The free post of its pocket with the longest walk to the nearest citizen out, then the lower tile.
        const den = lettered.dens[e.den] as Landing["dens"][number];
        const free = plateGround(lettered)
          .posts.filter((t) => lettered.districtAt[t] === den.district && !held.includes(t))
          .sort((p, q) => (walk[q] as number) - (walk[p] as number) || p - q);
        if (free[0] !== tileOf(lettered, pack))
          problems.push(
            `tick ${world.tick}: den ${e.den} to ${tileOf(lettered, pack)}, not ${free[0]}`,
          );
        held.push(tileOf(lettered, pack));
        // Its monsters came out of the den's mouth, into its pocket.
        for (const m of membersOf(world, pack))
          if (!inPocket(world, den.district, m.x, m.y))
            problems.push(`tick ${world.tick}: a monster out of den ${e.den} outside its pocket`);
      });
      // Nothing else appears: every new monster is one of the packs let out this tick.
      for (const a of world.actors) {
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        if (!made.some((p) => p.id === a.pack))
          problems.push(`tick ${world.tick}: ${a.kind} from nowhere`);
      }
      // Every laid monster stands in its pocket.
      for (const a of world.actors) {
        if (a.pack === 0) continue;
        const pack = plate.packs.find((p) => p.id === a.pack);
        if (!pack || !inPocket(world, pack.pocket, a.x, a.y))
          problems.push(`tick ${world.tick}: monster ${a.id} out of its pocket`);
      }
      highest = Math.max(highest, monstersOnPlate(world));
      plate.dens.forEach((d, n) => {
        if (d.every !== everyAtPlant[n]) problems.push(`den ${n}'s turn changed`);
      });
    }
  };
  record();

  it("stands no more than the room at legs-plant, and never holds more than the cap", () => {
    expect(laid?.type === "laid" && laid.monsters).toBeLessThanOrEqual(roomOfWorld(world));
    expect(highest).toBeLessThanOrEqual(capOf(world));
    expect(problems.filter((p) => p.includes("counted"))).toEqual([]);
  });

  it("a den lets its first two packs out at legs-plant, and the rest on its turns, the last by the sighting", () => {
    expect(insideAtPlant.some((n) => n > 0)).toBe(true);
    for (const n of firstTwo) expect(n).toBeLessThanOrEqual(2);
    insideAtPlant.forEach((inside, n) => {
      const every = everyAtPlant[n] as number;
      expect(every).toBe(inside === 0 ? 0 : Math.floor(3_000 / inside));
      if (inside > 0) expect(LEGS_PLANT + every * inside).toBeLessThanOrEqual(SIGHTING);
      // Each turn falls on the clock and no other tick: none on a kill.
      const ticks = turns.flatMap((e) => (e.type === "den" && e.den === n ? [e.tick] : []));
      ticks.forEach((t, k) => {
        expect(t).toBe(LEGS_PLANT + every * (k + 1));
      });
    });
    expect(problems.filter((p) => p.includes("changed"))).toEqual([]);
  });

  it("lets nothing out while the plate holds 50 over its room, and passes turns for want of a post", () => {
    const gate = roomOfWorld(world) + DEN_GATE;
    const byWhy = (why: string) => turns.filter((e) => e.type === "den" && e.why === why);
    for (const e of turns) {
      if (e.type !== "den") continue;
      if (e.out) expect(e.monsters).toBeLessThan(gate);
      if (e.why === "cap") expect(e.monsters).toBeGreaterThanOrEqual(gate);
    }
    expect(turns.filter((e) => e.type === "den" && e.out).length).toBeGreaterThan(0);
    expect(byWhy("cap").length + byWhy("post").length).toBeGreaterThan(0);
  });

  it("two dens with a turn on one tick go in turn", () => {
    const ticks = turns.map((e) => e.tick);
    expect(ticks.some((t, i) => ticks.indexOf(t) !== i)).toBe(true);
    expect(problems.filter((p) => p.includes("turns"))).toEqual([]);
  });

  it("a pack let out stands on the free post of its pocket whose walk to the nearest citizen is longest", () => {
    expect(problems.filter((p) => p.includes(" to ") || p.includes("no pack"))).toEqual([]);
  });

  it("no monster appears after legs-plant but out of a den, and no laid monster leaves its pocket", () => {
    expect(problems.filter((p) => p.includes("nowhere") || p.includes("pocket"))).toEqual([]);
    expect(problems).toEqual([]);
  });
});

/** A crewed city on its landing with the ramp down, citizens of `tiers` aboard, and the test programs. */
function landed(tiers: [number, number][], seed = 3): World {
  const world = crewCity({
    seed,
    city: 2,
    size: "medium",
    level: 23,
    tiers,
    programs: TEST_PROGRAMS,
  });
  for (const c of citizensOf(world)) place(c, c, "still");
  runTo(world, RAMP_DOWN + 1);
  return world;
}

/** A pack standing on its post, of a level `fits` takes, and a tile of its pocket `steps` from its nearest monster. */
function packAndTile(
  world: World,
  fits: (pack: PackState) => boolean,
  steps: number,
  { lone = true, homeward = 0 } = {},
): { pack: PackState; at: Point } {
  const landing = landingOf(world);
  const ground = plateGround(landing);
  for (const pack of (world.plate as NonNullable<World["plate"]>).packs) {
    if (!fits(pack) || pack.kind === ELITE || PACK_KINDS[pack.kind] === "guard") continue;
    // Only this pack in its pocket, so nothing else joins in.
    const others = (world.plate as NonNullable<World["plate"]>).packs.filter(
      (p) => p.pocket === pack.pocket && p !== pack,
    );
    if (lone && others.length > 0) continue;
    const members = membersOf(world, pack);
    const theirWalk = Math.min(...members.map((m) => ground.walk[tileOf(landing, m)] as number));
    for (let t = 0; t < landing.width * landing.height; t++) {
      if (landing.districtAt[t] !== pack.pocket || !ground.open[t]) continue;
      // Nearer the ramp than any of the pack, by `homeward` steps or more.
      if ((ground.walk[t] as number) + homeward > theirWalk) continue;
      const at = pointOf(landing, t);
      if (world.actors.some((a) => a.x === at.x && a.y === at.y)) continue;
      const near = Math.min(
        ...members.map((m) => Math.max(Math.abs(m.x - at.x), Math.abs(m.y - at.y))),
      );
      if (near === steps) return { pack, at };
    }
  }
  throw new Error("no pack with such a tile");
}

describe("keeping to the pocket", () => {
  it("takes no damage from a citizen outside its pocket, and some from one inside it", () => {
    const world = landed([[23, 1]]);
    const [citizen] = citizensOf(world) as [Actor];
    const monster = world.actors.find((a) => a.pack > 0 && a.kind === "fodder") as Actor;
    const pack = world.plate?.packs.find((p) => p.id === monster.pack) as PackState;
    const swinger = { blow: 30, family: FULL };
    // Beside it, but just outside its pocket: some tile next to the monster that is not the pocket's.
    const landing = landingOf(world);
    const outside = { x: landing.ramp.x - landing.city.x, y: landing.ramp.y - landing.city.y };
    place(citizen, outside, "still");
    expect(inPocket(world, pack.pocket, citizen.x, citizen.y)).toBe(false);
    const hp = monster.hp;
    const events: WorldEvent[] = [];
    strike(world, citizen, monster, swinger, false, events, new Map());
    expect(monster.hp).toBe(hp);
    expect(events.some((e) => e.type === "hit")).toBe(false);
    expect(pack.struck).toEqual([]);
    place(citizen, { x: monster.x, y: monster.y }, "still");
    strike(world, citizen, monster, swinger, false, events, new Map());
    expect(monster.hp).toBeLessThan(hp);
    expect(pack.struck).toEqual([citizen.id]);
  });

  it("breaks off a chase at the pocket's edge, and a citizen walking away is never caught", () => {
    // A citizen three tiles from a pack it is not too strong for, in a pocket
    // beside the yard, on the pack's homeward side, walking home.
    const world = landed([[23, 1]]);
    const [citizen] = citizensOf(world) as [Actor];
    const { districts } = landingOf(world);
    const { pack, at } = packAndTile(
      world,
      (p) => p.level < 33 && districts[p.pocket]?.steps === 1,
      3,
      { lone: false, homeward: 3 },
    );
    place(citizen, at, "home");
    const hits: WorldEvent[] = [];
    let chased = false;
    let left = -1;
    for (let t = 0; t < 600; t++) {
      for (const e of step(world))
        if (
          e.type === "hit" &&
          e.target === citizen.id &&
          membersOf(world, pack).some((m) => m.id === e.actor)
        )
          hits.push(e);
      if (pack.target === citizen.id) chased = true;
      if (left < 0 && !inPocket(world, pack.pocket, citizen.x, citizen.y)) left = world.tick;
      for (const m of membersOf(world, pack))
        expect(inPocket(world, pack.pocket, m.x, m.y)).toBe(true);
    }
    expect(chased).toBe(true);
    expect(left).toBeGreaterThan(0);
    expect(pack.target).toBe(0);
    expect(hits).toEqual([]);
    // Monsters and citizens step a tile in 4 ticks.
    expect(laidKind("fodder", 23).step).toBe(STEP_TICKS);
    expect(STEP_TICKS).toBe(4);
  });
});

describe("leaving a strong citizen alone", () => {
  it("a pack does not go for a citizen ten levels over it until that citizen strikes it", () => {
    const world = landed([[40, 1]]);
    const [citizen] = citizensOf(world) as [Actor];
    expect(armsOf(citizen)).toBe(40);
    // Beside a monster of a pack of 30 or under.
    const { pack } = packAndTile(world, (p) => p.level <= 30, 1);
    const monster = membersOf(world, pack)[0] as Actor;
    const beside = [
      { x: monster.x + 1, y: monster.y },
      { x: monster.x - 1, y: monster.y },
      { x: monster.x, y: monster.y + 1 },
      { x: monster.x, y: monster.y - 1 },
    ].find(
      (p) =>
        inPocket(world, pack.pocket, p.x, p.y) &&
        !world.actors.some((a) => a.x === p.x && a.y === p.y) &&
        terrainOf(world.atlas, p.x, p.y) !== undefined,
    ) as Point;
    place(citizen, beside, "late");
    let quiet = true;
    let struck = 0;
    for (let t = 0; t < 400; t++) {
      for (const e of step(world)) {
        if (e.type === "hit" && e.actor === citizen.id && struck === 0) struck = world.tick;
        if (e.type === "hit" && e.target === citizen.id && struck === 0) quiet = false;
      }
      if (struck === 0 && pack.target !== 0) quiet = false;
    }
    expect(quiet).toBe(true);
    expect(struck).toBeGreaterThan(0);
    expect(pack.struck).toContain(citizen.id);
    // Struck, it went for the citizen (and may since be dead or have broken off).
    expect(pack.target === citizen.id || membersOf(world, pack).length < monstersOf("swarm")).toBe(
      true,
    );
  });
});

describe("pack_* and den_*", () => {
  it("pack_distance(-9) finds a pack in range, and reads 9999 once nothing of that range stands", () => {
    // After the march the dens let nothing more out.
    const world = landed([[23, 1]]);
    runTo(world, MARCH + 1);
    const [citizen] = citizensOf(world) as [Actor];
    const landing = landingOf(world);
    place(
      citizen,
      { x: landing.ramp.x - landing.city.x, y: landing.ramp.y - landing.city.y },
      "probe",
    );
    runTo(world, world.tick + 6);
    // Deckhand's `over` is 10, but the probe has none: the range is 14 to 23.
    const inRange = world.actors.filter((a) => a.pack > 0 && a.level >= 14 && a.level <= 23);
    expect(inRange.length).toBeGreaterThan(0);
    const nearest = Math.min(
      ...inRange.map((a) => Math.abs(a.x - citizen.x) + Math.abs(a.y - citizen.y)),
    );
    expect(citizen.memory[0]).toBe(nearest);
    for (const a of inRange) a.hp = 0;
    runTo(world, world.tick + 6);
    expect(world.actors.some((a) => a.pack > 0 && a.level >= 14 && a.level <= 23)).toBe(false);
    expect(citizen.memory[0]).toBe(NO_PACK);
  });

  it("den_distance finds the nearest den with packs inside in range, and 9999 when none has", () => {
    const world = landed([[23, 15]]);
    const [citizen] = citizensOf(world) as [Actor];
    const landing = landingOf(world);
    place(
      citizen,
      { x: landing.ramp.x - landing.city.x, y: landing.ramp.y - landing.city.y },
      "probe",
    );
    runTo(world, world.tick + 6);
    const plate = world.plate as NonNullable<World["plate"]>;
    const dens = plate.dens.filter((d) => d.queue.length > 0 && d.level >= 14 && d.level <= 23);
    const want =
      dens.length === 0
        ? NO_PACK
        : Math.min(...dens.map((d) => Math.abs(d.x - citizen.x) + Math.abs(d.y - citizen.y)));
    expect(citizen.memory[1]).toBe(want);
    for (const d of plate.dens) d.queue = [];
    runTo(world, world.tick + 6);
    expect(citizen.memory[1]).toBe(NO_PACK);
  });
});

describe("what the plate letters", () => {
  it("each den as `den`, its letter and its level, and each pocket's level once, at a gate on the city's side", () => {
    const world = landed([[23, 15]]);
    const landing = landingOf(world);
    const letters = plateLetters(landing);
    for (const d of landing.dens)
      expect(letters).toContainEqual({ x: d.x, y: d.y, text: `den ${d.letter} ${d.level}` });
    const levels = letters.filter((l) => !l.text.startsWith("den"));
    expect(levels).toHaveLength(landing.districts.length - 1);
    for (const l of levels) {
      const passage = landing.passages.find((p) => p.x === l.x && p.y === l.y);
      expect(passage).toBeDefined();
      const [a, b] = [landing.districts[passage?.a ?? 0], landing.districts[passage?.b ?? 0]];
      const pocket = (a?.steps ?? 0) > (b?.steps ?? 0) ? a : b;
      expect(l.text).toBe(`${pocket?.level}`);
    }
  });
});

describe("saving a landing", () => {
  it("a snapshot at legs-plant and one mid-landing resume to the same hash", () => {
    const make = (): World =>
      crewCity({ seed: 9, city: 1, size: "large", level: 8, tiers: CROWDS[1][15] });
    const straight = make();
    runTo(straight, LEGS_PLANT + 900);
    for (const at of [LEGS_PLANT - 1, LEGS_PLANT, RAMP_DOWN + 300]) {
      const half = make();
      runTo(half, at);
      const resumed = restore(snapshot(half), null, half.programs, half.kinds);
      expect(hashWorld(resumed)).toBe(hashWorld(half));
      runTo(resumed, LEGS_PLANT + 900);
      expect(hashWorld(resumed), `resumed at ${at}`).toBe(hashWorld(straight));
    }
  });

  it("refuses a laid monster outside its pocket, a pack that is not on the plate, and a plate in transit", () => {
    const world = crewCity({ seed: 9, city: 1, size: "large", level: 8, tiers: CROWDS[1][15] });
    runTo(world, RAMP_DOWN + 10);
    const resave = (change: (data: Record<string, unknown>) => void): string => {
      const data = JSON.parse(snapshot(world));
      change(data.state);
      data.hash = hashWorld({
        ...data.state,
        atlas: world.atlas,
        programs: world.programs,
        kinds: world.kinds,
      });
      return JSON.stringify(data);
    };
    const reload = (text: string) => () => restore(text, null, world.programs, world.kinds);
    expect(reload(resave(() => {}))).not.toThrow();
    const index = world.actors.findIndex((a) => a.pack > 0);
    const yard = landingOf(world).districtAt.indexOf(0);
    const there = pointOf(landingOf(world), yard);
    expect(
      reload(
        resave((s) => {
          const a = (s.actors as Record<string, unknown>[])[index] as Record<string, unknown>;
          Object.assign(a, { x: there.x, y: there.y, fromX: there.x, fromY: there.y, path: [] });
        }),
      ),
    ).toThrow(/damaged/);
    expect(
      reload(
        resave((s) => {
          ((s.actors as Record<string, unknown>[])[index] as Record<string, unknown>).pack =
            999_999;
        }),
      ),
    ).toThrow(/damaged/);
    expect(reload(resave((s) => Object.assign(s, { plate: null })))).toThrow(/damaged/);
  });
});
