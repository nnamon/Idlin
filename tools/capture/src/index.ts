// Takes pictures of the viewer. Serves the built client from disk, opens it in
// headless Chromium in capture mode (the page draws only when told to), steps
// the world to each requested moment and saves a frame.
//
//   node tools/capture/src/index.ts <out-dir> [name:hour[:ticks[:width[:height]]]]...
//   node tools/capture/src/index.ts <out-dir> --review [--baseline <dir>]
//
// The first form saves the named frames: `hour` is the game hour the world is
// run forward to before the page draws, `ticks` are stepped after that.
//
// `--review` writes what docs/watch-rubric.md asks for: storyboard.png,
// figures.png and its crops, burst.png, fight.png, fight-burst.png, fight-down.png, daystrip.png,
// crowd-12/50/150.png, metrics.json, and a
// `showcase` folder for the README. With `--baseline`, also compare.png: that
// folder's storyboard above this one. Everything comes from seed 1, so two
// runs of the same code give the same files.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { DWELL_TICKS } from "../../../packages/client/src/director.ts";
import { parseArgs } from "./args.ts";
import { FLICKER_LIMIT, flickerIndex } from "./flicker.ts";
import { spotlightWait, watchMetrics } from "./metrics.ts";
import {
  crop,
  decodePng,
  encodeGif,
  encodePng,
  enlarge,
  grid,
  half,
  type Image,
  stack,
} from "./sheet.ts";
import { busiest, play, spotlightRun } from "./simrun.ts";

const DIST = new URL("../../../packages/client/dist/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".json": "application/json",
};

const args = parseArgs(process.argv.slice(2));
if (typeof args === "string") {
  console.error(args);
  process.exit(2);
}
const { outDir, review, baseline, shots: wanted } = args;
// Read the baseline before anything else, so a wrong folder fails at once and not after the run.
const before = baseline ? decodePng(await readFile(join(baseline, "storyboard.png"))) : null;

const server = createServer(async (request, response) => {
  // The URL parser resolves any ".." before this point, so the path stays inside the build folder.
  const path = new URL(request.url ?? "/", "http://x").pathname;
  const file = join(DIST, path === "/" ? "index.html" : path);
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (address === null || typeof address === "string") throw new Error("no port");
const origin = `http://127.0.0.1:${address.port}`;

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
const problems: string[] = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(String(error)));

type Idlin = {
  advance(ticks: number): void;
  brightness(): number[];
  pixels(scale: number): { width: number; height: number; rgba: string };
};

/**
 * Opens the viewer in capture mode at a game hour and waits until it has
 * drawn its first frame. With `monsters`, the world has the shipped monsters
 * in it, as it does not yet by default. With `levels`, the residents are given
 * a spread of levels (a viewer from before `?levels` ignores it).
 */
async function open(
  hour: number | string,
  residents = 6,
  monsters = false,
  levels = false,
): Promise<void> {
  const fight = `${monsters ? "&monsters" : ""}${levels ? "&levels" : ""}`;
  await page.goto(`${origin}/?capture&seed=1&hour=${hour}&crowd=${residents}${fight}`);
  await page.waitForSelector("body[data-ready], body[data-error]", { timeout: 30_000 });
  const failure = await page.evaluate(() => document.body.dataset.error ?? null);
  if (failure !== null) throw new Error(`the viewer failed to start: ${failure}`);
}

for (const shot of wanted) {
  // name:hour[:ticks[:width[:height]]]. A width other than 1920 shows the frame as a smaller
  // window would; a height that is not 9/16 of it shows how the frame fills another shape.
  const [name = "shot", hour = "6", ticks = "0", width = "1920", height] = shot.split(":");
  const size = {
    width: Number(width),
    height: height === undefined ? Math.round((Number(width) * 9) / 16) : Number(height),
  };
  const whole = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 8000;
  if (!whole(size.width) || !whole(size.height) || !(Number(ticks) >= 0)) {
    console.error(`"${shot}" is not name:hour[:ticks[:width[:height]]] with sizes from 1 to 8000`);
    await browser.close();
    server.close();
    process.exit(2);
  }
  await page.setViewportSize(size);
  await open(hour);
  await page.evaluate(
    (n) => (window as unknown as { idlin: Idlin }).idlin.advance(n),
    Number(ticks),
  );
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(`saved ${join(outDir, `${name}.png`)}`);
}

const advance = (ticks: number): Promise<void> =>
  page.evaluate((n) => (window as unknown as { idlin: Idlin }).idlin.advance(n), ticks);

/** The frame as the page has just drawn it, scaled. */
async function frame(scale: number): Promise<Image> {
  const { width, height, rgba } = await page.evaluate(
    (k) => (window as unknown as { idlin: Idlin }).idlin.pixels(k),
    scale,
  );
  return { width, height, data: new Uint8Array(Buffer.from(rgba, "base64")) };
}

/** Frames `every` ticks apart, starting from where the page is now. */
async function run(count: number, every: number, scale: number): Promise<Image[]> {
  const frames: Image[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) await advance(every);
    frames.push(await frame(scale));
  }
  return frames;
}

const hashes: Record<string, string> = {};
async function save(name: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(outDir, name, ".."), { recursive: true });
  await writeFile(join(outDir, name), bytes);
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
  console.log(`saved ${join(outDir, name)}`);
}

// How much of the frame changes brightness sharply between two rendered
// frames, at the hours where most changes at once: deep night, daybreak and its
// page turn, the lamps going out, noon, the lamps coming on, nightfall, its
// page turn (20:06), late evening. A
// stream shows about six frames to a tick, so the frames are a sixth of a tick
// apart.
// With monsters, the same at the fight the fight sheet shows (FIGHT_HOUR), a
// few ticks before a blow lands, and at a fight at night.
const FLICKER_HOURS = [0, 5.9, 6.6, 12, 18.5, 20.05, 20.1, 22];
const FIGHT_HOUR = 9.475;
const FLICKER_FIGHTS = [9.488, 22.52];
// The figures sheet: when, and the part of the 1920 by 1080 frame round the camp.
const FIGURES_HOUR = 7;
const FIGURES_TICKS = 0;
const FIGURES_CROP = [480, 300, 720, 405] as const;
await page.setViewportSize({ width: 1920, height: 1080 });
let worst = { index: 0, hour: 0 };
for (const [hour, monsters] of [
  ...FLICKER_HOURS.map((hour) => [hour, false] as const),
  ...FLICKER_FIGHTS.map((hour) => [hour, true] as const),
]) {
  await open(hour, 6, monsters);
  const grids = await page.evaluate(() => {
    const api = (window as unknown as { idlin: Idlin }).idlin;
    const seen = [api.brightness()];
    for (let i = 0; i < 12; i++) {
      api.advance(1 / 6);
      seen.push(api.brightness());
    }
    return seen;
  });
  const index = flickerIndex(grids);
  if (index > worst.index) worst = { index, hour };
}
console.log(
  `flicker index: ${(worst.index * 100).toFixed(2)}% of the frame at the worst hour (${worst.hour}:00)`,
);
const flickerFail =
  worst.index > FLICKER_LIMIT
    ? [`flicker index ${worst.index} is over ${FLICKER_LIMIT} of the frame`]
    : [];

if (review) {
  // Figures: twelve residents with a spread of levels, in the morning: the
  // whole frame, a close crop of the camp twice as large, and the same as a
  // 640-wide window shows it, with its crop four times as large.
  await open(FIGURES_HOUR, 12, false, true);
  await advance(FIGURES_TICKS);
  const figures = await frame(1);
  await save("figures.png", encodePng(figures));
  await save("figures-crop.png", encodePng(enlarge(crop(figures, ...FIGURES_CROP), 2)));
  await page.setViewportSize({ width: 640, height: 360 });
  await open(FIGURES_HOUR, 12, false, true);
  await advance(FIGURES_TICKS);
  const small = decodePng(await page.screenshot());
  await save("figures-640.png", encodePng(small));
  const [left, top, width, height] = FIGURES_CROP.map((n) => n / 3) as [
    number,
    number,
    number,
    number,
  ];
  await save("figures-640-crop.png", encodePng(enlarge(crop(small, left, top, width, height), 4)));
  await page.setViewportSize({ width: 1920, height: 1080 });

  const DAY = 24 * 600;
  // The world the page shows, run here as well for the numbers the picture cannot give.
  const sim: Record<string, ReturnType<typeof watchMetrics>> = {};
  const spotlight: Record<string, ReturnType<typeof spotlightWait>> = {};
  let busiestTick = 0;
  for (const residents of [6, 12, 50, 150]) {
    const record = play(1, residents, DAY);
    sim[residents] = watchMetrics(record);
    if (residents === 6) busiestTick = busiest(record, 20);
    // Three times the population times the dwell, as the rubric asks for this one.
    const watched = spotlightRun(1, residents, 3 * residents * DWELL_TICKS);
    spotlight[residents] = spotlightWait(watched.subjects, watched.names);
  }

  // Storyboard: two minutes from 19:20, through the lamps coming on and nightfall.
  await open(19.33);
  const storyboard = grid(await run(12, 100, 0.5), 4);
  await save("storyboard.png", encodePng(storyboard));

  // Burst: twelve rendered frames in a row from the busiest two seconds of the day.
  await open(6);
  await advance(busiestTick);
  await save("burst.png", encodePng(grid(await run(12, 1 / 6, 0.5), 4)));

  // Fight: the world with its monsters, over twelve seconds of a fight in the
  // morning with a kill and a resident downed in it; then twelve frames half a
  // tick apart round a blow landing.
  await open(FIGHT_HOUR, 6, true);
  await save("fight.png", encodePng(grid(await run(12, 10, 0.5), 4)));
  await open(FIGHT_HOUR, 6, true);
  await advance(6);
  await save("fight-burst.png", encodePng(grid(await run(12, 1 / 2, 0.5), 4)));
  // The resident downed in that fight, half a second apart: the fall, the
  // body lying there, and the fade-in at camp.
  await open(FIGHT_HOUR, 6, true);
  await advance(96);
  await save("fight-down.png", encodePng(grid(await run(12, 5, 0.5), 4)));

  // Day strip: six moments across the day.
  const strip: Image[] = [];
  for (const hour of [6.3, 9, 12, 16, 19.95, 0]) {
    await open(hour);
    await advance(60);
    strip.push(await frame(1 / 3));
  }
  const daystrip = grid(strip, 3);
  await save("daystrip.png", encodePng(daystrip));

  // Crowd sheets: the storyboard again with more residents.
  for (const residents of [12, 50, 150]) {
    await open(19.33, residents);
    await save(`crowd-${residents}.png`, encodePng(grid(await run(12, 100, 0.5), 4)));
  }

  // The README's set: four full frames and a short clip of night falling, at twice the speed.
  for (const [name, hour, ticks] of [
    ["dawn", 6.3, 0],
    ["noon", 12, 300],
    ["dusk", 19.3, 100],
    ["midnight", 0, 200],
  ] as const) {
    await open(hour);
    await advance(ticks);
    await save(`showcase/${name}.png`, encodePng(await frame(1)));
  }
  await open(19.75);
  await save("showcase/clip.gif", encodeGif(await run(60, 4, 0.25), 200));
  // Half size, to keep the README light.
  await save("showcase/storyboard.png", encodePng(half(storyboard)));
  await save("showcase/daystrip.png", encodePng(daystrip));

  if (before) await save("compare.png", encodePng(stack([before, storyboard])));

  // Hard fails are judged on the world as it ships, with six residents. What
  // goes wrong in a crowd is reported beside them: it answers how many
  // residents one frame can hold, and blocks nothing.
  const hardFails = [
    ...flickerFail,
    ...problems.map((problem) => `page error: ${problem}`),
    ...(sim[6]?.hardFails ?? []),
    ...(spotlight[6]?.hardFails ?? []),
  ];
  const crowdFindings = [12, 50, 150].flatMap((residents) =>
    [...(sim[residents]?.hardFails ?? []), ...(spotlight[residents]?.hardFails ?? [])].map(
      (fail) => `${residents} residents: ${fail}`,
    ),
  );
  const metrics = {
    seed: 1,
    flicker: { index: worst.index, worstHour: worst.hour, limit: FLICKER_LIMIT },
    busiestTick,
    // One game day per population.
    sim,
    pacing: "n/a: there are no trips, deaths or drops yet (#195, #196, #197)",
    acknowledgment: "n/a: no ticker, caption or spotlight names anyone on screen yet (#198)",
    // The director picks the subject; nothing draws it yet. Per population, a run of three times the population times the dwell.
    spotlightWait: spotlight,
    consoleErrors: problems,
    hardFails,
    crowdFindings,
    images: hashes,
  };
  await writeFile(join(outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`saved ${join(outDir, "metrics.json")}`);
  for (const fail of hardFails) console.log(`hard fail: ${fail}`);
  for (const finding of crowdFindings) console.log(`in a crowd: ${finding}`);
}

await browser.close();
server.close();
if (problems.length > 0) console.error(`page errors:\n${problems.join("\n")}`);
for (const fail of flickerFail) console.error(fail);
if (problems.length > 0 || flickerFail.length > 0) process.exit(1);
