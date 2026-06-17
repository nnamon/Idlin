# Idlin — engineering process & working agreement

Binding process for any non-trivial change (anything earning its own PR). Read it
before you start; it is not optional.

Idlin is a **deterministic, broadcast idle-ARPG**: a pure Rust simulation core that
every observer replays bit-identically, with player *and* monster behavior expressed
as bytecode "bots," fronted by a web viewer. **Determinism is the product** — two
machines must compute the same world from the same inputs, forever. Most of this
process exists to protect that.

Crates (leaf → root): `idlin-vm` (the bytecode VM) and `idlin-protocol` (wire types)
are leaves; `idlin-botc` (the `.bot` compiler) → vm; `idlin-content` (RON content +
the stable-id registry/generator) → botc; `idlin-sim` (the world) → {content, vm,
botc}; `idlin-server` → {botc, chat, content, protocol, sim}. The web client (`web/`)
renders replicated protocol state.

Most rules carry **✅ do / ❌ don't** examples — match the example when in doubt.

---

## 1. Actors

- **You (implementer + supervisor).** Own the design, the implementation, AND the
  verification. Spec the change as an issue, build it, verify against real artifacts,
  run an independent critic, triage its findings, gate the commit, open the PR.
  Distrust your own "done" — apply this loop to your own work with full rigor, or the
  critic becomes your QA.
- **Critic — a different model, by hard rule.** `codex exec -m gpt-5.5` (NOT
  `gpt-5.5-codex`), pointed at the **uncommitted diff** and prompted to **REFUTE** —
  never the same pass that wrote the code, and **never an in-harness Claude/Opus
  `Agent` subagent.** A Claude critic on Claude-written code shares training and
  failure modes, so it is only weakly independent; **cross-model review is the entire
  point of the gate.** Invoke in the background, wait death-aware (`kill -0 "$PID"`
  loop, not a blind `until`), redirect `</dev/null` so it can't block on stdin:

  ```sh
  nohup codex exec -m gpt-5.5 --dangerously-bypass-approvals-and-sandbox \
    -C /Users/amon/projects/idlin/Idlin \
    --output-last-message /tmp/critic.md "$(cat /tmp/critic_prompt.md)" \
    </dev/null > /tmp/critic.log 2>&1 &
  ```

  Skeleton prompt — judge **both correctness and design**:

  > Adversarial critic. REFUTE that this diff is correct, complete, deterministic, AND
  > well-designed. Review ONLY the uncommitted diff (`git diff HEAD`, `git status`).
  > For each defect: file:line, a concrete repro, verdict CLOSED / STILL-OPEN / NEW.
  > Hunt specifically for <the risk areas of THIS change>.
  >
  > **Correctness/determinism:** confirm the new tests fail if the fix is reverted
  > (mutation reasoning); run fmt / clippy / test + the determinism trio.
  >
  > **Design:** flag architectural smells; flag where the change **reinvents a
  > component that already exists instead of reusing it**; flag **over-engineering**
  > (abstraction, generality, or config the spec doesn't call for); reward the simple,
  > elegant path that fits the existing architecture. A correct-but-inelegant or
  > needlessly-complex diff is STILL-OPEN, not MERGE.
  >
  > Per-area verdicts; conclude MERGE or DO-NOT-MERGE.

- **Background coder / the `Workflow` tool** — held in reserve for large
  *parallelizable* work only. The default is: you implement directly.

## 2. The development loop (hard gates)

1. **Spec it as a GitHub issue** — a *paper trail*, not a sign-off gate (the PR is the
   review gate; you don't wait on the issue). A good spec has: the design with
   **`file:line` anchors**, acceptance criteria, **REQUIRED tests including a
   failure/regression path**, explicit non-goals, and a closeout line. One issue per
   PR-worthy feature; trivia, doc tweaks, and review-driven follow-ups ride the
   original issue/PR.

2. **Isolate.** Branch off `main`, one branch per feature. Use a worktree only when
   working something in parallel. Never edit or commit `main` directly.

   ```sh
   git checkout -b feat/<name> main          # usual
   git worktree add -b feat/<name> ../wt/<name> main   # only for parallel work
   ```

3. **Implement to the spec.**

4. **Self-verify — never trust your own first pass.** Run the full local gate
   (§9); confirm ALL pass, not merely exit 0. Then **read the decisive tests** and
   confirm they are non-vacuous (they would fail if the fix were reverted).

5. **Independent critic** on the diff (§1).

6. **Triage every finding against the code yourself.** Critics over-claim — confirm or
   refute each before acting. A refuted finding gets a written reason; a confirmed one
   a fix round + re-critic.

7. **Convergence gate.** Repeat 5–6 until a critic pass is genuinely clean, OR the only
   residuals are out-of-scope / by-design **with a written reason**. A recurring
   *class* of finding → one **structural fix**, not whack-a-mole.

   > ❌ The auto-socket policy sockets a bow gem on a melee character; you special-case
   >    bows. Next round: staves. Next: wands. You are losing.
   > ✅ Make the policy weapon-aware at the one chokepoint — wieldability is checked
   >    once, so no skill type can slip through.

8. **Commit gate** — commit only when ALL hold: critic clean; full local gate green;
   decisive tests read; an **adverse-evidence list** written; generated artifacts
   fresh. Then commit and open a **PR referencing the issue, for human review. Never
   self-merge.**

9. **Verify the whole result of every mutation** — not just that your change landed,
   but that nothing else was lost.

   > ❌ Merged a stacked PR into its base branch, but the base had already been cut to
   >    `main` at an earlier commit → the change was silently lost (this happened: #58).
   > ✅ On "merged," confirm the commit is in `origin/main` BEFORE any local change,
   >    then fast-forward.

## 3. Verification discipline (non-negotiable)

- Build-green / test-green ≠ behavior-verified. **Name the evidence or don't make the
  claim.** Banned: unqualified "clean / done / verified / thorough."

  > ❌ "Gems-as-items works."
  > ✅ "`bots_grind_the_shore` asserts `gems_socketed >= 1` over a live pickup→grid→
  >    socket path; the new socket unit test fails if `as_gem()` is reverted."

- **Evidence, not plausibility.** Every claim carries a file:line citation and comes
  from work actually done (read the whole path, ran it, traced the flow). **grep
  LOCATES; it never CONCLUDES.** No citable evidence = delete the claim.
- **Ground before acting** — verify the live merge state / the real file on disk /
  intent-vs-artifact FIRST. Re-verify architecture facts after a context reset; a
  recalled fact may be stale.
- Never commit with a known-open finding; never downgrade severity to ship.
- Write an **adverse-evidence list** before calling anything finished. The failure
  signal is the critic finding defects in work you called done — drive that to zero.

## 4. Determinism — the crown invariant

The world must replay bit-identically. Idlin's sacred resource is the `state_hash`;
this section is what other processes spend on "real-cost / token" discipline.

- Every non-trivial change runs the **determinism trio**:
  - `golden` — `state_hash` after 2000 ticks, pinned to a constant.
  - `full_determinism_with_bots` — two worlds, same inputs, identical hashes every 100
    ticks.
  - `snapshot_roundtrip_resumes_identically` — serialize → restore → resume identically.
- A `GOLDEN_HASH` change is **intentional and explained.** Re-pin in
  `crates/idlin-sim/tests/golden.rs` with a comment stating *why* (what behavior or
  representation changed). An **unexplained** hash change is a determinism bug —
  bisect, do not re-pin.
- Never put into hashed or serialized state: floats, `Date.now`/wall-clock, `Instant`,
  `HashMap`/`HashSet` iteration order, or unstably-sorted collections. Use `i32`
  Q16.16 fixed-point, the seeded `Pcg32` streams, and `BTreeMap`.
- `content_hash` (FNV-1a over every file under `content/`) folds into `state_hash` —
  editing *any* content file (even a comment in a template) legitimately moves the
  golden hash. That's expected; re-pin with the reason.
- Each serialized/wire format carries its own version — `BYTECODE_FORMAT_VERSION`
  (idlin-vm), `PROTO_VERSION` (idlin-protocol), `SNAPSHOT_FORMAT_VERSION`
  (idlin-server). **Bump on any layout change** so stale data is refused cleanly,
  never mis-decoded.

## 5. The test regiment

Deterministic and zero-cost. **A test must fail if the fix is reverted** (mutation
reasoning) — no production-shaped-but-asserts-nothing fixtures.

> ❌ A fixture that can't fail meaningfully (`if process(x) == nil { fail }` on a state
>    the effect never fires for).
> ✅ A realistic fixture exercising the failure path with a read-back of what persisted.

- **Unit tests** live in-file (`#[cfg(test)] mod tests`) — they need private-item
  access. **Integration tests** live in `crates/*/tests/` — public API only. Both
  conventions are correct; pick by what you're testing.
- Required by change type:

  | Change | Required |
  |---|---|
  | Sim mechanic | non-vacuous unit test (real fixture + a failure assertion) + golden re-pin note |
  | Content (RON) | loader/validation test (rejects malformed) + `gen` regen + golden re-pin |
  | Syscall / ABI | behavior test incl. **invalid / negative / out-of-range inputs (no panic)** + the syscall-number pin test + bot-guide entry + golden |
  | Protocol | `PROTO_VERSION` bump + TS regen + an export/roundtrip test |
  | Bot template / brain (`.bot`) | it compiles + an integration test exercising it + golden |
  | Client UI | the deterministic screenshot harness (§6); mock-first → capture → sign-off |

- **Behavioral spine** — `bots_grind_the_shore` and
  `the_gated_tutorial_teaches_a_stock_grinder_to_saltmere` (`crates/idlin-sim/tests/
  sim_integration.rs`) are the end-to-end loop: fast, deterministic, no provider.
  Extend them as the gameplay backbone, not just per-mechanic units.

## 6. UI discipline (and the harness)

- **Deterministic capture, never timed screenshots.** A screenshot raced against the
  render loop and the sim clock is flaky by construction. The harness injects a fixed
  state, steps a *controllable* clock, awaits an explicit **frame-ready** signal, then
  captures — reproducible pixels every run.
  - **Overlay / inspect panel (React/HTML)** — already deterministic: mount the
    component with a fixed `CharacterSheet` prop in a fixture page, render, capture.
    The cheap, high-value path; most "did this render" questions live here.
  - **3D scene (canvas)** — needs the replay affordance: state injection (canned S2C
    messages, not a live socket), an injectable/steppable clock, and a `frame-ready`
    signal the driver awaits. Playwright headless then: load fixture → step to frame N
    → await ready → screenshot.
- **Mock-first → sign-off → build → screenshot → sign-off.** Builds and critic passes
  do NOT prove a UI is usable; a typecheck is not a render.

  > ❌ "The dimmed offhand works — it typechecks."
  > ✅ "Screenshot of the inspect panel with a two-handed weapon: it shows in both the
  >    weapon and offhand cells, the offhand at 0.4 opacity."

- **Track 1 (React overlay) of the harness exists** (`web/harness/`, run `pnpm -C web
  capture`): canned `S2C` → `store.handle()` → awaited frame-ready (not a sleep) →
  byte-stable PNG, with a non-vacuous on-screen-content assertion. The overlay is a pure
  function of injected state (§6: "already deterministic"), so determinism needs no clock
  here — that's the 3D track. Use it for any overlay/panel change (focus sheet, stats,
  gear, gems) and **eyeball the shot to sign off** — a green run proves deterministic
  render + correct text, only your eyes prove it looks right. See `web/harness/README.md`.
- **Track 2 (the 3D scene) also exists** (#80): a `ZoneRenderer` capture mode steps a
  virtual clock manually (no rAF loop) with a screenshottable back buffer; the fixture
  seeds `Math.random` (terrain/brazier/idle/UUID) and pins the camera, so the scene is
  byte-reproducible same-machine. Use it for scene/canvas changes — `pnpm -C web capture`
  then **eyeball the shot**. (WebGL byte-stability is same-machine only; cross-machine
  pixel drift is expected — shots are gitignored, not committed baselines.)

## 7. Git & PR discipline

- One PR per feature, on a branch (worktree only for parallel), with an independent
  critic, for human review. **Never self-merge. Never straight to `main`.**
- **Keep the PR description current.** The body is the canonical review artifact — the
  first (often only) thing the reviewer reads. When you push scope-changing commits to an
  *open* PR (a new feature, API surface, behavior/contract change, notable fix), refresh
  the description so it reflects the whole branch — `gh pr edit <n> --body …`. A commit
  message or a PR comment is **not** enough.

  > ❌ Added an `unequip` syscall + a refuse-not-drop change to an open PR; left only a PR
  >    *comment*, so the description still listed 3 syscalls and the old "drops" contract.
  > ✅ `gh pr edit` the body to list all 4 syscalls and the new contract, the moment the
  >    commits land.

- On "merged": verify the commit is in `origin/main` BEFORE any local change, then
  `git pull --ff-only origin main`. Prune branches/worktrees only when explicitly
  asked, and only after that verification.
- **No force-push / history rewrite.** Amend a pushed commit by adding a follow-up
  commit instead.
- **No attribution** — never add "Generated with …" or `Co-Authored-By` to commits,
  PRs, issues, or anywhere.
- Prefer full-file replacement (Write / heredoc) over in-place stream edits that can
  silently truncate; then verify the whole result survived.
- Keep scratch out of commits — stage the real files explicitly; never `git add -A` a
  tree that also holds spec or experiment files.

## 8. Communication

- **Terse, evidence-cited, lead with the answer.** No padding, no rhetoric, no
  metaphors. Don't minimize your own failures with diminutives; don't manage the
  narrative when asked for a straight answer.
- Surface what the operator needs to act on (a PR link, a result, a hash) in the
  **same message** as the action — don't make them chase it.

## 9. Operational appendix (commands & repo facts)

**Local gate** — deterministic, zero-cost; run before every PR:

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

The determinism trio runs inside `cargo test`. To run pieces alone:

```sh
cargo test -p idlin-sim --test golden
cargo test -p idlin-sim --test sim_integration -- full_determinism_with_bots snapshot_roundtrip_resumes_identically
```

**Generated artifacts must be fresh (CI diff-gates these):**

```sh
cargo run -p idlin-content --bin gen          # → content/ids.ron, content/lib/gen_ids.bot, web/public/content-docs.json
cargo test -p idlin-protocol export_typescript_bindings
cargo test -p idlin-server --test export_constants
git diff --exit-code content/ids.ron content/lib/gen_ids.bot web/public/content-docs.json web/src/gen
```

**Web:** `pnpm -C web build` (typecheck + bundle); `pnpm -C web exec tsc --noEmit`
(typecheck only).

**Golden re-pin:** edit `GOLDEN_HASH` in `crates/idlin-sim/tests/golden.rs` with a
comment explaining the intentional change.

**The bot↔engine contract (RFC #54):** content is referenced by **stable tagged i32
nums** (`(category << 23) | sequence`); bot-facing reads carry **identity + live state
only** — the definitional fields live in `web/public/content-docs.json`, looked up by
num. The registry (`content/ids.ron`) is append-only / tombstoned; `gen` regenerates
it plus the `.bot` consts and the docs; CI gates drift on all three.

**Local env (this machine):** `cargo` needs `export PATH="/opt/homebrew/opt/rustup/bin:$PATH"`;
`pnpm` is provided via corepack. CI pins the toolchain via `rust-toolchain.toml`.

---

### Quick reference — do / don't

**Do**
- Spec the feature as an issue (paper trail) before non-trivial work.
- Branch off `main`; worktree only for parallel work.
- Self-verify the full gate + read the decisive tests; then run the cross-model codex critic (§1).
- Hold the diff to design quality too: reuse existing components, stay simple, no over-engineering.
- Triage each finding against the code; escalate a recurring class to a structural fix.
- Run the determinism trio; re-pin `GOLDEN_HASH` only intentionally, with a why.
- Name the evidence (file:line + what it shows) for every claim.
- Verify a merge landed in `origin/main` before any cleanup; verify the whole result of every mutation.
- Bump the format version on any bytecode/protocol/snapshot layout change.
- Keep the PR description current — scope-changing commits to an open PR → `gh pr edit --body`, not just a comment.

**Don't**
- Don't edit/commit `main`, self-merge, force-push, or add attribution.
- Don't say clean/done/verified without naming the evidence; don't let grep conclude.
- Don't re-pin an unexplained golden change (it's a determinism bug — bisect).
- Don't put floats / wall-clock / HashMap-order into hashed or serialized state.
- Don't call a UI change done on a typecheck; deterministic capture + sign-off or it's unverified.
- Don't whack-a-mole a recurring class of finding; fix the chokepoint.
