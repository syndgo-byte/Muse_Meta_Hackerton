// lib/external/stats.ts — EX-3: 외부 호출 메모리 카운터 (서버 전용).
// 호출 횟수·대체 횟수·마지막 지연을 호출 지점에서 기록한다. 값은 절대 담지 않는다.

export type ExternalCallResult = "ok" | "failed";

export type ExternalStatRow = {
  calls: number;
  fallbacks: number;
  lastLatencyMs: number | null;
  lastResult: ExternalCallResult | null;
  lastAt: number;
};

const rows = new Map<string, ExternalStatRow>();

function row(id: string): ExternalStatRow {
  let r = rows.get(id);
  if (!r) {
    r = { calls: 0, fallbacks: 0, lastLatencyMs: null, lastResult: null, lastAt: 0 };
    rows.set(id, r);
  }
  return r;
}

export function recordExternal(id: string, ok: boolean, latencyMs: number): void {
  const r = row(id);
  r.calls += 1;
  if (!ok) r.fallbacks += 1;
  r.lastLatencyMs = Math.round(latencyMs);
  r.lastResult = ok ? "ok" : "failed";
  r.lastAt = Date.now();
}

export function getExternalStats(): Record<string, ExternalStatRow> {
  return Object.fromEntries(rows);
}

export function resetExternalStats(): void {
  rows.clear();
}
