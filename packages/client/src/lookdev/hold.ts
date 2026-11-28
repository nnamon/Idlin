// The surface a page draws on, kept drawing for as long as the page is open:
// WebGL 2 where the browser has it and Canvas 2D where it does not, and a new
// WebGL surface when the browser takes the context away and gives it back (a
// GPU reset or a driver update). The scenes keep no GPU state, so a new
// surface is all that is needed.

import { Draw } from "./draw.ts";
import type { Surface } from "./surface.ts";

/** What the page draws through now. While `lost`, it draws nothing. */
export interface Held {
  surface: Surface;
  d: Draw;
  lost: boolean;
}

/** How the surfaces are made, apart so a test can stand in for a browser. */
export interface Makers {
  gl(canvas: HTMLCanvasElement): Surface;
  flat(canvas: HTMLCanvasElement): Surface;
  /** A fresh canvas in this one's place: one that has given out a WebGL context gives no 2D one. */
  fresh(canvas: HTMLCanvasElement): HTMLCanvasElement;
}

/**
 * A surface on `canvas`: Canvas 2D if `renderer` is "canvas", WebGL 2 otherwise, and Canvas 2D on
 * a fresh canvas if WebGL 2 cannot be had.
 */
export function holdSurface(
  canvas: HTMLCanvasElement,
  renderer: string | null,
  make: Makers,
): Held {
  const flat = (): Surface => make.flat(make.fresh(canvas));
  const held = (surface: Surface): Held => ({ surface, d: new Draw(surface), lost: false });
  if (renderer === "canvas") return held(make.flat(canvas));
  let h: Held;
  try {
    h = held(make.gl(canvas));
  } catch (error) {
    console.warn("no WebGL 2, drawing with Canvas 2D", error);
    return held(flat());
  }
  canvas.addEventListener("webglcontextlost", (event) => {
    // Without this the browser never gives the context back.
    event.preventDefault();
    h.lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    try {
      h.surface = make.gl(canvas);
    } catch (error) {
      console.warn("WebGL 2 did not come back, drawing with Canvas 2D", error);
      h.surface = flat();
    }
    h.d = new Draw(h.surface);
    h.lost = false;
  });
  return h;
}
