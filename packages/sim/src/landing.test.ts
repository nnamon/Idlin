import { describe, expect, it } from "vitest";
import {
  BIOMES,
  type Biome,
  CITIES,
  type CitySize,
  cachesOf,
  DISTRICT_KINDS,
  densOf,
  EDGES,
  FAR_STEP,
  generateLanding,
  hashLanding,
  type Landing,
  LandingError,
  landingGraphText,
  landingText,
  MAX_EXTRA,
  MAX_LEVEL,
  PASSAGE_KINDS,
  RAMP_CLEAR,
  RAMP_WIDTH,
  RIM,
  SIZES,
  type SizeClass,
  type SizeSpec,
  YARD_LEVEL,
  yardOf,
} from "./landing.ts";
import { isWalkable, NEIGHBOURS, type Point, TERRAINS, terrainAt } from "./map.ts";

// The gate checks a sample of seeds per landing; the capture workflow checks
// many more (IDLIN_LONG=1).
const LONG = process.env.IDLIN_LONG === "1";
const SEEDS = LONG ? 1000 : 100;
// The tests over every landing of a size take about 10 s each for 80 by 45
// under IDLIN_LONG=1 on CI.
const SWEEP_TIMEOUT = LONG ? 180_000 : 30_000;

/** The slice's five landings, by city size and class (docs/slice.md, section 1). */
const KEYS = ["1s", "1m", "1l", "2s", "2m"] as const;
type Key = (typeof KEYS)[number];
const OF: Record<Key, { city: CitySize; size: SizeClass }> = {
  "1s": { city: 1, size: "small" },
  "1m": { city: 1, size: "medium" },
  "1l": { city: 1, size: "large" },
  "2s": { city: 2, size: "small" },
  "2m": { city: 2, size: "medium" },
};
const specOf = (key: Key): SizeSpec => SIZES[OF[key].city][OF[key].size] as SizeSpec;
/** Pockets besides the city's district, a fact of each size (docs/slice.md, section 1). */
const POCKETS: Record<Key, number> = { "1s": 9, "1m": 9, "1l": 13, "2s": 18, "2m": 26 };
/** Section 1's worked crowds: the landing's level, and the far level its strongest citizen sets. */
const WORKED: Record<Key, { level: number; far: number }> = {
  "1s": { level: 8, far: 22 },
  "1m": { level: 8, far: 25 },
  "1l": { level: 8, far: 30 },
  "2s": { level: 23, far: 65 },
  "2m": { level: 23, far: 68 },
};

/**
 * The n-th input of a sweep: seeds spread over the 32-bit range, every biome,
 * levels and far levels across their ranges, and now and then more dens and
 * caches.
 */
const input = (key: Key, n: number) => {
  const level = 1 + ((n * 7) % MAX_LEVEL);
  return {
    seed: Math.imul(n + 1, 0x9e3779b1) | 0,
    ...OF[key],
    biome: BIOMES[n % BIOMES.length] as Biome,
    level,
    far: level + ((n * 13) % (MAX_LEVEL - level + 1)),
    ...(n % 4 === 3 ? { extraDens: n % 7, extraCaches: n % 6 } : {}),
  };
};
const extraOf = (key: Key, n: number): { dens: number; caches: number } => {
  const given: { extraDens?: number; extraCaches?: number } = input(key, n);
  return { dens: given.extraDens ?? 0, caches: given.extraCaches ?? 0 };
};

const sweep = (key: Key): Landing[] =>
  Array.from({ length: SEEDS }, (_, n) => generateLanding(input(key, n)));
const landings = Object.fromEntries(KEYS.map((key) => [key, sweep(key)])) as Record<Key, Landing[]>;
/** Twenty landings of each size at section 1's worked level and far level. */
const worked = Object.fromEntries(
  KEYS.map((key) => [
    key,
    Array.from({ length: 20 }, (_, n) =>
      generateLanding({
        seed: n + 1,
        ...OF[key],
        biome: BIOMES[n % BIOMES.length] as Biome,
        ...WORKED[key],
      }),
    ),
  ]),
) as Record<Key, Landing[]>;

const index = (landing: Landing, p: Point): number => p.y * landing.width + p.x;
const pointAt = (landing: Landing, i: number): Point => ({
  x: i % landing.width,
  y: Math.floor(i / landing.width),
});
const cheb = (a: Point, b: Point): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Steps of the shortest walk from some tiles to each tile it can reach, by the
 * map's own rules. Without camp ground, the walk steps off camp and never onto
 * it again, as a monster's must.
 */
function walksFrom(landing: Landing, starts: readonly Point[], camp: boolean): Map<number, number> {
  const steps = new Map(starts.map((p) => [index(landing, p), 0]));
  const queue = [...starts];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head] as Point;
    for (const [dx, dy] of NEIGHBOURS) {
      const next = { x: here.x + dx, y: here.y + dy };
      if (!isWalkable(landing, next.x, next.y) || steps.has(index(landing, next))) continue;
      if (!camp && terrainAt(landing, next.x, next.y) === "camp") continue;
      steps.set(index(landing, next), (steps.get(index(landing, here)) as number) + 1);
      queue.push(next);
    }
  }
  return steps;
}
const walks = (landing: Landing, camp = true): Map<number, number> =>
  walksFrom(landing, [landing.ramp], camp);
/** The walk out of the yard, the city's district, over the ground off the camp. */
const walkOut = (landing: Landing): Map<number, number> =>
  walksFrom(
    landing,
    landing.tiles.flatMap((_, i) => {
      const p = pointAt(landing, i);
      return landing.districtAt[i] === 0 &&
        isWalkable(landing, p.x, p.y) &&
        terrainAt(landing, p.x, p.y) !== "camp"
        ? [p]
        : [];
    }),
    false,
  );

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

/** A tile whose eight neighbours are walkable tiles of its own pocket. */
const inner = (landing: Landing, p: Point): boolean => {
  const d = landing.districtAt[index(landing, p)] as number;
  if (d < 1 || !isWalkable(landing, p.x, p.y)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (q.x < 0 || q.y < 0 || q.x >= landing.width || q.y >= landing.height) return false;
      if (landing.districtAt[index(landing, q)] !== d || !isWalkable(landing, q.x, q.y))
        return false;
    }
  }
  return true;
};

/**
 * The pockets with room for a den or a cache beside what already stands: a
 * tile whose eight neighbours are its pocket's ground, more than RAMP_CLEAR
 * tiles from the ramp, with nothing of `stood` within a tile.
 */
function roomIn(landing: Landing, stood: readonly Point[]): Set<number> {
  const found = new Set<number>();
  for (let i = 0; i < landing.tiles.length; i++) {
    const p = pointAt(landing, i);
    if (!inner(landing, p) || stood.some((s) => cheb(s, p) <= 1)) continue;
    if (Math.abs(p.x - landing.ramp.x) + Math.abs(p.y - landing.ramp.y) <= RAMP_CLEAR) continue;
    found.add(landing.districtAt[i] as number);
  }
  return found;
}

/**
 * Section 1's posts on the generator's map alone: inner tiles with nothing
 * that stands on them or beside them, taken row by row, each more than 3
 * tiles from every post of its pocket before it.
 */
function posts(landing: Landing): Point[] {
  const stands = [...landing.dens, ...landing.caches, ...landing.seams];
  const found: Point[] = [];
  for (let i = 0; i < landing.tiles.length; i++) {
    const p = pointAt(landing, i);
    if (!inner(landing, p) || stands.some((s) => cheb(s, p) <= 1)) continue;
    const d = landing.districtAt[i];
    if (found.some((q) => landing.districtAt[index(landing, q)] === d && cheb(q, p) <= 3)) continue;
    found.push(p);
  }
  return found;
}

/** The pockets in the order of the walk out of the yard: to their gate, then their centre, then number. */
function walkOrder(landing: Landing, out: Map<number, number>): number[] {
  return landing.districts
    .slice(1)
    .sort(
      (p, q) =>
        p.gate - q.gate ||
        (out.get(index(landing, p)) as number) - (out.get(index(landing, q)) as number) ||
        p.id - q.id,
    )
    .map((d) => d.id);
}

const median = (list: readonly number[]): number =>
  [...list].sort((a, b) => a - b)[Math.floor((list.length - 1) / 2)] as number;

describe("generateLanding: the layout graph", { timeout: SWEEP_TIMEOUT }, () => {
  for (const key of KEYS) {
    const spec = specOf(key);

    it(`${key}: the ramp's district is the root, and the pockets are ${POCKETS[key]}`, () => {
      for (const landing of landings[key]) {
        const { districts } = landing;
        expect(districts.length - 1).toBe(POCKETS[key]);
        expect(districts[0]).toMatchObject({
          ...landing.ramp,
          id: 0,
          ring: 0,
          kind: "city",
          gate: 0,
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
          expect(d.steps).toBeGreaterThan(0);
          expect(d.distance).toBeGreaterThan(0);
          expect(d.bounds.width).toBeGreaterThanOrEqual(4);
          expect(d.bounds.height).toBeGreaterThanOrEqual(4);
        });
      }
    });

    it(`${key}: rings are thirds of the pockets in the order of the walk out of the yard, recomputed from the map`, () => {
      for (const landing of landings[key]) {
        const out = walkOut(landing);
        // Each pocket's gate is the walk to its nearest tile on the finished map.
        for (const d of landing.districts.slice(1)) {
          let gate = -1;
          landing.districtAt.forEach((owner, i) => {
            const steps = out.get(i);
            if (owner === d.id && steps !== undefined && (gate === -1 || steps < gate))
              gate = steps;
          });
          expect(d.gate, `${landing.name} district ${d.id}`).toBe(gate);
        }
        const order = walkOrder(landing, out);
        order.forEach((d, k) => {
          expect(landing.districts[d]?.ring).toBe(1 + Math.floor((3 * k) / order.length));
        });
      }
    });

    it(`${key}: passages are a spanning tree and loops, with gates of walkable tiles`, () => {
      let loops = 0;
      for (const landing of landings[key]) {
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
      // More than one way home, in most landings of any size.
      expect(loops).toBeGreaterThan(SEEDS);
    });

    it(`${key}: the passages are the only ways between districts`, () => {
      for (const landing of landings[key]) {
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

    it(`${key}: a river is crossed only by its bridge and its fords, and an ash waste has none`, () => {
      let rivers = 0;
      let wet = 0;
      for (const landing of landings[key]) {
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

    it(`${key}: the rim is two tiles of barrier, broken by one gap on each side`, () => {
      for (const landing of landings[key]) {
        const { width, height } = landing;
        const depth = (x: number, y: number): number =>
          Math.min(x, y, width - 1 - x, height - 1 - y);
        const gapTiles = new Set(
          landing.entries.flatMap((e) => e.gap.map((t) => index(landing, t))),
        );
        expect(gapTiles.size).toBe(landing.entries.reduce((n, e) => n + e.gap.length, 0));
        for (let i = 0; i < landing.tiles.length; i++) {
          const { x, y } = pointAt(landing, i);
          if (depth(x, y) >= RIM) continue;
          if (isWalkable(landing, x, y) !== gapTiles.has(i))
            throw new Error(`${landing.name}: rim tile (${x}, ${y}) is wrong`);
        }
        expect(landing.entries.map((e) => e.edge)).toEqual([...EDGES]);
        for (const entry of landing.entries) {
          const side = EDGES.indexOf(entry.edge);
          /** How far in from the entry's own side, and how far along it. */
          const inward = (t: Point): number =>
            [t.y, width - 1 - t.x, height - 1 - t.y, t.x][side] as number;
          const along = (t: Point): number => (side % 2 === 0 ? t.x : t.y);
          expect(inward(entry)).toBe(0);
          // Two deep and two or three wide, centred on the entry.
          const wide = entry.gap.length / 2;
          expect([2, 3]).toContain(wide);
          for (const t of entry.gap) {
            expect(inward(t)).toBeLessThan(RIM);
            expect(Math.abs(along(t) - along(entry))).toBeLessThanOrEqual(1);
            expect(landing.districtAt[index(landing, t)]).toBe(entry.district);
          }
          expect(new Set(entry.gap.map(along)).size).toBe(wide);
          // It opens into its district's ground, not into a border, and never
          // straight onto the city's.
          const inner = entry.path[RIM] as Point;
          expect(inward(inner)).toBe(RIM);
          expect(landing.districtAt[index(landing, inner)]).toBe(entry.district);
          expect(entry.district).not.toBe(0);
        }
        // The four gaps lead into the ground of at least two districts.
        expect(new Set(landing.entries.map((e) => e.district)).size).toBeGreaterThan(1);
      }
    });

    it(`${key}: the horde's front comes in at each gap and has a known way to the hull`, () => {
      for (const landing of landings[key]) {
        expect(landing.entries).toHaveLength(4);
        expect(new Set(landing.entries.map((e) => index(landing, e))).size).toBe(4);
        for (const entry of landing.entries) {
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

describe("generateLanding: every landing in the sweep", { timeout: SWEEP_TIMEOUT }, () => {
  it("has the sizes, cities and counts of the slice's spec", () => {
    expect(KEYS.map((key) => [specOf(key).width, specOf(key).height])).toEqual([
      [52, 29],
      [56, 31],
      [60, 33],
      [68, 38],
      [80, 45],
    ]);
    // The second city's large waits for #418.
    expect(SIZES[2].large).toBeUndefined();
    expect(CITIES[1]).toEqual({ hull: [13, 6], feet: [19, 12], clear: 2 });
    expect(CITIES[2]).toEqual({ hull: [15, 6], feet: [21, 14], clear: 4 });
    expect([yardOf(CITIES[1]), yardOf(CITIES[2])]).toEqual([
      [23, 16],
      [29, 22],
    ]);
    // Dens by 700 tiles to the nearest; caches by 1,100, one at least.
    expect(KEYS.map((key) => [densOf(specOf(key)), cachesOf(specOf(key))])).toEqual([
      [2, 1],
      [2, 2],
      [3, 2],
      [4, 2],
      [5, 3],
    ]);
    expect([RAMP_WIDTH, RIM, RAMP_CLEAR, YARD_LEVEL]).toEqual([3, 2, 8, 5]);
    expect(FAR_STEP).toEqual({ small: 7, medium: 10, large: 15 });
  });

  for (const key of KEYS) {
    const spec = specOf(key);
    const shape = CITIES[OF[key].city];
    const [yardW, yardH] = yardOf(shape);

    it(`${key}: is ${spec.width} by ${spec.height} with known terrain only`, () => {
      for (const landing of landings[key]) {
        expect([landing.width, landing.height]).toEqual([spec.width, spec.height]);
        expect(landing.citySize).toBe(OF[key].city);
        expect(landing.size).toBe(OF[key].size);
        expect(landing.tiles).toHaveLength(spec.width * spec.height);
        expect(landing.districtAt).toHaveLength(spec.width * spec.height);
        expect(landing.ground).toHaveLength(spec.width * spec.height);
        expect(landing.tiles.findIndex((t) => TERRAINS[t] === undefined)).toBe(-1);
      }
    });

    it(`${key}: every walkable tile can be reached from the ramp`, () => {
      for (const landing of landings[key]) {
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

    it(`${key}: a monster, which may not stand on camp ground, can reach every other walkable tile from the ramp`, () => {
      for (const landing of landings[key]) {
        const seen = walks(landing, false);
        let open = 0;
        for (let i = 0; i < landing.tiles.length; i++) {
          const { x, y } = pointAt(landing, i);
          if (!isWalkable(landing, x, y) || terrainAt(landing, x, y) === "camp") continue;
          open++;
          if (!seen.has(i))
            throw new Error(`${landing.name}: (${x}, ${y}) cannot be reached without camp`);
        }
        // The ramp itself, and everything else.
        expect(seen.size).toBe(open + 1);
        // Every den, chest (cache), scrap pile (seam) and gap is among them.
        for (const s of [
          ...landing.dens,
          ...landing.caches,
          ...landing.seams,
          ...landing.entries,
          ...landing.entries.flatMap((e) => e.gap),
        ])
          expect(seen.has(index(landing, s))).toBe(true);
      }
    });

    it(`${key}: the city's ground is the bubble's footprint in the middle, the hull on camp in its middle, its ramp three wide`, () => {
      for (const landing of landings[key]) {
        const { city, ramp, width, height } = landing;
        expect([city.width, city.height]).toEqual(shape.hull);
        for (let y = city.y; y < city.y + city.height; y++) {
          for (let x = city.x; x < city.x + city.width; x++) {
            expect(terrainAt(landing, x, y)).toBe("camp");
            expect(landing.districtAt[index(landing, { x, y })]).toBe(0);
          }
        }
        const side = EDGES.indexOf(landing.rampSide);
        const [toX, toY] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ][side] as [number, number];
        // The city's district is the feet and 2 or 4 tiles round them, 23 by 16 or 29 by 22.
        const home = (landing.districts[0] as Landing["districts"][0]).bounds;
        expect([home.width, home.height]).toEqual([yardW, yardH]);
        // It is centred on the map, and the hull is centred in it; to half a
        // tile where one of the two lengths is odd and the other even.
        const centred = (x: number, y: number, w: number, h: number): void => {
          expect(Math.abs(2 * x + w - width), landing.name).toBeLessThanOrEqual((width + w) % 2);
          expect(Math.abs(2 * y + h - height), landing.name).toBeLessThanOrEqual((height + h) % 2);
        };
        centred(home.x, home.y, home.width, home.height);
        expect(2 * (city.x - home.x) + city.width).toBe(home.width);
        expect(2 * (city.y - home.y) + city.height).toBe(home.height);
        // All of it but its outermost tiles is the city's own and open.
        for (let y = home.y + 1; y < home.y + home.height - 1; y++) {
          for (let x = home.x + 1; x < home.x + home.width - 1; x++) {
            expect(landing.districtAt[index(landing, { x, y })]).toBe(0);
            expect(isWalkable(landing, x, y)).toBe(true);
          }
        }
        // Two tiles out from the middle of its side of the hull.
        if (toX !== 0) expect(ramp.y).toBe(city.y + (city.height >> 1));
        if (toY !== 0) expect(ramp.x).toBe(city.x + (city.width >> 1));
        if (toX > 0) expect(ramp.x).toBe(city.x + city.width + 1);
        if (toX < 0) expect(ramp.x).toBe(city.x - 2);
        if (toY > 0) expect(ramp.y).toBe(city.y + city.height + 1);
        if (toY < 0) expect(ramp.y).toBe(city.y - 2);
        // The ramp: its foot and the tile behind it, and the same on either side.
        for (const along of [-1, 0, 1]) {
          for (const back of [0, 1]) {
            const x = ramp.x - back * toX + along * Math.abs(toY);
            const y = ramp.y - back * toY + along * Math.abs(toX);
            expect(terrainAt(landing, x, y)).toBe("camp");
          }
        }
        // Open ground of the city's in front of the ramp, short of the city's
        // outermost tile: two tiles at the least.
        const apron = toX !== 0 ? (yardW - city.width) >> 1 : (yardH - city.height) >> 1;
        expect(apron - 3).toBeGreaterThanOrEqual(2);
        for (let k = 1; k <= apron - 3; k++) {
          const [x, y] = [ramp.x + k * toX, ramp.y + k * toY];
          expect(terrainAt(landing, x, y)).not.toBe("camp");
          expect(isWalkable(landing, x, y)).toBe(true);
          expect(landing.districtAt[index(landing, { x, y })]).toBe(0);
        }
      }
    });

    it(`${key}: nothing but the city's open ground, camp and ramp lies under the drawn legs`, () => {
      for (const landing of landings[key]) {
        const { city, legs } = landing;
        // Centred on the hull: 19 by 12 or 21 by 14.
        expect(legs).toEqual({
          x: city.x - ((shape.feet[0] - shape.hull[0]) >> 1),
          y: city.y - ((shape.feet[1] - shape.hull[1]) >> 1),
          width: shape.feet[0],
          height: shape.feet[1],
        });
        const under = (p: Point): boolean =>
          p.x >= legs.x && p.y >= legs.y && p.x < legs.x + legs.width && p.y < legs.y + legs.height;
        for (let y = legs.y; y < legs.y + legs.height; y++) {
          for (let x = legs.x; x < legs.x + legs.width; x++) {
            const where = `${landing.name} (${x}, ${y})`;
            expect(landing.districtAt[index(landing, { x, y })], where).toBe(0);
            expect(isWalkable(landing, x, y), where).toBe(true);
          }
        }
        const things = [
          ...landing.dens,
          ...landing.caches,
          ...landing.seams,
          ...landing.entries.flatMap((e) => e.gap),
          ...landing.passages.flatMap((p) => p.tiles),
        ];
        expect(things.filter(under), landing.name).toEqual([]);
      }
    });

    it(`${key}: has pockets on every side of the city's ground`, () => {
      for (const landing of landings[key]) {
        const { width, height } = landing;
        const home = (landing.districts[0] as Landing["districts"][0]).bounds;
        // The strip straight across each side, from the city's ground to the rim, in EDGES order.
        const strips = [
          [home.x, RIM, home.x + home.width, home.y],
          [home.x + home.width, home.y, width - RIM, home.y + home.height],
          [home.x, home.y + home.height, home.x + home.width, height - RIM],
          [RIM, home.y, home.x, home.y + home.height],
        ] as const;
        strips.forEach(([x0, y0, x1, y1], side) => {
          const where = `${landing.name} ${EDGES[side]}`;
          // At least a block deep.
          expect(Math.min(x1 - x0, y1 - y0), where).toBeGreaterThanOrEqual(4);
          // Ground of another district there, more than a block's worth.
          let open = 0;
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              const district = landing.districtAt[index(landing, { x, y })] as number;
              if (district > 0 && isWalkable(landing, x, y)) open++;
            }
          }
          expect(open, where).toBeGreaterThanOrEqual(16);
        });
      }
    });

    it(`${key}: each pocket has one level, which never falls along the walk out of the yard`, () => {
      for (const [n, landing] of landings[key].entries()) {
        const given = input(key, n);
        const { level, far } = given;
        expect([landing.level, landing.far]).toEqual([level, far]);
        const third = Math.max(1, Math.floor(level / 3));
        const levelOf = landing.districts.map((d) => d.level);
        // The yard is a third of the level, and 5 at most.
        expect(levelOf[0]).toBe(Math.min(YARD_LEVEL, third));
        // Every tile of a district has its level; a barrier has none.
        landing.ground.forEach((g, i) => {
          const d = landing.districtAt[i] as number;
          const { x, y } = pointAt(landing, i);
          if (d !== -1) expect(g).toBe(levelOf[d]);
          else if (!isWalkable(landing, x, y)) expect(g).toBe(-1);
        });
        // A gate or an opened border has the lower level of the districts beside it.
        for (const p of landing.passages) {
          for (const t of p.tiles)
            expect(landing.ground[index(landing, t)]).toBe(
              Math.min(levelOf[p.a] as number, levelOf[p.b] as number),
            );
        }
        for (const { tiles, touches } of crossings(landing)) {
          if (touches.length !== 2) continue;
          const low = Math.min(...touches.map((d) => levelOf[d] as number));
          for (const t of tiles) expect(landing.ground[t]).toBe(low);
        }
        // By the order of the walk: ring 1 steps up from a third of the level,
        // ring 2 is at it, ring 3 steps up to the far level and the rest are at it.
        const order = walkOrder(landing, walkOut(landing));
        const ring = (r: number): number[] => order.filter((d) => landing.districts[d]?.ring === r);
        ring(1).forEach((d, k, list) => {
          expect(levelOf[d]).toBe(third + Math.floor(((level - third) * k) / list.length));
        });
        for (const d of ring(2)) expect(levelOf[d]).toBe(level);
        const outmost = ring(3);
        const climb = Math.min(
          outmost.length,
          Math.max(Math.ceil(outmost.length / 2), Math.ceil((far - level) / 10)),
        );
        outmost.forEach((d, k) => {
          expect(levelOf[d]).toBe(
            k < climb ? level + Math.floor(((far - level) * (k + 1)) / climb) : far,
          );
        });
        expect(levelOf[order.at(-1) as number]).toBe(far);
        order.forEach((d, k) => {
          if (k > 0)
            expect(levelOf[d]).toBeGreaterThanOrEqual(levelOf[order[k - 1] as number] as number);
        });
      }
    });

    it(`${key}: at section 1's worked levels, the yard is 5 or less and ring 3 steps 10 levels or less`, () => {
      const { level, far } = WORKED[key];
      for (const landing of worked[key]) {
        expect(landing.districts[0]?.level).toBeLessThanOrEqual(5);
        const order = walkOrder(landing, walkOut(landing));
        const levels = order.map((d) => landing.districts[d]?.level as number);
        const third = levels.filter((_, k) => landing.districts[order[k] as number]?.ring === 3);
        [level, ...third].forEach((v, k, list) => {
          if (k > 0) expect(v - (list[k - 1] as number)).toBeLessThanOrEqual(10);
        });
        expect(third.at(-1)).toBe(far);
        // The first den is at the far level, and no pocket holds two.
        expect(landing.dens[0]?.level).toBe(far);
        expect(new Set(landing.dens.map((d) => d.district)).size).toBe(landing.dens.length);
      }
    });

    it(`${key}: dens are aimed at ring 3's levels from the far level down, one a pocket, lettered by the walk from the ramp`, () => {
      const own = densOf(spec);
      let aimed = 0;
      let aimedExactly = 0;
      for (const [n, landing] of landings[key].entries()) {
        const extra = extraOf(key, n).dens;
        // The pockets a den could stand in: those with a clear tile once the
        // seams stood. Another pocket's den is never within a tile of one.
        const room = roomIn(landing, landing.seams);
        // The size's own and the caller's, one a pocket at most.
        expect(landing.dens).toHaveLength(Math.min(own + extra, room.size));
        expect(new Set(landing.dens.map((d) => d.district)).size).toBe(landing.dens.length);
        // The own dens aimed at ring 3's levels, from the far level down, one a
        // level: each at the level nearest its aim of a pocket with room and no den.
        const aims = [
          ...new Set(landing.districts.filter((d) => d.ring === 3).map((d) => d.level)),
        ].sort((p, q) => q - p);
        aims.slice(0, own).forEach((aim, k) => {
          const before = new Set(landing.dens.slice(0, k).map((d) => d.district));
          const nearest = Math.min(
            ...[...room]
              .filter((d) => !before.has(d))
              .map((d) => Math.abs((landing.districts[d]?.level as number) - aim)),
          );
          expect(Math.abs((landing.dens[k]?.level as number) - aim), landing.name).toBe(nearest);
          if (nearest === 0) aimedExactly++;
          aimed++;
        });
        // The caller's first den: in the first pocket by the walk with room and no own den.
        if (extra > 0 && landing.dens.length > own) {
          const order = walkOrder(landing, walkOut(landing));
          const owned = new Set(landing.dens.slice(0, own).map((d) => d.district));
          expect(landing.dens[own]?.district).toBe(order.find((d) => !owned.has(d) && room.has(d)));
        }
        for (const d of landing.dens) {
          expect(d.level).toBe(landing.districts[d.district]?.level);
          expect(d.elite).toBe(Math.min(landing.far, d.level + 5));
          expect(terrainAt(landing, d.x, d.y)).toBe("den");
        }
        // A to the count, by the walk from the ramp, then the lower tile.
        const walk = walks(landing, false);
        const byWalk = [...landing.dens].sort(
          (p, q) =>
            (walk.get(index(landing, p)) as number) - (walk.get(index(landing, q)) as number) ||
            index(landing, p) - index(landing, q),
        );
        expect(byWalk.map((d) => d.letter)).toEqual(
          byWalk.map((_, k) => String.fromCharCode(65 + k)),
        );
        for (const d of landing.dens) expect(d.name).toBe(`den_${d.letter.toLowerCase()}`);
        // The places a program can name: the ramp, the city and the dens.
        expect(landing.places.map((p) => p.name)).toEqual(
          ["city", "ramp", ...landing.dens.map((d) => d.name)].sort(),
        );
        for (const p of landing.places) expect(p.name).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
      }
      // Nearly always a pocket at the aim itself has room.
      console.log(`aimed dens ${key}: ${aimedExactly} of ${aimed} at their aim`);
      expect(aimedExactly * 100).toBeGreaterThanOrEqual(aimed * 90);
    });

    it(`${key}: dens, caches and seams stand on their own tiles in pockets, the first cache at the far level`, () => {
      const densIn = [0, 0, 0, 0];
      let farCaches = 0;
      for (const [n, landing] of landings[key].entries()) {
        const extra = extraOf(key, n);
        expect(landing.caches).toHaveLength(cachesOf(spec) + extra.caches);
        expect(landing.seams).toHaveLength(Math.floor((spec.width * spec.height) / 100));
        // The first cache: at the level nearest the far level of a pocket with room.
        const room = roomIn(landing, [...landing.seams, ...landing.dens]);
        const nearest = Math.min(
          ...[...room].map((d) => landing.far - (landing.districts[d]?.level as number)),
        );
        expect(landing.far - (landing.caches[0]?.level as number), landing.name).toBe(nearest);
        if (nearest === 0) farCaches++;
        for (const s of [...landing.dens, ...landing.caches, ...landing.seams]) {
          expect(isWalkable(landing, s.x, s.y)).toBe(true);
          expect(s.district).not.toBe(0);
          expect(landing.districtAt[index(landing, s)]).toBe(s.district);
          expect(s.ring).toBe(landing.districts[s.district]?.ring);
          expect([1, 2, 3]).toContain(s.ring);
        }
        // A den or a cache: on a tile whose eight neighbours are its pocket's
        // ground, more than 8 tiles from the ramp, nothing else within a tile.
        const worth = [...landing.dens, ...landing.caches];
        const all = [...worth, ...landing.seams];
        for (const s of worth) {
          expect(inner(landing, s), `${landing.name} (${s.x}, ${s.y})`).toBe(true);
          expect(Math.abs(s.x - landing.ramp.x) + Math.abs(s.y - landing.ramp.y)).toBeGreaterThan(
            RAMP_CLEAR,
          );
          for (const t of all) if (t !== s) expect(cheb(s, t)).toBeGreaterThan(1);
        }
        for (const c of landing.caches) expect(c.level).toBe(landing.districts[c.district]?.level);
        for (const d of landing.dens) densIn[d.ring] = (densIn[d.ring] as number) + 1;
        // No two things stand on one tile.
        const stands = all.map((s) => index(landing, s));
        expect(new Set(stands).size).toBe(stands.length);
      }
      // More dens the farther out.
      expect(densIn[3]).toBeGreaterThan(densIn[2] as number);
      // Nearly always a pocket at the far level has room for the first cache.
      console.log(`first caches ${key}: ${farCaches} of ${landings[key].length} at the far level`);
      expect(farCaches * 100).toBeGreaterThanOrEqual(landings[key].length * 90);
    });

    it(`${key}: has masses, not scattered single tiles, and worn paths`, () => {
      let blocked = 0;
      let alone = 0;
      for (const landing of landings[key]) {
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

  // Section 1's posts on the generator's map, at the worked levels with no
  // extra dens or caches: medians of 29, 36, 40, 47 and 82 over the 20
  // landings. packages/sim/scripts/plate.ts stands shrines, wrecks and seams
  // of ore besides (#416), and counts fewer: 24, 33, 36, 41 and 70 on 100.
  const POSTS: Record<Key, number> = { "1s": 26, "1m": 33, "1l": 36, "2s": 42, "2m": 74 };
  for (const key of KEYS) {
    it(`${key}: has room for ${POSTS[key]} posts or more at the median`, () => {
      const counts = worked[key].map((l) => posts(l).length);
      console.log(
        `posts ${key}: median ${median(counts)}, ${Math.min(...counts)} to ${Math.max(...counts)}`,
      );
      expect(median(counts)).toBeGreaterThanOrEqual(POSTS[key]);
    });
  }
});

describe("generateLanding: biomes", () => {
  it("each biome carries its element", () => {
    const elements = Object.fromEntries(
      BIOMES.map((biome) => [
        biome,
        generateLanding({ seed: 5, size: "small", biome, level: 5 }).element,
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
    /** Tiles of each terrain over the landings of one biome, out of 1000. */
    const share = (biome: Biome): Record<string, number> => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const landing of landings["2m"].filter((l) => l.biome === biome)) {
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
    const meadow = generateLanding({ seed: 11, size: "large", biome: "meadow", level: 9 });
    const crags = generateLanding({ seed: 11, size: "large", biome: "crags", level: 9 });
    expect(crags.districts.map((d) => [d.x, d.y, d.bounds])).toEqual(
      meadow.districts.map((d) => [d.x, d.y, d.bounds]),
    );
    expect(crags.passages.map((p) => [p.a, p.b, p.tiles])).toEqual(
      meadow.passages.map((p) => [p.a, p.b, p.tiles]),
    );
    expect(crags.tiles).not.toEqual(meadow.tiles);
  });
});

describe("generateLanding: what the caller sets", () => {
  it("adds a den and a cache for each one asked for, and moves nothing in the graph or the levels", () => {
    const plain = { seed: 99, city: 2, size: "medium", biome: "pinewood", level: 20 } as const;
    const base = generateLanding(plain);
    const more = generateLanding({ ...plain, extraDens: 4, extraCaches: 3 });
    expect(more.dens).toHaveLength(base.dens.length + 4);
    expect(more.caches).toHaveLength(base.caches.length + 3);
    // The size's own dens stand where they did; their letters may move.
    expect(more.dens.slice(0, base.dens.length).map((d) => [d.x, d.y, d.level])).toEqual(
      base.dens.map((d) => [d.x, d.y, d.level]),
    );
    expect(more.districts).toEqual(base.districts);
    expect(more.passages).toEqual(base.passages);
    expect(more.ground).toEqual(base.ground);
    expect(more.seams).toEqual(base.seams);
  });

  it("stands one den a pocket and every cache asked for, at the most that may be asked, on the smallest landing", () => {
    for (let seed = 0; seed < 20; seed++) {
      const landing = generateLanding({
        seed,
        size: "small",
        biome: BIOMES[seed % BIOMES.length] as Biome,
        level: 40,
        extraDens: MAX_EXTRA,
        extraCaches: MAX_EXTRA,
      });
      // One in every pocket with room for one: all but the smallest of the nine.
      const room = roomIn(landing, landing.seams).size;
      expect(room).toBeGreaterThanOrEqual(landing.districts.length - 2);
      expect(landing.dens).toHaveLength(room);
      expect(landing.caches).toHaveLength(1 + MAX_EXTRA);
      const stands = [...landing.dens, ...landing.caches, ...landing.seams].map((s) =>
        index(landing, s),
      );
      expect(new Set(stands).size).toBe(stands.length);
      expect(walks(landing).size).toBe(walkableCount(landing));
    }
  });

  it("takes the far level, and without one sets it by the class over the level", () => {
    const at = (far?: number) =>
      generateLanding({
        seed: 4,
        city: 2,
        size: "small",
        biome: "fen",
        level: 23,
        ...(far === undefined ? {} : { far }),
      });
    expect(at().far).toBe(23 + FAR_STEP.small);
    expect(at(65).far).toBe(65);
    // At the far level of the level itself, every pocket past ring 1 is at it.
    const flat = at(23);
    for (const d of flat.districts.filter((e) => e.ring >= 2)) expect(d.level).toBe(23);
    expect(generateLanding({ seed: 1, size: "large", biome: "meadow", level: 95 }).far).toBe(99);
    // The far level moves the levels and the dens, and not the graph.
    expect(at(65).districts.map((d) => [d.x, d.y, d.bounds])).toEqual(
      at(40).districts.map((d) => [d.x, d.y, d.bounds]),
    );
    expect(at(65).districts.map((d) => d.level)).not.toEqual(at(40).districts.map((d) => d.level));
  });

  it("matches section 1's worked levels on a level-23 medium landing of the second city", () => {
    // Ring 1's nine pockets at 7 to 21, ring 2's nine at 23, ring 3's eight at
    // 32, 41, 50, 59 and 68, and 68 for the last three.
    let exact = 0;
    for (const landing of worked["2m"]) {
      const order = walkOrder(landing, walkOut(landing));
      expect(order.map((d) => landing.districts[d]?.level)).toEqual([
        7, 8, 10, 12, 14, 15, 17, 19, 21, 23, 23, 23, 23, 23, 23, 23, 23, 23, 32, 41, 50, 59, 68,
        68, 68, 68,
      ]);
      expect(landing.dens[0]?.level).toBe(68);
      exact += Number(landing.dens.map((d) => d.level).join() === "68,59,50,41,32");
    }
    // The five dens at 68, 59, 50, 41 and 32 unless a pocket at one of them has
    // no room (the sweep checks the nearest is taken then).
    expect(exact).toBeGreaterThanOrEqual(18);
  });
});

describe("generateLanding: determinism", () => {
  it("gives the same landing for the same input, whatever was generated in between", () => {
    for (const key of KEYS) {
      const first = generateLanding(input(key, 7));
      generateLanding(input(key, 8));
      const again = generateLanding(input(key, 7));
      expect(again).toEqual(first);
      expect(hashLanding(again)).toBe(hashLanding(first));
    }
  });

  it("gives the same landings on every machine", () => {
    // Pinned. A change here without an intended reason is a determinism bug;
    // a change to the generator that is meant to move them updates them.
    expect(
      hashLanding(generateLanding({ seed: 1, size: "small", biome: "meadow", level: 5 })),
    ).toBe("5afd67b142147a78");
    expect(
      hashLanding(generateLanding({ seed: 2, size: "large", biome: "fen", level: 12, far: 30 })),
    ).toBe("4f081b3953b84b34");
    expect(
      hashLanding(
        generateLanding({
          seed: 3,
          city: 2,
          size: "medium",
          biome: "ash_waste",
          level: 30,
          far: 68,
          extraDens: 2,
        }),
      ),
    ).toBe("a06bc07f5b8257a6");
  });

  it("gives different landings for different seeds", () => {
    for (const key of KEYS) {
      expect(new Set(landings[key].map(hashLanding)).size).toBe(SEEDS);
      // The graph differs too, not only the dressing.
      const graphs = landings[key].map((l) =>
        l.passages.map((p) => `${p.a}-${p.b}-${p.x}-${p.y}`).join(" "),
      );
      expect(new Set(graphs).size).toBeGreaterThan((SEEDS * 9) / 10);
    }
  });

  it("puts the ramp on every side of the hull across seeds", () => {
    for (const key of KEYS) {
      const sides = landings[key].map((l) => l.rampSide);
      // Each side about a quarter of the time: 100 seeds give 15 or more of each.
      for (const side of EDGES) {
        expect(sides.filter((s) => s === side).length).toBeGreaterThan(SEEDS * 0.15);
      }
    }
  });
});

describe("generateLanding: cost", () => {
  it("takes a bounded time whatever the seed", () => {
    const budget: Record<Key, number> = { "1s": 25, "1m": 25, "1l": 30, "2s": 40, "2m": 75 };
    const count = LONG ? 200 : 40;
    for (const key of KEYS) {
      for (let n = 0; n < 5; n++) generateLanding(input(key, n));
      const times: number[] = [];
      for (let n = 0; n < count; n++) {
        const before = performance.now();
        generateLanding(input(key, 1000 + n));
        times.push(performance.now() - before);
      }
      const mean = times.reduce((a, b) => a + b) / count;
      const middle = median(times);
      const worst = Math.max(...times);
      console.log(
        `landing ${key}: mean ${mean.toFixed(1)} ms, median ${middle.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`,
      );
      // Wall time depends on what else the machine is doing (the gate runs the
      // other test files beside this one), so the gate only prints it and the
      // long run checks it, as scale.test.ts does.
      if (!LONG) continue;
      expect(mean, `${key} mean ms`).toBeLessThan(budget[key]);
      // No seed is far slower than the rest. A pause for garbage collection or
      // for another process falls on one run of a seed and not the next, so the
      // five slowest are timed again, and each is judged by its fastest of three.
      const slowest = times
        .map((t, n) => [t, n] as const)
        .sort((p, q) => q[0] - p[0])
        .slice(0, 5);
      for (const [, n] of slowest) {
        let fastest = Number.POSITIVE_INFINITY;
        for (let k = 0; k < 3; k++) {
          const before = performance.now();
          generateLanding(input(key, 1000 + n));
          fastest = Math.min(fastest, performance.now() - before);
        }
        expect(fastest, `${key} seed ${1000 + n}, median ${middle.toFixed(1)}`).toBeLessThan(
          middle * 5 + 30,
        );
      }
    }
  });

  it("refuses a map of more tiles than the growth's heap keys can hold", () => {
    // The growth packs a tile index into 12 bits, so 4,096 tiles at most. The
    // sizes are fixed, so the test widens the largest one for a moment.
    const spec = SIZES[2].medium as { width: number };
    const width = spec.width;
    const make = () =>
      generateLanding({ seed: 1, city: 2, size: "medium", biome: "meadow", level: 5 });
    try {
      spec.width = 91; // 4,095 tiles
      expect(make().width).toBe(91);
      spec.width = 92; // 4,140 tiles
      expect(make).toThrow("more tiles than its growth can order");
    } finally {
      spec.width = width;
    }
  });

  it("refuses a size with no room for a strip of blocks on every side of the city, on every seed or none", () => {
    // The least room each way: rim, block, the bubble's footprint, block, rim.
    // For the first city's 23 by 16 that is 35 by 28. One tile less either way
    // leaves a strip three deep on that axis.
    const spec = SIZES[1].small as { width: number; height: number };
    const [width, height] = [spec.width, spec.height];
    const [yardW, yardH] = yardOf(CITIES[1]);
    const [w, h] = [2 * RIM + 2 * 4 + yardW, 2 * RIM + 2 * 4 + yardH];
    expect([w, h]).toEqual([35, 28]);
    /** The ramp sides of 40 seeds on a map this size, or the refusals. */
    const sides = (x: number, y: number): string[] => {
      [spec.width, spec.height] = [x, y];
      return Array.from({ length: 40 }, (_, seed) => {
        try {
          const landing = generateLanding({ seed, size: "small", biome: "meadow", level: 5 });
          expect(walks(landing).size).toBe(walkableCount(landing));
          return landing.rampSide;
        } catch (error) {
          expect(String(error)).toContain("no room for blocks on every side of the city");
          return "refused";
        }
      });
    };
    try {
      // At the least, every seed fits, with the ramp on each of the four sides.
      expect(new Set(sides(w, h))).toEqual(new Set(EDGES));
      // A column short, or a row short, every seed is refused.
      expect(new Set(sides(w - 1, h))).toEqual(new Set(["refused"]));
      expect(new Set(sides(w, h - 1))).toEqual(new Set(["refused"]));
    } finally {
      [spec.width, spec.height] = [width, height];
    }
  });
});

describe("generateLanding: refuses what is not an input", () => {
  const ok = { seed: 1, size: "small", biome: "meadow", level: 5 };
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
    ["a list", [1, "small", "meadow", 5]],
    ["a seed with a fraction", { ...ok, seed: 1.5 }],
    ["a seed that is not a number", { ...ok, seed: "1" }],
    ["a seed past 32 bits", { ...ok, seed: 2 ** 31 }],
    ["a seed that is NaN", { ...ok, seed: Number.NaN }],
    ["a seed that is infinite", { ...ok, seed: Number.POSITIVE_INFINITY }],
    ["a missing seed", { size: "small", biome: "meadow", level: 5 }],
    [
      "a seed only on the prototype",
      Object.assign(Object.create({ seed: 1 }), { size: "medium", biome: "fen", level: 5 }),
    ],
    ["a city of 0", { ...ok, city: 0 }],
    ["a city the slice does not build", { ...ok, city: 3 }],
    ["a city as text", { ...ok, city: "1" }],
    ["half a city", { ...ok, city: 1.5 }],
    ["the second city's large landing, which waits for #418", { ...ok, city: 2, size: "large" }],
    ["an unknown size", { ...ok, size: "mountain" }],
    ["a size in capitals", { ...ok, size: "MEDIUM" }],
    ["a size named after the prototype", { ...ok, size: "__proto__" }],
    ["a size named after a method", { ...ok, size: "toString" }],
    ["a size that is not text", { ...ok, size: { toString: () => "medium" } }],
    ["a missing biome", { seed: 1, size: "small", level: 5 }],
    ["an unknown biome", { ...ok, biome: "tundra" }],
    ["a biome named after the prototype", { ...ok, biome: "constructor" }],
    ["a biome that is not text", { ...ok, biome: 2 }],
    ["a level of 0", { ...ok, level: 0 }],
    ["a level past the highest", { ...ok, level: MAX_LEVEL + 1 }],
    ["a level with a fraction", { ...ok, level: 0.5 }],
    ["a level as text", { ...ok, level: "5" }],
    ["a missing level", { seed: 1, size: "small", biome: "meadow" }],
    ["a far level under the level", { ...ok, far: 4 }],
    ["a far level past the highest", { ...ok, far: MAX_LEVEL + 1 }],
    ["a far level with a fraction", { ...ok, far: 20.5 }],
    ["a far level as text", { ...ok, far: "20" }],
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
    for (const key of KEYS) {
      for (const seed of [0, -1, 2 ** 31 - 1, -(2 ** 31)]) {
        for (const [level, far] of [
          [1, 1],
          [1, MAX_LEVEL],
          [MAX_LEVEL, MAX_LEVEL],
        ] as const) {
          const landing = generateLanding({ seed, ...OF[key], biome: "crags", level, far });
          expect(Math.max(...landing.districts.map((d) => d.level))).toBe(far);
          expect(walks(landing).size).toBe(walkableCount(landing));
        }
      }
    }
  });
});

describe("landingText", () => {
  it("prints the header and one line a row, with the gates and the gaps marked", () => {
    for (const key of KEYS) {
      const landing = landings[key][0] as Landing;
      for (const view of ["terrain", "districts", "rings"] as const) {
        const lines = landingText(landing, view).split("\n");
        const grid = lines.slice(5);
        expect(grid).toHaveLength(landing.height);
        for (const row of grid) expect(row).toHaveLength(landing.width);
        expect(lines[0]).toContain(
          `city ${landing.citySize} ${landing.size} ${landing.width}x${landing.height}, ${landing.biome}`,
        );
        expect(lines[1]).toContain(`ramp on the ${landing.rampSide}`);
        const drawn = grid.join("");
        expect(drawn).toContain("R");
        expect(drawn.split("H")).toHaveLength(5);
        for (const e of landing.entries) expect(grid[e.y]?.[e.x]).toBe("H");
        expect(drawn).toMatch(/[+=%]/);
        if (view !== "districts") {
          expect(drawn.split("D")).toHaveLength(landing.dens.length + 1);
          expect(drawn.split("C")).toHaveLength(landing.caches.length + 1);
        }
      }
    }
  });

  it("prints the graph, a line a district, passage and entry", () => {
    const landing = landings["2m"][0] as Landing;
    const lines = landingGraphText(landing).split("\n");
    expect(lines).toHaveLength(
      landing.districts.length + landing.passages.length + landing.entries.length,
    );
    expect(lines[0]).toMatch(/^district 0: ring 0 level \d+ city at/);
  });
});
