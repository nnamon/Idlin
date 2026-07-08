import type { S2C } from "../gen/S2C";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { NetStatus } from "../net/client";
import type { TooltipItem } from "../ui/ItemTooltip";
import { LIVE_STATUS } from "./stubClient";
import {
  character,
  characterSheet,
  directorCue,
  gear,
  invItem,
  monster,
  sheet,
  simXY,
  skill,
  zoneDelta,
  zoneSnapshot,
} from "./builders";

/** A canned scene replayed through a fresh `WorldStore` with nothing live
 *  behind it. Two kinds:
 *  - `overlay`: render the React HUD; deterministic by purity (Track 1).
 *  - `scene`: render the 3D `ZoneRenderer` under a seeded `Math.random` and a
 *    stepped virtual clock (Track 2). */
export type Fixture =
  | {
      kind: "overlay";
      /** Render the speaker button (#148 A8). */
      sound?: boolean;
      label: string;
      /** Link status the stub client reports (drives the plaque). */
      status: NetStatus;
      /** Messages applied via `store.handle()` before the first render. */
      messages: S2C[];
      /** #79: render the overlay in INDIVIDUAL idler-view mode for this idler. */
      idler?: string;
    }
  | {
      kind: "scene";
      label: string;
      /** Seed for the global `Math.random` override (reproducible geometry). */
      seed: number;
      /** Virtual frames to step (animation settles deterministically). */
      frames?: number;
      /** Fixed camera [x,y,z, targetX,targetY,targetZ]; omit to let the director frame. */
      camera?: number[];
      /** #129: pin the view to this idler — the fog of war then reveals ONLY
       *  what THEY have explored (the /idler/<name> semantics), instead of the
       *  broadcast's union of every character. */
      follow?: string;
      /** #129: `false` disables fog of war — for fixtures whose subject isn't
       *  fog (a monsters-only lineup has no reveal source and would go dark). */
      fog?: boolean;
      messages: S2C[];
    }
  | {
      // The whole game view: the 3D scene with the React HUD mounted over it,
      // from ONE store — so the orbs/panels are seen in their real context.
      kind: "full";
      label: string;
      status: NetStatus;
      seed: number;
      frames?: number;
      camera?: number[];
      messages: S2C[];
      /** #79: render the HUD in INDIVIDUAL idler-view mode for this idler
       *  (focus pinned by name, banner shown, director carousel dropped). */
      idler?: string;
    }
  | {
      // Per-idler MANAGEMENT page (#79): an opaque surface (no 3D scene) fed by
      // the idler's stream — for now just the live event ticker.
      kind: "manage";
      label: string;
      status: NetStatus;
      idler: string;
      messages: S2C[];
    }
  | {
      // The PoE-style item tooltip (#87), rendered standalone from a fixed item +
      // a self-contained docs blob (no fetch, no hover) so the shot is stable.
      kind: "tooltip";
      label: string;
      item: TooltipItem;
      /** A minimal content-docs payload covering the item's affixes/stats. */
      docsJson: unknown;
    };

const FOCUS_ID = 1;
const NAME = "Brakka";

/** A FocusQueue message (the director's rotation roster) from names, marking one
 *  as the camera's current hold — drives the focus carousel. */
const focusQueue = (names: string[], focusedIdx: number): S2C => ({
  type: "FocusQueue",
  data: {
    entries: names.map((name, i) => ({
      name,
      zone: "The Withered Shore",
      level: 40,
      dead: false,
      focused: i === focusedIdx,
      cooldown: false,
    })),
  },
});

/**
 * The focus/inspect panel, fully populated: a level-42 marauder carrying a
 * two-handed weapon — which mirrors into the offhand cell, greyed — plus a
 * bag, gems, currency, and the full stat block. This is the §6 reference
 * scene ("the offhand at 0.4 opacity").
 */
const inspectPanel: Fixture = {
  kind: "overlay",
  label:
    "Focus panel: full inspect sheet for a lv42 marauder with a two-handed weapon (offhand mirrored, dimmed) + accessories (2 rings, belt, amulet) + gloves",
  status: LIVE_STATUS,
  messages: [
    zoneSnapshot({
      entities: [
        character({
          id: FOCUS_ID,
          name: NAME,
          level: 42,
          model: "marauder",
          life_pct: 76,
          kills: 318,
          items: 5,
        }),
      ],
    }),
    directorCue(FOCUS_ID, "carving the strand"),
    focusQueue(["Kargan", NAME, "Veles", "Mirra", "Thane", "Doral", "Sable"], 1), // Brakka centre; neighbours flank

    characterSheet(
      sheet({
        id: FOCUS_ID,
        name: NAME,
        level: 42,
        xp: 1240,
        xp_next: 4096,
        life: 1180,
        life_max: 1530,
        mana: 210,
        mana_max: 240,
        kills: 318,
        dmg_phys: 412,
        dmg_lightning: 88,
        accuracy: 1320,
        evasion: 540,
        armour: 2200,
        resist_fire_bp: 3600,
        resist_cold_bp: 2900,
        resist_lightning_bp: 1200,
        resist_chaos_bp: -600,
        item_rarity_bp: 4200,
        item_quantity_bp: 800,
        // #87 per-stat source breakdown (shown on hover over a stats row).
        stat_sources: [
          { stat: "armour", source: "Brinescoured Helm", layer: 0, value: 800 },
          { stat: "armour", source: "Kelp-Woven Vest", layer: 0, value: 1400 },
          { stat: "accuracy", source: "Rusted Cleaver", layer: 0, value: 120 },
          { stat: "accuracy", source: "Eagle Eye", layer: 1, value: 2500 },
          { stat: "evasion", source: "Wader's Boots", layer: 0, value: 90 },
          { stat: "damage_phys", source: "Rusted Cleaver", layer: 0, value: 40 },
          { stat: "damage_phys", source: "Berserking", layer: 1, value: 3000 },
          { stat: "resist_fire", source: "Brinescoured Helm", layer: 0, value: 1500 },
          { stat: "item_rarity", source: "Greedy Grips", layer: 1, value: 4200 },
        ],
        equipment: [
          // A real rare (base + rolled affixes by content num) so the hover
          // tooltip resolves a full mod list from content-docs (#87 in-context shot).
          gear("Weapon", "Brine Reaver", 2, false, {
            base_num: 16777221, // rusted_cleaver
            item_level: 72,
            mods: [
              { num: 25165825, tier: 0, values: [12] }, // hale → +Life
              { num: 25165862, tier: 0, values: [2000] }, // of_savagery → +#% phys (melee)
              { num: 25165861, tier: 0, values: [1400] }, // of_ruin → +#% crit multi
            ],
          }),
          gear("Offhand", "Brine Reaver", 2, true, {
            base_num: 16777221,
            item_level: 72,
            mods: [
              { num: 25165825, tier: 0, values: [12] },
              { num: 25165862, tier: 0, values: [2000] },
              { num: 25165861, tier: 0, values: [1400] },
            ],
          }), // 2H mirror — dimmed
          gear("Helm", "Brinescoured Helm", 1),
          gear("Chest", "Kelp-Woven Vest", 0),
          gear("Boots", "Wader's Boots", 1),
          gear("Flask", "Small Life Flask", 0),
          gear("Flask 2", "", 0), // empty second flask loop
          gear("Ring", "Coral Band", 1),
          gear("Ring 2", "Coral Band", 2),
          gear("Belt", "Corded Belt", 1),
          gear("Amulet", "Tidal Charm", 2),
          gear("Gloves", "Kelp Grips", 1),
        ],
        inventory: [
          invItem("Small Mana Flask", 0, 0, 0, 1, 2),
          invItem("Frost Nova", 0, 2, 0, 1, 1), // a skill gem (1×1)
          invItem("Coral Band", 1, 4, 1, 1, 1),
          invItem("Quickening", 0, 6, 0, 1, 1), // a support gem (1×1)
        ],
        gems: [
          { name: "Heavy Swing", level: 12, xp: 40, xp_next: 100, support: false },
          { name: "Heavier Blows", level: 8, xp: 12, xp_next: 60, support: true },
          { name: "Cleave", level: 6, xp: 0, xp_next: 0, support: false },
        ],
        // The four headline variants: a damage attack, a damage spell, a
        // no-damage self-buff, and a damage-over-time — proving the card shows
        // each gem's pertinent metric, not a misleading "0 DPS".
        skills: [
          skill({
            name: "Heavy Swing",
            level: 12,
            xp: 40,
            xp_next: 100,
            kind: "attack",
            shape: "target",
            damage: [320, 0, 0, 90, 0],
            dps: 612,
            crit_chance_bp: 700,
            crit_multi_bp: 15000,
            use_ticks: 8,
            mana_cost: 0,
            range_cu: 160,
            supports: [{ name: "Heavier Blows", level: 8, xp: 18, xp_next: 60 }],
          }),
          skill({
            name: "War Cry",
            level: 6,
            xp: 12,
            xp_next: 60,
            // Real War Cry is skill_kind: spell (content/gems/war_cry.ron) — so the
            // cooldown cadence renders with the representative "cast/s" label.
            kind: "spell",
            shape: "nova",
            mana_cost: 14,
            life_cost: 30, // a rally paid in blood — exercises the life-cost readout
            cooldown_ticks: 40,
            buff_duration_ticks: 80,
          }),
          skill({
            name: "Plague Cloud",
            level: 20,
            xp: 0,
            xp_next: 0, // at the level cap (20) → full gold bar
            kind: "spell",
            shape: "point_aoe",
            mana_cost: 22,
            radius_cu: 240,
            dot_per_sec: 48,
            dot_duration_ticks: 60,
          }),
          skill({
            name: "Arc",
            level: 5,
            xp: 30,
            xp_next: 90,
            kind: "spell",
            shape: "line",
            damage: [0, 0, 0, 160, 0],
            dps: 200,
            crit_chance_bp: 500,
            crit_multi_bp: 15000,
            use_ticks: 8,
            mana_cost: 12,
            range_cu: 600,
            width_cu: 130,
          }),
        ],
        currency: [
          { name: "Transmute Obol", count: 47, tier: 1 },
          { name: "Alchemy Obol", count: 12, tier: 2 },
          { name: "Exalted Obol", count: 1, tier: 3 },
        ],
        passive_allocated: 38,
        passive_unspent: 4,
        build_len: 42,
      }),
    ),
  ],
};

/**
 * The 3D scene: a grinder and a stalker on the generated Withered Shore terrain
 * at night, the director framing the grinder. Exercises terrain, the night rig,
 * braziers, fog, post-processing, and two animated rigged models — the whole
 * `ZoneRenderer` path under a seeded clock + RNG.
 */
const sceneShore: Fixture = {
  kind: "scene",
  label: "Scene: a grinder and a stalker on the Withered Shore at night, close 3/4 view",
  seed: 0x1d71c0de,
  frames: 40,
  // World coords: x = sim x, z = sim y, y = up. Grinder ~(30,22), stalker
  // ~(34,24); a near 3/4 view looking down the strand at them.
  camera: [31, 9, 36, 32.5, 1.2, 22.5],
  messages: [
    zoneSnapshot({
      zone_name: "The Withered Shore",
      entities: [
        character({
          id: 1,
          name: "Brakka",
          model: "idler",
          level: 42,
          life_pct: 90,
          weapon: "cleaver",
          weapon_rarity: 2,
          gear: ["ranger_body", "ranger_legs", "ranger_feet"],
          gear_rarity: [2, 1, 1],
          ...simXY(30, 22),
        }),
        monster({
          id: 2,
          name: "Bone Stalker",
          model: "stalker",
          level: 40,
          life_pct: 70,
          rarity: 2,
          ...simXY(34, 24),
        }),
      ],
    }),
    directorCue(1, "carving the strand"),
  ],
};

/**
 * Fog of war, idler view (#129): the camera is pinned to Vex, who WALKS the
 * strand (snapshot at x=20, moved samples to x=58), so the shot shows all three
 * fog tiers at once — the screen-wide sight disc around her, the dim explored
 * corridor she walked out of, and near-black everywhere else. Rin (a second
 * character) and a Tide Husk stand far outside her sight: both must be
 * swallowed by the dark. Same layout as `scene-fog-broadcast`, which drops the
 * `follow` pin — there the fog is the UNION of every character, so Rin is lit.
 *
 * The zone is LARGER than the default 60×40: sight is a whole follow-screen
 * (SIGHT_CELLS in FogOfWar.ts — the fog exists to stop route precomputation,
 * not to shrink the watched view), so a small zone would be fully explored by
 * one walk and the tiers would not separate on screen.
 */
const FOG_DIMS = simXY(110, 70);
const fogLayout = (): S2C[] => [
  zoneSnapshot({
    zone_name: "The Withered Shore",
    width: FOG_DIMS.x,
    height: FOG_DIMS.y,
    entities: [
      character({
        id: 1,
        name: "Vex",
        model: "idler",
        level: 12,
        weapon: "cleaver",
        ...simXY(20, 35),
      }),
      // Both parked > r+soft from every point of Vex's walk, so they stay in
      // the never-explored dark even at the screen-wide sight radius.
      character({ id: 2, name: "Rin", model: "idler", level: 9, ...simXY(84, 8) }),
      monster({ id: 3, name: "Tide Husk", model: "husk", level: 3, ...simXY(82, 58) }),
    ],
  }),
  // Vex walks east; the playout buffer interpolates the samples, so the fog
  // stamps a continuous corridor as she goes — long enough that its west end
  // falls OUT of her sight radius and drops to the memory tier.
  zoneDelta(4, { moved: [{ id: 1, ...simXY(40, 35) }] }),
  zoneDelta(8, { moved: [{ id: 1, ...simXY(58, 35) }] }),
];

const sceneFogIdler: Fixture = {
  kind: "scene",
  label: "Fog of war, idler MAP view (#129): sight disc + walked memory trail; Rin and the husk swallowed",
  seed: 0x1d71c0de,
  frames: 90, // 1.5 virtual seconds — the walk completes and the trail settles
  follow: "Vex",
  // High 3/4 over the strand: the lit disc, the memory corridor west of it,
  // and the dark where Rin/the husk stand are all in frame.
  camera: [45, 45, 70, 45, 0, 30],
  messages: fogLayout(),
};

const sceneFogFollow: Fixture = {
  kind: "scene",
  label:
    "Fog of war, LIVE follow framing (#129): sight fills the screen — the watched view feels unrestricted",
  seed: 0x1d71c0de,
  frames: 90,
  follow: "Vex",
  // The DirectorCamera's follow shot, hand-pinned: Vex's final position
  // (58,35) + FOLLOW_OFFSET (14,16,14) at zoom 1. SIGHT_CELLS is sized to THIS
  // framing, so the whole screen reads lit and the dark starts off-screen.
  camera: [72, 16, 49, 58, 1, 35],
  messages: fogLayout(),
};

const sceneFogBroadcast: Fixture = {
  kind: "scene",
  label: "Fog of war, broadcast (#129): union reveal — Rin lit too; the husk still in the dark",
  seed: 0x1d71c0de,
  frames: 90,
  camera: [45, 45, 70, 45, 0, 30],
  messages: fogLayout(),
};

/**
 * Overhead bars (#100): three entities at controlled pools so the fix + the new
 * shield band are both visible. The red life fill must sit EXACTLY on its dark
 * track at any pool level (the old two-sprite bar slid the fill off diagonally),
 * and an entity with energy shield shows a cyan band above the life bar.
 */
const sceneAilments: Fixture = {
  kind: "scene",
  label: "Ailment pips: ignite/shock/chill indicators on the overhead bar (#88)",
  seed: 0x1d71c0de,
  frames: 40,
  // Monsters only — no reveal source, so fog of war would bury the pips (#129).
  fog: false,
  camera: [34, 8, 32, 34, 1.5, 22.5],
  messages: [
    zoneSnapshot({
      zone_name: "The Withered Shore",
      entities: [
        // One pip each (ignite / shock / chill), then all three.
        monster({ id: 1, name: "Ignited", model: "stalker", level: 40, life_pct: 70, ailments: 1, ...simXY(31, 22.5) }),
        monster({ id: 2, name: "Shocked", model: "husk", level: 40, life_pct: 70, ailments: 2, ...simXY(34, 22) }),
        monster({ id: 3, name: "Chilled", model: "shambler", level: 40, life_pct: 70, ailments: 4, ...simXY(37, 22.5) }),
        monster({ id: 4, name: "Afflicted", model: "stalker", level: 40, life_pct: 70, ailments: 7, rarity: 2, ...simXY(40, 22) }),
      ],
    }),
  ],
};

const sceneBars: Fixture = {
  kind: "scene",
  label: "Overhead bars: aligned life fill + energy-shield band (#100)",
  seed: 0x1d71c0de,
  frames: 40,
  camera: [34, 8, 32, 34, 1.5, 22.5],
  messages: [
    zoneSnapshot({
      zone_name: "The Withered Shore",
      entities: [
        // Half life, no shield: the red fill must align on the dark track.
        character({
          id: 1,
          name: "Halfling",
          model: "idler",
          level: 40,
          life_pct: 50,
          ...simXY(31, 22.5),
        }),
        // Life + a partial shield: a cyan band rides above the red life bar.
        character({
          id: 2,
          name: "Warded",
          model: "idler",
          level: 40,
          life_pct: 80,
          es_pct: 60,
          ...simXY(34, 22),
        }),
        // A low-life monster: a small red fill, still left-anchored.
        monster({
          id: 3,
          name: "Bone Stalker",
          model: "stalker",
          level: 40,
          life_pct: 25,
          rarity: 2,
          ...simXY(37, 22.5),
        }),
      ],
    }),
  ],
};

/**
 * A heavily-socketed idler: nine skills, far more than the skills panel's
 * height budget. Exercises the auto-scroll box — the panel must pin to its
 * viewport ratio and clip, not stretch the column off-screen.
 */
const skillOverflow: Fixture = {
  kind: "overlay",
  label: "Skills overflow: an 8-skill idler — the panel pins to its ratio and auto-scrolls",
  status: LIVE_STATUS,
  messages: [
    zoneSnapshot({
      entities: [character({ id: 1, name: "Vorin", level: 88, model: "marauder", life_pct: 95 })],
    }),
    directorCue(1, "spinning the wheel"),
    characterSheet(
      sheet({
        id: 1,
        name: "Vorin",
        level: 88,
        life: 2400,
        life_max: 2400,
        mana: 380,
        mana_max: 380,
        skills: [
          skill({ name: "Cleave", kind: "attack", shape: "cone", level: 20, damage: [540, 0, 0, 0, 0], dps: 880, crit_chance_bp: 600, use_ticks: 7, radius_cu: 220 }),
          skill({ name: "Heavy Swing", kind: "attack", shape: "target", level: 18, xp: 70, xp_next: 140, damage: [710, 0, 0, 0, 0], dps: 1010, crit_chance_bp: 800, use_ticks: 9, range_cu: 160, supports: [{ name: "Heavier Blows", level: 12, xp: 40, xp_next: 80 }] }),
          skill({ name: "Arc", kind: "spell", shape: "line", level: 16, damage: [0, 0, 0, 300, 0], dps: 540, crit_chance_bp: 500, use_ticks: 8, range_cu: 600, width_cu: 130 }),
          skill({ name: "Ember Bolt", kind: "spell", shape: "projectile", level: 15, damage: [0, 420, 0, 0, 0], dps: 600, crit_chance_bp: 500, use_ticks: 8, range_cu: 900, projectiles: 3, pierce: 1 }),
          skill({ name: "War Cry", kind: "spell", shape: "nova", level: 10, mana_cost: 30, cooldown_ticks: 80, buff_duration_ticks: 120 }),
          skill({ name: "Plague Cloud", kind: "spell", shape: "point_aoe", level: 14, mana_cost: 28, radius_cu: 260, dot_per_sec: 95, dot_duration_ticks: 80 }),
          skill({ name: "Frost Nova", kind: "spell", shape: "nova", level: 12, damage: [0, 0, 180, 0, 0], dps: 220, mana_cost: 22, radius_cu: 200, debuff_duration_ticks: 30 }),
          skill({ name: "Power Shot", kind: "attack", shape: "projectile", level: 13, damage: [480, 0, 0, 0, 0], dps: 700, use_ticks: 10, range_cu: 800, projectiles: 1, pierce: 1 }),
        ],
        currency: [{ name: "Transmute Obol", count: 312, tier: 1 }],
        passive_allocated: 80,
        build_len: 88,
      }),
    ),
  ],
};

/** Every fixture, keyed by the id used in `?fixture=<name>` and the shot path. */
const GLOBE_ID = 7;
/**
 * The HUD life/mana globes (#89) at an extreme the near-full inspect-panel
 * fixture can't show: a focused idler at ~14% life with an energy-shield buffer
 * and fully drained mana — so the low-life, ES-overlay, and empty-pool fills all
 * get a deterministic shot.
 */
const globes: Fixture = {
  kind: "overlay",
  label: "Life/mana globes — low life + energy shield + empty mana on the focused idler",
  status: LIVE_STATUS,
  messages: [
    zoneSnapshot({
      entities: [
        character({
          id: GLOBE_ID,
          name: "Vesh",
          level: 28,
          model: "ranger",
          life_pct: 14,
          kills: 96,
          items: 3,
        }),
      ],
    }),
    directorCue(GLOBE_ID, "bleeding out"),
    characterSheet(
      sheet({
        id: GLOBE_ID,
        name: "Vesh",
        level: 28,
        life: 168,
        life_max: 1180,
        es: 90,
        es_max: 240,
        mana: 0,
        mana_max: 200,
        life_reserved: 354, // ~30% reserved → gravel band at the top
        mana_reserved: 80, // ~40% of the mana pool reserved
      }),
    ),
  ],
};

/**
 * The whole game view: the Withered Shore scene (reusing scene-shore's world +
 * camera) with Brakka's HUD mounted over it — orbs, equipment doll, the
 * bag/obols cycle, stats, skills — so the orbs are seen in their real in-game
 * context. The sheet's id/name match the focused idler (id 1, Brakka); pools at
 * ~60/70% so the orbs read as partially filled.
 */
const fullShore: Fixture = {
  kind: "full",
  label: "Whole game view: Brakka's HUD (orbs + panels) over the Withered Shore scene",
  status: LIVE_STATUS,
  seed: 0x1d71c0de,
  frames: 40,
  camera: [31, 9, 36, 32.5, 1.2, 22.5],
  messages: [
    ...sceneShore.messages,
    focusQueue(["Kargan", NAME, "Veles", "Mirra", "Thane", "Doral", "Sable"], 1),
    // A burst of real-content events so the bottom-left ticker is populated —
    // the whole game view includes the running event log, not just the panels.
    {
      type: "Events",
      data: {
        events: [
          { type: "MonsterKilled", data: { killer_id: FOCUS_ID, killer: NAME, monster: "Bone Stalker", level: 40 , rarity: 0 } },
          { type: "MonsterKilled", data: { killer_id: FOCUS_ID, killer: NAME, monster: "The Riptide Sovereign", level: 21, rarity: 3 } },
          { type: "VoyageTally", data: { id: FOCUS_ID, name: NAME, kills: 34n, deaths: 1n, items: 12n, ticks: 4000n } },
          { type: "LootDropped", data: { owner_id: FOCUS_ID, owner: NAME, rarity: 2, item: "Coral Band" } },
          { type: "ItemPickedUp", data: { owner_id: FOCUS_ID, owner: NAME, rarity: 2, item: "Coral Band" } },
          { type: "MonsterKilled", data: { killer_id: 3, killer: "Mirra", monster: "Drowned Shambler", level: 39 , rarity: 0 } },
          { type: "LevelUp", data: { id: 4, name: "Veles", level: 41 } },
          { type: "GemSocketed", data: { id: FOCUS_ID, owner: NAME, gem: "Cleave" } },
          { type: "CurrencyUsed", data: { id: FOCUS_ID, owner: NAME, currency: "Alchemy Obol", item: "Kelp-Woven Vest" } },
          { type: "MonsterKilled", data: { killer_id: FOCUS_ID, killer: NAME, monster: "Tide Husk", level: 40 , rarity: 0 } },
          // The campaign's biggest beat (#136) — the gold act-completion line.
          { type: "ActCompleted", data: { id: FOCUS_ID, name: NAME, act: 1 } },
        ],
      },
    },
    characterSheet(
      sheet({
        id: FOCUS_ID,
        name: NAME,
        level: 42,
        xp: 1240,
        xp_next: 4096,
        life: 920,
        life_max: 1530,
        mana: 168,
        mana_max: 240,
        es: 180,
        es_max: 300,
        life_reserved: 306, // ~20% reserved (aura) → gravel at the top
        mana_reserved: 60, // ~25% of mana reserved
        kills: 318,
        dmg_phys: 412,
        dmg_lightning: 88,
        accuracy: 1320,
        evasion: 540,
        armour: 2200,
        resist_fire_bp: 3600,
        resist_cold_bp: 2900,
        resist_lightning_bp: 1200,
        resist_chaos_bp: -600,
        item_rarity_bp: 4200,
        item_quantity_bp: 800,
        // #87 per-stat source breakdown (shown on hover over a stats row).
        stat_sources: [
          { stat: "armour", source: "Brinescoured Helm", layer: 0, value: 800 },
          { stat: "armour", source: "Kelp-Woven Vest", layer: 0, value: 1400 },
          { stat: "accuracy", source: "Rusted Cleaver", layer: 0, value: 120 },
          { stat: "accuracy", source: "Eagle Eye", layer: 1, value: 2500 },
          { stat: "evasion", source: "Wader's Boots", layer: 0, value: 90 },
          { stat: "damage_phys", source: "Rusted Cleaver", layer: 0, value: 40 },
          { stat: "damage_phys", source: "Berserking", layer: 1, value: 3000 },
          { stat: "resist_fire", source: "Brinescoured Helm", layer: 0, value: 1500 },
          { stat: "item_rarity", source: "Greedy Grips", layer: 1, value: 4200 },
        ],
        equipment: [
          gear("Weapon", "Rusted Cleaver", 2),
          gear("Offhand", "Rusted Cleaver", 2, true),
          gear("Helm", "Brinescoured Helm", 1),
          gear("Chest", "Kelp-Woven Vest", 0),
          gear("Boots", "Wader's Boots", 1),
          gear("Flask", "Small Life Flask", 0),
          gear("Flask 2", "", 0),
          gear("Ring", "Coral Band", 1),
          gear("Ring 2", "Coral Band", 2),
          gear("Belt", "Corded Belt", 1),
          gear("Amulet", "Tidal Charm", 2),
          gear("Gloves", "Kelp Grips", 1),
        ],
        inventory: [
          invItem("Small Mana Flask", 0, 0, 0, 1, 2),
          invItem("Frost Nova", 0, 2, 0, 1, 1),
          invItem("Coral Band", 1, 4, 1, 1, 1),
        ],
        currency: [
          { name: "Transmute Obol", count: 47, tier: 1 },
          { name: "Alchemy Obol", count: 12, tier: 2 },
          { name: "Exalted Obol", count: 1, tier: 3 },
        ],
        skills: [
          skill({
            name: "Heavy Swing",
            level: 12,
            xp: 40,
            xp_next: 100,
            kind: "attack",
            shape: "target",
            damage: [320, 0, 0, 90, 0],
            dps: 612,
            crit_chance_bp: 700,
            crit_multi_bp: 15000,
            use_ticks: 8,
            mana_cost: 0,
            range_cu: 160,
          }),
          skill({
            name: "Arc",
            level: 5,
            xp: 30,
            xp_next: 90,
            kind: "spell",
            shape: "line",
            damage: [0, 0, 0, 160, 0],
            dps: 200,
            crit_chance_bp: 500,
            crit_multi_bp: 15000,
            use_ticks: 8,
            mana_cost: 12,
            range_cu: 600,
            width_cu: 130,
          }),
        ],
        passive_allocated: 38,
        passive_unspent: 4,
        build_len: 42,
      }),
    ),
  ],
};

// Variant whole-game scenes: the SAME Brakka loadout as full-shore, only the
// pools differ — so the orbs can be reviewed across life/ES/mana/reserved states
// in real in-game context. (full-shore = mid pools.)
const fullSheetMsg = fullShore.messages[fullShore.messages.length - 1] as Extract<
  S2C,
  { type: "CharacterSheet" }
>;
const fullVariant = (label: string, pools: Partial<CharacterSheet>): Fixture => ({
  ...fullShore,
  label,
  messages: [
    ...fullShore.messages.slice(0, -1),
    { type: "CharacterSheet", data: { sheet: { ...fullSheetMsg.data.sheet, ...pools } } },
  ],
});
// Low life, full energy shield, heavy reservation — every band at an extreme.
const fullBloodied = fullVariant("Whole game view: low life, full ES, heavy reservation", {
  life: 214,
  mana: 36,
  es: 300,
  es_max: 300,
  life_reserved: 612,
  mana_reserved: 96,
});
// Full pools, no energy shield, no reservation — the ES ring and the ES/Reserved
// readout lines all drop out (proves the zero-cases).
const fullFresh = fullVariant("Whole game view: full pools, no ES, no reservation", {
  life: 1530,
  mana: 240,
  es: 0,
  es_max: 0,
  life_reserved: 0,
  mana_reserved: 0,
});

// Edge cases: a lone idler (no focus queue) must show as the CURRENT carousel item
// (bold), not a dim neighbour; and an overkilled pool (sim sends negative life)
// must read 0 on the orb, never a negative number.
const EDGE_ID = 9;
// The speaker button (#148 A8): the one UI surface sound adds — shot in
// its muted default (the fresh-engine state every viewer starts in).
const soundToggle: Fixture = {
  kind: "overlay",
  sound: true,
  label: "Sound: the speaker button renders muted by default",
  status: LIVE_STATUS,
  messages: [
    zoneSnapshot({
      entities: [
        character({ id: EDGE_ID, name: "Solo", level: 30, model: "ranger", life_pct: 80, kills: 12, items: 2 }),
      ],
    }),
  ],
};

const hudEdge: Fixture = {
  kind: "overlay",
  label: "Edge: a lone idler + an overkilled (negative) life pool that clamps to 0",
  status: LIVE_STATUS,
  messages: [
    zoneSnapshot({
      entities: [
        character({ id: EDGE_ID, name: "Solo", level: 30, model: "ranger", life_pct: 0, kills: 12, items: 2 }),
      ],
    }),
    directorCue(EDGE_ID, "last stand"),
    characterSheet(
      sheet({ id: EDGE_ID, name: "Solo", level: 30, life: -25, life_max: 1180, mana: 30, mana_max: 200 }),
    ),
  ],
};

// The INDIVIDUAL idler view (#79): the same world + HUD as full-shore, but the
// overlay is in individual mode for Brakka — focus pinned by name, the "your
// idler" banner shown, the director rotation carousel dropped. The page shell the
// management portal (bot editor, debug console) will extend.
// The events burst from full-shore, reused so the individual view's ticker is
// populated in the shot.
const eventsBurst = fullShore.messages.find((m) => m.type === "Events")!;

// Individual idler view (#79): focus is pinned to the REQUESTED idler (Brakka) BY
// NAME — explicitly NOT the director cue, which here points at a DIFFERENT idler
// (Veles). So a regression to cue-based focus would frame Veles and fail the
// focus-pinning assertion (capture.spec) — the fixture is non-vacuous.
//
// An OVERLAY fixture (no 3D scene): this proves the individual-mode HUD (banner,
// focus-by-name, no carousel) deterministically. The scene under it is covered by
// scene-shore / full-shore; subjecting the watch view's WebGL body to the
// byte-stable check buys nothing but the known same-machine flake.
const idlerView: Fixture = {
  kind: "overlay",
  label: "Individual idler view (#79): focus pinned to Brakka by name, not the director cue (Veles)",
  status: LIVE_STATUS,
  idler: NAME,
  messages: [
    zoneSnapshot({
      zone_name: "The Withered Shore",
      entities: [
        character({
          id: FOCUS_ID,
          name: NAME,
          model: "idler",
          level: 42,
          life_pct: 90,
          weapon: "cleaver",
          weapon_rarity: 2,
          gear: ["ranger_body", "ranger_legs", "ranger_feet"],
          gear_rarity: [2, 1, 1],
        }),
        character({ id: 2, name: "Veles", model: "idler", level: 41, life_pct: 80 }),
      ],
    }),
    directorCue(2, "carving the strand"), // the broadcast would frame VELES (id 2)
    eventsBurst,
    fullSheetMsg, // Brakka's sheet (id 1) — the inspect must pin to Brakka
  ],
};

// The per-idler MANAGEMENT page (#79 → #17): Brakka's management surface, fed by
// the same stream. For now it shows the live event ticker — reuse full-shore's
// event burst so the stream is populated.
const idlerManage: Fixture = {
  kind: "manage",
  label: "Individual idler management page (#79): Brakka's event stream",
  status: LIVE_STATUS,
  idler: NAME,
  messages: fullShore.messages,
};

// Individual view for an ABSENT idler (#79): the page is "Ghost"'s, but Ghost is
// not in the streamed world, while the director cue points at a PRESENT idler
// (Brakka). Individual mode must show NO focus panel — never the cue's pick
// mislabelled "your idler". Mutation: restore the `?? store.cue?.focus` fallback
// → Brakka's focus panel appears → the focus assertion (capture.spec) fails.
const idlerAbsent: Fixture = {
  kind: "overlay",
  label: "Individual view, idler absent (#79): no focus panel, never the director's pick",
  status: LIVE_STATUS,
  idler: "Ghost",
  messages: [
    zoneSnapshot({
      entities: [character({ id: FOCUS_ID, name: NAME, model: "idler", level: 42, life_pct: 90 })],
    }),
    directorCue(FOCUS_ID, "carving the strand"), // the director focuses Brakka
  ],
};

/**
 * The PoE-style item tooltip (#87): a rare amulet with two prefixes and two
 * suffixes, each showing its rolled value and the tier's range. Self-contained
 * docs (no fetch) so the shot is byte-stable. This is the §6 reference for the
 * mod-surfacing feature.
 */
const itemTooltip: Fixture = {
  kind: "tooltip",
  label: "Item tooltip — rare amulet",
  item: {
    name: "Vortex Scarab",
    rarity: 2,
    base_num: 2001,
    item_level: 84,
    mods: [
      { num: 1001, tier: 0, values: [24] },
      { num: 1002, tier: 0, values: [83] },
      { num: 1003, tier: 0, values: [3800] },
      { num: 1004, tier: 0, values: [3600] },
    ],
  },
  docsJson: {
    stats: [
      { key: "damage_phys", name: "Physical Damage", desc: "", added_unit: "flat" },
      { key: "life", name: "Life", desc: "", added_unit: "flat" },
      { key: "crit_multi", name: "Critical Strike Multiplier", desc: "", added_unit: "basis_points" },
      { key: "crit_chance", name: "Critical Strike Chance", desc: "", added_unit: "basis_points" },
    ],
    categories: {
      item: [{ num: 2001, name: "Onyx Amulet", req_level: 60 }],
      affix: [
        {
          num: 1001,
          name: "Flaring",
          kind: "prefix",
          effects: [{ stat: "damage_phys", layer: "added", condition: null }],
          tiers: [{ ilvl: 80, name: "Flaring", rolls: [{ min: 22, max: 26 }], weight: 100 }],
          description: "+# Physical Damage",
        },
        {
          num: 1002,
          name: "Athlete's",
          kind: "prefix",
          effects: [{ stat: "life", layer: "added", condition: null }],
          tiers: [{ ilvl: 80, name: "Athlete's", rolls: [{ min: 80, max: 89 }], weight: 100 }],
          description: "+# Life",
        },
        {
          num: 1003,
          name: "of Destruction",
          kind: "suffix",
          effects: [{ stat: "crit_multi", layer: "added", condition: null }],
          tiers: [{ ilvl: 80, name: "of Destruction", rolls: [{ min: 3500, max: 3800 }], weight: 100 }],
          description: "+#% Critical Strike Multiplier",
        },
        {
          num: 1004,
          name: "of Incision",
          kind: "suffix",
          effects: [{ stat: "crit_chance", layer: "increased", condition: null }],
          tiers: [{ ilvl: 80, name: "of Incision", rolls: [{ min: 3500, max: 3800 }], weight: 100 }],
          description: "#% increased Critical Strike Chance",
        },
      ],
    },
  },
};

/**
 * Boss quality (#136 T2): the Tidewarden at 1.6x unique scale, the top-center
 * boss bar, AND the first-sighted splash — visible deterministically because
 * fixture.tsx pins `performance.now` to a constant IN THE PAGE before any
 * message is applied, so the splash's 4s window can never age out in a shot.
 * Eyeball: the colossus reads as a boss next to the idler; the gold name
 * splash sits center-high; the bar tracks 70%.
 */
const fullBoss: Fixture = {
  kind: "full",
  label: "Boss quality (#136 T2): Tidewarden scale + boss bar + first-sighted splash",
  status: LIVE_STATUS,
  seed: 0x1d71c0de,
  frames: 40,
  camera: [31, 9, 36, 32.5, 1.6, 22.5],
  messages: [
    zoneSnapshot({
      zone_name: "The Withered Shore",
      entities: [
        character({
          id: 1,
          name: "Brakka",
          model: "idler",
          level: 12,
          weapon: "cleaver",
          ...simXY(30, 22),
        }),
        monster({
          id: 2,
          name: "The Tidewarden",
          model: "tidewarden",
          level: 8,
          life_pct: 70,
          rarity: 3,
          ...simXY(34, 23),
        }),
      ],
    }),
    directorCue(1, "the final exam"),
  ],
};

/**
 * Campaign UI (#136 T7): the zone title card (fires on the fixture's own
 * snapshot cut — frozen clock keeps it up), the act-done chip with the
 * chart count on the focus panel, and a Salt-Stained Chart in the bag.
 * Eyeball: "THE CHARTED SHALLOWS" center-high; the green "act 1 done ·
 * 1 chart" chip beside the level line.
 */
const fullCampaign: Fixture = {
  kind: "full",
  label: "Campaign UI (#136 T7): zone title card + act chip + chart in bag",
  status: LIVE_STATUS,
  seed: 0x7c1d5,
  frames: 40,
  camera: [25, 9, 30, 26.5, 1.6, 16.5],
  messages: [
    // The title card marks a CUT — so the fixture cuts: town first, then
    // the voyage (the initial ""→world load deliberately never splashes).
    zoneSnapshot({
      zone_name: "Saltmere",
      world_key: "saltmere",
      entities: [],
    }),
    zoneSnapshot({
      zone_name: "The Charted Shallows",
      world_key: "charted_shallows#Brakka@41",
      entities: [
        character({
          id: 1,
          name: "Brakka",
          model: "idler",
          level: 16,
          weapon: "cleaver",
          ...simXY(24, 18),
        }),
        monster({
          id: 2,
          name: "Deep Chanter",
          model: "husk",
          level: 13,
          life_pct: 100,
          rarity: 1,
          ...simXY(28, 15),
        }),
      ],
    }),
    {
      type: "CharacterSheet",
      data: {
        sheet: sheet({
          id: 1,
          name: "Brakka",
          level: 16,
          story_acts: 3,
          inventory: [
            {
              name: "Seething Salt-Stained Chart of Bounty",
              rarity: 1,
              x: 0,
              y: 0,
              w: 2,
              h: 2,
              base_num: 16777229,
              item_level: 13,
              mods: [],
            },
          ],
        }),
      },
    } as S2C,
    directorCue(1, "the charted waters"),
  ],
};

export const FIXTURES: Record<string, Fixture> = {
  "inspect-panel": inspectPanel,
  "hud-edge": hudEdge,
  "sound-toggle": soundToggle,
  "item-tooltip": itemTooltip,
  "scene-shore": sceneShore,
  "scene-bars": sceneBars,
  "scene-ailments": sceneAilments,
  "scene-fog-idler": sceneFogIdler,
  "scene-fog-follow": sceneFogFollow,
  "scene-fog-broadcast": sceneFogBroadcast,
  "skill-overflow": skillOverflow,
  globes,
  "full-shore": fullShore,
  "full-boss": fullBoss,
  "full-campaign": fullCampaign,
  "full-bloodied": fullBloodied,
  "full-fresh": fullFresh,
  "idler-view": idlerView,
  "idler-manage": idlerManage,
  "idler-absent": idlerAbsent,
};
