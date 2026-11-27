# Plan

This is the plan for Idlin from the rest of M1 onwards: what a resident's
build is, how players own residents, how the world grows, and the milestones
that get there. [roadmap.md](roadmap.md) is the short version.
[design.md](design.md) still describes the frame, the look and the program
model, and nothing here changes those.

It was written from three proposals on
[#313](https://github.com/nnamon/Idlin/issues/313): progression and builds
([first part](https://github.com/nnamon/Idlin/issues/313#issuecomment-7218617042),
[tempo](https://github.com/nnamon/Idlin/issues/313#issuecomment-7218680860)),
[players and the stream](https://github.com/nnamon/Idlin/issues/313#issuecomment-7218692331),
and the world's arc
([first part](https://github.com/nnamon/Idlin/issues/313#issuecomment-7218748357),
[density](https://github.com/nnamon/Idlin/issues/313#issuecomment-7218824702)).
Where this page gives a number, this page stands. Where it names something
without specifying it (a technique's exact effect, a region's nodes), the
proposal's text is the specification.

It was then revised after a
[fun audit](https://github.com/nnamon/Idlin/pull/325#issuecomment-7219490742)
that went through it milestone by milestone asking what a viewer and an owner
see in an hour. The audit found that the first version grew the world to 14
regions without working out what that did to an owner's time on screen, and
that most of what its milestones listed happened less than once an hour.
Section 4.5 (what an owner sees as the world grows), section 4.6 (the fun
test) and the milestone list in section 6 come from that. Three regions, three
skills and two milestones were cut; section 6 ends with the list.

What was checked for this page: the formulas below were worked through by hand
at the levels shown, and a tick and a snapshot were timed on the shipped world
at 15 to 650 residents (section 3.5). Nothing was captured or watched. Monster
counts above three a region cannot be run on `main`, so the cost of a dense
world is worked out from the resident-only timing and has to be measured again
in #316. Every figure for seconds on screen in sections 4.5 and 6 is
arithmetic from the director's rules. `metrics.json` records none of them yet,
so they are estimates until a capture measures them.

## 1. What the operator asked for

From #296, #298, #299, #231, #313, #314 and #326, in their words where quoted:

- Fights should be a power fantasy with weight, where today it looks like
  "some boring slow paced grid turn based game".
- Monsters should be many and dangerous. One wolf at the fire was "so small
  and pathetic with zero danger", and "monster density is not there at all".
- Residents should have an aim at every hour. Nobody naps through the night.
- The page should fit the cast and show stats that mean something.
- Builds should be more than items and levels, and the plan should be
  ambitious.
- Substance comes before polish. Judges score from a player's seat, in
  absolute terms.
- Each milestone should say why it is fun and what it does to the player's
  experience. "The more you expand, the more you're likely to not show the
  player."
- The map should be zoomed out: "otherwise it just feels like a tiny ass map
  view" (#326).

Every milestone below is checked against that list, and from M2 on against
the fun test in section 4.6. Polish issues with no part in it leave M1
(section 5).

## 2. Conflicts between the proposals, settled

| Question                            | Decision                                                                                                                                                                                                                                               | Why, and what was turned down                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Players before trades, or after     | Beside each other, in M2: builds and owners share one foundation issue and then run as two strands.                                                                                                                                                    | The operator asked about builds first, and asked for judging from an owner's seat. Each needs the other: a build is a choice an owner makes. The builds strand is in `packages/sim` and content; the owners strand is a new `packages/hall` and a new page, so three builders don't collide. Turned down: trades first with players a milestone later, and players first with builds waiting. |
| Where the horde goes                | In M1. #315 to #324 are most of it; one new issue gives the other three regions monsters.                                                                                                                                                              | It is the complaint the operator repeated most, and it is already filed. A separate "Horde" milestone would only rename M1's remaining work.                                                                                                                                                                                                                                                  |
| The store or the works first        | Works in M4, taking goods that residents deliver. The store with tally in M6; from then it pays for deliveries and a work can draw on its stock.                                                                                                       | A way down is a work, and the way down cannot wait behind four new skills (section 3.3). Until the store, what draws goods to a site is its `needs` sensor, a `deliver` rule in the starter programs and the deliverer's name in the ledger. Turned down: the store first, as the first version of this plan had it.                                                                          |
| How goods reach the store           | Residents sell to it for tally at a price set by stock. Works and the fire take from that stock. No tithe.                                                                                                                                             | One store with one rule. A work drains the stock, the price rises, and programs that read `price` bring what the work needs. Turned down: an automatic tenth of everything banked, which no program chose and no viewer can see.                                                                                                                                                              |
| One store or several                | One, at Lantern Camp. Outpost and company chests reach a resident's own bank only.                                                                                                                                                                     | All three proposals agree.                                                                                                                                                                                                                                                                                                                                                                    |
| Trade between residents             | None, except through the store and a company's shared stock.                                                                                                                                                                                           | Agreed by all three. It needs no counterparty and leaves no channel for feeding one account from another.                                                                                                                                                                                                                                                                                     |
| The word "season"                   | The game's calendar has a year of four quarters (spring to winter). The 13-week competitive period is a **round**.                                                                                                                                     | Two proposals used "season" for a 13-week period and one for 6 hours 24 minutes.                                                                                                                                                                                                                                                                                                              |
| Round length                        | 13 real weeks. Nothing is wiped.                                                                                                                                                                                                                       | Level 99 in one skill takes 7 to 9 weeks at the pace in section 3.3, so a round is long enough to reach one.                                                                                                                                                                                                                                                                                  |
| Calendar year                       | 64 game days (25 h 36 min real), four quarters of 16.                                                                                                                                                                                                  | As the world proposal has it. A real round is about 85 game years, so anything that "returns next year" returns the next real day.                                                                                                                                                                                                                                                            |
| Boss strength over time             | A boss gains 10% hitpoints each time it is killed, up to double, and returns to its base at the start of a round.                                                                                                                                      | "25% a year" would reach its ceiling in four real days.                                                                                                                                                                                                                                                                                                                                       |
| Monster and resident numbers        | One set of formulas (section 3.1). A region's tier is a band of monster levels. The hand-written tier table is dropped.                                                                                                                                | The two tables disagreed by up to 5 times at the top, and used the word "pack" for different ranks. Formulas keep them in step when either side is tuned.                                                                                                                                                                                                                                     |
| Ranks                               | fodder, pack, brute, elite, boss. Rats, bats and their like are fodder, goblins are pack, wolves are brutes.                                                                                                                                           | As #316 has it. The goblin is not renamed.                                                                                                                                                                                                                                                                                                                                                    |
| Experience                          | Per kill, from rank and level (section 3.3).                                                                                                                                                                                                           | Per hitpoint dealt reaches 99 in an afternoon at the new numbers. "100 to 3,000 kills a level" would reach it in two days, so that figure is dropped and the time targets kept.                                                                                                                                                                                                               |
| Monster caps                        | A budget per region, by tier, time of day and residents present (section 3.4). The crowd target counts residents only. `MONSTER_CAP` goes.                                                                                                             | The operator's note on #298 asks for caps "scaled by residents with a hard ceiling" and short refills.                                                                                                                                                                                                                                                                                        |
| Refill                              | A fodder group every 20 ticks while under budget.                                                                                                                                                                                                      | At one group every 10 seconds, six fighters in a region would share 40 kills a minute.                                                                                                                                                                                                                                                                                                        |
| Step and blow timings               | Step 4 ticks, diagonal 6. A resident's blow is 2 + 3 ticks, 2 + 2 from Melee 30, 1 + 2 from 60. Residents never step faster than 4. Wolves and pack monsters of tier 3 and up step at 3.                                                               | As #315 has it. A step of 3 for strong residents is turned down: #298's rule that a wolf catches a lone walker has to hold at every level.                                                                                                                                                                                                                                                    |
| Ground costs                        | Road and plank 4, snow 6, mud 7.                                                                                                                                                                                                                       | The world proposal's 6, 8 and 10 were set against a 6-tick step.                                                                                                                                                                                                                                                                                                                              |
| Decisions every 2 ticks             | Only for an actor with an enemy within 8 tiles or hatching on its tile. Everyone else stays at 5.                                                                                                                                                      | It is needed to react to a blow, and it costs VM steps for every idle actor otherwise.                                                                                                                                                                                                                                                                                                        |
| The Underway                        | Three regions: the Underway, the Deep Halls, the Root of the Hills. Eleven regions are planned, in a grid three regions tall (section 4.5).                                                                                                            | As the density addendum has it. The atlas allows 16 regions. The world proposal's 14 are cut to 11: the Old Orchard, the Burnt Wood and the High Pass add no tier that isn't there already.                                                                                                                                                                                                   |
| Where Mining starts                 | With the trades in M6: two ore seams in the Hills, and Stonefall's quarry faces and seams, which are drawn from M4 and worked from M6.                                                                                                                 | Stonefall is built two milestones before Mining, as the tier-2 region. Its rock is scenery until then.                                                                                                                                                                                                                                                                                        |
| Player groups, outposts and pitches | A player group is a **company** (3 to 8 residents). Every region has two company sites. An outpost is a work, open to everyone. A resident's pitch stands at its home fire.                                                                            | "Camp" already means Lantern Camp. Two sites a region gives 20 sites at ten regions, room for 150.                                                                                                                                                                                                                                                                                            |
| Population                          | 15 residents per open region, so 60 on today's four and 150 on ten or more. 150 is the ceiling (section 4.5). A claim past the cap goes on the waiting list. At least 24 residents in the world, of which at least 6 are house residents.              | As the players proposal has it, with the ceiling from the brief's "50 to 150". The tick and message bars are set at it.                                                                                                                                                                                                                                                                       |
| Bank and store caps                 | Bank: 200 of each good and 24 items. Store: 2,000 of each good, 10,000 with the Storehouse.                                                                                                                                                            | Every pool is capped, so a world that runs for months does not pile up. A full bank sells to the store.                                                                                                                                                                                                                                                                                       |
| The hourly vote                     | Each real hour the world rolls three weathers for a coming night from the quarter's table, and the vote picks one. With no votes the first roll stands.                                                                                                | A vote that added effects of its own would be a second weather system. This way it only chooses among what the calendar could have done.                                                                                                                                                                                                                                                      |
| The director                        | Schedules where the frame rests first and residents second (section 4.5): a circuit of stops, 80 seconds a visit, with the spotlight changing among the residents in the frame. In the viewer in M1, with #326's wider view; on the server from M2.    | The proposals' queue of residents put a pan inside most turns and promised a wait that held only while 20 or fewer owners watched. Turned down: that queue, and its cap of 3 minutes an hour, which at 15 residents left 15 minutes of each hour with nobody allowed on.                                                                                                                      |
| The page                            | #231's compact rows for the residents in the frame, present owners first, and the rest as a count when they outnumber the rows; then one line per region. When the frame settles, the present owners' name slips in it are lettered one after another. | #231 replaced the roll of busts. The roll call takes no stream time. Turned down: a timed roll call, which at 60 residents and 3 seconds each is three minutes of nothing.                                                                                                                                                                                                                    |
| Pans                                | A straight line across the world plane, at most 14 s. The frame travels only between the director's visits, and starts at once.                                                                                                                        | Today a pan runs along the exits at 8 s each and waits 2 s first, inside the subject's turn. Three exits would be 24 s of travel.                                                                                                                                                                                                                                                             |
| Camp ground                         | Monsters still cannot stand on `camp` tiles (decision 0011). The light is not safety: packs strike in from its edge, the light shrinks with the fire (#301), and raids go for stores outside the ground.                                               | Residents wake on those tiles after a down.                                                                                                                                                                                                                                                                                                                                                   |
| Fodder on screen                    | Half a resident's height, ink with no wash. The mow sheet (#323) decides whether that is right. Stains last 20 s for fodder, and at most 200 are kept per region.                                                                                      | One proposal said a third, the other 60%.                                                                                                                                                                                                                                                                                                                                                     |
| Try it before submitting            | Three game hours, both ways, in a worker. A full game day on request.                                                                                                                                                                                  | A game day at 150 residents is 14,400 ticks at 3 ms or more, twice: over a minute in a browser.                                                                                                                                                                                                                                                                                               |
| Long sweeps in the gate             | 2 game days at 15 residents in the gate; 60 game days or a year only under `IDLIN_LONG=1`, at a milestone's exit check.                                                                                                                                | 20 game days at 50 residents is several minutes, and the gate aims at one.                                                                                                                                                                                                                                                                                                                    |

## 3. The numbers

All integer arithmetic, rounded down. `L` is a resident's skill level, `M` a
monster's level.

### 3.1 Residents and monsters

- Base blow: `6 + L + L*L/20`.
- Hitpoints: `40 + 10*L + L*L/5`, on the Hitpoints level.
- Gear is expected to multiply a blow by `(100 + 2*L)/100` and what a resident
  can take by `(100 + L)/100`, for a resident wearing ordinary rare gear of
  its own level. The item tables (#240) are tuned to that. The best gear is
  about a third above it. A crit is double; `accuracy` is the crit chance, 5%
  bare and 40% at most.
- A monster's hitpoints are `rank * blow(M) * (100 + 2*M)/100`, with rank 1
  for fodder, 3 for pack, 12 for a brute, 40 for an elite and `300 + 7*M` for
  a boss.
- A monster's blow is a share of `hp(M) * (100 + M)/100`: 1% for fodder, 4%
  for pack, 25% for a brute, 40% for an elite, and never less than 1. Boss
  blows are set per boss.

The monster formulas include the gear factors. Without them a geared
resident one tier short would kill deeper fodder in one blow, and depth would
show nothing.

| Level | Base blow | Hitpoints | Blow with ordinary gear | Fodder hp / hit | Pack hp / hit | Brute hp / hit | Elite hp |
| ----: | --------: | --------: | ----------------------: | --------------- | ------------- | -------------- | -------: |
|     5 |        12 |        95 |                      13 | 13 / 1          | 39 / 3        | 158 / 24       |      528 |
|    18 |        40 |       284 |                      54 | 54 / 3          | 163 / 13      | 652 / 83       |    2,176 |
|    38 |       116 |       708 |                     204 | 204 / 9         | 612 / 39      | 2,449 / 244    |    8,166 |
|    58 |       232 |     1,292 |                     501 | 501 / 20        | 1,503 / 81    | 6,013 / 510    |   20,044 |
|    78 |       388 |     2,036 |                     993 | 993 / 36        | 2,979 / 144   | 11,919 / 906   |   39,731 |
|    95 |       552 |     2,795 |                   1,600 | 1,600 / 54      | 4,802 / 218   | 19,209 / 1,362 |   64,032 |

Tiers are bands of monster level. Day monsters sit at the low end of a band
and night monsters at the high end.

| Tier | Monster levels | Regions                            | Boss level, hitpoints |
| ---: | -------------- | ---------------------------------- | --------------------- |
|    0 | 1 to 8         | Lantern Camp                       | 8: 7,020              |
|    1 | 10 to 25       | Pinewood, Hills, Lower River, Mere | 25: 44,175            |
|    2 | 30 to 45       | Stonefall, Mire                    | 45: 177,612           |
|    3 | 50 to 65       | Underway, Barrow Downs             | 65: 489,693           |
|    4 | 70 to 85       | Deep Halls                         | 85: 1,092,258         |
|    5 | 90 to 99       | Root of the Hills                  | 99: 1,760,688         |

The largest monster is over the content limit of 100,000 hitpoints, so #317
raises that limit to 4,000,000. Everything stays inside 32 bits.

### 3.2 Do the two proposals' curves agree

The world proposal asked for monsters about 2.5 times as tough per tier, about
a hundredfold from bottom to top, and blows about 1.7 times as hard per tier.
From the table:

- A blow with ordinary gear goes 13, 54, 204, 501, 993, 1,600. That is 123
  times from tier 0 to tier 5, in steps of 4.2, 3.8, 2.5, 2.0 and 1.6: a mean
  of 2.6 a tier, steep early and flatter late.
- A fodder hit goes 1, 3, 9, 20, 36, 54: a mean of 2.2 a tier.

So the totals agree and the shape differs: the first tiers are a bigger step
than the last. What that does to the gradient the world proposal wanted:

| A resident at its tier's middle level, in ordinary gear | On its own tier | One tier deeper                       | Two tiers deeper                                                   |
| ------------------------------------------------------- | --------------- | ------------------------------------- | ------------------------------------------------------------------ |
| Blows to kill a fodder monster                          | 1               | 2 to 5 (5 from tier 0, 2 from tier 3) | 4 to 16                                                            |
| A brute's hit, as a share of what the resident can take | 25%             | 38% to 83%                            | a down in one from tiers 0 and 1, 93% from tier 2, 67% from tier 3 |
| Eight fodder round it take                              | 5% a second     | 8% to 16% a second                    | all of it in under 8 s                                             |

One tier deeper is hard and two is a down, or two brute hits from tiers 2 and 3. The gentlest step is
tier 4 to tier 5, where one tier deeper costs twice the blows and a brute
takes 38% a hit. If the captures show the deep regions reading as no harder
than the ones above, the fix is to narrow tier 4's band, not to change the
formulas.

Bosses: five residents of the boss's level, at 2 to 3.3 blows a second, on
target half the time, do 5 to 8 fodder-kills of damage a second in ordinary
gear. A boss of `300 + 7*M` such kills lasts 71 seconds at tier 0, 91 to 98 at
tiers 1 to 3, 107 at tier 4 and 119 at tier 5. That is the 4 to 6 residents
and 60 to 120 seconds the world proposal asked for. The best gear takes about
a quarter off each.

The largest number on screen: a level-99 blow with the best gear is about
2,300, a crit 4,600, and a 300% move that crits about 13,800.

### 3.3 Experience and pace

A kill gives `weight * (40 + M) / 40` experience, with the weight equal to the
rank number above (1, 3, 12, 40, `300 + 7*M`), split by damage done. Fodder
pays 1 below level 40, 2 from 40 and 3 from 80. A monster
ten or more levels under its killer gives a quarter, rounded down, so far
weaker fodder gives nothing. Hitpoints gets a third of all combat experience
on top. The experience table (level 99 at 13,034,431) is unchanged.

Pace for a resident on a competent program that fights monsters of its own
level for a third of each minute (the tempo proposal's 15 to 25 seconds),
killing the equivalent of 10 fodder a stream minute at level 10, 40 at level
40 and 100 at level 80:

| Level | Reached after, at best |
| ----: | ---------------------- |
|    30 | 12 hours               |
|    40 | 23 hours               |
|    50 | 34 hours               |
|    60 | 2.4 days               |
|    70 | 4.5 days               |
|    80 | 9 days                 |
|    90 | 17 days                |
|    99 | 32 days                |

With trips, banking, downs and packs shared with others, 99 in one skill is 7
to 9 weeks. That is slower than a month and inside a round, which both
proposals asked for. Through levels 40 to 60 a level takes from under an hour
to about three. These are targets: #323 puts kills per minute in `metrics.json`,
and the `xp` field in each monster's file is where the pace is tuned.

The pace has a consequence for the order of milestones. The four regions that
exist stop at monster level 25. A resident passes 30 in about a day, and from
35 every kill there pays a quarter. A level-38 resident kills a level-25
fodder monster in one blow and loses 1 hitpoint to its hit; only a brute, at 36%
of what the resident can take, is still a danger. So a world more than a few
days old has outgrown its map, and the way down (M4, M5) comes before the
trades.

### 3.4 Monster budgets

A region's budget is `14 + 4*tier` by day and `24 + 6*tier` by night, plus 2
for each resident in the region, and never more than 80. About 60% of it is
fodder, 35% pack and brute, 5% elite. While a region is under its budget a
fodder group arrives every 20 ticks, a pack or brute group every 100 and an
elite every 600 at night, at the region's spawn places, never within 6 tiles
of a resident and never on lit ground. Fodder groups are 6 to 8 at tier 0 and
up to 20 to 30 at tier 5; up to three fodder share a tile, and fodder give up
10 tiles from where they came out.

A region with no resident in it is dormant: its monsters stand, decide
nothing and are not refilled. The rule reads only world state, so it is
deterministic. Nests and marches (M5) are state on the region, not decisions
by its monsters, so they still build up.

Supply, as a check on the pace above: thirty groups a minute is 180 fodder a
minute at tier 0 and about 600 at tier 4. A level-80 fighter wants 100 a
minute, so a tier-4 region feeds six fighters at full rate, and more than
that share. With 150 residents over eleven regions there are about 14 a
region and not all fight. Kills, like trees, are a supply that crowding
thins, which is another reason for residents to spread out.

Totals: the M1 candidate (15 residents, four regions, night) holds up to 144
monsters. Eleven regions open at night with 150 residents hold 402 from the
tier terms plus 300 from residents: 702 monsters and 852 actors, before the
ceiling of 80 trims a few.

### 3.5 What a tick costs

Timed on the shipped world, in the dev container, shipped programs, 3,000
ticks after a 600-tick warm-up, with everyone starting at the camp:

| Residents | Mean tick | Worst tick | Snapshot |
| --------: | --------: | ---------: | -------: |
|        15 |   0.09 ms |       3 ms |     8 KB |
|        50 |   0.23 ms |       4 ms |    24 KB |
|       150 |    0.9 ms |       7 ms |    67 KB |
|       300 |    2.4 ms |      17 ms |   134 KB |
|       450 |    5.0 ms |      24 ms |   199 KB |
|       650 |   11.5 ms |      49 ms |   280 KB |

The cost grows with nearly the square of the actor count, because sensors and
blocking checks look through every actor in the world. A tick has 100 ms, and
the server stops a wake after 50 ms of work. From that:

- The M1 candidate, about 160 actors, is near 1 ms a tick. No change needed.
- 852 actors would be about 20 ms a tick on that curve, with worst ticks near
  85 ms. The server could not keep ten ticks a second.
- The fix is to keep actors in a list per region and have sensors, blows and
  blocking look only at their own region, which decision 0017 already makes
  the rule. Eleven regions of 77 actors make about 66,000 pairs. That is three
  times what 150 residents in one place make, which costs 0.9 ms today, and
  an eleventh of what 852 actors in one list make. So the full night should come to
  2 to 4 ms. Dormant regions and a 200-step limit on fodder programs cut it
  further.

#316 does the per-region lists and the measurement. The bar is a mean tick of
4 ms or less and a worst tick of 25 ms or less, at 150 residents with four
regions at their night budgets (470 actors). The same bar is checked again
when M4 and M5 add regions. If it cannot be met, budgets come down before
packs get smaller: the ceiling of 80 a region goes to 60.

Worst-case VM work at the full night: 150 residents at 2,000 steps and 702
monsters at 200 to 2,000, each deciding every 2 ticks at most, is about
470,000 steps a tick. In practice most actors are mid-action and decide far
less often.

The long exit checks in section 6 do not fit the capture workflow's long job,
which stops at 20 minutes: 60 game days is 864,000 ticks. They are run
through Docker Compose at the milestone's exit check and the result is posted
on the issue that closes the milestone. The workflow's long job keeps to what
fits.

### 3.6 What a viewer is sent

Today each tick's message is the whole snapshot, about 440 bytes an actor. At
852 actors that is 375 KB a tick, 3.7 MB a second for each viewer, and the
server drops a viewer that falls 1 MiB behind, which would be three messages.

The people who watch over the WebSocket are the machine that renders the
stream and anyone with the viewer open locally. Players watch the stream and
their own page. So the message is cut to what one frame draws, and the pages
are served separately:

- M1 to M3 keep the snapshot message. At the candidate's 160 actors it is
  about 70 KB a tick, the size decision 0009 accepted for 150 residents. Four
  regions full at night, with 60 residents, are 294 actors and about 130 KB.
  M2 reports whether a local viewer keeps up at that size. If it does not,
  the view message comes forward from M4.
- M4, the first milestone past four regions, replaces it with a view message:
  every resident as the page needs it (name, region, hitpoints, line; about
  80 bytes), the residents and monsters on the ground in the frame and a few
  tiles round it, a count for every region, the tick's blows (#319), and each
  program once by hash. An actor is sent with the fields a frame draws, about
  170 bytes against the snapshot's 440. At 32 pixels a tile the frame covers
  2.25 regions (section 4.5), so about 175 actors at the full night: 30 KB,
  and 12 KB of resident summaries. While the frame travels it is sent the
  ground at both ends, which is twice the actors. The targets are 45 KB a
  tick at rest and 75 KB during a move, at 150 residents and the full night.
  The director is on the server from M2, which is how the server knows where
  the frame is.
- An owner's companion page gets its live window (section 4.5) from `hall`
  twice a second: the owner's resident and the actors within seven tiles,
  estimated at 3 KB an update. M2 measures it. The region's ground is fetched
  once.
- Per-tick diffs wait for the hosting conversation.

## 4. The game this builds

Short statements of what stands from each proposal, with the changes above
applied.

### 4.1 A build

A resident's build is its skills, its kit, the techniques it carries and its
program. There are no classes: the program's `carry` line names the
techniques it takes out, and that is its class until the owner changes it.

- **Skills.** Nine, each 1 to 99. Now: Melee, Hitpoints, Woodcutting,
  Fishing, Cooking. M6: Archery, Mining, Smithing, Woodworking.
- **Kit.** Six slots: `weapon`, `off`, `body`, `helm`, `ring`, and `tool`
  from M6. The weapon sets the basic attack: sword an arc of 3, axe an arc of
  5 at 150% and a tick slower, spear a line of 3, bow a line of 6 that passes
  through fodder. `off` holds a shield, a torch or a quiver.
- **Techniques.** Moves on a cooldown and habits that are always on. Each
  skill unlocks one at 10, 25, 40, 55, 70 and 85, and a node, recipe or
  wearable tier at 15, 30, 45, 60, 75 and 90. Slots: three, a fourth at a
  lifetime total of 150 levels, a fifth at 400, and up to two more from
  rings. Every technique is specified with the mistake it punishes.

  | Skill       | Techniques, by level                                                              |
  | ----------- | --------------------------------------------------------------------------------- |
  | Melee       | `guard` and `whirl` 10, `charge` 25, `slam` 40, `shove` 55, `reap` 70, `storm` 85 |
  | Archery     | `aimed_shot` 10, `volley` and `pin` 25, `night_eyes` 40, `rain` 55                |
  | Woodcutting | `pack_mule` 10, `fell` 25                                                         |
  | Fishing     | `night_eyes` 10, `long_cast` 25                                                   |
  | Cooking     | `field_cook` 25                                                                   |
  | Hitpoints   | `rally` 40                                                                        |

- **Mastery.** Rank 1 to 5 per technique, from 50, 250, 1,000 and 4,000 uses
  that did their job. It rewards a good program, so it arrives with rounds in
  M7.
- **The program.** Tactics gains `carry`, `def`, `section` and `param`, all
  resolved at compile time. Memory goes from 15 names to 31. The limits of 63
  rules and 2,000 steps stay.
- **Rings.** At 99 an owner may take a ring in that skill: the skill returns
  to 1, everything else is kept, and the resident gets a loadout slot for
  that skill's techniques and 25% more experience in it. Up to three rings a
  skill, and two ring slots count. Rings come with the deepest tier, in M5.
- **Starter programs.** Homebody, River walker and Wanderer as shipped. M2
  adds Holder (spear, `guard`, `shove`, `rally`) and Torchbearer (axe and
  torch, `fell`, `pack_mule`; keeps the fire fed and walks others home). M3
  adds Angler (`long_cast`, `field_cook`, `night_eyes`; fishes the deep pools
  after dark). Skirmisher and Smith follow in M6.

What a viewer reads without the page: the held weapon and off-hand, a shape
and pose per technique, notches for mastery, ink colour for rarity, hat
height for lifetime levels, a band per ring, and a pitch that grows from
bedroll to tent to hut.

### 4.2 The economy

The store and the trades are M6. Works come first, in M4.

- Goods are sold to the store for tally and bought from it. A good pays
  `base * 2 * target / (stock + target)`, at least 1, with `target` 4 per
  resident in the world; the store sells a quarter above that. Tally is a
  count in the ledger and is never carried or dropped.
- Crafted items are a plain base of the maker's choice. Dropped items are a
  random base with rolled rarity. Tempering at the forge adds an affix to a
  plain or magic item for ingots and a monster part, from the group that part
  belongs to.
- Parts from kills go to a pouch (200 in all), are picked up by walking past
  them, and are lost with the bag on a down.
- Sinks: food, arrows, torch and fire logs; tempering; pitches; works and
  their upkeep of 1% a game day; braziers; spoilage; the store's spread.
- Works are built at a site from goods residents deliver and from labour.
  Each delivery adds a piece to the drawing and a line to the ledger with the
  deliverer's name. From M6 the store pays tally for each unit carried or
  built, and a work can draw on the store's stock. Costs are set in camp-days
  (what a camp delivers in a game day), which M4's long run measures.

### 4.3 Players

- `!claim` makes a new level-1 resident who walks in by the east road. One
  resident per chat account. Names are 3 to 12 letters and filtered. Looks
  come from the parts sheet with 12 hood and 12 cloak colours.
- An owner is gone after 30 real days with no command, chat line or page
  visit. The resident retires and can be brought back within a year.
- The companion page shows the owner's resident live (section 4.5) above its
  tabs: since you last looked and program in M2, best moment in M3, boards
  and company in M7. Pairing is by a six-letter code typed in chat.
- Most players will only move `param` sliders, and that has to be a real way
  to play. The editor compiles in the browser; the server compiles again and
  never trusts the page. One program change per owner per 10 real minutes,
  one `param` change a minute.
- Residents never damage or block each other. Rivalry is on boards, at nodes
  and packs that run out, at the store's price, and in weekly trials at fixed
  levels where only the program matters.
- Boards are per game day and per real week, in three bands by lifetime
  levels (under 12% of the maximum, 12% to 40%, above). A round ends with
  titles, checked by re-running the entries. Companies, boards, trials and
  rounds are M7, filed when M6 closes. They are play among players, and a
  scripted crowd can't say whether they are any good, so M7 goes through the
  fun test again then (section 8).
- Nothing is lost by being away: no streaks, no decay, no login reward, no
  pings, nothing to buy.
- Nothing a viewer types reaches the stream except a resident's or company's
  name that passed the filter.
- Everything a real chat platform would touch sits behind one adapter. Until
  hosting is discussed with the operator, the adapter is a local chat page
  and a scripted crowd, and nothing is deployed.

### 4.4 The world

Eleven regions are planned. They lie on one plane, in a grid three regions
tall (section 4.5 has the layout and the reason).

| Region                | Tier | Way in           | Opens for | Boss              | Built in             |
| --------------------- | ---: | ---------------- | --------- | ----------------- | -------------------- |
| Lantern Camp          |    0 | exists           |           |                   | M1                   |
| the Pinewood          |    1 | exists           |           |                   | M1                   |
| the Hills             |    1 | exists           |           |                   | M1                   |
| the Lower River       |    1 | exists           |           |                   | M1                   |
| Stonefall             |    2 | the Hill Road    | depth     | the Quarry Troll  | M4                   |
| the Underway          |    3 | the Pit Props    | depth     | the Lamp-eater    | M5                   |
| the Deep Halls        |    4 | the Second Shaft | depth     | the Hollow Knight | M5                   |
| the Root of the Hills |    5 | the Root Stair   | depth     | the Brood Mother  | M5                   |
| the Mere              |    1 | the Causeway     | a crowd   | the Mere-wife     | when the world fills |
| the Mire              |    2 | the Plank Way    | a crowd   | the Bell-ringer   | when the world fills |
| the Barrow Downs      |    3 | the Dyke Gate    | a crowd   | the Barrow King   | when the world fills |

A region opens when a resident has charted it, the camp has built the way in,
and the world needs it. Until it is needed its site takes no deliveries.
There are two kinds of need:

- **Depth.** A region one tier deeper than anything open is needed when at
  least a tenth of the residents, and at least four, have Melee or Archery
  above the top of the deepest open band (25, 45, 65, 85). At the pace of
  section 3.3 that is Stonefall in a world's first two days, the Underway in
  its first week, the Deep Halls after about a week and the Root of the Hills
  after three to four weeks.
- **A crowd.** A region of a tier that is already open is needed when the
  world has more than 12 residents for each region open. Only players in
  numbers bring that, so the three crowd regions are not built until a
  running world shows the need (section 6).

The rule opens places. It does not change how hard a place is: difficulty
comes from a region's tier and from what the camp neglects, never from the
residents' levels. The goblins' hoard sets the size of a raid, an unvisited
region grows a nest, and the autumn's elk kills set the winter wolves. A
timer decides in two places: the calendar (quarters, moon, weather, the Long
Night, the eclipse), and the floor on set pieces (M3), which sends a hunting
pack when an hour has had fewer than four. Events are written in Tactics and
run by a world body on the same VM.

The bosses of tiers 0 and 1 (Gristle, the White Stag, the Black Ram, the Old
Pike) are not scheduled. A world old enough to have reached M4 has residents
past level 35, and a level-25 boss lasts them half a minute. They are filed
with the crowd regions, when new residents arrive in numbers.

The ledger is an append-only list of chartings, works, deliveries, boss kills
and records. It feeds the dawn news and "since you last looked".

### 4.5 What an owner sees as the world grows

The stream shows part of the world. Ground added outside the frame takes
frame time from every owner, and every owner added takes spotlight time from
the others. This section sets what an owner is owed and how the world stays
inside it. Decision 0023 records it.

**The frame.** The operator asked for the map to be zoomed out (#326): about
32 pixels a tile where it was 48, and a view that frames the action and is
not locked to one region. The map area of the frame is 1,440 by 1,008 pixels,
so at 32 pixels it shows 45 by 31.5 tiles. A region is 30 by 21. The frame
therefore holds one and a half regions each way, 2.25 regions of ground, and
with residents spread evenly it holds 2.25 times as many of them. Every
figure below assumes that scale. If #326 settles on another, the figures are
worked again from the same rule.

**The promise.** Each present owner's resident is in the map frame for at
least 240 seconds of every hour, with no gap over 20 minutes, at any
population the world allows and however many owners are present. That is the
hard fail. The plan's own figures are well above it: 817 seconds on today's
world and never under 408. From M2 the owner's companion page shows their
resident live for the whole hour.

**How the director keeps it.**

1. It schedules stops first. A stop is a place for the frame, chosen to hold
   the present owners' residents who have had least frame time in the last
   hour, and among equal choices the nearest. A visit lasts 80 seconds. With
   no owners, as in M1, every resident counts as a present owner's.
2. During a visit the frame may drift up to 8 tiles to keep a fight in view,
   and no more. The spotlight changes among the residents in the frame in
   turns of at least 20 seconds: present owners' residents first, least shown
   first, until each has had 180 seconds as the subject in the last hour,
   then anyone else in the frame. The limit never leaves a turn empty.
3. The frame travels only between visits and starts at once, in a straight
   line, for 14 seconds at most. It does not change scale during a visit.
4. A set piece (a boss fight, a raid, a hunt by a pack of four or more, a
   work finishing, a march arriving) may pull the frame or hold it, for at
   most 240 seconds in any 20 minutes.
5. An owner who has just arrived or claimed gets a stop on their resident as
   the next visit and the first turn there.
6. When the frame settles, the present owners' name slips in it are lettered
   one after another and their rows lead the page.

**The layout.** The regions lie on one plane in a grid, and the grid is kept
three regions tall: 63 tiles, which is exactly two frames. Today's four are
the camp with the Pinewood to its west and the Hills to its east, and the
Lower River south of the camp. Stonefall goes south of the Hills. The
Underway, the Deep Halls and the Root of the Hills make the third row, east
to west, so each is next to the one before it on the way down. The Mere fills
the gap south of the Pinewood, and the Mire and the Barrow Downs start a
fourth column in the east.

**The arithmetic.** An hour has 3,600 seconds. Set pieces take at most 720,
which leaves 2,880. A visit and the longest move take 94, so there are about
30 visits and 2,451 seconds of frame time. What divides it is the number of
stops needed to cover every tile of the open regions, since a resident can be
anywhere in them. A grid three regions tall needs two rows of stops, and a
grid of `c` columns needs `2c/3` columns of stops, rounded up.

| Open regions      | Columns | Stops to cover them | In the frame, seconds an hour | Longest gap |
| ----------------- | ------: | ------------------: | ----------------------------: | ----------: |
| 4, as today       |       3 |                   3 |                           817 |       9 min |
| 5 to 9            |       3 |                   4 |                           612 |      10 min |
| 10 to 12          |       4 |                   6 |                           408 |      13 min |
| 13 to 16          |  5 or 6 |                   8 |                           306 |      17 min |
| 21, were it built |       7 |                  10 |                           245 |      20 min |

Today's four regions need three stops because the frame is taller than a
region: two stops cover the top row and the upper half of the Lower River,
and a third covers the rest of it. Five regions need four stops, and so do
nine, which is why opening the deep costs an owner nothing more once
Stonefall is open.

These are floors. They count every open region as holding someone, the
longest move every time, and no set piece as showing the owner. A director
that puts each stop on residents and not on a grid does better wherever
residents bunch, as they do at the camp. The number depends on the ground and
not on who is watching, so it holds with 20 owners present or 150.

For comparison, the view locked to one region at 48 pixels gave 612 seconds
on four regions, 306 on eight and 245 on ten.

**What limits the world now.** Frame time no longer does. At ten regions it
is 408 seconds, and it would take 21 regions to bring it down to 245. The
limits that bind first are these:

- The atlas allows 16 regions. At 16 the figure is 306.
- The population ceiling stays at 150. It comes from the brief, and the tick
  and message bars of section 3 are set at it. With 15 residents a region the
  frame holds about 34 when the world is full, where it held 15. Whether 34
  figures two thirds the size can be told apart is not known. #326's captures
  at 15 residents and M2's at 50 are the check, and if they can't, the answer
  is fewer residents a region, not a narrower view.
- The page lists the residents in the frame. Past the rows it has, it lists
  present owners first and the rest as a count.

So the plan's eleven regions can all be open at once, and the Mire and the
Barrow Downs no longer share a place. The three regions cut from the first
version stay cut. They were cut for adding no tier and nothing to see hourly,
and a wider view does not change that.

Time as the subject does depend on who is watching, since 2,451 seconds are
shared among the present owners. The wider view does not change it:

| Residents | Owners present | As the subject, seconds an hour |
| --------: | -------------: | ------------------------------- |
|        15 |              6 | 180, the limit                  |
|        50 |             20 | about 120                       |
|       150 |             20 | about 120                       |
|       150 |             60 | about 40                        |

The plan promises frame time and does not promise subject time past 20
owners present.

**The live window.** The companion page draws the owner's resident and the
ground seven tiles each way, with the viewer's own drawing code, twice a
second, at the closer scale the stream used to have. It follows that resident
and cannot be pointed anywhere else. It is how an owner sees what a slider
did without waiting for the stream to come round, and with the stream zoomed
out it is the close view of their resident. It is 3,600 seconds an hour for
anyone who has the page open. The stream keeps what the window lacks: the
country round the resident, everyone else, the page, the news and the set
pieces. The 240 seconds are measured on the stream alone, so the stream
cannot lean on the window. This changes a line of [design.md](design.md),
which said no viewer has their own camera.

**What is measured.** `metrics.json` gains, for each resident and split into
present, absent and house: frame seconds an hour, subject seconds an hour,
and the longest gap out of frame. It also gains moves of the frame an hour
and set pieces an hour. A present owner under 240 frame seconds, or a gap
over 20 minutes, is a hard fail, measured at the milestone's population cap
with 20 owners present and with 60. #326 takes the first measurement, before
and after the change of scale.

**Past 150 residents** the question is whether a frame and a page can show
more, and after that whether a second view of the same world is wanted. That
only matters for a hosted game that fills (section 8). Until then the world
does not grow past 150.

Turned down: a queue of residents with the view following each one, as the
first version had it; a cap of 3 minutes an hour; highlights on the stream in
place of the live map, since a replay is an older picture beside the live
one; a timed roll call; holding a small world on four maps until 60 residents
(see decision 0023); and a view locked to one region, which is what made ten
regions the most a stream could carry.

### 4.6 The fun test

A milestone is filed only when its section of this plan answers these six
points, and it closes only when a judge has checked them from captures. A new
milestone, or a change to one, goes through the same test before it is built.

1. **The hour.** What a viewer who owns nothing sees in a typical hour, each
   item with a rate. Anything rarer than once an hour is not a reason to
   watch. The section names at least one thing that makes hour two differ
   from hour one.
2. **The owner's seconds.** Frame seconds an hour for a present owner at 15,
   50 and 150 residents, from section 4.5, and from `metrics.json` once the
   milestone is built. Never under 240, and no lower than the milestone
   before unless the section says what the owner gets in return.
3. **A decision with a result.** One new decision an owner makes, a test that
   a different choice changes a measured outcome, and a way to see the result
   within 10 minutes.
4. **Tomorrow.** What is on "since you last looked" after a day away that was
   not there before this milestone.
5. **Played, not only run.** A fresh judge plays an owner through the local
   chat page and the companion page: it claims, changes something, leaves,
   and comes back after a real day's worth of game time. It writes what it
   did, what it waited for and when it lost interest. "Nothing to do" or "I
   couldn't see what my change did" is fixed before the milestone closes.
6. **Size.** A milestone that adds a region, a skill or a system says what it
   removes, or shows the need. For a region the need is one of the two in
   section 4.4.

The first version of this plan was run through the test by the audit. Its M2
failed point 3, M3 and M4 failed point 1, M4 to M6 failed point 2, and M7 and
M8 failed points 1, 2, 3 and 6. Section 6 is what came of that.

A stream hour is 2.5 game days. Rates in section 6 are targets worked from
the rules, and each one is counted in `metrics.json` by the milestone that
makes it.

## 5. M1: what is left

M1 has 36 open issues. Eighteen of them and one still to be filed make the
candidate: the first build worth showing the operator. Eight more and the
three umbrella issues close the milestone. Seven leave it.

### Why it's fun

**A viewer who owns nothing** sees, in an hour:

- 2.5 dusks and nights, each with the walk home and the dark closing in.
- Fights for 15 to 25 seconds of each fighter's minute. A fodder group
  arrives every 2 seconds while a region is under its budget, and a pack is
  cut down in 3 to 5 seconds, with ink left on the ground.
- A wolf hunt most nights, so about two an hour, each with 10 to 30 seconds
  of stalking before it breaks.
- At least 37 homecomings with a haul, since each of 15 residents is home at
  least once a game day.
- New gear worn and taller hats, as residents level. In a world's first day
  this is what makes hour two differ from hour one. After that M1 has
  nothing that does, and the calendar in M3 is the fix.

**An owner.** M1 has none. With the wider view and the circuit of stops
(#326, section 4.5), each of 15 residents is in the frame at least 817
seconds an hour and is the subject for about 160. At 50 residents it is 817
and about 50. 150 residents do not fit: four regions hold 60.

Points 3 to 5 of the fun test need owners and start at M2. Point 6: M1 adds
no region and no skill.

### The candidate

At the end of it a viewer sees 15 residents who go out with an aim, cut
through packs with fast wide blows that leave ink on the ground, get hunted
by wolf packs at night and call for help, come home carrying a haul, and wear
what they found. The page lists all 15 on a line each. No region is empty of
monsters. The map is drawn at about 32 pixels a tile, so the frame holds the
camp and the near edges of the three regions round it at once. It rests for
80 seconds and then moves on, where today it shows one region, follows one
resident from region to region and pans inside that resident's turn.

| Chain             | Issues, in order                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| In progress       | #298 wolves hunt, #309 region view                                                                                                                |
| Tempo, simulation | #315 fast time, then #316 ranks and fodder, then #317 numbers that grow, then #324 programs fight packs. #318 arcs and moves beside #316.         |
| Tempo, on screen  | #319 blows in the message, then #320 swing, hit and kill in ink. #321 off the grid. #323 the mow sheet.                                           |
| Danger            | #299 residents react                                                                                                                              |
| Purpose           | #237 trips and death drops, then #238 gathering and hauls on screen                                                                               |
| Loot              | #240 drops and equipment, after #317                                                                                                              |
| Page and judging  | #231 the page for 15, #314 absolute verdicts at 15 residents                                                                                      |
| New               | Monsters in every region: rosters, levels and budgets for the Pinewood, the Hills and the Lower River (bats, ravens, boars, slingers), after #317 |
| The view          | #326 zoom out and a view that frames the action, from the operator. After #309 and #231, in the client                                            |

The longest chain is five cycles on the simulation, one after another: #298,
#315, #316, #317, #324. Everything else fits beside it.

Changes to issues already filed:

- #315: decisions every 2 ticks only near an enemy or on hatched ground.
- #316: budgets as in section 3.4 in place of fixed caps; actors listed per
  region; dormant regions; fodder programs limited to 8 rules and 200 steps;
  the bar is 4 ms mean and 25 ms worst at 470 actors, and the message size at
  the candidate's 160 actors is reported.
- #317: the monster formulas with the gear factors, the experience formula of
  section 3.3, and the hitpoint limit raised to 4,000,000. Its seeded test,
  with the ordinary-gear factors applied to the resident directly since
  equipment comes with #240: a level-38 resident clears 12 level-38 fodder and
  lives, and a level-18 resident is downed by the same pack.
- #237: drops are built as an owned ground object with an end tick, since a
  resident's own fire reuses it.
- #240: affix tiers tuned to the gear factors in section 3.1.
- #302: the reckoning at 06:00 is at most six rows, the day's best in six
  categories, 24 seconds in all. A row for each resident would be a minute at
  15 residents and ten minutes of a 24-minute game day at 150.
- #326: its camera is the circuit of stops in section 4.5 (80-second visits,
  turns within a visit, travel only between visits), and its measures are
  the ones that section lists: frame seconds, subject seconds and the longest
  gap for each resident, and moves of the frame an hour.
- #306 is folded into #314, which already rewrites the rubric. #314 also takes
  #306's metric change: a change of page line counts as a visible event in the
  capture metrics, and a rule change alone does not.
- #286 is closed: the gate has failed any commit not dated in UTC since the
  CI change that followed it.

### To close M1 after the candidate

#300 the hunt on screen, #301 the fire burns logs, #302 the day's reckoning,
#322 loot spill and streaks, #241 drops on screen, #245 the spotlight card,
#311 adoption keeps a copy, #200 the watch review. The umbrella issues #250,
#251 and #296 close with #200.

### Leaving M1

- #272 (spreading residents at 50) goes to M2, into the starter programs,
  because M2 is judged at 50 residents. #232 (tents and sitting rings) goes
  to M7, where pitches at a company's fire are what tents are drawn for. M1
  is judged at 15 residents.
- #288, #294 and #304 are polish on things that work. They lose their
  milestone and are taken only when a builder slot has nothing else.

### Exit check

As in [roadmap.md](roadmap.md): the server restarts without loss, a 24-hour
headless run has no error and no stuck actor, the determinism tests pass, the
watch review at 15 residents has no hard fail and no "no" in its absolute
verdict, on the mow sheet a judge with the page hidden can say which
resident is stronger and see afterwards that a fight happened, and a tick
averages 4 ms or less, worst 25 ms, at 470 actors (section 3.5).

Two more come from the audit. A judge watches a full hour of capture and
says what minute 50 showed that minute 10 did not; "nothing" is filed as a
`watch` issue against M3 and does not block M1. And in that hour every
resident is in the frame for 240 seconds or more with no gap over 20 minutes.

## 6. Milestones after M1

Each list is the pieces the conductor files as issues when the milestone
before closes, twelve at most. Exit checks marked "long" are run at the
milestone's exit check (section 3.5). Every milestone's exit check also has
the played test of section 4.6 and the frame measurement of section 4.5; they
are not repeated in each list.

| Milestone                 | Open regions | In the frame at 15 | At 50 | At 150                |
| ------------------------- | -----------: | -----------------: | ----: | --------------------- |
| M1 First Light            |            4 |                817 |   817 | does not fit; 60 hold |
| M2 Builds and owners      |            4 |                817 |   817 | does not fit; 60      |
| M3 The year               |            4 |                817 |   817 | does not fit; 60      |
| M4 Works and Stonefall    |            5 |                612 |   612 | does not fit; 75      |
| M5 The deep               |            8 |                612 |   612 | does not fit; 120     |
| M6 Trades and the store   |            8 |                612 |   612 | does not fit; 120     |
| M7 Players among players  |            8 |                612 |   612 | does not fit; 120     |
| Later, if the world fills |           11 |                612 |   612 | 408                   |

Seconds an hour in the map frame for a present owner, at least, from section
4.5, with the view at 32 pixels a tile (#326). Where 150 residents do not
fit, the figure for those the world holds is the one at 50, and the next
claim waits. The crowd regions stay shut at 15 and 50 residents, so the last
row's first two figures are M5's. With the view locked to one region at 48
pixels, as it is today, the same rows would read 612, 612, 612, 490, 306,
306, 306 and 245.

### M2: Builds and owners

**Aim.** A resident has a build its owner chose, and residents have owners.

**Why it's fun.**

- _The hour, for a viewer who owns nothing._ M1's hour, with five starter
  programs where there were three, and residents who hold different weapons
  and fight differently: an arc, a wide slow arc, a line. That is on screen
  all the time. A resident walks in by the east road each time someone
  claims, 40 seconds of it, and the next visit goes to its region. The news
  line names an owner whose program changed. Hour two differs from hour one
  by who claimed and what they changed, and in a world with nobody claiming
  it does not differ. M3 follows for that reason.
- _The owner's seconds._ In the frame: 817 an hour at 15 residents and at 50.
  150 do not fit on four regions; the 60 who do get 817. As the subject: 180
  at 15 with 6 present, about 120 at 50 with 20 present. On their own page:
  the whole hour.
- _A decision with a result._ A name and colours, one of five programs, its
  sliders, three techniques, a weapon. The test: each starter program's main
  slider, at its two ends, changes a measured outcome over a seeded game day
  (hauls, downs or kills). The owner sees it at once in the live window and
  in the rule under their resident's name.
- _Tomorrow._ "Since you last looked": after a real day away, 60 game days
  and about 30 levels, with the downs, the hauls and the gear found.
- _Size._ No region and no skill. It adds a second process (`hall`) and a
  page. The viewer's own director goes.

**Exit check.**

- A judge given a fight sheet with the page cropped off names each
  resident's weapon and one technique it used.
- Long: a scripted crowd of 50 owners over 60 game days, with no error and no
  stuck actor, and the last snapshot plus the input log since it gives the
  live world's hash.
- The slider test above passes for all five starters.
- Captures with the scripted crowd at 15 residents with 6 present, 50 with 20
  and 60 with 60: Mine is 3 or more at 15 and 50, and the frame measurement
  holds in all three.
- The run reports the snapshot message's size at 60 residents and the live
  window's bytes a second.

**Pieces.**

1. Programs become world state keyed by hash; typed inputs with a log; the
   determinism test for snapshot plus log. Both strands start from this.
2. Tactics: `carry`, `def`, `section`, `param`; memory to 31 names.
3. Loadouts: slots, cooldowns, statuses (braced, held, rallied), `carry`
   taking effect at the bank chest, and `guard`, `shove`, `rally`, `fell` and
   `pack_mule` beside M1's three moves.
4. Kit: the `off` slot, spear and axe shapes, shield and torch, wearing by
   level.
5. Builds on screen: held weapon and off-hand, a shape and pose per
   technique, the `next:` line, the `carry` line on the spotlight card.
   `look`.
6. The five starter programs with their `param`s, the slider test, and
   #272's changes so that residents spread out at 50.
7. `hall`: the second process, `node:sqlite`, accounts, the local chat page,
   the scripted crowd tool, inputs to the world over a local socket.
8. Claiming: `!claim`, names and the filter, the 12-colour palette and
   `!cloak`, house residents, the waiting list, retirement, mod commands.
9. The companion page: pairing, since you last looked, `!where`.
10. The live window on the companion page.
11. Editor and submit: compile in the browser and again on the server, the
    limits, version numbers, sliders, `!set`, `!program`.
12. The director on the server: the circuit with present owners, arrival, the
    roll call, `!me`, the capture run with the scripted crowd, and the
    measures split into present, absent and house.

### M3: The year

**Aim.** Hour two differs from hour one, and an owner has a reason to look
tomorrow.

**Why it's fun.**

- _The hour, for a viewer who owns nothing._ Weather is rolled each game day,
  so 2.5 times an hour: rain, fog, snow or a storm, each drawn and each
  changing what residents do. Once an hour chat votes among three weathers
  for a coming night, which is the one thing a viewer who owns nothing can
  do. At least four set pieces an hour: hunts by a pack of four or more, and
  in their time the elk crossing with wolves behind it and the fish run. The
  day's best moment is named at 06:00, 2.5 times an hour. The quarter turns
  every 6 hours 24 minutes and nights go from 8 game hours to 16, so the
  evening stream and the morning stream are different seasons. Hour two
  differs from hour one by its weather and the vote, and hour seven by the
  quarter.
- _The owner's seconds._ As M2: 817 in the frame at 15 and at 50, and the
  whole hour on their page. No region is added.
- _A decision with a result._ When to go home. With nights that change
  length, a program that turns for home at a fixed hour loses four game hours
  of a summer evening or is caught out in winter. The test: on a winter seed
  and a summer seed, a starter with its `home_by` slider at each end differs
  in downs and in haul. An owner sees it in under a minute with "try it",
  which runs a draft and the live program side by side for three game hours.
- _Tomorrow._ The day's best moment for their resident, replayed with the
  rules that fired. The year has moved on: it was spring and now it is
  autumn.
- _Size._ No region and no skill. It adds a calendar, because without one
  every game day is the same day.

**Exit check.**

- A strip of four frames at 18:00, one a quarter, that a judge tells apart.
- A judge given an hour of capture says what minute 50 showed that minute 10
  did not, and given two hours from different quarters with the clock cropped
  off says which is which.
- Six hours at 15 residents with four or more set pieces in every hour.
- Long: a 64-day year at 50 residents with no stuck actor, in which the elk
  cross and the winter's wolves follow the autumn's elk kills.
- The flicker index stays under its limit in a burst of rain and of snow.
- A baked moment replays tick for tick against the world it came from.
- The `home_by` test above passes, and "try it" reports the first tick at
  which the two runs differ.

**Pieces.**

1. The calendar: year, quarters, day length, the moon; sensors; the year
   line on the page.
2. Weather: the daily roll and its effects.
3. Quarters and weather drawn: rain, fog, snow, storm damage, short and long
   nights. `look`.
4. The hourly vote and `event`.
5. The world's program, `content/world/events.tac`, on the VM; the ledger;
   the dawn news from it.
6. Beasts as a third side; the elk migration and the wolf winter.
7. The fish run, the Long Night and the eclipse; the Angler starter with
   `long_cast`, `field_cook` and `night_eyes`.
8. The floor on set pieces, and what is coming on the page: tonight's
   weather, the moon, days to the elk.
9. Best moments: scoring from events, baking with the decision trace, the
   replay and its rules toggle on the page, the best-moment line at 06:00.
10. Try it: three game hours both ways in a worker, with the first tick the
    two runs differ.
11. Captures: the quarter strip, a weather sheet, a winter night.

### M4: Works and Stonefall

**Aim.** The camp builds, and what it builds first is a way to somewhere
that can still hurt it.

**Why it's fun.**

- _The hour, for a viewer who owns nothing._ Tier-2 packs in Stonefall, where
  a level-38 resident has a fight on its hands again and one at level 18 is
  downed: on screen for about a quarter of the hour. Rock falling on hatched ground
  at the quarry. A work that gains a drawn piece with each delivery, at 20
  deliveries an hour or more from a camp of 24, and finishes about every two
  hours. A raid on the woodpile and the racks when the hoard is large enough,
  about one night in three. The Quarry Troll comes back four game days after
  it falls and the page counts down to it, so a boss fight about every second
  hour. The boss and the raid are each rarer than once an hour; the floor of
  four set pieces holds with hunts. Hour two differs from hour one by how far
  the work has got.
- _The owner's seconds._ In the frame: 612 an hour at 15 and at 50, down from
  817, because a fifth region takes a fourth stop to cover. 150 do not fit;
  five regions hold 75. In return a resident past level 35 gets full
  experience again and monsters that can down it. On the four old maps it
  earns a quarter and only a wolf can hurt it.
- _A decision with a result._ How deep to go and when. The test: a level-38
  resident whose program goes to Stonefall earns at least twice the
  experience in a seeded game day of one that stays in the Hills, where its
  kills pay a quarter; a level-18 resident sent there is downed. Seen in the live window and with
  "try it".
- _Tomorrow._ Whether it lived through the night at Stonefall, the notch for
  the deepest tier it has survived a night in, and its name in the ledger
  against the Hill Road if it carried goods there.
- _Size._ One region. The need is depth (section 4.4): Stonefall opens only
  once four residents have outgrown tier 1. It takes a quarter of each
  owner's frame time, as above.

**Exit check.**

- A seeded headless run from a fresh world of 24 house residents builds the
  woodpile, the racks and the Hill Road and opens Stonefall with no input.
  The run reports the camp-day.
- The same run with every resident held under level 26 does not open it.
- Five seeded residents at level 45 in ordinary gear kill the Quarry Troll
  with at most two downs.
- The depth test above passes.
- A capture shows a raid carrying goods off the racks.
- The tick bar of section 3.5 holds with five regions at night budgets, and
  the view message is inside its two targets (section 3.6).

**Pieces.**

1. World features: one table for sites, the hoard, cairns and lamps, with
   M1's drops moved onto it.
2. Works: sites, `deliver`, `build`, `needs`, a drawn piece for each
   delivery, the deliverer in the ledger; the woodpile and the drying racks.
3. Charting, cairns, exits that open, the two needs of section 4.4; the Hill
   Road.
4. Stonefall: the map, quarry faces, rockfall on hatched ground, the Quarry
   camp.
5. The crawler family for tier 2: crawlerlings, crawlers and matrons.
6. Bosses: lairs, area patterns, return times, the 10% rule, the countdown
   on the page; the Quarry Troll.
7. The hoard, and raids on the camp's stores sized by it.
8. Item bases and affix tiers for item levels 35 to 60.
9. Long trips: programs that cook and camp away from home; the depth notch.
10. The page and overview past four regions: rows for the region on screen,
    a line per other region, charted outlines.
11. The view message of section 3.6.
12. Captures: a Stonefall night, a raid sheet, a boss sheet, a work going up.

### M5: The deep

**Aim.** There is a way down to tier 5, and how deep a resident can stay
shows how strong it is.

**Why it's fun.**

- _The hour, for a viewer who owns nothing._ Three regions drawn dark, with
  day ink only inside lamps and braziers, which look like nothing else in
  the game. Fodder groups of 20 to 30, and a level-80 resident clearing one
  in about 3 seconds: on screen whenever the view is below. Four bosses, each
  back four game days after it falls, so a boss fight in most hours. A march
  that comes up region by region from a nest nobody cleared; this one is
  rare, and it is a consequence to avoid more than a show. Hour two differs
  from hour one by which boss is up and who went a tier deeper.
- _The owner's seconds._ In the frame: 612 an hour at 15 and at 50, the same
  as M4. The three regions make a third row of the grid, and the frame is tall
  enough that the same four stops cover it. 150 do not fit; eight regions
  hold 120. Levels 45 to 99 get somewhere to be fought, and without it a
  resident two weeks old is where a day-old one was before M4. The three open
  one at a time by the depth rule, the last after three to four weeks.
- _A decision with a result._ Where to spend the night, and whether to wear
  a unique that changes a rule. The test: for tiers 3 to 5, a resident at the
  tier's middle level in ordinary gear clears a fodder pack and lives, and
  one two tiers short is downed. Seen in the live window.
- _Tomorrow._ Did it live through the night down there. A deeper notch, a
  unique found, and at 99 a ring to take.
- _Size._ Three regions, each for a tier that exists nowhere else, each
  opening by the depth rule. They cost an owner no frame time. A 15-resident
  world on eight regions has about four residents in a frame, which is thin,
  and the director's choice of stops has to make up for it.

**Exit check.**

- An Underway capture shows day ink only inside lamps and braziers.
- The gradient test above passes for tiers 3, 4 and 5.
- Five seeded residents at each boss's level kill it in 60 to 120 seconds
  with at most two downs.
- A seeded run that leaves a nest alone ends with a march in the camp's
  region and a line in the ledger.
- The tick and message bars hold with eight regions at night budgets and 120
  residents.
- A capture at 120 residents with 20 and with 60 present holds the frame
  measurement (612 expected) and scores 3 or more on Mine. It reports the
  share of the hour spent on the three dark regions.
- Long: 60 game days at 120 residents in which no region averages over 15
  residents.

**Pieces.**

1. The always-night drawing, braziers and lamps. `look`.
2. The Underway: the map, the Pit Props, its tier-3 monsters, the
   Lamp-eater.
3. The Deep Halls, the Second Shaft, pale wardens, the Hollow Knight.
4. The Root of the Hills, the Root Stair, the Brood Mother.
5. Nests from neglect, and marches from a nest left alone.
6. Uniques: fixed affixes that change a rule, one per boss, and the rare
   drop outside bosses at tiers 4 and 5.
7. Item bases and affix tiers for item levels 60 to 100.
8. Rings at 99, with a band on the figure.
9. Kill counts and the deepest night on the page line.
10. Captures: an Underway sheet, a tier-3 swarm night, a march.

### M6: Trades and the store

**Aim.** Goods have a price, gear can be made, and there is a second way to
fight.

**Why it's fun.**

- _The hour, for a viewer who owns nothing._ Archers, who stand off and shoot
  a line of six tiles through the fodder: a fight that looks different from a
  melee arc, on screen whenever an archer is. Piles at the store that rise
  with each sale, and with 15 residents there are at least 37 homecomings an
  hour. Residents who change what they carry home when a pile gets tall. A
  smith at a forge is on screen and is not an event. Hour two differs from
  hour one by which piles are tall and what residents are bringing in because
  of it.
- _The owner's seconds._ As M5: 612 in the frame at 15 and at 50. No region
  is added.
- _A decision with a result._ What to gather by price, whether to make a
  weapon or wait for a drop, what to temper. The test: a scripted owner who
  only moves the `sell_above` slider changes its resident's tally for a game
  day by a measured amount. Seen with "try it" in under a minute and in the
  ledger within a game day.
- _Tomorrow._ Tally earned, what was made and what it sold for.
- _Size._ Four skills and a system, and nothing is removed. This is the
  plan's weakest answer to point 6, which is why it comes after the deep. The
  need: by M5 a bank is at its cap of 200 a good and gathering has no use
  past the fire, food and works; and every build so far fights hand to hand.

**Exit check.**

- Long: 60 game days at 50 residents in which store prices move, at least two
  starter programs change what they gather because of them, and every bank
  and the store end either at a cap or no longer rising.
- With the page hidden, a judge says which good is scarce from the piles.
- A judge given a fight sheet with the page cropped off tells the archers
  from the rest.
- The `sell_above` test above passes.

**Pieces.**

1. Goods and recipes as content with permanent ids; stations; `make` and
   `can_make`.
2. Mining and Smithing: the seams in the Hills and at Stonefall, a forge at
   camp, ingots, blades, armour, tools; the `tool` slot.
3. Woodworking and Archery: bows, arrows, quivers, shields, rods; the bow's
   line attack; `aimed_shot`, `pin`, `volley`, `rain`.
4. The store: tally, the price formula, `sell`, `buy`, `price`, `stock`, the
   item rack, bank caps; works pay tally and draw on the stock.
5. The store on screen: piles, the rack, the ledger in tally marks. `look`.
6. Food tiers and spoilage.
7. Tempering at the forge.
8. Skirmisher and Smith as starters; starter programs that read prices.
9. The Storehouse and the palisade as works.
10. Captures: the store over six game days, and an archer fight sheet.

### M7: Players among players

**Aim.** Owners can band together and compete on their programs.

This milestone is filed when M6 closes (section 8). It is play among players,
and a scripted crowd cannot found a company or be proud of a title, so it goes
through the fun test again then, with whatever owners have said about M2 to
M6. While the game is not hosted it is judged against the house residents and
the scripted crowd, and shrinks to trials, mastery and boards if that is all
they can show.

**Why it's fun.**

- _The hour, for a viewer who owns nothing._ Company fires with pitches round
  them that grow from bedroll to tent to hut: always on screen. The day's
  board at dawn, 2.5 times an hour. A trial's winners once a week. For this
  viewer M7 adds little, and that is the reason it is last.
- _The owner's seconds._ As M5: 612 in the frame at 15 and at 50.
- _A decision with a result._ Enter a trial, where every entry is run at the
  same level and only the program counts. The result is a score, shown with
  the winning run on the page.
- _Tomorrow._ A place on a board among residents of the same band, the
  trial's result, mastery earned, how far the title is.
- _Size._ No region and no skill. Companies, boards, trials and rounds are
  four systems, built for owners who by then exist.

**Exit check.** A round run headless from start to titles, each title
confirmed by re-running its entry. A trial's winning run replays on the page
tick for tick. Long: at the population cap with four companies, no region
holds more than 15 residents on average for over a tenth of a game day.

**Pieces.** Companies: founding and joining, company sites, `home`, fires,
the shared stock and its limits; pitches at the home fire (#232); boards in
bands; trials (the worker, scenarios, the weekly close, the winning run on
the page); rounds (counters, the ladder, titles, re-run checks); mastery with
notches on the figure; the library (publishing, forks, lineage, reports,
`!unpublish`); the rule builder form.

### Later, if the world fills

Not a milestone yet. It is filed when a running world has had more than 12
residents for each open region for a real week, and it goes through the fun
test then.

- The Mere, a fifth tier-1 region, with the Causeway, reed beds, otters,
  shamblers and the drowned.
- The Mire, with bog lights that lead a careless program off the planks, and
  the Barrow Downs, with barrows that wake a wight when dug. The Bell rings in the Mire on each new moon, and how few of the
  drowned were killed since the last one sets how many come up.
- The bosses of tiers 0 and 1, for the new residents a crowd brings.
- The page and overview at 150.

What it does to an owner: the Mere fills the gap in the grid and costs
nothing, so nine regions still give 612 seconds an hour in the frame. The
Mire and the Barrow Downs start a fourth column, which takes six stops to
cover, and the figure falls to 408. What the owner gets is ground that isn't
crowded: without the new regions, 150 residents on eight would be 19 a
region, past the crowd target of 15. It adds regions and removes none, and it
is built only because a crowd is already there.

### Cut from the first version

These failed the fun test and are in no milestone. Any of them can be
proposed again through the test.

- The Old Orchard, with Old Tusk and the Farmstead: a fifth tier-1 region
  with nothing a resident past level 25 wants.
- The Burnt Wood and the High Pass, with Old Greymuzzle, the Ice Bear and the
  Watch: tiers 3 and 4 are under the Hills already.
- The old M7 and M8 as milestones. What was worth keeping moved: marches and
  rings to M5, the eclipse to M3, and the Mire and the Barrow Downs to the
  regions built when the world fills.
- Trapping, Foraging and Brewing, with snares, stews, draughts, `mend` and
  the Trapper starter.
- Notes lettered on the map, the Stones, feasts, road lamps, the Smithy and
  the Watchtower as works.
- The `tool` slot and three techniques in M2, which moved to M6 and M3.

## 7. Risks

- **Tick cost.** The dense world depends on per-region actor lists. It is the
  first thing #316 builds and measures, and the fallback is a lower ceiling
  per region.
- **Pace.** The experience table in 3.3 rests on kill rates nobody has
  measured. #323's kills per minute is the check, and each monster's `xp`
  field is the lever. The times at which the depth regions open rest on the
  same table.
- **Seconds on screen.** Every figure in section 4.5 is arithmetic, and it
  assumes #326 settles at 32 pixels a tile. At 36 the frame is 40 by 28
  tiles, three rows of regions need three rows of stops, and the figures fall
  to 612 on today's four regions and 272 on nine. A resident that walks out
  of the frame as it arrives gets less than its share, and the director's
  rule for who is behind is what corrects that.
  #326 measures it at 15 residents before M2 relies on it.
- **Small figures.** At 32 pixels a figure is two thirds the size, about 9
  pixels tall in a 640-wide window where it was 13, and a full world puts
  about 34 in the frame. Hat, hood and cloak have to carry at that size.
  #326's captures at 640 wide are the check. The live window is where an
  owner sees their resident close.
- **Thin frames.** A world of 15 on eight regions has about four residents in
  a frame. The director puts stops on residents and skips empty ground, and a
  deep frame has 30 monsters or more round its residents, but nobody has
  looked at one yet. M5's capture is the check.
- **Dark.** Three of eight regions are always night, and the other five are
  night about half the time, so about 70% of the stream after M5 is the night
  drawing. M5's capture reports the share.
- **Calm.** Fights at this speed could make the stream busy. A fighter should
  be in a fight for 15 to 25 seconds of each minute, and the flicker index is
  taken over a 30-kill slam.
- **Gatherers among fodder.** Every starter program needs a rule for a pack,
  and fodder give up at 10 tiles so walking away works.
- **A small world at a 4-tick step.** A region is a 12-second walk. The
  answer is depth, not bigger maps: decision 0003 fixes the frame.
- **Works before the store.** From M4 to M6 nothing pays a resident to
  deliver. If the house residents' works stall in M4's long run, the store's
  pay for deliveries comes forward on its own.
- **Players without a platform.** Everything about owners is tested on a
  scripted crowd and on a judge playing an owner. Some of it will be wrong in
  ways only real chat shows.

## 8. Settled by the team

The first version of this section asked the operator six questions. They are
the team's to answer, and these are the answers.

1. **Hosting.** The plan builds for the local stream. The owner features run
   against a scripted crowd standing in for chat, and nothing is deployed, as
   section 1 of `AGENTS.md` says. Hosting is raised with the operator only
   when there is a build worth putting in front of people. M3 to M6 make the
   local stream better with or without players, and M7 is filed when M6
   closes.
2. **The played test.** A judge plays M2 from an owner's seat, in
   absolute terms (#314). The operator's feedback outranks
   it whenever they give it.
3. **The live window.** Taken, as decision 0023 says: at 150 residents an
   owner's resident is on the stream for about 7 minutes of an hour, and
   small when it is there, so the owner's page draws it live.
4. **The scale.** 32 pixels a tile, as #326 says, checked by the judge on
   #326's captures. If figures don't read at that scale, the fix is fewer
   residents to a region before a closer view.
5. **The cuts.** They stand: three regions, three skills, the map notes and
   the Stones add nothing new to watch.
6. **Past 150 residents.** Not planned until a hosted game fills.
