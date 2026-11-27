// Names for the scripted scenes: chat usernames for citizens, and item names
// built from a base and affixes the way an action RPG rolls them. All made
// up, and the same for the same index or seed. A username is 3 to 25
// characters of letters, digits and underscores, as chat services allow.

const FIRST = [
  "joshyboy88",
  "xXxKittyKatxXx",
  "goofguy",
  "pixelwitch",
  "mossy_dan",
  "big_ron_1987",
  // The hard cases for a name slip and the roster: the longest a name may be
  // (25 characters), two pairs that differ by one character, and the shortest (3).
  "definitely_not_a_goblin_7",
  "goofguy_",
  "Bo7",
  "joshyboy89",
  "dr_spoon",
  "sleepyotter",
  "NotABot_",
  "kraken_main",
  "lil_gremlin",
  "tacocat_tv",
  "beans4ever",
  "frogmode",
  "ham_sandwich_",
  "oatmilk_enjoyer",
  "1toughcookie",
  "captain_nap",
  "zzTopHat",
  "moth_lamp",
  "rustbucket_42",
  "ElderGoose",
  "Quietstorm",
  "wizard_of_laundry",
];
const LEFT = [
  "void",
  "salty",
  "turbo",
  "cozy",
  "grim",
  "lazy",
  "mega",
  "tiny",
  "dank",
  "swift",
  "loud",
  "mild",
  "feral",
  "soggy",
  "lucky",
  "rogue",
];
const RIGHT = [
  "badger",
  "noodle",
  "pickle",
  "wizard",
  "goblin",
  "toaster",
  "raccoon",
  "biscuit",
  "hammer",
  "walrus",
  "cactus",
  "ferret",
  "lantern",
  "turnip",
  "sprocket",
  "magpie",
];

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The username of the nth citizen, from 0. No two alike in the first 250. */
export function usernameOf(index: number): string {
  if (index < FIRST.length) return FIRST[index] as string;
  const i = index - FIRST.length;
  const a = LEFT[i % LEFT.length] as string;
  const b = RIGHT[(i * 5 + Math.floor(i / LEFT.length)) % RIGHT.length] as string;
  const num = (i * 37 + 11) % 100;
  switch (i % 5) {
    case 0:
      return `${a}${b}${num}`;
    case 1:
      return `${a}_${b}`;
    case 2:
      return `${cap(a)}${cap(b)}`;
    case 3:
      return `x${cap(a)}${cap(b)}x`;
    default:
      return `${b}_${num}`;
  }
}

const BASES = [
  ["War Axe", "Falchion", "Glaive", "Cleaver"],
  ["Iron Band", "Bone Ring", "Brass Loop"],
  ["Kettle Helm", "Boar-hide Cap", "Visor"],
  ["Boar-hide Vest", "Chain Shirt", "Padded Coat"],
];
const PREFIXES = ["Jagged", "Heavy", "Keen", "Tempered", "Cruel", "Swift", "Sturdy", "Burning"];
const SUFFIXES = ["of the Wolf", "of Embers", "of Haste", "of the Boar", "of Thorns", "of the Ox"];
const UNIQUES = ["Splitjaw", "Bonesaw", "Nine Lives", "Gutterlight", "Old Reliable"];

/** 0 a weapon, 1 a ring, 2 a helm, 3 body armour. */
export const ITEM_KINDS = BASES.length;

/**
 * An item's name. A common one is its base; a magic one has a prefix or a
 * suffix; a rare one both; a unique has a name of its own.
 */
export function itemName(seed: number, rarity: number, kind: number): string {
  const pick = <T>(list: readonly T[], salt: number): T =>
    list[Math.abs(seed * 7 + salt * 13) % list.length] as T;
  if (rarity >= 3) return pick(UNIQUES, 1);
  const base = pick(BASES[kind % BASES.length] as string[], 2);
  if (rarity === 0) return base;
  if (rarity === 1)
    return seed % 2 ? `${pick(PREFIXES, 3)} ${base}` : `${base} ${pick(SUFFIXES, 4)}`;
  return `${pick(PREFIXES, 3)} ${base} ${pick(SUFFIXES, 4)}`;
}

export const RARITY_WORDS = ["common", "magic", "rare", "unique"] as const;
export const MONSTER_WORDS = ["mite", "hound", "brute"] as const;

/** Seconds as m:ss. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
