// PoE-style item tooltip (#87): name + base header, the base's own combat
// block (weapon damage / attack time / armour / ES / flask charge — a normal
// item's power is definitional, resolved from content-docs), implicit lines,
// item/required levels, then the modifiers: rolled affixes grouped
// prefix/suffix with tier names, or a signature unique's authored mods.
// Pure + presentational so the capture harness can mount it with a fixed
// item; the live overlay feeds it the hovered bag/equipped item.
import { RARITY_COLORS } from "../gen/constants";
import type { ContentDocs, FormattedMod, ItemDoc } from "../world/contentDocs";
import { formatContribution } from "../world/contentDocs";

/** The structural item shape shared by GearSlotView and InvItemView. */
export interface TooltipItem {
  name: string;
  rarity: number;
  base_num: number;
  item_level: number;
  mods: { num: number; tier: number; values: number[] }[];
  /** A signature unique's authored mods (v47); empty otherwise. */
  unique_mods?: { stat: string; layer: number; value: number }[];
}

const RARITY_NAME = ["Normal", "Magic", "Rare", "Unique"];

/** The base def's own combat lines ("Physical Damage: 8", "Attack Time: 0.9s"). */
function baseLines(base: ItemDoc): string[] {
  const out: string[] = [];
  const dmg: [string, number | undefined][] = [
    ["Physical", base.damage_phys],
    ["Fire", base.damage_fire],
    ["Cold", base.damage_cold],
    ["Lightning", base.damage_lightning],
    ["Chaos", base.damage_chaos],
  ];
  for (const [kind, v] of dmg) if (v) out.push(`${kind} Damage: ${v}`);
  if (out.length > 0 && base.use_ticks) {
    // 10 sim ticks per second; wands cast, everything else attacks.
    const verb = base.weapon_class === "wand" ? "Cast" : "Attack";
    out.push(`${verb} Time: ${(base.use_ticks / 10).toFixed(1)}s`);
  }
  if (base.armour) out.push(`Armour: ${base.armour}`);
  if (base.evasion) out.push(`Evasion: ${base.evasion}`);
  if (base.energy_shield) out.push(`Energy Shield: ${base.energy_shield}`);
  if (base.block_bp) out.push(`Block: ${base.block_bp / 100}%`);
  if (base.flask_heal) out.push(`Restores ${base.flask_heal} Life`);
  if (base.flask_mana) out.push(`Restores ${base.flask_mana} Mana`);
  if (base.flask_charges)
    out.push(`${base.flask_charges} Charges (${base.flask_cost ?? 0} per use)`);
  return out;
}

export function ItemTooltip({ item, docs }: { item: TooltipItem; docs: ContentDocs | null }) {
  const color = RARITY_COLORS[item.rarity] ?? RARITY_COLORS[0];
  const base = docs?.item(item.base_num);
  const formatted: FormattedMod[] = docs
    ? item.mods.map((m) => docs.formatMod(m)).filter((m): m is FormattedMod => !!m)
    : [];
  const prefixes = formatted.filter((m) => m.kind === "prefix");
  const suffixes = formatted.filter((m) => m.kind === "suffix");
  const reqs: string[] = [];
  if (base?.req_level) reqs.push(`Level ${base.req_level}`);
  if (base?.req_str) reqs.push(`${base.req_str} Str`);
  if (base?.req_dex) reqs.push(`${base.req_dex} Dex`);
  if (base?.req_int) reqs.push(`${base.req_int} Int`);

  return (
    <div
      className="item-tooltip"
      style={{
        minWidth: 230,
        maxWidth: 340,
        background: "rgba(8, 6, 3, 0.97)",
        border: `1px solid ${color}`,
        boxShadow: "0 4px 18px rgba(0,0,0,0.6)",
        color: "#c9bb95",
        fontSize: 12,
        lineHeight: 1.45,
        padding: 0,
        pointerEvents: "none",
      }}
    >
      {/* header: rolled name + base type, on a banded strip */}
      <div
        style={{
          textAlign: "center",
          padding: "5px 10px",
          background: "linear-gradient(#1c1610, #120d07)",
          borderBottom: `1px solid ${color}55`,
        }}
      >
        <div style={{ color, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.3 }}>
          {item.name}
        </div>
        {base && base.name !== item.name && (
          <div style={{ color, opacity: 0.8, fontSize: 12 }}>{base.name}</div>
        )}
      </div>

      <div style={{ padding: "6px 10px" }}>
        {/* the base's own combat block (definitional — every rarity has it) */}
        {base && baseLines(base).length > 0 && (
          <div style={{ color: "#c9bb95", marginBottom: 4 }}>
            {baseLines(base).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* implicit: the wand's spell-damage line, distinct from rolled mods */}
        {base?.spell_damage_bp ? (
          <div
            style={{
              borderTop: "1px solid #2a2113",
              paddingTop: 4,
              marginBottom: 4,
              color: "#8aa0d8",
            }}
          >
            +{base.spell_damage_bp / 100}% Spell Damage
            <span style={{ color: "#6f6346", fontStyle: "italic" }}> (implicit)</span>
          </div>
        ) : null}

        {/* meta */}
        {(item.item_level > 0 || reqs.length > 0) && (
          <div style={{ color: "#8c7f5e", fontSize: 11.5, marginBottom: 4 }}>
            {item.item_level > 0 && <div>Item Level: {item.item_level}</div>}
            {reqs.length > 0 && <div>Requires {reqs.join(", ")}</div>}
          </div>
        )}

        {/* a signature unique's authored mods — fixed identity, no tiers */}
        {(item.unique_mods?.length ?? 0) > 0 && (
          <div
            style={{
              borderTop: "1px solid #2a2113",
              paddingTop: 5,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {item.unique_mods!.map((m, i) => {
              const stat = docs?.stat(m.stat);
              return (
                <div key={i} style={{ color: "#d2ab52" }}>
                  {formatContribution(m.layer, m.value, stat)} {stat?.name ?? m.stat}
                </div>
              );
            })}
          </div>
        )}

        {formatted.length > 0 && (
          <div
            style={{
              borderTop: "1px solid #2a2113",
              paddingTop: 5,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {[...prefixes, ...suffixes].map((m, i) => (
              <div key={i}>
                <div style={{ color: "#6f6346", fontSize: 10.5, fontStyle: "italic" }}>
                  {m.kind === "prefix" ? "Prefix" : "Suffix"} “{m.tierName}” (Tier {m.tier})
                </div>
                {m.lines.map((line, j) => (
                  <div key={j} style={{ color: "#8aa0d8" }}>
                    {line}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* the bare-item filler ONLY when the tooltip rendered nothing else
            (gems / base-less rows) — an item showing its base block or an
            implicit is already telling its story */}
        {formatted.length === 0 &&
          item.mods.length === 0 &&
          (item.unique_mods?.length ?? 0) === 0 &&
          (!base || baseLines(base).length === 0) &&
          !base?.spell_damage_bp && (
            <div style={{ color: "#6f6346", fontStyle: "italic", fontSize: 11.5 }}>
              {RARITY_NAME[item.rarity] ?? ""} item
            </div>
          )}
      </div>
    </div>
  );
}
