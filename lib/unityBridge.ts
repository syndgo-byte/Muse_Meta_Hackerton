// 웹 → Unity 세이브 이식 브리지.
// exportSaveForUnity() 결과를 Unity Application.persistentDataPath/oishie_save.json으로
// 복사 후 StorageKeys.ImportSave(json) 호출. 키 규격은 ARCHITECTURE §3.1.
"use client";

const KEYS = [
  "snapquest-status",
  "snapquest-seen",
  "oishie-account",
  "oishie-tokens",
  "oishie-walk-claim",
  "snapquest-walk",
  "oishie-stat-boosts",
  "snapquest-quest",
  "snapquest-dex",
  "snapquest_active_partner",
  "oishie-ar-mode",
  "oishie-diary",
] as const;

export type UnitySaveExport = {
  status: string | null;
  seen: string[];
  account: string | null;
  tokens: string | null;
  walkClaim: string | null;
  walk: string | null;
  boosts: string | null;
  quest: string | null;
  dex: string | null;
  partner: string | null;
  arMode: string | null;
  diary: string | null;
};

export function exportSaveForUnity(): string {
  const get = (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  let seen: string[] = [];
  try {
    seen = JSON.parse(get("snapquest-seen") ?? "[]") as string[];
  } catch {
    seen = [];
  }
  const out: UnitySaveExport = {
    status: get("snapquest-status"),
    seen,
    account: get("oishie-account"),
    tokens: get("oishie-tokens"),
    walkClaim: get("oishie-walk-claim"),
    walk: get("snapquest-walk"),
    boosts: get("oishie-stat-boosts"),
    quest: get("snapquest-quest"),
    dex: get("snapquest-dex"),
    partner: get("snapquest_active_partner") ?? get("oishie-partner"),
    arMode: get("oishie-ar-mode"),
    diary: get("oishie-diary"),
  };
  return JSON.stringify(out);
}

export function downloadSaveForUnity() {
  const blob = new Blob([exportSaveForUnity()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "oishie_save.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// dev 확인용: 로컬 키 존재 여부만 점검 (값 노출 없음).
export function checkUnityExportKeys(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of KEYS) {
    try {
      out[k] = localStorage.getItem(k) != null;
    } catch {
      out[k] = false;
    }
  }
  return out;
}
