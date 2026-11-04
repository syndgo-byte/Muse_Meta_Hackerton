// app/hud/page.tsx — E2 레이벤 Web App 화면 4종 (RAYBAN_UI §3-2).
// 규칙: 600x600, 배경 순수 #000, 외곽선만, 하단 정렬, 글자 >=28px, 한 줄 14자 이내.
// 입력: 방향키 + Enter만. 드래그·호버·터치 핸들러 금지.
// 데이터: GET /api/status 읽기만 + PF-1 만남 알림(GET /api/hud 폴링).
// 배틀 화면은 lib/battle import만 한다.
"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BODY_SLAM,
  ELEMENT_SKILLS,
  ROLE_SKILLS,
  type MoveDef,
} from "@/lib/battle/skills";
import { UNIQUES, speciesOf } from "@/lib/battle/roster";
import { ensureStarter } from "@/lib/starter";

type Screen = "idle" | "hazard" | "battle" | "result";

const ACCENT = "#ffd84a";
const DANGER = "#ff5a5a";
const INK = "#ffffff";

type Status = {
  fullness: number;
  energy: number;
  affection: number;
  xp: number;
  level: number;
  hp?: number;
};

function useStatus(): Status | null {
  const [s, setS] = useState<Status | null>(null);
  useEffect(() => {
    ensureStarter(); // ST-1: 첫 실행 스타터 지급
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/status", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as Status;
        if (alive) setS(j);
      } catch {
        /* 오프라인이면 기본 표시 */
      }
    };
    void load();
    const t = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return s;
}

type HudNotice = {
  kind: "meet" | "battle" | "ask";
  text: string;
  me: string;
  foe: string;
  at: number;
};

/** PF-1: 휴대폰이 올린 만남 알림을 E1 방식(폴링)으로 받는다. */
function useHudNotice(): HudNotice | null {
  const [n, setN] = useState<HudNotice | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/hud", { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { notice?: unknown };
        const v = j.notice as Partial<HudNotice> | null;
        if (!alive) return;
        if (
          v && typeof v === "object" &&
          (v.kind === "meet" || v.kind === "battle" || v.kind === "ask") &&
          typeof v.text === "string" && typeof v.me === "string" &&
          typeof v.foe === "string" && typeof v.at === "number"
        ) {
          setN({ kind: v.kind, text: v.text, me: v.me, foe: v.foe, at: v.at });
        } else {
          setN(null);
        }
      } catch {
        /* 오프라인이면 기본 표시 */
      }
    };
    void load();
    const t = setInterval(load, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return n;
}

const shell: React.CSSProperties = {
  width: 600,
  height: 600,
  background: "#000",
  color: INK,
  fontFamily: "system-ui, 'Malgun Gothic', sans-serif",
  fontSize: 28,
  lineHeight: 1.4,
  display: "flex",
  flexDirection: "column",
  justifyContent: "flex-end",
  alignItems: "stretch",
  padding: 24,
  boxSizing: "border-box",
  overflow: "hidden",
};

const btn: React.CSSProperties = {
  fontSize: 28,
  background: "#000",
  color: INK,
  border: "3px solid #ffffff",
  borderRadius: 8,
  padding: "10px 14px",
  fontFamily: "inherit",
};

function HudStyle({ preview }: { preview: boolean }) {
  return (
    <style>{`
      html, body { margin: 0; padding: 0; background: #000; }
      .hud-focus:focus { outline: 5px solid ${ACCENT}; outline-offset: 3px; }
      ${
        preview
          ? `.hud-shell { background-image: conic-gradient(#333 0 25%, #000 0 50%, #333 0 75%, #000 0) !important; background-size: 40px 40px !important; }`
          : ""
      }
      @keyframes hud-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0.15; } }
      .hud-blink { animation: hud-blink 0.5s steps(1) infinite; }
      @media (prefers-reduced-motion: reduce) { .hud-blink { animation: none; } }
    `}</style>
  );
}

function IdleScreen({ onBond }: { onBond: () => void }) {
  const s = useStatus();
  const [sent, setSent] = useState(false);
  const danger =
    s !== null && (s.fullness <= 10 || s.energy <= 10)
      ? s.fullness <= 10
        ? "배고파!"
        : "지쳤어!"
      : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
      <div style={{ fontSize: 28, border: "3px solid #ffffff", borderRadius: 8, padding: "8px 14px" }}>
        {sent ? "요청 보냄!" : "안녕!"}
      </div>
      {danger !== null && (
        <div style={{ fontSize: 28, color: DANGER, border: `3px solid ${DANGER}`, borderRadius: 8, padding: "8px 14px" }}>
          {danger}
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hud/creature.png" alt="" width={160} height={160} />
      <button
        type="button"
        className="hud-focus"
        style={{ ...btn, borderColor: ACCENT, color: ACCENT }}
        onClick={() => {
          setSent(true);
          onBond();
        }}
      >
        교감하기
      </button>
    </div>
  );
}

const DIR_ROT: Record<string, number> = { up: 0, right: 90, down: 180, left: 270 };

function HazardScreen({ dir, onDone }: { dir: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <div
        className="hud-blink"
        style={{
          fontSize: 40,
          color: DANGER,
          border: `4px solid ${DANGER}`,
          borderRadius: 10,
          padding: "10px 22px",
        }}
      >
        위험해!
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hud/arrow.png"
        alt=""
        width={64}
        height={64}
        style={{ transform: `rotate(${DIR_ROT[dir] ?? 0}deg)` }}
      />
    </div>
  );
}

function BattleScreen({ me, foe }: { me: string; foe: string }) {
  const mine = speciesOf(me);
  const theirs = speciesOf(foe);
  const moves: MoveDef[] = [
    BODY_SLAM,
    ELEMENT_SKILLS[mine.element],
    ROLE_SKILLS[mine.role],
    UNIQUES[mine.id],
  ];
  const [sel, setSel] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    btnRefs.current[sel]?.focus();
  }, [sel]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") {
        setSel(0);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setSel(1);
        e.preventDefault();
      } else if (e.key === "ArrowDown") {
        setSel(2);
        e.preventDefault();
      } else if (e.key === "ArrowLeft") {
        setSel(3);
        e.preventDefault();
      } else if (e.key === "Enter") {
        setDone(moves[sel].name);
        e.preventDefault();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel]
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const short = (n: string) => (n.length > 6 ? n.slice(0, 6) : n);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 28 }}>아군 {mine.name}</div>
      <div style={{ fontSize: 28 }}>적군 {theirs.name}</div>
      {done !== null && <div style={{ fontSize: 28, color: ACCENT }}>선택: {short(done)}</div>}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gridTemplateRows: "auto auto auto",
          gap: 8,
          justifyItems: "center",
          alignItems: "center",
        }}
      >
        <span />
        <button
          type="button"
          ref={(el) => {
            btnRefs.current[0] = el;
          }}
          className="hud-focus"
          style={{ ...btn, borderColor: sel === 0 ? ACCENT : "#ffffff" }}
          onClick={() => {
            setSel(0);
            setDone(moves[0].name);
          }}
        >
          ↑{short(moves[0].name)}
        </button>
        <span />
        <button
          type="button"
          ref={(el) => {
            btnRefs.current[3] = el;
          }}
          className="hud-focus"
          style={{ ...btn, borderColor: sel === 3 ? ACCENT : "#ffffff" }}
          onClick={() => {
            setSel(3);
            setDone(moves[3].name);
          }}
        >
          ←{short(moves[3].name)}
        </button>
        <span style={{ fontSize: 28 }}>기술</span>
        <button
          type="button"
          ref={(el) => {
            btnRefs.current[1] = el;
          }}
          className="hud-focus"
          style={{ ...btn, borderColor: sel === 1 ? ACCENT : "#ffffff" }}
          onClick={() => {
            setSel(1);
            setDone(moves[1].name);
          }}
        >
          {short(moves[1].name)}→
        </button>
        <span />
        <button
          type="button"
          ref={(el) => {
            btnRefs.current[2] = el;
          }}
          className="hud-focus"
          style={{ ...btn, borderColor: sel === 2 ? ACCENT : "#ffffff" }}
          onClick={() => {
            setSel(2);
            setDone(moves[2].name);
          }}
        >
          ↓{short(moves[2].name)}
        </button>
        <span />
      </div>
    </div>
  );
}

function ResultScreen({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "center" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/hud/icon-ok.png" alt="" width={64} height={64} />
      <div style={{ fontSize: 40 }}>{text}</div>
    </div>
  );
}

function HudInner() {
  const q = useSearchParams();
  const raw = q.get("screen");
  const screen: Screen =
    raw === "hazard" || raw === "battle" || raw === "result" ? raw : "idle";
  const preview = q.get("preview") === "1";
  const [override, setOverride] = useState<Screen | null>(null);
  // PF-1: 새 알림이 오면 기존 결과·배틀 화면으로 보여준다(화면 공용, 새 입력 없음).
  const notice = useHudNotice();
  const [dismissedAt, setDismissedAt] = useState(0);
  const live = notice && notice.at !== dismissedAt ? notice : null;
  const noticeScreen: Screen | null = live ? (live.kind === "battle" ? "battle" : "result") : null;
  const shown: Screen = override ?? noticeScreen ?? screen;

  useEffect(() => {
    setOverride(null);
  }, [screen]);

  // ← = 뒤로, result는 아무 키나 닫기. idle·battle의 ← 동작은 각 화면이 처리.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shown === "result") {
        setOverride("idle");
        if (live) setDismissedAt(live.at);
      } else if (shown === "hazard" && e.key === "ArrowLeft") setOverride("idle");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, live]);

  const resultText = (live?.kind === "meet" || live?.kind === "ask" ? live.text : (q.get("text") ?? "포획 성공")).slice(0, 14);
  const battleMe = live?.kind === "battle" ? live.me : (q.get("me") ?? "fire-01");
  const battleFoe = live?.kind === "battle" ? live.foe : (q.get("foe") ?? "grass-04");
  return (
    <div className="hud-shell" style={shell} data-hud-notice={live ? live.at : 0}>
      <HudStyle preview={preview} />
      {shown === "idle" && <IdleScreen onBond={() => {}} />}
      {shown === "hazard" && (
        <HazardScreen dir={q.get("dir") ?? "left"} onDone={() => setOverride("idle")} />
      )}
      {shown === "battle" && (
        <BattleScreen me={battleMe} foe={battleFoe} />
      )}
      {shown === "result" && <ResultScreen text={resultText} />}
    </div>
  );
}

export default function HudPage() {
  return (
    <Suspense>
      <HudInner />
    </Suspense>
  );
}
