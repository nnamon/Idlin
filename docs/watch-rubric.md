# How we judge whether it is worth watching

Tests can't tell you whether a stream is worth watching. So it is judged from
captures of the running game, by a judge who didn't build the change, using
the rubric below. On a `look` pull request the judge is the art director, in
its one look pass (step 7 of [process/cycle.md](../process/cycle.md)). The
daily playtest and a milestone's closing review are judged by a watch judge
that knows nothing of the changes.

Every duration on this page is stream time: seconds and minutes as a viewer
experiences them, not game-clock time.

## The capture

`docker compose run --rm capture captures/<folder> --review` runs the built
viewer in capture mode from seed 1, with the 15-chatter crowd
(`content/chat/crowd-15.txt`) as its chat, and writes to that folder. Two
runs of the same code give the same files, byte for byte. With
`--baseline <folder>` it also writes `compare.png`, that folder's storyboard
above the new one.

Until slice piece 2b draws the deck and the landing, the view is plain: the
ground as flat tiles, citizens as dots, and the beat along the top. The
review set is:

- **storyboard**: 12 frames as one image, one from each beat of the first
  cycle and the next legs-plant: transit, the raid window, legs-plant, the
  ramp down, the peace, the scouts, the front, the march, the siege, the
  break, lift-off and the next legs-plant (`STORYBOARD` in
  `tools/capture/src/index.ts`).
- **storyboard-640**: the same frames as a 640-wide window shows them. The
  tool still writes it, but nothing is judged on it: the viewer watches on a
  desktop at 1920 by 1080.
- **showcase**: the README's set: the transit, landing and siege frames, and
  the storyboard at half size. `tools/publish-media.sh captures/<folder>`
  pushes it to the `media` branch.
- **metrics.json**: the tick, beat and citizens of each frame, the flicker
  index, console errors and hard fails.

The camp's sheets (residents-6, burst, drift, day strip, figures, the fight
sheets and the crowd sheets) went with the camp world, and so did the
metrics the tool worked out from a headless run of it. Piece 2b and the
pieces after it bring back what the review needs for the city; until then
only the flicker index and console errors below are computed.

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
| residents downed                            | residents downed in the game day of the world with its monsters that the fight sheets come from (`downs`)                                                                                | none; tracked over time                                                                               |
| console errors                              | errors in the page during the capture                                                                                                                                                    | any                                                                                                   |
| acknowledgment                              | per character, how often it was named on screen (the news line or the spotlight)                                                                                                         | at 50 characters over 60 minutes, a character that finished a trip and was never named                |
| spotlight wait                              | per character, its longest stretch without the spotlight, counting from the start of the run and up to its end, over a run three times as long as the population times the minimum dwell | any character over twice the population times the minimum dwell (one never shown fails by definition) |

How the tool reads these: something visible is a character changing tile, a
blow or a character going down on the map, or a change in the line the page
shows under a resident it lists (what it is doing, as
`packages/client/src/line.ts` builds it). The rule in charge changing is not
counted on its own, since the page's line is read off the resident's state
and not its rules. A
character counts as stuck when for 60 seconds it neither changed tile nor
was resting by choice (`wait`, for as long as the rest lasts); deciding to
walk and getting nowhere is stuck.

Hard fails are judged with 15 residents, the crowd the captures show, and
with six, the world as it ships today. The same numbers for 12, 50 and 150
are listed in `metrics.json` as `crowdFindings`. They say how many characters
one frame can hold and block nothing.

## The rubric (judged, 0 to 5 each)

The judge sits where the audience sits: a viewer of a shared live stream, who
cannot move the camera or click anything, often with the stream small on a
second screen. The first six dimensions are that viewer's; the seventh is the
same viewer once they also own a character.

1. **Legible.** Can I tell what each character is doing, and why, in a
   three-second glance? Is the text readable on the 1920 frame viewed at full
   size, at the sizes in art.md, section 11?
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

## The absolute verdict

Scores and a comparison with `main` say whether a change made things better.
They don't say whether the game is any good: a problem that is on both sides
scores "same". So every judgement also answers three questions on its own
terms, from the seat of a viewer who owns one resident among 15 and watches
the stream at full size. The judge picks one resident by name from the
storyboard's page and keeps it for all three.

1. **Find.** Would I find my resident within five seconds, on the map or on
   the page?
2. **Follow.** Can I tell how it is doing: what it is doing, whether it is
   hurt, whether it is getting anywhere?
3. **Stay.** Would I want to keep watching, including while the view is on
   someone else?

Each answer is yes or no, with the frames it rests on. A "no" is a fix-now
finding, whether or not `main` has the same problem and whether or not the
change touched it. The judge also lists as fix-now anything else a player in
that seat would notice and complain about, in or out of the change's scope.

## The playtest

The daily digest's watch review is a playtest of `main`: the same seat, at 15
residents, with no scores to fill in. Its baseline is the last playtest's
capture, usually the previous day's, and the judge says whether today's is
better, the same or worse, with the reason and the frames. It is told nothing
about what merged in between, so it is the one blind check of whether the
game got worse. It then goes through the whole capture and writes down what a
player who owns one of the 15 would complain about, one line each with the
frame it shows in, worst first. Nothing is too small or out of scope for it.
[process/daily.md](../process/daily.md) says where the list goes.

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
  or a fresh Opus 5.5 at effort `high`) that did not build what it judges.
  The watch judge gets the captures, the metrics and this page, and nothing
  about the changes. The art director, judging a pull request, also has the
  issue and its own brief.
- Every claim must point at a frame ("storyboard frame 7: three characters
  overlap the lantern and none can be read") or at a metric.
- It returns any hard fail, the absolute verdict (three yes or no answers),
  and the fix-now findings: every "no" and anything else a player would
  notice, ranked by how much they hurt the watching experience. A milestone's
  closing review also gives the scores.
- For a pull request the art director gets the baseline capture too, and must
  say whether the change is better, the same or worse, and where, beside the
  absolute verdict. It also says how close the change comes to the look
  target on [#362](https://github.com/nnamon/Idlin/issues/362) for what the
  target shows. All of it goes in its look pass on the pull request, signed
  `[art director] <model>`.
- A milestone's closing review adds a second judge from another model family
  (Codex `gpt-6.2-sol`). For each dimension the lower of the two scores
  stands, and a hard fail from either stands. If Codex already judged because
  Mythos was out, or the second judge cannot be reached, the review goes ahead
  with one judge and the closing comment says so.

## How the verdict is used

- A pull request that changes what is on screen merges only with no hard fail,
  no "worse" verdict, and, unless it closes one of them, no open fix-now issue
  that has been raised twice or more, on any pull request or playtest. The
  conductor checks the last of these against the tracker.
- Fix-now findings become issues labelled `watch`, unless an open one already
  covers them, and go ahead of polish and new features. A finding raised
  again is a comment on its issue, so the count is kept there. Other findings
  become `watch` issues as ordinary work, ahead of new features when they are
  a hard fail.
- Each day's playtest goes at the top of `playtest.md` on the `media` branch,
  next to the showcase images, so the trend is visible without a pull request
  per entry. `watch-log.md` there keeps the scores from before the playtests.
- The operator's own reaction outranks any score. The daily digest shows the
  latest storyboard for that reason.
