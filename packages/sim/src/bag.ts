// What an adventurer carries and what it keeps in the bank at camp. A bag has
// BAG_SLOTS slots, each empty or holding one good. The bank holds a count of
// each good and has no slots. Each adventurer has its own bank.

import { terrainOf } from "./atlas.ts";
import { NEIGHBOURS } from "./map.ts";
import type { Actor, World } from "./world.ts";

/**
 * Every good, by id: a good's id is its position here plus 1, and 0 is an
 * empty slot. Programs name goods by id, so the order is permanent: append only.
 */
export const GOODS = ["logs", "raw_fish", "cooked_fish", "burnt_fish"] as const;
export type Good = (typeof GOODS)[number];

export const BAG_SLOTS = 12;
/** The most of one good a bank holds; anything more stays in the bag. */
export const MAX_BANKED = 0x7fffffff;

/** The id of a good, as programs know it. */
export const goodId = (good: Good): number => GOODS.indexOf(good) + 1;

const isGood = (id: number): boolean => Number.isInteger(id) && id >= 1 && id <= GOODS.length;

export const emptyBag = (): number[] => new Array<number>(BAG_SLOTS).fill(0);
export const emptyBank = (): number[] => new Array<number>(GOODS.length).fill(0);

/** How many of good `id` are in the bag; 0 for an id that is not a good. */
export const carrying = (actor: Actor, id: number): number =>
  isGood(id) ? actor.bag.filter((slot) => slot === id).length : 0;

/** How many of good `id` are in the actor's bank; 0 for an id that is not a good. */
export const banked = (actor: Actor, id: number): number =>
  isGood(id) ? (actor.bank[id - 1] as number) : 0;

export const freeSlots = (actor: Actor): number => actor.bag.filter((slot) => slot === 0).length;

/**
 * Whether `actor` stands next to a bank tile, where it can deposit and
 * withdraw.
 */
export const atBank = (world: World, actor: Actor): boolean =>
  NEIGHBOURS.some(([dx, dy]) => terrainOf(world.atlas, actor.x + dx, actor.y + dy) === "bank");

/**
 * Moves up to `count` of good `id` from the bag into the bank, emptying the
 * slots from the first. Returns how many moved: 0 away from the bank, for an
 * id that is not a good, a count below 1, or a bank already full of it.
 */
export function deposit(world: World, actor: Actor, id: number, count: number): number {
  if (!atBank(world, actor) || !isGood(id) || count < 1) return 0;
  const room = MAX_BANKED - (actor.bank[id - 1] as number);
  let moved = 0;
  for (let slot = 0; slot < BAG_SLOTS && moved < count && moved < room; slot++) {
    if (actor.bag[slot] !== id) continue;
    actor.bag[slot] = 0;
    moved++;
  }
  actor.bank[id - 1] = (actor.bank[id - 1] as number) + moved;
  return moved;
}

/**
 * Moves up to `count` of good `id` from the bank into the bag's empty slots,
 * filling them from the first. Returns how many moved: 0 away from the bank,
 * for an id that is not a good, a count below 1, none banked or a full bag.
 */
export function withdraw(world: World, actor: Actor, id: number, count: number): number {
  if (!atBank(world, actor) || !isGood(id) || count < 1) return 0;
  let moved = 0;
  for (let slot = 0; slot < BAG_SLOTS && moved < count; slot++) {
    if (actor.bag[slot] !== 0 || moved >= (actor.bank[id - 1] as number)) continue;
    actor.bag[slot] = id;
    moved++;
  }
  actor.bank[id - 1] = (actor.bank[id - 1] as number) - moved;
  return moved;
}
