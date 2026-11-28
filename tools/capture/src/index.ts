// Takes pictures of the viewer. Serves the built client from disk, opens it in
// headless Chromium in capture mode (the page draws only when told to), runs
// the city to each requested tick and saves a frame.
//
//   node tools/capture/src/index.ts <out-dir> [--chat <crowd>] [name:tick[:width[:height]]]...
//   node tools/capture/src/index.ts <out-dir> --review [--baseline <dir>]
//
// The first form saves the named frames: `tick` is how far the city is run
// from its first 0:00 before the page draws. With `--chat crowd-15` the page
// reads content/chat/crowd-15.txt as its chat (`?chat=crowd-15`), and the
// crowd's chatters are the citizens.
//
// `--review` writes storyboard.png, a frame from each beat of the first cycle
// and the next legs-plant; storyboard-640.png, the same as a 640-wide window
// shows it; metrics.json; and a `showcase` folder for the README. With
// `--baseline`, also compare.png: that folder's storyboard above this one.
// Everything comes from seed 1 with the 15-chatter crowd, so two runs of the
// same code give the same files. The view is the plain one of slice piece 2a;
// piece 2b brings back the figures, fights and crowd sheets the review had in
// the camp world.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium } from "playwright";
import { parseArgs } from "./args.ts";
import { FLICKER_LIMIT, flickerIndex } from "./flicker.ts";
import { captureLookdev, LOOKDEV_SCENES } from "./lookdev.ts";
import { decodePng, encodePng, grid, half, type Image, stack } from "./sheet.ts";

/** The crowd every review hears, so a player's one citizen is among others. */
const REVIEW_CHAT = "crowd-15";
/**
 * The storyboard's moments, in ticks from the first 0:00: transit, the raid
 * window, legs-plant, the ramp down, the peace, the scouts, the front, the
 * march, the siege, the stand-in break, lift-off and the next legs-plant
 * (cycle.ts). The break is the shield's stand-in until slice piece 31.
 */
const STORYBOARD = [300, 900, 1800, 2001, 3000, 3900, 4800, 5700, 6450, 8850, 9150, 10_950];

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
const { outDir, review, baseline, shots: wanted, chat, lookdev, stills } = args;
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
  state(): { tick: number; beat: string; actors: { id: number; name: string }[] };
};

/** Opens the viewer in capture mode with the city run on to `tick`, and waits for its first frame. */
async function open(tick: number, crowd: string | null = chat): Promise<void> {
  const people = crowd === null ? "" : `&chat=${crowd}`;
  await page.goto(`${origin}/?capture&seed=1&tick=${tick}${people}`);
  await page.waitForSelector("body[data-ready], body[data-error]", { timeout: 60_000 });
  const failure = await page.evaluate(() => document.body.dataset.error ?? null);
  if (failure !== null) throw new Error(`the viewer failed to start: ${failure}`);
}

// The look-development scenes have no world behind them, so they are a run of their own.
if (lookdev !== null) {
  const scenes = lookdev.includes("all") ? LOOKDEV_SCENES : lookdev;
  await captureLookdev(page, origin, scenes, stills, async (name, bytes) => {
    await writeFile(join(outDir, name), bytes);
    console.log(`saved ${join(outDir, name)}`);
  });
  await browser.close();
  server.close();
  if (problems.length > 0) console.error(`page errors:\n${problems.join("\n")}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

for (const shot of wanted) {
  // name:tick[:width[:height]]. A width other than 1920 shows the frame as a smaller
  // window would; a height that is not 9/16 of it shows how the frame fills another shape.
  const [name = "shot", tick = "0", width = "1920", height] = shot.split(":");
  const size = {
    width: Number(width),
    height: height === undefined ? Math.round((Number(width) * 9) / 16) : Number(height),
  };
  const whole = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 8000;
  if (
    !whole(size.width) ||
    !whole(size.height) ||
    !(Number.isInteger(Number(tick)) && Number(tick) >= 0)
  ) {
    console.error(`"${shot}" is not name:tick[:width[:height]] with sizes from 1 to 8000`);
    await browser.close();
    server.close();
    process.exit(2);
  }
  await page.setViewportSize(size);
  await open(Number(tick));
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log(`saved ${join(outDir, `${name}.png`)}`);
}

/** The frame as the page has just drawn it, scaled. */
async function frame(scale: number): Promise<Image> {
  const { width, height, rgba } = await page.evaluate(
    (k) => (window as unknown as { idlin: Idlin }).idlin.pixels(k),
    scale,
  );
  return { width, height, data: new Uint8Array(Buffer.from(rgba, "base64")) };
}

/** Brightness grids of thirteen frames a sixth of a tick apart, from where the page is now. */
const grids = (): Promise<number[][]> =>
  page.evaluate(() => {
    const api = (window as unknown as { idlin: Idlin }).idlin;
    const seen = [api.brightness()];
    for (let i = 0; i < 12; i++) {
      api.advance(1 / 6);
      seen.push(api.brightness());
    }
    return seen;
  });

const hashes: Record<string, string> = {};
async function save(name: string, bytes: Uint8Array): Promise<void> {
  await mkdir(join(outDir, name, ".."), { recursive: true });
  await writeFile(join(outDir, name), bytes);
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
  console.log(`saved ${join(outDir, name)}`);
}

if (review) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const frames: Image[] = [];
  const beats: { tick: number; beat: string; citizens: number }[] = [];
  let worst = { index: 0, tick: 0 };
  for (const tick of STORYBOARD) {
    await open(tick, REVIEW_CHAT);
    const state = await page.evaluate(() => (window as unknown as { idlin: Idlin }).idlin.state());
    beats.push({ tick: state.tick, beat: state.beat, citizens: state.actors.length });
    frames.push(await frame(1));
    // How much of the frame changes brightness sharply between frames a sixth of a tick apart.
    const index = flickerIndex(await grids());
    if (index > worst.index) worst = { index, tick };
  }
  const storyboard = grid(
    frames.map((f) => half(f)),
    4,
  );
  await save("storyboard.png", encodePng(storyboard));
  await page.setViewportSize({ width: 640, height: 360 });
  const small: Image[] = [];
  for (const tick of STORYBOARD) {
    await open(tick, REVIEW_CHAT);
    small.push(decodePng(await page.screenshot()));
  }
  await save("storyboard-640.png", encodePng(grid(small, 4)));
  await page.setViewportSize({ width: 1920, height: 1080 });
  for (const [name, index] of [
    ["transit", 0],
    ["landing", 4],
    ["siege", 8],
  ] as const)
    await save(`showcase/${name}.png`, encodePng(frames[index] as Image));
  await save("showcase/storyboard.png", encodePng(half(storyboard)));
  if (before) await save("compare.png", encodePng(stack([before, storyboard])));

  console.log(
    `flicker index: ${(worst.index * 100).toFixed(2)}% of the frame at worst (tick ${worst.tick})`,
  );
  const hardFails = [
    ...(worst.index > FLICKER_LIMIT
      ? [`flicker index ${worst.index} is over ${FLICKER_LIMIT} of the frame`]
      : []),
    ...problems.map((problem) => `page error: ${problem}`),
  ];
  const metrics = {
    seed: 1,
    chat: REVIEW_CHAT,
    view: "plain (slice piece 2a); piece 2b draws the deck and the landing",
    beats,
    flicker: { index: worst.index, worstAt: worst.tick, limit: FLICKER_LIMIT },
    consoleErrors: problems,
    hardFails,
    images: hashes,
  };
  await writeFile(join(outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`saved ${join(outDir, "metrics.json")}`);
  for (const fail of hardFails) console.log(`hard fail: ${fail}`);
}

await browser.close();
server.close();
if (problems.length > 0) console.error(`page errors:\n${problems.join("\n")}`);
if (problems.length > 0) process.exit(1);
