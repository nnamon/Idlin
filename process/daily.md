# The daily digest

Run once a day by the "Idlin daily digest" schedule. It tells the operator
where things stand, runs the day's watch review, and checks the swarm is not
stuck. It builds nothing.

## 0. Before anything is posted

Section 1 of `AGENTS.md` applies to everything this run sends to GitHub: the
commit to the `media` branch (images and the watch log), watch findings, issue
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

## 2. Watch review

Skip this step if the capture harness does not exist yet. If the lock in
`$(git rev-parse --git-dir)/idlin.lock` is younger than 150 minutes, a cycle
is using the checkout: skip the capture, the judging and the `media` push
today. The digest then says the watch review was skipped because a cycle held
the lock, and shows the last capture pushed to `media`. A conductor session
running this step between cycles ignores its own lock, neither takes nor
releases one, and goes straight to the commands below.

Otherwise take the lock, then:

```sh
git checkout main && git pull --ff-only origin main
git rev-parse HEAD            # must equal origin/main; this is the commit judged
docker compose run --rm capture
```

Release the lock as soon as the capture has finished; nothing after this
touches the shared checkout. Start the watch judge as described in
[docs/watch-rubric.md](../docs/watch-rubric.md), without a baseline.

Then publish to the `media` branch (it holds no code and is not protected)
from a separate worktree, so the shared checkout stays as it is:

```sh
git fetch origin media
git worktree add "$TMP/media" origin/media --detach   # TMP: a fresh temporary directory
# copy the showcase set into showcase/ under its stable file names;
# append one line to watch-log.md: date, commit judged, scores, hard fails
git -C "$TMP/media" add -A && git -C "$TMP/media" commit -m "Showcase and watch log for <sha>"
git -C "$TMP/media" push origin HEAD:media
git -C "$TMP/media" rev-parse HEAD                    # the media commit to link
git worktree remove "$TMP/media"
```

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

1. **Merged.** Pull requests merged since the last digest, one line each.
2. **Now.** The issue in progress, and the next two in the queue.
3. **Watch.** The storyboard, embedded, the scores, and the top finding.
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
