bot "Wanderer"

# Stands and trades: goes up to anything that comes near and hits it until one of them drops.
when threat_distance <= 1 as "trade blows" -> attack(threat_x, threat_y)
# Three moves in a row that went nowhere: go somewhere else instead.
when stalled >= 3 as "find another way" -> wander
# Gives up a chase after forty steps, so it does not follow a monster that keeps
# running for ever; it takes up the chase again after its next stroll.
when threat_distance <= 5 and chased < 40 as "go at it" ->
  set chased = chased + 1; step_to(threat_x, threat_y)

# Comes back to camp at nightfall and strolls about there until morning. It is
# back once it is near the edge of the wood above the camp, so a walk home that
# was cut short is taken up again.
when (hour >= 20 or hour < 6) and night == 0 and distance(near_wood) <= 4 as "back for the night" ->
  set night = 1; idle
when (hour >= 20 or hour < 6) and night == 0 as "back for the night" -> walk_to(near_wood)
# By day it strolls about the camp's map, and after every six strolls it sets
# off for a place past the map's edge, strolls there three times and comes
# back: the pinewood, the hills, then the lower river, and round again. Where it
# starts in that round depends on where it first stood, so a crowd of wanderers
# does not all go one way.
when leg == 0 as "look about" -> set leg = 6 + 2 * ((self_x + 2 * self_y) mod 3); idle
when strolls >= 3 and hour >= 6 and hour < 20 and leg mod 2 == 1 as "back to camp" ->
  set night = 0; set strolls = 0; set leg = leg + 1; walk_to(near_wood)
when strolls >= 6 and hour >= 6 and hour < 20 and leg mod 6 == 0 as "off to the pinewood" ->
  set night = 0; set strolls = 0; set leg = leg + 1; walk_to(pinewood)
when strolls >= 6 and hour >= 6 and hour < 20 and leg mod 6 == 2 as "off to the hills" ->
  set night = 0; set strolls = 0; set leg = leg + 1; walk_to(hills)
when strolls >= 6 and hour >= 6 and hour < 20 and leg mod 2 == 0 as "off to the lower river" ->
  set night = 0; set strolls = 0; set leg = leg + 1; walk_to(lower_river)

# Otherwise strolls about wherever it is, rests a moment, strolls on.
otherwise as "stroll, then rest" ->
  set strolls = strolls + 1; set chased = 0; wander; wait(25)
