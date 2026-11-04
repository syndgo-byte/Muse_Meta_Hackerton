// lib/levelup-chime.ts — 레벨업 팡파레 차임 (WebAudio 직접 합성, 에셋 없음).
// 짧고 낮은 벨 2타: E5→A5 사인 + 희미한 2배음. 피크 약 -18dB, 전체 0.6초 이내.
// 기존 음소거(bgmPref)를 따르고, 막힌 환경에선 조용히 "blocked"로 끝난다.
import { bgmPref } from "./bgm";

/** 딩별 피크 게인 (0.1 ≈ -20dB, 두 타 겹침 포함 최대 약 -18dB). */
export const CHIME_PEAK = 0.1;
/** 차임 전체 길이(초). 1초 이내. */
export const CHIME_TOTAL = 0.55;
/** 기본음 목록 (Hz, 시작 오프셋, 길이). 날카로운 고음 없음 (기본음 ≤880). */
export const CHIME_NOTES: ReadonlyArray<{ freq: number; at: number; dur: number }> = [
  { freq: 659.25, at: 0, dur: 0.35 },
  { freq: 880, at: 0.18, dur: 0.35 },
];

export type ChimeStatus = "played" | "muted" | "blocked";

let ctx: AudioContext | null = null;

export function playLevelupChime(): ChimeStatus {
  try {
    if (typeof window === "undefined") return "blocked";
    if (!bgmPref()) return "muted";
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return "blocked";
    if (!ctx || ctx.state === "closed") ctx = new AC();
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
      return "blocked";
    }
    const t0 = ctx.currentTime;
    for (const n of CHIME_NOTES) {
      // 기본음 + 2배음(벨 색, -12dB).
      const partials: ReadonlyArray<{ mult: number; gain: number }> = [
        { mult: 1, gain: CHIME_PEAK },
        { mult: 2.01, gain: CHIME_PEAK * 0.25 },
      ];
      for (const p of partials) {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = n.freq * p.mult;
        const g = ctx.createGain();
        const start = t0 + n.at;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(p.gain, start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur);
        o.connect(g).connect(ctx.destination);
        o.start(start);
        o.stop(start + n.dur + 0.02);
      }
    }
    return "played";
  } catch {
    return "blocked";
  }
}
