// lib/battle/capture.ts — G4 포획·놓아주기 순수 로직 (BATTLE_DESIGN §16).
// 의존성 없음. 셔터 틀 판정은 화면 쪽, 주사위·보상은 여기.

export const CAPTURE_BASE_RATE = 0.25;
export const CAPTURE_HP_FACTOR = 0.5;
export const CAPTURE_FULLNESS_BONUS = 0.1;
export const CAPTURE_FULLNESS_LINE = 70;
export const CAPTURE_MIN_RATE = 0.25;
export const CAPTURE_MAX_RATE = 0.85;
export const CAPTURE_ATTEMPTS = 3;
export const CAPTURE_EXP = 20;
export const RELEASE_EXP = 40;

// 포획률 = 0.25 + (1 − 야생HP비율) × 0.5 (+포만감 보너스). 범위 0.25~0.85.
export function captureRate(wildHpRatio: number, fullness: number): number {
  const r = Math.max(0, Math.min(1, wildHpRatio));
  const f = Math.max(0, Math.min(100, fullness));
  let rate = CAPTURE_BASE_RATE + (1 - r) * CAPTURE_HP_FACTOR;
  if (f >= CAPTURE_FULLNESS_LINE) rate += CAPTURE_FULLNESS_BONUS;
  return Math.max(CAPTURE_MIN_RATE, Math.min(CAPTURE_MAX_RATE, rate));
}

export interface CaptureAttempt {
  inFrame: boolean; // 틀 안 = 후보, 틀 밖 = 주사위 없이 실패
  roll: number; // 0~1, rate보다 작으면 성공
}

export interface CaptureResult {
  caught: boolean;
  used: number; // 쓴 시도 수
  fled: boolean; // 3회 모두 실패 → 이탈
}

// 최대 3회. 한 번에 하나씩 판정한다.
export function resolveCapture(rate: number, attempts: CaptureAttempt[]): CaptureResult {
  const max = Math.min(CAPTURE_ATTEMPTS, attempts.length);
  for (let i = 0; i < max; i++) {
    const a = attempts[i];
    if (a.inFrame && a.roll >= 0 && a.roll < rate) {
      return { caught: true, used: i + 1, fled: false };
    }
  }
  const used = Math.min(CAPTURE_ATTEMPTS, Math.max(attempts.length, 0));
  return { caught: false, used, fled: used >= CAPTURE_ATTEMPTS };
}

export interface CaptureReward {
  exp: number;
  dexAdd: string | null; // 도감 등록 종 (성공만)
}

export function captureReward(speciesId: string, caught: boolean): CaptureReward {
  return caught ? { exp: CAPTURE_EXP, dexAdd: speciesId } : { exp: 0, dexAdd: null };
}

export function releaseReward(): CaptureReward {
  return { exp: RELEASE_EXP, dexAdd: null };
}
