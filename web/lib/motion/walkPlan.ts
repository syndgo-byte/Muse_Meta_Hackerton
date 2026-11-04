// 7-C: 인도 따라 걷기 + 뒤돌아보기 계획. 순수 함수 (타이머·저장소 없음).
// 호출자(page.tsx 2차)가 nextLookBackAt·lookBackUntil을 들고 매 틱 rand를 준다.
// 말풍선·emote는 뒤돌아보는 동안 매 틱 다시 나오므로, 호출자가
// lookBack 상승 엣지에서만 표시한다.
import { laneAt, type SimVideo } from "./simPath";
import type { EmoteId } from "./emotes";

export const LOOKBACK_EVERY_MIN = 15;
export const LOOKBACK_EVERY_MAX = 25;
export const LOOKBACK_HOLD_S = 1.5;
export const AFFECTION_WARM = 50;
export const FULLNESS_HUNGRY = 30;

export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WalkInput {
  now: number; // 초
  mode: "sim" | "cam";
  video: SimVideo; // sim에서 사용
  videoTime: number; // sim에서 사용 (초)
  userMoving: boolean; // sim=영상 재생 중, cam=걸음 감지
  laneX: number; // 크리처 현재 화면 x (0..1)
  cars: ScreenBox[]; // 차·자전거 박스
  blocks: ScreenBox[]; // 사람·장애물 박스
  affection: number; // 0..100
  fullness: number; // 0..100
  dangerRecently: boolean; // 위험을 막 지나침
  nextLookBackAt: number; // 다음 뒤돌아보기 예정 시각 (초)
  lookBackUntil: number; // 이 시각보다 now가 작으면 뒤돌아보는 중
  rand: number; // 0..1, 다음 간격 추첨용
}

export interface WalkOutput {
  walkLane: { x: number; speed: number }; // x 0..1, speed 0=정지 1=걷기
  lookBack: boolean; // faceBack prop
  balloon: string | null;
  emote: EmoteId | null;
  nextLookBackAt: number; // 갱신된 예정 시각 (호출자가 보관)
  stopped: boolean;
  reason: "walking" | "car" | "user-stopped" | "blocked";
}

function overlapsX(x: number, b: ScreenBox, margin: number): boolean {
  return x >= b.x0 - margin && x <= b.x1 + margin;
}

export function planWalk(input: WalkInput): WalkOutput {
  const {
    now, mode, video, videoTime, userMoving, laneX, cars, blocks,
    affection, fullness, dangerRecently, lookBackUntil,
  } = input;
  let nextLookBackAt = input.nextLookBackAt;

  // 차 존: 크리처 x와 겹치는 차 박스가 있으면 위험.
  const inCarZone = cars.some((c) => overlapsX(laneX, c, 0.03));

  // 목표 x: sim=구간 인도 중앙, cam=차 반대쪽(차 없으면 중앙).
  let targetX: number;
  let lo = 0.1;
  let hi = 0.9;
  if (mode === "sim") {
    const lane = laneAt(video, videoTime);
    lo = lane.x0;
    hi = lane.x1;
    targetX = (lane.x0 + lane.x1) / 2;
  } else if (cars.length > 0) {
    const avg = cars.reduce((a, c) => a + (c.x0 + c.x1) / 2, 0) / cars.length;
    targetX = avg < 0.5 ? 0.72 : 0.28;
  } else {
    targetX = 0.5;
  }

  // 장애물 회피: 목표 x와 겹치는 블록이 있으면 범위 안에서 반대쪽으로.
  for (const b of blocks) {
    if (overlapsX(targetX, b, 0.05)) {
      const bcx = (b.x0 + b.x1) / 2;
      targetX = targetX < bcx
        ? Math.max(lo, b.x0 - 0.12)
        : Math.min(hi, b.x1 + 0.12);
    }
  }
  targetX = Math.min(hi, Math.max(lo, targetX));

  // 멈춤 판정: 차 존 / 사용자 정지 / 앞을 막는 블록(화면 아래쪽).
  const blockedAhead = blocks.some((b) => overlapsX(laneX, b, 0.02) && b.y1 > 0.4);
  const stopped = inCarZone || !userMoving || blockedAhead;

  // 뒤돌아보기: 차 존 안이면 하지 않는다 (안전 우선).
  let lookBack = now < lookBackUntil;
  let balloon: string | null = null;
  let emote: EmoteId | null = null;
  if (inCarZone) {
    lookBack = false;
    balloon = "조심! 앞에 차가 있어요";
  } else if (lookBack || now >= nextLookBackAt) {
    lookBack = true;
    if (!(now < lookBackUntil)) {
      const r = Math.min(1, Math.max(0, input.rand));
      nextLookBackAt = now + LOOKBACK_HOLD_S + LOOKBACK_EVERY_MIN
        + r * (LOOKBACK_EVERY_MAX - LOOKBACK_EVERY_MIN);
    }
    if (!userMoving) {
      balloon = "올래?";
      emote = "greet";
    } else if (affection >= AFFECTION_WARM || dangerRecently) {
      balloon = dangerRecently ? "가자!" : "여기야!";
      emote = "happy";
    } else if (fullness < FULLNESS_HUNGRY) {
      balloon = "배고파…";
      emote = "hungry";
    }
  } else if (blockedAhead) {
    emote = "idle";
  }

  const reason: WalkOutput["reason"] = inCarZone
    ? "car"
    : !userMoving
      ? "user-stopped"
      : blockedAhead
        ? "blocked"
        : "walking";
  return {
    walkLane: { x: stopped ? laneX : targetX, speed: stopped ? 0 : 1 },
    lookBack,
    balloon,
    emote,
    nextLookBackAt,
    stopped,
    reason,
  };
}
