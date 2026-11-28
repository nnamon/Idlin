// Laying a landing's monsters at legs-plant (docs/slice.md, section 1, "Packs,
// shares and dens"): the posts, each citizen's share of packs in the order of
// ten, the two rounds of laying onto posts and into dens, a den's first two
// packs, the guards and the dens' elites, and the map's own packs up to the
// room. A pure function of the landing and the citizens awake, in integers,
// with its one stream drawn from the landing's seed. It is the rules
// packages/sim/scripts/plate.ts lays with `--generator`, so the script's
// estimates are what the simulation measures; packs.ts puts the result on
// the ground.

import { RANKS, type Rank } from "./hit.ts";
import type { Landing } from "./landing.ts";
import { isWalkable, NEIGHBOURS, TERRAINS } from "./map.ts";
import { createRng, nextInt, type Rng } from "./rng.ts";

/**
 * What a laid pack is: a swarm (10 fodder led by a pack monster), a pack (3
 * pack monsters led by a brute), a brute pack (3 brutes, one leading), a
 * guard (3 pack monsters and a brute leader, beside a chest, shrine or
 * wreck), or a den's elite alone. Append only: a snapshot stores the index.
 */
export const PACK_KINDS = ["swarm", "pack", "brutes", "guard", "elite"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/** Each kind's monsters by rank, the leader first. */
export const MEMBERS: Readonly<Record<PackKind, readonly Rank[]>> = Object.freeze({
  swarm: ["pack", ...new Array<Rank>(10).fill("fodder")],
  pack: ["brute", "pack", "pack", "pack"],
  brutes: ["brute", "brute", "brute"],
  guard: ["brute", "pack", "pack", "pack"],
  elite: ["elite"],
});

/** A kind's weight: its monsters' rank weights (plan.md, section 2.3), 13, 21, 36, 21 and 40. */
export const weightOf = (kind: PackKind): number =>
  MEMBERS[kind].reduce((sum, rank) => sum + RANKS[rank].weight, 0);
export const monstersOf = (kind: PackKind): number => MEMBERS[kind].length;

/** The order of ten packs a share is laid in: the kind, and how many levels over the share. */
export const ORDER: readonly (readonly [PackKind, number])[] = [
  ["swarm", 0],
  ["pack", 0],
  ["swarm", 0],
  ["swarm", 0],
  ["brutes", 0],
  ["swarm", 5],
  ["pack", 0],
  ["swarm", 0],
  ["pack", 5],
  ["swarm", 10],
];

/** A share in hundredths of a pack: a third of Arms, counted as 20 at least, to the nearest hundredth. */
export const shareOf = (arms: number): number => Math.floor((200 * Math.max(arms, 20) + 3) / 6);

/** Levels a pack may be off its post's ground, or off its den's level. */
export const NEAR = 5;
/** No post has another post of its pocket within this many tiles, a diagonal counting one. */
export const POST_GAP = 3;
/** The most packs a den holds. */
export const DEN_PACKS = 60;
/** The most a share's laid monsters pay, as a multiple. */
export const PAY_CAP = 5;
/** The highest level the yard has. */
const YARD_LEVEL = 5;

/** What stands at legs-plant: 30 monsters for each 180 tiles, rounded down. */
export const roomOf = (landing: Pick<Landing, "width" | "height">): number =>
  Math.floor((landing.width * landing.height * 30) / 180);
/** Dens let nothing out while the plate holds this many over its room. */
export const DEN_GATE = 50;
/** The plate holds this many over its room at most. */
export const CAP = 100;

/** A citizen awake, as laying takes it: its Arms, and where its share stands from its last landing. */
export interface Sharer {
  readonly arms: number;
  /** Hundredths of a pack carried from its last landing, 0 to 99. */
  readonly carry: number;
  /** Its place in the order of ten, 0 to 9. */
  readonly place: number;
}

/** A pack as laying leaves it. Tiles are the landing's, row by row. */
export interface LaidPack {
  readonly kind: PackKind;
  /** Its level: its post's ground for a pack on a post, its own in a den. */
  readonly level: number;
  /** The level its share gave it, before a post's ground changed it; its own level for nobody's. */
  readonly due: number;
  /** Its post, the thing a guard stands beside, or a den's mouth for its elite; -1 inside a den. */
  readonly tile: number;
  /** The citizen whose share it is, as an index into the sharers; -1 for nobody's. */
  readonly owner: number;
  /** The den it was laid into, or -1. */
  readonly den: number;
  /** What it pays, as `pay / per` times what is written (1 / 1 for nobody's). */
  readonly pay: number;
  readonly per: number;
}

/** What one citizen's share came to. */
export interface ShareResult {
  /** Whole packs in it, and the carry and place for its next landing. */
  readonly packs: number;
  readonly carry: number;
  readonly place: number;
  /** Weight of the whole share, and of what of it was laid on a post or in a den. */
  readonly whole: number;
  readonly laid: number;
  /** Its pay, as `pay / per`: whole over laid, held at PAY_CAP; 1 / 1 with nothing laid. */
  readonly pay: number;
  readonly per: number;
}

export interface Layout {
  /** Every post, in tile order. */
  readonly posts: readonly number[];
  /** What stands at legs-plant: elites, guards, packs on posts (dens' first two among them) and the map's own. */
  readonly standing: readonly LaidPack[];
  /** For each of the landing's dens, the packs still inside, in the order they were laid into it. */
  readonly inside: readonly (readonly LaidPack[])[];
  /** For each den, how many packs were laid into it, the first two out among them. */
  readonly denPacks: readonly number[];
  readonly shares: readonly ShareResult[];
  /** The room, and what of it is left after laying. */
  readonly room: number;
  readonly left: number;
}

/** The eight tiles round a tile, clockwise from the north. */
export const AROUND: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** The ground laying works over, worked out once per landing. */
export interface PlateGround {
  readonly width: number;
  readonly height: number;
  /** Walkable, with camp ground closed: the hull's footprint and the ramp's base. */
  readonly open: readonly boolean[];
  /** Steps from the ramp's foot over open ground, 4-connected; -1 where it cannot be walked to. */
  readonly walk: readonly number[];
  /** Each tile's ground level as laying reads it: the yard's, a pocket's, or -1. */
  readonly level: readonly number[];
  /** The tiles the dens, chests, piles, seams, shrines and wrecks stand on. */
  readonly things: readonly number[];
  readonly posts: readonly number[];
}

const grounds = new WeakMap<Landing, PlateGround>();

/** The open ground, the walk from the ramp, the levels, the things and the posts of a landing. */
export function plateGround(landing: Landing): PlateGround {
  const known = grounds.get(landing);
  if (known) return known;
  const W = landing.width;
  const H = landing.height;
  const N = W * H;
  // The hull's footprint and the ramp's base are camp ground, which the
  // generator's walks go round as these do.
  const camp = TERRAINS.indexOf("camp");
  const open = Array.from(
    { length: N },
    (_, i) => landing.tiles[i] !== camp && isWalkable(landing, i % W, (i - (i % W)) / W),
  );
  const walk = walkFrom(W, H, open, [landing.ramp.y * W + landing.ramp.x]);
  const nearLevel = Math.max(1, Math.floor(landing.level / 3));
  const { districtAt, districts } = landing;
  const level = Array.from({ length: N }, (_, i) => {
    const d = districtAt[i] as number;
    if (d === 0) return Math.min(YARD_LEVEL, nearLevel);
    return d >= 1 ? (districts[d] as { level: number }).level : -1;
  });
  const at = (p: { x: number; y: number }): number => p.y * W + p.x;
  const things = [
    ...landing.dens,
    ...landing.caches,
    ...landing.piles,
    ...landing.shrines,
    ...landing.wrecks,
    ...landing.seams,
  ].map(at);
  const thing = new Uint8Array(N);
  for (const t of things) {
    const tx = t % W;
    const ty = (t - tx) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (x >= 0 && y >= 0 && x < W && y < H) thing[y * W + x] = 1;
      }
  }
  const onGround = (i: number): boolean => open[i] === true && (walk[i] as number) >= 0;
  /** A tile whose eight neighbours are open tiles of its own pocket. */
  const inner = (i: number): boolean => {
    const d = districtAt[i] as number;
    if (d < 1 || !onGround(i)) return false;
    const x = i % W;
    const y = (i - x) / W;
    return AROUND.every(([dx, dy]) => {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
      const j = ny * W + nx;
      return open[j] === true && districtAt[j] === d;
    });
  };
  const posts: number[] = [];
  const byPocket = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    if (!inner(i) || thing[i] === 1) continue;
    const d = districtAt[i] as number;
    const mine = byPocket.get(d) ?? [];
    if (mine.some((p) => chebyshev(W, p, i) <= POST_GAP)) continue;
    mine.push(i);
    byPocket.set(d, mine);
    posts.push(i);
  }
  const ground: PlateGround = { width: W, height: H, open, walk, level, things, posts };
  grounds.set(landing, ground);
  return ground;
}

/** Steps from some tiles over open tiles, 4-connected; -1 where none reach. */
export function walkFrom(
  width: number,
  height: number,
  open: readonly boolean[],
  starts: readonly number[],
): number[] {
  const dist: number[] = new Array(width * height).fill(-1);
  const queue = [...starts];
  for (const s of starts) dist[s] = 0;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const x = i % width;
    const y = (i - x) / width;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!open[j] || dist[j] !== -1) continue;
      dist[j] = (dist[i] as number) + 1;
      queue.push(j);
    }
  }
  return dist;
}

export const chebyshev = (width: number, a: number, b: number): number => {
  const ax = a % width;
  const bx = b % width;
  return Math.max(Math.abs(ax - bx), Math.abs((a - ax) / width - (b - bx) / width));
};

function shuffle<V>(rng: Rng, list: V[]): V[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [list[i], list[j]] = [list[j] as V, list[i] as V];
  }
  return list;
}

/** The order of ten's packs from `place`, `count` of them. */
export const packsFrom = (place: number, count: number): (readonly [PackKind, number])[] =>
  Array.from({ length: count }, (_, k) => ORDER[(place + k) % ORDER.length] as [PackKind, number]);

/** A share's pay: whole weight over laid weight, held at PAY_CAP, as a fraction; 1 / 1 with nothing laid. */
export function payOf(whole: number, laid: number): { pay: number; per: number } {
  if (laid === 0) return { pay: 1, per: 1 };
  return { pay: Math.min(whole, PAY_CAP * laid), per: laid };
}

/** The stream laying draws from: the landing's seed, kept apart from the generator's own. */
const layingRng = (landing: Landing): Rng => createRng((landing.seed ^ 0x6c617921) | 0);

/**
 * Lays the monsters of `landing` for the citizens awake, in the world's
 * order. Section 1's rules, step by step as plate.ts has them; see the file's
 * head. One thing is the simulation's own: when the map's own packs come to
 * one that does not fit what is left of the room, the next kinds of the order
 * are tried, so the plate stops short of its room only by less than the
 * smallest pack, or where no post is free.
 */
export function layPlate(landing: Landing, sharers: readonly Sharer[]): Layout {
  const ground = plateGround(landing);
  const { width: W, walk, level: levelAt, posts } = ground;
  const { districtAt, dens, far } = landing;
  const rng = layingRng(landing);
  const nearLevel = Math.max(1, Math.floor(landing.level / 3));

  // Shares, in packs, each from its citizen's place in the order and the
  // hundredths carried from its last landing.
  interface Pack {
    kind: PackKind;
    level: number;
    readonly due: number;
    owner: number;
    where: "post" | "den" | "none";
    tile: number;
    den: number;
  }
  const shareResults: { packs: number; carry: number; place: number }[] = [];
  const shares: Pack[][] = sharers.map((s, owner) => {
    const total = s.carry + shareOf(s.arms);
    const n = Math.floor(total / 100);
    shareResults.push({ packs: n, carry: total % 100, place: (s.place + n) % ORDER.length });
    const base = Math.min(far, Math.max(s.arms, nearLevel));
    return packsFrom(s.place, n).map(([kind, plus]) => ({
      kind,
      level: Math.min(far, base + plus),
      due: Math.min(far, base + plus),
      owner,
      where: "none",
      tile: -1,
      den: -1,
    }));
  });

  const denLevel = dens.map((d) => levelAt[d.y * W + d.x] as number);
  const denPocket = dens.map((d) => districtAt[d.y * W + d.x] as number);
  const used = new Set<number>();
  const denPosts = denPocket.map((d) => posts.filter((p) => districtAt[p] === d));

  const guarded = [...landing.caches, ...landing.shrines, ...landing.wrecks];
  const room = roomOf(landing);
  let left = room - dens.length - monstersOf("guard") * guarded.length;
  const denHolds = dens.map(() => 0);
  const denCount = dens.map(() => 0);
  // Whether a den could take the pack, by the level its share gave it: a pack
  // laid on a post in the first round takes the post's level, and must not be
  // taken for the second round by it.
  const denNear = (p: Pack): boolean => denLevel.some((v) => Math.abs(v - p.due) <= NEAR);

  const place1 = (p: Pack): void => {
    const m = monstersOf(p.kind);
    let best = -1;
    let bestKey = 0;
    if (left >= m) {
      for (const t of posts) {
        if (used.has(t)) continue;
        const off = Math.abs((levelAt[t] as number) - p.level);
        if (off > NEAR) continue;
        const key = off * 1_000_000 + (walk[t] as number) * 10_000 + t;
        if (best === -1 || key < bestKey) [best, bestKey] = [t, key];
      }
    }
    if (best !== -1) {
      used.add(best);
      left -= m;
      p.where = "post";
      p.tile = best;
      p.level = levelAt[best] as number;
      return;
    }
    let den = -1;
    denLevel.forEach((v, n) => {
      if (Math.abs(v - p.level) > NEAR || (denCount[n] as number) >= DEN_PACKS) return;
      // A den whose pocket has no post could never let a pack out, so it takes none.
      if ((denPosts[n] as number[]).length === 0) return;
      if (den === -1 || (denHolds[n] as number) < (denHolds[den] as number)) den = n;
    });
    if (den === -1) return;
    // A pack in a den keeps its own level, which is within 5 of the den's.
    p.where = "den";
    p.den = den;
    // A den's first two packs come out at legs-plant, if the room has them,
    // onto the free posts of its pocket farthest from the ramp.
    if ((denCount[den] as number) < 2 && left >= m) {
      let far1 = -1;
      for (const t of denPosts[den] as number[]) {
        if (used.has(t)) continue;
        if (far1 === -1 || (walk[t] as number) > (walk[far1] as number)) far1 = t;
      }
      if (far1 !== -1) {
        used.add(far1);
        left -= m;
        p.tile = far1;
      }
    }
    denCount[den] = (denCount[den] as number) + 1;
    denHolds[den] = (denHolds[den] as number) + m;
  };

  const turns = shuffle(
    rng,
    sharers.map((_, c) => c),
  );
  for (const firstRound of [true, false]) {
    const queues = shares.map((list) =>
      list.filter((p) => p.where === "none" && !denNear(p) === firstRound),
    );
    for (let more = true; more; ) {
      more = false;
      for (const c of turns) {
        const p = (queues[c] as Pack[]).shift();
        if (!p) continue;
        more = true;
        place1(p);
      }
    }
  }

  // The map's own packs, on the free posts while the room has them: the
  // order of ten from a place the seed draws, each at its post's ground
  // level, on the post in the pocket with the smallest part of its posts
  // taken, then the one farthest from the ramp, then the lower tile number.
  const postsIn = new Map<number, number>();
  const usedIn = new Map<number, number>();
  for (const t of posts)
    postsIn.set(districtAt[t] as number, (postsIn.get(districtAt[t] as number) ?? 0) + 1);
  for (const t of used)
    usedIn.set(districtAt[t] as number, (usedIn.get(districtAt[t] as number) ?? 0) + 1);
  const own: LaidPack[] = [];
  const smallest = Math.min(...ORDER.map(([kind]) => monstersOf(kind)));
  for (let k = nextInt(rng, ORDER.length); left >= smallest; k++) {
    // The next of the order that fits what is left of the room.
    let kind: PackKind | undefined;
    for (let j = 0; j < ORDER.length && !kind; j++) {
      const next = (ORDER[(k + j) % ORDER.length] as [PackKind, number])[0];
      if (monstersOf(next) <= left) {
        kind = next;
        k += j;
      }
    }
    if (!kind) break;
    let best = -1;
    let bestKey = 0;
    for (const t of posts) {
      if (used.has(t)) continue;
      const d = districtAt[t] as number;
      const key =
        Math.floor(((usedIn.get(d) ?? 0) * 1_000) / (postsIn.get(d) as number)) * 100_000_000 -
        (walk[t] as number) * 100_000 +
        t;
      if (best === -1 || key < bestKey) [best, bestKey] = [t, key];
    }
    if (best === -1) break;
    used.add(best);
    usedIn.set(districtAt[best] as number, (usedIn.get(districtAt[best] as number) ?? 0) + 1);
    left -= monstersOf(kind);
    own.push({
      kind,
      level: levelAt[best] as number,
      due: levelAt[best] as number,
      tile: best,
      owner: -1,
      den: -1,
      pay: 1,
      per: 1,
    });
  }

  // Pay, share by share.
  const results: ShareResult[] = shares.map((list, c) => {
    const whole = list.reduce((s, p) => s + weightOf(p.kind), 0);
    const laid = list.filter((p) => p.where !== "none").reduce((s, p) => s + weightOf(p.kind), 0);
    return {
      ...(shareResults[c] as (typeof shareResults)[number]),
      whole,
      laid,
      ...payOf(whole, laid),
    };
  });
  const laidOf = (p: Pack): LaidPack => {
    const { pay, per } = results[p.owner] as ShareResult;
    const { kind, level, due, tile, owner, den } = p;
    return { kind, level, due, tile, owner, den, pay, per };
  };

  const at = (p: { x: number; y: number }): number => p.y * W + p.x;
  const standing: LaidPack[] = [
    ...dens.map((d, n) => ({
      kind: "elite" as const,
      level: d.elite,
      due: d.elite,
      tile: at(d),
      owner: -1,
      den: n,
      pay: 1,
      per: 1,
    })),
    ...guarded.map((g) => ({
      kind: "guard" as const,
      level: levelAt[at(g)] as number,
      due: levelAt[at(g)] as number,
      tile: at(g),
      owner: -1,
      den: -1,
      pay: 1,
      per: 1,
    })),
  ];
  const inside: LaidPack[][] = dens.map(() => []);
  for (const list of shares)
    for (const p of list) {
      if (p.where === "none") continue;
      if (p.tile !== -1) standing.push(laidOf(p));
      else (inside[p.den] as LaidPack[]).push(laidOf(p));
    }
  standing.push(...own);
  return { posts, standing, inside, denPacks: denCount, shares: results, room, left };
}

/** Whether a laid pack holds one of the posts: a guard stands by its thing, an elite at its den's mouth. */
export const onPost = (p: Pick<LaidPack, "kind">): boolean =>
  p.kind !== "guard" && p.kind !== "elite";

/**
 * Hundredths of a percent a kill drops at, by rank (docs/slice.md, section
 * 3.2): 4% for fodder, 15% for pack and 40% for a brute. Elites give rolls,
 * not drops.
 */
export const DROP_CHANCE: Readonly<Record<Exclude<Rank, "elite">, number>> = Object.freeze({
  fodder: 400,
  pack: 1_500,
  brute: 4_000,
});
/** A high-risk landing's 20% more, in hundredths. */
export const HIGH_RISK = 120;

/**
 * A kill's drop chance in hundredths of a percent: the rank's chance times
 * the monster's pay, rounded down, then 20% more on a high-risk landing,
 * rounded down.
 */
export function dropChance(
  rank: Exclude<Rank, "elite">,
  pay: number,
  per: number,
  highRisk = false,
): number {
  const paid = Math.floor((DROP_CHANCE[rank] * pay) / per);
  return highRisk ? Math.floor((paid * HIGH_RISK) / 100) : paid;
}

/**
 * How many drops a kill at `chance` gives for a `roll` drawn below 10,000:
 * one for each whole 100%, and one more if the roll falls under what is left.
 */
export const dropsFor = (chance: number, roll: number): number =>
  Math.floor(chance / 10_000) + (roll < chance % 10_000 ? 1 : 0);
