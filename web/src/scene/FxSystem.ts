import * as THREE from "three";
import type { ActiveHit, ActiveProjectile, ActiveSkill } from "../world/store";

/** Damage-number colors by dominant component:
 *  phys, fire, cold, lightning, chaos. */
const DMG_COLORS = ["#ffe9c8", "#ff8a5a", "#6ab8e8", "#ffe96a", "#c08aff"];
const PROJ_COLORS = [0xffe9c8, 0xff8a5a, 0x6ab8e8, 0xffe96a, 0xc08aff];
const MISS_COLOR = "#8a8a99";

const FLASH_POOL = 48;
const TRACER_POOL = 32;
const NUMBER_POOL = 48;
const SHAPE_POOL = 16;

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

interface ShapeFx {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  /** 1 nova/point-AoE ring, 2 cone sector, 3 line corridor. */
  kind: number;
  /** Final footprint (ring radius / sector reach / corridor length). */
  size: number;
  /** Corridor width (lines only). */
  width: number;
  bornAt: number;
  ttlMs: number;
  active: boolean;
}

/** Flat-on-the-ground ring (open annulus) lying in XZ, unit radius. */
function ringGeo(): THREE.BufferGeometry {
  return new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
}

/** Filled ~90° sector in XZ opening along +X, unit reach. */
function sectorGeo(): THREE.BufferGeometry {
  // CircleGeometry spans thetaStart..+thetaLength in XY from +X; lay it flat.
  return new THREE.CircleGeometry(1, 24, -Math.PI / 4, Math.PI / 2).rotateX(-Math.PI / 2);
}

/** Unit square in XZ centered at (0.5, 0): scaled to (length, width). */
function corridorGeo(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
}

/**
 * Combat feedback: impact flashes, traveling projectile tracers, floating
 * damage numbers, and skill-shape telegraphs (rings/cones/lines). Everything
 * is pooled — pools are allocated lazily up to a cap and reused forever; a
 * hit beyond the cap is simply skipped. Nothing here grows with session
 * length.
 */
export class FxSystem {
  private flashes: Flash[] = [];
  private tracers: Tracer[] = [];
  private numbers: DamageNumber[] = [];
  private shapes: ShapeFx[] = [];
  private glowTex: THREE.Texture;
  private ringGeo = ringGeo();
  private sectorGeo = sectorGeo();
  private corridorGeo = corridorGeo();

  constructor(private scene: THREE.Scene, glowTex: THREE.Texture) {
    this.glowTex = glowTex;
  }

  spawnHit(hit: ActiveHit, to: THREE.Vector3, now: number): void {
    if (!hit.dot) {
      this.spawnFlash(
        to,
        hit.killed ? 0xff5a5a : 0xfff0c0,
        hit.killed ? 1.6 : 0.7,
        now,
        hit.killed ? 320 : 140,
      );
    }
    const color = DMG_COLORS[hit.dmgType] ?? DMG_COLORS[0];
    if (hit.amount > 0) {
      // Crits read loud; dot burns read quiet and steady.
      const text = hit.crit ? `${hit.amount}!` : String(hit.amount);
      this.spawnNumber(to, text, hit.dot ? `${color}b0` : color, hit.crit || hit.killed, now);
    } else if (!hit.dot) {
      this.spawnNumber(to, "miss", MISS_COLOR, false, now);
    }
  }

  /**
   * A non-projectile skill use: draw the shape where the sim resolved it.
   * Strikes (shape 0) get a small flash; rings expand; sweeps flare and fade.
   */
  spawnSkill(s: ActiveSkill, groundY: (x: number, z: number) => number, now: number): void {
    const color = PROJ_COLORS[s.dmgType] ?? PROJ_COLORS[0];
    const at = new THREE.Vector3(s.x, groundY(s.x, s.y) + 0.06, s.y);
    if (s.shape === 0) {
      this.spawnFlash(at, color, 0.6, now, 160);
      return;
    }
    let sh = this.shapes.find((f) => !f.active);
    if (!sh) {
      if (this.shapes.length >= SHAPE_POOL) return;
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      sh = { mesh, mat, kind: 1, size: 1, width: 1, bornAt: 0, ttlMs: 0, active: false };
      this.shapes.push(sh);
    }
    const ring = s.shape === 1 || s.shape === 4;
    sh.kind = ring ? 1 : s.shape;
    sh.mesh.geometry = ring ? this.ringGeo : s.shape === 2 ? this.sectorGeo : this.corridorGeo;
    sh.size = ring ? Math.max(0.4, s.radius) : Math.max(0.6, s.range);
    sh.width = Math.max(0.3, s.radius); // lines carry their width here
    sh.bornAt = now;
    sh.ttlMs = ring ? 420 : 360;
    sh.active = true;
    sh.mat.color.setHex(color);
    sh.mat.opacity = 0.55;
    sh.mesh.visible = true;
    sh.mesh.position.copy(at);
    // Open along the aim direction (rings don't care, but it's harmless).
    sh.mesh.rotation.set(0, Math.atan2(-s.dy, s.dx), 0);
    if (s.shape === 4) this.spawnFlash(at, color, 1.1, now, 240);
    this.applyShape(sh, 0);
  }

  /** A sim-spawned projectile: animate its real flight path. */
  spawnProjectile(p: ActiveProjectile, groundY: (x: number, z: number) => number, now: number): void {
    const speed = Math.hypot(p.vx, p.vy); // units per tick
    if (speed <= 0) return;
    const flightMs = (p.range / speed) * 100; // ticks → ms
    const from = new THREE.Vector3(p.x, groundY(p.x, p.y) + 1.2, p.y);
    const to = new THREE.Vector3(
      p.x + (p.vx / speed) * p.range,
      groundY(p.x + (p.vx / speed) * p.range, p.y + (p.vy / speed) * p.range) + 1.0,
      p.y + (p.vy / speed) * p.range,
    );
    this.spawnTracer(from, to, now, Math.min(flightMs, 2500), PROJ_COLORS[p.dmgType] ?? 0xffc06a);
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

  private spawnTracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    now: number,
    flightMs?: number,
    color?: number,
  ): void {
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
    t.to.copy(to);
    t.flightMs = flightMs ?? Math.min(220, Math.max(90, t.from.distanceTo(t.to) * 22));
    t.mat.color.setHex(color ?? 0xffc06a);
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

  private applyShape(sh: ShapeFx, a: number): void {
    if (sh.kind === 1) {
      // Ring expands outward and thins.
      const r = sh.size * (0.35 + 0.65 * Math.min(1, a * 1.6));
      sh.mesh.scale.set(r, 1, r);
    } else if (sh.kind === 2) {
      // Sector flares to full reach almost immediately.
      const r = sh.size * Math.min(1, 0.7 + a * 2);
      sh.mesh.scale.set(r, 1, r);
    } else {
      // Corridor: full length at once, width carried separately.
      sh.mesh.scale.set(sh.size, 1, sh.width);
    }
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
    for (const sh of this.shapes) {
      if (!sh.active) continue;
      const a = (now - sh.bornAt) / sh.ttlMs;
      if (a >= 1) {
        sh.active = false;
        sh.mesh.visible = false;
        continue;
      }
      this.applyShape(sh, a);
      sh.mat.opacity = 0.55 * (1 - a * a);
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
    for (const sh of this.shapes) {
      sh.mesh.removeFromParent();
      sh.mat.dispose();
    }
    this.ringGeo.dispose();
    this.sectorGeo.dispose();
    this.corridorGeo.dispose();
    this.flashes = [];
    this.tracers = [];
    this.numbers = [];
    this.shapes = [];
  }
}
