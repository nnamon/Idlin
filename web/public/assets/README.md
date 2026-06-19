# Bundled art assets

All models are **CC0 (Creative Commons Zero)** by Quaternius
(quaternius.com), downloaded from quaternius.itch.io. Attribution is not
required by the license; we credit anyway. Thanks, Quaternius.

## UI sprites (`ui/`)

`ui/orb-*.png` are the HUD life/mana globes, composited from the **CC0** "Health
Orb" layers by **itsmars** (opengameart.org/content/health-orb-11) — the v1.0
fill/highlight spheres plus the v1.1 PSD's stone border + cradle. The orb renders
as stacked layers (the client composites them per pool state), all sharing the
same sphere geometry so they align:

- `orb-empty.png` — the stone frame (ornate border + cradle), transparent interior.
- `orb-life-fill.png` / `orb-mana-fill.png` — the red/blue liquid sphere (tinted
  fill), clipped from the bottom to the pool percentage.
- `orb-es-fill.png` — a light-blue right semicircle (recoloured fill) for energy
  shield, clipped from the bottom; its inner edge is a concave meridian.
- `orb-reserved.png` — the granite sphere (the v1.0 dark-glass back), clipped from
  the TOP to show reserved (unavailable) life/mana.
- `orb-glass.png` — the glass surface gloss/highlight, the topmost shared layer.

CC0 needs no attribution; we credit anyway. Thanks, itsmars.

## The modular character system

Characters are a paper-doll: `models/body.glb` carries the universal rig,
the base body, and every animation clip; `models/parts/*.glb` are outfit
pieces skinned to the same rig that the client binds to a body's skeleton
at runtime. Which parts an entity wears comes from the replicated `gear`
list — equipping a vest or helm visibly changes the character.

| piece | source pack |
| --- | --- |
| `body.glb` | Universal Base Characters (Superhero Male) + clips from Universal Animation Library 1 & 2 |
| `parts/male_peasant_*` | Modular Character Outfits: Fantasy — Peasant (default rags; also dresses the drowned-villager monsters) |
| `parts/male_ranger_*` | Modular Character Outfits: Fantasy — Ranger (armor visuals for helm/vest/boots items) |
| `stalker.glb` | Lowpoly Animated Monsters — Skeleton (own rig and clips) |
| `cleaver.glb` / `bow.glb` | Lowpoly Medieval Weapons — Axe / Bow_Wooden |
| `wand.glb` | Lowpoly Medieval Weapons — Dagger (stand-in until a real wand mesh) |

Monster archetypes reuse the body: `shambler` and `husk` are tinted,
re-scaled zombie-villagers driven by the UAL2 zombie clips. Known gap: the
free animation tiers have no bow-draw clip, so the bow attack plays
`Pistol_Shoot` (an aimed-ranged pose) until one is sourced.

The committed `.glb` files are pruned (normal/ORM maps stripped — base
color carries the flat-shaded look), texture-resized, and
meshopt-compressed by `web/scripts/process-assets.mjs`; see its header for
sources and re-run instructions.

`manifest.json` is the only binding between wire keys and asset files:
models (clips per state-machine role, hand-slot bone, default outfit,
tints), parts (paper-doll region + files), and weapons. Swapping the art
style is editing this file plus dropping in new glTFs — no code changes.
