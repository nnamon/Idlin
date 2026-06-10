// Asset pipeline: Quaternius packs → modular, meshopt-compressed glTF in
// web/public/assets/models/. The committed .glb files are this script's
// output; re-run only when changing which models/parts/clips ship.
//
// Sources (all CC0, Quaternius / quaternius.com, downloaded from
// quaternius.itch.io):
//   universal-base-characters        (base bodies, universal rig)
//   modular-character-outfits-fantasy (outfit parts, same rig)
//   universal-animation-library + 2  (clips targeting the same rig)
//   lowpoly-animated-monsters        (Skeleton, own rig, FBX)
//   lowpoly-medieval-weapons         (static weapons, FBX)
//
// The modular model: ONE body.glb carries the rig, the skin, and every
// animation clip; outfit parts ship as separate skinned glbs that the
// client binds to the body's skeleton at runtime (identical bone names,
// verified here). Which parts an entity wears is driven by replicated
// gear — characters visibly change as they equip loot.
//
// Usage:
//   FBX2GLTF=/path/to/FBX2glTF node scripts/process-assets.mjs <packs-dir>
// where <packs-dir> contains the extracted packs listed above.

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, mergeDocuments, prune, textureCompress, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(webDir, "public/assets/models");
const partsOut = resolve(outDir, "parts");

const packsDir = process.argv[2];
if (!packsDir) {
  console.error("usage: FBX2GLTF=<bin> node scripts/process-assets.mjs <packs-dir>");
  process.exit(1);
}
const fbx2gltf = process.env.FBX2GLTF;

const BASE = join(
  packsDir,
  "universal-base-characters/Universal Base Characters[Standard]/Base Characters/Godot - UE/Superhero_Male_FullBody.gltf",
);
const UAL1 = join(
  packsDir,
  "universal-animation-library/Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb",
);
const UAL2 = join(
  packsDir,
  "ual2/Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb",
);
const PARTS_DIR = join(
  packsDir,
  "modular-character-outfits-fantasy/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Modular Parts",
);
const MONSTERS_FBX = join(packsDir, "lowpoly-animated-monsters/FBX");
const WEAPONS_FBX = join(packsDir, "lowpoly-medieval-weapons/FBX");

// Clips the renderer's state machine uses (manifest.json maps roles → names).
const CLIPS_UAL1 = [
  "Idle_Loop",
  "Walk_Loop",
  "Jog_Fwd_Loop",
  "Sword_Attack",
  "Punch_Cross",
  "Spell_Simple_Shoot",
  "Pistol_Shoot",
  "Death01",
  "PickUp_Table",
];
const CLIPS_UAL2 = ["Zombie_Idle_Loop", "Zombie_Walk_Fwd_Loop", "Zombie_Scratch", "Melee_Hook"];

const PARTS = [
  "Male_Peasant_Arms",
  "Male_Peasant_Body",
  "Male_Peasant_Legs",
  "Male_Peasant_Feet",
  "Male_Ranger_Arms",
  "Male_Ranger_Body",
  "Male_Ranger_Legs",
  "Male_Ranger_Feet_Boots",
  "Male_Ranger_Head_Hood",
  "Male_Ranger_Acc_Pauldron",
];

// FBX-origin models: converted, then auto-normalized to a target size
// (Quaternius FBX exports carry inconsistent unit scales).
const FBX_MODELS = [
  { out: "stalker.glb", src: join(MONSTERS_FBX, "Skeleton.fbx"), targetHeight: 1.7 },
  { out: "cleaver.glb", src: join(WEAPONS_FBX, "Axe.fbx"), targetHeight: 0.85 },
  { out: "bow.glb", src: join(WEAPONS_FBX, "Bow_Wooden.fbx"), targetHeight: 1.0 },
  // Stand-in until a real wand mesh is sourced; reads fine at game distance.
  { out: "wand.glb", src: join(WEAPONS_FBX, "Dagger.fbx"), targetHeight: 0.45 },
];

mkdirSync(partsOut, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/**
 * Shrink textures (sources are up to 4K) and drop dead resources. Normal/
 * ORM/emissive maps are stripped: this is flat-shaded low-poly art under a
 * stylized night rig — base color carries the whole look, and each map
 * would otherwise be duplicated into every part file.
 */
async function finalize(doc, textureSize = 512) {
  for (const mat of doc.getRoot().listMaterials()) {
    mat.setNormalTexture(null);
    mat.setOcclusionTexture(null);
    mat.setMetallicRoughnessTexture(null);
    mat.setEmissiveTexture(null);
  }
  await doc.transform(
    dedup(),
    prune(),
    unpartition(),
    textureCompress({ encoder: sharp, targetFormat: "png", resize: [textureSize, textureSize] }),
  );
}

/** meshopt-compress (reorder + quantize + EXT_meshopt_compression). */
function compress(from, to) {
  execFileSync("npx", ["--yes", "@gltf-transform/cli", "meshopt", from, to], {
    cwd: webDir,
    stdio: "pipe",
  });
}

async function writeCompressed(doc, outPath) {
  const tmp = outPath + ".tmp.glb";
  await io.write(tmp, doc);
  compress(tmp, outPath);
  rmSync(tmp);
}

/** World-space height of the default scene (node transforms included —
 * FBX exports hide unit conversions in node scales). */
function sceneHeight(doc) {
  const { min, max } = getBounds(doc.getRoot().getDefaultScene());
  return max[1] - min[1];
}

// ---- 1. body.glb: base character + every clip, retargeted by bone name ----
{
  const doc = await io.read(BASE);
  for (const anim of doc.getRoot().listAnimations()) anim.dispose(); // base poses
  const bodyScene = doc.getRoot().getDefaultScene();

  for (const [src, wanted] of [
    [UAL1, CLIPS_UAL1],
    [UAL2, CLIPS_UAL2],
  ]) {
    const own = new Set(doc.getRoot().listAnimations());
    const lib = await io.read(src);
    mergeDocuments(doc, lib);
    // After the merge the library's armature is a second scene; point every
    // wanted channel at the body's identically-named bone, then drop the rest.
    const byName = new Map();
    bodyScene.traverse((n) => byName.set(n.getName(), n));
    for (const anim of doc.getRoot().listAnimations()) {
      if (own.has(anim)) continue; // kept from an earlier merge
      if (!wanted.includes(anim.getName())) {
        anim.dispose();
        continue;
      }
      for (const ch of anim.listChannels()) {
        const target = byName.get(ch.getTargetNode()?.getName() ?? "");
        if (target) {
          ch.setTargetNode(target);
        } else {
          ch.dispose();
        }
      }
    }
    for (const scene of doc.getRoot().listScenes()) {
      if (scene !== bodyScene) scene.dispose();
    }
    doc.getRoot().setDefaultScene(bodyScene);
  }

  const have = doc.getRoot().listAnimations().map((a) => a.getName());
  const missing = [...CLIPS_UAL1, ...CLIPS_UAL2].filter((c) => !have.includes(c));
  if (missing.length > 0) throw new Error(`body.glb: missing clips ${missing}`);

  await finalize(doc);
  await writeCompressed(doc, resolve(outDir, "body.glb"));
  console.log(`body.glb: ${have.length} clips, height ${sceneHeight(doc).toFixed(2)}`);
}

// ---- 2. outfit parts: skinned glbs the client binds to body's skeleton ----
for (const part of PARTS) {
  const src = join(PARTS_DIR, `${part}.gltf`);
  const doc = await io.read(src);
  await finalize(doc, 256);
  const out = resolve(partsOut, `${part.toLowerCase()}.glb`);
  await writeCompressed(doc, out);
  console.log(`parts/${part.toLowerCase()}.glb`);
}

// ---- 3. FBX-origin models (own rigs / static weapons) ----
for (const { out, src, targetHeight } of FBX_MODELS) {
  if (!fbx2gltf) {
    console.warn(`skipping ${out}: set FBX2GLTF to convert ${src}`);
    continue;
  }
  const tmpBase = resolve(outDir, out.replace(/\.glb$/, ".fbxconv"));
  execFileSync(fbx2gltf, ["--binary", "--input", src, "--output", tmpBase], { stdio: "pipe" });
  const doc = await io.read(`${tmpBase}.glb`);
  rmSync(`${tmpBase}.glb`);

  // Normalize wildly varying FBX unit scales. The scale must live on a
  // fresh wrapper node: animation clips carry scale tracks that would stomp
  // a value baked onto the armature itself.
  const h = sceneHeight(doc);
  if (h > 0 && (h < targetHeight * 0.5 || h > targetHeight * 2)) {
    const s = targetHeight / h;
    const scene = doc.getRoot().getDefaultScene();
    const wrapper = doc.createNode("ScaleRoot").setScale([s, s, s]);
    for (const node of scene.listChildren()) {
      scene.removeChild(node);
      wrapper.addChild(node);
    }
    scene.addChild(wrapper);
    console.log(`${out}: normalized height ${h.toFixed(3)} -> ${targetHeight}`);
  }

  await finalize(doc);
  await writeCompressed(doc, resolve(outDir, out));
  console.log(out);
}

console.log("done →", outDir);
