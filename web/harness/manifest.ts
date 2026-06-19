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
    }
  | {
      // 3D scene + HUD overlay together: assert BOTH the overlay text (non-vacuous
      // HUD) and the non-blank page bytes (non-vacuous scene).
      name: string;
      kind: "full";
      expect: string[];
      minBytes: number;
    };

export const FIXTURES: FixtureMeta[] = [
  {
    name: "inspect-panel",
    kind: "overlay",
    expect: [
      "Brakka",
      "level 42",
      // The paper doll is icon-only (names ride the hover title), so assert the
      // section is present, not item-name text; the icons are eyeballed + the
      // byte-stable shot pins them.
      "Equipment",
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
    // All eight skills are in the DOM (clipped, not absent) — the first and last
    // prove the full list rendered; the bounded-box test proves it's clipped.
    name: "skill-overflow",
    kind: "overlay",
    expect: ["Cleave", "Power Shot", "DPS"],
  },
  {
    // The life/mana globes render with the focused idler's pools — "168" is the
    // life-orb value (low life), proving the orb bound to the sheet, not a blank.
    name: "globes",
    kind: "overlay",
    expect: ["Vesh", "168"],
  },
  {
    // Whole game view: HUD over the 3D scene. Assert HUD text (Brakka + a skill)
    // AND that the full-page PNG is non-blank (scene rendered).
    name: "full-shore",
    kind: "full",
    expect: ["Brakka", "Heavy Swing"],
    minBytes: 60_000,
  },
];
