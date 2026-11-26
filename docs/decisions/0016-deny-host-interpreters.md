# 0016: Deny interpreters on the host in `.claude/settings.json`

Date: 2026-11-27. Issue #280. Section 1 of `AGENTS.md` allows only `git`, `gh`
and `docker` on the host, and every brief repeats it, but children still ran
python, perl and `sed -i` on the host to filter JSON, crop images or edit a
file.

| Decision                                                                                                                                                                        | Rejected alternative                                    | Why                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A checked-in `.claude/settings.json` with `permissions.deny` rules `Bash(python*)`, `Bash(perl*)`, `Bash(node*)`, `Bash(ruby*)`, `Bash(sed -i*)`, `Bash(awk*)` and `Bash(jq*)`. | Keep relying on the rule in `AGENTS.md` and the briefs. | The written rule was broken five times in a day. A deny rule refuses the command before it runs, in every Claude session started in the repo or a worktree of it. |
| Rules with no space before `*`, so `python*` also catches `python3` and `python3.12`, and `sed -i*` catches `sed -i ''` and `sed -i.bak`.                                       | One rule per exact name, with a space before `*`.       | Fewer rules, and none of the names it also catches (`perldoc`, `nodemon`) has a place on the host either.                                                         |
| Only the commands the issue names. `ls`, `cat`, `sed -n` and `gh … --jq` still work.                                                                                            | Deny every command but `git`, `gh` and `docker`.        | Read-only commands do no harm, and a broad deny would get in the way of looking at files.                                                                         |

The rules match the start of each command, so `docker compose run --rm dev node …`
is not affected, and a command that hides the name, such as `/usr/bin/python3`,
may get past them. They catch the habit; the rule in `AGENTS.md` still applies.
Codex sessions do not read this file. `tools/capture/src/settings.test.ts`
checks the list against sample commands in the gate.
