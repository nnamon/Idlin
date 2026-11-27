// The look-development page: `?lookdev=<scene>`. It draws scripted scenes with
// no simulation behind them, each a pure function of time, as the target the
// game's own drawing is then built to (#362). `?renderer=canvas` draws the
// same scene through Canvas 2D instead of WebGL, for the bench. With
// `&capture` the page draws only when told to, so the capture tool can take
// any moment of a scene.

import { Draw } from "./draw.ts";
import { makePaper } from "./paper.ts";
import { makeScene, SCENES } from "./scenes.ts";
import { CanvasSurface, fontOf, GlSurface, HEIGHT, type Surface, WIDTH } from "./surface.ts";

export interface BenchResult {
  readonly renderer: string;
  readonly frames: number;
  /** Milliseconds a frame: building it, and building it plus the wait for it to be drawn. */
  readonly build: { mean: number; p95: number; max: number };
  readonly whole: { mean: number; p95: number; max: number };
  readonly vertices: number;
}

/** What the page offers the capture tool in capture mode. */
export interface LookdevApi {
  readonly scenes: readonly string[];
  /** How long the scene runs before it repeats, in seconds. */
  readonly duration: number;
  /** Draws the scene as it is `seconds` in. */
  draw(seconds: number): void;
  /** Draws `frames` frames a sixtieth of a second apart from `from`, and times them. */
  bench(frames: number, from: number): BenchResult;
}

declare global {
  interface Window {
    lookdev?: LookdevApi;
  }
}

const summary = (samples: number[]): { mean: number; p95: number; max: number } => {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n: number): number => Math.round(n * 100) / 100;
  return {
    mean: round(sorted.reduce((sum, n) => sum + n, 0) / Math.max(1, sorted.length)),
    p95: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    max: round(sorted[sorted.length - 1] ?? 0),
  };
};

export async function runLookdev(params: URLSearchParams, frame: HTMLElement): Promise<void> {
  await Promise.all(
    (["roman", "italic", "sc"] as const).map((face) =>
      document.fonts.load(fontOf(face, 24), "Idlin"),
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  frame.append(canvas);
  const fit = (): void => {
    const scale = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
    frame.style.width = `${WIDTH}px`;
    frame.style.height = `${HEIGHT}px`;
    frame.style.transform = `scale(${scale})`;
  };
  fit();
  addEventListener("resize", fit);

  const paper = makePaper();
  const surface: Surface =
    params.get("renderer") === "canvas"
      ? new CanvasSurface(canvas, paper)
      : new GlSurface(canvas, paper);
  const d = new Draw(surface);
  const scene = makeScene(params.get("lookdev") || "deck");
  const draw = (seconds: number): void => {
    surface.begin();
    d.reset();
    scene.draw(d, seconds);
    surface.end(scene.cast ? scene.cast(seconds) : 0xffffff);
  };

  if (params.has("capture")) {
    window.lookdev = {
      scenes: SCENES,
      duration: scene.duration,
      draw,
      bench(frames, from) {
        const build: number[] = [];
        const whole: number[] = [];
        // A few frames first, so lettering and buffers are in place.
        for (let i = 0; i < 5; i++) draw(from);
        surface.finish();
        for (let i = 0; i < frames; i++) {
          const start = performance.now();
          draw(from + i / 60);
          const built = performance.now();
          surface.finish();
          const done = performance.now();
          build.push(built - start);
          whole.push(done - start);
        }
        return {
          renderer: surface.kind,
          frames,
          build: summary(build),
          whole: summary(whole),
          vertices: surface.vertices,
        };
      },
    };
    draw(0);
    document.body.dataset.ready = "1";
    return;
  }

  const from = Number.parseFloat(params.get("t") ?? "0") || 0;
  const start = performance.now();
  const loop = (now: number): void => {
    draw((from + (now - start) / 1000) % scene.duration);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
