// PoE-style item tooltip (#87): name + base header, item/required levels, then
// the rolled modifiers grouped prefix/suffix with each tier name + the formatted
// "value(range)" line. Pure + presentational so the capture harness can mount it
// with a fixed item; the live overlay feeds it the hovered bag/equipped item.
import { RARITY_COLORS } from "../gen/constants";
import type { ContentDocs, FormattedMod } from "../world/contentDocs";

/** The structural item shape shared by GearSlotView and InvItemView. */
export interface TooltipItem {
  name: string;
  rarity: number;
  base_num: number;
  item_level: number;
  mods: { num: number; tier: number; values: number[] }[];
}

const RARITY_NAME = ["Normal", "Magic", "Rare", "Unique"];

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
        {/* meta */}
        {(item.item_level > 0 || reqs.length > 0) && (
          <div style={{ color: "#8c7f5e", fontSize: 11.5, marginBottom: 4 }}>
            {item.item_level > 0 && <div>Item Level: {item.item_level}</div>}
            {reqs.length > 0 && <div>Requires {reqs.join(", ")}</div>}
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

        {formatted.length === 0 && item.mods.length === 0 && (
          <div style={{ color: "#6f6346", fontStyle: "italic", fontSize: 11.5 }}>
            {RARITY_NAME[item.rarity] ?? ""} item
          </div>
        )}
      </div>
    </div>
  );
}
