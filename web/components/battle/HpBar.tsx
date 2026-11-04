// components/battle/HpBar.tsx — UI-4 수정: 토큰 유리 패널 + 비율색 HP 그라디언트 + 레벨 배지.
"use client";

import { useEffect, useState } from "react";
import Chips from "./Chips";
import { ELEMENT_FX_COLOR } from "./fx";

// BP-3: 밝은 잔상 바가 0.5초 늦게 따라 줄어듦.
const BP3_GHOST_MS = 500;

interface HpBarProps {
  name: string;
  level: number;
  element: string;
  hp: number;
  maxHp: number;
  status: string | null;
  stages: Partial<Record<string, number>>;
  resists: Partial<Record<string, number>>;
  shake: number;
  flash: boolean;
  faded: boolean;
  fxKey: number;
  /** 9-F: true면 이름+체력만 (상대 크리처용, 칩 생략). */
  simple?: boolean;
}

export default function HpBar(props: HpBarProps) {
  const pct = props.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((props.hp / props.maxHp) * 100))) : 0;
  const [ghost, setGhost] = useState(pct);
  useEffect(() => {
    if (ghost === pct) return;
    const t = window.setTimeout(() => setGhost(pct), BP3_GHOST_MS);
    return () => window.clearTimeout(t);
  }, [pct, ghost]);
  return <HpBarPanel {...props} pct={pct} ghost={ghost} />;
}

function HpBarPanel({
  name,
  level,
  element,
  hp,
  maxHp,
  status,
  stages,
  resists,
  shake,
  flash,
  faded,
  fxKey,
  simple,
  pct,
  ghost,
}: HpBarProps & { pct: number; ghost: number }) {
  const fill = pct >= 50 ? "var(--battle-hp-high)" : pct >= 25 ? "var(--battle-hp-mid)" : "var(--battle-hp-low)";
  const edge = ELEMENT_FX_COLOR[element] ?? "#ffffff";
  return (
    <div
      key={fxKey}
      className={`${shake === 2 ? "bfx-shake2" : shake === 1 ? "bfx-shake1" : ""}${faded ? " bfx-faint" : ""}`}
      style={{
        position: "relative", background: "var(--battle-panel)", backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)", border: "1px solid var(--battle-edge)",
        borderRadius: "var(--battle-radius)",
        boxShadow: `var(--battle-shadow), 0 0 14px ${edge}44, inset 0 1px 0 rgba(255,255,255,0.12)`,
        padding: "8px 10px", fontFamily: "var(--battle-font)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          {/* UH-1: 이름 잘림 제거 (2줄까지 전체 표시, keep-all). */}
          <span style={{ fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: 1.2, wordBreak: "keep-all", overflowWrap: "break-word" }}>
            {name}
          </span>
          <span
            style={{
              fontSize: 11, fontWeight: 600, color: "#fff", border: `1px solid ${edge}`,
              borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
            }}
          >
            {level}레벨
          </span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "#fff", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {hp}/{maxHp}
        </span>
      </div>
      <div style={{ position: "relative", height: 10, background: "rgba(255,255,255,0.12)", borderRadius: 6, overflow: "visible", marginTop: 6, boxShadow: "inset 0 2px 4px rgba(0,0,0,0.6)" }}>
        {ghost > pct && (
          <div
            data-testid="hp-ghost"
            style={{
              position: "absolute", top: 0, bottom: 0, left: 0, width: `${ghost}%`, borderRadius: 6,
              background: "rgba(255,255,255,0.75)", boxShadow: "0 0 6px rgba(255,255,255,0.8)",
              transition: "width 0.3s ease",
            }}
          />
        )}
        <div
          style={{
            position: "relative", width: `${pct}%`, height: "100%", borderRadius: 6, transition: "width 0.1s ease",
            background: `linear-gradient(180deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 45%), ${fill}`,
            boxShadow: `0 0 6px ${fill}`,
          }}
        />
        {pct > 0 && pct < 100 && (
          <div style={{ position: "absolute", top: 1, bottom: 1, left: `calc(${pct}% - 2px)`, width: 4, borderRadius: 2, background: "rgba(255,255,255,0.9)", boxShadow: "0 0 4px rgba(255,255,255,0.9)", transition: "left 0.1s ease" }} />
        )}
      </div>
      {!simple && <Chips stages={stages} resists={resists} status={status} />}
      {flash && <div className="bfx-flash" />}
    </div>
  );
}
