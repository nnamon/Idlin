import type { S2C } from "../gen/S2C";
import type { NetStatus } from "../net/client";
import { LIVE_STATUS } from "./stubClient";
import { character, characterSheet, directorCue, gear, sheet, zoneSnapshot } from "./builders";

/** A canned scene: a fixed link status plus a sequence of server messages
 *  replayed through a fresh `WorldStore` with nothing live behind it. */
export interface Fixture {
  /** One-line description, surfaced in the README and at sign-off. */
  label: string;
  /** Link status the stub client reports (drives the plaque). */
  status: NetStatus;
  /** Messages applied via `store.handle()` before the first render. */
  messages: S2C[];
}

const FOCUS_ID = 1;
const NAME = "Brakka";

/**
 * The focus/inspect panel, fully populated: a level-42 marauder carrying a
 * two-handed weapon — which mirrors into the offhand cell, greyed — plus a
 * bag, gems, currency, and the full stat block. This is the §6 reference
 * scene ("the offhand at 0.4 opacity").
 */
const inspectPanel: Fixture = {
  label:
    "Focus panel: full inspect sheet for a lv42 marauder with a two-handed weapon (offhand mirrored, dimmed)",
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

/** Every fixture, keyed by the id used in `?fixture=<name>` and the shot path. */
export const FIXTURES: Record<string, Fixture> = {
  "inspect-panel": inspectPanel,
};
