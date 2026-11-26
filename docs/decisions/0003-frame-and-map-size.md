# 0003: Frame and map size

Date: 2026-11-26. Decided by the conductor; open to veto.

The stream frame is 1920×1080. The map takes the left 1440 pixels and the page
beside it the right 480, with the news line along the bottom. A tile is 48
pixels on stream, which gives a map of at most **30 by 21 tiles**. The map
loader refuses anything larger.

Rejected: 32-pixel tiles (45 by 31 of them). That holds more world, but a
character is then about 11 pixels tall when the stream sits in a 640-pixel
window on a second screen, which is too small to read. At 48 it is about 20.

Consequence: one frame is a small place. That is intended (see "One player on a busy stream" in [design.md](../design.md)): the world grows by regions.
