# Roadmap

The issue tracker is where the actual work is listed. This page says what each
milestone is for and how to tell when it's finished.

## M1: First Light

One map (a camp with a lantern, a wood, a river, a den), six adventurers on
three built-in programs, two kinds of monster on programs of their own, and a
day/night cycle. The aim is something you could leave running on a second
screen and not get bored of in ten minutes.

| Part                                                                     | State                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Simulation core: map, movement, clock, replay, snapshots                 | done                                                        |
| Bot VM                                                                   | done                                                        |
| Tactics, the scripting language, and its compiler                        | done                                                        |
| Viewer: the map, the characters, day and night                           | done                                                        |
| Capture tool and the metrics for judging how it watches                  | done, except acknowledgment and the metrics that need trips |
| Combat with telegraphed attacks; monsters as scripted content            | not started                                                 |
| Skills (Melee, Woodcutting, Fishing, Cooking, Hitpoints), banking, death | not started                                                 |
| Items with rarity and rolled affixes; bots that choose what to wear      | not started                                                 |
| Spotlight panel and a real news line                                     | the director that picks the subject is done; nothing drawn  |
| Server: the world running in real time, snapshots, WebSocket             | done                                                        |

M1 is finished when all of these hold:

1. `docker compose up server client` shows the world at `localhost:4310`, and
   restarting the server doesn't lose progress.
2. A headless run of 24 simulated hours finishes with no error and no actor
   stuck.
3. The determinism tests pass: the same seed gives the same hash, and a world
   restored from a snapshot carries on identically.
4. The watch review ([watch-rubric.md](watch-rubric.md)) has no hard fail,
   each of the first six scores is 3 or more, and their mean is 3.5 or more.
   The "Mine" score is taken at 12, 50 and 150 characters and written up, but
   it doesn't block M1, because M1 has no players.

## After M1

The order may change, and each milestone is planned in detail only when the
one before it closes.

- **M2.** More skills and a crafting chain (Mining, Smithing), shared camp
  stores, monsters that only come out at night, a boss in the den, unique
  items.
- **M3.** Players. Claim an adventurer and pick its cloak colour. A companion
  page with its stats, what happened since the last visit, and its program to
  edit and submit. Safe handling of hostile programs. Leaderboards for single
  trips in several categories. Chat commands, starting with `!me`.
- **M4.** More regions, with the view moving slowly between them, once one
  frame is full. Balance for weeks of uptime, more monsters, items and
  places to go with the regions, and world events. The
  first conversation about hosting.
