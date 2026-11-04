// components/battle/SkillButtons.tsx — UI-2: 원형 십자 패드 (1 위·2 아래·3 왼쪽·4 오른쪽, 한글).
// UH-1: title 툴팁 제거(길게 누르기 400ms·포커스 말풍선으로 대체), 이름 잘림 제거(2줄·최소 10px),
// 원소색 테두리 빛 + game-icons 아이콘 + 눌림 스프링(motion). data-testid·동작은 그대로.
"use client";

import { useRef, useState } from "react";
import { motion } from "motion/react";
import { typeEdge, type Element, type MoveElement, type MoveKind } from "@/lib/battle/skills";
import { ELEMENT_FX_COLOR } from "./fx";

export interface MoveView {
  name: string;
  element: MoveElement;
  kind?: MoveKind;
  cdLeft: number;
  disabled: boolean;
}

const KIND_COLOR: Record<MoveKind, string> = {
  ATK: "#ff7b72",
  BUFF: "#7ee787",
  DEBUFF: "#79c0ff",
};

const KIND_KO: Record<MoveKind, string> = {
  ATK: "공격",
  BUFF: "버프",
  DEBUFF: "디버프",
};

// UH-1: 이름 수용 규격 (verify-no-ellipsis 정적 용량 검사와 같은 상수).
const SKILL_BTN_W = 64;
const SKILL_NAME_MIN = 10;
const SKILL_NAME_LINES = 2;

const PAD = 176;
const CIRCLE = SKILL_BTN_W;
// 1 위·2 아래·3 왼쪽·4 오른쪽
const POS = [
  { left: 54, top: 0 },
  { left: 54, top: 108 },
  { left: 0, top: 54 },
  { left: 108, top: 54 },
];

const TIP_MS = 400;

function iconKey(m: MoveView): string {
  if (m.element !== "none") return m.element;
  if (m.kind === "BUFF") return "buff";
  if (m.kind === "DEBUFF") return "debuff";
  return "basic";
}

export default function SkillButtons({
  moves,
  foeElement,
  onPick,
  disabledAll,
  timerSec,
  timerMax = 30,
}: {
  moves: MoveView[];
  foeElement: Element;
  onPick: (i: number) => void;
  disabledAll: boolean;
  /** BT-T: 남은 초 (null·undefined이면 숨김). */
  timerSec?: number | null;
  timerMax?: number;
}) {
  const [tip, setTip] = useState<number | null>(null);
  const timer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const suppressClick = useRef(false);

  function clearTipTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  const showTimer = timerSec !== null && timerSec !== undefined;
  const timerHot = showTimer && (timerSec as number) <= 5;
  const timerFrac = showTimer ? Math.max(0, Math.min(1, (timerSec as number) / Math.max(1, timerMax))) : 0;
  const TIMER_R = 17;
  const TIMER_C = 2 * Math.PI * TIMER_R;
  return (
    <div
      data-testid="skill-pad"
      style={{ position: "relative", width: PAD, height: PAD, borderRadius: "50%", border: "1px dashed rgba(255,255,255,0.22)", background: "rgba(10,14,20,0.45)" }}
    >
      {/* BT-T: 패드 가운데 작은 원형 카운트다운 (마지막 5초 빨강). 탭 방해 금지. */}
      {showTimer && (
        <div
          data-testid="battle-timer"
          aria-hidden
          style={{ position: "absolute", left: (PAD - 46) / 2, top: (PAD - 46) / 2, width: 46, height: 46, pointerEvents: "none" }}
        >
          <svg width="46" height="46" style={{ display: "block" }}>
            <circle cx="23" cy="23" r={TIMER_R} fill="#0a0a0a" stroke="#2a2a2a" strokeWidth="3" />
            <circle
              cx="23" cy="23" r={TIMER_R} fill="none"
              stroke={timerHot ? "#ff5a5a" : "#00f2fe"} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={TIMER_C} strokeDashoffset={TIMER_C * (1 - timerFrac)}
              transform="rotate(-90 23 23)"
            />
          </svg>
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 15, fontWeight: 700, fontFamily: "var(--battle-num)", color: timerHot ? "#ff8a80" : "#fff",
            fontVariantNumeric: "tabular-nums", textShadow: "0 1px 3px rgba(0,0,0,0.8)",
          }}>
            {timerSec}
          </div>
        </div>
      )}
      {moves.slice(0, 4).map((m, i) => {
        const edge = typeEdge(m.element, foeElement);
        const eff = edge > 1 ? "효과 좋음" : edge < 1 ? "효과 별로" : "";
        const off = disabledAll || m.disabled || m.cdLeft > 0;
        const ring = (m.element !== "none" ? ELEMENT_FX_COLOR[m.element] : undefined) ?? "#ffffff";
        const pos = POS[i] ?? POS[0];
        const longest = Math.max(0, ...m.name.split(" ").map((w) => w.length));
        const nameFs = longest > 4 ? SKILL_NAME_MIN : 11;
        const tipText = eff ? `${m.name} — ${eff}` : m.name;
        return (
          <motion.button
            key={i}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              onPick(i);
            }}
            disabled={off}
            onPointerDown={() => {
              if (off) return;
              longFired.current = false;
              clearTipTimer();
              timer.current = window.setTimeout(() => {
                longFired.current = true;
                setTip(i);
                hideTimer.current = window.setTimeout(() => setTip((t) => (t === i ? null : t)), 1800);
              }, TIP_MS);
            }}
            onPointerUp={() => {
              if (timer.current !== null) {
                window.clearTimeout(timer.current);
                timer.current = null;
              }
              if (longFired.current) {
                suppressClick.current = true;
                longFired.current = false;
                return; // 길게 누르기 말풍선은 1.8초 유지
              }
              setTip((t) => (t === i ? null : t));
            }}
            onPointerLeave={() => {
              clearTipTimer();
              longFired.current = false;
              setTip((t) => (t === i ? null : t));
            }}
            onPointerCancel={() => {
              clearTipTimer();
              longFired.current = false;
              setTip((t) => (t === i ? null : t));
            }}
            onFocus={() => {
              if (!off) setTip(i);
            }}
            onBlur={() => setTip((t) => (t === i ? null : t))}
            aria-label={`${i + 1}번 ${m.name}${eff ? `, ${eff}` : ""}`}
            className="bsk-btn"
            whileTap={off ? undefined : { scale: 0.88 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            style={{
              position: "absolute",
              left: pos.left,
              top: pos.top,
              width: CIRCLE,
              height: CIRCLE,
              borderRadius: "50%",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              color: "#fff",
              background: "radial-gradient(circle at 50% 35%, #2a2a2a 0%, #000 72%)",
              border: "none",
              boxShadow: off ? "none" : `0 0 6px 1px ${ring}55`,
              cursor: off ? "default" : "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 0,
              padding: "4px 5px",
              ...(off ? { opacity: 0.55 } : {}),
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 600, fontFamily: "var(--battle-font)", color: m.kind ? KIND_COLOR[m.kind] : "#9aa4b2", letterSpacing: 0.5, lineHeight: 1.2 }}>
              {i + 1} {m.kind ? KIND_KO[m.kind] : ""}
            </span>
            <span
              className="skl-ico"
              aria-hidden
              style={{ width: 17, height: 17, margin: "1px 0", color: ring, "--skl-url": `url(/icons/skills/${iconKey(m)}.svg)` } as React.CSSProperties}
            />
            <span
              style={{
                fontSize: nameFs, fontFamily: "var(--battle-font)", fontWeight: 600, color: "#fff", opacity: 0.98,
                lineHeight: 1.15, textAlign: "center", wordBreak: "keep-all", overflowWrap: "anywhere",
                display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: SKILL_NAME_LINES,
                overflow: "hidden", maxHeight: `${SKILL_NAME_LINES * 1.15}em`,
              }}
            >
              {m.name}
            </span>
            {m.cdLeft > 0 && (
              <span style={{ position: "absolute", inset: -2, borderRadius: "50%", border: "2px solid rgba(255,90,90,0.85)", pointerEvents: "none" }} />
            )}
            {m.cdLeft > 0 && (
              <span style={{ position: "absolute", top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9, background: "#ff5a5a", color: "#fff", fontSize: 10, fontWeight: 600, lineHeight: "17px", textAlign: "center", fontFamily: "var(--battle-num)" }}>
                {m.cdLeft}
              </span>
            )}
            {tip === i && !off && (
              <span className="skl-tip" role="status">
                {tipText}
              </span>
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
