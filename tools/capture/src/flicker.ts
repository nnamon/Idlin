// The flicker index: how much of the screen changes brightness sharply from
// one rendered frame to the next. Works on grids of mean brightness, one value
// per block of the frame, so it can be tested without a browser.

export const FLICKER_LIMIT = 0.05;
/** A block has changed sharply when its mean brightness (0 to 255) moves by more than this. */
export const SHARP_CHANGE = 24;

/**
 * The largest share of blocks that changed sharply between any two consecutive
 * frames. Movement changes a few blocks a little; a flash changes many a lot.
 */
export function flickerIndex(frames: readonly (readonly number[])[]): number {
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const before = frames[i - 1] as readonly number[];
    const after = frames[i] as readonly number[];
    if (after.length === 0 || after.length !== before.length)
      throw new RangeError("frames must be grids of one size");
    let changed = 0;
    for (let k = 0; k < after.length; k++) {
      if (Math.abs((after[k] as number) - (before[k] as number)) > SHARP_CHANGE) changed++;
    }
    worst = Math.max(worst, changed / after.length);
  }
  return worst;
}

/** Mean brightness per block of an RGBA image, row by row. `block` is the block's side in pixels. */
export function brightnessGrid(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  block: number,
): number[] {
  const columns = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  const sums = new Array<number>(columns * rows).fill(0);
  const counts = new Array<number>(columns * rows).fill(0);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / block) * columns;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const cell = row + Math.floor(x / block);
      sums[cell] =
        (sums[cell] as number) +
        ((rgba[i] as number) * 299 +
          (rgba[i + 1] as number) * 587 +
          (rgba[i + 2] as number) * 114) /
          1000;
      counts[cell] = (counts[cell] as number) + 1;
    }
  }
  return sums.map((sum, cell) => sum / (counts[cell] as number));
}
