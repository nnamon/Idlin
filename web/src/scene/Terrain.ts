import * as THREE from "three";
import type { TileMapState } from "../gen/TileMapState";
import type { TileVisual } from "../gen/TileVisual";
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

/** Padding rendered beyond the playable zone so the world doesn't end.
 *  Exported for the fog-of-war height-field bake (#129), which must cover the
 *  same span the terrain mesh does. */
export const PAD = 34;
const WATER_Y = -0.3;
/** How far the beach band reaches inland from the waterline. */
const BEACH_DEPTH = 13;
/** World units per authored terrain level (TileVisual.elevation). */
const LEVEL_H = 2.6;

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

/** Coursed-stone wall texture: offset blocks, mortar seams, night tones. */
function wallStoneTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#33333f";
  g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 6; row++) {
    const yo = row * 22;
    const off = row % 2 ? 16 : 0;
    for (let col = -1; col < 5; col++) {
      const j = ((Math.sin(row * 37 + col * 91) * 43758.5) % 1 + 1) % 1;
      g.fillStyle = `hsl(240, 9%, ${24 + j * 9}%)`;
      g.fillRect(col * 32 + off + 2, yo + 2, 28, 18);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
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
  private wallMat: THREE.MeshStandardMaterial | null = null;
  private wallGeo: THREE.BoxGeometry | null = null;
  private wallGeoV: THREE.BoxGeometry | null = null;
  private wallCore: THREE.BoxGeometry | null = null;
  private hasWater = false;
  /** A true east-edge coastline exists (the sea carve applies only then). */
  private hasSea = false;
  /** Opt-in cosmetic features from the tileset; legacy zones get all. */
  private features = new Set<string>();
  /** Blurred per-cell terrace levels; null on flat maps. */
  private elevGrid: Float32Array | null = null;
  /** Blurred interior-pool mask; null when the only water is the sea. */
  private poolGrid: Float32Array | null = null;

  /** Drive the terrain from an authored tile map (call before build). */
  setTiles(tiles: TileMapState): void {
    this.tiles = tiles;
    this.features = new Set(tiles.features);
    this.byGlyph = new Map(tiles.legend.map((l) => [l.glyph, l]));
    for (const l of tiles.legend) {
      this.groundColors.set(l.glyph, new THREE.Color(l.ground));
    }
    // Authored terrace levels, box-blurred so a level change arrives as a
    // short slope; authored crag lines hide the cliff edges, and gaps in
    // them ARE the ramps.
    const ew = tiles.width;
    const eh = tiles.height;
    const rawElev = new Float32Array(ew * eh);
    let anyElev = false;
    for (let z = 0; z < eh; z++) {
      const row = tiles.rows[z];
      for (let x = 0; x < ew; x++) {
        const e = this.byGlyph.get(row[x])?.elevation ?? 0;
        rawElev[z * ew + x] = e;
        if (e > 0) anyElev = true;
      }
    }
    this.elevGrid = null;
    if (anyElev) {
      const blur = new Float32Array(ew * eh);
      const R = 2;
      for (let z = 0; z < eh; z++) {
        for (let x = 0; x < ew; x++) {
          let sum = 0;
          let n = 0;
          for (let dz = -R; dz <= R; dz++) {
            for (let dx = -R; dx <= R; dx++) {
              const cx = Math.min(ew - 1, Math.max(0, x + dx));
              const cz = Math.min(eh - 1, Math.max(0, z + dz));
              sum += rawElev[cz * ew + cx];
              n++;
            }
          }
          blur[z * ew + x] = sum / n;
        }
      }
      this.elevGrid = blur;
    }
    // Per-row x of the SEA waterline, lightly smoothed so the heightmap
    // meanders instead of stair-stepping. A row's water only counts as
    // coast when it runs contiguously to the map's east edge — interior
    // pools (the Hollow's basins) are NOT a coastline; treating the first
    // water cell as one carved all land east of a pool below the sea
    // plane (characters visibly sank under the map).
    const isWater = (z: number, x: number) =>
      this.byGlyph.get(tiles.rows[z][x])?.ground_id === "water";
    const raw: number[] = [];
    let anyPool = false;
    for (let z = 0; z < tiles.height; z++) {
      let edge = tiles.width + 18;
      for (let x = tiles.width - 1; x >= 0; x--) {
        if (!isWater(z, x)) break;
        edge = x; // contiguous run touching the east edge
      }
      // Anything wet west of the coast run is an interior pool.
      for (let x = 0; x < Math.min(edge, tiles.width); x++) {
        if (isWater(z, x)) {
          anyPool = true;
          break;
        }
      }
      raw.push(edge);
    }
    this.hasSea = raw.some((e) => e <= tiles.width);
    this.hasWater = this.hasSea || anyPool;
    if (this.hasSea) {
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
    // Interior pools: a blurred mask sinks just those cells into shallow
    // basins the water plane shows through (same box-blur as terraces).
    this.poolGrid = null;
    if (anyPool) {
      const rawPool = new Float32Array(ew * eh);
      for (let z = 0; z < eh; z++) {
        for (let x = 0; x < Math.min(Math.floor(raw[z]), ew); x++) {
          if (isWater(z, x)) rawPool[z * ew + x] = 1;
        }
      }
      const blur = new Float32Array(ew * eh);
      const R = 1;
      for (let z = 0; z < eh; z++) {
        for (let x = 0; x < ew; x++) {
          let sum = 0;
          let n = 0;
          for (let dz = -R; dz <= R; dz++) {
            for (let dx = -R; dx <= R; dx++) {
              const cx = Math.min(ew - 1, Math.max(0, x + dx));
              const cz = Math.min(eh - 1, Math.max(0, z + dz));
              sum += rawPool[cz * ew + cx];
              n++;
            }
          }
          blur[z * ew + x] = sum / n;
        }
      }
      this.poolGrid = blur;
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

  /** Authored terrace lift (world units) at a position; 0 on flat maps. */
  private terraceLift(x: number, z: number): number {
    if (!this.elevGrid || !this.tiles) return 0;
    const { width: w, height: h } = this.tiles;
    // Cell centers sit at +0.5; sample the blurred grid bilinearly.
    const fx = Math.min(w - 1.001, Math.max(0, x - 0.5));
    const fz = Math.min(h - 1.001, Math.max(0, z - 0.5));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const ax = fx - x0;
    const az = fz - z0;
    const g = this.elevGrid;
    const v00 = g[z0 * w + x0];
    const v10 = g[z0 * w + x0 + 1];
    const v01 = g[(z0 + 1) * w + x0];
    const v11 = g[(z0 + 1) * w + x0 + 1];
    const v = (v00 * (1 - ax) + v10 * ax) * (1 - az) + (v01 * (1 - ax) + v11 * ax) * az;
    return v * LEVEL_H;
  }

  /** Blurred interior-pool weight at a position (0 dry .. 1 pool center). */
  private poolAt(x: number, z: number): number {
    if (!this.poolGrid || !this.tiles) return 0;
    const { width: w, height: h } = this.tiles;
    const fx = Math.min(w - 1.001, Math.max(0, x - 0.5));
    const fz = Math.min(h - 1.001, Math.max(0, z - 0.5));
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const ax = fx - x0;
    const az = fz - z0;
    const g = this.poolGrid;
    const v00 = g[z0 * w + x0];
    const v10 = g[z0 * w + x0 + 1];
    const v01 = g[(z0 + 1) * w + x0];
    const v11 = g[(z0 + 1) * w + x0 + 1];
    return (v00 * (1 - ax) + v10 * ax) * (1 - az) + (v01 * (1 - ax) + v11 * ax) * az;
  }

  /**
   * Ground height at a world position. The same function shapes the mesh,
   * so feet and geometry always agree.
   */
  heightAt(x: number, z: number): number {
    const { zoneW: w, zoneH: h } = this;
    if (this.tiles && !this.features.has("sea")) {
      // Dry authored ground (the town): a gentle plateau ringed by hills.
      let y = vnoise(x * 0.08, z * 0.08, this.seed) * 0.22 - 0.08;
      const out = Math.max(0, -x, x - w, -z, z - h);
      y += smoothstep(2, PAD - 8, out) * (3.5 + vnoise(x * 0.09, z * 0.09, this.seed ^ 13) * 2.2);
      y += this.terraceLift(x, z);
      // Interior pools work in ANY tileset (the saltworks pans are water
      // in the sea-less town set): shallow basins the plane shows through.
      const pool = this.poolAt(x, z);
      if (pool > 0) y = y * (1 - pool) + (WATER_Y - 0.3) * pool;
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
    // Authored terraces ride on top (0 everywhere on legacy maps).
    y += this.terraceLift(x, z);
    // Interior pools sink into shallow basins the water plane shows
    // through — wading depth, never the seafloor carve.
    const pool = this.poolAt(x, z);
    if (pool > 0) y = y * (1 - pool) + (WATER_Y - 0.3) * pool;
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
      const tileCol = this.tiles ? this.groundColorAt(x, z) : null;
      if (tileCol) {
        // Authored ground: the tileset palette IS the base coat; the
        // shore touches (wet sheen, rocky heights) layer on top.
        tmp.copy(tileCol).lerp(rock, high).lerp(wet, wetness * (this.hasWater ? 1 : 0));
      } else {
        tmp.copy(inland).lerp(sand, beach).lerp(rock, high).lerp(wet, wetness);
      }
      // Two octaves (zone-dressing pass): the fine grain alone read as a
      // FLAT field from broadcast distance — the low octave lays 4-6u
      // light/dark patches so floors look walked-on instead of painted.
      const grain =
        0.92 +
        0.16 * vnoise(x * 1.7, z * 1.7, this.seed ^ 99) +
        0.1 * (vnoise(x * 0.22, z * 0.22, this.seed ^ 7919) - 0.5);
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

    // -- the water plane: the sea east of the waterline, or (pool zones,
    // ANY tileset) a zone-wide sheet the sunken basins reveal --
    if (!this.tiles || (this.hasWater && this.features.has("sea")) || this.poolGrid) {
      const poolsOnly = !!this.tiles && !this.hasSea;
      this.water = new THREE.Mesh(
        new THREE.PlaneGeometry(poolsOnly ? spanX : PAD + 40, spanZ),
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
      if (poolsOnly) {
        this.water.position.set(minX + spanX / 2, WATER_Y, minZ + spanZ / 2);
      } else {
        const seaFrom = this.tiles ? Math.min(...(this.waterEdge ?? [w])) - 2 : w - 6;
        this.water.position.set(seaFrom + (PAD + 46) / 2, WATER_Y, minZ + spanZ / 2);
      }
      this.group.add(this.water);
    }

    // -- lapping waves: foam strips that roll up the sand and fade --
    // (a COAST dressing: pools-only zones get still water, no surf)
    const foamTex = this.makeFoamTexture();
    for (let i = 0; i < (!this.tiles || (this.hasSea && this.features.has("sea")) ? 3 : 0); i++) {
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
    const starsWanted = !this.tiles || this.features.has("stars");
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
    if (starsWanted) this.group.add(stars);

    // Authored tile maps are the one terrain system; a zone without tiles
    // (placeholder/test) just gets the bare sculpted ground above.
    if (this.tiles) {
      if (this.features.has("fringe_scatter")) this.scatterFringe(assets, rng);
      this.placeTileProps(assets, rng);
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
            // Variety by cell hash — the same crate everywhere was the
            // broadcast audit's "one prop to rule them all".
            put(
              ["crate_town", "crate", "barrel"][Math.floor(r * 3) % 3],
              cx,
              cz,
              1,
              r * Math.PI,
            );
            break;
          case "wagon":
            put("wagon", cx, cz, 1, r * Math.PI * 2);
            break;
          case "fence":
            put("fence_wood", cx, cz, 1, 0);
            break;
          case "wall": {
            // Center-targeted construction: every wall cell is a core
            // post plus HALF-legs reaching only toward wall neighbors.
            // Segments abut at cell edges instead of overlapping (the
            // full-length slabs z-fought where runs met).
            if (!this.wallMat) {
              const tex = wallStoneTexture();
              this.wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 });
              this.wallGeo = new THREE.BoxGeometry(0.5, 2.2, 0.42); // E/W half-leg
              this.wallGeoV = new THREE.BoxGeometry(0.42, 2.2, 0.5); // N/S half-leg
              this.wallCore = new THREE.BoxGeometry(0.42, 2.2, 0.42);
            }
            const wallAt = (xx: number, yy: number): boolean => {
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
              return this.byGlyph.get(rows[yy][xx])?.prop === "wall";
            };
            const yBase = this.heightAt(cx, cz) + 1.04;
            const add = (geo: THREE.BoxGeometry, ox: number, oz: number) => {
              const m = new THREE.Mesh(geo, this.wallMat!);
              m.position.set(cx + ox, yBase, cz + oz);
              m.castShadow = true;
              m.receiveShadow = true;
              m.userData.occRoot = m;
              this.group.add(m);
              this.occluders.push(m);
            };
            add(this.wallCore!, 0, 0);
            if (wallAt(x + 1, y)) add(this.wallGeo!, 0.25, 0);
            if (wallAt(x - 1, y)) add(this.wallGeo!, -0.25, 0);
            if (wallAt(x, y + 1)) add(this.wallGeoV!, 0, 0.25);
            if (wallAt(x, y - 1)) add(this.wallGeoV!, 0, -0.25);
            break;
          }
          default:
            break;
        }
      }
    }
    // Ambient scatter (zone-dressing pass): bare walkable no-prop cells
    // get a deterministic sprinkle — grass tufts on soft ground, small
    // rubble on worked floors — so wide shots stop reading as empty boxes.
    // Cosmetic only: nothing here registers collision; ground_id is the
    // SEMANTIC kind ("grass"/"sand"/"cobble"...), never the palette hex
    // (codex caught the first draft comparing colors).
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const vis = this.byGlyph.get(rows[y][x]);
        if (!vis?.walkable || vis.prop) continue;
        const r = hash2(x * 3 + 1, y * 3 + 2, this.seed ^ 13);
        if (r > 0.07) continue;
        const soft = vis.ground_id === "grass" || vis.ground_id === "sand";
        if (soft) {
          put(
            ["grass_1", "grass_2"][Math.floor(r * 100) % 2],
            x + 0.5,
            y + 0.5,
            0.5 + r * 3,
            r * 89,
          );
        } else {
          put(
            ["rock_1", "rock_2", "rock_3"][Math.floor(r * 100) % 3],
            x + 0.5,
            y + 0.5,
            0.12 + r * 0.8,
            r * 89,
          );
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
