# Idlin: design

This is what the game is meant to be. Most of it isn't built yet: what runs
today is a camp, four hand-made regions and a day and night cycle, which this
design replaces. [roadmap.md](roadmap.md) says what exists and what comes
next, [plan.md](plan.md) has the rules, the numbers and the order of
work, and [chat.md](chat.md) is the design for how a stream's chat joins
and commands its citizens.

Idlin is a city that walks, with a horde behind it. The city is a machine on
legs, with up to 150 residents living on its deck. Nobody controls a
resident directly: each one runs a short program its owner wrote or tuned.
Every 20 minutes the city sets down, the picture pulls back from the
crowded city to the land it has reached, and the residents go out into it.
Then the horde arrives, the picture closes in again, the city leaves, and
whoever is still outside is pulled back aboard without what they carried.
Every resident is on screen the whole time. The game runs
unattended on a stream. People watch, and anyone who says a word in chat has a resident with their
name on it.

## Where this comes from

The operator's brief had four points:

1. A long-running idle RPG, built to be left running on a 24/7 livestream.
2. Everything that acts is a bot. Player characters and monsters both run
   programs in a constrained virtual machine, and monster behaviour is bot
   code shipped as content.
3. RuneScape-style progression (skills and levels) with Path of Exile-style
   items (loot that rolls affixes).
4. Fun to watch on a second screen, and fun for one watcher to optimise.

Two designs have been dropped on the way here. The first was dropped because
watching it was, in the operator's words, "mindless whacking": characters
stood at a resource and swung until a number went up. The second was a camp
with regions round it, a calendar and a list of milestones. The operator
read it and found "no satisfying game loops, no thought to how to
intelligently depict a large amount of players in a finite screen and have
the world feel full and vast at the same time"
([#331](https://github.com/nnamon/Idlin/issues/331)). They proposed the
walking city in the same message: have the world move round the players, in
cycles of travel and landing, with a deadline to get back. The conductor
added five ideas of its own. Four are in this design and one was rejected;
[plan.md](plan.md), section 2, says what was done with each.

## Design choices

### One breath a cycle

The operator's reason for the cycle and the zoom: "It gives dynamism like a
cosy feel when travelling in a slightly cramped machine city (which we can
consider allowing upgrades and expansions over time). Then on landing, the
zoom can expand to a massive valley rich with enemies and resources to farm
or a small clearing like we have now with fewer things but easier."

So the zoom is the pacing.

- **In.** On a crossing the frame is tight on the city. It is small and
  crowded, figures are at their largest, and everyone is close. It is home.
- **Out.** At set-down the frame pulls back, and the land is inked outward
  from the city as it goes. How far it pulls back is how hard and how rich
  the landing is. A clearing leaves the city a third of the picture: a few
  packs, an easy haul, little to lose. A valley leaves it an eighth: eight
  times the monsters, twice the gathering, two cores, a larger horde, and
  nearly a minute's walk from the far side to the ramp.
- **In again.** The horde comes onto the far side of the plate and the frame
  closes at its pace, with the horde as its edge. Every landing ends close:
  the city, the ramp, the last runners and the black.

Landings are generated, in four sizes, from a table of dials: size, how many
packs, how rich. The dials are turned by country, by what the city has
built, and by each stop's condition.

Where to go next is the chat's choice, made on the crossing where everyone
can see it. The route map opens with the three stops ahead drawn to scale
beside the city, each under its weather, and a vote in chat hoists that
stop's pennant up the city's mast.

The city's size is what its chat builds together. It starts as a hull 24
tiles wide with berths for 40, and is rebuilt five times, to 40 tiles and
150 berths. Each rebuild fits more chatters and widens the frame it is seen
in on a crossing, so over a month home goes from a crowded boat to a walking
town.

### One loop, starting on the real clock

The city sets down at :00, :20 and :40 past every hour. It stays for 10 to
15 minutes and spends the rest of the 20 walking to the next site.

A stream needs something a viewer can understand in seconds and come back
for. Someone who has watched once knows that a new land starts at each of
those minutes, and that it ends with a run for the ramp.

### The horde is the clock

There is no countdown. Some minutes into a landing a blot appears at one
edge of the map and spreads toward the city. The city lifts its ramps when
the horde reaches its lamps.

How long a landing lasts is earned. The horde's distance behind the city,
the lead, grows when the city beats off the horde's vanguard on the way and
keeps its legs whole, and shrinks when it runs short of fuel or slows down.
On the landing itself, residents who stand in front of the horde and kill
its front stop that stretch of it for seconds at a time, which is time for
everyone still out. The horde's creatures are also the best paying on the
plate. The operator kept the horde because "it rewards strong players who
can hold out and gather more loot", and those two rules are how.

It is the same horde for the whole crossing of a continent. It keeps what it
takes.

### The whole language, for every program

Every sensor and action in Tactics is open to every program. Nothing in the
language is unlocked, found or bought. An earlier draft made the language's
words into loot, and the operator turned that down: it cripples the program
writing the game is built on.

For now programs are presets the game ships. A chatter chooses one and sets
its numbers by typing, and a command in chat never moves a resident: it
changes something the program reads. What a resident gains with time is
levels and gear.

### Missing the city

A resident outside when the ramps lift is hauled aboard by a winch line. Its
bag and everything it was wearing stay on the ground in a heap. Levels are
kept, and four items in a locker aboard are safe. It is handed plain kit and
goes out again at the next landing.

How close to cut it is the owner's choice, as one number in the program: the
margin. A resident with a margin of 250 is home early every time with a
smaller haul. One with a margin of 100 brings back more and loses everything
one landing in four.

The horde walks over the heaps. Its captains wear the best of what was left,
and come over the city's rail in it on the next crossing. Whoever kills one
keeps what it wore.

Nobody is left behind anywhere. An earlier draft had the stranded walk after
the city in a window of their own, and the operator turned it down, for the
reason in the next section.

### One streamer, one city

A stream is a city, and its chat is the city's people. The city carries the
stream's name on its hull and the stream's two colours on its mast, its
bulwarks and its residents' sleeves. Its districts are the ones its chat
chose to build, so two cities of the same rating look different. Its record
is drawn on it: a rival's pennant under its own for each city it has
beaten, and a notch on the keel for each gate forced.

Later, cities compete. Every city in a crossing walks the same continent on
the same clock, so they can be compared, by size, by how deep they have got
and by rivals beaten, and they can meet.

- **On a landing.** Two cities that vote for the same rich valley race for
  it. The faster walker is first down and takes the better ground. Both farm
  the same land, each with its own horde on the horizon, and the city that
  holds out longest is left alone with what remains.
- **On a crossing.** Two cities come alongside for three minutes. Each chat
  votes: lay a trade bridge, board, or run. A boarding is bolt throwers and
  catapults across the gap, hooks over the rail, and each city's people
  after the other's crates. The defenders are the other stream's chat and
  their programs, so city against city is chat against chat.

Each city runs on its own server. A small shared service holds the map and
arranges meetings, and a meeting is one world that both servers compute in
step, which the simulation's determinism makes possible. This is built last,
after one city works. What it needs from the start is small and is built
from the start: everything in the world belongs to a city, a stop is the
same place for whoever lands there, and every city sets down on the same
minutes. [plan.md](plan.md), section 10, has it.

### The cast is the chat

One chatter is one player. Anyone who writes a line in the stream's chat has
a resident from that moment, named by their chat username. There is no
command to join, nothing to claim, and no resident that belongs to nobody.
A new chatter's resident climbs out of a hatch onto a deck within about a
second, whatever the city is doing.

The city grows and shrinks with the chat. A resident whose chatter goes
quiet carries on with its program for a day, then goes below with
everything it has, and a line in chat brings it back up. The hull's berths
are how many the city holds.

Threats come from the world: the horde and what is met on the way, and
later other streams' cities.

### Everyone is on screen, always

Every resident is in the picture all the time. There is one frame. It never
cuts, and there is no second window. That is why the world moves and the
city does not.

On a crossing everyone is aboard and the frame is the city in cut-away, with
the near wall left off its decks. Landed, the frame is the whole landing,
which is generated to fit it. As the horde crosses, the frame is fitted to
the city, the residents still out and the horde's front. Nobody needs a
share of screen time, because nobody is ever off it. [art.md](art.md) says
how it is drawn.

### Fights are fast, wide and physical

A resident at its own tier kills the weakest monsters in one blow, and they
come in dozens: a landing holds hundreds of monsters in packs, one every few
seconds of walking. Blows cover an arc or a line, land within half a second,
and leave ink on the ground. This is the tempo work of #315 to #324.

Things fly. Arrows, thrown spears, sling stones, lobbed firepots and rolling
boulders are objects in the world with a path that can be stepped off or
blocked by a rock (#332). A hard hit moves the body it lands on, into other
bodies, into walls, into the river or off the city's rail, and that hurts.
Packs stand in formation, with a line in front and shooters behind it, so a
fight is a problem with several answers: through the line, round it, over
it, or turning its shooters on its own front.

Stronger monsters wind up, and the ground they are about to hit is hatched
for a moment. Programs can read a blow or a shot that is on its way, so
whether a resident steps out, takes cover or wastes an arrow on a friend's
back depends on its program.

On a crossing the same fight is turned on its side. The horde's vanguard
throws boarding hooks at the rail and climbs the legs, and the city answers
with bolt throwers, catapults, barrels rolled down the legs, and a line at
the rail that shoves boarders back over it.

### Show what a character is doing and why

Someone glancing at the stream should be able to tell what a resident is
doing. The line under each name on the page is built from the resident's
state by one function, never from labels its program's author wrote: what it
is doing, to what or where, then at most one number. While the horde is on
the plate the page lists everyone still outside with the seconds each has to
spare.

A program that hits an error doesn't break anything. The resident stands
there confused for a few seconds and tries again, and the stream shows that
too.

### The city is everyone's

Wood, fish, ore and monster parts put in the hold belong to the city, and
the resident is paid tally for them at a price that rises when the city is
short. The hold feeds the engine, the galley, the forge and the guns. Gear
that drops is the finder's.

The city grows by cores, and its growth is the long game everyone shares. Each landing has one prize, and its core has to be
carried home by a resident who can then carry nothing else and walks at two
thirds pace. Cores build the city's modules: legs, engine, plating, guns,
lamps, hold, forge, galley, infirmary, lookout. Legs and engine decide which
ground the city can cross and how far it can choose, and its rating decides
which gate it can force into the next country and when the hull is rebuilt
a size larger.

### Skills and loot

Skills work as in RuneScape: each has its own level from 1 to 99 on an
exponential curve and only goes up by doing that thing. Gathering feeds the city:
logs are fuel, fish are the rations a resident eats outside, ore is plate,
shot and blades.

Items work as in Path of Exile: a base type, an item level, a rarity
(normal, magic, rare, unique) and affixes rolled from tiered pools. What a resident wears outside is at
risk, and what the horde takes, its captains wear.

A crossing of the continent takes about four weeks, through six countries of
rising tier. At the far coast it ends: the city's record and atlas are
written down, a new continent is generated, and skills start again at 1. A
resident keeps its name, its look, its lifetime levels and one item.

### Everything runs a program

Residents, monsters and the horde run on the same virtual machine with the
same interface. What differs is the body: which actions it has and what its
numbers are. Monster programs live in `content/monsters/` next to their
stats.

## Programs

Programs are written in a small language called Tactics, described in
[tactics.md](tactics.md). A program is an ordered list of rules, and on each
decision the first rule whose condition holds chooses the action.

This is the kind of program the design is aiming at. Most of the sensors
and actions in it don't exist yet:

```
bot "Woodcutter"

param margin = 180

section landing
when hp < 40%                            -> eat
when danger_here                         -> step_clear
when lift_eta * 100 < way_home * margin  -> go_home
when bag_free == 0                       -> go_home; deposit
when threat_count >= 4 and ready(whirl)  -> whirl
when call_distance < 6
     and lift_eta > way_home * 3         -> revive
when node_distance(tree) < 9999          -> walk_to(node(tree)); chop
otherwise                                -> walk_to(frontier); chop

section aboard
otherwise                                -> work(most_needed)

section alarm
when hp < 30%                            -> walk_to(infirmary)
otherwise                                -> work(post_most_needed)


```

A rule list was chosen because it can be read at a glance on a stream, the
rule in charge can be shown, and it's easy to start with. Most owners will
only move a slider such as `margin`, and that has to be a real way to play.
Others improve a program by reordering rules, changing thresholds and adding
cases.

The language compiles to bytecode for a stack machine with these limits:

- values are 32-bit integers;
- a fixed-size stack, and a few memory slots that persist between decisions
  so a bot can remember a target, a plan or a counter;
- a fixed number of instructions per decision;
- sensors only read the world;
- one action per decision;
- no allocation, no I/O, nothing outside the interface.

A character is only asked for a decision when it has nothing left to do, not
every tick.

## How the world works

- The simulation is a pure function of seed, content and inputs. It advances
  in fixed ticks (10 a second), uses only integers and a seeded random
  number generator, and never reads the clock. The same inputs always give
  the same world. That is what makes replays, captures and before/after
  comparisons possible. A site's map is generated by the same rule, so a
  seed and a place on the world map always give the same land. A line in
  chat and a vote are inputs, logged like any other.
- The world is a grid of tiles. Actors stand on tiles and move from one to
  the next; the viewer smooths the movement. The city's deck is a tile map
  like any other.
- A cycle is 12,000 ticks. The server runs the world in real time and keeps
  set-down on the real clock, saves snapshots so it survives restarts, and
  streams the world to viewers. The viewer only draws. (For captures it
  still runs the simulation itself, from a seed.)
- Content (biomes, monsters, items, affixes, skills, programs, the
  city's modules) is data in the repo and is validated when loaded.

## Look

This section describes what is drawn today. [art.md](art.md) is the standard
new drawing is held to, and says which of this meets it.

Everything from here to the end of this section describes the viewer as it
is built today, on the camp and its four regions. The pen, the figures, the
effects, the fights and the lamplight at night carry over to the walking
city as they are. The passages about regions, the camp fire and the hours of
the game day describe what the viewer does now, and go when the work in
[plan.md](plan.md), section 13, replaces them.

The stream is drawn as a map, in the style of the maps printed in old books.
The ground is cream paper, the land is drawn in sepia ink with thin watercolour
washes under it, and place names are lettered on it. There are no image
assets: the map, the trees, the tents and the characters are drawn by code,
with lines that wobble slightly. Adding a monster or a place means writing a
drawing routine for it.

Characters are small hooded figures. The colours of the hood and the cloak are
what tell them apart, so they are also how a viewer finds their own. A figure that
has a while to wait sits down, sinking over a few ticks rather than dropping
at once, and gets up the same way.

Each figure is drawn from a sheet of parts (`packages/client/src/looks.ts`,
drawn by `figure.ts`). From its id a resident gets a hood shape (point, round,
brim or cowl), a cloak pattern in its hood colour (plain, band, stripe or
check), one of 24 marks, shown on its cloak and after its name on the page,
and a way of sitting to rest (upright, leaning back, hunched, or knees drawn
up). The first 16 residents have all 16 pairs of hood and pattern. From its
levels it gets its kit and its walk. The trade at its highest level (Melee,
Woodcutting, Fishing or Cooking) puts a tool over its back shoulder, with a
tier at levels 1, 20, 40, 60 and 80: hatchet, felling axe, double-bit; a rod
that gets longer, with a float on the longest; cudgel, sword, sword and shield;
ladle, pan, pot. At 60 a pennant is tied to the tool, and at 80 it becomes a
long swallowtail. Someone with every trade still at level 1 carries a staff, a
pack or nothing, by id. A newcomer bobs on short steps; as the total of its
levels nears 200 it walks lower, leaning into a longer stride, easing into the
lean as it sets off and out of it as it stops, and standing upright while it
waits for the way ahead to clear. The hat is how far along a resident is:
every hood shape's top is 43 units above the feet on a newcomer, and the
cowl's peak, the round hood's cap, the point and the hat's crown all rise to
the same height for the same total of every level, up to 15 units at 99 in all
five skills, so the tallest hat still fits its row on the page. It rises on a
log scale, about 5 units by a total of 28 and 8 by 57, so the first levels
show, and never goes down, so a taller hat always means more levels whatever
its shape. A newcomer's point trails back behind its head and stands up as it
grows. The hat also gets a band in the paper's colour at totals of 20, 50,
100 and 200, the same on every shape. The tool says which trade. What differs
sits above or outside the outline so that it still reads on a figure about 13
pixels tall in a 640-wide window, and a name slip sits above the figure's own
top. The world counts how often each resident has been struck down (`deaths`
on the actor, kept in snapshots since version 8), and the cloak wears a
stitched patch of paper for each, up to five: on the front and back edges by
the hem, the middle of the hem, then higher up the front and back edges. Each
sits across the outline, so it shows as a light notch in the silhouette at 640
wide.

Small effects show what the residents are doing. Each is read off the world
once a tick, from how an actor changed since the last one, and drawn from that
and the time alone, with no randomness of its own; they are pen strokes,
never fills, and come in and go out over at least three ticks
(`packages/client/src/effects.ts`, drawn by `marks.ts`). A figure setting off
or pulling up leans back over three ticks, snaps forward in one and settles
upright over three. For residents with a name slip there are two more, and
both fade with the slip. When the rule in charge changes, a glyph about 28
pixels across appears on a tab of the slip's paper to the left of the name: two
footprints for a walk, a tent for a walk that ends within five steps of camp, a
new moon for a rest, a question mark when the program faulted. It comes in
over one tick, stays at full ink and fades over the last four of its 16 ticks.
When a walk starts, a dashed line in the walker's cloak colour runs from its
feet along the whole of what is left of its path, through the middle of each
tile (so over a bridge's deck), to a small cross where the walk ends. The route
goes all the way to the destination so a viewer can see where a resident is
going, not only which way it set off. It wobbles like the map's own lines,
seeded by the resident and the destination so it holds still from frame to
frame, and routes drawn at the same time each take their own lane, a few
pixels apart, so two on one path stay two lines. It breaks around place names
and slips. The walker uses it up as it goes; after 14 ticks what is left is
taken up from the walker's end over 10 more, and once the line is gone, or the
walk ends, the cross fades over three ticks. After a gap in the ticks, as when
a live viewer reconnects, or after the world goes back in time, nothing starts
from the change across the gap.

Fights are drawn the same way, read off the world once a tick
(`packages/client/src/fight.ts`, drawn by `marks.ts` and `beasts.ts`). The
viewer is sent no events, so a blow is worked out from the marked tiles: it
lands at the tick its attacker's wind-up runs out, on every enemy that stood on
one of its tiles. Wolves and goblins are drawn in ink over a grey or olive
wash, and carry no light at night. They have no name slip and are not listed
on the page. A tile about to be struck fills with diagonal hatching in a
red-brown used for nothing else, a stroke at a time, so how full it is says how
soon the blow lands; once it lands the hatching fades over three ticks. The
attacker leans back 3 pixels over the wind-up, lunges 6 pixels forward in one
tick, holds a moment and comes back over four. A figure hit slides 4 pixels
away from the blow and squashes for as long, three ink flecks fly off it, and
the hitpoints it lost rise 16 pixels as a number beside it, clear of its name
slip, and fade within two seconds. Each blow has its own number; a number on
a spot where another is still rising goes on the other side of the figure,
and a third and fourth a row higher. A figure that hops off a marked tile kicks up dust, and a blow that
lands on nobody leaves a scratch on the tile for three seconds. Under a figure
or monster that is hurt, or has fought in the last five seconds, a ring on the
ground shows its hitpoints: a faint whole ring, and a firm stroke from the
front round both sides for the share left, easing to each new value. Below 30%
of its hitpoints a figure stoops, its step shortens and the hem of its cloak
is torn. A monster killed sinks into a blot of ink over half a second, and the
blot stays a minute. A resident downed topples over where it stood and lies
there for three seconds, then fades, and fades in at camp as it does; where it
lay, a pale wash of its cloak inside a broken outline stays a minute. On the
page its line reads "downed by a wolf at the river" while it lies there, then
"mending at camp · up at 12:20" while it rests. A monster going home fades where
it was. The news line carries events only, never what a program decided:
kills, downs, blows that leave a resident under 30%, a resident starting a
fight or starting to run. Each stays up for at least four seconds; a resident
downed goes up at once. News of what someone is doing ("Dara is running from
2 wolves, 9 tiles to camp") follows their page line while it is up and comes
down, or is dropped from the queue, once they stop. The kill goes to the last blow that landed, as in the
simulation. Name slips keep clear of monsters, as they do of the fire.

The line under each resident's name on the page is built from its state by
one function (`packages/client/src/line.ts`), never from its program's rule
names: what it is doing, to what or where, then at most one number, as
`<doing> <object or place> · <number>`. Walking is "walking to the river", or
"walking near the meadow" when no named place is within 4 tiles of where the
walk ends; a walk out of camp with an empty bag shows `bag 0/12`. A walk that
began with a monster within 8 tiles and ends at least two tiles farther from
it is "running from 2 wolves · 9 tiles to camp", for as long as a monster is
still within 8 tiles. Within 4 tiles of a monster, winding up a blow or in a
fight in the last five seconds, it is "fighting a wolf · wolf 16/24"
("nearest 16/24" for several). A monster within 8 tiles walking towards it is
"followed by a wolf · 5 tiles"; walking towards one is "walking towards a
wolf · 3 tiles". Standing still is "resting at the river", or "asleep at
camp" at night. A program fault is "stopped · program error". A row keeps its
words for at least two seconds, except a change to downed or into a fight,
and its number follows the world meanwhile. A line about a monster is not
kept once no monster is within 8 tiles, so it never shows a dead wolf's
hitpoints. A resident in another region reads "in the Pinewood · walking".
Lines for gathering, banking, cooking and drops wait for those to exist.

A line of news comes down after ten seconds if nothing has come after it.
With no news up, the news line tells of one resident the page does not list,
five seconds each in turn, with the same line: "Tim is walking to the river,
bag 0/12". With every resident listed it goes round all of them. The resident
it names has a claim to a name slip, as anyone in the news does.

The fight is read off the whole world, where walking through an exit is a step
like any other, so someone who walks off the map is not taken for killed or
downed. The regions lie side by side as one plane, so a blot left in the
pinewood is there when the map pans to the pinewood. The page and the news
line cover every resident, so one downed in another region is on the news,
its line reads "downed", and it fades in at camp.

A few things move while no one does: the river's ripples drift downstream, a
line of smoke, as heavy as the grass ticks and thinning as it goes, rises
from the camp fire and leans east, and the tops of the trees lean a little in
a slow breeze from the west.

At night the same drawing is shown in pale ink on dark blue paper. Day and
night are two separate drawings, and a frame that is half one and half the
other looks broken, so the change between them is quick (a bit over half a
minute). At nightfall the dark closes in on the lantern from the edges of the
map; at daybreak the light spreads back out from it. For that half minute
there is a soft band, about 260 pixels wide, where both drawings show. The
rest of the time the hour shows in the colour of the light on the map,
which shifts slowly: rose around dawn, a cool blue-grey through the
morning, amber towards dusk. The colour lies on the day drawing only, so
the night closing in stays blue. The page takes it at half the map's
strength, under its lettering, so at 08:00 it is a cool cream beside the
cool map. The
page names the part of the day, and says night from the moment its ink
turns.

At night each lamp shows the daytime drawing inside its reach: the lantern, the
fire, and the small light every character carries. A carried light shows
only a little of the day drawing over the river, so the water takes the
lamplight's amber instead of turning pale. Names and place labels are
drawn last, each wholly in day ink or wholly in night ink depending on the
light where it sits, so they don't fade out at the edge of a lamp. A name's
slip is always light paper with dark lettering; at night the paper is the
pale of the night ink. The residents on the page have pale, warm faces at
night, a shade darker than their outline, with a dark eye, close to the
faces in lamplight on the map.
Name slips keep clear of place labels, the fire and the lantern along the
whole way to the next tick, since a slip follows its figure between ticks. A
name that has to move aside for another figure gets a short stroke back to
its owner.

The frame is designed for 16:9, which is what a stream shows. The map is on
the left. On the right is a page with the clock and the residents, each with
the rule its program is following. Along the bottom is one line saying what a
program last decided. In a window of another shape the frame fills the window
instead of leaving a bar: a wider one gets the map at full height and a wider
page with the line of news on it, and one much taller than 16:9 (about
6:5 or narrower) gets the page below the map, with the map centred over
it and any spare height shared between the rows and the margins. The page and
the bottom line don't take part in the moving edge: they change between day
and night in one go, over about three seconds, halfway through the turn. In
those seconds the paper goes from cream to blue, and the lettering stays in
whichever of the two inks reads better on it, so it switches once, when the
paper is halfway, and never drops below 3:1 contrast. Beside the map, the
5-pixel margin of paper outside the map's rule turns with the page. With the
page below the map, the paper either side of the map is part of the map for
this: it darkens with the map. The map's double rule sits on the
map's own edge in every layout. The typeface is IM Fell English.

## One player among many

Everyone watches the same stream, and nobody can point it. A city holds up
to 150 residents, and every one of them is in the frame all the time. What
is left for an owner is to know which is theirs and how it did.
[plan.md](plan.md), sections 5 and 6, has the rules; in short:

1. **Finding your resident.** Each has a hood and cloak pair of its own, and
   `!me` in chat rings it and letters its name for six seconds, at any
   zoom. Residents in the news, in a fight or in the legend get a banner,
   those of people chatting now first.
2. **The gangway list.** While the horde is on the plate, everyone still out
   is listed with their seconds to spare.
3. **A result of your own.** The reckoning at each lift names the biggest
   haul, the closest call and the worst loss, and boards rank single
   landings, so someone new with a good margin can top one on their first
   day.

Chatters steer through chat alone for now: there is no page or editor for
them.

Whether a figure twelve pixels tall can be told from 149 others is not
known, and M1's captures are the first check.

## What a viewer can do

Today, only watch. With M1: say anything in chat and have a resident. With
M2: send it somewhere, set its margin and stance, choose its preset, and
vote on where the city goes next, all by typing. With M3: pledge to the
district being built.

## Not planned

Deployment and hosting, sound, mobile layouts, trade between residents, and
hosting the shared service that lets two streams' cities meet. City against
city is designed, in [plan.md](plan.md), section 10, and is the last
milestone; it is built and tested with two cities on one machine.
