bot "Wolf"

# A wolf hunts residents who are fewer than its pack, and turns away from a
# group much bigger than its pack. By day wolves come in twos and threes; by
# night in packs of three to five. "Prey" below is the nearest resident, and
# its group is the prey and the residents within four tiles of it
# (`threat_friends`). The pack is
# this wolf and the wolves within ten tiles of it (`friends_near(10)`, which
# counts only its own kind), so wolves on all sides of their prey count each
# other.
#
# By night the camp's firelight is no refuge from a pack that outnumbers the
# residents standing in it: then a wolf goes into the light after its prey.
# `friends_near(10) >= lit_enemies` says whether the pack outnumbers the
# residents in the light. A pack that is outnumbered there keeps out of it.
# A wolf has had its fill of the camp once it has bitten three times at prey in
# the light, or once anyone lies mending in the light after a down
# (`lit_mending`), so every wolf leaves after the first down there. It leaves
# the light and keeps out of it for a game hour from its last bite there or
# from the down. `raid` counts those bites and is set to 3 by a down, `fed` is
# the time of day, in minutes, of the last of them, and
# `raid < 3 * (hour >= 19 or hour < 6)` says whether it may still go in: by
# day that is never, so by day a wolf keeps out of the light.

when (hour >= 19 or hour < 6) and lit_mending > 0 and raid < 3 as "had its fill" ->
  set raid = 3; set fed = hour * 60 + minute; idle
when raid >= 3 and (hour * 60 + minute - fed + 1440) mod 1440 >= 60 as "hungry again" ->
  set raid = 0; idle

# Lunges when its prey is in line and in reach with nothing between them, twice
# at most from one tile. From two tiles off it lunges only at prey that is
# standing: one that is walking would be out of the way by the time the blow
# lands. One standing in the light lunges only if it may be there; otherwise it
# walks out first.
when (threat_lit == 0 and lit_here == 0 or
  friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  (lunges < 2 or self_x != lunge_x or self_y != lunge_y) and
  (threat_distance <= 1 or threat_distance == 2 and threat_moving == 0) and
  (threat_x == self_x or threat_y == self_y) and
  walkable(self_x + (threat_x > self_x) - (threat_x < self_x),
    self_y + (threat_y > self_y) - (threat_y < self_y)) as "lunge" ->
  set lunges = (self_x == lunge_x) * (self_y == lunge_y) * lunges + 1;
  set lunge_x = self_x; set lunge_y = self_y; set raid = raid + threat_lit;
  set fed = fed + threat_lit * (hour * 60 + minute - fed); attack(threat_x, threat_y)

# A night round's legs through the camp end once the wolf is in the light.
when (night_leg == 1 or night_leg == 7) and lit_here as "roam" ->
  set night_leg = (night_leg + 1) mod 8; idle

# Outnumbered in the firelight, done with the camp for now, or in it by day, it
# walks out of it.
when lit_here and
  (friends_near(10) < lit_enemies or raid >= 3 * (hour >= 19 or hour < 6)) as "out of the light" ->
  flee(camp)

# A chase that reaches the light while the wolf may not go in stops at its edge,
# and the wolf paces there for a few seconds before it goes back to its round.
when threat_lit and (friends_near(10) < lit_enemies or raid >= 3 * (hour >= 19 or hour < 6)) and
  pace > 0 as "pace the edge" ->
  set pace = pace - 1; step_to(self_x + 1 - 2 * (pace mod 2), self_y); wait(15)

# One whose moves get it nowhere four times in a row heads off somewhere at random.
when stalled >= 4 as "stuck" -> wander

# Prey within ten tiles that the wolf may go after, whose group is bigger than
# the pack by two or more: left alone.
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 and threat_friends >= friends_near(10) + 2 as "back off" ->
  set pace = 0; flee(threat_x, threat_y)

# Bigger by one: stalked from four or five tiles off until another of the pack
# comes within ten tiles of the wolf, or the prey leaves its friends.
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 and threat_friends == friends_near(10) + 1 and
  threat_distance < 4 as "stalk" ->
  set pace = 3; step_to(2 * self_x - threat_x, 2 * self_y - threat_y)
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 and threat_friends == friends_near(10) + 1 and
  threat_distance > 5 as "stalk" -> set pace = 3; step_to(threat_x, threat_y)
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 and threat_friends == friends_near(10) + 1 as "stalk" ->
  set pace = 3; idle

# No more residents than wolves: hunted, run down while it walks, and circled
# two tiles off while it stands, which gives the wolf its lunge from out of the
# prey's reach. A wolf whose circling gets it nowhere twice in a row steps
# straight at its prey instead.
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 and (threat_distance > 2 or threat_moving) as "hunt" ->
  set pace = 3; step_to(threat_x, threat_y)
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 and stalled >= 2 as "press in" -> set pace = 3; step_to(threat_x, threat_y)
when (threat_lit == 0 or friends_near(10) >= lit_enemies and raid < 3 * (hour >= 19 or hour < 6)) and
  threat_distance <= 10 as "circle" ->
  set pace = 3; set turn = (turn + 1) mod 4;
  walk_to(threat_x + 2 * (turn == 0) - 2 * (turn == 2), threat_y + 2 * (turn == 1) - 2 * (turn == 3))

# With no prey near, by night it walks a round of the whole camp's map: the near
# wood, into the camp's light, the meadow, the river, the south road, the den,
# the deep wood and into the light again. Where the pack may not go into the
# light, it is turned back at the edge.
when (hour >= 19 or hour < 6) and night_leg == 0 and distance(near_wood) <= 2 as "roam" ->
  set night_leg = 1; idle
when (hour >= 19 or hour < 6) and night_leg == 2 and distance(meadow) <= 2 as "roam" ->
  set night_leg = 3; idle
when (hour >= 19 or hour < 6) and night_leg == 3 and distance(river) <= 2 as "roam" ->
  set night_leg = 4; idle
when (hour >= 19 or hour < 6) and night_leg == 4 and distance(15, 16) <= 2 as "roam" ->
  set night_leg = 5; idle
when (hour >= 19 or hour < 6) and night_leg == 5 and distance(den) <= 2 as "roam" ->
  set night_leg = 6; idle
when (hour >= 19 or hour < 6) and night_leg == 6 and distance(deep_wood) <= 2 as "roam" ->
  set night_leg = 7; idle
when (hour >= 19 or hour < 6) and (night_leg == 1 or night_leg == 7) as "roam" ->
  set pace = 0; step_to(camp)
when (hour >= 19 or hour < 6) and night_leg == 2 as "roam" -> set pace = 0; step_to(meadow)
when (hour >= 19 or hour < 6) and night_leg == 3 as "roam" -> set pace = 0; step_to(river)
when (hour >= 19 or hour < 6) and night_leg == 4 as "roam" -> set pace = 0; step_to(15, 16)
when (hour >= 19 or hour < 6) and night_leg == 5 as "roam" -> set pace = 0; step_to(den)
when (hour >= 19 or hour < 6) and night_leg == 6 as "roam" -> set pace = 0; step_to(deep_wood)
when hour >= 19 or hour < 6 as "roam" -> set pace = 0; step_to(near_wood)

# By day the round is the near wood, the meadow, the river, the den and the
# deep wood.
when leg == 0 and distance(near_wood) <= 2 as "roam" -> set leg = 1; idle
when leg == 1 and distance(meadow) <= 2 as "roam" -> set leg = 2; idle
when leg == 2 and distance(river) <= 2 as "roam" -> set leg = 3; idle
when leg == 3 and distance(den) <= 2 as "roam" -> set leg = 4; idle
when leg == 4 and distance(deep_wood) <= 2 as "roam" -> set leg = 0; idle
when leg == 1 as "roam" -> set pace = 0; step_to(meadow)
when leg == 2 as "roam" -> set pace = 0; step_to(river)
when leg == 3 as "roam" -> set pace = 0; step_to(den)
when leg == 4 as "roam" -> set pace = 0; step_to(deep_wood)
otherwise as "roam" -> set pace = 0; step_to(near_wood)
