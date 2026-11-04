// D4-3 수치 감소·회복·기절·05시 리셋 (CREATURE_STATUS §2-2·§2-3).
// 상수는 이 파일에 모은다 (D6). 순수 함수만 둔다 (독립 tsc 컴파일, @/·node: import 없음).
// 원칙: 앱을 켜 둔 시간만큼만 줄어든다. 타이머로 깎지 않고 접속(tick) 때 경과분을 계산한다.

// 접속 중 감소율 (/시간).
export const DECAY_FULLNESS_PER_HOUR = 4;
export const DECAY_ENERGY_PER_HOUR = 5;
// 하트비트 간격. 이 간격으로 lastTickAt을 저장한다.
export const TICK_INTERVAL_MS = 60_000;
// 공백이 이 이상이면 접속하지 않은 것으로 보고 줄이지 않는다.
export const AWAY_GAP_MS = 120_000;
// 친밀도: 마지막 교감 후 이 시간이 지나면 하루 1회 -10 (05시 경계 기준).
export const AFFECTION_CUT_AFTER_MS = 24 * 3600_000;
export const AFFECTION_CUT_AMOUNT = 10;
// 일일 경계: 매일 05:00 (Asia/Seoul).
export const RESET_HOUR_KST = 5;
// 체력 0 (기절) 메시지 한 줄.
export const FAINTED_MESSAGE = "기절했어요. 제휴처를 들르면 깨어납니다.";

export type TickState = {
  fullness: number;
  energy: number;
  affection: number;
  xp: number;
  level: number;
  hp?: number;
  // 0/""은 채택 마커: 기존 파일에 없던 값은 처벌 없이 현재로 채운다.
  lastTickAt: number;
  lastCareAt: number;
  lastResetDay: string;
};

// 05시 경계 날짜 (YYYY-MM-DD). 05:00 이전은 전날로 친다.
export function kstDay5am(ms: number): string {
  const kst = new Date(ms + 9 * 3600_000);
  const shifted = new Date(kst.getTime() - RESET_HOUR_KST * 3600_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 저장 정밀도: 반올림하지 않는다 (tick마다 반올림하면 오차가 쌓인다). 표시는 화면에서 반올림.
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

export function isFainted(hp: number | undefined): boolean {
  return hp !== undefined && hp <= 0;
}

// 접속 1회분 적용: 05시 리셋 → 친밀도 절감 → 접속중 감소 순. tick마다 최대 1회씩.
// hp는 건드리지 않는다 (배틀 피해·충전 회복 경로만 바꾼다).
export function applyTick(prev: TickState, nowMs: number): TickState {
  const s: TickState = { ...prev };
  const today = kstDay5am(nowMs);
  // 05시 리셋: 경계를 넘었고 lastResetDay와 다르면 포만감·활력만 100으로. 친밀도 제외.
  if (!s.lastResetDay) {
    s.lastResetDay = today;
  } else if (s.lastResetDay !== today) {
    s.fullness = 100;
    s.energy = 100;
    s.lastResetDay = today;
  }
  // 친밀도: 마지막 교감 후 24시간 + 05시 경계를 넘었으면 -10. 자른 뒤 시계를 현재로 둔다.
  if (!s.lastCareAt || s.lastCareAt <= 0) {
    s.lastCareAt = nowMs;
  } else if (
    nowMs - s.lastCareAt >= AFFECTION_CUT_AFTER_MS &&
    kstDay5am(nowMs) !== kstDay5am(s.lastCareAt)
  ) {
    s.affection = Math.max(0, s.affection - AFFECTION_CUT_AMOUNT);
    s.lastCareAt = nowMs;
  }
  // 접속중 감소: 공백 2분 이상이면 줄이지 않는다.
  if (!s.lastTickAt || s.lastTickAt <= 0) {
    s.lastTickAt = nowMs;
  } else {
    const gap = nowMs - s.lastTickAt;
    if (gap > 0 && gap < AWAY_GAP_MS) {
      const hours = gap / 3600_000;
      s.fullness = clamp100(s.fullness - DECAY_FULLNESS_PER_HOUR * hours);
      s.energy = clamp100(s.energy - DECAY_ENERGY_PER_HOUR * hours);
    }
    s.lastTickAt = nowMs;
  }
  return s;
}
