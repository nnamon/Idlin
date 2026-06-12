// Building/prop pipeline: the Medieval Village packs (staged on the
// external drive) → meshopt glb props for the town tileset. Static
// models only — far simpler than process-assets.mjs, same output style.
//
// Usage: FBX2GLTF=<bin> node scripts/process-buildings.mjs [packs-root]

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, textureCompress, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(webDir, "public/assets/models/props");
const packs = process.argv[2] ?? "/Volumes/ORICO SSD/idlin-assets/packs";
const MEGA = join(packs, "medieval_village_megakit/Medieval Village MegaKit[Standard]/glTF");
const VILLAGE = join(packs, "Medieval Village Pack - Dec 2020/Buildings/FBX");
const fbx2gltf = process.env.FBX2GLTF;

// Native glTF pieces (the MegaKit).
const GLTF_PROPS = [
  ["crate_town", "Prop_Crate.gltf", 0.8],
  ["wagon", "Prop_Wagon.gltf", 1.4],
  ["fence_wood", "Prop_WoodenFence_Single.gltf", 1.1],
  ["wall_town", "Wall_UnevenBrick_Straight.gltf", 1.6],
];
// Whole buildings (the older Village pack, FBX).
const FBX_PROPS = [
  ["house_1", "House_1.fbx", 3.4],
  ["house_2", "House_2.fbx", 3.4],
  ["house_3", "House_3.fbx", 3.2],
  ["house_4", "House_4.fbx", 3.6],
  ["inn", "Inn.fbx", 4.6],
  ["blacksmith", "Blacksmith.fbx", 3.6],
];

mkdirSync(outDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function finalize(doc) {
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
    textureCompress({ encoder: sharp, targetFormat: "png", resize: [256, 256] }),
  );
}

function normalize(doc, target, key) {
  const scene = doc.getRoot().getDefaultScene();
  const { min, max } = getBounds(scene);
  const h = max[1] - min[1];
  if (h > 0 && Math.abs(h - target) > 0.05) {
    const s = target / h;
    for (const node of scene.listChildren()) {
      const cur = node.getScale();
      node.setScale([cur[0] * s, cur[1] * s, cur[2] * s]);
    }
    console.log(`${key}: height ${h.toFixed(2)} -> ${target}`);
  }
}

async function emit(doc, key, target) {
  await finalize(doc);
  normalize(doc, target, key);
  const tmp = resolve(outDir, `${key}.tmp.glb`);
  const out = resolve(outDir, `${key}.glb`);
  await io.write(tmp, doc);
  execFileSync("npx", ["--yes", "@gltf-transform/cli", "meshopt", tmp, out], {
    cwd: webDir,
    stdio: "pipe",
  });
  rmSync(tmp);
  console.log(`props/${key}.glb`);
}

for (const [key, file, target] of GLTF_PROPS) {
  await emit(await io.read(join(MEGA, file)), key, target);
}
for (const [key, file, target] of FBX_PROPS) {
  if (!fbx2gltf) {
    console.warn(`skip ${key}: set FBX2GLTF`);
    continue;
  }
  const tmpBase = resolve(outDir, `${key}.fbxconv`);
  execFileSync(fbx2gltf, ["--binary", "--input", join(VILLAGE, file), "--output", tmpBase], {
    stdio: "pipe",
  });
  const doc = await io.read(`${tmpBase}.glb`);
  rmSync(`${tmpBase}.glb`);
  await emit(doc, key, target);
}
console.log("done");
