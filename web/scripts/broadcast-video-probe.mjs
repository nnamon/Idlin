// Record the live broadcast as VIDEO, then extract frames + a motion metric.
import { chromium } from '/Users/amon/projects/idlin/Idlin/web/node_modules/@playwright/test/index.mjs';
const secs = Number(process.argv[2] ?? 30);
const out = process.argv[3] ?? '/tmp/vidtest/run';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto('http://localhost:7777');
await page.waitForTimeout(secs * 1000);
await ctx.close(); await browser.close();
console.log('recorded', secs, 's');
// Usage: node web/scripts/broadcast-video-probe.mjs <seconds> <outdir>
// Then: ffmpeg -i <outdir>/*.webm -vf fps=1 f/%02d.png and diff consecutive
// frames (PIL mean-abs-delta) — the STABLE-CAMERA bar: median < 2 (sprites
// only), flips as isolated single-second spikes. ALWAYS run this before any
// claim about camera behavior (operator order, 2026-07-11: watch it as
// actual video — stills and wire taps cannot see motion).
