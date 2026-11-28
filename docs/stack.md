# Stack

TypeScript throughout, in a pnpm workspace. Everything runs in containers.

| Part            | Choice                                  | Why                                                                                                                                                                           |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript (strict) on Node 24          | The simulation runs unchanged in the server, the browser (replays and captures) and tests. One toolchain is less to maintain.                                                 |
| Workspace       | pnpm workspace                          | `packages/sim`, `packages/chat`, `packages/server`, `packages/client`, `tools/capture`.                                                                                       |
| Simulation      | `packages/sim`, no runtime dependencies | Pure and deterministic: integers, a seeded generator, no clock. Holds the world, the bot VM, the Tactics compiler and item rolls (docs/items.md).                             |
| Chat            | `packages/chat`, depends on the sim     | Pure. The gate from a chat's messages to the world's inputs: the parser, flood control, the ignore list, the input queue, and the scripted crowd (docs/chat.md).              |
| Server          | `packages/server`, Node + `ws`          | Runs the world in real time, saves snapshots and their input logs to `data/` and streams the world over a WebSocket on port 4311.                                             |
| Viewer          | `packages/client`, Vite, Canvas 2D      | Draws the whole frame on one canvas with the browser's own drawing calls; no rendering library. It can also drive the sim itself from a seed, which is how captures are made. |
| Captures        | `tools/capture`, Playwright (Chromium)  | Loads the viewer in capture mode, steps the clock, saves frames, and with `--review` the watch-review set and its metrics.                                                    |
| Tests           | Vitest                                  | Unit tests beside the code; determinism and snapshot tests in `packages/sim`.                                                                                                 |
| Lint and format | Biome                                   | One fast tool for both.                                                                                                                                                       |
| CI              | GitHub Actions                          | One required job, `gate`: install, lint, typecheck, test.                                                                                                                     |

## Containers

Nothing is installed or run on the host except `git`, `gh` and `docker`.

```sh
docker compose run --rm dev pnpm install                       # install dependencies
docker compose run --rm dev pnpm gate                          # lint + typecheck + test (same as CI)
docker compose up server client                                # the world server and the viewer, at http://localhost:4310
docker compose run --rm dev pnpm --filter @idlin/client build  # build the viewer for captures
docker compose run --rm capture captures/now                   # frames from the first cycle: transit, legs-plant, the peace, the siege
docker compose run --rm capture captures/review --review       # the watch-review set (docs/watch-rubric.md)
docker compose run --rm capture captures/look --lookdev all    # the look-development scenes, and the renderer bench
```

- `dev` is `node:24-slim` with pnpm baked in; the repo is bind-mounted, so
  `node_modules` (Linux builds, and the pnpm store beside them so packages can
  be hard-linked) lives in the checkout and is ignored by git.
- `server` runs the world server (`packages/server/src/main.ts`) on port 4311.
  The world is the walking city (`createCity` in `packages/sim/src/world.ts`):
  a new one starts at its first cycle's 0:00 on its deck, with nobody aboard
  until chatters join. It resumes from the newest valid snapshot in `data/`, saves one every 600 ticks (a
  minute of real time) and when the service stops, and sends the world to each viewer
  after every tick, with that tick's blows and knockbacks and the beat the city
  is in beside it (`viewerMessage` in `packages/sim/src/world.ts`). The state
  holds the cycle, from which the viewer works out the deck or the landing the
  city stands on. The message leaves out what no viewer draws: each
  citizen's chat account and tokens, and every monster's orders. A snapshot taken with other programs or
  monsters than the server now has, or on a landing the generator now makes
  differently, is adopted: the world goes on with the new content,
  and the log lists what that changed (actors removed or moved, memory
  cleared; see `docs/decisions/0021-keeping-the-world-through-content-changes.md`).
  A snapshot it cannot use is skipped with the reason in the
  log. One the simulation refuses (cut short, damaged, or of another version)
  is also renamed to end in `.bad` (`.1.bad`, `.2.bad` and so on if that name is
  taken, so nothing set aside is replaced). The new name is a hard link, or a
  copy where links are refused, and the old name is removed only after that
  works. If neither works, the file stays under its own name and that run of
  the server neither saves over it nor deletes it. One that cannot be read from
  disk at all is left where it is. Snapshots from before version 13 are of
  the camp world and are refused, so a `data/` folder from then is set aside
  snapshot by snapshot, its logs with them, and the server starts a new city
  in it; nothing is deleted. To start a new city by hand, stop the server and
  move `data/` away. After each save it keeps the newest three snapshots up to
  the current tick and deletes the rest; snapshots at a later tick, which it
  could not resume from, are never deleted. An old snapshot that cannot be
  deleted is logged and left.
  Beside each snapshot is its input log, `world-<tick>.log`, one line for each
  tick stepped since with the inputs applied at it, written ten ticks at a
  time; a write that fails or writes only part is retried with the next, so
  the file has no gaps. A new world is saved at once so that every tick is in
  a log, and any log already in `data/` is set aside as `.bad`, since it
  belongs to another world. On start the server replays the resumed
  snapshot's log up to its last whole line, so a kill of the process loses at
  most ten ticks (nothing is fsynced, so a machine going down can lose more).
  A torn last line ends the replay there. A log that cannot be read, or has
  a bad line before its end, is copied aside as `.bad` with a line in the log,
  and stays under its name until the new log with the lines used replaces it.
  A log used to its end reaches the tick of the next snapshot, and when that
  snapshot was refused the replay goes on into its log. Logs later than the
  one the replay ends in are set aside, since the world goes on past their
  ticks with other inputs. A world that replayed
  anything is saved at once. A save sets aside a log with lines that is
  already under its tick's name, and fails if it cannot. A log is deleted
  once its snapshot is.
  `IDLIN_CHAT=crowd:crowd-150` reads that crowd file from `content/chat/` as
  the server's chat, from the tick it starts at.
  Settings are environment variables, listed at the top of `main.ts`. Memory is capped at 256 MB. It takes up to 16
  viewers, only from the viewer's own page (`http://localhost:4310` or
  `http://127.0.0.1:4310`, plus any listed in `IDLIN_ORIGINS`, a
  comma-separated list of exact Origins such as `http://viewer.example:4310` for a
  page served under another host name) (a client that sends no
  Origin header, such as a test, is let in), and drops one more than 1 MiB
  behind on reading. On SIGTERM or SIGINT it saves, closes every connection
  (waiting at most a second) and exits; a snapshot on the way down that cannot
  be written makes it exit with status 1.
- `client` runs the viewer with hot reload. By default it follows the server
  (`?server=ws://host:port` for another address). With `?local`, or with
  `?seed=3`, `?tick=1800` or `?chat=crowd-15`, it runs a city of its own
  instead. `?chat=` reads a crowd file from `content/chat/` as the city's
  chat, and its chatters are the citizens; `?tick=` runs the city on to that
  tick before the first frame. The view is plain until slice piece 2b draws
  the deck and the landing (`packages/client/src/plain.ts`): the ground as
  flat tiles, citizens as dots, and the beat with the time to the next.
  Until the server sends a world, and while it cannot be reached, the page says
  "waiting for the world".
  Ports bind to 127.0.0.1 only.
- `capture` is the Playwright image. It serves the built viewer, opens it in
  capture mode (`?capture`: the page draws only when told to, so a frame is a
  pure function of seed and tick) and saves frames. Arguments after the output
  folder are `name:tick[:width[:height]]`, the tick of the city's first cycles
  to draw, and `--chat crowd-15` opens the page with `?chat=crowd-15` for
  them. The `--review` set is a frame from each beat of the first cycle with
  the 15-chatter crowd aboard (`tools/capture/src/index.ts` lists it), and
  prints a flicker index.
  With `--lookdev <scenes>` (`all`, or names separated by commas) it shoots the
  look-development page instead: for each scene, stills at 1920 and the same
  frames averaged down to 640, `<scene>.json` with who is out and aboard and
  how many monsters are alive in each still, a sheet of twelve frames a
  sixtieth of a second apart, a storyboard, and a short GIF; then, if
  `expedition150` was among them, `bench.json`, the frame times of that scene
  on WebGL and on Canvas 2D. `--stills` leaves out everything but the stills.
- The look-development page is the viewer opened with `?lookdev=<scene>`
  (`packages/client/src/lookdev/`). It has no world behind it: `deck` and
  `deck150` (the city from above in transit), `reveal`, `expedition`,
  `expedition-b`, `expedition150` (landings), `siege` and `siege150` (the
  shield siege), `deckside` (#371's side-on deck, kept for comparison until
  the look target is signed off), and the `shield-levels`, `beasts`,
  `figures` and `scale` sheets. Each is a function of time,
  drawn with WebGL 2 through one pen. The landings run on a scripted fight
  (`fray.ts`) stepped once from a seed and read back by time. It is the target
  the game's own drawing is to be rebuilt to (#362); the game itself still
  draws its plain view with Canvas 2D.
  [decisions/0038](decisions/0038-renderer-scale-and-the-siege.md) has the
  renderer measurements, the sizes a citizen is drawn at, and how the siege
  draws the shield.
- Every service uses Docker's default bridge (`network_mode: bridge`), so the
  project creates no network of its own.

CI runs the same `pnpm gate` directly on the runner. The container rule exists
to protect the development machine, and a throwaway runner needs no protection.

## Rules that follow from the stack

- Simulation code never uses `Math.random`, `Date`, floating-point state or
  anything else that can differ between two machines.
- A dependency is added only with a reason in the pull request. The sim takes
  none.
- The art is drawn in code, so there are no image assets. A font is committed
  only when its licence allows redistribution, with an entry in
  `assets/CREDITS.md` and its licence file beside it.
- Captures and other generated images are never committed to `main`. They live
  in `captures/` (ignored) and as CI artifacts; the curated set shown in the
  README lives on the orphan `media` branch.
