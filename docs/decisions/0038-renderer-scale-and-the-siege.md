# 0038: The renderer is WebGL 2, a citizen is drawn at its camera's size, and how the siege is drawn

Date: 2026-11-28. Made in [#362](https://github.com/nnamon/Idlin/issues/362),
the look target, which asked for the renderer and the scale to be settled by
measurement. It was first written on #371 as 0030; `main` and the open spec
on #396 have since taken 0030 to 0037, so it is 0038. The scale part follows
the art brief's pick of the bigger landing: the mid city lands on 80 by 45
tiles at 23 px a tile. The siege part is how the look target draws the
shield to the rules the conductor settled on #396 and #362.

| Decision                                                                                                                                                                                                                                                                                                                                                                       | Rejected alternative                                                                                      | Why                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The look-development scenes draw with raw WebGL 2, and the game's viewer moves to it when it is rebuilt to these frames. One program, one batch of triangles a frame, no library.                                                                                                                                                                                              | Canvas 2D, which the viewer uses today. A WebGL library (PixiJS, regl).                                   | Canvas 2D takes about two and a half times as long to build a frame of the same scene (table below). WebGL also gives each fragment a material, which the washes and the dry-brush strokes are made from. A library would add a dependency for a batcher of about 300 lines (`packages/client/src/lookdev/surface.ts`). |
| Scenes draw through a `Surface` of three calls (a filled polygon, a ribbon, lettering), with a WebGL and a Canvas 2D implementation. The Canvas 2D one is kept only for the bench.                                                                                                                                                                                             | Timing two separate programs.                                                                             | The same scene code goes through both, so the table compares renderers and nothing else.                                                                                                                                                                                                                                |
| A citizen is drawn at its camera's size, in pixels: 96 in transit with 15 aboard and 56 with 150, 46 on the mid city's landing (80 by 45 tiles at 23 px a tile), 59 in the siege at 32 px a tile. Effects are sized against the citizen: on the landing a stroke 115 px long and a contact burst 69 (a citizen and a half, so a blow carries at 640); in the siege a burst 59. | A citizen a fixed number of tiles tall (#371 had 1.15), which on that landing would be 26 px.             | The sizes are the art bible's (`docs/art.md`, sections 5 and 7). The landing fills the 1,880 by 1,040 picture inside the rule.                                                                                                                                                                                          |
| Figures and beasts are drawn at one scale both ways. Only the map's lean (heights at 1.4, flat shapes at 0.8) applies to masses, dens, chests, scrap and the city.                                                                                                                                                                                                             | Drawing figures through the stretched space the mockups used, which made them 1.4 times taller than wide. | A figure in its own proportions reads as a person, and the lean belongs to the ground.                                                                                                                                                                                                                                  |

## Frame times

The bench is `expedition150` at 10 seconds in: the mid landing with the
city, 150 citizens (20 aboard), 583 monsters alive (233 of them awake), 41
things in the air (23 shots, 18 thrown bodies), the ink the kills leave, and
the tags that have room. Times are milliseconds a frame over 240 frames:
"build" is the scene code filling the frame, "whole" is build plus waiting
for the frame to be on the canvas (a pixel is read back). `bench.json`
records the load each run was timed on. Two runs of the same build in the
same container:

| Where                                 | Renderer  | Build, mean | Build, 95th | Whole, mean | Whole, 95th | Vertices a frame |
| ------------------------------------- | --------- | ----------- | ----------- | ----------- | ----------- | ---------------- |
| The capture container (no GPU), run 1 | WebGL 2   | 31.2        | 56.6        | 497         | 609         | 357,000          |
|                                       | Canvas 2D | 87.0        | 141.5       | 794         | 1,949       | 354,000          |
| The capture container (no GPU), run 2 | WebGL 2   | 26.3        | 55.0        | 473         | 591         | 357,000          |
|                                       | Canvas 2D | 60.0        | 79.2        | 904         | 2,235       | 354,000          |

- Building a frame takes Canvas 2D between two and a quarter and two and
  three-quarter times as long as WebGL on the same scene code. The runs
  differ by up to a third, so a difference of under a third between two
  builds is not a measurement. The container has no GPU, so its "whole"
  column says only that captures are slow (about half a second a frame).
- The art brief sets the bench load at 150 citizens, 700 monsters and 150
  things in the air. The scene holds about 600 monsters and had 41 things in
  the air at 10 s, so the load timed is under that; nothing was drawn at a
  lower rate.
- #371 measured an older and lighter bench scene (245,000 vertices) in a
  desktop browser with a GPU at 13.3 ms to build. This scene builds in 26 to
  31 ms in the container against that scene's 15.9, about 1.8 times the
  work; at that ratio it would take about 24 ms to build on the desktop
  machine, over the 16.7 ms budget before anything is drawn. It was not
  measured there.

`docker compose run --rm capture <dir> --lookdev expedition150` writes
`bench.json`. In a browser, `window.lookdev.bench(frames, 10)` on
`?lookdev=expedition150&capture`, with `&renderer=canvas` for Canvas 2D.

## Scale

`?lookdev=scale` draws fifteen citizens at each camera's size and at the
floor, standing, walking, in a blow and carrying. Judged by eye on the 1920
frame and on the same frame averaged down to 640:

| Where                           | Pixels a tile | Citizen at 1920 | At 640 | Drawn at  | Reads at 640                                                                              |
| ------------------------------- | ------------- | --------------- | ------ | --------- | ----------------------------------------------------------------------------------------- |
| Transit, 15 aboard              | 66            | 96 px           | 32 px  | near size | Everything: hat, cloak pattern, face, the tool in the hand, a bundle.                     |
| Transit, 150 aboard             | 66            | 56 px           | 19 px  | mid size  | Cloak and hat colour, the hat's shape, legs, a blade raised or swung, a bundle.           |
| The mid city's landing          | 23            | 46 px           | 15 px  | far size  | Cloak and hat colour, the hat's shape (pointed, brimmed, cap or cowl), a blade, a bundle. |
| The floor                       |               | 44 px           | 15 px  | far size  | As at 46; the head is 3 px at 640.                                                        |
| Under the floor, for comparison |               | 40 px           | 13 px  | far size  | Colour and that it is a person; a cap and a brimmed hat start to look alike.              |

Lettering is never scaled with the camera. A name tag is 30 px, and 36 px on
a landing while 20 or fewer are out; a called tag is 48 px. Dens are
lettered `den A 28` at 36 px. Lettering on the map has a paper halo 5 px
wide.

## What lies over a citizen

Where two things want the same place, a citizen's head comes first, then its
tag, then numbers, then bursts (the art director's look pass on #371).

- A burst is drawn on what was struck, under the citizens of its fight.
- A tag sits 8 px over its owner's hat and goes back there whenever that is
  free. No tag lies over a citizen out.
- A number is laid out once, when its blow lands, against everything in its
  way over its whole life: it steps along its blow by half its height, up to
  three citizens away, and a 30 px number with nowhere free is left out. The
  72 is the largest blow up at any moment of its life; the blows are
  scripted, so the later ones are known. Over the black a number is in paper.
- A citizen a body covers, its head or over a third of it, is drawn again on
  top as an outline in its cloak colour, its hat kept in its colour.
- Citizens holding or fighting at a place keep apart in the fight script, a
  figure's width side by side and its height one behind the other.

`landing.test.ts` checks this at every sampled half second of `expedition`,
`siege` and `siege150`, from what the scene records as it draws each frame.

## The siege

`?lookdev=siege` and `siege150` are a minute of phase 5 on the mid city's
landing at 32 px a tile: the march's last six tiles, the siege, the break at
42 s and the run aboard. `?lookdev=shield-levels` draws the far third of the
shield at levels 0, 2, 4, 7 and 10.

| Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Rejected alternative                                                                                           | Why                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The shield is one strength pool, and the whole dome collapses at once when it runs out. Each post has a condition that hits on its arc wear down; a post whose condition is gone is dark, and hits on its arc take three times as much off the pool.                                                                                                                                                                                                           | Each post holding its arc on its own, a dark post leaving a gap the horde comes through.                       | The conductor's ruling on #396 after the operator's question: with a gap, one dark post ends the siege and the rest are pointless; with one pool, guarding a dark side slows the whole shield.                                      |
| A dark post's arc is drawn standing, unlit and cracked: iron and soot at 40%, hatched and cracked in ink, with a ragged top edge. The foot's band and the near strip follow their arc too, changing midway between two posts, and the strip runs on round the ends where the wall is seen edge on. A dark lamp is an empty cage in ink with two loops of smoke. The horde stays on it like everywhere else.                                                    | `docs/art.md` section 7 as it stands: the wall torn to half beside a dark post and gone between two dark ones. | With no gaps in the rules, an open stretch on screen would be a lie: it reads as a way in that the horde is not using. The bible's line on torn and missing wall is out of step with the ruling; the scene follows the ruling.      |
| The corner has no clock from the march to the break. It shows lamps lit of posts at 48 px and the lamps lost a minute at 36 px in red-brown, at the rate of the last six seconds.                                                                                                                                                                                                                                                                              | A count to lift-off, or the pool as a number.                                                                  | `docs/art.md` section 11. The pool is not lettered; a viewer reads it from the lamps.                                                                                                                                               |
| The loss a minute is the scene's own rate, `−50.0` at half strength.                                                                                                                                                                                                                                                                                                                                                                                           | Printing a rate from a longer siege.                                                                           | The scene puts eighteen lamps out in 28 seconds, so its true rate is in the tens. A siege in the game runs for minutes and reads near `−1.5`.                                                                                       |
| The lamps go out in an order fixed by where the horde strikes hardest: two runs at the west-north-west, the south, the far side past C; the pair at the east end, where A and B hold, last. The pool's drain is the 21 heaps' blows, three times as hard on a dark arc, scaled so it runs out at 42 s.                                                                                                                                                         | Simulating the conditions and the pool and letting the times fall where they may.                              | The look target is drawn to the brief's beats (9 of 18 at 28 s, 2 at 40 s, the break at 42 s). The game's simulation (#396) decides these for real.                                                                                 |
| The fight script (`fray.ts`) has a bar: until the break no monster is inside the foot, and citizens holding a place outside it stay outside.                                                                                                                                                                                                                                                                                                                   | Letting the fights run free.                                                                                   | Without it, swarms hunting a citizen walked into the bubble, which the rules forbid.                                                                                                                                                |
| Brutes are drawn knuckle-walking on bent forelimbs that narrow from shoulder to wrist with the fist wider again, the belly a fifth of their height off the ground, the head low and forward with a row of teeth on the open jaw. Standing, one fist is off the ground; winding up they rear with both forelimbs bent over the head. In the horde they are black with a paper line down their lantern side. An elite's crest is one ribbed sail down the spine. | The grey four-legged brute and the five-point crest of the last round.                                         | The siege brief, section 4, and `docs/art.md` section 6: the old brute read as a boulder and a standing stone, the crest as a row of flames. `?lookdev=beasts` draws both on the map and in the horde, and at 12 px in solid black. |

## What this leaves open

- The bench load is not held at 60 frames a second in the container, which
  has no GPU, and no desktop browser was measured for this scene. Most of
  the build time is the scene code laying strokes every frame. Keeping each
  body's strokes between frames while its pose is held is the first thing to
  try; drawing packs at rest at a lower rate than the fights is the second.
- Name tags hold their spots and slide no more than 4 px a frame. A tag
  whose spot is taken by a head or another tag, and that cannot slide clear,
  fades out for about three frames and comes back at its new spot.
