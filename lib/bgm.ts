// BGM: 8-D부터 실황 녹음(field.mp3) 루프. THEME TABLE·buildScore는 검증용으로 유지.
// export 7개 시그니처는 그대로.

const PREF_KEY = "snapquest-bgm";

// ---------- THEME TABLE ----------
export type ThemeName = "main" | "ar";

export interface ThemeChord {
  name: string;
  tones: number[]; // 아르페지오 구성음 (Hz)
  pad: number[]; // 패드 (Hz)
  bass: number; // 베이스 루트 (Hz)
}

export interface BgmThemeSpec {
  bpm: number;
  chords: ThemeChord[]; // 8마디
  kickSteps: number[]; // 마디당 16스텝
  snareSteps: number[];
  fillBar: number | null; // 스네어 필인 마디 (0-based)
  hatEvery: number; // n스텝마다
  hatAccentOffbeat: boolean;
  bassSyncopateBar: number | null; // 싱코페이션 마디 (0-based)
  liftBar: number | null; // 아르페지오 옥타브 상승 마디
  hook: number[] | null; // 2마디 동기 (8분음표 8개, 0=쉼)
  hookVary: number[] | null; // 마지막 반복 변형
  padLevel: number;
}

// C5 523.25 D5 587.33 E5 659.26 G5 783.99 A5 880.0 B5 987.77 C6 1046.5
const HOOK_MAIN = [523.25, 659.26, 783.99, 880.0, 783.99, 659.26, 587.33, 659.26];
const HOOK_VARY = [523.25, 659.26, 783.99, 987.77, 1046.5, 0, 783.99, 659.26];

export const BGM_THEMES: Record<ThemeName, BgmThemeSpec> = {
  main: {
    bpm: 120,
    chords: [
      { name: "C", tones: [261.63, 329.63, 392.0, 523.25], pad: [130.81, 164.81, 196.0], bass: 65.41 },
      { name: "G", tones: [196.0, 246.94, 293.66, 392.0], pad: [98.0, 146.83, 196.0], bass: 98.0 },
      { name: "Am", tones: [220.0, 261.63, 329.63, 440.0], pad: [110.0, 164.81, 220.0], bass: 110.0 },
      { name: "F", tones: [174.61, 220.0, 261.63, 349.23], pad: [87.31, 130.81, 174.61], bass: 87.31 },
      { name: "C", tones: [261.63, 329.63, 392.0, 523.25], pad: [130.81, 164.81, 196.0], bass: 65.41 },
      { name: "G", tones: [196.0, 246.94, 293.66, 392.0], pad: [98.0, 146.83, 196.0], bass: 98.0 },
      { name: "Am", tones: [220.0, 261.63, 329.63, 440.0], pad: [110.0, 164.81, 220.0], bass: 110.0 },
      { name: "G", tones: [196.0, 246.94, 293.66, 392.0], pad: [98.0, 146.83, 196.0], bass: 98.0 },
    ],
    kickSteps: [0, 8],
    snareSteps: [4, 12],
    fillBar: null,
    hatEvery: 2,
    hatAccentOffbeat: true,
    bassSyncopateBar: null,
    liftBar: 7,
    hook: HOOK_MAIN,
    hookVary: HOOK_VARY,
    padLevel: 0.3,
  },
  ar: {
    bpm: 132,
    chords: [
      { name: "F", tones: [349.23, 440.0, 523.25, 698.46], pad: [87.31, 130.81, 174.61], bass: 87.31 },
      { name: "C", tones: [261.63, 329.63, 392.0, 523.25], pad: [130.81, 164.81, 196.0], bass: 65.41 },
      { name: "Dm", tones: [293.66, 349.23, 440.0, 587.33], pad: [146.83, 174.61, 220.0], bass: 73.42 },
      { name: "Bb", tones: [233.08, 293.66, 349.23, 466.16], pad: [116.54, 146.81, 174.61], bass: 116.54 },
      { name: "F", tones: [349.23, 440.0, 523.25, 698.46], pad: [87.31, 130.81, 174.61], bass: 87.31 },
      { name: "C", tones: [261.63, 329.63, 392.0, 523.25], pad: [130.81, 164.81, 196.0], bass: 65.41 },
      { name: "Dm", tones: [293.66, 349.23, 440.0, 587.33], pad: [146.83, 174.61, 220.0], bass: 73.42 },
      { name: "Bb", tones: [233.08, 293.66, 349.23, 466.16], pad: [116.54, 146.81, 174.61], bass: 116.54 },
    ],
    kickSteps: [0, 4, 8, 12],
    snareSteps: [4, 12],
    fillBar: 7,
    hatEvery: 1,
    hatAccentOffbeat: false,
    bassSyncopateBar: 3,
    liftBar: null,
    hook: null,
    hookVary: null,
    padLevel: 0.5,
  },
};

// ---------- SCORE (순수: 표 → 8마디 이벤트) ----------
export type ScoreEvent =
  | { t: number; kind: "kick" }
  | { t: number; kind: "snare" }
  | { t: number; kind: "hat"; accent: boolean }
  | { t: number; kind: "bass"; f: number; dur: number }
  | { t: number; kind: "arp"; f: number; dur: number }
  | { t: number; kind: "hook"; f: number; dur: number }
  | { t: number; kind: "pad"; freqs: number[]; dur: number };

export interface BuiltScore {
  bpm: number;
  seconds: number;
  events: ScoreEvent[];
}

// 마디(bar)·스텝(16분음표) → 그 지점에서 울리는 이벤트. 라이브·렌더 공용.
function stepEvents(
  spec: BgmThemeSpec,
  bar: number,
  s: number,
  stepDur: number
): ScoreEvent[] {
  const ev: ScoreEvent[] = [];
  const t = (bar * 16 + s) * stepDur;
  const ch = spec.chords[bar];
  if (spec.kickSteps.includes(s)) ev.push({ t, kind: "kick" });
  if (spec.snareSteps.includes(s)) {
    if (spec.fillBar === bar && s === 12) {
      for (let k = 0; k < 4; k++) ev.push({ t: t + k * stepDur, kind: "snare" });
    } else {
      ev.push({ t, kind: "snare" });
    }
  }
  if (s % spec.hatEvery === 0) {
    ev.push({ t, kind: "hat", accent: spec.hatAccentOffbeat && s % 4 === 2 });
  }
  if (s % 2 === 0) {
    const syncopated = spec.bassSyncopateBar === bar && s === 6;
    if (!syncopated) {
      const oct = s % 4 === 2;
      ev.push({ t, kind: "bass", f: oct ? ch.bass * 2 : ch.bass, dur: stepDur * 1.8 });
    }
  }
  const lift = spec.liftBar === bar ? 2 : 1;
  ev.push({ t, kind: "arp", f: ch.tones[s % 4] * lift, dur: stepDur * 0.9 });
  if (spec.hook) {
    const pair = Math.floor(bar / 2); // 2마디 동기 ×4
    const motif = pair === 3 && spec.hookVary ? spec.hookVary : spec.hook;
    if (s % 2 === 0) {
      const f = motif[(bar % 2) * 4 + s / 2];
      if (f > 0) ev.push({ t, kind: "hook", f, dur: stepDur * 1.8 });
    }
  }
  if (s === 0) ev.push({ t, kind: "pad", freqs: ch.pad, dur: stepDur * 16 });
  return ev;
}

export function buildScore(name: ThemeName): BuiltScore {
  const spec = BGM_THEMES[name];
  const stepDur = 60 / spec.bpm / 4;
  const events: ScoreEvent[] = [];
  for (let bar = 0; bar < 8; bar++) {
    for (let s = 0; s < 16; s++) events.push(...stepEvents(spec, bar, s, stepDur));
  }
  events.sort((a, b) => a.t - b.t);
  return { bpm: spec.bpm, seconds: 128 * stepDur, events };
}

// ---------- PLAYER (8-D: 합성 대신 field.mp3 루프) ----------
// 악보(BGM_THEMES/buildScore)는 검증용으로 남기고, 재생은 실황 녹음만 쓴다.
const FIELD_URL = "/bgm/field.mp3";
// BGM-1: 배틀곡 10종 (ACE-Step 생성, Apache 2.0). 원곡 battle.mp3는 코드에서 미참조.
export const BATTLE_TRACKS: readonly string[] = [
  "/bgm/battle/battle-01.mp3",
  "/bgm/battle/battle-02.mp3",
  "/bgm/battle/battle-03.mp3",
  "/bgm/battle/battle-04.mp3",
  "/bgm/battle/battle-05.mp3",
  "/bgm/battle/battle-06.mp3",
  "/bgm/battle/battle-07.mp3",
  "/bgm/battle/battle-08.mp3",
  "/bgm/battle/battle-09.mp3",
  "/bgm/battle/battle-10.mp3",
];
let lastBattleTrack = -1;
// 직전 곡 제외 균등 선택 (첫 추첨이 prev면 1..n-1칸 전진 → 나머지 n-1곡 균등).
export function pickBattleTrack(prev: number, rand: () => number = Math.random): number {
  const n = BATTLE_TRACKS.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  const first = Math.floor(rand() * n) % n;
  if (first !== prev) return first;
  return (first + 1 + (Math.floor(rand() * (n - 1)) % (n - 1))) % n;
}
const FIELD_VOLUME = 0.25;
const BATTLE_VOLUME = 0.12; // 9-C 0항: 배틀곡은 귀에 거슬리지 않게
function modeVolume(): number {
  return bgmMode === "battle" ? BATTLE_VOLUME : FIELD_VOLUME;
}
const FADE_SCENE_MS = 1000;
const LOOP_FADEOUT_S = 2.0;
const LOOP_FADEIN_MS = 500;

let audio: HTMLAudioElement | null = null;
let playing = false;
let bgmMode: "field" | "battle" = "field"; // 현재 src가 어떤 곡인지
let battleAvail: Record<string, boolean> = {}; // 트랙별 존재 여부 (HEAD 캐시)
let currentBattleUrl = ""; // 재생 중 배틀 트랙 (로드 실패 표시용)
let fadeTimer: number | null = null;
let watchTimer: number | null = null;
let fadingLoop = false;
let listened = false;

function log(msg: string) {
  try {
    console.info(`[bgm] ${msg}`);
  } catch {
    /* ignore */
  }
}

function ensureAudio(): HTMLAudioElement | null {
  try {
    if (typeof window === "undefined") return null;
    if (!audio) {
      const a = new Audio(FIELD_URL);
      a.preload = "auto";
      a.volume = 0;
      a.addEventListener("ended", onEnded);
      a.addEventListener("error", onAudioError);
      audio = a;
      if (!listened && typeof document !== "undefined") {
        listened = true;
        document.addEventListener("visibilitychange", onVisibility);
      }
    }
    return audio;
  } catch {
    return null;
  }
}

function stopFade() {
  if (fadeTimer !== null) {
    window.clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function rampTo(target: number, ms: number, then?: () => void) {
  const a = audio;
  if (!a) {
    then?.();
    return;
  }
  stopFade();
  const from = a.volume;
  const t0 = Date.now();
  fadeTimer = window.setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / Math.max(1, ms));
    a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
    if (k >= 1) {
      stopFade();
      then?.();
    }
  }, 50);
}

// 루프 이음: 끝 2초 페이드아웃됐으면 처음으로 돌아가 0.5초 페이드인.
function onEnded() {
  const a = audio;
  if (!a || !playing) return;
  a.currentTime = 0;
  a.volume = 0;
  a.play()
    .then(() => {
      log("loop");
      rampTo(modeVolume(), LOOP_FADEIN_MS);
    })
    .catch(() => {
      /* 다음 시작 때 재시도 */
    });
}

// battle src 로드 실패 → 무음 유지 (9-C: field 대체 없음).
function onAudioError() {
  const a = audio;
  if (!a || bgmMode !== "battle") return;
  log("battle missing, silent");
  if (currentBattleUrl) battleAvail[currentBattleUrl] = false;
  playing = false;
  stopFade();
  try {
    a.pause();
  } catch {
    /* ignore */
  }
}

// 끝 2초 감시 → 페이드아웃.
function watch() {
  const a = audio;
  try {
    (window as unknown as Record<string, unknown>).__bgmState = a
      ? { playing, paused: a.paused, t: Math.round(a.currentTime * 10) / 10, vol: Math.round(a.volume * 100) / 100 }
      : { playing, paused: true, t: 0, vol: 0 };
    (window as unknown as Record<string, unknown>).__bgmAudio = a;
  } catch {
    /* ignore */
  }
  if (!a || a.paused || !playing) return;
  if (!Number.isFinite(a.duration) || a.duration <= 0) return;
  const remain = a.duration - a.currentTime;
  if (remain <= 0.3) {
    // ended를 기다리면 수백ms 끊기므로 미리 감아 끊김 없이 루프.
    try {
      a.currentTime = 0;
    } catch {
      /* ignore */
    }
    fadingLoop = false;
    log("loop");
    rampTo(modeVolume(), LOOP_FADEIN_MS);
    return;
  }
  if (remain <= LOOP_FADEOUT_S && remain > 0 && !fadingLoop) {
    fadingLoop = true;
    rampTo(0, Math.max(200, remain * 1000));
  } else if (remain > LOOP_FADEOUT_S + 0.5) {
    fadingLoop = false;
  }
}

// 8-D: 합성 보이스 제거 (mp3 루프로 대체).

// 8-D: 합성 보이스 제거 (mp3 루프로 대체).

function onVisibility() {
  if (typeof document === "undefined") return;
  const a = audio;
  if (document.hidden) {
    if (a && !a.paused) {
      try {
        a.pause();
      } catch {
        /* ignore */
      }
      log("hidden: pause");
    }
  } else if (a && playing && a.paused) {
    a.play().catch(() => {});
    log("visible: resume");
  }
}

export function bgmPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

function playField() {
  const a = ensureAudio();
  if (!a) return;
  if (!bgmPref()) return;
  if (bgmMode === "battle") {
    // 배틀에서 복귀: src를 field로 되돌린다.
    bgmMode = "field";
    try {
      a.src = FIELD_URL;
      a.currentTime = 0;
    } catch {
      /* ignore */
    }
  } else if (playing && !a.paused) {
    return; // 같은 곡이면 유지 (장면 전환 페이드 불필요)
  }
  playing = true;
  fadingLoop = false;
  a.volume = 0;
  a.play()
    .then(() => {
      log("start");
      rampTo(FIELD_VOLUME, FADE_SCENE_MS);
    })
    .catch(() => {
      log("play blocked (autoplay policy)");
    });
  if (watchTimer === null) watchTimer = window.setInterval(watch, 250);
}

export function startBgm() {
  playField();
}

// AR 진입용: 같은 필드곡을 유지한다.
export function startArBgm() {
  playField();
}

// ---------- 9-C 배틀 BGM + BGM-1 10곡 랜덤 ----------
// 고른 트랙이 있으면 배틀 페이즈에만 전환, 없으면 무음 (field 대체 없음).
async function checkBattleFile(url: string): Promise<boolean> {
  if (url in battleAvail) return battleAvail[url];
  try {
    const res = await fetch(url, { method: "HEAD" });
    battleAvail[url] = res.ok;
  } catch {
    battleAvail[url] = false;
  }
  return battleAvail[url];
}

// 배틀 시작: 직전 곡 제외 1곡 선택 → field 1초 페이드아웃 → battle 페이드인.
// 배틀 중 재호출은 무시해 한 배틀 한 곡을 유지한다.
export function startBattleBgm(): void {
  const a = ensureAudio();
  if (!a) return;
  if (!bgmPref()) return;
  if (bgmMode === "battle" && playing && !a.paused) return;
  const idx = pickBattleTrack(lastBattleTrack);
  const url = BATTLE_TRACKS[idx] ?? "";
  if (!url) {
    log("battle missing, silent");
    stopBgm();
    return;
  }
  void checkBattleFile(url).then((ok) => {
    if (!ok) {
      log("battle missing, silent");
      stopBgm();
      return;
    }
    lastBattleTrack = idx;
    currentBattleUrl = url;
    playing = true;
    bgmMode = "battle";
    fadingLoop = false;
    rampTo(0, FADE_SCENE_MS, () => {
      try {
        a.src = url;
        a.currentTime = 0;
        a.volume = 0;
        a.play()
          .then(() => {
            log("battle start");
            rampTo(BATTLE_VOLUME, FADE_SCENE_MS);
          })
          .catch(() => {
            log("battle play blocked");
          });
      } catch {
        /* ignore */
      }
    });
    if (watchTimer === null) watchTimer = window.setInterval(watch, 250);
  });
}

// 배틀 종료: battle 페이드아웃 → 무음 (9-C: 탐험 복귀 시 field 재생 없음).
export function stopBattleBgm(): void {
  const a = audio;
  if (!a || bgmMode !== "battle") return;
  log("battle end, silent");
  playing = false;
  rampTo(0, FADE_SCENE_MS, () => {
    bgmMode = "field";
    try {
      a.pause();
      a.src = FIELD_URL;
      a.currentTime = 0;
    } catch {
      /* ignore */
    }
  });
}

// 첫 화면: 과거에 끈 "off" 잠금을 초기화해 기본 ON으로.
export function clearBgmLock(): void {
  try {
    localStorage.removeItem(PREF_KEY);
  } catch {
    /* ignore */
  }
}

export function stopBgm() {
  log("stop");
  playing = false;
  fadingLoop = false;
  stopFade();
  if (watchTimer !== null) {
    window.clearInterval(watchTimer);
    watchTimer = null;
  }
  const a = audio;
  if (a) {
    try {
      a.pause();
    } catch {
      /* ignore */
    }
  }
}

export function toggleBgm(): boolean {
  try {
    if (playing) {
      stopBgm();
      localStorage.setItem(PREF_KEY, "off");
      return false;
    }
    localStorage.setItem(PREF_KEY, "on");
    playField();
    return playing;
  } catch {
    return false;
  }
}

export function isBgmOn(): boolean {
  return playing;
}
