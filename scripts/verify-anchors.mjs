// R-F-anchors contract: landmarks-3d.json invariants that facePaint relies on.
// - NOT a behavior proof (paint is verified by captures); fails loudly if the
//   data file drifts from the shape the anchor path assumes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = JSON.parse(readFileSync(join(root, "scratch/landmarks/landmarks-3d.json"), "utf8"));
let fail = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) fail++; };
check(db.frame === "blender-world Z-up (glTF import), L = +X", `frame is blender-world (${db.frame})`);
const lm = db.landmarks ?? {};
const ids = Object.keys(lm);
check(ids.length === 24, `24 species (got ${ids.length})`);
const num3 = (p) => Array.isArray(p) && p.length === 3 && p.every((n) => Number.isFinite(n));
let eyeOK = 0, mouthMiss = [];
for (const [id, v] of Object.entries(lm)) {
  const pts = v?.points ?? {};
  const eL = pts.eyeL?.pos, eR = pts.eyeR?.pos;
  if (num3(eL) && num3(eR)) eyeOK++;
  else console.log(`FAIL ${id} eyeL/eyeR malformed`);
  if (!num3(pts.mouth?.pos)) mouthMiss.push(id);
}
check(eyeOK === 24, `eyeL+eyeR numeric on 24/24 (got ${eyeOK})`);
const wantMouthMiss = ["fire-04", "grass-02", "rock-01", "rock-03", "wind-03", "wind-05"].sort().join(",");
check(mouthMiss.sort().join(",") === wantMouthMiss, `mouth missing exactly 6 (${mouthMiss.join(",")})`);
// feet must exist where the face code never falls back (informational guards).
const footMiss = ids.filter((id) => !num3(lm[id].points?.footL?.pos) || !num3(lm[id].points?.footR?.pos));
check(footMiss.length === 0, `footL+footR on 24/24 ${footMiss.length ? "(" + footMiss.join(",") + ")" : ""}`);
// Generated-table sync: lib/faceAnchors.ts must equal sync output byte-for-byte.
const { execFileSync } = await import("node:child_process");
try {
  execFileSync(process.execPath, ["scripts/sync-face-anchors.mjs", "--check"], { cwd: root, stdio: "pipe" });
  console.log("PASS faceAnchors.ts in sync");
} catch {
  console.log("FAIL faceAnchors.ts drifts from landmarks-3d.json");
  fail++;
}
console.log(fail ? `${fail} FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
