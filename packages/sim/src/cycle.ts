// The walking city's cycle (docs/slice.md, sections 1 and 2): its beats on
// their ticks, counted from each cycle's 0:00. The cycle aims at 7,800 ticks.
// The landing in it runs from legs-plant to lift-off, which comes 300 ticks
// after the shield breaks, and the next cycle's 0:00 is at 7,800 or at
// lift-off, whichever is later.

import { isInt32 } from "./hash.ts";
import {
  BIOMES,
  type Biome,
  type CitySize,
  type LandingInput,
  MAX_EXTRA,
  MAX_LEVEL,
  SIZE_CLASSES,
  type SizeClass,
} from "./landing.ts";
import { nextInt, nextU32, type Rng } from "./rng.ts";

/** A cycle's length when the landing leaves room for it: 13 minutes. */
export const CYCLE_TICKS = 7800;
/** From a cycle's 0:00. The raiders' window runs from RAID to RAID_OVER (piece 22 builds the raid). */
export const RAID = 600;
export const RAID_OVER = 1700;
/** The legs plant and the landing is set down; the ramp is down RAMP_DOWN later and the peace begins. */
export const LEGS_PLANT = 1800;
export const RAMP_DOWN = 2000;
export const SCOUTS = 3900;
export const SIGHTING = 4800;
/**
 * The march, with no scout's call made. Section 1 marches the front at
 * 5,700 - floor(600 * calls / sent), and at 5,700 with no scouts sent; until
 * piece 29 sends scouts, none are.
 */
export const MARCH = 5700;
/** The front reaches the bubble this long after it marches, and the siege begins. */
export const MARCH_TICKS = 750;
/** Lift-off is this long after the break. */
export const LIFT_TICKS = 300;
/**
 * A stand-in until piece 31 builds the shield, which alone decides the
 * break: with no shield, the break comes this long after the siege begins,
 * unless a `break` input brings it sooner. It is longer than any siege
 * section 1 works out (356 seconds), so a break by input can be put anywhere
 * a real one could come, and nothing reads it: `lift_eta` counts as if the
 * shield broke the moment the siege began.
 */
export const PLACEHOLDER_SIEGE = 2400;

/** The beats a cycle passes through, in order. After lift-off it is in transit again. */
export const BEATS = [
  "transit",
  "raid",
  "legs",
  "peace",
  "scouts",
  "sighting",
  "march",
  "siege",
  "break",
] as const;
export type Beat = (typeof BEATS)[number];

/** The cycle's state, as the world holds it and a snapshot saves it. */
export interface Cycle {
  /** The city's size (deck.ts), 1 or 2. */
  readonly city: CitySize;
  /** The tick of this cycle's 0:00. */
  start: number;
  /** Cycles begun, this one among them. */
  count: number;
  /** The landing this cycle sets down on, chosen at its 0:00. */
  landing: LandingInput;
  /** The tick the shield broke, or 0 while it has not. */
  broke: number;
}

/** The tick the front reaches the bubble and the siege begins. */
export const siegeAt = (cycle: Cycle): number => cycle.start + MARCH + MARCH_TICKS;

/** The tick the shield breaks: when it did, or when the stand-in has it break. */
export const breakAt = (cycle: Cycle): number =>
  cycle.broke > 0 ? cycle.broke : siegeAt(cycle) + PLACEHOLDER_SIEGE;

export const liftAt = (cycle: Cycle): number => breakAt(cycle) + LIFT_TICKS;

/** The next cycle's 0:00: 7,800 ticks after this one's, or lift-off if that is later. */
export const nextStart = (cycle: Cycle): number =>
  Math.max(cycle.start + CYCLE_TICKS, liftAt(cycle));

/**
 * The beat at `tick`, and the ticks it runs from and to (the next beat's
 * first tick). In the siege `to` is the stand-in's break (PLACEHOLDER_SIEGE),
 * which means nothing: until piece 31 builds the shield, no view shows it.
 */
export interface BeatSpan {
  readonly beat: Beat;
  readonly from: number;
  readonly to: number;
}

export function beatOf(cycle: Cycle, tick: number): BeatSpan {
  const s = cycle.start;
  const lift = liftAt(cycle);
  const spans: [Beat, number, number][] = [
    ["transit", s, s + RAID],
    ["raid", s + RAID, s + RAID_OVER],
    ["transit", s + RAID_OVER, s + LEGS_PLANT],
    ["legs", s + LEGS_PLANT, s + RAMP_DOWN],
    ["peace", s + RAMP_DOWN, s + SCOUTS],
    ["scouts", s + SCOUTS, s + SIGHTING],
    ["sighting", s + SIGHTING, s + MARCH],
    ["march", s + MARCH, siegeAt(cycle)],
    ["siege", siegeAt(cycle), breakAt(cycle)],
    ["break", breakAt(cycle), lift],
  ];
  for (const [beat, from, to] of spans) if (tick >= from && tick < to) return { beat, from, to };
  // From lift-off to the next 0:00, and the 0:00 itself until the world steps on.
  if (tick < s) return { beat: "transit", from: tick, to: s + RAID };
  return { beat: "transit", from: lift, to: nextStart(cycle) + RAID };
}

/** Whether the city is set down on its landing at `tick`, and whether its ramp is down. */
export const landed = (cycle: Cycle, tick: number): boolean =>
  tick >= cycle.start + LEGS_PLANT && tick < liftAt(cycle);
export const rampDown = (cycle: Cycle, tick: number): boolean =>
  tick >= cycle.start + RAMP_DOWN && tick < liftAt(cycle);

/**
 * The landing a cycle sets down on, drawn at its 0:00: a seed, a size class
 * and a biome, at level 1. The navigator (piece 25) chooses landings later;
 * until then they are drawn evenly. The second city rolls small and medium
 * only (docs/slice.md, section 1): its large landing waits for #418.
 */
export function drawLanding(rng: Rng, city: CitySize): LandingInput {
  const seed = nextU32(rng) | 0;
  const sizes = city === 1 ? SIZE_CLASSES.length : SIZE_CLASSES.indexOf("large");
  const size = SIZE_CLASSES[nextInt(rng, sizes)] as SizeClass;
  const biome = BIOMES[nextInt(rng, BIOMES.length)] as Biome;
  return { seed, size, biome, level: 1 };
}

/** A new world's cycle: its first 0:00 at tick 0. */
export const firstCycle = (city: CitySize, rng: Rng): Cycle => ({
  city,
  start: 0,
  count: 1,
  landing: drawLanding(rng, city),
  broke: 0,
});

/**
 * The city sizes a saved cycle may have. Only the first: nothing grows the
 * city before piece 32, which also has to give city 2's programs their deck
 * places (they are compiled against city 1's), so a snapshot asking for
 * city 2 is refused until then.
 */
const SAVED_CITIES: readonly CitySize[] = [1];

/**
 * A saved cycle read back for a world at `tick`, or null if it is not one a
 * world could hold: a city size it may have, a 0:00 not after the tick and
 * at least a cycle's length per cycle before it, a break only in its siege
 * and not ahead of the tick, and a tick before the next 0:00, which would
 * have begun a new cycle.
 */
export function readCycle(raw: unknown, tick: number): Cycle | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { city, start, count, landing, broke } = raw as Record<string, unknown>;
  if (!SAVED_CITIES.includes(city as CitySize)) return null;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start > tick)
    return null;
  if (!isInt32(count) || count < 1) return null;
  // The first cycle starts at 0, and every one runs at least CYCLE_TICKS.
  if (count === 1 ? start !== 0 : start < (count - 1) * CYCLE_TICKS) return null;
  if (typeof broke !== "number" || !Number.isSafeInteger(broke) || broke < 0 || broke > tick)
    return null;
  const input = readLandingInput(landing);
  if (!input) return null;
  const cycle: Cycle = { city: city as CitySize, start, count, landing: input, broke };
  const siege = siegeAt(cycle);
  if (broke > 0 && (broke < siege || broke > siege + PLACEHOLDER_SIEGE)) return null;
  if (broke === 0 && tick >= siege + PLACEHOLDER_SIEGE) return null;
  if (tick >= nextStart(cycle)) return null;
  return cycle;
}

/**
 * A saved landing input: the four fields drawn at 0:00, and from legs-plant
 * the far level and the extra dens and chests made for the crew awake then
 * (world.ts), all three or none.
 */
function readLandingInput(raw: unknown): LandingInput | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { seed, size, biome, level, far, extraDens, extraCaches } = raw as Record<string, unknown>;
  const crew = Object.keys(raw).length === 7;
  if ((!crew && Object.keys(raw).length !== 4) || !isInt32(seed)) return null;
  if (!SIZE_CLASSES.includes(size as SizeClass) || !BIOMES.includes(biome as Biome)) return null;
  if (!isInt32(level) || level < 1 || level > 99) return null;
  const input = { seed, size: size as SizeClass, biome: biome as Biome, level };
  if (!crew) return input;
  if (!isInt32(far) || far < level || far > MAX_LEVEL) return null;
  const extra = (n: unknown): n is number => isInt32(n) && n >= 0 && n <= MAX_EXTRA;
  if (!extra(extraDens) || !extra(extraCaches)) return null;
  return { ...input, far, extraDens, extraCaches };
}

/** The cycle as numbers, for the world's hash. */
export const cycleInts = (cycle: Cycle): number[] => [
  cycle.city,
  ...halves(cycle.start),
  cycle.count,
  cycle.landing.seed,
  SIZE_CLASSES.indexOf(cycle.landing.size),
  BIOMES.indexOf(cycle.landing.biome),
  cycle.landing.level,
  ...halves(cycle.broke),
  ...(cycle.landing.far === undefined
    ? []
    : [-1, cycle.landing.far, cycle.landing.extraDens ?? 0, cycle.landing.extraCaches ?? 0]),
];

/** Both 32-bit halves of a whole number that may outgrow 32 bits. */
export const halves = (n: number): number[] => [
  n % 0x1_0000_0000,
  (n - (n % 0x1_0000_0000)) / 0x1_0000_0000,
];
