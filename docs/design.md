# Idlin: design

This is what the game is meant to be. Most of it isn't built yet;
[roadmap.md](roadmap.md) says what exists and what comes next.

Idlin is a small camp around a lantern, next to a wood that gets dangerous at
night. A handful of adventurers live there. Nobody controls them directly: each
one runs a short program. The game runs unattended on a stream. People watch,
and anyone who wants to can write the program for one of the adventurers.

## Where this comes from

The operator's brief had four points:

1. A long-running idle RPG, built to be left running on a 24/7 livestream.
2. Everything that acts is a bot. Player characters and monsters both run
   programs in a constrained virtual machine, and monster behaviour is bot code
   shipped as content.
3. RuneScape-style progression (skills and levels) with Path of Exile-style
   items (loot that rolls affixes).
4. Fun to watch on a second screen, and fun for one watcher to optimise.

The previous attempt was dropped because watching it was, in the operator's
words, "mindless whacking". Characters stood at a resource and swung until a
number went up. Nothing on screen was a decision, so there was nothing to
follow, and better art would not have helped. Most of the choices below are
there to make what a character does look like a choice that has a result.

## Design choices

### Show what a character is doing and why

Someone glancing at the stream for a few seconds should be able to tell what a
character is doing, and roughly why.

- A character's program is a short list of rules. The rule currently in charge
  is shown on the page beside the map, under the character's name. This part is built.
  So are its hitpoints, at the end of the name's line, and a line under the rule
  with its level in each skill, each behind a small mark (sword, heart, hatchet,
  fish, pot).
- Monster attacks will be telegraphed: the monster winds up, and the tiles it
  is about to hit are marked for a moment. Whether the adventurer steps out of
  the way depends on its program, so a fight is a series of small decisions
  that visibly work or don't.
- A program that hits an error doesn't break anything. The character stands
  there confused for a few seconds and tries again, and the stream shows that
  too.

### Play happens in trips

Characters shouldn't stand at one tree all day. The intended loop is: leave
camp with food, work or fight further out, come under pressure (the bag fills,
the food runs low, it gets dark), walk home, bank and cook and re-equip, go
out again.

Each trip ends in something worth a line on the stream: what was brought home,
a level gained, a close call, a death. Dying drops whatever hasn't been banked
at the spot where the character fell. It stays there for a while and the
character can go back for it. A character that doesn't get back in time
loses it.

### Day and night

A game day takes 24 real minutes, so a game hour is one minute and the on-screen
clock is easy to follow. By day the near wood is fairly safe. At dusk the
lantern is lit. At night stronger monsters come out of the deep wood, with
better loot.

The point is the decision at dusk: every program has to choose between going
home and risking what it carries. Regular viewers also learn when the
dangerous part of the day comes.

### One fixed frame

The whole world fits in one frame and the camera doesn't cut between
characters. (If the population outgrows one frame, see "One player on a busy
stream" below.) A panel beside the map will spotlight one character at a time,
changing slowly and preferring whoever something is happening to.

Feedback is small and local: a hop, a lunge, a number that floats up and
fades. No full-screen flashes and nothing that changes brightness quickly over
a large area. The frame has to stay readable when the stream is shrunk to a
640-pixel-wide window on a second monitor.

### Skills and loot

Skills work as in RuneScape: each has its own level from 1 to 99 on an
exponential curve and only goes up by doing that thing. Levels unlock better
resources and gear. Gathering feeds processing, and processing feeds combat:
fish and logs become cooked food, and food is what lets a character stay out
and fight.

Items work as in Path of Exile: a base type, an item level, a rarity (normal,
magic, rare, unique) and affixes rolled from tiered pools. Good drops should be
rare enough to be worth announcing. Deciding what to pick up, wear and keep is
up to the character's program, so judging items is part of writing a good one.

### Everything runs a program

Adventurers and monsters run on the same virtual machine with the same
interface. What differs is the body: which actions it has and what its numbers
are. Monster programs live in `content/monsters/` next to their stats.

## Programs

Programs are written in a small language called Tactics, described in
[tactics.md](tactics.md). A program is an ordered list of rules, and on each
decision the first rule whose condition holds chooses the action.

This is the kind of program the design is aiming at. Most of the sensors and
actions in it don't exist yet:

```
bot "Lumberjack"

when hp < 40% and has(food)         -> eat
when danger_at(me)                  -> step_clear
when hp < 25%                       -> flee_to(camp)
when bag_full or dusk               -> go(camp); bank_all
when sees(tree)                     -> chop(nearest(tree))
otherwise                           -> wander(near_wood)
```

A rule list was chosen because it can be read at a glance on a stream, the
rule in charge can be shown, and it's easy to start with. You improve a bot by
reordering rules, changing thresholds and adding cases.

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
lean as it sets off and out of it as it stops. The hat is how far along a
resident is: every hood shape starts within a few units of the same height,
and the cowl's peak, the round hood's dome, the point and the hat's crown all
rise with the total of every level, up to 16 units at 99 in all five skills.
It rises fastest early, so the first levels show, and never goes down, so a
taller hat always means more levels; the tool says which trade. What differs
sits above or outside the outline so that it still reads on a figure about 13
pixels tall in a 640-wide window, and a name slip sits above the figure's own
top. Stitched patches for deaths wait for the world to count deaths (#279).

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
page it is listed as "downed" while it rests. A monster going home fades where
it was. Kills, downs and blows that leave a resident under 30% go on the news
line before what anyone decided, each for at least four seconds; a resident
downed goes up at once. The kill goes to the last blow that landed, as in the
simulation. What monsters decide is not news. Name slips keep clear of
monsters, as they do of the fire.

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

## One player on a busy stream

Everyone watches the same stream. No viewer has their own camera, and there
may be many more characters than the six in the first milestone. The game has
to stay worth watching for someone who owns just one of them. The plan:

1. **Finding your character.** Each player's character has a hood and cloak pair of
   its own. Typing `!me` in chat will highlight it for a few seconds.
2. **Getting noticed.** Time in the spotlight is rationed. Notable events earn
   it, but every active character gets a turn within a bounded wait, and the
   news line says who did what. How much attention each character got is measured,
   so a crowd can't quietly squeeze someone out.
3. **Comparing.** The spotlight shows a character's rules firing. Leaderboards
   rank single trips in many categories (best haul today, longest night
   survived, fastest to a level), so someone new with a clever program can top
   one on their first day while long-time players keep their levels.
4. **A page of your own.** Each character gets a companion web page: its
   stats, what happened since you last looked, and its program to edit.
5. **Regions.** A frame only holds as many characters as can be read, and
   that number will come from the crowd captures. Past it,
   the world gets more regions. The stream stays on one region at a time and
   moves to the next slowly, without cutting. Characters elsewhere carry on,
   and show up in the news line and on their own page.

Whether this is enough is not known. It will be tested by capturing the stream
with 12, 50 and 150 characters and judging it from one player's point of view
(the "Mine" score in [watch-rubric.md](watch-rubric.md)). The first milestone
only builds the frame and the spotlight and measures how many characters fit.
Points 1, 3 and 4 need real players and are planned for M3; regions are
planned for M4.

## What a viewer can do

In the first milestone, only watch; the programs are built in. Later: claim an
adventurer, read its program, edit it in the browser, and see how it does
against the others. That part is M3.

## Not planned yet

Deployment and hosting, sound, mobile layouts and trading between characters.
