// The city's cycle: its beats on their ticks, the landing set down at
// legs-plant and the deck again at lift-off, the next cycle's 0:00, the break
// by input while the shield is a stand-in, and what lift-off does to whoever
// is outside.
import { describe, expect, it } from "vitest";
import { joined, terrainOf, tileAt, walkable } from "./atlas.ts";
import {
  BEATS,
  beatOf,
  breakAt,
  CYCLE_TICKS,
  type Cycle,
  drawLanding,
  LEGS_PLANT,
  LIFT_TICKS,
  liftAt,
  MARCH,
  MARCH_TICKS,
  nextStart,
  PLACEHOLDER_SIEGE,
  RAID,
  RAMP_DOWN,
  readCycle,
  SCOUTS,
  SIGHTING,
  siegeAt,
} from "./cycle.ts";
import {
  BERTHS,
  cityOf,
  deckGround,
  deckMap,
  landingFor,
  landingGround,
  rampTiles,
} from "./deck.ts";
import { BIOMES, SIZE_CLASSES } from "./landing.ts";
import { liftEta, NOT_SIGHTED } from "./orders.ts";
import { createRng } from "./rng.ts";
import { compileBots } from "./tactics.ts";
import { campMonsters, shippedPrograms } from "./testing.ts";
import {
  ADVENTURER,
  aboard,
  beat,
  createCity,
  groundOf,
  hashWorld,
  type Input,
  restore,
  SnapshotError,
  snapshot,
  step,
  type World,
  type WorldEvent,
} from "./world.ts";

const PROGRAMS = shippedPrograms();
const BEASTS = campMonsters();
const STILL = compileBots({ still: 'otherwise as "stand" -> wait(100)' });
const CONTENT = { ...PROGRAMS, ...BEASTS.programs, ...STILL };
const city = (seed = 1): World => createCity(seed, CONTENT, BEASTS.kinds);

/** Steps the world until its tick is `tick`, applying `inputs` at the tick each is keyed by. */
function runTo(
  world: World,
  tick: number,
  inputs: ReadonlyMap<number, readonly Input[]> = new Map(),
  events: WorldEvent[] = [],
): WorldEvent[] {
  while (world.tick < tick) events.push(...step(world, inputs.get(world.tick) ?? []));
  return events;
}

const joins = (count: number): Input[] =>
  Array.from({ length: count }, (_, i) => ({
    type: "join" as const,
    account: String(1000 + i),
    name: `chatter_${i}`,
    role: "viewer" as const,
  }));

const cycleOf = (world: World): Cycle => world.cycle as Cycle;

describe("the cycle's ticks", () => {
  const at = (start: number, broke = 0): Cycle => ({
    city: 1,
    start,
    count: 1,
    landing: { seed: 1, size: "medium", biome: "meadow", level: 1 },
    broke,
  });

  it("puts each beat on section 1's tick", () => {
    const cycle = at(0);
    const want: [number, string][] = [
      [0, "transit"],
      [RAID - 1, "transit"],
      [RAID, "raid"],
      [LEGS_PLANT - 1, "transit"],
      [LEGS_PLANT, "legs"],
      [RAMP_DOWN, "peace"],
      [SCOUTS, "scouts"],
      [SIGHTING, "sighting"],
      [MARCH, "march"],
      [MARCH + MARCH_TICKS, "siege"],
      [siegeAt(cycle) + PLACEHOLDER_SIEGE, "break"],
      [liftAt(cycle), "transit"],
    ];
    for (const [tick, name] of want) expect([tick, beatOf(cycle, tick).beat]).toEqual([tick, name]);
    expect(SIGHTING).toBe(4800);
    expect(MARCH + MARCH_TICKS).toBe(6450);
    expect(new Set(want.map(([, name]) => name))).toEqual(new Set(BEATS));
  });

  it("lifts 300 ticks after the break and starts the next cycle at 13:00 or at lift-off, the later", () => {
    expect(liftAt(at(0, 6600))).toBe(6900);
    expect(nextStart(at(0, 6600))).toBe(CYCLE_TICKS);
    expect(nextStart(at(0, 7700))).toBe(8000);
    expect(nextStart(at(0, 8600))).toBe(8900);
    // The stand-in breaks the shield 2,400 ticks into the siege, at 14:45.
    expect(breakAt(at(0))).toBe(8850);
    expect(nextStart(at(500, 7700 + 500))).toBe(8500);
  });

  it("reads back only a cycle a world could hold", () => {
    // The second cycle, its 0:00 100 ticks after the first's 13:00.
    const s = CYCLE_TICKS + 100;
    const good: Cycle = { ...at(s), count: 2 };
    const t = s + 3900;
    expect(readCycle(good, t)).toEqual(good);
    expect(readCycle(at(0), 0)).toEqual(at(0));
    // Only the first city until piece 32 grows it.
    expect(readCycle({ ...good, city: 2 }, t)).toBeNull();
    expect(readCycle({ ...good, city: 3 }, t)).toBeNull();
    expect(readCycle({ ...good, start: t + 1 }, t)).toBeNull();
    expect(readCycle({ ...good, broke: s + 6000 }, s + 6900)).toBeNull();
    expect(readCycle({ ...good, broke: s + 6600 }, s + 5900)).toBeNull();
    expect(readCycle({ ...good, broke: s + 6600 }, s + 6900)).not.toBeNull();
    // Past the next 0:00 a new cycle would have begun.
    expect(readCycle({ ...good, broke: s + 6600 }, s + CYCLE_TICKS)).toBeNull();
    expect(readCycle(good, s + 6450 + PLACEHOLDER_SIEGE)).toBeNull();
    // The count has to fit the 0:00: the first cycle starts at 0, and each
    // runs at least CYCLE_TICKS.
    expect(readCycle({ ...good, count: 1 }, t)).toBeNull();
    expect(readCycle({ ...good, count: 3 }, t)).toBeNull();
    expect(readCycle({ ...at(0), count: 2 }, 100)).toBeNull();
    expect(readCycle({ ...good, landing: { ...good.landing, size: "huge" } }, t)).toBeNull();
    expect(readCycle({ ...good, landing: { ...good.landing, extra: 1 } }, t)).toBeNull();
    expect(readCycle("cycle", t)).toBeNull();
  });
});

describe("the deck and the landing", () => {
  it("is the first city's 13 by 6 deck in transit, with two hatches", () => {
    const world = city();
    expect(world.atlas).toBe(deckGround(1));
    expect([world.atlas.width, world.atlas.height]).toEqual([13, 6]);
    expect(world.atlas.walkable).toBe(78);
    const hatches = deckMap(1).tiles.filter((t) => t === deckMap(1).tiles[3 * 13 + 2]);
    expect(hatches).toHaveLength(2);
    expect(cityOf(2).width).toBe(15);
  });

  it("sets the landing down at legs-plant with every deck tile where it was, the ramp up until 3:20", () => {
    const world = city(3);
    runTo(world, LEGS_PLANT - 1);
    const deck = world.atlas;
    step(world);
    const landing = world.atlas;
    expect(landing).not.toBe(deck);
    expect(landing.width * landing.height).toBeGreaterThan(1000);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 13; x++) {
        expect(aboard(landing, x, y)).toBe(true);
        expect(walkable(landing, x, y)).toBe(true);
      }
    for (const p of world.atlas.places.filter((q) => deck.places.some((d) => d.name === q.name)))
      expect(deck.places.find((d) => d.name === p.name)).toEqual(p);
    const input = cycleOf(world).landing;
    const ramp = rampTiles(landingFor(1, input));
    const shift = (p: { x: number; y: number }) => ({
      x: p.x + landing.left,
      y: p.y + landing.top,
    });
    for (const p of ramp) expect(walkable(landing, shift(p).x, shift(p).y)).toBe(false);
    runTo(world, RAMP_DOWN);
    for (const p of ramp) expect(walkable(world.atlas, shift(p).x, shift(p).y)).toBe(true);
    const hold = world.atlas.places.find((p) => p.name === "hold") as { x: number; y: number };
    // Up, the ramp cuts the deck off from the ground; down, it joins them.
    expect(joined(landing, hold)).toBe(false);
    expect(joined(world.atlas, hold)).toBe(true);
    expect(beat(world)?.beat).toBe("peace");
  });

  it("joins every walkable tile to the hold with the ramp down, on every size and biome", () => {
    for (const size of SIZE_CLASSES)
      for (const biome of BIOMES)
        for (const seed of [1, 2]) {
          const ground = landingGround(1, { seed, size, biome, level: 1 }, true);
          const hold = ground.places.find((p) => p.name === "hold") as { x: number; y: number };
          expect([size, biome, seed, joined(ground, hold)]).toEqual([size, biome, seed, true]);
        }
  });

  it("draws the second city small and medium landings only, cut to its 15 by 6 hull", () => {
    const drawn = (size: 1 | 2): Set<string> => {
      const rng = createRng(7);
      return new Set(Array.from({ length: 300 }, () => drawLanding(rng, size).size));
    };
    expect(drawn(1)).toEqual(new Set(SIZE_CLASSES));
    expect(drawn(2)).toEqual(new Set(["small", "medium"]));
    for (const size of ["small", "medium"] as const) {
      const input = { seed: 4, size, biome: "meadow" as const, level: 1 };
      expect(landingFor(2, input).city).toMatchObject({ width: 15, height: 6 });
      expect(landingFor(1, input).city).toMatchObject({ width: 13, height: 6 });
      const ground = landingGround(2, input, true);
      for (let y = 0; y < 6; y++)
        for (let x = 0; x < 15; x++) expect([x, y, aboard(ground, x, y)]).toEqual([x, y, true]);
    }
  });

  it("is the same landing for the same seed, and another for another seed", () => {
    const a = city(5);
    const b = city(5);
    const c = city(6);
    for (const w of [a, b, c]) runTo(w, LEGS_PLANT);
    expect(a.atlas).toBe(b.atlas);
    expect(cycleOf(a).landing).not.toEqual(cycleOf(c).landing);
  });

  it("joins citizens aboard at the hatches, two to a tile, up to the berths", () => {
    const world = city();
    step(world, joins(BERTHS + 3));
    const citizens = world.actors.filter((a) => a.kind === ADVENTURER);
    expect(citizens).toHaveLength(BERTHS);
    const perTile = new Map<number, number>();
    for (const a of citizens) {
      expect(aboard(world.atlas, a.x, a.y)).toBe(true);
      const tile = tileAt(world.atlas, a.x, a.y);
      perTile.set(tile, (perTile.get(tile) ?? 0) + 1);
    }
    expect(Math.max(...perTile.values())).toBe(2);
    // The first two came up at the two hatches.
    const hatches = world.atlas.places.filter((p) => p.name.endsWith("hatch"));
    expect(citizens.slice(0, 2).map((a) => ({ x: a.x, y: a.y }))).toEqual(
      expect.arrayContaining(hatches.map((h) => ({ x: h.x, y: h.y }))),
    );
  });

  // At the default margin everyone is home and still well before the lift. At
  // margin 0 the crowd turns back at the last moment, so citizens are still
  // walking about the deck when it lifts.
  it.each(["", "0"])(
    "never has more than two citizens standing on a tile, through a cycle with a full deck (margin %j)",
    (margin) => {
      const world = city(3);
      // 100 come aboard at once, and the other 50 one every 7 ticks while the
      // first are walking about the deck.
      const crowd = joins(BERTHS);
      const orders = (people: Input[]): Input[] =>
        people.flatMap((p) =>
          margin === "" || p.type !== "join"
            ? [p]
            : [p, { type: "param" as const, account: p.account, name: "margin", value: margin }],
        );
      step(world, orders(crowd.slice(0, 100)));
      let next = 100;
      // Through the transit, the landing, the lift and into the next landing.
      const end = 8850 + LIFT_TICKS + LEGS_PLANT + 600;
      let most = 0;
      let worst = -1;
      while (world.tick < end) {
        const join = world.tick >= 200 && world.tick % 7 === 0 ? crowd.slice(next, ++next) : [];
        step(world, orders(join));
        const perTile = new Map<number, number>();
        for (const a of world.actors) {
          if (a.kind !== ADVENTURER || a.path.length > 0 || a.moveTicksLeft > 0) continue;
          const tile = tileAt(world.atlas, a.x, a.y);
          const n = (perTile.get(tile) ?? 0) + 1;
          perTile.set(tile, n);
          if (n > most) [most, worst] = [n, world.tick];
        }
      }
      expect(world.actors.filter((a) => a.kind === ADVENTURER)).toHaveLength(BERTHS);
      expect({ most, worst: most > 2 ? worst : -1 }).toEqual({ most: 2, worst: -1 });
    },
  );
});

describe("the break and lift-off", () => {
  it("ignores a break outside the siege, and lifts 300 ticks after one inside it", () => {
    const world = city();
    const siege = siegeAt(cycleOf(world));
    const inputs = new Map<number, Input[]>([
      [LEGS_PLANT, [{ type: "break" }]],
      [siege - 2, [{ type: "break" }]],
      [6599, [{ type: "break" }]],
      [6700, [{ type: "break" }]],
    ]);
    const events = runTo(world, 7000, inputs);
    expect(cycleOf(world).broke).toBe(6600);
    const beats = events.filter((e) => e.type === "beat").map((e) => [e.tick, e.beat]);
    expect(beats).toEqual([
      [RAID, "raid"],
      [1700, "transit"],
      [LEGS_PLANT, "legs"],
      [RAMP_DOWN, "peace"],
      [SCOUTS, "scouts"],
      [SIGHTING, "sighting"],
      [MARCH, "march"],
      [6450, "siege"],
      [6600, "break"],
      [6900, "transit"],
    ]);
    expect(world.atlas).toBe(deckGround(1));
  });

  it("breaks on the stand-in's tick with no input, and plants again 1,800 ticks after the next 0:00", () => {
    const world = city();
    runTo(world, breakAt(cycleOf(world)));
    expect(cycleOf(world).broke).toBe(8850);
    runTo(world, 8850 + LIFT_TICKS);
    expect(cycleOf(world).start).toBe(9150);
    expect(cycleOf(world).count).toBe(2);
    runTo(world, 9150 + LEGS_PLANT - 1);
    expect(world.atlas).toBe(deckGround(1));
    step(world);
    expect(world.atlas).toBe(groundOf(cycleOf(world), world.tick));
    expect(beat(world)?.beat).toBe("legs");
  });

  it("plants the next landing at 3:00 of the next cycle after a lift at any tick of the siege", () => {
    for (let after = 0; after < PLACEHOLDER_SIEGE; after += 97) {
      const world = city(after);
      const breakTick = siegeAt(cycleOf(world)) + after;
      runTo(world, breakTick, new Map([[breakTick - 1, [{ type: "break" }]]]));
      expect(cycleOf(world).broke).toBe(breakTick);
      const lift = breakTick + LIFT_TICKS;
      const next = Math.max(CYCLE_TICKS, lift);
      runTo(world, next + LEGS_PLANT - 1);
      expect(cycleOf(world).start).toBe(next);
      expect(world.atlas).toBe(deckGround(1));
      step(world);
      expect(beat(world)?.beat).toBe("legs");
      // The transit after a lift is 3:00 at the least.
      expect(world.tick - lift).toBeGreaterThanOrEqual(LEGS_PLANT);
    }
  });

  it("hauls aboard whoever is outside at lift-off, and leaves monsters, blows and flags behind", () => {
    const world = city(2);
    step(world, [
      { type: "spawn", name: "out", program: "still", x: 1, y: 1 },
      { type: "spawn", name: "ramp", program: "still", x: 2, y: 1 },
      { type: "spawn", name: "home", program: "still", x: 3, y: 1 },
      ...joins(1),
    ]);
    runTo(world, RAMP_DOWN + 1);
    const [out, onRamp, home, joined] = world.actors;
    if (!out || !onRamp || !home || !joined) throw new Error("four citizens");
    const { atlas } = world;
    const ground: { x: number; y: number }[] = [];
    for (let y = atlas.top; y < atlas.top + atlas.height; y++)
      for (let x = atlas.left; x < atlas.left + atlas.width; x++)
        if (walkable(atlas, x, y) && terrainOf(atlas, x, y) === "grass") ground.push({ x, y });
    const [field, den] = [ground[0], ground[ground.length - 1]] as { x: number; y: number }[];
    out.x = out.fromX = (field as { x: number }).x;
    out.y = out.fromY = (field as { y: number }).y;
    const foot = rampTiles(landingFor(1, cycleOf(world).landing))[0] as { x: number; y: number };
    onRamp.x = onRamp.fromX = foot.x + atlas.left;
    onRamp.y = onRamp.fromY = foot.y + atlas.top;
    expect(terrainOf(atlas, onRamp.x, onRamp.y)).toBe("ramp");
    step(world, [
      {
        type: "spawn",
        name: "Wolf",
        program: "still",
        kind: "wolf",
        ...(den as { x: number; y: number }),
      },
      { type: "go", account: joined.account, words: "guns" },
    ]);
    expect(world.actors.some((x) => x.kind === "wolf")).toBe(true);
    expect(joined.flag).not.toBe(0);
    const events = runTo(world, 6900, new Map([[6599, [{ type: "break" }]]]));
    expect(world.actors.every((x) => x.kind === ADVENTURER)).toBe(true);
    expect(world.marks).toEqual([]);
    expect(world.arrows).toEqual([]);
    expect(world.atlas).toBe(deckGround(1));
    for (const x of world.actors) {
      expect(aboard(world.atlas, x.x, x.y)).toBe(true);
      expect(x.flag).toBe(0);
      // It may have set off again in the tick of the lift, but only over the deck.
      for (const p of x.path) expect(aboard(world.atlas, p.x, p.y)).toBe(true);
    }
    const winched = events.filter((e) => e.type === "winch");
    expect(winched).toEqual([
      { type: "winch", tick: 6900, actor: out.id, stripped: true },
      { type: "winch", tick: 6900, actor: onRamp.id, stripped: false },
    ]);
    // Snapshot and resume right after the lift: nothing of the landing is left in the state.
    expect(hashWorld(restore(snapshot(world), null, CONTENT, BEASTS.kinds))).toBe(hashWorld(world));
  });
});

describe("lift_eta", () => {
  it("reads 9999 until the sighting, then counts to the siege's start and 300 more", () => {
    const world = city();
    runTo(world, SIGHTING - 1);
    expect(liftEta(world)).toBe(NOT_SIGHTED);
    step(world);
    expect(liftEta(world)).toBe(6450 - SIGHTING + LIFT_TICKS);
    runTo(world, 6500);
    expect(liftEta(world)).toBe(LIFT_TICKS);
    runTo(world, 6601, new Map([[6599, [{ type: "break" }]]]));
    expect(liftEta(world)).toBe(299);
    runTo(world, 6900);
    expect(liftEta(world)).toBe(NOT_SIGHTED);
  });

  it("never reads past the real lift-off", () => {
    const world = city();
    const inputs = new Map([[7000, [{ type: "break" } as Input]]]);
    for (; world.tick < 7301; ) {
      const eta = liftEta(world);
      if (eta !== NOT_SIGHTED) expect(world.tick + eta).toBeLessThanOrEqual(7301);
      step(world, inputs.get(world.tick) ?? []);
    }
  });
});

describe("saving the city", () => {
  it("resumes from a snapshot in every beat to the same hash", () => {
    const world = city(11);
    step(world, joins(20));
    const inputs = new Map<number, Input[]>([[6599, [{ type: "break" }]]]);
    const ticks = [
      300, 900, 1799, 1800, 1999, 2000, 2500, 4000, 5000, 5800, 6450, 6600, 6899, 6900, 7799, 7800,
    ];
    for (const tick of ticks) {
      runTo(world, tick, inputs);
      const copy = restore(snapshot(world), null, CONTENT, BEASTS.kinds);
      expect(hashWorld(copy)).toBe(hashWorld(world));
      expect(copy.atlas).toBe(world.atlas);
      const ahead = (w: World): string => {
        const runOn = restore(snapshot(w), null, CONTENT, BEASTS.kinds);
        runTo(runOn, tick + 40, inputs);
        return hashWorld(runOn);
      };
      expect(ahead(copy)).toBe(ahead(world));
    }
  });

  it("refuses a snapshot of the camp world with a message that says so", () => {
    const text = snapshot(city()).replace('"version":13', '"version":12');
    expect(() => restore(text, null, CONTENT, BEASTS.kinds)).toThrow(SnapshotError);
    expect(() => restore(text, null, CONTENT, BEASTS.kinds)).toThrow(/camp world/);
  });

  it("refuses a city whose cycle was tampered with", () => {
    const world = city();
    runTo(world, 100);
    // `snapshot` hashes the world as it is given, so the stored hash matches
    // and only the cycle's own check can refuse it.
    cycleOf(world).broke = 50;
    expect(() => restore(snapshot(world), null, CONTENT, BEASTS.kinds)).toThrow(SnapshotError);
  });

  it("refuses a monster on the deck in transit", () => {
    const world = city();
    runTo(world, RAMP_DOWN + 1);
    const { atlas } = world;
    let den: { x: number; y: number } | undefined;
    for (let y = atlas.top + atlas.height - 1; y >= atlas.top && !den; y--)
      for (let x = atlas.left; x < atlas.left + atlas.width && !den; x++)
        if (walkable(atlas, x, y) && terrainOf(atlas, x, y) === "grass") den = { x, y };
    if (!den) throw new Error("a grass tile on the landing");
    step(world, [{ type: "spawn", name: "Wolf", program: "still", kind: "wolf", ...den }]);
    const wolf = world.actors.find((x) => x.kind === "wolf");
    if (!wolf) throw new Error("a wolf");
    runTo(world, 6900, new Map([[6599, [{ type: "break" }]]]));
    expect(world.atlas).toBe(deckGround(1));
    // The lifted city saves and restores; put the wolf back on an empty deck
    // tile and it no longer does.
    expect(() => restore(snapshot(world), null, CONTENT, BEASTS.kinds)).not.toThrow();
    Object.assign(wolf, { x: 6, y: 1, fromX: 6, fromY: 1, path: [] });
    world.actors.push(wolf);
    expect(() => restore(snapshot(world), null, CONTENT, BEASTS.kinds)).toThrow(SnapshotError);
  });
});
