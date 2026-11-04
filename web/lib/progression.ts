// 성장/XP 단일 규격 (3항). AR 4종 액션(미식·산책·음성·배틀) EXP 지급 기준.
// 화면은 이 모듈의 상수·헬퍼로만 EXP를 다룬다. 수치는 하드코딩 금지.
// NOTE: 서버(API 라우트)에서도 import하므로 최상위 브라우저 접근 금지.

// 레벨 공식은 lib/stats.ts 단일 기준: Required_EXP = floor(100 * Level^1.35).
export { nextExpFor, levelForXpTotal, xpThreshold } from "@/lib/stats";

// 1) 획득량 규격.
export const EXP_DINE_MIN = 50;
export const EXP_DINE_MAX = 100;
export const EXP_WALK_PER_100M = 15;
export const WALK_DAY_CAP = 300;
export const EXP_VOICE_MIN = 10;
export const EXP_VOICE_MAX = 20;
export const EXP_BATTLE_WIN = 40;
export const EXP_SHARE = 80;
/** AR 미식 외 간식(먹이 주기) 고정 보상. 라운지 회복 액션은 XP 없음. */
export const EXP_FEED = 10;
/** @deprecated 음성 교감은 voiceExp() 10~20 사용. */
export const EXP_CARE = 20;
// LLM 판정(look) 지급 클램프 범위.
export const LOOK_XP_MIN = 0;
export const LOOK_XP_MAX = 50;

// AR 액션 4종 라벨.
export type ARAction = "dine" | "walk" | "voice" | "battle";
export const AR_ACTION_LABEL: Record<ARAction, string> = {
  dine: "미식 인식",
  walk: "산책 탐험",
  voice: "음성 교감",
  battle: "배틀 승리",
};

// 미식 탐험 보상: 50~100 가변.
export function dineExp(): number {
  return EXP_DINE_MIN + Math.floor(Math.random() * (EXP_DINE_MAX - EXP_DINE_MIN + 1));
}

// 음성 교감 보상: 10~20 가변.
export function voiceExp(): number {
  return EXP_VOICE_MIN + Math.floor(Math.random() * (EXP_VOICE_MAX - EXP_VOICE_MIN + 1));
}

// LLM 지급분 클램프: 0~50 외 값·비수치는 경계값으로 보정.
export function clampLookGain(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
  return Math.max(LOOK_XP_MIN, Math.min(LOOK_XP_MAX, n));
}

// 산책 EXP 정산: 누적 이동거리(m) 입력 → 일 상한 적용 지급량.
// 호출될 때마다 "미정산분"만 지급한다.
const WALK_CLAIM_KEY = "oishie-walk-claim";
type WalkClaim = { day: string; claimedM: number; dayExp: number };
function loadWalkClaimRaw(): WalkClaim {
  try {
    const raw = localStorage.getItem(WALK_CLAIM_KEY);
    if (raw) return JSON.parse(raw) as WalkClaim;
  } catch {
    /* ignore (SSR 포함) */
  }
  return { day: "", claimedM: 0, dayExp: 0 };
}
function saveWalkClaim(c: WalkClaim) {
  try {
    localStorage.setItem(WALK_CLAIM_KEY, JSON.stringify(c));
  } catch {
    /* ignore (SSR 포함) */
  }
}
export function claimWalkExp(totalM: number): { gain: number; capped: boolean } {
  const today = new Date().toISOString().slice(0, 10);
  let c = loadWalkClaimRaw();
  if (c.day !== today) {
    // 날짜 변경: 기존 누적은 정산 마감, 오늘부터 새로 적립.
    c = { day: today, claimedM: totalM, dayExp: 0 };
    saveWalkClaim(c);
    return { gain: 0, capped: false };
  }
  const freshM = Math.max(0, totalM - c.claimedM);
  const units = Math.floor(freshM / 100);
  if (units <= 0) return { gain: 0, capped: c.dayExp >= WALK_DAY_CAP };
  const raw = units * EXP_WALK_PER_100M;
  const room = Math.max(0, WALK_DAY_CAP - c.dayExp);
  const gain = Math.min(raw, room);
  saveWalkClaim({
    day: today,
    claimedM: c.claimedM + units * 100,
    dayExp: c.dayExp + gain,
  });
  return { gain, capped: gain < raw };
}

// 2) 성장 단계: Lv.1~4 유년기 → Lv.5~9 성장기 → Lv.10+ 완전체.
export type GrowthStage = { tier: 0 | 1 | 2; title: string; color: string };
export function growthStage(level: number): GrowthStage {
  if (level >= 10) return { tier: 2, title: "완전체", color: "#ffd94d" };
  if (level >= 5) return { tier: 1, title: "성장기", color: "#7cc7ff" };
  return { tier: 0, title: "유년기", color: "#9fe870" };
}
export function danceTier(level: number): 0 | 1 | 2 {
  return growthStage(level).tier;
}

// 3) 단계별 밈 댄스 스킬 해금.
export type DanceSkill = { tier: 0 | 1 | 2; name: string; desc: string };
export const DANCE_UNLOCKS: DanceSkill[] = [
  { tier: 0, name: "통통 그루브", desc: "기본 8카운트 바운스" },
  { tier: 1, name: "하트 챌린지 웨이브", desc: "성장기 해금 · SNS 챌린지 동작" },
  { tier: 2, name: "풀 밈 메들리", desc: "완전체 해금 · 최신 밈 믹스" },
];

// 4) 성장단계별 능력/언락 문구 (라운지 표시·AR 연출 공용).
export type StageUnlock = {
  tier: 0 | 1 | 2;
  title: string;
  levels: string;
  abilities: string[];
  unlocks: string[];
  arFlavor: string;
  battleBonus: string;
};
export const STAGE_UNLOCKS: StageUnlock[] = [
  {
    tier: 0,
    title: "유년기",
    levels: "1–4레벨",
    abilities: ["16자 옹알이 AR 캡션", "기본 8카운트 바운스"],
    unlocks: ["밈 댄스: 통통 그루브"],
    arFlavor: "하트눈 조르기",
    battleBonus: "없음 (기본 스탯)",
  },
  {
    tier: 1,
    title: "성장기",
    levels: "5–9레벨",
    abilities: ["친화 AR 대사 (주변 사물 호명)", "산책 리액션 증가"],
    unlocks: ["밈 댄스: 하트 챌린지 웨이브"],
    arFlavor: "다가와 인사 + 리액션 증가",
    battleBonus: "SPD 동점 시 선공",
  },
  {
    tier: 2,
    title: "완전체",
    levels: "10레벨+",
    abilities: ["한 줄 추천 AR 캡션", "리더 모션"],
    unlocks: ["밈 댄스: 풀 밈 메들리"],
    arFlavor: "리더 모션 + 추천 멘트",
    battleBonus: "승리 크리티컬 대사 연출",
  },
];
export function stageUnlock(level: number): StageUnlock {
  return STAGE_UNLOCKS[danceTier(level)];
}

// 5) 단계별 AI 대사 지능 (look/feed 프롬프트 주입용).
export function stagePrompt(level: number): string {
  const t = danceTier(level);
  if (t === 0)
    return "Creature is a babbling infant (Lv.1-4): captions are cute fragments under 16 chars, wonder-filled, simple words.";
  if (t === 1)
    return "Creature is a bright juvenile (Lv.5-9): captions are friendly and curious, may name one nearby thing it likes.";
  return "Creature is a fully-grown sage (Lv.10+): captions are sharp one-line recommendations about the seen subject, still under 24 chars.";
}
