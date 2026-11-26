# 0003 — Frame and map size

Date: 2026-11-26. Decided by the conductor; open to veto.

The stream frame is 1920×1080. The world takes the left 1440 pixels and the
side panel the right 480, with the ticker along the bottom of the world. Tiles
are 16 pixels drawn at 3×, so 48 pixels on stream, which gives a map of at most
**30 by 21 tiles**. The map loader refuses anything larger.

Rejected: 2× scale (45 by 31 tiles). It holds more world, but a 32-pixel
character shrinks to about 11 pixels when the stream sits in a 640-pixel
window on a second screen, and stops being readable. At 3× it stays at 16.

Consequence: one frame is a small place. That is intended (see "One player
among many" in [design.md](../design.md)): the world grows by regions.
