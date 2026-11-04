// lib/status/statpoints.ts — G3 스탯 포인트 배분 순수 로직 (BATTLE_DESIGN §7).
// 의존성 없음 (verify-statpoints.mjs가 tsc 단독 컴파일).
// boosts 형식은 기존 oishie-stat-boosts와 동일 {atk,hp,def,spd}.
// HP 칸은 포인트 수가 아니라 실제 증가량(+5 단위)으로 적는다.

export type StatKey4 = "atk" | "hp" | "def" | "spd";

export interface Boosts4 {
  atk: number;
  hp: number;
  def: number;
  spd: number;
}

export const POINTS_PER_LEVEL = 3;
export const POINTS_PER_UPGRADE = 2;
export const HP_PER_POINT = 5;

export const ZERO_BOOSTS: Boosts4 = { atk: 0, hp: 0, def: 0, spd: 0 };

export function sanitizeBoosts(v: unknown): Boosts4 {
  const r = (v ?? {}) as Partial<Record<StatKey4, unknown>>;
  const num = (x: unknown) =>
    typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
  const hp = num(r.hp);
  return {
    atk: num(r.atk),
    hp: hp - (hp % HP_PER_POINT),
    def: num(r.def),
    spd: num(r.spd),
  };
}

// boosts → 포인트 수 (hp는 5로 나눔).
export function boostsToPoints(b: Boosts4): Boosts4 {
  const s = sanitizeBoosts(b);
  return { atk: s.atk, hp: s.hp / HP_PER_POINT, def: s.def, spd: s.spd };
}

// boosts → 포인트 합(소비량).
export function spentPoints(b: Boosts4): number {
  const p = boostsToPoints(b);
  return p.atk + p.hp + p.def + p.spd;
}

export function totalSpent(all: unknown): number {
  if (!all || typeof all !== "object") return 0;
  let t = 0;
  for (const k of Object.keys(all as Record<string, unknown>)) {
    t += spentPoints(sanitizeBoosts((all as Record<string, unknown>)[k]));
  }
  return t;
}

// 단일 능력 상한: 전체 풀(소비+보유)의 50% 초과 금지. 최소 1.
export function statCap(poolTotal: number): number {
  const t = Math.max(0, Math.floor(poolTotal));
  if (t <= 1) return 1;
  return Math.max(1, Math.floor(t / 2));
}

export type RoleKey = "attacker" | "tanker" | "speed" | "supporter" | "trick";

export function asRoleKey(role: string): RoleKey {
  if (role === "tanker" || role === "speed" || role === "supporter" || role === "trick") return role;
  return "attacker";
}

// 추천 배분 비율 (문서 §7). HP 1단위 = 1포인트(=+5).
export const RECOMMEND: Record<RoleKey, StatKey4[]> = {
  attacker: ["atk", "atk", "spd"],
  tanker: ["def", "def", "hp"],
  speed: ["spd", "spd", "atk"],
  supporter: ["hp", "hp", "def"],
  trick: ["spd", "def", "hp"],
};

// 추천 배분: 보유 포인트를 비율대로 현재 배분에 더한다 (상한 준수).
// poolTotal = 전체 소비 + 보유 (상한 기준, 고정).
export function recommend(
  role: RoleKey,
  available: number,
  curPoints: Boosts4,
  poolTotal: number
): { add: Boosts4; used: number } {
  const add: Boosts4 = { atk: 0, hp: 0, def: 0, spd: 0 };
  const cur: Boosts4 = {
    atk: Math.max(0, Math.floor(curPoints.atk)),
    hp: Math.max(0, Math.floor(curPoints.hp)),
    def: Math.max(0, Math.floor(curPoints.def)),
    spd: Math.max(0, Math.floor(curPoints.spd)),
  };
  const cap = statCap(poolTotal);
  const allKeys: StatKey4[] = ["atk", "hp", "def", "spd"];
  let left = Math.max(0, Math.floor(available));
  let used = 0;
  // 1단계: 역할 비율대로. 2단계: 막히면 나머지 능력으로 넘침. 전부 상한 준수.
  for (const units of [RECOMMEND[role], allKeys]) {
    let skip = 0;
    let i = 0;
    while (left > 0 && skip < units.length) {
      const k = units[i % units.length];
      i++;
      if (cur[k] + 1 > cap) {
        skip++;
        continue;
      }
      skip = 0;
      cur[k]++;
      add[k]++;
      left--;
      used++;
    }
  }
  return { add, used };
}

// 포인트 배분량을 boosts 증가분으로 바꾼다 (hp ×5).
export function pointsToBoosts(p: Boosts4): Boosts4 {
  return {
    atk: Math.max(0, Math.floor(p.atk)),
    hp: Math.max(0, Math.floor(p.hp)) * HP_PER_POINT,
    def: Math.max(0, Math.floor(p.def)),
    spd: Math.max(0, Math.floor(p.spd)),
  };
}
