// D-3 key-move ranges (2번, 11-02): playback-time gates, NOT key data.
// Source: scratch/dance/key-moves.md (verified 11-02 across NEON angles).
// Beats = clip-beats. Key data, counts, bpm untouched.
import { ateez } from "./ateez";
import { a2o } from "./a2o";

export type KeyMoveRange = {
  clip: string;
  name: string;
  fromKey: number; // inclusive key indices (smoothing skip)
  toKey: number;
  fromBeat: number; // clip-beats [from, to) (soften gate)
  toBeat: number;
};

export const KEY_MOVES: KeyMoveRange[] = [
  { clip: "ateez", name: "arms-up apex", fromKey: 35, toKey: 38, fromBeat: 8.75, toBeat: 9.75 },
  { clip: "ateez", name: "collapse crouch", fromKey: 67, toKey: 70, fromBeat: 16.75, toBeat: 17.75 },
  { clip: "ateez", name: "arms-up deep stance", fromKey: 89, toKey: 92, fromBeat: 22.25, toBeat: 23.25 },
  { clip: "a2o", name: "kick", fromKey: 69, toKey: 73, fromBeat: 17.25, toBeat: 18.5 },
  { clip: "a2o", name: "sit-shake", fromKey: 53, toKey: 59, fromBeat: 13.25, toBeat: 15.0 },
];

const COUNTS: Record<string, number> = { ateez: ateez.counts, a2o: a2o.counts };

/** True when clip-beat b (loop-normalized) sits inside a key-move range. */
export function inKeyMove(clipId: string, beat: number): boolean {
  const counts = COUNTS[clipId];
  if (!counts) return false;
  let b = beat % counts;
  if (b < 0) b += counts;
  return KEY_MOVES.some((r) => r.clip === clipId && b >= r.fromBeat && b < r.toBeat);
}

/** True when key index k of clipId is protected (smoothing skip). */
export function isKeyMoveKey(clipId: string, k: number): boolean {
  return KEY_MOVES.some((r) => r.clip === clipId && k >= r.fromKey && k <= r.toKey);
}
