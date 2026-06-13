import { useEffect, useMemo, useState } from "react";
import { type TreeData, type TreeNode, fmtGrant, KIND_STYLE, SCALE } from "./tree";

// The PORTAL: a web home separate from the stream overlay. v1 is a planning
// surface — plan a passive build, compose bot preferences, browse templates —
// that emits copy-pasteable artifacts. It never mutates server state; pushing
// a plan to YOUR live idler needs the identity/auth story (see
// docs/design/portal.md), which is out of scope here.

const ACCENT = "#9a7bff";
const TEXT = "#c8c8e0";
const MUTED = "#55556a";
const PANEL = "#15151f";

export function Portal() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0a0f",
        color: TEXT,
        pointerEvents: "auto",
        overflow: "auto",
        fontFamily: "inherit",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          padding: "12px 20px",
          borderBottom: "1px solid #26263a",
        }}
      >
        <span style={{ color: ACCENT, fontWeight: 700, letterSpacing: 3, fontSize: 16 }}>
          IDLIN · PORTAL
        </span>
        <span style={{ color: MUTED, fontSize: 12 }}>
          plan a build &amp; bot preferences — pushing them to a live idler needs sign-in (coming
          later)
        </span>
        <a href="/" style={{ marginLeft: "auto", color: "#5adfdf", fontSize: 13 }}>
          ← back to the stream
        </a>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16, alignItems: "flex-start" }}>
        <BuildPlanner />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, flex: "1 1 300px", minWidth: 280 }}>
          <PrefsComposer />
          <Templates />
        </div>
      </div>
    </div>
  );
}

// --- Build planner: click the tree to plan, export a `build [...]` list. ---

function BuildPlanner() {
  const [data, setData] = useState<TreeData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<TreeNode | null>(null);

  useEffect(() => {
    fetch("/api/tree")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ nodes: [], edges: [] }));
  }, []);

  const startIdx = useMemo(
    () => (data ? data.nodes.findIndex((n) => n.id === "start") : -1),
    [data],
  );

  // Undirected adjacency list over node indices.
  const adj = useMemo(() => {
    const a: number[][] = data ? data.nodes.map(() => []) : [];
    if (data) {
      for (const [u, v] of data.edges) {
        a[u].push(v);
        a[v].push(u);
      }
    }
    return a;
  }, [data]);

  if (!data) return <div style={{ color: MUTED, padding: 20 }}>loading tree…</div>;
  if (data.nodes.length === 0)
    return <div style={{ color: MUTED, padding: 20 }}>no passive tree in this content set.</div>;

  // A node is allocatable iff it neighbours the start or an already-picked node.
  const isReachable = (i: number) =>
    i === startIdx || adj[i].some((j) => j === startIdx || selected.has(j));

  // Recompute the component reachable from start over a candidate selection,
  // so deselecting an interior node prunes anything it orphaned.
  const prune = (picked: Set<number>): Set<number> => {
    const keep = new Set<number>();
    const queue = [startIdx];
    const seen = new Set<number>([startIdx]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const j of adj[cur]) {
        if (picked.has(j) && !seen.has(j)) {
          seen.add(j);
          keep.add(j);
          queue.push(j);
        }
      }
    }
    return keep;
  };

  const toggle = (i: number) => {
    if (i === startIdx) return; // start is implicit, always allocated
    const next = new Set(selected);
    if (next.has(i)) {
      next.delete(i);
      setSelected(prune(next));
    } else if (isReachable(i)) {
      next.add(i);
      setSelected(next);
    }
  };

  // BFS-from-start order over the picked set = a valid allocation order; the
  // start node is implicit and excluded from the exported plan.
  const buildOrder: number[] = [];
  {
    const queue = [startIdx];
    const seen = new Set<number>([startIdx]);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const j of adj[cur]) {
        if (selected.has(j) && !seen.has(j)) {
          seen.add(j);
          buildOrder.push(j);
          queue.push(j);
        }
      }
    }
  }
  const buildList = `build [ ${buildOrder.map((i) => data.nodes[i].num).join(", ")} ];`;

  // Accumulated grants over start + picks.
  const totals = new Map<string, number>();
  const order: string[] = [];
  for (const i of [startIdx, ...selected]) {
    for (const g of data.nodes[i].grants) {
      const key = `${g.stat}|${g.layer}`;
      if (!totals.has(key)) order.push(key);
      totals.set(key, (totals.get(key) ?? 0) + g.value);
    }
  }

  const xs = data.nodes.map((n) => n.x * SCALE);
  const ys = data.nodes.map((n) => n.y * SCALE);
  const pad = 60;
  const minX = Math.min(...xs, 0) - pad;
  const minY = Math.min(...ys, 0) - pad;
  const w = Math.max(...xs, 0) - minX + pad;
  const h = Math.max(...ys, 0) - minY + pad;

  return (
    <div style={{ flex: "2 1 520px", minWidth: 320 }}>
      <Panel title="BUILD PLANNER">
        <div style={{ color: MUTED, fontSize: 12, marginBottom: 6 }}>
          {selected.size} of {data.nodes.length - 1} nodes — click to allocate from the start
          outward
        </div>
        <svg
          viewBox={`${minX} ${minY} ${w} ${h}`}
          style={{ width: "100%", height: 420, background: "#0c0c14", borderRadius: 6 }}
          onMouseLeave={() => setHover(null)}
        >
          {data.edges.map(([a, b], i) => (
            <line
              key={i}
              x1={data.nodes[a].x * SCALE}
              y1={data.nodes[a].y * SCALE}
              x2={data.nodes[b].x * SCALE}
              y2={data.nodes[b].y * SCALE}
              stroke={selected.has(a) && selected.has(b) ? ACCENT : "#2a2a3e"}
              strokeWidth={2}
            />
          ))}
          {data.nodes.map((n, i) => {
            const style = KIND_STYLE[n.kind] ?? KIND_STYLE.travel;
            const cx = n.x * SCALE;
            const cy = n.y * SCALE;
            const isStart = i === startIdx;
            const picked = isStart || selected.has(i);
            const reachable = isReachable(i);
            const opacity = picked ? 1 : reachable ? 0.85 : 0.3;
            return (
              <g
                key={n.id}
                onMouseEnter={() => setHover(n)}
                onClick={() => toggle(i)}
                style={{ cursor: isStart ? "default" : reachable || selected.has(i) ? "pointer" : "default", opacity }}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={isStart ? 13 : style.r}
                  fill={isStart ? ACCENT : picked ? style.fill : "#1c1c2a"}
                  stroke={picked ? "#fff" : hover?.id === n.id ? "#fff" : style.fill}
                  strokeWidth={2}
                />
                {(style.label || isStart) && (
                  <text
                    x={cx}
                    y={cy + (isStart ? 26 : style.r + 13)}
                    textAnchor="middle"
                    fill="#b0b0c8"
                    fontSize={11}
                  >
                    {n.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <Label>EXPORT — paste into a bot's source</Label>
            <CodeBox text={buildList} />
            <button
              onClick={() => setSelected(new Set())}
              style={btnStyle}
              disabled={selected.size === 0}
            >
              reset plan
            </button>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <Label>ALLOCATED GRANTS</Label>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              {order.length === 0 ? (
                <span style={{ color: MUTED }}>pick nodes to see totals</span>
              ) : (
                order.map((key) => {
                  const [stat, layer] = key.split("|");
                  return (
                    <div key={key} style={{ color: layer === "more" ? "#ffd75a" : "#b0d8b0" }}>
                      {fmtGrant({ stat, layer, value: totals.get(key) ?? 0 })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
        {hover && (
          <div style={{ marginTop: 8, fontSize: 12, color: MUTED }}>
            <span style={{ color: "#e8e8ff" }}>{hover.name}</span> · #{hover.num} · {hover.kind}
            {hover.grants.map((g, i) => (
              <span key={i} style={{ marginLeft: 8 }}>
                {fmtGrant(g)}
              </span>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Bot preferences: compose the 0xF000 param block. ---

const PREF_FIELDS: { key: string; label: string; max: number; offset: number }[] = [
  { key: "aggression", label: "aggression (0–255)", max: 255, offset: 0 },
  { key: "flaskAtLife", label: "drink flask at life %", max: 100, offset: 1 },
  { key: "preferSkill", label: "prefer skill slot (0–7)", max: 7, offset: 2 },
  { key: "lootFloor", label: "loot rarity floor (0–3)", max: 3, offset: 3 },
];

function PrefsComposer() {
  const [vals, setVals] = useState<Record<string, number>>({
    aggression: 128,
    flaskAtLife: 40,
    preferSkill: 0,
    lootFloor: 0,
  });
  const bytes = new Uint8Array(8);
  for (const f of PREF_FIELDS) bytes[f.offset] = Math.max(0, Math.min(f.max, vals[f.key] | 0));
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

  return (
    <Panel title="BOT PREFERENCES">
      <div style={{ color: MUTED, fontSize: 12, marginBottom: 8 }}>
        The host writes these bytes into a bot's param block at <code>0xF000</code> (the
        chat-command channel). A bot reads them at fixed offsets. This convention is illustrative —
        no template consumes it yet, and delivery to your character needs sign-in.
      </div>
      {PREF_FIELDS.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
          <span style={{ flex: 1, fontSize: 12.5 }}>{f.label}</span>
          <input
            type="number"
            min={0}
            max={f.max}
            value={vals[f.key]}
            onChange={(e) => setVals({ ...vals, [f.key]: Number(e.target.value) })}
            style={{
              width: 64,
              background: "#0c0c14",
              color: TEXT,
              border: "1px solid #33334a",
              borderRadius: 4,
              padding: "2px 6px",
              fontFamily: "inherit",
            }}
          />
        </div>
      ))}
      <Label>PARAM BLOCK (0xF000)</Label>
      <CodeBox text={hex} />
    </Panel>
  );
}

// --- Templates gallery. ---

const TEMPLATES = [
  {
    id: "grinder",
    name: "Grinder",
    desc: "The canonical idler: declares a passive build, fights the nearest enemy with its first ready skill, loots, equips upgrades, sockets gems, banks over-level gear at the stash, and crafts white drops. The starting point for your own.",
  },
];

function Templates() {
  return (
    <Panel title="TEMPLATES">
      {TEMPLATES.map((t) => (
        <div key={t.id} style={{ marginBottom: 8 }}>
          <div style={{ color: "#e8e8ff", fontWeight: 700 }}>{t.name}</div>
          <div style={{ fontSize: 12.5, color: "#a0a0b8", lineHeight: 1.5 }}>{t.desc}</div>
        </div>
      ))}
      <a href="https://github.com/nnamon/Idlin/blob/main/docs/bot-guide.md" style={{ color: "#5adfdf", fontSize: 12.5 }}>
        bot programming guide →
      </a>
    </Panel>
  );
}

// --- Small shared UI bits. ---

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: PANEL, border: "1px solid #26263a", borderRadius: 8, padding: 14 }}>
      <div style={{ color: ACCENT, fontWeight: 700, letterSpacing: 2, fontSize: 12, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: MUTED, fontSize: 11, letterSpacing: 1, margin: "8px 0 4px" }}>{children}</div>
  );
}

function CodeBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: "relative", marginBottom: 6 }}>
      <pre
        style={{
          background: "#0c0c14",
          border: "1px solid #33334a",
          borderRadius: 4,
          padding: "8px 10px",
          margin: 0,
          fontSize: 12.5,
          color: "#cfe8cf",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        {text}
      </pre>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        style={{ ...btnStyle, position: "absolute", top: 4, right: 4, marginTop: 0 }}
      >
        {copied ? "copied" : "copy"}
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "#26263a",
  color: TEXT,
  border: "1px solid #44445a",
  borderRadius: 4,
  padding: "3px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 12,
  marginTop: 6,
};
