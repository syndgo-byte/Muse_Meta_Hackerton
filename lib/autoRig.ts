// Procedural auto-rig for single-mesh static GLBs (linear blend skinning on CPU).
// Mixamo 외부 클립을 못 쓰는 환경에서 뼈 움직임을 내는 현실적 수단:
// - 정점들을 부위 캡슐(머리/몸통/다리/팔/꼬리)에 부드럽게 귀속 (경계 블렌딩이라 찢어짐 없음)
// - 걷기/리치/허그 포즈를 본 회전으로 구동 (다리 교대, 팔 흔들기, 고개 끄덕임)
// - GLB 내장 클립이 생기면 PovCreature의 mixer 경로가 우선 (본 모듈은 그대로 둠)
import * as THREE from "three";
import {
  bonesFor,
  evalBoneCh,
  resolveReach,
  type BoneCh,
  type BonesDef,
} from "./motion/emotes";

// Bone ids (root는 항등이라 가중치 없음).
export const B_TORSO = 0;
export const B_HEAD = 1;
export const B_LEGL = 2;
export const B_LEGR = 3;
export const B_ARML = 4;
export const B_ARMR = 5;
export const B_TAIL = 6;
const NB = 7;

export type BonePose = {
  rx: Float32Array; // per-bone euler (rad)
  ry: Float32Array;
  rz: Float32Array;
  sx: number; sy: number; sz: number; // torso squash (rest 1)
};

export function neutralPose(): BonePose {
  return {
    rx: new Float32Array(NB), ry: new Float32Array(NB), rz: new Float32Array(NB),
    sx: 1, sy: 1, sz: 1,
  };
}

export type PoseInput = {
  emote: string;
  k: number; // one-shot progress 0..1
  t: number; // scene clock
  e?: number; // 1c-2: 감정 경과시간(초). 감정 표 채널의 시간축. 생략 시 t와 동일.
  walkAmp: number; // 0..1 walk envelope
  walkPhase: number; // continuous stride phase
  hug: boolean; // mouthless chomp/hug mode
  dancing: boolean;
  beat: number; // dance beats float
  ateez?: boolean; // §6 dex center-only ATEEZ groove (POV dancing branch untouched)
};

// 감정→본 포즈 (procedural clips). rx>0 = 앞쪽(얼굴/+Z)으로 숙이기.
// 감정 분기는 lib/motion/emotes.ts 표에서 읽는다 (항목 없는 채널은 기본값 유지).
function applyEmoteBones(pose: BonePose, def: BonesDef, t: number, e: number, pulse: number): void {
  const reach = resolveReach(def, pulse);
  const put = (arr: Float32Array, bone: number, ch: BoneCh | undefined) => {
    if (ch !== undefined) arr[bone] = evalBoneCh(ch, t, e, pulse, reach);
  };
  put(pose.rx, B_TORSO, def.torso?.rx);
  put(pose.ry, B_TORSO, def.torso?.ry);
  put(pose.rz, B_TORSO, def.torso?.rz);
  put(pose.rx, B_HEAD, def.head?.rx);
  put(pose.ry, B_HEAD, def.head?.ry);
  put(pose.rz, B_HEAD, def.head?.rz);
  put(pose.rx, B_LEGL, def.legL?.rx);
  put(pose.ry, B_LEGL, def.legL?.ry);
  put(pose.rz, B_LEGL, def.legL?.rz);
  put(pose.rx, B_LEGR, def.legR?.rx);
  put(pose.ry, B_LEGR, def.legR?.ry);
  put(pose.rz, B_LEGR, def.legR?.rz);
  put(pose.rx, B_ARML, def.armL?.rx);
  put(pose.ry, B_ARML, def.armL?.ry);
  put(pose.rz, B_ARML, def.armL?.rz);
  put(pose.rx, B_ARMR, def.armR?.rx);
  put(pose.ry, B_ARMR, def.armR?.ry);
  put(pose.rz, B_ARMR, def.armR?.rz);
  put(pose.rx, B_TAIL, def.tail?.rx);
  put(pose.ry, B_TAIL, def.tail?.ry);
  put(pose.rz, B_TAIL, def.tail?.rz);
  if (def.sx !== undefined) pose.sx = evalBoneCh(def.sx, t, e, pulse, reach);
  if (def.sy !== undefined) pose.sy = evalBoneCh(def.sy, t, e, pulse, reach);
  if (def.sz !== undefined) pose.sz = evalBoneCh(def.sz, t, e, pulse, reach);
}

export function poseFor(p: PoseInput): BonePose {
  const pose = neutralPose();
  const { emote, k, t } = p;
  const e = p.e ?? t;
  const pulse = Math.sin(Math.min(k, 1) * Math.PI);
  const breathe = Math.sin(t * 1.6) * 0.012;
  pose.sy = 1 + breathe;
  pose.sx = 1 - breathe * 0.5;
  pose.sz = 1 - breathe * 0.5;

  const wA = p.walkAmp;
  const ph = p.walkPhase;
  // 기본 서 있기: 체중 이동 + 둘러보기 + 꼬리 살랑.
  pose.rx[B_LEGL] = 0.03 * Math.sin(t * 1.6) + wA * 0.55 * Math.sin(ph);
  pose.rx[B_LEGR] = -0.03 * Math.sin(t * 1.6) + wA * 0.55 * Math.sin(ph + Math.PI);
  pose.rx[B_ARML] = -0.03 * Math.sin(t * 1.6) - wA * 0.45 * Math.sin(ph);
  pose.rx[B_ARMR] = 0.03 * Math.sin(t * 1.6) - wA * 0.45 * Math.sin(ph + Math.PI);
  pose.rx[B_TORSO] = wA * 0.07;
  pose.rz[B_TORSO] = wA * 0.06 * Math.sin(ph) + 0.015 * Math.sin(t * 0.5);
  pose.rx[B_HEAD] = -wA * 0.05 + wA * 0.05 * Math.sin(2 * ph);
  pose.ry[B_HEAD] = (1 - wA) * 0.12 * Math.sin(t * 0.35);
  pose.ry[B_TAIL] = (0.12 + wA * 0.1) * Math.sin(t * 2.2);

  if (p.ateez) {
    // §6 도감 중앙 ATEEZ 그루브 @124BPM (beat=(time*124)/60, DexScene 시간함수).
    // 캡슐 본 구동: 몸통 바운스+힙틸트, 양팔 교차 스윙+찌르기, 양다리 스텝, 머리 끄덕임.
    const b = p.beat;
    pose.rx[B_TORSO] = Math.sin(b * Math.PI) * 0.15;
    pose.ry[B_TORSO] = Math.cos(b * Math.PI * 0.5) * 0.2;
    pose.rz[B_TORSO] = 0.10 * Math.sin(b * Math.PI * 0.5);
    const bounce = Math.abs(Math.sin(b * Math.PI));
    pose.sy = 1 + bounce * 0.05;
    pose.sx = 1 - bounce * 0.025;
    pose.sz = 1 - bounce * 0.025;
    // 양팔 교차 스윙(rz 교차) + 찌르기 그루브(rx 전방 펀치 교대).
    const jabL = Math.max(0, Math.sin(b * Math.PI));
    const jabR = Math.max(0, Math.sin(b * Math.PI + Math.PI));
    pose.rx[B_ARML] = -1.15 * jabL - 0.15;
    pose.rx[B_ARMR] = -1.15 * jabR - 0.15;
    pose.rz[B_ARML] = 0.45 * Math.sin(b * Math.PI);
    pose.rz[B_ARMR] = -0.45 * Math.sin(b * Math.PI);
    // 양다리 스텝.
    pose.rx[B_LEGL] = 0.5 * Math.sin(b * Math.PI);
    pose.rx[B_LEGR] = 0.5 * Math.sin(b * Math.PI + Math.PI);
    // 머리 끄덕임.
    pose.rx[B_HEAD] = 0.12 * Math.sin(b * Math.PI * 2);
    pose.ry[B_TAIL] = 0.5 * Math.sin(b * Math.PI);
    return pose;
  }

  if (p.dancing) {
    const b = p.beat;
    pose.rx[B_LEGL] = 0.4 * Math.sin(b * Math.PI);
    pose.rx[B_LEGR] = 0.4 * Math.sin(b * Math.PI + Math.PI);
    // 팔은 천장을 찌르지 않는 마스코트 범위(−1.8 rad ≈ −103°)로 안정화.
    pose.rx[B_ARML] = -1.8 + 0.35 * Math.sin(b * Math.PI * 2);
    pose.rx[B_ARMR] = -1.8 - 0.35 * Math.sin(b * Math.PI * 2);
    pose.rz[B_TORSO] = 0.12 * Math.sin(b * Math.PI);
    pose.rx[B_HEAD] = 0.1 * Math.sin(b * Math.PI * 2);
    pose.ry[B_TAIL] = 0.5 * Math.sin(b * Math.PI);
    return pose;
  }

  applyEmoteBones(pose, bonesFor(emote, p.hug), t, e, pulse);
  return pose;
}

function sstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

type SkinnedMesh = {
  mesh: THREE.Mesh;
  base: Float32Array; // positions
  baseN: Float32Array; // normals
  bones: Uint8Array; // 4 per vert
  weights: Float32Array; // 4 per vert
  count: Uint8Array; // active influences per vert
  n: number;
};

export type AutoRig = {
  update: (pose: BonePose) => void;
  tipLocal: (bone: number, out: THREE.Vector3) => THREE.Vector3;
};

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function buildAutoRig(host: THREE.Object3D, worldBox: THREE.Box3): AutoRig | null {
  const meshes: THREE.Mesh[] = [];
  host.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  if (!meshes.length) return null;

  // World box → host-local box (skinning space = mesh local space).
  host.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
  const box = worldBox.clone().applyMatrix4(inv);
  const size = box.getSize(new THREE.Vector3());
  if (size.y <= 0.001) return null;
  const H = size.y, W = size.x, D = size.z;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const y0 = box.min.y;

  const pivots = [
    new THREE.Vector3(cx, y0 + H * 0.52, cz), // torso
    new THREE.Vector3(cx, y0 + H * 0.74, cz), // head
    new THREE.Vector3(cx - W * 0.16, y0 + H * 0.30, cz), // legL
    new THREE.Vector3(cx + W * 0.16, y0 + H * 0.30, cz), // legR
    new THREE.Vector3(cx - W * 0.30, y0 + H * 0.60, cz), // armL
    new THREE.Vector3(cx + W * 0.30, y0 + H * 0.60, cz), // armR
    new THREE.Vector3(cx, y0 + H * 0.42, cz - D * 0.30), // tail
  ];

  const band = (x: number, a: number, b: number, c: number, d: number) =>
    sstep(a, b, x) * (1 - sstep(c, d, x));
  const bw = Math.max(W * 0.06, 0.02);

  // eslint-disable-next-line no-console
  console.log(`[dbgrig] box min=(${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}) size=(${W.toFixed(2)},${H.toFixed(2)},${D.toFixed(2)}) armL pivot=(${pivots[B_ARML].x.toFixed(2)},${pivots[B_ARML].y.toFixed(2)},${pivots[B_ARML].z.toFixed(2)})`);
  const skinned: SkinnedMesh[] = [];
  for (const mesh of meshes) {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const nor = geo.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (!pos) continue;
    const n = pos.count;
    const base = new Float32Array(pos.array as Float32Array);
    const baseN = nor
      ? new Float32Array(nor.array as Float32Array)
      : new Float32Array(n * 3);
    if (!nor) {
      for (let i = 0; i < n; i++) baseN[i * 3 + 1] = 1;
    }
    const bones = new Uint8Array(n * 4);
    const weights = new Float32Array(n * 4);
    const count = new Uint8Array(n);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
      // mesh local → host local (rig space). bake면 항등.
      v.applyMatrix4(mesh.matrix);
      const sideL = 1 - sstep(cx - bw, cx + bw, v.x);
      const legRaw = sstep(y0 + H * 0.40, y0 + H * 0.28, v.y);
      const armRaw =
        sstep(W * 0.22, W * 0.40, Math.abs(v.x - cx)) *
        band(v.y, y0 + H * 0.34, y0 + H * 0.46, y0 + H * 0.66, y0 + H * 0.78);
      const headRaw = sstep(y0 + H * 0.62, y0 + H * 0.74, v.y);
      const tailRaw =
        sstep(cz - D * 0.22, cz - D * 0.40, v.z) *
        band(v.y, y0 + H * 0.18, y0 + H * 0.30, y0 + H * 0.55, y0 + H * 0.66);
      // §4 extremity priority: far-side arm tips and far-back tail flame win
      // over legs. Previously legs won outright, so fire-01 hand-bottom and
      // tail-flame vertices bound to leg bones and tore during walk.
      const wArm = armRaw;
      const wTail = tailRaw * (1 - wArm);
      const wLeg = legRaw * (1 - wArm) * (1 - wTail);
      const wHead = headRaw * (1 - wArm) * (1 - wTail) * (1 - wLeg);
      const cand: Array<[number, number]> = [
        [B_LEGL, wLeg * sideL],
        [B_LEGR, wLeg * (1 - sideL)],
        [B_ARML, wArm * sideL],
        [B_ARMR, wArm * (1 - sideL)],
        [B_HEAD, wHead],
        [B_TAIL, wTail],
      ];
      let used = wLeg + wArm + wHead + wTail;
      cand.push([B_TORSO, Math.max(0, 1 - used)]);
      cand.sort((a, b) => b[1] - a[1]);
      let sum = 0;
      let cNum = 0;
      for (let k = 0; k < 4 && k < cand.length; k++) {
        if (cand[k][1] < 1e-4) break;
        bones[i * 4 + k] = cand[k][0];
        weights[i * 4 + k] = cand[k][1];
        sum += cand[k][1];
        cNum++;
      }
      if (sum > 0) {
        for (let k = 0; k < cNum; k++) weights[i * 4 + k] /= sum;
      } else {
        bones[i * 4] = B_TORSO;
        weights[i * 4] = 1;
        cNum = 1;
      }
      count[i] = cNum;
    }
    mesh.frustumCulled = false; // 스킨 변형 후 바운딩 무효 → 컬링 끔
    skinned.push({ mesh, base, baseN, bones, weights, count, n });
  }
  if (!skinned.length) return null;

  const boneMats: THREE.Matrix4[] = [];
  for (let i = 0; i < NB; i++) boneMats.push(new THREE.Matrix4());

  const update = (pose: BonePose) => {
    for (let b = 0; b < NB; b++) {
      _e.set(pose.rx[b], pose.ry[b], pose.rz[b], "XYZ");
      _q.setFromEuler(_e);
      if (b === B_TORSO) _s.set(pose.sx, pose.sy, pose.sz);
      else _s.set(1, 1, 1);
      _p.copy(pivots[b]);
      // M = T(p) · R · S · T(-p)
      _m.compose(_p, _q, _s);
      _m.multiply(_m2.makeTranslation(-_p.x, -_p.y, -_p.z));
      boneMats[b].copy(_m);
    }
    for (const s of skinned) {
      const posAttr = s.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const norAttr = s.mesh.geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
      const pa = posAttr.array as Float32Array;
      const na = norAttr ? (norAttr.array as Float32Array) : null;
      for (let i = 0; i < s.n; i++) {
        const x = s.base[i * 3], y = s.base[i * 3 + 1], z = s.base[i * 3 + 2];
        let px = 0, py = 0, pz = 0;
        let qx = 0, qy = 0, qz = 0;
        const nx0 = s.baseN[i * 3], ny0 = s.baseN[i * 3 + 1], nz0 = s.baseN[i * 3 + 2];
        const cn = s.count[i];
        for (let k = 0; k < cn; k++) {
          const wgt = s.weights[i * 4 + k];
          const e = boneMats[s.bones[i * 4 + k]].elements;
          px += wgt * (e[0] * x + e[4] * y + e[8] * z + e[12]);
          py += wgt * (e[1] * x + e[5] * y + e[9] * z + e[13]);
          pz += wgt * (e[2] * x + e[6] * y + e[10] * z + e[14]);
          qx += wgt * (e[0] * nx0 + e[4] * ny0 + e[8] * nz0);
          qy += wgt * (e[1] * nx0 + e[5] * ny0 + e[9] * nz0);
          qz += wgt * (e[2] * nx0 + e[6] * ny0 + e[10] * nz0);
        }
        pa[i * 3] = px;
        pa[i * 3 + 1] = py;
        pa[i * 3 + 2] = pz;
        if (na) {
          const il = 1 / (Math.hypot(qx, qy, qz) || 1);
          na[i * 3] = qx * il;
          na[i * 3 + 1] = qy * il;
          na[i * 3 + 2] = qz * il;
        }
      }
      posAttr.needsUpdate = true;
      if (norAttr) norAttr.needsUpdate = true;
    }
  };

  const armLen = H * 0.26;
  const restL = new THREE.Vector3(-0.35, -1, 0.12).normalize();
  const restR = new THREE.Vector3(0.35, -1, 0.12).normalize();
  const tipLocal = (bone: number, out: THREE.Vector3): THREE.Vector3 => {
    const dir = bone === B_ARML ? restL : restR;
    // tip = M · (pivot + dir·len)  (M에 T(-p)가 포함이라 피벗을 더해야 함)
    out.copy(dir).multiplyScalar(armLen).add(pivots[bone]).applyMatrix4(boneMats[bone]);
    return out;
  };

  return { update, tipLocal };
}
