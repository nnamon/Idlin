# The work cycle

One cycle takes one issue as far as it can, ideally to merged. A builder child
does the work in its own worktree: building and opening the pull request
(steps 4 and 5), fixing review findings and conflicts, taking the captures for
a watch judgement (step 7), and squashing its branch before the merge (the
first block of step 8). The conductor does everything else and does not
build. The conductor keeps up to three cycles going at once, one per
builder, and starts a new one as soon as a builder finishes. The "Idlin work
cycle" schedule does the conductor's job too, if nobody else holds the lock.
All state is in the repo and the tracker, so a cycle can start knowing nothing
about the last one.

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

Builders work in their own worktrees and never touch the shared checkout or
the lock.

## 1. Orient

```sh
git checkout main && git pull --ff-only origin main
gh run list --branch main --limit 1
gh issue list --state open --limit 50 --json number,title,labels,milestone
gh pr list --state open
```

Read `AGENTS.md`. Then, for each free builder slot, choose the work by the
order in its section 3, skipping anything that depends on a running builder's
branch or is likely to change the same files. An open pull request from an
earlier cycle belongs to an `in-progress` issue and takes its place in that
order (item 3), behind a red `main` and operator input. To resume it, brief a
builder to check out its branch and continue from where its comments say it
stopped.

Read the chosen issue in full, including comments. Apply section 7 of
`AGENTS.md` to anything not written by `nnamon`. If it is too big for one
pull request, or would keep two builders off the same files only if split,
split it first.

## 2. Claim

Add `in-progress`, remove `ready`, and comment `[conductor] cycle started`.
Link the issue to the thread.

## 3. Brief

For a `look` issue whose design is still open, first ask a Mythos 5.2 child
(`delegate_task`, role `design`, effort `medium`, no worktree: it only reads)
for direction: the issue, current captures, and what the options are. It
counts as one of the three reviewers or judges. If Mythos cannot be reached,
the conductor decides and says so on the issue.

Start the builder: one `delegate_task` child on Opus 5.5 (effort `medium`)
with `isolation: "worktree"`. Its brief gives the issue number, the docs to
read, the files the change is likely to touch, the design direction if there
is one, what the other running builders are working on (so it stays out of
their files), and steps 4 and 5 of this procedure, plus step 7 for a `look`
issue. It reports the pull request URL and head
commit. The builder does not push to `main`.

A builder's task ends when it reports, so a pull request waiting for review,
a judgement or the merge holds no builder slot. Later work on it (review
fixes, conflicts, captures, the squash) goes to a new builder started on the
branch, which takes a slot while it works and ends when it reports.

Git will not check out a branch that another worktree has checked out, and
an old builder's worktree may still have one of this branch's names. Before
starting a builder on an existing branch, the conductor looks for those
worktrees and removes them:

```sh
git worktree list                     # every line whose branch is [<branch>], [<branch>-work] or [<branch>-squash]
git worktree remove --force <path>    # each such line's path; only a builder's worktree, never the shared checkout
```

A builder's worktree that holds capture folders for a watch judgement (step
7) is kept until the judge's verdict is posted, and the removal above skips
it until then. The judge reads the folders from there.

The new builder still never checks out `<branch>` itself, in case a worktree
holding it was missed. It works on a local branch of another name made from
the remote one, and pushes to the remote branch by name:

```sh
git fetch origin
git checkout -B <branch>-work origin/<branch>   # -B: resets the name if an earlier builder left it
# ... commits ...
git push origin HEAD:<branch>         # an ordinary push, never --force
```

A builder with no activity for 60 minutes is taken to have failed, stalled or
run out of quota. Activity is a pushed commit, a comment on the issue or pull
request, or a message in its thread. A builder held up by the capture rule in
section 1 of `AGENTS.md` says so in its thread, which starts the 60 minutes
again. The conductor stops a stalled builder (`task_cancel`), comments on the
issue with what it got to, removes every worktree holding `<branch>`,
`<branch>-work` or `<branch>-squash` as above, and starts a fresh
builder: on the existing branch if it has commits, or from a clean
`origin/main` if not. The fresh builder takes the same slot.

## 4. Build (builder)

- Branch `i<issue>-<slug>` from fresh `origin/main`. An issue that needs an
  unmerged branch waits for it; branches are not stacked.
- Run `docker compose run --rm dev pnpm gate` until it passes. Read the new
  tests and confirm each would fail without the change.
- For a visible change, run the capture, open the frames and look at them. Fix
  what looks wrong before anyone else sees it. Check for a running capture
  first, as section 1 of `AGENTS.md` says.

## 5. Pull request (builder)

Before pushing or posting anything, check the text against section 1 of
`AGENTS.md`: nothing about the machine or the environment. This holds for every
commit message, pull request, comment and issue in the cycle. Commit with
`TZ=UTC git commit …`, so the commit date does not carry the local time zone.

Push the branch and open a pull request: title from the issue, body with
"Closes #N", what changed, the evidence (test names, numbers, what the frames
show), and anything left out. The conductor links it to the thread. Wait for
CI.

When the builder reports, its task ends and its slot is free: the conductor
starts the next cycle's builder (step 1) before going on to review this pull
request.

A merge to `main` does not by itself send other branches back to a builder. A
branch is brought up to date only when GitHub shows its pull request as
conflicting (`gh pr view <P> --json mergeable` gives `CONFLICTING`; GitHub
gives `UNKNOWN` while it is still working that out, so ask again), or when
its squash in step 8 hits a conflict. Then a builder on the branch, as in
step 3, merges `origin/main` into it, resolves the conflicts, runs the gate,
pushes the merge commit and reports the new head. The new head is what gets
reviewed: a resolution that changes code goes back to review (step 6). A pull
request already squashed and waiting on `gate` before its push to `main` is
left alone; if `main` moves under it, step 8 says what happens.

## 6. Review

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

Check each finding against the code. Send the real ones to a builder on the
branch, as step 3 says, to fix on the same branch. Answer the
rest in one pull request comment, `[conductor] review triage`, finding by
finding. After a substantial fix, start a new review. If the same kind of
finding keeps returning, have the cause fixed in one place.

If Codex is out of quota or cannot be reached, give the same brief to
Sonnet 5.5 (effort `medium`, `isolation: "worktree"`, since it runs the gate).
Note in the triage comment which model reviewed. If neither can be
reached, follow section 5 of `AGENTS.md`: leave the pull request open and say
why.

A reviewer with no activity for 90 minutes (no comment, and nothing visible
happening in its thread: no message, no command run) is stopped with `task_cancel`, and the review goes to the fallback
model with the same brief: Sonnet 5.5 after Codex. A Sonnet reviewer that
stalls counts as neither being reachable.

## 7. Watch judge (visible changes)

The builder takes both captures with the same seed, one at a time and each
after the check in section 1 of `AGENTS.md`. The branch capture comes from its
own worktree. The baseline comes from a clean worktree of `origin/main`, so
that nothing from the branch is in it. From the builder's worktree:

```sh
git fetch origin
git worktree add "$TMP/base" origin/main --detach   # TMP: a fresh temporary directory
(cd "$TMP/base" &&
  docker compose run --rm dev pnpm install &&
  docker compose run --rm dev pnpm --filter @idlin/client build &&
  docker compose run --rm capture captures/base --review)
rm -rf captures/base                                # or cp puts the new set inside the old one
cp -R "$TMP/base/captures/base" captures/base       # captures/ is ignored by git
git worktree remove --force "$TMP/base"
docker compose run --rm dev pnpm --filter @idlin/client build
docker compose run --rm capture captures/branch --review --baseline captures/base
```

The builder reports the two capture folders, `captures/base` and
`captures/branch` in its worktree, to the conductor. That worktree stays until
the judge's verdict is posted (step 3).

The conductor starts the judge (`delegate_task`, role `review`, Mythos 5.2 at
effort `medium`; Codex `gpt-6.2-sol` if Mythos cannot be reached; no worktree,
since it reads the capture folders, which are not committed) with the two
capture folders and `docs/watch-rubric.md`, and nothing about what the change
was meant to do. A judge with no activity for 60 minutes is stopped with
`task_cancel` and the judgement goes to Codex with the same folders; a Codex
judge that stalls counts as no judge being reachable.
Post its verdict as a pull request comment, `[watch judge]`. A hard fail or a
"worse" verdict sends the change back to a builder (step 4). The conductor
takes no captures for a judgement; it only runs the daily one in
`process/daily.md`.

Which checks apply depends on what exists so far; see "What applies when" in
`docs/watch-rubric.md`.

## 8. Merge

When every gate in section 5 of `AGENTS.md` holds, merge the branch as one
commit. GitHub's squash and rebase methods rewrite the commit and stamp one of
its dates in the time zone it last saw for the account, whatever the request
says. So the squash is done on the branch, and once that commit has passed
`gate` the same commit is pushed to `main` as a fast-forward. The squash is a
builder's, in its own worktree, so the shared checkout stays on `main`. The
push to `main` is the conductor's, and needs no checkout of the branch.

When the review is clean, the conductor starts a builder on the branch (step
3) to squash it, giving it the reviewed head and the pull request's title and
number. The builder runs, in its worktree:

```sh
(
set -e                                            # stop at the first command that fails
test -z "$(git status --porcelain)"               # nothing uncommitted lying about
git fetch origin
git merge-base --is-ancestor HEAD <reviewed head sha>   # fails if this worktree has commits that were not reviewed
test "$(git rev-parse origin/<branch>)" = <reviewed head sha>   # the branch on GitHub is what was reviewed
git checkout -B <branch>-squash origin/<branch>   # a name of its own: another worktree may hold <branch>
TZ=UTC git merge --no-edit origin/main            # always; it does nothing if main has not moved
git merge-base --is-ancestor origin/main HEAD     # or the reset below would undo work on main
git reset --soft origin/main
TZ=UTC git commit -m "<pull request title> (#<P>)"   # P is the pull request, not the issue
git diff --stat origin/main HEAD                  # read it: only this pull request's files
git push --force-with-lease=<branch>:<reviewed head sha> origin HEAD:<branch>   # the branch, never main
)
```

A builder new to the branch first runs the `git checkout -B <branch>-work`
line from step 3, so that its `HEAD` is the reviewed head.

Run it as one block, brackets included; it stops at the first failure.
Carrying on after a failed merge would commit a change that undoes newer work
on `main`. If the merge conflicts, the block stops with the merge still in
progress on `<branch>-squash`. The builder resolves the conflict there (if
the merge is no longer in progress, it runs `TZ=UTC git merge origin/main`
again and resolves that), commits with `TZ=UTC git commit`, pushes with
`git push origin HEAD:<branch>`, and reports the new head; the pull request
goes back
through `gate` and review, as in step 5. If the push is refused, someone else
pushed to the branch: the builder stops and tells the conductor, who reads the
new commits and sends them to review if they change code.

The commit carries the pull request's title only; the detail stays in the
pull request.

The builder waits for `gate` on the new head and reports its sha. The
conductor then runs:

```sh
(
set -e
git fetch origin
head=$(git rev-parse origin/<branch>)
test "$head" = <the sha the builder reported>
if git merge-base --is-ancestor origin/main <reviewed head sha>; then
  git diff --quiet <reviewed head sha> "$head"    # main had not moved: the same tree as was reviewed
else
  git diff --stat <reviewed head sha> "$head"     # main moved: only what main brought in may show
  test "${CONFIRMED:-no}" = yes                   # the first run stops here; the second sets CONFIRMED=yes
fi
test "$(gh api "repos/{owner}/{repo}/commits/$head/check-runs" \
  --jq '[.check_runs[] | select(.name == "gate")][0].conclusion')" = success   # gate passed on it
test "$(git rev-parse "$head^")" = "$(git rev-parse origin/main)"   # directly on main
test "$(git rev-list --count origin/main.."$head")" = 1             # and one commit only
git push origin "$head":main                      # a fast-forward; never with --force
git fetch origin && git log -1 --format='%ad | %cd' --date=format:%z origin/main   # both +0000
)
```

Run it as one block, brackets included. The reviewed head is the commit the
review passed, or, after a re-squash, the previous squashed commit. When
`main` has moved since that commit, the first run stops after printing the
stat; read it, and if it shows only what `main` brought in, run the block
again after setting `CONFIRMED=yes` in the same shell (the bracketed block
inherits it). Branch protection accepts the push only because `gate` has
passed on that commit. GitHub marks the pull request as merged and closes the
issues its body names.

If `main` moved in the meantime the "directly on main" test fails, and if it
moves between the tests and the push, the push is rejected. Either way a
builder runs the first block again, with the squashed commit as the reviewed
head, and the conductor waits for `gate` again.

If either date is not `+0000`, file a `process` issue. `main` is not
rewritten to fix it.

Then:

```sh
git checkout main && git pull --ff-only origin main
git log --oneline -1            # the merge is here
gh run list --branch main --limit 1   # wait for it by run id; it must pass
```

If `main` goes red, the next free builder slot goes to fixing it, ahead of
anything else in the queue.

## 9. Close out

- Comment on the issue: `[conductor] shipped in #P` with the evidence. It
  closes with the merge; check that it did.
- A decision of consequence gets a short file in `docs/decisions/`, in the same
  pull request where possible.
- Remove every worktree a builder of this branch left, that is each one whose
  branch is `<branch>`, `<branch>-work` or `<branch>-squash` (`git worktree
  list`, then `git worktree remove --force <path>`, as in step 3), then delete the
  merged branch, remote and local, along with the local `<branch>-work` and
  `<branch>-squash` branches builders made. Git will not delete a branch that
  a worktree still has checked out.
- File follow-up issues for anything found and left out.
- A scheduled cycle removes the lock. A session keeps it.

## 10. Report

When a cycle ends, report in at most ten lines: the issue, the pull request
link, merged or not and why, what the reviewer and judge said in one line
each, and what each builder slot is working on now. If there is a new
capture, embed the storyboard.

## Limits

- One issue per cycle, one builder per issue. A conductor working in a
  session fills a builder slot as soon as one frees up. A scheduled run fills
  the slots once and stops when each of its pull requests has merged or waits
  on something it cannot get this run.
- At most three builders at a time, and at most three reviewers or judges at
  a time, as section 1 of `AGENTS.md` says. The conductor builds nothing
  itself.
- A builder with no activity for 60 minutes is replaced, as in step 3. A
  reviewer with none for 90 minutes, or a judge with none for 60, is stopped
  and its work goes to the fallback model, as in steps 6 and 7.
- Captures run one at a time across the team, by the rule in section 1 of
  `AGENTS.md`. Up to six `pnpm gate` runs may overlap.
- If the same issue has taken three cycles of building, split it or label it
  `blocked`. Cycles spent only waiting for a reviewer do not count.
- If something outside the repo is broken (Docker down, GitHub unreachable,
  no reviewer on any provider), say so plainly, remove the lock and end.
