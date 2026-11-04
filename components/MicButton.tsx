// components/MicButton.tsx — MC-1: 둥근 마이크 버튼 + 음량 링 + 장치 선택.
// UH-1 토큰은 아직 없으므로 기존 UI-5 유리 토큰(--battle-*)을 쓴다. UH-1에서 맞출 때
// 이 파일의 클래스(.mic-*)만 손보면 된다. 아이콘은 Lucide SVG path inline (ISC).
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deviceTier,
  encodeWav16,
  listMicDevices,
  markMicAsked,
  micAsked,
  openMicStream,
  pickDevice,
  recallDevice,
  rememberDevice,
  sendToVoiceApi,
  watchDeviceChange,
  type MicDeviceInfo,
} from "@/lib/audio/micSource";

type VadMod = typeof import("@ricky0123/vad-web");
type VadInst = { start: () => Promise<void>; pause: () => Promise<void>; destroy: () => Promise<void> };

const VAD_BASE = "/vendor/vad/";
const LONG_PRESS_MS = 400;
const SHEET_ICON_W = 22;

function forceSpeechRecog(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("mic") === "sr";
  } catch {
    return false;
  }
}

// Lucide (ISC) 24x24 스트로크 아이콘. 패키지 없이 path만 inline (UH-1 2단계 규칙).
function MicIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}
function GlassesIcon({ size = SHEET_ICON_W }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="15" r="4" />
      <circle cx="18" cy="15" r="4" />
      <path d="M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2" />
      <path d="M2.5 13 5 7c.7 1.3 1.4 2 3 2" />
      <path d="M21.5 13 19 7c-.7 1.3-1.5 2-3 2" />
    </svg>
  );
}
function PhoneIcon({ size = SHEET_ICON_W }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}
function LockIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
function DeviceIcon({ label, size }: { label: string; size?: number }) {
  const t = deviceTier(label);
  if (t === 0) return <GlassesIcon size={size} />;
  return <PhoneIcon size={size} />;
}

export type MicButtonProps = {
  /** 전사된 한 문장. 기존 voiceCapture onresult와 같은 하류(handleAsk/레거시)로 간다. */
  onSaid: (text: string) => void;
  /** VAD를 못 쓰면 기존 누르고 말하기(SpeechRecognition) 경로로 대체한다. */
  onFallback: () => void;
  /** 작은 알림(장치 전환·빈 전사 등)을 페이지 메시지 줄에 띄운다. */
  notice: (msg: string) => void;
  disabled?: boolean;
};

export default function MicButton({ onSaid, onFallback, notice, disabled }: MicButtonProps) {
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [denied, setDenied] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [devices, setDevices] = useState<MicDeviceInfo[]>([]);
  const [currentId, setCurrentId] = useState<string>("");
  const [currentLabel, setCurrentLabel] = useState<string>("");
  const vadRef = useRef<VadInst | null>(null);
  const ringRef = useRef<{ ctx: AudioContext; stream: MediaStream; raf: number } | null>(null);
  const ringFgRef = useRef<SVGCircleElement | null>(null);
  const pressTimer = useRef<number | null>(null);
  const liveRef = useRef(false);
  const onSaidRef = useRef(onSaid);
  const onFallbackRef = useRef(onFallback);
  const noticeRef = useRef(notice);
  onSaidRef.current = onSaid;
  onFallbackRef.current = onFallback;
  noticeRef.current = notice;

  const stopRing = useCallback(() => {
    const r = ringRef.current;
    ringRef.current = null;
    if (r) {
      cancelAnimationFrame(r.raf);
      r.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
      void r.ctx.close().catch(() => {});
    }
    if (ringFgRef.current) ringFgRef.current.style.strokeDashoffset = "226.2";
  }, []);

  const stopVad = useCallback(async () => {
    const v = vadRef.current;
    vadRef.current = null;
    if (v) {
      try { await v.destroy(); } catch { /* ignore */ }
    }
  }, []);

  const stopAll = useCallback(async () => {
    liveRef.current = false;
    setLive(false);
    setStarting(false);
    stopRing();
    await stopVad();
  }, [stopRing, stopVad]);

  // 음량 링: VAD 스트림과 별도로 같은 장치에서 가벼운 스트림을 열어 Analyser로 잰다.
  const startRing = useCallback(async (deviceId: string) => {
    stopRing();
    try {
      const { stream } = await openMicStream(deviceId || undefined);
      if (!liveRef.current) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
        return;
      }
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const CIRC = 226.2; // r=36
      const tick = () => {
        if (!liveRef.current) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const d = ((buf[i] ?? 128) - 128) / 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / buf.length);
        smooth += (Math.min(1, rms * 3) - smooth) * 0.25;
        if (ringFgRef.current) {
          ringFgRef.current.style.strokeDashoffset = String(CIRC * (1 - smooth));
        }
        const rec = ringRef.current;
        if (rec) rec.raf = requestAnimationFrame(tick);
      };
      ringRef.current = { ctx, stream, raf: requestAnimationFrame(tick) };
    } catch {
      // 링 실패는 치명적이지 않다. VAD는 그대로 둔다.
    }
  }, [stopRing]);

  const startVad = useCallback(async (deviceId: string) => {
    // 먼저 권한/장치를 확인한다. 거부·없음은 상위로 던져 안내 카드로 가고,
    // VAD 자체(설치·로드·모델) 실패만 false(누르고 말하기 대체)로 간다.
    const probe = await openMicStream(deviceId || undefined);
    probe.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* ignore */ } });
    let mod: VadMod;
    try {
      mod = await import("@ricky0123/vad-web");
    } catch {
      return false;
    }
    const idForStream = deviceId;
    try {
      const vad = await mod.MicVAD.new({
        model: "v5",
        baseAssetPath: VAD_BASE,
        onnxWASMBasePath: VAD_BASE,
        startOnLoad: false,
        // 장치를 우리가 고른다: 기본 resumeStream은 장치를 잃으므로 트랙 유지 방식으로 덮는다.
        getStream: () => openMicStream(idForStream || undefined).then((r) => r.stream),
        pauseStream: async (s: MediaStream) => {
          s.getTracks().forEach((t) => { t.enabled = false; });
        },
        resumeStream: async (s: MediaStream) => {
          s.getTracks().forEach((t) => { t.enabled = true; });
          return s;
        },
        onSpeechEnd: (audio: Float32Array) => {
          void (async () => {
            if (!liveRef.current) return;
            setSending(true);
            try {
              const wav = new Blob([encodeWav16(audio, 16000)], { type: "audio/wav" });
              const { text } = await sendToVoiceApi(wav);
              if (!liveRef.current) return;
              if (text) onSaidRef.current(text);
              else noticeRef.current("잘 안 들렸어요. 다시 말해 주세요");
            } catch {
              if (liveRef.current) noticeRef.current("음성 전송 실패. 다시 말해 주세요");
            } finally {
              setSending(false);
            }
          })();
        },
      });
      if (!liveRef.current) {
        try { await vad.destroy(); } catch { /* ignore */ }
        return true;
      }
      vadRef.current = vad as unknown as VadInst;
      await vad.start();
      return true;
    } catch {
      return false;
    }
  }, []);

  const startLive = useCallback(async (deviceId: string) => {
    liveRef.current = true;
    setLive(true);
    setStarting(true);
    // VAD 실패(설치·로드·모델) 시 기존 누르고 말하기로 대체한다.
    const ok = forceSpeechRecog() ? false : await startVad(deviceId);
    if (!liveRef.current) return;
    if (!ok) {
      await stopAll();
      onFallbackRef.current();
      return;
    }
    setStarting(false);
    void startRing(deviceId);
  }, [startVad, startRing, stopAll]);

  const beginFromTap = useCallback(async () => {
    if (denied) {
      setShowCard(true);
      return;
    }
    const list = await listMicDevices();
    setDevices(list);
    const picked = pickDevice(list, recallDevice());
    const id = picked?.deviceId ?? "";
    if (picked) {
      rememberDevice(picked.deviceId);
      setCurrentId(picked.deviceId);
      setCurrentLabel(picked.label);
    }
    await startLive(id);
  }, [denied, startLive]);

  const startFlow = useCallback(() => {
    void beginFromTap().catch((e: unknown) => {
      void stopAll();
      const name = e instanceof DOMException ? e.name : "";
      const msg = e instanceof Error ? e.message : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setDenied(true);
        setShowCard(true);
      } else if (name === "NotFoundError" || name === "OverconstrainedError" || msg === "mic-unsupported") {
        setShowCard(false);
        noticeRef.current("마이크를 찾을 수 없어요");
      } else {
        setShowCard(false);
        noticeRef.current("마이크를 열 수 없어요");
      }
    });
  }, [beginFromTap, stopAll]);

  const onTap = useCallback(() => {
    if (disabled || starting || sending) return;
    if (sheet) return;
    if (live) {
      void stopAll();
      return;
    }
    if (denied || !micAsked()) {
      setShowCard(true);
      return;
    }
    startFlow();
  }, [disabled, starting, sending, sheet, live, denied, startFlow]);

  const onPressStart = useCallback(() => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      void listMicDevices().then((list) => {
        setDevices(list);
        setSheet(true);
      });
    }, LONG_PRESS_MS);
  }, []);

  const onPressEnd = useCallback((fired: boolean) => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
      if (fired) onTap();
    }
  }, [onTap]);

  // 안경 연결/해제 시 자동 전환 + 작은 알림.
  useEffect(() => {
    const off = watchDeviceChange(() => {
      void listMicDevices().then((list) => {
        setDevices(list);
        const glasses = list.find((d) => deviceTier(d.label) === 0);
        if (glasses && glasses.deviceId !== recallDevice()) {
          rememberDevice(glasses.deviceId);
          setCurrentId(glasses.deviceId);
          setCurrentLabel(glasses.label);
          noticeRef.current("안경 마이크로 전환됨");
          if (liveRef.current) {
            void stopAll().then(() => startLive(glasses.deviceId).catch(() => {
              noticeRef.current("마이크를 열 수 없어요");
            }));
          }
          return;
        }
        // 쓰던 장치가 사라지면 살어 있는 최우선으로.
        if (liveRef.current) {
          const cur = recallDevice();
          if (cur && !list.some((d) => d.deviceId === cur)) {
            const picked = pickDevice(list, null);
            if (picked) {
              rememberDevice(picked.deviceId);
              setCurrentId(picked.deviceId);
              setCurrentLabel(picked.label);
              void stopAll().then(() => startLive(picked.deviceId).catch(() => {
                noticeRef.current("마이크를 열 수 없어요");
              }));
            }
          }
        }
      });
    });
    return off;
  }, [startLive, stopAll]);

  // 마운트 시 거부 상태면 잠금 표시. 앱은 계속 동작한다.
  useEffect(() => {
    let dead = false;
    try {
      const p = navigator.permissions?.query?.({ name: "microphone" as PermissionName });
      (p as Promise<{ state: string }> | undefined)?.then?.(
        (st) => { if (!dead && st?.state === "denied") setDenied(true); },
        () => {},
      );
    } catch {
      /* ignore */
    }
    return () => { dead = true; };
  }, []);

  // 언마운트 시 정리.
  useEffect(() => () => {
    liveRef.current = false;
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    stopRing();
    void stopVad();
  }, [stopRing, stopVad]);

  const chooseDevice = useCallback((d: MicDeviceInfo) => {
    rememberDevice(d.deviceId);
    setCurrentId(d.deviceId);
    setCurrentLabel(d.label);
    setSheet(false);
    if (liveRef.current) {
      void stopAll().then(() => startLive(d.deviceId).catch(() => {
        noticeRef.current("마이크를 열 수 없어요");
      }));
    }
  }, [startLive, stopAll]);

  const stateName = denied && !live ? "denied"
    : showCard ? "card"
    : sheet ? "sheet"
    : sending ? "sending"
    : starting ? "starting"
    : live ? "live" : "idle";

  return (
    <div className="mic-wrap">
      <button
        type="button"
        className={live ? "glass-mic glass-mic-live mic-btn" : "glass-mic mic-btn"}
        aria-label={denied && !live ? "마이크 잠김. 안내 보기" : live ? "마이크 끄기" : "마이크로 말하기. 길게 누르면 장치 선택"}
        aria-pressed={live}
        disabled={!!disabled}
        data-mic-state={stateName}
        onPointerDown={onPressStart}
        onPointerUp={() => onPressEnd(true)}
        onPointerLeave={() => onPressEnd(false)}
        onPointerCancel={() => onPressEnd(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {denied && !live ? <LockIcon /> : <MicIcon />}
        <svg className="mic-ring" viewBox="0 0 80 80" aria-hidden="true">
          <circle className="mic-ring-bg" cx="40" cy="40" r="36" />
          <circle ref={ringFgRef} className="mic-ring-fg" cx="40" cy="40" r="36" />
        </svg>
        {live && (
          <span className="mic-dev" aria-hidden="true">
            <DeviceIcon label={currentLabel} size={16} />
          </span>
        )}
      </button>

      {showCard && !denied && (
        <div className="mic-card glass-panel" role="dialog" aria-label="마이크 사용 안내">
          <div className="mic-card-title">크리처와 대화하려고 마이크를 써요</div>
          <div className="mic-card-body">
            안경이나 휴대폰 마이크로 말하면 크리처가 알아들어요. 녹음은 전사 후 버려요.
          </div>
          <div className="mic-card-row">
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => {
              setShowCard(false);
              markMicAsked();
              startFlow();
            }}>
              허용하기
            </button>
            <button type="button" className="hud-btn" onClick={() => {
              setShowCard(false);
              markMicAsked();
            }}>
              나중에
            </button>
          </div>
        </div>
      )}

      {showCard && denied && (
        <div className="mic-card glass-panel" role="dialog" aria-label="마이크 권한 안내">
          <div className="mic-card-title">마이크가 잠겼어요</div>
          <div className="mic-card-body">
            <div>안드로이드: 설정에서 앱 권한의 마이크를 허용해 주세요</div>
            <div>크롬: 주소창 왼쪽 아이콘에서 사이트 설정의 마이크를 허용해 주세요</div>
            <div>PC 앱: 윈도우 설정에서 개인정보의 마이크를 허용해 주세요</div>
          </div>
          <div className="mic-card-row">
            <button type="button" className="hud-btn hud-btn-primary" onClick={() => {
              setDenied(false);
              setShowCard(false);
              startFlow();
            }}>
              다시 시도
            </button>
            <button type="button" className="hud-btn" onClick={() => setShowCard(false)}>
              닫기
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <div className="mic-sheet glass-panel" role="dialog" aria-label="마이크 장치 선택">
          <div className="mic-sheet-title">마이크 선택</div>
          {devices.length === 0 && (
            <div className="mic-sheet-empty">장치가 없어요. 기본 마이크를 써요</div>
          )}
          {devices.map((d, i) => (
            <button
              key={`${d.deviceId}-${i}`}
              type="button"
              className={d.deviceId === currentId ? "mic-sheet-row mic-sheet-row-cur" : "mic-sheet-row"}
              aria-current={d.deviceId === currentId}
              onClick={() => chooseDevice(d)}
            >
              <DeviceIcon label={d.label} />
              <span className="mic-sheet-label">{d.label || `마이크 ${i + 1}`}</span>
              {d.deviceId === currentId && <span className="mic-sheet-cur">사용 중</span>}
            </button>
          ))}
          <button type="button" className="hud-btn" onClick={() => setSheet(false)}>
            닫기
          </button>
        </div>
      )}
    </div>
  );
}
