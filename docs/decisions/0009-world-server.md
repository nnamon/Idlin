# 0009: How the world server streams and saves

Date: 2026-11-27. Decided by the builder of #199; open to veto.

Every WebSocket message is the sim's own snapshot text of the world after a
tick: one on connect, then one per tick, ten a second. The viewer restores each
with `restore` and draws it, so it never steps the world itself in live mode.
With six residents a message is about 2 KB; with 150 it is about 46 KB at the
start and up to 67 KB over the first 3000 ticks. A viewer more than 1 MiB
behind on reading (fifteen or more messages at 150 residents) is dropped, and
at most 16 are connected at once, so queued messages stay under about 17 MB
within the server's 256 MB. Browsers may connect only from the viewer's own
page at port 4310; another page in the same browser cannot read the world.

Rejected: sending the inputs of each tick and letting the viewer step its own
copy in lockstep. That is far less traffic, but it puts the simulation back in
the viewer, which design.md says only draws, and a viewer that ever diverged
would need a resync path. Full states can be cut down to diffs later if a big
crowd makes them too large; nothing else would change.

Snapshots on disk are the same text, one file per save named for the tick
(`data/world-<tick>.json`), the newest three kept. The sim's snapshot already
carries a version and a hash of its contents, and `restore` refuses a mismatch
of either, so the files have no wrapper of their own. A refused file is renamed
to `.bad`. Catch-up after a stall is capped at 50 ticks (five seconds); time
beyond that is skipped and logged. A wake stops stepping after 50 ms of work
and carries the rest to the next wake, which comes at once, so signals and new
connections are handled between batches even when ticks are slow. A snapshot
that fails to save is tried again a full interval later.

The viewer follows the server by default, since `docker compose up server
client` is meant to be the whole setup. It runs a world of its own for captures
and whenever the URL has `?local`, `?seed`, `?hour` or `?crowd`.
