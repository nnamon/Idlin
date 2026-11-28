// Times the JavaScript that builds a look-development frame, outside a
// browser: the scene laid through Draw into the WebGL surface's vertex arrays,
// with a stand-in context that does nothing. It is the same 240 frames from
// ten seconds into `expedition150` that the capture tool's bench draws, with
// no GPU in the way, so it measures what decides whether a frame can be built
// in time on any machine.
//
//   docker compose run --rm dev node packages/client/scripts/bench.ts [scene] [--from <s>] [--frames <n>] [--profile <file>]
//
// --profile writes a CPU profile of the timed frames, for Chrome's DevTools.

import { writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { Draw } from "../src/lookdev/draw.ts";
import { makeScene } from "../src/lookdev/scenes.ts";
import { GlSurface, measure } from "../src/lookdev/surface.ts";

const args = process.argv.slice(2);
const option = (name: string, fallback: number): number => {
  const at = args.indexOf(name);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
const name = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const from = option("--from", 10);
const frames = option("--frames", 240);

// A context that takes every call and does nothing with it, and a 2D context that measures as
// `measure` guesses outside a browser.
const nothing: unknown = new Proxy(() => nothing, {
  get: (_, key) => (key === Symbol.toPrimitive ? () => 0 : nothing),
  apply: () => nothing,
});
const flat = {
  measureText: (s: string) => ({ width: s.length * 24 * 0.46 }),
  getImageData: (_x: number, _y: number, w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
  }),
};
const ctx2d = new Proxy(flat, {
  get: (target, key) => (key in target ? target[key as keyof typeof flat] : () => undefined),
  set: () => true,
});
const canvas = (): unknown => ({
  width: 0,
  height: 0,
  getContext: (kind: string) => (kind === "2d" ? ctx2d : nothing),
  addEventListener: () => undefined,
});
(globalThis as { document?: unknown }).document = { createElement: canvas };

const surface = new GlSurface(canvas() as HTMLCanvasElement, canvas() as HTMLCanvasElement);
const d = new Draw(surface);
const scene = makeScene(name ?? "expedition150");
const draw = (t: number): void => {
  surface.begin();
  d.reset();
  scene.draw(d, t);
  surface.end(scene.cast ? scene.cast(t) : 0xffffff);
};
measure("roman", 24, "warm");
for (let i = 0; i < 5; i++) draw(from);
// With --profile <file>, a CPU profile of the timed frames alone.
const profileTo = args[args.indexOf("--profile") + 1];
const session = args.includes("--profile") ? new Session() : null;
if (session) {
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.start");
}
const times: number[] = [];
for (let i = 0; i < frames; i++) {
  const start = performance.now();
  draw(from + i / 60);
  times.push(performance.now() - start);
}
if (session && profileTo) {
  const { profile } = await session.post("Profiler.stop");
  writeFileSync(profileTo, JSON.stringify(profile));
}
times.sort((a, b) => a - b);
const round = (n: number): number => Math.round(n * 100) / 100;
const load = scene.probe?.(from) as
  | { out: number; aboard: number; monsters: number; shots?: number; airborne?: number }
  | undefined;
console.log(
  JSON.stringify({
    scene: name ?? "expedition150",
    from,
    frames,
    mean: round(times.reduce((s, n) => s + n, 0) / times.length),
    p95: round(times[Math.floor(times.length * 0.95)] ?? 0),
    max: round(times.at(-1) ?? 0),
    vertices: surface.vertices,
    load: load && {
      out: load.out,
      aboard: load.aboard,
      monsters: load.monsters,
      inAir: (load.shots ?? 0) + (load.airborne ?? 0),
    },
  }),
);
