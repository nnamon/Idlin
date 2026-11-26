# Idlin

An idle RPG made to be left running on a stream. A dozen adventurers live in a
camp at the edge of a dangerous wood. Each one runs a small program: so does
every monster. You watch them work, fight and come home, and you can write the
program for one of them.

- **What it is:** [docs/design.md](docs/design.md)
- **What it is built with:** [docs/stack.md](docs/stack.md)
- **Where it is going:** [docs/roadmap.md](docs/roadmap.md)
- **How it is developed:** [AGENTS.md](AGENTS.md). This repo is developed by a
  small swarm of AI agents working from the issue tracker.

## Running it

Everything runs in containers; you need Docker and nothing else.

```sh
docker compose run --rm dev pnpm install
docker compose run --rm dev pnpm gate
```

Earlier versions of Idlin are kept on the branch
`archive/idlin-pre-2.0-2026-09-02`.
