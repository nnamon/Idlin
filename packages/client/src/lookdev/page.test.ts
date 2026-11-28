import { describe, expect, it } from "vitest";
import { loopTime, startAt } from "./index.ts";
import { Shelves } from "./surface.ts";

describe("the glyph atlas", () => {
  it("is started afresh only between frames, never inside one", () => {
    const shelves = new Shelves(2048);
    let fresh = 0;
    let placed = 0;
    let skipped = 0;
    // Three hundred frames of forty strings never seen before, enough to fill the atlas many
    // times over.
    for (let frame = 0; frame < 300; frame++) {
      if (shelves.begin()) fresh++;
      const thisFrame: [number, number, number, number][] = [];
      for (let k = 0; k < 40; k++) {
        const w = 60 + ((frame * 37 + k * 53) % 260);
        const h = 36 + ((frame + k) % 3) * 18;
        const at = shelves.place(w, h);
        if (!at) {
          skipped++;
          continue;
        }
        const box: [number, number, number, number] = [at[0], at[1], at[0] + w, at[1] + h];
        // A glyph laid earlier this frame is still where it was put: nothing lands on it.
        for (const b of thisFrame)
          expect(box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]).toBe(false);
        expect(box[2]).toBeLessThanOrEqual(2048);
        expect(box[3]).toBeLessThanOrEqual(2048);
        thisFrame.push(box);
        placed++;
      }
    }
    expect(fresh).toBeGreaterThan(3);
    expect(placed).toBeGreaterThan(11000);
    // A frame's own lettering never fills the quarter left after a fresh start.
    expect(skipped).toBe(0);
  });

  it("gives no room for a string wider than itself, or for more than a frame can hold", () => {
    const shelves = new Shelves(256);
    expect(shelves.place(300, 20)).toBeNull();
    let n = 0;
    while (shelves.place(100, 40)) n++;
    // Two to a shelf, six shelves.
    expect(n).toBe(12);
    expect(shelves.place(100, 40)).toBeNull();
    expect(shelves.begin()).toBe(true);
    expect(shelves.place(100, 40)).toEqual([2, 2]);
  });
});

describe("the page's start time", () => {
  it("is a finite time inside the scene for any ?t=, and 0 for nonsense", () => {
    expect(startAt("12.5", 40)).toBe(12.5);
    expect(startAt("-5", 40)).toBe(35);
    expect(startAt("-0.001", 40)).toBeCloseTo(39.999, 6);
    expect(startAt("95", 40)).toBe(15);
    expect(startAt("Infinity", 40)).toBe(0);
    expect(startAt("-Infinity", 40)).toBe(0);
    expect(startAt("NaN", 40)).toBe(0);
    expect(startAt("soon", 40)).toBe(0);
    expect(startAt(null, 40)).toBe(0);
    for (const t of [-1e9, -40, -0.5, 0, 39.99, 40, 1e9]) {
      const at = loopTime(t, 40);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(40);
    }
  });
});
