bot "Homebody"

# Never strays far from the lantern, and sits by the fire all night.
when hour >= 19 or hour < 6 as "night: stay by the fire" -> walk_to(camp); wait(120)
when distance(camp) > 6 as "too far: turn back" -> walk_to(camp)
otherwise as "potter about" -> wander; wait(30)
