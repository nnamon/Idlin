import type { S2C } from "../gen/S2C";
import type { NetStatus } from "../net/client";
import { LIVE_STATUS } from "./stubClient";
import {
  character,
  characterSheet,
  directorCue,
  gear,
  monster,
  sheet,
  simXY,
  skill,
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
      label: string;
      /** Link status the stub client reports (drives the plaque). */
      status: NetStatus;
      /** Messages applied via `store.handle()` before the first render. */
      messages: S2C[];
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
      messages: S2C[];
    };

const FOCUS_ID = 1;
const NAME = "Brakka";

/**
 * The focus/inspect panel, fully populated: a level-42 marauder carrying a
 * two-handed weapon — which mirrors into the offhand cell, greyed — plus a
 * bag, gems, currency, and the full stat block. This is the §6 reference
 * scene ("the offhand at 0.4 opacity").
 */
const inspectPanel: Fixture = {
  kind: "overlay",
  label:
    "Focus panel: full inspect sheet for a lv42 marauder with a two-handed weapon (offhand mirrored, dimmed) + accessories (2 rings, belt, amulet)",
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
        equipment: [
          gear("Weapon", "Rusted Cleaver", 2),
          gear("Offhand", "Rusted Cleaver", 2, true), // 2H mirror — dimmed
          gear("Helm", "Iron Helm", 1),
          gear("Chest", "Plate Vest", 0),
          gear("Boots", "Leather Waders", 1),
          gear("Flask", "Crimson Flask", 0),
          gear("Flask 2", "", 0), // empty second flask loop
          gear("Ring", "Coral Band", 1),
          gear("Ring 2", "Coral Band", 2),
          gear("Belt", "Corded Belt", 1),
          gear("Amulet", "Tidal Charm", 2),
        ],
        inventory: [
          { name: "Quicksilver Flask", rarity: 0, x: 0, y: 0, w: 1, h: 2 },
          { name: "Cobalt Gem", rarity: 0, x: 2, y: 0, w: 1, h: 1 },
          { name: "Iron Ring", rarity: 1, x: 4, y: 1, w: 1, h: 1 },
          { name: "Scroll Fragment", rarity: 0, x: 6, y: 0, w: 1, h: 1 },
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
            kind: "attack",
            shape: "nova",
            mana_cost: 14,
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
          { name: "Obol", count: 47, tier: 0 },
          { name: "Mirror Shard", count: 1, tier: 3 },
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
          name: "Tide Stalker",
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
 * A heavily-socketed idler: nine skills, far more than the skills panel's
 * height budget. Exercises the auto-scroll box — the panel must pin to its
 * viewport ratio and clip, not stretch the column off-screen.
 */
const skillOverflow: Fixture = {
  kind: "overlay",
  label: "Skills overflow: a 9-skill idler — the panel pins to its ratio and auto-scrolls",
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
          skill({ name: "Fireball", kind: "spell", shape: "projectile", level: 15, damage: [0, 420, 0, 0, 0], dps: 600, crit_chance_bp: 500, use_ticks: 8, range_cu: 900, projectiles: 3, pierce: 1 }),
          skill({ name: "War Cry", kind: "attack", shape: "nova", level: 10, mana_cost: 30, cooldown_ticks: 80, buff_duration_ticks: 120 }),
          skill({ name: "Plague Cloud", kind: "spell", shape: "point_aoe", level: 14, mana_cost: 28, radius_cu: 260, dot_per_sec: 95, dot_duration_ticks: 80 }),
          skill({ name: "Frost Nova", kind: "spell", shape: "nova", level: 12, damage: [0, 0, 180, 0, 0], dps: 220, mana_cost: 22, radius_cu: 200, debuff_duration_ticks: 30 }),
          skill({ name: "Ground Slam", kind: "attack", shape: "cone", level: 13, damage: [480, 0, 0, 0, 0], dps: 700, use_ticks: 10, radius_cu: 240 }),
          skill({ name: "Decoy", kind: "spell", shape: "point_aoe", level: 8, mana_cost: 18, cooldown_ticks: 120, buff_duration_ticks: 60 }),
        ],
        currency: [{ name: "Obol", count: 312, tier: 0 }],
        passive_allocated: 80,
        build_len: 88,
      }),
    ),
  ],
};

/** Every fixture, keyed by the id used in `?fixture=<name>` and the shot path. */
export const FIXTURES: Record<string, Fixture> = {
  "inspect-panel": inspectPanel,
  "scene-shore": sceneShore,
  "skill-overflow": skillOverflow,
};
