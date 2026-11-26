# The work cycle

One cycle takes one issue as far as it can, ideally to merged. The conductor
runs cycles back to back in its session; the "Idlin work cycle" schedule runs
one too, if nobody else holds the lock. All state is in the repo and the
tracker, so a cycle can start knowing nothing about the last one.

## 0. Lock

The repo checkout is shared with the daily digest. Before anything else:

```sh
cat "$(git rev-parse --git-dir)/idlin.lock" 2>/dev/null
```

- A lock younger than 150 minutes means another run is working, unless this
  session wrote it. Report "busy" in one line and end.
- Otherwise write `<UTC time> cycle` to that file. A scheduled cycle removes
  it as its last step, including when it ends early.
- A session takes the lock once and keeps it for as long as it runs, across
  cycles and issues. It rewrites the time at each step and before each wait
  for a reviewer, so the lock never looks dead, and removes the file only when
  the session ends. Between cycles it checks whether the digest said the watch
  review was skipped because the lock was held, and if so runs step 2 of
  `process/daily.md` itself.

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

- Branch `i<issue>-<slug>` from `main`. An issue that needs an unmerged
  branch waits for it; branches are not stacked.
- For a `look` issue that is mostly visual design, the conductor may hand the
  build to the artist: one `delegate_task` child on Opus 5.5 (effort `medium`) with
  `isolation: "worktree"`, given the issue text and the docs to read. Otherwise
  build it directly.
- For a `look` issue whose design is still open, ask a Mythos 5.2 child
  (`delegate_task`, role `design`, effort `medium`, no worktree: it only reads)
  for direction before building: the issue, current captures, and what the
  options are. It counts towards the two child tasks. If Mythos cannot be
  reached, the conductor decides and says so on the issue.
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

Start the reviewer (`delegate_task`, role `review`, `isolation: "worktree"`
so that it never switches the shared checkout, Codex `gpt-6.2-sol`, reasoning
effort `high`) with this brief, filled in:

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
Sonnet 5.5 (effort `medium`, `isolation: "worktree"`, since it runs the gate).
Note in the triage comment which model reviewed. If neither can be
reached, follow section 5 of `AGENTS.md`: leave the pull request open and say
why.

## 6. Watch judge (visible changes)

Capture `main` (the baseline) and the branch with the same seed. Start the
judge (`delegate_task`, role `review`, Mythos 5.2 at effort `medium`; Codex
`gpt-6.2-sol` if Mythos cannot be reached; no worktree, since it reads the
capture folders, which are not committed) with the two capture folders
and `docs/watch-rubric.md`, and nothing about what the change was meant to do.
Post its verdict as a pull request comment, `[watch judge]`. A hard fail or a
"worse" verdict sends the change back to step 3.

Which checks apply depends on what exists so far; see "What applies when" in
`docs/watch-rubric.md`.

## 7. Merge

When every gate in section 5 of `AGENTS.md` holds, merge the branch as one
commit. GitHub's squash and rebase methods rewrite the commit and stamp one of
its dates in the time zone it last saw for the account, whatever the request
says. So the squash is done on the branch, and once that commit has passed
`gate` the same commit is pushed to `main` as a fast-forward:

```sh
(
set -e                                            # stop at the first command that fails
test -z "$(git status --porcelain)"               # nothing uncommitted lying about
git fetch origin
test -z "$(git log --oneline origin/<branch>..<branch> 2>/dev/null)"   # no unpushed commits on the branch
git checkout -B <branch> origin/<branch>
test "$(git rev-parse HEAD)" = <reviewed head sha>   # the local branch is what was reviewed
TZ=UTC git merge --no-edit origin/main            # always; it does nothing if main has not moved
git merge-base --is-ancestor origin/main HEAD     # or the reset below would undo work on main
git reset --soft origin/main
TZ=UTC git commit -m "<pull request title> (#<P>)"   # P is the pull request, not the issue
git diff --stat origin/main HEAD                  # read it: only this pull request's files
git push --force-with-lease=<branch>:<reviewed head sha> origin <branch>   # the branch, never main
)
```

Run it as one block, brackets included; it stops at the first failure.
Carrying on after a failed merge would commit a change that undoes newer work
on `main`. If the merge conflicts, run `git merge --abort`, merge `main` into
the branch as an ordinary commit with the conflict resolved, push it, and take
it back through `gate` and review. If the push is refused, someone else pushed
to the branch. Fetch, read the new commits, and send them to review if they
change code.

The commit carries the pull request's title only; the detail stays in the
pull request.

Wait for `gate` on the new head, then:

```sh
(
set -e
git fetch origin
head=$(git rev-parse origin/<branch>)
test "$head" = <the commit just pushed>
test "$(git rev-parse "$head^")" = "$(git rev-parse origin/main)"   # directly on main
test "$(git rev-list --count origin/main.."$head")" = 1             # and one commit only
git push origin "$head":main                      # a fast-forward; never with --force
git fetch origin && git log -1 --format='%ad | %cd' --date=format:%z origin/main   # both +0000
)
```

Run it as one block, brackets included. Branch protection accepts the push because `gate` has passed on that commit,
and refuses it otherwise. GitHub marks the pull request as merged and closes
the issues its body names. If `main` moved in the meantime the second test
fails: run the first block again and wait for `gate` again.

If either date is not `+0000`, file a `process` issue. `main` is not
rewritten to fix it.

Then:

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
- A scheduled cycle removes the lock. A session keeps it.

## 9. Report

End the run with at most ten lines: the issue, the pull request link, merged or
not and why, what the reviewer and judge said in one line each, and what the
next cycle will pick up. If there is a new capture, embed the storyboard.

## Limits

- One issue per cycle. A scheduled cycle stops when its issue merges. A
  conductor working in a session starts the next cycle straight away.
- At most two child tasks at a time, of any role. Capture runs and `pnpm gate`
  runs are heavy: one at a time. A reviewer runs the gate, so while a reviewer
  is out the conductor starts no gate or capture run of its own.
- If the same issue has taken three cycles of building, split it or label it
  `blocked`. Cycles spent only waiting for a reviewer do not count.
- If something outside the repo is broken (Docker down, GitHub unreachable,
  no reviewer on any provider), say so plainly, remove the lock and end.
