# 0030: The renderer is WebGL 2, and a citizen reads down to 24 pixels a tile

Date: 2026-11-27. Made in [#362](https://github.com/nnamon/Idlin/issues/362),
the look target, which asked for both to be settled by measurement. 0028 is on
`main` and an open pull request carries 0029, so this takes 0030.

| Decision                                                                                                                                                                           | Rejected alternative                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The look-development scenes draw with raw WebGL 2, and the game's viewer moves to it when it is rebuilt to these frames. One program, one batch of triangles a frame, no library.  | Canvas 2D, which the viewer uses today. A WebGL library (PixiJS, regl).   | The numbers below: Canvas 2D takes over twice as long a frame on the same scene (40.7 ms against 18.3). WebGL also gives each fragment a material, which the washes (uneven, as a wash dries) and the dry-brush strokes are made from; Canvas 2D has no cheap equivalent. A library would add a dependency for a batcher of about 300 lines (`packages/client/src/lookdev/surface.ts`). |
| Scenes draw through a `Surface` of three calls (a filled polygon, a ribbon, lettering), with a WebGL and a Canvas 2D implementation. The Canvas 2D one is kept only for the bench. | Timing two separate programs.                                             | The same scene code goes through both, so the table compares renderers and nothing else.                                                                                                                                                                                                                                                                                                |
| A citizen reads down to 24 pixels a tile. A landing is drawn at 24 to 48 pixels a tile, by its size class.                                                                         | 16 or 20 pixels a tile, which would let a landing be half as large again. | See the scale sheet below.                                                                                                                                                                                                                                                                                                                                                              |
| A citizen stands 1.15 tiles tall to the top of its head, with a rim of bare paper round it at the far size.                                                                        | 0.94 tiles, the first figures.                                            | The operator asked for citizens a chatter can find. The rim keeps a figure clear of grass, ink and other bodies.                                                                                                                                                                                                                                                                        |

## Frame times

The bench scene (`?lookdev=bench`) is the fight script with 150 citizens, 450
monsters kept alive, at least 100 shots in the air, the ink the kills leave
and a name on every citizen that has room, with no city or land:
about 245,000 vertices a frame at 1920 by 1080. `script.test.ts` checks the
counts. Times are milliseconds a frame: "build" is the scene code filling the
frame, "whole" is build plus waiting for the frame to be on the canvas (a
pixel is read back).

| Where                                                  | Renderer  | Build, mean | Whole, mean | Whole, 95th | Frames a second |
| ------------------------------------------------------ | --------- | ----------- | ----------- | ----------- | --------------- |
| A desktop browser with a GPU, 120 and 60 frames        | WebGL 2   | 13.3        | 18.3        | 21.1        | 55              |
|                                                        | Canvas 2D | 16.2        | 40.7        | 42.9        | 25              |
| The capture container (software rendering), 240 frames | WebGL 2   | 15.9        | 283         | 408         | n/a             |
|                                                        | Canvas 2D | 30.6        | 558         | 1,405       | n/a             |

- Neither holds 60 frames a second on this load yet. WebGL is 1.6 ms a frame
  over at the mean (16.7 ms is the budget) and Canvas 2D is 24 ms over. Of
  WebGL's 18.3 ms, 13.3 is JavaScript building vertices and 5 is the GPU.
- An earlier build of the same scene, before the last round of drawing
  changes, measured 15.9 ms on WebGL and 34.1 on Canvas 2D: the ratio has
  held at a little over two, and the cost moves with what the scene code
  builds.
- The time to find is therefore in the scene code, not the renderer:
  figures and monsters are rebuilt stroke by stroke every frame. Keeping each
  body's mesh between frames while its pose is held, and drawing far-size
  bodies with fewer stations a stroke, are the first things to try. Not done
  here.
- The container has no GPU, so its numbers say only that captures are slow
  (about a fifth of a second a frame) and that the ratio between the two
  renderers is the same there.
- Not measured: Canvas 2D drawing cached sprites instead of strokes (it would
  be faster and would give up poses built per frame), frame pacing under
  `requestAnimationFrame` (the tab was not visible), and any second machine.

`docker compose run --rm capture <dir> --lookdev bench` repeats the container
rows and writes `bench.json`. The browser rows come from
`window.lookdev.bench(frames, 2)` on `?lookdev=bench&capture` and
`?lookdev=bench&capture&renderer=canvas`.

## Scale

`?lookdev=scale` draws fifteen citizens at 16, 20, 24, 28, 32, 40 and 48
pixels a tile, standing, walking, in a blow and carrying. Judged by eye on
the 1920 frame and on the same frame averaged down to 640:

| Pixels a tile | Citizen at 1920 | At 640 | Reads                                                                                                       |
| ------------- | --------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| 16            | 18 px           | 6 px   | Colour only. Hat shape and pose are gone.                                                                   |
| 20            | 23 px           | 8 px   | Colour, and that it is a person. Hat shape is unreliable.                                                   |
| 24            | 28 px           | 9 px   | Cloak colour, hat colour and shape, a raised blade, a haul. The head is 3 px at 640, the art bible's floor. |
| 32            | 37 px           | 12 px  | All of the above, comfortably.                                                                              |
| 48            | 55 px           | 18 px  | Legs, feet and the eye come in (the mid size).                                                              |

A username is lettered at 24 px whatever the scale, which is 8 px at 640: it
reads at 1920 and is at the edge of reading at 640.

The picture inside the rule is 1,828 by 940 pixels, so with every citizen in
frame a landing can be at most:

| Class    | Pixels a tile | Tiles    |
| -------- | ------------- | -------- |
| Clearing | 48            | 38 by 19 |
| Vale     | 32            | 57 by 29 |
| Valley   | 24            | 76 by 39 |

The look target's landing is a vale at 32. Its fight with twelve citizens is
framed closer, at 44.

## What this leaves open

- Names. Citizens carry chat usernames of 3 to 25 characters; the first
  fifteen of the scripted list include a 25-character name, a 3-character
  one and two pairs that differ by one character. A name is lettered over its
  citizen's head at 24 px and ruled under in the cloak's colour, and the
  roster draws the citizen beside its name, so two names a character apart
  are told apart by colour and hat. The roster is as wide as its longest
  name needs and never cuts one short. It lists four leaders and, under
  them, everyone else three at a time. With 150, a name is drawn only where
  it has room (29 of 138 in the capture's `fight150` still; the frame says
  how many), and who gets first pick moves on every 2.5 seconds. Still
  wrong: with twelve fighting shoulder to shoulder the names overlap, a
  25-character one most of all, and nothing keeps a name in the same place
  from frame to frame.
- Section 11 of `docs/art.md` still describes a cartouche with a title and
  the hour, a caption and place lettering. The operator ruled those out for
  the game's screen; the page is the art director's to change.
