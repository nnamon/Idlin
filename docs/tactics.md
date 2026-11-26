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
`distance(river)`. The first map has `camp`, `bank`, `river`, `near_wood`,
`deep_wood`, `den` and `meadow`.

## Sensors and actions

Sensors read the world; they go in conditions and values. Actions do something;
they go after `->`. A sensor that takes no values is written without brackets.

<!-- generated: system calls -->
| Name       | Kind   | Takes | What it does                                         |
| ---------- | ------ | ----- | ---------------------------------------------------- |
| `self_x`   | sensor | 0     | The tile column this actor stands on.                |
| `self_y`   | sensor | 0     | The tile row this actor stands on.                   |
| `hour`     | sensor | 0     | The game hour, 0 to 23.                              |
| `minute`   | sensor | 0     | The game minute, 0 to 59.                            |
| `walkable` | sensor | 2     | 1 if tile (x, y) can be walked on, else 0.           |
| `distance` | sensor | 2     | Steps in a straight grid line from here to (x, y).   |
| `idle`     | action | 0     | Do nothing for a moment.                             |
| `wait`     | action | 1     | Do nothing for the given number of ticks (5 to 600). |
| `walk_to`  | action | 2     | Walk to tile (x, y) by the shortest way.             |
| `wander`   | action | 0     | Walk to a walkable tile chosen at random.            |
<!-- end generated -->

There are ten ticks in a second of stream time, and a game hour lasts one
minute.

## Limits

- Source: at most 20,000 characters and 63 rules.
- One rule: at most 600 numbers, names and operators, at most 32 actions in
  sequence, and brackets, `not` and minus signs nested at most 48 deep.
- Compiled: at most 4,096 words, and at most 2,000 steps in total. A decision
  never runs a step twice, so a program that compiles always finishes its
  decision; the only thing that can stop one is dividing by zero.
- An actor standing still is asked for a decision at most once every five
  ticks.

Bot names and rule labels are shown to viewers, so invisible and control
characters are removed from them and long ones are cut short.

## When something is wrong

The compiler never guesses. It reports every mistake it can find in one go,
each with its line and column and a sentence saying what it expected:

```
line 3, column 15: I expected "->" after the condition, but found "wander"
line 5, column 6: I do not know what "hp" is. Sensors: self_x, self_y, hour, …
```
