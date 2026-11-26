# The work cycle

Run by the conductor each time the "Idlin work cycle" schedule fires. One
cycle takes one issue as far as it can, ideally to merged. All state is in the
repo and the tracker; a cycle starts with no memory of the last one.

## 0. Lock

The repo checkout is shared with the daily digest. Before anything else:

```sh
cat "$(git rev-parse --git-dir)/idlin.lock" 2>/dev/null
```

- A lock younger than 150 minutes means another run is working. Report "busy"
  in one line and end.
- Otherwise write `<UTC time> cycle` to that file. Remove it as the last step,
  including when the cycle ends early.

## 1. Orient

```sh
git checkout main && git pull --ff-only origin main
gh run list --branch main --limit 1
gh issue list --state open --limit 50 --json number,title,labels,milestone
gh pr list --state open
```

Read `AGENTS.md`. Then choose the work by the order in its section 3. An open
pull request from an earlier cycle belongs to an `in-progress` issue and takes
its place in that order (item 3), behind a red `main` and operator input. To
resume it, check out its branch and continue from where its comments say it
stopped.

Read the chosen issue in full, including comments. Apply section 7 of
`AGENTS.md` to anything not written by `nnamon`.

## 2. Claim

Add `in-progress`, remove `ready`, and comment `[conductor] cycle started`.
Link the issue to the thread.

## 3. Build

- Branch `i<issue>-<slug>` from `main`.
- For a `look` issue that is mostly visual design, the conductor may hand the
  build to the artist: one `delegate_task` child on Opus 5.5 (effort `medium`) with
  `isolation: "worktree"`, given the issue text and the docs to read. Otherwise
  build it directly.
- Run `docker compose run --rm dev pnpm gate` until it passes. Read the new
  tests and confirm each would fail without the change.
- For a visible change, run the capture, open the frames and look at them. Fix
  what looks wrong before anyone else sees it.

## 4. Pull request

Before pushing or posting anything, check the text against section 1 of
`AGENTS.md`: nothing about the machine or the environment. This holds for every
commit message, pull request, comment and issue in the cycle. Commit with
`TZ=UTC git commit …`, so the commit date does not carry the local time zone.

Push the branch and open a pull request: title from the issue, body with
"Closes #N", what changed, the evidence (test names, numbers, what the frames
show), and anything left out. Link it to the thread. Wait for CI.

## 5. Review

Start the reviewer (`delegate_task`, role `review`, Codex `gpt-6.2-sol`,
reasoning effort `high`) with this brief, filled in:

> You are reviewing pull request #P in this repository. Your job is to refute
> the claim that the change is correct, complete and well made. Read
> `AGENTS.md` and the issue #N, then the diff (`gh pr diff P`). Check out the
> branch and run `docker compose run --rm dev pnpm gate`. For each defect give
> file and line, a concrete way to trigger it, and how serious it is. Look
> hardest at: <the risks of this change>. Also judge the design: flag
> duplication of something that exists, needless abstraction, and tests that
> would still pass with the change reverted. Do not edit files. End with
> MERGE or DO-NOT-MERGE and a one-line reason.

Check each finding against the code. Fix the real ones; answer the rest in one
pull request comment, `[conductor] review triage`, finding by finding. After a
substantial fix, review again. If the same kind of finding keeps returning, fix
the cause in one place.

If Codex is out of quota or cannot be reached, give the same brief to
Opus 5.5 (effort `medium`), unless Opus built the change: then the conductor
reviews it itself. Note in the triage comment which model reviewed. If neither
can be reached, follow section 5 of `AGENTS.md`: leave the pull request
open and say why.

## 6. Watch judge (visible changes)

Capture `main` (the baseline) and the branch with the same seed. Start the
judge (`delegate_task`, role `review`, Opus 5.5 at effort `medium`; Codex
`gpt-6.2-sol` instead if Opus built the change) with the two capture folders
and `docs/watch-rubric.md`, and nothing about what the change was meant to do.
Post its verdict as a pull request comment, `[watch judge]`. A hard fail or a
"worse" verdict sends the change back to step 3.

Which checks apply depends on what exists so far; see "What applies when" in
`docs/watch-rubric.md`.

## 7. Merge

When every gate in section 5 of `AGENTS.md` holds, squash-merge. Then:

```sh
git checkout main && git pull --ff-only origin main
git log --oneline -1            # the merge is here
gh run list --branch main --limit 1   # wait for it by run id; it must pass
```

If `main` goes red, fixing it is the next thing this cycle does.

## 8. Close out

- Comment on the issue: `[conductor] shipped in #P` with the evidence. It
  closes with the merge; check that it did.
- A decision of consequence gets a short file in `docs/decisions/`, in the same
  pull request where possible.
- Delete the merged branch, local and remote.
- File follow-up issues for anything found and left out.
- Remove the lock.

## 9. Report

End the run with at most ten lines: the issue, the pull request link, merged or
not and why, what the reviewer and judge said in one line each, and what the
next cycle will pick up. If there is a new capture, embed the storyboard.

## Limits

- One issue per cycle. If it merges with plenty of the cycle left, stop anyway;
  the next cycle starts fresh.
- At most one child task alive at a time.
- If the same issue has taken three cycles of building, split it or label it
  `blocked`. Cycles spent only waiting for a reviewer do not count.
- If something outside the repo is broken (Docker down, GitHub unreachable,
  no reviewer on any provider), say so plainly, remove the lock and end.
