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
function shotTarget(page: Page, kind: "overlay" | "scene" | "full") {
  if (kind === "scene") return page.locator("#scene canvas");
  if (kind === "full") return page.locator("body"); // 3D scene canvas + HUD overlay
  return page.locator("#overlay");
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
    if (fx.kind === "overlay" || fx.kind === "full") {
      // Non-vacuous: the authored HUD content must actually be on screen, or a
      // broken injection would shoot a blank panel and still "pass".
      for (const needle of fx.expect) await expect(target).toContainText(needle);
      // No broken sprites: every overlay <img> (orb layers, slot icons) must have
      // decoded. The harness swallows decode errors so it can't hang; this is the
      // gate that fails if an orb layer (e.g. orb-life-fill.png) is missing/broken.
      const brokenImgs = await page
        .locator("#overlay img")
        .evaluateAll((imgs) =>
          imgs.filter((i) => {
            const im = i as HTMLImageElement;
            return !im.complete || im.naturalWidth === 0;
          }).length,
        );
      expect(brokenImgs, "every overlay sprite decoded").toBe(0);
    }
    const buf = await target.screenshot({
      path: join(SHOTS_DIR, `${fx.name}.png`),
      animations: "disabled", // freeze CSS auto-scroll to its first frame
    });
    if (fx.kind === "scene" || fx.kind === "full") {
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
      const buf = await shotTarget(page, fx.kind).screenshot({ animations: "disabled" });
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

test("skill-overflow: the skills panel is pinned to its viewport ratio and clips overflow", async ({
  browser,
}) => {
  // Many socketed skills must NOT stretch the column off-screen: the box is
  // capped at 50vh of an 800px viewport (~400px), not the full content height.
  const { ctx, page } = await loadFixture(browser, "skill-overflow");
  const box = page.locator(".autoscroll").first();
  const h = (await box.boundingBox())!.height;
  expect(h).toBeLessThanOrEqual(410);
  // ...and the content genuinely overflows it, so the cap is doing real work
  // (a regression dropping `max-height` would let the box grow to fit, failing
  // the bound above only if there's real overflow to clip).
  const clipped = await box.evaluate(
    (el) => (el.firstElementChild as HTMLElement).scrollHeight > el.clientHeight + 8,
  );
  expect(clipped).toBe(true);
  await ctx.close();
});

test("inspect-panel: a few-skill loadout fits the panel WITHOUT clipping", async ({ browser }) => {
  // The common case (4 skills) must not be clipped by the cap — only genuinely
  // overflowing builds (skill-overflow) clip. A cap set too small would clip
  // these four; this fails if so.
  const { ctx, page } = await loadFixture(browser, "inspect-panel");
  const overflows = await page
    .locator(".autoscroll")
    .first()
    .evaluate((el) => (el.firstElementChild as HTMLElement).scrollHeight > el.clientHeight + 2);
  expect(overflows).toBe(false);
  await ctx.close();
});

test("the skills auto-scroll actually moves when motion is allowed, and is off under reduced-motion", async ({
  browser,
}) => {
  // Proves the capture's determinism is real WORK, not luck: with motion
  // allowed the overflowing box's transform MUST change over time (the keyframe
  // runs), and under the reduced-motion the captures use the animation resolves
  // to none. Checking animation-name alone is too weak — Chromium reports the
  // name even when no @keyframes match — so the motion half watches the
  // transform actually move; delete @keyframes and it stops (timeout → fail).
  const sel = ".autoscroll.scrolling .autoscroll-inner";

  const motion = await browser.newContext({ ...CONTEXT, reducedMotion: "no-preference" });
  const mp = await motion.newPage();
  await mp.goto(`/harness/fixture.html?fixture=skill-overflow`);
  await mp.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );
  const t0 = await mp
    .locator(sel)
    .first()
    .evaluate((el) => getComputedStyle(el).transform);
  await mp.waitForFunction(
    (start) => {
      const el = document.querySelector(".autoscroll.scrolling .autoscroll-inner");
      return !!el && getComputedStyle(el).transform !== start;
    },
    t0,
    { timeout: 6000 },
  );
  await motion.close();

  const { ctx, page } = await loadFixture(browser, "skill-overflow"); // CONTEXT = reduced-motion
  const reducedName = await page
    .locator(sel)
    .first()
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(reducedName).toBe("none");
  await ctx.close();
});

test("the bag/obols shared slot cycles Bag → Obols → Bag on its timer", async ({ browser }) => {
  // The bag and obols take turns in ONE slot on a 7s timer (CycleDeck). The
  // frame captures only ever see the initial Bag face (the timer never fires in a
  // sub-second shot), so this drives the page clock to prove the switch actually
  // happens — both faces render, and it loops back — and shoots the Obols face
  // for eyeballing. inspect-panel carries currency, so its deck has both faces.
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.clock.install();
  await page.goto(`/harness/fixture.html?fixture=inspect-panel`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );

  const bag = page.getByText("Bag", { exact: true });
  const obols = page.getByText("Obols", { exact: true });

  // starts on the Bag face; the Obols face is not in the DOM (one at a time)
  await expect(bag).toBeVisible();
  await expect(obols).toHaveCount(0);

  // one period → the slot flips to Obols (and Bag leaves the DOM)
  await page.clock.fastForward(7000);
  await expect(obols).toBeVisible();
  await expect(bag).toHaveCount(0);
  await page.locator("#overlay").screenshot({ path: join(SHOTS_DIR, "obols-face.png") });

  // another period → it loops back to Bag
  await page.clock.fastForward(7000);
  await expect(bag).toBeVisible();
  await expect(obols).toHaveCount(0);

  await ctx.close();
});

test("mobile: bottom HUD clears the globes when closed, and hides under the open drawer", async ({
  browser,
}) => {
  // full-shore carries events (a non-empty ticker). On a phone, with the drawer
  // CLOSED the ticker sits between the corner globes (overlapping neither); with it
  // OPEN, the globes AND ticker hide so they can't cover the panels. Mutations:
  // revert the ticker `right` cap → the closed right-edge check fails; drop the
  // `.hud-right.open ~ …` hide rules → an open-state `toBeHidden` fails.
  const phone = await browser.newContext({ ...CONTEXT, viewport: { width: 390, height: 844 } });
  const page = await phone.newPage();
  await page.goto(`/harness/fixture.html?fixture=full-shore`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );
  // closed: globes shown; the ticker sits between them, overlapping neither.
  await expect(page.locator(".globe-life")).toBeVisible();
  const ticker = (await page.locator(".hud-ticker").boundingBox())!;
  const life = (await page.locator(".globe-life").boundingBox())!;
  const mana = (await page.locator(".globe-mana").boundingBox())!;
  expect(ticker.x, "ticker right of life globe").toBeGreaterThanOrEqual(life.x + life.width - 1);
  expect(ticker.x + ticker.width, "ticker left of mana globe").toBeLessThanOrEqual(mana.x + 1);
  // open: the drawer takes over — the globes and ticker hide so nothing covers it.
  await page.locator(".hud-toggle").click();
  await expect(page.locator(".globe-life")).toBeHidden();
  await expect(page.locator(".globe-mana")).toBeHidden();
  await expect(page.locator(".hud-ticker")).toBeHidden();
  await phone.close();
});

test("hud-edge: lone idler is the current carousel item; overkilled life clamps to 0", async ({
  browser,
}) => {
  const { ctx, page } = await loadFixture(browser, "hud-edge");
  // A single idler must be the CURRENT (bold) carousel item, with no dim neighbours.
  // Mutation: the old offset window excluded 0 → the lone idler was a carousel-side.
  await expect(page.locator(".carousel-cur")).toHaveText("Solo");
  await expect(page.locator(".carousel-side")).toHaveCount(0);
  // The sim sent life: -25 (overkill); the readout must clamp to 0, never negative.
  await expect(page.locator("#overlay")).toContainText("Life: 0/1180");
  await expect(page.locator("#overlay")).not.toContainText("-25");
  await ctx.close();
});

test("globe readout: ES and Reserved lines drop out at zero (full-fresh)", async ({ browser }) => {
  // full-fresh has full pools, no ES (es_max=0) and no reservation. The life orb
  // must read ONLY "Life: …" — proving the ES/Reserved lines are gated, not always
  // rendered. Mutation: make Globe always emit those lines → these negatives fail.
  const { ctx, page } = await loadFixture(browser, "full-fresh");
  const overlay = page.locator("#overlay");
  await expect(overlay).toContainText("Life: 1530/1530");
  await expect(overlay).not.toContainText("ES:");
  await expect(overlay).not.toContainText("Reserved:");
  await ctx.close();
});
