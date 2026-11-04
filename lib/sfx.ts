// 실감형 크리처 SFX: 에셋 없이 WebAudio 합성. AR 모드에서 BGM 없이
// 유저 음악 위에 가볍게 얹히는 발소리/냠냠/팝 효과음. 실패해도 조용히 스킵.
// G보강 8번: 저음 "퉁" 제거, 200Hz 아래 성분 없음, 짧고 맑게.
let ctx: AudioContext | null = null;
let lastStep = 0;
let lastChomp = 0;
let stepParity = false;

function ensure(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!ctx || ctx.state === "closed") ctx = new AC();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// G보강 2차: 발소리 제거 (본문 비움, export·시그니처 유지).
export function sfxStep(): void {}

// 덥석 깨무기: 고역 크런치 2연타 (200Hz 하이패스).
export function sfxChomp(): void {
  try {
    const now = Date.now();
    if (now - lastChomp < 220) return;
    lastChomp = now;
    const ac = ensure();
    if (!ac) return;
    const t0 = ac.currentTime;
    const len = Math.floor(ac.sampleRate * 0.04);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    for (const dt of [0, 0.09]) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      const hp = ac.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 200;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1800;
      bp.Q.value = 0.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + dt + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.05);
      src.connect(hp).connect(bp).connect(g).connect(ac.destination);
      src.start(t0 + dt);
    }
  } catch {
    /* ignore */
  }
}

// 포획/충전 팝: 밝은 사인 블립 620→990Hz (저음 성분 없음).
export function sfxPop(): void {
  try {
    const ac = ensure();
    if (!ac) return;
    const t0 = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(620, t0);
    o.frequency.exponentialRampToValueAtTime(990, t0 + 0.07);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g).connect(ac.destination);
    o.start(t0);
    o.stop(t0 + 0.13);
  } catch {
    /* ignore */
  }
}
