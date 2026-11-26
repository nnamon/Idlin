import { describe, expect, it } from "vitest";
import { type Box, bodyBox, placeTags, TAG_HEIGHT, type TagWish } from "./tags.ts";

const BOUNDS = { width: 1440, height: 1008 };
const wish = (id: number, x: number, y: number, width = 80): TagWish => ({ id, x, y, width });
const body = bodyBox;
const hit = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("placeTags", () => {
  it("puts a lone tag centred just above its character", () => {
    const placed = placeTags([wish(1, 500, 400)], new Map(), BOUNDS);
    expect(placed.get(1)).toEqual({
      box: { left: 460, right: 540, top: 400 - TAG_HEIGHT, bottom: 400 },
      spot: 0,
    });
  });

  it("never covers another character or another tag, in a crowd", () => {
    // Twelve characters two tiles apart each way: room enough that nothing need be covered.
    const crowd: TagWish[] = [];
    for (let i = 0; i < 12; i++) {
      crowd.push(wish(i + 1, 400 + (i % 4) * 96, 300 + Math.floor(i / 4) * 96, 60 + (i % 3) * 20));
    }
    const count = (list: TagWish[]): number => {
      const placed = placeTags(list, new Map(), BOUNDS);
      const boxes = list.map((w) => (placed.get(w.id) as { box: Box }).box);
      let covered = 0;
      boxes.forEach((box, i) => {
        list.forEach((other, k) => {
          if (k !== i && hit(box, body(other))) covered++;
        });
        boxes.forEach((otherBox, k) => {
          if (k > i && hit(box, otherBox)) covered++;
        });
      });
      return covered;
    };
    expect(count(crowd)).toBe(0);
    // Packed shoulder to shoulder there is not room for every tag; placing them still beats not trying.
    const packed = crowd.map((w, i) =>
      wish(w.id, 400 + (i % 4) * 48, 300 + Math.floor(i / 4) * 48, w.width),
    );
    const naive = packed.length * 2;
    expect(count(packed)).toBeLessThan(naive);

    const pair = [wish(1, 500, 400), wish(2, 500, 352)];
    const two = placeTags(pair, new Map(), BOUNDS);
    const a = (two.get(1) as { box: Box }).box;
    const b = (two.get(2) as { box: Box }).box;
    expect(hit(a, body(pair[1] as TagWish))).toBe(false);
    expect(hit(b, body(pair[0] as TagWish))).toBe(false);
    expect(hit(a, b)).toBe(false);
  });

  it("moves a tag aside when another character stands where it would go", () => {
    // Character 2 stands one tile above character 1, exactly where 1's tag wants to be.
    const placed = placeTags([wish(1, 500, 400), wish(2, 500, 352)], new Map(), BOUNDS);
    expect(placed.get(1)?.spot).not.toBe(0);
  });

  it("keeps a tag where it was while that spot stays free, and returns only when there is room", () => {
    const blocked = [wish(1, 500, 400), wish(2, 500, 352)];
    const first = placeTags(blocked, new Map(), BOUNDS);
    const spot = first.get(1)?.spot as number;
    expect(spot).toBeGreaterThan(0);
    const memory = new Map([[1, spot]]);
    // The other character has only just stepped clear: the tag stays.
    // Its body ends 6 pixels from where the tag would sit: free, but without room to spare.
    const nearby = placeTags([wish(1, 500, 400), wish(2, 570, 352)], memory, BOUNDS);
    expect(placeTags([wish(1, 500, 400), wish(2, 570, 352)], new Map(), BOUNDS).get(1)?.spot).toBe(
      0,
    );
    expect(nearby.get(1)?.spot).toBe(spot);
    // It has walked well away: the tag goes home.
    const gone = placeTags([wish(1, 500, 400), wish(2, 900, 352)], memory, BOUNDS);
    expect(gone.get(1)?.spot).toBe(0);
  });

  it("keeps tags inside the world at every edge", () => {
    const corners = [wish(1, 10, 10), wish(2, 1430, 10), wish(3, 10, 990), wish(4, 1430, 990)];
    for (const { box } of placeTags(corners, new Map(), BOUNDS).values()) {
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(BOUNDS.width);
      expect(box.bottom).toBeLessThanOrEqual(BOUNDS.height);
      expect(box.top).toBeGreaterThanOrEqual(0);
    }
    // On the top row the favourite spot would stick out above the world, so another is taken.
    const top = placeTags([wish(1, 500, 10)], new Map(), BOUNDS).get(1);
    expect(top?.spot).not.toBe(0);
    expect(top?.box.top).toBeGreaterThanOrEqual(0);
    // Even when every spot is taken, a tag is not pushed off the top.
    const crush = Array.from({ length: 9 }, (_, i) =>
      wish(i + 1, 500 + (i % 3) * 20, 10 + Math.floor(i / 3) * 12),
    );
    for (const { box } of placeTags(crush, new Map(), BOUNDS).values())
      expect(box.top).toBeGreaterThanOrEqual(0);
  });

  it("gives the same answer for the same input", () => {
    const crowd = Array.from({ length: 30 }, (_, i) =>
      wish(i + 1, 100 + ((i * 97) % 1200), 100 + ((i * 53) % 800)),
    );
    expect([...placeTags(crowd, new Map(), BOUNDS)]).toEqual([
      ...placeTags(crowd, new Map(), BOUNDS),
    ]);
  });
});
