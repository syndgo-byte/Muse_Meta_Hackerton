// R-B-1: Blender 리그 GLB 로더.
// public/models-rigged/<id>.glb + bones.json이 있으면 그 SkinnedMesh·뼈를 쓰고,
// 없거나 ?rig=auto면 호출자가 autoRig 경로로 돌아간다.
// 반환은 autoRig와 같은 모양 { update } + 뼈 이름 → Bone 맵
// (autoRig의 tipLocal은 호출자가 없어 /dex에서 쓰지 않는다).
import * as THREE from "three";
import type { BonePose } from "./autoRig";
import { BoneRetarget, type ExtraBone } from "./motion/rigRetarget";

export type RiggedRig = {
  update: (pose: BonePose) => void;
  bones: Map<string, THREE.Bone>;
  skinned: THREE.SkinnedMesh[];
};

let manifestCache: Record<string, string[]> | null | undefined;

export function rigMode(): "rigged" | "auto" {
  try {
    return new URLSearchParams(window.location.search).get("rig") === "auto"
      ? "auto"
      : "rigged";
  } catch {
    return "rigged";
  }
}

export async function loadBonesManifest(): Promise<Record<string, string[]> | null> {
  if (manifestCache !== undefined) return manifestCache;
  try {
    const res = await fetch("/models-rigged/bones.json");
    if (!res.ok) {
      manifestCache = null;
      return null;
    }
    manifestCache = (await res.json()) as Record<string, string[]>;
    return manifestCache;
  } catch {
    manifestCache = null;
    return null;
  }
}

export function riggedUrl(id: string): string {
  return `/models-rigged/${id}.glb`;
}

/** 모델 루트에서 SkinnedMesh·뼈를 모아 리그를 만든다. 조건 미달이면 null. */
export function buildRiggedRig(
  modelRoot: THREE.Object3D,
  speciesId: string,
  bonesWant: string[] | undefined,
  extraBones: ExtraBone[] = [],
): RiggedRig | null {
  const skinned: THREE.SkinnedMesh[] = [];
  modelRoot.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) return null;
  const bones = new Map<string, THREE.Bone>();
  modelRoot.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  if (bonesWant && bonesWant.some((b) => !bones.has(b))) return null;
  void speciesId;
  const retarget = new BoneRetarget(modelRoot, bones, extraBones);
  if (!retarget.ok) return null;
  for (const m of skinned) m.frustumCulled = false; // 스킨 변형 후 바운드 무효
  return {
    update: (pose: BonePose) => {
      retarget.pose(pose);
      for (const m of skinned) m.skeleton.update();
    },
    bones,
    skinned,
  };
}
