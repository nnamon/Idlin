# One character, forever — the committed long arc

**Decision (issue #24):** Idlin has **no leagues and no stable of alts**. One
idler is the long-term object of play — PoE-style solitary depth. Every
progression system must deepen a SINGLE character rather than invite a reroll.
This doc settles which arcs we commit to.

> Scope note: this is a design commitment, not an implementation. It picks the
> arcs and says how they reinforce one-character focus. Items marked **shipped
> (on main)** exist today (cited); items marked **committed via #N** are real but
> live on an open PR not yet merged; items marked **arc** are the committed plan.
> The choice of three arcs is the author's discretion under #24 — flagged for
> redline.

## The base mountain (committed via #22): exponential to 100

The level curve is the spine everything hangs on. **#22** (PR open, not yet on
main — main is still the plain quadratic `80 + 40·L²`) makes levelling a true
long climb: a hybrid curve `(80 + 40·L²)·1.08^max(0,L−5)`, identical to today's
curve through L5, reaching **~5.7 billion** cumulative XP at level 100. Levels
1–5 stay gentle (onboarding untouched); the back half is a mountain measured in
weeks, not an afternoon. This is the timebase that makes the arcs below *long*
instead of *grindy-then-done*, so we commit to it as the base.

Gems ride the same clock at a deliberately slower gear: gem XP-to-next is
`60 + 30·L²` with a **cap of 20** (`GEM_LEVEL_CAP`), and a skill's support
capacity unlocks at gem level **7** (2nd) and **14** (3rd). A character's
*skills* therefore keep maturing long after its *level* slows — a second,
overlapping climb on one idler. (Both shipped.)

## The three committed arcs

We commit to **three** arcs. Each is endless-by-sidegrade (choice, not a wall),
each is bound to one character, and together they cover the three axes a solo
character grows along: **where** it can go, **what** it is, and **how** it
thinks.

### Arc 1 — The Atlas (WHERE): map tiers + a per-character atlas tree

*Status: arc (the capstone, tracked as #21).*

A PoE2-style atlas is the spatial endgame. Maps are items that open instanced
zones at a **tier**; clearing them unlocks higher tiers and earns points in a
**per-character atlas passive tree** — a second tree, separate from the build
tree, spent on *where and how you map* (pack size, rarity, specific content
weighting) rather than on the character's body. It is endless sidegrade choice
with **no reroll**: you re-weight your atlas, you don't start over.

Folded into this arc:
- **Pinnacle bosses** behind assembled keys (drops from sustained mapping),
  with **per-character completion marks** — the trophies a single idler
  accumulates.
- The atlas tree is the natural home for the "deepest content" pressure that
  makes higher tiers matter.

Why it fits one-character: an atlas is *the* PoE answer to "what do I do at
endgame without rerolling" — horizontal, character-bound, infinite.

### Arc 2 — The Bot (HOW): the program is progression

*Status: arc (Idlin-native; the part no other ARPG has).*

In Idlin the character *is a program*. So the deepest, most Idlin-true
progression is the **code itself getting better** — the same idler running an
increasingly sophisticated brain. We commit to making that legible and
rewarding:

- **Per-character ladder stats** that record what the bot achieved: deepest map
  tier, deathless streak, fastest pinnacle kill, longest unbroken uptime. These
  are the character's *story*, written by its code.
- The grinder template is the floor, not the ceiling: the build planner +
  templates (the portal, **#17**) are the on-ramp; the ladder is the reason to
  iterate.
- Crucially this needs **no reroll either** — you redeploy a better program onto
  the SAME character (`Bot::redeploy` already preserves the persist block and
  identity across swaps). Improving the code is improving the character.

Why it fits one-character: it turns the skill ceiling from "make a new build" to
"write a better idler" — depth that lives entirely on one character.

### Arc 3 — Reformation (WHAT): re-form one character, never re-roll

*Status: mostly shipped on main (respec, the crafting-currency engine, the
rare hunt); uniques land via #6. This arc commits to keeping identity fluid
WITHIN one character so alts are never the answer.*

The gear/skill/tree systems already let one idler become a different idler
without starting over — we commit to that as a pillar, not an accident:

- **Gear chase** — uniques (**committed via #6**, PR open: `UniqueDef` + fixed
  grants; on main the unique pool still fizzles), dropped **rares of 3–5
  affixes** (`loot.rs` rolls `3 + rng(3)`) that **crafting can push to 6** (the
  Exalted op, capped at 6), over the full PoE-verb **crafting currency**
  (transmute → divine — the affix-engine spend is **shipped on main**; **#18**
  adds the grinder's spend loop + its design doc) — together an unbounded item
  hunt.
- **The Regret Obol respec** (shipped) makes the *build tree* re-formable: drop
  allocated nodes, re-walk, and the sim un-sockets orphaned gems and sheds gear
  you no longer qualify for. You change what your character *is* in place.
- **Gem maturation** (above) is the slow half of identity: which skills you grow
  and which supports you marry to them. Future depth (gem **quality**,
  **corruption**) extends this without adding characters.

Why it fits one-character: identity is a dial you turn, not a slot you fill. A
new playstyle is a respec + a gear swap, never a new save.

## Parked / out of scope (deliberately)

- **Prestige / rebirth** — parked. It rewards *ending* a character, which fights
  one-character focus. Only revisit if reframed as a within-character cycle
  (e.g., an atlas-tree "ascendancy" that keeps the same idler).
- **Leagues / seasonal ladders** — none for now (the user's call); the ladder in
  Arc 2 is permanent and per-character, not seasonal.
- **Community / town goals** — KIV; revisit after the atlas lands (the main hub
  town arrives with it).

## How the arcs interlock

The base curve (#22) sets the clock. **Level** climbs the body; **gems** mature
the skills; **Reformation** keeps both re-shapeable so you never reroll;
**the Atlas** gives that ever-stronger character somewhere endless to go; and
**the Bot** ladder makes *getting better at driving it* its own progression.
Three axes — where, what, how — all converging on a single idler that a viewer
tends for weeks. That is the game's long game.

## Concerns for redline

- **Three vs two arcs.** #24 asks for 2–3; I committed to three because dropping
  any one collapses an axis (drop Atlas → no spatial endgame; drop Bot → lose
  the Idlin-native hook; drop Reformation → alts creep back in). If a tighter
  scope is wanted, **Atlas + Bot** are the two I'd keep (Reformation is mostly
  shipped and can ride as "a pillar we maintain" rather than a headline arc).
- **Atlas is the biggest build** by far (#21) and gates the town/community work.
- **Ladder stats** (Arc 2) are new server state (per-character records,
  persisted + shown on the portal/stream) — modest but not free; the smallest
  first slice is "deepest map tier + deathless streak."
