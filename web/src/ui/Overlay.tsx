import { useEffect, useRef, useState } from "react";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { SkillStat } from "../gen/SkillStat";
import type { FocusQueueEntry } from "../gen/FocusQueueEntry";
import type { NetClient, NetStatus } from "../net/client";
import type { WorldStore, EntityRender } from "../world/store";
import { TICK_HZ, RARITY_COLORS } from "../gen/constants";
import "./overlay.css";

type Icons = { icon(name: string, kind: string): string | null } | null;

/** Best-guess silhouette family for a bag item (until items carry kinds). */
function bagKind(name: string, w: number, h: number): string {
  const n = name.toLowerCase();
  if (n.includes("boots") || n.includes("wader")) return "boots";
  if (n.includes("helm")) return "helm";
  if (n.includes("vest") || n.includes("chest") || n.includes("plate")) return "chest";
  if (n.includes("flask")) return "flask";
  // Accessories BEFORE the 1×1 fallback — a ring/amulet is 1×1 and would
  // otherwise read as a gem silhouette in the bag.
  if (n.includes("ring") || n.includes("band")) return "ring";
  if (n.includes("amulet") || n.includes("charm") || n.includes("pendant")) return "amulet";
  if (n.includes("belt")) return "belt";
  if (w === 1 && h === 1) return "gem";
  return "item";
}


/** Section header: the engraved small-caps rule used across every panel. */
function Header({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <div className={first ? "hdr first" : "hdr"}>{children}</div>;
}

export function Overlay({ client, store }: { client: NetClient; store: WorldStore }) {
  const [status, setStatus] = useState<NetStatus | null>(null);
  const [drawer, setDrawer] = useState(false);
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
    // Send the world we're DISPLAYING: net ids are per-world and overlap, so the
    // server must resolve the sheet in this exact world, not its featured guess
    // (#52). Empty until the first snapshot — the server falls back then.
    const ask = () =>
      client.send({
        type: "Inspect",
        data: { id: focusId, world_key: store.zone?.worldKey ?? "" },
      });
    ask();
    const h = setInterval(ask, 1000);
    return () => clearInterval(h);
  }, [client, focusId, store.zone?.worldKey]);
  // The sheet renders only while the focused idler is actually PRESENT
  // and matches by name as well as id — net ids are per-world (every
  // instance's idler is id 1), so a cross-world cut, a departure, or an
  // overview sweep must all drop the panels, not show a stale sheet.
  const sheet =
    store.sheet &&
    focused &&
    focused.state.kind === "Character" &&
    store.sheet.id === focusId &&
    store.sheet.name === focused.state.name
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

  // Unique monsters near the focused idler (or, in watch feeds without
  // a director cue, near ANY idler) announce themselves with a PoE boss
  // bar, top-center; several in range stack.
  const BOSS_RANGE = 24;
  const bossAnchors = focused ? [focused] : chars;
  const bosses = [...store.entities.values()].filter((e) => {
    if (e.state.kind !== "Monster" || e.state.rarity !== 3 || e.state.dead) return false;
    return bossAnchors.some((c) => {
      const dx = e.currX - c.currX;
      const dy = e.currY - c.currY;
      return dx * dx + dy * dy <= BOSS_RANGE * BOSS_RANGE;
    });
  });

  return (
    <>
      {/* top-center: boss life bars */}
      {bosses.length > 0 && (
        <div className="hud-boss">
          {bosses.map((b) => (
            <div key={b.state.id}>
              <div className="boss-name">{b.state.name}</div>
              <div className="boss-track">
                <div className="boss-fill" style={{ width: `${b.state.life_pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* left column: status plaque + the focused idler's stats */}
      <div className="hud-left">
      <div className="panel">
        <div style={{ fontWeight: 700, color: "#e0b75e", fontSize: 15, letterSpacing: 4 }}>
          IDLIN
        </div>
        <div style={{ fontWeight: 700, color: "#d8cba6", fontSize: 13.5 }}>
          {store.zone?.name ?? "connecting…"}
          {store.zone && (
            <span style={{ color: "#ab9d7a", fontWeight: 400 }}> · lv {store.zone.level}</span>
          )}
          {store.zone?.worldKey.includes("#") && (
            <span style={{ color: "#ab9d7a", fontWeight: 400 }}>
              {" "}· {store.zone.worldKey.split("#")[1]}&rsquo;s
            </span>
          )}
        </div>
        <div style={{ fontSize: 12.5 }}>
          <span style={{ color: "#ab9d7a" }}>link </span>
          <span style={{ color: status?.connected ? "#7bff9a" : "#ff6a6a" }}>
            {status?.connected ? `live · ${status.rttMs ?? "—"} ms` : "disconnected"}
          </span>
        </div>
        <div style={{ color: "#ab9d7a", fontSize: 12.5 }}>
          tick {store.tick} · up {formatUptime(store.tick / TICK_HZ)}
        </div>
      </div>
      {sheet && <StatsPanel sheet={sheet} />}
      </div>

      {/* top-right: focus + leaderboard */}
      <div className={drawer ? "hud-right open" : "hud-right"}>
        {focused && focused.state.kind === "Character" && (
          <div className="panel" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="display" style={{ fontSize: 17 }}>
                {focused.state.name}
              </span>
              <span className="chip">{store.cue?.reason}</span>
            </div>
            <div style={{ color: "#ab9d7a", fontSize: 12.5 }}>
              level {focused.state.level} {focused.state.model}
            </div>
            <LifeBar pct={focused.state.life_pct} dead={focused.state.dead} />
            <div style={{ fontSize: 12.5, color: "#ab9d7a" }}>
              {focused.state.kills} kills · {focused.state.items} items
            </div>
          </div>
        )}
        <div className="panel">
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
              {chars.length === 0 && <div style={{ color: "#8d8164" }}>none yet</div>}
            </>
          )}
        </div>
        {sheet && <GearPanel sheet={sheet} icons={store.icons} />}
        {sheet && <ObolsPanel sheet={sheet} />}
        {/* phones hide the left column; the drawer carries the numbers */}
        {sheet && (
          <div className="mobile-only">
            <StatsPanel sheet={sheet} />
          </div>
        )}
      </div>

      {/* phones: the panels live in a slide-in drawer */}
      <button className="hud-toggle" onClick={() => setDrawer((d) => !d)}>
        {drawer ? "✕" : "☰"}
      </button>

      {/* bottom-left: event ticker */}
      <div className="hud-ticker">
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

/** One paper-doll slot: shaped cell, item ART, rarity backdrop glow. */
function SlotBox({
  label,
  gear,
  area,
  icons,
}: {
  label: string;
  gear: { name: string; rarity: number; dimmed?: boolean } | undefined;
  area: string;
  icons: Icons;
}) {
  const filled = !!gear?.name;
  const color = filled ? RARITY_COLORS[gear.rarity] : "#3a2f1b";
  const src = filled ? icons?.icon(gear.name, label.toLowerCase()) : null;
  // A two-handed weapon mirrors into the offhand slot, shown greyed.
  const dimmed = !!gear?.dimmed;
  return (
    <div
      className={filled ? "slot filled" : "slot"}
      title={dimmed ? `${gear!.name} (two-handed)` : gear?.name || undefined}
      style={{
        gridArea: area,
        ["--rar" as string]: color,
        opacity: dimmed ? 0.4 : undefined,
      }}
    >
      <span className="tag">{label}</span>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <span
          style={{
            fontWeight: 700,
            fontSize: 10,
            color: filled ? color : "#3a2f1b",
            textAlign: "center",
            padding: "8px 2px 0",
            wordBreak: "break-word",
          }}
        >
          {filled ? gear.name : ""}
        </span>
      )}
      {filled && src && <span className="name">{gear.name.split(" (")[0]}</span>}
    </div>
  );
}

/** The bag: a dark 12×5 vault; items are art spanning their footprint. */
function BagGrid({ sheet, icons }: { sheet: CharacterSheet; icons: Icons }) {
  const CELL = 21;
  return (
    <div
      className="bag"
      style={{
        width: 12 * CELL + 1,
        height: 5 * CELL + 1,
        backgroundImage:
          `repeating-linear-gradient(0deg, transparent, transparent ${CELL - 1}px, #221b0f ${CELL - 1}px, #221b0f ${CELL}px),` +
          `repeating-linear-gradient(90deg, transparent, transparent ${CELL - 1}px, #221b0f ${CELL - 1}px, #221b0f ${CELL}px)`,
      }}
    >
      {sheet.inventory.map((it, i) => {
        const color = RARITY_COLORS[it.rarity];
        const src = icons?.icon(it.name, bagKind(it.name, it.w, it.h));
        return (
          <div
            key={i}
            className="bagitem"
            title={it.name}
            style={{
              left: it.x * CELL + 1,
              top: it.y * CELL + 1,
              width: it.w * CELL - 1,
              height: it.h * CELL - 1,
              ["--rar" as string]: color,
            }}
          >
            {src ? (
              <img src={src} alt="" />
            ) : (
              <span style={{ fontWeight: 700, fontSize: 11, color }}>
                {it.name.charAt(0)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Right column: the paper-doll gear and the bag — the PoE inventory. */
function GearPanel({ sheet, icons }: { sheet: CharacterSheet; icons: Icons }) {
  const bySlot = new Map(sheet.equipment.map((g) => [g.slot.toLowerCase(), g]));
  return (
    <div className="panel" style={{ marginTop: 8, lineHeight: 1.5 }}>
      <Header first>Equipment</Header>
      {/* PoE-style paper doll: weapon/offhand tall on the sides, amulet at the
          neck, the two rings FLANKING the body, belt wide across the bottom. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 60px",
          gridTemplateRows: "46px 44px 50px 44px 44px",
          gridTemplateAreas: `"weapon helm offhand" "weapon amulet offhand" "weapon chest offhand" "ringl chest ringr" "boots belt flask"`,
          gap: 5,
          marginBottom: 2,
        }}
      >
        <SlotBox area="weapon" label="Weapon" gear={bySlot.get("weapon")} icons={icons} />
        <SlotBox area="helm" label="Helm" gear={bySlot.get("helm")} icons={icons} />
        <SlotBox area="offhand" label="Offhand" gear={bySlot.get("offhand")} icons={icons} />
        {/* Amulet: a small slot at the neck, centered in the wide column. */}
        <div style={{ gridArea: "amulet", display: "flex", justifyContent: "center" }}>
          <div style={{ width: 56, display: "grid" }}>
            <SlotBox area="auto" label="Amulet" gear={bySlot.get("amulet")} icons={icons} />
          </div>
        </div>
        <SlotBox area="chest" label="Chest" gear={bySlot.get("chest")} icons={icons} />
        {/* Rings flank the body, left and right. */}
        <SlotBox area="ringl" label="Ring" gear={bySlot.get("ring")} icons={icons} />
        <SlotBox area="ringr" label="Ring" gear={bySlot.get("ring 2")} icons={icons} />
        <SlotBox area="boots" label="Boots" gear={bySlot.get("boots")} icons={icons} />
        <SlotBox area="belt" label="Belt" gear={bySlot.get("belt")} icons={icons} />
        <div style={{ gridArea: "flask", display: "flex", gap: 4 }}>
          <div style={{ flex: 1, display: "grid" }}>
            <SlotBox area="auto" label="Flask" gear={bySlot.get("flask")} icons={icons} />
          </div>
          <div style={{ flex: 1, display: "grid" }}>
            <SlotBox area="auto" label="Flask" gear={bySlot.get("flask 2")} icons={icons} />
          </div>
        </div>
      </div>
      <Header>Bag</Header>
      <BagGrid sheet={sheet} icons={icons} />
    </div>
  );
}

/**
 * A panel region pinned to a fraction of the viewport (`maxVh`) that auto-
 * scrolls its contents slowly when they overflow — so a tall list (many
 * socketed skills, later the debug console) can never push the rest of the HUD
 * off-screen, and the NON-interactive broadcast still cycles everything into
 * view over time.
 *
 * Determinism: the box bound (`max-height` + `overflow: hidden` + the edge
 * fade) is pure static CSS. The scroll MOTION is a CSS animation the capture
 * harness freezes — it's disabled under `prefers-reduced-motion: reduce` (which
 * the harness emulates) and frozen by `screenshot({ animations: "disabled" })`,
 * so the measured scroll distance only ever feeds the (frozen) animation,
 * never the captured pixels.
 */
function AutoScroll({ maxVh, children }: { maxVh: number; children: React.ReactNode }) {
  const view = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const measure = () => {
      const v = view.current;
      const i = inner.current;
      if (v && i) setOverflow(Math.max(0, i.scrollHeight - v.clientHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (inner.current) ro.observe(inner.current);
    if (view.current) ro.observe(view.current);
    return () => ro.disconnect();
  }, []);
  const scrolling = overflow > 0;
  const style = {
    maxHeight: `${maxVh}vh`,
    // One pixel/~0.1s, floored — slow and readable; only the disabled-in-capture
    // animation reads these.
    ["--scroll-y" as string]: `${-overflow}px`,
    ["--scroll-dur" as string]: `${Math.max(8, Math.round(overflow / 10))}s`,
  } as React.CSSProperties;
  return (
    <div ref={view} className={scrolling ? "autoscroll scrolling" : "autoscroll"} style={style}>
      <div ref={inner} className="autoscroll-inner">
        {children}
      </div>
    </div>
  );
}

/** A thin gem-XP progress bar (cyan fill; gold + full at the level cap). Used
 *  full-width on a skill card, and compactly as a support chip's underline.
 *  Both wrappers are spans so it's valid inside a chip `<span>` too. */
function XpBar({ xp, xpNext, className = "xp-bar" }: { xp: number; xpNext: number; className?: string }) {
  const maxed = xpNext <= 0;
  const pct = maxed ? 100 : Math.max(0, Math.min(100, Math.round((xp / xpNext) * 100)));
  return (
    <span className={maxed ? `${className} maxed` : className} title={maxed ? "max level" : `${xp} / ${xpNext} xp`}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** One socketed skill's computed readout. DPS leads for damage skills; a DoT,
 *  buff, or debuff skill shows its own pertinent number instead of a
 *  misleading "0 DPS". All numbers come from the sim (see `SkillStat`). */
function SkillCard({ skill }: { skill: SkillStat }) {
  // The headline metric, chosen by what the skill actually does.
  const head =
    skill.dps > 0
      ? { k: "DPS", v: String(skill.dps) }
      : skill.dot_per_sec > 0
        ? { k: "DoT", v: `${skill.dot_per_sec}/s · ${Math.round(skill.dot_duration_ticks / TICK_HZ)}s` }
        : skill.buff_duration_ticks > 0
          ? { k: "Buff", v: `${Math.round(skill.buff_duration_ticks / TICK_HZ)}s` }
          : skill.debuff_duration_ticks > 0
            ? { k: "Debuff", v: `${Math.round(skill.debuff_duration_ticks / TICK_HZ)}s` }
            : { k: skill.shape, v: "" };
  const manaPerSec = skill.use_ticks > 0 ? Math.round((skill.mana_cost * TICK_HZ) / skill.use_ticks) : 0;
  return (
    <div className="skill-card">
      <div className="skill-head">
        <span>
          ◆ {skill.name} <span style={{ color: "#ab9d7a" }}>lv{skill.level}</span>
        </span>
        <span className="skill-head-metric">
          <span style={{ color: "#ab9d7a" }}>{head.k}</span> {head.v}
        </span>
      </div>
      <XpBar xp={skill.xp} xpNext={skill.xp_next} />
      <div className="skill-meta">
        <span>{skill.kind}</span>
        {skill.mana_cost > 0 && (
          <span>
            {skill.mana_cost} mana ({manaPerSec}/s)
          </span>
        )}
        {skill.crit_chance_bp > 0 && (
          <span>
            crit {(skill.crit_chance_bp / 100).toFixed(1)}% ×{Math.round(skill.crit_multi_bp / 100)}%
          </span>
        )}
      </div>
      {skill.supports.length > 0 && (
        <div className="skill-supports">
          {skill.supports.map((s, i) => (
            <span key={i} className="chip">
              {s.name} lv{s.level}
              <XpBar xp={s.xp} xpNext={s.xp_next} className="chip-xp" />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Left column: the focused idler's numbers — stats, gems, obols. */
function StatsPanel({ sheet }: { sheet: CharacterSheet }) {
  const stat = (label: string, value: string) => (
    <div key={label} className="row">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </div>
  );
  const dmg = [sheet.dmg_phys, sheet.dmg_fire, sheet.dmg_cold, sheet.dmg_lightning, sheet.dmg_chaos];
  const resPct = (bp: number) => Math.min(75, Math.round(bp / 100));
  const res = `${resPct(sheet.resist_fire_bp)}/${resPct(sheet.resist_cold_bp)}/${resPct(sheet.resist_lightning_bp)}/${resPct(sheet.resist_chaos_bp)}%`;
  return (
    <div className="panel" style={{ lineHeight: 1.5 }}>
      <Header first>Stats</Header>
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
      {sheet.skills.length > 0 && (
        <>
          <Header>Skills</Header>
          {/* Pinned to ~half the viewport: a typical few-skill loadout fits;
              a heavily-socketed build clips and auto-scrolls. The cap keeps the
              left column (plaque + stats + this) on screen. */}
          <AutoScroll maxVh={50}>
            {sheet.skills.map((s, i) => (
              <SkillCard key={i} skill={s} />
            ))}
          </AutoScroll>
        </>
      )}
    </div>
  );
}

/** Obols (currency). Its own panel on the RIGHT, beside the gear/bag — the
 *  left column's stats + skill cards can get tall enough to push a section
 *  off-screen, and currency belongs with the inventory anyway. */
function ObolsPanel({ sheet }: { sheet: CharacterSheet }) {
  if (sheet.currency.length === 0) return null;
  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <Header first>Obols</Header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px" }}>
        {sheet.currency.map((c, i) => (
          <span key={i} style={{ fontSize: 12.5, color: RARITY_COLORS[c.tier] ?? RARITY_COLORS[0] }}>
            {c.name.replace(" Obol", "")} ×{c.count}
          </span>
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
        fontSize: 13,
        color: c.state.dead ? "#8d8164" : focused ? "#f0e6d2" : "#d2c5a3",
      }}
    >
      <span>
        {focused ? "▸ " : ""}
        {c.state.name}
        {c.state.dead ? " ☠" : ""}
      </span>
      <span style={{ color: "#b8aa87" }}>
        lv{c.state.level} · {c.state.kills}k
      </span>
    </div>
  );
}

/** One idler on the cross-world focus queue: ▸ marks the camera's hold,
 *  numbers count down to each idler's turn, ⧖ marks a focus cooldown. */
function QueueRow({ q, pos }: { q: FocusQueueEntry; pos: number | null }) {
  return (
    <div style={{ fontSize: 13, opacity: q.cooldown && !q.focused ? 0.6 : 1 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          color: q.dead ? "#8d8164" : q.focused ? "#f0e6d2" : "#d2c5a3",
        }}
      >
        <span>
          <span style={{ color: "#e0b75e", display: "inline-block", width: 16 }}>
            {q.focused ? "▸" : pos}
          </span>
          {q.name}
          {q.dead ? " ☠" : ""}
          {q.cooldown && !q.focused ? " ⧖" : ""}
        </span>
        <span style={{ color: "#b8aa87" }}>lv{q.level}</span>
      </div>
      <div style={{ color: "#8d8164", fontSize: 11, paddingLeft: 16, lineHeight: 1.25 }}>
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
