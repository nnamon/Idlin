import * as THREE from "three";
import { AssetLibrary } from "./Assets";
import type { TileMapState } from "../gen/TileMapState";

/**
 * Renders an AUTHORED zone from its replicated tile map: a canvas-painted
 * ground plane (one swatch per cell, palette from the tileset variant the
 * server resolved) plus per-cell props. Wall/house/crate silhouettes are
 * primitive placeholders until the building pack lands — swapping them is
 * a content/asset change, the grid stays.
 *
 * The sim plane is flat for authored zones; heightAt is 0 everywhere.
 */
export class TileTerrain {
  group = new THREE.Group();
  /** Brazier cells surface here; ZoneRenderer owns the lit brazier rig. */
  brazierSpots: Array<[number, number]> = [];
  /** Tall meshes that can hide idlers from the camera; ZoneRenderer
   *  fades whichever stand between the lens and a character. */
  occluders: THREE.Object3D[] = [];

  constructor(private tiles: TileMapState) {}

  heightAt(_x: number, _z: number): number {
    return 0; // authored zones are flat; the sim plane IS the ground
  }

  update(_t: number): void {}

  build(assets: AssetLibrary): void {
    const { width: w, height: h, rows, legend } = this.tiles;
    const byGlyph = new Map(legend.map((l) => [l.glyph, l]));

    // -- ground: one plane, canvas-painted per cell --
    const px = 8;
    const canvas = document.createElement("canvas");
    canvas.width = w * px;
    canvas.height = h * px;
    const ctx = canvas.getContext("2d")!;
    const base = new THREE.Color();
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const vis = byGlyph.get(row[x]);
        base.set(vis?.ground ?? "#444444");
        // Subtle deterministic lightness jitter so the grid doesn't band.
        const jitter = (cellHash(x, y) - 0.5) * 0.05;
        const c = base.clone().offsetHSL(0, 0, jitter);
        ctx.fillStyle = `#${c.getHexString()}`;
        ctx.fillRect(x * px, y * px, px, px);
        // A few darker speckles per cell for grain.
        ctx.fillStyle = "rgba(0,0,0,0.10)";
        for (let s = 0; s < 3; s++) {
          const sx = x * px + Math.floor(cellHash(x * 31 + s, y * 17 + s) * px);
          const sy = y * px + Math.floor(cellHash(x * 13 + s, y * 41 + s) * px);
          ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w / 2, 0, h / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // An oversized dark apron so the zone edge doesn't fall into void.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 5, h * 5),
      new THREE.MeshStandardMaterial({ color: 0x0a0a12, roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(w / 2, -0.06, h / 2);
    this.group.add(apron);

    // -- props per cell --
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x312f3e, roughness: 0.9 });
    const wallGeo = new THREE.BoxGeometry(1, 1.5, 1);
    const houseMat = new THREE.MeshStandardMaterial({ color: 0x3b3447, roughness: 0.85 });
    const houseGeo = new THREE.BoxGeometry(1, 2.4, 1);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x5a452c, roughness: 0.9 });
    const crateGeo = new THREE.BoxGeometry(0.72, 0.72, 0.72);

    const placeModel = (keys: string[], x: number, z: number, scale: number, r: number) => {
      const obj = assets.instantiateProp(keys[Math.floor(r * keys.length) % keys.length]);
      if (!obj) return;
      obj.scale.setScalar(scale);
      obj.rotation.y = r * Math.PI * 2;
      obj.position.set(x, -0.04, z);
      this.group.add(obj);
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const vis = byGlyph.get(rows[y][x]);
        if (!vis?.prop) continue;
        const cx = x + 0.5;
        const cz = y + 0.5;
        const r = cellHash(x, y);
        switch (vis.prop) {
          case "wall": {
            // Real rampart piece, grid-aligned (no random spin: walls
            // must read as runs). Box fallback if the model is missing.
            const obj = assets.instantiateProp("wall_town");
            if (obj) {
              obj.position.set(cx, -0.02, cz);
              this.group.add(obj);
              this.occluders.push(obj);
            } else {
              const m = new THREE.Mesh(wallGeo, wallMat);
              m.position.set(cx, 0.75, cz);
              m.castShadow = true;
              m.receiveShadow = true;
              this.group.add(m);
            }
            break;
          }
          case "house": {
            const m = new THREE.Mesh(houseGeo, houseMat);
            m.position.set(cx, 1.2, cz);
            m.castShadow = true;
            this.group.add(m);
            break;
          }
          case "crate": {
            const obj = assets.instantiateProp("crate_town");
            if (obj) {
              obj.rotation.y = r * Math.PI;
              obj.position.set(cx, -0.02, cz);
              this.group.add(obj);
            } else {
              const m = new THREE.Mesh(crateGeo, crateMat);
              m.position.set(cx, 0.36, cz);
              m.rotation.y = r * Math.PI;
              m.castShadow = true;
              this.group.add(m);
            }
            break;
          }
          case "fence":
            placeModel(["fence_wood"], cx, cz, 1, 0);
            break;
          case "wagon":
            placeModel(["wagon"], cx, cz, 1, r);
            break;
          case "brazier":
            this.brazierSpots.push([cx, cz]);
            break;
          case "rock":
            placeModel(["rock_1", "rock_2", "rock_3"], cx, cz, 0.45 + r * 0.25, r);
            break;
          case "tree":
          case "dead_tree":
            placeModel(["deadtree_1", "deadtree_2", "deadtree_3"], cx, cz, 0.3 + r * 0.1, r);
            break;
          default:
            // Unknown recipe (e.g. "tuft" until a model exists): bare ground.
            break;
        }
      }
    }

    // -- authored set pieces (props.ron): whole buildings, landmarks --
    for (const pr of this.tiles.props) {
      const obj = assets.instantiateProp(pr.model);
      if (!obj) continue;
      obj.rotation.y = (pr.rot_deg * Math.PI) / 180;
      obj.position.set(pr.x_u + 0.5, -0.02, pr.y_u + 0.5);
      obj.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.group.add(obj);
      this.occluders.push(obj);
    }
  }
}

/** Deterministic per-cell hash → [0, 1); same look every visit. */
function cellHash(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
