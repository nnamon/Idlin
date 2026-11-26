bot "Goblin"

# Remembers where it came out, and keeps to that part of the map. By day it keeps
# well away from the fire; by night it comes up to the camp's edge.
when home_x == 0 and home_y == 0 -> set home_x = self_x; set home_y = self_y; idle
when distance(camp) < 5 and hour >= 6 and hour < 19 as "shy of the fire" -> walk_to(home_x, home_y)
when distance(camp) < 4 as "shy of the fire" -> walk_to(home_x, home_y)

# Goblins come in threes and rush whoever is near, but run once a blow has hurt
# them. One that tried to move and got nowhere stabs if it can, and otherwise
# heads off somewhere at random.
when hp * 2 <= max_hp and threat_distance <= 1 and stalled > 0 as "cornered" ->
  attack(threat_x, threat_y)
when stalled >= 2 as "nowhere to go" -> wander
when hp * 2 <= max_hp and threat_distance < 8 as "run" -> flee(threat_x, threat_y)
when threat_distance <= 1 as "stab" -> attack(threat_x, threat_y)
when threat_distance <= 6 as "rush" -> step_to(threat_x, threat_y)
# Otherwise it walks between home and a tile two off it: east if that can be walked
# on, else west, else south or north.
when walkable(home_x + 2, home_y) as "loiter" ->
  walk_to(home_x + 2, home_y); wait(50); walk_to(home_x, home_y); wait(40)
when walkable(home_x - 2, home_y) as "loiter" ->
  walk_to(home_x - 2, home_y); wait(50); walk_to(home_x, home_y); wait(40)
otherwise as "loiter" ->
  walk_to(home_x, home_y + 2 - 4 * (walkable(home_x, home_y + 2) == 0)); wait(50);
  walk_to(home_x, home_y); wait(40)
