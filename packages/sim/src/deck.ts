// The city's deck, and the ground the city stands on: the deck alone in
// transit, and a landing with the hull set into it once the legs plant
// (docs/slice.md, section 1). The deck's tiles keep the same world
// coordinates on both, so nobody aboard moves when the ground changes, and a
// place on the deck is in the same spot either way.

import { type Atlas, groundAt } from "./atlas.ts";
import {
  CITIES,
  type CitySize,
  type Edge,
  generateLanding,
  type Landing,
  type LandingInput,
  RAMP_WIDTH,
} from "./landing.ts";
import { type Point, TERRAINS, type Terrain, type TileMap } from "./map.ts";

/**
 * A city size of section 1's growth table, of which the slice builds the
 * first two. The hull's size is the generator's (`CITIES` in landing.ts),
 * which also has its feet and bubble; this adds what only the deck needs.
 */
export interface City {
  /** The hull, in tiles: the deck citizens stand on. */
  readonly width: number;
  readonly height: number;
  /** How many legs it walks on. */
  readonly legs: number;
  /** Its hatches, which citizens come up through, by place name and deck tile. */
  readonly hatches: readonly (Point & { readonly name: string })[];
}

/** The deck's own numbers for section 1's first two cities, by city size. */
const DECKS: Readonly<Record<CitySize, Omit<City, "width" | "height">>> = {
  1: {
    legs: 6,
    hatches: [
      { name: "aft_hatch", x: 2, y: 3 },
      { name: "fore_hatch", x: 10, y: 3 },
    ],
  },
  2: {
    legs: 8,
    hatches: [
      { name: "aft_hatch", x: 2, y: 3 },
      { name: "waist_hatch", x: 7, y: 4 },
      { name: "fore_hatch", x: 12, y: 3 },
    ],
  },
};

/** Citizens the city has berths for (docs/chat.md, section 2), at two to a deck tile. */
export const BERTHS = 150;
export const PER_TILE = 2;

/** The city of size `size`, 1 or 2. The world starts as the first; the works build the second (piece 32). */
export const cityOf = (size: CitySize): City => {
  const [width, height] = CITIES[size].hull;
  return { width, height, ...DECKS[size] };
};

const T = (terrain: Terrain): number => TERRAINS.indexOf(terrain);

const decks = new Map<number, TileMap>();

/**
 * The deck of city `size` as a map: deck tiles with the hatches in them. Its
 * places are the hatches, the `hold` amidships and the `guns` at the bow,
 * which is east. Programs are compiled against these places.
 */
export function deckMap(size: CitySize): TileMap {
  const cached = decks.get(size);
  if (cached) return cached;
  const city = cityOf(size);
  const { width, height } = city;
  const tiles = new Array<number>(width * height).fill(T("deck"));
  for (const hatch of city.hatches) tiles[hatch.y * width + hatch.x] = T("hatch");
  const middle = width >> 1;
  const places = [
    ...city.hatches,
    { name: "hold", x: middle, y: 2 },
    { name: "guns", x: width - 1, y: 2 },
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const map: TileMap = { name: `deck_${size}`, width, height, tiles, places, nodes: [] };
  decks.set(size, map);
  return map;
}

/** The ground of city `size` in transit: its deck at world (0, 0). */
export function deckGround(size: CitySize): Atlas {
  return cached(`deck:${size}`, () => groundAt(deckMap(size), 0, 0));
}

/**
 * Where the deck's top-left tile is on a landing's map. A landing made for
 * the city (`landingFor`) has a footprint the hull's own size, so the deck
 * fills it exactly.
 */
export const deckOnLanding = (landing: Landing): Point => ({
  x: landing.city.x,
  y: landing.city.y,
});

/**
 * The ramp's tiles on a landing's map: RAMP_WIDTH wide, out from the middle
 * of the footprint's side the generator drew, over the two tiles the
 * generator laid for it.
 */
export function rampTiles(landing: Landing): Point[] {
  const { city, rampSide } = landing;
  const half = RAMP_WIDTH >> 1;
  const cx = city.x + (city.width >> 1);
  const cy = city.y + (city.height >> 1);
  const tiles: Point[] = [];
  const along = (side: Edge): [number, number] => {
    if (side === "east") return [city.x + city.width, city.x + city.width + 1];
    if (side === "west") return [city.x - 2, city.x - 1];
    if (side === "south") return [city.y + city.height, city.y + city.height + 1];
    return [city.y - 2, city.y - 1];
  };
  const [from, to] = along(rampSide);
  for (let k = from; k <= to; k++)
    for (let w = -half; w <= half; w++)
      tiles.push(
        rampSide === "east" || rampSide === "west" ? { x: k, y: cy + w } : { x: cx + w, y: k },
      );
  return tiles;
}

/**
 * A landing's map with city `size` standing on it: the deck over the
 * footprint, and the ramp, walkable only once it is down.
 */
function landingMap(size: CitySize, landing: Landing, rampDown: boolean): TileMap {
  const deck = deckMap(size);
  const { city } = landing;
  if (city.width !== deck.width || city.height !== deck.height)
    throw new Error(`landing ${landing.name} was not cut for city ${size}`);
  const tiles = [...landing.tiles];
  for (let dy = 0; dy < deck.height; dy++)
    for (let dx = 0; dx < deck.width; dx++)
      tiles[(city.y + dy) * landing.width + city.x + dx] = deck.tiles[
        dy * deck.width + dx
      ] as number;
  for (const p of rampTiles(landing))
    tiles[p.y * landing.width + p.x] = T(rampDown ? "ramp" : "hull");
  const places = [
    ...landing.places,
    ...deck.places.map((p) => ({ name: p.name, x: city.x + p.x, y: city.y + p.y })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    name: landing.name,
    width: landing.width,
    height: landing.height,
    tiles,
    places,
    nodes: [],
    element: landing.element,
  };
}

/** Every field of a landing's input, for a cache key. */
const inputKey = (input: LandingInput): string =>
  [
    input.seed,
    input.size,
    input.biome,
    input.level,
    input.far ?? "",
    input.extraDens ?? "",
    input.extraCaches ?? "",
  ].join(":");

/** The landing `input` makes, cut for city `size`, made once and kept while it is in use. */
export function landingFor(size: CitySize, input: LandingInput): Landing {
  return cached(`landing:${size}:${inputKey(input)}`, () =>
    generateLanding({ ...input, city: size }),
  );
}

/**
 * The ground of city `size` set down on the landing `input` makes, offset so
 * the deck's tiles are where they are in transit.
 */
export function landingGround(size: CitySize, input: LandingInput, rampDown: boolean): Atlas {
  return cached(`ground:${size}:${inputKey(input)}:${rampDown}`, () => {
    const landing = landingFor(size, input);
    const at = deckOnLanding(landing);
    return groundAt(landingMap(size, landing, rampDown), -at.x, -at.y);
  });
}

/**
 * What the ground functions have made, by key, the newest last. Generating a
 * landing takes a while, and a world in a landing asks for its ground at each
 * restore and each viewer message, so the last few are kept. What is kept is
 * a pure function of its key, so keeping it changes nothing but the time.
 */
const made = new Map<string, unknown>();
const KEEP = 12;

function cached<T>(key: string, make: () => T): T {
  if (made.has(key)) {
    const value = made.get(key) as T;
    made.delete(key);
    made.set(key, value);
    return value;
  }
  const value = make();
  made.set(key, value);
  if (made.size > KEEP) made.delete(made.keys().next().value as string);
  return value;
}
