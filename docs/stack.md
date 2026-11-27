# Stack

TypeScript throughout, in a pnpm workspace. Everything runs in containers.

| Part            | Choice                                  | Why                                                                                                                                                                           |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript (strict) on Node 24          | The simulation runs unchanged in the server, the browser (replays and captures) and tests. One toolchain is less to maintain.                                                 |
| Workspace       | pnpm workspace                          | `packages/sim`, `packages/server`, `packages/client`, `tools/capture`.                                                                                                        |
| Simulation      | `packages/sim`, no runtime dependencies | Pure and deterministic: integers, a seeded generator, no clock. Holds the world, the bot VM, the Tactics compiler and item rolls (docs/items.md).                             |
| Server          | `packages/server`, Node + `ws`          | Runs the world in real time, saves snapshots to `data/` and streams the world over a WebSocket on port 4311.                                                                  |
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
docker compose run --rm capture captures/now                   # frames at dawn, noon, dusk and midnight
docker compose run --rm capture captures/review --review       # the watch-review set (docs/watch-rubric.md)
```

- `dev` is `node:24-slim` with pnpm baked in; the repo is bind-mounted, so
  `node_modules` (Linux builds, and the pnpm store beside them so packages can
  be hard-linked) lives in the checkout and is ignored by git.
- `server` runs the world server (`packages/server/src/main.ts`) on port 4311.
  It resumes from the newest valid snapshot in `data/`, saves one every 600 ticks (a
  minute of real time) and when the service stops, and sends the whole world to each viewer
  after every tick. A snapshot it cannot use is skipped with the reason in the
  log. One the simulation refuses (cut short, damaged, or of another version)
  is also renamed to end in `.bad` (`.1.bad`, `.2.bad` and so on if that name is
  taken, so nothing set aside is replaced). The new name is a hard link, or a
  copy where links are refused, and the old name is removed only after that
  works. If neither works, the file stays under its own name and that run of
  the server neither saves over it nor deletes it. One that cannot be read from
  disk at all is left where it is. After each save it keeps the newest three snapshots up to
  the current tick and deletes the rest; snapshots at a later tick, which it
  could not resume from, are never deleted. An old snapshot that cannot be
  deleted is logged and left.
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
  `?seed=3`, `?hour=19` or `?crowd=50`, it drives the simulation itself instead.
  Until the server sends a world, and while it cannot be reached, the page says
  "waiting for the world". Until the first world arrives the clock shows a dash.
  Ports bind to 127.0.0.1 only.
- `capture` is the Playwright image. It serves the built viewer, opens it in
  capture mode (`?capture`: the page draws only when told to, so a frame is a
  pure function of seed and tick) and saves frames. Arguments after the output
  folder are `name:hour[:ticks[:width[:height]]]`. It also prints a flicker index.
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
