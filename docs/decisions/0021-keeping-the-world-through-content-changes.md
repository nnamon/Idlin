# 0021: Keeping the world through content changes

Date: 2026-11-27. Decided by the builder of #260; open to veto.

Until now every merge that touched `content/bots`, `content/monsters` or the
maps made the world server start a fresh world, because `restore` refuses a
snapshot taken with other content. The server now keeps the world.

`restore` stays as it was: strict, refusing any difference in maps, programs,
kinds or spawns. Tests, the determinism checks and the viewer use it, so an
accidental change of content still shows up as a refusal. A new function in
the sim, `adopt(snapshot, ground, programs, kinds, spawns)` in
`packages/sim/src/adopt.ts`, returns the world and a list of what it changed.
With the same content it is `restore`. With other content it:

- checks the snapshot's hash against the content fingerprints stored in the
  snapshot itself, so garbage and damage are refused as before, and older
  versions are migrated first as before. A file edited by hand with its hash
  worked out again is fitted like any other, so `adopt` can take one that
  `restore` would refuse; what comes out has still passed `readState`;
- removes an actor whose program or monster kind is gone;
- clears the memory and resets the rule of an actor whose program changed;
- brings hitpoints, wind-up and recovery down to what the actor's kind now
  allows, and calls off an attack whose marked tiles are no longer its line;
- moves an actor on a tile it can no longer stand on to the nearest one it
  can, stops a step or walk that crosses changed ground, and removes a monster
  that would take its region past the cap;
- if the map changed, stands every node full again and keeps each region's
  wait for monsters by index;
- keeps everything else: places, hitpoints, levels, bags, banks, deaths, the
  tick and the seeded generator.

The result goes through the same `readState` as `restore`, so it is a world
the new content could hold, and the world runs on deterministically from
there. The server calls `adopt` and logs each change. A snapshot `adopt`
refuses is set aside as `.bad`, as before.

To tell which programs changed, a snapshot now carries `byProgram`, a
fingerprint of each program by name. It sits beside the other fingerprints,
outside the hash, so the snapshot version stays 9 and older code ignores it.
A wrong `byProgram` can clear memory that did not need clearing. One edited to
hold a changed program's new fingerprint keeps that program's memory through
the change; `snapshot()` never writes one like that. An actor whose program
changed also keeps the wait and path the old program gave it; the shipped
programs wait about 30 ticks, so this costs a few seconds. Snapshots written
before `byProgram` have none, and
then every program counts as changed and everyone's memory is cleared once.

Nodes and monster waits start fresh when the map changes because the
snapshot does not record where the old nodes or regions were. The loss is
small: a node regrows within three game hours (three minutes of real time)
and a region's wait is at most one game hour.

Rejected:

- A lenient flag on `restore`. One function that is strict or not depending
  on an argument makes it easy for a test to pass the wrong one and stop
  catching content changes.
- Storing the whole content (programs, kinds, maps) in each snapshot, so that
  every difference could be worked out exactly. It would multiply the size of
  every message the server sends to viewers, which is the same text.
- Giving an actor whose program is gone a default program instead of removing
  it. No program is a sensible default for every resident yet. When players
  own residents this can be revisited.
