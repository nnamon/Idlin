# Broadcast presentation — the watchable layer

Idlin is a **broadcast first**: the world must be *watchable*, not merely correct.
This is the standing spec for how the simulation is presented to spectators — the
spectacle, the director, and the HUD that turn a living world into a highlight
reel. It starts with the Atlas map device (the population's funnel and the show's
centerpiece, `atlas.md` §4) and the camera/HUD that frame everything.

## Principles

- **Gameplay-private, spectacle-omniscient.** Gameplay rules govern what a
  character may *do*; presentation is free to *show* whatever is most dramatic.
  The two never have to agree — e.g. each idler can only enter their own map
  portal, but the broadcast may show every portal in the plaza tearing open.
- **Curated, not a god-view.** The broadcast features **one world at a time** plus
  a cherry-picked highlight; everything off-camera is folded into stats, not shown
  raw. (This rides the existing director: it features the most-alive world and
  follows a character across worlds.)
- **Read the stakes at a glance.** Danger, rarity, tier, streaks — legible from
  the visuals and HUD without reading numbers.

## The map device as spectacle (the departure gate)

The gameplay is in `atlas.md` §4 (a portal plaza; transit-not-accumulation;
per-owner portals). The *show*:

- **The rift IS the chart.** A map's portal visually encodes the chart:
  - **rarity rim** — white / blue / yellow / orange, like an item, for an instant
    "ooh, an orange map";
  - **danger glow scaled by the map's derived reward/danger** (`atlas.md` §2) — a
    juiced, high-tier chart tears a **bigger, angrier, more violent** rift (size,
    particle intensity, color, a touch of screen-shake), so watchers can *see*
    who's running something spicy. The danger-derives-reward model pays off
    visually here: scary portal ⇒ big stakes.
  - **themed to the tileset family** — a stormy drowned-shore rift reads
    differently from a future desert/crypt one.
- **Spectator omniscience.** Non-owner viewers see **all** idlers' portals
  opening in the plaza, even though no one could step through another's. The plaza
  becomes a churn of opening rifts — the iconic "gateway" establishing shot.
- **A departures / arrivals board.** An airport/station-style overlay at the
  plaza: who is heading into what tier right now, and **returns get a beat** — a
  boss-kill return is **fanfare** (loot, a flourish); a death-return (portals
  spent, run failed) reads as **defeat**. The crowd becomes legible narrative.

## The director

- **Cuts** between the lively town/plaza and the **hottest live run** — a boss
  pull, a near-death, the deepest tier in progress, a deathless streak. The
  "hottest run" selection extends the existing most-alive heuristic with drama
  signals (boss engaged, low-life, record tier).
- **Picture-in-picture:** the featured run, with a town minimap showing
  **blooming portal markers** so the lobby's life stays on screen during a run.
- **Town instancing is invisible to the viewer:** the broadcast features one
  lively town instance plus cherry-picked runs; other town instances
  (`max_players` overflow) are off-camera, their activity aggregated into the
  ticker — never a raw god-view.

## HUD / ticker

- **Leaderboard ticker:** deepest tier today, longest deathless streaks, recent
  pinnacle-boss kills — stakes on screen even during the calm town shot.
- **Per-run badges** on the featured run: tier, the chart's danger mods, portals
  remaining, and the derived quantity/rarity — so a viewer reads the risk/reward
  of what they're watching.

## Decisions taken (redline if wrong)

These were chosen from the design discussion; flag any you'd change:

1. **Gate geometry:** a **ring of pads** + fast phase-out (best for both crowding
   and the gateway shot), over a single altar.
2. **Spectator omniscience:** non-owners see **all** portals (for spectacle), not
   only the featured idler's.
3. **Town instancing:** broadcast = **one featured town instance + cherry-picked
   runs**; other instances aggregated into stats, no god-view.
4. **Returns-as-drama:** **yes** — boss-kill fanfare and death-return beats
   (cheap, high narrative value).

## Scope & relationship to other docs

- This layer is **presentation only** — it never changes sim state or
  determinism; it reads the authoritative wire stream and frames it. Gameplay
  truth lives in `atlas.md` (the device/instances) and `persistent-server.md`
  (worlds, the director's world set).
- It will grow beyond the device (combat FX language, the camera grammar, event
  styling). Implementation status is tracked in its own issue when the build
  starts; this document is the standing target.
