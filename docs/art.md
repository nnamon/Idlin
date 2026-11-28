# Idlin: the art bible

This is the standard every `look` change is drawn to and signed off against.
The art director owns it ([AGENTS.md](../AGENTS.md), section 2) and changes it
by pull request like any other doc.

It is written for the game Idlin is becoming: a machine city that walks the
world on legs, stops at generated landings, and sends its citizens out to
farm and fight before a horde arrives (#331). A citizen is a chatter's
character and carries the chatter's username. Most of what is on screen today
was drawn before this page existed and does not meet it. Section 13 says what
does and what does not.

Sizes are in frame pixels at 1920 by 1080. The viewer watches the stream on a
desktop at that size, and everything here is drawn and lettered to be seen
there. Every check on this page is made on the 1920 frame. A smaller window
shows the same frame scaled down, and nothing is sized for one.

## 1. The look

Idlin is one engraved plate from an expedition's account of a walking city,
tinted by hand and still being drawn. The paper is cream. Everything on it is
laid with one pen in sepia ink, then tinted with a few thin washes that do not
quite meet their outlines. The city is the largest and darkest drawing on the
plate. The citizens are the only strongly coloured things on it. Monsters are
drawn with more black than anything friendly, and when one dies the ink it was
drawn with spills on the ground and stays there. What is lettered on the
plate is plain: usernames, numbers, item names and a few labels, in the same
ink (section 11).

A landing is a hand-drawn adventure map seen from a little above. The ground
is in plan. The city stands in the middle of it on splayed legs with its deck
open to the viewer. Citizens are out in every direction and there is a pack
round every place worth walking to. Late in the landing the horde's black
comes in from the rim and piles up against the city's shield (sections 3, 4
and 7).

The city and its landings grow over the game, and the figure is the measure
of both. As they grow, the same frame holds more tiles and a citizen is
drawn smaller in it (section 7).

Where it comes from, in spirit. None of these is to be copied.

- Engraved atlas and natural-history plates of the seventeenth and eighteenth
  centuries: ground in plan with towns and trees standing in elevation, and
  shade built from hatching.
- The map at the front of an adventure book: places a reader can point at and
  wants to go and see.
- Moebius: a clean contour that carries the form, a small number of flat
  colours, and large quiet areas that make the busy ones read.
- Tove Jansson's ink drawings: night as solid black masses with a little light
  cut out of them, and small figures that are clear at any size.
- The castle in "Howl's Moving Castle": a city as a heap of rooms and chimneys
  that sways when it walks.
- Brush calligraphy: a blow as one stroke that starts wet and ends dry.

## 2. The pen

There is one pen. Citizens, monsters, the city, terrain, effects and
lettering ornaments are all stroked by the same routine, so a figure never
looks pasted onto the map. A shape stroked with a plain canvas `stroke()` at
constant width is roughed in, whatever else is right about it.

### Weights

Four weights, and nothing in between.

| Weight  | Width   | Used for                                                             |
| ------- | ------- | -------------------------------------------------------------------- |
| Heavy   | 5 px    | the city's hull and legs, a boss's contour, the horde's leading edge |
| Contour | 3 px    | the outer silhouette of anything that acts or stands up              |
| Form    | 1.5 px  | structure inside a silhouette: folds, planks, joints, a face         |
| Hair    | 0.75 px | hatching and texture, which read as tone                             |

- Anything a viewer must see at a glance is a contour, a heavy line or a
  filled shape. Form and hair lines may only add to a drawing that already
  reads without them.
- Line width is set in screen pixels. It does not scale with the camera. When
  the view zooms out, drawings get smaller and their lines stay the same
  weight, so detail has to be dropped (section 5), never thinned.
- Bigger and more dangerous things get heavier lines. Nothing friendly is
  drawn heavier than the city.

### How a stroke is laid

- A stroke has pressure: it enters thin, swells to its weight within the first
  fifth of its length and leaves in a flick. It is drawn as a filled ribbon,
  not a constant-width path.
- It wobbles by at most 0.6 of its own width. The wobble is seeded by what is
  being drawn (its id, its tile), so a thing standing still is drawn the same
  way every frame. Lines do not shimmer.
- A contour is closed with a small overshoot or gap at one corner, as a hand
  leaves it. It is not a mathematically closed path.
- Curves are drawn as curves. No run of straight segments where a bank, a
  back or a blade should bend, and nothing that follows the tile grid in
  steps.

### Fills

Three, and no others.

- **Wash.** A flat, transparent tint with a hard dried edge. It is offset
  from its contour by 2 to 3 px down and to the right, so a sliver of paper
  shows on the lit side and the tint runs slightly past the line on the other.
  Its lower right edge is one step darker, where the water pooled. No radial
  gradients and no soft airbrushed edges.
- **Spot black.** Solid ink: the shade side of the city, the mass of a wood at
  night, a boss's mane, the horde. It is what gives a frame its darkest values,
  so it is spent on purpose (section 3).
- **Paper.** Left blank. Faces, highlights, the lit side of things, open
  ground.

### Hatching and texture

- Shade is hatched in one direction over the whole plate: strokes fall from
  upper right to lower left at about 60 degrees. By day the light comes from
  the upper left, so shade sits on the lower right of everything. At night
  shade sits on the side away from the city's lantern.
- Three tones only: open (strokes 6 px apart), close (3 px), and crossed (a
  second set at right angles). Crossed hatching is kept for the city's
  underside, elites and bosses.
- Hatching follows form on anything round: it bends with a trunk or a hull.
- The red-brown hatch (`#9c3b22`) means "a blow lands here" and nothing else.
- Paper grain is made of fibres and blotches at least 6 px across. No
  per-pixel speckle: it reads as noise.
- Ground marks (grass, stones, reeds) are drawn in clumps with bare paper
  between them. Nothing repeats on an even pitch.

## 3. Palette

A frame is paper, ink, at most three ground washes and one accent, plus the
citizens' own colours.

### Standing rules

- **Citizens own saturated colour.** Cloak and hat colours are the only fills
  above 45% saturation on the plate, with two exceptions: lamp flame and loot.
  Terrain washes stay under 35%, monster washes under 20%.
- **Monsters own black.** Rank for rank a monster carries more spot black and
  closer hatching than a citizen. A viewer tells the sides apart by colour
  against black before reading any shape. A monster takes its black as it
  wakes: one at rest is drawn pale (section 6).
- **The darkest tenth.** Squint at a 1920 frame in greyscale. The darkest
  shapes should be, in order of area: the city, the horde or the monsters
  that are awake, then lettering. If a bar, a border, a river, a route line
  or a pack at rest is among them, the frame is wrong.
- **Contrast.** A contour against the ground under it: at least 7:1. Lettering
  that carries information: at least 4.5:1, and never under 3:1 while a
  palette is changing. A name tag at rest is the one exception: it is set at
  60% ink (section 11) and holds at least 3:1 on every paper, the sky's cast
  included. That is 3.75:1 on the day paper, about 3.4:1 on the fen's and
  4.7:1 on the night paper. A wash never brings ink on it below 7:1.
- **One accent a phase**, used on less than 2% of the frame. A wash or halo
  of the accent counts at its strength: a 35% wash over 1,000 px² counts as
  350. The shield may take it to 5% during the siege (section 7).
- Water is a ground wash like any other. It is never the most saturated or
  the largest flat colour in a frame.

### The city in transit

Warm wood and lamplight against a cool, pale land going by.

| Role            | Colour    |
| --------------- | --------- |
| paper           | `#f1e6cd` |
| ink             | `#2f2621` |
| timber          | `#c9a36b` |
| canvas and rope | `#e7dcc0` |
| iron and soot   | `#5b5048` |
| brass           | `#d2a24c` |
| oxide strake    | `#a8644a` |
| the land beyond | `#a9b4b0` |
| accent: lamp    | `#f6cf6a` |
| lamp ink        | `#aa8f4e` |

A line in the lamp accent does not hold against paper. So the accent is kept
for fills, and hatching or a ray in the lamp's colour is stroked in lamp
ink, which is the accent mixed 38% toward ink. Lamp ink is about 2.5:1 on
paper, so it is never a contour: an edge in the lamp's colour is drawn in ink.

The land the city walks over is drawn in plan under it, in ink at 40%
strength with the one cool wash. It has no contour weight lines and nothing
on it stands taller than half a tile, so the city always sits in front of it
and nothing going by covers the deck.

### A landing by day

Each biome has a paper tint, three washes and one accent (section 8 lists
them). The city keeps its transit colours wherever it parks, so it is the warm
spot on every map. The sky still lends its colour by the hour (rose at dawn,
amber toward dusk) as a thin cast over the whole plate, at most 25% strong, and
it never lies over spot black.

### Night

Night is drawn in masses. It is not the day drawing with its colours swapped.

| Role                       | Colour    |
| -------------------------- | --------- |
| night paper                | `#1d2742` |
| mass (woods, crags, hulls) | `#111a30` |
| rim and lettering          | `#cfd8ea` |
| lamplight wash             | `#f3d9a0` |
| accent: eyes in the dark   | `#e9c46a` |

- Anything standing is a solid mass a step darker than the night paper, with a
  pale rim only on the side facing the city's lantern. No white outline
  drawings of trees.
- Lamplight is a wash laid in three flat steps with visible edges, like three
  passes of a brush, warm at the centre. Inside the first step the day colours
  show. It is not a smooth radial gradient, and it does not cut a pale disc
  out of the night.
- The city's lantern is the one large light. A citizen's carried light
  reaches about one tile, enough to show its colours and no more. When many
  stand together their lights join into one shape with one edge.
- Monsters in the dark are a mass and two eyes in the accent colour until they
  come into the light.

### The horde

The horde is the landing's clock. A landing has seven phases (#413 sets
their rules and times), and the plate is a different picture in each.

| Phase                | What the plate shows                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Peace             | No black. The map runs to the rule and stops as an unfinished drawing does: in its last two tiles the washes end and the lines trail off into bare paper. Packs are at rest in their pockets.                                         |
| 2. Scouts            | The same map with scouts on it, in ones to threes, coming in from the rim's gaps toward citizens.                                                                                                                                     |
| 3. The front gathers | Black comes in at the gaps and spreads along the rim on every side. It deepens from one tile to four (two on the first size of landing) as the horde gathers, and its depth is how a viewer tells how near the march is.              |
| 4. The march         | The black moves. It takes the ground with the longest walk to the ramp first, on every side at once, so the pale ground shrinks to one shape round the city. The frame closes with it (section 12).                                   |
| 5. The siege         | The horde meets the city's shield (section 7) and throws itself on it. Citizens fight at its foot. This is the late picture: a lit oblong with the city in it, a wall of light on lamp posts round it, and bodies heaped on the wall. |
| 6. The break         | The shield goes all at once, the heap falls inward and the black takes the ground inside. Citizens run for the ramp from every side with the horde two or three tiles behind them.                                                    |
| 7. Lift-off          | The black reaches the hull. The legs lift out of it and the frame closes on the city (section 12).                                                                                                                                    |

- It is spot black on the ground, a tide of ink. It is never a front that
  crosses the plate from one side: it gathers, marches and piles up on every
  side at once, and until it marches no side shows more than half again as
  much black as another.
- **Scouts** are the horde's, and are drawn in its ink: a lean, long-legged
  body in spot black with paper eyes, running low. A scout is black from the
  moment it appears, which is how it is told from a pack at rest
  (section 6). It leaves a dashed track in ink behind it for two tiles.
- **It is bodies wherever it is near anything.** Within three tiles of its
  edge, and wherever it stands against the shield, the horde is drawn as
  whole bodies in spot black, overlapping, each with a paper line along the
  side that faces the city's lantern. From three to eight tiles back it is a
  mass with heads and backs in paper line and eyes in clusters. Beyond that
  it is black with eyes. No stretch of black more than ten tiles across has
  nothing drawn in it.
- **Everything in it is black.** A brute or an elite of the horde carries no
  wash paler than the bodies round it. A grey one in the black is read as a
  boulder. Its shape is the paper line along its lantern side at contour
  weight, its eyes and its teeth, and it stands a head or more above the
  mass (section 6). An elite's sail is the only colour in the black.
- Its edge is one curved line at heavy weight, crowded with heads, backs and
  reaching limbs, uneven along its length. For one to two tiles ahead of the
  edge the ground is hatched in the red-brown of a blow about to land. Ahead
  of that a bruise wash (`#5a2a3a`) lies in two flat steps, 12% then 9%, out
  to about five tiles.
- Inside the black there are eyes and teeth in paper colour, thick near the
  edge and in clusters of five to twelve with black between them, never on
  an even pitch. Backs drawn as a field of arcs at one spacing read as
  scales. Anything over two tiles tall
  that the black has covered still shows the top of its outline as a paper
  line at form weight, so the map can be read under the ink.
- It is the only large black thing on a daytime plate, which is how a viewer
  reads the time at a glance: none, a rim, a closing shape, a pile against
  the shield. The dial in the corner (section 11) says the same in numbers.
- Lettering that lies over the black is set in paper colour with no halo. A
  name tag there keeps its rule in the cloak colour, and a tag at rest is
  set in paper at 60%.
- Citizens at the shield and running in keep their full colours. From the
  march on the city's lantern is at the accent at full strength.

## 4. Staging and the lean

### Freedom

A landing is a map to explore, with the city in the middle of it. Nothing on
it is staged as two sides facing each other across a line, and no frame has
the city at one end and the enemy at the other.

- **The city stands inside the map.** Its hull is in the middle third of the
  frame both ways, with at least six tiles of walkable ground beyond its
  planted feet on every side on the first size of landing, and ten on every
  other (section 7 has the sizes).
- **The ramp comes down on any side.** The generator picks the side. No
  drawing assumes one.
- **Pockets lie on every side** (section 8), each with something to take and
  a pack that holds it.
- **Citizens go out in every direction**, in ones to fours when 15 are awake
  and in groups of up to eight when 150 are. No pocket holds more than a
  third of the citizens who are out. Nobody stands in a rank or a file, and
  no group faces one way in a line.
- **Several fights at once.** With 15 awake, at least four places are being
  fought over or worked at any moment of the expedition, on at least three
  sides of the city. With 150, at least twelve.
- **Blows go every way.** Swings, shots, knockback and thrown ink are drawn
  in the direction the simulation gives them, which is one of eight. A figure
  or a beast faces left or right, toward what it is after. A blow up or down
  the plate is told by its arc, by the lean of the spine and by where the
  target goes.
- **The horde is the clock** (section 3). It closes from the rim on every
  side. It is never the enemy line.
- **The shield is held in the round.** In the siege citizens fight at the
  shield's foot in ones to fives, on at least three sides of the city, with
  three tiles or more between one group and the next. No group stands in a
  row, and the groups never join into a line round the shield. Which side
  of the foot they stand on is the simulation's rule
  ([slice.md](slice.md), section 1).
- **The halves test.** Cut the frame in half through the city, across and
  then down. Each half has citizens, monsters and something to take. If one
  half is ours and the other is theirs, the frame is staged wrong.

### The lean

The map is drawn as a hand-drawn adventure map is: the ground in plan, and
everything on it standing up and tipped back a little, as if seen from the
south and above. There is no projection: no diamond, no vanishing point, no
grid turned on its corner. The ground keeps the frame's 16:9 shape and north
is up.

- **Ground is plan.** A tile is as wide on screen as it is deep. Rivers,
  paths, washes and the black are drawn in plan.
- **Up is 1.4.** Height is drawn at 1.4 times the plan scale: a thing one
  tile high stands 1.4 tile-widths up the plate from its foot. Trees, den
  mounds, masts and the city's legs get their height from this. Figures and
  beasts are not stretched to it. They are drawn in their own proportions at
  the sizes sections 5 and 6 give.
- **Back is 0.8.** A flat shape lying on the ground or on top of something is
  drawn at 0.8 of its depth: a den's rim, a foot plate, a shadow, the ring of
  a telegraph, a firepot's burn, the top of a mound, the city's deck.
- **Wide things show their top.** Anything wider than two tiles shows its top
  face above its front. A den is a mound with grass on top and a mouth in its
  face. A crag has a flat. A chest has a lid. The city has a deck.
- **Shadows fall to the lower right.** Everything that stands throws one
  shadow: a flat, hard-edged wash of `#4a4038` at 24%, about a quarter as
  long as the thing is tall. A wood or a crag throws its shadow at 18%. The
  city's is at 28% with open hatching over it. No blur.

The lean is the same for every thing on the plate and does not change with
the camera.

### What comes forward

A landing holds hundreds of monsters, and a viewer has to find the few
places where something is happening. So a landing is drawn in three planes
of value, and a thing changes plane when it wakes.

- **The map sits back.** Ground, terrain, paths, places nobody is at, and
  every monster at rest (section 6). Nothing here is spot black but a den's
  mouth, and a monster's line here is at 45% ink.
- **The city stands.** It is at full strength in every phase.
- **A fight comes forward.** Citizens in their colours, the monsters they
  have woken in full ink with their black, strokes, shots, thrown bodies,
  spilt ink and numbers. On a daytime plate before the horde moves, these
  and the city are the only dark things.
- **Every fight has a focus.** A fight is a citizen or a group and what it
  is fighting, within four tiles. At any moment one mark in it is the
  largest, and the eye lands there first. In order: a rare's or a unique's
  pole going up, an elite's telegraph, the fight's largest number, the
  longest stroke. Section 10 has their sizes. A fight where every mark is
  the same size is a blot.
- **The frame has a lead.** One fight in frame carries the frame's largest
  mark: the one number at 48 px, or a unique's pole and slip. Every other
  fight is a size below it.
- **Quiet ground.** At least a third of a landing's ground carries nothing
  but ground marks, in stretches four tiles wide or more. Paths run through
  them. A map where packs stand at an even spacing from edge to edge has no
  pockets and no fights that can be found.
- **The check.** Put a peace-phase frame in greyscale and squint at it.
  The dark knots are the city and the fights, and they can be counted. If
  the dark is spread evenly over the map, the frame is wrong.

### Depth and cover

- Things lower on the plate are in front. Everything that stands is sorted
  by its feet. The city's far legs are drawn before its hull and its near
  legs after everything aboard.
- A citizen is never hidden. Where the hull, a leg, a post, a tree, a mound
  or another body is drawn over its head, or over more than a third of its
  figure, the citizen is drawn again on top as an outline at contour weight
  in its cloak colour, with its cloak and its head in paper and its hat in
  its own colour. Monsters get no outline. A pack half behind a wood is how
  an ambush reads.
- A swarm is one drawing. Where a citizen stands among it, the swarm is
  sorted at its rearmost body, so all of it is drawn behind that citizen.
- In a press of the horde no body is drawn over a citizen's head, or over
  more than a third of its figure. A citizen fighting at the shield has
  half a tile of open ground on the side toward the viewer.
- The shield's wall is sorted behind everything that stands (section 7).
- A figure may cover up to a third of its neighbour. At 1920 no citizen's
  head or hat is covered by another citizen.
- A thing in the air is drawn above its shadow, and the gap between the two
  is its height.

## 5. Figures

A citizen is drawn from the same construction at every size, with more of it
shown the larger it is.

### Construction

- Three heads tall. The head is a paper disc with a contour; it is the mark
  that says "a person" and is never smaller than 9 px across.
- The body is a cloak hung from a spine. The spine is a curve from the feet
  to the neck, and the pose bends it: upright standing, tipped 10 degrees
  into a walk and 20 into a run, coiled back before a blow, thrown forward
  after it. The cloak is drawn round the spine, and its hem trails behind the
  body's movement.
- Two arms, each one stroke from the shoulder ending in a mitten. The tool is
  held in the near hand and moves with it. A figure with no arms cannot swing,
  shoot, carry or point, and those are most of what the game shows.
- Two legs with feet: a short tick at the end of each, pointing the way it
  faces.
- The hat sits on the head and leans with it. Its shape, height and bands are
  the existing system (`looks.ts`): shape by id, height by total level, bands
  at 20, 50, 100 and 200.
- The cloak takes a wash in its colour, offset as any wash is, and a band of
  close hatching down its shade side.

### Three sizes

Height is from the feet to the top of the head. The hat stands above that.

| Size | Where                                                                                                  | Height at 1920 | What is drawn                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Far  | a landing of the mid city's size or larger; the widened transit frame with over 40 aboard              | 40 to 50 px    | contour, cloak colour, hat colour and shape, head, the weapon's silhouette, legs as two ticks, arms only while they are doing something |
| Mid  | a landing of the first two sizes; the siege; the deck when full; the widened frame, 40 aboard or fewer | 54 to 80 px    | adds feet, the eye, the shade band, cloak pattern, both arms                                                                            |
| Near | the deck in ordinary transit with 40 aboard or fewer                                                   | 96 to 120 px   | adds form lines, the mark on the cloak, death patches, kit detail, an expression                                                        |

- **A citizen's height comes from the camera**, in every scene. Between two
  columns it is on the straight line between them, and past the last it
  stays at 120 px.

  | Px a tile       | 14  | 17  | 23  | 31  | 47  | 66  | 100 |
  | --------------- | --- | --- | --- | --- | --- | --- | --- |
  | Citizen, px     | 40  | 42  | 46  | 58  | 76  | 96  | 120 |
  | The same, tiles | 2.9 | 2.5 | 2.0 | 1.9 | 1.6 | 1.5 | 1.2 |

  Up to 120 px a tile a citizen is drawn larger than its tile, and more so
  the more tiles the frame holds. It is a figure standing on a map, as the
  lean has it
  (section 4). The one exception is a full deck in transit: with over 40
  aboard a citizen is 0.85 of a tile tall, 40 px at least and 76 px at
  most.
- A citizen is never under 40 px at 1920, and never over three tiles tall. A
  landing too wide for both is not drawn smaller; the generator makes it of
  fewer tiles. That puts the widest landing at about 136 tiles.
- At far size a figure is at most six shapes. Pattern, mark and patches are
  not drawn smaller; they are left out.
- A viewer finds their own citizen on a landing by its name tag, or by
  calling it when the crowd is too thick for every name (section 11), then
  by cloak colour and hat colour and shape.
- A change of size during a zoom adds or drops whole parts, each fading over
  the part of the move where the figure is between two sizes. Lines never
  thin.

### Poses

Every state the simulation has gets a pose that reads in silhouette: standing,
walking, running, carrying (the bundle on the back grows with the haul),
gathering by trade, each kind of blow in its three beats (section 9), shooting,
hurt, downed, sitting, sleeping, and crewing a station aboard. A state shown
only by a label, a ring or a number is roughed in.

### Crowds

- No two neighbours stand in the same pose facing the same way. Idle phase,
  facing and lean are offset by id.
- A crowd is never drawn as a grid. Where the simulation puts citizens on
  adjacent tiles, they are drawn off-centre on their tiles and overlapped by
  up to a third, sorted by their feet.
- In a crowd of thirty or more at far size, contour weight is kept only on
  the outline of each figure against the ground or a different colour; where
  two cloaks of like colour overlap, the line between them is form weight.

## 6. Monsters

Rank is the first thing a monster's drawing says. The ranks are the
simulation's: fodder, pack, brute, elite, boss.

| Rank   | Height against a citizen | Line             | Tone                                    | Other                                                                            |
| ------ | ------------------------ | ---------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| Fodder | a half or less           | contour only     | one grey wash                           | drawn as a swarm: overlapping bodies share one outline, with many heads and legs |
| Pack   | about the same           | contour and form | wash and open hatching                  | each drawn singly, in three or more variants of pose and build                   |
| Brute  | one and a half           | contour and form | close hatching, one area of spot black  | at least twice a citizen's width at the shoulder, standing on legs (see below)   |
| Elite  | one and a half to two    | contour and form | crossed hatching, spot black, an accent | one feature no lesser monster of its kind has: a crest, a banner, a broken horn  |
| Boss   | three or more            | heavy contour    | crossed hatching and large spot black   | its level lettered beside it; a solid ground shadow; stands on 2 tiles or more   |

- Each kind passes the silhouette test: filled solid black at 12 px tall, it
  can be told from every other kind and from a citizen. A brute and an
  elite can also be told from a den, a crag, a scrap heap and a standing
  stone.
- Monsters are drawn in the same manner as each other and as the citizens:
  side or three-quarter view, facing what they are after. No kind is drawn
  front-on like a mascot.
- Washes are greys and earths. Colour on a monster is one accent on an elite
  or boss.
- A monster's drawing shows its intent: stalking is low with the head down,
  winding up is a coil away from the target, fleeing is stretched out.
- A wounded monster loses ink: its hatching thins and breaks as its hitpoints
  go, so a nearly dead one is visibly lighter. No ring or bar is needed for
  that.

### At rest, alert and awake

A monster's ink says how awake it is. This is what lets a map of 600
monsters show where the fights are (section 4).

| State   | When                                                             | Line                                              | Fill                         | Black                 |
| ------- | ---------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- | --------------------- |
| At rest | no citizen within ten tiles                                      | 45% ink; form weight for fodder and pack monsters | its wash at half strength    | none, and no hatching |
| Alert   | a citizen within ten tiles; heads have turned                    | 70% ink at its rank's weight                      | its wash, with open hatching | the eyes only         |
| Awake   | stalking, fighting, or struck in the last two seconds; the horde | full ink at its rank's weight                     | its rank's wash and hatching | its rank's spot black |

- A swarm at rest is one pale shape: one shared outline, one wash, heads as
  dots. It keeps to its post, three tiles across, with its bodies
  overlapped by a third to a half.
- One of every pack at rest is its sentinel, drawn alert, so each pack
  shows one darker head.
- A monster wakes in 0.3 s, darkest parts first: the black, then the
  hatching, then the line. Going back to rest takes two seconds.
- A leader is a head taller than its pack and has a notched ridge down its
  back in ink. It carries no colour. The accent is an elite's alone.
- The horde's monsters, scouts included, are awake from the moment they
  appear.

### Brutes and places

A brute and a den are both grey shapes a few tiles wide, and a brute drawn
as a slab with a dark cap is read as a den or a standing stone. These keep
them apart.

- **A brute stands on legs.** Ground and its own shadow show under its
  belly, between forelimbs that reach the ground. A den, a crag and a heap
  sit on the ground with nothing under them.
- **It is widest at the shoulder** and narrower at the feet. A mound is
  widest at its foot.
- **It is taller than it is wide**, or as tall. A den is no taller than
  two thirds of its width.
- **Its head is carried forward of its body**, low, with a jaw and two eyes
  that show against the ground. It is never drawn square-on, and its spine
  leans 15 degrees or more.
- **Its black is on top**: the mane and the forearms. It has no round or
  arched black shape inside its outline. An arch of black with eyes in it
  is a den's mouth and nothing else.
- **It has company.** A brute leads a pack or has fodder at its feet, and
  they lie round what it guards. A den has a letter and a level under its
  mouth (section 11), an earth wash and growth on top. A brute has grey
  and nothing lettered.
- **No part of it is a slab.** Its forelimbs are longer than its hind legs
  and it walks on its knuckles. A forelimb bends at the elbow and narrows
  from the shoulder to the wrist by half, with the fist wider again. Its
  underside is not a flat line: the belly is a fifth of its height off the
  ground between the limbs, and what is behind it shows through the gap.
- **It rears to strike.** Winding up, its hind legs stay planted, its spine
  tips back to 50 degrees or more and both forelimbs come up over its head,
  bent. One limb held straight up beside the body is read as a standing
  stone.
- **Its teeth are a row** of four to six along an open lower jaw, in paper.
  Two tusks standing up from a flat face are read as the corners of a
  block.
- **It is never square.** Standing, one forelimb is off the ground or it is
  turned in mid-stride. In the horde it is drawn in the horde's black
  (section 3).

### An elite's crest

A crest drawn as a row of separate points in red-brown is read as a row of
flames. Flames on this plate are the lamps' and the firepot's.

- **It is one shape:** a sail down the spine from the skull to the hips,
  tallest over the shoulder at a quarter of the body's height, and two and
  a half times as long as it is tall or longer.
- Its top edge is ragged, with three to five notches cut no deeper than a
  third of the sail. It is raked back 25 degrees from the head. Nothing on
  it points straight up.
- It is a flat red-brown wash (`#9c3b22`) inside an ink contour, with four
  to six ribs in ink at form weight running from the spine to the edge. It
  has no highlight, and it does not flicker or change shape while the
  elite stands.
- A banner or a broken horn, where a kind has one in its place, is likewise
  one shape and joined to the body's outline.

### Packs and swarms

A landing is full of monsters, and they are in groups.

- **Fodder is a swarm** of 10 to 50, drawn as one crawling shape wider than
  the citizen it is after. It flows round what is in its way and closes as
  one mass.
- **Pack monsters come in packs** of three to six with a leader a head
  taller than the rest. A brute has fodder round its feet. A den's elite has
  its pack at the mouth.
- **Two packs never touch.** There are two tiles or more of open ground
  between one pack at rest and the next.
- **Every pocket has its pack** (section 8), and more packs walk the ground
  between pockets. On a landing with everyone out, a viewer sees monsters
  on every side of the city before seeing any single one.
- **A monster looks like a threat.** One that is not fighting is doing
  something a viewer reads as intent: a pack asleep in a heap with one
  awake, a pack pacing its ground or gnawing at a kill, a swarm boiling
  round its nest. When a citizen comes within ten tiles, heads turn to it.
  Within six the pack is stalking: low, facing it, closing. No monster
  stands idle facing nothing, and no two of a pack share a pose.

### The raider rig

In transit the raiders come alongside on a machine of their own, and the
frame widens to hold it (section 12). It is the monsters' machine and is
drawn as theirs. The brief on #445 has the drawing in full.

- **It rolls.** It is a train of low wagons on solid wheels behind a
  horned, armoured head. Nothing on it walks, and it has no mast and no
  lamp. Filled black at 12 px tall it is a low bar on discs, with horns
  at one end and a tower standing on it for each line. It cannot be taken
  for the city, or for another city.
- **It is low and narrow.** A bed is under a tile off the ground and
  under four tiles wide, and its wheels stand close against it. So it
  runs about two tiles outside the city's near feet, and that is what
  lets the widened frame stay at 50 px a tile.
- **Grey and black.** Plate and hide take iron and soot (`#5b5048`) at
  40% or under, patched, with seams at form weight. A near side is spot
  black for its whole depth, with a paper line along the rim. Bone, horn
  and rope are the canvas colour (`#e7dcc0`). It has no timber, brass,
  oxide or flame of its own. The colour on it is a captain's sail (An
  elite's crest, above) and the crates it has taken, which keep the
  city's timber, so a viewer sees on the rig what the city has lost.
- **A tower for each line.** A tower stands on the far side of its
  wagon, the side toward the city, and its head is higher than the city's
  rail. Its face toward the city is hung with hide. Its near face is
  open, with the ladder the boarders climb. The line leaves from its
  head. A wagon carries one tower when there are three lines and two when
  there are more.
- **A line is a rope**, 9 px wide: the canvas colour between two lines
  at contour weight, with twist marks at form weight. So it holds over
  the hull's near side and over paper alike. Lines fan out and never
  cross.
- **Its crew is awake** from the sighting: full ink and their rank's
  black. Up to about forty on its beds are drawn singly, in knots at the
  towers' feet. A larger crew is a press, drawn as the horde's is
  (section 3). A boarder over the hull's near side, its shadow or a
  tower's hide has a paper line along its back.
- **No two wagons are one drawing.** Each has its own build of bed and
  its own wheels, and each yaws a few degrees on its coupling as it
  rolls, so the train is never a ruled line. Its track is two bands of
  churned ground, broken and wandering. It is never a pair of rails.
- **The fight is aboard the city, in the round** (section 4). Boarders
  get inboard. With 15 aboard citizens fight them in ones to threes, at
  four places or more. With 150 they fight in groups of up to eight, at
  twelve places or more. Nobody stands in a row along the rail. The
  longest strokes and the largest number in the frame are at those
  fights (section 10), so the first glance lands there.

## 7. The city

The city is the main character and is on screen in every frame. It gets the
most drawing time of anything in the game.

### Build

The city is one machine, drawn one way at every scale: from the south and
above, by the lean of section 4, with its deck open to the viewer. It is not
drawn side-on in any frame. The close-up in transit and the city on a landing
are the same drawing at two sizes.

The numbers in this list are the mid-sized city's, which is the one the
slice draws. Growth, below, has the other sizes.

- **Hull.** Long and plated, pointed at the prow and blunt at the stern, 15
  tiles by 6. Its near side shows below the deck's rim: riveted plate in
  heavy contour with close hatching, a strake of oxide red (`#a8644a`) under
  the rim, and spot black where the plate turns under. With its shadow it is
  the darkest large shape on a daytime plate until the horde moves.
- **Deck.** Planked, drawn at 0.8 of its depth, with the districts on it as
  rooms that have no roofs. A room's far wall stands up, with what hangs on
  it drawn in elevation. Its side walls are low and its near wall is a sill.
  Nothing a citizen can stand under is roofed. An awning is a frame of lines.
- **Legs.** Eight, four a side, splayed. Each rises from a hip under the rim
  to a brass-pinned knee above the deck and comes down to a foot plate about
  seven tiles across from the hull's middle line and up to ten and a half
  along from its middle. Near-side legs are in heavy contour and
  cross in front of the deck's edge. Far-side legs are in contour weight
  with a 55% wash and are drawn before the hull, so the pairs separate. A
  foot plate lies on the ground at 0.8 with its own shadow. A leg is drawn
  as machinery: plate seams, rivets, a piston at the knee, and hatching
  down its shade side. In transit the knees are the part of a leg that is
  in frame (section 12), so the knee carries the most drawing.
- **The lantern mast.** It stands three and a half tiles high from the middle
  of the deck and its head is the highest thing on the plate, with the
  lantern there, a crow's nest below it and stays to the deck's corners in
  hair weight. It is the
  anchor of the zoom (section 12) and the source of light at night.
- **The rail.** It runs round the deck, with gun posts fore and aft. This is
  where citizens fight in transit. Gun posts and mounted weapons are drawn
  large enough to read at mid size. The shield's posts ride in a rack along
  the hull's near side under the rim, so a shield level the works have
  built is seen aboard before the next landing.
- **The ramp.** Timber, three tiles wide. It comes down through a gap in the
  rail to the ground on whichever side the landing puts it. Stowed, it is
  folded up against the rail.
- **The outline.** From above it is not a clean boat. The stack, chimneys, a
  crane, awning frames, stores and lines break it, and the two ends differ.

### On a landing

- The city stands inside the map (section 4) with its legs planted wide.
  With them it covers about 20 tiles by 14. The ground under the hull and
  between the feet is still map: citizens walk out between the legs.
- Its hull is between a quarter and a seventh of the frame's width, by the
  city's size (Growth, below).
- Parked, the belly is half a tile off the ground. Its shadow under the hull
  is what lifts it off the map.
- Citizens aboard stand on the open deck at the landing's figure size, and
  are named as section 11 has it. Whether anyone aboard may shoot on a
  landing is [slice.md](slice.md)'s rule. Where they may, they shoot from
  the rail outward in any direction.
- A citizen behind the hull or a leg is drawn as an outline (section 4).

### Districts

Each district aboard is told apart by three things and no label is needed:
a far wall whose outline no other district has, one wash from the transit
palette on its floor, and one part that moves (a bellows, a steaming pot, a
turning crane, swinging hammocks). A district that is only a labelled box is
roughed in.

### Upgrades

An upgrade always adds or replaces something drawn. It is never only a
recolour, a number or a badge.

- Size upgrades add structure: another deck plate, a longer leg segment, a
  taller mast, another chimney.
- Quality shows in a fixed order of materials, so a glance ranks any part:
  bare timber and rope, then iron banding and rivets, then brass fittings and
  pennants, then carved and painted work.
- Damage and upkeep show the same way in reverse: missing planks, patched
  plate, a leg that drags, soot.
- A shield level adds two posts to the shield, and every third level
  rebuilds them all in the next material (The shield, below).

### Growth

The city grows over many hours of play and its landings grow with it. The
frame does not grow, so growth is read from the figure: a bigger city is
drawn at about the same width on a landing, is built of more parts, and has
smaller citizens on it and more ground round it.

These are the steps to draw toward. #413 fixes how many sizes there are and
their tile counts; where its table differs, the columns here follow from it
by the rules under the table. The slice draws the mid row. The last two
rows are limits. Nothing is built to them before a still mockup of each, at
1920, has been looked at.

| Step    | Hull, tiles | Legs | Planted, tiles | Landing, tiles | Px a tile, landed | Citizen, landed | Hull, of the frame's width | City, of the map | Px a tile, transit |
| ------- | ----------- | ---: | -------------- | -------------- | ----------------: | --------------: | -------------------------: | ---------------: | -----------------: |
| First   | 10 by 4     |    6 | 14 by 9        | 40 by 22       |                47 |           76 px |                        25% |              14% |                150 |
| Second  | 12 by 5     |    6 | 16 by 12       | 60 by 33       |                31 |           58 px |                        20% |              10% |                125 |
| Mid     | 15 by 6     |    8 | 20 by 14       | 80 by 45       |                23 |           46 px |                        18% |               8% |                100 |
| Late    | 18 by 7     |   10 | 25 by 16       | 108 by 60      |                17 |           42 px |                        16% |               6% |                 83 |
| Largest | 21 by 8     |   12 | 29 by 19       | 136 by 76      |                14 |           40 px |                        15% |               5% |                 71 |

- **The whole landing is in frame** from the reveal until the march
  (section 12), so the landed camera is 1880 px over the landing's width, or
  1040 over its height if that is less.
- **In transit** the hull is about 1,500 px long whatever the city's size,
  four fifths of the picture's width, and the legs run out of the frame
  (section 12). A citizen's height comes from the camera at both ends
  (section 5).
- **The city's share of the map falls** as both grow, from about a seventh
  to about a twentieth, and its hull from a quarter of the frame's width to
  a seventh. It does not fall further: under a seventh the deck's rooms
  cannot be told apart on a landing.
- **A deck holds two citizens a tile** at most: 80, 120, 180, 252 and 336
  on the five hulls. A roster larger than that needs the next hull.
- **Each step is a different drawing**, and between steps upgrades add its
  parts one at a time, so the city is never redrawn whole between two
  landings.

| Step    | Mast, tiles            | What the drawing has                                                                                              |
| ------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| First   | 2.5                    | Timber and rope. Engine, open deck with the bench, galley, wheel. One gun post at the prow.                       |
| Second  | 3                      | Iron banding. Adds the forge and the bunks, and a gun post aft.                                                   |
| Mid     | 3.5                    | Brass fittings. Engine room, forge, bunks, open deck, galley, chart room, wheelhouse, two gun posts, crow's nest. |
| Late    | 4.5, and a lesser mast | A deck raised one step (0.8 of a tile) at the stern, a second stack, gun posts along both sides.                  |
| Largest | 5.5, and two lesser    | Raised decks fore and aft, carved and painted work, pennants on the stays.                                        |

A raised deck has no roof and is set back from the rail, so the deck below
shows on its near side. A citizen behind its step is drawn as an outline
(section 4).

Places and monsters keep their size against a citizen at every step, so
they are given in citizens (sections 6 and 8). Lettering and line weights
are in pixels and do not change. Effects are sized against a citizen
(section 10).

### The shield

The city has a shield, and the horde has to break it before it can reach
the hull. The simulation gives its foot, its level and its strength
([slice.md](slice.md), section 1). It is drawn as a dome of light standing
on lamp posts. The posts are what the city has built, the lamps show which
stretches of it still hold well, and the dome is what the horde throws
itself on. It is drawn with the pen like everything else: hatching and
flat wash, no glow and no blur.

- **It is one shield.** It has one pool of strength, and the whole dome
  goes at once when the pool runs out. Nothing gets through it before
  that, on any side. So no stretch of it is ever drawn open, torn away or
  missing: a gap on screen would read as a way in that the horde is not
  using.
- **Its foot** is one closed curve on the ground round the city, drawn in
  plan through the tiles the simulation gives, with bends no tighter than
  two tiles. The planted feet and the ramp's foot are inside it. It is a
  heavy line in ink with a band 6 px wide along its inner side, so it
  holds against pale ground and against the black. The band is the lamp
  accent on a lit post's arc and the unlit wash on a dark post's (The
  wall, below). The ink line stays closed until the break.
- **Its posts.** Lamp posts stand on the foot at even spacing by its
  length, with the way out from the ramp's foot passing midway between two
  of them. A shield has ten before any upgrade and two more for each level
  the works have built, to thirty at level 10. They are the city's work and
  are drawn in its colours (section 3), each with a paper line down its
  lantern side. No post is drawn in black or in ink alone, lit or dark.

  | Shield level | Posts      | Built of                                 | Height, to the lamp | The lamp                  |
  | ------------ | ---------- | ---------------------------------------- | ------------------- | ------------------------- |
  | 0 to 2       | 10, 12, 14 | timber and rope                          | 1.25 citizens       | an open flame in a cup    |
  | 3 to 5       | 16, 18, 20 | timber with iron bands                   | 1.5                 | a caged lamp              |
  | 6 to 8       | 22, 24, 26 | brass fittings, a pennant under the lamp | 1.75                | a glass lantern           |
  | 9 and 10     | 28, 30     | carved and painted                       | 2                   | a lantern with two flames |

  A shaft is 8 px wide at contour weight. A lamp is a disc of the accent
  14 px across in an ink ring. Lit, it has one flat halo of the accent at
  30%, 40 px across, with a hard edge.
- **A lamp for each arc.** Each post holds the stretch of the foot nearest
  it, its arc, and its lamp is lit while the post is sound. Blows on an
  arc wear its post down, and when the post gives out its lamp goes dark.
  It is not relit during a siege. A blow on a dark post's arc takes three
  times as much from the pool as one on a lit post's
  ([slice.md](slice.md), section 1). Posts
  go dark on the sides where nobody is fighting the horde off, so where
  some sides are held dark posts come in runs and a viewer sees which
  side is going. The shield can break with lamps still lit. No bar, and no number on the map: the count
  is in the corner (section 11).
- **A dark post** keeps its wash and loses its flame. It leans up to 20
  degrees toward the city and smokes: two loops at contour weight, in paper
  colour where they lie over the black. With a quarter of the lamps or
  fewer lit, one dark post in three is snapped at half its height.
- **The wall.** The dome's skin stands on every arc until the break, at
  the same height whether its post is lit or dark. On the far side it
  stands from the foot to a quarter of a post above the lamps. Toward the
  two ends it narrows to nothing. On the near side it is a strip half a
  tile deep lying on the ground outside the foot, so nothing of it stands
  between a citizen and the viewer.
  - **On a lit post's arc** it is a wash of the accent at 35%, with open
    hatching in lamp ink that leans in toward the lantern and a top edge
    at contour weight in ink.
  - **On a dark post's arc** it stands unlit and cracked. The wash is iron
    and soot (`#5b5048`) at 40%, the hatching is in ink, the top edge is
    ragged, and its cracks stay (A blow on it, below). It is not torn
    down and nothing shows through it.
  - **The strip and the foot's band follow their arc:** the accent where
    the post is lit, the unlit wash with ink hatching where it is dark.
    At the ends and on the near side there is no standing wall, so this
    is what tells a lit stretch from a dark one there.
  - The change from lit to unlit falls midway between two posts, as a
    hard edge.
- **The crown is not drawn.** Nothing of the wall lies over the hull, the
  deck, the mast or the ground inside the foot.
- **The wall is a backdrop.** It is drawn after the ground and the black
  and before everything that stands, on every side. The horde on it is
  black on gold where it is lit, and a citizen beyond the far wall keeps
  its full colours. Nothing is seen through it.
- **A blow on it** is a contact burst in the accent at that place, a
  citizen's height across and thrown inward, and a crack: a jagged line in
  ink at form weight that runs up the wall from the place. Each blow there
  adds a third of the wall's height to it, and it stays until the break,
  through its post going dark. Cracks are on the standing wall only. On
  the near side's strip, and where the wall has narrowed to nothing, a
  blow is the burst alone.
- **Before the march** the posts stand unlit and are drawn at rest, as a
  pack is (section 6): line at 45% ink and wash at half strength. The foot
  and the wall are not drawn. When the march starts the lamps light in a
  run round the foot both ways from the ramp's side, a tenth of a second a
  post, the foot is inked behind the run and the wall is hatched up from it
  over half a second. So a viewer sees the shield come up as the horde
  starts to walk.
- **Inside it** the ground keeps its day colours under lamplight's three
  flat steps (section 3), centred on the lantern. This is the lightest
  large shape on the plate during the siege. It takes no wash of the accent:
  a lit disc in the accent takes the colour from the
  citizens standing on it.
- **The heap on it.** Where the horde is striking, its bodies are on the
  wall (section 3). On the far side and at the two ends the heap climbs as
  high as the lamps and leans in over the wall's top, which with the wall
  is what makes the shield read as a bubble. On the near side it stays
  under one tile, so no citizen there is covered. Ground the simulation
  leaves between the foot and the black is drawn trodden: the ground wash
  greyed by a third, with no ground marks.
- **The break.** The pool runs out. In that frame every lamp still lit
  goes out, and the wall and the foot, lit and unlit, break into drops
  along their whole length and the drops fall inward. The posts go down
  inward in a run both ways round from the ramp's side, in 0.6 seconds.
  The heap falls inward as one held drawing and the black
  follows it across the foot. Nothing of the shield is drawn after that.

### Movement

- A step takes 1.5 to 2 seconds a leg. The foot lifts, reaches, plants, and
  the hull dips toward the leg that is in the air and rises as it plants.
- A planted foot stays on its ground while the land slides under the hull.
  Feet do not slide. Walking, the belly rides 0.9 tile off the ground, 0.4
  higher than parked.
- Hung things lag the hull: lamps, washing, hammocks and pennants swing after
  each step and settle before the next.
- A footfall is a ring of ink strokes and a puff of dust at the foot. The
  hull moves a few pixels. The camera does not shake.
- Parking, the hull settles between its knees over about two seconds. Parked,
  its chimneys keep smoking and its hung things keep swaying. It is never a
  still image.

## 8. Terrain and biomes

Landings are generated, so these are rules for a generator's drawing, with a
first set of biomes.

### Rules

- **A landing is pockets.** Woods, crags and the river divide the ground
  into pockets, with gaps, fords and worn paths between them. Each pocket
  has one thing to take that can be seen from the city (a den, a chest, a
  heap of scrap, a seam, a wreck) and a pack that holds it (section 6). A
  landing has about one pocket for every 140 tiles besides the city's own
  ground, on every side of it: 6 on a landing of 40 by 22, 14 on 60 by 33
  and 26 on 80 by 45. A pocket with nothing in it is a mistake unless it is
  only a way through.
- **A pocket has edges a viewer can see.** Each is bounded on two sides or
  more by a wood, a crag, the river or the map's edge, and a viewer can
  point to where one pocket stops and the next starts. Packs spread over
  open ground with no masses between them are not pockets.
- **Places stand out from scenery.** What can be taken or fought is drawn
  larger and with more contour than what is only terrain. Sizes are against
  a citizen, so they hold at every size of landing: a den's mound is two to
  two and a half citizens wide and no taller than two thirds of its width,
  a chest sits on a rise with its lid showing, a scrap heap is one and a
  half citizens wide. A viewer can count the dens at a glance.
- **Edges are curves.** Banks, coasts, treelines and cliff lines are fitted
  through the tile data with bends no tighter than two tiles. A staircase of
  tile edges is a hard miss at sign-off.
- **Masses before pieces.** A wood is one canopy mass with a shared, lumpy
  contour, trunks showing only along its near edge, and a wash under it.
  Single trees are for open ground. The same goes for crags, reeds and ruins.
  This is also what keeps a landing readable when the view is at its widest.
- **Variation by build.** Each standing family (a kind of tree, rock, ruin)
  has at least five builds that differ in outline: height, lean, crown,
  missing limbs. Changing only the size of one drawing does not count.
- **Density has a shape.** Detail is thickest round the city and round the
  places worth going to, and thins toward the plate's edge. Open paper is
  allowed, as long as it is bounded by something drawn.
- **Difficulty is visible before anyone leaves the city.** An easy stop is
  open and pale, with low growth. A hard one carries more black: closer
  hatching, taller masses, darker washes, bones and wrecks.
- **Resources read as things to take.** Each kind of node has its own
  silhouette and a small spot of its own wash, and a worked-out node is
  drawn as worked out: a stump, an empty seam, a trampled bed.
- **Paths are worn ground**: a pale band with broken hair-line edges and a
  few stones. Not rows of circles.
- **The land is not named.** No river, wood or hill carries lettering. A den
  is lettered `den`, its letter and its level (`den A 28`), and nothing
  else on the ground has a label (section 11).

### First biomes

Each takes the day paper tinted 6% toward its ground wash.

| Biome     | Ground    | Growth    | Feature         | Accent                | Standing families    |
| --------- | --------- | --------- | --------------- | --------------------- | -------------------- |
| Meadow    | `#d9dcae` | `#a9c08a` | `#a8c3c9` water | `#d98f3e` flowers     | round trees, hedges  |
| Pinewood  | `#bccb9f` | `#6f8f78` | `#bfae9f` rock  | `#b5562f` fungus      | pines, fallen trunks |
| Fen       | `#c9cfb4` | `#8e9c74` | `#8fb0b4` pools | `#d7c56a` marsh light | reeds, dead trees    |
| Crags     | `#d8cdb8` | `#a39a86` | `#8c8378` scree | `#7fa6b0` ore         | crags, cairns        |
| Ash waste | `#d6d0c6` | `#8d8780` | `#4a4440` burnt | `#c8502e` embers      | burnt trunks, wrecks |

## 9. Animation

The simulation ticks ten times a second; the viewer draws every frame. Times
below are stream time.

- **Anticipation.** Every blow is read before it lands. The body coils away
  from the target: the spine bends back at least 15 degrees and the weapon
  arm is drawn behind the head. A citizen's fast blow holds that for at
  least 80 ms; a heavy monster blow for 300 to 600 ms. The harder the blow,
  the longer and deeper the coil. A lean of a few pixels is not anticipation.
- **Impact.** One held drawing at contact: the weapon at full reach, the
  target bent round the point it was hit, drawn for that frame in paper fill
  with ink line only.
- **Hit-stop.** The two bodies in a blow hold still: 2 frames for fodder, 4
  for anything bigger, 6 for a crit or a boss's blow. Only those two bodies
  stop. The world never does, since a hundred others are on the same screen.
- **Reaction.** The target is thrown along the blow's direction by a distance
  that fits the blow, from a quarter tile to two tiles, squashes as it lands
  and recovers with one overshoot. Fodder may stretch and squash by up to
  35%, citizens by 20%.
- **Follow-through.** The weapon carries past the target on its arc. The
  cloak hem, the hat's tip and anything tied to a tool arrive 60 to 100 ms
  after the body and overshoot once.
- **Arcs and easing.** Limbs and weapons travel on arcs. Nothing moves at
  constant speed: blows start fast and ease out, walks ease in and out.
- **Weight.** Big things move slowly and move other things. A city leg
  takes two seconds; a boss turns in half a second; fodder skitters. A
  walking figure's feet do not slide on the ground.
- **Idle.** Everything alive breathes, and anything hung sways. No idle loop
  is shorter than two seconds, and loops are offset by id so that a crowd
  never moves in step.
- **Calm.** No whole-frame flash and no whole-frame shake. A boss's blow may
  move the frame 2 px, twice. Everything else is local.

### How ink moves

Ink is the game's one material for effects, and it behaves like a liquid.

- It has three states. **Wet**: solid, at full strength, just laid.
  **Spreading**: its edge crawls outward and slows, and drops separate from
  it. **Dry**: it has stopped, lightens to a brown stain at 22%, and after a
  minute fades into the paper. A dry stain is always paler than a living
  monster. After a fodder kill the blot is wet for 0.3 s, spreading until 1 s
  and dry by 1.5 s.
- Wet ink never fades by transparency. It runs, breaks into drops, or soaks
  in.
- Ink is thrown along the direction of the blow that spilt it, in a fan
  about 60 degrees wide, and lands where a thrown liquid would.
- Bodies move smoothly, on every frame. Ink marks (arcs, splashes, bursts)
  are held drawings that change at most 12 times a second, like effects
  drawn by hand on twos.

## 10. Effects, projectiles and kills

All of it is stroke, blot or wash. No glow, no blur, no additive light, no
soft-edged particle, no drop shadow.

- **Swings.** One dry-brush stroke along the weapon's path in the citizen's
  cloak colour, wet and dark at the leading end and breaking up at the tail.
  Its length and width fit the weapon. It is a held drawing for 2 to 3
  frames, then it breaks into drops.
- **Telegraphs.** The shape of the coming blow fills with red-brown hatching
  a stroke at a time, so its fullness says how soon. One shape for one blow,
  with a curved edge where the blow has one.
- **How much of it.** A fight is found by what is in the air round it.
  Where a citizen is fighting, a still shows at least one of: a swing's
  stroke, a shot in flight, a body thrown, a burst of drops.
- **Sized against the figure.** Tiles get small as a landing grows
  (section 7), so on a landing an effect's size comes from the citizen's
  height. A swing's stroke is two and a half citizens long at least and
  14 px wide at its wet end: 115 px long at the mid city's size. A contact
  burst is a citizen's height across. An elite's telegraph is two and a
  half citizens wide. What a blow covers in the simulation is still shown
  true: a stroke may be longer than its reach, and the bodies it throws are
  the ones it hit.
- **Arrows and spears.** A shaft at contour weight half a citizen long, with
  a streak behind it three times its length and 6 px wide, in the shooter's
  cloak colour. On a hit it stays in the target for a moment.
- **Sling stones.** An 8 px dot on a visible arc with its shadow running
  along the ground beneath.
- **Firepots.** A 12 px dot trailing loops of smoke at contour weight. Where
  it lands, an amber wash spreads in a ring three tiles across with a hatched
  edge and burns down over its time, leaving a scorch in the burnt wash.
- **Boulders.** A hatched round at contour weight that turns as it rolls,
  with a flattened track behind it and dust at its foot.
- **Knockback.** A slide with two or three dust strokes at the feet and a
  short skid line. A body thrown a tile or more leaves the ground: it is
  drawn turning above its shadow and lands with a squash. Fodder caught in
  one blow is thrown together, as a fan of bodies along the blow.
- **Kills.** Fodder burst in one frame into five to nine drops along the
  blow and a small blot. A pack monster or brute comes apart into the strokes
  it was drawn with, which fall and pool. An elite does that over half a
  second. A boss empties: ink runs out of it to the ground for a second and
  a half and leaves a stain large enough to be a landmark until the city
  leaves.
- **Stains.** They build up, so the ground shows where the fighting was.
  Stains that touch merge into one pool with one edge. Together they cover no
  more than 8% of the frame; past that the oldest dry out.
- **A citizen downed.** It falls in the direction it was hit and lies in its
  own colours. No ink blot: ink is what monsters are made of.
- **Loot.** Drawn in colour, as citizens are: magic `#3e70a2`, rare
  `#d79a1e`, unique `#d9622b`. On a landing a drop is a marker. A rare or a
  unique stands taller than a figure, so it is found from across the map.
  Magic is a peg half a citizen
  tall with a ringed bundle. A rare is a pole one and a half citizens tall
  with a swallowtail in its colour. A unique is a pole two and a half
  citizens tall with a slip that carries its name, drawn over a second.
  Salvage is a small heap in ink at mid and
  near size and is not drawn at far size. A citizen carrying an unopened rare
  or unique has a pennant in that colour on its bundle.
- **Numbers.** One number a blow: the damage it did to everything it hit,
  added up. It is lettered in roman at full ink, at 20 px, or 24 px for a
  blow that kills something bigger than fodder, held for half a second and
  gone in a fifth. A crit is 32 px italic in the red-brown with a stroke
  under it. The largest blow in frame may be set at 48 px, one at a time.
  In each fight the largest number of the last second is set at 24 px at
  least, so a fight's numbers have one that leads (section 4). A
  number has the paper halo of its size (section 11), so the halos of its
  digits join into one paper shape that knocks out what is under it. Over the
  horde's black a number is in paper colour with no halo. A number starts
  over what was struck and rises along its blow. It never lies over a
  citizen's head, over more than a third of a figure, over a name tag at
  either ink or over another number, and that comes before showing it. When
  its spot is taken it steps on along the blow by half its own height, up to
  three citizens away, and a 20 px number with nowhere free is left out. A crit,
  a 24 px number and the 48 px one try the other directions too and reach
  twice as far, and one of them is left out only when it still has no free
  spot. At most 24 are in frame; past that the smallest are left out first,
  and the count never takes a crit.
- **Hitpoints.** On a body they are shown by the drawing where possible (a
  stoop, a torn hem, thinned hatching). Where a measure is needed it is an
  arc of ink strokes at the feet, never a filled bar.

## 11. Lettering and the corners

The lettering is part of the plate: the same ink, the same pen for its
frames and icons. A filled rectangle used as a meter, a solid line in a pure
hue, a rounded chip, a thumbnail pasted in a box: none of those are drawn.

### What is lettered

These, and nothing else:

- usernames, as typed and whole, from 3 to 25 characters;
- numbers, and a count out of a total as two numbers with a stroke between
  them (`15/28`);
- item names, as the game generates them;
- plain game nouns used as labels: `den` with its letter, `landing`,
  `march`, `lift-off`, `shield`, `packs`, `rares`, `down`, a landing's size;
- icons drawn with the pen, each with a number beside it.

### What is not

- A sentence or a clause. Nothing on the plate says what is happening in
  words: no "Legs planted", no "ramp coming down", no "is nearest".
- Facts chained on one line with dots, dashes or commas. One fact a line.
  Two things that belong together sit in two columns with a gap between
  them: `joshyboy88   Nine Lives`.
- A caption, a title, a plate number, an hour of the day, or an invented
  name for a place or a person.
- A line written to sound good. If it would not be on a scoreboard, it is
  not on the plate.
- An ellipsis. A name or a number is shown whole or not shown.

The check: read every word in a frame aloud. Each one is a username, a
number, an item or a label a player already knows.

### Face, sizes and the frame

- **The face** is IM Fell English, in roman. Italic is for a crit's number
  only. An item's name is set in its rarity's colour, darkened until it
  holds 4.5:1 against the paper.
- **Sizes** come from one scale: 20, 24, 32, 48. They are set for a viewer
  at a desktop watching the 1920 frame, and a frame's lettering is checked
  at that size and no other. Nothing is set under 20 px, because Fell runs
  small for its size.

  | Size  | In the corners                                                                   | On the map                                                                                   |
  | ----- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
  | 20 px | the label under the time or the shield, a landing's modifiers                    | a name tag, a blow's number                                                                  |
  | 24 px | the log line, the counts, a landing's size and levels, the shield's rate of loss | a called tag, a den's lettering, the number of a kill above fodder, a fight's largest number |
  | 32 px | the time on the clock, the shield's lamps                                        | a crit                                                                                       |
  | 48 px | nothing                                                                          | the frame's largest blow, one at a time                                                      |

- **The halo.** Lettering on the map has a paper halo that knocks out what
  is under it: 3 px wide at 20 and 24 px, 4 px at 32 and 6 px at 48.
  Lettering on a slip has none.
- **Hierarchy.** The largest thing on the plate is the drawing. In the
  corners the largest lettering is the time on the clock, or during the
  siege the shield's lamps. On the map only a crit is set as large, and
  only the frame's largest blow larger. Nothing is set smaller than a name
  tag, and a tag at rest is the quietest lettering on the plate.
- **One rule** at contour weight runs round the picture, 20 px in from the
  frame's edge. There is no strip under it and no second sheet beside it.

### The corners

Four slips of paper, one in each corner, 18 px inside the rule. A slip is a
paper fill with a frame at form weight and clipped corners, as small as what
it holds. Together they cover under 6% of the frame. Nothing else on the
plate is boxed.

| Corner      | Holds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upper left  | The clock, then the shield. In transit, a dial 60 px across and the time to the landing at 32 px, with `landing` under the number at 20 px. On a landing until the march, the time to the march by the calls made so far, with `march` under it. The dial's wedge is the time gone. From the march to the break the clock is not drawn, and the slip holds the shield in its place: a ring 60 px across of one dot for each post, in the order they stand round the foot with the far side at the top, the lit ones filled in the accent and the dark ones in ink; the lamps lit and the posts at 32 px (`9/18`); beside them at 24 px in red-brown, the part of its full strength the shield is losing a minute at its present rate, as a negative whole percent (`−12%`); and `shield` under that at 20 px. Nothing in the slip counts to lift-off before the break, because when that is depends on how long the shield holds. At the break the shield row goes and the clock comes back with the time to lift-off and `lift-off` under it, the wedge and the number in red-brown. |
| Upper right | The landing: its size and level range at 24 px (`Medium 23–68`), then its modifiers at 20 px, one a line (`packs ×2`, `rares +40%`). In transit it shows the landing ahead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Lower left  | The log: one line at 24 px. A username ruled under in its cloak colour, a gap, then an item name in its rarity's colour or one label (`down`). A new line replaces the last, no sooner than two seconds after it. It keeps no history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Lower right | Counts at 24 px, each an icon and a number: citizens out (a cloaked figure), citizens aboard (the hull on its legs), kills (a blot), loot banked (a sack).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

A card a chatter asks for ([chat.md](chat.md)) is a fifth slip beside the
log, laid out one fact a line in two columns, under the same rules.

### On the map

- **Name tags.** A username in roman at 20 px with a paper halo 3 px wide,
  ruled under at form weight in its owner's cloak colour. No banner and no
  box. It is 20 px at every camera and however many are out. Fell has one
  weight, so a tag is kept light by its size, its halo and its rule, and
  nothing is stroked round its letters to thicken them. It is never taller
  than the figure it names: the smallest citizen is 40 px (section 5),
  twice a tag's size.
  - **Its ink.** With 20 citizens or fewer out, every tag is at full ink.
    With more, a tag is at full ink only while its owner is in a fight
    (section 4), within two tiles of a drop's marker (section 10), named in
    the log, or called. Every other tag is at 60% ink, and so is its
    leader. The rule keeps its cloak colour at full strength at either
    ink, because the colour is what ties a tag to its owner. A tag comes
    up to full ink over a fifth of a second, holds it for two seconds
    after the reason has gone, and eases back over half a second, so a
    tag does not flicker as a fight moves past its owner.
  - **A called tag.** When a chatter's command is accepted or they ask for
    their citizen ([chat.md](chat.md)), its tag is set at 24 px at full ink
    for six seconds, with its rule at contour weight and a ring at contour
    weight in its cloak colour round its feet, as wide as the citizen is
    tall. That holds wherever it is and however many are out. At most six
    tags are called at once; a seventh waits at its usual size. This is
    how a chatter spots their own citizen in a crowd.
  - **Where it sits.** Centred over the hat, 6 px above it. When that spot
    is taken by another tag, a head or a corner, it goes beside its owner,
    to the right and then the left, with its near end 6 px from the figure
    and its baseline level with the head. When those are taken too it
    takes the nearest free spot of a fixed set, up to 100 px away, and a
    hair-line joins it to its owner once its near end is more than 10 px
    from the figure.
  - It holds its spot. It moves with its owner, changes spot only when it
    must and at most once a second, and slides there at no more than 4 px a
    frame against its owner, so a move of 72 px takes 0.3 s and a longer one
    takes longer.
  - It never lies over another tag or over a citizen, its owner included.
    A number gives way to it, whatever the tag's ink (section 10).
  - With 40 citizens or fewer out, every one is named. With more, at most
    24 tags are shown at once. They go first to a citizen in the log, one
    carrying a pennant, one who is down and one fighting a brute, an elite
    or a boss, then to whoever has gone longest without one. A tag is shown
    only where it has room, the set changes no faster than every five
    seconds, and every citizen is named for five seconds in each minute.
  - Aboard on a landing, the deck is too small for every name. A citizen
    there is named while it is called, in the log or shooting from the
    rail or a gun post. The rest take turns, four at a time, changing every
    five seconds. The count in the lower right says how many are aboard.
- **Dens** are lettered `den`, a letter and their level (`den A 28`) at
  24 px under the mouth, with the halo. The letter is what a chatter types
  to send a citizen there. A unique's marker carries its name on a slip
  (section 10).
- **Routes and intentions** are drawn as an engraver marks a march: a
  hair-line of dashes in ink along the curved path, with only the end cross
  in the walker's colour.
- Damage numbers are section 10's. Nothing else is lettered on the map.

## 12. The zoom between city and landing

The change between transit and landing is one camera move, composed at both
ends. It is the shot that sells the game, and it happens two or three times
an hour.

- **In transit** the frame is the deck. The hull's length is four fifths of
  the picture's width: 100 px a tile for the mid city, whose hull is then
  1,500 px long (section 7 has the others). The deck's floor and the walls
  of its rooms take a little over half the picture's height. The middle of
  the deck sits just below the picture's middle, so the lantern is inside
  the rule and clear of the slips, and the hull's near side shows whole
  under the rim. Every citizen aboard is in frame, at near or mid size.
  Tags aboard follow section 11's rules for citizens out: every one is
  named with 40 aboard or fewer, and at most 24 at once with more.
- **The legs are not framed in transit.** No leg is moved or shortened to
  fit, and the frame is not widened to hold a foot. What falls inside the
  picture is drawn in full: the near knees along the rim, with their shins
  running out under the bottom rule; the far legs rising behind the far
  walls to knees along the top; and any far foot that comes down in the
  strip of land above the far walls. A slip lies over whatever leg is
  under it.
- **The land** slides past in plan, the opposite way to the walk. It shows
  in four places: above the far walls, beyond the stern, beyond the prow,
  and in the hull's shadow under the keel.
- **When something runs alongside** (a raider rig, and later another
  city) the frame widens to hold the fight between the two machines, and
  no further. It holds the city on its legs, the other machine whole, and
  the ground the lines cross between them. What runs alongside is on the
  city's near side, lower on the plate, so none of it is behind the hull,
  and it runs as close outside the row of the city's near feet as it can.
  The frame opens downward to take it in: the lantern stays within 40 px
  of where it was, the hull keeps to the upper half of the picture, and
  the other machine stands on ground just inside the bottom rule, clear
  of the two lower slips. Every foot of the city is inside the rule and
  clear of the slips. For the mid city and a raider rig (section 6) that
  is 50 px a tile, where the hull is 750 px long, two fifths of the
  picture's width, and a citizen is 79 px, or 43 px with over 40 aboard
  (section 5). The two machines and the lines between them fill the
  middle of the picture from the lantern to the bottom rule, and every
  ninth of the picture has part of one of them in it. The widening takes
  6 to 8 seconds from the sighting, eased at both ends, and what is
  coming enters the frame as it opens. Names aboard are then shown as
  on a landing (section 11), and anyone in a fight aboard or at a gun
  post counts as shooting from it, with at most 24 tags at once when
  over 40 are aboard. When the other machine has gone the
  frame closes on the deck again in about 4 seconds. Nothing else widens
  the frame in transit.
- **Landed** the city stands inside the map (section 4), with ground and
  pockets on every side, and the frame holds the whole landing. Its hull is
  a quarter to a seventh of the frame's width, by the city's size
  (section 7).
- **The move** takes 6 to 8 seconds, eased at both ends, with no cut and no
  cross-fade of the whole frame. It starts on the deck as the legs plant.
  The land stops, the far feet in frame come down in the strip above the
  far walls, and the frame pulls back fast enough that each near foot is
  inside the rule and clear of the slips when it comes down. By the time
  the last foot is down the frame holds the whole machine on its legs, and
  from there it opens onto the land. The lantern mast is the anchor: it
  travels on one smooth curve
  from where it is over the deck to where it is on the landing, and
  everything else scales round it. The city is the same drawing at both
  ends and loses detail on the way by whole parts.
- **The land is drawn as it is revealed.** Pulling back, the ground's
  contours are inked outward from the city in every direction, just inside
  the edge of the frame as it widens. Washes flood in half a second behind
  the line. Standing things rise in order of distance, and packs with them,
  drawn at rest (section 6). No black comes with it: a landing begins in
  peace, and its edge is where the drawing stops (section 3). A viewer
  watches the map being drawn.
- **The frame closes with the horde.** From the march on, the frame holds
  the ground the horde has not taken, with five tiles of the horde beyond
  it above and below, and every citizen who is still out. It closes as that
  ground shrinks, eased, at no more than half a tile a second, and it never
  cuts. It stops when it holds the shield's foot with those five tiles:
  32 px a tile for a foot 22 tiles deep, where a citizen is 59 px. On the
  first size of landing that is no closer than the whole landing, and the
  frame does not move. So the siege is seen nearer than the expedition, and the horde is
  never more than about 70% of a frame.
- **Leaving** runs the reveal backward and shorter, in about 4 seconds from
  wherever the frame is: it closes on the deck as the horde's black reaches
  the ground the city stood on.
- **During the move** line weights hold, figures change size by adding or
  dropping parts (section 5), lettering fades out at the start and in at the
  end at its proper size and is never scaled, and no more than 5% of the
  screen changes brightness sharply between two frames.

## 13. Finished, and where the screen is today

"Roughed in" means the thing is on screen and tells the truth about the
world. "Finished" means the art director has signed the checklist below
against a capture. A roughed-in drawing may merge when its issue says that is
its scope; it stays on the art backlog until it is finished.

### The checklist

Hard items hold a `look` pull request. The others become follow-up issues.

Hard:

1. Nothing stands in for art: no plain geometric shape where a drawing
   belongs.
2. Every new stroke comes from the pen, at one of the four weights.
3. Fills are wash, spot black or paper. No gradient or soft edge outside
   lamplight's three steps.
4. It reads at 1920: the full frame shows at a glance what the change is
   for, and its lettering is at the sizes of section 11, none of it under
   20 px.
5. The palette rules hold: citizens own saturated colour, and the darkest
   tenth of the frame is the city, the horde or monsters that are awake,
   and lettering. Packs at rest are drawn at rest (section 6).
6. Lettering keeps to section 11: only what may be lettered, in the four
   corners and on the map as that section has it.
7. No edge follows the tile grid in steps.
8. It is staged in the round (section 4): on a landing the halves test
   passes, nothing is drawn side-on as a lane, and no rank, file or front
   is in frame.
9. Every citizen in frame can be found, in full or as an outline.
10. The first glance at 1920 lands on the fights and the citizens, and on
    lettering last. No lettering outweighs what it labels: a tag is never
    taller than its figure, and labels or empty ground never take more of
    the frame than the drawing they belong to. A frame that fails this
    fails the look pass, whatever else holds.

Soft:

11. The silhouette test passes for any new body, at 12 px in solid black.
    No brute or elite can be taken for a den, a crag, a heap or a standing
    stone, and no crest for a flame (section 6).
12. A new state has a pose, and a new blow has all its beats: coil, contact,
    hit-stop, follow-through.
13. Variation: no stamp repeated with only its size changed, and no crowd in
    step or in a grid.
14. Ink behaves as ink: thrown along the blow, wet then spreading then dry.
15. Night is drawn in masses with rims toward the lantern.
16. The frame has one lead and every fight in it has a focus (section 4),
    and a squint finds them.
17. The capture was looked at in day and night, at 1920.
18. Monsters are in packs and swarms, every pocket in frame has one, and
    none stands idle facing nothing (section 6).
19. A third of a landing's ground is quiet, and its pockets have edges a
    viewer can point to (sections 4 and 8).

### What meets this today

Checked against the captures of #330 and #333, 27 November 2026. That is the
camp viewer, which is what `main` draws. The look target (#362) is being
drawn to this page on a branch and nothing of it is on `main` yet.

| Part                         | State                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Paper, ink and the Fell face | Kept. The day paper, the ink and the face are the base this page builds on. The place lettering and double rule go.    |
| The map's pen (`pen.ts`)     | Kept and extended: it wobbles and double-strokes but has no pressure, and only the ground uses it.                     |
| Figures                      | Roughed in. No arms, no poses beyond stand, walk and sit, plain `stroke()` contours, detail that vanishes at far size. |
| Wolf                         | Closest to the standard: a clear silhouette. Needs the pen, rank, and tone.                                            |
| Goblin                       | Roughed in. Drawn in a different manner from everything else.                                                          |
| Ground, trees, rocks, river  | Roughed in. Stamps, tile-stepped banks, airbrushed washes, per-pixel grain.                                            |
| Night and lamps              | Roughed in. An inverted outline drawing with gradient discs.                                                           |
| Fights and effects           | Roughed in. Movement of 3 to 6 px, no swing, kills as scribbled ovals.                                                 |
| The page                     | Roughed in. A table on separate paper, with solid bars and truncated lines.                                            |
| The city, biomes, the zoom   | Not drawn yet.                                                                                                         |
