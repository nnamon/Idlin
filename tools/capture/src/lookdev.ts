// Shoots the look-development page (`?lookdev=<scene>`): stills of each scene
// at 1920 and as a 640-wide stream shows them, a burst of twelve frames a
// sixtieth of a second apart, a storyboard across the scene, a short clip,
// and the frame times of the bench scene on both renderers.
//
// The 640 stills are the 1920 frame averaged down three to one, which is what
// a viewer's player does to a stream.

import type { Page } from "playwright";
import { decodePng, encodeGif, encodePng, grid, half, type Image, shrink } from "./sheet.ts";

interface Plan {
  /** Seconds into the scene of each still. */
  readonly stills: readonly number[];
  /** Where the burst starts. */
  readonly burst: number;
  /** A clip from one moment to another, at this many frames a second. */
  readonly clip: readonly [from: number, to: number, fps: number];
}

/** What to shoot of each scene. Times are seconds into it. */
export const PLANS: Readonly<Record<string, Plan>> = {
  deck: { stills: [2.2, 5.1], burst: 3, clip: [0, 5, 10] },
  deck150: { stills: [2.2], burst: 3, clip: [0, 2, 10] },
  reveal: { stills: [1.2, 3.4, 5.2, 7, 10.5, 13], burst: 4.2, clip: [0, 12, 10] },
  reveal150: { stills: [13], burst: 9, clip: [8, 11, 10] },
  fight: { stills: [4.05, 9.1, 15.3], burst: 4, clip: [3, 9, 12.5] },
  fight150: { stills: [9.1], burst: 9, clip: [8, 10, 12.5] },
  mockA: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  mockB: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  mockC: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  mockD: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  denser: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  bigger: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  smallcity: { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  "siege-dome": { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  "siege-ring": { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  "siege-wall": { stills: [0.5], burst: 0.5, clip: [0, 1, 10] },
  figures: { stills: [1], burst: 1, clip: [0, 1, 10] },
  scale: { stills: [1], burst: 1, clip: [0, 1, 10] },
};

export const LOOKDEV_SCENES = Object.keys(PLANS);

type Lookdev = {
  duration: number;
  draw(seconds: number): void;
  bench(frames: number, from: number): unknown;
};

export async function captureLookdev(
  page: Page,
  origin: string,
  scenes: readonly string[],
  stillsOnly: boolean,
  save: (name: string, bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const open = async (scene: string, extra = ""): Promise<void> => {
    await page.goto(`${origin}/?lookdev=${scene}&capture${extra}`);
    await page.waitForSelector("body[data-ready], body[data-error]", { timeout: 60_000 });
    const failure = await page.evaluate(() => document.body.dataset.error ?? null);
    if (failure !== null) throw new Error(`the look-development page failed to start: ${failure}`);
  };
  const shot = async (seconds: number): Promise<Image> => {
    await page.evaluate(
      (t) => (window as unknown as { lookdev: Lookdev }).lookdev.draw(t),
      seconds,
    );
    return decodePng(await page.screenshot());
  };

  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const scene of scenes) {
    const plan = PLANS[scene];
    if (!plan) throw new Error(`no look-development scene called ${scene}`);
    await open(scene);
    for (const [i, at] of plan.stills.entries()) {
      const frame = await shot(at);
      await save(`${scene}-${i + 1}.png`, encodePng(frame));
      await save(`${scene}-${i + 1}-640.png`, encodePng(shrink(frame, 3)));
    }
    if (stillsOnly) continue;
    const burst: Image[] = [];
    for (let i = 0; i < 12; i++) burst.push(half(await shot(plan.burst + i / 60)));
    await save(`${scene}-burst.png`, encodePng(grid(burst, 4)));
    const [from, to, fps] = plan.clip;
    const board: Image[] = [];
    for (let i = 0; i < 12; i++) board.push(shrink(await shot(from + ((to - from) * i) / 11), 3));
    await save(`${scene}-board.png`, encodePng(grid(board, 4)));
    const clip: Image[] = [];
    for (let t = from; t < to; t += 1 / fps) clip.push(shrink(await shot(t), 3));
    await save(`${scene}.gif`, encodeGif(clip, Math.round(1000 / fps)));
  }
  if (stillsOnly) return;

  // The bench scene on both renderers: 150 citizens, 450 monsters, 100
  // projectiles and the ink they throw, 240 frames from two seconds in.
  const results: unknown[] = [];
  for (const renderer of ["webgl", "canvas"]) {
    await open("bench", `&renderer=${renderer}`);
    results.push(
      await page.evaluate(() => (window as unknown as { lookdev: Lookdev }).lookdev.bench(240, 2)),
    );
    await save(`bench-${renderer}.png`, encodePng(await shot(4)));
  }
  console.log(JSON.stringify(results, null, 2));
  await save("bench.json", new TextEncoder().encode(`${JSON.stringify(results, null, 2)}\n`));
}
