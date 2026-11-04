// 크리처 감정 보이스: public/cries/<speciesId>_<mood>.mp3 에셋 재생.
// 에셋은 scripts/generate-cries.mjs가 생성 (24종 x 8감정 = 192개).
// Meta 음성 모델 연동 시 같은 파일명으로 덮어쓰면 코드 변경 없이 교체된다.

export type CryMood =
  | "meet" // 첫 만남 인사 ("모카-!")
  | "happy" // 눈웃음 신남 ("모카모카-!")
  | "want" // 조르기 ("잉잉- 뺩-!")
  | "hungry" // 배고픔 ("끄응... 꾸륵...")
  | "cry" // 울음/아픔 ("으아앙- 끕...")
  | "eat" // 냠냠 ("옴뇸뇸뇸!")
  | "attack" // 공격 기합 ("얍-! 파앗!")
  | "sleep"; // 낮잠 ("쿠울... 쿨...")

// 구 시그니처 호환용 (현재 미사용, 외부 참조 대비 유지).
export type CryElement = "fire" | "grass" | "water" | "rock" | "wind";

const ID_RE = /^[a-z]+-\d+$/;

let unlocked = false;

// 울음 버스 (G보강 2차): lowpass 10kHz + a.volume 0.6 × busIn 1.0 × g 0.25 = 0.15.
// 파일 피크 −1dBFS(0.89) × 0.15 ≈ 0.13(−17dBFS).
let busCtx: AudioContext | null = null;
let busIn: GainNode | null = null;
let lastPlayTime = 0;
let lastTake = 0;

function cryBus(): GainNode | null {
  try {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!busCtx || busCtx.state === "closed") {
      busCtx = new AC();
      const lp = busCtx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 10000;
      lp.Q.value = 0.5;
      const g = busCtx.createGain();
      g.gain.value = 0.25;
      lp.connect(g).connect(busCtx.destination);
      busIn = busCtx.createGain();
      busIn.gain.value = 1.0;
      busIn.connect(lp);
    }
    if (busCtx.state === "suspended") void busCtx.resume().catch(() => {});
    return busIn;
  } catch {
    return null;
  }
}

function pickTake(): 1 | 2 | 3 {
  const pool: Array<1 | 2 | 3> = [1, 2, 3].filter((t) => t !== lastTake) as Array<1 | 2 | 3>;
  const take = pool[Math.floor(Math.random() * pool.length)];
  lastTake = take;
  return take;
}

// 첫 터치에 호출: 브라우저 오디오 잠금 해제 (제스처 전 자동재생은 막힘).
export function unlockAudio(): void {
  unlocked = true;
  try {
    if (typeof window === "undefined") return;
    const a = new Audio();
    a.muted = true;
    void a.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

// speciesId: ROSTER id (예: fire-01), mood: 8감정. 에셋 없으면 조용히 스킵.
// G보강: 3테이크 중 무작위(직전 제외) + playbackRate 0.94~1.08.
export function playCry(speciesId: string, mood: CryMood = "meet"): void {
  try {
    if (typeof window === "undefined") return;
    const now = Date.now();
    if (now - lastPlayTime < 300) return; // 0.3초 이내 중복 재생 방지 (귀 피로 방지)
    lastPlayTime = now;

    if (!unlocked) unlockAudio();
    const id = ID_RE.test(speciesId) ? speciesId : "fire-01";
    const a = new Audio(`/cries/${id}_${mood}_${pickTake()}.mp3`);
    a.preload = "auto";
    a.volume = 0.6;
    a.playbackRate = 0.94 + Math.random() * 0.14;
    try {
      (a as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false;
    } catch {
      /* ignore */
    }
    try {
      const bus = cryBus();
      if (bus && busCtx) {
        const src = busCtx.createMediaElementSource(a);
        src.connect(bus);
      }
    } catch {
      /* 버스 실패 시 직접 재생 */
    }
    void a.play().catch(() => {});
  } catch {
    /* 오디오 없어도 게임은 진행 */
  }
}

// 도감 진입 시 인사 보이스 선로딩 (작은 파일이라 부담 없음).
export function preloadCries(ids: string[], moods: CryMood[] = ["meet"]): void {
  try {
    if (typeof window === "undefined") return;
    for (const id of ids) {
      if (!ID_RE.test(id)) continue;
      for (const mood of moods) {
        for (const take of [1, 2, 3]) {
          const a = new Audio(`/cries/${id}_${mood}_${take}.mp3`);
          a.preload = "auto";
          try {
            a.load();
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}
