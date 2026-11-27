# Roadmap

The issue tracker is where the actual work is listed. This page says what each
milestone is for and how to tell when it's finished. [plan.md](plan.md) has the
reasoning, the numbers and the pieces of each milestone.

## M1: First Light

Four regions (the camp's, a pinewood, hills and a lower river), residents on
three built-in programs, two kinds of monster on programs of their own, and a
day and night cycle. The aim is something you could leave running on a second
screen and not get bored of in ten minutes.

| Part                                             | State                                                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Simulation core: map, movement, clock, snapshots | done                                                                                                                          |
| Bot VM, Tactics and its compiler                 | done                                                                                                                          |
| Server: real time, snapshots, WebSocket          | done; a content change keeps the world                                                                                        |
| Regions                                          | done: four maps joined by exits, and the view follows the spotlit resident between them. Only the camp's region has monsters. |
| Viewer: the map, the figures, day and night      | done                                                                                                                          |
| Capture tool and metrics                         | done for six residents; judging at 15 from a player's seat is #314                                                            |
| Combat                                           | telegraphed blows work and are drawn. One monster at a time, 1.2 s between blows, numbers that never grow                     |
| Monsters as a threat                             | wolves and goblins exist; hunting packs (#298, #299) and swarms (#316) are not in                                             |
| Tempo: fast steps and blows, wide attacks, moves | not started (#315 to #324)                                                                                                    |
| Skills, the bag and the bank                     | experience, gathering, cooking and eating work in the simulation; levels change nothing in a fight until #317                 |
| Trips, death drops, hauls on screen              | not started (#237, #238); the viewer does not draw gathering                                                                  |
| Items                                            | the item tables roll; nothing drops and nobody wears anything (#240, #241)                                                    |
| The page                                         | six large rows; the line under each name comes from the resident's state; the compact page for 15 is #231                     |
| Spotlight                                        | the director picks a subject and the map follows it; no card drawn (#245)                                                     |

**The candidate** is the first build worth showing: 15 residents with an aim,
fast fights against packs with ink on the ground, wolves that hunt, hauls
carried home, gear worn, and a page that fits everyone. It needs #298,
#309, #315, #316, #317, #318, #319, #320, #321, #323, #324, #299, #237, #238,
#240, #231, #314, #326 (a wider view that frames the action, and a measure of
how long each resident is in the frame), and one issue to be filed that gives
the other three regions monsters.

M1 is finished when all of these hold:

1. `docker compose up server client` shows the world at `localhost:4310`, and
   restarting the server doesn't lose progress.
2. A headless run of 24 simulated hours finishes with no error and no actor
   stuck.
3. The determinism tests pass: the same seed gives the same hash, and a world
   restored from a snapshot carries on identically.
4. The watch review ([watch-rubric.md](watch-rubric.md)), taken at 15
   residents, has no hard fail, each of the first six scores is 3 or more, and
   their mean is 3.5 or more. Its absolute verdict from a player's seat (#314)
   has no "no".
5. On the mow sheet (#323), a judge with the page hidden can say which
   resident is stronger, and can see afterwards that a fight happened.
6. A tick averages 4 ms or less, and none takes over 25 ms, with 150
   residents and four regions at their night budgets.
7. In an hour of capture at 15 residents, every resident is in the map frame
   for 240 seconds or more, with no gap over 20 minutes.

A judge also watches that hour and says what minute 50 showed that minute 10
did not. The answer is written up and doesn't block M1; the calendar in M3 is
what it is for. The "Mine" score is taken at 15 and 50 residents and written
up. It doesn't block M1 either, because M1 has no players.

## After M1

Each milestone is filed as at most twelve issues when the one before it
closes. The order can change; a change is recorded in `docs/decisions/`.

Before a milestone is filed, its section of the plan has to pass the fun test
([plan.md](plan.md), section 4.6): what a viewer sees in an hour and how
often, how many seconds an hour an owner's resident is on screen, one
decision with a result the owner can see, what is new after a day away, a
judge who plays it, and the need for anything it adds. The last column below
is the least time a present owner's resident is in the map frame, in seconds
an hour, with the map at about 32 pixels a tile (#326), where the frame
holds a region and a half each way. It must never go under 240. From M2 an
owner's own page also shows their resident live.

| Milestone                    | What it adds                                                                                                                                                                                                                                    | Finished when                                                                                                                                                                                                                                                                   | In the frame |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------: |
| **M2 Builds and owners**     | Loadouts of techniques named in the program, weapons that change the basic attack, five starter programs. Claiming a resident from chat, the companion page with the owner's resident drawn live, the editor, the director on the server.       | A judge names each resident's weapon and a technique from a fight sheet without the page. Each starter's main slider changes a measured outcome. 50 scripted owners run 60 game days with no error, and the input log replays to the same hash. Mine is 3 or more at 15 and 50. |          817 |
| **M3 The year**              | A 64-day year with quarters, weather and a moon, and a vote on the weather each hour. The elk, the wolf winter, the fish run. At least four set pieces an hour. Replays of a resident's best moment, and trying a program before submitting it. | Four quarters can be told apart at 18:00. A judge says what minute 50 of an hour showed that minute 10 did not. Six hours each have four set pieces. A baked moment replays tick for tick.                                                                                      |          817 |
| **M4 Works and Stonefall**   | Works built from what residents deliver, charting, and the first way down: Stonefall, at tier 2, with the Quarry Troll. The goblins' hoard and raids. A message that carries one frame.                                                         | A fresh world of house residents builds the Hill Road and opens Stonefall with no input. A level-38 resident earns twice as much there as in the Hills and a level-18 one is downed. Five level-45 residents kill the Quarry Troll.                                             |          612 |
| **M5 The deep**              | Three regions under the Hills down to tier 5, each with a boss. Nests and marches. Uniques. Rings at 99.                                                                                                                                        | For tiers 3 to 5, a resident of the tier clears a pack and one two tiers short is downed. The tick stays at 4 ms with eight regions. A capture at 120 residents holds the frame time.                                                                                           |          612 |
| **M6 Trades and the store**  | Mining, Smithing, Woodworking, Archery. A store that pays by its stock. Tempering.                                                                                                                                                              | Over 60 game days at 50 residents prices move, two starter programs change what they gather because of them, and no pool of goods grows without limit. A judge says which good is scarce from the piles.                                                                        |          612 |
| **M7 Players among players** | Companies with their own fire, pitches, boards in bands, weekly trials, thirteen-week rounds with titles, mastery, a library of programs to fork. Filed when M6 closes.                                                                         | A round runs to titles that re-running confirms. A trial's winning run replays on the page.                                                                                                                                                                                     |          612 |

Eight regions are in the milestones above, in a grid three regions tall that
four positions of the frame cover. Three more (the Mere, the Mire and the
Barrow Downs) are built only when a running world has more than 12 residents
for each open region, which brings the frame time to 408. The world holds at
most 150 residents.

The plan ends with the questions the team settled for itself (section 8).
Players are a scripted crowd behind a local chat page, and nothing is
deployed.
