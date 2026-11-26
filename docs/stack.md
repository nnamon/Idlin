# Stack

One language, three small packages, everything in containers.

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) on Node 24 | The simulation runs unchanged in the server, the browser (replays and captures) and tests. One toolchain keeps the swarm small. |
| Workspace | pnpm workspace | `packages/sim`, `packages/server`, `packages/client`, `tools/capture`. |
| Simulation | `packages/sim`, no runtime dependencies | Pure and deterministic: integers, a seeded generator, no clock. Holds the world, the bot VM and the Tactics compiler. |
| Server | `packages/server`, Node + `ws` | Runs the world in real time, snapshots to disk, streams state over a WebSocket. |
| Viewer | `packages/client`, Vite + PixiJS 8 | A renderer without a game framework: sprites, a lighting layer and particles on WebGL. The viewer can also drive the sim itself from a seed, which is how captures are made. |
| Captures | `tools/capture`, Playwright (Chromium) | Loads the viewer in replay mode, steps a virtual clock, saves frames and metrics. |
| Tests | Vitest | Unit tests beside the code; determinism, replay and soak tests in `packages/sim`. |
| Lint and format | Biome | One fast tool for both. |
| CI | GitHub Actions | One required job, `gate`: install, lint, typecheck, test. |

## Containers

Nothing is installed or run on the host except `git`, `gh` and `docker`.

```sh
docker compose run --rm dev pnpm install     # install dependencies
docker compose run --rm dev pnpm gate        # lint + typecheck + test (same as CI)
docker compose run --rm capture              # write a storyboard to captures/
docker compose up server client              # watch it at http://localhost:4310
```

- `dev` is `node:24-slim` with pnpm; the repo is bind-mounted and the pnpm
  store is a named volume.
- `capture` is the Playwright image.
- `server` (port 4311) and `client` (port 4310) bind to 127.0.0.1 only.

CI runs the same `pnpm gate` directly on the runner. The container rule exists
to protect the development machine, and a throwaway runner needs no protection.

## Rules that follow from the stack

- Simulation code never uses `Math.random`, `Date`, floating-point state or
  anything else that can differ between two machines.
- A dependency is added only with a reason in the pull request. The sim takes
  none.
- Art and fonts are committed only when their licence allows redistribution;
  each pack gets an entry in `assets/CREDITS.md` and its licence file.
- Captures and other generated images are not committed. They live in
  `captures/` (ignored) and as CI artifacts.
