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
    }
  | {
      // Per-idler management page (#79): an opaque overlay surface, no 3D scene.
      // Asserted by text needles like an overlay.
      name: string;
      kind: "manage";
      expect: string[];
    }
  | {
      // PoE-style item tooltip (#87): a standalone #overlay surface, asserted by
      // text needles (item name, base, mod lines) like an overlay.
      name: string;
      kind: "tooltip";
      expect: string[];
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
      // War Cry's life cost renders on the skill card (#98).
      "30 life",
      // Firing cadence (#94): EXACT strings pin the rate math AND the attack/spell
      // label, not just a substring. Heavy Swing (attack, use_ticks 8) → 1.3 atk/s;
      // Arc (spell, use_ticks 8) → 1.3 cast/s; War Cry's cooldown → cd 4s.
      "1.3 atk/s",
      "1.3 cast/s",
      "cd 4s",
    ],
  },
  {
    // Edge cases: a lone idler renders as the current carousel item, and an
    // overkilled (negative) life pool reads "Life: 0/1180", not a negative number.
    name: "hud-edge",
    kind: "overlay",
    expect: ["Solo", "Life: 0/1180"],
  },
  {
    // PoE-style item tooltip (#87). The needles assert the EXACT formatted mod
    // strings, not just substrings — so basis-point scaling (3800 → 38%) and the
    // value(min-max) range rendering are non-vacuously proven: drop the ÷100 in
    // formatEffect and "+38(35-38)%" becomes "+3800(...)%" and this fails.
    name: "item-tooltip",
    kind: "tooltip",
    expect: [
      "Vortex Scarab",
      "Onyx Amulet",
      "Item Level: 84",
      "Requires Level 60",
      "+24(22-26) Physical Damage", // flat, with range
      "+83(80-89) Life",
      "+38(35-38)% Critical Strike Multiplier", // basis points ÷100
      "36(35-38)% increased Critical Strike Chance", // increased layer ÷100
      "Tier 1",
    ],
  },
  {
    name: "scene-shore",
    kind: "scene",
    minBytes: 50_000,
  },
  {
    // Overhead bars (#100): entities at 50/80(+ES 60)/25% life — eyeball that
    // each red fill sits on its dark track and the shield band reads cyan.
    name: "scene-bars",
    kind: "scene",
    minBytes: 50_000,
  },
  {
    // Ailment pips (#88): four monsters — ignited / shocked / chilled / all three
    // — eyeball that the orange/yellow/cyan pips ride the overhead bar.
    name: "scene-ailments",
    kind: "scene",
    minBytes: 50_000,
  },
  {
    // Fog of war, idler MAP view (#129): the sight disc around Vex, the dim
    // corridor she walked, near-black elsewhere; Rin + the husk swallowed.
    // Mostly-dark shots compress hard, so the floor is lower — a blank canvas
    // is still ~3 KB.
    name: "scene-fog-idler",
    kind: "scene",
    minBytes: 12_000,
  },
  {
    // Fog of war at the LIVE follow framing (#129): sight is sized to the
    // screen, so this shot must read as a normally-lit scene (fog only at the
    // far corners) — the "watching feels unrestricted" proof.
    name: "scene-fog-follow",
    kind: "scene",
    minBytes: 40_000,
  },
  {
    // Fog of war, broadcast (#129): the SAME layout unpinned — union reveal, so
    // Rin gets her own lit disc; the husk (no character near) stays dark.
    name: "scene-fog-broadcast",
    kind: "scene",
    minBytes: 12_000,
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
  {
    // Whole game view at extremes: low life, full ES, heavy reservation — the
    // "Reserved: 612" line proves the reserved band/readout renders.
    name: "full-bloodied",
    kind: "full",
    expect: ["Brakka", "Reserved: 612"],
    minBytes: 60_000,
  },
  {
    // Whole game view, full pools with no ES and no reservation — the life
    // readout is just "Life: 1530/1530" (no ES/Reserved lines), proving the
    // zero-cases drop out.
    name: "full-fresh",
    kind: "full",
    expect: ["Brakka", "Life: 1530/1530"],
    minBytes: 60_000,
  },
  {
    // Individual idler view (#79): the focus panel names Brakka — the pinned
    // idler, NOT the director cue (which points at Veles in this fixture). The
    // rigorous focus-by-name guard is the behavioral test in capture.spec.ts;
    // this is the coarse screenshot check.
    name: "idler-view",
    kind: "overlay",
    expect: ["Brakka"],
  },
  {
    // Per-idler management page (#79): the header (idler + "manage") and the
    // streamed event lines prove the page rendered and the ticker fed it. A
    // broken stream / wrong render leaves the empty state and fails these.
    name: "idler-manage",
    kind: "manage",
    expect: ["Brakka", "manage", "Event stream", "Bone Stalker"],
  },
  {
    // Individual view for an idler not in any world (#79): a clean "not in the
    // realms" message (no scene/HUD). The no-focus-panel + no-cue-fallback is
    // asserted by a dedicated test.
    name: "idler-absent",
    kind: "overlay",
    expect: ["Ghost", "not in the realms"],
  },
];
