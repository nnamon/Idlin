# 0041: The renderer for the live viewer: under 8 ms a frame, and a feed in place of the script

Date: 2026-11-28. Decided for [#425](https://github.com/nnamon/Idlin/issues/425),
from the code review of #371, before slice piece 2b builds the live viewer
on the look target's renderer. Open to veto. It changes points of
[0038](0038-renderer-scale-and-the-siege.md): the Canvas 2D surface is now
also the fallback, and the build time it left open is met.

| Decision                                                                                                                                                                                                                                      | Rejected                                                                                 | Why                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The ground, and the dry stains, are drawn into layers: a multisampled framebuffer resolved into a texture, drawn again only when the camera moves or the ink comes in (ground) or four times a second (dry stains).                           | Drawing the ground every frame, as before; one layer holding ground and stains together. | The ground was 18% of a frame and never changes on a still camera. Stains fade over seven seconds, so a quarter second is too short to see; kept apart, a new stain does not make the ground be drawn again. |
| Wet rims go under the dry-stain layer and wet fills over it.                                                                                                                                                                                  | Drawing wet stains after the layer.                                                      | Stains that touch stay one pool with one edge (`docs/art.md`, section 10), as when all rims were laid before all fills.                                                                                      |
| Hatching is a fragment material: the outline is filled once and the shader lays the strokes from the anchor, at `hatchLines`' spacing and angle, each 0.7 of the stroke weight wide and thinning a little along its length.                   | One strip a stroke, laid in JavaScript, each trimmed by hand at both ends.               | It was 12% of a frame. The look is the same at 640 and at 1920 by eye; at four times up, strokes end on the outline rather than just inside it. Canvas 2D still lays them one by one.                        |
| What stands on the map (woods, crags, trees, dens, chests) is drawn once for a camera and its vertices copied back each frame, in its place among the bodies (`Surface.keep`).                                                                | A layer, which would put all of it behind or in front of every citizen.                  | It keeps the order by feet. Swarms were tried too and dropped: every pack has an alert sentinel whose legs move, so no swarm is ever wholly still.                                                           |
| Triangulation reuses the triangles of a ring of the same shape seen before; convex rings are fanned, and only reflex corners are tested for ears.                                                                                             | Ear clipping every polygon from scratch.                                                 | A body's paper, wash and hatch are one outline three times, and a crowd draws few shapes. About 85% of rings were already cut.                                                                               |
| The landing draws from a `Feed`: citizens and monsters by id at a moment, and what has happened in time order. `scriptFeed` wraps the scripted fight (a citizen's id is its place in the script); `MessageFeed` the server's viewer messages. | Adapting the sim's World inside `landing.ts`.                                            | The drawing reads one interface, so the scripted scenes test what the live viewer draws, and nothing in the drawing knows where its data came from.                                                          |
| A live landing's tags step once a drawn frame (`LiveTags`); a scripted one keeps `TagTimeline`. Numbers on a live landing forget hits past their life.                                                                                        | Replaying tags from 0 live; one tag track for both.                                      | A capture draws scripted moments in any order, so they have to stay a function of time; live, a stream that runs for days cannot keep every frame.                                                           |
| The page falls back to Canvas 2D without WebGL 2, and builds a new WebGL surface when a lost context comes back.                                                                                                                              | Failing with `no WebGL 2 context`; reloading the page on a lost context.                 | The scenes hold no GPU state, so a new surface is all a restore needs.                                                                                                                                       |

## Frame times

`docker compose run --rm dev node packages/client/scripts/bench.ts`: 240
frames of `expedition150` from 10 s, through `GlSurface` with a stand-in
WebGL context, so the vertex packing and triangulation count and the GPU
does not. Load at 10 s: 130 out, 20 aboard, 591 monsters, 40 shots and
bodies in the air. Five runs each, back to back, on the same machine and
load; milliseconds a frame:

| Build              | Mean, median of five | Mean, range | Vertices a frame |
| ------------------ | -------------------- | ----------- | ---------------- |
| `main` before #425 | 26.5                 | 25.9–29.1   | 369,000          |
| This change        | 7.75                 | 7.68–8.11   | 235,000          |

The 95th percentile is about 11.5 ms: frames that lay out new numbers and
tags, or paint the stains layer, cost more. The capture container's own
bench (`bench.json`) went from 26.1 to 11.4 ms to build in WebGL, but that
container has no GPU and its build time includes the GL calls into a
software renderer, so it says little about a real browser.

## Left open

- The sim's landing map as a lookdev `Landing`, a live camera and corners,
  and the deck's crew from the world: piece 2b.
- Tag sizes, which #441 changes; they are chosen in one place, `tagSize` in
  `stage.ts`.
- A high-DPI backing store.
