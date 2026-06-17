import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./manifest";

const SHOTS_DIR = join(import.meta.dirname, "shots");
mkdirSync(SHOTS_DIR, { recursive: true });

// Fixed render conditions so a pixel only moves on an intentional UI change.
const CONTEXT: BrowserContextOptions = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
  reducedMotion: "reduce",
};

/** Load a fixture and await its explicit frame-ready signal (never a sleep). */
async function loadFixture(browser: Browser, name: string) {
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html?fixture=${name}`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );
  return { ctx, page };
}

/** What we screenshot for a fixture: the overlay HUD, or the 3D canvas. */
function shotTarget(page: Page, kind: "overlay" | "scene") {
  return kind === "overlay" ? page.locator("#overlay") : page.locator("#scene canvas");
}

test("fixture registry and manifest cover exactly the same fixtures", async ({ browser }) => {
  // The browser registry (src/harness/fixtures.ts) is the source of truth; the
  // Node manifest (harness/manifest.ts) supplies each fixture's assertions. If
  // they drift, a fixture gets added or captured WITHOUT a check (or a manifest
  // entry points at nothing) — this fails on either-direction drift.
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html`);
  const handle = await page.waitForFunction(
    () => (window as unknown as { __harnessRegistry?: string[] }).__harnessRegistry,
  );
  const browserNames = (await handle.jsonValue()) as string[];
  await ctx.close();
  expect([...browserNames].sort()).toEqual([...FIXTURES.map((f) => f.name)].sort());
});

for (const fx of FIXTURES) {
  test(`${fx.name}: renders the fixture and captures a shot`, async ({ browser }) => {
    const { ctx, page } = await loadFixture(browser, fx.name);
    const target = shotTarget(page, fx.kind);
    if (fx.kind === "overlay") {
      // Non-vacuous: the authored content must actually be on screen, or a
      // broken injection would shoot a blank panel and still "pass".
      for (const needle of fx.expect) await expect(target).toContainText(needle);
    }
    const buf = await target.screenshot({ path: join(SHOTS_DIR, `${fx.name}.png`) });
    if (fx.kind === "scene") {
      // Non-vacuous for a canvas: a black/cleared frame compresses tiny, so a
      // failed render (assets missing, GL lost) trips this. Eyeball for real.
      expect(buf.length).toBeGreaterThan(fx.minBytes);
    }
    await ctx.close();
  });

  test(`${fx.name}: capture is byte-stable across independent runs`, async ({ browser }) => {
    // Two independent captures must be byte-identical. The overlay renders only
    // from injected store state; the scene runs under a seeded Math.random and
    // a stepped virtual clock. This fails the moment nondeterminism (a
    // Math.random()/wall-clock value, an unseeded source) reaches the output.
    const shoot = async () => {
      const { ctx, page } = await loadFixture(browser, fx.name);
      const buf = await shotTarget(page, fx.kind).screenshot();
      await ctx.close();
      return buf;
    };
    expect(Buffer.compare(await shoot(), await shoot())).toBe(0);
  });

  if (fx.kind === "scene") {
    test(`${fx.name}: stepFrames advances the virtual clock monotonically`, async ({ browser }) => {
      // The fixture already stepped `frames`; a further step must move time
      // FORWARD, not rewind it (a non-cumulative stepFrames would restart near
      // zero and jump the absolute-`t` animations backward).
      const { ctx, page } = await loadFixture(browser, fx.name);
      const { before, after } = await page.evaluate(() => {
        const r = (
          window as unknown as {
            __harnessRenderer?: { stepFrames(n: number): void; virtualElapsedSeconds: number };
          }
        ).__harnessRenderer!;
        const before = r.virtualElapsedSeconds;
        r.stepFrames(10);
        return { before, after: r.virtualElapsedSeconds };
      });
      expect(after).toBeGreaterThan(before);
      await ctx.close();
    });
  }
}
