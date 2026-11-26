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
   every dimension at 3 or more and a mean of 3.5 or more.

## After M1 (order may change; each is planned when the one before closes)

- **M2 — A Day in Idlin.** More skills and a crafting chain (Mining, Smithing),
  the bank and shared camp stores, night-only monsters and a den boss, uniques.
- **M3 — Your Bot.** Claim an adventurer; read, edit and submit Tactics in the
  browser; safe handling of hostile programs; a comparison board.
- **M4 — The Long Game.** Balance for weeks of uptime, content depth, world
  events, and the first talk about hosting.
