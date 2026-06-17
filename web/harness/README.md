# UI capture harness (deterministic screenshots)

The §6 prerequisite: reproducible UI screenshots from **canned server state**, so a
UI change can be captured and signed off instead of "verified" by a typecheck.

Today this covers **Track 1 — the React overlay** (focus/inspect panel, stats, gear,
gems). The 3D scene (Track 2) is not captured yet; see issue #80.

## Run it

```sh
pnpm -C web capture          # = playwright test
```

This starts Vite, loads each fixture, awaits an explicit frame-ready signal (never a
sleep), asserts the authored content is on screen, and writes a PNG to
`web/harness/shots/<fixture>.png`. It also re-captures each fixture a second time and
asserts the two PNGs are **byte-identical** — the determinism guarantee.

The shots are **generated output, not tracked** (`web/harness/shots/` is gitignored, like
`dist/`) — they would otherwise churn across machines/browser versions. Attach the PNG to
the PR for sign-off.

Then **look at the PNG and sign off.** A green run proves it rendered *something*
deterministically with the right text; only your eyes prove it looks right.

## How it works

- **No socket.** Fixtures are sequences of `S2C` wire messages applied straight to a
  fresh `WorldStore` via `store.handle()` (`src/harness/fixture.tsx`), with a no-op
  `NetClient` stub (`src/harness/stubClient.ts`). This reuses the same injection seam
  the app's `?replay=` mode already uses — no parallel rendering path.
- **Determinism comes from purity, not a clock.** The overlay renders only from injected
  store state (no live socket, no `Math.random`, and it re-renders only on a `store`
  version bump, which a static fixture never triggers). So two captures are byte-identical
  by construction — §6 calls the overlay "already deterministic". The byte test guards
  against a panel later sneaking nondeterminism (a `Math.random()`/wall-clock value) into
  the DOM. The steppable clock that §6 describes is for the animated **3D-scene track**
  (#80), not here.
- **Frame-ready, not sleep.** The fixture applies all messages *before* the first
  render, drains React's scheduler (via `MessageChannel`), awaits `document.fonts.ready`,
  then sets `window.__harness.ready`. The driver awaits that flag.
- **No drift.** The browser registry (`src/harness/fixtures.ts`) is published on
  `window.__harnessRegistry`; a test asserts it matches the Node manifest exactly, so a
  fixture can't be added/captured without a render assertion.
- **Dev-only.** `harness/fixture.html` is served by Vite in dev but is **not** an input
  to `vite build`, so it ships nowhere (verified: no harness fingerprint in `dist/`).

## Add a fixture

1. Author the scene in `src/harness/fixtures.ts` using the typed builders in
   `src/harness/builders.ts` (`zoneSnapshot`, `directorCue`, `characterSheet`, …). The
   builders are typed against the generated wire types, so a protocol change breaks the
   fixture at typecheck — that's intended.
2. Add a key to the `FIXTURES` map (the key is the `?fixture=<name>` id).
3. Add a row to `harness/manifest.ts` with `name` (matching the key) and `expect`
   (substrings that must appear on screen — the non-vacuous render check).
4. `pnpm -C web capture`, then eyeball `harness/shots/<name>.png`.
