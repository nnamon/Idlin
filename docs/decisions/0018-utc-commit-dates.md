# 0018: Commit dates in UTC, set for sessions and checked in CI

Date: 2026-11-27. Issue #287. Section 1 of `AGENTS.md` says every commit is
made with `TZ=UTC`, but commits still reached `main` with a local offset in
the committer date, usually after an amend or a rebase.

| Decision                                                                                                                                      | Rejected alternative                                    | Why                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `.claude/settings.json` sets `"env": { "TZ": "UTC" }`.                                                                                        | Keep relying on `TZ=UTC` in front of each `git commit`. | Every command a Claude session runs, including amend and rebase, then dates in UTC without anyone remembering.                  |
| A step in the `gate` job, for pull requests only, checks every commit in base..head and fails if its author or committer date is not `+0000`. | A separate workflow or a check run only on `main`.      | `gate` is the required check, so a bad date stops the merge. On `main` it would come too late, since `main` is never rewritten. |
| The step prints the short hash and "not dated in UTC", not the offset.                                                                        | Print the dates so the fix is obvious.                  | The offset is the local time zone, which section 1 keeps off GitHub, and CI logs are public.                                    |

The checkout now fetches full history (`fetch-depth: 0`) so the step can walk
the pull request's commits. Codex sessions do not read `.claude/settings.json`,
so they still need `TZ=UTC` on the command line; the CI step catches them too.
Commits already on `main` with an offset stay as they are.
