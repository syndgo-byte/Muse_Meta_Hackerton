// Automated 3D creature asset acquisition — no manual signups, no accounts.
// Strategy:
//   1. Try royalty-free open-source .glb files from public repos/CDNs
//      (KhronosGroup glTF-Sample-Models via raw.githubusercontent + jsDelivr mirror).
//   2. Anything that fails to download/validate gets a procedurally generated
//      ORIGINAL low-poly monster .glb (valid GLB 2.0 binary, written with zero
//      dependencies) so `public/models/` always ends up with 24 real,
//      GLTFLoader-playable files matching the roster IDs.
//   3. Writes public/models/ATTRIBUTION.md with per-file source + license.
//
// Usage: node scripts/fetch-3d-creatures.mjs [--force]
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "public", "models");
const FORCE = process.argv.includes("--force");

// All 24 roster IDs from lib/species.ts (ROSTER).
const IDS = [
  "fire-01", "grass-01", "water-01",
  "fire-02", "fire-03", "fire-04", "fire-05",
  "grass-02", "grass-03", "grass-04", "grass-05",
  "water-02", "water-03", "water-04", "water-05",
  "rock-01", "rock-02", "rock-03", "rock-04",
  "wind-01", "wind-02", "wind-03", "wind-04", "wind-05",
];

// Creature-only sources (no props/objects). All openly licensed, no signup.
// - KayKit skeletons: CC0, KayKit-Game-Assets org on GitHub (self-contained .glb).
// - three.js example creatures: mrdoob/three.js repo (animated Fox? no —
//   Flamingo/Parrot/Horse/Xbot/Soldier/RobotExpressive + Khronos Fox/Duck/Fish).
const RAW_K = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0";
const RAW_T = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf";
const RAW_KK = "https://raw.githubusercontent.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0";
const K = (m) => `${RAW_K}/${m}/glTF-Binary/${m}.glb`;
const T = (m) => `${RAW_T}/${m}.glb`;
const KK = (f) => `${RAW_KK}/addons/kaykit_character_pack_skeletons/Characters/gltf/${f}.glb`;
const FOX = K("Fox"); // universal creature fallback (animated fox)

// Roster ID -> ordered candidate URLs. Every entry is a creature/being.
const MAP = {
  "fire-01": [FOX], "fire-02": [FOX],
  "fire-03": [KK("Skeleton_Minion")],
  "fire-04": [KK("Skeleton_Mage")], "fire-05": [KK("Skeleton_Mage")],
  "grass-01": [T("Parrot")], "grass-02": [T("Parrot")],
  "grass-03": [T("Horse")], "grass-04": [T("Horse")],
  "grass-05": [`${RAW_T}/RobotExpressive/RobotExpressive.glb`],
  "water-01": [K("Duck")],
  "water-02": [K("BarramundiFish")], "water-03": [K("BarramundiFish")],
  "water-04": [T("Flamingo")], "water-05": [K("BarramundiFish")],
  "rock-01": [KK("Skeleton_Warrior")], "rock-02": [KK("Skeleton_Warrior")],
  "rock-03": [KK("Skeleton_Minion")], "rock-04": [KK("Skeleton_Rogue")],
  "wind-01": [K("Duck")], "wind-02": [KK("Skeleton_Rogue")],
  "wind-03": [T("Xbot")], "wind-04": [T("Flamingo")], "wind-05": [T("Soldier")],
};

function candidatesFor(id) {
  const list = [...(MAP[id] ?? [])];
  if (!list.includes(FOX)) list.push(FOX);
  return list;
}

function isValidGlb(buf) {
  if (!buf || buf.length < 20) return false;
  return (
    buf.readUInt32LE(0) === 0x46546c67 && // "glTF"
    buf.readUInt32LE(4) === 2 &&
    buf.readUInt32LE(8) === buf.length
  );
}

async function tryFetch(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    return isValidGlb(buf) ? buf : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Procedural fallback: original low-poly monster GLBs ----------
// Minimal GLB 2.0 writer (non-indexed POSITION+NORMAL, 4 materials).
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ELEMENT_STYLE = {
  fire:  { body: [0.85, 0.37, 0.12, 1], glow: [1, 0.6, 0.24, 1], sx: 1.0, sy: 1.0, horns: 2, horn: 0.55 },
  grass: { body: [0.31, 0.61, 0.28, 1], glow: [0.62, 0.91, 0.44, 1], sx: 1.0, sy: 1.05, horns: 1, horn: 0.5 },
  water: { body: [0.18, 0.5, 0.77, 1], glow: [0.49, 0.78, 1, 1], sx: 1.05, sy: 0.9, horns: 2, horn: 0.4 },
  rock:  { body: [0.54, 0.5, 0.45, 1], glow: [1, 0.77, 0.42, 1], sx: 1.15, sy: 0.85, horns: 3, horn: 0.45 },
  wind:  { body: [0.5, 0.77, 0.71, 1], glow: [0.84, 1, 0.95, 1], sx: 0.9, sy: 1.15, horns: 1, horn: 0.4 },
};

function buildMonsterGlb(id) {
  const element = id.split("-")[0];
  const st = ELEMENT_STYLE[element] ?? ELEMENT_STYLE.wind;
  const rnd = mulberry32(hashStr(id));
  // part buckets: 0 body, 1 accent, 2 white, 3 glowDark
  const parts = [[], [], [], []];
  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const norm = (v) => { const l = Math.hypot(v[0],v[1],v[2]) || 1; return [v[0]/l, v[1]/l, v[2]/l]; };
  function tri(bucket, a, b, c) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) { parts[bucket].push(...p, ...n); }
  }
  function octa(bucket, cx, cy, cz, rx, ry, rz) {
    const T=[cx,cy+ry,cz], B=[cx,cy-ry,cz], X=[cx+rx,cy,cz], x=[cx-rx,cy,cz], Z=[cx,cy,cz+rz], z=[cx,cy,cz-rz];
    tri(bucket,T,X,Z); tri(bucket,T,Z,x); tri(bucket,T,x,z); tri(bucket,T,z,X);
    tri(bucket,B,Z,X); tri(bucket,B,x,Z); tri(bucket,B,z,x); tri(bucket,B,X,z);
  }
  function pyramid(bucket, cx, cy, cz, r, h, dx, dz) {
    const A=[cx+dx*h, cy+h, cz+dz*h];
    const c=[[-r,-0],[r,-0],[r,0],[-r,0]].map(([ox,oz])=>[cx+ox,cy,cz+oz]);
    for (let i=0;i<4;i++) tri(bucket, A, c[i], c[(i+1)%4]);
    tri(bucket, c[0], c[2], c[1]); tri(bucket, c[0], c[3], c[2]);
  }
  function box(bucket, cx, cy, cz, w, h, d) {
    const x0=cx-w/2,x1=cx+w/2,y0=cy-h/2,y1=cy+h/2,z0=cz-d/2,z1=cz+d/2;
    const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
    const F=[[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[3,2,6,7],[4,5,1,0]];
    for (const [a,b,c,d] of F) { tri(bucket,v[a],v[b],v[c]); tri(bucket,v[a],v[c],v[d]); }
  }

  const jx = 0.9 + rnd() * 0.2;
  const bodyRx = 0.75 * st.sx * jx, bodyRy = 0.95 * st.sy, bodyRz = 0.7;
  octa(0, 0, 0, 0, bodyRx, bodyRy, bodyRz);                       // body
  for (let i = 0; i < st.horns; i++) {                            // horns
    const a = (i / st.horns) * Math.PI * 2 + rnd() * 0.6;
    pyramid(1, Math.cos(a)*0.3, bodyRy*0.75, Math.sin(a)*0.25,
      0.14, st.horn*(0.85+rnd()*0.4), Math.cos(a)*0.5, Math.sin(a)*0.5);
  }
  const ez = bodyRz * 0.78, ey = 0.28;
  octa(2, -0.24, ey, ez, 0.14, 0.16, 0.1);                        // eyes
  octa(2, 0.24, ey, ez, 0.14, 0.16, 0.1);
  octa(3, -0.24, ey, ez + 0.09, 0.06, 0.07, 0.05);                // pupils
  octa(3, 0.24, ey, ez + 0.09, 0.06, 0.07, 0.05);
  box(1, -0.32, -bodyRy - 0.08, 0.05, 0.3, 0.22, 0.4);            // feet
  box(1, 0.32, -bodyRy - 0.08, 0.05, 0.3, 0.22, 0.4);
  octa(0, -bodyRx - 0.15, -0.1, 0, 0.16, 0.3, 0.16);              // arms
  octa(0, bodyRx + 0.15, -0.1, 0, 0.16, 0.3, 0.16);
  if (element === "fire" || element === "water" || element === "wind") {
    octa(1, 0, -0.35, -bodyRz - 0.3, 0.16, 0.16, 0.45);           // tail
  }

  const mats = [
    { name: "body", pbrMetallicRoughness: { baseColorFactor: st.body, roughnessFactor: 0.6, metallicFactor: 0.0 } },
    { name: "accent", pbrMetallicRoughness: { baseColorFactor: [0.18, 0.16, 0.15, 1], roughnessFactor: 0.85, metallicFactor: 0.0 } },
    { name: "eyeWhite", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], roughnessFactor: 0.25, metallicFactor: 0.0 } },
    { name: "pupil", pbrMetallicRoughness: { baseColorFactor: [0.1, 0.12, 0.11, 1], roughnessFactor: 0.2, metallicFactor: 0.0 }, emissiveFactor: [st.glow[0]*0.7, st.glow[1]*0.7, st.glow[2]*0.7] },
  ];

  const pos = [], nrm = [], prims = [];
  let vcount = 0;
  for (let m = 0; m < 4; m++) {
    const arr = parts[m];
    const n = arr.length / 6;
    if (!n) continue;
    for (let i = 0; i < arr.length; i += 6) { pos.push(arr[i], arr[i+1], arr[i+2]); nrm.push(arr[i+3], arr[i+4], arr[i+5]); }
    prims.push({ attributes: { POSITION: 0, NORMAL: 1 }, material: m, _start: vcount, _count: n });
    vcount += n;
  }
  const posBuf = Buffer.alloc(pos.length * 4), nrmBuf = Buffer.alloc(nrm.length * 4);
  for (let i = 0; i < pos.length; i++) posBuf.writeFloatLE(pos[i], i * 4);
  for (let i = 0; i < nrm.length; i++) nrmBuf.writeFloatLE(nrm[i], i * 4);
  const bin = Buffer.concat([posBuf, nrmBuf]);

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[i+a]); max[a] = Math.max(max[a], pos[i+a]); }
  }
  const json = {
    asset: { version: "2.0", generator: `oishie-fetch-3d (original, ${id})` },
    scene: 0, scenes: [{ nodes: [0], name: id }],
    nodes: [{ mesh: 0, name: id }],
    meshes: [{ name: id, primitives: prims.map(({ _start, _count, ...p }) => p) }],
    materials: mats,
    accessors: [
      { bufferView: 0, componentType: 5126, count: vcount, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: vcount, type: "VEC3" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
      { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  // Fix accessor offsets per primitive (all share views; use byteOffset via accessor? keep simple:
  // primitives share the full arrays, so give each primitive its own accessor pair.)
  json.accessors = [];
  json.meshes[0].primitives = prims.map((p) => {
    const base = json.accessors.length;
    json.accessors.push(
      { bufferView: 0, byteOffset: p._start * 12, componentType: 5126, count: p._count, type: "VEC3" },
      { bufferView: 1, byteOffset: p._start * 12, componentType: 5126, count: p._count, type: "VEC3" },
    );
    return { attributes: { POSITION: base, NORMAL: base + 1 }, material: p.material };
  });

  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBuf.length + jsonPad + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
  let o = 12;
  out.writeUInt32LE(jsonBuf.length + jsonPad, o); out.writeUInt32LE(0x4e4f534a, o + 4); o += 8;
  jsonBuf.copy(out, o); o += jsonBuf.length;
  for (let i = 0; i < jsonPad; i++) out[o++] = 0x20;
  out.writeUInt32LE(bin.length + binPad, o); out.writeUInt32LE(0x004e4942, o + 4); o += 8;
  bin.copy(out, o);
  return out;
}

// ---------- main ----------
async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const report = [];
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const dest = path.join(OUT, `${id}.glb`);
    if (!FORCE) {
      try {
        const cur = await fs.readFile(dest);
        if (isValidGlb(cur)) { report.push({ id, src: "cached", bytes: cur.length }); continue; }
      } catch { /* missing/invalid -> (re)fetch */ }
    }
    let saved = null, src = "";
    for (const url of candidatesFor(id, i)) {
      const buf = await tryFetch(url);
      if (buf) { saved = buf; src = `fetch ${url}`; break; }
    }
    if (!saved) {
      saved = buildMonsterGlb(id);
      if (!isValidGlb(saved)) throw new Error(`generator produced invalid GLB for ${id}`);
      src = "procedural-original (CC0, zero-dependency generator)";
    }
    await fs.writeFile(dest, saved);
    report.push({ id, src, bytes: saved.length });
  }
  const lines = [
    "# 3D creature assets — attribution",
    "",
    "Files: `public/models/<roster-id>.glb` (24 total, matching `ROSTER` in `lib/species.ts`).",
    "Generated by `scripts/fetch-3d-creatures.mjs` (run `node scripts/fetch-3d-creatures.mjs --force` to refresh).",
    "",
    "| file | source | license |",
    "|---|---|---|",
  ];
  for (const r of report) {
    const lic = r.src.startsWith("fetch")
      ? "upstream sample-model terms, see KhronosGroup/glTF-Sample-Models LICENSE.md"
      : r.src === "cached" ? "(previously acquired — see prior attribution)" : "CC0 (original, generated in-repo)";
    lines.push(`| ${r.id}.glb (${r.bytes} B) | ${r.src} | ${lic} |`);
  }
  lines.push("");
  await fs.writeFile(path.join(OUT, "ATTRIBUTION.md"), lines.join("\n"));
  const fetched = report.filter((r) => r.src.startsWith("fetch")).length;
  const gen = report.filter((r) => r.src.startsWith("procedural")).length;
  const cached = report.filter((r) => r.src === "cached").length;
  console.log(`done: ${report.length} files — fetched=${fetched} generated=${gen} cached=${cached}`);
  for (const r of report) console.log(` - ${r.id}.glb ${(r.bytes / 1024).toFixed(1)}KB :: ${r.src}`);
}

main().catch((e) => { console.error("fetch-3d-creatures failed:", e); process.exit(1); });
