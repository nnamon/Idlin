import { describe, expect, it } from "vitest";
import {
  crop,
  decodePng,
  encodeGif,
  encodePng,
  enlarge,
  grid,
  half,
  type Image,
  stack,
} from "./sheet.ts";
import { busiest, play } from "./simrun.ts";

const flat = (width: number, height: number, grey: number): Image => {
  const data = new Uint8Array(width * height * 4).fill(grey);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
};
const at = (image: Image, x: number, y: number): number =>
  image.data[(y * image.width + x) * 4] as number;

describe("crops", () => {
  it("cuts out a part of an image, kept inside it, and enlarges it pixel for pixel", () => {
    const data = new Uint8Array(4 * 3 * 4);
    for (let i = 0; i < 12; i++) data[i * 4] = i;
    const image: Image = { width: 4, height: 3, data };
    const part = crop(image, 1, 1, 2, 2);
    expect([part.width, part.height]).toEqual([2, 2]);
    expect([at(part, 0, 0), at(part, 1, 0), at(part, 0, 1), at(part, 1, 1)]).toEqual([5, 6, 9, 10]);
    expect([crop(image, 3, 2, 10, 10).width, crop(image, -5, 0, 2, 9).height]).toEqual([1, 3]);
    const big = enlarge(part, 3);
    expect([big.width, big.height]).toEqual([6, 6]);
    expect([at(big, 2, 2), at(big, 3, 2), at(big, 5, 5)]).toEqual([5, 6, 10]);
  });
});

describe("sheets", () => {
  it("lays frames out in reading order with a gap round each", () => {
    const sheet = grid([flat(4, 2, 10), flat(4, 2, 20), flat(4, 2, 30)], 2, 1);
    expect([sheet.width, sheet.height]).toEqual([2 * 4 + 3, 2 * 2 + 3]);
    expect(at(sheet, 1, 1)).toBe(10);
    expect(at(sheet, 4, 2)).toBe(10);
    expect(at(sheet, 6, 1)).toBe(20);
    expect(at(sheet, 1, 4)).toBe(30);
    // The gaps, and the cell no frame filled, are background.
    const background = at(sheet, 0, 0);
    expect(background).not.toBe(10);
    expect(at(sheet, 5, 1)).toBe(background);
    expect(at(sheet, 1, 3)).toBe(background);
    expect(at(sheet, 6, 4)).toBe(background);
    expect(() => grid([flat(4, 2, 1), flat(3, 2, 1)], 2)).toThrow(RangeError);
    expect(() => grid([], 2)).toThrow(RangeError);
  });

  it("stacks sheets one above the other", () => {
    const both = stack([flat(4, 2, 10), flat(3, 2, 20)], 1);
    expect([both.width, both.height]).toEqual([4, 5]);
    expect(at(both, 0, 0)).toBe(10);
    expect(at(both, 2, 3)).toBe(20);
    expect(at(both, 3, 3)).not.toBe(20);
  });

  it("halves an image by averaging each four pixels", () => {
    const image = grid([flat(2, 2, 10), flat(2, 2, 30)], 2, 0);
    image.data[0] = 50;
    const small = half(image);
    expect([small.width, small.height]).toEqual([2, 1]);
    expect(at(small, 0, 0)).toBe(20);
    expect(at(small, 1, 0)).toBe(30);
    expect(small.data[3]).toBe(255);
    expect(half(flat(5, 3, 7)).width).toBe(2);
  });

  it("writes a PNG that reads back the same, and the same bytes every time", () => {
    const image = grid([flat(4, 2, 10), flat(4, 2, 200)], 2, 1);
    const bytes = encodePng(image);
    expect(encodePng(image).equals(bytes)).toBe(true);
    const back = decodePng(bytes);
    expect([back.width, back.height]).toEqual([image.width, image.height]);
    expect([...back.data]).toEqual([...image.data]);
  });

  it("writes an animated GIF with every frame in it", () => {
    const one = encodeGif([flat(8, 8, 10)], 100);
    const three = encodeGif([flat(8, 8, 10), flat(8, 8, 90), flat(8, 8, 200)], 100);
    expect(String.fromCharCode(...three.subarray(0, 6))).toBe("GIF89a");
    expect(three.length).toBeGreaterThan(one.length);
    // 0x2C starts each frame's image descriptor; flat frames hold no other.
    expect([...three].filter((byte) => byte === 0x2c).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the recorded run", () => {
  it("is the same every time for a seed and a cast, and differs for another seed", () => {
    const a = play(1, 12, 400);
    expect(play(1, 12, 400)).toEqual(a);
    expect(play(2, 12, 400)).not.toEqual(a);
    expect(a).toHaveLength(400);
    expect(a[0]?.actors).toHaveLength(12);
  });

  it("finds the stretch in which the most actors moved", () => {
    const still = { events: [], actors: [{ id: 1, name: "A", x: 0, y: 0 }] };
    const run = [0, 0, 0, 0, 1, 2, 3, 3, 3, 3].map((x) => ({
      events: [],
      actors: [{ id: 1, name: "A", x, y: 0 }],
    }));
    expect(busiest(run, 3)).toBe(4);
    expect(busiest([still, still, still], 2)).toBe(0);
    // In the real world, everyone leaves camp at dawn: the busiest stretch has people walking.
    const day = play(1, 6, 1200);
    const start = busiest(day, 20);
    const first = day[start]?.actors ?? [];
    const last = day[start + 19]?.actors ?? [];
    expect(first.filter((a, i) => a.x !== last[i]?.x || a.y !== last[i]?.y).length).toBeGreaterThan(
      2,
    );
  });
});
