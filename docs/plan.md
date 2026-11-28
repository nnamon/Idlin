# Plan

The plan is [slice.md](slice.md): one cycle of the walking city, built to
finished quality before anything is added to it
([#361](https://github.com/nnamon/Idlin/issues/361)). [roadmap.md](roadmap.md)
has its exit check, and [design.md](design.md) says what the game is.

This page used to hold the plan for a fixed camp with eleven regions round
it, in milestones M1 to M7. That plan is withdrawn. What follows is the part
of it the slice is built on: the arithmetic of a fight, and what was measured.
The rest is in the history of this file and in decisions 0022 to 0024.

## 1. What no longer holds

Regions, exits and the way down; the director, the spotlight and the
accounting of seconds on screen; the year, its quarters and its weather;
works, the store and tally; companies, rounds and boards; owners claiming
residents, the companion page and the program editor; every vote; the
milestone list. The slice's section 10 says what becomes of the code and the
open issues.

## 2. The numbers that still hold

All integer arithmetic, rounded down. `L` is a citizen's level in the skill
concerned, `M` a monster's level. A monster's level is that of the ground it came out
on ([slice.md](slice.md), section 1).

### 2.1 Citizens and monsters

- Base blow: `6 + L + L*L/20`, on the Arms level.
- Hitpoints: `40 + 10*L + L*L/5`, on the Hitpoints level.
- Gear is expected to multiply a blow by `(100 + 2*L)/100` and what a citizen
  can take by `(100 + L)/100`, for a citizen wearing ordinary rare gear of
  its own level. The item tables are tuned to that. The best gear is about a
  third above it. A crit is double; aim is the crit chance, 5% bare and 40%
  at most.
- A monster's hitpoints are `rank * blow(M) * (100 + 2*M)/100`, with rank 1
  for fodder, 3 for pack, 12 for a brute, 40 for an elite and `300 + 7*M` for
  a boss.
- A monster's blow is a share of `hp(M) * (100 + M)/100`, where `hp` is the
  citizen's hitpoints formula above taken at the monster's level: 1% for fodder, 4%
  for pack, 25% for a brute, 40% for an elite, and never less than 1. Boss
  blows are set per boss.

The monster formulas include the gear factors. Without them a geared citizen
a few levels short would kill deeper fodder in one blow, and walking further
out would show nothing.

| Level | Base blow | Hitpoints | Blow with ordinary gear | Fodder hp / hit | Pack hp / hit | Brute hp / hit | Elite hp |
| ----: | --------: | --------: | ----------------------: | --------------- | ------------- | -------------- | -------: |
|     5 |        12 |        95 |                      13 | 13 / 1          | 39 / 3        | 158 / 24       |      528 |
|    18 |        40 |       284 |                      54 | 54 / 3          | 163 / 13      | 652 / 83       |    2,176 |
|    38 |       116 |       708 |                     204 | 204 / 9         | 612 / 39      | 2,449 / 244    |    8,166 |
|    58 |       232 |     1,292 |                     501 | 501 / 20        | 1,503 / 81    | 6,013 / 510    |   20,044 |
|    78 |       388 |     2,036 |                     993 | 993 / 36        | 2,979 / 144   | 11,919 / 906   |   39,731 |
|    95 |       552 |     2,795 |                   1,600 | 1,600 / 54      | 4,802 / 218   | 19,209 / 1,362 |   64,032 |

Against monsters 20 levels over its own, a citizen of level 15 or more in
ordinary gear needs 2 to 5 blows for a fodder monster, and a brute's hit
takes 38% to 83% of what it can stand. Below level 15 the gap is wider: a
level-5 citizen needs 8 blows for a level-25 fodder monster and is downed by
one hit from a brute there. At 40 levels over, one or two brute hits put
anyone down. That gap is what the ground levels of a landing are made of. Content allows a
monster 4,000,000 hitpoints, and everything stays inside 32 bits.

### 2.2 Time

- Ten ticks a second.
- A step takes 4 ticks, a diagonal step 6. Citizens never step faster than 4
  without an item that says so. Runners, stalkers and wolves step in 3, so
  a lone walker is caught.
- A blade's blow is 2 ticks of wind-up and 3 of recovery, 2 + 2 from Arms 30
  and 1 + 2 from 60. The other weapon families have their own times
  ([slice.md](slice.md), section 3.1) and lose a tick at the same levels.
- An actor with an enemy within 8 tiles, or with a blow coming down on its
  tile, is asked for a decision every 2 ticks. Everyone else is asked every 5.
- Up to three fodder share a tile.

### 2.3 Experience and pace

A kill gives `weight * (40 + M) / 40` experience, with the weight equal to
the rank number above, split by damage done. Fodder pays 1 below level 40, 2
from 40 and 3 from 80. A monster ten or more levels under its killer gives a
quarter, rounded down. Hitpoints gets the same experience again, so the two
levels keep step. The experience table (level 99 at 13,034,431) is
unchanged.

The pace follows from what a citizen is sent ([slice.md](slice.md), section
1). Standing on ground of level `g`, it is sent `g / 5,000` of a group each
tick, with `g` counted as 20 at least, and 20 groups hold 77 fodder, 18 pack
and 3 brutes. A citizen is out for 6:40 of each 13:00, and the table counts
3,600 ticks of that on ground of its own level, with everything it is sent
killed. So a landing gives a level-23 citizen 16.6 groups and 168
experience, and a level-58 one 41.8 groups and 766. There are 60/13
landings an hour, and the hours are hours of stream.

| Level | Reached after | A landing sends | A landing gives |
| ----: | ------------- | --------------: | --------------: |
|     6 | 55 minutes    |     14.4 groups |             122 |
|    10 | 2 hours       |            14.4 |             127 |
|    20 | 7 hours       |            14.4 |             146 |
|    23 | 10 hours      |            16.6 |             168 |
|    30 | 17 hours      |            21.6 |             248 |
|    40 | 35 hours      |            28.8 |             481 |
|    50 | 2.5 days      |            36.0 |             617 |
|    58 | 4.1 days      |            41.8 |             766 |
|    60 | 4.7 days      |            43.2 |             799 |
|    70 | 9.4 days      |            50.4 |           1,000 |
|    80 | 20 days       |            57.6 |           1,443 |
|    90 | 39 days       |            64.8 |           1,652 |
|    99 | 78 days       |            71.3 |           1,903 |

Den elites, boarders, the standing monsters and ground above its own level
are not counted and come on top. The table is for a citizen whose ground is
in rings 1 and 2. The horde takes the far ground first, so the strongest
citizens of a roster get about 2,600 ticks on theirs and fall behind the
table by up to a quarter. The slice's citizens at hour 1, 10 and 100
are read off this table: levels 6, 23 and 58. The share of its sent monsters
a citizen kills goes in `metrics.json`, and the pace is tuned from there.

### 2.4 What a tick costs

`packages/sim/src/scale.test.ts` times the tick on one 120 by 80 map
(`bigMap` in `testing.ts`) with the shipped programs: a quarter of the actors
residents, the rest wolves and goblins in equal numbers, each on a random
tile, with monsters that go down replaced between ticks so the crowd keeps
its size. In the dev container under plain Node, 3,000 ticks after 100
untimed (`IDLIN_LONG=1`), the range over two runs:

| Actors | Residents | Monsters |    Mean tick | Worst tick |
| -----: | --------: | -------: | -----------: | ---------: |
|    150 |        38 |      112 | 0.24–0.37 ms |     5–9 ms |
|    300 |        75 |      225 | 0.55–0.74 ms |     5–8 ms |
|    600 |       150 |      450 | 1.47–1.59 ms |    7–11 ms |

The bar is a mean tick of 2 ms or less at 150 residents and 450 monsters, in
the dev container; anyone who changes the simulation's cost checks it there
with `IDLIN_LONG=1`, which times 3,000 ticks and also 150 and 300 actors.
Neither the gate nor the long run checks the time, because a tick's time
depends on the machine and on what else it is doing; both print it. What the
gate checks is the work: over the first 300 ticks of a fresh crowd of 600, the
tiles the distance fields expanded, the fields started, the tiles the actors'
own searches looked at, and the actors the grid's queries looked at
(`workOf` in `field.ts`), each to the exact count. These are the same on
every machine, and a change that makes path-finding do more, or stops a crowd
sharing its fields, changes them. The ticks are timed in a Node process of
their own, as the server runs the world, because under Vitest's module
loader the same code runs nearly twice as slowly.

Who stands where is kept in `grid.ts`: actors in cells of 8 by 8 tiles, in
update order, with a count per tile of who stands there and whose walk ends
there, and a count per region of residents and monsters. `step` holds one
grid for the pass in which actors update; every move, walk and mark goes
through `grid.ts`, which keeps it in step. Sensing the nearest enemy,
counting friends, blocking, landing blows and finding a free tile to walk to
look at nearby cells or single tiles of the actor's own region, not at every
actor.

`walk_to` and `step_to` read a distance field per target tile
(`field.ts`): a breadth-first search out from the target over the ground,
people left out, grown only as far as someone has asked and kept for 10
ticks after its last read, so everyone heading for one place shares one
search. The field gives the rings round the target, from which the walker
takes the nearest free tile it could reach with nobody about, and it guides
the walker's own A* search round the people in the way. That search gives up
on ways more than 8 steps longer than going by the target itself; then the
walker goes as near as such a way gets it, so a crowd holding a one-tile
bridge costs a few hundred tiles and the walker waits at its edge. A walker
whose last move got nowhere searches with no limit, so people who stand
still hold it up for one pause. To find out early that no way gets there at
all, as when monsters hold every bridge, that search walks out from the goal
at the same time, one tile for each it takes, and stops when the goal's side
runs out. At 600 actors the fields expand about 4,100 tiles a tick and the
actors' searches look at about 4,700; before the fields, the searches took
about 83,000 a tick off their queues. A field's arrays go to a spare list when it is dropped and are never
freed, so memory stays at the most fields alive at once, at 8 bytes a tile.
That is bounded by the distinct targets read in 10 ticks: at 600 actors on
`bigMap`, about 300 fields, or 23 MB, reached in the first 300 ticks and no
higher over 3,000. The landing's district graph is not used for routes:
the largest landing is 80 by 45 tiles, under half of `bigMap`, so one field
covers it. A tick has 100 ms, and the server stops a wake after 50 ms of
work.

### 2.5 What a viewer is sent

Each tick's message is the whole snapshot, about 440 bytes an actor, with the
tick's blows and knockbacks beside it. A blow is cut to what a frame draws of
it: who struck, whom, how much, whether it crit and the type that did most of
it. A knockback is who pushed whom, the tile it went from and the one it
ended on, and whether a wall or a body stopped it short; what is left under a
tile is on the actor. Arrows in flight are in the snapshot, each with its
tile, its direction and the tiles it has left. At 600
actors the snapshot is 264 KB a tick, and the server drops a viewer that
falls 1 MiB behind. The fields one frame draws come to about 170 bytes an
actor, or 100 KB a tick. The viewer restores a whole world from each message
today, so the actors are cut to those fields when the viewer draws from them
instead, with the deck (slice piece 2) or the fight in ink (piece 8), and
that piece measures whether a local viewer keeps up.
