import * as THREE from "three";
import type { AssetLibrary } from "./Assets";

/**
 * Cosmetic terrain: the sim stays strictly 2D; the client displaces the
 * ground and makes everything sample heightAt() for its foot height. The
 * heightmap is pure deterministic math from the zone dimensions, so every
 * viewer sees the same shore.
 *
 * The zone is a LONG STRAND walked south → north: the sea runs along the
 * whole EAST edge with a gently meandering waterline and foam lapping onto
 * a wide sand band; bluffs rise to the west and close both ends.
 */

/** Padding rendered beyond the playable zone so the world doesn't end. */
const PAD = 34;
const WATER_Y = -0.3;
/** How far the beach band reaches inland from the waterline. */
const BEACH_DEPTH = 13;

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

interface FoamWave {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  phase: number;
}

export class Terrain {
  readonly group = new THREE.Group();
  private water: THREE.Mesh | null = null;
  private foam: FoamWave[] = [];
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

  /** Where the sea meets the sand, gently meandering along the strand. */
  waterlineX(z: number): number {
    return this.zoneW + 1 + (vnoise(z * 0.045, 7.7, this.seed ^ 31) * 2 - 1) * 1.4;
  }

  /**
   * Ground height at a world position. The same function shapes the mesh,
   * so feet and geometry always agree.
   */
  heightAt(x: number, z: number): number {
    const { zoneW: w, zoneH: h } = this;
    // Gentle dunes everywhere…
    let y = vnoise(x * 0.06, z * 0.06, this.seed) * 0.9 + vnoise(x * 0.22, z * 0.22, this.seed ^ 7) * 0.22 - 0.5;
    // …rising westward into ridged bluffs (strongest at and beyond x=0).
    const westness = smoothstep(w * 0.55, -8, x);
    const ridge = vnoise(x * 0.11, z * 0.05, this.seed ^ 13);
    y += westness * (1.6 + ridge * 2.2);
    // Hills also close the strand's two ends.
    const out = Math.max(0, -z, z - h);
    y += smoothstep(4, PAD - 8, out) * 4.5;

    // The strand: a wide flat sand band easing east into the sea.
    const xw = this.waterlineX(z);
    const beach = smoothstep(xw - BEACH_DEPTH, xw - 3, x);
    y = y * (1 - beach) + 0.08 * beach; // flatten onto the sand
    const toSea = smoothstep(xw - 3, xw, x);
    y = y * (1 - toSea) + (WATER_Y + 0.12) * toSea; // ease to the waterline
    if (x > xw) y = WATER_Y + 0.12 - (x - xw) * 0.3; // seafloor falls away
    return Math.max(y, WATER_Y - 3.2);
  }

  /** Build ground, water, foam, and sky; scatter props. Call once per zone. */
  build(assets: AssetLibrary): void {
    const { zoneW: w, zoneH: h } = this;
    const minX = -PAD;
    const spanX = w + PAD * 2;
    const minZ = -PAD;
    const spanZ = h + PAD * 2;
    const segsX = 70;
    const segsZ = 150;

    // -- displaced, vertex-colored ground --
    const geo = new THREE.PlaneGeometry(spanX, spanZ, segsX, segsZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const sand = new THREE.Color(0x2b2738);
    const inland = new THREE.Color(0x191726);
    const rock = new THREE.Color(0x121119);
    const wet = new THREE.Color(0x232c3e);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + minX + spanX / 2;
      const z = pos.getZ(i) + minZ + spanZ / 2;
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      // Pale dry sand on the strand, darker soil inland, rock on the
      // bluffs, wet sheen where the tide reaches.
      const xw = this.waterlineX(z);
      const beach = smoothstep(xw - BEACH_DEPTH, xw - 4, x);
      const high = smoothstep(1.2, 4.0, y);
      const wetness = smoothstep(xw - 2.5, xw + 1, x);
      tmp.copy(inland).lerp(sand, beach).lerp(rock, high).lerp(wet, wetness);
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

    // -- the sea: a broad plane east of the waterline --
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(PAD + 40, spanZ),
      new THREE.MeshStandardMaterial({
        color: 0x16344f,
        roughness: 0.16,
        metalness: 0.3,
        transparent: true,
        opacity: 0.9,
        emissive: 0x081523,
        emissiveIntensity: 0.7,
      }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(w + (PAD + 40) / 2 - 6, WATER_Y, minZ + spanZ / 2);
    this.group.add(this.water);

    // -- lapping waves: foam strips that roll up the sand and fade --
    const foamTex = this.makeFoamTexture();
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: foamTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, spanZ), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.foam.push({ mesh, mat, phase: i / 3 });
    }

    // -- sky: gradient dome + a sparse field of stars --
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(260, 24, 12),
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
      starPos[i * 3] = w / 2 + 245 * Math.cos(el) * Math.cos(az);
      starPos[i * 3 + 1] = 245 * Math.sin(el);
      starPos[i * 3 + 2] = h / 2 + 245 * Math.cos(el) * Math.sin(az);
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

  /** Soft-edged foam band. */
  private makeFoamTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, 32, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.35, "rgba(220,235,255,0.85)");
    grad.addColorStop(0.55, "rgba(200,220,245,0.5)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 256);
    // Break the band up so it reads as foam, not a stripe.
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 90; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 32, Math.random() * 256, 1.5 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 8);
    return tex;
  }

  /**
   * Deterministic set dressing. Props are cosmetic (no collision); density
   * is biased away from the strand so the fighting lane stays readable.
   */
  private scatterProps(assets: AssetLibrary, rng: () => number): void {
    const { zoneW: w, zoneH: h } = this;
    const spawnX = w / 2;
    const spawnZ = h - 8;
    const beachLeftX = w - BEACH_DEPTH;

    const placeOne = (
      key: string,
      x: number,
      z: number,
      scale: number,
      opts: { lieDown?: boolean; castShadow?: boolean } = {},
    ): void => {
      const y = this.heightAt(x, z);
      if (y < WATER_Y + 0.1 && !opts.lieDown) return;
      const obj = assets.instantiateProp(key);
      if (!obj) return;
      obj.scale.setScalar(scale);
      obj.rotation.y = rng() * Math.PI * 2;
      if (opts.lieDown) {
        obj.rotation.z = Math.PI / 2 - 0.15 + rng() * 0.3;
        obj.position.set(x, y + 0.15, z);
      } else {
        obj.position.set(x, y - 0.06, z);
      }
      if (opts.castShadow === false) {
        obj.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = false;
        });
      }
      this.group.add(obj);
    };

    const pick = (keys: string[]) => keys[Math.floor(rng() * keys.length)];
    const clearOfSpawn = (x: number, z: number, r = 7) => Math.hypot(x - spawnX, z - spawnZ) >= r;

    // Inland dressing (west of the strand): rocks and dead trees, denser
    // toward the bluffs and beyond both ends.
    for (let i = 0; i < 46; i++) {
      const edge = rng() < 0.6;
      const x = edge ? -2 - rng() * 16 : rng() * beachLeftX;
      const z = -12 + rng() * (h + 24);
      if (!clearOfSpawn(x, z)) continue;
      placeOne(pick(["rock_1", "rock_2", "rock_3"]), x, z, 0.35 + rng() * 0.9);
    }
    for (let i = 0; i < 18; i++) {
      const x = -8 + rng() * (beachLeftX * 0.9 + 8);
      const z = -8 + rng() * (h + 16);
      placeOne(pick(["deadtree_1", "deadtree_2", "deadtree_3"]), x, z, 0.3 + rng() * 0.22);
    }
    // Dry grass keeps to the inland soil, not the open sand.
    for (let i = 0; i < 110; i++) {
      const x = rng() * (beachLeftX - 1);
      const z = rng() * h;
      if (!clearOfSpawn(x, z)) continue;
      placeOne(pick(["grass_1", "grass_2"]), x, z, 0.7 + rng() * 0.5, { castShadow: false });
    }
    // Driftwood: dead trees washed up along the sand, half-buried.
    for (let i = 0; i < 12; i++) {
      const x = beachLeftX + 2 + rng() * (BEACH_DEPTH - 5);
      const z = rng() * h;
      if (!clearOfSpawn(x, z, 9)) continue;
      placeOne(pick(["deadtree_1", "deadtree_2"]), x, z, 0.2 + rng() * 0.14, { lieDown: true });
    }
    // A rocky headland reaching into the surf partway up the strand.
    for (let i = 0; i < 8; i++) {
      const x = w - 5 + rng() * 8;
      const z = h * 0.32 + rng() * (h * 0.06);
      placeOne(pick(["rock_1", "rock_2", "rock_3"]), x, z, 1.0 + rng() * 1.3);
    }
    // Camp clutter near the spawn beach.
    for (let i = 0; i < 6; i++) {
      const x = spawnX - 9 + rng() * 18;
      const z = spawnZ - 5 + rng() * 9;
      if (Math.hypot(x - spawnX, z - spawnZ) < 3.5) continue;
      placeOne(pick(["barrel", "crate"]), x, z, 0.85 + rng() * 0.25);
    }
  }

  /** Tide bob and the lapping foam cycle. */
  update(t: number): void {
    const { zoneW: w, zoneH: h } = this;
    if (this.water) this.water.position.y = WATER_Y + Math.sin(t * 0.4) * 0.05;
    for (const f of this.foam) {
      const p = (t / 6.5 + f.phase) % 1;
      // Roll from the sea up onto the sand, pause, and dissolve.
      const reach = 1 - Math.pow(1 - Math.min(1, p * 1.25), 2); // ease-out
      const x = w + 5.5 - reach * 7.5;
      f.mesh.position.set(x, WATER_Y + 0.16 + reach * 0.16, h / 2);
      f.mat.opacity = Math.sin(Math.min(1, p * 1.1) * Math.PI) * 0.55;
      (f.mat.map as THREE.Texture).offset.y = f.phase + t * 0.004;
    }
  }
}
