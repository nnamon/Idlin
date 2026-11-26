// How the frame is laid out and how big it is drawn for a window of a given
// shape. The frame is designed for 1920 by 1080: the map on the left, the page
// beside it, a line of news below. It is scaled as a whole. In a window of
// another shape the layout that shows the map largest is used, and the frame
// grows on one side to cover the window instead of leaving a bar:
//
// - wider than 16:9: the frame may be as short as the map, so the map fills
//   the window's height, and the page takes the extra width;
// - a little taller (4:3, 16:10): the page stays beside the map and there is
//   more paper under it;
// - much taller (about 6:5 or narrower): the page goes below the map, its
//   residents in three, two or one columns, whichever fills the window best.

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
/** The least width the page needs beside the map. */
export const PAGE_WIDTH = 480;
/** From the top of the page to the first resident's row. */
export const PAGE_HEAD = 294;
/** The height of a resident's row. */
export const ROW_PITCH = 105;
/** Room under the residents for the line of news. */
export const PAGE_FOOT = 96;
/**
 * The frame never grows past this. A window more extreme than that gets a bar
 * after all; four canvases of the frame's size are kept, and a browser will
 * not draw one beyond a few tens of thousands of pixels.
 */
export const MAX_FRAME_WIDTH = 3840;
export const MAX_FRAME_HEIGHT = 4320;
/** How many residents the page lists by name. */
export const ROSTER_ROWS = 6;

export interface Fit {
  /** The frame's size in its own pixels. */
  readonly width: number;
  readonly height: number;
  /** Screen pixels per frame pixel. */
  readonly scale: number;
  /** True when the page is below the map, not beside it. */
  readonly below: boolean;
  /** How many columns the residents are listed in. */
  readonly columns: number;
}

/** How tall the page is when it sits below the map with its residents in `columns` columns. */
export const pageHeight = (columns: number): number =>
  PAGE_HEAD + Math.ceil(ROSTER_ROWS / columns) * ROW_PITCH + PAGE_FOOT;

/**
 * How to use paper left over under the page when it sits below the map.
 * `room` is the height from the map's foot to the frame's foot, `rows` the
 * rows of residents. Each row opens out by `open` (up to 40 pixels) and the
 * page's content moves down by `shift`: a third of what is left goes above
 * it and the rest below.
 */
export function spreadPage(room: number, rows: number): { open: number; shift: number } {
  const spare = Math.max(0, room - (PAGE_HEAD + rows * ROW_PITCH + PAGE_FOOT));
  const open = Math.min(40, Math.floor(spare / (rows + 1)));
  return { open, shift: Math.floor((spare - open * rows) / 3) };
}

/**
 * The layout and frame size for a window, given the map's size in frame
 * pixels. A 16:9 window always gets the plain frame: 1920 by 1080, page beside
 * the map.
 */
export function fitFrame(
  windowWidth: number,
  windowHeight: number,
  mapWidth = FRAME_WIDTH - PAGE_WIDTH,
  mapHeight = FRAME_HEIGHT,
): Fit {
  const plain: Fit = {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    scale: 1,
    below: false,
    columns: 1,
  };
  // A window with no size yet (a hidden tab) gets the plain frame.
  if (!(windowWidth > 0) || !(windowHeight > 0) || !(mapWidth > 0) || !(mapHeight > 0))
    return plain;
  const shapes = [
    {
      below: false,
      columns: 1,
      width: mapWidth + PAGE_WIDTH,
      height: Math.min(FRAME_HEIGHT, mapHeight),
    },
    ...[3, 2, 1].map((columns) => ({
      below: true,
      columns,
      width: mapWidth,
      height: mapHeight + pageHeight(columns),
    })),
  ];
  let best: Fit | null = null;
  let filled = 0;
  for (const shape of shapes) {
    const scale = Math.min(windowWidth / shape.width, windowHeight / shape.height);
    // The larger map wins; between equals, the layout that leaves less of the window empty.
    const share = (shape.width * shape.height * scale * scale) / (windowWidth * windowHeight);
    if (best) {
      if (scale < best.scale - 1e-9) continue;
      if (scale <= best.scale + 1e-9 && share <= filled) continue;
    }
    filled = share;
    best = {
      below: shape.below,
      columns: shape.columns,
      width: Math.min(
        MAX_FRAME_WIDTH,
        Math.max(shape.width, Math.ceil(windowWidth / scale - 1e-6)),
      ),
      height: Math.min(
        MAX_FRAME_HEIGHT,
        Math.max(shape.height, Math.ceil(windowHeight / scale - 1e-6)),
      ),
      scale,
    };
  }
  return best ?? plain;
}
