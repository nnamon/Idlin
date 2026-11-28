# Idlin: the art bible

This is the standard every `look` change is drawn to and signed off against.
The art director owns it ([AGENTS.md](../AGENTS.md), section 2) and changes it
by pull request like any other doc.

It is written for the game Idlin is becoming: a machine city that walks the
world on legs, stops at generated landings, and sends its residents out to
farm and fight before a horde arrives (#331). Most of what is on screen today
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
plate. The residents are the only strongly coloured things on it. Monsters are
drawn with more black than anything friendly, and when one dies the ink it was
drawn with spills on the ground and stays there. The title, the clock, the
names and the news are lettered on the plate the way a cartographer letters a
map, in the same ink.

Where it comes from, in spirit. None of these is to be copied.

- Engraved atlas and natural-history plates of the seventeenth and eighteenth
  centuries: ground in plan with towns and trees standing in elevation, shade
  built from hatching, cartouches and captions as part of the plate.
- Moebius: a clean contour that carries the form, a small number of flat
  colours, and large quiet areas that make the busy ones read.
- Tove Jansson's ink drawings: night as solid black masses with a little light
  cut out of them, and small figures that are clear at any size.
- The castle in "Howl's Moving Castle": a city as a heap of rooms and chimneys
  that sways when it walks.
- Brush calligraphy: a blow as one stroke that starts wet and ends dry.

## 2. The pen

There is one pen. Residents, monsters, the city, terrain, effects and
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
residents' own colours.

### Standing rules

- **Residents own saturated colour.** Cloak and hat colours are the only fills
  above 45% saturation on the plate, with two exceptions: lamp flame and loot.
  Terrain washes stay under 35%, monster washes under 20%.
- **Monsters own black.** Rank for rank a monster carries more spot black and
  closer hatching than a resident. A viewer tells the sides apart by colour
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
| the land beyond | `#a9b4b0` |
| accent: lamp    | `#f6cf6a` |

The land beyond the rail is drawn in ink at 40% strength with the one cool
wash, in two layers that slide past at different speeds. It has no contour
weight lines, so the city always sits in front of it.

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
- The city's lantern is the one large light. A resident's carried light
  reaches about one tile, enough to show its colours and no more. When many
  stand together their lights join into one shape with one edge.
- Monsters in the dark are a mass and two eyes in the accent colour until they
  come into the light.

### The horde

- The horde is spot black: a tide of ink coming from one edge, with single
  monsters picked out at its front by paper-coloured eyes and teeth. It is the
  only large black thing on a daytime plate, which is how a viewer at 640
  sees it coming.
- From the moment of landing, the margin on the horde's side takes a bruise
  wash (`#5a2a3a` at 15%), which deepens and spreads inward as the horde
  nears. That is the clock; no bar counts it down.
- The horde's leading edge is hatched in the red-brown of a blow about to
  land.
- Residents racing back keep their full colours. The city's lantern goes to
  the accent at full strength.

## 4. Projection and depth

- Ground is drawn in plan. Everything that stands on it is drawn in
  elevation, facing the viewer, as engraved maps draw towns and trees. The
  city, parked on a landing, is the largest elevation on the map.
- Things lower on the plate are in front. Standing things and bodies are
  sorted by their feet.
- Every body and every thing in the air has a ground shadow of a few hatch
  strokes. A projectile's height is the gap between it and its shadow.
- In the close-up the city is a cut-away: the near wall is left off each deck
  so every resident aboard can be seen.

## 5. Figures

A resident is drawn from the same construction at every size, with more of it
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

| Size | Where                         | Height at 1920 | What is drawn                                                                                                      |
| ---- | ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Far  | a landing, at 32 px a tile    | 28 to 34 px    | contour, cloak colour, hat colour and shape, head, the tool's silhouette, arms only while they are doing something |
| Mid  | a small landing, a fight held | 45 to 60 px    | adds legs and feet, the eye, the shade band, cloak pattern                                                         |
| Near | the city close-up, the page   | 90 to 120 px   | adds form lines, the mark on the cloak, death patches, kit detail, an expression                                   |

- At far size a figure is at most five shapes. Pattern, mark and patches are
  not drawn smaller; they are left out.
- A viewer finds their own resident at far size by cloak colour and hat
  colour and shape, in that order. Nothing else is asked of that size.
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
- A crowd is never drawn as a grid. Where the simulation puts residents on
  adjacent tiles, they are drawn off-centre on their tiles and overlapped by
  up to a third, sorted by their feet.
- In a crowd of thirty or more at far size, contour weight is kept only on
  the outline of each figure against the ground or a different colour; where
  two cloaks of like colour overlap, the line between them is form weight.

## 6. Monsters

Rank is the first thing a monster's drawing says. The ranks are the
simulation's: fodder, pack, brute, elite, boss.

| Rank   | Height against a resident | Line             | Tone                                    | Other                                                                                         |
| ------ | ------------------------- | ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Fodder | a half or less            | contour only     | one grey wash                           | drawn as a swarm: overlapping bodies share one outline, with many heads and legs              |
| Pack   | about the same            | contour and form | wash and open hatching                  | each drawn singly, in three or more variants of pose and build                                |
| Brute  | one and a half            | contour and form | close hatching, one area of spot black  | wide: at least twice a resident's width                                                       |
| Elite  | one and a half to two     | contour and form | crossed hatching, spot black, an accent | one feature no lesser monster of its kind has: a crest, a banner, a broken horn               |
| Boss   | three or more             | heavy contour    | crossed hatching and large spot black   | a name lettered beside it in the map's hand; a solid ground shadow; stands on 2 tiles or more |

- Each kind passes the silhouette test: filled solid black at 12 px tall, it
  can be told from every other kind and from a resident.
- Monsters are drawn in the same manner as each other and as the residents:
  side or three-quarter view, facing what they are after. No kind is drawn
  front-on like a mascot.
- Washes are greys and earths. Colour on a monster is one accent on an elite
  or boss.
- A monster's drawing shows its intent: stalking is low with the head down,
  winding up is a coil away from the target, fleeing is stretched out.
- A wounded monster loses ink: its hatching thins and breaks as its hitpoints
  go, so a nearly dead one is visibly lighter. No ring or bar is needed for
  that.

## 7. The city

The city is the main character and is on screen in every frame. It gets the
most drawing time of anything in the game.

### Build

- **Hull.** A riveted keel plate in heavy contour, the underside in crossed
  hatching and spot black. It is the darkest large shape on the plate.
- **Legs.** Six or eight, each of three segments with visible pinned joints
  and a piston, ending in a splayed foot plate. Heavy contour. Far-side legs
  are drawn in form weight with a 40% wash so the pairs separate.
- **Decks.** Stacked and uneven, as if built on over years: each deck is a
  different width, and roofs, stairs and gantries break the outline. The
  silhouette of the whole city is lumpy and lopsided, never a box.
- **The lantern mast.** The tallest thing aboard, with the lantern at its
  head. It is the anchor of the zoom (section 11) and the source of light at
  night.
- **Walls.** The rail of the top deck, where the playerbase fights in
  transit. Crenels and mounted weapons are drawn large enough to read at mid
  size.

### Districts

Each district aboard is told apart by three things and no label is needed:
one roofline no other district has, one wash from the transit palette that
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

- A step takes 1.5 to 2 seconds a leg. The foot lifts, reaches, plants, and
  the hull dips toward the leg that is in the air and rises as it plants.
- Hung things lag the hull: lamps, washing, hammocks and pennants swing after
  each step and settle before the next.
- A footfall is a ring of ink strokes and a puff of dust at the foot. The
  hull moves a few pixels. The camera does not shake.
- Parked, the city settles onto folded legs over about two seconds, and its
  chimneys keep smoking. It is never a still image.

## 8. Terrain and biomes

Landings are generated, so these are rules for a generator's drawing, with a
first set of biomes.

### Rules

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
- **Lettering follows the land.** A river's name runs along its curve, a
  wood's name is letter-spaced across it. Names keep clear of where bodies
  gather.

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
  arm is drawn behind the head. A resident's fast blow holds that for at
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
  35%, residents by 20%.
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
  it. **Dry**: it has stopped, lightens to a brown stain at 40%, and after a
  minute fades into the paper.
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

- **Swings.** One dry-brush stroke along the weapon's path in the resident's
  cloak colour, wet and dark at the leading end and breaking up at the tail.
  Its length and width fit the weapon. It is a held drawing for 2 to 3
  frames, then it breaks into drops.
- **Telegraphs.** The shape of the coming blow fills with red-brown hatching
  a stroke at a time, so its fullness says how soon. One shape for one blow,
  with a curved edge where the blow has one.
- **Arrows and spears.** A form-weight line with a streak behind it three
  times its length. On a hit it stays in the target for a moment.
- **Sling stones.** A dot on a visible arc with its shadow running along the
  ground beneath.
- **Firepots.** A dot trailing loops of smoke. Where it lands, an amber wash
  spreads in a ring with a hatched edge and burns down over its time, leaving
  a scorch in the burnt wash.
- **Boulders.** A hatched round at contour weight that turns as it rolls,
  with a flattened track behind it and dust at its foot.
- **Knockback.** A slide with two or three dust strokes at the feet and a
  short skid line.
- **Kills.** Fodder burst in one frame into five to nine drops along the
  blow and a small blot. A pack monster or brute comes apart into the strokes
  it was drawn with, which fall and pool. An elite does that over half a
  second. A boss empties: ink runs out of it to the ground for a second and
  a half and leaves a stain large enough to be a landmark until the city
  leaves.
- **Stains.** They build up, so the ground shows where the fighting was.
  Stains that touch merge into one pool with one edge. Together they cover no
  more than 8% of the frame; past that the oldest dry out.
- **A resident downed.** It falls in the direction it was hit and lies in its
  own colours. No ink blot: ink is what monsters are made of.
- **Loot.** Drawn in colour, as residents are. Rarity is an ornament on its
  outline: none, one ring, a ring with ticks, and for a unique a small
  cartouche with its name.
- **Numbers.** Lettered in the plate's roman, in three sizes by how large
  the blow is for its dealer; a crit is italic with a stroke under it. They
  rise along the blow's direction and never cover a resident. With more than
  about a dozen in frame, only crits and kills are lettered.
- **Hitpoints.** On a body they are shown by the drawing where possible (a
  stoop, a torn hem, thinned hatching). Where a measure is needed it is an
  arc of ink strokes at the feet, never a filled bar.

## 11. Type and the plate

The lettering and the interface are part of the plate. Anything on screen
must be something an engraver could have put there: a cartouche, a banner, a
legend, a caption, a margin note, a scale, a compass, a plate number. A
filled rectangle used as a meter, a solid line in a pure hue, a rounded
chip, a thumbnail pasted in a box: none of those exist on a plate.

- **The face** is IM Fell English. Small capitals for names of people and
  places, italic for what is happening, roman for numbers and the title.
- **Sizes** come from one scale: 24, 30, 36, 48, 72. Nothing that carries
  information is set under 24 px, which is 8 px at 640. Text that will not
  fit is rewritten shorter, never truncated with an ellipsis.
- **Hierarchy.** One thing on the plate is largest. In transit and on a
  landing that is the drawing itself; among the lettering it is the caption
  with the news. The title is a plate title, small, in the cartouche.
- **One border.** The plate has one double rule round all of it. The
  cartouche, the legend and the caption sit inside it and may overlap the
  drawing's quiet corners; they are not a second column on other paper.
- **The cartouche** holds the title, the hour, and the phase of the cycle
  (in transit, landed, the horn). It is drawn with a frame in form weight.
- **The legend** is where residents are listed when they are. Each entry is
  a small drawing of the resident, its name, and one line. A measure in the
  legend is a hair-line rule that shortens, turning red-brown under 30%.
  With more residents than the legend holds at 24 px, it shows the ones
  something is happening to, and says how many it leaves out.
- **Names on the map** are banners: a strip of paper with the name, a
  swallow tail, and a short stroke to its owner. They obey the same day and
  night ink as everything else. With every resident on screen not all can
  be named at once, so banners go to those in the news, the legend or a
  fight, and they come and go slowly.
- **Routes and intentions** are drawn as an engraver marks a march: a
  hair-line of dashes in ink along the curved path, with only the end cross
  in the walker's colour.
- **The overview**, where there is one, is a small engraved map with a rule
  round it, drawn with the pen like the rest.
- **Captions and news** are set as the plate's caption under the lower rule.

## 12. The zoom between city and landing

The change between transit and landing is one camera move, composed at both
ends. It is the shot that sells the game, and it happens two or three times
an hour.

- **In transit** the city fills about four fifths of the frame's width. Its
  hull sits on the lower third line, the lantern mast reaches into the upper
  third, and the land slides by beneath and behind. Every resident aboard is
  at near or mid size.
- **Landed** the city is parked off-centre, away from the side the horde
  will come from, so the plate has room on the side where things will
  happen. On an easy stop it takes a third of the frame's width and the map
  is a clearing. On a hard one it takes an eighth and the valley is the
  picture.
- **The move** takes 6 to 8 seconds, eased at both ends, with no cut and no
  cross-fade of the whole frame. The lantern mast is the anchor: it travels
  on one smooth curve from where it is in the close-up to where it is on the
  landing, and everything else scales round it.
- **The land is drawn as it is revealed.** Pulling back, the ground's
  contours are inked outward from the city, just inside the edge of the
  frame as it widens. Washes flood in half a second behind the line.
  Standing things rise in order of distance. A viewer watches the plate
  being drawn.
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
5. The palette rules hold: residents own saturated colour, and the darkest
   tenth of the frame is the city, monsters and lettering.
6. Interface elements are plate furniture (section 11).
7. No edge follows the tile grid in steps.

Soft:

8. The silhouette test passes for any new body, at 12 px in solid black.
9. A new state has a pose, and a new blow has all its beats: coil, contact,
   hit-stop, follow-through.
10. Variation: no stamp repeated with only its size changed, and no crowd in
    step or in a grid.
11. Ink behaves as ink: thrown along the blow, wet then spreading then dry.
12. Night is drawn in masses with rims toward the lantern.
13. The frame has one focus, and a squint finds it.
14. The capture was looked at in day and night, at 1920 and at 640.

### What meets this today

Checked against the captures of #330 and #333, 27 November 2026.

| Part                         | State                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Paper, ink and the Fell face | Kept. The day paper and ink, the place lettering and the double rule are the base this page builds on.                 |
| The map's pen (`pen.ts`)     | Kept and extended: it wobbles and double-strokes but has no pressure, and only the ground uses it.                     |
| Figures                      | Roughed in. No arms, no poses beyond stand, walk and sit, plain `stroke()` contours, detail that vanishes at far size. |
| Wolf                         | Closest to the standard: a clear silhouette. Needs the pen, rank, and tone.                                            |
| Goblin                       | Roughed in. Drawn in a different manner from everything else.                                                          |
| Ground, trees, rocks, river  | Roughed in. Stamps, tile-stepped banks, airbrushed washes, per-pixel grain.                                            |
| Night and lamps              | Roughed in. An inverted outline drawing with gradient discs.                                                           |
| Fights and effects           | Roughed in. Movement of 3 to 6 px, no swing, kills as scribbled ovals.                                                 |
| The page                     | Roughed in. A table on separate paper, with solid bars and truncated lines.                                            |
| The city, biomes, the zoom   | Not drawn yet.                                                                                                         |
