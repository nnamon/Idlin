// Landings: the ground the walking city parks on (#361, #364), generated from a
// seed, a city size, a size class, a biome, a level and a far level, to
// docs/slice.md, section 1. Integer maths and the seeded generator only, so the
// same input gives the same landing anywhere. It is not part of a world yet:
// nothing here is read by world.ts.
//
// How a landing is made
//
// The layout is a graph first and ground second. Nothing is placed by trying
// a spot and checking it, and nothing is repaired afterwards.
//
// 0. The frame. The map is about 16:9, the shape of the stream's frame. The
//    rim, its outer two rings of tiles, is the biome's barrier and in no block
//    and no district. In the middle is the box of the bubble's footprint of
//    docs/slice.md, section 1: the ground the city's feet stand on (19 by 12
//    for the first city, 21 by 14 for the second) and 2 or 4 tiles round it,
//    with the hull's footprint (13 by 6 or 15 by 6) in its middle and the
//    ramp on whichever side of the hull the seed draws. The yard, the city's
//    district, is that box with its corners rounded on a radius of 3 tiles (a
//    tile is in it when its centre is), which takes one tile off each corner.
//    The strip is every tile within two steps of the yard: open ground in no
//    district, round the whole yard. So the city's ground has the same size
//    and place on every seed. Every size leaves room for a block at least
//    four tiles deep between the box and the rim on all four sides, so there
//    are pockets on every side of the city. This is a fact of the size alone,
//    checked before the first draw, so a size without the room is refused on
//    every seed.
// 1. Blocks. Jittered lines cut the ground inside the rim into blocks of four
//    tiles or more a side, along the edges of the box. The blocks under the
//    box are the city's, which holds the ramp and is the graph's root. Every
//    other block lies in one of the four strips of blocks or a corner between
//    two, so none of the city's blocks touches the rim. The room a block's
//    lanes and things are drawn in is the block less a tile on each side, and
//    on a side it shares with the box less the strip's two tiles instead.
// 2. Districts. The other blocks are counted outward from the city into
//    bands. Each band gets a seed block for every few of its blocks, each
//    seed the block farthest from the seeds before it. Then the districts
//    take turns to add a free block beside one they have, keeping to their
//    band where they can. A district is a connected, irregular group of
//    blocks, and every block ends up in one. The number of districts is a
//    fact of the size: the cuts and the bands depend on lengths only. A
//    district with a block beside the city's is a yard pocket.
// 3. Passages. Districts with blocks side by side are neighbours, where one
//    of those sides has room for a gate: its tiles four steps or more from
//    the yard, its jambs and lane ends three or more, and a lane end three
//    steps out, beside the strip, only a yard pocket's. Only a side between
//    two blocks that both touch the box, and are four deep, has none, and
//    both of those are yard pockets. Each yard pocket's passage to the city
//    is on the spanning tree, and the tree is grown from the city and the
//    yard pockets over the other neighbours (Prim's algorithm, nearer bands
//    first, seeded weights). Where the biome has a river, one branch of the
//    tree away from the yard pockets is its far bank. Where every pocket is
//    a yard pocket there is no such branch and no river, since the strip
//    joins them all: 1 of the 800 wet landings of 52 by 29 and of 56 by 31
//    in landing.test.ts's long sweep, and none of the larger. Of the
//    neighbours left over, the ones that close the longest detours become
//    loop passages: a set share of the districts, of which only one or two
//    may cross the river.
// 4. Skeleton. Each passage gets a gate on a block side its two districts
//    share: tiles two deep and one to three wide, with a wall tile (a jamb)
//    at each end. A yard passage's gate is the strip's two tiles across the
//    side, with no jambs, and its lanes end one tile inside the yard and
//    three tiles out from it. Each district gets lanes, which are
//    4-connected lines: from its centre (the hub of its seed block) from
//    block to block, to its side of every gate, and to each thing it holds.
//    A lane tile has all eight tiles round it in its own district's blocks (a
//    rim tile counts as part of the block inside it), so the lanes of two
//    districts are never nearer than two tiles. Each side of the map gets a
//    gap in the rim, in a block on that side drawn from the best by a score:
//    one whose district has a gap already is worse, and so is one in a corner
//    of the map, on two of its sides. The blocks on a side are all in the
//    strip of blocks or the corners there, so the gap's district is never the
//    city's. Its district lays a lane to the rim's inner face and on straight
//    through it to the map's edge, and the rim tiles beside that lane's last
//    two, within the block, are lane tiles too, so a gap is two deep and
//    three wide where the block allows.
// 5. Ground. A tile's land is the district of the block under it, looked up
//    a few tiles to one side by smooth noise. The shift is nothing beside a
//    lane, a gate or the yard and grows away from them, so borders curve
//    where there is room and stay where the gates are. Then every district
//    is grown from its lanes, a tile at a time, each next to one it has:
//    over its own land first, then over any land its owner could not get to.
//    A tile with another district among the eight round it stays out for
//    good, and so does the rim and the strip. A tile beside the strip is
//    offered only to yard pockets. What stays out inside the rim, but for
//    the strip, is the border between districts, at least one tile thick,
//    also diagonally.
// 6. Barriers. Border tiles become water (the river, where the border has
//    the far bank on one side only), rock beside a crag, dark trees beside
//    an old wood, and the biome's own barrier elsewhere. A passage across
//    the river is a bridge if it is on the tree and a ford if it is a loop,
//    and nothing else crosses it. Where a passage is "open" the border
//    between its two districts is taken out instead, but for any tile beside
//    the strip. An open passage drawn between two pockets is opened only if
//    both keep two sides bounded (below), and is a gap or a pass otherwise.
//    The rim, but for its gaps, becomes the biome's barrier.
// 7. Dressing. Woods and the river are thickened, and cover (groves, ponds,
//    outcrops) is stamped inside districts. Each of these turns walkable
//    tiles into blocked ones, and a tile is turned only if it is in a
//    district, not on a lane and not in the yard, and its walkable
//    4-neighbours stay joined to each other through the eight tiles round
//    it. District kinds are dealt from the biome's deck. Scrap piles, then
//    seams of ore, are shared out by the size of a district, each on the next
//    tile in its district's fixed order with nothing within a tile of it and
//    more than eight tiles from the ramp, and each gets a lane.
// 8. Levels. One walk out of the yard (the city's district), over the
//    dressed ground with the camp closed, orders the pockets: by the walk to
//    their nearest tile, their gate, then to their centre, then the lower
//    number. Of P pockets the kth from 0 is in ring 1 + floor(3k / P), and
//    its level is section 1's: ring 1's step from a third of the landing's
//    level up toward it, ring 2's are at it, ring 3's nearer pockets step up
//    to the far level, 10 levels or less a step where there are pockets
//    enough, and the rest are at the far level. The yard is a third of the
//    level, 5 at most. A gate, an opened border or the strip has the lower
//    level of the districts beside it, which for the strip is the yard's.
// 9. Dens, caches, shrines and wrecks. Each stands on a clear tile: its
//    eight neighbours walkable and in its own pocket, which is room for a
//    guard, nothing standing within a tile of it, and more than eight tiles
//    from the ramp. The size's own dens are aimed first, one at each level of
//    ring 3's pockets from the far level down, each in the pocket with no den
//    whose level is nearest its aim, on its clear tile nearest the yard. Own
//    dens past those levels, and the caller's after its first, are spread:
//    each in the district with the most passages between it and everything
//    stood so far, more of them in the far rings. The caller's first den
//    stands on the clear tile nearest the yard of the first pocket by the
//    walk that has no den. A pocket holds one den at most, so dens asked for
//    past the pockets with room are not stood. The first cache stands in a
//    pocket at the far level (then one with no den, then nearest the yard),
//    and the rest are spread, in pockets without a den while there are any.
//    Shrines, each with a boon drawn from its own stream, then wrecks, are
//    spread to pockets with no den, cache, shrine or wreck while there are
//    any. Then the floors are painted, paths are worn to each den and cache
//    from the ramp, and the dens are lettered A and on by the walk from the
//    ramp. Last, the wall's stations are listed: the tiles two steps' walk
//    outside the yard, in tile order, each more than a tile from every
//    station before it.
//
// Why every walkable tile can be reached from the ramp
//
// - The neighbour graph is connected: the blocks tile the ground inside the
//   rim and each is in a district, so any two districts are joined by a chain
//   of blocks side by side. A side with no room for a gate lies between two
//   yard pockets, which are joined through the city instead, so the
//   neighbours with room are connected too. Prim's algorithm therefore spans
//   every district. The other blocks are one piece, a ring of strips and
//   corners round the city's, so every one of them is grown into from a
//   seed.
// - The skeleton is connected. All of a district's lanes run from its centre,
//   and a gap's tiles are lane tiles. A passage joins the centres of its two
//   districts by lane, gate, lane; a yard passage's gate and the yard tile
//   inside it join its two lane ends. The city's centre is the ramp. So a
//   gap, its lane, and the lanes and gates of the passages on its district's
//   shortest way to the city's are a walk from the map's edge to the ramp,
//   and that walk is the entry's path.
// - After step 5 a walkable tile is in a district, in a gate or in the strip.
//   A district's tile was a lane tile or was added beside a tile already in
//   the district, so by induction it is joined to one of the district's
//   lanes. The yard, the box less a tile at each corner, is all the city's
//   from the start and walkable, so it is joined. A gate's tiles lie between
//   the lane ends of its two districts. The strip is the ring of tiles one
//   and two steps from the yard, each beside a yard tile or beside a strip
//   tile that is, and nothing is ever stood or grown on it.
// - A border tile opened in step 6 has a 4-neighbour in one of its passage's
//   two districts. A rim tile is walkable only if it is in a gap.
// - Step 7 never cuts the ground: if a tile's walkable 4-neighbours are
//   joined through the eight tiles round it, a walk through the tile can go
//   round it instead. It never blocks the strip or the yard, which are in no
//   district or kept.
// - Nothing else changes what is walkable. Shore, path, den floor and deep
//   grass repaint tiles that already were.
// - The same holds with the camp ground taken away, for a monster, which may
//   not stand on it. Every tile of the box but its outermost is a lane tile
//   of the city's. Less the camp, that is a ring round the footprint and the
//   ramp, at least four tiles thick beside the hull and two in front of the
//   ramp: it is joined, and it holds every tile beside camp ground. The
//   yard's outermost tiles and the strip lie round it. The city's lanes
//   leave the ramp onto it and never cross camp again.
//
// Why every pocket is bounded on two sides
//
// docs/art.md, section 8, asks that each pocket be bounded on two sides or
// more by a wood, a crag, the river or the map's edge. A side of a pocket,
// north, east, south or west, is its tiles whose next tile that way is not
// the pocket's, and it is bounded when at least half of those next tiles are
// barrier, the rim, or a gate cut through a barrier. An open border and the
// strip are open. Once the growth has finished, which tiles are a pocket's
// is fixed, and so are the gates, the rim and the strip. Before an open
// passage between two pockets is opened, the tiles it would open are
// counted against both pockets' sides, and it is opened only if each keeps
// two bounded sides; else it is a gap or a pass. Passages are taken in
// order and none is opened and then closed. Nothing later changes these
// counts: the dressing blocks tiles inside a district only, and nothing
// makes a border or a gate walkable or blocked. So no open passage takes a
// pocket under two bounded sides. That a pocket has two before any is
// opened is not proved here. Then the only open tiles beside a pocket are
// the strip's, so a pocket that is not a yard pocket has four bounded sides.
// A yard pocket meets the strip on the side facing the yard, and on a second
// side only where it reaches round a corner of the box, where its outer
// sides face the rim or other pockets' borders. landing.test.ts checks every
// pocket of its sweep.
//
// Why the levels are the finished map's
//
// The pockets are ordered in step 8 by walks over the ground as it stands
// then. Step 9 only stands things on walkable tiles and repaints walkable
// tiles as floors and paths, so after step 8 no tile changes between
// walkable and blocked. The walks, the order, the rings and the levels are
// therefore those of the finished map, and a walk over the output gives
// them again. The dens and caches are stood after the levels for the same
// reason the levels come first: a den is aimed at a level.
//
// Why nothing stands under the legs
//
// The legs' ground reaches three tiles past each end of the hull and three or
// four past each long side. The bubble's footprint is two or four tiles round
// it, so the legs' ground lies inside the box less its outermost tiles, which
// are the city's lane tiles. A lane tile is in the city's district from the
// start and is kept: the growth never gives it to another district, and no
// barrier or obstacle takes it. Dens, caches, shrines, wrecks, piles and
// seams stand only in other districts, and a gap only in a block on the rim.
// So under the legs there is the city's open ground, its camp and its ramp,
// and nothing else.
//
// The graph is also exact. Two districts never touch (step 5). A gate's
// 4-neighbours are its two districts' lane ends, its own tiles and its jambs;
// a yard passage's gate is in the strip. An opened border tile has only its
// passage's two districts among the eight tiles round it, is never beside
// another passage's tile, and is never beside the strip. The strip touches
// the yard and the yard pockets only, each of which has its passage to the
// city across it. A gap's tiles are its own district's, and the rest of the
// rim is barrier. So a walk leaves a district only through one of its
// passages, a walk across the strip is one through the city's passages, and
// the routes in the output are the only routes there are.
//
// Cost: every loop runs over tiles, blocks, districts or passages a fixed
// number of times, and the growth pushes a tile at most four times. Each den,
// cache, shrine and wreck looks over the map's tiles once. No step retries,
// and no loop's length depends on what the seed drew.

import { hashInts, isInt32, show, stringInts } from "./hash.ts";
import { NEIGHBOURS, type Point, TERRAINS, type Terrain, type TileMap } from "./map.ts";
import { createRng, nextU32, type Rng } from "./rng.ts";

export class LandingError extends Error {
  override name = "LandingError";
}

export const SIZE_CLASSES = ["small", "medium", "large"] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];

/** The city sizes the generator has. The slice builds the first two (docs/slice.md, section 1). */
export const CITY_SIZES = [1, 2] as const;
export type CitySize = (typeof CITY_SIZES)[number];

/** A city's ground on a landing, in tiles (docs/slice.md, section 1, "Growth"). */
export interface CitySpec {
  /** The hull's footprint, which the parked city stands over: camp ground. */
  readonly hull: readonly [number, number];
  /** The ground its feet stand on, centred on the hull. */
  readonly feet: readonly [number, number];
  /** How far the bubble's footprint stands clear of the feet, on every side. */
  readonly clear: number;
}
export const CITIES: Readonly<Record<CitySize, CitySpec>> = Object.freeze({
  1: { hull: [13, 6], feet: [19, 12], clear: 2 },
  2: { hull: [15, 6], feet: [21, 14], clear: 4 },
});
/** The bubble's footprint, which is the city's district here: the feet and the clearance round them. */
export const yardOf = (city: CitySpec): readonly [number, number] => [
  city.feet[0] + 2 * city.clear,
  city.feet[1] + 2 * city.clear,
];

/** How a landing of one city size and class is cut. Size is difficulty (docs/slice.md, section 1). */
export interface SizeSpec {
  /** About 16:9, the shape of the stream's frame. */
  readonly width: number;
  readonly height: number;
  /** How many bands of blocks, counted out from the city, each get their own seed blocks. */
  readonly bands: number;
  /** The side a block aims for, in tiles. Districts are made of blocks. */
  readonly block: number;
  /**
   * How many blocks a district aims for. With the blocks these give 9, 9 and
   * 13 pockets on the first city's landings and 18 and 26 on the second's,
   * on every seed: about one for each 140 tiles.
   */
  readonly cell: number;
  /** The widest a gate is cut, in tiles. */
  readonly gate: number;
  /** Loop passages added to the spanning tree, per 100 districts. */
  readonly loops: number;
  /** How many times a wood between districts is thickened. */
  readonly wood: number;
  /** How many times the river is widened, on both banks. */
  readonly river: number;
  /** How far, in tiles, the noise may push a border off the line between two districts. */
  readonly warp: number;
  /** The most loop passages that may ford the river. */
  readonly fords: number;
  /** Radius range of a grove, meadow or pond. */
  readonly blob: readonly [number, number];
}

/**
 * The landings of docs/slice.md, section 1, by city size and class: the first
 * city's three and the second city's small and medium. The second city's
 * large, 96 by 54, waits for #418, since the growth orders 4,096 tiles at
 * most. The blocks, cells, bands, gates and loops are the cuts of the
 * stand-ins in packages/sim/scripts/plate.ts, which give 9, 9, 13, 18 and 26
 * pockets. The dressing is light, so that the pockets keep room for section
 * 1's posts: woods between districts are not thickened (`wood` 0), and cover
 * is patches of radius 1. On 20 landings of 80 by 45, thickened woods and
 * cover of radius 1 to 3 each took 10 to 13 posts at the median.
 */
const sized = (
  width: number,
  height: number,
  cuts: Pick<SizeSpec, "bands" | "block" | "cell" | "gate" | "loops">,
  ground: Pick<SizeSpec, "river" | "warp" | "fords">,
): SizeSpec => ({ width, height, ...cuts, ...ground, wood: 0, blob: [1, 1] });
const cut52 = { bands: 2, block: 4, cell: 5, gate: 2, loops: 34 } as const;
export const SIZES: Readonly<Record<CitySize, Readonly<Partial<Record<SizeClass, SizeSpec>>>>> =
  Object.freeze({
    1: {
      small: sized(52, 29, cut52, { river: 0, warp: 2, fords: 1 }),
      medium: sized(56, 31, cut52, { river: 0, warp: 2, fords: 1 }),
      large: sized(
        60,
        33,
        { bands: 2, block: 5, cell: 3, gate: 2, loops: 30 },
        { river: 1, warp: 3, fords: 1 },
      ),
    },
    2: {
      small: sized(
        68,
        38,
        { bands: 3, block: 5, cell: 3, gate: 2, loops: 30 },
        { river: 1, warp: 3, fords: 1 },
      ),
      medium: sized(
        80,
        45,
        { bands: 3, block: 5, cell: 4, gate: 3, loops: 30 },
        { river: 1, warp: 3, fords: 2 },
      ),
    },
  });

/** The levels the far level stands over the strongest citizen's Arms, by class (docs/slice.md, section 1). */
export const FAR_STEP: Readonly<Record<SizeClass, number>> = Object.freeze({
  small: 7,
  medium: 10,
  large: 15,
});
const nearest = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d));
/** A size's own dens: one for each 700 tiles, to the nearest. */
export const densOf = (spec: SizeSpec): number => nearest(spec.width * spec.height, 700);
/** A size's own caches (the spec's chests): one for each 1,100 tiles, to the nearest, one at least. */
export const cachesOf = (spec: SizeSpec): number =>
  Math.max(1, nearest(spec.width * spec.height, 1_100));

/** The width of the ramp, in tiles. */
export const RAMP_WIDTH = 3;
/** How deep the rim of barrier round the map is, in tiles. */
export const RIM = 2;

/** Nothing a pocket holds stands this many tiles from the ramp or nearer, in a straight line. */
export const RAMP_CLEAR = 8;
/** The highest level the yard may have. */
export const YARD_LEVEL = 5;
/** The radius of a den's floor of den ground. */
const DEN_FLOOR = 2;
export const MAX_LEVEL = 99;
/** The most dens, and the most caches, a caller may add to a size's own. */
export const MAX_EXTRA = 20;

/** What a biome's monsters and ground deal in. */
export const ELEMENTS = ["none", "cold", "lightning", "fire"] as const;
export type Element = (typeof ELEMENTS)[number];

/** The biomes of docs/art.md, section 8. Append only. */
export const BIOMES = ["meadow", "pinewood", "fen", "crags", "ash_waste"] as const;
export type Biome = (typeof BIOMES)[number];

export const EDGES = ["north", "east", "south", "west"] as const;
export type Edge = (typeof EDGES)[number];
/** The step toward each edge, in EDGES order. */
const TOWARD: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The rings, by a district's `ring`: 0 is the city's own, then thirds of the pockets by the walk out of the yard. */
export const RINGS = ["city", "ring 1", "ring 2", "ring 3"] as const;

/** What a district is mostly made of. Append only. */
export const DISTRICT_KINDS = ["city", "meadow", "grove", "mere", "crag", "oldwood"] as const;
export type DistrictKind = (typeof DISTRICT_KINDS)[number];

/**
 * How a passage gets through the border between its districts: no border at
 * all, a gap in a wood, a pass through a ridge, or a ford or bridge over the
 * river. Append only.
 */
export const PASSAGE_KINDS = ["open", "gap", "pass", "ford", "bridge"] as const;
export type PassageKind = (typeof PASSAGE_KINDS)[number];

/** A node of the layout graph: a piece of ground with one way in per passage. */
export interface District extends Point {
  /** Its position in `districts`. The city's, which holds the ramp, is 0 and the root. */
  readonly id: number;
  /**
   * 0 for the city's; else 1 to 3: the kth of P pockets in the order of the
   * walk out of the yard, from 0, is in ring 1 + floor(3k / P).
   */
  readonly ring: number;
  /** Its level, which every tile of it has (docs/slice.md, section 1). */
  readonly level: number;
  /** Tiles from the yard to its nearest tile, its gate, by the walk over the finished ground. */
  readonly gate: number;
  readonly kind: DistrictKind;
  /** The box round the blocks its lanes were laid in. Its ground may spill past it. */
  readonly bounds: Rect;
  /** Passages between it and the city, by the fewest. */
  readonly steps: number;
  /** Tiles from the ramp to its centre along the lanes, by the shortest route. */
  readonly distance: number;
  /** `distance` as a share of the landing's longest, 0 to 1000. */
  readonly depth: number;
  /** The passages that lead out of it, as positions in `passages`. */
  readonly passages: readonly number[];
}

/** An edge of the layout graph: the only way between its two districts. */
export interface Passage extends Point {
  readonly id: number;
  readonly a: number;
  readonly b: number;
  readonly kind: PassageKind;
  /** On the spanning tree; the others are loops. */
  readonly tree: boolean;
  /** The gate: the tiles cut through the border. `x`, `y` is one in its middle. */
  readonly tiles: readonly Point[];
}

/**
 * A gap in the rim where the horde comes in, and the way it knows to the hull.
 * There is one on each side of the map. `x`, `y` is its middle tile on the
 * map's edge, or on a gap two wide the edge tile its lane runs through.
 */
export interface Entry extends Point {
  /** The side of the map it is on. */
  readonly edge: Edge;
  /** The district whose ground it opens into. */
  readonly district: number;
  /** Its tiles: the rim cut through, two deep and up to three wide. */
  readonly gap: readonly Point[];
  /** The districts it crosses, from the entry's to the city's. */
  readonly route: readonly number[];
  /** The passages between them, in order. */
  readonly passages: readonly number[];
  /** Every tile of the way, from the entry to the ramp, each next to the last. */
  readonly path: readonly Point[];
}

/** Something that stands on a tile of its own in a district. */
export interface Stand extends Point {
  readonly district: number;
  /** Its district's ring, 1 to 3. */
  readonly ring: number;
}

/**
 * A den's mouth. It is lettered on the map as `den`, its letter and its level
 * (`den B 28`), and the letter is its name for `!go`.
 */
export interface Den extends Stand {
  /** Its place: `den_a`, `den_b` and so on. */
  readonly name: string;
  /** A for the den with the shortest walk from the ramp, then B and on. */
  readonly letter: string;
  /** Its pocket's level. */
  readonly level: number;
  /** Its elite's level: 5 over the den, and never over the far level. */
  readonly elite: number;
}

/** A cache, the spec's chest, opened by standing work. */
export interface Cache extends Stand {
  /** Its pocket's level: the item level of what it gives. */
  readonly level: number;
}

/** A scrap pile, worked from its tile for salvage. */
export type Pile = Stand;

/** A seam of ore, worked from its tile, with an outcrop beside it. */
export type Seam = Stand;

/** What a shrine gives the citizens near it when it is touched (docs/slice.md, section 1). Append only. */
export const BOONS = ["quick", "keen", "lucky"] as const;
export type Boon = (typeof BOONS)[number];

/** A shrine, with a guard beside it. */
export interface Shrine extends Stand {
  readonly boon: Boon;
}

/** A wreck, worked for ore, with a guard beside it. */
export type Wreck = Stand;

/** Scrap piles: one for each 100 tiles, rounded down. */
export const pilesOf = (spec: SizeSpec): number => Math.floor((spec.width * spec.height) / 100);
/** Seams of ore: one for each 150 tiles, rounded down. */
export const seamsOf = (spec: SizeSpec): number => Math.floor((spec.width * spec.height) / 150);
/** Shrines: one for each 1,800 tiles, to the nearest, one at least. */
export const shrinesOf = (spec: SizeSpec): number =>
  Math.max(1, nearest(spec.width * spec.height, 1_800));
/** Wrecks: one for each 1,800 tiles, rounded down. */
export const wrecksOf = (spec: SizeSpec): number => Math.floor((spec.width * spec.height) / 1_800);

/** How deep the strip round the yard is, in steps: the black stops at its outer edge until the break. */
export const STRIP = 2;
/** The radius the yard's corners are rounded on, in tiles (docs/slice.md, section 1). */
export const YARD_CORNER = 3;

export interface Landing extends TileMap {
  readonly seed: number;
  /** The city size whose hull and feet the city's ground is cut for. */
  readonly citySize: CitySize;
  readonly size: SizeClass;
  readonly biome: Biome;
  /** The biome's element. */
  readonly element: Element;
  /** The landing's level, which the navigator set. */
  readonly level: number;
  /** The far level: the level of ring 3's farthest pockets. */
  readonly far: number;
  /**
   * Each tile's ground level, row by row: its district's level, the lower
   * of its passage's two districts' for a gate or an opened border, the
   * yard's for the strip, and -1 for a border or the rim.
   */
  readonly ground: readonly number[];
  /** The ground under the parked city's hull: `camp`, which monsters cannot stand on. */
  readonly city: Rect;
  /**
   * The ground the parked city's feet stand on, CITIES' `feet` and centred on
   * `city`. All of it is the city's district and walkable.
   */
  readonly legs: Rect;
  /** The foot of the ramp in its middle, also the place `ramp`. */
  readonly ramp: Point;
  /** The side of the footprint the ramp comes out of. */
  readonly rampSide: Edge;
  /** The layout graph's nodes. The city's district is the first, and the root. */
  readonly districts: readonly District[];
  /** The layout graph's edges. */
  readonly passages: readonly Passage[];
  /** The district each tile belongs to, row by row; -1 for a border, a gate or the strip. */
  readonly districtAt: readonly number[];
  readonly entries: readonly Entry[];
  /** The size's own dens first, in the order they were stood, then the caller's. */
  readonly dens: readonly Den[];
  readonly caches: readonly Cache[];
  readonly piles: readonly Pile[];
  readonly seams: readonly Seam[];
  readonly shrines: readonly Shrine[];
  readonly wrecks: readonly Wreck[];
  /**
   * The wall's stations: tiles two steps' walk outside the yard, in tile
   * order, each more than a tile from every station before it. The strip
   * round the yard, every tile within two steps of it, is open ground in no
   * district, at the yard's level.
   */
  readonly stations: readonly Point[];
}

export interface LandingInput {
  readonly seed: number;
  /** The city size, 1 or 2; 1 if left out. */
  readonly city?: CitySize;
  readonly size: SizeClass;
  readonly biome: Biome;
  /** 1 to MAX_LEVEL. */
  readonly level: number;
  /**
   * The far level, from `level` to MAX_LEVEL: the highest Arms awake, or the
   * level if that is higher, plus the class's FAR_STEP. Left out, the level
   * plus FAR_STEP, held at MAX_LEVEL.
   */
  readonly far?: number;
  /** Dens and caches beyond the size's own, as for a larger crew; 0 to MAX_EXTRA each. */
  readonly extraDens?: number;
  readonly extraCaches?: number;
}

const T = (terrain: Terrain): number => TERRAINS.indexOf(terrain);
const GRASS = T("grass");
const PATH = T("path");
const CAMP = T("camp");
const SHORE = T("shore");
const DEEP_GRASS = T("deep_grass");
const DEN = T("den");
const BRIDGE = T("bridge");
const TREE = T("tree");
const DARK_TREE = T("dark_tree");
const WATER = T("water");
const ROCK = T("rock");
/** The walkable terrains, as map.ts has them. */
const WALK = new Set([GRASS, PATH, CAMP, SHORE, DEEP_GRASS, DEN, BRIDGE]);

/** The eight tiles round a tile, clockwise from the north; the even ones are NEIGHBOURS. */
const AROUND: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/** What a biome is made of: its element, its barrier, whether it has a river, its districts. */
interface BiomeSpec {
  readonly element: Element;
  /** The terrain of its borders and its edge, where no crag or old wood says otherwise. */
  readonly wall: number;
  readonly river: boolean;
  /** District kinds dealt to its districts, in this order, round and round. */
  readonly deck: readonly DistrictKind[];
}
const BIOME_SPECS: Readonly<Record<Biome, BiomeSpec>> = {
  meadow: {
    element: "none",
    wall: TREE,
    river: true,
    deck: ["meadow", "grove", "mere", "meadow", "grove", "crag"],
  },
  pinewood: {
    element: "none",
    wall: DARK_TREE,
    river: true,
    deck: ["oldwood", "grove", "crag", "oldwood", "meadow", "mere"],
  },
  fen: {
    element: "cold",
    wall: DARK_TREE,
    river: true,
    deck: ["mere", "meadow", "mere", "oldwood", "mere", "grove"],
  },
  crags: {
    element: "lightning",
    wall: ROCK,
    river: true,
    deck: ["crag", "crag", "meadow", "crag", "mere", "oldwood"],
  },
  ash_waste: {
    element: "fire",
    wall: ROCK,
    river: false,
    deck: ["crag", "oldwood", "meadow", "crag", "oldwood", "meadow"],
  },
};
/** Out of 100 passages into a band, how many have no border at all. */
const OPEN_SHARE = [0, 60, 35, 15];
/** The least a block measures either way: room for a lane with a tile clear on each side. */
const MIN_BLOCK = 4;

/** An integer in [0, bound) from one draw; bound is at most 2^20, so the product is exact. */
const roll = (rng: Rng, bound: number): number =>
  Math.floor((nextU32(rng) * bound) / 0x1_0000_0000);
const between = (rng: Rng, lo: number, hi: number): number => lo + roll(rng, hi - lo + 1);
function shuffle<V>(rng: Rng, list: V[]): V[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = roll(rng, i + 1);
    [list[i], list[j]] = [list[j] as V, list[i] as V];
  }
  return list;
}

/** The tiles of a 4-connected line from one point to another, both included. */
function line(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  const n = dx + dy;
  const out: [number, number][] = [[ax, ay]];
  let x = ax;
  let y = ay;
  for (let i = 1; i <= n; i++) {
    if (Math.floor((i * dx) / n) > Math.floor(((i - 1) * dx) / n)) x += Math.sign(bx - ax);
    else y += Math.sign(by - ay);
    out.push([x, y]);
  }
  return out;
}

/** Smooth noise, 0 to 255 a tile: random values on a coarse lattice, blended between. */
function noise(rng: Rng, width: number, height: number, period: number): number[] {
  const gw = Math.floor(width / period) + 2;
  const gh = Math.floor(height / period) + 2;
  const lattice: number[] = [];
  for (let i = 0; i < gw * gh; i++) lattice.push(roll(rng, 256));
  const field: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = Math.floor(x / period);
      const gy = Math.floor(y / period);
      const fx = x - gx * period;
      const fy = y - gy * period;
      const v = (ox: number, oy: number): number => lattice[(gy + oy) * gw + gx + ox] as number;
      field.push(
        Math.floor(
          (v(0, 0) * (period - fx) * (period - fy) +
            v(1, 0) * fx * (period - fy) +
            v(0, 1) * (period - fx) * fy +
            v(1, 1) * fx * fy) /
            (period * period),
        ),
      );
    }
  }
  return field;
}

/** A rectangle of tiles: x0 and y0 inside, x1 and y1 one past the end. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A side shared by blocks of two districts. `a` is the district on the left or upper side. */
interface Side {
  a: number;
  b: number;
  blockA: number;
  blockB: number;
  /** The shared side runs north to south, so the passage goes west to east. */
  upright: boolean;
  /** The first column (or row) of `b`. */
  at: number;
  /**
   * Where a gate's tiles may go along the side, both included: a tile in from
   * each end, and clear of the strip.
   */
  from: number;
  to: number;
  /** Between the city's district and a yard pocket. */
  yard: boolean;
  weight: number;
}

/** A passage being laid out, with its tiles as indices. */
interface Link {
  side: Side;
  tree: boolean;
  kind: PassageKind;
  gate: number[];
  /** From `a`'s centre to the gate, the gate's middle row, and from `b`'s centre to the gate. */
  laneA: number[];
  row: number[];
  laneB: number[];
}

const FIELDS = new Set([
  "seed",
  "city",
  "size",
  "biome",
  "level",
  "far",
  "extraDens",
  "extraCaches",
]);

/** Reads and checks an input, whatever it is; throws a LandingError for anything wrong. */
function readInput(raw: unknown): {
  seed: number;
  city: CitySize;
  size: SizeClass;
  spec: SizeSpec;
  biome: Biome;
  level: number;
  far: number;
  extraDens: number;
  extraCaches: number;
} {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      throw new LandingError("a landing's input must be an object");
    for (const field of Object.keys(raw)) {
      if (!FIELDS.has(field)) throw new LandingError(`unknown field ${show(field).slice(0, 40)}`);
    }
    const own = (field: string): unknown =>
      Object.hasOwn(raw, field) ? (raw as Record<string, unknown>)[field] : undefined;
    const seed = own("seed");
    if (!isInt32(seed)) throw new LandingError("seed must be a 32-bit whole number");
    const cityValue = own("city") ?? 1;
    const city = CITY_SIZES.find((c) => c === cityValue);
    if (city === undefined) throw new LandingError(`city must be one of ${CITY_SIZES.join(", ")}`);
    const size = SIZE_CLASSES.find((s) => s === own("size"));
    if (size === undefined)
      throw new LandingError(
        `size must be one of ${SIZE_CLASSES.join(", ")}, not ${show(own("size")).slice(0, 40)}`,
      );
    const spec = SIZES[city][size];
    if (spec === undefined) throw new LandingError(`city ${city} has no ${size} landing yet`);
    const biome = BIOMES.find((b) => b === own("biome"));
    if (biome === undefined)
      throw new LandingError(
        `biome must be one of ${BIOMES.join(", ")}, not ${show(own("biome")).slice(0, 40)}`,
      );
    const level = own("level");
    if (!isInt32(level) || level < 1 || level > MAX_LEVEL)
      throw new LandingError(`level must be a whole number from 1 to ${MAX_LEVEL}`);
    const far = own("far") ?? Math.min(MAX_LEVEL, level + FAR_STEP[size]);
    if (!isInt32(far) || far < level || far > MAX_LEVEL)
      throw new LandingError(`far must be a whole number from the level to ${MAX_LEVEL}`);
    const extra = (field: string): number => {
      const value = own(field) ?? 0;
      if (!isInt32(value) || value < 0 || value > MAX_EXTRA)
        throw new LandingError(`${field} must be a whole number from 0 to ${MAX_EXTRA}`);
      return value;
    };
    return {
      seed,
      city,
      size,
      spec,
      biome,
      level,
      far,
      extraDens: extra("extraDens"),
      extraCaches: extra("extraCaches"),
    };
  } catch (error) {
    if (error instanceof LandingError) throw error;
    // Anything else came from reading a value that is not plain data.
    throw new LandingError("a landing's input could not be read");
  }
}

/** A min-heap of whole numbers. */
class Heap {
  private readonly keys: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number): void {
    const keys = this.keys;
    let i = keys.length;
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((keys[parent] as number) <= key) break;
      keys[i] = keys[parent] as number;
      i = parent;
    }
    keys[i] = key;
  }
  pop(): number {
    const keys = this.keys;
    const top = keys[0] as number;
    const last = keys.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && (keys[child + 1] as number) < (keys[child] as number)) child++;
        if ((keys[child] as number) >= last) break;
        keys[i] = keys[child] as number;
        i = child;
      }
      keys[i] = last;
    }
    return top;
  }
}

/**
 * Generates a landing from its input, or throws a LandingError if the input
 * is not one: an unknown size or biome, a level or a count out of range, or a
 * seed that is not a 32-bit whole number.
 */
export function generateLanding(input: unknown): Landing {
  const {
    seed,
    city: citySize,
    size,
    spec,
    biome: biomeName,
    level,
    far: farLevel,
    extraDens,
    extraCaches,
  } = readInput(input);
  const biome = BIOME_SPECS[biomeName];
  const shape = CITIES[citySize];
  const [hullW, hullH] = shape.hull;
  const [feetW, feetH] = shape.feet;
  const [yardW, yardH] = yardOf(shape);
  const W = spec.width;
  const H = spec.height;
  const N = W * H;
  // One stream a stage, so that a change to one stage's draws leaves the others' alone.
  const master = createRng(seed);
  const fork = (): Rng => createRng(nextU32(master) | 0);
  const layoutRng = fork();
  const graphRng = fork();
  const contentRng = fork();
  const shapeRng = fork();
  const boonRng = fork();

  const at = (x: number, y: number): number => y * W + x;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const xOf = (i: number): number => i % W;
  const yOf = (i: number): number => (i - (i % W)) / W;
  const point = (i: number): Point => ({ x: xOf(i), y: yOf(i) });

  const tiles: number[] = new Array(N).fill(GRASS);
  /** The district a tile is in, or -1. */
  const owner: number[] = new Array(N).fill(-1);
  /** The passage whose gate or opened border a tile is, or -1. */
  const label: number[] = new Array(N).fill(-1);
  /** Tiles the growth may not take: gates and their jambs. */
  const fixed: boolean[] = new Array(N).fill(false);
  /** Tiles no barrier or obstacle may take: lanes, gates and the city's apron. */
  const kept: boolean[] = new Array(N).fill(false);
  /** How many tiles in from the map's nearest edge a tile is; under RIM is the rim. */
  const depthOf = (x: number, y: number): number => Math.min(x, y, W - 1 - x, H - 1 - y);
  const rim: boolean[] = Array.from({ length: N }, (_, i) => depthOf(xOf(i), yOf(i)) < RIM);

  // 0. The city's ground in the middle: the bubble's footprint, which holds the
  // legs' ground, the hull in its middle and the ramp on any side. None of it
  // depends on the seed, so neither does the check that each strip between
  // that ground and the rim is a block wide or more, which the sizes are chosen
  // for: a size passes it on every seed or on none.
  const homeX = (W - yardW) >> 1;
  const homeY = (H - yardH) >> 1;
  const home: Box = { x0: homeX, y0: homeY, x1: homeX + yardW, y1: homeY + yardH };
  // The strips on the far sides are as deep as these or a tile deeper.
  if (Math.min(home.x0, home.y0) - RIM < MIN_BLOCK)
    throw new Error(`a ${size} landing has no room for blocks on every side of the city`);
  const city: Rect = {
    x: home.x0 + ((yardW - hullW) >> 1),
    y: home.y0 + ((yardH - hullH) >> 1),
    width: hullW,
    height: hullH,
  };
  const legs: Rect = {
    x: city.x - ((feetW - hullW) >> 1),
    y: city.y - ((feetH - hullH) >> 1),
    width: feetW,
    height: feetH,
  };
  // The legs' ground inside the city's but for its outermost tiles, and room
  // round the hull for the ramp (two tiles), the road round it and a tile
  // more before that outermost one.
  if (
    legs.x <= home.x0 ||
    legs.y <= home.y0 ||
    legs.x + feetW >= home.x1 ||
    legs.y + feetH >= home.y1 ||
    Math.min(city.x - home.x0, city.y - home.y0) < 5 ||
    Math.min(home.x1 - city.x - hullW, home.y1 - city.y - hullH) < 5
  )
    throw new Error(`city ${citySize}'s ground is too narrow for its legs and ramp`);
  // The yard: the box with its corners rounded, a tile in it when its centre
  // is. In half tiles, a centre is within the radius of the nearest point of
  // the box shrunk by the radius.
  const r2 = 2 * YARD_CORNER;
  const yard: boolean[] = Array.from({ length: N }, (_, i) => {
    const [u, v] = [xOf(i) - home.x0, yOf(i) - home.y0];
    if (u < 0 || v < 0 || u >= yardW || v >= yardH) return false;
    const [px, py] = [2 * u + 1, 2 * v + 1];
    const qx = Math.max(r2, Math.min(2 * yardW - r2, px));
    const qy = Math.max(r2, Math.min(2 * yardH - r2, py));
    return (px - qx) ** 2 + (py - qy) ** 2 <= r2 * r2;
  });
  /** Steps from the yard, 4-connected over every tile: the strip is the tiles one and two steps out. */
  const fromYard: number[] = yard.map((y) => (y ? 0 : -1));
  const rings = yard.flatMap((y, i) => (y ? [i] : []));
  for (let head = 0; head < rings.length; head++) {
    const i = rings[head] as number;
    for (const [dx, dy] of NEIGHBOURS) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y) || fromYard[at(x, y)] !== -1) continue;
      fromYard[at(x, y)] = (fromYard[i] as number) + 1;
      rings.push(at(x, y));
    }
  }
  /** The strip: open ground in no district, one and two steps from the yard. */
  const strip: boolean[] = fromYard.map((s) => s >= 1 && s <= STRIP);
  /** Tiles beside the strip, which only a yard pocket may have. */
  const brink: boolean[] = fromYard.map((s) => s === STRIP + 1);
  const rampIndex = roll(layoutRng, 4);
  const rampSide = EDGES[rampIndex] as Edge;
  const [rx, ry] = TOWARD[rampIndex] as [number, number];
  const cx = city.x + (hullW >> 1);
  const cy = city.y + (hullH >> 1);
  const cityRight = city.x + city.width - 1;
  const cityBottom = city.y + city.height - 1;
  // The ramp: RAMP_WIDTH tiles wide and two long, out from the middle of that side.
  const half = RAMP_WIDTH >> 1;
  const rampBase: Rect =
    rx > 0
      ? { x: cityRight + 1, y: cy - half, width: 2, height: RAMP_WIDTH }
      : rx < 0
        ? { x: city.x - 2, y: cy - half, width: 2, height: RAMP_WIDTH }
        : ry > 0
          ? { x: cx - half, y: cityBottom + 1, width: RAMP_WIDTH, height: 2 }
          : { x: cx - half, y: city.y - 2, width: RAMP_WIDTH, height: 2 };
  const ramp: Point =
    rx > 0
      ? { x: cityRight + 2, y: cy }
      : rx < 0
        ? { x: city.x - 2, y: cy }
        : ry > 0
          ? { x: cx, y: cityBottom + 2 }
          : { x: cx, y: city.y - 2 };

  // 1. Blocks, inside the rim, cut along the edges of the city's ground.
  /** Cuts a stretch into blocks near the class's size, none under the least: where each ends. */
  const cut = (from: number, to: number): number[] => {
    const length = to - from;
    if (length === 0) return [];
    const n = Math.max(
      1,
      Math.min(
        Math.floor((length + (spec.block >> 1)) / spec.block),
        Math.floor(length / MIN_BLOCK),
      ),
    );
    const ends: number[] = [];
    let last = 0;
    for (let i = 1; i < n; i++) {
      const lo = last + MIN_BLOCK;
      const hi = length - MIN_BLOCK * (n - i);
      last = Math.max(lo, Math.min(hi, Math.floor((length * i) / n) + between(layoutRng, -1, 1)));
      ends.push(from + last);
    }
    ends.push(to);
    return ends;
  };
  const xs = [RIM, ...cut(RIM, home.x0), ...cut(home.x0, home.x1), ...cut(home.x1, W - RIM)];
  const ys = [RIM, ...cut(RIM, home.y0), ...cut(home.y0, home.y1), ...cut(home.y1, H - RIM)];
  const gw = xs.length - 1;
  const gh = ys.length - 1;
  const B = gw * gh;
  const boxOf = (b: number): Box => ({
    x0: xs[b % gw] as number,
    x1: xs[(b % gw) + 1] as number,
    y0: ys[Math.floor(b / gw)] as number,
    y1: ys[Math.floor(b / gw) + 1] as number,
  });
  const boxes = Array.from({ length: B }, (_, b) => boxOf(b));
  /**
   * The room in a block where its lanes and things go: a tile in from each
   * side, so that a lane's eight neighbours are in the block, and on a side
   * it shares with the box of the city's ground the strip's two tiles
   * instead. So the room of a block four deep beside the box is its one row
   * beside the strip.
   */
  const insets: Box[] = boxes.map((box) => {
    const alongX = box.x0 >= home.x0 && box.x1 <= home.x1;
    const alongY = box.y0 >= home.y0 && box.y1 <= home.y1;
    const trim = (facing: boolean): number => (facing ? STRIP : 1);
    return {
      x0: box.x0 + trim(alongY && box.x0 === home.x1),
      x1: box.x1 - trim(alongY && box.x1 === home.x0),
      y0: box.y0 + trim(alongX && box.y0 === home.y1),
      y1: box.y1 - trim(alongX && box.y1 === home.y0),
    };
  });
  /** Whether a block lies along the rim on a side of the map, by its place in EDGES. */
  const onSide = (b: number, side: number): boolean => {
    const box = boxes[b] as Box;
    return [box.y0 === RIM, box.x1 === W - RIM, box.y1 === H - RIM, box.x0 === RIM][side] === true;
  };
  /** The blocks beside a block, as NEIGHBOURS or as AROUND. */
  const beside = (b: number, steps: readonly (readonly [number, number])[]): number[] => {
    const out: number[] = [];
    for (const [dx, dy] of steps) {
      const [i, j] = [(b % gw) + dx, Math.floor(b / gw) + dy];
      if (i >= 0 && j >= 0 && i < gw && j < gh) out.push(j * gw + i);
    }
    return out;
  };
  /** The district each block belongs to; the city's is 0. */
  const districtOf: number[] = boxes.map((box) =>
    box.x0 >= home.x0 && box.x1 <= home.x1 && box.y0 >= home.y0 && box.y1 <= home.y1 ? 0 : -1,
  );
  const free = districtOf.flatMap((d, b) => (d === -1 ? [b] : []));
  if (free.length === 0) throw new Error(`a ${size} landing has no room for a district`);
  // How far out a block is: blocks from the city, counting diagonals as one.
  const blocksOut: number[] = districtOf.map((d) => (d === 0 ? 0 : -1));
  const ordered = districtOf.flatMap((d, b) => (d === 0 ? [b] : []));
  for (let head = 0; head < ordered.length; head++) {
    const b = ordered[head] as number;
    for (const c of beside(b, AROUND)) {
      if (blocksOut[c] !== -1) continue;
      blocksOut[c] = (blocksOut[b] as number) + 1;
      ordered.push(c);
    }
  }
  const farthest = Math.max(...blocksOut);
  /** The band a block lies in, 1 to the size's count. */
  const band = blocksOut.map((steps) =>
    steps === 0 ? 0 : 1 + Math.floor(((steps - 1) * spec.bands) / farthest),
  );

  // Districts. Each ring gets a seed block for every few of its blocks, each seed
  // the block farthest from the seeds so far. The free blocks are one piece, the
  // strips and corners round the city's, so the growth reaches all of them. Then
  // the districts take turns to add a free block next to one they have, staying
  // in their ring where they can.
  const rank: number[] = new Array(B).fill(0);
  shuffle(
    layoutRng,
    Array.from({ length: B }, (_, b) => b),
  ).forEach((b, n) => {
    rank[b] = n;
  });
  const seeds: number[] = [];
  const bandOf: number[] = [0];
  const blockGap = (p: number, q: number): number =>
    Math.max(Math.abs((p % gw) - (q % gw)), Math.abs(Math.floor(p / gw) - Math.floor(q / gw)));
  const seed1 = (pool: readonly number[], ring: number): void => {
    let best = -1;
    let bestGap = -1;
    for (const b of pool) {
      if (seeds.includes(b)) continue;
      const gap = Math.min(B, ...seeds.map((s) => blockGap(s, b)));
      const better =
        gap > bestGap || (gap === bestGap && (rank[b] as number) < (rank[best] as number));
      if (best === -1 || better) [best, bestGap] = [b, gap];
    }
    if (best === -1) return;
    seeds.push(best);
    bandOf.push(ring);
  };
  for (let k = 1; k <= spec.bands; k++) {
    const pool = free.filter((b) => band[b] === k);
    const wanted = Math.floor((pool.length + (spec.cell >> 1)) / spec.cell);
    for (let n = 0; n < Math.max(1, wanted) && pool.length > 0; n++) seed1(pool, k);
  }
  const count = seeds.length + 1;
  // The growth packs a district into six bits of a heap key, and a tile into twelve.
  if (count > 64) throw new Error("a landing has more districts than its growth can order");
  if (N > 4096) throw new Error("a landing has more tiles than its growth can order");
  const each = Array.from({ length: count }, (_, d) => d);
  /** The block a block was added from; -1 for a seed and for the city's. */
  const parentBlock: number[] = new Array(B).fill(-1);
  const blocksOf: number[][] = each.map((d) => (d === 0 ? [] : [seeds[d - 1] as number]));
  seeds.forEach((b, n) => {
    districtOf[b] = n + 1;
  });
  for (let round = 0, grew = true; grew && round < free.length; round++) {
    grew = false;
    for (let d = 1; d < count; d++) {
      let best = -1;
      let from = -1;
      let bestScore = 0;
      for (const b of blocksOf[d] as number[]) {
        for (const c of beside(b, NEIGHBOURS)) {
          if (districtOf[c] !== -1) continue;
          const score =
            Math.abs((band[c] as number) - (bandOf[d] as number)) * B + (rank[c] as number);
          if (best === -1 || score < bestScore) [best, from, bestScore] = [c, b, score];
        }
      }
      if (best === -1) continue;
      grew = true;
      districtOf[best] = d;
      parentBlock[best] = from;
      (blocksOf[d] as number[]).push(best);
    }
  }
  if (districtOf.includes(-1)) throw new Error("a block of a landing was left to no district");
  /** The yard pockets: districts with a block that shares a side with one of the city's. */
  const yardSide: boolean[] = each.map(() => false);
  for (let b = 0; b < B; b++) {
    if (districtOf[b] === 0) continue;
    if (beside(b, NEIGHBOURS).some((c) => districtOf[c] === 0))
      yardSide[districtOf[b] as number] = true;
  }

  /** The block each tile lies in; a rim tile's is the block inside it. */
  const blockUnder: number[] = [];
  for (let y = 0, j = 0; y < H; y++) {
    if (j < gh - 1 && (ys[j + 1] as number) <= y) j++;
    for (let x = 0, i = 0; x < W; x++) {
      if (i < gw - 1 && (xs[i + 1] as number) <= x) i++;
      blockUnder.push(j * gw + i);
    }
  }
  const blockAt = (x: number, y: number): number => blockUnder[at(x, y)] as number;
  /**
   * Puts a tile in a district before the growth starts. It must lie well inside
   * the district's blocks: every tile round it in a block of the same district.
   * That keeps the lanes of two districts two tiles or more apart.
   */
  const claim = (i: number, district: number): void => {
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (inside(x, y) && districtOf[blockAt(x, y)] !== district)
        throw new Error("a lane leaves its district's blocks");
    }
    if (fixed[i]) throw new Error("a lane crosses a gate");
    if (strip[i]) throw new Error("a lane enters the strip");
    if (brink[i] && !yardSide[district]) throw new Error("a lane reaches the strip off the yard");
    owner[i] = district;
    kept[i] = true;
  };

  // 2. Passages. Every two districts with blocks side by side are neighbours, and
  // one of those sides, drawn by lot, is where a passage between them would go.
  const sideOf = new Map<number, Side>();
  for (let b = 0; b < B; b++) {
    for (const upright of [true, false]) {
      const c = upright ? b + 1 : b + gw;
      if (upright ? b % gw === gw - 1 : c >= B) continue;
      const [da, db] = [districtOf[b] as number, districtOf[c] as number];
      if (da === db) continue;
      const box = boxes[b] as Box;
      const at0 = upright ? box.x1 : box.y1;
      const [lo, hi] = upright ? [box.y0, box.y1] : [box.x0, box.x1];
      const toYard = da === 0 || db === 0;
      // Steps from the yard of the tile `across` tiles over the side, `along` it.
      const near = (across: number, along: number): number =>
        fromYard[upright ? at(at0 + across, along) : at(along, at0 + across)] as number;
      // A yard passage's gate is in the strip. Between two pockets, a gate's
      // tiles are four steps or more from the yard and its lane ends three, so
      // that it never opens onto the strip; its jambs are three or more too.
      // A lane end beside the strip is a yard pocket's, as every lane tile there is.
      const laneEnd = (d: number, steps: number): boolean =>
        steps > (yardSide[d] ? STRIP : STRIP + 1);
      const roomy = (v: number): boolean =>
        near(-1, v) > STRIP + 1 &&
        near(0, v) > STRIP + 1 &&
        laneEnd(da, near(-2, v)) &&
        laneEnd(db, near(1, v));
      const jamb = (v: number): boolean => near(-1, v) > STRIP && near(0, v) > STRIP;
      let [from, to] = [lo + 1, hi - 2];
      if (!toYard) {
        // Near the yard is one end of a side or neither, so what is left is a run.
        while (from <= to && !roomy(from)) from++;
        while (from <= to && !roomy(to)) to--;
        if (from <= to && !jamb(from - 1)) from++;
        if (from <= to && !jamb(to + 1)) to--;
      }
      // No room for a gate: only between two blocks that both touch the box,
      // whose districts are both joined to the city's.
      if (from > to) continue;
      const ring = Math.max(bandOf[da] as number, bandOf[db] as number);
      const side: Side = {
        a: da,
        b: db,
        blockA: b,
        blockB: c,
        upright,
        at: at0,
        from,
        to,
        yard: toYard,
        weight: ring * 0x10_0000 + roll(graphRng, 0x10_0000),
      };
      const key = Math.min(da, db) * count + Math.max(da, db);
      const old = sideOf.get(key);
      if (old === undefined || side.weight < old.weight) sideOf.set(key, side);
    }
  }
  const sides = [...sideOf.values()];
  // The spanning tree. Every yard pocket opens onto the strip, so its passage
  // to the city is on it from the start. Then it is grown outward: always the
  // lightest side that joins a new district, and a nearer ring is always lighter.
  const joined: boolean[] = each.map((d) => d === 0);
  const parent: number[] = each.map(() => -1);
  const treeSteps: number[] = each.map(() => 0);
  const onTree = new Set<Side>();
  for (const side of sides) {
    if (!side.yard) continue;
    const d = side.a === 0 ? side.b : side.a;
    joined[d] = true;
    parent[d] = 0;
    treeSteps[d] = 1;
    onTree.add(side);
  }
  for (let n = 1 + onTree.size; n < count; n++) {
    let best: Side | undefined;
    for (const side of sides) {
      if (joined[side.a] === joined[side.b]) continue;
      if (best === undefined || side.weight < best.weight) best = side;
    }
    if (best === undefined) throw new Error("a landing's districts are not all neighbours");
    const [from, to] = joined[best.a] ? [best.a, best.b] : [best.b, best.a];
    joined[to] = true;
    parent[to] = from;
    treeSteps[to] = (treeSteps[from] as number) + 1;
    onTree.add(best);
  }
  /** Passages between two districts along the tree. */
  const treeDistance = (a: number, b: number): number => {
    let [p, q, steps] = [a, b, 0];
    for (let n = 0; n < 2 * count && p !== q; n++) {
      if ((treeSteps[p] as number) >= (treeSteps[q] as number)) p = parent[p] as number;
      else q = parent[q] as number;
      steps++;
    }
    return steps;
  };
  // The river's far bank: the tree branch nearest a third of the districts that
  // leaves a district on the map's edge on each bank, and holds no yard pocket,
  // so that no walk round the strip gets past the river. The yard pockets hang
  // from the city, so a branch holds one only if it is rooted at one. Without
  // one, no river.
  const below: number[][] = each.map((d) => [d]);
  for (const d of [...each].sort((p, q) => (treeSteps[q] as number) - (treeSteps[p] as number))) {
    if (d !== 0) (below[parent[d] as number] as number[]).push(...(below[d] as number[]));
  }
  const onEdge: boolean[] = each.map(() => false);
  boxes.forEach((_, b) => {
    if (EDGES.some((_, side) => onSide(b, side))) onEdge[districtOf[b] as number] = true;
  });
  const edgeCount = onEdge.filter(Boolean).length;
  const far: boolean[] = each.map(() => false);
  let branch = -1;
  let branchScore = 0;
  for (let d = 1; d < count; d++) {
    if (yardSide[d]) continue;
    const members = below[d] as number[];
    const touching = members.filter((m) => onEdge[m]).length;
    if (touching === 0 || touching === edgeCount) continue;
    const score = Math.abs(3 * members.length - count) * 0x10_0000 + roll(graphRng, 0x10_0000);
    if (branch === -1 || score < branchScore) [branch, branchScore] = [d, score];
  }
  if (biome.river && branch !== -1) for (const m of below[branch] as number[]) far[m] = true;

  // Loops: the spare sides that close the longest way round, first. Only so many
  // may cross the river, so the bridge and the fords stay the ways over it.
  const spare = sides
    .filter((side) => !onTree.has(side))
    .map((side) => ({ side, detour: treeDistance(side.a, side.b) }))
    .sort((p, q) => q.detour - p.detour || p.side.weight - q.side.weight);
  const loopCount = Math.min(spare.length, Math.floor((count * spec.loops + 99) / 100));
  const chosen = [...onTree];
  let fords = 0;
  for (const { side } of spare) {
    if (chosen.length - onTree.size === loopCount) break;
    if (far[side.a] !== far[side.b] && fords++ >= spec.fords) continue;
    chosen.push(side);
  }

  // District kinds, dealt from the biome's deck to the districts in a shuffled order.
  const kinds: DistrictKind[] = each.map(() => "city");
  shuffle(
    contentRng,
    each.filter((d) => d !== 0),
  ).forEach((d, n) => {
    kinds[d] = biome.deck[n % biome.deck.length] as DistrictKind;
  });

  // 3. The skeleton. The city first: its footprint, its ramp and its ground round
  // them, all but the outermost tile, whose neighbours are not all the city's.
  for (let y = home.y0 + 1; y < home.y1 - 1; y++) {
    for (let x = home.x0 + 1; x < home.x1 - 1; x++) claim(at(x, y), 0);
  }
  // The yard's outermost tiles are the city's too, and kept: the strip is
  // between them and every other district's ground.
  for (let i = 0; i < N; i++) {
    if (!yard[i] || owner[i] === 0) continue;
    owner[i] = 0;
    kept[i] = true;
  }
  for (let y = city.y; y <= cityBottom; y++) {
    for (let x = city.x; x <= cityRight; x++) tiles[at(x, y)] = CAMP;
  }
  for (let dy = 0; dy < rampBase.height; dy++) {
    for (let dx = 0; dx < rampBase.width; dx++) tiles[at(rampBase.x + dx, rampBase.y + dy)] = CAMP;
  }
  // A lane out of the city goes from the ramp along the road round the footprint
  // and the ramp, then straight to where it is going.
  const road: Box = {
    x0: Math.min(city.x, rampBase.x) - 1,
    y0: Math.min(city.y, rampBase.y) - 1,
    x1: Math.max(cityRight, rampBase.x + rampBase.width - 1) + 1,
    y1: Math.max(cityBottom, rampBase.y + rampBase.height - 1) + 1,
  };
  const loop: [number, number][] = [];
  for (let x = road.x0; x < road.x1; x++) loop.push([x, road.y0]);
  for (let y = road.y0; y < road.y1; y++) loop.push([road.x1, y]);
  for (let x = road.x1; x > road.x0; x--) loop.push([x, road.y1]);
  for (let y = road.y1; y > road.y0; y--) loop.push([road.x0, y]);
  const onLoop = (x: number, y: number): number => loop.findIndex((p) => p[0] === x && p[1] === y);
  const foot = onLoop(ramp.x + rx, ramp.y + ry);
  const cityLane = (to: number): number[] => {
    let qx = Math.max(road.x0, Math.min(road.x1, xOf(to)));
    let qy = Math.max(road.y0, Math.min(road.y1, yOf(to)));
    if (qx > road.x0 && qx < road.x1 && qy > road.y0 && qy < road.y1) {
      // Inside the road, which only a tile of the apron can be: out by the nearest side.
      const gaps = [qy - road.y0, road.x1 - qx, road.y1 - qy, qx - road.x0];
      const side = gaps.indexOf(Math.min(...gaps));
      if (side === 0) qy = road.y0;
      else if (side === 1) qx = road.x1;
      else if (side === 2) qy = road.y1;
      else qx = road.x0;
    }
    const target = onLoop(qx, qy);
    const ahead = (target - foot + loop.length) % loop.length;
    const step = ahead <= loop.length - ahead ? 1 : loop.length - 1;
    const lane = [at(ramp.x, ramp.y)];
    for (let i = foot, n = 0; n <= loop.length; i = (i + step) % loop.length, n++) {
      const [x, y] = loop[i] as [number, number];
      lane.push(at(x, y));
      if (i === target) break;
    }
    for (const [x, y] of line(qx, qy, xOf(to), yOf(to)).slice(1)) lane.push(at(x, y));
    return lane;
  };

  // Each block of a district has a hub, a tile inside it, and a lane to the hub
  // of the block it was added from, through the side they share. So a district's
  // lanes are a tree over its blocks, and its centre is its seed block's hub.
  const hub: number[] = insets.map((room) =>
    at(between(layoutRng, room.x0, room.x1 - 1), between(layoutRng, room.y0, room.y1 - 1)),
  );
  const tilesOf = (points: [number, number][]): number[] => points.map(([x, y]) => at(x, y));
  /** The lane from the hub of a block's parent to its own. */
  const limb: number[][] = boxes.map((box, b) => {
    const p = parentBlock[b] as number;
    if (p === -1) return [];
    const from = boxes[p] as Box;
    const upright = from.y0 === box.y0;
    // Where it crosses: a tile of the shared side in the room of both blocks,
    // which is never at either end of it or in the strip.
    const [mine, theirs] = [insets[b] as Box, insets[p] as Box];
    const v = upright
      ? between(layoutRng, Math.max(mine.y0, theirs.y0), Math.min(mine.y1, theirs.y1) - 1)
      : between(layoutRng, Math.max(mine.x0, theirs.x0), Math.min(mine.x1, theirs.x1) - 1);
    const lower = upright ? from.x0 < box.x0 : from.y0 < box.y0;
    const edge = upright ? (lower ? box.x0 : from.x0) : lower ? box.y0 : from.y0;
    const [near, farther] = lower ? [edge - 1, edge] : [edge, edge - 1];
    const [px, py] = upright ? [near, v] : [v, near];
    const [qx, qy] = upright ? [farther, v] : [v, farther];
    return [
      ...tilesOf(line(xOf(hub[p] as number), yOf(hub[p] as number), px, py)),
      ...tilesOf(line(qx, qy, xOf(hub[b] as number), yOf(hub[b] as number))),
    ];
  });
  /** The tiles from a district's centre to the hub of one of its blocks. */
  const trunk = (block: number): number[] => {
    const parts: number[][] = [];
    for (let b = block, n = 0; parentBlock[b] !== -1 && n < B; b = parentBlock[b] as number, n++)
      parts.push(limb[b] as number[]);
    const lane = [hub[block] as number];
    if (parts.length === 0) return lane;
    lane.length = 0;
    for (const part of parts.reverse()) lane.push(...(lane.length === 0 ? part : part.slice(1)));
    return lane;
  };
  const centre: number[] = each.map((d) =>
    d === 0 ? at(ramp.x, ramp.y) : (hub[seeds[d - 1] as number] as number),
  );
  /** Lays a lane from a district's centre to a tile in or on one of its blocks, and returns it. */
  const lay = (district: number, block: number, to: number): number[] => {
    const start = hub[block] as number;
    const lane =
      district === 0
        ? cityLane(to)
        : [...trunk(block), ...tilesOf(line(xOf(start), yOf(start), xOf(to), yOf(to))).slice(1)];
    for (const i of lane) claim(i, district);
    return lane;
  };

  // The gates: two tiles deep across the shared side, a jamb at each end. A
  // yard passage's gate is the strip's two tiles across the side, with no
  // jambs: its lanes end on the yard's second tile in and three tiles out.
  const links: Link[] = chosen.map((side, id) => {
    const width = Math.min(spec.gate, side.to - side.from + 1);
    const start = between(graphRng, side.from, side.to + 1 - width);
    /** A tile by its place across the side and along it. */
    const tile = (across: number, along: number): number =>
      side.upright ? at(across, along) : at(along, across);
    // Across the side: the last tile of `a`'s lane, the gate's two, and the
    // first of `b`'s, with the yard's outermost tile on its side for a yard passage.
    const [endA, gateU, endB] = !side.yard
      ? [side.at - 2, [side.at - 1, side.at], side.at + 1]
      : side.a === 0
        ? [side.at - 2, [side.at, side.at + 1], side.at + 2]
        : [side.at - 3, [side.at - 2, side.at - 1], side.at + 1];
    const gate: number[] = [];
    for (let v = start; v < start + width; v++) {
      for (const u of gateU) {
        gate.push(tile(u, v));
        fixed[tile(u, v)] = true;
        label[tile(u, v)] = id;
      }
      claim(tile(endA, v), side.a);
      claim(tile(endB, v), side.b);
      // The approach to the gate is kept as wide as the gate.
      for (let u = endA - 2; u <= endB + 2; u++) {
        const [x, y] = side.upright ? [u, v] : [v, u];
        if (inside(x, y)) kept[at(x, y)] = true;
      }
    }
    if (!side.yard) {
      for (const v of [start - 1, start + width]) {
        for (const u of gateU) fixed[tile(u, v)] = true;
      }
    }
    const mid = start + (width >> 1);
    const crossing = far[side.a] !== far[side.b];
    const tree = onTree.has(side);
    const ring = Math.max(bandOf[side.a] as number, bandOf[side.b] as number);
    const open = side.yard || roll(graphRng, 100) < (OPEN_SHARE[ring] as number);
    const kind: PassageKind = crossing
      ? tree
        ? "bridge"
        : "ford"
      : open
        ? "open"
        : kinds[side.a] === "crag" || kinds[side.b] === "crag"
          ? "pass"
          : "gap";
    const row: number[] = [];
    for (let u = endA + 1; u < endB; u++) row.push(tile(u, mid));
    return {
      side,
      tree,
      kind,
      gate,
      laneA: lay(side.a, side.blockA, tile(endA, mid)),
      row,
      laneB: lay(side.b, side.blockB, tile(endB, mid)),
    };
  });
  const linksOf: number[][] = each.map(() => []);
  links.forEach((link, id) => {
    (linksOf[link.side.a] as number[]).push(id);
    (linksOf[link.side.b] as number[]).push(id);
  });

  // Distances over the graph: fewest passages, and fewest tiles along the lanes.
  const steps: number[] = each.map((d) => (d === 0 ? 0 : -1));
  const queue = [0];
  for (let head = 0; head < queue.length; head++) {
    const d = queue[head] as number;
    for (const id of linksOf[d] as number[]) {
      const { a, b } = (links[id] as Link).side;
      const next = a === d ? b : a;
      if (steps[next] !== -1) continue;
      steps[next] = (steps[d] as number) + 1;
      queue.push(next);
    }
  }
  const distance: number[] = each.map((d) => (d === 0 ? 0 : -1));
  /** The passage a district takes toward the ramp. */
  const homeward: number[] = each.map(() => -1);
  const settled: boolean[] = each.map(() => false);
  for (let n = 0; n < count; n++) {
    let d = -1;
    for (const e of each) {
      if (settled[e] || distance[e] === -1) continue;
      if (d === -1 || (distance[e] as number) < (distance[d] as number)) d = e;
    }
    if (d === -1) break;
    settled[d] = true;
    for (const id of linksOf[d] as number[]) {
      const link = links[id] as Link;
      const next = link.side.a === d ? link.side.b : link.side.a;
      const through =
        (distance[d] as number) + link.laneA.length + link.row.length + link.laneB.length;
      if (distance[next] !== -1 && (distance[next] as number) <= through) continue;
      distance[next] = through;
      homeward[next] = id;
    }
  }
  const longest = Math.max(1, ...distance);
  const depth = distance.map((tilesAway) => Math.floor((tilesAway * 1000) / longest));
  /** Fewest passages between every two districts. */
  const apart: number[][] = each.map((from) => {
    const hops: number[] = each.map((d) => (d === from ? 0 : -1));
    const reachedFrom = [from];
    for (let head = 0; head < reachedFrom.length; head++) {
      const d = reachedFrom[head] as number;
      for (const id of linksOf[d] as number[]) {
        const { a, b } = (links[id] as Link).side;
        const next = a === d ? b : a;
        if (hops[next] !== -1) continue;
        hops[next] = (hops[d] as number) + 1;
        reachedFrom.push(next);
      }
    }
    return hops;
  });

  // Where things stand in a district: the tiles in the room of its blocks, in
  // one fixed order (the blocks shuffled, a tile of each in turn from a drawn
  // start). Each thing takes the first tile in that order that it may have.
  const inner = (b: number): number => {
    const room = insets[b] as Box;
    return (room.x1 - room.x0) * (room.y1 - room.y0);
  };
  const outer = each.filter((d) => d !== 0);
  const order: number[][] = each.map((d) => {
    const blocks = shuffle(contentRng, [...(blocksOf[d] as number[])]);
    const first = blocks.map((b) => roll(contentRng, inner(b)));
    const list: number[] = [];
    for (let turn = 0; turn < Math.max(0, ...blocks.map(inner)); turn++) {
      blocks.forEach((b, n) => {
        if (turn >= inner(b)) return;
        const room = insets[b] as Box;
        const width = room.x1 - room.x0;
        const k = ((first[n] as number) + turn) % inner(b);
        list.push(at(room.x0 + (k % width), room.y0 + Math.floor(k / width)));
      });
    }
    return list;
  });
  const taken: boolean[] = new Array(N).fill(false);
  /** Tiles within a tile of something that stands. */
  const crowded: boolean[] = new Array(N).fill(false);
  const crowd = (i: number): void => {
    taken[i] = true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (inside(xOf(i) + dx, yOf(i) + dy)) crowded[at(xOf(i) + dx, yOf(i) + dy)] = true;
      }
    }
  };
  /** More than RAMP_CLEAR tiles from the ramp, in a straight line. */
  const pastRamp = (i: number): boolean =>
    Math.abs(xOf(i) - ramp.x) + Math.abs(yOf(i) - ramp.y) > RAMP_CLEAR;
  type Spot = { d: number; block: number; i: number };
  const firstFree = (d: number): number =>
    (order[d] as number[]).find((i) => !crowded[i] && pastRamp(i)) ?? -1;
  // Scrap piles, one for each 100 tiles, then seams of ore, one for each 150,
  // each shared out by the number of blocks a district has: each goes to the
  // district with the most blocks for each of its kind it holds.
  const shareOut = (n: number, what: string): Spot[] => {
    const held: number[] = each.map(() => 0);
    const found: Spot[] = [];
    for (let k = 0; k < n; k++) {
      let best = -1;
      for (const d of outer) {
        if (firstFree(d) === -1) continue;
        const share = (d2: number): number =>
          Math.floor(((blocksOf[d2] as number[]).length * 1000) / ((held[d2] as number) + 1));
        if (best === -1 || share(d) > share(best)) best = d;
      }
      if (best === -1) throw new LandingError(`a ${size} landing has no room for its ${what}`);
      held[best] = (held[best] as number) + 1;
      const i = firstFree(best);
      crowd(i);
      found.push({ d: best, block: blockUnder[i] as number, i });
    }
    return found;
  };
  const pileAt = shareOut(pilesOf(spec), "piles");
  const oreAt = shareOut(seamsOf(spec), "seams");
  // What each district grows, by its kind: obstacles of one terrain, and deep
  // grass. A patch needs no tile of its own; it is centred on one of the district's.
  const GROWS: Readonly<Record<DistrictKind, readonly number[]>> = {
    city: [],
    meadow: [DEEP_GRASS, DEEP_GRASS],
    grove: [TREE, TREE, DEEP_GRASS],
    mere: [WATER, DEEP_GRASS, TREE],
    crag: [ROCK, ROCK, DEEP_GRASS],
    oldwood: [DARK_TREE, DARK_TREE, DEEP_GRASS],
  };
  const patches = outer.flatMap((d) =>
    GROWS[kinds[d] as DistrictKind].map((terrain, n) => ({
      d,
      i: (order[d] as number[])[n % (order[d] as number[]).length] as number,
      terrain,
      r: between(contentRng, spec.blob[0], spec.blob[1]),
    })),
  );
  for (const { d, block, i } of [...pileAt, ...oreAt]) lay(d, block, i);

  // The horde's gaps, one on each side, in EDGES order. Each is in a block on
  // that side, scored: one whose district has a gap already is worse, and so is
  // one on two sides. One is drawn from the best-scored there are; nothing is
  // tried and refused. No block of the city's is on a side (step 1).
  const gapped = new Set<number>();
  const entryLanes = EDGES.map((_, side) => {
    const [sx, sy] = TOWARD[side] as [number, number];
    const unfit = (b: number): number =>
      (gapped.has(districtOf[b] as number) ? 2 : 0) +
      (EDGES.filter((_, s) => onSide(b, s)).length > 1 ? 1 : 0);
    const along1 = boxes.flatMap((_, b) => (onSide(b, side) ? [b] : []));
    const least = Math.min(...along1.map(unfit));
    const pool = along1.filter((b) => unfit(b) === least);
    const block = pool[roll(graphRng, pool.length)] as number;
    const d = districtOf[block] as number;
    gapped.add(d);
    const box = boxes[block] as Box;
    // Across from the block's hub, and up to two tiles to either side; a tile in
    // from the ends of the block's side where there is room, so that the gap is
    // three wide.
    const from = hub[block] as number;
    const [lo, hi] = sx !== 0 ? [box.y0 + 1, box.y1 - 2] : [box.x0 + 1, box.x1 - 2];
    const room = hi - lo >= 2 ? 1 : 0;
    const along = Math.max(
      lo + room,
      Math.min(hi - room, (sx !== 0 ? yOf(from) : xOf(from)) + between(graphRng, -2, 2)),
    );
    /** The tile `depth` tiles in from this side's edge, `across` along it. */
    const tile = (depth: number, across: number): number =>
      sx > 0
        ? at(W - 1 - depth, across)
        : sx < 0
          ? at(depth, across)
          : sy > 0
            ? at(across, H - 1 - depth)
            : at(across, depth);
    // A lane to the rim's inner face, and on through the rim, three wide where the block allows.
    const lane = lay(d, block, tile(RIM, along));
    const gap: number[] = [];
    for (let depth = RIM - 1; depth >= 0; depth--) {
      for (const across of [along - 1, along, along + 1]) {
        if (across < lo || across > hi) continue;
        claim(tile(depth, across), d);
        gap.push(tile(depth, across));
      }
      lane.push(tile(depth, along));
    }
    return { side, d, lane, gap };
  });

  // 4. The ground. First whose land each tile is. Unbent, that is the district of
  // the block under it. Smooth noise bends it: a tile looks up the block a few
  // tiles to one side, by an amount that is nothing beside a lane or a gate and
  // grows with the distance from them. So borders are curves where there is
  // room, and stay where the gates are. Then lone tiles are tidied away.
  const rough = noise(shapeRng, W, H, 5);
  const fine = noise(shapeRng, W, H, 3);
  const swayX = noise(shapeRng, W, H, 7);
  const swayY = noise(shapeRng, W, H, 7);
  /** Tiles from the nearest lane or gate, counting diagonals as one. */
  const clear: number[] = owner.map((d, i) => (d !== -1 || fixed[i] ? 0 : -1));
  const wavefront = clear.flatMap((steps, i) => (steps === 0 ? [i] : []));
  for (let head = 0; head < wavefront.length; head++) {
    const i = wavefront[head] as number;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y) || clear[at(x, y)] !== -1) continue;
      clear[at(x, y)] = (clear[i] as number) + 1;
      wavefront.push(at(x, y));
    }
  }
  let land: number[] = owner.map((d, i) => {
    if (d !== -1) return d;
    if (fixed[i] || rim[i] || strip[i]) return -1;
    const most = Math.min(spec.warp, (clear[i] as number) - 1);
    const sway = (field: readonly number[]): number =>
      Math.max(-most, Math.min(most, Math.floor((((field[i] as number) - 128) * most) / 40)));
    const x = Math.max(0, Math.min(W - 1, xOf(i) + sway(swayX)));
    const y = Math.max(0, Math.min(H - 1, yOf(i) + sway(swayY)));
    return districtOf[blockAt(x, y)] as number;
  });
  for (let pass = 0; pass < 2; pass++) {
    land = land.map((d, i) => {
      if (owner[i] !== -1 || fixed[i] || rim[i] || strip[i]) return d;
      // The district most of the nine tiles here belong to, if five or more do.
      const votes: number[] = [];
      for (const [dx, dy] of AROUND) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (inside(x, y) && land[at(x, y)] !== -1) votes.push(land[at(x, y)] as number);
      }
      for (const v of votes) if (v !== d && votes.filter((w) => w === v).length >= 5) return v;
      return d;
    });
  }
  // Then the district itself: grown from its lanes, a tile at a time, each next
  // to one it already has. Its own land comes first, nearest the lanes first;
  // land that its district could not reach that way goes after, to whichever
  // district gets to it. A tile with another district among the eight round it
  // stays out, and is not offered again. The rim and the strip are never
  // offered, and a tile beside the strip is offered only to a yard pocket.
  const heap = new Heap();
  const done: boolean[] = owner.map(
    (d, i) => d !== -1 || (fixed[i] as boolean) || rim[i] === true || strip[i] === true,
  );
  const LATER = 0x1_0000;
  const offer = (i: number): void => {
    const district = owner[i] as number;
    for (const [dx, dy] of NEIGHBOURS) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const j = at(x, y);
      if (done[j] || (brink[j] && !yardSide[district])) continue;
      const order =
        (land[j] === district ? 0 : LATER) + (clear[j] as number) * 256 + (rough[j] as number);
      heap.push((order * 4096 + j) * 64 + district);
    }
  };
  for (let i = 0; i < N; i++) if (owner[i] !== -1) offer(i);
  while (heap.size > 0) {
    const key = heap.pop();
    const district = key % 64;
    const i = ((key - district) / 64) % 4096;
    if (done[i]) continue;
    done[i] = true;
    let alone = true;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const other = owner[at(x, y)] as number;
      if (other !== -1 && other !== district) alone = false;
    }
    if (!alone) continue;
    owner[i] = district;
    offer(i);
  }

  // 5. Barriers. A yard passage's ground is the strip. Where a passage between
  // two pockets is open, the border between its two districts goes: each border
  // tile that touches one of the two and has no third district, no other
  // passage's tile, no border tile with a third district beside it, and is not
  // beside the strip.
  /** The districts among the eight tiles round a tile, lowest first. */
  const around = (i: number): number[] => {
    const found: number[] = [];
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      if (!inside(x, y)) continue;
      const d = owner[at(x, y)] as number;
      if (d !== -1 && !found.includes(d)) found.push(d);
    }
    return found.sort((p, q) => p - q);
  };
  // The sides of each pocket (docs/art.md, section 8): for each of north, east,
  // south and west, how many of its tiles have a next tile that way that is not
  // the pocket's, and how many of those are barrier, rim or a gate. Only the
  // strip is open so far. The tiles are the finished map's from here.
  const sideAll: number[] = new Array(4 * count).fill(0);
  const sideShut: number[] = new Array(4 * count).fill(0);
  for (let j = 0; j < N; j++) {
    const d = owner[j] as number;
    if (d < 1) continue;
    TOWARD.forEach(([dx, dy], k) => {
      const [x, y] = [xOf(j) + dx, yOf(j) + dy];
      if (inside(x, y) && owner[at(x, y)] === d) return;
      sideAll[4 * d + k] = (sideAll[4 * d + k] as number) + 1;
      if (!inside(x, y) || !strip[at(x, y)])
        sideShut[4 * d + k] = (sideShut[4 * d + k] as number) + 1;
    });
  }
  /** Sides of a pocket at least half shut, after `lost` of each side's shut tiles open. */
  const bounded = (d: number, lost: readonly number[]): number =>
    TOWARD.filter(
      (_, k) =>
        2 * ((sideShut[4 * d + k] as number) - (lost[k] as number)) >=
        (sideAll[4 * d + k] as number),
    ).length;
  /** Border tiles with exactly two districts among the eight round them, by the pair. */
  const between2 = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    if (owner[i] !== -1 || label[i] !== -1 || rim[i] || strip[i] || brink[i]) continue;
    const near = around(i);
    if (near.length !== 2) continue;
    const key = (near[0] as number) * count + (near[1] as number);
    const list = between2.get(key);
    if (list === undefined) between2.set(key, [i]);
    else list.push(i);
  }
  // The open passages in order. Each is opened only if both its pockets keep
  // two sides bounded with its border gone; otherwise it is a gap or a pass.
  links.forEach((link, id) => {
    if (link.kind !== "open" || link.side.yard) return;
    const { a, b } = link.side;
    const opening: number[] = [];
    for (const i of between2.get(Math.min(a, b) * count + Math.max(a, b)) ?? []) {
      let touches = false;
      let clear = true;
      for (const [dx, dy] of NEIGHBOURS) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (!inside(x, y)) continue;
        const j = at(x, y);
        if (owner[j] !== -1) touches = true;
        else if (label[j] !== -1) clear &&= label[j] === id;
        else clear &&= around(j).every((d) => d === a || d === b);
      }
      if (touches && clear) opening.push(i);
    }
    // What each of the two would lose, side by side: the tiles whose next tile
    // that way is one this opens, or the passage's own gate, which is open
    // ground once the border round it goes.
    const lostA = [0, 0, 0, 0];
    const lostB = [0, 0, 0, 0];
    for (const i of [...opening, ...link.gate]) {
      TOWARD.forEach(([dx, dy], k) => {
        const [x, y] = [xOf(i) - dx, yOf(i) - dy];
        if (!inside(x, y)) return;
        const d = owner[at(x, y)];
        if (d === a) lostA[k] = (lostA[k] as number) + 1;
        else if (d === b) lostB[k] = (lostB[k] as number) + 1;
      });
    }
    if (bounded(a, lostA) < 2 || bounded(b, lostB) < 2) {
      link.kind = kinds[a] === "crag" || kinds[b] === "crag" ? "pass" : "gap";
      return;
    }
    for (const i of opening) label[i] = id;
    for (let k = 0; k < 4; k++) {
      sideShut[4 * a + k] = (sideShut[4 * a + k] as number) - (lostA[k] as number);
      sideShut[4 * b + k] = (sideShut[4 * b + k] as number) - (lostB[k] as number);
    }
  });
  links.forEach((link, id) => {
    const terrain = link.kind === "bridge" ? BRIDGE : link.kind === "ford" ? SHORE : GRASS;
    for (const i of link.gate) tiles[i] = terrain;
    if (link.kind === "open") for (let i = 0; i < N; i++) if (label[i] === id) tiles[i] = GRASS;
  });
  // The rest of the border is the river between its two banks, a ridge beside a crag,
  // and a wood anywhere else. `grows` is how many more times a barrier thickens.
  // The rim, but for its gaps, is the biome's barrier and does not thicken.
  for (let i = 0; i < N; i++) if (rim[i] && owner[i] === -1) tiles[i] = biome.wall;
  const grows: number[] = new Array(N).fill(0);
  const border: number[] = [];
  /** The river's banks among a border tile's districts: 1 the far one, 2 the near one, 3 both. */
  const banks: number[] = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    if (owner[i] !== -1 || label[i] !== -1 || rim[i] || strip[i]) continue;
    border.push(i);
    for (const d of around(i)) banks[i] = (banks[i] as number) | (far[d] ? 1 : 2);
  }
  for (const i of border) {
    const near = around(i);
    // Water where the two banks meet: in one tile, or in two side by side where
    // the border is two tiles thick and each sees one bank only.
    const wet =
      banks[i] === 3 ||
      (banks[i] !== 0 &&
        AROUND.some(([dx, dy]) => {
          const [x, y] = [xOf(i) + dx, yOf(i) + dy];
          return inside(x, y) && ((banks[at(x, y)] as number) | (banks[i] as number)) === 3;
        }));
    if (near.length === 0) {
      tiles[i] = -1;
    } else if (wet) {
      tiles[i] = WATER;
      grows[i] = spec.river;
    } else if (near.some((d) => kinds[d] === "crag")) {
      tiles[i] = ROCK;
    } else {
      // Dark trees beside an old wood; else the biome's own barrier.
      tiles[i] = near.some((d) => kinds[d] === "oldwood") ? DARK_TREE : biome.wall;
      grows[i] = spec.wood;
    }
  }
  // A border tile with no district beside it takes after the border next to it.
  for (const i of border) {
    if (tiles[i] !== -1) continue;
    tiles[i] = TREE;
    for (const [dx, dy] of AROUND) {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      const j = at(x, y);
      if (!inside(x, y) || owner[j] !== -1 || label[j] !== -1 || strip[j]) continue;
      const beside = tiles[j] as number;
      if (beside === -1) continue;
      tiles[i] = beside;
      grows[i] = grows[j] as number;
      break;
    }
  }

  // 6. Dressing. From here a tile changes from walkable to blocked only through
  // `block`, which refuses a tile whose walkable neighbours would lose each other.
  const walkable = (x: number, y: number): boolean =>
    inside(x, y) && WALK.has(tiles[at(x, y)] as number);
  /**
   * True if a walk through this tile can go round it instead: all its walkable
   * 4-neighbours lie in one unbroken run of walkable tiles among the eight
   * round it. Blocking such a tile cannot cut the ground in two.
   */
  const spare8 = (i: number): boolean => {
    const open = AROUND.map(([dx, dy]) => walkable(xOf(i) + dx, yOf(i) + dy));
    let runs = 0;
    for (let k = 0; k < 8; k++) {
      // A run of walkable tiles starts here, and holds a 4-neighbour.
      if (!open[k] || open[(k + 7) % 8]) continue;
      for (let n = k; open[n % 8] && n < k + 8; n++) {
        if (n % 2 === 0) {
          runs++;
          break;
        }
      }
    }
    return runs <= 1;
  };
  const block = (i: number, terrain: number, district = owner[i] as number): boolean => {
    if (kept[i] || owner[i] === -1 || owner[i] !== district) return false;
    if (!WALK.has(tiles[i] as number) || !spare8(i)) return false;
    tiles[i] = terrain;
    return true;
  };
  /** The tiles of a lumpy round patch, nearest its middle first. */
  const patch = (i: number, r: number): number[] => {
    const found: [number, number][] = [];
    for (let dy = -r - 1; dy <= r + 1; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (!inside(x, y)) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 * 256 <= r * r * (150 + (fine[at(x, y)] as number))) found.push([d2, at(x, y)]);
      }
    }
    return found.sort((p, q) => p[0] - q[0] || p[1] - q[1]).map((f) => f[1]);
  };
  /** The step from a tile away from its district's centre, one of NEIGHBOURS. */
  const outward = (i: number, district: number): [number, number] => {
    const from = centre[district] as number;
    const [dx, dy] = [xOf(i) - xOf(from), yOf(i) - yOf(from)];
    if (dx === 0 && dy === 0) return [1, 0];
    return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
  };

  // Piles and seams: the tile one is worked from, with an outcrop of rock beside it.
  for (const { d, i } of [...pileAt, ...oreAt]) {
    const [ox, oy] = outward(i, d);
    if (inside(xOf(i) + ox, yOf(i) + oy)) block(at(xOf(i) + ox, yOf(i) + oy), ROCK, d);
  }

  // Cover: groves, ponds, outcrops and deep grass.
  for (const { d, terrain, i, r } of patches) {
    if (terrain === DEEP_GRASS) {
      for (const j of patch(i, r + 1))
        if (owner[j] !== -1 && tiles[j] === GRASS) tiles[j] = terrain;
      continue;
    }
    for (const j of patch(i, terrain === ROCK ? Math.min(r, 2) : r)) block(j, terrain, d);
  }

  // Thickening: a barrier takes the ground next to it, where the noise allows.
  const KEEP: Readonly<Record<number, number>> = {
    [TREE]: 150,
    [DARK_TREE]: 160,
    [WATER]: 170,
    [ROCK]: 120,
  };
  for (let pass = Math.max(spec.wood, spec.river, 1); pass > 0; pass--) {
    const taking: [number, number, number][] = [];
    for (let i = 0; i < N; i++) {
      if (kept[i] || owner[i] === -1 || !WALK.has(tiles[i] as number)) continue;
      let from = -1;
      for (const [dx, dy] of NEIGHBOURS) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (!inside(x, y)) continue;
        const j = at(x, y);
        if ((grows[j] as number) > (from === -1 ? 0 : (grows[from] as number))) from = j;
      }
      if (from === -1) continue;
      const terrain = tiles[from] as number;
      if ((rough[i] as number) < (KEEP[terrain] ?? 0))
        taking.push([i, terrain, grows[from] as number]);
    }
    for (const [i, terrain, left] of taking) if (block(i, terrain)) grows[i] = left - 1;
  }

  // Shores round open water.
  for (let i = 0; i < N; i++) {
    if (tiles[i] !== GRASS && tiles[i] !== DEEP_GRASS) continue;
    if (
      NEIGHBOURS.some(
        ([dx, dy]) =>
          inside(xOf(i) + dx, yOf(i) + dy) && tiles[at(xOf(i) + dx, yOf(i) + dy)] === WATER,
      )
    )
      tiles[i] = SHORE;
  }

  // 8. Levels (docs/slice.md, section 1, "Level and ground"). The walk out of
  // the yard, over the dressed ground with the camp closed, as a monster walks.
  /** Steps from the nearest of some tiles, 4-connected over walkable ground off the camp; -1 off it. */
  const walkFrom = (starts: readonly number[]): number[] => {
    const steps: number[] = new Array(N).fill(-1);
    for (const s of starts) steps[s] = 0;
    const queue = [...starts];
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head] as number;
      for (const [dx, dy] of NEIGHBOURS) {
        const [x, y] = [xOf(i) + dx, yOf(i) + dy];
        if (!inside(x, y)) continue;
        const j = at(x, y);
        if (steps[j] !== -1 || tiles[j] === CAMP || !WALK.has(tiles[j] as number)) continue;
        steps[j] = (steps[i] as number) + 1;
        queue.push(j);
      }
    }
    return steps;
  };
  const out = walkFrom(
    owner.flatMap((d, i) =>
      d === 0 && tiles[i] !== CAMP && WALK.has(tiles[i] as number) ? [i] : [],
    ),
  );
  /** Steps out of the yard to each district's nearest tile, its gate. */
  const gateWalk: number[] = each.map((d) => (d === 0 ? 0 : -1));
  for (let i = 0; i < N; i++) {
    const d = owner[i] as number;
    const steps = out[i] as number;
    if (d < 1 || steps === -1) continue;
    if (gateWalk[d] === -1 || steps < (gateWalk[d] as number)) gateWalk[d] = steps;
  }
  // The pockets by the walk to their gate, then to their centre, then number.
  const byWalk = [...outer].sort(
    (p, q) =>
      (gateWalk[p] as number) - (gateWalk[q] as number) ||
      (out[centre[p] as number] as number) - (out[centre[q] as number] as number) ||
      p - q,
  );
  const ring: number[] = each.map(() => 0);
  byWalk.forEach((d, k) => {
    ring[d] = 1 + Math.floor((3 * k) / byWalk.length);
  });
  const inRing = (r: number): number[] => byWalk.filter((d) => ring[d] === r);
  const third = Math.max(1, Math.floor(level / 3));
  const levelOf: number[] = each.map((d) => (d === 0 ? Math.min(YARD_LEVEL, third) : level));
  inRing(1).forEach((d, k, list) => {
    levelOf[d] = third + Math.floor(((level - third) * k) / list.length);
  });
  // Ring 3's nearer pockets step up to the far level: half of them, rounded
  // up, or enough that no step is over 10 levels, as far as it has pockets.
  const farthest3 = inRing(3);
  const climb = Math.min(
    farthest3.length,
    Math.max((farthest3.length + 1) >> 1, Math.floor((farLevel - level + 9) / 10)),
  );
  farthest3.forEach((d, k) => {
    levelOf[d] = k < climb ? level + Math.floor(((farLevel - level) * (k + 1)) / climb) : farLevel;
  });
  const ground: number[] = owner.map((d, i) => {
    if (d !== -1) return levelOf[d] as number;
    // The strip lies between the yard and its pockets, which are all over it.
    if (strip[i]) return levelOf[0] as number;
    const id = label[i] as number;
    if (id === -1) return -1;
    const { a, b } = (links[id] as Link).side;
    return Math.min(levelOf[a] as number, levelOf[b] as number);
  });

  // 9. Dens, caches, shrines and wrecks, each on a clear tile: its eight
  // neighbours walkable ground of its own pocket, where its guard stands,
  // nothing standing within a tile of it, and more than RAMP_CLEAR tiles from
  // the ramp in a straight line.
  const fits = (i: number): boolean => {
    const d = owner[i] as number;
    if (d < 1 || crowded[i] || !WALK.has(tiles[i] as number) || !pastRamp(i)) return false;
    return AROUND.every(([dx, dy]) => {
      const [x, y] = [xOf(i) + dx, yOf(i) + dy];
      return inside(x, y) && owner[at(x, y)] === d && WALK.has(tiles[at(x, y)] as number);
    });
  };
  const picked = [0];
  const put = (i: number): Spot => {
    const d = owner[i] as number;
    crowd(i);
    picked.push(d);
    return { d, block: blockUnder[i] as number, i };
  };
  /** The clear tile with the least key among those `allowed`, or -1. Keys are unique. */
  const least = (allowed: (i: number) => boolean, key: (i: number) => number): number => {
    let best = -1;
    let bestKey = 0;
    for (let i = 0; i < N; i++) {
      if (!fits(i) || !allowed(i)) continue;
      const k = key(i);
      if (best === -1 || k < bestKey) [best, bestKey] = [i, k];
    }
    return best;
  };
  const pocketOf = (i: number): number => owner[i] as number;
  const walkOut = (i: number): number => out[i] as number;
  // A district's slots, then the rest of its ground in tile order, since its
  // ground spills past the blocks its slots are in. A slot can also be another
  // district's ground now, where a border bent across its block, so a slot
  // counts only while it is the district's own.
  const slots: number[][] = order.map((list) => [...list]);
  const slotted = new Set(order.flat());
  owner.forEach((d, i) => {
    if (d > 0 && !slotted.has(i)) (slots[d] as number[]).push(i);
  });
  const nextFit = (d: number): number =>
    (slots[d] as number[]).find((i) => owner[i] === d && fits(i)) ?? -1;
  /**
   * Stands things that should be far from the ramp and from each other: the
   * kth in the district with the most passages between it and everything
   * stood so far, then the deepest, among those `unfit` likes best. Never in
   * the city's, in a district of `avoid`, which gains each district used, or
   * in a district with no clear tile left; it stops when there is none.
   */
  const spread = (
    from: number,
    n: number,
    unfit: (k: number, d: number) => number,
    avoid: Set<number> | null,
  ): Spot[] => {
    const found: Spot[] = [];
    for (let k = from; k < from + n; k++) {
      const open = outer.filter((d) => !avoid?.has(d) && nextFit(d) !== -1);
      if (open.length === 0) break;
      const fewest = Math.min(...open.map((d) => unfit(k, d)));
      const pool = open.filter((d) => unfit(k, d) === fewest);
      const fresh = pool.filter((d) => !picked.includes(d));
      let best = -1;
      let bestGap = -1;
      for (const d of fresh.length > 0 ? fresh : pool) {
        const gap = Math.min(...picked.map((p) => (apart[p] as number[])[d] as number));
        const better =
          gap > bestGap || (gap === bestGap && (depth[d] as number) > (depth[best] as number));
        if (best === -1 || better) [best, bestGap] = [d, gap];
      }
      found.push(put(nextFit(best)));
      avoid?.add(best);
    }
    return found;
  };
  // Spread dens go first to ring 3, then ring 2, and so on round this order,
  // so the far ground has most and the near ground one in five. Spread caches
  // go the same way, in districts without a den while there are any.
  const RING_TURN = [3, 2, 3, 2, 1];
  /** 0 for a district in the ring whose turn it is, 2 for any other. */
  const turn = (k: number, d: number): number =>
    ring[d] === RING_TURN[k % RING_TURN.length] ? 0 : 2;

  // The size's own dens, aimed at ring 3's levels from the far level down, one
  // a level: each in the pocket with no den whose level is nearest its aim, on
  // its clear tile nearest the yard (then the lower tile number).
  const ownDens = densOf(spec);
  const denned = new Set<number>();
  const denAt: Spot[] = [];
  const aims = [...new Set(farthest3.map((d) => levelOf[d] as number))].sort((p, q) => q - p);
  for (const aim of aims.slice(0, ownDens)) {
    const i = least(
      (j) => !denned.has(pocketOf(j)),
      (j) => (Math.abs((levelOf[pocketOf(j)] as number) - aim) * N + walkOut(j)) * N + j,
    );
    if (i === -1) break;
    denned.add(pocketOf(i));
    denAt.push(put(i));
  }
  denAt.push(...spread(denAt.length, ownDens - denAt.length, turn, denned));
  // The first den the caller adds: in the first pocket by the walk that has no
  // den and a clear tile, on its clear tile nearest the yard.
  const nearPocket =
    extraDens > 0 ? byWalk.find((d) => !denned.has(d) && nextFit(d) !== -1) : undefined;
  if (nearPocket !== undefined) {
    denned.add(nearPocket);
    denAt.push(
      put(
        least(
          (j) => pocketOf(j) === nearPocket,
          (j) => walkOut(j) * N + j,
        ),
      ),
    );
  }
  denAt.push(...spread(denAt.length, ownDens + extraDens - denAt.length, turn, denned));
  // The first cache: in a pocket at the far level, or the nearest to it, then
  // one with no den, then on the tile nearest the yard.
  const cacheAt: Spot[] = [];
  const farCache = least(
    () => true,
    (j) =>
      ((Math.abs((levelOf[pocketOf(j)] as number) - farLevel) * 2 +
        (denned.has(pocketOf(j)) ? 1 : 0)) *
        N +
        walkOut(j)) *
        N +
      j,
  );
  if (farCache !== -1) cacheAt.push(put(farCache));
  cacheAt.push(
    ...spread(
      cacheAt.length,
      cachesOf(spec) + extraCaches - cacheAt.length,
      (k, d) => turn(k, d) + (denned.has(d) ? 1 : 0),
      null,
    ),
  );
  // Shrines, then wrecks, spread like the rest, each in a pocket with no den,
  // cache, shrine or wreck while there is one with a clear tile.
  const sited = (k: number, d: number): number => turn(k, d) + (picked.includes(d) ? 4 : 0);
  const shrineAt = spread(0, shrinesOf(spec), sited, null);
  const wreckAt = spread(shrineAt.length, wrecksOf(spec), sited, null);

  // Their floors: a cache on a square of path, a den on a round floor of den
  // ground. Neither blocks a tile, so nothing turns walkable ground into
  // blocked after the walk out of the yard (see "Why the levels are the
  // finished map's" at the top).
  for (const { d, i } of cacheAt) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (!inside(xOf(i) + dx, yOf(i) + dy)) continue;
        const j = at(xOf(i) + dx, yOf(i) + dy);
        if (owner[j] === d && tiles[j] === GRASS) tiles[j] = PATH;
      }
    }
  }
  for (const { d, i } of denAt) {
    for (const j of patch(i, DEN_FLOOR)) {
      if (owner[j] === d && (tiles[j] === GRASS || tiles[j] === PATH)) tiles[j] = DEN;
    }
    tiles[i] = DEN;
  }

  // Worn paths from the ramp to each den and cache, along the walk from the
  // ramp: from each, the lowest-numbered tile a step nearer, to the ramp.
  const fromRamp = walkFrom([at(ramp.x, ramp.y)]);
  for (const { i } of [...denAt, ...cacheAt]) {
    for (let j = i, n = 0; j !== -1 && (fromRamp[j] as number) > 0 && n < N; n++) {
      if (tiles[j] === GRASS || tiles[j] === DEEP_GRASS || tiles[j] === SHORE) tiles[j] = PATH;
      let back = -1;
      for (const [dx, dy] of NEIGHBOURS) {
        const [x, y] = [xOf(j) + dx, yOf(j) + dy];
        if (!inside(x, y) || fromRamp[at(x, y)] !== (fromRamp[j] as number) - 1) continue;
        if (back === -1 || at(x, y) < back) back = at(x, y);
      }
      j = back;
    }
  }
  /** The tiles from a district's centre to the ramp, and the districts and passages on the way. */
  const wayHome = (from: number): { path: number[]; route: number[]; through: number[] } => {
    const path: number[] = [];
    const route = [from];
    const through: number[] = [];
    for (let d = from, n = 0; d !== 0 && n < count; n++) {
      const id = homeward[d] as number;
      const link = links[id] as Link;
      const forward = link.side.a === d;
      path.push(
        ...(forward ? link.laneA : link.laneB),
        ...(forward ? link.row : [...link.row].reverse()),
        ...[...(forward ? link.laneB : link.laneA)].reverse(),
      );
      d = forward ? link.side.b : link.side.a;
      route.push(d);
      through.push(id);
    }
    // Where two lanes meet at a centre the tile is listed once.
    return { path: path.filter((i, n) => n === 0 || i !== path[n - 1]), route, through };
  };

  // Letters: A for the den with the shortest walk from the ramp, then B and
  // on (then the lower tile number).
  const letters: string[] = denAt.map(() => "");
  denAt
    .map((_, n) => n)
    .sort(
      (p, q) =>
        (fromRamp[(denAt[p] as Spot).i] as number) - (fromRamp[(denAt[q] as Spot).i] as number) ||
        (denAt[p] as Spot).i - (denAt[q] as Spot).i,
    )
    .forEach((n, k) => {
      letters[n] = String.fromCharCode(65 + k);
    });
  const dens: Den[] = denAt.map(({ d, i }, n) => ({
    name: `den_${(letters[n] as string).toLowerCase()}`,
    letter: letters[n] as string,
    ...point(i),
    district: d,
    ring: ring[d] as number,
    level: levelOf[d] as number,
    elite: Math.min(farLevel, (levelOf[d] as number) + 5),
  }));
  const caches: Cache[] = cacheAt.map(({ d, i }) => ({
    ...point(i),
    district: d,
    ring: ring[d] as number,
    level: levelOf[d] as number,
  }));
  const standing = ({ d, i }: Spot): Stand => ({
    ...point(i),
    district: d,
    ring: ring[d] as number,
  });
  const piles: Pile[] = pileAt.map(standing);
  const seams: Seam[] = oreAt.map(standing);
  const shrines: Shrine[] = shrineAt.map((spot) => ({
    ...standing(spot),
    boon: BOONS[roll(boonRng, BOONS.length)] as Boon,
  }));
  const wrecks: Wreck[] = wreckAt.map(standing);
  // The wall's stations: two steps' walk outside the yard, in tile order, each
  // more than a tile from every station before it. The strip is open ground,
  // so these are its outer tiles.
  const fromYardWalk = walkFrom(owner.flatMap((d, i) => (d === 0 ? [i] : [])));
  const stations: number[] = [];
  for (let i = 0; i < N; i++) {
    if (fromYardWalk[i] !== STRIP) continue;
    const far1 = (s: number): boolean =>
      Math.max(Math.abs(xOf(s) - xOf(i)), Math.abs(yOf(s) - yOf(i))) > 1;
    if (stations.every(far1)) stations.push(i);
  }

  const entries: Entry[] = entryLanes.map(({ side, d, lane, gap }) => {
    const way = wayHome(d);
    // The gap's lane ends at its district's centre, where the way home starts.
    const inward = [...lane].reverse();
    return {
      ...point(inward[0] as number),
      edge: EDGES[side] as Edge,
      district: d,
      gap: gap.map(point),
      route: way.route,
      passages: way.through,
      path: [...inward, ...way.path.slice(1)].map(point),
    };
  });

  const toRect = (b: Box): Rect => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 });
  const districts: District[] = each.map((d) => ({
    id: d,
    ...point(centre[d] as number),
    ring: ring[d] as number,
    level: levelOf[d] as number,
    gate: gateWalk[d] as number,
    kind: kinds[d] as DistrictKind,
    bounds: toRect(
      d === 0
        ? home
        : (blocksOf[d] as number[])
            .map((b) => boxes[b] as Box)
            .reduce((all, box) => ({
              x0: Math.min(all.x0, box.x0),
              y0: Math.min(all.y0, box.y0),
              x1: Math.max(all.x1, box.x1),
              y1: Math.max(all.y1, box.y1),
            })),
    ),
    steps: steps[d] as number,
    distance: distance[d] as number,
    depth: depth[d] as number,
    passages: linksOf[d] as number[],
  }));
  const passages: Passage[] = links.map((link, id) => ({
    id,
    // The middle row's first gate tile: a yard passage's row starts in the yard.
    ...point(link.row.find((i) => link.gate.includes(i)) as number),
    a: link.side.a,
    b: link.side.b,
    kind: link.kind,
    tree: link.tree,
    tiles: link.gate.map(point),
  }));

  const places = [
    { name: "ramp", x: ramp.x, y: ramp.y },
    { name: "city", x: cx, y: cy },
    ...dens.map((d) => ({ name: d.name, x: d.x, y: d.y })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    name: `city${citySize}_${size}_${biomeName}_${seed >>> 0}`,
    width: W,
    height: H,
    tiles,
    places,
    seed,
    citySize,
    size,
    biome: biomeName,
    element: biome.element,
    level,
    far: farLevel,
    ground,
    city,
    legs,
    ramp,
    rampSide,
    districts,
    passages,
    districtAt: owner,
    entries,
    dens,
    caches,
    piles,
    seams,
    shrines,
    wrecks,
    stations: stations.map(point),
  };
}

/** A fingerprint of a landing: every tile, place, thing that stands, station and the whole graph. */
export function hashLanding(landing: Landing): string {
  return hashInts([
    ...stringInts(landing.name),
    landing.seed,
    landing.citySize,
    SIZE_CLASSES.indexOf(landing.size),
    BIOMES.indexOf(landing.biome),
    ELEMENTS.indexOf(landing.element),
    landing.level,
    landing.far,
    landing.width,
    landing.height,
    ...landing.tiles,
    ...landing.ground,
    ...landing.places.flatMap((p) => [...stringInts(p.name), p.x, p.y]),
    landing.city.x,
    landing.city.y,
    landing.city.width,
    landing.city.height,
    landing.legs.x,
    landing.legs.y,
    landing.legs.width,
    landing.legs.height,
    landing.ramp.x,
    landing.ramp.y,
    EDGES.indexOf(landing.rampSide),
    landing.districts.length,
    ...landing.districts.flatMap((d) => [
      d.x,
      d.y,
      d.ring,
      d.level,
      d.gate,
      DISTRICT_KINDS.indexOf(d.kind),
      d.bounds.x,
      d.bounds.y,
      d.bounds.width,
      d.bounds.height,
      d.steps,
      d.distance,
      d.depth,
      d.passages.length,
      ...d.passages,
    ]),
    landing.passages.length,
    ...landing.passages.flatMap((p) => [
      p.a,
      p.b,
      PASSAGE_KINDS.indexOf(p.kind),
      p.tree ? 1 : 0,
      p.x,
      p.y,
      p.tiles.length,
      ...p.tiles.flatMap((t) => [t.x, t.y]),
    ]),
    ...landing.districtAt,
    landing.entries.length,
    ...landing.entries.flatMap((e) => [
      e.x,
      e.y,
      EDGES.indexOf(e.edge),
      e.district,
      e.gap.length,
      ...e.gap.flatMap((t) => [t.x, t.y]),
      e.route.length,
      ...e.route,
      ...e.passages,
      e.path.length,
      ...e.path.flatMap((t) => [t.x, t.y]),
    ]),
    landing.dens.length,
    ...landing.dens.flatMap((d) => [
      ...stringInts(d.letter),
      d.x,
      d.y,
      d.district,
      d.ring,
      d.level,
      d.elite,
    ]),
    landing.caches.length,
    ...landing.caches.flatMap((c) => [c.x, c.y, c.district, c.ring, c.level]),
    ...[landing.piles, landing.seams, landing.wrecks].flatMap((list) => [
      list.length,
      ...list.flatMap((s) => [s.x, s.y, s.district, s.ring]),
    ]),
    landing.shrines.length,
    ...landing.shrines.flatMap((s) => [s.x, s.y, s.district, s.ring, BOONS.indexOf(s.boon)]),
    landing.stations.length,
    ...landing.stations.flatMap((s) => [s.x, s.y]),
  ]);
}

const SYMBOL: Readonly<Record<Terrain, string>> = {
  grass: ".",
  path: ":",
  camp: "c",
  shore: "s",
  deep_grass: ",",
  den: "d",
  bridge: "=",
  tree: "T",
  dark_tree: "t",
  water: "~",
  rock: "#",
  lantern: "L",
  campfire: "f",
  bank: "B",
  tent: "A",
  deck: "_",
  hatch: "h",
  ramp: "r",
  hull: "H",
};
const LETTERS = "0abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * A landing as text, one character a tile. Terrain as in content/maps. On top
 * of it: `+` a gate tile (`=` on a bridge, `%` on a ford), `'` a border taken
 * out for an open passage or the strip round the yard, `*` a station of the
 * wall, R the ramp, H the middle of each gap in the rim where the horde comes
 * in, D a den, C a cache, S a shrine, W a wreck, o a scrap pile and e a seam
 * of ore. Closed borders are the rock, trees and water between districts.
 *
 * The `districts` view shows the graph instead: each tile as its district's
 * letter (0 for the city's), `#` for a border, `+` for a gate and `'` for an
 * opened border, and `@` at each district's centre. The `rings` view shows
 * each tile as its district's ring, 0 to 3.
 */
export function landingText(
  landing: Landing,
  view: "terrain" | "districts" | "rings" = "terrain",
): string {
  const index = (p: Point): number => p.y * landing.width + p.x;
  const gates = new Map<number, PassageKind>();
  for (const p of landing.passages) for (const t of p.tiles) gates.set(index(t), p.kind);
  const grid = landing.tiles.map((t, i) => {
    const district = landing.districtAt[i] as number;
    if (view === "terrain") return SYMBOL[TERRAINS[t] as Terrain];
    if (district === -1) return "#";
    return view === "rings"
      ? `${landing.districts[district]?.ring}`
      : (LETTERS[district % LETTERS.length] as string);
  });
  const put = (p: Point, c: string): void => {
    grid[index(p)] = c;
  };
  landing.tiles.forEach((t, i) => {
    const kind = gates.get(i);
    if (kind !== undefined) grid[i] = kind === "bridge" ? "=" : kind === "ford" ? "%" : "+";
    else if (landing.districtAt[i] === -1 && WALK.has(t)) grid[i] = "'";
  });
  if (view === "districts") for (const d of landing.districts) put(d, "@");
  if (view !== "districts") {
    for (const s of landing.stations) put(s, "*");
    for (const s of landing.piles) put(s, "o");
    for (const s of landing.seams) put(s, "e");
    for (const s of landing.shrines) put(s, "S");
    for (const s of landing.wrecks) put(s, "W");
    for (const c of landing.caches) put(c, "C");
    for (const d of landing.dens) put(d, "D");
  }
  for (const e of landing.entries) put(e, "H");
  put(landing.ramp, "R");
  const rows: string[] = [];
  for (let y = 0; y < landing.height; y++) {
    rows.push(grid.slice(y * landing.width, (y + 1) * landing.width).join(""));
  }
  const rings = RINGS.slice(1).map(
    (name, k) => `${landing.districts.filter((d) => d.ring === k + 1).length} ${name}`,
  );
  const loops = landing.passages.filter((p) => !p.tree).length;
  const crossings = landing.passages.filter((p) => p.kind === "bridge" || p.kind === "ford").length;
  // Levels never fall along the walk out of the yard, so by level is in its order.
  const byGate = landing.districts
    .slice(1)
    .sort((p, q) => p.level - q.level || p.gate - q.gate || p.id - q.id)
    .map((d) => `${LETTERS[d.id % LETTERS.length]} ${d.level}`);
  return [
    `city ${landing.citySize} ${landing.size} ${landing.width}x${landing.height}, ${landing.biome} (element: ${landing.element}), seed ${landing.seed}, level ${landing.level}, far ${landing.far}`,
    `ramp on the ${landing.rampSide}; horde gaps at ${landing.entries.map((e) => `${e.edge} (${e.x}, ${e.y})`).join(", ")}; ${landing.dens.length} dens, ${landing.caches.length} caches, ${landing.shrines.length} shrines, ${landing.wrecks.length} wrecks, ${landing.piles.length} piles, ${landing.seams.length} seams, ${landing.stations.length} stations`,
    `districts: the city and ${rings.join(", ")}; passages: ${landing.passages.length - loops} on the tree and ${loops} loops, ${crossings} over the river`,
    `levels: yard ${landing.districts[0]?.level}; pockets by the walk out of the yard: ${byGate.join(", ")}`,
    `dens: ${landing.dens.map((d) => `den ${d.letter} ${d.level} (elite ${d.elite})`).join("; ")}`,
    ...rows,
  ].join("\n");
}

/** The layout graph as text: a line a district, a line a passage, a line an entry. */
export function landingGraphText(landing: Landing): string {
  const letter = (d: number): string => LETTERS[d % LETTERS.length] as string;
  return [
    ...landing.districts.map(
      (d) =>
        `district ${letter(d.id)}: ring ${d.ring} level ${d.level} ${d.kind} at (${d.x}, ${d.y}), ${d.gate} tiles out of the yard to its gate, ${d.steps} passages and ${d.distance} tiles from the ramp`,
    ),
    ...landing.passages.map(
      (p) =>
        `passage ${letter(p.a)}-${letter(p.b)}: ${p.kind}, ${p.tree ? "tree" : "loop"}, ${p.tiles.length / 2} wide at (${p.x}, ${p.y})`,
    ),
    ...landing.entries.map(
      (e) =>
        `entry ${e.edge} at (${e.x}, ${e.y}), ${e.gap.length / 2} wide: ${e.route.map(letter).join(" > ")}, ${e.path.length} tiles to the ramp`,
    ),
  ].join("\n");
}
