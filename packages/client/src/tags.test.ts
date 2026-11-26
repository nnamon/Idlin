import { describe, expect, it } from "vitest";
import { type Box, placeTags, TAG_HEIGHT, type TagWish, tagBox } from "./tags.ts";

const BOUNDS = { width: 1440, height: 1008 };
const wish = (id: number, x: number, y: number, width = 80): TagWish => ({ id, x, y, width });
// The room a figure takes up, written out here so the test does not lean on the code it tests.
const body = (w: TagWish): Box => ({
  left: w.x - 20,
  right: w.x + 20,
  top: w.y + 2,
  bottom: w.y + 64,
});
const hit = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe("placeTags", () => {
  it("keeps a name where it was in a tight knot, while that spot is clear of every body", () => {
    // Eight figures packed so that no spot is clear of everyone's head room.
    const knot = [
      wish(1, 627, 449),
      wish(2, 507, 426),
      wish(3, 607, 483),
      wish(4, 572, 474),
      wish(5, 537, 435),
      wish(6, 502, 505),
      wish(7, 650, 412),
      wish(8, 563, 440),
    ];
    expect(placeTags(knot, new Map(), BOUNDS).get(5)?.spot).toBe(3);
    expect(placeTags(knot, new Map([[5, 5]]), BOUNDS).get(5)?.spot).toBe(5);
  });

  it("does not hang a name over a neighbour's head while another spot is free", () => {
    // Three in a row. The middle one's name cannot sit above it (the first name is there),
    // and the spot to the right would sit right over the third figure's head.
    const row = [wish(1, 500, 400), wish(2, 560, 400), wish(3, 630, 400)];
    const placed = placeTags(row, new Map(), BOUNDS);
    const middle = (placed.get(2) as { box: Box }).box;
    const overThird = { left: 610, right: 650, top: 376, bottom: 402 };
    expect(hit(middle, overThird)).toBe(false);
    expect(hit(middle, (placed.get(1) as { box: Box }).box)).toBe(false);
    expect(hit(middle, (placed.get(3) as { box: Box }).box)).toBe(false);
    // Packed too tightly for that, a name still lands somewhere clear of every body.
    const tight = [wish(1, 500, 400), wish(2, 530, 400), wish(3, 560, 400), wish(4, 590, 400)];
    const packed = placeTags(tight, new Map(), BOUNDS);
    for (const w of tight) {
      const box = (packed.get(w.id) as { box: Box }).box;
      for (const other of tight) if (other.id !== w.id) expect(hit(box, body(other))).toBe(false);
    }
  });

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

  it("keeps names off things it is told to avoid", () => {
    const fire = { left: 470, right: 530, top: 370, bottom: 400 };
    const clear = placeTags([wish(1, 500, 400)], new Map(), BOUNDS);
    expect(hit((clear.get(1) as { box: Box }).box, fire)).toBe(true);
    const placed = placeTags([wish(1, 500, 400)], new Map(), BOUNDS, [fire]);
    expect(hit((placed.get(1) as { box: Box }).box, fire)).toBe(false);
    expect(placed.get(1)?.spot).not.toBe(0);
  });

  it("tagBox gives the box of a spot, the same one placeTags reports", () => {
    const w = wish(1, 500, 400);
    const placed = placeTags([w, wish(2, 500, 352)], new Map(), BOUNDS).get(1) as {
      box: Box;
      spot: number;
    };
    expect(tagBox(w, placed.spot, BOUNDS)).toEqual(placed.box);
    expect(tagBox(w, 0, BOUNDS)).toEqual({
      left: 460,
      right: 540,
      top: 400 - TAG_HEIGHT,
      bottom: 400,
    });
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
