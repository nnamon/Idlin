import { useEffect, useState } from "react";
import type { NetClient, NetStatus } from "../net/client";
import type { WorldStore, EntityRender } from "../world/store";
import { TreeMap } from "./TreeMap";

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
          <div style={{ color: "#8a8aa0", fontSize: 11, letterSpacing: 1 }}>HEROES</div>
          {chars.map((c) => (
            <LeaderRow key={c.state.id} c={c} focused={c.state.id === focusId} />
          ))}
          {chars.length === 0 && <div style={{ color: "#55556a" }}>none yet</div>}
        </div>
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
