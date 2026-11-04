// lib/levelup.ts — LV-2: 하이브리드 성장 (순수, 클라이언트 안전).
// 1층 규칙(항상): recommendedBoosts + 활동 보정. 2층 AI(선택): 보정 가중치만 조정.
// 상대 import만 쓴다 (verify-levelup.mjs 독립 tsc 컴파일).
import { recommendedBoosts, type Boosts, type Role } from "./battle/roster";

export const LV2_CORRECTION_PER_LEVEL = 2; // 활동 보정 레벨당 최대 +2점
export const LV2_AI_TIMEOUT_MS = 10000; // LV-2 후속: 3초→10초 (규칙 즉시 적용 뒤 비동기라 화면 안 막힘)
export const LV2_MODEL = "muse-spark-1.3";
// "많이" 기준 (초기 조정값, 한 곳에서 관리).
export const LV2_WALK_M = 300;
export const LV2_SCANS = 5;
export const LV2_DANCES = 3;

export interface Activity {
  walkM: number;
  scans: number;
  dances: number;
}

export const NO_ACTIVITY: Activity = { walkM: 0, scans: 0, dances: 0 };

// 활동 보정 (포인트 단위, hp도 포인트). 우세 1종에 풀 몰아주기, 동점은 걷기>스캔>춤.
export function activityCorrection(a: Activity, level: number): Boosts {
  const zero = { atk: 0, hp: 0, def: 0, spd: 0 };
  const pool = Math.max(0, (Math.max(1, Math.floor(level)) - 1) * LV2_CORRECTION_PER_LEVEL);
  if (pool <= 0) return zero;
  const w = (a.walkM || 0) / LV2_WALK_M;
  const s = (a.scans || 0) / LV2_SCANS;
  const d = (a.dances || 0) / LV2_DANCES;
  const best = Math.max(w, s, d);
  if (!Number.isFinite(best) || best < 1) return zero;
  if (w >= s && w >= d) return { ...zero, spd: pool };
  if (s >= d) return { ...zero, hp: pool };
  return { ...zero, atk: pool };
}

// 규칙 최종 (역할 배분 + 활동 보정). boosts.hp는 HP 단위(×5, recommendedBoosts와 동일).
export function ruleBoosts(role: Role, level: number, a: Activity): Boosts {
  const rec = recommendedBoosts(role, level);
  const c = activityCorrection(a, level);
  return { atk: rec.atk + c.atk, hp: rec.hp + c.hp * 5, def: rec.def + c.def, spd: rec.spd + c.spd };
}

// AI 보정 검증 (포인트 단위). 합계 초과·음수·비수치면 null → 규칙 값으로 복귀.
export function validateAiCorrection(v: unknown, level: number): Boosts | null {
  const pool = Math.max(0, (Math.max(1, Math.floor(level)) - 1) * LV2_CORRECTION_PER_LEVEL);
  const r = (v ?? {}) as Partial<Record<keyof Boosts, unknown>>;
  const out = {} as Boosts;
  let sum = 0;
  for (const k of ["atk", "hp", "def", "spd"] as const) {
    const n = r[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
    const f = Math.floor(n);
    out[k] = f;
    sum += f;
  }
  if (sum > pool) return null;
  return out;
}

export const LV2_MSG_WALK = "오늘 많이 걸었더니 발이 빨라졌어";
export const LV2_MSG_SCAN = "많이 탐색했더니 튼튼해졌어";
export const LV2_MSG_DANCE = "신나게 췄더니 힘이 넘쳐";
export const LV2_MSG_NONE = "쑥쑥 자랐어";

export function defaultMessage(a: Activity): string {
  const w = (a.walkM || 0) / LV2_WALK_M;
  const s = (a.scans || 0) / LV2_SCANS;
  const d = (a.dances || 0) / LV2_DANCES;
  const best = Math.max(w, s, d);
  if (!Number.isFinite(best) || best < 1) return LV2_MSG_NONE;
  if (w >= s && w >= d) return LV2_MSG_WALK;
  if (s >= d) return LV2_MSG_SCAN;
  return LV2_MSG_DANCE;
}

const STAT_KO: Array<[keyof Boosts, string]> = [["atk", "공격"], ["hp", "체력"], ["def", "방어"], ["spd", "속도"]];

// "레벨 N! 속도 +2, 체력 +3" (증가분만, 공격·체력·방어·속도 순).
export function formatToast(level: number, delta: Boosts): string {
  const parts: string[] = [];
  for (const [k, ko] of STAT_KO) {
    const v = delta[k] ?? 0;
    if (v > 0) parts.push(`${ko} +${v}`);
  }
  if (parts.length === 0) return `레벨 ${level}! 쑥쑥 자랐어`;
  return `레벨 ${level}! ${parts.join(", ")}`;
}

// 토스트 한 줄: 증가분 + AI/기본 문구 ("레벨 5! 속도 +8 · 오늘 많이 걸었더니 발이 빨라졌어").
export function levelupLine(level: number, delta: Boosts, message: string): string {
  const parts: string[] = [];
  for (const [k, ko] of STAT_KO) {
    const v = delta[k] ?? 0;
    if (v > 0) parts.push(`${ko} +${v}`);
  }
  const head = parts.length > 0 ? `레벨 ${level}! ${parts.join(", ")}` : `레벨 ${level}!`;
  const msg = (message ?? "").trim().slice(0, 50);
  return msg ? `${head} · ${msg}` : head;
}

export interface LevelupInput {
  role: Role;
  level: number;
  activity: Activity;
}

export interface LevelupResult {
  boosts: Boosts;
  message: string;
  source: "rule" | "ai";
  reason?: string;
}

// 규칙 + AI 조율. aiCall 주입 (서버=실호출, 테스트=모킹). 실패·초과·불량이면 규칙 값.
export async function resolveLevelup(
  input: LevelupInput,
  aiCall: () => Promise<unknown>,
  timeoutMs: number = LV2_AI_TIMEOUT_MS
): Promise<LevelupResult> {
  const rules = ruleBoosts(input.role, input.level, input.activity);
  const fallback: LevelupResult = { boosts: rules, message: defaultMessage(input.activity), source: "rule" };
  let raw: unknown;
  try {
    raw = await Promise.race([
      aiCall(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ai-timeout")), timeoutMs)),
    ]);
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    return { ...fallback, reason: m === "no-key" || m === "ai-timeout" ? m : "error" };
  }
  const corr = validateAiCorrection((raw as { correction?: unknown } | null)?.correction, input.level);
  if (!corr) return { ...fallback, reason: "invalid" };
  const rec = recommendedBoosts(input.role, input.level);
  const msg = (raw as { message?: unknown })?.message;
  const message = typeof msg === "string" && msg.trim() ? msg.trim().slice(0, 50) : fallback.message;
  return {
    boosts: { atk: rec.atk + corr.atk, hp: rec.hp + corr.hp * 5, def: rec.def + corr.def, spd: rec.spd + corr.spd },
    message,
    source: "ai",
  };
}
