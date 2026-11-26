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

Skip this step if the capture harness does not exist yet. If the lock in
`$(git rev-parse --git-dir)/idlin.lock` is younger than 150 minutes, a cycle
is using the checkout: skip the capture and the judging today, and show the
newest finished capture in `captures/` whose commit is on `origin/main`,
saying which commit it is.

Otherwise take the lock, then:

```sh
git checkout main && git pull --ff-only origin main
git rev-parse HEAD            # must equal origin/main; this is the commit judged
docker compose run --rm capture
```

Release the lock as soon as the capture has finished; nothing after this needs
the checkout. Start the watch judge as described in
[docs/watch-rubric.md](../docs/watch-rubric.md), without a baseline. Then, in
one commit pushed straight to the `media` branch (it holds no code and is not
protected):

- the showcase set from the new capture, under stable file names in
  `showcase/`, so the README shows the game as it is today;
- one line appended to `watch-log.md`: date, the commit judged, the scores,
  hard fails.

File each finding as an issue labelled `watch` and `ready`, unless an open
issue already covers it.

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

Also post the digest as a comment on the "Operator log" issue, so the history
is in the tracker. In place of the local image, link the storyboard at the
`media` commit just pushed (a link with the commit id, so an old digest keeps
showing the picture it described).

Section 1 of `AGENTS.md` applies to everything this run posts to GitHub: the
comment, watch findings and issue comments carry nothing about the machine.
Disk use, Docker state and local paths go to the thread only.
