// components/battle/SkillModal.tsx — 스킬 선택 창 (§13-1). 탭·음성(번호·이름)·최대 3회.
"use client";

import { useEffect, useRef, useState } from "react";
import { matchSkillName, parseSkillNumber } from "./fx";
import type { MoveView } from "./SkillButtons";

interface SR extends EventTarget {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSR(): (new () => SR) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as new () => SR) ?? (w.webkitSpeechRecognition as new () => SR) ?? null;
}

export default function SkillModal({
  open,
  moves,
  onPick,
  onClose,
}: {
  open: boolean;
  moves: MoveView[];
  onPick: (i: number) => void;
  onClose: () => void;
}) {
  const [fails, setFails] = useState(0);
  const [heard, setHeard] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const srRef = useRef<SR | null>(null);
  const Ctor = getSR();

  useEffect(() => {
    if (open) {
      setFails(0);
      setHeard(null);
      setListening(false);
    } else {
      try {
        srRef.current?.stop();
      } catch {
        /* ignore */
      }
    }
  }, [open ]);

  if (!open) return null;

  function handleHeard(text: string) {
    setHeard(text);
    const names = moves.map((m) => m.name);
    const byNum = parseSkillNumber(text);
    if (byNum !== null && byNum < moves.length && !moves[byNum].disabled) {
      onPick(byNum);
      return;
    }
    const byName = matchSkillName(text, names);
    if (byName !== null && !moves[byName].disabled) {
      onPick(byName);
      return;
    }
    setFails((f) => f + 1);
  }

  function startMic() {
    if (!Ctor || fails >= 3 || listening) return;
    try {
      const sr = new Ctor();
      srRef.current = sr;
      sr.lang = "ko-KR";
      sr.interimResults = false;
      sr.maxAlternatives = 1;
      sr.onresult = (e) => {
        const t = e.results[0]?.[0]?.transcript ?? "";
        setListening(false);
        handleHeard(t);
      };
      sr.onerror = () => {
        setListening(false);
        setFails((f) => f + 1);
      };
      sr.onend = () => setListening(false);
      sr.start();
      setListening(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch {
      setFails((f) => f + 1);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        className="glass-panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 420, padding: "16px 18px", color: "#fff" }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>기술 선택</div>
        {moves.map((m, i) => (
          <button
            key={i}
            onClick={() => onPick(i)}
            disabled={m.disabled || m.cdLeft > 0}
            className="glass-btn"
            style={{ display: "flex", width: "100%", fontSize: 14, marginBottom: 6, justifyContent: "space-between", ...(m.disabled || m.cdLeft > 0 ? { opacity: 0.45 } : {}) }}
          >
            <span>
              {i + 1}. {m.name}
            </span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>
              {m.disabled ? "사용 불가" : m.cdLeft > 0 ? `${m.cdLeft}턴` : "사용 가능"}
            </span>
          </button>
        ))}
        {Ctor && (
          <button onClick={startMic} disabled={fails >= 3 || listening} className="glass-btn" style={{ width: "100%", fontSize: 13, marginTop: 4 }}>
            {listening ? "듣는 중…" : fails >= 3 ? "음성 시도 종료" : "마이크로 고르기 (번호·이름)"}
          </button>
        )}
        {heard && (
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>들은 말: {heard}</div>
        )}
        {fails >= 3 && (
          <div style={{ fontSize: 12, color: "#ffd9a0", marginTop: 6 }}>다시 말하거나 눌러 주세요.</div>
        )}
        {fails > 0 && fails < 3 && (
          <div style={{ fontSize: 12, color: "#ffd9a0", marginTop: 6 }}>다시 말하거나 눌러 주세요. ({fails}/3)</div>
        )}
      </div>
    </div>
  );
}
