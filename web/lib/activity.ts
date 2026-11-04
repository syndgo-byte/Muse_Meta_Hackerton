// LV-2 활동 기록 (로컬). 걷기는 lib/walk.ts 총거리, 스캔·춤은 카운터.
import { loadWalkM } from "./walk";
import type { Activity } from "./levelup";

const KEY = "oishie-activity";

export function loadActivityCounts(): { scans: number; dances: number } {
  try {
    const raw = localStorage.getItem(KEY);
    const v = (raw ? JSON.parse(raw) : {}) as { scans?: unknown; dances?: unknown };
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);
    return { scans: num(v.scans), dances: num(v.dances) };
  } catch {
    return { scans: 0, dances: 0 };
  }
}

export function loadActivity(): Activity {
  const c = loadActivityCounts();
  return { walkM: loadWalkM(), scans: c.scans, dances: c.dances };
}

function saveActivityCounts(c: { scans: number; dances: number }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function recordActivityScan(): void {
  const c = loadActivityCounts();
  saveActivityCounts({ ...c, scans: c.scans + 1 });
}

// 춤 재생 이벤트 연동 시 호출 (CLI 2 춤 도메인에서 호출 지점 확정 필요).
export function recordActivityDance(): void {
  const c = loadActivityCounts();
  saveActivityCounts({ ...c, dances: c.dances + 1 });
}

/** 같은 춤 연타 기록 방지 간격(ms). */
export const DANCE_RECORD_WINDOW_MS = 3000;

/**
 * 춤 종료 기록 여부 (순수 함수). 테스트 춤·포즈(null)는 제외하고,
 * 같은 춤이 윈도우 안에 또 끝나면 중복으로 본다.
 */
export function shouldRecordDanceEnd(
  id: string | null,
  lastId: string,
  lastAt: number,
  now: number
): boolean {
  if (!id || id === "test") return false;
  return id !== lastId || now - lastAt > DANCE_RECORD_WINDOW_MS;
}
