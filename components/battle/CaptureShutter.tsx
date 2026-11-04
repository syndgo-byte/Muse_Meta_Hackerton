// components/battle/CaptureShutter.tsx — 9-G capture shutter sequence (self-made).
// Order: caption fade -> spark gather 0.5s -> viewfinder 0.6s -> flash 60ms -> polaroid -> result line.
// Decision logic mirrors SnapCapture (framed window + captureRate + 3 attempts); dice stay in lib/battle/capture.
"use client";

import { useEffect, useRef, useState } from "react";
import { ROSTER } from "@/lib/species";
import { CAPTURE_ATTEMPTS, captureRate } from "@/lib/battle/capture";
import { playCry } from "@/lib/cry";

type Phase = "aim" | "gather" | "finder" | "flash" | "card";

function holdFor(tag: string): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as { __capHold?: string }).__capHold === tag
  );
}

function after(ms: number, holdTag: string | null, fn: () => void): void {
  window.setTimeout(function tick() {
    if (holdTag && holdFor(holdTag)) {
      window.setTimeout(tick, 100);
      return;
    }
    fn();
  }, ms);
}

const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];
const TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

function Bracket({ style }: { style: React.CSSProperties }) {
  return <div style={{ position: "absolute", width: 26, height: 26, borderColor: "rgba(255,255,255,0.9)", ...style }} />;
}

export default function CaptureShutter({
  speciesId,
  objectName,
  hpRatio,
  fullness,
  auto,
  hidden = false,
  onDone,
}: {
  speciesId: string;
  objectName: string;
  hpRatio: number;
  fullness: number;
  auto?: boolean;
  hidden?: boolean;
  onDone: (caught: boolean) => void;
}) {
  const sp = ROSTER.find((s) => s.id === speciesId) ?? ROSTER[0];
  const displayName = sp.name;
  const [x, setX] = useState(50);
  const xRef = useRef(50);
  const [phase, setPhase] = useState<Phase>("aim");
  const [attempt, setAttempt] = useState(1);
  const [result, setResult] = useState<{ ok: boolean; framed: boolean; rate: number } | null>(null);
  const [fled, setFled] = useState(false);
  const doneRef = useRef(false);
  const today = new Date().toLocaleDateString("en-US", { timeZone: "Asia/Seoul", month: "short", day: "numeric" });

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
    setPhase("gather");
    after(500, null, () => setPhase("finder"));
  }

  useEffect(() => {
    if (phase !== "finder" || fled) return;
    after(600, "finder", () => {
      const framed = Math.abs(xRef.current - 50) < 18;
      const rate = captureRate(hpRatio, fullness);
      const ok = framed && Math.random() < rate;
      setResult({ ok, framed, rate });
      setPhase("flash");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, fled]);

  useEffect(() => {
    if (phase !== "flash") return;
    after(60, "flash", () => setPhase("card"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (auto && phase === "aim" && !fled) {
      const t = window.setTimeout(shutter, 1000);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  useEffect(() => {
    if (phase === "card" && result?.ok && !doneRef.current) {
      try {
        playCry(speciesId, "happy");
      } catch {
        /* ignore */
      }
      const t = window.setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone(true);
        }
      }, 900);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result]);

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

  // VF-1 #8: hide while driving (state and timers keep running).
  if (hidden) return null;

  return (
    <div
      data-testid="capture-shutter"
      data-phase={phase}
      style={{ background: "rgba(0,0,0,0.35)", borderRadius: 12, padding: 12, color: "#fff" }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
        포획 &middot; {displayName} &middot; 시도 {attempt}/{CAPTURE_ATTEMPTS}
      </div>
      <div className={phase === "aim" ? undefined : "cap-caption-out"} style={{ fontSize: 11, opacity: 0.85, marginBottom: 6 }}>
        스냅샷 &mdash; 야생 크리처를 틀에 맞추세요
      </div>
      {phase === "card" && result ? (
        <div
          className={result.ok ? "" : "bfx-shake1"}
          data-testid="capture-polaroid"
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
          <img src={sp.image} alt={displayName} style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: 4, filter: result.ok ? "none" : "grayscale(0.7)" }} />
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{displayName}</div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {today} &middot; {objectName}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
            {result.ok ? "포획!" : result.framed ? "놓쳤다! 다시 찍을까요?" : "빗나감! 다시 찍을까요?"}
          </div>
        </div>
      ) : (
        <div style={{ position: "relative", height: 170, background: "#0c120e", borderRadius: 10, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sp.image}
            alt={displayName}
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
          {phase === "gather" &&
            SPARKS.map((deg) => {
              const r = (deg * Math.PI) / 180;
              const sx = Math.round(Math.cos(r) * 110);
              const sy = Math.round(Math.sin(r) * 70);
              return (
                <span
                  key={deg}
                  className="cap-spark"
                  style={{ "--sx": `${sx}px`, "--sy": `${sy}px` } as React.CSSProperties}
                />
              );
            })}
          {phase === "finder" && (
            <div data-testid="capture-finder" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <Bracket style={{ left: 10, top: 8, borderLeftWidth: 3, borderTopWidth: 3, borderStyle: "solid" }} />
              <Bracket style={{ right: 10, top: 8, borderRightWidth: 3, borderTopWidth: 3, borderStyle: "solid" }} />
              <Bracket style={{ left: 10, bottom: 8, borderLeftWidth: 3, borderBottomWidth: 3, borderStyle: "solid" }} />
              <Bracket style={{ right: 10, bottom: 8, borderRightWidth: 3, borderBottomWidth: 3, borderStyle: "solid" }} />
              <div style={{ position: "absolute", left: 44, right: 44, top: 10, display: "flex", justifyContent: "space-between" }}>
                {TICKS.map((i) => (
                  <span key={i} style={{ width: 2, height: i % 3 === 0 ? 10 : 6, background: "rgba(255,255,255,0.75)" }} />
                ))}
              </div>
              <div style={{ position: "absolute", left: 44, right: 44, bottom: 26, display: "flex", justifyContent: "space-between" }}>
                {TICKS.map((i) => (
                  <span key={i} style={{ width: 2, height: i % 3 === 0 ? 10 : 6, background: "rgba(255,255,255,0.75)" }} />
                ))}
              </div>
              <svg width="130" height="130" viewBox="0 0 130 130" style={{ position: "absolute", left: "50%", top: "62%", transform: "translate(-50%,-50%)" }}>
                <circle cx="65" cy="65" r="54" fill="none" stroke="rgba(140,190,255,0.55)" strokeWidth="2" strokeDasharray="4 5" />
                <circle
                  className="cap-arc"
                  cx="65" cy="65" r="54" fill="none" stroke="rgba(140,190,255,0.95)" strokeWidth="3"
                  strokeDasharray="339" strokeLinecap="round" transform="rotate(-90 65 65)"
                />
              </svg>
              <div style={{ position: "absolute", left: 0, right: 0, top: 34, textAlign: "center", fontSize: 15, fontWeight: 600, letterSpacing: 2 }}>
                셔터
              </div>
            </div>
          )}
          {phase === "flash" && (
            <div data-testid="capture-flash" style={{ position: "absolute", inset: 0, background: "#fff" }} />
          )}
        </div>
      )}
      {fled ? (
        <div style={{ fontSize: 13, marginTop: 8, color: "#9aa4b2" }}>야생 크리처가 틀 밖으로 도망갔다&hellip;</div>
      ) : phase === "aim" ? (
        <button onClick={shutter} className="glass-btn" style={{ width: "100%", fontSize: 14, marginTop: 8 }}>
          셔터
        </button>
      ) : phase === "card" && result && !result.ok ? (
        <button onClick={retry} className="glass-btn" style={{ width: "100%", fontSize: 14, marginTop: 8 }}>다시 찍기</button>
      ) : null}
    </div>
  );
}
