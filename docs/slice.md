# The slice

One 13-minute cycle of the walking city, specified to build from. It is the
spec for [#361](https://github.com/nnamon/Idlin/issues/361) and replaces the
milestones that were in [plan.md](plan.md). None of it is built. Every rate
is arithmetic from a rule on this page; section 11 names the piece that
tests the rule.

Fixed by the operator and not reopened here: one streamer is one city; every
chatter is a citizen; every citizen is on one screen at all times; the zoom
is the pacing; the horde is the clock; missing lift-off costs haul and gear;
the streamer alone decides for the city, every decision has a default, and
nothing is voted on; chatters steer only their own citizen, through chat
([chat.md](chat.md)); rival cities come later.

**Words.** A citizen's **haul** is what it carries and has not banked.
**Worn** is the gear on its body. Aboard it has a **stash** of 12 numbered
slots, three **kits** (a coat and a charm against each element), a **rack**
for uniques and a **purse** of up to 40 salvage; nothing takes any of them.
The **hold** is the city's salvage. A **tool** is a currency item: a Reroll,
an Add or an Acid. **Present** is chat.md's word: the chatter typed in the
last 20 minutes. Otherwise they are **away**.

**Names.** A citizen's name is its chatter's username as typed: 3 to 25
characters with digits, underscores and mixed case, such as `joshyboy88`,
`xXxKittyKatxXx` or `goofguy`. No invented resident names appear anywhere.
A username that fails the name filter is shown as `citizen` and the last
four digits of its account id (`citizen4821`), and answers to that in
`!go`. Until a real chat is read, the crowd files
(`content/chat/crowd-15.txt`, `crowd-150.txt`) list usernames of that kind,
and every capture, test and example uses them. A name is always shown
whole. `!go` matches any prefix of three or more characters that only one
name has, ignoring case.

## 1. The cycle and the landing

Ten ticks a second, 7,800 ticks a cycle. A broken leg or a run from raiders
can bring the sighting forward (sections 7 and 9). The horn, the hull and
the lift never move.

| Clock |  Tick | Beat                                                       | Frame                           |
| ----- | ----: | ---------------------------------------------------------- | ------------------------------- |
| 0:00  |     0 | Ramp up, legs lift. Transit.                               | close on the cut-away city      |
| 1:00  |   600 | A raider rig is sighted. Lines land at 1:20; over by 2:50. | widens to hold both machines    |
| 3:00  | 1,800 | Legs plant. The landing is inked outward from the city.    | one pull back, 6 to 8 s         |
| 3:20  | 2,000 | Ramp down. The expedition.                                 | the whole landing               |
| 8:00  | 4,800 | The horde comes in at one edge, with runners ahead of it.  | the same, the dark side growing |
| 11:00 | 6,600 | The horn. The winch stops. The last wave comes.            | the same                        |
| 12:30 | 7,500 | The horde reaches the hull. Fighting at the ramp.          | the same, mostly black          |
| 13:00 | 7,800 | Ramp up. Anyone outside is winched aboard and stripped.    | closes on the city in 4 s       |

**A bigger landing is a harder one.** The tile counts follow art.md's figure sizes and
stand until the look target (#362) says how small a citizen can be drawn and
how much of the frame the caption and the order strip take.

| Size   | Tiles    | A tile at 1920 | Dens | Chests | The far level is the top citizen's Arms plus |
| ------ | -------- | -------------: | ---: | -----: | -------------------------------------------: |
| Small  | 40 by 22 |          48 px |    1 |      1 |                                            7 |
| Medium | 60 by 33 |          32 px |    3 |      2 |                                           10 |
| Large  | 80 by 45 |          24 px |    5 |      3 |                                           15 |

A landing also gets one den and one chest more for each 15 citizens awake.
The city parks off-centre, away from the horde's edge (art.md, section 12),
with the ramp facing the land; the generator (#364) should place it so.

**Level and ground.** A landing has a **level**, which the navigator sets
(section 9), and a **far level**, set in transit when the landing is chosen:
the highest Arms among the citizens awake, or the landing's level if that is
higher, plus the size's number above, and 99 at most. Every tile has a **ground level** from
its walking distance to the ramp, as a share of the longest walk on that
landing:

| Ground   | Where            | Its level                                                                                                               |
| -------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The yard | within 8 tiles   | ring 1's, and 5 at most                                                                                                 |
| Ring 1   | the first third  | rises evenly with the walk from a third of the landing's level (rounded down, 1 at least) to the landing's level        |
| Ring 2   | the second third | the landing's level                                                                                                     |
| Ring 3   | the last third   | its inner half rises evenly with the walk from the landing's level to the far level; its outer half is at the far level |

A standing monster has the level of the ground it starts on, a sent one the
level of the ground its citizen stood on, and a drop has the item level of
its monster. So the roster's median fights in ring 2, a newcomer in the yard
and the near end of ring 1, and every citizen between has ground of its own
level somewhere on the plate. The strongest citizen aboard always has a
sixth of the longest walk at 7 to 15 levels over its own, whatever the
median is, and ground of its own level on the way there. On a level-23
medium landing whose strongest citizen has Arms 58, ring 1 runs from 7 to
23, the inner half of ring 3 from 23 to 68, and the outer half is 68
throughout. The plate shows the level at each ring's inner edge and at the
far edge, and beside each den's name. The longest walk on a large landing is
about 28 seconds unloaded and 43 with a full bag.

The horde comes in at the far edge, so the far ground is the first it takes:
the outer half of ring 3 is gone by about 8:45. A citizen that works it has
the 2,800 ticks from ramp-down to the sighting, less its walk out, and then
falls back with the horde behind it.

**Element.** The biome gives the landing one: none for meadow and pinewood,
cold for fen, lightning for crags, fire for ash waste (section 4).

**Monsters.** Ranks, formulas and step times are [plan.md](plan.md)'s. A
monster's blow is wind-up plus recovery in ticks: fodder 3 + 6, pack 4 + 8,
brute 6 + 14, elite 5 + 10.

- **Standing.** At ramp-down the plate holds one monster for every 20 tiles
  (99 on a medium landing): 70% fodder in groups of 6 to 8, 23% pack in threes and 7%
  brutes, spread over the rings by area, each at its ground's level. They
  are not replaced.
- **Sent.** Every citizen is sent its own monsters, and this is what sets
  how many it kills. Each tick a citizen is off the ramp it gains points
  equal to the level of the ground it stands on, counted as 20 at least and
  100 at most. At 5,000 points it loses 5,000 and a group breaks out of the
  ground over 10 ticks, at the level of the ground the citizen stands on.
  It comes out 4 to 8 tiles from the citizen, on ground no more than 10
  levels under the group's own, or on the nearest such ground. Points carry
  from landing to landing, and are held in hundredths so that the full-city
  rule below loses nothing to rounding. A citizen with two of its groups
  still alive gains no points, and a group that is more than 12 tiles from
  its citizen for 10 seconds goes back into the ground, so a citizen that
  runs from its groups cannot fill the plate with them. The groups come in a fixed order of 20,
  `F P F F P F B F P F F P F F B F P F P B`: 11 fodder groups of 7, 6 packs
  of 3 and 3 lone brutes, which is 77 fodder, 18 pack and 3 brutes. A
  citizen keeps its place in the order between landings and starts at a
  place seeded by its account. A sent group is nobody's: anyone may kill it.
- **The count that follows.** A citizen that stands on level-23 ground for
  3,600 ticks is sent exactly 16 groups (82,800 points), and on average
  16.56. Anywhere under level 20 it is 14.4. The tables below take a landing
  as 3,600 ticks on a citizen's working ground: the 4,000 from ramp-down to
  turning back at 10:00, less one trip to the ramp and out again. For a
  citizen on the far ground they take 2,600 ticks there, which is 35.4
  groups at level 68, and 1,000 falling back through ring 2.
- **The plate's cap.** The plate holds 450 monsters at most. A group that
  would pass that waits, and its citizen's points stop at 5,000 until there
  is room.
- **A full city.** With more than 60 citizens awake when the legs plant,
  450 monsters cannot feed everyone at that rate, so the points a citizen
  gains each tick are multiplied by 60 and divided by the number awake, and
  every standing monster, sent monster and runner on that landing pays as
  that many more: its experience, its drop chance and its tool chance are
  multiplied by the number awake over 60, held in hundredths, and no chance
  passes 100%. At 150 a citizen is sent two fifths of the groups and each
  kill pays two and a half times, so what a citizen earns in a landing is
  the same at 15 and at 150, but for a brute's drop chance on a high-risk
  landing, which stops at 100%. Elites, chests, boarders and the last wave are
  counted by the roster already and pay as written.
- **Keeping to their ground.** A standing or sent monster does not step onto
  ground more than 10 levels under its own. It breaks off the chase there
  and walks back, and a blow from a citizen standing on ground it will not
  enter does it no damage, so it cannot be shot from under the line. Nothing
  from the far ground follows a citizen to the ramp.
- **Elites** are never sent. They are the dens' (an elite 5 levels over its
  ground, with its name and level shown on the map, whose death shuts its
  den for the landing), the last wave's, and a modifier's.

A **chest** takes 80 ticks of standing work and brings a pack out of the
ground when it opens. A **scrap pile** (one for each 100 tiles) gives each
citizen that works it 10 salvage over five tries of 12 ticks and is then
used up for that citizen, so piles are worth the same in a full city as in a
small one.

**The horde's monsters.** From 8:00 a citizen's groups stop breaking out of
the ground and come from the horde's edge as **runners**: fodder and pack
only (a brute's turn brings a pack), 5 levels over the ground their citizen
stood on when they were sent, stepping in 3 ticks to a citizen's 4. A runner
group goes for the citizen it was sent for and follows it anywhere. It never
strikes anyone else, whoever strikes it, so walking a friend in costs the
escort nothing but the time. When its citizen is aboard or down it turns
back for the horde and is gone when it gets there. From the horn every
citizen's points count double. In 20 runner groups there are 77 fodder and
27 pack. A citizen near the ramp is chased by runners of the yard's level
and one on the far ground by runners 5 over that, and the second's runners
cannot hurt the first.

## 2. The beats

"Named" is what puts a username in the caption or the tally.

| Beat                | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | On screen                                                                                                                          | A chatter does and decides                                                                                                                                                                      | Named for                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **0:00 Transit**    | Everyone is aboard. Broken parts are mended from the hold, 2 citizens and 60 s a part. The page shows the landing ahead: "Medium · level 23, up to 68 · fire · Stalked".                                                                                                                                                                                                                                                                                                 | Art.md's close frame. At 15, citizens are at near size and worn gear reads; at 150 they are at mid size.                           | `!me`, `!stash`, `!wear`, `!lock`, bench orders. Decides what to wear against the element ahead, and whether to put a tool to an item.                                                          | a bench result: a T1 line rolled, an item destroyed by acid                                                                          |
| **1:00 Raiders**    | Section 7.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |                                                                                                                                    |                                                                                                                                                                                                 |                                                                                                                                      |
| **3:00 Legs plant** | The generator's map is inked. Dens and chests are named as the ink reaches them, dens with their level. Tile flags from the last landing are down.                                                                                                                                                                                                                                                                                                                       | Art.md's pull back.                                                                                                                | `!go <den>` as its name appears, so the flag is up before the ramp is down.                                                                                                                     |                                                                                                                                      |
| **3:20 Expedition** | Kills drop loot (section 3). Crossing the ramp banks and opens the haul, and the citizen goes out again.                                                                                                                                                                                                                                                                                                                                                                 | Swarms across the plate; markers where rare things fall; bundles on backs with a pennant for each unopened rare or unique.         | `!go` to a den, a chest, a citizen or a dropped unique by name; `!fight`, `!gather`, `!careful`; `!keep`; `!over`. Decides how deep to work and what is worth one of four slots.                | a den's elite, a chest, a rare or unique drop, a good line when the haul opens                                                       |
| **8:00 The horde**  | The horde crosses from its edge to the hull by 12:30, taking the far ground first. Ground it has covered is gone: a citizen there loses a tenth of its life a second, loot there is lost, and a monster there is removed and not counted. Groups now come as runners (section 1). `lift_eta` counts ticks to 12:30; before the sighting it reads 9999. Away citizens go home.                                                                                            | The horde as art.md has it: spot black from one edge, the bruise wash ahead. Markers on that side go under.                        | `!margin`; `!go` to a drop near the horde. Decides how long to work the side the horde is taking.                                                                                               | drops from runners; a drop pulled out from under the horde                                                                           |
| **11:00 The horn**  | The winch stops (section 8). Runners come twice as fast. The **last wave** comes out whatever the plate's count: a brute for each 2 citizens still out and an elite for each 5 (rounded up, 12 elites at most), and the carriers (section 8). Its level is the landing's plus 10, or the median Arms of the citizens still out plus 5 if that is higher. It goes for the ramp and strikes anyone. Anything on the ground is now anyone's, but for the exceptions in 3.3. | The lantern goes to full accent. The caption reads "horn · 12 out · last wave 33". The loaded come in slowly with runners on them. | `!margin 0` to stay, `!guard` to stand at the ramp's foot, `!aid 20` to go to the fallen, `!go <someone loaded>` to walk them in. By default a citizen is aboard before this; staying is typed. | getting someone up; a pennant brought home; a carrier killed                                                                         |
| **12:30 The hull**  | The horde stops at the hull. The ramp is 3 tiles wide and the last wave goes for it. A monster standing on the ramp blocks it, and nobody boards past it. A citizen on the ramp is aboard; one set to `guard` stands at its foot until 5 s before the lift.                                                                                                                                                                                                              | The ramp fight of the look target.                                                                                                 | `!guard` or `!board`. Holding is what keeps the ramp open for everyone still coming in.                                                                                                         | kills at the ramp's foot; everyone who came in past the line                                                                         |
| **13:00 Lift-off**  | Everyone outside is hauled aboard and stripped (section 8).                                                                                                                                                                                                                                                                                                                                                                                                              | Winch lines haul the stragglers up as the frame closes. The caption shows the tally over 20 s.                                     |                                                                                                                                                                                                 | the tally: most brought home, best item opened, most got up, most kills at the ramp, each citizen left on the winch and what it lost |

## 3. The loot loop

### 3.1 Items

An item is a **base**, an **item level**, a **rarity** and **lines** in
tiers. `rollItem` in `packages/sim/src/items.ts` already rolls this. The
changes: three slots, tiers weighted, uniques, and no normal items.

**Slots:** weapon, coat, charm. The helm goes, because the hat is the
citizen's level. A citizen can wear an item when its Arms is at least half
the item level. A new citizen holds a level-1 blade and nothing else, and
any citizen left with an empty weapon slot, by a strip or by acid, takes the
best weapon it can wear from its stash or is issued that blade again.

**The weapon is how a citizen fights.** Four families, three bases each,
from item level 1, 20 and 45:

| Family | Blow                                           | Wind-up + recovery |  Hit | Knockback |
| ------ | ---------------------------------------------- | ------------------ | ---: | --------- |
| Blade  | an arc three tiles wide, two deep              | 2 + 3 ticks        | 100% | a quarter |
| Maul   | a circle of nine tiles, two tiles out          | 5 + 5              | 220% | two tiles |
| Spear  | a line four tiles long, through everything     | 3 + 3              | 120% | one tile  |
| Bow    | an arrow, nine tiles, stops in the first thing | 3 + 2              | 100% | a quarter |

The times are for Arms 1. A tick comes off the recovery at Arms 30 and one
off the wind-up at 60, and a "faster" line takes its percent off what is
left, from wind-up and recovery alike. Blow time is held in hundredths of a
tick and the remainder carries into the next blow, so every percent counts;
no blow is shorter than 2 ticks. A program reads `weapon_reach`, so one
preset kites with a bow and wades in with a maul. Coats carry armour (three
times the item level). Charms are bare.

**Rarity.** Magic has 1 or 2 lines, rare 3 or 4, with room for 6: three
prefixes and three suffixes. The fifth and sixth can only be added at the
bench. What would be a normal item in Path of Exile drops as salvage.

**Lines.** There are 19, each in six tiers, T6 to T1, needing item level 1,
10, 22, 36, 50 and 65. Among the tiers an item is high enough for, each
better one is half as likely as the one below, so T1 is 1 roll in 63 on an
item of level 65 or more. Values are rolled evenly in the range. The card
and every caption show a line as what it does, with its tier: "+12 fire T4".
The name word only goes into a magic item's name ("Heavy long blade of
Haste").

| Name word                              | Shown as                                | On            | T6     | T5     | T4     | T3     | T2      | T1      |
| -------------------------------------- | --------------------------------------- | ------------- | ------ | ------ | ------ | ------ | ------- | ------- |
| Heavy                                  | +N physical                             | weapon        | 1–2    | 3–5    | 8–12   | 16–24  | 28–40   | 45–65   |
| Flaming, Frosted, Charged              | +N fire, +N cold, +N lightning          | weapon, charm | 1–2    | 4–6    | 10–14  | 19–29  | 34–48   | 54–78   |
| Keen                                   | +N% damage                              | weapon, charm | 8–12%  | 13–18% | 19–25% | 26–34% | 35–44%  | 45–60%  |
| Stout                                  | +N life                                 | coat, charm   | 5–9    | 12–20  | 30–45  | 60–90  | 110–160 | 190–260 |
| Plated                                 | +N% armour                              | coat          | 10–15% | 16–24% | 25–34% | 35–49% | 50–69%  | 70–100% |
| Roomy                                  | +N bag slots                            | coat          | 1      | 1      | 1      | 2      | 2       | 3       |
| of Haste                               | N% faster                               | weapon        | 3–5%   | 6–8%   | 9–12%  | 13–16% | 17–21%  | 22–28%  |
| of Crits                               | +N% crit                                | weapon, charm | 2–3%   | 4–5%   | 6–8%   | 9–11%  | 12–15%  | 16–20%  |
| of Knockback                           | +N knockback, in quarter tiles          | weapon        | 1      | 1      | 2      | 2      | 3       | 4       |
| of Piercing                            | arrows pierce N                         | bow           | 1      | 1      | 1      | 2      | 2       | 3       |
| of Penetration                         | ignores N% resistance                   | weapon        | 5–8%   | 9–12%  | 13–16% | 17–20% | 21–25%  | 26–30%  |
| of Fire, Cold and Lightning Resistance | +N% fire res, cold res or lightning res | coat, charm   | 6–10%  | 11–15% | 16–20% | 21–26% | 27–33%  | 34–40%  |
| of the Flask                           | +N drinks                               | coat          | 1      | 1      | 1      | 1      | 2       | 2       |
| of Leech                               | +N life a kill                          | weapon, charm | 1      | 2      | 4      | 7      | 11      | 16      |
| of Fortune                             | +N% rare and unique drops               | charm         | 4–6%   | 7–9%   | 10–13% | 14–18% | 19–24%  | 25–30%  |

### 3.2 What drops, and how often

Each rule here is exact, and the tests in section 11 check the rules, not
the table under them.

- **A kill drops something** at 4% for fodder, 15% for pack and 40% for a
  brute. A full city (section 1) and a high-risk landing (section 9, 20% more)
  multiply the chance, in that order, and it never passes 100%.
- **What it is** is drawn by weight: salvage 1,561, magic 360, rare 78,
  unique 1. The draw is over the sum of the weights as they stand. Raising
  the rare and unique weights does not top the others back up to 2,000, so
  it lowers the share of salvage and magic.
- **Bonuses multiply the rare and unique weights**, and each other. The
  product is held in hundredths, rounded down after each step, and is never
  more than 20. They are taken in this order: a brute, 2; an elite or chest roll, 5; a runner or
  anything of the last wave killed more than 8 tiles from the ramp, 2, and 3
  from the horn; each modifier on the landing, 1.4 to 1.6, in the order
  section 9 lists them; and
  the "+N% rare and unique drops" on the charm of the citizen the drop is
  for, 1.04 to 1.30. Last Call's two rolls and The Rattle's second roll
  (3.9) are whole rolls, each with the same weights. Nothing else changes
  the weights.
- **A brute, worked.** Bonus 2. Weights 1,561, 360, 156 and 2, which sum to
  2,079. A brute's drop is rare 156 times in 2,079 (7.50%) and unique 2
  times in 2,079 (1 in 1,040).
- **The largest case, worked.** An elite of the last wave killed 12 tiles
  out on a landing that is Stalked and All fire, for a citizen with "+16%
  rare and unique drops": 5 × 3 is 15, × 1.6 is 24, × 1.5 is 36, × 1.16 is
  41.76, and the cap makes it 20. Weights 1,561, 360, 1,560 and 20, which
  sum to 3,501: rare 44.6%, unique 0.57% (1 in 175).
- **Whose it is.** The killer's, or for a monster that took several blows, a
  citizen drawn by share of damage.
- **Too far under.** A standing or sent monster ten or more levels under its
  killer drops salvage only and no tool, and gives a quarter of its
  experience (plan.md). So does anything of the last wave, elite rolls
  included, for a citizen ten or more levels over it, so the strong gain
  from a last wave only when it is as strong as they are. Den elites,
  chests, boarders and runners always pay.
- **An elite or a chest** gives one roll, with the bonus of 5, to each
  citizen within 6 tiles when it dies or opens. With more than 20 there, 20
  are drawn by the seeded generator, those who have never had such a roll
  first. Each citizen's drop falls at its own feet and is its own. A
  citizen's first such roll is always a rare weapon of the family it holds,
  at an item level no more than twice its Arms, so it can wear it.
- **Tools** roll apart from the drop: fodder 0.5%, pack 2%, brute 6%, each
  elite or chest roll 20%, a boarder 4%. The first three are multiplied in a
  full city as the drop chance is. Of tools, 80% are Rerolls, 17% Adds and 3% Acid.

What a landing brings is those rules times the monsters a citizen is sent
(section 1), if it kills what it is sent. Three citizens, with the levels
section 6 works out, each for 3,600 ticks on its ground:

- **Hour 1**, Arms 6 in the yard and the near end of ring 1: 14.4 groups, which is 55
  fodder, 13 pack and 2.2 brutes, and the one elite roll its first den
  gives.
- **Hour 10**, Arms 23 on ring 2 of a level-23 landing: 16.6 groups, which
  is 64 fodder, 15 pack and 2.5 brutes, with 4 boarders and 2 elite or chest
  rolls.
- **Hour 100**, Arms 58 on the far ground of that landing, level 68, for
  2,600 ticks, then 1,000 falling back through ring 2 with runners on it:
  35.4 groups and 4.6, which is 154 fodder, 38 pack and 5.3 brutes, with 4
  boarders and 2 rolls.

The rolls are a choice and no rule fixes them: a citizen gets one for each
den or chest it stands at, and each adds 0.17 of a rare, 0.0022 of a unique
and 0.2 of a tool. The standing monsters, the bonus on runners and a
landing's modifiers come on top of every row. There are 4.6 landings an
hour. The stream columns are 15 and 150 citizens like the hour-10 one.

| A landing brings       | Hour 1 | Hour 10 | Hour 100 | Hour 10 sees one every | Stream at 15     | Stream at 150 |
| ---------------------- | -----: | ------: | -------: | ---------------------- | ---------------- | ------------- |
| Salvage drops (3 each) |    4.6 |     6.3 |     12.7 | 2 minutes              | 94 a landing     | 945           |
| Magic                  |    1.1 |     1.5 |      2.9 | 9 minutes              | 22 a landing     | 218           |
| Rare                   |   0.40 |    0.62 |     0.98 | 21 minutes             | 9 a landing      | 93            |
| Unique                 |  0.005 |   0.008 |    0.013 | 27 hours               | 1 in 109 minutes | 1.2 a landing |
| Rare with a T1 line    |      0 |       0 |    0.049 | hour 100: 4.4 hours    | none             | none          |
| Rare with two T1 lines |      0 |       0 |   0.0010 | hour 100: 220 hours    | none             | none          |
| Reroll                 |   0.69 |    1.06 |      1.9 | 12 minutes             | 16 a landing     | 159           |
| Add                    |   0.15 |    0.23 |     0.41 | 58 minutes             | 3.4 a landing    | 34            |
| Acid                   |  0.026 |   0.040 |    0.072 | 5.4 hours              | 1 in 22 minutes  | 6 a landing   |

A T1 line needs item level 65, so it needs a monster of level 65: ground of
that level, or of 60 for a den's elite and for runners. The two T1
rows are empty for everyone who does not work that far out, and a stream sees
them at the rate of its veterans.

Dens and chests grow with the roster and their rolls are capped at 20. A
medium landing at 150 has 13 dens and 12 chests, up to 3.3 rolls a citizen, so 2 can
hold there if most sites are opened with a crowd round them.

Salvage balances against the bench. The hour-10 landing banks 19, half goes
to the purse, and that landing's tools cost 8 to use (3.8). A citizen that
keeps only rares cannot pay for its tools.

The bench is the faster road to T1. A Reroll is another full roll on an item
of the chatter's choosing. At 1.9 a landing the hour-100 citizen finds a T1
line about every 2 hours and two on one item in about 100, where drops
alone take 4.4 and 220. A level-65 base is therefore worth carrying home
whatever its lines are, and the stash keeps it (3.6).

### 3.3 The drop, on screen

Items drop **unopened**: the family and the rarity show, the lines do not.
A unique shows its name.

| Drop      | On the ground                                                                                                                                  | Named                                             | Caption          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- |
| Salvage   | a small heap in ink, at mid and near size only                                                                                                 | no                                                | no               |
| Reroll    | as salvage, with a disc                                                                                                                        | no                                                | no               |
| Magic     | a peg one tile tall with a ringed bundle, in ink                                                                                               | no                                                | no               |
| Rare      | a marker three tiles tall with a gold swallowtail, drawn in 3 ticks                                                                            | its owner's name, if present                      | if there is room |
| Add, Acid | a pole three tiles tall with a disc, black for Acid                                                                                            | Acid: its owner's name                            | Acid             |
| Unique    | a marker five tiles tall with a label naming it, drawn over a second; the killing blow holds 6 frames and citizens within 6 tiles turn to look | its name and its owner's, until picked up or lost | always           |

A marker is taller than any figure, so at 640 it is what a viewer sees after
the city and the horde. This replaces the loot line in art.md, section 10,
and the art director has to rule on it and on the hue before piece 15.
There is no sound yet (design.md); the held blow and the turned heads stand
in for it.

**Whose it is.** A rare, a unique, an Add or an Acid is its owner's for the
whole landing. Any citizen with a free slot may pick it up and carry it home
**for** them when the owner is down, has turned back or is more than 10
tiles off. The item goes to the owner's stash. The carrier is named in the
caption and the tally and is paid a Reroll, once a landing. If the carrier
is stripped on the way, the loss is the owner's: the item goes on the lost
list (section 8) under the owner's name, and the tally names both. From the
horn, anything still on the ground is anyone's to keep, except a fallen
citizen's named bundle and a carrier's item (section 8), which stay their
owner's until the lift. Magic, salvage and Rerolls are the owner's for 30
seconds.

A dropped unique's name is shown on the map, so it is a place: `!go heave`
plants a flag on Heave-Ho. Before the horn, a citizen sent there carries it
home for its owner. After the horn it keeps it, unless it is a carrier's
item.

### 3.4 The filter

- **What a citizen picks up.** `param keep = any of any, magic, rare`. A
  citizen walks to its own drops at or above `keep` within 10 tiles, ahead
  of every rule but staying alive and turning back. `!keep rare` saves bag
  slots and trips, and gives up magic upgrades and the salvage that bench
  orders cost. Tools are always picked up.
- **What the stream draws.** Salvage and Rerolls have no mark at far size.
  Magic pegs are drawn at far size only while fewer than 30 are in frame.
  Rare, unique, Add and Acid marks are always drawn. At most 8 loot names
  are shown at once, and the caption carries one loot line every 4 seconds,
  in this order: a unique, an Acid result, a line opened at the best tier
  its item could have, a present chatter's rare. The rest is counted ("31
  rares on the ground"). The streamer can tighten it.
- Salvage and magic are gone from the ground after 90 seconds. The ground
  holds 400 drops; past that the oldest salvage goes first, then magic.

### 3.5 Carrying it home

- **The bag** has 4 slots. An item takes one. Tools stack 5 to a slot and
  salvage 10. At 3 slots full a step takes 5 ticks, and at 4 it takes 6
  (with extra slots, at the last two). `way_home` grows with it, so the same
  `margin` turns a loaded citizen sooner. The hour-10 landing's pickings are
  about 4 slots and the hour-100 one's about 8, so a citizen banks in the
  middle or chooses what to leave. A full bag swaps its worst item for a
  better drop.
- **The haul is unopened and it shows.** A chatter knows they carry two
  rares and does not know what is on them. The lines were rolled at the
  drop, so a haul lost is lost unseen. The pennants in the bundle tell the
  stream who is worth walking in, and tell a stalker who to hunt.
- **The late bonus is paid far out.** The horde's bonus counts only more than 8 tiles
  from the ramp, where runners outrun a loaded citizen.

**Opening.** Crossing the ramp opens the haul, 5 ticks an item. Each rare or
unique is drawn over its citizen for 6 seconds as its pennant with its name
and its two best lines ("Grim Bite · +12 fire T4 · 12% faster T4"), notched
once for each line at the best tier its item level allows. The pennant then
goes to the citizen's hand if the item is put on, or down the hatch if it is
stashed. An opened item that beats the worn one by the preset's weights is
put on and the old one stashed, but never across weapon families, never a
unique, and never in a worn slot its chatter set with `!wear`. Half of
banked salvage goes to the citizen's purse while it has room, and the rest
to the hold.

### 3.6 The stash, the kits and the rack

An item that is not put on goes to one of three places. Nothing outside the
city takes what is in them; a piece that is being worn is worn, and is lost
in a strip like anything else on the body.

- **The rack** holds every unique the citizen has brought home, with no
  limit. No rule scraps one; only Acid can destroy one.
- **The kits.** There are three, against fire, cold and lightning, each with
  a place for one coat and one charm. An item goes into a kit when it
  resists that element by more than the kit's piece for its slot does. An
  item that would better two kits goes to the one it betters by more, and
  to the first of fire, cold and lightning on a tie. The piece it replaces
  is placed again as if newly opened: into another kit if it betters one,
  and otherwise the stash. `!wear fire` puts a kit on. What was worn is set
  aside, not stashed, and goes back on with `!wear auto`; the kit's pieces
  keep their places.
- **The stash** has 12 numbered slots for everything else. **`!lock 3`**
  locks a slot and `!unlock 3` frees it; 8 slots can be locked at once. A
  stash item worked at the bench is locked for its chatter if a lock is
  free, and the order strip says so when none is ("not locked · 8 of 8").

**When the stash is full** and an item is to be stashed, the new item and
the 12 are ranked together and the lowest one that is not protected is
scrapped (magic for 2 salvage, rare for 5). So a poor item coming in is the
one that goes. The order, lowest first: the lower score by the preset's
weights, which is the score that decides what is worn and counts a magic
item's one good line for what it is; then the older.

Protected, and never scrapped by this rule: a locked slot, and the **base**
of each slot, which is the item of the highest item level among the new item
and the stash for the weapon family the citizen holds, for coats and for
charms. At most 8 locks and 3 bases are protected, so one of the 13 can
always go. `!scrap 3` scraps one by hand and is refused on a locked slot.

**A citizen whose chatter is away** follows the same rules and nothing else:
it spends no tool or salvage, changes no lock, and puts on only what beats
the worn item within its weapon family. What it scraps was ranked below
everything it kept, and its locked items, bases, kits and uniques are all
there when its chatter comes back. The card on coming back says what went:
"scrapped 31 magic, 4 rares".

**Tools** are kept with the purse, 20 of each at most. One more is banked as
the salvage its order costs.

### 3.7 Seeing your own gear without a site

- **The figure.** The weapon's family and base are its silhouette at every
  size. The coat is a shoulder line at mid and near size, the charm hangs
  at the belt at near size. A unique has its own drawing and an effect that
  reads at far size (3.9). A citizen's blows leave its element's colour on
  what they hit (4.2).
- **`!me`** rings the citizen for 6 seconds and puts its card in the legend:

  ```
  goofguy · Arms 27 · Deckhand · fight · margin 120 · keep magic · over 10
  weapon  Grim Bite, long blade 31 · +10 physical T4 · +12 fire T4 · +14% damage T5 · 12% faster T4
  coat    Padded coat 24 · +18% fire res T4        charm  none
  armour 72 · fire 18 · cold 0 · lightning 0 · kits: fire 34, cold 0, lightning 12
  haul 3 of 4, two rare · stash 3 of 12 · salvage 22 · reroll 2 · add 0 · acid 0
  ```

- **`!stash`** shows the stash numbered, a line an item with its best line
  ("3 · rare coat 41 · 4 lines · +52 life T3 · locked"), then the kits and
  the rack. `!stash 3` shows slot 3 with every line. Neither `!me` nor
  `!stash` costs a token; each can be asked once in 30 seconds.
- **How many cards.** During the expedition the legend holds two cards, 6
  seconds each. In transit, when the frame is close on the city and the
  tally is gone, it holds six. That is 60 cards a minute and 180 in a
  transit, against 150 chatters. With more waiting, whoever has gone longest
  without a card is first and the order strip shows the wait: "`goofguy` ·
  card in 18 s". Piece 10 measures the wait at 150.
- **Without asking.** An opened rare shows its two best lines over its
  citizen (3.5), and a bench result shows the item before and after (3.8),
  so the two things a chatter most wants to read need no card.
- **`!wear`** needs no card for the common case: `!wear fire`, `!wear cold`
  and `!wear lightning` put on that kit. `!wear 3` puts on stash slot 3,
  `!wear blot` puts on a unique from the rack by a prefix of its name, and
  `!wear auto` gives the slot back to the automatic swap.
- **Coming back.** The first message from a chatter who was away shows their
  card unasked, with a line for what happened: "14 landings · 3 rares worn ·
  1 unique kept · scrapped 31 magic, 4 rares · lost gear once".

### 3.8 Tools and the bench

There is no gold. A tool is spent at a bench with salvage from the purse.
The city has one bench for each 25 citizens awake and one at least, any
citizen aboard can use one in any phase, and an order takes 20 ticks. An
order names a worn slot or a stash number (`!reroll weapon`, `!acid 3`) and
stands until the citizen is aboard with the tool and the salvage; a citizen
has one standing order at a time. The result is shown over the citizen for 6
seconds, the item before and after, and is on its card.

| Tool   | Order     | Salvage | Does                                                                              |
| ------ | --------- | ------: | --------------------------------------------------------------------------------- |
| Reroll | `!reroll` |       5 | Removes every line and rolls the item again at its rarity and item level.         |
| Add    | `!add`    |      10 | Adds one more line. A magic item with two lines becomes rare.                     |
| Acid   | `!acid`   |      20 | One of four results, evenly. What survives is **sealed** and takes no tool again. |

Acid's four results, as the screen names them:

- **+1 tier.** One line rises a tier, keeping its place in the range, chosen
  among the lines whose value would change; with no such line the result is
  a bonus line. A T1 line becomes T0, a quarter above T1's range, which
  nothing else in the game can make.
- **Bonus line.** The item gains one line only Acid gives, for its slot.
  Weapon: 20% more damage of one type it does, drawn by the generator; or
  statuses it sets last twice as long. Coat: its wearer is never staggered;
  or one more drink; or one more bag slot. Charm: life for each kill
  doubled; or steps of 3 ticks from the horn to the lift; or own drops
  within 3 tiles come to hand.
- **Rerolled.** Every line is rolled again, as by a Reroll.
- **Destroyed.** The item is gone.

On a unique, Reroll and Add are refused and nothing is spent. Acid works:
+1 tier raises the one number 3.9 names for it, rerolled does nothing, and
the other two are as above. Nothing is ever spent without its chatter typing
the order.

### 3.9 Six uniques

A unique drops at its monster's item level with its rule and one rolled line
for its slot. Rally, Hoist and Last Call bend rules only this game has.

| Unique                          | The rule it bends                                                                                                                                                                                                                                                                                                                                                                                                                                            | How its chatter plays it                                                                                                             | The stream sees                                 | Acid's +1 tier raises       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------- |
| **The Blot** (blade)            | A monster it kills bursts: fodder within 2 tiles die and pack monsters there lose half their hitpoints. What a burst kills bursts too, three deep.                                                                                                                                                                                                                                                                                                           | `!fight`, and `!go` wherever fodder is thickest. It does nothing extra to a brute.                                                   | a swarm going off like a string of blots        | the depth, to four          |
| **Heave-Ho** (maul)             | Knocks fodder and pack back three times as far and brutes as far as any maul; elites and captains are not moved. A monster knocked into another, or into a wall, takes the blow again. Over a rail or into the horde it dies, and its drop lands where it was struck.                                                                                                                                                                                        | Works rails and hatches in a raid (`!go fore hatch`) and the horde's edge on a landing.                                              | bodies in the air                               | the second blow, by a fifth |
| **Rally** (spear with a banner) | Its wearer, and up to ten citizens within 6 tiles whose flag is on the wearer, deal 4% more damage for each of those citizens, the wearer not counted.                                                                                                                                                                                                                                                                                                       | The wearer needs chat to type `!go` on them each landing and stay close.                                                             | a banner with ten flag lines to it              | the 4%, to 4.8%             |
| **Hoist** (coat)                | Gets a fallen citizen up in 1 second, not 4, and both drink a full flask. A citizen it gets up more than 8 tiles from the ramp, who then reaches the ramp, pays it a Reroll, once a landing for each citizen. Its wearer deals 30% less damage.                                                                                                                                                                                                              | `!aid 20`. From the horn it does the winch's work.                                                                                   | one figure running between the fallen           | the 30% less, to 24%        |
| **The Rattle** (charm)          | Monsters within 8 tiles go for its wearer first, runners sent for others included. A monster that has chased it for 5 seconds is rattled, 40 at a time. Whoever kills a rattled monster gets a second roll at that monster's drop chance, and a second drop if it comes up. Every 25th rattled kill pays the wearer a Reroll, six a landing at most. Its wearer's steps are a tick shorter than its bag makes them: 3, 4 with three slots full, 5 with four. | `!careful`, so it runs, and `!go` to drag the train to whoever can kill it.                                                          | a citizen with forty monsters strung out behind | the 40, to 48               |
| **Last Call** (charm, a bell)   | From the sighting, each of its wearer's drops made more than 8 tiles from the ramp, elite and chest rolls included, is rolled twice and the better kept: unique over rare over magic over salvage. The winch never answers its wearer, and its `margin` is held at 0. It comes off at every lift and goes back to the rack.                                                                                                                                  | `!wear last call`, typed for each landing it is worn on, with company: `!home`, and `!go` and `!aid` from friends, are its way back. | the last figure out, with a bell at its belt    | a third roll                |

**The Rattle's second roll, worked.** A train of 40 rattled fodder is due
40 × 4% = 1.6 drops. Each kill rolls the 4% again, so the train gives 3.2
drops, of which 0.12 are rare. The second roll can miss, as the first can.

## 4. Damage, defences and statuses

One rule for every hit, by a citizen or a monster. All of it is integers:
percentages are held in hundredths of a percent and every step rounds down.

### 4.1 The order of a hit

A hit is worked out for each damage type it carries, and the results added.

1. **Base.** Physical: the blow from the Arms level ([plan.md](plan.md),
   section 2.1), plus the weapon's own damage, plus every "+N physical". An
   element: every "+N" of that element. A weapon's own damage is the blow of
   its item level divided by 8, 6 or 4 for its family's three bases.
2. **The family's hit**: 100% for a blade, 220% for a maul (3.1).
3. **Increased.** Every "+N% damage" is summed and applied once.
4. **More.** Each "more" or "less" multiplies by itself, one after another.
   Shock's 20% on a shocked target is one of them.
5. **Crit.** One seeded roll a swing, at the citizen's crit chance (5% bare,
   40% at most). A crit doubles every type. Monsters do not crit.
6. **The target.** An element loses `hit * r / 100`, where `r` is the
   target's resistance less what the attacker ignores, held between 0 and 75. Physical loses `hit * armour / (armour + 5 * hit)`. If the sum of the
   types comes to nothing, the hit does 1.

A monster's blow that is half an element gives the element the rounded-down
half and physical the rest.

"+N% damage" lines share one pool, so each is worth less the more a citizen
has: with 70% already, another 20% makes blows 11.8% harder. A "more" is
worth what it says. "More" and "less" come only from a unique's rule, a
bonus line from Acid, and shock.

**Example 1, at its own level.** `goofguy`, Arms 27, long blade of item
level 31 with +10 physical, +12 fire and +14% damage, hits a level-27 pack
monster with no armour or resistance.

| Step           | Physical          | Fire |
| -------------- | ----------------- | ---- |
| Base           | 69 + 14 + 10 = 93 | 12   |
| Blade, 100%    | 93                | 12   |
| Increased, 14% | 106               | 13   |
| The target     | 106               | 13   |

119 of its 318, so three blows. The 13 fire is over the status line at level
27, which is 10 (4.2), so the monster burns for 13 a second.

**Example 2.** `xXxKittyKatxXx`, Arms 68, great maul of item level 66 with
+60 physical (T1), +45 fire (T2), +40% damage (T2), "ignores 15% resistance"
(T4) and a bonus line of 20% more fire damage, and +30% damage (T3) on the
charm, crits a level-37 brute on an ash waste (armour 148, fire resistance
40%, 2,317 hitpoints).

| Step           | Physical                   | Fire                            |
| -------------- | -------------------------- | ------------------------------- |
| Base           | 305 + 72 + 60 = 437        | 45                              |
| Maul, 220%     | 961                        | 99                              |
| Increased, 70% | 1,633                      | 168                             |
| More           | none                       | 20%: 201                        |
| Crit           | 3,266                      | 402                             |
| The target     | armour takes off 29: 3,237 | 40 less 15 is 25%: off 100, 302 |

3,539 in all, and the brute is dead.

### 4.2 Four types, and the status each leaves

A hit sets an element's status on a monster when that element's part of it,
after resistance, is at least a tenth of a fodder monster's hitpoints at the
target's level: 10 at level 27, 71 at level 68. One elemental line of the
citizen's own tier is enough, with the "+N% damage" gear of that level
carries. A stagger needs a physical part of at least 10% of the target's own
life, so a blade staggers pack monsters and it takes a maul to stagger a
brute. No roll is involved. A status lasts 4 seconds on fodder and pack
monsters, 2 on a brute and 1 on an elite.

| Type      | Colour            | Status  | What it does                                                                                                                                                                                                                                                 | Best against               |
| --------- | ----------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Physical  | the plate's sepia | Stagger | The target's wind-up is broken off and starts again. It cannot be staggered again for 2 seconds. Knockback is physical too.                                                                                                                                  | brutes                     |
| Fire      | amber             | Burn    | Each second it does the fire part of the hit that set it, and jumps once to one monster within a tile that is not burning, at half strength; a jumped burn does not jump. A kill by a burn is its setter's.                                                  | swarms                     |
| Cold      | pale blue         | Chill   | Steps and blows take half as long again. A chilled target that takes a second cold hit over the line is frozen for half the status time, and cannot be frozen again for 2 seconds. A frozen monster that dies shatters and chills everything within 2 tiles. | runners                    |
| Lightning | violet            | Shock   | It takes 20% more from every hit, whoever lands it. Each hit on it arcs to one other monster within 3 tiles for 30% of its lightning part.                                                                                                                   | elites, carriers, captains |

A swing is drawn in its citizen's cloak colour (art.md, section 10), so the
type is drawn on the target, at contour weight or as a fill so it shows at
640: an amber wash that spreads for a burn, a body in bare paper for a chill
and stock still for a freeze, a forked stroke for a shock, a broken coil for
a stagger. The art director fixes the hues, and violet has to stay clear of
the horde's bruise wash. Statuses do not stack: the stronger burn stands,
and the others restart their time.

**On a citizen.** A monster's hit sets a status on a citizen when its part,
after defences, is at least 5% of the citizen's life. A burn on a citizen
does a fifth of that part each second, and never jumps between citizens.

### 4.3 Defences

- **Life** is from the Hitpoints level, plus "+N life". Hitpoints gets the
  same experience from a kill as Arms does.
- **Armour** is on the coat. It takes most off small hits and little off
  big ones: at armour 72, a level-27 pack monster's 23 becomes 15 and a
  brute's 144 becomes 131. Brutes and elites have armour of four times
  their level and fodder and pack monsters none, so against a level-27 brute
  a blade's blows lose 16% and a maul's 8%.
- **Resistance** to each element is capped at 75%.
- **Stepping out.** There is no evasion roll. A blow is drawn before it
  lands and a program steps out of it or does not.

**Monsters and elements.** A landing's monsters do half their damage as its
element and resist that element by 40%. A level-27 brute's 144 on an ash
waste is 72 physical and 72 fire. `goofguy`, with armour 72 and 455 life:

| Fire resistance                  | Takes         | Burns        |
| -------------------------------- | ------------- | ------------ |
| none                             | 60 + 72 = 132 | yes          |
| 18%, the coat on the card        | 60 + 60 = 120 | yes          |
| 38%, with a second T4 on a charm | 60 + 45 = 105 | yes          |
| 75%, the cap                     | 60 + 18 = 78  | no: under 22 |

On an All fire landing (section 9) the same hit is 144 of fire: all of it
with no resistance, 36 at the cap, and armour does nothing. So a landing's
element matters most to what a citizen takes. On the attack it matters less: an element
is about a tenth of a hit until a citizen stacks it, so a fire blade on an
ash waste loses a few percent and its burns. That is what the three kits are
for (3.6), and transit is when a chatter reads the landing ahead and types
`!wear fire`. A T1 resistance on the coat and another on the charm come to
68% to 80%, so reaching the cap takes two good T1 rolls or a line Acid has
taken to T0.

### 4.4 Left out of the slice on purpose

A fifth damage type. Conversion between types. Energy shield. An evasion
roll, for the reason above. Bleed, which would be a second burn nobody could
see. Exposure, since shock already makes a target take more. An implicit
line on each base. A unique that lifts one resistance cap to 85% is the
first to add after the six.

## 5. What a chatter types

[chat.md](chat.md) is the design, and it agrees with this page on the
points below.

- **Built in:** `!go`, `!home`, `!free`, `!run`, `!me`, and for gear:
  `!stash`, `!wear`, `!lock` and `!unlock`, `!scrap <n>`, `!reroll`, `!add`,
  `!acid`. All but `!me` and `!stash` cost a token, as an order does.
- **`!go`** takes chat.md's lookup. The named places of a landing are its
  dens, its chests and any unique lying on the ground; on deck they are the
  hatches, the guns and the hold. Compass points work, and the slice's
  landings have no sectors. A name may be several words (`!go waist hatch`).
- **Params every preset declares:** `stance` (gather, fight, careful);
  `margin`, the seconds it wants to be aboard before the horde reaches the
  hull, 0 to 240 and 120 by default; `keep`; `over`, how many levels over
  its own Arms it will work ground, 0 to 30; `aid`, 0 to 20 tiles it will go
  to get someone up, 6 by default; `ramp` (`!board` or `!guard`).
- **Two presets.** Deckhand, the newcomer's, works the nearest ground that
  still pays it: the nearest that is not ten or more levels under its Arms.
  Its `over` is 10. Longhaul goes to the deepest ground `over` allows and
  the dens there, and its `over` is 15.
- **Rules every preset has above its own:** step out of a blow; drink (a
  flask of 3 drinks, each 40% of life, one back for every 20 kills, full
  again aboard); go home at the sighting if the chatter is away; turn back
  when `lift_eta < margin * 10 + way_home`; step back from ground more than
  `over` levels above its Arms, which holds a flag planted there ("held by
  too deep"); own drops; drops to carry for others; the fallen within `aid`.
- **A flag on a citizen comes down at every lift.** An escort is typed again
  each landing.
- **New for programs:** `lift_eta`, `way_home`, `horde_distance`,
  `ground_level`, `flag_level`, `arms`, `haul`, `drop_distance`,
  `down_distance`, `flask`, `weapon_reach`; `go_home`, `pick_up`, `drink`,
  `revive`, `work`.

With the default margin a citizen turns back at about 10:00 and is aboard by
10:30. The horn is 90 seconds before the hull, so any margin under 90 means
being out after the horn, and the order strip says so when it is typed:
"`goofguy` · margin 60 · out past the horn, no winch". `!guard` gets the same
warning. Being out after the horn is something a chatter types.

## 6. A citizen at hour 1, 10 and 100

Hours are hours of stream. A citizen is out for 6:40 of each 13:00, and
plan.md, section 2.3, works the levels from what it is sent in that time: 6,
23 and 58.

On one level-23 medium landing where the hour-100 citizen is the strongest
aboard, so the far level is 68. Yard fodder has 13 hitpoints and fodder at
the near end of ring 1 has 17. In ring 2 a fodder monster has 80, a pack
monster 240, and a brute 963 and a hit of 115. On the far ground, level 68,
a fodder monster has 719, a pack monster 2,159, and a brute 8,637 and a hit
of 690.

|                | Hour 1                                              | Hour 10                                                   | Hour 100                                                                       |
| -------------- | --------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Arms, life     | 6, 107                                              | 23, 375                                                   | 58, 1,292                                                                      |
| Wears          | the rare blade of its first den, item level 12      | three rares, T4 and T5 lines                              | rares with T2 lines, a unique, a fifth line from an Add                        |
| A blow         | about 20 (13 with the blade it joined with)         | 85: 55 and 10 from the blade, +10 physical, +14%          | about 501 by plan.md's gear factor, every 0.4 s to the hour-10 citizen's 0.5   |
| Works          | the yard and the near end of ring 1, levels 5 and 7 | ring 2, level 23                                          | the far ground, level 68, until the horde takes it at about 8:45               |
| Is sent        | 12 monsters a minute                                | 14 a minute                                               | 40 a minute                                                                    |
| Fodder there   | 1 blow                                              | 1 blow                                                    | 2 blows, or one swing of a maul                                                |
| A pack monster | 3 blows                                             | 3 blows                                                   | 5 blows                                                                        |
| A brute's hit  | 31, over a quarter of its life                      | 115, or 103 through armour 72: over a quarter             | 690: half of its bare life, a third with "+N life" gear                        |
| Ring 2         | fodder 4 blows, a brute's hit a down; it keeps out  | its ground                                                | one arc clears a group, for salvage and a quarter of the experience            |
| Its drops      | item level 5 to 7: T6 lines                         | item level 23: T4 at best                                 | item level 68, and 73 from its runners and a den out there: T1 lines can roll  |
| A rare, a T1   | a rare in 33 minutes                                | a rare in 21 minutes                                      | a rare in 13 minutes, one with a T1 line in 4.4 hours                          |
| On screen      | one group at a time by the ramp                     | swarms cut down in ring 2, the bundle full once a landing | alone at the far edge with two groups on it, a taller hat, the unique's effect |

The hat's height is the level and the weapon's silhouette is the base, so
the three can be told apart standing still. The hour-10 column is on a cliff
that makes a drop matter: its 75 physical is under a ring-2 fodder monster's
80 hitpoints, and the "+14% damage" line makes it 85 and one blow. Without that line it is two blows and half the
kills.

Ring 2 gives the hour-100 citizen nothing, and the far ground is where it is
paid. That ground is on every landing, because the far level follows the
strongest citizen and not the median. It is 10 over its Arms here, which its
`over` of 10 just allows, and the item level there is 68, where T1 lines can
roll. It is sent three times as many monsters as the hour-10 citizen because
the ground's level is three times as high. The price is time and risk: two
blows for fodder, a brute that takes half its life, and the horde taking
that ground first, so it has about four and a half minutes there. None of it
is near the ramp, its monsters do not leave it, and the runners sent for it
strike nobody else. A citizen strong for its city but not the strongest has
ground of its own level in the inner half of ring 3.

## 7. The raider encounter

- **The decks.** The cut-away has three decks joined by two stairs. The rig
  comes alongside and throws one grapple line for each 20 citizens awake, 3
  at least and 8 at most. Each lands at a hatch named on the plate (fore
  hatch, waist hatch, keel hatch and so on). The hold door is on the lowest
  deck. Rails are open, and anything knocked over one dies.
- **Boarders.** Four for each citizen awake: pack rank at the city's level.
  They are split evenly over the lines and cross evenly from 1:20 to 2:40,
  held back while 450 less the citizens are already aboard. A boarder that
  reaches the hold door takes 5 salvage and carries the crate back to its
  line; killed on the way, the crate goes back. One in ten is a **wrecker**,
  a brute with a firepot, which goes for a part and breaks it with 5 seconds
  of work. One **captain** (elite) for each three lines crosses at 2:00.
- **Guns.** One at each hatch, worked by two citizens. It shoots a boarder
  off its line every 6 seconds; the kill and its drop are the crew's, and
  the drop lands at the hatch. When more boarders than citizens stand within
  4 tiles of its hatch, it turns on the line and cuts it in 15 seconds:
  everything on it falls and the hatch is shut.
- **It ends** when every captain is dead, when every line is cut, or at
  2:50. The rig casts off with what it has, and boarders still aboard go
  over the rail.
- **What chat does.** `!go waist hatch`, `!go guns`, `!go hold`. A hatch is
  a file of monsters into a choke, which is where an arc, a spear's line and
  a knocked-back body do most. Boarders are a tool source (4% each, and an
  Add from each captain), and loot on deck goes straight to the stash. What
  the city stands to lose is the hold and the parts.
- **Credit**, shown at the end: boarders killed at a post, boarders shot
  off a line, lines cut, crates brought back, wreckers stopped, the captain.
- **Damage that persists** until it is mended from the hold. The cost is
  for each 15 citizens awake, pro rata and rounded up, and for 15 at least:

  | Part      | Broken, it means                        | Drawn as                    | Salvage |
  | --------- | --------------------------------------- | --------------------------- | ------: |
  | A leg     | The horde is sighted at 7:00, not 8:00. | a dragging leg, plates gone |      60 |
  | The winch | No down is winched (section 8).         | a burnt winch house         |      40 |
  | A bench   | One bench fewer.                        | a fire on the mid deck      |      30 |
  | A gun     | That hatch has no gun.                  | a split barrel              |      20 |

- A citizen downed on deck is up after 10 seconds at 30% and loses nothing.
  With nobody awake the rig passes by.

## 8. Downs, lift-off, and what an absence costs

**Who the winch answers.** Every citizen that goes down before the horn, and
nobody from the horn on. A citizen that went down before the horn is winched
even when its 15 seconds run past it.

**Lift-off.** Every citizen outside at 13:00, down or standing, on a winch
line or not, is hauled aboard and stripped. Nothing exempts a citizen from
this, whatever its settings. What keeps a citizen clear of it is its margin,
which on untouched settings has it aboard by 10:30, and the winch for a down
before the horn.

| What happened                                                     | Haul                                                                 | Worn | Then                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---- | ------------------------------------------------------------------- |
| Down, and got up by a citizen beside it (4 s)                     | kept                                                                 | kept | up at 30%, untouchable for 3 seconds                                |
| Down before the horn, and nobody comes in 15 s                    | left where it fell as a bundle with its name, its own until the lift | kept | winched aboard on a visible line; out again in 20 s before the horn |
| The same with no winch (broken, a No winch landing, or Last Call) | left as a bundle, as above                                           | kept | gets up where it lies after 30 s, at 30%                            |
| Down after the horn, nobody comes                                 | lost at 13:00                                                        | lost | lies there until the lift                                           |
| Outside at 13:00, down or standing                                | lost                                                                 | lost | hauled aboard, named in the tally                                   |

The second and third rows are for a down before the horn. From the horn, a
citizen that goes down and is not got up lies there until the lift.

**Stripped** means the haul and everything worn. Levels, the stash, the
kits, the rack and the purse are untouched, except that a kit piece or a
unique that was being worn is lost with the rest. The citizen dresses from
its stash at once (3.1). If its chatter is away it then stays aboard until they
next type, so an absence costs one strip at most.

**Who ends up outside.** A citizen whose chatter typed a margin under 90,
`!guard` or `!wear last call` has chosen to be out after the horn. A citizen
on untouched settings turns back at about 10:00 and is aboard by 10:30, so
it is out after the horn only when a late down or the runners on a loaded
walk hold it there for half a minute. Piece 16 tests that it is aboard
before the horn, because if it is not, it can lose its haul and its gear.

**The lost list.** Rares and uniques lost at lift-off go on the horde's lost
list, which holds the 12 best. On each later landing where at least one
citizen is out at the horn, up to 3 **carriers** come out with the last
wave whatever its size: elites of its level, best items first, each named
for what it carries ("has The Blot", "has goofguy's bundle"). A carrier's
item always drops when it dies, as its first owner's, and by 3.3 anyone can
carry it home for them. An item whose carrier has come out on 3 landings and lived is gone.
One dropped and not brought home goes back on the list with its landings
still counted.

**An absent chatter's citizen** goes home when the horde is sighted, three
minutes before the horn, for a walk of 45 seconds at most. It stays aboard
while the winch is broken and on a No winch landing. It cannot be wearing
Last Call, which came off at the last lift and is put on only by a typed
`!wear`. A down on the way home is winched, so on its own it loses at most a
haul to a down, unless downs keep it out for the three minutes to the horn,
which piece 16 tests does not happen. After
24 hours it goes below (chat.md, section 5). What it brought home was opened
and worn for it within its weapon family, uniques wait in the rack, the
stash kept what 3.6 says it keeps, and no tool or salvage was spent.

## 9. Decisions and their defaults: the streamer's site

Served to the local machine as chat.md has it. Each control sends a `mod`
input, and each default runs with nobody there. chat.md's site also lists
Upgrades and Tuning; the slice has no bays to build and one tuning, so it
builds neither part.

**The navigator.** The city has a level, 5 to begin with. After a landing it
goes up 1 if under 20% of the present citizens who went out were downed or
stripped, and down 2 if over 50% were. Away citizens are not counted. It is
never under 1, and never more than 10 over the median Arms level of the
present, so a city left alone settles where a fifth to a half of its
chatters go down on a landing. When no present citizen went out, the level
holds, and with nobody present the cap is taken from the citizens awake.
Three landings are rolled ahead in transit: size (small 30%, medium 45%,
large 25%), biome, a level within 2 of the city's and 1 at least, and 0, 1
or 2 modifiers (40%, 40%, 20%). The navigator takes the first, or the
smallest after a landing that stripped over 30% of the present.

The median sets the level of rings 1 and 2, which is where most of the
roster fights. It does not set the far level, which follows the strongest
citizen awake (section 1), so a stream that keeps taking in new chatters
does not take the far ground away from its veterans.

**Modifiers.** Each adds danger and loot together. The slice has three:

- **Stalked.** Two stalkers (elites 5 levels over the landing, stepping in 3
  ticks) hunt whichever citizen has the most pennants in its bundle,
  choosing again every 10 seconds, with a line drawn to their mark. Rare and
  unique weights × 1.6.
- **No winch.** The winch does not work this landing. Weights × 1.4.
- **All fire** (or All cold, or All lightning, by the element). Every
  monster's damage is all of the element, and its resistance to it is 75%.
  Weights × 1.5. A landing with no element cannot roll it.

**The hold** takes in half of what citizens bank, about 140 a landing at 15,
and pays for mending. It holds 300 salvage for each 15 citizens awake (pro
rata, rounded up, 300 at least); what would pass that is lost. A high-risk
landing costs that much, so a full hold buys one, and a raid that empties
the hold costs the city its next high-risk landing.

| Decision     | Default                                                          | The streamer can                                                                                           |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Next landing | the navigator's                                                  | pick any of the three                                                                                      |
| Risk         | as rolled; high-risk when the hold is full and nothing is broken | plain (no modifiers), or high-risk (two modifiers, 5 levels over, 20% more drops), which costs a full hold |
| Raiders      | stand                                                            | run: no fight, and the horde is sighted 90 s sooner on the next landing                                    |
| Repairs      | winch, leg, benches, guns                                        | reorder, or hold the salvage                                                                               |
| Loot filter  | as 3.4                                                           | rare and up, or uniques only                                                                               |
| Presets      | both; newcomers on Deckhand                                      | as chat.md                                                                                                 |

## 10. What carries over

Stated from the current docs and the titles and bodies of the open issues.
No code was run for this page.

**Kept.** The simulation core (ticks, the seeded generator, snapshots, the
hash and its determinism tests), Tactics with its compiler and VM,
path-finding, the experience table, monsters as content with programs, pack
behaviour from #330, the world server, the capture tool and watch rubric,
`pen.ts`, and a citizen's hood, cloak and hat from `looks.ts`. From
[plan.md](plan.md): the formulas, ranks, step times and experience.

**Rewritten.**

| Now                                                           | Becomes                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Four regions joined by exits (`atlas.ts`, `world.json`)       | the deck and one generated landing at a time                                      |
| A spawn table by place and hour, 3 monsters a region          | the standing count, each citizen's sent groups, dens, the horde                   |
| A bag of goods and a bank chest (`bag.ts`)                    | the haul, the stash, the kits, the rack, the purse, the hold                      |
| Trees and fishing spots (`gather.ts`, `nodes.ts`)             | scrap piles and chests                                                            |
| `melee`                                                       | Arms, which every weapon trains; Hitpoints stays                                  |
| `items.ts`: four slots, even tiers, a normal rarity           | section 3                                                                         |
| A blow of fixed damage                                        | section 4                                                                         |
| `homebody`, `riverwalker`, `wanderer`, six named residents    | Deckhand, Longhaul, the scripted crowd                                            |
| The page of rows, the spotlight, the pan between regions      | the plate's title box (art.md's cartouche), legend and caption; the zoom          |
| #315 to #321, #332                                            | pieces 4 to 8                                                                     |
| #240, #241, #322                                              | pieces 11 to 15                                                                   |
| Chat C1 to C8, C10, C12, C13 (#347 to #354, #356, #358, #359) | pieces 1, 3, 9, 10, 27 and 28                                                     |
| #339, #340, #342, #343                                        | the look target (#362) and pieces 2, 8 and 15                                     |
| #323, #324, #336, #341                                        | pieces 8, 3, 4 and the look target                                                |
| #311, #346                                                    | stay open as the bugs they are                                                    |
| #200, #337                                                    | closed by this spec: piece 29 is the watch review, and chat.md is the chat design |
| #250, #296                                                    | the operator's complaints the slice is the answer to; they close with piece 29    |

**Dropped.** Day and night as a clock, the camp and its fire, woodcutting,
fishing, cooking and eating (the flask replaces food), regions and the
frame's travel between them, and with them #231, #232, #237, #238, #245,
#251, #272, #288, #294, #299 to #302, #304, #326 and #327. Chat C11 (#357)
waits for a stream to read. Every milestone of the old plan from M2 on.

## 11. Build pieces

After #362 (look target), #363 (sim at scale) and #364 (landing generator).
Each row is one issue. Scripted chatters from a crowd file drive every
capture. The order is by what depends on what, so the raid and the bench
come after fighting and drops. A piece marked `look` draws something, gets
an art brief, and is shown by a capture at 1920 and 640 as well.

A test of a chance is one of two kinds. **Exact:** the roll is an integer
drawn below a total, so the test walks every value of the roll and counts
the results, which must equal the weights. **On a fixed seed:** a stated
number of rolls must land within 4 standard deviations of the expected
count, and the bound is written out. The seed is fixed, so such a test
passes or fails the same way on every run; 4 standard deviations is a bound
a correct roller misses on about one seed in 15,000.

| #   | Piece                             | Builds                                                                                                                                                                                                                               | Shown to work by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Inputs, the gate, the crowd       | Chat C1 and C2, with the two crowd files of usernames.                                                                                                                                                                               | A snapshot plus its log gives the live hash; hostile input changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2   | The deck and the cycle            | The world is a deck with a ramp and hatches, drawn as the look target's cut-away. Eight beats on fixed ticks. Regions, the camp and the six named residents go. `look`.                                                              | Three cycles headless with the crowd aboard; snapshot and resume across each beat give the same hash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | Joining, and a landing to walk on | Chat C3. #364's map set down at 3:00 and drawn in the pull back, ground levels and the far level, `lift_eta`, `way_home`, `ground_level`, `go_home` and the turn-back rule in a first Deckhand, everyone aboard at the lift. `look`. | Nobody stuck over 20 landings of each size. On a level-23 medium landing with one Arms-58 citizen awake, ground level never falls along a walk away from the ramp: it is 5 or less in the yard, 7 at ring 1's near edge, 23 through ring 2, and 68 over the outer half of ring 3.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 4   | The hit                           | Section 4.1 as one function over a list of modifiers, with levels, ranks, monster blow times, armour and crit. Blows in the viewer's message, cut to what a frame draws.                                                             | Both worked examples to the unit, from hand-fed lines; a test for each rounding rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | Monsters on a landing             | The standing count, each citizen's sent groups with their telegraph, the cap, the full-city rule, keeping to ground, dens named with their level, 4-tick steps, outrunning. `look`.                                                  | Exact: a citizen held on level-23 ground for 3,600 ticks is sent 16 groups, on level-5 ground 14; any 20 groups in a row before the sighting are 77 fodder, 18 pack and 3 brutes, and any 20 runner groups are 77 fodder and 27 pack; at 150 awake it gains two fifths of the points and a fodder kill drops at 10%; a citizen with two groups alive gains none; a group comes out on ground within 10 levels of its own; a blow from under a monster's line does no damage. `metrics.json` has the share of its sent monsters each scripted citizen killed and the ticks a group waited on the cap, at 15 and 150. A capture of a small landing at 150. #363's tick bar on a full medium landing. |
| 6   | Four weapons and the flask        | Shapes and times, arrows, knockback, `weapon_reach`, drinking.                                                                                                                                                                       | A test for each shape and for a body knocked into a wall.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 7   | Elements and statuses             | The four types, 4.2's statuses and lockouts, resistances, a landing's element.                                                                                                                                                       | A test for each status at its line; the four rows of 4.3's table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 8   | The fight in ink                  | Swings, hit-stop, bursts, stains, swarms and status marks, in #362's renderer. `look`.                                                                                                                                               | A mow sheet at 640 on which a judge names each citizen's weapon and element; frame time at 150 citizens, 450 monsters and 100 projectiles.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 9   | Params and the flag               | Chat C5 and C6 with section 5's params.                                                                                                                                                                                              | chat.md's tests; margin 0 and 240 differ in time out; a flag on ground past `over` is reported as held.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 10  | Orders on screen                  | Chat C7, with the card for `!me`; its gear lines fill in with piece 13. `look`.                                                                                                                                                      | A judge playing a chatter finds their citizen and sends it to a den. With 150 scripted chatters each asking `!me` once in a transit, nine in ten cards are up within 30 s and the longest wait is in `metrics.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | Drops                             | 3.2: the drop chance, the weights and their bonuses, the ten-levels-under rule, personal rolls at elites, tools, weighted tiers, wearing by level, the lines in the hit.                                                             | Exact: for each rank and for bonuses of 1, 2, 5, 15 and 20, every value of the drop roll and of the kind roll, counted against the weights; both worked cases of 3.2 to the unit; a forced roll gives each unique. On a fixed seed: 1,000,000 fodder kills give 40,000 drops, give or take 784; 100,000 lines rolled at item level 65 give 1,587 at T1, give or take 158; 100,000 elite rolls give 16,839 rares, give or take 473. A newcomer's first den gives a rare weapon it can wear.                                                                                                                                                                                                         |
| 12  | Ownership and the bag             | 3.3's ownership, carrying for another, the bag of 4 and its slowing, `keep`.                                                                                                                                                         | An owner's rare cannot be kept by another before the horn; a full bag lengthens `way_home`; a carrier's strip puts the item on the lost list under its owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 13  | Opening, the stash and wearing    | Opening at the ramp, the swap rules, the stash with its locks and bases, the kits, the rack, `!stash`, `!wear`, `!lock`, `!scrap`, the purse and the hold. `look`.                                                                   | A haul not carried over the ramp changes nothing aboard; the swap never crosses a family; `!wear fire` puts on the fire kit. Over 10,000 seeded hauls into a full stash, the item scrapped is always the lowest by 3.6's order and never locked, a base, a kit piece or a unique; a piece pushed out of one kit goes into another it betters. A citizen left away for 100 landings still has every locked item, and each kit and base is the one it had or better.                                                                                                                                                                                                                                 |
| 14  | Scrap piles and chests            | `work`, the ambush, the chest's rolls. `look`.                                                                                                                                                                                       | A pile gives one citizen 10 and then nothing, and still pays the next citizen; a chest pays everyone within 6 tiles, 20 at most, each at its own feet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 15  | Loot on screen                    | Markers, pennants in the bundle, the filter, weapons on figures. `look`.                                                                                                                                                             | A judge at 640 points at every rare on the ground and says who carries most; a capture at 150 with the caption readable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 16  | The horde                         | The horde, runners and whom they go for, lost ground and loot, away citizens going home, the horde drawn. `look`.                                                                                                                    | An away citizen is aboard before the horn on 100 landings. A present citizen on untouched settings is aboard before the horn on 100 landings, at 15 and at 150, on each size. Runners never damage a citizen they were not sent for, with arcs, burns and other citizens' blows landing on them.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 17  | Downs and the winch               | Section 8's table, the strip, `aid`, the winch lines. `look`.                                                                                                                                                                        | Each row of the table; a down at 10:59 is winched and a down at 11:01 is not; a citizen outside at 13:00 loses its haul and everything it wears whatever its margin and `ramp`, down or standing, on a winch line or not; an away citizen is never stripped twice in one absence.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 18  | The horn and the ramp             | The last wave and its level, the 8-tile rule, `guard`, the blocked ramp, the tally. `look`.                                                                                                                                          | `guard` and `board` differ in kills and in who gets aboard; with nobody out at the horn no wave comes; the wave's level follows the median of those out; a citizen ten levels over the wave gets salvage from it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 19  | The six uniques' rules            | 3.9, with each cap.                                                                                                                                                                                                                  | A test for each rule and each cap: the Blot's depth, the Rattle's 40 and 6, Rally's ten, Hoist's once. Exact: a rattled fodder kill rolls 4% twice. Last Call is in the rack after every lift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 20  | The six uniques drawn             | Their drawings and effects at far size. `look`.                                                                                                                                                                                      | A judge names each from a frame at 640.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 21  | The bench                         | The three orders, the purse's cost, Acid's four results, tools on a unique, the result over the citizen. `look`.                                                                                                                     | Each tool on each rarity; exact: Acid's roll walked over its four results; nothing spent without an order; a bench order on a stash item locks it while a lock is free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 22  | Raiders on the decks              | Lines, boarders, guns, crates, captains, credit.                                                                                                                                                                                     | Guns crewed and no hatch held: every line is cut by 2:00; no posts: salvage is lost; Heave-Ho over a rail. 600 actors at most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 23  | Parts and mending                 | Wreckers, the four parts drawn broken, mending. `look`.                                                                                                                                                                              | A broken leg moves the next sighting; a broken winch keeps away citizens aboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 24  | The raid drawn                    | The rig, lines, bodies over the rail. `look`.                                                                                                                                                                                        | A judge follows a raid at 640 without the caption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 25  | The navigator and modifiers       | The city's level, three landings ahead shown in transit, Stalked with its line, No winch, All fire, the hold's cap and the price of a high-risk landing. `look`.                                                                     | A city left alone for 100 cycles stays inside the navigator's bounds, lands on all three sizes, and takes a high-risk landing only with a full hold.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 26  | Carriers                          | The lost list and its carriers, named. `look`.                                                                                                                                                                                       | A stripped unique comes out on the next landing, drops as its owner's, and is gone after three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 27  | Speech and quiet chatters         | Chat C4, C8, C10, and the card on coming back. `look`.                                                                                                                                                                               | chat.md's tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 28  | The site and presets              | Section 9's controls with C13; Longhaul and `!run` with C12. `look`.                                                                                                                                                                 | Each control sends its `mod` input; the two presets differ in haul on one seed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 29  | The hour                          | One hour at 15 and one at 150 scripted chatters.                                                                                                                                                                                     | The watch judge's verdict from a player's seat has no "no"; the playtester's list has nothing above polish; the levels reached are within a level of plan.md's table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Pieces 1 and 4 can start beside 2. After 13, pieces 15, 16 and 21 are in
different packages.

Known to be thin: a citizen kills what it is sent, so better gear shows as
deeper ground and time to spare for dens, chests and other citizens' groups,
and not as more kills on the same ground, which piece 5's share of monsters
killed has to show is enough; `keep` cannot tell a level-65 base from a
level-10 one on the ground, though the stash can; a base is only a better
number than the one below it; the last wave's level follows who stays out,
and whether chat reads "last wave 64" in time to board is untested; the horde takes the far ground first, so the
strongest citizens get about 2,600 ticks on it where everyone else gets
3,600 on theirs, and they level slower than plan.md's table says; a large
landing at 24 px a tile draws a citizen under art.md's far size, and if #362
says no, a large landing is a medium one with a higher far level; six
uniques are few for a 27-hour drop.

## 12. After the slice

- Transit meets other things than raiders, and then another streamer's
  city, on the decks and the lost list this slice builds.
- The city grows from the hold: hull sizes, biomes, bosses on large landings,
  landing levels to 99.
- A site for chatters once there is single sign-on: the stash as a page, and
  programs of their own.
