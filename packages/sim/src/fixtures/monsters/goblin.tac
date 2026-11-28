bot "Goblin"

# A monster the fight tests are written on, from the camp world. Goblins rush
# whoever is near, but run once a blow has hurt them. One that tried to move
# and got nowhere stabs if it can, and otherwise heads off somewhere at random.
when hp * 2 <= max_hp and threat_distance <= 1 and stalled > 0 as "cornered" ->
  attack(threat_x, threat_y)
when stalled >= 2 as "nowhere to go" -> wander
when hp * 2 <= max_hp and threat_distance < 8 as "run" -> flee(threat_x, threat_y)
when threat_distance <= 1 as "stab" -> attack(threat_x, threat_y)
when threat_distance <= 6 as "rush" -> step_to(threat_x, threat_y)
# Out of a fight it roams.
otherwise as "roam" -> wander; wait(20)
