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
  private water: THREE.Mesh | null = null;

  private tagOccluder(root: THREE.Object3D): void {
    root.traverse((o) => {
      o.userData.occRoot = root;
    });
    this.occluders.push(root);
  }

  constructor(private tiles: TileMapState) {}

  heightAt(_x: number, _z: number): number {
    return 0; // authored zones are flat; the sim plane IS the ground
  }

  update(t: number): void {
    if (this.water) {
      this.water.position.y = -0.32 + Math.sin(t * 0.7) * 0.045;
      (this.water.material as THREE.MeshStandardMaterial).opacity =
        0.74 + Math.sin(t * 1.1) * 0.05;
    }
  }

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
        // Foam: a pale fleck band on walkable cells that touch water.
        const nearWater = [
          rows[y - 1]?.[x], rows[y + 1]?.[x], row[x - 1], row[x + 1],
        ].some((gl) => gl !== undefined && byGlyph.get(gl)?.ground === "water");
        if (nearWater && vis?.ground !== "water") {
          ctx.fillStyle = "rgba(225,235,240,0.5)";
          for (let f = 0; f < 6; f++) {
            const fx2 = x * px + Math.floor(cellHash(x * 53 + f, y * 29 + f) * px);
            const fy2 = y * px + Math.floor(cellHash(x * 71 + f, y * 11 + f) * px);
            ctx.fillRect(fx2, fy2, 2, 1);
          }
        }
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
    // One vertex per cell corner: water cells SINK into a basin so the
    // sea is a place, not a painted rectangle. A vertex drops if any of
    // its four touching cells is water; the lit bank lip comes free from
    // the normals.
    const geo = new THREE.PlaneGeometry(w, h, w, h);
    const pos = geo.attributes.position;
    const isWater = (xx: number, yy: number): boolean => {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
      return byGlyph.get(rows[yy][xx])?.ground === "water";
    };
    for (let vy = 0; vy <= h; vy++) {
      for (let vx = 0; vx <= w; vx++) {
        const i = vy * (w + 1) + vx;
        if (
          isWater(vx, vy) || isWater(vx - 1, vy) ||
          isWater(vx, vy - 1) || isWater(vx - 1, vy - 1)
        ) {
          pos.setZ(i, -0.75); // plane is XY before rotation; Z becomes -Y
        }
      }
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(w / 2, 0, h / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // The water surface: one translucent sheet across the whole zone at
    // basin height — it only shows where the ground dipped. update()
    // gives it a slow breathing bob.
    if (rows.some((r, yy) => [...r].some((_, xx) => isWater(xx, yy)))) {
      this.water = new THREE.Mesh(
        new THREE.PlaneGeometry(w + 8, h + 8),
        new THREE.MeshStandardMaterial({
          color: 0x2e5d8a,
          emissive: 0x0c2038,
          emissiveIntensity: 1.0,
          transparent: true,
          opacity: 0.72,
          roughness: 0.15,
          metalness: 0.1,
        }),
      );
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.set(w / 2, -0.32, h / 2);
      this.group.add(this.water);
    }

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
              // The piece is DIRECTIONAL: face it toward the walkable
              // side so every edge reads as the wall's front.
              const walkAt = (xx: number, yy: number): boolean => {
                if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false;
                return !!byGlyph.get(rows[yy][xx])?.walkable;
              };
              let rot = 0; // front faces +Z (south)
              if (walkAt(x, y + 1)) rot = 0;
              else if (walkAt(x, y - 1)) rot = Math.PI;
              else if (walkAt(x + 1, y)) rot = -Math.PI / 2;
              else if (walkAt(x - 1, y)) rot = Math.PI / 2;
              else {
                // No walkable neighbor (wall interior/corner): face the
                // town center along the dominant axis so runs stay coherent.
                const dx = w / 2 - cx;
                const dz = h / 2 - cz;
                rot = Math.abs(dx) > Math.abs(dz)
                  ? (dx > 0 ? -Math.PI / 2 : Math.PI / 2)
                  : (dz > 0 ? 0 : Math.PI);
              }
              obj.rotation.y = rot;
              // The piece is ~1.54u along its run; squeeze to tile per cell.
              obj.scale.x = 1 / 1.54;
              obj.position.set(cx, -0.02, cz);
              this.group.add(obj);
              this.tagOccluder(obj);
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
      this.tagOccluder(obj);
    }
  }
}

/** Deterministic per-cell hash → [0, 1); same look every visit. */
function cellHash(x: number, y: number): number {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
