// components/battle/SnapCapture.tsx — D. 스냅 포획 (틀→아이리스→폴라로이드→스티커북, §16-1a).
"use client";

import { useEffect, useRef, useState } from "react";
import { ROSTER } from "@/lib/species";
import { CAPTURE_ATTEMPTS, captureRate } from "@/lib/battle/capture";
import { playCry } from "@/lib/cry";

type Phase = "aim" | "iris" | "card";

export default function SnapCapture({
  speciesId,
  objectName,
  hpRatio,
  fullness,
  auto,
  onDone,
}: {
  speciesId: string;
  objectName: string;
  hpRatio: number;
  fullness: number;
  auto?: boolean;
  onDone: (caught: boolean) => void;
}) {
  const sp = ROSTER.find((s) => s.id === speciesId) ?? ROSTER[0];
  const [x, setX] = useState(50);
  const xRef = useRef(50);
  const [phase, setPhase] = useState<Phase>("aim");
  const [attempt, setAttempt] = useState(1);
  const [result, setResult] = useState<{ ok: boolean; framed: boolean; rate: number } | null>(null);
  const [fled, setFled] = useState(false);
  const doneRef = useRef(false);
  const today = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "short", day: "numeric" });

  useEffect(() => {
    if (phase !== "aim" || fled) return;
    const t = window.setInterval(() => {
      const nx = Math.max(8, Math.min(92, xRef.current + (Math.random() - 0.5) * 16));
      xRef.current = nx;
      setX(nx);
    }, 120);
    return () => window.clearInterval(t);
  }, [phase, fled]);

  function shutter() {
    if (phase !== "aim" || fled) return;
    setPhase("iris");
    window.setTimeout(() => {
      const framed = Math.abs(xRef.current - 50) < 18;
      const rate = captureRate(hpRatio, fullness);
      const ok = framed && Math.random() < rate;
      setResult({ ok, framed, rate });
      setPhase("card");
      if (ok) {
        try {
          playCry(speciesId, "happy");
        } catch {
          /* ignore */
        }
        window.setTimeout(() => {
          if (!doneRef.current) {
            doneRef.current = true;
            onDone(true);
          }
        }, 900);
      }
    }, 400);
  }

  useEffect(() => {
    if (auto && phase === "aim" && !fled) {
      const t = window.setTimeout(shutter, 1000);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  function retry() {
    if (attempt >= CAPTURE_ATTEMPTS) {
      setFled(true);
      if (!doneRef.current) {
        doneRef.current = true;
        onDone(false);
      }
      return;
    }
    setAttempt((a) => a + 1);
    setResult(null);
    setPhase("aim");
  }

  return (
    <div style={{ background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12, color: "#fff" }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        스냅 포획 · {sp.name} · 시도 {attempt}/{CAPTURE_ATTEMPTS}
      </div>
      {phase === "card" && result ? (
        <div
          className={result.ok ? "" : "bfx-shake1"}
          style={{
            background: "#f5f2ea",
            color: "#222",
            borderRadius: 6,
            padding: "10px 10px 14px",
            maxWidth: 280,
            margin: "0 auto",
            border: result.ok ? "3px solid #ffd84a" : "3px solid #666",
            boxShadow: result.ok ? "0 0 18px #ffd84a" : "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sp.image} alt={sp.name} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 4, filter: result.ok ? "none" : "grayscale(0.7)" }} />
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{sp.name}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {today} · {objectName}
          </div>
          {!result.ok && (
            <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
              {result.framed ? "놓쳤다! 다시 찍을까요?" : "빗나감! 다시 찍을까요?"}
            </div>
          )}
        </div>
      ) : (
        <div style={{ position: "relative", height: 170, background: "#0c120e", borderRadius: 10, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sp.image}
            alt={sp.name}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: 35,
              width: 100,
              height: 100,
              objectFit: "cover",
              borderRadius: 12,
              transform: "translateX(-50%)",
              transition: "left 0.12s linear",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: 20,
              width: 130,
              height: 130,
              transform: "translateX(-50%)",
              border: "3px solid rgba(255,255,255,0.85)",
              borderRadius: 8,
              pointerEvents: "none",
            }}
          />
          {phase === "iris" && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(circle at 50% 50%, transparent 18%, rgba(0,0,0,0.92) 46%)",
                transition: "background 0.4s",
              }}
            />
          )}
        </div>
      )}
      {fled ? (
        <div style={{ fontSize: 13, marginTop: 8, color: "#9aa4b2" }}>야생 크리처가 틀 밖으로 도망갔다…</div>
      ) : phase === "aim" ? (
        <button onClick={shutter} className="glass-btn" style={{ width: "100%", fontSize: 14, marginTop: 8 }}>
          셔터
        </button>
      ) : phase === "card" && result && !result.ok ? (
        <button onClick={retry} className="glass-btn" style={{ width: "100%", fontSize: 14, marginTop: 8 }}>
          다시 찍기
        </button>
      ) : null}
    </div>
  );
}
