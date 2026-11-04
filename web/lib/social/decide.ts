// lib/social/decide.ts — PF-1: 만남 판단 (순수 함수, import 없음).
import type { Rating } from "./friends";

export type MeetDecision = "emote" | "battle" | "pass";

export type PeerRef = {
  peerId: string;
  isFriend: boolean;
  /** 1~5, 모르면 null. */
  rating: Rating | null;
  /** 마지막 만남 시각(ms), 없으면 null. */
  lastMetAt: number | null;
};

export const MEET_COOLDOWN_MS = 10 * 60 * 1000;

/** 같이 감정 표현 순서. 두 크리처가 같은 순서로 한다. EMOTE_IDS에 있어야 한다. */
export const MEET_EMOTES = ["greet", "happy"] as const;
export type MeetEmote = (typeof MEET_EMOTES)[number];

/**
 * 순수 함수: 만남 갈래를 정한다.
 * 쿨다운(같은 상대 10분) 안이면 pass. 친구이거나 평점 4 이상이면 emote.
 * 평점 2 이하면 pass. 그 외(모르는 사람·평점 없음·3)는 battle 제안.
 */
export function decideMeet(peer: PeerRef, now: number): MeetDecision {
  if (!peer.peerId) return "pass";
  if (
    typeof peer.lastMetAt === "number" &&
    Number.isFinite(peer.lastMetAt) &&
    now - peer.lastMetAt < MEET_COOLDOWN_MS
  ) {
    return "pass";
  }
  if (peer.isFriend) return "emote";
  if (peer.rating !== null && peer.rating >= 4) return "emote";
  if (peer.rating !== null && peer.rating <= 2) return "pass";
  return "battle";
}
