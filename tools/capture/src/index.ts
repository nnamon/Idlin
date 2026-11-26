// Takes pictures of the viewer. Serves the built client from disk, opens it in
// headless Chromium in capture mode (the page draws only when told to), steps
// the world to each requested moment and saves a frame.
//
//   node tools/capture/src/index.ts <out-dir> [name:hour[:ticks]]...
//
// `hour` is the game hour the world is run forward to before the page draws;
// `ticks` are stepped after that, one frame saved at the end.

import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const DIST = new URL("../../../packages/client/dist/", import.meta.url).pathname;
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".json": "application/json",
};

const [outDir = "captures/manual", ...shots] = process.argv.slice(2);
const wanted = shots.length > 0 ? shots : ["dawn:6", "noon:12", "dusk:19", "midnight:0"];

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

type Idlin = { advance(ticks: number): void; brightness(): number[] };

/** Opens the viewer in capture mode at a game hour and waits until it has drawn its first frame. */
async function open(hour: number | string): Promise<void> {
  await page.goto(`${origin}/?capture&seed=1&hour=${hour}`);
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

// A first, rough flicker measure, for the world canvas only (not the text over
// it). For every game hour it steps 40 ticks and reports the largest share of
// tiles whose mean brightness changed by more than 8 (of 255) from one tick to
// the next. A tick is a tenth of a second, about six frames on a stream, so
// this over-counts what a viewer sees between two frames, and it counts a
// character walking with its light as change. It catches a light that jumps.
await page.setViewportSize({ width: 1920, height: 1080 });
let worst = { share: 0, hour: 0 };
for (let hour = 0; hour < 24; hour++) {
  await open(hour);
  const share = await page.evaluate(() => {
    const api = (window as unknown as { idlin: Idlin }).idlin;
    let most = 0;
    let before = api.brightness();
    for (let i = 0; i < 40; i++) {
      api.advance(1);
      const after = api.brightness();
      const changed = after.filter(
        (value, k) => Math.abs(value - (before[k] as number)) > 8,
      ).length;
      most = Math.max(most, changed / after.length);
      before = after;
    }
    return most;
  });
  if (share > worst.share) worst = { share, hour };
}
console.log(
  `tick-to-tick change: ${(worst.share * 100).toFixed(2)}% of tiles at the worst hour (${worst.hour}:00)`,
);
if (worst.share > 0.05) problems.push(`tick-to-tick change ${worst.share} is over 5% of tiles`);

await browser.close();
server.close();
if (problems.length > 0) {
  console.error(`page errors:\n${problems.join("\n")}`);
  process.exit(1);
}
