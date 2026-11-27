// A world of several regions: the shipped world's ground, crossing exits,
// routes through regions, monsters per region, snapshots, and a game day.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Atlas, atlasOf, linked, parseWorld, regionAt, terrainOf, walkable } from "./atlas.ts";
import { atBank } from "./bag.ts";
import {
  MAX_MAP_HEIGHT,
  MAX_MAP_WIDTH,
  MapError,
  type Point,
  place,
  placeConstants,
} from "./map.ts";
import { findPath } from "./path.ts";
import { compileBots } from "./tactics.ts";
import { firstLight, rawWorld, shippedMonsters, shippedPrograms, shippedWorld } from "./testing.ts";
import {
  type Actor,
  ADVENTURER,
  actorsIn,
  CROWD_TILES,
  createWorld,
  hashWorld,
  type Input,
  lineOfAttack,
  MONSTER_CAP,
  monstersIn,
  restore,
  SNAPSHOT_VERSION,
  SnapshotError,
  snapshot,
  spawnsNearCamp,
  step,
  TICKS_PER_DAY,
  TICKS_PER_GAME_HOUR,
  type World,
} from "./world.ts";

const WORLD = shippedWorld();
const [CAMP, PINE, HILLS, LOWER] = [0, 1, 2, 3];
const MONSTERS = shippedMonsters();
/**
 * The shipped monsters only come out on the camp's map. These also come out
 * by day in the pinewood (wolves) and the hills (goblins), to test spawning
 * region by region.
 */
const SPREAD = MONSTERS.spawns.map((spawn) => ({
  ...spawn,
  day: [...spawn.day, place(WORLD, spawn.kind === "wolf" ? "pinewood" : "hills")],
}));
const PLAYERS = compileBots(
  {
    shuttle: `
      when trips mod 2 == 0 as "out" -> set trips = trips + 1; walk_to(pinewood)
      otherwise as "back" -> set trips = trips + 1; walk_to(camp)`,
    to_reeds: 'otherwise as "to the reeds" -> walk_to(reeds); wait(600)',
    to_hills: 'otherwise as "to the hills" -> walk_to(hills); wait(600)',
    to_camp: 'otherwise as "to camp" -> walk_to(camp); wait(5)',
    looker: `
      when threat_distance < 9999 as "sees one" -> wait(5)
      otherwise as "sees none" -> wait(5)`,
    still: 'otherwise as "stand" -> wait(600)',
  },
  placeConstants(WORLD),
);
const ALL = { ...shippedPrograms(), ...MONSTERS.programs, ...PLAYERS };

const run = (world: World, ticks: number): World => {
  for (let i = 0; i < ticks; i++) step(world);
  return world;
};
const regionOf = (world: World, a: Point): number => regionAt(world.atlas, a.x, a.y);
/** The shipped world's files, as the tests below edit them. */
type RawWorld = { regions: { map: string; x: number; y: number }[]; exits: number[][][] };
type RawMaps = Record<string, { places: Record<string, Point>; rows: string[] }>;

const exitPairs = (atlas: Atlas): string[] =>
  atlas.exits.flatMap(([a, b]) => [`${a.x},${a.y}>${b.x},${b.y}`, `${b.x},${b.y}>${a.x},${a.y}`]);

describe("the shipped world", () => {
  it("is the camp and three more regions, each a frame's size, joined by exits", () => {
    expect(WORLD.regions.map((r) => r.map.name)).toEqual([
      "camp",
      "pinewood",
      "hills",
      "lower-river",
    ]);
    for (const region of WORLD.regions) {
      expect(region.map.width).toBeLessThanOrEqual(MAX_MAP_WIDTH);
      expect(region.map.height).toBeLessThanOrEqual(MAX_MAP_HEIGHT);
    }
    // The camp's region is the one map the world was before, tile for tile, at
    // the same coordinates and with the same places.
    const old = firstLight();
    const camp = WORLD.regions[CAMP] as Atlas["regions"][number];
    expect([camp.x, camp.y]).toEqual([0, 0]);
    expect(camp.map.tiles).toEqual(old.tiles);
    expect(camp.map.places).toEqual(old.places);
    // More than three times the walkable ground of that map.
    const one = atlasOf(old).regions[0]?.walkable ?? 0;
    const all = WORLD.regions.reduce((sum, r) => sum + r.walkable, 0);
    expect(all).toBeGreaterThan(3 * one);
    // Every place the shipped programs and monsters name is in the region it belongs to.
    const at = (name: string): number => {
      const p = place(WORLD, name);
      return regionAt(WORLD, p.x, p.y);
    };
    expect(["camp", "bank", "near_wood", "deep_wood", "den", "river", "meadow"].map(at)).toEqual(
      new Array(7).fill(CAMP),
    );
    expect(at("pinewood")).toBe(PINE);
    expect([at("hills"), at("caves")]).toEqual([HILLS, HILLS]);
    expect([at("lower_river"), at("reeds")]).toEqual([LOWER, LOWER]);
    // Every exit leads off the camp's map, one to each of the others.
    const joined = WORLD.exits.map(([a, b]) => [
      regionAt(WORLD, a.x, a.y),
      regionAt(WORLD, b.x, b.y),
    ]);
    expect(joined.every((pair) => pair.includes(CAMP))).toBe(true);
    expect(
      joined
        .flat()
        .filter((r) => r !== CAMP)
        .sort(),
    ).toEqual([PINE, HILLS, LOWER]);
  });

  const broken: [string, (world: RawWorld, maps: RawMaps) => void, RegExp][] = [
    [
      "two regions on top of each other",
      (w) => ((w.regions[1] as RawWorld["regions"][number]).x = 20),
      /overlap/,
    ],
    [
      "a map file that is not there",
      (w) => ((w.regions[1] as RawWorld["regions"][number]).map = "moor"),
      /no map file/,
    ],
    [
      "a place name in two regions",
      (_, maps) => ((maps.hills as RawMaps[string]).places.den = { x: 6, y: 9 }),
      /"den" is in both/,
    ],
    [
      "an exit whose tiles are apart",
      (w) => ((w.exits[0] as number[][])[1] = [1, 7]),
      /side by side/,
    ],
    [
      "an exit inside one region",
      (w) =>
        (w.exits[0] = [
          [1, 8],
          [2, 8],
        ]),
      /in the same region/,
    ],
    [
      "an exit onto a tree",
      (w) =>
        (w.exits[0] = [
          [-1, 8],
          [0, 8],
        ]),
      /walked on/,
    ],
    [
      "a region no exit reaches",
      (w) => w.exits.splice(1, 1),
      /of "hills" cannot be reached from camp/,
    ],
    ["a world with no regions", (w) => (w.regions = []), /from 1 to 16 regions/],
    ["an exit that is not two tiles", (w) => (w.exits[0] = [[1]]), /must be two tiles/],
    [
      "a region at a place between tiles",
      (w) => ((w.regions[0] as RawWorld["regions"][number]).x = 0.5),
      /whole-number x and y/,
    ],
  ];

  it("is refused, with a MapError and nothing else, whatever garbage it is given", () => {
    for (const raw of [
      null,
      "world",
      [],
      { name: "w", regions: "camp" },
      { name: "w", regions: [7] },
    ])
      expect(() => parseWorld(raw, rawWorld().maps), JSON.stringify(raw)).toThrow(MapError);
    expect(() => parseWorld(rawWorld().world, { camp: null })).toThrow(MapError);
  });
  for (const [what, change, message] of broken) {
    it(`is refused with ${what}`, () => {
      const { world, maps } = rawWorld();
      change(world as RawWorld, maps as RawMaps);
      expect(() => parseWorld(world, maps)).toThrow(message);
    });
  }
});

describe("crossing between regions", () => {
  it("steps across an exit both ways, and only across an exit", () => {
    const world = createWorld(WORLD, 1, ALL);
    step(world, [{ type: "spawn", name: "Ash", program: "shuttle", x: 1, y: 7 }]);
    const ash = world.actors[0] as Actor;
    const crossings: string[] = [];
    let was = regionOf(world, ash);
    let from = `${ash.x},${ash.y}`;
    for (let t = 0; t < 3000; t++) {
      step(world);
      const now = regionOf(world, ash);
      if (now !== was) crossings.push(`${from}>${ash.x},${ash.y}`);
      was = now;
      from = `${ash.x},${ash.y}`;
    }
    // Out to the pinewood and back, at least twice each, every time by the exit.
    expect(crossings.filter((c) => c === "0,7>-1,7").length).toBeGreaterThanOrEqual(2);
    expect(crossings.filter((c) => c === "-1,7>0,7").length).toBeGreaterThanOrEqual(2);
    expect(crossings.every((c) => exitPairs(WORLD).includes(c))).toBe(true);
  });

  it("finds a route from one region through the camp's to another", () => {
    for (const [from, to, regions] of [
      ["pinewood", "hills", [PINE, CAMP, HILLS]],
      ["reeds", "pinewood", [LOWER, CAMP, PINE]],
    ] as const) {
      const path = findPath(WORLD, place(WORLD, from), place(WORLD, to)) as Point[];
      expect(path).not.toBeNull();
      const crossed = path.map((p) => regionAt(WORLD, p.x, p.y));
      expect(crossed.filter((r, i) => r !== crossed[i - 1])).toEqual(regions);
      let at = place(WORLD, from);
      for (const next of path) {
        expect(linked(WORLD, at.x, at.y, next.x, next.y)).toBe(true);
        at = next;
      }
    }
  });

  it("walks to a place by name in any region, through the exits on the way", () => {
    const world = createWorld(WORLD, 1, ALL);
    const pinewood = place(WORLD, "pinewood");
    step(world, [
      { type: "spawn", name: "Ash", program: "to_hills", x: 14, y: 9 },
      { type: "spawn", name: "Bryn", program: "to_reeds", x: pinewood.x, y: pinewood.y },
    ]);
    const [ash, bryn] = world.actors as [Actor, Actor];
    const seen = new Set<string>();
    for (let t = 0; t < 2500; t++) {
      step(world);
      seen.add(`${ash.name} ${regionOf(world, ash)}`).add(`${bryn.name} ${regionOf(world, bryn)}`);
    }
    expect([ash.x, ash.y]).toEqual([place(WORLD, "hills").x, place(WORLD, "hills").y]);
    expect([bryn.x, bryn.y]).toEqual([place(WORLD, "reeds").x, place(WORLD, "reeds").y]);
    expect([...seen].sort()).toEqual([
      `Ash ${CAMP}`,
      `Ash ${HILLS}`,
      `Bryn ${CAMP}`,
      `Bryn ${PINE}`,
      `Bryn ${LOWER}`,
    ]);
  });

  it("keeps monsters, their blows and what everyone sees to one region", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [
      // A wolf at the pinewood's side of the exit, sent for the camp; a resident just across.
      { type: "spawn", name: "Wolf", program: "to_camp", kind: "wolf", x: -2, y: 7 },
      { type: "spawn", name: "Ash", program: "looker", x: 0, y: 7 },
    ]);
    const wolf = world.actors[0] as Actor;
    const ash = world.actors[1] as Actor;
    for (let t = 0; t < 300; t++) {
      step(world);
      expect(regionOf(world, wolf)).toBe(PINE);
      expect(world.programs.looker?.rules[ash.rule]).toBe("sees none");
    }
    // It got as near as it could: the pinewood's end of the exit.
    expect([wolf.x, wolf.y]).toEqual([-1, 7]);
    // Its blow towards the camp stops at the edge of its region.
    expect(lineOfAttack(world, wolf, 1, 0)).toEqual([]);
    expect(lineOfAttack(world, wolf, -1, 0)).toEqual([
      { x: -2, y: 7 },
      { x: -3, y: 7 },
    ]);
  });
});

describe("monsters per region", () => {
  it("comes out only on the camp's map with the shipped monsters", () => {
    const world = createWorld(WORLD, 3, ALL, MONSTERS.kinds, MONSTERS.spawns);
    step(world, spawnsNearCamp(world, [{ name: "Ash", program: "homebody" }]));
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      step(world);
      for (const a of world.actors)
        if (a.kind !== ADVENTURER) expect(regionOf(world, a)).toBe(CAMP);
    }
    expect(world.nextSpawn[CAMP]).toBeGreaterThan(0);
    expect(world.nextSpawn.slice(1)).toEqual([0, 0, 0]);
  });

  it("each region spawns on its own wait and holds at most MONSTER_CAP", () => {
    const world = createWorld(WORLD, 3, ALL, MONSTERS.kinds, SPREAD);
    step(world, spawnsNearCamp(world, [{ name: "Ash", program: "homebody" }]));
    // From the first tick, the camp, the pinewood and the hills each get a group of their own.
    expect(monstersIn(world, CAMP)).toBeGreaterThan(0);
    expect(monstersIn(world, PINE)).toBe(1);
    expect(monstersIn(world, HILLS)).toBe(3);
    let most = 0;
    for (let t = 0; t < TICKS_PER_DAY / 2; t++) {
      step(world);
      for (const r of [CAMP, PINE, HILLS, LOWER])
        expect(monstersIn(world, r)).toBeLessThanOrEqual(MONSTER_CAP);
      most = Math.max(most, world.actors.filter((a) => a.kind !== ADVENTURER).length);
    }
    // More than one region's worth alive at once, and nothing ever came out by the lower river.
    expect(most).toBeGreaterThan(MONSTER_CAP);
    expect(world.nextSpawn[LOWER]).toBe(0);
  });

  it("sends no group into a region it would take past the crowd target", () => {
    const camp = WORLD.regions[CAMP] as Atlas["regions"][number];
    const full = Math.floor(camp.walkable / CROWD_TILES);
    // Residents standing on the camp's map east of the river, away from where
    // monsters come out by day (the deep wood and the den).
    const crowd = (count: number): Input[] => {
      const inputs: Input[] = [];
      for (let y = 0; y < 21 && inputs.length < count; y++)
        for (let x = 26; x < 30 && inputs.length < count; x++)
          if (walkable(WORLD, x, y))
            inputs.push({ type: "spawn", name: `R${inputs.length}`, program: "still", x, y });
      return inputs;
    };
    for (const [standing, monsters] of [
      [full - 1, 1],
      [full, 0],
    ] as const) {
      const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds, SPREAD);
      step(world, crowd(standing));
      expect(world.actors.filter((a) => a.kind === ADVENTURER)).toHaveLength(standing);
      run(world, 30);
      // Room for one more: a lone wolf, never a group of three goblins.
      expect(monstersIn(world, CAMP), `${standing} standing`).toBe(monsters);
      expect(actorsIn(world, CAMP) * CROWD_TILES).toBeLessThanOrEqual(camp.walkable);
      // The hills' goblins come all the same.
      expect(monstersIn(world, HILLS)).toBe(3);
    }
  });
});

describe("snapshots of a world of regions", () => {
  const spread = (seed: number): World => {
    const world = createWorld(WORLD, seed, ALL, MONSTERS.kinds, MONSTERS.spawns);
    step(
      world,
      spawnsNearCamp(
        world,
        Array.from({ length: 12 }, (_, i) => ({
          name: `R${i}`,
          program: ["wanderer", "homebody", "riverwalker"][i % 3] as string,
        })),
      ),
    );
    const occupied = (): number =>
      new Set(world.actors.filter((a) => a.kind === ADVENTURER).map((a) => regionOf(world, a)))
        .size;
    for (let t = 0; t < 8000 && occupied() < 3; t++) step(world);
    expect(occupied()).toBeGreaterThanOrEqual(3);
    return world;
  };

  it("are deterministic, and resume to the same future with actors in several regions", () => {
    const world = spread(11);
    expect(hashWorld(spread(11))).toBe(hashWorld(world));
    const saved = snapshot(world);
    expect(JSON.parse(saved).version).toBe(SNAPSHOT_VERSION);
    const resumed = restore(saved, WORLD, ALL, MONSTERS.kinds, MONSTERS.spawns);
    expect(resumed).toEqual(world);
    run(world, 1200);
    run(resumed, 1200);
    expect(hashWorld(resumed)).toBe(hashWorld(world));
  });

  it("refuse other ground, a wait per region that is wrong, and a monster crossing an exit", () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds);
    step(world, [{ type: "spawn", name: "Wolf", program: "to_camp", kind: "wolf", x: -3, y: 7 }]);
    const saved = snapshot(world);
    const again = (text: string): World => restore(text, WORLD, ALL, MONSTERS.kinds);
    expect(again(saved)).toEqual(world);
    // The same maps joined differently, and the one-map fixture, are other ground.
    const { world: raw, maps } = rawWorld();
    (raw as { exits: unknown[] }).exits.push([
      [-1, 10],
      [0, 10],
    ]);
    (maps.camp as { rows: string[] }).rows[10] =
      `.${(maps.camp as { rows: string[] }).rows[10]?.slice(1)}`;
    (maps.pinewood as { rows: string[] }).rows[10] =
      `${(maps.pinewood as { rows: string[] }).rows[10]?.slice(0, 29)},`;
    const rejoined = parseWorld(raw, maps);
    expect(() => restore(saved, rejoined, ALL, MONSTERS.kinds)).toThrow(/different map/);
    expect(() => restore(saved, firstLight(), ALL, MONSTERS.kinds)).toThrow(/different map/);
    for (const change of [
      (s: { nextSpawn: unknown; actors: Record<string, unknown>[] }) => (s.nextSpawn = [0, 0, 0]),
      (s: { nextSpawn: unknown; actors: Record<string, unknown>[] }) => (s.nextSpawn = 0),
      (s: { nextSpawn: unknown; actors: Record<string, unknown>[] }) =>
        ((s.actors[0] as Record<string, unknown>).path = [
          { x: -2, y: 7 },
          { x: -1, y: 7 },
          { x: 0, y: 7 },
        ]),
      (s: { nextSpawn: unknown; actors: Record<string, unknown>[] }) =>
        Object.assign(s.actors[0] as Record<string, unknown>, {
          x: 0,
          y: 7,
          fromX: -1,
          fromY: 7,
          moveTicksLeft: 3,
        }),
    ]) {
      const data = JSON.parse(saved);
      change(data.state);
      expect(() => again(JSON.stringify(data))).toThrow(SnapshotError);
    }
  });
});

// Snapshots from before regions. Each fixture was written by the code of its
// version: seed 5005 on first-light with OLD_SOURCES, OLD_KINDS and OLD_SPAWNS
// below, Ash, Bryn and Cole put in with spawnsNearCamp running "stroller", then
// 1,300 ticks run (three wolves have come by then) and the snapshot taken.
// fixtures/snapshot-v5-wolves.json was written at commit 667474b, and
// fixtures/snapshot-v6.json at 8f5be18, after skills and the bank.
const OLD_SNAPSHOTS = [
  { version: 5, file: "snapshot-v5-wolves.json", brynXp: [0, 0, 0, 0, 0] },
  { version: 6, file: "snapshot-v6.json", brynXp: [400, 68, 0, 0, 0] },
];
for (const { version, file, brynXp } of OLD_SNAPSHOTS) {
  describe(`a version ${version} snapshot`, () => {
    const OLD_SOURCES = {
      stroller:
        'bot "Stroller"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wander; wait(20)\n',
      biter:
        'bot "Biter"\nwhen threat_distance <= 1 -> attack(threat_x, threat_y)\notherwise -> wander; wait(10)\n',
    };
    const OLD_KINDS = { wolf: { hp: 400, damage: 1, windup: 8, recovery: 10, reach: 1 } };
    const OLD_SPAWNS = [
      {
        kind: "wolf",
        name: "Wolf",
        program: "biter",
        group: 1,
        day: [{ x: 4, y: 6 }],
        night: [{ x: 4, y: 6 }],
      },
    ];
    const MAP = firstLight();
    const PROGRAMS = compileBots(OLD_SOURCES, placeConstants(MAP));
    const TEXT = readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8");

    it("restores into a world of its one map, with its wait as that region's, and goes on", () => {
      expect(JSON.parse(TEXT).version).toBe(version);
      const world = restore(TEXT, MAP, PROGRAMS, OLD_KINDS, OLD_SPAWNS);
      expect(world.tick).toBe(1301);
      expect(world.nextSpawn).toEqual([1801]);
      expect(world.actors.filter((a) => a.kind === "wolf")).toHaveLength(3);
      expect(world.actors.find((a) => a.name === "Bryn")?.xp).toEqual(brynXp);
      run(world, 2000);
      const again = snapshot(world);
      expect(JSON.parse(again).version).toBe(SNAPSHOT_VERSION);
      expect(hashWorld(restore(again, MAP, PROGRAMS, OLD_KINDS, OLD_SPAWNS))).toBe(
        hashWorld(world),
      );
    });

    it("is refused on a world of regions, with more monsters than a region holds, or damaged", () => {
      expect(() => restore(TEXT, WORLD, PROGRAMS, OLD_KINDS, OLD_SPAWNS)).toThrow(/different map/);
      const crowded = JSON.parse(TEXT);
      crowded.state.actors.push({
        ...crowded.state.actors[5],
        id: 100,
        x: 20,
        y: 15,
        fromX: 20,
        fromY: 15,
        path: [],
      });
      crowded.state.nextActorId = 101;
      expect(() => restore(JSON.stringify(crowded), MAP, PROGRAMS, OLD_KINDS, OLD_SPAWNS)).toThrow(
        /holds 4 monsters, more than the 3 a region now allows/,
      );
      const damaged = JSON.parse(TEXT);
      damaged.state.nextSpawn = 1802;
      expect(() => restore(JSON.stringify(damaged), MAP, PROGRAMS, OLD_KINDS, OLD_SPAWNS)).toThrow(
        /damaged/,
      );
      // Nor can it pass for the version after it.
      const later = { ...JSON.parse(TEXT), version: version + 1 };
      expect(() => restore(JSON.stringify(later), MAP, PROGRAMS, OLD_KINDS, OLD_SPAWNS)).toThrow(
        SnapshotError,
      );
    });
  });
}

// The whole day takes several seconds, so the gate runs its first six hours and
// the capture workflow all of it (IDLIN_LONG=1).
const FIFTY_TICKS = process.env.IDLIN_LONG === "1" ? TICKS_PER_DAY : 6 * TICKS_PER_GAME_HOUR;

describe("a game day with fifty residents", () => {
  it(`over ${FIFTY_TICKS} ticks, leaves nobody stuck, and keeps monsters under each region's cap and crowd target`, () => {
    const world = createWorld(WORLD, 1, ALL, MONSTERS.kinds, MONSTERS.spawns);
    const cast = Array.from({ length: 50 }, (_, i) => ({
      name: `R${i}`,
      program: ["wanderer", "homebody", "riverwalker"][i % 3] as string,
    }));
    let events = step(world, spawnsNearCamp(world, cast));
    // When each resident last decided something or stepped onto another tile.
    const last = new Map<number, number>();
    const tile = new Map<number, string>();
    let longest = 0;
    const regions = WORLD.regions.map(() => ({ sum: 0, most: 0, monsters: 0 }));
    let samples = 0;
    const arrivals = new Set<number>(world.actors.map((a) => a.id));
    for (let tick = 1; tick <= FIFTY_TICKS; tick++) {
      for (const e of events)
        if (e.type === "decide" || e.type === "fault") last.set(e.actor, tick);
      for (const a of world.actors) {
        if (tile.get(a.id) !== `${a.x},${a.y}`) last.set(a.id, tick);
        tile.set(a.id, `${a.x},${a.y}`);
        if (a.kind === ADVENTURER) longest = Math.max(longest, tick - (last.get(a.id) ?? 0));
      }
      events = step(world);
      // A group that has just come must have found its region under the crowd target.
      for (const a of world.actors) {
        if (arrivals.has(a.id)) continue;
        arrivals.add(a.id);
        const r = regionOf(world, a);
        expect(actorsIn(world, r) * CROWD_TILES).toBeLessThanOrEqual(
          (WORLD.regions[r] as Atlas["regions"][number]).walkable,
        );
      }
      if (tick % 60 !== 0) continue;
      samples++;
      WORLD.regions.forEach((_, r) => {
        const here = world.actors.filter((a) => a.kind === ADVENTURER && regionOf(world, a) === r);
        const stats = regions[r] as (typeof regions)[number];
        stats.sum += here.length;
        stats.most = Math.max(stats.most, here.length);
        stats.monsters = Math.max(stats.monsters, monstersIn(world, r));
      });
    }
    // Nobody stands for a minute of stream time (a game hour) without deciding anything. A long walk is not standing.
    expect(longest).toBeLessThanOrEqual(TICKS_PER_GAME_HOUR);
    const measured = WORLD.regions.map((region, r) => {
      const { sum, most, monsters } = regions[r] as (typeof regions)[number];
      return {
        region: region.map.name,
        target: Math.floor(region.walkable / CROWD_TILES),
        mean: Math.round(sum / samples),
        most,
        monsters,
      };
    });
    for (const m of measured) expect(m.monsters, m.region).toBeLessThanOrEqual(MONSTER_CAP);
    // Away from camp, residents spread out under the target on average. The camp
    // is over it: only the wanderers leave its map, and they spend the night
    // there. Its crowd keeps monsters out of it instead.
    for (const m of measured.slice(1)) expect(m.mean, m.region).toBeLessThan(m.target);
  }, 60_000);
});

describe("the bank in a world of regions", () => {
  it("is used from beside the camp's bank, in world coordinates, and not from elsewhere", () => {
    const world = createWorld(WORLD, 1, shippedPrograms());
    let bank: { x: number; y: number } | undefined;
    for (let y = WORLD.top; y < WORLD.top + WORLD.height && !bank; y++)
      for (let x = WORLD.left; x < WORLD.left + WORLD.width && !bank; x++)
        if (terrainOf(WORLD, x, y) === "bank") bank = { x, y };
    if (!bank) throw new Error("the shipped world has no bank");
    const { x, y } = bank;
    expect(regionAt(WORLD, x, y)).toBe(regionAt(WORLD, place(WORLD, "camp").x, 0));
    const beside = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ].find(([bx, by]) => walkable(WORLD, bx as number, by as number)) as [number, number];
    step(world, [
      { type: "spawn", name: "Ash", program: "homebody", x: beside[0], y: beside[1] },
      { type: "spawn", name: "Bryn", program: "homebody", x: 40, y: 10 },
    ]);
    const [ash, bryn] = world.actors;
    if (!ash || !bryn) throw new Error("no actors");
    expect(atBank(world, ash)).toBe(true);
    expect(atBank(world, bryn)).toBe(false);
  });
});
