// Creature GLB repair pass (oishie pipeline stage 2).
// Input:  public/models/<id>.glb — Stable-Fast-3D image-to-3D output, trimesh-merged
//         (single mesh, single material, baked baseColor texture), facing -Z,
//         some with metallicFactor ~1 (renders pitch black).
// Output: same files, repaired in place (originals backed up to .glb-orig/ once):
//   1. Front pivot normalize: bake +180 deg Y rotation into POSITION+NORMAL so the
//      face/belly fronts +Z (three.js lookAt/camera convention). Recomputes min/max.
//   2. Matte mascot PBR: metallicFactor = 0, roughnessFactor = 0.65 on every
//      material. Base color texture preserved (baked bright colors stay vivid).
// Idempotent: skips files already stamped with generator tag "oishie-fix2".
// Usage: node scripts/fix-creature-glbs.mjs [--force] [modelsDir]
//   modelsDir (optional): repair GLBs in another directory instead of
//   public/models (e.g. scratch/regen for R0). Backup goes to <modelsDir>/.glb-orig.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM = process.argv.slice(2).find((a) => !a.startsWith("-"));
const MODELS = CUSTOM ? path.resolve(CUSTOM) : path.join(HERE, "..", "public", "models");
const BACKUP = CUSTOM ? path.join(MODELS, ".glb-orig") : path.join(HERE, "..", ".glb-orig");
const FORCE = process.argv.includes("--force");
const TAG = "oishie-fix2";

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2)
    throw new Error("not a GLB 2.0 file");
  const total = buf.readUInt32LE(8);
  if (total !== buf.length) throw new Error("GLB length mismatch");
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error("missing JSON chunk");
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binOff = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binOff);
  const binType = buf.readUInt32LE(binOff + 4);
  if (binType !== 0x004e4942) throw new Error("missing BIN chunk");
  const bin = Buffer.from(buf.subarray(binOff + 8, binOff + 8 + binLen));
  return { json, bin };
}

function writeGlb(json, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length + jsonPad, o);
  out.writeUInt32LE(0x4e4f534a, o + 4);
  o += 8;
  jsonBuf.copy(out, o);
  o += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) out[o++] = 0x20;
  out.writeUInt32LE(bin.length + binPad, o);
  out.writeUInt32LE(0x004e4942, o + 4);
  o += 8;
  bin.copy(out, o);
  return out;
}

// Rotate one VEC3 float accessor's data 180 deg about Y: (x,y,z) -> (-x,y,-z).
function rotY180(bin, json, accessorIndex) {
  const acc = json.accessors[accessorIndex];
  if (!acc || acc.type !== "VEC3" || acc.componentType !== 5126)
    throw new Error(`accessor ${accessorIndex} is not VEC3 float`);
  const view = json.bufferViews[acc.bufferView];
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    const x = bin.readFloatLE(o);
    const z = bin.readFloatLE(o + 8);
    bin.writeFloatLE(-x, o);
    bin.writeFloatLE(-z, o + 8);
  }
  if (acc.min && acc.max) {
    acc.min = [-acc.max[0], acc.min[1], -acc.max[2]];
    acc.max = [-acc.min[0], acc.max[1], -acc.min[2]];
    // fix: recompute properly (min/max swap after negation)
    const [mnx, mny, mnz] = acc.min;
    const [mxx, mxy, mxz] = acc.max;
    acc.min = [Math.min(mnx, mxx), Math.min(mny, mxy), Math.min(mnz, mxz)];
    acc.max = [Math.max(mnx, mxx), Math.max(mny, mxy), Math.max(mnz, mxz)];
  }
}

async function fixOne(file) {
  const p = path.join(MODELS, file);
  const buf = await fs.readFile(p);
  const { json, bin } = readGlb(buf);
  const gen = String(json.asset?.generator ?? "");
  if (!FORCE && gen.includes(TAG)) return "skip (stamped)";
  // Backup once.
  await fs.mkdir(BACKUP, { recursive: true });
  const bak = path.join(BACKUP, file);
  try {
    await fs.stat(bak);
  } catch {
    await fs.copyFile(p, bak);
  }
  // 1. Bake yaw=PI into geometry (POSITION + NORMAL of every primitive).
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const pos = prim.attributes?.POSITION;
      const nrm = prim.attributes?.NORMAL;
      if (pos === undefined) throw new Error(`${file}: primitive without POSITION`);
      rotY180(bin, json, pos);
      if (nrm !== undefined) rotY180(bin, json, nrm);
    }
  }
  // 2. Matte mascot PBR on every material.
  for (const m of json.materials ?? []) {
    m.pbrMetallicRoughness = m.pbrMetallicRoughness ?? {};
    m.pbrMetallicRoughness.metallicFactor = 0;
    m.pbrMetallicRoughness.roughnessFactor = 0.65;
  }
  json.asset.generator = `${gen} + ${TAG}(front=+Z,metal=0,rough=0.65)`;
  const out = writeGlb(json, bin);
  // Validate round-trip.
  const check = readGlb(out);
  if (!check.json.meshes?.length) throw new Error(`${file}: lost meshes`);
  await fs.writeFile(p, out);
  return `fixed (${(out.length / 1024).toFixed(0)} KB)`;
}

async function main() {
  const files = (await fs.readdir(MODELS)).filter((f) => f.endsWith(".glb")).sort();
  if (!files.length) throw new Error("no GLBs found");
  for (const f of files) {
    console.log("-", f, await fixOne(f));
  }
  console.log("done.");
}

main().catch((e) => {
  console.error("fix-creature-glbs failed:", e);
  process.exit(1);
});
