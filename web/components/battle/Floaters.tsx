// components/battle/Floaters.tsx — 떠오르는 숫자·문구 (§10-1 글자 규칙).
"use client";

import type { FxItem } from "./fx";

const BADGE_GAP = 30; // BP-4 숫자줄 아래 첫 배지 간격(px, HP 패널 회피)
const BADGE_DY = 24; // BP-4 같은 편의 n번째 배지 간격(px)

export default function Floaters({ items, fxKey, hold }: { items: FxItem[]; fxKey: number; hold?: boolean }) {
  return (
    <>
      {items.map((it) => {
        const isBadge = it.badge !== "none";
        const baseTop = it.side === "wild" ? "16%" : "56%";
        return (
          <div
            key={`${fxKey}-${it.id}`}
            className={`bfx-floater${it.big ? " bfx-floater-big" : ""}${it.small ? " bfx-floater-small" : ""}${isBadge ? ` bfx-badge bfx-badge-${it.badge}` : ""}`}
            style={{
              left: `calc(50% + ${it.dx}px)`,
              top: isBadge ? `calc(${baseTop} + ${BADGE_GAP + it.stack * BADGE_DY}px)` : baseTop,
              color: it.color,
              animationDelay: `${it.delayMs}ms`,
              opacity: hold ? 1 : 0,
              ...(hold ? { animation: "none", transform: "translateY(-20px)" } : {}),
              ...(isBadge ? { borderColor: it.color } : {}),
            }}
          >
            {it.text}
          </div>
        );
      })}
    </>
  );
}
