# Idlin 3.0 — design

Idlin is a small frontier camp built around a lantern, at the edge of a wood that
turns dangerous at night. A dozen adventurers live there. Nobody steers them:
each one runs a short program. The game is left running on a stream. You watch
them work, fight, come home and get better, and if you want to, you write the
program for one of them.

## The four concepts this design answers to

1. A long-running idle RPG, built to be left running on a 24/7 livestream.
2. Everything that acts is a bot. Player characters and monsters alike run
   programs in a constrained virtual machine; monster behaviour is bot code
   shipped as content.
3. RuneScape-style progression (skills and levels) with Path of Exile-style
   itemisation (loot that rolls affixes).
4. Fun to watch on a second screen, and fun for one watcher to optimise.

## The problem to solve first

The last attempt ended on one complaint: watching it was "mindless whacking".
Characters stood at a node and swung until a number went up. Nothing they did
was a decision, so nothing they did was worth watching, and no art could fix
that. Every pillar below exists to make an action on screen readable as a
choice with a result.

## Pillars

### 1. Readable intent

A viewer who glances over for three seconds can tell what a character is doing
and why.

- Every actor's program is a short list of rules. The rule that is firing is
  shown: as a two- or three-word caption over the spotlighted character, and as
  the lit line of the program in the side panel.
- Monster attacks are telegraphed. A wolf crouches before it lunges and the
  tiles it will hit are marked for a beat. Whether the adventurer steps out is
  the visible result of its program. A fight is a string of small decisions
  that succeed or fail, not two health bars draining.
- A program that faults or runs out of budget does not crash anything. The
  actor stands confused with a "?" over its head. Bad code is visible too.

### 2. Trips, not loops

Nobody stands at a tree forever. Play is made of expeditions:

leave camp with food → work or fight outward → pressure builds (the bag fills,
food runs down, dusk comes) → walk home → bank, cook, re-gear → leave again.

Each trip ends in something the stream can announce: a haul, a level, a close
call, a death. Dying drops everything not yet banked where the character fell;
it stays there for a while and they can walk back for it. That is a real stake
without permanent loss, and a corpse-run is good to watch.

### 3. Day and night

One game day lasts 24 real minutes, so a game hour is a minute and the clock on
screen is easy to read. By day the near wood is fairly safe. At dusk the lantern
is lit and the camp becomes a pool of light. At night stronger monsters come
out of the deep wood carrying better loot.

This gives the stream a rhythm a returning viewer learns, makes the picture
change through the hour without any cut, and gives every program a decision
that matters: go home at dusk, or stay out and risk the haul.

### 4. One frame, no cuts, no strobing

The whole world fits one fixed frame (and when it outgrows one, the view
drifts between regions; see "One player among many"). The camera never cuts
between characters. A side panel spotlights one character at a time; it changes subject
slowly, with a fade, and prefers someone to whom something is happening.

Feedback is small, local and eased: a hop, a lunge, a number that floats and
fades, a light that swells. No full-screen flashes, no blinking, nothing that
changes brightness fast over a large area. Text uses a crisp pixel font at
integer scale. The frame must stay readable when the stream is shrunk to a
640-pixel-wide window on a second monitor.

### 5. Skills are the slow game, loot is the lottery

Skills follow RuneScape: each has its own level from 1 to 99 on an exponential
curve, earned only by doing the thing. Levels unlock better resources and gear.
Gathering feeds processing and processing feeds combat: fish and logs become
cooked food, and food is what lets a character stay out and fight.

Items follow Path of Exile: a base type, an item level, a rarity (normal,
magic, rare, unique) and affixes rolled from tiered pools. Good drops are rare
enough to be events, with a light beam on the ground and a line in the ticker.
Deciding what to pick up, wear and keep is the program's job, so item
evaluation is part of strategy.

### 6. The program is the game

Adventurers and monsters run on the same virtual machine with the same
interface. What differs is the body: which actions it has and what its numbers
are. Monster programs live in the content folder next to their stats.

## Programs

Programs are written in a small language called Tactics. A program is an
ordered list of rules. On each decision the first rule whose condition holds
picks the action.

```
bot "Lumberjack"

when hp < 40% and has(food)         -> eat
when danger_at(me)                  -> step_clear
when hp < 25%                       -> flee_to(camp)
when bag_full or dusk               -> go(camp); bank_all
when sees(tree)                     -> chop(nearest(tree))
otherwise                           -> wander(near_wood)
```

Why this shape: a rule list reads at a glance on a stream, the firing rule can
be highlighted, and it is easy to start with and still deep. A watcher improves
a bot by reordering rules, tightening thresholds and adding cases.

The language compiles to bytecode for a stack machine with these limits:

- values are 32-bit integers only;
- a fixed-size stack and a small set of memory slots that persist between
  decisions, so a bot can keep state (a target, a plan, a counter);
- a fixed instruction budget per decision;
- sensors are system calls that only read the world as that actor can see it;
- exactly one action is committed per decision;
- no allocation, no I/O, no access to anything outside the interface.

An actor decides when it is idle or interrupted, not on every tick, so actions
have duration and the picture is calm.

## The world model

- The simulation is a pure function of seed, content and inputs. It advances in
  fixed ticks (10 per second), uses integers only and a seeded random number
  generator, and never reads the wall clock. The same inputs always produce the
  same world, which is what makes replays, captures and before/after
  comparisons trustworthy.
- The world is a tile grid. Actors occupy tiles and move tile to tile; the
  viewer interpolates.
- A server runs the world in real time, saves snapshots to disk so the world
  survives restarts, and streams state to viewers. The viewer only draws.
- Content (maps, monsters, items, affixes, skills, programs) is data in the
  repo, validated when loaded.

## Look

Top-down pixel art at 16-pixel tiles and integer scale, with a lighting layer:
warm light pools from the lantern and campfires, a palette that shifts through
the day, soft shadows at night. Sprites come only from packs whose licence
allows redistribution in a public repo (the starting point is Kenney's CC0
Tiny Town and Tiny Dungeon), with the licence and credit committed beside
them. Single-frame sprites are animated in code (hops, squash, lunges, lean),
which keeps motion consistent across every pack and every monster.

The screen is 16:9: the world on the left, a side panel on the right with the
spotlighted character (portrait, skills, gear, its program with the firing rule
lit), and an event ticker along the bottom.

## One player among many

The audience is on a shared stream. No viewer has a camera of their own, and
on a good day there are far more characters than the handful the first milestone
shows. The design has to stay fun for one person who owns one of them. Five
commitments follow.

1. **You can find yours.** Each player's character carries a name tag in a
   colour they pick. `!me` in chat rings it softly for a few seconds.
2. **The stream notices you.** Spotlight time is rationed, not won by the
   loudest: notable events earn it, and every active character gets a turn
   within a bounded wait. The ticker names names. How much of the stream each
   character got is measured (acknowledgment and spotlight wait), so a crowd cannot
   quietly starve someone.
3. **Your choices show and compare.** The spotlight shows your rules firing.
   Boards rank trips, not totals, across many niches (best haul today, longest
   night survived, fastest to a level), so a newcomer with a clever program
   can top one on day one while veterans keep their levels.
4. **You have somewhere of your own.** A companion page per character: its
   sheet, what happened since you last looked, and its program to edit. The
   stream is the shared show; the page is the private seat.
5. **The world grows by places, not by density.** A frame holds only as many
   characters as can be read (the limit is found by capture, not assumed).
   Beyond that the world gains regions; the stream stays with one region at a
   time and drifts to the next slowly, never cutting. Characters elsewhere
   carry on and reach the stream through the ticker and their companion page.

Whether this holds is an open question, tested with captures at 12, 50 and 150
characters from one player's seat (the "Mine" score in
[watch-rubric.md](watch-rubric.md)). The first milestone builds the frame and
the spotlight and measures how many characters one frame can hold.
Commitments 1, 3 and 4 need players and arrive with them in M3; regions and
the drifting view arrive when the population calls for them, in M4. The
[roadmap](roadmap.md) carries each.

## What a watcher can do

In the first milestone, only watch; programs are built in. After that: claim an
adventurer, read its program, edit it in the browser, and compare how it does
against the others. That is the optimisation game, and it gets its own
milestone.

## Not planned yet

Deployment and hosting, sound, mobile layouts and trading between characters.
