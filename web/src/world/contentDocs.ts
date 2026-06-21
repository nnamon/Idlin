// Loads the generated content reference (`/content-docs.json`, RFC #54) and turns
// it into the lookups the item tooltip needs (#87): an affix def by num, the stat
// vocabulary by key, and a base item def by num — plus the mod-line formatter that
// renders a rolled affix the PoE way ("+83(80-89) to maximum Life", "36(35-38)%
// increased Critical Strike Chance").
import type { RolledModView } from "../gen/RolledModView";

export interface StatDoc {
  key: string;
  name: string;
  desc: string;
  added_unit: "flat" | "basis_points" | "per_second" | "factor_bp" | "centi_units";
}

interface AffixEffectDoc {
  stat: string;
  layer: "added" | "increased" | "more";
  condition: null | { wielding_weapon_class: "melee" | "bow" | "wand" };
}
interface RollRange {
  min: number;
  max: number;
}
interface AffixTierDoc {
  ilvl: number;
  name: string;
  rolls: RollRange[];
  weight: number;
}
export interface AffixDoc {
  num: number;
  name: string;
  kind: "prefix" | "suffix";
  effects: AffixEffectDoc[];
  tiers: AffixTierDoc[];
  description: string;
}
export interface ItemDoc {
  num: number;
  name: string;
  slot?: string;
  req_level?: number;
  req_str?: number;
  req_dex?: number;
  req_int?: number;
}

/** One formatted modifier ready to render. */
export interface FormattedMod {
  kind: "prefix" | "suffix";
  /** The rolled tier's name (the PoE "Flaring" / "of Incision" mod name). */
  tierName: string;
  /** 1-based tier index for display. */
  tier: number;
  /** One formatted line per effect (hybrids have several). */
  lines: string[];
}

export class ContentDocs {
  private statByKey = new Map<string, StatDoc>();
  private affixByNum = new Map<number, AffixDoc>();
  private itemByNum = new Map<number, ItemDoc>();

  constructor(json: any) {
    for (const s of json.stats ?? []) this.statByKey.set(s.key, s as StatDoc);
    const cats = json.categories ?? {};
    for (const a of cats.affix ?? []) this.affixByNum.set(a.num, a as AffixDoc);
    for (const it of cats.item ?? []) this.itemByNum.set(it.num, it as ItemDoc);
  }

  stat(key: string): StatDoc | undefined {
    return this.statByKey.get(key);
  }
  affix(num: number): AffixDoc | undefined {
    return this.affixByNum.get(num);
  }
  item(num: number): ItemDoc | undefined {
    return this.itemByNum.get(num);
  }

  /** Format a rolled affix into its tooltip block, or null if unknown. */
  formatMod(mod: RolledModView): FormattedMod | null {
    const def = this.affix(mod.num);
    if (!def) return null;
    const tier = def.tiers[mod.tier];
    const lines = def.effects.map((eff, i) =>
      formatEffect(eff, mod.values[i] ?? 0, tier?.rolls[i], this.stat(eff.stat)),
    );
    return {
      kind: def.kind,
      tierName: tier?.name ?? def.name,
      tier: mod.tier + 1,
      lines,
    };
  }
}

/** "+83(80-89) to maximum Life" / "36(35-38)% increased ..." for one effect. */
function formatEffect(
  eff: AffixEffectDoc,
  value: number,
  range: RollRange | undefined,
  stat: StatDoc | undefined,
): string {
  const name = stat?.name ?? eff.stat;
  // Increased / More layers are always basis-point percentages.
  const pct = eff.layer !== "added";
  const scale = pct || stat?.added_unit === "basis_points" || stat?.added_unit === "factor_bp";
  const fmt = (n: number) => (scale ? `${n / 100}` : `${n}`);
  const num = numWithRange(value, range, fmt);
  const unitSuffix =
    !pct && stat?.added_unit === "per_second"
      ? " per second"
      : "";
  let body: string;
  if (eff.layer === "increased") body = `${num}% increased ${name}`;
  else if (eff.layer === "more") body = `${num}% more ${name}`;
  else if (scale) body = `+${num}% ${name}`;
  else body = `+${num} ${name}${unitSuffix}`;
  if (eff.condition && "wielding_weapon_class" in eff.condition) {
    const cls = eff.condition.wielding_weapon_class;
    const word = cls === "melee" ? "a melee weapon" : cls === "bow" ? "a bow" : "a wand";
    body += ` (while wielding ${word})`;
  }
  return body;
}

/** "83(80-89)" — the rolled value with its tier range, or just the value when the
 *  range is a point (min == max) or unknown. */
function numWithRange(
  value: number,
  range: RollRange | undefined,
  fmt: (n: number) => string,
): string {
  if (!range || range.min === range.max) return fmt(value);
  return `${fmt(value)}(${fmt(range.min)}-${fmt(range.max)})`;
}

/** One source contribution to a stat, short form (#87): "+10", "+30% increased",
 *  "30% more", "+5/s" — no range (a single granted value). `layer`: 0 added,
 *  1 increased, 2 more. */
export function formatContribution(
  layer: number,
  value: number,
  stat: StatDoc | undefined,
): string {
  const pct = layer !== 0;
  const scale = pct || stat?.added_unit === "basis_points" || stat?.added_unit === "factor_bp";
  const n = scale ? value / 100 : value;
  if (layer === 1) return `${n}% increased`;
  if (layer === 2) return `${n}% more`;
  if (scale) return `+${n}%`;
  return stat?.added_unit === "per_second" ? `+${n}/s` : `+${n}`;
}

/** Fetch + parse the content reference once. */
export async function loadContentDocs(base = "/"): Promise<ContentDocs> {
  const json = await (await fetch(`${base}content-docs.json`)).json();
  return new ContentDocs(json);
}
