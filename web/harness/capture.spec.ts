import { test, expect, type Browser, type BrowserContextOptions } from "@playwright/test";
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

/** Load a fixture and await its explicit frame-ready signal (never a sleep):
 *  state is injected before the first render, the scheduler is drained, and
 *  fonts are loaded before `__harness.ready` flips. */
async function loadFixture(browser: Browser, name: string) {
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html?fixture=${name}`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );
  return { ctx, page };
}

test("fixture registry and manifest cover exactly the same fixtures", async ({ browser }) => {
  // The browser registry (src/harness/fixtures.ts) is the source of truth; the
  // Node manifest (harness/manifest.ts) supplies each fixture's render
  // assertions. If they drift, a fixture gets added or captured WITHOUT a
  // content check (or a manifest entry points at nothing) — this fails on
  // either-direction drift.
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
  test(`${fx.name}: renders the fixture content and captures a shot`, async ({ browser }) => {
    const { ctx, page } = await loadFixture(browser, fx.name);
    // Non-vacuous: the authored content must actually be on screen, or a
    // broken injection would shoot a blank panel and still "pass".
    for (const needle of fx.expect) {
      await expect(page.locator("#overlay")).toContainText(needle);
    }
    await page.screenshot({ path: join(SHOTS_DIR, `${fx.name}.png`) });
    await ctx.close();
  });

  test(`${fx.name}: render is a byte-stable pure function of injected state`, async ({ browser }) => {
    // Two independent captures of the same fixture must be byte-identical. The
    // overlay renders ONLY from injected store state — no live socket, no
    // Math.random, no uncontrolled re-render — so this fails the moment a panel
    // introduces nondeterminism (a Math.random()/wall-clock value reaching the
    // rendered DOM). That nondeterminism class is the regression this guards;
    // it is NOT a claim about clock freezing (the overlay has no animation —
    // the steppable clock belongs to the 3D-scene track, #80).
    const shoot = async () => {
      const { ctx, page } = await loadFixture(browser, fx.name);
      const buf = await page.screenshot();
      await ctx.close();
      return buf;
    };
    expect(Buffer.compare(await shoot(), await shoot())).toBe(0);
  });
}
