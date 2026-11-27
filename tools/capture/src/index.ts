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
// residents-6.png, figures.png and its crops, burst.png, drift.png, fight.png,
// fight-burst.png, fight-down.png, daystrip.png, crowd-12/50/150.png,
// crowd-50-levels.png, metrics.json, and a `showcase` folder for the README.
// With `--baseline`, also compare.png: that folder's storyboard above this
// one. Everything comes from seed 1 with 15 residents unless a sheet says
// otherwise, so two runs of the same code give the same files.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { ADVENTURER } from "@idlin/sim";
import { chromium } from "playwright";
import { DRIFT_TICKS } from "../../../packages/client/src/camera.ts";
import { DWELL_TICKS } from "../../../packages/client/src/director.ts";
import { TILE } from "../../../packages/client/src/ground.ts";
import { campRegion, viewSize } from "../../../packages/client/src/view.ts";
import { shippedWorld } from "../../../packages/sim/src/testing.ts";
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
import {
  blowAfter,
  busiest,
  crowdedMoment,
  drifts,
  fightIn,
  play,
  spotlightRun,
} from "./simrun.ts";

/** How many residents a capture runs, unless a sheet says otherwise: a crowd a player's one resident is among. */
const RESIDENTS = 15;

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
 * a spread of levels and of death counts, for the figures' kit and patches (a
 * viewer from before `?levels` or `?deaths` ignores it).
 */
async function open(
  hour: number | string,
  residents = RESIDENTS,
  monsters = false,
  levels = false,
): Promise<void> {
  const fight = `${monsters ? "&monsters" : ""}${levels ? "&levels&deaths" : ""}`;
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

// How much of the frame changes brightness sharply between two rendered
// frames, at the hours where most changes at once: deep night, daybreak and its
// page turn, the lamps going out, noon, the lamps coming on, nightfall, its
// page turn (20:06), late evening. A
// stream shows about six frames to a tick, so the frames are a sixth of a tick
// apart.
// With monsters, the same a tick before a blow lands in the fight the fight
// sheets show, and a tick before the first blow on the map after 19:00. Both
// are found in a day of the world with its monsters, as the page runs it, so
// a change to the world moves them with it.
const FLICKER_HOURS = [0, 5.9, 6.6, 12, 18.5, 20.05, 20.1, 22];
const DAY = 24 * 600;
/** Ticks from the page's start at 06:00 to `hour` the same day or, before 06:00, the next. */
const ticksTo = (hour: number): number => Math.round(((((hour - 6) % 24) + 24) % 24) * 600);
const fightRun = play(1, RESIDENTS, DAY, { monsters: true });
const fight = fightIn(fightRun);
const duskBlow = blowAfter(fightRun, ticksTo(19));
// Each moment is a hour for the page (`?hour=`) or a number of ticks from 06:00.
const flickerAt: { at: number; ticks: boolean; monsters: boolean }[] = [
  ...FLICKER_HOURS.map((hour) => ({ at: hour, ticks: false, monsters: false })),
  ...[fight?.blow, duskBlow].flatMap((blow) =>
    blow === undefined || blow === null
      ? []
      : [{ at: Math.max(0, blow - 1), ticks: true, monsters: true }],
  ),
];
// The figures sheet: from 07:00 to 09:00, the moment the map shows the most residents.
const FIGURES_SIZE = [720, 405] as const;
await page.setViewportSize({ width: 1920, height: 1080 });
let worst = { index: 0, at: "" };
for (const { at, ticks, monsters } of flickerAt) {
  await open(ticks ? 6 : at, RESIDENTS, monsters);
  if (ticks) await advance(at);
  const index = flickerIndex(await grids());
  const when = ticks ? `tick ${at} with monsters` : `${at}:00`;
  if (index > worst.index) worst = { index, at: when };
}
console.log(
  `flicker index: ${(worst.index * 100).toFixed(2)}% of the frame at worst (${worst.at})`,
);
const flickerFail =
  worst.index > FLICKER_LIMIT
    ? [`flicker index ${worst.index} is over ${FLICKER_LIMIT} of the frame`]
    : [];

if (review) {
  // Figures: the residents with a spread of levels and deaths, at the moment
  // from 07:00 to 09:00 when the map shows the most of them: the whole frame,
  // a crop round where they stand at twice the size, and the same as a
  // 640-wide window shows it, with its crop four times as large.
  const figuresRun = play(1, RESIDENTS, ticksTo(9), { monsters: false, levels: true });
  // A world without monsters has only residents in it.
  const first = figuresRun[0];
  const cast = new Set(
    [...(first?.actors ?? []), ...(first?.elsewhere?.actors ?? [])].map((a) => a.id),
  );
  const crowded = crowdedMoment(figuresRun, cast, ticksTo(7), ticksTo(9));
  const atlas = shippedWorld();
  const mapSize = viewSize(atlas, campRegion({ atlas }));
  const [cropWidth, cropHeight] = FIGURES_SIZE;
  const centre = (tiles: number, span: number, room: number): number =>
    Math.max(0, Math.min(room * TILE - span, Math.round(tiles * TILE + TILE / 2 - span / 2)));
  const figuresCrop = [
    centre(crowded.x, cropWidth, mapSize.width),
    centre(crowded.y, cropHeight, mapSize.height),
    cropWidth,
    cropHeight,
  ] as const;
  console.log(
    `figures: ${crowded.count} of ${RESIDENTS} residents on the map, ${crowded.tick} ticks after 06:00`,
  );
  await open(6, RESIDENTS, false, true);
  await advance(crowded.tick);
  const figures = await frame(1);
  await save("figures.png", encodePng(figures));
  await save("figures-crop.png", encodePng(enlarge(crop(figures, ...figuresCrop), 2)));
  await page.setViewportSize({ width: 640, height: 360 });
  await open(6, RESIDENTS, false, true);
  await advance(crowded.tick);
  const small = decodePng(await page.screenshot());
  await save("figures-640.png", encodePng(small));
  const [left, top, width, height] = figuresCrop.map((n) => n / 3) as [
    number,
    number,
    number,
    number,
  ];
  await save("figures-640-crop.png", encodePng(enlarge(crop(small, left, top, width, height), 4)));
  await page.setViewportSize({ width: 1920, height: 1080 });

  // The world the page shows, run here as well for the numbers the picture cannot give.
  const sim: Record<string, ReturnType<typeof watchMetrics>> = {};
  const spotlight: Record<string, ReturnType<typeof spotlightWait>> = {};
  let busiestTick = 0;
  let firstDrift: { from: number; to: number } | undefined;
  for (const residents of [6, 12, RESIDENTS, 50, 150]) {
    const record = play(1, residents, DAY);
    sim[residents] = watchMetrics(record);
    if (residents === RESIDENTS) {
      // The burst is two ticks long, so it is the busiest two ticks, from 07:00
      // on: in the first minutes everyone leaves camp at once, which a viewer
      // sees only once a day.
      busiestTick = ticksTo(7) + busiest(record.slice(ticksTo(7)), 2);
      firstDrift = drifts(record)[0];
    }
    // Three times the population times the dwell, as the rubric asks for this one.
    const watched = spotlightRun(1, residents, 3 * residents * DWELL_TICKS);
    spotlight[residents] = spotlightWait(watched.subjects, watched.names);
  }

  // Drift: the first time in the day the view drifts to another region, as
  // twelve frames from when it sets out to when it gets there, and the
  // flicker index over a sixth of a tick apart at the middle of its first
  // leg, where it goes fastest.
  const driftFail: string[] = [];
  let driftFlicker: { index: number; tick: number } | null = null;
  if (firstDrift) {
    const every = Math.ceil((firstDrift.to - firstDrift.from) / 11);
    await open(6);
    await advance(firstDrift.from);
    await save("drift.png", encodePng(grid(await run(12, every, 0.5), 4)));
    await open(6);
    const fastest = firstDrift.from + DRIFT_TICKS / 2 - 1;
    await advance(fastest);
    const index = flickerIndex(await grids());
    driftFlicker = { index, tick: fastest };
    console.log(`flicker index during a drift: ${(index * 100).toFixed(2)}% of the frame`);
    if (index > FLICKER_LIMIT)
      driftFail.push(`flicker index ${index} during a drift is over ${FLICKER_LIMIT} of the frame`);
  } else driftFail.push("the view never drifted to another region in the day");

  // Storyboard: two minutes from 19:20, through the lamps coming on and nightfall.
  await open(19.33);
  const storyboard = grid(await run(12, 100, 0.5), 4);
  await save("storyboard.png", encodePng(storyboard));
  // The first of those frames, full size, with the six residents the page was first built for.
  await open(19.33, 6);
  await save("residents-6.png", encodePng(await frame(1)));

  // Burst: twelve rendered frames in a row from the busiest two ticks of the
  // day. Twelve frames that are all the same show no motion, and are reported.
  await open(6);
  await advance(busiestTick);
  const burst = await run(12, 1 / 6, 0.5);
  await save("burst.png", encodePng(grid(burst, 4)));
  const same = (a: Image, b: Image): boolean =>
    a.data.length === b.data.length && a.data.every((value, i) => value === b.data[i]);
  const burstStill = burst.every((f) => same(f, burst[0] as Image));
  if (burstStill) console.log("the burst's twelve frames are all the same");

  // Fight: the world with its monsters, over twelve seconds of the first fight
  // in the day with a resident downed and a kill close together; then twelve
  // frames half a tick apart round the last blow on that resident, and twelve
  // half a second apart from its fall: the body lying there, and the fade-in
  // at camp.
  if (fight) {
    const sheets = [
      ["fight.png", Math.max(0, Math.min(fight.down, fight.kill) - 20), 10],
      ["fight-burst.png", Math.max(0, fight.blow - 3), 1 / 2],
      ["fight-down.png", Math.max(0, fight.down - 2), 5],
    ] as const;
    for (const [name, from, every] of sheets) {
      await open(6, RESIDENTS, true);
      await advance(from);
      await save(name, encodePng(grid(await run(12, every, 0.5), 4)));
    }
  } else console.log("no fight with a resident downed and a kill in the day: no fight sheets");

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
  // And 50 with a spread of levels, so the kit and the hats are seen in a crowd.
  await open(19.33, 50, false, true);
  await save("crowd-50-levels.png", encodePng(grid(await run(12, 100, 0.5), 4)));

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

  // Hard fails are judged with 15 residents, the crowd the captures show, and
  // with six, the world as it ships. What goes wrong in a larger or smaller
  // crowd is reported beside them: it answers how many residents one frame
  // can hold, and blocks nothing.
  const failsAt = (residents: number): string[] => [
    ...(sim[residents]?.hardFails ?? []),
    ...(spotlight[residents]?.hardFails ?? []),
  ];
  const hardFails = [
    ...flickerFail,
    ...driftFail,
    ...problems.map((problem) => `page error: ${problem}`),
    ...[RESIDENTS, 6].flatMap((residents) =>
      failsAt(residents).map((fail) => `${residents} residents: ${fail}`),
    ),
  ];
  const crowdFindings = [12, 50, 150].flatMap((residents) =>
    failsAt(residents).map((fail) => `${residents} residents: ${fail}`),
  );
  const metrics = {
    seed: 1,
    residents: RESIDENTS,
    flicker: { index: worst.index, worstAt: worst.at, limit: FLICKER_LIMIT },
    busiestTick,
    burstStill,
    // Ticks from 06:00 with 15 residents: the first drift between regions, and the flicker index in it.
    drift: firstDrift ? { ...firstDrift, flicker: driftFlicker } : null,
    // Ticks from 06:00, in the world with its monsters: the fight the fight sheets show, the first blow after 19:00.
    fight,
    duskBlow,
    // Residents downed in that game day of the world with its monsters, on the map shown or elsewhere.
    downs: fightRun
      .flatMap((r) => [...r.events, ...(r.elsewhere?.events ?? [])])
      .filter((e) => e.type === "down" && e.kind === ADVENTURER).length,
    // The figures sheet's moment, in ticks from 06:00, and how many residents the map shows then.
    figures: { tick: crowded.tick, onMap: crowded.count },
    // One game day per population.
    sim,
    pacing: "n/a: there are no trips, deaths or drops yet (#195, #196, #197)",
    acknowledgment: "n/a: no ticker, caption or spotlight names anyone on screen yet (#198)",
    // The director picks the subject and the map follows its region. Per population, a run of three times the population times the dwell.
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
