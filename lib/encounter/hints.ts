// 힌트 선택 순수 함수 (BATTLE_DESIGN §15-1a 힌트 노출). 클라이언트 안전.
import { HINT_GAP_MS, HINT_IDLE_MS, HINT_MISS_STREAK } from "./config";
import { ENCOUNTER_TABLE, type Env } from "./table";

export interface HintPick {
  speciesId: string;
  hint: string;
  hintEn: string;
}

export function hintFor(speciesId: string): string {
  return ENCOUNTER_TABLE.find((r) => r.speciesId === speciesId)?.hint ?? "";
}

export function hintEnFor(speciesId: string): string {
  return ENCOUNTER_TABLE.find((r) => r.speciesId === speciesId)?.hintEn ?? "";
}

// 미포획 종: 현재 env와 맞는 것만 고른다 (7-A: 다른 env 종을 섞지 않음).
// 해당 env 미포획이 없으면 null. offset으로 순환.
export function pickUncaught(caughtIds: string[], env: Env, offset = 0): HintPick | null {
  const pool = ENCOUNTER_TABLE.filter(
    (r) => r.env === env && !caughtIds.includes(r.speciesId),
  );
  if (pool.length === 0) return null;
  const row = pool[offset % pool.length];
  return { speciesId: row.speciesId, hint: row.hint, hintEn: row.hintEn };
}

// AR 타이머 힌트: 스캔 없이 60초, 다음 힌트까지 최소 90초.
export function pickTimedHint(input: {
  caughtIds: string[];
  env: Env;
  idleMs: number;
  sinceLastHintMs: number | null; // null = 아직 힌트 없음
  offset?: number;
}): HintPick | null {
  if (input.idleMs < HINT_IDLE_MS) return null;
  if (input.sinceLastHintMs !== null && input.sinceLastHintMs < HINT_GAP_MS) return null;
  return pickUncaught(input.caughtIds, input.env, input.offset ?? 0);
}

// 표에 없는 사물 연속 3번 → 즉시 힌트.
export function pickMissHint(input: {
  consecutiveMisses: number;
  caughtIds: string[];
  env: Env;
  offset?: number;
}): HintPick | null {
  if (input.consecutiveMisses < HINT_MISS_STREAK) return null;
  return pickUncaught(input.caughtIds, input.env, input.offset ?? 0);
}
