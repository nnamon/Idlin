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
  RIM,
  SIZE_CLASSES,
  SIZES,
  type SizeClass,
} from "./landing.ts";
import { isWalkable, NEIGHBOURS, type Point, TERRAINS, terrainAt } from "./map.ts";

// The gate checks a sample of seeds per size class; the capture workflow
// checks many more (IDLIN_LONG=1).
const LONG = process.env.IDLIN_LONG === "1";
const SEEDS = LONG ? 1000 : 100;
// The tests over every landing of a size take about 10 s each for the large
// size under IDLIN_LONG=1 on CI.
const SWEEP_TIMEOUT = LONG ? 120_000 : 30_000;

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
  small: sweep("small"),
  medium: sweep("medium"),
  large: sweep("large"),
};

/**
 * Districts besides the city's, which the blocks and SIZES' `cell` fix for
 * each size: with the ramp to the north or south, and to the east or west.
 */
const POCKETS: Record<SizeClass, readonly [number, number]> = {
  small: [8, 8],
  medium: [12, 15],
  large: [17, 18],
};
const across = (landing: Landing): 0 | 1 =>
  landing.rampSide === "north" || landing.rampSide === "south" ? 0 : 1;

const index = (landing: Landing, p: Point): number => p.y * landing.width + p.x;
const pointAt = (landing: Landing, i: number): Point => ({
  x: i % landing.width,
  y: Math.floor(i / landing.width),
});

/**
 * Steps of the shortest walk from the ramp to each tile it can reach, by the
 * map's own rules. Without camp ground, the walk steps off the ramp and never
 * onto camp again, as a monster's must.
 */
function walks(landing: Landing, camp = true): Map<number, number> {
  const steps = new Map([[index(landing, landing.ramp), 0]]);
  const queue = [landing.ramp];
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

describe("generateLanding: the layout graph", { timeout: SWEEP_TIMEOUT }, () => {
  for (const size of SIZE_CLASSES) {
    const spec = SIZES[size];

    it(`${size}: the ramp's district is the root, and each other one has a ring by its walk from the ramp`, () => {
      for (const landing of landings[size]) {
        const { districts } = landing;
        // The pockets besides the city's district, near the counts the spec for packs (#396) works from.
        expect(districts.length - 1).toBe(POCKETS[size][across(landing)]);
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

    it(`${size}: the rim is two tiles of barrier, broken by one gap on each side`, () => {
      for (const landing of landings[size]) {
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

    it(`${size}: the horde's front comes in at each gap and has a known way to the hull`, () => {
      for (const landing of landings[size]) {
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
  it("has the sizes and counts of the slice's spec, the small one made room in", () => {
    // docs/slice.md has small at 40 by 22; 46 by 26 fits a row of blocks north
    // and south of the city's ground (SIZES says how).
    expect([SIZES.small.width, SIZES.small.height]).toEqual([46, 26]);
    expect([SIZES.medium.width, SIZES.medium.height]).toEqual([60, 33]);
    expect([SIZES.large.width, SIZES.large.height]).toEqual([80, 45]);
    expect([CITY_WIDTH, CITY_HEIGHT, RIM]).toEqual([10, 6, 2]);
    expect(SIZE_CLASSES.map((s) => SIZES[s].apron)).toEqual([3, 4, 4]);
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
        expect(landing.tiles.findIndex((t) => TERRAINS[t] === undefined)).toBe(-1);
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

    it(`${size}: a monster, which may not stand on camp ground, can reach every other walkable tile from the ramp`, () => {
      for (const landing of landings[size]) {
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

    it(`${size}: the city's ground is in the middle, the city on camp ground in it, its ramp three wide`, () => {
      for (const landing of landings[size]) {
        const { city, ramp, width, height } = landing;
        expect([city.width, city.height]).toEqual([CITY_WIDTH, CITY_HEIGHT]);
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
        // The city's district is the apron round the footprint, two deeper on the ramp's side.
        const pad = EDGES.map((_, s) => spec.apron + (s === side ? 2 : 0));
        const [padN, padE, padS, padW] = pad as [number, number, number, number];
        const home = (landing.districts[0] as Landing["districts"][0]).bounds;
        expect(home).toEqual({
          x: city.x - padW,
          y: city.y - padN,
          width: padW + CITY_WIDTH + padE,
          height: padN + CITY_HEIGHT + padS,
        });
        // It is centred on the map, and so are the footprint and the ramp
        // together; to half a tile where the map's length is odd.
        const centred = (x: number, y: number, w: number, h: number): void => {
          expect(Math.abs(2 * x + w - width), landing.name).toBeLessThanOrEqual(width % 2);
          expect(Math.abs(2 * y + h - height), landing.name).toBeLessThanOrEqual(height % 2);
        };
        centred(home.x, home.y, home.width, home.height);
        centred(
          city.x - (toX < 0 ? 2 : 0),
          city.y - (toY < 0 ? 2 : 0),
          city.width + 2 * Math.abs(toX),
          city.height + 2 * Math.abs(toY),
        );
        // All of it but its outermost tiles is the city's own and open.
        for (let y = home.y + 1; y < home.y + home.height - 1; y++) {
          for (let x = home.x + 1; x < home.x + home.width - 1; x++) {
            expect(landing.districtAt[index(landing, { x, y })]).toBe(0);
            expect(isWalkable(landing, x, y)).toBe(true);
          }
        }
        // Two tiles out from the middle of its side of the footprint.
        if (toX !== 0) expect(ramp.y).toBe(city.y + (CITY_HEIGHT >> 1));
        if (toY !== 0) expect(ramp.x).toBe(city.x + (CITY_WIDTH >> 1));
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
        // Open ground of the city's in front of the ramp: two tiles on a small
        // landing, three on the others.
        for (let k = 1; k < spec.apron; k++) {
          const [x, y] = [ramp.x + k * toX, ramp.y + k * toY];
          expect(terrainAt(landing, x, y)).not.toBe("camp");
          expect(isWalkable(landing, x, y)).toBe(true);
          expect(landing.districtAt[index(landing, { x, y })]).toBe(0);
        }
      }
    });

    it(`${size}: has pockets on every side of the city's ground`, () => {
      for (const landing of landings[size]) {
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
    /** Tiles of each terrain over the vales of one biome, out of 1000. */
    const share = (biome: Biome): Record<string, number> => {
      const counts: Record<string, number> = {};
      let total = 0;
      for (const landing of landings.medium.filter((l) => l.biome === biome)) {
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
    const meadow = generateLanding({ seed: 11, size: "medium", biome: "meadow", level: 9 });
    const crags = generateLanding({ seed: 11, size: "medium", biome: "crags", level: 9 });
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
    const plain = { seed: 99, size: "medium", biome: "pinewood", level: 20 } as const;
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
        size: "small",
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
      hashLanding(generateLanding({ seed: 1, size: "small", biome: "meadow", level: 5 })),
    ).toBe("ad2347d6ea09af7f");
    expect(hashLanding(generateLanding({ seed: 2, size: "medium", biome: "fen", level: 12 }))).toBe(
      "35f8a33629e084b3",
    );
    expect(
      hashLanding(
        generateLanding({ seed: 3, size: "large", biome: "ash_waste", level: 30, extraDens: 2 }),
      ),
    ).toBe("838d9d20dbc9ef1d");
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

  it("puts the ramp on every side of the footprint across seeds", () => {
    for (const size of SIZE_CLASSES) {
      const sides = landings[size].map((l) => l.rampSide);
      // Each side about a quarter of the time: 100 seeds give 15 or more of each.
      for (const side of EDGES) {
        expect(sides.filter((s) => s === side).length).toBeGreaterThan(SEEDS * 0.15);
      }
    }
  });
});

describe("generateLanding: cost", () => {
  it("takes a bounded time whatever the seed", () => {
    // Over 2,000 seeds in the dev container the mean is 2.5, 3.0 and 6.9 ms and
    // the median 2.4, 2.9 and 6.7 ms; the slowest, at 8 to 49 ms, were pauses
    // with other work running beside them. CI runs the gate about three times slower.
    const budget: Record<SizeClass, number> = { small: 25, medium: 40, large: 75 };
    const count = LONG ? 200 : 40;
    for (const size of SIZE_CLASSES) {
      for (let n = 0; n < 5; n++) generateLanding(input(size, n));
      const times: number[] = [];
      for (let n = 0; n < count; n++) {
        const before = performance.now();
        generateLanding(input(size, 1000 + n));
        times.push(performance.now() - before);
      }
      const mean = times.reduce((a, b) => a + b) / count;
      const median = [...times].sort((a, b) => a - b)[count >> 1] as number;
      const worst = Math.max(...times);
      console.log(
        `landing ${size}: mean ${mean.toFixed(1)} ms, median ${median.toFixed(1)} ms, worst ${worst.toFixed(1)} ms`,
      );
      // Wall time depends on what else the machine is doing (the gate runs the
      // other test files beside this one), so the gate only prints it and the
      // long run checks it, as scale.test.ts does.
      if (!LONG) continue;
      expect(mean, `${size} mean ms`).toBeLessThan(budget[size]);
      // No seed is far slower than the rest. The bound follows the runner's own
      // speed; the 30 ms covers a pause for garbage collection.
      expect(worst, `${size} worst ms, median ${median.toFixed(1)}`).toBeLessThan(median * 5 + 30);
    }
  });

  it("refuses a map of more tiles than the growth's heap keys can hold", () => {
    // The growth packs a tile index into 12 bits, so 4,096 tiles at most. The
    // sizes are fixed, so the test widens the large one for a moment.
    const spec = SIZES.large as { width: number };
    const width = spec.width;
    try {
      spec.width = 91; // 4,095 tiles
      expect(generateLanding({ seed: 1, size: "large", biome: "meadow", level: 5 }).width).toBe(91);
      spec.width = 92; // 4,140 tiles
      expect(() => generateLanding({ seed: 1, size: "large", biome: "meadow", level: 5 })).toThrow(
        "more tiles than its growth can order",
      );
    } finally {
      spec.width = width;
    }
  });

  it("refuses a size with no room for a strip of blocks on every side of the city", () => {
    // 40 by 22 leaves the strips north and south of the city's ground two or
    // three tiles deep, whichever side the ramp is on.
    const spec = SIZES.small as { width: number; height: number };
    const [width, height] = [spec.width, spec.height];
    try {
      [spec.width, spec.height] = [40, 22];
      for (let seed = 0; seed < 8; seed++) {
        expect(() => generateLanding({ seed, size: "small", biome: "meadow", level: 5 })).toThrow(
          "no room for blocks on every side of the city",
        );
      }
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
  it("prints the header and one line a row, with the gates and the gaps marked", () => {
    for (const size of SIZE_CLASSES) {
      const landing = landings[size][0] as Landing;
      for (const view of ["terrain", "districts", "rings"] as const) {
        const lines = landingText(landing, view).split("\n");
        const grid = lines.slice(5);
        expect(grid).toHaveLength(landing.height);
        for (const row of grid) expect(row).toHaveLength(landing.width);
        expect(lines[0]).toContain(`${size} ${landing.width}x${landing.height}, ${landing.biome}`);
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
    const landing = landings.medium[0] as Landing;
    const lines = landingGraphText(landing).split("\n");
    expect(lines).toHaveLength(
      landing.districts.length + landing.passages.length + landing.entries.length,
    );
    expect(lines[0]).toMatch(/^district 0: ring 0 city at/);
  });
});
