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

Sizes are in frame pixels at 1920 by 1080 unless they say otherwise. A stream
shrunk to a 640-wide window shows a third of that, so "3 px" here is one
pixel there.

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
open to the viewer. Citizens are out in every direction, there is a pack
round every place worth walking to, and black closes in from the rim
(section 4).

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

| Weight  | Width   | At 640  | Used for                                                             |
| ------- | ------- | ------- | -------------------------------------------------------------------- |
| Heavy   | 5 px    | 1.7 px  | the city's hull and legs, a boss's contour, the horde's leading edge |
| Contour | 3 px    | 1 px    | the outer silhouette of anything that acts or stands up              |
| Form    | 1.5 px  | 0.5 px  | structure inside a silhouette: folds, planks, joints, a face         |
| Hair    | 0.75 px | nothing | hatching and texture; at 640 it reads only as tone                   |

- Anything a viewer must see at 640 is a contour, a heavy line or a filled
  shape. Form and hair lines may only add to a drawing that already reads
  without them.
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
  per-pixel speckle: it turns to noise at 640.
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
  against black before reading any shape.
- **The darkest tenth.** Squint at a frame in greyscale at 640. The darkest
  shapes should be, in order of area: the city, monsters or the horde, then
  lettering. If a bar, a border, a river or a route line is among them, the
  frame is wrong.
- **Contrast.** A contour against the ground under it: at least 7:1. Lettering
  that carries information: at least 4.5:1, and never under 3:1 while a
  palette is changing. A wash never brings ink on it below 7:1.
- **One accent a phase**, used on less than 2% of the frame.
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

The horde is the landing's clock. Nobody fights it. It is what everyone gets
home ahead of.

- It is spot black on the ground, a tide of ink. It is never a row of
  monsters to fight and never a front that crosses the plate from one side.
- From the landing on, black stands along the whole rim of the map, about two
  tiles deep, with eyes in it. Until the horde moves, no side shows more than
  half again as much black as another.
- When it moves it takes the ground with the longest walk to the ramp first,
  on every side at once, so the pale ground shrinks to one shape round the
  city. Late in a landing the black is a closed ring and the picture is the
  run for the ramp.
- Its edge is one curved line at heavy weight, crowded with heads, backs and
  reaching limbs, uneven along its length. For one to two tiles ahead of the
  edge the ground is hatched in the red-brown of a blow about to land. Ahead
  of that a bruise wash (`#5a2a3a`) lies in two flat steps, 12% then 9%, out
  to about five tiles.
- Inside the black there are eyes and teeth in paper colour, thick near the
  edge and in clusters, never on an even pitch. Anything over two tiles tall
  that the black has covered still shows the top of its outline as a paper
  line at form weight, so the map can be read under the ink.
- It is the only large black thing on a daytime plate, which is how a viewer
  at 640 reads the time. The dial in the corner (section 11) counts the same
  time in numbers.
- Citizens running in keep their full colours. From the horn the city's
  lantern goes to the accent at full strength.

## 4. Staging and the lean

### Freedom

A landing is a map to explore, with the city in the middle of it. Nothing on
it is staged as two sides facing each other across a line, and no frame has
the city at one end and the enemy at the other.

- **The city stands inside the map.** Its hull is in the middle third of the
  frame both ways, with at least eight tiles of walkable ground on every side
  of it on a medium or large landing, and five on a small one.
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
- **The halves test.** Shrink the frame to 640 and cut it in half through the
  city, across and then down. Each half has citizens, monsters and something
  to take. If one half is ours and the other is theirs, the frame is staged
  wrong.

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

### Depth and cover

- Things lower on the plate are in front. Everything that stands is sorted
  by its feet. The city's far legs are drawn before its hull and its near
  legs after everything aboard.
- A citizen is never hidden. Where the hull, a leg, a tree, a mound or
  another body covers more than half of one, the citizen is drawn again on
  top as an outline at contour weight in its cloak colour, with its head in
  paper. Monsters get no outline. A pack half behind a wood is how an ambush
  reads.
- A figure may cover up to a third of its neighbour. At 1920 no citizen's
  head or hat is covered by another citizen.
- A thing in the air is drawn above its shadow, and the gap between the two
  is its height.

## 5. Figures

A citizen is drawn from the same construction at every size, with more of it
shown the larger it is.

### Construction

- Three heads tall. The head is a paper disc with a contour; it is the mark
  that says "a person" and is never smaller than 3 px across at 640.
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

| Size | Where                                                   | Height at 1920 | At 640      | What is drawn                                                                                                                           |
| ---- | ------------------------------------------------------- | -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Far  | a large landing                                         | 44 to 50 px    | 15 to 17 px | contour, cloak colour, hat colour and shape, head, the weapon's silhouette, legs as two ticks, arms only while they are doing something |
| Mid  | a small or medium landing; the deck with over 40 aboard | 56 to 76 px    | 19 to 25 px | adds feet, the eye, the shade band, cloak pattern, both arms                                                                            |
| Near | the deck in transit with 40 aboard or fewer             | 96 to 120 px   | 32 to 40 px | adds form lines, the mark on the cloak, death patches, kit detail, an expression                                                        |

- A citizen on a landing is never under 44 px at 1920. A landing too large to
  hold that is not drawn smaller; the generator makes it of fewer tiles.
- A citizen is drawn larger than its tile: about 1.9 tiles tall on a medium
  or large landing, and no more than 76 px on a small one. It is a figure standing on a map, as the lean has it (section 4).
- At far size a figure is at most six shapes. Pattern, mark and patches are
  not drawn smaller; they are left out.
- A viewer finds their own citizen on a landing by its name tag (section 11),
  then by cloak colour and hat colour and shape.
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
| Brute  | one and a half           | contour and form | close hatching, one area of spot black  | wide: at least twice a citizen's width                                           |
| Elite  | one and a half to two    | contour and form | crossed hatching, spot black, an accent | one feature no lesser monster of its kind has: a crest, a banner, a broken horn  |
| Boss   | three or more            | heavy contour    | crossed hatching and large spot black   | its level lettered beside it; a solid ground shadow; stands on 2 tiles or more   |

- Each kind passes the silhouette test: filled solid black at 12 px tall, it
  can be told from every other kind and from a citizen.
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

### Packs and swarms

A landing is full of monsters, and they are in groups.

- **Fodder is a swarm** of 12 to 50, drawn as one crawling shape wider than
  the citizen it is after. It flows round what is in its way and closes as
  one mass.
- **Pack monsters come in packs** of three to six with a leader a head
  taller than the rest. A brute has fodder round its feet. A den's elite has
  its pack at the mouth.
- **Every pocket has its pack** (section 8), and more packs walk the ground
  between pockets. On a landing with everyone out, a viewer at 640 sees
  monsters on every side of the city before seeing any single one.
- **A monster looks like a threat.** One that is not fighting is doing
  something a viewer reads as intent: a pack asleep in a heap with one
  awake, a pack pacing its ground or gnawing at a kill, a swarm boiling
  round its nest. When a citizen comes within ten tiles, heads turn to it.
  Within six the pack is stalking: low, facing it, closing. No monster
  stands idle facing nothing, and no two of a pack share a pose.

## 7. The city

The city is the main character and is on screen in every frame. It gets the
most drawing time of anything in the game.

### Build

The city is one machine, drawn one way at every scale: from the south and
above, by the lean of section 4, with its deck open to the viewer. It is not
drawn side-on in any frame. The close-up in transit and the city on a landing
are the same drawing at two sizes.

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
  foot plate lies on the ground at 0.8 with its own shadow.
- **The lantern mast.** It stands three and a half tiles high from the middle
  of the deck and its head is the highest thing on the plate, with the
  lantern there, a crow's nest below it and stays to the deck's corners in
  hair weight. It is the
  anchor of the zoom (section 12) and the source of light at night.
- **The rail.** It runs round the deck, with gun posts fore and aft. This is
  where citizens fight in transit and shoot from on a landing. Posts and
  mounted weapons are drawn large enough to read at mid size.
- **The ramp.** Timber, three tiles wide. It comes down through a gap in the
  rail to the ground on whichever side the landing puts it. Stowed, it is
  folded up against the rail.
- **The outline.** From above it is not a clean boat. The stack, chimneys, a
  crane, awning frames, stores and lines break it, and the two ends differ.

### On a landing

- The city stands inside the map (section 4) with its legs planted wide.
  With them it covers about 20 tiles by 14. The ground under the hull and
  between the feet is still map: citizens walk out between the legs.
- Its hull is a third of the frame's width on a small landing, a quarter on
  a medium one and a sixth on a large one.
- Parked, the belly is half a tile off the ground. Its shadow under the hull
  is what lifts it off the map.
- Citizens aboard stand on the open deck at the landing's figure size and are
  named like anyone else. Those at the rail shoot outward in any direction.
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
  medium landing has twelve pockets or more besides the city's own ground,
  on every side of it. A pocket with nothing in it is a mistake unless it is
  only a way through.
- **Places stand out from scenery.** What can be taken or fought is drawn
  larger and with more contour than what is only terrain: a den's mound is
  four to five tiles wide, a chest sits on a rise with its lid showing, a
  scrap heap is three tiles wide. A viewer at 640 can count the dens.
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
  is lettered `den` and its level, and nothing else on the ground has a
  label (section 11).

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
- **How much of it.** A fight is read at 640 by what is in the air round it.
  Where a citizen is fighting, a still shows at least one of: a swing's
  stroke, a shot in flight, a body thrown, a burst of drops. A swing's stroke
  is as long as its weapon reaches, two tiles at least, and 12 px wide at its
  wet end.
- **Arrows and spears.** A shaft at contour weight most of a tile long, with
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
  unique stands taller than a figure, so it is found at 640. Magic is a peg
  half a citizen
  tall with a ringed bundle. A rare is a pole one and a half citizens tall
  with a swallowtail in its colour. A unique is a pole two and a half
  citizens tall with a slip that carries its name, drawn over a second.
  Salvage is a small heap in ink at mid and
  near size and is not drawn at far size. A citizen carrying an unopened rare
  or unique has a pennant in that colour on its bundle.
- **Numbers.** One number a blow: the damage it did to everything it hit,
  added up. It is lettered in roman at full ink with a paper halo, at 30 px,
  or 36 px for a blow that kills something bigger than fodder, held for
  half a second and gone in a fifth. A crit is 48 px italic in the red-brown
  with a stroke under it. The largest blow in frame may be set at 72 px,
  one at a time. A number rises along its blow and never covers a citizen's
  head or a name tag. At most 24 are in frame; past that the smallest are
  left out first, and a crit never is.
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
- numbers;
- item names, as the game generates them;
- plain game nouns used as labels: `den`, `landing`, `lift-off`, `packs`,
  `rares`, `down`, a landing's size;
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
- **Sizes** come from one scale: 24, 30, 36, 48, 72. Nothing that carries
  information is set under 24 px, which is 8 px at 640.
- **Hierarchy.** The largest thing on the plate is the drawing. In the
  corners the largest lettering is the time left. On the map only a crit and
  the frame's largest blow are set as large or larger.
- **One rule** at contour weight runs round the picture, 20 px in from the
  frame's edge. There is no strip under it and no second sheet beside it.

### The corners

Four slips of paper, one in each corner, 18 px inside the rule. A slip is a
paper fill with a frame at form weight and clipped corners, as small as what
it holds. Together they cover under 6% of the frame. Nothing else on the
plate is boxed.

| Corner      | Holds                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upper left  | The clock. A dial 60 px across and the time left at 48 px, with `landing` or `lift-off` under the number at 24 px. The dial's wedge is the time gone, and the stretch from the horn to the lift is hatched. In the last two minutes of a landing the wedge and the number are red-brown. |
| Upper right | The landing: its size and level range at 30 px (`Medium 23–68`), then its modifiers at 24 px, one a line (`packs ×2`, `rares +40%`). In transit it shows the landing ahead.                                                                                                              |
| Lower left  | The log: one line at 30 px. A username ruled under in its cloak colour, a gap, then an item name in its rarity's colour or one label (`down`). A new line replaces the last, no sooner than two seconds after it. It keeps no history.                                                   |
| Lower right | Counts at 30 px, each an icon and a number: citizens out (a cloaked figure), citizens aboard (the hull on its legs), kills (a blot), loot banked (a sack).                                                                                                                               |

A card a chatter asks for ([chat.md](chat.md)) is a fifth slip beside the
log, laid out one fact a line in two columns, under the same rules.

### On the map

- **Name tags.** A username at 24 px in ink with a paper halo, ruled under
  in its owner's cloak colour. No banner and no box.
  - It sits centred over the hat, 8 px above it. When that spot is taken by
    another tag, a head, a number or a corner, it takes the nearest free
    spot of a fixed set, up to 150 px away, and a hair-line joins it to its
    owner once it is more than 14 px off.
  - It holds its spot. It moves with its owner, changes spot only when it
    must and at most once a second, and slides there at no more than 4 px a
    frame against its owner, so a move of 72 px takes 0.3 s and a longer one
    takes longer.
  - It never lies over another tag, a citizen's head or a damage number.
  - With 40 citizens or fewer out, every one is named. With more, tags go
    first to a citizen in the log, one carrying a pennant, one who is down
    and one fighting a brute, an elite or a boss, then to whoever has gone
    longest without one. A tag is shown only where it has room, the set
    changes no faster than every five seconds, and every citizen is named
    for five seconds in each minute.
- **Dens** are lettered `den` and their level at 24 px under the mouth. A
  unique's marker carries its name on a slip (section 10).
- **Routes and intentions** are drawn as an engraver marks a march: a
  hair-line of dashes in ink along the curved path, with only the end cross
  in the walker's colour.
- Damage numbers are section 10's. Nothing else is lettered on the map.

## 12. The zoom between city and landing

The change between transit and landing is one camera move, composed at both
ends. It is the shot that sells the game, and it happens two or three times
an hour.

- **In transit** the city with its legs fills about three quarters of the
  frame's width, at about 66 px a tile. The middle of its deck sits a little
  above the frame's middle, so the lantern and all eight feet are inside the
  rule. The land slides under it in plan, the opposite way to its walk.
  Every citizen aboard is at near or mid size.
- **Landed** the city stands inside the map (section 4), with ground and
  pockets on every side. Its hull is a third of the frame's width on a small
  landing, a quarter on a medium one and a sixth on a large one.
- **The move** takes 6 to 8 seconds, eased at both ends, with no cut and no
  cross-fade of the whole frame. The lantern mast is the anchor: it travels
  on one smooth curve from where it is in the close-up to where it is on the
  landing, and everything else scales round it. The city is the same drawing
  at both ends and loses detail on the way by whole parts.
- **The land is drawn as it is revealed.** Pulling back, the ground's
  contours are inked outward from the city in every direction, just inside
  the edge of the frame as it widens. Washes flood in half a second behind
  the line. Standing things and packs rise in order of distance, and the
  black at the rim comes last. A viewer watches the map being drawn.
- **Leaving** runs it backward and shorter, in about 4 seconds: washes drain
  toward the city, lines hold a moment and lift, and the close-up closes on
  the city as the horde's black reaches the ground it stood on.
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
4. It reads at 640: the full frame shrunk to 640 wide still shows what the
   change is for, and lettering that carries information is 8 px or more
   there.
5. The palette rules hold: citizens own saturated colour, and the darkest
   tenth of the frame is the city, monsters and lettering.
6. Lettering keeps to section 11: only what may be lettered, in the four
   corners and on the map as that section has it.
7. No edge follows the tile grid in steps.
8. It is staged in the round (section 4): on a landing the halves test
   passes, nothing is drawn side-on as a lane, and no rank, file or front
   is in frame.
9. Every citizen in frame can be found, in full or as an outline.

Soft:

10. The silhouette test passes for any new body, at 12 px in solid black.
11. A new state has a pose, and a new blow has all its beats: coil, contact,
    hit-stop, follow-through.
12. Variation: no stamp repeated with only its size changed, and no crowd in
    step or in a grid.
13. Ink behaves as ink: thrown along the blow, wet then spreading then dry.
14. Night is drawn in masses with rims toward the lantern.
15. The frame has one focus, and a squint finds it.
16. The capture was looked at in day and night, at 1920 and at 640.
17. Monsters are in packs and swarms, every pocket in frame has one, and
    none stands idle facing nothing (section 6).

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
