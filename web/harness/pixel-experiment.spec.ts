// THROWAWAY (#90 exploration): captures scene-shore at several retro-grade param
// combos to /tmp/pixel-exp for eyeballing. Not part of the committed harness —
// delete after the look is chosen. Run: pnpm exec playwright test pixel-experiment
import { test, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "/tmp/pixel-exp";
mkdirSync(OUT, { recursive: true });

const VARIANTS: { name: string; q: string }[] = [
  { name: "0-baseline", q: "" },
  { name: "1-pixel3", q: "pixel=3" },
  { name: "2-pixel4", q: "pixel=4" },
  { name: "3-pixel6", q: "pixel=6" },
  { name: "4-pixel4-poster10", q: "pixel=4&posterize=10" },
  { name: "5-pixel4-poster10-dither", q: "pixel=4&posterize=10&dither=1" },
];

async function shoot(browser: Browser, fixture: string, q: string, out: string) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html?fixture=${fixture}${q ? `&${q}` : ""}`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );
  await page.locator("#scene canvas").screenshot({ path: out, animations: "disabled" });
  await ctx.close();
}

for (const v of VARIANTS) {
  test(`pixel-exp ${v.name}`, async ({ browser }) => {
    await shoot(browser, "scene-shore", v.q, join(OUT, `${v.name}.png`));
  });
}

// One whole-game view (scene + crisp HUD) at a moderate setting, to judge how
// the DOM HUD AND the now-crisp in-scene text read over a pixelated scene.
test("pixel-exp full-shore-pixel4", async ({ browser }) => {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  await page.goto("/harness/fixture.html?fixture=full-shore&pixel=4");
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );
  await page.locator("body").screenshot({ path: join(OUT, "6-full-shore-pixel4.png") });
  await ctx.close();
});
