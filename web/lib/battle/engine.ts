// lib/battle/engine.ts — G1: 턴 처리 순수 함수 엔진 (BATTLE_DESIGN §0·§4·§8·§9).
// 상태 + 행동 → 다음 상태 + 로그. 난수는 시드 RNG로 주입한다.
// 입력 상태를 바꾸지 않는다 (항상 새 객체 반환).

import {
  ROCK04_EXTRA_CRACK,
  baseStatsForBattle,
  buildMoveset,
  combatStats,
  conditionMultOf,
  recommendedBoosts,
  speciesOf,
  type Boosts,
  type CondInput,
} from "./roster";
import {
  STATUS_LABEL,
  STATUS_META,
  accMult,
  calcDamage,
  resistMult,
  stageMult,
  typeEdge,
  type Element,
  type MoveDef,
  type MoveElement,
  type Role,
  type StatKey,
  type StatusKind,
} from "./skills";
import { josa } from "../josa";
import { isDoublePassEnd, judgeByRatio, nextDoublePass } from "./timer";

export type { Boosts, CondInput, Element, MoveDef, MoveElement, Role, StatKey, StatusKind };
export { baseStatsForBattle, buildMoveset, recommendedBoosts, stageMult, accMult, typeEdge, resistMult };

// ---- 시드 난수 (mulberry32) ----
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 파이터 ----
export interface StageSet {
  atk: number;
  def: number;
  spd: number;
  acc: number;
}

export type ResistSet = Record<Element, number>;

const EMPTY_RESIST: ResistSet = { fire: 0, grass: 0, water: 0, rock: 0, wind: 0 };

// ---- 엔진 이벤트 로그 (문서 §4, §10-1이 읽는다) ----
// value는 항상 실제 HP 변화량(0·최대HP 클램프 뒤)이라
// 이벤트 합산 HP가 엔진 HP와 일치한다.
export type DamageEffect = "good" | "normal" | "bad";
export type StageLabel = "ATK" | "DEF" | "SPD" | "ACC";

export type BattleEvent =
  | { type: "damage"; target: Side; value: number; element: MoveElement; crit: boolean; effect: DamageEffect }
  | { type: "heal"; target: Side; value: number }
  | { type: "miss"; target: Side; reason: "dodge" | "dizzy" }
  | { type: "stage"; target: Side; stat: StageLabel; delta: number }
  | { type: "resist"; target: Side; element: Element; delta: number }
  | { type: "status-apply"; target: Side; status: StatusKind }
  | { type: "status-tick"; target: Side; status: StatusKind; value: number }
  | { type: "status-end"; target: Side; status: StatusKind }
  | { type: "faint"; target: Side };

export const STAT_LABEL: Record<StatKey, StageLabel> = {
  atk: "ATK",
  def: "DEF",
  spd: "SPD",
  acc: "ACC",
};

export interface Fighter {
  speciesId: string;
  name: string;
  element: Element;
  role: Role;
  level: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  cond: number; // 피해식 컨디션 배율
  affection: number; // §9 버팀·고유기 잠금 판정용
  hp: number;
  stages: StageSet;
  stageTurns: StageSet;
  resist: ResistSet;
  resistTurns: ResistSet;
  status: StatusKind | null;
  statusTurns: number;
  cooldowns: [number, number, number, number];
  shieldTurns: number;
  shieldFactor: number;
  nextShieldFactor: number | null;
  absorbNext: number | null;
  evadeNext: number | null;
  reflectBurnTurns: number;
  reflectBurnChance: number;
  reflectDmgTurns: number;
  reflectDmgPct: number;
  regenTurns: number;
  regenPct: number;
  critNext: boolean;
  rollCount: number; // 자갈이 연속 사용 횟수
  endureUsed: boolean;
}

export interface BattleSetup {
  level?: number;
  boosts?: Boosts; // 없으면 추천 배분
  cond?: CondInput; // 기본 {50,50,energy:50}
  condMult?: number; // 피해식 컨디션 (없으면 cond에서 계산)
  affection?: number; // 기본 cond.affection
}

export type Side = "mine" | "wild";

export interface BattleState {
  turn: number; // 1~10
  mine: Fighter;
  wild: Fighter;
  over: boolean;
  winner: Side | null;
  log: string[];
  /** BT-T: 양쪽 패스 연속 횟수 (미지정=0). 패스가 없으면 키 자체가 없다. */
  doublePass?: number;
}

const DEFAULT_COND: CondInput = { fullness: 50, affection: 50, energy: 50 };

function makeFighter(speciesId: string, setup: BattleSetup): Fighter {
  const meta = speciesOf(speciesId);
  const level = Math.max(1, Math.floor(setup.level ?? 10));
  const cond = { ...DEFAULT_COND, ...(setup.cond ?? {}) };
  const boosts = setup.boosts ?? recommendedBoosts(meta.role, level);
  const st = combatStats(speciesId, level, boosts, cond);
  const affection = setup.affection ?? cond.affection;
  return {
    speciesId,
    name: meta.name,
    element: meta.element,
    role: meta.role,
    level,
    maxHp: st.maxHp,
    atk: st.atk,
    def: st.def,
    spd: st.spd,
    cond: setup.condMult ?? conditionMultOf(cond.fullness, cond.energy ?? 50, cond.affection),
    affection,
    hp: st.maxHp,
    stages: { atk: 0, def: 0, spd: 0, acc: 0 },
    stageTurns: { atk: 0, def: 0, spd: 0, acc: 0 },
    resist: { ...EMPTY_RESIST },
    resistTurns: { ...EMPTY_RESIST },
    status: null,
    statusTurns: 0,
    cooldowns: [0, 0, 0, 0],
    shieldTurns: 0,
    shieldFactor: 1,
    nextShieldFactor: null,
    absorbNext: null,
    evadeNext: null,
    reflectBurnTurns: 0,
    reflectBurnChance: 0,
    reflectDmgTurns: 0,
    reflectDmgPct: 0,
    regenTurns: 0,
    regenPct: 0,
    critNext: false,
    rollCount: 0,
    endureUsed: false,
  };
}

export function createBattle(mineId: string, wildId: string, setup: BattleSetup = {}): BattleState {
  return {
    turn: 1,
    mine: makeFighter(mineId, setup),
    wild: makeFighter(wildId, setup),
    over: false,
    winner: null,
    log: [],
  };
}

function cloneFighter(f: Fighter): Fighter {
  return {
    ...f,
    stages: { ...f.stages },
    stageTurns: { ...f.stageTurns },
    resist: { ...f.resist },
    resistTurns: { ...f.resistTurns },
    cooldowns: [...f.cooldowns] as [number, number, number, number],
  };
}

function cloneState(s: BattleState): BattleState {
  return { ...s, mine: cloneFighter(s.mine), wild: cloneFighter(s.wild), log: s.log };
}

// ---- 파생 배율 ----
export function atkMultOf(f: Fighter): number {
  return stageMult(f.stages.atk);
}

export function defMultOf(f: Fighter): number {
  return stageMult(f.stages.def) * (f.status === "crack" ? 0.8 : 1);
}

export function spdOf(f: Fighter): number {
  return f.spd * stageMult(f.stages.spd) * (f.status === "soak" ? 0.8 : 1);
}

// ---- 순수 헬퍼 (엔진 내부 + 검증용) ----

// 단계 적용: 합산 후 ±2(명중은 −2~0)로 자르고 지속 초기화.
export function applyStageTo(f: Fighter, stat: StatKey, stages: number, turns: number): Fighter {
  const n = cloneFighter(f);
  if (stat === "acc") {
    n.stages.acc = Math.max(-2, Math.min(0, n.stages.acc + stages));
    n.stageTurns.acc = turns;
    if (n.stages.acc === 0) n.stageTurns.acc = 0;
  } else {
    n.stages[stat] = Math.max(-2, Math.min(2, n.stages[stat] + stages));
    n.stageTurns[stat] = turns;
    if (n.stages[stat] === 0) n.stageTurns[stat] = 0;
  }
  return n;
}

// 상태 적용: 개수 1개, 같은 속성은 면역. 성공 여부를 돌린다.
export function applyStatusTo(
  f: Fighter,
  kind: StatusKind
): { fighter: Fighter; applied: boolean; reason: "ok" | "occupied" | "immune" } {
  if (f.status !== null) return { fighter: f, applied: false, reason: "occupied" };
  if (f.element === STATUS_META[kind].element)
    return { fighter: f, applied: false, reason: "immune" };
  const n = cloneFighter(f);
  n.status = kind;
  n.statusTurns = STATUS_META[kind].turns;
  return { fighter: n, applied: true, reason: "ok" };
}

// 저항 적용: 합산 후 ±2로 자르고 지속 초기화. 실제 변화량을 돌린다.
export function applyResistTo(
  f: Fighter,
  element: Element,
  delta: number,
  turns: number
): { fighter: Fighter; applied: number } {
  const n = cloneFighter(f);
  const before = n.resist[element];
  n.resist[element] = Math.max(-2, Math.min(2, before + delta));
  n.resistTurns[element] = turns;
  if (n.resist[element] === 0) n.resistTurns[element] = 0;
  return { fighter: n, applied: n.resist[element] - before };
}

// 받는 쪽의 기술 속성 저항 배율 (무속성 1).
export function resistOf(foe: Fighter, moveEl: MoveElement): number {
  if (moveEl === "none") return 1;
  return resistMult(foe.resist[moveEl]);
}

export function effectOf(edge: number): DamageEffect {
  return edge > 1 ? "good" : edge < 1 ? "bad" : "normal";
}

// ---- 행동 가능 여부 (레벨 해금 §2 + 애정 잠금 §9 + 쿨다운) ----
export function isSlotLegal(f: Fighter, slot: number): boolean {
  if (slot < 0 || slot > 3 || !Number.isInteger(slot)) return false;
  if (slot === 2 && f.level < 5) return false;
  if (slot === 3 && f.level < 10) return false;
  if (slot === 3 && f.affection < 20) return false;
  if (f.cooldowns[slot] > 0) return false;
  return true;
}

export function legalSlots(f: Fighter): number[] {
  return [0, 1, 2, 3].filter((s) => isSlotLegal(f, s));
}

// 자갈이 데굴데굴 위력: 연속 40→60→80.
export function rollPower(f: Fighter): number {
  return [40, 60, 80][Math.min(f.rollCount, 2)];
}

function other(side: Side): Side {
  return side === "mine" ? "wild" : "mine";
}

function decideOrder(mine: Fighter, mMove: MoveDef, wild: Fighter, wMove: MoveDef): Side[] {
  if (mMove.priority !== wMove.priority) return mMove.priority ? ["mine", "wild"] : ["wild", "mine"];
  return spdOf(mine) >= spdOf(wild) ? ["mine", "wild"] : ["wild", "mine"];
}

function stabOf(move: MoveDef, actor: Fighter): number {
  if (move.element === "none") return 1;
  return move.element === actor.element ? 1.2 : 1;
}

// 예상 피해 (AI 랭킹용: 난수 1, 급소 없음, 연타 합산).
export function estimateDamage(actor: Fighter, foe: Fighter, move: MoveDef, slot: number): number {
  const power = move.rollCombo ? rollPower(actor) : move.power;
  if (power <= 0) return 0;
  const edge = typeEdge(move.element, foe.element);
  let shield = 1;
  if (foe.shieldTurns > 0) shield *= foe.shieldFactor;
  if (foe.nextShieldFactor !== null) shield *= foe.nextShieldFactor;
  if (foe.absorbNext !== null) shield *= 1 - foe.absorbNext;
  const one = calcDamage({
    power,
    atk: actor.atk,
    atkMult: atkMultOf(actor),
    def: foe.def,
    defMult: defMultOf(foe),
    edge,
    resist: resistOf(foe, move.element),
    stab: stabOf(move, actor),
    cond: actor.cond,
    rand: 1,
    crit: false,
    shieldFactor: shield,
  });
  void slot;
  return one * move.hits;
}

interface Mutable {
  st: BattleState;
  logs: string[];
  events: BattleEvent[];
  fainted: Set<Side>;
}

// ---- 이벤트 방출 HP 헬퍼 (값은 실제 변화량) ----
function emitFaint(m: Mutable, target: Side): void {
  if (m.st[target].hp <= 0 && !m.fainted.has(target)) {
    m.fainted.add(target);
    m.events.push({ type: "faint", target });
  }
}

// raw 피해를 입히고 damage 이벤트를 낸다. 실제 감소량을 돌린다.
function dealDamage(
  m: Mutable,
  target: Side,
  raw: number,
  info: { element: MoveElement; crit: boolean; effect: DamageEffect }
): number {
  const f = m.st[target];
  const before = f.hp;
  f.hp = Math.max(0, f.hp - Math.max(0, Math.round(raw)));
  const delta = before - f.hp;
  if (delta > 0) {
    m.events.push({ type: "damage", target, value: delta, element: info.element, crit: info.crit, effect: info.effect });
  }
  emitFaint(m, target);
  return delta;
}

// raw 회복을 하고 heal 이벤트를 낸다. 실제 회복량을 돌린다.
function restoreHp(m: Mutable, target: Side, raw: number): number {
  const f = m.st[target];
  if (f.hp <= 0) return 0;
  const before = f.hp;
  f.hp = Math.min(f.maxHp, f.hp + Math.max(0, Math.round(raw)));
  const delta = f.hp - before;
  if (delta > 0) m.events.push({ type: "heal", target, value: delta });
  return delta;
}

// 상태 부여 + status-apply. 흠뻑은 불 저항 +1도 함께 건다 (값은 예전 ×0.8과 같다).
function inflictStatus(m: Mutable, target: Side, kind: StatusKind): boolean {
  const r = applyStatusTo(m.st[target], kind);
  m.st[target] = r.fighter;
  if (!r.applied) {
    if (r.reason === "immune") m.logs.push(`${josa(m.st[target].name, "은는")} ${STATUS_LABEL[kind]}에 걸리지 않는다.`);
    return false;
  }
  m.events.push({ type: "status-apply", target, status: kind });
  m.logs.push(`${josa(m.st[target].name, "은는")} ${STATUS_LABEL[kind]}에 걸렸다!`);
  if (kind === "soak") shiftResist(m, target, "fire", 1, 3);
  return true;
}

// 단계 변화 + stage. 실제 변화가 없으면 조용하다.
function shiftStage(m: Mutable, target: Side, stat: StatKey, delta: number, turns: number): number {
  const f = m.st[target];
  if (f.hp <= 0) return 0;
  const before = f.stages[stat];
  m.st[target] = applyStageTo(f, stat, delta, turns);
  const after = m.st[target].stages[stat];
  const applied = after - before;
  if (applied !== 0) m.events.push({ type: "stage", target, stat: STAT_LABEL[stat], delta: applied });
  return applied;
}

function shiftResist(m: Mutable, target: Side, element: Element, delta: number, turns: number): number {
  const f = m.st[target];
  if (f.hp <= 0) return 0;
  const r = applyResistTo(f, element, delta, turns);
  m.st[target] = r.fighter;
  if (r.applied !== 0) m.events.push({ type: "resist", target, element, delta: r.applied });
  return r.applied;
}

// 상태 해제 + status-end. kind가 있으면 그 상태만.
function clearStatus(m: Mutable, target: Side, kind?: StatusKind): boolean {
  const f = m.st[target];
  if (f.status === null) return false;
  if (kind !== undefined && f.status !== kind) return false;
  const ended = f.status;
  f.status = null;
  f.statusTurns = 0;
  m.events.push({ type: "status-end", target, status: ended });
  m.logs.push(`${f.name}의 ${josa(STATUS_LABEL[ended], "이가")} 풀렸다.`);
  return true;
}

function execAction(m: Mutable, side: Side, slot: number, move: MoveDef, rng: Rng): void {
  const actor = m.st[side];
  const foeSide = other(side);
  const foe = m.st[foeSide];

  // 어지럼: 25% 행동 실패.
  if (actor.status === "dizzy" && rng() < 0.25) {
    m.logs.push(`${josa(actor.name, "은는")} 어지러워 움직이지 못했다!`);
    m.events.push({ type: "miss", target: side, reason: "dizzy" });
    actor.rollCount = 0;
    return;
  }

  // 회피(잔디 질주): 다음 받는 공격 1회에 소비.
  let hitCh = (move.accuracy / 100) * accMult(actor.stages.acc);
  if (move.power > 0 && foe.evadeNext !== null) {
    hitCh *= 1 - foe.evadeNext;
    foe.evadeNext = null;
  }
  const landed = rng() < hitCh;
  actor.cooldowns[slot] = move.cooldown;
  if (!landed) {
    m.logs.push(`${actor.name}의 ${move.name}! …빗나갔다.`);
    m.events.push({ type: "miss", target: foeSide, reason: "dodge" });
    actor.rollCount = 0;
    return;
  }

  const isRoll = move.rollCombo === true;
  if (!isRoll) actor.rollCount = 0;

  // 비공격기: 효과만 적용.
  if (move.power <= 0) {
    m.logs.push(`${actor.name}의 ${move.name}!`);
    applyMoveEffects(m, side, move, rng, true);
    return;
  }

  // 공격기: 연타 루프.
  const power = isRoll ? rollPower(actor) : move.power;
  const singleCrit = move.critMode === "single" ? actor.critNext || rng() < 0.0625 : false;
  let hitLanded = false;
  for (let h = 0; h < move.hits; h++) {
    if (foe.hp <= 0) break;
    const rand = 0.9 + rng() * 0.2;
    const crit =
      move.critMode === "perHit"
        ? actor.critNext || rng() < 0.0625
        : move.critMode === "single"
          ? singleCrit
          : actor.critNext || rng() < 0.0625;
    const edge = typeEdge(move.element, foe.element);
    const effect = effectOf(edge);
    let shield = 1;
    if (foe.shieldTurns > 0) shield *= foe.shieldFactor;
    if (foe.nextShieldFactor !== null) shield *= foe.nextShieldFactor;
    let dmg = calcDamage({
      power,
      atk: actor.atk,
      atkMult: atkMultOf(actor),
      def: foe.def,
      defMult: defMultOf(foe),
      edge,
      resist: resistOf(foe, move.element),
      stab: stabOf(move, actor),
      cond: actor.cond,
      rand,
      crit,
      shieldFactor: shield,
    });
    // 폭신 구름 흡수: 피해 절반 + 흡수량 회복.
    if (foe.absorbNext !== null) {
      const absorbed = Math.round(dmg * foe.absorbNext);
      dmg = dmg - absorbed;
      foe.absorbNext = null;
      restoreHp(m, foeSide, absorbed);
      m.logs.push(`${josa(foe.name, "은는")} 구름으로 ${absorbed}을 흡수했다!`);
    }
    if (foe.nextShieldFactor !== null) foe.nextShieldFactor = null;
    // §9 애정 버팀: HP 1에서 1회.
    let dealt: number;
    if (foe.hp - dmg <= 0 && foe.affection >= 70 && !foe.endureUsed && foe.hp > 1) {
      foe.endureUsed = true;
      dealt = dealDamage(m, foeSide, foe.hp - 1, { element: move.element, crit, effect });
      m.logs.push(`${josa(foe.name, "은는")} 트레이너를 위해 버텼다! (HP 1)`);
    } else {
      dealt = dealDamage(m, foeSide, dmg, { element: move.element, crit, effect });
    }
    hitLanded = true;
    const edgeTxt = edge > 1 ? " 약점 공략!" : edge < 1 ? " 버텼다" : ""; // BP-4 배지 문구와 통일
    const critTxt = crit ? " 치명타!" : ""; // BP-4
    m.logs.push(
      move.hits > 1
        ? `${actor.name}의 ${move.name}! ${h + 1}타 ${dealt} 피해.${critTxt}${edgeTxt}`
        : `${actor.name}의 ${move.name}! ${dealt} 피해.${critTxt}${edgeTxt}`
    );
    if (foe.hp <= 0) break;
  }
  if (actor.critNext) actor.critNext = false;

  if (isRoll) {
    if (hitLanded) actor.rollCount += 1;
    else actor.rollCount = 0;
  }

  // 적중 시 부가 효과 (연타는 1회).
  if (hitLanded && foe.hp > 0) applyMoveEffects(m, side, move, rng, false);

  // 반사 (가시·용암): 공격자가 때리고 살아남았을 때.
  if (hitLanded && m.st[foeSide].hp > 0 && m.st[side].hp > 0) {
    if (m.st[foeSide].reflectBurnTurns > 0 && rng() < m.st[foeSide].reflectBurnChance) {
      if (inflictStatus(m, side, "burn")) m.logs.push(`${m.st[side].name}에게 그슬림이 옮았다!`);
    }
    if (m.st[foeSide].reflectDmgTurns > 0 && m.st[side].hp > 0) {
      const a = m.st[side];
      const back = Math.max(1, Math.round(a.maxHp * (m.st[foeSide].reflectDmgPct / 100)));
      const dealtBack = dealDamage(m, side, back, { element: "none", crit: false, effect: "normal" });
      m.logs.push(`${josa(a.name, "은는")} 가시에 ${dealtBack} 피해!`);
    }
  }
}

// 기술 부가 효과. nonDamaging이 true면 명중 판정 뒤 호출.
function applyMoveEffects(m: Mutable, side: Side, move: MoveDef, rng: Rng, _nonDamaging: boolean): void {
  void _nonDamaging;

  if (move.status && m.st[other(side)].hp > 0) {
    const { kind, chance } = move.status;
    if (rng() < chance) inflictStatus(m, other(side), kind);
    // 동굴박쥐 삑삑 레이더: 어지럼이 안 들어가고(면역) 빈 슬롯이면 균열 30%.
    if (move.id === "uniq-rock-04" && m.st[other(side)].status === null && rng() < ROCK04_EXTRA_CRACK) {
      if (inflictStatus(m, other(side), "crack")) {
        m.logs.push(`${m.st[other(side)].name}에게 균열이 생겼다!`);
      }
    }
  }

  for (const e of move.stages ?? []) {
    const targetSide = e.target === "self" ? side : other(side);
    const before = m.st[targetSide].stages[e.stat];
    shiftStage(m, targetSide, e.stat, e.stages, e.turns);
    const after = m.st[targetSide].stages[e.stat];
    const label = e.stat === "atk" ? "공격" : e.stat === "def" ? "방어" : e.stat === "spd" ? "스피드" : "명중";
    const arrow = after > before ? "▲" : after < before ? "▼" : "·";
    m.logs.push(`${m.st[targetSide].name}의 ${label} ${arrow} (${after > 0 ? "+" : ""}${after})`);
  }

  if (move.healPct && m.st[side].hp > 0) {
    const healed = restoreHp(m, side, Math.round(m.st[side].maxHp * (move.healPct / 100)));
    m.logs.push(`${josa(m.st[side].name, "은는")} HP ${healed} 회복!`);
  }
  if (move.cleanseStatus) clearStatus(m, side);
  if (move.cleanseCrack && clearStatus(m, side, "crack")) {
    m.logs.push(`${m.st[side].name}의 균열이 메워졌다.`);
  }
  if (move.cleanseDebuff) {
    let cleared = false;
    for (const k of ["atk", "def", "spd", "acc"] as StatKey[]) {
      const cur = m.st[side].stages[k];
      if (cur < 0) {
        m.st[side].stages[k] = 0;
        m.st[side].stageTurns[k] = 0;
        m.events.push({ type: "stage", target: side, stat: STAT_LABEL[k], delta: -cur });
        cleared = true;
      }
    }
    if (cleared) m.logs.push(`${m.st[side].name}의 약화가 풀렸다.`);
  }
  const actor = m.st[side]; // 위에서 교체됐을 수 있어 새로 읽는다.
  if (move.shieldTurns) {
    actor.shieldTurns = move.shieldTurns;
    actor.shieldFactor = move.shieldFactor ?? 1;
    m.logs.push(`${josa(actor.name, "은는")} 방패를 둘렀다!`);
  }
  if (move.nextShieldFactor !== undefined && move.nextShieldFactor !== null) {
    actor.nextShieldFactor = move.nextShieldFactor;
  }
  if (move.absorbNext !== undefined && move.absorbNext !== null) {
    actor.absorbNext = move.absorbNext;
  }
  if (move.evadeNext !== undefined && move.evadeNext !== null) {
    actor.evadeNext = move.evadeNext;
  }
  if (move.reflectBurnTurns) {
    actor.reflectBurnTurns = move.reflectBurnTurns;
    actor.reflectBurnChance = move.reflectBurnChance ?? 0;
  }
  if (move.reflectDmgTurns) {
    actor.reflectDmgTurns = move.reflectDmgTurns;
    actor.reflectDmgPct = move.reflectDmgPct ?? 0;
  }
  if (move.regenTurns) {
    actor.regenTurns = move.regenTurns;
    actor.regenPct = move.regenPct ?? 0;
    m.logs.push(`${josa(actor.name, "은는")} 뿌리를 내렸다!`);
  }
  if (move.critNext) actor.critNext = true;
}

function endOfTurn(m: Mutable): void {
  for (const side of ["mine", "wild"] as Side[]) {
    const f = m.st[side];
    const foeSide = other(side);
    if (f.hp <= 0) continue;
    // 상태 틱.
    if (f.status === "burn") {
      const before = f.hp;
      f.hp = Math.max(0, f.hp - Math.max(1, Math.round(f.maxHp * 0.06)));
      const delta = before - f.hp;
      if (delta > 0) m.events.push({ type: "status-tick", target: side, status: "burn", value: delta });
      emitFaint(m, side);
      m.logs.push(`${josa(f.name, "은는")} 그슬림으로 ${delta} 피해.`);
    } else if (f.status === "wrap") {
      const before = f.hp;
      f.hp = Math.max(0, f.hp - Math.max(1, Math.round(f.maxHp * 0.04)));
      const delta = before - f.hp;
      if (delta > 0) m.events.push({ type: "status-tick", target: side, status: "wrap", value: delta });
      emitFaint(m, side);
      if (m.st[foeSide].hp > 0 && delta > 0) {
        restoreHp(m, foeSide, delta);
        m.logs.push(`${josa(f.name, "은는")} 휘감겨 ${delta} 흡수됐다.`);
      } else {
        m.logs.push(`${josa(f.name, "은는")} 휘감겨 ${delta} 피해.`);
      }
    }
    // 재생.
    if (f.regenTurns > 0 && f.hp > 0) {
      const healed = restoreHp(m, side, Math.round(f.maxHp * (f.regenPct / 100)));
      m.logs.push(`${josa(f.name, "은는")} 뿌리에서 ${healed} 회복.`);
    }
  }
  // 지속 감소.
  for (const side of ["mine", "wild"] as Side[]) {
    const f = m.st[side];
    (["atk", "def", "spd", "acc"] as StatKey[]).forEach((k) => {
      if (f.stageTurns[k] > 0) {
        f.stageTurns[k] -= 1;
        if (f.stageTurns[k] === 0 && f.stages[k] !== 0) {
          m.events.push({ type: "stage", target: side, stat: STAT_LABEL[k], delta: -f.stages[k] });
          f.stages[k] = 0;
        }
      }
    });
    (["fire", "grass", "water", "rock", "wind"] as Element[]).forEach((el) => {
      if (f.resistTurns[el] > 0) {
        f.resistTurns[el] -= 1;
        if (f.resistTurns[el] === 0 && f.resist[el] !== 0) {
          m.events.push({ type: "resist", target: side, element: el, delta: -f.resist[el] });
          f.resist[el] = 0;
        }
      }
    });
    if (f.statusTurns > 0) {
      f.statusTurns -= 1;
      if (f.statusTurns === 0 && f.status !== null) {
        m.events.push({ type: "status-end", target: side, status: f.status });
        m.logs.push(`${f.name}의 ${josa(STATUS_LABEL[f.status], "이가")} 풀렸다.`);
        f.status = null;
      }
    }
    if (f.shieldTurns > 0) {
      f.shieldTurns -= 1;
      if (f.shieldTurns === 0) f.shieldFactor = 1;
    }
    if (f.reflectBurnTurns > 0) f.reflectBurnTurns -= 1;
    if (f.reflectDmgTurns > 0) f.reflectDmgTurns -= 1;
    if (f.regenTurns > 0) f.regenTurns -= 1;
    for (let i = 0; i < 4; i++) if (f.cooldowns[i] > 0) f.cooldowns[i] -= 1;
  }
}

function decideByRatio(m: Mutable): void {
  const { mine, wild } = m.st;
  const mr = mine.hp / mine.maxHp;
  const wr = wild.hp / wild.maxHp;
  // 동률은 트레이너 쪽(mine). 전체 행렬에 거울 대진이 있어 상쇄된다.
  m.st.winner = mr >= wr ? "mine" : "wild";
  m.st.over = true;
}

/** BT-T: 시간 초과 패스 슬롯 (행동 없음, 턴은 진행). */
export const PASS_SLOT = -1;

// ---- 턴 진행 (순수) ----
export function applyTurn(
  s: BattleState,
  mineSlot: number,
  wildSlot: number,
  rng: Rng
): { state: BattleState; logs: string[]; events: BattleEvent[]; order: Side[]; beatEnds: number[] } {
  // BT-3: order·beatEnds는 표시용 메타(선공 순서·행동별 이벤트 경계). 계산 무변경.
  if (s.over) return { state: s, logs: [], events: [], order: [], beatEnds: [] };
  const st = cloneState(s);
  st.log = [...s.log];
  const m: Mutable = { st, logs: [], events: [], fainted: new Set<Side>() };

  // BT-T: -1은 패스 (실패 폴백 없음). 패스 없으면 아래 전부 기존 경로 그대로.
  const minePassed = mineSlot === PASS_SLOT;
  const wildPassed = wildSlot === PASS_SLOT;
  let ms = minePassed ? PASS_SLOT : isSlotLegal(st.mine, mineSlot) ? mineSlot : 0;
  let ws = wildPassed ? PASS_SLOT : isSlotLegal(st.wild, wildSlot) ? wildSlot : 0;
  if (!minePassed && ms !== mineSlot) m.logs.push(`${st.mine.name}의 기술 선택 실패 → 콩콩 들이받기.`);
  if (!wildPassed && ws !== wildSlot) m.logs.push(`${st.wild.name}의 기술 선택 실패 → 콩콩 들이받기.`);
  // 패스가 있거나 카운터가 0이 아니면 갱신 (일반 턴 리셋 포함). 둘 다 아니면 키 없음 유지.
  const prevDouble = st.doublePass ?? 0;
  if (minePassed || wildPassed || prevDouble !== 0) {
    st.doublePass = nextDoublePass(prevDouble, minePassed, wildPassed);
  }
  const mMoves = buildMoveset(st.mine.speciesId);
  const wMoves = buildMoveset(st.wild.speciesId);

  // 패스한 쪽은 순서 맨 뒤에서 빈 박자로 쉰다.
  const order: Side[] = [];
  if (!minePassed && !wildPassed) {
    order.push(...decideOrder(st.mine, mMoves[ms], st.wild, wMoves[ws]));
  } else {
    if (!minePassed) order.push("mine");
    if (!wildPassed) order.push("wild");
    if (minePassed) order.push("mine");
    if (wildPassed) order.push("wild");
  }
  const beatEnds: number[] = [];
  for (const side of order) {
    if (m.st.over) break;
    const foe = m.st[other(side)];
    const actor = m.st[side];
    if (actor.hp <= 0 || foe.hp <= 0) { beatEnds.push(m.events.length); continue; }
    if ((side === "mine" ? minePassed : wildPassed)) {
      m.logs.push(`${josa(actor.name, "은는")} 쉬었다.`);
      beatEnds.push(m.events.length);
      continue;
    }
    execAction(m, side, side === "mine" ? ms : ws, side === "mine" ? mMoves[ms] : wMoves[ws], rng);
    beatEnds.push(m.events.length);
    const a = m.st[side];
    const f = m.st[other(side)];
    if (f.hp <= 0 && a.hp <= 0) {
      decideByRatio(m);
      m.logs.push("동시에 쓰러졌다!");
      break;
    } else if (f.hp <= 0) {
      m.st.winner = side;
      m.st.over = true;
      m.logs.push(`${josa(f.name, "은는")} 쓰러졌다! ${a.name} 승리.`);
      break;
    } else if (a.hp <= 0) {
      m.st.winner = other(side);
      m.st.over = true;
      m.logs.push(`${josa(a.name, "은는")} 쓰러졌다! ${f.name} 승리.`);
      break;
    }
  }

  if (!m.st.over) {
    endOfTurn(m);
    const { mine, wild } = m.st;
    if (mine.hp <= 0 || wild.hp <= 0) {
      if (mine.hp <= 0 && wild.hp <= 0) m.logs.push("동시에 쓰러졌다!");
      decideByRatio(m);
    } else if (isDoublePassEnd(m.st.doublePass ?? 0)) {
      const v = judgeByRatio(mine.hp, mine.maxHp, wild.hp, wild.maxHp);
      m.st.winner = v === "draw" ? null : v;
      m.st.over = true;
      m.logs.push(
        v === "draw" ? "시간 종료 — 무승부." : `시간 종료 — ${(v === "mine" ? mine : wild).name} 판정승.`
      );
    } else if (m.st.turn >= 10) {
      m.logs.push("10턴 종료. 남은 HP 비율로 승패를 가른다.");
      decideByRatio(m);
    } else {
      m.st.turn += 1;
    }
  }

  m.st.log = [...m.st.log, ...m.logs];
  return { state: m.st, logs: m.logs, events: m.events, order, beatEnds };
}

// ---- 야생 AI (문서 §8) ----
export function decideAiSlot(fighter: Fighter, foe: Fighter, rng: Rng): number {
  const moves = buildMoveset(fighter.speciesId);
  const legal = legalSlots(fighter);
  if (legal.length === 0) return 0;

  // 1. HP 30% 미만 + 회복기 → 50%.
  if (fighter.hp < fighter.maxHp * 0.3) {
    const heals = legal.filter((s) => (moves[s].healPct ?? 0) > 0 || (moves[s].regenTurns ?? 0) > 0);
    if (heals.length > 0 && rng() < 0.5) {
      heals.sort((a, b) => (moves[b].healPct ?? 0) - (moves[a].healPct ?? 0));
      return heals[0];
    }
  }

  // 2. 이번 턴 KO 가능기.
  let koSlot = -1;
  let koDmg = 0;
  for (const s of legal) {
    if (moves[s].power <= 0) continue;
    const est = estimateDamage(fighter, foe, moves[s], s);
    if (est >= foe.hp && est > koDmg) {
      koDmg = est;
      koSlot = s;
    }
  }
  if (koSlot >= 0) return koSlot;

  // 3. 기대 피해 최대 70% / 보조 20% / 무작위 10%.
  const attackers = legal.filter((s) => moves[s].power > 0);
  const aux = legal.filter((s) => moves[s].power <= 0);
  const r = rng();
  if (r < 0.7 || aux.length === 0) {
    if (attackers.length === 0) return legal[Math.floor(rng() * legal.length)];
    let best = attackers[0];
    let bestVal = -1;
    for (const s of attackers) {
      const val = estimateDamage(fighter, foe, moves[s], s) * (moves[s].accuracy / 100);
      if (val > bestVal) {
        bestVal = val;
        best = s;
      }
    }
    return best;
  }
  if (r < 0.9) return aux[Math.floor(rng() * aux.length)];
  return legal[Math.floor(rng() * legal.length)];
}

// ---- 풀 게임 (양쪽 AI, 검증용) ----
export interface GameResult {
  winner: Side;
  turns: number;
  mineHp: number;
  wildHp: number;
}

// ---- 9-F: 사물 기준 도망 (원점=배틀 시작 위치, m 단위) ----
export const FLEE_DIST_M = 10; // 이 이상 멀어지면 도망
export const FLEE_WARN_M = 7; // 이 이상이면 도망 전 경고
export type FleeStatus = "ok" | "warn" | "flee";
export function fleeStatus(distM: number): FleeStatus {
  if (!Number.isFinite(distM) || distM < 0) return "ok";
  if (distM >= FLEE_DIST_M) return "flee";
  if (distM >= FLEE_WARN_M) return "warn";
  return "ok";
}

export function simulateGame(
  mineId: string,
  wildId: string,
  seed: number,
  setup: BattleSetup = {}
): GameResult {
  const rng = createRng(seed);
  let st = createBattle(mineId, wildId, setup);
  let guard = 0;
  while (!st.over && guard++ < 12) {
    const ms = decideAiSlot(st.mine, st.wild, rng);
    const ws = decideAiSlot(st.wild, st.mine, rng);
    st = applyTurn(st, ms, ws, rng).state;
  }
  return {
    winner: st.winner ?? "mine",
    turns: st.turn,
    mineHp: st.mine.hp,
    wildHp: st.wild.hp,
  };
}
