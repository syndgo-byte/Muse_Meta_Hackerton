// 조우 판정 순수 함수 (BATTLE_DESIGN §15-1a). 상태는 호출자가 들고 다니고,
// 서버 저장은 store.ts가 한다. 클라이언트 안전 (Node import 없음).
import {
  ENCOUNTER_BASE_RATE,
  ENCOUNTER_CAUGHT_EXP,
  ENCOUNTER_CAUGHT_EXP_PER_DAY,
  ENCOUNTER_COOLDOWN_MS,
  ENCOUNTER_DAILY_MAX,
  ENCOUNTER_PITY_STEP,
  ENCOUNTER_SPECIES_COOLDOWN_MS,
  MSG_CAUGHT,
  MSG_COOLDOWN,
  MSG_DAILY_DONE,
  MSG_EXP_CAPPED,
  MSG_FAINTED,
} from "./config";

export interface EncounterState {
  pity: number;
  lastEncounterAt: number; // ms, 0 = 없음
  speciesCooldownUntil: Record<string, number>;
  day: string; // KST 05:00 경계
  todayCount: number;
  expDay: string;
  expCounts: Record<string, number>;
}

export const EMPTY_ENCOUNTER_STATE: EncounterState = {
  pity: 0,
  lastEncounterAt: 0,
  speciesCooldownUntil: {},
  day: "",
  todayCount: 0,
  expDay: "",
  expCounts: {},
};

// 05:00 KST 경계 날짜 (CREATURE_STATUS §2-2와 같은 규칙).
export function kstDayKey(nowMs: number): string {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const d = hour < 5 ? new Date(kst.getTime() - 24 * 60 * 60 * 1000) : kst;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export interface DecideInput {
  speciesId: string | null; // matchLabel 결과 (null = 표에 없음)
  caughtIds: string[];
  fainted: boolean;
  demo?: boolean;
  now: number; // ms
  roll: number; // 0~1
  state: EncounterState;
}

export type DecideResult =
  | { kind: "encounter"; speciesId: string; state: EncounterState }
  | { kind: "exp"; speciesId: string; exp: number; message: string; state: EncounterState }
  | { kind: "none"; reason: "no-match" | "fainted" | "cooldown" | "species-cooldown" | "daily" | "exp-capped"; message: string; state: EncounterState };

function cloneState(s: EncounterState): EncounterState {
  return {
    ...s,
    speciesCooldownUntil: { ...s.speciesCooldownUntil },
    expCounts: { ...s.expCounts },
  };
}

export function decideEncounter(input: DecideInput): DecideResult {
  const { speciesId, caughtIds, fainted, demo, now, roll } = input;
  const st = cloneState(input.state);
  const day = kstDayKey(now);
  if (st.day !== day) {
    st.day = day;
    st.todayCount = 0;
  }
  if (st.expDay !== day) {
    st.expDay = day;
    st.expCounts = {};
  }

  if (speciesId === null) {
    return { kind: "none", reason: "no-match", message: "", state: st };
  }
  // 기절: 어떤 상호작용도 없이 끝. pity·횟수 소모 없음.
  if (fainted) {
    return { kind: "none", reason: "fainted", message: MSG_FAINTED, state: st };
  }
  // 이미 포획: 조우 없음, EXP +10 (종당 하루 3회).
  if (caughtIds.includes(speciesId)) {
    const used = st.expCounts[speciesId] ?? 0;
    if (used >= ENCOUNTER_CAUGHT_EXP_PER_DAY) {
      return { kind: "none", reason: "exp-capped", message: MSG_EXP_CAPPED, state: st };
    }
    st.expCounts[speciesId] = used + 1;
    return { kind: "exp", speciesId, exp: ENCOUNTER_CAUGHT_EXP, message: MSG_CAUGHT, state: st };
  }
  if (!demo) {
    if (st.lastEncounterAt > 0 && now - st.lastEncounterAt < ENCOUNTER_COOLDOWN_MS) {
      return { kind: "none", reason: "cooldown", message: MSG_COOLDOWN, state: st };
    }
    const until = st.speciesCooldownUntil[speciesId] ?? 0;
    if (now < until) {
      return { kind: "none", reason: "species-cooldown", message: MSG_COOLDOWN, state: st };
    }
  }
  if (st.todayCount >= ENCOUNTER_DAILY_MAX) {
    return { kind: "none", reason: "daily", message: MSG_DAILY_DONE, state: st };
  }
  const p = demo ? 1 : Math.min(1, ENCOUNTER_BASE_RATE + ENCOUNTER_PITY_STEP * st.pity);
  if (roll < p) {
    st.pity = 0;
    st.todayCount += 1;
    st.lastEncounterAt = now;
    return { kind: "encounter", speciesId, state: st };
  }
  if (!demo) st.pity += 1;
  return { kind: "none", reason: "no-match", message: "", state: st };
}

// 조우 종료 기록: 전체 쿨다운은 항상, 종 쿨다운은 패배·도주만.
export function recordEncounterEnd(
  state: EncounterState,
  speciesId: string,
  result: "win" | "lose" | "flee",
  now: number
): EncounterState {
  const st = cloneState(state);
  st.lastEncounterAt = now;
  if (result === "lose" || result === "flee") {
    st.speciesCooldownUntil[speciesId] = now + ENCOUNTER_SPECIES_COOLDOWN_MS;
  }
  return st;
}
