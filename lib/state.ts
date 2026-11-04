import { levelForXpTotal } from "@/lib/stats";

export type Status = {
  fullness: number; // 포만감 0-100
  energy: number; // 활력 0-100 (낮으면 졸림)
  affection: number; // 애정 0-100
  xp: number;
  level: number;
  hp?: number; // 체력 (D4-3). 없음 = full.
};

export const DEFAULT_STATUS: Status = {
  fullness: 50,
  energy: 80,
  affection: 20,
  xp: 0,
  level: 1,
};

// §2 컨디션 임계값 (라운지/AR 공통 단일 기준).
export const ENERGY_LOW = 25; // 미만: 탈진 (주저앉음·이동 50%·배틀 불가)
export const ENERGY_HIGH = 80; // 이상: 활기 (발 구르기+고속 회전)
export const FULLNESS_LOW = 30; // 미만: 배고픔 (배 움켜쥠+시무룩)
export const FULLNESS_HIGH = 90; // 이상: 포만 (배 두드림+만족 미소)
export const AFFECTION_HIGH = 70; // 이상: 단짝 (정면 접근+갸웃+애교)
export const AFFECTION_LOW = 20; // 미만: 애정 없음 (애교·교감 반응 없음)
export const EXHAUSTED_SPEED_MULT = 0.5; // 탈진 이동속도 배율
export const EXHAUSTED_BATTLE_PENALTY = 0.5; // 탈진 출전 시 ATK/SPD 배율
export const SLEEPY_LINE =
  "흐아암... 트레이너님, 너무 졸려요. 라운지에서 낮잠 자고 싶어요...";
export const HUNGRY_FOOD_LINE = "꼬르륵... 맛있는 냄새가 나요! 먹으러 가요!";

const KEY = "snapquest-status";

export function loadStatus(): Status {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_STATUS, ...(JSON.parse(raw) as Partial<Status>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_STATUS };
}

// 직전 POST 본문. StrictMode 이중 호출 등 동일값 연속 저장은 1회만 보낸다.
let lastPosted = "";
export function saveStatus(s: Status, speciesId?: string) {
  // 로컬 캐시(대표 파트너) + 서버 저장 이중 기록. 서버가 원본이며, 실패해도 무시한다.
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
  const body = JSON.stringify(speciesId ? { ...s, speciesId } : s);
  if (body === lastPosted) return;
  lastPosted = body;
  try {
    void fetch("/api/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {
      lastPosted = "";
    });
  } catch {
    /* ignore (SSR 포함) */
  }
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// 레벨 곡선: Required_EXP = floor(100 * Level^1.35) (lib/stats.ts 단일 기준).
export function levelForXp(xp: number) {
  return levelForXpTotal(Math.max(0, xp));
}

// XP 획득 + 레벨업 일괄 처리.
export function addXp(prev: Status, gain: number): Status {
  const xp = prev.xp + gain;
  return { ...prev, xp, level: levelForXp(xp) };
}

// 스트레스 지수: dex/pov/camp 공통 (에너지·포만·애정 평균의 역수).
export function stressOf(st: Status): number {
  return Math.max(0, Math.min(100, 100 - Math.round((st.energy + st.fullness + st.affection) / 3)));
}

export type CreatureCondition = {
  hunger: boolean; // fullness < FULLNESS_LOW: 배고픔 (배 움켜쥠+시무룩)
  sleepy: boolean; // energy < ENERGY_LOW: 졸림/탈진 (배틀 불가, 라운지 휴식 권장)
  soulmate: boolean; // affection >= AFFECTION_HIGH: 단짝 (정면 접근+갸웃+애교)
  stressed: boolean; // stress >= 61: 지침/짜증 (울상 + 신음)
  energetic: boolean; // energy >= ENERGY_HIGH: 활기 (발 구르기+고속 회전)
  stuffed: boolean; // fullness >= FULLNESS_HIGH: 포만 (배 두드림+만족 미소)
  labels: string[]; // UI 표시용 한글 라벨
};

// 크리처 컨디션 판정: dex 파트너 카드·pov HUD·camp 상태가 모두 공유.
export function getCreatureCondition(st: Status): CreatureCondition {
  const hunger = st.fullness < FULLNESS_LOW;
  const sleepy = st.energy < ENERGY_LOW;
  const soulmate = st.affection >= AFFECTION_HIGH;
  const stressed = stressOf(st) >= 61;
  const energetic = st.energy >= ENERGY_HIGH;
  const stuffed = st.fullness >= FULLNESS_HIGH;
  const labels: string[] = [];
  if (hunger) labels.push("배고픔");
  if (sleepy) labels.push("졸림");
  if (soulmate) labels.push("단짝");
  if (stressed) labels.push("지침");
  if (energetic) labels.push("활기");
  if (stuffed) labels.push("만족");
  if (!labels.length) labels.push("쾌적");
  return { hunger, sleepy, soulmate, stressed, energetic, stuffed, labels };
}

export function isExhausted(st: Status): boolean {
  return st.energy < ENERGY_LOW;
}

export function isEnergetic(st: Status): boolean {
  return st.energy >= ENERGY_HIGH;
}

export function isHungry(st: Status): boolean {
  return st.fullness < FULLNESS_LOW;
}

export function isStuffed(st: Status): boolean {
  return st.fullness >= FULLNESS_HIGH;
}

export function isSoulmate(st: Status): boolean {
  return st.affection >= AFFECTION_HIGH;
}

// 탈진 이동속도 배율 (50% 이하).
export function moveSpeedMult(st: Status): number {
  return isExhausted(st) ? EXHAUSTED_SPEED_MULT : 1;
}

// 탈진 출전 시 ATK/SPD 배율 (50%).
export function exhaustedAtkSpdMult(energy: number): number {
  return energy < ENERGY_LOW ? EXHAUSTED_BATTLE_PENALTY : 1;
}

const SEEN_KEY = "snapquest-seen";

export function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    /* ignore */
  }
  return [];
}

export function markSeen(id: string) {
  try {
    const arr = loadSeen();
    if (!arr.includes(id)) {
      arr.push(id);
      localStorage.setItem(SEEN_KEY, JSON.stringify(arr.slice(-100)));
    }
  } catch {
    /* ignore */
  }
}

export function applyLook(
  prev: Status,
  seen: string,
  friend: boolean,
  foe: boolean,
  xpGain: number
): { next: Status; leveledUp: boolean; auto: "eat" | "sleep" | "battle" | null } {
  const next: Status = { ...prev };
  let auto: "eat" | "sleep" | "battle" | null = null;
  if (seen === "food") {
    if (prev.fullness < 70) {
      next.fullness = clamp(prev.fullness + 30);
      next.energy = clamp(prev.energy - 20);
      next.affection = clamp(prev.affection + 5);
      auto = "eat";
      if (next.energy < ENERGY_LOW) auto = "sleep";
    } else {
      next.affection = clamp(prev.affection + 2);
    }
  } else if (seen === "creature") {
    if (friend) {
      next.affection = clamp(prev.affection + 15);
      next.energy = clamp(prev.energy + 5);
    } else if (foe) {
      auto = "battle";
    }
  }
  next.xp = prev.xp + xpGain;
  next.level = levelForXp(next.xp);
  return { next, leveledUp: next.level > prev.level, auto };
}
