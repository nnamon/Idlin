import { describe, expect, it } from "vitest";
import {
  APRON,
  APRON_LEVEL,
  BIOMES,
  type Biome,
  CITY_HEIGHT,
  CITY_WIDTH,
  DISTRICT_KINDS,
  EDGES,
  generateLanding,
  hashLanding,
  type Landing,
  LandingError,
  landingGraphText,
  landingText,
  MAX_EXTRA,
  MAX_LEVEL,
  PASSAGE_KINDS,
  RAMP_WIDTH,
  SIZE_CLASSES,
  SIZES,
  type SizeClass,
} from "./landing.ts";
import { isWalkable, NEIGHBOURS, type Point, TERRAINS, terrainAt } from "./map.ts";

// The gate checks a sample of seeds per size class; the capture workflow
// checks many more (IDLIN_LONG=1).
const LONG = process.env.IDLIN_LONG === "1";
const SEEDS = LONG ? 1000 : 100;

/**
 * The n-th input of a sweep: seeds spread over the 32-bit range, every biome,
 * levels across the range, and now and then more dens and caches.
 */
const input = (size: SizeClass, n: number) => ({
  seed: Math.imul(n + 1, 0x9e3779b1) | 0,
  size,
  biome: BIOMES[n % BIOMES.length] as Biome,
  level: 1 + ((n * 7) % MAX_LEVEL),
  ...(n % 4 === 3 ? { extraDens: n % 7, extraCaches: n % 6 } : {}),
});

const sweep = (size: SizeClass): Landing[] =>
  Array.from({ length: SEEDS }, (_, n) => generateLanding(input(size, n)));
const landings: Record<SizeClass, Landing[]> = {
  clearing: sweep("clearing"),
  vale: sweep("vale"),
  valley: sweep("valley"),
};

const index = (landing: Landing, p: Point): number => p.y * landing.width + p.x;
const pointAt = (landing: Landing, i: number): Point => ({
  x: i % landing.width,
  y: Math.floor(i / landing.width),
});

/** Steps of the shortest walk from the ramp to each tile it can reach, by the map's own rules. */
function walks(landing: Landing): Map<number, number> {
  const steps = new Map([[index(landing, landing.ramp), 0]]);
  const queue = [landing.ramp];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head] as Point;
    for (const [dx, dy] of NEIGHBOURS) {
      const next = { x: here.x + dx, y: here.y + dy };
      if (!isWalkable(landing, next.x, next.y) || steps.has(index(landing, next))) continue;
      steps.set(index(landing, next), (steps.get(index(landing, here)) as number) + 1);
      queue.push(next);
    }
  }
  return steps;
}

/** How many of a landing's tiles can be walked on. */
const walkableCount = (landing: Landing): number =>
  landing.tiles.filter((_, i) => {
    const { x, y } = pointAt(landing, i);
    return isWalkable(landing, x, y);
  }).length;

/** Passages from the city to each district, counted over the passages themselves. */
function stepsFromCity(landing: Landing, without: (kind: string) => boolean = () => false) {
  const steps: number[] = landing.districts.map((d) => (d.id === 0 ? 0 : -1));
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head] as number;
    for (const p of landing.passages) {
      if (without(p.kind) || (p.a !== d && p.b !== d)) continue;
      const next = p.a === d ? p.b : p.a;
      if (steps[next] !== -1) continue;
      steps[next] = (steps[d] as number) + 1;
      queue.push(next);
    }
  }
  return steps;
}

/**
 * The groups of walkable tiles that are in no district (gates and opened
 * borders), each with the districts it touches.
 */
function crossings(landing: Landing): { tiles: number[]; touches: number[] }[] {
  const groups: { tiles: number[]; touches: number[] }[] = [];
  const seen = new Set<number>();
  for (let start = 0; start < landing.tiles.length; start++) {
    const at = pointAt(landing, start);
    if (seen.has(start) || landing.districtAt[start] !== -1 || !isWalkable(landing, at.x, at.y))
      continue;
    const tiles = [start];
    const touches = new Set<number>();
    seen.add(start);
    for (let head = 0; head < tiles.length; head++) {
      const { x, y } = pointAt(landing, tiles[head] as number);
      for (const [dx, dy] of NEIGHBOURS) {
        const next = { x: x + dx, y: y + dy };
        if (!isWalkable(landing, next.x, next.y)) continue;
        const j = index(landing, next);
        const district = landing.districtAt[j] as number;
        if (district !== -1) touches.add(district);
        else if (!seen.has(j)) {
          seen.add(j);
          tiles.push(j);
        }
      }
    }
    groups.push({ tiles, touches: [...touches].sort((a, b) => a - b) });
  }
  return groups;
}

describe("generateLanding: the layout graph", () => {
  for (const size of SIZE_CLASSES) {
    const spec = SIZES[size];

    it(`${size}: the ramp's district is the root, and each other one has a ring by its walk from the ramp`, () => {
      for (const landing of landings[size]) {
        const { districts } = landing;
        expect(districts.length).toBeGreaterThanOrEqual(4);
        expect(districts[0]).toMatchObject({
          ...landing.ramp,
          id: 0,
          ring: 0,
          kind: "city",
          steps: 0,
          distance: 0,
          depth: 0,
        });
        const steps = stepsFromCity(landing);
        const longest = Math.max(...districts.map((d) => d.distance));
        districts.forEach((d, id) => {
          expect(d.id).toBe(id);
          expect(DISTRICT_KINDS).toContain(d.kind);
          expect(d.steps).toBe(steps[id]);
          expect(d.depth).toBe(Math.floor((d.distance * 1000) / longest));
          expect(d.passages).toEqual(
            landing.passages.filter((p) => p.a === id || p.b === id).map((p) => p.id),
          );
          // Its centre is on its own ground.
          expect(isWalkable(landing, d.x, d.y)).toBe(true);
          expect(landing.districtAt[index(landing, d)]).toBe(id);
          if (id === 0) return;
          expect(d.kind).not.toBe("city");
          // Rings are thirds of the longest walk.
          expect(d.ring).toBe(Math.min(3, 1 + Math.floor((3 * d.depth) / 1000)));
          // Every district has a way to the city, and a longer walk than the city has.
          expect(d.steps).toBeGreaterThan(0);
          expect(d.distance).toBeGreaterThan(0);
          expect(d.bounds.width).toBeGreaterThanOrEqual(4);
          expect(d.bounds.height).toBeGreaterThanOrEqual(4);
        });
        // The district with the longest walk is in ring 3.
        expect(Math.max(...districts.map((d) => d.ring))).toBe(3);
      }
    });

    it(`${size}: passages are a spanning tree and loops, with gates of walkable tiles`, () => {
      let loops = 0;
      for (const landing of landings[size]) {
        const { districts, passages } = landing;
        const tree = passages.filter((p) => p.tree);
        expect(tree).toHaveLength(districts.length - 1);
        // The tree alone joins every district: merge along it and count what is left.
        const group = districts.map((d) => d.id);
        const find = (d: number): number => (group[d] === d ? d : find(group[d] as number));
        for (const p of tree) group[find(p.a)] = find(p.b);
        expect(new Set(districts.map((d) => find(d.id))).size).toBe(1);
        const spare = passages.length - tree.length;
        loops += spare;
        expect(spare).toBeLessThanOrEqual(Math.ceil((districts.length * spec.loops) / 100));
        expect(
          new Set(passages.map((p) => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`)).size,
        ).toBe(passages.length);
        passages.forEach((p, id) => {
          expect(p.id).toBe(id);
          expect(p.a).not.toBe(p.b);
          expect(PASSAGE_KINDS).toContain(p.kind);
          const wide = p.tiles.length / 2;
          expect([1, 2, 3].slice(0, spec.gate)).toContain(wide);
          expect(p.tiles).toContainEqual({ x: p.x, y: p.y });
          for (const t of p.tiles) {
            expect(isWalkable(landing, t.x, t.y)).toBe(true);
            expect(landing.districtAt[index(landing, t)]).toBe(-1);
          }
        });
      }
      // More than one way home, in most landings of any class.
      expect(loops).toBeGreaterThan(SEEDS);
    });

    it(`${size}: the passages are the only ways between districts`, () => {
      for (const landing of landings[size]) {
        // No two districts' tiles are side by side, or corner to corner.
        for (let i = 0; i < landing.tiles.length; i++) {
          const here = landing.districtAt[i] as number;
          const { x, y } = pointAt(landing, i);
          if (here === -1) continue;
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
            [1, 1],
            [-1, 1],
          ] as const) {
            if (x + dx < 0 || x + dx >= landing.width || y + dy >= landing.height) continue;
            const there = landing.districtAt[index(landing, { x: x + dx, y: y + dy })] as number;
            if (there !== -1 && there !== here)
              throw new Error(
                `${landing.name}: districts ${here} and ${there} touch at (${x}, ${y})`,
              );
          }
        }
        // Every walkable tile outside a district joins the two districts of one passage.
        const joinedBy = new Set<string>();
        const pairs = new Set(
          landing.passages.map((p) => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`),
        );
        const groups = crossings(landing);
        for (const { tiles, touches } of groups) {
          const where = pointAt(landing, tiles[0] as number);
          expect(touches.length, `${landing.name} (${where.x}, ${where.y})`).toBeGreaterThan(0);
          expect(touches.length, `${landing.name} (${where.x}, ${where.y})`).toBeLessThan(3);
          if (touches.length === 2) joinedBy.add(touches.join("-"));
          else
            expect(
              landing.passages.some(
                (p) => p.kind === "open" && (p.a === touches[0] || p.b === touches[0]),
              ),
            ).toBe(true);
        }
        expect([...joinedBy].sort()).toEqual([...pairs].sort());
        // And each gate does join its two.
        for (const p of landing.passages) {
          const gate = groups.find((g) => g.tiles.includes(index(landing, p)));
          expect(gate?.touches).toEqual([Math.min(p.a, p.b), Math.max(p.a, p.b)]);
        }
      }
    });

    it(`${size}: a river is crossed only by its bridge and its fords, and an ash waste has none`, () => {
      let rivers = 0;
      let wet = 0;
      for (const landing of landings[size]) {
        const over = landing.passages.filter((p) => p.kind === "bridge" || p.kind === "ford");
        if (landing.biome === "ash_waste") {
          expect(over).toHaveLength(0);
          expect(landing.tiles.some((t) => TERRAINS[t] === "water")).toBe(false);
          continue;
        }
        wet++;
        if (over.length === 0) continue;
        rivers++;
        expect(over.filter((p) => p.kind === "bridge")).toHaveLength(1);
        expect(over.filter((p) => p.kind === "bridge")[0]?.tree).toBe(true);
        expect(over.filter((p) => p.kind === "ford").length).toBeLessThanOrEqual(spec.fords);
        for (const p of over.filter((q) => q.kind === "ford")) expect(p.tree).toBe(false);
        expect(landing.tiles.some((t) => TERRAINS[t] === "water")).toBe(true);
        // Without them, some districts cannot be reached at all.
        const dry = stepsFromCity(landing, (kind) => kind === "bridge" || kind === "ford");
        expect(dry.some((steps) => steps === -1)).toBe(true);
        expect(dry.filter((steps) => steps !== -1).length).toBeGreaterThan(1);
      }
      expect(rivers).toBe(wet);
    });

    it(`${size}: the horde's front comes in at known places and has a known way to the hull`, () => {
      for (const landing of landings[size]) {
        expect(landing.entries).toHaveLength(spec.entries);
        expect(new Set(landing.entries.map((e) => index(landing, e))).size).toBe(spec.entries);
        for (const entry of landing.entries) {
          const onEdge =
            landing.horde === "north"
              ? entry.y === 0
              : landing.horde === "south"
                ? entry.y === landing.height - 1
                : landing.horde === "west"
                  ? entry.x === 0
                  : entry.x === landing.width - 1;
          expect(onEdge).toBe(true);
          expect(entry.route[0]).toBe(entry.district);
          expect(entry.route.at(-1)).toBe(0);
          expect(entry.passages).toHaveLength(entry.route.length - 1);
          entry.passages.forEach((id, n) => {
            const p = landing.passages[id] as (typeof landing.passages)[0];
            expect([p.a, p.b].sort()).toEqual([entry.route[n], entry.route[n + 1]].sort());
          });
          // The path: from the entry to the ramp, a step at a time, on ground a monster may stand on.
          expect(entry.path[0]).toEqual({ x: entry.x, y: entry.y });
          expect(entry.path.at(-1)).toEqual(landing.ramp);
          entry.path.forEach((t, n) => {
            expect(isWalkable(landing, t.x, t.y)).toBe(true);
            const district = landing.districtAt[index(landing, t)] as number;
            if (district !== -1) expect(entry.route).toContain(district);
            if (n === 0) return;
            const before = entry.path[n - 1] as Point;
            expect(Math.abs(t.x - before.x) + Math.abs(t.y - before.y)).toBe(1);
            if (n < entry.path.length - 1) expect(terrainAt(landing, t.x, t.y)).not.toBe("camp");
          });
        }
      }
    });
  }
});

describe("generateLanding: every landing in the sweep", () => {
  it("has the sizes of the slice's spec", () => {
    expect([SIZES.clearing.width, SIZES.clearing.height]).toEqual([40, 22]);
    expect([SIZES.vale.width, SIZES.vale.height]).toEqual([60, 33]);
    expect([SIZES.valley.width, SIZES.valley.height]).toEqual([80, 45]);
    expect(SIZE_CLASSES.map((s) => [SIZES[s].dens, SIZES[s].caches, SIZES[s].far])).toEqual([
      [1, 1, 0],
      [3, 2, 5],
      [5, 3, 10],
    ]);
  });

  for (const size of SIZE_CLASSES) {
    const spec = SIZES[size];

    it(`${size}: is ${spec.width} by ${spec.height} with known terrain only`, () => {
      for (const landing of landings[size]) {
        expect([landing.width, landing.height]).toEqual([spec.width, spec.height]);
        expect(landing.tiles).toHaveLength(spec.width * spec.height);
        expect(landing.districtAt).toHaveLength(spec.width * spec.height);
        for (const t of landing.tiles) expect(TERRAINS[t]).toBeDefined();
      }
    });

    it(`${size}: every walkable tile can be reached from the ramp`, () => {
      for (const landing of landings[size]) {
        const seen = walks(landing);
        let walkable = 0;
        for (let i = 0; i < landing.tiles.length; i++) {
          const { x, y } = pointAt(landing, i);
          if (!isWalkable(landing, x, y)) continue;
          walkable++;
          if (!seen.has(i)) throw new Error(`${landing.name}: (${x}, ${y}) cannot be reached`);
        }
        expect(seen.size).toBe(walkable);
        // A landing is mostly ground to walk on.
        expect(walkable * 100).toBeGreaterThan(landing.tiles.length * 50);
      }
    });

    it(`${size}: the city stands on camp ground off the middle, its ramp three wide toward the land`, () => {
      for (const landing of landings[size]) {
        const { city, ramp } = landing;
        expect([city.width, city.height]).toEqual([CITY_WIDTH, CITY_HEIGHT]);
        for (let y = city.y; y < city.y + city.height; y++) {
          for (let x = city.x; x < city.x + city.width; x++) {
            expect(terrainAt(landing, x, y)).toBe("camp");
            expect(landing.districtAt[index(landing, { x, y })]).toBe(0);
          }
        }
        const [toX, toY] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][EDGES.indexOf(landing.horde)] as [number, number];
        // Two tiles out from the side of the footprint with the most land beyond it.
        if (toX > 0) expect(ramp.x).toBe(city.x + city.width + 1);
        if (toX < 0) expect(ramp.x).toBe(city.x - 2);
        if (toY > 0) expect(ramp.y).toBe(city.y + city.height + 1);
        if (toY < 0) expect(ramp.y).toBe(city.y - 2);
        // The ramp: its foot and the tile behind it, and the same on either side.
        expect(RAMP_WIDTH).toBe(3);
        for (const along of [-1, 0, 1]) {
          for (const back of [0, 1]) {
            const x = ramp.x - back * toX + along * Math.abs(toY);
            const y = ramp.y - back * toY + along * Math.abs(toX);
            expect(terrainAt(landing, x, y)).toBe("camp");
          }
        }
        // Off the middle, away from the horde's edge.
        const middle =
          toX !== 0 ? city.x + 5 - (landing.width >> 1) : city.y + 3 - (landing.height >> 1);
        expect(Math.sign(middle)).toBe(-(toX + toY));
        // Open ground all round the footprint and the ramp.
        for (let y = city.y - 2; y < city.y + city.height + 2; y++) {
          for (let x = city.x - 2; x < city.x + city.width + 2; x++) {
            expect(isWalkable(landing, x, y)).toBe(true);
          }
        }
      }
    });

    it(`${size}: dens, caches and seams stand in district slots, by ring, off the apron`, () => {
      const densIn = [0, 0, 0, 0];
      for (const [n, landing] of landings[size].entries()) {
        const given: { level: number; extraDens?: number; extraCaches?: number } = input(size, n);
        const names = landing.places.map((p) => p.name);
        expect(names).toEqual([...names].sort());
        expect(new Set(names).size).toBe(names.length);
        for (const p of landing.places) {
          expect(p.name).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
          expect(isWalkable(landing, p.x, p.y)).toBe(true);
        }
        expect(names).toContain("ramp");
        // Levels by ring, as the spec has them.
        expect(landing.level).toBe(given.level);
        expect(landing.levels).toEqual([
          APRON_LEVEL,
          Math.max(1, Math.floor(given.level / 3)),
          given.level,
          Math.min(99, given.level + spec.far),
        ]);
        expect(landing.dens).toHaveLength(spec.dens + (given.extraDens ?? 0));
        expect(landing.caches).toHaveLength(spec.caches + (given.extraCaches ?? 0));
        expect(landing.seams).toHaveLength(Math.floor((spec.width * spec.height) / 100));
        const walk = walks(landing);
        for (const s of [...landing.dens, ...landing.caches, ...landing.seams]) {
          expect(isWalkable(landing, s.x, s.y)).toBe(true);
          expect(s.district).not.toBe(0);
          expect(landing.districtAt[index(landing, s)]).toBe(s.district);
          expect(s.ring).toBe(landing.districts[s.district]?.ring);
          expect([1, 2, 3]).toContain(s.ring);
        }
        for (const s of [...landing.dens, ...landing.caches]) {
          expect(names).toContain(s.name);
          expect(s.level).toBe(landing.levels[s.ring]);
          // The apron stays gentle: nothing dangerous within its walk of the ramp.
          expect(walk.get(index(landing, s))).toBeGreaterThan(APRON);
        }
        for (const d of landing.dens) {
          expect(terrainAt(landing, d.x, d.y)).toBe("den");
          densIn[d.ring] = (densIn[d.ring] as number) + 1;
        }
        // A landing's first den and first cache are in the farthest ring.
        expect(landing.dens[0]?.ring).toBe(3);
        expect(landing.caches[0]?.ring).toBe(3);
        // No two things stand on one tile.
        const stands = [...landing.dens, ...landing.caches, ...landing.seams].map((s) =>
          index(landing, s),
        );
        expect(new Set(stands).size).toBe(stands.length);
        // No seams in the city's own district.
        expect(landing.seams.some((s) => s.district === 0)).toBe(false);
      }
      // More dens the farther out.
      expect(densIn[3]).toBeGreaterThan(densIn[2] as number);
      expect(densIn[2]).toBeGreaterThan(densIn[1] as number);
    });

    it(`${size}: has masses, not scattered single tiles, and worn paths`, () => {
      let blocked = 0;
      let alone = 0;
      for (const landing of landings[size]) {
        for (let y = 0; y < landing.height; y++) {
          for (let x = 0; x < landing.width; x++) {
            if (isWalkable(landing, x, y)) continue;
            blocked++;
            const touching = NEIGHBOURS.some(([dx, dy]) => {
              const [nx, ny] = [x + dx, y + dy];
              return (
                nx >= 0 &&
                ny >= 0 &&
                nx < landing.width &&
                ny < landing.height &&
                !isWalkable(landing, nx, ny)
              );
            });
            if (!touching) alone++;
          }
        }
        expect(landing.tiles.some((t) => TERRAINS[t] === "path")).toBe(true);
      }
      // A noise field would leave about half its blocked tiles alone.
      expect(alone * 100).toBeLessThan(blocked * 8);
    });
  }
});

describe("generateLanding: biomes", () => {
  it("each biome carries its element", () => {
    const elements = Object.fromEntries(
      BIOMES.map((biome) => [
        biome,
        generateLanding({ seed: 5, size: "clearing", biome, level: 5 }).element,
      ]),
    );
    expect(elements).toEqual({
      meadow: "none",
      pinewood: "none",
      fen: "cold",
      crags: "lightning",
      ash_waste: "fire",
    });
  });

  it("the biome picks the barriers and the cover", () => {
    /** Tiles of each terrain over the vales of one biome, out of 1000. */
    const share = (biome: Biome): Record<string, number> => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const landing of landings.vale.filter((l) => l.biome === biome)) {
        for (const t of landing.tiles) {
          counts[TERRAINS[t] as string] = (counts[TERRAINS[t] as string] ?? 0) + 1;
          total++;
        }
      }
      return Object.fromEntries(
        Object.entries(counts).map(([terrain, n]) => [terrain, Math.round((n * 1000) / total)]),
      );
    };
    const of = (biome: Biome, terrain: string): number => share(biome)[terrain] ?? 0;
    // Round trees on a meadow, dark ones in a pinewood and a fen.
    expect(of("meadow", "tree")).toBeGreaterThan(2 * of("meadow", "dark_tree"));
    expect(of("pinewood", "dark_tree")).toBeGreaterThan(2 * of("pinewood", "tree"));
    expect(of("fen", "dark_tree")).toBeGreaterThan(of("fen", "tree"));
    // A fen is the wettest; crags and an ash waste are mostly rock; an ash waste is dry.
    expect(of("fen", "water")).toBeGreaterThan(of("meadow", "water"));
    expect(of("crags", "rock")).toBeGreaterThan(3 * of("meadow", "rock"));
    expect(of("ash_waste", "rock")).toBeGreaterThan(3 * of("meadow", "rock"));
    expect(of("ash_waste", "water")).toBe(0);
  });

  it("a biome changes the dressing and not where the districts and gates are", () => {
    const meadow = generateLanding({ seed: 11, size: "vale", biome: "meadow", level: 9 });
    const crags = generateLanding({ seed: 11, size: "vale", biome: "crags", level: 9 });
    expect(crags.districts.map((d) => [d.x, d.y, d.bounds])).toEqual(
      meadow.districts.map((d) => [d.x, d.y, d.bounds]),
    );
    expect(crags.passages.map((p) => [p.a, p.b, p.tiles])).toEqual(
      meadow.passages.map((p) => [p.a, p.b, p.tiles]),
    );
    expect(crags.tiles).not.toEqual(meadow.tiles);
  });
});

describe("generateLanding: counts the caller raises", () => {
  it("adds a den and a cache for each one asked for, and moves nothing in the graph", () => {
    const plain = { seed: 99, size: "vale", biome: "pinewood", level: 20 } as const;
    const base = generateLanding(plain);
    const more = generateLanding({ ...plain, extraDens: 4, extraCaches: 3 });
    expect(more.dens).toHaveLength(base.dens.length + 4);
    expect(more.caches).toHaveLength(base.caches.length + 3);
    expect(more.dens.slice(0, base.dens.length)).toEqual(base.dens);
    expect(more.districts).toEqual(base.districts);
    expect(more.passages).toEqual(base.passages);
    expect(more.seams).toHaveLength(base.seams.length);
  });

  it("has room for the most that may be asked, on the smallest landing", () => {
    for (let seed = 0; seed < 20; seed++) {
      const landing = generateLanding({
        seed,
        size: "clearing",
        biome: BIOMES[seed % BIOMES.length] as Biome,
        level: 40,
        extraDens: MAX_EXTRA,
        extraCaches: MAX_EXTRA,
      });
      expect(landing.dens).toHaveLength(1 + MAX_EXTRA);
      expect(landing.caches).toHaveLength(1 + MAX_EXTRA);
      const walk = walks(landing);
      for (const s of [...landing.dens, ...landing.caches]) {
        expect(walk.get(index(landing, s))).toBeGreaterThan(APRON);
      }
      const stands = [...landing.dens, ...landing.caches, ...landing.seams].map((s) =>
        index(landing, s),
      );
      expect(new Set(stands).size).toBe(stands.length);
      expect(walk.size).toBe(walkableCount(landing));
    }
  });
});

describe("generateLanding: determinism", () => {
  it("gives the same landing for the same input, whatever was generated in between", () => {
    for (const size of SIZE_CLASSES) {
      const first = generateLanding(input(size, 7));
      generateLanding(input(size, 8));
      const again = generateLanding(input(size, 7));
      expect(again).toEqual(first);
      expect(hashLanding(again)).toBe(hashLanding(first));
    }
  });

  it("gives the same landings on every machine", () => {
    // Pinned. A change here without an intended reason is a determinism bug;
    // a change to the generator that is meant to move them updates them.
    expect(
      hashLanding(generateLanding({ seed: 1, size: "clearing", biome: "meadow", level: 5 })),
    ).toBe("49e06d687e9567a5");
    expect(hashLanding(generateLanding({ seed: 2, size: "vale", biome: "fen", level: 12 }))).toBe(
      "126a20ae28e5ba67",
    );
    expect(
      hashLanding(
        generateLanding({ seed: 3, size: "valley", biome: "ash_waste", level: 30, extraDens: 2 }),
      ),
    ).toBe("3d7c44789feea7c1");
  });

  it("gives different landings for different seeds", () => {
    for (const size of SIZE_CLASSES) {
      expect(new Set(landings[size].map(hashLanding)).size).toBe(SEEDS);
      // The graph differs too, not only the dressing.
      const graphs = landings[size].map((l) =>
        l.passages.map((p) => `${p.a}-${p.b}-${p.x}-${p.y}`).join(" "),
      );
      expect(new Set(graphs).size).toBeGreaterThan((SEEDS * 9) / 10);
    }
  });

  it("puts the horde on every edge across seeds", () => {
    for (const size of SIZE_CLASSES) {
      expect(new Set(landings[size].map((l) => l.horde))).toEqual(new Set(EDGES));
    }
  });
});

describe("generateLanding: cost", () => {
  it("takes a bounded time whatever the seed", () => {
    // A landing takes a few milliseconds; the bounds leave room for a slow runner.
    const budget: Record<SizeClass, number> = { clearing: 40, vale: 80, valley: 160 };
    for (const size of SIZE_CLASSES) {
      for (let n = 0; n < 5; n++) generateLanding(input(size, n));
      let worst = 0;
      const start = performance.now();
      for (let n = 0; n < 40; n++) {
        const before = performance.now();
        generateLanding(input(size, 1000 + n));
        worst = Math.max(worst, performance.now() - before);
      }
      const mean = (performance.now() - start) / 40;
      expect(mean, `${size} mean ms`).toBeLessThan(budget[size]);
      // No seed is an outlier: generation has no loop that a seed can lengthen.
      expect(worst, `${size} worst ms`).toBeLessThan(budget[size] * 5);
    }
  });
});

describe("generateLanding: refuses what is not an input", () => {
  const ok = { seed: 1, size: "clearing", biome: "meadow", level: 5 };
  const trap = new Proxy(
    {},
    {
      get: () => {
        throw new Error("trap");
      },
      ownKeys: () => {
        throw new Error("trap");
      },
    },
  );
  const getter = Object.defineProperty({ ...ok }, "seed", {
    enumerable: true,
    get: () => {
      throw new Error("trap");
    },
  });
  const cases: [string, unknown][] = [
    ["nothing", undefined],
    ["null", null],
    ["a number", 7],
    ["a list", [1, "clearing", "meadow", 5]],
    ["a seed with a fraction", { ...ok, seed: 1.5 }],
    ["a seed that is not a number", { ...ok, seed: "1" }],
    ["a seed past 32 bits", { ...ok, seed: 2 ** 31 }],
    ["a seed that is NaN", { ...ok, seed: Number.NaN }],
    ["a seed that is infinite", { ...ok, seed: Number.POSITIVE_INFINITY }],
    ["a missing seed", { size: "clearing", biome: "meadow", level: 5 }],
    [
      "a seed only on the prototype",
      Object.assign(Object.create({ seed: 1 }), { size: "vale", biome: "fen", level: 5 }),
    ],
    ["an unknown size", { ...ok, size: "mountain" }],
    ["a size in capitals", { ...ok, size: "VALE" }],
    ["a size named after the prototype", { ...ok, size: "__proto__" }],
    ["a size named after a method", { ...ok, size: "toString" }],
    ["a size that is not text", { ...ok, size: { toString: () => "vale" } }],
    ["a missing biome", { seed: 1, size: "clearing", level: 5 }],
    ["an unknown biome", { ...ok, biome: "tundra" }],
    ["a biome named after the prototype", { ...ok, biome: "constructor" }],
    ["a biome that is not text", { ...ok, biome: 2 }],
    ["a level of 0", { ...ok, level: 0 }],
    ["a level past the highest", { ...ok, level: MAX_LEVEL + 1 }],
    ["a level with a fraction", { ...ok, level: 0.5 }],
    ["a level as text", { ...ok, level: "5" }],
    ["a missing level", { seed: 1, size: "clearing", biome: "meadow" }],
    ["fewer dens than none", { ...ok, extraDens: -1 }],
    ["more dens than may be asked", { ...ok, extraDens: MAX_EXTRA + 1 }],
    ["half a den", { ...ok, extraDens: 0.5 }],
    ["dens as text", { ...ok, extraDens: "2" }],
    ["more caches than may be asked", { ...ok, extraCaches: MAX_EXTRA + 1 }],
    ["caches as a list", { ...ok, extraCaches: [1] }],
    ["an unknown field", { ...ok, colour: "red" }],
    ["a field the generator no longer takes", { ...ok, tier: 1 }],
    ["a getter that throws", getter],
    ["an object that throws on every read", trap],
  ];
  for (const [what, raw] of cases) {
    it(`refuses ${what}`, () => {
      expect(() => generateLanding(raw)).toThrow(LandingError);
    });
  }

  it("takes the seeds and the levels at the ends of their ranges", () => {
    for (const size of SIZE_CLASSES) {
      for (const seed of [0, -1, 2 ** 31 - 1, -(2 ** 31)]) {
        for (const level of [1, MAX_LEVEL]) {
          const landing = generateLanding({ seed, size, biome: "crags", level });
          expect(landing.levels[3]).toBeLessThanOrEqual(99);
          expect(walks(landing).size).toBe(walkableCount(landing));
        }
      }
    }
  });
});

describe("landingText", () => {
  it("prints the header and one line a row, with the horde's edge, the gates and the entries marked", () => {
    for (const size of SIZE_CLASSES) {
      const landing = landings[size][0] as Landing;
      for (const view of ["terrain", "districts", "rings"] as const) {
        const lines = landingText(landing, view).split("\n");
        const grid = lines.slice(5);
        const across = landing.horde === "north" || landing.horde === "south";
        expect(grid).toHaveLength(landing.height + (across ? 1 : 0));
        for (const row of grid) expect(row).toHaveLength(landing.width + (across ? 0 : 1));
        expect(lines[0]).toContain(`${size} ${landing.width}x${landing.height}, ${landing.biome}`);
        const drawn = grid.join("");
        expect(drawn).toContain("R");
        expect(drawn.split("H")).toHaveLength(landing.entries.length + 1);
        expect(drawn).toMatch(/[+=%]/);
        if (view !== "districts") {
          expect(drawn.split("D")).toHaveLength(landing.dens.length + 1);
          expect(drawn.split("C")).toHaveLength(landing.caches.length + 1);
        }
      }
    }
  });

  it("prints the graph, a line a district, passage and entry", () => {
    const landing = landings.vale[0] as Landing;
    const lines = landingGraphText(landing).split("\n");
    expect(lines).toHaveLength(
      landing.districts.length + landing.passages.length + landing.entries.length,
    );
    expect(lines[0]).toMatch(/^district 0: ring 0 city at/);
  });
});
