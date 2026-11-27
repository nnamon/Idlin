# Roadmap

The issue tracker is where the actual work is listed. This page says what
each milestone is for and how to tell when it's finished.
[plan.md](plan.md) has the game, the reasoning, the numbers and the pieces
of each milestone, and [chat.md](chat.md) has how chat joins and commands
citizens.

The game is being rebuilt around a walking city with a horde behind it
([#331](https://github.com/nnamon/Idlin/issues/331),
[decision 0028](decisions/0028-the-walking-city.md)). Every 20 minutes the
picture pulls back from a crowded city to the land it has set down on, a
clearing or a valley, its residents go out into it, and it leaves when the
horde arrives. Every resident is on screen all the
time, in one frame that never cuts. What is built so far was built for a fixed
camp with four regions round it. The table says what of it carries over.

## M1: First Light

Hull I, which does not grow; one biome in three sizes of landing; a scripted crowd of 15 chatters; packs in formation; the horde; the winch; and the vanguard at the walls. The aim is
three cycles a viewer would sit through, and stay for the next lift.

| Part                                                     | State                                                                                                     | For the walking city                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Simulation core: tiles, movement, snapshots, determinism | done                                                                                                      | carries over; the 24-minute day becomes the 20-minute cycle (W1)                                                            |
| Bot VM, Tactics and its compiler                         | done                                                                                                      | carries over; sections and the new sensors come with W5 to W8                                                               |
| Server: real time, snapshots, WebSocket                  | done; a content change keeps the world                                                                    | carries over; set-down goes on the real clock (W1)                                                                          |
| Maps                                                     | four hand-made regions joined by exits                                                                    | replaced by generated landings in three sizes (W3) and the city's decks (W2); the four maps stay as test fixtures           |
| Viewer: the pen, the figures, effects, day and night     | done                                                                                                      | carries over; it gains the one frame and the city in cut-away (W9, W10)                                                     |
| Capture tool and metrics                                 | done: captures at 15 residents, judged from a player's seat as well as against `main`                     | carries over; it captures a cycle (W12)                                                                                     |
| Combat                                                   | telegraphed blows work and are drawn. One monster at a time, 1.2 s between blows, numbers that never grow | the tempo chain, #315 to #324, as filed, and projectiles and knockback (#332)                                               |
| Monsters                                                 | wolves and goblins; hunting packs are in review (#330)                                                    | carry over; they are placed across a site and wake when someone is near (W4), and hunting packs run ahead of the horde (W6) |
| Skills, the bag and the bank                             | experience, gathering, cooking and eating work in the simulation                                          | carry over; the bank becomes the hold (W2)                                                                                  |
| Trips and death drops                                    | in progress (#237)                                                                                        | become sorties, the way home and the lift (W5)                                                                              |
| Items                                                    | the item tables roll; nothing drops and nobody wears anything (#240, #241)                                | carry over, with a locker                                                                                                   |
| The page                                                 | six large rows; the compact page for 15 is in progress (#231)                                             | carries over as the rows; phase layouts are W11                                                                             |
| The view                                                 | one region at a time, following the spotlit resident                                                      | replaced by one frame that is tight on a crossing, opens at a landing and closes with the horde (W9)                        |

**The candidate** is twelve new pieces, W1 to W12 in
[plan.md](plan.md), section 13, and eleven issues already filed: #315, #316,
#317, #318, #319, #320, #324, #332, #330, #231 and #240. It also needs C1,
C2, C3, C5 and C8 of chat.md's first slice, so that its cast is chatters.

| Piece | What it is                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1    | The cycle clock and phases, with set-down on the real clock                                                                                                                    |
| W2    | The city as an actor with a name and colours; Hull I as a tile map of two decks with 40 berths                                                                                 |
| W3    | The landing generator for the heath in three sizes, clearing, glade and vale, from one table of dials                                                                          |
| W4    | Monsters placed across a site in packs that keep a formation, waking near residents; the tick measured                                                                         |
| W5    | The way home, downs, the lift, and the winch: bag and kit left in a heap                                                                                                       |
| W6    | The horde: its front, holding it, the lift when it reaches the lamps, the lead, and what it takes                                                                              |
| W7    | Three sortie programs with a margin, one of which stands in the rearguard                                                                                                      |
| W8    | The crossing, and the vanguard at the walls: hooks, climbers, boarders, bolt throwers, a captain in lost kit                                                                   |
| W9    | The breath: tight on the hull, the reveal with the land inked as the frame pulls back, the landing held, the close with the horde, with every resident always inside the frame |
| W10   | The city in cut-away, walking, with the winch and the route map in its corner, to the art bible                                                                                |
| W11   | The lettering by phase, as plate furniture, with the gangway list                                                                                                              |
| W12   | Capture of a cycle and each finished map, its metrics, and the rubric for a cycle                                                                                              |

M1 is finished when all of these hold:

1. `docker compose up server client` shows the city at `localhost:4310`, and a restart loses
   nothing.
2. A headless run of 72 cycles ends with no error and no actor stuck, and
   in every landing at least 80% of residents brought a bag home.
3. The determinism tests pass, with a snapshot taken in each phase.
4. Over those 72 cycles, 2% to 10% of those who went out were winched in at
   a lift, no more than a third of lifts had everyone aboard, and the lift
   came at between 10:00 and 15:00 with at least two minutes between the
   earliest and the latest.
5. A tick averages 4 ms or less and none takes over 25 ms, with 150
   residents and 400 monsters awake.
6. **Every resident is inside the frame on every frame of three captured
   cycles,** at 3, 15 and 40 chatters, and the capture has no cut. This is a
   hard fail.
7. A judge watches three cycles of capture, one on each size of landing,
   from a player's seat (#314). No hard fail. Shown only the frame at the
   end of each reveal, the judge ranks the three landings by danger and gets
   it right. With the lettering hidden, the judge can say where the horde is
   and about how long the city has. The judge says the crossing feels
   crowded and the glade feels large, and answers yes to "would you stay for
   the next lift?".
8. A username that speaks for the first time has a resident on screen within
   five seconds, in every phase. One that went below after 24 quiet hours comes
   back on a line with its levels and locker. A 41st chatter takes the berth
   of the one quiet longest.

## After M1

Each milestone is filed as at most twelve issues when the one before it
closes. The order can change; a change is recorded in `docs/decisions/`.
Before a milestone is filed, its part of the plan has to pass the fun test
([plan.md](plan.md), section 14).

| Milestone                    | What it adds                                                                                                                                                                                                                                                                                                                                                               | Finished when                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M2 Chat**                  | The rest of chat.md's first slice on the walking city: speech, the flag and `!go`, orders on screen, the vote on the next stop drawn on the route map, moderation, choosing a preset, the streamer's site. More presets. Valleys.                                                                                                                                          | A judge plays a chatter through a landing and a crossing and can tell their preset and numbers made the difference. Fifty scripted chatters run 216 cycles with no error and the input log replays to the same hash.                                                                                                                       |
| **M3 The city grows**        | Modules and tiers, districts drawn by tier, cores and the core run, pledges. Hulls II and III, with more berths. The vote on the next stop, drawn on the route map and the mast. Glades, vales and valleys offered by country and by the Engine. Site conditions, the hold's prices, damage and mending, the walker and the toll.                                          | A city of 40 scripted chatters with 30 more waiting is rebuilt as Hull II with no other input, and those waiting board. A judge shown two crossings a day apart says what the city gained. A scripted crowd's choices of stop are reported with what each size cost and paid. No resident is outside the frame in a valley at 80 chatters. |
| **M4 The crossing**          | A continent of six countries, ten more biomes, feet and range, great landings every eight hours, strongholds, gates held against the horde, uniques, Hulls IV to VI, the atlas, and the end of a crossing.                                                                                                                                                                 | A scripted city crosses a continent headless and ends as Hull VI. The tick bar holds at 150 residents in a valley. A judge at 150 finds their resident within five seconds and stays for the lift.                                                                                                                                         |
| **M5 Players among players** | Boards for each landing and day, bands under a banner, more presets, weekly trials. Filed when M4 closes.                                                                                                                                                                                                                                                                  | A trial's winning run replays tick for tick.                                                                                                                                                                                                                                                                                               |
| **M6 City against city**     | One streamer is one city. Rivals on the route map and three boards (size, depth, rivals beaten). Contested valleys: two cities race for one landing and farm it, each with its own horde. Encounters on a crossing: a trade bridge, a boarding or a chase, chat against chat. A local shared service for the map and meetings, with a meeting run by both servers in step. | Two local worlds on one seed contest a valley and fight a boarding with matching hashes throughout, and a meeting cut off at any tick leaves both cities whole. Its own fun test in the plan passes.                                                                                                                                       |

A city holds as many residents as its hull has berths, from 40 to 150, one
for each person who has chatted.
Until there is a real chat, a scripted crowd of usernames stands in for it
behind a local chat page, and nothing is deployed. City against city is built and tested with two cities on one machine;
hosting the shared service that lets two streams meet is not planned.
