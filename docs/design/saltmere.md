# Saltmere — the tutorial town (curriculum design)

Saltmere is **act 1's teaching camp**, not the main hub. Where the Withered
Shore teaches combat through a gated tutorial, Saltmere teaches *town
mechanics* the same way — each system introduced as a lesson. The real main
town (atlas hub, map device, full vendor row, the memorial/statue ideas) is a
separate future zone; Saltmere stays small and didactic. (Issue #23.)

## The curriculum

The Saltmere brain (`content/areas/saltmere/brain.bot`) greets each arrival
and then drips four lessons, one every ~5s, in the proven shore-choreography
shape (minus gates — a town is open; the lessons are narration):

1. **Vendors** — sell your strand-trash to the Smith / Quartermaster for obols.
2. **Stash** — bank the boss-hoard you can't lift yet at the plaza chest.
3. **Crafting** — spend an obol to wake a base item's latent magic.
4. **Bounty** — the board wants the Tidewarden; read it, take the south road.

The *mechanics* are real bot-facing syscalls; the brain only teaches them.

## What shipped (v1)

- **Vendors — full.** A `VendorDef` content type (`content/vendors/*.ron`):
  `pays_currency` + `pays_amount[rarity]` (what selling pays) and a `stock`
  list (what it sells). A neutral `MonsterDef` becomes a vendor via
  `shop: Some("<vendor id>")`. Five syscalls: `ReadVendors` (discovery —
  vendors are invisible to the enemy/character queries), `ReadShop`,
  `VendorSell`, `VendorBuy`, and `ReadBounties`. All proximity-gated to 2u,
  mirroring the stash. Logic lives in `crates/idlin-sim/src/world/vendors.rs`.
- **Stash & crafting lessons** — narration over the existing mechanics (stash
  from #20, currency/`UseCurrency` from #18). No new mechanic.
- **Bounty board — readable.** `ZoneDef.bounties` + `ReadBounties`. Saltmere
  posts one starter bounty (clear the Tidewarden).

## Deferred (flagged follow-ups)

- **Bounty turn-in / payout.** Completing a "clear the coast" bounty is
  inherently *cross-zone*: the kill happens in the player's private
  `withered_shore` instance, the reward is claimed back in shared Saltmere.
  Doing it right needs **persistent per-character quest progress** that
  survives the ferry — and net ids are reassigned on zone re-entry, so the
  zone-brain's per-net-id state can't track a round trip. That's its own
  subsystem (a `CharacterState.quests` map, accept/progress/claim verbs,
  serialized + hashed). Until then the board is read-only and the brain just
  pitches it.
- **Bench-gating crafting.** A crafting "bench" as a required place would gate
  `UseCurrency` to a town spot — but that breaks the grinder's
  craft-anywhere loop. Left as a narrated lesson; gating is a design choice to
  revisit when crafting moves townward.
- **Grinder teaches vendor-selling.** Kept out so the #23 golden move is
  attributable purely to new content, not a changed bot program. Easy to add.
- **Trade ticker events.** Vendor sells/buys are state-only in v1 (no new
  wire `GameEvent`); surfacing them on the broadcast ticker is a follow-up.
- **A real main-hub town** with the map device and full services (post-atlas).

## Notes

- Vendors are neutral (`hostile: false`) and stationary (`speed_cps: 0`); the
  Faction model already makes neutrals un-attackable.
- Golden moved by `content_hash` only — the golden runs `withered_shore`, where
  none of this content ticks; shore-resident monsters all sort before the new
  `vendor_*` defs so no state-folded `def_idx` shifted.
