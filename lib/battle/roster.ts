// lib/battle/roster.ts — G1: 24종 역할·종족값·고유기 (BATTLE_DESIGN §5~§7).
// 이름은 lib/species.ts와 동일. 종족값은 문서 §5 (역할 틀 + 속성 보정).
// combatStats()는 lib/stats.ts battleStats() 공식을 새 종족값에 얹은 복사본이다
// (기존 파일을 고치지 않으므로 공식만 복제. 원본 L102~L125).

import {
  BODY_SLAM,
  ELEMENT_SKILLS,
  ROLE_SKILLS,
  type Element,
  type MoveDef,
  type Role,
} from "./skills";

export type { Element, Role };

// ---- 역할 틀 + 속성 보정 (문서 §5) ----
export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
}

export const ROLE_FRAME: Record<Role, BaseStats> = {
  attacker: { hp: 40, atk: 15, def: 7, spd: 10 },
  tanker: { hp: 60, atk: 9, def: 12, spd: 4 },
  speed: { hp: 40, atk: 11, def: 6, spd: 15 },
  supporter: { hp: 52, atk: 9, def: 10, spd: 8 },
  trick: { hp: 46, atk: 10, def: 9, spd: 11 },
};

export const ELEMENT_MOD: Record<Element, BaseStats> = {
  fire: { hp: 0, atk: 1, def: -1, spd: 0 },
  grass: { hp: 0, atk: -1, def: 1, spd: 0 },
  rock: { hp: 0, atk: 0, def: 1, spd: -1 },
  wind: { hp: -3, atk: 0, def: 0, spd: 1 },
  water: { hp: 3, atk: -1, def: 0, spd: 0 },
};

export interface SpeciesMeta {
  id: string;
  name: string;
  element: Element;
  role: Role;
}

// 문서 §6 표 순서 그대로 (24종).
export const SPECIES: SpeciesMeta[] = [
  { id: "fire-01", name: "모카퐁", element: "fire", role: "attacker" },
  { id: "fire-02", name: "화로냥", element: "fire", role: "speed" },
  { id: "fire-03", name: "불도깨비", element: "fire", role: "trick" },
  { id: "fire-04", name: "라바콩", element: "fire", role: "tanker" },
  { id: "fire-05", name: "촛농이", element: "fire", role: "supporter" },
  { id: "grass-01", name: "리피몽", element: "grass", role: "tanker" },
  { id: "grass-02", name: "콩나물이", element: "grass", role: "supporter" },
  { id: "grass-03", name: "버섯통", element: "grass", role: "trick" },
  { id: "grass-04", name: "잔디멍", element: "grass", role: "speed" },
  { id: "grass-05", name: "선인장이", element: "grass", role: "attacker" },
  { id: "water-01", name: "물방울이", element: "water", role: "supporter" },
  { id: "water-02", name: "수돗물이", element: "water", role: "tanker" },
  { id: "water-03", name: "어항이", element: "water", role: "trick" },
  { id: "water-04", name: "장마이", element: "water", role: "speed" },
  { id: "water-05", name: "얼음콩", element: "water", role: "attacker" },
  { id: "rock-01", name: "돌멩이", element: "rock", role: "tanker" },
  { id: "rock-02", name: "시멘돌", element: "rock", role: "attacker" },
  { id: "rock-03", name: "자갈이", element: "rock", role: "speed" },
  { id: "rock-04", name: "동굴박쥐", element: "rock", role: "trick" },
  { id: "wind-01", name: "바람돌이", element: "wind", role: "speed" },
  { id: "wind-02", name: "먼지몽", element: "wind", role: "trick" },
  { id: "wind-03", name: "연날이", element: "wind", role: "supporter" },
  { id: "wind-04", name: "선풍기", element: "wind", role: "attacker" },
  { id: "wind-05", name: "구름빵", element: "wind", role: "tanker" },
];

export const SPECIES_IDS = SPECIES.map((s) => s.id);

export function speciesOf(id: string): SpeciesMeta {
  const found = SPECIES.find((s) => s.id === id);
  if (!found) throw new Error(`unknown species: ${id}`);
  return found;
}

export function baseStatsForBattle(speciesId: string): BaseStats {
  const meta = speciesOf(speciesId);
  const f = ROLE_FRAME[meta.role];
  const m = ELEMENT_MOD[meta.element];
  return { hp: f.hp + m.hp, atk: f.atk + m.atk, def: f.def + m.def, spd: f.spd + m.spd };
}

// ---- 칸 4: 고유기 (문서 §6). 쿨다운 3, 자갈이만 0. ----
// 명중이 문서에 없는 비공격기·단타 고유기는 100으로 둔다 (보고서 ADJUSTMENTS).
function uniq(
  id: string,
  name: string,
  nameEn: string,
  element: Element,
  power: number,
  accuracy: number,
  extra: Partial<MoveDef> = {},
  cooldown = 3
): MoveDef {
  return {
    id,
    name,
    nameEn,
    element,
    power,
    accuracy,
    hits: 1,
    priority: false,
    cooldown,
    critMode: "normal",
    ...extra,
  };
}

export const UNIQUES: Record<string, MoveDef> = {
  "fire-01": uniq("uniq-fire-01", "에스프레소 샷", "Espresso Shot", "fire", 65, 100, {
    stages: [{ target: "self", stat: "spd", stages: 1, turns: 3 }],
  }),
  "fire-02": uniq("uniq-fire-02", "불꼬리 팡팡", "Tail Pow", "fire", 30, 100, {
    hits: 2,
    priority: true,
    critMode: "single",
  }),
  "fire-03": uniq("uniq-fire-03", "그을음 장난", "Soot Trick", "fire", 30, 100, {
    status: { kind: "burn", chance: 0.6 },
    stages: [{ target: "foe", stat: "acc", stages: -1, turns: 2 }],
  }),
  "fire-04": uniq("uniq-fire-04", "용암 껍질", "Lava Shell", "fire", 0, 100, {
    stages: [{ target: "self", stat: "def", stages: 2, turns: 3 }],
    reflectBurnTurns: 3,
    reflectBurnChance: 0.3,
  }),
  "fire-05": uniq("uniq-fire-05", "생일 촛불", "Birthday Candle", "fire", 0, 100, {
    stages: [{ target: "self", stat: "atk", stages: 1, turns: 3 }],
    critNext: true,
  }),
  "grass-01": uniq("uniq-grass-01", "뿌리내리기", "Take Root", "grass", 0, 100, {
    regenTurns: 3,
    regenPct: 8,
  }),
  "grass-02": uniq("uniq-grass-02", "쑥쑥 자라기", "Sprout Up", "grass", 0, 100, {
    stages: [
      { target: "self", stat: "atk", stages: 1, turns: 3 },
      { target: "self", stat: "def", stages: 1, turns: 3 },
    ],
  }),
  "grass-03": uniq("uniq-grass-03", "포자 우산", "Spore Umbrella", "grass", 0, 80, {
    status: { kind: "wrap", chance: 1 },
    stages: [{ target: "foe", stat: "spd", stages: -1, turns: 3 }],
  }),
  "grass-04": uniq("uniq-grass-04", "잔디 질주", "Lawn Dash", "grass", 55, 100, {
    priority: true,
    evadeNext: 0.5,
  }),
  "grass-05": uniq("uniq-grass-05", "가시 폭탄", "Thorn Bomb", "grass", 65, 100, {
    reflectDmgTurns: 2,
    reflectDmgPct: 5,
  }),
  "water-01": uniq("uniq-water-01", "빗방울 치유", "Raindrop Heal", "water", 0, 100, {
    healPct: 35,
    cleanseDebuff: true,
    cleanseStatus: true,
  }),
  "water-02": uniq("uniq-water-02", "거품 방패", "Bubble Shield", "water", 0, 100, {
    shieldTurns: 2,
    shieldFactor: 0.6,
  }),
  "water-03": uniq("uniq-water-03", "유리알 굴절", "Glass Refraction", "water", 0, 100, {
    status: { kind: "soak", chance: 1 },
    stages: [{ target: "foe", stat: "acc", stages: -2, turns: 2 }],
  }),
  "water-04": uniq("uniq-water-04", "웅덩이 점프", "Puddle Jump", "water", 60, 100, {
    priority: true,
    status: { kind: "soak", chance: 0.3 },
  }),
  "water-05": uniq("uniq-water-05", "얼음 박치기", "Ice Headbutt", "water", 70, 100, {
    stages: [{ target: "foe", stat: "spd", stages: -1, turns: 3 }],
  }),
  "rock-01": uniq("uniq-rock-01", "바위 굳히기", "Rock Armor", "rock", 0, 100, {
    stages: [{ target: "self", stat: "def", stages: 2, turns: 3 }],
    cleanseCrack: true,
  }),
  "rock-02": uniq("uniq-rock-02", "콘크리트 타설", "Concrete Pour", "rock", 100, 85, {
    stages: [{ target: "self", stat: "spd", stages: -1, turns: 3 }],
  }),
  "rock-03": uniq(
    "uniq-rock-03",
    "데굴데굴",
    "Tumble Roll",
    "rock",
    40,
    100,
    { rollCombo: true },
    0
  ),
  "rock-04": uniq("uniq-rock-04", "삑삑 레이더", "Peep Radar", "rock", 0, 100, {
    status: { kind: "dizzy", chance: 1 },
  }),
  "wind-01": uniq("uniq-wind-01", "회오리 스카프", "Whirlwind Scarf", "wind", 50, 100, {
    priority: true,
    stages: [{ target: "self", stat: "spd", stages: 1, turns: 3 }],
  }),
  "wind-02": uniq("uniq-wind-02", "먼지 장막", "Dust Veil", "wind", 0, 100, {
    stages: [{ target: "foe", stat: "acc", stages: -2, turns: 2 }],
  }),
  "wind-03": uniq("uniq-wind-03", "종이접기 방패", "Origami Shield", "wind", 0, 100, {
    healPct: 15,
    cleanseDebuff: true,
    stages: [{ target: "self", stat: "def", stages: 1, turns: 3 }],
  }),
  "wind-04": uniq("uniq-wind-04", "강풍 3단", "Triple Gale", "wind", 30, 100, {
    hits: 3,
    critMode: "perHit",
  }),
  "wind-05": uniq("uniq-wind-05", "폭신 구름", "Fluffy Cloud", "wind", 0, 100, {
    healPct: 20,
    absorbNext: 0.5,
  }),
};

// 동굴박쥐 삑삑 레이더의 균열 30%는 상태 1개 슬롯과 겹치므로 별도 필드가 아니라
// 엔진에서 처리한다. MoveDef.status는 하나만 담는다.
export const ROCK04_EXTRA_CRACK = 0.3;

// 4칸 기술표: 기본기·속성기·역할기·고유기.
export function buildMoveset(speciesId: string): [MoveDef, MoveDef, MoveDef, MoveDef] {
  const meta = speciesOf(speciesId);
  return [BODY_SLAM, ELEMENT_SKILLS[meta.element], ROLE_SKILLS[meta.role], UNIQUES[speciesId]];
}

// ---- 스탯 포인트 (문서 §7) ----
export interface Boosts {
  atk: number;
  hp: number; // 실제 증가량 (+5 단위)
  def: number;
  spd: number;
}

export const NO_BOOSTS: Boosts = { atk: 0, hp: 0, def: 0, spd: 0 };

// 추천 배분. 레벨당 3점, 한 능력에 전체의 50% 초과 금지.
// 넘치는 점수는 폴백 순서(atk→def→spd→hp)로 빈 칸에 둔다.
export function recommendedBoosts(role: Role, level: number): Boosts {
  const points = Math.max(0, (Math.max(1, Math.floor(level)) - 1) * 3);
  const cap = Math.floor(points / 2);
  const cycles: Record<Role, Array<"atk" | "def" | "spd" | "hp">> = {
    attacker: ["atk", "atk", "spd"],
    tanker: ["def", "def", "hp"],
    speed: ["spd", "spd", "atk"],
    supporter: ["hp", "hp", "def"],
    trick: ["spd", "def", "hp"],
  };
  const fallback: Array<"atk" | "def" | "spd" | "hp"> = ["atk", "def", "spd", "hp"];
  const pts = { atk: 0, def: 0, spd: 0, hp: 0 };
  const cyc = cycles[role];
  let cursor = 0;
  for (let p = 0; p < points; p++) {
    let placed = false;
    for (let k = 0; k < cyc.length; k++) {
      const s = cyc[(cursor + k) % cyc.length];
      if (pts[s] < cap) {
        pts[s] += 1;
        cursor = (cursor + k + 1) % cyc.length;
        placed = true;
        break;
      }
    }
    if (!placed) {
      for (const s of fallback) {
        if (pts[s] < cap) {
          pts[s] += 1;
          placed = true;
          break;
        }
      }
    }
    if (!placed) break;
  }
  return { atk: pts.atk, def: pts.def, spd: pts.spd, hp: pts.hp * 5 };
}

// ---- 전투 스탯 (lib/stats.ts battleStats 공식 복제 + 새 종족값) ----
export interface CondInput {
  fullness: number; // 0~100
  affection: number; // 0~100
  energy?: number; // 25 미만이면 탈진 패널티 0.5
}

export interface CombatStats extends BaseStats {
  level: number;
  maxHp: number;
}

export function combatStats(
  speciesId: string,
  level: number,
  boosts: Boosts = NO_BOOSTS,
  cond: CondInput = { fullness: 0, affection: 0 }
): CombatStats {
  const base = baseStatsForBattle(speciesId);
  const lv = Math.max(1, Math.floor(level));
  const full = Math.max(0, Math.min(100, cond.fullness));
  const aff = Math.max(0, Math.min(100, cond.affection));
  const exhausted = typeof cond.energy === "number" && cond.energy < 25;
  const pen = exhausted ? 0.5 : 1;
  const hp = Math.round(base.hp + lv * 15 + full * 0.2 + boosts.hp);
  return {
    hp,
    maxHp: hp,
    atk: Math.round((base.atk + lv * 4.5 + aff * 0.1 + boosts.atk) * pen),
    def: Math.round(base.def + lv * 3.5 + boosts.def),
    spd: Math.round((base.spd + lv * 2 + boosts.spd) * pen),
    level: lv,
  };
}

// 컨디션 보정 복제 (lib/stats.ts conditionMult L149~L152).
export function conditionMultOf(fullness: number, energy: number, affection: number): number {
  const avg = (fullness + energy + affection) / 3;
  return 0.85 + (avg / 100) * 0.3;
}
