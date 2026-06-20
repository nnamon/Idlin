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
        equipment: [
          gear("Weapon", "Rusted Cleaver", 2),
          gear("Offhand", "Rusted Cleaver", 2, true), // 2H mirror — dimmed
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
            kind: "attack",
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
 * Overhead bars (#100): three entities at controlled pools so the fix + the new
 * shield band are both visible. The red life fill must sit EXACTLY on its dark
 * track at any pool level (the old two-sprite bar slid the fill off diagonally),
 * and an entity with energy shield shows a cyan band above the life bar.
 */
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
          skill({ name: "War Cry", kind: "attack", shape: "nova", level: 10, mana_cost: 30, cooldown_ticks: 80, buff_duration_ticks: 120 }),
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
          { type: "MonsterKilled", data: { killer_id: FOCUS_ID, killer: NAME, monster: "Bone Stalker", level: 40 } },
          { type: "LootDropped", data: { owner_id: FOCUS_ID, owner: NAME, rarity: 2, item: "Coral Band" } },
          { type: "ItemPickedUp", data: { owner_id: FOCUS_ID, owner: NAME, rarity: 2, item: "Coral Band" } },
          { type: "MonsterKilled", data: { killer_id: 3, killer: "Mirra", monster: "Drowned Shambler", level: 39 } },
          { type: "LevelUp", data: { id: 4, name: "Veles", level: 41 } },
          { type: "GemSocketed", data: { id: FOCUS_ID, owner: NAME, gem: "Cleave" } },
          { type: "CurrencyUsed", data: { id: FOCUS_ID, owner: NAME, currency: "Alchemy Obol", item: "Kelp-Woven Vest" } },
          { type: "MonsterKilled", data: { killer_id: FOCUS_ID, killer: NAME, monster: "Tide Husk", level: 40 } },
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

export const FIXTURES: Record<string, Fixture> = {
  "inspect-panel": inspectPanel,
  "hud-edge": hudEdge,
  "item-tooltip": itemTooltip,
  "scene-shore": sceneShore,
  "scene-bars": sceneBars,
  "skill-overflow": skillOverflow,
  globes,
  "full-shore": fullShore,
  "full-bloodied": fullBloodied,
  "full-fresh": fullFresh,
  "idler-view": idlerView,
  "idler-manage": idlerManage,
  "idler-absent": idlerAbsent,
};
