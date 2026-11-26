# Stack

TypeScript throughout, in a pnpm workspace. Everything runs in containers.

| Part            | Choice                                  | Why                                                                                                                                                                           |
| --------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript (strict) on Node 24          | The simulation runs unchanged in the server, the browser (replays and captures) and tests. One toolchain is less to maintain.                                                 |
| Workspace       | pnpm workspace                          | `packages/sim`, `packages/server`, `packages/client`, `tools/capture`.                                                                                                        |
| Simulation      | `packages/sim`, no runtime dependencies | Pure and deterministic: integers, a seeded generator, no clock. Holds the world, the bot VM, the Tactics compiler and item rolls (docs/items.md).                             |
| Server          | `packages/server`, Node + `ws`          | Not built yet; an empty package. It will run the world in real time, snapshot to disk and stream state over a WebSocket.                                                      |
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
docker compose up client                                       # the viewer, at http://localhost:4310
docker compose run --rm dev pnpm --filter @idlin/client build  # build the viewer for captures
docker compose run --rm capture captures/now                   # frames at dawn, noon, dusk and midnight
docker compose run --rm capture captures/review --review       # the watch-review set (docs/watch-rubric.md)
```

- `dev` is `node:24-slim` with pnpm baked in; the repo is bind-mounted, so
  `node_modules` (Linux builds, and the pnpm store beside them so packages can
  be hard-linked) lives in the checkout and is ignored by git.
- `client` runs the viewer with hot reload. It drives the simulation itself
  from a seed (`?seed=3`) and can start at any game hour (`?hour=19`). Ports
  bind to 127.0.0.1 only.
- `capture` is the Playwright image. It serves the built viewer, opens it in
  capture mode (`?capture`: the page draws only when told to, so a frame is a
  pure function of seed and tick) and saves frames. Arguments after the output
  folder are `name:hour[:ticks[:width[:height]]]`. It also prints a flicker index.
- The service for the server is added together with its package.
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
