// components/battle/BattleResultText.tsx — UI-3 수정: 결과 카드 대신 2.5초 연출 텍스트.
// UH-1: 승리·패배·도망·포획 한 가지 카드 스타일(BP-3 배지 팝 톤).
// 도망은 가운데 "도망쳤다"(UI-3 문구) 대신 가장자리 흐림 + 뒤로 빠지는 0.5초 + 작은 카드 "무사히 빠져나왔다".
// 패널·뒤로 버튼 없음. pointer-events none, 배경을 덮지 않음.
"use client";

import { ELEMENT_FX_COLOR } from "./fx";

export default function BattleResultText({
  result,
  exp,
  element,
}: {
  result: "won" | "lost" | "fled" | "wildFled" | "timeWin" | "timeDraw";
  exp: number;
  element: string;
}) {
  // BT-T: 시간 종료 판정승/무승부 + 야생 달아남 (기존 경로 재사용).
  const title =
    result === "won" ? "승리!"
    : result === "lost" ? "패배…"
    : result === "fled" ? "무사히 빠져나왔다"
    : result === "wildFled" ? "달아났다"
    : result === "timeWin" ? "시간 종료 — 판정승"
    : "시간 종료 — 무승부";
  const anim =
    result === "won" || result === "timeWin" ? "ui3-win 2.5s ease forwards"
    : result === "lost" || result === "timeDraw" ? "ui3-lose 2.5s ease forwards"
    : "ui3-flee 2.5s ease forwards";
  const grad =
    result === "won" || result === "timeWin" ? "linear-gradient(180deg, #fff6d8 0%, var(--battle-gold) 55%, #ff9d2e 100%)"
    : result === "lost" ? "linear-gradient(180deg, #e2e8f0 0%, #64748b 60%, #334155 100%)"
    : result === "timeDraw" ? "linear-gradient(180deg, #f1f5f9 0%, #94a3b8 60%, #475569 100%)"
    : "linear-gradient(180deg, #ffffff 0%, #d9fbff 100%)";
  const titleFs = result === "fled" || result === "wildFled" ? 22 : result === "timeWin" || result === "timeDraw" ? 24 : 30;
  const glow = ELEMENT_FX_COLOR[element] ?? "#ffd54a";
  const card = (
    <div className="uh1-result-card">
      <div
        style={{
          fontSize: titleFs, fontWeight: 700, fontFamily: "var(--battle-font)",
          background: grad, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
          filter: `drop-shadow(0 2px 8px rgba(0,0,0,0.8)) drop-shadow(0 0 14px ${glow}55)`,
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      {exp > 0 && (
        <div
          style={{
            marginTop: 6, fontSize: 13, fontWeight: 600, fontFamily: "var(--battle-num)",
            color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.8)", fontVariantNumeric: "tabular-nums",
          }}
        >
          +{exp} EXP
        </div>
      )}
    </div>
  );
  if (result === "fled" || result === "wildFled") {
    // AF-3/7: 상자 없이 글자만, HP 바 아래 중앙(top 34%)으로. 연출(블러·풀백)은 유지.
    return (
      <div
        data-testid="battle-result-text"
        className="battle-result-text"
        style={{
          position: "absolute", inset: 0,
          pointerEvents: "none", zIndex: 44, animation: anim,
        }}
      >
        <div className="uh1-flee-blur" />
        <div className="uh1-pullback" style={{ position: "absolute", left: 0, right: 0, top: "34%", textAlign: "center", zIndex: 46 }}>
          {card}
        </div>
      </div>
    );
  }
  return (
    <div
      data-testid="battle-result-text"
      className="battle-result-text"
      style={{
        position: "absolute", left: 0, right: 0, top: "34%", textAlign: "center",
        pointerEvents: "none", zIndex: 46, animation: anim,
      }}
    >
      {card}
    </div>
  );
}
