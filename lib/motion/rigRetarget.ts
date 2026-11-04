// R-B-3: autoRig 공간의 BonePose(모델 공간 오일러)를 Blender 리그 본에 적용.
// - 공식(본별, 부모부터 순서대로): L' = Wp⁻¹ · T(j) · R · O0
//   R = 모델 공간 목표 회전(XYZ 오일러, 보정표 적용), O0 = 레스트 방향 성분,
//   j = 현재 부모 아래에서의 관절 위치, Wp = 현재 부모 월드(모델 루트 상대).
//   모델 공간 공식이라 본의 레스트 축이 달라도(팔다리 레스트 쿼터니언 임의)
//   같은 춤이 재현된다. 축 변환이 필요 없어 보정표는 배율 1 + 안전 클램프다.
// - 자식은 부모 회전을 위치로만 따라가고 방향은 모델 공간 R을 유지한다
//   (autoRig 독립 피벗 의미와 일치: 클립이 그렇게 작곡됨).
// - squash(sx·sy·sz)는 끈다 (R-B-7: 얼굴 강체 1% 게이트와 양립 불가).
import * as THREE from "three";
import {
  B_ARML, B_ARMR, B_HEAD, B_LEGL, B_LEGR, B_TAIL, B_TORSO,
  type BonePose,
} from "../autoRig";

export type RigBoneName = "torso" | "head" | "legL" | "legR" | "armL" | "armR" | "tail";
export type ExtraBone = { idx: number; name: RigBoneName };

// autoRig 본 인덱스 → 리그 본 이름. wing·fan은 채널이 없어 레스트 유지.
// tail은 감정 채널만 있어(/dex 춤 무영향) R-C 호출자가 extra로 붙인다.
const IDX2NAME: Array<{ idx: number; name: RigBoneName }> = [
  { idx: B_TORSO, name: "torso" },
  { idx: B_HEAD, name: "head" },
  { idx: B_LEGL, name: "legL" },
  { idx: B_LEGR, name: "legR" },
  { idx: B_ARML, name: "armL" },
  { idx: B_ARMR, name: "armR" },
];

/** R-C-3: 감정 꼬리 채널. 호출자: buildRiggedRig(obj, id, want, [RIG_TAIL_EXTRA]). */
export const RIG_TAIL_EXTRA: ExtraBone = { idx: B_TAIL, name: "tail" };

export type BoneFix = {
  order: "XYZ"; // autoRig와 동일 오일러 순서
  scale: [number, number, number]; // 축별 각도 배율 (rx, ry, rz)
  clamp: [number, number, number]; // 축별 절댓값 상한 (rx, ry, rz)
};


// 보정표. 배율 1: 모델 공간 공식이 레스트 축 차이를 흡수한다(위 주석).
// 상한 = 추출 sanity 캡 + 정면 응시 여유(torso ry 여유).
// 8-H-2: 다리 rx 0.6→1.0 (킥·깊게 앉기 headroom. 기존 클립값 ≤0.6 무영향).
// R-D: 머리 ry 1.22→0.8 (±70°→±46°. 클립 head.ry+정면 보정이 동방향 누적돼
// 클램프에 상시 걸리고 목이 몸에서 떨어져 보임. 데이터·보정식 무수정, 적용 상한만).
// tail 상한 = 감정 최대(happy·zoomies ry 0.6) + 여유. emotes.ts 데이터 무수정.
// DT-1: 연속 소프트 클램프 (옛 0.96 하드 게이트 부활 금지 — 값 불연속이 떨림의 원인).
// 한도의 DT1_SOFT_START 비율부터 지수 포화로 눌러 값·기울기가 끊기지 않는다.
// 적용 관절은 팔(몸통/팔 경계)부터. 상수는 여기 한 곳.
export const DT1_SOFT_ON = true;
export const DT1_SOFT_START = 0.8;
// DT-2R: 팔만으로 복귀 (DT-2 전관절 확장이 춤을 흐느적거리게 함.
// 찢김 잔존분은 DT-3 GLB 가중치로만 본다).
// 캡처용 임시 토글: NEXT_PUBLIC_DT2R_OFF=1이면 DT-2 7관절. 기본은 팔만이라
// env 없이 시작한 서버(:3000 포함)의 동작은 변하지 않는다. 캡처 후 삭제.
const DT2R_OFF = process.env.NEXT_PUBLIC_DT2R_OFF === "1";
export const DT1_SOFT_BONES: RigBoneName[] = DT2R_OFF
  ? ["torso", "head", "legL", "legR", "armL", "armR", "tail"]
  : ["armL", "armR"];
// DT-1: 팔 한도 (소프트 경로 전용. 하드 1.9는 찢어짐 각도 1.38을 못 누른다).
export const DT1_ARM_CLAMP: [number, number, number] = [1.35, 0.7, 1.5];
// DT-2: 관절별 소프트 점근 한도. 팔은 DT-1 실측값 유지, 나머지는 기존 하드
// 상한의 90% (주문서 허용 최대 10% 축소. scan-tears.mjs 재스캔으로 검증).
// 100%로는 찢어짐이 -1.3%만 줄고, 잔존분은 가중치 절벽이라 DT-3으로 넘긴다.
// DT-2R: armL/armR 행만 사용. 나머지 관절은 RETARGET_TABLE 하드 상한으로 복귀.
// (표는 참조용으로 유지. 삭제하지 않는다.)
export const DT2_SOFT_CLAMP: Record<RigBoneName, [number, number, number]> = {
  torso: [0.45, 0.63, 0.45],
  head: [0.54, 0.72, 0.54],
  legL: [0.9, 0.63, 0.72],
  legR: [0.9, 0.63, 0.72],
  armL: [1.35, 0.7, 1.5],
  armR: [1.35, 0.7, 1.5],
  tail: [0.45, 0.81, 0.45],
};
export function softClamp(v: number, lim: number): number {
  const x = Math.abs(v);
  const a = DT1_SOFT_START * lim;
  if (x <= a) return v;
  const w = lim - a;
  return Math.sign(v) * (lim - w * Math.exp(-(x - a) / w));
}
export const RETARGET_TABLE: Record<RigBoneName, BoneFix> = {
  torso: { order: "XYZ", scale: [1, 1, 1], clamp: [0.5, 0.7, 0.5] },
  head: { order: "XYZ", scale: [1, 1, 1], clamp: [0.6, 0.8, 0.6] },
  legL: { order: "XYZ", scale: [1, 1, 1], clamp: [1.0, 0.7, 0.8] },
  legR: { order: "XYZ", scale: [1, 1, 1], clamp: [1.0, 0.7, 0.8] },
  armL: { order: "XYZ", scale: [1, 1, 1], clamp: [1.9, 0.7, 1.5] },
  armR: { order: "XYZ", scale: [1, 1, 1], clamp: [1.9, 0.7, 1.5] },
  tail: { order: "XYZ", scale: [1, 1, 1], clamp: [0.5, 0.9, 0.5] },
};

// R-C-3: 팔·머리뼈가 없는 종의 몸통 대체. 없는 본 채널의 감정 에너지를
// 몸통 회전에 소게인(≤0.3)으로 얹는다. 새 안무가 아니라 실제 감정값의
// 축소 메아리이며, 전신 리지드(EMOTE_RIGID)는 puppet 레이어에서 별도 동작.
// pose() 호출 직전에 적용한다 (retarget 클램프가 최종 상한).
export function applyMissingBoneFallback(pose: BonePose, bones: Map<string, THREE.Bone>): void {
  if (!bones.has("armL") && !bones.has("armR")) {
    pose.rx[B_TORSO] += clampN((pose.rx[B_ARML] + pose.rx[B_ARMR]) * 0.15, 0.3);
    pose.rz[B_TORSO] += clampN((pose.rz[B_ARML] - pose.rz[B_ARMR]) * 0.15, 0.3);
  }
  if (!bones.has("head")) {
    pose.rx[B_TORSO] += clampN(pose.rx[B_HEAD] * 0.3, 0.3);
    pose.rz[B_TORSO] += clampN(pose.rz[B_HEAD] * 0.3, 0.2);
  }
}

type RestRec = {
  bone: THREE.Bone;
  name: RigBoneName;
  idx: number; // autoRig 본 인덱스
  restLocal: THREE.Matrix4; // 본래 로컬 행렬
  orient: THREE.Matrix4; // O0 = T(-j0)·W0 (레스트 방향 성분, 루트 상대)
  joint0: THREE.Vector3; // 레스트 관절 위치 (루트 상대)
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _v = new THREE.Vector3();

const clampN = (v: number, lim: number) => Math.min(lim, Math.max(-lim, v));

export class BoneRetarget {
  private recs: RestRec[] = [];
  private rootInv = new THREE.Matrix4();

  constructor(
    private root: THREE.Object3D,
    private bones: Map<string, THREE.Bone>,
    extraBones: ExtraBone[] = [],
  ) {
    root.updateMatrixWorld(true);
    this.rootInv.copy(root.matrixWorld).invert();
    // 부모(torso)부터: IDX2NAME 순서가 부모 우선이다. extra는 torso 자식만 허용.
    for (const { name, idx } of [...IDX2NAME, ...extraBones]) {
      const bone = bones.get(name);
      if (!bone) continue;
      bone.updateWorldMatrix(true, false);
      // W0: 레스트 월드 (루트 상대).
      const w0 = new THREE.Matrix4()
        .multiplyMatrices(this.rootInv, bone.matrixWorld);
      const joint0 = new THREE.Vector3().setFromMatrixPosition(w0);
      const orient = new THREE.Matrix4()
        .makeTranslation(-joint0.x, -joint0.y, -joint0.z)
        .multiply(w0);
      bone.updateMatrix();
      // 로컬 행렬을 직접 쓴다 (decompose는 비균일 스케일 아래에서 전단을 잃음).
      bone.matrixAutoUpdate = false;
      this.recs.push({ bone, name, idx, restLocal: bone.matrix.clone(), orient, joint0 });
    }
  }

  /** 본이 하나도 없으면 false (호출자가 폴백 판단). */
  get ok(): boolean {
    return this.recs.length > 0;
  }

  pose(p: BonePose): void {
    const root = this.root;
    // R-B-7: squash 끔 (sx·sy·sz 무시, 루트 스케일 손대지 않음).
    // ±3% 비균일 스케일은 얼굴 모양 변화 1% 게이트와 양립 불가.
    // 몸통 들썩임은 torso rx·root.y 채널이 담당한다.
    root.updateMatrixWorld(true);
    this.rootInv.copy(root.matrixWorld).invert();

    for (const rec of this.recs) {
      const { name, idx } = rec;
      const fix = RETARGET_TABLE[name];
      // DT-2R: 팔만 소프트 클램프. 나머지 관절은 하드 상한.
      // DT1_ARM_CLAMP는 DT2_SOFT_CLAMP.armL/armR과 같은 값으로 유지된다.
      const soft = DT1_SOFT_ON && DT1_SOFT_BONES.includes(name);
      const cl = soft ? softClamp : clampN;
      const lim = soft ? DT2_SOFT_CLAMP[name] : fix.clamp;
      const rx = cl(p.rx[idx] * fix.scale[0], lim[0]);
      const ry = cl(p.ry[idx] * fix.scale[1], lim[1]);
      const rz = cl(p.rz[idx] * fix.scale[2], lim[2]);
      _e.set(rx, ry, rz, fix.order);
      _q.setFromEuler(_e);
      const { bone } = rec;
      const parent = bone.parent;
      if (parent) parent.updateWorldMatrix(true, false);
      // Wp: 현재 부모 월드 (루트 상대).
      const wp = parent
        ? _m1.multiplyMatrices(this.rootInv, parent.matrixWorld)
        : _m1.identity();
      // 현재 관절: 부모 아래에서 레스트 로컬을 유지했을 때의 위치.
      _m2.multiplyMatrices(wp, rec.restLocal);
      _v.setFromMatrixPosition(_m2);
      // Wnew = T(j) · R · O0 → L' = Wp⁻¹ · Wnew.
      _m3.makeTranslation(_v.x, _v.y, _v.z);
      _m3.multiply(_m2.makeRotationFromQuaternion(_q));
      _m3.multiply(rec.orient);
      _m2.copy(wp).invert().multiply(_m3);
      bone.matrix.copy(_m2);
      bone.matrixWorldNeedsUpdate = true;
    }
    root.updateMatrixWorld(true);
  }
}
