# Chat

How a stream's chat joins the city and commands its citizens. This is the
design for [#337](https://github.com/nnamon/Idlin/issues/337). None of it is
built. Every time and count here is a target or arithmetic from the rules
below, and section 12 says what the first slice measures.

It rests on rules the operator set on
[#331](https://github.com/nnamon/Idlin/issues/331): one streamer is one
walking city, every chatter is a citizen of it named by their username, there
is no join command and there are no bot residents, and every citizen is
always on one screen. [plan.md](plan.md) owns the cycle and its lengths. This
page uses three phase names and leaves their lengths to the plan:

- **transit**: the city is walking and everyone is on the deck;
- **landing**: the city is set down and citizens go out and come back;
- **recall**: the horde is in sight and the city is about to leave.

A chatter is a person typing in the stream's chat. A citizen is their figure
in the world. "Present" means the chatter has typed in the last 20 minutes.

**Chatters steer through chat alone.** The operator's scope for now is that
chatters do not submit programs and only the streamer has access to the
site. So there is no page for a chatter to open, no pairing of a page to an
account, and no editor. A citizen runs one of the preset programs the game
ships, and its chatter chooses among them and sets their `param`s by typing.
"The page" below is the picture that is streamed: the map and the panels
round it. "The site" is the streamer's (section 9), and no chatter sees it.

## 1. The rule everything else follows

**A chat command never moves a citizen. It changes something the citizen's
program reads.**

Chat can do four things to a citizen: plant its flag (a place it is asked to
go), change a `param` its program declared, swap its program, and cast its
vote. The program still makes every decision. Two chatters who type the same
`!go` get different results, because one program fights its way to the flag
and comes home loaded and the other walks into a pack. That difference is on
screen, and it is the reason to choose a preset and set its numbers with
care.

The second half of the rule: **a program declares its own commands.** Every
`param` in a program is a chat command for the citizen that runs it. The
shipped program declares `stance` and `margin`, so its citizens understand
`!fight` and `!margin 150`. A preset that declares
`param style = kite of kite, tank` gives its citizens `!kite`. The game has
five built-in commands (section 3). The rest of the vocabulary comes with the
preset a citizen runs, so adding a preset adds its commands and nothing in
the gate or the parser changes.

Turned down:

- **Direct verbs** (`!attack`, `!eat`, `!left`). With them the fastest typist
  wins and the program is what runs when nobody is typing.
- **A temporary override** that suspends the program for a few seconds. The
  issue asked for each command to map to a goal, a `param` or an override.
  None maps to an override. Anything an override could do, a rule that reads
  the flag does, and the rule can be outranked by "turn back" and "step out"
  where an override could not.
- **Built-in stances** (`!fight`, `!careful`, `!gather` as game features).
  They are `param`s of the shipped program instead, so another preset can
  drop them, rename them or add its own.

## 2. Joining

Talking is joining. A chatter's first message of any kind makes their
citizen, and the message is the citizen's first line.

| After the message arrives | What happens                                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 s at most             | The message is in the input log for the next tick.                                                                                             |
| the next tick             | The citizen exists: named from the username, colours and parts from the account's id, the shipped program, issue kit. It stands under a hatch. |
| 0.4 s                     | The hatch has opened (3 ticks).                                                                                                                |
| 1.2 s                     | The citizen has climbed out (8 ticks) and its name slip is lettered. The page's order strip (section 4) reads "tim came aboard".               |
| 1.2 s to 4 s              | Its first message is shown as a speech bubble, ahead of every other bubble waiting.                                                            |

The chat platform's own delay comes before this and the stream's delay after
it, and neither is ours. Stream delay is a few seconds at best, and a chatter
has to look from the chat box to the stream, so every mark drawn on the map
for one chatter's command stays up for at least 6 seconds: the slip and its
glyph, the ring `!me` draws, and the mark for a refusal (section 4).

**One entrance.** A citizen always comes up through a hatch on the deck, in
every phase. The deck is on screen in the city view and sits in the middle of
the landing view, so the entrance is visible in both. What the newcomer does
next is its program's choice:

- **In transit** it takes the station shortest of hands, and a post if the
  city is attacked. Its first landing is at most one transit away.
- **On a landing** it walks down the ramp if its margin allows a sortie in
  the time left. The shipped program starts at a margin of 250 and works
  close to the city unless told otherwise, so a newcomer is cutting through
  the weakest monsters inside its first minute.
- **In recall** the same margin rule keeps it aboard. It watches the others
  run for the ramp and goes out on the next landing.

No rule is special to newcomers. The margin rule that brings everyone home is
what keeps a late arrival on deck.

**When the view is elsewhere.** During a landing the stream spends most of
each minute in a close view of one part of the site. A citizen that comes
aboard then is named on the order strip within 1.2 seconds and is not on the
map until the view next pulls back. In the wide view a citizen in its first
60 seconds has a ring round it and its name lettered. The view does not go to
a newcomer: with 150 chatters arriving through an evening, that would pull
the camera off the fight every few seconds.

**A crowd arriving at once.** Each hatch lets one citizen out every 5 ticks.
The small hull has two hatches, so 4 citizens a second: a channel raid of 40
takes 10 seconds and a full city of 150 takes 38. They are let out in the
order their first messages came. A raid on the stream shows as a column of
figures climbing out of the deck.

**The name.** The display name if it is the login in other capitals, else the
login. It is cut to 12 characters on a name slip and 16 on the page. A name
that fails the filter (section 8) is replaced by one made from the place-name
syllables, seeded by the account's id. The account's id is the key, so a
chatter who renames keeps their citizen.

**More than 150.** The city has 150 berths. A citizen that cannot come up
waits under the hatch, and the page shows "at the hatch: 12". Section 5 says
who gives up a berth. If 150 chatters are all present, a newcomer waits; that
is outside what the plan sizes for.

**Accounts that never join.** The stream's own chat bots would become
citizens. The adapter takes a list of accounts to ignore, and ships with the
common bot names in it.

Turned down:

- **A crane that lowers a newcomer onto the landing**, the conductor's first
  idea. It puts a level-1 citizen on ground that may have a pack on it, and
  it is a second entrance to build. The deck is safe ground.
- **Boarding at the next landing**, the conductor's first take on #331. A
  chatter who types "hello" as the city lifts waits a whole transit, which is
  minutes, and has left by then.
- **A join command**, by the operator's rule.

## 3. The command vocabulary

A message that starts with `!` is a command and is never spoken. A `!word`
the game does not know is ignored, since other bots' commands share the
chat. Everything else is speech (section 6).

### 3.1 The five built-in commands

| Command         | Transit                                                                                                                                                  | Landing                                                                       | Recall                                                    | Maps to                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------- |
| `!go <where>`   | a station or post lettered on the deck: `!go guns`                                                                                                       | a place, a sector, a compass point or a citizen: `!go brackwater`, `!go ana`  | the same; whether it is followed is up to the margin rule | a goal: the flag          |
| `!home`         | nothing to do; the citizen is aboard                                                                                                                     | the flag goes to the ramp, and the citizen stays aboard while it stands there | the same                                                  | a goal: the flag, at home |
| `!free`         | takes the flag down                                                                                                                                      | takes the flag down                                                           | takes the flag down                                       | clears the goal           |
| `!run <preset>` | swaps to that preset at once                                                                                                                             | swaps it when the citizen is next on deck                                     | swaps it when the citizen is next on deck                 | the program               |
| `!me`           | rings the citizen and letters its name for 6 s, and puts its settings on the order strip: `tim · Melee 12 · stance fight · margin 150 · flag Brackwater` | the same                                                                      | the same                                                  | nothing in the world      |

`!1`, `!2` and `!3` vote when a question is open (section 7). Moderators have
`!idlin` (section 8). `!run` takes the name of a preset the city offers
(section 9), and any other name is refused.

### 3.2 The flag

Each citizen has one flag. It is world state: a kind (none, a tile, a
citizen, home), a position, and the tick it was planted.

`<where>` is looked up in this order, against what is lettered on the map at
the tick the order is applied:

1. `home`.
2. A compass point, `north` to `northwest` or `n` to `nw`: the heart of the
   sector in that direction from the city.
3. A sector by name: its heart, which is where its name is lettered.
4. A named place on the site, or in transit a station or post on the deck.
5. A citizen by username, or `@name` to skip the steps above.

Names match on any prefix of three letters or more that only one name at
that step has. The first step with a match wins, and within a step an exact
name beats a prefix. So `!go bra` reaches Brackwater even with a chatter
called brax aboard, since places are looked up before citizens, and
`!go @bra` reaches brax. The map's lettering is the vocabulary: a chatter
reads a name off the stream and types it. A word that matches nothing, or a
prefix that two names at the same step share, is refused (section 4).

A flag on a citizen follows that citizen. Since the streamer is a chatter
with a citizen, `!go <streamer>` is how a chat escorts them.

A flag on a tile or at home is taken down when the city sets down and when it
lifts, because the ground it stood on is gone. A flag on a citizen stays
until `!free`, or until that citizen goes below.

The program reads it through:

| Name        | Kind   | What it is                                                                       |
| ----------- | ------ | -------------------------------------------------------------------------------- |
| `flagged`   | sensor | 0 with no flag, 1 for a tile, 2 for a citizen, 3 for home                        |
| `flag`      | place  | where the flag is, usable wherever a place is: `walk_to(flag)`, `distance(flag)` |
| `flag_age`  | sensor | ticks since it was planted                                                       |
| `flag_down` | sensor | 1 if the flag is on a citizen who is down                                        |
| `heard`     | sensor | ticks since this citizen's chatter last typed anything, up to 864,000            |

`heard` is there so a program can be bolder while its chatter is watching and
safer while they sleep.

**Followed or not.** The VM keeps one bit per decision. It is set when the
winning rule's condition or action reads `flagged`, `flag`, `flag_age` or
`flag_down`, or when a rule above the winner read one of them and its
condition did not hold: the program looked at its flag and found nothing to
do, as the shipped program does once it is within 6 tiles of it and goes back
to chopping. Either way the flag is drawn solid. It is held, drawn as an
outline with the winner's label, only when the winning rule sits above every
rule that reads the flag. The bit is stored on the citizen and the viewer
draws from it (section 4), so everyone can see whether a program took its
order, and which rule outranked it when it did not.

A rule that reads the flag high in a program therefore marks everything
under it as following. That is why the shipped program (section 9) keeps all
its flag rules together, under the rules that are allowed to hold an order.

**An order interrupts.** `walk_to` normally goes all the way before the
program is asked again. An accepted order or `param` change ends the
citizen's current action at the next tile, or at the end of the blow it is
in, and the program decides again. With steps of 4 to 6 ticks and blows of 5,
that is 0.6 seconds at most.

### 3.3 Params

The plan already gives Tactics `param`, a named number with a default. Two
additions make it the command surface:

```
param margin = 250 from 100 to 400
param stance = gather of gather, fight, careful
```

- `from … to …` gives a range. A value outside it is refused.
- `of a, b, c` names the values. They compile to 0, 1, 2, and the names are
  constants in the program, so `stance == fight` works.

A program may declare 8 params. Their values are kept on the citizen, in the
snapshot and the hash, and read by the VM at run time, so a change needs no
compile.

In chat:

- `!margin 150` sets a number. `!set margin 150` is the same, for a param
  whose name collides with a built-in command.
- `!stance fight` sets a named value, and so does `!fight` alone, when
  `fight` is a value name in exactly one of the program's params.

A param keeps its value until it is changed: through landings, through the
chatter's absence and through the citizen's time below. After `!run`, params
of the same name and kind keep their values and the rest take the new
program's defaults.

### 3.4 What the shipped program gives a newcomer

With the shipped program (section 9) a new citizen understands:

| Command                | What it changes                                                       | Phase where it shows            |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------- |
| `!gather`              | `stance`: works nodes, strikes only what comes next to it             | landing                         |
| `!fight`               | `stance`: goes at any monster within 8 tiles                          | landing, and attacks in transit |
| `!careful`             | `stance`: keeps 3 tiles clear of monsters and works where it is quiet | landing                         |
| `!margin 100` to `400` | how much of the walk home it keeps in hand; the turn-back number      | every recall                    |
| `!go …`, `!home`       | where its sorties go; which station or post it takes                  | every phase                     |

The issue's starting list also had `!help ana`, `!crew guns` and
`!craft spear`. `!help ana` is `!go ana`: the shipped program walks to a
flagged citizen and keeps beside them, chops only a tree it is standing at,
strikes what comes next to it and gets them up when they are down. It does
not leave them for a tree. With `!fight` as well it goes at any monster
within 8 tiles of itself, and comes back when that takes it more than 6
tiles from them. `!crew guns` is `!go guns`. `!craft` waits for the forge: what
tally is spent on is a decision with a price list, and it is left out until
the plan has settled what the forge makes. When it comes it is
`!make <item>`, an order that stands until it is filled, with the price list
lettered on the page.

## 4. Confirmation

The chat adapter cannot post (section 10), so every answer to a command is
drawn on the stream. All of it is drawn from world state, so a capture shows
it and a replay repeats it.

**An accepted order**, from the tick it is applied:

| When            | On the map                                                                                                                                                                     | On the page                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| the same tick   | The citizen's name slip is lettered, even where slips are hidden for the crowd, with a glyph on its tab: a flag, a house for `!home`, a dial for a param.                      | A row on the order strip: `tim · to Brackwater`.                           |
| within 0.3 s    | A flag in the citizen's hood and cloak colours is drawn at the target, a stroke a tick. For a flag on a citizen, a thin line joins the two.                                    |                                                                            |
| within 0.6 s    | The citizen has stopped what it was doing and decided again. If it follows the flag, the dashed route line the viewer already draws for a walk runs from its feet to the flag. | The row gains what the program did: `tim · to Brackwater · "to the flag"`. |
| for 6 s         | The slip and the glyph stay up.                                                                                                                                                | The row stays for at least 3 s.                                            |
| while it stands | The flag stays on the map: solid while the citizen follows it or has reached it, an outline while a rule above every flag rule holds it.                                       |                                                                            |

So a chatter who looks from the chat box to the stream finds their name
lettered, a flag in their colours and a line between the two. In the wide
view of a landing, where a citizen is a pennant 12 pixels tall, the slip and
a ring mark the pennant and the flag is drawn at the same size at any zoom.

**A program that does not take the order.** The flag is drawn as an outline
and the strip says why, in the program's own words:

- `ana · to the Far Barrow · held by "turn back"`: the rule that won sits
  above every rule that reads the flag, and its label is quoted.
- `joss · to Brackwater · no rule reads the flag`: the program never reads
  it.

A citizen that has walked to its flag and is working beside it is not one of
these. Its flag rule was read and had nothing left to ask, so the flag stays
solid and the row reads `tim · to Brackwater · "chop"`. On a landing most
standing flags are ones their citizens have reached, and an outline among
them means a program said no.

This is the display that makes the program the subject. A viewer who sees
ten flags go up for the Far Barrow in recall, seven of them outlines, has
been shown what a margin is.

**A param change** letters the slip with the dial glyph and puts
`tim · margin 150` on the strip. It has nothing to show on the map until the
program acts on it.

**A refusal.** A word that matches nothing, a value out of range or a command
with no token left (section 8) letters the citizen's slip for 6 seconds with
a question mark on its tab, or an hourglass for a cooldown, and puts nothing
on the strip. A refused command costs nothing.

**The order strip** is five rows at the foot of the page, newest at the top.
Each row stays at least 3 seconds, so it carries 100 rows a minute. When more
arrive, rows with the same target merge: `8 to Brackwater: tim, ana, joss and
5 more`. A merged row is also the quickest reading of where chat is sending
the city.

**Standing flags** are drawn at every zoom. At the start of a landing the
flags go up across the site in 150 pairs of colours, and in recall they jump
to the ramp as chatters type `!home`.

## 5. Quiet chatters

A read-only adapter sees messages and nothing else. It cannot tell a chatter
who is watching silently from one who has left, so presence is the time since
the last message.

| The chatter last typed | The citizen                                                                                                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| under 20 minutes ago   | **Present.** First claim on a name slip and on a bubble, first in the close view's turns, can vote.                                                                                                                   |
| 20 minutes to 24 hours | **Away.** Runs its program exactly as before, with its params as they stand: goes out, hauls, fights, takes its post. Its flag on a tile came down at the last lift. It yields slips and bubbles to present citizens. |
| over 24 hours          | **Below.** The next time it is on deck it goes down the hatch. It is off the screen and out of the simulation. Its record is kept: levels, kit, locker, program, params.                                              |

Nothing is lost by going below. A citizen below gains nothing and risks
nothing. The deck plan letters the count beside the hatch ("412 below"),
which is the size of the stream's community over time.

**Return.** Any message from a chatter whose citizen is below brings it up
through the hatch as on the first day, in 1.2 seconds, with its record. The
strip reads `tim is back after 3 days`. Records are kept for a year without a
message and then deleted.

**Why 24 hours.** The game is an idle game: a chatter who types before bed
should find in the morning that their citizen went out on thirty landings.
Sending a citizen below after one quiet cycle would end that, and would empty
the city whenever chat is slow. The walking-city draft sends a citizen out
on landings for 3 days and keeps it aboard as crew until 14. On a stream
where a few hundred people type one line a week, that fills the berths with
citizens on the shipped program whose chatters are gone, which is the bot
residents the operator ruled out under usernames. The draft's rule for a
full city, that whoever has been quiet longest gives up their place, is the
berth rule below. At 24 hours the city is the people who talked today.

**Berths.** When the city has 150 citizens awake and one is waiting at the
hatch, the citizen on deck whose chatter has been quiet longest goes below,
if that is more than 20 minutes. A present citizen is never sent below, and a
citizen that is out on a landing is not called in for it. So a flood of new
accounts can put away citizens to bed early, where they lose nothing, and
cannot remove anyone who is present.

**An empty city.** With no bot residents, a stream whose chat has been silent
for a day has nobody on deck. The city still walks its cycle. What a landing
with nobody aboard looks like, and how sites, hordes and attacks scale under
15 citizens, is the plan's to settle; this design only makes sure that the
first message brings someone up within two seconds.

## 6. Speech bubbles

Any message that is not a command is spoken by the chatter's citizen.

**Text.** The first 40 characters, cut at the last space before that, on two
lines of up to 20, in the stream's typeface on a slip of the map's paper with
a tail to the speaker. Runs of a repeated character are cut to three. A
message that is mostly capitals is lettered in lower case.

**Time.** 2 seconds plus half a second for every 10 characters: 2.5 to 4
seconds. It comes in and goes out over 3 ticks, as every mark does.

**How many.** Six at once on the map, in every view, and two in the last 30
seconds before the city lifts, when the ramp is the picture. Six bubbles of
about 170 by 44 pixels cover 3% of the map. At about 3.2 seconds each, six
slots show 110 bubbles a minute, so a chat of up to a message and a half a
second has every line shown.

**Past that.** A message that does not get a slot within 6 seconds is
dropped, since by then chat has moved on. Its speaker still gets a speech
tick: three short strokes above the figure for a second. Any number of those
can show at once. So every message does something on screen.

**Who gets a slot,** in order:

1. a citizen's first line as it comes aboard;
2. the streamer and the moderators;
3. present citizens in the close view's frame, the one who has gone longest
   without a bubble first;
4. anyone else in the frame.

A citizen gets a bubble at most once in 15 seconds. A newer message from the
same citizen replaces one still waiting.

**Out of frame.** In a close view a speaker outside the frame gets no bubble.
The platform's chat is beside the stream already, so the line is not lost,
only its tie to a figure.

**Placement.** Above the speaker's name slip, kept clear of other slips,
bubbles and the fire, with the code that already moves slips apart.

**Emotes.** The platform marks emotes in a message. They are removed from the
text. A message that was only emotes makes the citizen hop, at most once in 3
seconds. A chat that spams emotes when a boss falls is a deck of hopping
figures.

**Filtering.** The channel's moderation comes first and costs nothing: a
message the platform holds or blocks never reaches a read-only adapter. Then
ours:

- A message with a link, or with any character the typeface cannot letter
  (it has Latin letters, digits and common punctuation), gets a speech tick
  and no bubble.
- A message that matches the blocked-word list, after lower-casing, undoing
  common letter swaps and dropping repeats, gets the same. The list ships
  short in `content/chat/` and the streamer can add to it.
- When a moderator deletes a message, its bubble is removed on the next
  tick. When a chatter is timed out or banned, their bubbles go, and section
  8 says what happens to the citizen.

Chatters who write in other scripts get speech ticks and no bubbles. That is
a limit of the typeface, and a fallback face is the fix if it matters.

Turned down: **a chat log panel** on the page, with every message in a
scrolling list. Every stream already has one beside it.

## 7. City-wide decisions

A **question** has two or three options and a window. One is open at a time,
and at most two in a cycle.

- **Who votes.** A citizen that was awake before the question opened and has
  been through at least one lift. One vote each, with equal weight. `!2`
  votes, and so does a bare `2` while a question is open. A vote can be
  changed until the window closes; the last one counts.
- **Why numbers.** The walking-city draft votes with `!go a`, `!go b` and
  `!go c`. Here `!go` plants a flag and its word is looked up among places
  and citizens, so a second meaning would make `!go b` depend on whether a
  question is open. A number has one meaning, it is what the page letters
  beside each option, and it works for a question whose options are not
  places (pay or run, fight or run). The draft's `!wait` has no number
  because the lift does not wait (below).
- **The result.** The most votes. A tie goes to the option that reached that
  count first. With no votes the first option stands.
- **In the world.** Votes are inputs and the tally is world state, so the
  result replays.

| Question              | When                        | Window | Options               |
| --------------------- | --------------------------- | -----: | --------------------- |
| Where the city goes   | every cycle, after the lift |   60 s | the three sites ahead |
| A toll                | when a fort bars the way    |   30 s | pay, or run its guns  |
| A rival city in reach | section 11                  |   30 s | fight, or run         |

**How the landing vote shows.** The view is the world map, with a route
drawn from the city to each of the three sites. Each vote pins a small
pennant in the voter's colours to its route within a tick. The pennant is the
vote's mark and stays until the window closes. The newest on each route is
also lettered with the voter's name, for 2 seconds or until the next vote on
that route, since at 80 votes a minute a name cannot stand for 6. The routes
grow
toward their sites as votes come in, with the count lettered at each site. A
changed vote moves its pennant. The page shows the three sites with what the
lookout knows of each, a bar for each count, and the seconds left. When the
window closes the winning route is inked solid over a second and the others
fade over three.

**Which bay is built next** is a standing choice and has no window. When the
plan's modules exist, `!pledge <module>` moves a citizen's pledge, and the
page's bars show the totals.

Turned down:

- **Votes weighted by level or tally.** The oldest citizens would decide
  every question.
- **Programs that vote.** A hundred citizens whose chatters are asleep would
  outvote the twenty who are watching.
- **A vote to hold the ramps.** When the city leaves is the one thing chat
  cannot move. The margin means something only if the lift does not wait.

## 8. Abuse and moderation

**Cooldowns.** They run on ticks inside the simulation, so they replay and
the viewer can draw them.

| Thing                      | Limit                                                                                  | Why that number                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orders and param changes   | Each citizen holds up to 2 tokens and gains one every 20 s. Each accepted one costs 1. | A blow takes half a second and a pack fight 3 to 5, so chat cannot steer a fight. A sortie is 90 s or more, so it can redirect one. Two tokens let `!fight` and `!go east` go together. |
| Repeating a standing order | Costs nothing and does nothing.                                                        |                                                                                                                                                                                         |
| `!run`                     | Once in 10 minutes.                                                                    | The plan's limit for a program change.                                                                                                                                                  |
| `!me`                      | Once in 30 s.                                                                          | It letters a name on the stream.                                                                                                                                                        |
| A bubble                   | Once in 15 s for each citizen.                                                         | Section 6.                                                                                                                                                                              |
| Votes                      | No limit; the last counts.                                                             |                                                                                                                                                                                         |
| Any one account            | The adapter drops what is past 5 messages a second.                                    | Flood control before anything is parsed.                                                                                                                                                |
| Any one account's queue    | At most one waiting input of each kind (below).                                        | Refused orders cannot pile up.                                                                                                                                                          |
| The world                  | 32 inputs a tick, in arrival order. The rest wait for the next tick.                   | 320 inputs a second is far above what 150 chatters type.                                                                                                                                |

**The queue is bounded per account.** Tokens and cooldowns are checked in the
simulation when an input is applied, so an order that will be refused still
waits in the queue and takes one of a tick's 32 places. What bounds that is
the queue itself. For each account it holds at most:

| Waiting input                | At most                |
| ---------------------------- | ---------------------- |
| a flag order, `go` or `free` | 1                      |
| a change to a param          | 1 for each param, so 8 |
| `run`, a vote, `me`, speech  | 1 each, so 4           |

A newer input of the same kind replaces the one waiting and keeps its place
in the line, so typing faster gains nothing. `heard` rides on the account's
other input, and is queued alone only for a message that made no other. That
is 13 waiting for one account at the very most, and 7 on the shipped program
with its two params.

The numbers. The adapter passes 5 messages a second from an account, and each
makes one input, so one account takes at most 5 of the 320 places in a
second. Thirty accounts flooding `!go` take 150, under half, and nobody else
waits. If every one of 150 citizens floods every command of the shipped
program at once, 1,050 inputs are waiting and the last of them is applied
3.3 seconds later. On presets with 8 params each it is 1,950. Past 2,000
waiting, which the 150 citizens of a full city cannot reach without accounts
at the hatch flooding too, speech is dropped first, and then orders from whichever
account has the most waiting, so an account with one order in the line is
the last to lose it. `join`, `wake` and `mod` are never dropped. The longest
any input waits is 2,000 over 320, or 6.3 seconds.

**What one chatter can do to another.** `!go <name>` follows them, and that
is all. Citizens do not block or hurt each other, nothing can be given or
taken, and no command changes another citizen's flag, params or program.

**The channel's moderation is the game's.** The adapter reports deleted
messages, timeouts and bans:

- a deleted message: its bubble goes;
- a timeout: the citizen is mute for its length;
- a ban: the citizen goes below at once and is barred. If a message from
  that account arrives later, the platform has let them back in, and the
  citizen comes up.

**Moderator commands,** from the streamer and the channel's moderators, whom
the platform marks on each message:

| Command                        | What it does                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `!idlin mute <name> [minutes]` | No bubbles from that citizen; 10 minutes unless given.                         |
| `!idlin below <name>`          | Sends the citizen below and bars it until `!idlin allow <name>`.               |
| `!idlin bubbles off` / `on`    | No bubbles at all; speech ticks only.                                          |
| `!idlin doors shut` / `open`   | No first-time citizens come up; they wait at the hatch. Returning citizens do. |
| `!idlin clear hatch`           | Drops everyone waiting at the hatch who has never been aboard.                 |

These are inputs like any other and go in the log. The streamer's site
(section 9) has the same controls and sends the same inputs.

**Names.** A username is filtered like speech. A name that fails gets a
generated one (section 2). The account still plays.

**Floods of new accounts.** The hatch's rate (4 a second) and the berth rule
(nobody present is displaced) bound what a flood can do. Past that the
streamer shuts the doors. Vote stuffing with fresh accounts fails on the rule
that a citizen votes only after its first lift.

## 9. Programs

**The shipped program** is what every new citizen runs. It has to be safe for
someone who types one line and leaves, it has to follow orders visibly, and
it should be beatable by anyone who reads it. A sketch, using the
walking-city draft's turn-back sensors, `lift_eta` and `way_home`:

```
bot "Deckhand"

param margin = 250 from 100 to 400
param stance = gather of gather, fight, careful

section landing
when lift_eta * 100 < way_home * margin as "turn back" -> go_home
when danger_here > 0 as "step out" -> step_clear
when hp * 3 < max_hp and carrying(cooked_fish) > 0 as "eat" -> eat
when stance == careful and threat_distance <= 3 as "keep clear" ->
  flee(threat_x, threat_y)
when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
when stance == fight and threat_distance <= 8 as "go at it" ->
  step_to(threat_x, threat_y)
when bag_free == 0 as "bag full" -> go_home
when flagged == 3 as "called home" -> go_home
when flag_down as "get them up" -> walk_to(flag); revive
when flagged and distance(flag) > 6 as "to the flag" -> walk_to(flag)
when node_distance(tree) == 0 as "chop" -> chop
when flagged == 2 as "stay by them" -> walk_to(flag)
when node_distance(tree) < 9999 as "to a tree" ->
  walk_to(node_x(tree), node_y(tree))
otherwise as "look about" -> wander
```

Its `aboard` and `alarm` sections go to the flagged station or post if there
is one, and otherwise to whichever is shortest of hands.

**The sensor's name.** The draft calls the time to the lift `lift_eta`, the
ticks until the horde's front reaches the lamps, and this page uses that
name and adds none of its own. The sensor belongs to the cycle, which the
plan owns. It has no value before the horde is sighted, and the plan says
what a comparison on it does then; this sketch assumes "turn back" cannot
win before the sighting. The draft's own sketch of the rule has a margin of
180, and it starts a newcomer at 250. The shipped program is the newcomer's,
so its default is 250.

The five rules that read the flag sit together under "turn back", "step
out", "eat", the three fighting rules and "bag full". So on this program an
order cannot walk a citizen past its margin or out of a fight, `!home`
included, and the only way to cut it fine is to lower the margin, which is a
decision the chatter makes with a number. When one of those seven rules wins
while a flag stands, the flag is drawn as held with that rule's label. When
"chop", "to a tree" or "look about" wins, the flag rules above were read and
did not hold, and the flag stays solid (section 3.2). "stay by them" keeps
an escort beside the citizen it was sent to: without it "to a tree" would
walk the escort off to the nearest tree and "to the flag" would fetch it
back. Its faults are easy to find: it
never looks at how strong the monsters round the flag are, it banks only
when the bag is full, and it treats a flag of ten seconds ago like one of
ten minutes ago. Those are what the other presets do differently.

**Presets.** A preset is a program the game ships in `content/`: the shipped
program above and the plan's three starters. Each has a one-word name, a
line saying what it is for, and its own params. Chatters do not write or
submit programs.

**Choosing by chat.** `!run <preset>` swaps a citizen to another preset the
city offers, when it is next on deck, once in 10 minutes. The offered names,
each with its line and its params as chat commands, are lettered on the page
while the landing vote is open, which is when chatters are reading it. The
reckoning letters how many citizens run each: "Longhaul 31, Deckhand 96".
`!me` names the preset a citizen is on.

**The site** is the streamer's, and it is the only page besides the stream.
The city's own server serves it to the machine the city runs on, as it
serves the local chat page (section 10), so it needs no account, no login
and no secret. It has three parts:

| Part       | What the streamer sets                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Settings   | the channel to read, the accounts to ignore, words added to the blocked list, bubbles on or off, doors open or shut |
| Moderation | mute, below and allow for a citizen by name, and the hatch cleared: section 8's `!idlin` commands as buttons        |
| Presets    | which presets the city offers, and which one a newcomer starts on                                                   |

Everything the site changes in the world goes in as a `mod` input, through
the same queue and log as chat, so it replays. The list of presets on offer
is world state: `!run` is checked against it in the simulation at the tick
it is applied. A preset taken off the list stops being offered, and citizens
already running it keep it. The preset newcomers start on cannot be taken
off. The channel, the ignore list and the blocked words are the gate's
configuration and are not in the world.

Turned down, by the operator's scope for now:

- **A companion page for each chatter**, with a live window on their
  citizen, sliders for its params and a program editor.
- **Pairing a page to an account** by a code typed in chat. With no page
  there is nothing to pair, and the takeover it allowed (one chatter posts
  their own code and others type it) goes with it.
- **Programs written or published by chatters**, and `!run <name>` running a
  copy of another chatter's program.
- **Programs sent through chat**, in pieces or as a link. Chat lines are 500
  characters, the adapter cannot answer with compile errors, and links are
  filtered.

None of this is built toward. If chatters' programs come back, the two rules
of section 1 already cover them: a program's params are its commands, and
`!run` takes a name.

Later work, not designed here: site controls for chatters come back only
once the site has single sign-on, so that a login proves the account and no
pairing scheme is needed.

## 10. The pipeline

```
chat platform -> adapter -> gate -> queue -> log -> step(world, inputs) -> viewers
                 read-only  ignore list   one of a kind   one line a tick
                            flood control   an account
                            speech filter
                            parse
```

**The adapter** turns a platform's chat into three events and has no way to
send:

```ts
type ChatEvent =
  | {
      type: "message";
      id: string;
      account: string;
      login: string;
      display: string;
      text: string;
      role: "viewer" | "mod" | "streamer";
      emotes: readonly [start: number, end: number][];
    }
  | { type: "delete"; id: string }
  | { type: "clear"; account: string; seconds: number | null };
```

Three adapters share the gate and everything after it:

- **The scripted crowd,** for captures, tests and the gate. A crowd file
  gives explicit lines and generated chatters by cycle time, and a seed:

  ```
  seed 7
  00:00 +12 regulars
  00:05 ana: hello
  00:40 ana: !go brackwater
  01:00 +3 talkers every 20s
  06:10 +40 raid
  12:05 * 60% !home
  ```

  It is a pure function of the file and the tick, so a capture with a crowd
  is the same every time. Kinds of generated chatter: regulars, talkers,
  commanders, lurkers who say one line, a spammer and one with a name that
  fails the filter.

- **The local chat page,** for a developer or a judge: a page that sends
  lines as any username to a socket bound to the local machine.

- **A live chat.** Twitch's chat can be read over IRC with an anonymous
  login and no credentials, and with its tags turned on each message carries
  the account's id, its badges, its emote positions and a message id, and
  deletions and timeouts arrive as their own commands. So the adapter needs
  no account, no token and no secret, and has nothing it could post with.
  This is from memory and is checked against Twitch's documentation in the
  adapter's issue. It is built and tested against recorded lines. No test
  and no CI run opens a connection.

**The gate** is pure code in its own package: the ignore list, flood control,
the speech filter, and the parser that turns text into inputs. It checks a
command's shape. It does not look up names: `!go bra` becomes an order
carrying the word `bra`, and the simulation resolves it against the site at
the tick it is applied. The log therefore holds what was typed, and a replay
resolves it the same way.

**Inputs.** `step(world, inputs)` already takes a list, with `spawn` as its
one kind. The new kinds:

| Input   | Carries                                      | Effect                                                                                   |
| ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `join`  | account, name, role                          | a new citizen under the hatch                                                            |
| `wake`  | the citizen's stored record                  | the same, with its record                                                                |
| `heard` | account                                      | sets the citizen's last-heard tick; carried on the account's other input when it has one |
| `go`    | account, the word                            | plants the flag, if it resolves and a token is left                                      |
| `free`  | account                                      | takes the flag down                                                                      |
| `param` | account, name, value as typed                | sets it, if the program declares it and the value is allowed                             |
| `run`   | account, preset name                         | swaps to the preset when the citizen is on deck, if the city offers it                   |
| `vote`  | account, option                              | counts it, if a question is open and the citizen may vote                                |
| `me`    | account                                      | rings the citizen for 60 ticks, if its 30 seconds are up                                 |
| `say`   | account, message id, filtered text           | an event for this tick's message to viewers; changes nothing hashed                      |
| `unsay` | message id                                   | an event; the viewer drops that bubble                                                   |
| `mod`   | the moderator command, from chat or the site | mute, below, allow, bubbles, doors, clear hatch, the presets on offer                    |

As today, an input that cannot be honoured is dropped whole and never
throws.

**Speech is outside the hash.** `say` and `unsay` pass through a tick as
events in the message to viewers, the way #319 carries blows, and leave
nothing in the world. Text in the world would grow every snapshot and make
the hash depend on the filter list. What is hashed is that the citizen was
heard.

Every input that changes a citizen comes from that citizen's own chat
account. The only other source is the streamer's site, which sends `mod`
inputs and nothing else.

**At tick boundaries.** Events are gated as they arrive and queued, with each
account's waiting inputs bounded as section 8 has it. At the start of each
tick the server takes up to 32 inputs from the queue in arrival order,
appends one line to the log (`{"tick": 481220, "inputs": […]}`), and steps
the world with them. The log records what was taken, so the bound and the
drops past 2,000 do not have to be replayed: a replay reads the log.

**The log and replay.** A snapshot starts a new log file beside it, and the
log is flushed every 10 ticks. On a restart the server loads the newest
snapshot and replays its log. If the process died with ticks unflushed,
those ticks and their inputs are lost together, so the world and the log
still agree. Logs are pruned with their snapshots. The determinism test:
a snapshot plus its log gives the live world's hash, with a scripted crowd
of 50 across a full cycle.

**Citizens below** are not in the world. When one goes below, the tick's
events carry its record and the server stores it by account. `wake` carries
the record back in, so the log is self-contained and the snapshot stays the
size of the citizens awake. The store keeps a record after its `wake` until
the log line carrying that `wake` is flushed. If the ticks since the last
flush are lost, the replayed world has the citizen below again, and its
record is still in the store for the next message to wake it with.

**What stays off GitHub.** A live chat's log holds usernames and what people
typed. It lives in the server's data directory, which is not in the repo, and
is pruned with the snapshots. Captures, tests, the README's images and
everything else that is committed or posted use scripted crowds only.

**Server changes.**

- `Input` gains the kinds above, and `applyInput` a case for each.
- `WorldServer.tick()` drains the queue, writes the log line, then steps.
- `store.ts` writes and prunes log files with snapshots, and `loadNewest`
  replays the log.
- A store of citizens below, by account.
- The message to viewers gains the tick's `say` and `unsay` events.
- `IDLIN_CHAT` picks the adapter (`crowd:<file>`, `page`, or
  `twitch:<channel>`), and `IDLIN_CHAT_IGNORE` adds accounts to ignore.
- The streamer's site: a page the server serves to the local machine only,
  whose controls send `mod` inputs and write the gate's configuration.
- The snapshot version goes up: each citizen gains its account, last-heard
  tick, preset, param values, flag, tokens and mute, and the world gains the
  presets on offer.

Turned down:

- **A bot that answers in chat.** It needs an account and a token, which is
  a secret to keep. It posts on a third party's service, which the team's
  mandate rules out. And it would put the answer in a chat scrolling at two
  lines a second when the stream can draw it on the citizen.
- **Resolving names in the gate.** The gate would need the world's current
  site, and the log would hold tiles, which mean nothing if a replay starts
  from an older snapshot.
- **Wall-clock cooldowns in the gate.** A capture would then depend on how
  fast the machine ran.

## 11. City against city

The walking-city draft gives a meeting three forms: a race, a raid on a
copy, and a live clash. Chat behaves differently in each. What follows about
chat is this page's proposal, and where it departs from the draft it says
so.

**The race.** Nothing changes. Each chat commands its own city. The rival
is a mark on the world map.

**A raid on a copy.** The rival's deck and citizens are a snapshot, run in
this city's world. The copied citizens have no chat: they run their
presets with their params as they stood, with every flag down. So what
defends a city while its chat sleeps is the presets its chatters chose and
the params they set, which are standing orders in the full sense. After a
raid the defending city's strip names the citizens who held the hold.

**A live clash,** both decks side by side on both streams:

- **Commands.** Each chat commands its own citizens only. The rival deck's
  lettered places join the `!go` vocabulary with `their` in front:
  `!go their hold` plants a flag there, and a program that follows it crosses
  the planks.
- **The wrong deck.** A citizen still on the rival's deck when the cities
  break apart is stripped: it is back on its own deck at the break, without
  its bag and the kit it wore, with its locker untouched. That is what the
  operator set on #331 for missing a lift. The draft makes it a captive on
  the rival's deck instead. A captive would be drawn on the other stream and
  missing from its own, and the rule that every citizen is always on its own
  city's screen decides against that. So the shipped program's "turn back"
  rule runs here too: in a clash `lift_eta` counts to the break and
  `way_home` is the walk back across the planks, with the same `margin`. The
  number a chatter tuned on landings is the one that gets them off the
  rival's deck.
- **Flags** are drawn on both streams. A rival's flag on one's own hold is
  the warning.
- **Speech does not cross.** Each stream shows bubbles from its own chat
  only. A rival citizen that speaks shows a speech tick, and hops for
  emotes. A streamer moderates their own chat and has no say over the
  other's, so free text from it is never drawn on their stream.
- **Names cross,** since a boarder has to be named on the news line. They
  go through the receiving city's name filter.
- **The question.** When a rival comes within reach each city is asked
  fight or run, 30 seconds, by section 7's rules. A clash happens if both
  vote fight. A city that runs pays in fuel, at a price the plan sets.
- **Inputs.** #331 gives each city its own world server, with a small shared
  service for meetings. So no third server runs the clash: both servers
  build the same clash world from the two snapshots and step it in lockstep.
  Each city's gate stamps its inputs with the city, and the shared service
  merges the two queues by tick, then by city, then by arrival. Both servers
  apply and log the merged line, so both reach the same hash at every tick
  and both can replay it.

Turned down: **letting one chat plant flags for the other's citizens,** or
vote in the other's questions. It is the first thing a rival chat would
abuse.

## 12. The first slice

Thirteen issue-sized pieces. Chatters reach all of it through chat; C13 is
the streamer's site, and no piece builds a page for a chatter, an editor or
pairing. C1 to C8, C10, C12 and C13 can be built on the world as it is
today, with the camp's ground standing in for the deck and today's
places (`river`, `hills`) for a site's. C9 needs the plan's world map. C11
depends only on C2 and can wait until there is a stream to read.

| Piece                                  | What to build                                                                                                                                                                                                                                                            | Shown to work by                                                                                                                                                                                                                                                                                                                                                                                                                       | Leaves out                                    | After                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------ |
| **C1 Inputs and the log**              | The input kinds as types, the queue and its bound for each account, 32 a tick, the log file beside each snapshot, replay on start, pruning.                                                                                                                              | A test that a snapshot plus its log gives the live hash after a crowd of 50 has joined and ordered for 12,000 ticks; a test that a torn last log line is ignored. Hostile inputs (wrong shapes, 10,000 in a tick) change nothing and never throw. A flood test: 30 accounts sending `!go` at 5 a second for a minute never have more than one `go` each waiting, and another account's order sent during it is applied within 2 ticks. | Every input's effect except `join`.           |                          |
| **C2 The gate and the scripted crowd** | A package with the `ChatEvent` type, the parser, flood control, the ignore list, and the crowd file format as a pure function of file and tick. The capture tool and the viewer's own simulation take `?chat=<file>`.                                                    | Parser tests on garbage, 500-character lines and every command; the same crowd file gives the same inputs twice.                                                                                                                                                                                                                                                                                                                       | The speech filter; a live adapter.            |                          |
| **C3 Joining**                         | `join` makes a citizen from an account: name rule, colours from the id, the shipped program, a queue under the hatch at one per 5 ticks per hatch. The entrance drawn, the slip lettered, "came aboard" merged on the news line. `look`.                                 | A test that 40 joins in a tick are all on deck 110 ticks later in arrival order; a capture of one arrival and of a raid of 40.                                                                                                                                                                                                                                                                                                         | Berths and going below.                       | C1, C2                   |
| **C4 Speech**                          | `say` and `unsay` outside the hash, the filter, bubbles with six slots, priority and the 15-second rule, speech ticks, the emote hop. `look`.                                                                                                                            | A test that the hash is the same with and without speech; filter tests; a capture burst at 2 messages a second with the flicker index under its limit.                                                                                                                                                                                                                                                                                 | The blocked-word list beyond a short default. | C3                       |
| **C5 Params**                          | `param` with `from … to …` and `of …` in Tactics, values on the actor and read at run time, the `param` input, tokens. `stance` and `margin` in the shipped program.                                                                                                     | Compiler tests, including a ninth param and a value out of range; a seeded test that `stance` at `fight` and at `careful` differ in kills and in downs over a landing's length.                                                                                                                                                                                                                                                        | `!run`.                                       | C1                       |
| **C6 The flag**                        | The `go` and `free` inputs, name lookup in the simulation, `flagged`, `flag`, `flag_age`, `flag_down`, `heard`, the followed bit, an order interrupting the current action. The flag rules in the shipped program.                                                       | A test that an order is decided on within 6 ticks; a test that the same `!go` on two programs gives different hauls; a test that a flag under a winning "turn back" is reported as held; a test that a citizen chopping within 6 tiles of its flag is reported as following; a test that a prefix shared by two places is refused and an exact name is not.                                                                            | Flags on a rival's deck.                      | C5                       |
| **C7 Orders on screen**                | The slip and its glyph, the flag solid or in outline, the line to a flagged citizen, the order strip with merging, refusals, `!me`. `look`.                                                                                                                              | Captures of an accepted, a held and an ignored order, and of 60 orders in 10 seconds with the strip readable. A judge given a frame names who was ordered where and whose program refused.                                                                                                                                                                                                                                             | The vote display.                             | C6, C3                   |
| **C8 Quiet and berths**                | Last-heard on the citizen, present and away in slip and bubble priority, going below after 24 hours, the store of records, `wake`, the berth rule, "at the hatch" and "below" counts.                                                                                    | A test that a citizen below and woken has the record it left with and the world's hash matches a replay; a test that a flood of 300 new accounts displaces no present citizen.                                                                                                                                                                                                                                                         | Deleting records after a year.                | C3                       |
| **C9 Questions**                       | The question as world state, `vote`, who may vote, ties, the landing question, pennants on the routes, the page's bars. `look`.                                                                                                                                          | A test that a changed vote counts once and that a fresh account's vote does not count; a capture of 80 votes in a minute.                                                                                                                                                                                                                                                                                                              | The toll and rival questions.                 | C3, the plan's world map |
| **C10 Moderation**                     | `delete` and `clear` mirrored, mute, `!idlin` commands by role, the name filter with generated names, the bot ignore list.                                                                                                                                               | Tests for each command from a viewer (refused) and a moderator (applied); a banned account's citizen is below on the next tick.                                                                                                                                                                                                                                                                                                        |                                               | C4, C8                   |
| **C11 The Twitch adapter**             | Recorded IRC lines to `ChatEvent`s, reconnecting, anonymous and read-only.                                                                                                                                                                                               | Tests on recorded lines only, with no network. A check that the package has no call that sends a chat message.                                                                                                                                                                                                                                                                                                                         | Any other platform.                           | C2                       |
| **C12 Choosing a preset**              | The presets in `content/` with a name and a line each, the list on offer as world state, `!run <preset>` taking effect on deck, params carried by name, the offered presets and their commands lettered on the page, the count on each in the reckoning. `look`.         | A test that a swap in the middle of a walk waits until the citizen is on deck and keeps `margin`; a test that `!run` with a name not on offer is refused and changes nothing; a seeded test that two presets given the same `!go` differ in haul.                                                                                                                                                                                      | Programs written by chatters.                 | C5                       |
| **C13 The streamer's site**            | A page served to the local machine only: settings (channel, ignore list, blocked words, bubbles, doors), moderation (mute, below, allow, clear hatch) and the presets on offer with the one newcomers start on. Each control that changes the world sends a `mod` input. | A test that each control sends the same input as its `!idlin` command; a test that a preset taken off the list is refused by `!run` on the next tick and kept by citizens already on it; a test that the site's socket refuses a connection from another address.                                                                                                                                                                      | Any page for chatters; a login.               | C10, C12                 |

Three can start at once without touching the same files: C1 is the server
and the store, C2 is a new package, and C5's `param` syntax and run-time
values are the compiler and the VM. C5's `param` input and its tokens go in
the `Input` union and `applyInput`, which C1 writes, so that half of C5
waits for C1.

**What the slice is judged on.** A judge plays a chatter through the local
chat page with a scripted crowd of 50 round them: says hello, finds their
citizen, sends it somewhere, changes its stance, swaps its preset, and writes
down for each step how long it took to see the result and whether they could
tell their preset and its numbers had made the difference. "I typed and could not tell what happened"
is a fail.

## 13. Where this is weak

- **Stream delay.** The simulation answers in under a second and the chatter
  sees it several seconds later. Marks on the map that last 6 seconds are
  the answer, and it has not been tried. A row on the order strip lasts 3.
- **150 flags** on a landing may be clutter. If the captures say so, flags
  of away citizens are not drawn.
- **Silent watchers** are counted as away. A chatter who watches for an
  hour without typing loses their slip priority after 20 minutes. With no
  page for a chatter to open, typing is the only sign there is.
- **A handful of presets.** With no programs from chatters, a city is 150
  citizens on four programs, told apart by their params and their flags. The
  design's claim that the program is the subject then rests on the presets
  differing enough to be worth choosing between, which C12's seeded test
  checks for one pair and a capture has to show for the rest.
- **A chatter cannot read a preset.** The page letters its name, its line
  and its commands, and never its rules. "held by turn back" on the strip is
  the only view of the rules a chatter gets.
- **Params are 8 numbers.** A preset that wants a richer command, such as a
  named target for a move, has only the flag.
- **Contested landings and trade in transit** are on #331's list for city
  against city, and section 11 does not say how chat behaves in either.
- **An empty city.** With no house citizens, a stream whose chat was silent
  for a day has nobody on deck (section 5).

**Where this page and the walking-city draft differ,** as the draft stands
in [#335](https://github.com/nnamon/Idlin/pull/335). The first two follow a
rule the operator set on #331 and the third the operator's scope for now.
The rest are this page's choices and the plan can overrule them:

| Point                     | The draft                                                                                           | This page                                                                         | Why                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Missing the lift          | The stranded walk the trail, and chat can vote `!wait` to slow the city.                            | The lift never waits and nobody is left outside the screen.                       | The operator dropped the stranded: missing the lift loses the haul and the kit and puts the citizen back aboard. |
| The wrong deck at a break | A captive on the rival's deck.                                                                      | Stripped, and back on its own deck.                                               | Every citizen is always on its own city's screen.                                                                |
| Owners                    | A companion page for each owner, reached by a link sent in chat, with sliders and a program editor. | No page for chatters. Presets chosen and set by chat; the site is the streamer's. | No user-submitted programs for now, and only the streamer has access to the site.                                |
| Arriving                  | At the foot of the ramp before the horde is sighted, aboard at a station otherwise.                 | Up through a hatch, in every phase.                                               | One entrance to build and to learn to look at (section 2).                                                       |
| Going quiet               | Present for 30 minutes; aboard as crew after 3 days; retired after 14.                              | Present for 20 minutes; below after 24 hours.                                     | Section 5.                                                                                                       |
| The landing vote          | `!go a`, `!go b`, `!go c`.                                                                          | `!1`, `!2`, `!3`.                                                                 | `!go` is the flag (section 7).                                                                                   |
| Param changes             | A slider once a minute.                                                                             | Two tokens, one back every 20 s.                                                  | Two changes can go together (section 8).                                                                         |
| `!me`                     | Lettered for 5 s.                                                                                   | 6 s.                                                                              | The 6-second rule for marks (section 2).                                                                         |

Lined up with the draft: the sensor is `lift_eta`, the shipped program's
margin starts at the 250 the draft gives a newcomer, and the three forms of
a meeting are the draft's.
