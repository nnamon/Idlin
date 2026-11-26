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

# Never strays far from the lantern, and sits by the fire all night.
when hour >= 19 or hour < 6 as "night: stay by the fire" -> walk_to(camp); wait(120)
when distance(camp) > 6 as "too far: turn back" -> walk_to(camp)
otherwise as "potter about" -> wander; wait(30)
