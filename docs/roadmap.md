# Roadmap

The tracker is the source of truth for what is being worked on. This page says
what each milestone is for and when it counts as finished.

## M1 — First Light

The smallest thing worth leaving on a second screen: one map, a camp with a
lantern, a wood, a river and a den; six adventurers running three different
built-in programs; two kinds of monster running their own; day and night.

It contains:

- the deterministic simulation core (map, movement, clock, replay);
- the viewer with the art direction, lighting and code-driven animation;
- the capture harness and watch metrics;
- the bot VM and the Tactics compiler;
- combat with telegraphed attacks, and monsters as content bots;
- four skills that make a trip loop (Melee, Woodcutting, Fishing, Cooking) plus
  Hitpoints, with banking and the death penalty;
- items with rarity and rolled affixes, and bots that choose what to wear;
- the spotlight panel with the live program trace, and the event ticker;
- the server: real-time world, snapshots, WebSocket.

M1 is finished when:

1. `docker compose up server client` shows the world at `localhost:4310`, and
   it survives a server restart without losing progress;
2. a headless soak of 24 simulated hours runs with no error and no actor stuck;
3. the determinism tests pass (same seed, same hash; snapshot and resume);
4. the watch review ([watch-rubric.md](watch-rubric.md)) has no hard fail,
   each of the first six dimensions at 3 or more and their mean at 3.5 or
   more. "Mine" is scored at 12, 50 and 150 characters and recorded with a
   written reading of what it means for M3 and M4; it does not gate M1, which
   has no players yet.

## After M1 (order may change; each is planned when the one before closes)

- **M2 — A Day in Idlin.** More skills and a crafting chain (Mining, Smithing),
  the bank and shared camp stores, night-only monsters and a den boss, uniques.
- **M3 — Your Bot.** Claim an adventurer and pick its name colour; a companion
  page with its sheet, its history since the last visit and its Tactics
  program to edit and submit; safe handling of hostile programs; boards that
  rank trips across niches; chat commands, starting with `!me`.
- **M4 — The Long Game.** Regions and the slowly drifting view once one frame
  is full; balance for weeks of uptime, content depth, world events, and the
  first talk about hosting.
