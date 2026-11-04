// Source of truth: scratch/landmarks/landmarks-3d.json (NEVER modified here).
// Generates lib/faceAnchors.ts (eyeL/eyeR/mouth only — what facePaint reads).
// --check: exit 1 when the generated file drifts from the JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = join(root, "scratch", "landmarks", "landmarks-3d.json");
const OUT = join(root, "lib", "faceAnchors.ts");
const db = JSON.parse(readFileSync(J, "utf8"));
const WANT = ["eyeL", "eyeR", "mouth"];
const ids = Object.keys(db.landmarks ?? {}).sort();
const num3 = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
let body = "";
for (const id of ids) {
  const pts = db.landmarks[id]?.points ?? {};
  const rows = [];
  for (const k of WANT) {
    const p = pts[k]?.pos;
    if (num3(p)) rows.push(`    ${k}: { pos: [${p.join(", ")}] },`);
  }
  body += `  ${JSON.stringify(id)}: {\n${rows.join("\n")}\n  },\n`;
}
const out =
  `// GENERATED from scratch/landmarks/landmarks-3d.json — DO NOT EDIT.\n` +
  `// Regen: node scripts/sync-face-anchors.mjs (sync enforced by scripts/verify-anchors.mjs).\n` +
  `export type FaceAnchorPoint = { pos: [number, number, number] };\n` +
  `export type FaceAnchorSet = { eyeL?: FaceAnchorPoint; eyeR?: FaceAnchorPoint; mouth?: FaceAnchorPoint };\n` +
  `export const FACE_ANCHORS: Record<string, FaceAnchorSet> = {\n${body}};\n`;
if (process.argv.includes("--check")) {
  let cur = null;
  try { cur = readFileSync(OUT, "utf8"); } catch {}
  if (cur !== out) { console.log("FAIL faceAnchors.ts drifts from landmarks-3d.json (run sync)"); process.exit(1); }
  console.log("PASS faceAnchors.ts in sync");
} else {
  writeFileSync(OUT, out);
  console.log(`wrote ${OUT} (${ids.length} species)`);
}
