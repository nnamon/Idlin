# The daily digest

Run once a day by the "Idlin daily digest" schedule. It tells the operator
where things stand, runs the day's watch review, and checks the swarm is not
stuck. It builds nothing.

## 1. Gather

```sh
git fetch origin
git log origin/main --since="24 hours ago" --oneline
gh pr list --state merged --search "merged:>=<yesterday>" --json number,title,mergedAt
gh pr list --state open
gh issue list --state open --json number,title,labels,milestone
gh run list --branch main --limit 3
```

## 2. Watch review

Skip this step if the capture harness does not exist yet, or if the lock in
`$(git rev-parse --git-dir)/idlin.lock` is younger than 150 minutes (a cycle
is using the checkout; use the newest folder in `captures/` instead).

Otherwise take the lock, check out `main`, run
`docker compose run --rm capture`, and start the watch judge as described in
[docs/watch-rubric.md](../docs/watch-rubric.md), without a baseline. Then:

- append the scores to `docs/watch-log.md` (date, commit, seven scores, hard
  fails) through a small pull request that follows the normal gates;
- file each finding as an issue labelled `watch` and `ready`, unless an open
  issue already covers it;
- push the showcase set from the new capture to the `media` branch (stable
  file names under `showcase/`), so the README shows the game as it is today;
- release the lock.

## 3. Health

- No merge in 24 hours while `ready` issues exist: find out why (a stale lock,
  a pull request waiting on a reviewer, red CI, a blocked issue) and say what
  the next cycle should do about it. Clear a lock older than 150 minutes.
- An `in-progress` issue with no activity for a day: comment on it with what
  is known.
- Disk: `docker system df`. Report it if this project's images and volumes
  pass 6 GB. Remove only this project's dangling images.
- Merged branches still on the remote: delete the ones named `i<number>-…`.

## 4. The digest

Post to the thread, under these headings and in this order, as short as the
facts allow:

1. **Merged** — pull requests merged since the last digest, one line each.
2. **Now** — the issue in progress, and the next two in the queue.
3. **Watch** — the storyboard, embedded, the seven scores, and the top finding.
4. **Decisions you can veto** — anything added to `docs/decisions/` since the
   last digest, one line each with the alternative.
5. **Stuck or odd** — only if there is something.
6. **Milestone** — closed and open issue counts.

Also post the same text as a comment on the "Operator log" issue, so the
history is in the tracker. Link the storyboard on the `media` branch in place
of the local image, and leave out section 5's machine details (disk use, Docker
state, local paths): those go to the thread only.
