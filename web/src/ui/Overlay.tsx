import { useEffect, useState } from "react";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { NetClient, NetStatus } from "../net/client";
import type { WorldStore, EntityRender } from "../world/store";
import { TreeMap } from "./TreeMap";

const RARITY_TEXT = ["#b8b8c8", "#5a8aff", "#ffd75a", "#ff9a3c"];

const TICK_HZ = 10;

const panelStyle: React.CSSProperties = {
  padding: "10px 14px",
  background: "rgba(10, 10, 18, 0.82)",
  border: "1px solid #33334a",
  borderRadius: 6,
  color: "#c8c8e0",
  fontSize: 13,
  lineHeight: 1.65,
};

export function Overlay({ client, store }: { client: NetClient; store: WorldStore }) {
  const [status, setStatus] = useState<NetStatus | null>(null);
  const [showTree, setShowTree] = useState(false);
  const [, setVersion] = useState(0);

  useEffect(() => client.onStatus(setStatus), [client]);
  useEffect(() => {
    const h = setInterval(() => setVersion(store.version), 200);
    return () => clearInterval(h);
  }, [store]);

  const focusId = store.cue?.focus;
  const focused = focusId !== undefined ? store.entities.get(focusId) : undefined;

  // Keep the focus panel fresh: re-request the sheet while a character is
  // in frame (cheap: one small message per second).
  useEffect(() => {
    if (focusId === undefined) return;
    const ask = () => client.send({ type: "Inspect", data: { id: focusId } });
    ask();
    const h = setInterval(ask, 1000);
    return () => clearInterval(h);
  }, [client, focusId]);
  const sheet = store.sheet && store.sheet.id === focusId ? store.sheet : null;
  const chars = store
    .characters()
    .sort((a, b) => b.state.level - a.state.level || b.state.kills - a.state.kills);
  const now = performance.now();
  const ticker = store.ticker.filter((t) => now - t.at < 14000).slice(-8);

  return (
    <>
      {/* top-left: status */}
      <div style={{ ...panelStyle, position: "absolute", top: 12, left: 12 }}>
        <div style={{ color: "#9a7bff", fontWeight: 700, letterSpacing: 2 }}>IDLIN</div>
        <div style={{ color: "#8a8aa0" }}>{store.zone?.name ?? "connecting…"}</div>
        <div>
          link:{" "}
          <span style={{ color: status?.connected ? "#7bff9a" : "#ff6a6a" }}>
            {status?.connected ? `live (${status.rttMs ?? "—"} ms)` : "disconnected"}
          </span>
        </div>
        <div style={{ color: "#8a8aa0" }}>
          tick {store.tick} · up {formatUptime(store.tick / TICK_HZ)}
        </div>
        <button
          onClick={() => setShowTree(true)}
          style={{
            marginTop: 6,
            background: "#26263a",
            color: "#9a7bff",
            border: "1px solid #44445a",
            borderRadius: 4,
            padding: "3px 10px",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            pointerEvents: "auto",
          }}
        >
          ◈ tree map
        </button>
      </div>

      {showTree && <TreeMap onClose={() => setShowTree(false)} />}

      {/* top-right: focus + leaderboard */}
      <div style={{ position: "absolute", top: 12, right: 12, width: 230 }}>
        {focused && focused.state.kind === "Character" && (
          <div style={{ ...panelStyle, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#e8e8ff", fontWeight: 700 }}>{focused.state.name}</span>
              <span style={{ color: "#9a7bff", fontSize: 11 }}>{store.cue?.reason}</span>
            </div>
            <div style={{ color: "#8a8aa0", fontSize: 12 }}>
              level {focused.state.level} {focused.state.model}
            </div>
            <LifeBar pct={focused.state.life_pct} dead={focused.state.dead} />
            <div style={{ fontSize: 12, color: "#8a8aa0" }}>
              {focused.state.kills} kills · {focused.state.items} items
            </div>
          </div>
        )}
        <div style={panelStyle}>
          <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1 }}>IDLERS</div>
          {chars.map((c) => (
            <LeaderRow key={c.state.id} c={c} focused={c.state.id === focusId} />
          ))}
          {chars.length === 0 && <div style={{ color: "#55556a" }}>none yet</div>}
        </div>
        {sheet && <SheetPanel sheet={sheet} />}
      </div>

      {/* bottom-left: event ticker */}
      <div style={{ position: "absolute", bottom: 14, left: 12, maxWidth: 460 }}>
        {ticker.map((t) => (
          <div
            key={t.key}
            style={{
              color: t.color,
              fontSize: 13,
              textShadow: "0 1px 3px #000",
              opacity: Math.max(0.25, 1 - (now - t.at) / 14000),
            }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

/** The focus panel: gear, brief stats, and the bag of the watched idler. */
function SheetPanel({ sheet }: { sheet: CharacterSheet }) {
  const stat = (label: string, value: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
      <span style={{ color: "#77778e" }}>{label}</span>
      <span style={{ color: "#c8c8e0" }}>{value}</span>
    </div>
  );
  const dmg = [sheet.dmg_phys, sheet.dmg_fire, sheet.dmg_cold, sheet.dmg_lightning, sheet.dmg_chaos];
  const dmgText = dmg.join("/");
  const resPct = (bp: number) => Math.min(75, Math.round(bp / 100));
  const res = `${resPct(sheet.resist_fire_bp)}/${resPct(sheet.resist_cold_bp)}/${resPct(sheet.resist_lightning_bp)}/${resPct(sheet.resist_chaos_bp)}%`;
  const CELL = 13;
  return (
    <div style={{ ...panelStyle, marginTop: 8, lineHeight: 1.5 }}>
      <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1, marginBottom: 2 }}>
        EQUIPMENT
      </div>
      {sheet.equipment.map((g) => (
        <div key={g.slot} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
          <span style={{ color: "#77778e" }}>{g.slot}</span>
          <span style={{ color: g.name ? RARITY_TEXT[g.rarity] : "#44445a" }}>
            {g.name || "—"}
          </span>
        </div>
      ))}
      <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1, margin: "6px 0 2px" }}>
        STATS
      </div>
      {stat("life", `${sheet.life} / ${sheet.life_max}`)}
      {stat("mana", `${sheet.mana} / ${sheet.mana_max}`)}
      {sheet.es_max > 0 && stat("energy shield", `${sheet.es} / ${sheet.es_max}`)}
      {sheet.block_bp > 0 && stat("block", `${Math.round(sheet.block_bp / 100)}%`)}
      {stat("dmg p/f/c/l/ch", dmgText)}
      {stat("accuracy / evasion", `${sheet.accuracy} / ${sheet.evasion}`)}
      {stat("armour", `${sheet.armour}`)}
      {stat("res f/c/l/ch", res)}
      {(sheet.item_rarity_bp > 0 || sheet.item_quantity_bp > 0) &&
        stat(
          "find rar/qty",
          `+${(sheet.item_rarity_bp / 100).toFixed(0)}% / +${(sheet.item_quantity_bp / 100).toFixed(0)}%`,
        )}
      {stat("passives", `${sheet.passive_allocated} of ${sheet.build_len} (+${sheet.passive_unspent})`)}
      {sheet.gems.length > 0 && (
        <>
          <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1, margin: "6px 0 2px" }}>
            GEMS
          </div>
          {sheet.gems.map((g, i) => (
            <div
              key={i}
              style={{
                fontSize: 11.5,
                color: "#5adfdf",
                paddingLeft: g.support ? 12 : 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ whiteSpace: "nowrap" }}>
                {g.support ? "↳ " : "◆ "}
                {g.name} <span style={{ color: "#77778e" }}>lv{g.level}</span>
              </span>
              {g.xp_next > 0 ? (
                <span
                  style={{
                    flex: "0 0 44px",
                    height: 4,
                    background: "#23233a",
                    borderRadius: 2,
                    overflow: "hidden",
                  }}
                  title={`${g.xp} / ${g.xp_next} xp`}
                >
                  <span
                    style={{
                      display: "block",
                      height: "100%",
                      width: `${Math.min(100, Math.round((g.xp / g.xp_next) * 100))}%`,
                      background: "#5adfdf",
                    }}
                  />
                </span>
              ) : (
                <span style={{ color: "#ffd75a", fontSize: 9.5, letterSpacing: 1 }}>MAX</span>
              )}
            </div>
          ))}
        </>
      )}
      {sheet.currency.length > 0 && (
        <>
          <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1, margin: "6px 0 2px" }}>
            OBOLS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {sheet.currency.map((c, i) => (
              <span key={i} style={{ fontSize: 11, color: ["#bfbfbf", "#5a8aff", "#ffd75a", "#ff9a3c"][c.tier] ?? "#bfbfbf" }}>
                {c.name.replace(" Obol", "")} ×{c.count}
              </span>
            ))}
          </div>
        </>
      )}
      <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1, margin: "6px 0 3px" }}>
        BAG
      </div>
      <div
        style={{
          position: "relative",
          width: 12 * CELL,
          height: 5 * CELL,
          background: "#15151f",
          border: "1px solid #2c2c40",
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 12px, #1d1d2c 12px, #1d1d2c 13px), repeating-linear-gradient(90deg, transparent, transparent 12px, #1d1d2c 12px, #1d1d2c 13px)",
        }}
      >
        {sheet.inventory.map((it, i) => (
          <div
            key={i}
            title={it.name}
            style={{
              position: "absolute",
              left: it.x * CELL,
              top: it.y * CELL,
              width: it.w * CELL - 1,
              height: it.h * CELL - 1,
              background: `${RARITY_TEXT[it.rarity]}33`,
              border: `1px solid ${RARITY_TEXT[it.rarity]}`,
              boxSizing: "border-box",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function LifeBar({ pct, dead }: { pct: number; dead: boolean }) {
  const color = dead ? "#444" : pct > 50 ? "#44dd66" : pct > 25 ? "#ffd75a" : "#ff5a5a";
  return (
    <div style={{ background: "#221111", height: 7, borderRadius: 3, margin: "4px 0" }}>
      <div
        style={{
          width: `${dead ? 0 : pct}%`,
          background: color,
          height: "100%",
          borderRadius: 3,
          transition: "width 0.3s",
        }}
      />
    </div>
  );
}

function LeaderRow({ c, focused }: { c: EntityRender; focused: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 12,
        color: c.state.dead ? "#55556a" : focused ? "#e8e8ff" : "#b0b0c8",
      }}
    >
      <span>
        {focused ? "▸ " : ""}
        {c.state.name}
        {c.state.dead ? " ☠" : ""}
      </span>
      <span style={{ color: "#8a8aa0" }}>
        lv{c.state.level} · {c.state.kills}k
      </span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
