// Items: base types, rarity and rolled affixes, loaded from content/items/.
// Not part of the world yet. A roll takes the world's generator state, so the
// same seed gives the same items; everything is whole numbers.

import { isInt32, show } from "./hash.ts";
import { nextInt, type Rng } from "./rng.ts";
import { PROGRAM_NAME } from "./vm.ts";

export const SLOTS = ["weapon", "body", "helm", "ring"] as const;
export type Slot = (typeof SLOTS)[number];

export const RARITIES = ["normal", "magic", "rare"] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Every stat an item can carry. `damage_pct` and `armour_pct` are percentage
 * increases to the item's flat damage and armour; `speed` is a percentage too.
 */
export const STATS = [
  "life",
  "life_regen",
  "damage",
  "damage_pct",
  "armour",
  "armour_pct",
  "accuracy",
  "speed",
] as const;
export type Stat = (typeof STATS)[number];
export type Stats = Readonly<Record<Stat, number>>;

export const MAX_ITEM_LEVEL = 100;
/** Largest value any stat in content may have, so sums and percentages stay small. */
export const MAX_STAT_VALUE = 10_000;
const MAX_WEIGHT = 10_000;
const MAX_ENTRIES = 100;
const MAX_TIERS = 10;
/** A rarity allows at most this many prefixes, and as many suffixes. */
const MAX_PER_KIND = 3;
/** Names shown to a viewer: letters, spaces and apostrophes, starting with a letter. */
const DISPLAY_NAME = /^[A-Za-z][A-Za-z' ]{0,23}$/;

export interface RarityRule {
  /** Relative chance of an item rolling this rarity. */
  readonly weight: number;
  /** At most this many prefixes, and at most this many suffixes. */
  readonly prefixes: number;
  readonly suffixes: number;
  /** The number of affixes is rolled evenly from min to max. */
  readonly min: number;
  readonly max: number;
}

export interface Base {
  readonly id: string;
  readonly name: string;
  readonly slot: Slot;
  /** The lowest item level this base can be. */
  readonly level: number;
  /** Stats every item of this base has. */
  readonly stats: Readonly<Partial<Record<Stat, number>>>;
}

export interface Tier {
  /** The lowest item level this tier can roll on. */
  readonly level: number;
  readonly min: number;
  readonly max: number;
}

export interface Affix {
  readonly id: string;
  /** "Sharp" for a prefix, "of Aim" for a suffix: how the item's name reads. */
  readonly name: string;
  readonly kind: "prefix" | "suffix";
  /** An item never has two affixes from the same group. */
  readonly group: string;
  readonly stat: Stat;
  readonly slots: readonly Slot[];
  readonly weight: number;
  /** Lowest level first. */
  readonly tiers: readonly Tier[];
}

export interface ItemTable {
  readonly rarities: Readonly<Record<Rarity, RarityRule>>;
  readonly bases: Readonly<Record<string, Base>>;
  /** Sorted by id, so rolls never depend on the order of the file. */
  readonly affixes: readonly Affix[];
}

export interface RolledAffix {
  readonly affix: string;
  /** Index into the affix's tiers; 0 is the lowest. */
  readonly tier: number;
  readonly value: number;
}

export interface Item {
  readonly base: string;
  readonly level: number;
  readonly rarity: Rarity;
  readonly prefixes: readonly RolledAffix[];
  readonly suffixes: readonly RolledAffix[];
}

export class ItemError extends Error {
  override name = "ItemError";
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const fail = (message: string): never => {
  throw new ItemError(message);
};

function record(raw: unknown, where: string, fields?: readonly string[]): Record<string, unknown> {
  if (!isRecord(raw)) return fail(`${where} must be an object`);
  if (fields) {
    for (const key of Object.keys(raw)) {
      if (!fields.includes(key)) fail(`${where} has an unknown field ${show(key)}`);
    }
  }
  return raw;
}

function whole(value: unknown, low: number, high: number, where: string): number {
  if (!isInt32(value) || value < low || value > high) {
    return fail(`${where} must be a whole number from ${low} to ${high}, got ${show(value)}`);
  }
  // -0 passes the check above; store it as 0 so nothing downstream can tell them apart.
  return value === 0 ? 0 : value;
}

/**
 * A copy of the list `raw`, with `low` to `high` entries. The length is read
 * once and checked before anything is copied, and every entry must be present,
 * so a sparse list, an absurd length or a Proxy that changes as it is read is
 * refused. Callers validate the copy, never `raw`.
 */
function list(raw: unknown, low: number, high: number, what: string): unknown[] {
  if (!Array.isArray(raw)) return fail(`${what} must be a list of ${low} to ${high} entries`);
  const length: unknown = raw.length;
  if (!isInt32(length) || length < low || length > high) {
    return fail(`${what} must be a list of ${low} to ${high} entries, got ${show(length)}`);
  }
  return Array.from({ length }, (_, i) => {
    if (!Object.hasOwn(raw, i)) fail(`${what} has a gap at ${i}`);
    return raw[i] as unknown;
  });
}

function oneOf<T extends string>(value: unknown, options: readonly T[], where: string): T {
  if (!options.includes(value as T)) {
    return fail(`${where} must be one of ${options.join(", ")}, got ${show(value)}`);
  }
  return value as T;
}

function entries(raw: unknown, what: string): [string, unknown][] {
  const table = record(raw, what);
  const ids = Object.keys(table).sort();
  if (ids.length === 0) fail(`${what} is empty`);
  if (ids.length > MAX_ENTRIES) fail(`${what} has more than ${MAX_ENTRIES} entries`);
  return ids.map((id) => {
    if (!PROGRAM_NAME.test(id)) {
      fail(`${show(id.slice(0, 40))} in ${what} is not a valid id (lower-case letters, digits, _)`);
    }
    return [id, table[id]];
  });
}

function displayName(value: unknown, where: string): string {
  if (typeof value !== "string" || !DISPLAY_NAME.test(value)) {
    return fail(`${where} needs a name of up to 24 letters and spaces, got ${show(value)}`);
  }
  return value;
}

function parseRarities(raw: unknown): Record<Rarity, RarityRule> {
  const table = record(raw, "rarities", RARITIES);
  const out = Object.create(null) as Record<Rarity, RarityRule>;
  let total = 0;
  for (const rarity of RARITIES) {
    const where = `rarity "${rarity}"`;
    const r = record(table[rarity], where, ["weight", "prefixes", "suffixes", "min", "max"]);
    const rule: RarityRule = {
      weight: whole(r.weight, 0, MAX_WEIGHT, `${where}: weight`),
      prefixes: whole(r.prefixes, 0, MAX_PER_KIND, `${where}: prefixes`),
      suffixes: whole(r.suffixes, 0, MAX_PER_KIND, `${where}: suffixes`),
      min: whole(r.min, 0, 2 * MAX_PER_KIND, `${where}: min`),
      max: whole(r.max, 0, 2 * MAX_PER_KIND, `${where}: max`),
    };
    if (rule.min > rule.max) fail(`${where}: min is more than max`);
    if (rule.max > rule.prefixes + rule.suffixes) {
      fail(`${where}: max is more than prefixes and suffixes together`);
    }
    total += rule.weight;
    out[rarity] = Object.freeze(rule);
  }
  if (total === 0) fail("rarities: at least one weight must be above 0");
  return out;
}

function parseStats(raw: unknown, where: string): Partial<Record<Stat, number>> {
  const table = record(raw, `${where}: stats`, STATS);
  const out: Partial<Record<Stat, number>> = {};
  for (const stat of STATS) {
    if (Object.hasOwn(table, stat)) {
      out[stat] = whole(table[stat], 0, MAX_STAT_VALUE, `${where}: ${stat}`);
    }
  }
  return Object.freeze(out);
}

function parseBases(raw: unknown): Record<string, Base> {
  const out = Object.create(null) as Record<string, Base>;
  for (const [id, value] of entries(raw, "bases")) {
    const where = `base "${id}"`;
    const b = record(value, where, ["name", "slot", "level", "stats"]);
    out[id] = Object.freeze({
      id,
      name: displayName(b.name, where),
      slot: oneOf(b.slot, SLOTS, `${where}: slot`),
      level: whole(b.level, 1, MAX_ITEM_LEVEL, `${where}: level`),
      stats: parseStats(b.stats, where),
    });
  }
  return out;
}

function parseTiers(raw: unknown, where: string): Tier[] {
  const items = list(raw, 1, MAX_TIERS, `${where}: tiers`);
  const tiers: Tier[] = [];
  for (let i = 0; i < items.length; i++) {
    const at = `${where}: tier ${i}`;
    const t = record(items[i], at, ["level", "min", "max"]);
    const tier: Tier = {
      level: whole(t.level, 1, MAX_ITEM_LEVEL, `${at}: level`),
      min: whole(t.min, 0, MAX_STAT_VALUE, `${at}: min`),
      max: whole(t.max, 0, MAX_STAT_VALUE, `${at}: max`),
    };
    if (tier.min > tier.max) fail(`${at}: min is more than max`);
    const before = tiers[i - 1];
    if (before && tier.level <= before.level) {
      fail(`${at}: levels must go up from one tier to the next`);
    }
    tiers.push(Object.freeze(tier));
  }
  return tiers;
}

function parseAffixes(raw: unknown): Affix[] {
  const out: Affix[] = [];
  for (const [id, value] of entries(raw, "affixes")) {
    const where = `affix "${id}"`;
    const a = record(value, where, ["name", "kind", "group", "stat", "slots", "weight", "tiers"]);
    const { group } = a;
    if (typeof group !== "string" || !PROGRAM_NAME.test(group)) {
      fail(`${where}: group must be an id (lower-case letters, digits, _), got ${show(group)}`);
    }
    const slotList = list(a.slots, 1, SLOTS.length, `${where}: slots`).map((s) =>
      oneOf(s, SLOTS, `${where}: slot`),
    );
    if (new Set(slotList).size !== slotList.length) fail(`${where}: a slot is listed twice`);
    out.push(
      Object.freeze({
        id,
        name: displayName(a.name, where),
        kind: oneOf(a.kind, ["prefix", "suffix"] as const, `${where}: kind`),
        group: group as string,
        stat: oneOf(a.stat, STATS, `${where}: stat`),
        slots: Object.freeze(slotList),
        weight: whole(a.weight, 1, MAX_WEIGHT, `${where}: weight`),
        tiers: Object.freeze(parseTiers(a.tiers, where)),
      }),
    );
  }
  return out;
}

/**
 * Validates parsed item content (the three files in content/items/) and
 * returns a frozen table. Throws an ItemError that says what is wrong and
 * where; nothing is returned unless every part is valid.
 */
export function loadItems(content: {
  rarities: unknown;
  bases: unknown;
  affixes: unknown;
}): ItemTable {
  try {
    const parts = record(content, "item content");
    return Object.freeze({
      rarities: Object.freeze(parseRarities(parts.rarities)),
      bases: Object.freeze(parseBases(parts.bases)),
      affixes: Object.freeze(parseAffixes(parts.affixes)),
    });
  } catch (error) {
    // Whatever was passed in, the only thing that comes out is an ItemError.
    if (error instanceof ItemError) throw error;
    throw new ItemError("the item content could not be read");
  }
}

/** One of `options`, chosen with chance in proportion to its weight; undefined if all weigh 0. */
function pickWeighted<T>(rng: Rng, options: readonly T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  for (const option of options) total += weight(option);
  if (total === 0) return undefined;
  let roll = nextInt(rng, total);
  for (const option of options) {
    roll -= weight(option);
    if (roll < 0) return option;
  }
  return undefined;
}

/**
 * Rolls an item of `baseId` at item `level`, advancing `rng`. Picks a rarity
 * by weight, then a number of affixes for it, then each affix by weight from
 * those that fit the base's slot, have room in their kind, share no group with
 * one already on the item and have a tier at or below the item level. The tier
 * is chosen evenly from those at or below the item level, and the value evenly
 * from the tier's range. If the pool runs out the item gets fewer affixes.
 */
export function rollItem(table: ItemTable, baseId: string, level: number, rng: Rng): Item {
  const base = table.bases[baseId];
  if (!base) throw new ItemError(`there is no base called ${show(baseId)}`);
  if (!Number.isInteger(level) || level < base.level || level > MAX_ITEM_LEVEL) {
    throw new ItemError(
      `${base.id} needs an item level from ${base.level} to ${MAX_ITEM_LEVEL}, got ${show(level)}`,
    );
  }
  const rarity = pickWeighted(rng, RARITIES, (r) => table.rarities[r].weight) as Rarity;
  const rule = table.rarities[rarity];
  const count = rule.min + nextInt(rng, rule.max - rule.min + 1);

  const prefixes: RolledAffix[] = [];
  const suffixes: RolledAffix[] = [];
  const groups = new Set<string>();
  for (let i = 0; i < count; i++) {
    const pool = table.affixes.filter(
      (a) =>
        a.slots.includes(base.slot) &&
        (a.kind === "prefix" ? prefixes.length < rule.prefixes : suffixes.length < rule.suffixes) &&
        !groups.has(a.group) &&
        (a.tiers[0] as Tier).level <= level,
    );
    const affix = pickWeighted(rng, pool, (a) => a.weight);
    if (!affix) break;
    let tiers = 0;
    while (tiers < affix.tiers.length && (affix.tiers[tiers] as Tier).level <= level) tiers++;
    const tier = nextInt(rng, tiers);
    const { min, max } = affix.tiers[tier] as Tier;
    const rolled = { affix: affix.id, tier, value: min + nextInt(rng, max - min + 1) };
    groups.add(affix.group);
    (affix.kind === "prefix" ? prefixes : suffixes).push(rolled);
  }
  return { base: base.id, level, rarity, prefixes, suffixes };
}

function affixById(table: ItemTable, id: string): Affix {
  const affix = table.affixes.find((a) => a.id === id);
  if (!affix) throw new ItemError(`there is no affix called ${show(id)}`);
  return affix;
}

/**
 * The item's stats: its base's plus its affixes'. Flat damage and armour are
 * then raised by their percentage increases, rounded down.
 */
export function itemStats(table: ItemTable, item: Item): Stats {
  const base = table.bases[item.base];
  if (!base) throw new ItemError(`there is no base called ${show(item.base)}`);
  const sum = Object.fromEntries(STATS.map((s) => [s, base.stats[s] ?? 0])) as Record<Stat, number>;
  for (const rolled of [...item.prefixes, ...item.suffixes]) {
    sum[affixById(table, rolled.affix).stat] += rolled.value;
  }
  const increased = (flat: number, pct: number): number => {
    const scaled = flat * (100 + pct);
    return (scaled - (scaled % 100)) / 100;
  };
  sum.damage = increased(sum.damage, sum.damage_pct);
  sum.armour = increased(sum.armour, sum.armour_pct);
  return Object.freeze(sum);
}

/** How a viewer sees the item: "Sharp Rusty Sword of Aim" for a magic one, the base's name otherwise. */
export function itemName(table: ItemTable, item: Item): string {
  const base = table.bases[item.base];
  if (!base) throw new ItemError(`there is no base called ${show(item.base)}`);
  if (item.rarity !== "magic") return base.name;
  const words = [
    ...item.prefixes.map((r) => affixById(table, r.affix).name),
    base.name,
    ...item.suffixes.map((r) => affixById(table, r.affix).name),
  ];
  return words.join(" ");
}
