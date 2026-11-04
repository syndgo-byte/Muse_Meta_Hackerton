// components/battle/BattleStage.tsx — AR/2D shared battle stage (9-F: top row + bottom row layout).
// UH-1: 도망 버튼은 Lucide 발자국 + 0.6초 길게 누르기(진행 링). 아래 FleeButton 참고.
// 아이콘: Lucide "footprints" SVG path inline (ISC, https://lucide.dev/icons/footprints).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import HpBar from "./HpBar";
import SkillButtons, { type MoveView } from "./SkillButtons";
import DistanceBar from "./DistanceBar";
import Floaters from "./Floaters";
import Particles from "./Particles";
import { ELEMENT_FX_COLOR, fxFromEvents, shouldPlayAttackCry } from "./fx";
import { playCry } from "@/lib/cry";
import { fleeStatus, type BattleEvent, type Fighter } from "@/lib/battle/engine";

export interface FighterView {
  id: string;
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  element: Fighter["element"];
  status: string | null;
  stages: Partial<Record<string, number>>;
  resists: Partial<Record<string, number>>;
}

export default function BattleStage({
  compact,
  wild,
  mine,
  moves,
  events,
  fxKey,
  distance,
  fled,
  onPickMove,
  movesDisabled,
  onFlee,
  hold,
  fxFullscreen,
  holdFx,
  timerSec,
  timerMax,
}: {
  compact?: boolean;
  wild: FighterView;
  mine: FighterView;
  moves: MoveView[];
  events: BattleEvent[];
  fxKey: number;
  /** 9-F: meters from the battle origin object (no manual stepping). */
  distance: number;
  fled: boolean;
  onPickMove: (i: number) => void;
  movesDisabled?: boolean;
  onFlee: () => void;
  hold?: boolean;
  /** 9-E: AR renders particles/numbers/rings on a fullscreen layer (2D demo keeps the box). */
  fxFullscreen?: boolean;
  /** BP-3: 히트스톱 (연출 일시정지). */
  holdFx?: boolean;
  /** BT-T: 남은 초 (null이면 카운트다운 숨김). */
  timerSec?: number | null;
  timerMax?: number;
}) {
  const fx = useMemo(() => fxFromEvents(events, fxKey), [events, fxKey]);
  useEffect(() => {
    if (fleeStatus(distance) === "flee" && !fled) onFlee();
  }, [distance, fled, onFlee]);
  useEffect(() => {
    if (shouldPlayAttackCry(events)) {
      try {
        playCry(mine.id, "attack");
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxKey]);
  const ringColor = (side: "mine" | "wild", el?: string) =>
    (el ? ELEMENT_FX_COLOR[el] : undefined) ??
    ELEMENT_FX_COLOR[side === "mine" ? mine.element : wild.element] ??
    "#ffffff";
  const fxLayer = (
    <>
      <Particles bursts={fx.bursts} burstKey={fxKey} hold={holdFx} />
      <Floaters items={fx.items} fxKey={fxKey} hold={hold} />
      {fx.rings.map((r, i) => (
        <div
          key={`${fxKey}-ring-${i}`}
          className="bfx-ring"
          style={{
            top: r.side === "wild" ? "10%" : "48%",
            ...(r.side === "wild" ? { right: "10%" } : { left: "6%" }),
            borderColor: ringColor(r.side, r.element),
            ...(hold ? { animation: "none", transform: "scale(1)", opacity: 0.85 } : {}),
          }}
        />
      ))}
      {fx.flags.vignette && <div className="bfx-vignette" />}
    </>
  );
  const faintSide = fx.flags.faintWild ? wild : fx.flags.faintMine ? mine : null;
  const fleeOff = fled; // MF-0: 도망은 운전/연출 잠금과 무관한 안전 탈출구
  const fleeWarn = !fled && fleeStatus(distance) !== "ok";
  return (
    <>
      {fxFullscreen && (
        <div className={holdFx ? "bp3-hold" : undefined} style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 25 }}>{fxLayer}</div>
      )}
      <div
        className={holdFx ? "bp3-hold" : undefined}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: compact ? 160 : "70vh",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }} />
          <div style={{ width: "100%", maxWidth: 260 }}>
            <HpBar
              name={wild.name} level={wild.level} element={wild.element} hp={wild.hp} maxHp={wild.maxHp}
              status={wild.status} stages={wild.stages} resists={wild.resists}
              shake={fx.flags.shakeWild} flash={fx.flags.flashWild} faded={fx.flags.faintWild} fxKey={fxKey}
              simple
            />
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <DistanceBar distance={distance} fled={fled} />
              <FleeButton onFlee={onFlee} disabled={fleeOff} warn={fleeWarn} />
            </div>
            <HpBar
              name={mine.name} level={mine.level} element={mine.element} hp={mine.hp} maxHp={mine.maxHp}
              status={mine.status} stages={mine.stages} resists={mine.resists}
              shake={fx.flags.shakeMine} flash={fx.flags.flashMine} faded={fx.flags.faintMine} fxKey={fxKey}
            />
          </div>
          <SkillButtons moves={moves} foeElement={wild.element} onPick={onPickMove} disabledAll={(movesDisabled ?? false) || fled} timerSec={timerSec} timerMax={timerMax} />
        </div>
        {!fxFullscreen && fxLayer}
      </div>
      {faintSide && (
        <div className="bfx-faint" style={{ marginTop: 4, fontSize: 12, opacity: 0.8 }}>
          {faintSide.name} 쓰러짐
        </div>
      )}
    </>
  );
}

// UH-1: 도망 버튼 (0.6초 길게 누르기 + 가장자리 진행 링, 실수 방지).
// 마우스·터치는 유지해야 발동, 키보드(Enter/Space)는 바로 발동.
const FLEE_HOLD_MS = 600;
const FLEE_RING_R = 9;
const FLEE_RING_C = 2 * Math.PI * FLEE_RING_R;

function FleeButton({
  onFlee,
  disabled,
  warn,
}: {
  onFlee: () => void;
  disabled: boolean;
  warn: boolean;
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number | null>(null);
  const pointerActive = useRef(false);

  function cancel() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  }

  return (
    <button
      onPointerDown={(e) => {
        if (disabled) return;
        pointerActive.current = true;
        setHolding(true);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setHolding(false);
          onFlee();
        }, FLEE_HOLD_MS);
        e.preventDefault();
      }}
      onPointerUp={cancel}
      onPointerLeave={() => {
        cancel();
        pointerActive.current = false;
      }}
      onPointerCancel={cancel}
      onClick={(e) => {
        if (pointerActive.current) {
          pointerActive.current = false;
          return; // 포인터 경로는 길게 누르기 타이머가 소유
        }
        if (e.detail === 0 && !disabled) onFlee(); // 키보드 활성화
      }}
      onContextMenu={(e) => e.preventDefault()}
      disabled={disabled}
      aria-label="도망 (0.6초 길게 누르기)"
      className={`bfx-flee-btn${warn ? " bfx-flee-warn" : ""}`}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--battle-font)",
        color: "#fff",
        background: "var(--battle-panel)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "1px solid var(--battle-edge)",
        borderRadius: 999,
        boxShadow: "var(--battle-shadow), inset 0 1px 0 rgba(255,255,255,0.12)",
        // AF-2/4: 기준점 알약과 같은 높이(34px).
        height: 34,
        boxSizing: "border-box",
        padding: "0 12px 0 8px",
        cursor: disabled ? "default" : "pointer",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        ...(disabled ? { opacity: 0.55 } : {}),
      }}
    >
      <span style={{ position: "relative", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)", opacity: holding ? 1 : 0.35 }}
        >
          <circle cx="11" cy="11" r={FLEE_RING_R} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
          <circle
            cx="11"
            cy="11"
            r={FLEE_RING_R}
            fill="none"
            stroke="#ff8a80"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={FLEE_RING_C}
            strokeDashoffset={holding ? 0 : FLEE_RING_C}
            style={{ transition: holding ? `stroke-dashoffset ${FLEE_HOLD_MS}ms linear` : "none" }}
          />
        </svg>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
          <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
          <path d="M16 17h4" />
          <path d="M4 13h4" />
        </svg>
      </span>
      <span>도망</span>
    </button>
  );
}
