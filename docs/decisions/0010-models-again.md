# 0010: Claude children are Opus 5.5 or higher, and any model may review

Date: 2026-11-27. The operator's ruling on #258: "The minimum model should be
Opus 5.5 Medium or higher for claude. Sonnet is way too stupid." and "I don't
need a different model for the reviewer. That was your choice not mine." and
later "You can also get mythos to review if you need the intelligence."
Replaces the code review row of [0006](0006-models-after-the-switch.md) and the
reason it gives for Codex as the watch judge fallback.

| Decision                                                                                                                                 | Rejected alternative                                                          | Why                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every Claude child runs on Opus 5.5 at effort `medium` or higher. Sonnet and Haiku are not used.                                         | Sonnet 5.5 as the reviewer when Codex is out.                                 | "Sonnet is way too stupid."                                                                                                                                                     |
| Code review goes to a fresh Opus 5.5 child that did not build the change. Codex `gpt-6.2-sol` may review instead while its limits allow. | Codex first, with a reviewer that must be a different model from the builder. | "I don't need a different model for the reviewer. That was your choice not mine." A fresh child has not seen the build, so it reads the diff without the builder's assumptions. |
| The watch judge stays Mythos 5.2. When Mythos is out, Codex judges, or a fresh Opus 5.5 child at effort `high`.                          | Codex as the only fallback, chosen because Opus built the change.             | The judge sees only the captures and the rubric, so it doesn't matter that the builder ran on the same model. Opus gives a fallback when Codex is out of quota.                 |
| Mythos 5.2 reviews code when the change is hard to get right (concurrency, data safety, the simulation's determinism, a large change).   | 0006's rejection of Mythos reviewing code too.                                | "You can also get mythos to review if you need the intelligence." The operator granted it where the intelligence is worth the quota.                                            |
