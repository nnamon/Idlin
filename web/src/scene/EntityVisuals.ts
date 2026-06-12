import * as THREE from "three";
import type { EntityRender } from "../world/store";
import type { EntityState } from "../gen/EntityState";
import type { AssetLibrary, BodyVariant, ModelDef } from "./Assets";

const RARITY_COLORS = [0xbfbfbf, 0x5a8aff, 0xffd75a, 0xff9a3c];
/** Where an attack clip CONNECTS, as a fraction of its length. The
 *  Quaternius swings land their blow just past mid-clip. */
const CONTACT_FRAC = 0.45;
/** ?animdebug=1: log every animation decision to the console. */
const ANIM_DEBUG = new URLSearchParams(location.search).has("animdebug");
const FADE_S = 0.18;

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
  private bubble: THREE.Sprite | null = null;
  private bubbleTex: THREE.CanvasTexture | null = null;
  private bubbleShownAt = 0;
  private hpBg: THREE.Sprite | null = null;
  private hpFg: THREE.Sprite | null = null;
  private label: THREE.Sprite | null = null;
  private weaponKey = "";
  private oneShot: THREE.AnimationAction | null = null;
  /** Inverted-hull cel outlines (magic/rare elites). */
  private outlineHulls: THREE.Object3D[] = [];
  private outlineMat: THREE.MeshBasicMaterial | null = null;
  // Impact feedback (decaying; all visual-root only — the sim position
  // is never touched).
  private hitstopMs = 0;
  private punchMs = 0;
  private punchMag = 0;
  private kbX = 0;
  private kbZ = 0;
  private kbMs = 0;
  private weaponObj: THREE.Object3D | null = null;
  private handBone: THREE.Object3D | null = null;
  /** Bone-worn rigid gear (shields), keyed by gear key. */
  private wornAttachments = new Map<string, THREE.Object3D>();

  constructor(
    private readonly id: number,
    er: EntityRender,
    private readonly assets: AssetLibrary,
    private readonly shared: SharedResources,
  ) {
    const { state } = er;
    this.myName = state.name;
    this.modelKey = state.model;
    if (state.kind === "Loot") {
      this.buildLoot(state.model, state.rarity);
    } else {
      this.buildModel(state.model, state.kind === "Monster", state.rarity);
      this.buildBars();
      if (state.kind === "Character") this.buildLabel(state.name);
      // Elite monsters announce themselves: rarity-tinted nameplates,
      // same ladder as loot (magic blue / rare gold / unique orange).
      else if (state.kind === "Monster" && state.rarity > 0) {
        this.buildLabel(state.name, RARITY_COLORS[state.rarity]);
      }
      this.composeGear(this.dressed(state));
      this.setWeapon(state.weapon);
    }
  }

  private buildModel(model: string, isMonster: boolean, rarity = 0): void {
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

    // Cel outline for ELITES: an inverted hull in the rarity color —
    // magic blue, rare gold. Uniques are deliberately NOT outlined:
    // they are their own design, and they carry the boss bar.
    if (isMonster && (rarity === 1 || rarity === 2)) {
      this.addOutline(inst.root, RARITY_COLORS[rarity]);
    }
  }

  /** Classic toon outline: back-face hulls pushed out along normals,
   *  bound to the same skeleton so they deform with the body. */
  private addOutline(root: THREE.Object3D, color: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      toneMapped: false,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace(
        "#include <skinning_vertex>",
        "#include <skinning_vertex>\n\ttransformed += objectNormal * 0.03;",
      );
    };
    this.outlineMat = mat;
    const sources: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) sources.push(o as THREE.Mesh);
    });
    for (const src of sources) {
      let hull: THREE.Mesh;
      const sm = src as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh) {
        const h = new THREE.SkinnedMesh(sm.geometry, mat);
        h.bind(sm.skeleton, sm.bindMatrix);
        h.bindMode = sm.bindMode;
        hull = h;
      } else {
        hull = new THREE.Mesh(src.geometry, mat);
      }
      hull.position.copy(src.position);
      hull.quaternion.copy(src.quaternion);
      hull.scale.copy(src.scale);
      hull.visible = src.visible;
      hull.frustumCulled = false;
      src.parent?.add(hull);
      this.outlineHulls.push(hull);
    }
  }

  /**
   * The paper-doll: defaults fill each region, replicated gear overrides by
   * region. Bound to this body's skeleton — same rig, shared bind pose.
   */

  /** Townsfolk (idler-model monsters) ship no gear over the wire: dress
   *  them deterministically by net id, so the crowd varies in body sets,
   *  hoods, and (via model variants) skin/hair — and never flickers. */
  private dressed(state: EntityState): string[] {
    if (state.kind !== "Monster" || state.model !== "idler" || state.gear.length) {
      return state.gear;
    }
    let h = (state.id * 2654435761) >>> 0;
    h ^= h >>> 13;
    const sets = [
      ["peasant_body", "peasant_legs", "peasant_feet"],
      ["ranger_body", "ranger_legs", "ranger_feet"],
      ["peasant_body", "ranger_legs", "peasant_feet"],
      ["ranger_body", "peasant_legs", "peasant_feet"],
    ];
    const out = [...sets[(h >>> 3) % sets.length]];
    if (((h >>> 9) & 3) === 0) out.push("ranger_hood");
    return out;
  }

  private composeGear(gear: string[]): void {
    const key = gear.join("|");
    if (key === this.gearKey || !this.def || !this.modelRoot) return;
    this.gearKey = key;

    // Wire keys are variant-free; the body variant's suffix picks the
    // male/female part file (falling back to the bare key, e.g. hair).
    const resolve = (key: string): string => {
      const suffixed = key + (this.variant?.partSuffix ?? "");
      return this.assets.partDef(suffixed) ? suffixed : key;
    };
    const desired = new Map<string, string>(); // region → part key
    for (const part of this.def.defaultParts ?? []) {
      const resolved = resolve(part);
      const def = this.assets.partDef(resolved);
      if (def) desired.set(def.region, resolved);
    }
    for (const part of gear) {
      const resolved = resolve(part);
      const def = this.assets.partDef(resolved);
      if (def) desired.set(def.region, resolved);
    }
    // Hair occupies its own region and disappears under a worn hood.
    if (this.hairKey && !desired.has("head")) {
      desired.set("hair", this.hairKey);
    }

    // Rigid bone-worn gear (shields) diffs separately from skinned parts.
    const wantAttach = new Set(gear.filter((k) => this.assets.attachmentDef(k) !== null));
    for (const [key, obj] of this.wornAttachments) {
      if (!wantAttach.has(key)) {
        obj.removeFromParent(); // clone shares GPU resources; no dispose
        this.wornAttachments.delete(key);
      }
    }
    for (const key of wantAttach) {
      if (this.wornAttachments.has(key)) continue;
      const att = this.assets.attachmentDef(key);
      if (!att) continue;
      const bone = this.modelRoot.getObjectByName(att.bone);
      if (!bone) continue;
      bone.add(att.obj);
      this.wornAttachments.set(key, att.obj);
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
        if (!Array.isArray(mesh.material)) {
          if (this.def.tint) {
            mesh.material = this.assets.tintedMaterial(mesh.material, this.def.tint);
          } else if (tintByName) {
            const mat = mesh.material.clone() as THREE.MeshStandardMaterial;
            mat.color?.lerp(nameColor(this.myName), 0.55);
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
    const obol = model === "currency";
    const dim = !gem && !obol && rarity < 1;
    const geo = gem
      ? this.shared.gemGeo
      : obol
        ? this.shared.obolGeo
        : dim
          ? this.shared.lootGeoSmall
          : this.shared.lootGeo;
    const mat = gem
      ? this.shared.gemMat
      : obol
        ? this.shared.obolMat
        : dim
          ? this.shared.lootMatNormal
          : this.shared.lootMats[Math.min(rarity, this.shared.lootMats.length - 1)];
    this.lootMesh = new THREE.Mesh(geo, mat);
    this.lootBaseY = dim ? 0.28 : 0.55;
    this.lootMesh.position.y = this.lootBaseY;
    this.group.add(this.lootMesh);
    // Obols reuse the rarity pillars via their display tier.
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

  private buildLabel(text: string, tint?: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    // Affix-composed elite names run long — shrink to fit the canvas.
    let px = 56;
    ctx.font = `bold ${px}px "Idlin Mono", ui-monospace, Menlo, monospace`;
    while (px > 30 && ctx.measureText(text).width > 492) {
      px -= 4;
      ctx.font = `bold ${px}px "Idlin Mono", ui-monospace, Menlo, monospace`;
    }
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle =
      tint !== undefined ? `#${tint.toString(16).padStart(6, "0")}` : "#e9e4d4";
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
  private setWeapon(key: string): void {
    if (key === this.weaponKey) return;
    this.weaponKey = key;
    if (this.weaponObj) {
      this.weaponObj.removeFromParent(); // clone shares GPU resources; no dispose
      this.weaponObj = null;
    }
    if (key && this.handBone) {
      this.weaponObj = this.assets.instantiateWeapon(key);
      if (this.weaponObj) this.handBone.add(this.weaponObj);
    }
  }

  // ---- animation state machine ----

  private modelKey = "";

  private playBase(role: string): void {
    if (this.baseRole === role) return;
    const next = this.actions.get(role);
    if (!next) {
      if (ANIM_DEBUG) {
        console.log(
          `[anim] #${this.id} ${this.myName} model=${this.modelKey} MISSING role=${role};` +
            ` have=[${[...this.actions.keys()].join(", ")}]`,
        );
      }
      return;
    }
    if (ANIM_DEBUG) {
      console.log(
        `[anim] #${this.id} ${this.myName} model=${this.modelKey} ` +
          `${this.baseRole || "(bind)"} -> ${role}`,
      );
    }
    const prev = this.actions.get(this.baseRole);
    this.baseRole = role;
    if (prev) {
      next.reset().fadeIn(FADE_S).play();
      prev.fadeOut(FADE_S);
    } else {
      // FIRST activation: full weight immediately — fading in from
      // nothing blends from the bind pose (a visible T-pose flash on
      // every fresh visual).
      next.reset().play();
      next.setEffectiveWeight(1);
    }
  }

  private onClipFinished(): void {
    if (!this.attacking) return;
    this.attacking = false;
    // Resume whatever the base state is; update() keeps steering it.
    const base = this.actions.get(this.baseRole);
    base?.reset().fadeIn(FADE_S).play();
  }

  /** A speech bubble above the head: latest line wins, fades out. */
  showSpeech(text: string, at: number, now: number): void {
    if (at !== this.bubbleShownAt) {
      this.bubbleShownAt = at;
      if (!this.bubble) {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 96;
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        this.bubble = new THREE.Sprite(mat);
        this.bubble.renderOrder = 3;
        this.bubble.scale.set(4.4, 0.82, 1);
        this.bubbleTex = tex;
        this.group.add(this.bubble);
      }
      const canvas = (this.bubbleTex!.image as HTMLCanvasElement);
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = '32px "Idlin Mono", ui-monospace, Menlo, monospace';
      ctx.textAlign = "center";
      const w = Math.min(500, ctx.measureText(text).width + 36);
      ctx.fillStyle = "rgba(12, 12, 22, 0.82)";
      ctx.beginPath();
      ctx.roundRect((canvas.width - w) / 2, 14, w, 64, 14);
      ctx.fill();
      ctx.fillStyle = "#e8e2cc";
      ctx.fillText(text, canvas.width / 2, 58, 460);
      this.bubbleTex!.needsUpdate = true;
      this.bubble.position.set(0, this.height + 1.15, 0);
      this.bubble.visible = true;
    }
    const age = (now - at) / 4500;
    if (this.bubble) {
      (this.bubble.material as THREE.SpriteMaterial).opacity =
        age < 0.75 ? 1 : 1 - (age - 0.75) / 0.25;
      if (age >= 1) this.bubble.visible = false;
    }
  }

  /**
   * Took a hit: a beat of hitstop (the body registers the blow), a
   * scale punch, and a directional shove on the visual root. Strength
   * is the hit's significance (~amount-scaled, 0.25..1.6).
   */
  impact(
    dirX: number,
    dirZ: number,
    strength: number,
    crit: boolean,
    killed: boolean,
    stun = false,
    freeze = false,
  ): void {
    if (this.lootMesh) return;
    // Stuns hold the body visibly (the sim locked it too); freezes
    // longest — the model stands ICED until the lock releases.
    const stop = freeze ? 480 : stun ? 300 : killed ? 120 : crit ? 90 : 55;
    this.hitstopMs = Math.max(this.hitstopMs, stop);
    this.punchMs = 130;
    this.punchMag = Math.min(0.16, 0.05 + strength * 0.06) * (crit || stun ? 1.5 : 1);
    const len = Math.hypot(dirX, dirZ) || 1;
    const shove = Math.min(0.3, 0.1 + strength * 0.1) * (killed ? 1.6 : 1);
    this.kbX = (dirX / len) * shove;
    this.kbZ = (dirZ / len) * shove;
    this.kbMs = 140;
  }

  /**
   * A use BEGAN: play the windup in TRUE TIME. The clip is rate-scaled
   * so its contact frame lands exactly `contactS` seconds from now —
   * which is when the sim resolves the strike and HitFx arrives. The
   * follow-through runs at the same rate; a new use interrupts it.
   */
  playUse(spell: boolean, aimPos: THREE.Vector3 | null, _useS: number, contactS: number): void {
    if (this.wasDead || !this.mixer) return;
    const action = spell
      ? (this.actions.get("cast") ?? this.actions.get("attack"))
      : (this.actions.get(`attack:${this.weaponKey}`) ?? this.actions.get("attack"));
    if (!action) return;
    if (aimPos) {
      const dx = aimPos.x - this.group.position.x;
      const dz = aimPos.z - this.group.position.z;
      if (dx * dx + dz * dz > 1e-6) this.targetAngle = Math.atan2(dx, dz);
    }
    // Cadence is authoritative: a fresh windup cuts the previous
    // follow-through (the sim's busy gate guarantees no true overlap).
    if (this.oneShot && this.oneShot !== action) this.oneShot.stop();
    this.oneShot = action;
    const dur = action.getClip().duration;
    const scale = (dur * CONTACT_FRAC) / Math.max(0.05, contactS);
    action.timeScale = Math.min(3.5, Math.max(0.35, scale));
    this.attacking = true;
    const base = this.actions.get(this.baseRole);
    base?.fadeOut(FADE_S * 0.5);
    action.setLoop(THREE.LoopOnce, 1);
    action.reset().fadeIn(FADE_S * 0.5).play();
  }

  update(er: EntityRender, pos: { x: number; y: number }, dt: number, t: number, groundY = 0): void {
    this.group.position.set(pos.x, groundY, pos.y);

    // -- impact feedback: knockback shove, scale punch, hitstop --
    if (this.kbMs > 0) {
      const a = this.kbMs / 140;
      this.group.position.x += this.kbX * a;
      this.group.position.z += this.kbZ * a;
      this.kbMs -= dt * 1000;
    }
    if (this.modelRoot) {
      const base = this.def?.scale ?? 1;
      if (this.punchMs > 0) {
        const a = this.punchMs / 130;
        const sc = 1 + this.punchMag * a;
        // Squash, not balloon: wider and slightly shorter, volume-ish.
        this.modelRoot.scale.set(base * sc, base / Math.sqrt(sc), base * sc);
        this.punchMs -= dt * 1000;
      } else if (this.modelRoot.scale.x !== base) {
        this.modelRoot.scale.setScalar(base);
      }
    }
    if (this.mixer) {
      if (this.hitstopMs > 0) {
        this.mixer.timeScale = 0.06;
        this.hitstopMs -= dt * 1000;
      } else if (this.mixer.timeScale !== 1) {
        this.mixer.timeScale = 1;
      }
    }

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

    // Nameplates: idlers keep theirs always; a monster's name dies with
    // it (an elite corpse doesn't need an announcement). Outlines die
    // with their owner too.
    if (this.label && er.state.kind === "Monster") {
      this.label.visible = !er.state.dead;
    }
    if (er.state.dead && this.outlineHulls.length > 0) {
      for (const o of this.outlineHulls) o.visible = false;
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

    this.composeGear(this.dressed(er.state));
    this.setWeapon(er.state.weapon);
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
    this.outlineMat?.dispose();
    (this.hpBg?.material as THREE.Material | undefined)?.dispose();
    (this.hpFg?.material as THREE.Material | undefined)?.dispose();
    if (this.bubble) {
      this.bubble.removeFromParent();
      (this.bubble.material as THREE.Material).dispose();
      this.bubbleTex?.dispose();
    }
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
  /** Obols: a small gold coin-ish disc. */
  readonly obolGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12);
  readonly obolMat = new THREE.MeshStandardMaterial({
    color: 0xd8b85a,
    emissive: 0xd8b85a,
    emissiveIntensity: 0.55,
    roughness: 0.35,
  });
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
