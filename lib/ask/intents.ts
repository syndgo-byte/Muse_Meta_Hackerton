// lib/ask/intents.ts — VA-1: intent 상수·검증·빠른길 (순수, 클라이언트 안전).
// 상대 import 금지(verify 독립 컴파일). 음성 문장 전체를 로그에 남기지 않는다.
export const ASK_ENABLED = true;

export const INTENTS = [
  "skill",
  "battle_start",
  "flee",
  "capture",
  "care",
  "ask_token_spots",
  "ask_hip_spots",
  "chat",
  "unknown",
] as const;
export type Intent = (typeof INTENTS)[number];

export const ASK_SKILL_TYPES = ["attack", "ranged", "buff", "debuff"] as const;
export type AskSkillType = (typeof ASK_SKILL_TYPES)[number];

// 슬롯→타입: 0 몸통박치기(attack), 1 속성기(ranged), 2·3은 moveKind 기준.
export function askSkillType(slot: number, kind: "ATK" | "BUFF" | "DEBUFF"): AskSkillType {
  if (slot === 0) return "attack";
  if (slot === 1) return "ranged";
  if (kind === "BUFF") return "buff";
  if (kind === "DEBUFF") return "debuff";
  return "ranged";
}

export type SkillArgs = { by: "slot"; slot: number } | { by: "type"; type: AskSkillType } | { by: "name"; name: string };
export type CareArgs = { kind: "feed" | "praise" | "sleep" | "play" };
export type HipArgs = { platform: "instagram" | "youtube" | "any"; places: string[] };
export type TokenArgs = { places: string[] };
export type AskArgs = SkillArgs | CareArgs | HipArgs | TokenArgs | Record<string, never>;

export type AskResult = { intent: Intent; args: AskArgs; reply: string };

export const ASK_UNKNOWN: AskResult = { intent: "unknown", args: {}, reply: "" };

// reply 2문장 이하·200자 정리 (길면 자름, 구조가 아니면 null).
export function twoSentences(reply: unknown): string | null {
  if (typeof reply !== "string") return null;
  const t = reply.trim();
  if (!t) return null;
  const parts = t.match(/[^.?!。！？\n]+[.?!。！？]?/g) ?? [t];
  return parts.slice(0, 2).join("").trim().slice(0, 200);
}

// AI가 고른 장소 이름 ⊆ 서버가 준 목록 (exact, trim). 지어낸 이름 제거.
export function filterPlaces(names: unknown, allowed: string[]): string[] {
  if (!Array.isArray(names)) return [];
  const set = new Set(allowed.map((a) => a.trim()));
  const out: string[] = [];
  for (const n of names) {
    if (typeof n !== "string") continue;
    const t = n.trim();
    if (t && set.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

// 서버 스키마 검증. 실패하면 null → 호출자가 unknown으로.
export function validateAskJson(raw: unknown): AskResult | null {
  const o = asRecord(raw);
  if (!o || typeof o.intent !== "string") return null;
  if (!(INTENTS as readonly string[]).includes(o.intent)) return null;
  const intent = o.intent as Intent;
  const reply = twoSentences(o.reply);
  if (reply === null) return null;
  const a = asRecord(o.args) ?? {};
  switch (intent) {
    case "skill": {
      const by = a.by;
      if (by === "slot" && typeof a.slot === "number" && Number.isInteger(a.slot) && a.slot >= 0 && a.slot <= 3) {
        return { intent, args: { by: "slot", slot: a.slot }, reply };
      }
      if (by === "type" && typeof a.type === "string" && (ASK_SKILL_TYPES as readonly string[]).includes(a.type)) {
        return { intent, args: { by: "type", type: a.type as AskSkillType }, reply };
      }
      if (by === "name" && typeof a.name === "string" && a.name.trim()) {
        return { intent, args: { by: "name", name: a.name.trim().slice(0, 40) }, reply };
      }
      return null;
    }
    case "care": {
      const kind = a.kind;
      if (kind === "feed" || kind === "praise" || kind === "sleep" || kind === "play") {
        return { intent, args: { kind }, reply };
      }
      return null;
    }
    case "ask_hip_spots": {
      const platform = a.platform;
      if (platform !== "instagram" && platform !== "youtube" && platform !== "any") return null;
      return { intent, args: { platform, places: Array.isArray(a.places) ? a.places.filter((p): p is string => typeof p === "string").slice(0, 5) : [] }, reply };
    }
    case "ask_token_spots": {
      return { intent, args: { places: Array.isArray(a.places) ? a.places.filter((p): p is string => typeof p === "string").slice(0, 5) : [] }, reply };
    }
    default:
      return { intent, args: {}, reply };
  }
}

export type SkillInfo = { slot: number; name: string; type: AskSkillType };

// 빠른 길: 명확한 스킬 말은 로컬 매칭으로 즉시 실행 (AI 호출 없음).
// 순서 중요: "원거리 공격"→ranged, "디버프"→debuff가 "공격"/"버프"보다 먼저.
export function fastSkill(text: string, skills: SkillInfo[]): SkillArgs | null {
  const t = text.trim();
  if (!t) return null;
  const numKo: Array<[RegExp, number]> = [
    [/첫\s*번째/, 0],
    [/두\s*번째/, 1],
    [/세\s*번째/, 2],
    [/네\s*번째/, 3],
  ];
  for (const [re, slot] of numKo) {
    if (re.test(t) && /(기술|스킬|공격)/.test(t)) return { by: "slot", slot };
  }
  const m = t.match(/([1-4])\s*번/);
  if (m) return { by: "slot", slot: Number(m[1]) - 1 };
  const m2 = t.match(/공격\s*([1-4])/);
  if (m2) return { by: "slot", slot: Number(m2[1]) - 1 };
  // 스킬 이름 정확히 포함 (긴 이름 우선).
  const byName = [...skills].sort((x, y) => y.name.length - x.name.length).find((s) => s.name && t.includes(s.name));
  if (byName) return { by: "name", name: byName.name };
  if (/원거리/.test(t)) return { by: "type", type: "ranged" };
  if (/디버프|약화|방어.*깎|디펜스/.test(t)) return { by: "type", type: "debuff" };
  if (/버프|강화|올려|파워\s*업/.test(t)) return { by: "type", type: "buff" };
  if (/공격|어택|때려/.test(t)) return { by: "type", type: "attack" };
  return null;
}
