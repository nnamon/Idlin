import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./manifest";
import { resolveFocusId } from "../src/world/focus";

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
function shotTarget(page: Page, kind: "overlay" | "scene" | "full" | "manage" | "tooltip") {
  if (kind === "scene") return page.locator("#scene canvas");
  if (kind === "full") return page.locator("body"); // 3D scene canvas + HUD overlay
  return page.locator("#overlay"); // overlay + manage + tooltip are #overlay surfaces
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
    if (
      fx.kind === "overlay" ||
      fx.kind === "full" ||
      fx.kind === "manage" ||
      fx.kind === "tooltip"
    ) {
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

  // The [Bag|Obols] chip labels the deck; the active face is identified by the
  // chip's aria-selected tab and by the bag grid being mounted (one face at a
  // time). The panels no longer carry their own header (#87).
  const chipBag = page.getByRole("tab", { name: "Bag" });
  const chipObols = page.getByRole("tab", { name: "Obols" });
  const bagGrid = page.locator(".bag");

  // starts on the Bag face
  await expect(chipBag).toHaveAttribute("aria-selected", "true");
  await expect(bagGrid).toBeVisible();

  // one period → the slot flips to Obols (and the bag grid leaves the DOM)
  await page.clock.fastForward(7000);
  await expect(chipObols).toHaveAttribute("aria-selected", "true");
  await expect(bagGrid).toHaveCount(0);
  await page.locator("#overlay").screenshot({ path: join(SHOTS_DIR, "obols-face.png") });

  // another period → it loops back to Bag
  await page.clock.fastForward(7000);
  await expect(chipBag).toHaveAttribute("aria-selected", "true");
  await expect(bagGrid).toBeVisible();

  await ctx.close();
});

test("the [Bag|Obols] chip pins the deck face, and the pin STICKS when the cursor leaves", async ({
  browser,
}) => {
  // Hovering a chip segment FORCES that face immediately; the pin then STICKS — it
  // must NOT snap back the moment the cursor leaves the segment (the reported bug:
  // it reverted on the segment's mouseleave). The auto-cycle resumes only after the
  // WHOLE deck has been mouse-free for the resume window (10s) — too long for a
  // pointer test, and the auto path itself is covered by the cycle test above. No
  // fake clock: page.clock.install() freezes the rAF hover actionability waits on.
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html?fixture=inspect-panel`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );

  const chipObols = page.getByRole("tab", { name: "Obols" });
  const bagGrid = page.locator(".bag");

  // auto face is Bag
  await expect(bagGrid).toBeVisible();
  // hovering Obols forces the obols face (bag grid unmounts)
  await chipObols.hover();
  await expect(chipObols).toHaveAttribute("aria-selected", "true");
  await expect(bagGrid).toHaveCount(0);
  // leaving the deck entirely: the pinned face STICKS — it does not revert to the
  // auto face immediately (the cycle is held until the deck is mouse-free for the
  // full resume window). Reverting the stick fix makes this snap back to Bag here.
  await page.mouse.move(2, 2);
  await expect(chipObols).toHaveAttribute("aria-selected", "true");
  await expect(bagGrid).toHaveCount(0);

  await ctx.close();
});

test("the item tooltip floats BY the hovered item with the HUD intact (#87)", async ({
  browser,
}) => {
  // The tooltip is a cursor-anchored floating layer over the live overlay — it
  // does NOT replace the HUD. Hover the weapon (a real rare via content nums) and
  // assert: the tooltip shows the resolved mods AND the Equipment/Stats panels are
  // still on screen behind it. Live clock (hover needs rAF). Captures the
  // in-context shot for the PR (the standalone `item-tooltip` fixture shows the
  // component alone — this shows it where it actually lives).
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html?fixture=inspect-panel`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );

  // The weapon is the first filled paper-doll slot.
  await page.locator(".slot.filled").first().hover();
  // The tooltip resolves mod text from content-docs (loaded async) — wait for it.
  const tip = page.locator(".item-tooltip", { hasText: "Brine Reaver" });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Physical Damage");
  // The HUD is STILL there behind the floating tooltip — nothing was replaced
  // (the Equipment panel the weapon lives in is still on screen).
  await expect(page.getByText("Equipment", { exact: true })).toBeVisible();
  await page.locator("#overlay").screenshot({ path: join(SHOTS_DIR, "item-tooltip-incontext.png") });

  await ctx.close();
});

test("a stats row hovers to its per-source breakdown (#87)", async ({ browser }) => {
  // Hovering a stats-panel row floats the source breakdown for that stat — the
  // contributing gear/passive/buff and what each grants. Live clock (hover
  // actionability needs rAF), inspect-panel carries seeded stat_sources.
  const ctx = await browser.newContext(CONTEXT);
  const page = await ctx.newPage();
  await page.goto(`/harness/fixture.html?fixture=inspect-panel`);
  await page.waitForFunction(
    () => (window as unknown as { __harness?: { ready?: boolean } }).__harness?.ready === true,
  );

  // (the stats panel is mounted twice — desktop + a mobile-drawer copy; the
  // first is the visible desktop one)
  await page.getByText("armour", { exact: true }).first().hover();
  // the breakdown tooltip lists each contributing source + its formatted amount
  const tip = page.locator(".item-tooltip", { hasText: "Brinescoured Helm" });
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Kelp-Woven Vest");
  await expect(tip).toContainText("+800");
  await expect(tip).toContainText("+1400");
  await page.locator("#overlay").screenshot({ path: join(SHOTS_DIR, "stat-breakdown.png") });

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

test("idler-view: focus is pinned to the requested idler, not the director cue", async ({
  browser,
}) => {
  // The fixture is Brakka's page (/idler/Brakka) but the director cue points at
  // Veles (id 2). Individual mode must focus Brakka BY NAME — the focus panel must
  // read Brakka. Mutation: fall focusId back to store.cue?.focus → the panel reads
  // "Veles" and this fails. (This is the non-vacuous proof of name-pinned focus.)
  const { ctx, page } = await loadFixture(browser, "idler-view");
  await expect(page.locator(".display")).toHaveText("Brakka");
  await ctx.close();
});

test("idler-absent: an absent idler shows no focus panel, never the director's pick", async ({
  browser,
}) => {
  // The page is /idler/Ghost but Ghost isn't in the streamed world; the director
  // cue points at the present Brakka. Individual mode must NOT fall back to the
  // cue — the banner names Ghost, but there is no focus panel. Mutation: restore
  // the `?? store.cue?.focus` fallback → Brakka's panel (.display) appears → fails.
  const { ctx, page } = await loadFixture(browser, "idler-absent");
  // The page is /idler/Ghost; Ghost isn't streamed, the cue points at Brakka.
  // Individual mode must show the clean "not in the realms" message — NOT focus
  // the cue's Brakka. Mutation: restore `?? store.cue?.focus` → Brakka's panel
  // (.display) renders and the message is gone → both assertions fail.
  await expect(page.locator(".not-in-realms-name")).toHaveText("Ghost");
  await expect(page.locator("#overlay")).toContainText("not in the realms");
  await expect(page.locator(".display")).toHaveCount(0);
  await ctx.close();
});

test("resolveFocusId pins to the named idler with no director-cue fallback (#79)", () => {
  // The pure focus rule shared by the HUD overlay AND the scene camera — so a
  // regression to cue-fallback in EITHER (the renderer's path isn't otherwise
  // capture-covered) is caught here. The cue is deliberately a DIFFERENT idler.
  const entities = [
    { id: 1, name: "Brakka", kind: "Character" },
    { id: 2, name: "Veles", kind: "Character" },
    { id: 3, name: "Bone Stalker", kind: "Monster" },
  ];
  expect(resolveFocusId("Brakka", entities, 2)).toBe(1); // pinned + present → that idler, not the cue
  expect(resolveFocusId("brakka", entities, 2)).toBe(1); // CASE-INSENSITIVE: /idler/brakka resolves Brakka
  expect(resolveFocusId("BRAKKA", entities, 2)).toBe(1); // ...any casing the operator types
  expect(resolveFocusId("Ghost", entities, 2)).toBeUndefined(); // pinned + ABSENT → nobody, never the cue
  expect(resolveFocusId("bone stalker", entities, 2)).toBeUndefined(); // a monster's shared name never resolves (even lowercased)
  expect(resolveFocusId(null, entities, 2)).toBe(2); // unpinned → the director's cue
});
