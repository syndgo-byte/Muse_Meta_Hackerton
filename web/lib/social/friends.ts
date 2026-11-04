// lib/social/friends.ts — PF-1: 친구·평점·쿨다운 (localStorage, import 없음).
// 서버 없음. 키가 바뀌면 PeerEncounter 표시와 verify-peer를 함께 고친다.
export type Rating = 1 | 2 | 3 | 4 | 5;

const FRIENDS_KEY = "pf1.friends";
const RATINGS_KEY = "pf1.ratings";
const MET_KEY = "pf1.met";

/** 같은 상대 쿨다운 10분. */
export const MEET_COOLDOWN_MS = 10 * 60 * 1000;

function storage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readMap(key: string): Record<string, unknown> {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return {};
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeMap(key: string, m: Record<string, unknown>): void {
  try {
    storage()?.setItem(key, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** 친구 추가. 별명은 표시용(없으면 peerId 앞 6자). */
export function addFriend(peerId: string, nickname?: string): void {
  if (!peerId) return;
  const m = readMap(FRIENDS_KEY);
  m[peerId] = { nickname: nickname ?? peerId.slice(0, 6), addedAt: Date.now() };
  writeMap(FRIENDS_KEY, m);
}

export function removeFriend(peerId: string): void {
  if (!peerId) return;
  const m = readMap(FRIENDS_KEY);
  delete m[peerId];
  writeMap(FRIENDS_KEY, m);
}

export function isFriend(peerId: string): boolean {
  if (!peerId) return false;
  const m = readMap(FRIENDS_KEY);
  return m[peerId] !== undefined;
}

/** 평점 1~5 저장. 범위 밖은 무시한다. */
export function rate(peerId: string, stars: number): void {
  if (!peerId) return;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
  const m = readMap(RATINGS_KEY);
  m[peerId] = stars;
  writeMap(RATINGS_KEY, m);
}

/** 평점. 없거나 깨졌으면 null. */
export function ratingOf(peerId: string): Rating | null {
  if (!peerId) return null;
  const v = readMap(RATINGS_KEY)[peerId];
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  return null;
}

/** 마지막 만남 시각(ms). 없으면 null. */
export function lastMet(peerId: string): number | null {
  if (!peerId) return null;
  const v = readMap(MET_KEY)[peerId];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

/** 만남 기록. now 주입 가능(테스트용). */
export function markMet(peerId: string, now?: number): void {
  if (!peerId) return;
  const m = readMap(MET_KEY);
  m[peerId] = typeof now === "number" && Number.isFinite(now) ? now : Date.now();
  writeMap(MET_KEY, m);
}
