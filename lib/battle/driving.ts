// lib/battle/driving.ts — BT-2/BT-2b: 운전 중 판정 (순수, 클라이언트 안전).
// 속도(5 m/s 이상 2초 지속) 또는 보닛형 차량 박스(아래 가장자리+폭 50%+중앙 커버 5초 지속)
// 하나라도 해당하면 운전 중. 걷는 속도(< 2.5 m/s)면 차량 박스와 무관히 운전 아님.
// 상수는 전부 이 파일 한 곳에 둔다.
export const DRIVING_SPEED_MPS = 5; // 약 18 km/h
export const DRIVING_SPEED_HOLD_MS = 2000; // 2초 이상 이어짐
export const DRIVING_BONNET_MIN_W = 0.5; // 화면 폭의 50% 이상
export const DRIVING_BONNET_EDGE_Y = 0.98; // 아래 가장자리에 닿음 (y1 >=)
export const DRIVING_BONNET_HOLD_MS = 5000; // 5초 이상 이어짐
export const DRIVING_WALK_MPS = 2.5; // 이하면 차량 박스와 무관히 운전 아님
export const DRIVING_VEHICLES = ["car", "truck", "bus", "motorcycle"];
export const BATTLE_OVERLAY_MAX_ALPHA = 0.25;
export const DRIVING_MSG = "운전 중에는 배틀할 수 없어요";

// COCO 차량 라벨 정확 일치 (대소문자 무시).
export function isVehicleLabel(label: string): boolean {
  const t = (label ?? "").trim().toLowerCase();
  if (!t) return false;
  return DRIVING_VEHICLES.some((v) => t === v);
}

// BT-2b: "내가 차 안에 있다"는 모양 (보닛·대시보드 시야).
// 아래 가장자리에 닿고, 폭 50% 이상이며, 가운데(x=0.5)를 덮는다.
// 길가 주차차(옆쪽·작은 박스)는 제외.
export function isBonnetBox(box: { x0: number; x1: number; y1: number }): boolean {
  const w = box.x1 - box.x0;
  return (
    Number.isFinite(w) &&
    Number.isFinite(box.y1) &&
    Number.isFinite(box.x0) &&
    Number.isFinite(box.x1) &&
    box.y1 >= DRIVING_BONNET_EDGE_Y &&
    w >= DRIVING_BONNET_MIN_W &&
    box.x0 <= 0.5 &&
    box.x1 >= 0.5
  );
}

export interface DrivingState {
  lastNow: number | null;
  speedMs: number; // 5 m/s 이상 연속 누적 (null 샘플은 무시)
  bonnetMs: number; // 보닛형 박스 연속 누적 (빗나가면 리셋)
}

export const EMPTY_DRIVING: DrivingState = { lastNow: null, speedMs: 0, bonnetMs: 0 };

export interface DrivingInput {
  now: number; // ms
  speedMps: number | null; // null = 값 없음 (무시)
  bonnet: boolean; // 보닛형 차량 박스 존재
}

export function drivingTick(
  state: DrivingState,
  input: DrivingInput
): { driving: boolean; state: DrivingState } {
  const now = input.now;
  const dt = state.lastNow === null ? 0 : Math.max(0, now - state.lastNow);
  let speedMs = state.speedMs;
  const sp = input.speedMps;
  if (sp === null || sp === undefined || !Number.isFinite(sp)) {
    // 값 없음: 무시 (누적 유지·리셋 없음)
  } else if (sp >= DRIVING_SPEED_MPS) {
    speedMs += dt;
  } else {
    speedMs = 0;
  }
  // BT-2b: 걷는 속도면 차량 박스와 무관히 운전 아님.
  if (sp !== null && sp !== undefined && Number.isFinite(sp) && sp < DRIVING_WALK_MPS) {
    return { driving: false, state: { lastNow: now, speedMs: 0, bonnetMs: 0 } };
  }
  const bonnetMs = input.bonnet ? state.bonnetMs + dt : 0; // 빗나감 1틱이면 리셋
  const driving = speedMs >= DRIVING_SPEED_HOLD_MS || bonnetMs >= DRIVING_BONNET_HOLD_MS;
  return { driving, state: { lastNow: now, speedMs, bonnetMs } };
}
