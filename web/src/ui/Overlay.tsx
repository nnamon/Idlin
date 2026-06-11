import { useEffect, useState } from "react";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { FocusQueueEntry } from "../gen/FocusQueueEntry";
import type { NetClient, NetStatus } from "../net/client";
import type { WorldStore, EntityRender } from "../world/store";
import { TreeMap } from "./TreeMap";

const RARITY_TEXT = ["#b8b8c8", "#5a8aff", "#ffd75a", "#ff9a3c"];

const TICK_HZ = 10;

const panelStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "linear-gradient(173deg, rgba(17,17,26,0.92), rgba(10,10,16,0.92))",
  border: "1px solid #2e2e44",
  boxShadow: "0 2px 14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)",
  borderRadius: 5,
  color: "#c8c8e0",
  fontSize: 13,
  lineHeight: 1.6,
};

/** Section header: the small-caps engraved rule used across every panel. */
function Header({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        fontFamily: "Cinzel, serif",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 2.5,
        color: "#8d8da8",
        textTransform: "uppercase",
        borderBottom: "1px solid #26263a",
        paddingBottom: 3,
        margin: first ? "0 0 6px" : "9px 0 6px",
      }}
    >
      {children}
    </div>
  );
}

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
  // Gate the sheet by name as well as id: net ids are per-world (every
  // instance's idler is id 1), so after a cross-world cut the previous
  // character's sheet would otherwise show until the next poll lands.
  const sheet =
    store.sheet &&
    store.sheet.id === focusId &&
    (!focused || store.sheet.name === focused.state.name)
      ? store.sheet
      : null;
  const chars = store
    .characters()
    .sort((a, b) => b.state.level - a.state.level || b.state.kills - a.state.kills);
  // Focused row first, then everyone in the order the rotation will
  // visit them, numbered from 1.
  let queuePos = 0;
  const queueRows = [...store.focusQueue]
    .sort((a, b) => Number(b.focused) - Number(a.focused))
    .map((q) => <QueueRow key={q.name} q={q} pos={q.focused ? null : ++queuePos} />);
  const now = performance.now();
  const ticker = store.ticker.filter((t) => now - t.at < 14000).slice(-8);

  return (
    <>
      {/* top-left: status */}
      <div style={{ ...panelStyle, position: "absolute", top: 12, left: 12 }}>
        <div
          style={{
            fontFamily: "Cinzel, serif",
            color: "#9a7bff",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: 4,
          }}
        >
          IDLIN
        </div>
        <div style={{ fontFamily: "Cinzel, serif", color: "#a8a8c2", fontSize: 12 }}>
          {store.zone?.name ?? "connecting…"}
        </div>
        <div style={{ fontSize: 11.5 }}>
          <span style={{ color: "#70708a" }}>link </span>
          <span style={{ color: status?.connected ? "#7bff9a" : "#ff6a6a" }}>
            {status?.connected ? `live · ${status.rttMs ?? "—"} ms` : "disconnected"}
          </span>
        </div>
        <div style={{ color: "#70708a", fontSize: 11.5 }}>
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
      <div style={{ position: "absolute", top: 12, right: 12, width: 248 }}>
        {focused && focused.state.kind === "Character" && (
          <div style={{ ...panelStyle, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span
                style={{
                  fontFamily: "Cinzel, serif",
                  color: "#ece9ff",
                  fontWeight: 700,
                  fontSize: 14,
                  letterSpacing: 0.5,
                }}
              >
                {focused.state.name}
              </span>
              <span
                style={{
                  color: "#9a7bff",
                  fontSize: 9.5,
                  letterSpacing: 1.5,
                  textTransform: "uppercase",
                  border: "1px solid #3c2f5e",
                  borderRadius: 3,
                  padding: "1px 5px",
                  background: "#1b1530",
                }}
              >
                {store.cue?.reason}
              </span>
            </div>
            <div style={{ color: "#70708a", fontSize: 11.5 }}>
              level {focused.state.level} {focused.state.model}
            </div>
            <LifeBar pct={focused.state.life_pct} dead={focused.state.dead} />
            <div style={{ fontSize: 11.5, color: "#70708a" }}>
              {focused.state.kills} kills · {focused.state.items} items
            </div>
          </div>
        )}
        <div style={panelStyle}>
          {store.focusQueue.length > 0 ? (
            // The featured feed carries every idler everywhere, in the
            // order the director's rotation will visit them.
            <>
              <Header first>Idlers · Focus Queue</Header>
              {queueRows}
            </>
          ) : (
            // Watch feeds see one world: the local roster.
            <>
              <Header first>Idlers</Header>
              {chars.map((c) => (
                <LeaderRow key={c.state.id} c={c} focused={c.state.id === focusId} />
              ))}
              {chars.length === 0 && <div style={{ color: "#55556a" }}>none yet</div>}
            </>
          )}
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

/** One gear slot in the paper-doll: framed cell, rarity glow, item name. */
function SlotBox({
  label,
  gear,
  area,
}: {
  label: string;
  gear: { name: string; rarity: number } | undefined;
  area: string;
}) {
  const filled = !!gear?.name;
  const color = filled ? RARITY_TEXT[gear.rarity] : "#2a2a3e";
  return (
    <div
      title={gear?.name || undefined}
      style={{
        gridArea: area,
        background: filled
          ? `linear-gradient(165deg, ${color}24, #13131d 75%)`
          : "linear-gradient(165deg, #15151f, #101018)",
        border: `1px solid ${filled ? `${color}aa` : "#262638"}`,
        boxShadow: filled ? `inset 0 0 10px ${color}1c` : "inset 0 1px 4px rgba(0,0,0,0.5)",
        borderRadius: 3,
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "10px 3px 3px",
        boxSizing: "border-box",
        minHeight: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: 4,
          fontSize: 7.5,
          letterSpacing: 1.2,
          color: "#4c4c62",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "Cinzel, serif",
          fontSize: 8.5,
          fontWeight: 600,
          color: filled ? color : "#33334a",
          textAlign: "center",
          lineHeight: 1.25,
          overflow: "hidden",
          wordBreak: "break-word",
          maxHeight: "100%",
        }}
      >
        {filled ? gear.name : "—"}
      </span>
    </div>
  );
}

/** The PoE-style bag: a 12×5 grid, items spanning their true footprint. */
function BagGrid({ sheet }: { sheet: CharacterSheet }) {
  const CELL = 17;
  return (
    <div
      style={{
        position: "relative",
        width: 12 * CELL + 1,
        height: 5 * CELL + 1,
        background: "#0d0d15",
        border: "1px solid #2c2c40",
        borderRadius: 2,
        backgroundImage:
          `repeating-linear-gradient(0deg, transparent, transparent ${CELL - 1}px, #1b1b2a ${CELL - 1}px, #1b1b2a ${CELL}px),` +
          `repeating-linear-gradient(90deg, transparent, transparent ${CELL - 1}px, #1b1b2a ${CELL - 1}px, #1b1b2a ${CELL}px)`,
      }}
    >
      {sheet.inventory.map((it, i) => {
        const color = RARITY_TEXT[it.rarity];
        const wide = it.w >= 2;
        return (
          <div
            key={i}
            title={it.name}
            style={{
              position: "absolute",
              left: it.x * CELL + 1,
              top: it.y * CELL + 1,
              width: it.w * CELL - 1,
              height: it.h * CELL - 1,
              background: `linear-gradient(150deg, ${color}30, ${color}10)`,
              border: `1px solid ${color}`,
              borderRadius: 2,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <span
              style={{
                fontFamily: "Cinzel, serif",
                fontSize: wide ? 8.5 : 9,
                fontWeight: 700,
                color,
                textAlign: "center",
                lineHeight: 1.15,
                padding: 1,
              }}
            >
              {wide ? it.name.split(" (")[0] : it.name.charAt(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** The focus panel: paper-doll gear, stats, gems, obols, and the bag. */
function SheetPanel({ sheet }: { sheet: CharacterSheet }) {
  const stat = (label: string, value: string) => (
    <div
      key={label}
      style={{ display: "flex", justifyContent: "space-between", fontSize: 11, lineHeight: 1.55 }}
    >
      <span style={{ color: "#70708a" }}>{label}</span>
      <span style={{ color: "#cfcfe4" }}>{value}</span>
    </div>
  );
  const dmg = [sheet.dmg_phys, sheet.dmg_fire, sheet.dmg_cold, sheet.dmg_lightning, sheet.dmg_chaos];
  const resPct = (bp: number) => Math.min(75, Math.round(bp / 100));
  const res = `${resPct(sheet.resist_fire_bp)}/${resPct(sheet.resist_cold_bp)}/${resPct(sheet.resist_lightning_bp)}/${resPct(sheet.resist_chaos_bp)}%`;
  const bySlot = new Map(sheet.equipment.map((g) => [g.slot.toLowerCase(), g]));
  return (
    <div style={{ ...panelStyle, marginTop: 8, lineHeight: 1.5 }}>
      <Header first>Equipment</Header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "62px 1fr 62px",
          gridTemplateRows: "44px 52px 34px",
          gridTemplateAreas: `"weapon helm offhand" "weapon chest offhand" ". boots ."`,
          gap: 5,
          marginBottom: 2,
        }}
      >
        <SlotBox area="weapon" label="Weapon" gear={bySlot.get("weapon")} />
        <SlotBox area="helm" label="Helm" gear={bySlot.get("helm")} />
        <SlotBox area="offhand" label="Offhand" gear={bySlot.get("offhand")} />
        <SlotBox area="chest" label="Chest" gear={bySlot.get("chest")} />
        <SlotBox area="boots" label="Boots" gear={bySlot.get("boots")} />
      </div>
      <Header>Stats</Header>
      {stat("life", `${Math.max(0, sheet.life)} / ${sheet.life_max}`)}
      {stat("mana", `${Math.max(0, sheet.mana)} / ${sheet.mana_max}`)}
      {sheet.es_max > 0 && stat("energy shield", `${sheet.es} / ${sheet.es_max}`)}
      {sheet.block_bp > 0 && stat("block", `${Math.round(sheet.block_bp / 100)}%`)}
      {stat("dmg p/f/c/l/ch", dmg.join("/"))}
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
          <Header>Gems</Header>
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
          <Header>Obols</Header>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
            {sheet.currency.map((c, i) => (
              <span key={i} style={{ fontSize: 11, color: ["#bfbfbf", "#5a8aff", "#ffd75a", "#ff9a3c"][c.tier] ?? "#bfbfbf" }}>
                {c.name.replace(" Obol", "")} ×{c.count}
              </span>
            ))}
          </div>
        </>
      )}
      <Header>Bag</Header>
      <BagGrid sheet={sheet} />
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

/** One idler on the cross-world focus queue: ▸ marks the camera's hold,
 *  numbers count down to each idler's turn, ⧖ marks a focus cooldown. */
function QueueRow({ q, pos }: { q: FocusQueueEntry; pos: number | null }) {
  return (
    <div style={{ fontSize: 12, opacity: q.cooldown && !q.focused ? 0.6 : 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: q.dead ? "#55556a" : q.focused ? "#e8e8ff" : "#b0b0c8",
        }}
      >
        <span>
          <span style={{ color: "#9a7bff", display: "inline-block", width: 16 }}>
            {q.focused ? "▸" : pos}
          </span>
          {q.name}
          {q.dead ? " ☠" : ""}
          {q.cooldown && !q.focused ? " ⧖" : ""}
        </span>
        <span style={{ color: "#8a8aa0" }}>lv{q.level}</span>
      </div>
      <div style={{ color: "#55556a", fontSize: 10, paddingLeft: 16, lineHeight: 1.2 }}>
        {q.zone}
      </div>
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
