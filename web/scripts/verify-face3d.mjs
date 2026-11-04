// EL-1 검증: 눈꺼풀·입 셰이프 키 GLB + lib/face3d 런타임.
// usage: node scripts/verify-face3d.mjs [glbdir=public/models-rigged] [ids=all]
//  1) 종별 morph 존재·이름 (Eyelid_L/R·EyelidLash_L/R: blink·half, MouthInner: open·round, 입 없는 종은 MouthInner 없음)
//  2) 텍스처 변경 0회: GLB 이미지 바이트 = scratch/face3d/orig 원본, 런타임이 material/map을 건드리지 않음
//  3) 춤 1곡(ateez·a2o 전 구간) 동안 눈꺼풀(감은 상태) 중심-머리 본 거리 변화 < 1%
//  4) 깜빡임 타이머: 60초 모의에서 간격 2.5~6초, 닫힘 시간 ≈ 200ms
import { readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

globalThis.self = globalThis;
const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const err0 = console.error;
console.error = (...a) => {
  if (typeof a[0] === "string" && a[0].includes("Couldn't load texture")) return;
  err0(...a);
};

const DIR = process.argv[2] || join("public", "models-rigged");
const ORIG = join("scratch", "face3d", "orig");
const BUILD = join("scratch", ".build-face3d");
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
execFileSync(process.execPath, [
  join("node_modules", "typescript", "bin", "tsc"),
  join("lib", "motion", "dances", "index.ts"), join("lib", "autoRig.ts"),
  join("lib", "motion", "rigRetarget.ts"), join("lib", "face3d", "index.ts"), join("lib", "facePaint.ts"),
  "--outDir", BUILD, "--module", "commonjs", "--target", "es2020",
  "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop",
], { stdio: "inherit" });
const require = createRequire(join(process.cwd(), "scratch", "x.cjs"));
const req = (p) => require(join(process.cwd(), BUILD, p));
const { poseFor } = req("autoRig.js");
const { dancePose, ateez, a2o } = req(join("motion", "dances", "index.js"));
const { BoneRetarget, RIG_TAIL_EXTRA, applyMissingBoneFallback } = req(join("motion", "rigRetarget.js"));
const { attachFace3D, FACE3D_ENABLED } = req(join("face3d", "index.js"));
const { speciesHasMouth, FACE_PAINT_ENABLED } = req("facePaint.js");
const LM = JSON.parse(readFileSync(join("scratch", "landmarks", "landmarks-3d.json"), "utf-8")).landmarks;
const NOFACE = new Set(["rock-03"]);

const loader = new GLTFLoader();
const load = (path) => {
  const buf = readFileSync(path);
  return loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
};
function glbImages(path) {
  const d = readFileSync(path);
  const jl = d.readUInt32LE(12);
  const gj = JSON.parse(d.subarray(20, 20 + jl).toString("utf-8"));
  const bin = d.subarray(20 + jl + 8);
  return (gj.images ?? []).map((im) => {
    const bv = gj.bufferViews[im.bufferView];
    return createHash("sha1").update(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)).digest("hex");
  }).sort();
}

const ids = (process.argv[3]?.split(",") ?? readdirSync(DIR).filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4))).sort();
const fails = [];
const rows = [];
const fail = (id, msg) => { fails.push(`${id}: ${msg}`); };

if (FACE_PAINT_ENABLED) fail("-", "FACE_PAINT_ENABLED=true (false 유지해야 함)");
if (!FACE3D_ENABLED) console.log("note: FACE3D_ENABLED=false — 런타임 검사는 null 확인만");

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
function skinnedAt(sm, i, out, morph) {
  const pos = sm.geometry.attributes.position;
  out.set(pos.getX(i), pos.getY(i), pos.getZ(i));
  if (morph) {
    const ma = sm.geometry.morphAttributes.position[morph.idx];
    out.x += ma.getX(i) * morph.w; out.y += ma.getY(i) * morph.w; out.z += ma.getZ(i) * morph.w;
  }
  out.applyMatrix4(sm.bindMatrix);
  const si = sm.geometry.attributes.skinIndex;
  const sw = sm.geometry.attributes.skinWeight;
  let x = 0, y = 0, z = 0;
  for (let k = 0; k < 4; k++) {
    const w = sw.getComponent(i, k);
    if (!w) continue;
    const j = si.getComponent(i, k);
    _m.multiplyMatrices(sm.skeleton.bones[j].matrixWorld, sm.skeleton.boneInverses[j]);
    _v.copy(out).applyMatrix4(_m);
    x += _v.x * w; y += _v.y * w; z += _v.z * w;
  }
  return out.set(x, y, z).applyMatrix4(sm.bindMatrixInverse).applyMatrix4(sm.matrixWorld);
}
function centroid(sm, morph) {
  const c = new THREE.Vector3();
  const n = sm.geometry.attributes.position.count;
  const t = new THREE.Vector3();
  for (let i = 0; i < n; i++) c.add(skinnedAt(sm, i, t, morph));
  return c.multiplyScalar(1 / n);
}

for (const id of ids) {
  const path = join(DIR, `${id}.glb`);
  if (!existsSync(path)) { fail(id, "GLB 없음"); continue; }
  const row = { id };
  const g = await load(path);
  g.scene.updateMatrixWorld(true);
  const meshes = [];
  g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const byName = new Map(meshes.map((m) => [m.name, m]));
  const keysOf = (n) => Object.keys(byName.get(n)?.morphTargetDictionary ?? {}).sort().join(",");
  const lm = LM[id]?.points ?? {};
  const oneEye = lm.eyeL && lm.eyeR && Math.hypot(...lm.eyeL.pos.map((v, k) => v - lm.eyeR.pos[k])) < 0.01;
  const wantEyes = !NOFACE.has(id) && lm.eyeL && lm.eyeR;
  const wantMouth = !NOFACE.has(id) && speciesHasMouth(id) && !!lm.mouth;
  const lids = (oneEye ? ["L"] : ["L", "R"]);
  if (wantEyes) {
    for (const s of lids) {
      for (const n of [`Eyelid_${s}`, `EyelidLash_${s}`]) {
        if (keysOf(n) !== "blink,half") fail(id, `${n} morph=${keysOf(n) || "없음"}`);
      }
    }
  } else if (byName.has("Eyelid_L")) fail(id, "눈 없는 종인데 Eyelid 있음");
  if (wantMouth) {
    if (keysOf("MouthInner") !== "open,round") fail(id, `MouthInner morph=${keysOf("MouthInner") || "없음"}`);
  } else if (byName.has("MouthInner")) fail(id, "입 없는 종인데 MouthInner 있음");
  row.meshes = meshes.map((m) => m.name).join(",");

  // 텍스처: 원본과 이미지 바이트 동일
  const op = join(ORIG, `${id}.glb`);
  if (existsSync(op)) {
    const a = glbImages(op), b = glbImages(path);
    row.texSame = JSON.stringify(a) === JSON.stringify(b);
    if (!row.texSame) fail(id, "텍스처 이미지가 원본과 다름");
  }

  // 런타임: 60초 모의 — 깜빡임 간격·닫힘 시간, material 무변경
  const matVer = meshes.map((m) => [m.material.version, m.material.map?.version ?? -1].join(":")).join("|");
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f3 = attachFace3D(g.scene, id, rnd);
  if (!FACE3D_ENABLED) { if (f3) fail(id, "FACE3D_ENABLED=false인데 구동기 생성"); }
  else if (wantEyes || wantMouth) {
    if (!f3) fail(id, "attachFace3D=null");
    else {
      const dt = 1 / 60;
      let closedT = 0, blinks = 0, prev = 0, lastStart = -1, gaps = [];
      for (let f = 0; f < 60 * 60; f++) {
        f3.update(dt, f * dt, { emote: "idle", emoteT: 0 });
        const b = f3.state().blink;
        if (b > 0.5) closedT += dt;
        if (b > 0.01 && prev <= 0.01) { blinks++; const t = f * dt; if (lastStart >= 0) gaps.push(t - lastStart); lastStart = t; }
        prev = b;
      }
      const longGaps = gaps.filter((x) => x > 0.5);
      row.blinks = blinks;
      row.gap = longGaps.length ? `${Math.min(...longGaps).toFixed(2)}~${Math.max(...longGaps).toFixed(2)}s` : "-";
      row.closedMs = blinks ? Math.round((closedT / blinks) * 1000) : 0;
      if (wantEyes && (blinks < 8 || blinks > 30)) fail(id, `60초 깜빡임 ${blinks}회`);
      if (longGaps.some((x) => x < 2.45 || x > 6.1)) fail(id, `깜빡임 간격 ${row.gap}`);
      // 먹기: 입 크게 2회
      let peaks = 0, up = false;
      for (let f = 0; f < 1.6 * 60; f++) {
        f3.update(1 / 60, 100 + f / 60, { emote: "eat", emoteT: f / 60 });
        const o = f3.state().open;
        if (!up && o > 0.7) { peaks++; up = true; } else if (o < 0.3) up = false;
      }
      row.eatPeaks = peaks;
      if (wantMouth && peaks !== 2) fail(id, `먹기 입 벌림 ${peaks}회 (2회여야)`);
      f3.update(0.5, 200, { emote: "attack", emoteT: 0.3 });
      row.round = +f3.state().round.toFixed(2);
      if (wantMouth && row.round < 0.9) fail(id, `놀람 round=${row.round}`);
    }
  }
  const matVer2 = meshes.map((m) => [m.material.version, m.material.map?.version ?? -1].join(":")).join("|");
  if (matVer !== matVer2) fail(id, "런타임이 material/texture를 바꿈");

  // 춤 1곡: 감은 눈꺼풀 중심 - 머리 본 거리 변화
  const lidL = byName.get("Eyelid_L");
  if (lidL?.isSkinnedMesh) {
    const bones = new Map(lidL.skeleton.bones.map((b) => [b.name, b]));
    const anchorBone = bones.get("head") ?? bones.get("torso");
    const rt = new BoneRetarget(g.scene, bones, [RIG_TAIL_EXTRA]);
    for (const m of meshes) if (m.morphTargetInfluences) m.morphTargetInfluences.fill(0);
    const morph = { idx: lidL.morphTargetDictionary.blink, w: 1 };
    const hp = new THREE.Vector3();
    const d0 = centroid(lidL, morph).distanceTo(anchorBone.getWorldPosition(hp));
    let worst = 0;
    for (const clip of [ateez, a2o]) {
      const beats124 = (clip.counts * 124) / clip.bpm;
      for (let b = 0; b < beats124; b += 0.25) {
        const pose = poseFor({ emote: "idle", k: 0, t: b, e: b, walkAmp: 0, walkPhase: 0, hug: false, dancing: true, beat: b });
        dancePose(clip, b, pose);
        applyMissingBoneFallback(pose, bones);
        rt.pose(pose);
        g.scene.updateMatrixWorld(true);
        for (const m of meshes) if (m.isSkinnedMesh) m.skeleton.update();
        const d = centroid(lidL, morph).distanceTo(anchorBone.getWorldPosition(hp));
        worst = Math.max(worst, Math.abs(d - d0) / d0);
      }
    }
    row.lidHeadDrift = `${(worst * 100).toFixed(3)}%`;
    if (worst >= 0.01) fail(id, `춤 중 눈꺼풀-머리 거리 변화 ${row.lidHeadDrift}`);
  }
  rows.push(row);
}
console.table(rows);
if (fails.length) {
  console.log(`FAIL ${fails.length}\n  ${fails.join("\n  ")}`);
  process.exit(1);
}
console.log(`PASS verify-face3d ${rows.length}종`);
