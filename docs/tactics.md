# Tactics

Tactics is the language every actor in Idlin is programmed in: adventurers and
monsters alike. A program is a short, ordered list of rules. Each time its actor
has nothing left to do, the rules are read from the top, and the first one whose
condition holds chooses what the actor does next.

```
bot "Night owl"

# Head home when it gets late, then stay put.
when hour >= 20 and distance(camp) > 0 as "heading home" -> walk_to(camp)
when hour >= 20 -> wait(60)

# By day: go to the river, rest there, wander back.
otherwise -> walk_to(river); wait(40); wander
```

Programs live in `content/bots/`, one per file, named `<name>.tac`. Every one of
them is compiled in the gate; a program that does not compile fails the build
with its file, line and column.

## Rules

A rule is `when <condition> -> <what to do>`. A condition holds when its value
is not zero. `otherwise -> …` always holds, so it goes last; nothing may follow
it. A program with no `otherwise` stands still when no rule holds.

A rule may be given a short label with `as "…"`. The label is what viewers see
beside the character while the rule is in charge. Without one, the condition
itself is shown.

The first line may name the bot: `bot "Lumberjack"`.

A `#` starts a comment that runs to the end of the line. A long rule can be
wrapped after `->`, `;`, `,`, an operator, or inside brackets.

## What to do

After `->` comes an action, or several separated by `;`.

- One action: the actor does it.
- Several actions: the actor does them in order, one each time it is asked, for
  as long as this rule stays the one in charge. If another rule takes over, the
  sequence starts from the beginning the next time.
- `set name = value` before an action stores a value in the program's memory.
  A rule must end with an action.

## Values

- Whole numbers, from -2147483647 to 2147483647. Arithmetic wraps around at
  those limits. A `%` after a number is only for reading: `40%` is 40.
- `+ - * /` and `mod` for the remainder (there is no `%` operator). Division drops the remainder. Dividing by zero stops the
  decision: the actor stands confused for a moment, then tries again.
- Comparisons `< <= > >= == !=` give 1 or 0. They don't chain: write
  `a < b and b < c`, not `a < b < c`.
- `and`, `or`, `not`. The right side of `and` and `or` is only worked out when
  the left side has not already settled the answer.
- Brackets group. `*`, `/` and `mod` bind tighter than `+` and `-`, which bind
  tighter than comparisons, then `not`, then `and`, then `or`.

## Memory

`set trips = trips + 1` stores a value under a name of your choosing. Memory is
kept between decisions and starts at 0. A program can remember up to 15
things. A decision that is stopped by a mistake changes nothing in memory.

## Places

Each map names its places. A place stands for its position, and can be given
wherever a sensor or an action wants an x and a y: `walk_to(camp)`,
`distance(river)`. The shipped world has `camp`, `bank`, `fire`, `near_wood`,
`deep_wood`, `den`, `river` and `meadow` in the camp's region, `pinewood` in
the pinewood, `hills` and `caves` in the hills, and `lower_river` and `reeds`
by the lower river.

## Regions

The world is several regions, each a map from `content/maps/` set down at its
own place in one grid of world coordinates, as `content/world.json` lists
them. Positions, places, `self_x` and `self_y` are all in world coordinates,
so a program never needs to know which region something is in. The regions
are joined by exits: pairs of side-by-side tiles on two regions' edges. Every
other edge is closed, even where two regions touch.

- `walk_to` and `step_to` find the way through exits, so `walk_to(hills)` from
  camp walks along the road, over the bridge and out of the camp's region at
  its east edge into the hills.
- `wander` picks a tile in the region the actor is in. Going somewhere else is
  something a program decides with `walk_to`.
- An actor sees only the enemies in its own region (`threat_x`,
  `threat_distance` and the rest), and blows stop at a region's edge.
- Monsters keep to the region they came out in: they never cross an exit.
- `distance` is the straight grid line in world coordinates, straight across
  closed borders, so it says nothing about how far the walk is. A place in
  the next region can be close by `distance` and a long way round on foot.

The shipped world is the camp's region at (0, 0), with the pinewood west of
it, the hills east of it and the lower river south of it, each 30 by 21
tiles. Each exit is on an edge of the camp's region: the west one through the
deep wood at (0, 7), the east one at the end of the road at (29, 8), and the
south one by the river at (12, 20).

## Sensors and actions

Sensors read the world; they go in conditions and values. Actions do something;
they go after `->`. A sensor that takes no values is written without brackets.

<!-- generated: system calls -->
| Name                | Kind   | Takes | What it does                                                                                                                                                                                                                                              |
| ------------------- | ------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_x`            | sensor | 0     | The tile column this actor stands on.                                                                                                                                                                                                                     |
| `self_y`            | sensor | 0     | The tile row this actor stands on.                                                                                                                                                                                                                        |
| `hour`              | sensor | 0     | The game hour, 0 to 23.                                                                                                                                                                                                                                   |
| `minute`            | sensor | 0     | The game minute, 0 to 59.                                                                                                                                                                                                                                 |
| `walkable`          | sensor | 2     | 1 if tile (x, y) can be walked on, else 0.                                                                                                                                                                                                                |
| `distance`          | sensor | 2     | Steps in a straight grid line from here to (x, y).                                                                                                                                                                                                        |
| `idle`              | action | 0     | Do nothing for a moment.                                                                                                                                                                                                                                  |
| `wait`              | action | 1     | Do nothing for the given number of ticks (5 to 600).                                                                                                                                                                                                      |
| `walk_to`           | action | 2     | Walk to tile (x, y), round anyone in the way; if it is taken or cut off, as near as possible.                                                                                                                                                             |
| `wander`            | action | 0     | Walk to a walkable tile chosen at random in the region this actor is in.                                                                                                                                                                                  |
| `hp`                | sensor | 0     | This actor's hitpoints.                                                                                                                                                                                                                                   |
| `max_hp`            | sensor | 0     | The most hitpoints this actor can have.                                                                                                                                                                                                                   |
| `threat_x`          | sensor | 0     | The column of the nearest enemy, or this actor's own if there is none.                                                                                                                                                                                    |
| `threat_y`          | sensor | 0     | The row of the nearest enemy, or this actor's own if there is none.                                                                                                                                                                                       |
| `threat_distance`   | sensor | 0     | Steps in a straight grid line to the nearest enemy, or 9999 if there is none.                                                                                                                                                                             |
| `threat_hp`         | sensor | 0     | The nearest enemy's hitpoints, or 0 if there is none.                                                                                                                                                                                                     |
| `danger`            | sensor | 2     | Ticks until an enemy's attack lands on tile (x, y), or 0 if none is coming.                                                                                                                                                                               |
| `danger_here`       | sensor | 0     | Ticks until an enemy's attack lands where this actor stands, or 0.                                                                                                                                                                                        |
| `attack`            | action | 2     | Wind up and strike in a line out from this actor, in the direction of (x, y).                                                                                                                                                                             |
| `step_clear`        | action | 0     | Walk to the nearest tile no enemy attack is about to land on; an ally may be standing there.                                                                                                                                                              |
| `flee`              | action | 2     | Walk up to three tiles along the way that leads farthest from (x, y); five if it has to go round something that steps into the way and blocks it (a monster for an adventurer, an adventurer for a monster).                                              |
| `threat_recovering` | sensor | 0     | Ticks after this one that the nearest enemy still needs to get its balance back after its last blow: 0 if it can act on the next tick, or if there is no enemy.                                                                                           |
| `step_to`           | action | 2     | Take the first step of the way `walk_to` would go to tile (x, y).                                                                                                                                                                                         |
| `stalled`           | sensor | 0     | How many decisions in a row, up to 1000, chose to move (`walk_to`, `wander`, `step_clear`, `flee` or `step_to`) and found nowhere to go. 0 after any other decision.                                                                                      |
| `level`             | sensor | 1     | This adventurer's level, 1 to 99, in a skill: `melee`, `hitpoints`, `woodcutting`, `fishing` or `cooking`. 0 for anything else, and for a monster.                                                                                                        |
| `xp`                | sensor | 1     | This adventurer's experience in a skill, as for `level`; 0 for anything else.                                                                                                                                                                             |
| `bag_free`          | sensor | 0     | How many of the bag's 12 slots are empty.                                                                                                                                                                                                                 |
| `carrying`          | sensor | 1     | How many of a good (`logs`, `raw_fish`, `cooked_fish` or `burnt_fish`) are in the bag; 0 for anything else.                                                                                                                                               |
| `banked`            | sensor | 1     | How many of a good are in this adventurer's bank, as for `carrying`.                                                                                                                                                                                      |
| `at_bank`           | sensor | 0     | 1 if this actor stands next to the bank chest, where it can deposit and withdraw, else 0.                                                                                                                                                                 |
| `deposit`           | action | 2     | At the bank, put up to the given number of a good from the bag into the bank: deposit(logs, 5). Away from it, nothing happens.                                                                                                                            |
| `withdraw`          | action | 2     | At the bank, take up to the given number of a good out of the bank, as many as there are empty slots for.                                                                                                                                                 |
| `bank_all`          | action | 0     | At the bank, put everything in the bag into the bank.                                                                                                                                                                                                     |
| `node_distance`     | sensor | 1     | Steps in a straight grid line to the nearest free tile beside a node of a kind (`tree`, `old_tree`, `fishing_spot` or `deep_pool`) that stands, is in this actor's region and that its level allows: 0 when it is standing on one. 9999 if there is none. |
| `node_x`            | sensor | 1     | The column of the tile `node_distance` measures to, or this actor's own if none.                                                                                                                                                                          |
| `node_y`            | sensor | 1     | The row of the tile `node_distance` measures to, or this actor's own if none.                                                                                                                                                                             |
| `chop`              | action | 0     | Beside a tree this adventurer may cut, try for a log, then stand for 12 ticks. Without one, or with a full bag, nothing happens.                                                                                                                          |
| `fish`              | action | 0     | Beside a fishing spot this adventurer may fish, try for a raw fish, as `chop` does.                                                                                                                                                                       |
| `at_fire`           | sensor | 0     | 1 if this actor stands within two steps of the camp fire, where it can cook, else 0.                                                                                                                                                                      |
| `cook`              | action | 0     | At the fire, cook a raw fish from the bag over a log from the bag, then stand for 18 ticks. The log burns up and the fish comes out cooked, or burnt.                                                                                                     |
| `eat`               | action | 0     | Eat a cooked fish from the bag for up to 6 hitpoints. At full hitpoints, or with none, nothing happens.                                                                                                                                                   |
<!-- end generated -->

There are ten ticks in a second of stream time, and a game hour lasts one
minute.

## Fighting

Adventurers and monsters are enemies; nobody else is. Each kind of actor has
hitpoints and one attack. An adventurer has 20 hitpoints and hits for 4.

`attack(x, y)` strikes in the direction of (x, y): up, down, left or right,
whichever is nearer to it. It does not land at once. The tiles it will hit are
marked for the length of the wind-up (six ticks for an adventurer), then the
blow lands on any enemy standing on them, and the attacker needs a moment to
recover. It cannot move or decide anything from the start of the wind-up to the
end of the recovery.

`danger(x, y)` and `danger_here` say how many ticks are left before an enemy's
blow lands on a tile, so a program can get out of the way:

```
when danger_here > 0 as "step out" -> step_clear
when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
otherwise -> walk_to(camp)
```

Adventurers walk through each other, so nobody can hold a narrow way against
the rest; monsters and adventurers cannot pass through each other. An actor
that is walking already counts as standing on the tile it is stepping onto,
and a blow lands on every enemy on a marked tile. A monster with no hitpoints left is gone. An adventurer wakes at camp
with full hitpoints and rests there for fifteen seconds. It wakes on the
nearest tile nobody stands on or is walking to; if there is none, on the
nearest tile nobody stands on, though someone may be walking to it; and if
every tile is taken, where it fell.

`threat_recovering` says how long the nearest enemy still needs to get its
balance back after a blow, which is the safe time to hit it. `step_to(x, y)`
takes a single step towards a tile, so a program can close in on an enemy and
still look again after every step; `walk_to` goes all the way before the
program is asked again.

A move that finds nowhere to go (a `flee` from a corner, a `walk_to` the actor
is already at, a `step_to` with the way blocked) leaves the actor standing for
five ticks before it decides again. `stalled` counts those decisions in a row,
so a program can notice it is getting nowhere and do something else:

```
when stalled >= 3 as "find another way" -> wander
```

`wanderer`, `riverwalker` and both monsters have a rule like this. `homebody`
does not need one: its fighting moves either come before such a rule would or
take turns with a `wait`, and a `wait` sets `stalled` back to 0.

The three resident programs fight in different ways. `wanderer` walks up to an
enemy and trades blows. `riverwalker` steps out of every blow it sees coming and
hits back in between, and eats a cooked fish once it is 7 hitpoints down.
`homebody` keeps out of reach and only goes in while the monster is recovering.

By day they gather. `homebody` cuts the trees within a few tiles of camp and
banks the logs a bagful at a time. `wanderer` does the same, with its bags
taken in turn from the camp's trees and the lower river's, and from the
pinewood's old trees once it reaches Woodcutting 15; it leaves for another
region only before 17:00. `riverwalker` catches four fish, cuts a log for each,
cooks them at the fire, and banks the burnt ones and every cooked fish past
three, which it keeps in the bag to eat in a fight.

## Skills and the bank

An adventurer has five skills: `melee`, `hitpoints`, `woodcutting`, `fishing`
and `cooking`. Each has its own experience and a level from 1 to 99 that comes
from it. Level 2 takes 83 experience, level 10 takes 1,154, and each level
after that takes about a tenth more than the one before, so level 99 is at
13,034,431. Experience stops at 200,000,000.

Experience only comes from doing the thing. Every hitpoint an adventurer's
blow takes off a monster is 4 Melee experience, and every hitpoint a
monster's blow takes off an adventurer is 4 Hitpoints experience. A blow that
finishes a monster with 2 hitpoints left counts 2, whatever it would have
done. Woodcutting, Fishing and Cooking experience come from gathering and
cooking, below. Besides what can be gathered and the odds of a try, levels
change nothing yet.

Skill, good and node names are known to every program, so they can be passed
to the sensors and actions above: `level(melee)`, `carrying(logs)`,
`node_distance(tree)`.

The bag has 12 slots, and each slot holds one good. Each adventurer also has
its own bank, which holds any number of each good. Banking is done standing
next to the bank chest at camp (`at_bank` says whether this actor is). There,
`deposit(logs, 5)` moves up to five logs from the bag into the bank, and
`withdraw(cooked_fish, 3)` takes up to three out, as many as there are empty
slots for. `bank_all` deposits everything. A count larger than there is moves
what there is; away from the chest, or with a count below 1 or a name that is
not a good, nothing happens. Either way the actor then stands for five ticks.

```
when bag_free == 0 and at_bank == 0 as "bag full" -> walk_to(bank)
when at_bank and bag_free < 12 as "banking" -> bank_all
```

## Gathering, cooking and eating

The goods are `logs`, `raw_fish`, `cooked_fish` and `burnt_fish`. Logs and raw
fish come from nodes: trees and fishing spots that each map lists under
`nodes`, by kind and tile.

| Kind           | Stands on   | Worked with | Level | Gives      | Experience each | Gives before it runs out | Back after   |
| -------------- | ----------- | ----------- | ----- | ---------- | --------------- | ------------------------ | ------------ |
| `tree`         | a tree      | `chop`      | 1     | `logs`     | 25 Woodcutting  | 6                        | 2 game hours |
| `old_tree`     | a dark tree | `chop`      | 15    | `logs`     | 60 Woodcutting  | 10                       | 3 game hours |
| `fishing_spot` | water       | `fish`      | 1     | `raw_fish` | 20 Fishing      | 8                        | 1 game hour  |
| `deep_pool`    | water       | `fish`      | 15    | `raw_fish` | 50 Fishing      | 10                       | 2 game hours |

A node is worked from a walkable tile beside it. `chop` beside a tree, or
`fish` beside a fishing spot, is one try: with a chance of 25 in 100 at the
level the node needs, 3 more for each level above that, up to 90, one good
goes into the bag and the experience is gained. Either way the actor then
stands for 12 ticks. A node that has given all it has stands empty until it
comes back with its full yield. Without a node beside it that it has the
level for, or with a full bag, a try does nothing and the actor stands for
five ticks.

`node_distance(kind)` is the number of steps to the nearest tile to work a
node of that kind from: beside one that stands, is in this actor's region and
its level allows, and that nobody else stands on or is walking to. It is 0 when
the actor already stands on one, and 9999 when there is none. `node_x(kind)`
and `node_y(kind)` give that tile, so a program can walk to it:

```
when node_distance(tree) == 0 as "chop" -> chop
when node_distance(tree) < 9999 as "to a tree" -> walk_to(node_x(tree), node_y(tree))
```

The camp's region has twelve trees in the near wood and round the camp, three
old trees in the deep wood, and five fishing spots on the river. The lower
river has six trees, three fishing spots and three deep pools, and the
pinewood six old trees. The hills have none.

`cook`, within two steps of the camp fire (`at_fire`, and the `fire` place
beside it), cooks the bag's first raw fish over its first log. The log burns
up, and the fish comes out cooked, or burnt with a chance of 30 in 100 at
Cooking level 1 and 2 fewer for each level, so none burn from level 16. A
cooked fish gives 30 Cooking experience and a burnt one none. The actor then
stands for 18 ticks. Without a raw fish and a log, or away from the fire,
nothing happens.

`eat` eats the bag's first cooked fish and gives back up to 6 hitpoints. It is
over as quickly as any action that ends at once, so it can be done between
blows in a fight. At full hitpoints, or with no cooked fish, nothing happens
and the fish is kept. A burnt fish cannot be eaten.

## Monsters

Each monster kind is a file in `content/monsters/`, `<kind>.json`, next to the
program it runs, `<program>.tac`. Monster programs are written in Tactics like
any other, and must not share a name with a program in `content/bots/`.

```json
{
  "name": "Wolf",
  "hp": 24,
  "damage": 8,
  "windup": 8,
  "recovery": 20,
  "reach": 2,
  "program": "wolf",
  "group": 1,
  "day": ["deep_wood"],
  "night": ["near_wood"]
}
```

- `name`: what each one is called, a capital letter and up to 15 letters or
  spaces.
- `hp` (1 to 100,000), `damage` (0 to 100,000), `windup` (1 to 100 ticks),
  `recovery` (0 to 100 ticks) and `reach` (1 to 3 tiles): its numbers in a fight.
- `group`: how many arrive together, 1 to 3.
- `day` and `night`: the world's places they come out at, by day and from
  19:00 to 06:00. Either list may be empty, and the places may be in any
  regions.

Each region spawns on its own. Every game hour at most, one group arrives in a
region, all of it on free tiles within two steps of one of its places in that
region for the time of day, chosen at random. A region holds at most three
monsters at once, and a group only comes if all of it fits under that cap,
fits near its place, and leaves the region under its crowd target: one actor,
resident or monster, for every 25 of its walkable tiles (17 to 19 in the
shipped regions). If the place is too crowded, none of it comes and the
region's hour starts again. The hour also starts again whenever a monster in
the region goes down or is put in by hand, and on every tick it holds three,
so one that dies is replaced an hour later at the earliest. The shipped wolves
and goblins come out at `deep_wood`, `den` and `near_wood`, all on the camp's
map, so the other regions have no monsters yet. A monster file with a field
missing, out of range or unknown, a list with gaps, or a place the map doesn't
have, is refused with the file's name, like a program that does not compile.

Monsters from the spawn table go home at the end of the part of the day they
came out for: day ones at 19:00, night ones at 06:00. Each goes as soon as no
adventurer in its region is within eight steps of it and it is not in the middle of a blow,
so one still fighting stays until it is clear. That leaves room for the next
part of the day's monsters. Monsters never step onto the camp's ground (its
`camp` tiles), though their blows reach onto it.

The wolf circles its prey two tiles off and lunges from two tiles away, at
most twice from one tile before it circles again. Goblins come in threes, rush
whoever is near and run once a blow has taken them to half their hitpoints; one
that tries to run and gets nowhere stabs instead if its enemy is beside it. A
goblin whose moves get it nowhere twice in a row wanders off. A wolf whose
circling gets it nowhere twice in a row steps straight at its prey, and wanders
off after four. By day both turn back to
where they came out when they come within four tiles of `camp`, and by night
within three, which brings them up to the camp's edge.

When two blows land on the same tick, the one from whoever has been in the
world longer lands first, and someone it takes out does not get their own blow
in.

## Limits

- Source: at most 20,000 characters and 63 rules.
- One rule: at most 600 numbers, names and operators, at most 32 actions in
  sequence, and brackets, `not` and minus signs nested at most 48 deep.
- Compiled: at most 4,096 words, and at most 2,000 steps in total. A decision
  never runs a step twice, so a program that compiles always finishes its
  decision; the only thing that can stop one is dividing by zero.
- An actor standing still is asked for a decision at most once every five
  ticks.

Bot names and rule labels are shown to viewers in the stream's typeface, so
only Latin letters, digits and common punctuation are kept in them, and long
ones are cut short.

## When something is wrong

The compiler never guesses. It reports the mistakes it finds in one go (the
first ten), each with its line and column and a sentence saying what it
expected:

```
line 3, column 15: I expected "->" after the condition, but found "wander"
line 5, column 6: I do not know what "hp" is. Sensors: self_x, self_y, hour, …
```
