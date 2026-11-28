# Idlin: design

This is what the game is meant to be. Almost none of it is built:
[roadmap.md](roadmap.md) says what exists, and [slice.md](slice.md) is the
spec for the first thing to be built, one full cycle of the city.

Idlin is a machine city that walks the world on legs, shown on a livestream.
The stream's chat lives on it: everyone who types has a citizen with their
name. Every thirteen minutes the city sets down somewhere new, the citizens
go out to fight and bring back what they find, and a horde arrives to drive
them off again. Nobody steers a citizen by hand. Each one runs a short
program, and its chatter sets that program's numbers from chat.

## Where this comes from

The operator's brief had four points:

1. A long-running idle RPG, built to be left running on a 24/7 livestream.
2. Everything that acts is a bot. Player characters and monsters both run
   programs in a constrained virtual machine, and monster behaviour is bot code
   shipped as content.
3. RuneScape-style progression (skills and levels) with Path of Exile-style
   items (loot that rolls affixes).
4. Fun to watch on a second screen, and fun for one watcher to optimise.

The first attempt was dropped because watching it was, in the operator's
words, "mindless whacking". The second, a camp beside a wood with regions
round it, is what the code is today. The operator's judgement of where it was
heading: no satisfying loop, and no answer to how a large number of players
share a finite screen while the world feels vast. Their answer is the one
this page is written round
([#331](https://github.com/nnamon/Idlin/issues/331)):

> instead of doing a typical open world wander around shit, why not have the
> world move around them? Since you wanted cycles, the game could be depicted
> all on one screen at different zoom levels for different phases of a
> massive machine city which crawls on spider like legs traversing the world.

And on what the loop has to deliver
([#361](https://github.com/nnamon/Idlin/issues/361)): "Itemisation and loot
are very important! Getting rare drops and feeling like the actions you do
have weight and the slog you go through is rewarding is key."

## The game

### One city, one screen

One streamer is one city. Every citizen of it is on screen all the time, and
the camera never cuts from one place to another. What changes is the zoom.
In transit the frame is close on the city, cut away so that every deck and
everyone on it shows. When the legs plant, the frame pulls back in one move
and the land is drawn outward from the hull. A small landing keeps the city
large and is easy. A large one makes the city small and is hard, so a viewer
can read the difficulty from the frame.

### The cycle

Transit, then a landing, then the horde. In transit the city is cramped and
busy: citizens look over what they own, work the bench, mend what is broken,
and now and then fight off something that comes alongside. On a landing they
pour down the ramp into packs and swarms. The horde comes in from one edge
of the map and crosses it, and when it reaches the hull the ramp goes up.
Whoever is still outside is hauled aboard without what they carried or wore.
There is no countdown on screen. The horde is the clock.

### Loot is the reason to go out

Items are a base, an item level, a rarity and affixes rolled in tiers, as in
Path of Exile. What this game adds is that a drop is not safe until it has
been carried up the ramp. The stream sees it fall and sees who has it on
their back. The best of it is far from the ramp, on ground as strong as the
city's strongest citizen, and late, near the horde, when the walk home is at
its worst. Uniques bend a rule of the game, so wearing one changes what its
citizen should be doing. There is no gold: the things that reroll and
improve gear are themselves drops, spent at a bench aboard.
[slice.md](slice.md), section 3, has the rates and the rules.

### A chatter and their citizen

Talking in chat is joining. A citizen runs one of a few programs the game
ships, and a chat command changes something that program reads: where its
flag is, how late it turns for home, what it bothers to pick up, what it
wears. The program still makes every decision, so two chatters who type the
same thing get different results, and that difference is the reason to care
about the numbers. A citizen keeps working while its chatter is away, plays
safe when nobody has typed for a while, and is put away after a day of
silence with everything it has. [chat.md](chat.md) is the design.

Citizens level as in RuneScape: each skill has its own level from 1 to 99
and goes up only by doing that thing. Levels and gear together decide a
fight, and both show on the figure.

### The streamer

The city's decisions (where to land, how much risk to take on, whether to
stand or run when raiders come) are the streamer's alone, made on a page
only they can open. Each has a default, so a city nobody is tending keeps
walking. Chat does not vote on anything.

### Other cities

Another streamer's city is the multiplayer this is built toward: a race for
a landing, a fight across gangways, gear lost to one horde turning up in
front of another city. None of it is designed yet. The single city is built
so that a second can meet it: one world server for each city, a deterministic
simulation that two servers can step together, and decks that are already a
battlefield.

### Everything runs a program

Citizens and monsters run on the same virtual machine with the same
interface. What differs is the body: which actions it has and what its
numbers are. Monster programs live in `content/monsters/` next to their
stats. For now only the programs the game ships are run; chatters writing
their own waits until the site has a login.

## Programs

Programs are written in a small language called Tactics, described in
[tactics.md](tactics.md). A program is an ordered list of rules, and on each
decision the first rule whose condition holds chooses the action.

This is the kind of program the design is aiming at. Most of the sensors and
actions in it don't exist yet:

```
bot "Deckhand"

param margin = 120 from 0 to 240
param over = 10 from 0 to 30

when danger_here > 0                       as "step out"  -> step_clear
when hp * 3 < max_hp and flask > 0         as "drink"     -> drink
when lift_eta < margin * 10 + way_home     as "turn back" -> go_home
when ground_level > arms + over            as "too deep"  -> go_home
when drop_distance <= 10                   as "my drop"   -> pick_up
when threat_distance <= weapon_reach       as "strike"    -> attack(threat_x, threat_y)
otherwise                                  as "look about" -> wander
```

A rule list was chosen because it can be read at a glance on a stream, the
rule in charge can be shown, and it's easy to start with. A `param` is a
number its chatter can set from chat: `margin` is how many seconds before
the horde reaches the hull it wants to be aboard, and `over` is how many
levels above its own it will fight.

The language compiles to bytecode for a stack machine with these limits:

- values are 32-bit integers;
- a fixed-size stack, and a few memory slots that persist between decisions
  so a bot can remember a target, a plan or a counter;
- a fixed number of instructions per decision;
- sensors only read the world;
- one action per decision;
- no allocation, no I/O, nothing outside the interface.

A character is only asked for a decision when it has nothing left to do, not
every tick, so actions take time and the picture stays calm.

## How the world works

- The simulation is a pure function of seed, content and inputs. It advances in
  fixed ticks (10 a second), uses only integers and a seeded random number
  generator, and never reads the clock. The same inputs always give the same
  world. That is what makes replays, captures and before/after comparisons
  possible.
- The world is a grid of tiles. Actors stand on tiles and move from one to the
  next; the viewer smooths the movement.
- A server runs the world in real time, saves snapshots so it survives
  restarts, and streams the world to viewers. The viewer only draws. (For
  captures it still runs the simulation itself, from a seed.)
- Content (maps, monsters, items, affixes, skills, programs) is data in the
  repo and is validated when loaded.

## Look

This section describes what is drawn today, which is the camp the code still
runs: a fixed map with a fire, a lantern, four regions, and a day and night.
The city, the landings and the zoom are not drawn yet. [art.md](art.md) is
the standard new drawing is held to, and says which of this meets it; the
look target ([#362](https://github.com/nnamon/Idlin/issues/362)) is the
first drawing of the city.

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

The fight is read off the whole world and the tick's blows, which the viewer
is sent with it, since what a blow takes off depends on a crit roll the viewer
cannot make. Walking through an exit is a step like any other, so someone who walks off the map is not taken for killed or
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

## Not planned yet

Deployment and hosting, sound, mobile layouts, trading between citizens, and
programs written by chatters.
