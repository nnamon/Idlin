import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { VignetteShader } from "three/addons/shaders/VignetteShader.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { WorldStore } from "../world/store";
import { DirectorCamera } from "../camera/DirectorCamera";
import { AssetLibrary } from "./Assets";
import { EntityVisual, SharedResources } from "./EntityVisuals";
import { FxSystem } from "./FxSystem";
import { Terrain } from "./Terrain";

const SKY_COLOR = 0x07070d;

/**
 * Stable identity for a replicated zone. Per-idler instances share a
 * display name ("The Withered Shore") but scatter their own rocks and
 * trees, so the obstacle layout is folded into a cheap hash — a director
 * cut between instances must rebuild the terrain.
 */
function zoneKey(zone: NonNullable<WorldStore["zone"]>): string {
  let h = 0;
  for (const o of zone.obstacles) {
    h = (h * 31 + Math.round(o.x * 8) * 7 + Math.round(o.y * 8) * 13 + o.kind) | 0;
  }
  return `${zone.name}|${zone.width}x${zone.height}|${h}`;
}

interface Brazier {
  light: THREE.PointLight;
  baseIntensity: number;
  phase: number;
}

/**
 * Renders the replicated zone: a moonlit night rig with brazier accents and
 * filmic post-processing, animated glTF entities (EntityVisuals), pooled
 * combat feedback (FxSystem), and the director-driven camera. Reads the
 * WorldStore every frame; owns nothing about game state.
 */
export class ZoneRenderer {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly director: DirectorCamera;

  private assets: AssetLibrary | null = null;
  private terrain: Terrain | null = null;
  private shared = new SharedResources();
  private visuals = new Map<number, EntityVisual>();
  private fx: FxSystem;
  private braziers: Brazier[] = [];
  private brazierGroups: THREE.Group[] = [];
  private moon: THREE.DirectionalLight;
  private focusRing: THREE.Mesh;
  private timer = new THREE.Timer();
  /// Identity of the zone the scene was built for — a director cut or
  /// transfer flips the featured world, and the terrain must follow.
  /// Instances share display names ("The Withered Shore") but differ in
  /// obstacle layout, so the key folds the obstacles in too.
  private builtZoneKey: string | null = null;
  private onResize = () => this.resize();
  /** Dev: ?follow=<name>[&zoom=0.3] locks the camera close on one character;
   *  ?cam=x,y,z,tx,ty,tz pins it entirely (shot framing/verification). */
  /** ?follow= pins the camera; ?watch= implies following its character. */
  private followOverride =
    new URLSearchParams(location.search).get("follow") ??
    new URLSearchParams(location.search).get("watch");
  /** Multiplies the follow distance everywhere (cue follows included). */
  private zoomOverride = Number(new URLSearchParams(location.search).get("zoom") ?? "1");
  private camOverride = new URLSearchParams(location.search)
    .get("cam")
    ?.split(",")
    .map(Number);

  constructor(
    private container: HTMLElement,
    private store: WorldStore,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 38, 115);

    // Dim image-based fill: punctual lights barely touch vertical surfaces,
    // and PBR materials want *some* environment. Keeps the night readable
    // without flattening it.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.16;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.camera.position.set(30, 25, 55);
    this.director = new DirectorCamera(this.camera);

    // -- the night rig: cold ambient sky, one shadow-casting moon --
    this.scene.add(new THREE.HemisphereLight(0x44548a, 0x1a1722, 0.7));
    this.moon = new THREE.DirectionalLight(0xa8b8ff, 2.3);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.03;
    this.scene.add(this.moon, this.moon.target);

    // -- post chain: linear HDR render → bloom → vignette → tonemap/sRGB --
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.35, 0.9));
    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 1.1;
    vignette.uniforms.darkness.value = 1.0;
    this.composer.addPass(vignette);
    this.composer.addPass(new OutputPass());

    this.fx = new FxSystem(this.scene, this.shared.glowTex);

    // Focus ring marking the director's subject.
    this.focusRing = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 32),
      new THREE.MeshBasicMaterial({ color: 0x9a7bff, transparent: true, opacity: 0.7 }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.position.y = 0.05;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);

    void AssetLibrary.load().then((assets) => {
      this.assets = assets;
    });

    this.resize();
    window.addEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  private buildZone(): void {
    const zone = this.store.zone;
    if (!zone || !this.assets) return;
    // A zone switch (director cut or transfer) rebuilds the set: old
    // terrain and braziers leave with their world.
    if (this.terrain) {
      this.terrain.group.removeFromParent();
      this.terrain = null;
    }
    for (const g of this.brazierGroups) g.removeFromParent();
    this.brazierGroups = [];
    this.braziers = [];
    // Entity visuals too: net ids are PER-WORLD (every instance's idler is
    // id 1), so reusing a visual across a cut would keep the old world's
    // baked name label — Kargan's nameplate riding on Veles.
    for (const v of this.visuals.values()) v.dispose();
    this.visuals.clear();
    const { width: w, height: h } = zone;

    // Cosmetic terrain: heightmap ground, sea, sky, scattered props. The
    // sim stays 2D; everything samples terrain.heightAt for its foot Y.
    this.terrain = new Terrain(w, h, zone.name);
    this.terrain.build(this.assets, zone.obstacles);
    this.scene.add(this.terrain.group);

    // Moon angled across the zone; shadow frustum sized to cover it.
    this.moon.position.set(w / 2 - 35, 45, h / 2 - 22);
    this.moon.target.position.set(w / 2, 0, h / 2);
    const extent = Math.max(w, h) * 0.72;
    const cam = this.moon.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.far = 140;
    cam.updateProjectionMatrix();

    // Braziers: warm flickering counterpoints to the cold moonlight — a
    // trail of them marks the way up the strand.
    const spots: Array<[number, number]> = [
      [0.5, 0.93], // the spawn camp
      [0.3, 0.76],
      [0.62, 0.58],
      [0.34, 0.4],
      [0.6, 0.22],
      [0.44, 0.06], // the far end
    ];
    for (const [fx, fz] of spots) {
      this.addBrazier(w * fx, h * fz, this.terrain.heightAt(w * fx, h * fz));
    }

    this.director.setZoneSize(w, h);
    this.builtZoneKey = zoneKey(zone);
  }

  private addBrazier(x: number, z: number, y: number): void {
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1.1, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.9 }),
    );
    post.position.y = 0.55;
    post.castShadow = true;
    const bowl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.2, 0.25, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a322a, roughness: 0.85 }),
    );
    bowl.position.y = 1.2;
    const coals = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.2, 0),
      new THREE.MeshStandardMaterial({
        color: 0xff7a26,
        emissive: 0xff9a4a,
        emissiveIntensity: 0.75,
        roughness: 0.6,
      }),
    );
    coals.position.y = 1.34;
    const light = new THREE.PointLight(0xff9a4a, 17, 14, 2);
    light.position.y = 1.7;
    group.add(post, bowl, coals, light);
    group.position.set(x, y - 0.04, z);
    this.scene.add(group);
    this.brazierGroups.push(group);
    this.braziers.push({ light, baseIntensity: 17, phase: Math.random() * Math.PI * 2 });
  }

  private frame(): void {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    const now = performance.now();
    const t = this.timer.getElapsed();

    if (this.store.zone && this.assets && zoneKey(this.store.zone) !== this.builtZoneKey) {
      this.buildZone();
    }
    this.terrain?.update(t);

    for (const b of this.braziers) {
      b.light.intensity =
        b.baseIntensity * (0.82 + 0.14 * Math.sin(t * 9 + b.phase) + 0.1 * Math.sin(t * 23 + b.phase * 3));
    }

    // -- sync entities (only once models are in; one frame of patience) --
    if (this.assets) {
      const seen = new Set<number>();
      for (const [id, er] of this.store.entities) {
        seen.add(id);
        let v = this.visuals.get(id);
        if (!v) {
          v = new EntityVisual(id, er, this.assets, this.shared);
          this.scene.add(v.group);
          this.visuals.set(id, v);
        }
        const pos = this.store.renderPos(er, now);
        v.update(er, pos, dt, t, this.terrain?.heightAt(pos.x, pos.y) ?? 0);
      }
      for (const [id, v] of this.visuals) {
        if (!seen.has(id)) {
          v.dispose();
          this.visuals.delete(id);
        }
      }

      // -- combat feedback --
      for (const hit of this.store.drainHits()) {
        const attacker = this.visuals.get(hit.attacker);
        const target = this.visuals.get(hit.target);
        if (!target) continue;
        // Projectile hits already animated their launch; dots burn silently.
        if (!hit.dot && !hit.projectile) attacker?.playAttack(target.group.position);
        this.fx.spawnHit(hit, target.group.position, now);
      }
      for (const p of this.store.drainProjectiles()) {
        // The launch animation plays at fire time, aimed along the flight.
        this.visuals
          .get(p.attacker)
          ?.playSkill(p.spell, new THREE.Vector3(p.x + p.vx, 0, p.y + p.vy));
        this.fx.spawnProjectile(p, (x, z) => this.terrain?.heightAt(x, z) ?? 0, now);
      }
      // Speech bubbles: hand fresh lines to their visuals, expire old ones.
      for (const [id, s] of this.store.speech) {
        if (now - s.at > 4500) {
          this.store.speech.delete(id);
          continue;
        }
        this.visuals.get(id)?.showSpeech(s.text, s.at, now);
      }
      for (const s of this.store.drainSkills()) {
        // Point blasts anchor away from the caster — face the blast, not
        // the shape origin math.
        const aim =
          s.shape === 4
            ? new THREE.Vector3(s.x, 0, s.y)
            : new THREE.Vector3(s.x + s.dx, 0, s.y + s.dy);
        this.visuals.get(s.attacker)?.playSkill(s.spell, aim);
        this.fx.spawnSkill(s, (x, z) => this.terrain?.heightAt(x, z) ?? 0, now);
      }
    }
    this.fx.update(now);

    // -- camera + focus ring --
    if (this.camOverride?.length === 6) {
      const [x, y, z, tx, ty, tz] = this.camOverride;
      this.camera.position.set(x, y, z);
      this.camera.lookAt(tx, ty, tz);
      this.focusRing.visible = false;
      this.composer.render();
      return;
    }
    let focusId = this.store.cue?.focus;
    const zoom = this.zoomOverride;
    if (this.followOverride) {
      const name = this.followOverride.toLowerCase();
      for (const er of this.store.entities.values()) {
        if (er.state.name.toLowerCase() === name) {
          focusId = er.state.id;
          break;
        }
      }
    }
    const focus = focusId !== undefined ? this.visuals.get(focusId) : undefined;
    if (focus) {
      this.focusRing.visible = true;
      this.focusRing.position.set(
        focus.group.position.x,
        focus.group.position.y + 0.06,
        focus.group.position.z,
      );
      const pulse = 1 + Math.sin(t * 4) * 0.12;
      this.focusRing.scale.set(pulse, pulse, 1);
      this.director.follow(focus.group.position, dt, zoom);
    } else {
      this.focusRing.visible = false;
      this.director.idle(dt);
    }

    this.composer.render();
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.onResize);
    for (const v of this.visuals.values()) v.dispose();
    this.visuals.clear();
    this.fx.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
