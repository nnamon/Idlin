# One character, forever — progression specification

Idlin's long game is a **single idler, tended for weeks or months**. There are no
alts and no leagues. This document specifies how one character stays worth
investing in indefinitely — the progression model the rest of the design serves.

## The thesis

- **The object of play is one persistent character.** The broadcast follows an
  idler whose story *accrues* — its gear, its skills, its trophies, its code. A
  stable of alts or a seasonal reset fragments that attention and throws away the
  investment the stream is built on.
- **The failure mode we design against is "maxed → reroll."** Every system must
  give a reason to keep pouring into the *same* idler rather than start a new one.
- **The answer is depth on three axes that all converge on one character**, paced
  by a base time-mountain:
  - **WHERE** it can go — the Atlas (§Arc 1).
  - **WHAT** it is — Reformation (§Arc 3).
  - **HOW** it's driven — the Bot (§Arc 2).

PoE-style solitary depth: you re-weight, re-form, and out-code a single
character; you never re-roll one.

## The clock — the base mountain

Two overlapping climbs give one character a long timebase *before* the arcs even
begin.

- **Levels (the body) — an exponential mountain.** XP-to-next follows
  `(80 + 40·L²) · 1.08^max(0, L−5)`: identical to a gentle quadratic through
  level 5 (onboarding untouched), then compounding into a back half measured in
  **weeks** — roughly **5.7 billion** cumulative XP to level 100. Base life
  starts at `100 + 14·(L−1)`; gear, the tree, and attributes (Strength adds flat
  life) feed it through the added → increased → more stat pipeline. A level-up
  recomputes every stat and refills life to full.
- **Gems (the skills) — a slower, overlapping clock.** Each kill feeds **half**
  its XP to the character's socketed gems; gem XP-to-next is `60 + 30·L²` with a
  **cap of 20**. A skill's support capacity is *earned*: 1 support slot, a 2nd at
  gem level **7**, a 3rd at **14**. So a character's *skills keep maturing long
  after its level slows* — a build deepens over weeks as its gems crawl toward 20
  and open their third support.

The body front-loads, the skills long-tail. One idler is already two progressions
deep before the endgame arcs apply.

## Arc 1 — The Atlas (WHERE)

The spatial endgame: ever-harder, ever-more-rewarding content for the same
character, with its own character-bound progression. Specified in full in
`atlas.md`; in one-character terms:

- **Maps are items**; a town device opens them into instanced zones at a tier.
  Clearing them sustains higher-tier maps — the climb is open-ended (the tier
  ceiling and how higher tiers are gated are atlas design choices; see
  `atlas.md`).
- **A per-character atlas passive tree** — a *second* tree, separate from the
  build tree, earned by map completions and spent on *how you map* (pack size,
  content weighting, tier access, boss rewards) rather than on the character's
  body. Endless horizontal sidegrade: you re-weight your atlas, you never reroll.
- **Pinnacle bosses** behind keys assembled from sustained mapping, carrying
  **per-character completion marks** — the trophies one idler accumulates.

Why it fits one character: it is the answer to "what do I do at endgame without
rerolling" — infinite, horizontal, and bound to this character's atlas.

## Arc 2 — The Bot (HOW)

The Idlin-native arc, and the one no other ARPG has: **the character is a
program, so the deepest progression is the code getting better.** The same idler,
driven by an increasingly sophisticated brain.

- **The iteration loop.** The grinder template is the floor; a hand-written brain
  is the ceiling. The portal (build planner + bot-prefs + templates) is the
  on-ramp, and the **authenticated deploy path** (target — the persistent-server
  write verb, `persistent-server.md`) pushes a better program onto the *same*
  character. The primitive it builds on already exists: a redeploy preserves the
  character's identity and persistent memory, so improving the code *is* improving
  the character, with no reroll.
- **The progression is expanding capability; the ladder makes it legible.**
  Better code buys *real* progress — surviving deeper maps, faster clears,
  deathless runs, tighter loot/craft loops — which is genuine character
  advancement (deeper, richer content reached), not merely a number. **Per-
  character ladder stats** (target — today only `kills`/`items` exist) record and
  surface that story on the portal + broadcast HUD: deepest map tier, longest
  deathless streak, fastest pinnacle kill, uptime, peak DPS. *Open: whether ladder
  milestones also grant something mechanical (cosmetic/prestige, or a nod toward
  atlas access) or stay a pure competitive scoreboard.*
- The skill ceiling is "write a better idler," and it lives entirely on one
  character.

## Arc 3 — Reformation (WHAT)

Identity is a **dial you turn, not a slot you fill**. One idler becomes a
different idler *in place* — so a new playstyle is never a reason for a new save.

- **Gear chase.** Uniques (fixed-identity items with build-defining grants — a
  target of the gear design), dropped rares that **request** 3–5 affixes (the
  actual count is bounded by the base's eligible affix pools), which **crafting
  can push toward 6** (Exalted, budget and pool permitting), over the full
  PoE-verb currency economy — transmute, augment, alter, regal, alchemy, chaos,
  exalt, scour, divine — applied to the affix engine. An unbounded item hunt.
- **Tree respec.** The **Regret Obol** re-forms the build tree in place: drop
  allocated nodes, re-walk, and the sim un-sockets orphaned gems and sheds gear
  you no longer qualify for. You change *what the character is* without a reroll.
- **Gem identity.** Which skills you grow and which supports you marry to them
  (the gem clock above) is the slow half of identity. Future depth — gem
  **quality** and **corruption** — extends this on the same character.

Net: a wholesale playstyle change is a respec + a gear swap + a re-socket, never a
new character — with one honest caveat: a change of *skills* re-incurs the gem
clock (the new skills' gems start low and must re-mature). That is the one slow
part of reformation; whether off-build or swapped-in gems get catch-up XP is an
open knob.

## How the arcs interlock

```
        the clock (levels + gems)  ── paces everything ──┐
                                                          ▼
   Reformation (WHAT)  re-shapes the character  ◄──►  the Atlas (WHERE)
        gear · tree respec · gems                     gives it endless
                                                      places to test itself
                          ▲                                  ▲
                          └──────── the Bot (HOW) ───────────┘
              better code drives all of it; the ladder makes
              "getting better at driving one idler" its own progression
```

The clock sets the pace; **Level** climbs the body; **Reformation** keeps the
body re-shapeable; **the Atlas** gives that body somewhere infinite to go; and
**the Bot** ladder turns *driving it well* into progression. Four threads, one
idler, weeks of tending. That is the long game.

## Parked, deliberately

- **Prestige / rebirth.** Rewards *ending* a character — directly against
  one-character focus. Revisit only if reframed as a *within-character* cycle
  (e.g., an atlas-tree "ascendancy" on the same idler).
- **Leagues / seasonal ladders.** None. The Bot ladder (Arc 2) is **permanent and
  per-character**, not a season that wipes.
- **Community / town goals.** Held until the atlas hub town exists.

## Open design choices (for redline)

- **Scope — decided: three arcs.** Each owns an axis; dropping one collapses it.
  Fallback you can invoke if you want it leaner: keep **Atlas + Bot** and let
  Reformation ride as a maintained pillar rather than a headline arc.
- **The ladder stat set** and whether it's purely permanent/per-character or ever
  gains a competitive/seasonal layer (currently: permanent only).
- **Tier-access gating** — does the atlas tree gate higher tiers, or does boss
  completion?
- **Gem quality / corruption** scope and when it lands.
- **Death penalty** — currently reposition-only, no XP loss; whether the endgame
  wants stakes (map portals already provide them; the open world may not).

> Implementation status, dependencies, and per-arc tracking live in the
> one-character issue (#24); the arcs reference their own specs (`atlas.md`,
> and the Bot ladder / Reformation systems). This document is the standing
> target.
