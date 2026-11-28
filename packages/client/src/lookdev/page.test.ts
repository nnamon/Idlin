import { describe, expect, it, vi } from "vitest";
import { holdSurface, type Makers } from "./hold.ts";
import { loopTime, startAt } from "./index.ts";
import { Band, Shelves, type Surface } from "./surface.ts";

/** A canvas as far as the page's surface keeping goes: events, and nothing else. */
const canvasLike = (): HTMLCanvasElement => new EventTarget() as unknown as HTMLCanvasElement;

/** Surfaces that only say what made them, and which canvas they are on. */
function makers(gl: (n: number) => boolean): Makers & { made: string[] } {
  const made: string[] = [];
  let tries = 0;
  const surface = (kind: "webgl" | "canvas", name: string): Surface =>
    ({ kind, name, vertices: 0 }) as unknown as Surface;
  return {
    made,
    gl() {
      tries++;
      if (!gl(tries)) throw new Error("no WebGL 2 context");
      made.push(`gl ${tries}`);
      return surface("webgl", `gl ${tries}`);
    },
    flat(canvas) {
      made.push(
        (canvas as unknown as { fresh?: boolean }).fresh ? "flat on a fresh canvas" : "flat",
      );
      return surface("canvas", "flat");
    },
    fresh() {
      return Object.assign(canvasLike(), { fresh: true });
    },
  };
}

describe("the page's surface", () => {
  it("stops drawing when the WebGL context is lost, and draws on a new surface when it comes back", () => {
    const canvas = canvasLike();
    const make = makers(() => true);
    const held = holdSurface(canvas, null, make);
    const first = held.surface;
    const firstDraw = held.d;
    expect(held.surface.kind).toBe("webgl");
    expect(held.lost).toBe(false);
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    // Without preventDefault the browser never gives the context back.
    expect(lost.defaultPrevented).toBe(true);
    expect(held.lost).toBe(true);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(held.lost).toBe(false);
    expect(held.surface).not.toBe(first);
    expect(held.d).not.toBe(firstDraw);
    expect(held.d.surface).toBe(held.surface);
    expect(make.made).toEqual(["gl 1", "gl 2"]);
    // And again: a stream that runs for days may lose it more than once.
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(make.made).toEqual(["gl 1", "gl 2", "gl 3"]);
    expect(held.lost).toBe(false);
  });

  it("draws with Canvas 2D on a fresh canvas where there is no WebGL 2, or when it does not come back", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const none = makers(() => false);
    const held = holdSurface(canvasLike(), null, none);
    expect(held.surface.kind).toBe("canvas");
    expect(none.made).toEqual(["flat on a fresh canvas"]);
    const asked = makers(() => true);
    expect(holdSurface(canvasLike(), "canvas", asked).surface.kind).toBe("canvas");
    expect(asked.made).toEqual(["flat"]);
    const canvas = canvasLike();
    const once = makers((n) => n === 1);
    const h = holdSurface(canvas, null, once);
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(h.lost).toBe(false);
    expect(h.surface.kind).toBe("canvas");
    expect(once.made).toEqual(["gl 1", "flat on a fresh canvas"]);
    warn.mockRestore();
  });
});

describe("the text texture's upload", () => {
  it("sends only the rows written since the last upload, and all of it after a fresh start", () => {
    const band = new Band();
    expect(band.take(2048)).toBeNull();
    band.mark(100, 36);
    band.mark(40.5, 20);
    expect(band.take(2048)).toEqual([40, 136]);
    // Taken: nothing more to send until something is written.
    expect(band.take(2048)).toBeNull();
    band.mark(2040, 36);
    expect(band.take(2048)).toEqual([2040, 2048]);
    band.mark(0, 2048);
    expect(band.take(2048)).toEqual([0, 2048]);
  });
});

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
