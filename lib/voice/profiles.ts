// lib/voice/profiles.ts — D8 종별 목소리 프로필 (VOICE_DESIGN §2).
// 원본은 profiles.json (mjs가 직접 읽음). ts는 타입과 함께 re-export.
import data from "./profiles.json";

export type WaveKind = "sine" | "tri" | "saw" | "saw-soft" | "saw-dark" | "square" | "bell" | "mellow";
export type VowelKind = "a" | "o" | "u" | "i" | "e";

export interface VoiceVibrato {
  hz: number; // 0 = 없음
  depth: number; // 음정 변조 깊이 (비율)
  irregular: boolean;
}

export interface VoiceMod {
  kind: "tremolo" | "am" | "rasp" | "shimmer";
  hz: number;
  depth: number;
  moods: string[]; // 빈 배열 = 전 감정
}

export interface VoiceTexture {
  kind: string; // "none" = 없음
  mix: number; // 0~0.3
}

export interface QuirkProgram {
  n: number;
  shape: string;
}

export interface CallSyllable {
  on: string; // 자음 (없으면 모음 시작)
  v: string; // 모음 a/i/u/e/o
  coda?: string; // n/ng/m
}

export interface VoiceProfile {
  id: string;
  name: string;
  concept: string;
  f0: number;
  wave: WaveKind;
  call: { rom: string; syl: CallSyllable[] };
  vowel: VowelKind;
  vowelGlide: VowelKind | null;
  resonance: number; // 1 기준, 공명 강도
  rate: number; // 음절 길이 배율
  vibrato: VoiceVibrato;
  mod: VoiceMod | null;
  texture: VoiceTexture;
  quirk: { meet: QuirkProgram; happy: QuirkProgram };
  post: string[];
  volumeDb: number;
  note: string;
}

export const VOICE_PROFILES: VoiceProfile[] = data as unknown as VoiceProfile[];

export function voiceProfileOf(id: string): VoiceProfile {
  const found = VOICE_PROFILES.find((p) => p.id === id);
  if (!found) throw new Error(`unknown voice profile: ${id}`);
  return found;
}
