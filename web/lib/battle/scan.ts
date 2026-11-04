// lib/battle/scan.ts — G-1: COCO 감지 라벨 → encounter 표 키워드 (순수, 클라이언트 안전).
// createDetector(위험 감지 D6-2 재사용)의 영문 라벨을 §15-1a 표의 한글 키워드로 바꾼 뒤,
// matchLabel로 종을 고른다. 표에 없는 라벨은 null (시연용 스냅샷 조우로 폴백).
// 상대 import만 쓴다 (verify-scan.mjs 독립 tsc 컴파일).
import { matchLabel } from "../encounter/table";

// COCO 80종 중 표에 걸리는 14 라벨 → 12종.
export const COCO_TO_KO: Record<string, string> = {
  cup: "커피",
  bottle: "물병",
  "wine glass": "물컵",
  cat: "고양이",
  dog: "강아지",
  "potted plant": "화분",
  umbrella: "우산",
  cake: "케이크",
  sandwich: "식빵",
  train: "지하철",
  bench: "공원",
  kite: "연날리기",
  sink: "싱크대",
  refrigerator: "냉동실",
};

// COCO 라벨 정규화 → 표 키워드. 없으면 null.
export function cocoToLabel(coco: string): string | null {
  const t = (coco ?? "").trim().toLowerCase();
  if (!t) return null;
  return COCO_TO_KO[t] ?? null;
}

// COCO 라벨 + confidence(0~100) → 종. confidence < 60이면 null (§15-1a).
export function cocoToSpecies(coco: string, confidence: number): string | null {
  const ko = cocoToLabel(coco);
  if (!ko) return null;
  const m = matchLabel(ko, confidence);
  return m.speciesId;
}

// G-2: 자동 트리거 (hazard 1초 루프 읽기 전용). 같은 최상위 라벨 연속 3틱 +
// confidence >= 60일 때 1회 발화. 발화한 라벨은 같은 자리에서 재발화하지 않고,
// 라벨 변경·소멸(null 틱) 뒤 재인식만 허용한다.
export interface AutoScanState {
  top: string | null;
  streak: number;
  fired: string[];
}

export const EMPTY_AUTO_SCAN: AutoScanState = { top: null, streak: 0, fired: [] };

export function autoScanTick(
  state: AutoScanState,
  label: string | null,
  confidence: number
): { fire: boolean; label: string | null; state: AutoScanState } {
  const t = (label ?? "").trim().toLowerCase();
  const norm = t ? t : null;
  // 현재 라벨 외 발화 기록은 파기 (사라진 자리는 재인식 허용).
  const kept = norm ? state.fired.filter((f) => f === norm) : [];
  if (!norm) {
    return { fire: false, label: null, state: { top: null, streak: 0, fired: kept } };
  }
  const streak = norm === state.top ? state.streak + 1 : 1;
  const fire = streak >= 3 && confidence >= 60 && !kept.includes(norm);
  return {
    fire,
    label: norm,
    state: { top: norm, streak, fired: fire ? [...kept, norm] : kept },
  };
}
