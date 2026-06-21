import type { S2C } from "../gen/S2C";
import type { CharacterSheet } from "../gen/CharacterSheet";
import type { EntityState } from "../gen/EntityState";
import type { FocusQueueEntry } from "../gen/FocusQueueEntry";
import type { GameEvent } from "../gen/GameEvent";
import type { TileMapState } from "../gen/TileMapState";
import { TICK_MS, FX_SCALE, RARITY_NAMES, RARITY_COLORS } from "../gen/constants";

/** Playout delay in ticks: jitter up to ~this much arrives invisibly.
 *  ~220 ms of display latency — meaningless for a spectator feed. */
const PLAYOUT_DELAY_TICKS = 2.2;

export interface EntityRender {
  state: EntityState;
  prevX: number;
  prevY: number;
  /** Latest authoritative position (sim units) — game logic reads these. */
  currX: number;
  currY: number;
  movedAt: number; // performance.now() when curr was set
  /** Server-tick-stamped positions for the playout buffer (render path). */
  samples: { tick: number; x: number; y: number }[];
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
  /** The hit staggered (windup broken, brief lock); cold stuns FREEZE. */
  stun: boolean;
  freeze: boolean;
  /** Server tick this landed — released by the playout clock. */
  tick: number;
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
  tick: number;
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
  tick: number;
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
  tick: number;
  at: number;
}

export interface Cue {
  focus: number;
  reason: string;
  holdTicks: number;
  at: number;
}


/**
 * Client-side mirror of the replicated zone. The renderer reads it every
 * frame; React polls it via `version`.
 */
export class WorldStore {
  entities = new Map<number, EntityRender>();
  zone: {
    name: string;
    /** Area level: the mob-scaling floor. */
    level: number;
    /** Explicit world identity ("withered_shore#Kargan"). */
    worldKey: string;
    width: number;
    height: number;
    tiles: TileMapState | null;
    exits: { x: number; y: number; open: boolean }[];
    gates: { x0: number; y0: number; x1: number; y1: number; open: boolean }[];
  } | null = null;
  tick = 0;
  /** The PLAYOUT clock: rendering runs this many ticks behind the newest
   *  delta, absorbing network jitter (bursty arrivals otherwise starve
   *  the renderer, then dump a pile — visible stagger). Positions AND
   *  combat events ride the same delayed clock, so #10's contact sync
   *  survives buffering untouched. */
  renderTick = 0;
  private lastClockAt = 0;
  /** Bumps on every ZoneSnapshot: a snapshot is a FULL state reset, and
   *  the renderer must drop per-entity visuals (net ids are per-world). */
  snapshotGen = 0;
  ticker: TickerItem[] = [];
  pendingHits: ActiveHit[] = [];
  pendingProjectiles: ActiveProjectile[] = [];
  pendingSkills: ActiveSkill[] = [];
  pendingUses: ActiveUse[] = [];
  /** #94 Part B: per `${attacker}:${socketKey}` monotonic fire counter, bumped
   *  when that skill's use begins. The HUD keys its card pulse on this, so a new
   *  count replays the flash. Cleared on `ZoneSnapshot` and pruned when an entity
   *  is removed, so a reused net id can't inherit a stale count and false-flash a
   *  card that never fired. (Multiple fires of the SAME skill landing between the
   *  overlay's polls coalesce into one flash — acceptable for a sub-second
   *  flourish; the flash is feedback, not an exact fire count.) */
  skillFires = new Map<string, number>();
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
          level: d.zone_level ?? 1,
          worldKey: d.world_key ?? "",
          width: d.width / FX_SCALE,
          height: d.height / FX_SCALE,
          tiles: d.tiles ?? null,
          exits: (d.exits ?? []).map((e) => ({
            x: e.x / FX_SCALE,
            y: e.y / FX_SCALE,
            open: e.open,
          })),
          gates: (d.gates ?? []).map((g) => ({ ...g })),
        };
        this.tick = d.tick;
        this.renderTick = d.tick - PLAYOUT_DELAY_TICKS;
        this.snapshotGen++;
        this.entities.clear();
        // A fresh world view: drop fire counters so a net id reused in the new
        // world can't inherit a stale count and false-flash a card (#94 Part B).
        this.skillFires.clear();
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
          er.currX = m.x / FX_SCALE;
          er.currY = m.y / FX_SCALE;
          er.movedAt = now;
          er.state.x = m.x;
          er.state.y = m.y;
          er.samples.push({ tick: d.tick, x: er.currX, y: er.currY });
          if (er.samples.length > 10) er.samples.shift();
        }
        for (const u of d.updated) {
          const er = this.entities.get(u.id);
          if (!er) continue;
          er.state.life_pct = u.life_pct;
          er.state.es_pct = u.es_pct;
          er.state.level = u.level;
          er.state.dead = u.dead;
          er.state.kills = u.kills;
          er.state.items = u.items;
          er.state.weapon = u.weapon;
          er.state.weapon_rarity = u.weapon_rarity;
          er.state.gear = u.gear;
          er.state.gear_rarity = u.gear_rarity;
        }
        for (const id of d.removed) {
          this.entities.delete(id);
          // Drop the removed entity's fire counters so a later spawn reusing this
          // net id starts clean — and the map stays bounded to live entities.
          const prefix = `${id}:`;
          for (const k of this.skillFires.keys()) {
            if (k.startsWith(prefix)) this.skillFires.delete(k);
          }
        }
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
            stun: h.stun ?? false,
            freeze: h.freeze ?? false,
            tick: d.tick,
            at: now,
          });
        }
        for (const p of d.projectiles) {
          this.pendingProjectiles.push({
            attacker: p.attacker,
            spell: p.spell,
            x: p.x / FX_SCALE,
            y: p.y / FX_SCALE,
            vx: p.vx / FX_SCALE,
            vy: p.vy / FX_SCALE,
            range: p.range / FX_SCALE,
            dmgType: p.dmg_type,
            tick: d.tick,
            at: now,
          });
        }
        for (const u of d.uses ?? []) {
          this.pendingUses.push({
            attacker: u.attacker,
            spell: u.spell,
            x: u.x / FX_SCALE,
            y: u.y / FX_SCALE,
            useS: u.use_ticks * (TICK_MS / 1000),
            contactS: u.contact_ticks * (TICK_MS / 1000),
            tick: d.tick,
            at: now,
          });
          // #94 Part B: a socketed-skill use (slot >= 0; basic attacks are -1)
          // bumps the per-skill fire counter the focus panel pulses on.
          if (u.slot >= 0) {
            const k = `${u.attacker}:${u.slot}`;
            this.skillFires.set(k, (this.skillFires.get(k) ?? 0) + 1);
          }
        }
        for (const s of d.skills) {
          this.pendingSkills.push({
            attacker: s.attacker,
            spell: s.spell,
            shape: s.shape,
            x: s.x / FX_SCALE,
            y: s.y / FX_SCALE,
            dx: s.dx / FX_SCALE,
            dy: s.dy / FX_SCALE,
            radius: s.radius / FX_SCALE,
            range: s.range / FX_SCALE,
            dmgType: s.dmg_type,
            tick: d.tick,
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
    const due: ActiveHit[] = [];
    const later: ActiveHit[] = [];
    for (const e of this.pendingHits) {
      (e.tick <= this.renderTick ? due : later).push(e);
    }
    this.pendingHits = later;
    return due;
  }

  /** Renderer drains projectile launches once per frame. */
  drainProjectiles(): ActiveProjectile[] {
    if (this.pendingProjectiles.length === 0) return [];
    const due: ActiveProjectile[] = [];
    const later: ActiveProjectile[] = [];
    for (const e of this.pendingProjectiles) {
      (e.tick <= this.renderTick ? due : later).push(e);
    }
    this.pendingProjectiles = later;
    return due;
  }

  /** #94 Part B: how many times `attacker` has fired the skill at socket `slot`.
   *  The focus panel keys each card's fire pulse on this — a new value replays the
   *  flash. Monotonic, never drained (it's a counter, not a queue). */
  skillFireCount(attacker: number, slot: number): number {
    return this.skillFires.get(`${attacker}:${slot}`) ?? 0;
  }

  /** Renderer drains skill uses once per frame. */
  drainSkills(): ActiveSkill[] {
    if (this.pendingSkills.length === 0) return [];
    const due: ActiveSkill[] = [];
    const later: ActiveSkill[] = [];
    for (const e of this.pendingSkills) {
      (e.tick <= this.renderTick ? due : later).push(e);
    }
    this.pendingSkills = later;
    return due;
  }

  /** Renderer drains use-starts (windups) once per frame. */
  drainUses(): ActiveUse[] {
    if (this.pendingUses.length === 0) return [];
    const due: ActiveUse[] = [];
    const later: ActiveUse[] = [];
    for (const e of this.pendingUses) {
      (e.tick <= this.renderTick ? due : later).push(e);
    }
    this.pendingUses = later;
    return due;
  }

  /** Advance the playout clock: call ONCE per rendered frame. Runs at
   *  tick rate by wall clock, slewing gently toward (newest − delay) so
   *  arrival jitter bends the clock instead of snapping positions. */
  advanceClock(now: number): void {
    if (this.lastClockAt === 0) this.lastClockAt = now;
    const dt = Math.min(0.25, (now - this.lastClockAt) / 1000);
    this.lastClockAt = now;
    const target = this.tick - PLAYOUT_DELAY_TICKS;
    const err = target - this.renderTick;
    if (Math.abs(err) > 8) {
      this.renderTick = target; // way off (stall/teleport): snap
    } else {
      // Free-run at 10 ticks/s, plus a gentle pull toward the target.
      this.renderTick += dt * 10 + err * Math.min(1, dt * 2.5);
    }
    // Never render ahead of what the server has shown us.
    this.renderTick = Math.min(this.renderTick, this.tick);
  }

  /** Buffered render position (sim units): interpolates the entity's
   *  sample timeline at the playout clock. */
  renderPos(er: EntityRender, _now: number): { x: number; y: number } {
    const ss = er.samples;
    if (ss.length === 0) return { x: er.currX, y: er.currY };
    if (this.renderTick >= ss[ss.length - 1].tick) {
      const last = ss[ss.length - 1];
      return { x: last.x, y: last.y };
    }
    for (let i = ss.length - 1; i > 0; i--) {
      const b = ss[i];
      const a = ss[i - 1];
      if (this.renderTick >= a.tick && this.renderTick <= b.tick) {
        const span = b.tick - a.tick;
        const f = span > 0 ? (this.renderTick - a.tick) / span : 1;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return { x: ss[0].x, y: ss[0].y };
  }

  characters(): EntityRender[] {
    return [...this.entities.values()].filter((e) => e.state.kind === "Character");
  }

  private upsert(e: EntityState, now: number): void {
    const x = e.x / FX_SCALE;
    const y = e.y / FX_SCALE;
    const existing = this.entities.get(e.id);
    if (existing) {
      existing.state = e;
      existing.prevX = existing.currX;
      existing.prevY = existing.currY;
      existing.currX = x;
      existing.currY = y;
      existing.movedAt = now;
      existing.samples.push({ tick: this.tick, x, y });
      if (existing.samples.length > 10) existing.samples.shift();
    } else {
      this.entities.set(e.id, {
        state: e,
        prevX: x,
        prevY: y,
        currX: x,
        currY: y,
        movedAt: now,
        samples: [{ tick: this.tick, x, y }],
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
        const ex = ev.data.x / FX_SCALE;
        const ey = ev.data.y / FX_SCALE;
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
      case "TreeRespecced":
        push(`✶ ${ev.data.owner} pays their regret — the tree re-walks`, "#ffd75a");
        break;
      case "GearShed":
        push(`⚠ ${ev.data.owner} can no longer wield ${ev.data.item}`, "#ffb36a");
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
