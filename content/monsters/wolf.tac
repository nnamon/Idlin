bot "Wolf"

# Remembers where it came out, and keeps to that part of the map. By day it keeps
# well away from the fire; by night it comes up to the camp's edge.
when home_x == 0 and home_y == 0 -> set home_x = self_x; set home_y = self_y; idle
when distance(camp) < 5 and hour >= 6 and hour < 19 as "shy of the fire" -> walk_to(home_x, home_y)
when distance(camp) < 4 as "shy of the fire" -> walk_to(home_x, home_y)

# Lunges when its prey is in line and in reach with nothing between them, twice at
# most from one tile; otherwise circles it, two tiles off. Prey that keeps stepping
# out of the way gets circled instead of lunged at for ever. A wolf whose circling
# gets it nowhere twice in a row steps straight at its prey instead, and one that
# gets nowhere four times in a row heads off somewhere at random.
when (lunges < 2 or self_x != lunge_x or self_y != lunge_y) and threat_distance <= 2 and
  (threat_x == self_x or threat_y == self_y) and
  walkable(self_x + (threat_x > self_x) - (threat_x < self_x),
    self_y + (threat_y > self_y) - (threat_y < self_y)) as "lunge" ->
  set lunges = (self_x == lunge_x) * (self_y == lunge_y) * lunges + 1;
  set lunge_x = self_x; set lunge_y = self_y;
  attack(threat_x, threat_y)
when stalled >= 4 as "nowhere to go" -> wander
when stalled >= 2 and threat_distance <= 8 as "press in" -> step_to(threat_x, threat_y)
when threat_distance <= 8 as "circle" ->
  set turn = (turn + 1) mod 4;
  walk_to(threat_x + 2 * (turn == 0) - 2 * (turn == 2), threat_y + 2 * (turn == 1) - 2 * (turn == 3))
# Otherwise it prowls between home and a tile three off it: east if that can be
# walked on, else west, else south or north.
when walkable(home_x + 3, home_y) as "prowl" ->
  walk_to(home_x + 3, home_y); wait(40); walk_to(home_x, home_y); wait(30)
when walkable(home_x - 3, home_y) as "prowl" ->
  walk_to(home_x - 3, home_y); wait(40); walk_to(home_x, home_y); wait(30)
otherwise as "prowl" ->
  walk_to(home_x, home_y + 3 - 6 * (walkable(home_x, home_y + 3) == 0)); wait(40);
  walk_to(home_x, home_y); wait(30)
