// 토큰 원장 클라이언트 헬퍼. 잔량의 원본은 서버 원장이며,
// 이 모듈은 조회·적립·차감 API를 호출할 뿐 브라우저에 잔액을 두지 않는다.
import { AI_CALL_COSTS, type AiCallKind } from "./config";

export const INSUFFICIENT_MSG = "뮤즈 AI 토큰이 부족합니다. 특정 행동을 하면 충전됩니다.";

// 토큰 부족 메시지 (7-3 항목 7). 행동 이름·필요량·잔량을 반드시 밝힌다.
// 예: insufficientMsg("스탯 강화", 300, 150)
//   → "스탯 강화에 토큰 300이 필요합니다 (현재 150)."
// INSUFFICIENT_MSG 공용 문구를 인자 없이 쓰지 않는다.
export function insufficientMsg(action: string, cost: number, balance: number): string {
  return `${action}에 토큰 ${cost}이 필요합니다 (현재 ${balance}).`;
}

export async function fetchBalance(): Promise<number> {
  const res = await fetch("/api/token/balance", { cache: "no-store" });
  if (!res.ok) throw new Error(`balance ${res.status}`);
  const data = (await res.json()) as { balance?: unknown };
  if (typeof data.balance !== "number") throw new Error("balance invalid");
  return data.balance;
}

export type HistoryEntry = {
  id: string;
  type: "credit" | "spend";
  amount: number;
  reason: string;
  signalId?: string;
  ts: number;
};

export async function fetchHistory(limit: number): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/token/history?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`history ${res.status}`);
  const data = (await res.json()) as { entries?: unknown };
  if (!Array.isArray(data.entries)) throw new Error("history invalid");
  return data.entries as HistoryEntry[];
}

export type SpendOutcome = { ok: true; balance: number } | { ok: false; balance: number };

export async function spendRemote(amount: number, reason: string): Promise<SpendOutcome> {
  const res = await fetch("/api/token/spend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, reason }),
  });
  const data = (await res.json().catch(() => ({}))) as { balance?: unknown };
  const balance = typeof data.balance === "number" ? data.balance : NaN;
  if (res.status === 409) return { ok: false, balance };
  if (!res.ok) throw new Error(`spend ${res.status}`);
  return { ok: true, balance };
}

// AI 호출 과금. 잔량 부족·네트워크 실패에도 데모는 차단하지 않고
// 현재 잔액을 그대로 반환한다 (무료 통과).
export async function meterRemote(kind: AiCallKind, fallback: number): Promise<number> {
  try {
    const out = await spendRemote(AI_CALL_COSTS[kind], `ai:${kind}`);
    return Number.isFinite(out.balance) ? out.balance : fallback;
  } catch {
    try {
      return await fetchBalance();
    } catch {
      return fallback;
    }
  }
}

export type CareAction = "feed" | "play" | "sleep";
export type CareUse =
  | { ok: true; free: boolean; remainingFree: number; balance: number }
  | { ok: false; balance: number };

export async function useCareRemote(action: CareAction): Promise<CareUse> {
  const res = await fetch("/api/token/care", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    free?: unknown;
    remainingFree?: unknown;
    balance?: unknown;
  };
  const balance = typeof data.balance === "number" ? data.balance : NaN;
  if (res.status === 409) return { ok: false, balance };
  if (!res.ok) throw new Error(`care ${res.status}`);
  return {
    ok: true,
    free: data.free === true,
    remainingFree: typeof data.remainingFree === "number" ? data.remainingFree : 0,
    balance,
  };
}

export async function fetchCareStatus(): Promise<{
  remaining: Record<CareAction, number>;
  balance: number;
}> {
  const res = await fetch("/api/token/care", { cache: "no-store" });
  if (!res.ok) throw new Error(`care-status ${res.status}`);
  const data = (await res.json()) as { remaining?: unknown; balance?: unknown };
  const r = data.remaining as Record<string, unknown> | undefined;
  if (
    !r ||
    typeof r.feed !== "number" ||
    typeof r.play !== "number" ||
    typeof r.sleep !== "number" ||
    typeof data.balance !== "number"
  ) {
    throw new Error("care-status invalid");
  }
  return { remaining: { feed: r.feed, play: r.play, sleep: r.sleep }, balance: data.balance };
}

export type CreditSignalInput = {
  signalId: string;
  storeName: string;
  category: string;
  amountKrw: number;
  // D4-3: 체력 회복용 최대치 계산 컨텍스트 (없으면 fire-01·저장 레벨).
  mineId?: string;
  mineLevel?: number;
};

export async function creditSignalRemote(
  input: CreditSignalInput
): Promise<{ tokens: number; balance: number; duplicate: boolean }> {
  const res = await fetch("/api/token/credit-signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as {
    tokens?: unknown;
    balance?: unknown;
    duplicate?: unknown;
    error?: unknown;
  };
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `credit ${res.status}`);
  if (typeof data.tokens !== "number" || typeof data.balance !== "number") {
    throw new Error("credit invalid");
  }
  return { tokens: data.tokens, balance: data.balance, duplicate: data.duplicate === true };
}
