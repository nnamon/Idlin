import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
const LIGHT_POOL = 4;
const BURST_POOL = 8;
const BURST_SPRITES = 12;

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
  /** Comet tail: a crossed-quad beam trailing the head. */
  trail: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
  from: THREE.Vector3;
  to: THREE.Vector3;
  bornAt: number;
  flightMs: number;
  active: boolean;
  /** Who fired it — server hits terminate the matching visual. */
  attacker: number;
}

interface DamageNumber {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  baseY: number;
  driftX: number;
  /** Magnitude-set scale; the settle-pop multiplies it per frame. */
  baseS: number;
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

/** A kill burst: a clutch of glow shards flying outward from the corpse. */
interface Burst {
  sprites: THREE.Sprite[];
  mats: THREE.SpriteMaterial[];
  vels: THREE.Vector3[];
  origin: THREE.Vector3;
  bornAt: number;
  ttlMs: number;
  active: boolean;
}

/** A brief point light so big skills illuminate the night around them. */
interface SkillLight {
  light: THREE.PointLight;
  bornAt: number;
  ttlMs: number;
  peak: number;
  active: boolean;
}

// ---- canvas-baked gradient textures (built once, tinted per use) ----

/** Radial band: transparent center, hot ring at ~85% radius, soft edges. */
function ringBandTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.0, "rgba(255,255,255,0)");
  g.addColorStop(0.62, "rgba(255,255,255,0.04)");
  g.addColorStop(0.8, "rgba(255,255,255,0.55)");
  g.addColorStop(0.88, "rgba(255,255,255,1)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Hot at the apex (center of UV space), fading out to the rim. */
function apexTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.6)");
  g.addColorStop(0.8, "rgba(255,255,255,0.18)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Beam strip: hot core line along the length, soft sides, tapered tip. */
function beamTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const across = ctx.createLinearGradient(0, 0, 0, 64);
  across.addColorStop(0.0, "rgba(255,255,255,0)");
  across.addColorStop(0.42, "rgba(255,255,255,0.85)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(0.58, "rgba(255,255,255,0.85)");
  across.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 256, 64);
  const along = ctx.createLinearGradient(0, 0, 256, 0);
  along.addColorStop(0.0, "rgba(255,255,255,0.35)");
  along.addColorStop(0.12, "rgba(255,255,255,1)");
  along.addColorStop(0.85, "rgba(255,255,255,1)");
  along.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 256, 64);
  return new THREE.CanvasTexture(c);
}

// ---- geometries (unit-sized, scaled per use) ----

/** Flat unit disc in XZ; the ring-band texture turns it into a ring. */
function discGeo(): THREE.BufferGeometry {
  return new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
}

/** Filled ~90° sector in XZ opening along +X, unit reach. */
function sectorGeo(): THREE.BufferGeometry {
  // CircleGeometry spans thetaStart..+thetaLength in XY from +X; lay it flat.
  return new THREE.CircleGeometry(1, 24, -Math.PI / 4, Math.PI / 2).rotateX(-Math.PI / 2);
}

/**
 * Corridor: a flat quad on the ground PLUS a vertical ribbon, crossed, so
 * the beam reads at the low camera angle. Spans x 0..1; scaled to
 * (length, 1, width); the ribbon stays a constant ~0.7 u tall.
 */
function corridorGeo(): THREE.BufferGeometry {
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0.02, 0);
  const upright = new THREE.PlaneGeometry(1, 0.7).translate(0.5, 0.35, 0);
  return mergeGeometries([flat, upright]);
}

/** Centered crossed quads for projectile comet tails (length along X). */
function trailGeo(): THREE.BufferGeometry {
  const flat = new THREE.PlaneGeometry(1, 0.22).rotateX(-Math.PI / 2);
  const upright = new THREE.PlaneGeometry(1, 0.22);
  return mergeGeometries([flat, upright]);
}

function easeOutCubic(a: number): number {
  return 1 - (1 - a) ** 3;
}

/**
 * Combat feedback: impact flashes, traveling projectiles (glow head +
 * comet tail), floating damage numbers, skill shapes (expanding nova
 * rings, cone flares, crossed-quad beams — gradient-baked, type-colored,
 * bloomed), and brief point lights so big casts light up the night.
 * Everything is pooled — pools are allocated lazily up to a cap and
 * reused forever; an effect beyond the cap is simply skipped. Nothing
 * here grows with session length.
 */
export class FxSystem {
  private flashes: Flash[] = [];
  private tracers: Tracer[] = [];
  private numbers: DamageNumber[] = [];
  private shapes: ShapeFx[] = [];
  private lights: SkillLight[] = [];
  private bursts: Burst[] = [];
  private glowTex: THREE.Texture;
  private ringTex = ringBandTex();
  private apexTex = apexTex();
  private beamTex = beamTex();
  private discGeo = discGeo();
  private sectorGeo = sectorGeo();
  private corridorGeo = corridorGeo();
  private trailGeo = trailGeo();

  constructor(private scene: THREE.Scene, glowTex: THREE.Texture) {
    this.glowTex = glowTex;
  }

  spawnHit(hit: ActiveHit, to: THREE.Vector3, now: number): void {
    // The server resolved this projectile's flight — its visual must not
    // sail on through the target (it reads as a broken hitbox, hit or
    // miss alike). End the attacker's oldest live tracer here and now.
    if (hit.projectile) {
      let oldest: Tracer | null = null;
      for (const t of this.tracers) {
        if (t.active && t.attacker === hit.attacker && (!oldest || t.bornAt < oldest.bornAt)) {
          oldest = t;
        }
      }
      if (oldest) oldest.flightMs = Math.max(1, now - oldest.bornAt);
    }
    // Significance: how hard this hit should READ. Amount-scaled with a
    // soft knee — tutorial pokes whisper, crits and finishers shout.
    const sig = Math.min(1.6, Math.max(0.25, hit.amount / 45));
    if (!hit.dot) {
      this.spawnFlash(
        to,
        hit.killed ? 0xff5a5a : 0xfff0c0,
        (hit.killed ? 1.6 : 0.55) + sig * 0.5,
        now,
        hit.killed ? 320 : 140,
      );
    }
    // Reaction reads: a freeze flashes ICE and lingers; a stagger snaps
    // a brief amber crack over the victim.
    if (hit.freeze) {
      this.spawnFlash(to, 0x9adfff, 1.5, now, 460, 0.9);
    } else if (hit.stun) {
      this.spawnFlash(to, 0xffd75a, 1.0, now, 240, 0.9);
    }
    const color = DMG_COLORS[hit.dmgType] ?? DMG_COLORS[0];
    if (hit.amount > 0) {
      // Crits read loud (outlined, bigger); dots burn quiet and steady.
      const text = hit.crit ? `${hit.amount}!` : String(hit.amount);
      const mag = hit.dot ? 0 : sig;
      this.spawnNumber(to, text, hit.dot ? `${color}b0` : color, hit.crit || hit.killed, now, mag, hit.crit);
    } else if (!hit.dot) {
      this.spawnNumber(to, "miss", MISS_COLOR, false, now);
    }
  }

  /**
   * A kill: shards of the killing element burst from the corpse. Elites
   * and uniques go louder (more shards, faster, brighter ground light).
   */
  spawnKill(at: THREE.Vector3, dmgType: number, rarity: number, now: number): void {
    const color = PROJ_COLORS[dmgType] ?? PROJ_COLORS[0];
    const big = rarity >= 2;
    let b = this.bursts.find((b) => !b.active);
    if (!b) {
      if (this.bursts.length >= BURST_POOL) return;
      const sprites: THREE.Sprite[] = [];
      const mats: THREE.SpriteMaterial[] = [];
      const vels: THREE.Vector3[] = [];
      for (let i = 0; i < BURST_SPRITES; i++) {
        const mat = new THREE.SpriteMaterial({
          map: this.glowTex,
          transparent: true,
          depthTest: false,
          blending: THREE.AdditiveBlending,
        });
        const sp = new THREE.Sprite(mat);
        sp.visible = false;
        this.scene.add(sp);
        sprites.push(sp);
        mats.push(mat);
        vels.push(new THREE.Vector3());
      }
      b = { sprites, mats, vels, origin: new THREE.Vector3(), bornAt: 0, ttlMs: 0, active: false };
      this.bursts.push(b);
    }
    b.active = true;
    b.bornAt = now;
    b.ttlMs = big ? 620 : 460;
    b.origin.copy(at).setY(at.y + 0.9);
    const speed = big ? 5.2 : 3.4;
    for (let i = 0; i < BURST_SPRITES; i++) {
      const ang = (i / BURST_SPRITES) * Math.PI * 2 + Math.random() * 0.5;
      const up = 1.4 + Math.random() * 2.2;
      b.vels[i].set(Math.cos(ang) * speed * (0.5 + Math.random() * 0.6), up, Math.sin(ang) * speed * (0.5 + Math.random() * 0.6));
      b.mats[i].color.setHex(color);
      b.mats[i].opacity = 1;
      const sc = (big ? 0.34 : 0.22) * (0.7 + Math.random() * 0.6);
      b.sprites[i].scale.set(sc, sc, 1);
      b.sprites[i].position.copy(b.origin);
      b.sprites[i].visible = true;
    }
    this.spawnLight(at, color, big ? 10 : 6, now, b.ttlMs);
    if (big) this.spawnFlash(at, color, 2.2, now, 380);
  }

  /**
   * A non-projectile skill use: draw the shape where the sim resolved it.
   * Strikes get a flash; rings burst outward; cones flare from the apex;
   * lines fire a crossed-quad beam. Every shape briefly lights its ground.
   */
  spawnSkill(s: ActiveSkill, groundY: (x: number, z: number) => number, now: number): void {
    const color = PROJ_COLORS[s.dmgType] ?? PROJ_COLORS[0];
    const at = new THREE.Vector3(s.x, groundY(s.x, s.y) + 0.06, s.y);
    if (s.shape === 0) {
      this.spawnFlash(at, color, 0.7, now, 180);
      return;
    }
    let sh = this.shapes.find((f) => !f.active);
    if (!sh) {
      if (this.shapes.length >= SHAPE_POOL) return;
      const mat = new THREE.MeshBasicMaterial({
        map: this.ringTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.discGeo, mat);
      mesh.renderOrder = 1;
      this.scene.add(mesh);
      sh = { mesh, mat, kind: 1, size: 1, width: 1, bornAt: 0, ttlMs: 0, active: false };
      this.shapes.push(sh);
    }
    const ring = s.shape === 1 || s.shape === 4;
    sh.kind = ring ? 1 : s.shape;
    sh.mesh.geometry = ring ? this.discGeo : s.shape === 2 ? this.sectorGeo : this.corridorGeo;
    sh.mat.map = ring ? this.ringTex : s.shape === 2 ? this.apexTex : this.beamTex;
    sh.size = ring ? Math.max(0.4, s.radius) : Math.max(0.6, s.range);
    sh.width = Math.max(0.3, s.radius); // lines carry their width here
    sh.bornAt = now;
    sh.ttlMs = ring ? 520 : s.shape === 2 ? 420 : 460;
    sh.active = true;
    sh.mat.color.setHex(color);
    sh.mesh.visible = true;
    sh.mesh.position.copy(at);
    // Open along the aim direction (rings don't care, but it's harmless).
    sh.mesh.rotation.set(0, Math.atan2(-s.dy, s.dx), 0);
    this.applyShape(sh, 0);

    // The punch: a center flash and a short-lived ground light.
    const flashScale = ring ? Math.min(2.2, sh.size * 0.45) : 0.9;
    this.spawnFlash(at, color, flashScale, now, ring ? 260 : 180, 0.6);
    this.spawnLight(at, color, ring ? Math.min(9, sh.size * 1.8) : 6, now, sh.ttlMs);
  }

  /** A sim-spawned projectile: glow head + comet tail along the real path. */
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
    const color = PROJ_COLORS[p.dmgType] ?? 0xffc06a;
    this.spawnTracer(from, to, now, Math.min(flightMs, 2500), color, p.attacker);
    // Muzzle flash at the launch point.
    this.spawnFlash(from, color, 0.5, now, 120, 0);
  }

  private spawnFlash(
    at: THREE.Vector3,
    color: number,
    scale: number,
    now: number,
    ttlMs: number,
    lift = 1.1,
  ): void {
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
    f.sprite.position.y += lift;
  }

  /** A brief point light: big casts illuminate the shore around them. */
  private spawnLight(at: THREE.Vector3, color: number, radius: number, now: number, ttlMs: number): void {
    let l = this.lights.find((l) => !l.active);
    if (!l) {
      if (this.lights.length >= LIGHT_POOL) return;
      const light = new THREE.PointLight(0xffffff, 0, 8, 2);
      this.scene.add(light);
      l = { light, bornAt: 0, ttlMs: 0, peak: 0, active: false };
      this.lights.push(l);
    }
    l.active = true;
    l.bornAt = now;
    l.ttlMs = ttlMs;
    l.peak = 14;
    l.light.color.setHex(color);
    l.light.distance = radius;
    l.light.intensity = l.peak;
    l.light.position.copy(at);
    l.light.position.y += 1.2;
    l.light.visible = true;
  }

  private spawnTracer(
    from: THREE.Vector3,
    to: THREE.Vector3,
    now: number,
    flightMs?: number,
    color?: number,
    attacker = 0,
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
      const trailMat = new THREE.MeshBasicMaterial({
        map: this.beamTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const trail = new THREE.Mesh(this.trailGeo, trailMat);
      trail.renderOrder = 1;
      t = {
        sprite: new THREE.Sprite(mat),
        mat,
        trail,
        trailMat,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        bornAt: 0,
        flightMs: 0,
        active: false,
        attacker: 0,
      };
      t.sprite.scale.set(0.34, 0.34, 1);
      this.scene.add(t.sprite);
      this.scene.add(t.trail);
      this.tracers.push(t);
    }
    t.active = true;
    t.bornAt = now;
    t.attacker = attacker;
    t.from.copy(from);
    t.to.copy(to);
    t.flightMs = flightMs ?? Math.min(220, Math.max(90, t.from.distanceTo(t.to) * 22));
    t.mat.color.setHex(color ?? 0xffc06a);
    t.mat.opacity = 1;
    t.sprite.visible = true;
    t.sprite.position.copy(t.from);
    t.trailMat.color.setHex(color ?? 0xffc06a);
    t.trailMat.opacity = 0.85;
    t.trail.visible = true;
    t.trail.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
    this.placeTrail(t, 0);
  }

  /** Trail follows the head, stretching behind it along the flight line. */
  private placeTrail(t: Tracer, a: number): void {
    const dist = t.from.distanceTo(t.to);
    const len = Math.min(1.5, dist * 0.3 + 0.3);
    const head = t.sprite.position;
    const dx = (t.to.x - t.from.x) / dist;
    const dz = (t.to.z - t.from.z) / dist;
    // Don't stretch past the launch point right after firing.
    const behind = Math.min(len, a * dist + 0.2);
    t.trail.scale.set(behind, 1, 1);
    t.trail.position.set(head.x - (dx * behind) / 2, head.y, head.z - (dz * behind) / 2);
  }

  private spawnNumber(
    at: THREE.Vector3,
    text: string,
    color: string,
    big: boolean,
    now: number,
    mag = 0.6,
    crit = false,
  ): void {
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
        baseS: 1,
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
    ctx.font = `bold ${big ? 44 : 32}px "Idlin Text", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.95)";
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    if (crit) {
      // Crits get an engraved outline so they read at any size.
      ctx.lineJoin = "round";
      ctx.lineWidth = 7;
      ctx.strokeStyle = "rgba(20,8,4,0.95)";
      ctx.strokeText(text, 96, 58);
    }
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
    n.driftX = (Math.random() - 0.5) * (crit ? 1.2 : 0.7);
    n.mat.opacity = 1;
    n.sprite.visible = true;
    // Magnitude carries the size: a 6 whispers, a 70 shouts.
    const s = (big ? 1.35 : 0.95) * (0.78 + mag * 0.45);
    n.baseS = s;
    n.sprite.scale.set(2.4 * s * (192 / 160), s, 1);
    n.sprite.position.copy(at).setY(n.baseY);
    n.sprite.position.x += n.driftX * 0.2;
  }

  private applyShape(sh: ShapeFx, a: number): void {
    if (sh.kind === 1) {
      // Ring bursts outward fast, then coasts (ease-out).
      const r = sh.size * (0.2 + 0.8 * easeOutCubic(a));
      sh.mesh.scale.set(r, 1, r);
      sh.mat.opacity = 0.95 * (1 - a) * (1 - a * 0.5);
    } else if (sh.kind === 2) {
      // Sector flares from the apex to full reach almost immediately.
      const r = sh.size * Math.min(1, 0.6 + easeOutCubic(a) * 1.4);
      sh.mesh.scale.set(r, 1, r);
      sh.mat.opacity = 0.9 * (1 - a) ** 2;
    } else {
      // Beam: full length at once, a hot pop that decays.
      sh.mesh.scale.set(sh.size, 1, sh.width);
      sh.mat.opacity = 0.95 * (1 - a) ** 2;
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
        t.trail.visible = false;
        // Spent without striking anything: fizzle where it died.
        this.spawnFlash(t.to, t.mat.color.getHex(), 0.4, now, 140, 0);
        continue;
      }
      t.sprite.position.lerpVectors(t.from, t.to, a);
      t.sprite.position.y += Math.sin(a * Math.PI) * 0.35; // slight arc
      this.placeTrail(t, a);
      t.trailMat.opacity = 0.85 * (a < 0.8 ? 1 : 1 - (a - 0.8) / 0.2);
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
    }
    for (const l of this.lights) {
      if (!l.active) continue;
      const a = (now - l.bornAt) / l.ttlMs;
      if (a >= 1) {
        l.active = false;
        l.light.visible = false;
        l.light.intensity = 0;
        continue;
      }
      l.light.intensity = l.peak * (1 - a) ** 2;
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
      // A quick settle-pop on arrival, then steady — relative to the
      // magnitude-set base scale.
      const pop = a < 0.14 ? 1.28 - (a / 0.14) * 0.28 : 1;
      const s = n.baseS * pop;
      n.sprite.scale.set(2.4 * s * (192 / 160), s, 1);
    }
    for (const b of this.bursts) {
      if (!b.active) continue;
      const a = (now - b.bornAt) / b.ttlMs;
      if (a >= 1) {
        b.active = false;
        for (const sp of b.sprites) sp.visible = false;
        continue;
      }
      const dt = b.ttlMs / 1000;
      for (let i = 0; i < b.sprites.length; i++) {
        const v = b.vels[i];
        // Ballistic shards: rise, arc, fade.
        b.sprites[i].position.set(
          b.origin.x + v.x * a * dt,
          Math.max(0.1, b.origin.y + (v.y * a - 7 * a * a) * dt),
          b.origin.z + v.z * a * dt,
        );
        b.mats[i].opacity = (1 - a) ** 1.5;
      }
    }
  }

  dispose(): void {
    for (const f of this.flashes) {
      f.sprite.removeFromParent();
      f.mat.dispose();
    }
    for (const t of this.tracers) {
      t.sprite.removeFromParent();
      t.trail.removeFromParent();
      t.mat.dispose();
      t.trailMat.dispose();
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
    for (const l of this.lights) {
      l.light.removeFromParent();
      l.light.dispose();
    }
    for (const b of this.bursts) {
      for (const sp of b.sprites) sp.removeFromParent();
      for (const m of b.mats) m.dispose();
    }
    this.bursts = [];
    this.ringTex.dispose();
    this.apexTex.dispose();
    this.beamTex.dispose();
    this.discGeo.dispose();
    this.sectorGeo.dispose();
    this.corridorGeo.dispose();
    this.trailGeo.dispose();
    this.flashes = [];
    this.tracers = [];
    this.numbers = [];
    this.shapes = [];
    this.lights = [];
  }
}
