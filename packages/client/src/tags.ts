// Where name tags go. A tag sits just above its own character unless that would
// cover another character or another tag; then it takes the nearest free spot.
// Pure, so it can be tested without a page.

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface TagWish {
  readonly id: number;
  /** Frame pixels: the middle of the character, and the line just above its head. */
  readonly x: number;
  readonly y: number;
  /** Width of the tag's text box in frame pixels. */
  readonly width: number;
  /**
   * Where `x` and `y` will be at the next tick, and how far a step lifts the
   * figure on the way. A tag follows its figure between ticks, so it is kept
   * clear along the whole way and not only where it starts.
   */
  readonly next?: { readonly x: number; readonly y: number; readonly lift: number };
}

export interface Placement {
  readonly box: Box;
  /** Which spot was taken: an index into SPOTS. */
  readonly spot: number;
}

export const TAG_HEIGHT = 26;
// A figure on screen is about this big, with a little room round it.
const BODY_HALF_WIDTH = 20;
const BODY_HEIGHT = 62;
/** The room above a figure's head where its own name sits by default. */
const HEADROOM = 26;
/** A tag only returns to its favourite spot once there is this much clear room around it. */
const RETURN_MARGIN = 20;

/**
 * Spots in order of preference: sideways shift as a share of the tag's width,
 * and rise of its bottom edge. A name sits above its figure or beside its head
 * wherever there is room, so the two are easy to pair up.
 */
const SPOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.8, 0],
  [0.8, 0],
  [0, -30],
  [-0.8, -30],
  [0.8, -30],
  [-1.5, 0],
  [1.5, 0],
  // Last resort, for a figure on the top row with no room above it.
  [0, 94],
];

/** The room a figure takes up on screen, given where its name would like to sit. */
export function bodyBox(wish: TagWish): Box {
  return {
    left: wish.x - BODY_HALF_WIDTH,
    right: wish.x + BODY_HALF_WIDTH,
    top: wish.y + 2,
    bottom: wish.y + 2 + BODY_HEIGHT,
  };
}

/** Whether two boxes cover each other, or come within `margin` of it. */
export const overlaps = (a: Box, b: Box, margin = 0): boolean =>
  a.left - margin < b.right &&
  b.left < a.right + margin &&
  a.top - margin < b.bottom &&
  b.top < a.bottom + margin;

/** The box a name takes in a given spot, kept inside `bounds`. */
export function tagBox(wish: TagWish, spot: number, bounds: { readonly width: number }): Box {
  const [shift, rise] = SPOTS[spot] ?? (SPOTS[0] as (typeof SPOTS)[number]);
  const centre = wish.x + shift * wish.width;
  const left = Math.max(
    0,
    Math.min(bounds.width - wish.width, Math.round(centre - wish.width / 2)),
  );
  const bottom = Math.round(wish.y) + rise;
  return { left, right: left + wish.width, top: bottom - TAG_HEIGHT, bottom };
}

/**
 * The room a name in a given spot passes over until the next tick: from its
 * box now to its box then, and up by the lift. Just its box when the wish
 * has no `next`.
 */
export function pathBox(wish: TagWish, spot: number, bounds: { readonly width: number }): Box {
  const now = tagBox(wish, spot, bounds);
  if (!wish.next) return now;
  const then = tagBox({ ...wish, x: wish.next.x, y: wish.next.y }, spot, bounds);
  return {
    left: Math.min(now.left, then.left),
    right: Math.max(now.right, then.right),
    top: Math.min(now.top, then.top) - wish.next.lift,
    bottom: Math.max(now.bottom, then.bottom),
  };
}

/**
 * Places every tag. `previous` holds the spot each tag had last time; a tag
 * keeps its spot while it stays free, so tags do not hop about as characters
 * pass each other. `avoid` lists things no name should cover: a fire, a
 * place name. `figures` are the bodies of those without a tag: a tag that has
 * to find a new spot takes one clear of them too where there is one.
 */
export function placeTags(
  wishes: readonly TagWish[],
  previous: ReadonlyMap<number, number>,
  bounds: { readonly width: number; readonly height: number },
  avoid: readonly Box[] = [],
  figures: readonly Box[] = [],
): Map<number, Placement> {
  const bodies = wishes.map(bodyBox);
  // A name hung over someone else's head reads as theirs, so that room is kept clear too while anywhere else is free.
  const heads = bodies.map((body) => ({ ...body, top: body.top - HEADROOM }));
  const placed: Box[] = [];
  const result = new Map<number, Placement>();

  wishes.forEach((wish, index) => {
    const at = (spot: number): Box => pathBox(wish, spot, bounds);
    const clear = (others: readonly Box[], box: Box, margin = 0): boolean =>
      box.top >= 0 &&
      box.bottom <= bounds.height &&
      !placed.some((other) => overlaps(box, other, margin)) &&
      !avoid.some((other) => overlaps(box, other)) &&
      !others.some((body, k) => k !== index && overlaps(box, body, margin));

    const before = previous.get(wish.id) ?? 0;
    let spot = SPOTS.findIndex(
      (_, k) => clear(heads, at(k)) && !figures.some((body) => overlaps(at(k), body)),
    );
    const aside = spot >= 0;
    if (spot < 0) spot = SPOTS.findIndex((_, k) => clear(heads, at(k)));
    // In a tight group there may be no spot clear of every head: then clear of every body will do.
    const others = spot < 0 ? bodies : heads;
    const free = (box: Box, margin = 0): boolean => clear(others, box, margin);
    if (spot < 0) spot = SPOTS.findIndex((_, k) => free(at(k)));
    // Still nowhere: over a figure, but clear of the other names and of what `avoid` lists.
    if (spot < 0) spot = SPOTS.findIndex((_, k) => clear([], at(k)));
    // Nowhere is free: take the first spot that at least stays inside the world.
    if (spot < 0) {
      spot = Math.max(
        0,
        SPOTS.findIndex((_, k) => at(k).top >= 0 && at(k).bottom <= bounds.height),
      );
    }
    // Stay put if the old spot still works, unless the favourite spot has plenty of room again.
    if (
      before !== spot &&
      before < SPOTS.length &&
      free(at(before)) &&
      !(spot === 0 && free(at(0), RETURN_MARGIN)) &&
      // A new tag is not drawn back over a figure when it found a spot clear of them.
      !(aside && !previous.has(wish.id) && figures.some((body) => overlaps(at(before), body)))
    ) {
      spot = before;
    }
    const box = at(spot);
    placed.push(box);
    result.set(wish.id, { box, spot });
  });
  return result;
}
