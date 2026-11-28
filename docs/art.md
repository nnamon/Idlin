# Idlin: the art bible

This is the standard every `look` change is drawn to and signed off against.
The art director owns it ([AGENTS.md](../AGENTS.md), section 2) and changes it
by pull request like any other doc.

It is written for the game Idlin is becoming: a machine city that walks the
world on legs, stops at generated landings, and sends its citizens out across
the map before a horde closes in (#361). Most of what is on screen today was
drawn before this page existed and does not meet it. Section 13 says what
does and what does not.

Sizes are in frame pixels at 1920 by 1080 unless they say otherwise. A stream
shrunk to a 640-wide window shows a third of that, so "3 px" here is one
pixel there.

**T** is the width of one ground tile on screen at the current zoom. Heights
and most sizes of things in the world are given in T, so they hold at every
zoom. A citizen is 1 T tall. Section 12 gives T for each camera.

## 1. The look

The world is one ground plane seen from above at an angle, and everything on
it stands on it: the city, the citizens, monsters, trees, the horde. It is
drawn as a hand-tinted engraving. The paper is cream. Everything on it is
laid with one pen in sepia ink, then tinted with a few thin washes that do not
quite meet their outlines. The city is the largest and darkest drawing on the
plane. The citizens are the only strongly coloured things on it. Monsters are
drawn with more black than anything friendly, and when one dies the ink it was
drawn with spills on the ground and stays there. Lettering is in the same ink
and states facts: a username, a number, an item's name, a plain label
(section 11).

Where it comes from, in spirit. None of these is to be copied.

- Engraved bird's-eye views of towns from the seventeenth and eighteenth
  centuries: ground and buildings seen from above at an angle, with shade
  built from hatching.
- Moebius: a clean contour that carries the form, a small number of flat
  colours, and large quiet areas that make the busy ones read.
- Tove Jansson's ink drawings: night as solid black masses with a little light
  cut out of them, and small figures that are clear at any size.
- The castle in "Howl's Moving Castle": a city as a heap of rooms and chimneys
  that sways when it walks.
- Brush calligraphy: a blow as one stroke that starts wet and ends dry.

## 2. The pen

There is one pen. Citizens, monsters, the city, terrain, effects and icons
are all stroked by the same routine, so a figure never looks pasted onto the
map. A shape stroked with a plain canvas `stroke()` at constant width is
roughed in, whatever else is right about it.

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
  steps. A tile's diamond is never drawn as a diamond.

### Fills

Three, and no others.

- **Wash.** A flat, transparent tint with a hard dried edge. It is offset
  from its contour by 2 to 3 px down and to the right, so a sliver of paper
  shows on the lit side and the tint runs slightly past the line on the other.
  Its lower right edge is one step darker, where the water pooled. No radial
  gradients and no soft airbrushed edges.
- **Spot black.** Solid ink: the shade side of the city's hull, the mass of a
  wood at night, a boss's mane, the horde. It is what gives a frame its
  darkest values, so it is spent on purpose (section 3).
- **Paper.** Left blank. Faces, highlights, the lit side of things, open
  ground.

### Hatching and texture

- Shade is hatched in one direction over the whole frame: strokes fall from
  upper right to lower left at about 60 degrees. By day the light comes from
  the upper left, so shade sits on the lower right of everything, and of the
  two faces of a wall or hull that the camera sees, the lower right one is the
  shaded one. At night shade sits on the side away from the city's lantern.
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
  above 45% saturation in the frame, with two exceptions: lamp flame and loot.
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

Warm wood and lamplight over a cool, pale ground going by.

| Role             | Colour    |
| ---------------- | --------- |
| paper            | `#f1e6cd` |
| ink              | `#2f2621` |
| timber           | `#c9a36b` |
| canvas and rope  | `#e7dcc0` |
| iron and soot    | `#5b5048` |
| brass            | `#d2a24c` |
| the ground below | `#a9b4b0` |
| accent: lamp     | `#f6cf6a` |

The ground the city walks over is drawn on the plane like any other ground,
in ink at 40% strength with the one cool wash. It has no contour-weight lines,
so the city always sits in front of it.

### A landing by day

Each biome has a paper tint, three washes and one accent (section 8 lists
them). The city keeps its transit colours wherever it parks, so it is the warm
spot on every map. The sky still lends its colour by the hour (rose at dawn,
amber toward dusk) as a thin cast over the whole frame, at most 25% strong,
and it never lies over spot black.

### Loot

Loot is drawn in colour, as citizens are. The rarity colours are the same on
the ground, on a marker and in the log.

| Rarity | Colour    |
| ------ | --------- |
| common | `#8a7f74` |
| magic  | `#3e70a2` |
| rare   | `#d79a1e` |
| unique | `#d9622b` |

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
  passes of a brush, warm at the centre. On the ground each step is an ellipse
  twice as wide as it is tall. Inside the first step the day colours show. It
  is not a smooth radial gradient, and it does not cut a pale disc out of the
  night.
- The city's lantern is the one large light. A citizen's carried light
  reaches about one tile, enough to show its colours and no more. When many
  stand together their lights join into one shape with one edge.
- Monsters in the dark are a mass and two eyes in the accent colour until they
  come into the light.

### The horde

The horde is the landing's clock. It is never a battle line, and no frame is
composed as citizens on one side and the horde on the other.

- It is spot black lying on the ground: ink that comes in over the map's rim
  (section 8) and spreads inward, taking the ground farthest from the ramp
  first. Which ground it has taken is the simulation's to say. It is the only
  large black thing on a daytime landing, which is how a viewer at 640 sees
  how much time is left.
- **Before it moves.** The rim has a gap on each side of the map where the
  horde will come in. From the moment of landing each gap shows black massed
  in it with pairs of paper-coloured eyes, and the ground for three tiles
  inside the gap takes a bruise wash (`#5a2a3a` at 15%).
- **Coming in.** What the black covers stays covered. Its leading edge is one
  curve with no tile steps, drawn at heavy weight, with a band one tile deep
  ahead of it hatched in the red-brown of a blow about to land. Single
  monsters stand along the edge, drawn as bodies with paper eyes and teeth;
  behind them the black has only eyes. The bruise wash runs three tiles ahead
  of the edge, and six tiles ahead along each of the horde's ways from a gap
  to the ramp, which is where its runners come down.
- **What it covers.** Trees, rocks and walls on taken ground stay as black
  shapes with a hair-line paper rim, so the taken ground still reads as the
  same land. Labels, markers and loot on it are gone.
- **The ring.** The black comes from every side, so it joins up behind the
  last open ground. Late in a landing the open ground is one piece with the
  city in it, and the black's edge is a closed curve round it that tightens
  until it reaches the hull.
- Citizens running home keep their full colours, and from the horn the
  city's lantern goes to the accent at full strength.
- The time itself is on the clock in the corner (section 11): the black on
  the map and the black on the dial grow together.

## 4. Projection and depth

### The plane

The ground is one plane of square tiles, drawn in 2:1 dimetric projection:
the view of a camera about 30 degrees above the horizon, turned 45 degrees to
the tile grid, with no perspective. Nothing is drawn in side elevation and
nothing in plan.

- A tile at (tx, ty) with a thing h tall on it is drawn at

  ```
  x = ox + (tx - ty) * T / 2
  y = oy + (tx + ty) * T / 4 - h * T
  ```

  where (ox, oy) is where the camera puts tile (0, 0). The tx axis runs down
  and to the right, the ty axis down and to the left. A tile covers a diamond
  T wide and T / 2 tall.
- Height is measured in T on screen. A citizen is 1 tall; a wall 0.75 tall
  stands three quarters of a citizen above its foot. Vertical edges are
  vertical on screen.
- Size does not change with distance. A citizen at the far corner of the map
  is the same height as one at the near corner.
- A circle on the ground is an ellipse twice as wide as it is tall. That goes
  for swing arcs, burn rings, lamplight, telegraphs and ground shadows.
- Every body and every thing in the air has a ground shadow: an ellipse of a
  few hatch strokes under it. A projectile's height is the gap between it and
  its shadow.
- A thing h tall hides the ground behind it for 2h tiles straight up the
  screen. Section 8 keeps standing terrain low for that reason.

### Draw order

1. The ground, flat: paper, washes, water, paths, stains, burn marks, the
   horde's black, telegraphs, ground shadows, level numbers lettered on the
   ground.
2. Everything that stands or flies, sorted by ground depth and then by
   height. Ground depth is tx + ty at the thing's foot, counted in fractions
   of a tile, smaller first. At equal depth the lower thing is drawn first. A
   thing in the air sorts at the depth of its shadow.
3. Occlusion outlines (below).
4. Lettering on the map: labels, damage numbers, name tags.
5. The four corners (section 11) and the rule round the frame.

A thing wider than one tile sorts by its footprint: it is drawn before
another thing if its footprint ends before the other's begins on either tile
axis. Anything more than two tiles across (the city, a wood, a wall, a crag)
is cut into pieces no more than two tiles deep, and each piece sorts on its
own. The city is cut into its far legs, its hull and deck in strips, and its
near legs.

### Nobody is hidden

Every citizen is on screen at all times, so every citizen can be found at all
times.

- A citizen that something drawn after it covers (the hull, a wall, a wood, a
  crag, a marker) is drawn again on top of that thing as an outline: its
  silhouette, hat included, as one contour-weight line in its cloak colour
  with a form-weight paper line outside it, and no fill.
- The outline is drawn whenever the cover hides the head or more than a third
  of the body. Where the renderer can cut it to the covered part it does;
  otherwise the whole silhouette is outlined.
- The outline moves and poses with the citizen. Its name tag is drawn as
  usual.
- Thin things get no outline rule: a leg of the city, a rope, a mast, a pole.
  Nothing a citizen stands at for more than a few seconds is placed behind
  where one of those rests.
- A den's elite and a boss get the same outline in ink. Other monsters get
  none.
- Citizens do not outline through each other. Section 5 says how a crowd
  keeps its heads clear.

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

### Facing

A figure is seen from above at the plane's angle and faces one of four ways:
toward the lower left, the lower right, the upper left or the upper right.

- There are two drawings, each mirrored. Facing the camera's side (lower left
  or lower right) the face shows, the tool arm is in front of the body and the
  haul is behind it. Facing away (upper left or upper right) there is no face,
  the hat and the back of the cloak show, the haul is in front and the tool
  arm is drawn before the body.
- A figure faces the way it walks or the thing it strikes, snapped to the
  nearest of the four. It keeps a facing for at least 0.3 seconds.
- Its feet are on its tile's ground; the body rises straight up the screen
  from them.

### Sizes

A citizen's height on screen is T, so the camera sets it (section 12).

| Size | Height at 1920 | At 640     | Where                                      | What is drawn                                                                                                      |
| ---- | -------------- | ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Far  | 28 to 40 px    | 9 to 13 px | a large landing (28 px), a medium one (40) | contour, cloak colour, hat colour and shape, head, the tool's silhouette, arms only while they are doing something |
| Mid  | 48 px          | 16 px      | a small landing                            | adds legs and feet, the eye, the shade band, cloak pattern                                                         |
| Near | 112 px         | 37 px      | the deck in transit                        | adds form lines, the mark on the cloak, death patches, kit detail, an expression                                   |

- 28 px is the smallest a citizen is ever drawn. A map too large for that is
  not made larger; the landing is made harder some other way.
- At far size a figure is at most five shapes. Pattern, mark and patches are
  not drawn smaller; they are left out.
- A viewer finds their own citizen at far size by its name tag, then by cloak
  colour and hat colour and shape. Nothing else is asked of that size, and a
  blow at that size is read from its effects (section 10), which have sizes of
  their own.
- A change of size during a zoom adds or drops whole parts, each fading over
  the part of the move where the figure is between two sizes. Lines never
  thin.

### Poses

Every state the simulation has gets a pose that reads in silhouette: standing,
walking, running, carrying (the bundle on the back grows with the haul),
working a chest or a scrap pile, each kind of blow in its three beats
(section 9), shooting, hurt, downed, sitting, sleeping, and crewing a station
aboard. A state shown only by a label, a ring or a number is roughed in.

### Crowds

- No two neighbours stand in the same pose facing the same way. Idle phase,
  facing and lean are offset by id.
- A crowd is never drawn as a grid, a rank or a file. Where the simulation
  puts citizens on adjacent tiles, they are drawn off-centre on their tiles.
- A citizen may cover another's cloak, never its head or hat. Two citizens
  on tiles one behind the other already clear by half a figure; two on one
  tile stand half a tile apart along the tile.
- In a crowd of thirty or more at far size, contour weight is kept only on
  the outline of each figure against the ground or a different colour; where
  two cloaks of like colour overlap, the line between them is form weight.

## 6. Monsters

Rank is the first thing a monster's drawing says. The ranks are the
simulation's: fodder, pack, brute, elite, boss.

| Rank   | Height against a citizen | Line             | Tone                                    | Other                                                                                   |
| ------ | ------------------------ | ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Fodder | a half or less           | contour only     | one grey wash                           | drawn as a swarm: overlapping bodies share one outline, with many heads and legs        |
| Pack   | about the same           | contour and form | wash and open hatching                  | each drawn singly, in three or more variants of pose and build                          |
| Brute  | one and a half           | contour and form | close hatching, one area of spot black  | wide: at least twice a citizen's width                                                  |
| Elite  | one and a half to two    | contour and form | crossed hatching, spot black, an accent | one feature no lesser monster of its kind has: a crest, a banner, a broken horn         |
| Boss   | three or more            | heavy contour    | crossed hatching and large spot black   | its name and level lettered beside it; a solid ground shadow; stands on 2 tiles or more |

- Each kind passes the silhouette test: filled solid black at 12 px tall, it
  can be told from every other kind and from a citizen.
- Monsters are drawn in the same manner as each other and as the citizens:
  seen from above at the plane's angle, in the four facings of section 5,
  facing what they are after. No kind is drawn front-on like a mascot.
- Washes are greys and earths. Colour on a monster is one accent on an elite
  or boss.
- A monster's drawing shows its intent: stalking is low with the head down,
  winding up is a coil away from the target, fleeing is stretched out.
- A pack that nobody has reached yet is still drawn, in full ink, doing
  something: lying round its leader, pacing, feeding, asleep at a den's
  mouth. The leader is the largest of its pack and stands nearest its
  middle.
- A wounded monster loses ink: its hatching thins and breaks as its hitpoints
  go, so a nearly dead one is visibly lighter. No ring or bar is needed for
  that.

## 7. The city

The city is the main character and is on screen in every frame. It gets the
most drawing time of anything in the game. It is one machine: a hull on
spider legs, standing on the plane like everything else and seen from above
at the same angle.

### Build

- **Footprint.** 14 tiles long and 8 wide, the long way along the tx axis,
  with the prow at the lower right end. On screen the hull is 11 T wide.
- **Hull.** A riveted body 1 T deep under the deck, in heavy contour. The
  camera sees two of its sides: the lower left one takes the timber wash and
  close hatching, the lower right one is spot black. The underside is spot
  black. It is the darkest large shape in the frame. Its outline in plan is
  lumpy and lopsided, with galleries and gun posts hung outside it, never a
  box.
- **Legs.** Eight, four along each long side, each of three segments with
  visible pinned joints and a piston, ending in a splayed foot plate. A leg
  leaves the hull at the deck's edge, rises to a knee above the deck, and
  comes down to a foot three tiles out from the hull. Heavy contour. The four
  on the far side are drawn before the hull, in form weight with a 40% wash,
  so the pairs separate. The four on the near side are drawn after it.
- **The deck.** The top of the hull is the city's floor, and the camera looks
  down onto it. It is a plan of open deck and rooms on a few levels: a main
  deck, a fore deck and an aft deck raised half a T, a crow's nest, and the
  galleries outside the rail. No deck is built over another, so every place
  a citizen can stand is open to the camera.
- **The lantern mast.** The tallest thing aboard, 3 T above the deck, with
  the lantern at its head. It is the anchor of the zoom (section 12) and the
  source of light at night.
- **The rail.** The edge of the deck, where the citizens fight in transit.
  Crenels and mounted weapons are drawn large enough to read at mid size.
- **The ramp.** Three tiles wide, from the deck's edge down to the ground on
  whichever side the landing puts it. Lowered, its foot is on the ground one
  tile out from the hull.

### The cut-away

The city is always drawn cut away, at every zoom, so that the citizens on its
decks show.

- **Roofs are left off.** A room keeps its two far walls at 0.75 T, and its
  far gable keeps its peak, so each room still has a roofline against the
  deck behind it. Its two near walls are cut down to a sill 0.15 T high.
- **Nothing is stacked.** There is no deck under a deck and no room under a
  room. Where the hull needs to look built-up, it gets chimneys, the mast,
  cranes, tanks and awning frames, which are thin, and far walls, which stand
  behind what they belong to.
- **Awnings and sails** are drawn as their frame and edge in form weight with
  a 20% canvas wash, so a citizen under one still shows in full.
- A citizen that a far wall, a chimney stack or the hull's side still covers
  gets the outline of section 4. From the ground beside a parked city that is
  the usual case: someone walking behind the hull shows as an outline over
  it.

### Districts

Each district aboard is told apart by three things and no label is needed:
one far gable no other district has, one wash from the transit palette that
dominates it, and one part that moves (a bellows, a steaming pot, a turning
crane, swinging hammocks). A district that is only a labelled box is roughed
in.

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

- **Walking**, the belly is 1.25 T above the ground and the city goes prow
  first, so the ground slides under it toward the upper left. Ground marks
  pass behind the far legs, under the hull and in front of nothing: the near
  legs and their feet are drawn over the ground they stand on.
- A step takes 1.5 to 2 seconds a leg. The foot lifts, reaches, plants, and
  the hull dips toward the leg that is in the air and rises as it plants. A
  planted foot stays on its piece of ground while the ground moves.
- Hung things lag the hull: lamps, washing, hammocks and pennants swing after
  each step and settle before the next.
- A footfall is a ring of ink strokes and a puff of dust at the foot. The
  hull moves a few pixels. The camera does not shake.
- **Parked**, the city settles over about two seconds until its belly is a
  quarter T off the ground, with its knees high and its feet where they
  planted. Its chimneys keep smoking. It is never a still image.

## 8. Terrain and biomes

Landings are generated, so these are rules for a generator's drawing, with a
first set of biomes.

### The map

- **Square, with the city in it.** A landing is a square of tiles, so on
  screen it is a diamond twice as wide as it is tall, centred in the frame.
  The city stands within four tiles of its middle, and there is ground to
  walk on every side of it.
- **Three sizes.** The size is the difficulty, and the camera pulls back as
  far as the size needs (section 12).

  | Size   | Tiles    | T     |
  | ------ | -------- | ----- |
  | Small  | 32 by 32 | 48 px |
  | Medium | 42 by 42 | 40 px |
  | Large  | 60 by 60 | 28 px |

- **The rim.** The map's edge is a band of the biome's barrier two tiles
  deep, drawn all the way round with one lumpy outline. It is broken only
  where the horde comes in. Beyond the rim is bare paper, which is where the
  four corners' lettering sits.
- **Pockets.** The map is made of districts, each a pocket of ground with a
  barrier round it (a wood, a ridge, water) and one or a few ways in. Each
  district's ground takes one step of wash of its own, so the pockets can be
  counted at 640. What is in a pocket is drawn so that it reads from across
  the map:
  - a den: a mouth 1.25 T tall with a ring of bones, its pack round it, its
    name and level lettered beside it;
  - a chest: a chest on a plinth, 0.6 T tall, with its guard pack round it;
  - a scrap pile: a heap half a T tall with a spot of its own wash;
  - packs standing on open ground (section 6).
- **Ways in read as ways in.** A gap, a pass, a ford or a bridge is drawn as
  what it is, with worn ground through it.
- **The level** of a district is lettered once on the ground at the way into
  it from the city's side: a number, 24 px, in ink at 75%.

### Rules

- **Edges are curves.** Banks, coasts, treelines and cliff lines are fitted
  through the tile data with bends no tighter than two tiles. A staircase of
  tile edges, or a run of tile diamonds, is a hard miss at sign-off.
- **Masses before pieces.** A wood is one canopy mass with a shared, lumpy
  contour, trunks showing only along its near edge, and a wash under it.
  Single trees are for open ground. The same goes for crags, reeds and ruins.
  This is also what keeps a landing readable when the view is at its widest.
- **Standing terrain is low.** A barrier mass is 1 to 1.5 T tall. A single
  tree or a ruin may reach 2 T. Nothing but the city is taller.
- **Variation by build.** Each standing family (a kind of tree, rock, ruin)
  has at least five builds that differ in outline: height, lean, crown,
  missing limbs. Changing only the size of one drawing does not count.
- **Density has a shape.** Detail is thickest round the city and in the
  pockets worth going to, and thins in the ground between. Open paper is
  allowed, as long as it is bounded by something drawn.
- **Difficulty is visible before anyone leaves the city.** An easy stop is
  open and pale, with low growth. A hard one carries more black: closer
  hatching, darker washes, bones and wrecks, more packs in sight.
- **Resources read as things to take.** Each kind has its own silhouette and
  a small spot of its own wash, and a worked-out one is drawn as worked out:
  an opened chest with its lid back, a flattened heap, a den with its mouth
  fallen in.
- **Paths are worn ground**: a pale band with broken hair-line edges and a
  few stones. Not rows of circles.
- **No place names.** Rivers, woods and districts are not lettered. The only
  lettering on the ground is in section 11.

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

- **Direction.** A blow, a shot, a throw and a knockback go along their true
  direction on the ground, at any angle. Only the body's facing snaps to four
  (section 5).
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
  minute fades into the paper. A fodder kill is wet for 0.3 seconds,
  spreading until 1 second and dry by 1.5.
- Wet ink never fades by transparency. It runs, breaks into drops, or soaks
  in.
- Ink is thrown along the direction of the blow that spilt it, in a fan
  about 60 degrees wide, and lands on the ground where a thrown liquid would:
  drops fly on arcs with shadows, and what has landed is flat on the plane.
- Bodies move smoothly, on every frame. Ink marks (arcs, splashes, bursts)
  are held drawings that change at most 12 times a second, like effects
  drawn by hand on twos.

## 10. Effects, projectiles and kills

All of it is stroke, blot or wash. No glow, no blur, no additive light, no
soft-edged particle, no drop shadow.

Citizens are small on a landing, so a fight is read from its effects. Each
effect below has a smallest size on screen that holds at every zoom.

- **Swings.** One dry-brush stroke along the weapon's path in the citizen's
  cloak colour, wet and dark at the leading end and breaking up at the tail.
  It lies in the plane at hand height, so it is part of an ellipse, and it may
  point any way round the citizen. Its reach fits the weapon; it is never
  under 60 px long or under 8 px wide at its wet end. It is a held drawing
  for 2 to 3 frames, then it breaks into drops.
- **Telegraphs.** The shape of the coming blow, flat on the ground, fills
  with red-brown hatching a stroke at a time, so its fullness says how soon.
  One shape for one blow, with a curved edge where the blow has one.
- **Arrows and spears.** A contour-weight shaft at least 20 px long with a
  streak behind it three times its length, 6 px wide and tapering, in the
  shooter's cloak colour, and a shadow on the ground under it. On a hit it
  stays in the target for a moment.
- **Sling stones.** A dot 8 px across on a visible arc with a 6 px shadow
  running along the ground beneath.
- **Firepots.** A dot 12 px across trailing loops of smoke at contour weight.
  Where it lands, an amber wash spreads in a ring on the ground with a
  hatched edge and burns down over its time, leaving a scorch in the burnt
  wash.
- **Boulders.** A hatched round at contour weight that turns as it rolls,
  with a flattened track behind it and dust at its foot.
- **Knockback.** A slide along the blow with two or three dust strokes at
  contour weight at the feet and a short skid line. Fodder hit by a blade
  travels 1 to 1.5 tiles in 0.15 seconds.
- **Kills.** Fodder burst in one frame into five to nine drops along the
  blow, each at least 5 px across, and a blot no more than 0.4 of a tile
  across. A pack monster or brute comes apart into the strokes it was drawn
  with, which fall and pool. An elite does that over half a second. A boss
  empties: ink runs out of it to the ground for a second and a half and
  leaves a stain large enough to be a landmark until the city leaves.
- **Stains.** They build up, so the ground shows where the fighting was.
  Stains that touch merge into one pool with one edge. No more than six
  blots are wet at once within three tiles of a citizen. Together stains
  cover no more than 8% of the frame; past that the oldest dry out. A stain
  is always lighter than a living monster standing on it.
- **A citizen downed.** It falls in the direction it was hit and lies in its
  own colours. No ink blot: ink is what monsters are made of.
- **Loot.** Drawn in its rarity colour (section 3). A drop on the ground is
  the outline of its kind (a weapon, a ring, a helm, a coat) at mid size and
  larger, and a dot in a ring at far size. A marker stands over anything
  worth walking to, thin enough to hide nobody:

  | Drop      | Marker                                                                  |
  | --------- | ----------------------------------------------------------------------- |
  | Salvage   | a small heap in ink, at mid and near size only                          |
  | Reroll    | as salvage, with a disc                                                 |
  | Magic     | a peg 1 T tall with a ringed bundle                                     |
  | Rare      | a pole 2 T tall with a swallowtail in the rare colour                   |
  | Add, Acid | a pole 2 T tall with a disc, black for Acid                             |
  | Unique    | a pole 3 T tall with a slip carrying its name, drawn in over one second |

  Only a unique has its name on the map. One slip is shown at a time, on the
  side of its pole away from the nearest citizens, and it covers no citizen
  and no name tag.
- **Numbers.** Roman, full ink with a paper halo, in three sizes by how
  large the blow is for its dealer: 30, 36 and 48 px. A crit is italic in the
  red-brown with a stroke under it. A number appears over the target's head,
  rises 20 px straight up over the half second it is held, and is gone in 0.2
  seconds. It never covers a citizen's head or a name tag. With more than
  about a dozen in frame, only crits and kills are lettered.
- **Hitpoints.** On a body they are shown by the drawing where possible (a
  stoop, a torn hem, thinned hatching). Where a measure is needed it is an
  arc of ink strokes on the ground at the feet, never a filled bar.

## 11. Lettering and the corners

### What may be lettered

Usernames, numbers, item names, icons and plain labels. That is the whole
list, for every frame.

- A **username** is shown whole and as typed, in roman, never in capitals or
  small capitals: case is part of the name.
- A **plain label** is one game noun or two, used the way a column head or an
  axis is: `kills`, `haul`, `lift-off`, `Medium`, `den`, `chest`, `packs`.
- An **icon** is a small drawing made with the pen at contour weight, 28 px
  tall, that stands for one noun: out, aboard, down, kills, banked, an
  element, a modifier.
- No sentence, and no caption that says what the picture already shows. Not
  "Legs planted · ramp coming down".
- No tag line of items chained with dots or commas. Not "Vale · tier 2 ·
  doubled packs · more rares". Each fact gets its own line or its own icon.
- No line written to sound like news or like a narrator. Not "lil_gremlin is
  nearest, 2 tiles", not "Unique dropped:".
- No titles, plate numbers, hours of the day, place names or invented names
  for citizens. Items are named the way the item generator names them.
- A count is a number beside an icon or under a label. A count is never a
  phrase.

### Type

- **The face** is IM Fell English: roman for everything, italic only for a
  crit's number.
- **Sizes** come from one scale: 24, 30, 36, 48. Nothing that carries
  information is set under 24 px, which is 8 px at 640. Text that will not
  fit is given more room or left out, never truncated with an ellipsis.
- Lettering is set at its size in screen pixels. It is never scaled with the
  camera.
- Lettering over the drawing has a paper halo 3 px wide. Lettering never sits
  on spot black.

### The frame

One contour-weight rule runs round the frame, 24 px in from its edge, with a
hair-line rule 8 px outside it. Everything is drawn inside it. There is no
strip under the picture and no second sheet of paper.

A landing's map is a diamond, so the frame's four corners are bare paper.
Each corner holds one block, 20 px inside the rule and no more than 400 px
wide and 210 px tall, except that log lines may run to 560 px. Nothing in a
corner has a box, a fill or a border round it; it is lettering and icons on
the paper. In transit the same four blocks sit over the pale ground with
their halos.

| Corner      | Holds                                                                               |
| ----------- | ----------------------------------------------------------------------------------- |
| Upper left  | the clock, and under it what the landing is                                         |
| Upper right | the roster                                                                          |
| Lower left  | the log                                                                             |
| Lower right | the counts: an icon and a number each for out, aboard, down, kills and items banked |

- **The clock** is a dial: a ring 96 px across at contour weight with a tick
  for each minute of the phase. The part of the phase that has passed is
  filled with spot black, clockwise from the top. Beside it is the time left,
  as a number at 48 px, and under the number one label at 24 px that says
  what it counts to: `landing` in transit, `lift-off` on a landing. From the
  horn the ring is drawn in the red-brown.
- **What the landing is.** Under the clock, one fact a line at 24 px: the
  size and the level range (`Medium 23–68`), then the element as an icon with
  no word, then each modifier as an icon or a short label with a number
  (`packs ×2`, `rares +40%`). Four lines at most. In transit the same lines
  describe the landing ahead.
- **The roster** is a fixed block: a head row with two column labels, three
  rows for the leaders, a hair-line rule, and two rows that page through
  everyone else every 3 seconds. A row is a small drawing of the citizen 28
  px tall, its username, and two right-aligned numbers. Row pitch 32 px. It
  does not change size with its contents, and a 25-character username fits.
- **The log** holds up to five lines at 24 px, the newest at the bottom, each
  shown for 8 seconds, with lines above the newest at 75% ink. A line is a
  dot in the citizen's cloak colour, the username, a 24 px gap, and then
  either an item's name in its rarity colour or one plain word:

  ```
  joshyboy88   Nine Lives
  pixelwitch   Swift War Axe of Thorns
  goofguy      down
  ```

  A unique's line is set at 30 px. An icon may stand before the item for
  where it came from (the bench, a chest, a den's elite).

### On the map

Only four kinds of lettering are drawn over the map, all at 24 px unless
they say otherwise:

- **Name tags.** A username centred over its citizen's hat, baseline 8 px
  above the hat's top, with the halo and a form-weight rule under it in the
  cloak colour. Its x follows the citizen every frame. Where two tags would
  overlap, the tag of the citizen further back goes up one tier of 30 px, to
  three tiers at most, and it changes tier over 0.3 seconds and only when the
  order of the citizens changes. A tag has no leader line and never covers a
  citizen's head. With 40 citizens or fewer in the frame every citizen has
  its tag at all times. With more, a tag goes to each citizen in the log, in
  the roster, down, or carrying a rare or a unique, and then to as many
  others as fit without a second tier; who is named changes no more than
  once every 5 seconds.
- **Labels.** A den's name and its level (`den_2 28`), a chest's level, a
  unique's name on its slip, a boss's name and level. A label sits beside its
  thing on the side with the most open ground and is drawn when the reveal
  reaches it.
- **Levels** at the ways into districts (section 8).
- **Damage numbers** (section 10).

A route a citizen has been sent on with `!go` is a hair-line of dashes along
its curved path on the ground, with a small flag at the end in the citizen's
colour.

## 12. The camera

There are two cameras, and one move between them. Nothing else moves the
view: there are no cuts, no follow shots and no insets.

| Camera          | T      | A citizen at 1920 | At 640 | In frame                                                    |
| --------------- | ------ | ----------------- | ------ | ----------------------------------------------------------- |
| Transit         | 112 px | 112 px            | 37 px  | the city and its legs, and the ground one leg's reach round |
| Landing, small  | 48 px  | 48 px             | 16 px  | the whole map, 32 by 32 tiles                               |
| Landing, medium | 40 px  | 40 px             | 13 px  | the whole map, 42 by 42 tiles                               |
| Landing, large  | 28 px  | 28 px             | 9 px   | the whole map, 60 by 60 tiles                               |

- **In transit** the camera sits low over the city and the frame is cramped
  on purpose. The hull is 1,232 px wide, about two thirds of the frame, and
  the feet reach to within about 260 to 290 px of the frame's sides. The
  middle of the deck sits about 85 px above the frame's middle, so that the
  lantern and every citizen are inside the rule; the feet nearest the camera
  may touch it. The hull's far corner (aft tiles with tx + ty under 3) is cut
  away or kept free of stations, and no station sits under the upper left
  corner's lettering. The ground shows only round and between the legs and slides
  toward the upper left as the city walks. Every citizen aboard is at near
  size, at 15 aboard and at 150.
- **Landed** the map's middle tile is at the frame's middle, 8 px low. The
  whole map and its rim are inside the rule at every size, with the corners
  left for lettering (section 11). The city is the largest thing on the map:
  528 px wide on a small landing, 440 on a medium one, 308 on a large one. The camera does
  not move again until the city leaves.
- **The move** from transit to landing takes 6 to 8 seconds, eased at both
  ends, with no cut and no cross-fade of the whole frame. The lantern mast is
  the anchor: it stays within 150 px of the frame's middle the whole way, and
  everything else scales round it.
- **The land is drawn as it is revealed.** Pulling back, the ground's
  contours are inked outward from the city, just inside the edge of the frame
  as it widens. Washes flood in half a second behind the line. Standing
  things rise in order of distance from the city, and packs, dens and chests
  rise with the ground they stand on. No ground mark is drawn before a line
  or a wash edge bounds the ground it is on. The rim is the last thing inked,
  and the black in its gaps comes with it.
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
6. Lettering is only what section 11 allows, and it is in the corners or is
   one of the four kinds drawn on the map.
7. No edge follows the tile grid in steps.
8. Everything stands on the one plane of section 4 and is sorted by it.
   Nothing is in side elevation or plan, and no frame is staged as a line or
   a lane.
9. Every citizen is in the frame and can be found: drawn in full or as an
   outline, in every frame of the capture.

Soft:

10. The silhouette test passes for any new body, at 12 px in solid black.
11. A new state has a pose, and a new blow has all its beats: coil, contact,
    hit-stop, follow-through.
12. Variation: no stamp repeated with only its size changed, and no crowd in
    step, in a grid or in a rank.
13. Ink behaves as ink: thrown along the blow, wet then spreading then dry.
14. Night is drawn in masses with rims toward the lantern.
15. The frame has one focus in transit and several on a landing, one for each
    pocket where something is happening, and a squint finds them before it
    finds anything else but the city and the horde.
16. The capture was looked at in day and night, at 1920 and at 640.

### What meets this today

The viewer on `main` draws the camp world, in plan, from before this page
set the projection. Checked against the captures of #330 and #333, 27
November 2026.

| Part                         | State                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Paper, ink and the Fell face | Kept. The day paper and ink and the face are the base this page builds on.                                             |
| The map's pen (`pen.ts`)     | Kept and extended: it wobbles and double-strokes but has no pressure, and only the ground uses it.                     |
| Projection                   | Not met. Ground in plan with figures in elevation, and no depth sorting beyond the feet.                               |
| Figures                      | Roughed in. No arms, no poses beyond stand, walk and sit, plain `stroke()` contours, detail that vanishes at far size. |
| Wolf                         | Closest to the standard: a clear silhouette. Needs the pen, rank, tone and the four facings.                           |
| Goblin                       | Roughed in. Drawn in a different manner from everything else.                                                          |
| Ground, trees, rocks, river  | Roughed in. Stamps, tile-stepped banks, airbrushed washes, per-pixel grain.                                            |
| Night and lamps              | Roughed in. An inverted outline drawing with gradient discs.                                                           |
| Fights and effects           | Roughed in. Movement of 3 to 6 px, no swing, kills as scribbled ovals.                                                 |
| Lettering and the page       | Not met. A table on separate paper with solid bars and truncated lines, place lettering, and sentences as captions.    |
| The city, landings, the zoom | Not drawn yet. The look target (#362) is the first drawing of them.                                                    |
