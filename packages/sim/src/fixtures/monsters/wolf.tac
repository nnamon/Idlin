bot "Wolf"

# A monster the fight tests are written on, from the camp world. A wolf hunts
# citizens who are fewer than its pack, and turns away from a group much
# bigger than its pack. "Prey" below is the nearest citizen, and its group is
# the prey and the citizens within four tiles of it (`threat_friends`). The
# pack is this wolf and the wolves within ten tiles of it (`friends_near(10)`,
# which counts only its own kind), so wolves on all sides of their prey count
# each other.

# Lunges when its prey is in line and in reach with nothing between them, twice
# at most from one tile. From two tiles off it lunges only at prey that is
# standing: one that is walking would be out of the way by the time the blow
# lands.
when (lunges < 2 or self_x != lunge_x or self_y != lunge_y) and
  (threat_distance <= 1 or threat_distance == 2 and threat_moving == 0) and
  (threat_x == self_x or threat_y == self_y) and
  walkable(self_x + (threat_x > self_x) - (threat_x < self_x),
    self_y + (threat_y > self_y) - (threat_y < self_y)) as "lunge" ->
  set lunges = (self_x == lunge_x) * (self_y == lunge_y) * lunges + 1;
  set lunge_x = self_x; set lunge_y = self_y; attack(threat_x, threat_y)

# One whose moves get it nowhere four times in a row heads off somewhere at random.
when stalled >= 4 as "stuck" -> wander

# Prey within ten tiles whose group is bigger than the pack by two or more:
# left alone.
when threat_distance <= 10 and threat_friends >= friends_near(10) + 2 as "back off" ->
  flee(threat_x, threat_y)

# Bigger by one: stalked from four or five tiles off until another of the pack
# comes within ten tiles of the wolf, or the prey leaves its friends.
when threat_distance <= 10 and threat_friends == friends_near(10) + 1 and
  threat_distance < 4 as "stalk" -> step_to(2 * self_x - threat_x, 2 * self_y - threat_y)
when threat_distance <= 10 and threat_friends == friends_near(10) + 1 and
  threat_distance > 5 as "stalk" -> step_to(threat_x, threat_y)
when threat_distance <= 10 and threat_friends == friends_near(10) + 1 as "stalk" -> idle

# No more citizens than wolves: hunted, run down while it walks, and circled
# two tiles off while it stands, which gives the wolf its lunge from out of the
# prey's reach. A wolf whose circling gets it nowhere twice in a row steps
# straight at its prey instead.
when threat_distance <= 10 and (threat_distance > 2 or threat_moving) as "hunt" ->
  step_to(threat_x, threat_y)
when threat_distance <= 10 and stalled >= 2 as "press in" -> step_to(threat_x, threat_y)
when threat_distance <= 10 as "circle" ->
  set turn = (turn + 1) mod 4;
  walk_to(threat_x + 2 * (turn == 0) - 2 * (turn == 2), threat_y + 2 * (turn == 1) - 2 * (turn == 3))

# With no prey near it roams.
otherwise as "roam" -> wander; wait(20)
