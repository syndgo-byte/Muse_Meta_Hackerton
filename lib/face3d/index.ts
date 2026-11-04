// F3-1 런타임: GLB는 그대로 두고 눈꺼풀·입 메시를 만들어 머리 본에 붙여 구동한다 (./mesh.ts).
// - 눈꺼풀: blink(완전히 덮음)·half(반 감김) → 덮임 비율 하나로 합침
// - 입: open(세로로 벌림)·round(동그랗게 놀람)
// 목록에 없는 종·앵커 없는 종이면 attachFace3D가 null → 호출부는 아무것도 안 한다.
// 텍스처는 건드리지 않는다 (FACE_PAINT_ENABLED=false 유지와 무관하게 독립).
import type * as THREE from "three";
import { cryActive } from "./speech";
import { buildFaceMeshes } from "./mesh";

/** 끄는 상수 한 곳. false면 attachFace3D가 항상 null (메시도 안 만듦). */
export const FACE3D_ENABLED = true;
/** 검증 통과 종만 붙인다 (scratch/face3d/REPORT.md). 모르면 안 붙임. */
// 제외 (춤 중 눈 피부가 머리 본이 아닌 몸통·다리 가중치라 눈꺼풀이 미끄러짐): fire-04 grass-02 grass-05 rock-01 rock-03
export const FACE3D_SPECIES = new Set<string>([
  "fire-01", "fire-02", "fire-03", "fire-05",
  "grass-01", "grass-03", "grass-04",
  "rock-02", "rock-04",
  "water-01", "water-02", "water-03", "water-04", "water-05",
  "wind-01", "wind-02", "wind-03", "wind-04", "wind-05",
]);

// 깜빡임 (EYELID_ORDER §5): 2.5~6초 무작위, 닫힘 70ms·유지 40ms·열림 90ms, 15% 두 번 연속.
const BLINK_GAP: [number, number] = [2.5, 6.0];
const BLINK_CLOSE = 0.07;
const BLINK_HOLD = 0.04;
const BLINK_OPEN = 0.09;
const DOUBLE_P = 0.15;
const DOUBLE_GAP = 0.12;

export type Face3DCue = {
  emote: string;
  emoteT: number; // 감정 경과 (초)
  dancing?: boolean;
  drowsy?: boolean; // 탈진/졸림 → half 유지 + 6초 주기 하품
  frozen?: boolean; // 배틀 대기 등: 눈 뜬 채 고정
  closed?: boolean; // 리뷰용 감은 눈 고정
};

export type Face3D = {
  update: (dt: number, t: number, cue: Face3DCue) => void;
  /** 현재 값 (검증용) */
  state: () => { blink: number; half: number; open: number; round: number };
  /** 붙인 메시 (검증용) */
  parts: THREE.Mesh[];
};

const SLEEP_EMOTES = new Set(["sleep", "faint"]);
const CLOSED_EMOTES = new Set(["hurt"]);
const SURPRISE_EMOTES = new Set(["attack", "fetch", "zoomies"]); // 표 eyes "wow"
const EAT_EMOTES: Record<string, number> = { eat: 1.6, chomp: 2.4 }; // EMOTE_DUR

/** 모델 루트에 눈꺼풀·입 메시를 붙이고 구동기를 만든다. 붙일 게 없으면 null. */
export function attachFace3D(
  root: THREE.Object3D,
  speciesId: string,
  rnd: () => number = Math.random,
): Face3D | null {
  if (!FACE3D_ENABLED || !FACE3D_SPECIES.has(speciesId)) return null;
  const fm = buildFaceMeshes(root, speciesId);
  if (!fm) return null;
  // 리뷰용: ?face3d=closed 감은 눈 고정, ?face3d=closed,mouth 입도 벌림 (dex 캡처)
  let review = "";
  try {
    review = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("face3d") ?? "" : "";
  } catch {
    /* 리뷰 플래그만 */
  }

  let nextBlink = BLINK_GAP[0] + rnd() * (BLINK_GAP[1] - BLINK_GAP[0]);
  let blinkPhase = -1; // <0: 대기, 0..: 진행 시간
  let pendingDouble = false;
  const cur = { blink: 0, half: 0, open: 0, round: 0 };

  const approach = (from: number, to: number, dt: number, rate: number) =>
    from + (to - from) * (1 - Math.exp(-rate * dt));

  const blinkCurve = (p: number) => {
    if (p < BLINK_CLOSE) return p / BLINK_CLOSE;
    if (p < BLINK_CLOSE + BLINK_HOLD) return 1;
    const q = (p - BLINK_CLOSE - BLINK_HOLD) / BLINK_OPEN;
    return q < 1 ? 1 - q : 0;
  };
  const BLINK_LEN = BLINK_CLOSE + BLINK_HOLD + BLINK_OPEN;

  return {
    state: () => ({ ...cur }),
    parts: fm.parts,
    update(dt, t, cue) {
      // ---- 눈 ----
      let baseHalf = 0;
      let hold = 0; // 고정 감김 (0..1)
      let allowBlink = true;
      if (cue.frozen) allowBlink = false;
      else if (review.includes("closed") || cue.closed || SLEEP_EMOTES.has(cue.emote) || CLOSED_EMOTES.has(cue.emote)) {
        hold = 1;
        allowBlink = false;
      } else if (cue.drowsy || cue.emote === "drowsy") baseHalf = 1;

      let b = 0;
      if (allowBlink) {
        if (blinkPhase < 0) {
          nextBlink -= dt;
          if (nextBlink <= 0) {
            blinkPhase = 0;
            pendingDouble = rnd() < DOUBLE_P;
          }
        }
        if (blinkPhase >= 0) {
          blinkPhase += dt;
          b = blinkCurve(blinkPhase);
          if (blinkPhase >= BLINK_LEN) {
            blinkPhase = -1;
            if (pendingDouble) {
              pendingDouble = false;
              nextBlink = DOUBLE_GAP;
            } else nextBlink = BLINK_GAP[0] + rnd() * (BLINK_GAP[1] - BLINK_GAP[0]);
          }
        }
      } else blinkPhase = -1;

      const tgtBlink = Math.max(b, hold);
      // half와 blink를 동시에 켜면 변위가 겹치므로, 깜빡이는 동안 half를 덜어낸다.
      const tgtHalf = baseHalf * (1 - tgtBlink);
      // 깜빡임은 곡선 그대로(즉시), 고정 감김 전환만 부드럽게.
      cur.blink = b > 0 ? tgtBlink : approach(cur.blink, tgtBlink, dt, 14);
      cur.half = approach(cur.half, tgtHalf, dt, 8);
      // half = 반쯤 덮음
      fm.setLids?.(Math.min(1, cur.blink + cur.half * 0.5));

      // ---- 입 ----
      let tgtOpen = 0;
      let tgtRound = 0;
      const eatDur = EAT_EMOTES[cue.emote];
      if (eatDur !== undefined) {
        // 먹기: 크게 2회
        const k = Math.min(1, Math.max(0, cue.emoteT / eatDur));
        tgtOpen = Math.max(0, Math.sin(k * Math.PI * 2 * 2 - Math.PI / 2) * 0.5 + 0.5) ** 1.5;
      } else if (SURPRISE_EMOTES.has(cue.emote) && cue.emoteT < 1.2) {
        tgtRound = 1;
      } else if (cue.drowsy || cue.emote === "drowsy") {
        tgtOpen = t % 6 < 1.2 ? Math.sin(((t % 6) / 1.2) * Math.PI) * 0.85 : 0; // 하품
      } else if (cryActive(speciesId)) {
        // 울음·음성 재생 중: 음절 리듬
        const syl = Math.abs(Math.sin(t * Math.PI * 5.2)) * (0.75 + 0.25 * Math.sin(t * 2.3));
        tgtOpen = 0.15 + 0.7 * syl;
      }
      if (review.includes("mouth")) tgtOpen = 1;
      if (cue.frozen) tgtOpen = tgtRound = 0;
      cur.open = approach(cur.open, tgtOpen, dt, 22);
      cur.round = approach(cur.round, tgtRound, dt, 12);
      fm.setMouth?.(cur.open, cur.round);
    },
  };
}
