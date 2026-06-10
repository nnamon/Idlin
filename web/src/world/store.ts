import type { S2C } from "../gen/S2C";
import type { EntityState } from "../gen/EntityState";
import type { GameEvent } from "../gen/GameEvent";

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
  projectile: boolean;
  killed: boolean;
  at: number;
}

export interface Cue {
  focus: number;
  reason: string;
  holdTicks: number;
  at: number;
}

const RARITY_NAMES = ["common", "magic", "rare", "UNIQUE"];
const RARITY_COLORS = ["#bfbfbf", "#5a8aff", "#ffd75a", "#ff9a3c"];

/**
 * Client-side mirror of the replicated zone. The renderer reads it every
 * frame; React polls it via `version`.
 */
export class WorldStore {
  entities = new Map<number, EntityRender>();
  zone: { name: string; width: number; height: number } | null = null;
  tick = 0;
  ticker: TickerItem[] = [];
  pendingHits: ActiveHit[] = [];
  cue: Cue | null = null;
  version = 0;
  private tickerKey = 0;

  handle(msg: S2C): void {
    switch (msg.type) {
      case "ZoneSnapshot": {
        const d = msg.data;
        this.zone = { name: d.zone_name, width: d.width / 65536, height: d.height / 65536 };
        this.tick = d.tick;
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
        }
        for (const id of d.removed) this.entities.delete(id);
        for (const h of d.hits) {
          this.pendingHits.push({
            attacker: h.attacker,
            target: h.target,
            projectile: h.projectile,
            killed: h.killed,
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
        push(`⚔ ${ev.data.name} the ${ev.data.class} arrives`, "#9a7bff");
        break;
      case "CharacterDied":
        push(`☠ ${ev.data.name} was slain by ${ev.data.killer}`, "#ff6a6a");
        break;
      case "CharacterRespawned": {
        const name = this.entities.get(ev.data.id)?.state.name ?? "someone";
        push(`✚ ${name} returns to the fight`, "#7bff9a");
        break;
      }
      case "LevelUp":
        push(`★ ${ev.data.name} reached level ${ev.data.level}`, "#ffd75a");
        break;
      case "MonsterKilled":
        push(`${ev.data.killer} slays a ${ev.data.monster}`, "#8a8aa0");
        break;
      case "LootDropped":
        if (ev.data.rarity >= 2) {
          push(
            `✦ a ${RARITY_NAMES[ev.data.rarity]} item drops for ${ev.data.owner}`,
            RARITY_COLORS[ev.data.rarity],
          );
        }
        break;
      case "ItemPickedUp":
        if (ev.data.rarity >= 2) {
          push(
            `${ev.data.owner} claims a ${RARITY_NAMES[ev.data.rarity]} item`,
            RARITY_COLORS[ev.data.rarity],
          );
        }
        break;
    }
  }
}
