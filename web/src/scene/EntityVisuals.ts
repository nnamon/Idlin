import * as THREE from "three";
import type { EntityRender } from "../world/store";
import type { AssetLibrary, BodyVariant, ModelDef } from "./Assets";

const RARITY_COLORS = [0xbfbfbf, 0x5a8aff, 0xffd75a, 0xff9a3c];
/** Worn-tier glow: normal gear stays matte; magic+ gets an emissive cast. */
const RARITY_GLOW = [0, 0x4a7dff, 0xffd75a, 0xff9a3c];
const FADE_S = 0.18;

/** Clone-and-glow every material under a worn mesh; returns the clones
 *  (caller disposes them — the geometry stays shared). */
function applyRarityGlow(root: THREE.Object3D, rarity: number): THREE.Material[] {
  const glow = RARITY_GLOW[Math.min(rarity, 3)];
  if (!glow) return [];
  const owned: THREE.Material[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !Array.isArray(o.material)) {
      const mat = o.material.clone() as THREE.MeshStandardMaterial;
      mat.emissive = new THREE.Color(glow);
      mat.emissiveIntensity = 0.35;
      o.material = mat;
      owned.push(mat);
    }
  });
  return owned;
}

function strHash(s: string): number {
  let hash = 0;
  for (const c of s) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return hash;
}

/** Stable hue from a character name — same everywhere it appears. */
export function nameColor(name: string): THREE.Color {
  return new THREE.Color().setHSL((strHash(name) % 360) / 360, 0.65, 0.55);
}

interface WornPart {
  key: string;
  meshes: THREE.SkinnedMesh[];
  /** Per-entity cloned materials (name tint) that we must dispose. */
  ownedMaterials: THREE.Material[];
}

/**
 * One entity's renderable. Characters and monsters are MODULAR: a shared
 * rigged body plus outfit parts bound to its skeleton, composed from the
 * replicated `gear` list (region overrides: equipping a vest swaps the
 * torso). Loot is a shared-geometry glowing pickup. Owns its per-instance
 * GPU resources and releases them in dispose() — a broadcast runs for days.
 */
export class EntityVisual {
  readonly group = new THREE.Group();
  height = 1.8;

  // Animation
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private baseRole = "";
  private attacking = false;
  private wasDead = false;

  // Modular body
  private def: ModelDef | null = null;
  private variant: BodyVariant | null = null;
  private hairKey = "";
  private modelRoot: THREE.Object3D | null = null;
  private boneByName = new Map<string, THREE.Bone>();
  private worn = new Map<string, WornPart>(); // region → part
  private baseRegionMeshes = new Map<string, THREE.Object3D>(); // region → base skin
  private gearKey = "<unset>";
  private myName = "";

  // Movement/facing
  private lastX = NaN;
  private lastZ = NaN;
  private targetAngle = 0;

  // Parts
  private lootMesh: THREE.Object3D | null = null;
  private lootBaseY = 0.55;
  private hpBg: THREE.Sprite | null = null;
  private hpFg: THREE.Sprite | null = null;
  private label: THREE.Sprite | null = null;
  private weaponKey = "";
  private weaponRarity = 0;
  private weaponObj: THREE.Object3D | null = null;
  private weaponMats: THREE.Material[] = [];
  private handBone: THREE.Object3D | null = null;
  /** Bone-worn rigid gear (shields), keyed by gear key. */
  private wornAttachments = new Map<string, { obj: THREE.Object3D; mats: THREE.Material[] }>();

  constructor(
    private readonly id: number,
    er: EntityRender,
    private readonly assets: AssetLibrary,
    private readonly shared: SharedResources,
  ) {
    const { state } = er;
    this.myName = state.name;
    if (state.kind === "Loot") {
      this.buildLoot(state.model, state.rarity);
    } else {
      this.buildModel(state.model, state.kind === "Monster");
      this.buildBars();
      if (state.kind === "Character") this.buildLabel(state.name);
      this.composeGear(state.gear, state.gear_rarity ?? []);
      this.setWeapon(state.weapon, state.weapon_rarity ?? 0);
    }
  }

  private buildModel(model: string, isMonster: boolean): void {
    // Cosmetic body variant: stable per character name; per entity id for
    // monsters so packs come out mixed. Pure client-side — not replicated.
    const def = this.assets.modelDef(model);
    const seed = strHash(isMonster ? `${model}:${this.id}` : this.myName);
    this.variant = def?.variants?.[seed % (def.variants.length || 1)] ?? null;
    if (this.variant?.hairs?.length) {
      this.hairKey = this.variant.hairs[(seed >> 3) % this.variant.hairs.length];
    }
    const inst = this.assets.instantiateModel(model, this.variant?.file);
    if (!inst) {
      // Unknown key: visible placeholder beats an invisible entity.
      const mesh = new THREE.Mesh(this.shared.fallbackGeo, this.shared.fallbackMat);
      mesh.position.y = 0.5;
      this.group.add(mesh);
      this.height = 1.0;
      return;
    }
    this.def = inst.def;
    this.modelRoot = inst.root;
    this.height = 1.85 * inst.def.scale;
    this.group.add(inst.root);

    inst.root.traverse((o) => {
      if (o instanceof THREE.Bone) this.boneByName.set(o.name, o);
      // Fixed monster tint applies to the body skin too (shared cache).
      if (inst.def.tint && o instanceof THREE.Mesh && !Array.isArray(o.material)) {
        o.material = this.assets.tintedMaterial(o.material, inst.def.tint);
      }
    });

    this.mixer = new THREE.AnimationMixer(inst.root);
    for (const [role, clipName] of Object.entries(inst.def.clips)) {
      const clip = THREE.AnimationClip.findByName(inst.clips, clipName);
      if (clip) this.actions.set(role, this.mixer.clipAction(clip));
    }
    for (const [weapon, clipName] of Object.entries(inst.def.attackClips ?? {})) {
      const clip = THREE.AnimationClip.findByName(inst.clips, clipName);
      if (clip) this.actions.set(`attack:${weapon}`, this.mixer.clipAction(clip));
    }
    this.mixer.addEventListener("finished", () => this.onClipFinished());

    if (inst.def.handSlot) {
      this.handBone = inst.root.getObjectByName(inst.def.handSlot) ?? null;
    }
    for (const [region, meshName] of Object.entries(inst.def.baseRegions ?? {})) {
      const mesh = inst.root.getObjectByName(meshName);
      if (mesh) this.baseRegionMeshes.set(region, mesh);
    }

    // Monsters with a spawn clip rise out of the ground; everyone else
    // idles, phase-shifted so packs don't move in lockstep.
    const spawn = this.actions.get("spawn");
    if (isMonster && spawn) {
      spawn.setLoop(THREE.LoopOnce, 1);
      spawn.play();
      this.attacking = true; // blocks the base state until "finished"
      this.baseRole = "idle";
    } else {
      this.playBase("idle");
      const idle = this.actions.get("idle");
      if (idle) idle.time = Math.random() * idle.getClip().duration;
    }
  }

  /**
   * The paper-doll: defaults fill each region, replicated gear overrides by
   * region. Bound to this body's skeleton — same rig, shared bind pose.
   */
  private composeGear(gear: string[], gearRarity: number[]): void {
    const key = gear.join("|") + "#" + gearRarity.join(",");
    if (key === this.gearKey || !this.def || !this.modelRoot) return;
    this.gearKey = key;

    // Wire keys are variant-free; the body variant's suffix picks the
    // male/female part file (falling back to the bare key, e.g. hair).
    const resolve = (key: string): string => {
      const suffixed = key + (this.variant?.partSuffix ?? "");
      return this.assets.partDef(suffixed) ? suffixed : key;
    };
    const desired = new Map<string, string>(); // region → part key
    const rarityByKey = new Map<string, number>(); // resolved part → rarity
    for (const part of this.def.defaultParts ?? []) {
      const resolved = resolve(part);
      const def = this.assets.partDef(resolved);
      if (def) desired.set(def.region, resolved);
    }
    for (const [i, part] of gear.entries()) {
      const resolved = resolve(part);
      rarityByKey.set(resolved, gearRarity[i] ?? 0);
      const def = this.assets.partDef(resolved);
      if (def) desired.set(def.region, resolved);
    }
    // Hair occupies its own region and disappears under a worn hood.
    if (this.hairKey && !desired.has("head")) {
      desired.set("hair", this.hairKey);
    }

    // Rigid bone-worn gear (shields) diffs separately from skinned parts.
    // Rarity changes re-attach (the key set alone wouldn't notice).
    const wantAttach = new Map(
      gear
        .filter((k) => this.assets.attachmentDef(k) !== null)
        .map((k) => [k + "#" + (rarityByKey.get(resolve(k)) ?? 0), k]),
    );
    for (const [key, worn] of this.wornAttachments) {
      if (!wantAttach.has(key)) {
        worn.obj.removeFromParent(); // clone shares GPU resources…
        for (const m of worn.mats) m.dispose(); // …but glow mats are ours
        this.wornAttachments.delete(key);
      }
    }
    for (const [key, bare] of wantAttach) {
      if (this.wornAttachments.has(key)) continue;
      const att = this.assets.attachmentDef(bare);
      if (!att) continue;
      const bone = this.modelRoot.getObjectByName(att.bone);
      if (!bone) continue;
      const mats = applyRarityGlow(att.obj, rarityByKey.get(resolve(bare)) ?? 0);
      bone.add(att.obj);
      this.wornAttachments.set(key, { obj: att.obj, mats });
    }

    // The base skin shows only where nothing is worn — otherwise the body
    // clips through the clothes.
    for (const [region, mesh] of this.baseRegionMeshes) {
      mesh.visible = !desired.has(region);
    }

    // Remove parts whose region changed…
    for (const [region, worn] of this.worn) {
      if (desired.get(region) === worn.key) continue;
      for (const mesh of worn.meshes) mesh.removeFromParent();
      for (const mat of worn.ownedMaterials) mat.dispose();
      this.worn.delete(region);
    }
    // …and attach the new ones.
    for (const [region, partKey] of desired) {
      if (this.worn.has(region)) continue;
      const bareKey = partKey.replace(/_(m|f)$/, "");
      const tintByName = this.def.nameTintParts?.includes(bareKey) ?? false;
      const worn: WornPart = { key: partKey, meshes: [], ownedMaterials: [] };
      for (const src of this.assets.partMeshes(partKey)) {
        const mesh = src.clone();
        const bones = src.skeleton.bones.map(
          (b) => this.boneByName.get(b.name) ?? (b as THREE.Bone),
        );
        mesh.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), mesh.bindMatrix);
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        const glow = RARITY_GLOW[rarityByKey.get(partKey) ?? 0];
        if (!Array.isArray(mesh.material)) {
          if (this.def.tint) {
            mesh.material = this.assets.tintedMaterial(mesh.material, this.def.tint);
          } else if (tintByName || glow) {
            const mat = mesh.material.clone() as THREE.MeshStandardMaterial;
            if (tintByName) mat.color?.lerp(nameColor(this.myName), 0.55);
            if (glow) {
              mat.emissive = new THREE.Color(glow);
              mat.emissiveIntensity = 0.3;
            }
            mesh.material = mat;
            worn.ownedMaterials.push(mat);
          }
        }
        this.modelRoot.add(mesh);
        worn.meshes.push(mesh);
      }
      this.worn.set(region, worn);
    }
  }

  private buildLoot(model: string, rarity: number): void {
    // The PoE ritual, pillars only (no per-item meshes — cheap at scale):
    // anything worth walking to gets a tall light pillar; normal-tier gear
    // is just a small dim glint on the sand.
    const gem = model === "gem";
    const dim = !gem && rarity < 1;
    const geo = gem ? this.shared.gemGeo : dim ? this.shared.lootGeoSmall : this.shared.lootGeo;
    const mat = gem
      ? this.shared.gemMat
      : dim
        ? this.shared.lootMatNormal
        : this.shared.lootMats[Math.min(rarity, this.shared.lootMats.length - 1)];
    this.lootMesh = new THREE.Mesh(geo, mat);
    this.lootBaseY = dim ? 0.28 : 0.55;
    this.lootMesh.position.y = this.lootBaseY;
    this.group.add(this.lootMesh);
    const pillarMat = gem
      ? this.shared.pillarMats.gem
      : rarity >= 1
        ? this.shared.pillarMats.rarity[Math.min(rarity, 3)]
        : null;
    if (pillarMat) {
      const pillar = new THREE.Mesh(this.shared.pillarGeo, pillarMat);
      pillar.position.y = 3.75;
      this.group.add(pillar);
    }
    this.height = 0.7;
  }

  private buildBars(): void {
    this.hpBg = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.whiteTex,
        color: 0x331111,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
    );
    this.hpBg.scale.set(1.2, 0.14, 1);
    this.hpBg.position.y = this.height + 0.45;
    this.hpFg = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.shared.whiteTex,
        color: 0x44dd66,
        transparent: true,
        depthTest: false,
      }),
    );
    this.hpFg.scale.set(1.16, 0.1, 1);
    this.hpFg.position.y = this.height + 0.45;
    this.hpFg.renderOrder = 1;
    this.group.add(this.hpBg, this.hpFg);
  }

  private buildLabel(text: string): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.font = '64px "Anton SC", "Cinzel", sans-serif';
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = "#e9e4d4";
    ctx.fillText(text, 256, 84);
    const tex = new THREE.CanvasTexture(canvas);
    this.label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, opacity: 0.92 }),
    );
    this.label.scale.set(3.75, 0.94, 1);
    this.label.position.y = this.height + 0.95;
    this.group.add(this.label);
  }

  /** Swap the visible weapon when the replicated key changes. */
  private setWeapon(key: string, rarity: number): void {
    if (key === this.weaponKey && rarity === this.weaponRarity) return;
    this.weaponKey = key;
    this.weaponRarity = rarity;
    if (this.weaponObj) {
      this.weaponObj.removeFromParent(); // clone shares GPU resources…
      for (const m of this.weaponMats) m.dispose(); // …but glow mats are ours
      this.weaponObj = null;
      this.weaponMats = [];
    }
    if (key && this.handBone) {
      this.weaponObj = this.assets.instantiateWeapon(key);
      if (this.weaponObj) {
        this.weaponMats = applyRarityGlow(this.weaponObj, rarity);
        this.handBone.add(this.weaponObj);
      }
    }
  }

  // ---- animation state machine ----

  private playBase(role: string): void {
    if (this.baseRole === role) return;
    const next = this.actions.get(role);
    if (!next) return;
    const prev = this.actions.get(this.baseRole);
    this.baseRole = role;
    next.reset().fadeIn(FADE_S).play();
    prev?.fadeOut(FADE_S);
  }

  private onClipFinished(): void {
    if (!this.attacking) return;
    this.attacking = false;
    // Resume whatever the base state is; update() keeps steering it.
    const base = this.actions.get(this.baseRole);
    base?.reset().fadeIn(FADE_S).play();
  }

  /** Swing at a target: weapon-specific clip when we have one. */
  playAttack(targetPos: THREE.Vector3): void {
    this.playOneShot(
      this.actions.get(`attack:${this.weaponKey}`) ?? this.actions.get("attack"),
      targetPos,
    );
  }

  /**
   * A skill went off: spells play the cast clip, attacks the weapon swing.
   * `aimPos` (world) turns the body toward the action; null keeps facing.
   */
  playSkill(spell: boolean, aimPos: THREE.Vector3 | null): void {
    const action = spell
      ? (this.actions.get("cast") ?? this.actions.get("attack"))
      : (this.actions.get(`attack:${this.weaponKey}`) ?? this.actions.get("attack"));
    this.playOneShot(action, aimPos);
  }

  private playOneShot(action: THREE.AnimationAction | undefined, aimPos: THREE.Vector3 | null): void {
    if (this.attacking || this.wasDead || !this.mixer || !action) return;
    this.attacking = true;
    if (aimPos) {
      const dx = aimPos.x - this.group.position.x;
      const dz = aimPos.z - this.group.position.z;
      if (dx * dx + dz * dz > 1e-6) this.targetAngle = Math.atan2(dx, dz);
    }
    const base = this.actions.get(this.baseRole);
    base?.fadeOut(FADE_S * 0.5);
    action.setLoop(THREE.LoopOnce, 1);
    action.reset().fadeIn(FADE_S * 0.5).play();
  }

  update(er: EntityRender, pos: { x: number; y: number }, dt: number, t: number, groundY = 0): void {
    this.group.position.set(pos.x, groundY, pos.y);

    if (this.lootMesh) {
      this.lootMesh.rotation.y += dt * 1.5;
      this.lootMesh.position.y = this.lootBaseY + Math.sin(t * 2 + this.id) * 0.08;
      return;
    }

    // -- health bar --
    const pct = er.state.life_pct / 100;
    if (this.hpFg && this.hpBg) {
      this.hpFg.scale.x = Math.max(0.02, 1.16 * pct);
      this.hpFg.position.x = -(1.16 * (1 - pct)) / 2;
      (this.hpFg.material as THREE.SpriteMaterial).color.setHex(
        pct > 0.5 ? 0x44dd66 : pct > 0.25 ? 0xffd75a : 0xff5a5a,
      );
      const hide = er.state.dead || (er.state.kind === "Monster" && er.state.life_pct >= 100);
      this.hpBg.visible = !hide;
      this.hpFg.visible = !hide;
    }

    // -- death / respawn --
    if (er.state.dead !== this.wasDead) {
      this.wasDead = er.state.dead;
      if (er.state.dead) {
        this.attacking = false;
        const death = this.actions.get("death");
        if (death) {
          for (const a of this.actions.values()) a.fadeOut(FADE_S);
          death.setLoop(THREE.LoopOnce, 1);
          death.clampWhenFinished = true;
          death.reset().fadeIn(FADE_S).play();
        }
      } else {
        const death = this.actions.get("death");
        death?.stop();
        this.baseRole = "";
        this.playBase("idle");
        this.lastX = NaN; // don't sprint-face across the respawn teleport
      }
    }
    if (this.wasDead) {
      this.mixer?.update(dt);
      return;
    }

    // -- locomotion + facing --
    const moved =
      !Number.isNaN(this.lastX) &&
      Math.hypot(pos.x - this.lastX, pos.y - this.lastZ) > dt * 0.35;
    if (moved) {
      this.targetAngle = Math.atan2(pos.x - this.lastX, pos.y - this.lastZ);
    }
    this.lastX = pos.x;
    this.lastZ = pos.y;
    if (!this.attacking) this.playBase(moved ? "run" : "idle");

    // Shortest-arc turn toward where we're going (or who we're hitting).
    let delta = this.targetAngle - this.group.rotation.y;
    delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    this.group.rotation.y += delta * Math.min(1, dt * 12);

    this.composeGear(er.state.gear, er.state.gear_rarity ?? []);
    this.setWeapon(er.state.weapon, er.state.weapon_rarity ?? 0);
    this.mixer?.update(dt);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.group.removeFromParent();
    // Per-instance GPU resources only; cloned model geometry/materials are
    // shared with the AssetLibrary and live for the whole session.
    for (const worn of this.worn.values()) {
      for (const mat of worn.ownedMaterials) mat.dispose();
    }
    this.worn.clear();
    if (this.label) {
      const mat = this.label.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      mat.dispose();
    }
    (this.hpBg?.material as THREE.Material | undefined)?.dispose();
    (this.hpFg?.material as THREE.Material | undefined)?.dispose();
  }
}

/** Session-lifetime resources shared by every visual (never disposed). */
export class SharedResources {
  readonly whiteTex: THREE.Texture;
  readonly glowTex: THREE.Texture;
  readonly pillarGeo = new THREE.CylinderGeometry(0.13, 0.26, 7.5, 10, 1, true);
  readonly pillarMats: { rarity: THREE.MeshBasicMaterial[]; gem: THREE.MeshBasicMaterial };
  readonly lootGeo = new THREE.OctahedronGeometry(0.32);
  /** Normal-tier gear: a small, dim glint instead of a beacon. */
  readonly lootGeoSmall = new THREE.OctahedronGeometry(0.13);
  readonly gemGeo = new THREE.TetrahedronGeometry(0.3);
  readonly lootMats: THREE.MeshStandardMaterial[];
  readonly lootMatNormal = new THREE.MeshStandardMaterial({
    color: 0x8a8a93,
    emissive: 0x8a8a93,
    emissiveIntensity: 0.18,
    roughness: 0.6,
  });
  readonly gemMat: THREE.MeshStandardMaterial;
  readonly fallbackGeo = new THREE.SphereGeometry(0.5, 12, 8);
  readonly fallbackMat = new THREE.MeshStandardMaterial({ color: 0x888888 });

  constructor() {
    const data = new Uint8Array([255, 255, 255, 255]);
    this.whiteTex = new THREE.DataTexture(data, 1, 1);
    this.whiteTex.needsUpdate = true;
    // Soft radial falloff for flashes/tracers — a flat white texture on a
    // sprite reads as a literal square.
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    this.glowTex = new THREE.CanvasTexture(c);
    this.lootMats = RARITY_COLORS.map(
      (c) =>
        new THREE.MeshStandardMaterial({
          color: c,
          emissive: c,
          emissiveIntensity: 0.9,
          roughness: 0.4,
        }),
    );
    this.gemMat = new THREE.MeshStandardMaterial({
      color: 0x5adfdf,
      emissive: 0x5adfdf,
      emissiveIntensity: 1.0,
      roughness: 0.4,
    });

    // Loot pillars: vertical alpha gradient, additive, fog-aware.
    const pc = document.createElement("canvas");
    pc.width = 8;
    pc.height = 128;
    const pctx = pc.getContext("2d")!;
    const pgrad = pctx.createLinearGradient(0, 128, 0, 0);
    pgrad.addColorStop(0, "rgba(255,255,255,0.85)");
    pgrad.addColorStop(0.35, "rgba(255,255,255,0.4)");
    pgrad.addColorStop(1, "rgba(255,255,255,0)");
    pctx.fillStyle = pgrad;
    pctx.fillRect(0, 0, 8, 128);
    const pillarTex = new THREE.CanvasTexture(pc);
    const pillarMat = (color: number) =>
      new THREE.MeshBasicMaterial({
        map: pillarTex,
        color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    this.pillarMats = {
      rarity: [
        pillarMat(0xbfbfbf), // normal (unused; no pillar)
        pillarMat(0x5a8aff), // magic
        pillarMat(0xffd75a), // rare
        pillarMat(0xff9a3c), // unique
      ],
      gem: pillarMat(0x5adfdf),
    };
  }
}
