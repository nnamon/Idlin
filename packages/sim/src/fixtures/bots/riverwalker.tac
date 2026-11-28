bot "River walker"

# A program from the camp world, kept for the tests written on it. Fights by
# stepping out of every blow it sees coming, and hitting back in between.
when danger_here > 0 as "step out" -> step_clear
# Eats a cooked fish once it is 7 hitpoints down, in a fight or out of one.
when hp <= max_hp - 7 and carrying(cooked_fish) > 0 as "eat" -> eat
when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
# Three moves in a row that went nowhere: go somewhere else instead.
when stalled >= 3 as "find another way" -> wander
when threat_distance <= 5 as "close in" -> step_to(threat_x, threat_y)

# It catches four fish, cuts a log for each, cooks them at the fire and banks
# the rest. Three cooked fish stay in the bag for the next fight.
when at_fire and carrying(raw_fish) > 0 and carrying(logs) > 0 as "cook" -> cook
when carrying(raw_fish) >= 4 and carrying(logs) >= carrying(raw_fish) as "to the fire" ->
  walk_to(fire)
when at_bank and carrying(burnt_fish) > 0 as "bank the burnt" -> deposit(burnt_fish, 12)
when at_bank and carrying(cooked_fish) > 3 as "bank" ->
  deposit(cooked_fish, carrying(cooked_fish) - 3)
when carrying(burnt_fish) > 0 or carrying(cooked_fish) > 3 as "to the bank" -> walk_to(bank)
when carrying(raw_fish) < 4 and node_distance(fishing_spot) == 0 as "fish" -> fish
when carrying(raw_fish) < 4 and node_distance(fishing_spot) < 9999 as "to a fishing spot" ->
  walk_to(node_x(fishing_spot), node_y(fishing_spot))
when carrying(logs) < carrying(raw_fish) and node_distance(tree) == 0 as "chop" -> chop
when carrying(logs) < carrying(raw_fish) and node_distance(tree) < 9999 as "to a tree" ->
  walk_to(node_x(tree), node_y(tree))
# Every spot fished out: wait by the river for one to come back.
otherwise as "wait at the river" -> walk_to(river); wait(50)
