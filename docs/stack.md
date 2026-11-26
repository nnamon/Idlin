# Stack

One language, three small packages, everything in containers.

| Part            | Choice                                  | Why                                                                                                                                                                          |
| --------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript (strict) on Node 24          | The simulation runs unchanged in the server, the browser (replays and captures) and tests. One toolchain keeps the swarm small.                                              |
| Workspace       | pnpm workspace                          | `packages/sim`, `packages/server`, `packages/client`, `tools/capture`.                                                                                                       |
| Simulation      | `packages/sim`, no runtime dependencies | Pure and deterministic: integers, a seeded generator, no clock. Holds the world, the bot VM and the Tactics compiler.                                                        |
| Server          | `packages/server`, Node + `ws`          | Runs the world in real time, snapshots to disk, streams state over a WebSocket.                                                                                              |
| Viewer          | `packages/client`, Vite + PixiJS 8      | A renderer without a game framework: sprites, a lighting layer and particles on WebGL. The viewer can also drive the sim itself from a seed, which is how captures are made. |
| Captures        | `tools/capture`, Playwright (Chromium)  | Loads the viewer in replay mode, steps a virtual clock, saves frames and metrics.                                                                                            |
| Tests           | Vitest                                  | Unit tests beside the code; determinism, replay and soak tests in `packages/sim`.                                                                                            |
| Lint and format | Biome                                   | One fast tool for both.                                                                                                                                                      |
| CI              | GitHub Actions                          | One required job, `gate`: install, lint, typecheck, test.                                                                                                                    |

## Containers

Nothing is installed or run on the host except `git`, `gh` and `docker`.

```sh
docker compose run --rm dev pnpm install     # install dependencies
docker compose run --rm dev pnpm gate        # lint + typecheck + test (same as CI)
```

- `dev` is `node:24-slim` with pnpm baked in; the repo is bind-mounted, so
  `node_modules` (Linux builds, and the pnpm store beside them so packages can
  be hard-linked) lives in the checkout and is ignored by git.
- Services for the server, the viewer and captures are added to `compose.yaml`
  together with the packages they run. Ports bind to 127.0.0.1 only.
- Every service uses Docker's default bridge (`network_mode: bridge`), so the
  project creates no network of its own.

CI runs the same `pnpm gate` directly on the runner. The container rule exists
to protect the development machine, and a throwaway runner needs no protection.

## Rules that follow from the stack

- Simulation code never uses `Math.random`, `Date`, floating-point state or
  anything else that can differ between two machines.
- A dependency is added only with a reason in the pull request. The sim takes
  none.
- Art and fonts are committed only when their licence allows redistribution;
  each pack gets an entry in `assets/CREDITS.md` and its licence file.
- Captures and other generated images are never committed to `main`. They live
  in `captures/` (ignored) and as CI artifacts; the curated set shown in the
  README lives on the orphan `media` branch.
