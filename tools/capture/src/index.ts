// Takes pictures of the viewer. Serves the built client from disk, opens it in
// headless Chromium in capture mode (the page draws only when told to), steps
// the world to each requested moment and saves a frame.
//
//   node tools/capture/src/index.ts <out-dir> [name:hour[:ticks[:width]]]...
//   node tools/capture/src/index.ts <out-dir> --review [--baseline <dir>]
//
// The first form saves the named frames: `hour` is the game hour the world is
// run forward to before the page draws, `ticks` are stepped after that.
//
// `--review` writes what docs/watch-rubric.md asks for: storyboard.png,
// burst.png, daystrip.png, crowd-12/50/150.png, metrics.json, and a
// `showcase` folder for the README. With `--baseline`, also compare.png: that
// folder's storyboard above this one. Everything comes from seed 1, so two
// runs of the same code give the same files.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { parseArgs } from "./args.ts";
import { FLICKER_LIMIT, flickerIndex } from "./flicker.ts";
import { watchMetrics } from "./metrics.ts";
import { decodePng, encodeGif, encodePng, grid, half, type Image, stack } from "./sheet.ts";
import { busiest, play } from "./simrun.ts";

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

/** Opens the viewer in capture mode at a game hour and waits until it has drawn its first frame. */
async function open(hour: number | string, residents = 6): Promise<void> {
  await page.goto(`${origin}/?capture&seed=1&hour=${hour}&crowd=${residents}`);
  await page.waitForSelector("body[data-ready], body[data-error]", { timeout: 30_000 });
  const failure = await page.evaluate(() => document.body.dataset.error ?? null);
  if (failure !== null) throw new Error(`the viewer failed to start: ${failure}`);
}

for (const shot of wanted) {
  // name:hour[:ticks[:width]] — a width other than 1920 shows the frame as a smaller window would.
  const [name = "shot", hour = "6", ticks = "0", width = "1920"] = shot.split(":");
  await page.setViewportSize({
    width: Number(width),
    height: Math.round((Number(width) * 9) / 16),
  });
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
// frames, at the hours where most changes at once: deep night, daybreak, the
// lamps going out, noon, the lamps coming on, nightfall, late evening. A
// stream shows about six frames to a tick, so the frames are a sixth of a tick
// apart.
const FLICKER_HOURS = [0, 5.9, 6.6, 12, 18.5, 20.05, 22];
await page.setViewportSize({ width: 1920, height: 1080 });
let worst = { index: 0, hour: 0 };
for (const hour of FLICKER_HOURS) {
  await open(hour);
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
  const DAY = 24 * 600;
  // The world the page shows, run here as well for the numbers the picture cannot give.
  const sim: Record<string, ReturnType<typeof watchMetrics>> = {};
  let busiestTick = 0;
  for (const residents of [6, 12, 50, 150]) {
    const record = play(1, residents, DAY);
    sim[residents] = watchMetrics(record);
    if (residents === 6) busiestTick = busiest(record, 20);
  }

  // Storyboard: two minutes from 19:20, through the lamps coming on and nightfall.
  await open(19.33);
  const storyboard = grid(await run(12, 100, 0.5), 4);
  await save("storyboard.png", encodePng(storyboard));

  // Burst: twelve rendered frames in a row from the busiest two seconds of the day.
  await open(6);
  await advance(busiestTick);
  await save("burst.png", encodePng(grid(await run(12, 1 / 6, 0.5), 4)));

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
  ];
  const crowdFindings = [12, 50, 150].flatMap((residents) =>
    (sim[residents]?.hardFails ?? []).map((fail) => `${residents} residents: ${fail}`),
  );
  const metrics = {
    seed: 1,
    flicker: { index: worst.index, worstHour: worst.hour, limit: FLICKER_LIMIT },
    busiestTick,
    // One game day per population.
    sim,
    pacing: "n/a: there are no trips, deaths or drops yet (#195, #196, #197)",
    acknowledgment: "n/a: there is no ticker or spotlight yet (#198)",
    spotlightWait: "n/a: there is no spotlight yet (#198)",
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
