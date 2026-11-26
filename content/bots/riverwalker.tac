bot "River walker"

# Spends the day between the river and the bank, and sleeps at camp.
when hour >= 20 or hour < 5 as "night: sleep at camp" -> walk_to(camp); wait(200)
otherwise as "to the river and back" -> walk_to(river); wait(50); walk_to(bank); wait(30)
