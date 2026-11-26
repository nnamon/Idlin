# Judging "is this fun to watch"

Tests cannot answer this. It is judged from real captures of the running game,
by a judge who did not build the change, against the rubric below.

## The capture

`docker compose run --rm capture` runs the viewer in replay mode from a fixed
seed with a stepped clock, and writes to `captures/<date>-<sha>/`:

- **storyboard** — 12 frames, one every 10 seconds of game time, as one image.
  Shows what a viewer sees over two minutes.
- **burst** — 12 consecutive rendered frames from the busiest moment. Shows
  motion, and exposes flicker.
- **day strip** — 6 frames across a full day. Shows the light changing.
- **metrics.json** — numbers from the same run (below).

The same seed is used for the baseline and for a change, so two captures can be
compared frame by frame.

## Metrics (computed, not judged)

| Metric | Meaning | Hard fail |
|---|---|---|
| flicker index | largest share of the screen whose brightness changes sharply between two consecutive frames | over 5% of the screen |
| dead air | longest gap, in seconds, with no visible event anywhere | over 20 s |
| stuck actors | actors that did not move or act for 60 s without a reason | any |
| action mix | spread of different actions per character per 10 minutes | a character with one action only |
| trips per hour, deaths per hour, drops by rarity per hour | pacing | none; tracked over time |
| console errors | errors in the page during the capture | any |

## The rubric (judged, 0 to 5 each)

1. **Legible** — can I tell what each character is doing, and why, in a
   three-second glance? Is the text readable at 640 pixels wide?
2. **Alive** — does something change every few seconds, calmly? Motion with
   weight, no strobing, no frozen frame.
3. **Consequential** — do actions lead to visible results: a haul carried home,
   a level, a narrow escape, a death, a drop?
4. **Varied** — do the frames differ in what is happening, not only in where
   the sprites stand?
5. **Beautiful** — composition, palette, light, cohesion. Would I leave this on
   a second monitor because it is pleasant to have there?
6. **Strategic** — can I see different programs making different choices, and
   would I want to change one?

Hard fails, whatever the scores: any metric hard fail above, a camera cut,
placeholder shapes standing in for art, unreadable text.

## The judge

- A fresh agent with no knowledge of the change, on a different model from the
  one that built it. It gets the captures, the metrics and this page, nothing
  else.
- Every claim must point at a frame ("storyboard frame 7: three characters
  overlap the lantern and none can be read").
- It returns the six scores, any hard fail, and at most three findings ranked
  by how much they hurt the watching experience.
- For a pull request it gets the baseline capture too, and must say whether the
  change is better, the same or worse, and where.

## How the verdict is used

- A pull request that changes what is on screen merges only with no hard fail
  and no "worse" verdict.
- Findings become issues labelled `watch`. They are ordinary work, ahead of new
  features when they are a hard fail.
- Scores are appended to `docs/watch-log.md` so the trend is visible.
- The operator's own reaction outranks any score. The daily digest shows the
  latest storyboard for that reason.
