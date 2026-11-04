// 조우 상수 한 곳 (BATTLE_DESIGN §15-1a). 판정은 decide.ts 순수 함수.
export const ENCOUNTER_BASE_RATE = 0.6;
export const ENCOUNTER_PITY_STEP = 0.2;
export const ENCOUNTER_COOLDOWN_MS = 3 * 60 * 1000;
export const ENCOUNTER_SPECIES_COOLDOWN_MS = 10 * 60 * 1000;
export const ENCOUNTER_DAILY_MAX = 8;
export const ENCOUNTER_CAUGHT_EXP = 10;
export const ENCOUNTER_CAUGHT_EXP_PER_DAY = 3;
export const ENCOUNTER_MIN_CONFIDENCE = 60;

export const HINT_IDLE_MS = 60 * 1000;
export const HINT_GAP_MS = 180 * 1000; // 7-A 2차: 90초 → 180초
export const HINT_MISS_STREAK = 3;

export const MSG_NO_MATCH = "아직 발견되지 않은 사물이에요";
export const MSG_LOW_CONFIDENCE = "잘 안 보여요. 조금 더 가까이 비춰 주세요";
export const MSG_COOLDOWN = "기척이 잠시 사라졌어요";
export const MSG_DAILY_DONE = "오늘은 야생이 모두 잠들었어요";
export const MSG_EXP_CAPPED = "오늘은 충분히 놀았어요";
export const MSG_FAINTED = "기절 상태라 야생을 만날 수 없어요";
export const MSG_CAUGHT = "도감에 이미 있어요";
