// Where things are in the two Kenney sheets (12 columns of 16-pixel tiles).

export const TILE = 16;
export const SHEET_COLUMNS = 12;

export type Sheet = "town" | "dungeon";
export interface Cell {
  readonly sheet: Sheet;
  readonly index: number;
}
const town = (index: number): Cell => ({ sheet: "town", index });
const dungeon = (index: number): Cell => ({ sheet: "dungeon", index });

export const GRASS = [town(0), town(0), town(0), town(1), town(0), town(2)] as const;
export const PATH = town(43);
/** Dirt with a grass edge, as a nine-slice: rows top/middle/bottom, columns left/middle/right. */
export const DIRT = [
  [town(12), town(13), town(14)],
  [town(24), town(25), town(26)],
  [town(36), town(37), town(38)],
] as const;
export const SAND = [dungeon(48), dungeon(49), dungeon(48), dungeon(51)] as const;
export const DEN_FLOOR = [
  dungeon(0),
  dungeon(1),
  dungeon(0),
  dungeon(12),
  dungeon(1),
  dungeon(24),
] as const;
export const ROCK = [dungeon(40), dungeon(57), dungeon(58), dungeon(59)] as const;
export const TREES = [town(16), town(4), town(16), town(28), town(5)] as const;
export const DARK_TREES = [town(4), town(28), town(4)] as const;
export const BANK_CHEST = dungeon(89);
export const FIRE_LOG = town(106);

/** Adventurer sprites, handed out in spawn order. */
export const ADVENTURERS = [
  dungeon(85),
  dungeon(99),
  dungeon(87),
  dungeon(88),
  dungeon(98),
  dungeon(86),
  dungeon(100),
  dungeon(84),
  dungeon(112),
  dungeon(96),
  dungeon(97),
] as const;

export const cellFor = <T>(options: readonly T[], x: number, y: number): T => {
  // A fixed scramble of the position, so the same tile always gets the same variant.
  const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0;
  return options[h % options.length] as T;
};
