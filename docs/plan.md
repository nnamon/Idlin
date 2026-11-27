# Plan

This is the plan for Idlin as a walking city. It replaces the plan built
around a fixed camp and hand-made regions, which the operator turned down on
[#331](https://github.com/nnamon/Idlin/issues/331): "no satisfying game
loops, no thought to how to intelligently depict a large amount of players in
a finite screen and have the world feel full and vast at the same time". The
walking city is the operator's idea from that issue. Five more ideas came
from the conductor (the language as loot, the horde as the clock, the
stranded, the map drawn by the expedition, and chat playing the threat), and
section 2 says which two stand and why the other three were dropped.
[roadmap.md](roadmap.md) is the short version, [chat.md](chat.md) is the
design for how chat joins and commands citizens, and
[decision 0028](decisions/0028-the-walking-city.md) lists what was decided
and what was turned down.

None of this is built. Every time, rate and count on this page is a target or
arithmetic from the rules, and M1's exit check (section 13) says which ones
are measured first. What carries over from the code and the open issues is
in section 12.

## 1. The game in one page

Idlin is a city that walks, with a horde behind it. The city is a machine on
legs with its residents aboard, each running its owner's program. One
streamer is one city, and one chatter is one citizen of it: anyone who writes a line in the stream's chat has a
resident, named by their chat username, from that moment.

The game is one picture that breathes once every 20 minutes.

1. **In.** On a crossing the frame is drawn tight round the city. It is
   small and crowded, everyone is close and can be seen, and it is home.
   Residents cook, forge, mend and crew the rail while the land slides by.
2. **Out.** The city sets down and the frame pulls back. The land is inked
   outward from the city as it does, and how far it pulls back says what
   kind of landing this is: a small clearing with a few packs, or a valley
   that makes the city an eighth of the picture, thick with monsters and
   with things worth carrying home. The residents pour out into it.
3. **In again.** A horde comes onto the far side of the plate and crosses
   it. The frame closes with it. Residents stream home, the strong hold the
   line on the lit ground under the city, the ramps lift, and whoever is
   still outside is winched aboard without bag or kit. The legs unfold and
   the frame is the city again.

Set-down is on the real clock, at :00, :20 and :40 past every hour. The lift
is whenever the horde gets there, 10 to 15 minutes later.

Every resident is on screen all the time. There is one frame, it never cuts,
and there is no second window.

The city's size is what its chat builds together. It starts as a cramped
hull with berths for 40. Each rebuild makes it wider and taller, makes room
for more chatters, and widens the frame it is seen in on a crossing.

The whole programming language is open to every resident from its first
minute. What a resident gains over time is levels and gear, and what its
owner gains is a better program.

## 2. The five ideas, and what was done with them

The conductor put five ideas beside the operator's. Each was weighed as the
walking city was. The operator's rulings removed three. The two that stand are the horde as
the clock and the map being drawn, which became the reveal at set-down. Both
fit the rule that every resident is always on screen (section 5).

| Idea                             | Verdict                 | What was kept, changed and added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The language is the loot**     | Rejected                | The idea was a small starting vocabulary with every other sensor and action found as loot. A draft of this plan adopted it, and the operator turned it down. They are right. The game is built on writing a program, and an owner with a good idea has to be able to write it on their first day. Locking `threat_count` or `step_clear` behind a drop makes every new resident's program worse than its author, and makes a strong resident a matter of what dropped. The whole language is open to every program (section 7). Nothing of the mechanism is kept.                               |
| **The horde is the clock**       | Adopted, with one limit | Kept: no countdown, a horde that gathers and crosses the wide view, the city leaving because it arrives, the horde following on the crossing. Limit: set-down stays on the real clock, so the cycle is 20 minutes and only the lift moves. A stream needs a minute people can come back for, and two cities need to be in step. Added: the horde can be slowed by killing its front, so a rearguard buys seconds for those still out. Its distance behind the city, the lead, is earned and lost, and sets how long the next landing is. It is one horde for the whole crossing of a continent. |
| **Left behind is a story**       | Rejected                | The idea was that a resident who misses the city is stranded, bands with others and survives in a small window until rescued. A draft of this plan adapted it as a walk along the city's trail. The operator turned it down: the reason the world moves round the city is that everyone is always on one screen and the camera never goes anywhere else. A stranded group and an inset window break that. Missing the lift loses the haul and the gear, and the resident is pulled back aboard, as the operator first had it (section 9).                                                       |
| **The expedition draws the map** | Adapted                 | The idea was blank parchment inked outward as residents explore. A draft of this plan adopted it whole, with programs knowing only inked ground. It now sits where the operator's account of the zoom puts it: the land is inked outward from the city as the frame pulls back at set-down (section 5.4). The whole landing is known from then, because its size and what is on it are what the choice of stop was about. The plate still records what happened on it.                                                                                                                          |
| **Chat plays the threat**        | Dropped                 | The idea was that viewers without a resident choose what attacks the city. The operator's rule is that one chatter is one player: anyone who chats has a resident (section 11). So there is nobody without one to play the horde, and a chatter voting against their own city is on no side. Threats come from the world, from rival cities, and later from other streams (section 10). The horde's own program decides where it comes from and what it sends.                                                                                                                                  |

What these replaced in the first draft of this plan: a fixed horn at 12:00
with a dark front; a winch that hauled stragglers home stripped; raiders as
a separate enemy; a camera that visited parts of the landing in turn; and landings all of
one size.

## 3. The hook

### Why someone watches for ten minutes

A stream has to answer "what is happening and when does it pay off" within
seconds of someone arriving. Here the picture answers. If it is tight on a
crowded machine, the city is travelling and a landing is coming. If it is
wide, the size of the land says how dangerous this one is. If there is black
on one side and the frame is closing, the city is about to leave.

Set pieces in a cycle, by the cycle's clock:

| At              | What                                                                                                                                                                                       | How long          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| 00:00           | The reveal. The city settles, the frame pulls back, the land is inked outward as it goes, and it keeps going until the whole landing is there. Then the ramps drop and everyone pours out. | 2 min             |
| 03:00 to 08:00  | The prize: a lair, wreck or vein at the far side that takes several residents to crack, then the core carried home under escort                                                            | 3 to 5 min        |
| 06:00 to 09:00  | The horde comes onto the plate, on the side marked from the start                                                                                                                          |                   |
| 10:00 to 15:00  | The close. The horde crosses, the frame closes with it, the rearguard holds on the lit ground, the run for the ramp, the lift.                                                             | 3 to 5 min        |
| on the crossing | The vote on the next stop, with the three drawn to scale. The vanguard at the walls when the lead is short.                                                                                | 1 min, and 2 to 4 |

The longest stretch with none of these is about three minutes of sorties
between the prize and the horde. Any ten minutes holds one set piece and
usually two.

### The moments

Each is a rule of the game doing its work, so each happens without anyone
scripting it.

- **The reveal of a valley.** The frame pulls back, and keeps pulling back.
  The city that filled the screen is an eighth of it, and the land between
  it and the far edge is thick with marks.
- **The vote.** Three stops on the route map: a clearing, a glade under fog,
  a valley with a storm over it. The pennants go up the mast one notch at a
  time, and the valley's wins by two.
- **The last seconds at the ramp.** The legend lists everyone still out by
  how many seconds they have to spare. By then the frame has closed to the
  city, the ramp, the last runners and the black behind them.
- **The rearguard.** Six residents stand on the lit ground in front of the
  black, the bolt throwers fire over their heads, and the whole front stops
  for five seconds, and five more, while a core carrier crosses behind them.
- **The winch.** A straggler is pulled off its feet along a line to the
  city. Its kit stays behind in a heap, and the caption names the best thing
  in it: "Dara left a rare axe at Brackwater".
- **Through the line.** A charge goes into a packed line and the front rank
  goes into the second. A boulder started down a road takes a column. A
  thrown spear pins a slinger to the rock behind it.
- **Going back.** A resident on its way home turns round toward the black to
  get another up. Both get aboard, or both are winched in.
- **The captain in Dara's helm.** On the next crossing a captain comes over
  the rail wearing the rare with her name on it, and whoever kills it keeps
  it.
- **To stations.** The bell goes and every figure on the decks crosses to a
  post inside ten seconds.
- **A new deck.** The hull is rebuilt on a crossing. The frame widens to
  hold it, twenty berths open, and the names that were waiting come aboard.

### Why someone cares about their resident

- **A result every 20 minutes.** The owner's margin and bearing produce a
  haul, a time to spare and sometimes a lost kit, each cycle, shown on the
  stream.
- **Numbers that are theirs.** Which preset, what margin, what stance. A
  newcomer who picks well can top a board for a single landing on their
  first day.
- **Something to lose.** The kit is at risk every time the horde comes, and
  more of it in a valley than a clearing.
- **A say in where it goes.** Everyone votes on the next stop, and everyone
  lives with it.
- **Their name on the city.** Districts are lettered with who built them.
- **They already have one.** Saying anything in chat makes a resident with
  their name on it. There is nothing to claim and nobody's cast-off to
  inherit. The first thing a new chatter sees is their own name coming up
  through a hatch.

## 4. The loop at three timescales

### 4.1 A cycle: 20 minutes, 12,000 ticks

| Cycle clock    | Phase                  | The frame                   | What happens                                                                                                                                   |
| -------------- | ---------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 00:00          | Set-down               | opens, 6 to 8 s             | Legs fold. The land is revealed. The ramps drop. Newcomers board. Residents draw rations.                                                      |
| 00:30          | Landed                 | the whole landing, still    | Sorties. A resident goes out, fills its bag, comes back to the hold, goes out again.                                                           |
| 06:00 to 09:00 | The horde on the plate | closing                     | The black comes on at the far edge, four minutes before it would reach the lamps unopposed. From now `horde_eta` and `lift_eta` have values.   |
| 10:00 to 15:00 | The lift               | the city and the lit ground | The front reaches the lamps and the bell rings. Twenty seconds later the ramps go up. Whoever is outside is winched aboard without bag or kit. |
| to 20:00       | Crossing               | the city, still             | Five to ten minutes. The vote on the next stop takes the first minute. With the lead at 4 or less, the vanguard reaches the hull.              |

**The lead** is how far the horde is behind the city, 0 to 6, drawn on the
route map as the gap between the city's mark and the horde's black.
Unopposed, the front reaches the lamps at 10:00 plus 30 seconds for each
point of lead, a minute later on a clearing and a minute sooner in a valley.
A crossing of the continent starts at 4.

| The lead goes | When                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| up 1          | the vanguard is beaten on a crossing with no leg lost; the horde's front was held for a minute or more in all at the last landing |
| down 1        | the engine was short of fuel; a leg is dead; the city took a stop two hops off                                                    |
| to 6          | a gate is forced                                                                                                                  |

**Holding the front.** The front is a line that advances a tile at a time.
Where ten of the horde die within ten seconds (fewer for a small cast,
section 11.4), that stretch of the front
stops for five seconds. The horde's numbers along the front grow as it
nears the lamps, so it can be held for seconds and never for good, and the
ramps lift at 15:00 whatever has happened.

The horde is also the best thing on the plate to fight (section 7.4), so
those who hold it gather the most.

So the length of a landing is something the city earns. A city that fights
well on the crossing, keeps its legs and holds the line gets 13 minutes and
more on the ground. One that limps gets 10.

**What makes one cycle differ from the last:**

- **The size.** A clearing, a glade, a vale or a valley (section 5.3). It is
  the first thing the reveal shows, and it decides how much there is to
  fight, to carry home and to lose.
- **The place.** A new map every time. The city never lands on the same stop
  twice in a crossing.
- **The condition.** Every stop has one, shown before the vote. Fog: sensors
  reach 4 tiles. Brood: twice the fodder and twice the parts. Deep seam:
  nodes far out give double and near ones nothing. Old road: a road to the
  far side that is walked at three ticks a step. Hunted: a pack of elites
  roams from set-down. Storm: shots fall short and fires go out. Twelve are
  planned.
- **The prize,** and whether its core came home.
- **The horde:** how far behind, how large, and whose kit its captains are
  in.
- **Who was winched in,** and what they left for the horde.
- **What the city is short of.** Prices follow the hold's stock.

### 4.2 A day: 72 cycles, three great landings

Every 24th cycle is a **great landing**, at 00:00, 08:00 and 16:00 UTC, so
each part of the world has one in its evening. The page counts down to it.

- If the city has reached the country's border and its rating meets the
  gate's (section 8), the great landing is the **gate**. A gate takes eight
  minutes of work at its foot to force, by residents who can do nothing else
  meanwhile, and the city cannot leave until it is done or the hull gives
  out. So this is the one landing where the horde arrives and the city
  stays: the gate crew works, and everyone else holds the lamps. Through the
  gate, the lead goes to 6 and the horde takes a country's worth of time to
  find a way round.
- Otherwise it is the country's **stronghold**: a boss lair that pays three
  cores and the country's unique items.

A lost gate costs hull and a module tier, and can be tried again eight hours
later.

So a day has a shape: 23 landings to build, stock and gear up, then one that
uses it. What an owner finds after a night away: levels, items found and lost, times winched in, tally, what the city built, and whether the gate
fell.

The game day of 24 minutes goes. Day and night remain as light: a landing
begins at dawn, the horde brings dusk with it, and the crossing is night.

### 4.3 A month: one crossing of a continent

A continent is six countries in a row, each a tier of monster levels
(section 8.3). The city starts at the west coast as Hull I, with six
legs and berths for 40, and reaches the east coast about four weeks later
as Hull VI, with ten legs, berths for 150 and every district built, if it brings home a core from about one landing in two.

It is the same horde all the way. It grows with each country, it keeps what
it takes, and its captains keep their names. By the fourth week a viewer
knows it: the captain in three residents' kit, the one that has carried a
lost core since the second country.

Expected days in each country, from the cost of tiers in section 8.2: about
1, 2, 4, 6, 8 and 6.

When the east coast is reached the crossing ends with a last stand: the sea
is in front, the horde comes with everything it has, and the city holds
until its boats are away. Then:

- The city's record and its atlas go into the book of crossings.
- A new continent is generated, with a new horde. The city starts again as
  Hull I. Skills start again at 1.
- A resident keeps its name, its look, its lifetime levels (hat height), a
  hat band for each crossing finished, one item of the owner's choice, and one more locker slot for each crossing finished, up to four.

The reset is the month's loop. What is worth watching over a month is the
climb from a crowded boat on clearings to a walking town in valleys, and a second
crossing lets everyone do it again, with newcomers starting level with
veterans. It is also when city against city is a fair race (section 10).

Turned down: permanent levels on an endless road. A resident a month old
would have nothing to fight within reach of a new one, and a new owner would
join a city whose landings kill them for weeks.

## 5. The screen

The operator's reason for the cycle and the zoom is what this section is
built on: "It gives dynamism like a cosy feel when travelling in a slightly
cramped machine city (which we can consider allowing upgrades and expansions
over time). Then on landing, the zoom can expand to a massive valley rich
with enemies and resources to farm or a small clearing like we have now with
fewer things but easier."

Two rules follow.

- **Every resident is on screen, all the time.** The world moves round the
  city so that everyone can be in one picture. There is one frame, no cut,
  no second window and no inset.
- **The zoom is the pacing.** The frame is tight on a crossing, opens at a
  landing, and closes again as the horde comes. How far it opens is how hard
  and how rich the landing is, and a viewer can read that at a glance.

This replaces the old plan's circuit of stops, its accounting of seconds on
screen and its guarantees per owner.

### 5.1 One breath a cycle

Sizes are at 1920 by 1080. The picture is one plate in the art bible's
projection ([art.md](art.md), section 4): ground in plan, everything on it
in elevation, the city in cut-away with the near wall left off its decks.

| Phase                  | The frame                                                                                                                        | Tile size                                                          | How it moves                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Crossing               | The city, four fifths of the frame's width, hull on the lower third, land sliding by beneath and behind                          | 64 px for the first hull, down to 38 px for the last (section 5.2) | still                                                                                                                    |
| Set-down               | Pulls back from the city to the whole of the landing                                                                             | from the hull's size to the landing's                              | 6 seconds for a clearing, 8 for a valley, eased, anchored on the lantern mast; the land is inked as the frame reaches it |
| Landed                 | The whole landing, with the city a third of the way in from the edge away from the horde                                         | 24 px for a clearing, down to 10 px for a valley (section 5.3)     | still, for six to nine minutes                                                                                           |
| The horde on the plate | Its far edge keeps 6 tiles ahead of the horde's front; the other edges ease in to the residents still out, with 8 tiles to spare | closing, from the landing's size to about 32 px                    | as slowly as the front advances: about four minutes from edge to lamps                                                   |
| The lift               | The city, the ramp, the lit ground, the last runners and the black                                                               | 32 px                                                              | still, for the 20 seconds of the bell                                                                                    |
| Away                   | Closes on the city as the legs unfold                                                                                            | to the hull's size                                                 | 4 seconds                                                                                                                |

So in an hour the picture is tight for 15 to 30 minutes and wide for the
rest, it opens three times and closes three times, and it is otherwise
still. It never moves fast, and it only moves for a reason a viewer can see:
the city arrived, the horde is coming, the city left.

How much it opens is the point. The first hull at 64 px a tile opening onto
a valley at 10 is a pull-back of more than six times: the city goes from
four fifths of the frame to an eighth of it. The same hull opening onto a
clearing goes to a third. The viewer knows what the next ten minutes are
before a single monster has moved.

### 5.2 Home: the city on a crossing

The city is cramped on purpose. Figures are at their largest, stations are
shoulder to shoulder, and a new chatter appears among people. The frame on a
crossing is fitted to the hull, so as the hull grows the frame widens, and
the picture of home changes over a month from a crowded boat to a walking
town.

| Hull | At a rating of | Width, in tiles | Decks | Berths | Tile size on a crossing | A figure is about |
| ---- | -------------: | --------------: | ----: | -----: | ----------------------: | ----------------- |
| I    |             10 |              24 |     2 |     40 |                   64 px | 60 px tall        |
| II   |             14 |              27 |     3 |     60 |                   57 px | 54 px             |
| III  |             20 |              30 |     3 |     80 |                   51 px | 48 px             |
| IV   |             27 |              33 |     4 |    100 |                   46 px | 44 px             |
| V    |             35 |              36 |     4 |    125 |                   43 px | 40 px             |
| VI   |             44 |              40 |     5 |    150 |                   38 px | 36 px             |

A hull is rebuilt a size larger when the city's rating (section 8) reaches
the number shown, which is also what the next country's gate asks for. So
the city grows, and then it goes somewhere harder.

**Berths are how many chatters the city holds.** A bigger city fits more of
its chat, which makes the hull the thing a chat builds together and the
first thing a growing stream wants. Section 11 has what happens when more
people speak than there are berths.

Between rebuilds the city changes by districts: each module's district is
added to a deck when it is first built and is redrawn at each tier, as the
art bible's section 7 has it (timber, then iron, then brass, then carved
work). A district that is damaged shows it.

### 5.3 The landing: its size is its difficulty

A landing is generated in one of four sizes. The size sets how far the frame
pulls back, and everything else about the landing follows from it. Counts
are for a city of 50, and are scaled by the cast as section 11.4 has it:
a quarter for five residents and under, half up to 25, double from 100.

|                                   | Clearing                         | Glade                                     | Vale                       | Valley                                              |
| --------------------------------- | -------------------------------- | ----------------------------------------- | -------------------------- | --------------------------------------------------- |
| Sheet, in tiles                   | 80 by 45                         | 107 by 60                                 | 137 by 77                  | 192 by 108                                          |
| Tile size, landed                 | 24 px                            | 18 px                                     | 14 px                      | 10 px                                               |
| The city is, of the frame's width | a third to a half                | a quarter to a third                      | a fifth to a quarter       | an eighth to a fifth                                |
| A walk to the far edge            | 21 seconds                       | 28                                        | 36                         | 51                                                  |
| Monsters placed                   | 150                              | 300                                       | 600                        | 1,200                                               |
| Packs                             | 15, mostly fodder                | 30, half of them with a line and shooters | 50, with brutes and elites | 90, with a tier above the country's at the far edge |
| Monster levels                    | a tier under the country's       | the country's                             | the country's              | the country's, and above                            |
| Nodes to gather                   | 20                               | 40                                        | 80                         | 160                                                 |
| Cores                             | none                             | 1                                         | 1, and an elite's cache    | 2                                                   |
| Rarity of drops                   | as the tables have it            | 10% more magic and rare                   | 25% more                   | 50% more                                            |
| The horde                         | half its size, and a minute late | as it is                                  | as it is                   | half as large again, and a minute early             |
| Bearings                          | 2                                | 3                                         | 4                          | 6                                                   |

A clearing is today's game: one screen, close enough to see every figure, a
few packs, an easy haul, and little to lose. A valley is the other end. It
has eight times the monsters on five times the ground, twice the gathering,
two cores, and a horde that comes sooner and larger across a plate on which
a resident is 12 px tall and nearly a minute's walk from the ramp.

Size, density and richness are the three dials. They are tuned by country
and by what the city has built:

- **By country.** The Heath offers clearings and glades. The Marches add
  vales. From Stonefall on, valleys.
- **By the city.** The Engine's tier caps the largest landing it can reach:
  a glade at tier 1, a vale at tier 2, a valley from tier 3. Feet (Legs)
  open biomes. The Lookout shows more of each stop before the choice.
- **By condition.** Each stop has one condition (section 4.1) that turns a
  dial further: brood, fog, deep seam, hunted.
- **Great landings** (section 4.2) are always valleys.

Every size fits every cast, because the sheet is the frame. A full city on a
clearing is crowded and safe. A city of five in a valley is a few figures in
a very large land, which is its own picture.

### 5.4 The reveal

This is where the conductor's fourth idea belongs: the map is drawn as the
camera pulls back.

The city settles onto its legs over two seconds. The frame begins to widen,
and the ground is inked outward from the city just inside the frame's edge
as it goes: contours first, washes half a second behind, standing things
rising in order of distance, packs last, as marks. Place names are lettered
when the frame stops. The ramps drop on the last second.

For a clearing that is six seconds and the plate is full. For a valley it is
eight seconds of land still arriving, with the city shrinking in it the
whole time. The bruise wash is already on the far margin: the side the horde
will come from is known from the start.

An earlier draft had residents ink the map as they walked, with programs
knowing only inked ground. That is dropped. The whole landing is known from
the reveal, to viewers and to programs, because its size and what is on it
are what the choice of stop was about.

The plate still records what happened on it. Fights leave blots, as they do
now. A heap of lost kit is lettered with its owner's name. The core's way
home is a dotted line. At the lift the plate is kept in the city's atlas.

### 5.5 The close

When the horde's black comes onto the plate the frame starts to close, at
the pace the front advances. Its far edge stays just ahead of the front, so
the horde is always the edge of the picture, and the ground behind it is
gone. The other edges ease in to whoever is still out.

By the time the front reaches the lit ground the frame is the city, the
ramp, the rearguard and the black, at about 32 px a tile, whatever size the
landing was. So every landing ends as a clearing: close, crowded, with
figures large enough to see who is who. The bell rings, the ramps lift, the
winch lines go out and come back, and the frame closes the last of the way
onto the city as its legs unfold.

A resident far out when the horde arrives is inside the frame because the
frame is fitted to it. One resident dawdling at the rim holds that edge of
the frame out until it comes in or the front passes it.

### 5.6 Choosing the next stop

The choice is made on the crossing, where everyone can see it, and it is the
chat's.

- **What is shown.** For the first minute of a crossing the route map, a
  small engraved map in a corner of the plate, opens to a third of the
  plate's width, and the city sits to one side of it. It shows the trail,
  the horde's black behind at a distance that is the lead, and the three
  stops ahead. Each stop is a vignette drawn to scale beside a mark the size
  of the city: so a clearing is a ring barely wider than the city and a
  valley dwarfs it. Each carries its biome, its condition (a storm over it,
  fog in it, a brood's marks), and one tally mark for every hundred
  monsters.
- **Who chooses.** The chat. The rules of the vote are chat.md's (section
  7): one vote for each resident that was awake before the question opened
  and has been through a lift, cast by typing the stop's number, `!1`, `!2` or `!3`, for 60
  seconds.
- **How it reads.** A route is drawn on the map from the city to each stop.
  Each vote pins a small pennant in the voter's colours to its route, and
  the voter's figure turns toward the map and raises an arm. The count is
  lettered at each stop. When the minute is up the winning route is inked
  solid, the others fade, the legs turn, and the map folds back to its
  corner. chat.md describes this on "the world map"; the route map opened
  on the plate is that view, so that nobody leaves the picture for it.
- **With no votes** the first stop offered stands, and the offer is ordered
  so that the first is the largest whose monsters are not above the city's
  median level.

The city walks toward a place everyone has seen and most have voted on. A
chat that picked the stormy valley spends five minutes forging and stocking
for it.

### 5.7 What is lettered, by phase

The art bible (section 11) says where lettering sits and how it is drawn: a
cartouche, a legend, banners and a caption inside the plate's one border,
with no second column. "The page" elsewhere in this plan means the legend
and the cartouche. #231's rows become the legend's entries.

- **The cartouche, always:** the stop's name, size and condition, and the
  phase. No clock is shown on a landing and no bar counts the horde down:
  how near it is shows in the bruise wash, in the black itself, and in the
  frame closing.
- **Landed:** the legend has one entry per bearing (residents out, haul,
  down), then entries for residents something is happening to, present
  chatters first.
- **The horde on the plate:** the legend is the gangway list. Aboard and
  out, then everyone still out, sorted by seconds to spare: `lift_eta` less
  the walk home at their load. The seconds move when the front is held.
- **The lift and reckoning:** aboard and winched in; the take by good; the
  best item found and by whom; the biggest haul; the closest call; what was
  left and by whom.
- **Crossing:** the hold's stock, the district being built and who gave to
  it, the lead, berths taken and free, and in an assault the hull and each
  leg.
- **Banners** go to residents in the news, in the legend or in a fight,
  present chatters first, and come and go slowly.

The news is the plate's caption: events only, built from state.

### 5.8 Where this meets the art bible

[art.md](art.md) is the standard for how everything is drawn. Its section 12
is the reveal and the close described above, and this plan now follows it:
one move out, the land inked as it is revealed, the lantern mast as the
anchor, one move back. Also taken from it: the projection, the city in
cut-away, the city parked off-centre away from the horde, the bruise wash in
place of a countdown bar, lettering as plate furniture, and districts and
upgrades that are drawn.

Three things here are not yet in it, and are for the art director to settle
before the pieces that draw them are briefed:

- Its smallest figure is 28 px tall. A vale and a valley need figures of
  about 17 and 12 px.
- The close follows the horde over four minutes, where its section 12 has
  the return as one move of about 4 seconds. Here that move is only the last
  step, from the lit ground to the city.
- The route map opened for the vote, with its vignettes and the pennants on
  the mast, and the gangway list in the legend.

### 5.9 Finding your own

Every resident is in the frame, so the question for an owner is which one is
theirs.

- A hood and cloak pair of its own, as now.
- `!me` rings the owner's figure and letters its banner for six seconds at
  any zoom.
- A banner whenever it is in the news, the legend or a fight, with present
  chatters first.
- A row on the gangway list whenever it is out with the horde on the plate.
- On every crossing and at the end of every landing it is drawn large.

## 6. The chatter

[chat.md](chat.md) is the design for how a chatter joins and commands their
citizen, and it owns the commands, what confirms them on screen, speech, and
moderation. This section says what in the game those commands reach.

The operator's scope for now is that chatters steer through chat alone. They
do not write programs, and there is no page or editor for them. A resident
runs one of the preset programs the game ships. Its chatter chooses among
them and sets their `param`s by typing.

### 6.1 What they see

The stream, and nothing else. So everything a chatter needs to know about
their own resident is on the plate:

- the resident itself, always in the frame (section 5);
- its banner, and `!me`;
- a row on the gangway list when it is out with the horde on the plate;
- its line in the reckoning at the lift, for the residents with the biggest
  haul, the closest call and the worst loss, and for anyone who asks with
  `!me`: sorties, haul, seconds to spare, what was found and what was lost;
- [chat.md](chat.md), section 4, has how an order is confirmed.

### 6.2 What they decide

| Decision                                                             | How                                                               | How often it is tested     |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------- |
| Which preset the resident runs                                       | `!run <preset>` (chat.md, section 9)                              | every landing              |
| The margin                                                           | a `param` of every preset, set by typing                          | every time the horde comes |
| Stance: gather, fight or keep clear                                  | a `param`                                                         | every sortie               |
| Where to go: a bearing, a place, a station, a post, another resident | `!go`, which plants a flag the program reads (chat.md, section 3) | when they choose           |
| Where the city goes next                                             | a vote: `!1`, `!2` or `!3` (section 5.6)                          | every crossing             |
| Which district is built next                                         | `!pledge <module>`                                                | a standing choice          |
| Pay a toll or run it; trade, board or run when a rival is alongside  | a vote                                                            | when it comes up           |

What a preset decides for itself, because nobody types that fast: when to
bank, what to pick up and wear, when to eat, whether to stand or step out of
a blow or a shot, whether to hold the front, go back for someone or carry a
core, and which station or post is shortest of hands.

A chat command never moves a resident. It changes something the program
reads, so two residents given the same order do different things with it,
and which preset and what numbers a chatter chose is what shows.

### 6.3 The turn-back decision

Three sensors make it.

- `lift_eta`: ticks until the horde's front reaches the lamps, at the pace
  it is making now. Before the horde is on the plate it has no value, and a
  comparison on it is false, so the rule below cannot fire early.
- `horde_eta`: ticks until the front reaches where this resident stands.
- `way_home`: ticks to walk from here to the nearest ramp at this resident's
  load, with nothing in the way. It comes from a table worked out at
  set-down, so it costs nothing to read.

Every preset has this rule above its gathering and fighting rules:

```
param margin = 250 from 100 to 400

when lift_eta * 100 < way_home * margin  -> go_home
```

At 100 the resident leaves at the last tick that could work. At 300 it is
home with minutes in hand and a third less haul. A full bag (five ticks a
step where an empty one is four), the horde's outrunners and anything on the
way all eat the margin, and none of them is in `way_home`. And `lift_eta` is
an estimate: it gets longer when the rearguard holds, and shorter when the
front breaks through, so a resident that leaves late is betting on other
people.

A newcomer starts at 250, which is safe. Targets, to be tuned by the
outrunners' numbers: at 180 a resident is winched in about once in 30
landings; at 100, one in four; across a city, 2% to 5% of those who went out
are outside at each lift, and twice that in a valley.

### 6.4 Presets

A preset is a Tactics program in `content/`, with three sections, of which
the phase picks one: `landing`, `aboard` and `alarm` (and `raid`, from
M6). The whole language is open to every preset. M1 ships three (section
13), and more come with weapons and districts. Which presets a stream
offers, and which one newcomers start on, is the streamer's to set
(chat.md, section 9).

A preset's `aboard` and `alarm` sections fill whatever is shortest of
hands, so a chatter who only ever said hello has a resident that is useful
all cycle.

## 7. Builds and fights

### 7.1 A build

The whole of Tactics is open to every program. Nothing in the language is
unlocked, found or bought. An earlier draft of this plan made sensors and
actions into loot, and the operator turned that down: locking them behind
drops cripples the program writing the game is built on. For now programs
are the presets the game ships, chosen and tuned from chat (section 6), and
every one of them may use all of it.

A build is four things:

- **Skills.** Melee, Archery, Hitpoints, Woodcutting, Fishing and Cooking in
  M1; Mining and Smithing with their biomes and the forge. Each runs from 1
  to 99 and goes up only by doing that thing. Skills are strength: a blow, a
  shot, hitpoints, the odds of a try at a node. Archery covers everything
  that leaves the hand, and the city's bolt throwers and catapults.
- **Kit.** Six slots. The weapon sets the basic attack.

  | Weapon   | Basic attack                                                                                                  | What it is for                     |
  | -------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
  | Sword    | an arc of 3 tiles                                                                                             | the line                           |
  | Axe      | an arc of 5 at 150%, a tick slower                                                                            | fodder                             |
  | Spear    | a line of 3; thrown, a heavy shot of 6 tiles that knocks back 2                                               | holding a gap; breaking a charge   |
  | Bow      | an arrow, fast and straight, 12 tiles, through fodder                                                         | the monsters behind the line       |
  | Sling    | a stone on an arc, 9 tiles, over low cover and over friends                                                   | shooting from the second rank      |
  | Firepots | lobbed on an arc, 7 tiles, bursting over 9 tiles and burning for 3 seconds; carried in the bag, six to a slot | a packed swarm; a line of shooters |

  The off hand holds a shield, a torch or a quiver. Items roll affixes as in
  Path of Exile, and some change what a move does.
- **Moves.** `whirl`, `charge`, `slam`, `guard`, `shove`, `volley` and the
  rest are in the language for everyone, each on a wait of its own. How far
  a move reaches and how hard it hits come from the weapon held and the
  skill behind it. When to use one is the program's business (#318).
- **The program.** What the resident does with all of that.

So two residents of the same level in the same kit differ by their preset
and its numbers, and a month-old resident differs from a new one by levels
and gear and by nothing they are locked out of.

Arrows and firepots are made from the hold's wood, ore and parts, as the
city's shot is. A city of archers eats its own stock.

### 7.2 Packs

The operator asked for many more packs than there are today, when a region
holds a handful of monsters. A landing is generated with 150 to 1,200 monsters
on it by its size (section 5.3), in packs, so that a resident walking outward meets one
every 8 to 12 tiles, which is every four seconds.

A pack is a formation, set by its monsters' programs:

| Distance from the city         | A pack is                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| under 30 tiles                 | 6 to 8 fodder, no order to them                                                                                              |
| 30 to 70 tiles                 | a line of 4 to 6 that stands and fights, 2 or 3 slingers or archers four to six tiles behind it, and fodder round the flanks |
| beyond 70 tiles                | a brute at the front, a line either side of it, shooters behind, and one that lobs firepots from the back                    |
| at the prize, and in the horde | all of that, with an elite or a captain                                                                                      |

Shooters keep the line between themselves and their target, and fall back
when it breaks. So a pack is a problem with more than one answer: go through
the line, go round it, shoot over it, or make the shooters hit their own.

### 7.3 Things that fly, and bodies that move

This is #332, an M1 issue, and fights are built on it.

**Projectiles are things in the world.** Each has a position, a speed, a
lifetime and an owner, in whole numbers, and is moved every tick. There are
five kinds: the arrow (fast, straight), the thrown spear (slower, heavy),
the sling stone (an arc that clears low cover and whoever is under it), the
firepot (an arc, a burst where it lands, fire that stays), and the boulder
(rolls along a line and hits every body in it once).

**A shot hits the first body in its way.** Stepping off its line dodges it.
Rocks, trees and walls stop a straight shot, and an arc goes over them. A
monster's shot hurts a monster, so a pack can be made to shoot its own line.
A resident's shot that meets another resident is spent and shoves them a
tile, and does no harm. #332 as filed has it hurt them; this plan changes
that, because residents have never been able to harm each other and a bow
would be the way to do it on purpose.

**A hard hit moves the body it lands on,** one or two tiles. A body pushed
into another body stops, and both are hurt. A body pushed into a wall, a
rock or a tree is hurt more. A body pushed into water deeper than a ford is
gone if it is fodder and slowed if it is not. A body pushed off the city's
rail falls: a monster is dead, and a resident is winched back to the
infirmary. All of it is settled in a fixed order each tick.

That gives the power fantasy something to do besides numbers. A `charge`
into packed fodder throws the front rank into the second. A `slam` beside a
cliff clears it. A spear thrown down a gap goes through the first and pins
the second to the rock. A boulder started down a road takes a whole column.

**Programs can see it coming.** `incoming` counts the shots that will land
on this resident's tile; `incoming_ticks` says when the first does;
`incoming_x` and `incoming_y` say where it comes from; `line_clear(x, y)`
says whether a shot from here to there meets a friend or a rock first;
`cover_from(x, y)` gives the nearest tile that puts something solid between
this resident and that place. With `danger_here` for blows, a good program
steps out of what it can, takes cover from what it cannot, and never wastes
a shot on a friend's back.

At the frame's widest, shots are what can still be seen: a flight of arrows
is a line of ink across a dozen tiles where a sword's arc is three. Ranged
fights carry the middle of a big landing.

### 7.4 Holding the horde

The operator kept the horde for one reason above the others: "it rewards
strong players who can hold out and gather more loot." Three rules make that
true.

- **Time.** Where the horde's front is being killed, it stops (section 4.1).
  Every second a rearguard holds is a second more for everyone still
  gathering, themselves included.
- **The horde pays best.** Its creatures are a tier above the country's, so
  they give the most experience on the plate and drop from the best tables,
  and its captains carry what earlier stragglers lost. The richest ground on
  any landing is the horde's own front, in the last minutes, for those who
  can stand on it.
- **A place to stand.** The lamps' ground is under the city's bolt throwers
  and catapults, which fire on a landing as they do on a crossing. So the
  end of a landing for a strong city is a fighting withdrawal: a line on the
  lit ground, shooters behind it and on the rail above, the front stopped
  again and again, and the last residents backing up the ramp as it lifts.

A weak resident's good margin gets it home early. A strong resident's
preset and numbers keep it out until the bell, on the best loot there is, with the
kit to lose if it is wrong.

What the horde takes, it uses. Its captains wear the kit of the residents
who were winched in, under the owner's name, and drop it when they are
killed (section 9).

## 8. The city

### 8.1 Modules

The city is a hull with decks, a rail, and legs under it (section 5.2 has
its six sizes). Each module is a district on a deck. Ten modules,
each at tier 1 to 5. The city's **rating** is the sum of its tiers, 10 to 50.

| Module    | What it does                                                                                                                                                                                            | A tier adds                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine    | Burns fuel on every crossing: 40 logs, and 20 more for each tier of Legs above 1. Sets range. Short of fuel, the lead falls by one.                                                                     | One more hop of range. The largest landing it can reach: a glade at tier 1, a vale at tier 2, a valley from tier 3.                                                                 |
| Legs      | Carry the hull. Each leg has hitpoints of its own. A dead leg costs a point of lead on every crossing until it is mended.                                                                               | Six legs; eight at tier 3, ten at tier 5. Feet: wide at tier 2 (fen, dunes), claws at 3 (scree, ice), stilts at 4 (shallows). A stop on ground the feet cannot take is not offered. |
| Plating   | The hull's hitpoints                                                                                                                                                                                    | More of them                                                                                                                                                                        |
| Guns      | Bolt throwers on the rail, crewed on Archery. A bolt goes 16 tiles through every body in its line and knocks the last one back. They fire on a landing as well as a crossing. Barrels at each leg head. | Two bolt throwers, and two more a tier. A catapult at tier 3 and another at tier 5, which lobs stones or firepots onto marked ground.                                               |
| Lamps     | The lit ground round a landed city, 20 tiles: where the rearguard stands, and where the horde's arrival is counted from                                                                                 | 5 tiles                                                                                                                                                                             |
| Hold      | Storage: 500 of each good                                                                                                                                                                               | Double                                                                                                                                                                              |
| Forge     | Makes plate, shot and gear from ore. Sets the item level of what it makes and of issue kit.                                                                                                             | The next band of item levels                                                                                                                                                        |
| Galley    | Cooks fish into rations. Each resident draws three at the ramp.                                                                                                                                         | Rations that heal more                                                                                                                                                              |
| Infirmary | Where the downed wake: 20 seconds                                                                                                                                                                       | 3 seconds less                                                                                                                                                                      |
| Lookout   | Warning of the horde: it is sighted four minutes before it would reach the lamps. What the vote is shown of each stop.                                                                                  | 20 seconds of warning. At tier 1 a stop's size and biome are shown; at tier 2 its condition; at tier 3 its monsters, as tally marks; at tier 5 its prize.                           |

A new district is added to a deck when its module first passes tier 1, and
the hull grows a ring when it runs out of room, so the city's outline on
every view changes over a crossing.

### 8.2 Building

A tier costs goods from the hold and **cores**. A core is the prize of a
landing: one a landing, three from a stronghold. It has to be carried home.
It fills the carrier's bag and slows them to six ticks a step, so whoever
carries it brings nothing else back, and needs others to keep things off
them. If the carrier goes down the core lies there for anyone to take. A
core not aboard at the lift is the horde's, and comes back as a captain with
twice the hitpoints.

| Tier | Cores |
| ---: | ----: |
|    2 |    15 |
|    3 |    25 |
|    4 |    35 |
|    5 |    45 |

Goods are set in landings' worth of the hold's intake, measured when M3 is
built. All ten modules at tier 5 take 1,200 cores. A city that brings home
one core in two landings gets 36 a day and the strongholds add up to 9. At
45 a day the gates' ratings are reached after about 1, 3, 7, 13, 21 and 27
days. Each core is fitted on the next crossing, on screen, and adds a drawn
part to the district being built.

Which district is built next is decided by pledges. Owners and programs pledge
tally to a module; the one with most pledged is built, and the tally is
spent. A finished tier is lettered with the three who pledged or carried
most toward it.

### 8.3 Where the city can go

| Country     | Tier | Monster levels | Biomes             | Gate needs a rating of |
| ----------- | ---: | -------------- | ------------------ | ---------------------: |
| The Heath   |    0 | 1 to 8         | heath, pinewood    |                     14 |
| The Marches |    1 | 10 to 25       | fen, reed mere     |                     20 |
| Stonefall   |    2 | 30 to 45       | scree, quarry      |                     27 |
| The Salt    |    3 | 50 to 65       | salt pan, dunes    |                     35 |
| The Gloam   |    4 | 70 to 85       | dark wood, hollows |                     44 |
| The Shelf   |    5 | 90 to 99       | ice, shallows      |  50, at the east coast |

A country is 12 hops deep. Each crossing the city is offered three stops its
range and feet reach, of the sizes section 5.3 allows, and never three of
one size. Within a landing the tier runs by distance: inside 30
tiles of the city there are vermin of levels 1 to 8 in every country,
because they travel under the city and spill out wherever it sits; from 30
to 70 tiles monsters are a tier under the country's; beyond that, and at the
prize, they are the country's own. So a newcomer has something to fight on
any landing, and the far side is where the strong go.

### 8.4 The shared economy

**Goods belong to the city and items belong to residents.** Wood,
fish, ore and parts put in the hold become the city's, and the resident is
paid **tally** at a price that follows the stock:
`base * 2 * target / (stock + target)`, with `target` four per resident, so
a good the city is short of pays up to double.

The hold is spent on fuel every crossing, rations at every set-down, plate
to mend the hull and legs, shot for the guns, tiers of modules, and
residents' own orders at the forge. Fuel, rations and mending are served
first: 30% of each stock is held back for them.

Where one resident's interest and the city's pull apart:

- **The bag.** Twelve slots hold goods for the city or items for oneself.
- **The core.** Carrying it means no haul of one's own. The carrier is paid
  the tally of a full bag of the scarcest good and credited on the district.
- **The rearguard.** Standing in front of the horde buys other people time
  and is the likeliest way to lose a kit.
- **The margin.** A resident who cuts it fine brings more home most times.
  When it fails, the horde gets its kit, and uses it on
  everyone.

- **Tally.** A new sword, or a pledge.

## 9. Loss, and the crossing

### 9.1 What is lost

The operator's rule is kept whole: miss the city, lose the haul and the
gear, and be pulled back aboard. Nobody is left anywhere. An earlier draft
had the stranded walk after the city in a window of their own, and the
operator turned that down: the world moves round the city so that everyone
is in one picture.

| What happens                                                   | The bag                                       | Worn kit | The locker | The resident                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------- | -------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downed outside, the horde's front still more than 30 tiles off | dropped where it fell; it can go back for it  | kept     | safe       | An ally at its side for two seconds gets it up at 30% hitpoints. After 30 seconds a winch line from the city hauls it to the infirmary, and it is out again 20 seconds later. |
| Downed outside with the front nearer than that                 | as below, unless it is got up and gets aboard | as below | safe       | lies there until an ally gets it up or the lift comes                                                                                                                         |
| Not aboard at the lift, standing or down                       | left                                          | left     | safe       | hauled aboard by the winch as the ramps go up, stripped, and given issue kit                                                                                                  |
| Downed aboard, in an assault                                   | kept                                          | kept     | safe       | infirmary for 20 seconds                                                                                                                                                      |
| On a walker's deck when it breaks away (section 9.3)           | left                                          | left     | safe       | hauled back by the winch, as at a lift                                                                                                                                        |

"Aboard" means standing on a deck or ramp tile on the tick the ramps lift.

The winch is drawn: a line goes out from the city to each resident still
outside, the figure is pulled off its feet along it, and its kit stays where
it stood in a heap tagged with its cloak's colour. The caption names the
best thing in the heap. All of it happens inside the frame, which by then
has closed to the city and the ground just round it.

**The locker.** Four item slots, safe from everything. A program's `wear`
rule chooses what goes outside. A fifth to eighth slot can be bought with
tally, and finished crossings add up to four.

**Issue kit.** A stripped resident is handed plain gear from the armoury, of
the item level the Forge's tier makes, about two thirds as good as ordinary
rare gear of that level. So being stripped costs the difference, and a
better Forge shrinks that for everyone.

**Getting it back.** With drops at the rate #240 aims for, a wearable
upgrade about every third landing, a stripped resident is back to ordinary
gear in two or three cycles. A rare with good affixes is the real loss, and
whether to wear it outside is the decision.

**What the horde takes, it uses.** The heaps are on the ground the horde
crosses next. Its captains wear the best of what was left, under the owner's
name, and the total left over the last three landings adds to the vanguard's
numbers. A captain that is killed drops what it wore for whoever killed it.
So a city of gamblers is pressed harder, and a lost item has a way back that
happens on the deck, in the frame.

**No insurance.** Paying tally to get lost gear back was turned down: it is
a fee nobody sees.

**A way out, on purpose.** A resident downed while the front is still far
off is hauled home with its kit and without its bag. A program can use that
to save gear at the cost of the haul. It takes over 30 seconds on the ground
to work, and the haul is what the sortie was for, so it is left in.

### 9.2 The vanguard, and the city's walls

With the lead at 4 or less when the city lifts, the horde's vanguard reaches
the hull on the crossing, earlier and in greater numbers the shorter the
lead. The lookout sights it and the bell rings.

The fight on the walls is the fight of section 7 turned on its side: the
enemy has to come up, and everything the city has goes down.

| What comes                                                                                                                                                                   | How it is answered                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boarding hooks.** Thrown from the ground and from skiffs, each one a shot that can be dodged or blocked. A hook that catches the rail holds a line, and boarders climb it. | Cut the line at the rail, which drops everyone on it. Shoot the thrower.                                                                                            |
| **Climbers.** Fodder in hundreds up the legs, which gnaw the leg they are on.                                                                                                | Barrels rolled down a leg hit every body on it once, as a boulder does. Firepots lobbed onto a leg's foot. Arrows and stones from the rail.                         |
| **Boarders** over the rail, who make for the hold and carry crates off, 20 goods each, up to 30% of a stock.                                                                 | A line at the rail. `shove` puts a boarder back over it.                                                                                                            |
| **Shooters** on skiffs alongside, and a walker's catapult, whose stones are marked on the deck before they land.                                                             | Bolt throwers on the rail: a bolt goes through a line of bodies and pins the last. The city's own catapults, on clusters and on skiffs. Step off the marked ground. |
| **Captains,** in the best of what was left behind.                                                                                                                           | Everyone near. Whoever kills one keeps what it wore.                                                                                                                |

Every program's `alarm` section chooses a post:

| Post                        | What a resident does there                                                    |
| --------------------------- | ----------------------------------------------------------------------------- |
| Bolt throwers and catapults | Crews one, on its Archery, and chooses what to fire at                        |
| Rail                        | Fights boarders where they come over, shoves them back, and cuts hooked lines |
| Leg heads                   | Rolls barrels and lobs pots down the leg below                                |
| Hold                        | Fights whatever gets through to the crates                                    |
| Mending                     | Carries plate to a breach or a leg and works on it                            |
| Infirmary                   | Gets the downed up faster                                                     |

Beating the vanguard, with no leg lost, puts the lead up by one. So a city
close pressed can fight its way back to long landings, and a city at a lead
of 5 or 6 has a quiet crossing that it earned.

The whole city and everything climbing it are in the frame, and the figures
are at their largest. This is where the fights are best seen.

With the hull at no hitpoints the city founders: it goes down where it is,
the horde arrives in full, the next cycle is spent defending and mending the
wreck with no landing, and one module loses a tier. A city is never
destroyed outright. A month of everyone's work would go with it.

### 9.3 Other things on the way

About one crossing in four has something besides the horde. Whatever it is
draws level with the city and is in the frame with it.

| Event        | What comes                                                                                                                                                                                                                                                                   | What failure costs                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **A walker** | A smaller machine on legs draws level, fires on the hull and lays planks across. Its crew boards, and residents can cross the other way for its crates. It breaks away after three minutes, with a horn 30 seconds before. Anyone on its deck then is winched back stripped. | Hull damage, crates                  |
| **A toll**   | A fort across the way. The vote is pay 15% of each stock, or run 90 seconds under its guns.                                                                                                                                                                                  | The toll, or hull and districts      |
| **A storm**  | Lightning on the decks: fires in districts, struck figures knocked down. Fires are put out with water from the galley.                                                                                                                                                       | A district out of use for a crossing |
| **A trader** | A walker that swaps what the hold has too much of for what it lacks                                                                                                                                                                                                          | Nothing                              |

The vanguard is in M1, in a simple form. The walker and the toll are M3.

### 9.4 When a chatter goes quiet

A resident runs its program whether or not its chatter is watching, and
loses nothing by their silence that it would not lose with them there. There
are no streaks and nothing decays. Section 11 has what happens after a long
silence.

## 10. City against city

One streamer is one machine city, and each chatter is a citizen of it. (This
plan says "resident", as the code does; a resident is a citizen of its
stream's city.) The operator: "i feel like the idea of competing machine
cities in the multiplayer expansion would be sick." It is built after the
single city works, as M6. Its shape is fixed here so that nothing built
before it has to be torn out, and section 10.6 lists what M1 to M4 do
differently because of it.

Until then, threats come from the world: the horde, and what is met on the
way (section 9.3). An earlier draft had viewers without a resident vote for
the horde. That is dropped, because everyone who chats has a resident
(section 11). The horde decides for itself. It follows the city, so it comes
onto a landing from the side the city came from.

### 10.1 A city has a name and a face

From M1 a city carries its stream's name and two colours, chosen once by the
streamer.

- The name is lettered on the hull's keel plate and in the cartouche.
- The colours are the pennants on the mast, the wash on the rail's
  bulwarks, and a band on the sleeve of every one of its residents.
- Its districts are its own. Two cities at the same rating look different
  because their chats pledged differently: one is all bolt throwers and
  plate, another all lamps and forge.
- Its record is drawn on it. A rival's pennant hangs under the city's own
  for each city it has beaten, the keel plate carries a notch for each gate
  forced, and the hull's size is plain to see.

With one city in the world none of this competes with anything. It is there
so that a city is somebody's from the first day, and so that a second city
on the plate can be told from the first at a glance.

### 10.2 One continent, many cities

Every city in a crossing walks the same continent, from the same seed, on
the same real clock. A stop is the same place for all of them: the same
map, the same size, the same condition. So cities can be compared, and can
meet.

The route map shows every city within a country of this one, as a mark in
its colours with its trail. A board in the legend, shown for ten seconds at
each reckoning, ranks the cities of the crossing three ways: by hull, by
depth (country, and hops into it), and by rivals beaten.

A stop a rival has landed on is poorer for it: its nodes and packs come back
at a tenth an hour, and the vote shows whose pennant was planted there.

### 10.3 Contested landings

A valley shows on every route map within range of it. When two cities vote
for the same one on the same crossing, they race for it, and both land.

- **The race.** Both arrive at the same set-down, since both are on the
  clock. The faster walker, by Engine tier and then by legs whole, is first
  down, and its chat's vote picks one of the landing's two berths. One is
  the better ground: nearer the prize and the richer bearings. The slower
  city gets the other. The race is drawn on the route map through the
  crossing, the two marks closing on one stop.
- **The landing.** A contested valley is revealed with both cities on it,
  side by side on the edge away from the hordes, a third of the plate
  apart. There are two cores, one set of packs and one set of nodes, and
  what one city takes the other does not get.
- **Residents of two cities do not harm each other on the ground.** A blow
  or a shot that meets a rival shoves and does no harm, as between friends.
  They can be in each other's way, take each other's kills and cores, and
  push each other into a pack. Getting a rival's downed resident up is
  allowed, and is news.
- **Two hordes.** Each city has its own, on the horizon in its own place,
  as far behind as that city's lead. Each crosses the plate toward its own
  city. A city leaves when its horde reaches its lamps.
- **Holding out longest wins most.** The city whose horde arrives first
  must go first. The other has the valley to itself for as long as it can
  hold: the remaining packs and nodes, a core still lying where it was
  dropped, and the heaps the first city's stragglers left. It is declared
  the winner at its own lift if it brought home more cores, or with cores
  level, the greater haul.
- **What winning is worth.** The loser's pennant on the winner's mast, a
  point of lead, and what it gathered alone. The loser loses nothing but
  what it left on the ground.
- **The frame** is the whole valley, as for any landing, so both cities and
  every resident of both are in it on both streams. Banners and the legend
  are this stream's own. When this city's horde comes, the frame closes on
  this city, and the rival, if it is still out there, passes out of the
  picture as the land behind the black does.

### 10.4 Encounters on a crossing

Two cities within a hop of each other at a lift, and matched by the chart
(section 10.5), come alongside for three minutes of the crossing. Each chat
is asked in the first 30 seconds: trade, board, or run. The pennants on both
masts show it.

| This city | The other       | What happens                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| trade     | trade           | **A trade bridge.** Planks are laid rail to rail. Each hold sells its surplus to the other at the other's price, which is better than either gets at home. Residents may cross and look round. Nobody is harmed.                                                                                                                                                                                                    |
| board     | board, or trade | **A boarding.** Bolt throwers and catapults fire across, hooks are thrown, and each city's residents go over the other's rail for its crates. The defenders are the other stream's chat: their residents, their programs, their `alarm` rules. A horn sounds at 2:30 and the cities part at 3:00. Anyone on the wrong deck then is winched home without bag or kit, and what they wore is the other city's to wear. |
| run       | anything        | **A chase.** The runner spends a crossing's fuel over again and a point of lead, takes 30 seconds of bolts, and is gone.                                                                                                                                                                                                                                                                                            |

A boarding is won by crates taken. The winner keeps them, up to 20% of each
of the loser's stocks, and hangs the loser's pennant. Lockers, modules and
berths are never at stake, and a city cannot be boarded twice in an hour.

Programs gain a `raid` section for the other city's decks, with the same
sensors as anywhere, and `lift_eta` there counts down to the parting. So
the turn-back decision is made on a rival's deck as it is on a landing, and
a chat that has tuned its margins well loses fewer people to the other
city.

The frame holds both cities, rail to rail, at about half the tile size of a
crossing alone. Every resident of this city is in it, on either deck.

Chat commands when cities meet are in chat.md, section 11.

### 10.5 The technical shape

- **One world server for each city,** as now. It runs that city's world
  from its seed and its inputs, and is the only thing that writes it.
- **The chart:** one small shared service for a crossing. It holds the
  continent's seed, and for each city its name, colours, position, hull,
  rating, lead and record. It takes each city's vote for its next stop at
  the same tick of the cycle, and answers with who else is going there and
  in what order they arrive. It pairs cities for encounters. It holds no
  world state and runs no simulation.
- **A meeting is one world.** For a contested landing or an encounter, a
  meeting world is made at a tick both cities have agreed, from the stop's
  seed and a cut of each city's state: its hull, residents, hold, horde and
  kit. Both servers run that same world, each feeding it its own chat's
  inputs.
- **Lockstep.** In a meeting, an input is applied five ticks after it is
  made, and is sent to the other server in that half second. Inputs for a
  tick are applied in a fixed order: by city id, then by the order they
  were made. Both servers then compute the same ticks, because the
  simulation is already a pure function of seed, content and inputs, in
  integers. They compare hashes every 50 ticks.
- **If they disagree,** or one side stops answering for 30 ticks, the
  meeting ends there as a draw. Each city carries on alone from its own
  state at the last tick they agreed on, with a lone copy of the landing.
  Nothing a city owns is ever in doubt, because each city's state is only
  ever written from its own server's copy.
- **Parting.** At the end of a meeting each city's part of the world is cut
  back out, with what it gained and lost, and its own server goes on with
  it.

Two cities on one stream's machine, with two scripted crowds and a local
chart, exercise all of this with nothing deployed. Two streams doing it
across the internet need the chart hosted, which is outside what the team
plans; the design does not change when that happens.

### 10.6 What is built ready for it

These cost little in M1 to M4 and are what would otherwise be torn out.

- **Everything belongs to a city.** The world holds a list of cities, of
  length one until M6. Every resident, hold, heap, horde, captain and input
  carries a city id. "Friend" in a sensor means "of my city", from the
  start.
- **The city is an actor with an identity:** name, colours, hull, rating,
  lead and record are fields of it, in the snapshot, and drawn (W2, W10).
- **The cut.** A city's state can be written out and read back on its own,
  apart from the landing it stands on. Snapshots are laid out that way from
  W1.
- **Stops are places, not rolls.** A stop's map comes from the continent's
  seed and its position, never from the visiting city's state, and its size
  and condition are fixed with it (W3).
- **Two berths.** The generator lays out every valley with a second place
  to park, unused until M6 (W3).
- **Hordes are per city.** A horde has an owner and a place on the horizon,
  and the lift is that city's own (W6).
- **The frame takes a list.** It is fitted to "these cities", which is one
  city until M6 (W9).
- **Inputs are already delayed-safe.** Chat reaches the world as logged
  inputs at tick boundaries (W2), so adding five ticks changes nothing a
  chatter can see.
- **The clock.** Every city sets down on the same minutes.

## 11. The cast is the chat

One chatter is one player. Anyone who writes a line in the stream's chat
has a resident, made at that moment and named by their chat username. There
is no command to join, nothing to claim, and no resident that belongs to
nobody: the city holds the people who have spoken, and it grows and shrinks
with the chat.

[chat.md](chat.md) is the design for this and is where its rules are kept:
joining (its section 2), going quiet and coming back (section 5), names and
moderation (section 8), and the scripted crowd that stands in for a chat
(section 10). What follows is what the rest of this plan relies on, and the
two places where the plan's own rules meet it.

### 11.1 Arriving

A chatter's first message makes their resident, which climbs out of a hatch
onto a deck within about a second, with its name lettered. This is the same in every phase. If the city is landed, its preset takes
it down the ramp like anyone else's; if the horde is on the plate, the
turn-back rule keeps it aboard. It starts on the shipped preset, with a margin of 250, in issue
kit.

### 11.2 Going quiet

| The chatter last typed     | The resident                                                                                                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| under 20 minutes ago       | **Present.** First claim on a banner and a legend entry, and it can vote.                                                                                                                           |
| 20 minutes to 24 hours ago | **Away.** Runs its preset exactly as before, out on every landing.                                                                                                                                  |
| over 24 hours ago          | **Below.** It goes down the hatch the next time it is aboard, and is out of the picture and the simulation. Its levels, kit, locker, preset and params are kept, and any message brings it back up. |

An earlier draft of this plan kept a quiet resident out for 3 days and
aboard for 14. chat.md's 24 hours replaces that: at three days the berths
fill with residents whose chatters have gone.

**Berths.** chat.md's berth rule is written for a city of 150. Under this
plan the number is the hull's (section 5.2): 40 for Hull I, 150 for Hull VI.
When every berth is taken and someone is waiting at the hatch, the resident
aboard whose chatter has been quiet longest goes below, if that is more than
20 minutes. A present resident is never sent below. If everyone is present,
those waiting are counted beside the hatch and come up as berths open, or
together when the hull is rebuilt.

### 11.3 A newcomer's first cycle

1. **Arriving,** as above. The chatter did nothing but say hello.
2. **Out.** It has issue kit, three rations and the shipped preset. The
   preset keeps it within 30 tiles, where vermin of its own level die to one
   or two blows and come in sixes. It is cutting through packs inside its
   first minute. Its first bag is home in about 90 seconds.
3. **A find.** The near ground drops plain gear often enough that a first
   landing usually ends with something better than issue kit, and the
   preset's rule for comparing items puts it on.
4. **The horde.** Its margin is 250, so it is aboard early, and watches the
   gangway list with everyone else.
5. **The crossing.** Its `aboard` section takes the station shortest of
   hands. If the bell rings, its `alarm` section takes it to a post.
6. **The vote.** It has been through one lift, so it can vote on the next
   stop.

A resident whose total level is under the city's median earns experience at
double rate. The experience numbers (#317) are tuned so that a first landing
ends at Melee 5 or higher.

### 11.4 What chat.md leaves to this plan

**The phase lengths.** chat.md uses three phase names and leaves their
lengths here.

| chat.md's phase | In this plan                                                 | From                     | Length                                                                                                                              |
| --------------- | ------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| landing         | set-down and landed, until the horde's black is on the plate | 00:00 of the cycle       | 6 to 9 minutes: 6 at a lead of 0, 30 seconds more for each point of lead, a minute more on a clearing and a minute less in a valley |
| recall          | the horde on the plate, to the lift                          | 06:00 to 09:00           | 4 minutes unopposed, up to 9 with the front held; the lift is never after 15:00                                                     |
| transit         | the crossing                                                 | the lift, 10:00 to 15:00 | the rest of the 20 minutes: 5 to 10                                                                                                 |

A cycle is 12,000 ticks and set-down is at :00, :20 and :40 on the real
clock (section 4.1). `lift_eta` has no value during chat.md's landing phase
and a comparison on it is false, so "turn back" cannot fire before the
recall.

**A city with nobody awake.** Every resident is below when nobody has typed
for 24 hours. The city then walks on, dormant:

- it takes the first clearing offered, sets down, and is revealed;
- nothing wakes, since no resident is near any pack, and the horde crosses
  and the city lifts on time;
- it burns no fuel, its hold and lead stay as they were, and the vanguard
  does not board it;
- it earns nothing and builds nothing.

So a silent night costs a city nothing but the night, the stream still
shows a city walking, landing and leaving, and the first message brings
someone up through the hatch within two seconds into a city exactly as it
was left.

**A landing with under 15 residents.** Counts in section 5.3 are for a city
of 50.

| Residents awake | Monsters, nodes and the horde | Kills in ten seconds that stop a stretch of the front | Largest stop offered  | Vanguard                  |
| --------------- | ----------------------------- | ----------------------------------------------------: | --------------------- | ------------------------- |
| 1 to 5          | a quarter                     |                                                     2 | a glade               | a quarter, and no captain |
| 6 to 14         | half                          |                                                     3 | a vale                | half                      |
| 15 to 25        | half                          |                                                     5 | by country and Engine | half                      |
| 26 to 99        | by the cast, over 50          |                                                    10 | by country and Engine | by the cast               |
| 100 and over    | double                        |                                                    10 | by country and Engine | double                    |

Cores are not scaled: a clearing has none and a glade one, whoever lands
there. A core needs a carrier and one other to be worth going for, so a
city of one builds by materials alone, slowly, until a second person
speaks.

**The rest.**

| chat.md asks                                | This plan's answer                                                                                                                                                                            |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More chatters present than berths           | Those waiting are counted at the hatch and come up as berths open, or together at a rebuild. The first hull has 40.                                                                           |
| The price of running from a rival           | A crossing's fuel over again, and a point of lead (section 10.4).                                                                                                                             |
| How chat behaves at a contested landing     | As at any landing. The one new question is asked of the city that arrives first: which of the two berths, by number, for 30 seconds on the crossing.                                          |
| How chat behaves at a trade bridge          | The question when a rival is in reach has three options here: trade, board, run. A bridge is laid only if both vote trade. Flags may be planted on the other deck's places, as in a boarding. |
| The world map for the landing question (C9) | The route map opened on the plate (section 5.6).                                                                                                                                              |
| Where this plan differed                    | It now follows chat.md on arriving by the hatch in every phase, on present and below, on voting by number, on param tokens, and on `!me` for six seconds.                                     |

## 12. What the simulation and the viewer need

### 12.1 The cycle

The world gains a cycle clock: a tick's place in the 12,000, and the phase,
which changes at fixed ticks for set-down and by world state for the lift.
`hour` and `minute` go. The server's pacer starts a world so that tick 0 of
a cycle falls on a 20-minute mark of the real clock, and after a pause runs
up to a tenth fast until it is back on it. The simulation still never reads
a clock. A line from a chat username is an input, logged like any other: it
makes that chatter's resident if there is none, and marks it present.

### 12.2 Generated landings

A landing is a tile map made by a pure function of the continent's seed, the
stop's place on the route, the biome, the tier and the size, using the
seeded generator and integers only: ground from integer value noise cut into
the biome's terrains by a table in `content/biomes/`; one or two rivers or
ridges with fords and passes, so every bearing reaches the far edge; nodes,
packs and the prize placed by distance and by the size's counts in section
5.3; named places from syllable tables per biome; the city a third of the
way in from the edge away from the horde.

The generator's dials are data: sheet size, monsters, packs and their make
up, nodes, cores, rarity and the horde's size are one row per size class in
content, with a multiplier per country and per condition. Tuning difficulty
is editing that table.

A landing is not stored. A snapshot holds the seed and what has changed:
nodes worked, monsters killed, things on the ground. The map limits rise
from 30 by 21 to 192 by 108.

The viewer draws a landing with the pen it has, at tile sizes from 32 px
down to 10, so the ground needs levels of detail: a wash per terrain,
hatching for relief, marks standing for many trees, and the art bible's
figure sizes with smaller ones below them. The reveal draws the same ground
in order of distance from the city. `ground.ts` already draws from tiles;
the hand-made maps become four fixtures for tests.

### 12.3 The horde

World state: the side it comes from, the front as a distance for each
column or row of the landing, its pace, where it is being held, the lead, and
what it holds (items and cores). Its creatures are monsters on
programs, placed behind the front and woken as any placement is. Captains
are named actors that persist in the snapshot from cycle to cycle. Votes are
inputs, logged like any other.

### 12.4 The city

The city is a tile map built by a pure function of the module tiers: a
strip of tiles for each deck, three deep, with stairs between decks and the
rail along the top one.
Places on it (`hold`, `forge`, `galley`, `ramp`) work as places do today. On
a landing it sits a third of the way in from the edge, joined by
its ramps. On a
crossing the world is the deck and a skirt of 12 tiles round it. The
simulation does not know the ground is moving; the viewer scrolls it. The
city has hull hitpoints, legs with hitpoints each, guns that fire when
crewed, and districts that can be knocked out.

### 12.5 The frame

The frame is worked out from world state by a pure function the viewer and
the capture tool share. On a crossing it is the hull's. Landed, it is the
sheet. From the tick the horde's front is on the sheet it is the rectangle
from 6 tiles beyond the front to the city's far side, eased in at the other
edges to the residents outside with 8 tiles to spare, and never closer than
32 px a tile. The moves between are timed as section 5.1 has them. A test
runs it over seeded landings of every size at 3, 15 and 150 residents and
fails if any resident is ever outside it.

The city's map is rebuilt when the hull is: wider, with another deck, the
districts kept. Residents aboard at a rebuild are placed again at their
stations.

### 12.6 Tactics

Sections (`landing`, `aboard`, `alarm`), of which the phase
picks one, and `param`. New sensors: `since_setdown`, `lift_eta`,
`horde_eta`, `way_home`, `load`, `bearing`, `landing_size`, `bearing_crowd(b)`, `need(good)`,
`station_need(kind)`, `post_need(kind)`, `ally_down_distance`,
`core_distance`, `carrying_core`, `front_distance`, and for #332
`incoming`, `incoming_ticks`, `incoming_x`, `incoming_y`, `line_clear(x, y)`
and `cover_from(x, y)`. New actions:
`go_home`, `revive`, `take_core`, `drop_bag`, `shoot`, `throw`, `lob`,
`cut`, `roll`, `work(station)`,
`take_post(kind)`, `wear(best | spare)`, `pledge(module, n)`. `deposit` at
the hold pays tally. Every word is open to every program, and the limits of
63 rules and 2,000 steps stay.

### 12.7 The numbers that carry over

The formulas of the old plan stand: a base blow of `6 + L + L*L/20`,
hitpoints of `40 + 10*L + L*L/5`, monsters by level and rank (fodder, pack,
brute, elite, boss) with the gear factors counted in, experience per kill by
rank and level. A tier is a band of monster levels as before, and it now
belongs to a country and a distance from the city. Steps of 4 ticks, blows
of 2 + 3, eight directions and decisions every 2 ticks near an enemy are
#315's.

### 12.8 Cost at 150 residents

- **Placements.** A monster on a landing is a placement (kind, level, tile)
  until a resident comes within 24 tiles, when it becomes an actor with a
  program. It goes back to a placement when nobody has been within 32 tiles
  for 10 seconds. 1,500 placements cost nothing a tick and 6 bytes each in a
  snapshot.
- **A grid.** Actors are kept in cells of 16 by 16 tiles, and sensors, blows
  and blocking look at their own cell and the eight round it. This replaces
  the per-region lists #316 was to build.
- **Projectiles.** They have no program and no sensors, so one costs a
  move and a look at its own grid cell each tick. The bar below is met with
  300 in flight.
- **The way home.** A table of each tile's distance to the ramps, worked
  out at set-down. `way_home` and `go_home` read it. Other walks
  search at most 2,000 tiles and fall back on it.
- **The bar.** A mean tick of 4 ms and a worst of 25 ms, with 150 residents
  and 400 monsters awake, on a landing and in an assault.
- **The message.** Through M1 the viewer is sent the snapshot, about 80 KB a
  tick at 30 residents and 150 monsters awake, plus placements as
  they change. From M2 it is sent what the frame draws: every resident,
  the monsters awake in the frame at the fields a frame needs, about 170
  bytes each when the frame is close and 8 when it is wide, and a line a
  resident for the legend. The target is 40 KB a tick at 150 residents.

### 12.9 What carries over, changes and goes

| Item                                                                                                                                                                   | What happens to it                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The VM, the compiler, determinism, snapshots, adoption (#311), the server, the capture tool                                                                            | Carry over.                                                                                                                                                                                          |
| #315 fast time, #317 numbers that grow, #319 blows in the message, #320 hits in ink, #321 off the grid, #322 loot spill, #323 the mow sheet, #324 programs fight packs | Carry over as written. They are what the frame shows when it is close, and they have to read when it is wide.                                                                                        |
| #318 arcs and moves                                                                                                                                                    | Carries over as written.                                                                                                                                                                             |
| #332 projectiles and knockback                                                                                                                                         | Carries over, with one change: a resident's shot that meets another resident is spent and shoves them, and does no harm. Fights on landings and on the walls are built on it (sections 7.3 and 9.2). |
| #316 ranks and fodder                                                                                                                                                  | Carries over, with placements and the grid in place of budgets and per-region lists.                                                                                                                 |
| #330 and #298, wolves that hunt in packs                                                                                                                               | Carry over. Hunting packs are the horde's outrunners, and the wolf's program needs no change to do it.                                                                                               |
| #299 residents react: shout and answer                                                                                                                                 | Carries over. A call is how a downed resident and a core carrier get help.                                                                                                                           |
| #237 trips and death drops                                                                                                                                             | Changes: trips are sorties, the drop is the bag left where a resident fell, and the three trip programs become sortie programs with a margin.                                                        |
| #238 hauls on screen, #241 drops on screen                                                                                                                             | Carry over.                                                                                                                                                                                          |
| #240 drops and equipment                                                                                                                                               | Carries over, with the locker and `wear` added.                                                                                                                                                      |
| #245 the spotlight card                                                                                                                                                | Carries over.                                                                                                                                                                                        |
| #231 the compact page                                                                                                                                                  | Carries over as the rows; the page gains its phase layouts.                                                                                                                                          |
| #314 absolute verdicts                                                                                                                                                 | Carries over. The rubric is rewritten for a cycle.                                                                                                                                                   |
| #300 the hunt on screen                                                                                                                                                | Carries over, for the outrunners.                                                                                                                                                                    |
| #302 the day's reckoning                                                                                                                                               | Changes: it is the reckoning at the lift.                                                                                                                                                            |
| #301 the fire burns logs                                                                                                                                               | Goes. Fuel for the engine and the Lamps module do its job.                                                                                                                                           |
| #326 zoom out, #309 and #328 the region view, #288 regions polish                                                                                                      | Go. The one frame replaces them.                                                                                                                                                                     |
| #327 monsters in every region, #272 spreading residents, #232 tents                                                                                                    | Go. Biome rosters and bearings replace the first two.                                                                                                                                                |
| #250, #251, #296 the operator's umbrella issues                                                                                                                        | Close against this plan, with what each asked for and where it now is.                                                                                                                               |
| #294, #304 polish on figures                                                                                                                                           | Unchanged, with no milestone.                                                                                                                                                                        |
| The four maps, exits, the atlas of regions, the camp, the bank chest, the fire                                                                                         | Go. The hold replaces the bank and the galley the fire. The maps stay as test fixtures.                                                                                                              |
| The 24-minute day, the calendar, weather and its vote, works, charting, companies, the store, rings at 99, thirteen-week rounds                                        | Go. Site conditions, modules, pledges, the hold's prices and crossings do their jobs.                                                                                                                |
| The director's circuit of stops, its frame-time table and the promise of seconds on screen for each owner                                                              | Go. The one frame of section 5 holds every resident, so there is nothing to share out.                                                                                                               |
| Decisions 0003 (one frame, one map size), 0017 (regions), 0020 (the view follows the spotlight), 0022 and 0023 (the old plan)                                          | Superseded by 0028.                                                                                                                                                                                  |

## 13. The new M1 candidate

The smallest build that shows the breath: Hull I, which does not grow; one
biome in three sizes (clearing, glade, vale); a scripted crowd of 15
chatters; packs in formation; the horde; the winch; and the vanguard at the
walls. No modules and no vote: the city takes the three
sizes in turn, so an hour of capture has one of each.

At the end of it a viewer sees, in one picture that never cuts: a small
crowded city walking, with every resident at a station; the frame pull back
as it sets down, a little for a clearing and a long way for a vale, with the
land inked as it goes; 15 residents go out through packs that stand in
lines with shooters behind; bags come home to the hold; a black come onto
the far side of the plate and the frame begin to close; some residents
stand in front of it under the city's bolt throwers, and it stop; most get
aboard, and now and then one is winched in with its kit left in a heap; the
frame close onto the city as its legs unfold; and on the crossing the
vanguard throw hooks at the rail, with a captain in the kit that was left.

| Piece                           | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | After          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| W1 The cycle                    | The cycle clock and phases, set-down on the real clock, `since_setdown`. `hour` and the day go. A snapshot taken in each phase resumes to the same hash.                                                                                                                                                                                                                                                                                                                                                                                                                                           |                |
| W2 The hull and the cast        | The city as an actor with a name, two colours and a record, first in a list of cities, with a city id on everything that is its own. Hull I as a tile map in content: 24 tiles wide, two decks as strips with stairs between, the rail, hold, galley, infirmary, lockers, two ramps, two bolt throwers, six leg heads with barrels, 40 berths. `deposit` at the hold pays tally. The downed wake in the infirmary. The hatch residents arrive by. The cast itself is chat.md's C1, C2, C3 and C8 (inputs and the log, the scripted crowd, joining, quiet and berths), with berths set by the hull. | W1             |
| W3 Landings by size             | The generator for the heath as a clearing, a glade and a vale, from one table of dials in content (section 5.3): sheet, packs, nodes, cores, rarity. Ground, a river with fords, bearings, named places, the city a third of the way in. A stop's map comes from the continent's seed and its position alone, and a vale is laid out with a second place to park. The map limits rise.                                                                                                                                                                                                             |                |
| W4 Monsters on a landing        | Placements by distance, in packs that keep a formation (a line, shooters behind it), waking and sleeping, the grid for sensors and blows, and the tick measured at 150 residents and 400 awake. Takes over that part of #316.                                                                                                                                                                                                                                                                                                                                                                      | W3, #316, #332 |
| W5 Home, the lift and the winch | The way-home table, `way_home`, load, `go_home`. Downs outside, getting someone up, the 30-second haul. The lift: who is aboard; everyone else winched in, bag and worn kit left in a heap, issue kit. Takes over #237.                                                                                                                                                                                                                                                                                                                                                                            | W2, W3, #240   |
| W6 The horde                    | A horde belonging to a city: the far edge, the front, its pace, its size by the landing's, `horde_eta` and `lift_eta`, holding the front by killing it, its creatures a tier up with the best drops, outrunners, the lift when it reaches the lamps, the lead and what moves it, and the heaps it takes.                                                                                                                                                                                                                                                                                           | W4, #330       |
| W7 Sortie programs              | Three presets with sections and `margin` as a `param` (chat.md's C5): one that stays near, one that works a bearing with a bow, takes cover from incoming shots and keeps its own line clear, one that goes to the far edge for the prize and stands in the rearguard. Seeded tests that a margin of 100 is winched in more often than one of 250 and brings more home when it is not, that a rearguard delays the lift, and that the same program brings more home from a vale than a clearing and is winched in more often there.                                                                | W5, W6, #324   |
| W8 The crossing                 | The city and a skirt of ground as the world between landings, fuel burned, rations cooked and drawn, the next landing generated. The vanguard: boarding hooks thrown at the rail and cut, fodder up the legs and barrels rolled down them, boarders after crates, bolt throwers crewed, a captain in the best of what was left, posts and `post_need`, and the lead going up when it is beaten.                                                                                                                                                                                                    | W2, W5, W6     |
| W9 The breath                   | The frame of sections 5.1 and 12.5, fitted to a list of cities: tight on the hull, the reveal with the land inked as the frame reaches it, the whole landing held still, the close that follows the horde's front, the lift, and away. Figures at every tile size from 64 px down to 14. A test that no resident is ever outside the frame. `look`, with an art brief.                                                                                                                                                                                                                             | W3             |
| W10 The city drawn              | Hull I in cut-away to the art bible's section 7, with the stream's name on the keel plate and its colours on the mast, the bulwarks and its residents' sleeves: hull, legs, two uneven decks, the mast, stations shoulder to shoulder. The legs walking with the land sliding by, set-down and lift, the winch lines and the heaps, and the route map in its corner. `look`, with an art brief.                                                                                                                                                                                                    | W2, W9         |
| W11 The lettering by phase      | The cartouche with the landing's size, the legend by bearing, the gangway list, the reckoning, the hold's stock, berths and the lead, as plate furniture. Takes over #302 and #231's layout.                                                                                                                                                                                                                                                                                                                                                                                                       | #231, W5       |
| W12 Capture a cycle             | A storyboard of one cycle, the frame at the end of each reveal side by side for the three sizes, a burst of the last 30 seconds before a lift, the plate at each lift, and metrics: winched in a landing, seconds to spare, seconds the front was held, hauls by size of landing, the tile size by phase, residents outside the frame (which must be none), the flicker index over the reveal and the close. The rubric rewritten for a cycle.                                                                                                                                                     | W9             |

Beside these, the candidate needs the tempo chain that is already filed
(#315, #316, #317, #318, #319, #320, #324), #332 for projectiles and
knockback, #330, #231 and #240, and from chat.md's first slice C1, C2, C3,
C5 and C8, so that the cast is chatters from the start. W1, W3 and the tempo chain can start at once
and do not touch the same files.

**M1 is finished when:**

1. `docker compose up server client` shows the city, and a restart loses
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

## 14. Milestones after M1

Each is filed as at most twelve issues when the one before closes, and goes
through the fun test below first.

| Milestone                    | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                    | Finished when                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M2 Chat**                  | The rest of chat.md's first slice on the walking city: speech, the flag and `!go`, orders on screen, questions and the vote on the next stop drawn on the route map, moderation, choosing a preset, the streamer's site. More presets. The director's work moves to the server with the view message. Glades to valleys offered, and the valley generated.                                                                      | chat.md's judge plays a chatter through a landing and a crossing and can tell their preset and numbers made the difference. A scripted crowd of fifty chatters runs 216 cycles with no error, and the input log replays to the same hash. No resident is outside the frame in a valley.                                                    |
| **M3 The city grows**        | Modules and tiers, districts drawn by tier, cores and the core run, pledges and names on districts. Hulls II and III, with their berths and the list of names waiting. The vote on the next stop, drawn on the route map and the mast. Glades, vales and valleys offered by country and by the Engine. Site conditions, the hold's prices, damage and mending, the horde's numbers from what was left, the walker and the toll. | A city of 40 scripted chatters with 30 more waiting is rebuilt as Hull II with no other input, and those waiting board. A judge shown two crossings a day apart says what the city gained. A scripted crowd's choices of stop are reported with what each size cost and paid. No resident is outside the frame in a valley at 80 chatters. |
| **M4 The crossing**          | A continent of six countries, ten more biomes, feet and range, great landings every eight hours, strongholds and gates held against the horde, uniques, Hulls IV to VI, the atlas, the last stand and the end of a crossing.                                                                                                                                                                                                    | A scripted city crosses a continent headless and ends as Hull VI. The tick bar holds at 150 residents in a valley. A judge at 150 finds their resident within five seconds and stays for the lift.                                                                                                                                         |
| **M5 Players among players** | Boards for each landing and day (closest call, biggest haul, longest hold, most got up). Bands that go out under a banner. More presets, and weekly trials at fixed levels and kit. If the operator opens program writing to chatters, it is designed here. Filed when M4 closes.                                                                                                                                               | A trial's winning run replays tick for tick.                                                                                                                                                                                                                                                                                               |
| **M6 City against city**     | Rivals on the route map and three boards. Contested valleys: two cities and two hordes on one landing. Encounters on a crossing: a trade bridge, a boarding, a chase. A local chart service and meetings run in lockstep. Its section below has its own fun test.                                                                                                                                                               | Two local worlds on one seed contest a valley and fight a boarding with matching hashes throughout, and a meeting cut off at any tick leaves both cities whole.                                                                                                                                                                            |

### M6: City against city

**Aim.** A stream's city meets other streams' cities: on the map, on the
same valley, and rail to rail.

**The fun test, answered.**

1. _The cycle._ Another city's mark on the route map at every reckoning,
   and the board of the crossing. A contested valley about one landing in
   six for two cities in the same country: two cities revealed on one plate,
   two hordes, and one left alone on the field at the end. An encounter
   about one crossing in eight: a bridge, a boarding or a chase.
2. _The frame._ Every resident of this city inside it during a contested
   landing and an encounter, at 150 against 150, measured. The smallest tile
   size an encounter reaches is reported.
3. _A decision with a result._ The chat's stance when alongside, and each
   owner's margin on a rival's deck. Seeded tests: a city that votes to
   board a weaker one ends with more crates and one that boards a stronger
   one with fewer; a resident with a margin of 250 on a raid is never left
   on the other deck, and one at 100 sometimes is.
4. _Tomorrow._ Whose pennants hang from the mast, where the city stands on
   the three boards, and which rival took what from it overnight.
5. _Played._ Two judges play chatters of two cities through one contested
   valley and one boarding, on one machine with two scripted crowds. Each
   says who they thought was winning, when, and why. "I could not tell the
   cities apart" or "I did not know we had lost" is fixed before it closes.
6. _Size._ It adds a shared service and a second city in the world. It
   removes nothing, and it is the last milestone because it needs
   everything before it.

**Pieces.** The chart, run locally: registry, stop votes and arrival order,
pairing. Rivals on the route map and the three boards. The meeting world:
the cut, lockstep, hashes, the fallback to a draw, parting. Contested
valleys: two berths, two hordes, shoves between cities, the winner. The
encounter: the vote and pennants, the trade bridge, the boarding with the
`raid` section, the chase. Trophies on the mast. The frame for two cities.
Two scripted crowds and the capture of a meeting from both sides.

**Finished when.** Two local worlds on one seed contest a valley and fight
a boarding in lockstep with matching hashes throughout. A meeting cut off at
any tick leaves both cities whole. The tick bar holds with 150 residents a
side. The fun test above passes.

### The fun test

A milestone is filed only when its section answers these, and closes only
when a judge has checked them from captures.

1. **The cycle.** What someone watching sees in a cycle that they
   did not see before this milestone, with a rate. Anything rarer than once
   an hour is not a reason to watch.
2. **The frame.** No resident outside it, at 15, 50 and 150, measured, with
   the widest tile size reached. Anything the milestone adds is drawn inside
   the one picture.
3. **A decision with a result.** One new decision an owner makes, a seeded
   test that a different choice changes a measured outcome, and the result
   visible on the stream at the next landing.
4. **Tomorrow.** What is new after a night away.
5. **Played.** A fresh judge plays a chatter: says a line,
   changes something, leaves, comes back. "Nothing to do" or "I could not
   see what my change did" is fixed before the milestone closes.
6. **Size.** A milestone that adds a system says what it removes or shows
   the need.

## 15. Risks

- **A valley too small to enjoy.** In a valley a figure is 12 px tall and a
  melee fight is a few tiles of ink, for six to nine minutes. That smallness
  is how the landing says it is large, and shots help: a flight of arrows is
  a line a dozen tiles long. But if the judge cannot follow a valley, the
  largest size comes down to 14 px a tile, and the range between easy and
  hard narrows with it. M1 has vales, so it tests 14 px and not 10.
- **A still frame for eight minutes.** The landing is held wide and still,
  which is calm, and may be flat. The close at the end is the answer, and
  the judge is asked whether the middle of a vale holds attention.
- **A horde that can be held too well, or not at all.** If the rearguard
  always buys the full five minutes, the lift is at 15:00 every time and
  there is a countdown after all. If it buys nothing, nobody stands. M1's
  exit check asks for two minutes between the earliest and latest lift.
- **A chat that always picks the same size.** If valleys are simply better,
  nobody votes for a clearing, and the dial is wasted. The horde arriving
  sooner and larger, and kit lost at a higher rate, are meant to make a
  valley a real risk for a city not built for it. M3's long run reports
  what a scripted crowd chooses and what it costs.
- **Berths.** A stream with 300 people in chat starts a crossing with 40
  berths and a line at the ramp. The first rebuild has to come within hours,
  and the full-city rule has to feel fair to those waiting. If it does not,
  the first hull gets more berths before anything else changes.
- **Residents nobody is watching.** Someone who says one line and leaves has
  a
  resident out on landings for 24 hours.
  Present chatters come first for banners and legend entries, and the quiet
  give up their berth when the city is full. The 24-hour mark is the lever, and it is chat.md's.
- **A city of three.** A quiet stream has a handful of residents. Counts are
  halved for a small cast, but a rearguard of one may not be worth watching,
  and M1's captures at 3 chatters are the check.
- **Presets and two numbers.** For now a chatter's whole say is a preset, a
  margin, a stance and a flag. If that is too little to feel like playing,
  the answer is more presets and more params before anything else, and
  chat.md's judge is the check.
- **Being stripped by a program you did not write.** The shipped preset's margin of
  250 is what protects people who only said hello.
- **Telling figures apart.** At 12 px tall, colour is all there is. `!me`,
  banners and the gangway list are how an owner finds theirs, and every
  landing ends close.
- **Drawing a land in eight seconds.** Lines that wobble may crawl during
  the reveal, and a whole valley inked in one move may shimmer. The flicker
  index is taken over the reveal and the close in M1.
- **The clock.** A world that falls behind the real clock by more than the
  pacer can make up in a cycle skips to the next set-down. What happens to a
  landing cut short is settled in W1.
- **The reset.** Owners who do not care for seasons lose a month of levels
  and all but one item. It can be revisited before the first crossing ends,
  which is no sooner than M4.
- **Tick cost.** 400 monsters awake round 150 residents, with shots in
  flight, is more than anything measured. W4 measures it, and the fallback
  is fewer placements of higher rank.
- **Scope of M1.** Twelve new pieces and eleven filed ones. If it runs long,
  the captain in lost kit moves to M3 and M1 has two sizes of landing.

## 16. What is not planned

Deployment and hosting, which meetings between two streams' cities need, sound, mobile
layouts, trade between residents, more than 150 residents in a city, a second city for one stream, and
anything that would put a resident off screen or need a second view.
Everything about chat runs against a local chat page and a scripted crowd.
