# The slice

One 13-minute cycle of the walking city, specified to build from. It is the
spec for [#361](https://github.com/nnamon/Idlin/issues/361) and replaces the
milestones that were in [plan.md](plan.md). Built so far: section 4.1's hit
(`packages/sim/src/hit.ts`), through which the world runs every blow, and
section 3.1's four weapon families and the flask
(`packages/sim/src/weapons.ts`), in the camp world, with no gear, ranks or
armour yet; and section 5's params and the flag, with a first Deckhand that
reads `stance`, `margin` and the flag (`packages/sim/src/orders.ts`,
`content/bots/deckhand.tac`). That Deckhand has the defaults from before
the siege was specified: a margin of 120, `stance` at gather, and `ramp` as
board or guard. Pieces 14 and 31 move them to section 5's. Every rate
is arithmetic from a rule on this page; section 11 names the piece that
tests the rule.

Fixed by the operator and not reopened here: one streamer is one city; every
chatter is a citizen; every citizen is on one screen at all times; the zoom
is the pacing; the landing is a map of pockets to explore, with peace before
the horde; the horde is time pressure and then a siege of the city's shield,
in the seven phases of [#413](https://github.com/nnamon/Idlin/issues/413);
the city and its maps grow over many hours; missing lift-off costs haul and
gear; the streamer alone decides for the city, every decision has a default,
and nothing is voted on; chatters steer only their own citizen, through chat
([chat.md](chat.md)); rival cities come later.

**Words.** A citizen's **haul** is what it carries and has not banked.
**Worn** is the gear on its body. Aboard it has a **stash** of 12 numbered
slots, three **kits** (a coat and a charm against each element), a **rack**
for uniques and a **purse** of up to 40 salvage; nothing takes any of them.
The **hold** is the city's salvage, and the **works** are its ore, which
pays for the shield and the hull. The **bubble** is the shield over the
city's ground. A **tool** is a currency item: a Reroll, an Add or an Acid.
**Present** is chat.md's word: the chatter typed in the last 20 minutes.
Otherwise they are **away**.

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

Ten ticks a second. A cycle aims at 13 minutes, 7,800 ticks. The landing
inside it ends when the shield breaks, and nothing breaks the shield but the
horde: its strength runs out when the siege's swarms outgrow what the
citizens can kill, and the shield's level and the fight at its wall decide
how long that takes. The transit after it takes what is left of the 13
minutes and never less than 3:00, so a long siege makes a long cycle.

| Clock         |           Tick | Beat                                                                 | Frame                                      |
| ------------- | -------------: | -------------------------------------------------------------------- | ------------------------------------------ |
| 0:00          |              0 | The cycle starts. Transit.                                           | close on the city                          |
| 1:00          |            600 | A raider rig is sighted. Lines land at 1:20; over by 2:50.           | widens to hold both machines               |
| 3:00          |          1,800 | Legs plant. The landing is inked outward. The shield holds from now. | one pull back, 6 to 8 s                    |
| 3:20          |          2,000 | Ramp down. **1. Peace.**                                             | the whole landing                          |
| 6:30          |          3,900 | **2. Scouts** come in at the four gaps and look for citizens.        | the same                                   |
| 8:00          |          4,800 | **3. The sighting.** The front gathers along the rim.                | the same, black along the rim              |
| 8:30 to 9:30  | 5,100 to 5,700 | **4. The march.** The front closes on the city in 75 seconds.        | closes with the horde (art.md, section 12) |
| 9:45 to 10:45 | 5,850 to 6,450 | **5. The siege.** The front is at the bubble and slams it.           | on the shield, with the horde round it     |
| at strength 0 |                | **6. The break.** The horn. Everyone boards.                         | the same                                   |
| 30 s later    |    break + 300 | **7. Lift-off.** Anyone outside is winched aboard and stripped.      | closes on the city in 4 s                  |

After lift-off the city is in transit. The next cycle's 0:00 is at 13:00 of
this one, or at lift-off if that comes later, and its legs plant at 3:00, so
a transit is 3:00 at the least and takes up whatever the landing left of the
13 minutes. The floor is the raiders' beat, which runs from 1:00 to 2:50 of
every transit (section 7). A new city on untouched settings, with the march
at 9:00, breaks at 11:08 and walks for 4:22 before it plants again. A
level-10 shield held by a strong roster of 15 breaks at 12:48 untouched and
at 13:07 with everyone on `guard`, which walks for 3:00 and makes a cycle of
13:37. On untouched settings no roster in section 1's numbers gives a cycle
over 14:20. The longest cycle there can be is 17:11: a level-10 shield,
every caller stopped so the march is at 9:30, and 150 citizens at Arms 99
in the best gear all on `guard` on a level-1 landing, where every swing
kills (the siege, below). A broken leg or a run from
raiders brings the scouts, the sighting and everything after them forward
(sections 7 and 9).

### Growth

The city and its landings grow, and the map grows faster, so the city takes
less of the frame as it gets bigger. There are four city sizes. A city lands
on three sizes of landing, which the navigator rolls (section 9).

| City | Hull, tiles | Legs | Its feet stand over | The bubble | Small    | Medium    | Large     | Reached after |
| ---: | ----------- | ---: | ------------------- | ---------- | -------- | --------- | --------- | ------------- |
|    1 | 13 by 6     |    6 | 19 by 12            | 23 by 16   | 52 by 29 | 56 by 31  | 60 by 33  | the start     |
|    2 | 15 by 6     |    8 | 21 by 14            | 29 by 22   | 68 by 38 | 80 by 45  | 96 by 54  | 7 hours       |
|    3 | 17 by 7     |    8 | 23 by 15            | 31 by 23   | 80 by 45 | 96 by 54  | 112 by 63 | 48 hours      |
|    4 | 19 by 8     |   10 | 25 by 16            | 33 by 24   | 96 by 54 | 112 by 63 | 128 by 72 | 202 hours     |

Every hull berths 150 citizens, chat.md's number. art.md gives a deck two
citizens a tile (section 7), so a hull needs 75 tiles: the first is 13 by
6, 78 tiles, where the 11 by 5 of the last draft held 110. A hull is a
quarter of the frame's width at most (art.md, section 7), and 13 tiles stay
under a quarter of 1,880 px only at 36 px a tile or less, so the first
city's smallest landing is 52 by 29, at 35. The bubble is the planted feet and 2 tiles round them for
the first city and 4 for the others, art.md's foot (section 7). The second
city's small landing is 68 by 38 because its bubble of 29 by 22 on 60 by 33
would leave three and a half tiles of ground north and south of it inside
the rim, too few for a pocket, and art.md asks ten tiles beyond the feet
there (section 4); 68 by 38 leaves twelve.

Hours are hours of stream on untouched settings. The city is paid for from
the **works** (section 9): ore that citizens dig from seams and wrecks on a
landing and carry up the ramp. The streamer chooses what the works build
next, and the default order is in section 9. The hull in the look target
(#362) is the second city's, and its expedition is drawn on that city's
medium landing, 80 by 45.

**One frame.** Nothing scrolls and nothing is cut to. The frame holds the
whole landing from the pull back until the march, and from the march it
closes with the horde, holding every citizen still out (art.md, section
12). The picture inside the frame's rule is 1,880 by 1,040 px at 1920
(art.md, section 11) and every landing is about 16:9, so a tile's size in
pixels is what the landing's tile count leaves it. A citizen's height comes
from that, by art.md's table (section 5), and monsters and things keep
their size against the citizen.

| Landing   | Tiles | px a tile | Hull's width in the frame      | Stands at legs-plant | Dens wait at | The plate holds |
| --------- | ----: | --------: | ------------------------------ | -------------------: | -----------: | --------------: |
| 52 by 29  | 1,508 |        35 | 24% (city 1)                   |                  251 |          301 |             351 |
| 56 by 31  | 1,736 |        33 | 23% (city 1)                   |                  289 |          339 |             389 |
| 60 by 33  | 1,980 |        31 | 21% (city 1)                   |                  330 |          380 |             430 |
| 68 by 38  | 2,584 |        27 | 22% (city 2)                   |                  430 |          480 |             530 |
| 80 by 45  | 3,600 |        23 | 18% (city 2), 21% (3)          |                  600 |          650 |             700 |
| 96 by 54  | 5,184 |        19 | 15% (city 2), 17% (3), 19% (4) |           after #418 |              |                 |
| 112 by 63 | 7,056 |        16 | 14% (city 3), 16% (4)          |           after #418 |              |                 |
| 128 by 72 | 9,216 |        14 | 14% (city 4)                   |           after #418 |              |                 |

The hull's width is its tiles times the px a tile over 1,880. On its medium
landing the hull is 23%, 18%, 17% and 16% of the frame's width for the four
cities, and the ground under its feet is 13%, 8%, 7% and 6% of the map's
tiles. City 4 on 128 by 72 is 14.1%, a little under art.md's seventh, and
#418 settles it.

**What the slice builds.** City sizes 1 and 2, the first city's three
landings and the second city's small and medium: five landings, up to 80 by
45. The works, so a city left running becomes the second city in about
seven hours. Left for after the slice (#418): the second city's large
landing and city sizes 3 and 4. They need two things the slice does not
have. The generator refuses a map over 4,096 tiles. And nobody has timed a
tick past 150 citizens and 700 monsters: this page's rate would stand 864
to 1,536 on those maps, and 150 citizens with 980 monsters ticked at 4.2 ms
on #396's review, over plan.md's bar. Until then the second city rolls
small and medium only (section 9).

### What a landing holds

Counts go by the landing's tiles, so a bigger map has more of everything and
the same amount to a screen of ground.

| Landing   | Dens | Chests | Shrines | Wrecks | Scrap piles | Seams | Pockets | Posts | Longest walk from the ramp |
| --------- | ---: | -----: | ------: | -----: | ----------: | ----: | ------: | ----: | -------------------------: |
| 52 by 29  |    2 |      1 |       1 |      0 |          15 |    10 |       9 |    27 |                       18 s |
| 56 by 31  |    2 |      2 |       1 |      0 |          17 |    11 |       9 |    34 |                       19 s |
| 60 by 33  |    3 |      2 |       1 |      1 |          19 |    13 |      13 |    40 |                       21 s |
| 68 by 38  |    4 |      2 |       1 |      1 |          25 |    17 |      18 |    45 |                       25 s |
| 80 by 45  |    5 |      3 |       2 |      2 |          36 |    24 |      26 |    71 |                       28 s |
| 96 by 54  |    7 |      5 |       3 |      2 |          51 |    34 |    #418 |  #418 |                       #418 |
| 112 by 63 |   10 |      6 |       4 |      3 |          70 |    47 |    #418 |  #418 |                       #418 |
| 128 by 72 |   13 |      8 |       5 |      5 |          92 |    61 |    #418 |  #418 |                       #418 |

Dens are one for each 700 tiles, to the nearest. Chests are one for each
1,100 and shrines one for each 1,800, to the nearest and one at least.
Wrecks are one for each 1,800, rounded down. Scrap piles are one for each
100 tiles and seams one for each 150, rounded down. A landing also gets one
den and one chest more for each 15 citizens awake, rounded up. Pockets are
about one for each 140 tiles (art.md, section 8), and the posts are what
the stand-ins below have at the median with 15 awake. The walk is unloaded
and at the median, and a full bag makes it half as long again.

What stands at legs-plant is the landing's **room**: 30 monsters for each
180 tiles, rounded down, on the slice's maps: 251, 289, 330, 430 and 600 on
80 by 45. It is the same with 15 awake and with 150. Dens let nothing out
while the plate holds 50 over the room, and the plate holds 100 over it at
most, 700 on 80 by 45. Maps over 80 by 45 get a room when #418 has timed a
tick at their size.

**A bigger landing is a harder one.** Each city's small, medium and large
landing sets the far level (below) 7, 10 and 15 levels over its strongest
citizen.

**Where the numbers come from.** `packages/sim/scripts/plate.ts` lays
landings by the rules of this section and prints every number in it. It
builds stand-ins for every size, cut the way the generator cuts its maps,
with the yard as the bubble and open to every pocket beside it, as #415 and
#416 will have it. The generator (`packages/sim/src/landing.ts`) has the
slice's five landings, cut as the stand-ins are, and sets the pockets'
levels, aims the dens and stands the first chest by the rules below; its
yard is the bubble's footprint, square-cornered and walled until #416.
`--generator` lays its maps by the same rules. The commands are under the
fairness table.

**Pockets.** The generator cuts the map into districts joined by passages,
and a walk leaves a district only through one of its passages. The city
parks in the middle, on a district of its own, and its ramp comes out of
whichever side the seed draws. Each other district is a **pocket**: the
packs, the den or chest, the piles, seams, shrine or wreck laid in it are
what a citizen walks there for. Pockets lie on all four sides of the city on
all 100 stand-ins of every size the slice builds. The rim of the map is
broken by one gap on each side, and the horde comes in at all four.

**The yard and the bubble.** The **yard** is the city's own district, and
its ground is the bubble's footprint: a rectangle round the ground the feet
stand on, 2 tiles clear of it on every side for the first city and 4 for
the others, with its corners rounded on a radius of 3 tiles (a tile is in
it when its centre is). That is 23 by 16 for the first city and 29 by 22
for the second, and it is the foot art.md draws (section 7). The shield's
**bubble** covers the yard from legs-plant until the shield breaks, and is
drawn from the march. Nothing of the map or the horde enters it or strikes
into it, and no blow or shot leaves it, the rail's and the gun posts'
included. The yard opens onto every pocket beside it along their whole
shared side, so the bubble has ground outside it all the way round. The
generator's yard is the footprint, square-cornered and walled, with a few
gates; #416 rounds it and opens it. The stand-ins, which are
square-cornered, have 84 tiles of the bubble's edge with ground outside
them on 80 by 45, where the generator's map has 28.

**Level and ground.** A landing has a **level**, which the navigator sets
(section 9), and a **far level**, set in transit when the landing is chosen:
the highest Arms among the citizens awake, or the landing's level if that is
higher, plus the 7, 10 or 15 of its class, and 99 at most. The generator
takes both (#415).

Each pocket has one **level**, and every tile of it has that **ground
level**. The pockets are taken in order of the walk out of the yard to
their nearest tile, their **gate** (then the walk to their centre, then the
lower district number), and of P pockets the kth, counting from 0, is in
ring 1 + floor(3k / P): the nearest third in ring 1, the next in ring 2 and
the farthest in ring 3. With L the landing's level, F the far level and n
a third of L (rounded down, 1 at least):

| Ground   | Its level                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The yard | n, and 5 at most                                                                                                                                                                                                      |
| Ring 1   | of its m pockets in order, the kth from 0 at n + (L − n) × k / m, rounded down                                                                                                                                        |
| Ring 2   | L                                                                                                                                                                                                                     |
| Ring 3   | its nearest h pockets step: the kth from 1 at L + (F − L) × k / h, rounded down, so the hth is at F. The rest are at F. h is half its m pockets rounded up, or (F − L) / 10 rounded up if that is more, and m at most |

A tile outside every district, a passage's gate or a gap's mouth, has the
lower level of the districts beside it. So the ground gets harder going out
from the city on every side, and the hardest of it is at the rim, where the
horde comes in. With steps of 10 levels or less, every level from L to F is
within 5 of a pocket's. A pack on a post has its pocket's level, a den's
level is its pocket's, a pack in a den keeps its own level (within 5 of the
den's), and a drop has the item level of its monster. So the roster's
median fights in ring 2, a newcomer in ring 1's first pockets, and every
citizen between has a pocket of its own level. The strongest citizen aboard
always has ring 3's farthest pockets at 7 to 15 levels over its own,
whatever the median is. On a level-23 medium landing of 26 pockets whose
strongest citizen has Arms 58, ring 1's nine pockets are at 7, 8, 10, 12,
14, 15, 17, 19 and 21, ring 2's nine at 23, and ring 3's eight at 32, 41,
50, 59 and 68, and 68 for the last three. A pocket's level is lettered at
its gate (below), so a chatter reads the level of a whole pocket before
sending a citizen into it.

**Element.** The biome gives the landing one: none for meadow and pinewood,
cold for fen, lightning for crags, fire for ash waste (section 4).

### Packs, shares and dens

Ranks, formulas and step times are [plan.md](plan.md)'s. A monster's blow is
wind-up plus recovery in ticks: fodder 3 + 6, pack 4 + 8, brute 6 + 14,
elite 5 + 10.

Everything a citizen fights in the peace is laid in the pockets when the
legs plant. Nothing comes out of the ground beside a citizen, then or later:
a den's packs walk out of its mouth to a post, and the horde's monsters walk
in from the gaps and out of the black.

- **Packs.** Monsters stand in packs, each with a leader: a **swarm** is 10
  fodder led by a pack monster, a **pack** is 3 pack monsters led by a
  brute, and a **brute pack** is 3 brutes, one of which leads. A pack stands
  at its **post** until a citizen it will go for comes within 6 tiles of any
  of it, and then the whole pack goes for that citizen. The leader's mark is
  art.md's (section 6); the crest is the elite's alone.
- **Shares.** When the legs plant, each citizen awake gives the landing a
  **share** of packs: one pack for each 3 levels of its Arms, counted as 20
  at least. Shares are held in hundredths of a pack, rounded to the nearest,
  and the remainder carries to the citizen's next landing, so a level-23
  citizen's share is 7.67 packs (23/3), a level-58 one's 19.33 (58/3), and
  anyone under level 21 gets 6.67 (20/3). The packs come in a fixed order of
  10, `S P S S B S+5 P S P+5 S+10` (swarm, pack, brute pack, and how many
  levels over the share a pack is), which is 60 fodder, 15 pack monsters
  and 6 brutes. A citizen keeps its place in the order between landings and
  starts at a place seeded by its account. A share's level is its citizen's
  Arms, held between ring 1's first level and the far level,
  and a pack 5 or 10 over is held at the far level too. Once laid, a share
  is nobody's: anyone may kill it.
- **Posts.** A **post** is a pocket tile whose eight neighbours are all
  walkable tiles of the same pocket, with nothing standing on it or on any
  of those eight: no den, chest, shrine, wreck, pile or seam. The posts are
  fixed at legs-plant before anything is laid: taking the tiles in order
  (row by row from the top left), a tile is a post if no post already taken
  in its pocket is within 3 tiles of it, counting a diagonal step as one. A
  pack stands on its post and the eight tiles round it, which hold a swarm
  at three fodder to a tile, so two packs' squares always have a tile of
  open ground between them. art.md asks two (section 6); with posts more
  than 4 apart the 80 by 45 stand-ins have 59 posts at the median where they
  have 71, and stand 509 monsters at 15 awake against a room of 600, so the
  spec keeps one and the art director has the question.
- **Laying out.** Laying goes in two rounds. In the first, the shares take
  turns, in an order drawn from the landing's seed, to lay their next pack
  that no den could take, because no den is within 5 levels of it; in the
  second they do the same with the rest. A pack goes on the free post whose
  ground level is nearest its own (then the one nearer the ramp by the walk,
  then the lower tile number), if that is within 5 levels and the pack fits
  in the room that is left, and it takes that post's ground level. A pack
  that gets no post goes into a den within 5 levels of it whose pocket has a
  post, the one holding the fewest monsters (then the lower den number), and
  keeps its own level. A den holds 60 packs at most. A pack neither can take
  is not laid.
- **The floor.** If the shares leave the plate under its room, because few
  citizens are awake or their levels fit few posts, the landing lays packs
  of its own on the free posts until the room is full or no post is free.
  They come in the order of 10 from a place the seed draws, each at its
  post's ground level, on the post in the pocket with the smallest part of
  its posts taken (then the one farthest from the ramp by the walk, then the
  lower tile number). They are nobody's share and pay as written. With 150
  awake the shares fill the room on their own. With 15 the script lays a
  median of 59 monsters of the map's own on 80 by 45 and none on the first
  city's landings. With 2 awake at Arms 23 the shares are 124 monsters on
  80 by 45 and the map lays 424 of its own.
- **What a monster pays.** Every monster laid from a share pays the share's
  weight over the weight of what of it was laid, counting rank weights as
  plan.md, section 2.3, does (1, 3 and 12), and 5 at most. The pay is kept
  as that fraction: a monster's experience is multiplied by it and rounded
  down, and so are its drop chance and its tool chance, which are held in
  hundredths of a percent. A chance past 100% gives one drop for each whole
  100% and rolls what is left. So the laid part of a share pays out the
  share's whole weight exactly, unless the share was laid under a fifth and
  its pay was held at 5. Experience then comes to what the whole share would
  have given. Drops come to about the same; they are off a little because
  ranks do not drop alike for their weight: a weight of 12 is 0.48 drops as
  fodder, 0.60 as pack monsters and 0.40 as one brute, and the brute's are
  rare twice as often. Everything else pays as written: the map's own packs,
  elites, guards, boarders, scouts and the siege.
- **Dens.** A den is a mouth in a pocket, and a pocket holds one at most. It
  is lettered `den` with a letter and its level, as `den B 28`: A for the
  den with the shortest walk from the ramp, then B and so on (then the lower
  tile number). The letter is its name for `!go` (section 5). Its elite, 5
  levels over the den and never over the far level, stands at the mouth
  from legs-plant. The packs laid
  into the den wait inside, and come out on a clock set at legs-plant:
  - its first two packs come out at legs-plant, if the room had them and
    its pocket had free posts;
  - the rest come out one a turn, a turn every 3,000 ticks divided by the
    number inside after those two, rounded down and fixed at legs-plant, so
    the last is due by the sighting;
  - on its turn the den lets the next pack out, in the order they were laid
    into it, if its pocket has a free post and the plate holds fewer than
    50 over its room (650 on 80 by 45); otherwise that turn passes and the
    pack waits for the next one;
  - when several dens have a turn on one tick, the one whose last pack came
    out longest ago goes first (then the lower den number), and the plate is
    counted again after each, so no den waits behind the others every time;
  - a pack let out walks from the mouth to the free post of its pocket
    whose walk to the nearest citizen out on the plate is longest (the walk
    to the ramp while nobody is out; then the lower tile number), and stands
    there as a laid pack does.

  A death never brings the next pack sooner: the clock does. A den's pocket
  is laid like any other, so its posts may all be taken at legs-plant, and
  then the den waits until citizens have cleared one. A swarm let out one
  under the limit takes the plate 10 over it, which the cap allows. The
  clock stops when the front marches, and what is still inside is lost with
  the den when the black covers it. The elite's death does not stop the
  clock. The den is cleared when it is empty and its elite is dead, and it
  does not fill again. A den with 60 packs has a turn every 51 ticks; one
  with 8, the median at 15 awake on the second city's medium landing, a
  turn every 500. Turns that pass run the den late, and the clock stopping
  at the march covers that. A den whose pocket has no post takes no packs
  and is its elite alone.
- **Where dens stand.** The size's own dens are aimed once the far level is
  known (#415), one at each level of ring 3's pockets from the far level
  down: the first in a pocket at the far level, so it holds the strongest
  citizen's packs 5 and 10 over and its elite is at the far level, and the
  next in ring 3's stepping pockets below it, so every level from the
  landing's to the far level has a den within 5 to take what its posts
  cannot. Own dens past those levels stand where the generator spreads them,
  more of them in the far rings, more than 8 tiles from the ramp. The first
  den the roster adds stands in ring 1's first pocket, on its tile nearest
  the yard, so newcomers have one. An aimed den takes, in the pocket with no
  other den whose level is nearest its aim, the tile clear of everything
  else that stands nearest the yard (then the lower tile number). A den's
  elite is 5 levels over the den and never over the far level.
- **Nothing is replaced.** A monster that dies stays dead for the landing.
  The only monsters that appear after legs-plant are a den's own packs,
  walking out of its mouth to a post, and the horde's.
- **Keeping to the pocket.** A laid monster never leaves its pocket: the
  tiles of its district and the gates of that district's passages. It
  breaks off a chase at the edge and walks back to its post. A blow from a
  citizen standing outside the pocket does it no damage, so it cannot be
  shot from a gate or across a border. It does not go for a citizen ten or
  more levels over it until that citizen strikes it, so a strong citizen
  walks through a weak pocket and leaves it to the citizens it was laid
  for. Nothing laid follows a citizen to the bubble.
- **The room and the cap.** The room counts everything standing on the
  plate at legs-plant: the dens' elites, the guards of chests, shrines and
  wrecks, the packs on posts and the two packs out of each den. Laying stays
  inside it. The plate holds 100 over the room at most. Dens let nothing out
  while it holds 50 over, which leaves 50 for scouts, and a scout pack or a
  siege swarm that would pass the cap waits in the black.
- **Elites** are the dens', a modifier's, and the carriers of the lost list
  (section 8).

### What a pocket holds

Every pocket has packs on its posts. Besides them it holds things to take,
and each thing of worth has monsters standing by it. They are all there
from legs-plant, and the peace is the time to get round them.

| Thing      | Guarded by               | To take it                                        | It gives                                                                                      |
| ---------- | ------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Den        | its elite, and its packs | kill the elite                                    | one elite roll to each citizen within 6 tiles (3.2), and its packs to fight                   |
| Chest      | a guard pack beside it   | kill the guard, then 80 ticks of standing work    | one chest roll to each citizen within 6 tiles                                                 |
| Shrine     | a guard pack beside it   | kill the guard, then 30 ticks of work             | its boon, for 60 seconds, to each citizen within 6 tiles when it is touched; then it is spent |
| Wreck      | a guard pack beside it   | kill the guard, then 100 ticks of work, 4 at once | 20 ore to each citizen that does the work, once each                                          |
| Seam       | the packs of its pocket  | five tries of 12 ticks                            | 5 ore to each citizen that works it, once each                                                |
| Scrap pile | the packs of its pocket  | five tries of 12 ticks                            | 10 salvage to each citizen that works it, once each                                           |

- A **guard** is a pack of 3 pack monsters and a brute leader, at the level
  of the ground its thing stands on, posted beside it. The thing cannot be
  worked while any of its guard lives. Nothing comes out of the ground when
  it is opened or touched.
- **Chests.** The size's first chest stands in a pocket at the far level
  (then one with no den, then the tile nearer the yard), so the strongest
  citizen has two rolls at the far level, its den's elite and that chest,
  and those can carry T1 lines (3.2).
- **Shrines** have one of three boons, drawn from the seed and shown on the
  shrine as an icon: **quick**, steps a tick shorter; **keen**, 30% more
  damage, as a "more" (4.1); **lucky**, rare and unique weights times 1.5 on
  the citizen's own drops (3.2). A boon lasts 600 ticks from the touch,
  wherever its citizen goes, and shows on the figure.
- **Ore** is the works' material (section 9). It is carried like salvage, 10
  to a bag slot, and banked at the ramp. A seam or a wreck is used up for a
  citizen once it has had its ore, and is still there for the next, so both
  are worth the same to each citizen in a full city as in a small one. A
  wreck is slow and takes four at a time, so at 150 awake there is a wait at
  it: 4 citizens every 10 seconds.
- **Scrap piles** go to pockets with no den while those have room. Seams
  are shared out by the size of a pocket. Shrines and wrecks go to a pocket
  with no den or chest while there is one. None stands within 8 tiles of
  the ramp (#416).

**What the plate shows.** As the ink reaches a pocket at legs-plant, what
was laid in it is drawn: each pack at its post with its leader marked; each
den's mouth, lettered `den` with its letter and level (`den B 28`) and
drawn as full as the packs still inside it; each chest; each shrine with
its boon; the wrecks, seams and piles. A pocket's level is lettered once,
at its gate on the city's side, at 36 px: the number a chatter needs before
typing `!go`, and the level of every pack laid on its posts. Nothing else
is lettered on the ground: a pack's level is its pocket's, a chest's is its
pocket's too, and the packs in a den are read from how full its mouth is.
A cleared den, an opened chest and a spent shrine are drawn spent. How each
is drawn is art.md's (sections 6, 8 and 11); the pocket's level at its gate
is the one mark art.md does not list yet.

### Enough for every citizen

`plate.ts` applies the rules above to 100 landings of each size. The second
city's landings are laid at level 23 for a crowd of 15 (Arms 6 twice, 23 ten
times, 40 twice and 58 once) and one of 150 (30 at Arms 6, 90 at 23, 20 at
40 and 10 at 58). On its medium landing, 80 by 45, on stand-ins:

| Awake | Arms | Citizens | Share, monsters | Standing | In dens | Laid |  Pay | Paid | Walk to its packs |
| ----: | ---: | -------: | --------------: | -------: | ------: | ---: | ---: | ---: | ----------------: |
|    15 |    6 |        2 |              54 |       50 |       2 |  96% | 1.04 | 100% |             9.6 s |
|    15 |   23 |       10 |              62 |       27 |      26 |  83% | 1.20 | 100% |            14.8 s |
|    15 |   40 |        2 |             108 |       21 |      77 |  91% | 1.06 |  97% |            19.6 s |
|    15 |   58 |        1 |             157 |       59 |      61 |  74% | 1.33 |  99% |            20.8 s |
|   150 |    6 |       30 |              54 |        5 |      23 |  50% | 1.83 |  92% |            10.0 s |
|   150 |   23 |       90 |              62 |        3 |      35 |  61% | 1.64 | 100% |            15.2 s |
|   150 |   40 |       20 |             108 |        2 |      43 |  39% | 2.45 |  96% |            19.2 s |
|   150 |   58 |       10 |             157 |        6 |      78 |  50% | 1.98 |  99% |            21.2 s |

The monster columns are means for one citizen of the tier: what stood on a
post at legs-plant (laid there or one of a den's first two) and what waited
inside a den. The three share columns are over all of the tier's shares, by
rank weight. Laid is the part that went on a post or into a den. Pay is what
each laid monster paid on average, with pay held at 5. Paid is Laid times
Pay: the part of the tier's shares its laid monsters pay out if all of them
are killed. It falls short of 100% where a share was laid under a fifth, so
its pay was held at 5, or had nothing laid at all, which happened to 6 of
the 200 Arms-40 shares at 15 and to 60 of the 2,000 at 150. The walk is the
median from the ramp to the tier's packs on posts, unloaded. The commands:

```sh
docker compose run --rm dev node packages/sim/scripts/plate.ts              # the slice's five landings, on stand-ins
docker compose run --rm dev node packages/sim/scripts/plate.ts --middle 30  # the same, with the tier between the median and the strongest at Arms 30
docker compose run --rm dev node packages/sim/scripts/plate.ts --generator  # the slice's five landings, on generateLanding's maps
docker compose run --rm dev node packages/sim/scripts/plate.ts --few        # a roster of two at Arms 23
docker compose run --rm dev node packages/sim/scripts/plate.ts --growth     # every landing of every city size
docker compose run --rm dev node packages/sim/scripts/plate.ts --pace       # levels, drops, the siege and the works
docker compose run --rm dev node packages/sim/scripts/plate.ts --siege      # the growing horde, how long a shield holds, the cycle
docker compose run --rm dev node packages/sim/scripts/plate.ts --map 2m 7   # one landing, drawn as text
```

**The floor holds.** On that landing 583 monsters stand at legs-plant at the
median with 15 awake (452 to 600 over the 100 landings) and 597 with 150
(495 to 600), against a room of 600. Cut in half through the city, across
or down, the smaller half holds 44% of them at the median at 15 and 43% at
150, and under a fifth on none of the 200. At 15 about 460 more wait in the
6 dens, and the dens let them out over the six minutes to the sighting, a
pack every 23 seconds or so each at the median. At 150 about 5,600 wait in
15 dens, nine tenths of what is laid: most of the fighting at 150 comes out
of dens, a pack every 5 seconds from each.

**The tiers over the median.** The crowd has one tier between the median
and the strongest. Moved to Arms 30, 40 and 50 with nothing else changed,
Paid for that tier and then for the strongest, at 15 awake and at 150:

| The tier between | City 2, small, 68 by 38, stand-ins | City 2, medium, 80 by 45, stand-ins | 68 by 38 on the generator's maps | 80 by 45 on the generator's maps |
| ---------------- | ---------------------------------- | ----------------------------------- | -------------------------------- | -------------------------------- |
| Arms 30          | 92% and 93%; 96% and 92%           | 89% and 99%; 84% and 99%            | 90% and 96%; 91% and 93%         | 96% and 100%; 90% and 100%       |
| Arms 40          | 98% and 93%; 98% and 92%           | 97% and 99%; 96% and 99%            | 95% and 96%; 87% and 93%         | 99% and 100%; 96% and 100%       |
| Arms 50          | 95% and 91%; 93% and 88%           | 93% and 98%; 85% and 99%            | 98% and 96%; 82% and 90%         | 100% and 100%; 89% and 100%      |

The first pair in each cell is at 15 awake and the second at 150. Every
tier is paid 89% or more at 15 awake on 80 by 45, and 84% or more at 150 on
stand-ins. The generator's maps have 26 pockets on 80 by 45 and 70 posts at
the median, and stand 593 at 15 and 595 at 150 against the room of 600. On
its five landings every tier is paid 90% or more at 15 awake and 82% or
more at 150; the shortest is 68 by 38's tier at Arms 50 at 150.

**The other landings.** Paid, for the four tiers in the first table's
order, at 15 awake and then at 150, on stand-ins:

| Landing                  | At 15                | At 150              | Stands at legs-plant, median |
| ------------------------ | -------------------- | ------------------- | ---------------------------: |
| City 2, small, 68 by 38  | 100%, 99%, 98%, 93%  | 95%, 100%, 98%, 92% |          378 and 395, of 430 |
| City 2, medium, 80 by 45 | 100%, 100%, 97%, 99% | 92%, 100%, 96%, 99% |          583 and 597, of 600 |

The first city is built over in about seven hours, by when nobody is past
level 20, so its landings are laid at level 8 for a young crowd: Arms 3, 8
and 15, as 3, 9 and 3 citizens at 15 awake and 30, 90 and 30 at 150. On
stand-ins:

| Landing                  | At 15           | At 150          | Stands at legs-plant, median |
| ------------------------ | --------------- | --------------- | ---------------------------: |
| City 1, small, 52 by 29  | 100%, 100%, 99% | 100%, 100%, 88% |          229 and 223, of 251 |
| City 1, medium, 56 by 31 | 100%, 100%, 99% | 100%, 100%, 95% |          270 and 287, of 289 |
| City 1, large, 60 by 33  | 100%, 100%, 99% | 100%, 100%, 94% |          326 and 328, of 330 |

So every tier is paid nine parts in ten or more at 15 awake on every
landing but one cell, Arms 30 on 80 by 45 at 89%, and the shortest at 150
on stand-ins is 84%. A pocket of one level holds only its own posts, so what carries a
tier between the median and the strongest is a den at its level: with the
size's own dens aimed at ring 3's steps, every such level has one within 5.
The first city's smallest landing has few posts, 27 at the median, and
stands 229 of its 251. The strongest citizen's packs are where its citizen
is: of the 21 monsters of the hour-100 citizen's share due at 65 or more,
44 are laid at 65 or more on the medium landing at 15 awake, because its
packs 5 over take the far pockets' level, so the T1 figures in 3.2, which
count only the 21, are a floor. These are estimates from the rules as
written here, and piece 5 measures them in the simulation.

### The horde

The horde is time pressure and then a siege, and nobody fights it in a line.
Scouts come first, then the front gathers and marches, and then it besieges
the city's shield. Ground it has covered is lost for the landing.

**Scouts** (from 6:30).

- A **scout pack** is five scouts, which are fodder that step in 3 ticks to
  a citizen's 4, and a **caller** of pack rank. Three waves come in, at
  6:30, 7:00 and 7:30. A wave is one pack for each 5 citizens outside the
  bubble at that tick, rounded up, shared over the four gaps in turn from a
  gap the seed draws. With 13 of 15 out that is 3 packs a wave and 9 in
  all, 54 monsters; with 130 of 150 out, 26 a wave. A pack that would take
  the plate past its cap waits at its gap and is not counted as sent until
  it comes in.
- **How they find a citizen.** A scout pack walks toward the citizen
  outside the bubble that is nearest to it by the walk and is no other
  pack's mark, or the nearest of all if every one is marked. It chooses
  again every 50 ticks until it is within 8 tiles of one, and that citizen
  is its **mark**. Its level is the Arms of the citizen it first heads for,
  held as a share's level is. If its mark goes inside the bubble or goes
  down it looks for another. With nobody outside the bubble it goes back to
  its gap and waits there, in the black once there is black, and sets out
  again when a citizen steps out. A pack with no mark at the sighting goes
  back to its gap, and its caller calls there. A pack that came in
  counts in `sent` whether or not it found anyone, so a crowd that steps
  inside as the waves arrive does not put the march off: the callers call at
  the gaps, where only a citizen who walks out to them can stop them.
- **What they do.** The five scouts go for the mark. The caller stops where
  it found the mark and **calls**: a wind-up of 100 ticks, drawn filling.
  Killing the caller ends the call, and a stagger (4.2) starts it again
  from nothing. A call that has started runs on wherever its mark goes. A
  call that finishes is counted, and the caller then joins the fight. A
  scout pack strikes its mark and anyone who has struck it, and nobody else.
- **What a call does.** Each call brings the march forward. The front
  marches on the first tick at or past `5,700 - floor(600 * calls / sent)`,
  with both counts as they stand on that tick, where `sent` is the scout
  packs that came in: 9:30 with every caller stopped, 8:30 with none
  stopped, and 9:00 with half, which is what the times in this section
  assume. With 9 packs sent a call is worth 6.7 seconds, and 5 calls of 9
  march the front at 5,367. With no scouts sent, because nobody was out, the
  front marches at 9:30.
- **Pay.** Scouts pay as written, with the horde's bonus on a kill more
  than 8 tiles from the bubble (3.2). They always pay, whatever their
  killer's level.

**The front** (from 8:00, the sighting). The black comes in at the four
gaps and spreads along the rim on every side. From the sighting it holds
the ground fewer than g tiles from the rim, or fewer than g steps' walk from
a gap, where g is `1 + floor((G - 1) * (tick - 4,800) / (march - 4,800))`,
with `march` the tick the calls so far would march it and G the gather
depth: 2 on the first city's landings and 4 on the others. So it deepens
from one tile at the sighting to G when it marches, and its depth is how a
viewer tells how near the march is (art.md, section 3). It never takes the
strip, and ground it holds is lost as the march's is (below). The corner
counts down to the march, and each call takes time off it (section 2). `front_eta` and `lift_eta` read 9999 until now and count from
now (section 5). Citizens whose chatters are away go home.

**The march.** From the tick the front marches, it reaches the bubble 750
ticks later. A tile is taken at the march plus 750 × h / (h + d) ticks,
rounded up, where h is its walk from the black as it stands when the front
marches and d its walk to the **strip**, the ground within 2 tiles' walk of
the bubble, and never before the tile beside it on its way from the black.
So the black closes on the city from the rim on every side at once, and no
taken ground is ever cut off from the rest of it. The strip is not taken
until the shield breaks. Ground the black has covered is gone: a citizen
there loses a tenth of its life a second, loot there is lost, a monster
there is removed and not counted, and a den it covers is lost with the packs
still inside.
On the second city's medium landing, on stand-ins, with the march at 9:00:
the black holds 28% of the ground when it marches, all of it within 4 tiles
of the rim or a gap, then 39% after 15 seconds, 51% after 30, 58% after 45
and 65% after a minute. Half of the far ground (the pockets at the far
level) is taken by 8:40, while the front gathers, and all of it by 9:15, and
51% of it lies behind the city from the ramp. Half of the pocket ground of
ring 3 is taken by 8:40, of ring 2 by 9:15 and of ring 1 by 9:54. Along its
way the front moves at 22 to 125 ticks a tile, and a citizen with a full bag
walks at 6, so anyone who turns when the black reaches them gets home ahead
of it.

**The shield.** The shield is one bubble with one **pool** of strength, 450
points and 90 more for each level of shield the works have built (section
9), up to level 10 and 1,350. art.md draws it on lamp posts round the
bubble's foot, lit from the march (section 7): ten before any upgrade and
two more a level, to thirty at level 10. Each post has a **condition** of
20 points and one more a level, 30 at level 10. Only the siege takes
strength or condition, nothing gives either back during a landing, and both
are full again at the next legs-plant.

- **Arcs.** The posts are numbered from 0, clockwise round the foot from the
  one after the way out from the ramp's foot. Each of the wall's stations
  (below) is on the **arc** of the post nearest it, the lower number on a
  tie. A siege swarm is against the arc of the post it is sent to (below),
  at one of that arc's stations or waiting in the black behind them.
- **Slams.** Every monster of a siege swarm slams the bubble every 20 ticks
  while nobody is striking its swarm. A swarm somebody strikes goes for them
  (below) and slams no more until it is back at its station. Waiting in the
  black counts as slamming, so a swarm the wall has no room for still
  presses the shield.
- **What the shield loses.** Each tick of the siege the pool loses 14 points
  times the weight slamming on each arc over the siege's weight W (below),
  and three times that on the arc of a dark post, held in thousandths and
  rounded down. A lit post's condition loses what its arc took from the
  pool that tick, also in thousandths. A post whose condition runs out goes
  dark, and stays dark until the next landing. Nothing relights it.
- **Why three times.** With nobody fighting, the swarms come to every post
  alike, the posts go dark together and the pool goes three times as fast
  from then. A level-10 shield then lasts 68 seconds, where it would last 82
  with no dark posts at all, and a level-0 one 40, where it would last 51.
  With citizens at the wall, the posts that go dark are those on the sides
  they do not cover, and a swarm cleared from a dark arc saves the pool three
  times what one on a lit arc does, so the posts are where a defender is
  worth most. At twice, an undefended level-10 shield lost 9 seconds to its
  dark posts and the posts hardly mattered; at four times it lost 17, three
  more than at three, because once most posts are dark the pool is nearly
  gone anyway (`plate.ts --siege`).
- **The break** is the tick the pool reaches 0. The whole bubble goes at
  once, on lit posts and dark ones. A dark arc lets nothing through before
  that; it only costs the pool more.
- **The posts are state.** Each post's condition is part of the world's
  state, like the pool: the snapshot holds it, the hash covers it, and a
  resume or a replay darkens the same posts. The viewer's message carries
  the pool in points, the pool's loss this tick in thousandths, and each
  post's condition in thousandths, so a viewer that joins in the middle of
  a siege draws the same dark posts as one that watched them go out. The
  corner is drawn from that message (section 2, and art.md, section 11).
  `shield` reads the pool as 0 to 100 (section 5).

**The siege** (from the tick the front is at the bubble). t is the ticks
since then, and L the landing's level.

- **The wall.** The black stops at the strip and is drawn there as bodies
  heaped on the shield's wall (art.md, sections 3 and 7). The wall's
  **stations** are the tiles two steps' walk outside the bubble, the
  strip's outer row at the black's edge, in tile order, each more than a
  tile from every station before it: 36 or 37 on the first city's landings
  and 45 to 47 on the second's at the median of the stand-ins, with the yard
  open (#416). A siege swarm is the part of the heap that steps out onto a
  station. A station holds one swarm for each 15 citizens counted at the
  march (below), rounded up: one at 15 and ten at 150. The wall's ground
  does not grow with the roster, so the stations take more swarms each, and
  a roster of 150 meets as many swarms a citizen at the wall as one of 15
  until the plate's cap is full. With one swarm to a station, 150 awake had
  45 swarms out at once against 150 citizens, and the rest waited in the
  black, slamming, where nobody could strike them.
- **Counted at the march.** The siege counts the citizens awake once, on
  the tick the front marches. That count sets the siege's weight, a
  station's room and how fast the siege is sent, for the whole siege. A
  citizen that wakes or joins after the march fights at the wall like any
  other and changes none of the three.
- **The horde grows.** The siege's **weight** W is the citizens counted at
  the march times the weight of a share at L: a share's packs at L times
  17.7, the order's 177 over 10, which is 135.75 a citizen on a level-23
  landing, held in hundredths and rounded down. The siege is owed W every
  4,800 ticks, and 10 ticks more for each citizen counted past 15, times
  (800 + t) / 800: every 4,800 ticks at 15 awake or fewer and every 6,150
  at 150. What is owed is held in hundredths and carries, and starts at a
  part of a swarm's weight drawn from the seed. A swarm sent at t is 10
  fodder, one more for each 300 ticks of siege, and a leader of pack rank,
  so its weight is its fodder and 3. It is at L, with the order's 5 and 10
  over on the same three places in ten, counted over the siege's swarms,
  and one level more for each 60 ticks of siege, to 99 at most, the highest
  level `world.ts` gives a monster. So the horde's level and size follow
  the landing and the siege's time, not who is fighting it, and a citizen
  over the landing's level kills its swarms faster than one at it.
- **Where a swarm goes.** The seed draws an order of the posts at the
  sighting, and the siege's swarms go to the posts in that order, one each in
  turn. A swarm steps out of the black onto the station of its post's arc
  with the fewest swarms, the lower station on a tie. With every station of
  the arc full, or the plate at its cap, it waits in the black behind them
  and steps out when one has room. It never moves to another arc, so at any
  tick each post has been sent as many swarms as any other, or one more or
  fewer.

  | Siege time | Weight sent a tick, times the first | A swarm         | Levels over the landing's | Swarms a minute for each citizen awake, level 23 |
  | ---------: | ----------------------------------: | --------------- | ------------------------: | -----------------------------------------------: |
  |        0 s |                                1.00 | 10 and a leader |                         0 |                                              1.3 |
  |       20 s |                                1.25 | 10 and a leader |                         3 |                                              1.6 |
  |       60 s |                                1.75 | 12 and a leader |                        10 |                                              2.0 |
  |      120 s |                                2.50 | 14 and a leader |                        20 |                                              2.5 |
  |      180 s |                                3.25 | 16 and a leader |                        30 |                                              2.9 |
  |      240 s |                                4.00 | 18 and a leader |                        40 |                                              3.2 |

- **Why every city loses.** A fodder monster at a citizen's own level in
  ordinary gear takes one blow, and a swing takes about two, so a citizen
  kills a swarm at its swing rate until the swarms outlevel it. They gain a
  level every 6 seconds, so from then each swarm takes it longer, while the
  weight sent goes on rising. There is a tick from which the citizens
  cannot strike every swarm as it comes. From then the swarms nobody
  strikes slam, the posts on the thin sides go dark, and the pool goes in
  tens of seconds. A citizen that out-levels the landing stays at its swing
  rate longer and holds longer. One whose every swing kills, whatever the
  swarm's level, is still outrun by the weight sent, about four and a half
  minutes in at 15 awake and six at 150. The table below has the times.
- **Past level 99.** A swarm stops gaining levels at 99, which a siege
  reaches on high landings: on a level-58 landing the swarms of the 10-over
  places are at 99 after 186 seconds, and on a level-89 one those at the
  landing's own level after 60. From then the swarms grow in fodder only,
  and the weight sent goes on rising as (800 + t) / 800 with no end. A
  swing takes two fodder at most, so however high the citizens, the weight
  sent outruns their swings. `plate.ts --siege` runs 15 and 150 at Arms 99
  in the best gear on `guard` against a level-10 shield on every landing
  level from 1 to 99: every shield breaks, 100 to 271 seconds into the
  siege at 15 and 116 to 356 at 150, the longest on landings of level 20
  and under. From level 81 up at 15, and 77 up at 150, every swarm sent at
  the break is at 99.
- **A bigger roster, a slower horde.** The wall's ground and the plate's
  cap do not grow with the roster. At 150 the cap of 700 holds the wall to
  about 50 swarms, three citizens to a swarm at most, and the rest wait in
  the black, slamming, where nobody can strike them. Sent at one rate a
  citizen, 150 held a level-10 shield on `guard` for less time than 15 in 8
  of the 11 pairs under the longest holds below, all five on level 58 and
  up among them. The 10 ticks a citizen past 15 make up for it: 150 hold
  longer than 15 on every row of the table below and in every one of those
  pairs, by 5 seconds at least. A station's room that grew faster than the
  roster would change nothing once the cap is full, and a cap that grew
  with the roster would pass the tick's budget (section 1).
- **Whom a swarm goes for.** A siege swarm slams until a citizen strikes
  it. Then it goes for that citizen, follows to the bubble's edge and no
  further, and goes back to its station. So a citizen picks its fights, and
  one step back into the bubble ends a fight that is going badly.
- **Pay.** Siege monsters pay as written, with the horde's bonus (3.2), up
  to the weight of the killer's share in a landing. A siege monster killed
  past that gives no experience and drops nothing, so the siege never pays
  a citizen more than its share is worth. A swarm ten or more levels under
  its killer drops salvage only and gives a quarter of its experience
  (3.2), so a veteran holding the wall of a low landing is paid little for
  it.
- **Carriers** of the lost list come to the wall when the siege begins
  (section 8).
- The winch answers a down until the break (section 8).

**How long a shield holds.** `plate.ts --siege` estimates it. It runs the
rules above against a roster tick by tick, with the fight as a flow:

- A citizen swings every 5 ticks for three quarters of its time; the rest
  is stepping out of blows and drinking.
- A swing takes two fodder or the leader, and a monster takes its hitpoints
  over the citizen's blow in swings, one at least, by plan.md's formulas.
- A swarm can be struck 10 ticks after it steps out, and up to three
  citizens fight one.
- A citizen holds its side, the arcs within a sixth of the foot of where it
  came in either way, and takes Deckhand's `hold` there (section 5). It
  walks straight across the bubble to a swarm at 4 ticks a tile, on a ring
  of 108 tiles, and waits at its side when its side has none.
- The stations are the second city's medium landing's 45, evenly round the
  foot, and the plate's cap of 700 counts the siege's monsters alone.

The landing is at level 23. The median roster is section 1's worked crowd
(2 at Arms 6, 10 at 23, 2 at 40 and 1 at 58 for 15 awake, ten times that
for 150) in ordinary gear with 5% aim. The strong roster is the same crowd
10 Arms higher, at 16, 33, 50 and 68, in the best gear, a third over
ordinary, with 40% aim. Times are from the front reaching the bubble to the
break. "Untouched" is everyone on `hold`, which goes aboard by `lift_eta`
(section 5). The lamps are those lit 10 seconds before the break with
everyone on `guard`.

| Shield | Awake | Roster | Nobody fights | Untouched | Everyone on guard | First post dark, on guard | Lamps lit | Killed untouched, part of a share, by tier |
| -----: | ----: | ------ | ------------: | --------: | ----------------: | ------------------------: | --------: | -----------------------------------------: |
|      0 |    15 | median |          40 s |      53 s |              90 s |                      62 s |      7/10 |                          0% / 5% / 1% / 1% |
|      0 |    15 | strong |          40 s |      55 s |             107 s |                      70 s |      3/10 |                          9% / 4% / 0% / 0% |
|      0 |   150 | median |          46 s |      79 s |             111 s |                      97 s |      6/10 |                         0% / 11% / 6% / 1% |
|      0 |   150 | strong |          46 s |      87 s |             152 s |                     136 s |      6/10 |                        16% / 10% / 2% / 0% |
|      5 |    15 | median |          58 s |      94 s |             107 s |                      66 s |     17/20 |                        0% / 16% / 10% / 4% |
|      5 |    15 | strong |          58 s |     111 s |             145 s |                     108 s |     17/20 |                        13% / 16% / 9% / 8% |
|      5 |   150 | median |          66 s |     121 s |             130 s |                     119 s |     20/20 |                        0% / 18% / 19% / 6% |
|      5 |   150 | strong |          66 s |     166 s |             176 s |                     164 s |     20/20 |                       14% / 32% / 14% / 5% |
|     10 |    15 | median |          68 s |     121 s |             130 s |                      76 s |     23/30 |                       0% / 18% / 31% / 18% |
|     10 |    15 | strong |          68 s |     154 s |             173 s |                     125 s |     26/30 |                       5% / 29% / 26% / 18% |
|     10 |   150 | median |          83 s |     143 s |             149 s |                     141 s |     30/30 |                       0% / 18% / 29% / 15% |
|     10 |   150 | strong |          83 s |     185 s |             190 s |                     183 s |     30/30 |                       12% / 32% / 23% / 7% |

- **Strength.** On every row the strong roster holds longer than the
  median: on `guard` by 17 to 46 seconds, and untouched by 2 seconds at
  15 awake and 8 at 150 at shield 0, where everyone goes aboard early, and
  by 17 to 45 at shields 5 and 10. The median's Arms-6 citizens fight
  nothing: the landing is 17 levels over them, past their `over` of 10.
- **Numbers.** On every row 150 awake hold longer than 15: on `guard` by
  17 to 45 seconds, untouched by 22 to 55, and with nobody fighting by 6
  to 15, the horde being sent slower for them (above). At 150 the plate's
  cap of 700 is reached on every row, and the swarms past it wait in the
  black.
- **The lamps.** At 15 awake on `guard` the first post goes dark on a thin
  side 28 to 54 seconds before the break, so the corner shows the shield
  going before it goes. At 150 every side is covered, and the first post
  goes dark only 7 to 16 seconds before the break, when the pool is going
  anyway.
- **The longest holds.** A roster whose every swing kills holds longest,
  and then only the weight sent stops it. 150 at Arms 99 in the best gear
  on `guard`, on a level-1 landing, hold a level-10 shield for 356 seconds,
  the longest there is, and 15 of them for 271. On a level-23 landing 15 at
  Arms 58 hold it 257 seconds and at Arms 99 260, and 150 of them 275 and
  335. 15 at Arms 33 in the best gear hold it 151 seconds on a level-23
  landing and 107 on a level-33 one, and 15 at Arms 20 106 on a level-20
  one; 150 of them 159, 115 and 116. On their own landings veterans hold
  least: at Arms 58 on a level-58 landing 15 hold it 106 seconds and 150
  111, and at Arms 99 on a level-99 one 102 and 116. The navigator keeps a
  landing within 10 levels over the roster's median and raises it while
  few go down (section 9), so a strong roster gets the longest holds only
  until its landings catch up: the strong roster of 15 on a level-33
  landing, its own median, holds a level-10 shield 127 seconds on `guard`.
- **By roster size.** `plate.ts --siege` also runs every roster above at
  5, 10, 15, 16, 20, 30, 45, 75 and 150 awake, the mean of 20 draws of the
  posts' order. From 15 up the holds rise with the roster: 150 hold longer
  than 15 by 6 to 102 seconds on every row of it, and no size is more than
  1.3 seconds under the size before it (Arms 58 on a level-23 landing, 245
  seconds at 20 and 244 at 30). Under 15 it does not hold everywhere; see
  known-thin.
- **Untouched, by shield level,** for the median roster at 15:

| Shield | Points | Posts | A post's condition | Nobody fights | Untouched | Everyone on guard | Killed by an Arms-23 citizen untouched, part of its share |
| -----: | -----: | ----: | -----------------: | ------------: | --------: | ----------------: | --------------------------------------------------------: |
|      0 |    450 |    10 |                 20 |          40 s |      53 s |              90 s |                                                        5% |
|      2 |    630 |    14 |                 22 |          48 s |      71 s |              99 s |                                                        7% |
|      4 |    810 |    18 |                 24 |          53 s |      87 s |             104 s |                                                       12% |
|      6 |    990 |    22 |                 26 |          60 s |     109 s |             119 s |                                                       16% |
|      8 |  1,170 |    26 |                 28 |          65 s |     116 s |             127 s |                                                       19% |
|     10 |  1,350 |    30 |                 30 |          68 s |     121 s |             130 s |                                                       18% |

On untouched settings the most any tier kills is 32% of its share (the
strong roster's Arms-33 citizens at 150 awake, at shields 5 and 10), and on
`guard` 56%, so no roster in the table reaches the cap of a share's weight.
The cap stays for a roster that holds longer than these. With the march at
9:00 the front is at the bubble at 10:15, so on untouched settings a new
city's shield breaks between 11:08 and 11:42 and a level-10 shield between
12:16 and 13:20.

**The break.** When the pool is gone the bubble is gone, on every post at
once, and the horn sounds. The black takes the strip and the yard by the same
walk rule over the next 300 ticks and stops at the hull. The siege's
monsters that are alive go for the ramp and strike anyone. The ramp is 3
tiles wide; a monster standing on it blocks it, and nobody boards past it.
A citizen on the ramp is aboard. The winch answers nobody from the break.
Anything on the ground is anyone's, but for the exceptions in 3.3.

**Lift-off** is 300 ticks after the break. The ramp goes up, and everyone
outside is hauled aboard and stripped (section 8).

## 2. The beats

"Named" is what puts a username in the log or the tally. The log is a line
of a name and what happened to it (`joshyboy88  Nine Lives`,
`joshyboy88  down`), as the operator's rules for on-screen text on #362 have
it: names, numbers, item names and plain labels, a count as a number by its
icon, one fact a line.

What the corner shows is art.md's (section 11). In transit it is the time
to the landing. On a landing until the march it is the time to the march by
the calls made so far, so a caller's finished call takes seconds off it.
From the march to the break there is no clock. The slip holds the shield:
a ring of the posts with the dark ones where the state has them (section
1), the lamps lit over the posts (`9/18`), and the pool's loss a minute at
its present rate, the loss this tick times 600 as a part of the full pool,
in whole percent (`−12%`), which a siege swarm struck or killed brings down
and a post gone dark puts up. Nothing counts to lift-off before the break,
because the break comes when the pool runs out. At the break the clock
comes back with the time to lift-off.

| Beat             | Clock                   | On screen                                                                                                                                                                                                                                                                                                                                 | A chatter can                                                                                                                                                                                                                                                                              | On untouched settings                                                                                                                                                                                             | Named for                                                                                                                                    |
| ---------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transit**      | 0:00, and from lift-off | Art.md's close frame. At 15, citizens are at near size and worn gear reads; at 150 they are at mid size. The page shows the landing ahead: `Medium 23–68` on one line with the element's icon, then each modifier on a line of its own (`Stalked`). An upgrade the works have paid for is built on the hull.                              | `!me`, `!stash`, `!wear`, `!lock`, bench orders. Decides what to wear against the element ahead, and whether to put a tool to an item.                                                                                                                                                     | Mends broken parts from the hold, 2 citizens and 60 s a part. Wears what beats what it has.                                                                                                                       | a bench result: a T1 line rolled, an item destroyed by acid                                                                                  |
| **Raiders**      | 1:00                    | Section 7.                                                                                                                                                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                            |                                                                                                                                                                                                                   |                                                                                                                                              |
| **Legs plant**   | 3:00                    | Art.md's pull back. Packs stand at their posts in every pocket as the ink reaches them, with dens, chests, shrines, wrecks, seams and piles. The bubble holds from now and is not drawn until the march.                                                                                                                                  | `!go den b` as its letter appears, so the flag is up before the ramp is down. Decides which pocket to make for.                                                                                                                                                                            |                                                                                                                                                                                                                   |                                                                                                                                              |
| **1. Peace**     | 3:20                    | Citizens spread over the pockets on every side, each on ground of its own level; den fights; a chest or a wreck being worked; packs still standing in pockets nobody has reached; markers where rare things fall; bundles on backs with a pennant for each unopened rare or unique.                                                       | `!go` to a den by its letter, to the nearest `chest`, `shrine`, `wreck`, `seam` or `pile`, to a citizen or a dropped unique; `!fight`, `!gather`, `!careful`; `!keep`; `!over`. Decides which pockets to work, how deep, whether to dig for the city, and what is worth one of four slots. | Goes to the nearest pack of its level, clears the pocket, takes what the pocket holds, and goes to the next. Banks when the bag is full and goes out again.                                                       | a den's elite, a chest, a shrine, a rare or unique drop, a good line when the haul opens                                                     |
| **2. Scouts**    | 6:30                    | Scout packs running in from the four gaps along the paths, heads turning. A caller standing off its mark with its call filling.                                                                                                                                                                                                           | `!go` to a friend with a caller on them. `!careful` to keep clear. Decides whether to stop a caller or leave it.                                                                                                                                                                           | Goes for a calling caller within 12 tiles ahead of anything else it would fight, and fights the scouts that come for it.                                                                                          | a caller killed; a call finished                                                                                                             |
| **3. The front** | 8:00                    | Black in at the four gaps and along the rim on every side, deepening, with eyes in it. The time to the march drops with each call.                                                                                                                                                                                                        | `!margin`; `!go` to a pocket not yet worked. Decides how long to stay out.                                                                                                                                                                                                                 | Carries on. A citizen whose chatter is away goes home and aboard.                                                                                                                                                 |                                                                                                                                              |
| **4. The march** | 8:30 to 9:30            | The black moves in from the rim on every side and closes on the city, the bruise wash ahead of it, and the frame closes with it. The shield's lamps light round its foot. Markers the black reaches go under. Citizens come in from every side, the loaded ones slowly.                                                                   | `!margin 0` to cut it fine; `!go` to a drop the black is closing on. Decides what to leave.                                                                                                                                                                                                | Turns for home when the front is 30 seconds plus its walk from the bubble, and sooner if the black comes within 6 tiles. Banks at the ramp.                                                                       | a drop pulled out from under the black                                                                                                       |
| **5. The siege** | 75 s after the march    | The horde heaped on the shield's wall all round the city, and siege swarms stepping out of it onto stations, each slam a burst on the wall. Citizens outside it with the bubble at their backs, in groups on every side. Lamps going out on the sides nobody covers, and the corner showing the lamps lit and the shield's loss a minute. | `!hold`, `!board` or `!guard`; `!go` round to a side that is thin; `!aid`. Decides whether to fight for the shield, and how late to stay.                                                                                                                                                  | `hold`: goes out to the wall where it last came into the bubble, fights the swarms on the darkest or weakest arcs of that side, steps back into the bubble to drink, and goes aboard 20 seconds before the break. | siege kills; a carrier killed; getting someone up                                                                                            |
| **6. The break** | at strength 0           | Every lamp still lit goes out at once and the heap falls inward. The black takes the yard. What is left of the siege goes for the ramp, and the last citizens run in.                                                                                                                                                                     | `!guard` stands at the ramp's foot until 5 seconds before the lift. Holding it is what keeps the ramp open for everyone still coming in.                                                                                                                                                   | Already aboard.                                                                                                                                                                                                   | kills at the ramp's foot; everyone who came in after the break                                                                               |
| **7. Lift-off**  | 30 s after the break    | Winch lines haul the stragglers up as the frame closes. The log shows the tally over 20 s.                                                                                                                                                                                                                                                |                                                                                                                                                                                                                                                                                            |                                                                                                                                                                                                                   | the tally: most brought home, most ore dug, best item opened, most got up, most siege kills, each citizen left on the winch and what it lost |

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

**The rules in full**, as `packages/sim/src/weapons.ts` and the world work them:

- The ground is a flat grid seen from above. A blow faces the nearest of
  eight directions to its target, a diagonal covering from 5 in 12 off an
  axis to 12 in 5. The blade's arc is the three tiles facing that way and
  the three beyond them; the maul's square is centred two tiles out, so it
  takes in the tile next to the citizen; the spear's line and the arrow's
  run straight out. Ground that cannot be walked on, or in another region,
  is not struck, and the spear's and the arrow's lines end at it.
- `weapon_reach` is the farthest tile a blow reaches in steps, a diagonal
  counting one: 2, 3, 4 and 9.
- A "faster" line takes `windup * 100 * pct / 10,000` hundredths off, and
  the same for the recovery, rounding down. The carry comes first into the
  wind-up and what is left of it into the recovery. A wind-up is at least 1
  tick. The carry is in `blowTimes`; it is kept on the citizen once
  "faster" lines can be worn.
- An arrow is loosed when the wind-up ends and flies one tile a tick from the
  next tick on, so it can miss a target that steps off its line. It stops in
  the first enemy it reaches, at a wall or a region's edge, or after nine
  tiles. Its blow and crit are rolled when it is loosed.
- Knockback is along the way the blow faced. Each hit adds its quarters to
  what the body still has under a tile, a whole tile moves it, and a tile it
  cannot stand on, someone in its way, or a diagonal past a wall's corner
  stops it there and loses the rest. A body that moves stops walking; one
  winding up takes its blow with it, aimed the same way from where it lands.
  Its own next step puts what is under a tile back to 0. A blow's targets
  are all hit before any is knocked back, so nobody is hit twice by one
  blow.
- The flask's drink gives back `life * 40 / 100`, rounded down, up to full,
  and is refused at full life. A drink comes back at the 20th kill counted
  while one is missing; a kill with the flask full counts for nothing.

**Rarity.** Magic has 1 or 2 lines, rare 3 or 4, with room for 6: three
prefixes and three suffixes. The fifth and sixth can only be added at the
bench. What would be a normal item in Path of Exile drops as salvage.

**Lines.** There are 19, each in six tiers, T6 to T1, needing item level 1,
10, 22, 36, 50 and 65. Among the tiers an item is high enough for, each
better one is half as likely as the one below, so T1 is 1 roll in 63 on an
item of level 65 or more. Values are rolled evenly in the range. The card
and the news show a line as what it does, with its tier: `+12 fire T4`.
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
  brute. The monster's pay (section 1) and a high-risk landing (section 9,
  20% more) multiply the chance, in that order, held in hundredths of a
  percent. A chance past 100% drops one item for each whole 100% and rolls
  what is left for one more, each drop drawn on its own below.
- **What it is** is drawn by weight: salvage 1,561, magic 360, rare 78,
  unique 1. The draw is over the sum of the weights as they stand. Raising
  the rare and unique weights does not top the others back up to 2,000, so
  it lowers the share of salvage and magic.
- **Bonuses multiply the rare and unique weights**, and each other. The
  product is held in hundredths, rounded down after each step, and is never
  more than 20. They are taken in this order: a brute, 2; an elite or chest
  roll, 5; the horde's bonus, 2, for a scout killed more than 8 tiles from
  the bubble and for anything of the siege; each modifier on the landing,
  1.4 to 1.6, in the order section 9 lists them; a lucky shrine's boon on
  the citizen the drop is for, 1.5; and the "+N% rare and unique drops" on
  that citizen's charm, 1.04 to 1.30. Last Call's two rolls and The Rattle's second roll
  (3.9) are whole rolls, each with the same weights. Nothing else changes
  the weights.
- **A brute, worked.** Bonus 2. Weights 1,561, 360, 156 and 2, which sum to
  2,079. A brute's drop is rare 156 times in 2,079 (7.50%) and unique 2
  times in 2,079 (1 in 1,040).
- **The largest case, worked.** A carrier, which is an elite of the siege,
  killed on a landing that is Stalked and All fire, for a citizen with "+16%
  rare and unique drops": 5 × 2 is 10, × 1.6 is 16, × 1.5 is 24, × 1.16 is
  27.84, and the cap makes it 20. Weights 1,561, 360, 1,560 and 20, which
  sum to 3,501: rare 44.6%, unique 0.57% (1 in 175).
- **Whose it is.** The killer's, or for a monster that took several blows, a
  citizen drawn by share of damage.
- **Too far under.** A laid monster (a pack's, a den's or a guard's) ten or
  more levels under its killer drops salvage only and no tool, and gives a
  quarter of its experience (plan.md). So does a siege monster, so a
  veteran holding the wall of a low landing gains little from it. Den elites,
  chests, boarders and scouts always pay.
- **An elite or a chest** gives one roll, with the bonus of 5, to each
  citizen within 6 tiles when it dies or opens. With more than 20 there, 20
  are drawn by the seeded generator, those who have never had such a roll
  first. Each citizen's drop falls at its own feet and is its own. A
  citizen's first such roll is always a rare weapon of the family it holds,
  at an item level no more than twice its Arms, so it can wear it.
- **Tools** roll apart from the drop: fodder 0.5%, pack 2%, brute 6%, each
  elite or chest roll 20%, a boarder 4%. The first three are multiplied by
  the monster's pay as the drop chance is. Of tools, 80% are Rerolls, 17%
  Adds and 3% Acid.

What a landing brings is those rules times a citizen's share (section 1),
if its tier kills what was laid for it. The pay makes up for what was not
laid, so the expected drops are about what the whole share would have
given, less what section 1's Paid column leaves out. Three citizens, with
the levels section 6 works out:

- **Hour 1**, Arms 6, its share held to level 7, ring 1's first pocket's:
  6.67 packs, which is 40 fodder, 10 pack and 4 brutes, at levels 7, 12 and
  17, and the one elite roll its first den gives.
- **Hour 10**, Arms 23 on a level-23 landing: 7.67 packs, which is 46
  fodder, 11.5 pack and 4.6 brutes due at levels 23, 28 and 33, standing at
  23 and 32, with 4 boarders and 2 elite or chest rolls.
- **Hour 100**, Arms 58 on that landing, the strongest aboard, so the far
  level is 68: 19.33 packs, which is 116 fodder, 29 pack and 11.6 brutes at
  levels 58, 63 and 68, with 4 boarders and 2 rolls: its den's elite at 68
  and the far chest at 68.

Each drop row is the count of each rank times its drop chance, then times
the kind's share of the weights: of the non-brute drops, 78.05% salvage,
18.0% magic, 3.9% rare and 0.05% unique; of a brute's, 75.08%, 17.32%,
7.50% and 0.096%; of an elite or chest roll, 67.40%, 15.54%, 16.84% and
0.22%. At hour 10, 46 × 4% + 11.5 × 15% + 4 boarders × 15% is 4.17
non-brute drops and 4.6 × 40% is 1.84 brute drops, so the rares are
4.17 × 3.9% + 1.84 × 7.50% + 2 × 16.84% = 0.64. A rare's chance of at least
one T1 line, on an item of level 65 or more, is 5.44% (3 or 4 lines as
likely as each other, each line T1 once in 63), and of two, 0.11%.

The rolls are a choice and no rule fixes them: a citizen gets one for each
den or chest it stands at, and each adds 0.17 of a rare, 0.0022 of a unique
and 0.2 of a tool. Guards, scouts, the siege (below), the map's own packs
and a landing's modifiers come on top of every row. There are 4.6 landings
an hour. The stream columns are 15 and 150 citizens like the hour-10 one.

| A landing brings       | Hour 1 | Hour 10 | Hour 100 | Hour 10 sees one every | Stream at 15     | Stream at 150 |
| ---------------------- | -----: | ------: | -------: | ---------------------- | ---------------- | ------------- |
| Salvage drops (3 each) |    4.3 |     6.0 |     12.3 | 2 minutes              | 90 a landing     | 897           |
| Magic                  |   0.99 |     1.4 |      2.8 | 9 minutes              | 21 a landing     | 207           |
| Rare                   |   0.41 |    0.64 |     1.06 | 20 minutes             | 9.6 a landing    | 96            |
| Unique                 | 0.0052 |  0.0082 |    0.014 | 26 hours               | 1 in 106 minutes | 1.2 a landing |
| Rare with a T1 line    |      0 |       0 |    0.021 | hour 100: 10.5 hours   | none             | none          |
| Rare with two T1 lines |      0 |       0 |  0.00042 | hour 100: 510 hours    | none             | none          |
| Reroll                 |   0.67 |    1.04 |      1.9 | 13 minutes             | 16 a landing     | 156           |
| Add                    |   0.14 |    0.22 |     0.41 | 59 minutes             | 3.3 a landing    | 33            |
| Acid                   |  0.025 |   0.039 |    0.073 | 5.6 hours              | 1 in 22 minutes  | 5.8 a landing |

A T1 line needs item level 65, so it needs a monster of level 65: a pack or
a siege swarm of that level, or a den of 60 for its elite. For the hour-100
citizen that is the one swarm in ten of its share at 68, on a
post on the far ground or in its den (19.3 fodder and 1.9 pack monsters a
landing, 1.06 drops), and the two rolls, which is 0.38 rares a landing that
can carry a T1 line.
The rest of its share, at 58 and 63, cannot. The two T1 rows are empty for
everyone who does not work that far out, and a stream sees them at the rate
of its veterans.

Most of that 0.38 is the two rolls, 0.337 of it, which anyone standing at
the strongest citizen's den and the far chest gets, whatever its share. So
for a veteran the T1 hunt is that den's elite and that chest, and the 10.5
hours assume it reaches both, kills an elite at the far level and a guard at
it, and is gone before the black takes that ground, which the front starts
to as it gathers along the rim from 8:00, with half of it by 8:40 on the
second city's medium landing. On the stand-ins at 15 awake that den's elite
is at 65 or more on all 100 of the second city's medium landings and the
far chest on all 100; on its small landing, 91 and 100.
With only one of the two rolls the figure is nearer 19 hours (0.21 rares a
landing that can carry a T1 line). The siege adds to it on a landing at the
veteran's level: its swarms are at 65 or more in their one place in ten at
10 over, in the two 5 over once the horde has grown two levels, 12 seconds
in, and all of them from 42 seconds in. At shield level 8 that is 0.045
rares a landing at 65 or more for a veteran in a roster of 15 at 58, and it
brings the 10.5 hours to 9.4. On a landing at a median of 23 the swarms
reach 65 only after 3 minutes 12 seconds, so the veteran's siege adds
almost nothing to the hunt there. Piece 5 puts in
`metrics.json` how many far-ground rolls the strongest citizen got, and
piece 31 its siege drops at 65 or more.

**What the siege pays.** The siege sends swarms at the landing's level,
growing, for as long as the shield holds (section 1), and the higher the
shield and the stronger the roster the longer it holds. The rows take the
shield level the default order of the works has built by that hour, and a
citizen on untouched settings in a roster of 15 at its level on a landing
at its level, which goes aboard by `lift_eta` (`plate.ts --pace`). Every
drop has the horde's bonus of 2.

| The siege brings | Hour 1, shield 1 | Hour 10, shield 3 | Hour 100, shield 8 |
| ---------------- | ---------------: | ----------------: | -----------------: |
| Part of a share  |               6% |                9% |                12% |
| Swarms, monsters |           0.6, 6 |           0.9, 10 |            3.2, 36 |
| Experience       |    8, on its 124 |    13, on its 180 |     88, on its 775 |
| Salvage drops    |             0.24 |              0.38 |               1.34 |
| Magic            |             0.06 |              0.09 |               0.31 |
| Rare             |            0.024 |             0.038 |              0.134 |
| Unique           |           0.0003 |            0.0005 |             0.0017 |
| Reroll           |             0.03 |              0.05 |               0.18 |

So on untouched settings the siege adds about a twentieth to what the
share's own kills drop at hours 1 and 10, and at hour 100, on a level-8
shield, about a ninth more experience, an eighth more rares and a tenth
more Rerolls. A roster that stays on `guard`, and a strong one most of all,
kills more of it: up to 56% of a share in the hold table above. It pays a
citizen up to its share's weight a landing and no more (section 1), so it
never pays a citizen more than its whole share would. A shield nobody fights
for pays nothing: the swarms are the horde's and the break comes sooner. A scout pack is five
fodder and a pack monster, 0.35 drops with the same bonus, and a landing at
15 awake sees 9 of them between all its citizens.

Dens and chests grow with the roster and their rolls are capped at 20. The
second city's medium landing at 150 has 15 dens and 13 chests in its 26
pockets, up to 3.7 rolls a citizen (28 × 20 / 150), so 2 can hold there if
most sites are opened with a crowd round them.

Salvage balances against the bench. The hour-10 landing banks 18, half goes
to the purse, and that landing's tools cost 8 to use (3.8). A citizen that
keeps only rares cannot pay for its tools.

The bench is the faster road to T1. A Reroll is another full roll on an item
of the chatter's choosing. At 1.9 a landing the hour-100 citizen finds a T1
line about every 2 hours and two on one item in about 100, where drops
alone take 10.5 and 510. A level-65 base is therefore worth carrying home
whatever its lines are, and the stash keeps it (3.6). The far ground is
where such a base comes from, so a veteran walks to the edge of the map for
the base and rolls its lines at the bench.

### 3.3 The drop, on screen

Items drop **unopened**: the family and the rarity show, the lines do not.
A unique shows its name.

| Drop      | On the ground                                                                                                                                               | Named                                             | News             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- |
| Salvage   | a small heap in ink, at mid and near size only                                                                                                              | no                                                | no               |
| Reroll    | as salvage, with a disc                                                                                                                                     | no                                                | no               |
| Magic     | a peg half a citizen tall with a ringed bundle, in ink                                                                                                      | no                                                | no               |
| Rare      | a marker one and a half citizens tall with a gold swallowtail, drawn in 3 ticks                                                                             | its owner's name, if present                      | if there is room |
| Add, Acid | a pole one and a half citizens tall with a disc, black for Acid                                                                                             | Acid: its owner's name                            | Acid             |
| Unique    | a marker two and a half citizens tall with a label naming it, drawn over a second; the killing blow holds 6 frames and citizens within 6 tiles turn to look | its name and its owner's, until picked up or lost | always           |

A marker is taller than any figure, so at 640 it is what a viewer sees after
the city and the horde. art.md, section 10, has the markers and their hues,
with heights in citizens. There is no sound yet (design.md); the held blow
and the turned heads stand in for it.

**Whose it is.** A rare, a unique, an Add or an Acid is its owner's for the
whole landing. Any citizen with a free slot may pick it up and carry it home
**for** them when the owner is down, has turned back or is more than 10
tiles off. The item goes to the owner's stash. The carrier is named in the
news and the tally and is paid a Reroll, once a landing. If the carrier
is stripped on the way, the loss is the owner's: the item goes on the lost
list (section 8) under the owner's name, and the tally names both. From the
break, anything still on the ground is anyone's to keep, except a fallen
citizen's named bundle and a carrier's item (section 8), which stay their
owner's until the lift. Magic, salvage and Rerolls are the owner's for 30
seconds.

A dropped unique's name is shown on the map, so it is a place: `!go heave`
plants a flag on Heave-Ho. Before the break, a citizen sent there carries it
home for its owner. After the break it keeps it, unless it is a carrier's
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
  are shown at once, and the news carries one loot line every 4 seconds,
  in this order: a unique, an Acid result, a line opened at the best tier
  its item could have, a present chatter's rare. The rest is counted, as a
  number by each kind's mark (`31` by the rare marker). The streamer can
  tighten it.
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
- **The horde's bonus is paid outside the bubble.** A scout's counts only
  more than 8 tiles from it, where a scout outruns a loaded citizen, and
  the siege's at the wall.

**Opening.** Crossing the ramp opens the haul, 5 ticks an item. Each rare or
unique is drawn over its citizen for 6 seconds as its pennant with its name
and its two best lines under it, one a line (`Grim Bite`, `+12 fire T4`,
`12% faster T4`), notched once for each line at the best tier its item level
allows. The pennant then
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
  free, and the order strip says so when none is: the row reads
  `not locked`, with `8 of 8` by the lock icon.

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
there when its chatter comes back. The card on coming back says what went,
on its `scrapped` line (3.7).

**Tools** are kept with the purse, 20 of each at most. One more is banked as
the salvage its order costs.

### 3.7 Seeing your own gear without a site

- **The figure.** The weapon's family and base are its silhouette at every
  size. The coat is a shoulder line at mid and near size, the charm hangs
  at the belt at near size. A unique has its own drawing and an effect that
  reads at far size (3.9). A citizen's blows leave its element's colour on
  what they hit (4.2).
- **`!me`** rings the citizen for 6 seconds and shows its card on a slip
  beside the log:

  ```
  goofguy          Arms 27   Deckhand
  stance           fight
  margin           30
  ramp             hold
  keep             magic
  over             10
  weapon           Grim Bite, long blade 31
                   +10 physical T4
                   +12 fire T4
                   +14% damage T5
                   12% faster T4
  coat             Padded coat 24
                   +18% fire res T4
  charm            none
  armour           72
  resist           fire 18   cold 0   lightning 0
  kits             fire 34   cold 0   lightning 12
  haul             3 of 4, 2 rare
  stash            3 of 12
  salvage          22
  tools            reroll 2   add 0   acid 0
  ```

  A label and its value on each line, a list one item a line, and nothing
  chained with dots. The art director sets the card's type and spacing.
- **`!stash`** shows the stash numbered, a row an item with its best line
  (`3   rare coat 41   +52 life T3`, with the lock icon on a locked slot),
  then the kits and the rack. `!stash 3` shows slot 3 with every line. Neither `!me` nor
  `!stash` costs a token; each can be asked once in 30 seconds.
- **How many cards.** During the expedition two cards are up at once, 6
  seconds each. In transit, when the frame is close on the city and the
  tally is gone, six are. That is 60 cards a minute and 180 in a
  transit, against 150 chatters. With more waiting, whoever has gone longest
  without a card is first and the order strip shows the wait as a row:
  `goofguy`, the card icon and `18 s`. Piece 10 measures the wait at 150.
- **Without asking.** An opened rare shows its two best lines over its
  citizen (3.5), and a bench result shows the item before and after (3.8),
  so the two things a chatter most wants to read need no card.
- **`!wear`** needs no card for the common case: `!wear fire`, `!wear cold`
  and `!wear lightning` put on that kit. `!wear 3` puts on stash slot 3,
  `!wear blot` puts on a unique from the rack by a prefix of its name, and
  `!wear auto` gives the slot back to the automatic swap.
- **Coming back.** The first message from a chatter who was away shows their
  card unasked, with what happened under it, a line each:

  ```
  away             14 landings
  worn             3 rares
  kept             1 unique
  scrapped         31 magic, 4 rares
  stripped         1
  ```

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
  doubled; or steps of 3 ticks from the break to the lift; or own drops
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

| Unique                          | The rule it bends                                                                                                                                                                                                                                                                                                                                                                                                                                                            | How its chatter plays it                                                                                                             | The stream sees                                 | Acid's +1 tier raises       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------- |
| **The Blot** (blade)            | A monster it kills bursts: fodder within 2 tiles die and pack monsters there lose half their hitpoints. What a burst kills bursts too, three deep.                                                                                                                                                                                                                                                                                                                           | `!fight`, and `!go` wherever fodder is thickest. It does nothing extra to a brute.                                                   | a swarm going off like a string of blots        | the depth, to four          |
| **Heave-Ho** (maul)             | Knocks fodder and pack back three times as far and brutes as far as any maul; elites and captains are not moved. A monster knocked into another, or into a wall, takes the blow again. Over a rail or into the horde it dies, and its drop lands where it was struck.                                                                                                                                                                                                        | Works rails and hatches in a raid (`!go fore hatch`) and the horde's edge on a landing.                                              | bodies in the air                               | the second blow, by a fifth |
| **Rally** (spear with a banner) | Its wearer, and up to ten citizens within 6 tiles whose flag is on the wearer, deal 4% more damage for each of those citizens, the wearer not counted.                                                                                                                                                                                                                                                                                                                       | The wearer needs chat to type `!go` on them each landing and stay close.                                                             | a banner with ten flag lines to it              | the 4%, to 4.8%             |
| **Hoist** (coat)                | Gets a fallen citizen up in 1 second, not 4, and both drink a full flask. A citizen it gets up more than 8 tiles from the ramp, who then reaches the ramp, pays it a Reroll, once a landing for each citizen. Its wearer deals 30% less damage.                                                                                                                                                                                                                              | `!aid 20`. From the break it does the winch's work.                                                                                  | one figure running between the fallen           | the 30% less, to 24%        |
| **The Rattle** (charm)          | Monsters within 8 tiles go for its wearer first, scouts sent for others and siege swarms included. A monster that has chased it for 5 seconds is rattled, 40 at a time. Whoever kills a rattled monster gets a second roll at that monster's drop chance, and a second drop if it comes up. Every 25th rattled kill pays the wearer a Reroll, six a landing at most. Its wearer's steps are a tick shorter than its bag makes them: 3, 4 with three slots full, 5 with four. | `!careful`, so it runs, and `!go` to drag the train to whoever can kill it.                                                          | a citizen with forty monsters strung out behind | the 40, to 48               |
| **Last Call** (charm, a bell)   | From the sighting, each of its wearer's drops made outside the bubble, elite and chest rolls included, is rolled twice and the better kept: unique over rare over magic over salvage. The winch never answers its wearer, and its `ramp` is held at `guard`. It comes off at every lift and goes back to the rack.                                                                                                                                                           | `!wear last call`, typed for each landing it is worn on, with company: `!home`, and `!go` and `!aid` from friends, are its way back. | the last figure out, with a bell at its belt    | a third roll                |

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

**The rules in full**, as `hit` in `packages/sim/src/hit.ts` works them:

- Each stage rounds each type down on its own: `n * pct / 10,000`, with
  `pct` in hundredths of a percent and 100% as 10,000.
- Where a line sits on the item, or in what order the lines are read,
  changes nothing, except that the "more" and "less" lines are applied in
  the order given. A "more" that names a type ("20% more fire damage")
  touches that type only; one that names none touches every type.
- A sum of increased under -100%, or a "less" of 100% or more, leaves
  nothing of the types it applies to, and never a negative.
- The crit roll is a whole number drawn below 10,000 from the world's
  generator, and the swing crits when it is under the crit chance, 500 bare
  plus every "+N% crit", held between 0 and 4,000. It is drawn once each time
  a citizen's swing lands, before its targets are looked at, whether it hits
  anyone or not; a swing that lands on several crits on all of them or none.
- Physical loses nothing when either the hit or the armour is 0. Two lines of
  "ignores N% resistance" add up.
- The hit does at least 1 when its base had anything in it, whatever the
  "less" lines and the target took off. A blow of nothing, such as a monster
  file's `damage: 0`, does nothing.
- No type grows past 2,147,483,647 at any stage, so a hit fits in 32 bits.
- The blow a viewer is sent names one type: the one that did most, or of
  types that tie, the first of physical, fire, cold and lightning.

The numbers a hit starts from are [plan.md](plan.md)'s, section 2.1, rounded
this way: a monster's hitpoints are rounded down once, after the rank
multiplies, so a level-5 brute has 158 and not twelve fodder's 156; its blow
is `hp(M) * (100 + M) / 100` rounded down, then the rank's share of that
rounded down, and at least 1. Brutes and elites have armour of four times
their level (4.3).

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

| Type      | Colour            | Status  | What it does                                                                                                                                                                                                                                               | Best against               |
| --------- | ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Physical  | the plate's sepia | Stagger | The target's wind-up is broken off and starts again. It cannot be staggered again for 2 seconds. Knockback is physical too.                                                                                                                                | brutes                     |
| Fire      | amber             | Burn    | Each second it does the fire part of the hit that set it, and jumps once to one monster within a tile that is not burning, at half strength; a jumped burn does not jump. A kill by a burn is its setter's.                                                | swarms                     |
| Cold      | pale blue         | Chill   | Steps and blows take half as long again. A chilled target that takes a second cold hit over the line is frozen for half the status time, and cannot be frozen again for 2 seconds. A frozen monster that dies shatters and chills monsters within 2 tiles. | scouts                     |
| Lightning | violet            | Shock   | It takes 20% more from every hit, whoever lands it. Each hit on it arcs to one other monster within 3 tiles for 30% of its lightning part.                                                                                                                 | elites, carriers, captains |

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
  dens, each by its letter (`!go den b`), and any unique lying on the
  ground. Five kinds can be named too: `!go chest`, `!go shrine`,
  `!go wreck`, `!go seam` and `!go pile` plant the flag on the nearest
  one this citizen can still use, by the walk from where it stands. On deck
  the places are the hatches, the guns and the hold. Compass points work,
  and the slice's landings have no sectors. A name may be several words
  (`!go waist hatch`).
- **Params every preset declares:** `stance` (fight, gather or careful,
  and fight by default); `margin`, the seconds it wants to be inside the
  bubble before the front reaches it, 0 to 240 and 30 by default; `keep`;
  `over`, how many levels over its own Arms it will work ground, 0 to 30;
  `aid`, 0 to 20 tiles it will go to get someone up, 6 by default; `ramp`,
  what it does at the siege: `!board`, `!hold` or `!guard`, and hold by
  default.
- **`ramp`.** On `board` a citizen goes aboard when it comes home and
  stays there. On `hold` it banks and goes back out to the wall at the
  point of the bubble's edge where it last came in (one drawn from its
  account if it has not been out this landing), so citizens hold the side
  they worked: the arcs of the posts within a sixth of the way round the
  foot of that point, either way. There it fights the siege swarm that
  `siege_distance` finds (below): one on a dark post's arc first, then one
  on the lit post with the least condition left, so it goes where the
  shield is losing most. It keeps to a swarm until the swarm is dead, waits
  at its side when nothing is there, steps back into the bubble to drink,
  and goes aboard when `lift_eta < 500 + way_home`: when the shield would
  break within 20 seconds and the walk to the ramp if nothing more were
  killed. Kills only put the real break later. `lift_eta` runs the siege's
  rules forward with every swarm against the arc it will be sent to
  (below), so it never reads past the real lift-off. On
  `plate.ts --siege`'s rosters (section 1), over 20 draws of the posts'
  order at shield 0, 5 and 10, at 15 and 150 awake, median and strong,
  every citizen on `hold` is up the ramp 20 seconds or more before the
  break. On `guard` it fights the same way to the break and then stands at
  the ramp's foot until 5 seconds before the lift. A citizen whose chatter
  is away is on `board` whatever it was set to.
- **`stance`.** On `fight` a citizen clears the packs of a pocket and then
  takes what the pocket holds. On `gather` it goes for seams, wrecks and
  piles first and fights only what guards them or comes at it, so it brings
  home more ore for the works and less loot of its own. On `careful` it
  keeps 3 tiles clear of monsters and works where it is quiet.
- **Two presets.** A monster pays a citizen in full only if it is fewer
  than ten levels under it (3.2), and a citizen will not work ground more
  than `over` above it, so the packs a citizen will fight are those from its
  Arms less 9 to its Arms plus `over`. On untouched settings a citizen
  clears a pocket and then takes what it holds. In this order it goes for a
  caller that is calling within 12 tiles; a standing pack in that range
  within 8 tiles; a thing within 8 tiles that it can still use (a chest,
  shrine or wreck whose guard is dead, a seam, a pile); the nearest standing
  pack in that range anywhere; the nearest den in that range with packs
  still inside, to wait at its pocket's posts for the next to come out; the
  nearest thing it can still use anywhere; and with none of those left,
  home, where it banks and waits in the yard until one of them appears
  again. Deckhand, the newcomer's, does exactly that, and its `over` is 10.
  Longhaul looks first for packs and dens at least 5 over its Arms, then as
  Deckhand, and its `over` is 15. Deckhand's rules for it, under the flag
  rules, with `stance` at `fight`:

  ```
  when caller_distance <= 12 as "the caller" ->
    step_to(caller_x, caller_y)
  when pack_distance(-9) <= 8 as "a pack here" ->
    walk_to(pack_x(-9), pack_y(-9))
  when node_distance(take) == 0 as "work" -> work
  when node_distance(take) <= 8 as "what is here" ->
    walk_to(node_x(take), node_y(take))
  when pack_distance(-9) < 9999 as "to a pack" ->
    walk_to(pack_x(-9), pack_y(-9))
  when den_distance(-9) < 9999 as "to a den" ->
    walk_to(den_x(-9), den_y(-9))
  when node_distance(take) < 9999 as "to what is left" ->
    walk_to(node_x(take), node_y(take))
  otherwise as "nothing left" -> go_home
  ```

  With `stance` at `gather` the two `take` rules for what is near and what
  is left sit above the pack rules and read `node_distance(dig)`. At the
  siege a rule above the pack rules takes the swarm `siege_distance` finds
  (below), so a citizen at the wall goes to the darkest or weakest arc of
  its side.
- **Rules every preset has above its own:** step out of a blow; drink (a
  flask of 3 drinks, each 40% of life, one back for every 20 kills, full
  again aboard or in the bubble); go home at the sighting if the chatter is
  away; turn back when `front_eta < margin * 10 + way_home` or when
  `horde_distance < 6`; go aboard by its `ramp`; step back from ground more
  than `over` levels above its Arms, which holds a flag planted there ("held
  by too deep"); own drops; drops to carry for others; the fallen within
  `aid`.
- **A flag on a citizen comes down at every lift.** An escort is typed again
  each landing.
- **New for programs:** `front_eta`, `lift_eta`, `shield`, `way_home`,
  `horde_distance`, `ground_level`, `flag_level`, `arms`, `haul`,
  `drop_distance`, `down_distance`, `flask`, `weapon_reach`; `go_home`,
  `pick_up`, `drink`, `revive`, `work`.
  - `front_eta` is the ticks until the front reaches the bubble, as the
    calls so far have it. `lift_eta` is the ticks until lift-off:
    `front_eta`, then the ticks the shield would last if nothing more were
    killed and nobody struck anything, and 300 more, 9998 at most. The
    simulation finds those ticks by running the siege's rules forward from
    the present state with no citizen in them: what is owed and sent, the
    posts' order, the weight on each arc, each post's condition and the
    pool. Every swarm slams, each one sent from now is against the arc it
    is sent to, and the run stops at 8,191 ticks. Before the siege it starts
    from a full pool with nothing sent and every post lit at its full
    condition, which is what the posts are until the siege's first slam,
    whether or not their lamps are lit yet. It uses the posts' order drawn
    at the sighting, and until the march it counts the citizens awake on
    the tick it reads, for W and the stations' room; from the march on it
    uses the count the siege made then. A new shield of 450 reads 399 to
    408 ticks over `plate.ts --siege`'s draws at 15 awake. Kills and
    strikes only take weight off the arcs, so the real break is never
    sooner than the reading, and a citizen that goes aboard by it is aboard
    in time. The world works it once a tick, not once for each citizen, and
    a run is at most 8,191 ticks of 30 posts. Both read 9999 before the
    sighting. `lift_eta` is built already, with the camp's
    nightfall standing in for the horde ([tactics.md](tactics.md)); pieces
    16 and 31 give the two sensors these meanings. `shield` is the part of
    its pool the shield has left, 0 to 100. `way_home` is the ticks of
    the citizen's walk as it is loaded: to the bubble's edge while it is
    outside before the siege, and to the ramp once it is inside or from the
    siege on, so a citizen at the wall counts its walk round to the ramp.
  - `siege_distance`, steps to the siege swarm a citizen on `hold` or
    `guard` takes at the wall, 9999 if there is none, with `siege_x` and
    `siege_y`: of the swarms at a station on the arcs of the posts within a
    sixth of the way round the foot of its side, any level up to its Arms
    plus `over`, one on a dark post's arc first, then one on the lit post
    with the least condition left; of those, one fewer than three citizens
    are striking, one nobody is striking before one somebody is, and the
    nearest. Its side is the point of the bubble's edge where it last came
    in (`ramp`, above).
  - `caller_distance`, steps to the nearest caller that is calling, 9999
    if there is none, with `caller_x` and `caller_y`.

  For the packs and dens:
  - `pack_distance(n)`, steps in a straight grid line to the nearest monster
    of a standing pack (one on its post, a siege swarm at the wall, or
    either going for someone; not one still in a den, in the black or under
    it) whose level is from the citizen's Arms
    plus n to its Arms plus `over`, n from -9 to 30; 9999 if there is none.
    `pack_x(n)` and `pack_y(n)` are where it stands, or the citizen's own
    tile if there is none.
  - `den_distance(n)`, `den_x(n)` and `den_y(n)`, the same for the mouth of
    the nearest den with packs still inside whose level is in that range.
  - `node_distance`, `node_x` and `node_y` with seven new kinds: `pile`
    and `seam`, one this citizen has not used up; `chest`, one still shut;
    `shrine`, one not yet touched; `wreck`, one this citizen has not had
    its ore from; `take`, the nearest of those five, leaving out a chest,
    shrine or wreck whose guard lives; and `dig`, the nearest seam, wreck
    or pile the same way. 0 is standing beside it, where `work` works it.

  Piece 5 builds `pack_*` and `den_*` and Deckhand's two pack rules and
  its den rule, piece 14 the node kinds and the `take` rules, piece 29
  `caller_*`, piece 31 `front_eta`, `shield`, `siege_*` and `ramp`, and piece 28
  Longhaul.

With the march at 9:00 the front is at the bubble at 10:15, so on the
default margin a citizen turns for home at about 9:05 from the far ground
with a full bag and 9:35 from near the yard, and is inside the bubble by
9:45. It is aboard
20 seconds before the break. A citizen is outside at the break only when
its chatter typed `!guard` or `!wear last call`, and the order strip says
so when either is typed: the row is `goofguy` and `guard`, with the
no-winch icon.

## 6. A citizen at hour 1, 10 and 100

Hours are hours of stream. A citizen is out on the map for about six
minutes of each thirteen, from 3:20 to its turn for home, and at the wall
for up to two more. plan.md, section 2.3, works the levels from its share
each landing: 6, 23 and 58. With the siege fought as 3.2 has it they are 6,
24 and 60, and the three citizens here are the share's.

On the second city's level-23 medium landing, 80 by 45, where the hour-100 citizen is the strongest
aboard, so the far level is 68. Fodder in ring 1's first pocket, level 7,
has 17 hitpoints, and at 17 it has 49. In ring 2 a fodder monster has 80, a
pack monster 240, and a brute 963 and a hit of 115. In ring 3's first
pocket, at 32, a fodder monster has 145 and a pack monster 437. At level 58
a fodder monster has 501, a pack monster 1,503, and a brute 6,013 and a hit
of 510; at 59, 521, 1,563 and a hit of 527.
On the far ground, level 68, a fodder monster has 719, a pack monster
2,159, and a brute 8,637 and a hit of 690.

|                | Hour 1                                               | Hour 10                                                                    | Hour 100                                                                                 |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Arms, life     | 6, 107                                               | 23, 375                                                                    | 58, 1,292                                                                                |
| Wears          | the rare blade of its first den, item level 12       | three rares, T4 and T5 lines                                               | rares with T2 lines, a unique, a fifth line from an Add                                  |
| A blow         | about 20 (13 with the blade it joined with)          | 85: 55 and 10 from the blade, +10 physical, +14%                           | about 501 by plan.md's gear factor, every 0.4 s to the hour-10 citizen's 0.5             |
| Its share      | 6.67 packs: 40 fodder, 10 pack, 4 brutes             | 7.67 packs: 46 fodder, 11.5 pack, 4.6 brutes                               | 19.33 packs: 116 fodder, 29 pack, 11.6 brutes                                            |
| Works          | ring 1's pockets at 7, 12 and 17                     | ring 2 at 23, and ring 3's first pocket at 32                              | ring 3's pockets at 59 and 68, until the horde takes them                                |
| Fodder there   | 1 blow at 7, 3 at 17                                 | 1 blow at 23, 2 at 32                                                      | 2 blows at 59 and 68, or one swing of a maul                                             |
| A pack monster | 3 blows at 7, 5 at 12                                | 3 blows at 23, 6 at 32                                                     | 4 blows at 59, 5 at 68                                                                   |
| A brute's hit  | 31, over a quarter of its life                       | 115, or 103 through armour 72: over a quarter                              | 527 at 59 and 690 at 68: 41% and 53% of its bare life                                    |
| Ring 2         | fodder 4 blows, a brute's hit a down; it keeps out   | its ground                                                                 | walks through it; what stands there does not go for it                                   |
| Its drops      | item level 7 to 17: T6 and T5 lines                  | item level 23 to 33: T4 at best                                            | item level 58 to 68, and 68 from its den's elite and the far chest: T1 lines only at 65+ |
| A rare, a T1   | a rare in 32 minutes                                 | a rare in 20 minutes                                                       | a rare in 12 minutes; one with a T1 line in 10.5 hours from drops, 2 at the bench        |
| The siege adds | 6 monsters at shield 1                               | 10 monsters at shield 3, a twentieth more rares                            | 36 monsters at shield 8, an eighth more rares                                            |
| On screen      | a swarm just past the yard, then the next pocket out | swarms cut down across ring 2, a den fight, the bundle full once a landing | alone in the deep pockets with a brute pack on it, a taller hat, the unique's effect     |

The hat's height is the level and the weapon's silhouette is the base, so
the three can be told apart standing still. The hour-10 citizen's blade is a
long blade of item level 25, the lowest that gives 10. The hour-10 column is
on a cliff that makes a drop matter: its 75 physical is under a ring-2 fodder monster's
80 hitpoints, and the "+14% damage" line makes it 85 and one blow. Without that line it is two blows and half the
kills.

Ring 2 gives the hour-100 citizen nothing, and its share is laid in ring 3:
seven packs in ten are due at 58 and stand in the pocket at 59, two at 63
stand at 59 or 68, and one is at 68. What the posts cannot take goes into
the dens aimed at 59 and at 68, which let the packs out at their own
levels, about a 21-second walk out. Its den's elite at 68 and the far chest
at 68 are where T1 lines can roll, with the one swarm in ten at 68. That
ground is on every landing, because the far level follows the strongest
citizen and not the median. It is 10 over its Arms here, which its `over`
of 10 just allows. Its share is 2.5 times the hour-10 citizen's because a
share grows with its citizen's level. The price is time and risk: two
blows for deep fodder, a brute that takes 41% to 53% of its life, and the
front gathering over the far ground from 8:00, half of it by 8:40. None of
it is near the ramp, its monsters do not leave their pockets, and the
scouts sent for it strike nobody else unless struck. A
citizen strong for its city but not the strongest has its share in ring
3's stepping pockets, each with a den at its level.

**Time to kill a share.** Counting an arc as two fodder, the hour-10
citizen needs about 30 swings for its fodder, 40 for its pack monsters and
65 for its brutes (963 hitpoints at 70 a blow through armour 92), 135 in
all, which at 5 ticks a swing is 675 ticks. The hour-100 citizen needs about
75, 100 and 160 (6,013 at 459 through armour 232), 335 swings at 4 ticks,
1,340 ticks. Those counts take each pack at its share's level; the packs
that stand in a pocket a level or a few over it take more, most of all the
hour-10 citizen's packs 5 and 10 over, which stand at 32, where a pack
monster takes it 6 blows. Both are out for the 3,500 ticks or so from ramp-down to
turning for home, so the swinging takes a fifth of that at hour 10 and
nearly two fifths at hour 100, and the rest goes on walking between
pockets, stepping out of blows, working what a pocket holds and going to
the posts a den has filled. A den gives its packs out until the sighting,
so the hour-10 citizen's den still has packs coming when its share's posts
are cleared. At the start of the siege a landing sends 1.3 swarms a
minute for each citizen awake, whatever its citizens' levels; two minutes
in it is 2.5, and the swarms are bigger and 20 levels higher. Piece 5 puts
in `metrics.json` the tick at which
the last laid monster each tier could fight died, at 15 and 150 on each
size; it should be after the sighting, so that turning back leaves something
behind.

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

  | Part      | Broken, it means                                                 | Drawn as                    | Salvage |
  | --------- | ---------------------------------------------------------------- | --------------------------- | ------: |
  | A leg     | The scouts, the sighting and the march all come a minute sooner. | a dragging leg, plates gone |      60 |
  | The winch | No down is winched (section 8).                                  | a burnt winch house         |      40 |
  | A bench   | One bench fewer.                                                 | a fire on the mid deck      |      30 |
  | A gun     | That hatch has no gun.                                           | a split barrel              |      20 |

- A citizen downed on deck is up after 10 seconds at 30% and loses nothing.
  With nobody awake the rig passes by.

## 8. Downs, lift-off, and what an absence costs

**Who the winch answers.** Every citizen that goes down before the break,
and nobody from the break on. A citizen that went down before the break is
winched even when its 15 seconds run past it.

**Lift-off** is 30 seconds after the break. Every citizen outside then,
down or standing, on a winch line or not, is hauled aboard and stripped.
Nothing exempts a citizen from this, whatever its settings. What keeps a
citizen clear of it is its `ramp` setting, which untouched has it aboard 20
seconds before the break, and the winch for a down before the break.

| What happened                                                     | Haul                                                                 | Worn | Then                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---- | --------------------------------------------------- |
| Down, and got up by a citizen beside it (4 s)                     | kept                                                                 | kept | up at 30%, untouchable for 3 seconds                |
| Down before the break, and nobody comes in 15 s                   | left where it fell as a bundle with its name, its own until the lift | kept | winched aboard on a visible line; out again in 20 s |
| The same with no winch (broken, a No winch landing, or Last Call) | left as a bundle, as above                                           | kept | gets up where it lies after 30 s, at 30%            |
| Down after the break, nobody comes                                | lost at the lift                                                     | lost | lies there until the lift                           |
| Outside at the lift, down or standing                             | lost                                                                 | lost | hauled aboard, named in the tally                   |

The second and third rows are for a down before the break. From the break,
a citizen that goes down and is not got up lies there until the lift. A
bundle left on ground the black then covers is lost.

**Stripped** means the haul and everything worn. Levels, the stash, the
kits, the rack and the purse are untouched, except that a kit piece or a
unique that was being worn is lost with the rest. The citizen dresses from
its stash at once (3.1). If its chatter is away it then stays aboard until they
next type, so an absence costs one strip at most.

**Who ends up outside.** A citizen whose chatter typed `!guard` or
`!wear last call` has chosen to be out after the break. A citizen on
untouched settings is inside the bubble 30 seconds before the front and
aboard 20 seconds before the break, so it is out after the break only when
a down at the wall in those last seconds holds it there. Piece 31 tests
that it is aboard before the break, because if it is not, it can lose its
haul and its gear.

**The lost list.** Rares and uniques lost at lift-off go on the horde's lost
list, which holds the 12 best. On each later landing up to 3 **carriers**
come to the wall when the siege begins and take stations there: elites of
the landing's level plus 10, best items first, each lettered with what it
carries (`The Blot`, or `goofguy` beside a bundle). A carrier slams the
bubble on its station's arc as a siege monster does, with a weight of 40,
and goes for whoever strikes it. A carrier's
item always drops when it dies, as its first owner's, and by 3.3 anyone can
carry it home for them. An item whose carrier has come out on 3 landings and lived is gone.
One dropped and not brought home goes back on the list with its landings
still counted.

**An absent chatter's citizen** goes home at the sighting, at least 105
seconds before the front is at the bubble, for a walk of 50 seconds at most
with a full bag, and goes aboard. It stays aboard while the winch is broken
and on a No winch landing. It cannot be wearing Last Call, which came off
at the last lift and is put on only by a typed `!wear`. A down on the way
home is winched, so on its own it loses at most a haul to a down, unless
downs keep it out until the break, which piece 16 tests does not happen. After
24 hours it goes below (chat.md, section 5). What it brought home was opened
and worn for it within its weapon family, uniques wait in the rack, the
stash kept what 3.6 says it keeps, and no tool or salvage was spent.

## 9. Decisions and their defaults: the streamer's site

Served to the local machine as chat.md has it. Each control sends a `mod`
input, and each default runs with nobody there. chat.md's site also lists
Tuning; the slice ships one tuning, so it does not build that part.

**The navigator.** The city has a level, 5 to begin with. After a landing it
goes up 1 if under 20% of the present citizens who went out were downed or
stripped, and down 2 if over 50% were. Away citizens are not counted. It is
never under 1, and never more than 10 over the median Arms level of the
present, so a city left alone settles where a fifth to a half of its
chatters go down on a landing. When no present citizen went out, the level
holds, and with nobody present the cap is taken from the citizens awake.
Three landings are rolled ahead in transit: size (small 30%, medium 45%,
large 25%, of the three its city size lands on; small 40% and medium 60%
for the second city until its large landing is built), biome, a level
within 2 of the city's and 1 at least, and 0, 1 or 2 modifiers (40%, 40%,
20%). The navigator takes the first, or the smallest after a landing that
stripped over 30% of the present.

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

**The works** take in ore, and pay for the shield and for a bigger city.
Every ore a citizen banks at the ramp counts as 15 over the citizens awake,
and as 1 with 15 awake or fewer, held in hundredths. So a full city and a
small one build at the same pace, and a city of five builds at a third of
it. The works count 30 ore at most from one citizen a landing, and what it
banks past that is not counted, so a chat on `!gather` builds at three
times the pace below at most. A landing of 80 by 45 has 24 seams and 2
wrecks, 160 ore a citizen, and two or three trips on `!gather` bank 80 to
120 of it. The works build one thing at a time. When it is paid for it is built in
the next transit, where the stream sees it go on, and the works start on
the next.

| The works build | Cost                             | It gives                                                                                                                                |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| A shield level  | 300 times the level, to level 10 | 90 points of strength, two posts and a point of condition on every post (section 1): a longer siege, and more swarms for those who hold |
| City 2          | 4,000                            | the hull of 15 by 6 on eight legs, and landings of 68 by 38 and 80 by 45                                                                |
| City 3          | 25,000                           | after the slice                                                                                                                         |
| City 4          | 100,000                          | after the slice                                                                                                                         |

The default order is shield 1 and 2, city 2, shield 3 to 5, city 3, shield
6 to 8, city 4, shield 9 and 10. A citizen on untouched settings takes what
the pockets it clears hold, and the pace below takes that as two seams a
landing, 10 ore. Then 15 citizens bank 150 a landing and 690 an hour:

| Built     | Paid in all | Hours of stream |
| --------- | ----------: | --------------: |
| Shield 2  |         900 |             1.3 |
| City 2    |       4,900 |             7.1 |
| Shield 5  |       8,500 |            12.3 |
| City 3    |      33,500 |              48 |
| Shield 8  |      39,800 |              58 |
| City 4    |     139,800 |             202 |
| Shield 10 |     145,500 |             210 |

A chat that types `!gather` builds faster, up to three times as fast, and
what each citizen digs is in the tally: fifteen citizens counted at 30 a
landing reach city 4 in about 67 hours where the default takes 202. Piece 32 puts the ore banked for each citizen a landing in
`metrics.json`, and the costs are tuned from there. Ore in a bag is haul,
and is lost with it.

| Decision     | Default                                                          | The streamer can                                                                                           |
| ------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Next landing | the navigator's                                                  | pick any of the three                                                                                      |
| Risk         | as rolled; high-risk when the hold is full and nothing is broken | plain (no modifiers), or high-risk (two modifiers, 5 levels over, 20% more drops), which costs a full hold |
| Raiders      | stand                                                            | run: no fight, and the scouts and all that follows them come 90 s sooner on the next landing               |
| Repairs      | winch, leg, benches, guns                                        | reorder, or hold the salvage                                                                               |
| The works    | the order above                                                  | choose what is built next, of the next shield level and the next city size                                 |
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
| A spawn table by place and hour, 3 monsters a region          | each citizen's share laid as packs in the pockets and the dens, scouts, the siege |
| A bag of goods and a bank chest (`bag.ts`)                    | the haul, the stash, the kits, the rack, the purse, the hold, the works           |
| Trees and fishing spots (`gather.ts`, `nodes.ts`)             | scrap piles, seams, chests, shrines and wrecks                                    |
| `melee`                                                       | Arms, which every weapon trains; Hitpoints stays                                  |
| `items.ts`: four slots, even tiers, a normal rarity           | section 3                                                                         |
| A blow of fixed damage                                        | section 4                                                                         |
| `homebody`, `riverwalker`, `wanderer`, six named residents    | Deckhand, Longhaul, the scripted crowd                                            |
| The page of rows, the spotlight, the pan between regions      | the four corners (the dial, the landing, the log, the counts) and the zoom        |
| #315 to #321, #332                                            | pieces 4 to 8                                                                     |
| #240, #241, #322                                              | pieces 11 to 15                                                                   |
| Chat C1 to C8, C10, C12, C13 (#347 to #354, #356, #358, #359) | pieces 1, 3, 9, 10, 27 and 28                                                     |
| One landing generator for one hull (#364, #399, #409)         | a city size in its input, an open yard, and what pockets hold (#415, #416)        |
| #339, #340, #342, #343                                        | the look target (#362) and pieces 2, 8 and 15                                     |
| #323, #324, #336, #341                                        | pieces 8, 3, 4 and the look target                                                |
| #311, #346                                                    | stay open as the bugs they are                                                    |
| #200, #337                                                    | closed by this spec: piece 33 is the watch review, and chat.md is the chat design |
| #250, #296                                                    | the operator's complaints the slice is the answer to; they close with piece 33    |

**Dropped.** Day and night as a clock, the camp and its fire, woodcutting,
fishing, cooking and eating (the flask replaces food), regions and the
frame's travel between them, and with them #231, #232, #237, #238, #245,
#251, #272, #288, #294, #299 to #302, #304, #326 and #327. Chat C11 (#357)
waits for a stream to read. Every milestone of the old plan from M2 on.

## 11. Build pieces

After #362 (look target), #363 (sim at scale) and #364 (landing generator),
with #415 and #416 for what this page now asks of the generator. Each row is
one issue. Scripted chatters from a crowd file drive every
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

| #   | Piece                             | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Shown to work by                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Inputs, the gate, the crowd       | Chat C1 and C2, with the two crowd files of usernames.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A snapshot plus its log gives the live hash; hostile input changes nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | The deck and the cycle            | The world is a deck with a ramp and hatches, drawn from above as the look target has it. Section 1's beats on their ticks up to the front at the bubble. Until piece 31 builds the shield nothing breaks it, and a test's input breaks it; lift-off and the next cycle follow the break by section 1's rule. Regions, the camp and the six named residents go. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Three cycles headless with the crowd aboard, the break put at 11:00, 12:50 and 14:20 by input: lift-off is 300 ticks after each, the next cycle's 0:00 is at 13:00 or at lift-off, the later, and its legs plant 1,800 ticks after that; snapshot and resume across each beat give the same hash.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 3   | Joining, and a landing to walk on | Chat C3. The generator's map for the city's size set down at 3:00 and drawn in the pull back, ground levels and the far level, `front_eta`, `lift_eta`, `way_home`, `ground_level`, `go_home` and the turn for home in a first Deckhand, everyone aboard at the lift. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Nobody stuck over 20 landings of each size the generator has. On a level-23 medium landing of the second city with one Arms-58 citizen awake, every pocket has one level and every tile of it that level; no pocket's level is under that of a pocket before it in the order of the walk to the gates; the yard is 5 or less, ring 1's first pocket 7, ring 2's 23, ring 3's steps 10 levels or less apart up to 68, and its farthest at 68.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | The hit                           | Section 4.1 as one function over a list of modifiers, with levels, ranks, monster blow times, armour and crit. Blows in the viewer's message, cut to what a frame draws.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Both worked examples to the unit, from hand-fed lines; a test for each rounding rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | Monsters on a landing             | Section 1's packs and leaders, shares and their order, posts and laying out at legs-plant, the room by the landing's tiles and the map's own packs, dens with their letters holding packs and letting them out on their clocks, elites at the mouth, the dens aimed at ring 3's steps, the near den and the far chest, a share's pay with drops past 100% and its ceiling of 5, the cap, keeping to the pocket, leaving alone a citizen ten levels over, what the plate letters (a den's letter and level, a pocket's level at its gate), `pack_*` and `den_*` with Deckhand's rules for them, 4-tick steps, outrunning. `look`.                                                                                                                                                                                                                                                                                                                                                  | Exact: a level-23 citizen's share is 7.67 packs and its remainder carries to the next landing; any 10 packs in a row of the order are 60 fodder, 15 pack monsters and 6 brutes, three of them 5 or 10 over; laid for 2, for 15 and for 150 awake on 20 seeds of each size, what stands at legs-plant (elites, guards and each den's first two counted) is no more than the size's room, and under it only where no free post is left; with 2 awake the plate is brought to its room by the map's own packs, each at its post's ground level; every post has its eight neighbours in its pocket and no other post of its pocket within 3 tiles; every laid pack of a share is within 5 levels of its share's level, no den holds over 60 packs and none whose pocket has no post holds any, no pocket holds two dens, dens are lettered A onward by the walk from the ramp, and for each share the laid weight times its pay is its whole weight, or 5 times the laid weight where its pay is held at 5; a den lets its first two packs out at legs-plant and the rest only on its turns, never on a kill and none while the plate holds 50 over its room, with its turn interval fixed at legs-plant and its last turn by the sighting, and two dens with a turn on one tick go in turn; a pack let out stands on the free post of its pocket whose walk to the nearest citizen is longest; a fodder kill paying 3 drops at 12%, and a brute kill paying 5 drops exactly two items, and on a high-risk landing two and rolls 40% for a third; no monster appears after legs-plant but a den's or the horde's; a laid monster never steps out of its pocket and takes no damage from a citizen outside it; it does not go for a citizen ten levels over it until struck; `pack_distance(-9)` finds a pack in range and reads 9999 once the pocket is cleared. `metrics.json` has, for each tier of the scripted crowd at 15 and 150 on each size, what stood at legs-plant, the part of its share laid on posts and in dens, its pay, the part of what was laid its tier killed, the tick at which the last laid monster it could fight died, the turns dens passed on the cap or for want of a free post, the experience each tier took from the map's own packs, and the far-ground rolls the strongest citizen got. Captures of the second city's medium landing at 15 at 3:30 and 6:00, on which a judge at 640 finds packs in at least eight pockets and no half of the frame without them. #363's tick bar on a full medium landing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 6   | Four weapons and the flask        | Shapes and times, arrows, knockback, `weapon_reach`, drinking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A test for each shape and for a body knocked into a wall.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | Elements and statuses             | The four types, 4.2's statuses and lockouts, resistances, a landing's element.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A test for each status at its line; the four rows of 4.3's table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 8   | The fight in ink                  | Swings, hit-stop, bursts, stains, swarms and status marks, in #362's renderer. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | A mow sheet at 640 on which a judge names each citizen's weapon and element; frame time at 150 citizens, 700 monsters and 150 things in the air.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Params and the flag               | Chat C5 and C6 with section 5's params.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | chat.md's tests; margin 0 and 240 differ in time out; a flag on ground past `over` is reported as held.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 10  | Orders on screen                  | Chat C7, with the card for `!me`; its gear lines fill in with piece 13. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A judge playing a chatter finds their citizen and sends it to a den. With 150 scripted chatters each asking `!me` once in a transit, nine in ten cards are up within 30 s and the longest wait is in `metrics.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 11  | Drops                             | 3.2: the drop chance, the weights and their bonuses, the ten-levels-under rule, personal rolls at elites, tools, weighted tiers, wearing by level, the lines in the hit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exact: for each rank and for bonuses of 1, 2, 5, 10 and 20, every value of the drop roll and of the kind roll, counted against the weights; both worked cases of 3.2 to the unit; a forced roll gives each unique. On a fixed seed: 1,000,000 fodder kills give 40,000 drops, give or take 784; 100,000 lines rolled at item level 65 give 1,587 at T1, give or take 158; 100,000 elite rolls give 16,839 rares, give or take 473. A newcomer's first den gives a rare weapon it can wear.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 12  | Ownership and the bag             | 3.3's ownership, carrying for another, the bag of 4 and its slowing, `keep`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | An owner's rare cannot be kept by another before the horn; a full bag lengthens `way_home`; a carrier's strip puts the item on the lost list under its owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 13  | Opening, the stash and wearing    | Opening at the ramp, the swap rules, the stash with its locks and bases, the kits, the rack, `!stash`, `!wear`, `!lock`, `!scrap`, the purse and the hold. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A haul not carried over the ramp changes nothing aboard; the swap never crosses a family; `!wear fire` puts on the fire kit. Over 10,000 seeded hauls into a full stash, the item scrapped is always the lowest by 3.6's order and never locked, a base, a kit piece or a unique; a piece pushed out of one kit goes into another it betters. A citizen left away for 100 landings still has every locked item, and each kit and base is the one it had or better.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 14  | Piles, seams and chests           | `work`, the chest's guard posted beside it, the chest's rolls, seams and ore, ore carried and banked, the `pile`, `seam`, `chest`, `take` and `dig` kinds of `node_distance` with Deckhand's `take` rules and `gather`. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A pile gives one citizen 10 salvage and then nothing, and still pays the next citizen; a seam the same with 5 ore; a chest cannot be worked while any of its guard lives, and nothing comes out of the ground when it opens; a chest pays everyone within 6 tiles, 20 at most, each at its own feet; ore takes a bag slot for each 10 and is lost in a strip. A Deckhand that has cleared a pocket works what it holds within 8 tiles before it goes to the next pack, and with nothing left goes home; on `gather` it banks more ore and has fewer kills than on `fight`, on one seed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 15  | Loot on screen                    | Markers, pennants in the bundle, the filter, weapons on figures. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A judge at 640 points at every rare on the ground and says who carries most; a capture at 150 with the news readable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 16  | The front and the march           | The sighting, the black gathering along the rim and deepening to the march, the march from that black to the strip by section 1's rule, lost ground, loot and dens, `horde_distance`, away citizens going home, the black drawn. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Exact: on 20 landings of each size, for a march at 8:30, 9:00 and 9:30, from the sighting to the march the black holds exactly the ground fewer than g tiles from the rim or a gap, with g as section 1 gives it, so no side has more than half again another's; every tile is taken on the tick section 1's rule gives it, the strip's outer edge 750 ticks after the march, no tile of the strip or the yard before the break, and no taken tile is ever cut off from the rest of the black; a den the black covers is lost with the packs inside and gives no roll. An away citizen is aboard before the front is at the bubble on 100 landings. A present citizen on untouched settings is inside the bubble 30 seconds before the front on 100 landings, at 15 and at 150, on each size, and loses no life to the black.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 17  | Downs and the winch               | Section 8's table, the strip, `aid`, the winch lines. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Each row of the table; a down a tick before the break is winched and a down a tick after is not; a citizen outside at the lift loses its haul and everything it wears whatever its settings, down or standing, on a winch line or not; an away citizen is never stripped twice in one absence.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 18  | The break and the ramp            | The break at a pool of 0 and at no other time, on every post at once, the horn, the black over the strip and the yard in 300 ticks, what is left of the siege going for the ramp, `guard`, the blocked ramp, the lift 300 ticks after the break and the transit after it by section 1's rule, the tally. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | The shield breaks on the first tick its pool is 0 and never before, whatever its lamps; the lift is 300 ticks after the break on 100 landings, and the next cycle's 0:00 is at 13:00 or at lift-off, the later, so the transit is 3:00 or more; `guard` and `board` differ in kills and in who gets aboard; a monster on the ramp blocks it; nobody is winched from the break on. The capture's crowd has a third of its chatters type `!guard`, since on untouched settings everyone is aboard before the break and nobody runs in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 19  | The six uniques' rules            | 3.9, with each cap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | A test for each rule and each cap: the Blot's depth, the Rattle's 40 and 6, Rally's ten, Hoist's once. Exact: a rattled fodder kill rolls 4% twice. Last Call is in the rack after every lift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 20  | The six uniques drawn             | Their drawings and effects at far size. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | A judge names each from a frame at 640.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 21  | The bench                         | The three orders, the purse's cost, Acid's four results, tools on a unique, the result over the citizen. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Each tool on each rarity; exact: Acid's roll walked over its four results; nothing spent without an order; a bench order on a stash item locks it while a lock is free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 22  | Raiders on the decks              | Lines, boarders, guns, crates, captains, credit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Guns crewed and no hatch held: every line is cut by 2:00; no posts: salvage is lost; Heave-Ho over a rail. 600 actors at most.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 23  | Parts and mending                 | Wreckers, the four parts drawn broken, mending. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | A broken leg moves the next sighting; a broken winch keeps away citizens aboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 24  | The raid drawn                    | The rig, lines, bodies over the rail. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A judge follows a raid at 640 without the news.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 25  | The navigator and modifiers       | The city's level, three landings ahead of the city's own sizes shown in transit, Stalked with its line, No winch, All fire, the hold's cap and the price of a high-risk landing. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A city left alone for 100 cycles stays inside the navigator's bounds, lands on every size its city has, and takes a high-risk landing only with a full hold.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 26  | Carriers                          | The lost list and its carriers at the wall, lettered with what they carry. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A stripped unique comes to the wall at the next landing's siege, drops as its owner's, and is gone after three.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 27  | Speech and quiet chatters         | Chat C4, C8, C10, and the card on coming back. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | chat.md's tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 28  | The site and presets              | Section 9's controls with C13; Longhaul, which looks first for packs and dens 5 over, and `!run` with C12. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Each control sends its `mod` input; the two presets differ in haul on one seed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 29  | Scouts                            | Scout packs in three waves by the citizens outside the bubble, shared over the gaps, their marks, the caller's call and what stops it or starts it again, the march's tick from the calls and the packs sent, `caller_*` and Deckhand's rule for it, the horde's bonus on scouts, the corner counting to the march. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Exact: with 13 citizens outside at each wave, 3 packs come in a wave, shared over the gaps in turn; a pack's mark is the nearest unmarked citizen outside the bubble by the walk; a scout pack never damages a citizen that is not its mark and has not struck it; a caller left alone for 100 ticks is counted and one killed at 99 is not; a stagger starts the call again; with 9 packs sent and 0, 5 and 9 calls the front marches at ticks 5,700, 5,367 and 5,100; with nobody outside no scouts come and it marches at 5,700; a pack whose citizens all step inside goes back to its gap and its caller calls there at the sighting, so the march comes as if it had found someone; a pack that would pass the cap waits and is not counted as sent. `metrics.json` has the calls made and stopped at 15 and 150 on each size. A capture of a caller found and killed, on which a judge at 640 points at the caller before it is dead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 30  | Shrines and wrecks                | The guard beside each, a shrine's touch and its three boons with their marks on the figure, a wreck's work four at a time, the `shrine` and `wreck` kinds. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | A shrine cannot be touched while its guard lives; its boon reaches each citizen within 6 tiles at the touch, lasts 600 ticks and no longer, and the shrine is spent; a quick citizen's step is a tick shorter, a keen one's hit is 30% more as a "more" in 4.1's order, and a lucky one's rare weight on a fodder drop is 117 where it was 78; a wreck gives a citizen 20 ore for 100 ticks of work once, and a fifth citizen waits while four work. A capture on which a judge names the boon from the shrine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 31  | The shield and the siege          | The bubble over the yard from legs-plant, its pool by level and its posts by level, each with its arc and its condition, lit from the march; the pool and every post's condition in the state, the snapshot and the viewer's message; the wall's stations, a swarm to a station for each 15 awake; the citizens awake counted once at the march; the siege's weight from the landing's level and that count, sent 10 ticks slower for each citizen past 15 and growing with the siege, its swarms to level 99 at most; the posts' order drawn at the sighting and swarms sent to the posts in turn; slams, and what the pool and the conditions lose a tick, three times over on a dark post's arc; whom a swarm goes for; the horde's bonus and the pay up to a share; `shield`, `lift_eta` from the sighting by the forward run, `siege_*`, `way_home` at the wall, `ramp` with `hold` and the side it holds; the lamps lit and the pool's loss a minute in the corner. `look`. | Exact: nothing of the map or the horde enters the bubble or damages a citizen in it while it holds, and no blow from inside it damages anything outside; one swarm slamming on a dark post's arc takes three times from the pool what the same swarm takes on a lit post's arc, and a lit post's condition loses what its arc takes; a post goes dark on the tick its condition runs out and is never lit again that landing; the shield breaks on the tick the pool is 0, with lit posts standing, and on no other tick; with nothing killed at 15 awake on a level-23 landing a shield of 450 breaks 399 to 408 ticks into the siege and one of 1,350 684 to 698 ticks in, as `plate.ts --siege` has it for those draws; with every swarm killed the tick it is sent the shield loses nothing and still stands 20,000 ticks into the siege; a level-23 share's weight is 135.75, and a siege of 15 awake on a level-23 landing, with W 2,036.25, is owed 2,544.67 over ticks 0 to 2,399 on top of the part drawn from the seed, which is W × (2,400 × 800 + 2,399 × 1,200) / 3,840,000 held in hundredths and rounded down; one of 150 awake is owed its W over 6,150 ticks where one of 15 is owed it over 4,800, times (800 + t) / 800 for both; a swarm sent at t has 10 + floor(t / 300) fodder and is floor(t / 60) levels over its place in the order at the landing's level, to 99 at most, whatever the levels of the citizens awake, so on a level-89 landing a swarm at the landing's own place sent 600 ticks in is at 99 and so is one sent 6,000 in, and every siege drop rolls; each post has been sent as many swarms as any other, or one more or fewer, at every tick; a station holds one swarm at 15 awake and ten at 150; 40 citizens who join a siege of 15 after the march fight at the wall and change neither W, nor what is owed a tick, nor a station's room; the posts' order is the same at the sighting and at the march; on 20 landings each, scripted on `guard` at shield 10, the strong roster of section 1's table holds longer than the median at 15 and at 150, 150 hold longer than 15 for both rosters and for Arms 99 in the best gear on a level-58 landing, and 150 at Arms 99 in the best gear on a level-1 landing lose the shield before 4,000 ticks of siege; one of 15 on untouched settings loses a level-0 shield after a roster with nobody fighting does; no siege monster pays a citizen past its share's weight; a snapshot taken mid-siege and resumed darkens the same posts with the same hash, and a viewer that joins mid-siege is sent the same conditions as one that watched; a swarm waiting in the black slams on its arc and a swarm struck does not; a swarm slams until a citizen strikes it, a citizen standing beside it outside the bubble without striking does not stop it, and a swarm going for its striker stops at the bubble's edge; a siege monster ten levels under its killer drops salvage only; during the siege `lift_eta` never reads past the real lift-off, and `way_home` at the wall is the walk to the ramp; a citizen on `hold` goes out where it came in and takes a swarm on a dark post's arc of its side before one on a lit post's arc, and on a lit post's arc the one with the least condition. A present citizen on untouched settings is aboard before the break on 100 landings, at 15 and at 150, on each size, and on every one of those landings the shield breaks only when its pool is 0. `metrics.json` has the siege's length, the swarms sent and killed for each tier, the tick each post went dark, and the strongest citizen's siege drops at 65 or more. Captures of a siege at 15 and at 150, on which a judge at 640 reads the lamps lit and which side is going dark, and finds citizens fighting on at least three sides of the city. |
| 32  | The works and the second city     | Ore counted into the works by the citizens awake, the costs and the default order, a shield level and the second city built in transit, the first city's hull and its three landings, the navigator rolling the city's own sizes, the works on the streamer's site. `look`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Exact: an ore banked with 15 awake adds 1 to the works and with 150 awake a tenth; the default order has shield 1 built at 300 paid in all and the second city at 4,900; a thing paid for during a landing is built in the next transit and not before; the streamer's choice of the other thing is what the works start next. A city left alone with 15 scripted chatters becomes the second city between 5 and 10 hours in, and `metrics.json` has the ore banked for each citizen a landing. Captures of the first city on its medium landing and of the hull growing in transit, signed off against the art bible's city sizes (#417).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 33  | The hour                          | One hour at 15 and one at 150 scripted chatters, on the second city with a level-3 shield.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | The watch judge's verdict from a player's seat has no "no"; the playtester's list has nothing above polish; the levels reached are within a level of plan.md's table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Pieces 1 and 4 can start beside 2. After 13, pieces 15, 16 and 21 are in
different packages. Piece 29 follows 16, piece 30 follows 14, piece 31
follows 16 and 18, and piece 32 follows 31 and #415.

Known to be thin:

- The levels and drops assume each tier kills what was laid for it, and
  whether citizens working a den's pocket do, before the march covers it,
  is piece 5's measurement.
- A tier with no den or posts near its level is paid more for each kill in
  place of more kills, up to 5 times, and a share with nothing laid gives
  nothing. With a level a pocket and the size's dens aimed at ring 3's
  steps, section 1's runs pay every tier 89% or more at 15 awake and 84% or
  more at 150 on stand-ins; the generator's maps pay every tier 90% or more
  at 15 and 82% or more at 150. A citizen paid 89% from level 30 to 50
  takes about 46 hours over a climb plan.md's table gives 41, about a level
  short at hour 100.
- A pack takes its pocket's level, up to 5 off what its share was due. The
  hour-10 citizen's packs due at 28 and 33 stand at 32, where a pack
  monster takes it 6 blows to its 3 at 23, and the hour-100 citizen's due
  at 58 stand at 59, where fodder takes two blows.
- The first city's smallest landing has 27 posts at the median and 18 at
  the fewest, so it stands 229 of its room of 251 at the median and 158 on
  its barest landing of the hundred.
- Posts more than 3 apart leave a tile of open ground between two packs'
  squares, where art.md asks two (section 6). With two the 80 by 45
  stand-ins have 59 posts where they have 71, and stand 509 monsters at 15
  awake against the room of 600. The art director has the choice.
- At 150 most of the fighting comes out of dens: nine tenths of what is
  laid on the second city's medium landing waits inside one at legs-plant
  and comes out on its clock, a pack every 5 seconds from each. Whether the
  plate still reads as a map to explore is judged at 15, where the
  roadmap's hour is captured.
- A small roster fights mostly the map's own packs, which pay as written:
  with 2 awake at Arms 23 the shares on 80 by 45 are 124 monsters and the
  map lays 424 of its own. Each of the two has several times its share
  standing at full pay, so a stream of two to five can level ahead of
  plan.md's table while the works pay it a third of the pace. Piece 5's
  `metrics.json` has the experience a citizen takes from the map's own
  packs, and piece 33 judges it.
- The siege's times are `plate.ts --siege`'s flow estimate, not the
  simulation: a fixed swing, a fixed share of the time spent swinging, no
  downs, no flask, sides spread evenly round the foot, stations evenly
  round it, and the second city's 45 stations on every landing. How long a
  shield lasts with 13 of 15 fighting for it, and with 130 of 150, is piece
  31's measurement.
- The swing floor sets the longest holds. A citizen whose blow kills a
  fodder monster outright kills at its swing rate, so 15 at Arms 58 on a
  level-23 landing hold a level-10 shield 257 seconds and 15 at Arms 99
  only 260. The longest in the runs is 356 seconds, 150 at Arms 99 on a
  landing of level 20 or under. Whether a veteran roster's 4- to 6-minute
  siege on a low landing reads as worth watching is for the hour's judge.
- At 150 awake the plate's cap of 700 holds the wall to about 50 swarms,
  and the rest wait in the black, slamming. What keeps 150 ahead of 15 is
  the horde sent 10 ticks slower for each citizen past 15, tuned on the
  second city's medium landing's 45 stations. The smaller landings have
  caps of 351 to 530 and 36 or 37 stations on the first city's, so the cap
  is full sooner there, and piece 31 measures 15 against 150 on each size.
- Under 15 awake a smaller roster can hold longer. At Arms 99 in the best
  gear on `guard` at shield 10, over 20 draws, 5 citizens hold 157 seconds
  on a level-58 landing where 15 hold 132, and 113 on a level-99 one where
  15 hold 102; 5 or 10 beat 15 on every landing of level 58 and up in the
  run, and on landings of level 33 and under 5 hold 5 to 19 seconds less
  than 15. The cause is `siege_distance`'s order. A citizen takes a lit
  post with the least condition on its side before the nearest swarm, and
  at 15 about five citizens cover each point of the wall, so they walk to
  the same weakest arc while the nearest swarms slam; 5 cover each point
  less than twice and walk less. Tried with nearest first after the dark
  posts, over 10 draws, 5 and 10 held less than 15 everywhere, but on high
  landings the cap was full sooner and 150 at Arms 99 on a level-58
  landing held 188 seconds against 201 for 15, so the order stays as it
  is. The conductor can accept this for rosters under 15 or have the order
  and the horde's rate changed together.
- At 150 awake every side of the wall is covered, so the first post goes
  dark only 7 to 16 seconds before the break and the corner reads every
  lamp lit until the pool is nearly gone. The pool's loss a minute is then
  the only warning in the corner.
- The corner shows the lamps lit and the pool's loss a minute, and not the
  pool itself, which only `shield` reads. Whether a viewer can tell how
  much of the shield is left from the lamps and the rate is for the art
  director and the hour's judge.
- The bubble needs open ground outside it. The generator's yard is walled
  until #416, with a median of 6 stations at its gates on 80 by 45 (0 to 20).
- The front gathers over the far ground from 8:00: on 80 by 45 the black
  holds 28% of the ground when it marches, and the strongest citizen's
  posts are covered at 8:20 at the median. Its packs there must be killed
  by then or are lost.
- The works' pace rests on two seams a citizen a landing. Nothing has been
  run, and the costs in section 9 are tuned when piece 32 has the count.
  The 30 ore a citizen a landing that the works count at most holds a chat
  on `!gather` to three times the default.
- The siege comes on top of plan.md's level table: on untouched settings,
  for an Arms-23 citizen in the median roster at 15, 5% of a share at
  shield 0 and 18% at shield 10, and never more than the share. The table
  is the pace of a citizen that goes aboard at the march.
- A call brings the march forward for everyone. One chatter's citizen left
  far out with callers on it costs the city seconds, and whether that reads
  as fair is for the hour's judge.
- `!go` reaches dens by letter, the nearest of five kinds of thing,
  citizens and uniques. A standing pack has no name.
- A blow from outside a pocket does a laid monster no damage, and neither
  does one out of the bubble. An arrow that lands and does nothing needs
  drawing, or bow citizens will look broken at a gate and at the bubble's
  edge; that goes in the art briefs of pieces 5 and 31.
- A share is laid whether or not its citizen goes out, and the siege's
  weight counts every citizen awake at the march, so an away citizen's
  packs are there for others and its part of the siege stands against the
  shield. A raid that joins mid-siege adds defenders and no weight, so it
  holds the shield longer than the same citizens awake at the march would.
- `keep` cannot tell a level-65 base from a level-10 one on the ground,
  though the stash can, and a base is only a better number than the one
  below it.
- Two activities are few. Shrines and wrecks are what the slice has.
- Six uniques are few for a 26-hour drop.

## 12. After the slice

- City sizes 3 and 4, and the second city's large landing: maps of 96 by 54
  to 128 by 72 and a citizen of 40 to 43 px (#418). The size table in
  section 1 is the plan for them. Nothing in it past 80 by 45 has been
  measured, and their rooms wait for a tick timed at their size: this page's
  rate would stand 864 to 1,536.
- More to do in the peace: other activities than shrines and wrecks, bosses
  on large landings, more biomes, landing levels to 99.
- More for the works to build than the shield and the hull.
- Transit meets other things than raiders, and then another streamer's
  city, on the decks and the lost list this slice builds.
- A site for chatters once there is single sign-on: the stash as a page, and
  programs of their own.
