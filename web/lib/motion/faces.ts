// 5a 파라미터 얼굴: 감정 → 얼굴 파라미터 표 (fire-01 전용).
// - 19 감정 전부 서로 다른 조합 (scripts/verify-faces.mjs로 검사).
// - 런타임 의존 없음(type-only import만 + EMOTE_FACE): 단독 컴파일 가능.
// - 방정식 출처: EMOTE_FACE(눈/입 상태) + 아래 미세값(같은 얼굴 감정 구분용).
//   hug 분기는 fire-01에서 죽어 있음(mouthLive=true) — 테이블만 둔다.
import { EMOTE_FACE, EMOTE_IDS, type EmoteId } from "./emotes";
import type { EyeState, FaceParams, MouthState } from "../facePaint";

// 파라미터 얼굴 적용 종. 5c에서 묶음 단위로만 추가한다.
export const PARAM_FACE_SPECIES: readonly string[] = ["fire-01"];

// 휴지 = 원본 그대로 (paint 시 원본 텍스처 재바인딩).
export const FACE_REST: FaceParams = {
  lid: 0,
  lidLow: 0,
  pupil: 1,
  smile: 0,
  mouthOpen: 0,
};

// 감정별 파라미터. 눈 상태가 같은 감정끼리는 입 미세값으로 구분한다
// (각 감정의 미소가 미세하게 다름). heart 눈 3종(beg·want·cuddle)은
// 하트 글리프 폴백 + pupil이 하트 크기로 쓰인다.
export const FACE_PARAMS: Record<EmoteId, FaceParams> = {
  idle: { ...FACE_REST },
  // roam 행은 faceParamsFor가 idle 머신으로 보내므로 미사용 (EMOTE_FACE 선례).
  // 수치만 idle과 다르게 둔다 (전수 상이 조건).
  roam: { lid: 0, lidLow: 0, pupil: 1.02, smile: 0, mouthOpen: 0 },
  beg: { lid: 0, lidLow: 0, pupil: 1.0, smile: 1.0, mouthOpen: 0 },
  want: { lid: 0, lidLow: 0, pupil: 1.12, smile: 0.92, mouthOpen: 0 },
  hungry: { lid: 0.38, lidLow: 0.08, pupil: 0.85, smile: 0, mouthOpen: 0 },
  happy: { lid: 0.36, lidLow: 0.42, pupil: 1.0, smile: 1.0, mouthOpen: 0 },
  cry: { lid: 0.42, lidLow: 0.12, pupil: 0.8, smile: -0.08, mouthOpen: 0 },
  hurt: { lid: 0.56, lidLow: 0.1, pupil: 1.0, smile: -0.05, mouthOpen: 0 },
  sleep: { lid: 0.58, lidLow: 0.12, pupil: 1.0, smile: 0, mouthOpen: 0 },
  attack: { lid: 0, lidLow: 0, pupil: 1.3, smile: 0.2, mouthOpen: 1.0 },
  greet: { lid: 0.33, lidLow: 0.38, pupil: 1.05, smile: 0.9, mouthOpen: 0 },
  eat: { lid: 0.36, lidLow: 0.4, pupil: 1.0, smile: 0.15, mouthOpen: 0.15 },
  chomp: { lid: 0.05, lidLow: 0.05, pupil: 1.25, smile: 0.1, mouthOpen: 0.2 },
  fetch: { lid: 0.02, lidLow: 0, pupil: 1.22, smile: 0, mouthOpen: 0 },
  drowsy: { lid: 0.5, lidLow: 0.2, pupil: 1.0, smile: 0, mouthOpen: 0 },
  zoomies: { lid: 0, lidLow: 0.1, pupil: 1.18, smile: 0.85, mouthOpen: 0.15 },
  pat: { lid: 0.39, lidLow: 0.45, pupil: 1.0, smile: 0.95, mouthOpen: 0 },
  cuddle: { lid: 0, lidLow: 0, pupil: 0.92, smile: 0.97, mouthOpen: 0 },
  faint: { lid: 0.6, lidLow: 0.05, pupil: 1.0, smile: 0, mouthOpen: 0 },
};

// mouthAlt 진동(eat·chomp·drowsy)의 벌림값. 주기·임계는 EMOTE_FACE 단일 출처.
const MOUTH_ALT_OPEN: Partial<Record<EmoteId, number>> = {
  eat: 0.85,
  chomp: 1.0,
  drowsy: 0.7,
};

// hug 변형(eat·chomp만 정의됨). fire-01은 mouthLive=true라 실제로는 안 탄다.
const HUG_PARAMS: Partial<Record<EmoteId, FaceParams>> = {
  eat: { lid: 0.36, lidLow: 0.42, pupil: 1.0, smile: 0, mouthOpen: 0 },
  chomp: { lid: 0.36, lidLow: 0.42, pupil: 1.0, smile: 0, mouthOpen: 0 },
};

// attach 시 미리 구워두는 변형 목록 (19 감정 + 입 진동 alt 3종).
export const PARAM_PREWARM: Array<{ p: FaceParams; mouth: boolean; eyes: EyeState }> = [
  ...EMOTE_IDS.map((id) => ({
    p: FACE_PARAMS[id],
    mouth: EMOTE_FACE[id].mouth !== "baked",
    eyes: EMOTE_FACE[id].eyes,
  })),
  ...(["eat", "chomp", "drowsy"] as EmoteId[]).map((id) => ({
    p: { ...FACE_PARAMS[id], mouthOpen: MOUTH_ALT_OPEN[id] ?? 1 },
    mouth: (EMOTE_FACE[id].mouthAlt ?? "baked") !== "baked",
    eyes: EMOTE_FACE[id].eyes,
  })),
];

export type FaceParamOut = {
  p: FaceParams;
  mouth: boolean; // 입 paint 여부 (baked면 false)
  eyes: EyeState; // heart 폴백 판정용
};

// faceFor의 파라미터 판. null 조건(dancing 제외 idle·roam)은 faceFor와 동일.
// mouth 진동·hug 분기도 faceFor와 같은 식 (EMOTE_FACE 단일 출처).
export function faceParamsFor(
  emote: string,
  o: { emoteT: number; hug: boolean; dancing: boolean }
): FaceParamOut | null {
  if (emote === "idle" || emote === "roam") {
    if (!o.dancing) return null;
    return { p: { ...FACE_REST }, mouth: false, eyes: "baked" as EyeState };
  }
  const def: FaceParams | undefined = (FACE_PARAMS as Record<string, FaceParams>)[emote];
  const face: { mouth: MouthState; mouthAlt?: MouthState; mouthFreq?: number; mouthThresh?: number } | undefined =
    (EMOTE_FACE as Record<string, { mouth: MouthState; mouthAlt?: MouthState; mouthFreq?: number; mouthThresh?: number }>)[emote];
  if (!def || !face) return { p: { ...FACE_REST }, mouth: false, eyes: "baked" as EyeState };
  if (o.hug) {
    const h = HUG_PARAMS[emote as EmoteId];
    if (h) return { p: { ...h }, mouth: false, eyes: "happy" as EyeState };
  }
  if (
    face.mouthAlt !== undefined &&
    face.mouthFreq !== undefined &&
    face.mouthThresh !== undefined
  ) {
    const alt = Math.sin(o.emoteT * face.mouthFreq) > face.mouthThresh;
    if (alt) {
      return {
        p: { ...def, mouthOpen: MOUTH_ALT_OPEN[emote as EmoteId] ?? 1 },
        mouth: face.mouthAlt !== "baked",
        eyes: (EMOTE_FACE as Record<string, { eyes: EyeState }>)[emote].eyes,
      };
    }
  }
  return {
    p: { ...def },
    mouth: face.mouth !== "baked",
    eyes: (EMOTE_FACE as Record<string, { eyes: EyeState }>)[emote].eyes,
  };
}
