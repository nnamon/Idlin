import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

/**
 * manifest.json is the only binding between wire keys and art. Models map
 * state-machine roles (idle/run/attack/death/...) to clip names; characters
 * are MODULAR — a shared body rig plus outfit parts bound to it at runtime,
 * chosen by the replicated `gear` list. Swapping art packs means editing the
 * manifest, not code.
 */
export interface ModelDef {
  file: string;
  scale: number;
  clips: Record<string, string>;
  /** Idlers only: weapon key → attack clip override. */
  attackClips?: Record<string, string>;
  /** Bone name to parent the equipped weapon mesh to. */
  handSlot?: string;
  /** Outfit worn when a region has no gear (paper-doll baseline). */
  defaultParts?: string[];
  /** Fixed tint multiplied into every material (monster variants). */
  tint?: string;
  /** Parts whose materials take the per-character name color. */
  nameTintParts?: string[];
  /** Base-skin submeshes per paper-doll region, hidden when covered by a
   * worn part (head is intentionally absent: always visible). */
  baseRegions?: Record<string, string>;
  /** Cosmetic body variants, picked client-side by name/id hash. The wire
   * gear keys stay variant-free; partSuffix resolves them per body. */
  variants?: BodyVariant[];
}

export interface BodyVariant {
  file: string;
  /** Appended to part keys when resolving (e.g. ranger_body -> ranger_body_f). */
  partSuffix?: string;
  /** Hairstyle part keys; one is hash-picked. Hidden under a worn hood. */
  hairs?: string[];
}

export interface PartDef {
  /** Paper-doll region this part occupies (body/legs/feet/head). */
  region: string;
  files: string[];
}

interface Manifest {
  models: Record<string, ModelDef>;
  parts: Record<string, PartDef>;
  weapons: Record<string, { file: string }>;
  /** Static environment props, scattered deterministically by Terrain. */
  props: Record<string, { file: string }>;
  /** Ground-drop meshes for armor items (weapons reuse their own files). */
  drops: Record<string, { file: string }>;
  /** Rigid gear meshes worn on a named bone (shields on hand_l). */
  attachments: Record<string, { file: string; bone: string }>;
}

export interface ModelInstance {
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
  def: ModelDef;
}

interface LoadedFile {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

/** All glTF assets, loaded once; entities get cheap clones. */
export class AssetLibrary {
  private constructor(
    private manifest: Manifest,
    private files: Map<string, LoadedFile>,
    /** Cache of fixed-tint material variants, shared across entities. */
    private tinted = new Map<string, THREE.Material>(),
  ) {}

  static async load(base = "/assets/"): Promise<AssetLibrary> {
    const manifest: Manifest = await (await fetch(`${base}manifest.json`)).json();
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    // Load each unique file once: the shared body serves several model keys.
    const paths = new Set<string>();
    for (const def of Object.values(manifest.models)) {
      paths.add(def.file);
      for (const v of def.variants ?? []) paths.add(v.file);
    }
    for (const def of Object.values(manifest.parts)) def.files.forEach((f) => paths.add(f));
    for (const def of Object.values(manifest.weapons)) paths.add(def.file);
    for (const def of Object.values(manifest.props ?? {})) paths.add(def.file);
    for (const def of Object.values(manifest.drops ?? {})) paths.add(def.file);
    for (const def of Object.values(manifest.attachments ?? {})) paths.add(def.file);

    // Canvas-rendered text (labels, damage numbers) uses the display font;
    // have it ready before any visual draws.
    await Promise.all([
      document.fonts.load('40px "Anton SC"'),
      document.fonts.load('600 40px "Cinzel"'),
    ]).catch(() => {});

    const files = new Map<string, LoadedFile>();
    await Promise.all(
      [...paths].map(async (path) => {
        const gltf = await loader.loadAsync(base + path);
        gltf.scene.traverse((o) => {
          if (o instanceof THREE.Mesh) o.castShadow = true;
        });
        files.set(path, { scene: gltf.scene, clips: gltf.animations });
      }),
    );
    return new AssetLibrary(manifest, files);
  }

  modelDef(key: string): ModelDef | null {
    return this.manifest.models[key] ?? null;
  }

  partDef(key: string): PartDef | null {
    return this.manifest.parts[key] ?? null;
  }

  /**
   * Clone a rigged character body. Geometry and materials are shared with
   * the library copy; only the skeleton and node graph are per-instance.
   */
  instantiateModel(key: string, fileOverride?: string): ModelInstance | null {
    const def = this.manifest.models[key];
    const loaded = def ? this.files.get(fileOverride ?? def.file) : undefined;
    if (!def || !loaded) return null;
    const root = cloneSkeleton(loaded.scene);
    root.scale.setScalar(def.scale);
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        // Skinned bounds lag animation; never let culling hide a dancer.
        if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false;
      }
    });
    return { root, clips: loaded.clips, def };
  }

  /**
   * The library's skinned meshes for an outfit part. Callers clone each mesh
   * and bind it to their body's skeleton (identical universal rig).
   */
  partMeshes(key: string): THREE.SkinnedMesh[] {
    const def = this.manifest.parts[key];
    if (!def) return [];
    const out: THREE.SkinnedMesh[] = [];
    for (const file of def.files) {
      this.files.get(file)?.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) out.push(o);
      });
    }
    return out;
  }

  /** Clone a static weapon prop (shares geometry/materials). */
  instantiateWeapon(key: string): THREE.Object3D | null {
    const def = this.manifest.weapons[key];
    const loaded = def ? this.files.get(def.file) : undefined;
    return loaded ? loaded.scene.clone() : null;
  }

  /** Clone an environment prop (shares geometry/materials). */
  instantiateProp(key: string): THREE.Object3D | null {
    const def = this.manifest.props?.[key];
    const loaded = def ? this.files.get(def.file) : undefined;
    return loaded ? loaded.scene.clone() : null;
  }

  /** Clone a ground-drop mesh for an armor item visual key. */
  instantiateDrop(key: string): THREE.Object3D | null {
    const def = this.manifest.drops?.[key];
    const loaded = def ? this.files.get(def.file) : undefined;
    return loaded ? loaded.scene.clone() : null;
  }

  /** Bone-worn rigid gear (shields): the mesh plus its target bone name. */
  attachmentDef(key: string): { obj: THREE.Object3D; bone: string } | null {
    const def = this.manifest.attachments?.[key];
    const loaded = def ? this.files.get(def.file) : undefined;
    return loaded ? { obj: loaded.scene.clone(), bone: def.bone } : null;
  }

  /**
   * Shared fixed-tint variant of a material (monster recolors). Cached per
   * (material, tint) so a whole pack of shamblers costs three materials,
   * not three per shambler.
   */
  tintedMaterial(src: THREE.Material, tint: string): THREE.Material {
    const cacheKey = `${src.uuid}:${tint}`;
    let mat = this.tinted.get(cacheKey);
    if (!mat) {
      mat = src.clone();
      (mat as THREE.MeshStandardMaterial).color?.multiply(new THREE.Color(tint));
      this.tinted.set(cacheKey, mat);
    }
    return mat;
  }
}
