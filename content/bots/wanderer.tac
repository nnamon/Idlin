bot "Wanderer"

# Stands and trades: goes up to anything that comes near and hits it until one of them drops.
when threat_distance <= 1 as "trade blows" -> attack(threat_x, threat_y)
# Three moves in a row that went nowhere: go somewhere else instead.
when stalled >= 3 as "find another way" -> wander
when threat_distance <= 5 as "go at it" -> step_to(threat_x, threat_y)

# Otherwise has nothing to do yet: strolls somewhere, rests a moment, strolls on.
otherwise as "stroll, then rest" -> wander; wait(25)
