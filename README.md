# Idlin

An idle RPG made to be left running on a stream. A dozen adventurers live in a
camp at the edge of a dangerous wood. Each one runs a small program: so does
every monster. You watch them work, fight and come home, and you can write the
program for one of them.

![The camp at midnight: the lantern and campfire light the clearing, and each adventurer carries a small light of their own](https://raw.githubusercontent.com/nnamon/Idlin/media/showcase/midnight.png)

_Midnight. Four of the six have gone home to the lantern because their programs
say so; two wanderers are still out in the dark. The panel shows the rule each
one is following._

|                                                                                 |                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| ![Dawn](https://raw.githubusercontent.com/nnamon/Idlin/media/showcase/dawn.png) | ![Noon](https://raw.githubusercontent.com/nnamon/Idlin/media/showcase/noon.png)         |
| _Dawn, 06:15. The day starts pink._                                             | _Noon. One game day lasts 24 minutes._                                                  |
| ![Dusk](https://raw.githubusercontent.com/nnamon/Idlin/media/showcase/dusk.png) | ![Midnight](https://raw.githubusercontent.com/nnamon/Idlin/media/showcase/midnight.png) |
| _Dusk, 19:12. The lamps come on as the light goes amber._                       | _Night. The deep wood and the den go dark._                                             |

Every picture here is a capture of the running game, refreshed as it changes.
Today each adventurer runs one of three small programs written in
[Tactics](docs/tactics.md); combat, skills and loot are the next things on the
[roadmap](docs/roadmap.md).

- **What it is:** [docs/design.md](docs/design.md)
- **What it is built with:** [docs/stack.md](docs/stack.md)
- **Where it is going:** [docs/roadmap.md](docs/roadmap.md)
- **How it is developed:** [AGENTS.md](AGENTS.md). This repo is developed by a
  small swarm of AI agents working from the issue tracker.

## Running it

Everything runs in containers; you need Docker and nothing else.

```sh
docker compose run --rm dev pnpm install
docker compose up client          # then open http://localhost:4310
docker compose run --rm dev pnpm gate
```

Add `?hour=21` to the address to start at another time of day, or `?seed=7`
for another world.

Earlier versions of Idlin are kept on the branch
`archive/idlin-pre-2.0-2026-09-02`.
