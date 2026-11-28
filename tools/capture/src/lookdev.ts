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
  /** More bursts, saved as `<scene>-<name>-burst.png`. */
  readonly bursts?: Readonly<Record<string, number>>;
  /** A clip from one moment to another, at this many frames a second. */
  readonly clip: readonly [from: number, to: number, fps: number];
}

/** What to shoot of each scene. Times are seconds into it. */
export const PLANS: Readonly<Record<string, Plan>> = {
  // deck-2 is half a gait (2.8 s) after deck-1.
  deck: { stills: [2.2, 5.0], burst: 3, clip: [0, 5.6, 10] },
  deck150: { stills: [2.2], burst: 3, clip: [0, 2, 10] },
  deckside: { stills: [2.2], burst: 3, clip: [0, 2, 10] },
  // Mockups for #445, one still each.
  "raid-a": { stills: [3], burst: 3, clip: [0, 1, 4] },
  "raid-b": { stills: [3], burst: 3, clip: [0, 1, 4] },
  "raid-c": { stills: [3], burst: 3, clip: [0, 1, 4] },
  reveal: { stills: [2, 6, 8, 11, 16, 28], burst: 6, clip: [0, 30, 6] },
  // The burst is round the elite's blow at 14 s.
  // The second burst is the mow at the nest, as the firepot lands at 5 s.
  expedition: { stills: [4, 14, 21, 34], burst: 13.8, bursts: { mow: 4.9 }, clip: [3, 15, 10] },
  "expedition-b": { stills: [14], burst: 13.8, clip: [12, 15, 10] },
  expedition150: { stills: [10, 25], burst: 10, clip: [9, 12, 10] },
  // The shield at full, half and near break, the break and the run, the ramp going up. The
  // bursts are the lamps lighting at the march and the break.
  siege: {
    stills: [13, 28, 40, 44, 57],
    burst: 27.8,
    bursts: { light: 1.95, break: 41.95 },
    clip: [0, 60, 4],
  },
  siege150: { stills: [28, 44], burst: 27.8, clip: [24, 48, 4] },
  "shield-levels": { stills: [0.5], burst: 0.5, clip: [0, 1, 4] },
  beasts: { stills: [1], burst: 1, clip: [0, 1, 10] },
  figures: { stills: [1], burst: 1, clip: [0, 1, 10] },
  scale: { stills: [1], burst: 1, clip: [0, 1, 10] },
};

export const LOOKDEV_SCENES = Object.keys(PLANS);
/** The scene the renderers are timed on. */
export const BENCH = "expedition150";

type Lookdev = {
  duration: number;
  draw(seconds: number): void;
  bench(frames: number, from: number): unknown;
  counts(seconds: number): unknown;
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
    const counts: Record<string, unknown> = {};
    for (const [i, at] of plan.stills.entries()) {
      const frame = await shot(at);
      await save(`${scene}-${i + 1}.png`, encodePng(frame));
      await save(`${scene}-${i + 1}-640.png`, encodePng(shrink(frame, 3)));
      counts[`${scene}-${i + 1}`] = {
        t: at,
        ...((await page.evaluate(
          (s) => (window as unknown as { lookdev: Lookdev }).lookdev.counts(s),
          at,
        )) as object),
      };
    }
    // What the scene says it has in each still: who is out and aboard, and how many monsters are alive.
    await save(`${scene}.json`, new TextEncoder().encode(`${JSON.stringify(counts, null, 2)}\n`));
    if (stillsOnly) continue;
    for (const [name, at] of [["", plan.burst] as const, ...Object.entries(plan.bursts ?? {})]) {
      const burst: Image[] = [];
      for (let i = 0; i < 12; i++) burst.push(half(await shot(at + i / 60)));
      await save(`${scene}${name ? `-${name}` : ""}-burst.png`, encodePng(grid(burst, 4)));
    }
    const [from, to, fps] = plan.clip;
    const board: Image[] = [];
    for (let i = 0; i < 12; i++) board.push(shrink(await shot(from + ((to - from) * i) / 11), 3));
    await save(`${scene}-board.png`, encodePng(grid(board, 4)));
    const clip: Image[] = [];
    for (let t = from; t < to; t += 1 / fps) clip.push(shrink(await shot(t), 3));
    await save(`${scene}.gif`, encodeGif(clip, Math.round(1000 / fps)));
  }
  // The bench is `expedition150` on both renderers: 150 citizens, 450
  // monsters and what is in the air, 240 frames from ten seconds in. It runs
  // only when that scene was asked for.
  if (stillsOnly || !scenes.includes(BENCH)) return;
  const results: unknown[] = [];
  for (const renderer of ["webgl", "canvas"]) {
    await open(BENCH, `&renderer=${renderer}`);
    results.push(
      await page.evaluate(() => (window as unknown as { lookdev: Lookdev }).lookdev.bench(240, 10)),
    );
    await save(`bench-${renderer}.png`, encodePng(await shot(10)));
  }
  console.log(JSON.stringify(results, null, 2));
  await save("bench.json", new TextEncoder().encode(`${JSON.stringify(results, null, 2)}\n`));
}
