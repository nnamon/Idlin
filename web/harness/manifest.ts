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
    expect: [
      "Brakka",
      "level 42",
      "Rusted Cleaver",
      "Heavy Swing",
      "DPS",
      // The adaptive non-DPS headlines — the maintainer's "not just DPS" point.
      "Buff 8s",
      "DoT 48/s",
    ],
  },
  {
    name: "scene-shore",
    kind: "scene",
    minBytes: 50_000,
  },
  {
    // All nine skills are in the DOM (clipped, not absent) — the first and last
    // prove the full list rendered; the bounded-box test proves it's clipped.
    name: "skill-overflow",
    kind: "overlay",
    expect: ["Cleave", "Decoy", "DPS"],
  },
];
