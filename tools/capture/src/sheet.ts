// Putting frames together into one picture: a grid of frames for a storyboard,
// two sheets one above the other for a comparison, and an animated clip. Pure
// functions over RGBA pixels, so they can be tested without a browser.

import { createRequire } from "node:module";
import { PNG } from "pngjs";

// gifenc ships CommonJS whose named exports Node cannot see through `import`.
const { applyPalette, GIFEncoder, quantize } = createRequire(import.meta.url)(
  "gifenc",
) as typeof import("gifenc");

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly data: Uint8Array | Uint8ClampedArray;
}

const BACKGROUND = [30, 27, 25] as const;

function blank(width: number, height: number): Image & { data: Uint8Array } {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = BACKGROUND[0];
    data[i + 1] = BACKGROUND[1];
    data[i + 2] = BACKGROUND[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function paste(onto: Image & { data: Uint8Array }, image: Image, left: number, top: number): void {
  for (let y = 0; y < image.height; y++) {
    const from = y * image.width * 4;
    onto.data.set(
      image.data.subarray(from, from + image.width * 4),
      ((top + y) * onto.width + left) * 4,
    );
  }
}

/**
 * Lays frames out in reading order, `columns` to a row, with a gap between
 * them. Every frame must be the same size.
 */
export function grid(frames: readonly Image[], columns: number, gap = 8): Image {
  const first = frames[0];
  if (!first) throw new RangeError("a sheet needs at least one frame");
  if (frames.some((f) => f.width !== first.width || f.height !== first.height))
    throw new RangeError("frames must be one size");
  const rows = Math.ceil(frames.length / columns);
  const sheet = blank(
    columns * first.width + (columns + 1) * gap,
    rows * first.height + (rows + 1) * gap,
  );
  frames.forEach((frame, i) => {
    paste(
      sheet,
      frame,
      gap + (i % columns) * (first.width + gap),
      gap + Math.floor(i / columns) * (first.height + gap),
    );
  });
  return sheet;
}

/** Puts images one above the other, left edges together, for comparing a baseline with a change. */
export function stack(images: readonly Image[], gap = 24): Image {
  const width = Math.max(...images.map((image) => image.width));
  const height = images.reduce((sum, image) => sum + image.height, 0) + gap * (images.length - 1);
  const sheet = blank(width, height);
  let top = 0;
  for (const image of images) {
    paste(sheet, image, 0, top);
    top += image.height + gap;
  }
  return sheet;
}

/** The image at half size, each pixel the mean of four. Odd edges are dropped. */
export function half(image: Image): Image {
  const width = image.width >> 1;
  const height = image.height >> 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        const at = (dx: number, dy: number): number =>
          image.data[((y * 2 + dy) * image.width + x * 2 + dx) * 4 + c] as number;
        data[(y * width + x) * 4 + c] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1) + 2) >> 2;
      }
    }
  }
  return { width, height, data };
}

/** The part of the image from (left, top), `width` by `height`, kept inside the image. */
export function crop(
  image: Image,
  left: number,
  top: number,
  width: number,
  height: number,
): Image {
  const x0 = Math.max(0, Math.min(image.width - 1, Math.floor(left)));
  const y0 = Math.max(0, Math.min(image.height - 1, Math.floor(top)));
  const w = Math.max(1, Math.min(image.width - x0, Math.floor(width)));
  const h = Math.max(1, Math.min(image.height - y0, Math.floor(height)));
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

/** The image `k` times larger, each pixel a k by k square, so small detail can be looked at. */
export function enlarge(image: Image, k: number): Image {
  const width = image.width * k;
  const height = image.height * k;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / k) * image.width + Math.floor(x / k)) * 4;
      data.set(image.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

export function encodePng(image: Image): Buffer {
  const png = new PNG({ width: image.width, height: image.height });
  png.data.set(image.data);
  return PNG.sync.write(png);
}

export function decodePng(bytes: Buffer): Image {
  const png = PNG.sync.read(bytes);
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
}

/** An animated GIF that loops, each frame shown for `delayMs`. */
export function encodeGif(frames: readonly Image[], delayMs: number): Uint8Array {
  const gif = GIFEncoder();
  for (const frame of frames) {
    const palette = quantize(frame.data, 256);
    gif.writeFrame(applyPalette(frame.data, palette), frame.width, frame.height, {
      palette,
      delay: delayMs,
    });
  }
  gif.finish();
  return gif.bytes();
}

/** The image `k` times smaller, each pixel the mean of a k by k block. Odd edges are dropped. */
export function shrink(image: Image, k: number): Image {
  const width = Math.floor(image.width / k);
  const height = Math.floor(image.height / k);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let dy = 0; dy < k; dy++) {
          for (let dx = 0; dx < k; dx++) {
            sum += image.data[((y * k + dy) * image.width + x * k + dx) * 4 + c] as number;
          }
        }
        data[(y * width + x) * 4 + c] = Math.round(sum / (k * k));
      }
    }
  }
  return { width, height, data };
}
