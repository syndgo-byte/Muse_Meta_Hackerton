// lib/battle/skills.ts — G1: 속성 상성·공용 기술표 (BATTLE_DESIGN §1~§5).
// 기존 lib/stats.ts를 바꾸지 않으므로 상성표·단계 배율을 이 파일에 둔다.
// 원본 공식: lib/stats.ts typeEdge()·conditionMult()·battleStats().
// 문서 기준값 그대로. 판단이 필요한 빈칸은 ADJUSTMENTS(보고서)에 적는다.

export type Element = "fire" | "grass" | "water" | "rock" | "wind";
export type MoveElement = Element | "none";
export type Role = "attacker" | "tanker" | "speed" | "supporter" | "trick";

export const ROLE_LABEL: Record<Role, string> = {
  attacker: "어태커",
  tanker: "탱커",
  speed: "스피드",
  supporter: "서포터",
  trick: "트릭",
};

export const ELEMENT_LABEL: Record<Element, string> = {
  fire: "불",
  grass: "풀",
  water: "물",
  rock: "바위",
  wind: "바람",
};

// ---- 속성 상성 (문서 §1: 불 → 풀 → 바위 → 바람 → 물 → 불) ----
const STRONG: Record<Element, Element> = {
  fire: "grass",
  grass: "rock",
  rock: "wind",
  wind: "water",
  water: "fire",
};

export function typeEdge(attEl: MoveElement, defEl: Element): number {
  if (attEl === "none") return 1;
  if (STRONG[attEl] === defEl) return 1.5;
  if (STRONG[defEl] === attEl) return 0.7;
  return 1;
}

// 9-E: 기술 종류 표시 (ATK=피해, DEBUFF=상대 약화, BUFF=아군 강화).
export type MoveKind = "ATK" | "BUFF" | "DEBUFF";
export function moveKind(m: MoveDef): MoveKind {
  if (m.power > 0) return "ATK";
  const foeDown =
    (m.stages?.some((s) => s.target === "foe" && s.stages < 0) ?? false) || m.status !== undefined;
  return foeDown ? "DEBUFF" : "BUFF";
}

// ---- 능력 단계 배율 (문서 §4) ----
const STAGE_MULT: Record<number, number> = {
  "-2": 0.6,
  "-1": 0.8,
  "0": 1.0,
  "1": 1.25,
  "2": 1.5,
};

export function stageMult(stage: number): number {
  const s = Math.max(-2, Math.min(2, Math.round(stage)));
  return STAGE_MULT[s] ?? 1;
}

const ACC_MULT: Record<number, number> = { "-2": 0.5, "-1": 0.75, "0": 1 };

export function accMult(stage: number): number {
  const s = Math.max(-2, Math.min(0, Math.round(stage)));
  return ACC_MULT[s] ?? 1;
}

// ---- 속성 저항 단계 (문서 §4, M 보강). 받는 쪽이 속성별로 가진다. ----
const RESIST_MULT: Record<number, number> = {
  "-2": 1.5,
  "-1": 1.25,
  "0": 1.0,
  "1": 0.8,
  "2": 0.6,
};

export function resistMult(stage: number): number {
  const s = Math.max(-2, Math.min(2, Math.round(stage)));
  return RESIST_MULT[s] ?? 1;
}

// ---- 상태 이상 (문서 §4: 속성마다 하나, 한 번에 하나) ----
export type StatusKind = "burn" | "wrap" | "crack" | "dizzy" | "soak";

export const STATUS_LABEL: Record<StatusKind, string> = {
  burn: "그슬림",
  wrap: "덩굴감김",
  crack: "균열",
  dizzy: "어지럼",
  soak: "흠뻑",
};

export const STATUS_META: Record<StatusKind, { element: Element; turns: number }> = {
  burn: { element: "fire", turns: 3 },
  wrap: { element: "grass", turns: 2 },
  crack: { element: "rock", turns: 3 },
  dizzy: { element: "wind", turns: 2 },
  soak: { element: "water", turns: 3 },
};

// ---- 기술 정의 ----
export type StatKey = "atk" | "def" | "spd" | "acc";

export interface StageEffect {
  target: "self" | "foe";
  stat: StatKey;
  stages: number; // +, -
  turns: number; // 지속 턴
}

export interface MoveDef {
  id: string;
  name: string;
  nameEn: string; // 9-C: AR 배틀 버튼 영어 표기
  element: MoveElement;
  power: number; // 0 = 비공격기
  accuracy: number; // 0~100
  hits: number; // 연타 수
  priority: boolean; // 선공
  cooldown: number; // 사용 후 쿨다운(턴)
  /** 연타 급소 판정: normal=단타와 동일, single=전타 1회, perHit=타마다 */
  critMode: "normal" | "single" | "perHit";
  status?: { kind: StatusKind; chance: number }; // 적중 시 상대에게 (0~1)
  stages?: StageEffect[];
  healPct?: number; // 자신 회복 (최대 HP %)
  cleanseStatus?: boolean; // 자신 상태 이상 해제
  cleanseDebuff?: boolean; // 자신 마이너스 단계 전부 해제(명중 포함)
  cleanseCrack?: boolean; // 자신 균열만 해제
  shieldTurns?: number; // 받는 피해 ×shieldFactor
  shieldFactor?: number;
  nextShieldFactor?: number; // 다음에 받는 1회 ×factor
  absorbNext?: number; // 다음에 받는 1회 n 비율 흡수(경감+회복)
  evadeNext?: number; // 다음에 받는 공격 회피율 (0~1)
  reflectBurnTurns?: number; // 공격해 온 상대에게 그슬림 반사
  reflectBurnChance?: number;
  reflectDmgTurns?: number; // 공격해 온 상대에게 최대 HP % 반사
  reflectDmgPct?: number;
  regenTurns?: number; // 턴 끝마다 HP % 회복
  regenPct?: number;
  critNext?: boolean; // 다음 공격 급소 확정
  rollCombo?: boolean; // 자갈이: 연속 사용 40→60→80
}

function base(
  id: string,
  name: string,
  nameEn: string,
  element: MoveElement,
  power: number,
  accuracy: number,
  cooldown: number
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
  };
}

// 칸 1: 기본기 (전 종 공용, 문서 §2)
export const BODY_SLAM: MoveDef = base("basic", "콩콩 들이받기", "Bonk Rush", "none", 40, 100, 0);

// 칸 2: 속성기 (문서 §3)
export const ELEMENT_SKILLS: Record<Element, MoveDef> = {
  fire: {
    ...base("elem-fire", "불씨 톡톡", "Ember Pop", "fire", 60, 95, 0),
    status: { kind: "burn", chance: 0.2 },
  },
  grass: {
    ...base("elem-grass", "새싹 부메랑", "Sprout Boomerang", "grass", 60, 95, 0),
    status: { kind: "wrap", chance: 0.2 },
  },
  rock: {
    ...base("elem-rock", "조약돌 튕기기", "Pebble Flick", "rock", 70, 85, 0),
    status: { kind: "crack", chance: 0.2 },
  },
  wind: {
    ...base("elem-wind", "회오리 콧바람", "Twirl Sneeze", "wind", 55, 100, 0),
    status: { kind: "dizzy", chance: 0.2 },
  },
  water: {
    ...base("elem-water", "물방울 퐁", "Bubble Pop", "water", 60, 95, 0),
    status: { kind: "soak", chance: 0.2 },
  },
};

// 칸 3: 역할기 (문서 §5, 쿨다운 2)
export const ROLE_SKILLS: Record<Role, MoveDef> = {
  attacker: {
    ...base("role-attacker", "근육 자랑", "Flex", "none", 0, 100, 2),
    stages: [{ target: "self", stat: "atk", stages: 1, turns: 3 }],
  },
  tanker: {
    ...base("role-tanker", "도토리 갑옷", "Acorn Armor", "none", 0, 100, 2),
    stages: [{ target: "self", stat: "def", stages: 1, turns: 3 }],
    nextShieldFactor: 0.8,
  },
  speed: {
    ...base("role-speed", "발끝 스텝", "Tiptoe Step", "none", 0, 100, 2),
    stages: [{ target: "self", stat: "spd", stages: 2, turns: 3 }],
  },
  supporter: {
    ...base("role-supporter", "응원가", "Cheer Song", "none", 0, 100, 2),
    healPct: 25,
    cleanseStatus: true,
  },
  trick: {
    ...base("role-trick", "메롱 도발", "Raspberry Taunt", "none", 0, 100, 2),
    stages: [{ target: "foe", stat: "atk", stages: -1, turns: 3 }],
  },
};

// ---- 피해 계산식 (문서 §4, M 보강) ----
// 피해 = max(1, round((위력/50)×ATK×공격단계×상성×저항(기술 속성)×자속×컨디션×난수 − DEF×방어단계×0.5))
// 급소 ×1.5는 공격항에 곱한다. 방패는 최종 피해에 곱한다.
// (M 보강 전 흠뻑+불 ×0.8은 "불 저항 +1"로 이동. 값은 같다.)
export interface DamageParams {
  power: number;
  atk: number;
  atkMult: number;
  def: number;
  defMult: number; // 균열 ×0.8 포함된 값으로 넘긴다
  edge: number;
  resist: number; // 받는 쪽의 기술 속성 저항 배율 (무속성 1)
  stab: number;
  cond: number;
  rand: number; // 0.9~1.1
  crit: boolean;
  shieldFactor: number; // 방패·흡수 합성 (1 = 없음)
}

export function calcDamage(p: DamageParams): number {
  const baseDmg =
    (p.power / 50) *
    p.atk *
    p.atkMult *
    p.edge *
    p.resist *
    p.stab *
    p.cond *
    p.rand;
  const crited = p.crit ? baseDmg * 1.5 : baseDmg;
  const raw = Math.max(1, Math.round(crited - p.def * p.defMult * 0.5));
  return Math.max(1, Math.round(raw * p.shieldFactor));
}
