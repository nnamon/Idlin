import * as THREE from "three";
import type { WorldStore, EntityRender } from "../world/store";
import { DirectorCamera } from "../camera/DirectorCamera";

const RARITY_COLORS = [0xbfbfbf, 0x5a8aff, 0xffd75a, 0xff9a3c];

interface Visual {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyHeight: number;
  hpBg: THREE.Sprite;
  hpFg: THREE.Sprite;
  label: THREE.Sprite | null;
  isLoot: boolean;
  dead: boolean;
}

interface Fx {
  obj: THREE.Object3D;
  bornAt: number;
  ttlMs: number;
}

/**
 * Renders the replicated zone: pooled entity visuals, health bars, hit
 * effects, and the director-driven camera. Reads the WorldStore every frame;
 * owns nothing about game state.
 */
export class ZoneRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly director: DirectorCamera;
  private visuals = new Map<number, Visual>();
  private fx: Fx[] = [];
  private ground: THREE.Mesh | null = null;
  private focusRing: THREE.Mesh;
  private clock = new THREE.Clock();
  private zoneBuilt = false;
  private whiteTex: THREE.Texture;

  constructor(
    private container: HTMLElement,
    private store: WorldStore,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0a0f);
    this.scene.fog = new THREE.Fog(0x0a0a0f, 30, 90);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.camera.position.set(30, 25, 55);
    this.director = new DirectorCamera(this.camera);

    this.scene.add(new THREE.AmbientLight(0x404060, 0.5));
    const moon = new THREE.DirectionalLight(0x6a7aff, 0.5);
    moon.position.set(-30, 40, -20);
    this.scene.add(moon);
    const warm = new THREE.PointLight(0xff9a3c, 300, 80);
    warm.position.set(30, 18, 30);
    this.scene.add(warm);

    // Focus ring marking the director's subject.
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 32),
      new THREE.MeshBasicMaterial({ color: 0x9a7bff, transparent: true, opacity: 0.7 }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.position.y = 0.05;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);

    const data = new Uint8Array([255, 255, 255, 255]);
    this.whiteTex = new THREE.DataTexture(data, 1, 1);
    this.whiteTex.needsUpdate = true;

    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private buildZone(): void {
    const zone = this.store.zone;
    if (!zone) return;
    if (this.ground) {
      this.scene.remove(this.ground);
    }
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.width, zone.height),
      new THREE.MeshStandardMaterial({ color: 0x161620, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(zone.width / 2, 0, zone.height / 2);
    this.scene.add(ground);
    this.ground = ground;

    const grid = new THREE.GridHelper(
      Math.max(zone.width, zone.height),
      Math.max(zone.width, zone.height) / 4,
      0x26263a,
      0x1c1c2c,
    );
    grid.position.set(zone.width / 2, 0.01, zone.height / 2);
    this.scene.add(grid);

    this.director.setZoneCenter(zone.width / 2, zone.height / 2, Math.max(zone.width, zone.height));
    this.zoneBuilt = true;
  }

  private bodyFor(
    model: string,
    rarity: number,
    name: string,
  ): { mesh: THREE.Mesh; height: number } {
    let geo: THREE.BufferGeometry;
    let color: number;
    let height: number;
    switch (model) {
      case "hero": {
        geo = new THREE.CapsuleGeometry(0.45, 0.9, 4, 12);
        // Classless heroes: a stable hue from the character name.
        let hash = 0;
        for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
        const col = new THREE.Color().setHSL((hash % 360) / 360, 0.55, 0.55);
        color = col.getHex();
        height = 1.8;
        break;
      }
      case "shambler":
        geo = new THREE.BoxGeometry(0.8, 1.2, 0.8);
        color = 0x4a6b4a;
        height = 1.2;
        break;
      case "stalker":
        geo = new THREE.ConeGeometry(0.45, 1.6, 6);
        color = 0xd8d2c0;
        height = 1.6;
        break;
      case "husk":
        geo = new THREE.BoxGeometry(1.4, 1.8, 1.2);
        color = 0x2e4b5a;
        height = 1.8;
        break;
      case "loot":
        geo = new THREE.OctahedronGeometry(0.35);
        color = RARITY_COLORS[rarity] ?? 0xbfbfbf;
        height = 0.7;
        break;
      case "gem":
        geo = new THREE.TetrahedronGeometry(0.32);
        color = 0x5adfdf;
        height = 0.6;
        break;
      default:
        geo = new THREE.SphereGeometry(0.5, 12, 8);
        color = 0x888888;
        height = 1.0;
    }
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.6,
      emissive: model === "loot" ? color : 0x000000,
      emissiveIntensity: model === "loot" ? 0.6 : 0,
      transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = height / 2 + (model === "loot" ? 0.2 : 0);
    return { mesh, height };
  }

  private makeSprite(color: number, opacity = 1): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: this.whiteTex,
      color,
      transparent: true,
      opacity,
      depthTest: false,
    });
    return new THREE.Sprite(mat);
  }

  private makeLabel(text: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.font = "bold 36px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#000";
    ctx.strokeText(text, 128, 44);
    ctx.fillStyle = "#e8e8ff";
    ctx.fillText(text, 128, 44);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }),
    );
    sprite.scale.set(3.2, 0.8, 1);
    return sprite;
  }

  private createVisual(er: EntityRender): Visual {
    const { state } = er;
    const isLoot = state.kind === "Loot";
    const { mesh, height } = this.bodyFor(state.model, state.rarity, state.name);
    const group = new THREE.Group();
    group.add(mesh);

    const hpBg = this.makeSprite(0x331111, 0.85);
    hpBg.scale.set(1.2, 0.14, 1);
    hpBg.position.y = height + 0.5;
    const hpFg = this.makeSprite(0x44dd66);
    hpFg.scale.set(1.16, 0.1, 1);
    hpFg.position.y = height + 0.5;
    hpFg.renderOrder = 1;
    group.add(hpBg, hpFg);
    if (isLoot) {
      hpBg.visible = false;
      hpFg.visible = false;
    }

    let label: THREE.Sprite | null = null;
    if (state.kind === "Character") {
      label = this.makeLabel(state.name);
      label.position.y = height + 1.1;
      group.add(label);
    }

    this.scene.add(group);
    const visual: Visual = { group, body: mesh, bodyHeight: height, hpBg, hpFg, label, isLoot, dead: false };
    this.visuals.set(state.id, visual);
    return visual;
  }

  private frame(): void {
    const dt = this.clock.getDelta();
    const now = performance.now();
    const t = this.clock.elapsedTime;

    if (!this.zoneBuilt && this.store.zone) {
      this.buildZone();
    }

    // -- sync entities --
    const seen = new Set<number>();
    for (const [id, er] of this.store.entities) {
      seen.add(id);
      const v = this.visuals.get(id) ?? this.createVisual(er);
      const pos = this.store.renderPos(er, now);
      v.group.position.set(pos.x, 0, pos.y);

      if (v.isLoot) {
        v.body.rotation.y += dt * 1.5;
        v.body.position.y = v.bodyHeight / 2 + 0.2 + Math.sin(t * 2 + id) * 0.08;
      } else {
        const pct = er.state.life_pct / 100;
        v.hpFg.scale.x = Math.max(0.02, 1.16 * pct);
        v.hpFg.position.x = -(1.16 * (1 - pct)) / 2;
        (v.hpFg.material as THREE.SpriteMaterial).color.setHex(
          pct > 0.5 ? 0x44dd66 : pct > 0.25 ? 0xffd75a : 0xff5a5a,
        );
        const hideBar = er.state.kind === "Monster" && er.state.life_pct >= 100;
        v.hpBg.visible = !hideBar && !er.state.dead;
        v.hpFg.visible = !hideBar && !er.state.dead;

        if (er.state.dead !== v.dead) {
          v.dead = er.state.dead;
          const mat = v.body.material as THREE.MeshStandardMaterial;
          mat.opacity = v.dead ? 0.25 : 1;
          v.body.rotation.x = v.dead ? -Math.PI / 2 : 0;
          v.body.position.y = v.dead ? 0.3 : v.bodyHeight / 2;
        }
      }
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.scene.remove(v.group);
        this.visuals.delete(id);
      }
    }

    // -- hit effects --
    for (const hit of this.store.drainHits()) {
      const from = this.visuals.get(hit.attacker)?.group.position;
      const to = this.visuals.get(hit.target)?.group.position;
      if (!to) continue;
      if (hit.projectile && from) {
        const geo = new THREE.BufferGeometry().setFromPoints([
          from.clone().setY(1.2),
          to.clone().setY(1.0),
        ]);
        const line = new THREE.Line(
          geo,
          new THREE.LineBasicMaterial({ color: 0xffc06a, transparent: true, opacity: 0.9 }),
        );
        this.scene.add(line);
        this.fx.push({ obj: line, bornAt: now, ttlMs: 160 });
      }
      const flash = this.makeSprite(hit.killed ? 0xff5a5a : 0xfff0c0, 0.9);
      flash.scale.set(hit.killed ? 1.6 : 0.7, hit.killed ? 1.6 : 0.7, 1);
      flash.position.copy(to).setY(1.1);
      this.scene.add(flash);
      this.fx.push({ obj: flash, bornAt: now, ttlMs: hit.killed ? 350 : 140 });
    }
    this.fx = this.fx.filter((f) => {
      const age = (now - f.bornAt) / f.ttlMs;
      if (age >= 1) {
        this.scene.remove(f.obj);
        return false;
      }
      const mat = (f.obj as THREE.Mesh).material as THREE.Material & { opacity: number };
      mat.opacity = 0.9 * (1 - age);
      return true;
    });

    // -- camera + focus ring --
    const focusId = this.store.cue?.focus;
    const focus = focusId !== undefined ? this.visuals.get(focusId) : undefined;
    if (focus) {
      this.focusRing.visible = true;
      this.focusRing.position.set(focus.group.position.x, 0.05, focus.group.position.z);
      const pulse = 1 + Math.sin(t * 4) * 0.12;
      this.focusRing.scale.set(pulse, pulse, 1);
      this.director.follow(focus.group.position, dt);
    } else {
      this.focusRing.visible = false;
      this.director.idle(dt);
    }

    this.renderer.render(this.scene, this.camera);
  }
}
