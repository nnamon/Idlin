// Runs landings of the slice's five sizes in the simulation, with the scripted
// tiers of plate.ts at 15 and at 150 awake on Deckhand, from 0:00 to lift-off,
// and writes what piece 5 of docs/slice.md, section 11, asks `metrics.json`
// for, tier by tier: what stood at legs-plant, the part of its shares laid on
// posts and in dens and their pay, the part of what was laid that was killed,
// the tick the last laid monster it could fight died, the experience it took
// from the map's own packs; for each landing the dens' turns that passed on
// the cap or for want of a post; and the far-ground rolls the strongest
// citizen got. It is what plate.ts estimates, measured.
//
//   docker compose run --rm dev node packages/sim/scripts/landing-metrics.ts [seeds] [--out <path>]
//
// seeds is how many landings of each size and crowd, 3 by default, and the
// file goes to captures/metrics.json unless --out says otherwise.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LEGS_PLANT, liftAt } from "../src/cycle.ts";
import { landingFor } from "../src/deck.ts";
import type { Rank } from "../src/hit.ts";
import type { CitySize, SizeClass } from "../src/landing.ts";
import {
  dropChance,
  monstersOf,
  ORDER,
  onPost,
  PACK_KINDS,
  type PackKind,
  packsFrom,
  roomOf,
  shareOf,
  weightOf,
} from "../src/laying.ts";
import { CROWDS, crewCity, type Tier } from "../src/testing.ts";
import { ADVENTURER, armsOf, step, type World } from "../src/world.ts";

const args = process.argv.slice(2);
const outArg = args.indexOf("--out");
const out = outArg === -1 ? "captures/metrics.json" : (args[outArg + 1] as string);
const seeds = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== "--out") ?? 3);

const SIZES: readonly (readonly [CitySize, SizeClass])[] = [
  [1, "small"],
  [1, "medium"],
  [1, "large"],
  [2, "small"],
  [2, "medium"],
];
/** Deckhand's `over`: the packs a citizen will fight are from its Arms less 9 to its Arms plus this. */
const OVER = 10;
/** Within this many tiles of an elite when it dies, a citizen gets its roll (docs/slice.md, section 3.2). */
const ROLL_REACH = 6;

interface Laid {
  readonly owner: number;
  readonly level: number;
  readonly rank: Rank;
  readonly kind: PackKind;
  readonly own: boolean;
  readonly pay: number;
  readonly per: number;
}

interface TierResult {
  arms: number;
  citizens: number;
  /** Means for one citizen of the tier, in monsters. */
  standing: number;
  inDens: number;
  /** Over all of the tier's shares, by rank weight. */
  laid: number;
  pay: number;
  paid: number;
  /** Of the monsters laid from the tier's shares: the part killed by anyone, and by the tier's own citizens. */
  killed: number;
  killedByTier: number;
  /** The tick, from the cycle's 0:00, the last laid monster of the tier's range died; and how many stood at lift-off. */
  lastFightable: number;
  fightableLeft: number;
  /** Experience a citizen of the tier took from the map's own packs, on average. */
  xpFromOwn: number;
}

interface RunResult {
  city: CitySize;
  size: SizeClass;
  tiles: string;
  awake: number;
  seed: number;
  room: number;
  far: number;
  stoodAtPlant: number;
  dens: number;
  inDensAtPlant: number;
  denTurns: { out: number; passedCap: number; passedPost: number };
  tiers: TierResult[];
  strongest: { arms: number; eliteRolls: number; farKills: number; farDrops: number };
}

function run(city: CitySize, size: SizeClass, awake: 15 | 150, seed: number): RunResult {
  const crowd = CROWDS[city];
  const tiers: readonly Tier[] = crowd[awake];
  const world = crewCity({ seed, city, size, level: crowd.level, tiers });
  while (world.tick < LEGS_PLANT - 1) step(world);
  const citizens = world.actors.filter((a) => a.kind === ADVENTURER);
  const tierOf = new Map<number, number>(citizens.map((c) => [c.id, armsOf(c)]));
  // Each citizen's share as it goes into the landing.
  const whole = new Map<number, number>();
  for (const c of citizens) {
    const packs = Math.floor((c.carry + shareOf(armsOf(c))) / 100);
    whole.set(
      c.id,
      packsFrom(c.place, packs).reduce((s, [k]) => s + weightOf(k), 0),
    );
  }
  const events = step(world);
  const cycle = world.cycle as NonNullable<World["cycle"]>;
  const plate = world.plate as NonNullable<World["plate"]>;
  const landing = landingFor(city, cycle.landing);
  const far = landing.far;
  const laidEvent = events.find((e) => e.type === "laid");

  // What was laid for each tier, and every laid monster as it appears.
  const known = new Map<number, Laid>();
  const learn = (): void => {
    for (const a of world.actors) {
      if (a.pack === 0 || known.has(a.id)) continue;
      const pack = plate.packs.find((p) => p.id === a.pack);
      if (!pack) continue;
      const kind = PACK_KINDS[pack.kind] as PackKind;
      known.set(a.id, {
        owner: pack.owner,
        level: a.level,
        rank: a.kind as Rank,
        kind,
        own: pack.owner === 0 && onPost({ kind }) && pack.den === -1,
        pay: pack.pay,
        per: pack.per,
      });
    }
  };
  learn();
  const byTier = new Map<
    number,
    {
      standing: number;
      inDens: number;
      laidW: number;
      wholeW: number;
      payN: number;
      payM: number;
      monsters: number;
      killed: number;
      killedByTier: number;
      last: number;
      xpOwn: number;
    }
  >();
  for (const [arms] of tiers)
    byTier.set(arms, {
      standing: 0,
      inDens: 0,
      laidW: 0,
      wholeW: 0,
      payN: 0,
      payM: 0,
      monsters: 0,
      killed: 0,
      killedByTier: 0,
      last: 0,
      xpOwn: 0,
    });
  for (const c of citizens)
    (byTier.get(tierOf.get(c.id) as number) as { wholeW: number }).wholeW += whole.get(c.id) ?? 0;
  // Laid weight by citizen, for what its share pays out.
  const laidOf = new Map<number, number>();
  const count = (
    owner: number,
    kindIndex: number,
    pay: number,
    per: number,
    inDen: boolean,
  ): void => {
    const t = byTier.get(tierOf.get(owner) as number);
    if (!t) return;
    const kind = PACK_KINDS[kindIndex] as PackKind;
    if (inDen) t.inDens += monstersOf(kind);
    else t.standing += monstersOf(kind);
    t.laidW += weightOf(kind);
    t.monsters += monstersOf(kind);
    t.payN += (monstersOf(kind) * pay) / per;
    t.payM += monstersOf(kind);
    laidOf.set(owner, (laidOf.get(owner) ?? 0) + weightOf(kind));
  };
  for (const p of plate.packs) if (p.owner > 0) count(p.owner, p.kind, p.pay, p.per, false);
  let inDensAtPlant = 0;
  for (const d of plate.dens)
    for (const q of d.queue) {
      inDensAtPlant += monstersOf(PACK_KINDS[q.kind] as PackKind);
      count(q.owner, q.kind, q.pay, q.per, true);
    }
  // What a share's laid monsters pay out if all are killed: its whole weight, or 5 times what was laid.
  const paidOf = (arms: number): number =>
    citizens
      .filter((c) => tierOf.get(c.id) === arms)
      .reduce((s, c) => s + Math.min(whole.get(c.id) ?? 0, 5 * (laidOf.get(c.id) ?? 0)), 0);

  const strongestArms = Math.max(...tiers.map(([arms]) => arms));
  const strongest = { arms: strongestArms, eliteRolls: 0, farKills: 0, farDrops: 0 };
  const denTurns = { out: 0, passedCap: 0, passedPost: 0 };
  const lift = liftAt(cycle);
  while (world.tick < lift - 1) {
    for (const e of step(world)) {
      if (e.type === "den") {
        if (e.out) denTurns.out++;
        else if (e.why === "cap") denTurns.passedCap++;
        else denTurns.passedPost++;
      }
      if (e.type === "hit") {
        const laid = known.get(e.target);
        const arms = tierOf.get(e.actor);
        if (laid?.own && arms !== undefined) (byTier.get(arms) as { xpOwn: number }).xpOwn += e.xp;
      }
      if (e.type === "down" && e.pack > 0) {
        const laid = known.get(e.actor);
        if (!laid) continue;
        const killer = tierOf.get(e.by);
        if (laid.owner > 0) {
          const t = byTier.get(tierOf.get(laid.owner) as number);
          if (t) {
            t.killed++;
            if (killer === tierOf.get(laid.owner)) t.killedByTier++;
          }
        }
        for (const [arms] of tiers) {
          const t = byTier.get(arms) as { last: number };
          if (laid.level >= arms - 9 && laid.level <= arms + OVER) t.last = e.tick - cycle.start;
        }
        if (laid.level === far) {
          if (laid.kind === "elite") {
            // One roll to each strongest citizen within reach when it dies.
            for (const c of citizens)
              if (
                tierOf.get(c.id) === strongestArms &&
                Math.max(Math.abs(c.x - e.x), Math.abs(c.y - e.y)) <= ROLL_REACH
              )
                strongest.eliteRolls++;
          } else if (killer === strongestArms) {
            strongest.farKills++;
            strongest.farDrops +=
              dropChance(laid.rank as Exclude<Rank, "elite">, laid.pay, laid.per) / 10_000;
          }
        }
      }
    }
    learn();
  }
  const fightableLeft = (arms: number): number =>
    world.actors.filter((a) => a.pack > 0 && a.level >= arms - 9 && a.level <= arms + OVER).length;
  const results: TierResult[] = tiers.map(([arms, n]) => {
    const t = byTier.get(arms) as NonNullable<ReturnType<typeof byTier.get>>;
    const pay = t.payM === 0 ? 0 : t.payN / t.payM;
    return {
      arms,
      citizens: n,
      standing: t.standing / n,
      inDens: t.inDens / n,
      laid: t.wholeW === 0 ? 0 : t.laidW / t.wholeW,
      pay,
      paid: t.wholeW === 0 ? 0 : paidOf(arms) / t.wholeW,
      killed: t.monsters === 0 ? 0 : t.killed / t.monsters,
      killedByTier: t.monsters === 0 ? 0 : t.killedByTier / t.monsters,
      lastFightable: t.last,
      fightableLeft: fightableLeft(arms),
      xpFromOwn: t.xpOwn / n,
    };
  });
  return {
    city,
    size,
    tiles: `${landing.width} by ${landing.height}`,
    awake,
    seed,
    room: roomOf(landing),
    far,
    stoodAtPlant: laidEvent?.type === "laid" ? laidEvent.monsters : 0,
    dens: landing.dens.length,
    inDensAtPlant,
    denTurns,
    tiers: results,
    strongest,
  };
}

const runs: RunResult[] = [];
for (const [city, size] of SIZES)
  for (const awake of [15, 150] as const)
    for (let seed = 1; seed <= seeds; seed++) {
      const result = run(city, size, awake, seed);
      runs.push(result);
      console.error(
        `${result.tiles} at ${awake}, seed ${seed}: ${result.stoodAtPlant} of ${result.room} stood`,
      );
    }

// The means over the seeds, size by size.
const mean = (xs: readonly number[]): number =>
  xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const round = (x: number, digits = 3): number => Number(x.toFixed(digits));
const summary = SIZES.flatMap(([city, size]) =>
  ([15, 150] as const).map((awake) => {
    const these = runs.filter((r) => r.city === city && r.size === size && r.awake === awake);
    const first = these[0] as RunResult;
    return {
      city,
      size,
      tiles: first.tiles,
      awake,
      landings: these.length,
      room: first.room,
      stoodAtPlant: round(mean(these.map((r) => r.stoodAtPlant)), 1),
      inDensAtPlant: round(mean(these.map((r) => r.inDensAtPlant)), 1),
      denTurns: {
        out: round(mean(these.map((r) => r.denTurns.out)), 1),
        passedCap: round(mean(these.map((r) => r.denTurns.passedCap)), 1),
        passedPost: round(mean(these.map((r) => r.denTurns.passedPost)), 1),
      },
      tiers: first.tiers.map((tier, i) => {
        const of = (f: (t: TierResult) => number): number =>
          round(mean(these.map((r) => f(r.tiers[i] as TierResult))));
        return {
          arms: tier.arms,
          citizens: tier.citizens,
          standing: of((t) => t.standing),
          inDens: of((t) => t.inDens),
          laid: of((t) => t.laid),
          pay: of((t) => t.pay),
          paid: of((t) => t.paid),
          killed: of((t) => t.killed),
          killedByTier: of((t) => t.killedByTier),
          lastFightable: of((t) => t.lastFightable),
          fightableLeft: of((t) => t.fightableLeft),
          xpFromOwn: of((t) => t.xpFromOwn),
        };
      }),
      strongest: {
        arms: first.strongest.arms,
        eliteRolls: round(mean(these.map((r) => r.strongest.eliteRolls)), 2),
        farKills: round(mean(these.map((r) => r.strongest.farKills)), 1),
        farDrops: round(mean(these.map((r) => r.strongest.farDrops)), 2),
      },
    };
  }),
);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ order: ORDER.length, summary, runs }, null, 2)}\n`);
console.error(`wrote ${out}`);
