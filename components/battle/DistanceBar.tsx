// components/battle/DistanceBar.tsx — UI-4 수정: 도망 버튼 옆 작은 캡슐. 판정 로직 무변경.
// UH-1: 도주 뒤 빨간 "도망침!" 덧붙임 제거(결과 카드가 알림). 거리 경고(도망!/경고)는 유지.
// 거리 아이콘: Lucide "ruler" SVG path inline (ISC, https://lucide.dev/icons/ruler).
"use client";

import { FLEE_DIST_M, fleeStatus } from "@/lib/battle/engine";

export default function DistanceBar({
  distance,
  fled,
}: {
  distance: number;
  fled: boolean;
}) {
  const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const st = fleeStatus(d);
  const warn = st === "flee" ? "도망!" : st === "warn" ? "경고" : "";
  const pct = Math.max(0, Math.min(100, (d / FLEE_DIST_M) * 100));
  const hot = st !== "ok";
  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, color: "#fff", fontSize: 12,
        fontWeight: 600, fontFamily: "var(--battle-font)", fontVariantNumeric: "tabular-nums",
        background: "var(--battle-panel)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
        border: `1px solid ${hot ? "#ff5a5a" : "var(--battle-edge)"}`, borderRadius: 999,
        // AF-2/4: 도망 버튼과 같은 높이(34px). 경고도 줄바꿈 없이 한 줄로 붙인다.
        height: 34, padding: "0 10px", boxSizing: "border-box",
        boxShadow: "var(--battle-shadow)", whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
          <path d="m14.5 12.5 2-2" />
          <path d="m11.5 9.5 2-2" />
          <path d="m8.5 6.5 2-2" />
          <path d="m17.5 15.5 2-2" />
        </svg>
        <span>기준점 {d.toFixed(1)}m</span>
        <span style={{ width: 32, height: 5, background: "rgba(255,255,255,0.15)", borderRadius: 3, overflow: "hidden" }}>
          <span style={{ display: "block", width: `${pct}%`, height: "100%", background: hot ? "#ff5a5a" : "#38bdf8", borderRadius: 3 }} />
        </span>
      </span>
      {warn && <span style={{ color: "#ff8a80" }}>{warn}</span>}
    </div>
  );
}
