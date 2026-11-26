# 0004: The ink-map look

Date: 2026-11-26. Decided by the conductor after the operator rejected the
first look; open to veto.

The first viewer used Kenney's Tiny Town and Tiny Dungeon sprite packs. The
operator's reaction: it "looks like a dime a dozen kenney game", and the pack's
author is hostile to AI use. Both are good reasons to drop it.

**Decision.** The stream is drawn as a hand-inked map: sepia line on cream
paper with watercolour washes by day, pale line on dark blue paper by night,
all of it drawn in code. Described in the Look section of
[design.md](../design.md). This replaces rows 8 and 9 of decision 0001 (the
Kenney packs and PixiJS): there are no sprite sheets any more and the frame is
drawn with Canvas 2D, so the rendering library went too.

**Why this one.**

- It doesn't look like other streams, including at thumbnail size.
- One strong cloak colour per character reads at a glance, which is also the
  answer to "which one is mine".
- It is quiet enough to leave on a second monitor for hours.
- New things are drawing code. Nobody has to find or commission sprites.

**Considered and dropped.** Layered cut-paper shapes with drop shadows:
pleasant, but close to a lot of mobile games, and depth cues fight with a
top-down map. Any other pixel-art pack: same problem as the first one.

**Two things that follow from it.**

- Day and night are two drawings and can't be cross-faded: halfway, dark ink on
  light paper and light ink on dark paper cancel out. So night arrives as a
  moving edge (closing on the lantern at dusk, crossing from the east at dawn).
- Names and labels are limited to what the typeface can draw: Latin letters,
  digits and common punctuation.

The typeface is IM Fell English, under the SIL Open Font License.
