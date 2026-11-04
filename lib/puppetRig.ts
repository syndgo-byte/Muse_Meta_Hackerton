// Rigid showcase rig for single-mesh static GLBs.
// 24종 GLB는 스킨·내장 클립이 없는 단일 정적 메시이므로, 웹에서 뼈·눈·가중치를
// 덧씌우지 않는다 (덧씌우기가 겹눈·テク스처 뒤엉킴의 원인이었음).
// - 눈/얼굴: GLB 원본 그대로 (오버레이 0개).
// - 정면: 원본 authored orientation 그대로 (베이크 회전 없음). 도감 lookAt이
//   모델 +Z를 카메라로 향하게 한다.
// - 모션: 모델 전체의 리지드 이동/회전만 (통째로 뛰고 끄덕이고 흔들림).
//   정점을 건드리지 않으므로 텍스처 찢어짐이 구조적으로 불가능.
// - Dex role: dancing=true -> 8카운트 통통 그루브. POV role: 감정별 전신 제스처.
// - 내장 클립: GLB에 애니메이션이 없어 재생할 클립이 없음 (프로브 확정).
//   후속 에셋에 클립이 생기면 mixer 경로로 연결할 것 (본 모듈은 손대지 않음).
import * as THREE from "three";
import { applyRigidCh, rigidFor } from "./motion/emotes";

export type PuppetAnim = {
  emote: string; // idle|beg|hungry|happy|cry|hurt|eat|chomp|greet|roam|sleep|attack
  k: number; // one-shot progress 0..1
  t: number; // scene clock
  e?: number; // 1c-2: 감정 경과시간(초). 감정 표 채널의 시간축. 생략 시 t와 동일.
  dancing: boolean; // dex=true, pov=false
  beat: number; // dance beats float
  amp?: number; // amplitude multiplier (dex center = 1.4)
};

export type PuppetRig = {
  group: THREE.Group;
  update: (a: PuppetAnim) => void;
};

// 전신 리지드 제스처 본체 (bake 여부와 무관, group 트랜스폼에만 쓴다).
function makeRigidUpdate(group: THREE.Group): (a: PuppetAnim) => void {
  return (a: PuppetAnim) => {
    const { emote, t } = a;
    const e = a.e ?? t;
    const amp = a.amp ?? 1;
    const pulse = Math.sin(Math.min(a.k, 1) * Math.PI);
    // 기본 호흡: 미세한 상하 (스케일 금지).
    let y = Math.sin(t * 1.6) * 0.008;
    let rx = 0, ry = 0, rz = Math.sin(t * 0.5) * 0.02;

    // 감정 제스처는 lib/motion/emotes.ts 표에서 읽는다.
    const rdef = rigidFor(emote);
    if (rdef.y !== undefined) y = applyRigidCh(y, rdef.y, t, e, pulse);
    if (rdef.rx !== undefined) rx = applyRigidCh(rx, rdef.rx, t, e, pulse);
    if (rdef.ry !== undefined) ry = applyRigidCh(ry, rdef.ry, t, e, pulse);
    if (rdef.rz !== undefined) rz = applyRigidCh(rz, rdef.rz, t, e, pulse);
    if (rdef.z !== undefined) {
      group.position.z = applyRigidCh(group.position.z, rdef.z, t, e, pulse);
    }

    if (a.dancing) {
      // 도감 전용 8카운트 통통 그루브 (전신 리지드).
      const count = (((Math.floor(a.beat) % 8) + 8) % 8);
      const prev = DANCE[(count + 7) % 8];
      const next = DANCE[count];
      const e = 1 - Math.exp(-6 * (a.beat % 1));
      const L = (p: keyof DancePose) =>
        (prev[p] + (next[p] - prev[p]) * e) * amp;
      y += (L("hipsY") + L("rootY")) * 0.6;
      rx += (L("hipsRX") + L("spineRX") + L("headRX")) * 0.5;
      ry += (L("hipsRY") + L("spineRY")) * 0.5;
      rz += (L("hipsRZ") + L("spineRZ")) * 0.5;
    } else {
      group.position.z = 0;
    }

    group.position.y = y;
    group.rotation.set(rx, ry, rz);
  };
}

export function rigObject(obj: THREE.Object3D): PuppetRig | null {
  const meshes: THREE.Mesh[] = [];
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) meshes.push(m);
  });
  if (!meshes.length) return null;

  // 월드 베이크: 스케일/위치를 정점에 굽고 트랜스폼은 원점으로 (형태 불변).
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    m.geometry.applyMatrix4(m.matrixWorld);
    m.position.set(0, 0, 0);
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    m.updateMatrix();
  }
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);

  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  for (const m of meshes) group.add(m);

  return { group, update: makeRigidUpdate(group) };
}

// R-C-1: 스킨 메시용 무베이크 래퍼. 월드 베이크(applyMatrix4)는 스키닝을
// 깨므로(R-B 실증) 계층을 통째로 감싸고 리지드 제스처만 얹는다.
// meshes를 빼내지 않아 SkinnedMesh·본 부모 관계가 그대로 유지된다.
export function wrapRigid(obj: THREE.Object3D): PuppetRig | null {
  let meshes = 0;
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  if (!meshes) return null;
  const group = new THREE.Group();
  group.position.set(0, 0, 0);
  group.add(obj);
  return { group, update: makeRigidUpdate(group) };
}

type DancePose = {
  hipsY: number; hipsRX: number; hipsRY: number; hipsRZ: number;
  spineRX: number; spineRY: number; spineRZ: number;
  headRX: number;
  rootY: number;
};
const DREST: DancePose = {
  hipsY: 0, hipsRX: 0, hipsRY: 0, hipsRZ: 0,
  spineRX: 0, spineRY: 0, spineRZ: 0,
  headRX: 0,
  rootY: 0,
};
// Beat 1: 힙드롭
const B0: DancePose = {
  ...DREST, hipsY: -0.12, hipsRZ: -0.1,
  spineRX: 0.12, headRX: 0.08,
};
// Beat 2: 체스트 팝
const B1: DancePose = {
  ...DREST, hipsY: 0.02, spineRX: -0.28, headRX: -0.2,
};
// Beat 3: 트위스트 좌
const B2: DancePose = {
  ...DREST, hipsY: -0.04, hipsRY: 0.3, spineRY: -0.28, spineRZ: 0.1,
};
// Beat 4: 트위스트 우
const B3: DancePose = {
  ...DREST, hipsY: -0.04, hipsRY: -0.3, spineRY: 0.28, spineRZ: -0.1,
};
// Beat 5: 니킥 (전신 dip)
const B4: DancePose = {
  ...DREST, hipsY: -0.1, spineRX: 0.08, headRX: 0.05,
};
// Beat 6: 스텝 & 틸트
const B5: DancePose = {
  ...DREST, hipsY: -0.08, spineRZ: 0.08,
};
// Beat 7: 바운시 스텝 R
const B6: DancePose = {
  ...DREST, hipsY: -0.12, hipsRY: 0.12, spineRX: 0.22, headRX: 0.08,
  rootY: 0.04,
};
// Beat 8: 바운시 스텝 L
const B7: DancePose = {
  ...DREST, hipsY: -0.12, hipsRY: -0.12, spineRX: 0.14, headRX: 0,
  rootY: 0.04,
};
const DANCE = [B0, B1, B2, B3, B4, B5, B6, B7];
