bot "River walker"

# Fights by stepping out of every blow it sees coming, and hitting back in between.
when danger_here > 0 as "step out" -> step_clear
when threat_distance <= 1 as "strike" -> attack(threat_x, threat_y)
# Three moves in a row that went nowhere: go somewhere else instead.
when stalled >= 3 as "find another way" -> wander
when threat_distance <= 5 as "close in" -> step_to(threat_x, threat_y)

# Spends the day between the river and the bank, and sleeps at camp.
when hour >= 20 or hour < 5 as "night: sleep at camp" -> walk_to(camp); wait(200)
otherwise as "to the river and back" -> walk_to(river); wait(50); walk_to(bank); wait(30)
