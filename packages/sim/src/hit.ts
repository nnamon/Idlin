// One hit, worked out as docs/slice.md section 4.1 says, and the numbers it
// starts from: plan.md section 2.1's blows and hitpoints by level and rank.
// Integers only. Every percentage is held in hundredths of a percent, so 14%
// is 1_400, and every division rounds down.

import { nextInt, type Rng } from "./rng.ts";

/** The four damage types, in the order a hit's parts are listed. */
export const DAMAGE_TYPES = ["physical", "fire", "cold", "lightning"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type Element = Exclude<DamageType, "physical">;

/** 100%, in hundredths of a percent. */
export const FULL = 10_000;
/** A citizen's crit chance with no "+N% crit" line, and the most any lines make it. */
export const BARE_CRIT = 500;
export const MOST_CRIT = 4_000;
/** No resistance counts for more than this. */
export const MOST_RESIST = 7_500;
/** No part of a hit, at any stage, outgrows this, so a hit always fits in 32 bits. */
export const MOST_DAMAGE = 0x7fff_ffff;

/** The share of a hit each weapon family deals (slice.md, section 3.1). */
export const FAMILY_HIT = Object.freeze({
  blade: 10_000,
  maul: 22_000,
  spear: 12_000,
  bow: 10_000,
});

/** What a weapon's own damage is divided by, for each of its family's three bases (from item level 1, 20 and 45). */
const WEAPON_DIVISORS = [8, 6, 4] as const;

/**
 * Everything that changes a hit. Where a modifier sits in the list does not
 * change the order of the stages; only "more" lines are applied in list order.
 */
export type Modifier =
  /** "+N physical", "+N fire" and the like, and a weapon's own damage: added to that type's base. */
  | { readonly kind: "added"; readonly type: DamageType; readonly amount: number }
  /** "+N% damage". All of them are summed and the sum applied once, to every type. */
  | { readonly kind: "increased"; readonly pct: number }
  /**
   * A "more" (`pct` above 0) or a "less" (below 0), applied on its own after
   * the increased, to `type` only or, when it names none, to every type.
   */
  | { readonly kind: "more"; readonly pct: number; readonly type?: DamageType }
  /** "+N% crit", added to BARE_CRIT. */
  | { readonly kind: "crit"; readonly pct: number }
  /** "ignores N% resistance", taken off the target's resistance to each element. */
  | { readonly kind: "penetration"; readonly pct: number };

export interface Attacker {
  /** The blow its level gives: `blow(Arms)` for a citizen, `monsterBlow` for a monster. */
  readonly blow: number;
  /** Its weapon family's share of the hit, from FAMILY_HIT. A monster's is FULL. */
  readonly family: number;
  /** A monster on a landing with an element does half its blow as that element. */
  readonly element?: Element;
}

export interface Defender {
  readonly armour: number;
  /** Resistance to each element, in hundredths of a percent; an element left out is 0. */
  readonly resist?: Readonly<Partial<Record<Element, number>>>;
}

/** Each type's part of a hit, in DAMAGE_TYPES order. */
export type Parts = readonly [number, number, number, number];

/** Each type's part after every stage of 4.1, for checking a hit against a worked example. */
export interface Stages {
  readonly base: Parts;
  readonly family: Parts;
  readonly increased: Parts;
  readonly more: Parts;
  readonly crit: Parts;
  /** After the target's armour and resistances. */
  readonly target: Parts;
}

export interface Hit {
  /** What each type does, after the target's defences. */
  readonly parts: Parts;
  /** What the hit takes off: the sum of the parts, and at least 1 unless its base was nothing. */
  readonly amount: number;
  readonly crit: boolean;
  /** The type with the largest part; of types that tie, the first in DAMAGE_TYPES. */
  readonly type: DamageType;
}

/** `n / d` rounded down, for whole n >= 0 and d > 0, without a floating-point division. */
const div = (n: number, d: number): number => (n - (n % d)) / d;
const clamp = (n: number, low: number, high: number): number => Math.min(high, Math.max(low, n));
const part = (n: number): number => clamp(n, 0, MOST_DAMAGE);
const each = (parts: Parts, f: (n: number, type: DamageType) => number): Parts =>
  parts.map((n, i) => part(f(n, DAMAGE_TYPES[i] as DamageType))) as unknown as Parts;
/** `n` multiplied by `pct` hundredths of a percent, rounded down; a factor below 0 counts as 0. */
const scale = (n: number, pct: number): number => div(n * Math.max(0, pct), FULL);

/** The base blow at a level: `6 + L + L*L/20`. Arms for a citizen; the same formula sizes monsters and weapons. */
export const blow = (level: number): number => 6 + level + div(level * level, 20);

/** Hitpoints at a level: `40 + 10*L + L*L/5`, on a citizen's Hitpoints level. */
export const life = (level: number): number => 40 + 10 * level + div(level * level, 5);

/**
 * A weapon's own damage: the blow of its item level divided by 8, 6 or 4 for
 * the first, second and third base of its family (`base` 0, 1 or 2).
 */
export const weaponDamage = (itemLevel: number, base: 0 | 1 | 2): number =>
  div(blow(itemLevel), WEAPON_DIVISORS[base]);

/**
 * The ranks of monster in the slice. `weight` multiplies its hitpoints and is
 * what a kill is worth; `share` is its blow's share of what a citizen of its
 * level can take, in hundredths of a percent; `windup` and `recovery` are its
 * blow's times in ticks (slice.md, section 1). Bosses come after the slice.
 */
export const RANKS = Object.freeze({
  fodder: Object.freeze({ weight: 1, share: 100, windup: 3, recovery: 6 }),
  pack: Object.freeze({ weight: 3, share: 400, windup: 4, recovery: 8 }),
  brute: Object.freeze({ weight: 12, share: 2_500, windup: 6, recovery: 14 }),
  elite: Object.freeze({ weight: 40, share: 4_000, windup: 5, recovery: 10 }),
});
export type Rank = keyof typeof RANKS;

/** A monster's hitpoints: `rank * blow(M) * (100 + 2*M) / 100`, rounded down once, at the end. */
export const monsterLife = (rank: Rank, level: number): number =>
  div(RANKS[rank].weight * blow(level) * (100 + 2 * level), 100);

/**
 * A monster's blow: its rank's share of `life(M) * (100 + M) / 100`, each
 * rounded down in that order, and never less than 1.
 */
export const monsterBlow = (rank: Rank, level: number): number =>
  Math.max(1, div(div(life(level) * (100 + level), 100) * RANKS[rank].share, FULL));

/** A monster's armour: four times its level for a brute or an elite, none for fodder and pack monsters. */
export const monsterArmour = (rank: Rank, level: number): number =>
  rank === "brute" || rank === "elite" ? 4 * level : 0;

/** A citizen's crit chance with these lines: BARE_CRIT plus every "+N% crit", up to MOST_CRIT. */
export function critChance(modifiers: readonly Modifier[]): number {
  let chance = BARE_CRIT;
  for (const m of modifiers) if (m.kind === "crit") chance += m.pct;
  return clamp(chance, 0, MOST_CRIT);
}

/**
 * The one seeded roll a citizen's swing makes, whether it crits. It draws from
 * `rng` exactly once. A swing that lands on several targets crits on all of
 * them or none, so the roll is the swing's and `hit` is told its result.
 */
export const rollCrit = (rng: Rng, modifiers: readonly Modifier[]): boolean =>
  nextInt(rng, FULL) < critChance(modifiers);

/** The six stages of 4.1, for one hit on one target. Monsters never crit, so pass `crit` false for one. */
export function hitStages(
  attacker: Attacker,
  defender: Defender,
  modifiers: readonly Modifier[],
  crit: boolean,
): Stages {
  // 1. Base. A monster's elemental half is rounded down and physical takes the rest.
  const blown = part(attacker.blow);
  const half = attacker.element === undefined ? 0 : div(blown, 2);
  const start = DAMAGE_TYPES.map((type) =>
    type === "physical" ? blown - half : type === attacker.element ? half : 0,
  );
  let increased = 0;
  for (const m of modifiers) {
    if (m.kind === "added") {
      const i = DAMAGE_TYPES.indexOf(m.type);
      start[i] = part((start[i] as number) + m.amount);
    } else if (m.kind === "increased") increased += m.pct;
  }
  const base = start as unknown as Parts;
  // 2. The family's share of the hit.
  const family = each(base, (n) => scale(n, attacker.family));
  // 3. Every "+N% damage" at once.
  const raised = each(family, (n) => scale(n, FULL + increased));
  // 4. Each more and less in turn.
  let more = raised;
  for (const m of modifiers) {
    if (m.kind !== "more") continue;
    more = each(more, (n, type) =>
      m.type === undefined || m.type === type ? scale(n, FULL + m.pct) : n,
    );
  }
  // 5. A crit doubles every type.
  const critted = crit ? each(more, (n) => n * 2) : more;
  // 6. The target's armour and resistances.
  const armour = Math.max(0, defender.armour);
  let ignored = 0;
  for (const m of modifiers) if (m.kind === "penetration") ignored += m.pct;
  const target = each(critted, (n, type) => {
    if (type === "physical")
      return n === 0 || armour === 0 ? n : n - div(n * armour, armour + 5 * n);
    const r = clamp((defender.resist?.[type] ?? 0) - ignored, 0, MOST_RESIST);
    return n - div(n * r, FULL);
  });
  return { base, family, increased: raised, more, crit: critted, target };
}

/**
 * One hit by `attacker` on `defender`, through every stage of 4.1. A hit whose
 * base has anything in it does at least 1, whatever the "less" lines and the
 * target's defences take off; one whose base is nothing does nothing.
 */
export function hit(
  attacker: Attacker,
  defender: Defender,
  modifiers: readonly Modifier[],
  crit: boolean,
): Hit {
  const stages = hitStages(attacker, defender, modifiers, crit);
  const parts = stages.target;
  let sum = 0;
  let type = 0;
  for (let i = 0; i < parts.length; i++) {
    sum += parts[i] as number;
    if ((parts[i] as number) > (parts[type] as number)) type = i;
  }
  const something = stages.base.some((n) => n > 0);
  return {
    parts,
    amount: something ? clamp(sum, 1, MOST_DAMAGE) : 0,
    crit,
    type: DAMAGE_TYPES[type] as DamageType,
  };
}
