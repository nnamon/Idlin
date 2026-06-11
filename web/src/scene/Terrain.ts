import * as THREE from "three";
import type { AssetLibrary } from "./Assets";

/**
 * Cosmetic terrain: the sim stays strictly 2D; the client displaces the
 * ground and makes everything sample heightAt() for its foot height. The
 * heightmap is pure deterministic math from the zone dimensions, so every
 * viewer sees the same shore.
 */

/** Padding rendered beyond the playable zone so the world doesn't end. */
const PAD = 34;
const WATER_Y = -0.42;

function hash2(ix: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Bilinear value noise in [0, 1]. */
function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Deterministic PRNG for the prop scatter. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Terrain {
  readonly group = new THREE.Group();
  private water: THREE.Mesh | null = null;
  private seed: number;

  constructor(
    private zoneW: number,
    private zoneH: number,
    seedStr: string,
  ) {
    let h = 0;
    for (const c of seedStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    this.seed = h;
  }

  /**
   * Ground height at a world position. The same function shapes the mesh,
   * so feet and geometry always agree.
   */
  heightAt(x: number, z: number): number {
    const { zoneW: w, zoneH: h } = this;
    // Rolling dunes, gentler inside the playable area for legibility.
    let y = vnoise(x * 0.055, z * 0.055, this.seed) * 1.3 + vnoise(x * 0.21, z * 0.21, this.seed ^ 7) * 0.3 - 0.7;
    const inside =
      smoothstep(-2, 6, x) * smoothstep(-2, 6, w - x) * smoothstep(-2, 6, z) * smoothstep(-2, 6, h - z);
    y *= 0.55 + 0.45 * (1 - inside);
    // Hills rise beyond the north/east/west bounds to close the horizon.
    const out = Math.max(0, -x, x - w, -z);
    y += smoothstep(4, PAD - 6, out) * 5.5;
    // The south edge slopes down into the sea — the withered shore itself.
    y = y * (1 - smoothstep(h - 7, h + 6, z)) + (WATER_Y - 0.5) * smoothstep(h - 7, h + 6, z);
    return y;
  }

  /** Build ground, water, and sky; scatter props. Call once per zone. */
  build(assets: AssetLibrary): void {
    const { zoneW: w, zoneH: h } = this;
    const minX = -PAD;
    const maxX = w + PAD;
    const minZ = -PAD;
    const maxZ = h + PAD;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const segs = 110;

    // -- displaced, vertex-colored ground --
    const geo = new THREE.PlaneGeometry(spanX, spanZ, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0x232133);
    const dark = new THREE.Color(0x131320);
    const wet = new THREE.Color(0x1b2333);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + minX + spanX / 2;
      const z = pos.getZ(i) + minZ + spanZ / 2;
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      // Sand on the flats, darker rock on the rises, wet sheen at the shore.
      const high = smoothstep(0.6, 3.5, y);
      const shore = smoothstep(0.1, -0.5, y);
      tmp.copy(sand).lerp(dark, high).lerp(wet, shore);
      const grain = 0.92 + 0.16 * vnoise(x * 1.7, z * 1.7, this.seed ^ 99);
      colors[i * 3] = tmp.r * grain;
      colors[i * 3 + 1] = tmp.g * grain;
      colors[i * 3 + 2] = tmp.b * grain;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96 }),
    );
    ground.position.set(minX + spanX / 2, 0, minZ + spanZ / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // -- the sea, south of the shore --
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX, PAD + 26),
      new THREE.MeshStandardMaterial({
        color: 0x14304a,
        roughness: 0.18,
        metalness: 0.25,
        transparent: true,
        opacity: 0.88,
        emissive: 0x07101e,
        emissiveIntensity: 0.6,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(minX + spanX / 2, WATER_Y, h + (PAD + 26) / 2 - 4);
    this.group.add(this.water);

    // -- sky: gradient dome + a sparse field of stars --
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(230, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x05060d) },
          bottom: { value: new THREE.Color(0x141a30) },
        },
        vertexShader: `
          varying float vY;
          void main() {
            vY = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 top;
          uniform vec3 bottom;
          varying float vY;
          void main() {
            gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.45, vY)), 1.0);
          }`,
      }),
    );
    sky.position.set(w / 2, 0, h / 2);
    this.group.add(sky);

    const rng = mulberry32(this.seed ^ 0x51a55);
    const starPos = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      const az = rng() * Math.PI * 2;
      const el = 0.12 + rng() * 1.3;
      starPos[i * 3] = w / 2 + 215 * Math.cos(el) * Math.cos(az);
      starPos[i * 3 + 1] = 215 * Math.sin(el);
      starPos[i * 3 + 2] = h / 2 + 215 * Math.cos(el) * Math.sin(az);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({
        color: 0xcdd6ff,
        size: 0.9,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.75,
        fog: false,
      }),
    );
    this.group.add(stars);

    this.scatterProps(assets, rng);
  }

  /**
   * Deterministic set dressing. Props are cosmetic (no collision); density
   * is biased toward the zone edges so the fighting lanes stay readable.
   */
  private scatterProps(assets: AssetLibrary, rng: () => number): void {
    const { zoneW: w, zoneH: h } = this;
    const spawnX = w / 2;
    const spawnZ = h * 0.9;

    const place = (
      keys: string[],
      count: number,
      minScale: number,
      maxScale: number,
      opts: { edgeBias?: boolean; insideOnly?: boolean; castShadow?: boolean } = {},
    ) => {
      for (let i = 0; i < count; i++) {
        let x: number;
        let z: number;
        if (opts.edgeBias && rng() < 0.65) {
          // A ring just outside the playable bounds (never over the water).
          const side = rng();
          const d = 2 + rng() * (PAD - 14);
          if (side < 0.4) {
            x = -d;
            z = rng() * h;
          } else if (side < 0.8) {
            x = w + d;
            z = rng() * h;
          } else {
            x = rng() * w;
            z = -d;
          }
        } else {
          x = (opts.insideOnly ? 0 : -10) + rng() * (w + (opts.insideOnly ? 0 : 20));
          z = (opts.insideOnly ? 0 : -10) + rng() * (h * 0.94 + (opts.insideOnly ? 0 : 10));
        }
        // Keep the spawn clearing and the shoreline water free.
        if (Math.hypot(x - spawnX, z - spawnZ) < 7) continue;
        const y = this.heightAt(x, z);
        if (y < WATER_Y + 0.15) continue;
        const obj = assets.instantiateProp(keys[Math.floor(rng() * keys.length)]);
        if (!obj) continue;
        const s = minScale + rng() * (maxScale - minScale);
        obj.scale.setScalar(s);
        obj.rotation.y = rng() * Math.PI * 2;
        obj.position.set(x, y - 0.06, z);
        if (opts.castShadow === false) {
          obj.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = false;
          });
        }
        this.group.add(obj);
      }
    };

    place(["rock_1", "rock_2", "rock_3"], 30, 0.35, 1.25, { edgeBias: true });
    place(["deadtree_1", "deadtree_2", "deadtree_3"], 14, 0.3, 0.52, { edgeBias: true });
    place(["grass_1", "grass_2"], 90, 0.7, 1.25, { insideOnly: true, castShadow: false });
    // A little camp clutter near the spawn beach.
    place(["barrel", "crate"], 6, 0.85, 1.1, { insideOnly: true });
  }

  /** Gentle tide bob. */
  update(t: number): void {
    if (this.water) this.water.position.y = WATER_Y + Math.sin(t * 0.45) * 0.05;
  }
}
