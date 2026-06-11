import * as THREE from "three";
import type { ActiveHit } from "../world/store";

/** Damage-number colors by dominant component: phys, elemental, chaos. */
const DMG_COLORS = ["#ffe9c8", "#6ae8e8", "#c08aff"];
const MISS_COLOR = "#8a8a99";

const FLASH_POOL = 48;
const TRACER_POOL = 32;
const NUMBER_POOL = 48;

interface Flash {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  bornAt: number;
  ttlMs: number;
  active: boolean;
}

interface Tracer {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  bornAt: number;
  flightMs: number;
  active: boolean;
}

interface DamageNumber {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  baseY: number;
  driftX: number;
  bornAt: number;
  ttlMs: number;
  big: boolean;
  active: boolean;
}

/**
 * Combat feedback: impact flashes, traveling projectile tracers, and floating
 * damage numbers. Everything is pooled — pools are allocated lazily up to a
 * cap and reused forever; a hit beyond the cap is simply skipped. Nothing
 * here grows with session length.
 */
export class FxSystem {
  private flashes: Flash[] = [];
  private tracers: Tracer[] = [];
  private numbers: DamageNumber[] = [];
  private glowTex: THREE.Texture;

  constructor(private scene: THREE.Scene, glowTex: THREE.Texture) {
    this.glowTex = glowTex;
  }

  spawnHit(hit: ActiveHit, from: THREE.Vector3 | null, to: THREE.Vector3, now: number): void {
    if (hit.projectile && from) {
      this.spawnTracer(from, to, now);
    }
    this.spawnFlash(to, hit.killed ? 0xff5a5a : 0xfff0c0, hit.killed ? 1.6 : 0.7, now, hit.killed ? 320 : 140);
    if (hit.amount > 0) {
      this.spawnNumber(to, String(hit.amount), DMG_COLORS[hit.dmgType] ?? DMG_COLORS[0], hit.killed, now);
    } else {
      this.spawnNumber(to, "miss", MISS_COLOR, false, now);
    }
  }

  private spawnFlash(at: THREE.Vector3, color: number, scale: number, now: number, ttlMs: number): void {
    let f = this.flashes.find((f) => !f.active);
    if (!f) {
      if (this.flashes.length >= FLASH_POOL) return;
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex,
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      f = { sprite: new THREE.Sprite(mat), mat, bornAt: 0, ttlMs: 0, active: false };
      this.scene.add(f.sprite);
      this.flashes.push(f);
    }
    f.active = true;
    f.bornAt = now;
    f.ttlMs = ttlMs;
    f.mat.color.setHex(color);
    f.mat.opacity = 0.9;
    f.sprite.visible = true;
    f.sprite.scale.set(scale, scale, 1);
    f.sprite.position.copy(at);
    f.sprite.position.y += 1.1;
  }

  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, now: number): void {
    let t = this.tracers.find((t) => !t.active);
    if (!t) {
      if (this.tracers.length >= TRACER_POOL) return;
      const mat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: 0xffc06a,
        transparent: true,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      });
      t = {
        sprite: new THREE.Sprite(mat),
        mat,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        bornAt: 0,
        flightMs: 0,
        active: false,
      };
      t.sprite.scale.set(0.28, 0.28, 1);
      this.scene.add(t.sprite);
      this.tracers.push(t);
    }
    t.active = true;
    t.bornAt = now;
    t.from.copy(from);
    t.from.y += 1.3;
    t.to.copy(to);
    t.to.y += 1.0;
    t.flightMs = Math.min(220, Math.max(90, t.from.distanceTo(t.to) * 22));
    t.mat.opacity = 1;
    t.sprite.visible = true;
    t.sprite.position.copy(t.from);
  }

  private spawnNumber(at: THREE.Vector3, text: string, color: string, big: boolean, now: number): void {
    let n = this.numbers.find((n) => !n.active);
    if (!n) {
      if (this.numbers.length >= NUMBER_POOL) return;
      const canvas = document.createElement("canvas");
      canvas.width = 192;
      canvas.height = 80;
      const ctx = canvas.getContext("2d")!;
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      n = {
        sprite: new THREE.Sprite(mat),
        mat,
        tex,
        canvas,
        ctx,
        baseY: 0,
        driftX: 0,
        bornAt: 0,
        ttlMs: 0,
        big: false,
        active: false,
      };
      n.sprite.renderOrder = 2;
      this.scene.add(n.sprite);
      this.numbers.push(n);
    }
    const { ctx, canvas } = n;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${big ? 58 : 44}px "Anton SC", "Cinzel", sans-serif`;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(text, 96, 58);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    n.tex.needsUpdate = true;

    n.active = true;
    n.bornAt = now;
    n.ttlMs = big ? 950 : 750;
    n.big = big;
    n.baseY = at.y + 1.7;
    n.driftX = (Math.random() - 0.5) * 0.7;
    n.mat.opacity = 1;
    n.sprite.visible = true;
    const s = big ? 1.5 : 1.05;
    n.sprite.scale.set(2.4 * s * (192 / 160), s, 1);
    n.sprite.position.copy(at).setY(n.baseY);
    n.sprite.position.x += n.driftX * 0.2;
  }

  update(now: number): void {
    for (const f of this.flashes) {
      if (!f.active) continue;
      const age = (now - f.bornAt) / f.ttlMs;
      if (age >= 1) {
        f.active = false;
        f.sprite.visible = false;
        continue;
      }
      f.mat.opacity = 0.9 * (1 - age);
    }
    for (const t of this.tracers) {
      if (!t.active) continue;
      const a = (now - t.bornAt) / t.flightMs;
      if (a >= 1) {
        t.active = false;
        t.sprite.visible = false;
        continue;
      }
      t.sprite.position.lerpVectors(t.from, t.to, a);
      t.sprite.position.y += Math.sin(a * Math.PI) * 0.35; // slight arc
    }
    for (const n of this.numbers) {
      if (!n.active) continue;
      const a = (now - n.bornAt) / n.ttlMs;
      if (a >= 1) {
        n.active = false;
        n.sprite.visible = false;
        continue;
      }
      n.sprite.position.y = n.baseY + a * (n.big ? 1.5 : 1.1);
      n.sprite.position.x += n.driftX * 0.004;
      n.mat.opacity = a < 0.55 ? 1 : 1 - (a - 0.55) / 0.45;
      // A quick settle-pop on arrival, then steady.
      const pop = a < 0.14 ? 1.28 - (a / 0.14) * 0.28 : 1;
      const s = (n.big ? 1.5 : 1.05) * pop;
      n.sprite.scale.set(2.4 * s * (192 / 160), s, 1);
    }
  }

  dispose(): void {
    for (const f of this.flashes) {
      f.sprite.removeFromParent();
      f.mat.dispose();
    }
    for (const t of this.tracers) {
      t.sprite.removeFromParent();
      t.mat.dispose();
    }
    for (const n of this.numbers) {
      n.sprite.removeFromParent();
      n.tex.dispose();
      n.mat.dispose();
    }
    this.flashes = [];
    this.tracers = [];
    this.numbers = [];
  }
}
