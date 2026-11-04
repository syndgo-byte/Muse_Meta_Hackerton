// 5a 검증: 감정 파라미터 19종 전수 상이 + 범위 + fire-01 한정.
// 실행: node scripts/verify-faces.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "scratch", ".build-faces");
const require = createRequire(import.meta.url);

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
execFileSync(process.execPath, [
  join(ROOT, "node_modules", "typescript", "bin", "tsc"),
  join("lib", "motion", "faces.ts"),
  join("lib", "motion", "emotes.ts"),
  "--outDir", BUILD, "--module", "commonjs", "--target", "es2020",
  "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop",
], { cwd: ROOT, stdio: "inherit" });

const faces = require(join(BUILD, "motion", "faces.js"));
const emotes = require(join(BUILD, "motion", "emotes.js"));
const { FACE_PARAMS, PARAM_FACE_SPECIES, faceParamsFor } = faces;
const { EMOTE_IDS } = emotes;

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`);
  if (!ok) fail++;
};

// 1. 19 감정 전부 정의.
check("table covers EMOTE_IDS", EMOTE_IDS.every((id) => FACE_PARAMS[id] !== undefined),
  `${Object.keys(FACE_PARAMS).length}/${EMOTE_IDS.length}`);

// 2. 전수 상이 (5-튜플 완전일치 기준).
const keys = EMOTE_IDS.filter((id) => FACE_PARAMS[id]);
const seen = new Map();
let dupe = "";
for (const id of keys) {
  const p = FACE_PARAMS[id];
  const k = [p.lid, p.lidLow, p.pupil, p.smile, p.mouthOpen].join(",");
  if (seen.has(k)) { dupe = `${seen.get(k)}==${id}`; break; }
  seen.set(k, id);
}
check("19 combos pairwise distinct", dupe === "", dupe || `${keys.length} unique`);

// 3. 범위.
const inR = (v, a, b) => typeof v === "number" && v >= a && v <= b;
const bad = keys.filter((id) => {
  const p = FACE_PARAMS[id];
  return !(inR(p.lid, 0, 1) && inR(p.lidLow, 0, 1) && inR(p.pupil, 0.6, 1.4) &&
    inR(p.smile, -1, 1) && inR(p.mouthOpen, 0, 1));
});
check("param ranges", bad.length === 0, bad.join(",") || "ok");

// 4. fire-01 한정.
check("PARAM_FACE_SPECIES == [fire-01]",
  Array.isArray(PARAM_FACE_SPECIES) && PARAM_FACE_SPECIES.length === 1 && PARAM_FACE_SPECIES[0] === "fire-01",
  JSON.stringify(PARAM_FACE_SPECIES));

// 5. faceParamsFor 분기 스모크 (faceFor와 동일 조건).
const o = { emoteT: 0.8, hug: false, dancing: false };
check("idle non-dancing -> null", faceParamsFor("idle", o) === null);
check("roam non-dancing -> null", faceParamsFor("roam", o) === null);
const d = faceParamsFor("idle", { ...o, dancing: true });
check("dancing -> rest+nopaint", !!d && d.mouth === false &&
  d.p.lid === 0 && d.p.pupil === 1 && d.p.mouthOpen === 0);
const h = faceParamsFor("happy", o);
check("happy -> table combo", !!h && h.mouth === true && h.eyes === "happy" &&
  JSON.stringify(h.p) === JSON.stringify(FACE_PARAMS.happy));
const eat0 = faceParamsFor("eat", { emoteT: 0, hug: false, dancing: false });
const eat1 = faceParamsFor("eat", { emoteT: 0.2, hug: false, dancing: false });
check("eat mouth oscillates", !!eat0 && !!eat1 && eat0.p.mouthOpen !== eat1.p.mouthOpen,
  `${eat0?.p.mouthOpen} vs ${eat1?.p.mouthOpen}`);
const dw0 = faceParamsFor("drowsy", { emoteT: 0, hug: false, dancing: false });
const dw1 = faceParamsFor("drowsy", { emoteT: 0.5, hug: false, dancing: false });
check("drowsy mouth toggles paint", !!dw0 && !!dw1 && dw0.mouth !== dw1.mouth,
  `mouth ${dw0?.mouth} vs ${dw1?.mouth}`);

rmSync(BUILD, { recursive: true, force: true });
console.log(fail ? `${fail} CHECK(S) FAILED` : "ALL PASSED");
process.exit(fail ? 1 : 0);
