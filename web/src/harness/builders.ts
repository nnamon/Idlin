// Typed builders for canned fixture state. Authoring fixtures THROUGH these
// (rather than raw JSON) means the TypeScript compiler validates every fixture
// against the generated wire types — a protocol change that drops or renames a
// field breaks the fixture loudly at typecheck, which is exactly the drift we
// want to catch.
import type { S2C } from "../gen/S2C";
import type { EntityState } from "../gen/EntityState";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { GearSlotView } from "../gen/GearSlotView";

/** Q16.16 fixed-point scale — wire coordinates are raw fixed-point ints. */
const FX = 65536;

type Require<T, K extends keyof T> = Partial<T> & Pick<T, K>;

/** A focusable character entity, with sensible defaults for everything the
 *  overlay does not exercise. */
export function character(over: Require<EntityState, "id" | "name">): EntityState {
  return {
    kind: "Character",
    x: 0,
    y: 0,
    life_pct: 100,
    level: 1,
    model: "marauder",
    rarity: 0,
    weapon: "",
    weapon_rarity: 0,
    gear: [],
    gear_rarity: [],
    dead: false,
    kills: 0,
    items: 0,
    ...over,
  };
}

/** One equipment slot. `dimmed` greys a two-handed weapon mirrored into the
 *  offhand cell (the panel renders it at 0.4 opacity). */
export function gear(slot: string, name: string, rarity = 0, dimmed = false): GearSlotView {
  return { slot, name, rarity, dimmed };
}

/** A character sheet with zeroed defaults; pass only what the fixture shows. */
export function sheet(over: Require<CharacterSheet, "id" | "name">): CharacterSheet {
  return {
    level: 1,
    xp: 0,
    xp_next: 100,
    life: 100,
    life_max: 100,
    mana: 50,
    mana_max: 50,
    es: 0,
    es_max: 0,
    block_bp: 0,
    kills: 0,
    dmg_phys: 0,
    dmg_fire: 0,
    dmg_cold: 0,
    dmg_lightning: 0,
    dmg_chaos: 0,
    accuracy: 0,
    evasion: 0,
    armour: 0,
    resist_fire_bp: 0,
    resist_cold_bp: 0,
    resist_lightning_bp: 0,
    resist_chaos_bp: 0,
    item_rarity_bp: 0,
    item_quantity_bp: 0,
    equipment: [],
    inventory: [],
    gems: [],
    currency: [],
    passive_allocated: 0,
    passive_unspent: 0,
    build_len: 0,
    ...over,
  };
}

/** `ZoneSnapshot` S2C — the world frame the focus panel reads `zone` + the
 *  focused entity from. */
export function zoneSnapshot(
  over: Partial<Extract<S2C, { type: "ZoneSnapshot" }>["data"]> = {},
): S2C {
  return {
    type: "ZoneSnapshot",
    data: {
      tick: 0,
      zone_name: "The Withered Shore",
      zone_level: 5,
      world_key: "withered_shore",
      width: 60 * FX,
      height: 40 * FX,
      tiles: null,
      exits: [],
      gates: [],
      entities: [],
      ...over,
    },
  };
}

/** `DirectorCue` S2C — names the focused entity id and the rotation reason. */
export function directorCue(focus: number, reason: string, holdTicks = 80): S2C {
  return { type: "DirectorCue", data: { focus, reason, hold_ticks: holdTicks } };
}

/** `CharacterSheet` S2C — populates the stats + gear + bag panels. */
export function characterSheet(s: CharacterSheet): S2C {
  return { type: "CharacterSheet", data: { sheet: s } };
}
