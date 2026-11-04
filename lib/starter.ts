// lib/starter.ts — ST-1: 첫 실행 스타터 지급 (클라이언트 전용, 멱등).
// dex 항목 모양은 실전 포획 저장과 동일: 배틀 포획 {id,name} + camp 선정 {id,name,image}.
// STARTER_ID는 lib/slots.ts DEFAULT_PARTNER와 같은 값 (순환 참조 방지 분리, verify-starter가 일치 검증).
import { ROSTER } from "./species";

export const STARTER_ID = "fire-01";

const DEX_KEY = "snapquest-dex";
const SEEN_KEY = "snapquest-seen";
const PARTNER_KEY = "snapquest_active_partner";

/** 빈 저장소면 스타터 모카퐁 지급. 데이터가 있으면 손대지 않는다. 여러 번 호출해도 결과 동일. */
export function ensureStarter(): void {
  try {
    if (typeof localStorage === "undefined") return;
    let dex: unknown;
    try {
      dex = JSON.parse(localStorage.getItem(DEX_KEY) ?? "[]");
    } catch {
      dex = [];
    }
    // 기존 유저 데이터 보존: dex에 항목이 있으면 아무것도 안 한다.
    if (Array.isArray(dex) && dex.length > 0) return;
    const sp = ROSTER.find((s) => s.id === STARTER_ID);
    const entry = {
      id: STARTER_ID,
      name: sp?.name ?? "모카퐁",
      element: sp?.element ?? "fire",
      ...(sp?.image ? { image: sp.image } : {}),
    };
    localStorage.setItem(DEX_KEY, JSON.stringify([entry]));
    let seen: unknown;
    try {
      seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    } catch {
      seen = [];
    }
    const arr = Array.isArray(seen) ? (seen as string[]) : [];
    if (!arr.includes(STARTER_ID)) {
      arr.push(STARTER_ID);
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr.slice(-100)));
    }
    if (!localStorage.getItem(PARTNER_KEY)) {
      localStorage.setItem(PARTNER_KEY, STARTER_ID);
    }
    // PC-1: 스타터 성장값을 Lv.1 기본으로 서버에 생성 (지급 시 1회, 실패 무시).
    try {
      void fetch("/api/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speciesId: STARTER_ID }),
      }).catch(() => {});
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
}
