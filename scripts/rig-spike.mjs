// A7b 재시험 (B안, 모카퐁=fire-01 1마리). 실행: node scripts/rig-spike.mjs
// - public/models/*.glb 원본은 읽기만 (sha256 전후 대조).
// - 결과물은 scratch/rig-spike/에만: fire-01-rigged.glb + report.json + 포즈 스냅샷 4종.
// - 가중치는 buildAutoRig 캡슐식을 좁힌 것(팔 x-엣지 급경사 + 사지 우세부 몸통 점유 억제).
//   손·허리·팔이 각각 자기 관절에 주로 붙는다 (분포 게이트로 확인).
// - 성공 판정: 유효한 스킨 파일 + 바인드 항등 + flyaway 없음 + 4포즈 스냅샷 유효.
//   파일-스킨 메커니즘은 1차 시험에서 A/B 6e-8로 입증되어 여기서는 대조하지 않는다.
import * as THREE from "three";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.self = globalThis; // three GLTFLoader shim (verify-models.mjs와 동일)

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "models", "fire-01.glb");
const OUTDIR = join(ROOT, "scratch", "rig-spike");
const OUT = join(OUTDIR, "fire-01-rigged.glb");
const REPORT = join(OUTDIR, "report.json");

// bone ids (autoRig와 동일 순서).
const B_TORSO = 0, B_HEAD = 1, B_LEGL = 2, B_LEGR = 3, B_ARML = 4, B_ARMR = 5, B_TAIL = 6;
const BONE_NAMES = ["torso", "head", "legL", "legR", "armL", "armR", "tail"];

const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------- 1. 원본 로드 (읽기 전용) ----------
const shaBefore = sha256(SRC);
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const srcBuf = readFileSync(SRC);
const srcAb = srcBuf.buffer.slice(srcBuf.byteOffset, srcBuf.byteOffset + srcBuf.byteLength);
const srcGltf = await new GLTFLoader().parseAsync(srcAb, "");
const srcMeshes = [];
srcGltf.scene.updateMatrixWorld(true);
srcGltf.scene.traverse((o) => { if (o.isMesh) srcMeshes.push(o); });
if (srcMeshes.length !== 1) throw new Error(`spike scope: expected 1 mesh, got ${srcMeshes.length}`);
const srcMesh = srcMeshes[0];
if (srcMesh.geometry.index === null) throw new Error("spike scope: expected indexed geometry");

// 월드 베이크 (rigObject와 동일): 복제 지오메트리에 matrixWorld를 굽고 이후 항등 프레임 사용.
const bakedGeo = srcMesh.geometry.clone();
bakedGeo.applyMatrix4(srcMesh.matrixWorld);
{
  const nm = new THREE.Matrix3().getNormalMatrix(srcMesh.matrixWorld);
  bakedGeo.attributes.normal.applyMatrix3(nm);
  const na = bakedGeo.attributes.normal.array;
  for (let i = 0; i < na.length; i += 3) {
    const il = 1 / (Math.hypot(na[i], na[i + 1], na[i + 2]) || 1);
    na[i] *= il; na[i + 1] *= il; na[i + 2] *= il;
  }
}
const base = new Float32Array(bakedGeo.attributes.position.array);
const baseN = new Float32Array(bakedGeo.attributes.normal.array);
const index = bakedGeo.index.array;
const N = bakedGeo.attributes.position.count;
const meshNodeTransform = {
  matrix: srcMesh.matrix.elements.slice(),
  world: srcMesh.matrixWorld.elements.slice(),
};

// ---------- 2. 박스·피벗·가중치 (buildAutoRig 이식) ----------
let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (let i = 0; i < base.length; i += 3) {
  const x = base[i], y = base[i + 1], z = base[i + 2];
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
  if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
}
const W = maxX - minX, H = maxY - minY, D = maxZ - minZ;
const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, y0 = minY;
const pivots = [
  [cx, y0 + H * 0.52, cz],
  [cx, y0 + H * 0.74, cz],
  [cx - W * 0.16, y0 + H * 0.30, cz],
  [cx + W * 0.16, y0 + H * 0.30, cz],
  [cx - W * 0.30, y0 + H * 0.60, cz],
  [cx + W * 0.30, y0 + H * 0.60, cz],
  [cx, y0 + H * 0.42, cz - D * 0.30],
];
const band = (x, a, b, c, d) => sstep(a, b, x) * (1 - sstep(c, d, x));
const bw = Math.max(W * 0.06, 0.02);
// 가중치 계산 (tuned=false: 기존식, tuned=true: 좁힌식).
// 좁히기: 팔 x-엣지 급경사(0.22→0.24 시작, 0.40→0.34 완성) + 사지 우세부 몸통 점유 억제.
// 사지는 자기 관절에 주로 부착되고 블렌드 구간이 줄어든다. 허리 코어는 그대로 둔다.
const runWeights = (tuned) => {
  const AX0 = (tuned ? 0.24 : 0.22) * W;
  const AX1 = (tuned ? 0.34 : 0.40) * W;
  const J = new Uint16Array(N * 4);
  const Wt = new Float32Array(N * 4);
  const hist = [0, 0, 0, 0, 0];
  let sumBad = 0, nonFin = 0, empty = 0;
  let handN = 0, handArm = 0, waistN = 0, waistTorso = 0, blend = 0;
  for (let i = 0; i < N; i++) {
    const vx = base[i * 3], vy = base[i * 3 + 1], vz = base[i * 3 + 2];
    const sideL = 1 - sstep(cx - bw, cx + bw, vx);
    const legRaw = sstep(y0 + H * 0.40, y0 + H * 0.28, vy);
    const armRaw =
      sstep(AX0, AX1, Math.abs(vx - cx)) *
      band(vy, y0 + H * 0.34, y0 + H * 0.46, y0 + H * 0.66, y0 + H * 0.78);
    const headRaw = sstep(y0 + H * 0.62, y0 + H * 0.74, vy);
    const tailRaw =
      sstep(cz - D * 0.22, cz - D * 0.40, vz) *
      band(vy, y0 + H * 0.18, y0 + H * 0.30, y0 + H * 0.55, y0 + H * 0.66);
    const wArm = armRaw;
    const wTail = tailRaw * (1 - wArm);
    const wLeg = legRaw * (1 - wArm) * (1 - wTail);
    const wHead = headRaw * (1 - wArm) * (1 - wTail) * (1 - wLeg);
    const cand = [
      [B_LEGL, wLeg * sideL],
      [B_LEGR, wLeg * (1 - sideL)],
      [B_ARML, wArm * sideL],
      [B_ARMR, wArm * (1 - sideL)],
      [B_HEAD, wHead],
      [B_TAIL, wTail],
    ];
    const used = wLeg + wArm + wHead + wTail;
    let wTorso = Math.max(0, 1 - used);
    // 사지 중 하나라도 우세하면 몸통 점유를 억제 (허리 코어의 작은 누설은 그대로 둠).
    if (tuned) wTorso = wTorso * (1 - sstep(0.5, 0.9, Math.max(wArm, wLeg, wHead, wTail)));
    cand.push([B_TORSO, wTorso]);
    cand.sort((a, b) => b[1] - a[1]);
    let sum = 0, cNum = 0;
    for (let k = 0; k < 4 && k < cand.length; k++) {
      if (cand[k][1] < 1e-4) break;
      J[i * 4 + k] = cand[k][0];
      Wt[i * 4 + k] = cand[k][1];
      sum += cand[k][1];
      cNum++;
    }
    if (sum > 0) {
      for (let k = 0; k < cNum; k++) Wt[i * 4 + k] /= sum;
    } else {
      J[i * 4] = B_TORSO;
      Wt[i * 4] = 1;
      cNum = 1;
    }
    hist[cNum]++;
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const w = Wt[i * 4 + k];
      if (!Number.isFinite(w)) nonFin++;
      s += w;
    }
    if (Math.abs(s - 1) > 1e-6) sumBad++;
    if (cNum === 0) empty++;
    const inHand = Math.abs(vx - cx) > W * 0.28 && vy > y0 + H * 0.40 && vy < y0 + H * 0.80;
    const inWaist = Math.abs(vx - cx) < W * 0.20 && vy > y0 + H * 0.38 && vy < y0 + H * 0.58 && vz > cz - D * 0.20;
    let wArmV = 0, wTorsoV = 0, mx = 0;
    for (let k = 0; k < cNum; k++) {
      const w = Wt[i * 4 + k], b = J[i * 4 + k];
      if (w > mx) mx = w;
      if (b === B_ARML || b === B_ARMR) wArmV += w;
      if (b === B_TORSO) wTorsoV += w;
    }
    if (mx < 0.9) blend++;
    if (inHand) { handN++; handArm += wArmV; }
    if (inWaist) { waistN++; waistTorso += wTorsoV; }
  }
  return {
    J, W: Wt, hist, sumBad, nonFin, empty,
    zones: {
      handN, handAvg: handN ? handArm / handN : 0,
      waistN, waistAvg: waistN ? waistTorso / waistN : 0,
      blendFrac: blend / N,
    },
  };
};
const OLD = runWeights(false);
const NEW = runWeights(true);
const joints = NEW.J;
const weights = NEW.W;
const influenceHist = NEW.hist;
if (NEW.nonFin > 0) fail(`weights: ${NEW.nonFin} non-finite values`);
if (NEW.sumBad > 0) fail(`weights: ${NEW.sumBad} verts with sum != 1`);
if (NEW.empty > 0) fail(`weights: ${NEW.empty} verts with no influence`);
if (NEW.zones.handN === 0) fail("hand zone empty (zone does not match mesh)");
if (!(NEW.zones.handAvg > OLD.zones.handAvg)) fail("hand attach did not improve");
if (NEW.zones.waistN === 0) fail("waist zone empty (zone does not match mesh)");
if (!(NEW.zones.waistAvg >= OLD.zones.waistAvg)) fail("waist attach regressed");
if (!(NEW.zones.blendFrac < OLD.zones.blendFrac)) fail("blend fraction did not shrink");

// ---------- 3. GLB 컨테이너 수술 → scratch 출력 ----------
// 원본 JSON/BIN을 복제하고 위치·법선(베이크)과 스킨 관련 항목만 추가/수정한다.
const jsonLen = srcBuf.readUInt32LE(12);
const json = JSON.parse(srcBuf.toString("utf8", 20, 20 + jsonLen));
const binOff = 20 + jsonLen;
const binLen = srcBuf.readUInt32LE(binOff);
const binStart = binOff + 8;
if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1) {
  throw new Error("spike scope: expected 1 mesh with 1 primitive");
}
const prim = json.meshes[0].primitives[0];
const meshNodeIdx = json.nodes.findIndex((n) => n.mesh !== undefined);
if (meshNodeIdx < 0) throw new Error("no mesh node found");
const binParts = [Buffer.from(srcBuf.subarray(binStart, binStart + binLen))];

const writeAttrF32 = (accIdx, data) => {
  const acc = json.accessors[accIdx];
  const view = json.bufferViews[acc.bufferView];
  if (acc.componentType !== 5126 || acc.type !== "VEC3" || acc.count !== N) {
    throw new Error(`unexpected layout for accessor ${accIdx}`);
  }
  const stride = view.byteStride ?? 12;
  const baseOff = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < N; i++) {
    binParts[0].writeFloatLE(data[i * 3], baseOff + i * stride);
    binParts[0].writeFloatLE(data[i * 3 + 1], baseOff + i * stride + 4);
    binParts[0].writeFloatLE(data[i * 3 + 2], baseOff + i * stride + 8);
  }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    if (data[i] < mn[c]) mn[c] = data[i];
    if (data[i] > mx[c]) mx[c] = data[i];
  }
  acc.min = mn;
  acc.max = mx;
};
writeAttrF32(prim.attributes.POSITION, base);
writeAttrF32(prim.attributes.NORMAL, baseN);

let binCursor = binLen;
const appendBytes = (u8) => {
  const pad = (4 - (binCursor % 4)) % 4;
  if (pad > 0) {
    binParts.push(Buffer.alloc(pad));
    binCursor += pad;
  }
  const off = binCursor;
  binParts.push(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength));
  binCursor += u8.byteLength;
  return off;
};
const ibm = new Float32Array(16 * 7);
{
  const m = new THREE.Matrix4();
  for (let b = 0; b < 7; b++) {
    m.makeTranslation(-pivots[b][0], -pivots[b][1], -pivots[b][2]);
    ibm.set(m.elements, b * 16);
  }
}
const jointsOff = appendBytes(new Uint8Array(joints.buffer, joints.byteOffset, joints.byteLength));
const weightsOff = appendBytes(new Uint8Array(weights.buffer, weights.byteOffset, weights.byteLength));
const ibmOff = appendBytes(new Uint8Array(ibm.buffer, ibm.byteOffset, ibm.byteLength));

const addView = (byteOffset, byteLength) => {
  json.bufferViews.push({ buffer: 0, byteOffset, byteLength });
  return json.bufferViews.length - 1;
};
const addAcc = (a) => {
  json.accessors.push(a);
  return json.accessors.length - 1;
};
const jAcc = addAcc({ bufferView: addView(jointsOff, joints.byteLength), componentType: 5123, count: N, type: "VEC4" });
const wAcc = addAcc({ bufferView: addView(weightsOff, weights.byteLength), componentType: 5126, count: N, type: "VEC4" });
const ibmAcc = addAcc({ bufferView: addView(ibmOff, ibm.byteLength), componentType: 5126, count: 7, type: "MAT4" });
prim.attributes.JOINTS_0 = jAcc;
prim.attributes.WEIGHTS_0 = wAcc;

const jointIdx = [];
for (let b = 0; b < 7; b++) {
  jointIdx.push(json.nodes.length);
  json.nodes.push({ name: "rig_" + BONE_NAMES[b], translation: pivots[b].slice() });
}
const rigRootIdx = json.nodes.length;
json.nodes.push({ name: "rig", children: jointIdx });
json.skins = [{ inverseBindMatrices: ibmAcc, skeleton: rigRootIdx, joints: jointIdx }];
json.nodes[meshNodeIdx].skin = 0;
delete json.nodes[meshNodeIdx].matrix;
delete json.nodes[meshNodeIdx].translation;
delete json.nodes[meshNodeIdx].rotation;
delete json.nodes[meshNodeIdx].scale;
json.scenes[0].nodes.push(rigRootIdx);
json.buffers[0].byteLength = binCursor;

const jsonStr = JSON.stringify(json);
const jsonChunk = Buffer.concat([Buffer.from(jsonStr, "utf8"), Buffer.alloc((4 - (jsonStr.length % 4)) % 4, 0x20)]);
const binChunk = Buffer.concat(binParts);
const binPad = (4 - (binChunk.length % 4)) % 4;
const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length + binPad;
const out = Buffer.alloc(total);
out.write("glTF", 0, 4, "ascii");
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
let o = 12;
out.writeUInt32LE(jsonChunk.length, o);
out.writeUInt32LE(0x4e4f534a, o + 4);
o += 8;
jsonChunk.copy(out, o);
o += jsonChunk.length;
out.writeUInt32LE(binChunk.length + binPad, o);
out.writeUInt32LE(0x004e4942, o + 4);
o += 8;
binChunk.copy(out, o);
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(OUT, out);

const shaAfter = sha256(SRC);
if (shaAfter !== shaBefore) fail(`source modified during run! before=${shaBefore} after=${shaAfter}`);

// ---------- 4. 재로드 검증 ----------
const outBuf = readFileSync(OUT);
const outAb = outBuf.buffer.slice(outBuf.byteOffset, outBuf.byteOffset + outBuf.byteLength);
const rig1 = await new GLTFLoader().parseAsync(outAb, "");
const skinned = [];
rig1.scene.traverse((o) => { if (o.isSkinnedMesh) skinned.push(o); });
if (skinned.length !== 1) fail(`expected 1 SkinnedMesh, got ${skinned.length}`);
const sk = skinned[0];
const skeleton = sk.skeleton;
if (!skeleton || skeleton.bones.length !== 7) {
  fail(`expected 7 joints, got ${skeleton ? skeleton.bones.length : "no skeleton"}`);
}
rig1.scene.updateMatrixWorld(true);
skeleton.update();
{
  const v = new THREE.Vector3();
  let bad = 0;
  for (let b = 0; b < 7; b++) {
    skeleton.bones[b].getWorldPosition(v);
    const d = Math.hypot(v.x - pivots[b][0], v.y - pivots[b][1], v.z - pivots[b][2]);
    if (!(d < 1e-6)) bad++;
  }
  if (bad > 0) fail(`${bad} joints off-pivot`);
}
const SJ = sk.geometry.attributes.skinIndex.array;
const SW = sk.geometry.attributes.skinWeight.array;
{
  let jb = 0;
  for (let i = 0; i < SJ.length; i++) if (!Object.is(SJ[i], joints[i])) jb++;
  if (jb > 0) fail(`file joints mismatch: ${jb}`);
  // three 로더가 행을 재정규화하므로 허용오차 비교 + 행합 검사.
  let wb = 0, wmax = 0;
  for (let i = 0; i < SW.length; i++) {
    const d = Math.abs(SW[i] - weights[i]);
    if (d > wmax) wmax = d;
    if (d >= 1e-6) wb++;
  }
  if (wb > 0) fail(`file weights drift: ${wb} slots (max ${wmax})`);
  let sb = 0;
  for (let i = 0; i < N; i++) {
    const s = SW[i * 4] + SW[i * 4 + 1] + SW[i * 4 + 2] + SW[i * 4 + 3];
    if (Math.abs(s - 1) > 1e-5) sb++;
  }
  if (sb > 0) fail(`reloaded weight rows off-sum: ${sb}`);
}

// three boneMatrices + 지정 가중치로 CPU 스키닝 (파일 종단간 검증 + 구식 대조).
const skinAll = (J, W) => {
  skeleton.update();
  const bm = skeleton.boneMatrices;
  const posed = new Float32Array(base.length);
  for (let i = 0; i < N; i++) {
    const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const w = W[i * 4 + k];
      if (w === 0) continue;
      const o = J[i * 4 + k] * 16;
      px += w * (bm[o] * x + bm[o + 4] * y + bm[o + 8] * z + bm[o + 12]);
      py += w * (bm[o + 1] * x + bm[o + 5] * y + bm[o + 9] * z + bm[o + 13]);
      pz += w * (bm[o + 2] * x + bm[o + 6] * y + bm[o + 10] * z + bm[o + 14]);
    }
    posed[i * 3] = px;
    posed[i * 3 + 1] = py;
    posed[i * 3 + 2] = pz;
  }
  return posed;
};
const setArms = (rx) => {
  skeleton.bones[B_ARML].rotation.set(rx, 0, 0);
  skeleton.bones[B_ARMR].rotation.set(rx, 0, 0);
  rig1.scene.updateMatrixWorld(true);
};
// 4포즈: 팔 들기 / 팔 옆 펼치기 / 허리 비틀기 / 허리 굽히기.
const POSES = {
  "arm-raise": { [B_ARML]: [-1.8, 0, 0], [B_ARMR]: [-1.8, 0, 0] },
  "arm-spread": { [B_ARML]: [0, 0, -1.2], [B_ARMR]: [0, 0, 1.2] },
  "waist-twist": { [B_TORSO]: [0, 0.6, 0] },
  "waist-bend": { [B_TORSO]: [0.4, 0, 0] },
};
const setPose = (rot) => {
  for (let b = 0; b < 7; b++) skeleton.bones[b].rotation.set(0, 0, 0);
  for (const [b, e] of Object.entries(rot)) skeleton.bones[b].rotation.set(e[0], e[1], e[2]);
  rig1.scene.updateMatrixWorld(true);
};
const triCount = index.length / 3;
const triArea = (p, a, b, c) => {
  const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
  const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
};
const dist3 = (p, a, b) => Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
const metrics = (posed) => {
  let maxDisp = 0, maxArea = 0, maxEdge = 0, nonFinite = 0, skipped = 0;
  const areas = [], edges = [];
  for (let i = 0; i < posed.length; i++) {
    if (!Number.isFinite(posed[i])) nonFinite++;
  }
  for (let i = 0; i < posed.length; i += 3) {
    const d = Math.hypot(posed[i] - base[i], posed[i + 1] - base[i + 1], posed[i + 2] - base[i + 2]);
    if (d > maxDisp) maxDisp = d;
  }
  let worstTri = null, worstEdge = null, worstSquash = null, minArea = Infinity;
  let over3 = 0, over5 = 0, over10 = 0, overEdge3 = 0;
  for (let t = 0; t < triCount; t++) {
    const a = index[t * 3] * 3, b = index[t * 3 + 1] * 3, c = index[t * 3 + 2] * 3;
    const ra = triArea(base, a, b, c);
    if (ra < 1e-12) { skipped++; continue; }
    const pa = triArea(posed, a, b, c);
    const r = pa / ra;
    if (r > maxArea) { maxArea = r; worstTri = { tri: t, restArea: ra, posedArea: pa }; }
    if (r < minArea) { minArea = r; worstSquash = { tri: t, restArea: ra, posedArea: pa }; }
    if (r >= 3) over3++;
    if (r >= 5) over5++;
    if (r >= 10) over10++;
    areas.push(r);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const rl = dist3(base, u, v);
      if (rl < 1e-9) continue;
      const pl = dist3(posed, u, v);
      const er = pl / rl;
      if (er > maxEdge) { maxEdge = er; worstEdge = { u: u / 3, v: v / 3, restLen: rl, posedLen: pl }; }
      if (er >= 3) overEdge3++;
      edges.push(er);
    }
  }
  areas.sort((x, y) => x - y);
  edges.sort((x, y) => x - y);
  const q = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(arr.length * f))];
  const nearestJoint = (x, y, z) => {
    let bi = 0, bd = Infinity;
    for (let b = 0; b < 7; b++) {
      const d = Math.hypot(x - pivots[b][0], y - pivots[b][1], z - pivots[b][2]);
      if (d < bd) { bd = d; bi = b; }
    }
    return BONE_NAMES[bi];
  };
  const triJoint = (tr) => {
    const i0 = index[tr * 3] * 3, i1 = index[tr * 3 + 1] * 3, i2 = index[tr * 3 + 2] * 3;
    return nearestJoint(
      (base[i0] + base[i1] + base[i2]) / 3,
      (base[i0 + 1] + base[i1 + 1] + base[i2 + 1]) / 3,
      (base[i0 + 2] + base[i1 + 2] + base[i2 + 2]) / 3,
    );
  };
  if (worstTri) worstTri.joint = triJoint(worstTri.tri);
  if (worstSquash) worstSquash.joint = triJoint(worstSquash.tri);
  if (worstEdge) {
    worstEdge.joint = nearestJoint(
      (base[worstEdge.u * 3] + base[worstEdge.v * 3]) / 2,
      (base[worstEdge.u * 3 + 1] + base[worstEdge.v * 3 + 1]) / 2,
      (base[worstEdge.u * 3 + 2] + base[worstEdge.v * 3 + 2]) / 2,
    );
  }
  return {
    maxDisp, maxArea, minArea, p99Area: q(areas, 0.99), maxEdge, p99Edge: q(edges, 0.99),
    nonFinite, skippedTris: skipped, worstTri, worstEdge, worstSquash,
    over3, over5, over10, overEdge3,
  };
};

// 휴지 바인드: 항등이어야 한다.
setArms(0);
{
  const posed = skinAll(SJ, SW);
  let m = 0;
  for (let i = 0; i < posed.length; i++) {
    const d = Math.abs(posed[i] - base[i]);
    if (d > m) m = d;
  }
  if (!(m < 1e-5)) fail(`rest identity: max|Δ|=${m} (want < 1e-5)`);
}

// 4포즈: 유한·유계는 게이트, 신장/뭉개짐은 신(파일 좁힌식)+구(기존식) 나란히 기록.
const bars = { maxDisp: 2 * H, stretchRef: 3.0 };
const poseMetrics = {};
const poseOld = {};
const posedByName = {};
for (const [name, rot] of Object.entries(POSES)) {
  setPose(rot);
  const posed = skinAll(SJ, SW);
  const mt = metrics(posed);
  poseMetrics[name] = mt;
  posedByName[name] = posed;
  poseOld[name] = metrics(skinAll(OLD.J, OLD.W));
  if (mt.nonFinite > 0) fail(`${name}: ${mt.nonFinite} non-finite verts`);
  if (!(mt.maxDisp < bars.maxDisp)) fail(`${name}: maxDisp=${mt.maxDisp} (bar < ${bars.maxDisp})`);
}

// 본 행렬 핀: armL boneMatrix == T(p)·Rx(-1.8)·T(-p).
setArms(-1.8);
skeleton.update();
{
  const p = pivots[B_ARML];
  const expected = new THREE.Matrix4().compose(
    new THREE.Vector3(p[0], p[1], p[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.8, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  ).multiply(new THREE.Matrix4().makeTranslation(-p[0], -p[1], -p[2]));
  const slice = skeleton.boneMatrices.slice(B_ARML * 16, B_ARML * 16 + 16);
  let m = 0;
  for (let i = 0; i < 16; i++) {
    const d = Math.abs(slice[i] - expected.elements[i]);
    if (d > m) m = d;
  }
  if (!(m < 1e-6)) fail(`armL boneMatrix pin: max|Δ|=${m} (want < 1e-6)`);
}

// ---------- 5. 포즈 스냅샷 4종 (정적 GLB, 재질·UV 유지, 스킨 제거) ----------
// Snapshot = rigged 컨테이너 복제 + 포즈 정점/법선 베이크 + 스킨 제거.
// 육안 검수용: 일반 뷰어에서 그대로 열린다.
const snapshots = [];
for (const [name, posed] of Object.entries(posedByName)) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(posed.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(index.slice(), 1));
  g.computeVertexNormals();
  const pn = g.attributes.normal.array;
  const j2 = JSON.parse(JSON.stringify(json));
  const buf = Buffer.from(binChunk);
  const p2 = j2.meshes[0].primitives[0];
  const writeCloned = (accIdx, data) => {
    const acc = j2.accessors[accIdx];
    const view = j2.bufferViews[acc.bufferView];
    const stride = view.byteStride ?? 12;
    const off0 = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    for (let i = 0; i < N; i++) {
      buf.writeFloatLE(data[i * 3], off0 + i * stride);
      buf.writeFloatLE(data[i * 3 + 1], off0 + i * stride + 4);
      buf.writeFloatLE(data[i * 3 + 2], off0 + i * stride + 8);
    }
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i++) {
      const c = i % 3;
      if (data[i] < mn[c]) mn[c] = data[i];
      if (data[i] > mx[c]) mx[c] = data[i];
    }
    acc.min = mn;
    acc.max = mx;
  };
  writeCloned(p2.attributes.POSITION, posed);
  writeCloned(p2.attributes.NORMAL, pn);
  delete p2.attributes.JOINTS_0;
  delete p2.attributes.WEIGHTS_0;
  delete j2.nodes[meshNodeIdx].skin;
  delete j2.skins;
  j2.nodes.splice(jointIdx[0]);
  j2.scenes[0].nodes = j2.scenes[0].nodes.filter((n) => n !== rigRootIdx);
  const js = JSON.stringify(j2);
  const jc = Buffer.concat([Buffer.from(js, "utf8"), Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const pad = (4 - (buf.length % 4)) % 4;
  const snap = Buffer.alloc(12 + 8 + jc.length + 8 + buf.length + pad);
  snap.write("glTF", 0, 4, "ascii");
  snap.writeUInt32LE(2, 4);
  snap.writeUInt32LE(snap.length, 8);
  let q = 12;
  snap.writeUInt32LE(jc.length, q);
  snap.writeUInt32LE(0x4e4f534a, q + 4);
  q += 8;
  jc.copy(snap, q);
  q += jc.length;
  snap.writeUInt32LE(buf.length + pad, q);
  snap.writeUInt32LE(0x004e4942, q + 4);
  q += 8;
  buf.copy(snap, q);
  writeFileSync(join(OUTDIR, `fire-01-pose-${name}.glb`), snap);
  snapshots.push(`scratch/rig-spike/fire-01-pose-${name}.glb`);
}
// 스냅샷 검증: 재로드 후 정점 수·위치 일치 + 스킨 없음.
for (const [name, posed] of Object.entries(posedByName)) {
  const sb = readFileSync(join(OUTDIR, `fire-01-pose-${name}.glb`));
  const rl = await new GLTFLoader().parseAsync(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength), "");
  const ms = [];
  rl.scene.traverse((o) => { if (o.isMesh) ms.push(o); });
  if (ms.length !== 1) { fail(`${name} snapshot: expected 1 mesh, got ${ms.length}`); continue; }
  if (ms[0].isSkinnedMesh) fail(`${name} snapshot: must not be skinned`);
  const pa = ms[0].geometry.attributes.position;
  if (pa.count !== N) { fail(`${name} snapshot: verts ${pa.count} !== ${N}`); continue; }
  let m = 0;
  const arr = pa.array;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(arr[i] - posed[i]);
    if (d > m) m = d;
  }
  if (!(m < 1e-5)) fail(`${name} snapshot fidelity: max|Δ|=${m}`);
}

// ---------- 6. 리포트 ----------
const report = {
  success: failures.length === 0,
  task: "A7b rig-spike (B안, fire-01 1마리)",
  species: "fire-01",
  src: "public/models/fire-01.glb",
  srcSha256: { before: shaBefore, after: shaAfter, untouched: shaBefore === shaAfter },
  out: "scratch/rig-spike/fire-01-rigged.glb",
  verts: N,
  tris: triCount,
  joints: 7,
  box: { min: [minX, minY, minZ], size: [W, H, D] },
  pivots: Object.fromEntries(BONE_NAMES.map((n, i) => [n, pivots[i]])),
  influenceHist,
  bars,
  zones: { old: OLD.zones, new: NEW.zones },
  metrics: poseMetrics,
  metricsOld: poseOld,
  snapshots,
  boneMatrixPin: "armL @-1.8 vs T(p)·R·T(-p)",
  failures,
};
mkdirSync(OUTDIR, { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2));
console.log(`verts=${N} tris=${triCount} joints=7 influences=${JSON.stringify(influenceHist)}`);
for (const [k, mt] of Object.entries(poseMetrics)) {
  const mo = poseOld[k];
  console.log(`${k}: maxDisp=${mt.maxDisp.toFixed(4)} maxArea=${mt.maxArea.toFixed(4)}(old ${mo.maxArea.toFixed(4)}) minArea=${mt.minArea.toFixed(4)}(old ${mo.minArea.toFixed(4)}) p99Area=${mt.p99Area.toFixed(4)} maxEdge=${mt.maxEdge.toFixed(4)} nonFinite=${mt.nonFinite}`);
  console.log(`  stretch #${mt.worstTri.tri}@${mt.worstTri.joint} rest=${mt.worstTri.restArea.toExponential(2)} posed=${mt.worstTri.posedArea.toExponential(2)} over3/5/10=${mt.over3}/${mt.over5}/${mt.over10}`);
  console.log(`  squash #${mt.worstSquash.tri}@${mt.worstSquash.joint} rest=${mt.worstSquash.restArea.toExponential(2)} posed=${mt.worstSquash.posedArea.toExponential(2)} edge rest=${mt.worstEdge.restLen.toExponential(2)} posed=${mt.worstEdge.posedLen.toExponential(2)}@${mt.worstEdge.joint} overEdge3=${mt.overEdge3}`);
}
console.log(`zones old: hand=${OLD.zones.handAvg.toFixed(4)}(n=${OLD.zones.handN}) waist=${OLD.zones.waistAvg.toFixed(4)}(n=${OLD.zones.waistN}) blend=${OLD.zones.blendFrac.toFixed(4)}`);
console.log(`zones new: hand=${NEW.zones.handAvg.toFixed(4)}(n=${NEW.zones.handN}) waist=${NEW.zones.waistAvg.toFixed(4)}(n=${NEW.zones.waistN}) blend=${NEW.zones.blendFrac.toFixed(4)}`);
console.log(`snapshots: ${snapshots.join(", ")}`);
console.log(`src untouched: ${shaBefore === shaAfter}`);
if (failures.length > 0) {
  for (const f of failures.slice(0, 12)) console.error(`FAIL: ${f}`);
  if (failures.length > 12) console.error(`... and ${failures.length - 12} more`);
  console.error("RESULT: FAIL — B안 retest FAILED");
  process.exit(1);
}
console.log("RESULT: PASS — B안 retest SUCCESS");

