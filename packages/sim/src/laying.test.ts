// Laying a landing's monsters at legs-plant (docs/slice.md, section 1; piece 5
// of section 11): shares and the order, posts, the two rounds, dens, the room
// and the map's own packs, and pay; and the drop chance a pay makes.
import { describe, expect, it } from "vitest";
import { RANKS, type Rank } from "./hit.ts";
import {
  BIOMES,
  type CitySize,
  FAR_STEP,
  generateLanding,
  type Landing,
  type SizeClass,
} from "./landing.ts";
import {
  AROUND,
  chebyshev,
  DEN_PACKS,
  DROP_CHANCE,
  dropChance,
  dropsFor,
  type LaidPack,
  layPlate,
  MEMBERS,
  monstersOf,
  NEAR,
  ORDER,
  onPost,
  PAY_CAP,
  POST_GAP,
  packsFrom,
  plateGround,
  roomOf,
  type Sharer,
  shareOf,
  weightOf,
} from "./laying.ts";
import { createRng, nextInt } from "./rng.ts";
import { CROWDS, type Tier } from "./testing.ts";

const SIZES: readonly (readonly [CitySize, SizeClass])[] = [
  [1, "small"],
  [1, "medium"],
  [1, "large"],
  [2, "small"],
  [2, "medium"],
];
const SEEDS = 20;
const smallest = Math.min(...ORDER.map(([kind]) => monstersOf(kind)));

/** The crowds of the piece's test: two awake at the median's Arms, and the 15 and 150 plate.ts lays. */
const crowdsOf = (city: CitySize): Record<string, Tier[]> => ({
  2: [[(CROWDS[city][15][1] as Tier)[0], 2]],
  15: CROWDS[city][15],
  150: CROWDS[city][150],
});

/** The landing laid for a crowd, made for it as the world makes it at legs-plant. */
function landingFor(
  city: CitySize,
  size: SizeClass,
  seed: number,
  tiers: readonly Tier[],
): Landing {
  const level = CROWDS[city].level;
  const awake = tiers.reduce((n, [, c]) => n + c, 0);
  const strongest = Math.max(level, ...tiers.map(([arms]) => arms));
  const extra = Math.ceil(awake / 15);
  return generateLanding({
    seed,
    city,
    size,
    biome: BIOMES[seed % BIOMES.length],
    level,
    far: Math.min(99, strongest + FAR_STEP[size]),
    extraDens: extra,
    extraCaches: extra,
  });
}

/** The crowd's citizens, each with a carry and a place drawn from `seed`. */
function sharersOf(tiers: readonly Tier[], seed: number): Sharer[] {
  const rng = createRng(seed);
  return tiers.flatMap(([arms, n]) =>
    Array.from({ length: n }, () => ({ arms, carry: nextInt(rng, 100), place: nextInt(rng, 10) })),
  );
}

const standingOf = (packs: readonly LaidPack[]): number =>
  packs.reduce((n, p) => n + monstersOf(p.kind), 0);

describe("shares", () => {
  it("a level-23 citizen's share is 7.67 packs, and its remainder carries to its next landing", () => {
    expect(shareOf(23)).toBe(767);
    expect(shareOf(58)).toBe(1_933);
    // Counted as 20 at least.
    expect([1, 6, 20].map(shareOf)).toEqual([667, 667, 667]);
    const landing = landingFor(2, "medium", 1, [[23, 1]]);
    const first = layPlate(landing, [{ arms: 23, carry: 0, place: 0 }]).shares[0];
    expect(first).toMatchObject({ packs: 7, carry: 67, place: 7 });
    const second = layPlate(landing, [{ arms: 23, carry: 67, place: 7 }]).shares[0];
    expect(second).toMatchObject({ packs: 8, carry: 34, place: 5 });
    const third = layPlate(landing, [{ arms: 23, carry: 34, place: 5 }]).shares[0];
    expect(third).toMatchObject({ packs: 8, carry: 1, place: 3 });
  });

  it("any 10 packs in a row of the order are 60 fodder, 15 pack monsters and 6 brutes, three of them 5 or 10 over", () => {
    for (let place = 0; place < ORDER.length; place++) {
      const run = packsFrom(place, 10);
      const ranks: Record<Rank, number> = { fodder: 0, pack: 0, brute: 0, elite: 0 };
      for (const [kind] of run) for (const rank of MEMBERS[kind]) ranks[rank]++;
      expect(ranks).toEqual({ fodder: 60, pack: 15, brute: 6, elite: 0 });
      const over = run.filter(([, plus]) => plus > 0).map(([, plus]) => plus);
      expect(over.sort((a, b) => a - b)).toEqual([5, 5, 10]);
    }
    // A swarm 13, a pack 21, a brute pack 36, by rank weight.
    expect(["swarm", "pack", "brutes"].map((k) => weightOf(k as "swarm"))).toEqual([13, 21, 36]);
    expect(RANKS.brute.weight).toBe(12);
  });
});

describe("laid on 20 landings of each size, for 2, 15 and 150 awake", () => {
  for (const [city, size] of SIZES) {
    it(`city ${city}, ${size}`, () => {
      for (const [name, tiers] of Object.entries(crowdsOf(city))) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const landing = landingFor(city, size, seed, tiers);
          const sharers = sharersOf(tiers, seed);
          const layout = layPlate(landing, sharers);
          const ground = plateGround(landing);
          const W = landing.width;
          const where = `${name} awake, seed ${seed}`;
          const room = roomOf(landing);
          const standing = standingOf(layout.standing);

          // What stands is no more than the room, and short of it only where no post is free.
          expect(standing, where).toBeLessThanOrEqual(room);
          const held = new Set(layout.standing.filter(onPost).map((p) => p.tile));
          const free = layout.posts.filter((t) => !held.has(t));
          if (free.length > 0) expect(room - standing, where).toBeLessThan(smallest);
          // Every post holds one pack at most, and every pack on a post stands on one.
          expect(held.size, where).toBe(layout.standing.filter(onPost).length);
          for (const t of held) expect(layout.posts.includes(t), where).toBe(true);

          // Posts: eight neighbours in the pocket, no other post of the pocket within 3.
          for (const p of layout.posts) {
            const d = landing.districtAt[p] as number;
            expect(d, where).toBeGreaterThan(0);
            for (const [dx, dy] of AROUND) {
              const n = p + dy * W + dx;
              expect(ground.open[n] && landing.districtAt[n] === d, where).toBe(true);
            }
            for (const q of layout.posts)
              if (q !== p && landing.districtAt[q] === d)
                expect(chebyshev(W, p, q), where).toBeGreaterThan(POST_GAP);
          }

          // Every laid pack of a share is within 5 levels of what its share gave it.
          const laid = [...layout.standing, ...layout.inside.flat()];
          for (const p of laid.filter((q) => q.owner >= 0))
            expect(Math.abs(p.level - p.due), where).toBeLessThanOrEqual(NEAR);
          // A pack on a post has its post's ground level; so do the map's own packs.
          for (const p of layout.standing.filter(onPost))
            expect(p.level, where).toBe(ground.level[p.tile]);

          // Dens: 60 packs at most, none where the pocket has no post, one to a pocket.
          const pockets = landing.dens.map((d) => d.district);
          expect(new Set(pockets).size, where).toBe(pockets.length);
          layout.denPacks.forEach((n, i) => {
            expect(n, where).toBeLessThanOrEqual(DEN_PACKS);
            const hasPost = layout.posts.some((t) => landing.districtAt[t] === pockets[i]);
            if (!hasPost) expect(n, where).toBe(0);
            // Laid into it: those still inside and those of its first two out.
            const out = layout.standing.filter((p) => onPost(p) && p.den === i).length;
            expect(out, where).toBeLessThanOrEqual(2);
            expect((layout.inside[i] as LaidPack[]).length + out, where).toBe(n);
          });
          // Lettered A onward by the walk from the ramp, then the lower tile.
          const byWalk = landing.dens
            .map((d) => ({ d, t: d.y * W + d.x }))
            .sort(
              (a, b) => (ground.walk[a.t] as number) - (ground.walk[b.t] as number) || a.t - b.t,
            );
          byWalk.forEach(({ d }, k) => {
            expect(d.letter, where).toBe(String.fromCharCode(65 + k));
          });

          // Pay: the laid weight times the pay is the whole weight, or 5 times the laid weight.
          layout.shares.forEach((share, c) => {
            const sharer = sharers[c] as Sharer;
            const whole = packsFrom(sharer.place, share.packs).reduce(
              (s, [k]) => s + weightOf(k),
              0,
            );
            const laidWeight = laid
              .filter((p) => p.owner === c)
              .reduce((s, p) => s + weightOf(p.kind), 0);
            expect(share.whole, where).toBe(whole);
            expect(share.laid, where).toBe(laidWeight);
            if (laidWeight === 0) return;
            const paid = (laidWeight * share.pay) / share.per;
            expect(paid, where).toBe(Math.min(whole, PAY_CAP * laidWeight));
            for (const p of laid.filter((q) => q.owner === c))
              expect([p.pay, p.per], where).toEqual([share.pay, share.per]);
          });

          // With two awake the map's own packs bring the plate to its room.
          if (name === "2") {
            const own = layout.standing.filter((p) => onPost(p) && p.owner < 0);
            expect(own.length, where).toBeGreaterThan(0);
            for (const p of own) expect([p.pay, p.per], where).toEqual([1, 1]);
          }
        }
      }
    });
  }
});

describe("what a kill drops (docs/slice.md, section 3.2)", () => {
  /** Drops over every value of the roll, below 10,000. */
  const walk = (chance: number): number[] => {
    const counts = [0, 0, 0, 0];
    for (let roll = 0; roll < 10_000; roll++)
      counts[dropsFor(chance, roll)] = (counts[dropsFor(chance, roll)] as number) + 1;
    return counts;
  };

  it("a fodder kill paying 3 drops at 12%", () => {
    expect(DROP_CHANCE.fodder).toBe(400);
    expect(dropChance("fodder", 3, 1)).toBe(1_200);
    expect(walk(1_200)).toEqual([8_800, 1_200, 0, 0]);
  });

  it("a brute kill paying 5 drops exactly two items, and on a high-risk landing two and rolls 40% for a third", () => {
    expect(dropChance("brute", 5, 1)).toBe(20_000);
    expect(walk(20_000)).toEqual([0, 0, 10_000, 0]);
    expect(dropChance("brute", 5, 1, true)).toBe(24_000);
    expect(walk(24_000)).toEqual([0, 0, 6_000, 4_000]);
  });

  it("a pay held as a fraction is rounded down once, in hundredths of a percent", () => {
    // A share of weight 100 laid as 60: pay 100/60, so a pack monster's 15% is 25%.
    expect(dropChance("pack", 100, 60)).toBe(2_500);
    expect(dropChance("fodder", 100, 60)).toBe(666);
  });
});
