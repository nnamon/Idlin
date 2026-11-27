// Drawing by hand, in code: lines that wobble a little and vary in weight, the
// way a pen does. Everything is seeded, so the same map is always drawn the
// same way.

export type Ctx = CanvasRenderingContext2D;
export type Pt = readonly [number, number];

/** A value from 0 up to 1 that depends only on its arguments. */
export function hash(x: number, y: number, k = 0): number {
  let h =
    (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul((k | 0) + 1, 83492791)) >>>
    0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A pen with its own run of random numbers. */
export class Pen {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  random(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  /**
   * Strokes a path through the points: twice, slightly apart, like a nib going
   * over its own line. Both passes are as faint as the alpha in force allows.
   */
  line(ctx: Ctx, points: readonly Pt[], width = 2, jitter = 1.2, close = false): void {
    const base = ctx.globalAlpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let pass = 0; pass < 2; pass++) {
      const spread = jitter * (pass ? 1.6 : 1);
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const px = x + (this.random() - 0.5) * spread;
        const py = y + (this.random() - 0.5) * spread;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      if (close) ctx.closePath();
      ctx.lineWidth = pass ? width * 0.45 : width;
      ctx.globalAlpha = base * (pass ? 0.5 : 0.92);
      ctx.stroke();
    }
    ctx.globalAlpha = base;
  }
}

/** Points along an arc, for handing to a pen. */
export function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 10): Pt[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  });
}

export function newCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { canvas, ctx };
}

/** Lays a path through the points, without stroking it. */
export function trace(ctx: Ctx, points: readonly Pt[]): void {
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
}
