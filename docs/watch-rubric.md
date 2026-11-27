# How we judge whether it is worth watching

Tests can't tell you whether a stream is worth watching. So it is judged from
captures of the running game, by a judge who didn't build the change, using
the rubric below.

Every duration on this page is stream time: seconds and minutes as a viewer
experiences them, not game-clock time.

## The capture

`docker compose run --rm capture captures/<folder> --review` runs the built
viewer in capture mode from seed 1 with a stepped clock, and writes to that
folder. It takes five or six minutes. Two runs of the same code give the same
files, byte for byte. With `--baseline <folder>` it also writes `compare.png`,
that folder's storyboard above the new one.

- **storyboard**: 12 frames, one every 10 seconds, as one image, from 19:20
  through nightfall. Shows what a viewer sees over two minutes.
- **burst**: 12 consecutive rendered frames from the busiest moment. Shows
  motion, and exposes flicker.
- **drift**: 12 frames from the first time in the day the view pans to
  another region to when it gets there. The flicker index is also taken in
  the middle of that pan, where it goes fastest, and a day in which the view
  never pans is a hard fail.
- **day strip**: 6 frames across a full day. Shows the light changing.
- **figures**: 12 residents at 07:00 with a spread of levels (`?levels`, which
  only a capture's own world takes), so every kit tier and walk can be seen:
  the full frame, a crop round the camp at twice the size, the same frame as a
  640-wide window shows it, and that crop at four times the size. Shows
  whether residents can be told apart and ranked at a glance.
- **fight**, **fight burst** and **fight down**: the same seed with the
  shipped monsters let in (`?monsters`), which the world does not have by
  default yet. The fight sheet is 12 frames a second apart from 09:28, over a
  fight with a kill and a resident downed in it; the burst is 12 frames half a
  tick apart round a blow landing; the down sheet is 12 frames half a second
  apart round the resident going down and waking at camp. The flicker index is
  also taken over that fight and one at night.
- **showcase**: the README's set: four full frames, a short looping clip of
  night falling, and smaller copies of the storyboard and day strip.
  `tools/publish-media.sh captures/<folder>` pushes it to the `media` branch.
- **crowd sheets**: the storyboard again with the world filled to 12, 50 and
  150 characters running the built-in programs, and once more at 50 with the
  figures sheet's spread of levels (`crowd-50-levels`), so the kit and the
  hats are seen in a crowd. The frames are exactly what a viewer would see;
  nothing is drawn on them for the judge.
- **metrics.json**: numbers from the same runs (below).

The same seed is used for the baseline and for a change, so two captures can be
compared frame by frame.

## Metrics (computed, not judged)

Frame metrics come from the rendered capture. The others come from the sim's
event log over a headless run of the same seed, as long as the window each one
names. The minimum dwell is the shortest time the spotlight stays on one
character, 45 seconds.

| Metric                                      | Meaning                                                                                                                                                                                  | Hard fail                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| flicker index                               | largest share of the screen whose brightness changes sharply between two consecutive frames                                                                                              | over 5% of the screen                                                                                 |
| dead air                                    | longest gap with no visible event anywhere                                                                                                                                               | over 20 s                                                                                             |
| stuck actors                                | actors that did not move or act for 60 s without a reason                                                                                                                                | any                                                                                                   |
| action mix                                  | number of different actions per character per 10 minutes                                                                                                                                 | a character with one action only                                                                      |
| trips, deaths and drops by rarity, per hour | pacing                                                                                                                                                                                   | none; tracked over time                                                                               |
| console errors                              | errors in the page during the capture                                                                                                                                                    | any                                                                                                   |
| acknowledgment                              | per character, how often it was named on screen (the news line, a caption or the spotlight)                                                                                              | at 50 characters over 60 minutes, a character that finished a trip and was never named                |
| spotlight wait                              | per character, its longest stretch without the spotlight, counting from the start of the run and up to its end, over a run three times as long as the population times the minimum dwell | any character over twice the population times the minimum dwell (one never shown fails by definition) |

How the tool reads these: something visible is a character changing tile or
the rule in charge of a character changing, since the page shows that rule
for the characters it lists. A
character counts as stuck when for 60 seconds it neither changed tile nor
was resting by choice (`wait`, for as long as the rest lasts); deciding to
walk and getting nowhere is stuck.

Hard fails are judged on the world as it ships (six residents today). The same
numbers for the crowd runs are listed in `metrics.json` as `crowdFindings`.
They say how many characters one frame can hold and block nothing.

## The rubric (judged, 0 to 5 each)

The judge sits where the audience sits: a viewer of a shared live stream, who
cannot move the camera or click anything, often with the stream small on a
second screen. The first six dimensions are that viewer's; the seventh is the
same viewer once they also own a character.

1. **Legible.** Can I tell what each character is doing, and why, in a
   three-second glance? Is the text readable at 640 pixels wide?
2. **Alive.** Does something change every few seconds, calmly? Motion with
   weight, no strobing, no frozen frame.
3. **Consequential.** Do actions lead to visible results: a haul carried home,
   a level, a narrow escape, a death, a drop?
4. **Varied.** Do the frames differ in what is happening, not only in where
   the sprites stand?
5. **Beautiful.** Composition, palette, light, cohesion. Would I leave this on
   a second monitor because it is pleasant to have there?
6. **Strategic.** Can I see different programs making different choices, and
   would I want to change one?
7. **Mine.** Judged from the seat of one player who owns one character and
   sees only what every other viewer sees. The harness picks the character
   with the median acknowledgment count, so it is neither the luckiest nor the
   most ignored, and tells the judge its name in text (and its colour, once
   players can pick one). Knowing only
   that: can I find my character in a single frame? Across the sheet and that
   character's acknowledgment and spotlight numbers, did the stream notice it?
   Is there a reason to keep watching when it is not my turn? Scored once per
   crowd sheet (12, 50 and 150 characters) and recorded as three scores. Until characters belong to players this is a
   reading of how the stream would treat one, and no milestone gates on it.

Hard fails, whatever the scores: any metric hard fail above, a camera cut,
placeholder shapes standing in for art, unreadable text.

## What applies when

A check applies once the thing it measures exists.

- Before the capture harness exists, frames are captured by hand and there is
  no baseline; the judge scores what it can see and says so.
- A dimension or metric whose subject is not built yet (no news line, no
  spotlight, no programs to tell apart) is recorded as "n/a" with the reason.
  It neither passes nor blocks a pull request.
- A milestone's closing review allows no "n/a" among the dimensions its
  roadmap entry names.

## The judge

- A fresh Mythos 5.2 agent (if Mythos cannot be reached, Codex `gpt-6.2-sol`
  or a fresh Opus 5.5 at effort `high`) with no knowledge of the change, which
  did not build it. It gets the captures, the metrics, this page and the
  number of the pull request to post its verdict on, nothing else; it does not
  read that pull request or its issue.
- Every claim must point at a frame ("storyboard frame 7: three characters
  overlap the lantern and none can be read") or at a metric.
- It returns the scores, any hard fail, and at most three findings ranked by
  how much they hurt the watching experience.
- For a pull request it gets the baseline capture too, and must say whether the
  change is better, the same or worse, and where. It posts that verdict on the
  pull request itself, signed `[watch judge] <model>`, without reading the pull
  request or its issue.
- A milestone's closing review adds a second judge from another model family
  (Codex `gpt-6.2-sol`). For each dimension the lower of the two scores
  stands, and a hard fail from either stands. If Codex already judged because
  Mythos was out, or the second judge cannot be reached, the review goes ahead
  with one judge and the closing comment says so.

## How the verdict is used

- A pull request that changes what is on screen merges only with no hard fail
  and no "worse" verdict.
- Findings become issues labelled `watch`. They are ordinary work, ahead of new
  features when they are a hard fail.
- Scores are appended to `watch-log.md` on the `media` branch, next to the
  showcase images, so the trend is visible without a pull request per entry.
- The operator's own reaction outranks any score. The daily digest shows the
  latest storyboard for that reason.
