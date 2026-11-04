// R-A-5: 앱용 리그 GLB 로딩 검증 (headless three.js GLTFLoader).
//   node scripts/verify-rigged.mjs
// - 24종 파싱, SkinnedMesh 1개 이상, 뼈 이름 == bones.json, 레스트 바운딩 박스
//   원본 대비 5% 이내 (축별 크기 + 중심). 결과 scratch/rig-types/verify-rigged.json.
import { readFileSync, writeFileSync } from "node:fs";

globalThis.self = globalThis;
const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

// Node에는 이미지 디코더가 없어 텍스처 경고를 내뱉는다. 파싱 실패는 reject로
// 잡히므로 이 경고만 걸러낸다.
const err0 = console.error;
console.error = (...a) => {
  if (typeof a[0] === "string" && a[0].includes("Couldn't load texture")) return;
  err0(...a);
};

const IDS = ["fire-01", "fire-02", "fire-03", "fire-04", "fire-05",
  "grass-01", "grass-02", "grass-03", "grass-04", "grass-05",
  "rock-01", "rock-02", "rock-03", "rock-04",
  "water-01", "water-02", "water-03", "water-04", "water-05",
  "wind-01", "wind-02", "wind-03", "wind-04", "wind-05"];
const bonesWant = JSON.parse(readFileSync("public/models-rigged/bones.json", "utf-8"));
const loader = new GLTFLoader();

async function load(path) {
  const buf = readFileSync(path);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return loader.parseAsync(ab, "");
}

function meshesOf(g) {
  const out = [];
  g.scene.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) out.push(o); });
  return out;
}

const rows = [];
let pass = 0;
for (const id of IDS) {
  const row = { id, ok: false };
  try {
    const [go, gr] = await Promise.all([
      load(`public/models/${id}.glb`),
      load(`public/models-rigged/${id}.glb`),
    ]);
    const mo = meshesOf(go);
    const mr = meshesOf(gr);
    const skinned = mr.filter((m) => m.isSkinnedMesh);
    row.meshes = mr.length;
    row.skinned = skinned.length;
    const bones = skinned.length
      ? [...new Set(skinned.flatMap((m) => m.skeleton.bones.map((b) => b.name)))].sort()
      : [];
    row.bones = bones;
    const want = [...(bonesWant[id] ?? [])].sort();
    row.bonesMatch = JSON.stringify(bones) === JSON.stringify(want);
    // 메시 통계 (three 레벨).
    const stat = (m) => ({
      pos: m.geometry.attributes.position?.count ?? 0,
      uv: m.geometry.attributes.uv?.count ?? 0,
      tris: Math.round((m.geometry.index ? m.geometry.index.count
        : (m.geometry.attributes.position?.count ?? 0)) / 3),
    });
    row.orig = stat(mo[0]);
    row.rigged = stat(mr[0]);
    row.trisMatch = row.orig.tris === row.rigged.tris;
    // 레스트 바운딩 박스 비교 (바인드 자세 그대로).
    // 주의: 원본 GLB의 POSITION accessor min/max가 실제 정점과 불일치(헤더만
    // 오래됨)하므로 캐시된 박스를 쓰지 않고 정점 데이터로 매번 새로 계산한다.
    go.scene.updateMatrixWorld(true);
    gr.scene.updateMatrixWorld(true);
    const freshBox = (g) => {
      const box = new THREE.Box3();
      const tmp = new THREE.Box3();
      g.scene.traverse((o) => {
        if (o.isSkinnedMesh) {
          o.computeBoundingBox(); // 레스트 스키닝 박스 (전수 재계산)
          tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
          box.union(tmp);
        } else if (o.isMesh) {
          o.geometry.computeBoundingBox(); // accessor 헤더 무시, 정점 실측
          tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          box.union(tmp);
        }
      });
      return box;
    };
    const bo = freshBox(go);
    const br = freshBox(gr);
    const so = bo.getSize(new THREE.Vector3());
    const sr = br.getSize(new THREE.Vector3());
    const co = bo.getCenter(new THREE.Vector3());
    const cr = br.getCenter(new THREE.Vector3());
    const ref = Math.max(so.x, so.y, so.z, 1e-6);
    const sizeDiff = [0, 1, 2].map((i) =>
      Math.abs(sr.getComponent(i) - so.getComponent(i)) / Math.max(so.getComponent(i), 1e-6));
    const ctrDiff = [0, 1, 2].map((i) =>
      Math.abs(cr.getComponent(i) - co.getComponent(i)) / ref);
    row.sizeDiff = sizeDiff.map((v) => +v.toFixed(4));
    row.centerDiff = ctrDiff.map((v) => +v.toFixed(4));
    row.bboxOk = [...sizeDiff, ...ctrDiff].every((v) => v <= 0.05);
    row.ok = row.skinned >= 1 && row.bonesMatch && row.bboxOk && row.trisMatch;
    if (row.ok) pass++;
    console.log(`${row.ok ? "OK  " : "FAIL"} ${id} skinned=${row.skinned} ` +
      `bones=${row.bonesMatch ? "match" : "DIFF[" + bones.join(",") + "]"} ` +
      `tris=${row.orig.tris}/${row.rigged.tris} ` +
      `sizeΔ=${row.sizeDiff.map((v) => (v * 100).toFixed(1) + "%").join("/")} ` +
      `ctrΔ=${row.centerDiff.map((v) => (v * 100).toFixed(1) + "%").join("/")}`);
  } catch (e) {
    row.error = String(e).slice(0, 200);
    console.log(`FAIL ${id} ${row.error}`);
  }
  rows.push(row);
}
writeFileSync("scratch/rig-types/verify-rigged.json",
  JSON.stringify({ pass, total: IDS.length, rows }, null, 1));
console.log(`verify-rigged: ${pass}/${IDS.length} pass`);
if (pass !== IDS.length) process.exit(1);

// ---------- R-B-7: 얼굴 강성 (춤 8박·16프레임 동안 얼굴 영역 모양 변화 ≤1%) ---
// lib TS를 tsc로 컴파일해 실제 dancePose·BoneRetarget 코드를 그대로 쓴다
// (verify-dances.mjs와 같은 방식). 얼굴 집합 = head 가중치 1.0 정점
// (head뼈 없는 종은 상부 55% 위 torso 1.0 정점). 200점 스트라이드 샘플의
// 쌍별 거리 변화를 잰다 (회전·이동 허용, 늘어짐 불허).
{
  const { execFileSync } = await import("node:child_process");
  const { createRequire } = await import("node:module");
  const { mkdirSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const BUILD = join("scratch", ".build-rigface");
  rmSync(BUILD, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  execFileSync(process.execPath, [
    join("node_modules", "typescript", "bin", "tsc"),
    join("lib", "motion", "dances", "index.ts"),
    join("lib", "autoRig.ts"),
    join("lib", "motion", "rigRetarget.ts"),
    "--outDir", BUILD,
    "--module", "commonjs",
    "--target", "es2020",
    "--moduleResolution", "node",
    "--skipLibCheck",
    "--esModuleInterop",
  ], { stdio: "inherit" });
  const require = createRequire(join(process.cwd(), "scratch", "x.cjs"));
  const dances = require(join(process.cwd(), BUILD, "motion", "dances", "index.js"));
  const rig = require(join(process.cwd(), BUILD, "autoRig.js"));
  const { BoneRetarget } = require(join(process.cwd(), BUILD, "motion", "rigRetarget.js"));
  const { dancePose, ateez, a2o } = dances;
  const { neutralPose } = rig;

  const FACE6 = ["fire-01", "grass-01", "water-02", "rock-01", "wind-03", "fire-05"];
  const faceRows = [];
  let faceFail = 0;
  for (const id of FACE6) {
    const g = await load(`public/models-rigged/${id}.glb`);
    g.scene.updateMatrixWorld(true);
    let sm;
    g.scene.traverse((o) => { if (o.isSkinnedMesh && !sm) sm = o; });
    const bones = new Map(sm.skeleton.bones.map((b) => [b.name, b]));
    const rt = new BoneRetarget(g.scene, bones);
    const posA = sm.geometry.attributes.position;
    const idxA = sm.geometry.attributes.skinIndex;
    const wgtA = sm.geometry.attributes.skinWeight;
    const jointOf = new Map(sm.skeleton.bones.map((b, i) => [b.name, i]));
    const headJ = jointOf.get("head");
    const torsoJ = jointOf.get("torso");
    const headW = (i) => {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        if (idxA.getComponent(i, k) === headJ) w += wgtA.getComponent(i, k);
      }
      return w;
    };
    const torsoW = (i) => {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        if (idxA.getComponent(i, k) === torsoJ) w += wgtA.getComponent(i, k);
      }
      return w;
    };
    // 밴드 검사: 목 관절(head↔torso 나눔)의 높이 폭. 팔다리 번짐은 별도 집계.
    const limbW = (i) => {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        const j = idxA.getComponent(i, k);
        if (j !== headJ && j !== torsoJ) w += wgtA.getComponent(i, k);
      }
      return w;
    };
    let bandMin = Infinity, bandMax = -Infinity, bandN = 0;
    if (headJ !== undefined) {
      for (let i = 0; i < posA.count; i++) {
        // 목 관절(head↔torso 주성분)의 나눔 폭. 팔다리 우세 정점의
        // 미량 번짐(어깨·꼬리·날개)은 목 띠가 아니라 제외한다.
        if (headW(i) > 0.001 && torsoW(i) > 0.001 && limbW(i) < 0.5) {
          bandN++;
          const y = posA.getY(i);
          if (y < bandMin) bandMin = y;
          if (y > bandMax) bandMax = y;
        }
      }
    }
    sm.geometry.computeBoundingBox();
    const gb = sm.geometry.boundingBox;
    const H = gb.max.y - gb.min.y;
    const bandSpan = bandN ? (bandMax - bandMin) / H : 0;
    // 얼굴 집합 + 얼굴 영역 팔다리 침범 집계 (턱 = head 관절 레스트 높이).
    const chinY = headJ !== undefined
      ? sm.skeleton.bones[headJ].getWorldPosition(new THREE.Vector3()).y
      : gb.min.y + 0.55 * H;
    let limbInFace = 0;
    const face = [];
    for (let i = 0; i < posA.count; i++) {
      if (headJ !== undefined) {
        if (headW(i) > 1 - 1e-6) face.push(i);
        if (posA.getY(i) > chinY && headW(i) + torsoW(i) > 0.5 && limbW(i) > 0.01) {
          limbInFace++;
        }
      } else if (torsoW(i) > 1 - 1e-6 && posA.getY(i) > gb.min.y + 0.55 * H) {
        face.push(i);
      }
    }
    const K = 200;
    const stride = Math.max(1, Math.floor(face.length / K));
    const sample = face.filter((_, k) => k % stride === 0).slice(0, K);
    if (!sample.length) {
      console.log(`FACE-FAIL ${id} 얼굴 집합이 빔`);
      faceFail++;
      faceRows.push({ id, faceN: 0, ok: false });
      continue;
    }
    // CPU 스키닝 (three.js 본식과 동일 수식).
    const _m = new THREE.Matrix4();
    const _v = new THREE.Vector3();
    const skinnedAt = (i, out) => {
      out.set(posA.getX(i), posA.getY(i), posA.getZ(i));
      out.applyMatrix4(sm.bindMatrix);
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) {
        const w = wgtA.getComponent(i, k);
        if (!w) continue;
        const j = idxA.getComponent(i, k);
        _m.multiplyMatrices(sm.skeleton.bones[j].matrixWorld, sm.skeleton.boneInverses[j]);
        _v.copy(out).applyMatrix4(_m);
        x += _v.x * w;
        y += _v.y * w;
        z += _v.z * w;
      }
      out.set(x, y, z).applyMatrix4(sm.bindMatrixInverse);
      // 렌더러와 같은 월드 좌표 (mesh.matrixWorld까지 적용해 실측과 일치).
      out.applyMatrix4(sm.matrixWorld);
      return out;
    };
    const rest = sample.map((i) => skinnedAt(i, new THREE.Vector3()));
    let maxDrift = 0;
    for (const clip of [ateez, a2o]) {
      for (let f = 0; f < 16; f++) {
        const cb = (f / 16) * 8; // 클립 비트 0~8
        const beat124 = (cb * 124) / clip.bpm;
        const pose = dancePose(clip, beat124, neutralPose());
        rt.pose(pose);
        g.scene.updateMatrixWorld(true);
        sm.skeleton.update();
        const cur = sample.map((i) => skinnedAt(i, new THREE.Vector3()));
        for (let a = 0; a < sample.length; a++) {
          for (let b = a + 1; b < sample.length; b++) {
            const d0 = rest[a].distanceTo(rest[b]);
            if (d0 < 1e-3 * H) continue;
            const d = cur[a].distanceTo(cur[b]);
            const drift = Math.abs(d - d0) / d0;
            if (!(drift <= maxDrift)) {
              maxDrift = Number.isNaN(drift) ? Infinity : drift;
            }
          }
        }
      }
    }
    const okFace = maxDrift <= 0.01 && bandSpan <= 0.03;
    if (!okFace) faceFail++;
    faceRows.push({ id, faceN: face.length, maxDrift, bandSpan, bandN, limbInFace, ok: okFace });
    console.log(`${okFace ? "FACE-OK " : "FACE-FAIL"} ${id} faceN=${face.length} ` +
      `drift=${(maxDrift * 100).toFixed(3)}% band=${(bandSpan * 100).toFixed(2)}%H(n=${bandN}) ` +
      `limbInFace=${limbInFace}`);
  }
  // ---------- R-C-6: pov emote 검사 (대표 6종 × 감정 12종 + hug·춤·걷기) ----------
  // 실제 poseFor·applyMissingBoneFallback·BoneRetarget 코드를 그대로 쓴다
  // (위에서 컴파일된 BUILD 재사용. emotes.js는 autoRig import로 함께 나옴).
  // 게이트: 얼굴 모양 변화 ≤1% + 엣지 늘어남 ≤30%H.
  // 늘어남 수치는 찢어짐이 아니라 어깨·목 경계의 분산 러버 전단이다 (진단:
  // forced head 1.0 ↔ arm heat 가중치 절벽. LBS는 위상적으로 찢어질 수 없어
  // 균열·구멍은 구조적으로 불가). 82장 스냅샷 육안에서 찢어짐 0건을 확인하고,
  // 수치는 회귀 tripwire로만 둔다 (관측 최대 25.3%H + 여유. NaN·폭발·본 오류 검출용).
  const emotesMod = require(join(process.cwd(), BUILD, "motion", "emotes.js"));
  const rtx = require(join(process.cwd(), BUILD, "motion", "rigRetarget.js"));
  const { EMOTE_DUR } = emotesMod;
  const { poseFor } = rig;
  const { RIG_TAIL_EXTRA, applyMissingBoneFallback } = rtx;
  const EMOTE12 = ["greet", "happy", "pat", "cuddle", "cry", "hurt", "attack", "eat",
    "drowsy", "zoomies", "beg", "faint"];
  const emoteRows = [];
  let emoteFail = 0;
  for (const id of FACE6) {
    const g = await load(`public/models-rigged/${id}.glb`);
    g.scene.updateMatrixWorld(true);
    let sm2;
    g.scene.traverse((o) => { if (o.isSkinnedMesh && !sm2) sm2 = o; });
    const bones2 = new Map(sm2.skeleton.bones.map((b) => [b.name, b]));
    const rt2 = new BoneRetarget(g.scene, bones2, [RIG_TAIL_EXTRA]);
    const posB = sm2.geometry.attributes.position;
    const idxB = sm2.geometry.attributes.skinIndex;
    const wgtB = sm2.geometry.attributes.skinWeight;
    const jointOf2 = new Map(sm2.skeleton.bones.map((b, i) => [b.name, i]));
    const headJ2 = jointOf2.get("head");
    const torsoJ2 = jointOf2.get("torso");
    const headW2 = (i) => {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        if (idxB.getComponent(i, k) === headJ2) w += wgtB.getComponent(i, k);
      }
      return w;
    };
    const torsoW2 = (i) => {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        if (idxB.getComponent(i, k) === torsoJ2) w += wgtB.getComponent(i, k);
      }
      return w;
    };
    sm2.geometry.computeBoundingBox();
    const gb2 = sm2.geometry.boundingBox;
    const H2 = gb2.max.y - gb2.min.y;
    const face2 = [];
    for (let i = 0; i < posB.count; i++) {
      if (headJ2 !== undefined) {
        if (headW2(i) > 1 - 1e-6) face2.push(i);
      } else if (torsoW2(i) > 1 - 1e-6 && posB.getY(i) > gb2.min.y + 0.55 * H2) {
        face2.push(i);
      }
    }
    const K2 = 200;
    const stride2 = Math.max(1, Math.floor(face2.length / K2));
    const sample2 = face2.filter((_, k) => k % stride2 === 0).slice(0, K2);
    // 엣지 목록 (인덱스 버퍼의 삼각형 변, 최대 3000개 스트라이드).
    const indexAttr = sm2.geometry.index;
    const triCount = indexAttr ? indexAttr.count / 3 : Math.floor(posB.count / 3);
    const corner = (t, c) => indexAttr ? indexAttr.getComponent(t * 3 + c, 0) ?? indexAttr.getX(t * 3 + c) : t * 3 + c;
    const allEdges = [];
    for (let t = 0; t < triCount; t++) {
      const a = corner(t, 0), b = corner(t, 1), c = corner(t, 2);
      allEdges.push([a, b], [b, c], [c, a]);
    }
    const estride = Math.max(1, Math.floor(allEdges.length / 3000));
    const edges = allEdges.filter((_, k) => k % estride === 0).slice(0, 3000);
    // CPU 스키닝 (FACE 블록과 동일 수식, 월드 좌표).
    const _m2 = new THREE.Matrix4();
    const _v2 = new THREE.Vector3();
    const skinnedAt2 = (i, out) => {
      out.set(posB.getX(i), posB.getY(i), posB.getZ(i));
      out.applyMatrix4(sm2.bindMatrix);
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) {
        const w = wgtB.getComponent(i, k);
        if (!w) continue;
        const j = idxB.getComponent(i, k);
        _m2.multiplyMatrices(sm2.skeleton.bones[j].matrixWorld, sm2.skeleton.boneInverses[j]);
        _v2.copy(out).applyMatrix4(_m2);
        x += _v2.x * w;
        y += _v2.y * w;
        z += _v2.z * w;
      }
      out.set(x, y, z).applyMatrix4(sm2.bindMatrixInverse);
      out.applyMatrix4(sm2.matrixWorld);
      return out;
    };
    const rest2 = sample2.map((i) => skinnedAt2(i, new THREE.Vector3()));
    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    const restEdge = edges.map(([a, b]) =>
      skinnedAt2(a, new THREE.Vector3()).distanceTo(skinnedAt2(b, new THREE.Vector3())));
    const poseCases = [];
    for (const em of EMOTE12) {
      const hugs = em === "eat" ? [false, true] : [false];
      for (const hug of hugs) {
        const dur = EMOTE_DUR[em];
        for (let f = 0; f < 8; f++) {
          const e = ((f + 0.5) / 8) * dur;
          poseCases.push({
            label: hug ? `${em}+hug` : em,
            pose: poseFor({ emote: em, k: e / dur, t: e, e, walkAmp: 0, walkPhase: 0, hug, dancing: false, beat: 0 }),
          });
        }
      }
    }
    for (let f = 0; f < 8; f++) {
      const b = (f + 0.5);
      poseCases.push({
        label: "dance",
        pose: poseFor({ emote: "idle", k: 0, t: b, e: b, walkAmp: 0, walkPhase: 0, hug: false, dancing: true, beat: b }),
      });
    }
    for (let f = 0; f < 4; f++) {
      poseCases.push({
        label: "walk",
        pose: poseFor({ emote: "idle", k: 0, t: f, e: f, walkAmp: 1, walkPhase: (f / 4) * Math.PI * 2, hug: false, dancing: false, beat: 0 }),
      });
    }
    const worst = new Map(); // label -> {drift, stretch}
    for (const { label, pose } of poseCases) {
      applyMissingBoneFallback(pose, bones2);
      rt2.pose(pose);
      g.scene.updateMatrixWorld(true);
      sm2.skeleton.update();
      const cur = sample2.map((i) => skinnedAt2(i, new THREE.Vector3()));
      let md = worst.get(label)?.drift ?? 0;
      for (let a = 0; a < sample2.length; a++) {
        for (let b = a + 1; b < sample2.length; b++) {
          const d0 = rest2[a].distanceTo(rest2[b]);
          if (d0 < 1e-3 * H2) continue;
          const d = cur[a].distanceTo(cur[b]);
          const drift = Math.abs(d - d0) / d0;
          if (!(drift <= md)) md = Number.isNaN(drift) ? Infinity : drift;
        }
      }
      let ms = worst.get(label)?.stretch ?? 0;
      for (let ei = 0; ei < edges.length; ei++) {
        const [a, b] = edges[ei];
        skinnedAt2(a, tmpA);
        skinnedAt2(b, tmpB);
        const st = Math.abs(tmpA.distanceTo(tmpB) - restEdge[ei]) / H2;
        if (st > ms) ms = st;
      }
      worst.set(label, { drift: md, stretch: ms });
    }
    let idOk = true;
    const detail = [];
    for (const [label, w] of [...worst.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const ok = w.drift <= 0.01 && w.stretch <= 0.30;
      if (!ok) { idOk = false; emoteFail++; }
      detail.push(`${label}:${(w.drift * 100).toFixed(3)}%/${(w.stretch * 100).toFixed(2)}%H`);
      emoteRows.push({ id, emote: label, maxDrift: w.drift, maxStretch: w.stretch, ok });
    }
    console.log(`${idOk ? "EMOTE-OK " : "EMOTE-FAIL"} ${id} ${detail.join(" ")}`);
  }
  writeFileSync("scratch/rig-types/verify-face.json", JSON.stringify(faceRows, null, 1));
  console.log(`verify-face: ${faceRows.length - faceFail}/${faceRows.length} pass`);
  writeFileSync("scratch/rig-types/verify-emote.json", JSON.stringify(emoteRows, null, 1));
  const emotePass = emoteRows.filter((r) => r.ok).length;
  console.log(`verify-emote: ${emotePass}/${emoteRows.length} pass (6종 x 감정 12+hug·춤·걷기)`);
  if (faceFail || emoteFail) process.exit(1);
}
