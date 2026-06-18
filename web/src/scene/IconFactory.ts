import * as THREE from "three";
import { AssetLibrary } from "./Assets";

/**
 * Item icons the PoE way: renders of the actual 3D items. Each distinct
 * item resolves to its glTF model (weapons/shields today; armour when the
 * outfit pack lands), gets one offscreen orthographic render against
 * transparency, and is cached as a data URL for the HUD. Items without a
 * model fall back to flat-shaded canvas silhouettes in the same palette,
 * so nothing in the UI is ever just text in a box.
 */
export class IconFactory {
  private cache = new Map<string, string | null>();
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;

  constructor(private assets: AssetLibrary) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setSize(96, 96);
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    // Cool key light + warm fill: the same moonlit-night palette as the
    // world, so icons look like they came out of it.
    const key = new THREE.DirectionalLight(0xcdd6ff, 2.6);
    key.position.set(2, 3, 4);
    const fill = new THREE.DirectionalLight(0xffb37a, 0.7);
    fill.position.set(-3, -1, 2);
    this.scene.add(key, fill, new THREE.AmbientLight(0x8888aa, 1.1));
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  }

  /** Icon for an item by display name + slot kind; null = caller's text fallback. */
  icon(name: string, kind: string): string | null {
    const key = `${kind}:${name}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const url = this.modelIcon(name) ?? silhouette(kind);
    this.cache.set(key, url);
    return url;
  }

  /** Resolve "Heavy Barnacle Wand of Embers (Barnacle Wand)" → a model. */
  private modelIcon(name: string): string | null {
    const lower = (name.match(/\(([^)]+)\)\s*$/)?.[1] ?? name).toLowerCase();
    let obj: THREE.Object3D | null = null;
    if (lower.includes("cleaver") || lower.includes("axe")) obj = this.assets.instantiateWeapon("cleaver");
    else if (lower.includes("bow")) obj = this.assets.instantiateWeapon("bow");
    else if (lower.includes("wand")) obj = this.assets.instantiateWeapon("wand");
    else if (lower.includes("buckler") || lower.includes("shield") || lower.includes("talon"))
      obj = this.assets.attachmentDef("shield_round")?.obj ?? null;
    if (!obj) return null;

    // Frame the object: center it, fit the ortho camera to its bounds,
    // tilt it the classic 30° icon angle.
    const group = new THREE.Group();
    group.add(obj);
    group.rotation.set(0.45, -0.65, 0.12);
    this.scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
    const size = box.getSize(new THREE.Vector3());
    const half = Math.max(size.x, size.y) * 0.58;
    this.camera.left = -half;
    this.camera.right = half;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.position.set(0, 0, size.z + 5);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL();
    this.scene.remove(group);
    return url;
  }
}

/** Flat-shaded canvas silhouettes for items without models yet. */
function silhouette(kind: string): string | null {
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.translate(48, 48);
  g.lineJoin = "round";
  const fill = (path: () => void, color: string, stroke = "#0a0a12") => {
    g.beginPath();
    path();
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.strokeStyle = stroke;
    g.lineWidth = 3;
    g.stroke();
  };
  switch (kind) {
    case "helm":
      fill(() => {
        g.arc(0, -2, 26, Math.PI, 0);
        g.lineTo(26, 18);
        g.lineTo(-26, 18);
      }, "#5a5d70");
      fill(() => {
        g.rect(-18, 2, 36, 7);
      }, "#23232f");
      break;
    case "chest":
      fill(() => {
        g.moveTo(-26, -26);
        g.lineTo(26, -26);
        g.lineTo(20, 6);
        g.lineTo(12, 28);
        g.lineTo(-12, 28);
        g.lineTo(-20, 6);
      }, "#565a6e");
      fill(() => {
        g.moveTo(0, -22);
        g.lineTo(8, 0);
        g.lineTo(0, 22);
        g.lineTo(-8, 0);
      }, "#3a3d4e");
      break;
    case "boots":
      fill(() => {
        g.moveTo(-26, -18);
        g.lineTo(-8, -18);
        g.lineTo(-8, 8);
        g.lineTo(6, 16);
        g.lineTo(6, 24);
        g.lineTo(-26, 24);
      }, "#5b4f42");
      fill(() => {
        g.moveTo(4, -24);
        g.lineTo(20, -24);
        g.lineTo(20, 2);
        g.lineTo(32, 10);
        g.lineTo(32, 18);
        g.lineTo(4, 18);
      }, "#4d4338");
      break;
    case "flask":
      // A potion bottle: bulb, neck, cork, red fill.
      fill(() => {
        g.moveTo(-7, -26);
        g.lineTo(7, -26);
        g.lineTo(7, -12);
        g.lineTo(16, 2);
        g.lineTo(16, 20);
        g.lineTo(-16, 20);
        g.lineTo(-16, 2);
        g.lineTo(-7, -12);
      }, "#6a7484");
      fill(() => {
        g.moveTo(11, 6);
        g.lineTo(11, 15);
        g.lineTo(-11, 15);
        g.lineTo(-11, 6);
      }, "#a8313b");
      fill(() => {
        g.rect(-6, -30, 12, 5);
      }, "#5a452c");
      break;
    case "gem":
      fill(() => {
        g.moveTo(0, -26);
        g.lineTo(22, -6);
        g.lineTo(14, 22);
        g.lineTo(-14, 22);
        g.lineTo(-22, -6);
      }, "#37b8a6");
      fill(() => {
        g.moveTo(0, -26);
        g.lineTo(8, -2);
        g.lineTo(-10, 12);
      }, "#5adfdf");
      break;
    case "ring":
      // A gold band face-on with a small set stone.
      g.beginPath();
      g.arc(0, 6, 16, 0, Math.PI * 2);
      g.strokeStyle = "#caa24a";
      g.lineWidth = 8;
      g.stroke();
      fill(() => {
        g.moveTo(0, -24);
        g.lineTo(9, -13);
        g.lineTo(0, -2);
        g.lineTo(-9, -13);
      }, "#5adfdf");
      break;
    case "amulet":
      // A teardrop pendant hung on a cord.
      g.beginPath();
      g.arc(0, -6, 19, Math.PI * 1.18, Math.PI * -0.18);
      g.strokeStyle = "#8a7a5a";
      g.lineWidth = 3;
      g.stroke();
      fill(() => {
        g.moveTo(0, 0);
        g.lineTo(14, 14);
        g.lineTo(0, 30);
        g.lineTo(-14, 14);
      }, "#4a8fb8");
      break;
    case "belt":
      // A horizontal strap with a square buckle.
      fill(() => {
        g.rect(-30, -8, 60, 16);
      }, "#5b4f42");
      fill(() => {
        g.rect(-11, -12, 22, 24);
      }, "#caa24a");
      fill(() => {
        g.rect(-4, -6, 8, 12);
      }, "#2a2418");
      break;
    default:
      return null;
  }
  return c.toDataURL();
}
