import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

/**
 * Fog of war (#129, Layer A — the renderer): a post-process pass that darkens
 * everything outside what the viewed idler(s) have discovered. Screen-space by
 * design — it multiplies the FINAL pixels, so ground, props, monsters, nameplates
 * and FX in unrevealed cells all fog uniformly without touching any renderer.
 *
 * Three tiers, classic FoW semantics:
 *   - in sight now      → full brightness (a soft disc around each reveal source),
 *   - explored memory   → dimmed (terrain you've seen stays faintly readable),
 *   - never explored    → near-black.
 *
 * Fog state is a zone-sized RG texture (R = current sight, G = max-ever explored),
 * rewritten on the CPU each frame (~2.4k texels for a 60×40 zone — trivial) from
 * the reveal sources' render positions. Linear filtering gives the soft edges.
 *
 * The shader needs each pixel's WORLD position to sample the fog map. A flat
 * ground-plane projection would misplace the fog edge by ~1.2×height at the
 * follow camera's angle — 4–5 cells on the western bluffs (`Terrain.heightAt`:
 * bluffs +1.6–3.8, edge hills +4.5, terraces). Instead the terrain height field
 * (analytic, static per zone) is BAKED into a small texture at reset, and the
 * shader ray-marches the camera ray against it: exact on any terrain, no depth
 * attachment or EffectComposer target surgery (which is fragile under the
 * SwiftShader capture harness), fully deterministic. Tall props sample the
 * terrain cell at their feet — at worst one soft-edged cell of slack at a prop's
 * top, invisible in practice.
 *
 * Determinism: state is a pure function of the reveal sources' positions — no
 * RNG, no wall clock — so capture-harness shots stay byte-stable.
 */

/** Sight radius around a reveal source, in cells (soft edge inside). Sized to
 *  the FOLLOW VIEW's whole screen: the fog's purpose is to stop route
 *  PRE-computation across the map (#129), not to shrink what you watch — so
 *  the pinned view reads fully lit and the dark starts at the screen edge.
 *  Derivation: FOLLOW_OFFSET (14,16,14) × zoom 1 puts the camera ~25.5 units
 *  out at a ~39° pitch (FOV 45°). The on-screen ground footprint is a
 *  TRAPEZOID — ~15 units behind the idler but ~38 ahead at the very top of
 *  frame (the horizon compresses those last units into a few pixels). r=28
 *  reaches ~86% of screen height at full brightness; the falloff band carries
 *  it to ~95%, leaving only the horizon sliver dark. (First pass was 9 —
 *  torchlight — then 20; both left visible dark bands the operator redlined.) */
const SIGHT_CELLS = 28;
/** Width of the soft falloff band at the sight edge, in cells. */
const SIGHT_SOFT = 8;
/** Brightness floor for never-explored cells (linear, pre-tonemap). Low enough
 *  that even a white-hot nameplate sprite multiplies down to illegible — at
 *  0.05 a distant idler's name still ghosted through the dark (caught on the
 *  first capture eyeball). Braziers still read as faint embers: static zone
 *  furniture, kept as navigation lights. */
const UNEXPLORED_LEVEL = 0.02;
/** Brightness for explored-but-not-in-sight memory. */
const MEMORY_LEVEL = 0.4;
/** Height-field bake resolution, texels per world unit. */
const HEIGHT_RES = 1;

const FogShader = {
  name: "FogOfWarShader",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tFog: { value: null as THREE.Texture | null },
    tHeight: { value: null as THREE.Texture | null },
    /** Playfield size in cells — fog UV = worldXZ / zoneSize. */
    zoneSize: { value: new THREE.Vector2(1, 1) },
    /** World min corner + span of the baked height field (terrain incl. fringe). */
    heightMin: { value: new THREE.Vector2(0, 0) },
    heightSpan: { value: new THREE.Vector2(1, 1) },
    /** Height decode range: x = min height, y = max height (world units). */
    heightRange: { value: new THREE.Vector2(0, 1) },
    /** x = unexplored floor, y = memory level. */
    levels: { value: new THREE.Vector2(UNEXPLORED_LEVEL, MEMORY_LEVEL) },
    cameraPos: { value: new THREE.Vector3() },
    /** Live references to the scene camera's matrices (assigned at wire-up). */
    camWorld: { value: new THREE.Matrix4() },
    projInv: { value: new THREE.Matrix4() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tFog;
    uniform sampler2D tHeight;
    uniform vec2 zoneSize;
    uniform vec2 heightMin;
    uniform vec2 heightSpan;
    uniform vec2 heightRange;
    uniform vec2 levels;
    uniform vec3 cameraPos;
    uniform mat4 camWorld;
    uniform mat4 projInv;
    varying vec2 vUv;

    float groundH(vec2 p) {
      vec2 huv = clamp((p - heightMin) / heightSpan, 0.0, 1.0);
      return heightRange.x + texture2D(tHeight, huv).r * (heightRange.y - heightRange.x);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // World-space view ray through this pixel (far-plane unproject).
      vec4 farView = projInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize((camWorld * vec4(farView.xyz / farView.w, 0.0)).xyz);
      // Skyline and upward rays never meet the ground: leave them unfogged.
      if (dir.y > -0.02) { gl_FragColor = color; return; }
      // Bracket the terrain crossing between the max- and min-height planes,
      // then a coarse march + bisection refinement finds the surface point.
      // Degenerate brackets (camera below the terrain floor — not reachable
      // with the shipped cameras) collapse the span to zero: the loop finds no
      // crossing and the sample falls back to t1's floor-plane point. Grazing
      // rays step coarsely (~span/24) and can tunnel a thin ridge crest — at
      // worst the sample lands a soft-edged cell or two off, at the horizon.
      float t0 = max((heightRange.y - cameraPos.y) / dir.y, 0.0);
      float t1 = max((heightRange.x - cameraPos.y) / dir.y, t0);
      float tHit = t1;
      float stp = (t1 - t0) / 24.0;
      for (int i = 1; i <= 24; i++) {
        float ti = t0 + stp * float(i);
        vec3 q = cameraPos + dir * ti;
        if (q.y <= groundH(q.xz)) {
          float lo = ti - stp;
          float hi = ti;
          for (int j = 0; j < 5; j++) {
            float mid = 0.5 * (lo + hi);
            vec3 m = cameraPos + dir * mid;
            if (m.y <= groundH(m.xz)) { hi = mid; } else { lo = mid; }
          }
          tHit = 0.5 * (lo + hi);
          break;
        }
      }
      vec2 wp = cameraPos.xz + dir.xz * tHit;
      // Outside the playfield (fringe hills, the sea) inherits the edge cell.
      vec2 f = texture2D(tFog, clamp(wp / zoneSize, 0.0, 1.0)).rg;
      float b = max(f.r, max(f.g * levels.y, levels.x));
      gl_FragColor = vec4(color.rgb * b, color.a);
    }`,
};

export class FogOfWar {
  readonly pass: ShaderPass;
  private w = 0;
  private h = 0;
  private cur = new Float32Array(0);
  private explored = new Float32Array(0);
  private texels = new Uint8Array(0);
  private fogTex: THREE.DataTexture | null = null;
  private heightTex: THREE.DataTexture | null = null;

  constructor() {
    this.pass = new ShaderPass(FogShader);
    this.pass.enabled = false; // armed by reset() once a zone exists
  }

  /** Wire the live camera matrices once — three uploads current values at each
   *  render, so the pass always sees the frame's camera without per-frame sets. */
  attachCamera(camera: THREE.PerspectiveCamera): void {
    const u = this.pass.uniforms;
    u.cameraPos.value = camera.position;
    u.camWorld.value = camera.matrixWorld;
    u.projInv.value = camera.projectionMatrixInverse;
  }

  /** New zone: size the fog grid, bake the terrain height field, arm the pass.
   *  `heightAt` is Terrain's analytic surface; `pad` its fringe extent. */
  reset(w: number, h: number, heightAt: (x: number, z: number) => number, pad: number): void {
    this.w = w;
    this.h = h;
    this.cur = new Float32Array(w * h);
    this.explored = new Float32Array(w * h);
    this.texels = new Uint8Array(w * h * 2);
    this.fogTex?.dispose();
    this.fogTex = new THREE.DataTexture(this.texels, w, h, THREE.RGFormat);
    this.fogTex.magFilter = THREE.LinearFilter;
    this.fogTex.minFilter = THREE.LinearFilter;
    // Tight-packed rows: GL's default UNPACK_ALIGNMENT of 4 would shear any
    // texture whose row byte-length isn't a multiple of 4 (an odd zone width
    // here; w+2·PAD widths on the height bake below — the shipped shore's 90).
    this.fogTex.unpackAlignment = 1;
    this.fogTex.needsUpdate = true;

    // Bake the height field over the terrain's full span (playfield + fringe),
    // normalized to its own min/max so 8 bits cover the range cleanly.
    const minX = -pad;
    const minZ = -pad;
    const spanX = w + pad * 2;
    const spanZ = h + pad * 2;
    const hw = Math.ceil(spanX * HEIGHT_RES);
    const hh = Math.ceil(spanZ * HEIGHT_RES);
    const raw = new Float32Array(hw * hh);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = 0; j < hh; j++) {
      for (let i = 0; i < hw; i++) {
        const y = heightAt(minX + (i + 0.5) / HEIGHT_RES, minZ + (j + 0.5) / HEIGHT_RES);
        raw[j * hw + i] = y;
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    const range = Math.max(hi - lo, 1e-3);
    const bytes = new Uint8Array(hw * hh);
    for (let i = 0; i < raw.length; i++) bytes[i] = Math.round(((raw[i] - lo) / range) * 255);
    this.heightTex?.dispose();
    this.heightTex = new THREE.DataTexture(bytes, hw, hh, THREE.RedFormat);
    this.heightTex.magFilter = THREE.LinearFilter;
    this.heightTex.minFilter = THREE.LinearFilter;
    this.heightTex.unpackAlignment = 1; // R8 rows of w+68 bytes — see fogTex note
    this.heightTex.needsUpdate = true;

    const u = this.pass.uniforms;
    u.tFog.value = this.fogTex;
    u.tHeight.value = this.heightTex;
    u.zoneSize.value.set(w, h);
    u.heightMin.value.set(minX, minZ);
    u.heightSpan.value.set(spanX, spanZ);
    u.heightRange.value.set(lo, hi);
    this.pass.enabled = true;
  }

  /** Recompute the sight layer from this frame's reveal sources (world XZ, sim
   *  units) and fold it into the explored memory. Call once per frame. */
  update(sources: Array<{ x: number; z: number }>): void {
    if (!this.fogTex) return;
    const { w, h, cur, explored, texels } = this;
    cur.fill(0);
    for (const s of sources) {
      const x0 = Math.max(0, Math.floor(s.x - SIGHT_CELLS - 1));
      const x1 = Math.min(w - 1, Math.ceil(s.x + SIGHT_CELLS + 1));
      const z0 = Math.max(0, Math.floor(s.z - SIGHT_CELLS - 1));
      const z1 = Math.min(h - 1, Math.ceil(s.z + SIGHT_CELLS + 1));
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - s.x;
          const dz = z + 0.5 - s.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          const v = Math.min(1, Math.max(0, (SIGHT_CELLS - d) / SIGHT_SOFT));
          const i = z * w + x;
          if (v > cur[i]) cur[i] = v;
        }
      }
    }
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] > explored[i]) explored[i] = cur[i];
      texels[i * 2] = (cur[i] * 255) | 0;
      texels[i * 2 + 1] = (explored[i] * 255) | 0;
    }
    this.fogTex.needsUpdate = true;
  }

  dispose(): void {
    this.fogTex?.dispose();
    this.heightTex?.dispose();
    this.pass.dispose();
  }
}
