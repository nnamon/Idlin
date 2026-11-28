// The rule and the name tags of #371's plate, kept for `deckside` and the
// sheets. The look target's scenes use stage.ts.

import { CONTOUR, type Draw, HAIR, INK } from "./draw.ts";
import { type Face, HEIGHT, measure, WIDTH } from "./surface.ts";

/** The picture inside the rule. */
export const PICTURE = { x0: 46, y0: 44, x1: WIDTH - 46, y1: 984 } as const;

/** Paper over whatever the scene drew past the rule, then the rule itself. */
export function drawBorder(d: Draw): void {
  const { x0, y0, x1, y1 } = PICTURE;
  const s = d.surface;
  s.paper(0, 0, WIDTH, y0);
  s.paper(0, y1, WIDTH, HEIGHT);
  s.paper(0, y0, x0, y1);
  s.paper(x1, y0, WIDTH, y1);
  d.rule(x0, y0, x1, y0, CONTOUR, 11);
  d.rule(x1, y0, x1, y1, CONTOUR, 12);
  d.rule(x1, y1, x0, y1, CONTOUR, 13);
  d.rule(x0, y1, x0, y0, CONTOUR, 14);
}

export interface Tag {
  /** Where the top of the citizen's hat is, in frame pixels. */
  x: number;
  y: number;
  name: string;
  /** The citizen's cloak colour, ruled under its name. */
  rgb?: number;
  /** Shown even if it has to be set a long way off, or over another tag. */
  must?: boolean;
}

const TAG_SIZE = 24;
const TAG_FACE: Face = "roman";

/** Where a tag may go, nearest first: over the hat, then rings further out, mostly above. */
const SPOTS: (readonly [number, number])[] = [
  [0, 0],
  [0, -27],
  [0, -54],
  [46, -27],
  [-46, -27],
  [0, -81],
  [60, -54],
  [-60, -54],
  [96, -27],
  [-96, -27],
  [104, 0],
  [-104, 0],
  [0, -108],
  [80, -81],
  [-80, -81],
  [120, -54],
  [-120, -54],
];
/** How many of those a tag that need not be shown may try: only the one over its head. */
const NEAR = 1;

/**
 * A username for each citizen: its name on a slip of paper, ruled under in
 * its cloak colour. A slip that would lie on one already placed, or on a
 * rectangle in `taken` (x0, y0, x1, y1, …), is moved out and joined to its
 * owner by a stroke. One with no room is left out unless it must be shown.
 * Returns how many were drawn.
 */
export function drawTags(
  d: Draw,
  tags: readonly Tag[],
  alpha = 1,
  taken: readonly number[] = [],
): number {
  const placed: number[] = [...taken];
  const where: number[] = [];
  const free = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (x0 < PICTURE.x0 + 4 || x1 > PICTURE.x1 - 4 || y0 < PICTURE.y0 + 4 || y1 > PICTURE.y1 - 4)
      return false;
    for (let k = 0; k < placed.length; k += 4) {
      if (
        x0 < (placed[k + 2] as number) &&
        x1 > (placed[k] as number) &&
        y0 < (placed[k + 3] as number) &&
        y1 > (placed[k + 1] as number)
      )
        return false;
    }
    return true;
  };
  for (const tag of tags) {
    const w = measure(TAG_FACE, TAG_SIZE, tag.name) + 12;
    let spot: readonly [number, number] | null = null;
    const tries = tag.must ? SPOTS.length : NEAR;
    for (let k = 0; k < tries; k++) {
      const [ox, oy] = SPOTS[k] as readonly [number, number];
      const cx = tag.x + ox;
      const base = tag.y + oy - 8;
      if (free(cx - w / 2, base - 22, cx + w / 2, base + 8)) {
        spot = [ox, oy];
        break;
      }
    }
    if (!spot) {
      if (!tag.must) {
        where.push(Number.NaN, 0);
        continue;
      }
      spot = SPOTS[0] as readonly [number, number];
    }
    const cx = tag.x + spot[0];
    const base = tag.y + spot[1] - 8;
    placed.push(cx - w / 2, base - 22, cx + w / 2, base + 8);
    where.push(cx, base);
  }
  // Strokes to owners first, so every slip lies over them.
  tags.forEach((tag, i) => {
    const cx = where[i * 2] as number;
    const base = where[i * 2 + 1] as number;
    if (Number.isNaN(cx)) return;
    if (Math.hypot(cx - tag.x, base + 8 - tag.y) > 14)
      d.line(cx, base - 6, tag.x, tag.y + 6, HAIR, i + 5, alpha);
  });
  let shown = 0;
  tags.forEach((tag, i) => {
    const cx = where[i * 2] as number;
    const base = where[i * 2 + 1] as number;
    if (Number.isNaN(cx)) return;
    const w = measure(TAG_FACE, TAG_SIZE, tag.name);
    // The name over the head, paper pressed round it, ruled under in the cloak's colour.
    d.fill(d.box(cx - w / 2 - 1, base + 3, cx + w / 2 + 1, base + 7), d.ground, alpha);
    d.fill(d.box(cx - w / 2, base + 4, cx + w / 2, base + 6.5), tag.rgb ?? INK, alpha);
    d.text(tag.name, cx, base, { face: TAG_FACE, size: TAG_SIZE, align: 0.5, alpha, halo: 1 });
    shown++;
  });
  return shown;
}
