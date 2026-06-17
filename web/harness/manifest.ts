// Node-side fixture metadata for the capture spec. This file imports NOTHING
// from the app (no .css, no browser globals), so it is safe to load in the
// Playwright test runner. The link to the browser fixtures is the `name`
// string, which must match a key in src/harness/fixtures.ts.

export interface FixtureMeta {
  /** Must equal a key in `FIXTURES` (src/harness/fixtures.ts). */
  name: string;
  /** Substrings that MUST appear in the rendered overlay — a non-vacuous
   *  proof the right state rendered, so a broken injection fails the test
   *  instead of silently shooting a blank panel. */
  expect: string[];
}

export const FIXTURES: FixtureMeta[] = [
  {
    name: "inspect-panel",
    expect: ["Brakka", "level 42", "Rusted Cleaver", "Heavy Swing"],
  },
];
