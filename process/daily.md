# The daily digest

Run once a day by the "Idlin daily digest" schedule. It tells the operator
where things stand, runs the day's watch review (a playtest), and checks the swarm is not
stuck. It builds nothing.

## 0. Before anything is posted

Section 1 of `AGENTS.md` applies to everything this run sends to GitHub: the
commit to the `media` branch (images and the playtest log), watch findings, issue
comments and the digest comment. Check each one before it is pushed or posted.
Disk use, Docker state and local paths go to the thread only.

## 1. Gather

```sh
git fetch origin
git log origin/main --since="24 hours ago" --oneline
gh pr list --state merged --search "merged:>=<yesterday>" --json number,title,mergedAt
gh pr list --state open
gh issue list --state open --json number,title,labels,milestone
gh run list --branch main --limit 3
```

## 2. Watch review: the playtest

If the lock in
`$(git rev-parse --git-dir)/idlin.lock` is younger than 150 minutes, a cycle
is using the checkout: skip the capture, the judging and the `media` push
today. The digest then says the watch review was skipped because a cycle held
the lock, and shows the last capture pushed to `media`. A conductor session
running this step between cycles ignores its own lock, neither takes nor
releases one, and goes straight to the commands below.

An older lock is taken only after the activity check in section 0 of
[cycle.md](cycle.md) finds nothing; if it finds activity, skip the watch review
as above. Otherwise take the lock. A builder may be capturing in its own worktree, so
check for a running capture first, by the rule in section 1 of `AGENTS.md`.
Then:

```sh
git checkout main && git pull --ff-only origin main
git rev-parse HEAD            # must equal origin/main; this is the commit judged
docker compose run --rm dev pnpm --filter @idlin/client build
rm -rf captures/daily-prev
if [ -d captures/daily ]; then  # the last playtest's capture; captures/ is ignored by git
  mv captures/daily captures/daily-prev
  docker compose run --rm capture captures/daily --review --baseline captures/daily-prev
else
  docker compose run --rm capture captures/daily --review
fi
```

The baseline is the last playtest's capture, usually the previous day's. Its
commit is the one in the top entry of `playtest.md` on `media`. On the first
run, or if the folder has been lost, there is no baseline and the playtest
says so.

Release the lock as soon as the capture has finished; nothing after this
touches the shared checkout. Start the watch judge as described in
[docs/watch-rubric.md](../docs/watch-rubric.md) for a playtest ("The
playtest" there), with both folders. It is told nothing about what merged
between the two commits. It sits in the seat of a viewer who owns one
resident among the capture's 15 and returns:

- whether today's capture is better, the same or worse than the last one,
  with the reason and the frames it rests on (read from `compare.png` and
  the two folders);
- the absolute verdict's three answers (find, follow, stay);
- an open-ended list of what that player would complain about, one line
  each with the frame it shows in, worst first.

It gives no scores. This is the one blind check of whether the game got
worse: the look pass on a pull request is the art director's, which knows
what the change was for.

Then publish to the `media` branch (it holds no code and is not protected)
from a separate worktree, so the shared checkout stays as it is:

```sh
git fetch origin media
git worktree add "$TMP/media" origin/media --detach   # TMP: a fresh temporary directory
# copy the showcase set into showcase/ under its stable file names;
# add the playtest to the top of playtest.md, newest first: date, commit
# judged, commit compared with, better/same/worse and why, the three
# answers, then the list as the judge wrote it
git -C "$TMP/media" add -A && git -C "$TMP/media" commit -m "Showcase and playtest for <sha>"
git -C "$TMP/media" push origin HEAD:media
git -C "$TMP/media" rev-parse HEAD                    # the media commit to link
git worktree remove "$TMP/media"
```

Every line of the playtest is a fix-now finding, and so is a "worse". File
each as an issue labelled `watch` and `ready`, unless an open issue already
covers it; then comment on that issue instead, as step 7 of
[cycle.md](cycle.md) describes (`[conductor] raised again:` and a link to the
playtest). The issue for a "worse" lists the pull requests merged between the
two commits (`git log --oneline <compared> <judged>`), so the builder can
find which one did it.

## 3. Health

- The `capture` workflow runs only on pushes to `main` and is not required,
  so nothing else looks at it. Check its last run and its two jobs, `capture`
  and `long-tests`
  (`gh run list --workflow capture.yml --branch main --limit 1`, then
  `gh run view <run id>`). The conductor files a `bug` for each failing job,
  unless an open issue already covers it. A run cancelled by a newer push is
  not a failure; look at the newest run that finished.
- No merge in 24 hours while `ready` issues exist: find out why (a stale lock,
  a pull request waiting on a reviewer, red CI, a blocked issue) and say what
  the next cycle should do about it. Clear a lock older than 150 minutes
  only if the activity check in section 0 of [cycle.md](cycle.md) finds
  nothing.
- An `in-progress` issue with no activity for a day: comment on it with what
  is known.
- Disk: `docker system df`. Report it if this project's images and volumes
  pass 6 GB. Remove only this project's dangling images.
- Merged branches still on the remote: delete the ones named `i<number>-…`.

## 4. The digest

Post to the thread, under these headings and in this order, as short as the
facts allow:

1. **Merged.** Pull requests merged since the last digest, one line each.
2. **Now.** The issue each builder is on, and the next two in the queue.
3. **Playtest.** The storyboard, embedded, better, the same or worse than
   the last one and why, the three answers, and the playtest's first five
   lines.
4. **Decisions you can veto**: anything added to `docs/decisions/` since the
   last digest, one line each with the alternative.
5. **Stuck or odd**: only if there is something.
6. **Milestone.** Closed and open issue counts.

Also post the digest as a comment on the "Operator log" issue, so the history
is in the tracker. In place of the local image, link the storyboard at a fixed
`media` commit (a link with the commit id, so an old digest keeps showing the
picture it described): the commit pushed in step 2, or on a day without a new
capture the current tip of `media` (`git ls-remote origin media`). If `media`
does not exist yet, say there is no capture yet.
