bot "Wanderer"

# A program from the camp world, kept for the tests written on it. Stands and
# trades: goes up to anything that comes near and hits it until one of them
# drops.
when threat_distance <= 1 as "trade blows" -> attack(threat_x, threat_y)
# Three moves in a row that went nowhere: go somewhere else instead.
when stalled >= 3 as "find another way" -> wander
# Gives up a chase after forty steps, so it does not follow a monster that keeps
# running for ever; it takes up the chase again after it next banks.
when threat_distance <= 5 and chased < 40 as "go at it" ->
  set chased = chased + 1; step_to(threat_x, threat_y)

# It cuts wood a bagful at a time and banks it, old trees first once it can
# cut them.
when at_bank and bag_free < 12 as "bank the logs" -> set chased = 0; bank_all
when bag_free == 0 as "home with the logs" -> walk_to(bank)
when node_distance(old_tree) == 0 as "chop" -> chop
when node_distance(old_tree) < 9999 as "to an old tree" -> walk_to(node_x(old_tree), node_y(old_tree))
when node_distance(tree) == 0 as "chop" -> chop
when node_distance(tree) < 9999 as "to a tree" -> walk_to(node_x(tree), node_y(tree))
# Nothing left standing here: home with what it has, or a stroll while the trees grow back.
when bag_free < 12 as "home with what it has" -> walk_to(bank)
otherwise as "stroll, then rest" -> wander; wait(25)
