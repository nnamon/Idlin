# Tactics

Tactics is the language every actor in Idlin is programmed in: adventurers and
monsters alike. A program is a short, ordered list of rules. Each time its actor
has nothing left to do, the rules are read from the top, and the first one whose
condition holds chooses what the actor does next.

```
bot "Early bird"

# Home to the hold once the front is sighted, and stay there.
when lift_eta < 9999 and distance(hold) > 0 as "heading home" -> walk_to(hold)
when lift_eta < 9999 -> wait(60)

# Until then: walk about, rest, walk about.
otherwise -> wander; wait(40); wander
```

Programs live in `content/bots/`, one per file, named `<name>.tac`. Every one of
them is compiled in the gate; a program that does not compile fails the build
with its file, line and column.

## Rules

A rule is `when <condition> -> <what to do>`. A condition holds when its value
is not zero. `otherwise -> …` always holds, so it goes last; nothing may follow
it. A program with no `otherwise` stands still when no rule holds.

A rule may be given a short name with `as "…"`, such as `as "turn back"`.
The name is for where a program's rules are listed with the one in charge
marked, which nothing on screen does yet. Without one, the condition itself
is used.

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

## Params

A program declares the numbers its chatter sets from chat, above its rules
and after the bot line:

```
param margin = 120 from 0 to 240
param stance = gather of gather, fight, careful
param tries = 3
```

- `from … to …` gives the range; a value typed outside it is refused. A param
  with no range takes any whole number from 0.
- `of a, b, c` names the values, which are 0, 1, 2 and on. The default is one
  of them. The names are constants in the program, so `stance == fight` reads,
  and no two params may share one.
- A program may declare 8 params. A param is read like a sensor (`margin * 10`)
  and cannot be set by the program.

Every param is a chat command for the citizens that run the program:
`!margin 150` and `!set margin 150` set a number (`!lean -2` for one whose
range goes below 0), `!stance fight` and `!fight` a named value
(docs/chat.md, section 3.3). The values are kept on the citizen and read at
each decision, so a change needs no compile. Each accepted change costs one
of the citizen's two tokens, which come back one every 200 ticks. If the
program reads the param anywhere, the change also ends what the citizen is
doing at the next tile or the end of its blow, so its program decides again;
a param no instruction reads leaves the citizen to carry on. Setting the
value it already has costs nothing.

## The flag

`!go <where>` plants a citizen's flag, `!home` plants it at home and `!free`
takes it down, at the same cost as a param. A program reads it with
`flagged`, `flag_age`, `flag_down`, and `flag`, which stands for the flag's
place as `hold` stands for the hold's: `walk_to(flag)`, `distance(flag)`. A
flag on a citizen is where that citizen is. Planting or taking down a flag
ends what the citizen is doing, as a param change does, only if the program
reads the flag.

`<where>` is looked up in this order, and the first step that matches wins:
`home`, which is the hold; a compass point (`north` or `n` to `northwest` or
`nw`, the walkable tile nearest a point 12 tiles from the hold that way); a
place, typed with spaces for underscores (`!go fore hatch`); a citizen by username, or `@name` for a citizen only. A
name matches whole, or by a prefix of three letters or more that only one name
in that step has. A word that matches nothing, or a prefix two names in the
step share, is refused.

After each decision the citizen keeps whether its program took the flag: it
followed it if the rule that won reads the flag or comes after one that does,
and it held it if the rule that won is above every rule that reads it. So a
program that keeps its flag rules together, under the rules allowed to
outrank an order, shows who was ordered and which rule said no.

## Places

Each map names its places. A place stands for its position, and can be given
wherever a sensor or an action wants an x and a y: `walk_to(hold)`,
`distance(guns)`. Programs are compiled with the places of the first city's
deck: `aft_hatch` and `fore_hatch`, the two hatches citizens come up
through, `hold` amidships and `guns` at the bow. A landing adds its own,
`ramp` at the foot of the ramp, `city` and its dens and caches, which `!go`
finds but a program cannot name, since a landing is only known once the legs
plant.

## The ground

The world stands on one map at a time, in world coordinates. The city's
ground is its deck while it walks and, from legs-plant to lift-off, the
landing it has set down on with the hull in its middle
(`packages/sim/src/deck.ts`). The deck keeps the same world coordinates on
both, so a place on the deck is in the same spot either way, and nobody
aboard moves when the ground changes. Positions, places, `self_x` and
`self_y` are all in world coordinates.

- The only way between the deck and the ground is the ramp: a step off the
  deck's edge onto the ground is no step, so `walk_to` goes round by the
  ramp, and a knockback stops at the edge. The ramp is up, and not walkable,
  until 3:20 of each cycle.
- `wander` picks a tile anywhere on the ground, deck or landing.
- `distance` is the straight grid line, so it says nothing about how far the
  walk is.

A world can also be made on one fixed map with no cycle (`createWorld`),
which the tests of fights, walks and programs use; the camp's maps are kept
for them in `packages/sim/src/fixtures/`.

## Sensors and actions

Sensors read the world; they go in conditions and values. Actions do something;
they go after `->`. A sensor that takes no values is written without brackets.
The camp's clock and firelight sensors are retired: their numbers stay taken,
and a program that names one does not compile.

<!-- generated: system calls -->

| Name                | Kind   | Takes | What it does                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `self_x`            | sensor | 0     | The tile column this actor stands on.                                                                                                                                                                                                                                                                              |
| `self_y`            | sensor | 0     | The tile row this actor stands on.                                                                                                                                                                                                                                                                                 |
| `hour`              | sensor | 0     | Retired: the camp's game hour.                                                                                                                                                                                                                                                                                     |
| `minute`            | sensor | 0     | Retired: the camp's game minute.                                                                                                                                                                                                                                                                                   |
| `walkable`          | sensor | 2     | 1 if tile (x, y) can be walked on, else 0.                                                                                                                                                                                                                                                                         |
| `distance`          | sensor | 2     | Steps in a straight grid line from here to (x, y).                                                                                                                                                                                                                                                                 |
| `idle`              | action | 0     | Do nothing for a moment.                                                                                                                                                                                                                                                                                           |
| `wait`              | action | 1     | Do nothing for the given number of ticks (5 to 600).                                                                                                                                                                                                                                                               |
| `walk_to`           | action | 2     | Walk to tile (x, y), round anyone in the way; if it is taken or cut off, as near as possible. A way round more than 8 steps longer is taken only after a move got nowhere (`stalled` above 0).                                                                                                                     |
| `wander`            | action | 0     | Walk to a walkable tile chosen at random on the ground this actor stands on.                                                                                                                                                                                                                                       |
| `hp`                | sensor | 0     | This actor's hitpoints.                                                                                                                                                                                                                                                                                            |
| `max_hp`            | sensor | 0     | The most hitpoints this actor can have.                                                                                                                                                                                                                                                                            |
| `threat_x`          | sensor | 0     | The column of the nearest enemy, or this actor's own if there is none.                                                                                                                                                                                                                                             |
| `threat_y`          | sensor | 0     | The row of the nearest enemy, or this actor's own if there is none.                                                                                                                                                                                                                                                |
| `threat_distance`   | sensor | 0     | Steps in a straight grid line to the nearest enemy, or 9999 if there is none.                                                                                                                                                                                                                                      |
| `threat_hp`         | sensor | 0     | The nearest enemy's hitpoints, or 0 if there is none.                                                                                                                                                                                                                                                              |
| `danger`            | sensor | 2     | Ticks until an enemy's attack lands on tile (x, y), or 0 if none is coming.                                                                                                                                                                                                                                        |
| `danger_here`       | sensor | 0     | Ticks until an enemy's attack lands where this actor stands, or 0.                                                                                                                                                                                                                                                 |
| `attack`            | action | 2     | Wind up and strike towards (x, y): an adventurer with its weapon, in the nearest of eight directions; a monster in a line up, down, left or right.                                                                                                                                                                 |
| `step_clear`        | action | 0     | Walk to the nearest tile no enemy attack is about to land on; an ally may be standing there.                                                                                                                                                                                                                       |
| `flee`              | action | 2     | Walk up to three tiles along the way that leads farthest from (x, y); five if it has to go round something that steps into the way and blocks it (a monster for an adventurer, an adventurer for a monster).                                                                                                       |
| `threat_recovering` | sensor | 0     | Ticks after this one that the nearest enemy still needs to get its balance back after its last blow: 0 if it can act on the next tick, or if there is no enemy.                                                                                                                                                    |
| `step_to`           | action | 2     | Take the first step of the way `walk_to` would go to tile (x, y). On a way round people more than 8 steps longer, take the steps up to where the rest of it is not.                                                                                                                                                |
| `stalled`           | sensor | 0     | How many decisions in a row, up to 1000, chose to move (`walk_to`, `wander`, `step_clear`, `flee` or `step_to`) and found nowhere to go. 0 after any other decision.                                                                                                                                               |
| `level`             | sensor | 1     | This adventurer's level, 1 to 99, in a skill: `melee`, `hitpoints`, `woodcutting`, `fishing` or `cooking`. 0 for anything else, and for a monster.                                                                                                                                                                 |
| `xp`                | sensor | 1     | This adventurer's experience in a skill, as for `level`; 0 for anything else.                                                                                                                                                                                                                                      |
| `bag_free`          | sensor | 0     | How many of the bag's 12 slots are empty.                                                                                                                                                                                                                                                                          |
| `carrying`          | sensor | 1     | How many of a good (`logs`, `raw_fish`, `cooked_fish` or `burnt_fish`) are in the bag; 0 for anything else.                                                                                                                                                                                                        |
| `banked`            | sensor | 1     | How many of a good are in this adventurer's bank, as for `carrying`.                                                                                                                                                                                                                                               |
| `at_bank`           | sensor | 0     | 1 if this actor stands next to the bank chest, where it can deposit and withdraw, else 0.                                                                                                                                                                                                                          |
| `deposit`           | action | 2     | At the bank, put up to the given number of a good from the bag into the bank: deposit(logs, 5). Away from it, nothing happens.                                                                                                                                                                                     |
| `withdraw`          | action | 2     | At the bank, take up to the given number of a good out of the bank, as many as there are empty slots for.                                                                                                                                                                                                          |
| `bank_all`          | action | 0     | At the bank, put everything in the bag into the bank.                                                                                                                                                                                                                                                              |
| `node_distance`     | sensor | 1     | Steps in a straight grid line to the nearest free tile beside a node of a kind (`tree`, `old_tree`, `fishing_spot` or `deep_pool`) that stands and that its level allows: 0 when it is standing on one. 9999 if there is none.                                                                                     |
| `node_x`            | sensor | 1     | The column of the tile `node_distance` measures to, or this actor's own if none.                                                                                                                                                                                                                                   |
| `node_y`            | sensor | 1     | The row of the tile `node_distance` measures to, or this actor's own if none.                                                                                                                                                                                                                                      |
| `chop`              | action | 0     | Beside a tree this adventurer may cut, try for a log, then stand for 12 ticks. Without one, or with a full bag, nothing happens.                                                                                                                                                                                   |
| `fish`              | action | 0     | Beside a fishing spot this adventurer may fish, try for a raw fish, as `chop` does.                                                                                                                                                                                                                                |
| `at_fire`           | sensor | 0     | 1 if this actor stands within two steps of a campfire tile, where it can cook, else 0.                                                                                                                                                                                                                             |
| `cook`              | action | 0     | At the fire, cook a raw fish from the bag over a log from the bag, then stand for 18 ticks. The log burns up and the fish comes out cooked, or burnt.                                                                                                                                                              |
| `eat`               | action | 0     | Eat a cooked fish from the bag for up to 6 hitpoints. At full hitpoints, or with none, nothing happens.                                                                                                                                                                                                            |
| `threat_friends`    | sensor | 0     | How many of the nearest enemy's own kind stand within 4 steps of it, not counting itself; 0 if there is no enemy.                                                                                                                                                                                                  |
| `friends_near`      | sensor | 1     | How many of this actor's own kind (citizens, or monsters of its kind), not counting itself or citizens mending after a down, stand within the given number of steps of it; 0 below 0.                                                                                                                              |
| `lit_here`          | sensor | 0     | Retired: whether this actor stood in the camp's firelight.                                                                                                                                                                                                                                                         |
| `threat_lit`        | sensor | 0     | Retired: whether the nearest enemy stood in the camp's firelight.                                                                                                                                                                                                                                                  |
| `threat_moving`     | sensor | 0     | 1 if the nearest enemy is walking (partway through a step, or with more of a walk ahead of it), else 0, and 0 if there is none.                                                                                                                                                                                    |
| `lit_enemies`       | sensor | 0     | Retired: how many of this actor's enemies stood in the camp's firelight.                                                                                                                                                                                                                                           |
| `lit_mending`       | sensor | 0     | Retired: how many citizens lay mending in the camp's firelight.                                                                                                                                                                                                                                                    |
| `weapon_reach`      | sensor | 0     | How many steps out this actor's blow reaches, counting a diagonal step as one: 2 with a blade, 3 with a maul, 4 with a spear, 9 with a bow, and a monster's reach.                                                                                                                                                 |
| `flask`             | sensor | 0     | Drinks left in this actor's flask, 0 to 3; always 0 for a monster.                                                                                                                                                                                                                                                 |
| `drink`             | action | 0     | Drink from the flask for 40% of the most hitpoints this actor can have. At full hitpoints, or with the flask empty, nothing happens.                                                                                                                                                                               |
| `flagged`           | sensor | 0     | What this citizen's flag is on, as its chatter planted it with `!go`: 0 with no flag, 1 for a tile, 2 for a citizen, 3 for home.                                                                                                                                                                                   |
| `flag_x`            | sensor | 0     | The column of the flag, or this actor's own with no flag. `flag` stands for the flag's place: `walk_to(flag)`.                                                                                                                                                                                                     |
| `flag_y`            | sensor | 0     | The row of the flag, or this actor's own with no flag.                                                                                                                                                                                                                                                             |
| `flag_age`          | sensor | 0     | Ticks since the flag was planted, or 0 with no flag.                                                                                                                                                                                                                                                               |
| `flag_down`         | sensor | 0     | 1 if the flag is on a citizen who is down, else 0.                                                                                                                                                                                                                                                                 |
| `heard`             | sensor | 0     | Ticks since this citizen's chatter last typed anything, up to 864000.                                                                                                                                                                                                                                              |
| `lift_eta`          | sensor | 0     | Ticks until lift-off, or 9999 before the front is sighted. Until the shield is built (slice piece 31) it counts as if the shield broke the moment the front reached the bubble: the ticks to the siege and 300 more, and during the siege 300; from the break, the ticks to lift-off. On a world of one map, 9999. |
| `way_home`          | sensor | 0     | Ticks the walk home takes from here: to the hold on the city's deck, or to `camp` on a world of one map that has one. 9999 if there is no way.                                                                                                                                                                     |

<!-- end generated -->

There are ten ticks in a second of stream time. The city's cycle is 7,800
ticks when the landing leaves room for it ([slice.md](slice.md), section 1).

## Fighting

Adventurers and monsters are enemies; nobody else is. Each kind of actor has
hitpoints and one attack. An adventurer has 20 hitpoints, and its blow is the
base blow of its Melee level, `6 + L + L*L/20`: 7 at level 1, 21 at level 10,
times its weapon's share of the hit. One swing in 20 is a crit and does
double. A monster's blow is its kind's `damage`, and monsters do not crit.
What a blow takes off is worked out as section 4.1 of [slice.md](slice.md)
says. Citizens wear no armour yet, so for now a blow on one is the monster's
`damage`, and a citizen's blow is its weapon's share of the blow, less the
armour of a monster of rank `brute` or `elite`.

`attack(x, y)` strikes in the direction of (x, y). It does not land at once.
The tiles it will hit are marked for the length of the wind-up, then the blow
lands on any enemy standing on them, and the attacker needs a moment to
recover. It cannot move or decide anything from the start of the wind-up to the
end of the recovery. A monster strikes in a line as long as its kind's
`reach`, up, down, left or right, whichever is nearer to (x, y). An adventurer
turns to the nearest of eight directions, the diagonals included, and strikes
with its weapon. Every adventurer holds a blade for now; a `spawn` input can
give it another family.

| Weapon  | Tiles it strikes                                          | Wind-up + recovery | Hit  | Knockback | `weapon_reach` |
| ------- | --------------------------------------------------------- | ------------------ | ---- | --------- | -------------- |
| `blade` | an arc: the three tiles facing it and the three beyond    | 2 + 3 ticks        | 100% | a quarter | 2              |
| `maul`  | the nine tiles of the square centred two tiles out        | 5 + 5              | 220% | two tiles | 3              |
| `spear` | a line four tiles long, through everyone on it            | 3 + 3              | 120% | one tile  | 4              |
| `bow`   | an arrow's line, nine tiles; the arrow stops in the first | 3 + 2              | 100% | a quarter | 9              |

The times are at Melee 1. A tick comes off the recovery at Melee 30 and one
off the wind-up at Melee 60. Ground that cannot be walked on is never struck,
and a spear's or a bow's line ends at the first such tile.

An arrow is loosed when the bow's wind-up ends and flies a tile a tick along
its line, so it reaches a monster six tiles off six ticks later. It hits the
first enemy it comes to and stops in it; a monster that has stepped off the
line by then is missed. `weapon_reach` gives the farthest tile a blow
reaches, counting a diagonal step as one, so a program can keep its
distance with a bow and close in with a maul.

A blade or a maul hits a target up to `weapon_reach` steps off, as
`threat_distance` counts them, whichever way it lies. A spear or a bow hits
only along its line, so the target has to be on the same row, the same column
or a diagonal. `threat_distance` counts a diagonal step as two, so on a
diagonal the target is in reach at up to twice `weapon_reach`. This program
strikes only at a target on one of those lines and steps towards any other,
which works for every weapon:

```
when (threat_x == self_x or threat_y == self_y) and threat_distance <= weapon_reach as "strike" -> attack(threat_x, threat_y)
when (threat_x - self_x == threat_y - self_y or threat_x - self_x == self_y - threat_y) and threat_distance <= 2 * weapon_reach as "strike" -> attack(threat_x, threat_y)
otherwise -> step_to(threat_x, threat_y)
```

A hit knocks the monster back along the way the blow faced, in quarter
tiles: a blade's four hits move it a tile. Knockback moves it a whole tile at
a time, and a wall, the deck's edge or someone in its way stops it,
and what is left of the push is lost. A monster that is moved stops walking,
and one winding up a blow takes it with it: the blow lands from where it now
stands, facing the same way. What is left under a tile is put back to 0 when
it next takes a step.

A hit can leave a status, as section 4.2 of [slice.md](slice.md) sets out.
For now the one a program will meet is the stagger: a hit whose physical
part is at least a tenth of a monster's most hitpoints starts its wind-up
again from the beginning, and it cannot be staggered again for 2 seconds. A
maul's 15 at Melee 1 staggers a monster of 159 hitpoints or fewer; citizens
are never staggered. On a landing with an element, a monster deals half its
blow in that element and resists it by 40%, and its hits can burn, chill or
shock a citizen. Burns, chills, freezes and shocks from a citizen's own
blows come with gear that adds an element.

`flask` is how many drinks are left in the flask, 3 when full. `drink` gives
back 40% of the most hitpoints, 8 of an adventurer's 20, and at full
hitpoints, or with the flask empty, nothing happens. A drink comes back for
every 20 kills, counted only while one is missing, and the flask is full
again after a down, which carries the citizen aboard.

`danger(x, y)` and `danger_here` say how many ticks are left before an enemy's
blow lands on a tile, so a program can get out of the way:

```
when danger_here > 0 as "step out" -> step_clear
when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
otherwise -> walk_to(hold)
```

Adventurers walk through each other, so nobody can hold a narrow way against
the rest; monsters and adventurers cannot pass through each other. An actor
that is walking already counts as standing on the tile it is stepping onto,
and a blow lands on every enemy on a marked tile. A monster with no hitpoints
left is gone. A citizen with none is carried aboard with full hitpoints and
rests there for fifteen seconds (see Monsters, below).

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

The camp's `wanderer` and `riverwalker` and both monsters have a rule like this. `homebody`
does not need one: its fighting moves either come before such a rule would or
take turns with a `wait`, and a `wait` sets `stalled` back to 0.

A tile takes one actor, but a deck tile berths two citizens, so a citizen
sent to the deck stops on a deck tile with room, however far round the deck
that is, rather than on the ground beside the hull.

`walk_to` and `step_to` go round people in the way by a way at most 8 steps
longer than the way through them. If there is none, they go to the edge of
the crowd, since a crowd usually moves on. There they find nowhere to go, so
`stalled` is above 0 at the next decision, and then they take the shortest
way round, however long. People who stand still hold an actor up for one
pause. On such a long way round, `step_to` takes the steps up to the first
tile from which the rest is no more than 8 steps longer than the way
through, so that the next `step_to` goes on round instead of back.

`deckhand` is the shipped program, which every chatter's citizen runs. Its
`stance` picks how it fights (`gather` strikes what comes within reach,
`fight` goes at any monster within 8 tiles, `careful` keeps 3 tiles clear),
it turns back to the hold when `lift_eta < margin * 10 + way_home`, and its
flag rules sit together under the ones that may hold an order. Otherwise it
walks about the deck and the landing: there is nothing on a landing to fight
or work until slice pieces 3, 5 and 14.

The camp's three programs, kept as test fixtures in
`packages/sim/src/fixtures/bots/` with the Deckhand as the camp ran it, fight
in different ways. `wanderer` walks up to an
enemy and trades blows. `riverwalker` steps out of every blow it sees coming and
hits back in between, and eats a cooked fish once it is 7 hitpoints down.
`homebody` keeps out of reach and only goes in while the monster is recovering.

They gather. `homebody` cuts the trees within a few tiles of camp and banks
the logs a bagful at a time. `wanderer` does the same, and cuts old trees
once it reaches Woodcutting 15. `riverwalker` catches four fish, cuts a log for each,
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
cooking, below. Besides the Melee level's blow, what can be gathered and the
odds of a try, levels change nothing yet.

Skill, good and node names are known to every program, so they can be passed
to the sensors and actions above: `level(melee)`, `carrying(logs)`,
`node_distance(tree)`.

The bag has 12 slots, and each slot holds one good. Each adventurer also has
its own bank, which holds any number of each good. Banking is done standing
next to a bank tile (`at_bank` says whether this actor is), which the camp's
map has and the deck does not: slice piece 13 banks at the ramp. There,
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

| Kind           | Stands on   | Worked with | Level | Gives      | Experience each | Gives before it runs out | Back after  |
| -------------- | ----------- | ----------- | ----- | ---------- | --------------- | ------------------------ | ----------- |
| `tree`         | a tree      | `chop`      | 1     | `logs`     | 25 Woodcutting  | 6                        | 1,200 ticks |
| `old_tree`     | a dark tree | `chop`      | 15    | `logs`     | 60 Woodcutting  | 10                       | 1,800 ticks |
| `fishing_spot` | water       | `fish`      | 1     | `raw_fish` | 20 Fishing      | 8                        | 600 ticks   |
| `deep_pool`    | water       | `fish`      | 15    | `raw_fish` | 50 Fishing      | 10                       | 1,200 ticks |

A node is worked from a walkable tile beside it. `chop` beside a tree, or
`fish` beside a fishing spot, is one try: with a chance of 25 in 100 at the
level the node needs, 3 more for each level above that, up to 90, one good
goes into the bag and the experience is gained. Either way the actor then
stands for 12 ticks. A node that has given all it has stands empty until it
comes back with its full yield. Without a node beside it that it has the
level for, or with a full bag, a try does nothing and the actor stands for
five ticks.

`node_distance(kind)` is the number of steps to the nearest tile to work a
node of that kind from: beside one that stands and that its level allows, and that nobody else stands on or is walking to. It is 0 when
the actor already stands on one, and 9999 when there is none. `node_x(kind)`
and `node_y(kind)` give that tile, so a program can walk to it:

```
when node_distance(tree) == 0 as "chop" -> chop
when node_distance(tree) < 9999 as "to a tree" -> walk_to(node_x(tree), node_y(tree))
```

The camp's map has twelve trees in the near wood and round the camp, three
old trees in the deep wood, and five fishing spots on the river. The deck
and the landings have none: slice piece 14 brings piles, seams and chests in
place of trees and fishing.

`cook`, within two steps of a campfire tile (`at_fire`; the camp's map has
one, with the `fire` place beside it), cooks the bag's first raw fish over its first log. The log burns
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

A monster kind is a file `<kind>.json`, next to the program it runs,
`<program>.tac`. Monster programs are written in Tactics like any other, and
must not share a name with a citizen's program. No landing has monsters
until slice piece 5 lays its packs, so nothing ships in `content/` yet; the
camp's wolf and goblin are kept as test fixtures in
`packages/sim/src/fixtures/monsters/`, and a `spawn` input puts one on the
ground.

```json
{
  "name": "Wolf",
  "hp": 101,
  "damage": 8,
  "windup": 8,
  "recovery": 20,
  "reach": 2,
  "step": 4,
  "program": "wolf"
}
```

- `name`: what each one is called, a capital letter and up to 15 letters or
  spaces.
- `hp` (1 to 100,000), `damage` (0 to 100,000), `windup` (1 to 100 ticks),
  `recovery` (0 to 100 ticks) and `reach` (1 to 3 tiles): its numbers in a fight.
- `step`: ticks it takes to walk one tile, 2 to 30. Left out, it is 6, which is
  how fast citizens walk.
- `rank` (`fodder`, `pack`, `brute` or `elite`) and `level` (1 to 99): they
  set its armour (four times its level for a brute or an elite), how long a
  status lasts on it, and what part of a hit sets one
  ([slice.md](slice.md), section 4.2). Left out, it is level-1 fodder.

A monster file with a field missing, out of range or unknown is refused with
the file's name, like a program that does not compile. No monster is put on
the city's deck, its ramp or the camp's ground, but one may walk onto them.

A citizen struck down is carried aboard, to the deck tile with room nearest
the hold, and mends there for 15 seconds (`DOWN_TICKS`) before its program
runs again; on a world of one map it is carried to the map's `camp`. While it
mends, blows pass it by and monsters' sensors leave it out: it is nobody's
`threat`, and `friends_near` and `threat_friends` don't count it.

Wolves walk a tile in 4 ticks, so one 8 tiles behind a citizen catches it
after the citizen has walked about 16 more. A wolf counts as its pack itself
and the wolves within ten tiles of it (`friends_near(10)`, which counts only
an actor's own kind), and as its prey's group the prey and the citizens
within four tiles of it (`threat_friends`). It lunges at its prey when it is
in line and in reach, from two tiles off only if the prey is standing, and
at most twice from one tile. Prey within ten tiles whose group is bigger than
the pack by two or more is left alone; bigger by one, it is stalked from four
or five tiles off until more of the pack comes; otherwise it is hunted: run
down while it walks, and circled two tiles off while it stands. With no prey
near it wanders. A wolf whose moves get it nowhere twice in a row while
hunting steps straight at its prey, and wanders off after four.

Goblins rush whoever is near and run once a blow has taken them to half
their hitpoints; one that tries to run and gets nowhere stabs instead if its
enemy is beside it. A goblin whose moves get it nowhere twice in a row
wanders off, and out of a fight it wanders.

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
line 5, column 6: I do not know what "hq" is. Sensors: self_x, self_y, walkable, …
```
