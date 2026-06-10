import { useEffect, useState } from "react";

interface Grant {
  stat: string;
  layer: string;
  value: number;
}

interface TreeNode {
  id: string;
  num: number;
  name: string;
  kind: string;
  x: number;
  y: number;
  grants: Grant[];
}

interface TreeData {
  nodes: TreeNode[];
  edges: [number, number][];
}

const STAT_NAMES: Record<string, string> = {
  life: "maximum life",
  damage_phys: "physical damage",
  damage_ele: "elemental damage",
  damage_chaos: "chaos damage",
  attack_speed: "attack speed",
  move_speed: "movement speed",
  armour: "armour",
  evasion: "evasion",
  accuracy: "accuracy",
  resist_ele: "elemental resistance",
  resist_chaos: "chaos resistance",
};

const PERCENT_STATS = new Set(["resist_ele", "resist_chaos"]);

function fmtGrant(g: Grant): string {
  const name = STAT_NAMES[g.stat] ?? g.stat;
  if (g.layer === "added") {
    return PERCENT_STATS.has(g.stat)
      ? `+${g.value / 100}% ${name}`
      : `+${g.value} to ${name}`;
  }
  const pct = Math.abs(g.value) / 100;
  if (g.layer === "increased") {
    return `${pct}% ${g.value < 0 ? "reduced" : "increased"} ${name}`;
  }
  return `${pct}% ${g.value < 0 ? "LESS" : "MORE"} ${name}`;
}

const KIND_STYLE: Record<string, { r: number; fill: string; label: boolean }> = {
  travel: { r: 5, fill: "#8a8aa0", label: false },
  notable: { r: 10, fill: "#ffd75a", label: true },
  keystone: { r: 12, fill: "#ff6a6a", label: true },
  socket: { r: 9, fill: "#5adfdf", label: true },
};

const SCALE = 16;

export function TreeMap({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<TreeData | null>(null);
  const [hover, setHover] = useState<TreeNode | null>(null);

  useEffect(() => {
    fetch("/api/tree")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  }, []);

  if (!data) return null;

  const xs = data.nodes.map((n) => n.x * SCALE);
  const ys = data.nodes.map((n) => n.y * SCALE);
  const pad = 60;
  const minX = Math.min(...xs, 0) - pad;
  const minY = Math.min(...ys, 0) - pad;
  const w = Math.max(...xs, 0) - minX + pad;
  const h = Math.max(...ys, 0) - minY + pad;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 8, 14, 0.96)",
        pointerEvents: "auto",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          color: "#c8c8e0",
          fontSize: 14,
        }}
      >
        <div>
          <span style={{ color: "#9a7bff", fontWeight: 700, letterSpacing: 2 }}>
            PASSIVE TREE
          </span>
          <span style={{ color: "#55556a", marginLeft: 12 }}>
            {data.nodes.length} nodes — hover for details
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
          <Legend color="#8a8aa0" label="travel" />
          <Legend color="#ffd75a" label="notable" />
          <Legend color="#ff6a6a" label="keystone" />
          <Legend color="#5adfdf" label="gem socket" />
          <button
            onClick={onClose}
            style={{
              background: "#26263a",
              color: "#c8c8e0",
              border: "1px solid #44445a",
              borderRadius: 4,
              padding: "4px 14px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            close
          </button>
        </div>
      </div>

      <svg
        viewBox={`${minX} ${minY} ${w} ${h}`}
        style={{ flex: 1, width: "100%" }}
        onMouseLeave={() => setHover(null)}
      >
        {data.edges.map(([a, b], i) => {
          const na = data.nodes[a];
          const nb = data.nodes[b];
          return (
            <line
              key={i}
              x1={na.x * SCALE}
              y1={na.y * SCALE}
              x2={nb.x * SCALE}
              y2={nb.y * SCALE}
              stroke="#33334a"
              strokeWidth={2}
            />
          );
        })}
        {data.nodes.map((n) => {
          const style = KIND_STYLE[n.kind] ?? KIND_STYLE.travel;
          const cx = n.x * SCALE;
          const cy = n.y * SCALE;
          const isStart = n.id === "start";
          return (
            <g
              key={n.id}
              onMouseEnter={() => setHover(n)}
              style={{ cursor: "pointer" }}
            >
              {n.kind.startsWith("socket") ? (
                <rect
                  x={cx - style.r}
                  y={cy - style.r}
                  width={style.r * 2}
                  height={style.r * 2}
                  transform={`rotate(45 ${cx} ${cy})`}
                  fill={style.fill}
                  stroke={hover?.id === n.id ? "#fff" : "#0a0a0f"}
                  strokeWidth={2}
                />
              ) : (
                <circle
                  cx={cx}
                  cy={cy}
                  r={isStart ? 14 : style.r}
                  fill={isStart ? "#9a7bff" : style.fill}
                  stroke={hover?.id === n.id ? "#fff" : "#0a0a0f"}
                  strokeWidth={2}
                />
              )}
              {(style.label || isStart) && (
                <text
                  x={cx}
                  y={cy + (isStart ? 28 : style.r + 14)}
                  textAnchor="middle"
                  fill="#b0b0c8"
                  fontSize={11}
                  fontFamily="ui-monospace, monospace"
                >
                  {n.name}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            padding: "10px 14px",
            background: "rgba(16, 16, 26, 0.95)",
            border: "1px solid #44445a",
            borderRadius: 6,
            color: "#c8c8e0",
            fontSize: 13,
            maxWidth: 360,
          }}
        >
          <div style={{ color: "#e8e8ff", fontWeight: 700 }}>
            {hover.name}
            <span style={{ color: "#55556a", fontWeight: 400, marginLeft: 8 }}>
              #{hover.num} · {hover.id} · {hover.kind.replace("_", " ")}
            </span>
          </div>
          {hover.grants.length === 0 ? (
            <div style={{ color: "#8a8aa0" }}>
              {hover.kind === "socket"
                ? "Holds a skill gem (supports socket into the gem itself)."
                : "No grants."}
            </div>
          ) : (
            hover.grants.map((g, i) => (
              <div key={i} style={{ color: g.layer === "more" ? "#ffd75a" : "#b0d8b0" }}>
                {fmtGrant(g)}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ color: "#8a8aa0" }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 5,
          background: color,
          marginRight: 5,
        }}
      />
      {label}
    </span>
  );
}
