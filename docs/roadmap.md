# Roadmap

The issue tracker is where the actual work is listed. This page says what
exists, what is being built now, and how to tell when it is finished.
[slice.md](slice.md) has the rules and the numbers.

## What exists

The code is the camp prototype: a fixed camp with four regions round it. The
team stopped widening it on
[#361](https://github.com/nnamon/Idlin/issues/361), and the walking city
([design.md](design.md)) is built from its parts.

| Part                                             | State                                                                                | In the slice                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| Simulation core: map, movement, clock, snapshots | done                                                                                 | kept                                        |
| Bot VM, Tactics and its compiler                 | done                                                                                 | kept, with new sensors and `param`          |
| Server: real time, snapshots, WebSocket          | done; a content change keeps the world                                               | kept, with an input log                     |
| Capture tool, metrics and the watch rubric       | done: captures at 15 residents, judged from a player's seat                          | kept                                        |
| Regions                                          | four maps joined by exits; only the camp's has monsters                              | replaced by the deck and generated landings |
| Combat                                           | telegraphed blows, 1.2 s between them, numbers that never grow; wolves hunt in packs | rewritten at tempo, with ranks and levels   |
| Skills, the bag and the bank                     | experience, gathering, cooking and eating work; levels change nothing in a fight     | rewritten as Arms, the haul and the stash   |
| Items                                            | the item tables roll; nothing drops and nobody wears anything                        | extended and wired in                       |
| Viewer: the map, the figures, day and night      | done for the camp; little of it meets [art.md](art.md)                               | redrawn to the look target                  |
| The page and the spotlight                       | six large rows; the view follows one resident between regions                        | replaced by the four corners and the zoom   |

## The slice

One cycle of the city, 13 minutes, looping, at the quality of a finished
game: a landing with its seven phases, from the peace to the siege of the
city's shield, and the first two of four city sizes, so that a city left
running grows. Nothing else is built until it is done.

1. [#362](https://github.com/nnamon/Idlin/issues/362) the look target,
   [#363](https://github.com/nnamon/Idlin/issues/363) the sim at scale,
   [#364](https://github.com/nnamon/Idlin/issues/364) the landing generator,
   with [#415](https://github.com/nnamon/Idlin/issues/415) and
   [#416](https://github.com/nnamon/Idlin/issues/416) for its city sizes and
   its open yard, and [#365](https://github.com/nnamon/Idlin/issues/365) the
   spec.
2. The thirty-three build pieces in [slice.md](slice.md), section 11, in
   that order, each filed as one issue when the one it depends on is in
   review.
3. The watch judge playtests the running slice once a day, and what it files
   goes ahead of the next piece.

The slice is finished when all of these hold:

1. `docker compose up server client` shows the city walking its cycle at
   `localhost:4310`, and restarting the server doesn't lose progress.
2. A headless run of 100 cycles with 15 scripted chatters, and of 20 cycles
   with 150, finishes with no error and no actor stuck. The run at 15 starts
   on the first city and ends on the second, and in both runs every
   lift-off is 30 seconds after the shield breaks.
3. The determinism tests pass: the same seed and inputs give the same hash,
   and a snapshot with its input log replays to the live world's hash.
4. A tick averages 4 ms or less and none takes over 25 ms, and the viewer
   holds 60 frames a second, with 150 citizens, 700 monsters and 150
   things in the air.
5. The drop rules of [slice.md](slice.md), section 3.2, pass their tests:
   every value of the drop roll and the kind roll counted exactly against
   the weights for each rank and bonus; a level-23 citizen's share exactly
   7.67 packs, 60 fodder, 15 pack monsters and 6 brutes to every 10, and the
   laid weight of each share times its pay equal to its whole weight, or to
   5 times its laid weight where the pay is held at 5; and on a fixed seed,
   1,000,000 fodder kills giving 40,000 drops, give or take 784 (4 standard
   deviations).
6. On an hour's capture at 15 chatters, the watch judge's verdict from a
   player's seat has no "no" and no hard fail, the art director signs it
   off against the look target, and the playtester's list has nothing above
   polish.
7. A judge playing one chatter through the local chat page joins, finds
   their citizen, sends it to a den, brings a rare home, wears it and uses a
   tool on it, and can say what each command did.

## After the slice

Planned when the slice closes, as at most twelve issues, with the plan
recorded in `docs/decisions/`:

- Transit meets other things than raiders, and then another streamer's city.
- City sizes 3 and 4 and their landings, up to 128 by 72 tiles
  ([#418](https://github.com/nnamon/Idlin/issues/418)), more to do in the
  peace, biomes, bosses, deeper landings.
- A site for chatters once there is single sign-on.

Players are a scripted crowd behind a local chat page, and nothing is
deployed.
