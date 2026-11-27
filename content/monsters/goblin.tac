bot "Goblin"

# By night goblins go into the camp's firelight after prey as a group that
# outnumbers the residents standing in it, as wolves do. The group is this
# goblin and the goblins within ten tiles of it (`friends_near(10)`, which counts
# only its own kind), against the residents in the light (`lit_enemies`). A
# goblin in the light that may not go after prey there, or has none there,
# walks out of it, and by day goblins keep out of it. Once anyone lies mending
# in the light after a down (`lit_mending`), a goblin has had its fill of the
# camp (`fill`) for a game hour: `fed` is the time of day, in minutes, it began.
when (hour >= 19 or hour < 6) and lit_mending > 0 and fill == 0 as "had its fill" ->
  set fill = 1; set fed = hour * 60 + minute; idle
when fill and (hour * 60 + minute - fed + 1440) mod 1440 >= 60 as "hungry again" ->
  set fill = 0; idle

# Goblins come in threes and rush whoever is near, but run once a blow has hurt
# them. One that tried to move and got nowhere stabs if it can, and otherwise
# heads off somewhere at random.
when hp * 2 <= max_hp and threat_distance <= 1 and stalled > 0 as "cornered" ->
  attack(threat_x, threat_y)
when stalled >= 2 as "nowhere to go" -> wander
when lit_here and (threat_lit == 0 or fill or friends_near(10) < lit_enemies or
  hour >= 6 and hour < 19) as "out of the light" -> flee(camp)
when hp * 2 <= max_hp and threat_distance < 8 as "run" -> flee(threat_x, threat_y)
when threat_distance <= 1 and (threat_lit == 0 or
  (hour >= 19 or hour < 6) and fill == 0 and friends_near(10) >= lit_enemies) as "stab" ->
  attack(threat_x, threat_y)
when (threat_distance <= 6 or lit_here) and (threat_lit == 0 or
  (hour >= 19 or hour < 6) and fill == 0 and friends_near(10) >= lit_enemies) as "rush" ->
  step_to(threat_x, threat_y)

# Out of a fight, goblins roam, day and night. Every goblin heads for the same
# place in the same half hour, so a group that came out together keeps
# together. West of the camp they go round the deep wood, the den, the south
# road and the den again; east of it, the river and the meadow by turns, so
# neither round crosses the light. At the place they stand a while.
when self_x <= 15 and (hour * 2 + minute / 30) mod 4 == 0 and distance(deep_wood) > 2 as "roam" ->
  step_to(deep_wood)
when self_x <= 15 and (hour * 2 + minute / 30) mod 2 == 1 and distance(den) > 2 as "roam" ->
  step_to(den)
when self_x <= 15 and (hour * 2 + minute / 30) mod 4 == 2 and distance(15, 16) > 2 as "roam" ->
  step_to(15, 16)
when self_x > 15 and (hour * 2 + minute / 30) mod 2 == 0 and distance(river) > 2 as "roam" ->
  step_to(river)
when self_x > 15 and (hour * 2 + minute / 30) mod 2 == 1 and distance(meadow) > 2 as "roam" ->
  step_to(meadow)
otherwise as "stand about" -> wait(20)
