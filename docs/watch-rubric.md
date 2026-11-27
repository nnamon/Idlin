# How we judge whether it is worth watching

Tests can't tell you whether a stream is worth watching. So it is judged from
captures of the running game, by a judge who didn't build the change, using
the rubric below.

Every duration on this page is stream time: seconds and minutes as a viewer
experiences them, not game-clock time.

## The capture

`docker compose run --rm capture captures/<folder> --review` runs the built
viewer in capture mode from seed 1 with 15 residents and a stepped clock, and
writes to that folder. It takes five or six minutes. Two runs of the same code
give the same files, byte for byte. With `--baseline <folder>` it also writes
`compare.png`, that folder's storyboard above the new one. Every sheet has 15
residents unless it says otherwise. Moments that depend on what the world
does (the busiest moment, the first pan, the figures' moment, the fight) are
found by running the same world headless and searching it, so they move with
the world when it changes.

- **storyboard**: 12 frames, one every 10 seconds, as one image, from 19:20
  through nightfall. Shows what a viewer sees over two minutes.
- **residents-6**: the storyboard's first frame at full size with six
  residents, the number the page was first built for, to compare with.
- **burst**: 12 consecutive rendered frames, a sixth of a tick apart, from the
  busiest two ticks of the day after 07:00 (the most residents on the map
  changing tile). Shows motion, and exposes flicker. If the twelve frames are
  all the same, `metrics.json` says so (`burstStill`).
- **drift**: 12 frames from the first time in the day the view pans to
  another region to when it gets there. The flicker index is also taken in
  the middle of that pan, where it goes fastest, and a day in which the view
  never pans is a hard fail.
- **day strip**: 6 frames across a full day. Shows the light changing.
- **figures**: the residents with a spread of levels and deaths (`?levels`
  and `?deaths`, which only a capture's own world takes), at the moment from
  07:00 to 09:00 when the map shows the most of them, so every kit tier and
  walk can be seen in a crowd: the full frame, a crop round where they stand
  at twice the size, the same frame as a 640-wide window shows it, and that
  crop at four times the size. Shows whether residents can be told apart and
  ranked at a glance. `metrics.json` gives the moment and how many were on
  the map.
- **fight**, **fight burst** and **fight down**: the same seed with the
  shipped monsters let in (`?monsters`), which the world does not have by
  default yet. The fight is the first in the day in which a resident goes
  down on the map and a monster goes down within 70 ticks of it. The fight
  sheet is 12 frames a second apart from two seconds before the earlier of
  the two; the burst is 12 frames half a tick apart round the last blow that
  landed on that resident; the down sheet is 12 frames half a second apart
  from its fall to waking at camp. The flicker index is also taken a tick
  before that blow and a tick before the first blow on the map after 19:00.
  With no such fight in the day there are no fight sheets, and the capture
  says so.
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
residents, with no baseline and no scores to fill in. The judge goes through
the whole capture and writes down what a player who owns one of the 15 would
complain about, one line each with the frame it shows in, worst first.
Nothing is too small or out of scope for it. [process/daily.md](../process/daily.md)
says where the list goes.

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
- It returns the scores, any hard fail, the absolute verdict (three yes or no
  answers), and the fix-now findings: every "no" and anything else a player
  would notice, ranked by how much they hurt the watching experience.
- For a pull request it gets the baseline capture too, and must say whether the
  change is better, the same or worse, and where, beside the absolute verdict.
  It posts both on the pull request itself, signed `[watch judge] <model>`,
  without reading the pull request or its issue.
- A milestone's closing review adds a second judge from another model family
  (Codex `gpt-6.2-sol`). For each dimension the lower of the two scores
  stands, and a hard fail from either stands. If Codex already judged because
  Mythos was out, or the second judge cannot be reached, the review goes ahead
  with one judge and the closing comment says so.

## How the verdict is used

- A pull request that changes what is on screen merges only with no hard fail,
  no "worse" verdict, and, unless it closes one of them, no open fix-now issue
  that judges have raised twice or more, on any pull request or playtest. The conductor checks the last of
  these, since the judge does not read the tracker.
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
