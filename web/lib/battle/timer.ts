// lib/battle/timer.ts — BT-T: 턴 타이머·자동 패스·시간 종료 (순수 함수, 가짜 시계 테스트용).
// nowMs를 인자로 받는다. 화면· driving 상태는 호출 쪽(pov)이 주입한다.

export const ACCEPT_WAIT_S = 15; // 수락 요청 대기 (지나면 자동 취소)
export const TURN_S = 20; // PvP 턴 제한 (초과 = 패스)
export const MAX_DOUBLE_PASS = 3; // 양쪽 패스 연속 N턴이면 종료
export const WILD_TURN_S = 15; // 야생 방치 제한 (행동 없으면 패스, AF-3/6: 30초 방치면 달아남)
export const WILD_IDLE_TURNS = 2; // 야생 연속 패스 N번이면 달아남

export type TimeoutResult = "mine" | "wild" | "draw";

/** 턴 마감 여부: startedMs + limitS 지났으면 true. */
export function isTurnExpired(startedMs: number, limitS: number, nowMs: number): boolean {
  return nowMs - startedMs >= limitS * 1000;
}

/** 남은 초 (driving 정지 중 누적 pausedMs만큼 연장). 0 미만은 0. */
export function turnRemainingSec(
  startedMs: number,
  limitS: number,
  pausedMs: number,
  nowMs: number
): number {
  return Math.max(0, Math.ceil((startedMs + pausedMs + limitS * 1000 - nowMs) / 1000));
}

/** 양쪽 패스 연속 횟수 갱신: 둘 다 패스해야 +1, 아니면 0. */
export function nextDoublePass(prev: number, minePassed: boolean, wildPassed: boolean): number {
  return minePassed && wildPassed ? prev + 1 : 0;
}

/** 양쪽 패스 연속으로 종료인지. */
export function isDoublePassEnd(doublePass: number): boolean {
  return doublePass >= MAX_DOUBLE_PASS;
}

/** HP 비율 판정: 높은 쪽 승, 동률이면 무승부. */
export function judgeByRatio(
  mineHp: number,
  mineMax: number,
  wildHp: number,
  wildMax: number
): TimeoutResult {
  const mr = mineMax > 0 ? mineHp / mineMax : 0;
  const wr = wildMax > 0 ? wildHp / wildMax : 0;
  if (mr === wr) return "draw";
  return mr > wr ? "mine" : "wild";
}

/** 수락 요청 만료 여부. */
export function isAcceptExpired(requestedMs: number, nowMs: number): boolean {
  return nowMs - requestedMs >= ACCEPT_WAIT_S * 1000;
}

export type WildIdle = "acted" | "pass" | "fled";

/**
 * 야생 방치 판정: 마지막 행동 후 idleMs.
 * WILD_TURN_S 미만이면 "acted"(아직 시간 남음),
 * 넘었으면 passes+1하고 WILD_IDLE_TURNS 도달 시 "fled", 아니면 "pass".
 * 반환 [판정, 새 passes].
 */
export function wildIdleStep(idleMs: number, passes: number): [WildIdle, number] {
  if (idleMs < WILD_TURN_S * 1000) return ["acted", passes];
  const next = passes + 1;
  return next >= WILD_IDLE_TURNS ? ["fled", next] : ["pass", next];
}
