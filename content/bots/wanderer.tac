bot "Wanderer"

# Stands and trades: goes up to anything that comes near and hits it until one of them drops.
when threat_distance <= 1 as "trade blows" -> attack(threat_x, threat_y)
# Three moves in a row that went nowhere: go somewhere else instead.
when stalled >= 3 as "find another way" -> wander
# Gives up a chase after forty steps, so it does not follow a monster that keeps
# running for ever; it takes up the chase again after it next banks.
when threat_distance <= 5 and chased < 40 as "go at it" ->
  set chased = chased + 1; step_to(threat_x, threat_y)

# Comes back to camp at nightfall and strolls about there until morning. It is
# back once it is near the edge of the wood above the camp, so a walk home that
# was cut short is taken up again.
when (hour >= 20 or hour < 6) and night == 0 and distance(near_wood) <= 4 as "back for the night" ->
  set night = 1; idle
when (hour >= 20 or hour < 6) and night == 0 as "back for the night" -> walk_to(near_wood)
when hour >= 20 or hour < 6 as "stroll, then rest" -> wander; wait(25)
when night == 1 as "morning" -> set night = 0; idle

# By day it cuts wood a bagful at a time and banks it. The bags come in turn
# from the camp's trees, the lower river's, and once it can cut old trees, the
# pinewood's. Where it starts in that round depends on where it first stood, so
# a crowd of wanderers does not all go one way. It sets off for another region
# only before 17:00, so it is back on the camp's map by nightfall.
when leg == 0 as "look about" -> set leg = 1 + (self_x + 2 * self_y) mod 3; idle
when at_bank and bag_free < 12 as "bank the logs" ->
  set chased = 0; set trips = trips + 1; bank_all
when bag_free == 0 as "home with the logs" -> walk_to(bank)
when (trips + leg) mod 3 == 1 and hour < 17 and
  self_y < 21 and bag_free == 12 as "off to the lower river" -> walk_to(lower_river)
when (trips + leg) mod 3 == 2 and hour < 17 and level(woodcutting) >= 15 and
  self_x >= 0 and bag_free == 12 as "off to the pinewood" -> walk_to(pinewood)
when node_distance(old_tree) == 0 as "chop" -> chop
when node_distance(old_tree) < 9999 as "to an old tree" -> walk_to(node_x(old_tree), node_y(old_tree))
when node_distance(tree) == 0 as "chop" -> chop
when node_distance(tree) < 9999 as "to a tree" -> walk_to(node_x(tree), node_y(tree))
# Nothing left standing here: home with what it has, or a stroll while the trees grow back.
when bag_free < 12 as "home with what it has" -> walk_to(bank)
otherwise as "stroll, then rest" -> wander; wait(25)
