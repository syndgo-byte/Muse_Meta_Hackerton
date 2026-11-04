// components/LevelUpFx.tsx — D-2 level-up fanfare, reworked (see docs/LEVELUP_FX_ORDER.md).
// Golden flash + light rays + "레벨 N 달성!" (3.2s) + soft chime. Display only.
"use client";

import { useEffect, useRef } from "react";
import { playLevelupChime } from "@/lib/levelup-chime";

export default function LevelUpFx({
  level,
  onDone,
}: {
  level: number;
  onDone: () => void;
}) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const t = window.setTimeout(() => doneRef.current(), 3200);
    return () => window.clearTimeout(t);
  }, []);
  // Chime starts with the gold flash (same mount). StrictMode-safe: once.
  const chimedRef = useRef(false);
  useEffect(() => {
    if (chimedRef.current) return;
    chimedRef.current = true;
    try {
      const st = playLevelupChime();
      (window as unknown as { __levelupChime?: string }).__levelupChime = st;
    } catch {
      /* silent */
    }
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 60 }}>
      <div className="bfx-goldflash" />
      <div className="bfx-levelup-rays" />
      <div className="bfx-levelup-text">{`레벨 ${level} 달성!`}</div>
      {/* MF-1: 해금 줄 제거 (고를 곳 없음) */}
    </div>
  );
}
