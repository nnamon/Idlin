import type { S2C } from "../gen/S2C";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { EntityState } from "../gen/EntityState";
import type { FocusQueueEntry } from "../gen/FocusQueueEntry";
import type { GameEvent } from "../gen/GameEvent";
import type { TileMapState } from "../gen/TileMapState";

const TICK_MS = 100; // 10 Hz sim; interpolation window

export interface EntityRender {
  state: EntityState;
  prevX: number;
  prevY: number;
  currX: number;
  currY: number;
  movedAt: number; // performance.now() when curr was set
}

export interface TickerItem {
  text: string;
  color: string;
  at: number;
  key: number;
}

export interface ActiveHit {
  attacker: number;
  target: number;
  amount: number;
  /** Dominant damage component: 0 phys, 1 fire, 2 cold, 3 lightning, 4 chaos. */
  dmgType: number;
  crit: boolean;
  dot: boolean;
  projectile: boolean;
  killed: boolean;
  at: number;
}

/** A use began: the windup to animate; the strike lands at contact. */
export interface ActiveUse {
  attacker: number;
  spell: boolean;
  /** Aim point, sim units. */
  x: number;
  y: number;
  /** Seconds of full commitment / until the blow lands. */
  useS: number;
  contactS: number;
  at: number;
}

/** A projectile in flight (client-side animation; hits are authoritative). */
export interface ActiveProjectile {
  /** Caster id, for the launch animation. */
  attacker: number;
  spell: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Sim units of travel budget. */
  range: number;
  dmgType: number;
  at: number;
}

/** A non-projectile skill use: cast animation + shape VFX. */
export interface ActiveSkill {
  attacker: number;
  spell: boolean;
  /** 0 strike, 1 nova, 2 cone, 3 line, 4 point-AoE. */
  shape: number;
  /** Shape anchor in sim units (caster, or the blast point for point-AoE). */
  x: number;
  y: number;
  /** Normalized aim direction. */
  dx: number;
  dy: number;
  radius: number;
  range: number;
  dmgType: number;
  at: number;
}

export interface Cue {
  focus: number;
  reason: string;
  holdTicks: number;
  at: number;
}

/** Sim-generated non-walkable prop, in sim units. */
export interface ZoneObstacle {
  x: number;
  y: number;
  radius: number;
  kind: number;
}

const RARITY_NAMES = ["common", "magic", "rare", "UNIQUE"];
const RARITY_COLORS = ["#bfbfbf", "#5a8aff", "#ffd75a", "#ff9a3c"];

/**
 * Client-side mirror of the replicated zone. The renderer reads it every
 * frame; React polls it via `version`.
 */
export class WorldStore {
  entities = new Map<number, EntityRender>();
  zone: {
    name: string;
    /** Explicit world identity ("withered_shore#Kargan"). */
    worldKey: string;
    width: number;
    height: number;
    obstacles: ZoneObstacle[];
    tiles: TileMapState | null;
    exits: { x: number; y: number; open: boolean }[];
    gates: { x0: number; y0: number; x1: number; y1: number; open: boolean }[];
  } | null = null;
  tick = 0;
  /** Bumps on every ZoneSnapshot: a snapshot is a FULL state reset, and
   *  the renderer must drop per-entity visuals (net ids are per-world). */
  snapshotGen = 0;
  ticker: TickerItem[] = [];
  pendingHits: ActiveHit[] = [];
  pendingProjectiles: ActiveProjectile[] = [];
  pendingSkills: ActiveSkill[] = [];
  pendingUses: ActiveUse[] = [];
  cue: Cue | null = null;
  /** All idlers, all worlds, in upcoming-focus order (featured feed). */
  focusQueue: FocusQueueEntry[] = [];
  /** Speech bubbles: entity id → line + when (renderer reads each frame). */
  speech = new Map<number, { text: string; at: number }>();
  /** Latest inspect reply (the focus panel); refreshed by Overlay polling. */
  sheet: CharacterSheet | null = null;
  /** Item-icon renderer, installed by the scene once models load. */
  icons: { icon(name: string, kind: string): string | null } | null = null;
  version = 0;
  private tickerKey = 0;

  handle(msg: S2C): void {
    switch (msg.type) {
      case "ZoneSnapshot": {
        const d = msg.data;
        this.zone = {
          name: d.zone_name,
          worldKey: d.world_key ?? "",
          width: d.width / 65536,
          height: d.height / 65536,
          obstacles: d.obstacles.map((o) => ({
            x: o.x / 65536,
            y: o.y / 65536,
            radius: o.radius / 65536,
            kind: o.kind,
          })),
          tiles: d.tiles ?? null,
          exits: (d.exits ?? []).map((e) => ({
            x: e.x / 65536,
            y: e.y / 65536,
            open: e.open,
          })),
          gates: (d.gates ?? []).map((g) => ({ ...g })),
        };
        this.tick = d.tick;
        this.snapshotGen++;
        this.entities.clear();
        const now = performance.now();
        for (const e of d.entities) this.upsert(e, now);
        this.version++;
        break;
      }
      case "ZoneDelta": {
        const d = msg.data;
        if (d.tick <= this.tick && d.tick !== 0) {
          // Stale relative to the snapshot we already applied.
          if (d.tick < this.tick) return;
        }
        this.tick = d.tick;
        const now = performance.now();
        for (const e of d.spawned) this.upsert(e, now);
        for (const m of d.moved) {
          const er = this.entities.get(m.id);
          if (!er) continue;
          er.prevX = er.currX;
          er.prevY = er.currY;
          er.currX = m.x / 65536;
          er.currY = m.y / 65536;
          er.movedAt = now;
          er.state.x = m.x;
          er.state.y = m.y;
        }
        for (const u of d.updated) {
          const er = this.entities.get(u.id);
          if (!er) continue;
          er.state.life_pct = u.life_pct;
          er.state.level = u.level;
          er.state.dead = u.dead;
          er.state.kills = u.kills;
          er.state.items = u.items;
          er.state.weapon = u.weapon;
          er.state.weapon_rarity = u.weapon_rarity;
          er.state.gear = u.gear;
          er.state.gear_rarity = u.gear_rarity;
        }
        for (const id of d.removed) this.entities.delete(id);
        for (const h of d.hits) {
          this.pendingHits.push({
            attacker: h.attacker,
            target: h.target,
            amount: h.amount,
            dmgType: h.dmg_type,
            crit: h.crit,
            dot: h.dot,
            projectile: h.projectile,
            killed: h.killed,
            at: now,
          });
        }
        for (const p of d.projectiles) {
          this.pendingProjectiles.push({
            attacker: p.attacker,
            spell: p.spell,
            x: p.x / 65536,
            y: p.y / 65536,
            vx: p.vx / 65536,
            vy: p.vy / 65536,
            range: p.range / 65536,
            dmgType: p.dmg_type,
            at: now,
          });
        }
        for (const u of d.uses ?? []) {
          this.pendingUses.push({
            attacker: u.attacker,
            spell: u.spell,
            x: u.x / 65536,
            y: u.y / 65536,
            useS: u.use_ticks * (TICK_MS / 1000),
            contactS: u.contact_ticks * (TICK_MS / 1000),
            at: now,
          });
        }
        for (const s of d.skills) {
          this.pendingSkills.push({
            attacker: s.attacker,
            spell: s.spell,
            shape: s.shape,
            x: s.x / 65536,
            y: s.y / 65536,
            dx: s.dx / 65536,
            dy: s.dy / 65536,
            radius: s.radius / 65536,
            range: s.range / 65536,
            dmgType: s.dmg_type,
            at: now,
          });
        }
        this.version++;
        break;
      }
      case "Events": {
        for (const ev of msg.data.events) this.narrate(ev);
        this.version++;
        break;
      }
      case "CharacterSheet": {
        this.sheet = msg.data.sheet;
        this.version++;
        break;
      }
      case "DirectorCue": {
        const d = msg.data;
        this.cue = {
          focus: d.focus,
          reason: d.reason,
          holdTicks: d.hold_ticks,
          at: performance.now(),
        };
        this.version++;
        break;
      }
      case "FocusQueue": {
        this.focusQueue = msg.data.entries;
        this.version++;
        break;
      }
      default:
        break;
    }
  }

  /** Renderer drains hits once per frame. */
  drainHits(): ActiveHit[] {
    if (this.pendingHits.length === 0) return [];
    const out = this.pendingHits;
    this.pendingHits = [];
    return out;
  }

  /** Renderer drains projectile launches once per frame. */
  drainProjectiles(): ActiveProjectile[] {
    if (this.pendingProjectiles.length === 0) return [];
    const out = this.pendingProjectiles;
    this.pendingProjectiles = [];
    return out;
  }

  /** Renderer drains skill uses once per frame. */
  drainSkills(): ActiveSkill[] {
    if (this.pendingSkills.length === 0) return [];
    const out = this.pendingSkills;
    this.pendingSkills = [];
    return out;
  }

  /** Renderer drains use-starts (windups) once per frame. */
  drainUses(): ActiveUse[] {
    if (this.pendingUses.length === 0) return [];
    const out = this.pendingUses;
    this.pendingUses = [];
    return out;
  }

  /** Interpolated render position (sim units). */
  renderPos(er: EntityRender, now: number): { x: number; y: number } {
    const a = Math.min(1, (now - er.movedAt) / TICK_MS);
    return {
      x: er.prevX + (er.currX - er.prevX) * a,
      y: er.prevY + (er.currY - er.prevY) * a,
    };
  }

  characters(): EntityRender[] {
    return [...this.entities.values()].filter((e) => e.state.kind === "Character");
  }

  private upsert(e: EntityState, now: number): void {
    const x = e.x / 65536;
    const y = e.y / 65536;
    const existing = this.entities.get(e.id);
    if (existing) {
      existing.state = e;
      existing.prevX = existing.currX;
      existing.prevY = existing.currY;
      existing.currX = x;
      existing.currY = y;
      existing.movedAt = now;
    } else {
      this.entities.set(e.id, {
        state: e,
        prevX: x,
        prevY: y,
        currX: x,
        currY: y,
        movedAt: now,
      });
    }
  }

  private narrate(ev: GameEvent): void {
    const push = (text: string, color: string) => {
      this.ticker.push({ text, color, at: performance.now(), key: this.tickerKey++ });
      if (this.ticker.length > 24) this.ticker.splice(0, this.ticker.length - 24);
    };
    switch (ev.type) {
      case "CharacterJoined":
        push(`⚔ ${ev.data.name} arrives on the shore`, "#9a7bff");
        break;
      case "CharacterDied":
        push(`☠ ${ev.data.name} was slain by ${ev.data.killer}`, "#ff6a6a");
        break;
      case "CharacterRespawned": {
        const name = this.entities.get(ev.data.id)?.state.name ?? "someone";
        push(`✚ ${name} returns to the fight`, "#7bff9a");
        break;
      }
      case "GateChanged": {
        const d = ev.data;
        const gate = this.zone?.gates.find(
          (g) => g.x0 === d.x0 && g.y0 === d.y0 && g.x1 === d.x1 && g.y1 === d.y1,
        );
        if (gate) gate.open = d.open;
        push(d.open ? "◈ A gate lifts" : "◈ A gate falls", "#e0b75e");
        break;
      }
      case "ExitChanged": {
        // Flip the matching portal's state in place (snapshots carry the
        // full list; this keeps live viewers current between them).
        const ex = ev.data.x / 65536;
        const ey = ev.data.y / 65536;
        const exit = this.zone?.exits.find(
          (e) => Math.abs(e.x - ex) < 0.01 && Math.abs(e.y - ey) < 0.01,
        );
        if (exit) exit.open = ev.data.open;
        push(ev.data.open ? "◈ A way forward opens" : "◈ A way forward closes", "#6fe3c1");
        break;
      }
      case "LevelUp":
        push(`★ ${ev.data.name} reached level ${ev.data.level}`, "#ffd75a");
        break;
      case "MonsterKilled":
        push(`${ev.data.killer} slays a ${ev.data.monster}`, "#8a8aa0");
        break;
      case "LootDropped":
        if (ev.data.rarity >= 1) {
          push(
            `✦ ${ev.data.item} (${RARITY_NAMES[ev.data.rarity]}) drops for ${ev.data.owner}`,
            RARITY_COLORS[ev.data.rarity],
          );
        }
        break;
      case "ItemPickedUp":
        if (ev.data.rarity >= 2) {
          push(
            `${ev.data.owner} claims ${ev.data.item} (${RARITY_NAMES[ev.data.rarity]})`,
            RARITY_COLORS[ev.data.rarity],
          );
        }
        break;
      case "PassiveAllocated":
        push(`◈ ${ev.data.owner} learns ${ev.data.node}`, "#9a7bff");
        break;
      case "BuildRejected":
        push(`⚠ ${ev.data.owner}'s build rejected: ${ev.data.reason}`, "#ffb36a");
        break;
      case "BuildDeclared":
        push(`◈ ${ev.data.owner} declares a build (${ev.data.nodes} nodes)`, "#9a7bff");
        break;
      case "GemSocketed":
        push(`◇ ${ev.data.owner} sockets ${ev.data.gem}`, "#5adfdf");
        break;
      case "Narration":
        push(`✦ ${ev.data.text}`, "#d8c89a");
        break;
      case "Speech":
        this.speech.set(ev.data.id, { text: ev.data.text, at: performance.now() });
        break;
      case "CharacterDeparted":
        push(`⇧ ${ev.data.name} leaves for ${ev.data.dest}`, "#9a7bff");
        break;
      case "CurrencyUsed":
        push(`✶ ${ev.data.owner}'s ${ev.data.currency} reshapes ${ev.data.item}`, "#ffd75a");
        break;
      case "GemRejected":
        push(
          `⚠ ${ev.data.gem} refuses ${ev.data.owner}'s ${ev.data.skill} (wrong tags)`,
          "#ffb36a",
        );
        break;
      case "GemLevelUp":
        push(`◆ ${ev.data.owner}'s ${ev.data.gem} is now level ${ev.data.level}`, "#5adfdf");
        break;
      case "ItemEquipped":
        push(
          `⚙ ${ev.data.owner} equips ${ev.data.item}${ev.data.rarity >= 1 ? ` (${RARITY_NAMES[ev.data.rarity]})` : ""}`,
          RARITY_COLORS[ev.data.rarity],
        );
        break;
    }
  }
}
