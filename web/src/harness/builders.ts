// Typed builders for canned fixture state. Authoring fixtures THROUGH these
// (rather than raw JSON) means the TypeScript compiler validates every fixture
// against the generated wire types — a protocol change that drops or renames a
// field breaks the fixture loudly at typecheck, which is exactly the drift we
// want to catch.
import type { S2C } from "../gen/S2C";
import type { EntityState } from "../gen/EntityState";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { GearSlotView } from "../gen/GearSlotView";
import type { InvItemView } from "../gen/InvItemView";
import type { SkillStat } from "../gen/SkillStat";

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
    es_pct: -1, // no shield by default; a fixture sets 0..100 to show the band
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
    ailments: 0, // #88: a fixture sets a bitmask (1 ignite|2 shock|4 chill) for pips
    ...over,
  };
}

/** A monster entity (for scene fixtures). `model` must be a manifest monster
 *  key (shambler/husk/stalker/tidewarden/idler). */
export function monster(over: Require<EntityState, "id" | "name" | "model">): EntityState {
  return character({ ...over, kind: "Monster" });
}

/** One equipment slot. `dimmed` greys a two-handed weapon mirrored into the
 *  offhand cell (the panel renders it at 0.4 opacity). `mods` (rolled affixes)
 *  feed the hover tooltip; pass them via the 5th arg when a fixture needs them. */
export function gear(
  slot: string,
  name: string,
  rarity = 0,
  dimmed = false,
  extra: Partial<GearSlotView> = {},
): GearSlotView {
  return { slot, name, rarity, dimmed, base_num: -1, item_level: 0, mods: [], ...extra };
}

/** One bag item (grid placement + footprint). Pass `extra` for tooltip data
 *  (base_num / item_level / rolled mods). */
export function invItem(
  name: string,
  rarity: number,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<InvItemView> = {},
): InvItemView {
  return { name, rarity, x, y, w, h, base_num: -1, item_level: 0, mods: [], ...extra };
}

/** Convert sim units to the Q16.16 raw ints the wire uses for positions. */
export function simXY(x: number, y: number): { x: number; y: number } {
  return { x: Math.round(x * FX), y: Math.round(y * FX) };
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
    life_reserved: 0,
    mana_reserved: 0,
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
    skills: [],
    currency: [],
    passive_allocated: 0,
    passive_unspent: 0,
    build_len: 0,
    stat_sources: [],
    ...over,
  };
}

/** A per-skill stat readout with zeroed defaults; pass only the pertinent
 *  numbers (dps for a damage skill, dot/buff/debuff for the rest). */
export function skill(over: Require<SkillStat, "name">): SkillStat {
  return {
    level: 1,
    xp: 0,
    xp_next: 100,
    kind: "attack",
    shape: "target",
    damage: [0, 0, 0, 0, 0],
    dps: 0,
    crit_chance_bp: 0,
    crit_multi_bp: 15000,
    use_ticks: 10,
    cooldown_ticks: 0,
    mana_cost: 0,
    life_cost: 0,
    range_cu: 0,
    radius_cu: 0,
    width_cu: 0,
    projectiles: 0,
    pierce: 0,
    dot_per_sec: 0,
    dot_duration_ticks: 0,
    buff_duration_ticks: 0,
    debuff_duration_ticks: 0,
    supports: [],
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

/** `ZoneDelta` S2C — the per-tick stream. A fixture animates an entity by
 *  streaming `moved` samples the playout buffer then interpolates (the fog
 *  fixture walks its idler to leave an explored trail, #129). */
export function zoneDelta(
  tick: number,
  over: Partial<Extract<S2C, { type: "ZoneDelta" }>["data"]> = {},
): S2C {
  return {
    type: "ZoneDelta",
    data: {
      tick,
      spawned: [],
      moved: [],
      updated: [],
      removed: [],
      hits: [],
      projectiles: [],
      skills: [],
      uses: [],
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
