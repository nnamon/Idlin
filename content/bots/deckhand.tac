bot "Deckhand"

# The shipped program, which every chatter's citizen runs (docs/chat.md,
# section 9; docs/slice.md, section 5). It goes home to the hold by `lift_eta`
# and `way_home` (docs/tactics.md). On a landing it goes for the packs of its
# range, from 9 under its Arms to `over` above it, near ones first, and then
# waits at a den of that range for the next pack out. Nothing on a landing can
# be worked until slice piece 14, so with no pack or den left it walks about.

# Each param is a chat command: !gather, !fight, !careful, !margin 150 and so on.
param stance = gather of gather, fight, careful
# Seconds it wants to be home before the horde reaches the hull.
param margin = 120 from 0 to 240
# Kept for the pieces that read them (drops, ground levels, downs, the ramp).
# No rule reads them yet.
param keep = any of any, magic, rare
param over = 10 from 0 to 30
param aid = 6 from 0 to 20
param ramp = board of board, guard

when danger_here > 0 as "step out" -> step_clear
when hp * 3 < max_hp and flask > 0 as "drink" -> drink
when lift_eta < margin * 10 + way_home as "turn back" -> walk_to(hold)
when stance == careful and threat_distance <= 3 as "keep clear" -> flee(threat_x, threat_y)
when threat_distance <= weapon_reach as "strike" -> attack(threat_x, threat_y)
when stance == fight and threat_distance <= 8 as "go at it" -> step_to(threat_x, threat_y)

# The flag rules, together under the ones allowed to hold an order. One sent
# to a citizen keeps by them.
when flagged == 3 as "called home" -> walk_to(hold)
when flag_down as "to them" -> walk_to(flag)
when flagged and distance(flag) > 6 as "to the flag" -> walk_to(flag)
when flagged == 2 as "stay by them" -> walk_to(flag)
when flagged as "at the flag" -> wait(20)

# The packs of its range, and the dens that hold more. A careful citizen
# leaves them be.
when stance != careful and pack_distance(-9) <= 8 as "a pack here" ->
  walk_to(pack_x(-9), pack_y(-9))
when stance != careful and pack_distance(-9) < 9999 as "to a pack" ->
  walk_to(pack_x(-9), pack_y(-9))
when stance != careful and den_distance(-9) < 9999 as "to a den" ->
  walk_to(den_x(-9), den_y(-9))
otherwise as "look about" -> wander; wait(20)
