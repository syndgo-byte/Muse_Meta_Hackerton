// 경험치·전투 스탯 수치 체계 (마스터 지침 §4.2).
// Required_EXP = floor(100 * Level^1.35)
// HP = Base_HP + Level*15 + 포만*0.2, ATK = Base_ATK + Level*4.5 + 친밀*0.1,
// DEF = Base_DEF + Level*3.5, SPD = Base_SPD + Level*2.0
// 속성 상성: 유리 x1.5 / 불리 x0.7.
import type { Status } from "@/lib/state";

export type Element = "fire" | "grass" | "water" | "rock" | "wind";

// 다음 레벨까지 필요한 경험치.
export function nextExpFor(level: number): number {
  const lv = Math.max(1, Math.floor(level));
  return Math.floor(100 * Math.pow(lv, 1.35));
}

// 누적 XP → 레벨 (역산).
export function levelForXpTotal(xp: number): number {
  let level = 1;
  let acc = 0;
  let guard = 0;
  while (guard++ < 200) {
    const need = nextExpFor(level);
    if (xp < acc + need) return level;
    acc += need;
    level++;
  }
  return level;
}

// 레벨 L에 도달하기 위한 누적 XP.
export function xpThreshold(level: number): number {
  let acc = 0;
  for (let l = 1; l < level; l++) acc += nextExpFor(l);
  return acc;
}

export type BaseStats = { hp: number; atk: number; def: number; spd: number };

// 종족값: 속성 베이스 + 도감 번호 분산.
const ELEMENT_BASE: Record<Element, BaseStats> = {
  fire: { hp: 42, atk: 12, def: 7, spd: 9 },
  grass: { hp: 48, atk: 9, def: 10, spd: 7 },
  water: { hp: 52, atk: 9, def: 9, spd: 8 },
  rock: { hp: 60, atk: 11, def: 13, spd: 4 },
  wind: { hp: 40, atk: 10, def: 6, spd: 13 },
};

export function baseStatsFor(speciesId: string): BaseStats {
  const m = speciesId.match(/^([a-z]+)-(\d+)$/);
  const el = (m?.[1] ?? "fire") as Element;
  const n = Number(m?.[2] ?? 1);
  const b = ELEMENT_BASE[el] ?? ELEMENT_BASE.fire;
  return {
    hp: b.hp + ((n * 3) % 7),
    atk: b.atk + ((n * 2) % 4),
    def: b.def + ((n * 5) % 4),
    spd: b.spd + ((n * 7) % 4),
  };
}

export type BattleStats = BaseStats & { level: number; maxHp: number };

export type Boosts = { atk: number; hp: number; def: number; spd: number };

const BOOST_KEY = "oishie-stat-boosts";

function normalizeBoosts(v: unknown): Boosts {
  const r = (v ?? {}) as Partial<Record<keyof Boosts, unknown>>;
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0);
  return { atk: num(r.atk), hp: num(r.hp), def: num(r.def), spd: num(r.spd) };
}

export function loadBoosts(speciesId: string): Boosts {
  try {
    const raw = localStorage.getItem(BOOST_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Boosts>) : {};
    // 구 기록 {atk,hp} 호환: 누락분은 0.
    return normalizeBoosts(all[speciesId]);
  } catch {
    return { atk: 0, hp: 0, def: 0, spd: 0 };
  }
}

export function saveBoosts(speciesId: string, b: Boosts) {
  try {
    const raw = localStorage.getItem(BOOST_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Boosts>) : {};
    all[speciesId] = normalizeBoosts(b);
    localStorage.setItem(BOOST_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export type CondBuff = { fullness: number; affection: number; energy?: number };

// §2 탈진 패널티 기준 (lib/state.ts ENERGY_LOW/EXHAUSTED_BATTLE_PENALTY와 동기).
// 순환 import 방지를 위해 수치만 복제 (state.ts가 단일 기준).
const EXHAUSTED_ENERGY = 25;
const EXHAUSTED_PENALTY = 0.5;

export function battleStats(
  speciesId: string,
  level: number,
  boosts?: Boosts,
  cond?: CondBuff
): BattleStats {
  const base = baseStatsFor(speciesId);
  const lv = Math.max(1, level);
  const b = normalizeBoosts(boosts);
  const full = Math.max(0, Math.min(100, cond?.fullness ?? 0));
  const aff = Math.max(0, Math.min(100, cond?.affection ?? 0));
  const exhausted =
    typeof cond?.energy === "number" && cond.energy < EXHAUSTED_ENERGY;
  const pen = exhausted ? EXHAUSTED_PENALTY : 1;
  const hp = Math.round(base.hp + lv * 15 + full * 0.2 + b.hp);
  return {
    hp,
    maxHp: hp,
    atk: Math.round((base.atk + lv * 4.5 + aff * 0.1 + b.atk) * pen),
    def: Math.round(base.def + lv * 3.5 + b.def),
    spd: Math.round((base.spd + lv * 2 + b.spd) * pen),
    level: lv,
  };
}

// 속성 상성 계수 (공격 속성 → 방어 속성).
const STRONG: Record<Element, Element> = {
  fire: "grass",
  grass: "water",
  water: "fire",
  rock: "wind",
  wind: "fire",
};

export function typeEdge(attEl: Element, defEl: Element): number {
  if (STRONG[attEl] === defEl) return 1.5;
  if (STRONG[defEl] === attEl) return 0.7;
  return 1;
}

export function elementOf(speciesId: string): Element {
  const m = speciesId.match(/^([a-z]+)-\d+$/);
  const el = (m?.[1] ?? "fire") as Element;
  return ELEMENT_BASE[el] ? el : "fire";
}

// 컨디션 보정: 포만·활력·애정 평균 → 공격 보너스 배율 (0.85 ~ 1.15).
export function conditionMult(st: Status): number {
  const avg = (st.fullness + st.energy + st.affection) / 3;
  return 0.85 + (avg / 100) * 0.3;
}

export type SimResult = {
  winner: "mine" | "wild";
  turns: string[];
  mineHp: number;
  wildHp: number;
};

// 결정적 3턴 시뮬레이션 (LLM 실패 시 폴백 + 수치 검증용).
export function simulateBattle(
  mineName: string,
  mine: BattleStats,
  mineEl: Element,
  mineCond: number,
  wildName: string,
  wild: BattleStats,
  wildEl: Element
): SimResult {
  const edgeMine = typeEdge(mineEl, wildEl);
  const edgeWild = typeEdge(wildEl, mineEl);
  let mineHp = mine.maxHp;
  let wildHp = wild.maxHp;
  const turns: string[] = [];
  const firstMine = mine.spd >= wild.spd;
  for (let i = 0; i < 3 && mineHp > 0 && wildHp > 0; i++) {
    const order: Array<"mine" | "wild"> = firstMine ? ["mine", "wild"] : ["wild", "mine"];
    for (const side of order) {
      if (mineHp <= 0 || wildHp <= 0) break;
      if (side === "mine") {
        const dmg = Math.max(1, Math.round(((mine.atk * edgeMine * mineCond - wild.def * 0.6) * (0.9 + ((i * 7) % 3) * 0.1))));
        wildHp = Math.max(0, wildHp - dmg);
        turns.push(`${mineName}의 일격! ${wildName}에게 ${dmg} 피해.`);
      } else {
        const dmg = Math.max(1, Math.round(((wild.atk * edgeWild - mine.def * 0.6) * (0.9 + ((i * 5) % 3) * 0.1))));
        mineHp = Math.max(0, mineHp - dmg);
        turns.push(`${wildName}의 반격! ${mineName}에게 ${dmg} 피해.`);
      }
    }
  }
  return {
    winner: mineHp === wildHp ? (mine.spd >= wild.spd ? "mine" : "wild") : mineHp > wildHp ? "mine" : "wild",
    turns: turns.slice(0, 6),
    mineHp,
    wildHp,
  };
}
