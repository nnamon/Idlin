import * as THREE from "three";
import type { TileMapState } from "../gen/TileMapState";
import type { TileVisual } from "../gen/TileVisual";
import type { ZoneObstacle } from "../world/store";
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
  /** Tall meshes that can hide idlers (walls, buildings); ZoneRenderer
   *  fades whichever stand between the lens and a character. */
  readonly occluders: THREE.Object3D[] = [];
  /** Brazier cells from an authored map; empty = caller's classic trail. */
  readonly brazierSpots: Array<[number, number]> = [];
  private water: THREE.Mesh | null = null;
  private foam: FoamWave[] = [];
  private seed: number;
  // -- authored-map drive (tiles own layout; this class owns beauty) --
  private tiles: TileMapState | null = null;
  private byGlyph = new Map<string, TileVisual>();
  private groundColors = new Map<string, THREE.Color>();
  private waterEdge: number[] | null = null;
  private hasWater = false;

  /** Drive the terrain from an authored tile map (call before build). */
  setTiles(tiles: TileMapState): void {
    this.tiles = tiles;
    this.byGlyph = new Map(tiles.legend.map((l) => [l.glyph, l]));
    for (const l of tiles.legend) {
      this.groundColors.set(l.glyph, new THREE.Color(l.ground));
    }
    // Per-row x of the first water cell (the authored waterline), lightly
    // smoothed so the heightmap meanders instead of stair-stepping.
    const raw: number[] = [];
    for (let z = 0; z < tiles.height; z++) {
      let edge = tiles.width + 18;
      const row = tiles.rows[z];
      for (let x = 0; x < tiles.width; x++) {
        if (this.byGlyph.get(row[x])?.ground_id === "water") {
          edge = x;
          break;
        }
      }
      raw.push(edge);
    }
    this.hasWater = raw.some((e) => e <= tiles.width);
    if (this.hasWater) {
      this.waterEdge = raw.map((_, z) => {
        let sum = 0;
        let n = 0;
        for (let dz = -2; dz <= 2; dz++) {
          const v = raw[Math.min(raw.length - 1, Math.max(0, z + dz))];
          sum += v;
          n++;
        }
        return sum / n;
      });
    }
  }


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
    if (this.tiles) {
      if (!this.waterEdge) return this.zoneW + PAD + 60; // dry map: no sea
      const i = Math.min(this.waterEdge.length - 1, Math.max(0, Math.round(z)));
      return this.waterEdge[i] + (vnoise(z * 0.05, 7.7, this.seed ^ 31) * 2 - 1) * 0.6;
    }
    return this.zoneW + 1 + (vnoise(z * 0.045, 7.7, this.seed ^ 31) * 2 - 1) * 1.4;
  }

  /**
   * Ground height at a world position. The same function shapes the mesh,
   * so feet and geometry always agree.
   */
  heightAt(x: number, z: number): number {
    const { zoneW: w, zoneH: h } = this;
    if (this.tiles && !this.hasWater) {
      // Dry authored ground (the town): a gentle plateau ringed by hills.
      let y = vnoise(x * 0.08, z * 0.08, this.seed) * 0.22 - 0.08;
      const out = Math.max(0, -x, x - w, -z, z - h);
      y += smoothstep(2, PAD - 8, out) * (3.5 + vnoise(x * 0.09, z * 0.09, this.seed ^ 13) * 2.2);
      return y;
    }
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
  build(assets: AssetLibrary, obstacles: ZoneObstacle[] = []): void {
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
      const tileCol = this.tiles ? this.groundColorAt(x, z) : null;
      if (tileCol) {
        // Authored ground: the tileset palette IS the base coat; the
        // shore touches (wet sheen, rocky heights) layer on top.
        tmp.copy(tileCol).lerp(rock, high).lerp(wet, wetness * (this.hasWater ? 1 : 0));
      } else {
        tmp.copy(inland).lerp(sand, beach).lerp(rock, high).lerp(wet, wetness);
      }
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
    if (!this.tiles || this.hasWater) {
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
    const seaFrom = this.tiles ? Math.min(...(this.waterEdge ?? [w])) - 2 : w - 6;
    this.water.position.set(seaFrom + (PAD + 46) / 2, WATER_Y, minZ + spanZ / 2);
    this.group.add(this.water);
    }

    // -- lapping waves: foam strips that roll up the sand and fade --
    const foamTex = this.makeFoamTexture();
    for (let i = 0; i < (!this.tiles || this.hasWater ? 3 : 0); i++) {
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

    if (this.tiles) {
      this.scatterFringe(assets, rng);
      this.placeTileProps(assets, rng);
    } else {
      this.scatterProps(assets, rng);
      this.placeObstacles(assets, obstacles, rng);
    }
  }

  private groundColorAt(x: number, z: number): THREE.Color | null {
    if (!this.tiles) return null;
    const tx = Math.min(this.tiles.width - 1, Math.max(0, Math.floor(x)));
    const tz = Math.min(this.tiles.height - 1, Math.max(0, Math.floor(z)));
    return this.groundColors.get(this.tiles.rows[tz][tx]) ?? null;
  }

  /** Authored maps: every cell's prop, plus the props.ron set pieces —
   *  rendered onto the SCULPTED ground (tiles own layout, not looks). */
  private placeTileProps(assets: AssetLibrary, rng: () => number): void {
    const tiles = this.tiles!;
    const { width: w, height: h, rows } = tiles;
    const walkAt = (xx: number, yy: number): boolean => {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
      return !!this.byGlyph.get(rows[yy][xx])?.walkable;
    };
    const put = (key: string, x: number, z: number, scale: number, rot: number) => {
      const obj = assets.instantiateProp(key);
      if (!obj) return null;
      obj.scale.setScalar(scale);
      obj.rotation.y = rot;
      obj.position.set(x, this.heightAt(x, z) - 0.06, z);
      this.group.add(obj);
      return obj;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const vis = this.byGlyph.get(rows[y][x]);
        if (!vis?.prop) continue;
        const cx = x + 0.5;
        const cz = y + 0.5;
        const r = hash2(x, y, this.seed ^ 5);
        switch (vis.prop) {
          case "rock":
            put(["rock_1", "rock_2", "rock_3"][Math.floor(r * 3) % 3], cx, cz, 0.45 + r * 0.3, r * Math.PI * 2);
            break;
          case "tree":
          case "dead_tree":
            put(["deadtree_1", "deadtree_2", "deadtree_3"][Math.floor(r * 3) % 3], cx, cz, 0.3 + r * 0.12, r * Math.PI * 2);
            break;
          case "tuft":
            put(["grass_1", "grass_2"][Math.floor(r * 2) % 2], cx, cz, 0.7 + r * 0.4, r * Math.PI * 2);
            break;
          case "brazier":
            this.brazierSpots.push([cx, cz]);
            break;
          case "crate":
            put("crate_town", cx, cz, 1, r * Math.PI);
            break;
          case "wagon":
            put("wagon", cx, cz, 1, r * Math.PI * 2);
            break;
          case "fence":
            put("fence_wood", cx, cz, 1, 0);
            break;
          case "wall": {
            // Directional piece: face the walkable side; interior cells
            // face the map center. Squeeze to tile per cell (1.54u run).
            let rot = 0;
            if (walkAt(x, y + 1)) rot = 0;
            else if (walkAt(x, y - 1)) rot = Math.PI;
            else if (walkAt(x + 1, y)) rot = -Math.PI / 2;
            else if (walkAt(x - 1, y)) rot = Math.PI / 2;
            else {
              const dx = w / 2 - cx;
              const dz = h / 2 - cz;
              rot = Math.abs(dx) > Math.abs(dz)
                ? (dx > 0 ? -Math.PI / 2 : Math.PI / 2)
                : (dz > 0 ? 0 : Math.PI);
            }
            const obj = put("wall_town", cx, cz, 1, rot);
            if (obj) {
              obj.scale.x = 1 / 1.54;
              obj.traverse((o) => (o.userData.occRoot = obj));
              this.occluders.push(obj);
            }
            break;
          }
          default:
            break;
        }
      }
    }
    // Set pieces (props.ron): whole buildings on their footprints.
    for (const pr of tiles.props) {
      const obj = assets.instantiateProp(pr.model);
      if (!obj) continue;
      obj.rotation.y = (pr.rot_deg * Math.PI) / 180;
      const px = pr.x_u + 0.5;
      const pz = pr.y_u + 0.5;
      obj.position.set(px, this.heightAt(px, pz) - 0.04, pz);
      obj.traverse((o) => {
        o.userData.occRoot = obj;
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.group.add(obj);
      this.occluders.push(obj);
    }
    rng(); // keep the dressing stream warm for parity with legacy builds
  }

  /** Fringe dressing OUTSIDE the playable bounds — the part of the old
   *  scatter that sells the world past the map's edge. */
  private scatterFringe(assets: AssetLibrary, rng: () => number): void {
    const { zoneW: w, zoneH: h } = this;
    const placeOne = (key: string, x: number, z: number, scale: number) => {
      const y = this.heightAt(x, z);
      if (this.hasWater && y < WATER_Y + 0.1) return;
      const obj = assets.instantiateProp(key);
      if (!obj) return;
      obj.scale.setScalar(scale);
      obj.rotation.y = rng() * Math.PI * 2;
      obj.position.set(x, y - 0.06, z);
      this.group.add(obj);
    };
    const pick = (keys: string[]) => keys[Math.floor(rng() * keys.length)];
    for (let i = 0; i < 40; i++) {
      const side = rng();
      const x = side < 0.4 ? -2 - rng() * 16 : side < 0.8 ? w + 2 + rng() * 14 : rng() * w;
      const inside = x > -2 && x < w + 2;
      const z = inside ? (rng() < 0.5 ? -12 + rng() * 10 : h + 2 + rng() * 10) : -12 + rng() * (h + 24);
      if (this.hasWater && x > w) continue; // the sea owns the east
      placeOne(pick(["rock_1", "rock_2", "rock_3"]), x, z, 0.35 + rng() * 0.9);
    }
    for (let i = 0; i < 14; i++) {
      const x = -8 - rng() * 10;
      const z = -8 + rng() * (h + 16);
      placeOne(pick(["deadtree_1", "deadtree_2", "deadtree_3"]), x, z, 0.3 + rng() * 0.22);
    }
    if (this.hasWater) {
      // The rocky headland in the surf, beyond the walkable bound.
      for (let i = 0; i < 8; i++) {
        const x = w + 0.8 + rng() * 4.5;
        const z = h * 0.32 + rng() * (h * 0.06);
        placeOne(pick(["rock_1", "rock_2", "rock_3"]), x, z, 1.0 + rng() * 1.3);
      }
    }
  }

  /**
   * Sim-generated obstacles: the authoritative non-walkable rocks/trees.
   * Rendered exactly where the sim put them — entities slide around these.
   */
  private placeObstacles(assets: AssetLibrary, obstacles: ZoneObstacle[], rng: () => number): void {
    const ROCKS = ["rock_1", "rock_2", "rock_3"];
    const TREES = ["deadtree_1", "deadtree_2", "deadtree_3"];
    for (const ob of obstacles) {
      const keys = ob.kind === 1 ? TREES : ROCKS;
      const obj = assets.instantiateProp(keys[Math.floor(rng() * keys.length)]);
      if (!obj) continue;
      // Footprint → visual scale: rock bases are ~1u radius at scale 1,
      // tree trunks much thinner than their canopy footprint.
      const s = ob.kind === 1 ? Math.max(0.26, ob.radius * 0.5) : Math.max(0.3, ob.radius * 0.95);
      obj.scale.setScalar(s);
      obj.rotation.y = rng() * Math.PI * 2;
      obj.position.set(ob.x, this.heightAt(ob.x, ob.y) - 0.08, ob.y);
      this.group.add(obj);
    }
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

    // Large rocks/trees INSIDE the playable bounds come from the sim's
    // obstacle layout (placeObstacles) — they're collision. The client only
    // dresses the non-walkable fringe: the bluffs and beyond both ends.
    for (let i = 0; i < 40; i++) {
      const x = rng() < 0.7 ? -2 - rng() * 16 : rng() * w;
      const inside = x > -2;
      const z = inside ? (rng() < 0.5 ? -12 + rng() * 10 : h + 2 + rng() * 10) : -12 + rng() * (h + 24);
      placeOne(pick(["rock_1", "rock_2", "rock_3"]), x, z, 0.35 + rng() * 0.9);
    }
    for (let i = 0; i < 14; i++) {
      const x = -8 - rng() * 10;
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
    // A rocky headland in the surf, just beyond the walkable bound.
    for (let i = 0; i < 8; i++) {
      const x = w + 0.8 + rng() * 4.5;
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
      const xw = this.waterlineX(h / 2);
      const x = (this.tiles ? xw + 4.5 : w + 5.5) - reach * 7.5;
      f.mesh.position.set(x, WATER_Y + 0.16 + reach * 0.16, h / 2);
      f.mat.opacity = Math.sin(Math.min(1, p * 1.1) * Math.PI) * 0.55;
      (f.mat.map as THREE.Texture).offset.y = f.phase + t * 0.004;
    }
  }
}
