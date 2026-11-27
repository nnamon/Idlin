bot "Homebody"

# Keeps out of reach, and only goes in to strike while the monster gets its balance
# back: with time for a step for every tile between them but the last, so it is
# beside the monster and swinging before the monster can move again.
when danger_here > 0 as "step out" -> step_clear
when threat_recovering > 3 and threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
when threat_recovering > 6 * threat_distance - 6 and threat_distance <= 3 as "move in" ->
  step_to(threat_x, threat_y)
when threat_distance <= 1 as "keep away" -> flee(threat_x, threat_y)
# Watches for twenty seconds or so, then backs off, so it never waits forever on a
# monster that can't get at it across a wall.
when threat_distance <= 6 and watched < 40 as "watch it" -> set watched = watched + 1; wait(5)
when threat_distance <= 6 as "back off" -> set watched = 0; flee(threat_x, threat_y)

# Sits by the fire all night.
when hour >= 19 or hour < 6 as "night: stay by the fire" -> walk_to(camp); wait(120)

# By day it cuts the trees near camp and banks the logs a bagful at a time. It
# goes to a tree only while it is within 8 tiles of camp, so it never strays far.
when at_bank and bag_free < 12 as "bank the logs" -> bank_all
when bag_free == 0 as "home with the logs" -> walk_to(bank)
when node_distance(tree) == 0 as "chop" -> chop
when node_distance(tree) <= 10 and distance(camp) <= 8 as "to a tree" ->
  walk_to(node_x(tree), node_y(tree))
when distance(camp) > 6 as "too far: turn back" -> walk_to(camp)
otherwise as "potter about" -> wander; wait(30)
