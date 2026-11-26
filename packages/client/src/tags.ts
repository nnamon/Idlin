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
}

export interface Placement {
  readonly box: Box;
  /** Which spot was taken: an index into SPOTS. */
  readonly spot: number;
}

export const TAG_HEIGHT = 26;
// A figure on screen is about this big, with a little room round it.
const BODY_HALF_WIDTH = 20;
const BODY_HEIGHT = 66;
/** A tag only returns to its favourite spot once there is this much clear room around it. */
const RETURN_MARGIN = 20;

/** Spots in order of preference: sideways shift as a share of the tag's width, and rise of its bottom edge. */
const SPOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [-0.75, 0],
  [0.75, 0],
  [0, -32],
  [-0.75, -32],
  [0.75, -32],
  [0, 94],
];

/** The room a figure takes up on screen, given where its name would like to sit. */
export function bodyBox(wish: TagWish): Box {
  return {
    left: wish.x - BODY_HALF_WIDTH,
    right: wish.x + BODY_HALF_WIDTH,
    top: wish.y + 6,
    bottom: wish.y + 6 + BODY_HEIGHT,
  };
}

const overlaps = (a: Box, b: Box, margin = 0): boolean =>
  a.left - margin < b.right &&
  b.left < a.right + margin &&
  a.top - margin < b.bottom &&
  b.top < a.bottom + margin;

/**
 * Places every tag. `previous` holds the spot each tag had in the last frame; a
 * tag keeps its spot while it stays free, so tags do not hop about as
 * characters pass each other.
 */
export function placeTags(
  wishes: readonly TagWish[],
  previous: ReadonlyMap<number, number>,
  bounds: { readonly width: number; readonly height: number },
): Map<number, Placement> {
  const bodies = wishes.map(bodyBox);
  const placed: Box[] = [];
  const result = new Map<number, Placement>();

  wishes.forEach((wish, index) => {
    const at = (spot: number): Box => {
      const [shift, rise] = SPOTS[spot] as (typeof SPOTS)[number];
      const centre = wish.x + shift * wish.width;
      const left = Math.max(
        0,
        Math.min(bounds.width - wish.width, Math.round(centre - wish.width / 2)),
      );
      const bottom = Math.round(wish.y) + rise;
      return { left, right: left + wish.width, top: bottom - TAG_HEIGHT, bottom };
    };
    const free = (box: Box, margin = 0): boolean =>
      box.top >= 0 &&
      box.bottom <= bounds.height &&
      !placed.some((other) => overlaps(box, other, margin)) &&
      !bodies.some((body, k) => k !== index && overlaps(box, body, margin));

    const before = previous.get(wish.id) ?? 0;
    let spot = SPOTS.findIndex((_, k) => free(at(k)));
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
      !(spot === 0 && free(at(0), RETURN_MARGIN))
    ) {
      spot = before;
    }
    const box = at(spot);
    placed.push(box);
    result.set(wish.id, { box, spot });
  });
  return result;
}
