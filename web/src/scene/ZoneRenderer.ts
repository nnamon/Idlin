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
import { resolveFocusId } from "../world/focus";
import { FxSystem } from "./FxSystem";
import { IconFactory } from "./IconFactory";
import { Terrain } from "./Terrain";

const SKY_COLOR = 0x07070d;

/**
 * Stable identity for a replicated zone. Instances share a display name
 * ("The Withered Shore"); the authored tile map distinguishes them, so the
 * map is folded into a cheap hash — a director cut to a different layout
 * must rebuild the terrain.
 */
function zoneKey(zone: NonNullable<WorldStore["zone"]>): string {
  let h = 0;
  if (zone.tiles) {
    for (const row of zone.tiles.rows) {
      for (let i = 0; i < row.length; i++) h = (h * 31 + row.charCodeAt(i)) | 0;
    }
    for (const l of zone.tiles.legend) {
      for (let i = 0; i < l.ground.length; i++) h = (h * 31 + l.ground.charCodeAt(i)) | 0;
    }
  }
  return `${zone.name}|${zone.width}x${zone.height}|${h}`;
}

/** Ragged glowing oval OUTLINE — wispy strokes hugging an ellipse rim,
 *  blue through violet, soft-bloomed. No spiral arms. */
function portalRimTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.translate(128, 128);
  for (let i = 0; i < 320; i++) {
    const a = (i / 320) * Math.PI * 2;
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const r = 98 + (jitter - 0.5) * 18;
    const hue = 195 + ((i * 7) % 75); // cyan → violet
    g.fillStyle = `hsla(${hue}, 90%, ${55 + (i % 3) * 12}%, 0.5)`;
    g.shadowColor = `hsla(${hue}, 95%, 65%, 0.9)`;
    g.shadowBlur = 16;
    g.beginPath();
    g.ellipse(Math.cos(a) * r, Math.sin(a) * r, 2.5 + (i % 4) * 1.6, 9 + (i % 3) * 4, a + 0.5, 0, Math.PI * 2);
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/** The interior: near-black with faint drifting energy clouds. */
function portalShimmerTex(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.translate(128, 128);
  for (let i = 0; i < 26; i++) {
    const jx = ((Math.sin(i * 78.233) * 43758.5453) % 1) - 0.5;
    const jy = ((Math.sin(i * 39.425) * 27183.1357) % 1) - 0.5;
    const hue = 200 + ((i * 13) % 60);
    const grad = g.createRadialGradient(jx * 130, jy * 130, 0, jx * 130, jy * 130, 26 + (i % 4) * 12);
    grad.addColorStop(0, `hsla(${hue}, 85%, 55%, 0.16)`);
    grad.addColorStop(1, "hsla(0, 0%, 0%, 0)");
    g.fillStyle = grad;
    g.fillRect(-128, -128, 256, 256);
  }
  // feather to transparent outside the oval
  const fade = g.createRadialGradient(0, 0, 70, 0, 0, 120);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = fade;
  g.fillRect(-128, -128, 256, 256);
  return new THREE.CanvasTexture(c);
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
  /** Tutorial gates, index-aligned with store.zone.gates. */
  private gateMarkers: Array<{ mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }> = [];
  /** Zone exits (portals), index-aligned with store.zone.exits. */
  private exitMarkers: Array<{
    group: THREE.Group;
    swirl: THREE.MeshBasicMaterial;
    rim: THREE.MeshBasicMaterial;
    light: THREE.PointLight;
    tex: THREE.CanvasTexture;
    tex2: THREE.CanvasTexture;
  }> = [];
  private moon: THREE.DirectionalLight;
  private focusRing: THREE.Mesh;
  private timer = new THREE.Timer();
  /** Resolves once models + fonts are loaded; capture awaits this. */
  readonly whenReady: Promise<void>;
  /** Capture mode: manual frame stepping + a screenshottable back buffer. */
  private capture: boolean;
  /** Virtual elapsed seconds while stepping frames in capture mode. */
  private captureElapsed = 0;
  /// Identity of the zone the scene was built for — a director cut or
  /// transfer flips the featured world, and the terrain must follow.
  /// Instances share display names ("The Withered Shore") but differ in
  /// their authored tile map, so the key folds the map in too.
  private builtZoneKey: string | null = null;
  /** Snapshot generation the visuals were built against. */
  private builtSnapshotGen = -1;
  private builtWorldKey: string | null = null;
  private onResize = () => this.resize();
  private occlusionRay = new THREE.Raycaster();
  private occlusionDir = new THREE.Vector3();
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
    opts: { capture?: boolean; camera?: number[]; follow?: string } = {},
  ) {
    this.capture = opts.capture ?? false;
    // The individual view (/idler/<name>) and ?watch= pass the followed idler
    // explicitly; it wins over the URL-param read in the field initializer (#79).
    if (opts.follow) this.followOverride = opts.follow;
    // A fixed camera for capture: [x,y,z, targetX,targetY,targetZ]. Reuses the
    // existing ?cam= pin path (frame()), so the shot frames a chosen subject
    // deterministically without waiting for the director to converge.
    if (opts.camera?.length === 6) this.camOverride = opts.camera;
    // Capture needs a readable back buffer to screenshot; the live client
    // doesn't, and would pay the VRAM, so it's opt-in.
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: this.capture,
    });
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
      new THREE.MeshBasicMaterial({ color: 0xc9a24a, transparent: true, opacity: 0.7 }),
    );
    this.focusRing.rotation.x = -Math.PI / 2;
    this.focusRing.position.y = 0.05;
    this.focusRing.visible = false;
    this.scene.add(this.focusRing);

    // Nameplates and damage numbers bake the font into canvases at
    // entity creation — the face must be resolved before the first bake.
    this.whenReady = Promise.all([
      AssetLibrary.load(),
      document.fonts.load('bold 56px "Idlin Mono"'),
      document.fonts.load('32px "Idlin Mono"'),
    ]).then(([assets]) => {
      this.assets = assets;
      // The HUD draws item icons rendered from the same models.
      this.store.icons = new IconFactory(assets);
    });

    this.resize();
    window.addEventListener("resize", this.onResize);
    // The live client runs the rAF loop; capture steps frames manually on a
    // virtual clock (stepFrames) for reproducible pixels.
    if (!this.capture) this.renderer.setAnimationLoop(() => this.frame());
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  /** Lazy view of entity states for resolveFocusId — no per-frame array (the
   *  focus resolver stops at the first match and filters to characters). */
  private *entityStates(): Generator<{ id: number; name: string; kind: string }> {
    for (const er of this.store.entities.values()) yield er.state;
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
    for (const m of this.exitMarkers) m.group.removeFromParent();
    this.exitMarkers = [];
    for (const g of this.gateMarkers) g.mesh.removeFromParent();
    this.gateMarkers = [];
    // Entity visuals too: net ids are PER-WORLD (every instance's idler is
    // id 1), so reusing a visual across a cut would keep the old world's
    // baked name label — Kargan's nameplate riding on Veles.
    for (const v of this.visuals.values()) v.dispose();
    this.visuals.clear();
    const { width: w, height: h } = zone;

    // Authored zones render from their tile map; generated zones keep the
    // heightmap-and-scatter look. Either way the sim stays 2D and
    // everything samples terrain.heightAt for its foot Y.
    // ONE renderer for every zone: the sculpted Terrain (heightmap, sea,
    // foam, sky, fringe). Authored zones FEED it their tile map — tiles
    // own layout and collision; this class owns beauty.
    const terrain = new Terrain(w, h, zone.name);
    if (zone.tiles) terrain.setTiles(zone.tiles);
    terrain.build(this.assets);
    this.terrain = terrain;
    // Braziers: authored cells when the map names them, else the classic
    // trail up the strand.
    const brazierSpots: Array<[number, number]> = terrain.brazierSpots.length
      ? terrain.brazierSpots
      : (
          [
            [0.5, 0.93],
            [0.3, 0.76],
            [0.62, 0.58],
            [0.34, 0.4],
            [0.6, 0.22],
            [0.44, 0.06],
          ] as Array<[number, number]>
        ).map(([fx, fz]) => [w * fx, h * fz] as [number, number]);
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

    // Braziers: warm flickering counterpoints to the cold moonlight.
    for (const [bx, bz] of brazierSpots) {
      this.addBrazier(bx, bz, this.terrain.heightAt(bx, bz));
    }

    // Gates: a humming amber barrier across the rect while shut; it
    // dissolves when the brain lifts it.
    for (const gate of zone.gates) {
      const w2 = gate.x1 - gate.x0 + 1;
      const h2 = gate.y1 - gate.y0 + 1;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xe0b75e,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w2, 1.8, h2), mat);
      const gx = gate.x0 + w2 / 2;
      const gz = gate.y0 + h2 / 2;
      mesh.position.set(gx, this.terrain.heightAt(gx, gz) + 0.95, gz);
      this.scene.add(mesh);
      this.gateMarkers.push({ mesh, mat });
    }

    // Exits: a PoE-style ground vortex per exit — concentric blue swirl
    // spinning into a dark center, with a bright rim. Open state spins
    // and glows in the frame loop; closed is a faint dormant scar.
    for (const exit of zone.exits) {
      const y = this.terrain.heightAt(exit.x, exit.y);
      const group = new THREE.Group();
      const rimTex = portalRimTex();
      rimTex.center.set(0.5, 0.5);
      const shimmerTex = portalShimmerTex();
      shimmerTex.center.set(0.5, 0.5);
      const shimmerMat = new THREE.MeshBasicMaterial({
        map: shimmerTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const rimMat = new THREE.MeshBasicMaterial({
        map: rimTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      // The portal STANDS: a vertical oval floating off the ground.
      const mk = (mat: THREE.Material, r: number, z: number) => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), mat);
        m.scale.set(0.74, 1.1, 1);
        m.position.set(0, 1.62, z);
        m.rotation.x = -0.1;
        return m;
      };
      const throat = mk(
        new THREE.MeshBasicMaterial({ color: 0x020208, side: THREE.DoubleSide }),
        1.18,
        -0.06,
      );
      const shimmer = mk(shimmerMat, 1.3, 0);
      const rim = mk(rimMat, 1.55, 0.04);
      // Light spill pooling beneath the doorway.
      const spill = new THREE.Mesh(
        new THREE.CircleGeometry(1.1, 24),
        new THREE.MeshBasicMaterial({
          color: 0x4fc3ff,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      spill.rotation.x = -Math.PI / 2;
      spill.position.y = 0.06;
      const light = new THREE.PointLight(0x4fc3ff, 0, 9, 2);
      light.position.y = 1.6;
      group.add(throat, shimmer, rim, spill, light);
      group.position.set(exit.x, y, exit.y);
      this.scene.add(group);
      this.exitMarkers.push({ group, swirl: shimmerMat, rim: rimMat, light, tex: rimTex, tex2: shimmerTex });
    }

    this.director.setZoneSize(w, h);
    this.builtZoneKey = zoneKey(zone);
  }


  /**
   * Anything standing between the lens and an idler goes ghost — the
   * WHOLE building, not just the mesh the ray grazed (partial fades read
   * as broken). Opacity lerps toward its target and a hit stays sticky
   * for a quarter second, so edge-grazing rays can't strobe the fade.
   * Materials are cloned per mesh on first fade (instances share GPU
   * materials, so mutating the shared one would ghost every copy).
   */
  private fadeState = new Map<THREE.Object3D, { current: number; lastHit: number }>();

  private updateOcclusion(now: number): void {
    const tt = this.terrain;
    if (!tt || tt.occluders.length === 0) return;
    const cam = this.camera.position;
    for (const [id, v] of this.visuals) {
      if (this.store.entities.get(id)?.state.kind !== "Character") continue;
      const target = v.group.position;
      this.occlusionDir.set(target.x - cam.x, target.y + 1 - cam.y, target.z - cam.z);
      const dist = this.occlusionDir.length();
      if (dist < 2) continue;
      this.occlusionRay.set(cam, this.occlusionDir.normalize());
      this.occlusionRay.far = dist - 0.8;
      for (const hit of this.occlusionRay.intersectObjects(tt.occluders, true)) {
        const root = (hit.object.userData.occRoot as THREE.Object3D) ?? hit.object;
        const st = this.fadeState.get(root) ?? { current: 1, lastHit: 0 };
        st.lastHit = now;
        this.fadeState.set(root, st);
      }
    }
    for (const root of tt.occluders) {
      const st = this.fadeState.get(root);
      if (!st) continue;
      const want = now - st.lastHit < 250 ? 0.16 : 1;
      st.current += (want - st.current) * 0.22;
      if (st.current > 0.97 && want === 1) {
        // fully solid again: restore shared materials and forget it
        root.traverse((o) => {
          if (o instanceof THREE.Mesh && o.userData.solidMat) {
            o.material = o.userData.solidMat;
          }
        });
        this.fadeState.delete(root);
        continue;
      }
      root.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        if (!o.userData.ghostMat) {
          o.userData.solidMat = o.material;
          const ghost = (m: THREE.Material) => {
            const g = m.clone();
            g.transparent = true;
            g.depthWrite = false;
            return g;
          };
          o.userData.ghostMat = Array.isArray(o.material)
            ? o.material.map(ghost)
            : ghost(o.material);
        }
        const mats = Array.isArray(o.userData.ghostMat)
          ? (o.userData.ghostMat as THREE.Material[])
          : [o.userData.ghostMat as THREE.Material];
        for (const m of mats) m.opacity = st.current;
        o.material = o.userData.ghostMat;
      });
    }
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

  private frame(timestampMs?: number): void {
    // Capture passes a virtual timestamp so animation, the playout clock, and
    // FX advance deterministically; the live loop uses wall time.
    let dt: number;
    let now: number;
    let t: number;
    if (timestampMs !== undefined) {
      now = timestampMs;
      t = timestampMs / 1000;
      dt = Math.min(Math.max(0, t - this.captureElapsed), 0.1);
      this.captureElapsed = t;
    } else {
      this.timer.update();
      dt = Math.min(this.timer.getDelta(), 0.1);
      now = performance.now();
      t = this.timer.getElapsed();
    }

    if (this.store.zone && this.assets && zoneKey(this.store.zone) !== this.builtZoneKey) {
      this.buildZone();
    }
    // A snapshot from a DIFFERENT world drops all per-entity visuals:
    // identical authored instances share terrain, but their net ids name
    // different idlers (a reused visual snaps between worlds wearing the
    // wrong nameplate). Same-world snapshots (lag resync) keep visuals —
    // purging those flashed bind poses on every director cut. Empty key
    // (old recordings) falls back to purge-always: safe, just churnier.
    if (this.store.snapshotGen !== this.builtSnapshotGen) {
      this.builtSnapshotGen = this.store.snapshotGen;
      const wk = this.store.zone?.worldKey ?? "";
      if (wk === "" || wk !== this.builtWorldKey) {
        for (const v of this.visuals.values()) v.dispose();
        this.visuals.clear();
      }
      this.builtWorldKey = wk;
    }
    this.terrain?.update(t);
    this.updateOcclusion(now);

    for (const b of this.braziers) {
      b.light.intensity =
        b.baseIntensity * (0.82 + 0.14 * Math.sin(t * 9 + b.phase) + 0.1 * Math.sin(t * 23 + b.phase * 3));
    }

    // Gates hum while shut, vanish when lifted.
    const gates = this.store.zone?.gates ?? [];
    for (let i = 0; i < this.gateMarkers.length; i++) {
      const g = this.gateMarkers[i];
      const open = gates[i]?.open ?? true;
      g.mesh.visible = !open;
      if (!open) g.mat.opacity = 0.28 + 0.1 * Math.sin(t * 3 + i);
    }

    // Portals: the vortex spins while open; closed is a dormant scar.
    const exits = this.store.zone?.exits ?? [];
    for (let i = 0; i < this.exitMarkers.length; i++) {
      const m = this.exitMarkers[i];
      const open = exits[i]?.open ?? false;
      const pulse = 0.82 + 0.18 * Math.sin(t * 2.4 + i);
      // Shimmer, not spin: the rim breathes and drifts barely; the
      // interior clouds counter-drift. No spiral motion.
      m.tex.rotation = t * (open ? 0.1 : 0.005);
      m.tex2.rotation = -t * (open ? 0.16 : 0.008);
      m.rim.opacity = open ? 0.9 * pulse : 0.08;
      m.swirl.opacity = open ? 0.5 + 0.25 * Math.sin(t * 3.1 + i) : 0.05;
      m.light.intensity = open ? 13 * pulse : 0;
    }

    // -- sync entities (only once models are in; one frame of patience) --
    if (this.assets) {
      // The playout clock first: positions and combat events both read
      // from it, so jitter bends time instead of snapping the world.
      this.store.advanceClock(now);
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
      // Windups drive ALL attack/cast animation now: the clip is
      // rate-fitted so its contact frame lands when the strike resolves
      // — HitFx, numbers, and shape FX arrive ON the visible blow.
      for (const u of this.store.drainUses()) {
        this.visuals
          .get(u.attacker)
          ?.playUse(u.spell, new THREE.Vector3(u.x, 0, u.y), u.useS, u.contactS);
      }
      for (const hit of this.store.drainHits()) {
        const target = this.visuals.get(hit.target);
        if (!target) continue;
        this.fx.spawnHit(hit, target.group.position, now);
        if (!hit.dot) {
          // The victim FEELS it: hitstop, squash, a shove along the
          // blow. Significance scales with the number.
          const attacker = this.visuals.get(hit.attacker);
          const dirX = attacker ? target.group.position.x - attacker.group.position.x : 0;
          const dirZ = attacker ? target.group.position.z - attacker.group.position.z : 1;
          const sig = Math.min(1.6, Math.max(0.25, hit.amount / 45));
          target.impact(dirX, dirZ, sig, hit.crit, hit.killed, hit.stun, hit.freeze);
          if (hit.crit) this.director.addTraumaAt(target.group.position, 0.16 + sig * 0.08);
        }
        if (hit.killed) {
          const rarity = this.store.entities.get(hit.target)?.state.rarity ?? 0;
          this.fx.spawnKill(target.group.position, hit.dmgType, rarity, now);
          this.director.addTraumaAt(target.group.position, rarity >= 2 ? 0.45 : 0.2);
        }
      }
      for (const p of this.store.drainProjectiles()) {
        // The windup already animated the launch; just fly the streak.
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
        // Shape FX land at the CONTACT tick (the windup already turned
        // and animated the caster).
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
    const zoom = this.zoomOverride;
    // Pinned to one idler (/idler/<name>, ?watch=, ?follow=): the camera tracks
    // THEM, or nobody if they're absent — never the director's pick (that would
    // silently frame a different idler on someone's page, #79). Broadcast follows
    // the cue. Shared with the HUD via resolveFocusId so they always agree.
    const focusId = resolveFocusId(
      this.followOverride,
      this.entityStates(),
      this.store.cue?.focus,
    );
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
    } else if (this.followOverride) {
      // Pinned view (/idler/<name>): the idler isn't on screen right now (still
      // loading, transferring, or respawning). HOLD the camera — never orbit into
      // the overview, which is broadcast-only chrome (#79).
      this.focusRing.visible = false;
    } else {
      this.focusRing.visible = false;
      this.director.idle(dt);
    }

    this.composer.render();
  }

  /** Capture only: render `frames` frames at a fixed `dt`, advancing the
   *  virtual clock so animation, the playout clock, and the camera converge
   *  deterministically. Cumulative — repeated calls keep moving time FORWARD
   *  from where the last left off (never rewind). Call after `whenReady`. */
  stepFrames(frames: number, dtSeconds = 1 / 60): void {
    const base = this.captureElapsed;
    for (let i = 1; i <= frames; i++) this.frame((base + i * dtSeconds) * 1000);
  }

  /** Capture only: virtual seconds elapsed so far (monotonic across
   *  `stepFrames` calls). Exposed for the harness to assert the clock advances. */
  get virtualElapsedSeconds(): number {
    return this.captureElapsed;
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
