// Node-side fixture metadata for the capture spec. This file imports NOTHING
// from the app (no .css, no browser globals), so it is safe to load in the
// Playwright test runner. The link to the browser fixtures is the `name`
// string, which must match a key in src/harness/fixtures.ts.

export type FixtureMeta =
  | {
      name: string;
      kind: "overlay";
      /** Substrings that MUST appear in the rendered overlay — a non-vacuous
       *  proof the right state rendered, so a broken injection fails the test
       *  instead of silently shooting a blank panel. */
      expect: string[];
    }
  | {
      name: string;
      kind: "scene";
      /** The canvas PNG must exceed this many bytes — a non-blank check: a
       *  black/cleared WebGL canvas compresses to a fraction of this, so a
       *  failed render (no assets, GL context lost) fails the test. The shot
       *  is still eyeballed for real sign-off (§6). */
      minBytes: number;
    };

export const FIXTURES: FixtureMeta[] = [
  {
    name: "inspect-panel",
    kind: "overlay",
    expect: ["Brakka", "level 42", "Rusted Cleaver", "Heavy Swing"],
  },
  {
    name: "scene-shore",
    kind: "scene",
    minBytes: 50_000,
  },
];
