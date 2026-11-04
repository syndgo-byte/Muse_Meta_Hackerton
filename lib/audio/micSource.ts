// lib/audio/micSource.ts — MC-1: 마이크 입력 장치 선택·기억·전환 (한 곳).
// Ray-Ban Meta 안경은 휴대폰 블루투스 HFP 입력 장치로 보이므로 별도 SDK 없이
// getUserMedia + deviceId로 고른다. 음성은 기존 /api/voice 경로로만 보낸다.
export type MicDeviceInfo = {
  deviceId: string;
  label: string;
  kind?: string;
};

/** MC-1 장치 우선순위 (순서대로). 정규식은 그대로 verify-mic이 검사한다. */
export const GLASSES_RE = /Ray-Ban|Meta|Oakley/i;
export const HEADSET_RE = /Bluetooth|Hands-Free|Headset|HFP/i;

const STORE_KEY = "mc1.micDeviceId";
const ASKED_KEY = "mc1.micAsked";

/** 0=안경, 1=블루투스/헤드셋, 2=기본(휴대폰/PC). 라벨 없으면 2. */
export function deviceTier(label: string): 0 | 1 | 2 {
  if (GLASSES_RE.test(label)) return 0;
  if (HEADSET_RE.test(label)) return 1;
  return 2;
}

/**
 * 순수 함수: 오디오 입력 장치를 우선순위대로 안정 정렬한다.
 * 동점(라벨 없음 포함)은 입력 순서를 유지한다.
 */
export function rankDevices(devices: MicDeviceInfo[]): MicDeviceInfo[] {
  return devices
    .map((d, i) => ({ d, i }))
    .sort((a, b) => deviceTier(a.d.label) - deviceTier(b.d.label) || a.i - b.i)
    .map((r) => r.d);
}

/** 저장된 deviceId가 목록에 있으면 그것을, 없으면 최우선 장치를. 목록이 비면 null. */
export function pickDevice(
  devices: MicDeviceInfo[],
  savedId: string | null,
): MicDeviceInfo | null {
  const inputs = devices.filter((d) => !d.kind || d.kind === "audioinput");
  if (inputs.length === 0) return null;
  if (savedId) {
    const hit = inputs.find((d) => d.deviceId === savedId);
    if (hit) return hit;
  }
  return rankDevices(inputs)[0] ?? null;
}

function storage(): Storage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** 고른 deviceId를 기억한다 (실패해도 조용히). */
export function rememberDevice(deviceId: string): void {
  try {
    storage()?.setItem(STORE_KEY, deviceId);
  } catch {
    /* ignore */
  }
}

/** 기억한 deviceId. 없거나 접근 불가면 null. */
export function recallDevice(): string | null {
  try {
    return storage()?.getItem(STORE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** 첫 사용 안내 카드를 이미 봤는지. */
export function micAsked(): boolean {
  try {
    return storage()?.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

/** 첫 사용 안내 카드를 봤다고 기록한다. */
export function markMicAsked(): void {
  try {
    storage()?.setItem(ASKED_KEY, "1");
  } catch {
    /* ignore */
  }
}

/**
 * MC-1 마이크 제약. HFP는 8~16kHz라 sampleRate를 강제하지 않고
 * 실제 값을 읽어 /api/voice에 맞게 리샘플한다.
 */
export function micConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  if (deviceId) c.deviceId = { exact: deviceId };
  return c;
}

export type OpenMicResult = {
  stream: MediaStream;
  /** 트랙 설정의 실제 샘플레이트 (없으면 0). */
  sampleRate: number;
  deviceId: string;
};

/** 선택된 장치로 마이크 스트림을 연다. exact 실패 시 장치 지정 없이 1회 재시도. */
export async function openMicStream(deviceId?: string): Promise<OpenMicResult> {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.getUserMedia) throw new Error("mic-unsupported");
  let stream: MediaStream;
  try {
    stream = await md.getUserMedia({ audio: micConstraints(deviceId) });
  } catch (e) {
    if (!deviceId) throw e;
    stream = await md.getUserMedia({ audio: micConstraints(undefined) });
  }
  const track = stream.getAudioTracks()[0];
  const st = track?.getSettings?.() ?? {};
  return {
    stream,
    sampleRate: typeof st.sampleRate === "number" ? st.sampleRate : 0,
    deviceId: typeof st.deviceId === "string" ? st.deviceId : (deviceId ?? ""),
  };
}

/** 오디오 입력 장치 목록. kind가 audioinput인 것만. */
export async function listMicDevices(): Promise<MicDeviceInfo[]> {
  const md = globalThis.navigator?.mediaDevices;
  if (!md?.enumerateDevices) return [];
  const all = await md.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
}

/** devicechange 구독. 해제 함수를 돌려준다. */
export function watchDeviceChange(cb: () => void): () => void {
  try {
    globalThis.navigator?.mediaDevices?.addEventListener?.("devicechange", cb);
  } catch {
    /* ignore */
  }
  return () => {
    try {
      globalThis.navigator?.mediaDevices?.removeEventListener?.("devicechange", cb);
    } catch {
      /* ignore */
    }
  };
}

/**
 * 순수 함수: 모노 Float32를 선형 보간으로 리샘플한다.
 * HFP 저샘플 → /api/voice용 16kHz.
 */
export function resampleMono(src: Float32Array, fromRate: number, toRate = 16000): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0) || src.length === 0) return new Float32Array(0);
  if (fromRate === toRate) return Float32Array.from(src);
  const outLen = Math.max(1, Math.round((src.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = (i * (src.length - 1)) / (outLen - 1 || 1);
    const lo = Math.floor(pos);
    const hi = Math.min(src.length - 1, lo + 1);
    const t = pos - lo;
    out[i] = (src[lo] ?? 0) * (1 - t) + (src[hi] ?? 0) * t;
  }
  return out;
}

/** 순수 함수: 모노 Float32(-1..1)를 16bit PCM WAV로 인코딩한다. */
export function encodeWav16(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export type VoiceApiResult = { text: string; fallback: boolean };

/** /api/voice 전사 응답을 관대하게 읽는다. 모양: { result: { text }, fallback? }. */
export function parseVoiceText(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const r = (data as { result?: unknown }).result;
  if (!r || typeof r !== "object") return "";
  const rec = r as Record<string, unknown>;
  const t = rec.text ?? rec.transcription ?? rec.transcript;
  return typeof t === "string" ? t : "";
}

/**
 * WAV 오디오 1건을 기존 /api/voice 경로로만 보낸다.
 * 오프라인 대체(fallback:true, 빈 전사)도 정상 반환으로 취급한다.
 */
export async function sendToVoiceApi(wav: Blob): Promise<VoiceApiResult> {
  const form = new FormData();
  form.append("audio", wav, "voice.wav");
  const res = await fetch("/api/voice", { method: "POST", body: form });
  const data: unknown = await res.json().catch(() => null);
  const fallback =
    !!data && typeof data === "object" && (data as { fallback?: unknown }).fallback === true;
  return { text: parseVoiceText(data), fallback };
}
