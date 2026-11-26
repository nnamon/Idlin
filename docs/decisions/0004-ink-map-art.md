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

- It is not a look other streams have, as far as we know. Whether it stands out
  at thumbnail size has not been tested.
- Each character has one strong cloak colour, which is also how a viewer finds
  their own.
- Nothing in it moves fast or flashes, which matters for something left on a
  second monitor. The watch judge said it would keep the night view on one.
- New things are drawing code. Nobody has to find or commission sprites.

**Considered and dropped.** Layered cut-paper shapes with drop shadows:
pleasant, but close to a lot of mobile games, and depth cues fight with a
top-down map. Any other pixel-art pack: same problem as the first one.

**Two things that follow from it.**

- Day and night are two drawings and can't be slowly cross-faded: halfway, dark
  ink on light paper and light ink on dark paper cancel out. So the change is
  quick and has a shape: the dark closes in on the lantern at nightfall and
  the light spreads back out at daybreak, each in a bit over half a minute,
  with a soft band about 260 pixels wide where both show.
- Names and labels are limited to what the typeface can draw: Latin letters,
  digits and common punctuation.

The typeface is IM Fell English, under the SIL Open Font License.
